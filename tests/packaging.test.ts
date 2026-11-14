import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { resolveBundledChromium } from '../src/browser/packaged.js';
import { packagedResourcesRoot } from '../src/utils/resources.js';
import { execFileSync } from 'node:child_process';
import { PROJECT_ROOT } from '../src/utils/config.js';

test('Windows AppData helper preserves Korean paths under a legacy code page', { skip: process.platform !== 'win32' }, () => {
  const work = join(PROJECT_ROOT, 'work');
  mkdirSync(work, { recursive: true });
  const directory = mkdtempSync(join(work, 'runtime-path-'));
  const koreanFolder = String.fromCodePoint(0xd55c);
  const helper = readFileSync(join(PROJECT_ROOT, 'scripts/windows/runtime-root.ps1'), 'utf8');
  const source = helper.replace(
    "[Environment]::GetFolderPath('ApplicationData')",
    '(Join-Path (Get-Location) ([string][char]0xD55C))',
  );
  try {
    const command = '[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(1252)\n' + source;
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const output = execFileSync(powershell, [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
    ], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 });
    assert.equal(JSON.parse(output.trim()).root, join(directory, koreanFolder, 'HS-LMS-Notifier'));
  } finally {
    const target = realpathSync(directory);
    assert.ok(target.startsWith(realpathSync(work) + sep));
    rmSync(target, { recursive: true, force: true });
  }
});

test('packaged Chromium manifest accepts only an existing executable below resources', t => {
  const root = mkdtempSync(join(tmpdir(), 'hs-lms-package-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const browser = join(root, 'playwright', 'chromium', 'chrome-win64', 'chrome.exe');
  mkdirSync(join(root, 'playwright', 'chromium', 'chrome-win64'), { recursive: true });
  writeFileSync(browser, 'synthetic executable');
  const manifest = join(root, 'playwright', 'browser-manifest.json');
  writeFileSync(manifest, JSON.stringify({ version: 1, executable: 'chromium/chrome-win64/chrome.exe' }));
  assert.equal(resolveBundledChromium(root), browser);
  writeFileSync(manifest, JSON.stringify({ version: 1, executable: '../outside.exe' }));
  writeFileSync(join(root, 'outside.exe'), 'outside');
  assert.throws(() => resolveBundledChromium(root), /INITIALIZATION_ERROR/);
});

test('resource root is active only in packaged Electron processes', () => {
  const packaged = { resourcesPath: 'C:\\synthetic\\resources', defaultApp: false };
  const development = { resourcesPath: 'C:\\synthetic\\resources', defaultApp: true };
  assert.equal(packagedResourcesRoot(packaged), packaged.resourcesPath);
  assert.equal(packagedResourcesRoot(development), undefined);
});
