import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LmsStore} from '../src/database/store.js';
import {runtimePaths} from '../src/runtime/paths.js';
import {defaultSettings} from '../src/runtime/settings.js';
import {syncGoogleCalendar,readCalendarStatus} from '../src/calendar/sync.js';
import {parseCourse} from '../src/crawler/courses.js';
import {parseAssignment} from '../src/crawler/assignments.js';
import {parseOnlineRow} from '../src/crawler/videos.js';

test('direct HTTP review: existing deadlines, elapsed time, completion, OFF isolation and failure recovery',{timeout:30000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'hs-lms-http-review-'));const paths=runtimePaths(root),store=new LmsStore(paths.database);
  const events=new Map<string,any>(),calls:Array<{method:string;path:string}>=[];let failNext=false;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    const path=new URL(req.url!,'http://localhost').pathname;calls.push({method:req.method!,path});res.setHeader('content-type','application/json');
    assert.equal(req.headers.authorization,'Bearer SYNTHETIC_CALENDAR_ACCESS_ONLY');
    if(failNext){failNext=false;res.statusCode=503;res.end('{}');return;}
    const id=path.split('/').at(-1)!;
    if(req.method==='POST'){if(events.has(body.id)){res.statusCode=409;res.end('{}');return;}events.set(body.id,body);res.end(JSON.stringify({id:body.id}));return;}
    if(!events.has(id)){res.statusCode=404;res.end('{}');return;}
    if(req.method==='PATCH')events.set(id,{...events.get(id),...body});
    res.end(JSON.stringify(events.get(id)));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');const local=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(root,{recursive:true,force:true});});
  let clock=new Date('2026-10-31T00:00:00Z'),tokens=0;
  const request:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://www.googleapis.com');
    assert.ok(url.pathname.startsWith('/calendar/v3/calendars/primary/events'));
    return fetch(`${local}${url.pathname}${url.search}`,init);
  };
  const course=parseCourse({id:'selfarea_TEST1_A',href:"javascript:fncGoClassroom('TEST1','A','3');",title:'검수 합성 과목'},{year:'2026년',term:'2학기'});
  const assignment={...parseAssignment({onclick:"fncModifyReport('1', 'N', '1', 'Y','Y')",title:'검수 합성 과제',period:null,submission:'미제출',progress:null},course),dueAt:'2026-11-01T23:59:00+09:00'};
  const video={...parseOnlineRow({id:'1',contentId:null,title:'검수 합성 강의',period:null,status:null},course)!,dueAt:assignment.dueAt,completed:false};
  const settings=defaultSettings();settings.googleCalendar={enabled:true,connectedAt:clock.toISOString()};
  const options={request,now:()=>clock,accessToken:async()=>{tokens++;return 'SYNTHETIC_CALENDAR_ACCESS_ONLY';}};
  const sourceDigest=()=>{
    const hash=createHash('sha256');for(const table of ['courses','items','scope_baselines','notification_history','sync_history','change_events','monitor_runs'])
      hash.update(JSON.stringify(store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));return hash.digest('hex');
  };
  store.sync([course],[{course,type:'ASSIGNMENT',items:[assignment]},{course,type:'VIDEO',items:[video]}],clock.toISOString());
  let baseline=sourceDigest();await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(events.size,2);assert.equal(calls.length,2);assert.equal(sourceDigest(),baseline);
  assert.ok([...events.values()].every(event=>event.extendedProperties.private.hsLmsState==='PENDING'));
  clock=new Date('2026-12-01T00:00:00Z');await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(calls.length,2);assert.equal(tokens,1);assert.ok([...events.values()].every(event=>!event.summary.includes('✅')));
  settings.googleCalendar.enabled=false;
  store.sync([course],[{course,type:'ASSIGNMENT',items:[{...assignment,submitted:true},{...assignment,itemId:'2',title:'꺼짐 중 새 과제'}]},
    {course,type:'VIDEO',items:[{...video,completed:true}]}],clock.toISOString());
  baseline=sourceDigest();await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(calls.length,2);assert.equal(tokens,1);assert.equal(events.size,2);assert.equal(sourceDigest(),baseline);
  assert.ok([...events.values()].every(event=>event.extendedProperties.private.hsLmsState==='PENDING'));
  settings.googleCalendar.enabled=true;await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(events.size,3);assert.equal([...events.values()].filter(event=>event.summary.includes('✅ 완료')).length,2);
  assert.ok([...events.values()].filter(event=>event.summary.includes('✅ 완료')).every(event=>event.reminders.overrides.length===0));
  assert.equal(sourceDigest(),baseline);assert.equal(calls.filter(call=>call.method==='PATCH').length,2);
  const count=calls.length;await syncGoogleCalendar(store,paths,settings,options);assert.equal(calls.length,count);
  store.sync([course],[{course,type:'ASSIGNMENT',items:[{...assignment,itemId:'2',dueAt:'2026-12-05'}]}],new Date(clock.getTime()+1000).toISOString());
  baseline=sourceDigest();failNext=true;await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(readCalendarStatus(paths).state,'RETRY');assert.equal(sourceDigest(),baseline);
  const failedCalls=calls.length;await syncGoogleCalendar(store,paths,settings,options);assert.equal(calls.length,failedCalls);
  settings.googleCalendar.enabled=false;clock=new Date(clock.getTime()+3600000);await syncGoogleCalendar(store,paths,settings,options);
  assert.equal(calls.length,failedCalls);assert.equal(sourceDigest(),baseline);
  settings.googleCalendar.enabled=true;await syncGoogleCalendar(store,paths,settings,options);assert.equal(readCalendarStatus(paths).state,'SYNCED');assert.equal(sourceDigest(),baseline);
});
