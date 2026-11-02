import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {_electron} from 'playwright';
import {PROJECT_ROOT} from '../../src/utils/config.js';
import {defaultSettings} from '../../src/runtime/settings.js';
import {runtimePaths} from '../../src/runtime/paths.js';
import {writeJson} from '../../src/runtime/json.js';

test('unavailable Google login has a non-loading cursor, explains why, and stays disabled after another action',{timeout:60000},async()=>{
  await build({entryPoints:['tests/gui/fixture-main.ts'],outfile:'dist/gui/availability-fixture.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
  const work=join(PROJECT_ROOT,'work');mkdirSync(work,{recursive:true});
  const root=mkdtempSync(join(work,'calendar-availability-')),paths=runtimePaths(root);
  writeJson(join(paths.state,'settings.json'),{...defaultSettings(),setupComplete:true,autoEnabled:false});
  const app=await _electron.launch({args:[join(PROJECT_ROOT,'dist/gui/availability-fixture.mjs'),root],env:{...process.env,HS_LMS_FIXTURE_CALENDAR_UNAVAILABLE:'1'}});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#dashboard:not([hidden])');
    await page.getByRole('button',{name:'설정',exact:true}).click();
    const login=page.getByRole('button',{name:'Google로 로그인',exact:true});
    assert.equal(await login.isDisabled(),true);await login.hover();
    assert.equal(await login.evaluate(element=>getComputedStyle(element).cursor),'not-allowed');
    assert.match(await page.locator('#calendar-detail').innerText(),/대기해도 활성화되지 않/);
    assert.match((await login.getAttribute('title'))!,/서비스 설정/);
    const bounds=await login.boundingBox();assert.ok(bounds);await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    assert.equal((await page.evaluate(()=>window.lms.getSettings())).data?.googleCalendar.connectedAt,null);
    await page.evaluate(()=>{
      const element=document.getElementById('connect-calendar') as HTMLButtonElement;
      (window as any).auditUnexpectedEnable=false;
      const observer=new MutationObserver(records=>{if(records.some(record=>record.attributeName==='disabled')&&!element.disabled)(window as any).auditUnexpectedEnable=true;});
      observer.observe(element,{attributes:true,attributeFilter:['disabled']});
    });
    await page.getByLabel('로그 보관 기간 (일)',{exact:true}).fill('45');
    await page.getByRole('button',{name:'설정 저장',exact:true}).click();
    await page.waitForFunction(async()=>(await window.lms.getSettings()).data?.retentionDays===45);
    await page.waitForFunction(()=>!(document.querySelector('#options-form button[type="submit"]') as HTMLButtonElement).disabled);
    assert.equal(await login.isDisabled(),true);assert.equal(await page.evaluate(()=>(window as any).auditUnexpectedEnable),false);
    const output=join(PROJECT_ROOT,'outputs');mkdirSync(output,{recursive:true});
    await page.screenshot({path:join(output,'Google-로그인-비활성-포인터수정.png'),fullPage:true});
  }finally{await app.close();}
});
