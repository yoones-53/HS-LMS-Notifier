import { freshSource } from '../auth/fresh-source.js';
import { LmsStore } from '../database/store.js';
import { runMonitor, type MonitorResult } from '../monitor.js';
import { discordTransport, type Transport } from '../notification/discord.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../utils/result.js';
import { publishResult } from '../status/output.js';
import type { RuntimePaths } from './paths.js';
import { loadSettings } from './settings.js';

/** Caller owns the shared execution lock (CLI runCli or desktop service). */
export async function runMonitorOnce(paths: RuntimePaths, options: {
  headless: boolean; loadWebhook: () => Promise<string | undefined>; signal?: AbortSignal;
}): Promise<MonitorResult> {
  const settings = loadSettings(paths);
  const log = createLogger(paths.logs, () => {});
  let notificationAvailable = true;
  let transport: Transport = async () => ({ status: 'RETRY', retryAfterSeconds: 1800 });
  try {
    const send = discordTransport(await options.loadWebhook());
    transport = payload => options.signal?.aborted ? Promise.resolve({ status: 'RETRY', retryAfterSeconds: 1800 }) : send(payload);
  } catch { notificationAvailable = false; }
  let store: LmsStore;
  try { store = new LmsStore(paths.database); } catch { throw new AppError('DATABASE_ERROR'); }
  const source = freshSource(options.headless, options.signal);
  try {
    const result = await runMonitor(store, source.source, transport, log, { authenticate: source.authenticate,
      dispose: source.dispose, notificationAvailable, deadlineNotifications: settings.deadlineNotifications,
      ...(options.signal ? { signal: options.signal } : {}) });
    publishResult(paths.logs, result);
    return result;
  } finally { try { await source.dispose(); } finally { store.close(); } }
}
