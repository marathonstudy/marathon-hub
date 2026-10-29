/* ============================================================
   import.js — 엑셀(.xlsx/.xls) · CSV 로 명단 한꺼번에 넣기

   같은 학생 판단
     1. 이름 + 학부모 연락처가 같으면 → 기존 학생을 고친다
        (반을 옮겨도 새 학생이 생기지 않는다)
     2. 학부모 연락처가 비어 있을 때만 → 이름 + 반으로 찾는다
     3. 못 찾으면 → 새 학생
   빈 칸은 기존 값을 지우지 않는다. 적힌 칸만 바꾼다.

   엑셀은 SheetJS 를 그때그때 불러와 읽는다(설치 없음, 파일은 서버로 가지 않는다).
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function toast(m, k) { UI.toast(m, k); }

  var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  /* 열 이름 → 칸. 띄어쓰기·대소문자는 무시하고 비교한다. */
  var COLS = {
    name:         ['이름', '학생이름', '학생명', '성명', 'name'],
    school:       ['학교', '학교명', 'school'],
    grade:        ['학년', 'grade'],
    className:    ['반', '반이름', '클래스', 'class'],
    parentTitle:  ['학부모호칭', '호칭', '보호자호칭'],
    parentPhone:  ['학부모연락처', '학부모번호', '학부모전화', '보호자연락처', '부모님연락처', '어머님연락처', '학부모'],
    studentPhone: ['학생연락처', '학생번호', '학생전화', '본인연락처'],
    appCode:      ['앱공유링크', '앱링크', '앱공유코드', '앱코드', '마라톤앱', '공유링크'],
    startDate:    ['수강시작일', '수강 시작일', '시작일', '등록일', '수강일']
  };

  var TEMPLATE_HEAD = ['이름', '학교', '학년', '반', '학부모호칭', '학부모연락처', '학생연락처', '앱공유링크', '수강시작일'];

  /* 2026-03-02 · 2026.3.2 · 2026/3/2 · 3/2/26(엑셀 표시) · 46083(엑셀 날짜 숫자) → 'YYYY-MM-DD'.
     비었으면 '', 알아볼 수 없으면 null */
  function parseDate(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    var ok = function (y, m, d) {
      var dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? y + '-' + p(m) + '-' + p(d) : null;
    };
    var m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})일?$/.exec(t);
    if (m) return ok(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
    if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    if (/^\d{5}$/.test(t)) {
      var dt = new Date(Date.UTC(1899, 11, 30) + (+t) * 86400000);
      return ok(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    return null;
  }

  function norm(h) { return String(h == null ? '' : h).replace(/\s+/g, '').toLowerCase(); }

  function mapHeader(row) {
    var map = {};
    row.forEach(function (h, i) {
      var n = norm(h);
      Object.keys(COLS).forEach(function (k) {
        if (map[k] !== undefined) return;
        if (COLS[k].some(function (c) { return norm(c) === n; })) map[k] = i;
      });
    });
    return map;
  }

  /* ---------- CSV ---------- */

  /* 따옴표 안의 쉼표·줄바꿈까지 처리하는 작은 CSV 읽개 */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* 한국어 윈도우 엑셀이 저장한 CSV 는 UTF-8 이 아니라 EUC-KR 인 경우가 많다 */
  function decodeCsv(buf) {
    var utf = new TextDecoder('utf-8').decode(buf);
    if (utf.indexOf('�') === -1) return utf;
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return utf; }
  }

  /* ---------- 엑셀 ---------- */

  var xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { xlsxPromise = null; reject(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV 로 저장해 넣어 주세요.')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function readFile(file) {
    var lower = file.name.toLowerCase();
    return file.arrayBuffer().then(function (buf) {
      if (/\.csv$/.test(lower)) return parseCsv(decodeCsv(buf));
      if (/\.xlsx?$/.test(lower)) {
        return loadXlsx().then(function (X) {
          var wb = X.read(buf, { type: 'array' });
          var sheet = wb.Sheets[wb.SheetNames[0]];
          /* 전화번호가 숫자로 저장돼 앞자리 0 이 빠지는 경우를 아래 phoneFix 에서 되살린다 */
          return X.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        });
      }
      throw new Error('.xlsx · .xls · .csv 파일만 넣을 수 있습니다.');
    });
  }

  /* 1012345678 처럼 앞의 0 이 빠진 휴대폰 번호를 되살린다 */
  function phoneFix(v) {
    var d = Store.phoneDigits(v);
    if (d.length === 10 && d[0] === '1') d = '0' + d;
    return d;
  }

  /* ---------- 비교 · 미리보기 ---------- */

  var plan = null;   /* { adds:[], updates:[], errors:[], appCodes:{} } */

  function cellOf(row, map, key) {
    var i = map[key];
    return i === undefined ? '' : String(row[i] == null ? '' : row[i]).trim();
  }

  function buildPlan(rows) {
    if (!rows.length) throw new Error('파일이 비어 있습니다.');

    /* 머리줄 찾기 — 위쪽 다섯 줄 안에서 '이름' 칸이 있는 줄 */
    var headIdx = -1, map = null;
    for (var i = 0; i < Math.min(5, rows.length); i++) {
      var m = mapHeader(rows[i]);
      if (m.name !== undefined) { headIdx = i; map = m; break; }
    }
    if (headIdx < 0) throw new Error('첫 줄에서 "이름" 열을 찾지 못했습니다. 양식 파일을 참고해 주세요.');

    var existing = Store.getStudents();
    var byNamePhone = {}, byNameClass = {};
    existing.forEach(function (s) {
      if (s.parentPhone) byNamePhone[s.name + '|' + s.parentPhone] = s;
      byNameClass[s.name + '|' + (s.className || '')] = byNameClass[s.name + '|' + (s.className || '')] || s;
    });

    var out = { adds: [], updates: [], same: 0, errors: [], appCodes: {}, startDates: {}, map: map };
    var seen = {};

    rows.slice(headIdx + 1).forEach(function (row, n) {
      var line = headIdx + n + 2;            /* 엑셀에서 보이는 줄 번호 */
      var name = cellOf(row, map, 'name');
      if (!name && row.every(function (c) { return !String(c || '').trim(); })) return;   /* 빈 줄 */
      if (!name) { out.errors.push({ line: line, msg: '이름이 비어 있습니다' }); return; }

      var parentPhone = phoneFix(cellOf(row, map, 'parentPhone'));
      var studentPhone = phoneFix(cellOf(row, map, 'studentPhone'));
      if (!Store.phoneValid(parentPhone)) { out.errors.push({ line: line, msg: name + ' — 학부모 연락처 자릿수가 이상합니다' }); return; }
      if (!Store.phoneValid(studentPhone)) { out.errors.push({ line: line, msg: name + ' — 학생 연락처 자릿수가 이상합니다' }); return; }

      var appRaw = cellOf(row, map, 'appCode');
      var appCode = appRaw ? Store.extractAppCode(appRaw) : '';
      if (appCode === null) { out.errors.push({ line: line, msg: name + ' — 앱 공유 링크를 알아볼 수 없습니다' }); return; }
      var startDate = parseDate(cellOf(row, map, 'startDate'));
      if (startDate === null) { out.errors.push({ line: line, msg: name + ' — 수강 시작일을 알아볼 수 없습니다 (예: 2026-03-02)' }); return; }

      var vals = {
        name: name,
        school: cellOf(row, map, 'school'),
        grade: cellOf(row, map, 'grade'),
        className: cellOf(row, map, 'className'),
        parentTitle: cellOf(row, map, 'parentTitle'),
        parentPhone: parentPhone,
        studentPhone: studentPhone
      };

      /* 같은 파일 안에서 겹치는 줄 */
      var fileKey = parentPhone ? 'p|' + name + '|' + parentPhone : 'c|' + name + '|' + vals.className;
      if (seen[fileKey]) { out.errors.push({ line: line, msg: name + ' — ' + seen[fileKey] + '번째 줄과 같은 학생입니다' }); return; }
      seen[fileKey] = line;

      var hit = parentPhone
        ? byNamePhone[name + '|' + parentPhone]
        : byNameClass[name + '|' + vals.className];

      if (hit) {
        var changes = [];
        var next = {};
        Object.keys(hit).forEach(function (k) { next[k] = hit[k]; });
        ['school', 'grade', 'className', 'parentTitle', 'parentPhone', 'studentPhone'].forEach(function (k) {
          if (vals[k] && vals[k] !== (hit[k] || '')) {
            changes.push({ key: k, from: hit[k] || '', to: vals[k] });
            next[k] = vals[k];
          }
        });
        if (hit.archived) { next.archived = false; changes.push({ key: 'archived', from: '퇴원', to: '다님' }); }
        var appChanged = appCode && appCode !== (Store.linkOf(hit.id).appCode || '');
        if (appChanged) out.appCodes[hit.id] = appCode;
        if (startDate) out.startDates[hit.id] = startDate;
        if (changes.length || appChanged) {
          out.updates.push({ line: line, student: next, changes: changes, app: appChanged });
        } else {
          out.same++;
        }
      } else {
        var rec = {
          id: Store.newId(), name: name, school: vals.school, grade: vals.grade,
          className: vals.className, parentTitle: vals.parentTitle,
          parentPhone: parentPhone, studentPhone: studentPhone,
          archived: false, extra: {}, sortOrder: 0, createdAt: new Date().toISOString(),
          /* 수강 시작일 — 칸에 없으면 그 반 다음 수업일 (오늘이 수업일이면 오늘 · migration-044 · 20261031q) */
          startOn: startDate || Store.nextLessonDate(vals.className)
        };
        if (appCode) out.appCodes[rec.id] = appCode;
        if (startDate) out.startDates[rec.id] = startDate;
        out.adds.push({ line: line, student: rec });
      }
    });

    return out;
  }

  var LABEL = { school: '학교', grade: '학년', className: '반', parentTitle: '호칭',
                parentPhone: '학부모', studentPhone: '학생번호', archived: '상태' };

  function showVal(k, v) {
    return /Phone$/.test(k) ? Store.phoneFormat(v) : v;
  }

  function renderPlan() {
    var host = $('#importPreview');
    host.textContent = '';
    if (!plan) { $('#btnImportApply').disabled = true; return; }

    var sum = document.createElement('div');
    sum.className = 'imp-sum';
    sum.innerHTML =
      '<span class="imp-pill imp-pill--add">새 학생 ' + plan.adds.length + '명</span>' +
      '<span class="imp-pill imp-pill--upd">고칠 학생 ' + plan.updates.length + '명</span>' +
      '<span class="imp-pill">바뀐 것 없음 ' + plan.same + '명</span>' +
      (plan.errors.length ? '<span class="imp-pill imp-pill--err">건너뜀 ' + plan.errors.length + '줄</span>' : '') +
      (Object.keys(plan.startDates).length ? '<span class="imp-pill">수강 시작일 ' + Object.keys(plan.startDates).length + '명</span>' : '');
    host.appendChild(sum);

    function section(title, items, fn) {
      if (!items.length) return;
      var box = document.createElement('div');
      box.className = 'imp-sec';
      var h = document.createElement('div');
      h.className = 'imp-sec__title';
      h.textContent = title;
      box.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'imp-list';
      items.slice(0, 200).forEach(function (it) {
        var li = document.createElement('li');
        li.textContent = fn(it);
        ul.appendChild(li);
      });
      if (items.length > 200) {
        var more = document.createElement('li');
        more.textContent = '… 외 ' + (items.length - 200) + '개';
        ul.appendChild(more);
      }
      box.appendChild(ul);
      host.appendChild(box);
    }

    section('새로 추가', plan.adds, function (a) {
      var s = a.student;
      return s.name + ' · ' + (s.className || '반 없음') + (s.parentPhone ? ' · ' + Store.phoneMask(s.parentPhone) : '') +
             (plan.appCodes[s.id] ? ' · 앱 연결' : '');
    });
    section('고침', plan.updates, function (u) {
      var parts = u.changes.map(function (c) {
        return LABEL[c.key] + ' ' + (showVal(c.key, c.from) || '(빈칸)') + ' → ' + showVal(c.key, c.to);
      });
      if (u.app) parts.push('앱 코드 갱신');
      return u.student.name + ' — ' + parts.join(', ');
    });
    section('건너뜀 (고쳐서 다시 넣어 주세요)', plan.errors, function (e) {
      return e.line + '번째 줄: ' + e.msg;
    });

    $('#btnImportApply').disabled = !(plan.adds.length || plan.updates.length || Object.keys(plan.startDates).length);
  }

  function showError(msg) {
    var box = $('#importError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  function handleFile(file) {
    showError('');
    plan = null;
    renderPlan();
    $('#importPreview').innerHTML = '<p class="panel__hint">읽는 중…</p>';
    readFile(file).then(function (rows) {
      plan = buildPlan(rows);
      renderPlan();
    }).catch(function (e) {
      $('#importPreview').textContent = '';
      showError(e.message);
    });
  }

  /* ---------- 반영 ---------- */

  function apply() {
    if (!plan) return;
    /* 새로 들어오는 학생에게 앱 안내 문자 (sms.js · 20261031m) — 반영한 뒤 「문자 발송」 → 보내기 */
    var invite = window.Sms && Sms.inviteOpts ? Sms.inviteOpts('i') : null;
    var btn = $('#btnImportApply');
    btn.disabled = true;
    btn.textContent = '반영하는 중…';

    var list = Store.getStudents().slice();
    plan.updates.forEach(function (u) {
      var i = list.findIndex(function (s) { return s.id === u.student.id; });
      if (i >= 0) list[i] = u.student;
    });
    plan.adds.forEach(function (a) { list.push(a.student); });

    Store.writeLocal(Store.KEYS.students, list);
    var issue = $('#importIssue').checked;
    var p = plan;

    Store.flushNow(Store.KEYS.students, list)
      .then(function () {
        var links = Object.keys(p.appCodes).map(function (sid) {
          return { studentId: sid, appCode: p.appCodes[sid] };
        });
        return DB.saveLinks(links).then(function () {
          links.forEach(function (l) {
            var cur = Store.linkOf(l.studentId);
            cur.appCode = l.appCode;
            cur.appUpdatedAt = new Date().toISOString();
            Store.setLinkLocal(l.studentId, cur);
          });
        });
      })
      .then(function () {
        /* 수강 시작일은 상담 카드(student_cards)에 — 그 칸만 고친다 */
        var rows = Object.keys(p.startDates).map(function (sid) { return { student_id: sid, start_date: p.startDates[sid] }; });
        if (!rows.length) return null;
        return SB.client.from('student_cards').upsert(rows, { onConflict: 'student_id' }).then(function (r) {
          if (r.error) toast('수강 시작일은 저장하지 못했습니다 (SQL 004 를 먼저 실행하세요) — ' + r.error.message, 'warn');
        });
      })
      .then(function () {
        if (!issue) return 0;
        var ids = p.adds.map(function (a) { return a.student.id; })
          .filter(function (id) { return !Store.linkOf(id).hubCode; });
        return ids.length ? UI.issueMissing(ids) : 0;
      })
      .then(function (issued) {
        btn.textContent = '명단에 반영';
        $('#importModal').close();
        window.dispatchEvent(new CustomEvent('jt:roster-changed'));
        toast('새 학생 ' + p.adds.length + '명 · 고친 학생 ' + p.updates.length + '명 반영' +
              (issued ? ' · 개인 링크 ' + issued + '명 발급' : ''), 'good');
        plan = null;
        var newIds = p.adds.map(function (a) { return a.student.id; }).filter(function (id) {
          var s = Store.getStudents().find(function (x) { return x.id === id; });
          return s && !s.archived;
        });
        if (invite && newIds.length) Sms.appInvite(newIds, { code: invite.code, to: invite.to, from: 'roster', confirm: true });
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = '명단에 반영';
        window.dispatchEvent(new CustomEvent('jt:roster-changed'));
        showError('반영하지 못했습니다 — ' + e.message);
      });
  }

  /* ---------- 양식 ---------- */

  function downloadTemplate() {
    var rows = [
      TEMPLATE_HEAD,
      ['김하늘', 'OO고', '고1', '목동1', '어머님', '010-1234-5678', '010-9876-5432', 'https://marathonstudy.com/share/report/코드', '2026-03-02']
    ];
    var csv = rows.map(function (r) {
      return r.map(function (c) { return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\r\n');
    /* 엑셀이 한글을 깨뜨리지 않도록 BOM 을 붙인다 */
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '명단_양식.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- 연결 ---------- */

  $('#btnImport').addEventListener('click', function () {
    plan = null;
    renderPlan();
    showError('');
    $('#importPreview').textContent = '';
    if (window.Sms && Sms.resetInvite) Sms.resetInvite('i', true);
    $('#importModal').showModal();
  });
  $('#btnImportCancel').addEventListener('click', function () { $('#importModal').close(); });
  $('#btnImportApply').addEventListener('click', apply);
  $('#btnImportTemplate').addEventListener('click', downloadTemplate);

  var drop = $('#importDrop');
  var input = $('#importFile');
  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  input.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) handleFile(f);
  });

  /* 자동 확인용 */
  window.Importer = { parseCsv: parseCsv, buildPlan: buildPlan, phoneFix: phoneFix };

})();
