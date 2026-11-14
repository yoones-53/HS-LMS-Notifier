import { UserFacingError } from '../utils/cli.js';
import { assertSafeDiagnostics } from '../utils/security.js';

export interface DiscordPayload {
  embeds: Array<{ title: string; description: string; fields?: Array<{ name: string; value: string; inline?: boolean }>; footer?: { text: string } }>;
  allowed_mentions: { parse: string[] };
}
export type Delivery = { status: 'SENT' | 'UNKNOWN' } | { status: 'RETRY'; retryAfterSeconds: number };
export type Transport = (payload: DiscordPayload) => Promise<Delivery>;

export function validateWebhook(value: string | undefined): URL {
  try {
    const url = new URL(value?.trim() ?? '');
    if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error();
    return url;
  } catch { throw new UserFacingError('DISCORD_CONFIG_INVALID: .env의 DISCORD_WEBHOOK_URL 설정을 확인해 주세요. 값은 출력하지 않습니다.'); }
}

export function discordTransport(value: string | undefined, request: typeof fetch = fetch): Transport {
  assertSafeDiagnostics();
  const url = validateWebhook(value);
  url.searchParams.set('wait', 'true');
  return async payload => {
    assertSafeDiagnostics();
    try {
      const response = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) {
        const body = await response.json().catch(() => null) as { retry_after?: unknown } | null;
        const seconds = Number(body?.retry_after ?? response.headers.get('retry-after'));
        return { status: 'RETRY', retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 1_800 };
      }
      if (response.ok) {
        const body = await response.json().catch(() => null) as { id?: unknown } | null;
        return { status: typeof body?.id === 'string' && /^\d+$/.test(body.id) ? 'SENT' : 'UNKNOWN' };
      }
      await response.body?.cancel();
      // A rejected 4xx was not delivered. A server failure/timeout may already have delivered.
      return response.status >= 400 && response.status < 500 ? { status: 'RETRY', retryAfterSeconds: 1_800 } : { status: 'UNKNOWN' };
    } catch { return { status: 'UNKNOWN' }; } // Never propagate errors containing the secret URL.
  };
}
