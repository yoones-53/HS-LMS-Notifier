import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { acquireRunLock } from '../src/utils/run-lock.js';
import { readHeadless } from '../src/utils/options.js';

test('concurrent processes cannot acquire the run lock; process exit releases it automatically', { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hs-lock-test-'));
  const path = join(directory, 'process-lock.sqlite');
  const child = fork(new URL('./fixtures/lock-holder.ts', import.meta.url), [path], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await once(child, 'message');
    assert.equal(acquireRunLock(path), null);
    const exited = once(child, 'exit'); child.kill(); await exited;
    const release = acquireRunLock(path); assert.ok(release); release(); release();
    const again = acquireRunLock(path); assert.ok(again); again();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('headless defaults true and rejects ambiguous settings', () => {
  assert.equal(readHeadless(''), true); assert.equal(readHeadless('TRUE'), true);
  assert.equal(readHeadless('false'), false); assert.throws(() => readHeadless('yes'));
});
