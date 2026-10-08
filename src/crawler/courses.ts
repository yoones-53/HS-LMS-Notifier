import type { Page } from 'playwright';
import { checkSession } from '../auth/session.js';
import { UserFacingError } from '../utils/cli.js';
import { LMS_URL } from '../utils/config.js';

export const COURSE_SELECTOR = '#landing_lec_box_container a[href^="javascript:fncGoClassroom("]';
export const CLASSROOM_URL = `${LMS_URL}/lms/class/classroom/doViewClassRoom.dunet`;

export interface Course {
  courseId: string;
  classNo: string;
  name: string;
  /** Common POST entry URL, not a course-specific deep link. */
  url: string;
  entryHref: string;
  semester: { year: string; term: string };
}

export class LmsError extends UserFacingError {
  constructor(public readonly code: 'AUTH_EXPIRED' | 'STRUCTURE_CHANGED') {
    super(code === 'AUTH_EXPIRED'
      ? 'AUTH_EXPIRED: LMS 로그인이 만료되었습니다. npm run login으로 다시 로그인해 주세요.'
      : 'STRUCTURE_CHANGED: 예상한 LMS 구조를 확인하지 못했습니다. 빈 목록으로 처리하지 않습니다.');
  }
}

export function parseCourse(raw: { id: string; href: string | null; title: string | null }, semester: Course['semester']): Course {
  const match = /^javascript:fncGoClassroom\('([A-Za-z0-9]+)','([A-Za-z0-9]+)','3'\);$/.exec(raw.href ?? '');
  if (!match || !match[1] || !match[2] || !raw.title?.trim()
    || raw.id !== `selfarea_${match[1]}_${match[2]}`) throw new LmsError('STRUCTURE_CHANGED');
  return { courseId: match[1], classNo: match[2], name: raw.title.trim(), url: CLASSROOM_URL,
    entryHref: raw.href!, semester };
}

export async function collectCourses(page: Page): Promise<Course[]> {
  const status = await checkSession(page);
  if (status !== 'authenticated') throw new LmsError(status);
  // The list is inserted asynchronously. An unverified empty state is an error, not [].
  try { await page.locator(COURSE_SELECTOR).first().waitFor({ timeout: 15_000 }); }
  catch { throw new LmsError('STRUCTURE_CHANGED'); }
  const year = page.locator('.select_termbox:not(.select_term_w) > a.title > strong');
  const term = page.locator('.select_termbox.select_term_w > a.title > strong');
  if (await year.count() !== 1 || await term.count() !== 1) throw new LmsError('STRUCTURE_CHANGED');
  const semester = { year: (await year.innerText()).trim(), term: (await term.innerText()).trim() };
  if (!/^\d{4}년$/.test(semester.year) || !semester.term) throw new LmsError('STRUCTURE_CHANGED');
  const rows = await page.locator(COURSE_SELECTOR).evaluateAll(anchors => anchors.map(a => ({
    id: a.id, href: a.getAttribute('href'), title: a.querySelector('strong.title')?.textContent ?? null,
  })));
  const courses = rows.map(row => parseCourse(row, semester));
  if (new Set(courses.map(c => `${c.courseId}:${c.classNo}`)).size !== courses.length) {
    throw new LmsError('STRUCTURE_CHANGED');
  }
  return courses;
}
