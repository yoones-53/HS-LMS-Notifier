import { existsSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from '../src/utils/config.js';
import { listPackage } from '@electron/asar';

const releaseRoot = resolve(PROJECT_ROOT, 'release');
const guiFiles=new Set(['main.mjs','preload.cjs','renderer.js','index.html','style.css','todo.css','login-readiness.json']);
for(const entry of listPackage(join(releaseRoot,'win-unpacked','resources','app.asar'),{isPack:false})) {
  const normalized=entry.replaceAll('\\','/').replace(/^\//,'');
  if(normalized.startsWith('dist/gui/') && !guiFiles.has(normalized.slice('dist/gui/'.length))) {
    throw new Error('Unexpected file in packaged GUI; release blocked.');
  }
  if(/(?:^|\/)(?:\.env(?:\.[^/]*)?|client_secret[^/]*\.json|credentials[^/]*\.json|cookies[^/]*\.json|storage-state[^/]*\.json|[^/]+\.(?:sqlite|sqlite3|db)(?:-wal|-shm)?)$/.test(normalized)) {
    throw new Error('Private runtime/configuration file in package; release blocked.');
  }
}
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
