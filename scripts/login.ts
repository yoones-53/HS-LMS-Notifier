import { runLogin } from '../src/auth/login.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';

await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run login: 전용 Chromium에서 직접 로그인 후 터미널 Enter');
    return;
  }
  if (args.length !== 0) {
    throw new UserFacingError('사용법: npm run login. 세션만 확인하려면 npm run login:check를 사용하세요.');
  }
  await runLogin();
});
