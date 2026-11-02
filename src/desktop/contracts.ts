import { z } from 'zod';
import type { GuiRun } from '../status/schema.js';
import type { RunIssue } from '../status/model.js';
import { settingsPatchSchema } from '../runtime/settings.js';
import type { Settings } from '../runtime/settings.js';
import type { TodoDashboard } from '../summary/todo.js';
import type { CalendarSyncStatus } from '../calendar/sync.js';
export { settingsSchema, settingsPatchSchema, defaultSettings, type Settings } from '../runtime/settings.js';

export const loginInputSchema = z.object({ id: z.string().min(1).max(513).regex(/^[^\x00-\x1f]+$/),
  password: z.string().min(1).max(1280).regex(/^[^\x00]+$/) }).strict();
export const discordInputSchema = z.object({ webhook: z.string().min(1).max(1280) }).strict();
export const METHODS = ['verifyCalendar','connectCalendar','disconnectCalendar','setCalendarEnabled','setAutoEnabled','setTodoExcluded','getStatus','getSettings','updateSettings','runCheck','setupCredentials','removeCredentials','migrateLegacyScheduler',
  'testCredentials','configureDiscord','testDiscord','completeSetup','getRecentIncidents','openLogs','openData','openDiscordHelp'] as const;
export type Method = typeof METHODS[number];
export const requestSchema = z.discriminatedUnion('method', [
  z.object({method:z.literal('setCalendarEnabled'),payload:z.boolean()}).strict(),
  z.object({ method: z.literal('setAutoEnabled'), payload: z.boolean() }).strict(),
  z.object({ method: z.literal('setTodoExcluded'), payload: z.object({ key: z.string().min(1).max(2000), excluded: z.boolean() }).strict() }).strict(),
  z.object({ method: z.literal('updateSettings'), payload: settingsPatchSchema }).strict(),
  z.object({ method: z.literal('setupCredentials'), payload: loginInputSchema }).strict(),
  z.object({ method: z.literal('configureDiscord'), payload: discordInputSchema }).strict(),
  z.object({ method: z.enum(['verifyCalendar','connectCalendar','disconnectCalendar','getStatus','getSettings','runCheck','removeCredentials','migrateLegacyScheduler','testCredentials','testDiscord',
    'completeSetup','getRecentIncidents','openLogs','openData','openDiscordHelp']), payload: z.undefined().optional() }).strict(),
]);
export type Request = z.infer<typeof requestSchema>;
export interface SchedulerStatus { state: 'ACTIVE' | 'INACTIVE' | 'ABSENT' | 'UNKNOWN'; nextAt: string | null;
  mode: 'PRODUCTION' | 'LEGACY' | 'DUPLICATE' | 'STALE' | 'CONFLICT' | 'ABSENT' | 'UNKNOWN'; legacyDetected: boolean; legacyActive: boolean; targetCurrent: boolean }
export interface DesktopStatus {
  settings: Settings; credentialsConfigured: boolean; discordConfigured: boolean; busy: boolean;
  migration: 'MIGRATED' | 'EXISTING' | 'FRESH'; scheduler: SchedulerStatus; nextAt: string | null;
  recent: GuiRun[]; incidents: RunIssue[]; recovery: { occurredAt: string; issue: RunIssue } | null;
  todo: TodoDashboard;
  excludedTodo?: TodoDashboard['items'];
  calendar?: CalendarSyncStatus & {loginAvailable:boolean};
}
export interface Reply<T = unknown> { ok: boolean; data?: T; message?: string }
export interface DesktopApi {
  verifyCalendar():Promise<Reply>;
  connectCalendar():Promise<Reply>;
  disconnectCalendar():Promise<Reply>;
  setCalendarEnabled(enabled:boolean):Promise<Reply>;
  setAutoEnabled(enabled: boolean): Promise<Reply>;
  setTodoExcluded(value: { key: string; excluded: boolean }): Promise<Reply>;
  getStatus(): Promise<Reply<DesktopStatus>>; getSettings(): Promise<Reply<Settings>>;
  updateSettings(value: z.infer<typeof settingsPatchSchema>): Promise<Reply<Settings>>;
  runCheck(): Promise<Reply<GuiRun>>; setupCredentials(value: z.infer<typeof loginInputSchema>): Promise<Reply>;
  removeCredentials(): Promise<Reply>; testCredentials(): Promise<Reply>;
  configureDiscord(value: z.infer<typeof discordInputSchema>): Promise<Reply>; testDiscord(): Promise<Reply>;
  completeSetup(): Promise<Reply>; getRecentIncidents(): Promise<Reply<RunIssue[]>>; migrateLegacyScheduler(): Promise<Reply>;
  openLogs(): Promise<Reply>; openData(): Promise<Reply>; openDiscordHelp(): Promise<Reply>;
}
