# GUI·일반 배포 전 확인 목록

2026-10-08 Electron 개발용 GUI를 구현했다. Wizard/대시보드/설정/트레이/안전한 IPC/기존 코어 연결과 실제 GUI·CLI·예약을 검증했다. 설치 프로그램과 공개 배포 준비 완료를 의미하지 않는다. 자세한 완료 범위는 gui-architecture.md와 PROJECT_STATE.md를 우선한다.

## 공개 배포 전에 결정할 사항

- [ ] 기존 Git 이력의 개인 경로·과목명/ID·작성자 이메일 공개 여부를 소유자가 결정한다. 현재 파일 정리만으로 과거 노출이 사라지지 않는다. 이력 재작성은 별도 승인 없이는 금지한다.
- [ ] 앞으로 사용할 Git 작성자 이메일(공개 이메일 또는 GitHub 설정에 표시된 정확한 noreply 주소)을 선택한다. 임의 주소를 추측하거나 기존 커밋을 amend하지 않는다.
- [ ] 다른 학생/빈 학기/여러 페이지/다른 메뉴 구성의 지원 범위를 검증한다. 사용자 직접 등록·동의와 실제 DOM 관찰 후 진행하며 계정을 공유받지 않는다.
- [ ] 지원 환경을 Windows/Node 24/학생 계정으로 명시하고, 설치 재현 검사와 최종 비밀값·개인정보 검사를 릴리스마다 반복한다.

## GUI 단계 반영 결과

- [x] RuntimePaths와 AppData/userData, 기존 CLI/예약의 동일 운영 DB 연결.
- [x] baseline·notification_history·sync_history·최초 요약 SENT 보존 및 안전한 이전/검증/실패 rollback. 원본 보존.
- [ ] 설치별/LMS 계정별 데이터와 Credential target을 분리한다. 현재 CLI는 한 Windows 사용자·한 LMS 계정 사용을 전제로 한다.
- [x] Credential masked 입력/단방향 저장/기존 값 반환 없음. 동일 사용자 악성 코드에 대한 한계 문서화.
- [x] GUI Discord Credential Manager, 기존 .env 최초 가져오기/CLI fallback.
- [x] 수동 profile 경로 주입. 기존 profile 복사/삭제 없이 보존, 자동 로그인 비영속 유지.
- [x] GUI JSON/IPC runtime schema 및 안전한 오류. 외부 DB import/전체 item payload 재설계는 미지원.
- [x] 기본30일 일별 로그 보관. baseline/dedup/DB/incident 이력 보존; 장기 DB 용량 정책은 후속 검토.
- [x] 설치본은 독립 AppData userData를 사용하고 기존 migration 완료 데이터와 이력을 재사용한다. 임의의 개발 경로 탐색은 하지 않는다.

## 설치 프로그램/릴리스 직전

- [x] 설치 산출물은 허용 목록으로 구성한다. `.git`, `.env`, data, logs, browser-data, work, outputs, screenshots, traces, HAR, 개인 설정은 제외한다.
- [x] 빌드 결과 자체에서 ID/PW/Webhook/쿠키/토큰/개인 경로를 다시 검사한다. 소스 검사만으로 패키지 안전을 주장하지 않는다.
- [x] 고정된 의존성으로 typecheck/unit/E2E/GUI 검증과 production dependency audit, 설치·제거·재설치 보존 검사를 수행한다.
- [ ] code signing, 자동 업데이트, 별도 Windows Defender/SmartScreen 배포 검증을 완료한다.
- [x] installer/uninstaller가 기존 예약 작업을 덮어쓰거나 삭제하지 않고, 활성 예약과 GUI timer가 중복되지 않음을 검증한다.
- [x] single-instance, 트레이 숨김/복원, 정상 종료 후 browser/lock 회수를 설치본에서 검증한다. Windows 시작 실행은 아직 지원하지 않는다.
- [ ] 진짜 다른 Windows 사용자 환경에서 새 설치→Credential→Discord→확인→예약→삭제를 검증한다. 현재 PC의 깨끗한 폴더 검사는 이를 완전히 대체하지 않는다.
- [ ] Discord 응답 불명확 시 중복 방지와 미전달 가능성 사이의 정책을 안내한다. 외부 전송의 완벽한 exactly-once를 약속하지 않는다.
