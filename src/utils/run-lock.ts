import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A separate SQLite OS lock survives concurrent starts and is released on process death.
// No PID guessing, stale-file deletion, timer lease or access to the real LMS database.
export function acquireRunLock(path: string): (() => void) | null {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 0 });
  try {
    db.exec('CREATE TABLE IF NOT EXISTS lock_guard (id INTEGER PRIMARY KEY)');
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    db.close();
    if (error instanceof Error && 'errcode' in error && (error.errcode === 5 || error.errcode === 6)) return null;
    throw error;
  }
  let released = false;
  return () => { if (!released) { released = true; try { db.exec('ROLLBACK'); } finally { db.close(); } } };
}
