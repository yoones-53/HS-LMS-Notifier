# 배포 전 보안·코드 품질 감사

기준일: 2026-10-07, Windows / Node 24.16.0. 시작 커밋 `449b3d51bc2fb85e4cf6e8bd3d4b8b0c6d1942a6`.

## 판정

**Distribution readiness: NOT READY (일반 공개 배포 보류)**

수정 후 확인된 잔여 위험: **CRITICAL 0 / HIGH 0 / MEDIUM 2 / LOW 2**.
인증 비밀값 누출은 발견되지 않았고 현재 CLI의 자동 검사·실제 실행은 통과했다. 그러나 과거 Git 이력의 개인정보 공개 방침을 소유자가 결정하지 않았고, 다른 학생의 목록 형태까지 지원한다고 보장할 근거가 부족하다. 테스트 통과를 개인정보 이력 정리나 모든 계정 지원 완료로 표시하지 않는다. GUI 설계는 아래 제한을 반영해 진행할 수 있지만 공개 배포 승인은 별도다.

| 영역 | 결과 | 근거/제한 |
| --- | --- | --- |
| Credentials | PASS | 현재 사용자 Credential Manager, 숨김 입력, 독립 테스트 target 저장/조회/삭제, IPC buffer 정리 |
| Git Secret Safety | WARNING | 현재/이력의 실제 인증 비밀값 미검출. 과거 개인정보 및 작성자 이메일은 남음(M1) |
| Auto Login Security | PASS | 허용된 HTTPS 폼 검증, 한 번만 제출, 성공 DOM 확인, CAPTCHA/2FA 중단 |
| Playwright Security | PASS | 자동 context 비영속, trace/HAR/video/screenshot 없음, 디버그 차단 확대 |
| Multi-user Compatibility | WARNING | 사용자 하드코딩 없음. 깨끗한 경로 설치 통과. 다른 Windows 사용자/LMS 계정 미검증(M2) |
| Crawler Robustness | WARNING | 누락 메뉴/빈 목록/날짜/인증 만료/부분 실패 검사 통과. 미관찰 페이지 형태는 fail closed(M2) |
| Database Integrity | PASS | schema v4, 원자적 마이그레이션/동기화, rollback/재시작/실제 보존 확인 |
| Change Detection | PASS | 4유형 안정 ID, baseline 조용함, 반복·재시작 중복 억제 |
| D-Day | PASS | 한국 달력 날짜, D-7/3/1/0, 완료 제외, 모호한 상태 추측 없음, 연장 후 키 정책 유지 |
| Discord | PASS | URL 제한, 15초 제한, redirect 금지, rate limit, 멘션 방지, 비밀 URL 예외 미노출 |
| Error Reporting | WARNING | cooldown/episode/recovery 검사 통과. 이력 보관 한도 없음(L1) |
| Scheduler | PASS | PT30M/IgnoreNew/Interactive/Limited/PT20M 유지, 실제 wrapper 특수 경로 검사 |
| Shell / Injection Safety | PASS | Credential spawn 인자 배열, PowerShell -File, 경로 특수문자 검사 및 npm shim 우회 |
| Dependencies | PASS | npm audit 0건, 고정 lockfile, 별도 폴더 npm ci 성공, major 변경 없음 |
| Logs | WARNING | 허용 필드만 기록, 실제 비밀값 대조 통과, 자동 회전 미구현(L1) |
| Tests | PASS | typecheck, 전체 92개, 오프라인 verify:e2e 51개, PS 구문, 실제 check 성공 |

PASS는 아래 범위의 점검 결과이며 모든 환경/미래 취약점의 부재를 보증하지 않는다.

## 시작 상태와 변경 범위

- main → origin/main, 시작 시 앞섬/뒤처짐 없음. 기존 PROJECT_STATE.md의 직전 커밋 해시/push 사후 기록만 로컬 변경으로 있었으며 보존했다.
- 기존 DB/프로필/.env/Credential/예약 정의는 삭제·초기화하지 않았다. 소스 수정 중 실행 잠금을 사용해 스케줄러의 소스 중간 상태 실행을 막고 실제 검사 전에 해제했다. 예약 주기/활성화 설정은 변경하지 않았다.
- 새 사용자 기능/GUI/Electron/설치 프로그램/패키지 업그레이드 없음. selector, 크롤링 간격, baseline·변경·마감·최초 요약 정책을 유지했다.

## 수정한 문제

| 발견 당시 위험 | 문제 | 수정/재검증 |
| --- | --- | --- |
| HIGH (디버그 설정 시) | Node child_process 진단은 상속 환경을, Playwright 진단은 fill 인자를 출력할 수 있음 | DEBUG/PWDEBUG/DEBUG_FILE/NODE_DEBUG/NODE_DEBUG_NATIVE를 환경 로드·브라우저·Credential·Discord 경계에서 거부. Credential 자식에는 Webhook 환경도 제거. 합성 입력으로 spawn/브라우저 이전 차단 확인 |
| MEDIUM | DB 생성/마이그레이션 중 오류 시 일부 DDL 및 열린 연결이 남을 수 있음 | WAL 설정 뒤 BEGIN IMMEDIATE로 DDL·user_version을 묶음. 실패 시 close로 rollback. 중간 ALTER 실패/기존 데이터 보존/미지원 버전 검사 |
| MEDIUM | Windows npm .cmd shim이 `&` 포함 설치 경로에서 실제 실패 | npm script를 Node 직접 호출로 변경. 명령 이름은 유지. 같은 특수 경로에서 browser install/typecheck/전체 테스트 재통과 |
| MEDIUM (현재 파일) | 개발 PC 경로와 실제 과목명/ID가 공개 문서에 존재 | 현재 문서를 익명화. 테스트 이름도 명시적 합성 이름으로 변경. 과거 이력은 아래 M1로 남김 |
| LOW | persistent context 생성 후 새 페이지 준비 실패가 finally 밖에 있음 | 페이지 준비/handler 등록까지 try/finally 내부로 이동 |
| LOW | Credential 두 번째 메모리 할당 또는 입력 취소 시 앞선 보안 입력 정리 누락 가능 | C# 할당을 try 안으로 이동, 반환 native blob 지우기, ID 길이 검증, PowerShell 입력 전체를 finally로 보호 |
| LOW (테스트) | 특수 경로의 PowerShell 상대 -Command fixture 및 Windows 삭제 경합 | 고정 -File fixture, 제한된 임시 테스트 디렉터리 삭제 재시도. 제품 데이터 삭제 없음 |

Git 제외에 screenshots/traces/HAR를 추가했다. `.gitignore`만 믿지 않고 실제 파일/이력/최종 staging을 검사한다.

## 잔여 사항

### M1 — 과거 Git 개인정보 (MEDIUM, 공개 배포 전 결정 필요)

비밀번호/Webhook/현재 LMS ID의 실제 값 대조 및 일반 토큰/개인키 패턴에서는 누출을 발견하지 않았다. 다만 아래 개인정보는 기존 커밋에 포함되어 있었으며 **파일을 현재 삭제·익명화해도 clone한 이력에서 볼 수 있다**. 실제 값은 이 보고서에 재기록하지 않는다.

| 최초 확인 커밋 | 위치(해당 커밋 기준) | 종류 |
| --- | --- | --- |
| `a27bfde0561049a589f9aebe26eee7ac51eb399c` | PROJECT_STATE.md:11 | 개인 Windows 경로/사용자명 |
| `a27bfde0561049a589f9aebe26eee7ac51eb399c` | PROJECT_STATE.md:222, :224 | 실제 과목 ID/과목명 |
| `7984acc583cdb671bbb1fc0d34093ff5c5879062` | docs/lms-structure.md:4 | 실제 과목명 |
| `164f2575203d45ac0e899910d67f59acdef0758d` | docs/lms-structure.md:138 | 실제 과목 ID |
| `49742d223c37cc35df24d695b7d937f2de39ee4a` | docs/database.md:26 | 실제 과목명 |
| 시작 커밋까지의 기존 19개 커밋 | author/committer 메타데이터 | 설정된 non-noreply 이메일 1종 |

일반 OS를 뜻하는 문서의 단어와 TEST 식별자를 사용하는 합성 과목명은 실제 수강 정보로 확정하지 않았다. 작성자 이메일의 공개 의도는 미확인이다. 현재 Git 설정은 임의로 바꾸지 않았으므로 후속 커밋에도 기존 작성자 이메일이 사용된다.

대응: 소유자가 기존 공개 유지 여부와 향후 작성자 이메일을 결정해야 한다. 비공개 전환/정제한 별도 배포 소스/승인된 이력 정리 등의 선택은 이 감사에서 임의 실행하지 않았다. 정제한 소스만 배포해도 기존 저장소 노출을 소급 제거하지는 못한다. 실제 secret 발견 시에는 해당 secret 폐기/교체가 우선이지만, 이번에 secret 유출이 확인된 것은 아니다. force push/reset/rebase/amend 없음.

### M2 — 지원 범위 검증 (MEDIUM, 일반 배포 전)

한 실제 계정의 현재 학기는 통과했다. 새 사용자 정보는 실행 시 DOM/보안 저장소에서 읽으며 과목/학기/학생/PC 경로 상수는 없다. 다만 빈 학기, 실제 다중 페이지, 다른 계정·권한의 목록 형태, 향후 CAPTCHA/2FA UI는 아직 충분히 관찰하지 않았다. 빈 학기를 성공 0건으로 오인하지 않고, `.paging a`가 발견되면 구조 오류로 안전하게 중단한다. 실제로 다른 학생의 동의를 받아 새 환경에서 검증하기 전까지 범용 지원을 주장하지 않는다. 확인되지 않은 selector를 이번 감사에서 만들지 않았다.

### L1 — 장기 보관 한도 (LOW, GUI 설계에 반영/배포 전 정책 결정)

일별 로그 파일은 있지만 자동 용량 제한/삭제는 없다. sync/monitor/change/notification 이력과 해결되지 않은 이전 학기 incident도 증가할 수 있다. 디스크 고갈은 DB/로그 오류가 된다. 자동 청소 기능을 이번에 추가하거나 사용자 이력을 지우지 않았다. GUI에서 보관/백업/회전 정책을 만들되 baseline·중복 방지 키는 보존해야 한다.

### L2 — 로컬 JSON 신뢰 경계 (LOW, GUI 설계 전)

DB payload/incident JSON은 현재 앱이 만든 로컬 데이터로 간주해 JSON.parse 후 타입 단언을 사용한다. 외부 파일 import 기능은 없다. JSON 파싱 실패는 정상 성공으로 처리되지 않지만, 런타임 구조 검증까지 갖춘 것은 아니다. GUI/데이터 import 전에 스키마 검증과 손상 데이터 복구 안내가 필요하다. 코드 전반을 이번에 재설계하지 않았다.

## 상세 점검 근거

### 인증·로그·입력·파일

- Windows Generic Credential을 현재 사용자/해당 PC의 지속 저장으로 사용한다. clone에 Credential이 포함되지 않으며 관리자/동일 사용자 악성 프로세스에 대한 완전 격리는 아니다. 별도 uuid target의 합성 round trip에서 삭제 후 NOT_CONFIGURED 확인.
- ID/PW는 환경/명령 인자로 전달하지 않고 private pipe로 전달한다. Base64는 IPC framing일 뿐 암호화가 아니며 파일로 저장하지 않는다. Buffer/native 영역을 지우고 JS 참조를 해제하지만 immutable JS/.NET 문자열의 완전한 메모리 소거는 보장하지 못한다.
- 허용 폼 action/origin/method를 확인하고 1회 submit, 실제 로그아웃·강좌 DOM을 확인한다. URL 변경만으로 성공 판정하지 않는다. CAPTCHA/2FA 검사는 합성 테스트이며 실제 우회/잘못된 암호 반복은 하지 않았다.
- 원본 DOM/네트워크 요청/Authorization/Cookie/credential 객체/stack을 저장하는 운영 코드가 없다. SSO form은 비밀 아닌 metadata만 검사한다. 자동 실행은 녹화/trace/HAR/storageState를 만들지 않는다.
- Git 제외 대상, 실 사용자 ID/PW/Webhook의 raw/인코딩 변형을 로컬 메모리에서 비교했다. 값/길이/해시를 출력하지 않았다. `.env`에 LMS ID/PW key 없음. 실제 DB/로그에서도 비밀값 미검출. 브라우저 프로필은 세션을 가진 로컬 데이터라 공유 금지다.
- 기존 data/logs/browser-data ACL에서 Everyone/Authenticated Users/BUILTIN Users에 대한 광범위 Allow 항목 0개. 이는 다른 설치 폴더의 ACL까지 보장하지 않는다. DB/로그는 암호화된 저장소가 아니며 개인 수강 정보가 포함된다.
- HEADLESS는 true/false만 허용, Credential action/target 제한, Webhook은 HTTPS 및 Discord 호스트/경로만 허용한다. DB SQL은 바인딩하고 원격 항목명을 경로/명령으로 쓰지 않는다.
- Credential 프로세스는 고정 helper와 spawn 인자 배열, 20초/응답 크기 제한을 사용한다. PowerShell은 -File와 고정 인자를 사용한다. 설치 경로의 공백/대괄호/&/따옴표를 실제 wrapper fixture로 검증했다.
- 악성 preload/NODE_OPTIONS/디버거, OS 메모리 덤프 또는 외부 화면 녹화 등 같은 사용자 권한의 외부 도구까지 앱 내부 guard로 차단한다고 주장하지 않는다.

### 크롤러·저장·알림

- 안정 ID/role/name/관찰된 attribute 사용, nth-child/nth-of-type/좌표 selector 없음. 의미 있는 표 헤더로 셀 위치를 찾는 index는 임의 화면 순서와 다르다. 깊은 일부 헤더 CSS와 관찰된 onclick 문법은 LMS 변경에 민감하므로 fail closed와 회귀 검사를 유지한다.
- 목록은 top-level DOM이다. 플레이어/외부 iframe을 열거나 영상·출석을 변경하지 않는다. 목록이 iframe으로 이동하는 변경은 지원 완료가 아니라 구조 오류다.
- 메뉴 미제공은 UNAVAILABLE, 알려진 빈 게시판은 OK/빈 목록, 날짜 누락/오류는 null/상태로 구분한다. 과목/유형 실패는 격리하고 인증 손실은 즉시 종료한다. 마지막 정상 데이터는 삭제하지 않으며 실패 범위의 오래된 값으로 마감 알림을 만들지 않는다.
- primary/unique key는 강좌+분반+유형+LMS ID다. 제목만으로 동등성을 판단하지 않는다. schema 생성/추가 migration, items/events/baseline/sync 저장은 transaction으로 보호한다. 테스트는 rollback/재시작을 확인했으며 실제 정전·디스크 파손까지 검증한 것은 아니다.
- 최초 데이터는 BASELINE이며 NEW 이벤트/첫 D-Day 폭탄 없음. 최초 요약은 독립 키로 한 번만 발송. 수정은 version/fingerprint로 구분한다. 공지/자료 제목 수정은 DB에 UPDATED로 저장하나 별도 수정 알림 이벤트는 현재 지원하지 않는다.
- D-Day는 Asia/Seoul 날짜 차이, 기한 경과/제출/출석완료 제외. 완료 여부가 null이면 완료라고 가정하지 않는다. 같은 항목의 같은 D-Day 키는 마감 연장 후에도 재전송하지 않으며 DEADLINE_CHANGED 알림은 별도다. 정책 변경 없음.
- Discord는 wait=true로 message ID를 확인하고 429/명확한 거부만 보류한다. UNKNOWN/SENDING은 중복 방지를 위해 자동 재전송하지 않는다. HTTP 전송과 SQLite 간 완벽한 원자성은 없으며 응답 유실/종료 경계에서 미전달 가능성을 문서화했다. 재귀적 Discord 오류 알림 없음.
- 오류 incident는 scope별 복구/새 episode, 즉시 오류 사건당 1회, 일시 오류 3회 및 6시간 cooldown, 실행당 오류 알림 최대 1건을 검증했다.

### 의존성·코드·운영

- npm audit: critical/high/moderate/low/info 모두 0. dotenv/Playwright는 런타임 사용, tsx/TypeScript/@types/node는 실행/개발에 필요하다. lockfile에서 deprecated 표식 없음. 업데이트/force fix 없음.
- esbuild postinstall이 플랫폼 바이너리를 준비한다. fsevents는 macOS optional로 Windows 미설치. TypeScript 플랫폼 바이너리와 esbuild를 사용하고 SQLite는 Node 내장이다. npm audit 0은 공급망·미공개 취약점 안전 보증이 아니다.
- strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 검사 및 추가 noUnusedLocals/noUnusedParameters 통과. 운영 소스의 any 남용/eval/shell exec 없음. 런타임 import 그래프의 순환 0(타입 참조 순환 제외). 모니터 함수 크기/로컬 JSON 단언은 문서화하고 대규모 리팩터링하지 않았다.
- 운영 예약은 PT30M, IgnoreNew, Interactive/Limited, 20분 제한. OS 실행 잠금으로 수동/예약 충돌을 방지한다. 예외 시 finally로 browser/DB/lock을 정리하며 프로세스 종료 시 OS lock이 해제된다. 강제 OS 종료/절전/시스템 크래시의 모든 자식 회수를 보장한 것은 아니다.
- 현재 폴더/Node 경로를 옮기면 예약을 확인·재등록해야 한다. Windows 로그인/전원/절전 조건과 안전한 이전 절차를 README에 추가했다.

## 재검증 결과

- `npm run typecheck`: PASS. `npm test`: 92/92 PASS. `npm run verify:e2e`: 51/51 PASS.
- verify:e2e는 실제 Chromium + 합성 라우트/계정 + 실제 SQLite + 합성 전송/프로세스 + Windows wrapper 통합 검사다. 실제 LMS/Discord 검사를 대신한다고 부르지 않는다.
- HEADLESS true/false, 인증 미등록/거부/추가인증, 부분 실패/인증 만료, baseline/최초 요약/변경/D-Day/재시작 중복 억제 검사 포함. 실제 계정으로 암호 실패를 유도하지 않았다.
- PowerShell 구문 검사 및 5개 상태 fixture PASS. lint 도구는 미설정이며 lint 통과라고 보고하지 않는다.
- 사용자 파일 없는 별도 특수문자 경로에서 npm ci→browser:install→typecheck→92개 테스트 PASS. 같은 PC/Windows 사용자 및 이미 설치된 Chromium cache를 사용하는 검사이며 완전히 새로운 OS 검증은 아니다.
- 실제 `npm run check`에서 AUTH OK/AUTO, 현재 학기 전체 수집, 변경 감지, Discord 전송과 SUCCESS_WITH_CHANGES를 확인했다. 사용자 Discord 화면의 육안 수신 확인은 별도로 요청하지 않았다.
- 최초 요약 ALREADY_SENT 및 기존 notification history 상태를 유지했다. 기존 baseline, 알림, 동기화, 항목 identity의 해시는 보존됐고 정상 실행 기록만 추가됐다. schema와 integrity check도 정상이다.
- browserClosed=true, 실행 중 관찰한 Node/Chromium 프로세스의 종료 후 잔존이 없고 실행 잠금 재획득·해제를 확인했다. 예약 정의 변경 없음.
- 실제 비밀값/일반 패턴/추적 경로/캡처 검사 PASS. 로그·DB·프로필은 로컬에 보존한다. 개인정보 이력 M1은 이 PASS와 별개다.

## GUI 추가 후 재검증 (2026-10-08)

- Electron main/preload/renderer 분리, sandbox/contextIsolation/Node 비노출/CSP/외부 navigation·팝업·권한 차단. IPC allowlist와 runtime schema, 발신 창/프레임/URL 검증. 실제 Electron 합성 Wizard 테스트에서 Node 접근 불가·저장된 비밀값 미반환 확인.
- L1의 일별 로그 retention 해결: 기본30일, 설정7~365일. DB/중복 방지/incident/실행 이력은 삭제하지 않는다. 장기 DB 용량 정책은 별도 TODO다.
- L2의 **GUI가 읽는** settings/recent-result/incident/recovery/migration metadata 경계 및 core incident에 Zod 검증을 적용했다. 기존 crawler item payload의 전면 재설계나 외부 DB import 지원을 했다는 뜻은 아니다.
- Credential helper Save 동작은 stdin pipe/고정 target/크기 제한, 화면은 masked input/입력 후 삭제/기존 값 조회 API 없음. Discord 보안 저장소 추가, .env 호환 유지. 실제 보안 저장소 합성 target 왕복과 입력 특수문자 검증 성공.
- DB 이전은 두 실행 잠금, SQLite backup, integrity/schema/모든 원래 행 hash·개수 보존, 목적지 검증 뒤 연결 게시. 중간 게시 I/O 실패 rollback/기존 목적지 보호/잘못된 metadata/원본 보존 테스트 통과.
- MSIX 개발 호스트의 AppData 리디렉션을 실제 예약에서 재현하고 Windows의 최종 디렉터리 경로로 보정했다. 임의 경로가 아닌 현재 Windows 사용자/고정 앱 suffix만 허용. 호스트 앱 초기화/제거 전 최신 DB 백업이 필요한 개발용 제약을 문서화했다. 보안 설정이나 예약 정의를 변경하지 않았다.
- typecheck/미사용 검사, unit/E2E/GUI 테스트와 npm audit를 통과했다. 실제 GUI→CLI 반복→Windows Task가 모두 정상이며, 실제 변경 및 마감 알림의 전송·반복 실행 중복 억제·기존 summary ALREADY_SENT·baseline/이력 보존을 확인했다. 계정별 실행·전송 수는 문서에 기록하지 않는다.
- 실제 secret 메모리 대조에 운영 userData/빌드도 포함, 노출 없음. GUI/Chromium 종료 및 잠금 해제 확인. 감사 M1/M2와 다른 사용자 실제 검증은 여전히 별도 공개 배포 단계다. GUI 구현 완료 ≠ 공개 배포 READY.

## 참고와 다음 단계

- [Microsoft CREDENTIAL 구조/지속 범위](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- [Node 진단 환경변수](https://nodejs.org/api/cli.html#node_debugmodule)
- [Playwright trace에 포함되는 실행/DOM 정보](https://playwright.dev/docs/trace-viewer)

GUI/패키지 산출물 검사·AppData·마이그레이션·보관 정책은 `docs/distribution-todo.md`. 공개 이력 처리와 새 사용자 검증 후 이 판정을 갱신한다.
