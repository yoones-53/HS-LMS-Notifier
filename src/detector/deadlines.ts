import type { Assignment } from '../crawler/assignments.js';
import type { OnlineLecture } from '../crawler/videos.js';
import { itemKey, type LmsItem } from '../model.js';
import { assignmentState, lectureSatisfied } from '../model/task-state.js';
export interface DeadlineReminder { key: string; days: number; item: Assignment | OnlineLecture }

function koreanDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000;
}
export function daysUntil(due: string, now: Date): number | null {
  const timestamp = Date.parse(due);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now.getTime())) return null;
  return koreanDay(new Date(timestamp)) - koreanDay(now);
}
export function deadlineReminders(items: LmsItem[], now: Date): DeadlineReminder[] {
  return items.flatMap(item => {
    if (item.type !== 'ASSIGNMENT' && item.type !== 'VIDEO') return [];
    if (item.type === 'ASSIGNMENT' && assignmentState(item) === 'COMPLETE') return [];
    if (item.type === 'VIDEO' && lectureSatisfied(item)) return [];
    if (!item.dueAt || !Number.isFinite(Date.parse(item.dueAt)) || Date.parse(item.dueAt) <= now.getTime()) return [];
    const days = daysUntil(item.dueAt, now);
    if (days === null || ![7, 3, 1, 0].includes(days)) return [];
    return [{ key: `deadline:${itemKey(item)}:D-${days}`, days, item }];
  });
}
