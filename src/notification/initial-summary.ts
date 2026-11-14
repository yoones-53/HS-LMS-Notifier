import type { LmsStore } from '../database/store.js';
import type { InitialSetupSummary } from '../summary/initial-setup.js';
import type { Log } from '../utils/logger.js';
import type { DiscordPayload, Transport } from './discord.js';
import { sendOnce, type SendStatus } from './delivery.js';
import { koreanTime, safeText } from './format.js';

// The pair (notification_key=INITIAL_SETUP_SUMMARY, status=SENT) is INITIAL_SETUP_SUMMARY_SENT.
export const INITIAL_SUMMARY_KEY = 'INITIAL_SETUP_SUMMARY';
export interface InitialSummaryOutcome {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  reason: 'ALREADY_SENT' | 'INCOMPLETE_SYNC' | 'NOT_AUTO_LOGIN' | 'AUTHENTICATION_NOT_CONFIRMED'
    | 'DISCORD_SEND_FAILED' | 'DISCORD_NOT_CONFIGURED' | 'RETRY_AFTER' | 'DELIVERY_UNCONFIRMED' | null;
  delivery: SendStatus | null;
}
function pendingLabel(total: number | null, known: number, unknown: number): string {
  if (total !== null) return `${total}개`;
  return known ? `${known}개 확인 / 그 외 ${unknown}개 상태 확인 불가` : `확인 불가 (상태 미확인 ${unknown}개)`;
}
export function initialSummaryPayload(summary: InitialSetupSummary): DiscordPayload {
  const deadlines = summary.upcomingDeadlines.map(d =>
    `• [${safeText(d.courseName, 50)}] ${safeText(d.title, 65)} (${d.type === 'ASSIGNMENT' ? '과제' : '온라인 강의'}) — ${d.days === 0 ? 'D-Day' : `D-${d.days}`} / ${koreanTime(d.dueAt)}`);
  if (summary.additionalDeadlineCount) deadlines.push(`외 ${summary.additionalDeadlineCount}개`);
  const unknown = summary.unknownAssignmentCount + summary.unknownLectureCount > 0;
  return { allowed_mentions: { parse: [] }, embeds: [{ title: '✅ 한신 LMS 알리미 연동 완료',
    description: 'LMS 로그인이 정상적으로 확인되었습니다. 현재 수집된 항목을 요약합니다. 기존 항목은 개별 신규 알림으로 보내지 않습니다.',
    fields: [
      { name: '수집 현황', value: `수강 과목: ${summary.courseCount}개\n공지사항: ${summary.noticeCount}개\n강의자료: ${summary.materialCount}개\n과제: ${summary.assignmentCount}개\n온라인 강의: ${summary.onlineLectureCount}개` },
      { name: '📌 현재 확인이 필요한 항목', value: `미제출 과제: ${pendingLabel(summary.pendingAssignmentCount, summary.knownPendingAssignmentCount, summary.unknownAssignmentCount)}\n미완료 온라인 강의: ${pendingLabel(summary.incompleteLectureCount, summary.knownIncompleteLectureCount, summary.unknownLectureCount)}\nLMS 출석완료 표시: ${summary.attendanceConfirmedLectureCount}개 (시청 완료 여부와 별개)` },
      { name: '⏰ 가까운 마감 — 오늘부터 D-7', value: (deadlines.join('\n') || '확인된 미제출/미완료 항목 중 해당 기간의 마감이 없습니다.')
        + (unknown ? '\n※ 완료 상태를 알 수 없는 항목은 이 목록에서 제외했습니다.' : '') },
      { name: '앞으로의 알림', value: '이후부터는 새로운 공지·자료·과제·온라인 강의와 마감 임박 항목이 있을 때 알려드립니다.' },
    ], footer: { text: `한국 시간 기준 · 안정적인 ID가 없는 예정 온라인 강의 ${summary.excludedOnlineRowCount}개 제외` } }] };
}

export async function notifyInitialSummary(store: LmsStore, summary: InitialSetupSummary, transport: Transport,
  log: Log, now = new Date()): Promise<InitialSummaryOutcome> {
  const previous = store.db.prepare('SELECT status FROM notification_history WHERE notification_key=?').get(INITIAL_SUMMARY_KEY);
  if (previous?.status === 'SENT') {
    log('INITIAL_SUMMARY', { status: 'SKIPPED', reason: 'ALREADY_SENT' });
    return { status: 'SKIPPED', reason: 'ALREADY_SENT', delivery: 'SKIPPED' };
  }
  log('INITIAL_SUMMARY', { status: 'CREATED' });
  const delivery = await sendOnce(store, INITIAL_SUMMARY_KEY, initialSummaryPayload(summary), transport, now);
  if (delivery === 'SENT') {
    log('INITIAL_SUMMARY', { status: 'SENT' });
    return { status: 'SENT', reason: null, delivery };
  }
  if (delivery === 'SKIPPED') {
    log('INITIAL_SUMMARY', { status: 'SKIPPED', reason: 'ALREADY_SENT' });
    return { status: 'SKIPPED', reason: 'ALREADY_SENT', delivery };
  }
  const reason = delivery === 'UNKNOWN' ? 'DELIVERY_UNCONFIRMED' : delivery === 'DEFERRED' ? 'RETRY_AFTER' : 'DISCORD_SEND_FAILED';
  log('INITIAL_SUMMARY', { status: 'FAILED', reason });
  return { status: 'FAILED', reason, delivery };
}
