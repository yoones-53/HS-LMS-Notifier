import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { packagedResourcesRoot } from '../utils/resources.js';
import { AppError } from '../utils/result.js';

const browserManifest = z.object({
  version: z.literal(1),
  executable: z.string().min(1).max(512),
}).strict();

export function resolveBundledChromium(resourcesRoot: string): string {
  try {
    const browserRoot = resolve(resourcesRoot, 'playwright');
    const parsed = browserManifest.parse(JSON.parse(readFileSync(resolve(browserRoot, 'browser-manifest.json'), 'utf8')));
    if (isAbsolute(parsed.executable)) throw new Error('ABSOLUTE_BROWSER_PATH');
    const executable = resolve(browserRoot, parsed.executable);
    const within = relative(browserRoot, executable);
    if (!within || within.startsWith('..') || isAbsolute(within) || !existsSync(executable)) throw new Error('INVALID_BROWSER_PATH');
    return executable;
  } catch {
    throw new AppError('INITIALIZATION_ERROR');
  }
}

export function packagedChromiumExecutable(): string | undefined {
  const resources = packagedResourcesRoot();
  return resources ? resolveBundledChromium(resources) : undefined;
}
