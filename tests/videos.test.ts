import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { collectVideos, parseOnlineRow } from '../src/crawler/videos.js';
import { parseCourse } from '../src/crawler/courses.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
const row = { id: '123', contentId: 'TEST_W', title: '합성 온라인 강의', period: '2026.10.01 00:00 ~ 2026.10.07 23:59', status: '출석완료' };
test('attendance is distinct from unobservable percentage and full viewing completion', () => {
  const result = parseOnlineRow(row, course)!;
  assert.equal(result.attendanceConfirmed, true);
  assert.equal(result.completed, null);
  assert.equal(result.progressPercent, null);
  assert.equal(parseOnlineRow({ ...row, status: '미진행' }, course)?.attendanceConfirmed, null);
  assert.equal(parseOnlineRow({ ...row, id: null }, course), null);
});
test('collector reads semantic columns without ever requesting a player', async () => {
  const browser = await chromium.launch({ headless: true });
  const requests: string[] = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      requests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <nav class="main_menu"><a href="/lms/class/courseSchedule/doListView.dunet">강의수강</a></nav><h3 class="pg_title">강의수강</h3>
        <table id="learning_list"><thead><tr><th>구분</th><th>회차명</th><th>학습기간</th><th>학습상태</th></tr></thead>
        <tbody><tr><td class="rwd_cata">온라인</td><td class="rwd_subject"><strong class="subject">합성 영상</strong><a class="lectureWindow" weekseq_no="123" contents_id="TEST_W" href="https://example.invalid/player">재생</a></td>
        <td>2026.10.01 00:00 ~ 2026.10.07 23:59</td><td><span class="status">출석완료</span></td></tr></tbody></table>` });
    });
    await page.goto('https://lms.hs.ac.kr/lms/class/courseSchedule/doListView.dunet');
    const result = await collectVideos(page, course);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.dueAt, '2026-10-07T23:59:00+09:00');
    assert.ok(requests.every(path => path === '/lms/class/courseSchedule/doListView.dunet'));
  } finally { await browser.close(); }
});
