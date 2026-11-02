import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertSafeDiagnostics } from '../src/utils/security.js';
import { AppError } from '../src/utils/result.js';
import { LmsStore } from '../src/database/store.js';
import { credentialBridge } from '../src/auth/credentials.js';
import { openFreshSession } from '../src/browser/fresh.js';
import { openProfile } from '../src/browser/profile.js';

test('sensitive debug modes fail closed with fixed errors, including Windows casing', () => {
  assert.doesNotThrow(() => assertSafeDiagnostics({ DEBUG: '', HEADLESS: 'true' }));
  for (const key of ['DEBUG', 'PWDEBUG', 'DEBUG_FILE', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'node_debug']) {
    assert.throws(() => assertSafeDiagnostics({ [key]: 'SYNTHETIC_SENTINEL' }),
      e => e instanceof AppError && e.message === 'INITIALIZATION_ERROR');
  }
});

test('debug guard runs before any credential child process or browser/profile creation', async () => {
  const previous = process.env.NODE_DEBUG;
  process.env.NODE_DEBUG = 'child_process';
  try {
    for (const action of [() => credentialBridge('Status'), () => openFreshSession(true), () => openProfile('unused-debug-guard')]) {
      await assert.rejects(action, e => e instanceof AppError && e.message === 'INITIALIZATION_ERROR');
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_DEBUG; else process.env.NODE_DEBUG = previous;
  }
});

function temporaryDatabase(action: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hs-audit-'));
  try { action(join(directory, 'database.sqlite')); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('failed schema initialization rolls back all DDL and releases the database handle', () => {
  temporaryDatabase(path => {
    const original = new DatabaseSync(path);
    original.exec('CREATE VIEW notification_history AS SELECT 1 AS existing_data; PRAGMA user_version=2');
    original.close();
    assert.throws(() => new LmsStore(path)); // ALTER TABLE cannot alter a view.
    const recovered = new DatabaseSync(path);
    try {
      assert.equal(recovered.prepare('PRAGMA user_version').get()?.user_version, 2);
      assert.equal(recovered.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n, 0);
      assert.equal(recovered.prepare('SELECT * FROM notification_history').get()?.existing_data, 1);
      recovered.exec('BEGIN EXCLUSIVE; ROLLBACK');
    } finally { recovered.close(); }
  });
});

test('v2 additive migration preserves notification history and unsupported versions are untouched', () => {
  temporaryDatabase(path => {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE notification_history (notification_key TEXT PRIMARY KEY, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0) STRICT;
      INSERT INTO notification_history VALUES ('synthetic-summary','SENT','{}','test','test','test',1);
      PRAGMA user_version=2`);
    legacy.close();
    const store = new LmsStore(path);
    try {
      assert.equal(store.notificationCount(), 1);
      assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 4);
      assert.equal(store.db.prepare('SELECT retry_after FROM notification_history').get()?.retry_after, null);
      assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      store.db.exec('PRAGMA user_version=99');
    } finally { store.close(); }
    assert.throws(() => new LmsStore(path), /UNSUPPORTED_DB_VERSION/);
    const unchanged = new DatabaseSync(path);
    try { assert.equal(unchanged.prepare('PRAGMA user_version').get()?.user_version, 99); }
    finally { unchanged.close(); }
  });
});
