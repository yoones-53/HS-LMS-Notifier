import { credentialBridge, credentialsConfigured, loadCredentials } from '../src/auth/credentials.js';
import { autoLogin } from '../src/auth/auto-login.js';
import { openFreshSession } from '../src/browser/fresh.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
import { readHeadless } from '../src/utils/options.js';
import { printOutcome } from '../src/utils/result.js';

await runCli(async () => {
  const [action, ...rest] = process.argv.slice(2);
  if (rest.length) throw new UserFacingError('credentials 명령에는 ID나 비밀번호를 인자로 전달하지 마세요.');
  if (action === 'setup') { (await credentialBridge('Setup')).fill(0); return; }
  if (action === 'remove') { (await credentialBridge('Remove')).fill(0); console.log('로그인 정보 삭제 완료.'); return; }
  if (action === 'status') { console.log(await credentialsConfigured() ? 'CONFIGURED' : 'CREDENTIALS_NOT_CONFIGURED'); return; }
  if (action !== 'test') throw new UserFacingError('credentials:setup / credentials:test / credentials:status / credentials:remove를 사용하세요.');
  loadEnvironment();
  const session = await openFreshSession(readHeadless());
  try { await autoLogin(session.page, loadCredentials); }
  finally { await session.close(); }
  console.log('Authentication : OK\nLogin mode     : AUTO\nBrowser closed : true');
  console.log('크롤링·LMS DB 변경·Discord 전송 없이 로그인만 확인했습니다.');
  printOutcome('SUCCESS');
});
