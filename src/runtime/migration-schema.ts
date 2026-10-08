import { z } from 'zod';
export const migrationTables = ['courses', 'items', 'scope_baselines', 'notification_history', 'sync_history', 'change_events', 'monitor_runs', 'monitor_state'] as const;
export const migrationSchema = z.object({ version: z.literal(1), id: z.uuid(), sourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(['COPIED', 'FRESH']), status: z.literal('ACTIVE'), schemaVersion: z.literal(4),
  counts: z.record(z.enum(migrationTables), z.number().int().nonnegative()), digest: z.string().regex(/^[a-f0-9]{64}$/), completedAt: z.iso.datetime() }).strict();
