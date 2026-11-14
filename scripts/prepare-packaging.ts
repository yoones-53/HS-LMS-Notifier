import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../src/utils/config.js';

if (process.platform !== 'win32') throw new Error('Windows packaging must run on Windows.');

const buildRoot = resolve(PROJECT_ROOT, 'build');
const cacheRoot = join(buildRoot, 'playwright-cache');
const stagingRoot = join(buildRoot, 'packaging', 'playwright-runtime');

function assertGeneratedPath(path: string): void {
  const within = relative(buildRoot, resolve(path));
  if (!within || within.startsWith(`..${sep}`) || within === '..' || isAbsolute(within)) throw new Error('Unsafe generated path.');
}

assertGeneratedPath(cacheRoot);
assertGeneratedPath(stagingRoot);
mkdirSync(cacheRoot, { recursive: true });

const environment = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cacheRoot };
const install = spawnSync(process.execPath, [join(PROJECT_ROOT, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'],
  { cwd: PROJECT_ROOT, env: environment, stdio: 'inherit', windowsHide: true });
if (install.status !== 0) throw new Error('Playwright Chromium preparation failed.');

const query = [
  "import { chromium } from 'playwright';",
  "process.stdout.write(chromium.executablePath());",
].join(' ');
const located = spawnSync(process.execPath, ['--input-type=module', '-e', query],
  { cwd: PROJECT_ROOT, env: environment, encoding: 'utf8', windowsHide: true, maxBuffer: 16_384 });
if (located.status !== 0) throw new Error('Bundled Chromium path lookup failed.');
const executable = resolve(located.stdout.trim());
const withinCache = relative(cacheRoot, executable);
if (!existsSync(executable) || !withinCache || withinCache.startsWith(`..${sep}`) || isAbsolute(withinCache)) {
  throw new Error('Bundled Chromium path is outside the packaging cache.');
}

const browserRoot = dirname(dirname(executable));
const executableWithinBrowser = relative(browserRoot, executable);
if (!executableWithinBrowser || executableWithinBrowser.startsWith(`..${sep}`) || isAbsolute(executableWithinBrowser)) {
  throw new Error('Invalid Chromium executable layout.');
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
cpSync(browserRoot, join(stagingRoot, 'chromium'), { recursive: true, force: true });
writeFileSync(join(stagingRoot, 'browser-manifest.json'), JSON.stringify({
  version: 1,
  executable: ['chromium', ...executableWithinBrowser.split(sep)].join('/'),
}, null, 2) + '\n', 'utf8');

// Read back once so a truncated manifest fails before the expensive installer build.
JSON.parse(readFileSync(join(stagingRoot, 'browser-manifest.json'), 'utf8'));
console.log('Production Chromium runtime prepared from the Playwright-pinned browser.');
