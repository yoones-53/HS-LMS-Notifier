import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { assertSafeDiagnostics } from '../utils/security.js';

export async function openProfile(
  directory: string,
  headless = false,
): Promise<BrowserContext> {
  assertSafeDiagnostics();
  const defaultDirectory = join(directory, 'Default');
  await mkdir(defaultDirectory, { recursive: true });

  // Chromium owns the session data. Never export cookies or storageState.
  // Initialize a new profile only; never overwrite an existing browser profile.
  const preferences = {
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    autofill: { profile_enabled: false, credit_card_enabled: false },
    // Keep session cookies through a normal browser restart. Server expiry still applies.
    session: { restore_on_startup: 1 },
  };
  try {
    await writeFile(join(defaultDirectory, 'Preferences'), JSON.stringify(preferences), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }

  return chromium.launchPersistentContext(directory, {
    headless,
    channel: 'chromium',
    args: ['--restore-last-session'],
    chromiumSandbox: true,
    acceptDownloads: false,
    viewport: { width: 1440, height: 1000 },
    timeout: 30_000,
  });
}

export async function closeProfile(context: BrowserContext): Promise<void> {
  // Do not restore LMS/SSO pages automatically on the next launch.
  // This also avoids retaining an unfinished login form in restored tabs.
  await Promise.allSettled(
    context.pages().map(page => page.goto('about:blank', { timeout: 5_000 })),
  );
  await context.close();
}
