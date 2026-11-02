import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { credentialBridge, credentialsConfigured, DISCORD_TARGET, loadDiscordSecret, readCredentials, saveCredentials } from '../auth/credentials.js';
import { freshSource } from '../auth/fresh-source.js';
import { discordTransport } from '../notification/discord.js';
import { runMonitorOnce } from '../runtime/run-once.js';
import { PROJECT_ROOT } from '../utils/config.js';
import { packagedResourcesRoot } from '../utils/resources.js';
import { AppError } from '../utils/result.js';
import { inspectScheduler, updateScheduler } from './scheduler.js';
import type { DesktopDependencies } from './service.js';
import { connectGoogleCalendar, disconnectGoogleCalendar, distributedOAuthClient, verifySavedGoogleCalendar } from '../calendar/auth.js';
import { syncGoogleCalendar } from '../calendar/sync.js';
import { LmsStore } from '../database/store.js';
import { loadSettings } from '../runtime/settings.js';

export function productionDependencies(open: DesktopDependencies['open'], openGoogleLogin?: (url:string)=>Promise<void>): DesktopDependencies {
  const packaged = !!packagedResourcesRoot();
  return {
    calendarLoginAvailable:!!distributedOAuthClient() && !!openGoogleLogin,
    connectCalendar:signal=>{if(!openGoogleLogin)throw new Error('CALENDAR_SETUP');return connectGoogleCalendar(openGoogleLogin,signal);},
    disconnectCalendar:disconnectGoogleCalendar,
    verifyCalendar:verifySavedGoogleCalendar,
    syncCalendar:async(paths,signal)=>{
      const store=new LmsStore(paths.database);
      try{await syncGoogleCalendar(store,paths,loadSettings(paths),{signal});}finally{store.close();}
    },
    configured: kind => credentialsConfigured(kind === 'DISCORD' ? DISCORD_TARGET : undefined),
    readId: async () => { const value = await readCredentials(); try { return value.id; } finally { value.id = ''; value.password = ''; } },
    saveLogin: value => saveCredentials(value), removeLogin: async () => { (await credentialBridge('Remove')).fill(0); },
    saveDiscord: value => saveCredentials({ id: 'Discord Webhook', password: value }, DISCORD_TARGET),
    legacyWebhook: () => {
      if (packagedResourcesRoot()) return undefined;
      const path = join(PROJECT_ROOT, '.env');
      return existsSync(path) ? parse(readFileSync(path)).DISCORD_WEBHOOK_URL : undefined;
    },
    testLogin: async signal => {
      const source = freshSource(true, signal);
      try { await source.authenticate(); } finally { await source.dispose(); }
    },
    testDiscord: async () => {
      const delivered = await discordTransport(await loadDiscordSecret())({ embeds: [{ title: '✅ 한신 LMS 알리미 연결 테스트',
        description: 'Discord 연결을 확인했습니다. 로그인 정보는 포함되지 않습니다.' }], allowed_mentions: { parse: [] } });
      if (delivered.status !== 'SENT') throw new AppError('DISCORD_NOTIFICATION_FAILED');
    },
    run: (paths, signal) => runMonitorOnce(paths, { headless: true, loadWebhook: () => loadDiscordSecret(), signal }),
    scheduler: inspectScheduler, schedulerPolicy: packaged ? 'TASK' : 'TIMER',
    syncScheduler: action => updateScheduler(action, packaged ? process.execPath : undefined), open,
  };
}
