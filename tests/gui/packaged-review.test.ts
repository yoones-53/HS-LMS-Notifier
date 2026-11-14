import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {_electron} from 'playwright';
import {extractFile} from '@electron/asar';
import {LmsStore} from '../../src/database/store.js';
import {runtimePaths} from '../../src/runtime/paths.js';
import {defaultSettings} from '../../src/runtime/settings.js';
import {writeJson} from '../../src/runtime/json.js';
import {parseCourse} from '../../src/crawler/courses.js';
import {parseAssignment} from '../../src/crawler/assignments.js';
import {parseOnlineRow} from '../../src/crawler/videos.js';
import {runMonitor} from '../../src/monitor.js';
import {inspectScheduler} from '../../src/desktop/scheduler.js';
import {databaseSignature} from '../../src/runtime/migration.js';
import {PROJECT_ROOT} from '../../src/utils/config.js';

const output=join(PROJECT_ROOT,'outputs');
test('actual packaged executable: OFF UI, validation failure, XSS boundary, storage isolation and scheduler noninterference',{timeout:120000},async t=>{
  const before=await inspectScheduler();
  if(before.targetCurrent||before.legacyActive){t.skip('An active/global owned scheduler prevents a mutation-free isolated production launch.');return;}
  const work=join(PROJECT_ROOT,'work');mkdirSync(work,{recursive:true});mkdirSync(output,{recursive:true});
  const root=mkdtempSync(join(work,'packaged-review-')),paths=runtimePaths(root),store=new LmsStore(paths.database);
  const course=parseCourse({id:'selfarea_TEST1_A',href:"javascript:fncGoClassroom('TEST1','A','3');",title:'개인정보 없는 검수 과목'},{year:'2026년',term:'2학기'});
  const title='<img src="https://audit.invalid/x" onerror="globalThis.auditXss=1"> 검수 과제';
  const assignment={...parseAssignment({onclick:"fncModifyReport('1', 'N', '1', 'Y','Y')",title,period:null,submission:'미제출',progress:null},course),dueAt:'2026-11-07T23:59:00+09:00'};
  const video={...parseOnlineRow({id:'1',contentId:null,title:'개인정보 없는 검수 강의',period:null,status:null},course)!,dueAt:assignment.dueAt,completed:false};
  try{await runMonitor(store,{courses:async()=>[course],enter:async()=>{},collect:async(_c,type)=>({status:'OK',items:type==='ASSIGNMENT'?[assignment]:type==='VIDEO'?[video]:[]})},async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},dispose:async()=>{},deliveryDelayMs:0});}
  finally{store.close();}
  const settings=defaultSettings();settings.setupComplete=true;settings.autoEnabled=false;settings.trayHintShown=true;
  settings.googleCalendar={enabled:false,connectedAt:new Date().toISOString()};writeJson(join(paths.state,'settings.json'),settings);
  const logicalDb=()=>{const db=new DatabaseSync(paths.database,{readOnly:true});try{return databaseSignature(db);}finally{db.close();}};
  const beforeDb=logicalDb();
  const packaged=resolve('release/win-unpacked');const pkg=JSON.parse(extractFile(join(packaged,'resources/app.asar'),'package.json').toString());
  const app=await _electron.launch({executablePath:join(packaged,'HS-LMS-Notifier.exe'),args:[`--user-data-dir=${root}`],timeout:30000});
  try{
    console.log('PACKAGED_DIAGNOSTICS',JSON.stringify(await app.evaluate(({app})=>({defaultApp:process.defaultApp??false,node:process.versions.node,electron:process.versions.electron,
      debugGuardNames:['DEBUG','PWDEBUG','NODE_DEBUG','NODE_DEBUG_NATIVE','DEBUG_FILE'].filter(key=>!!process.env[key]),packaged:app.isPackaged}))));
    const page=await app.firstWindow({timeout:20000});await page.waitForSelector('#dashboard:not([hidden])',{timeout:15000});
    await app.evaluate(()=>{const g=globalThis as any;g.auditRequests=[];g.fetch=async(input:any)=>{g.auditRequests.push(new URL(String(input)).hostname);throw new Error('AUDIT_EXTERNAL_NETWORK_BLOCKED');};});
    const boundary=await page.evaluate(()=>({node:typeof (globalThis as any).require,xss:(globalThis as any).auditXss??null,images:document.querySelectorAll('#todo-list img').length}));
    assert.equal(boundary.node,'undefined');assert.equal(boundary.xss,null);assert.equal(boundary.images,0);
    assert.match(await page.locator('#todo-list').innerText(),/onerror=/);assert.equal(await page.locator('#todo-list li').count(),2);
    await page.screenshot({path:join(output,'직접검수-preview2-대시보드.png'),fullPage:true});
    await page.getByRole('button',{name:'설정',exact:true}).click();
    assert.equal(await page.getByLabel('Google 캘린더로 마감 받기',{exact:true}).isChecked(),false);
    assert.equal(await page.getByRole('button',{name:'Google로 로그인',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'연결 검수 · 기존 마감 반영',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('message')?.classList.contains('error'));
    assert.match(await page.locator('#message').innerText(),/Google 연결/);
    assert.equal((await page.evaluate(()=>window.lms.getSettings())).data?.googleCalendar.enabled,false);
    await page.getByLabel('Google 캘린더로 마감 받기',{exact:true}).click();
    await page.waitForFunction(()=>{const input=document.getElementById('calendar-enabled') as HTMLInputElement;return !input.disabled&&input.checked;});
    await page.waitForFunction(()=>document.getElementById('calendar-alert')?.hidden===false);
    await page.getByLabel('Google 캘린더로 마감 받기',{exact:true}).click();
    await page.waitForFunction(()=>{const input=document.getElementById('calendar-enabled') as HTMLInputElement;return !input.disabled&&!input.checked;});
    await page.waitForFunction(()=>document.getElementById('calendar-alert')?.hidden===true);
    await page.reload();await page.waitForFunction(()=>document.getElementById('header-status')?.textContent!=='준비 중');await page.getByRole('button',{name:'설정',exact:true}).click();
    assert.equal(await page.getByLabel('Google 캘린더로 마감 받기',{exact:true}).isChecked(),false);
    const denied=await page.evaluate(()=>window.lms.updateSettings({autoEnabled:false,retentionDays:30,unexpectedSecret:'SYNTHETIC_ONLY'} as any));assert.equal(denied.ok,false);
    const requests=await app.evaluate(()=>(globalThis as any).auditRequests);assert.deepEqual(requests,[]);
    const prefs=await app.evaluate(({app,BrowserWindow})=>({sandbox:app.getAppMetrics().filter(m=>m.type==='Tab').every(m=>m.sandboxed),devToolsOpened:BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened()}));
    assert.deepEqual(prefs,{sandbox:true,devToolsOpened:false});
    await page.screenshot({path:join(output,'직접검수-preview2-설정꺼짐.png'),fullPage:true});
    console.log('PACKAGED_UI_READY');
    const hold=Number(process.env.HS_LMS_REVIEW_HOLD_MS??'0');if(hold>0)await new Promise(resolve=>setTimeout(resolve,Math.min(hold,45000)));
    writeFileSync(join(output,'실행파일-직접검수.json'),JSON.stringify({version:pkg.version,isolatedData:true,googleConfigured:false,googleOffPersisted:true,
      networkAttemptsAfterInstrumentation:requests,boundary,prefs,schedulerBefore:before,screenshots:['직접검수-preview2-대시보드.png','직접검수-preview2-설정꺼짐.png']},null,2));
  }finally{const shutdown=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(shutdown);}}
  assert.deepEqual(await inspectScheduler(),before);
  assert.deepEqual(logicalDb(),beforeDb); // SQLite may update file headers while preserving every row.
});
