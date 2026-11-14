import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { _electron, chromium } from 'playwright';
import { resolveBundledChromium } from '../../src/browser/packaged.js';

const exec = promisify(execFile);

test('install and start the distribution on a fresh Windows runner', { timeout: 180_000 }, async t => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32') {
    t.skip('Requires a disposable GitHub-hosted Windows runner.');
    return;
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const installer = resolve('release', `HS-LMS-Notifier-Setup-${pkg.version}.exe`);
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work', 'clean-install-'));
  const installPath = join(directory, 'installed');
  await exec(installer, ['/S', `/D=${installPath}`], { timeout: 120_000, windowsHide: true });

  const executable = join(installPath, 'HS-LMS-Notifier.exe');
  const resources = join(installPath, 'resources');
  const browser = await chromium.launch({ executablePath: resolveBundledChromium(resources) });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Chromium smoke test</title>');
    assert.equal(await page.title(), 'Chromium smoke test');
  } finally { await browser.close(); }

  const app = await _electron.launch({ executablePath: executable, timeout: 30_000 });
  try {
    const page = await app.firstWindow();
    await page.locator('#welcome').waitFor({ state: 'visible', timeout: 20_000 });
    const runtime = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged, executable: process.execPath, arch: process.arch,
    }));
    assert.equal(runtime.packaged, true);
    assert.equal(basename(runtime.executable), 'HS-LMS-Notifier.exe');
    assert.equal(runtime.arch, 'x64');
    const status = (await page.evaluate(() => window.lms.getStatus())).data;
    assert.equal(status?.settings.setupComplete, false);
    assert.equal(status?.credentialsConfigured, false);
    assert.equal(status?.discordConfigured, false);
    assert.equal(status?.calendar?.loginAvailable, false);
    assert.equal(status?.settings.googleCalendar.enabled, false);
    assert.deepEqual(status?.settings.discordCourseKeys, []);
    assert.equal(await page.evaluate(() => typeof (window as Window & { require?: unknown }).require), 'undefined');
    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    assert.equal(await page.getByLabel('학번 / LMS ID').inputValue(), '');
    assert.equal(await page.getByLabel('비밀번호', { exact: true }).inputValue(), '');
  } finally { await app.close(); }
});
