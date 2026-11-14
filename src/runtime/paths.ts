import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { PROJECT_ROOT } from '../utils/config.js';
import { acquireRunLock } from '../utils/run-lock.js';
import { DataFileError, readJson } from './json.js';
import { migrationSchema } from './migration-schema.js';

export interface RuntimePaths {
  root: string; database: string; logs: string; state: string; profile: string; lock: string;
}
export function runtimePaths(root: string, legacy = false): RuntimePaths {
  if (!isAbsolute(root)) throw new DataFileError();
  const absolute = resolve(root);
  return { root: absolute, database: join(absolute, 'data/lms.sqlite'), logs: join(absolute, 'logs'),
    state: join(absolute, 'state'), profile: join(absolute, legacy ? 'browser-data/hs-lms' : 'browser/hs-lms'),
    lock: join(absolute, 'data/process-lock.sqlite') };
}
export const cliPaths = (): RuntimePaths => runtimePaths(PROJECT_ROOT, true);
export const desktopRoot = (): string => join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'HS-LMS-Notifier');
export const routeSchema = z.object({ version: z.literal(1), root: z.string().min(1), migrationId: z.uuid() }).strict();
export const routePath = (legacy: RuntimePaths): string => join(legacy.root, 'data/runtime-location.json');
export function isAllowedDesktopRoot(root: string, allowedRoot = desktopRoot(), local = process.env.LOCALAPPDATA): boolean {
  if (!isAbsolute(root)) return false;
  if (resolve(root).toLowerCase() === resolve(allowedRoot).toLowerCase()) return true;
  if (!local) return false;
  // Store/MSIX-hosted development can virtualize Roaming AppData. Allow only the
  // fixed app directory within this Windows user's package cache, never arbitrary paths.
  const within=relative(join(local,'Packages'),resolve(root)).replaceAll('\\','/');
  return /^[A-Za-z0-9._-]+\/LocalCache\/Roaming\/HS-LMS-Notifier$/i.test(within);
}
export function resolveRuntimePaths(legacy = cliPaths(), allowedRoot = desktopRoot()): RuntimePaths {
  if (!existsSync(routePath(legacy))) return legacy;
  const route = readJson(routePath(legacy), routeSchema);
  if (!isAllowedDesktopRoot(route.root, allowedRoot)) throw new DataFileError();
  const paths = runtimePaths(route.root);
  // A lost migrated DB must never silently become a fresh baseline.
  if (!existsSync(paths.database)) throw new DataFileError();
  const migration = readJson(join(paths.state, 'migration.json'), migrationSchema);
  if (migration.id !== route.migrationId || migration.sourceKey !== createHash('sha256').update(resolve(legacy.root).toLowerCase()).digest('hex')) throw new DataFileError();
  return paths;
}
export function acquireRuntimeLock(paths: RuntimePaths, legacy = cliPaths()): (() => void) | null {
  // Fixed order in GUI, CLI and migration. Keep the old lock compatible with old
  // scheduled processes; use the userData lock as well across installations.
  const releases: Array<() => void> = [];
  try {
    for (const path of [...new Set([legacy.lock, paths.lock])]) {
      const release = acquireRunLock(path);
      if (!release) { for (const unlock of releases.reverse()) unlock(); return null; }
      releases.push(release);
    }
    return () => { for (const unlock of releases.reverse()) unlock(); };
  } catch (error) { for (const unlock of releases.reverse()) unlock(); throw error; }
}
