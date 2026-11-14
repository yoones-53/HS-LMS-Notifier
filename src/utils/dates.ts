/** Parse a local LMS timestamp explicitly as Asia/Seoul (UTC+09:00). */
export function parseSeoulDateTime(raw: string | null, referenceYear: number): string | null {
  if (!raw) return null;
  const m = /^(\d{2}|\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  let year = Number(m[1]);
  if (m[1]?.length === 2) {
    if (!Number.isInteger(referenceYear) || referenceYear < 2000 || referenceYear > 2099) return null;
    const candidates = [referenceYear - 1, referenceYear, referenceYear + 1].filter(y => y % 100 === year);
    if (candidates.length !== 1) return null;
    year = candidates[0]!;
  }
  const month = Number(m[2]), day = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6] ?? 0);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day) return null;
  return `${civil.toISOString().slice(0, 19)}+09:00`;
}

export function parseSeoulPeriod(raw: string | null, referenceYear: number): {
  startsAt: string | null; dueAt: string | null; dateStatus: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'INVALID_RANGE';
} {
  const parts = raw?.split('~').map(s => s.trim());
  if (parts?.length !== 2) return { startsAt: null, dueAt: null, dateStatus: 'UNKNOWN' };
  const startsAt = parseSeoulDateTime(parts[0] ?? null, referenceYear);
  const dueAt = parseSeoulDateTime(parts[1] ?? null, referenceYear);
  if (startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt)) return { startsAt, dueAt: null, dateStatus: 'INVALID_RANGE' };
  return { startsAt, dueAt, dateStatus: startsAt && dueAt ? 'COMPLETE' : startsAt || dueAt ? 'PARTIAL' : 'UNKNOWN' };
}
