import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
const out = 'dist/gui';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/desktop/main.ts'], outfile: `${out}/main.mjs`, bundle: true, platform: 'node', format: 'esm', packages: 'external' }),
  build({ entryPoints: ['src/desktop/preload.ts'], outfile: `${out}/preload.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['src/desktop/renderer/app.ts'], outfile: `${out}/renderer.js`, bundle: true, platform: 'browser', format: 'iife' }),
]);
for (const name of ['index.html', 'style.css', 'todo.css']) copyFileSync(`src/desktop/renderer/${name}`, `${out}/${name}`);
console.log('GUI build complete.');
