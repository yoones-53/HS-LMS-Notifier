# 해야 할 일과 마감 알림 설정

## 판별과 표시

- 과제는 기존 `submitted` 상태를 재사용한다. LMS 목록의 `제출`은 완료/숨김, `미제출`은 PENDING, 나머지와 누락은 UNKNOWN이다.
- 영상의 명시적 `completed=false`만 미완료로 집계한다. 현재 실제 parser는 completed=null이다. `출석완료`는 attendanceConfirmed=true로, 기존 마감 알림과 동일하게 Todo에서 제외하되 전체 시청 완료로 해석하지 않는다. 나머지는 UNKNOWN이며 미수강 숫자에 넣지 않는다.
- 공통 `model/task-state.ts`를 Todo/기존 초기 요약/D-Day detector가 사용한다. 기존 초기 요약과 알림 의미는 바꾸지 않는다. 특히 기존 Discord 마감 알림은 UNKNOWN이라도 완료로 추측해 제외하지 않는다.
- `summary/todo.ts`는 브라우저/DB/Discord와 독립된 계산·runtime schema다. 기존 `daysUntil`을 사용해 Asia/Seoul 날짜 기준 D-Day/D-N/D+N을 계산한다. 기한 지난 항목도 표시하며 제출 가능 여부는 단정하지 않는다.
- 실제 dueAt의 시간 정밀도를 유지한다. 날짜만 있는 ISO 입력은 날짜만 표시한다. 현재 crawler의 시간 없는 원문은 여전히 null이므로 기한 확인 필요로 표시하며 임의 시각을 보완하지 않는다.
- 기한, 유형, 과목명, 제목, 고유 key 순으로 안정 정렬한다. 기한 없는 항목은 마지막. 가장 가까운 마감은 확인된 미완료 항목 중 오늘 이후 날짜이며 UNKNOWN은 제외한다.

## 데이터와 IPC

기존 getStatus에 검증된 Todo DTO를 추가했다. Main이 read-only SQLite transaction에서 최근 sync와 같은 last_seen_at인 과목/항목만 읽는다. 과거 학기/삭제된 목록/실패한 수집 범위의 보존 데이터를 현재 할 일로 오인하지 않는다. DB 행은 삭제하지 않는다. 대응되는 완료 monitor와 최근 결과를 확인하여 진행 중/부분 실패/미수집을 구분한다. 부분 실패에는 빈 목록의 정상 완료 문구를 표시하지 않는다.

Renderer는 DB에 직접 접근하지 않고 Todo schema를 다시 검증한다. 손상된 응답은 안전한 안내로 표시한다. 새 범용 IPC/SQL/파일 API는 없다. DB schema4, baseline, notification_history, sync_history, incident, initial summary SENT는 유지한다.

## 설정과 알림

기존 userData/state/settings.json에 `deadlineNotifications: {d7,d3,d1,d0}`를 추가했다. 구버전 파일에 해당 필드가 없을 때만 전체 true로 해석한다. 잘못된 타입/손상 파일은 자동 초기화하지 않는다. 기존 고정 settings IPC와 atomic write를 재사용하고 저장 성공 후 메모리 값을 갱신한다.

공통 `runtime/run-once.ts`가 매 실행 시작 시 설정을 읽으므로 GUI/CLI/기존 Windows 작업 스케줄러에 동일 적용된다. 기본 주기와 실행 잠금은 그대로다. `notifyDeadlines`는 OFF 시점만 발송 전 제외한다. Todo/크롤링/DB에는 영향을 주지 않는다. 기존 sendOnce key와 이력을 유지하므로 SENT 재발송은 없으며, 현재 날짜에서만 reminder를 만들므로 과거 OFF 날짜를 소급 발송하지 않는다.

## 검사

`npm run typecheck`, `npm test`, `npm run verify:e2e`, `npm run gui:test`, `npm audit`.
추가 Todo 테스트는 상태/누락/정렬/날짜 정밀도/한국 자정/손상 payload/이전 설정/네 가지 OFF/독립 ON/중복·소급 억제/현재 수집 범위/이력 보존을 포함한다. 실제 Electron 합성 검사는 Todo 목록·숫자·UNKNOWN·빈 상태·네 체크박스 저장/재로드·OFF와 목록 독립·잘못된 응답을 검증한다. 실제 LMS 검증 기록은 PROJECT_STATE.md 최신 섹션을 참고한다.
