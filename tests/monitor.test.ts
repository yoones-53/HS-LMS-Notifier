import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LmsStore } from '../src/database/store.js';
import { LmsError, parseCourse } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { parseOnlineRow } from '../src/crawler/videos.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { createLogger } from '../src/utils/logger.js';
import { courseKey } from '../src/model.js';
import type { DiscordPayload, Transport } from '../src/notification/discord.js';

const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const assignment = parseAssignment({ onclick: "fncModifyReport('1','N','1','Y','Y')", title: '합성 과제', period: '26/10/01 00:00 ~ 26/10/13 23:59', submission: '미제출', progress: '진행' }, course);
const options = { now: () => new Date('2026-10-06T12:00:00+09:00'), deliveryDelayMs: 0 };
const log = () => {};
const source: LmsSource = {
  courses: async () => [course], enter: async () => {},
  collect: async (_course, type) => ({ status: 'OK', items: type === 'ASSIGNMENT' ? [assignment] : [] }),
};

test('course routing separates new announcements and deadlines, including when the team webhook fails', async () => {
  const store = new LmsStore(':memory:');
  const team = { ...course, courseId: 'AAA_TEAM', name: '합성 팀프로젝트' };
  const personalMessages: DiscordPayload[] = [];
  const teamMessages: DiscordPayload[] = [];
  let newContent = false;
  let rejectTeam = false;
  const personal: Transport = async payload => { personalMessages.push(payload); return { status: 'SENT' }; };
  const dedicated: Transport = async payload => {
    teamMessages.push(payload);
    return rejectTeam ? { status: 'RETRY', retryAfterSeconds: 1800 } : { status: 'SENT' };
  };
  const input: LmsSource = {
    ...source, courses: async () => [team, course],
    collect: async (current, type) => {
      const submitted = rejectTeam && current.courseId === team.courseId;
      const task = { ...assignment, courseId: current.courseId, title: `${current.name} 마감`,
        submitted, submissionStatus: submitted ? '제출' : '미제출' };
      if (type === 'ASSIGNMENT') return { status: 'OK', items: [task] };
      if (type === 'NOTICE' && newContent) return { status: 'OK', items: [
        parseBoardRow({ id: rejectTeam ? '2' : '1', title: `${current.name} 공지`, date: null }, current, 'NOTICE'),
      ] };
      if (type === 'VIDEO' && newContent) return { status: 'OK', items: [
        parseOnlineRow({ id: '10', contentId: 'TEST_W', title: `${current.name} 강의`, period: null,
          status: submitted ? '출석완료' : '미진행' }, current)!,
      ] };
      return { status: 'OK', items: [] };
    },
  };
  const routing = { ...options, authenticate: async () => {}, routedCourses: new Set([courseKey(team)]),
    courseTransport: (key: string) => key === courseKey(team) ? dedicated : personal };
  try {
    await runMonitor(store, input, personal, log, routing);
    assert.doesNotMatch(JSON.stringify(personalMessages), /합성 팀프로젝트/);
    newContent = true;
    await runMonitor(store, input, personal, log, routing);
    assert.match(JSON.stringify(teamMessages), /합성 팀프로젝트 공지/);
    assert.match(JSON.stringify(teamMessages), /합성 팀프로젝트 강의/);
    assert.match(JSON.stringify(teamMessages), /합성 팀프로젝트 마감/);
    assert.doesNotMatch(JSON.stringify(teamMessages), /합성 과목/);
    assert.doesNotMatch(JSON.stringify(teamMessages), /제출 상태|학습 상태|미제출|미진행/);
    assert.doesNotMatch(JSON.stringify(personalMessages), /합성 팀프로젝트/);
    personalMessages.length = 0;
    rejectTeam = true;
    const failed = await runMonitor(store, input, personal, log, routing);
    assert.equal(failed.deferred, 1);
    assert.match(JSON.stringify(personalMessages), /합성 과목 공지/);
    assert.doesNotMatch(JSON.stringify(personalMessages), /합성 팀프로젝트/);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM notification_history WHERE status='SUPPRESSED'").get()?.n, 2);
  } finally { store.close(); }
});

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
