# Windows 설치 프로그램 패키징

## 방식과 빌드

Windows x64 설치 프로그램은 `electron-builder`의 NSIS target으로 만든다. 현재 버전은 최종 공개 릴리스가 아닌 `0.x` 개발 검증판이며, 빌드 한 번으로 GUI 번들·Chromium 준비·NSIS 생성·불필요한 진단 산출물 정리까지 수행한다.

```powershell
npm ci
npm run dist:win
```

결과는 `release/HS-LMS-Notifier-Setup-0.1.0.exe`와 검사·디버깅용 `release/win-unpacked/`에 생성된다. `release/`와 중간 browser cache는 Git에서 제외하며 설치 파일을 저장소 커밋에 넣지 않는다.

## Production allowlist

app.asar에는 다음만 포함한다.

- `dist/gui/`의 main, preload, renderer와 정적 CSS/HTML
- production dependency인 `dotenv`, `playwright-core`, `zod`
- package metadata

Credential Manager와 예약 상태 확인에 필요한 고정 PowerShell/C# helper만 `resources/runtime-scripts/`에 별도 포함한다. `.env`, DB, 로그, browser profile, 테스트 fixture, 소스 트리, work/outputs, screenshot, trace, HAR, 사용자 설정은 포함하지 않는다. 빌드 종료 시 절대경로가 생길 수 있는 builder 진단 파일과 사용하지 않는 update metadata를 제거한다.

## Chromium

`dist:win`은 현재 고정된 Playwright 버전이 요구하는 Chromium을 전용 build cache에 준비한다. 실행에 필요한 Chromium 디렉터리만 `resources/playwright/`로 복사하고, 상대 실행 경로만 적힌 manifest를 함께 넣는다. 설치본은 manifest가 resources 경계를 벗어나지 않는지와 실행 파일 존재 여부를 검사한 후 이 브라우저를 명시적으로 실행한다.

`playwright-core`는 injected script를 설치본에서도 정상적으로 읽도록 `app.asar.unpacked`에 둔다. 최종 사용자는 Node.js나 `npm run browser:install`을 실행할 필요가 없다.

## 사용자 데이터와 비밀값

설치본의 운영 데이터 루트는 `%APPDATA%\HS-LMS-Notifier`다.

- `data/lms.sqlite`: baseline, items, notification history, sync/incident/initial-summary 이력
- `logs/`: 정제된 실행 로그와 최근 결과
- `state/settings.json`: 비밀값이 없는 GUI 설정
- `data/process-lock.sqlite`: 중복 실행 방지 lock

설치 폴더와 app.asar에는 사용자 데이터를 쓰지 않는다. 기존 GUI migration을 완료한 사용자는 같은 AppData DB를 검증 후 그대로 재사용한다. 설치 프로그램은 임의의 개발 폴더나 다른 Windows 사용자의 데이터를 탐색·가져오지 않는다.

LMS 로그인 정보와 Discord Webhook은 기존과 동일하게 현재 Windows 사용자의 Credential Manager target에만 저장한다. renderer에 원문을 반환하지 않으며 installer와 app.asar에도 포함하지 않는다.

## 설치·예약·제거 정책

NSIS는 현재 Windows 사용자 범위로 설치하며 설치 위치를 선택할 수 있다. 시작 메뉴와 바탕 화면 바로가기를 만들 수 있다. 앱은 single-instance이고 X 버튼은 트레이로 숨기며, 완전 종료 시 진행 중인 monitor를 중단·정리하고 DB lock과 Playwright browser를 닫는다.

installer는 예약 작업을 자동 생성하지 않는다. 최초 설정 완료 후 GUI가 설치본 전용 `HS-LMS-Notifier Background` 작업을 등록하며, 이 작업은 설치된 실행 파일의 무창 `--scheduled-check`만 호출한다. 기존 `HS-LMS-Notifier` 개발용 작업은 자동으로 수정·삭제하지 않으며, 사용자가 GUI에서 명시적으로 전환할 때만 비활성화한다.

제거 시 프로그램 binary와 이 제품이 소유한 `HS-LMS-Notifier Background` 작업만 지운다. AppData DB/settings/logs, Credential Manager와 기존 개발용 작업은 보존한다. 재설치하면 같은 상태를 재사용하며 최초 연동 요약 SENT 기록도 초기화하지 않는다. 사용자 데이터 삭제는 이 installer의 기능이 아니며 향후 명시적인 사용자 선택으로만 추가한다.

## 서명과 남은 릴리스 작업

현재 산출물은 코드 서명되지 않은 개발용 installer다. 다운로드 출처와 Windows 평판에 따라 SmartScreen 경고가 나타날 수 있다. 경고를 숨기기 위한 임의 self-signed 인증서는 사용하지 않는다.

공개 배포 전에는 정식 `.ico`, 신뢰 가능한 code signing, 별도 깨끗한 Windows 사용자/PC 설치 시험, 다른 학생 계정 범위 검증, 과거 Git 이력 개인정보 정책을 완료해야 한다. 자동 업데이트와 GitHub Release 공개는 현재 범위에 포함하지 않는다.
