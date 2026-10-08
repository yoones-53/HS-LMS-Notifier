import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Credentials } from '../auth/credentials.js';
import { validateWebhook } from '../notification/discord.js';
import { migrateRuntime } from '../runtime/migration.js';
import { acquireRuntimeLock, type RuntimePaths } from '../runtime/paths.js';
import { DataFileError, readJson, writeJson } from '../runtime/json.js';
import { cleanOldLogs } from '../runtime/retention.js';
import { guiRun } from '../status/schema.js';
import { STATUS_INFO } from '../status/model.js';
import { AppError, classifyError } from '../utils/result.js';
import { defaultSettings, requestSchema, settingsSchema, type DesktopStatus, type Reply, type SchedulerStatus, type Settings } from './contracts.js';
import { readHistory } from './history.js';

export interface DesktopDependencies {
  configured(kind: 'LMS' | 'DISCORD'): Promise<boolean>;
  readId(): Promise<string>;
  saveLogin(value: Credentials): Promise<void>;
  removeLogin(): Promise<void>;
  saveDiscord(value: string): Promise<void>;
  legacyWebhook(): string | undefined;
  testLogin(signal: AbortSignal): Promise<void>;
  testDiscord(): Promise<void>;
  run(paths: RuntimePaths, signal: AbortSignal): Promise<unknown>;
  scheduler(): Promise<SchedulerStatus>;
  schedulerPolicy: 'TASK' | 'TIMER';
  syncScheduler(action: 'Ensure' | 'Disable' | 'MigrateLegacy'): Promise<SchedulerStatus>;
  open(target: 'logs' | 'data' | 'help'): Promise<void>;
}
export function desktopError(error: unknown): string {
  if (error instanceof DataFileError) return '데이터 파일을 읽을 수 없습니다. 파일을 삭제하지 말고 로그와 데이터 위치를 확인해 주세요.';
  if (error instanceof AppError) {
    const code = classifyError(error);
    if (code === 'CREDENTIALS_NOT_CONFIGURED' || code === 'AUTO_LOGIN_FAILED') return `${STATUS_INFO[code][0]}. 설정에서 LMS 로그인 정보를 확인해 주세요.`;
    return STATUS_INFO[code][1];
  }
  return '작업을 완료하지 못했습니다. 입력값과 실행 환경을 확인해 주세요. 비밀정보는 표시하지 않습니다.';
}

export class DesktopService {
  private settings!: Settings;
  private migration: DesktopStatus['migration'] = 'EXISTING';
  private pending: Promise<unknown> | undefined;
  private controller: AbortController | undefined;
  private closing = false;
  private nextAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ready = false;
  private readonly settingsFile: string;
  constructor(readonly paths: RuntimePaths, readonly legacy: RuntimePaths, private deps: DesktopDependencies) {
    this.settingsFile = join(paths.state, 'settings.json');
  }
  async initialize(): Promise<void> {
    this.migration = await migrateRuntime(this.legacy, this.paths);
    this.settings = existsSync(this.settingsFile) ? readJson(this.settingsFile, settingsSchema) : defaultSettings();
    // Import a legacy secret only into the current user's Credential Manager, never JSON.
    await this.exclusive(async () => {
      if (!await this.deps.configured('DISCORD')) {
        const secret = this.deps.legacyWebhook();
        if (secret) { validateWebhook(secret); await this.deps.saveDiscord(secret); }
      }
    });
    const history = readHistory(this.paths);
    if (!existsSync(this.settingsFile) && history.recent.some(r => r.authentication === 'OK'
        && ['SUCCESS','SUCCESS_WITH_CHANGES'].includes(r.result.code))
        && await this.deps.configured('LMS') && await this.deps.configured('DISCORD')) {
      // Existing successful monitoring is evidence of setup, not a fabricated login test.
      this.settings.setupComplete = true;
      this.settings.lmsVerifiedAt = history.recent[0]?.result.occurredAt ?? null;
      this.settings.discordVerifiedAt = this.settings.lmsVerifiedAt;
    }
    this.persist();
    cleanOldLogs(this.paths.logs, this.settings.retentionDays);
    this.ready = true;
    await this.refreshSchedule();
  }
  private persist(): void { writeJson(this.settingsFile, settingsSchema.parse(this.settings)); }
  private async exclusive<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.pending || this.closing) throw new AppError('SCHEDULER_LOCKED');
    const release = acquireRuntimeLock(this.paths, this.legacy);
    if (!release) throw new AppError('SCHEDULER_LOCKED');
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.pending = Promise.resolve().then(() => action(signal));
    try { return await this.pending as T; }
    finally { this.pending = undefined; this.controller = undefined; release(); }
  }
  private async refreshSchedule(): Promise<SchedulerStatus> {
    let scheduler = await this.deps.scheduler();
    if (this.deps.schedulerPolicy === 'TASK') {
      if (this.settings.setupComplete && this.settings.autoEnabled) {
        // Status polling must not re-register an active task: registration moves NextRunTime.
        if (['ABSENT', 'STALE'].includes(scheduler.mode)
            || scheduler.mode === 'LEGACY' && !scheduler.legacyActive) scheduler = await this.deps.syncScheduler('Ensure');
      } else if (scheduler.targetCurrent && scheduler.state === 'ACTIVE') {
        scheduler = await this.deps.syncScheduler('Disable');
      }
      this.nextAt = null;
      return scheduler;
    }
    if (!this.settings.setupComplete || !this.settings.autoEnabled || !['ABSENT','INACTIVE'].includes(scheduler.state)) this.nextAt = null;
    else this.nextAt ??= Date.now() + 30 * 60_000;
    return scheduler;
  }
  async status(): Promise<DesktopStatus> {
    // Revalidate on read as well: a corrupt settings file is not silently replaced.
    readJson(this.settingsFile, settingsSchema);
    const scheduler = await this.refreshSchedule();
    return { settings: { ...this.settings }, credentialsConfigured: await this.deps.configured('LMS'),
      discordConfigured: await this.deps.configured('DISCORD'), busy: !!this.pending, migration: this.migration,
      scheduler, nextAt: this.deps.schedulerPolicy === 'TASK'
        ? this.settings.setupComplete && this.settings.autoEnabled && scheduler.mode === 'PRODUCTION' && scheduler.state === 'ACTIVE'
          ? scheduler.nextAt : null
        : this.nextAt ? new Date(this.nextAt).toISOString() : null,
      ...readHistory(this.paths) };
  }
  async handle(input: unknown): Promise<Reply> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '허용되지 않은 요청 또는 잘못된 입력입니다.' };
    const { method } = parsed.data;
    try {
      if (method === 'openLogs' || method === 'openData' || method === 'openDiscordHelp') {
        await this.deps.open(method === 'openLogs' ? 'logs' : method === 'openData' ? 'data' : 'help');
        return { ok: true };
      }
      if (!this.ready) throw new DataFileError();
      readJson(this.settingsFile, settingsSchema);
      if (method === 'getStatus') return { ok: true, data: await this.status() };
      if (method === 'getSettings') return { ok: true, data: { ...this.settings } };
      if (method === 'getRecentIncidents') return { ok: true, data: readHistory(this.paths).incidents };
      const data = await this.exclusive(async signal => {
        const request = parsed.data;
        switch (request.method) {
          case 'runCheck': {
            const result = guiRun(await this.deps.run(this.paths, signal));
            this.nextAt = null;
            cleanOldLogs(this.paths.logs, this.settings.retentionDays);
            return result;
          }
          case 'updateSettings':
            { const updated = settingsSchema.parse({ ...this.settings, ...request.payload });
              writeJson(this.settingsFile, updated); this.settings = updated; this.nextAt = null; await this.refreshSchedule(); }
            return { ...this.settings };
          case 'setupCredentials':
            // v1 is one account per Windows user. Never merge another student's data.
            if (readHistory(this.paths).recent.length && await this.deps.configured('LMS') && await this.deps.readId() !== request.payload.id)
              throw new AppError('INITIALIZATION_ERROR');
            try { await this.deps.saveLogin(request.payload); }
            finally { request.payload.id = ''; request.payload.password = ''; }
            this.settings.lmsVerifiedAt = null; this.persist(); return;
          case 'removeCredentials':
            await this.deps.removeLogin(); this.settings.lmsVerifiedAt = null; this.settings.setupComplete = false; this.persist(); await this.refreshSchedule(); return;
          case 'testCredentials':
            await this.deps.testLogin(signal); this.settings.lmsVerifiedAt = new Date().toISOString(); this.persist(); return;
          case 'configureDiscord':
            try { validateWebhook(request.payload.webhook); await this.deps.saveDiscord(request.payload.webhook); }
            finally { request.payload.webhook = ''; }
            this.settings.discordVerifiedAt = null; this.persist(); return;
          case 'testDiscord':
            await this.deps.testDiscord(); this.settings.discordVerifiedAt = new Date().toISOString(); this.persist(); return;
          case 'completeSetup':
            if (!this.settings.lmsVerifiedAt || !this.settings.discordVerifiedAt) throw new AppError('INITIALIZATION_ERROR');
            this.settings.setupComplete = true; this.persist(); await this.refreshSchedule(); return;
          case 'migrateLegacyScheduler':
            if (this.deps.schedulerPolicy !== 'TASK') throw new AppError('INITIALIZATION_ERROR');
            if ((await this.deps.syncScheduler('MigrateLegacy')).mode !== 'PRODUCTION') throw new AppError('INITIALIZATION_ERROR');
            return;
        }
      });
      return data === undefined ? { ok: true } : { ok: true, data };
    } catch (error) { return { ok: false, message: desktopError(error) }; }
  }
  startTimer(): void {
    if (this.deps.schedulerPolicy === 'TASK') return;
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 60_000);
  }
  async tick(now = Date.now()): Promise<void> {
    if (!this.ready || this.closing || this.deps.schedulerPolicy === 'TASK') return;
    await this.refreshSchedule();
    if (this.nextAt !== null && now >= this.nextAt && !this.pending) {
      this.nextAt = now + 30 * 60_000;
      await this.handle({ method: 'runCheck' });
    }
  }
  trayHint(): boolean {
    if (!this.ready || this.settings.trayHintShown) return false;
    this.settings.trayHintShown = true; this.persist(); return true;
  }
  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    try { await this.pending; } catch { /* safely reported by handle */ }
  }
}
