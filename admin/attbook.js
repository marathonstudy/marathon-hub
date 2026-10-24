/* ============================================================
   attbook.js — 학생 → 출석부 (정산용 · 20261031i · migration-037)

   반 · 월을 고르면 학생 줄 × 그 달 수업일 칸
     출석 ● · 결석 빨강 「결」 · 지각 주황 「지」 · 아직 안 넣음 「–」 · 앞으로 올 수업은 빈칸
     결석 칸 작은 표시 — 「자」 자료 미배부 · 「영」 보강 영상 미신청 (코치룸에서만 · 레포트에는 없음)
     퇴원일 뒤 칸 · 수강 시작일 앞 칸은 회색 (세지 않음) · 이름 옆 「퇴원 10/31」
     학생 줄 끝 「출석 n · 결석 n · 지각 n · 수업 n회」 · 표 아래 반 전체 합계 · 날짜마다 출석 n/m
   칸을 누르면 그 수업 출석 체크 창(그 학생)으로 — 고치면 표도 바로 바뀐다
   [엑셀(CSV) 내려받기] — 반 · 이름 · 수강 시작일 · 퇴원일 · 날짜별 출결 · 합계 (엑셀에서 한글이 깨지지 않게 BOM)
   출결은 레포트 학생 카드와 같은 칸(entries) — 한 반 한 주에 한 번 (그 주 레포트 수업일)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var KEY = 'mhub.attbook';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var st = { cls: '', month: '', run: 0, data: null, err: '' };

  function monday(d) { return Lesson.addDays(d, -((Lesson.dowOf(d) + 6) % 7)); }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function monthEnd(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); var d = new Date(Date.UTC(y, mo, 0)); return m + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function shiftMonth(m, n) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); }
  function remember() { try { localStorage.setItem(KEY, JSON.stringify({ cls: st.cls, month: st.month })); } catch (e) {} }
  function recall() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }

  /* 그 달 수업일 — 주마다 레포트 수업일 하나 (휴강 · 첫 수업일 앞은 빼고) */
  function datesOf(cls, month) {
    var first = month + '-01', last = monthEnd(month), out = [], sc = Store.schedOf(cls);
    var f0 = sc && sc.first ? String(sc.first).slice(0, 10) : '';
    for (var w = monday(first); w <= last; w = Lesson.addDays(w, 7)) {
      var L = Store.lessonOf(cls, w);
      if (L && L.date && !L.canceled && L.date >= first && L.date <= last && (!f0 || L.date >= f0)) out.push({ date: L.date, week: w });
    }
    return out;
  }
  /* 그 달 학생 — 퇴원 표시한 학생은 빼고, 퇴원일이 그 달 첫날 앞이면 뺀다 */
  function studentsOf(cls, month) {
    var first = month + '-01';
    return Store.getStudents().filter(function (s) {
      return (s.className || '').trim() === cls && !s.archived && (!s.leftOn || s.leftOn >= first);
    }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
  }

  function classNames() { return Store.getClasses().map(function (c) { return c.name; }); }
  function fillClasses() {
    var sel = $('#abClass'), names = classNames();
    if (!st.cls || names.indexOf(st.cls) === -1) {
      var r = recall(), w = window.Writer && Writer.currentClass ? Writer.currentClass() : '';
      st.cls = names.indexOf(r.cls) !== -1 ? r.cls : names.indexOf(w) !== -1 ? w : (names[0] || '');
    }
    if (!st.month) st.month = recall().month || DDay.today().slice(0, 7);
    sel.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"' + (n === st.cls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    $('#abMonth').value = st.month;
  }

  function load() {
    var run = ++st.run;
    st.err = '';
    if (!st.cls) { st.data = null; render(); return Promise.resolve(); }
    var dates = datesOf(st.cls, st.month), list = studentsOf(st.cls, st.month);
    st.data = null;
    render();
    var ids = list.map(function (s) { return s.id; }), weeks = dates.map(function (d) { return d.week; });
    var q = function (cols) {
      return ids.length && weeks.length ? sb().from('entries').select(cols).in('week_start', weeks).in('student_id', ids) : Promise.resolve({ data: [] });
    };
    var ents = q('student_id,week_start,attend_status,att_material,att_makeup').then(function (r) {
      return r.error ? q('student_id,week_start,attend_status') : r;
    });
    var cards = ids.length ? sb().from('student_cards').select('student_id,start_date').in('student_id', ids).then(function (r) { return r.error ? { data: [] } : r; }, function () { return { data: [] }; }) : Promise.resolve({ data: [] });
    return Promise.all([ents, cards]).then(function (res) {
      if (run !== st.run) return;
      if (res[0].error) { st.err = res[0].error.message; render(); return; }
      var ent = {}, start = {};
      (res[0].data || []).forEach(function (x) { ent[String(x.week_start).slice(0, 10) + '|' + x.student_id] = x; });
      (res[1].data || []).forEach(function (x) { if (x.start_date) start[x.student_id] = String(x.start_date).slice(0, 10); });
      st.data = { cls: st.cls, month: st.month, dates: dates, list: list, ent: ent, start: start };
      render();
    }, function (e) { if (run === st.run) { st.err = (e && e.message) || '불러오지 못했습니다'; render(); } });
  }

  /* 칸 하나 — { k: attend | absent | late | none | future | out | pre, m, v } */
  function cellOf(d, s, D) {
    if (s.leftOn && D.date > s.leftOn) return { k: 'out' };
    if (d.start[s.id] && D.date < d.start[s.id]) return { k: 'pre' };
    if (D.date > DDay.today()) return { k: 'future' };
    var x = d.ent[D.week + '|' + s.id], v = x ? x.attend_status : '';
    if (v === 'attend' || v === 'makeup') return { k: 'attend' };
    if (v === 'absent') return { k: 'absent', m: x.att_material === false, v: x.att_makeup === false };
    if (v === 'late') return { k: 'late' };
    return { k: 'none' };
  }
  function sumOf(cells) {
    var o = { attend: 0, absent: 0, late: 0, n: 0 };
    cells.forEach(function (c) { if (c.k === 'attend' || c.k === 'absent' || c.k === 'late' || c.k === 'none') { o.n++; if (o[c.k] !== undefined) o[c.k]++; } });
    return o;
  }
  function sumText(o) { return '출석 ' + o.attend + ' · 결석 ' + o.absent + ' · 지각 ' + o.late + ' · 수업 ' + o.n + '회'; }
  var MARK = { attend: '●', absent: '결', late: '지', none: '–', future: '', out: '', pre: '' };
  var NAME = { attend: '출석', absent: '결석', late: '지각', none: '아직 안 넣음', future: '수업 전', out: '퇴원 뒤', pre: '수강 시작 전' };

  function render() {
    var h = $('#abBody');
    if (!h) return;
    if (!st.cls) { h.innerHTML = '<p class="panel__hint">반이 없습니다.</p>'; return; }
    if (st.err) { h.innerHTML = '<p class="panel__hint">불러오지 못했습니다 — ' + esc(st.err) + '</p>'; return; }
    var d = st.data;
    if (!d) { h.innerHTML = '<p class="panel__hint">불러오는 중…</p>'; return; }
    if (!d.dates.length) { h.innerHTML = '<p class="panel__hint">' + esc(d.cls) + ' · ' + (+d.month.slice(5, 7)) + '월에는 수업일이 없습니다' + (Store.schedOf(d.cls) ? '' : ' (수업 요일을 먼저 정해 주세요)') + '.</p>'; return; }
    if (!d.list.length) { h.innerHTML = '<p class="panel__hint">이 반에 학생이 없습니다.</p>'; return; }
    var tot = { attend: 0, absent: 0, late: 0, n: 0 }, col = d.dates.map(function () { return { a: 0, n: 0 }; });
    var body = d.list.map(function (s) {
      var cells = d.dates.map(function (D) { return cellOf(d, s, D); });
      var sm = sumOf(cells);
      ['attend', 'absent', 'late', 'n'].forEach(function (k) { tot[k] += sm[k]; });
      cells.forEach(function (c, i) { if (c.k === 'attend' || c.k === 'absent' || c.k === 'late' || c.k === 'none') { col[i].n++; if (c.k === 'attend' || c.k === 'late') col[i].a++; } });
      return '<tr data-sid="' + esc(s.id) + '"><th class="ab-name" scope="row"><span class="ab-name__t">' + esc(s.name) + '</span>' +
          (s.leftOn ? '<span class="ab-left">퇴원 ' + md(s.leftOn) + '</span>' : '') + '</th>' +
        cells.map(function (c, i) {
          var D = d.dates[i], can = c.k === 'attend' || c.k === 'absent' || c.k === 'late' || c.k === 'none';
          var marks = c.k === 'absent' ? (c.m ? '<i class="ab-x" title="자료 미배부">자</i>' : '') + (c.v ? '<i class="ab-x" title="보강 영상 미신청">영</i>' : '') : '';
          var lab = md(D.date) + ' ' + NAME[c.k] + (c.m ? ' · 자료 미배부' : '') + (c.v ? ' · 보강 영상 미신청' : '');
          return '<td class="ab-c ab-c--' + c.k + '">' + (can
            ? '<button type="button" class="ab-cb" data-att-open="' + esc(d.cls) + '" data-att-date="' + esc(D.date) + '" data-att-sid="' + esc(s.id) + '" title="' + esc(lab + ' · 누르면 출석 체크') + '" aria-label="' + esc(s.name + ' ' + lab) + '">' + MARK[c.k] + marks + '</button>'
            : '<span title="' + esc(lab) + '">' + MARK[c.k] + '</span>') + '</td>';
        }).join('') +
        '<td class="ab-sum num">' + sumText(sm) + '</td></tr>';
    }).join('');
    h.innerHTML = '<div class="ab-wrap"><table class="ab-table"><thead><tr><th class="ab-name" scope="col">이름</th>' +
        d.dates.map(function (D) { return '<th class="ab-d num" scope="col">' + md(D.date) + '<small>' + DOW[Lesson.dowOf(D.date)] + '</small></th>'; }).join('') +
        '<th class="ab-sum" scope="col">합계</th></tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><th class="ab-name" scope="row">반 전체</th>' + col.map(function (c) { return '<td class="ab-c ab-c--tot num">' + (c.n ? c.a + '/' + c.n : '') + '</td>'; }).join('') +
        '<td class="ab-sum num">' + sumText(tot) + '</td></tr></tfoot></table></div>' +
      '<p class="ab-total num" id="abTotal">' + esc(d.cls) + ' · ' + (+d.month.slice(5, 7)) + '월 반 전체 — ' + sumText(tot) + ' · 학생 ' + d.list.length + '명 · 수업일 ' + d.dates.length + '번</p>' +
      '<p class="panel__hint ab-legend">● 출석 · 결 결석 · 지 지각 · – 아직 안 넣음 · 회색 퇴원 뒤 / 수강 시작 전 · 날짜 아래 숫자 = 출석(지각 포함)/수업 · 칸을 누르면 그 수업 출석 체크</p>';
  }

  /* ---------- 엑셀(CSV) ---------- */
  function q(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var CSV_V = { attend: '출석', absent: '결석', late: '지각', none: '미입력', future: '', out: '퇴원', pre: '시작 전' };
  function csv() {
    var d = st.data;
    if (!d) return '';
    var rows = [['반', '이름', '수강 시작일', '퇴원일'].concat(d.dates.map(function (D) { return D.date; }), ['출석', '결석', '지각', '수업'])];
    var tot = { attend: 0, absent: 0, late: 0, n: 0 };
    d.list.forEach(function (s) {
      var cells = d.dates.map(function (D) { return cellOf(d, s, D); }), sm = sumOf(cells);
      ['attend', 'absent', 'late', 'n'].forEach(function (k) { tot[k] += sm[k]; });
      rows.push([d.cls, s.name, d.start[s.id] || '', s.leftOn || ''].concat(cells.map(function (c) {
        var extra = [c.m ? '미배부' : '', c.v ? '미신청' : ''].filter(Boolean).join('·');
        return CSV_V[c.k] + (extra ? '(' + extra + ')' : '');
      }), [sm.attend, sm.absent, sm.late, sm.n]));
    });
    rows.push([d.cls, '반 전체', '', ''].concat(d.dates.map(function () { return ''; }), [tot.attend, tot.absent, tot.late, tot.n]));
    return rows.map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }
  function download() {
    var text = csv();
    if (!text) return;
    var name = '출석부_' + st.cls + '_' + st.month + '.csv';
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    try { a.href = URL.createObjectURL(blob); } catch (e) { a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + text); }
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); try { URL.revokeObjectURL(a.href); } catch (e) {} }, 500);
    if (window.UI) UI.toast(name + ' 내려받기', 'good');
  }

  function visible() { var p = $('#panel-attbook'); return !!p && !p.hidden; }
  function init() {
    if (!$('#panel-attbook')) return;
    $('#abClass').addEventListener('change', function (e) { st.cls = e.target.value; remember(); load(); });
    $('#abMonth').addEventListener('change', function (e) { if (/^\d{4}-\d{2}$/.test(e.target.value)) { st.month = e.target.value; remember(); load(); } });
    $('#abPrev').addEventListener('click', function () { st.month = shiftMonth(st.month, -1); $('#abMonth').value = st.month; remember(); load(); });
    $('#abNext').addEventListener('click', function () { st.month = shiftMonth(st.month, 1); $('#abMonth').value = st.month; remember(); load(); });
    $('#abCsv').addEventListener('click', download);
    document.addEventListener('jt:tab', function (e) { if (e.detail.index === 8) { fillClasses(); load(); } });
    window.addEventListener('jt:attend', function () { if (visible()) load(); });
    window.addEventListener('jt:roster-changed', function () { if (visible()) { fillClasses(); load(); } });
  }
  init();

  window.Attbook = { load: load, csv: csv, state: function () { return st; }, set: function (cls, month) { if (cls) st.cls = cls; if (month) st.month = month; fillClasses(); return load(); } };
})();
