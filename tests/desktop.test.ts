import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { LmsStore } from '../src/database/store.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
import { runMonitor } from '../src/monitor.js';
import { INITIAL_SUMMARY_KEY } from '../src/notification/initial-summary.js';
import { acquireRuntimeLock, isAllowedDesktopRoot, resolveRuntimePaths, routePath, runtimePaths } from '../src/runtime/paths.js';
import { databaseSignature, migrateRuntime } from '../src/runtime/migration.js';
import { DataFileError, parseJson, writeJson } from '../src/runtime/json.js';
import { cleanOldLogs } from '../src/runtime/retention.js';
import { DesktopService, type DesktopDependencies } from '../src/desktop/service.js';
import { parseSchedulerStatus } from '../src/desktop/scheduler.js';
import { requestSchema, settingsSchema, type SchedulerStatus } from '../src/desktop/contracts.js';
import { readHistory } from '../src/desktop/history.js';
import { isTrustedSender } from '../src/desktop/ipc-policy.js';
import { guiRun } from '../src/status/schema.js';
import { runResult } from '../src/status/model.js';
import { credentialBridge, readCredentials, saveCredentials } from '../src/auth/credentials.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'hs-lms-gui-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, legacy: runtimePaths(join(root, 'legacy'), true), target: runtimePaths(join(root, 'userData')) };
}
async function seed(path: string) {
  const db = new LmsStore(path);
  const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, { year: '2026년', term: '2학기' });
  const notice = parseBoardRow({ id: '1', title: '합성 공지', date: null }, course, 'NOTICE');
  try {
    await runMonitor(db, { courses: async () => [course], enter: async () => {}, collect: async (_c, type) => ({ status: 'OK', items: type === 'NOTICE' ? [notice] : [] }) },
      async () => ({ status: 'SENT' }), () => {}, { authenticate: async () => {}, dispose: async () => {}, deliveryDelayMs: 0 });
    return databaseSignature(db.db);
  } finally { db.close(); }
}
function dependencies(overrides: Partial<DesktopDependencies> = {}): DesktopDependencies {
  return { configured: async () => true, readId: async () => 'synthetic-student', saveLogin: async () => {},
    removeLogin: async () => {}, saveDiscord: async () => {}, legacyWebhook: () => undefined,
    testLogin: async () => {}, testDiscord: async () => {}, run: async () => ({ ...runResult('SUCCESS'), authentication: 'OK', browserClosed: true }),
    scheduler: async () => ({ state: 'ABSENT', nextAt: null, mode: 'ABSENT', legacyDetected: false, legacyActive: false, targetCurrent: false }),
    schedulerPolicy: 'TIMER', syncScheduler: async () => ({ state: 'ABSENT', nextAt: null, mode: 'ABSENT', legacyDetected: false, legacyActive: false, targetCurrent: false }), open: async () => {}, ...overrides };
}

test('runtime path injection rejects relative roots and route escapes', async t => {
  const f = fixture(t); assert.throws(() => runtimePaths('relative'), DataFileError);
  assert.equal(resolveRuntimePaths(f.legacy, f.target.root).database, f.legacy.database);
  mkdirSync(join(f.legacy.root, 'data'), { recursive: true });
  writeJson(routePath(f.legacy), { version: 1, root: f.root, migrationId: randomUUID() });
  assert.throws(() => resolveRuntimePaths(f.legacy, f.target.root), DataFileError);
});
test('MSIX physical AppData is allowed only inside current user package cache and fixed app suffix',t=>{
  const f=fixture(t);const local=join(f.root,'AppData','Local');
  assert.ok(isAllowedDesktopRoot(join(local,'Packages','Example.Package_test','LocalCache','Roaming','HS-LMS-Notifier'),f.target.root,local));
  for(const root of [join(local,'other','HS-LMS-Notifier'),join(local,'Packages','test','LocalCache','Roaming','other'),join(local,'Packages','test','LocalCache','Roaming','HS-LMS-Notifier','extra')])
    assert.equal(isAllowedDesktopRoot(root,f.target.root,local),false);
});
test('migration preserves every baseline, item, history, incident and initial summary row exactly', async t => {
  const f = fixture(t); const original = await seed(f.legacy.database);
  assert.equal(await migrateRuntime(f.legacy, f.target), 'MIGRATED');
  for (const path of [f.legacy.database, f.target.database]) {
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.deepEqual(databaseSignature(db), original); assert.equal(db.prepare('SELECT status FROM notification_history WHERE notification_key=?').get(INITIAL_SUMMARY_KEY)?.status, 'SENT'); }
    finally { db.close(); }
  }
  assert.equal(resolveRuntimePaths(f.legacy, f.target.root).database, f.target.database);
  assert.equal(await migrateRuntime(f.legacy, f.target), 'EXISTING');
});
test('packaged same-root runtime validates and reuses its database without a migration route', async t => {
  const f = fixture(t);
  assert.equal(await migrateRuntime(f.target, f.target), 'FRESH');
  assert.equal(existsSync(f.target.database), true);
  const original = await seed(f.target.database);
  assert.equal(await migrateRuntime(f.target, f.target), 'EXISTING');
  const db = new DatabaseSync(f.target.database, { readOnly: true });
  try { assert.deepEqual(databaseSignature(db), original); } finally { db.close(); }
  assert.equal(existsSync(routePath(f.target)), false);
});
test('migration fails closed on corrupt schema, leaving source bytes and no activation', async t => {
  const f = fixture(t); mkdirSync(join(f.legacy.root, 'data'), { recursive: true });
  writeFileSync(f.legacy.database, 'not a database'); const before = readFileSync(f.legacy.database);
  await assert.rejects(migrateRuntime(f.legacy, f.target), DataFileError);
  assert.deepEqual(readFileSync(f.legacy.database), before); assert.equal(existsSync(f.target.database), false);
  assert.equal(existsSync(routePath(f.legacy)), false);
});
test('migration never overwrites an existing destination or bypasses a running CLI lock', async t => {
  const f = fixture(t); await seed(f.legacy.database);
  const release = acquireRuntimeLock(f.legacy, f.legacy)!;
  try { await assert.rejects(migrateRuntime(f.legacy, f.target), /SCHEDULER_LOCKED/); } finally { release(); }
  await seed(f.target.database); const before = readFileSync(f.target.database);
  await assert.rejects(migrateRuntime(f.legacy, f.target), DataFileError);
  assert.deepEqual(readFileSync(f.target.database), before); assert.equal(existsSync(routePath(f.legacy)), false);
});
test('migration activation failure rolls back only its unpublished destination, retains original', async t => {
  const f = fixture(t); await seed(f.legacy.database);
  const original = readFileSync(f.legacy.database);
  await assert.rejects(migrateRuntime(f.legacy, f.target,()=>{
    assert.ok(existsSync(f.target.database)); assert.ok(existsSync(join(f.target.state,'migration.json')));
    throw new Error('synthetic activation I/O failure');
  }), DataFileError);
  assert.deepEqual(readFileSync(f.legacy.database), original); assert.equal(existsSync(f.target.database), false);
  assert.equal(existsSync(join(f.target.state,'migration.json')),false); assert.equal(existsSync(routePath(f.legacy)),false);
});
test('malformed/unsupported JSON, migration metadata and recent result stop safely', async t => {
  const f = fixture(t); await migrateRuntime(f.legacy, f.target);
  for (const text of ['{', '{"version":999}', 'null', '[]']) assert.throws(() => parseJson(text, settingsSchema), DataFileError);
  writeFileSync(join(f.target.logs, 'latest-run.json'), '{'); assert.throws(() => readHistory(f.target), DataFileError);
  writeFileSync(join(f.target.state, 'migration.json'), '{}'); assert.throws(() => resolveRuntimePaths(f.legacy, f.target.root), DataFileError);
});
test('GUI projects canonical status text, never arbitrary persisted secret properties', () => {
  const result = guiRun({ ...runResult('SUCCESS'), reason: 'synthetic-private-reason', password: 'synthetic-private-password', cookie: 'synthetic-private-cookie' });
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
});
test('IPC rejects arbitrary commands, paths, unknown fields, malformed secrets and iframe senders', () => {
  for (const value of [{ method: 'runCommand', payload: 'anything' }, { method: 'openLogs', payload: 'C:\\' },
    { method: 'runCheck', extra: true }, { method: 'setupCredentials', payload: { id: 'x', password: '' } },
    { method: 'updateSettings', payload: { autoEnabled: true, retentionDays: 0 } }]) assert.equal(requestSchema.safeParse(value).success, false);
  const url = 'file:///trusted/index.html';
  assert.equal(isTrustedSender(1,1,true,url+'#settings',url),true);
  for (const args of [[2,1,true,url,url],[1,1,false,url,url],[1,1,true,'https://example.com',url]] as const) assert.equal(isTrustedSender(args[0],args[1],args[2],args[3],args[4]),false);
});
test('retention deletes only expired dated logs, not current logs, JSON, DB or directories', t => {
  const f = fixture(t); mkdirSync(f.target.logs, { recursive: true });
  for (const name of ['monitor-2026-08-01.jsonl','scheduler-2026-08-01.log','monitor-2026-10-07.jsonl','latest-run.json','lms.sqlite','scheduler.log']) writeFileSync(join(f.target.logs,name),'fixture');
  mkdirSync(join(f.target.logs,'monitor-2026-07-01.jsonl'));
  cleanOldLogs(f.target.logs,30,new Date('2026-10-07T12:00:00+09:00'));
  assert.equal(existsSync(join(f.target.logs,'monitor-2026-08-01.jsonl')),false);
  assert.equal(existsSync(join(f.target.logs,'scheduler-2026-08-01.log')),false);
  for (const name of ['monitor-2026-10-07.jsonl','latest-run.json','lms.sqlite','scheduler.log','monitor-2026-07-01.jsonl']) assert.ok(existsSync(join(f.target.logs,name)));
});
test('existing successful CLI setup migrates into dashboard and secret-free DTOs', async t => {
  const f = fixture(t); await seed(f.legacy.database);
  const service = new DesktopService(f.target,f.legacy,dependencies()); await service.initialize();
  t.after(() => { void service.close(); });
  const result = await service.handle({ method: 'getStatus' });
  assert.equal(result.ok,true); const state = await service.status();
  assert.equal(state.settings.setupComplete,true); assert.equal(state.recent[0]?.counts.courses,1);
  assert.equal(state.credentialsConfigured,true); assert.doesNotMatch(JSON.stringify(state),/synthetic-student|password|webhook/i);
});
test('wizard requires successful credential and Discord tests; settings cannot fake completion', async t => {
  const f = fixture(t); const service = new DesktopService(f.target,f.legacy,dependencies()); await service.initialize();
  assert.equal((await service.handle({method:'completeSetup'})).ok,false);
  assert.equal((await service.handle({method:'updateSettings',payload:{autoEnabled:true,retentionDays:30,setupComplete:true}})).ok,false);
  assert.equal((await service.handle({method:'testCredentials'})).ok,true);
  assert.equal((await service.handle({method:'testDiscord'})).ok,true);
  assert.equal((await service.handle({method:'completeSetup'})).ok,true);
  assert.equal((await service.status()).settings.setupComplete,true); await service.close();
});
test('tray explanation is persisted once and settings retain no secret fields',async t=>{
  const f=fixture(t);const service=new DesktopService(f.target,f.legacy,dependencies());await service.initialize();
  assert.equal(service.trayHint(),true);assert.equal(service.trayHint(),false);
  const saved=JSON.parse(readFileSync(join(f.target.state,'settings.json'),'utf8'));
  assert.equal(saved.trayHintShown,true);assert.equal(settingsSchema.safeParse({...saved,password:'synthetic'}).success,false);
  await service.close();
});
test('runCheck coalesces double clicks and obeys OS execution lock; shutdown aborts and releases', async t => {
  const f = fixture(t); let calls = 0; let aborted = false;
  const service = new DesktopService(f.target,f.legacy,dependencies({ run: async (_paths, signal) => {
    calls++; await new Promise<void>(resolve => signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true})); return runResult('UNKNOWN_ERROR');
  } })); await service.initialize();
  const first = service.handle({method:'runCheck'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await service.handle({method:'runCheck'})).ok,false); assert.equal(acquireRuntimeLock(f.target,f.legacy),null);
  await service.close(); await first; assert.equal(calls,1); assert.equal(aborted,true);
  const released = acquireRuntimeLock(f.target,f.legacy); assert.ok(released); released();
});
test('development timer defers to active legacy scheduler and production policy never starts a GUI timer', async t => {
  for (const state of ['ACTIVE','UNKNOWN','INACTIVE'] as const) {
    const f = fixture(t); await seed(f.legacy.database); let calls=0;
    const service = new DesktopService(f.target,f.legacy,dependencies({scheduler:async()=>({state,nextAt:null,mode:state === 'ACTIVE' ? 'LEGACY' : state === 'UNKNOWN' ? 'UNKNOWN' : 'ABSENT',legacyDetected:state === 'ACTIVE',legacyActive:state === 'ACTIVE',targetCurrent:false}),run:async()=>{calls++;return runResult('SUCCESS');}}));
    await service.initialize(); await service.tick(Date.now()+31*60_000);
    assert.equal(calls,state==='INACTIVE'?1:0); await service.close();
  }
  const f = fixture(t); let calls=0;
  const service = new DesktopService(f.target,f.legacy,dependencies({schedulerPolicy:'TASK',scheduler:async()=>({state:'ACTIVE',nextAt:null,mode:'PRODUCTION',legacyDetected:false,legacyActive:false,targetCurrent:true}),syncScheduler:async()=>({state:'ACTIVE',nextAt:null,mode:'PRODUCTION',legacyDetected:false,legacyActive:false,targetCurrent:true}),run:async()=>{calls++;return runResult('SUCCESS');}}));
  await service.initialize(); await service.tick(Date.now()+31*60_000); assert.equal(calls,0); await service.close();
});
test('production scheduler migrates only after explicit GUI request and recreates after a disabled legacy task', async t => {
  const f = fixture(t); const actions: string[] = [];
  const production = {state:'ACTIVE' as const,nextAt:null,mode:'PRODUCTION' as const,legacyDetected:true,legacyActive:false,targetCurrent:true};
  let status: SchedulerStatus = {state:'ABSENT',nextAt:null,mode:'LEGACY',legacyDetected:true,legacyActive:true,targetCurrent:false};
  const service = new DesktopService(f.target,f.legacy,dependencies({schedulerPolicy:'TASK',scheduler:async()=>status,
    syncScheduler:async action=>{actions.push(action); if(action==='MigrateLegacy') status=production; return production;}}));
  await service.initialize();
  await service.handle({method:'testCredentials'}); await service.handle({method:'testDiscord'}); await service.handle({method:'completeSetup'});
  assert.deepEqual(actions,[]);
  assert.equal((await service.handle({method:'migrateLegacyScheduler'})).ok,true); assert.deepEqual(actions,['MigrateLegacy']);
  status={state:'ABSENT',nextAt:null,mode:'LEGACY',legacyDetected:true,legacyActive:false,targetCurrent:false};
  await service.handle({method:'updateSettings',payload:{autoEnabled:true,retentionDays:30}});
  assert.deepEqual(actions,['MigrateLegacy','Ensure']); await service.close();
});
test('packaged dashboard reads the task next run without moving it on polling or manual checks', async t => {
  const f = fixture(t);
  let nextAt = '2026-10-08T08:30:00.000Z';
  let scheduler: SchedulerStatus = { state: 'ACTIVE', nextAt, mode: 'PRODUCTION', legacyDetected: false, legacyActive: false, targetCurrent: true };
  const actions: string[] = [];
  const service = new DesktopService(f.target, f.target, dependencies({
    schedulerPolicy: 'TASK',
    scheduler: async () => scheduler,
    syncScheduler: async action => {
      actions.push(action);
      if (action === 'Disable') scheduler = { ...scheduler, state: 'INACTIVE', mode: 'STALE', nextAt: null };
      if (action === 'Ensure') scheduler = scheduler.mode === 'ABSENT'
        ? { ...scheduler, state: 'UNKNOWN', mode: 'UNKNOWN', nextAt: null }
        : { ...scheduler, state: 'ACTIVE', mode: 'PRODUCTION', nextAt, targetCurrent: true };
      return scheduler;
    },
  }));
  await service.initialize();
  await service.handle({ method: 'testCredentials' });
  await service.handle({ method: 'testDiscord' });
  await service.handle({ method: 'completeSetup' });
  await service.handle({ method: 'updateSettings', payload: { autoEnabled: true, retentionDays: 30 } });
  actions.length = 0;
  const first = await service.status();
  assert.equal(first.nextAt, nextAt);
  assert.equal((await service.status()).nextAt, nextAt);
  assert.deepEqual(actions, []);
  assert.equal((await service.handle({ method: 'runCheck' })).ok, true);
  assert.equal((await service.status()).nextAt, nextAt);
  assert.deepEqual(actions, []);
  nextAt = '2026-10-08T09:00:00.000Z';
  scheduler = { ...scheduler, nextAt };
  assert.equal((await service.status()).nextAt, nextAt);
  scheduler = { ...scheduler, mode: 'ABSENT', state: 'ABSENT', nextAt: null, targetCurrent: false };
  assert.equal((await service.status()).nextAt, null);
  assert.deepEqual(actions, ['Ensure']);
  scheduler = { ...scheduler, mode: 'PRODUCTION', state: 'ACTIVE', nextAt, targetCurrent: true };
  await service.handle({ method: 'updateSettings', payload: { autoEnabled: false, retentionDays: 30 } });
  assert.equal((await service.status()).nextAt, null);
  assert.deepEqual(actions, ['Ensure', 'Disable']);
  await service.close();
});
test('malformed scheduler output becomes an unknown status without a crash', () => {
  for (const output of ['{', '{}', '{"state":"ACTIVE","nextAt":"tomorrow"}', 'null'])
    assert.deepEqual(parseSchedulerStatus(output), { state: 'UNKNOWN', nextAt: null, mode: 'UNKNOWN',
      legacyDetected: false, legacyActive: false, targetCurrent: false });
});
test('invalid settings file is preserved; service returns fixed safe error instead of crash/reset', async t => {
  const f=fixture(t); const service=new DesktopService(f.target,f.legacy,dependencies()); await service.initialize();
  const file=join(f.target.state,'settings.json'); writeFileSync(file,'{"password":"synthetic-do-not-return"');
  const result=await service.handle({method:'getStatus'}); assert.equal(result.ok,false);
  assert.match(result.message!,/데이터 파일/); assert.doesNotMatch(JSON.stringify(result),/synthetic-do-not-return/);
  assert.equal(readFileSync(file,'utf8'),'{"password":"synthetic-do-not-return"'); await service.close();
});
test('GUI save uses isolated native Credential Manager target, including shell metacharacters', {skip:process.platform!=='win32'}, async()=>{
  const target=`HS-LMS-Notifier:test:${randomUUID()}`;
  const synthetic={id:'synthetic-ui-test',password:'synthetic " & $ 한글 !'};
  try { await saveCredentials(synthetic,target); assert.deepEqual(await readCredentials(target),synthetic); }
  finally { (await credentialBridge('Remove',target)).fill(0); }
});
