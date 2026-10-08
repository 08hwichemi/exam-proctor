// 실행: node tests/browser.test.js [--show] [--slow]
// 브라우저 통합 검사 — Playwright + 동봉 Chromium(/opt/pw-browsers)으로 실제 화면을 처음부터 끝까지 돌려 봅니다.
//   준비: playwright 가 require 되어야 함 (npm i -g playwright, 또는 NODE_PATH). 브라우저는 PLAYWRIGHT_BROWSERS_PATH 의 것을 씀.
//   암호 화면은 js/config.js 요청을 빈 설정으로 가로채 건너뜀. 글꼴 CDN 은 막음(학교망과 같은 조건).
//   흐름: 기본 설정 → 과목 붙여넣기·추가반·두 과목·자습/제외 → 교사 붙여넣기·특수실·예외 → 배정 → 칸 수정·맞바꾸기·비우기
//         → 📌 핀 버튼·고정 모드·고정 모두 풀기 → 행·열 하이라이트 → 개인별·시수표 → 다시 돌리기(📌 유지)
//         → 엑셀 저장(내용 검사) → 백업 저장 → 새로고침 복원 → 이전 결과 엑셀에서 누적 불러오기 → 누적 반영 → 백업 불러오기 → 설명서 → 전체 초기화
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SHOW = process.argv.includes('--show');
const SLOW = process.argv.includes('--slow');

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return require(p); } catch (e) { /* 다음 */ } }
  throw new Error('playwright 를 찾지 못했습니다. `npm i -g playwright` 또는 NODE_PATH 를 설정하세요.');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---- 검사 도우미
const fails = [];
let stepName = '';
function check(cond, msg) {
  if (cond) return true;
  fails.push(`${stepName}: ${msg}`);
  console.log(`    ✗ ${msg}`);
  return false;
}
function eq(a, b, msg) { return check(a === b, `${msg} (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }
let onStepFail = async () => '';
async function step(name, fn) {
  stepName = name;
  const t0 = Date.now();
  try { await fn(); console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) {
    const msg = String(e.message).split('\n')[0];
    const extra = await onStepFail().catch(() => '');
    fails.push(`${name}: ${msg}${extra}`); console.log(`  ✗ ${name}: ${msg}${extra}`);
  }
}

// ---- 보기 자료: 교사 48명 (원로 2, 고사담당 2, 순회 2, 제외 1, 담임 21명)
function teacherTSV() {
  const subjects = ['국어', '수학', '영어', '통합과학', '한국사', '화학', '물리학', '생명과학', '지구과학', '정보', '역사', '윤리', '기술가정', '체육', '음악', '미술', '일본어', '통합사회'];
  const rows = [['연번', '이름', '과목', '담임', '교사구분', '목표시수', '전체총시수']];
  let hr = 0;
  for (let i = 0; i < 48; i++) {
    const name = `교사${String(i + 1).padStart(2, '0')}`;
    let type = '일반';
    if (i < 2) type = '원로'; else if (i < 4) type = '고사담당'; else if (i < 6) type = '순회'; else if (i === 6) type = '제외';
    let homeroom = '';
    if (type === '일반' && hr < 21) { homeroom = `${Math.floor(hr / 7) + 1}-${(hr % 7) + 1}`; hr++; }
    else if (i === 40) homeroom = '3학년 부장';
    const subject = subjects[i % subjects.length] + (i % 9 === 0 ? ' / ' + subjects[(i + 5) % subjects.length] : '');
    rows.push([String(i + 1), name, subject, homeroom, type, type === '원로' ? '3' : '', '']);
  }
  return rows.map((r) => r.join('\t')).join('\n');
}
const SUBJECT_TSV = ['국어\t수학Ⅰ\t국어', '통합과학\t영어Ⅰ\t수학Ⅱ', '한국사\t화학Ⅰ\t영어Ⅱ', '수학\t국어\t물리학Ⅱ', '영어\t생명과학Ⅰ\t'].join('\n');

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proctor-browser-'));
  const browser = await chromium.launch({ headless: !SHOW, slowMo: SLOW ? 120 : 0 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true, locale: 'ko-KR' });
  await context.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.PROCTOR_AUTH = { url: "", anonKey: "" };' }));
  await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await context.addInitScript(() => {
    if (!localStorage.getItem('examProctor.ui')) localStorage.setItem('examProctor.ui', JSON.stringify({ tab: 'setup', sub: 'grid', seenIntro: true }));
    // 헤드리스 Chromium 은 한글 파일 이름을 "download" 로 보고하므로, 앱이 붙인 이름은 <a download> 에서 직접 읽음
    document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[download]'); if (a) window.__lastDownloadName = a.download; }, true);
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
  // 단계가 실패하면 떠 있는 창의 내용을 보여 주고 닫아, 다음 단계가 이어지게 함
  onStepFail = async () => {
    const m = page.locator('.modal-back').last();
    if (!(await m.count())) return '';
    const txt = `${await m.locator('h3').first().textContent()} — ${(await m.locator('.modal-body').innerText()).slice(0, 300).replace(/\s+/g, ' ')}`;
    while (await page.locator('.modal-back').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(50); }
    return `\n      [열려 있던 창] ${txt}`;
  };

  // 화면 안의 상태·엔진을 읽는 도우미
  const st = (expr) => page.evaluate((x) => { const state = window.__app.state; return eval(x); }, expr);
  const summary = () => page.evaluate(() => { const s = window.__app.state; const E = window.Engine; const m = E.buildModel(s); const ev = E.evaluate(m, s.result.assign); return { ...ev.summary, stats: ev.stats.map((t) => ({ name: t.name, type: t.type, group: t.group, total: t.total, cls: t.cls, corridor: t.corridor, study: t.study, prev: t.prev, avail: t.avail })) }; });
  // 일반 교사 누적 범위. 가능한 교시를 모두 채운 교사(예외·본인 시험으로 들어갈 자리가 적은 분)는 고를 수 없으니 뺌
  const balRange = (s) => { const v = s.stats.filter((t) => t.group === 'balance' && t.total < t.avail).map((t) => t.prev + t.total); return { min: Math.min(...v), max: Math.max(...v), n: v.length }; };
  const modal = () => page.locator('.modal-back').last();
  const noModal = async () => { await page.waitForSelector('.modal-back', { state: 'detached', timeout: 5000 }); };
  const tab = async (k) => { await page.click(`.step[data-tab="${k}"]`); await page.waitForSelector(`#tab-${k}.active`); };
  const waitResult = async () => { await page.waitForSelector('.result-table-panel table.res', { timeout: 90000 }); };
  const kpi = async (label) => (await page.locator('.kpi', { has: page.locator('small', { hasText: label }) }).first().locator('b').textContent()).trim();

  console.log(`브라우저 통합 검사 — ${base}`);

  await step('열기: 암호 화면 없이 1단계가 보임', async () => {
    await page.goto(base);
    await page.waitForSelector('#tab-setup.active');
    check(await page.locator('#gate').isHidden(), '암호 화면이 숨겨져야 함');
    check(!(await page.locator('.modal-back').count()), '처음 안내창은 seenIntro 로 건너뜀');
    eq(await page.locator('.step').count(), 4, '단계 4개');
  });

  await step('1단계: 일차 추가·날짜·교시 수·반 수', async () => {
    await page.click('[data-act="day-add"]');
    eq(await st('state.days.length'), 2, '일차 2개');
    await page.fill('[data-bind="days.0.date"]', '4/27 (월)');
    await page.fill('[data-bind="days.1.date"]', '4/28 (화)');
    await page.fill('[data-bind="days.1.periods"]', '2');
    eq(await st('state.days[1].periods'), 2, '2일차 2교시');
    eq(await st('state.days[0].date'), '4/27 (월)', '날짜 저장');
    await page.fill('[data-bind="classes.2"]', '7');
    eq(JSON.stringify(await st('state.classes')), '[7,7,7]', '반 수 7/7/7');
    eq(await st('state.term'), '1차 고사', '기본 회차');
  });

  await step('2단계: 과목 붙여넣기 창 → 15칸', async () => {
    await tab('subjects');
    await page.click('[data-act="subj-paste"]');
    await modal().locator('#pasteBox').fill(SUBJECT_TSV);
    await modal().locator('.modal-foot [data-i="1"]').click();
    await noModal();
    eq(await st('state.days[0].subjects[0][0].name'), '국어', '1일차 1교시 1학년');
    eq(await st('state.days[1].subjects[1][1].name'), '생명과학Ⅰ', '2일차 2교시 2학년');
    eq(await st('state.days[1].subjects[1][2].name'), '', '2일차 2교시 3학년 시험 없음');
    eq(await page.locator('.sc-name').count(), 15, '과목 입력 칸 15개');
  });

  await step('2단계: 추가반·두 과목·자습·제외 칩', async () => {
    await page.click('[data-act="sp-toggle"][data-d="0"][data-p="1"][data-g="1"]');
    await page.fill('#sc-0-1-1 .sc-room', '5층 국어교과실');
    eq(await st('state.days[0].subjects[0][0].special'), true, '추가반 켜짐');
    eq(await st('state.days[0].subjects[0][0].room'), '5층 국어교과실', '추가반 장소');
    await page.click('[data-act="subj-multi"][data-d="0"][data-p="2"][data-g="2"]');
    await page.fill('[data-subjpart="0,2,2,1"]', '지구과학Ⅰ');
    eq(await st('state.days[0].subjects[1][1].name'), '영어Ⅰ/지구과학Ⅰ', '두 과목은 / 로 합침');
    await page.click('[data-act="chip"][data-kind="study"][data-d="0"][data-p="3"][data-g="1"][data-c="6"]');
    await page.click('[data-act="chip"][data-kind="study"][data-d="0"][data-p="3"][data-g="1"][data-c="7"]');
    eq(JSON.stringify(await st('state.days[0].subjects[2][0].study')), '[6,7]', '자습 6·7반');
    await page.click('[data-act="chip"][data-kind="exclude"][data-d="0"][data-p="2"][data-g="3"][data-c="7"]');
    eq(JSON.stringify(await st('state.days[0].subjects[1][2].exclude')), '[7]', '제외 7반');
    // 자습 켠 반을 제외로 누르면 자습에서 빠짐
    await page.click('[data-act="chip"][data-kind="exclude"][data-d="0"][data-p="3"][data-g="1"][data-c="7"]');
    eq(JSON.stringify(await st('state.days[0].subjects[2][0].study')), '[6]', '제외로 옮기면 자습에서 빠짐');
    await page.click('[data-act="chip"][data-kind="exclude"][data-d="0"][data-p="3"][data-g="1"][data-c="7"]');
    // 과목 칸에 직접 붙여넣기 (엑셀 복사 → 칸 선택 → Ctrl+V)
    await page.evaluate(() => {
      const el = document.querySelector('[data-subjpart="1,1,1,0"]');
      const dt = new DataTransfer(); dt.setData('text/plain', '정보\t한국사\t역사\n기술가정\t윤리\t미술\n');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    eq(await st('state.days[1].subjects[0].map((c) => c.name).join(",")'), '정보,한국사,역사', '칸 붙여넣기 1줄');
    eq(await st('state.days[1].subjects[1].map((c) => c.name).join(",")'), '기술가정,윤리,미술', '칸 붙여넣기 2줄');
  });

  await step('3단계: 교사 명단 붙여넣기 48명·한 명 추가/삭제', async () => {
    await tab('teachers');
    await page.click('[data-act="t-paste"]');
    await modal().locator('#pasteBox').fill(teacherTSV());
    await modal().locator('.modal-foot [data-i="1"]').click();
    await noModal();
    eq(await st('state.teachers.length'), 48, '48명');
    eq(await page.locator('[data-bind^="teachers."][data-bind$=".name"]').count(), 48, '명단 표 48줄');
    eq(await st('state.teachers[0].type'), '원로', '교사구분 읽음');
    eq(await st('state.teachers[0].target'), '3', '목표시수 읽음');
    eq(await st('state.teachers[7].homeroom'), '1-1', '담임 읽음');
    eq(await st('state.teachers[40].homeroom'), '3학년 부장', '학년 부장');
    await page.click('[data-act="t-add"]');
    eq(await st('state.teachers.length'), 49, '한 명 추가');
    await page.fill('[data-bind="teachers.48.name"]', '교사01');
    await page.waitForTimeout(600);
    eq(await page.locator('[data-bind="teachers.48.name"].bad').count(), 1, '이름 중복은 빨갛게');
    await page.click('[data-act="t-del"][data-i="48"]');
    eq(await st('state.teachers.length'), 48, '삭제 후 48명');
  });

  await step('3단계: 특수실·예외 감독자(없는 이름 표시, 일차 옮기기)', async () => {
    await page.fill('[data-bind="specials.0.room"]', '특수학급');
    await page.fill('[data-bind="specials.0.teacher"]', '교사48');
    await page.fill('[data-bind="specials.0.hours"]', '3');
    eq(await st('state.specials[0].teacher'), '교사48', '특수실 담당');
    await page.click('[data-act="ex-add"]');
    await page.selectOption('[data-bind="days.0.exceptions.0.period"]', '1');
    await page.fill('[data-bind="days.0.exceptions.0.name"]', '없는사람');
    eq(await page.locator('[data-bind="days.0.exceptions.0.name"].bad').count(), 1, '명단에 없는 이름은 빨갛게');
    await page.fill('[data-bind="days.0.exceptions.0.name"]', '교사20');
    eq(await page.locator('[data-bind="days.0.exceptions.0.name"].bad').count(), 0, '명단에 있는 이름');
    await page.fill('[data-bind="days.0.exceptions.0.reason"]', '출장');
    await page.click('[data-act="ex-add"]');
    await page.fill('[data-bind="days.0.exceptions.1.name"]', '교사21');
    await page.selectOption('[data-exmove="0,1"]', '1'); // 2일차로 옮김
    eq(await st('state.days[0].exceptions.length'), 1, '1일차 예외 1건');
    eq(await st('state.days[1].exceptions[0].name'), '교사21', '2일차로 옮겨짐');
    await page.selectOption('[data-bind="days.1.exceptions.0.period"]', '전체');
    eq(await st('state.days[1].exceptions[0].period'), '전체', '종일');
  });

  await step('4단계: 점검에 오류 없음 → 배정 시작', async () => {
    await tab('result');
    eq(await page.locator('details.issue-group summary .badge.bad').count(), 0, '해결 필요 항목 없음');
    check(await page.locator('[data-act="run"]').isEnabled(), '배정 시작 버튼 활성');
    await page.click('[data-act="run"]');
    await waitResult();
    const s = await summary();
    eq(s.shortage, 0, '부족 0');
    eq(s.violations, 0, '위반 0');
    eq(await kpi('부족'), '0', 'KPI 부족 칩');
    eq(await kpi('위반'), '0', 'KPI 위반 칩');
    const br = balRange(s);
    check(br.n > 30 && br.max - br.min <= 1, `일반 교사 누적 범위 ${br.min}~${br.max} (${br.n}명, 차이 1 이하; 전체 ${s.min}~${s.max})`);
    const itin = s.stats.filter((t) => t.type === '순회');
    check(itin.every((t) => t.total > 0 && t.cls === 0), `순회는 복도·자습에만, 0시간 아님: ${JSON.stringify(itin)}`);
    check(s.stats.filter((t) => t.type === '제외').every((t) => t.total === 0), '제외 교사는 0시간');
    const senior = s.stats.filter((t) => t.type === '원로');
    check(senior.every((t) => t.total <= 3), `원로 목표 3 이하: ${JSON.stringify(senior)}`);
  });

  await step('감독표: 추가반은 8반 열, 제외 칸 회색, 예외 교사 빠짐', async () => {
    const heads = await page.locator('table.res thead th').allTextContents();
    check(heads.includes('8반'), `8반 열이 있어야 함: ${heads.join('|')}`);
    check(!heads.includes('추가반'), '별도 추가반 열은 없음');
    const sp = page.locator('td[data-id="0-1-1-sp"]');
    eq(await sp.count(), 1, '추가반 칸 존재');
    const c = await sp.getAttribute('data-c');
    eq(heads[+c], '8반', '추가반 칸은 8반 열에');
    check((await sp.innerText()).includes('5층 국어교과실'), '장소 이름이 작게 덧붙음');
    check(await st('!!state.result.assign["0-1-1-sp"]'), '추가반에 감독 배정됨');
    eq(await page.locator('td.excluded[title="감독 제외반"]').count(), 1, '제외반 칸 1개(회색)');
    eq((await page.locator('td.excluded[title="감독 제외반"]').innerText()).trim(), '', '제외 칸에 글자 없음');
    const names0 = await st('Object.entries(state.result.assign).filter(([k]) => k.startsWith("0-1-")).map(([, v]) => v)');
    check(!names0.includes('교사20'), '예외(1일차 1교시) 교사20 은 빠짐');
    const namesD1 = await st('Object.entries(state.result.assign).filter(([k]) => k.startsWith("1-")).map(([, v]) => v)');
    check(!namesD1.includes('교사21'), '예외(2일차 종일) 교사21 은 빠짐');
    check(!Object.values(await st('state.result.assign')).includes('교사07'), '제외 교사07 은 어디에도 없음');
  });

  let pinnedA, pinnedB, nameA, nameB;
  await step('칸 수정: 바로 넣기 → 📌, 맞바꾸기 → 둘 다 📌, 비우기 → 부족', async () => {
    // "바로 넣을 수 있는 선생님"이 있는 칸을 찾음 (교시에 따라 모두가 규칙에 걸릴 수 있음)
    let idA = null;
    for (let k = 0; k < 12 && !idA; k++) {
      const cell = page.locator('td.slot[data-act="slot"]:not(.empty):not(.corr)').nth(k);
      await cell.click();
      await modal().locator('.cand-search input').waitFor();
      if (await modal().locator('.cand.free').count()) idA = await cell.getAttribute('data-id');
      else { await page.keyboard.press('Escape'); await noModal(); }
    }
    check(!!idA, '바로 넣을 수 있는 후보가 있는 칸을 찾음');
    const pick = (await modal().locator('.cand.free').first().getAttribute('data-pick'));
    await modal().locator('.cand.free').first().click();
    await noModal();
    eq(await st(`state.result.assign["${idA}"]`), pick, '고른 선생님으로 바뀜');
    eq(await st(`!!state.result.pinned["${idA}"]`), true, '고친 칸은 📌');
    eq(await page.locator(`td[data-id="${idA}"] .pinbtn.on`).count(), 1, '칸에 📌 표시');
    eq(await kpi('📌'), '1', 'KPI 📌 1');
    pinnedA = idA; nameA = pick;
    // 맞바꾸기
    const cellB = page.locator('td.slot[data-act="slot"]:not(.empty):not(.corr)').nth(5);
    const idB = await cellB.getAttribute('data-id');
    const before = await st(`state.result.assign["${idB}"]`);
    await cellB.click();
    await modal().locator('.cand-search input').fill('교사');
    const sw = modal().locator('.cand.swap').first();
    if (await sw.count()) {
      const other = await sw.getAttribute('data-other'), swName = await sw.getAttribute('data-pick');
      await sw.click(); await noModal();
      eq(await st(`state.result.assign["${idB}"]`), swName, '맞바꾼 이름');
      eq(await st(`state.result.assign["${other}"]`), before, '상대 칸에는 원래 이름');
      eq(await st(`!!state.result.pinned["${idB}"] && !!state.result.pinned["${other}"]`), true, '두 칸 모두 📌');
      pinnedB = idB; nameB = swName;
    } else { await page.keyboard.press('Escape'); await noModal(); }
    // 비우기
    const cellC = page.locator('td.slot[data-act="slot"]:not(.empty).corr').first();
    const idC = await cellC.getAttribute('data-id');
    await cellC.click();
    await modal().locator('.modal-foot [data-i="0"]').click(); // 비우기
    await noModal();
    eq(await st(`state.result.assign["${idC}"]`), '', '비워짐');
    eq(await kpi('부족'), '1', '부족 1');
    eq((await page.locator(`td[data-id="${idC}"]`).innerText()).replace(/\s+/g, ''), '부족📌', '빈 칸은 부족 + 📌');
    // 빈 칸의 고정 풀기 → 다시 돌리면 채워짐
    await page.locator(`td[data-id="${idC}"]`).click();
    const unpin = modal().locator('.modal-foot .btn', { hasText: '고정 풀기' });
    eq(await unpin.count(), 1, '빈 고정 칸에는 "고정 풀기" 버튼');
    await unpin.click(); await noModal();
    eq(await st(`!!state.result.pinned["${idC}"]`), false, '고정 풀림');
  });

  await step('📌 핀 버튼(창 없이), 고정 모드, 고정 모두 풀기', async () => {
    const cell = page.locator('td.slot[data-act="slot"]:not(.empty)').nth(10);
    const id = await cell.getAttribute('data-id');
    await cell.hover();
    await cell.locator('.pinbtn').click();
    eq(await page.locator('.modal-back').count(), 0, '핀 버튼은 창을 열지 않음');
    eq(await st(`!!state.result.pinned["${id}"]`), true, '핀 버튼으로 고정');
    await page.locator(`td[data-id="${id}"]`).hover();
    await page.locator(`td[data-id="${id}"] .pinbtn`).click();
    eq(await st(`!!state.result.pinned["${id}"]`), false, '한 번 더 누르면 해제');
    // 고정 모드
    await page.check('input[data-act="pin-mode"]');
    eq(await page.locator('table.res.pinmode').count(), 1, '표에 pinmode');
    await page.locator(`td[data-id="${id}"]`).click({ position: { x: 5, y: 5 } });
    eq(await page.locator('.modal-back').count(), 0, '고정 모드에서는 창이 안 열림');
    eq(await st(`!!state.result.pinned["${id}"]`), true, '고정 모드 클릭으로 고정');
    await page.uncheck('input[data-act="pin-mode"]');
    eq(await page.locator('table.res.pinmode').count(), 0, '고정 모드 해제');
    const n = await st('Object.keys(state.result.pinned).length');
    check(n >= 3, `고정 칸 ${n}개`);
    eq(await kpi('📌'), String(n), 'KPI 📌 수');
    await page.click('[data-act="unpin-all"]');
    eq(await st('Object.keys(state.result.pinned).length'), 0, '모두 풀림');
    eq(await page.locator('[data-act="unpin-all"]').count(), 0, '풀기 버튼 사라짐');
    // 다시 돌리기를 위해 A·B 를 다시 고정
    for (const id2 of [pinnedA, pinnedB].filter(Boolean)) { await page.locator(`td[data-id="${id2}"]`).hover(); await page.locator(`td[data-id="${id2}"] .pinbtn`).click(); }
  });

  await step('행·열 하이라이트', async () => {
    const cell = page.locator('td.slot[data-act="slot"]').nth(3);
    const col = await cell.getAttribute('data-c');
    await cell.hover();
    eq(await page.locator('table.res tr.hl-row').count(), 1, '행 하나 강조');
    check((await page.locator('table.res td.hl-col').count()) > 5, '열 강조');
    eq(await page.locator(`table.res thead th.hl-col[data-c="${col}"]`).count(), 1, '머리글도 같은 열');
    await page.hover('.topbar .brand');
    eq(await page.locator('.hl-row, .hl-col').count(), 0, '표 밖으로 나가면 지워짐');
  });

  await step('개인별 시간표: 예외 칸 회색·툴팁, 핀 버튼, 시수표', async () => {
    await page.click('[data-act="sub"][data-k="person"]');
    await page.waitForSelector('td[data-act="pcell"]');
    const row20 = page.locator('table.res tbody tr', { has: page.locator('td.sticky-2 b', { hasText: /^교사20$/ }) });
    const exc = row20.locator('td.exc').first();
    eq(await exc.count(), 1, '교사20 예외 칸');
    eq((await exc.innerText()).trim(), '', '예외 칸 글자 없음');
    check((await exc.getAttribute('title')).includes('출장'), '툴팁에 사유');
    const pc = page.locator('td[data-act="pcell"]:has(.pinbtn)').first();
    const name = await pc.getAttribute('data-name'), pi = await pc.getAttribute('data-pi');
    await pc.hover(); await pc.locator('.pinbtn').click();
    const ids = await st(`window.Engine.buildModel(state).slots.filter((s) => s.pi === ${pi} && state.result.assign[s.id] === "${name}").map((s) => s.id)`);
    check(ids.length >= 1, '자리 찾음');
    eq(await st(`${JSON.stringify(ids)}.every((id) => state.result.pinned[id])`), true, '개인별 핀 → 그 자리 고정');
    await pc.hover(); await page.locator(`td[data-act="pcell"][data-name="${name}"][data-pi="${pi}"] .pinbtn`).click();
    eq(await st(`${JSON.stringify(ids)}.some((id) => state.result.pinned[id])`), false, '개인별 핀 해제');
    // 칸 클릭 → 감독 바꾸기 창, 빈 칸 클릭 → 이 교시에 넣기 창
    await page.locator(`td[data-act="pcell"][data-name="${name}"][data-pi="${pi}"]`).click({ position: { x: 5, y: 5 } });
    check((await modal().locator('h3').textContent()).includes('감독 바꾸기'), '감독 바꾸기 창');
    await page.keyboard.press('Escape'); await noModal();
    const empty = page.locator('td[data-act="pcell"]:not(.own):not(.exc):not(.spc):not(:has(.pinbtn))').first();
    await empty.click();
    check((await modal().locator('h3').textContent()).includes('이 교시에 넣기'), '이 교시에 넣기 창');
    await page.keyboard.press('Escape'); await noModal();
    await page.click('[data-act="sub"][data-k="stats"]');
    eq(await page.locator('table.res tbody tr').count(), 48, '시수표 48줄');
    await page.click('[data-act="sub"][data-k="grid"]');
    await page.waitForSelector('td[data-act="slot"]');
  });

  await step('다시 돌리기(📌 유지): 고정 칸 그대로, 부족 0', async () => {
    await page.click('[data-act="rerun"]');
    await page.waitForSelector('.progress', { timeout: 5000 }).catch(() => {});
    await waitResult();
    await page.waitForFunction(() => !document.querySelector('#prog'));
    if (pinnedA) eq(await st(`state.result.assign["${pinnedA}"]`), nameA, '고정 칸 A 유지');
    if (pinnedB) eq(await st(`state.result.assign["${pinnedB}"]`), nameB, '고정 칸 B 유지');
    const s = await summary();
    eq(s.shortage, 0, '부족 0'); eq(s.violations, 0, '위반 0');
    eq(await page.locator('.result-table-panel').count(), 1, '결과 표 있음');
  });

  let xlsxPath, backupPath;
  await step('엑셀 저장: 시트 3개·시수표 머리글·감독표 8반 열', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
    const fname = await page.evaluate(() => window.__lastDownloadName);
    check(/^부광고_1차고사_배정결과\.xlsx$/.test(fname), `파일 이름 ${fname}`);
    xlsxPath = path.join(outDir, 'result.xlsx');
    await dl.saveAs(xlsxPath);
    check(fs.statSync(xlsxPath).size > 5000, '파일 크기');
    const b64 = fs.readFileSync(xlsxPath).toString('base64');
    const info = await page.evaluate(async (b) => {
      const bin = atob(b); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf.buffer);
      const txt = (v) => (v == null ? '' : typeof v === 'object' ? (v.richText ? v.richText.map((r) => r.text).join('') : v.text || v.result || '') : String(v));
      const sheet = (n) => { const ws = wb.getWorksheet(n); const rows = []; ws.eachRow((r, i) => { rows[i - 1] = r.values.slice(1).map(txt); }); return rows; };
      return { names: wb.worksheets.map((w) => w.name), grid: sheet('결과_감독표').slice(0, 4), stats: sheet('결과_시수표').slice(0, 2), person: sheet('결과_개인별시간표').slice(0, 7).map((r) => r.slice(0, 6)) };
    }, b64);
    eq(JSON.stringify(info.names), JSON.stringify(['결과_감독표', '결과_시수표', '결과_개인별시간표']), '시트 이름');
    check(info.stats[0].some((c) => c.includes('이름')) && info.stats[0].some((c) => c.includes('전체총시수')), `시수표 머리글: ${info.stats[0].join('|')}`);
    check(info.grid.flat().some((c) => /8반/.test(c)), `감독표 머리글에 8반: ${info.grid.map((r) => r.join('|')).join(' / ')}`);
    check(info.person[5] && info.person[5][1], `개인별 6번째 줄부터 이름: ${JSON.stringify(info.person[5])}`);
  });

  await step('백업 저장 (.json)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup-save"]')]);
    const fname = await page.evaluate(() => window.__lastDownloadName);
    check(/^부광고_시험감독_백업_1차고사_\d{8}_\d{4}\.json$/.test(fname), `파일 이름 ${fname}`);
    backupPath = path.join(outDir, 'backup.json');
    await dl.saveAs(backupPath);
    const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    eq(data.version, 2, '버전 2');
    eq(data.teachers.length, 48, '교사 48명');
    check(data.result && Object.keys(data.result.assign).length > 100, '결과 포함');
    eq(await st('state.meta.dirty'), false, '백업 뒤 dirty 해제');
  });

  await step('새로고침: 결과·고정·탭 복원', async () => {
    const pinsBefore = await st('JSON.stringify(state.result.pinned)');
    const assignBefore = await st('JSON.stringify(state.result.assign)');
    await page.reload();
    await page.waitForSelector('#tab-result.active');
    await waitResult();
    eq(await st('JSON.stringify(state.result.pinned)'), pinsBefore, '고정 칸 복원');
    eq(await st('JSON.stringify(state.result.assign)'), assignBefore, '배정 복원');
    eq(await st('state.teachers.length'), 48, '교사 복원');
  });

  await step('이전 결과 엑셀에서 누적 불러오기 → 2차 고사', async () => {
    await tab('teachers');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="t-prev-import"]')]);
    await fc.setFiles(xlsxPath);
    await modal().locator('h3', { hasText: '누적 시수 불러오기' }).waitFor();
    const txt = await modal().locator('.modal-body').innerText();
    check(/48명의 누적/.test(txt), `48명 반영: ${txt.split('\n')[0]}`);
    check(/교실 이력/.test(txt), '교실 이력 보관 안내');
    await modal().locator('.modal-foot [data-i="0"]').click(); await noModal();
    eq(await st('state.term'), '2차 고사', '회차가 2차로');
    check(await st('state.teachers.every((t) => t.prev !== "")'), '모든 교사 누적 채워짐');
    check(await st('state.teachers.some((t) => +t.prev >= 2)'), '누적 값이 1차 시수');
    check((await st('Object.keys(state.roomHistory).length')) > 30, '교실 이력 보관');
  });

  await step('2차 고사: 처음부터 새로 배정 (확인창) → 누적 반영 → 3차', async () => {
    await tab('result');
    await page.click('[data-act="run"]');
    await modal().locator('.modal-foot [data-i="1"]').click(); // 새로 배정
    await waitResult();
    await page.waitForFunction(() => !document.querySelector('#prog'));
    const s = await summary();
    eq(s.shortage, 0, '부족 0'); eq(s.violations, 0, '위반 0');
    const br = balRange(s);
    check(br.n > 30 && br.max - br.min <= 1, `일반 교사 누적 범위 ${br.min}~${br.max} (${br.n}명; 전체 ${s.min}~${s.max})`);
    eq(s.repeatRooms, 0, '같은 교실 두 번 없음');
    const prevSum = await st('state.teachers.reduce((a, t) => a + (+t.prev || 0), 0)');
    await page.click('[data-act="apply-cum"]');
    await modal().locator('.modal-foot [data-i="1"]').click();
    await page.waitForSelector('#tab-teachers.active');
    eq(await st('state.term'), '3차 고사', '회차가 3차로');
    eq(await st('state.result'), null, '결과 지워짐');
    check((await st('state.teachers.reduce((a, t) => a + (+t.prev || 0), 0)')) > prevSum, '누적이 늘어남');
  });

  await step('백업 불러오기: 저장했던 1차 상태로 돌아감', async () => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="backup-load"]')]);
    await fc.setFiles(backupPath);
    await modal().locator('.modal-foot [data-i="1"]').click();
    await noModal();
    eq(await st('state.term'), '1차 고사', '1차로 복원');
    check(await st('!!state.result'), '결과 복원');
    eq(await st('state.teachers.length'), 48, '교사 48명');
  });

  await step('설명서: 챕터 넘기기·목차', async () => {
    await page.click('.topbar [data-act="help"]');
    await modal().locator('.help-chapter').waitFor();
    const toc = await modal().locator('.help-toc [data-ch]').count();
    check(toc >= 10, `목차 ${toc}개`);
    for (let i = 0; i < 4; i++) { await modal().locator('[data-nav="1"]').click(); await page.waitForTimeout(50); }
    eq(await modal().locator('.help-toc [data-ch].active').getAttribute('data-ch'), '4', '4번 넘긴 뒤 5번째 챕터');
    check((await modal().locator('.help-chapter .shot-body').count()) >= 1, '"실제 화면" 미리보기가 그려짐');
    check((await modal().locator('.help-chapter .shot-body .co').count()) >= 1, '빨간 번호표가 붙음');
    await modal().locator(`.help-toc [data-ch="${toc - 1}"]`).click();
    check((await modal().locator('.help-nav').innerText()).includes('처음으로'), '마지막 챕터');
    await page.keyboard.press('Escape'); await noModal();
  });

  await step('전체 초기화', async () => {
    await tab('setup');
    await page.click('[data-act="reset-all"]');
    await modal().locator('.modal-foot [data-i="1"]').click(); await noModal();
    eq(await st('state.teachers.length'), 0, '교사 없음');
    eq(await st('state.result'), null, '결과 없음');
    eq(await st('state.days.length'), 1, '일차 1개');
  });

  await step('페이지 오류 없음', async () => {
    eq(pageErrors.length, 0, `브라우저 오류: ${pageErrors.join(' | ')}`);
  });

  await browser.close();
  srv.close();
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
  if (fails.length) { console.log(`\n실패 ${fails.length}건:\n- ${fails.join('\n- ')}`); process.exit(1); }
  console.log('\n브라우저 통합 검사 통과');
}

main().catch((e) => { console.error(e); process.exit(1); });
