import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from '../src/utils/config.js';
import { detectChanges } from '../src/detector/changes.js';
import { LmsStore } from '../src/database/store.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseOnlineRow } from '../src/crawler/videos.js';
import type { LmsItem, ScopeSnapshot } from '../src/model.js';

const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const notice = parseBoardRow({ id: '1', title: '합성 공지', date: null }, course, 'NOTICE');
const material = parseBoardRow({ id: '1', title: '합성 자료', date: null }, course, 'MATERIAL');
const assignment = parseAssignment({ onclick: "fncModifyReport('1', 'N', '1', 'Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/10 23:59', submission: '미제출', progress: '진행' }, course);
const video = parseOnlineRow({ id: '1', contentId: 'TEST_W', title: '합성 영상', period: '2026.10.01 00:00 ~ 2026.10.10 23:59', status: '미진행' }, course)!;
const at = '2026-10-06T00:00:00.000Z';
const changes = (before: LmsItem | null, after: LmsItem) => detectChanges({ before, after, version: 2 }, at);
test('all four new event types are distinct and stable', () => {
  for (const item of [notice, material, assignment, video]) {
    assert.equal(changes(null, item)[0]?.type, `NEW_${item.type}`);
    assert.deepEqual(changes(null, item), changes(null, item));
    assert.deepEqual(changes(item, { ...item }), []);
  }
});
test('assignment updates and deadline changes are distinguished without duplicate deadline-only update', () => {
  assert.deepEqual(changes(assignment, { ...assignment, title: '변경' }).map(e => e.type), ['ASSIGNMENT_UPDATED']);
  assert.deepEqual(changes(assignment, { ...assignment, submitted: true, submissionStatus: '제출' }).map(e => e.type), ['ASSIGNMENT_UPDATED']);
  const deadline = changes(assignment, { ...assignment, dueAt: '2026-10-11T23:59:00+09:00' });
  assert.deepEqual(deadline.map(e => e.type), ['DEADLINE_CHANGED']);
  assert.equal(deadline[0]?.previousDueAt, assignment.dueAt);
  assert.deepEqual(changes(assignment, { ...assignment, dueAt: null }), []);
});
test('only confirmed attendance completion emits a completion event; minor status changes do not', () => {
  assert.deepEqual(changes(video, { ...video, statusRaw: '학습중' }), []);
  assert.deepEqual(changes(video, { ...video, statusRaw: '출석완료', attendanceConfirmed: true }).map(e => e.type), ['VIDEO_COMPLETED']);
  const done = { ...video, attendanceConfirmed: true };
  assert.deepEqual(changes(done, done), []);
});
test('baseline has no events; persisted changes are atomic and never repeated for unchanged snapshots', () => {
  const store = new LmsStore(':memory:');
  try {
    const empty: ScopeSnapshot = { course, type: 'NOTICE', items: [] };
    assert.equal(store.sync([course], [empty]).events.length, 0);
    const full = { ...empty, items: [notice] };
    assert.equal(store.sync([course], [full]).events[0]?.type, 'NEW_NOTICE');
    assert.equal(store.sync([course], [full]).events.length, 0);
    assert.equal(store.events().length, 1);
    assert.throws(() => store.sync([course], [{ ...full, items: [notice, notice] }]));
    assert.equal(store.events().length, 1);
  } finally { store.close(); }
});

test('event identity survives closing and reopening a file database', async () => {
  const root = join(PROJECT_ROOT, 'work', 'database-tests');
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, 'db-'));
  const path = join(temp, 'synthetic.sqlite');
  let store = new LmsStore(path);
  try {
    store.sync([course], [{ course, type: 'MATERIAL', items: [] }]);
    const full: ScopeSnapshot = { course, type: 'MATERIAL', items: [material] };
    const first = store.sync([course], [full]);
    store.close();
    store = new LmsStore(path);
    assert.equal(store.sync([course], [full]).events.length, 0);
    assert.deepEqual(store.events().map(e => e.key), first.events.map(e => e.key));
  } finally {
    store.close();
    assert.ok(resolve(temp).startsWith(resolve(root) + sep));
    await rm(temp, { recursive: true, force: true });
  }
});
