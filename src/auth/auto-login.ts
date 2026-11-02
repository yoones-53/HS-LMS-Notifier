import { setTimeout as delay } from 'node:timers/promises';
import type { Dialog, Page } from 'playwright';
import { LMS_URL } from '../utils/config.js';
import { AppError, classifyError } from '../utils/result.js';
import { COURSE_SELECTOR } from '../crawler/courses.js';
import { checkSession, isLoginPage } from './session.js';
import { monitorAuthDialogs } from './dialogs.js';
import type { CredentialLoader, Credentials } from './credentials.js';

// Verified using a credential-free Playwright MCP context on 2026-10-07.
export const LOGIN_FORM = '#ssoLoginFrm';
export const LOGIN_ID = '#ssoLoginFrm #userId';
export const LOGIN_PASSWORD = '#ssoLoginFrm #userPwd[type="password"]';
export const LOGIN_SUBMIT = '#ssoLoginFrm input[type="submit"]';
const challengePattern = /captcha|recaptcha|hcaptcha|로봇이 아닙니다|보안\s*문자(?:를)?\s*입력|인증\s*번호(?:를)?\s*입력|2단계\s*인증|이중\s*인증|추가\s*(?:사용자\s*)?인증이\s*필요|휴대폰.{0,20}승인|one.time.password|\bOTP\b/i;
export const requiresUserText = (text: string): boolean => challengePattern.test(text);
export async function requiresUser(page: Page): Promise<boolean> {
  // Boolean only: never return/log DOM text, login values or frame URLs.
  for (const frame of page.frames().slice(0, 10)) {
    try {
      if (frame !== page.mainFrame() && !(await (await frame.frameElement()).isVisible())) continue;
      const signals = await frame.evaluate(({ pattern, flags }) => {
        const re = new RegExp(pattern, flags);
        return re.test(document.body?.innerText ?? '') || [...document.querySelectorAll('iframe')]
          .some(f => !!f.getClientRects().length && re.test(f.title));
      }, { pattern: challengePattern.source, flags: challengePattern.flags });
      if (signals) return true;
    } catch { /* Navigation may detach a frame; do not expose its error or URL. */ }
  }
  return false;
}

export async function autoLogin(page: Page, load: CredentialLoader, timeoutMs = 30_000): Promise<void> {
  let credentials: Credentials | undefined;
  let alert: 'none' | 'failed' | 'user' = 'none';
  const onDialog = (dialog: Dialog) => {
    alert = requiresUserText(dialog.message()) ? 'user' : 'failed';
    void dialog.dismiss().catch(() => {});
  };
  page.on('dialog', onDialog);
  try {
    credentials = await load();
    try { await page.goto(LMS_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }); }
    catch (error) { throw new AppError(classifyError(error) === 'LMS_TIMEOUT' ? 'LMS_TIMEOUT' : 'NETWORK_ERROR'); }
    if (await requiresUser(page)) throw new AppError('AUTO_LOGIN_REQUIRES_USER');
    try { await page.locator(LOGIN_PASSWORD).waitFor({ state: 'visible', timeout: timeoutMs }); }
    catch { if (await requiresUser(page)) throw new AppError('AUTO_LOGIN_REQUIRES_USER'); throw new AppError('LMS_STRUCTURE_CHANGED'); }
    if (!isLoginPage(page.url())) throw new AppError('LMS_STRUCTURE_CHANGED');
    const form = await page.locator(LOGIN_FORM).evaluate((f: HTMLFormElement) => ({ action: new URL(f.action).origin + new URL(f.action).pathname, method: f.method }));
    if (form.action !== 'https://sso2.hs.ac.kr/sso/loginSuccess.jsp' || form.method.toLowerCase() !== 'post') throw new AppError('LMS_STRUCTURE_CHANGED');
    if (await page.locator(LOGIN_ID).count() !== 1 || await page.locator(LOGIN_SUBMIT).count() !== 1) throw new AppError('LMS_STRUCTURE_CHANGED');
    await page.locator(LOGIN_ID).fill(credentials.id);
    await page.locator(LOGIN_PASSWORD).fill(credentials.password);
    // Exactly one submit. Never retry password rejection or solve an extra challenge.
    await page.locator(LOGIN_SUBMIT).click({ timeout: timeoutMs });
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if ((alert as string) === 'user' || await requiresUser(page)) throw new AppError('AUTO_LOGIN_REQUIRES_USER');
      if ((alert as string) === 'failed') throw new AppError('AUTO_LOGIN_FAILED');
      if (new URL(page.url()).origin === LMS_URL) {
        // Wait for the returned document, not merely a redirect URL observed mid-navigation.
        await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
        const status = await checkSession(page);
        if (status === 'authenticated') {
          try { await page.locator(COURSE_SELECTOR).first().waitFor({ state: 'visible', timeout: timeoutMs }); }
          catch { throw new AppError('LMS_STRUCTURE_CHANGED'); }
          monitorAuthDialogs(page);
          return;
        }
        if (await requiresUser(page)) throw new AppError('AUTO_LOGIN_REQUIRES_USER');
        throw new AppError(status === 'AUTH_EXPIRED' ? 'AUTO_LOGIN_FAILED' : 'LMS_STRUCTURE_CHANGED');
      }
      await delay(Math.min(200, timeoutMs));
    }
    if (await requiresUser(page)) throw new AppError('AUTO_LOGIN_REQUIRES_USER');
    const returnedLoginForm = new URL(page.url()).origin === 'https://sso2.hs.ac.kr'
      && await page.locator(LOGIN_PASSWORD).isVisible();
    throw new AppError(isLoginPage(page.url()) || returnedLoginForm ? 'AUTO_LOGIN_FAILED' : 'LMS_STRUCTURE_CHANGED');
  } catch (error) {
    throw error instanceof AppError ? error : new AppError(classifyError(error));
  } finally {
    page.off('dialog', onDialog);
    if (credentials) { credentials.id = ''; credentials.password = ''; }
    // JS strings cannot be reliably zeroized. Retain no credential references beyond this run.
  }
}
