# Scheduled Fresh Login

상태: 2026-10-07 구현, 타입 검사/55개 자동 테스트, 실제 headless/visible 로그인, 전체 수집 2회 및 기존 Windows 예약 실행 검증 완료.

## 변경 범위와 보존

기존 check는 browser-data/hs-lms의 persistent context를 열어 checkSession으로 확인했다. 현재 production 진입점은 실행 잠금 → 새 비영속 Chromium/context → 자동 로그인 → 기존 수집기/비교/알림 → context/browser 종료 → 실행 결과 기록 → 잠금 해제다. scheduler의 실행 명령 `node --import tsx src/main.ts --check`, 30분 주기, 사용자/권한/IgnoreNew 설정은 변경하지 않는다.

과목/항목 크롤러 selector, detector, SQLite schema v4와 기존 baseline/notification_history/sync_history는 그대로다. 신뢰할 수 있는 기존 중복 방지를 유지하기 위해 수집 snapshot과 전송 대기 이벤트를 먼저 트랜잭션 저장하고 전송 결과를 이력에 반영하는 기존 순서도 유지한다. 알림 후에야 snapshot을 저장하도록 바꾸면 장애 때 중복/누락 위험이 생기므로 재설계하지 않았다.

기존 persistent 프로필과 수동 login/개별 진단 명령은 보존하되 check 및 credentials:test는 프로필을 읽거나 쿠키를 복사하지 않는다. 첫 로그인 등록/자동 로그인 자체는 baseline 초기화와 무관하다.

## Windows Credential Manager 선택

프로젝트에 암호화 파일·복호화 키를 둘 필요가 없고, Windows 공식 Generic Credential API를 현재 사용자 세션에서 사용할 수 있어 DPAPI 파일보다 우선 선택했다. 유지보수 불확실한 npm 네이티브 비밀 저장 패키지를 추가하지 않고 작은 PowerShell/C# 도우미가 CredWriteW/CredReadW/CredDeleteW를 호출한다.

- Target: `HS-LMS-Notifier:LMS:v1`, Generic 타입, CRED_PERSIST_LOCAL_MACHINE(동일 Windows 사용자, 이 PC에서 다음 로그인에도 유지). 이 값은 모든 Windows 사용자와 공유한다는 뜻이 아니다.
- 등록 시 ID와 Password 모두 Read-Host -AsSecureString으로 숨긴다. 인자/환경변수/명령 이력/파일에 비밀값을 전달하지 않는다.
- 앱 읽기는 숨김 자식 프로세스의 캡처 전용 파이프로만 전달한다. UTF-8 JSON을 메모리에서 ASCII base64로 framing하며 파일로 쓰지 않는다. Base64는 암호화가 아니며 저장 형식으로 사용하지 않는다. public npm 명령은 이 내용을 출력하지 않는다.
- 도우미 stderr는 일반화된 코드만 사용하고 앱은 원시 stderr/예외를 출력하지 않는다. 버퍼는 사용 후 0으로 덮고 참조를 해제한다. JS/.NET의 불변 문자열과 Playwright 내부 복사본까지 완벽한 메모리 삭제를 보장하지는 않는다.
- PSModulePath는 도우미 환경에서만 제거해 Windows PowerShell 표준 모듈을 사용한다. PowerShell 7에서 물려받은 모듈 경로 때문에 Security 모듈 자동 로드가 실패하는 문제를 실제 테스트로 확인/수정했다. 실행 정책은 변경/우회하지 않는다.
- 다른 Windows 사용자나 Git clone 사용자는 자격증명을 얻지 않는다. 같은 사용자 권한으로 실행되는 악성 코드/관리자/메모리 덤프까지 방어하는 보안 경계는 아니다. 공유 PC에서는 별도 Windows 계정을 사용해야 한다.

근거: [CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew), [CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw), [CREDENTIALW/Persist](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw).

## 자동 로그인과 안전 경계

MCP에서 빈 context로 확인한 SSO root, #ssoLoginFrm, #userId, #userPwd, submit을 사용한다. HTTPS origin과 관찰한 폼 action/method가 맞아야 값을 채운다. submit은 한 실행 1회, 자동 재시도 없음. LMS origin 전환 뒤 기존 checkSession과 실제 강좌 영역을 모두 확인해야 성공이다.

CAPTCHA/추가 인증 감지는 보이는 텍스트/iframe 제목의 보수적인 의미 기반 신호다. 실제 계정에서 아직 CAPTCHA/2FA 화면이 나타나지 않았으므로 특정 LMS 전용 challenge selector가 검증됐다고 주장하지 않는다. 알 수 없는 화면은 LMS_STRUCTURE_CHANGED, 알려진 추가 인증 신호는 AUTO_LOGIN_REQUIRES_USER. 해결/승인 버튼을 대신 누르지 않는다.

로그인 브라우저의 screenshot/trace/video/HAR/DOM dump/storageState를 만들지 않는다. DEBUG/PWDEBUG/DEBUG_FILE이 설정되어 있으면 인증 전에 거부한다. 실제 credentials:test는 채팅 도구에 ID/PW를 인자로 보내지 않고 로컬 보안 저장소에서 런타임에 읽는다. 크롤러는 인증 후에만 활성화한다.

## 결과 코드

SUCCESS, AUTO_LOGIN_FAILED, AUTO_LOGIN_REQUIRES_USER, CREDENTIALS_NOT_CONFIGURED, AUTH_EXPIRED_DURING_CRAWL, NETWORK_ERROR, LMS_STRUCTURE_CHANGED, COURSE_PARTIAL_FAILURE, DISCORD_FAILED, DB_ERROR, SCHEDULER_LOCKED, UNKNOWN_ERROR.

reason/action은 src/utils/result.ts의 고정 문구만 사용한다. 원시 오류나 페이지 텍스트는 reason으로 사용하지 않는다. 인증 문제는 같은 상태가 지속되는 기간에 한 번만 Discord로 보내고 정상 인증·강좌 확인 뒤 기간을 해제한다. 인증 실패 알림 자체가 실패하면 주 인증 오류를 보존하면서 deferred/uncertain을 함께 기록한다.

## 검증

기존 기능을 포함한 55개 자동 테스트 및 타입 검사 통과. 신규 검사는 Credential Manager의 별도 synthetic target 저장/조회/삭제, 미등록, 정상/거부(alert 및 로그인 폼 잔류)/추가 인증/네트워크/구조 변경, headless=true/false, 강좌 수집 연결, 브라우저 종료, baseline/history/D-Day 보존, DB/Discord 상태 분리 및 비밀값 출력 방지다. 합성 인증 페이지는 context offline + route.fulfill로 외부 접속을 차단한다. 초기 HTTP redirect 모의 방식이 실제 경로로 이어질 수 있음을 발견해 offline/문서 이동 방식으로 교체했다. 실제 사용자 자격증명은 이 테스트에 사용하지 않았다.

실계정 검증(모두 2026-10-07, Asia/Seoul):

- 사용자 로컬 등록 후 credentials:status는 CONFIGURED. credentials:test를 HEADLESS=true/false 각각 실행해 SUCCESS/Browser closed=true, DB/Discord 작업 없음 확인.
- 반복 check에서 각각 새 인증, 현재 학기 수집, baseline/변경 비교, 알림 중복 방지와 정상 종료를 확인했다. 실제 계정의 과목·항목 수는 문서에 기록하지 않는다.
- check 진행 중 추가 check는 SCHEDULER_LOCKED/종료0. 두 번째 자동 로그인 브라우저를 열지 않았다.
- 재개 시 이미 실행 중이던 기존 예약(07:56:05~07:58:05)도 같은 건수/0건 알림/SUCCESS. 추가 예약 실행이나 재등록 없이 확인했다. Ready/LastTaskResult=0, PT30M/IgnoreNew/Interactive/Limited/최대20분 설정 그대로다.
- 수동 실행과 예약의 소유 Node/Chromium/도우미 프로세스 트리를 추적해 종료 후 잔존0을 확인했다. 기존 사용자 브라우저와 MCP 브라우저는 건드리지 않았다.
- 실제 DB schema와 integrity를 확인하고, 기존 baseline/notification_history/sync_history/항목 정체성 행의 해시가 모두 보존된 것을 확인했다. 정상 실행 기록만 추가됐다. 계정별 DB 행 수는 문서에 기록하지 않는다.
- 등록한 ID/PW를 로컬 메모리에서만 읽어 소스·문서·.env·DB·로그·로컬 검사 파일 및 Git 이력과 대조: 노출0. 실제 Webhook 노출0, 로그인 screenshot/trace/HAR/video 산출물0. 검사 결과에는 값·길이·해시를 출력하지 않는다. 기존 수동 Chromium 프로필은 검사·복사·삭제하지 않았다.

잘못된 계정/추가 인증은 계정 잠금·불필요한 요청을 피하도록 합성 검사만 한다. 실제 CAPTCHA/2FA에 대한 자동 대응 성공을 주장하지 않는다. 별도 verify:e2e npm script는 없으며 위 실계정 검증이 end-to-end 검사다. Windows 보안 저장소의 사용자 범위와 제한을 넘어서는 비밀 보호는 보장하지 않는다.
