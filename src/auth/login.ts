import { createInterface } from 'node:readline';
import type { BrowserContext } from 'playwright';
import { closeProfile, openProfile } from '../browser/profile.js';
import { LMS_URL } from '../utils/config.js';
import { resolveRuntimePaths } from '../runtime/paths.js';
import { UserFacingError } from '../utils/cli.js';
import { checkSession } from './session.js';
import { monitorAuthDialogs } from './dialogs.js';

function waitForEnter(context: BrowserContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      context.off('close', onBrowserClosed);
      input.close();
      if (error) reject(error);
      else resolve();
    };
    const onBrowserClosed = () => finish(new UserFacingError('로그인 확인 전에 브라우저가 닫혔습니다. 다시 실행해 주세요.'));
    input.once('line', () => finish());
    input.once('close', () => {
      if (!settled) finish(new UserFacingError('입력이 종료되어 로그인 확인을 중단했습니다.'));
    });
    input.once('SIGINT', () => finish(new UserFacingError('로그인 작업을 취소했습니다.')));
    context.once('close', onBrowserClosed);
    console.log('브라우저에서 직접 로그인한 뒤 이 터미널에서 Enter를 눌러 주세요.');
    console.log('아이디와 비밀번호는 터미널에 입력하지 마세요.');
  });
}

export async function runLogin(checkOnly = false): Promise<void> {
  let context: BrowserContext | undefined;
  const onSignal = () => {
    process.exitCode = 130;
    if (context) void closeProfile(context).catch(() => undefined);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    context = await openProfile(resolveRuntimePaths().profile);
    const page = context.pages()[0] ?? await context.newPage();
    monitorAuthDialogs(page);
    if (!checkOnly) {
      await page.goto(LMS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      console.log('LMS 전용 Chromium 브라우저가 열렸습니다.');
      await waitForEnter(context);
    }

    if (await checkSession(page) !== 'authenticated') {
      throw new UserFacingError('로그인을 확인하지 못했습니다. 로그인 미완료·세션 만료·페이지 변경 가능성이 있습니다. npm run login으로 다시 확인해 주세요.');
    }
    await closeProfile(context);
    context = undefined;
    console.log(checkOnly
      ? '세션 재사용 확인 성공: 저장된 전용 프로필로 LMS에 접근했습니다.'
      : '로그인 확인 및 전용 프로필 저장 완료. 세션만 확인하려면 npm run login:check를 실행하세요.');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (context) await closeProfile(context).catch(() => undefined);
  }
}
