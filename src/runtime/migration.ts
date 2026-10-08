import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { LmsStore } from '../database/store.js';
import { AppError } from '../utils/result.js';
import { acquireRuntimeLock, routePath, routeSchema, type RuntimePaths } from './paths.js';
import { DataFileError, readJson, writeJson } from './json.js';

import { migrationSchema, migrationTables as tables } from './migration-schema.js';
export { migrationSchema } from './migration-schema.js';
const sourceKey = (paths: RuntimePaths) => createHash('sha256').update(resolve(paths.root).toLowerCase()).digest('hex');
export function databaseSignature(db: DatabaseSync): { counts: Record<typeof tables[number], number>; digest: string } {
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok'
      || Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 4) throw new DataFileError();
  const hash = createHash('sha256');
  const counts = {} as Record<typeof tables[number], number>;
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map(r => JSON.stringify(r)).sort();
    counts[table] = rows.length;
    hash.update(table); for (const row of rows) hash.update(row + '\n');
  }
  return { counts, digest: hash.digest('hex') };
}

/** One-time activation; original SQLite is opened read-only and never removed.
 * No fallback to an empty database after any migration error. */
export async function migrateRuntime(legacy: RuntimePaths, target: RuntimePaths,
  publish: typeof writeJson = writeJson): Promise<'MIGRATED' | 'EXISTING' | 'FRESH'> {
  const release = acquireRuntimeLock(target, legacy);
  if (!release) throw new AppError('SCHEDULER_LOCKED');
  const metadata = join(target.state, 'migration.json');
  const temporary = join(target.root, 'data', `migration-${randomUUID()}.sqlite`);
  let createdDestination = false, activated = false;
  try {
    if (resolve(legacy.root).toLowerCase() === resolve(target.root).toLowerCase()) {
      mkdirSync(join(target.root, 'data'), { recursive: true });
      mkdirSync(target.logs, { recursive: true });
      mkdirSync(target.state, { recursive: true });
      if (!existsSync(target.database)) {
        if (existsSync(metadata)) throw new DataFileError();
        const blank = new LmsStore(target.database); createdDestination = true;
        try { databaseSignature(blank.db); } finally { blank.close(); }
        activated = true;
        return 'FRESH';
      }
      const current = new DatabaseSync(target.database, { readOnly: true });
      try { databaseSignature(current); } finally { current.close(); }
      return 'EXISTING';
    }
    if (existsSync(routePath(legacy))) {
      const route = readJson(routePath(legacy), routeSchema);
      const state = readJson(metadata, migrationSchema);
      if (route.migrationId !== state.id || state.sourceKey !== sourceKey(legacy)) throw new DataFileError();
      const rebased = resolve(route.root) !== target.root;
      if (rebased) {
        // Upgrade a previously virtualized logical alias only when both names
        // resolve to the exact SAME file, under both execution locks. No DB copy.
        const before=statSync(join(route.root,'data/lms.sqlite'),{bigint:true});
        const after=statSync(target.database,{bigint:true});
        if(before.ino!==after.ino || before.dev!==after.dev) throw new DataFileError();
      }
      const current = new DatabaseSync(target.database, { readOnly: true });
      try { databaseSignature(current); } finally { current.close(); }
      if(rebased) writeJson(routePath(legacy),{...route,root:target.root});
      return 'EXISTING';
    }
    // An existing destination without a complete activation is never overwritten.
    if (existsSync(target.database) || existsSync(metadata)) throw new DataFileError();
    mkdirSync(join(target.root, 'data'), { recursive: true });
    mkdirSync(target.logs, { recursive: true }); mkdirSync(target.state, { recursive: true });
    const copied = existsSync(legacy.database);
    let signature: ReturnType<typeof databaseSignature>;
    if (copied) {
      const source = new DatabaseSync(legacy.database, { readOnly: true, timeout: 0 });
      try {
        signature = databaseSignature(source);
        await backup(source, temporary);
        // Detect unexpected writers not respecting the app lock.
        if (databaseSignature(source).digest !== signature.digest) throw new DataFileError();
      } finally { source.close(); }
    } else {
      const blank = new LmsStore(temporary);
      try { signature = databaseSignature(blank.db); } finally { blank.close(); }
    }
    const destination = new DatabaseSync(temporary, { readOnly: true });
    try { if (databaseSignature(destination).digest !== signature.digest) throw new DataFileError(); }
    finally { destination.close(); }
    const id = randomUUID();
    renameSync(temporary, target.database); createdDestination = true;
    writeJson(metadata, migrationSchema.parse({ version: 1, id, sourceKey: sourceKey(legacy), mode: copied ? 'COPIED' : 'FRESH',
      status: 'ACTIVE', schemaVersion: 4, ...signature, completedAt: new Date().toISOString() }));
    // Publish LAST, under both locks. From here CLI and GUI share one live DB.
    publish(routePath(legacy), { version: 1, root: target.root, migrationId: id });
    activated = true;
    return copied ? 'MIGRATED' : 'FRESH';
  } catch (error) {
    if (!activated && createdDestination) {
      // Only our newly created, unpublished files; never an existing user DB.
      if (existsSync(target.database)) unlinkSync(target.database);
      if (existsSync(metadata)) unlinkSync(metadata);
    }
    if (error instanceof AppError) throw error;
    throw new DataFileError();
  } finally {
    try { if (existsSync(temporary)) unlinkSync(temporary); } finally { release(); }
  }
}
