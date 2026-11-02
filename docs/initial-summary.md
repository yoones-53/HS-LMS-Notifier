# 최초 연동 요약

## 동작과 저장

자동 로그인 성공 → 현재 모든 과목/메뉴 확인 → 기존 sync 트랜잭션 성공 → 요약 → 일반 변경/D-Day 알림 순서다. 과목/메뉴 오류가 하나라도 있으면 INCOMPLETE_SYNC로 요약을 건너뛰고 다음 정상 실행을 기다린다. 메뉴 자체가 없는 UNAVAILABLE은 오류가 아니다. 집계는 이번 실행의 성공 snapshot만 사용하며 실패한 과목의 과거 DB 항목을 합치지 않는다.

INITIAL_SETUP_SUMMARY_SENT는 기존 notification_history의 `notification_key='INITIAL_SETUP_SUMMARY' AND status='SENT'`라는 의미다. 새 테이블/스키마 migration/특정 사용자 플래그는 없다. 이미 baseline이 있는 설치도 이 기록이 없으면 다음 정상 동기화에서 요약을 받는다. DB를 유지하면 성공 확인 이후 다시 보내지 않는다.

BASELINE/NEW를 구분하는 store.sync와 change_events 생성은 그대로다. 요약은 change_events에 들어가지 않고 `change:...`, `deadline:...`와도 다른 키를 사용한다. 새 DB의 첫 실행은 기존 항목 baseline과 D-Day 억제를 유지하고 요약 한 건만 전송한다. 기존 설치에 실제 신규/변경/마감 대상이 있다면 그 알림은 별도로 유지한다.

## 데이터와 GUI 재사용

`src/summary/initial-setup.ts`의 buildInitialSetupSummary는 네트워크·SQLite·Discord에 독립적인 순수 함수다. 인증 상태, 과목/유형별 개수, 확인된 미제출·미완료 개수와 미확인 개수, 출석완료 표시 개수, 가까운 마감/추가 건수를 InitialSetupSummary 객체로 반환한다. `src/notification/initial-summary.ts`는 이 객체를 Embed로 표시하고 기존 sendOnce/transport로 보낸다.

- submitted=false만 미제출로 센다. true는 제외하며 null/누락이 섞이면 총 미제출 개수는 null이다. 확인한 건수와 미확인 건수를 구분해 표시한다.
- completed=false만 미완료 시청으로 센다. true는 제외하고 null/누락을 false로 바꾸지 않는다. 현재 parser는 completed=null을 반환하므로 미완료 시청 개수는 확인 불가다.
- 출석완료는 별도 표시다. 출석완료만으로 시청 완료나 미완료 0을 추론하지 않는다.
- OnlineLecture.completed 계약 타입만 향후 확인된 값을 받을 수 있게 boolean|null로 확장했다. 현재 DOM/selector/파싱 결과는 변경하지 않았다. 명시적 completed=true는 기존 D-Day에서도 제외하는 안전 조건만 추가했다.
- 가까운 마감은 daysUntil의 한국 달력 날짜 기준 오늘~D-7이며, 아직 지나지 않은 마감과 명확한 미제출/시청 미완료만 포함한다. 출석완료 영상은 제외한다. D-Day 일반 알림의 7/3/1/0 기준은 그대로다.
- 가까운 시각순 최대 5건과 '외 N개'를 표시한다. 미확인 상태/날짜를 억지로 넣지 않으며, 제외 때문에 빈 목록이어도 전체 마감이 없다고 단정하지 않는 안내를 붙인다.
- 기존 crawler가 제외하는 ID 없는 예정 영상은 집계에서 제외하고 footer에 건수를 설명한다. 동적 제목/과목명은 길이 제한 및 Markdown escape, 멘션 비활성화를 적용한다.

## 실패와 중복 방지

한 실행에서 요약 전송은 최대 1회 시도한다. 기존 sendOnce의 고유 키/트랜잭션과 앱 실행 잠금을 재사용한다. Discord wait=true 응답에서 메시지 생성 ID가 확인된 경우만 SENT로 저장한다.

- 명확한 거절(4xx/429)은 RETRY: SENT 기록 없이 retry_after가 지난 다음 정상 실행에서 최신 snapshot으로 재시도한다. 한 실행 내 반복은 없다. rate limit 중에는 일반 알림도 보류하고 기존 outbox를 보존한다.
- 응답 유실/timeout/5xx 등은 UNKNOWN, 전송 중 프로세스 종료는 SENDING: 이미 도착했을 수 있어 성공으로 표시하지도 무조건 재전송하지도 않는다. DELIVERY_UNCONFIRMED로 남기고 수신 확인이 필요하다. 이력을 임의로 삭제하지 않는다.
- 정상 응답에서 확인된 요약은 1회만 보낸다. 외부 응답 유실·DB 저장 사이의 장애까지 포함한 완벽한 exactly-once와 무조건 재시도를 동시에 보장할 수 없어 기존 중복 방지 정책을 유지한다.
- 실패 후 재실행에서도 기존 항목을 NEW로 바꾸지 않는다. 최초 요약은 일반 신규 이벤트와 별개다.

로그: INITIAL_SUMMARY CREATED/SENT, SKIPPED ALREADY_SENT/INCOMPLETE_SYNC/NOT_AUTO_LOGIN, FAILED DISCORD_SEND_FAILED/RETRY_AFTER/DELIVERY_UNCONFIRMED. 제목·본문·Webhook·자격증명은 로그에 남기지 않는다. 콘솔과 monitor_runs summary_json에 initialSummary 결과가 추가된다.

## 검증

타입 검사와 전체 67개 테스트 통과(기존55+신규12). 상태 미확인/완료 제외, 한국 날짜·D-8·기한 초과·상위5개, Embed 길이/멘션, 첫 baseline 요약1/NEW0, 기존 DB 보존, 실패/보류/다음 성공, 불명확 전송, 부분 실패·인증/DB 오류, 일반 NEW 중복 방지, DB 재개 후 중복 방지를 검증했다. 기존 D-Day/fresh login 테스트의 원래 알림 검증도 유지했다.

실제 계정에서 첫 check의 자동 로그인, 현재 학기 수집, baseline 저장, 최초 요약 전송과 SUCCESS 결과를 확인했다. 제출·시청 상태가 확인되지 않는 항목은 요약에서 임의로 완료 또는 미완료로 판단하지 않았다. Discord transport의 성공 응답으로 전송을 확인했다.

두 번째 check에서는 동일 데이터의 신규/변경/일반 전송이 없고 최초 요약이 ALREADY_SENT로 건너뛰는 것을 확인했다. 기존 항목, baseline, notification history 및 sync history의 해시는 보존됐으며 정상 실행 기록만 추가됐다. 계정별 수집 건수와 이력 행 수는 문서에 기록하지 않는다.

두 실행 모두 브라우저 정상 종료, 두 번째 소유 프로세스 트리의 잔존0 확인. 기존 Windows 예약 정의 PT30M/IgnoreNew/Interactive/최대20분 및 실행 경로를 유지했다. 08:15:59 예약을 실행 잠금 상태에서 실제 시작해 SCHEDULER_LOCKED/종료0/Ready와 다음 예약08:21:58 유지 확인 후 테스트 잠금을 해제했다. 추가 LMS 요청 없이 예약 경로·중복 차단을 검증했다. 타입 검사/67개 전체 테스트를 재실행해 모두 통과했다. verify:e2e npm script는 없으며 실제 check 2회가 end-to-end 검사다.

Discord 클라이언트 화면의 수신 개수는 사용자에게 선택적으로 확인 요청했으며, 에이전트의 전송 검증 근거는 서버 생성 성공 응답과 단일 SENT/attempts1 기록이다.
