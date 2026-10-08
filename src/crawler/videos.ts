import type { Page } from 'playwright';
import { LMS_URL } from '../utils/config.js';
import { parseSeoulPeriod } from '../utils/dates.js';
import { LmsError, type Course } from './courses.js';
import { openMenu } from './navigation.js';

export interface OnlineLecture {
  type: 'VIDEO'; courseId: string; classNo: string; itemId: string; contentId: string | null;
  title: string; url: string; urlKind: 'CONTEXT_PAGE'; createdAt: null;
  startsAt: string | null; dueAt: string | null; periodRaw: string | null;
  dateStatus: ReturnType<typeof parseSeoulPeriod>['dateStatus'];
  statusRaw: string | null; attendanceConfirmed: boolean | null;
  // Contract allows verified future inputs; the current LMS parser still returns null.
  progressPercent: null; completed: boolean | null;
}
export interface OnlineRow { id: string | null; contentId: string | null; title: string; period: string | null; status: string | null }

export function parseOnlineRow(row: OnlineRow, course: Course): OnlineLecture | null {
  // Future placeholders expose no stable id. Do not substitute a title or row index.
  if (!row.id) return null;
  if (!/^\d+$/.test(row.id) || !row.title.trim()) throw new LmsError('STRUCTURE_CHANGED');
  const statusRaw = row.status?.trim() || null;
  return { type: 'VIDEO', courseId: course.courseId, classNo: course.classNo, itemId: row.id,
    contentId: row.contentId, title: row.title.trim(), url: `${LMS_URL}/lms/class/courseSchedule/doListView.dunet`,
    urlKind: 'CONTEXT_PAGE', createdAt: null, periodRaw: row.period,
    ...parseSeoulPeriod(row.period, Number.parseInt(course.semester.year, 10)),
    statusRaw, attendanceConfirmed: statusRaw === '출석완료' ? true : null,
    progressPercent: null, completed: null };
}

export async function collectVideos(page: Page, course: Course): Promise<{
  status: 'OK' | 'UNAVAILABLE'; items: OnlineLecture[]; unidentifiedOnlineRows: number;
}> {
  await page.locator('nav.main_menu').waitFor();
  if (await page.locator('nav.main_menu').getByRole('link', { name: '강의수강', exact: true }).count() === 0) {
    return { status: 'UNAVAILABLE', items: [], unidentifiedOnlineRows: 0 };
  }
  // Never click lectureWindow/review/play, open a player, or call learning-record APIs.
  await openMenu(page, '강의수강', '#learning_list');
  if (await page.locator('.paging a').count()) throw new LmsError('STRUCTURE_CHANGED');
  const data = await page.locator('#learning_list').evaluate(table => {
    const headers = [...table.querySelectorAll('thead th')].map(h => h.textContent?.trim());
    const periodIndex = headers.indexOf('학습기간');
    const stateIndex = headers.indexOf('학습상태');
    const rows = [...table.querySelectorAll('tbody tr')].filter(r => r.querySelector('.rwd_cata')?.textContent?.trim() === '온라인');
    return { valid: periodIndex >= 0 && stateIndex >= 0, rows: rows.map(row => {
      const link = row.querySelector('a.lectureWindow');
      const cells = [...row.querySelectorAll('td')];
      return { id: link?.getAttribute('weekseq_no') ?? null, contentId: link?.getAttribute('contents_id') ?? null,
        title: row.querySelector('.rwd_subject strong.subject')?.textContent?.trim() ?? '',
        period: cells[periodIndex]?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        status: cells[stateIndex]?.querySelector('.status')?.textContent?.trim() ?? null };
    }) };
  });
  if (!data.valid) throw new LmsError('STRUCTURE_CHANGED');
  const parsed = data.rows.map(row => parseOnlineRow(row, course));
  const items = parsed.filter((i): i is OnlineLecture => i !== null);
  if (new Set(items.map(i => i.itemId)).size !== items.length) throw new LmsError('STRUCTURE_CHANGED');
  return { status: 'OK', items, unidentifiedOnlineRows: parsed.length - items.length };
}
