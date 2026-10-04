// 실행: node tests/engine.test.js
// 가상 학교 데이터로 배정 엔진을 돌려 하드 규칙 위반이 없는지, 시수가 고른지 확인합니다.
'use strict';
const assert = require('assert');
const E = require('../js/engine.js');

function rngFactory(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeState(seed, term) {
  const r = rngFactory(seed);
  const subjects = ['국어', '수학', '영어', '한국사', '통합과학', '통합사회', '물리학', '화학', '생명과학', '지구과학', '윤리', '지리', '역사', '정보', '체육', '음악', '미술', '기술가정', '일본어', '중국어'];
  const exams = [
    [['국어', '수학Ⅰ', '영어Ⅰ'], ['통합과학', '화학', '윤리'], ['한국사', '지구과학', '자습']],
    [['수학', '국어', '물리학'], ['영어', '생명과학', '지리'], ['통합사회', '역사', '']],
    [['정보', '영어', '국어'], ['한국사', '수학Ⅱ', '화학'], ['', '', '']],
  ];
  const days = exams.map((rows, d) => ({
    date: `4/${27 + d}`,
    periods: 3,
    subjects: rows.map((row, p) => row.map((name, g) => ({ name: d === 0 && p === 0 && g === 0 ? '국어*(음악실)' : name, study: d === 1 && p === 2 && g === 1 ? [6, 7] : [], exclude: d === 0 && p === 1 && g === 2 ? [7] : [] }))),
    exceptions: [],
  }));
  days[2].subjects[2] = [{ name: '자습', study: [], exclude: [] }, { name: '', study: [], exclude: [] }, { name: '', study: [], exclude: [] }];
  const teachers = [];
  for (let i = 0; i < 80; i++) {
    const g = (i % 3) + 1;
    let type = '일반';
    if (i < 4) type = '원로';
    else if (i < 7) type = '고사담당';
    else if (i < 9) type = '순회';
    else if (i === 9) type = '제외';
    teachers.push({
      name: `교사${String(i + 1).padStart(2, '0')}`,
      subject: subjects[i % subjects.length] + (i % 7 === 0 ? '/' + subjects[(i + 3) % subjects.length] : ''),
      homeroom: i < 63 && i >= 10 ? `${g}-${(Math.floor(i / 3) % 7) + 1}` : (i === 70 ? '3-부장' : ''),
      type,
      target: type === '원로' ? 3 : '',
      prev: term === '1차 고사' ? '' : String(Math.floor(r() * 4) + 6),
    });
  }
  days[0].exceptions.push({ period: '1교시', name: '교사20', reason: '출장' });
  days[1].exceptions.push({ period: '전체', name: '교사21', reason: '연가' });
  return {
    term, options: { exclude3rd: true, studyHallClassroom: false, corridors: 2 }, classes: [7, 7, 7], days, teachers,
    specials: [{ room: '특수학급', teacher: '교사80', hours: 3 }],
  };
}

// ---- 기존 파이썬 로직(500회 몬테카를로) JS 이식: 비교용 ----
function legacy(model, attempts, seed) {
  const r = rngFactory(seed);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let best = null, bestScore = Infinity;
  const P = model.P, D = model.D;
  for (let at = 0; at < attempts; at++) {
    const st = model.teachers.map((t) => ({ t, cur: t.prev, cls: 0, cor: 0, sh: 0, hist: Array.from({ length: D }, () => []), tp: Array.from({ length: D }, () => 1 + Math.floor(r() * 3)) }));
    const assign = {};
    let short = 0;
    for (const per of model.periods) {
      const free = new Set(st.map((_, i) => i));
      const slots = shuffle(model.slots.filter((s) => s.pi === per.pi));
      for (const s of slots) {
        const avail = [];
        for (const i of free) {
          const x = st[i], t = x.t;
          if (t.type === '제외' || t.isSpecial) continue;
          const examRoom = (s.kind !== 'corridor') && !s.study;
          if (t.type === '순회' && examRoom) continue;
          if (t.type === '원로') {
            if (s.kind === 'corridor' || s.study) continue;
            const ex = x.cls + x.cor + x.sh;
            if (t.target != null && ex >= t.target) continue;
            if (t.dailyMax != null && x.hist[per.d].length >= t.dailyMax) continue;
          }
          if (t.type === '고사담당' && per.p > 1) continue;
          if (model.ownExam[t.ti * P + per.pi]) continue;
          if (t.exceptP.has(per.pi) || t.exceptAll.has(per.d)) continue;
          const h = x.hist[per.d];
          if (h.includes(per.p - 1) && h.includes(per.p - 2)) continue;
          avail.push(i);
        }
        shuffle(avail);
        const key = (i) => {
          const x = st[i], t = x.t, sub = s.kind === 'corridor' || s.study;
          return [x.hist[per.d].length, sub ? (t.type === '순회' ? -1 : 1) : 0, -(t.type === '고사담당' && per.p === 1 ? 1 : 0),
            -(t.type === '원로' && per.p >= x.tp[per.d] ? 1 : 0), (t.type === '원로' && per.p < x.tp[per.d] ? 1 : 0),
            sub ? x.sh + x.cor : x.cls, x.cls + x.cor + x.sh, x.cur];
        };
        avail.sort((a, b) => { const ka = key(a), kb = key(b); for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k]; return 0; });
        const pick = avail.find((i) => !(s.kind === 'class' && st[i].t.homeroom.g === s.grade && st[i].t.homeroom.c === s.classNo));
        if (pick == null) { short++; assign[s.id] = ''; continue; }
        const x = st[pick];
        assign[s.id] = x.t.name; x.cur++;
        if (s.study) x.sh++; else if (s.kind === 'corridor') x.cor++; else x.cls++;
        x.hist[per.d].push(per.p); free.delete(pick);
      }
    }
    const reg = st.filter((x) => !['제외', '원로', '순회'].includes(x.t.type));
    const v = (arr) => { const a = arr.reduce((p, c) => p + c, 0) / arr.length; return arr.reduce((p, c) => p + (c - a) ** 2, 0); };
    let senior = 0;
    st.forEach((x) => { if (x.t.type === '원로' && x.t.target != null) senior += Math.max(0, x.t.target - (x.cls + x.cor + x.sh)) * 1000; });
    const score = short * 10000 + senior + Math.floor(v(reg.map((x) => x.cur)) * 100 + v(reg.map((x) => x.cor + x.sh)) * 50 + v(reg.map((x) => x.cls)) * 50);
    if (score < bestScore) { bestScore = score; best = assign; }
  }
  return best;
}

function hardCheck(model, assign) {
  const ev = E.evaluate(model, assign);
  return ev;
}

function describe(label, model, ev) {
  const bal = ev.stats.filter((s) => s.group === 'balance');
  const tot = bal.map((s) => s.prev + s.total);
  const thisTerm = bal.map((s) => s.total);
  const sub = bal.map((s) => s.corridor + s.study);
  const dayMax = bal.map((s) => {
    let mx = 0;
    for (let d = 0; d < model.D; d++) mx = Math.max(mx, model.periods.filter((p) => p.d === d && s.cells[p.pi] && s.cells[p.pi] !== '본인시험').length);
    return mx;
  });
  const range = (a) => `${Math.min(...a)}~${Math.max(...a)}`;
  const corr = bal.map((s) => s.corridor), stu = bal.map((s) => s.study);
  console.log(`  ${label}: 부족 ${ev.summary.shortage}, 위반칸 ${ev.summary.violations}, 누적합계 ${range(tot)}, 이번시수 ${range(thisTerm)}, 복도+자습 ${range(sub)} (복도 ${range(corr)}, 자습 ${range(stu)}), 하루최대 ${Math.max(...dayMax)}`);
  return { spread: Math.max(...tot) - Math.min(...tot), shortage: ev.summary.shortage, violations: ev.summary.violations };
}

module.exports = { makeState, legacy, describe };
if (require.main !== module) return;

// ---------------- 단위 테스트 ----------------
(function unit() {
  const pc = E.parseCell({ name: '수학*(음악실)', study: [1], exclude: [2] }, 7);
  assert.strictEqual(pc.examName, '수학'); assert.strictEqual(pc.special, true); assert.strictEqual(pc.room, '음악실');
  assert.deepStrictEqual(pc.study, [1]); assert.deepStrictEqual(pc.exclude, [2]);
  const pc2 = E.parseCell({ name: '수학*', study: [1], exclude: [] }, 7);
  assert.strictEqual(pc2.room, '8반'); assert.deepStrictEqual(pc2.study, [1]);
  const pc3 = E.parseCell({ name: '국어(자습:1,2)(제외:3)' }, 7);
  assert.strictEqual(pc3.examName, '국어'); assert.deepStrictEqual(pc3.study, [1, 2]); assert.deepStrictEqual(pc3.exclude, [3]);
  assert.strictEqual(E.parseCell({ name: '' }, 7).active, false);
  assert.strictEqual(E.parseCell({ name: '자습' }, 7).allStudy, true);
  assert.ok(E.subjectMatches(E.norm('수학'), E.norm('수학Ⅰ')));
  assert.ok(!E.subjectMatches(E.norm('물리'), E.norm('물리학Ⅰ')));
  assert.strictEqual(E.parsePeriodValue('2교시'), 2);
  assert.strictEqual(E.parsePeriodValue(' 전체 '), 'all');
  assert.strictEqual(E.normalizeType(' 제외 ').type, '제외');
  console.log('단위 테스트 통과');
})();

// ---------------- 통합 테스트 ----------------
let worse = 0;
for (const [seed, term] of [[1, '1차 고사'], [2, '2차 고사'], [3, '4차 고사']]) {
  const state = makeState(seed, term);
  const model = E.buildModel(state);
  assert.ok(!model.issues.some((i) => i.level === 'error'), JSON.stringify(model.issues));
  console.log(`\n[${term}] 자리 ${model.slots.length}개, 교사 ${model.T}명`);
  const t0 = Date.now();
  const res = E.optimize(model, { seed });
  const ms = Date.now() - t0;
  const evNew = hardCheck(model, res.assign);
  const a = describe(`새 엔진 (${ms}ms)`, model, evNew);
  const t1 = Date.now();
  const old = legacy(model, 500, seed);
  const evOld = hardCheck(model, old);
  const b = describe(`기존 방식 (${Date.now() - t1}ms)`, model, evOld);
  assert.strictEqual(a.violations, 0, '새 엔진 결과에 규칙 위반이 있습니다: ' + JSON.stringify(evNew.violations));
  if (a.shortage > b.shortage || (a.shortage === b.shortage && a.spread > b.spread)) worse++;

  // 고정(직접 수정) 칸 유지 확인
  const first = model.slots.find((s) => s.kind === 'corridor');
  const someone = model.teachers.find((t) => E.slotOK(model, t, first)).name;
  const res2 = E.optimize(model, { seed: seed + 100, pins: new Map([[first.id, someone]]), runs: 1 });
  assert.strictEqual(res2.assign[first.id], someone);
  const dup = Object.entries(res2.assign).filter(([id, n]) => n === someone && model.slotById.get(id).pi === first.pi);
  assert.strictEqual(dup.length, 1, '고정한 교사가 같은 교시에 또 배정됨');

  if (term === '4차 고사') {
    const t3 = model.teachers.filter((t) => t.homeroom.g === 3);
    assert.ok(t3.every((t) => t.type === '제외'));
    assert.ok(t3.every((t) => evNew.stats[t.ti].total === 0));
  }
}
assert.strictEqual(worse, 0, '새 엔진이 기존 방식보다 나쁜 경우가 있습니다');

// ---- 같은 교실 금지 (이번 시험 / 이전 회차 이력)
{
  const state = makeState(9, '2차 고사');
  state.options.noRepeatRoom = true;
  state.options.roomHistoryScope = 'year';
  state.roomHistory = { '교사30': ['1-1', '1-2', '1-3', '2-1', '2-2'], '교사31': ['3-5'] };
  const model = E.buildModel(state);
  const res = E.optimize(model, { seed: 9, runs: 1 });
  const ev = E.evaluate(model, res.assign);
  assert.strictEqual(ev.summary.shortage, 0);
  assert.strictEqual(ev.summary.violations, 0, JSON.stringify(ev.violations));
  assert.strictEqual(ev.summary.repeatRooms, 0);
  model.slots.forEach((s) => { if (res.assign[s.id] === '교사30') assert.ok(!state.roomHistory['교사30'].includes(E.roomKey(s) || ''), '이전 회차 교실에 다시 배정됨'); });
  // 1차 고사에서는 이력을 무시
  state.term = '1차 고사';
  assert.strictEqual(E.buildModel(state).useHistory, false);
  console.log('같은 교실 금지 테스트 통과');
}

// ---- 3학년 담임 연간 보정: 1~3차에서만, 3학년 담임/부장에게만 누적을 낮춰 봄
{
  const state = makeState(10, '2차 고사');
  state.options.compensate3rd = 1;
  const model = E.buildModel(state);
  const g3 = model.teachers.find((t) => t.homeroom.g === 3 && t.homeroom.c != null);
  const head3 = model.teachers.find((t) => t.homeroom.head && t.homeroom.g === 3);
  const g2 = model.teachers.find((t) => t.homeroom.g === 2);
  assert.strictEqual(g3.prevAdj, g3.prev - 2);
  assert.strictEqual(head3.prevAdj, head3.prev - 2);
  assert.strictEqual(g2.prevAdj, g2.prev);
  state.term = '4차 고사';
  assert.ok(E.buildModel(state).teachers.every((t) => t.prevAdj === t.prev));
  console.log('3학년 담임 보정 테스트 통과');
}
// ---- 복도·자습을 따로 고르게: 교사 수가 적어 1인당 복도·자습이 2회 이상 될 때, 한 사람이 복도만/자습만 맡지 않음
{
  const state = makeState(1, '1차 고사');
  state.options.studyHallClassroom = true;
  state.days[1].subjects[2][2] = { name: '자습', study: [], exclude: [] };
  state.days[0].subjects[1][0].study = [1, 2, 3];
  state.teachers = state.teachers.filter((t, i) => i < 10 || i >= 40 || (i - 10) % 3 !== 2).slice(0, 50);
  const model = E.buildModel(state);
  const opt = E.createOptimizer(model, { seed: 1 });
  while (opt.step(50000) < 1) { /* 끝까지 */ }
  const ev = E.evaluate(model, opt.result().assign);
  const bal = ev.stats.filter((s) => s.group === 'balance');
  assert.strictEqual(ev.summary.shortage, 0);
  assert.ok(bal.some((s) => s.corridor + s.study >= 2), '1인당 복도+자습이 2회 이상인 교사가 있어야 의미 있는 검사');
  const corrOnly = bal.filter((s) => s.corridor >= 2 && s.study === 0).length;
  const stuOnly = bal.filter((s) => s.study >= 2 && s.corridor === 0).length;
  assert.ok(corrOnly <= 2, `복도만 2회 이상인 교사 ${corrOnly}명`);
  assert.ok(stuOnly <= 2, `자습만 2회 이상인 교사 ${stuOnly}명`);
  console.log(`복도·자습 분리 균형 테스트 통과 (복도만 ${corrOnly}명, 자습만 ${stuOnly}명)`);
}
console.log('\n통합 테스트 통과');
