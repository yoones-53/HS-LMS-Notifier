import { STATUS_INFO, isStatusCode, type StatusCode } from '../status/model.js';
export type RunStatus = StatusCode;
export const isRunStatus = isStatusCode;
export const RESULT_INFO = Object.fromEntries(Object.entries(STATUS_INFO).map(([k, v]) => [k, [v[1], v[2]]])) as unknown as Record<StatusCode, readonly [string, string]>;
export class AppError extends Error {
  constructor(public readonly status: RunStatus) { super(status); }
}
export function classifyError(error: unknown): RunStatus {
  if (error instanceof AppError) return error.status;
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  if ('code' in error && error.code === 'AUTH_EXPIRED') return 'AUTH_EXPIRED_DURING_CRAWL';
  if ('code' in error && error.code === 'STRUCTURE_CHANGED') return 'LMS_STRUCTURE_CHANGED';
  if ('errcode' in error || ('code' in error && error.code === 'ERR_SQLITE_ERROR')) return 'DATABASE_ERROR';
  // Classify in memory only. Never propagate raw Playwright messages/URLs/input values.
  if (error.name === 'TimeoutError' || /(?:page\.goto|Navigation).*Timeout/i.test(error.message)) return 'LMS_TIMEOUT';
  if (/net::ERR_|Navigation.*failed/i.test(error.message)) return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}
export function printOutcome(status: RunStatus, write = console.log): void {
  const [reason, action] = RESULT_INFO[status];
  write(`Result : ${status}`); write(`Reason : ${reason}`); write(`Action : ${action}`);
}
