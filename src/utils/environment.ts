import { join } from 'node:path';
import { config } from 'dotenv';
import { PROJECT_ROOT } from './config.js';
import { UserFacingError } from './cli.js';
import { assertSafeDiagnostics } from './security.js';

export function loadEnvironment(): void {
  assertSafeDiagnostics();
  const result = config({ path: join(PROJECT_ROOT, '.env'), quiet: true, debug: false });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new UserFacingError('프로젝트 환경 설정 파일을 읽을 수 없습니다. 파일 접근 권한을 확인해 주세요.');
  }
  // Do not print parsed values. The login flow never reads credentials from env.
  assertSafeDiagnostics();
}
