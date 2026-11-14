# 한신대학교 LMS 실제 구조 조사

조사: 2026-10-06, Playwright MCP, 로그인한 계정의 현재 학기 2026년 2학기.
범위: 현재 학기 강좌 목록 및 한 강의실의 메뉴 이동. 아래 관찰은 실제 페이지 근거이며 개인 과목명/ID는 익명화했다. 쿠키, 인증 요청 및 원본 스냅샷은 포함하지 않는다.

## 전체 과목 검증 갱신 (13단계)

통합 실행에서 현재 학기 수강 과목 전체의 같은 구조를 검증했다. 공지·강의자료·과제·고유 ID가 확인된 온라인 강의를 읽었고, 안정적인 ID가 없는 예정 온라인 행은 제외했다. 일부 강좌는 자료/과제 메뉴가 미제공이었다. 새 selector나 플레이어 접근 없이 기존 MCP 근거의 목록 수집이 성공했다. 아래의 단일 과목 검증만 남았다는 과거 단계 기록보다 이 결과가 우선한다. 계정별 건수는 코드의 기대 상수가 아니며 문서에 기록하지 않는다.

## 로그인과 세션

### 2026-10-07 자동 로그인 폼 추가 조사

Playwright MCP에서 새 비영속 context로 LMS root에 접근하자 `https://sso2.hs.ac.kr/` 통합 로그인 화면이 표시됐다. 로그인 시도 없이 요소의 비밀 아닌 메타데이터만 확인했다.

- form: `#ssoLoginFrm`, method=post, action=`https://sso2.hs.ac.kr/sso/loginSuccess.jsp`, onsubmit=`return login();`.
- ID: `#ssoLoginFrm #userId`, name=userId, type=text, placeholder=아이디.
- Password: `#ssoLoginFrm #userPwd[type="password"]`, name=userPwd, placeholder=비밀번호.
- submit: `#ssoLoginFrm input[type="submit"]` 1개. 원래 폼/사이트 JS를 사용하고 인증 API를 직접 호출하지 않는다.
- 이 화면에는 iframe/추가 인증 UI가 없었다. 숨겨진 토큰이나 입력값은 읽지 않았다. 자동 로그인 성공은 URL 변화만이 아니라 기존 로그아웃 표시·강좌 목록 경로·실제 COURSE_SELECTOR의 표시를 모두 확인해야 한다.
- CAPTCHA/2FA 실제 UI는 미관찰이며 일반적인 추가 인증 문구 감지는 보수적인 안전 장치다. 향후 새로운 화면은 다시 MCP로 확인해야 한다.

- LMS 출발 주소: `https://lms.hs.ac.kr`.
- 나의 강의실: `/lms/myLecture/doListView.dunet?mnid=201008840728`.
- 강좌 목록과 강의실에서 `a[href="javascript:lmsLogout();"]`의 `로그아웃` 텍스트 및 표시 여부를 확인했다. 로그아웃 동작은 실행하지 않는다.
- 메인 페이지에서는 로그아웃 링크 href가 다르므로 위 selector를 모든 페이지에 일괄 적용하지 않는다.
- 오래 열린 강좌 목록에서 강의실을 클릭했을 때 `로그인 후 이용하실 수 있습니다.` alert가 발생했다. 확인 후 SSO 왕복으로 LMS 메인에 돌아왔고, 나의 강의실 재진입 및 강의실 입장이 성공했다. 오래된 DOM의 로그아웃 표시만으로 현재 서버 인증을 보장할 수 없다.
- SSO 복구로 실패가 해소될 수 있다. 복구 이후에도 로그인 화면이면 `AUTH_EXPIRED`, 예상 구조를 찾지 못한 경우는 구조 변경/로딩 오류로 구별해야 한다. 인증 URL의 query, 쿠키, 저장소 및 폼 비밀값은 기록하지 않는다.

## 현재 학기 선택

HTML `select`가 아닌 커스텀 선택 UI다.

| 대상 | 확인한 selector/구조 | 값 |
| --- | --- | --- |
| 선택 연도 | `.select_termbox:not(.select_term_w) > a.title > strong` | `2026년` |
| 선택 학기 | `.select_termbox.select_term_w > a.title > strong` | `2학기` |
| 선택지 | `.select_termbox .select_list a[href^="javascript:changeYearTerm("]` | 현재는 접힌 목록 |

선택지 함수 인자는 연도, 학기 코드, 학기명이다. DOM에서 `10` 1학기, `11` 여름학기, `20` 2학기, `21` 겨울학기, `99` 연단위운영, `40` 입학전을 확인했다. 다른 학기로 변경하지 않았으며 기본 선택된 학기만 조사했다. 달력 날짜로 학기를 추측하지 않는다.

## 강좌 목록

```text
#landing_lec_box_container
  .landing_lec_box
    ul.list.box > li.box > div.top.online
      a[id^="selfarea_"][href*="fncGoClassroom"]
        strong.title  ← 과목명(분반 포함)
        span.info     ← 기타 정보; 과목명에 섞지 않음
```

- 안정적인 목록 후보: `#landing_lec_box_container a[href^="javascript:fncGoClassroom("]`.
- 이름은 해당 링크 안의 `strong.title`에서 읽는다. 조사 계정의 9개 링크 모두 확인했다.
- href 원문: `javascript:fncGoClassroom('<course_id>','<class_no>','3');` 형태. 표기상 꺾쇠 부분은 실제 식별자를 익명화한 자리표시자다.
- `selfarea_<course_id>_<class_no>` ID도 확인했다. 순서나 `nth-child`에 의존하지 않는다.
- 링크가 비동기로 나타난다. 이동 직후 count는 0이었다가 링크 클릭 대기 후 9개가 준비됐다. 즉시 count 0을 빈 학기로 확정하면 안 된다. 빈 학기 표시와 전체 로딩 완료 신호는 아직 미확인이다.

## 강의실 입장 및 고유 URL의 한계

페이지에 공개된 `fncGoClassroom(course_id,class_no,change_role_no)`와 `fncTempFormSubmit`을 읽어 확인했다. 강좌 클릭은 `/lms/class/classroom/doViewClassRoom.dunet`으로 **POST 폼 제출**한다. 인자는 `mnid=201008254671`, course_id, class_no 및 change_role_no다. 현재 학생 화면에서는 함수가 change_role_no를 빈 값으로 바꾼다. 권한 값을 임의 설정하거나 함수를 재구현하지 않고 원래 강좌 링크를 클릭하는 것이 안전하다.

- 실제 강좌 링크 클릭 → 같은 탭의 위 공통 URL로 이동. 새 탭/팝업 없음.
- 표시 헤더: `2026-2학기) <강의명> (<분반>반)`.
- 브라우저 주소에 course_id가 남지 않는다. 공통 주소를 강좌의 고유 URL로 오인하지 않는다. 모델에는 course_id와 class_no, 원본 entryHref를 보존하고, courseUrl은 확인한 공통 진입 주소임을 구별해야 한다.
- 강의실 메뉴도 course_id 없는 주소를 사용하므로 먼저 원하는 과목에 입장한 뒤 순차적으로 읽어야 한다. 같은 세션의 여러 강의를 병렬 탐색하지 않는다.

## 강의실 메뉴

메뉴 범위 `nav.main_menu`. role link의 정확한 이름을 우선한다.

| 실제 메뉴명 | 관찰된 href | 실제 이동 결과/목록 |
| --- | --- | --- |
| 전체강의실보기 | `/lms/myLecture/doListView.dunet` | 메뉴 존재 확인 |
| 과목공지 | `/lms/class/boardItem/doListView.dunet?board_no=7` | 같은 탭, `h3.pg_title` = 과목공지, `table#base_list` |
| 학습자료실 | `/lms/class/boardItem/doListView.dunet?board_no=6` | 같은 탭, 제목 학습자료실, `table#base_list` |
| 과제제출 | `/lms/class/report/stud/doListView.dunet` | 같은 탭, 제목 과제제출, `table#task_manager_list` |
| 강의수강 | `/lms/class/courseSchedule/doListView.dunet` | 같은 탭, 제목 강의수강, `table#learning_list` |

`getByRole('link', {name:'과목공지', exact:true})` 등을 `nav.main_menu` 안에 한정한다. 별도의 `공지사항` 메뉴는 기초학습역량 하위 메뉴여서 과목공지와 혼동하면 안 된다. 좁은 화면에서는 메뉴가 화면 밖으로 접혀 클릭이 시간 초과되었다. 1440×1000 viewport에서 정상 클릭했다.

확인한 표 헤더:

- 공지: NO, 제목, 작성자, 등록일, 조회수.
- 자료: NO, 구분, 제목, 작성자, 등록일, 조회수.
- 과제: NO, 과제제목/제출기한, 제출여부, 제출파일 포함 여부, 취득점수, 만점, 진행여부.
- 강의수강: 회차, 구분, 회차명, 학습시간, 학습기간, 학습상태, 강의보기.

아직 각 행/상세 페이지/페이지네이션을 확인하지 않았으므로 이 단계에서 항목 크롤러를 구현하지 않는다.

## iframe / 팝업 및 안전 경계

- 과목 목록/강의실/4개 메뉴의 목록 표는 최상위 문서에 있다.
- 로그아웃용 iframe과 `l_popup_iframe`, `l_popup_iframe_full`, `l_popup_iframe_exam`, `l_popup_iframe_diagnosis`, `l_popup_iframe_content_preview` 등의 빈 팝업 iframe이 존재한다.
- 일부 iframe ID가 중복된다. ID 하나만으로 프레임을 안정적으로 선택할 수 있다고 가정하지 않는다.
- 조사한 메뉴 클릭에서 새 탭은 발생하지 않았으며 실제 src가 채워진 콘텐츠 iframe도 없었다.
- 영상 플레이어, 외부 콘텐츠 서버 및 상세 팝업은 아직 조사하지 않았다. 빈 iframe 존재가 영상 제공 방식을 입증하지는 않는다.
- 영상 재생, 과제 제출, 출석 변경은 하지 않았으며 향후에도 구현하지 않는다.

## 다음 조사

5단계 추가 검증: 현재 학기 연도/학기 selector가 각각 1개에 일치함을 MCP로 확인했다. 프로그램의 저장된 별도 프로필로도 강의명과 ID가 일치하는 9개 강좌를 수집했다. 빈 학기 상태는 확인하지 못해 빈 결과는 성공 처리하지 않는다.

5단계 강좌 수집을 먼저 검증한다. 6단계에 공지/자료 행의 ID·날짜·URL·페이지네이션, 7단계에 과제 상태와 기간, 8단계에 재생하지 않고 읽을 수 있는 강의 상태를 각각 검증한다.

## 6단계 — 공지 및 자료의 실제 행

한 과목의 빈 공지와 비어 있지 않은 학습자료를 확인했다. 다른 과목의 공지와 자료도 추가 조사하여 같은 구조임을 확인했다. 과목명과 계정별 건수는 공개 문서에서 생략한다.

| 필드 | 실제 구조 |
| --- | --- |
| 항목 ID | `#base_list tbody tr a[name="btn_board_view"]`의 숫자 `id` |
| 제목 | 같은 링크의 텍스트. `.list_title` 전체 텍스트는 모바일 작성자 정보도 포함하므로 피함 |
| 등록일 | 해당 행의 `td.list_date`, `YYYY.MM.DD`; 시간 없음 |
| 빈 목록 | `#base_list tbody tr td[colspan]`의 `등록된 게시물이 없습니다.` |
| 과목 교차 검증 | `input[name="course_id"]`, `input[name="class_no"]` (이 두 비밀 아닌 값만 읽음) |
| 페이지 영역 | `.paging`의 현재 페이지 `<strong>1</strong>` |

실제 공지와 자료를 각각 한 번 클릭했다. `fncViewBoardItem`이 링크 ID를 `boarditem_no`로 넣고 `#frm`을 `/lms/class/boardItem/doViewBoardItem.dunet`으로 POST한다. 같은 탭에 열리며 추가 iframe 없음. 자료 category_id는 `lecture`, 조사한 공지는 category_id가 없었다.

상세 주소에도 항목 ID가 표시되지 않는다. 모델의 url은 관찰한 공통 상세 주소이며 `urlKind: CONTEXT_POST`로 명시한다. 이를 고유 GET 링크로 만들거나 주소에 추측한 query를 추가하지 않는다. 동일 항목 여부는 `(courseId, classNo, type, itemId)`로 판단한다.

페이지 함수 `fncList(page)`는 `#page`에 번호를 넣고 같은 목록 주소로 폼을 제출한다. 아직 2페이지 이상인 실제 게시판 링크를 관찰하지 못했으므로 `.paging a`가 있으면 수집을 불완전하게 성공 처리하지 않고 구조 확인 오류로 중단한다. 필요한 경우 MCP로 다음 페이지를 검증한 후 확장한다.

메뉴 이동 후 DOMContentLoaded와 표 표시를 기다린다. 각 이동에 800ms 간격을 두고 강좌/메뉴는 순차 처리한다. 항목 목록만 읽으므로 매번 상세 페이지에 들어가거나 첨부파일을 다운로드하지 않는다.

세션 주의: MCP와 앱은 별도 프로필이므로 전환 시 `다른 PC 에서 로그인 되었습니다.` alert가 실제로 발생했다. 정상 SSO 복구 이후 새로운 강좌 페이지 인증 확인이 성공하면 지난 alert 표시를 해제한다. 수집 중 새 alert가 발생하면 AUTH_EXPIRED로 중단한다. 여러 프로필을 동시에 자동 수집에 사용하지 않는다.

전체 과목 테스트에서 한 강좌의 자료 메뉴 대기가 실패했다. MCP로 해당 강의실을 다시 확인한 결과 `nav.main_menu`에 학습자료실/과제제출이 없고 과목공지/강의수강만 제공됐다. 없는 메뉴 주소를 추측해서 방문하지 않는다. 결과는 `UNAVAILABLE`로 구분하며 실제 빈 게시판의 `OK, items: []`와 다르다.

## 7단계 — 과제와 마감일

MCP로 서로 다른 과목의 과제 목록과 빈 목록을 확인했다. 계정별 행 수는 문서에 기록하지 않는다.

| 필드 | 실제 구조 |
| --- | --- |
| 목록 | `#task_manager_list tbody tr` |
| 링크/제목 | `a.subject`; 첫 `<br>` 이전 텍스트가 제목 |
| 기간 | 같은 링크의 첫 `<br>` 이후 `26/09/23 00:00 ~ 26/10/14 23:59` 형태 |
| 식별자 | onclick `fncModifyReport('<report_no>', '<apply_yn>', '<report_seq>', '<report_open_yn>','<open_yn>')`의 1·3번째 인자 |
| 제출 상태 | 해당 행 `td.txt1 .status`: 실제 `제출`/`미제출` 확인 |
| 진행 상태 | 해당 행 `td.end .status`: 실제 `진행`/`종료` 확인 |
| 빈 목록 | 조사한 빈 목록의 표 헤더는 존재하고 `<tbody>`는 빈 상태 |

함수 이름에 Modify가 있지만 목록 링크는 과제 상세/제출 폼으로 이동한다. 실제로 링크 1개를 클릭하여 `/lms/class/report/stud/doFormReport.dunet`의 `과제 제출` 화면을 확인했다. 같은 탭이며 콘텐츠 iframe 없음. 저장·수정·제출 버튼은 누르지 않았다. 크롤러는 이 폼에 들어가지 않고 목록만 읽는다.

과제 모델은 reportId와 reportSeq를 분리하고 itemId=`reportId:reportSeq`로 보존한다. 상세 주소는 다시 공통 POST endpoint이므로 `CONTEXT_POST`. 등록일은 목록에 없어 createdAt=null이다.

시각은 Asia/Seoul(UTC+09:00)로 명시한다. 2자리 연도는 실제 선택된 학기 연도를 기준으로 같은 해 또는 인접 연도와 일치할 때만 해석한다. 범위를 벗어나는 모호한 연도, 존재하지 않는 날짜, 24:00, 시간 없는 날짜는 null이다. 4자리 연도와 `/`, `.`, `-` 형식은 합성 테스트로 검증했다. 원문 기간과 COMPLETE/PARTIAL/UNKNOWN/INVALID_RANGE 상태도 남긴다. 종료가 시작보다 빠른 경우 마감값을 사용하지 않는다.

`submitted`는 화면에 `제출`이면 true, `미제출`이면 false, 다른 값/누락이면 null이다. 함수 인자나 진행여부만으로 제출을 추측하지 않는다.

실제 `npm run assignments -- <courseId>` 실행에서 마감, 제출/미제출 및 종료/진행이 MCP 결과와 일치했다. 실제 ID, 개별 마감과 계정별 건수는 생략한다. 다른 모든 과목 검증은 위 통합 검증 결과를 참고한다.

## 8단계 — 온라인 강의, 출석, 재생 금지

한 강좌의 `강의수강`을 MCP로 조사했다. 표 안에는 주차 제목 행과 실제 회차 행이 섞여 있고 온라인/오프라인/오프라인시험을 구분한다. 온라인 행만 대상으로 한다.

| 항목 | 실제 읽기 위치/해석 |
| --- | --- |
| 온라인 구분 | 회차 행 `.rwd_cata`의 정확한 텍스트 `온라인` |
| 회차 고유 ID | `a.lectureWindow`의 `weekseq_no` |
| 콘텐츠 ID | 같은 링크의 `contents_id`; 과목 공통 형태이므로 유일성을 가정하지 않음 |
| 제목 | `.rwd_subject strong.subject` |
| 학습기간 | 헤더 `학습기간`에 대응하는 셀. `YYYY.MM.DD HH:mm ~ YYYY.MM.DD HH:mm` |
| 학습상태 | 헤더 `학습상태`에 대응하는 셀의 `.status` |
| 출석 인정 | 실제 `출석완료`이면 attendanceConfirmed=true. 다른 상태는 null |
| 정확한 진도율/전체 시청 완료 | 목록에서 확인할 수 없어 progressPercent/completed=null |

화면 안내에서 학습기간 종료 후 복습은 출석 인정이 되지 않는다고 명시한다. 따라서 학습기간 끝을 출석 기한 알림의 기준으로 활용할 수 있다. 다만 기간 이후에도 복습이 제공되므로 이를 영상 접근 자체의 만료시각으로 설명하지 않는다.

조사 시 콘텐츠가 연결된 일부 행에만 안정적인 weekseq_no가 있었고, 나머지 예정 행은 링크/ID가 없었다. 제목이나 순서로 가짜 고유 ID를 만들지 않고 `unidentifiedOnlineRows`로 제외 개수를 반환한다. 과제나 오프라인 회차는 영상으로 저장하지 않는다. 계정별 행 수는 문서에 기록하지 않는다.

외부 콘텐츠 주소 attribute의 호스트는 `vod.hs.ac.kr`였다. 목록 자체에는 활성 콘텐츠 iframe이나 video/audio 요소가 없다. 페이지에 공개된 `.lectureWindow` 클릭 처리 코드에서는 학습 가능 여부를 확인한 후 LMS 학습창을 POST로 연다. 이 함수를 실행하거나 학습 API를 직접 호출하지 않았다. 플레이어 내부 iframe 구성·자동재생 여부는 열어 보지 않아 **미확인**이다. 실제 외부 영상 URL/파라미터는 저장하거나 요청하지 않는다.

`npm run videos -- <courseId>` 실계정 검증에서 고유 ID가 있는 온라인 강의의 기간(Asia/Seoul)과 출석 상태가 MCP와 일치했다. 실제 ID, 개인 출석 내역과 계정별 건수는 생략한다. 식별 불가 예정 행은 제외를 콘솔에 명시한다. 자동 테스트는 플레이어 경로로 어떤 요청도 보내지 않음을 확인한다.
