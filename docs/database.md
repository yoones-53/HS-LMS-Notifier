# SQLite 저장과 최초 동기화

Node.js 24의 `node:sqlite`를 사용한다. 현재 Node 24.16.0에서 실제 SQLite 3.53.0 메모리 DB 및 파일 DB를 검증했다. 추가 네이티브 패키지 빌드가 필요 없다. API 참고: [Node.js SQLite 공식 문서](https://nodejs.org/api/sqlite.html). 현재 문서는 최신 Node 버전도 포함하므로 이 프로젝트는 로컬 Node 24 타입과 실행 테스트에서 확인한 기본 API만 사용한다.

실제 DB: `data/lms.sqlite`. 전체 data 폴더와 SQLite WAL/SHM 파일은 Git 제외다. 로그인 정보, 쿠키, 비밀번호, Webhook은 DB에 저장하지 않는다.

| 테이블 | 역할 |
| --- | --- |
| courses | courseId+classNo 고유 키, 이름/학기/진입 URL |
| items | courseId+classNo+type+LMS itemId 고유 키, 원본 구조화 값, 내용 hash, version, 최초 BASELINE/NEW 상태 |
| scope_baselines | 과목/자료유형별 최초 정상 수집 완료 여부 |
| notification_history | 고유 키별 SENDING/SENT/RETRY/UNKNOWN, 전송 시도/확인 시각 |
| sync_history | 동기화 시각 및 BASELINE/NEW/UPDATED/SAME 건수 |
| change_events | 항목 버전별 의미 있는 변경과 전송 대기 이벤트 |
| monitor_runs | 통합 실행 시작/끝 및 SUCCESS/PARTIAL/AUTH_EXPIRED/FAILED |
| monitor_state | 로그인 만료 알림의 현재 에피소드 ID (인증정보 아님) |

처음 읽는 과목/유형의 항목은 BASELINE으로만 저장한다. 처음에 메뉴가 없거나 수집에 실패한 유형은 baseline을 완료했다고 표시하지 않는다. 이후 그 유형이 처음 성공해도 과거 게시물을 신규로 쏟아내지 않는다. 정상 빈 목록은 baseline 완료로 기록한다.

두 번째 수집부터 이전에 없던 고유 ID가 NEW다. 제목이 같아도 ID가 다르면 별개이고, 같은 ID의 값이 바뀌면 버전을 올려 UPDATED로 반환한다. hash는 JSON 키 순서를 정규화해 계산한다. 항목이 이번 목록에서 안 보인다는 이유만으로 삭제하지 않는다.

과목/항목/scope/실행 기록은 한 트랜잭션으로 저장한다. 중복/잘못된 항목이나 DB 오류가 있으면 전체 저장을 rollback한다. WAL, foreign key, busy timeout을 설정하고 스키마는 자동 생성한다. DB는 크롤링 코드와 별도 모듈이다.

```powershell
npm run sync -- <courseId>
npm run sync -- --all
```

이 동기화 전용 명령은 Discord를 보내지 않는다. 알림까지 실행하려면 `npm run check`다. 초기 개발 단계에서 한 과목의 실제 수집 결과를 서로 다른 두 실행에서 검증했다. 계정별 수집 건수는 문서에 기록하지 않는다:

- 첫 실행: BASELINE=2, NEW=0, UPDATED=0, SAME=0, 알림 기록=0.
- 두 번째: BASELINE=0, NEW=0, UPDATED=0, SAME=2, 알림 기록=0.

다른 과목도 첫 정상 동기화 시 각각 조용히 baseline으로 저장한다. 모든 유형의 저장·중복·수정·rollback은 별도의 합성 데이터 테스트에서도 검증했다. 현재 실제 검증 결과는 PROJECT_STATE.md의 최신 기록을 참고한다.

## 변경 감지 (10단계)

`src/detector/changes.ts`는 이전/현재 항목과 버전/검출 시각만 받는 순수 함수다. 크롤링·DB·네트워크 요청은 하지 않는다.

- NEW_NOTICE / NEW_MATERIAL / NEW_ASSIGNMENT / NEW_VIDEO: baseline 완료 후 새 고유 ID.
- ASSIGNMENT_UPDATED: 제목, 시작일, 제출 여부/표시 상태 변경.
- DEADLINE_CHANGED: 과제 또는 온라인 강의의 유효한 종료 시각 변경. 해석 실패로 null이 된 경우는 마감 변경 알림을 만들지 않는다.
- VIDEO_COMPLETED: LMS가 출석완료로 새로 표시했을 때. 실제 시청률 100%를 뜻하지 않는다.
- 정확한 진도율은 지원하지 않아 VIDEO_PROGRESS_CHANGED는 구현하지 않는다. 단순 학습상태 문자열 변화는 알림 이벤트를 만들지 않는다.

DB schema v2에 `change_events`, v3에 전송 재시도 시각, v4에 통합 실행/인증 만료 에피소드 기록을 추가했다. 기존 DB는 자동 마이그레이션한다. 이벤트 키는 항목 고유 키+항목 버전+이벤트 종류다. 항목 갱신과 이벤트 저장은 같은 트랜잭션이며 Discord 전송 대기 기록으로 사용한다.

sync_history SUCCESS는 전달된 정상 수집 batch의 DB 저장 성공을 뜻한다. 전체 크롤링/알림의 성공 또는 일부 실패 여부는 monitor_runs로 구분한다. 강제 종료로 RUNNING 기록이 남으면 종료 여부 미확인이다. 최초 baseline 목록을 반환하므로 통합 실행에서는 과거 항목의 마감 알림도 억제한다.

같은 데이터를 다시 동기화하면 항목 버전이 유지되고 새 이벤트가 생기지 않는다. 파일 DB를 닫았다 다시 열어도 동일하다. 새로운 변경이 실제로 발생하면 버전이 증가하므로 같은 유형의 후속 변경도 별개로 기록할 수 있다.

기존 실제 DB를 이전 schema에서 열어 기존 항목·동기화·변경 이벤트·알림 이력을 보존하는 것을 확인했다. 신규 유형, 수정, 마감 변경, 출석 완료, baseline 침묵, 반복/재시작 중복 방지 및 rollback을 합성 테스트로 검증했다.
