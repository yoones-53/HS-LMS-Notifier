import { openFreshSession, type FreshSession } from '../browser/fresh.js';
import { browserSource } from '../crawler/source.js';
import type { LmsSource } from '../monitor.js';
import { autoLogin } from './auto-login.js';
import { loadCredentials } from './credentials.js';
import { AppError } from '../utils/result.js';

export function freshSource(headless: boolean, signal?: AbortSignal): { source: LmsSource; authenticate(): Promise<void>; dispose(): Promise<void> } {
  let session: FreshSession | undefined;
  const cancel = () => { void session?.close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const current = () => { if (!session) throw new AppError('UNKNOWN_ERROR'); return browserSource(session.page); };
  return {
    source: { courses: () => current().courses(), enter: c => current().enter(c), collect: (c, t) => current().collect(c, t) },
    authenticate: async () => {
      try { session = await openFreshSession(headless); } catch { throw new AppError('INITIALIZATION_ERROR'); }
      if (signal?.aborted) { await session.close(); throw new AppError('UNKNOWN_ERROR'); }
      await autoLogin(session.page, loadCredentials);
    },
    dispose: async () => { signal?.removeEventListener('abort', cancel); await session?.close(); session = undefined; },
  };
}
