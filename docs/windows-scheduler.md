# Windows 자동 실행

설치본은 Windows Task Scheduler를 자동 확인의 유일한 production 방식으로 사용한다. 작업은 설치된 `HS-LMS-Notifier.exe --scheduled-check`만 실행하며 Node.js, npm 또는 개발 프로젝트 경로에 의존하지 않는다. GUI를 완전히 종료해도 30분 주기 확인은 계속된다.

기존 개발용 `HS-LMS-Notifier` 작업을 발견한 설치본은 자동으로 덮어쓰거나 삭제하지 않는다. 설정 화면의 **기존 개발용 예약 작업 전환**을 사용한 경우에만 기존 작업을 비활성화하고 `HS-LMS-Notifier Background` 작업을 만든다. 제거 프로그램은 자신이 만든 production 작업만 삭제하며, 기존 개발용 작업과 AppData 데이터·Credential Manager 정보는 보존한다.

자동 로그인 전환: 예약 정의는 그대로이며 같은 진입점에서 매 실행 Windows Credential Manager를 읽어 새 context로 로그인한다. 같은 Windows 사용자로 `npm run credentials:setup` 등록이 필요하다. 기존 로그인 프로필 유지에 의존하지 않는다. 기존 예약의 실제 headless 자동 로그인·전체 수집 SUCCESS, 정상 Task 결과와 실행 후 Node·Chromium·도우미 프로세스 정리를 확인했다. 현재 예약 시각은 schedule:status로 다시 조회한다.

`npm run schedule:install`은 현재 프로젝트의 `HS-LMS-Notifier` 작업을 등록한다. 같은 이름의 다른 프로젝트 작업은 덮어쓰지 않는다. 다른 폴더로 옮기면 기존 작업 경로를 먼저 확인해야 한다.

기본 30분 간격이며 등록 후 첫 예약은 30분 뒤다. `npm run schedule:run`으로 기다리지 않고 같은 예약 작업을 한 번 실행할 수 있다. `schedule:status`는 마지막 결과/다음 실행 시각, `schedule:disable`는 예약 중지, `schedule:enable`은 재개다. 중지는 진행 중인 작업을 강제로 종료하지 않는다.

## 실행 조건

- 이 PC가 켜져 있고 현재 Windows 사용자로 로그인되어 있어야 한다. 화면 잠금은 가능하지만 종료/절전/로그아웃 중의 정확한 시각 실행은 보장하지 않는다. 다시 실행 가능해지면 누락 예약을 처리하고 주기를 유지한다.
- Windows 비밀번호를 저장하지 않는 Interactive/Limited 권한이다. 관리자 권한 상승이나 실행 정책 변경을 자동으로 하지 않는다.
- PowerShell 창을 숨기고 `HEADLESS=true`를 전달한다. `npm run login`은 항상 별도 Chromium 창을 열어 직접 로그인한다.
- 오류가 발생해도 작업을 삭제/비활성화하지 않는다. 다음 30분 예약에서 다시 실행한다. 한 실행은 스케줄러에서 최대 20분으로 제한한다.
- 스케줄러 IgnoreNew와 모든 CLI가 공유하는 별도 SQLite 실행 잠금으로 중복을 막는다. 잠금은 운영체제가 프로세스 종료 시 해제하므로 오래된 PID/잠금 파일을 임의로 삭제하지 않는다.
- `logs/monitor-YYYY-MM-DD.jsonl`과 `logs/scheduler-YYYY-MM-DD.log`에 안전한 구조화 상태/원인/조치/복구 가능 여부/exit code를 남긴다. 원시 콘솔/네트워크 transcript는 저장하지 않는다. `latest-run.json`, `latest-scheduler-run.json`은 최근 완료/예약 결과를 보여준다. GUI 이전 후 검증된 runtime-location의 AppData 로그 폴더를 사용한다. 기존 scheduler.log는 보존한다.
- 종료 코드 0: 정상 또는 중복 실행 건너뜀, 1: 일부/일반 오류, 2: 로그인 실패·추가 인증·미등록·수집 중 만료. 실제 전체 상태는 monitor_runs와 RESULT/RUN_FINISH 로그로 확인한다. 잠금 건너뜀은 SCHEDULER_LOCKED로 남는다. schedule:status는 0/SUCCESS와 267009/TASK_RUNNING만 해석하고 모르는 값은 원본 숫자로 표시한다.

`schedule:status`는 최근 수동 monitor와 최근 예약 monitor를 별도로 표시한다. wrapper는 실행별 UUID로 해당 Node 실행의 결과인지 확인한다. 이전 성공 파일을 잘못 재사용하지 않는다. 상태 모델/오류 알림 cooldown과 자세한 대응은 `docs/status-reporting.md`를 참고한다. 작업 재등록은 필요하지 않다.

AUTO_LOGIN_FAILED/CREDENTIALS_NOT_CONFIGURED는 `npm run credentials:setup`으로 복구한다. 수집 중 인증 만료는 AUTH_EXPIRED_DURING_CRAWL이며 한 실행 안에서 재로그인하지 않는다. 중복 실행은 SCHEDULER_LOCKED다. Discord 자체가 고장났다면 알림이 도착하지 않을 수 있으므로 로그도 확인한다.

## 근거

GUI 수동 확인과 예약 실행은 동일한 SQLite 실행 잠금을 공유한다. 따라서 이미 실행 중인 확인과 겹치면 예약 실행은 안전하게 건너뛰며, 별도 Chromium 창이나 중복 Discord 발송을 만들지 않는다. 예약 전용 실행은 창·트레이를 만들지 않고 브라우저/context를 정상 종료한다. 자세한 이전/백업 조건은 [GUI 구조](gui-architecture.md)를 참고한다.

반복 기간을 생략하면 계속 반복한다는 [Microsoft Task Scheduler 문서](https://learn.microsoft.com/en-us/windows/win32/taskschd/repetitionpattern-duration), [IgnoreNew 설정 문서](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset), [사용자 권한 설정 문서](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)를 기준으로 구성했다. 스크립트는 프로젝트의 정상 실행 정책을 사용하며 보안 정책을 우회하지 않는다.
