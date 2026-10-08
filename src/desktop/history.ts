import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseJson, readJson } from '../runtime/json.js';
import type { RuntimePaths } from '../runtime/paths.js';
import { cleanIssue, incidentsSchema, parsedRun, recoverySchema, resultSchema } from '../status/schema.js';
import { buildTodo, todoSourceSchema } from '../summary/todo.js';
import { z } from 'zod';

export function readHistory(paths: RuntimePaths) {
  const recentFile = join(paths.logs, 'latest-run.json');
  if (existsSync(recentFile)) readJson(recentFile, resultSchema);
  const db = new DatabaseSync(paths.database, { readOnly: true, timeout: 1000 });
  try {
    db.exec('BEGIN'); // One read snapshot while the scheduler may be committing a sync.
    const recent = db.prepare('SELECT summary_json FROM monitor_runs WHERE finished_at IS NOT NULL AND summary_json IS NOT NULL ORDER BY started_at DESC LIMIT 5')
      .all().map(row => parsedRun(String(row.summary_json)));
    const incident = db.prepare("SELECT value FROM monitor_state WHERE key='status:incidents'").get();
    const recovery = db.prepare("SELECT value FROM monitor_state WHERE key='status:last-recovery'").get();
    const recovered = recovery ? parseJson(String(recovery.value), recoverySchema) : null;
    const sync = db.prepare("SELECT started_at FROM sync_history WHERE status='SUCCESS' ORDER BY rowid DESC LIMIT 1").get();
    const collectedAt = sync ? String(sync.started_at) : null;
    const matchingRun = collectedAt ? db.prepare('SELECT summary_json FROM monitor_runs WHERE started_at<=? AND finished_at>=? AND summary_json IS NOT NULL ORDER BY started_at DESC LIMIT 1')
      .get(collectedAt,collectedAt) : undefined;
    const syncResult = matchingRun ? parsedRun(String(matchingRun.summary_json)) : null;
    const courses = db.prepare('SELECT course_id AS courseId,class_no AS classNo,name FROM courses WHERE last_seen_at=?').all(collectedAt)
      .map(row => z.object({ courseId: z.string(), classNo: z.string(), name: z.string() }).parse(row));
    // DB keeps historical rows. Never treat old/failed-scope items as currently verified tasks.
    const items = db.prepare("SELECT payload_json FROM items WHERE type IN ('ASSIGNMENT','VIDEO') AND last_seen_at=?").all(collectedAt)
      .map(row => parseJson(String(row.payload_json), todoSourceSchema));
    const todo = buildTodo(courses, items, new Date(), collectedAt, !collectedAt ? 'NOT_COLLECTED'
      : syncResult?.result.collectionStatus === 'SUCCESS' && recent[0]?.result.collectionStatus === 'SUCCESS' ? 'COMPLETE' : 'PARTIAL');
    return { recent, incidents: incident ? parseJson(String(incident.value), incidentsSchema).map(i => cleanIssue(i.issue)) : [],
      recovery: recovered ? { occurredAt: recovered.occurredAt, issue: cleanIssue(recovered.issue) } : null, todo };
  } finally { db.close(); }
}
