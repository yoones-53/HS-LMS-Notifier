import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LmsStore, fingerprint } from '../src/database/store.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseOnlineRow } from '../src/crawler/videos.js';
import type { ScopeSnapshot } from '../src/model.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const notice = parseBoardRow({ id: '1', title: '같은 제목', date: '2026.10.06' }, course, 'NOTICE');
const scopes: ScopeSnapshot[] = [
  { course, type: 'NOTICE', items: [notice] },
  { course, type: 'MATERIAL', items: [parseBoardRow({ id: '1', title: '합성 자료', date: null }, course, 'MATERIAL')] },
  { course, type: 'ASSIGNMENT', items: [parseAssignment({ onclick: "fncModifyReport('1', 'N', '1', 'Y','Y')", title: '합성 과제', period: null, submission: null, progress: null }, course)] },
  { course, type: 'VIDEO', items: [parseOnlineRow({ id: '1', contentId: 'TEST_W', title: '합성 영상', period: null, status: null }, course)!] },
];
test('baseline of all four item types is silent; repeated data yields zero new items', () => {
  const store = new LmsStore(':memory:');
  try {
    const first = store.sync([course], scopes);
    assert.equal(first.baseline, 4); assert.equal(first.newItems, 0); assert.equal(first.changes.length, 0);
    const second = store.sync([course], scopes);
    assert.equal(second.unchanged, 4); assert.equal(second.newItems, 0); assert.equal(second.changes.length, 0);
    assert.equal(store.items().length, 4); assert.equal(store.notificationCount(), 0);
  } finally { store.close(); }
});
test('stable identifiers distinguish equal titles and modifications; invalid batches roll back', () => {
  const store = new LmsStore(':memory:');
  try {
    store.sync([course], [scopes[0]!]);
    const changed = store.sync([course], [{ course, type: 'NOTICE', items: [{ ...notice, title: '수정' }, { ...notice, itemId: '2' }] }]);
    assert.equal(changed.updated, 1); assert.equal(changed.newItems, 1);
    assert.equal(changed.changes[0]?.version, 2);
    assert.throws(() => store.sync([course], [{ course, type: 'NOTICE', items: [notice, notice] }]));
    assert.equal(store.items().length, 2);
    assert.equal(store.items().find(i => i.itemId === '1')?.title, '수정');
  } finally { store.close(); }
});
test('a previously unavailable scope gets its own silent baseline later', () => {
  const store = new LmsStore(':memory:');
  try {
    store.sync([course], [scopes[0]!]);
    const later = store.sync([course], [scopes[1]!]);
    assert.equal(later.baseline, 1); assert.equal(later.newItems, 0);
    assert.equal(fingerprint(notice), fingerprint(Object.fromEntries(Object.entries(notice).reverse()) as typeof notice));
  } finally { store.close(); }
});
