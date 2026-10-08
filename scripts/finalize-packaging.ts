import { existsSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from '../src/utils/config.js';

const releaseRoot = resolve(PROJECT_ROOT, 'release');
function removeGenerated(path: string): void {
  const absolute = resolve(path);
  const within = relative(releaseRoot, absolute);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Unsafe release cleanup path.');
  if (existsSync(absolute)) rmSync(absolute, { force: true });
}

for (const name of ['builder-debug.yml', 'latest.yml']) removeGenerated(join(releaseRoot, name));
for (const name of readdirSync(releaseRoot)) {
  if (/^HS-LMS-Notifier-Setup-[0-9A-Za-z.-]+\.exe\.blockmap$/.test(name)) removeGenerated(join(releaseRoot, name));
}
removeGenerated(join(releaseRoot, 'win-unpacked', 'resources', 'app-update.yml'));
console.log('Removed development diagnostics and unused update metadata from release output.');
