import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
// Desktop OAuth client metadata belongs to the developer's release configuration.
// Refresh/access tokens are NEVER build inputs or artifacts. Users only see Google login.
const clientId=process.env.HS_LMS_GOOGLE_CLIENT_ID??'';
const clientSecret=process.env.HS_LMS_GOOGLE_CLIENT_SECRET??'';
if(process.env.HS_LMS_REQUIRE_GOOGLE_LOGIN==='1' && (!clientId || !clientSecret))
  throw new Error('Google login release requires the developer desktop OAuth client configuration.');
if((clientId || clientSecret) && (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret || clientSecret.length>128))
  throw new Error('Invalid desktop Google OAuth release configuration.');
const oauthDefine={GOOGLE_DESKTOP_CLIENT_ID:JSON.stringify(clientId),GOOGLE_DESKTOP_CLIENT_SECRET:JSON.stringify(clientSecret)};
const out = 'dist/gui';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/login-readiness.json`,JSON.stringify({version:1,googleLoginConfigured:!!clientId&&!!clientSecret})+'\n');
await Promise.all([
  build({ entryPoints: ['src/desktop/main.ts'], outfile: `${out}/main.mjs`, bundle: true, platform: 'node', format: 'esm', packages: 'external', define:oauthDefine }),
  build({ entryPoints: ['src/desktop/preload.ts'], outfile: `${out}/preload.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['src/desktop/renderer/app.ts'], outfile: `${out}/renderer.js`, bundle: true, platform: 'browser', format: 'iife' }),
]);
for (const name of ['index.html', 'style.css', 'todo.css']) copyFileSync(`src/desktop/renderer/${name}`, `${out}/${name}`);
console.log('GUI build complete.');
