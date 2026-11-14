import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseOnlineRow } from '../src/crawler/videos.js';
import { LmsStore } from '../src/database/store.js';
import { daysUntil } from '../src/detector/deadlines.js';
import type { LmsItem, ScopeSnapshot } from '../src/model.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { sendOnce } from '../src/notification/delivery.js';
import type { DiscordPayload, Transport } from '../src/notification/discord.js';
import { INITIAL_SUMMARY_KEY, initialSummaryPayload, notifyInitialSummary } from '../src/notification/initial-summary.js';
import { buildInitialSetupSummary } from '../src/summary/initial-setup.js';
import { AppError } from '../src/utils/result.js';
import type { Log } from '../src/utils/logger.js';

const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const assignment = parseAssignment({ onclick: "fncModifyReport('1','N','1','Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/09 23:59', submission: '미제출', progress: '진행' }, course);
const video = parseOnlineRow({ id: '1', contentId: null, title: '합성 영상', period: '2026.10.01 00:00 ~ 2026.10.09 23:59', status: '미진행' }, course)!;
const notice = parseBoardRow({ id: '1', title: '합성 공지', date: null }, course, 'NOTICE');
const material = parseBoardRow({ id: '1', title: '합성 자료', date: null }, course, 'MATERIAL');
const snapshot: LmsItem[] = [notice, material, assignment, video];
const now = new Date('2026-10-07T12:00:00+09:00');
const options = { now: () => now, authenticate: async () => {}, deliveryDelayMs: 0 };
const sourceFor = (items: LmsItem[] = snapshot): LmsSource => ({ courses: async () => [course], enter: async () => {},
  collect: async (_c, type) => ({ status: 'OK', items: items.filter(i => i.type === type) }) });
const scopes: ScopeSnapshot[] = (['NOTICE','MATERIAL','ASSIGNMENT','VIDEO'] as const).map(type => ({ course, type, items: snapshot.filter(i => i.type === type) }));
const summary = () => buildInitialSetupSummary([course], snapshot, now);
const history = (store: LmsStore) => store.db.prepare('SELECT * FROM notification_history WHERE notification_key=?').get(INITIAL_SUMMARY_KEY);

test('summary builder counts actual items and known pending states; unknown is never zero or incomplete', () => {
  const result = buildInitialSetupSummary([course], [notice, material, assignment,
    { ...assignment, itemId: '2:1', submitted: true }, { ...assignment, itemId: '3:1', submitted: null },
    { ...video, itemId: '1', completed: true }, { ...video, itemId: '2', completed: false },
    { ...video, itemId: '3', attendanceConfirmed: true }, { ...video, itemId: '4' }], now);
  assert.deepEqual([result.courseCount,result.noticeCount,result.materialCount,result.assignmentCount,result.onlineLectureCount], [1,1,1,3,4]);
  assert.equal(result.pendingAssignmentCount, null); assert.equal(result.knownPendingAssignmentCount, 1);
  assert.equal(result.unknownAssignmentCount, 1); assert.equal(result.incompleteLectureCount, null);
  assert.equal(result.knownIncompleteLectureCount, 1); assert.equal(result.unknownLectureCount, 2);
  assert.equal(result.attendanceConfirmedLectureCount, 1);
  assert.equal(result.upcomingDeadlines.length, 2); // only explicit false; attendance != viewing completion
  assert.deepEqual(buildInitialSetupSummary([course], [{ ...assignment, submitted: true }, { ...video, completed: true }], now).upcomingDeadlines, []);
  assert.equal(buildInitialSetupSummary([course], [{ ...video, attendanceConfirmed: true }], now).incompleteLectureCount, null);
});

test('summary deadlines reuse Korean days, exclude elapsed/unknown/completed, sort and cap at five', () => {
  const data: LmsItem[] = Array.from({ length: 9 }, (_, day) => ({ ...assignment, itemId: String(day), dueAt: `2026-10-${String(7 + day).padStart(2, '0')}T23:59:00+09:00` }));
  data.push({ ...assignment, itemId: 'expired', dueAt: '2026-10-07T11:59:00+09:00' },
    { ...assignment, itemId: 'missing', dueAt: null }, { ...assignment, itemId: 'invalid', dueAt: 'invalid' },
    { ...assignment, itemId: 'unknown', submitted: null }, { ...assignment, itemId: 'done', submitted: true },
    { ...video, completed: false, attendanceConfirmed: true });
  const result = buildInitialSetupSummary([course], data.reverse(), now);
  assert.deepEqual(result.upcomingDeadlines.map(d => d.days), [0,1,2,3,4]);
  assert.equal(result.additionalDeadlineCount, 3); // D-0 through D-7, not D-8
  assert.ok(result.upcomingDeadlines.every(d => d.days === daysUntil(d.dueAt, now)));
  assert.equal(buildInitialSetupSummary([course], [{ ...assignment, dueAt: '2026-10-08T00:01:00+09:00' }], new Date('2026-10-07T23:59:00+09:00')).upcomingDeadlines[0]?.days, 1);
});

test('Discord summary is bounded, escaped, mention-safe, and says unknown instead of zero', () => {
  const data = Array.from({ length: 9 }, (_, i) => ({ ...assignment, itemId: String(i), title: '@everyone **' + '과제'.repeat(400) }));
  const result = buildInitialSetupSummary([{ ...course, name: '[긴 과목]'.repeat(200) }], [...data, video], now, 55);
  const payload = initialSummaryPayload(result);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const embed = payload.embeds[0]!;
  assert.equal(embed.title, '✅ 한신 LMS 알리미 연동 완료');
  assert.ok(embed.fields!.every(f => f.value.length <= 1024));
  assert.ok(JSON.stringify(payload).length < 6000);
  assert.ok(embed.fields![1]!.value.includes('미완료 온라인 강의: 확인 불가'));
  assert.ok(embed.fields![2]!.value.includes('외 4개'));
  assert.ok(embed.fields![2]!.value.includes('상태를 알 수 없는 항목은'));
  assert.ok(embed.fields![2]!.value.includes('\\*\\*'));
});

test('fresh baseline sends exactly one summary, creates no NEW events, and logs the skip on repeat', async () => {
  const store = new LmsStore(':memory:'); const messages: DiscordPayload[] = []; const entries: Array<{ code: string; status?: string | number; reason?: string | number }> = [];
  const send: Transport = async p => { messages.push(p); return { status: 'SENT' }; };
  const log: Log = (code, fields = {}) => { entries.push({ code, ...fields }); };
  try {
    const first = await runMonitor(store, sourceFor(), send, log, options);
    assert.equal(first.status, 'SUCCESS'); assert.equal(first.baseline, 4); assert.equal(first.sent, 1);
    assert.equal(first.initialSummary.status, 'SENT'); assert.equal(messages.length, 1);
    assert.deepEqual(store.events(), []); assert.equal(first.newItems, 0);
    assert.equal(store.db.prepare("SELECT count(*) n FROM items WHERE first_seen_kind='BASELINE'").get()?.n, 4);
    assert.equal(history(store)?.status, 'SENT'); assert.ok(history(store)?.sent_at);
    const second = await runMonitor(store, sourceFor(), send, log, options);
    assert.equal(second.initialSummary.reason, 'ALREADY_SENT'); assert.equal(second.changes, 0); assert.equal(second.sent, 0);
    assert.equal(messages.length, 1); assert.equal(history(store)?.attempts, 1);
    assert.deepEqual(entries.filter(e => e.code === 'INITIAL_SUMMARY').map(e => [e.status, e.reason]), [['CREATED',undefined],['SENT',undefined],['SKIPPED','ALREADY_SENT']]);
  } finally { store.close(); }
});

test('existing baseline gets one summary without changing original notification or sync history', async () => {
  const store = new LmsStore(':memory:'); let sends = 0;
  try {
    store.sync([course], scopes, now.toISOString());
    await sendOnce(store, 'existing-notice', initialSummaryPayload(summary()), async () => ({ status: 'SENT' }), now);
    const previous = store.db.prepare('SELECT * FROM notification_history').all();
    const previousSync = store.db.prepare('SELECT * FROM sync_history').all();
    const result = await runMonitor(store, sourceFor(), async () => { sends++; return { status: 'SENT' }; }, () => {}, options);
    assert.equal(result.initialSummary.status, 'SENT'); assert.equal(sends, 1); assert.equal(result.baseline, 0); assert.equal(result.newItems, 0);
    assert.deepEqual(store.events(), []);
    assert.deepEqual(store.db.prepare("SELECT * FROM notification_history WHERE notification_key='existing-notice'").all(), previous);
    assert.deepEqual(store.db.prepare('SELECT * FROM sync_history WHERE run_id=?').all(String(previousSync[0]!.run_id)), previousSync);
  } finally { store.close(); }
});

test('confirmed Discord rejection has no SENT marker, retries on a later run, and then stops', async () => {
  const store = new LmsStore(':memory:'); let attempts = 0; let clock = now;
  const send: Transport = async () => ++attempts === 1 ? { status: 'RETRY', retryAfterSeconds: 1800 } : { status: 'SENT' };
  const configured = { ...options, now: () => clock };
  try {
    const first = await runMonitor(store, sourceFor(), send, () => {}, configured);
    assert.equal(first.status, 'PARTIAL'); assert.equal(first.code, 'DISCORD_NOTIFICATION_FAILED'); assert.equal(first.initialSummary.reason, 'DISCORD_SEND_FAILED');
    assert.equal(history(store)?.status, 'RETRY'); assert.equal(history(store)?.sent_at, null); assert.equal(attempts, 1);
    const early = await runMonitor(store, sourceFor(), send, () => {}, configured);
    assert.equal(early.initialSummary.reason, 'RETRY_AFTER'); assert.equal(attempts, 1);
    clock = new Date(now.getTime() + 1800_000);
    assert.equal((await runMonitor(store, sourceFor(), send, () => {}, configured)).initialSummary.status, 'SENT');
    assert.equal(history(store)?.status, 'SENT'); assert.equal(history(store)?.attempts, 2);
    await runMonitor(store, sourceFor(), send, () => {}, configured); assert.equal(attempts, 2);
    assert.deepEqual(store.events(), []); assert.equal(store.items().length, 4);
  } finally { store.close(); }
});

for (const status of ['UNKNOWN','SENDING'] as const) test(`ambiguous ${status} cannot be marked SENT or blindly resent`, async () => {
  const store = new LmsStore(':memory:'); let attempts = 0;
  try {
    await notifyInitialSummary(store, summary(), async () => { attempts++; return { status: 'UNKNOWN' }; }, () => {}, now);
    if (status === 'SENDING') store.db.prepare("UPDATE notification_history SET status='SENDING' WHERE notification_key=?").run(INITIAL_SUMMARY_KEY);
    const result = await notifyInitialSummary(store, summary(), async () => { attempts++; return { status: 'SENT' }; }, () => {}, now);
    assert.equal(result.reason, 'DELIVERY_UNCONFIRMED'); assert.equal(history(store)?.status, status); assert.equal(attempts, 1);
  } finally { store.close(); }
});

test('partial sync waits for a complete run; unavailable menus are not collection failures', async () => {
  const store = new LmsStore(':memory:'); let sends = 0;
  const send: Transport = async () => { sends++; return { status: 'SENT' }; };
  const source = sourceFor();
  try {
    const partial = await runMonitor(store, { ...source, collect: async (c, t) => {
      if (t === 'MATERIAL') throw new Error('synthetic failure'); return source.collect(c, t);
    } }, send, () => {}, options);
    assert.equal(partial.initialSummary.reason, 'INCOMPLETE_SYNC'); assert.equal(sends, 0); assert.equal(history(store), undefined);
    const full = await runMonitor(store, { ...source, collect: async (c,t) => t === 'MATERIAL' ? { status: 'UNAVAILABLE', items: [] } : source.collect(c,t) }, send, () => {}, options);
    assert.equal(full.initialSummary.status, 'SENT'); assert.equal(sends, 1); assert.equal(full.newItems, 0);
  } finally { store.close(); }
});

test('failed authentication or DB sync cannot send the initial summary', async () => {
  for (const failure of ['auth','db']) {
    const store = new LmsStore(':memory:'); const messages: DiscordPayload[] = [];
    try {
      const result = await runMonitor(store, sourceFor(failure === 'db' ? [...snapshot,notice] : snapshot), async p => { messages.push(p); return { status: 'SENT' }; }, () => {}, {
        ...options, authenticate: async () => { if (failure === 'auth') throw new AppError('AUTO_LOGIN_FAILED'); },
      });
      assert.equal(result.status, failure === 'auth' ? 'AUTO_LOGIN_FAILED' : 'DATABASE_ERROR');
      assert.equal(history(store), undefined); assert.ok(messages.every(p => p.embeds[0]?.title !== '✅ 한신 LMS 알리미 연동 완료'));
    } finally { store.close(); }
  }
});

test('normal NEW_NOTICE events stay independent and retain dedup after the summary', async () => {
  const store = new LmsStore(':memory:'); const messages: DiscordPayload[] = [];
  const send: Transport = async p => { messages.push(p); return { status: 'SENT' }; };
  try {
    await runMonitor(store, sourceFor(), send, () => {}, options);
    const changed = sourceFor([...snapshot, { ...notice, itemId: '2' }]);
    const result = await runMonitor(store, changed, send, () => {}, options);
    assert.equal(result.newItems, 1); assert.equal(result.changes, 1); assert.equal(result.sent, 1);
    assert.equal(result.initialSummary.reason, 'ALREADY_SENT');
    await runMonitor(store, changed, send, () => {}, options);
    assert.equal(messages.length, 2); assert.equal(history(store)?.attempts, 1);
    assert.equal(store.events()[0]?.type, 'NEW_NOTICE');
  } finally { store.close(); }
});

test('summary SENT survives closing and reopening a database without resending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hs-summary-test-'));
  const path = join(directory, 'summary.sqlite'); let store = new LmsStore(path); let sends = 0;
  try {
    const send: Transport = async () => { sends++; return { status: 'SENT' }; };
    await runMonitor(store, sourceFor(), send, () => {}, options); store.close(); store = new LmsStore(path);
    assert.equal((await runMonitor(store, sourceFor(), send, () => {}, options)).initialSummary.reason, 'ALREADY_SENT');
    assert.equal(sends, 1);
  } finally {
    store.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'hs-summary-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
