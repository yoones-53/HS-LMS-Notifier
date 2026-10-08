import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LmsStore } from '../src/database/store.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { LmsError } from '../src/crawler/courses.js';
import { AppError, classifyError } from '../src/utils/result.js';
import { createLogger, type LogFields } from '../src/utils/logger.js';
import { AUTH_CODES, checkpoint, exitCodeFor, issue, runResult, STATUS_INFO, type StatusCode } from '../src/status/model.js';
import { reportIncidents } from '../src/status/incidents.js';
import { formatMonitor, formatOutcome } from '../src/status/presentation.js';
import { publishResult } from '../src/status/output.js';
import { fixtureCourses as courses, fixtureSource as source, fixtureOptions as options } from './fixtures/status-source.js';
const sent = async () => ({ status: 'SENT' as const });
const quiet = () => {};

test('all catalog codes have stable, reusable messages and centralized compatible exit codes', () => {
  for (const code of Object.keys(STATUS_INFO) as StatusCode[]) {
    const value = runResult(code);
    assert.ok(value.title && value.reason && value.action); assert.ok(formatOutcome(value).includes(code));
    assert.equal(value.exitCode, AUTH_CODES.has(code) ? 2 : ['SUCCESS','SUCCESS_WITH_CHANGES','SCHEDULER_LOCKED'].includes(code) ? 0 : 1);
  }
  assert.equal(exitCodeFor('PARTIAL'), 1);
  assert.equal(classifyError(Object.assign(new Error('private timeout detail'), { name: 'TimeoutError' })), 'LMS_TIMEOUT');
  assert.equal(classifyError(new LmsError('STRUCTURE_CHANGED')), 'LMS_STRUCTURE_CHANGED');
});

test('unchanged SUCCESS, real new event SUCCESS_WITH_CHANGES, repeat SUCCESS; baseline/history preserved', async () => {
  const store = new LmsStore(':memory:'); let sends = 0;
  const send = async () => { sends++; return { status: 'SENT' as const }; };
  try {
    const first = await runMonitor(store, source, send, quiet, options);
    assert.equal(first.status, 'SUCCESS'); assert.equal(first.collectionStatus, 'SUCCESS');
    assert.equal(first.completedCourses, 2); assert.equal(first.exitCode, 0); assert.equal(sends, 0);
    const baseline = store.db.prepare('SELECT * FROM scope_baselines ORDER BY course_key,type').all();
    const item = parseBoardRow({ id: '1', title: '합성 신규 공지', date: null }, courses[0]!, 'NOTICE');
    const changed = { ...source, collect: async (c: typeof courses[number], type: string) => ({ status: 'OK' as const,
      items: c.courseId === courses[0]!.courseId && type === 'NOTICE' ? [item] : [] }) };
    const second = await runMonitor(store, changed, send, quiet, options);
    assert.equal(second.status, 'SUCCESS_WITH_CHANGES'); assert.equal(second.changes, 1); assert.equal(second.sent, 1);
    const third = await runMonitor(store, changed, send, quiet, options);
    assert.equal(third.status, 'SUCCESS'); assert.equal(third.changes, 0); assert.equal(sends, 1);
    assert.deepEqual(store.db.prepare('SELECT * FROM scope_baselines ORDER BY course_key,type').all(), baseline);
    assert.equal(store.notificationCount(), 1);
  } finally { store.close(); }
});

test('one NOTICE timeout is PARTIAL with course/scope detail, others continue, no first transient Discord alert', async () => {
  const store = new LmsStore(':memory:'); const visited: string[] = []; let sends = 0;
  try {
    const broken = { ...source, collect: async (c: typeof courses[number], type: string) => {
      visited.push(`${c.courseId}:${type}`);
      if (c.courseId === courses[0]!.courseId && type === 'NOTICE') throw Object.assign(new Error('secret=never-log'), { name: 'TimeoutError' });
      return { status: 'OK' as const, items: [] };
    } };
    const result = await runMonitor(store, broken, async () => { sends++; return { status: 'SENT' }; }, quiet, options);
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.code, 'COURSE_PARTIAL_FAILURE');
    assert.equal(result.collectionStatus, 'PARTIAL'); assert.equal(result.databaseStatus, 'SUCCESS');
    assert.equal(result.completedCourses, 1); assert.equal(result.failedCourses, 1); assert.equal(visited.length, 8);
    assert.equal(result.errors[0]?.courseName, '합성 과목 A'); assert.equal(result.errors[0]?.scope, 'NOTICE');
    assert.equal(result.errors[0]?.errorCode, 'LMS_TIMEOUT'); assert.equal(result.recoverable, true); assert.equal(sends, 0);
    assert.match(formatMonitor(result), /합성 과목 A \/ NOTICE — LMS_TIMEOUT/);
    assert.ok(!JSON.stringify(result).includes('secret='));
  } finally { store.close(); }
});

test('scope failure plus Discord failure retains BOTH problems; invalid webhook does not stop LMS/DB', async () => {
  const store = new LmsStore(':memory:'); let attempts = 0;
  try {
    const result = await runMonitor(store, { ...source, collect: async (_c, t) => {
      if (t === 'ASSIGNMENT') throw new LmsError('STRUCTURE_CHANGED'); return { status: 'OK', items: [] };
    } }, async () => { attempts++; return { status: 'SENT' }; }, quiet, { ...options, notificationAvailable: false });
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.collectionStatus, 'PARTIAL'); assert.equal(result.databaseStatus, 'SUCCESS');
    assert.equal(result.notificationStatus, 'FAILED'); assert.equal(attempts, 0);
    assert.deepEqual(new Set(result.errors.map(e => e.errorCode)), new Set(['LMS_STRUCTURE_CHANGED','DISCORD_NOTIFICATION_FAILED']));
    assert.match(formatMonitor(result), /Discord\s+: FAILED/);
    const full = await runMonitor(store, source, sent, quiet, { ...options, notificationAvailable: false });
    assert.equal(full.code, 'DISCORD_NOTIFICATION_FAILED'); assert.equal(full.collectionStatus, 'SUCCESS');
  } finally { store.close(); }
});

for (const code of ['CREDENTIALS_NOT_CONFIGURED','AUTO_LOGIN_FAILED','AUTO_LOGIN_REQUIRES_USER','NETWORK_ERROR','LMS_TIMEOUT','LMS_STRUCTURE_CHANGED','INITIALIZATION_ERROR'] as StatusCode[]) {
  test(`${code}: fixed result, closes browser, no crawler, no raw detail`, async () => {
    const store = new LmsStore(':memory:'); let closes = 0; let calls = 0;
    try {
      const result = await runMonitor(store, { ...source, courses: async () => { calls++; return courses; } }, sent, quiet, {
        ...options, authenticate: async () => { throw new AppError(code); }, dispose: async () => { closes++; },
      });
      assert.equal(result.status, code); assert.equal(result.exitCode, AUTH_CODES.has(code) ? 2 : 1);
      assert.equal(calls, 0); assert.equal(closes, 1); assert.equal(result.databaseStatus, 'NOT_RUN');
      assert.equal(store.items().length, 0);
    } finally { store.close(); }
  });
}

test('unavailable database at run initialization is DATABASE_ERROR and still disposes browser', async () => {
  const store = new LmsStore(':memory:'); store.close(); let closes = 0;
  const result = await runMonitor(store, source, sent, quiet, { ...options, dispose: async () => { closes++; } });
  assert.equal(result.status, 'DATABASE_ERROR'); assert.equal(result.databaseStatus, 'FAILED'); assert.equal(closes, 1);
});

test('authentication remains primary when its Discord alert fails; cleanup failure cannot report SUCCESS', async () => {
  const store = new LmsStore(':memory:');
  try {
    const rejected = await runMonitor(store, source, async () => ({ status: 'UNKNOWN' }), quiet, {
      ...options, authenticate: async () => { throw new AppError('AUTO_LOGIN_FAILED'); },
    });
    assert.equal(rejected.status, 'AUTO_LOGIN_FAILED'); assert.equal(rejected.notificationStatus, 'FAILED');
    assert.equal(rejected.exitCode, 2); assert.ok(rejected.errors.some(e => e.errorCode === 'DISCORD_NOTIFICATION_FAILED'));
    const cleanup = await runMonitor(store, source, sent, quiet, { ...options, dispose: async () => { throw new Error('private cleanup error'); } });
    assert.equal(cleanup.status, 'UNKNOWN_ERROR'); assert.equal(cleanup.browserClosed, false);
    assert.ok(cleanup.errors.some(e => e.scope === 'CLEANUP')); assert.ok(!JSON.stringify(cleanup).includes('private cleanup error'));
  } finally { store.close(); }
});

test('multiple structural failures keep all details but emit at most one error alert per run', async () => {
  const store = new LmsStore(':memory:'); let sends = 0;
  const send = async () => { sends++; return { status: 'SENT' as const }; };
  const issues = courses.map(c => issue('LMS_STRUCTURE_CHANGED', 'NOTICE', { id: c.courseId, name: c.name }));
  try {
    await reportIncidents(store, issues, new Set(), send, quiet, options.now()); assert.equal(sends, 1);
    await reportIncidents(store, issues, new Set(), send, quiet, options.now()); assert.equal(sends, 2);
    await reportIncidents(store, issues, new Set(), send, quiet, options.now()); assert.equal(sends, 2);
    assert.equal(JSON.parse(String(store.db.prepare("SELECT value FROM monitor_state WHERE key='status:incidents'").get()?.value)).length, 2);
  } finally { store.close(); }
});

test('all course navigation failures are fatal rather than SUCCESS/PARTIAL', async () => {
  const store = new LmsStore(':memory:');
  try {
    const result = await runMonitor(store, { ...source, enter: async () => { throw new AppError('NETWORK_ERROR'); } }, sent, quiet, options);
    assert.equal(result.status, 'NETWORK_ERROR'); assert.equal(result.collectionStatus, 'FAILED'); assert.equal(result.failedCourses, 2);
  } finally { store.close(); }
});

test('auth loss during a course aborts without relogin; a verified next run recovers the SAME scope', async () => {
  const store = new LmsStore(':memory:'); let sends = 0; const logs: string[] = [];
  const send = async () => { sends++; return { status: 'SENT' as const }; };
  const broken: LmsSource = { ...source, collect: async () => { throw new LmsError('AUTH_EXPIRED'); } };
  try {
    for (let i = 0; i < 2; i++) assert.equal((await runMonitor(store, broken, send, quiet, options)).code, 'AUTH_EXPIRED_DURING_CRAWL');
    assert.equal(sends, 1);
    await runMonitor(store, source, send, (code, f) => { if (code === 'RECOVERY') logs.push(JSON.stringify(f)); }, options);
    assert.ok(logs.some(s => s.includes('AUTH_EXPIRED_DURING_CRAWL')));
    await runMonitor(store, broken, send, quiet, options); assert.equal(sends, 2);
  } finally { store.close(); }
});

test('transient failures notify at third observation then six-hour cooldown; same auth error only once per episode', async () => {
  for (const code of ['LMS_TIMEOUT','AUTO_LOGIN_FAILED'] as const) {
    const store = new LmsStore(':memory:'); let sends = 0; let now = options.now(); const logs: Array<{ code: string; fields?: LogFields }> = [];
    const err = issue(code, 'AUTHENTICATION');
    const send = async () => { sends++; return { status: 'SENT' as const }; };
    const log = (code: string, fields: LogFields = {}) => { logs.push({ code, fields }); };
    try {
      for (let n = 0; n < 3; n++) {
        await reportIncidents(store, [err], new Set(), send, log, now);
        assert.equal(sends, code === 'AUTO_LOGIN_FAILED' || n === 2 ? 1 : 0);
      }
      now = new Date(now.getTime() + 30 * 60 * 1000);
      await reportIncidents(store, [err], new Set(), send, log, now); assert.equal(sends, 1);
      now = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      await reportIncidents(store, [err], new Set(), send, log, now); assert.equal(sends, code === 'LMS_TIMEOUT' ? 2 : 1);
      const before = sends;
      // Unchecked scopes are not falsely recovered by unrelated successes.
      await reportIncidents(store, [], new Set([checkpoint('DATABASE')]), send, log, now);
      assert.ok(!logs.some(l => l.code === 'RECOVERY'));
      await reportIncidents(store, [], new Set([checkpoint('AUTHENTICATION')]), send, log, now);
      assert.equal(sends, before); assert.ok(logs.some(l => l.code === 'RECOVERY'));
      for (let n = 0; n < 3; n++) await reportIncidents(store, [err], new Set(), send, log, now);
      assert.equal(sends, before + 1);
      assert.ok(store.db.prepare("SELECT value FROM monitor_state WHERE key='status:last-error'").get());
      assert.ok(store.db.prepare("SELECT value FROM monitor_state WHERE key='status:last-recovery'").get());
    } finally { store.close(); }
  }
});

test('error transport uncertainty never retries blindly or recurses; rejected sends can retry after retry_after', async () => {
  for (const delivery of ['UNKNOWN','RETRY'] as const) {
    const store = new LmsStore(':memory:'); let sends = 0; let now = options.now();
    const send = async () => { sends++; return delivery === 'UNKNOWN' ? { status: 'UNKNOWN' as const } : { status: 'RETRY' as const, retryAfterSeconds: 1800 }; };
    try {
      const errors = [issue('AUTO_LOGIN_FAILED', 'AUTHENTICATION'), issue('DISCORD_NOTIFICATION_FAILED', 'DISCORD')];
      await reportIncidents(store, errors, new Set(), send, quiet, now);
      await reportIncidents(store, errors, new Set(), send, quiet, now); assert.equal(sends, 1);
      now = new Date(now.getTime() + 1800_000);
      await reportIncidents(store, errors, new Set(), send, quiet, now); assert.equal(sends, delivery === 'UNKNOWN' ? 1 : 2);
      const rows = store.db.prepare('SELECT * FROM notification_history').all(); assert.equal(rows.length, 1);
    } finally { store.close(); }
  }
});

test('structured logs/published summaries never serialize arbitrary exception, password, webhook or cookie fields', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hs-status-test-'));
  try {
    const error = issue('LMS_TIMEOUT', 'NOTICE', { id: 'TEST1:A', name: '합성 과목 A' });
    const result = Object.assign(runResult('COURSE_PARTIAL_FAILURE', [error], options.now(), true), {
      password: 'SYNTHETIC_SECRET', stack: 'SYNTHETIC_SECRET', collectionStatus: 'PARTIAL' as const, databaseStatus: 'SUCCESS' as const, notificationStatus: 'FAILED' as const });
    result.reason = 'Cookie=SYNTHETIC_SECRET'; error.safeReason = 'https://discord.com/api/webhooks/SYNTHETIC_SECRET';
    const logger = createLogger(directory, quiet);
    logger('RUN_FINISH', { result, password: 'SYNTHETIC_SECRET', cookie: 'SYNTHETIC_SECRET', raw: new Error('SYNTHETIC_SECRET') });
    publishResult(directory, result, '00000000-0000-0000-0000-000000000001');
    const combined = readdirSync(directory).map(f => readFileSync(join(directory, f), 'utf8')).join('');
    assert.ok(!combined.includes('SYNTHETIC_SECRET')); assert.ok(combined.includes('합성 과목 A')); assert.ok(combined.includes('recoverable'));
    const previous = readFileSync(join(directory, 'latest-run.json'), 'utf8');
    assert.equal(JSON.parse(previous).collectionStatus, 'PARTIAL'); assert.equal(JSON.parse(previous).notificationStatus, 'FAILED');
    publishResult(directory, runResult('SCHEDULER_LOCKED'), '00000000-0000-0000-0000-000000000002');
    assert.equal(readFileSync(join(directory, 'latest-run.json'), 'utf8'), previous);
    assert.equal(JSON.parse(readFileSync(join(directory, 'latest-scheduler-run.json'), 'utf8')).result.code, 'SCHEDULER_LOCKED');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'hs-status-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler mappings use actual PowerShell helper: zero, decimal/hex running, unknown stays numeric', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-File', resolve('tests/fixtures/task-result.ps1')], { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(output.trim().split(/\r?\n/), ['SUCCESS','TASK_RUNNING (Task is currently running)','TASK_RUNNING (Task is currently running)','UNKNOWN_TASK_RESULT (267777)']);
});
