import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LmsStore } from '../src/database/store.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { AppError, classifyError, printOutcome, RESULT_INFO } from '../src/utils/result.js';
import { parseCourse, LmsError } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const assignment = parseAssignment({ onclick: "fncModifyReport('1','N','1','Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/13 23:59', submission: '미제출', progress: '진행' }, course);
const source: LmsSource = { courses: async () => [course], enter: async () => {}, collect: async (_c, t) => ({ status: 'OK', items: t === 'ASSIGNMENT' ? [assignment] : [] }) };
const now = () => new Date('2026-10-06T12:00:00+09:00');
test('each run authenticates and closes; existing baseline/history and D-Day dedup survive fresh login', async () => {
  const store = new LmsStore(':memory:'); let logins = 0; let closes = 0; let sends = 0;
  const options = { now, deliveryDelayMs: 0, authenticate: async () => { logins++; }, dispose: async () => { closes++; } };
  const send = async () => { sends++; return { status: 'SENT' as const }; };
  try {
    const first = await runMonitor(store, source, send, () => {}, options);
    assert.equal(first.baseline, 1); assert.equal(first.sent, 1);
    assert.equal(first.initialSummary.status, 'SENT'); assert.equal(first.newItems, 0);
    await runMonitor(store, source, send, () => {}, options);
    const third = await runMonitor(store, source, send, () => {}, options);
    assert.equal(third.status, 'SUCCESS'); assert.equal(third.newItems, 0); assert.equal(third.sent, 0);
    assert.equal(third.loginMode, 'AUTO'); assert.ok(third.browserClosed);
    assert.equal(logins, 3); assert.equal(closes, 3); assert.equal(sends, 2); // one summary, one D-7
    assert.equal(store.notificationCount(), 2); assert.equal(store.items().length, 1);
    assert.equal(store.db.prepare('SELECT count(*) n FROM sync_history').get()?.n, 3);
    assert.equal(store.db.prepare("SELECT first_seen_kind FROM items").get()?.first_seen_kind, 'BASELINE');
  } finally { store.close(); }
});
test('authentication failure is sanitized, closes browser, preserves baseline and sends only once', async () => {
  const store = new LmsStore(':memory:'); let sends = 0; let closes = 0; let crawls = 0;
  const failing = { ...source, courses: async () => { crawls++; return [course]; } };
  try {
    store.sync([course], [{ course, type: 'ASSIGNMENT', items: [assignment] }]);
    const options = { now, authenticate: async () => { throw new AppError('AUTO_LOGIN_FAILED'); }, dispose: async () => { closes++; } };
    const send = async () => { sends++; return { status: 'SENT' as const }; };
    for (let i = 0; i < 2; i++) assert.equal((await runMonitor(store, failing, send, () => {}, options)).status, 'AUTO_LOGIN_FAILED');
    assert.equal(sends, 1); assert.equal(closes, 2); assert.equal(crawls, 0);
    assert.equal(store.items().length, 1); assert.equal(store.db.prepare('SELECT count(*) n FROM sync_history').get()?.n, 1);
  } finally { store.close(); }
});
test('structured statuses distinguish network/structure/database/unknown without raw exceptions', () => {
  assert.equal(classifyError(new Error('net::ERR_INTERNET_DISCONNECTED SYNTHETIC_SECRET')), 'NETWORK_ERROR');
  assert.equal(classifyError(new LmsError('STRUCTURE_CHANGED')), 'LMS_STRUCTURE_CHANGED');
  assert.equal(classifyError(Object.assign(new Error('SYNTHETIC_SECRET'), { errcode: 5 })), 'DATABASE_ERROR');
  assert.equal(classifyError(new Error('SYNTHETIC_SECRET')), 'UNKNOWN_ERROR');
  const output: string[] = [];
  for (const status of Object.keys(RESULT_INFO) as Array<keyof typeof RESULT_INFO>) printOutcome(status, s => output.push(s));
  assert.ok(!output.join('').includes('SYNTHETIC_SECRET'));
});
