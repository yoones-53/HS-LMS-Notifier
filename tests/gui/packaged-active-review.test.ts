import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {_electron} from 'playwright';
import {LmsStore} from '../../src/database/store.js';
import {runtimePaths} from '../../src/runtime/paths.js';
import {defaultSettings} from '../../src/runtime/settings.js';
import {writeJson} from '../../src/runtime/json.js';
import {inspectScheduler} from '../../src/desktop/scheduler.js';

// With an already active production task, autoEnabled=true keeps startup read-only.
// Never toggle auto scheduling or run a collection in this smoke test.
test('packaged release starts with isolated empty data while preserving an active production schedule',{timeout:60000},async t=>{
  const before=await inspectScheduler();
  if(before.mode!=='PRODUCTION'||before.state!=='ACTIVE'||!before.targetCurrent){t.skip('Requires a pre-existing active owned production schedule.');return;}
  mkdirSync('work',{recursive:true});mkdirSync('outputs',{recursive:true});
  const root=mkdtempSync(resolve('work','release-smoke-')),paths=runtimePaths(root);
  const store=new LmsStore(paths.database);store.close();
  writeJson(join(paths.state,'settings.json'),{...defaultSettings(),setupComplete:true,autoEnabled:true});
  const app=await _electron.launch({executablePath:resolve('release/win-unpacked/HS-LMS-Notifier.exe'),args:[`--user-data-dir=${root}`],timeout:25000});
  try {
    const page=await app.firstWindow();await page.waitForSelector('#dashboard:not([hidden])');
    const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,electron:process.versions.electron}));
    assert.deepEqual(runtime,{packaged:true,electron:'44.10.1'});
    await app.evaluate(()=>{const g=globalThis as any;g.releaseNetworkAttempts=0;g.fetch=async()=>{g.releaseNetworkAttempts++;throw Error('RELEASE_REVIEW_NETWORK_BLOCKED');};});
    await page.getByRole('button',{name:'설정',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Google로 로그인',exact:true}).isDisabled(),true);
    assert.equal(await page.getByLabel('Google 캘린더로 마감 받기',{exact:true}).isChecked(),false);
    const boundary=await page.evaluate(()=>({node:typeof (globalThis as any).require}));assert.equal(boundary.node,'undefined');
    const denied=await page.evaluate(()=>window.lms.updateSettings({autoEnabled:true,retentionDays:30,unexpectedSecret:'SYNTHETIC_ONLY'} as any));assert.equal(denied.ok,false);
    assert.equal(await app.evaluate(()=>(globalThis as any).releaseNetworkAttempts),0);
    await page.screenshot({path:resolve('outputs','release-smoke-settings.png'),fullPage:true});
    writeFileSync('outputs/release-packaged-smoke.json',JSON.stringify({runtime,isolatedData:true,googleLoginDisabled:true,googleCalendarOff:true,nodeIntegrationUnavailable:true,invalidIpcRejected:true,networkAttemptsAfterInstrumentation:0},null,2));
  } finally {const shutdown=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(shutdown);}}
  assert.deepEqual(await inspectScheduler(),before);
});
