// 실행: node tests/verify.js [빠르게=1]
// 배정 엔진 검증 리포트
//   A. 결과가 이론상 하한선(가장 고른 분배)에 얼마나 가까운지, 반복 횟수·시드에 따라 흔들리는지
//   B. 1~4차 연간 누적 시뮬레이션 (4차는 3학년 시험 없음, 3학년 담임 제외 on/off, 보정 on/off)
//   C. "같은 교실 두 번 금지" 규칙을 켰을 때(이번 시험 / 연간) 부족 자리와 시수 차이
'use strict';
const E = require('../js/engine.js');
const QUICK = process.argv[2] === '1';

function rngFactory(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------
// 가상 학교: 과목별 교사 수 비율은 일반고 기준으로 대략 맞춤
// ---------------------------------------------------------------
const SUBJECT_POOL = [
  ['국어', 6], ['수학', 6], ['영어', 6], ['한국사', 1], ['통합사회', 1], ['통합과학', 1],
  ['물리학', 1], ['화학', 1], ['생명과학', 1], ['지구과학', 1], ['윤리', 1], ['지리', 1], ['역사', 1],
  ['정치와법', 1], ['경제', 1], ['정보', 1], ['체육', 2], ['음악', 1], ['미술', 1], ['기술가정', 1], ['일본어', 1], ['중국어', 1],
];
// 학년별로 시험 보는 과목 후보
const EXAMS = {
  1: ['국어', '수학', '영어', '한국사', '통합사회', '통합과학', '정보', '기술가정'],
  2: ['국어', '수학Ⅰ', '영어Ⅰ', '물리학Ⅰ', '화학Ⅰ', '생명과학Ⅰ', '지구과학Ⅰ', '윤리', '지리', '정치와법', '경제', '일본어', '중국어'],
  3: ['국어', '수학Ⅱ', '영어Ⅱ', '물리학Ⅱ', '화학Ⅱ', '생명과학Ⅱ', '역사', '윤리', '지리', '경제'],
};

function makeSchool(seed, nTeachers, classes) {
  const r = rngFactory(seed);
  classes = classes || [7, 7, 7];
  const subs = [];
  SUBJECT_POOL.forEach(([s, w]) => { for (let i = 0; i < w; i++) subs.push(s); });
  const teachers = [];
  const homerooms = [];
  for (let g = 1; g <= 3; g++) for (let c = 1; c <= classes[g - 1]; c++) homerooms.push(`${g}-${c}`);
  const hrOrder = shuffle(r, homerooms);
  for (let i = 0; i < nTeachers; i++) {
    const subject = subs[i % subs.length];
    let type = '일반';
    if (i < 3) type = '원로';
    else if (i < 5) type = '고사담당';
    else if (i < 7) type = '순회';
    else if (i === 7) type = '제외';
    teachers.push({ name: `T${String(i + 1).padStart(2, '0')}`, subject, homeroom: '', type, target: type === '원로' ? 3 : '', prev: '' });
  }
  // 담임: 일반 교사 중에서 배정, 부장 3명
  const regular = teachers.filter((t) => t.type === '일반');
  hrOrder.forEach((hr, i) => { if (regular[i]) regular[i].homeroom = hr; });
  for (let g = 1; g <= 3; g++) { const t = regular[hrOrder.length + g - 1]; if (t) t.homeroom = `${g}-부장`; }
  return { teachers, classes, r };
}

// 회차별 시험 시간표: days일 × periods교시, 3학년 시험 없음 옵션
function makeSchedule(r, days, periodsPerDay, noGrade3) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const np = periodsPerDay[d] || 3;
    const subjects = [];
    for (let p = 0; p < np; p++) {
      const row = [];
      for (let g = 1; g <= 3; g++) {
        if (g === 3 && noGrade3) { row.push({ name: '', study: [], exclude: [] }); continue; }
        // 마지막 교시에 가끔 자습
        if (p === np - 1 && r() < 0.15) { row.push({ name: '자습', study: [], exclude: [] }); continue; }
        let name = pick(r, EXAMS[g]);
        if (r() < 0.08) name += '*';
        row.push({ name, study: r() < 0.1 ? [pick(r, [1, 2, 3, 4, 5, 6, 7])] : [], exclude: [] });
      }
      subjects.push(row);
    }
    const exceptions = [];
    if (r() < 0.7) exceptions.push({ period: String(1 + Math.floor(r() * np)), name: `T${String(10 + Math.floor(r() * 30)).padStart(2, '0')}`, reason: '출장' });
    if (r() < 0.3) exceptions.push({ period: '전체', name: `T${String(10 + Math.floor(r() * 30)).padStart(2, '0')}`, reason: '연가' });
    out.push({ date: `${d + 1}일`, periods: np, subjects, exceptions });
  }
  return out;
}

function makeState(school, term, days, opts, roomHistory) {
  return {
    term, options: Object.assign({ exclude3rd: true, studyHallClassroom: false, corridors: 2 }, opts || {}),
    classes: school.classes, days, teachers: school.teachers.map((t) => Object.assign({}, t)),
    specials: [{ room: '특수학급', teacher: school.teachers[school.teachers.length - 1].name, hours: 3 }],
    roomHistory: roomHistory || {},
  };
}

// ---------------------------------------------------------------
// 하한선: 균등 그룹(일반)이 흡수해야 하는 자리를 '누적이 적은 사람부터' 채운 이상적 분배
//   capacity = 그 교사가 감독할 수 있는 교시 수
// ---------------------------------------------------------------
function lowerBound(model) {
  const bal = model.teachers.filter((t) => ['일반', '고사담당'].includes(t.type) && !t.isSpecial);
  const cap = bal.map((t) => { let c = 0; for (let p = 0; p < model.P; p++) if (model.availP[t.ti * model.P + p]) c++; return c; });
  // 균등 그룹이 아닌 교사가 최대 몇 자리 가져갈 수 있나 (원로: 목표, 순회: 가능 교시)
  let others = 0;
  model.teachers.forEach((t) => {
    if (bal.includes(t)) return;
    if (t.type === '원로') others += t.target || 0;
    else if (t.type === '순회') { for (let p = 0; p < model.P; p++) if (model.availP[t.ti * model.P + p]) others++; }
  });
  const S = model.slots.length;
  // 균등 그룹이 받는 자리 수 범위: [S - others, S]
  const fill = (need) => {
    const h = bal.map((t) => t.prev), k = bal.map(() => 0);
    let left = need;
    while (left > 0) {
      let bi = -1;
      for (let i = 0; i < h.length; i++) if (k[i] < cap[i] && (bi < 0 || h[i] < h[bi])) bi = i;
      if (bi < 0) break;
      h[bi]++; k[bi]++; left--;
    }
    return { max: Math.max(...h), min: Math.min(...h), spread: Math.max(...h) - Math.min(...h), unfilled: left };
  };
  const lo = fill(Math.max(0, S - others)), hi = fill(S);
  return { spreadLB: Math.min(lo.spread, hi.spread), maxLB: lo.max, nBal: bal.length, S };
}

function summarize(model, ev) {
  const bal = ev.stats.filter((s) => s.group === 'balance');
  const tot = bal.map((s) => s.prev + s.total);
  const cur = bal.map((s) => s.total);
  const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  return {
    shortage: ev.summary.shortage, viol: ev.summary.violations, repeats: ev.summary.repeatRooms,
    totMin: Math.min(...tot), totMax: Math.max(...tot), totSd: sd(tot),
    curMin: Math.min(...cur), curMax: Math.max(...cur),
  };
}

function fmt(s) { return `부족 ${s.shortage} 위반 ${s.viol} | 누적 ${s.totMin}~${s.totMax} (σ ${s.totSd.toFixed(2)}) | 이번 ${s.curMin}~${s.curMax} | 교실중복 ${s.repeats}`; }

// ===============================================================
// A. 하한선 비교 + 안정성
// ===============================================================
console.log('\n================ A. 최적성 검증 (하한선과 비교) ================');
const sizes = QUICK ? [[62, 1]] : [[55, 1], [62, 2], [70, 3], [85, 4]];
let gapTotal = 0, cases = 0;
for (const [n, seed] of sizes) {
  const school = makeSchool(seed, n);
  // 2차 고사 상황: 이전 누적을 0~4 사이로 흩어 놓음
  school.teachers.forEach((t, i) => { t.prev = String((i * 7) % 5); });
  const days = makeSchedule(school.r, 3, [3, 3, 2]);
  const state = makeState(school, '2차 고사', days);
  const model = E.buildModel(state);
  const lb = lowerBound(model);
  console.log(`\n교사 ${n}명 (균등 그룹 ${lb.nBal}명), 자리 ${lb.S}개, 교시 ${model.P}개 — 하한선: 누적 차이 ≥ ${lb.spreadLB}, 최대 누적 ≥ ${lb.maxLB}`);
  const seeds = QUICK ? [1, 2, 3] : [1, 2, 3, 4, 5, 6];
  const spreads = [];
  let ms = 0;
  for (const sd of seeds) {
    const t0 = Date.now();
    const res = E.optimize(model, { seed: sd });
    ms += Date.now() - t0;
    const s = summarize(model, E.evaluate(model, res.assign));
    spreads.push(s.totMax - s.totMin);
    if (sd <= 2) console.log(`  seed ${sd}: ${fmt(s)}`);
    gapTotal += (s.totMax - s.totMin) - lb.spreadLB; cases++;
  }
  console.log(`  시드 ${seeds.length}개 누적 차이: [${spreads.join(', ')}] (하한 ${lb.spreadLB}), 평균 ${Math.round(ms / seeds.length)}ms`);
  // 반복 횟수 민감도
  for (const [label, o] of [['반복 ¼', { runs: 1, iterations: 60000 }], ['반복 ×3', { runs: 3, iterations: 900000 }]]) {
    const res = E.optimize(model, Object.assign({ seed: 1 }, o));
    const s = summarize(model, E.evaluate(model, res.assign));
    console.log(`  ${label}: ${fmt(s)}`);
  }
}
console.log(`\n→ 하한선과의 평균 격차: ${(gapTotal / cases).toFixed(2)}시간 (0이면 어떤 방법으로도 더 못 줄임)`);

// ===============================================================
// B. 1~4차 연간 시뮬레이션
// ===============================================================
console.log('\n================ B. 1~4차 연간 누적 시뮬레이션 ================');
function runYear(n, seed, { exclude3rd, compensate, noRepeatRoom, scope }) {
  const school = makeSchool(seed, n);
  let prev = {}; const history = {};
  const log = [];
  let specialHoursOf = {};
  for (let term = 1; term <= 4; term++) {
    const days = makeSchedule(school.r, 3, term === 4 ? [3, 3, 2] : [3, 3, 3], term === 4);
    const state = makeState(school, E.TERMS[term - 1], days, { exclude3rd, noRepeatRoom: !!noRepeatRoom, roomHistoryScope: scope || 'exam', compensate3rd: compensate || 0 }, history);
    state.teachers.forEach((t) => { t.prev = String(prev[t.name] || 0); });
    const model = E.buildModel(state);
    const res = E.optimize(model, { seed: seed * 10 + term, runs: 2 });
    const ev = E.evaluate(model, res.assign);
    ev.stats.forEach((st) => { prev[st.name] = (prev[st.name] || 0) + st.total; });
    // 교실 이력 누적
    model.slots.forEach((s) => { const nm = res.assign[s.id]; const k = E.roomKey(s); if (nm && k) { (history[nm] = history[nm] || []).push(k); } });
    const bal = ev.stats.filter((s) => s.group === 'balance');
    const g3 = bal.filter((s) => /^3-/.test(model.teacherByName.get(s.name).homeroomRaw));
    const rest = bal.filter((s) => !g3.includes(s));
    const tot = (arr) => arr.map((s) => prev[s.name]);
    const rng = (a) => a.length ? `${Math.min(...a)}~${Math.max(...a)}` : '-';
    log.push(`  ${term}차: 자리 ${model.slots.length}, 부족 ${ev.summary.shortage}, 위반 ${ev.summary.violations}, 교실중복 ${ev.summary.repeatRooms} | 누적: 전체 ${rng(tot(bal))} · 3학년담임 ${rng(tot(g3))} · 그 외 ${rng(tot(rest))}`);
  }
  // 최종: 제외 교사(4차 3학년 담임)도 포함한 전체 일반 교사 누적
  const names = school.teachers.filter((t) => t.type === '일반' && t.name !== school.teachers[school.teachers.length - 1].name).map((t) => t.name);
  const all = names.map((nm) => prev[nm] || 0);
  const g3 = names.filter((nm) => /^3-/.test(school.teachers.find((t) => t.name === nm).homeroom)).map((nm) => prev[nm]);
  return { log, all: `${Math.min(...all)}~${Math.max(...all)}`, g3: g3.length ? `${Math.min(...g3)}~${Math.max(...g3)}` : '-', avg: (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1) };
}
for (const [n, seed] of (QUICK ? [[62, 11]] : [[55, 11], [62, 12], [70, 13]])) {
  console.log(`\n--- 교사 ${n}명 ---`);
  for (const [label, o] of [
    ['① 4차 3학년 담임 제외 (지금 기본값)', { exclude3rd: true }],
    ['② 4차에도 3학년 담임 감독', { exclude3rd: false }],
    ['③ ①에 보정 1시간: 3학년 담임은 1~3차에 회차당 1시간 더', { exclude3rd: true, compensate: 1 }],
    ['④ ①에 보정 2시간', { exclude3rd: true, compensate: 2 }],
  ]) {
    const r = runYear(n, seed, o);
    console.log(label);
    r.log.forEach((l) => console.log(l));
    console.log(`  ▶ 연말 일반 교사 누적: 전체 ${r.all} (평균 ${r.avg}), 3학년 담임 ${r.g3}`);
  }
}

// ===============================================================
// C. 같은 교실 두 번 금지
// ===============================================================
console.log('\n================ C. "한 번 들어간 교실 다시 안 들어가기" 규칙 ================');
for (const [n, seed] of (QUICK ? [[62, 21]] : [[55, 21], [62, 22], [70, 23]])) {
  const school = makeSchool(seed, n);
  const days = makeSchedule(school.r, 3, [3, 3, 3]);
  console.log(`\n--- 교사 ${n}명, 1차 고사(3일×3교시) ---`);
  for (const [label, o] of [['규칙 없음(교실 중복은 되도록 피함)', { noRepeatRoom: false }], ['이번 시험 안에서 금지', { noRepeatRoom: true }]]) {
    const state = makeState(school, '1차 고사', days, o);
    const model = E.buildModel(state);
    const res = E.optimize(model, { seed });
    const s = summarize(model, E.evaluate(model, res.assign));
    console.log(`  ${label}: ${fmt(s)}`);
  }
  console.log('  연간(1~4차, 이전 회차 교실까지 금지):');
  const r = runYear(n, seed, { exclude3rd: true, noRepeatRoom: true, scope: 'year' });
  r.log.forEach((l) => console.log(l));
  console.log(`  ▶ 연말 일반 교사 누적: 전체 ${r.all}, 3학년 담임 ${r.g3}`);
}
