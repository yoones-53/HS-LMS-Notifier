import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBundledChromium } from '../src/browser/packaged.js';
import { packagedResourcesRoot } from '../src/utils/resources.js';

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
