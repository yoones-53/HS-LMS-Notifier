import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LmsStore } from '../src/database/store.js';
import { LmsError, parseCourse } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { createLogger } from '../src/utils/logger.js';

const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const assignment = parseAssignment({ onclick: "fncModifyReport('1','N','1','Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/13 23:59', submission: '미제출', progress: '진행' }, course);
const options = { now: () => new Date('2026-10-06T12:00:00+09:00'), deliveryDelayMs: 0 };
const log = () => {};
const source: LmsSource = {
  courses: async () => [course], enter: async () => {},
  collect: async (_course, type) => ({ status: 'OK', items: type === 'ASSIGNMENT' ? [assignment] : [] }),
};

test('integrated first baseline silences even D-Day; repeat only sends one reminder', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  const send = async () => { calls++; return { status: 'SENT' as const }; };
  try {
    const first = await runMonitor(store, source, send, log, options);
    assert.equal(first.status, 'SUCCESS'); assert.equal(first.baseline, 1); assert.equal(calls, 0);
    const second = await runMonitor(store, source, send, log, options);
    assert.equal(second.newItems, 0); assert.equal(calls, 1);
    await runMonitor(store, source, send, log, options);
    assert.equal(calls, 1);
    assert.equal(store.db.prepare("SELECT count(*) n FROM monitor_runs WHERE status='SUCCESS'").get()?.n, 3);
  } finally { store.close(); }
});
test('one failed course does not stop the next; a failed scope cannot send stale reminders', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  const send = async () => { calls++; return { status: 'SENT' as const }; };
  try {
    await runMonitor(store, source, send, log, options);
    const broken: LmsSource = { ...source,
      courses: async () => [{ ...course, courseId: 'BROKEN' }, course],
      enter: async c => { if (c.courseId === 'BROKEN') throw new Error('private error must not reach logs'); },
      collect: async (c, type) => { if (type === 'ASSIGNMENT') throw new Error('unavailable'); return source.collect(c, type); },
    };
    const result = await runMonitor(store, broken, send, log, options);
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.code, 'COURSE_PARTIAL_FAILURE'); assert.equal(result.failures, 2); assert.equal(calls, 0);
    assert.equal(store.db.prepare('SELECT count(*) n FROM scope_baselines').get()?.n, 4);
  } finally { store.close(); }
});
test('expired auth stops crawling, records a separate status and only notifies once until recovery', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  const send = async () => { calls++; return { status: 'SENT' as const }; };
  const expired = { ...source, courses: async () => { throw new LmsError('AUTH_EXPIRED'); } };
  try {
    assert.equal((await runMonitor(store, expired, send, log, options)).status, 'AUTH_EXPIRED_DURING_CRAWL');
    await runMonitor(store, expired, send, log, options); assert.equal(calls, 1);
    await runMonitor(store, source, send, log, options);
    await runMonitor(store, expired, send, log, options); assert.equal(calls, 2);
    assert.equal(store.db.prepare("SELECT count(*) n FROM monitor_runs WHERE status='AUTH_EXPIRED_DURING_CRAWL'").get()?.n, 3);
  } finally { store.close(); }
});
test('safe logger omits URL-shaped values instead of serializing raw exceptions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hs-logs-test-'));
  try {
    createLogger(directory, () => {})('RUN_FAILED', { reason: 'https://example.invalid/?secret=not-real', count: 1, password: 'SYNTHETIC_PASSWORD_SENTINEL' });
    const text = readFileSync(join(directory, readdirSync(directory)[0]!), 'utf8');
    assert.ok(text.includes('[omitted]')); assert.ok(!text.includes('secret='));
    assert.ok(!text.includes('SYNTHETIC_PASSWORD_SENTINEL'));
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
