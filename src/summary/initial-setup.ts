import type { Course } from '../crawler/courses.js';
import { daysUntil } from '../detector/deadlines.js';
import { courseKey, itemKey, type LmsItem } from '../model.js';
import { assignmentState, lectureState, lectureSatisfied } from '../model/task-state.js';

export interface SummaryDeadline {
  itemKey: string; type: 'ASSIGNMENT' | 'VIDEO'; courseName: string;
  title: string; dueAt: string; days: number;
}
export interface InitialSetupSummary {
  authenticationStatus: 'OK'; courseCount: number;
  noticeCount: number; materialCount: number; assignmentCount: number; onlineLectureCount: number;
  pendingAssignmentCount: number | null; knownPendingAssignmentCount: number; unknownAssignmentCount: number;
  incompleteLectureCount: number | null; knownIncompleteLectureCount: number; unknownLectureCount: number;
  attendanceConfirmedLectureCount: number; excludedOnlineRowCount: number;
  upcomingDeadlines: SummaryDeadline[]; additionalDeadlineCount: number;
}

// Pure, reusable GUI data. The caller supplies only this run's authenticated, fully collected snapshot.
export function buildInitialSetupSummary(courses: Course[], snapshot: LmsItem[], now: Date,
  excludedOnlineRowCount = 0): InitialSetupSummary {
  const active = new Map(courses.map(c => [courseKey(c), c]));
  const items = [...new Map(snapshot.filter(i => active.has(courseKey(i))).map(i => [itemKey(i), i])).values()];
  const assignments = items.filter(i => i.type === 'ASSIGNMENT');
  const lectures = items.filter(i => i.type === 'VIDEO');
  const knownPendingAssignmentCount = assignments.filter(i => assignmentState(i) === 'PENDING').length;
  const unknownAssignmentCount = assignments.filter(i => assignmentState(i) === 'UNKNOWN').length;
  const knownIncompleteLectureCount = lectures.filter(i => lectureState(i) === 'PENDING').length;
  // Attendance is not a viewing-completion signal, even when every lecture has attendance credit.
  const unknownLectureCount = lectures.filter(i => lectureState(i) === 'UNKNOWN').length;
  const deadlines = items.flatMap((item): SummaryDeadline[] => {
    if (item.type !== 'ASSIGNMENT' && item.type !== 'VIDEO') return [];
    if (item.type === 'ASSIGNMENT' ? assignmentState(item) !== 'PENDING' : lectureState(item) !== 'PENDING' || lectureSatisfied(item)) return [];
    if (!item.dueAt || !Number.isFinite(Date.parse(item.dueAt)) || Date.parse(item.dueAt) <= now.getTime()) return [];
    const days = daysUntil(item.dueAt, now);
    if (days === null || days < 0 || days > 7) return [];
    return [{ itemKey: itemKey(item), type: item.type, courseName: active.get(courseKey(item))!.name,
      title: item.title, dueAt: item.dueAt, days }];
  }).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.itemKey.localeCompare(b.itemKey));
  return { authenticationStatus: 'OK', courseCount: active.size,
    noticeCount: items.filter(i => i.type === 'NOTICE').length, materialCount: items.filter(i => i.type === 'MATERIAL').length,
    assignmentCount: assignments.length, onlineLectureCount: lectures.length,
    pendingAssignmentCount: unknownAssignmentCount ? null : knownPendingAssignmentCount, knownPendingAssignmentCount, unknownAssignmentCount,
    incompleteLectureCount: unknownLectureCount ? null : knownIncompleteLectureCount, knownIncompleteLectureCount, unknownLectureCount,
    attendanceConfirmedLectureCount: lectures.filter(i => i.attendanceConfirmed === true).length, excludedOnlineRowCount,
    upcomingDeadlines: deadlines.slice(0, 5), additionalDeadlineCount: Math.max(0, deadlines.length - 5) };
}
