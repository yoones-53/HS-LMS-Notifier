import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { _electron, chromium } from 'playwright';
import { resolveBundledChromium } from '../../src/browser/packaged.js';
import { writeJson } from '../../src/runtime/json.js';
import { runtimePaths } from '../../src/runtime/paths.js';
import { defaultSettings } from '../../src/runtime/settings.js';

const exec = promisify(execFile);

test('install, start and reopen existing data under Restricted on a fresh Windows runner', { timeout: 360_000 }, async t => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'win32') {
    t.skip('Requires a disposable GitHub-hosted Windows runner.');
    return;
  }
  const env: Record<string, string> = {};
  // Windows PowerShell needs its own module search path when started from PowerShell 7.
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !['PSMODULEPATH', 'PSEXECUTIONPOLICYPREFERENCE'].includes(key.toUpperCase())) env[key] = value;
  }
  env.PSExecutionPolicyPreference = 'Restricted';
  const powershell = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const getPolicy = async () => {
    const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      'Get-ExecutionPolicy; Get-ExecutionPolicy -Scope CurrentUser; Get-ExecutionPolicy -Scope LocalMachine'], { env });
    return stdout.trim().split(/\r?\n/);
  };
  const originalPolicy = await getPolicy();
  assert.equal(originalPolicy[0], 'Restricted');

  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const installer = resolve('release', `HS-LMS-Notifier-Setup-${pkg.version}.exe`);
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work', 'clean-install-'));
  const installPath = join(directory, 'installed');
  const install = () => exec(installer, ['/S', `/D=${installPath}`], { env, timeout: 120_000, windowsHide: true });
  await install();

  const executable = join(installPath, 'HS-LMS-Notifier.exe');
  const resources = join(installPath, 'resources');
  await assert.rejects(exec(powershell, ['-NoProfile', '-NonInteractive', '-File',
    join(resources, 'runtime-scripts', 'windows', 'runtime-root.ps1')], { env, timeout: 10_000 }),
  { code: 1 });

  const browser = await chromium.launch({ executablePath: resolveBundledChromium(resources) });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Chromium smoke test</title>');
    assert.equal(await page.title(), 'Chromium smoke test');
  } finally { await browser.close(); }

  const launch = () => _electron.launch({ executablePath: executable, env, timeout: 30_000 });
  const app = await launch();
  let userData: string;
  try {
    const page = await app.firstWindow();
    await page.locator('#welcome').waitFor({ state: 'visible', timeout: 20_000 });
    const runtime = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged, executable: process.execPath, arch: process.arch, userData: app.getPath('userData'),
    }));
    assert.equal(runtime.packaged, true);
    assert.equal(basename(runtime.executable), 'HS-LMS-Notifier.exe');
    assert.equal(runtime.arch, 'x64');
    assert.equal(runtime.userData.toLowerCase(), join(process.env.APPDATA!, 'HS-LMS-Notifier').toLowerCase());
    userData = runtime.userData;
    const status = await page.evaluate(() => window.lms.getStatus());
    assert.equal(status.ok, true);
    assert.equal(status.data?.migration, 'FRESH');
    assert.equal(status.data?.settings.setupComplete, false);
    assert.equal(status.data?.credentialsConfigured, false);
    assert.equal(status.data?.discordConfigured, false);
    assert.equal(status.data?.scheduler.state, 'ABSENT');
    assert.equal(status.data?.scheduler.mode, 'ABSENT');
    assert.equal(status.data?.calendar?.loginAvailable, false);
    assert.equal(status.data?.settings.googleCalendar.enabled, false);
    assert.deepEqual(status.data?.settings.discordCourseKeys, []);
    assert.equal(await page.evaluate(() => typeof (window as Window & { require?: unknown }).require), 'undefined');
    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    assert.equal(await page.getByLabel('학번 / LMS ID').inputValue(), '');
    assert.equal(await page.getByLabel('비밀번호', { exact: true }).inputValue(), '');
  } finally { await app.close(); }

  const paths = runtimePaths(userData);
  const settings = { ...defaultSettings(), setupComplete: true, autoEnabled: false, retentionDays: 45 };
  const settingsFile = join(paths.state, 'settings.json');
  writeJson(settingsFile, settings);
  const fixtureKey = 'restricted-install-smoke';
  const database = new DatabaseSync(paths.database);
  try {
    database.prepare('INSERT INTO monitor_state (key, value) VALUES (?, ?)').run(fixtureKey, 'preserve');
  } finally { database.close(); }

  await install();
  const reopenedApp = await launch();
  try {
    const page = await reopenedApp.firstWindow();
    await page.locator('#dashboard').waitFor({ state: 'visible', timeout: 20_000 });
    const status = await page.evaluate(() => window.lms.getStatus());
    assert.equal(status.ok, true);
    assert.equal(status.data?.migration, 'EXISTING');
    assert.deepEqual(status.data?.settings, settings);
    assert.equal(status.data?.credentialsConfigured, false);
    assert.equal(status.data?.scheduler.state, 'ABSENT');
  } finally { await reopenedApp.close(); }

  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), settings);
  const existing = new DatabaseSync(paths.database, { readOnly: true });
  try {
    assert.equal(existing.prepare('SELECT value FROM monitor_state WHERE key = ?').get(fixtureKey)?.value, 'preserve');
  } finally { existing.close(); }
  assert.deepEqual(await getPolicy(), originalPolicy);
});
