# 최종 배포 전 감사

기준일: 2026-10-08 (Asia/Seoul). 대상은 `0.1.0` Windows x64 NSIS installer, `win-unpacked`, `app.asar`, bundled Chromium, 현재 설치본과 운영 userData다. 이 문서는 법률 자문이나 모든 Windows/LMS 환경의 보증이 아니다.

## 판정

**Readiness: READY FOR BETA**

안내된 소수 사용자에게 unsigned 개발 검증판으로 제공하는 것은 가능하다. 다만 아래 MEDIUM 항목 때문에 **READY FOR PUBLIC RELEASE는 아니다.** 설치형 Scheduler 정책은 구현·실제 검증했지만, 다른 Windows 사용자·PC·LMS 계정에서의 실제 검증은 아직 없다.

| 위험도 | 수 | 요약 |
| --- | ---: | --- |
| CRITICAL | 0 | 현재 installer/app/userData 검사에서 비밀값 유출, 임의 코드 실행 또는 데이터 파괴 경로를 확인하지 못함 |
| HIGH | 0 | 현재 범위에서 발견하지 못함 |
| MEDIUM | 3 | 다른 실제 환경 검증 부족, unsigned 공개 배포, 과거 Git 이력 개인정보 정책 |
| LOW | 2 | scheduler-only 실행 시 log retention 미적용 가능성, 앱 executable 브랜딩/메타데이터 |

## PASS

- Git working tree는 감사 시작 시 clean이었고 `main`과 `origin/main`은 일치했다. `release/`, `.env`, DB, logs, browser-data 및 work 산출물은 tracked되지 않는다.
- `npm ci` 직후 `npm run typecheck`, unit 134/134, E2E 51/51, GUI 19/19, `npm run dist:win`이 성공했다. lockfile과 독립적인 현재 node_modules 상태에만 의존하지 않는다.
- installer, `win-unpacked`, `app.asar`, `app.asar.unpacked`, bundled Chromium 및 현재 tracked 파일을 실제 Windows Credential Manager 값·운영 DB의 LMS 식별값·환경 경로와 대조하는 scan이 통과했다. 값 자체는 출력하지 않았다.
- 실제 installer binary와 unpacked build에 `.env`, SQLite, WAL/SHM, logs, browser profile, storageState, Cookie DB, HAR, screenshot, trace, video, work/output, 사용자 설정, Credential export 또는 개발 프로젝트 복사본이 포함되지 않았다. Playwright-core 내부 문서의 `storage-state`/`video-recording` 파일명은 실제 사용자 데이터나 기록 파일이 아니다.
- 현재 설치 디렉터리의 핵심 executable, `app.asar`, Chromium manifest 및 Credential helper hash가 새 `win-unpacked` build와 일치한다. runtime userData는 설치 폴더 밖 `%APPDATA%\HS-LMS-Notifier`에만 존재한다.
- 운영 DB `integrity_check=ok`, schema version 4, migration/settings runtime schema 검증이 통과했다. settings JSON에는 password/webhook/token/secret/credential 키가 없다. 기존 baseline, notification history 및 initial summary SENT 보존은 설치·제거·재설치 검증에서 확인했다.
- packaged `app.asar`에서 `nodeIntegration=false`, `contextIsolation=true`, sandbox/webSecurity 활성, production DevTools 비활성, navigation/popup 차단, 좁은 preload bridge가 확인됐다. renderer Node import 및 임의 IPC channel은 없다. 모든 renderer 요청은 sender/frame/URL 검증과 Zod request schema를 거친다.
- Credential은 고정 PowerShell helper와 pipe를 사용하며 ID/PW를 command line/environment/DB/JSON/renderer에 반환하지 않는다. Discord Webhook도 Credential Manager target에만 있고, packaged 앱은 legacy `.env`를 탐색하지 않는다. Webhook host/path, HTTPS, redirect 및 오류 노출 제한이 확인됐다.
- Fresh Playwright context는 bundled Chromium manifest의 상대 경로를 검증해 실행한다. persistent session, storageState, trace, HAR, video, screenshot은 생성하거나 동봉하지 않는다. 설치 앱 정상 종료 뒤 관련 앱/브라우저 프로세스가 남지 않은 상태를 확인했다.
- LMS 동작은 observed DOM 로그인과 목록 읽기 범위다. 자동 과제 제출, 영상 재생, 출석 조작, CAPTCHA/2FA 우회, LMS write API 사용은 없다. Todo는 `submitted=false`/명확한 미완료만 PENDING으로 보고 UNKNOWN을 별도 처리하며, D-Day는 공통 Asia/Seoul 계산을 재사용한다. D-7/D-3/D-1/D-Day OFF는 전송만 막고 기존 history·Todo를 바꾸지 않는 테스트가 통과했다.
- Electron/Chromium/Playwright-core 및 runtime npm dependency의 license/notice 파일은 package에 존재한다. 이 확인은 제3자 라이선스 의무에 대한 법률 판단은 아니다.

## 발견 사항

### M1 — 설치형 앱과 Scheduler의 실행 경계 (RESOLVED)

`scripts/register-task.ps1`의 개발용 작업은 source checkout과 Node 실행기를 가리키지만, 설치본은 별도의 product-owned `HS-LMS-Notifier Background` 작업을 사용한다. 이 작업은 설치된 실행 파일의 `--scheduled-check`만 실행하고 Node/npm/source 경로를 사용하지 않는다.

명시적 GUI 전환은 인식된 개발용 작업을 삭제하지 않고 비활성화한 뒤 production task를 등록한다. 재설치에서는 비활성 legacy 작업이 production task 생성을 막지 않는다. uninstaller는 정확한 ownership description이 일치하는 production task만 제거한다. GUI 수동 실행과 scheduled-check는 기존 SQLite 실행 잠금을 공유한다.

- 공개 배포 blocker: **해결됨**. 실제 installer 설치 → legacy 전환 → scheduled-check SUCCESS → 제거 → 재설치 경계를 확인했다.

### M2 — 다른 Windows 사용자·PC·LMS 계정 및 완전한 clean credential 흐름 미검증 (MEDIUM, 공개 배포 BLOCKER)

별도 temporary userData로 DB/settings 없는 Wizard와 FRESH DB를 검증했지만, Credential Manager는 Windows 사용자 단위이므로 실제 LMS/Discord 미등록 상태에서 Wizard → credential → Discord → baseline → initial summary 전체를 수행하지는 않았다. 다른 Windows 사용자, 깨끗한 PC, 다른 LMS 계정, 빈 학기/다른 목록 형태도 실제 검증하지 않았다.

- 공개 배포 blocker: **예**.
- 수정 방향: 별도 Windows 사용자 또는 VM에서 동의된 테스트 계정으로 end-to-end 설치/삭제/재설치와 scheduler 흐름을 검증한다. 다른 계정의 DOM을 추측해 selector를 추가하지 않는다.

### M3 — unsigned installer와 Windows 신뢰 UX (MEDIUM, 공개 배포 BLOCKER)

Setup.exe는 `NotSigned`이며 local build 파일에는 download zone/reputation 정보가 없다. Defender real-time protection이 켜진 환경에서 custom scan은 완료됐지만, 실제 다운로드 출처의 SmartScreen 평판과 다른 PC Defender 결과를 대신하지 않는다.

- 공개 배포 blocker: **예**. 비기술 일반 사용자 대상 공개 배포에서는 신뢰 가능한 code signing과 실제 배포 경로 검증이 필요하다.
- beta: 안내된 소수 사용자에게 unsigned 개발 검증판임을 명확히 알리는 조건으로 가능하다. self-signed 인증서를 신뢰 가능한 서명처럼 사용하지 않는다.

### M4 — 과거 Git 이력 개인정보 (MEDIUM, public source/repository BLOCKER; installer 자체와는 별개)

현재 tracked 파일과 installer에는 관련 개인정보가 없지만, 이전 Git history의 개인 경로/수강 정보/author metadata 문제는 `docs/security-audit.md`의 M1로 남아 있다. 이 항목은 현재 Setup.exe 안전성을 부정하지 않지만, 공개 source repository 또는 Release와 함께 기존 이력을 공개할 경우 blocker다.

- 수정 방향: 소유자가 private 유지, 승인된 history 정리, 또는 clean public repository 생성 중 하나를 결정한다. 이 감사에서는 history rewrite를 하지 않는다.

### L1 — log retention 적용 범위와 파일 크기 상한 (LOW)

`cleanOldLogs`는 기본 보관 일수를 적용하지만 GUI service 초기화/수동 확인 경로에서 호출된다. 현재 source scheduler wrapper만 계속 실행하는 경우 동일 정리의 실행을 보장하지 않으며, 일별 log의 max-size 상한도 없다. DB/baseline/dedup/incident history는 이 정리 대상이 아니다.

- 공개 배포 blocker: 아니오.
- 권장: scheduler/installed monitoring 공통 경로에서 안전한 dated-log retention을 실행하고 크기 정책·사용자 안내를 추가한다. 정상 동작 이력과 dedup key를 삭제하지 않는다.

### L2 — executable 브랜딩과 publisher metadata (LOW)

installer의 product/version은 `HS-LMS-Notifier 0.1.0`이지만, `signAndEditExecutable=false`와 정식 `.ico` 부재 때문에 app executable은 기본 Electron 아이콘 및 Electron file metadata를 유지하며 package author/publisher도 없다.

- 공개 배포 blocker: 아니오. 단 M3 code signing과 함께 해결하는 것이 권장된다.
- 권장: 정식 아이콘, publisher metadata와 서명 workflow를 준비하고 signing 없이도 필요한 resource metadata를 적용할 수 있는 electron-builder 설정을 별도 검증한다.

## Installer와 운영 데이터

- file: `release/HS-LMS-Notifier-Setup-0.1.0.exe`
- size: 약 248 MiB
- signature: unsigned (`NotSigned`)
- Chromium: 현재 고정된 Playwright 버전의 Chromium만 `resources/playwright`에 포함하고 상대 manifest 경로를 검증한다.
- userData: `%APPDATA%\HS-LMS-Notifier`; installer/app.asar/resources에는 runtime DB·logs·settings를 쓰지 않는다.
- install/uninstall/reinstall: 실제 lifecycle에서 binary는 제거되고 userData DB/settings, Credential Manager, 기존 task 및 notification/initial-summary state는 보존됐다. installer가 scheduler를 생성·갱신·삭제하지 않는 정책도 실제와 일치한다.
- clean user simulation: isolated userData의 Wizard/FRESH DB/운영 데이터 비접촉은 PASS. 단 M2처럼 Credential/Discord가 없는 다른 Windows 사용자 전체 흐름은 아직 미검증이다.

## Dependency와 third-party

- production dependency audit: 취약점 0건.
- full development dependency audit: moderate 8건, high/critical 0건. 영향 경로는 electron-builder의 build-time dependency이며 shipped app runtime allowlist에는 포함되지 않는다. 강제 downgrade를 적용하지 않았다.
- Electron/Chromium license files, Playwright-core NOTICE/LICENSE, dotenv/zod LICENSE가 package에 있다. 공개 배포 전에 전체 notice 제공 방식과 의무를 별도로 검토한다.

## 공개 배포 전 분류

### BLOCKER

- M2: 별도 Windows 사용자/PC 및 동의된 다른 LMS 계정의 실제 end-to-end 검증
- M3: 신뢰 가능한 code signing 및 실제 다운로드/SmartScreen 검증
- M4: public source repository를 만들 경우 과거 Git history 개인정보 공개 정책 결정

### RECOMMENDED

- L1: scheduler 경로 포함 log retention/max-size 정책
- L2: 정식 icon, executable publisher/version metadata
- 다른 해상도·접근성·빈 학기·다중 페이지 목록의 지원 범위 문서화와 검증
- 설치용 scheduler를 제공하기 전 PowerShell/Node 요구 없이 설치 앱만으로 동작하는 흐름 검증

### POST-RELEASE

- GitHub Release/auto-update 정책
- 장기 DB 용량·백업/내보내기 UX
- code signing certificate renewal과 release provenance 절차

## 감사 명령과 결과

- `npm ci` → PASS
- `npm run typecheck` → PASS
- `npm test` → 134/134 PASS
- `npm run verify:e2e` → 51/51 PASS
- `npm run gui:test` → 19/19 PASS
- `npm run dist:win` → PASS
- artifact secret/privacy/allowlist scan → PASS
- `npm audit --omit=dev` → 0 vulnerabilities
- `npm audit --audit-level=high` → high/critical 0, moderate 8 (build-only dependency chain)
- Defender custom scan → completed on the local build host; public download reputation is not verified

이 감사는 새 기능을 추가하거나 crawler/database/notification 동작을 변경하지 않았다.
