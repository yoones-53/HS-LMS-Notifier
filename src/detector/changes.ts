import { itemKey, type ItemChange, type LmsItem } from '../model.js';

export type ChangeType = 'NEW_NOTICE' | 'NEW_MATERIAL' | 'NEW_ASSIGNMENT' | 'NEW_VIDEO'
  | 'ASSIGNMENT_UPDATED' | 'DEADLINE_CHANGED' | 'VIDEO_COMPLETED';
export interface ChangeEvent {
  key: string; type: ChangeType; item: LmsItem; version: number; detectedAt: string;
  previousDueAt: string | null;
  courseContentChanged?: boolean;
}

/** Pure comparison: no Playwright, database calls, network or wall-clock access. */
export function detectChanges(change: ItemChange, detectedAt: string): ChangeEvent[] {
  const { before, after, version } = change;
  if (before && itemKey(before) !== itemKey(after)) throw new Error('ITEM_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('INVALID_ITEM_VERSION');
  const types: ChangeType[] = [];
  let courseContentChanged = false;
  if (!before) types.push(`NEW_${after.type}`);
  else {
    if (after.type === 'ASSIGNMENT' && before.type === 'ASSIGNMENT') {
      courseContentChanged = before.title !== after.title || before.startsAt !== after.startsAt;
      if (courseContentChanged || before.submitted !== after.submitted || before.submissionStatus !== after.submissionStatus)
        types.push('ASSIGNMENT_UPDATED');
    }
    if ((after.type === 'ASSIGNMENT' || after.type === 'VIDEO')
      && (before.type === 'ASSIGNMENT' || before.type === 'VIDEO')
      && after.dueAt !== null && before.dueAt !== after.dueAt) types.push('DEADLINE_CHANGED');
    // This means LMS attendance completion, never a guessed 100% viewing rate.
    if (after.type === 'VIDEO' && before.type === 'VIDEO'
      && before.attendanceConfirmed !== true && after.attendanceConfirmed === true) types.push('VIDEO_COMPLETED');
  }
  return types.map(type => ({ key: `${itemKey(after)}:v${version}:${type}`, type, item: after, version, detectedAt,
    ...(type === 'ASSIGNMENT_UPDATED' ? { courseContentChanged } : {}),
    previousDueAt: before && 'dueAt' in before ? before.dueAt : null }));
}
