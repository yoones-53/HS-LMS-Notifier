import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { collectBoard, parseBoardRow } from '../src/crawler/boards.js';
import { parseCourse } from '../src/crawler/courses.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
test('notice and material identity use stable ids; missing dates stay null', () => {
  for (const type of ['NOTICE', 'MATERIAL'] as const) {
    const item = parseBoardRow({ id: '123', title: ' 제목 ', date: null }, course, type);
    assert.equal(item.type, type);
    assert.equal(item.itemId, '123');
    assert.equal(item.title, '제목');
    assert.equal(item.createdAt, null);
    assert.equal(item.urlKind, 'CONTEXT_POST');
    assert.notEqual(item.itemId, parseBoardRow({ id: '124', title: '제목', date: '2026.10.06' }, course, type).itemId);
  }
});
test('malformed rows are not accepted as real board items', () => {
  assert.throws(() => parseBoardRow({ id: '', title: '로그인', date: null }, course, 'NOTICE'));
});

test('unavailable menus are distinct from an observed empty board; synthetic DOM only', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <nav class="main_menu"><a href="/lms/class/boardItem/doListView.dunet?board_no=7">과목공지</a></nav>
      <h3 class="pg_title">과목공지</h3>
      <input name="course_id" value="TEST1"><input name="class_no" value="A">
      <table id="base_list"><tbody><tr><td colspan="5">등록된 게시물이 없습니다.</td></tr></tbody></table>
      <div class="paging"><strong>1</strong></div>` }));
    await page.goto('https://lms.hs.ac.kr/lms/class/classroom/doViewClassRoom.dunet');
    assert.deepEqual(await collectBoard(page, course, 'MATERIAL'), { status: 'UNAVAILABLE', items: [] });
    assert.deepEqual(await collectBoard(page, course, 'NOTICE'), { status: 'OK', items: [] });
  } finally { await browser.close(); }
});
