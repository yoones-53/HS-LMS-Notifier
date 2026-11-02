import type { ChangeEvent } from '../detector/changes.js';
import { MY_LECTURES_URL } from '../utils/config.js';
import type { DiscordPayload } from './discord.js';

export const safeText = (value: string, limit = 700): string => value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/([\\`*_{}\[\]()<>|~])/g, '\\$1').slice(0, limit);
export function koreanTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '확인 불가';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (한국 시간)`;
}
export function changePayload(event: ChangeEvent, courseName: string): DiscordPayload {
  const labels: Record<ChangeEvent['type'], string> = { NEW_NOTICE: '📢 새 공지', NEW_MATERIAL: '📚 새 강의자료', NEW_ASSIGNMENT: '📝 새 과제', NEW_VIDEO: '🎬 새 온라인 강의', ASSIGNMENT_UPDATED: '📝 과제 변경', DEADLINE_CHANGED: '📅 마감 변경', VIDEO_COMPLETED: '✅ LMS 출석완료 확인' };
  const item = event.item;
  const fields = [{ name: '과목', value: safeText(courseName, 200) }];
  if ('dueAt' in item) fields.push({ name: '마감', value: koreanTime(item.dueAt) });
  if (item.type === 'ASSIGNMENT') fields.push({ name: '제출 상태', value: safeText(item.submissionStatus ?? '확인 불가', 100) });
  if (item.type === 'VIDEO') fields.push({ name: '학습 상태', value: safeText(item.statusRaw ?? '확인 불가', 100) });
  return { allowed_mentions: { parse: [] }, embeds: [{ title: labels[event.type],
    description: `${safeText(item.title)}\n\n[LMS 강좌 목록에서 확인](${MY_LECTURES_URL})`, fields }] };
}
