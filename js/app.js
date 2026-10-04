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
  function dialog({ title, html, buttons, wide, onOpen }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
        <div class="modal-body">${html}</div>
        <div class="modal-foot">${(buttons || [{ label: '닫기', value: null }]).map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-close]')) return close(null);
        const b = e.target.closest('.modal-foot [data-i]');
        if (b) {
          const def = buttons[+b.dataset.i];
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
  const emptyCell = () => ({ name: '', study: [], exclude: [] });
  const newDay = (periods) => ({ date: '', periods: periods || 3, subjects: Array.from({ length: periods || 3 }, () => [emptyCell(), emptyCell(), emptyCell()]), exceptions: [] });
  const newTeacher = () => ({ name: '', subject: '', homeroom: '', type: '일반', target: '', prev: '' });

  function defaultState() {
    return {
      version: 2, term: TERMS[0],
      options: { exclude3rd: true, studyHallClassroom: false, corridors: 2 },
      classes: [7, 7, 7], days: [newDay(3)], teachers: [], specials: [{ room: '', teacher: '', hours: '' }],
      result: null, meta: { savedAt: null, backupAt: null, dirty: false },
    };
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
        subjects: subjects.map((row) => [0, 1, 2].map((g) => {
          const c = (row || [])[g] || {};
          return { name: c.name || '', study: Array.isArray(c.study) ? c.study.map(Number) : [], exclude: Array.isArray(c.exclude) ? c.exclude.map(Number) : [] };
        })),
        exceptions: Array.isArray(day.exceptions) ? day.exceptions.map((x) => ({ period: x.period == null ? '' : String(x.period), name: x.name || '', reason: x.reason || '' })) : [],
      };
    });
    s.teachers = (s.teachers || []).map((t) => Object.assign(newTeacher(), t, { type: E.normalizeType(t.type).type }));
    s.specials = (s.specials || []).map((r) => ({ room: r.room || '', teacher: r.teacher || '', hours: r.hours == null ? '' : String(r.hours) }));
    if (s.result && typeof s.result.assign !== 'object') s.result = null;
    if (s.result) s.result.pinned = s.result.pinned || {};
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
      if (v && typeof v === 'object') return { name: v.text || '', study: (v.study_btns || v.active_btns || []).map(Number), exclude: (v.exclude_btns || []).map(Number) };
      return { name: String(v || ''), study: [], exclude: [] };
    };
    (data.subject_table || []).forEach((r, idx) => {
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
  let ui = { tab: 'setup', sub: 'grid' };
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
    if (!storageOK) { el.className = 'save-state warn'; el.textContent = '⚠ 이 브라우저에는 자동 저장이 안 됩니다. 백업 파일을 꼭 저장하세요.'; }
    else { el.className = 'save-state'; el.textContent = state.meta.savedAt ? `✔ 브라우저에 자동 저장됨 ${timeText(state.meta.savedAt)}` : ''; }
    $('#backupDot').innerHTML = state.meta.dirty ? '<span class="dot" title="마지막 백업 이후 바뀐 내용이 있습니다"></span>' : '';
  }

  // 경로("teachers.3.name")로 값 읽기/쓰기
  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }

  // ---------------------------------------------------------------
  // 탭
  // ---------------------------------------------------------------
  const renderers = {};
  function showTab(name) {
    ui.tab = name; saveUI();
    $$('.step').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    renderers[name]();
    window.scrollTo(0, 0);
  }
  function renderAll() {
    Object.keys(renderers).forEach((k) => { if (k === ui.tab) renderers[k](); });
    renderSaveState();
    updateTeacherDatalist();
    updateBadges();
  }

  function updateBadges() {
    let model;
    try { model = E.buildModel(state); } catch (e) { return; }
    const err = model.issues.filter((i) => i.level === 'error').length;
    const warn = model.issues.filter((i) => i.level === 'warn').length;
    const b = $('.step[data-tab="result"]');
    b.innerHTML = '5. 배정 결과' + (err ? ` <span class="badge bad">${err}</span>` : warn ? ` <span class="badge warn">${warn}</span>` : '');
    $('.step[data-tab="teachers"]').innerHTML = `3. 교사 명단 <span class="badge">${state.teachers.filter((t) => t.name.trim()).length}</span>`;
  }

  function updateTeacherDatalist() {
    $('#teacherNames').innerHTML = state.teachers.filter((t) => t.name.trim()).map((t) => `<option value="${esc(t.name.trim())}">`).join('');
  }

  // ---------------------------------------------------------------
  // 1. 기본 설정
  // ---------------------------------------------------------------
  renderers.setup = function () {
    const s = state;
    $('#tab-setup').innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>📌 배정 회차와 옵션</h2></div>
        <div class="row" style="margin-bottom:12px">
          <label class="field"><span>배정 회차</span>
            <select data-bind="term" data-rerender="setup">${TERMS.map((t) => `<option ${t === s.term ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label class="field"><span>학년별 복도 감독 수</span>
            <input type="number" class="num" min="0" max="6" data-bind="options.corridors" data-num value="${s.options.corridors}">
          </label>
        </div>
        ${s.term === '4차 고사' ? `<label class="inline" style="margin-bottom:8px"><input type="checkbox" data-bind="options.exclude3rd" ${s.options.exclude3rd ? 'checked' : ''}> <b style="color:var(--bad)">3학년 담임/부장 배정 제외</b> <span class="muted">(담임 칸이 3-으로 시작하는 선생님)</span></label><br>` : ''}
        <label class="inline"><input type="checkbox" data-bind="options.studyHallClassroom" ${s.options.studyHallClassroom ? 'checked' : ''}> 학년 전체가 자습인 교시에도 <b>교실 감독</b> 배정 <span class="muted">(끄면 복도 감독만)</span></label>
        <p class="hint" style="margin-top:12px">${s.term === TERMS[0]
          ? '1차 고사는 이전 누적 시수를 쓰지 않고 0부터 시작합니다.'
          : `이전 회차까지의 누적 시수(3. 교사 명단의 "이전 누적")를 더해서, 누적이 적은 선생님께 더 배정합니다.`}</p>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>🏫 학년별 반 수</h2></div>
        <div class="row">
          ${[0, 1, 2].map((i) => `<label class="field"><span>${i + 1}학년</span><input type="number" class="num" min="1" max="30" data-bind="classes.${i}" data-num value="${s.classes[i]}"></label>`).join('')}
        </div>
        <p class="hint">반 수를 바꾸면 2. 시험 과목의 자습/제외 버튼이 바로 바뀝니다. 입력한 과목은 그대로 남습니다.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>📅 시험 일차와 교시</h2><span class="spacer"></span><button class="btn" data-act="day-add">➕ 일차 추가</button></div>
      <table class="grid" style="max-width:640px">
        <thead><tr><th>일차</th><th>시험일 (예: 4/27)</th><th>교시 수</th><th>삭제</th></tr></thead>
        <tbody>${s.days.map((d, i) => `<tr>
          <td><b>${i + 1}일차</b></td>
          <td><input data-bind="days.${i}.date" value="${esc(d.date)}" placeholder="4/27"></td>
          <td><input type="number" class="num" min="1" max="10" data-bind="days.${i}.periods" data-num value="${d.periods}"></td>
          <td><button class="icon-btn" data-act="day-del" data-i="${i}" title="이 일차 삭제">✕</button></td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="hint">일차·교시를 바꾸면 2. 시험 과목과 4. 예외 입력칸이 자동으로 맞춰집니다. (예전의 "연동 생성하기" 버튼이 필요 없습니다)</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>💾 자료 보관</h2></div>
      <p class="hint" style="margin-top:0">입력한 내용은 <b>이 컴퓨터의 이 브라우저</b>에 자동으로 저장됩니다. 다른 컴퓨터에서 이어서 하거나, 브라우저 기록을 지울 때를 대비해 <b>백업 파일</b>을 저장해 두세요.
      백업 파일 하나에 설정·과목·교사·예외·배정 결과(직접 고친 내용 포함)가 모두 들어 있습니다. 예전 파이썬 프로그램의 DATA SAVE 파일(.json)도 불러올 수 있습니다.</p>
      <div class="row">
        <button class="btn primary" data-act="backup-save">💾 백업 파일 저장</button>
        <button class="btn" data-act="backup-load">📂 백업 불러오기</button>
        <span class="muted">마지막 백업: ${state.meta.backupAt ? timeText(state.meta.backupAt) : '없음'}</span>
        <span class="spacer" style="flex:1"></span>
        <button class="btn danger" data-act="reset-all">🗑 전체 초기화</button>
      </div>
    </div>`;
  };

  // ---------------------------------------------------------------
  // 2. 시험 과목
  // ---------------------------------------------------------------
  function cellSummary(d, p, g) {
    const cell = state.days[d].subjects[p - 1][g - 1];
    const cc = state.classes[g - 1];
    const pc = E.parseCell(cell, cc);
    if (!pc.active) return { cls: 'none', text: '시험 없음 → 감독 안 함' };
    const open = range(1, cc).filter((c) => !pc.exclude.includes(c));
    const fullStudy = pc.allStudy || (open.length > 0 && open.every((c) => pc.study.includes(c)));
    const rooms = fullStudy && !state.options.studyHallClassroom ? 0 : open.length;
    const parts = [];
    if (rooms) parts.push(`교실 ${rooms}`);
    if (pc.special) parts.push(`추가반 1(${pc.room})`);
    if (state.options.corridors) parts.push(`복도 ${state.options.corridors}`);
    let text = parts.join(' · ');
    if (fullStudy) text = '전체 자습 · ' + text;
    return { cls: pc.special ? 'special' : '', text };
  }

  function subjectCellHTML(d, p, g) {
    const cell = state.days[d].subjects[p - 1][g - 1];
    const cc = state.classes[g - 1];
    const chips = (kind, list) => range(1, cc).map((c) => `<button class="chip ${list.includes(c) ? 'on' : ''}" data-act="chip" data-kind="${kind}" data-d="${d}" data-p="${p}" data-g="${g}" data-c="${c}" title="${c}반 ${kind === 'study' ? '자습' : '감독 제외'}">${c}</button>`).join('');
    const sum = cellSummary(d, p, g);
    return `<input data-bind="days.${d}.subjects.${p - 1}.${g - 1}.name" data-subj="${d},${p},${g}" value="${esc(cell.name)}" placeholder="과목명">
      <div class="chips study"><b>자습</b>${chips('study', cell.study)}</div>
      <div class="chips excl"><b>제외</b>${chips('exclude', cell.exclude)}</div>
      <div class="cell-sum ${sum.cls}" data-sum="${d},${p},${g}">${esc(sum.text)}</div>`;
  }

  renderers.subjects = function () {
    $('#tab-subjects').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>📝 일차별 시험 과목</h2>
        <span class="legend"><span><i style="background:#ffe066"></i>자습반</span><span><i style="background:#ffb3ba"></i>감독 제외반</span></span>
        <span class="spacer"></span>
        <button class="btn" data-act="subj-paste">📋 엑셀에서 붙여넣기</button>
      </div>
      <p class="hint" style="margin-top:0">
        · 과목명 뒤에 <code>*</code>를 붙이면 추가반(특별실)이 생깁니다. 장소는 <code>수학*(음악실)</code>처럼 괄호로 적습니다.<br>
        · 과목 칸에 <code>자습</code>이라고 적으면 학년 전체가 자습, 칸을 비우면 그 학년은 시험이 없어 감독을 넣지 않습니다.<br>
        · 엑셀에서 과목 여러 칸을 복사해 아무 과목 칸에나 붙여넣으면(Ctrl+V) 아래·오른쪽으로 채워집니다.
      </p>
      ${state.days.map((day, d) => `
        <div class="day-card">
          <h3>${d + 1}일차 ${day.date ? '· ' + esc(day.date) : ''}</h3>
          <table class="subj-table">
            <thead><tr><th>교시</th><th>1학년 (${state.classes[0]}반)</th><th>2학년 (${state.classes[1]}반)</th><th>3학년 (${state.classes[2]}반)</th></tr></thead>
            <tbody>${range(1, day.periods).map((p) => `<tr><td>${p}교시</td>${[1, 2, 3].map((g) => `<td class="subj-cell" id="sc-${d}-${p}-${g}">${subjectCellHTML(d, p, g)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`).join('')}
    </div>`;
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
        state.days[d].subjects[p - 1][g - 1].name = String(v || '').trim();
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
    $('#tab-teachers').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>👨‍🏫 전체 교사 명단</h2>
        ${E.TYPES.map((t) => `<span class="badge">${t} ${count[t] || 0}</span>`).join(' ')}
        <span class="spacer"></span>
        <button class="btn" data-act="t-add">➕ 추가</button>
        <button class="btn orange" data-act="t-excel">📂 엑셀 파일 불러오기</button>
        <button class="btn" data-act="t-paste">📋 붙여넣기</button>
      </div>
      <p class="hint" style="margin-top:0">
        · <b>담임</b>은 <code>2-5</code>처럼, 부장은 <code>3-부장</code>처럼 적습니다. 담임은 본인 반 교실 감독에 들어가지 않습니다.<br>
        · <b>과목</b>이 시험 과목과 같으면 그 시험 시간에는 감독에서 빠집니다. 여러 과목은 <code>/</code>로 구분합니다. (예: <code>수학</code>은 <code>수학Ⅰ</code>, <code>수학Ⅱ</code> 시험과도 같은 과목으로 봅니다)<br>
        · <b>구분</b> — 일반: 시수를 고르게 / 고사담당: 1교시에만 / 원로: 교실 감독만, 목표시수까지 / 순회: 복도·자습 감독만 / 제외: 배정 안 함<br>
        · <b>목표시수</b> — 원로: 이 시수까지 채움(상한). 그 밖의 구분: 적어 두면 이 시수를 넘기지 않도록 함(비우면 제한 없음).<br>
        · <b>이전 누적</b> — 지난 회차까지의 전체 시수. ${prevOff ? '<b>1차 고사에서는 쓰지 않습니다.</b>' : '이전 회차 결과 엑셀에서 한 번에 불러올 수 있습니다.'}
      </p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" data-act="t-prev-import">📥 이전 회차 결과 엑셀에서 누적 불러오기</button>
        <button class="btn" data-act="t-prev-clear">누적 비우기</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn danger" data-act="t-clear">명단 전체 삭제</button>
      </div>
      <div class="scroll" style="max-height:none">
      <table class="grid">
        <thead><tr><th style="width:44px">연번</th><th style="width:110px">이름</th><th>과목</th><th style="width:90px">담임</th><th style="width:110px">구분</th><th style="width:80px">목표시수</th><th style="width:80px">이전 누적</th><th style="width:44px">삭제</th></tr></thead>
        <tbody>${ts.map((t, i) => `<tr>
          <td>${i + 1}</td>
          <td><input data-bind="teachers.${i}.name" data-tcell="${i},0" value="${esc(t.name)}" class="${dup.has(t.name.trim()) ? 'bad' : ''}" title="${dup.has(t.name.trim()) ? '이름이 중복됩니다' : ''}"></td>
          <td><input data-bind="teachers.${i}.subject" data-tcell="${i},1" value="${esc(t.subject)}"></td>
          <td><input data-bind="teachers.${i}.homeroom" data-tcell="${i},2" value="${esc(t.homeroom)}" placeholder="-"></td>
          <td><select data-bind="teachers.${i}.type" data-tcell="${i},3">${E.TYPES.map((x) => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><input data-bind="teachers.${i}.target" data-tcell="${i},4" value="${esc(t.target)}" inputmode="numeric"></td>
          <td><input data-bind="teachers.${i}.prev" data-tcell="${i},5" value="${esc(t.prev)}" inputmode="numeric" ${prevOff ? 'style="opacity:.5"' : ''}></td>
          <td><button class="icon-btn" data-act="t-del" data-i="${i}">✕</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted" style="padding:20px">교사 명단이 비어 있습니다. [엑셀 파일 불러오기] 또는 [붙여넣기]로 한 번에 넣을 수 있습니다.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  };

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
  // 4. 특수실·예외
  // ---------------------------------------------------------------
  renderers.extras = function () {
    const names = new Set(state.teachers.map((t) => t.name.trim()).filter(Boolean));
    const bad = (n) => n.trim() && !names.has(n.trim());
    $('#tab-extras').innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>🏠 특수실</h2><span class="spacer"></span><button class="btn" data-act="sp-add">➕ 추가</button></div>
        <p class="hint" style="margin-top:0">지정자는 시험 기간 동안 일반 감독에서 빠지고, 결과에 "특수(명칭)"으로 표시됩니다. 시수는 그 선생님의 이번 회차 시수에 더해집니다.</p>
        <table class="grid">
          <thead><tr><th>명칭</th><th>지정자</th><th style="width:80px">시수</th><th style="width:44px">삭제</th></tr></thead>
          <tbody>${state.specials.map((r, i) => `<tr>
            <td><input data-bind="specials.${i}.room" value="${esc(r.room)}" placeholder="특수학급"></td>
            <td><input data-bind="specials.${i}.teacher" data-namecheck value="${esc(r.teacher)}" list="teacherNames" class="${bad(r.teacher) ? 'bad' : ''}"></td>
            <td><input data-bind="specials.${i}.hours" value="${esc(r.hours)}" inputmode="numeric"></td>
            <td><button class="icon-btn" data-act="sp-del" data-i="${i}">✕</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>⚠️ 일차·교시별 예외 감독자</h2></div>
        <p class="hint" style="margin-top:0">출장·연가·수업 등으로 그 교시에 감독할 수 없는 선생님을 적습니다. 이름은 명단에서 고르세요(명단에 없는 이름은 빨갛게 표시되고 적용되지 않습니다). 교시를 <b>전체</b>로 하면 그날 하루 종일 빠집니다.</p>
        ${state.days.map((day, d) => `
          <div class="day-card">
            <h3 style="display:flex;align-items:center">${d + 1}일차 ${day.date ? '· ' + esc(day.date) : ''}<span style="flex:1"></span><button class="btn sm" data-act="ex-add" data-d="${d}">➕ 추가</button></h3>
            <table class="grid" style="border:none">
              ${day.exceptions.length ? `<thead><tr><th style="width:120px">교시</th><th>이름</th><th>사유</th><th style="width:44px">삭제</th></tr></thead>` : ''}
              <tbody>${day.exceptions.map((x, i) => {
                const pv = E.parsePeriodValue(x.period);
                const opts = ['<option value="">선택</option>'].concat(range(1, day.periods).map((p) => `<option value="${p}" ${pv === p ? 'selected' : ''}>${p}교시</option>`), [`<option value="전체" ${pv === 'all' ? 'selected' : ''}>종일</option>`]);
                return `<tr>
                <td><select data-bind="days.${d}.exceptions.${i}.period">${opts.join('')}</select></td>
                <td><input data-bind="days.${d}.exceptions.${i}.name" data-namecheck value="${esc(x.name)}" list="teacherNames" class="${bad(x.name) ? 'bad' : ''}"></td>
                <td><input data-bind="days.${d}.exceptions.${i}.reason" value="${esc(x.reason)}" placeholder="출장 등"></td>
                <td><button class="icon-btn" data-act="ex-del" data-d="${d}" data-i="${i}">✕</button></td></tr>`;
              }).join('') || '<tr><td class="muted" style="border:none;padding:10px">예외 없음</td></tr>'}</tbody>
            </table>
          </div>`).join('')}
      </div>
    </div>`;
  };

  // ---------------------------------------------------------------
  // 5. 배정 결과
  // ---------------------------------------------------------------
  let running = false;
  let progress = 0;

  function currentModel() { return E.buildModel(state); }

  renderers.result = function () {
    const model = currentModel();
    const r = state.result;
    const errs = model.issues.filter((i) => i.level === 'error');
    const ev = r ? E.evaluate(model, r.assign) : null;
    const stale = r && r.sig !== E.inputSignature(state);
    const pinCount = r ? Object.keys(r.pinned || {}).length : 0;

    const issuesHTML = model.issues.length
      ? `<ul class="issues">${model.issues.map((i) => `<li class="${i.level}">${esc(i.msg)}</li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">✔ 확인할 문제가 없습니다.</p>';

    let body = '';
    if (running) {
      body = `<div class="panel"><b>⏳ 배정 계산 중…</b> 수십만 가지 조합을 비교하고 있습니다.<div class="progress"><div id="prog" style="width:${Math.round(progress * 100)}%"></div></div></div>`;
    } else if (r && ev) {
      const s = ev.summary;
      body = `
      ${stale ? `<div class="panel" style="border-color:var(--warn);background:var(--warn-soft)">⚠ 배정한 뒤에 입력(과목·교사·예외 등)이 바뀌었습니다. 아래 결과는 바뀐 입력으로 다시 검사한 것입니다. <b>[다시 돌리기]</b>를 누르면 직접 고친 칸은 유지하고 나머지를 새로 배정합니다.</div>` : ''}
      <div class="summary">
        <div class="stat ${s.shortage ? 'bad' : 'ok'}"><b>${s.shortage}</b><span>감독 부족 자리</span></div>
        <div class="stat ${s.violations ? 'bad' : 'ok'}"><b>${s.violations}</b><span>규칙 위반 칸 ⚠</span></div>
        <div class="stat"><b>${s.min} ~ ${s.max}</b><span>일반 교사 전체 누적 시수</span></div>
        <div class="stat"><b>${s.avg.toFixed(1)}</b><span>일반 교사 평균</span></div>
        <div class="stat"><b>${pinCount}</b><span>직접 고친 칸 📌</span></div>
      </div>
      <p class="hint">칸을 누르면 다른 선생님으로 바꾸거나 맞바꿀 수 있습니다. 직접 고친 칸은 📌로 고정되어, [다시 돌리기]를 해도 그대로 남습니다. 노란색=자습, 보라색=복도, 파란색=본인 시험, ⚠=규칙 위반(마우스를 올리면 이유).</p>
      <div class="subtabs no-print">
        ${[['grid', '감독표'], ['person', '개인별 시간표'], ['stats', '시수표']].map(([k, l]) => `<button class="subtab ${ui.sub === k ? 'active' : ''}" data-act="sub" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="scroll">${ui.sub === 'person' ? personTable(model, ev) : ui.sub === 'stats' ? statsTable(model, ev) : gridTable(model, ev)}</div>`;
    }

    $('#tab-result').innerHTML = `
    <div class="panel no-print">
      <div class="panel-head">
        <h2>🚀 배정 (${esc(state.term)})</h2><span class="spacer"></span>
        <button class="btn go" data-act="run" ${running || errs.length ? 'disabled' : ''}>${r ? '🆕 처음부터 새로 배정' : '🚀 배정 시작'}</button>
        ${r ? `<button class="btn orange" data-act="rerun" ${running || errs.length ? 'disabled' : ''} title="📌 고친 칸은 그대로 두고 나머지를 다시 배정">🔄 다시 돌리기 (📌 유지)</button>
        <button class="btn primary" data-act="export" ${running ? 'disabled' : ''}>💾 엑셀로 저장</button>` : ''}
      </div>
      <details ${r ? '' : 'open'}><summary style="cursor:pointer;font-weight:600">배정 전 점검 (${model.issues.length}건)</summary><div style="margin-top:8px">${issuesHTML}</div></details>
      ${r ? `<div class="row" style="margin-top:12px">
        ${pinCount ? `<button class="btn sm" data-act="unpin-all">📌 고정 모두 풀기</button>` : ''}
        <button class="btn sm" data-act="apply-cum" title="이번 결과 시수를 이전 누적에 더하고 다음 회차로 넘어갑니다">➡ 이번 시수를 누적에 반영하고 다음 회차 준비</button>
        <button class="btn sm danger" data-act="clear-result">결과 지우기</button>
        <span class="muted">배정: ${timeText(r.createdAt)}</span>
      </div>` : ''}
    </div>
    ${body}`;
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
    let h = `<table class="res"><thead><tr><th>일차</th><th>교시</th><th>학년</th><th>과목</th>${range(1, C).map((c) => `<th>${c}반</th>`).join('')}${hasSp ? '<th>추가반</th>' : ''}${range(1, K).map((k) => `<th>복도${k}</th>`).join('')}<th>예비(누적 적은 순)</th></tr></thead><tbody>`;
    let last = -1;
    model.periods.forEach((per) => {
      if (last !== -1 && last !== per.d) h += `<tr class="day-sep"><td colspan="${6 + C + K + (hasSp ? 1 : 0)}"></td></tr>`;
      last = per.d;
      per.grades.forEach((gi, idx) => {
        h += '<tr>';
        if (idx === 0) h += `<td rowspan="3"><b>${per.dayLabel}</b><br><small>${esc(per.date)}</small></td><td rowspan="3">${per.p}교시</td>`;
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
    let h = '<table class="res"><thead>';
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
    let h = '<table class="res"><thead><tr><th>연번</th><th>이름</th><th>구분</th><th>과목</th><th>교실</th><th>복도</th><th>자습</th><th>특수실</th><th>이번 합계</th><th>이전 누적</th><th>전체 누적</th><th>목표시수</th></tr></thead><tbody>';
    ev.stats.forEach((st, i) => {
      const tot = st.prev + st.total;
      const hl = st.group === 'balance' && mx !== mn ? (tot === mx ? 'hi' : tot === mn ? 'lo' : '') : '';
      h += `<tr class="${st.type === '제외' ? 'off' : ''}"><td>${i + 1}</td><td><b>${esc(st.name)}</b></td><td>${esc(st.type)}${st.note ? `<br><small class="muted">${esc(st.note)}</small>` : ''}</td><td class="subjcol">${esc(st.subject)}</td>
        <td class="num">${st.cls}</td><td class="num">${st.corridor}</td><td class="num">${st.study}</td><td class="num">${st.special || ''}</td><td class="num"><b>${st.total}</b></td><td class="num">${st.prev}</td><td class="num ${hl}"><b>${tot}</b></td><td class="num">${st.target == null ? '' : st.target}</td></tr>`;
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
    const ev = E.evaluate(model, res.assign);
    toast(`배정 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초) · 부족 ${ev.summary.shortage} · 위반 ${ev.summary.violations}`);
  }

  // ---- 칸 편집: 교사 후보 목록
  function teacherLoad(model, ev) {
    const m = new Map();
    ev.stats.forEach((st) => m.set(st.name, st));
    return m;
  }

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
    const load = teacherLoad(model, ev);
    const cur = state.result.assign[slot.id] || '';
    const sameP = new Map(); // 같은 교시에 이미 배정된 교사 → slotId
    model.slots.forEach((s) => { if (s.pi === slot.pi && state.result.assign[s.id]) sameP.set(state.result.assign[s.id], s.id); });
    const free = [], swap = [], no = [];
    model.teachers.forEach((t) => {
      if (t.name === cur) return;
      const st = load.get(t.name);
      const reasons = E.slotReasons(model, t, slot);
      const other = sameP.get(t.name);
      if (!other && wouldBe3Consecutive(model, t.name, slot)) reasons.push('3교시 연속');
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
      <input type="search" id="candSearch" placeholder="이름 검색" style="width:100%;margin-bottom:10px">
      <div class="cand-group"><h4>✅ 바로 넣을 수 있는 선생님 (누적 적은 순)</h4><div class="cand-list">${free.map((x) => btn(x, 'free')).join('') || '<span class="muted">없음</span>'}</div></div>
      <div class="cand-group"><h4>🔁 같은 교시 다른 자리와 맞바꾸기</h4><div class="cand-list">${swap.map((x) => btn(x, 'swap')).join('') || '<span class="muted">없음</span>'}</div></div>
      <details class="cand-group"><summary style="cursor:pointer;font-weight:600;color:var(--ink-2)">⛔ 규칙상 어려운 선생님 (${no.length}명) — 그래도 넣을 수는 있습니다</summary><div class="cand-list" style="margin-top:6px">${no.map((x) => btn(x, 'no')).join('')}</div></details>`;
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
    const html = `<p style="margin-top:0">${per.dayLabel} ${esc(per.date)} ${per.p}교시 · <b>${place}</b> · ${esc(gi.label)}${slot.study ? ' <span class="badge warn">자습</span>' : ''}<br>
      현재: <b>${cur ? esc(cur) : '<span style="color:var(--bad)">비어 있음</span>'}</b> ${state.result.pinned[slotId] ? '📌' : ''} ${v ? `<span class="badge bad">⚠ ${esc(v.join(', '))}</span>` : ''}</p>
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
      // 같은 교시 다른 자리에 이미 있으면(규칙상 어려움 목록에서 고른 경우) 그 자리는 비움
      model.slots.forEach((s) => { if (s.pi === slot.pi && s.id !== slotId && a[s.id] === result.name) { a[s.id] = ''; pin[s.id] = true; } });
      a[slotId] = result.name; pin[slotId] = true;
    } else if (result.act === 'swap') {
      a[result.other] = cur; pin[result.other] = true;
      a[slotId] = result.name; pin[slotId] = true;
    }
    save();
    renderers.result();
  }

  // 개인별 시간표 칸 클릭
  async function openPersonCell(name, pi) {
    const model = currentModel();
    const ids = model.slots.filter((s) => s.pi === pi && state.result.assign[s.id] === name).map((s) => s.id);
    if (ids.length) return openSlotEditor(ids[0]);
    const t = model.teacherByName.get(name);
    if (!t) return;
    const per = model.periods[pi];
    const slots = model.slots.filter((s) => s.pi === pi);
    const html = `<p style="margin-top:0"><b>${esc(name)}</b> 선생님을 ${per.dayLabel} ${per.p}교시에 넣을 자리를 고르세요. 원래 그 자리에 있던 선생님은 빠집니다.</p>
      <div class="cand-list">${slots.map((s) => {
        const r = E.slotReasons(model, t, s);
        if (wouldBe3Consecutive(model, name, s)) r.push('3교시 연속');
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
  // 설명서
  // ---------------------------------------------------------------
  function showHelp() {
    dialog({
      title: '📖 사용 설명서', wide: true,
      html: `<div class="help">
      <h2>0. 자료 보관</h2>
      <ul>
        <li>입력한 내용은 <b>이 브라우저에 자동 저장</b>됩니다. 같은 컴퓨터·같은 브라우저로 다시 열면 그대로 있습니다.</li>
        <li>다른 컴퓨터로 옮기거나 안전하게 보관하려면 <b>💾 백업 파일 저장</b>으로 파일(.json) 하나를 받아 두세요. <b>📂 백업 불러오기</b>로 그대로 복원됩니다. 예전 파이썬 프로그램의 DATA SAVE 파일도 불러올 수 있습니다.</li>
        <li>백업 버튼 옆 노란 점(●)은 마지막 백업 이후 바뀐 내용이 있다는 뜻입니다.</li>
      </ul>
      <h2>1. 기본 설정</h2>
      <ul>
        <li><b>배정 회차</b>: 2~4차는 교사 명단의 "이전 누적" 시수를 더해서 누적이 적은 선생님께 더 배정합니다.</li>
        <li><b>3학년 담임/부장 제외</b>: 4차 고사에서만 보입니다. 담임 칸이 <code>3-</code>로 시작하면 배정에서 뺍니다.</li>
        <li><b>전체 자습 시 교실 감독</b>: 끄면 학년 전체가 자습인 교시는 복도 감독만 둡니다.</li>
        <li>반 수·일차·교시를 바꾸면 과목·예외 입력칸이 자동으로 맞춰집니다.</li>
      </ul>
      <h2>2. 시험 과목</h2>
      <ul>
        <li>🟡 <b>자습</b> 버튼: 그 반은 자습 감독(자습 시수)으로 셉니다. 🔴 <b>제외</b> 버튼: 그 반에는 감독을 넣지 않습니다.</li>
        <li><code>수학*</code> → 추가반(특별실) 개설, <code>수학*(음악실)</code> → 장소 이름 지정.</li>
        <li><code>자습</code> → 학년 전체 자습. 빈칸 → 그 학년은 시험 없음(감독 없음).</li>
        <li>엑셀에서 과목 표를 복사해 과목 칸에 붙여넣거나, [엑셀에서 붙여넣기]를 이용하세요.</li>
      </ul>
      <h2>3. 교사 명단</h2>
      <ul>
        <li>엑셀 파일 불러오기는 첫 줄 머리글(이름, 과목, 담임, 교사구분, 목표시수)을 읽어 열 순서와 상관없이 가져옵니다. 머리글이 없으면 <code>연번, 이름, 과목, 담임, 교사구분, 목표시수</code> 순서로 읽습니다.</li>
        <li>교사의 과목이 시험 과목과 같으면 그 시간에는 감독하지 않습니다. 과목명이 다르게 적혀 있으면 [5. 배정 결과]의 점검 목록에 표시됩니다.</li>
        <li><b>고사담당</b>: 1교시에만 / <b>원로</b>: 교실 감독만, 목표시수까지, 하루 상한 = 목표시수÷일수 / <b>순회</b>: 복도·자습만 / <b>제외</b>: 배정 안 함.</li>
      </ul>
      <h2>4. 특수실·예외</h2>
      <ul>
        <li>특수실 지정자는 일반 감독에서 빠지고 적은 시수가 그 선생님 시수에 더해집니다.</li>
        <li>예외 감독자는 명단에서 이름을 고르고 교시(또는 전체)를 정합니다.</li>
      </ul>
      <h2>5. 배정 결과</h2>
      <ul>
        <li><b>🚀 배정 시작</b>: 지켜야 하는 규칙(본인 시험, 담임반, 예외, 3교시 연속 금지 등)은 반드시 지키면서, 수십만 가지 바꿔 보기로 <b>시수 차이가 가장 작은</b> 배정을 찾습니다.</li>
        <li>칸을 누르면 <b>바로 넣을 수 있는 선생님</b>(누적 적은 순), <b>같은 교시 맞바꾸기</b>, 규칙상 어려운 선생님이 나옵니다. 고친 칸은 📌로 고정됩니다.</li>
        <li><b>🔄 다시 돌리기 (📌 유지)</b>: 직접 고친 칸은 그대로 두고 나머지만 다시 고르게 맞춥니다.</li>
        <li><b>💾 엑셀로 저장</b>: 결과_감독표 / 결과_시수표 / 결과_개인별시간표 세 시트로 저장합니다. 다음 회차에서 이 파일로 누적을 불러올 수 있습니다.</li>
        <li><b>➡ 누적 반영</b>: 엑셀을 거치지 않고, 이번 시수를 바로 이전 누적에 더하고 다음 회차로 넘어갑니다.</li>
      </ul>
      </div>`,
    });
  }

  // ---------------------------------------------------------------
  // 이벤트
  // ---------------------------------------------------------------
  let rerenderTimer = null;
  function deferRender(fn, ms) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(fn, ms || 300); }

  document.addEventListener('input', (e) => {
    const el = e.target;
    const bind = el.dataset && el.dataset.bind;
    if (!bind) return;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num')) {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n)) return; // 입력 중 빈칸은 무시
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

    // 화면 일부만 갱신 (입력 중인 칸은 다시 그리지 않음 → 깜빡임/한글 입력 끊김 방지)
    if (el.dataset.subj) {
      const [d, p, g] = el.dataset.subj.split(',').map(Number);
      const sum = cellSummary(d, p, g);
      const box = $(`[data-sum="${d},${p},${g}"]`);
      if (box) { box.className = 'cell-sum ' + sum.cls; box.textContent = sum.text; }
    }
    if (bind.startsWith('teachers.')) deferRender(() => { updateTeacherDatalist(); updateBadges(); refreshTeacherDup(); }, 400);
    if (el.hasAttribute('data-namecheck')) {
      const names = new Set(state.teachers.map((t) => t.name.trim()));
      el.classList.toggle('bad', !!el.value.trim() && !names.has(el.value.trim()));
    }
    if (el.dataset.rerender) renderers[el.dataset.rerender]();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') updateBadges();
  });

  // 숫자칸에서 포커스가 빠지면 허용 범위로 고친 값을 다시 보여줌 (표를 다시 그리지 않아 커서가 튀지 않음)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.hasAttribute || !el.hasAttribute('data-num')) return;
    const ks = el.dataset.bind.split('.');
    let v = state;
    ks.forEach((k) => { v = v[k]; });
    el.value = v;
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

  // 엑셀에서 복사한 여러 칸 붙여넣기
  document.addEventListener('paste', (e) => {
    const el = e.target;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    if (el.dataset && el.dataset.subj) {
      e.preventDefault();
      const [d, p, g] = el.dataset.subj.split(',').map(Number);
      const n = applySubjectGrid(parseClipboardGrid(text), d, p, g);
      save(); renderers.subjects(); toast(`${n}칸을 붙여넣었습니다.`);
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
      case 'help': return showHelp();
      case 'backup-save': return backupSave();
      case 'backup-load': return backupLoad();
      case 'goto-run': return showTab('result');
      case 'reset-all': {
        if (!(await confirmBox('전체 초기화', '입력한 모든 자료와 배정 결과를 지웁니다. 먼저 백업 파일을 저장해 두는 것을 권합니다. 계속할까요?', '모두 지우기', 'orange'))) return;
        state = defaultState(); save(false); renderAll(); return;
      }
      case 'day-add': state.days.push(newDay(state.days.length ? state.days[state.days.length - 1].periods : 3)); save(); return renderers.setup();
      case 'day-del': {
        const day = state.days[i];
        const filled = day.subjects.some((r) => r.some((c) => c.name || c.study.length || c.exclude.length)) || day.exceptions.length;
        if (filled && !(await confirmBox('일차 삭제', `${i + 1}일차의 과목·예외 입력도 함께 지워집니다. 삭제할까요?`, '삭제', 'orange'))) return;
        state.days.splice(i, 1); if (!state.days.length) state.days.push(newDay(3)); save(); return renderers.setup();
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
        return;
      }
      case 'subj-paste': {
        const txt = await dialog({
          title: '📋 과목 붙여넣기', wide: true,
          html: `<p class="hint" style="margin-top:0">엑셀에서 <b>1학년·2학년·3학년</b> 세 열(또는 일차·시험일·교시를 포함한 여섯 열)을 복사해서 아래에 붙여넣으세요. 1일차 1교시부터 차례로 채웁니다. 지금 들어 있는 과목명은 덮어쓰고, 자습/제외 버튼은 그대로 둡니다.</p><textarea id="pasteBox" placeholder="국어	통합과학	한국사&#10;수학	화학	지구과학"></textarea>`,
          buttons: [{ label: '취소', value: null }, { label: '채우기', value: (b) => $('#pasteBox', b).value, cls: 'primary' }],
          onOpen: (b) => $('#pasteBox', b).focus(),
        });
        if (!txt) return;
        let rows = parseClipboardGrid(txt);
        rows = rows.map((r) => (r.length >= 6 ? r.slice(3, 6) : r));
        const n = applySubjectGrid(rows, 0, 1, 1);
        save(); renderers.subjects(); toast(`${n}칸을 채웠습니다.`);
        return;
      }
      case 't-add': state.teachers.push(newTeacher()); save(); renderers.teachers(); { const inp = $$('[data-tcell$=",0"]').pop(); if (inp) inp.focus(); } return;
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
            title: '📋 교사 명단 붙여넣기', wide: true,
            html: `<p class="hint" style="margin-top:0">엑셀 표를 머리글(이름, 과목, 담임, 교사구분, 목표시수)째로 복사해 붙여넣으면 열 순서와 상관없이 읽습니다. 머리글 없이 붙여넣으면 <code>[연번,] 이름, 과목, 담임, 교사구분, 목표시수, 이전누적</code> 순서로 읽습니다.</p><textarea id="pasteBox"></textarea>`,
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
          const cum = X.sheetsToCumulative(await X.readWorkbook(f));
          let hit = 0;
          const miss = [];
          state.teachers.forEach((t) => { const n = t.name.trim(); if (!n) return; if (n in cum) { t.prev = String(cum[n]); hit++; } else miss.push(n); });
          if (state.term === TERMS[0]) state.term = TERMS[1];
          save(); renderers.teachers(); updateBadges();
          await dialog({ title: '누적 시수 불러오기', html: `<p>${hit}명의 누적 시수를 넣었습니다.${miss.length ? `<br>파일에 없는 선생님 ${miss.length}명(0으로 시작): ${esc(miss.join(', '))}` : ''}</p><p class="muted">배정 회차: ${esc(state.term)}</p>` });
        } catch (err) { await dialog({ title: '불러오기 실패', html: `<p>${esc(err.message)}</p>` }); }
        return;
      }
      case 't-prev-clear':
        if (!(await confirmBox('누적 비우기', '모든 선생님의 이전 누적 시수를 지울까요?', '지우기', 'orange'))) return;
        state.teachers.forEach((t) => { t.prev = ''; }); save(); renderers.teachers(); return;
      case 'sp-add': state.specials.push({ room: '', teacher: '', hours: '' }); save(); return renderers.extras();
      case 'sp-del': state.specials.splice(i, 1); save(); return renderers.extras();
      case 'ex-add': { const d = +el.dataset.d; state.days[d].exceptions.push({ period: '', name: '', reason: '' }); save(); renderers.extras(); const rows = $$(`[data-bind^="days.${d}.exceptions."][data-bind$=".name"]`); if (rows.length) rows[rows.length - 1].focus(); return; }
      case 'ex-del': state.days[+el.dataset.d].exceptions.splice(i, 1); save(); return renderers.extras();
      case 'run': return runAssign(false);
      case 'rerun': return runAssign(true);
      case 'export': return exportExcel();
      case 'sub': ui.sub = el.dataset.k; saveUI(); return renderers.result();
      case 'slot': if (!running) openSlotEditor(el.dataset.id); return;
      case 'pcell': if (!running) openPersonCell(el.dataset.name, +el.dataset.pi); return;
      case 'unpin-all': state.result.pinned = {}; save(); return renderers.result();
      case 'clear-result':
        if (!(await confirmBox('결과 지우기', '배정 결과와 직접 고친 내용을 지울까요?', '지우기', 'orange'))) return;
        state.result = null; save(); return renderers.result();
      case 'apply-cum': return applyCumulative();
      default:
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY && e.newValue) { state = normalizeState(JSON.parse(e.newValue)); renderAll(); toast('다른 창에서 바뀐 내용을 불러왔습니다.'); }
  });

  // 시작
  if (!['setup', 'subjects', 'teachers', 'extras', 'result'].includes(ui.tab)) ui.tab = 'setup';
  renderAll();
  showTab(ui.tab);
  window.__app = { get state() { return state; } };
})();
