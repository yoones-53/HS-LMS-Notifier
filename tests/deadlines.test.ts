import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysUntil, deadlineReminders } from '../src/detector/deadlines.js';
import { deadlinePayload, notifyDeadlines } from '../src/notification/deadlines.js';
import { LmsStore } from '../src/database/store.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseOnlineRow } from '../src/crawler/videos.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const assignment = parseAssignment({ onclick: "fncModifyReport('1', 'N', '1', 'Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/13 23:59', submission: '미제출', progress: '진행' }, course);
const video = parseOnlineRow({ id: '1', contentId: 'TEST_W', title: '합성 영상', period: '2026.10.01 00:00 ~ 2026.10.13 23:59', status: '미진행' }, course)!;
test('D-7/D-3/D-1/D-Day each follow Korean calendar dates and not 24h rounding', () => {
  for (const [date, expected] of [['2026-10-06', 7], ['2026-10-10', 3], ['2026-10-12', 1], ['2026-10-13', 0]] as const) {
    const result = deadlineReminders([assignment, video], new Date(`${date}T12:00:00+09:00`));
    assert.equal(result.length, 2); assert.ok(result.every(r => r.days === expected));
    assert.ok(deadlinePayload(result[0]!, course.name).embeds[0]?.fields?.some(f => f.name === '과목'));
  }
  assert.equal(daysUntil('2026-10-07T00:01:00+09:00', new Date('2026-10-06T23:59:00+09:00')), 1);
  assert.equal(daysUntil('2026-10-07T23:59:00+09:00', new Date('2026-10-06T15:00:00Z')), 0);
});
test('submitted, attendance-complete, missing and elapsed deadlines are excluded; unknown status is not completion', () => {
  const now = new Date('2026-10-06T12:00:00+09:00');
  assert.equal(deadlineReminders([{ ...assignment, submitted: true }, { ...video, attendanceConfirmed: true }, { ...video, completed: true }, { ...assignment, dueAt: null }, { ...assignment, dueAt: '2026-10-06T11:59:00+09:00' }], now).length, 0);
  assert.equal(deadlineReminders([{ ...assignment, submitted: null }, video], now).length, 2);
  assert.equal(deadlineReminders([assignment], new Date('2026-10-07T12:00:00+09:00')).length, 0);
});
test('notification history suppresses the same item and D-Day across consecutive executions', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  try {
    const send = async () => { calls++; return { status: 'SENT' as const }; };
    const reminders = deadlineReminders([assignment, video], new Date('2026-10-06T12:00:00+09:00'));
    assert.equal((await notifyDeadlines(store, reminders, send, 0)).sent, 2);
    assert.equal((await notifyDeadlines(store, reminders, send, 0)).sent, 0);
    assert.equal(calls, 2);
    const afterExtension = deadlineReminders([{ ...assignment, dueAt: '2026-10-14T23:59:00+09:00' }], new Date('2026-10-07T12:00:00+09:00'));
    assert.equal(afterExtension[0]?.key, reminders[0]?.key);
  } finally { store.close(); }
});
