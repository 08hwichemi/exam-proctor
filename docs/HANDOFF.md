# 작업 인수인계 (2026-10-04 기준)

새 대화에서 이어서 작업할 때 먼저 읽는 문서입니다. 사용자 안내는 `README.md`, 상세 사용법은 앱 안의 설명서(`js/app.js`의 `helpHTML`)에 있습니다.

## 지금 상태

- 파이썬(PyQt) 시험 감독 배정 프로그램(`main.py`)을 **서버 없는 웹앱**으로 옮겨 `main` 브랜치에 병합 완료. GitHub Pages 주소: `https://08hwichemi.github.io/exam-proctor/` (Pages 설정은 저장소 Settings → Pages에서 `main` / root).
- 작업 브랜치 `claude/happy-shannon-wu6197`는 `main`과 같은 상태. 지금까지 PR #1~#6을 모두 병합했음.
- 암호(라이선스 키)는 제거. `keygen.py`, `main.py`는 참고용으로만 남아 있음(비밀 단어가 공개 저장소에 노출되어 있으니 파이썬 버전을 계속 배포한다면 바꿔야 함).

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 뼈대. 상단 바, 단계 표시(`#steps`), 4개 탭 섹션 |
| `css/style.css` | 디자인 체계(13px 기준, CSS 변수, 일차 색 4종 `day-c0~3`) |
| `js/engine.js` | 배정 엔진. 입력 해석(`parseCell`, `parseHomeroom`), 모델(`buildModel`), 최적화(`createOptimizer`: 그리디 초안 + 담금질), 검사(`evaluate`), 서명(`inputSignature`). Node에서도 로드됨 |
| `js/excel.js` | ExcelJS로 교사 명단·이전 결과 읽기, 결과 3개 시트 쓰기(`exportResult`) |
| `js/app.js` | 화면 전부. 상태(`state`), 자동 저장(localStorage `examProctor.v2`), 백업 파일, 예전 DATA SAVE 변환(`fromLegacy`), 4개 탭 렌더러, 결과 수정 모달, 설명서 |
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
- 디자인 방향: 상용 프로그램처럼 절제된 색, 밀도 높은 배치, 스크롤 최소화. 사용자는 24인치(약 1920~2000px)와 노트북(1366px)에서 봄.

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
