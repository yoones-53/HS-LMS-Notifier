import { setTimeout as delay } from 'node:timers/promises';
import type { Locator, Page } from 'playwright';
import { isLoginPage } from '../auth/session.js';
import { hasAuthNotice, monitorAuthDialogs } from '../auth/dialogs.js';
import { closeProfile, openProfile } from '../browser/profile.js';
import { LMS_URL, MY_LECTURES_URL } from '../utils/config.js';
import { resolveRuntimePaths } from '../runtime/paths.js';
import { LmsError, type Course } from './courses.js';

export async function withLmsPage<T>(action: (page: Page) => Promise<T>, headless = false): Promise<T> {
  const context = await openProfile(resolveRuntimePaths().profile, headless);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    monitorAuthDialogs(page);
    return await action(page);
  }
  finally { await closeProfile(context); }
}

export async function assertLmsPage(page: Page): Promise<void> {
  if (hasAuthNotice(page) || isLoginPage(page.url())) throw new LmsError('AUTH_EXPIRED');
  if (new URL(page.url()).origin !== LMS_URL) throw new LmsError('STRUCTURE_CHANGED');
}

export async function clickPage(page: Page, target: Locator): Promise<void> {
  await delay(800);
  try {
    await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 30_000 }), target.click({ timeout: 10_000 })]);
  } catch (error) { await assertLmsPage(page); throw error; }
  await assertLmsPage(page);
}

export async function enterCourse(page: Page, course: Course): Promise<void> {
  await delay(800);
  await page.goto(MY_LECTURES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await assertLmsPage(page);
  await clickPage(page, page.locator(`[id="selfarea_${course.courseId}_${course.classNo}"]`));
  const header = page.locator('.select_termbox.select_lecture_w > a.title > strong');
  await header.waitFor({ timeout: 10_000 });
  const compact = (s: string) => s.replace(/\s+/g, '');
  if (!compact(await header.innerText()).endsWith(compact(course.name))) throw new LmsError('STRUCTURE_CHANGED');
}

export async function openMenu(page: Page, name: string, table: string): Promise<void> {
  await clickPage(page, page.locator('nav.main_menu').getByRole('link', { name, exact: true }));
  await page.locator(table).waitFor({ timeout: 15_000 });
  if ((await page.locator('h3.pg_title').innerText()).trim() !== name) throw new LmsError('STRUCTURE_CHANGED');
}
