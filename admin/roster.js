/* ============================================================
   roster.js — 「📋 명단 받기」 반 명단 엑셀(.xlsx) (20261125a · migration-128 · 직원만)

   버튼: 「오늘」 반 목록 위(현강 · 온라인 탭 줄) · 현강 반 카드 · 과정 카드 · 온라인 반 화면 제목 줄
     → 창 하나: 반 고르기(여러 개 · 종강 · 보관한 반도) · 파일 모양(반마다 시트 / 한 시트 + 「반」 열) · 넣을 열 · 퇴원생 포함
   열: 반 · 이름 · 학교 · 학년 · 학생 연락처 · 학부모 연락처 · 등록일 · 상태(재원 / 퇴원) + 퇴원일 · 앱 연결 여부
     기본: 반 · 이름 · 학교 · 학년 · 학생 연락처 · 학부모 연락처 · 상태 · 「이름」은 늘 넣음
     등록일 = 수강 시작일(없으면 학생 등록한 날) · 학부모 연락처 = 학부모 번호 1 · 2 (「 / 」) · 앱 연결 = 연결 · 공유 코드만 · 안 됨
   퇴원생 포함 — 기본 끔 · 종강 · 보관한 반을 고르면 기본 켬(직접 바꾸면 그대로)
   이름순(같은 이름은 학교순) · 한 시트로 합치면 반 → 이름순
   파일 이름 「명단_목동반_반포반_20261125.xlsx」(반이 4개 넘으면 「명단_목동반_반포반_외3개반_…」)
   받을 때마다 서버에 기록(roster_log · 누가 · 언제 · 어느 반 · 열 · 학생 수) — 기록이 안 남으면 파일을 만들지 않는다
   「🧾 받기 기록」 — 같은 창에서 최근 기록(roster_log_list)
   엑셀은 이 파일이 직접 만든다(ZIP 은 finish-pdf.js FinPdf.zip · 서버 · 외부 라이브러리 없음) · 파일은 직원 PC 에만
   학생 정보는 서버 기록 · 콘솔 · 저장소에 남기지 않는다(기록에는 반 이름 · 열 이름 · 수만)
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, k) { if (global.UI && UI.toast) UI.toast(m, k); }
  function sb() { return global.SB && SB.client; }
  function today() { return global.DDay && DDay.today ? DDay.today() : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function koSort(a, b) { return String(a || '').localeCompare(String(b || ''), 'ko'); }
  function errText(e) { return global.ErrKo ? ErrKo.ko(e) : (e && e.message) || String(e || ''); }
  function needSql(e) { return /Could not find the function|does not exist|schema cache|PGRST202/i.test((e && (e.message || e.code)) || ''); }

  /* ---------- 열 ---------- */
  var COLS = [
    { k: 'cls',    label: '반',            on: true },
    { k: 'name',   label: '이름',          on: true, must: true },
    { k: 'school', label: '학교',          on: true },
    { k: 'grade',  label: '학년',          on: true },
    { k: 'sp',     label: '학생 연락처',   on: true },
    { k: 'pp',     label: '학부모 연락처', on: true },
    { k: 'join',   label: '등록일',        on: false },
    { k: 'state',  label: '상태',          on: true },     /* 「상태」 · 「퇴원일」 두 칸 */
    { k: 'app',    label: '앱 연결 여부',  on: false }
  ];
  var APP = { ok: '연결', share: '공유 코드만' };
  var OPT_KEY = 'mh.rs.opts';

  var S = { pick: {}, mode: 'sheets', cols: {}, left: false, leftTouched: false, view: 'form', q: '', busy: false, log: null, logErr: '', msg: '' };
  COLS.forEach(function (c) { S.cols[c.k] = c.on; });
  (function loadOpts() {
    try {
      var o = JSON.parse((global.localStorage && localStorage.getItem(OPT_KEY)) || 'null');
      if (o && typeof o === 'object') {
        if (o.mode === 'one' || o.mode === 'sheets') S.mode = o.mode;
        if (o.cols) COLS.forEach(function (c) { if (typeof o.cols[c.k] === 'boolean' && !c.must) S.cols[c.k] = o.cols[c.k]; });
      }
    } catch (e) { /* 그대로 */ }
  })();
  function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify({ mode: S.mode, cols: S.cols })); } catch (e) { /* 그대로 */ } }

  /* ---------- 반 · 학생 ---------- */
  function St() { return global.Store; }
  function clsOf(s) { return String((s && s.className) || '').trim(); }
  function isOnline(n) { return !!(global.OnlineClass && OnlineClass.isOnline && OnlineClass.isOnline(n)); }
  function gone(s) { return St() && St().isGone ? St().isGone(s) : !!(s && s.archived); }
  /* 고를 수 있는 반 — 지금 반(보관 안 함) + 보관한 반 + 학생에게 남아 있는 반 이름(퇴원생만 남은 반 포함) */
  function classes() {
    var X = St(); if (!X) return [];
    var seen = {}, all = X.getStudents ? X.getStudents() : [];
    (X.getClasses ? X.getClasses() : []).forEach(function (c) { if (c.name && c.name !== '(반 없음)') seen[c.name] = 1; });
    (X.archivedClasses ? X.archivedClasses() : []).forEach(function (n) { if (n) seen[n] = 1; });
    all.forEach(function (s) { var c = clsOf(s); if (c) seen[c] = 1; });
    return Object.keys(seen).sort(koSort).map(function (n) {
      var rows = all.filter(function (s) { return clsOf(s) === n; });
      var arch = !!(X.isArchivedClass && X.isArchivedClass(n)), ended = !!(X.isEnded && X.isEnded(n));
      return { name: n, arch: arch, ended: ended, online: isOnline(n), act: rows.filter(function (s) { return !gone(s); }).length, left: rows.filter(gone).length };
    });
  }
  function infoOf(n) { return classes().filter(function (c) { return c.name === n; })[0] || null; }
  function picked() { return Object.keys(S.pick).filter(function (n) { return S.pick[n]; }).sort(koSort); }
  function autoLeft() { return picked().some(function (n) { var c = infoOf(n); return !!(c && (c.arch || c.ended)); }); }

  function rowsOf(names, withLeft) {
    var X = St(), all = X ? X.getStudents() : [], out = [];
    names.forEach(function (n) {
      all.filter(function (s) { return clsOf(s) === n && (withLeft || !gone(s)); }).forEach(function (s) { out.push({ cls: n, s: s }); });
    });
    return out;
  }
  function byName(a, b) { return koSort(a.s.name, b.s.name) || koSort(a.s.school, b.s.school); }
  function phone(v) { var X = St(); var d = String(v || '').replace(/\D/g, ''); return !d ? '' : X && X.phoneFormat ? X.phoneFormat(d) : d; }
  function cells(r, cols, app) {
    var s = r.s, X = St(), out = [];
    cols.forEach(function (k) {
      if (k === 'cls') out.push(r.cls);
      else if (k === 'name') out.push(s.name || '');
      else if (k === 'school') out.push(s.school || '');
      else if (k === 'grade') out.push(s.grade || '');
      else if (k === 'sp') out.push(phone(s.studentPhone));
      else if (k === 'pp') out.push([s.parentPhone, s.parentPhone2].map(phone).filter(Boolean).join(' / '));
      else if (k === 'join') out.push(X && X.joinedOf ? X.joinedOf(s) : (s.startOn || ''));
      else if (k === 'state') { out.push(gone(s) ? '퇴원' : '재원'); out.push(s.leftOn || ''); }
      else if (k === 'app') out.push(APP[(app || {})[s.id]] || '안 됨');
    });
    return out;
  }
  function header(cols) {
    var out = [];
    cols.forEach(function (k) { var c = COLS.filter(function (x) { return x.k === k; })[0]; out.push(c.label); if (k === 'state') out.push('퇴원일'); });
    return out;
  }
  function colKeys() { return COLS.filter(function (c) { return c.must || S.cols[c.k]; }).map(function (c) { return c.k; }); }

  /* 시트 만들기 — sheets: 반마다 한 장(이름순) · one: 한 장(반 → 이름순 · 「반」 열을 늘 넣음) */
  function sheetsOf(names, opt, app) {
    var cols = opt.cols.slice(), rows = rowsOf(names, opt.left);
    if (opt.mode === 'one') {
      if (cols.indexOf('cls') === -1) cols.unshift('cls');
      rows.sort(function (a, b) { return names.indexOf(a.cls) - names.indexOf(b.cls) || byName(a, b); });
      return { n: rows.length, sheets: [{ name: '명단', rows: [header(cols)].concat(rows.map(function (r) { return cells(r, cols, app); })) }] };
    }
    return { n: rows.length, sheets: names.map(function (n) {
      var rs = rows.filter(function (r) { return r.cls === n; }).sort(byName);
      return { name: n, rows: [header(cols)].concat(rs.map(function (r) { return cells(r, cols, app); })) };
    }) };
  }

  /* ---------- 파일 이름 ---------- */
  function safe(s) { return global.FinPdf && FinPdf.safeName ? FinPdf.safeName(s) : String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim(); }
  function fileName(names, day) {
    var ymd = String(day || today()).replace(/-/g, ''), ns = names.map(safe).filter(Boolean);
    var mid = ns.length > 4 ? ns.slice(0, 2).join('_') + '_외' + (ns.length - 2) + '개반' : ns.join('_');
    var base = '명단_' + mid;
    if (base.length > 70) base = base.slice(0, 70).replace(/[_. ]+$/, '');
    return base + '_' + ymd + '.xlsx';
  }

  /* ============================================================
     .xlsx — 글자 칸만(inlineStr · 번호 앞 0 그대로) · 첫 줄 굵게 · 첫 줄 고정 · 열 너비
     ============================================================ */
  function xml(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function wide(v) { var n = 0, t = String(v == null ? '' : v); for (var i = 0; i < t.length; i++) n += t.charCodeAt(i) > 0x2e80 ? 2 : 1; return n; }
  function sheetName(n, used) {
    var t = String(n || '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '') || '시트';
    t = t.slice(0, 31).trim();
    var out = t, k = 1;
    while (used[out.toLowerCase()]) { k++; var tail = ' (' + k + ')'; out = t.slice(0, 31 - tail.length).trim() + tail; }
    used[out.toLowerCase()] = 1;
    return out;
  }
  function sheetXml(rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (v, i) { w[i] = Math.max(w[i] || 0, wide(v)); }); });
    var cols = w.length ? '<cols>' + w.map(function (x, i) { var c = Math.max(8, Math.min(40, x + 2)); return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
    var data = rows.map(function (r, ri) {
      return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
        return '<c r="' + colName(ci) + (ri + 1) + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="16.5"/>' + cols + '<sheetData>' + data + '</sheetData></worksheet>';
  }
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><family val="3"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEBFF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function utf8(s) { return new TextEncoder().encode(s); }
  /* sheets = [{ name, rows: [[글자 …] …] }] → Uint8Array (.xlsx) */
  function xlsx(sheets, when) {
    if (!global.FinPdf || !FinPdf.zip) throw new Error('엑셀 도구(finish-pdf.js)가 아직 안 불러와졌어요 — 새로고침해 주세요');
    var used = {}, names = sheets.map(function (s) { return sheetName(s.name, used); });
    var files = [
      { name: '[Content_Types].xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>') },
      { name: '_rels/.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: 'xl/workbook.xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' + names.map(function (n, i) { return '<sheet name="' + xml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
      { name: 'xl/styles.xml', data: utf8(STYLES) }
    ];
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(sheetXml(s.rows)) }); });
    return FinPdf.zip(files, when);
  }

  /* ============================================================
     창
     ============================================================ */
  var dlg = null;
  function classItem(c) {
    var k = esc(c.name), on = !!S.pick[c.name];
    var tag = c.arch ? '<span class="rs-tag is-off">보관</span>' : c.ended ? '<span class="rs-tag is-off">종강</span>' : '';
    return '<label class="rs-c' + (on ? ' is-on' : '') + '"><input type="checkbox" data-rs-cls="' + k + '"' + (on ? ' checked' : '') + '>' +
      '<span class="rs-c__n">' + (c.online ? '💻 ' : '') + k + '</span>' + tag +
      '<small class="rs-c__k num">' + c.act + '명' + (c.left ? ' · 퇴원 ' + c.left : '') + '</small></label>';
  }
  function groupHtml(title, key, list) {
    if (!list.length) return '';
    return '<div class="rs-g"><div class="rs-g__h"><b>' + title + '</b> <small class="muted-note num">' + list.length + '개</small>' +
      '<button type="button" class="btn btn--sm btn--ghost rs-g__all" data-rs-all="' + key + '">모두 고르기</button></div>' +
      '<div class="rs-g__list">' + list.map(classItem).join('') + '</div></div>';
  }
  function formHtml() {
    var all = classes(), q = String(S.q || '').trim();
    var vis = q ? all.filter(function (c) { return c.name.indexOf(q) !== -1 || S.pick[c.name]; }) : all;
    var past = vis.filter(function (c) { return c.arch || c.ended; }), now = vis.filter(function (c) { return !c.arch && !c.ended; });
    var names = picked(), left = S.leftTouched ? S.left : autoLeft();
    var cols = colKeys(), n = rowsOf(names, left).length;
    var groups = groupHtml('🏫 현강', 'class', now.filter(function (c) { return !c.online; })) +
      groupHtml('💻 온라인', 'online', now.filter(function (c) { return c.online; })) +
      groupHtml('📦 종강 · 보관', 'past', past);
    return '<div class="modal__body rs-body">' +
      '<section class="rs-s"><h3 class="rs-h">반 고르기 <small class="muted-note">여러 개 · 종강 · 보관한 반도</small></h3>' +
        '<div class="rs-find"><input class="input input--sm" type="search" data-rs-q placeholder="반 이름 찾기" autocomplete="off" value="' + esc(S.q) + '" aria-label="반 이름 찾기">' +
        (names.length ? '<button type="button" class="btn btn--sm btn--ghost" data-rs-none>모두 끄기</button>' : '') + '</div>' +
        (groups || '<p class="muted-note">찾는 반이 없어요</p>') + '</section>' +
      '<section class="rs-s"><h3 class="rs-h">파일 모양</h3><div class="rs-opts">' +
        '<label class="rs-r"><input type="radio" name="rsMode" value="sheets" data-rs-mode' + (S.mode === 'sheets' ? ' checked' : '') + '> 반마다 시트 하나</label>' +
        '<label class="rs-r"><input type="radio" name="rsMode" value="one" data-rs-mode' + (S.mode === 'one' ? ' checked' : '') + '> 한 시트에 합치기(「반」 열)</label></div></section>' +
      '<section class="rs-s"><h3 class="rs-h">넣을 열</h3><div class="rs-opts">' + COLS.map(function (c) {
        var on = c.must || S.cols[c.k];
        return '<label class="rs-r"><input type="checkbox" data-rs-col="' + c.k + '"' + (on ? ' checked' : '') + (c.must ? ' disabled' : '') + '> ' + c.label + (c.k === 'state' ? ' <small class="muted-note">(재원 · 퇴원 · 퇴원일)</small>' : '') + '</label>';
      }).join('') + '</div>' + (S.mode === 'one' && !S.cols.cls ? '<p class="muted-note rs-note">한 시트로 합치면 「반」 열은 늘 넣어요</p>' : '') + '</section>' +
      '<section class="rs-s"><label class="rs-r rs-left"><input type="checkbox" data-rs-left' + (left ? ' checked' : '') + '> 퇴원생 포함</label>' +
        '<small class="muted-note">' + (S.leftTouched ? '직접 바꿨어요' : '기본 끔 · 종강 · 보관한 반을 고르면 켜져요') + '</small></section>' +
      '<p class="rs-sum" data-rs-sum role="status">' + (names.length
        ? '반 <b class="num">' + names.length + '</b>개 · 학생 <b class="num">' + n + '</b>명 · 열 ' + header(S.mode === 'one' && cols.indexOf('cls') === -1 ? ['cls'].concat(cols) : cols).length + '개<br><span class="rs-file">' + esc(fileName(names)) + '</span>'
        : '반을 하나 이상 골라 주세요') + '</p>' +
      (S.msg ? '<p class="cs-err is-on rs-err" role="alert">' + esc(S.msg) + '</p>' : '') +
    '</div>' +
    '<div class="modal__foot rs-foot"><button type="button" class="btn btn--sm" data-rs-log>🧾 받기 기록</button><div class="spacer"></div>' +
      '<button type="button" class="btn" data-rs-close>닫기</button>' +
      '<button type="button" class="btn btn--primary" data-rs-go' + (names.length && !S.busy ? '' : ' disabled') + '>' + (S.busy ? '만드는 중…' : '📥 엑셀 받기') + '</button></div>';
  }
  function fmtAt(iso) {
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var d = new Date(t + 9 * 3600000).toISOString();
    return d.slice(0, 10).replace(/-/g, '.') + ' ' + d.slice(11, 16);
  }
  var COL_LABEL = {}; COLS.forEach(function (c) { COL_LABEL[c.k] = c.label; });
  function logHtml() {
    var body;
    if (S.logErr) body = '<p class="cs-err is-on" role="alert">' + esc(S.logErr) + '</p>';
    else if (!S.log) body = '<p class="muted-note">불러오는 중…</p>';
    else if (!S.log.length) body = '<p class="muted-note">아직 받은 기록이 없어요</p>';
    else body = '<ol class="rs-log">' + S.log.map(function (x) {
      var cl = (x.classes || []);
      return '<li class="rs-log__i"><div class="rs-log__t"><b class="num">' + esc(fmtAt(x.at)) + '</b> · ' + esc(x.by || x.email || '') + '</div>' +
        '<div class="rs-log__c">' + cl.map(esc).join(', ') + '</div>' +
        '<small class="muted-note">학생 ' + (+x.n || 0) + '명 · ' + (x.mode === 'one' ? '한 시트' : '반마다 시트') + (x.left ? ' · 퇴원생 포함' : '') +
          (x.cols && x.cols.length ? ' · 열 ' + x.cols.map(function (k) { return esc(COL_LABEL[k] || k); }).join(' · ') : '') + '</small></li>';
    }).join('') + '</ol>';
    return '<div class="modal__body rs-body"><p class="muted-note">누가 · 언제 · 어느 반 명단을 받았는지(최근 100건) · 직원만 봐요</p>' + body + '</div>' +
      '<div class="modal__foot rs-foot"><button type="button" class="btn btn--sm" data-rs-back>◀ 명단 받기로</button><div class="spacer"></div><button type="button" class="btn" data-rs-close>닫기</button></div>';
  }
  function paint() {
    if (!dlg) return;
    var keep = dlg.querySelector('[data-rs-q]'), had = keep && document.activeElement === keep, pos = had ? keep.selectionStart : 0;
    var sc = dlg.querySelector('.rs-body'), top = sc ? sc.scrollTop : 0;
    dlg.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="rsTitle">' + (S.view === 'log' ? '🧾 명단 받기 기록' : '📋 명단 받기') + '</h2>' +
      (S.view === 'log' ? '' : '<p class="modal__desc">엑셀(.xlsx) · 이름순 · 직원만 · 받을 때마다 「받기 기록」에 남아요</p>') + '</div>' +
      (S.view === 'log' ? logHtml() : formHtml());
    var b = dlg.querySelector('.rs-body'); if (b) b.scrollTop = top;
    if (had) { var q = dlg.querySelector('[data-rs-q]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { /* 그대로 */ } } }
  }
  function loadLog() {
    var c = sb();
    S.log = null; S.logErr = '';
    if (!c) { S.logErr = '서버에 연결되지 않았어요'; paint(); return; }
    Promise.resolve(c.rpc('roster_log_list', { p_limit: 100 })).then(function (r) {
      if (r && r.error) S.logErr = needSql(r.error) ? 'migration-128 SQL 을 먼저 실행해 주세요' : '불러오지 못했어요 — ' + errText(r.error);
      else S.log = Array.isArray(r && r.data) ? r.data : [];
      paint();
    }, function (e) { S.logErr = '불러오지 못했어요 — ' + errText(e); paint(); });
  }

  function go() {
    var names = picked();
    if (!names.length || S.busy) return;
    var c = sb();
    var left = S.leftTouched ? S.left : autoLeft();
    var opt = { cols: colKeys(), mode: S.mode, left: left };
    var file = fileName(names);
    var ids = rowsOf(names, left).map(function (r) { return r.s.id; });
    S.busy = true; S.msg = ''; paint();
    function fail(m) { S.busy = false; S.msg = m; paint(); toast(m, 'bad'); }
    if (!c) { fail('서버에 연결되지 않았어요'); return; }
    var appP = opt.cols.indexOf('app') !== -1 ? Promise.resolve(c.rpc('roster_app', { p_ids: ids })).then(function (r) {
      if (r && r.error) throw r.error;
      return (r && r.data) || {};
    }) : Promise.resolve({});
    var app = null;
    appP.then(function (a) {
      app = a;
      var built = sheetsOf(names, opt, app);
      return Promise.resolve(c.rpc('roster_log', { p_classes: names, p_cols: opt.cols, p_left: left, p_rows: built.n, p_mode: opt.mode, p_file: file })).then(function (r) {
        if (r && r.error) throw r.error;
        if (!r || !r.data || r.data.ok !== true) throw new Error(r && r.data && r.data.reason === 'auth' ? '직원 계정만 받을 수 있어요' : '받기 기록을 남기지 못했어요');
        return built;
      });
    }).then(function (built) {
      var bytes = xlsx(built.sheets);
      FinPdf.save(bytes, file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      S.busy = false; S.msg = ''; paint();
      toast('명단을 받았어요 — ' + file + ' · 학생 ' + built.n + '명', 'good');
    }).catch(function (e) {
      fail(needSql(e) ? 'migration-128 SQL 을 먼저 실행해 주세요(받기 기록이 남아야 받을 수 있어요)' : (e && e.message && !e.code ? e.message : '받지 못했어요 — ' + errText(e)));
    });
  }

  function onClick(e) {
    var t = e.target, b;
    if (t.closest('[data-rs-close]')) { hide(); return; }
    if (t.closest('[data-rs-log]')) { S.view = 'log'; paint(); loadLog(); return; }
    if (t.closest('[data-rs-back]')) { S.view = 'form'; paint(); return; }
    if (t.closest('[data-rs-go]')) { go(); return; }
    if (t.closest('[data-rs-none]')) { S.pick = {}; S.msg = ''; paint(); return; }
    b = t.closest('[data-rs-all]');
    if (b) {
      var g = b.getAttribute('data-rs-all'), q = String(S.q || '').trim();
      classes().forEach(function (c) {
        if (q && c.name.indexOf(q) === -1) return;
        var past = c.arch || c.ended;
        if ((g === 'past' && past) || (g === 'online' && !past && c.online) || (g === 'class' && !past && !c.online)) S.pick[c.name] = true;
      });
      S.msg = ''; paint(); return;
    }
  }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-rs-cls')) { S.pick[t.getAttribute('data-rs-cls')] = t.checked; S.msg = ''; paint(); return; }
    if (t.hasAttribute('data-rs-mode')) { S.mode = t.value === 'one' ? 'one' : 'sheets'; saveOpts(); paint(); return; }
    if (t.hasAttribute('data-rs-col')) { S.cols[t.getAttribute('data-rs-col')] = t.checked; saveOpts(); paint(); return; }
    if (t.hasAttribute('data-rs-left')) { S.left = t.checked; S.leftTouched = true; paint(); return; }
  }
  function onInput(e) { if (e.target.hasAttribute('data-rs-q')) { S.q = e.target.value; paint(); } }

  function hide() { if (!dlg) return; if (global.Layer && Layer.hide) Layer.hide(dlg); else if (dlg.close) dlg.close(); }
  /* 열기 — pre = 미리 고를 반 이름들(반 카드 · 반 화면에서) · 없으면 아무것도 안 고름 */
  function open(pre) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'modal rs-modal'; dlg.id = 'rsModal'; dlg.setAttribute('aria-labelledby', 'rsTitle');
      document.body.appendChild(dlg);
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('change', onChange);
      dlg.addEventListener('input', onInput);
    }
    S.pick = {}; S.q = ''; S.view = 'form'; S.msg = ''; S.busy = false; S.leftTouched = false; S.left = false;
    (pre || []).forEach(function (n) { n = String(n || '').trim(); if (n && n !== '(반 없음)') S.pick[n] = true; });
    paint();
    if (global.Layer && Layer.show) Layer.show(dlg); else if (dlg.showModal) dlg.showModal();
  }
  /* 버튼 — names = 미리 고를 반(하나 · 여럿 · 없음) */
  function btnHtml(names, cls) {
    var list = (Array.isArray(names) ? names : names ? [names] : []).filter(function (n) { return n && n !== '(반 없음)'; });
    return '<button type="button" class="btn btn--sm rs-open' + (cls ? ' ' + cls : '') + '" data-rs-open="' + esc(JSON.stringify(list)) + '" title="반 명단 엑셀(.xlsx) 받기 · 직원만">📋 명단 받기</button>';
  }
  if (global.document && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-rs-open]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var pre = []; try { pre = JSON.parse(b.getAttribute('data-rs-open') || '[]'); } catch (x) { pre = []; }
      open(Array.isArray(pre) ? pre : []);
    }, true);
  }

  global.Roster = { open: open, btnHtml: btnHtml, state: function () { return S; }, classes: classes, sheetsOf: sheetsOf, fileName: fileName, xlsx: xlsx, sheetName: sheetName, COLS: COLS, colKeys: colKeys, autoLeft: autoLeft };
})(window);
