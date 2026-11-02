import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { credentialBridge, decodeCredentials, readCredentials } from '../src/auth/credentials.js';
import { AppError } from '../src/utils/result.js';

test('credential IPC missing/malformed values give fixed errors and erase the byte buffer', () => {
  const missing = Buffer.from('null');
  assert.throws(() => decodeCredentials(missing), e => e instanceof AppError && e.status === 'CREDENTIALS_NOT_CONFIGURED');
  assert.ok(missing.every(b => b === 0));
  const malformed = Buffer.from('SYNTHETIC_SECRET_SENTINEL');
  assert.throws(() => decodeCredentials(malformed), e => e instanceof AppError && e.message === 'UNKNOWN_ERROR');
  assert.ok(malformed.every(b => b === 0));
});
test('Windows Credential Manager round trip uses only an isolated synthetic target', { skip: process.platform !== 'win32', timeout: 40_000 }, async () => {
  const target = `HS-LMS-Notifier:test:${randomUUID()}`;
  const output = async (action: Parameters<typeof credentialBridge>[0]) => {
    const buffer = await credentialBridge(action, target);
    try { return buffer.toString('utf8').trim(); } finally { buffer.fill(0); }
  };
  try {
    assert.equal(await output('Status'), 'NOT_CONFIGURED');
    assert.equal(await output('TestWrite'), 'TEST_SAVED');
    assert.equal(await output('Status'), 'CONFIGURED');
    const credentials = await readCredentials(target);
    // Never use assertion diffs that could serialize a real credential object.
    assert.ok(credentials.id === 'synthetic-user');
    assert.ok(credentials.password === 'synthetic-not-an-lms-password');
    credentials.id = ''; credentials.password = '';
  } finally { (await credentialBridge('Remove', target)).fill(0); }
  assert.equal(await output('Status'), 'NOT_CONFIGURED');
});
