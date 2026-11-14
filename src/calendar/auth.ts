import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';
import { CALENDAR_TARGET, credentialBridge, readCredentials, saveCredentials } from '../auth/credentials.js';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
declare const GOOGLE_DESKTOP_CLIENT_ID: string;
declare const GOOGLE_DESKTOP_CLIENT_SECRET: string;
export interface OAuthClient { clientId: string; clientSecret: string }
export function distributedOAuthClient(): OAuthClient | null {
  const clientId = typeof GOOGLE_DESKTOP_CLIENT_ID === 'undefined' ? '' : GOOGLE_DESKTOP_CLIENT_ID;
  const clientSecret = typeof GOOGLE_DESKTOP_CLIENT_SECRET === 'undefined' ? '' : GOOGLE_DESKTOP_CLIENT_SECRET;
  return /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) && !!clientSecret ? { clientId, clientSecret } : null;
}
export class CalendarError extends Error {
  constructor(readonly kind: 'SETUP' | 'CANCELLED' | 'AUTH' | 'NETWORK' | 'PERMISSION' | 'API_DISABLED') { super(`CALENDAR_${kind}`); }
}
const tokenSchema = z.object({ access_token: z.string().min(1).max(8192), expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).max(1000).optional(), scope: z.string().optional(), token_type: z.string().optional() });
async function tokenRequest(body: URLSearchParams, signal?: AbortSignal, request: typeof fetch = fetch) {
  try {
    const response = await request(TOKEN_URL, { method: 'POST', body, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new CalendarError(response.status === 400 || response.status === 401 ? 'AUTH' : 'NETWORK'); }
    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success) throw new CalendarError('AUTH');
    return parsed.data;
  } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError(signal?.aborted ? 'CANCELLED' : 'NETWORK'); }
}

/** A temporary loopback listener exists only while the system browser handles consent. */
export async function authorizeGoogleCalendar(client: OAuthClient, openBrowser: (url: string) => Promise<void>, signal?: AbortSignal,
  request: typeof fetch = fetch, timeoutMs = 180_000): Promise<{ clientId: string; clientSecret: string; refreshToken: string; accessToken:string }> {
  if (signal?.aborted) throw new CalendarError('CANCELLED');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const server = createServer();
  let rejectCode!: (reason: Error) => void;
  let resolveCode!: (value: string) => void;
  const codePromise = new Promise<string>((resolve,reject) => { resolveCode=resolve; rejectCode=reject; });
  // Prevent a fast abort/browser error from becoming an unhandled rejection.
  void codePromise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => rejectCode(new CalendarError('CANCELLED'));
  try {
    await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    const address=server.address(); if (!address || typeof address==='string') throw new CalendarError('NETWORK');
    const redirect=`http://127.0.0.1:${address.port}/oauth2callback`;
    server.on('request',(incoming,response)=>{
      response.setHeader('content-type','text/plain; charset=utf-8');
      response.setHeader('cache-control','no-store');
      const url=new URL(incoming.url??'/',redirect);
      const received=url.searchParams.get('state')??'';
      if (incoming.method!=='GET' || incoming.headers.host!==`127.0.0.1:${address.port}` || url.pathname!=='/oauth2callback'
          || Buffer.byteLength(received)!==Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(received),Buffer.from(state))) {
        response.writeHead(400);response.end('잘못된 로그인 응답입니다.');return;
      }
      const code=url.searchParams.get('code');
      if (url.searchParams.has('error') || !code || code.length>4096) {
        response.end('Google 연결을 취소했습니다. 앱으로 돌아가세요.');rejectCode(new CalendarError('CANCELLED'));return;
      }
      response.end('Google 로그인을 확인했습니다. 이 창을 닫고 한신 LMS 알리미로 돌아가세요.');resolveCode(code);
    });
    timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:client.clientId,redirect_uri:redirect,response_type:'code',scope:CALENDAR_SCOPE,
      access_type:'offline',prompt:'consent select_account',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    await openBrowser(url.href);
    const code=await codePromise;
    server.close();
    const token=await tokenRequest(new URLSearchParams({client_id:client.clientId,client_secret:client.clientSecret,code,
      redirect_uri:redirect,code_verifier:verifier,grant_type:'authorization_code'}),signal,request);
    if (!token.refresh_token || token.scope && !token.scope.split(' ').includes(CALENDAR_SCOPE)) throw new CalendarError('AUTH');
    return {...client,refreshToken:token.refresh_token,accessToken:token.access_token};
  } catch(error) { if (error instanceof CalendarError) throw error;throw new CalendarError('NETWORK'); }
  finally { if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);server.close();server.closeAllConnections(); }
}
export async function connectGoogleCalendar(open: (url: string) => Promise<void>, signal: AbortSignal): Promise<void> {
  const client=distributedOAuthClient();if(!client)throw new CalendarError('SETUP');
  const tokens=await authorizeGoogleCalendar(client,open,signal);
  try {
    await verifyCalendarAccess(tokens.accessToken,signal);
    await saveCredentials({id:tokens.clientId,password:JSON.stringify({clientSecret:tokens.clientSecret,refreshToken:tokens.refreshToken})},CALENDAR_TARGET);
  } finally { tokens.clientSecret='';tokens.refreshToken='';tokens.accessToken=''; }
}
/** Confirm primary-calendar access before declaring login successful; do not fetch event contents. */
export async function verifyCalendarAccess(accessToken:string,signal?:AbortSignal,request:typeof fetch=fetch):Promise<void> {
  try {
    const response=await request('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=kind,accessRole',{
      headers:{authorization:`Bearer ${accessToken}`},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if(!response.ok) {
      const data=await response.json().catch(()=>null) as {error?:{errors?:Array<{reason?:string}>}}|null;
      const disabled=data?.error?.errors?.some(error=>['accessNotConfigured','serviceDisabled'].includes(error.reason??''));
      throw new CalendarError(response.status===401?'AUTH':response.status===403?disabled?'API_DISABLED':'PERMISSION':'NETWORK');
    }
    const data=z.object({kind:z.literal('calendar#events'),accessRole:z.literal('owner')}).safeParse(await response.json());
    if(!data.success)throw new CalendarError('PERMISSION');
  } catch(error) { if(error instanceof CalendarError)throw error;throw new CalendarError(signal?.aborted?'CANCELLED':'NETWORK'); }
}
export async function verifySavedGoogleCalendar(signal?:AbortSignal):Promise<void> {await verifyCalendarAccess(await calendarAccessToken(signal),signal);}
export async function calendarAccessToken(signal?: AbortSignal): Promise<string> {
  const saved=await readCredentials(CALENDAR_TARGET).catch(()=>{throw new CalendarError('AUTH');});
  try {
    const secret=z.object({clientSecret:z.string().min(1),refreshToken:z.string().min(1)}).strict().parse(JSON.parse(saved.password));
    const token=await tokenRequest(new URLSearchParams({client_id:saved.id,client_secret:secret.clientSecret,refresh_token:secret.refreshToken,grant_type:'refresh_token'}),signal);
    if(token.refresh_token && token.refresh_token!==secret.refreshToken)
      await saveCredentials({id:saved.id,password:JSON.stringify({...secret,refreshToken:token.refresh_token})},CALENDAR_TARGET);
    return token.access_token;
  } catch(error) { if(error instanceof CalendarError)throw error;throw new CalendarError('AUTH'); }
  finally { saved.id='';saved.password=''; }
}
export async function disconnectGoogleCalendar(): Promise<void> { (await credentialBridge('Remove',CALENDAR_TARGET)).fill(0); }
