import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron } from 'playwright';
import { PROJECT_ROOT } from '../../src/utils/config.js';
const require=createRequire(import.meta.url);
test('isolated Electron Wizard, dashboard, bridge boundaries, navigation and single instance', {timeout:90_000}, async()=>{
  await build({entryPoints:['tests/gui/fixture-main.ts'],outfile:'dist/gui/fixture-main.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
  const root=mkdtempSync(join(tmpdir(),'hs-lms-electron-fixture-'));
  const binary=require('electron') as string;
  // Use Playwright's development launcher so its loader strips inspection flags.
  const application=await _electron.launch({args:[join(PROJECT_ROOT,'dist/gui/fixture-main.mjs'),root]});
  const diagnostic: string[]=[];
  application.process().stderr?.on('data',chunk=>diagnostic.push(String(chunk)));
  try {
    const page=await application.firstWindow();
    await page.getByRole('button',{name:'시작하기',exact:true}).click();
    await page.getByLabel('학번 / LMS ID').fill('synthetic-student');
    await page.getByLabel('비밀번호',{exact:true}).fill('synthetic-only');
    await page.getByRole('button',{name:'새 로그인 정보 저장',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('message')?.textContent?.includes('로그인 정보를 저장했습니다.'));
    assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('학번 / LMS ID').inputValue(),'');
    await page.getByRole('button',{name:'자동 로그인 테스트',exact:true}).click();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.getByLabel('새 Webhook URL',{exact:true}).fill('https://discord.com/api/webhooks/123/synthetic_only');
    await page.getByRole('button',{name:'새 Webhook 저장',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('message')?.textContent?.includes('알림 주소를 저장했습니다.'));
    assert.equal(await page.getByLabel('새 Webhook URL',{exact:true}).inputValue(),'');
    await page.getByRole('button',{name:'테스트 알림 보내기',exact:true}).click();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.getByRole('button',{name:'설정 완료하고 첫 확인',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('count-courses')?.textContent==='1');
    assert.equal(await page.locator('#dashboard').isVisible(),true);
    await page.getByRole('button',{name:'설정',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'기존 개발용 예약 작업 전환',exact:true}).isVisible(),true);
    await page.getByRole('button',{name:'기존 개발용 예약 작업 전환',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('message')?.textContent?.includes('기존 개발용 예약 작업을 안전하게 전환했습니다.'));
    assert.equal(await page.locator('#migrate-scheduler').isHidden(),true);
    await page.getByRole('button',{name:'대시보드',exact:true}).click();
    assert.equal(await page.locator('#todo-assignments').textContent(),'1');
    assert.equal(await page.locator('#todo-lectures').textContent(),'1');
    assert.equal(await page.locator('#todo-unknown').textContent(),'2');
    assert.equal(await page.locator('#todo-list li').count(),4);
    assert.match(await page.locator('#todo-list').innerText(),/상태 확인 필요/);
    assert.doesNotMatch(await page.locator('#todo-list').innerText(),/합성 제출 완료|합성 출석 완료/);
    const boundary=await page.evaluate(async()=>({node:typeof (globalThis as unknown as {require?:unknown}).require,
      keys:Object.keys(window.lms),status:await window.lms.getStatus(),bad:await window.lms.updateSettings({autoEnabled:true,retentionDays:-1})}));
    assert.equal(boundary.node,'undefined'); assert.equal(boundary.bad.ok,false);
    assert.doesNotMatch(JSON.stringify(boundary.status),/synthetic_only|synthetic-only|synthetic-student/);
    assert.equal(boundary.keys.includes('runCommand'),false);
    const isolation=await application.evaluate(({app,BrowserWindow})=>({sandboxed:app.getAppMetrics().filter(m=>m.type==='Tab').every(m=>m.sandboxed),
      devtools:BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened()}));
    assert.equal(isolation.sandboxed,true); assert.equal(isolation.devtools,false);
    await page.evaluate(()=>{window.open('https://example.com');});
    assert.equal(application.windows().length,1);
    await page.getByRole('button',{name:'설정',exact:true}).click();
    for (const key of ['d7','d3','d1','d0'] as const) {
      assert.equal(await page.locator(`#deadline-${key}`).isChecked(),true);
      await page.locator(`#deadline-${key}`).uncheck();
      await page.waitForFunction(async k=>(await window.lms.getSettings()).data?.deadlineNotifications[k]===false,key);
      await page.waitForFunction(()=>document.getElementById('message')?.textContent?.includes('마감 알림 설정을 저장했습니다.'));
    }
    await page.reload();
    await page.getByRole('button',{name:'설정',exact:true}).click();
    for (const key of ['d7','d3','d1','d0']) assert.equal(await page.locator(`#deadline-${key}`).isChecked(),false);
    await page.getByRole('button',{name:'대시보드',exact:true}).click();
    assert.equal(await page.locator('#todo-list li').count(),4); // OFF affects delivery only.
    await page.getByRole('button',{name:'지금 확인',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('todo-empty')?.hidden===false);
    assert.equal(await page.locator('#todo-list li').count(),0);
    await page.getByRole('button',{name:'설정',exact:true}).click();
    await page.getByLabel('로그 보관 기간 (일)').fill('45');
    await page.getByRole('button',{name:'설정 저장',exact:true}).click();
    await page.waitForFunction(async()=> (await window.lms.getSettings()).data?.retentionDays===45);
    // Second process has same userData and exits instead of owning another window.
    const {spawn}=await import('node:child_process');
    const second=spawn(binary,[join(PROJECT_ROOT,'dist/gui/fixture-main.mjs'),root],{stdio:'ignore',windowsHide:true});
    const exit=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{second.kill();reject(new Error('second instance did not exit'));},10_000);second.once('exit',code=>{clearTimeout(timer);resolve(code);});});
    assert.equal(exit,0); assert.equal(application.windows().length,1);
    const saved=await page.evaluate(async()=>await window.lms.getStatus());
    await application.evaluate(({ipcMain},reply)=>{
      ipcMain.removeHandler('hs-lms:request');
      ipcMain.handle('hs-lms:request',()=>({...reply,data:{...reply.data,todo:{items:'malformed'}}}));
    },saved);
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('todo-coverage')?.textContent?.includes('할 일 데이터를 확인할 수 없습니다.'));
    assert.equal(await page.locator('#todo-assignments').textContent(),'—');
    const original=page.url();
    await page.evaluate(()=>{location.href='https://example.com';});
    await application.evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,200));});
    assert.equal(page.url(),original);
  } catch(error) { console.error(diagnostic.join('').slice(-4000)); throw error; }
  finally { await application.close(); rmSync(root,{recursive:true,force:true}); }
});
