import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Only dated, app-owned log files, never subdirectories/symlinks or database data.
export function cleanOldLogs(directory: string, days: number, now = new Date()): number {
  if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error('INVALID_RETENTION');
  let removed = 0;
  for (const name of readdirSync(directory)) {
    const match = /^(?:monitor|scheduler)-(\d{4}-\d{2}-\d{2})\.(?:jsonl|log)$/.exec(name);
    if (!match) continue;
    const date = Date.parse(`${match[1]}T23:59:59+09:00`);
    if (!Number.isFinite(date) || now.getTime() - date <= days * 86_400_000) continue;
    const path = join(directory, name), info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) continue;
    unlinkSync(path); removed++;
  }
  return removed;
}
