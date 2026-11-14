import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';

export class DataFileError extends Error { constructor() { super('DATA_FILE_INVALID'); } }
export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  if (text.length > 5_000_000) throw new DataFileError();
  try { return schema.parse(JSON.parse(text)); } catch { throw new DataFileError(); }
}
export function readJson<T>(path: string, schema: z.ZodType<T>): T {
  try {
    if (statSync(path).size > 5_000_000) throw new DataFileError();
    return parseJson(readFileSync(path, 'utf8'), schema);
  } catch { throw new DataFileError(); }
}
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
