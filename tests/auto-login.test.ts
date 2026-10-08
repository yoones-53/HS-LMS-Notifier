import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openFreshSession } from '../src/browser/fresh.js';
import { autoLogin } from '../src/auth/auto-login.js';
import { collectCourses } from '../src/crawler/courses.js';
import { AppError } from '../src/utils/result.js';
import { MY_LECTURES_URL } from '../src/utils/config.js';

const SECRET = 'SYNTHETIC_SECRET_SENTINEL';
const credentials = async () => ({ id: 'synthetic-user', password: SECRET });
const loginForm = '<form id="ssoLoginFrm" method="post" action="https://sso2.hs.ac.kr/sso/loginSuccess.jsp"><input id="userId" name="userId"><input id="userPwd" name="userPwd" type="password"><input type="submit"></form>';
const courseHtml = `<a href="javascript:lmsLogout();">로그아웃</a><div class="select_termbox"><a class="title"><strong>2026년</strong></a></div><div class="select_termbox select_term_w"><a class="title"><strong>2학기</strong></a></div><div id="landing_lec_box_container"><a id="selfarea_TEST1_A" href="javascript:fncGoClassroom('TEST1','A','3');"><strong class="title">합성 과목</strong></a></div>`;
type Mode = 'ok' | 'reject' | 'rejectInline' | 'challenge' | 'challengeAfter' | 'structure' | 'network';
async function fixture(mode: Mode, headless = true) {
  const session = await openFreshSession(headless);
  // Hard network stop even if Chromium follows a redirect outside interception.
  await session.page.context().setOffline(true);
  let loggedIn = false; let attempts = 0; let requests = 0;
  await session.page.context().route('**/*', async route => {
    requests++;
    const url = new URL(route.request().url());
    const html = (body: string) => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    if (mode === 'network') { await route.abort('internetdisconnected'); return; }
    if (url.origin === 'https://lms.hs.ac.kr') {
      if (loggedIn) await html(courseHtml);
      else await html('<script>location.replace("https://sso2.hs.ac.kr/")</script>');
    } else if (url.pathname === '/sso/loginSuccess.jsp') {
      attempts++;
      if (mode === 'reject') await html(`<script>alert('로그인 정보를 확인해주세요.')</script>${loginForm}`);
      else if (mode === 'rejectInline') await html(loginForm);
      else if (mode === 'challengeAfter') await html('<p>추가 사용자 인증이 필요합니다.</p><p>인증번호를 입력하세요</p>');
      else { loggedIn = true; await html(`<script>location.replace(${JSON.stringify(MY_LECTURES_URL)})</script>`); }
    } else {
      await html(mode === 'challenge' ? '<p>CAPTCHA: 로봇이 아닙니다</p>' : mode === 'structure' ? '<p>Changed</p>' : loginForm);
    }
  });
  return { session, attempts: () => attempts, requests: () => requests };
}

for (const headless of [true, false]) test(`fresh automatic login and unchanged course crawler work with HEADLESS=${headless}; browser closes`, { timeout: 20_000 }, async () => {
  const f = await fixture('ok', headless);
  try {
    await autoLogin(f.session.page, credentials, 3_000);
    assert.equal(f.attempts(), 1);
    assert.equal((await collectCourses(f.session.page)).length, 1);
  } finally { await f.session.close(); }
  assert.ok(f.session.page.isClosed());
  assert.equal(f.session.page.context().browser()?.isConnected(), false);
});
for (const [mode, status, submits] of [
  ['reject','AUTO_LOGIN_FAILED',1], ['rejectInline','AUTO_LOGIN_FAILED',1], ['challenge','AUTO_LOGIN_REQUIRES_USER',0],
  ['challengeAfter','AUTO_LOGIN_REQUIRES_USER',1], ['structure','LMS_STRUCTURE_CHANGED',0], ['network','NETWORK_ERROR',0],
] as const) test(`automatic login ${mode}: ${status}, no retry and no password in error`, { timeout: 15_000 }, async () => {
  const f = await fixture(mode);
  try {
    // Browser fixtures compete with Electron tests on Windows. A 600ms navigation
    // budget can time out before submitting; keep the expected status/one-attempt checks.
    await assert.rejects(autoLogin(f.session.page, credentials, 3_000), e => e instanceof AppError && e.status === status && !e.message.includes(SECRET));
    assert.equal(f.attempts(), submits);
  } finally { await f.session.close(); }
  assert.ok(f.session.page.isClosed());
});
test('unconfigured credentials stop before LMS requests and still close the browser', async () => {
  const f = await fixture('ok');
  try {
    await assert.rejects(autoLogin(f.session.page, async () => { throw new AppError('CREDENTIALS_NOT_CONFIGURED'); }), e => e instanceof AppError && e.status === 'CREDENTIALS_NOT_CONFIGURED');
    assert.equal(f.requests(), 0); assert.equal(f.attempts(), 0);
  } finally { await f.session.close(); }
});
