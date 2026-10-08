import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeResult, type RunResult } from './model.js';

// Only safe summaries, no stdout capture. Scheduler token correlates THIS invocation.
export function publishResult(directory: string, result: RunResult, schedulerToken = process.env.HS_LMS_RUN_TOKEN): void {
  mkdirSync(directory, { recursive: true });
  const safe = safeResult(result);
  const write = (name: string, value: unknown) => {
    const path = join(directory, name);
    writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8');
    renameSync(path + '.tmp', path);
  };
  // A competing skipped process must not replace the last completed monitor result.
  if (result.code !== 'SCHEDULER_LOCKED') write('latest-run.json', safe);
  if (schedulerToken && /^[0-9a-f-]{36}$/i.test(schedulerToken)) {
    write('latest-scheduler-run.json', { invocationId: schedulerToken, result: safe });
  }
}
