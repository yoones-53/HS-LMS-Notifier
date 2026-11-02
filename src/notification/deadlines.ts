import { setTimeout as delay } from 'node:timers/promises';
import type { LmsStore } from '../database/store.js';
import type { DeadlineReminder } from '../detector/deadlines.js';
import { courseKey } from '../model.js';
import { MY_LECTURES_URL } from '../utils/config.js';
import type { DiscordPayload, Transport } from './discord.js';
import { sendOnce } from './delivery.js';
import { koreanTime, safeText } from './format.js';
import { deadlineEnabled, defaultDeadlineNotifications, type DeadlineNotifications } from '../runtime/settings.js';

export function deadlinePayload(reminder: DeadlineReminder, course: string): DiscordPayload {
  const { item, days } = reminder;
  const label = days === 0 ? 'D-Day' : `D-${days}`;
  return { allowed_mentions: { parse: [] }, embeds: [{ title: `⏰ ${label} 마감 알림`,
    description: `${safeText(item.title)}\n\n[LMS 강좌 목록에서 확인](${MY_LECTURES_URL})`, fields: [
      { name: '과목', value: safeText(course, 200) },
      { name: '종류', value: item.type === 'ASSIGNMENT' ? '과제' : '온라인 강의' },
      { name: '마감', value: koreanTime(item.dueAt) },
      { name: '남은 기간', value: days === 0 ? '오늘 마감 (D-Day)' : `${days}일 (한국 날짜 기준)` },
      { name: '제출 / 학습 상태', value: safeText(item.type === 'ASSIGNMENT' ? item.submissionStatus ?? '확인 불가' : `${item.statusRaw ?? '확인 불가'} · 전체 시청 여부 확인 불가`, 250) },
    ] }] };
}
export async function notifyDeadlines(store: LmsStore, reminders: DeadlineReminder[], transport: Transport, delayMs = 1_100,
  settings: DeadlineNotifications = defaultDeadlineNotifications()): Promise<{ sent: number; deferred: number; uncertain: number }> {
  const result = { sent: 0, deferred: 0, uncertain: 0 };
  for (const reminder of reminders) {
    if (!deadlineEnabled(reminder.days, settings)) continue;
    if (result.sent >= 20) break;
    const name = store.db.prepare('SELECT name FROM courses WHERE course_key=?').get(courseKey(reminder.item))?.name;
    const status = await sendOnce(store, reminder.key, deadlinePayload(reminder, String(name ?? '과목 확인 필요')), transport);
    if (status === 'RETRY' || status === 'DEFERRED') { result.deferred++; break; }
    if (status === 'UNKNOWN') { result.uncertain++; break; }
    if (status === 'SENT') { result.sent++; await delay(delayMs); }
  }
  return result;
}
