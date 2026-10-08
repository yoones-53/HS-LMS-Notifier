import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { runtimeScriptPath } from '../utils/resources.js';
import { parseJson } from '../runtime/json.js';
import type { SchedulerStatus } from './contracts.js';
const execute = promisify(execFile);
const schema = z.object({ state: z.enum(['ACTIVE','INACTIVE','ABSENT','UNKNOWN']), nextAt: z.iso.datetime({ offset: true }).nullable(),
  mode: z.enum(['PRODUCTION','LEGACY','DUPLICATE','STALE','CONFLICT','ABSENT','UNKNOWN']), legacyDetected: z.boolean(), legacyActive: z.boolean(), targetCurrent: z.boolean() }).strict();
const unknown = (): SchedulerStatus => ({ state: 'UNKNOWN', nextAt: null, mode: 'UNKNOWN', legacyDetected: false, legacyActive: false, targetCurrent: false });
const powershell = () => `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
async function call(action: 'Status' | 'Ensure' | 'Disable' | 'MigrateLegacy', executablePath?: string): Promise<SchedulerStatus> {
  try {
    const args = ['-NoProfile','-NonInteractive','-File', runtimeScriptPath('windows','production-scheduler.ps1'), '-Action', action];
    if (executablePath) args.push('-ExecutablePath', executablePath);
    const { stdout } = await execute(powershell(), args,
      { windowsHide: true, timeout: 8000, maxBuffer: 16_384 });
    return parseJson(stdout.trim(), schema);
  } catch { return unknown(); }
}
export const inspectScheduler = () => call('Status');
export const updateScheduler = (action: 'Ensure' | 'Disable' | 'MigrateLegacy', executablePath?: string) => call(action, executablePath);
