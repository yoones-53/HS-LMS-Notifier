import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
const child = spawn(electron, ['dist/gui/main.mjs', ...(process.argv.includes('--dev') ? ['--dev'] : [])],
  { stdio: 'ignore', windowsHide: false }); // Explicitly requested visible interactive GUI.
child.on('error', () => { console.error('GUI를 실행할 수 없습니다. npm run gui:install을 확인하세요.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
