import { z } from 'zod';
import { daysUntil } from '../detector/deadlines.js';
import { assignmentState, lectureSatisfied, lectureState } from '../model/task-state.js';

const text = z.string().min(1).max(2000);
const common = { courseId: text, classNo: text, itemId: text, title: text, dueAt: z.string().max(100).nullable().default(null) };
// Read only the task fields needed by the GUI, not arbitrary persisted properties.
export const todoSourceSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('ASSIGNMENT'), submitted: z.boolean().nullable().default(null) }),
  z.object({ ...common, type: z.literal('VIDEO'), completed: z.boolean().nullable().default(null), attendanceConfirmed: z.boolean().nullable().default(null) }),
]);
export type TodoSource = z.infer<typeof todoSourceSchema>;
const count = z.number().int().nonnegative();
export const todoItemSchema = z.object({ key: text, type: z.enum(['ASSIGNMENT','VIDEO']), courseName: text, title: text,
  state: z.enum(['PENDING','UNKNOWN']), dueAt: z.string().nullable(), deadlineLabel: text,
  days: z.number().int().nullable(), dayLabel: text }).strict();
export const todoDashboardSchema = z.object({ collectedAt: z.iso.datetime({ offset: true }).nullable(),
  coverage: z.enum(['COMPLETE','PARTIAL','NOT_COLLECTED']), pendingAssignments: count, incompleteLectures: count,
  unknown: count, nearest: z.string().nullable(), items: z.array(todoItemSchema).max(10000) }).strict();
export type TodoDashboard = z.infer<typeof todoDashboardSchema>;

export function todoDeadline(due: string | null, now: Date) {
  const fallback = { dueAt: null, deadlineLabel: '기한 확인 필요', days: null, dayLabel: 'D-Day 확인 필요' };
  if (!due) return fallback;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
  // Preserve date-only precision; the midnight value is used ONLY for calendar arithmetic.
  if (!(dateOnly ? z.iso.date() : z.iso.datetime({ offset: true })).safeParse(due).success) return fallback;
  const timestamp = dateOnly ? `${due}T00:00:00+09:00` : due;
  const days = daysUntil(timestamp, now);
  if (days === null) return fallback;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}) }).formatToParts(new Date(timestamp));
  const part = (name: string) => p.find(v => v.type === name)?.value;
  return { dueAt: due, deadlineLabel: `${part('month')}/${part('day')}${dateOnly ? '' : ` ${part('hour')}:${part('minute')}`}까지`,
    days, dayLabel: days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}` };
}

export function buildTodo(courses: Array<{ courseId: string; classNo: string; name: string }>, sources: TodoSource[], now: Date,
  collectedAt: string | null, coverage: TodoDashboard['coverage'] = 'COMPLETE'): TodoDashboard {
  const active = new Map(courses.map(c => [`${c.courseId}:${c.classNo}`, c.name]));
  const unique = new Map(sources.map(i => [`${i.courseId}:${i.classNo}:${i.type}:${i.itemId}`, i]));
  const items: TodoDashboard['items'] = [];
  for (const [key, item] of unique) {
    const courseName = active.get(`${item.courseId}:${item.classNo}`);
    if (!courseName) continue;
    const state = item.type === 'ASSIGNMENT' ? assignmentState(item) : lectureState(item);
    if (state === 'COMPLETE' || item.type === 'VIDEO' && lectureSatisfied(item)) continue;
    items.push({ key, type: item.type, courseName, title: item.title, state, ...todoDeadline(item.dueAt, now) });
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const time = (item: typeof items[number]) => item.dueAt ? Date.parse(item.dueAt.length === 10 ? `${item.dueAt}T00:00:00+09:00` : item.dueAt) : Infinity;
  items.sort((a,b) => (time(a) - time(b) || 0) || compare(a.type,b.type) || compare(a.courseName,b.courseName) || compare(a.title,b.title) || compare(a.key,b.key));
  return todoDashboardSchema.parse({ collectedAt, coverage, items,
    pendingAssignments: items.filter(i => i.type === 'ASSIGNMENT' && i.state === 'PENDING').length,
    incompleteLectures: items.filter(i => i.type === 'VIDEO' && i.state === 'PENDING').length,
    unknown: items.filter(i => i.state === 'UNKNOWN').length,
    nearest: items.find(i => i.state === 'PENDING' && i.days !== null && i.days >= 0)?.dayLabel ?? null });
}
