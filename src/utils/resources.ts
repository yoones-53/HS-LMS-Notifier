import { join } from 'node:path';
import { PROJECT_ROOT } from './config.js';

interface ElectronProcessResources {
  defaultApp?: boolean;
  resourcesPath?: string;
}

export function packagedResourcesRoot(current: ElectronProcessResources = process): string | undefined {
  return current.resourcesPath && !current.defaultApp ? current.resourcesPath : undefined;
}

export function runtimeScriptPath(...segments: string[]): string {
  const resources = packagedResourcesRoot();
  return resources
    ? join(resources, 'runtime-scripts', ...segments)
    : join(PROJECT_ROOT, 'scripts', ...segments);
}
