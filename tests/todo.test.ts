import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTodo, todoDeadline, todoSourceSchema, todoDashboardSchema, type TodoSource } from '../src/summary/todo.js';
import { defaultSettings, loadSettings, settingsSchema, settingsPatchSchema } from '../src/runtime/settings.js';
import { runtimePaths } from '../src/runtime/paths.js';
import { writeJson, DataFileError } from '../src/runtime/json.js';
import { readHistory } from '../src/desktop/history.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { LmsStore } from '../src/database/store.js';
import { deadlineReminders } from '../src/detector/deadlines.js';
import { notifyDeadlines } from '../src/notification/deadlines.js';
import { runMonitor } from '../src/monitor.js';

const now = new Date('2026-10-06T12:00:00+09:00');
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성 과목' }, {year:'2026년',term:'2학기'});
const assignment = parseAssignment({ onclick: "fncModifyReport('1', 'N', '1', 'Y','Y')", title: '합성 과제',
  period: '26/10/01 00:00 ~ 26/10/13 23:59', submission: '미제출', progress: '진행' }, course);
const video: TodoSource = { type:'VIDEO',courseId:course.courseId,classNo:course.classNo,itemId:'v1',title:'합성 영상',dueAt:assignment.dueAt,completed:false,attendanceConfirmed:null };
const todo = (items: TodoSource[]) => buildTodo([course], items, now, now.toISOString());
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(),'hs-lms-todo-'));
  t.after(() => rmSync(root,{recursive:true,force:true})); return runtimePaths(root);
}
test('todo shows explicitly unsubmitted assignments and incomplete lectures', () => {
  const result=todo([assignment,video]); assert.equal(result.pendingAssignments,1); assert.equal(result.incompleteLectures,1);
  assert.equal(result.unknown,0); assert.equal(result.nearest,'D-7'); assert.equal(result.items.length,2);
});
test('todo hides submitted, completed and attendance-credited items without inferring full viewing', () => {
  assert.equal(todo([{...assignment,submitted:true},{...video,completed:true},{...video,itemId:'v2',completed:null,attendanceConfirmed:true}]).items.length,0);
});
test('UNKNOWN is shown but never counted as pending or nearest confirmed deadline', () => {
  const result=todo([{...assignment,submitted:null},{...video,completed:null}]);
  assert.equal(result.pendingAssignments,0);assert.equal(result.incompleteLectures,0);assert.equal(result.unknown,2);assert.equal(result.nearest,null);
  assert.ok(result.items.every(i=>i.state==='UNKNOWN'));
});
test('missing completion fields migrate to UNKNOWN rather than false', () => {
  const item=todoSourceSchema.parse({type:'VIDEO',courseId:'TEST1',classNo:'A',itemId:'1',title:'합성 영상'});
  assert.equal(todo([item]).unknown,1);
});
test('D-Day and overdue D+N use the shared Seoul calendar', () => {
  assert.equal(todoDeadline('2026-10-06T23:59:00+09:00',now).dayLabel,'D-Day');
  assert.equal(todoDeadline('2026-10-04T23:59:00+09:00',now).dayLabel,'D+2');
  assert.equal(todoDeadline('2026-10-07T00:01:00+09:00',new Date('2026-10-06T14:59:00Z')).dayLabel,'D-1');
  assert.equal(todoDeadline('2026-10-07T00:01:00+09:00',new Date('2026-10-06T15:00:00Z')).dayLabel,'D-Day');
});
test('date-only deadline never fabricates a time', () => {
  assert.equal(todoDeadline('2026-10-07',now).deadlineLabel,'10/07까지');
  assert.equal(todoDeadline('2026-10-07',now).days,1);
  assert.equal(todoDeadline('2026-10-07T23:59:00+09:00',now).deadlineLabel,'10/07 23:59까지');
});
test('missing and malformed deadlines remain visible, safely unknown', () => {
  for(const dueAt of [null,'invalid','2026-02-30','2026-10-07T10:00:00']) {
    const result=todo([{...assignment,dueAt}]);assert.equal(result.items.length,1);assert.equal(result.items[0]?.days,null);
    assert.equal(result.items[0]?.deadlineLabel,'기한 확인 필요');
  }
});
test('overdue tasks stay visible; deadline then type/course/title/key ties are stable', () => {
  const items:TodoSource[]=[{...assignment,itemId:'z',title:'Z'},video,{...assignment,itemId:'a',title:'A'},
    {...assignment,itemId:'old',dueAt:'2026-10-05T10:00:00+09:00'}, {...assignment,itemId:'none',dueAt:null}];
  const a=todo(items).items;assert.equal(a[0]?.dayLabel,'D+1');assert.equal(a.at(-1)?.days,null);
  assert.deepEqual(a,todo([...items].reverse()).items);assert.equal(a[1]?.title,'A');
});
test('todo deduplicates identities and excludes inactive courses', () => {
  assert.equal(todo([assignment,assignment,{...assignment,courseId:'OLD'}]).items.length,1);
});
test('todo runtime schemas reject malformed payloads without exposing extra fields', () => {
  assert.equal(todoDashboardSchema.safeParse({items:[]}).success,false);
  assert.equal(todoSourceSchema.safeParse({...assignment,submitted:'false'}).success,false);
  assert.equal('secret' in todoSourceSchema.parse({...assignment,secret:'synthetic'}),false);
});
test('legacy settings and absent settings default to all four ON', t => {
  const paths=fixture(t);assert.deepEqual(loadSettings(paths).deadlineNotifications,{d7:true,d3:true,d1:true,d0:true});
  const {deadlineNotifications:_,...old}=defaultSettings();writeJson(join(paths.state,'settings.json'),old);
  assert.deepEqual(loadSettings(paths).deadlineNotifications,defaultSettings().deadlineNotifications);
});
test('settings save/reload validates booleans and never silently resets corruption', t => {
  const paths=fixture(t),settings=defaultSettings();settings.deadlineNotifications.d7=false;
  writeJson(join(paths.state,'settings.json'),settings);assert.equal(loadSettings(paths).deadlineNotifications.d7,false);
  assert.equal(settingsPatchSchema.safeParse({autoEnabled:true,retentionDays:30,deadlineNotifications:{d7:'false'}}).success,false);
  writeJson(join(paths.state,'settings.json'),{...settings,deadlineNotifications:null});assert.throws(()=>loadSettings(paths),DataFileError);
  assert.equal(settingsSchema.safeParse({...settings,deadlineNotifications:{d7:false}}).success,false);
});
for (const [day,key] of [[7,'d7'],[3,'d3'],[1,'d1'],[0,'d0']] as const) test(`${key} OFF suppresses only that reminder, no history writes or todo changes`,async()=>{
  const db=new LmsStore(':memory:');try {
    db.sync([course],[{course,type:'ASSIGNMENT',items:[assignment]}]);
    const time=new Date(`2026-10-${String(13-day).padStart(2,'0')}T12:00:00+09:00`);
    const settings=defaultSettings().deadlineNotifications;settings[key]=false;let calls=0;
    await notifyDeadlines(db,deadlineReminders([assignment],time),async()=>{calls++;return {status:'SENT'};},0,settings);
    assert.equal(calls,0);assert.equal(db.notificationCount(),0);assert.equal(todo([assignment]).pendingAssignments,1);
  }finally{db.close();}
});
test('D7 OFF leaves D3 ON working and SENT survives OFF then ON',async()=>{
  const db=new LmsStore(':memory:');try {
    db.sync([course],[{course,type:'ASSIGNMENT',items:[assignment]}]);let calls=0;
    const send=async()=>{calls++;return {status:'SENT' as const};},settings={...defaultSettings().deadlineNotifications,d7:false};
    const reminders=deadlineReminders([assignment],new Date('2026-10-10T12:00:00+09:00'));
    await notifyDeadlines(db,reminders,send,0,settings);settings.d3=false;await notifyDeadlines(db,reminders,send,0,settings);
    settings.d3=true;await notifyDeadlines(db,reminders,send,0,settings);assert.equal(calls,1);assert.equal(db.notificationCount(),1);
  }finally{db.close();}
});
test('reenabling after a disabled day never catches up missed reminders',async()=>{
  const db=new LmsStore(':memory:');try {
    db.sync([course],[{course,type:'ASSIGNMENT',items:[assignment]}]);let calls=0;
    const send=async()=>{calls++;return {status:'SENT' as const};};
    await notifyDeadlines(db,deadlineReminders([assignment],new Date('2026-10-10T12:00:00+09:00')),send,0,{...defaultSettings().deadlineNotifications,d3:false});
    await notifyDeadlines(db,deadlineReminders([assignment],new Date('2026-10-11T12:00:00+09:00')),send,0);
    assert.equal(calls,0);
  }finally{db.close();}
});
test('dashboard reads only current sync items and preserves historical baseline/notification rows', async t => {
  const paths=fixture(t),db=new LmsStore(paths.database);
  try {
    const source={courses:async()=>[course],enter:async()=>{},collect:async(_c:unknown,type:string)=>({status:'OK' as const,items:type==='ASSIGNMENT'?[assignment]:[]})};
    await runMonitor(db,source,async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},now:()=>now,deliveryDelayMs:0});
    const before=db.notificationCount();assert.equal(readHistory(paths).todo.pendingAssignments,1);
    await runMonitor(db,{...source,collect:async()=>({status:'OK',items:[]})},async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},now:()=>new Date(now.getTime()+1000),deliveryDelayMs:0});
    const result=readHistory(paths).todo;assert.equal(result.items.length,0);assert.equal(result.coverage,'COMPLETE');
    assert.equal(db.items().length,1);assert.equal(db.notificationCount(),before);
  }finally{db.close();}
});
test('monitor settings filter does not change baseline, detector or todo data', async()=>{
  const db=new LmsStore(':memory:');try {
    const source={courses:async()=>[course],enter:async()=>{},collect:async(_c:unknown,type:string)=>({status:'OK' as const,items:type==='ASSIGNMENT'?[assignment]:[]})};
    const options={authenticate:async()=>{},now:()=>now,deliveryDelayMs:0,deadlineNotifications:{d7:false,d3:true,d1:true,d0:true}};
    const first=await runMonitor(db,source,async()=>({status:'SENT'}),()=>{},options);
    const second=await runMonitor(db,source,async()=>({status:'SENT'}),()=>{},options);
    assert.equal(first.baseline,1);assert.equal(second.changes,0);assert.equal(second.sent,0);
    assert.equal(todo(db.items().map(i=>todoSourceSchema.parse(i))).pendingAssignments,1);
  }finally{db.close();}
});
test('failed collection never presents an old task or an all-clear dashboard', async t=>{
  const paths=fixture(t),db=new LmsStore(paths.database);try {
    const source={courses:async()=>[course],enter:async()=>{},collect:async(_c:unknown,type:string)=>({status:'OK' as const,items:type==='ASSIGNMENT'?[assignment]:[]})};
    await runMonitor(db,source,async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},now:()=>now,deliveryDelayMs:0});
    await runMonitor(db,{...source,collect:async(_c,type)=>{if(type==='ASSIGNMENT')throw Error('fixture');return {status:'OK',items:[]};}},
      async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},now:()=>new Date(now.getTime()+1000),deliveryDelayMs:0});
    const result=readHistory(paths).todo;assert.equal(result.items.length,0);assert.equal(result.coverage,'PARTIAL');assert.equal(db.items().length,1);
  }finally{db.close();}
});
test('malformed task JSON fails safely without resetting the saved database', t=>{
  const paths=fixture(t),db=new LmsStore(paths.database);try {
    db.sync([course],[{course,type:'ASSIGNMENT',items:[assignment]}],now.toISOString());
    db.db.prepare('UPDATE items SET payload_json=?').run('{malformed');
    assert.throws(()=>readHistory(paths),DataFileError);
    assert.equal(db.db.prepare('SELECT payload_json FROM items').get()?.payload_json,'{malformed');
  }finally{db.close();}
});
