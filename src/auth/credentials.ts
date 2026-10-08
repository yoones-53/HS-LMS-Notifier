import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from '../utils/result.js';
import { runtimeScriptPath } from '../utils/resources.js';
import { assertSafeDiagnostics } from '../utils/security.js';

export interface Credentials { id: string; password: string }
export type CredentialLoader = () => Promise<Credentials>;
export const CREDENTIAL_TARGET = 'HS-LMS-Notifier:LMS:v1';
export const DISCORD_TARGET = 'HS-LMS-Notifier:Discord:v1';
type Action = 'Read' | 'Status' | 'Remove' | 'Setup' | 'TestWrite' | 'Save';
export async function credentialBridge(action: Action, target = CREDENTIAL_TARGET, input?: Buffer): Promise<Buffer> {
  assertSafeDiagnostics();
  if (process.platform !== 'win32') throw new AppError('UNKNOWN_ERROR');
  if (![CREDENTIAL_TARGET, DISCORD_TARGET].includes(target) && !/^HS-LMS-Notifier:test:[a-f0-9-]{36}$/.test(target)) throw new AppError('UNKNOWN_ERROR');
  if ((action === 'Save') !== !!input || (input && input.length > 16_384)) throw new AppError('UNKNOWN_ERROR');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const interactive = action === 'Setup';
    const env = { ...process.env };
    // PowerShell 7's inherited PSModulePath can hide Windows PowerShell's Security module.
    // Let the fixed system powershell.exe construct its own standard module paths.
    for (const key of Object.keys(env)) {
      if (['PSMODULEPATH', 'DISCORD_WEBHOOK_URL'].includes(key.toUpperCase())) delete env[key];
    }
    const args = ['-NoLogo', '-NoProfile', ...(interactive ? [] : ['-NonInteractive']), '-File', runtimeScriptPath('windows', 'credential-store.ps1'), '-Action', action, '-Target', target];
    const child = spawn(executable, args, { windowsHide: !interactive, env,
      stdio: interactive ? 'inherit' : [input ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
    child.stdin?.on('error', () => {});
    if (input) child.stdin?.end(input);
    const chunks: Buffer[] = []; let size = 0;
    const timer = interactive ? undefined : setTimeout(() => child.kill(), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; if (size > 32_768) child.kill(); });
    const clear = () => { if (timer) clearTimeout(timer); for (const chunk of chunks) chunk.fill(0); };
    child.once('error', () => { clear(); reject(new AppError('UNKNOWN_ERROR')); });
    child.once('close', code => {
      if (code !== 0 || size > 32_768) { clear(); reject(new AppError('UNKNOWN_ERROR')); return; }
      const result = Buffer.concat(chunks); clear(); resolve(result);
    });
  });
}
export function decodeCredentials(buffer: Buffer): Credentials {
  try {
    const value: unknown = JSON.parse(buffer.toString('utf8'));
    if (value === null) throw new AppError('CREDENTIALS_NOT_CONFIGURED');
    if (typeof value !== 'object' || !('id' in value) || !('password' in value)
      || typeof value.id !== 'string' || !value.id || typeof value.password !== 'string' || !value.password) throw new AppError('UNKNOWN_ERROR');
    return { id: value.id, password: value.password };
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('UNKNOWN_ERROR'); }
  finally { buffer.fill(0); }
}
export async function readCredentials(target = CREDENTIAL_TARGET): Promise<Credentials> {
  const wire = await credentialBridge('Read', target);
  try { return decodeCredentials(Buffer.from(wire.toString('ascii'), 'base64')); }
  finally { wire.fill(0); }
}
export const loadCredentials: CredentialLoader = () => readCredentials();
export async function credentialsConfigured(target = CREDENTIAL_TARGET): Promise<boolean> {
  const buffer = await credentialBridge('Status', target);
  try {
    const status = buffer.toString('utf8').trim();
    if (status !== 'CONFIGURED' && status !== 'NOT_CONFIGURED') throw new AppError('UNKNOWN_ERROR');
    return status === 'CONFIGURED';
  } finally { buffer.fill(0); }
}
export async function saveCredentials(value: Credentials, target = CREDENTIAL_TARGET): Promise<void> {
  if (!value.id || value.id.length > 513 || !value.password || value.password.length > 1280
      || /[\x00-\x1f]/.test(value.id) || /\x00/.test(value.password)) throw new AppError('INITIALIZATION_ERROR');
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  const framed = Buffer.from(bytes.toString('base64'), 'ascii'); bytes.fill(0);
  try { (await credentialBridge('Save', target, framed)).fill(0); }
  finally { framed.fill(0); }
}
export async function loadDiscordSecret(fallback?: string): Promise<string | undefined> {
  if (!await credentialsConfigured(DISCORD_TARGET)) return fallback;
  const value = await readCredentials(DISCORD_TARGET);
  try { return value.password; } finally { value.id = ''; value.password = ''; }
}
