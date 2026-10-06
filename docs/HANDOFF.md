# 작업 인수인계 (2026-10-04 기준)

새 대화에서 이어서 작업할 때 먼저 읽는 문서입니다. 사용자 안내는 `README.md`, 상세 사용법은 앱 안의 설명서(`js/app.js`의 `helpHTML`)에 있습니다.

## 지금 상태

- 파이썬(PyQt) 시험 감독 배정 프로그램(`main.py`)을 **서버 없는 웹앱**으로 옮겨 `main` 브랜치에 병합 완료. GitHub Pages 주소: `https://08hwichemi.github.io/exam-proctor/` (Pages 설정은 저장소 Settings → Pages에서 `main` / root).
- PR #1~#7 병합 완료. 이후 작업 브랜치 `claude/beautiful-lamport-g36no8`(PR #8: 교사 탭 창 높이 맞춤, 결과 요약 칩 / PR #9: 설명서 챕터형 개편, 요약 칩 확대, 엑셀 셀 맞춤 / PR #10: 복도·자습 각각 균형 / PR #11: Supabase 접속 암호).
- 암호(라이선스 키)는 제거. `keygen.py`, `main.py`는 참고용으로만 남아 있음(비밀 단어가 공개 저장소에 노출되어 있으니 파이썬 버전을 계속 배포한다면 바꿔야 함).

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 뼈대. 상단 바, 단계 표시(`#steps`), 4개 탭 섹션 |
| `css/style.css` | 디자인 체계(13px 기준, CSS 변수, 일차 색 4종 `day-c0~3`). 교사 탭·결과 탭은 `--chrome-h`로 창 높이에 맞추고 표 안에서만 스크롤 |
| `js/engine.js` | 배정 엔진. 입력 해석(`parseCell`, `parseHomeroom`), 모델(`buildModel`), 최적화(`createOptimizer`: 그리디 초안 + 담금질), 검사(`evaluate`), 서명(`inputSignature`). Node에서도 로드됨 |
| `js/excel.js` | ExcelJS로 교사 명단·이전 결과 읽기, 결과 3개 시트 쓰기(`exportResult`) |
| `js/app.js` | 화면 전부. 상태(`state`), 자동 저장(localStorage `examProctor.v2`), 백업 파일, 예전 DATA SAVE 변환(`fromLegacy`), 4개 탭 렌더러, 결과 수정 모달, 설명서(`HELP_CHAPTERS`: 챕터별 넘김, `demoState`·`withDemo`·`captureTab`·`shot`으로 실제 렌더러를 보기 자료로 돌려 미리보기와 빨간 번호표를 그림) |
| `js/config.js` | 접속 암호 확인용 Supabase 주소·anon key(공개용). `url`을 비우면 암호 화면 없이 열림(로컬 테스트) |
| `js/auth.js` | `ProctorAuth`: fetch만으로 Supabase RPC 호출(`proctor_check`, `proctor_status`), 스마트보드 관리자 로그인 후 `proctor_set_password`. 라이브러리 없음 |
| `docs/supabase-access.sql` | 스마트보드 프로젝트(`pqreeimkjnphupqqwiqo`)에 적용한 표·함수 원본. 다시 적용해도 안전(if not exists / or replace) |
| `vendor/exceljs.min.js` | ExcelJS 4.4.0 동봉(학교망 CDN 차단 대비). 글꼴(Pretendard)만 CDN이며 막히면 시스템 글꼴로 대체 |
| `tests/engine.test.js` | 엔진 단위·통합 테스트 + 예전 파이썬 방식(500회 몬테카를로) 이식본과 비교 |
| `tests/verify.js` | 검증 리포트: 하한선 비교, 1~4차 연간 시뮬레이션, 같은 교실 금지 영향 |

## 상태(state) 구조 요약

```
{ version: 2, term: '1차 고사'|…|'4차 고사',
  options: { exclude3rd, studyHallClassroom, corridors, noRepeatRoom, roomHistoryScope:'exam'|'year', compensate3rd },
  classes: [7,7,7],
  days: [{ date, periods, subjects: [[cell×3]…], exceptions: [{period, name, reason}] }],
  teachers: [{ name, subject, homeroom, type, target, prev }],
  specials: [{ room, teacher, hours }],
  roomHistory: { 이름: ['2-3', '1-음악실'] },
  result: { createdAt, term, sig, assign: {slotId: 이름}, pinned: {slotId: true} } | null,
  meta: { savedAt, backupAt, dirty } }
cell = { name, study: [반], exclude: [반], special, room, multi }
```
- 두 과목은 `name`에 `'/'`로 합쳐 저장(화면에서는 두 칸). 예전 `과목*(장소)` 표기는 `normalizeCell`이 `special/room`으로 변환.
- `renderers.extras`는 `teachers`의 별칭(예전 5단계 구성 호환).

## 확정된 규칙·결정

- **4차에 빠지는 3학년 담임은 3차까지의 평균이 기준** → `compensate3rd` 기본 0(고급 옵션으로만 남김).
- 같은 교실 두 번 금지 옵션은 기본 켬(이번 시험 안에서). 검증상 부족 자리·시수 차이에 영향 없음.
- 엔진 결과는 이론상 하한선과 같거나 1시간 차(55명 사례). 남는 차이는 규칙(본인 시험이 많은 과목, 고사담당 1교시) 때문.
- 복도와 자습은 합계(`W.SUB`)뿐 아니라 각각(`W.KIND`, 복도²+자습²)도 고르게 맞춤. 교사 수가 적어 1인당 복도·자습이 2회 이상일 때 "복도만 2회"인 교사가 10~13명 → 0명으로 줄었고 부족·총 시수 범위는 그대로(PR #10).
- 디자인 방향: 상용 프로그램처럼 절제된 색, 밀도 높은 배치, 스크롤 최소화. 사용자는 24인치(약 1920~2000px)와 노트북(1366px)에서 봄.
- 교사 탭(명단·특수실·예외)과 결과 탭은 페이지 스크롤 없이 탭 높이를 창에 맞추고(`#tab-*.active` flex 열, 높이 `100vh - var(--chrome-h)`), 긴 표는 각자 안에서 스크롤. 1280px 이하에서는 세로 쌓임으로 돌아감.
- 결과 요약(부족·위반·누적 범위·평균·교실중복·📌)은 큰 카드 대신 배정 머리줄의 칩(`kpiHTML`, 버튼과 같은 32px 높이)으로 둬 표 높이를 확보. 1366px에서도 한 줄.
- 설명서는 세로 스크롤 한 장이 아니라 11개 챕터를 이전/다음으로 넘기는 구조. 각 챕터의 "실제 화면" 상자는 스크린샷이 아니라 보기 자료(`demoState`, 교사 48명·2일)로 진짜 렌더러를 돌려 만든 HTML(`inert`로 조작 불가)이며, `shot(html, selector, [[selector, 번호]])`로 요소에 빨간 번호표를 붙임. UI 구조가 바뀌면 선택자(`data-act`, `data-bind` 등)를 같이 손봐야 함. 입력 요소(input/select)는 번호표를 부모에 붙임.
- 엑셀: 감독표·개인별시간표 본문의 이름 칸은 `shrinkToFit`(셀에 맞춤), 머리글 과목·과목 열·비고는 줄바꿈 유지.
- 전역 `word-break: keep-all`로 한글 단어 중간 줄바꿈("1차고/사") 방지.
- 추가반은 교시·학년당 하나(두 과목이 동시에 치러져도 교실은 하나만 추가). 과목별 추가반은 사용자가 필요 없다고 확인함(2026-10-04).
- 추가반 장소가 "8반"처럼 반 번호 형식이고 그 학년 반 수보다 크면 결과표·엑셀의 그 번호 열에 바로 들어감(`slot.colNo`, `model.gridCols`, `model.colSlot`). 이름형(음악실 등)만 "추가반/특별실" 열. 사용자 학교는 추가반을 "8반"이라 부름(PR #13).

## 접속 암호 (PR #11)

- 페이지를 열면 `#gate`(index.html)가 먼저 보이고, 암호가 맞아야 `startApp()`이 앱을 그림. 매번 묻고 기억하지 않음(사용자 요구).
- 암호 비교는 스마트보드 Supabase 프로젝트의 `proctor_check()` 함수 안에서(bcrypt). 해시 표 `proctor_config`는 RLS 켜고 정책 없음 + anon/authenticated 권한 회수라 API로 읽을 수 없음. 틀린 시도 10분 30회 제한(`proctor_attempts`).
- 암호 바꾸기 두 가지: ① 암호 화면의 "접속 암호 바꾸기 (관리자)" → 스마트보드 관리자 이름·비밀번호로 Supabase Auth 로그인(`이름@smartboard.local`) 후 `proctor_set_password` 호출(함수 안에서 `assert_admin()` 검사). ② 대시보드 SQL Editor에서 `select proctor_set_password('새 암호');` (postgres 역할은 관리자 검사 생략).
- 이 서버를 고른 이유: 무료 요금제는 7일 미사용 시 일시정지되므로 연중 쓰이는 프로젝트여야 함. 다른 프로젝트(SmartInterview, moving-class, 08hwichemi3's Project)는 계절성.
- 이 작업 환경의 프록시가 `*.supabase.co`를 막아 브라우저·curl로 실제 호출은 못 해 봤음. 함수는 SQL로 검증(맞음/틀림/null), 화면은 Playwright에서 RPC 응답을 가짜로 넣어 검증. 실제 접속 확인은 사용자가 배포 후 해야 함.
- 소스가 공개 저장소에 있으므로 이 암호는 "링크로 들어오는 사람 막기" 수준. 저장소를 내려받아 로컬에서 열면 `config.js`를 비워 쓸 수 있음(사용자가 인지하고 선택).

## 검증 방법

```
node tests/engine.test.js      # 엔진 테스트
node tests/verify.js [1]       # 검증 리포트 (1 = 빠르게)
python3 -m http.server 8765    # 로컬 확인
```
브라우저 자동 테스트 스크립트는 세션 임시 폴더에 있었고 저장소에는 없음. 필요하면 Playwright(동봉 Chromium)로 다시 작성: 처음 안내창 닫기 → 과목 붙여넣기/추가반/두 과목 → 교사 붙여넣기 → 예외 추가 → 배정 → 칸 수정·맞바꾸기 → 엑셀·백업 저장 → 새로고침 복원 → 이전 결과 엑셀에서 누적·교실 이력 불러오기.

## 사용자가 아직 확인하지 않은 것 / 다음 후보

- 실제 교사 명단으로 돌렸을 때 "배정 전 점검" 목록 내용(과목명 불일치 등). 과목명 매칭 규칙(`subjectMatches`: 접두 + 로마숫자/괄호)을 더 다듬어야 할 수 있음.
- 실제 엑셀 결과 파일을 Windows 엑셀에서 연 모습(병합·조건부 서식·수식)은 이 환경에서 열어 보지 못함.
- 모바일은 보조 수준(과목 표 가로 스크롤).
