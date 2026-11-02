import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import { runtimeScriptPath } from '../utils/resources.js';
import { assertSafeDiagnostics } from '../utils/security.js';
import { parseJson, DataFileError } from './json.js';
import { desktopRoot, isAllowedDesktopRoot } from './paths.js';

/** GetFinalPathNameByHandle sees MSIX redirection; Node realpath does not. */
export function physicalDesktopRoot(): string {
  assertSafeDiagnostics();
  try {
    const output = execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-File',runtimeScriptPath('windows', 'runtime-root.ps1')],
      { windowsHide:true, encoding:'utf8', timeout:10_000, maxBuffer:16_384, stdio:['ignore','pipe','ignore'] });
    const {root}=parseJson(output.trim(),z.object({root:z.string().min(1)}).strict());
    if (!isAllowedDesktopRoot(root,desktopRoot())) throw new DataFileError();
    return root;
  } catch { throw new DataFileError(); }
}
