# 실행 상태와 오류 안내

## 결과 읽기

`npm run check`는 전체 결과와 함께 `LMS collection`, `Database`, `Discord`를 각각 표시한다. 예를 들어 수집과 저장이 성공하고 Webhook만 실패하면 `LMS collection: SUCCESS / Database: SUCCESS / Discord: FAILED`, 전체 `PARTIAL / DISCORD_NOTIFICATION_FAILED`다. 알림 실패를 수집 실패로 오해하지 않는다.

| 상태 / 상세 코드 | 의미 / 조치 |
| --- | --- |
| SUCCESS | 필요한 수집·저장·알림 처리 완료, 신규/변경 이벤트 없음 |
| SUCCESS_WITH_CHANGES | 같은 성공 조건 + 이번 동기화의 신규/변경 이벤트 있음. 최초 요약·D-Day·오류 알림만 보낸 경우는 이 상태가 아님 |
| PARTIAL / COURSE_PARTIAL_FAILURE | 일부 과목/영역만 실패. 과목명과 NOTICE/MATERIAL/ASSIGNMENT/ONLINE_LECTURE 등의 영역, 상세 오류, 조치를 확인 |
| PARTIAL / DISCORD_NOTIFICATION_FAILED | LMS와 DB 결과는 따로 확인. Webhook/전송 이력 확인 필요 |
| CREDENTIALS_NOT_CONFIGURED / AUTO_LOGIN_FAILED | `npm run credentials:setup`으로 로컬 로그인 정보를 등록/변경 |
| AUTO_LOGIN_REQUIRES_USER | 추가 사용자 인증 필요. CAPTCHA/2FA를 우회하지 않음 |
| AUTH_EXPIRED_DURING_CRAWL | 수집 중 만료. 이번 실행을 중단하고 다음 예약에서 새 인증 |
| NETWORK_ERROR / LMS_TIMEOUT | 연결 실패 / 응답 시간 초과. 다음 예약에서 다시 확인 |
| LMS_STRUCTURE_CHANGED | 실제 관찰된 페이지 구조와 불일치. 구조 재조사/업데이트 필요 |
| DATABASE_ERROR | SQLite 읽기/저장 실패. DB를 지우지 말고 권한/디스크 확인 |
| SCHEDULER_LOCKED | 다른 실행 중이라 건너뜀. 중복 브라우저를 띄우지 않음 |
| INITIALIZATION_ERROR | 설정/브라우저/실행 잠금/로그 등 실행 준비 점검 필요 |
| UNKNOWN_ERROR | 분류되지 않은 오류. 비밀 보호를 위해 원시 메시지/stack을 노출하지 않음 |

부분 수집은 성공한 범위만 기존 동기화 로직에 전달한다. 메뉴 미제공(`UNAVAILABLE`)은 오류가 아니다. 모든 과목에 접근하지 못한 경우에는 PARTIAL이 아닌 실패로 처리한다. 인증 실패는 남은 과목을 계속 요청하지 않는다. 성공한 과목 수는 모든 제공 메뉴를 정상 처리한 과목 수이며, 중도 인증 만료 시 미처리 과목은 성공/실패 수에 억지로 포함하지 않는다.

## 공통 모델과 표시 분리

- `src/status/model.ts`: `RunResult`, `RunIssue`, 코드별 고정 한국어 안내, exit code. GUI에서 재사용 가능.
- `RunResult`: status(전체 판정), code(대표 원인), title/reason/action, recoverable, occurredAt(UTC ISO), exitCode, affectedScopes, errors, warnings. 모니터 결과에는 수집/DB/Discord 개별 상태와 건수도 포함된다.
- `RunIssue`: scope, errorCode, safeReason, action, recoverable, 필요 시 courseId/정제한 courseName. courseId는 강좌/분반 ID이며 로그인 ID가 아니다.
- `src/status/presentation.ts`: 콘솔 렌더러. 수집/오류 판별 로직을 포함하지 않는다.
- `src/status/output.ts`: allowlist로 정제한 최근 결과 파일. 원시 Error나 임의 객체를 덤프하지 않는다.
- recoverable은 현재 오류들이 다음 예약에서 자동으로 해결될 가능성이 있는지 나타낸다. 보장이나 즉시 재시도 지시는 아니다. 구조 변경/자격증명/DB/불명확한 Discord 전송은 사용자 확인 필요로 표시한다.
- 예전 `DB_ERROR`, `DISCORD_FAILED`는 새 실행에서 각각 `DATABASE_ERROR`, `DISCORD_NOTIFICATION_FAILED`로 바뀐다. 기존 DB/로그 이력의 옛 코드들은 수정하지 않는다.

## Discord 오류 알림

기존 `sendOnce`와 `notification_history`를 사용한다. DB 스키마 변경 없이 `monitor_state`의 `status:incidents`, `status:last-error`, `status:last-recovery`에 안전한 메타데이터만 추가한다. baseline·기존 알림·동기화 이력은 삭제/초기화하지 않는다.

- 로그인 정보 미등록/자동 로그인 실패/추가 인증/수집 중 인증 만료/구조 변경: 최초 발생 시 알림 대상.
- NETWORK_ERROR/LMS_TIMEOUT/UNKNOWN_ERROR/DB 오류: 같은 코드·과목·영역에서 **3회 관찰** 후 알림 대상. 이후 **최소 6시간** 간격. 관찰하지 못한 영역의 상태를 성공으로 추측하지 않는다.
- 사용자 행동이 필요한 인증/구조 오류는 같은 사건에서 1회만 전송. 해당 영역을 실제로 다시 확인해 정상일 때 사건 종료. 나중에 재발하면 새 사건으로 구분한다.
- 오류 알림은 실행당 최대 1건. 여러 문제는 결과/로그에는 모두 기록하고, 아직 보내지 못한 오류는 이후 예약에서 처리한다. 즉시 조치 대상이 일시 오류보다 우선한다.
- Webhook 미설정/전송 보류/불명확 상태일 때 별도의 Discord 오류 알림을 재귀적으로 보내지 않는다.
- 명확한 거절은 `retry_after` 이후 예약에서 재시도 가능. UNKNOWN/SENDING은 중복 방지를 위해 같은 사건/알림을 무조건 재전송하지 않는다.
- DB 자체에 접근할 수 없다면 중복 방지 이력도 저장할 수 없으므로 Discord 전달을 보장하지 못한다. 콘솔/안전한 로컬 로그를 우선 확인한다.
- 복구 Discord 알림은 기본 OFF. `RECOVERY previous=... current=SUCCESS`는 **해당 영역**이 복구됐다는 뜻이며 다른 영역 오류가 남아 있으면 전체 결과는 여전히 PARTIAL일 수 있다.

## 로그와 스케줄러

- `logs/monitor-YYYY-MM-DD.jsonl`: RUN_FINISH의 result에 공통 모델, 최상위 status/statusCode/reason/recoverable/exitCode/errors. 과목 실패 이벤트에도 안전한 issue 구조가 들어간다.
- `logs/latest-run.json`: 최근 완료된 전체 실행 결과. 잠금으로 건너뛴 실행은 이를 덮어쓰지 않는다.
- `logs/latest-scheduler-run.json`: 예약 실행 결과와 이번 실행을 식별하는 비밀이 아닌 UUID. wrapper는 UUID가 일치하는 결과만 이번 결과로 사용한다. 이전 성공 결과를 재사용해 성공으로 오판하지 않는다.
- `logs/scheduler.log`: 새 기록은 구조화된 JSON 한 줄이며 status/statusCode/reason/action/recoverable/exitCode/errors를 포함한다. 과거의 텍스트 기록은 그대로 보존한다.
- `npm run schedule:status`: OS 작업 상태/최근 실행/다음 실행, 해석된 OS 결과, 최근 monitor 상태/사유/조치, 최근 예약 monitor 상태를 별도 표시한다. monitor 시각은 UTC ISO(`Z`), 예약 시각은 Windows 로컬 시간이다.
- 확인된 OS 값만 해석: 0 → SUCCESS, 267009(0x41301) → TASK_RUNNING. 다른 값은 UNKNOWN_TASK_RESULT(원본 숫자). Running 상태와 마지막 종료 결과는 서로 다른 정보이며 둘 다 표시한다.
- 앱 exit code: 0 정상/변경 있음/잠금 건너뜀, 1 부분/일반 실패, 2 인증 관련 실패. OS의 0만으로 실제 수집이 수행됐다고 단정하지 말고 Last scheduled monitor를 확인한다.
- 30분/IgnoreNew/Interactive/Limited/20분 제한/작업 진입점은 유지한다. 로그 저장조차 불가능하거나 프로세스가 강제로 종료되면 완료 기록이 없을 수 있다. 그 경우 최근 기록의 시각과 OS 상태를 함께 확인해야 한다.

로그에는 비밀번호/쿠키/인증 URL/Webhook/원시 예외/DOM을 저장하지 않는다. 과목명은 제한된 표시 텍스트만 허용한다. 화면 캡처·trace는 이 기능에서 생성하지 않는다.

## 검증

```powershell
npm run typecheck
npm test
node --import tsx scripts/status-fixtures.ts
npm run check
npm run schedule:status
```

fixture 명령은 메모리 DB와 합성 source/transport만 사용해 SUCCESS/PARTIAL/AUTO_LOGIN_FAILED/NETWORK_ERROR/Discord 실패의 실제 콘솔 형태를 보여준다. 실제 LMS·Discord 요청, 실제 DB 변경, 자격증명 사용이 없다. 잘못된 로그인 정보나 CAPTCHA 테스트는 실제 계정에 하지 않는다. `verify:e2e` npm 명령은 현재 없으며 전체 테스트와 실제 check/예약 결과로 검증한다.
