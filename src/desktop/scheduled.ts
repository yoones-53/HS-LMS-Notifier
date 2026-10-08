import { migrateRuntime } from '../runtime/migration.js';
import { acquireRuntimeLock, type RuntimePaths } from '../runtime/paths.js';
import { loadSettings } from '../runtime/settings.js';
import { cleanOldLogs } from '../runtime/retention.js';
import { runMonitorOnce } from '../runtime/run-once.js';
import { loadDiscordSecret } from '../auth/credentials.js';

// Scheduler entry point: no window, tray or Electron single-instance lock. The
// database-backed runtime lock is shared with the GUI's manual check instead.
export async function runScheduledCheck(paths: RuntimePaths): Promise<number> {
  try {
    await migrateRuntime(paths, paths);
    const settings = loadSettings(paths);
    if (!settings.setupComplete || !settings.autoEnabled) return 0;
    const release = acquireRuntimeLock(paths, paths);
    if (!release) return 0;
    try {
      cleanOldLogs(paths.logs, settings.retentionDays);
      await runMonitorOnce(paths, { headless: true, loadWebhook: () => loadDiscordSecret() });
      cleanOldLogs(paths.logs, settings.retentionDays);
      return 0;
    } finally { release(); }
  } catch { return 1; }
}
