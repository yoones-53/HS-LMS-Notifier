import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRunStatus, RESULT_INFO } from './result.js';
import { issue, safeResult, type RunIssue, type RunResult } from '../status/model.js';

export type LogCode = 'RUN_START' | 'AUTH_OK' | 'AUTH_EXPIRED' | 'AUTH_NOTICE' | 'COURSES'
  | 'SCOPE_OK' | 'SCOPE_UNAVAILABLE' | 'SCOPE_FAILED' | 'COURSE_FAILED' | 'SYNC'
  | 'NOTIFICATIONS' | 'RUN_FINISH' | 'RUN_FAILED' | 'ALREADY_RUNNING' | 'RESULT' | 'AUTO_LOGIN' | 'BROWSER_CLOSED' | 'INITIAL_SUMMARY' | 'RECOVERY' | 'ERROR_NOTICE';
export interface LogFields { [key: string]: unknown; result?: RunResult; issue?: RunIssue }
export type Log = (code: LogCode, fields?: LogFields) => void;

// Fixed event codes and short machine identifiers only: no Error, DOM, title or URL.
export function createLogger(directory: string, writeConsole: (line: string) => void = console.log): Log {
  mkdirSync(directory, { recursive: true });
  return (code, fields = {}) => {
    const allowed = new Set(['runId','course','type','count','excluded','baseline','newItems','updated','unchanged','sent','deferred','uncertain','status','reason','phase','previous','current','scope','exitCode','statusCode','recoverable']);
    const safe: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k)).map(([k, v]) => [k,
      typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'string' && /^[A-Za-z0-9_:.-]{1,120}$/.test(v) ? v : '[omitted]']));
    if (code === 'RESULT' && isRunStatus(fields.status)) {
      const [reason, action] = RESULT_INFO[fields.status];
      safe.reason = reason; safe.action = action;
    }
    if (fields.issue) {
      const e = fields.issue;
      safe.issue = issue(e.errorCode, e.scope, e.courseId ? { id: e.courseId, name: e.courseName ?? '' } : undefined);
    }
    if (fields.result) {
      const result = safeResult(fields.result);
      Object.assign(safe, { result, status: result.status, statusCode: result.code, reason: result.reason,
        recoverable: result.recoverable, exitCode: result.exitCode, errors: result.errors });
    }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const line = JSON.stringify({ time: new Date().toISOString(), code, ...safe });
    writeConsole(line);
    appendFileSync(join(directory, `monitor-${date}.jsonl`), line + '\n', 'utf8');
  };
}
