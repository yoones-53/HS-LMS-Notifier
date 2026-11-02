// Pure, UI-independent contracts. Never use exception messages as presentation text.
export const STATUS_INFO = {
  SUCCESS: ['정상 완료', 'LMS 확인과 필요한 알림 처리를 완료했습니다.', '다음 예약 실행을 기다리세요.', true],
  SUCCESS_WITH_CHANGES: ['새로운 내용 확인', 'LMS의 신규 또는 변경 내용을 확인하고 알림 처리를 완료했습니다.', 'Discord에서 변경 내용을 확인하세요.', true],
  PARTIAL: ['일부 처리 확인 필요', '일부 작업을 완료하지 못했습니다. 아래 영향을 받은 영역을 확인하세요.', '정상 처리된 데이터는 유지합니다. 아래 항목별 조치를 확인하세요.', true],
  CREDENTIALS_NOT_CONFIGURED: ['로그인 정보 등록 필요', 'Windows 보안 저장소에 LMS 로그인 정보가 없습니다.', 'npm run credentials:setup으로 로그인 정보를 등록하세요.', false],
  AUTO_LOGIN_FAILED: ['LMS 자동 로그인 실패', '저장된 로그인 정보로 LMS 로그인을 확인하지 못했습니다.', '로그인 정보가 변경되었다면 npm run credentials:setup으로 다시 등록하세요.', false],
  AUTO_LOGIN_REQUIRES_USER: ['추가 사용자 인증 필요', 'CAPTCHA·2단계 인증·본인 확인 등 추가 인증이 필요합니다.', '추가 인증을 직접 처리해야 합니다. 보안 기능을 우회하지 않습니다.', false],
  AUTH_EXPIRED_DURING_CRAWL: ['수집 도중 인증 만료', 'LMS 확인 도중 인증이 만료되어 이번 수집을 중단했습니다.', '이번 실행에서 재로그인하지 않습니다. 다음 예약 실행에서 새로 인증합니다.', true],
  NETWORK_ERROR: ['LMS 연결 실패', 'LMS 연결 과정에서 네트워크 오류가 발생했습니다.', '다음 예약 실행에서 자동으로 다시 시도합니다. 반복되면 인터넷과 LMS 상태를 확인하세요.', true],
  LMS_TIMEOUT: ['LMS 응답 시간 초과', 'LMS 페이지 또는 요소를 기다리는 제한 시간이 지났습니다.', '다음 예약 실행에서 자동으로 다시 시도합니다. 반복되면 LMS 상태를 확인하세요.', true],
  LMS_STRUCTURE_CHANGED: ['LMS 페이지 구조 확인 필요', '기존에 확인한 LMS 화면 구조와 일치하지 않습니다.', 'LMS 페이지가 변경되었을 수 있습니다. 구조 재확인과 프로그램 업데이트가 필요합니다.', false],
  COURSE_PARTIAL_FAILURE: ['일부 과목 확인 실패', '일부 과목 또는 메뉴를 가져오지 못했습니다. 성공한 범위만 반영했습니다.', '나머지 과목은 정상 처리되었습니다. 아래 실패 영역을 확인하고 다음 예약 실행을 기다리세요.', true],
  DATABASE_ERROR: ['데이터베이스 접근 실패', '로컬 SQLite 읽기 또는 저장을 완료하지 못했습니다.', 'DB를 삭제하지 마세요. 파일 접근 권한과 디스크 여유 공간을 확인하세요.', false],
  DISCORD_NOTIFICATION_FAILED: ['Discord 알림 확인 필요', 'Discord 알림을 보내지 못했거나 전송 결과가 불명확합니다. LMS 수집 결과와는 별개입니다.', 'Webhook 설정과 알림 기록을 확인하세요. 불명확한 전송은 중복 방지를 위해 자동 재전송하지 않습니다.', false],
  SCHEDULER_LOCKED: ['다른 실행 진행 중', '다른 확인 또는 로그인 작업이 진행 중이어서 이번 실행을 건너뜁니다.', '현재 작업이 끝난 뒤 실행하거나 다음 예약을 기다리세요.', true],
  INITIALIZATION_ERROR: ['실행 준비 실패', '설정·로그·실행 잠금 또는 브라우저 준비를 완료하지 못했습니다.', '설정, 폴더 권한과 Node.js·Chromium 설치를 확인하세요. npm run browser:install로 브라우저를 설치할 수 있습니다.', false],
  UNKNOWN_ERROR: ['예상하지 못한 오류', '실행을 안전하게 완료하지 못했습니다. 원시 오류는 비밀정보 보호를 위해 표시하지 않습니다.', '안전한 실행 로그와 실행 환경을 확인하세요. 반복되면 프로그램 점검이 필요합니다.', false],
} as const;
export type StatusCode = keyof typeof STATUS_INFO;
export const isStatusCode = (value: unknown): value is StatusCode => typeof value === 'string' && Object.hasOwn(STATUS_INFO, value);
export const SCOPES = ['AUTHENTICATION','COURSE_LIST','COURSE','NOTICE','MATERIAL','ASSIGNMENT','ONLINE_LECTURE','DATABASE','DISCORD','INITIALIZATION','CLEANUP','SCHEDULER'] as const;
export type Scope = typeof SCOPES[number];
export const AUTH_CODES = new Set<StatusCode>(['CREDENTIALS_NOT_CONFIGURED','AUTO_LOGIN_FAILED','AUTO_LOGIN_REQUIRES_USER','AUTH_EXPIRED_DURING_CRAWL']);
export interface RunIssue {
  errorCode: StatusCode; scope: Scope; courseId?: string; courseName?: string;
  safeReason: string; action: string; recoverable: boolean;
}
export interface RunResult {
  status: StatusCode; code: StatusCode; title: string; reason: string; action: string;
  recoverable: boolean; occurredAt: string; exitCode: 0 | 1 | 2;
  affectedScopes: Scope[]; errors: RunIssue[]; warnings: RunIssue[];
  collectionStatus?: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_RUN';
  databaseStatus?: 'SUCCESS' | 'FAILED' | 'NOT_RUN';
  notificationStatus?: 'SUCCESS' | 'FAILED' | 'NOT_RUN';
}
export function exitCodeFor(code: StatusCode): 0 | 1 | 2 {
  if (code === 'SUCCESS' || code === 'SUCCESS_WITH_CHANGES' || code === 'SCHEDULER_LOCKED') return 0;
  return AUTH_CODES.has(code) ? 2 : 1;
}
// Course names are LMS display text, never an Error/URL/DOM dump. Reject suspicious text.
export function safeCourseName(value: string): string {
  if (/[\r\n\x00-\x1f]|https?:|password|passwd|cookie|token|webhook|credential|비밀번호|[=<>\\]/i.test(value)) return '[과목명 생략]';
  return value.replace(/[^\p{L}\p{N}\p{Zs}()[\]·.,:_+&/\-]/gu, '').slice(0, 100) || '[과목명 생략]';
}
export function issue(code: StatusCode, scope: Scope, course?: { id: string; name: string }): RunIssue {
  const [, safeReason, action, recoverable] = STATUS_INFO[code];
  return { errorCode: code, scope, safeReason, action, recoverable,
    ...(course ? { courseId: /^[A-Za-z0-9_:.-]{1,120}$/.test(course.id) ? course.id : 'OMITTED', courseName: safeCourseName(course.name) } : {}) };
}
export const checkpoint = (scope: Scope, courseId?: string): string => `${scope}:${courseId ?? 'GLOBAL'}`;
export function runResult(code: StatusCode, errors: RunIssue[] = [], now = new Date(), partial = false): RunResult {
  const [title, reason, action, recoverable] = STATUS_INFO[code];
  return { status: partial ? 'PARTIAL' : code, code, title, reason, action,
    recoverable: errors.length ? errors.every(e => e.recoverable) : recoverable,
    occurredAt: now.toISOString(), exitCode: exitCodeFor(code), affectedScopes: [...new Set(errors.map(e => e.scope))], errors, warnings: [] };
}
// Allowlist projection at the log/file boundary. Raw properties/text are never serialized.
export function safeResult(value: RunResult): RunResult {
  const code = isStatusCode(value.code) ? value.code : 'UNKNOWN_ERROR';
  const clean = (entries: RunIssue[]) => entries.slice(0, 100).map(e => issue(isStatusCode(e.errorCode) ? e.errorCode : 'UNKNOWN_ERROR',
    SCOPES.includes(e.scope) ? e.scope : 'INITIALIZATION', e.courseId ? { id: e.courseId, name: e.courseName ?? '[과목명 생략]' } : undefined));
  const time = new Date(value.occurredAt);
  const result = runResult(code, clean(value.errors), Number.isFinite(time.getTime()) ? time : new Date(), value.status === 'PARTIAL');
  result.warnings = clean(value.warnings);
  if (value.collectionStatus && ['SUCCESS','PARTIAL','FAILED','NOT_RUN'].includes(value.collectionStatus)) result.collectionStatus = value.collectionStatus;
  for (const key of ['databaseStatus','notificationStatus'] as const) {
    if (value[key] && ['SUCCESS','FAILED','NOT_RUN'].includes(value[key])) result[key] = value[key];
  }
  return result;
}
