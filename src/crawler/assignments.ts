import type { Page } from 'playwright';
import { LMS_URL } from '../utils/config.js';
import { parseSeoulPeriod } from '../utils/dates.js';
import { LmsError, type Course } from './courses.js';
import { openMenu } from './navigation.js';

export interface Assignment {
  type: 'ASSIGNMENT'; courseId: string; classNo: string; itemId: string; reportId: string; reportSeq: string;
  title: string; url: string; urlKind: 'CONTEXT_POST'; createdAt: null;
  periodRaw: string | null; startsAt: string | null; dueAt: string | null;
  dateStatus: ReturnType<typeof parseSeoulPeriod>['dateStatus'];
  submitted: boolean | null; submissionStatus: string | null; progressStatus: string | null;
}
export interface AssignmentRow { onclick: string | null; title: string; period: string | null; submission: string | null; progress: string | null }

export function parseAssignment(row: AssignmentRow, course: Course): Assignment {
  const m = /^fncModifyReport\('([0-9]+)',\s*'[YN]',\s*'([0-9]+)',\s*'[YN]',\s*'[YN]'\);?$/.exec(row.onclick ?? '');
  if (!m?.[1] || !m[2] || !row.title.trim()) throw new LmsError('STRUCTURE_CHANGED');
  const submissionStatus = row.submission?.trim() || null;
  return { type: 'ASSIGNMENT', courseId: course.courseId, classNo: course.classNo,
    reportId: m[1], reportSeq: m[2], itemId: `${m[1]}:${m[2]}`, title: row.title.trim(),
    url: `${LMS_URL}/lms/class/report/stud/doFormReport.dunet`, urlKind: 'CONTEXT_POST', createdAt: null,
    periodRaw: row.period, ...parseSeoulPeriod(row.period, Number.parseInt(course.semester.year, 10)),
    submissionStatus, submitted: submissionStatus === '제출' ? true : submissionStatus === '미제출' ? false : null,
    progressStatus: row.progress?.trim() || null };
}

export async function collectAssignments(page: Page, course: Course): Promise<{ status: 'OK' | 'UNAVAILABLE'; items: Assignment[] }> {
  await page.locator('nav.main_menu').waitFor();
  if (await page.locator('nav.main_menu').getByRole('link', { name: '과제제출', exact: true }).count() === 0) return { status: 'UNAVAILABLE', items: [] };
  await openMenu(page, '과제제출', '#task_manager_list');
  if (await page.locator('.paging a').count()) throw new LmsError('STRUCTURE_CHANGED');
  const headers = await page.locator('#task_manager_list th').allTextContents();
  if (!headers.some(h => h.trim() === '제출여부') || !headers.some(h => h.trim() === '과제제목/제출기한')) throw new LmsError('STRUCTURE_CHANGED');
  const rows = await page.locator('#task_manager_list tbody tr').evaluateAll(rs => rs.map(r => {
    const a = r.querySelector('a.subject');
    const nodes = [...(a?.childNodes ?? [])];
    const split = nodes.findIndex(n => n.nodeName === 'BR');
    return { onclick: a?.getAttribute('onclick') ?? null,
      title: (split < 0 ? nodes : nodes.slice(0, split)).map(n => n.textContent).join('').trim(),
      period: split < 0 ? null : nodes.slice(split + 1).map(n => n.textContent).join('').trim(),
      submission: r.querySelector('td.txt1 .status')?.textContent ?? null,
      progress: r.querySelector('td.end .status')?.textContent ?? null };
  }));
  const items = rows.map(r => parseAssignment(r, course));
  if (new Set(items.map(i => i.itemId)).size !== items.length) throw new LmsError('STRUCTURE_CHANGED');
  return { status: 'OK', items };
}
