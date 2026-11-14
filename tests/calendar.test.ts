import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizeGoogleCalendar, CALENDAR_SCOPE, CalendarError, distributedOAuthClient, verifyCalendarAccess } from '../src/calendar/auth.js';
import { deadlineEvent, calendarTasks, readCalendarStatus, syncGoogleCalendar } from '../src/calendar/sync.js';
import { defaultSettings } from '../src/runtime/settings.js';
import { runtimePaths } from '../src/runtime/paths.js';
import { LmsStore } from '../src/database/store.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseAssignment } from '../src/crawler/assignments.js';
import { itemKey } from '../src/model.js';
import { parseOnlineRow } from '../src/crawler/videos.js';

const now=new Date('2026-10-31T12:00:00+09:00');
const connectedAt='2026-10-30T00:00:00.000Z';
const course=parseCourse({id:'selfarea_TEST1_A',href:"javascript:fncGoClassroom('TEST1','A','3');",title:'합성 과목'},{year:'2026년',term:'2학기'});
const assignment=parseAssignment({onclick:"fncModifyReport('1', 'N', '1', 'Y','Y')",title:'합성 과제',period:null,submission:'미제출',progress:null},course);
const item={...assignment,dueAt:'2026-11-07T23:59:00+09:00'};
function fixture(t:{after(fn:()=>void):void}) {
  const root=mkdtempSync(join(tmpdir(),'hs-lms-calendar-'));const paths=runtimePaths(root),store=new LmsStore(paths.database);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  store.sync([course],[{course,type:'ASSIGNMENT',items:[item]}],now.toISOString());
  const settings=defaultSettings();settings.googleCalendar={enabled:true,connectedAt};
  function sent(key=`deadline:${itemKey(item)}:D-7`,status='SENT') {
    store.db.prepare(`INSERT INTO notification_history(notification_key,status,payload_json,created_at,updated_at,sent_at,attempts) VALUES(?,?,'{}',?,?,?,1)`)
      .run(key,status,now.toISOString(),now.toISOString(),now.toISOString());
  }
  return {paths,store,settings,sent};
}

test('LMS assignment and lecture removal marks the same exported event, silences reminders and reverses on reappearance',async t=>{
  for (const type of ['ASSIGNMENT','VIDEO'] as const) {
    const f=fixture(t);
    const task=type==='ASSIGNMENT'?item:{...parseOnlineRow({id:'2',contentId:null,title:'합성 강의',period:null,status:null},course)!,dueAt:item.dueAt,completed:false};
    const key=itemKey(task),id=deadlineEvent({...task,key,courseName:course.name,dueAt:item.dueAt}).id;
    const calls:Array<{method:string;body?:ReturnType<typeof deadlineEvent>}>=[];
    const options={now:()=>now,accessToken:async()=>'synthetic',request:async(_url:unknown,init?:RequestInit)=>{
      calls.push({method:String(init?.method),...(init?.body?{body:JSON.parse(String(init.body))}:{})});
      return Response.json(init?.method==='GET'?{id,extendedProperties:{private:{hsLmsItem:createHash('sha256').update(key).digest('hex')}}}:{id});}};
    f.store.sync([course],[{course,type,items:[task]}],new Date(now.getTime()+1000).toISOString());
    await syncGoogleCalendar(f.store,f.paths,f.settings,options);
    f.store.sync([course],[{course,type,items:[]}],new Date(now.getTime()+2000).toISOString());
    await syncGoogleCalendar(f.store,f.paths,f.settings,options);
    await syncGoogleCalendar(f.store,f.paths,f.settings,options);
    assert.deepEqual(calls.map(c=>c.method),['POST','GET','PATCH']);
    const removed=calls[2]!.body!;
    assert.match(removed.summary,/⛔ 삭제/);assert.equal(removed.extendedProperties.private.hsLmsState,'REMOVED');
    assert.deepEqual(removed.reminders.overrides,[]);assert.deepEqual(removed.start,calls[0]!.body!.start);
    assert.equal(f.store.items().some(i=>itemKey(i)===key),true); // Original records are preserved.
    f.store.sync([course],[{course,type,items:[task]}],new Date(now.getTime()+3000).toISOString());
    await syncGoogleCalendar(f.store,f.paths,f.settings,options);
    assert.equal(calls[3]!.method,'PATCH');assert.doesNotMatch(calls[3]!.body!.summary,/삭제/);
    assert.equal(calls[3]!.body!.reminders.overrides.length,1);
  }
});

test('missing courses, uncollected scopes, incomplete lecture lists and failed transactions never prove removal',async t=>{
  const f=fixture(t),id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  let calls=0;
  const options={now:()=>now,accessToken:async()=>'synthetic',request:async()=>{calls++;return Response.json({id});}};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([],[],new Date(now.getTime()+1000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([course],[],new Date(now.getTime()+2000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[],complete:false}],new Date(now.getTime()+3000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.throws(()=>f.store.sync([course],[{course,type:'ASSIGNMENT',items:[]},{course,type:'ASSIGNMENT',items:[]}],new Date(now.getTime()+4000).toISOString()));
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.equal(calls,1);assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM monitor_state WHERE key LIKE 'lms-removed:%'").get()?.n,0);
  assert.equal(calendarTasks(f.store,connectedAt).some(task=>task.removed),false);
});

test('removals wait while OFF, survive retries and never recreate missing calendar events',async t=>{
  const f=fixture(t),id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async()=>Response.json({id})});
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[]}],new Date(now.getTime()+1000).toISOString());
  f.settings.googleCalendar.enabled=false;
  await syncGoogleCalendar(f.store,f.paths,f.settings,{accessToken:async()=>{throw Error('OFF must not refresh');}});
  f.settings.googleCalendar.enabled=true;
  let calls=0;
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async()=>{calls++;return new Response('',{status:503});}});
  assert.equal(readCalendarStatus(f.paths).state,'RETRY');
  const methods:string[]=[];
  const options={now:()=>new Date(now.getTime()+3600000),accessToken:async()=>'synthetic',request:async(_url:unknown,init?:RequestInit)=>{methods.push(String(init?.method));return new Response('',{status:410});}};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.equal(calls,1);assert.deepEqual(methods,['GET']);assert.equal(readCalendarStatus(f.paths).pending,0);
});

test('removal checks ownership even for previously acknowledged calendar events',async t=>{
  const f=fixture(t),id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async()=>Response.json({id})});
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[]}],new Date(now.getTime()+1000).toISOString());
  const methods:string[]=[];
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async(_url,init)=>{methods.push(String(init?.method));return Response.json({id,extendedProperties:{private:{hsLmsItem:'unrelated'}}});}});
  assert.deepEqual(methods,['GET']);assert.equal(readCalendarStatus(f.paths).lastError,'PERMISSION');
});

test('calendar represents exact deadlines and exclusive all-day ends without inventing a time',()=>{
  const task={key:itemKey(item),title:item.title,courseName:course.name,type:'ASSIGNMENT' as const,dueAt:item.dueAt};
  const event=deadlineEvent(task);assert.match(event.id,/^[0-9a-v]{5,1024}$/);
  assert.equal(event.start.dateTime,'2026-11-07T14:59:00.000Z');assert.equal(event.end.dateTime,'2026-11-07T15:00:00.000Z');
  const day=deadlineEvent({...task,dueAt:'2026-12-31'});assert.deepEqual(day.start,{date:'2026-12-31'});assert.deepEqual(day.end,{date:'2027-01-01'});
  assert.throws(()=>deadlineEvent({...task,dueAt:'2026-02-30'}),CalendarError);
});
test('calendar opt-out performs zero token or API requests even with existing pending tasks',async t=>{
  const f=fixture(t);let calls=0;const forbidden=async()=>{calls++;throw Error('no request allowed');};
  assert.equal(calendarTasks(f.store,connectedAt).length,1);
  f.settings.googleCalendar.enabled=false;await syncGoogleCalendar(f.store,f.paths,f.settings,{accessToken:forbidden,request:forbidden,now:()=>now});assert.equal(calls,0);
});
test('initial connection imports existing pending deadlines without a new Discord notification',async t=>{
  const f=fixture(t);let requests=0;
  assert.equal(f.store.notificationCount(),0);
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async(_url,init)=>{
    requests++;const event=JSON.parse(String(init?.body));assert.match(event.summary,/합성 과제/);return Response.json({id:event.id});}});
  assert.equal(requests,1);assert.equal(readCalendarStatus(f.paths).state,'SYNCED');
});
test('repeated D-day reminders have one stable event and zero extra Google calls; changed deadline patches once',async t=>{
  const f=fixture(t);f.sent();const methods:string[]=[];let tokens=0;
  const request:typeof fetch=async(_url,init)=>{methods.push(String(init?.method));const data=JSON.parse(String(init?.body));return Response.json({id:data.id??deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id});};
  const options={request,accessToken:async()=>{tokens++;return 'synthetic';},now:()=>now};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);f.sent(`deadline:${itemKey(item)}:D-3`);
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.deepEqual(methods,['POST']);assert.equal(tokens,1);
  assert.equal(readCalendarStatus(f.paths).state,'SYNCED');
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,dueAt:'2026-11-08T23:59:00+09:00'}]}],new Date(now.getTime()+1000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.deepEqual(methods,['POST','PATCH']);assert.equal(tokens,2);
});
test('rate limits retain pending work, respect Retry-After and never retry in a tight loop',async t=>{
  const f=fixture(t);f.sent();let calls=0;
  const options={accessToken:async()=>'synthetic',request:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'3600'}});},now:()=>now};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.equal(calls,1);const status=readCalendarStatus(f.paths);assert.equal(status.pending,1);assert.equal(status.state,'RETRY');assert.equal(status.retryAt,new Date(now.getTime()+3600000).toISOString());
});
test('expired Google authorization suspends automatic attempts until reconnect',async t=>{
  const f=fixture(t);f.sent();let calls=0;const options={accessToken:async()=>{calls++;throw new CalendarError('AUTH');},now:()=>now};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.equal(calls,1);assert.equal(readCalendarStatus(f.paths).state,'AUTH_REQUIRED');
});
test('unacknowledged successful insert recovers via stable ID and verifies ownership before updating',async t=>{
  const f=fixture(t);f.sent();const methods:string[]=[];const id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  const request:typeof fetch=async(_url,init)=>{const method=String(init?.method);methods.push(method);
    return method==='POST'?new Response('',{status:409}):method==='GET'?Response.json({id,extendedProperties:{private:{hsLmsItem:createHash('sha256').update(itemKey(item)).digest('hex')}}}):Response.json({id});};
  await syncGoogleCalendar(f.store,f.paths,f.settings,{request,accessToken:async()=>'synthetic',now:()=>now});
  assert.deepEqual(methods,['POST','GET','PATCH']);assert.equal(readCalendarStatus(f.paths).state,'SYNCED');
});
test('calendar imports existing overdue pending tasks but never invents unknown/completed/stale tasks',t=>{
  const f=fixture(t);assert.equal(calendarTasks(f.store,connectedAt).length,1);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,dueAt:'2026-10-01',submitted:false}]}],new Date(now.getTime()+500).toISOString());
  assert.equal(calendarTasks(f.store,connectedAt).length,1);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,submitted:true}]}],new Date(now.getTime()+1000).toISOString());
  assert.equal(calendarTasks(f.store,connectedAt).length,0);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,submitted:null}]}],new Date(now.getTime()+1500).toISOString());
  assert.equal(calendarTasks(f.store,connectedAt).length,0);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[]}],new Date(now.getTime()+2000).toISOString());
  assert.equal(calendarTasks(f.store,connectedAt).length,0);
});
test('submission completes the same calendar event, clears reminders, preserves a missing deadline and can reopen',async t=>{
  const f=fixture(t);const sent:Array<{method:string;event:ReturnType<typeof deadlineEvent>}>=[];
  const id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  const options={now:()=>now,accessToken:async()=>'synthetic',request:async(_url:unknown,init?:RequestInit)=>{
    sent.push({method:String(init?.method),event:JSON.parse(String(init?.body))});return Response.json({id});}};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,submitted:true,dueAt:null}]}],new Date(now.getTime()+1000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.deepEqual(sent.map(s=>s.method),['POST','PATCH']);assert.match(sent[1]!.event.summary,/✅ 완료/);
  assert.deepEqual(sent[1]!.event.reminders.overrides,[]);assert.equal(sent[1]!.event.extendedProperties.private.hsLmsState,'COMPLETED');
  assert.deepEqual(sent[1]!.event.start,sent[0]!.event.start);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[item]}],new Date(now.getTime()+2000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.doesNotMatch(sent[2]!.event.summary,/완료/);assert.equal(sent[2]!.event.reminders.overrides.length,1);
});
test('lecture completion follows observed viewing or attendance credit; unknown progress never marks complete',async t=>{
  const f=fixture(t);
  const parsed=parseOnlineRow({id:'1',contentId:null,title:'합성 강의',period:null,status:null},course)!;
  const video={...parsed,dueAt:item.dueAt,completed:false};
  const snapshots:Array<ReturnType<typeof deadlineEvent>>=[];
  const id=deadlineEvent({...video,key:itemKey(video),courseName:course.name,dueAt:item.dueAt}).id;
  const options={now:()=>now,accessToken:async()=>'synthetic',request:async(_url:unknown,init?:RequestInit)=>{snapshots.push(JSON.parse(String(init?.body)));return Response.json({id});}};
  f.store.sync([course],[{course,type:'VIDEO',items:[video]}],new Date(now.getTime()+1000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([course],[{course,type:'VIDEO',items:[{...video,completed:null}]}],new Date(now.getTime()+2000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.equal(snapshots.length,1);
  f.store.sync([course],[{course,type:'VIDEO',items:[{...video,attendanceConfirmed:true}]}],new Date(now.getTime()+3000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.match(snapshots[1]!.summary,/완료/);assert.match(snapshots[1]!.description,/출석 인정 완료/);
  f.store.sync([course],[{course,type:'VIDEO',items:[{...video,completed:true,attendanceConfirmed:true}]}],new Date(now.getTime()+4000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);assert.match(snapshots[2]!.description,/수강 완료/);
});
test('deleted completed event is never recreated during reconciliation',async t=>{
  const f=fixture(t);const id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;const methods:string[]=[];
  const options={now:()=>now,accessToken:async()=>'synthetic',request:async(_url:unknown,init?:RequestInit)=>{methods.push(String(init?.method));return methods.length===1?Response.json({id}):new Response('',{status:404});}};
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,submitted:true}]}],new Date(now.getTime()+1000).toISOString());
  await syncGoogleCalendar(f.store,f.paths,f.settings,options);await syncGoogleCalendar(f.store,f.paths,f.settings,options);
  assert.deepEqual(methods,['POST','PATCH']);assert.equal(readCalendarStatus(f.paths).pending,0);
});
test('reconnecting can finish a previously exported item but never creates it in an unrelated Google account',async t=>{
  const f=fixture(t);const id=deadlineEvent({...item,key:itemKey(item),courseName:course.name}).id;
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async()=>Response.json({id})});
  f.store.sync([course],[{course,type:'ASSIGNMENT',items:[{...item,submitted:true}]}],new Date(now.getTime()+1000).toISOString());
  f.settings.googleCalendar.connectedAt=new Date(now.getTime()+2000).toISOString();const methods:string[]=[];
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async(_url,init)=>{
    methods.push(String(init?.method));return Response.json(init?.method==='GET'?{id,extendedProperties:{private:{hsLmsItem:createHash('sha256').update(itemKey(item)).digest('hex')}}}:{id});}});
  assert.deepEqual(methods,['GET','PATCH']);
  f.settings.googleCalendar.connectedAt=new Date(now.getTime()+3000).toISOString();const unrelated:string[]=[];
  await syncGoogleCalendar(f.store,f.paths,f.settings,{now:()=>now,accessToken:async()=>'synthetic',request:async(_url,init)=>{unrelated.push(String(init?.method));return new Response('',{status:404});}});
  assert.deepEqual(unrelated,['GET']);
});
test('Google login validation checks primary-calendar ownership without reading event content',async()=>{
  await verifyCalendarAccess('synthetic',undefined,async(url,init)=>{
    const request=new URL(String(url));assert.equal(request.hostname,'www.googleapis.com');assert.equal(request.searchParams.get('fields'),'kind,accessRole');
    assert.equal((init?.headers as Record<string,string>).authorization,'Bearer synthetic');return Response.json({kind:'calendar#events',accessRole:'owner'});
  });
  for(const [status,reason,kind] of [[401,'authError','AUTH'],[403,'accessNotConfigured','API_DISABLED'],[403,'insufficientPermissions','PERMISSION'],[503,'backendError','NETWORK']] as const)
    await assert.rejects(verifyCalendarAccess('synthetic',undefined,async()=>Response.json({error:{errors:[{reason}]}},{status})),error=>error instanceof CalendarError&&error.kind===kind);
  await assert.rejects(verifyCalendarAccess('synthetic',undefined,async()=>Response.json({kind:'calendar#events',accessRole:'reader'})),error=>error instanceof CalendarError&&error.kind==='PERMISSION');
});
test('desktop OAuth uses system browser, one-time loopback state and PKCE without exposing tokens',async()=>{
  let auth:URL|undefined;let callback='';let requests=0;
  const request:typeof fetch=async(url,init)=>{assert.equal(String(url),'https://oauth2.googleapis.com/token');requests++;
    const body=init?.body as URLSearchParams;assert.equal(body.get('grant_type'),'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),auth!.searchParams.get('code_challenge'));
    return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:CALENDAR_SCOPE});};
  const tokens=await authorizeGoogleCalendar({clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret'},async url=>{
    auth=new URL(url);assert.equal(auth.hostname,'accounts.google.com');assert.equal(auth.searchParams.get('access_type'),'offline');
    assert.equal(auth.searchParams.get('scope'),CALENDAR_SCOPE);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
    callback=auth.searchParams.get('redirect_uri')!;assert.equal(new URL(callback).hostname,'127.0.0.1');
    const invalid=new URL(callback);invalid.search=new URLSearchParams({state:'wrong',code:'synthetic-code'}).toString();
    assert.equal((await fetch(invalid)).status,400);
    const valid=new URL(callback);valid.search=new URLSearchParams({state:auth.searchParams.get('state')!,code:'synthetic-code'}).toString();
    const response=await fetch(valid);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/synthetic-code|synthetic-refresh|synthetic-access/);
  },undefined,request);
  assert.equal(tokens.refreshToken,'synthetic-refresh');assert.equal(requests,1);
  await assert.rejects(fetch(callback));assert.equal(distributedOAuthClient(),null);
});
test('OAuth denial is cancelled and does not contact token endpoint',async()=>{
  let calls=0;
  await assert.rejects(authorizeGoogleCalendar({clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic'},async url=>{
    const auth=new URL(url),callback=new URL(auth.searchParams.get('redirect_uri')!);
    callback.search=new URLSearchParams({state:auth.searchParams.get('state')!,error:'access_denied'}).toString();await fetch(callback);
  },undefined,async()=>{calls++;throw Error('forbidden');}),error=>error instanceof CalendarError&&error.kind==='CANCELLED');
  assert.equal(calls,0);
});
