import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSeoulDateTime, parseSeoulPeriod } from '../src/utils/dates.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseCourse } from '../src/crawler/courses.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
test('Korean timestamps use an explicit UTC+09 offset, independent of machine timezone', () => {
  for (const raw of ['26/10/14 23:59', '2026-10-14 23:59', '2026.10.14 23:59:00']) assert.equal(parseSeoulDateTime(raw, 2026), '2026-10-14T23:59:00+09:00');
  assert.equal(new Date(parseSeoulDateTime('26/10/14 23:59', 2026)!).toISOString(), '2026-10-14T14:59:00.000Z');
  assert.equal(parseSeoulDateTime('27/01/01 00:00', 2026), '2027-01-01T00:00:00+09:00');
});
test('invalid, ambiguous, missing, and inverted dates do not throw or invent deadlines', () => {
  for (const raw of [null, '', '미정', '2026.02.29 12:00', '2026.13.01 12:00', '2026.10.14 24:00', '2026.10.14', '50/01/01 00:00']) assert.equal(parseSeoulDateTime(raw, 2026), null);
  assert.equal(parseSeoulDateTime('2024.02.29 12:00', 2024), '2024-02-29T12:00:00+09:00');
  assert.equal(parseSeoulPeriod('26/10/10 00:00 ~ 미정', 2026).dateStatus, 'PARTIAL');
  assert.equal(parseSeoulPeriod('26/10/10 00:00 ~ 26/10/09 00:00', 2026).dueAt, null);
});
test('assignment ids include report sequence; unknown submission state stays unknown', () => {
  const row = { onclick: "fncModifyReport('100', 'N', '1', 'Y','Y')", title: '합성 과제', period: '26/09/23 00:00 ~ 26/10/14 23:59', submission: '미제출', progress: '진행' };
  assert.equal(parseAssignment(row, course).itemId, '100:1');
  assert.equal(parseAssignment(row, course).submitted, false);
  assert.equal(parseAssignment({ ...row, submission: '제출' }, course).submitted, true);
  assert.equal(parseAssignment({ ...row, submission: '새로운 상태', period: null }, course).submitted, null);
  assert.equal(parseAssignment({ ...row, period: null }, course).dueAt, null);
});
