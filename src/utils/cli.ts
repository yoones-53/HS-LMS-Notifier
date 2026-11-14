import { join } from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { acquireRunLock } from './run-lock.js';
import { createLogger } from './logger.js';
import { classifyError } from './result.js';
import { issue, runResult, type RunResult } from '../status/model.js';
import { formatOutcome } from '../status/presentation.js';
import { publishResult } from '../status/output.js';
import { resolveRuntimePaths } from '../runtime/paths.js';

export class UserFacingError extends Error {}

export async function runCli(action: () => Promise<void>, options: { monitor?: boolean } = {}): Promise<void> {
  let release: (() => void) | null = null;
  let releaseRuntime: (() => void) | null = null;
  let logs = join(PROJECT_ROOT, 'logs');
  let started = false;
  const report = (result: RunResult) => {
    console.log(formatOutcome(result));
    try {
      createLogger(logs, () => {})('RUN_FINISH', { result });
      if (options.monitor) publishResult(logs, result);
    } catch { console.error('안전한 실행 로그를 저장하지 못했습니다. logs 폴더 권한을 확인하세요.'); }
    process.exitCode = result.exitCode;
  };
  try {
    release = acquireRunLock(join(PROJECT_ROOT, 'data', 'process-lock.sqlite'));
    if (!release) {
      logs = resolveRuntimePaths().logs;
      report(runResult('SCHEDULER_LOCKED'));
      return;
    }
    const paths = resolveRuntimePaths(); logs = paths.logs;
    if (paths.lock !== join(PROJECT_ROOT, 'data', 'process-lock.sqlite')) {
      releaseRuntime = acquireRunLock(paths.lock);
      if (!releaseRuntime) { report(runResult('SCHEDULER_LOCKED')); return; }
    }
    started = true;
    await action();
  } catch (error: unknown) {
    // Raw browser errors can contain authentication URLs. Print known-safe messages only.
    if (!options.monitor && error instanceof UserFacingError) { console.error(error.message); process.exitCode = 1; }
    else {
      const code = !started || error instanceof UserFacingError ? 'INITIALIZATION_ERROR' : classifyError(error);
      report(runResult(code, [issue(code, code === 'DATABASE_ERROR' ? 'DATABASE' : 'INITIALIZATION')]));
    }
  } finally {
    try { try { releaseRuntime?.(); } finally { release?.(); } }
    catch { report(runResult('INITIALIZATION_ERROR', [issue('INITIALIZATION_ERROR', 'CLEANUP')])); }
  }
}
