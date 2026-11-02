import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(action: string, conflict = false) {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-File',resolve('tests/fixtures/production-scheduler.ps1'),
    '-ScriptPath',resolve('scripts/windows/production-scheduler.ps1'),'-Action',action,...(conflict?['-Conflict']:[])], {encoding:'utf8',windowsHide:true}));
}
test('production helper preserves the existing active trigger on Ensure', {skip:process.platform!=='win32'},()=>{
  const value=run('Ensure');assert.equal(value.result.mode,'PRODUCTION');assert.deepEqual(value.calls,[]);
});
test('production helper disables both owned schedules and clears next time', {skip:process.platform!=='win32'},()=>{
  const value=run('Disable');assert.equal(value.result.state,'INACTIVE');assert.equal(value.result.nextAt,null);assert.equal(value.result.legacyActive,false);
  assert.deepEqual(value.calls,['Disable:HS-LMS-Notifier Background','Disable:HS-LMS-Notifier']);
});
test('production helper preserves a conflicting task', {skip:process.platform!=='win32'},()=>{
  const value=run('Ensure',true);assert.equal(value.result.mode,'CONFLICT');assert.deepEqual(value.calls,[]);
});
