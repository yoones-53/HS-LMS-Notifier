import { z } from 'zod';
import { isStatusCode, SCOPES, safeResult, issue, runResult, type StatusCode } from './model.js';
import { parseJson } from '../runtime/json.js';

const code = z.custom<StatusCode>(isStatusCode);
const time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(10_000_000);
export const issueSchema = z.object({ errorCode: code, scope: z.enum(SCOPES), courseId: z.string().max(120).optional(),
  courseName: z.string().max(1000).optional(), safeReason: z.string().max(2000), action: z.string().max(2000), recoverable: z.boolean() });
export const resultSchema = z.object({ status: code, code, title: z.string().max(2000), reason: z.string().max(2000),
  action: z.string().max(2000), recoverable: z.boolean(), occurredAt: time, exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  affectedScopes: z.array(z.enum(SCOPES)).max(1000), errors: z.array(issueSchema).max(1000), warnings: z.array(issueSchema).max(1000),
  collectionStatus: z.enum(['SUCCESS','PARTIAL','FAILED','NOT_RUN']).optional(),
  databaseStatus: z.enum(['SUCCESS','FAILED','NOT_RUN']).optional(), notificationStatus: z.enum(['SUCCESS','FAILED','NOT_RUN']).optional() });
export const monitorSchema = resultSchema.extend({ courses: count.default(0), notices: count.default(0), materials: count.default(0),
  assignments: count.default(0), videos: count.default(0), changes: count.default(0), sent: count.default(0),
  authentication: z.enum(['OK','NOT_CONFIRMED']).default('NOT_CONFIRMED'), browserClosed: z.boolean().default(false) });
export const incidentSchema = z.object({ id: z.uuid(), issue: issueSchema, count, firstSeenAt: time, lastSeenAt: time,
  generation: count, lastSentAt: time.nullable() });
export const incidentsSchema = z.array(incidentSchema).max(10_000);
export const recoverySchema = z.object({ previous: code, current: z.literal('SUCCESS'), occurredAt: time, issue: issueSchema });
export function guiRun(value: unknown) {
  const r = monitorSchema.parse(value);
  const result = runResult(r.code, r.errors.map(cleanIssue), new Date(r.occurredAt), r.status === 'PARTIAL');
  result.warnings = r.warnings.map(cleanIssue);
  if (r.collectionStatus) result.collectionStatus = r.collectionStatus;
  if (r.databaseStatus) result.databaseStatus = r.databaseStatus;
  if (r.notificationStatus) result.notificationStatus = r.notificationStatus;
  return { result: safeResult(result), counts: { courses: r.courses, notices: r.notices, materials: r.materials,
    assignments: r.assignments, videos: r.videos, changes: r.changes, sent: r.sent }, authentication: r.authentication, browserClosed: r.browserClosed };
}
export type GuiRun = ReturnType<typeof guiRun>;
export const parsedRun = (text: string): GuiRun => guiRun(parseJson(text, monitorSchema));
export const cleanIssue = (value: z.infer<typeof issueSchema>) => issue(value.errorCode, value.scope,
  value.courseId ? { id: value.courseId, name: value.courseName ?? '' } : undefined);
