import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { isLoginPage } from '../src/auth/session.js';
import { checkSession } from '../src/auth/session.js';
import { hasAuthNotice, monitorAuthDialogs } from '../src/auth/dialogs.js';
import { collectCourses, LmsError, parseCourse } from '../src/crawler/courses.js';

const semester = { year: '2026년', term: '2학기' };
const row = { id: 'selfarea_TEST123_A', href: "javascript:fncGoClassroom('TEST123','A','3');", title: ' 합성 강의(A반) ' };
test('course identity comes from observed link arguments and matching DOM id, not title', () => {
  const course = parseCourse(row, semester);
  assert.equal(course.courseId, 'TEST123');
  assert.equal(course.classNo, 'A');
  assert.equal(course.name, '합성 강의(A반)');
  assert.deepEqual(course.semester, semester);
  assert.equal(new URL(course.url).search, '');
});
test('unexpected link, missing title and mismatched identity fail closed', () => {
  for (const invalid of [{ ...row, href: '/login' }, { ...row, title: '' }, { ...row, id: 'wrong' }]) {
    assert.throws(() => parseCourse(invalid, semester), (e: unknown) => e instanceof LmsError && e.code === 'STRUCTURE_CHANGED');
  }
});
test('observed SSO login page is expired; an unknown page is not automatically expired', () => {
  assert.equal(isLoginPage('https://sso2.hs.ac.kr/'), true);
  assert.equal(isLoginPage('https://lms.hs.ac.kr/unexpected'), false);
  assert.equal(isLoginPage('https://sso2.hs.ac.kr/oauth2/checkSession.do'), false);
  assert.match(new LmsError('AUTH_EXPIRED').message, /^AUTH_EXPIRED:/);
});

test('redirected login HTML never becomes a course list (no real LMS requests)', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.context().setOffline(true);
    await page.route('**/*', route => route.request().url().startsWith('https://lms.hs.ac.kr/')
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<script>location.replace("https://sso2.hs.ac.kr/")</script>' })
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>합성 로그인 화면</h1>' }));
    await assert.rejects(collectCourses(page), (e: unknown) => e instanceof LmsError && e.code === 'AUTH_EXPIRED');
  } finally { await browser.close(); }
});

test('a fresh verified session clears an earlier authentication alert', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    monitorAuthDialogs(page);
    await page.evaluate(() => alert('다른 PC 에서 로그인 되었습니다.'));
    assert.equal(hasAuthNotice(page), true);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<a href="javascript:lmsLogout();">로그아웃</a>' }));
    assert.equal(await checkSession(page), 'authenticated');
    assert.equal(hasAuthNotice(page), false);
  } finally { await browser.close(); }
});
