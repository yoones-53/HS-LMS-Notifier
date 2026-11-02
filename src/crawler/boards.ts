import type { Page } from 'playwright';
import { LMS_URL } from '../utils/config.js';
import { LmsError, type Course } from './courses.js';
import { openMenu } from './navigation.js';

export interface BoardItem {
  type: 'NOTICE' | 'MATERIAL';
  courseId: string;
  classNo: string;
  itemId: string;
  title: string;
  /** Observed common detail endpoint; it is not an item-specific GET link. */
  url: string;
  urlKind: 'CONTEXT_POST';
  createdAt: string | null;
}

export function parseBoardRow(raw: { id: string; title: string; date: string | null }, course: Course, type: BoardItem['type']): BoardItem {
  if (!/^\d+$/.test(raw.id) || !raw.title.trim()) throw new LmsError('STRUCTURE_CHANGED');
  return { type, courseId: course.courseId, classNo: course.classNo, itemId: raw.id,
    title: raw.title.trim(), createdAt: raw.date?.trim() || null,
    url: `${LMS_URL}/lms/class/boardItem/doViewBoardItem.dunet`, urlKind: 'CONTEXT_POST' };
}

export interface BoardCollection { status: 'OK' | 'UNAVAILABLE'; items: BoardItem[] }

export async function collectBoard(page: Page, course: Course, type: BoardItem['type']): Promise<BoardCollection> {
  const menu = type === 'NOTICE' ? '과목공지' : '학습자료실';
  await page.locator('nav.main_menu').waitFor();
  if (await page.locator('nav.main_menu').getByRole('link', { name: menu, exact: true }).count() === 0) {
    return { status: 'UNAVAILABLE', items: [] };
  }
  await openMenu(page, menu, '#base_list');
  // Course context is server-side: verify only observed non-secret course fields.
  const ids = await page.locator('input[name="course_id"]').evaluateAll(es => es.map(e => (e as HTMLInputElement).value));
  const classes = await page.locator('input[name="class_no"]').evaluateAll(es => es.map(e => (e as HTMLInputElement).value));
  if (!ids.length || !classes.length || ids.some(id => id !== course.courseId) || classes.some(id => id !== course.classNo)) {
    throw new LmsError('STRUCTURE_CHANGED');
  }
  // Only a single-page pager has been observed. Do not silently truncate unseen pagination.
  if (await page.locator('.paging a').count()) throw new LmsError('STRUCTURE_CHANGED');
  const table = page.locator('#base_list');
  const rows = await table.locator('tbody tr').evaluateAll(rs => rs.map(r => ({
    links: [...r.querySelectorAll('a[name="btn_board_view"]')].map(a => ({ id: a.id, title: a.textContent ?? '',
      date: r.querySelector('.list_date')?.textContent ?? null })),
    empty: r.querySelector('td[colspan]')?.textContent?.trim() ?? '',
  })));
  if (!rows.length || rows.some(r => r.links.length !== 1 && r.empty !== '등록된 게시물이 없습니다.')) throw new LmsError('STRUCTURE_CHANGED');
  const items = rows.flatMap(r => r.links.map(link => parseBoardRow(link, course, type)));
  if (new Set(items.map(i => i.itemId)).size !== items.length) throw new LmsError('STRUCTURE_CHANGED');
  return { status: 'OK', items };
}
