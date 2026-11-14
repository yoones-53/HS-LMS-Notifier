import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LmsStore } from '../database/store.js';
import type { RuntimePaths } from '../runtime/paths.js';
import type { Settings } from '../runtime/settings.js';
import { parseJson, readJson, writeJson } from '../runtime/json.js';
import { todoSourceSchema } from '../summary/todo.js';
import { lectureSatisfied } from '../model/task-state.js';
import { MY_LECTURES_URL } from '../utils/config.js';
import { calendarAccessToken, CalendarError } from './auth.js';

export const calendarStatusSchema=z.object({state:z.enum(['READY','SYNCED','RETRY','AUTH_REQUIRED']),pending:z.number().int().nonnegative(),
  lastSyncAt:z.iso.datetime().nullable(),retryAt:z.iso.datetime().nullable(),verifiedAt:z.iso.datetime().nullable().default(null),
  lastError:z.enum(['NONE','AUTH','PERMISSION','API_DISABLED','NETWORK','RATE_LIMIT']).default('NONE')}).strict();
export type CalendarSyncStatus=z.infer<typeof calendarStatusSchema>;
const statusFile=(paths:RuntimePaths)=>join(paths.state,'google-calendar-status.json');
export function readCalendarStatus(paths:RuntimePaths):CalendarSyncStatus {
  return existsSync(statusFile(paths))?readJson(statusFile(paths),calendarStatusSchema):calendarStatusSchema.parse({state:'READY',pending:0,lastSyncAt:null,retryAt:null});
}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const calendarTaskSchema=z.object({key:z.string(),title:z.string(),courseName:z.string(),type:z.enum(['ASSIGNMENT','VIDEO']),dueAt:z.string(),
  completed:z.boolean().optional(),removed:z.boolean().optional(),completionReason:z.enum(['SUBMITTED','VIEWED','ATTENDANCE']).optional()}).strict();
export type CalendarTask=z.infer<typeof calendarTaskSchema>;
function ledgerKey(binding:string,key:string) {return `google-calendar:item:${digest(binding)}:${digest(key)}`;}
function ledgerValue(store:LmsStore,key:string):{fingerprint:string;task?:CalendarTask}|null {
  const row=store.db.prepare('SELECT value FROM monitor_state WHERE key=?').get(key);if(!row)return null;
  const value=String(row.value);
  if(/^[a-f0-9]{64}$/.test(value))return {fingerprint:value}; // v0.2 preview ledger compatibility.
  return parseJson(value,z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),task:calendarTaskSchema}).strict());
}
function knownItemLedger(store:LmsStore,key:string) {
  const row=store.db.prepare("SELECT key FROM monitor_state WHERE key LIKE ? ORDER BY rowid DESC LIMIT 1").get(`google-calendar:item:%:${digest(key)}`);
  return row?ledgerValue(store,String(row.key)):null;
}
export function deadlineEvent(task:CalendarTask) {
  const dateOnly=z.iso.date().safeParse(task.dueAt).success;
  if (!dateOnly && !z.iso.datetime({offset:true}).safeParse(task.dueAt).success) throw new CalendarError('SETUP');
  const date=new Date(dateOnly?`${task.dueAt}T00:00:00Z`:task.dueAt);
  const start=dateOnly?{date:task.dueAt}:{dateTime:date.toISOString(),timeZone:'Asia/Seoul'};
  const end=dateOnly?{date:new Date(date.getTime()+86_400_000).toISOString().slice(0,10)}:{dateTime:new Date(date.getTime()+60_000).toISOString(),timeZone:'Asia/Seoul'};
  const completion=task.completionReason==='SUBMITTED'?'과제 제출 완료':task.completionReason==='ATTENDANCE'?'LMS 출석 인정 완료 (전체 시청 완료와 구분)':'LMS 수강 완료';
  return {id:`hslms${digest(task.key)}`,summary:`${task.removed?'⛔ 삭제 · ':task.completed?'✅ 완료 · ':''}[${task.type==='ASSIGNMENT'?'과제':'강의'} 마감] ${task.courseName} · ${task.title}`,
    description:`한신 LMS 알리미가 등록한 마감입니다.\n${task.removed?'LMS의 정상 수집된 전체 목록에서 삭제·제외된 항목입니다. 마감 알림을 해제했습니다.':task.completed?completion:'미제출·미수강 확인됨. 제출·수강 여부는 LMS에서 확인하세요.'}\n${MY_LECTURES_URL}`,
    start,end,transparency:'transparent',extendedProperties:{private:{hsLmsItem:digest(task.key),hsLmsState:task.removed?'REMOVED':task.completed?'COMPLETED':'PENDING'}},
    reminders:{useDefault:false,overrides:task.completed||task.removed?[]:[{method:'popup',minutes:60}]}};
}

/** Reconcile the current observed LMS snapshot, including pre-existing pending tasks and previously exported completions. */
export function calendarTasks(store:LmsStore,connectedAt:string):CalendarTask[] {
  const tasks:CalendarTask[]=[];
  const rows=store.db.prepare(`SELECT i.item_key,i.payload_json,c.name FROM items i JOIN courses c ON i.course_key=c.course_key
    WHERE i.type IN ('ASSIGNMENT','VIDEO') AND i.last_seen_at=(SELECT started_at FROM sync_history WHERE status='SUCCESS' ORDER BY rowid DESC LIMIT 1)
    AND c.last_seen_at=i.last_seen_at
    AND NOT EXISTS (SELECT 1 FROM monitor_state m WHERE m.key='lms-removed:' || i.item_key) ORDER BY i.item_key`).all();
  for(const row of rows) {
    const key=String(row.item_key);
    const item=parseJson(String(row.payload_json),todoSourceSchema);
    const previous=ledgerValue(store,ledgerKey(connectedAt,key))??knownItemLedger(store,key);
    const completed=item.type==='ASSIGNMENT'?item.submitted===true:lectureSatisfied(item);
    const pending=item.type==='ASSIGNMENT'?item.submitted===false:item.completed===false;
    if(completed&&!previous || !completed&&!pending)continue; // Never invent a state, or create historical completed tasks.
    const dueAt=completed?(item.dueAt??previous?.task?.dueAt):item.dueAt;
    if(!dueAt || !(z.iso.date().safeParse(dueAt).success || z.iso.datetime({offset:true}).safeParse(dueAt).success))continue;
    tasks.push({key,title:item.title,courseName:String(row.name),type:item.type,dueAt,completed,
      ...(completed?{completionReason:item.type==='ASSIGNMENT'?'SUBMITTED' as const:item.completed===true?'VIEWED' as const:'ATTENDANCE' as const}:{})});
  }
  // Retain removal evidence across failed collections and OFF periods. Never create
  // a calendar event solely to report an LMS deletion that was never exported.
  const removed=store.db.prepare(`SELECT i.item_key FROM items i JOIN monitor_state m ON m.key='lms-removed:' || i.item_key
    WHERE i.type IN ('ASSIGNMENT','VIDEO') ORDER BY i.item_key`).all();
  for (const row of removed) {
    const key=String(row.item_key);
    const previous=ledgerValue(store,ledgerKey(connectedAt,key))??knownItemLedger(store,key);
    if(previous?.task)tasks.push({...previous.task,removed:true});
  }
  return tasks;
}

export async function syncGoogleCalendar(store:LmsStore,paths:RuntimePaths,settings:Settings,options:{signal?:AbortSignal;request?:typeof fetch;accessToken?:()=>Promise<string>;now?:()=>Date}={}):Promise<void> {
  if(!settings.googleCalendar.enabled || !settings.googleCalendar.connectedAt)return;
  const now=options.now??(()=>new Date());
  const previous=readCalendarStatus(paths);
  if(previous.state==='AUTH_REQUIRED' || previous.retryAt && Date.parse(previous.retryAt)>now().getTime())return;
  const binding=settings.googleCalendar.connectedAt;
  const pending=calendarTasks(store,binding).map(task=>({task,event:deadlineEvent(task),ledger:ledgerKey(binding,task.key)}))
    .filter(job=>ledgerValue(store,job.ledger)?.fingerprint!==digest(JSON.stringify(job.event)));
  if(!pending.length) {
    if(previous.pending)writeJson(statusFile(paths),{...previous,state:'SYNCED',pending:0,retryAt:null,lastError:'NONE'});
    return; // No token refresh or API request for unchanged tasks.
  }
  let remaining=pending.length;
  let lastSyncAt=previous.lastSyncAt;
  const save=(state:CalendarSyncStatus['state'],retryAt:string|null=null,lastError:CalendarSyncStatus['lastError']='NONE')=>writeJson(statusFile(paths),{state,pending:remaining,lastSyncAt,retryAt,lastError,verifiedAt:previous.verifiedAt});
  const request=options.request??fetch;
  try {
    const token=await (options.accessToken??(()=>calendarAccessToken(options.signal)))();
    for(const job of pending.slice(0,20)) {
      if(options.signal?.aborted)throw new CalendarError('NETWORK');
      const base='https://www.googleapis.com/calendar/v3/calendars/primary/events';
      const invoke=(url:string,method:string,body?:unknown)=>request(url,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000)});
      const acknowledged=!!store.db.prepare('SELECT value FROM monitor_state WHERE key=?').get(job.ledger);
      const {id,...update}=job.event;
      let response:Response;
      if(job.task.removed || job.task.completed&&!acknowledged) {
        const existing=await invoke(`${base}/${id}?fields=id,extendedProperties`,'GET');
        if(existing.ok) {
          const data=await existing.json() as {extendedProperties?:{private?:{hsLmsItem?:string}}};
          if(data.extendedProperties?.private?.hsLmsItem!==digest(job.task.key))throw new CalendarError('PERMISSION');
          response=await invoke(`${base}/${id}?sendUpdates=none`,'PATCH',update);
        } else response=existing;
      } else response=await invoke(acknowledged?`${base}/${id}?sendUpdates=none`:`${base}?sendUpdates=none`,acknowledged?'PATCH':'POST',acknowledged?update:job.event);
      if(acknowledged && response.status===404 && !job.task.completed && !job.task.removed) {await response.body?.cancel();response=await invoke(`${base}?sendUpdates=none`,'POST',job.event);}
      // A user-deleted completed event must not be recreated just to mark it complete.
      if((job.task.completed || job.task.removed) && (response.status===404 || response.status===410)) {
        await response.body?.cancel();
        store.db.prepare('INSERT INTO monitor_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run(job.ledger,JSON.stringify({fingerprint:digest(JSON.stringify(job.event)),task:job.task}));
        remaining--;save(remaining?'RETRY':'SYNCED');continue;
      }
      else if(!acknowledged && response.status===409) {
        await response.body?.cancel();
        const existing=await invoke(`${base}/${id}?fields=id,extendedProperties`,'GET');
        if(!existing.ok) {response=existing;}
        else {
          const data=await existing.json() as {extendedProperties?:{private?:{hsLmsItem?:string}}};
          if(data.extendedProperties?.private?.hsLmsItem!==digest(job.task.key))throw new CalendarError('AUTH');
          response=await invoke(`${base}/${id}?sendUpdates=none`,'PATCH',update);
        }
      }
      if(!response.ok) {
        const wait=Number(response.headers.get('retry-after'));
        const code=response.status;
        let quota=false;
        if(code===403) {
          const data=await response.json().catch(()=>null) as {error?:{errors?:Array<{reason?:string}>}}|null;
          quota=!!data?.error?.errors?.some(error=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(error.reason??''));
        } else await response.body?.cancel();
        if(code===401 || code===403&&!quota)throw new CalendarError(code===401?'AUTH':'PERMISSION');
        save('RETRY',new Date(now().getTime()+(Number.isFinite(wait)&&wait>0?Math.min(wait,604800):1800)*1000).toISOString(),code===429||quota?'RATE_LIMIT':'NETWORK');return;
      }
      const result=await response.json() as {id?:string};
      if(result.id!==id)throw new CalendarError('NETWORK');
      store.db.prepare('INSERT INTO monitor_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(job.ledger,JSON.stringify({fingerprint:digest(JSON.stringify(job.event)),task:job.task}));
      remaining--;lastSyncAt=now().toISOString();save(remaining?'RETRY':'SYNCED');
    }
  } catch(error) {
    const kind=error instanceof CalendarError&&['AUTH','PERMISSION','API_DISABLED'].includes(error.kind)?error.kind as 'AUTH'|'PERMISSION'|'API_DISABLED':'NETWORK';
    save(kind==='NETWORK'?'RETRY':'AUTH_REQUIRED',kind==='NETWORK'?new Date(now().getTime()+1800000).toISOString():null,kind);
  }
}
