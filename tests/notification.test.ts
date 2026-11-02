import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LmsStore } from '../src/database/store.js';
import { discordTransport, validateWebhook, type DiscordPayload } from '../src/notification/discord.js';
import { sendOnce } from '../src/notification/delivery.js';
import { notifyChanges } from '../src/notification/changes.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { parseAssignment } from '../src/crawler/assignments.js';
// Synthetic URL, injected fetch only; these tests never contact Discord or load .env.
const fakeUrl = ['https:', '', 'discord.com', 'api', 'webhooks', '123', 'synthetic_only'].join('/');
const payload: DiscordPayload = { embeds: [{ title: '합성 테스트', description: '전송 없음' }], allowed_mentions: { parse: [] } };
test('webhook validation rejects redirects/credentials/foreign hosts without exposing input', () => {
  assert.equal(validateWebhook(fakeUrl).hostname, 'discord.com');
  for (const value of [undefined, '', 'SECRET_SENTINEL', fakeUrl + '?evil=1', fakeUrl.replace('discord.com', 'discord.com.example.invalid')]) {
    assert.throws(() => validateWebhook(value), e => e instanceof Error && !e.message.includes('SECRET_SENTINEL') && e.message.startsWith('DISCORD_CONFIG_INVALID'));
  }
});
test('transport confirms message id, disables redirects, and never leaks network errors', async () => {
  const send = discordTransport(fakeUrl, async (url, options) => {
    assert.equal(new URL(String(url)).searchParams.get('wait'), 'true');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(options?.body)).allowed_mentions, { parse: [] });
    return Response.json({ id: '999' });
  });
  assert.equal((await send(payload)).status, 'SENT');
  assert.equal((await discordTransport(fakeUrl, async () => { throw new Error(fakeUrl); })(payload)).status, 'UNKNOWN');
  assert.deepEqual(await discordTransport(fakeUrl, async () => Response.json({ retry_after: 3 }, { status: 429 }))(payload), { status: 'RETRY', retryAfterSeconds: 3 });
});
test('same notification is sent once; uncertain results are not retried automatically', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  try {
    const send = async () => { calls++; return { status: 'SENT' as const }; };
    assert.equal(await sendOnce(store, 'new-notice', payload, send), 'SENT');
    assert.equal(await sendOnce(store, 'new-notice', payload, send), 'SKIPPED');
    assert.equal(calls, 1);
    assert.equal(await sendOnce(store, 'uncertain', payload, async () => ({ status: 'UNKNOWN' })), 'UNKNOWN');
    assert.equal(await sendOnce(store, 'uncertain', payload, send), 'UNKNOWN');
    assert.equal(calls, 1);
  } finally { store.close(); }
});
test('rate-limited messages wait until their retry time', async () => {
  const store = new LmsStore(':memory:');
  const now = new Date('2026-10-06T00:00:00Z'); let calls = 0;
  try {
    await sendOnce(store, 'rate', payload, async () => ({ status: 'RETRY', retryAfterSeconds: 30 }), now);
    const send = async () => { calls++; return { status: 'SENT' as const }; };
    assert.equal(await sendOnce(store, 'rate', payload, send, now), 'DEFERRED');
    assert.equal(await sendOnce(store, 'rate', payload, send, new Date(now.getTime() + 31_000)), 'SENT');
    assert.equal(calls, 1);
  } finally { store.close(); }
});

test('real detector/store/notification pipeline suppresses repeated new notice and assignment notifications', async () => {
  const store = new LmsStore(':memory:'); let calls = 0;
  const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
  const notice = parseBoardRow({ id: '1', title: '@everyone [합성 공지]', date: null }, course, 'NOTICE');
  const assignment = parseAssignment({ onclick: "fncModifyReport('1', 'N', '1', 'Y','Y')", title: '합성 과제', period: null, submission: '미제출', progress: null }, course);
  const send = async (body: DiscordPayload) => { calls++; assert.deepEqual(body.allowed_mentions.parse, []); return { status: 'SENT' as const }; };
  try {
    store.sync([course], [{ course, type: 'NOTICE', items: [] }, { course, type: 'ASSIGNMENT', items: [] }]);
    const scopes = [{ course, type: 'NOTICE' as const, items: [notice] }, { course, type: 'ASSIGNMENT' as const, items: [assignment] }];
    store.sync([course], scopes);
    assert.equal((await notifyChanges(store, send, 0)).sent, 2);
    store.sync([course], scopes);
    assert.equal((await notifyChanges(store, send, 0)).sent, 0);
    assert.equal(calls, 2);
  } finally { store.close(); }
});
