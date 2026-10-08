import { setTimeout as delay } from 'node:timers/promises';
import type { LmsStore } from '../database/store.js';
import type { ChangeEvent } from '../detector/changes.js';
import { courseKey } from '../model.js';
import type { Transport } from './discord.js';
import { sendOnce } from './delivery.js';
import { changePayload } from './format.js';

export async function notifyChanges(store: LmsStore, transport: Transport, delayMs = 1_100, activeCourses?: Set<string>): Promise<{ sent: number; deferred: number; uncertain: number }> {
  const pending = store.db.prepare(`SELECT e.payload_json FROM change_events e
    LEFT JOIN notification_history n ON n.notification_key='change:' || e.event_key
    WHERE n.notification_key IS NULL OR n.status='RETRY' ORDER BY e.created_at,e.event_key`).all();
  const result = { sent: 0, deferred: 0, uncertain: 0 };
  for (const row of pending) {
    const event = JSON.parse(String(row.payload_json)) as ChangeEvent;
    if (activeCourses && !activeCourses.has(courseKey(event.item))) continue;
    if (result.sent >= 20) break;
    const name = store.db.prepare('SELECT name FROM courses WHERE course_key=?').get(courseKey(event.item))?.name;
    const status = await sendOnce(store, `change:${event.key}`, changePayload(event, String(name ?? '과목 확인 필요')), transport);
    if (status === 'SENT') result.sent++;
    if (status === 'RETRY' || status === 'DEFERRED') { result.deferred++; break; }
    if (status === 'UNKNOWN') { result.uncertain++; break; }
    await delay(delayMs);
  }
  return result;
}
