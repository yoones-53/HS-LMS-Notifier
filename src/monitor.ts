import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { LmsStore } from './database/store.js';
import type { Course } from './crawler/courses.js';
import { courseKey, type ItemType, type LmsItem, type ScopeSnapshot } from './model.js';
import { deadlineReminders } from './detector/deadlines.js';
import { notifyChanges } from './notification/changes.js';
import { notifyDeadlines } from './notification/deadlines.js';
import { notifyInitialSummary, type InitialSummaryOutcome } from './notification/initial-summary.js';
import { buildInitialSetupSummary } from './summary/initial-setup.js';
import type { Transport } from './notification/discord.js';
import type { Log } from './utils/logger.js';
import { AppError, classifyError, type RunStatus } from './utils/result.js';
import { checkpoint, issue, runResult, type RunResult, type Scope } from './status/model.js';
import { reportIncidents } from './status/incidents.js';
import type { DeadlineNotifications } from './runtime/settings.js';

export interface Collection { status: 'OK' | 'UNAVAILABLE'; items: LmsItem[]; unidentifiedOnlineRows?: number }
export interface LmsSource {
  courses(): Promise<Course[]>;
  enter(course: Course): Promise<void>;
  collect(course: Course, type: ItemType): Promise<Collection>;
}
export interface MonitorResult extends RunResult {
  collectionStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_RUN';
  databaseStatus: 'SUCCESS' | 'FAILED' | 'NOT_RUN';
  notificationStatus: 'SUCCESS' | 'FAILED' | 'NOT_RUN';
  completedCourses: number; failedCourses: number;
  initialSummary: InitialSummaryOutcome;
  authentication: 'OK' | 'NOT_CONFIRMED'; loginMode: 'AUTO' | 'SESSION'; browserClosed: boolean;
  notices: number; materials: number; assignments: number; videos: number; changes: number;
  courses: number; failures: number; baseline: number; newItems: number; updated: number;
  unchanged: number; sent: number; deferred: number; uncertain: number;
}
const isAuthError = (error: unknown): boolean => classifyError(error) === 'AUTH_EXPIRED_DURING_CRAWL';

export async function runMonitor(store: LmsStore, source: LmsSource, transport: Transport, log: Log,
  options: { now?: () => Date; deliveryDelayMs?: number; authenticate?: () => Promise<void>; dispose?: () => Promise<void>; notificationAvailable?: boolean; signal?: AbortSignal; deadlineNotifications?: DeadlineNotifications } = {}): Promise<MonitorResult> {
  const checkCancelled = () => { if (options.signal?.aborted) throw new AppError('UNKNOWN_ERROR'); };
  const now = options.now ?? (() => new Date());
  const runId = randomUUID();
  const result: MonitorResult = { ...runResult('SUCCESS', [], now()), courses: 0, failures: 0, baseline: 0,
    collectionStatus: 'NOT_RUN', databaseStatus: 'NOT_RUN', notificationStatus: 'NOT_RUN', completedCourses: 0, failedCourses: 0,
    initialSummary: { status: 'SKIPPED', reason: 'AUTHENTICATION_NOT_CONFIRMED', delivery: null },
    newItems: 0, updated: 0, unchanged: 0, sent: 0, deferred: 0, uncertain: 0,
    authentication: 'NOT_CONFIRMED', loginMode: options.authenticate ? 'AUTO' : 'SESSION', browserClosed: false,
    notices: 0, materials: 0, assignments: 0, videos: 0, changes: 0 };
  let phase: Scope = 'DATABASE';
  let fatal: RunStatus | undefined;
  const healthy = new Set<string>();
  let successfulScopes = 0;
  const fail = (code: RunStatus, scope: Scope, course?: Course) => {
    const entry = issue(code, scope, course ? { id: courseKey(course), name: course.name } : undefined);
    if (!result.errors.some(e => e.errorCode === code && checkpoint(e.scope, e.courseId) === checkpoint(entry.scope, entry.courseId))) {
      result.errors.push(entry); result.failures++;
    }
    return entry;
  };
  const finalize = () => {
    const courseFailure = result.errors.some(e => e.courseId);
    const code = fatal ?? (courseFailure ? 'COURSE_PARTIAL_FAILURE' : result.notificationStatus === 'FAILED' ? 'DISCORD_NOTIFICATION_FAILED'
      : result.changes > 0 ? 'SUCCESS_WITH_CHANGES' : 'SUCCESS');
    Object.assign(result, runResult(code, result.errors, now(), !fatal && (courseFailure || result.notificationStatus === 'FAILED')));
  };
  log('RUN_START', { runId });
  try {
    store.db.prepare('INSERT INTO monitor_runs VALUES (?,?,NULL,?,NULL)').run(runId, now().toISOString(), 'RUNNING');
    phase = 'AUTHENTICATION';
    checkCancelled();
    if (options.authenticate) { log('AUTO_LOGIN'); await options.authenticate(); }
    if (options.authenticate) { result.authentication = 'OK'; healthy.add(checkpoint('AUTHENTICATION')); log('AUTH_OK'); }
    phase = 'COURSE_LIST';
    const courses = await source.courses();
    result.authentication = 'OK';
    healthy.add(checkpoint('AUTHENTICATION')); healthy.add(checkpoint('COURSE_LIST'));
    if (!options.authenticate) log('AUTH_OK');
    result.courses = courses.length;
    log('COURSES', { count: courses.length });
    const scopes: ScopeSnapshot[] = [];
    let excludedOnlineRows = 0;
    for (const course of courses) {
      checkCancelled();
      const beforeFailures = result.failures;
      phase = 'COURSE';
      try { await source.enter(course); }
      catch (error) {
        if (isAuthError(error)) { result.failedCourses++; fail(classifyError(error), 'COURSE', course); throw error; }
        result.failedCourses++;
        log('COURSE_FAILED', { issue: fail(classifyError(error), 'COURSE', course) });
        continue;
      }
      healthy.add(checkpoint('COURSE', courseKey(course)));
      for (const type of ['NOTICE', 'MATERIAL', 'ASSIGNMENT', 'VIDEO'] as const) {
        checkCancelled();
        const scope: Scope = type === 'VIDEO' ? 'ONLINE_LECTURE' : type;
        phase = scope;
        try {
          const data = await source.collect(course, type);
          excludedOnlineRows += data.unidentifiedOnlineRows ?? 0;
          log(data.status === 'OK' ? 'SCOPE_OK' : 'SCOPE_UNAVAILABLE', {
            course: courseKey(course), type, count: data.items.length, excluded: data.unidentifiedOnlineRows ?? 0,
          });
          if (data.status === 'OK') {
            scopes.push({ course, type, items: data.items });
            const counter = { NOTICE: 'notices', MATERIAL: 'materials', ASSIGNMENT: 'assignments', VIDEO: 'videos' } as const;
            result[counter[type]] += data.items.length;
          }
          successfulScopes++;
          healthy.add(checkpoint(scope, courseKey(course)));
        } catch (error) {
          if (isAuthError(error)) { result.failedCourses++; fail(classifyError(error), scope, course); throw error; }
          log('SCOPE_FAILED', { issue: fail(classifyError(error), scope, course) });
        }
      }
      if (result.failures === beforeFailures) result.completedCourses++; else result.failedCourses++;
    }
    result.collectionStatus = result.failedCourses ? (successfulScopes ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
    if (result.collectionStatus === 'FAILED') { fatal = result.errors[0]?.errorCode ?? 'UNKNOWN_ERROR'; }
    phase = 'DATABASE';
    checkCancelled();
    const synced = store.sync(courses, scopes, now().toISOString());
    result.changes = synced.events.length;
    for (const key of ['baseline', 'newItems', 'updated', 'unchanged'] as const) result[key] = synced[key];
    result.databaseStatus = 'SUCCESS'; healthy.add(checkpoint('DATABASE'));
    log('SYNC', { baseline: result.baseline, newItems: result.newItems, updated: result.updated, unchanged: result.unchanged });
    // No stale completion state, failed scope or first baseline may produce reminders.
    const baselines = new Set(synced.baselineScopes);
    const fresh = scopes.filter(s => !baselines.has(`${courseKey(s.course)}:${s.type}`)).flatMap(s => s.items);
    phase = 'DISCORD';
    if (options.notificationAvailable === false) {
      result.initialSummary = { status: 'SKIPPED', reason: 'DISCORD_NOT_CONFIGURED', delivery: null };
      log('INITIAL_SUMMARY', { status: 'SKIPPED', reason: 'DISCORD_NOT_CONFIGURED' });
      throw new AppError('DISCORD_NOTIFICATION_FAILED');
    }
    if (result.loginMode === 'AUTO' && !result.failures) {
      result.initialSummary = await notifyInitialSummary(store,
        buildInitialSetupSummary(courses, scopes.flatMap(s => s.items), now(), excludedOnlineRows), transport, log, now());
      if (result.initialSummary.status === 'SENT') await delay(options.deliveryDelayMs ?? 1_100);
    } else {
      result.initialSummary = { status: 'SKIPPED', reason: result.failures ? 'INCOMPLETE_SYNC' : 'NOT_AUTO_LOGIN', delivery: null };
      log('INITIAL_SUMMARY', { status: result.initialSummary.status, reason: result.initialSummary.reason! });
    }
    const summaryDeferred = result.initialSummary.delivery === 'RETRY' || result.initialSummary.delivery === 'DEFERRED';
    const changed = summaryDeferred ? { sent: 0, deferred: 0, uncertain: 0 }
      : await notifyChanges(store, transport, options.deliveryDelayMs, new Set(courses.map(courseKey)));
    const deadlines = summaryDeferred || changed.deferred || changed.uncertain ? { sent: 0, deferred: 0, uncertain: 0 }
      : await notifyDeadlines(store, deadlineReminders(fresh, now()), transport, options.deliveryDelayMs, options.deadlineNotifications);
    result.sent = Number(result.initialSummary.status === 'SENT') + changed.sent + deadlines.sent;
    result.deferred = Number(summaryDeferred) + changed.deferred + deadlines.deferred;
    result.uncertain = Number(store.db.prepare("SELECT count(*) n FROM notification_history WHERE status IN ('UNKNOWN','SENDING')").get()?.n);
    result.notificationStatus = result.deferred || result.uncertain ? 'FAILED' : 'SUCCESS';
    if (result.notificationStatus === 'FAILED') fail('DISCORD_NOTIFICATION_FAILED', 'DISCORD');
    else healthy.add(checkpoint('DISCORD'));
    log('NOTIFICATIONS', { sent: result.sent, deferred: result.deferred, uncertain: result.uncertain });
  } catch (error) {
    const code = phase === 'DATABASE' ? 'DATABASE_ERROR' : classifyError(error);
    if (phase === 'DISCORD' && code !== 'DATABASE_ERROR') {
      result.notificationStatus = 'FAILED';
      log('RUN_FAILED', { phase, issue: fail('DISCORD_NOTIFICATION_FAILED', 'DISCORD') });
    } else {
      fatal = code;
      if (code === 'DATABASE_ERROR') result.databaseStatus = 'FAILED';
      else if (phase !== 'DISCORD' && phase !== 'AUTHENTICATION') result.collectionStatus = 'FAILED';
      const recorded = isAuthError(error) ? result.errors.find(e => e.errorCode === code) : undefined;
      log('RUN_FAILED', { phase, issue: recorded ?? fail(code, code === 'DATABASE_ERROR' ? 'DATABASE' : phase) });
    }
  } finally {
    try { await options.dispose?.(); result.browserClosed = true; healthy.add(checkpoint('CLEANUP')); log('BROWSER_CLOSED'); }
    catch { fatal ??= 'UNKNOWN_ERROR'; fail('UNKNOWN_ERROR', 'CLEANUP'); }
    try {
      const alerts = await reportIncidents(store, result.errors, healthy, transport, log, now(), !options.signal?.aborted && options.notificationAvailable !== false && !result.deferred && !result.uncertain && result.notificationStatus !== 'FAILED');
      result.sent += alerts.sent; result.deferred += alerts.deferred; result.uncertain += alerts.uncertain;
      if (alerts.sent && result.notificationStatus === 'NOT_RUN') result.notificationStatus = 'SUCCESS';
      if (result.deferred || result.uncertain) { result.notificationStatus = 'FAILED'; fail('DISCORD_NOTIFICATION_FAILED', 'DISCORD'); }
    } catch { fatal = 'DATABASE_ERROR'; result.databaseStatus = 'FAILED'; fail('DATABASE_ERROR', 'DATABASE'); }
    finalize();
    try {
      store.db.prepare('UPDATE monitor_runs SET finished_at=?,status=?,summary_json=? WHERE run_id=?')
        .run(now().toISOString(), result.status, JSON.stringify(result), runId);
    } catch { fatal = 'DATABASE_ERROR'; result.databaseStatus = 'FAILED'; fail('DATABASE_ERROR', 'DATABASE'); finalize(); }
    log('RESULT', { result });
    log('RUN_FINISH', { result, runId });
  }
  return result;
}
