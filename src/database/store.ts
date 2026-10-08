import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Course } from '../crawler/courses.js';
import { courseKey, itemKey, type ItemChange, type LmsItem, type ScopeSnapshot } from '../model.js';
import { detectChanges, type ChangeEvent } from '../detector/changes.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export const fingerprint = (item: LmsItem): string => createHash('sha256').update(JSON.stringify(stable(item))).digest('hex');
export interface SyncResult { runId: string; baseline: number; baselineScopes: string[]; newItems: number; updated: number; unchanged: number; changes: ItemChange[]; events: ChangeEvent[] }

export class LmsStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5_000 });
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 4) throw new Error('UNSUPPORTED_DB_VERSION');
      // WAL cannot be enabled inside a transaction. All schema changes can and
      // must roll back together, including user_version and additive migration.
      this.db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS courses (
        course_key TEXT PRIMARY KEY, course_id TEXT NOT NULL, class_no TEXT NOT NULL,
        name TEXT NOT NULL, url TEXT NOT NULL, semester_json TEXT NOT NULL, last_seen_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS items (
        item_key TEXT PRIMARY KEY, course_key TEXT NOT NULL REFERENCES courses(course_key),
        type TEXT NOT NULL CHECK(type IN ('NOTICE','MATERIAL','ASSIGNMENT','VIDEO')),
        lms_id TEXT NOT NULL, title TEXT NOT NULL, payload_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
        first_seen_kind TEXT NOT NULL CHECK(first_seen_kind IN ('BASELINE','NEW')),
        version INTEGER NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        UNIQUE(course_key,type,lms_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scope_baselines (
        course_key TEXT NOT NULL REFERENCES courses(course_key), type TEXT NOT NULL, initialized_at TEXT NOT NULL,
        PRIMARY KEY(course_key,type)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS notification_history (
        notification_key TEXT PRIMARY KEY, status TEXT NOT NULL, payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_history (
        run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL,
        baseline_count INTEGER NOT NULL, new_count INTEGER NOT NULL, updated_count INTEGER NOT NULL,
        unchanged_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS change_events (
        event_key TEXT PRIMARY KEY, item_key TEXT NOT NULL REFERENCES items(item_key),
        kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS monitor_runs (
        run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL, summary_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS monitor_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      `);
      if (!this.db.prepare('PRAGMA table_info(notification_history)').all().some(c => c.name === 'retry_after')) {
        this.db.exec('ALTER TABLE notification_history ADD COLUMN retry_after TEXT');
      }
      this.db.exec('PRAGMA user_version=4; COMMIT');
    } catch (error) {
      // close() rolls back an active migration even if a statement failed.
      this.db.close();
      throw error;
    }
  }
  close(): void { this.db.close(); }
  sync(courses: Course[], scopes: ScopeSnapshot[], now = new Date().toISOString()): SyncResult {
    const result: SyncResult = { runId: randomUUID(), baseline: 0, baselineScopes: [], newItems: 0, updated: 0, unchanged: 0, changes: [], events: [] };
    const allowed = new Set(courses.map(courseKey));
    const seenScopes = new Set<string>();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of courses) this.db.prepare(`INSERT INTO courses VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(course_key) DO UPDATE SET name=excluded.name,url=excluded.url,semester_json=excluded.semester_json,last_seen_at=excluded.last_seen_at`)
        .run(courseKey(c), c.courseId, c.classNo, c.name, c.url, JSON.stringify(c.semester), now);
      for (const scope of scopes) {
        const key = courseKey(scope.course), scopeId = `${key}:${scope.type}`;
        if (!allowed.has(key) || seenScopes.has(scopeId)) throw new Error('INVALID_SYNC_SCOPE');
        seenScopes.add(scopeId);
        const initialized = !!this.db.prepare('SELECT 1 FROM scope_baselines WHERE course_key=? AND type=?').get(key, scope.type);
        if (!initialized) result.baselineScopes.push(scopeId);
        const seenItems = new Set<string>();
        for (const item of scope.items) {
          const id = itemKey(item);
          if (item.type !== scope.type || courseKey(item) !== key || !item.itemId || seenItems.has(id)) throw new Error('INVALID_SYNC_ITEM');
          seenItems.add(id);
          const previous = this.db.prepare('SELECT fingerprint,payload_json,version FROM items WHERE item_key=?').get(id);
          const hash = fingerprint(item), payload = JSON.stringify(item);
          if (!previous) {
            const kind = initialized ? 'NEW' : 'BASELINE';
            this.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, key, item.type, item.itemId, item.title, payload, hash, kind, 1, now, now);
            if (initialized) { result.newItems++; result.changes.push({ before: null, after: item, version: 1 }); }
            else result.baseline++;
          } else if (previous.fingerprint !== hash) {
            const version = Number(previous.version) + 1;
            result.updated++;
            result.changes.push({ before: JSON.parse(String(previous.payload_json)) as LmsItem, after: item, version });
            this.db.prepare('UPDATE items SET title=?,payload_json=?,fingerprint=?,version=?,last_seen_at=? WHERE item_key=?').run(item.title, payload, hash, version, now, id);
          } else {
            result.unchanged++;
            this.db.prepare('UPDATE items SET last_seen_at=? WHERE item_key=?').run(now, id);
          }
        }
        this.db.prepare('INSERT OR IGNORE INTO scope_baselines VALUES (?,?,?)').run(key, scope.type, now);
      }
      result.events = result.changes.flatMap(change => detectChanges(change, now));
      for (const event of result.events) this.db.prepare('INSERT OR IGNORE INTO change_events VALUES (?,?,?,?,?)')
        .run(event.key, itemKey(event.item), event.type, JSON.stringify(event), now);
      this.db.prepare('INSERT INTO sync_history VALUES (?,?,?,?,?,?,?,?)')
        .run(result.runId, now, new Date().toISOString(), 'SUCCESS', result.baseline, result.newItems, result.updated, result.unchanged);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  items(): LmsItem[] { return this.db.prepare('SELECT payload_json FROM items ORDER BY item_key').all().map(r => JSON.parse(String(r.payload_json)) as LmsItem); }
  events(): ChangeEvent[] { return this.db.prepare('SELECT payload_json FROM change_events ORDER BY created_at,event_key').all().map(r => JSON.parse(String(r.payload_json)) as ChangeEvent); }
  notificationCount(): number { return Number(this.db.prepare('SELECT count(*) AS n FROM notification_history').get()?.n); }
}
