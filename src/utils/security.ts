import { AppError } from './result.js';

// Node child_process debugging can dump inherited env; Playwright debugging can
// dump fill arguments. Reject diagnostics before loading secrets or spawning.
export function assertSafeDiagnostics(env: NodeJS.ProcessEnv = process.env): void {
  const blocked = new Set(['DEBUG', 'PWDEBUG', 'DEBUG_FILE', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE']);
  if (Object.entries(env).some(([key, value]) => blocked.has(key.toUpperCase()) && !!value)) {
    throw new AppError('INITIALIZATION_ERROR');
  }
}
