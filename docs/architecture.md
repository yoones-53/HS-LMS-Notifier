# 디렉터리 역할

| 경로 | 역할 | 현재 상태 |
| --- | --- | --- |
| `src/auth/` | Windows 보안 저장소, 실행별 자동 로그인과 인증 확인 | 실계정 자동 로그인 검증 |
| `src/browser/` | 운영용 fresh context 실행/종료, 기존 수동 로그인용 persistent 프로필 | 구현 |
| `src/crawler/` | 관찰한 DOM에 근거한 강좌/공지/자료와 순차 메뉴 이동 | 구현 및 실계정 검증 |
| `src/database/` | SQLite 연결/스키마/중복 방지/최초 baseline | 구현, 크롤러와 분리 |
| `src/detector/` | 이전 상태 비교와 의미별 이벤트 생성 | 순수 함수/합성 테스트 검증 |
| `src/notification/` | Discord 전송·중복 방지·마감 및 인증 만료 알림 | 구현/검증 |
| `src/summary/` | 인증된 현재 snapshot의 최초 요약/미확인 상태/가까운 마감 | 순수 함수, Discord와 분리 |
| `src/utils/` | 설정, 환경변수 로딩, 안전한 CLI 오류 처리 | 구현 |
| `src/main.ts`, `src/monitor.ts` | 통합 진입점과 브라우저에 독립적인 실행 조정 | 구현/검증 |
| `scripts/` | 로그인 등 직접 실행하는 작업의 진입점 | 구현 |
| `tests/` | 로컬 서버와 합성 세션을 사용하는 테스트 | 구현 |
| `docs/` | 개발/운영 문서 | 이 문서 |
| `data/` | 실제 SQLite 데이터 | `.gitkeep`만 추적 |
| `logs/` | 비밀정보 없는 실행 로그 | `.gitkeep`만 추적 |
| `browser-data/hs-lms/` | 실제 로그인 프로필 | 전체 Git 제외 |

`npm run dev`와 `npm run check`는 새 자동 로그인→전체 수집→동기화→변경/마감 알림을 한 번 실행한다. `npm run credentials:test`는 자동 로그인만 검사한다. 기존 `npm run login:check`는 별도로 보존된 수동 프로필의 세션만 검사한다. 스케줄러 없는 앱 자체는 반복 루프를 돌지 않는다.

`utils/config.ts`에 있는 LMS 경로와 로그아웃 selector는 Playwright MCP로 실제 관찰한 값이다. 구조 정리를 이유로 새로운 selector를 만들지 않는다. `auth`가 브라우저 생명주기와 확인 흐름을 구성하고, `browser`는 로그인 DOM이나 비밀번호를 다루지 않는다.

루트 `.env`는 `dotenv`로 읽되 내용을 출력하지 않는다. 로그인 자격증명 필드는 없다. Windows Credential Manager에 사용자별로 저장하며 구현/한계는 `auto-login.md`에 기록한다. main은 환경/DB/브라우저 생명주기를 구성하고 monitor는 주입된 인증 함수와 데이터 소스로 순차 수집한다. 과목 입장 실패는 해당 과목만, 메뉴 실패는 해당 유형만 건너뛰되 수집 중 AUTH_EXPIRED는 AUTH_EXPIRED_DURING_CRAWL로 즉시 별도 종료한다.

성공한 유형만 DB에 반영한다. 마감 알림은 이번에 성공한 수집 값만 사용하며 첫 baseline 유형은 제외한다. 로그는 고정 코드/숫자/짧은 기계 식별자만 기록하고 원시 오류·페이지·네트워크 응답·자격증명은 기록하지 않는다. 자동 테스트는 실패 격리와 인증 만료 반복 억제를 포함한다.

실제 DB/로그는 파일 확장자와 디렉터리 제외 규칙으로 보호한다. 빈 폴더를 Git에 유지하기 위한 `.gitkeep` 이외의 `data/`, `logs/` 내용은 추적하지 않는다.
