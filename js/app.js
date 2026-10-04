/* =====================================================================
 * 화면 / 저장 / 이벤트
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.Engine;
  const X = window.ExcelIO;
  const LS_KEY = 'examProctor.v2';
  const UI_KEY = 'examProctor.ui';
  const TERMS = E.TERMS;

  // ---------------------------------------------------------------
  // 도우미
  // ---------------------------------------------------------------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const timeText = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function toast(msg, ms) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms || 2600);
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = $('#fileInput');
      inp.value = '';
      inp.accept = accept;
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
  }

  // 모달: buttons [{label, value, cls}] → Promise(value)
  function dialog({ title, html, buttons, wide, xwide, onOpen }) {
    return new Promise((resolve) => {
      const btns = buttons || [{ label: '닫기', value: null }];
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
        <div class="modal-body">${html}</div>
        <div class="modal-foot">${btns.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-close]')) return close(null);
        const b = e.target.closest('.modal-foot [data-i]');
        if (b) {
          const def = btns[+b.dataset.i];
          close(typeof def.value === 'function' ? def.value(back) : def.value);
        }
      });
      document.body.appendChild(back);
      if (onOpen) onOpen(back, close);
    });
  }
  const confirmBox = (title, msg, okLabel, cls) => dialog({ title, html: `<p>${msg}</p>`, buttons: [{ label: '취소', value: false }, { label: okLabel || '확인', value: true, cls: cls || 'primary' }] });

  // ---------------------------------------------------------------
  // 상태
  // ---------------------------------------------------------------
  const emptyCell = () => ({ name: '', study: [], exclude: [], special: false, room: '', multi: false });
  const newDay = (periods) => ({ date: '', periods: periods || 3, subjects: Array.from({ length: periods || 3 }, () => [emptyCell(), emptyCell(), emptyCell()]), exceptions: [] });
  const newTeacher = () => ({ name: '', subject: '', homeroom: '', type: '일반', target: '', prev: '' });

  function defaultState() {
    return {
      version: 2, term: TERMS[0],
      options: { exclude3rd: true, studyHallClassroom: false, corridors: 2, noRepeatRoom: true, roomHistoryScope: 'exam', compensate3rd: 0 },
      roomHistory: {},
      classes: [7, 7, 7], days: [newDay(3)], teachers: [], specials: [{ room: '', teacher: '', hours: '' }],
      result: null, meta: { savedAt: null, backupAt: null, dirty: false },
    };
  }

  // 과목 칸 정리: 예전 방식("과목*(장소)")은 추가반 필드로 옮김
  function normalizeCell(c) {
    c = c || {};
    let name = String(c.name || '');
    let special = !!c.special;
    let room = String(c.room == null ? '' : c.room).trim();
    const star = name.match(/\*\s*(?:\(([^)]*)\))?/);
    if (star) {
      special = true;
      if (!room) room = (star[1] || '').trim();
      name = (name.slice(0, star.index) + name.slice(star.index + star[0].length)).trim();
    }
    return { name, study: Array.isArray(c.study) ? c.study.map(Number) : [], exclude: Array.isArray(c.exclude) ? c.exclude.map(Number) : [], special, room, multi: !!c.multi || name.includes('/') };
  }

  function normalizeState(s) {
    const d = defaultState();
    s = Object.assign({}, d, s || {});
    s.options = Object.assign({}, d.options, s.options || {});
    s.meta = Object.assign({}, d.meta, s.meta || {});
    if (!TERMS.includes(s.term)) s.term = TERMS[0];
    s.classes = [0, 1, 2].map((i) => Math.max(1, parseInt((s.classes || [])[i], 10) || 7));
    s.days = (Array.isArray(s.days) && s.days.length ? s.days : d.days).map((day) => {
      const periods = Math.max(1, Math.min(10, parseInt(day.periods, 10) || 1));
      const subjects = Array.isArray(day.subjects) ? day.subjects : [];
      while (subjects.length < periods) subjects.push([emptyCell(), emptyCell(), emptyCell()]);
      return {
        date: day.date || '', periods,
        subjects: subjects.map((row) => [0, 1, 2].map((g) => normalizeCell((row || [])[g]))),
        exceptions: Array.isArray(day.exceptions) ? day.exceptions.map((x) => ({ period: x.period == null ? '' : String(x.period), name: x.name || '', reason: x.reason || '' })) : [],
      };
    });
    s.teachers = (s.teachers || []).map((t) => Object.assign(newTeacher(), t, { type: E.normalizeType(t.type).type }));
    s.specials = (s.specials || []).map((r) => ({ room: r.room || '', teacher: r.teacher || '', hours: r.hours == null ? '' : String(r.hours) }));
    if (s.result && typeof s.result.assign !== 'object') s.result = null;
    if (s.result) s.result.pinned = s.result.pinned || {};
    const rh = {};
    if (s.roomHistory && typeof s.roomHistory === 'object') Object.keys(s.roomHistory).forEach((k) => { if (Array.isArray(s.roomHistory[k])) rh[k] = s.roomHistory[k].map(String); });
    s.roomHistory = rh;
    return s;
  }

  // 예전 파이썬 프로그램의 DATA SAVE(.json) 파일 변환
  function fromLegacy(data) {
    const s = defaultState();
    if (Array.isArray(data.max_classes)) s.classes = data.max_classes.slice(0, 3).map((n) => parseInt(n, 10) || 7);
    const dayNo = (txt, fallback) => { const m = String(txt || '').match(/\d+/); return m ? parseInt(m[0], 10) - 1 : fallback; };
    const dayRows = data.day_table || [];
    s.days = dayRows.length ? dayRows.map((r) => newDay(Math.max(1, parseInt(r[2], 10) || 1))) : [newDay(3)];
    dayRows.forEach((r, i) => { s.days[i].date = r[1] || ''; });
    const toCell = (v) => {
      if (v && typeof v === 'object') return normalizeCell({ name: v.text || '', study: (v.study_btns || v.active_btns || []).map(Number), exclude: (v.exclude_btns || []).map(Number) });
      return normalizeCell({ name: String(v || '') });
    };
    (data.subject_table || []).forEach((r) => {
      const d = dayNo(r[0], 0), p = parseInt(r[2], 10) || 1;
      if (!s.days[d]) return;
      while (s.days[d].subjects.length < p) s.days[d].subjects.push([emptyCell(), emptyCell(), emptyCell()]);
      s.days[d].subjects[p - 1] = [toCell(r[3]), toCell(r[4]), toCell(r[5])];
    });
    s.teachers = (data.teacher_table || []).map((r) => ({
      name: String(r[1] || '').trim(), subject: r[2] || '', homeroom: r[3] || '', type: E.normalizeType(r[4]).type, target: r[5] || '', prev: '',
    })).filter((t) => t.name);
    s.specials = (data.special_table || []).map((r) => ({ room: r[0] || '', teacher: r[1] || '', hours: r[2] || '' }));
    if (!s.specials.length) s.specials = [{ room: '', teacher: '', hours: '' }];
    (data.exception_tables_data || []).forEach((g, i) => {
      const d = dayNo(g.day_text, i);
      if (!s.days[d]) return;
      (g.rows || []).forEach((r) => { if (String(r[1] || '').trim() || String(r[2] || '').trim()) s.days[d].exceptions.push({ period: String(r[0] || ''), name: r[1] || '', reason: r[2] || '' }); });
    });
    return s;
  }

  let storageOK = true;
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) { storageOK = false; }
    return defaultState();
  }

  let state = loadState();
  let ui = { tab: 'setup', sub: 'grid', seenIntro: false };
  try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* 무시 */ }

  let saveTimer = null;
  function save(dirty) {
    if (dirty !== false) state.meta.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      state.meta.savedAt = new Date().toISOString();
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); storageOK = true; } catch (e) { storageOK = false; }
      renderSaveState();
    }, 250);
  }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 무시 */ } }

  function renderSaveState() {
    const el = $('#saveState');
    if (!storageOK) { el.className = 'save-state warn'; el.textContent = '이 브라우저에는 자동 저장이 안 됩니다. 백업 파일을 꼭 저장하세요.'; }
    else { el.className = 'save-state'; el.textContent = state.meta.savedAt ? `자동 저장됨 · ${timeText(state.meta.savedAt)}` : ''; }
    $('#backupDot').innerHTML = state.meta.dirty ? '<span class="dot" title="마지막 백업 이후 바뀐 내용이 있습니다"></span>' : '';
    $('#brandSub').textContent = state.term;
  }

  // 경로("teachers.3.name")로 값 읽기/쓰기
  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

  // ---------------------------------------------------------------
  // 단계
  // ---------------------------------------------------------------
  const STEPS = [
    { key: 'setup', title: '기본 설정', next: '시험 과목을 교시별로 입력합니다.' },
    { key: 'subjects', title: '시험 과목', next: '교사 명단을 엑셀에서 불러오고, 특수실 담당과 교시별 예외(출장·연가)를 적습니다.' },
    { key: 'teachers', title: '교사 명단 · 예외', next: '배정을 실행하고 결과를 검토한 뒤 엑셀로 저장합니다.' },
    { key: 'result', title: '배정 결과', next: '' },
  ];
  const stepIndex = (k) => STEPS.findIndex((s) => s.key === k);

  function renderStepper() {
    $('#steps').innerHTML = STEPS.map((s, i) => `<button class="step" data-tab="${s.key}"><span class="step-no">${i + 1}</span><span class="step-txt"><b>${s.title}</b><small id="st-${s.key}"></small></span></button>`).join('');
  }

  const renderers = {};
  function showTab(name) {
    ui.tab = name; saveUI();
    $$('.step').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    renderers[name]();
    window.scrollTo(0, 0);
  }
  function renderAll() {
    renderers[ui.tab]();
    renderSaveState();
    updateTeacherDatalist();
    updateBadges();
  }

  function subjectProgress() {
    let total = 0, filled = 0;
    state.days.forEach((day) => day.subjects.slice(0, day.periods).forEach((row) => row.forEach((c, g) => { total++; if (E.parseCell(c, state.classes[g]).active) filled++; })));
    return { total, filled };
  }

  function updateBadges() {
    let model;
    try { model = E.buildModel(state); } catch (e) { return; }
    const set = (key, text, cls) => {
      const b = $(`.step[data-tab="${key}"]`);
      if (!b) return;
      b.classList.remove('done', 'warn', 'bad');
      if (cls) b.classList.add(cls);
      $(`#st-${key}`).textContent = text;
    };
    const periods = state.days.reduce((a, d) => a + d.periods, 0);
    set('setup', `${state.term} · ${state.days.length}일 ${periods}교시 · ${state.classes.join('/')}반`, 'done');
    const sp = subjectProgress();
    set('subjects', sp.filled ? `${sp.total}칸 중 ${sp.filled}칸 입력` : '아직 입력 전', sp.filled ? 'done' : '');
    const nT = state.teachers.filter((t) => t.name.trim()).length;
    const nSp = state.specials.filter((r) => r.room.trim() && r.teacher.trim()).length;
    const nEx = state.days.reduce((a, d) => a + d.exceptions.filter((x) => x.name.trim()).length, 0);
    set('teachers', nT ? `${nT}명 · 특수실 ${nSp} · 예외 ${nEx}` : '명단 없음', nT ? 'done' : '');
    const err = model.issues.filter((i) => i.level === 'error').length;
    const warn = model.issues.filter((i) => i.level === 'warn').length;
    if (err) set('result', `확인 필요 ${err}건`, 'bad');
    else if (state.result) set('result', `배정됨 ${timeText(state.result.createdAt)}${warn ? ` · 주의 ${warn}` : ''}`, warn ? 'warn' : 'done');
    else set('result', warn ? `주의 ${warn}건 · 배정 가능` : '배정 준비됨', warn ? 'warn' : '');
  }

  function updateTeacherDatalist() {
    $('#teacherNames').innerHTML = state.teachers.filter((t) => t.name.trim()).map((t) => `<option value="${esc(t.name.trim())}">`).join('');
  }

  // 공통 조각
  const helpDot = (topic) => `<button class="help-dot" data-act="help" data-topic="${topic}" title="이 부분 설명 보기">?</button>`;
  function panelHead(title, topic, desc, right) {
    return `<div class="panel-head"><h2>${title}</h2>${topic ? helpDot(topic) : ''}${desc ? `<span class="desc">${desc}</span>` : ''}<span class="spacer"></span>${right || ''}</div>`;
  }
  const TOPIC_KEY = { s1: 'setup', s2: 'subjects', s3: 'teachers', s5: 'result' };
  function guide(items, topic) {
    const key = TOPIC_KEY[topic];
    const i = stepIndex(key);
    const prev = STEPS[i - 1], next = STEPS[i + 1];
    return `<div class="guide">
      <b>할 일</b><ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>
      <span class="spacer"></span>
      <span class="nav">
        <button class="btn sm" data-act="help" data-topic="${topic}">자세히</button>
        ${prev ? `<button class="btn sm" data-act="goto" data-tab="${prev.key}" title="${prev.title}">← ${i}</button>` : ''}
        ${next ? `<button class="btn sm primary" data-act="goto" data-tab="${next.key}" title="${next.title}">다음 ${i + 2}. ${next.title} →</button>` : ''}
      </span>
    </div>`;
  }
  const stepNav = () => '';
  const sw = (bind, on, extra) => `<label class="switch"><input type="checkbox" data-bind="${bind}" ${extra || ''} ${on ? 'checked' : ''}><i></i></label>`;

  // ---------------------------------------------------------------
  // 1. 기본 설정
  // ---------------------------------------------------------------
  renderers.setup = function () {
    const s = state;
    const histN = Object.keys(s.roomHistory || {}).length;
    $('#tab-setup').innerHTML = `
    ${guide(['배정 회차와 학년별 반 수를 확인합니다.', '시험 일차를 추가하고 날짜·교시 수를 적습니다.', '옵션은 기본값 그대로 두어도 됩니다.'], 's1')}
    <div class="grid-2">
      <div class="panel">
        ${panelHead('회차와 옵션', 's1-options')}
        <div class="panel-body">
          <div class="opt">
            <span class="opt-name">배정 회차</span>
            <span class="opt-ctl"><select data-bind="term" data-rerender="setup">${TERMS.map((t) => `<option ${t === s.term ? 'selected' : ''}>${t}</option>`).join('')}</select></span>
            <span class="opt-desc">${s.term === TERMS[0] ? '1차는 누적 시수 없이 0부터 시작합니다.' : '교사 명단의 "이전 누적"을 더해 누적이 적은 선생님께 더 배정합니다.'}</span>
          </div>
          <div class="opt">
            <span class="opt-name">학년별 복도 감독 수</span>
            <span class="opt-ctl"><input type="number" class="num" min="0" max="6" data-bind="options.corridors" data-num value="${s.options.corridors}"></span>
            <span class="opt-desc">교시마다 학년별로 두는 복도 감독 인원입니다. 0이면 복도 감독을 두지 않습니다.</span>
          </div>
          ${s.term === '4차 고사' ? `<div class="opt">
            <span class="opt-name bad-text">4차: 3학년 담임·부장 제외</span>
            <span class="opt-ctl">${sw('options.exclude3rd', s.options.exclude3rd)}</span>
            <span class="opt-desc">담임 칸이 <code>3-</code>로 시작하는 선생님을 배정에서 뺍니다. 이분들의 시수는 3차까지의 누적을 기준으로 봅니다.</span>
          </div>` : ''}
          <div class="opt">
            <span class="opt-name">전체 자습 교시에도 교실 감독</span>
            <span class="opt-ctl">${sw('options.studyHallClassroom', s.options.studyHallClassroom)}</span>
            <span class="opt-desc">끄면 학년 전체가 자습인 교시에는 복도 감독만 둡니다.</span>
          </div>
          <div class="opt">
            <span class="opt-name">같은 교실에 두 번 넣지 않음</span>
            <span class="opt-ctl">${sw('options.noRepeatRoom', s.options.noRepeatRoom, 'data-rerender="setup"')}
              <select data-bind="options.roomHistoryScope" data-rerender="setup" ${s.options.noRepeatRoom ? '' : 'disabled'}>
                <option value="exam" ${s.options.roomHistoryScope !== 'year' ? 'selected' : ''}>이번 시험 안에서</option>
                <option value="year" ${s.options.roomHistoryScope === 'year' ? 'selected' : ''}>올해 이전 회차까지</option>
              </select></span>
            <span class="opt-desc">한 선생님을 같은 학년-반 교실에 다시 넣지 않습니다.${s.options.roomHistoryScope === 'year' ? ` 이전 회차 교실 이력 ${histN}명분을 함께 피합니다(교사 명단에서 이전 결과 엑셀을 불러오면 쌓입니다).` : ''}</span>
          </div>
          <div class="opt">
            <span class="opt-name">3학년 담임 연간 보정 <span class="badge">고급</span></span>
            <span class="opt-ctl"><input type="number" class="num" min="0" max="5" data-bind="options.compensate3rd" data-num value="${s.options.compensate3rd}"> 시간</span>
            <span class="opt-desc">기본 0. 4차에 빠지는 3학년 담임은 3차까지의 평균에 맞추는 것이 원칙이므로 보통 0으로 둡니다. 연말 합계까지 맞추고 싶을 때만 1을 넣으면 1~3차에서 회차당 1시간씩 더 배정합니다.</span>
          </div>
        </div>
      </div>

      <div class="panel">
        ${panelHead('학년별 반 수와 시험 일차', 's1-days', '', '<button class="btn sm" data-act="day-add">+ 일차 추가</button>')}
        <div class="panel-body">
          <div class="row" style="margin-bottom:10px">
            ${[0, 1, 2].map((i) => `<label class="field"><span>${i + 1}학년 반 수</span><input type="number" class="num" min="1" max="30" data-bind="classes.${i}" data-num value="${s.classes[i]}"></label>`).join('')}
            <span class="muted small">반 수를 바꾸면 과목 입력의 자습/제외 버튼 개수가 바로 맞춰집니다.</span>
          </div>
          <table class="grid">
            <thead><tr><th style="width:72px">일차</th><th>시험일</th><th style="width:90px">교시 수</th><th style="width:40px"></th></tr></thead>
            <tbody>${s.days.map((d, i) => `<tr>
              <td><span class="day-pill day-c${i % 4}">${i + 1}일차</span></td>
              <td><input data-bind="days.${i}.date" value="${esc(d.date)}" placeholder="예: 4/27 (월)"></td>
              <td><input type="number" min="1" max="10" data-bind="days.${i}.periods" data-num value="${d.periods}"></td>
              <td><button class="icon-btn" data-act="day-del" data-i="${i}" title="이 일차 삭제">✕</button></td>
            </tr>`).join('')}</tbody>
          </table>
          <p class="muted small" style="margin-top:8px">일차·교시 수를 바꾸면 2단계 과목 칸과 3단계 예외 칸이 자동으로 맞춰집니다.</p>
        </div>
      </div>
    </div>
    <div class="row small muted" style="padding:0 4px 10px">
      <span>자료는 이 브라우저에 자동 저장됩니다. 다른 컴퓨터에서 쓰려면 상단 <b>백업 저장</b>으로 파일을 받아 두세요. 마지막 백업: ${s.meta.backupAt ? timeText(s.meta.backupAt) : '없음'}</span>
      <span class="spacer"></span>
      <button class="btn sm ghost danger" data-act="reset-all">전체 초기화</button>
    </div>
`;
  };

  // ---------------------------------------------------------------
  // 2. 시험 과목
  // ---------------------------------------------------------------
  function cellSummary(d, p, g) {
    const cell = state.days[d].subjects[p - 1][g - 1];
    const cc = state.classes[g - 1];
    const pc = E.parseCell(cell, cc);
    if (!pc.active) return { cls: 'none', text: '시험 없음 · 감독 없음' };
    const open = range(1, cc).filter((c) => !pc.exclude.includes(c));
    const fullStudy = pc.allStudy || (open.length > 0 && open.every((c) => pc.study.includes(c)));
    const rooms = fullStudy && !state.options.studyHallClassroom ? 0 : open.length;
    const parts = [];
    if (rooms) parts.push(`교실 ${rooms}`);
    if (pc.special) parts.push('추가반 1');
    if (state.options.corridors) parts.push(`복도 ${state.options.corridors}`);
    let text = parts.join(' · ');
    if (fullStudy) text = '전체자습 · ' + text;
    return { cls: pc.special ? 'special' : '', text };
  }

  function subjectCellHTML(d, p, g) {
    const cell = state.days[d].subjects[p - 1][g - 1];
    const cc = state.classes[g - 1];
    const b = `days.${d}.subjects.${p - 1}.${g - 1}`;
    const key = `${d},${p},${g}`;
    const chips = (kind, list) => range(1, cc).map((c) => `<button class="chip ${list.includes(c) ? 'on' : ''}" data-act="chip" data-kind="${kind}" data-d="${d}" data-p="${p}" data-g="${g}" data-c="${c}" title="${c}반 ${kind === 'study' ? '자습' : '감독 제외'}">${c}</button>`).join('');
    const parts = cell.name.split('/').map((x) => x.trim());
    const multi = cell.multi || parts.length > 1;
    const sum = cellSummary(d, p, g);
    return `<div class="sc">
      <div class="sc-row">
        <input class="sc-name" data-subjpart="${key},0" value="${esc(parts[0] || '')}" placeholder="${multi ? '과목 1' : '과목명 (비우면 시험 없음)'}">
        ${multi ? `<input class="sc-name" data-subjpart="${key},1" value="${esc(parts.slice(1).join('/'))}" placeholder="과목 2">` : ''}
        <button class="sc-mini ${multi ? 'on' : ''}" data-act="subj-multi" data-d="${d}" data-p="${p}" data-g="${g}" title="${multi ? '두 번째 과목 칸 닫기' : '같은 교시에 시험 과목이 둘일 때'}">${multi ? '−과목' : '+과목'}</button>
        <button class="sc-mini sp ${cell.special ? 'on' : ''}" data-act="sp-toggle" data-d="${d}" data-p="${p}" data-g="${g}" title="${cell.special ? '추가반 닫기' : '이동수업 등으로 교실이 하나 더 필요할 때'}">${cell.special ? '추가반✓' : '+추가반'}</button>
      </div>
      <div class="sc-row"><span class="chips study"><button class="chips-lbl" data-act="chip-all" data-kind="study" data-d="${d}" data-p="${p}" data-g="${g}" title="전체 자습 켜기/끄기">자습</button>${chips('study', cell.study)}</span></div>
      <div class="sc-row"><span class="chips excl"><button class="chips-lbl" data-act="chip-all" data-kind="exclude" data-d="${d}" data-p="${p}" data-g="${g}" title="전체 제외 켜기/끄기">제외</button>${chips('exclude', cell.exclude)}</span></div>
      <div class="sc-row sc-foot">
        ${cell.special ? `<label class="sc-roomwrap"><span>추가반</span><input class="sc-room" data-bind="${b}.room" data-subj="${key}" value="${esc(cell.room)}" placeholder="장소 (예: 음악실)"></label>` : ''}
        <span class="sc-sum ${sum.cls}" data-sum="${key}">${esc(sum.text)}</span>
      </div>
    </div>`;
  }

  renderers.subjects = function () {
    $('#tab-subjects').innerHTML = `
    ${guide(['교시마다 학년별 시험 과목을 적습니다. 엑셀 표를 복사해 과목 칸에 붙여넣으면 한 번에 채워집니다.', '자습하는 반은 <b>자습</b> 번호를, 감독을 넣지 않을 반은 <b>제외</b> 번호를 누릅니다.', '이동수업으로 교실이 하나 더 필요하면 <b>+ 추가반</b>을 누르고 장소를 적습니다.'], 's2')}
    <div class="panel">
      ${panelHead('일차별 시험 과목', 's2', `<span class="legend"><span><i style="background:#ffe58a"></i>자습반</span><span><i style="background:#ffc9c9"></i>감독 제외반</span><span><i style="background:#f1edff;border-color:#c9bdf3"></i>추가반</span></span>`,
        '<button class="btn sm" data-act="subj-clear">모두 지우기</button><button class="btn sm primary" data-act="subj-paste">엑셀에서 붙여넣기</button>')}
      <div class="panel-body">
      <div class="days-grid">
      ${state.days.map((day, d) => `
        <div class="day-card day-c${d % 4}">
          <div class="day-head"><span class="day-pill day-c${d % 4}">${d + 1}일차</span><b>${esc(day.date) || '<span class="muted" style="font-weight:400">날짜 미입력</span>'}</b><span class="muted">${day.periods}교시</span></div>
          <table class="subj-table">
            <thead><tr><th>교시</th><th>1학년 <span class="muted">${state.classes[0]}반</span></th><th>2학년 <span class="muted">${state.classes[1]}반</span></th><th>3학년 <span class="muted">${state.classes[2]}반</span></th></tr></thead>
            <tbody>${range(1, day.periods).map((p) => `<tr><td><span class="p-badge">${p}</span><small>교시</small></td>${[1, 2, 3].map((g) => `<td id="sc-${d}-${p}-${g}">${subjectCellHTML(d, p, g)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`).join('')}
      </div>
      </div>
    </div>
`;
  };

  function periodOrder() {
    const list = [];
    state.days.forEach((day, d) => range(1, day.periods).forEach((p) => list.push([d, p])));
    return list;
  }

  function applySubjectGrid(rows, startD, startP, startG) {
    const order = periodOrder();
    let k = order.findIndex(([d, p]) => d === startD && p === startP);
    if (k < 0) k = 0;
    let n = 0;
    rows.forEach((cols, i) => {
      if (!order[k + i]) return;
      const [d, p] = order[k + i];
      cols.forEach((v, j) => {
        const g = startG + j;
        if (g > 3) return;
        const cell = state.days[d].subjects[p - 1][g - 1];
        const nc = normalizeCell({ name: String(v || '').trim(), study: cell.study, exclude: cell.exclude, special: cell.special, room: cell.room });
        Object.assign(cell, nc);
        n++;
      });
    });
    return n;
  }

  function parseClipboardGrid(text) {
    return text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((line) => line.split('\t'));
  }

  // ---------------------------------------------------------------
  // 3. 교사 명단
  // ---------------------------------------------------------------
  const T_FIELDS = ['name', 'subject', 'homeroom', 'type', 'target', 'prev'];

  renderers.teachers = function () {
    const ts = state.teachers;
    const count = {};
    ts.forEach((t) => { if (t.name.trim()) count[t.type] = (count[t.type] || 0) + 1; });
    const names = ts.map((t) => t.name.trim());
    const dup = new Set(names.filter((n, i) => n && names.indexOf(n) !== i));
    const prevOff = state.term === TERMS[0];
    const histN = Object.keys(state.roomHistory).length;
    const nameSet = new Set(names.filter(Boolean));
    const bad = (n) => n.trim() && !nameSet.has(n.trim());
    $('#tab-teachers').innerHTML = `
    ${guide(['<b>엑셀 불러오기</b> 또는 <b>붙여넣기</b>로 명단을 한 번에 넣습니다. 담임은 <code>2-5</code>, 부장은 <code>3-부장</code>처럼 적고 구분을 확인합니다.', prevOff ? '1차 고사는 이전 누적을 쓰지 않습니다.' : '<b>이전 회차 결과 엑셀</b>을 불러와 누적 시수를 채웁니다.', '오른쪽에 <b>특수실</b> 담당과 교시별 <b>예외</b>(출장·연가)를 적습니다. 없으면 비워 둡니다.'], 's3')}
    <div class="teachers-layout">
      <div class="panel">
        ${panelHead('전체 교사 명단', 's3', E.TYPES.map((t) => `<span class="badge">${t} ${count[t] || 0}</span>`).join(' '),
          `<button class="btn sm" data-act="t-add">+ 한 명</button><button class="btn sm" data-act="t-paste">붙여넣기</button><button class="btn sm primary" data-act="t-excel">엑셀 불러오기</button>`)}
        <div class="panel-body" style="padding-top:8px">
          <div class="row tight" style="margin-bottom:8px">
            <button class="btn sm" data-act="t-prev-import" ${prevOff ? 'title="1차 고사에서는 누적을 쓰지 않습니다. 불러오면 2차 고사로 바뀝니다."' : ''}>이전 결과 엑셀에서 누적 불러오기</button>
            <button class="btn sm ghost" data-act="t-prev-clear">누적 비우기</button>
            <span class="muted small">${prevOff ? '1차 고사: 이전 누적은 쓰지 않습니다.' : '이전 누적 = 지난 회차까지의 전체 시수.'}${histN ? ` 교실 이력 ${histN}명분 보관 중.` : ''}</span>
            <span class="spacer"></span>
            <button class="btn sm ghost danger" data-act="t-clear">전체 삭제</button>
          </div>
          <div class="tbl-wrap">
          <table class="grid dense">
            <thead><tr><th style="width:36px">연번</th><th style="width:96px">이름</th><th>과목 <span class="muted" style="font-weight:400" title="여러 과목은 / 로 구분">(/ 구분)</span></th><th style="width:78px">담임</th><th style="width:98px">구분</th><th style="width:66px">목표</th><th style="width:66px">누적</th><th style="width:30px"></th></tr></thead>
            <tbody>${ts.map((t, i) => `<tr>
              <td class="idx">${i + 1}</td>
              <td><input data-bind="teachers.${i}.name" data-tcell="${i},0" value="${esc(t.name)}" class="${dup.has(t.name.trim()) ? 'bad' : ''}" title="${dup.has(t.name.trim()) ? '이름이 중복됩니다' : ''}" placeholder="이름"></td>
              <td><input class="left" data-bind="teachers.${i}.subject" data-tcell="${i},1" value="${esc(t.subject)}" placeholder="예: 수학 / 정보"></td>
              <td><input data-bind="teachers.${i}.homeroom" data-tcell="${i},2" value="${esc(t.homeroom)}" placeholder="2-5"></td>
              <td><select data-bind="teachers.${i}.type" data-tcell="${i},3">${E.TYPES.map((x) => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
              <td><input data-bind="teachers.${i}.target" data-tcell="${i},4" value="${esc(t.target)}" inputmode="numeric" placeholder="${t.type === '원로' ? '필수' : '-'}"></td>
              <td><input data-bind="teachers.${i}.prev" data-tcell="${i},5" value="${esc(t.prev)}" inputmode="numeric" ${prevOff ? 'style="opacity:.45"' : ''} placeholder="0"></td>
              <td><button class="icon-btn" data-act="t-del" data-i="${i}" title="삭제">✕</button></td>
            </tr>`).join('') || '<tr><td colspan="8" class="muted" style="padding:28px">교사 명단이 비어 있습니다. 오른쪽 위 <b>엑셀 불러오기</b> 또는 <b>붙여넣기</b>로 한 번에 넣을 수 있습니다.</td></tr>'}</tbody>
          </table></div>
          <p class="muted small" style="margin-top:8px">구분 — <b>일반</b>: 시수를 고르게 · <b>고사담당</b>: 1교시에만 · <b>원로</b>: 교실 감독만, 목표시수까지 · <b>순회</b>: 복도·자습 감독만 · <b>제외</b>: 배정 안 함. 목표는 원로에게는 채울 시수, 그 밖에는 넘기지 않을 상한(비우면 제한 없음).</p>
        </div>
      </div>

      <div class="side-grid">
        <div class="panel">
          ${panelHead('특수실', 's4-special', '', '<button class="btn sm" data-act="sp-add">+ 추가</button>')}
          <div class="panel-body flush">
          <table class="grid dense">
            <thead><tr><th>명칭</th><th>지정자</th><th style="width:56px">시수</th><th style="width:26px"></th></tr></thead>
            <tbody>${state.specials.map((r, i) => `<tr>
              <td><input data-bind="specials.${i}.room" value="${esc(r.room)}" placeholder="예: 특수학급"></td>
              <td><input data-bind="specials.${i}.teacher" data-namecheck value="${esc(r.teacher)}" list="teacherNames" class="${bad(r.teacher) ? 'bad' : ''}" placeholder="명단에서 선택"></td>
              <td><input data-bind="specials.${i}.hours" value="${esc(r.hours)}" inputmode="numeric" placeholder="0"></td>
              <td><button class="icon-btn" data-act="sp-del" data-i="${i}">✕</button></td>
            </tr>`).join('') || '<tr><td colspan="4" class="muted" style="padding:14px">특수실 없음</td></tr>'}</tbody>
          </table>
          </div>
          <div class="panel-foot muted small">지정자는 일반 감독에서 빠지고, 적은 시수가 그 선생님 시수에 더해집니다.</div>
        </div>

        <div class="panel">
          ${panelHead('일차·교시별 예외 감독자', 's4-exceptions', '', '<button class="btn sm" data-act="ex-add">+ 추가</button>')}
          <div class="panel-body flush">
          <table class="grid dense">
            <thead><tr><th style="width:92px">일차</th><th style="width:84px">교시</th><th style="width:120px">이름</th><th>사유</th><th style="width:26px"></th></tr></thead>
            <tbody>${state.days.flatMap((day, d) => day.exceptions.map((x, i) => {
              const pv = E.parsePeriodValue(x.period);
              const popts = ['<option value="">선택</option>'].concat(range(1, day.periods).map((p) => `<option value="${p}" ${pv === p ? 'selected' : ''}>${p}교시</option>`), [`<option value="전체" ${pv === 'all' ? 'selected' : ''}>종일</option>`]);
              const dopts = state.days.map((dd, k) => `<option value="${k}" ${k === d ? 'selected' : ''}>${k + 1}일차${dd.date ? ' ' + esc(dd.date) : ''}</option>`);
              return `<tr>
              <td><select class="day-sel day-c${d % 4}" data-exmove="${d},${i}" title="일차">${dopts.join('')}</select></td>
              <td><select data-bind="days.${d}.exceptions.${i}.period">${popts.join('')}</select></td>
              <td><input data-bind="days.${d}.exceptions.${i}.name" data-namecheck value="${esc(x.name)}" list="teacherNames" class="${bad(x.name) ? 'bad' : ''}" placeholder="명단에서 선택"></td>
              <td><input class="left" data-bind="days.${d}.exceptions.${i}.reason" value="${esc(x.reason)}" placeholder="출장, 연가 등"></td>
              <td><button class="icon-btn" data-act="ex-del" data-d="${d}" data-i="${i}">✕</button></td></tr>`;
            })).join('') || '<tr><td colspan="5" class="muted" style="padding:14px">예외 없음 — 출장·연가·수업 등으로 특정 교시에 감독할 수 없는 선생님이 있으면 <b>+ 추가</b></td></tr>'}</tbody>
          </table>
          </div>
          <div class="panel-foot muted small">명단에 없는 이름은 빨갛게 표시되고 적용되지 않습니다. 종일 자리를 비우면 교시를 "종일"로 고릅니다.</div>
        </div>
      </div>
    </div>
`;
  };
  renderers.extras = () => renderers.teachers();

  function applyTeacherGrid(rows, startRow, startCol) {
    rows.forEach((cols, i) => {
      const r = startRow + i;
      while (state.teachers.length <= r) state.teachers.push(newTeacher());
      cols.forEach((v, j) => {
        const f = T_FIELDS[startCol + j];
        if (!f) return;
        state.teachers[r][f] = f === 'type' ? E.normalizeType(v).type : String(v || '').trim();
      });
    });
  }

  // ---------------------------------------------------------------
  // 5. 배정 결과
  // ---------------------------------------------------------------
  let running = false;
  let progress = 0;

  function currentModel() { return E.buildModel(state); }

  function issuesHTML(issues) {
    if (!issues.length) return '<p class="muted small" style="margin:0">확인할 문제가 없습니다.</p>';
    const by = { error: [], warn: [], info: [] };
    issues.forEach((i) => by[i.level].push(i));
    const list = (arr) => `<ul class="issues">${arr.map((i) => `<li class="${i.level}">${esc(i.msg)}</li>`).join('')}</ul>`;
    let h = '';
    if (by.error.length) h += `<div style="margin-bottom:6px"><div class="small bad-text" style="font-weight:700;margin-bottom:4px">반드시 해결 ${by.error.length}건 — 해결 전에는 배정할 수 없습니다</div>${list(by.error)}</div>`;
    if (by.warn.length) h += `<details class="issue-group" ${by.error.length ? '' : 'open'}><summary>주의 ${by.warn.length}건 <span class="muted small" style="font-weight:400">— 배정은 되지만 결과에 영향을 줄 수 있습니다</span></summary>${list(by.warn)}</details>`;
    if (by.info.length) h += `<details class="issue-group"><summary>참고 ${by.info.length}건</summary>${list(by.info)}</details>`;
    return h;
  }

  // 결과 요약(부족·위반·시수 범위 등)을 머리줄에 들어가는 작은 칩으로
  function kpiHTML(model, ev, pinCount) {
    if (!ev) return '';
    const s = ev.summary;
    const chip = (cls, label, val, title) => `<span class="kpi ${cls}" title="${title}"><small>${label}</small><b>${val}</b></span>`;
    return `<span class="kpis">
      ${chip(s.shortage ? 'bad' : 'ok', '부족', s.shortage, '감독 부족 자리 (0이어야 합니다)')}
      ${chip(s.violations ? 'bad' : 'ok', '위반', s.violations, '규칙 위반 칸 (0이어야 합니다)')}
      ${chip('', '누적', `${s.min}~${s.max}`, '일반 교사 누적 시수 범위 (최소~최대)')}
      ${chip('', '평균', s.avg.toFixed(1), '일반 교사 평균 누적 시수')}
      ${chip(s.repeatRooms && model.noRepeatRoom ? 'bad' : '', '교실중복', s.repeatRooms, '같은 교실에 두 번 들어간 횟수')}
      ${pinCount ? chip('', '📌', pinCount, '직접 고친(고정된) 칸 수') : ''}
    </span>`;
  }

  renderers.result = function () {
    const model = currentModel();
    const r = state.result;
    const errs = model.issues.filter((i) => i.level === 'error');
    const ev = r ? E.evaluate(model, r.assign) : null;
    const stale = r && r.sig !== E.inputSignature(state);
    const pinCount = r ? Object.keys(r.pinned || {}).length : 0;

    let body = '';
    if (running) {
      body = `<div class="panel"><div class="panel-body"><b>배정 계산 중…</b> <span class="muted">수십만 가지 조합을 비교하고 있습니다. 보통 1~3초 걸립니다.</span><div class="progress"><div id="prog" style="width:${Math.round(progress * 100)}%"></div></div></div></div>`;
    } else if (r && ev) {
      body = `
      ${stale ? `<div class="guide" style="background:var(--warn-soft);border-color:#f3d9a8;color:var(--warn)"><b>입력이 바뀜</b><span>배정한 뒤에 과목·교사·예외 등이 바뀌었습니다. 아래 결과는 바뀐 입력으로 다시 검사한 것입니다. <b>다시 돌리기</b>를 누르면 직접 고친 칸은 유지하고 나머지를 새로 배정합니다.</span></div>` : ''}
      <div class="panel result-table-panel">
        <div class="panel-head">
          <div class="seg">${[['grid', '감독표'], ['person', '개인별 시간표'], ['stats', '시수표']].map(([k, l]) => `<button class="${ui.sub === k ? 'active' : ''}" data-act="sub" data-k="${k}">${l}</button>`).join('')}</div>
          <span class="legend-row" style="padding:0">
            <span class="legend"><i style="background:#fff4c2"></i>자습</span>
            <span class="legend"><i style="background:#ece8fb"></i>복도</span>
            <span class="legend"><i style="background:#dbeafe"></i>본인 시험</span>
            <span class="legend"><i style="background:#fce7f3"></i>예비</span>
            <span class="legend"><i style="background:#fef2f2;border-color:#f1b0b0"></i>부족</span>
            <span class="muted">⚠ 규칙 위반(마우스를 올리면 이유) · 📌 직접 고친 칸</span>
          </span>
          <span class="spacer"></span>
          <span class="muted small">칸을 누르면 바꾸거나 맞바꿀 수 있습니다</span>
          ${helpDot('s5-edit')}
        </div>
        <div class="panel-body" style="padding:8px">
          <div class="scroll">${ui.sub === 'person' ? personTable(model, ev) : ui.sub === 'stats' ? statsTable(model, ev) : gridTable(model, ev)}</div>
        </div>
      </div>`;
    }

    $('#tab-result').innerHTML = `
    ${r ? '' : guide(['아래 <b>배정 전 점검</b>에서 빨간 항목이 있으면 먼저 해결합니다. 노란 항목은 참고용입니다.', '<b>배정 시작</b>을 누르면 1~3초 뒤 결과가 나옵니다.', '결과 칸을 눌러 직접 바꿀 수 있고, 고친 칸은 📌로 고정되어 다시 돌려도 유지됩니다.'], 's5')}
    <div class="panel actionbar no-print">
      <div class="panel-head">
        <h2>배정 · ${esc(state.term)}</h2>${helpDot('s5')}
        ${r ? `<span class="muted small" title="배정한 시각">${timeText(r.createdAt)}</span>` : ''}
        ${kpiHTML(model, ev, pinCount)}
        <span class="spacer"></span>
        ${r ? `${pinCount ? `<button class="btn sm ghost" data-act="unpin-all">📌 고정 모두 풀기</button>` : ''}
        <button class="btn sm ghost danger" data-act="clear-result">결과 지우기</button>
        <button class="btn" data-act="apply-cum" title="이번 결과 시수를 이전 누적에 더하고 다음 회차로 넘어갑니다">누적 반영 → 다음 회차</button>
        <button class="btn orange" data-act="rerun" ${running || errs.length ? 'disabled' : ''} title="📌 고친 칸은 그대로 두고 나머지를 다시 배정">다시 돌리기 (📌 유지)</button>
        <button class="btn" data-act="run" ${running || errs.length ? 'disabled' : ''}>처음부터 새로 배정</button>
        <button class="btn primary" data-act="export" ${running ? 'disabled' : ''}>엑셀로 저장</button>`
        : `<button class="btn go" data-act="run" ${running || errs.length ? 'disabled' : ''} style="min-width:140px">배정 시작</button>`}
      </div>
      <div class="panel-body" style="padding-top:8px">
        <details class="issue-group" ${r && !errs.length ? '' : 'open'}><summary>배정 전 점검 (${model.issues.length}건)${errs.length ? ` <span class="badge bad">해결 필요 ${errs.length}</span>` : ''}</summary><div style="margin-top:6px">${issuesHTML(model.issues)}</div></details>
      </div>
    </div>
    ${body}
`;
  };

  function slotCell(model, ev, s) {
    const r = state.result;
    const name = r.assign[s.id] || '';
    const v = ev.violations[s.id];
    const cls = ['slot', name ? '' : 'empty', s.study ? 'study' : '', s.kind === 'corridor' ? 'corr' : '', v ? 'viol' : ''].filter(Boolean).join(' ');
    const title = v ? v.join(', ') : '';
    const label = name ? esc(name) + (s.kind === 'special' ? `<small class="muted">(${esc(s.room)})</small>` : '') : '부족';
    return `<td class="${cls}" data-act="slot" data-id="${s.id}" title="${esc(title)}">${label}${r.pinned[s.id] ? '<span class="pin">📌</span>' : ''}</td>`;
  }

  function gridTable(model, ev) {
    const C = model.maxClasses, K = model.corridors;
    const hasSp = model.slots.some((s) => s.kind === 'special');
    let h = `<table class="res fill"><thead><tr><th>일차</th><th>교시</th><th>학년</th><th>과목</th>${range(1, C).map((c) => `<th>${c}반</th>`).join('')}${hasSp ? '<th>추가반</th>' : ''}${range(1, K).map((k) => `<th>복도${k}</th>`).join('')}<th>예비 (누적 적은 순)</th></tr></thead><tbody>`;
    let last = -1;
    model.periods.forEach((per) => {
      if (last !== -1 && last !== per.d) h += `<tr class="day-sep"><td colspan="${6 + C + K + (hasSp ? 1 : 0)}"></td></tr>`;
      last = per.d;
      per.grades.forEach((gi, idx) => {
        h += '<tr>';
        if (idx === 0) h += `<td rowspan="3"><b>${per.dayLabel}</b><br><small class="muted">${esc(per.date)}</small></td><td rowspan="3">${per.p}교시</td>`;
        h += `<td>${gi.grade}학년</td><td class="subjcol ${gi.parsed.allStudy || gi.parsed.study.length ? 'study' : ''}">${esc(gi.label) || '<span class="muted">시험 없음</span>'}</td>`;
        for (let c = 1; c <= C; c++) {
          const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-c${c}`);
          if (s) h += slotCell(model, ev, s);
          else if (gi.parsed.active && gi.parsed.exclude.includes(c)) h += '<td class="excluded">제외</td>';
          else if (c > model.classes[gi.grade - 1] || !gi.parsed.active) h += '<td class="excluded"></td>';
          else h += '<td class="excluded">자습</td>';
        }
        if (hasSp) { const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-sp`); h += s ? slotCell(model, ev, s) : '<td class="excluded"></td>'; }
        for (let k = 1; k <= K; k++) { const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-r${k}`); h += s ? slotCell(model, ev, s) : '<td class="excluded"></td>'; }
        if (idx === 0) h += `<td rowspan="3" class="subjcol" style="font-size:11px">${ev.reserves[per.pi].slice(0, 8).map((x) => `${esc(x.name)}(${x.hours})`).join(', ')}${ev.reserves[per.pi].length > 8 ? ` 외 ${ev.reserves[per.pi].length - 8}명` : ''}</td>`;
        h += '</tr>';
      });
    });
    return h + '</tbody></table>';
  }

  function personTable(model, ev) {
    const P = model.periods;
    const byDay = [];
    P.forEach((per) => { if (!byDay[per.d]) byDay[per.d] = []; byDay[per.d].push(per); });
    let h = '<table class="res fill"><thead>';
    h += `<tr><th class="sticky-1" rowspan="5" style="min-width:40px">연번</th><th class="sticky-2" rowspan="5" style="min-width:70px">이름</th><th class="sticky-3" rowspan="5">과목</th>${byDay.map((ps) => `<th colspan="${ps.length}">${ps[0].dayLabel} ${esc(ps[0].date)}</th>`).join('')}${['교실', '복도', '자습', '특수', '이번', '누적'].map((x) => `<th rowspan="5">${x}</th>`).join('')}</tr>`;
    h += `<tr>${P.map((per) => `<th>${per.p}교시</th>`).join('')}</tr>`;
    [0, 1, 2].forEach((g) => { h += `<tr>${P.map((per) => `<th class="subj ${per.grades[g].parsed.allStudy || per.grades[g].parsed.study.length ? 'study' : ''}">${per.grades[g].label ? `${g + 1}학년 ${esc(per.grades[g].label)}` : ''}</th>`).join('')}</tr>`; });
    h += '</thead><tbody>';
    const bal = ev.stats.filter((s) => s.group === 'balance').map((s) => s.prev + s.total);
    const mx = Math.max(...bal), mn = Math.min(...bal);
    ev.stats.forEach((st, i) => {
      const off = st.type === '제외';
      h += `<tr class="${off ? 'off' : ''}"><td class="sticky-1">${i + 1}</td><td class="sticky-2"><b>${esc(st.name)}</b></td><td class="sticky-3" style="font-size:11px">${esc(st.subject)}${st.type !== '일반' ? `<span class="type-tag">${esc(st.type)}</span>` : ''}</td>`;
      P.forEach((per) => {
        const v = st.cells[per.pi];
        let cls = 'slot';
        if (v === '본인시험') cls += ' own';
        else if (v && v.startsWith('특수(')) cls += ' spc';
        else if (v && v.includes('복도')) cls += ' corr';
        else if (v && v.includes('자습')) cls += ' study';
        const ids = v && v !== '본인시험' && !v.startsWith('특수(') ? model.slots.filter((s) => s.pi === per.pi && state.result.assign[s.id] === st.name).map((s) => s.id) : [];
        const viol = ids.some((id) => ev.violations[id]);
        const pin = ids.some((id) => state.result.pinned[id]);
        h += `<td class="${cls} ${viol ? 'viol' : ''}" data-act="pcell" data-name="${esc(st.name)}" data-pi="${per.pi}" title="${esc(ids.flatMap((id) => ev.violations[id] || []).join(', '))}">${v === '본인시험' ? '시험' : esc(v || '')}${pin ? '<span class="pin">📌</span>' : ''}</td>`;
      });
      const tot = st.prev + st.total;
      const hl = st.group === 'balance' && mx !== mn ? (tot === mx ? 'hi' : tot === mn ? 'lo' : '') : '';
      h += `<td class="num">${st.cls}</td><td class="num">${st.corridor}</td><td class="num">${st.study}</td><td class="num">${st.special || ''}</td><td class="num"><b>${st.total}</b></td><td class="num ${hl}">${tot}</td></tr>`;
    });
    const maxRes = Math.max(0, ...ev.reserves.map((r) => r.length));
    for (let k = 0; k < maxRes; k++) {
      h += `<tr class="reserve"><td class="sticky-1">${k + 1}</td><td class="sticky-2">예비</td><td class="sticky-3"></td>${P.map((per) => { const x = ev.reserves[per.pi][k]; return `<td>${x ? `${esc(x.name)}(${x.hours})` : ''}</td>`; }).join('')}<td colspan="6"></td></tr>`;
    }
    return h + '</tbody></table>';
  }

  function statsTable(model, ev) {
    const bal = ev.stats.filter((s) => s.group === 'balance').map((s) => s.prev + s.total);
    const mx = Math.max(...bal), mn = Math.min(...bal);
    let h = '<table class="res fill"><thead><tr><th>연번</th><th>이름</th><th>구분</th><th>과목</th><th>교실</th><th>복도</th><th>자습</th><th>특수실</th><th>이번 합계</th><th>이전 누적</th><th>전체 누적</th><th>목표시수</th><th title="이 시험에서 감독할 수 있는 교시 수 (본인 시험·예외·구분 규칙을 뺀 것)">가능 교시</th></tr></thead><tbody>';
    ev.stats.forEach((st, i) => {
      const tot = st.prev + st.total;
      const hl = st.group === 'balance' && mx !== mn ? (tot === mx ? 'hi' : tot === mn ? 'lo' : '') : '';
      h += `<tr class="${st.type === '제외' ? 'off' : ''}"><td>${i + 1}</td><td><b>${esc(st.name)}</b></td><td>${esc(st.type)}${st.note ? `<br><small class="muted">${esc(st.note)}</small>` : ''}</td><td class="subjcol">${esc(st.subject)}</td>
        <td class="num">${st.cls}</td><td class="num">${st.corridor}</td><td class="num">${st.study}</td><td class="num">${st.special || ''}</td><td class="num"><b>${st.total}</b></td><td class="num">${st.prev}</td><td class="num ${hl}"><b>${tot}</b></td><td class="num">${st.target == null ? '' : st.target}</td><td class="num ${st.group === 'balance' && st.avail <= st.total ? 'hi' : ''}" title="${st.group === 'balance' && st.avail <= st.total ? '가능한 교시를 모두 채웠습니다' : ''}">${st.avail}/${model.P}</td></tr>`;
    });
    return h + '</tbody></table>';
  }

  // ---- 배정 실행
  async function runAssign(keepPins) {
    if (running) return;
    const model = currentModel();
    if (model.issues.some((i) => i.level === 'error')) { toast('먼저 빨간색 문제를 해결해 주세요.'); return; }
    if (state.result && !keepPins) {
      const pins = Object.keys(state.result.pinned || {}).length;
      const ok = await confirmBox('처음부터 새로 배정', `지금 결과${pins ? `와 직접 고친 칸 ${pins}개` : ''}를 버리고 새로 배정할까요?`, '새로 배정', 'go');
      if (!ok) return;
    }
    const pins = new Map();
    if (keepPins && state.result) Object.keys(state.result.pinned).forEach((id) => { if (model.slotById.has(id)) pins.set(id, state.result.assign[id] || ''); });
    running = true; progress = 0;
    renderers.result();
    await sleep(30);
    const opt = E.createOptimizer(model, { pins });
    const t0 = performance.now();
    while (true) {
      progress = opt.step(15000);
      const bar = $('#prog');
      if (bar) bar.style.width = Math.round(progress * 100) + '%';
      if (progress >= 1) break;
      await sleep(0);
    }
    const res = opt.result();
    state.result = {
      createdAt: new Date().toISOString(), term: state.term, sig: E.inputSignature(state),
      assign: res.assign, pinned: Object.fromEntries(Array.from(pins.keys()).map((k) => [k, true])),
    };
    running = false;
    save();
    renderers.result();
    updateBadges();
    const ev = E.evaluate(model, res.assign);
    toast(`배정 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초) · 부족 ${ev.summary.shortage} · 위반 ${ev.summary.violations}`);
  }

  // ---- 칸 편집: 교사 후보 목록
  function wouldBe3Consecutive(model, name, slot) {
    const days = model.periods.filter((p) => p.d === slot.d);
    const has = new Set();
    model.slots.forEach((s) => { if (s.d === slot.d && state.result.assign[s.id] === name && s.id !== slot.id) has.add(s.p); });
    has.add(slot.p);
    let run = 0;
    for (const per of days) { run = has.has(per.p) ? run + 1 : 0; if (run >= 3) return true; }
    return false;
  }

  function candidateHTML(model, ev, slot) {
    const load = new Map(ev.stats.map((st) => [st.name, st]));
    const cur = state.result.assign[slot.id] || '';
    const sameP = new Map();
    model.slots.forEach((s) => { if (s.pi === slot.pi && state.result.assign[s.id]) sameP.set(state.result.assign[s.id], s.id); });
    const free = [], swap = [], no = [];
    model.teachers.forEach((t) => {
      if (t.name === cur) return;
      const st = load.get(t.name);
      const reasons = E.slotReasons(model, t, slot);
      const other = sameP.get(t.name);
      if (!other && wouldBe3Consecutive(model, t.name, slot)) reasons.push('3교시 연속');
      if (model.noRepeatRoom && E.repeatRoom(model, state.result.assign, t.name, slot)) reasons.push('이번 시험에 들어간 교실');
      const info = `이번 ${st.total} · 누적 ${st.prev + st.total}`;
      const item = { t, st, reasons, other, info, sort: st.prev + st.total };
      if (reasons.length) no.push(item);
      else if (other) swap.push(item);
      else free.push(item);
    });
    const byLoad = (a, b) => a.sort - b.sort || a.t.name.localeCompare(b.t.name, 'ko');
    free.sort(byLoad); swap.sort(byLoad); no.sort(byLoad);
    const btn = (it, kind) => {
      let extra = '';
      if (kind === 'swap') {
        const os = model.slotById.get(it.other);
        const back = cur ? E.slotReasons(model, model.teacherByName.get(cur), os) : [];
        extra = ` <small>↔ ${esc(os.label)}${cur && back.length ? ' ⚠' + esc(cur) + ': ' + esc(back.join(',')) : ''}</small>`;
      }
      if (kind === 'no') extra = ` <small>${esc(it.reasons.join(', '))}</small>`;
      return `<button class="cand ${kind}" data-pick="${esc(it.t.name)}" data-kind="${kind}" data-other="${esc(it.other || '')}"><b>${esc(it.t.name)}</b>${it.t.type !== '일반' ? `<span class="type-tag">${esc(it.t.type)}</span>` : ''} <small>${it.info}</small>${extra}</button>`;
    };
    return `
      <div class="cand-search" style="margin-bottom:10px"><input type="search" id="candSearch" placeholder="이름 검색" style="width:100%"></div>
      <div class="cand-group"><h4>바로 넣을 수 있는 선생님 (누적 적은 순)</h4><div class="cand-list">${free.map((x) => btn(x, 'free')).join('') || '<span class="muted">없음</span>'}</div></div>
      <div class="cand-group"><h4>같은 교시 다른 자리와 맞바꾸기</h4><div class="cand-list">${swap.map((x) => btn(x, 'swap')).join('') || '<span class="muted">없음</span>'}</div></div>
      <details class="cand-group"><summary style="cursor:pointer;font-weight:600;color:var(--ink-2)">규칙상 어려운 선생님 ${no.length}명 — 그래도 넣을 수는 있습니다</summary><div class="cand-list" style="margin-top:6px">${no.map((x) => btn(x, 'no')).join('')}</div></details>`;
  }

  async function openSlotEditor(slotId) {
    const model = currentModel();
    const slot = model.slotById.get(slotId);
    if (!slot) return;
    const ev = E.evaluate(model, state.result.assign);
    const per = model.periods[slot.pi];
    const gi = per.grades[slot.grade - 1];
    const cur = state.result.assign[slotId] || '';
    const place = slot.kind === 'class' ? `${slot.grade}학년 ${slot.classNo}반` : slot.kind === 'special' ? `${slot.grade}학년 ${slot.room}` : `${slot.grade}학년 복도${slot.col.slice(1)}`;
    const v = ev.violations[slotId];
    const html = `<p>${per.dayLabel} ${esc(per.date)} ${per.p}교시 · <b>${place}</b> · ${esc(gi.label)}${slot.study ? ' <span class="badge warn">자습</span>' : ''}<br>
      현재: <b>${cur ? esc(cur) : '<span class="bad-text">비어 있음</span>'}</b> ${state.result.pinned[slotId] ? '📌' : ''} ${v ? `<span class="badge bad">⚠ ${esc(v.join(', '))}</span>` : ''}</p>
      ${candidateHTML(model, ev, slot)}`;
    const result = await dialog({
      title: '감독 바꾸기', html, wide: true,
      buttons: [
        { label: '비우기', value: { act: 'clear' }, cls: 'danger' },
        ...(state.result.pinned[slotId] ? [{ label: '📌 고정 풀기', value: { act: 'unpin' } }] : []),
        { label: '닫기', value: null },
      ],
      onOpen(back, close) {
        $('#candSearch', back).addEventListener('input', (e) => {
          const q = e.target.value.trim();
          $$('.cand', back).forEach((b) => { b.style.display = !q || b.dataset.pick.includes(q) ? '' : 'none'; });
        });
        $('#candSearch', back).focus();
        back.addEventListener('click', async (e) => {
          const b = e.target.closest('.cand');
          if (!b) return;
          if (b.dataset.kind === 'no') {
            const ok = await confirmBox('규칙과 다르게 배정', `${b.dataset.pick} 선생님은 "${b.querySelector('small:last-child').textContent.trim()}" 때문에 원래 들어갈 수 없는 자리입니다. 그래도 넣을까요?`, '넣기', 'orange');
            if (!ok) return;
          }
          close({ act: b.dataset.kind === 'swap' ? 'swap' : 'set', name: b.dataset.pick, other: b.dataset.other });
        });
      },
    });
    if (!result) return;
    const a = state.result.assign, pin = state.result.pinned;
    if (result.act === 'clear') { a[slotId] = ''; pin[slotId] = true; }
    else if (result.act === 'unpin') { delete pin[slotId]; }
    else if (result.act === 'set') {
      model.slots.forEach((s) => { if (s.pi === slot.pi && s.id !== slotId && a[s.id] === result.name) { a[s.id] = ''; pin[s.id] = true; } });
      a[slotId] = result.name; pin[slotId] = true;
    } else if (result.act === 'swap') {
      a[result.other] = cur; pin[result.other] = true;
      a[slotId] = result.name; pin[slotId] = true;
    }
    save();
    renderers.result();
  }

  async function openPersonCell(name, pi) {
    const model = currentModel();
    const ids = model.slots.filter((s) => s.pi === pi && state.result.assign[s.id] === name).map((s) => s.id);
    if (ids.length) return openSlotEditor(ids[0]);
    const t = model.teacherByName.get(name);
    if (!t) return;
    const per = model.periods[pi];
    const slots = model.slots.filter((s) => s.pi === pi);
    const html = `<p><b>${esc(name)}</b> 선생님을 ${per.dayLabel} ${per.p}교시에 넣을 자리를 고르세요. 원래 그 자리에 있던 선생님은 빠집니다.</p>
      <div class="cand-list">${slots.map((s) => {
        const r = E.slotReasons(model, t, s);
        if (wouldBe3Consecutive(model, name, s)) r.push('3교시 연속');
        if (model.noRepeatRoom && E.repeatRoom(model, state.result.assign, name, s)) r.push('이번 시험에 들어간 교실');
        const cur = state.result.assign[s.id];
        return `<button class="cand ${r.length ? 'no' : ''}" data-slot="${s.id}"><b>${esc(s.label)}</b> <small>${cur ? esc(cur) : '비어 있음'}${r.length ? ' · ' + esc(r.join(', ')) : ''}</small></button>`;
      }).join('')}</div>`;
    const picked = await dialog({
      title: '이 교시에 넣기', html, wide: true, buttons: [{ label: '닫기', value: null }],
      onOpen(back, close) { back.addEventListener('click', (e) => { const b = e.target.closest('.cand'); if (b) close(b.dataset.slot); }); },
    });
    if (!picked) return;
    state.result.assign[picked] = name;
    state.result.pinned[picked] = true;
    save();
    renderers.result();
  }

  async function exportExcel() {
    const model = currentModel();
    const ev = E.evaluate(model, state.result.assign);
    if (ev.summary.shortage || ev.summary.violations) {
      const ok = await confirmBox('확인', `감독 부족 ${ev.summary.shortage}자리, 규칙 위반 ${ev.summary.violations}칸이 있습니다. 그대로 저장할까요?`, '그대로 저장');
      if (!ok) return;
    }
    try {
      const blob = await X.exportResult(state, model, ev, state.result.assign);
      download(blob, `부광고_${state.term.replace(/\s/g, '')}_배정결과.xlsx`);
      toast('엑셀 파일을 저장했습니다. (결과_감독표 · 결과_시수표 · 결과_개인별시간표)');
    } catch (e) {
      console.error(e);
      await dialog({ title: '오류', html: `<p>엑셀 저장 중 문제가 생겼습니다.</p><pre>${esc(e.message)}</pre>` });
    }
  }

  async function applyCumulative() {
    const model = currentModel();
    const ev = E.evaluate(model, state.result.assign);
    const idx = TERMS.indexOf(state.term);
    const next = TERMS[Math.min(TERMS.length - 1, idx + 1)];
    const ok = await confirmBox('누적 반영', `이번 ${state.term} 시수를 각 선생님의 "이전 누적"에 더하고${idx < 3 ? `, 회차를 <b>${next}</b>로 바꿉니다` : ''}.<br>이번 배정 결과는 지워지니 <b>엑셀 저장을 먼저</b> 해 두세요. (과목·일차는 남으니 다음 시험에 맞게 고치면 됩니다)`, '반영하기', 'orange');
    if (!ok) return;
    const byName = new Map(ev.stats.map((s) => [s.name, s]));
    state.teachers.forEach((t) => {
      const st = byName.get(t.name.trim());
      if (!st) return;
      t.prev = String(st.prev + st.total);
    });
    if (state.term === TERMS[0]) state.roomHistory = {};
    model.slots.forEach((s) => {
      const nm = state.result.assign[s.id], k = E.roomKey(s);
      if (!nm || !k) return;
      const list = state.roomHistory[nm] || (state.roomHistory[nm] = []);
      if (!list.includes(k)) list.push(k);
    });
    state.term = next;
    state.result = null;
    save();
    toast('누적 시수를 반영했습니다.');
    showTab('teachers');
  }

  // ---------------------------------------------------------------
  // 백업
  // ---------------------------------------------------------------
  function backupSave() {
    const now = new Date();
    state.meta.backupAt = now.toISOString();
    state.meta.dirty = false;
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    download(blob, `부광고_시험감독_백업_${state.term.replace(/\s/g, '')}_${stamp(now)}.json`);
    save(false);
    renderAll();
    toast('백업 파일을 저장했습니다.');
  }

  async function backupLoad() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { toast('JSON 파일을 읽을 수 없습니다.'); return; }
    let next;
    if (data && data.version === 2) next = normalizeState(data);
    else if (data && (data.day_table || data.teacher_table || data.subject_table)) next = normalizeState(fromLegacy(data));
    else { toast('이 프로그램의 백업 파일이 아닙니다.'); return; }
    const ok = await confirmBox('백업 불러오기', `"${esc(f.name)}"의 내용으로 지금 화면의 자료를 <b>모두 바꿉니다</b>. 계속할까요?`, '불러오기');
    if (!ok) return;
    state = next;
    state.meta.dirty = false;
    save(false);
    renderAll();
    showTab(ui.tab);
    toast(data.version === 2 ? '백업을 불러왔습니다.' : '예전 프로그램 파일을 변환해서 불러왔습니다.');
  }

  // ---------------------------------------------------------------
  // 처음 안내
  // ---------------------------------------------------------------
  async function showIntro() {
    const v = await dialog({
      title: '시작하기', wide: true,
      html: `<p>위쪽 <b>1 → 4 단계</b>를 차례로 진행하면 됩니다. 각 단계 아래의 <b>다음 단계</b> 버튼으로 이동하고, 궁금한 부분은 <b>?</b> 표시나 상단 <b>설명서</b>를 누르세요.</p>
      <div class="intro-steps">
        <div class="intro-step"><b><span class="n">1</span>기본 설정</b><small>회차, 반 수, 시험 일차·교시</small></div>
        <div class="intro-step"><b><span class="n">2</span>시험 과목</b><small>교시별 과목, 자습·제외 반, 추가반</small></div>
        <div class="intro-step"><b><span class="n">3</span>교사 명단 · 예외</b><small>엑셀 불러오기, 담임·구분, 이전 누적, 특수실, 교시별 예외</small></div>
        <div class="intro-step"><b><span class="n">4</span>배정 결과</b><small>배정 → 직접 수정 → 엑셀 저장 → 누적 반영</small></div>
      </div>
      <p class="muted small" style="margin-top:10px">입력하는 즉시 이 브라우저에 저장됩니다. 다른 컴퓨터에서도 쓰려면 <b>백업 저장</b>으로 파일을 받아 두세요. 예전 프로그램의 백업 파일이 있다면 <b>백업 불러오기</b>로 그대로 이어서 쓸 수 있습니다.</p>`,
      buttons: [{ label: '설명서 보기', value: 'help' }, { label: '예전 백업 불러오기', value: 'load' }, { label: '시작하기', value: 'go', cls: 'primary' }],
    });
    ui.seenIntro = true; saveUI();
    if (v === 'help') showHelp('s0');
    else if (v === 'load') backupLoad();
  }

  // ---------------------------------------------------------------
  // 설명서 — 챕터별로 한 장씩 넘기며, 실제 화면(같은 렌더러로 그린 미리보기)을 함께 보여 줌
  // ---------------------------------------------------------------

  // 설명서용 보기 자료: 2일 6교시, 7/7/7반, 교사 48명, 특수실 1, 예외 2 (2차 고사)
  function demoState() {
    const s = defaultState();
    s.term = '2차 고사';
    s.classes = [7, 7, 7];
    s.days = [newDay(3), newDay(3)];
    s.days[0].date = '4/27'; s.days[1].date = '4/28';
    const put = (d, p, g, cell) => Object.assign(s.days[d].subjects[p - 1][g - 1], normalizeCell(cell));
    put(0, 1, 1, { name: '국어' }); put(0, 1, 2, { name: '문학' }); put(0, 1, 3, { name: '독서' });
    put(0, 2, 1, { name: '통합과학' }); put(0, 2, 2, { name: '수학Ⅰ', study: [7] }); put(0, 2, 3, { name: '세계사/경제', multi: true });
    put(0, 3, 1, { name: '한국사' }); put(0, 3, 2, { name: '영어Ⅰ', special: true, room: '어학실' }); put(0, 3, 3, { name: '자습' });
    put(1, 1, 1, { name: '수학' }); put(1, 1, 2, { name: '화학Ⅰ', exclude: [7] }); put(1, 1, 3, { name: '물리학Ⅱ' });
    put(1, 2, 1, { name: '영어' }); put(1, 2, 2, { name: '동아시아사' }); put(1, 2, 3, { name: '확률과통계' });
    put(1, 3, 1, { name: '통합사회', study: [6, 7] }); put(1, 3, 2, { name: '생명과학Ⅰ' }); put(1, 3, 3, { name: '' });
    const sur = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
    const given = ['지연', '민수', '서준', '하은', '도윤', '수아', '예준', '지우', '현우', '서연', '준서', '다은', '시우', '채원', '우진', '민서'];
    const subj = ['국어', '국어', '국어/문학', '독서', '수학', '수학', '수학', '확률과통계', '영어', '영어', '영어', '영어', '통합과학', '물리학', '화학', '생명과학', '지구과학', '한국사', '통합사회', '세계사', '경제', '윤리', '동아시아사', '지리',
      '체육', '체육', '음악', '미술', '정보', '기술가정', '일본어', '중국어', '한문', '국어', '수학', '영어', '과학', '사회', '체육', '진로', '보건', '사서', '특수', '국어', '수학', '영어', '역사', '미술'];
    const homerooms = [];
    for (let g = 1; g <= 3; g++) for (let c = 1; c <= 7; c++) homerooms.push(`${g}-${c}`);
    homerooms.push('3-부장');
    for (let i = 0; i < 48; i++) {
      const b = Math.floor(i / 16);
      const t = newTeacher();
      t.name = sur[i % 16] + given[(i % 16 + 5 * b) % 16];
      t.subject = subj[i];
      t.homeroom = i < homerooms.length ? homerooms[i] : '';
      t.type = i === 44 ? '고사담당' : i === 45 ? '원로' : i === 46 ? '순회' : i === 47 ? '제외' : '일반';
      if (t.type === '원로') t.target = '4';
      t.prev = String(4 + ((i * 7) % 5));
      s.teachers.push(t);
    }
    s.teachers[42].type = '고사담당';
    s.specials = [{ room: '특수학급', teacher: s.teachers[42 - 1].name, hours: '3' }];
    s.days[0].exceptions.push({ period: '1', name: s.teachers[30].name, reason: '출장' });
    s.days[1].exceptions.push({ period: '전체', name: s.teachers[31].name, reason: '연가' });
    return s;
  }

  let demoCache = null;
  function demoBundle() {
    if (demoCache) return demoCache;
    const s = normalizeState(demoState());
    const model = E.buildModel(s);
    const opt = E.createOptimizer(model, { seed: 7, runs: 1, iterations: 40000 });
    while (opt.step(10000) < 1) { /* 짧게 */ }
    const assign = opt.result().assign;
    const pinId = model.slots.find((x) => x.kind === 'class' && assign[x.id]);
    s.result = { createdAt: new Date().toISOString(), term: s.term, sig: E.inputSignature(s), assign, pinned: pinId ? { [pinId.id]: true } : {} };
    demoCache = s;
    return s;
  }

  // 실제 렌더러를 보기 자료로 잠깐 돌려 HTML 조각을 얻음 (화면의 진짜 상태는 건드리지 않음)
  function withDemo(fn, sub) {
    const real = state, realSub = ui.sub, realRunning = running;
    state = demoBundle(); if (sub) ui.sub = sub; running = false;
    try { return fn(); } finally { state = real; ui.sub = realSub; running = realRunning; }
  }
  function captureTab(key) {
    const el = $('#tab-' + key);
    const keep = el.innerHTML;
    renderers[key]();
    const html = el.innerHTML;
    el.innerHTML = keep;
    return html;
  }
  // 미리보기 상자: html에서 selector 요소만 골라 담고, callouts([selector, 번호])로 빨간 번호표를 붙임
  function shot(html, selector, callouts, opt) {
    opt = opt || {};
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const wrap = document.createElement('div');
    const nodes = selector ? Array.from(tpl.content.querySelectorAll(selector)) : Array.from(tpl.content.children);
    nodes.forEach((n) => wrap.appendChild(n));
    (opt.remove ? [].concat(opt.remove) : []).forEach((sel) => wrap.querySelectorAll(sel).forEach((n) => n.remove()));
    (callouts || []).forEach(([sel, n]) => {
      let el = wrap.querySelector(sel);
      if (!el) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el = el.parentElement; // 입력 요소는 안에 넣을 수 없으니 감싸는 요소에
      el.classList.add('co-host');
      const m = document.createElement('i'); m.className = 'co'; m.textContent = n;
      el.appendChild(m);
    });
    wrap.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    wrap.querySelectorAll('[list]').forEach((n) => n.removeAttribute('list'));
    return `<figure class="shot ${opt.cls || ''}"><figcaption>실제 화면${opt.title ? ' · ' + opt.title : ''}</figcaption><div class="shot-body" inert style="${opt.style || ''}">${wrap.innerHTML}</div></figure>`;
  }
  const co = (n) => `<i class="co inline">${n}</i>`;
  const kv = (rows, heads) => `<table class="help-table">${heads ? `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
  const swatch = (c) => `<span class="sw" style="background:${c}"></span>`;

  // 챕터 정의. anchors: 각 화면의 ? 버튼이 가리키는 세부 주제
  const HELP_CHAPTERS = [
    { id: 's0', title: '시작하기', anchors: ['s0-backup'], html() {
      const steps = `<nav class="stepper">${STEPS.map((st, i) => `<button class="step ${i === 0 ? 'active' : i < 3 ? 'done' : ''}"><span class="step-no">${i + 1}</span><span class="step-txt"><b>${st.title}</b><small>${['2차 고사 · 2일 6교시 · 7/7/7반', '18칸 중 17칸 입력', '48명 · 특수실 1 · 예외 2', '배정 준비됨'][i]}</small></span></button>`).join('')}</nav>`;
      const top = $('.topbar').outerHTML;
      return `
      <p class="lead">이 프로그램은 시험 감독을 <b>규칙을 지키면서 시수가 고르게</b> 배정하고, 결과를 엑셀로 내보냅니다. 설치 없이 링크로 열며, 서버 없이 이 브라우저 안에서만 동작합니다. 설명서는 <b>다음 →</b> 버튼으로 한 장씩 넘기며 읽습니다. 각 장의 "실제 화면" 상자는 보기 자료로 그린 진짜 화면이며, 빨간 번호가 아래 설명의 번호입니다.</p>
      ${shot(top + steps, null, [['[data-act="help"]', 1], ['[data-act="backup-save"]', 2], ['[data-act="backup-load"]', 3], ['#saveState', 4], ['.step:nth-child(1)', 5], ['.step:nth-child(4) .step-txt', 6]], { title: '화면 위쪽' })}
      <ol class="co-list">
        <li>${co(1)}<b>설명서</b> — 이 창입니다. 각 화면의 <span class="help-dot-demo">?</span> 버튼과 "자세히" 버튼은 그 부분의 장을 바로 엽니다.</li>
        <li>${co(2)}<b>백업 저장</b> — 입력한 자료 전체를 파일(.json) 하나로 내 컴퓨터에 받습니다. 노란 점(●)은 마지막 백업 뒤 바뀐 내용이 있다는 뜻입니다.</li>
        <li>${co(3)}<b>백업 불러오기</b> — 받아 둔 파일로 화면을 그대로 복원합니다. 예전 파이썬 프로그램의 DATA SAVE 파일도 됩니다.</li>
        <li>${co(4)}<b>자동 저장 표시</b> — 입력하는 즉시 이 브라우저에 저장되며 시각이 보입니다.</li>
        <li>${co(5)}<b>단계 버튼</b> — 1 → 4 순서로 진행합니다. 누르면 그 단계로 이동하고, 각 단계 위 "할 일" 줄의 <b>다음</b> 버튼으로도 넘어갑니다.</li>
        <li>${co(6)}<b>입력 상태</b> — 단계마다 지금 입력된 내용이 요약되어 보입니다. 빨간 글씨는 해결할 문제가 있다는 뜻입니다.</li>
      </ol>
      <h3 id="s0-backup">자료는 어디에 저장되나요</h3>
      <ul>
        <li>입력하는 즉시 <b>이 컴퓨터의 이 브라우저</b>에 자동 저장됩니다. 같은 컴퓨터·같은 브라우저로 다시 열면 그대로 이어집니다.</li>
        <li>다른 컴퓨터에서 쓰거나 브라우저 기록을 지울 때를 대비해 <b>백업 저장</b>으로 파일을 받아 두세요. 설정·과목·교사·예외·배정 결과(직접 고친 칸 포함)가 모두 들어 있습니다.</li>
        <li>시크릿 창(비공개 창)이나 브라우저 설정에 따라 자동 저장이 안 될 수 있습니다. 이때는 상단에 경고가 나타나니 백업 파일로 보관하세요.</li>
        <li>두 사람이 같은 컴퓨터를 쓰면: 브라우저 사용자(프로필)가 다르면 자료가 따로 저장됩니다. 같은 프로필이면 하나의 자료를 공유하니 백업 파일로 각자 보관하세요.</li>
      </ul>`;
    } },

    { id: 's0-flow', title: '한 해 운영 흐름', anchors: [], html() {
      const box = (n, t, d, cls) => `<div class="flow-box ${cls || ''}"><b>${n}</b><span>${t}</span><small>${d}</small></div>`;
      return `
      <p class="lead">1년에 네 번(1차~4차 고사) 쓰며, 회차가 넘어갈 때 <b>누적 시수</b>와 <b>들어갔던 교실</b>이 다음 회차로 이어집니다.</p>
      <div class="flow">
        ${box('1차 고사', '처음부터 입력', '회차를 1차로 두고 반 수·과목·교사를 입력합니다. 이전 누적은 쓰지 않습니다.')}
        <i>→</i>
        ${box('2·3차 고사', '누적 이어가기', '지난 결과 화면의 <b>누적 반영 → 다음 회차</b>를 누르거나, 지난 결과 엑셀을 3단계에서 불러옵니다. 그다음 과목·일차·예외만 새 시험에 맞게 고칩니다.')}
        <i>→</i>
        ${box('4차 고사', '3학년 제외', '3학년 과목 칸을 비워 두고(감독 없음), <b>3학년 담임·부장 제외</b> 옵션을 켭니다. 이분들의 시수는 3차까지의 누적을 기준으로 봅니다.')}
        <i>→</i>
        ${box('새 학년도', '다시 1차로', '1차 고사로 바꾸면 누적과 교실 이력을 쓰지 않습니다. 명단만 고쳐 다시 시작하거나 <b>전체 초기화</b> 후 새로 입력합니다.', 'muted')}
      </div>
      <h3>회차마다 하는 일</h3>
      <ol class="steps-list">
        <li><b>1. 기본 설정</b> — 회차, 반 수, 시험 일차와 교시 수</li>
        <li><b>2. 시험 과목</b> — 교시별 학년 과목, 자습·제외 반, 추가반</li>
        <li><b>3. 교사 명단 · 예외</b> — 이름·과목·담임·구분·목표시수·이전 누적, 특수실 담당자, 교시별로 감독이 어려운 선생님</li>
        <li><b>4. 배정 결과</b> — 배정 실행 → 검토·직접 수정 → 엑셀 저장 → 누적 반영</li>
      </ol>
      <div class="note">단계는 순서대로 하지 않아도 되지만, 2단계 과목 칸과 3단계 예외 칸의 수는 1단계의 일차·교시 수에 따라 자동으로 바뀝니다.</div>`;
    } },

    { id: 's1', title: '1. 기본 설정', anchors: ['s1-options', 's1-days'], html() {
      const html = withDemo(() => captureTab('setup'));
      return `
      <p class="lead">회차·반 수·시험 일차를 정하는 화면입니다. 옵션은 기본값 그대로 두어도 됩니다.</p>
      ${shot(html, '.grid-2', [['[data-bind="term"]', 1], ['[data-bind="options.corridors"]', 2], ['[data-bind="options.studyHallClassroom"]', 3], ['[data-bind="options.noRepeatRoom"]', 4], ['[data-bind="classes.0"]', 5], ['[data-bind="days.0.date"]', 6], ['[data-bind="days.0.periods"]', 7], ['[data-act="day-add"]', 8]])}
      <h3 id="s1-options">회차와 옵션</h3>
      <ol class="co-list">
        <li>${co(1)}<b>배정 회차</b> — 1차~4차. 2차부터는 교사 명단의 "이전 누적"을 더해 누적이 적은 선생님께 더 배정합니다.</li>
        <li>${co(2)}<b>학년별 복도 감독 수</b> — 교시마다 학년별로 두는 복도 감독 인원. 0이면 복도 감독 없음. 보통 2.</li>
        <li>${co(3)}<b>전체 자습 교시에도 교실 감독</b> — 학년 전체가 자습인 교시에 교실마다 감독을 넣을지. 끄면 복도 감독만 둡니다. 학교 방침대로.</li>
        <li>${co(4)}<b>같은 교실에 두 번 넣지 않음</b> — 한 선생님을 같은 학년-반 교실에 다시 넣지 않습니다. <b>이번 시험 안에서</b> 또는 <b>올해 이전 회차까지</b>(이전 결과 엑셀에서 불러온 교실 이력 포함) 중 고릅니다. 켜도 부족 자리가 생기지 않습니다.</li>
      </ol>
      ${kv([['4차: 3학년 담임·부장 제외', '4차 고사에서만 보입니다. 담임 칸이 <code>3-</code>로 시작하는 선생님(3-1 … 3-부장)을 배정에서 뺍니다. 권장: 켬'], ['3학년 담임 연간 보정 (고급)', '4차에 빠지는 3학년 담임은 3차까지의 평균에 맞추는 것이 원칙이므로 <b>0</b>으로 둡니다. 연말 합계까지 맞추고 싶을 때만 1을 넣으면 1~3차에서 회차당 1시간씩 더 배정합니다.']], ['그 밖의 옵션', '설명'])}
      <h3 id="s1-days">반 수 · 일차 · 교시</h3>
      <ol class="co-list">
        <li>${co(5)}<b>학년별 반 수</b> — 바꾸면 2단계의 자습/제외 번호 버튼 개수가 바로 바뀝니다. 이미 입력한 과목은 그대로 남습니다.</li>
        <li>${co(6)}<b>날짜</b> — 결과표와 엑셀에 그대로 적힙니다(예: 4/27).</li>
        <li>${co(7)}<b>교시 수</b> — 그날의 시험 교시 수. 줄여도 입력했던 과목은 지워지지 않고 숨겨지므로, 다시 늘리면 되살아납니다.</li>
        <li>${co(8)}<b>+ 일차 추가</b> — 시험 날짜를 늘립니다. 일차를 삭제(✕)하면 그날의 과목과 예외 입력도 함께 지워집니다(확인 창이 뜹니다).</li>
      </ol>`;
    } },

    { id: 's2', title: '2. 시험 과목', anchors: ['s2-paste'], html() {
      const html = withDemo(() => captureTab('subjects'));
      return `
      <p class="lead">일차별 표에서 교시마다 1·2·3학년의 시험 과목을 적습니다. 엑셀 표를 복사해 붙여넣으면 한 번에 채워집니다.</p>
      ${shot(html, '.panel', [['[data-act="subj-paste"]', 1], ['[data-subjpart="0,1,1,0"]', 2], ['.sc-mini.sp.on', 3], ['[data-subjpart="0,2,3,0"]', 4], ['tr:nth-child(2) td:nth-child(3) .chips.study', 5], ['tr:nth-child(1) td:nth-child(2) .chips.excl', 6], ['tr:nth-child(3) td:nth-child(4) .sc-sum', 7]], { remove: '.days-grid .day-card:not(:first-child)', title: '1일차 표 (2일차 이후는 아래로 이어짐)' })}
      <ol class="co-list">
        <li>${co(1)}<b>엑셀에서 붙여넣기</b> — 큰 입력창을 엽니다. 1·2·3학년 세 열(또는 일차·시험일·교시가 포함된 여섯 열)을 붙여넣으면 1일차 1교시부터 차례로 채웁니다.</li>
        <li>${co(2)}<b>과목명</b> — 그 교시 그 학년의 시험 과목. <b>비워 두면 "시험 없음"</b>으로 보고 감독을 넣지 않습니다. <code>자습</code>이라고 적으면 학년 전체 자습입니다.</li>
        <li>${co(3)}<b>+추가반</b> — 이동수업 등으로 교실이 하나 더 필요할 때 누릅니다. 아래에 나타나는 칸에 장소(예: 어학실)를 적으면 결과와 엑셀에 그 이름이 들어가고, 비우면 "8반"처럼 마지막 반 다음 번호가 됩니다.</li>
        <li>${co(4)}<b>+과목</b> — 같은 시간에 두 과목이 치러지면 눌러서 두 번째 칸에 적습니다. 두 과목 교사 모두 그 시간 감독에서 빠지며, 결과·엑셀에는 <code>세계사/경제</code>처럼 표시됩니다. 교실은 반 수대로 하나씩이므로 추가반은 하나면 됩니다.</li>
        <li>${co(5)}<b>자습 번호</b> ${swatch('#ffe58a')} — 그 반이 자습임을 표시합니다. 자습 교실 감독은 "자습 시수"로 따로 셉니다. <b>자습</b> 글자를 누르면 모든 반을 한 번에 켜고 끕니다.</li>
        <li>${co(6)}<b>제외 번호</b> ${swatch('#ffc9c9')} — 그 반에는 감독을 넣지 않습니다(예: 그 반 학생 전원이 다른 곳에서 시험). 같은 반을 자습과 제외에 동시에 켤 수 없으며, 나중에 누른 쪽이 남습니다.</li>
        <li>${co(7)}<b>요약 줄</b> — "교실 7 · 복도 2"처럼 그 칸에서 생기는 감독 자리 수가 바로 표시됩니다.</li>
      </ol>
      <div class="note">학년 전체가 자습인 교시(<code>자습</code>이라고 적거나 모든 반의 자습 번호를 켠 경우)는 1단계의 "전체 자습 교시에도 교실 감독" 옵션에 따라 교실 감독을 넣거나 복도 감독만 둡니다.</div>
      <h3 id="s2-paste">엑셀에서 붙여넣기</h3>
      <ul>
        <li>엑셀에서 과목 표를 드래그해 복사(<kbd>Ctrl</kbd>+<kbd>C</kbd>)한 뒤, 시작할 과목 칸을 클릭하고 붙여넣기(<kbd>Ctrl</kbd>+<kbd>V</kbd>)하면 그 칸부터 아래·오른쪽으로 채워집니다. 1교시 1학년 칸에 붙여넣으면 가장 편합니다.</li>
        <li>붙여넣기는 과목명만 바꾸고, 이미 눌러 둔 자습·제외·추가반은 그대로 둡니다. 과목명에 <code>*(장소)</code>가 들어 있으면 추가반으로 자동 변환됩니다.</li>
        <li><b>모두 지우기</b>는 모든 일차의 과목명·자습·제외·추가반을 지웁니다. 일차와 교시 수는 남습니다.</li>
      </ul>`;
    } },

    { id: 's3', title: '3. 교사 명단', anchors: ['s3-type', 's3-excel'], html() {
      const html = withDemo(() => captureTab('teachers'));
      return `
      <p class="lead">교사 명단을 엑셀에서 한 번에 넣고, 담임·구분·목표시수·이전 누적을 확인하는 화면입니다.</p>
      ${shot(html, '.teachers-layout > .panel', [['[data-act="t-excel"]', 1], ['[data-act="t-paste"]', 2], ['[data-act="t-prev-import"]', 3], ['thead th:nth-child(3)', 4], ['thead th:nth-child(4)', 5], ['thead th:nth-child(5)', 6], ['thead th:nth-child(6)', 7], ['thead th:nth-child(7)', 8]], { title: '전체 교사 명단' })}
      <ol class="co-list">
        <li>${co(1)}<b>엑셀 불러오기</b> — 첫 번째 시트를 읽습니다. 첫 줄에 머리글(이름, 과목, 담임, 교사구분 또는 구분, 목표시수, 누적)이 있으면 열 순서는 상관없습니다. 이미 명단이 있으면 <b>뒤에 추가</b>할지 <b>새 명단으로 바꿀지</b> 묻습니다.</li>
        <li>${co(2)}<b>붙여넣기</b> — 엑셀 표를 복사해 넣는 방식으로 파일 형식과 상관없이 쓸 수 있습니다. 예전 형식(.xls)은 이 방법을 쓰거나 .xlsx로 저장한 뒤 불러오세요. 표 안의 칸을 클릭하고 <kbd>Ctrl</kbd>+<kbd>V</kbd>로 여러 칸을 한 번에 넣을 수도 있습니다.</li>
        <li>${co(3)}<b>이전 회차 결과 엑셀에서 누적 불러오기</b> — 지난 회차에 저장한 결과 엑셀을 열어 "이전 누적"을 한 번에 채우고, 각 선생님이 들어갔던 교실 이력도 함께 보관합니다. 2차부터 씁니다.</li>
        <li>${co(4)}<b>과목</b> — 담당 과목. 여러 과목은 <code>/</code>로 구분합니다(예: <code>화학/윤리</code>). <b>본인 과목 시험 시간에는 감독에서 빠집니다.</b> <code>수학</code> 교사는 <code>수학Ⅰ</code>·<code>수학Ⅱ</code>·<code>수학(미적)</code> 시험과 같은 과목으로 봅니다. 표기가 달라 짝을 찾지 못하면 4단계 점검 목록에 표시됩니다.</li>
        <li>${co(5)}<b>담임</b> — <code>2-5</code>처럼 학년-반. 부장은 <code>3-부장</code>. 담임은 본인 반 교실에 들어가지 않습니다. 담임이 아니면 비웁니다.</li>
        <li>${co(6)}<b>구분</b> — 아래 표 참고. 같은 이름이 둘이면 이름 칸이 빨갛게 표시되니 <code>홍길동A</code>처럼 구분해 주세요.</li>
        <li>${co(7)}<b>목표</b> — 원로: 이번 시험에서 채울 시수(필수). 그 밖의 구분: 적어 두면 이 시수를 넘기지 않도록 합니다(비우면 제한 없음).</li>
        <li>${co(8)}<b>누적</b> — 지난 회차까지의 전체 시수. 2차부터 쓰며, 누적이 적은 선생님께 더 배정합니다. 1차 고사에서는 흐리게 보이고 쓰지 않습니다.</li>
      </ol>
      <h3 id="s3-type">구분과 배정 방식</h3>
      ${kv([['일반', '모든 자리에 들어갈 수 있고, 누적 시수가 고르게 되도록 배정합니다.'], ['고사담당', '시험 운영 담당. <b>1교시에만</b> 배정하고 2교시부터는 빠집니다. 예비 명단에도 넣지 않습니다.'], ['원로', '교실 감독만 하고 복도·자습 감독은 하지 않습니다. 목표시수만큼 채우며, 하루 상한은 목표시수÷시험일수(올림)입니다.'], ['순회', '복도 감독과 자습 교실만 맡고, 시험 치르는 교실에는 들어가지 않습니다.'], ['제외', '출산·연수 등으로 이번 시험 감독에서 완전히 뺍니다. 명단에는 남아 시수표에 표시됩니다.']], ['구분', '배정 방식'])}
      <h3 id="s3-excel">엑셀 양식</h3>
      <p>머리글이 없으면 <code>[연번,] 이름, 과목, 담임, 구분, 목표시수, 이전누적</code> 순서로 읽습니다. 예:</p>
      ${kv([['김지연', '국어', '1-1', '일반', '', '6'], ['박서준', '수학', '', '고사담당', '', '4'], ['정하은', '영어', '3-부장', '원로', '4', '5']], ['이름', '과목', '담임', '구분', '목표시수', '누적'])}`;
    } },

    { id: 's4', title: '3. 특수실 · 예외', anchors: ['s4-special', 's4-exceptions'], html() {
      const html = withDemo(() => captureTab('teachers'));
      return `
      <p class="lead">3단계 오른쪽에는 시험 기간 내내 따로 자리를 지키는 <b>특수실</b>과, 특정 교시에 감독할 수 없는 <b>예외 감독자</b>를 적습니다. 없으면 비워 둡니다.</p>
      ${shot(html, '.side-grid', [['[data-act="sp-add"]', 1], ['[data-bind="specials.0.teacher"]', 2], ['[data-bind="specials.0.hours"]', 3], ['[data-act="ex-add"]', 4], ['[data-exmove="0,0"]', 5], ['[data-bind="days.0.exceptions.0.period"]', 6], ['[data-bind="days.0.exceptions.0.name"]', 7]], { cls: 'side' })}
      <h3 id="s4-special">특수실</h3>
      <ol class="co-list">
        <li>${co(1)}<b>+ 추가</b> — 특수학급처럼 한 선생님이 시험 기간 내내 따로 자리를 지키는 곳을 한 줄씩 적습니다.</li>
        <li>${co(2)}<b>지정자</b> — 명단에서 고릅니다. 지정자는 일반 감독에서 빠지고 결과에 "특수(명칭)"으로 표시됩니다.</li>
        <li>${co(3)}<b>시수</b> — 적어 둔 시수가 그 선생님의 이번 회차 시수에 더해져 시수표와 누적에 반영됩니다.</li>
      </ol>
      <h3 id="s4-exceptions">일차·교시별 예외 감독자</h3>
      <ol class="co-list">
        <li>${co(4)}<b>+ 추가</b> — 출장·연가·수업 등으로 특정 교시에 감독할 수 없는 선생님을 한 줄씩 적습니다.</li>
        <li>${co(5)}<b>일차</b> — 어느 날인지 고릅니다. 바꾸면 그 날의 줄로 옮겨집니다.</li>
        <li>${co(6)}<b>교시</b> — 종일 자리를 비우면 <b>종일</b>을 고릅니다.</li>
        <li>${co(7)}<b>이름</b> — 명단에서 선택합니다. 명단에 없는 이름은 빨갛게 표시되고 적용되지 않습니다(이름 뒤 공백이나 오타가 흔한 원인).</li>
      </ol>
      <div class="note">예외로 적힌 교시에는 감독뿐 아니라 예비 명단에서도 빠집니다. 사유는 결과_감독표의 비고 칸에 함께 적힙니다.</div>`;
    } },

    { id: 's5', title: '4. 배정 결과', anchors: [], html() {
      const html = withDemo(() => captureTab('result'), 'grid');
      const person = withDemo(() => captureTab('result'), 'person');
      return `
      <p class="lead">배정을 실행하고 결과를 세 가지 표로 검토한 뒤 엑셀로 저장하는 화면입니다. 처음에는 <b>배정 시작</b> 버튼 하나만 보이고, 배정이 끝나면 아래처럼 바뀝니다.</p>
      ${shot(html, '.panel', [['details.issue-group > summary', 1], ['.kpis', 2], ['[data-act="clear-result"]', 3], ['[data-act="apply-cum"]', 4], ['[data-act="rerun"]', 5], ['[data-act="run"]', 6], ['[data-act="export"]', 7], ['.seg', 8], ['td.slot.corr', 9], ['td.subjcol.study', 10]], { title: '배정 후 · 감독표' })}
      <ol class="co-list">
        <li>${co(1)}<b>배정 전 점검</b> — 빨간 항목(명단 없음, 이름 중복 등)은 해결해야 배정할 수 있습니다. 노란 항목은 배정은 되지만 결과에 영향을 줄 수 있는 것(과목명 불일치, 교사 부족 가능성 등), 참고 항목은 비어 있는 과목 칸 같은 안내입니다.</li>
        <li>${co(2)}<b>요약 칩</b> — <b>부족</b>(감독 부족 자리)과 <b>위반</b>(규칙 위반 칸)이 0인지 먼저 확인합니다. 누적 범위·평균은 일반 교사 기준이고, 📌는 직접 고친 칸 수입니다. 마우스를 올리면 뜻이 나옵니다.</li>
        <li>${co(3)}<b>결과 지우기</b> — 결과를 버리고 배정 전으로 돌아갑니다.</li>
        <li>${co(4)}<b>누적 반영 → 다음 회차</b> — 이번 결과의 시수를 "이전 누적"에 더하고 교실 이력을 보관한 뒤 회차를 하나 올립니다. 엑셀로 저장한 뒤에 누르세요.</li>
        <li>${co(5)}<b>다시 돌리기 (📌 유지)</b> — 직접 고쳐 고정한 칸은 그대로 두고 나머지만 다시 고르게 맞춥니다.</li>
        <li>${co(6)}<b>처음부터 새로 배정</b> — 고정한 칸까지 버리고 새 조합을 만듭니다.</li>
        <li>${co(7)}<b>엑셀로 저장</b> — 감독표·시수표·개인별시간표 세 시트가 든 파일을 받습니다(다음 장).</li>
        <li>${co(8)}<b>감독표 / 개인별 시간표 / 시수표</b> — 같은 결과를 세 가지로 봅니다. 감독표는 교시·학년별 교실 배치(게시용), 개인별 시간표는 선생님별 교시 배치, 시수표는 선생님별 합계입니다.</li>
        <li>${co(9)}<b>칸 색</b> — ${swatch('#fff4c2')}자습 ${swatch('#ece8fb')}복도 ${swatch('#dbeafe')}본인 시험 ${swatch('#fce7f3')}예비 ${swatch('#fef2f2')}부족. ⚠는 규칙 위반(마우스를 올리면 이유), 📌는 직접 고친 칸입니다.</li>
        <li>${co(10)}<b>과목 칸</b> — 노란색은 자습(전체 또는 일부 반). 오른쪽 끝 <b>예비</b>는 그 교시에 비어 있는 선생님을 누적이 적은 순으로 보여 줍니다.</li>
      </ol>
      ${shot(person, '.result-table-panel', [['table.res thead th.subj', 1], ['td.slot.own', 2], ['table.res tbody tr:first-child td:last-child', 3]], { title: '개인별 시간표' })}
      <ol class="co-list">
        <li>${co(1)}머리글에 그 교시의 학년별 과목이 보입니다.</li>
        <li>${co(2)}파란 칸은 본인 과목 시험이라 감독에서 빠진 교시입니다. 비어 있는 칸을 누르면 그 선생님을 그 교시의 어느 자리에 넣을지 고를 수 있습니다.</li>
        <li>${co(3)}오른쪽 끝은 교실·복도·자습·특수 시수, 이번 합계, 전체 누적입니다. 시수표의 <b>가능 교시</b>는 그 선생님이 이번 시험에서 들어갈 수 있는 교시 수로, 본인 과목 시험이 많거나 고사담당이면 적습니다. 이런 분이 적게 배정되는 것은 규칙 때문이지 오류가 아닙니다.</li>
      </ol>`;
    } },

    { id: 's5-edit', title: '결과 직접 수정', anchors: [], html() {
      const html = withDemo(() => {
        const model = currentModel();
        const ev = E.evaluate(model, state.result.assign);
        const slot = model.slots.find((x) => x.kind === 'class' && x.pi === 1 && state.result.assign[x.id]);
        const per = model.periods[slot.pi];
        const gi = per.grades[slot.grade - 1];
        return `<div class="modal" style="width:auto;max-height:none;box-shadow:none;border:1px solid var(--line)"><div class="modal-head"><h3>감독 바꾸기</h3></div><div class="modal-body"><p>${per.dayLabel} ${esc(per.date)} ${per.p}교시 · <b>${slot.grade}학년 ${slot.classNo}반</b> · ${esc(gi.label)}<br>현재: <b>${esc(state.result.assign[slot.id])}</b></p>${candidateHTML(model, ev, slot)}</div><div class="modal-foot"><button class="btn danger">비우기</button><button class="btn">취소</button></div></div>`;
      });
      return `
      <p class="lead">감독표나 개인별 시간표에서 <b>칸을 누르면</b> 아래 창이 열립니다. 누적이 적은 순으로 후보가 나오고, 같은 교시의 다른 자리와 맞바꿀 수도 있습니다.</p>
      ${shot(html, null, [['.cand-search', 1], ['div.cand-group:nth-of-type(2) h4', 2], ['div.cand-group:nth-of-type(3) h4', 3], ['details.cand-group summary', 4], ['.cand.free', 5]], { title: '감독 바꾸기 창' })}
      <ol class="co-list">
        <li>${co(1)}<b>이름 검색</b> — 후보가 많을 때 이름 일부로 거릅니다.</li>
        <li>${co(2)}<b>바로 넣을 수 있는 선생님</b> — 그 교시에 비어 있고 규칙에 맞는 분. 괄호 안은 누적 시수입니다. 누르면 바로 바뀝니다.</li>
        <li>${co(3)}<b>같은 교시 다른 자리와 맞바꾸기</b> — 그 교시에 이미 다른 자리에 들어간 분과 자리를 바꿉니다. ⚠가 붙으면 바꾼 뒤 상대 자리에서 규칙에 걸린다는 뜻입니다.</li>
        <li>${co(4)}<b>규칙상 어려운 선생님</b> — 이유(본인 시험, 담임 반, 예외 등)가 함께 보이며, 그래도 넣을 수는 있습니다. 넣으면 그 칸에 ⚠가 표시되고 저장은 막지 않습니다.</li>
        <li>${co(5)}후보 옆의 작은 글씨는 누적 시수와 그날 들어가는 교시 수입니다.</li>
      </ol>
      <ul>
        <li>직접 고친 칸은 📌로 고정됩니다. <b>다시 돌리기 (📌 유지)</b>는 고정한 칸은 그대로 두고 나머지만 다시 고르게 맞춥니다. <b>고정 모두 풀기</b>로 해제할 수 있습니다.</li>
        <li>배정 후 입력(과목·교사·예외)을 바꾸면 결과 위에 "입력이 바뀜" 안내가 뜹니다. 바뀐 입력으로 결과를 다시 검사해 보여 주며, 다시 돌리기로 반영합니다.</li>
      </ul>`;
    } },

    { id: 's5-excel', title: '엑셀 저장과 다음 회차', anchors: [], html() {
      return `
      <p class="lead"><b>엑셀로 저장</b>을 누르면 시트 세 개가 든 파일 하나를 받습니다. 게시용·보관용으로 쓰고, 다음 회차에서 누적을 불러올 때도 이 파일을 씁니다.</p>
      ${kv([['결과_감독표', '일차·교시·학년별로 1반~N반, 추가반, 복도 감독 이름. 자습 칸은 노란색, 부족 칸은 빨간색, 비고에 특수실과 예외 사유. <b>게시용</b>입니다.'], ['결과_시수표', '교사별 교실·복도·자습·특수실 시수, 이번 합계, 이전 누적, 전체 누적. <b>다음 회차에서 누적을 불러올 때 이 시트를 읽습니다.</b>'], ['결과_개인별시간표', '교사별 교시 배정(예: 2-3, 1-복도1, 3-과학실, (자습) 표시). 본인 시험 교시는 파란색, 아래에 교시별 예비 명단(분홍). 통계 열은 엑셀 수식이라 손으로 고쳐도 다시 계산되고, 복도·자습 색도 따라갑니다. 다음 회차의 교실 이력은 이 시트에서 읽습니다.']], ['시트', '내용'])}
      <div class="note">엑셀에서 긴 이름(예: 특수(지능형과학실))은 셀 크기에 맞춰 글자가 줄어들도록 저장됩니다. 머리글의 과목명은 줄바꿈으로 전부 보입니다.</div>
      <h3>다음 회차로 넘어가기</h3>
      <ol class="steps-list">
        <li>결과를 검토하고 <b>엑셀로 저장</b>합니다.</li>
        <li><b>누적 반영 → 다음 회차</b>를 누릅니다. 이번 시수가 "이전 누적"에 더해지고, 들어갔던 교실이 이력으로 보관되며, 회차가 하나 올라갑니다. 결과는 비워집니다.</li>
        <li>다음 시험 때 2단계 과목과 일차, 3단계 예외만 새로 고치고 배정합니다.</li>
      </ol>
      <p>누적 반영을 누르지 않았거나 다른 컴퓨터에서 이어서 할 때는, 3단계의 <b>이전 회차 결과 엑셀에서 누적 불러오기</b>로 지난 엑셀 파일을 읽으면 같은 결과가 됩니다.</p>
      <h3>저장이 안 될 때</h3>
      <p>브라우저가 다운로드를 막았는지 주소창 오른쪽의 아이콘을 확인하세요. 파일 이름의 한글이 깨지면 브라우저 설정의 언어가 한국어인지 확인합니다.</p>`;
    } },

    { id: 'rules', title: '배정 규칙과 원리', anchors: [], html() {
      return `
      <h3>반드시 지키는 규칙</h3>
      <ul class="two-col">
        <li>같은 교시에 한 자리</li><li>본인 과목 시험 시간 제외</li><li>담임은 본인 반 교실 제외</li><li>예외 감독자 제외</li><li>특수실 지정자 제외</li><li>하루 3교시 연속 금지</li><li>고사담당은 1교시만</li><li>순회는 시험 교실 제외</li><li>원로는 복도·자습 제외, 목표시수와 하루 상한 준수</li><li>제외 교사와 (4차) 3학년 담임·부장 제외</li><li>(옵션) 같은 교실 두 번 금지</li>
      </ul>
      <h3>고르게 맞추는 순서</h3>
      <ol class="steps-list">
        <li>감독 부족 없음</li><li>목표시수 초과 없음</li><li>원로 목표 채우기</li><li>일반 교사 전체 누적 시수 차이 최소</li><li>복도·자습 / 교실 시수 차이</li><li>복도끼리·자습끼리도 고르게 (한 사람이 복도만, 자습만 맡지 않게)</li><li>하루에 몰리지 않게</li><li>연속 교시 줄이기</li><li>같은 교실 반복 줄이기</li>
      </ol>
      <p>초안을 만든 뒤 수십만 번 감독을 바꾸거나 맞바꿔 보며 점수가 좋아지는 쪽으로 다듬습니다(담금질 기법). 가상 학교 자료로 검증했을 때 결과는 이론상 가장 고른 분배와 같거나 1시간 차이였으며, 남는 차이는 규칙(본인 시험이 많은 과목, 고사담당 1교시 제한 등) 때문입니다.</p>`;
    } },

    { id: 'faq', title: '자주 묻는 질문', anchors: [], html() {
      const qa = (q, a) => `<details class="faq" open><summary>${q}</summary><p>${a}</p></details>`;
      return `
      ${qa('부족 자리가 생깁니다.', '그 교시에 들어갈 수 있는 교사가 자리보다 적은 것입니다. 점검 목록에 "필요한 감독 N명 > 가능한 교사 M명"으로 미리 표시됩니다. 복도 감독 수를 줄이거나, 전체 자습 교시의 교실 감독을 끄거나, 그 교시의 예외를 줄이거나, 고사담당·순회 구분을 조정해 보세요.')}
      ${qa('어떤 선생님만 시수가 적습니다.', '시수표의 "가능 교시"를 보세요. 본인 과목 시험이 여러 교시에 있거나(국·영·수), 고사담당이거나, 예외가 많으면 들어갈 수 있는 교시 자체가 적습니다. 과목명이 시험 과목과 다르게 적혀 있어도(예: 교사 "물리" ↔ 시험 "물리학Ⅰ") 점검 목록에 표시됩니다.')}
      ${qa('4차 고사에서 3학년 담임은 어떻게 되나요?', '"3학년 담임·부장 제외"가 켜져 있으면 배정에서 빠집니다. 이분들의 시수는 3차까지의 누적을 기준으로 보며, 연말 합계로 비교하지 않습니다. 4차에도 1·2학년 감독을 맡기려면 옵션을 끄세요.')}
      ${qa('"같은 교실 두 번 금지"를 켜면 자리가 모자라지 않나요?', '아닙니다. 한 선생님이 한 시험에 교실 3~4번 들어가고 교실은 20개가 넘어 여유가 큽니다. 1년 내내 금지해도 부족 자리가 생기지 않는 것을 확인했습니다.')}
      ${qa('두 과목이 같은 교시에 치러지면 추가반을 둘 두어야 하나요?', '아닙니다. 두 과목이 동시에 치러져도 교실은 반마다 하나이고 추가반도 하나면 됩니다. <b>+과목</b>으로 두 과목을 적어 두면 두 과목 교사 모두 그 시간 감독에서 빠집니다.')}
      ${qa('예전 프로그램의 백업 파일을 그대로 쓸 수 있나요?', '네. 백업 불러오기로 열면 반 수·일차·과목(자습·제외 버튼 포함)·교사·특수실·예외가 변환됩니다. 과목명 뒤의 <code>*(장소)</code>는 추가반 버튼으로 바뀝니다.')}
      ${qa('엑셀 저장이 되지 않습니다.', '브라우저가 다운로드를 막았는지 주소창 오른쪽의 아이콘을 확인하세요. 파일 이름에 한글이 깨지면 브라우저 설정의 언어가 한국어인지 확인합니다.')}
      ${qa('두 사람이 같은 컴퓨터를 쓰면?', '브라우저 사용자(프로필)가 다르면 자료가 따로 저장됩니다. 같은 프로필이면 하나의 자료를 공유하니 백업 파일로 각자 보관하세요.')}`;
    } },
  ];

  function helpChapterIndex(topic) {
    if (!topic) return 0;
    let i = HELP_CHAPTERS.findIndex((c) => c.id === topic);
    if (i < 0) i = HELP_CHAPTERS.findIndex((c) => c.anchors.includes(topic));
    return Math.max(0, i);
  }

  function showHelp(topic) {
    const N = HELP_CHAPTERS.length;
    let cur = helpChapterIndex(topic);
    const cache = {};
    const tocHTML = () => HELP_CHAPTERS.map((c, i) => `<a href="#" data-ch="${i}" class="${i === cur ? 'active' : ''}"><span class="toc-no">${i + 1}</span>${esc(c.title)}</a>`).join('');
    const navHTML = () => `<div class="help-nav">
      <button class="btn" data-nav="-1" ${cur === 0 ? 'disabled' : ''}>← 이전</button>
      <span class="muted small">${cur + 1} / ${N}${cur + 1 < N ? ` · 다음: ${esc(HELP_CHAPTERS[cur + 1].title)}` : ''}</span>
      <span class="spacer"></span>
      ${cur + 1 < N ? `<button class="btn ghost" data-close>닫기</button><button class="btn primary" data-nav="1">다음 →</button>` : `<button class="btn ghost" data-ch="0">처음으로</button><button class="btn primary" data-close>닫기</button>`}
    </div>`;
    dialog({
      title: '사용 설명서', xwide: true, html: `<div class="help-layout"><nav class="help-toc">${tocHTML()}</nav><div class="help"><div class="help-chapter"></div></div></div>`,
      onOpen(back) {
        back.querySelector('.modal').classList.add('help-modal');
        const body = $('.modal-body', back);
        $('.modal-foot', back).innerHTML = navHTML();
        const render = (anchor) => {
          const c = HELP_CHAPTERS[cur];
          if (!cache[cur]) cache[cur] = `<h2 id="${c.id}">${esc(c.title)}</h2>${c.html()}`;
          $('.help-chapter', back).innerHTML = cache[cur];
          $('.help-toc', back).innerHTML = tocHTML();
          $('.modal-foot', back).innerHTML = navHTML();
          body.scrollTop = 0;
          if (anchor && anchor !== c.id) { const el = $('#' + anchor, back); if (el) body.scrollTop = el.offsetTop - body.offsetTop - 6; }
        };
        back.addEventListener('click', (e) => {
          const a = e.target.closest('[data-ch]');
          if (a) { e.preventDefault(); cur = +a.dataset.ch; render(); return; }
          const b = e.target.closest('[data-nav]');
          if (b) { cur = Math.max(0, Math.min(N - 1, cur + (+b.dataset.nav))); render(); }
        });
        back.addEventListener('keydown', (e) => {
          if (e.target.tagName === 'INPUT') return;
          if (e.key === 'ArrowRight' && cur + 1 < N) { cur++; render(); }
          if (e.key === 'ArrowLeft' && cur > 0) { cur--; render(); }
        });
        back.tabIndex = -1;
        render(topic);
        back.focus();
      },
    });
  }

  // ---------------------------------------------------------------
  // 이벤트
  // ---------------------------------------------------------------
  let rerenderTimer = null;
  function deferRender(fn, ms) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(fn, ms || 300); }

  function refreshCellSummary(d, p, g) {
    const sum = cellSummary(d, p, g);
    const box = $(`[data-sum="${d},${p},${g}"]`);
    if (box) { box.className = 'sc-sum ' + sum.cls; box.textContent = sum.text; }
  }

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.exmove) {
      const [d, i] = el.dataset.exmove.split(',').map(Number);
      const nd = +el.value;
      if (nd !== d && state.days[nd]) {
        const [row] = state.days[d].exceptions.splice(i, 1);
        row.period = '';
        state.days[nd].exceptions.push(row);
        save(); renderers.teachers(); updateBadges();
      }
      return;
    }
    if (el.dataset && el.dataset.subjpart) {
      const [d, p, g] = el.dataset.subjpart.split(',').map(Number);
      const td = el.closest('td');
      const parts = $$('[data-subjpart]', td).map((x) => x.value.trim()).filter(Boolean);
      state.days[d].subjects[p - 1][g - 1].name = parts.join('/');
      save(); refreshCellSummary(d, p, g); deferRender(updateBadges, 400);
      return;
    }
    const bind = el.dataset && el.dataset.bind;
    if (!bind) return;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num')) {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n)) return;
      val = n;
    }
    setPath(state, bind, val);
    if (bind.startsWith('days.') && bind.endsWith('.periods')) {
      const d = state.days[+bind.split('.')[1]];
      d.periods = Math.max(1, Math.min(10, d.periods));
      while (d.subjects.length < d.periods) d.subjects.push([emptyCell(), emptyCell(), emptyCell()]);
    }
    if (bind.startsWith('classes.')) state.classes = state.classes.map((n) => Math.max(1, Math.min(30, n)));
    save();

    if (el.dataset.subj) { const [d, p, g] = el.dataset.subj.split(',').map(Number); refreshCellSummary(d, p, g); }
    if (bind.startsWith('teachers.')) deferRender(() => { updateTeacherDatalist(); updateBadges(); refreshTeacherDup(); }, 400);
    if (el.hasAttribute('data-namecheck')) {
      const names = new Set(state.teachers.map((t) => t.name.trim()));
      el.classList.toggle('bad', !!el.value.trim() && !names.has(el.value.trim()));
    }
    if (el.dataset.rerender) renderers[el.dataset.rerender]();
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || bind.startsWith('days.') || bind.startsWith('specials.')) deferRender(updateBadges, 300);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.hasAttribute || !el.hasAttribute('data-num')) return;
    el.value = getPath(state, el.dataset.bind);
    updateBadges();
  });

  function refreshTeacherDup() {
    const inputs = $$('[data-bind^="teachers."][data-bind$=".name"]');
    const names = inputs.map((x) => x.value.trim());
    inputs.forEach((x, k) => {
      const dup = !!names[k] && names.filter((n) => n === names[k]).length > 1;
      x.classList.toggle('bad', !!dup);
      x.title = dup ? '이름이 중복됩니다' : '';
    });
  }

  document.addEventListener('paste', (e) => {
    const el = e.target;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    if (el.dataset && el.dataset.subjpart) {
      e.preventDefault();
      const [d, p, g] = el.dataset.subjpart.split(',').map(Number);
      const n = applySubjectGrid(parseClipboardGrid(text), d, p, g);
      save(); renderers.subjects(); updateBadges(); toast(`${n}칸을 붙여넣었습니다.`);
    } else if (el.dataset && el.dataset.tcell) {
      e.preventDefault();
      const [r, c] = el.dataset.tcell.split(',').map(Number);
      const rows = parseClipboardGrid(text);
      applyTeacherGrid(rows, r, c);
      save(); renderers.teachers(); updateTeacherDatalist(); updateBadges(); toast(`${rows.length}줄을 붙여넣었습니다.`);
    }
  });

  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('.step');
    if (tabBtn) return showTab(tabBtn.dataset.tab);
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const i = el.dataset.i != null ? +el.dataset.i : null;
    switch (act) {
      case 'help': return showHelp(el.dataset.topic || '');
      case 'goto': return showTab(el.dataset.tab);
      case 'backup-save': return backupSave();
      case 'backup-load': return backupLoad();
      case 'reset-all': {
        if (!(await confirmBox('전체 초기화', '입력한 모든 자료와 배정 결과를 지웁니다. 먼저 백업 파일을 저장해 두는 것을 권합니다. 계속할까요?', '모두 지우기', 'orange'))) return;
        state = defaultState(); save(false); renderAll(); return;
      }
      case 'day-add': state.days.push(newDay(state.days.length ? state.days[state.days.length - 1].periods : 3)); save(); renderers.setup(); updateBadges(); return;
      case 'day-del': {
        const day = state.days[i];
        const filled = day.subjects.some((r) => r.some((c) => c.name || c.study.length || c.exclude.length || c.special)) || day.exceptions.length;
        if (filled && !(await confirmBox('일차 삭제', `${i + 1}일차의 과목·예외 입력도 함께 지워집니다. 삭제할까요?`, '삭제', 'orange'))) return;
        state.days.splice(i, 1); if (!state.days.length) state.days.push(newDay(3)); save(); renderers.setup(); updateBadges(); return;
      }
      case 'chip': {
        const d = +el.dataset.d, p = +el.dataset.p, g = +el.dataset.g, c = +el.dataset.c, kind = el.dataset.kind;
        const cell = state.days[d].subjects[p - 1][g - 1];
        const other = kind === 'study' ? 'exclude' : 'study';
        const list = cell[kind];
        const k = list.indexOf(c);
        if (k >= 0) list.splice(k, 1); else { list.push(c); list.sort((a, b) => a - b); const o = cell[other].indexOf(c); if (o >= 0) cell[other].splice(o, 1); }
        save();
        const td = $(`#sc-${d}-${p}-${g}`);
        if (td) td.innerHTML = subjectCellHTML(d, p, g);
        deferRender(updateBadges, 300);
        return;
      }
      case 'chip-all': {
        const d = +el.dataset.d, p = +el.dataset.p, g = +el.dataset.g, kind = el.dataset.kind || 'study';
        const cell = state.days[d].subjects[p - 1][g - 1];
        const cc = state.classes[g - 1];
        const other = kind === 'study' ? 'exclude' : 'study';
        if (cell[kind].length >= cc) cell[kind] = [];
        else { cell[kind] = range(1, cc); cell[other] = []; }
        save();
        const td = $(`#sc-${d}-${p}-${g}`);
        if (td) td.innerHTML = subjectCellHTML(d, p, g);
        deferRender(updateBadges, 300);
        return;
      }
      case 'subj-multi': {
        const d = +el.dataset.d, p = +el.dataset.p, g = +el.dataset.g;
        const cell = state.days[d].subjects[p - 1][g - 1];
        const parts = cell.name.split('/').map((x) => x.trim()).filter(Boolean);
        if (cell.multi || parts.length > 1) {
          if (parts.length > 1 && !(await confirmBox('과목 칸 닫기', `두 번째 과목 "${esc(parts.slice(1).join('/'))}"을(를) 지우고 칸을 닫을까요?`, '닫기', 'orange'))) return;
          cell.name = parts[0] || ''; cell.multi = false;
        } else cell.multi = true;
        save();
        const td = $(`#sc-${d}-${p}-${g}`);
        if (td) { td.innerHTML = subjectCellHTML(d, p, g); const inp = $('[data-subjpart$=",1"]', td); if (inp) inp.focus(); }
        deferRender(updateBadges, 300);
        return;
      }
      case 'sp-toggle': {
        const d = +el.dataset.d, p = +el.dataset.p, g = +el.dataset.g;
        const cell = state.days[d].subjects[p - 1][g - 1];
        cell.special = !cell.special;
        save();
        const td = $(`#sc-${d}-${p}-${g}`);
        if (td) { td.innerHTML = subjectCellHTML(d, p, g); const inp = $('.sc-room', td); if (inp) inp.focus(); }
        deferRender(updateBadges, 300);
        return;
      }
      case 'subj-clear': {
        if (!(await confirmBox('과목 모두 지우기', '모든 일차의 과목명·자습·제외·추가반 입력을 지울까요? (일차와 교시 수는 남습니다)', '모두 지우기', 'orange'))) return;
        state.days.forEach((day) => day.subjects.forEach((row) => row.forEach((c, g) => { row[g] = emptyCell(); })));
        save(); renderers.subjects(); updateBadges(); return;
      }
      case 'subj-paste': {
        const txt = await dialog({
          title: '과목 붙여넣기', wide: true,
          html: `<p class="small">엑셀에서 <b>1학년·2학년·3학년</b> 세 열(또는 일차·시험일·교시를 포함한 여섯 열)을 복사해서 아래에 붙여넣으세요. 1일차 1교시부터 차례로 채웁니다. 지금 들어 있는 과목명은 덮어쓰고, 자습·제외·추가반 설정은 그대로 둡니다.</p><textarea id="pasteBox" placeholder="국어	통합과학	한국사&#10;수학	화학	지구과학"></textarea>`,
          buttons: [{ label: '취소', value: null }, { label: '채우기', value: (b) => $('#pasteBox', b).value, cls: 'primary' }],
          onOpen: (b) => $('#pasteBox', b).focus(),
        });
        if (!txt) return;
        let rows = parseClipboardGrid(txt);
        rows = rows.map((r) => (r.length >= 6 ? r.slice(3, 6) : r));
        const n = applySubjectGrid(rows, 0, 1, 1);
        save(); renderers.subjects(); updateBadges(); toast(`${n}칸을 채웠습니다.`);
        return;
      }
      case 't-add': state.teachers.push(newTeacher()); save(); renderers.teachers(); { const inp = $$('[data-tcell$=",0"]').pop(); if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); } } return;
      case 't-del': state.teachers.splice(i, 1); save(); renderers.teachers(); updateTeacherDatalist(); updateBadges(); return;
      case 't-clear':
        if (!(await confirmBox('명단 전체 삭제', '교사 명단을 모두 지울까요?', '모두 지우기', 'orange'))) return;
        state.teachers = []; save(); renderers.teachers(); updateTeacherDatalist(); updateBadges(); return;
      case 't-excel':
      case 't-paste': {
        let list = [];
        if (act === 't-excel') {
          const f = await pickFile('.xlsx,.xls');
          if (!f) return;
          try { const sheets = await X.readWorkbook(f); list = X.rowsToTeachers(sheets[0].rows); }
          catch (err) { await dialog({ title: '엑셀 읽기 실패', html: `<p>${esc(err.message)}</p>` }); return; }
        } else {
          const txt = await dialog({
            title: '교사 명단 붙여넣기', wide: true,
            html: `<p class="small">엑셀 표를 머리글(이름, 과목, 담임, 교사구분, 목표시수)째로 복사해 붙여넣으면 열 순서와 상관없이 읽습니다. 머리글 없이 붙여넣으면 <code>[연번,] 이름, 과목, 담임, 교사구분, 목표시수, 이전누적</code> 순서로 읽습니다.</p><textarea id="pasteBox" placeholder="이름	과목	담임	교사구분	목표시수&#10;홍길동	수학	2-5	일반	"></textarea>`,
            buttons: [{ label: '취소', value: null }, { label: '읽기', value: (b) => $('#pasteBox', b).value, cls: 'primary' }],
            onOpen: (b) => $('#pasteBox', b).focus(),
          });
          if (!txt) return;
          list = X.rowsToTeachers(parseClipboardGrid(txt));
        }
        if (!list.length) { toast('읽은 교사가 없습니다.'); return; }
        let mode = 'replace';
        if (state.teachers.some((t) => t.name.trim())) {
          mode = await dialog({ title: '교사 명단', html: `<p>${list.length}명을 읽었습니다. 지금 명단(${state.teachers.length}명)을 어떻게 할까요?</p>`, buttons: [{ label: '취소', value: null }, { label: '뒤에 추가', value: 'append' }, { label: '새 명단으로 바꾸기', value: 'replace', cls: 'primary' }] });
          if (!mode) return;
        }
        state.teachers = mode === 'append' ? state.teachers.concat(list) : list;
        save(); renderers.teachers(); updateTeacherDatalist(); updateBadges(); toast(`${list.length}명을 불러왔습니다.`);
        return;
      }
      case 't-prev-import': {
        const f = await pickFile('.xlsx');
        if (!f) return;
        try {
          const sheets = await X.readWorkbook(f);
          const cum = X.sheetsToCumulative(sheets);
          const rooms = X.sheetsToRoomHistory(sheets);
          let hit = 0, roomN = 0;
          const miss = [];
          state.teachers.forEach((t) => { const n = t.name.trim(); if (!n) return; if (n in cum) { t.prev = String(cum[n]); hit++; } else miss.push(n); });
          Object.keys(rooms).forEach((n) => { const set = new Set((state.roomHistory[n] || []).concat(rooms[n])); state.roomHistory[n] = Array.from(set); roomN += rooms[n].length; });
          if (state.term === TERMS[0]) state.term = TERMS[1];
          save(); renderers.teachers(); updateBadges(); renderSaveState();
          await dialog({ title: '누적 시수 불러오기', html: `<p>${hit}명의 누적 시수를 넣었습니다.${miss.length ? `<br>파일에 없는 선생님 ${miss.length}명(0으로 시작): ${esc(miss.join(', '))}` : ''}</p>${roomN ? `<p>교실 이력 ${roomN}건을 보관했습니다. (1단계에서 "올해 이전 회차까지"를 고르면 이 교실들을 피합니다)</p>` : ''}<p class="muted">배정 회차: ${esc(state.term)}</p>` });
        } catch (err) { await dialog({ title: '불러오기 실패', html: `<p>${esc(err.message)}</p>` }); }
        return;
      }
      case 't-prev-clear':
        if (!(await confirmBox('누적 비우기', '모든 선생님의 이전 누적 시수와 보관 중인 교실 이력을 지울까요?', '지우기', 'orange'))) return;
        state.teachers.forEach((t) => { t.prev = ''; }); state.roomHistory = {}; save(); renderers.teachers(); return;
      case 'sp-add': state.specials.push({ room: '', teacher: '', hours: '' }); save(); renderers.teachers(); { const inp = $$('[data-bind^="specials."][data-bind$=".room"]').pop(); if (inp) inp.focus(); } return;
      case 'sp-del': state.specials.splice(i, 1); save(); renderers.teachers(); updateBadges(); return;
      case 'ex-add': {
        let d = el.dataset.d != null ? +el.dataset.d : -1;
        if (d < 0) { d = 0; state.days.forEach((day, k) => { if (day.exceptions.length) d = k; }); }
        state.days[d].exceptions.push({ period: '', name: '', reason: '' });
        save(); renderers.teachers();
        const rows = $$(`[data-bind^="days.${d}.exceptions."][data-bind$=".period"]`); if (rows.length) rows[rows.length - 1].focus();
        return;
      }
      case 'ex-del': state.days[+el.dataset.d].exceptions.splice(i, 1); save(); renderers.teachers(); updateBadges(); return;
      case 'run': return runAssign(false);
      case 'rerun': return runAssign(true);
      case 'export': return exportExcel();
      case 'sub': ui.sub = el.dataset.k; saveUI(); return renderers.result();
      case 'slot': if (!running) openSlotEditor(el.dataset.id); return;
      case 'pcell': if (!running) openPersonCell(el.dataset.name, +el.dataset.pi); return;
      case 'unpin-all': state.result.pinned = {}; save(); return renderers.result();
      case 'clear-result':
        if (!(await confirmBox('결과 지우기', '배정 결과와 직접 고친 내용을 지울까요?', '지우기', 'orange'))) return;
        state.result = null; save(); renderers.result(); updateBadges(); return;
      case 'apply-cum': return applyCumulative();
      default:
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY && e.newValue) { state = normalizeState(JSON.parse(e.newValue)); renderAll(); toast('다른 창에서 바뀐 내용을 불러왔습니다.'); }
  });

  // 시작
  renderStepper();
  if (ui.tab === 'extras') ui.tab = 'teachers';
  if (!STEPS.some((s) => s.key === ui.tab)) ui.tab = 'setup';
  renderAll();
  showTab(ui.tab);
  if (!ui.seenIntro) showIntro();
  window.__app = { get state() { return state; }, showHelp };
})();
