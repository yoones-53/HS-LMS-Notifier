import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readJson } from './json.js';
import type { RuntimePaths } from './paths.js';

export const deadlineNotificationsSchema = z.object({ d7: z.boolean(), d3: z.boolean(), d1: z.boolean(), d0: z.boolean() }).strict();
export type DeadlineNotifications = z.infer<typeof deadlineNotificationsSchema>;
export const defaultDeadlineNotifications = (): DeadlineNotifications => ({ d7: true, d3: true, d1: true, d0: true });
export const settingsSchema = z.object({ version: z.literal(1), setupComplete: z.boolean(), autoEnabled: z.boolean(),
  intervalMinutes: z.literal(30), retentionDays: z.number().int().min(7).max(365), trayHintShown: z.boolean(),
  lmsVerifiedAt: z.iso.datetime().nullable(), discordVerifiedAt: z.iso.datetime().nullable(),
  deadlineNotifications: deadlineNotificationsSchema.default(defaultDeadlineNotifications) }).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({ version: 1, setupComplete: false, autoEnabled: true, intervalMinutes: 30,
  retentionDays: 30, trayHintShown: false, lmsVerifiedAt: null, discordVerifiedAt: null,
  deadlineNotifications: defaultDeadlineNotifications() });
export const settingsPatchSchema = z.object({ autoEnabled: z.boolean(), retentionDays: z.number().int().min(7).max(365),
  deadlineNotifications: deadlineNotificationsSchema.optional() }).strict();

// Shared by CLI, Task Scheduler and GUI. Missing legacy settings retain all ON;
// malformed existing settings fail closed, never silently reset user choices.
export function loadSettings(paths: RuntimePaths): Settings {
  const file = join(paths.state, 'settings.json');
  return existsSync(file) ? readJson(file, settingsSchema) : defaultSettings();
}
export function deadlineEnabled(days: number, settings: DeadlineNotifications): boolean {
  const key = ({ 7: 'd7', 3: 'd3', 1: 'd1', 0: 'd0' } as const)[days as 7 | 3 | 1 | 0];
  return key !== undefined && settings[key];
}
