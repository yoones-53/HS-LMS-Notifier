import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from '../src/utils/config.js';
const execute = promisify(execFile);

test('real scheduler wrapper works under spaces, brackets, ampersand and quote without command evaluation',
  { skip: process.platform !== 'win32', timeout: 25_000 }, async () => {
    const work = join(PROJECT_ROOT, 'work'); mkdirSync(work, { recursive: true });
    const directory = mkdtempSync(join(work, "scheduler path & [safe] 'quoted'-"));
    mkdirSync(join(directory, 'scripts')); mkdirSync(join(directory, 'src'));
    try {
      for (const file of ['run-monitor.ps1', 'task-result.ps1']) copyFileSync(join(PROJECT_ROOT, 'scripts', file), join(directory, 'scripts', file));
      copyFileSync(join(PROJECT_ROOT, 'tests/fixtures/scheduler-main.ts'), join(directory, 'src/main.ts'));
      const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const { stdout, stderr } = await execute(ps,
        ['-NoProfile', '-NonInteractive', '-File', join(directory, 'scripts/run-monitor.ps1'), '-NodePath', process.execPath],
        { windowsHide: true, timeout: 20_000 });
      assert.equal(stdout.trim(), ''); assert.equal(stderr.trim(), '');
      const envelope = JSON.parse(readFileSync(join(directory, 'logs/latest-scheduler-run.json'), 'utf8'));
      assert.equal(envelope.result.status, 'SUCCESS');
      const dated = readdirSync(join(directory, 'logs')).find(name => /^scheduler-\d{4}-\d{2}-\d{2}\.log$/.test(name));
      assert.ok(dated);
      const lines = readFileSync(join(directory, 'logs', dated), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]!).invocationId, envelope.invocationId);
    } finally {
      assert.ok(resolve(directory).startsWith(resolve(work) + sep));
      rmSync(directory, { recursive: true, force: true });
    }
  });
