import type { MonitorResult } from '../monitor.js';
import { safeResult, type RunResult } from './model.js';

export function formatOutcome(value: RunResult): string {
  const result = safeResult(value);
  const lines = [`Result           : ${result.status}`, `Code             : ${result.code}`, '', result.title, `Reason: ${result.reason}`];
  for (const error of result.errors) {
    lines.push('', `${error.courseName ? error.courseName + ' / ' : ''}${error.scope} — ${error.errorCode}`,
      error.safeReason, `Action: ${error.action}`);
  }
  const success = result.code === 'SUCCESS' || result.code === 'SUCCESS_WITH_CHANGES';
  lines.push('', `Action: ${result.action}`);
  if (!success) lines.push(`Auto recovery    : ${result.recoverable ? '가능 — 다음 예약 실행에서 재확인' : '사용자 확인 필요'}`);
  return lines.join('\n');
}
export function formatMonitor(result: MonitorResult): string {
  return ['\nHS LMS Monitor', '──────────────────────────────',
    `Authentication   : ${result.authentication} (${result.loginMode})`,
    `LMS collection   : ${result.collectionStatus}`, `Database         : ${result.databaseStatus}`, `Discord          : ${result.notificationStatus}`,
    `Courses          : ${result.courses}`, `Completed        : ${result.completedCourses}`, `Failed           : ${result.failedCourses}`,
    `Notices          : ${result.notices}`, `Materials        : ${result.materials}`, `Assignments      : ${result.assignments}`,
    `Online lectures  : ${result.videos}`, `Changes          : ${result.changes}`, `Notifications    : ${result.sent}`,
    `Initial summary  : ${result.initialSummary.status}${result.initialSummary.reason ? ' / ' + result.initialSummary.reason : ''}`,
    `Browser closed   : ${result.browserClosed}`, '──────────────────────────────', formatOutcome(result)].join('\n');
}
