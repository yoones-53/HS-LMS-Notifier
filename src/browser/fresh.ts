import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { AppError } from '../utils/result.js';
import { assertSafeDiagnostics } from '../utils/security.js';
import { packagedChromiumExecutable } from './packaged.js';

export interface FreshSession { page: Page; close(): Promise<void> }
export async function openFreshSession(headless: boolean): Promise<FreshSession> {
  // Debug API logging can include fill() arguments. Refuse it before touching credentials.
  assertSafeDiagnostics();
  let browser: Browser | undefined; let context: BrowserContext | undefined;
  try {
    const executablePath = packagedChromiumExecutable();
    browser = await chromium.launch({ headless, ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      chromiumSandbox: true, timeout: 30_000 });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
    // No userDataDir/storageState, tracing, screenshots, video or HAR recording.
    const page = await context.newPage();
    let closing: Promise<void> | undefined;
    return { page, close: async () => {
      closing ??= (async () => { try { await context?.close(); } finally { await browser?.close(); } })();
      await closing;
    } };
  } catch { try { await context?.close(); } finally { await browser?.close(); } throw new AppError('UNKNOWN_ERROR'); }
}
