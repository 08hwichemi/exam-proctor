# 작업 인수인계 (2026-10-08 기준)

새 대화에서 이어서 작업할 때 먼저 읽는 문서입니다. 사용자 안내는 `README.md`, 상세 사용법은 앱 안의 설명서(`js/app.js`의 `helpHTML`)에 있습니다.

새 채팅방에서는 이 저장소(`08hwichemi/exam-proctor`)로 세션을 열고 아래를 붙여넣으면 됩니다.

```
docs/HANDOFF.md 를 먼저 읽고 이어서 작업하자.
```

## ▶ 다음 채팅 시작점 (2026-10-08 작성)

- `main`이 최신이고 앞선 `claude/*` 브랜치 작업은 없음. 새 채팅은 `main`에서 새 브랜치로 시작(시작할 때 `git fetch` 뒤 main보다 앞선 브랜치가 있는지 한 번 볼 것).
- 지난 채팅(10/6~10/8, 브랜치 `claude/cool-carson-juslhs`)에서 한 일: **브라우저 통합 검사 `tests/browser.test.js` 추가**(PR #20으로 main 병합). 앱 코드는 바꾸지 않음. 보기 자료로 #17·#18 기능이 모두 기대대로 동작함을 확인.
- **주의 — 저장소 혼동**: 지난 채팅에서 사용자가 스마트보드의 "수업 변경 → 보강" 화면 수정을 이 채팅에서 요청했음. 그 작업은 스마트보드 저장소(`08hwichemi/smartboard`)를 따로 받아 거기서만 고치고 배포(판 2026-10-08.1)했고, **이 저장소에는 아무것도 섞이지 않았음**. 스마트보드 기록은 그 저장소의 `docs/이어서-작업하기.md`에 있음. 스마트보드 화면(수업 변경, 시정표, 생기부 등) 요청이 오면 이 저장소가 아니라는 것을 먼저 사용자에게 알리고, 스마트보드 저장소로 새 채팅을 열도록 권할 것.
- 사용자가 아직 확인하지 않은 것: 아래 "사용자가 아직 확인하지 않은 것" 목록 그대로(특히 반 수 7로 고친 뒤 실제 명단으로 #17·#18 결과 보기).

## 지금 상태

- 파이썬(PyQt) 시험 감독 배정 프로그램(`main.py`)을 **서버 없는 웹앱**으로 옮겨 `main` 브랜치에 병합 완료. GitHub Pages 주소: `https://08hwichemi.github.io/exam-proctor/` (Pages 설정은 저장소 Settings → Pages에서 `main` / root).
- PR #1~#20 모두 `main`에 병합 완료, `main`이 최신. 작업 방식: 새 브랜치 → PR → `main` 병합(사용자가 "main에 올려줘"로 승인하는 흐름이었고, 이후에는 세션 안에서 바로 병합해 왔음).
- 최근 PR: #8 교사 탭 창 높이·요약 칩 / #9 설명서 챕터형 / #10 복도·자습 각각 균형 / #11 Supabase 접속 암호 / #12 예외 교시 회색 / #13·#15·#16·#17 추가반 = 다음 번호 열(#14는 잘못된 되돌림) / #17 📌 이대로 고정·제외 칸 회색만·순회 우선 배치 / #18 핀 버튼·고정 모드·행·열 하이라이트 / #19 인수인계 문서 / #20 브라우저 통합 검사 스크립트.
- 사용자 학교 설정: 1~7반, 8반 교실은 특별실(추가반). 사용자 백업에는 3학년 반 수가 8로 들어 있었음 → 7로 고치라고 안내함. 순회 교사 한 분이 배정되지 않던 원인은 누적 시수가 높아서였고 #17로 해결.
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
| `tests/browser.test.js` | 브라우저 통합 검사(Playwright + 동봉 Chromium). 정적 서버를 띄우고 입력 → 배정 → 칸 수정·📌 → 엑셀·백업 저장 → 새로고침 → 누적 불러오기 → 누적 반영 → 백업 불러오기 → 설명서 → 초기화까지 22단계. 암호 화면은 `js/config.js` 요청을 빈 설정으로 가로채 건너뜀 |

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
- **추가반은 항상 "마지막 반 다음 번호" 열**(반 수 7이면 8반 열)에 들어감(#17). 장소 이름(5층 국어교과실 등)은 칸 안에 작게 덧붙고, 별도 "추가반/특별실" 열은 없음(`model.hasNamedSpecial`는 항상 false). "9반"처럼 반 수보다 큰 번호를 적으면 그 번호 열. 반 수 안의 번호(이미 있는 반)와 겹치면 추가반을 만들지 않고 점검 경고. 사용자 학교: 1~7반 + 8반이 특별실 → 반 수 7, 필요한 교시에 +추가반. 사용자 백업에는 3학년 반 수가 8로 들어 있어 8반이 정규 반으로 잡혀 있었음(사용자가 7로 고쳐야 함). #13→#14(되돌림)→#15(복원)→#16→#17로 오락가락했으니 **다시 되돌리지 말 것**.
- 순회 교사는 누적 시수와 무관하게 복도·자습에 최대한 배치(`W.ITIN`: 들어갈 수 있는데 비는 교시마다 벌점, `W.ITIN_BAL`: 순회끼리 편차). 사용자 요구(2026-10-06). 이전에는 일반과 같은 누적 기준이라 누적 높은 순회가 0시간이 됐음.
- 결과 칸을 눌러 **📌 이대로 고정**(바꾸지 않고 고정) 가능. 제외반·예외 교시 칸은 회색만(글자 없음, 툴팁에 이유).
- 고정을 더 쉽게(#18): 칸에 마우스를 올리면 📌 버튼(`.pinbtn`, `data-act="pin-toggle"` / 개인별은 `pin-toggle-p`)이 나타나 창 없이 고정/해제. 머리줄의 **📌 고정 모드**(`ui.pinMode`)를 켜면 칸 클릭이 고정/해제만 함. 결과표 재렌더는 `rerenderResult()`로 스크롤 위치 유지.
- 결과표 행·열 하이라이트: `mouseover` 위임으로 `.hl-row`/`.hl-col` 클래스. 감독표는 일차·교시가 rowspan이라 모든 칸에 `data-c`(열 번호)를 붙여 씀. 개인별 시간표·시수표는 cellIndex. 바탕색 위에 `background-image` 그라데이션으로 겹쳐 칠함.

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
node tests/browser.test.js     # 브라우저 통합 검사 (--show 창 보기, --slow 천천히). 약 20초
python3 -m http.server 8765    # 로컬 확인
```
브라우저 검사 요령(`tests/browser.test.js`에 구현돼 있음): Playwright는 `require('playwright')` 또는 `/opt/node-tools/node_modules/playwright`에서 찾고, 브라우저는 `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`의 Chromium. `js/config.js` 요청을 `window.PROCTOR_AUTH = { url: "", anonKey: "" }`로 가로채 암호 화면을 건너뛰고, 글꼴 CDN은 막음(학교망과 같은 조건). `examProctor.ui`에 `{tab, sub, seenIntro:true}`를 넣어 처음 안내창 없이 원하는 탭에서 시작. UI 선택자(`data-act`, `data-bind`, `data-id`, `.pinbtn`, `.hl-row` 등)를 바꾸면 이 스크립트도 같이 손봐야 함.
- 헤드리스 Chromium은 **한글 파일 이름**의 다운로드를 `download`로 보고함(ASCII 이름은 정상). 실제 Chrome에서는 문제없고 사용자도 엑셀·백업을 저장해 왔으므로 앱은 손대지 않았고, 검사는 `<a download>` 속성에서 앱이 붙인 이름을 읽어 확인함.
- 누적 범위 검사는 "가능 교시를 다 채운 교사"(예외·본인 시험으로 들어갈 자리가 1~2개뿐인 분)를 빼고 봄. 보기 자료에서 교사21(영어, 2일차 종일 예외)이 가능 교시 1개라 전체 범위는 2~6으로 보이지만 나머지 일반 교사는 전원 같은 시수였음(엔진 문제 아님).

## 사용자가 아직 확인하지 않은 것 / 다음 후보

- 실제 교사 명단으로 돌렸을 때 "배정 전 점검" 목록 내용(과목명 불일치 등). 과목명 매칭 규칙(`subjectMatches`: 접두 + 로마숫자/괄호)을 더 다듬어야 할 수 있음.
- 실제 엑셀 결과 파일을 Windows 엑셀에서 연 모습(병합·조건부 서식·수식)은 이 환경에서 열어 보지 못함.
- 모바일은 보조 수준(과목 표 가로 스크롤).
- 접속 암호 화면은 사용자가 실제 배포에서 암호 설정·접속까지 확인함(2026-10-04). 이 작업 환경에서는 `*.supabase.co`가 막혀 있어 직접 호출 시험은 불가.
- 사용자가 아직 확인 안 한 것: #17·#18(추가반 다음 번호 열, 순회 우선 배치, 핀 버튼·고정 모드·하이라이트)을 실제 명단으로 돌린 결과. 반 수를 7로 고친 뒤 "처음부터 새로 배정"을 돌려 보라고 안내함.
- 브라우저 통합 검사는 이제 저장소에 있음(`tests/browser.test.js`, 2026-10-06). #17·#18 기능(추가반 8반 열, 순회 우선 배치, 핀 버튼·고정 모드·행·열 하이라이트, 제외·예외 칸 회색)이 보기 자료(교사 48명·2일 5교시)로는 모두 기대대로 동작함을 확인. 실제 명단으로는 아직 사용자 확인 전.
