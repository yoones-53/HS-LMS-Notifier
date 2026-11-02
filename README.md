# HS-LMS-Notifier

## 0.2.0-beta.1 배포 안내

자동 확인 중단·재개, 관심영역 제외·복원, 선택형 Google 캘린더 동기화 코드를 포함한 Windows 베타입니다. 공개 EXE에는 개인 OAuth 설정과 사용자 인증정보를 포함하지 않습니다. Google 서비스는 현재 테스트 단계이므로 공개 EXE의 Google 로그인은 비활성 상태입니다. LMS/Discord 알림과 스케줄 중단·재개는 독립적으로 사용할 수 있습니다.

보안 검사 범위, 남아 있는 개발 도구 경고 및 검수 한계는 [배포 검증 기록](docs/release-security-0.2.0-beta.1.md)을 참고하세요. 이 베타는 코드 서명되지 않았으며 실제 Google 계정 동기화 검수는 완료되지 않았습니다.

## Google 캘린더 선택 연동

설정에서 Google 로그인·연결 해제·자동 반영 중지를 지원합니다. 배포용 OAuth 클라이언트 등록은 운영자가 한 번 수행하며 이용자는 Google 로그인과 권한 동의만 진행합니다. 별도 서버나 상주 프로세스 없이 기존 알림 실행에서 과제·강의 마감을 등록하고, 반복 알림은 일정 하나로 유지합니다. 현재 preview는 운영자용 Google 등록값이 없어 실제 로그인은 비활성화되어 있습니다. 운영 설정과 검증 범위는 [Google 캘린더 연동](docs/google-calendar.md)을 참고하세요.

연결 시 기존 미제출 과제·미수강 강의도 반영하며, LMS에서 완료가 확인되면 같은 일정에 ‘✅ 완료’를 표시하고 마감 알림을 끕니다. 로그인은 기본 캘린더 접근까지 검수하며, 설정의 ‘연결 검수 · 기존 마감 반영’과 `npm run calendar:doctor`로 연결 문제를 확인할 수 있습니다.

## Windows 설치 프로그램 (개발 검증판)

일반 Windows 사용자는 `HS-LMS-Notifier-Setup-0.1.0.exe`로 설치한 뒤 시작 메뉴의 **한신 LMS 알리미**를 실행합니다. 설치본에는 필요한 Chromium이 포함되어 있어 Node.js, npm, Git, 별도 브라우저 설치 명령이 필요하지 않습니다. 처음 실행하면 화면 안내에 따라 본인의 LMS 로그인 정보와 Discord Webhook을 등록합니다.

현재 installer는 코드 서명되지 않은 `0.x` 개발 검증판이므로 SmartScreen 경고가 나타날 수 있습니다. 공개 다운로드 링크나 최종 v1.0.0 릴리스는 아직 제공하지 않습니다. 제거해도 `%APPDATA%\HS-LMS-Notifier`의 DB/settings와 Windows Credential Manager 정보는 보존합니다.

개발자가 설치 파일을 만드는 명령:

```powershell
npm ci
npm run dist:win
```

산출물은 `release/HS-LMS-Notifier-Setup-0.1.0.exe`에 생성되며 Git에는 포함하지 않습니다. 세부 정책은 [Windows 패키징 문서](docs/packaging.md)를 참고하세요.

## 소스에서 실행하는 Windows GUI

기존 CLI 코어 위에 Electron 화면을 추가했습니다. 아래 명령은 개발용 소스 실행입니다.

```powershell
npm install
npm run gui:install
npm run browser:install
npm run gui:dev
```

처음에는 화면 안내에 따라 LMS 로그인 정보 → 로그인 테스트 → Discord Webhook → 테스트 알림 → 자동 확인 설정을 진행합니다. 비밀값은 현재 Windows 사용자의 보안 저장소에 저장되고 다시 표시되지 않습니다. 기존 사용자는 설정과 DB 이력을 감지해 대시보드로 이동합니다.

대시보드의 **지금 확인**으로 한 번 실행합니다. X는 트레이로 숨기며, 완전히 끝내려면 트레이 메뉴의 **종료**를 선택합니다. 자동 확인을 켜면 설치본이 Windows 예약 작업으로 30분마다 확인하므로 앱을 종료해도 계속됩니다. 이전 개발용 예약 작업을 발견하면 설정 화면에서 안전하게 전환할 수 있으며, 전환 시 기존 작업은 삭제하지 않고 비활성화합니다.

**해야 할 일**에는 확인된 미제출 과제와 미완료 온라인 강의, 상태 확인 필요 항목을 기한순으로 보여줍니다. UNKNOWN은 미제출·미수강 숫자에 포함하지 않습니다. 현재 LMS는 전체 영상 시청 완료 여부를 제공하지 않으므로 출석 인정 완료 항목만 제외하고 나머지는 상태 확인 필요로 표시합니다. 기한이 지난 항목도 남으며 D+N으로 표시합니다. 목록은 최근 저장된 수집 범위 기준이며, 일부 수집 실패는 별도로 안내합니다.

**설정 → Discord 마감 알림**에서 7일 전·3일 전·1일 전·당일을 각각 켜거나 끌 수 있습니다. 변경 시 저장 결과를 표시하며 다음 GUI·CLI·예약 실행부터 적용합니다. 기본은 모두 켜짐입니다. 꺼도 수집과 해야 할 일 표시는 계속되고, 이미 보낸 알림이나 꺼 둔 사이 지나간 날짜의 알림을 다시 보내지 않습니다. 상세 기준은 [Todo·마감 알림 설정](docs/todo-dashboard.md)을 참고하세요.

GUI 첫 실행 시 기존 DB를 검증해 `%APPDATA%\HS-LMS-Notifier`로 이전합니다. 원본은 보존하고 이후 CLI·예약·GUI가 같은 운영 DB를 사용합니다. 설정 화면에서 로그/데이터 위치를 열 수 있습니다. DB나 `data/runtime-location.json`을 임의로 삭제하지 마세요.

Store 앱 안에서 개발 실행한 경우 Windows 리디렉션 때문에 실제 위치가 해당 앱의 package cache 아래일 수 있습니다. **개발 도구를 초기화/제거하기 전에 데이터 위치의 최신 DB를 백업하세요.** 표시 경로가 아닌 검증된 실제 위치를 GUI·예약이 함께 사용합니다. Ctrl+Q로 앱을 완전히 종료할 수 있습니다.

개발자 도구 없는 실행: `npm run gui:start`. 검사: `npm run gui:typecheck`, `npm run gui:test`. 내부 구조와 복구 주의사항은 [GUI 문서](docs/gui-architecture.md)를 참고하세요. 아래 CLI 명령도 계속 사용할 수 있습니다.

## 1. 이 프로그램은 무엇인가요?

한신대학교 LMS를 읽어 새 공지·강의자료·과제·온라인 강의와 마감 변경을 Discord로 알려주는 개인용 프로그램입니다. 과제 제출 상태와 LMS의 출석완료 표시를 읽고, 한국 날짜 기준 D-7·D-3·D-1·D-Day 알림을 보냅니다.

처음 확인한 과목/유형은 기존 자료를 기준 데이터로만 저장하고 개별 신규 알림을 보내지 않습니다. 같은 항목의 같은 알림은 다시 보내지 않습니다. 영상 재생·과제 제출·출석 대행은 하지 않습니다.

최초 정상 전체 동기화 후에는 **연동 완료 요약 1건**을 보냅니다. 기존 사용자는 요약 발송 기록이 없다면 다음 정상 실행에서 받습니다. 이후 같은 요약은 다시 보내지 않습니다. 시청 완료 여부처럼 읽을 수 없는 상태는 '확인 불가'로 표시합니다.

현재 한계: 정확한 시청 진도율/전체 시청 완료, ID 없는 예정 영상, 확인되지 않은 다중 페이지, 게시물 본문/첨부 다운로드는 지원하지 않습니다. 출석완료는 시청률 100%와 다릅니다. LMS 구조가 바뀌면 재조사가 필요합니다.

## 2. 최초 설치

Windows에 Node.js 24 LTS를 설치합니다(검증 버전: 24.16.0). 프로젝트 폴더의 PowerShell에서:

```powershell
npm install
npm run browser:install
npm run typecheck
npm test
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

GitHub 저장소를 clone하거나 소스 ZIP을 풀어 본인만 접근하는 폴더에 설치하세요. 다른 사람의 작업 폴더 전체(.env/DB/로그/프로필 포함)를 복사하지 마세요. 설치마다 아래의 본인 로그인 정보와 Discord 설정이 필요합니다.

## 3. LMS 자동 로그인 설정 (최초 1회)

```powershell
npm run credentials:setup
```

로컬 터미널에서 LMS ID와 Password를 입력합니다. 두 입력 모두 화면에 표시되지 않습니다. `CREDENTIALS_SAVED`가 나오면 등록 완료입니다. 로그인 정보는 현재 Windows 사용자의 보안 저장소에만 저장하며 채팅·.env·코드에 넣지 마세요.

테스트: `npm run credentials:test` — 로그인만 확인하고 종료합니다(DB 동기화·Discord 전송 없음).
정보 변경: `npm run credentials:setup`, 삭제: `npm run credentials:remove`, 등록 여부 확인: `npm run credentials:status`.

`check`는 매번 새 브라우저 context에서 1회 자동 로그인합니다. 기존 `browser-data`는 삭제하지 않지만 자동 실행에서 재사용하지 않습니다. 실제 계정으로 창 있는/없는 로그인과 전체 수집·예약 실행을 검증했습니다. 구현/보안 상세는 `docs/auto-login.md`에 있습니다.

## 4. Discord Webhook 설정

GUI는 설정 화면에서 Webhook을 등록합니다. CLI만 사용하는 경우 프로젝트 루트 `.env`의 `DISCORD_WEBHOOK_URL=` 뒤에 본인의 URL을 직접 넣고 저장합니다. 실제 URL을 공유하거나 코드에 넣지 마세요. `.env.example`에는 넣지 않습니다. GUI 보안 저장소에 등록된 주소가 있으면 CLI도 그 주소를 우선하므로 주소 변경은 GUI에서 하세요.

```powershell
npm run notify:test
```

연결 테스트는 같은 DB에서 1번만 전송됩니다. 반복 실행의 `SKIPPED`는 정상입니다. 전송 결과가 불명확한 UNKNOWN/SENDING 알림은 중복 방지를 위해 자동 재전송하지 않으므로 Discord 수신 여부와 로컬 기록을 확인해야 합니다.

## 5. 수동 실행

```powershell
npm run check
```

자동 로그인 후 전체 과목을 순서대로 수집하고 DB 비교와 알림까지 한 번 실행합니다. 기본은 창 없는 실행입니다. 확인용으로 창을 보고 싶으면 `.env`에 `HEADLESS=false`를 지정합니다(`credentials:test`에도 적용). `npm run dev`도 같은 흐름입니다.

결과는 콘솔과 `logs/monitor-YYYY-MM-DD.jsonl`에 남습니다. `SUCCESS`는 정상, `SUCCESS_WITH_CHANGES`는 새 내용/변경 확인, `PARTIAL`은 일부 처리 실패입니다. 실패한 과목·메뉴와 원인·조치를 함께 표시합니다. `LMS collection / Database / Discord`를 따로 보여주므로 알림만 실패했는지 구분할 수 있습니다. 메뉴 미제공은 오류가 아니며, 다른 실행 중에는 `SCHEDULER_LOCKED`로 건너뜁니다. 기존 baseline과 알림 이력은 유지합니다.

`Initial summary: SENT`는 최초 요약 전송 성공, `SKIPPED / ALREADY_SENT`는 이미 보낸 정상 상태입니다. 명확한 전송 실패는 다음 정상 실행에서 재시도합니다. 전송 여부가 불명확한 경우는 중복 방지를 위해 자동 재전송하지 않습니다. 자세한 기준은 `docs/initial-summary.md`를 참고하세요.

검사용 개별 명령과 세부 구조는 `docs/`를 참고하세요. `npm run sync -- --all`은 DB만 동기화하고 알림은 보내지 않습니다.

## 6. 자동 실행

```powershell
npm run schedule:install
npm run schedule:run
npm run schedule:status
```

Windows 작업 스케줄러에 `HS-LMS-Notifier`를 등록합니다. 30분마다 창 없이 실행합니다. `schedule:status`에서 숫자 결과의 뜻과 최근 프로그램 결과·원인·조치를 볼 수 있습니다. `0 (SUCCESS)`는 정상 종료이며 잠금 건너뜀도 포함하므로 `Last scheduled monitor`도 확인하세요. `267009 / TASK_RUNNING`은 실행 중입니다. 등록한 사용자가 Windows에 로그인되어 있고 PC가 켜져 있어야 합니다. 화면 잠금은 가능하지만 종료·절전·로그아웃 중에는 실행되지 않습니다.

기존 사용자는 현재 예약을 그대로 사용합니다. 프로젝트 폴더나 Node 설치 위치가 바뀌면 예약에 저장된 절대경로가 깨집니다. 기존 예약을 중지하고 실행 종료를 확인한 다음, 작업 스케줄러에서 해당 `HS-LMS-Notifier` 작업의 경로를 확인해 그 작업만 삭제한 후 새 폴더에서 `npm run schedule:install`을 실행하세요. 다른 경로의 동일 이름 작업을 자동으로 덮어쓰지 않습니다.

중지는 `npm run schedule:disable`, 재개는 `npm run schedule:enable`입니다. 진행 중인 실행을 강제로 종료하지는 않습니다. 실패해도 다음 예약은 유지됩니다. 예약 작업 로그는 `logs/scheduler-YYYY-MM-DD.log`에 있습니다. GUI 이전 후에는 AppData의 logs를 사용합니다. 자세한 조건/권한은 `docs/windows-scheduler.md`를 참고하세요.

## 7. 자동 로그인이 실패했을 때

AUTO_LOGIN_FAILED 또는 CREDENTIALS_NOT_CONFIGURED이면 `npm run credentials:setup`으로 정보를 등록/수정한 뒤 `npm run credentials:test`로 확인하세요. 등록은 예약 작업과 같은 Windows 사용자 계정에서 해야 합니다.

AUTO_LOGIN_REQUIRES_USER는 CAPTCHA·추가 인증 등 사람이 필요한 상태입니다. 이를 자동으로 풀거나 우회하지 않습니다. AUTH_EXPIRED_DURING_CRAWL은 수집 중 인증이 풀린 경우이며 이번 실행을 종료하고 다음 예약에서 새 인증을 시도합니다.

LMS_STRUCTURE_CHANGED는 구조 재확인, NETWORK_ERROR/LMS_TIMEOUT은 연결 또는 응답 지연입니다. 일시 오류는 다음 예약에서 다시 확인하고 반복될 때만 제한적으로 알립니다. 인증·구조 오류는 같은 문제가 계속되는 동안 중복 알림을 억제합니다. 복구는 로그에 기록합니다.

DATABASE_ERROR이면 DB를 삭제하지 말고 권한/디스크를 확인하세요. DISCORD_NOTIFICATION_FAILED이면 Webhook과 알림 이력을 확인하세요. 장애 때는 알림 자체가 도착하지 않을 수 있으므로 로그도 확인하세요. 자세한 상태·복구·알림 정책은 `docs/status-reporting.md`에 있습니다.

## 8. 주요 폴더

- `src/auth`, `src/browser`: 보안 저장소·자동 로그인·실행별 전용 브라우저
- `src/crawler`: 실제로 확인된 LMS 목록 수집
- `src/database`, `src/detector`, `src/notification`: SQLite, 변경/마감 판단, Discord
- `src/summary`: 최초 연동 요약 데이터 계산(GUI에서도 재사용 가능)
- `src/status`: 공통 실행 결과·한국어 안내·오류 알림 정책·최근 상태 저장
- `src/desktop`, `src/runtime`: Electron 화면/안전한 IPC, 공통 실행과 경로/이전/보관 정책
- `src/main.ts`, `src/monitor.ts`: 전체 실행 흐름
- `scripts/`, `tests/`, `docs/`: 실행/Windows 설정, 자동 검사, 상세 문서
- `data/`, `logs/`, `browser-data/`, `.env`: 로컬 전용 데이터와 비밀값 — Git 제외
- `PROJECT_STATE.md`: 검증 결과·커밋·남은 한계·재개 지점

브라우저 프로필과 `.env`는 로그인 권한/비밀값을 포함하므로 공유하지 마세요. DB와 로그에도 개인 수강 정보가 있으므로 작업 폴더 전체를 공유/업로드하지 마세요. Git 제외는 암호화가 아닙니다. Windows 보안 저장소도 같은 Windows 사용자로 실행하는 악성 프로그램까지 차단하지는 않습니다.

한 설치/Windows 사용자에 한 LMS 계정을 사용하세요. 계정 변경 시 같은 DB/알림 이력을 무작정 재사용하지 말고 먼저 안전한 데이터 분리 계획이 필요합니다. GUI는 기본 30일보다 오래된 일별 로그만 정리합니다. DB 실행/알림 이력은 정확한 동작을 위해 보존하므로 디스크 여유를 확인하세요.

인증이 포함된 실행에서 `DEBUG`, `PWDEBUG`, `DEBUG_FILE`, `NODE_DEBUG`, `NODE_DEBUG_NATIVE`는 사용하지 않습니다(설정 시 실행 중단). 디버거/trace/화면 캡처 도구로 로그인 값을 기록하지 마세요. 오류 공유 시 .env/DB/원본 로그 대신 정제된 상태 코드만 전달하세요.

검증: `npm run typecheck`, `npm test`, `npm run verify:e2e`. 마지막 명령은 합성 LMS/전송을 이용한 오프라인 통합 검사이며 실제 계정 검사는 `npm run check`로 구분합니다. 일반적인 알림 중복은 방지하지만 네트워크 장애 사이의 완벽한 전달 보장은 하지 않습니다. 배포 감사와 남은 제한은 `docs/security-audit.md`, GUI 준비 목록은 `docs/distribution-todo.md`를 참고하세요.
# 자동 확인 중단과 관심영역 관리 (2026-10-31)

- 대시보드의 **자동 확인 중단 / 자동 확인 재개** 버튼으로 30분 예약 실행을 즉시 설정합니다. 설정 화면의 자동 확인 체크박스도 변경 즉시 저장합니다.
- 중단 설정은 재실행 후에도 유지됩니다. 진행 중인 확인은 마무리되며 **지금 확인**은 계속 사용할 수 있습니다.
- 인식된 설치본 예약 작업과 기존 개발용 예약 작업을 함께 비활성화합니다. 상태 조회 시 활성 작업의 30분 트리거를 다시 등록하지 않습니다.
- 과제·온라인 강의의 **관심영역에서 제외** 버튼은 해당 항목을 해야 할 일 목록, 건수와 가장 가까운 마감 집계에서 제외합니다. 다음 수집 및 앱 재실행 후에도 유지됩니다.
- **관심영역에서 제외한 항목**을 펼쳐 **관심영역에 복원**할 수 있습니다. 현재 수집 범위에 있는 미완료 항목이 이 목록에 표시됩니다.
- 제외는 로컬 관심 목록에만 적용되며 LMS 제출·출석 상태와 Discord 알림 정책은 바꾸지 않습니다.
