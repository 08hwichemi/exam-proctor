/* =====================================================================
 * 시험 감독 배정 엔진
 *  - 입력(state) → 배정 모델(교시·자리·교사) 만들기
 *  - 그리디로 초안을 만든 뒤 담금질(simulated annealing)로 시수를 고르게 다듬기
 *  - 배정 결과 검사(규칙 위반), 시수 통계, 예비 명단 계산
 * 브라우저(window.Engine)와 Node(require) 양쪽에서 동작합니다.
 * ===================================================================== */
(function (root) {
  'use strict';

  const TYPES = ['일반', '고사담당', '원로', '순회', '제외'];
  const TERMS = ['1차 고사', '2차 고사', '3차 고사', '4차 고사'];

  // 점수(벌점) 가중치: 낮을수록 좋은 배정
  const W = {
    SHORT: 1e7,     // 감독을 못 채운 자리 1개
    OVER: 20000,    // 목표시수(상한) 초과 1시간
    SENIOR: 5000,   // 원로 교사 목표시수 미달 1시간
    TOT: 1000,      // 총 시수(누적 포함) 편차
    SUB: 300,       // 복도+자습 시수 편차
    KIND: 150,      // 복도·자습 각각의 편차 (한 사람이 복도만/자습만 하지 않게)
    CLS: 300,       // 교실 시수 편차
    DAY: 100,       // 하루에 몰림
    CONS: 40,       // 두 교시 연속
    ROOM: 10,       // 같은 교실 반복
  };

  // ---------------------------------------------------------------
  // 문자열 도우미
  // ---------------------------------------------------------------
  function norm(s) {
    // NFKC: 'Ⅰ'→'I', 전각문자→반각. 공백 제거 후 소문자.
    return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  function splitSubjects(s) {
    return String(s == null ? '' : s)
      .split(/[\/,·、]/)
      .map(norm)
      .filter(Boolean);
  }

  // 교사 과목 ts 가 시험 과목 ex 와 같은 과목인지: "수학" ↔ "수학Ⅰ", "수학(미적)" 도 같은 과목으로 봄
  function subjectMatches(ts, ex) {
    if (ts === ex) return true;
    if (!ex.startsWith(ts)) return false;
    const rest = ex.slice(ts.length);
    return /^[ivx0-9]+$/.test(rest) || /^\(.*\)$/.test(rest);
  }

  function normalizeType(raw) {
    const t = norm(raw);
    if (!t) return { type: '일반', known: true };
    if (TYPES.includes(t)) return { type: t, known: true };
    if (t.includes('제외')) return { type: '제외', known: false };
    if (t.includes('고사')) return { type: '고사담당', known: false };
    if (t.includes('원로')) return { type: '원로', known: false };
    if (t.includes('순회')) return { type: '순회', known: false };
    if (t.includes('일반')) return { type: '일반', known: false };
    return { type: '일반', known: false };
  }

  function parseHomeroom(raw) {
    const s = String(raw == null ? '' : raw).normalize('NFKC').trim();
    if (!s || /^(비담임|담임아님|없음|해당없음|무|없|x|-|—|·|\.)$/i.test(s)) return { g: null, c: null, head: false, ok: true };
    const nums = s.match(/\d+/g) || [];
    const head = s.includes('부장');
    if (head && !nums.length) return { g: null, c: null, head: true, ok: true }; // 학년 없는 부장(교무부장 등): 담임 아님
    const g = nums.length >= 1 ? parseInt(nums[0], 10) : null;
    const c = nums.length >= 2 && !head ? parseInt(nums[1], 10) : null;
    return { g, c, head, ok: g != null && (c != null || head) };
  }

  function toIntOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(String(v).normalize('NFKC').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) && String(v).trim() !== '' ? Math.round(n) : null;
  }

  function parsePeriodValue(v) {
    const s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!s) return null;
    if (s.includes('전체') || s.includes('종일') || s === '*') return 'all';
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function uniqSorted(arr) {
    return Array.from(new Set((arr || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------
  // 과목 칸 해석
  //   name: "수학", "수학*" (추가반), "수학*(음악실)", "자습", ""(시험 없음)
  //   study / exclude: 반 번호 배열
  // ---------------------------------------------------------------
  function parseCell(cell, classCount) {
    cell = cell || {};
    let text = String(cell.name == null ? '' : cell.name).trim();
    let study = uniqSorted(cell.study);
    let exclude = uniqSorted(cell.exclude);

    // 예전 방식처럼 글자로 적은 (자습:1,2) (제외:3) 도 인식
    text = text.replace(/\((자습|제외)\s*:\s*([^)]*)\)/g, (_, kind, nums) => {
      const list = (nums.match(/\d+/g) || []).map(Number);
      if (kind === '자습') study = uniqSorted(study.concat(list));
      else exclude = uniqSorted(exclude.concat(list));
      return '';
    }).trim();

    // 추가반(특별실): 새 방식은 cell.special / cell.room, 예전 방식은 과목명 뒤 "*(장소)"
    let special = false;
    let room = '';
    const star = text.match(/\*\s*(?:\(([^)]*)\))?/);
    if (star) {
      special = true;
      room = (star[1] || '').trim();
      text = (text.slice(0, star.index) + text.slice(star.index + star[0].length)).trim();
    }
    if (cell.special) {
      special = true;
      const r = String(cell.room == null ? '' : cell.room).trim();
      if (r) room = r;
    }
    if (special && !room) room = `${(classCount || 7) + 1}반`;

    // 제외가 우선: 같은 반이 자습/제외에 모두 있으면 제외
    study = study.filter((c) => !exclude.includes(c));

    let examName = text;
    let allStudy = false;
    if (examName.includes('자습')) {
      allStudy = true;
      examName = '자습';
    } else if (!examName && study.length) {
      allStudy = true;
      examName = '자습';
    }

    const hasExam = !!examName && examName !== '자습';
    const active = hasExam || allStudy || study.length > 0;
    const exams = hasExam ? splitSubjects(examName) : [];

    return { examName, hasExam, allStudy, active, special, room, study, exclude, exams };
  }

  function cellLabel(cell, classCount) {
    const pc = parseCell(cell, classCount);
    if (!pc.active) return '';
    let s = pc.examName;
    if (pc.special) s += `*(${pc.room})`;
    const tags = [];
    if (!pc.allStudy && pc.study.length) tags.push(`자습:${pc.study.join(',')}`);
    if (pc.exclude.length) tags.push(`제외:${pc.exclude.join(',')}`);
    if (tags.length) s += ` (${tags.join(' / ')})`;
    return s;
  }

  // ---------------------------------------------------------------
  // 입력 → 모델
  // ---------------------------------------------------------------
  function buildModel(state) {
    const opts = Object.assign({ exclude3rd: true, studyHallClassroom: false, corridors: 2, noRepeatRoom: false, roomHistoryScope: 'exam', compensate3rd: 0 }, state.options || {});
    const corridors = Math.max(0, Math.min(6, parseInt(opts.corridors, 10) || 0));
    const classes = [0, 1, 2].map((i) => Math.max(1, Math.min(30, parseInt((state.classes || [])[i], 10) || 7)));
    const term = state.term || TERMS[0];
    const usePrev = term !== TERMS[0];
    // 같은 교실 금지 범위: 'exam' = 이번 시험 안에서만, 'year' = 이전 회차에 들어간 교실(roomHistory)까지
    const useHistory = usePrev && !!opts.noRepeatRoom && opts.roomHistoryScope === 'year';
    const roomHistory = state.roomHistory || {};
    // 3학년 담임 연간 보정: 4차에 빠질 3학년 담임/부장에게 1~3차에서 회차당 N시간씩 더 배정되도록 누적을 낮춰 봄
    const termIdx = TERMS.indexOf(term);
    const comp = Math.max(0, Math.min(5, Number(opts.compensate3rd) || 0));
    const issues = []; // {level:'error'|'warn'|'info', msg}

    // ---- 교시
    const periods = [];
    const dayCount = (state.days || []).length;
    (state.days || []).forEach((day, d) => {
      const np = Math.max(1, Math.min(10, parseInt(day.periods, 10) || 1));
      for (let p = 1; p <= np; p++) {
        periods.push({ pi: periods.length, d, p, date: String(day.date || '').trim(), dayLabel: `${d + 1}일차`, grades: [], examTokens: [] });
      }
    });

    // ---- 자리(slot)
    const slots = [];
    const maxClasses = Math.max(...classes);
    periods.forEach((per) => {
      const day = state.days[per.d];
      const row = (day.subjects && day.subjects[per.p - 1]) || [];
      const tokens = new Set();
      for (let g = 1; g <= 3; g++) {
        const cell = row[g - 1] || { name: '', study: [], exclude: [] };
        const cc = classes[g - 1];
        const pc = parseCell(cell, cc);
        pc.exams.forEach((t) => tokens.add(t));
        const gi = { grade: g, cell, parsed: pc, label: cellLabel(cell, cc), slotIdx: [] };
        per.grades.push(gi);
        if (!pc.active) continue;

        const open = [];
        for (let c = 1; c <= cc; c++) if (!pc.exclude.includes(c)) open.push(c);
        const fullStudy = pc.allStudy || (open.length > 0 && open.every((c) => pc.study.includes(c)));
        const skipClassrooms = fullStudy && !opts.studyHallClassroom;

        const push = (o) => {
          const s = Object.assign({ idx: slots.length, pi: per.pi, d: per.d, p: per.p, grade: g }, o);
          slots.push(s);
          gi.slotIdx.push(s.idx);
        };
        if (!skipClassrooms) {
          for (const c of open) {
            const st = pc.allStudy || pc.study.includes(c);
            push({ id: `${per.d}-${per.p}-${g}-c${c}`, kind: 'class', classNo: c, col: `c${c}`, study: st, label: `${g}-${c}${st ? '(자습)' : ''}` });
          }
        }
        if (pc.special) {
          push({ id: `${per.d}-${per.p}-${g}-sp`, kind: 'special', classNo: null, col: 'sp', room: pc.room, study: pc.allStudy, label: `${g}-${pc.room}${pc.allStudy ? '(자습)' : ''}` });
        }
        for (let k = 1; k <= corridors; k++) {
          push({ id: `${per.d}-${per.p}-${g}-r${k}`, kind: 'corridor', classNo: null, col: `r${k}`, study: false, label: `${g}-복도${k}` });
        }
      }
      per.examTokens = Array.from(tokens);
    });
    const slotById = new Map(slots.map((s) => [s.id, s]));

    // ---- 특수실
    const specials = (state.specials || [])
      .map((r) => ({ room: String(r.room || '').trim(), teacher: String(r.teacher || '').trim(), hours: toIntOrNull(r.hours) || 0 }))
      .filter((r) => r.room || r.teacher);

    // ---- 교사
    const teachers = [];
    const nameCount = new Map();
    (state.teachers || []).forEach((raw) => {
      const name = String(raw.name || '').trim();
      if (!name) return;
      nameCount.set(name, (nameCount.get(name) || 0) + 1);
      const nt = normalizeType(raw.type);
      if (!nt.known) issues.push({ level: 'warn', msg: `교사 구분 "${raw.type}" (${name}) → "${nt.type}"(으)로 처리합니다.` });
      const hr = parseHomeroom(raw.homeroom);
      if (!hr.ok) issues.push({ level: 'warn', msg: `${name} 선생님의 담임 칸 "${raw.homeroom}"을(를) 학년-반으로 읽을 수 없습니다. (예: 2-5, 3-부장)` });
      let type = nt.type;
      let note = '';
      if (term === '4차 고사' && opts.exclude3rd && hr.g === 3 && type !== '제외') {
        type = '제외';
        note = '4차 고사 3학년 담임/부장 제외';
      }
      const targetRaw = raw.target;
      const target = toIntOrNull(targetRaw);
      if (String(targetRaw == null ? '' : targetRaw).trim() && target == null) issues.push({ level: 'warn', msg: `${name} 선생님의 목표시수 "${targetRaw}"는 숫자가 아니어서 무시합니다.` });
      const prev = usePrev ? (toIntOrNull(raw.prev) || 0) : 0;
      let prevAdj = prev;
      if (comp && opts.exclude3rd && termIdx <= 2 && hr.g === 3) prevAdj = prev - comp * (termIdx + 1);
      const sp = specials.filter((r) => r.teacher === name);
      teachers.push({
        ti: teachers.length, name, subject: String(raw.subject || '').trim(), homeroomRaw: String(raw.homeroom || '').trim(),
        baseType: nt.type, type, note, subs: splitSubjects(raw.subject), homeroom: hr, target, prev, prevAdj,
        specialRooms: sp, specialHours: sp.reduce((a, r) => a + r.hours, 0),
        exceptAll: new Set(), exceptP: new Set(),
        visited: new Set(useHistory ? (roomHistory[name] || []) : []),
      });
    });
    nameCount.forEach((n, name) => { if (n > 1) issues.push({ level: 'error', msg: `교사 이름 "${name}"이(가) ${n}번 있습니다. 동명이인은 "홍길동A"처럼 구분해 주세요.` }); });
    const teacherByName = new Map(teachers.map((t) => [t.name, t]));

    specials.forEach((r) => {
      if (r.teacher && !teacherByName.has(r.teacher)) issues.push({ level: 'warn', msg: `특수실 "${r.room}" 지정자 "${r.teacher}"이(가) 교사 명단에 없습니다.` });
    });

    // ---- 교시별 예외
    const exceptionsList = [];
    (state.days || []).forEach((day, d) => {
      (day.exceptions || []).forEach((ex) => {
        const name = String(ex.name || '').trim();
        if (!name) return;
        const pv = parsePeriodValue(ex.period);
        const t = teacherByName.get(name);
        if (!t) { issues.push({ level: 'warn', msg: `${d + 1}일차 예외 감독자 "${name}"이(가) 교사 명단에 없습니다.` }); return; }
        if (pv == null) { issues.push({ level: 'warn', msg: `${d + 1}일차 예외 "${name}"의 교시가 비어 있습니다.` }); return; }
        if (pv === 'all') t.exceptAll.add(d);
        else {
          const per = periods.find((x) => x.d === d && x.p === pv);
          if (!per) { issues.push({ level: 'warn', msg: `${d + 1}일차 예외 "${name}"의 ${pv}교시는 시험 교시가 아닙니다.` }); return; }
          t.exceptP.add(per.pi);
        }
        exceptionsList.push({ d, period: pv, name, reason: String(ex.reason || '').trim() });
      });
    });

    // ---- 교사별 교시 가능 여부(정적)
    const P = periods.length;
    const T = teachers.length;
    const ownExam = new Uint8Array(T * P);
    const availP = new Uint8Array(T * P);
    teachers.forEach((t) => {
      t.isSpecial = t.specialRooms.length > 0;
      t.dailyMax = t.type === '원로' && t.target != null ? Math.ceil(t.target / Math.max(1, dayCount)) : null;
      periods.forEach((per) => {
        const k = t.ti * P + per.pi;
        const own = t.subs.length > 0 && per.examTokens.some((ex) => t.subs.some((ts) => subjectMatches(ts, ex)));
        ownExam[k] = own ? 1 : 0;
        let ok = true;
        if (t.type === '제외' || t.isSpecial) ok = false;
        else if (t.exceptAll.has(per.d) || t.exceptP.has(per.pi)) ok = false;
        else if (own) ok = false;
        else if (t.type === '고사담당' && per.p !== 1) ok = false;
        availP[k] = ok ? 1 : 0;
      });
    });

    // ---- 시험 과목 ↔ 교사 과목 매칭 점검
    const allTeacherSubs = teachers.flatMap((t) => t.subs);
    const unmatched = new Set();
    periods.forEach((per) => per.grades.forEach((g) => {
      g.parsed.exams.forEach((ex) => { if (!allTeacherSubs.some((ts) => subjectMatches(ts, ex))) unmatched.add(ex); });
    }));
    if (unmatched.size) {
      issues.push({ level: 'warn', msg: `시험 과목 중 담당 교사를 찾지 못한 과목: ${Array.from(unmatched).join(', ')} — 교사 명단의 과목명과 같게 적어야 본인 시험 시간에 감독이 빠집니다.` });
    }

    // ---- 빈 과목 칸 안내 / 자리 대비 인원 점검
    periods.forEach((per) => {
      const empty = per.grades.filter((g) => !g.parsed.active).map((g) => `${g.grade}학년`);
      if (empty.length && empty.length < 3) issues.push({ level: 'info', msg: `${per.dayLabel} ${per.p}교시 ${empty.join('·')}: 과목이 비어 있어 감독을 배정하지 않습니다.` });
      const need = slots.filter((s) => s.pi === per.pi).length;
      const can = teachers.filter((t) => availP[t.ti * P + per.pi]).length;
      if (need > can) issues.push({ level: 'warn', msg: `${per.dayLabel} ${per.p}교시: 필요한 감독 ${need}명 > 가능한 교사 ${can}명 → ${need - can}자리 이상 부족합니다.` });
    });
    if (!teachers.length) issues.push({ level: 'error', msg: '교사 명단이 비어 있습니다.' });
    if (!periods.length) issues.push({ level: 'error', msg: '시험 일차가 없습니다.' });
    if (periods.length && !slots.length) issues.push({ level: 'error', msg: '배정할 감독 자리가 없습니다. 과목을 입력해 주세요.' });

    const model = {
      term, opts, corridors, classes, maxClasses, periods, slots, slotById, teachers, teacherByName,
      noRepeatRoom: !!opts.noRepeatRoom, useHistory, compensate3rd: comp,
      specials, exceptions: exceptionsList, ownExam, availP, P, T, D: dayCount, issues,
    };
    model.slotOK = (t, s) => slotOK(model, t, s);
    return model;
  }

  // 교사 t 가 자리 s 에 들어갈 수 있는지(교시 상황과 무관한 정적 규칙)
  function slotOK(m, t, s) {
    if (!m.availP[t.ti * m.P + s.pi]) return false;
    const examRoom = (s.kind === 'class' || s.kind === 'special') && !s.study;
    if (t.type === '순회' && examRoom) return false;
    if (t.type === '원로' && (s.kind === 'corridor' || s.study)) return false;
    if (s.kind === 'class' && t.homeroom.g === s.grade && t.homeroom.c === s.classNo) return false;
    if (m.noRepeatRoom && t.visited.size) { const k = roomKey(s); if (k && t.visited.has(k)) return false; }
    return true;
  }

  // 교실 식별자 (복도는 null)
  function roomKey(s) {
    if (s.kind === 'class') return `${s.grade}-${s.classNo}`;
    if (s.kind === 'special') return `${s.grade}-${s.room}`;
    return null;
  }

  // 이번 시험 안에서 교사 name 이 slot 과 같은 교실에 이미 들어가 있는지(slot 자신 제외)
  function repeatRoom(m, assign, name, slot) {
    const k = roomKey(slot);
    if (!k) return false;
    return m.slots.some((s) => s.id !== slot.id && assign[s.id] === name && roomKey(s) === k);
  }

  // 사람이 읽을 수 있는 불가 사유(정적)
  function slotReasons(m, t, s) {
    const r = [];
    const per = m.periods[s.pi];
    if (t.type === '제외') r.push(t.note || '교사 구분: 제외');
    if (t.isSpecial) r.push('특수실 지정자');
    if (t.exceptAll.has(per.d)) r.push('예외(종일)');
    if (t.exceptP.has(per.pi)) r.push('예외 감독자');
    if (m.ownExam[t.ti * m.P + per.pi]) r.push('본인 과목 시험');
    if (t.type === '고사담당' && per.p !== 1) r.push('고사담당(1교시만)');
    const examRoom = (s.kind === 'class' || s.kind === 'special') && !s.study;
    if (t.type === '순회' && examRoom) r.push('순회(시험 교실 불가)');
    if (t.type === '원로' && (s.kind === 'corridor' || s.study)) r.push('원로(복도·자습 불가)');
    if (s.kind === 'class' && t.homeroom.g === s.grade && t.homeroom.c === s.classNo) r.push('본인 담임반');
    if (m.noRepeatRoom && t.visited.size) { const k = roomKey(s); if (k && t.visited.has(k)) r.push('이전 회차에 들어간 교실'); }
    return r;
  }

  function group(t) {
    if (t.type === '원로') return 'senior';
    if (t.type === '순회') return 'itinerant';
    if (t.type === '제외' || t.isSpecial) return 'none';
    return 'balance';
  }

  // ---------------------------------------------------------------
  // 난수 (시드 고정 가능)
  // ---------------------------------------------------------------
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

  // ---------------------------------------------------------------
  // 최적화기
  //   pins: Map(slotId → 교사이름 | '')  : 직접 고친 칸(고정)
  // ---------------------------------------------------------------
  function createOptimizer(m, options) {
    options = options || {};
    const rand = rng(options.seed != null ? options.seed : (Date.now() ^ (Math.random() * 1e9)));
    const S = m.slots.length, T = m.T, P = m.P, D = Math.max(1, m.D);
    const teachers = m.teachers;
    const grp = teachers.map(group);

    // 고정 칸
    const pinned = new Uint8Array(S);
    const pinT = new Int32Array(S).fill(-1);
    const pins = options.pins || new Map();
    pins.forEach((name, id) => {
      const s = m.slotById.get(id);
      if (!s) return;
      pinned[s.idx] = 1;
      const t = name ? m.teacherByName.get(name) : null;
      pinT[s.idx] = t ? t.ti : -1;
    });
    const movable = [];
    for (let i = 0; i < S; i++) if (!pinned[i]) movable.push(i);

    // 자리별 후보 교사
    const cand = m.slots.map((s) => teachers.filter((t) => slotOK(m, t, s)).map((t) => t.ti));

    // 상태
    const asg = new Int32Array(S);
    const at = new Int32Array(T * P);
    const cnt = new Int32Array(T), cls = new Int32Array(T), sub = new Int32Array(T), corr = new Int32Array(T), stu = new Int32Array(T);
    const dayCnt = new Int32Array(T * D), dayMask = new Int32Array(T * D);
    const roomMaps = teachers.map(() => new Map());
    const roomDup = new Int32Array(T);

    function reset() {
      asg.fill(-1); at.fill(-1); cnt.fill(0); cls.fill(0); sub.fill(0); corr.fill(0); stu.fill(0); dayCnt.fill(0); dayMask.fill(0); roomDup.fill(0);
      roomMaps.forEach((mp) => mp.clear());
      for (let i = 0; i < S; i++) if (pinned[i] && pinT[i] >= 0) {
        if (at[pinT[i] * P + m.slots[i].pi] === -1) add(pinT[i], i);
        else asg[i] = pinT[i]; // 같은 교시 중복(직접 입력) — 통계에는 한 번만
      }
    }

    function add(t, si) {
      const s = m.slots[si];
      asg[si] = t; at[t * P + s.pi] = si; cnt[t]++;
      if (s.kind === 'corridor') { sub[t]++; corr[t]++; } else if (s.study) { sub[t]++; stu[t]++; } else cls[t]++;
      const k = t * D + s.d; dayCnt[k]++; dayMask[k] |= (1 << s.p);
      const key = roomKey(s);
      if (key) {
        const mp = roomMaps[t], v = (mp.get(key) || 0) + 1;
        mp.set(key, v); if (v > 1) roomDup[t]++;
      }
    }
    function remove(t, si) {
      const s = m.slots[si];
      asg[si] = -1; at[t * P + s.pi] = -1; cnt[t]--;
      if (s.kind === 'corridor') { sub[t]--; corr[t]--; } else if (s.study) { sub[t]--; stu[t]--; } else cls[t]--;
      const k = t * D + s.d; dayCnt[k]--; dayMask[k] &= ~(1 << s.p);
      const key = roomKey(s);
      if (key) {
        const mp = roomMaps[t], v = mp.get(key) - 1;
        if (v > 0) { mp.set(key, v); roomDup[t]--; } else mp.delete(key);
      }
    }

    // 같은 교실 금지(하드 옵션): 이번 시험에서 이미 들어간 교실이면 불가
    const hardRoom = !!m.noRepeatRoom;
    function roomOK(t, si) {
      if (!hardRoom) return true;
      const key = roomKey(m.slots[si]);
      return !key || !roomMaps[t].has(key);
    }

    function cost(t) {
      const tt = teachers[t], k = cnt[t], g = grp[t];
      let c = 0;
      if (g === 'balance') { const h = tt.prevAdj + k; c += W.TOT * h * h + W.SUB * sub[t] * sub[t] + W.CLS * cls[t] * cls[t] + W.KIND * (corr[t] * corr[t] + stu[t] * stu[t]); }
      else if (g === 'itinerant') { const h = tt.prevAdj + k; c += W.TOT * h * h; }
      else if (g === 'senior' && tt.target != null && k < tt.target) c += W.SENIOR * (tt.target - k);
      if (tt.type !== '원로' && tt.target != null && k > tt.target) c += W.OVER * (k - tt.target);
      for (let d = 0, b = t * D; d < D; d++) {
        const n = dayCnt[b + d]; if (!n) continue;
        const mk = dayMask[b + d];
        c += W.DAY * n * n + W.CONS * popcount(mk & (mk >> 1));
      }
      return c + W.ROOM * roomDup[t];
    }

    // 하드 규칙(교시에 따라 달라지는 것): 3교시 연속 금지, 원로 상한
    function dayOK(t, d) {
      const mk = dayMask[t * D + d];
      if (mk & (mk >> 1) & (mk >> 2)) return false;
      const tt = teachers[t];
      if (tt.dailyMax != null && dayCnt[t * D + d] > tt.dailyMax) return false;
      return true;
    }
    function canAdd(t, si) {
      const s = m.slots[si], tt = teachers[t];
      if (at[t * P + s.pi] !== -1) return false;
      if (!roomOK(t, si)) return false;
      const mk = dayMask[t * D + s.d] | (1 << s.p);
      if (mk & (mk >> 1) & (mk >> 2)) return false;
      if (tt.type === '원로' && tt.target != null) {
        if (cnt[t] + 1 > tt.target) return false;
        if (dayCnt[t * D + s.d] + 1 > tt.dailyMax) return false;
      }
      return true;
    }

    function totalCost() {
      let c = 0;
      for (let t = 0; t < T; t++) c += cost(t);
      for (let i = 0; i < S; i++) if (!pinned[i] && asg[i] < 0) c += W.SHORT;
      return c;
    }

    // 초안: 후보가 적은 자리부터, 비용이 가장 적게 늘어나는 교사를 선택
    function greedy() {
      reset();
      const order = movable.slice().sort((a, b) => (cand[a].length - cand[b].length) || (rand() - 0.5));
      for (const si of order) {
        let best = -1, bestD = Infinity;
        for (const t of cand[si]) {
          if (!canAdd(t, si)) continue;
          const before = cost(t);
          add(t, si);
          const dlt = cost(t) - before + rand() * W.DAY;
          remove(t, si);
          if (dlt < bestD) { bestD = dlt; best = t; }
        }
        if (best >= 0) add(best, si);
      }
    }

    const runs = options.runs || 3;
    const itersPerRun = options.iterations || Math.max(150000, Math.min(1200000, S * 3000));
    const T0 = options.t0 || 3000, T1 = options.t1 || 2;
    let run = 0, it = 0, cur = 0, temp = T0;
    let bestCost = Infinity, bestAsg = null;
    let started = false;

    function snapshotIfBest() {
      if (cur < bestCost) { bestCost = cur; bestAsg = Int32Array.from(asg); }
    }

    function startRun() {
      greedy();
      cur = totalCost();
      it = 0;
      snapshotIfBest();
    }

    function accept(delta) {
      return delta <= 0 || rand() < Math.exp(-delta / temp);
    }

    function moveReplace() {
      const si = movable[(rand() * movable.length) | 0];
      const cs = cand[si];
      if (!cs.length) return;
      const t2 = cs[(rand() * cs.length) | 0];
      const t1 = asg[si];
      if (t2 === t1) return;
      const s = m.slots[si];
      const s2 = at[t2 * P + s.pi];
      if (s2 === -1) {
        if (!canAdd(t2, si)) return;
        const before = (t1 >= 0 ? cost(t1) : W.SHORT) + cost(t2);
        if (t1 >= 0) remove(t1, si);
        add(t2, si);
        const after = (t1 >= 0 ? cost(t1) : 0) + cost(t2);
        const delta = after - before;
        if (accept(delta)) { cur += delta; return; }
        remove(t2, si);
        if (t1 >= 0) add(t1, si);
      } else {
        // 같은 교시 안에서 자리 맞바꾸기
        if (t1 < 0 || pinned[s2] || !slotOK(m, teachers[t1], m.slots[s2])) return;
        const before = cost(t1) + cost(t2);
        remove(t1, si); remove(t2, s2);
        if (!roomOK(t1, s2) || !roomOK(t2, si)) { add(t1, si); add(t2, s2); return; }
        add(t1, s2); add(t2, si);
        const delta = cost(t1) + cost(t2) - before;
        if (accept(delta)) { cur += delta; return; }
        remove(t1, s2); remove(t2, si); add(t1, si); add(t2, s2);
      }
    }

    function moveCross() {
      const a = movable[(rand() * movable.length) | 0];
      const b = movable[(rand() * movable.length) | 0];
      const t1 = asg[a], t2 = asg[b];
      if (t1 < 0 || t2 < 0 || t1 === t2) return;
      const sa = m.slots[a], sb = m.slots[b];
      if (sa.pi === sb.pi) return;
      if (!slotOK(m, teachers[t1], sb) || !slotOK(m, teachers[t2], sa)) return;
      if (at[t1 * P + sb.pi] !== -1 || at[t2 * P + sa.pi] !== -1) return;
      const before = cost(t1) + cost(t2);
      remove(t1, a); remove(t2, b);
      if (!roomOK(t1, b) || !roomOK(t2, a)) { add(t1, a); add(t2, b); return; }
      add(t1, b); add(t2, a);
      const ok = dayOK(t1, sa.d) && dayOK(t1, sb.d) && dayOK(t2, sa.d) && dayOK(t2, sb.d);
      const delta = ok ? cost(t1) + cost(t2) - before : Infinity;
      if (ok && accept(delta)) { cur += delta; return; }
      remove(t1, b); remove(t2, a); add(t1, a); add(t2, b);
    }

    // n 번 진행. 반환: 진행률(0~1)
    function step(n) {
      if (!S) return 1;
      if (!started) { started = true; startRun(); }
      for (let i = 0; i < n; i++) {
        if (it >= itersPerRun) {
          run++;
          if (run >= runs) return 1;
          startRun();
        }
        temp = T0 * Math.pow(T1 / T0, it / itersPerRun);
        if (rand() < 0.55) moveReplace(); else moveCross();
        it++;
        if (cur < bestCost) snapshotIfBest();
      }
      return Math.min(1, (run + it / itersPerRun) / runs);
    }

    function result() {
      const out = {};
      const src = bestAsg || asg;
      m.slots.forEach((s, i) => {
        if (pinned[i]) out[s.id] = pinT[i] >= 0 ? teachers[pinT[i]].name : (pins.get(s.id) || '');
        else out[s.id] = src[i] >= 0 ? teachers[src[i]].name : '';
      });
      return { assign: out, cost: bestCost };
    }

    return { step, result, get bestCost() { return bestCost; } };
  }

  // 한 번에 끝까지 (테스트·Node 용)
  function optimize(m, options) {
    const o = createOptimizer(m, options);
    while (o.step(50000) < 1) { /* 계속 */ }
    return o.result();
  }

  // ---------------------------------------------------------------
  // 결과 평가: 교사별 시수, 칸별 규칙 위반, 예비 명단
  //   assign: { slotId: 교사이름 | '' }
  // ---------------------------------------------------------------
  function evaluate(m, assign) {
    const T = m.T, P = m.P;
    const stats = m.teachers.map((t) => ({
      name: t.name, type: t.type, baseType: t.baseType, subject: t.subject, note: t.note,
      cls: 0, corridor: 0, study: 0, special: t.specialHours, total: 0, prev: t.prev, target: t.target,
      group: group(t), cells: new Array(P).fill(null),
      avail: (() => { let c = 0; for (let p = 0; p < P; p++) if (m.availP[t.ti * P + p]) c++; return c; })(),
    }));
    const violations = {}; // slotId → [사유]
    const busy = new Map(); // `${ti}-${pi}` → [slotId]
    let shortage = 0;
    const external = new Set();

    m.slots.forEach((s) => {
      const name = (assign && assign[s.id]) || '';
      if (!name) { shortage++; return; }
      const t = m.teacherByName.get(name);
      if (!t) { external.add(name); return; }
      const st = stats[t.ti];
      if (s.kind === 'corridor') st.corridor++;
      else if (s.study) st.study++;
      else st.cls++;
      st.cells[s.pi] = st.cells[s.pi] ? st.cells[s.pi] + ', ' + s.label : s.label;
      const key = `${t.ti}-${s.pi}`;
      if (!busy.has(key)) busy.set(key, []);
      busy.get(key).push(s.id);
      const r = slotReasons(m, t, s);
      if (r.length) violations[s.id] = r;
    });

    busy.forEach((ids) => {
      if (ids.length > 1) ids.forEach((id) => { (violations[id] = violations[id] || []).push('같은 교시 중복 배정'); });
    });

    // 같은 교실 재방문(옵션이 켜져 있을 때만 위반으로 표시)
    const roomVisits = new Map(); // `${name}|${roomKey}` → [slotId]
    m.slots.forEach((s) => {
      const name = (assign && assign[s.id]) || '';
      const k = roomKey(s);
      if (!name || !k) return;
      const kk = `${name}|${k}`;
      if (!roomVisits.has(kk)) roomVisits.set(kk, []);
      roomVisits.get(kk).push(s.id);
    });
    let repeatCount = 0;
    roomVisits.forEach((ids) => { if (ids.length > 1) { repeatCount += ids.length - 1; if (m.noRepeatRoom) ids.forEach((id) => { (violations[id] = violations[id] || []).push('같은 교실 재방문'); }); } });

    // 3교시 연속, 원로 상한
    m.teachers.forEach((t) => {
      const st = stats[t.ti];
      st.total = st.cls + st.corridor + st.study + st.special;
      const assignedSlotsOf = (pi) => busy.get(`${t.ti}-${pi}`) || [];
      for (let d = 0; d < m.D; d++) {
        const ps = m.periods.filter((p) => p.d === d);
        let run = [];
        const flush = () => {
          if (run.length >= 3) run.forEach((pi) => assignedSlotsOf(pi).forEach((id) => { (violations[id] = violations[id] || []).push('3교시 연속'); }));
          run = [];
        };
        ps.forEach((per) => { if (assignedSlotsOf(per.pi).length) run.push(per.pi); else flush(); });
        flush();
        if (t.dailyMax != null) {
          const dayIds = ps.flatMap((per) => assignedSlotsOf(per.pi));
          if (dayIds.length > t.dailyMax) dayIds.forEach((id) => { (violations[id] = violations[id] || []).push(`원로 하루 상한(${t.dailyMax}) 초과`); });
        }
      }
      const examHours = st.cls + st.corridor + st.study;
      if (t.type === '원로' && t.target != null && examHours > t.target) {
        m.periods.forEach((per) => assignedSlotsOf(per.pi).forEach((id) => { (violations[id] = violations[id] || []).push(`원로 목표시수(${t.target}) 초과`); }));
      }
      // 본인 시험 표시
      m.periods.forEach((per) => {
        if (!st.cells[per.pi] && m.ownExam[t.ti * P + per.pi]) st.cells[per.pi] = '본인시험';
        else if (!st.cells[per.pi] && t.isSpecial) st.cells[per.pi] = `특수(${t.specialRooms.map((r) => r.room).join('/')})`;
      });
    });
    Object.keys(violations).forEach((k) => { violations[k] = Array.from(new Set(violations[k])); });

    // 예비 명단: 그 교시에 비어 있고 감독 가능한 교사(고사담당 제외), 누적 적은 순
    const reserves = m.periods.map((per) => m.teachers
      .filter((t) => t.type !== '고사담당' && m.availP[t.ti * P + per.pi] && !busy.has(`${t.ti}-${per.pi}`))
      .map((t) => ({ name: t.name, hours: stats[t.ti].prev + stats[t.ti].total }))
      .sort((a, b) => a.hours - b.hours || a.name.localeCompare(b.name, 'ko')));

    // 균형 요약
    const bal = stats.filter((s) => s.group === 'balance').map((s) => s.prev + s.total);
    const summary = {
      shortage,
      repeatRooms: repeatCount,
      violations: Object.keys(violations).length,
      min: bal.length ? Math.min(...bal) : 0,
      max: bal.length ? Math.max(...bal) : 0,
      avg: bal.length ? bal.reduce((a, b) => a + b, 0) / bal.length : 0,
      external: Array.from(external),
    };
    return { stats, violations, reserves, summary };
  }

  // 입력이 바뀌었는지 확인하는 서명(누적 시수는 제외)
  function inputSignature(state) {
    const pick = {
      term: state.term, options: state.options, classes: state.classes,
      days: (state.days || []).map((d) => ({ periods: d.periods, subjects: d.subjects, exceptions: d.exceptions, date: d.date })),
      teachers: (state.teachers || []).map((t) => [t.name, t.subject, t.homeroom, t.type, t.target]),
      specials: state.specials,
    };
    const s = JSON.stringify(pick);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  const Engine = {
    TYPES, TERMS, W, norm, splitSubjects, subjectMatches, normalizeType, parseHomeroom, parsePeriodValue, toIntOrNull,
    parseCell, cellLabel, buildModel, slotOK, slotReasons, roomKey, repeatRoom, createOptimizer, optimize, evaluate, inputSignature,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
