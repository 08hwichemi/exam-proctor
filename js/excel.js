/* =====================================================================
 * 엑셀 입출력 (ExcelJS)
 *  - 교사 명단 / 이전 회차 시수표 읽기
 *  - 배정 결과 3개 시트(감독표, 시수표, 개인별시간표) 서식 그대로 저장
 * ===================================================================== */
(function (root) {
  'use strict';
  const E = root.Engine;

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return `${v.getMonth() + 1}/${v.getDate()}`;
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
      if ('result' in v) return cellText(v.result);
      if ('text' in v) return String(v.text).trim();
      if ('error' in v) return '';
      return '';
    }
    return String(v).trim();
  }

  // 파일 → [{name, rows:[[문자열]]}]
  async function readWorkbook(file) {
    if (/\.xls$/i.test(file.name)) throw new Error('예전 형식(.xls) 파일은 읽을 수 없습니다. 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 저장한 뒤 불러오거나, 표를 복사해서 [붙여넣기]를 이용해 주세요.');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    return wb.worksheets.map((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (row, rn) => {
        const arr = [];
        for (let c = 1; c <= ws.columnCount; c++) arr.push(cellText(row.getCell(c).value));
        rows[rn - 1] = arr;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      return { name: ws.name, rows };
    });
  }

  // 표(2차원 배열) → 교사 목록. 머리글이 있으면 머리글 기준, 없으면 [연번,]이름,과목,담임,구분,목표시수,누적 순서
  function rowsToTeachers(rows) {
    rows = rows.filter((r) => r && r.some((c) => String(c || '').trim()));
    if (!rows.length) return [];
    const key = (s) => E.norm(s);
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 6); i++) if (rows[i].some((c) => /이름|성명/.test(key(c)))) { h = i; break; }
    let map;
    if (h >= 0) {
      const hdr = rows[h].map(key);
      const find = (re) => hdr.findIndex((c) => re.test(c));
      map = {
        name: find(/이름|성명/), subject: find(/과목|교과/), homeroom: find(/담임|학급/), type: find(/구분|유형/),
        target: find(/목표/), prev: find(/전체총시수|누적|합계/),
      };
      rows = rows.slice(h + 1);
    } else {
      const first = rows[0];
      const off = first.length >= 6 && /^\d+$/.test(String(first[0]).trim()) ? 1 : 0;
      map = { name: off, subject: off + 1, homeroom: off + 2, type: off + 3, target: off + 4, prev: off + 5 };
    }
    const get = (r, i) => (i >= 0 && i < r.length ? String(r[i] == null ? '' : r[i]).trim() : '');
    return rows.map((r) => ({
      name: get(r, map.name), subject: get(r, map.subject), homeroom: get(r, map.homeroom),
      type: E.normalizeType(get(r, map.type)).type, target: get(r, map.target), prev: get(r, map.prev),
    })).filter((t) => t.name && !/^(이름|성명|예비)$/.test(t.name));
  }

  // 이전 회차 결과 엑셀 → { 이름: 전체총시수 }
  function sheetsToCumulative(sheets) {
    const pick = sheets.find((s) => s.name === '결과_시수표') ||
      sheets.find((s) => (s.rows[0] || []).some((c) => /전체총시수|합계/.test(c)) && (s.rows[0] || []).some((c) => /이름/.test(c)));
    if (!pick) throw new Error('"결과_시수표" 시트를 찾지 못했습니다. 이전 회차 배정결과 엑셀 파일을 선택해 주세요.');
    const hdr = (pick.rows[0] || []).map((c) => E.norm(c));
    const ni = hdr.findIndex((c) => c.includes('이름'));
    let vi = hdr.findIndex((c) => c.includes('전체총시수'));
    if (vi < 0) vi = hdr.findIndex((c) => c.includes('합계'));
    if (ni < 0 || vi < 0) throw new Error('시수표에서 "이름"과 "전체총시수" 열을 찾지 못했습니다.');
    const out = {};
    pick.rows.slice(1).forEach((r) => {
      const name = String(r[ni] || '').trim();
      const v = Number(String(r[vi] || '').replace(/[^0-9.\-]/g, ''));
      if (name && Number.isFinite(v)) out[name] = Math.round(v);
    });
    return out;
  }

  // ---------------------------------------------------------------
  // 결과 저장
  // ---------------------------------------------------------------
  const FILL = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } });
  const F = {
    green: FILL('D9EAD3'), yellow: FILL('FFF2CC'), pink: FILL('FCE4EC'), header: FILL('E2EFDA'),
    purple: FILL('E8DAEF'), blue: FILL('D6EAF8'), gray: FILL('F2F2F2'), red: FILL('FFE3E3'),
  };
  const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const CENTER = { horizontal: 'center', vertical: 'middle', wrapText: true };

  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  async function exportResult(state, model, ev, assign, filename) {
    const wb = new ExcelJS.Workbook();
    wb.creator = '스마트 시험 감독 배정';
    wb.calcProperties.fullCalcOnLoad = true; // 엑셀에서 열 때 수식 다시 계산
    const ws1 = wb.addWorksheet('결과_감독표', { views: [{ state: 'frozen', ySplit: 1 }] });
    const ws2 = wb.addWorksheet('결과_시수표', { views: [{ state: 'frozen', ySplit: 1 }] });
    const ws3 = wb.addWorksheet('결과_개인별시간표', { views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }] });
    [ws1, ws2, ws3].forEach((ws) => { ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }; });

    const C = model.maxClasses, K = model.corridors;
    const hasSpecial = model.slots.some((s) => s.kind === 'special');

    // ---------- [1] 결과_감독표
    const head1 = ['일차', '교시', '학년', '과목'];
    for (let c = 1; c <= C; c++) head1.push(`${c}반`);
    if (hasSpecial) head1.push('특별실');
    for (let k = 1; k <= K; k++) head1.push(`복도${k}`);
    head1.push('비고');
    ws1.addRow(head1);
    ws1.getRow(1).height = 28;
    ws1.getRow(1).eachCell((cell) => { cell.fill = F.green; cell.font = { bold: true }; cell.border = BORDER; cell.alignment = CENTER; });

    let lastDay = -1;
    model.periods.forEach((per) => {
      if (lastDay !== -1 && lastDay !== per.d) { const r = ws1.addRow([]); r.height = 8; }
      lastDay = per.d;
      const startRow = ws1.rowCount + 1;
      per.grades.forEach((gi, idx) => {
        const vals = [idx === 0 ? `${per.dayLabel}${per.date ? '\n' + per.date : ''}` : '', idx === 0 ? `${per.p}교시` : '', `${gi.grade}학년`, gi.label];
        const kinds = [];
        for (let c = 1; c <= C; c++) {
          const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-c${c}`);
          if (s) { vals.push(assign[s.id] || '부족'); kinds.push(s); }
          else { vals.push(gi.parsed.active && gi.parsed.exclude.includes(c) ? '(제외)' : ''); kinds.push(null); }
        }
        if (hasSpecial) {
          const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-sp`);
          vals.push(s ? `${assign[s.id] || '부족'}(${s.room})` : ''); kinds.push(s || null);
        }
        for (let k = 1; k <= K; k++) {
          const s = model.slotById.get(`${per.d}-${per.p}-${gi.grade}-r${k}`);
          vals.push(s ? assign[s.id] || '부족' : ''); kinds.push(s || null);
        }
        let note = '';
        if (idx === 0) {
          const sp = model.specials.filter((r) => r.room && r.teacher).map((r) => `${r.room}(${r.teacher})`);
          const ex = model.exceptions.filter((x) => x.d === per.d && (x.period === 'all' || x.period === per.p)).map((x) => `${x.name}${x.reason ? '(' + x.reason + ')' : ''}`);
          note = [sp.length ? sp.join(', ') : '', ex.length ? '예외: ' + ex.join(', ') : ''].filter(Boolean).join(' / ');
        }
        vals.push(note);
        const row = ws1.addRow(vals);
        row.height = 30;
        row.eachCell({ includeEmpty: true }, (cell, cn) => {
          cell.border = BORDER; cell.alignment = CENTER;
          const s = cn >= 5 ? kinds[cn - 5] : null;
          if (s && s.study) cell.fill = F.yellow;
          if (s && !assign[s.id]) { cell.font = { bold: true, color: { argb: 'FFC92A2A' } }; cell.fill = F.red; }
          if (cn === 4 && (gi.parsed.allStudy || gi.parsed.study.length)) cell.fill = F.yellow;
          if (String(cell.value) === '(제외)') cell.font = { color: { argb: 'FF999999' }, size: 9 };
        });
      });
      ws1.mergeCells(startRow, 1, startRow + 2, 1);
      ws1.mergeCells(startRow, 2, startRow + 2, 2);
    });
    ws1.getColumn(1).width = 9; ws1.getColumn(2).width = 7; ws1.getColumn(3).width = 7; ws1.getColumn(4).width = 24;
    for (let c = 5; c < head1.length; c++) ws1.getColumn(c).width = 10;
    ws1.getColumn(head1.length).width = 50;

    // ---------- [3] 결과_개인별시간표 (시수표가 이 시트를 참조하므로 먼저 만든다)
    const P = model.periods.length;
    const firstP = 4, statCol = firstP + P; // 통계 시작 열
    const statNames = ['교실', '복도', '자습', '특수실', '현재총시수', '전체총시수'];
    const r1 = ['연번', '이름', '과목'], r2 = ['', '', ''], r3 = ['', '', ''], r4 = ['', '', ''], r5 = ['', '', ''];
    model.periods.forEach((per) => {
      r1.push(`${per.dayLabel}${per.date ? ' ' + per.date : ''}`);
      r2.push(`${per.p}교시`);
      [r3, r4, r5].forEach((r, gi) => r.push(per.grades[gi].label ? `${gi + 1}학년\n${per.grades[gi].label}` : ''));
    });
    statNames.forEach((n) => { r1.push(n); r2.push(''); r3.push(''); r4.push(''); r5.push(''); });
    [r1, r2, r3, r4, r5].forEach((r) => ws3.addRow(r));
    for (let rn = 1; rn <= 5; rn++) {
      const row = ws3.getRow(rn);
      row.height = rn <= 2 ? 20 : 34;
      for (let c = 1; c < statCol + statNames.length; c++) {
        const cell = row.getCell(c);
        cell.fill = F.header; cell.border = BORDER; cell.alignment = CENTER; cell.font = { bold: rn <= 2, size: rn <= 2 ? 11 : 9 };
        if (rn >= 3 && String(cell.value || '').includes('자습')) cell.fill = F.yellow;
      }
    }
    ws3.mergeCells(1, 1, 5, 1); ws3.mergeCells(1, 2, 5, 2); ws3.mergeCells(1, 3, 5, 3);
    for (let i = 0; i < statNames.length; i++) ws3.mergeCells(1, statCol + i, 5, statCol + i);
    let c0 = firstP;
    for (let d = 0; d < model.D; d++) {
      const n = model.periods.filter((p) => p.d === d).length;
      if (n > 1) ws3.mergeCells(1, c0, 1, c0 + n - 1);
      c0 += n;
    }

    const L = (c) => colName(c);
    const rangeOf = (rn) => `${L(firstP)}${rn}:${L(statCol - 1)}${rn}`;
    const personalRow = {};
    ev.stats.forEach((st, i) => {
      const t = model.teachers[i];
      const vals = [i + 1, st.name, st.subject];
      const fills = [];
      model.periods.forEach((per) => {
        const v = st.cells[per.pi];
        if (v === '본인시험') { vals.push(''); fills.push(F.blue); }
        else { vals.push(v || ''); fills.push(null); }
      });
      const rn = ws3.rowCount + 1;
      personalRow[st.name] = rn;
      const rg = rangeOf(rn);
      const examHours = st.cls + st.corridor + st.study;
      vals.push(
        { formula: `COUNTIFS(${rg},"*-*",${rg},"<>*자습*",${rg},"<>*복도*")`, result: st.cls },
        { formula: `COUNTIF(${rg},"*복도*")`, result: st.corridor },
        { formula: `COUNTIFS(${rg},"*자습*",${rg},"<>*복도*")`, result: st.study },
        st.special,
        { formula: `SUM(${L(statCol)}${rn}:${L(statCol + 3)}${rn})`, result: examHours + st.special },
        { formula: `${st.prev}+${L(statCol + 4)}${rn}`, result: st.prev + st.total },
      );
      const row = ws3.addRow(vals);
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        cell.border = BORDER;
        cell.alignment = cn === 3 ? { horizontal: 'center', vertical: 'middle', shrinkToFit: true } : CENTER;
        if (cn >= firstP && cn < statCol) { cell.numFmt = '@'; if (fills[cn - firstP]) cell.fill = fills[cn - firstP]; }
        if (t.type === '제외') cell.font = { color: { argb: 'FF999999' } };
      });
    });
    // 예비 명단
    const maxRes = Math.max(0, ...ev.reserves.map((r) => r.length));
    for (let k = 0; k < maxRes; k++) {
      const vals = [k + 1, '예비', ''];
      ev.reserves.forEach((list) => vals.push(list[k] ? `${list[k].name}(${list[k].hours})` : ''));
      statNames.forEach(() => vals.push(''));
      const row = ws3.addRow(vals);
      row.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; cell.fill = F.pink; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
    }
    // 복도(보라)/자습(노랑) 조건부 서식: 엑셀에서 손으로 고쳐도 색이 따라감
    const lastTeacherRow = 5 + ev.stats.length;
    if (P && ev.stats.length) {
      const ref = `${L(firstP)}6:${L(statCol - 1)}${lastTeacherRow}`;
      const tl = `${L(firstP)}6`;
      ws3.addConditionalFormatting({
        ref,
        rules: [
          { type: 'expression', priority: 1, formulae: [`ISNUMBER(SEARCH("복도",${tl}))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE8DAEF' } } } },
          { type: 'expression', priority: 2, formulae: [`ISNUMBER(SEARCH("(자습)",${tl}))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF2CC' } } } },
        ],
      });
    }
    ws3.getColumn(1).width = 5; ws3.getColumn(2).width = 10; ws3.getColumn(3).width = 14;
    for (let c = firstP; c < statCol; c++) ws3.getColumn(c).width = 13;
    for (let c = statCol; c < statCol + statNames.length; c++) ws3.getColumn(c).width = 6;

    // ---------- [2] 결과_시수표
    const head2 = ['연번', '이름', '구분', '과목', '교실', '복도', '자습', '특수실', '현재총시수', '이전누적', '전체총시수'];
    ws2.addRow(head2);
    ws2.getRow(1).eachCell((cell) => { cell.fill = F.yellow; cell.font = { bold: true }; cell.border = BORDER; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
    ev.stats.forEach((st, i) => {
      const pr = personalRow[st.name];
      const ref = (k) => `'결과_개인별시간표'!${L(statCol + k)}${pr}`;
      const rn = ws2.rowCount + 1;
      const row = ws2.addRow([
        i + 1, st.name, st.type + (st.note ? '(' + st.note + ')' : ''), st.subject,
        { formula: ref(0), result: st.cls }, { formula: ref(1), result: st.corridor }, { formula: ref(2), result: st.study },
        st.special,
        { formula: `SUM(E${rn}:H${rn})`, result: st.total },
        st.prev,
        { formula: `J${rn}+I${rn}`, result: st.prev + st.total },
      ]);
      row.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
    });
    ws2.getColumn(3).width = 14; ws2.getColumn(4).width = 30;
    [9, 10, 11].forEach((c) => { ws2.getColumn(c).width = 12; });

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  root.ExcelIO = { readWorkbook, rowsToTeachers, sheetsToCumulative, exportResult, cellText };
})(typeof window !== 'undefined' ? window : globalThis);
