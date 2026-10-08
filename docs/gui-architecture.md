# Electron GUI (개발 실행)

이 GUI는 기존 CLI의 새 프런트엔드다. 설치 프로그램/공개 배포/자동 업데이트는 포함하지 않는다. TypeScript + HTML/CSS를 선택했다. 화면 수가 적어 별도 프런트엔드 프레임워크 없이 유지보수할 수 있다.

## 실행과 책임

```powershell
npm install
npm run gui:install
npm run browser:install
npm run gui:dev
```

`gui:start`는 개발자 도구를 비활성화한 동일 화면이다. `gui:dev`만 개발자 도구 사용을 허용하며 기본으로 열지는 않는다. 로그인 입력 중에는 개발자 도구/trace/녹화를 사용하지 않는다. 아직 바이너리 패키징/Setup.exe는 없다.

- `src/desktop/main.ts`: 앱 수명, 단일 인스턴스, userData, 창, 트레이, 고정 폴더/도움말 열기.
- `service.ts`: 설정, Wizard 검증 상태, 실행 잠금, 30분 타이머, 취소/종료. 테스트에서는 의존성을 대체한다.
- `production.ts`: 기존 Windows 보안 저장소/Playwright/Discord/모니터링을 연결한다.
- `window.ts`, `ipc-policy.ts`: IPC 발신 창/메인 프레임/로컬 페이지 검증, 외부 navigation와 팝업/권한 차단.
- `preload.ts`: 명시적 allowlist API만 격리된 renderer에 노출한다. Node/Electron API 객체를 반환하지 않는다.
- `renderer/`: 한국어 Wizard·대시보드·설정. 학습 텍스트를 DOM textContent로 표시하며 외부 HTML을 삽입하지 않는다. OS light/dark 색상을 따른다.
- `src/runtime/run-once.ts`: CLI/예약/GUI 공통 한 번 실행. 기존 `monitor.ts`, crawler, detector, notification, SQLite 스키마를 재사용한다.

## 저장 위치와 CLI 공존

Electron의 `app.getPath('appData')/HS-LMS-Notifier`를 userData로 지정하고, 이후 `app.getPath('userData')`를 RuntimePaths에 전달한다. Windows의 일반적인 위치는 `%APPDATA%\HS-LMS-Notifier`다.

**Store/MSIX 개발 호스트 주의:** Windows가 Roaming 경로를 `%LOCALAPPDATA%\Packages\<호스트 패키지>\LocalCache\Roaming\HS-LMS-Notifier`로 리디렉션할 수 있다. 실제 검사에서 Node realpath는 표시 경로를 돌려주었지만 Windows `GetFinalPathNameByHandle`은 실제 경로를 확인했다. 고정 읽기 전용 디렉터리 핸들 helper로 실제 위치를 찾고, 앱 ready/single-instance 획득 전에 userData를 그 경로로 설정한다. 현재 Windows 사용자 AppData 또는 정확한 package-cache/app suffix만 허용한다. 일반 Scheduler도 이 물리 경로를 사용한다. Windows의 가상화/보안 설정을 끄지 않는다.

이미 활성화된 논리 별칭은 양쪽 DB의 실제 file ID/dev가 같은 경우에만 잠금 아래 연결 경로를 보정한다. DB를 다시 복사하거나 초기화하지 않는다. **개발 호스트 앱을 초기화/제거하면 그 패키지 데이터도 삭제될 수 있으므로 먼저 설정의 데이터 위치에서 최신 DB를 안전하게 백업해야 한다.** 독립 설치 프로그램 단계에서 호스트와 독립된 저장 위치로 검증된 이전을 수행할 계획이다. 이 개발용 제약을 공개 배포 준비 완료로 오인하지 않는다.

```text
<userData>/
  data/lms.sqlite                 현재 운영 DB (schema 4)
  data/process-lock.sqlite        운영 실행 잠금
  logs/monitor-YYYY-MM-DD.jsonl    한국 날짜별 안전한 로그
  logs/scheduler-YYYY-MM-DD.log   예약 wrapper 로그
  logs/latest-run.json            정제된 최근 결과
  state/settings.json            비밀값 없는 설정
  state/migration.json            검증/활성화 정보 (개인 자료 원문 없음)
  browser/hs-lms/                 필요한 경우 수동 로그인 전용 프로필
```

Fresh Login은 이 프로필을 재사용하지 않고 매 실행 새 임시 context를 닫는다. 기존 프로젝트 `browser-data`는 이전/복사/삭제하지 않는다. 기존 로그도 원본에 남긴다. 최근 실행/incident/recovery는 이전된 DB에서 읽는다.

GUI 첫 실행 전 CLI는 기존 프로젝트 data/logs 경로를 쓴다. 이전 성공 후 프로젝트의 Git 제외 파일 `data/runtime-location.json`이 검증된 userData를 연결한다. 이후 **CLI와 기존 예약도 같은 DB/알림 이력/로그를 사용한다**. 독립 DB 복사본을 동시에 모니터링하지 않는다. 경로는 임의 문자열을 신뢰하지 않고 현재 사용자 AppData의 고정 위치와 일치해야 하며, 활성화 UUID/스키마/DB 존재 여부도 검증한다.

GUI 인스턴스 잠금과 모니터링 잠금은 별개다. 실행/이전/자격증명 변경 시 프로젝트 기존 잠금 → userData 잠금 순서로 획득한다. 하나라도 사용 중이면 건너뛴다. CLI는 기존 잠금을 획득한 **후** 활성 경로를 해석하므로 이전 경계에서 오래된 DB에 쓰지 않는다.

## 안전한 일회 DB 이전

1. 두 실행 잠금 획득. 기존 원본은 읽기 전용으로 연다.
2. 원본 integrity/schema 검증 및 고정 8개 테이블 전체 행의 정렬 해시/개수 계산.
3. Node SQLite online backup으로 UUID 임시 DB 생성(WAL 포함).
4. 원본 재검사(비협조적 외부 writer 감지), 임시 DB integrity/schema/행 해시·개수 일치 확인.
5. 임시 DB를 운영 목적지로 활성화하고 검증 metadata 저장.
6. 프로젝트 연결 파일을 **마지막**에 원자적으로 게시.

courses/items/baseline/change_events/notification_history/sync_history/monitor_runs/monitor_state 전부 보존한다. 최초 summary SENT와 오류/recovery도 포함한다. 기존 목적지나 불완전한 이전 기록이 있으면 덮어쓰거나 빈 DB로 대체하지 않는다. 실패하면 이번 시도에서 만든 미활성 목적지만 정리하며 원본을 건드리지 않는다. 연결 게시 직전 I/O 실패를 주입한 rollback 테스트를 포함한다.

원본 DB는 즉시 삭제하지 않는다. 단, 활성화 뒤 원본은 **과거 시점 복사본**이다. 단순히 연결 파일을 지우면 최신 알림 이력을 잃고 중복 알림이 생길 수 있다. rollback/폴더 이동은 두 실행을 멈추고 최신 운영 DB를 SQLite backup으로 보존·검증한 뒤 경로를 전환하는 별도 작업이어야 한다. 자동 rollback 버튼은 제공하지 않는다. 앱/OS가 활성화 중 강제 종료되어 불완전 목적지가 남으면 데이터 파일 오류로 중단하고 수동 점검을 요구한다.

## 비밀값과 설정

기존 `HS-LMS-Notifier:LMS:v1` Credential을 그대로 사용한다. GUI가 값을 저장할 때 입력은 renderer→preload→main→고정 PowerShell helper의 stdin private pipe로만 전달한다. 명령 인자/환경/파일로 전달하지 않는다. 저장 뒤 입력 필드와 참조를 비운다. 기존 ID/PW/URL을 조회하여 UI에 반환하는 API는 없다.

GUI Discord는 `HS-LMS-Notifier:Discord:v1` Generic Credential에 저장한다. 기존 보안 저장소에 없는 경우에만 개발 `.env`의 유효한 Webhook을 가져온다. `.env`는 CLI 호환을 위해 그대로 보존하며 이후 CLI도 보안 저장소를 우선한다. 변경하려면 GUI에서 새 주소를 저장한다. 다른 사용자의 clone에는 어느 Credential도 포함되지 않는다. 동일 Windows 사용자 권한의 악성 프로그램/메모리 덤프까지 차단하는 저장소는 아니다.

신규 설정은 LMS 로그인 테스트·Discord 테스트가 모두 성공해야 완료된다. 기존 설치는 이전된 성공 실행과 기존 Credential/Discord 등록을 확인하면 Wizard 대신 대시보드를 표시한다. 현재 저장된 계정과 다른 ID로 이력이 있는 DB를 합치지 않는다. v1은 한 Windows 사용자/설치에 한 LMS 계정을 전제한다.

Zod를 사용해 IPC 입력, 설정, migration metadata, recent result, incident/recovery를 실행 시 검증한다. 잘못된 JSON/구버전 schema는 고정된 한국어 오류로 표시하며 파일을 초기화하지 않는다. 오류 reason/action은 기존 상태 카탈로그로 재생성한다. 일반 renderer에 stack trace를 보내지 않는다. 임의 파일 import나 SQL 실행 API는 없다.

## IPC allowlist

조회: `getStatus`, `getSettings`, `getRecentIncidents`.

작업: `runCheck`, `updateSettings`(자동 실행/보관일수만), `setupCredentials`, `removeCredentials`, `testCredentials`, `configureDiscord`, `testDiscord`, `completeSetup`.

열기: `openLogs`, `openData`, `openDiscordHelp`(고정 Discord 공식 도움말만).

임의 명령/경로/URL 인자를 받지 않는다. 알 수 없는 필드와 메서드도 거부한다. BrowserWindow는 nodeIntegration=false/contextIsolation=true/sandbox=true, CSP는 self 정적 script/style 외 연결·frame·form 제출을 막는다. 권한 요청/웹뷰/새 창/외부 navigation은 거부한다. 실제 로그인은 renderer가 아닌 기존 Playwright backend에서 수행한다.

## 예약·트레이·종료

기존 `HS-LMS-Notifier` Windows Task를 읽기 전용으로 조회한다. ACTIVE면 앱 자체 30분 타이머를 억제한다(다른 프로젝트의 동일 이름 작업도 보수적으로 억제). UNKNOWN이어도 중복 실행 방지를 위해 자동 실행을 보류한다. 작업 삭제/disable/재등록을 GUI가 하지 않는다. 자동 확인 토글은 GUI 내부 타이머만 제어하며 기존 Task는 별개라고 화면에 명시한다.

ACTIVE가 아닌 기존 작업 또는 작업 없음 + 설정 완료 + 자동 확인 ON이면 앱이 켜져 있는 동안 30분 간격으로 실행한다. 로그 보관은 기본 30일(7~365일 설정); 오래된 `monitor-날짜.jsonl`/`scheduler-날짜.log` 정규 파일만 삭제한다. DB/알림 중복 키/incident/JSON/원본 과거 scheduler.log/하위 폴더는 삭제하지 않는다.

X는 트레이로 숨기며 최초 한 번 안내한다. 메뉴는 상태/지금 확인/창 열기/설정/종료다. 종료는 타이머 중지→진행 중 실행 Abort→browser/context 정리→DB close→잠금 해제→앱 종료 순서다. 이미 전송 중인 Discord 요청은 15초 제한 안에 마무리하고 이후 요청은 보내지 않는다. 강제 OS 종료·전원 차단의 완전한 정리까지 보장하지 않는다.

창에서 Ctrl+Q도 같은 정상 종료 경로를 사용한다. 닫기/종료를 혼동하지 않도록 설정 화면에 표시한다.

## 검증과 남은 작업

`npm run typecheck`, `npm test`, `npm run verify:e2e`, `npm run gui:test`, `npm audit`를 실행한다. GUI 테스트는 독립 임시 userData/합성 계정/합성 Discord를 사용한다. 실제 사용자 보안 저장소에 쓰지 않는다. 별도 테스트 entry는 운영 main에서 import하지 않는다. 실제 계정의 GUI 검증 결과는 PROJECT_STATE에 기록한다.

향후: Setup.exe/서명/auto-start 정책/버전 업데이트/공개 배포 검토, Git 과거 개인정보 처리, 다른 학생의 동의된 beta 환경 검증. 현재 새 학생에게 배포 준비가 끝났다고 주장하지 않는다.

참고: [Electron 보안](https://www.electronjs.org/docs/latest/tutorial/security), [Context bridge](https://www.electronjs.org/docs/latest/api/context-bridge), [ESM와 preload](https://www.electronjs.org/docs/latest/tutorial/esm), [Node SQLite backup](https://nodejs.org/api/sqlite.html).

Windows 경로 근거: [MSIX AppData 가상화](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes), [디렉터리 핸들](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory).
