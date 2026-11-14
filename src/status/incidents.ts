import { randomUUID } from 'node:crypto';
import type { LmsStore } from '../database/store.js';
import { sendOnce } from '../notification/delivery.js';
import type { Transport } from '../notification/discord.js';
import type { Log } from '../utils/logger.js';
import { AUTH_CODES, checkpoint, STATUS_INFO, type RunIssue, type StatusCode } from './model.js';
import { incidentsSchema, cleanIssue } from './schema.js';
import { parseJson } from '../runtime/json.js';

interface Incident { id: string; issue: RunIssue; count: number; firstSeenAt: string; lastSeenAt: string; generation: number; lastSentAt: string | null }
const KEY = 'status:incidents';
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const immediate = (code: StatusCode) => AUTH_CODES.has(code) || code === 'LMS_STRUCTURE_CHANGED';
const alertable = (code: StatusCode) => immediate(code) || ['NETWORK_ERROR','LMS_TIMEOUT','DATABASE_ERROR','UNKNOWN_ERROR'].includes(code);
const identity = (e: RunIssue) => `${checkpoint(e.scope, e.courseId)}:${e.errorCode}`;
const save = (store: LmsStore, key: string, value: unknown) => store.db.prepare('INSERT INTO monitor_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));

// Existing monitor_state and notification_history only. No baseline/history reset or migration.
// At most ONE error message per run; recovery is local-only. Unchecked scopes do not recover.
export async function reportIncidents(store: LmsStore, errors: RunIssue[], healthy: ReadonlySet<string>,
  transport: Transport, log: Log, now: Date, allowDelivery = true): Promise<{ sent: number; deferred: number; uncertain: number }> {
  const row = store.db.prepare('SELECT value FROM monitor_state WHERE key=?').get(KEY);
  const previous: Incident[] = row ? parseJson(String(row.value), incidentsSchema).map(e => ({ ...e, issue: cleanIssue(e.issue) })) : [];
  const currentIds = new Set(errors.map(identity));
  const incidents = previous.filter(entry => {
    if (currentIds.has(identity(entry.issue)) || !healthy.has(checkpoint(entry.issue.scope, entry.issue.courseId))) return true;
    log('RECOVERY', { previous: entry.issue.errorCode, current: 'SUCCESS', scope: entry.issue.scope, course: entry.issue.courseId ?? 'GLOBAL' });
    save(store, 'status:last-recovery', { previous: entry.issue.errorCode, current: 'SUCCESS', occurredAt: now.toISOString(), issue: entry.issue });
    return false;
  });
  for (const error of errors) {
    let entry = incidents.find(e => identity(e.issue) === identity(error));
    if (!entry) {
      entry = { id: randomUUID(), issue: error, count: 0, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), generation: 0, lastSentAt: null };
      incidents.push(entry);
    }
    entry.count++; entry.lastSeenAt = now.toISOString();
    save(store, 'status:last-error', { occurredAt: now.toISOString(), issue: error });
  }
  // Persist incident ID BEFORE external delivery, so crashes reuse the same sendOnce key.
  save(store, KEY, incidents);
  const counts = { sent: 0, deferred: 0, uncertain: 0 };
  if (!allowDelivery) return counts;
  const eligible = incidents.filter(e => currentIds.has(identity(e.issue)) && alertable(e.issue.errorCode)
    && (immediate(e.issue.errorCode) || e.count >= 3)
    && (!e.lastSentAt || (!immediate(e.issue.errorCode) && now.getTime() - Date.parse(e.lastSentAt) >= COOLDOWN_MS)));
  // Action-required errors take precedence over transient ones.
  eligible.sort((a, b) => Number(immediate(b.issue.errorCode)) - Number(immediate(a.issue.errorCode)));
  const entry = eligible[0];
  if (!entry) return counts;
  const key = `error:${entry.id}:${entry.generation}`;
  const [title] = STATUS_INFO[entry.issue.errorCode];
  const status = await sendOnce(store, key, { allowed_mentions: { parse: [] }, embeds: [{
    title: `⚠ ${title}`, description: `${entry.issue.safeReason}\n\n${entry.issue.action}`,
    fields: [{ name: '영향 범위', value: `${entry.issue.courseName ?? '전체 실행'} / ${entry.issue.scope}` },
      { name: '상태 코드', value: entry.issue.errorCode }],
  }] }, transport, now);
  if (status === 'SENT' || status === 'SKIPPED') {
    entry.lastSentAt = now.toISOString(); entry.generation++;
    if (status === 'SENT') counts.sent++;
  } else if (status === 'UNKNOWN') counts.uncertain++;
  else counts.deferred++;
  log('ERROR_NOTICE', { status, reason: entry.issue.errorCode });
  save(store, KEY, incidents);
  return counts;
}
