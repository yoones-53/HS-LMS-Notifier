import { runCli, UserFacingError } from './utils/cli.js';
import { loadEnvironment } from './utils/environment.js';
import { readHeadless } from './utils/options.js';
import { formatMonitor } from './status/presentation.js';
import { loadDiscordSecret } from './auth/credentials.js';
import { resolveRuntimePaths } from './runtime/paths.js';
import { runMonitorOnce } from './runtime/run-once.js';

await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run check: 매 실행 자동 로그인 후 전체 수집·동기화·알림을 수행합니다.');
    console.log('npm run credentials:setup / credentials:test / credentials:status / credentials:remove');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new UserFacingError('사용법: npm run check');
  const result = await runMonitorOnce(resolveRuntimePaths(), { headless: readHeadless(), loadWebhook: () => loadDiscordSecret(process.env.DISCORD_WEBHOOK_URL) });
  console.log(formatMonitor(result)); process.exitCode = result.exitCode;
}, { monitor: true });
