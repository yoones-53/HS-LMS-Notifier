import type { Page } from 'playwright';
import { LMS_URL, LOGOUT_SELECTOR, MY_LECTURES_URL } from '../utils/config.js';
import { confirmAuthenticated } from './dialogs.js';

export type SessionResult = 'authenticated' | 'AUTH_EXPIRED' | 'STRUCTURE_CHANGED';

export function isLoginPage(url: string): boolean {
  const parsed = new URL(url);
  // Only the SSO login destination observed via MCP; never inspect input values.
  return parsed.origin === 'https://sso2.hs.ac.kr' && parsed.pathname === '/';
}

export async function checkSession(page: Page): Promise<SessionResult> {
  await page.goto(MY_LECTURES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.locator(LOGOUT_SELECTOR).filter({ hasText: '로그아웃' }).waitFor({
        state: 'visible',
        timeout: 10_000,
      });
    } catch (error) {
      if (page.isClosed()) throw error;
      if (error instanceof Error && error.name === 'TimeoutError') {
        if (isLoginPage(page.url())) return 'AUTH_EXPIRED';
        const location = new URL(page.url());
        if (attempt === 0 && location.origin === LMS_URL && location.pathname === '/main/MainView.dunet') {
          await page.goto(MY_LECTURES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          continue;
        }
        return 'STRUCTURE_CHANGED';
      }
      throw error;
    }

    const actual = new URL(page.url());
    if (actual.origin === LMS_URL && actual.pathname === new URL(MY_LECTURES_URL).pathname) {
      confirmAuthenticated(page);
      return 'authenticated';
    }
    return 'STRUCTURE_CHANGED';
  }
  return 'STRUCTURE_CHANGED';
}
