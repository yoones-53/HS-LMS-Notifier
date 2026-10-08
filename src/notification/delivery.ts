import type { LmsStore } from '../database/store.js';
import type { DiscordPayload, Transport } from './discord.js';

export type SendStatus = 'SENT' | 'SKIPPED' | 'DEFERRED' | 'RETRY' | 'UNKNOWN';
export async function sendOnce(store: LmsStore, key: string, payload: DiscordPayload, transport: Transport, now = new Date()): Promise<SendStatus> {
  const time = now.toISOString();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const previous = store.db.prepare('SELECT status,retry_after FROM notification_history WHERE notification_key=?').get(key);
    let skipped: SendStatus | undefined;
    if (previous?.status === 'SENT') skipped = 'SKIPPED';
    else if (previous && previous.status !== 'RETRY') skipped = 'UNKNOWN';
    else if (previous?.retry_after && Date.parse(String(previous.retry_after)) > now.getTime()) skipped = 'DEFERRED';
    if (skipped) { store.db.exec('COMMIT'); return skipped; }
    store.db.prepare(`INSERT INTO notification_history (notification_key,status,payload_json,created_at,updated_at,attempts)
      VALUES (?,'SENDING',?,?,?,1) ON CONFLICT(notification_key) DO UPDATE SET
      status='SENDING',payload_json=excluded.payload_json,updated_at=excluded.updated_at,attempts=notification_history.attempts+1,retry_after=NULL`)
      .run(key, JSON.stringify(payload), time, time);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  const result = await transport(payload).catch(() => ({ status: 'UNKNOWN' as const }));
  const finished = new Date().toISOString();
  const retryAt = result.status === 'RETRY'
    ? new Date(now.getTime() + Math.min(Math.max(result.retryAfterSeconds, 1), 604_800) * 1_000).toISOString() : null;
  store.db.prepare('UPDATE notification_history SET status=?,updated_at=?,sent_at=?,retry_after=? WHERE notification_key=?')
    .run(result.status, finished, result.status === 'SENT' ? finished : null, retryAt, key);
  return result.status;
}
