# 🔔 HS-LMS-Notifier

한신대학교 LMS의 공지, 강의자료, 과제, 온라인 강의와 마감 변경을 확인해 Discord로 알려주는 Windows 데스크톱 애플리케이션입니다.

한신대학교의 공식 프로그램이 아닌 개인 개발 프로젝트입니다. 현재 버전은 **v0.1.1 Beta**이며, 실제 사용 전 아래의 제한사항을 확인해 주세요.

## ✨ 주요 기능

### LMS 변경 알림

- 새 공지사항, 강의자료, 과제, 온라인 강의 알림
- 과제와 온라인 강의의 마감 변경 알림
- 최초 동기화에서는 기존 항목을 기준선으로 저장하여, 이전 게시물이 새 알림으로 한꺼번에 전송되지 않음

### 해야 할 일

- 확인된 미제출 과제와 미완료 온라인 강의
- 마감 기한과 D-Day
- 상태를 확정할 수 없는 항목

`UNKNOWN` 상태는 미제출 또는 미수강으로 추측하지 않고 별도 표시합니다.

```text
D-1 [과제]
ERD 설계 과제
10/09 23:59까지
```

### 마감 알림

마감 **7일 전, 3일 전, 1일 전, 당일** 알림을 지원합니다. 각 알림은 앱 설정에서 개별적으로 켜거나 끌 수 있습니다.

### 자동 로그인과 자동 확인

- LMS 로그인 정보는 Windows Credential Manager에 보관
- 실행마다 새 브라우저 context를 사용
- 비밀번호를 소스, SQLite DB, 로그에 저장하지 않음
- CAPTCHA 또는 추가 인증을 우회하지 않음
- Windows Task Scheduler로 기본 30분마다 확인
- 수동 확인과 예약 실행이 동시에 실행되지 않도록 보호

## 📥 다운로드

현재 버전은 **v0.1.1 Beta**입니다. Windows 설치 프로그램 `HS-LMS-Notifier-Setup-0.1.1.exe`는 GitHub Releases를 통해 제공할 예정입니다.

설치본에는 필요한 Chromium이 포함되므로 일반 사용자는 Node.js, npm, Git 또는 별도 Playwright 설치가 필요하지 않습니다.

현재 설치 프로그램은 코드 서명되지 않은 Beta 버전입니다. 다운로드 출처와 Windows 평판에 따라 SmartScreen 경고가 표시될 수 있습니다.

## 🚀 사용 방법

1. Setup.exe를 설치합니다.
2. 시작 메뉴에서 **한신 LMS 알리미**를 실행합니다.
3. LMS ID와 비밀번호를 등록하고 자동 로그인을 테스트합니다.
4. Discord Webhook을 등록하고 테스트 알림을 보냅니다.
5. 자동 확인을 활성화합니다.
6. Dashboard에서 알림 상태와 해야 할 일을 확인합니다.

## 🏠 Dashboard

Dashboard에서는 다음 정보를 한눈에 확인할 수 있습니다.

- LMS 연결 상태와 Discord 연결 상태
- 마지막 확인 및 다음 예약 확인 시간
- 미제출 과제, 확인된 미완료 강의, 상태 확인 필요 항목
- 가장 가까운 마감

**지금 확인** 버튼을 누르면 즉시 한 번 확인합니다.

## 🔔 Discord 알림

다음 알림을 지원합니다.

- 새 공지, 새 강의자료, 새 과제, 새 온라인 강의
- 마감 변경
- D-7, D-3, D-1, D-Day
- 오류 및 복구 상태
- 최초 연동 요약

같은 항목과 같은 종류의 알림은 중복 전송하지 않도록 기록합니다. 네트워크 장애처럼 전송 결과를 확정할 수 없는 경우에는 중복 방지를 우선하므로 재전송하지 않을 수 있습니다.

## 🛡️ 개인정보 및 보안

LMS 로그인 정보와 Discord Webhook은 비밀정보로 취급합니다.

- LMS ID와 비밀번호는 Windows Credential Manager에 저장하며 Git, 소스, SQLite DB, 로그, 설치 파일에는 저장하지 않습니다.
- Discord Webhook의 실제 URL은 저장소에 포함하지 않습니다.
- 사용자 데이터는 `%APPDATA%\HS-LMS-Notifier`에 저장됩니다. DB와 로그에는 개인 수강 정보가 포함될 수 있으므로 공유하지 마세요.
- Windows Credential Manager도 같은 Windows 사용자 권한으로 실행되는 악성 프로그램까지 완벽하게 막는 보안 경계는 아닙니다.

## 🚫 하지 않는 기능

이 프로그램은 LMS를 읽고 알림을 보내는 도구입니다. 다음 기능은 제공하지 않습니다.

- 과제 자동 제출
- 온라인 강의 자동 재생
- 출석 조작
- CAPTCHA 또는 추가 인증 우회
- LMS 데이터 수정

## ⚠️ 현재 제한사항

- 정확한 영상 시청률은 LMS가 제공하는 정보 범위에 의존합니다.
- 출석 인정과 전체 시청 완료는 같지 않을 수 있습니다.
- 확인하지 못한 다중 페이지 또는 목록 형태는 지원하지 않습니다.
- LMS 화면 구조가 변경되면 일부 기능이 영향을 받을 수 있습니다.
- 다른 Windows PC, 다른 Windows 사용자, 다양한 LMS 계정과 강의 구성에서의 검증을 진행 중입니다.
- 현재 설치 프로그램은 unsigned Beta입니다.

## 🧪 검증 상태

2026-10-08 기준 설치본 감사에서 다음을 확인했습니다.

| 항목 | 결과 |
| --- | --- |
| Unit tests | 134 / 134 PASS |
| E2E tests | 51 / 51 PASS |
| GUI tests | 19 / 19 PASS |
| TypeScript 검사 | PASS |
| production dependency audit | 0 vulnerabilities |
| Windows installer build | PASS |

Electron GUI, LMS 자동 로그인, 해야 할 일, Discord, D-Day, Windows Task Scheduler, 설치·제거·재설치, bundled Chromium, 비밀정보·개인정보 검사를 확인했습니다.

현재 상태는 **READY FOR BETA**입니다. 일반 공개 배포 전에는 다른 환경 검증과 코드 서명, 공개 Git 이력 정책 검토가 필요합니다.

## 🗑️ 제거

앱을 제거해도 기본적으로 `%APPDATA%\HS-LMS-Notifier`의 사용자 DB와 설정은 보존됩니다. Windows Credential Manager에 저장된 정보도 자동으로 삭제하지 않습니다.

재설치하면 기존 데이터를 다시 사용할 수 있습니다. 사용자 데이터를 삭제하려면 해당 폴더와 Credential Manager의 관련 정보를 직접 확인한 뒤 삭제하세요.

## 🧑‍💻 개발자

<details>
<summary>소스에서 실행 및 검사</summary>

### 요구사항

- Windows
- Node.js 24 LTS

### 소스에서 실행

```powershell
npm install
npm run gui:install
npm run browser:install
npm run gui:dev
```

### 검사

```powershell
npm run typecheck
npm test
npm run verify:e2e
npm run gui:test
```

### Windows installer 빌드

```powershell
npm ci
npm run dist:win
```

산출물은 `release/HS-LMS-Notifier-Setup-0.1.1.exe`에 생성됩니다. `release/`는 Git에 포함하지 않습니다.

### CLI

일반 사용자는 GUI 사용을 권장합니다. 개발 및 점검에는 다음 명령을 사용할 수 있습니다.

```powershell
npm run credentials:setup
npm run credentials:test
npm run check
npm run sync -- --all
npm run notify:test
```

</details>

## 📚 문서

- [GUI 구조](docs/gui-architecture.md)
- [해야 할 일과 마감 알림](docs/todo-dashboard.md)
- [Windows 자동 확인](docs/windows-scheduler.md)
- [Windows 패키징](docs/packaging.md)
- [자동 로그인](docs/auto-login.md)
- [상태 및 오류 안내](docs/status-reporting.md)
- [최초 연동 요약](docs/initial-summary.md)
- [보안 감사](docs/security-audit.md)

## 🛠️ 기술 스택

- TypeScript
- Node.js
- Electron
- Playwright
- SQLite
- Windows Credential Manager
- Windows Task Scheduler
- Discord Webhook

## 🐛 문제 제보

문제는 GitHub Issues로 제보해 주세요. 다음 정보는 Issue에 첨부하지 마세요.

- LMS ID 또는 비밀번호
- Discord Webhook URL
- `.env` 파일
- SQLite DB
- 원본 로그 전체
- Cookie, token 또는 개인 수강 정보

## 📌 프로젝트 상태

현재 버전은 **v0.1.0 Beta**입니다. 다음 항목을 추가로 검증할 예정입니다.

- 다른 Windows PC와 Windows 사용자
- 다양한 LMS 계정과 강의 구성
- 빈 학기와 추가 LMS 목록 형태
- SmartScreen 동작과 코드 서명

안정적인 v1.0.0을 향해 검증 범위를 넓히고 있습니다.

## License

License policy will be determined before the stable public release.
