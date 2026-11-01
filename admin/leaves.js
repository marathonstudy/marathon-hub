/* ============================================================
   leaves.js — 더보기 「퇴원 기록」 (20261101s · migration-062)

   기간(이번 달 · 지난달 · 최근 3개월 · 올해 · 전체)마다 퇴원한 학생 — 반 · 이름 · 마지막 수업일 · 사유
     퇴원일 = students.left_on (상담 카드 [퇴원 처리]) · 사유 = 그 퇴원의 상담 기록 「퇴원」(leave_on · leave_reasons)
     사유 기록이 없으면 「사유 없음」 — 이름을 누르면 상담 카드(「퇴원 사유 넣기」)
   맨 위 사유별 몇 명인지 숫자만 (한 학생이 사유 둘이면 둘 다 센다) · 「사유 없음 n명」
   운영진 화면에만 있다 (학생 · 학부모 화면 · 문자에는 나오지 않는다)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function today() { return window.DDay ? DDay.today() : Store.toISO(new Date()); }
  var REASONS = ['일정', '다른 학원', '성적', '거리·이사', '비용', '개인 사정', '기타'];
  var RANGES = [['month', '이번 달'], ['last', '지난달'], ['q', '최근 3개월'], ['year', '올해'], ['all', '전체']];
  var st = { range: 'q', notes: null, err: '' };

  function rangeOf(k) {
    var t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7);
    var iso = function (yy, mm, dd) { return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0'); };
    var endOf = function (yy, mm) { return iso(yy, mm, new Date(Date.UTC(yy, mm, 0)).getUTCDate()); };
    if (k === 'month') return [iso(y, m, 1), endOf(y, m)];
    if (k === 'last') { var ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [iso(ly, lm, 1), endOf(ly, lm)]; }
    if (k === 'q') { var qm = m - 2, qy = y; if (qm < 1) { qm += 12; qy -= 1; } return [iso(qy, qm, 1), endOf(y, m)]; }
    if (k === 'year') return [iso(y, 1, 1), iso(y, 12, 31)];
    return ['2000-01-01', '2999-12-31'];
  }
  function load() {
    st.notes = null; st.err = '';
    paint();
    return Promise.resolve(sb().from('student_notes').select('*').gte('leave_on', '2000-01-01').is('deleted_at', null)).then(function (r) {
      if (r.error) { st.err = /leave_on|schema cache|does not exist/i.test(r.error.message || '') ? 'migration-062 SQL 을 먼저 실행해 주세요 (퇴원 사유)' : r.error.message; st.notes = []; }
      else st.notes = (r.data || []).filter(function (n) { return (n.categories || []).indexOf('퇴원') !== -1; });
      paint();
    }, function (e) { st.err = (e && e.message) || '불러오지 못했습니다'; st.notes = []; paint(); });
  }
  /* 기간 안 퇴원 학생 + 그 퇴원의 사유 (가장 최근 기록) */
  function rows() {
    var rg = rangeOf(st.range), by = {};
    (st.notes || []).forEach(function (n) {
      var k = n.student_id + '|' + String(n.leave_on).slice(0, 10);
      if (!by[k] || String(n.created_at) > String(by[k].created_at)) by[k] = n;
    });
    return (Store.getStudents() || []).filter(function (s) { return s.leftOn && s.leftOn >= rg[0] && s.leftOn <= rg[1]; }).map(function (s) {
      var n = by[s.id + '|' + s.leftOn];
      return { s: s, day: s.leftOn, reasons: n ? (n.leave_reasons || []) : [], memo: n ? memoOf(n) : '', who: n ? n.author_name || '' : '' };
    }).sort(function (a, b) { return a.day !== b.day ? (a.day < b.day ? 1 : -1) : String(a.s.name).localeCompare(String(b.s.name), 'ko'); });
  }
  function memoOf(n) { var p = '사유: ' + (n.leave_reasons || []).join(', ') + ' · ', b = String(n.body || ''), i = b.indexOf(p); return i === -1 ? '' : b.slice(i + p.length); }
  function bodyHtml() {
    var h = '<div class="lv-ranges" role="group" aria-label="기간">' + RANGES.map(function (r) {
      return '<button type="button" class="lv-range' + (st.range === r[0] ? ' is-on' : '') + '" data-lv-range="' + r[0] + '" aria-pressed="' + (st.range === r[0]) + '">' + r[1] + '</button>';
    }).join('') + '</div>';
    if (st.err) h += '<p class="lv-err" role="alert">' + esc(st.err) + '</p>';
    if (st.notes === null) return h + '<p class="lv-loading">불러오는 중…</p>';
    var list = rows(), cnt = {}, none = 0;
    list.forEach(function (x) { if (!x.reasons.length) none++; x.reasons.forEach(function (r) { cnt[r] = (cnt[r] || 0) + 1; }); });
    var rg = rangeOf(st.range);
    h += '<p class="lv-sum num">' + (st.range === 'all' ? '전체' : esc(rg[0].slice(5).replace('-', '/') + ' ~ ' + rg[1].slice(5).replace('-', '/'))) + ' · 퇴원 <b>' + list.length + '명</b></p>';
    if (list.length) h += '<ul class="lv-counts">' + REASONS.filter(function (r) { return cnt[r]; }).map(function (r) {
      return '<li data-lv-count="' + esc(r) + '"><span>' + esc(r) + '</span><b class="num">' + cnt[r] + '명</b></li>';
    }).join('') + (none ? '<li class="is-none" data-lv-count=""><span>사유 없음</span><b class="num">' + none + '명</b></li>' : '') + '</ul>';
    if (!list.length) return h + '<p class="lv-empty">이 기간에 퇴원한 학생이 없습니다</p>';
    h += '<ol class="lv-list">' + list.map(function (x) {
      return '<li class="lv-row" data-lv-sid="' + esc(x.s.id) + '"><span class="lv-cls">' + esc(x.s.className || '(반 없음)') + '</span>' +
        '<button type="button" class="lv-name" data-lv-card="' + esc(x.s.id) + '">' + esc(x.s.name) + '</button>' +
        '<span class="lv-day num">' + esc(Store.dateWithDow ? Store.dateWithDow(x.day) : x.day) + '</span>' +
        '<span class="lv-why">' + (x.reasons.length ? esc(x.reasons.join(', ')) + (x.memo ? '<small> · ' + esc(x.memo) + '</small>' : '') : '<small class="lv-noreason">사유 없음</small>') + '</span></li>';
    }).join('') + '</ol>';
    return h + '<p class="lv-note">사유 · 메모는 운영진만 봅니다. 사유가 없는 학생은 이름 → 상담 카드에서 「퇴원 사유 넣기」.</p>';
  }
  function modal() {
    var m = document.getElementById('lvModal');
    if (m) return m;
    m = document.createElement('dialog');
    m.className = 'modal lv-modal'; m.id = 'lvModal'; m.setAttribute('aria-labelledby', 'lvTitle');
    m.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="lvTitle">퇴원 기록</h2><button class="btn btn--sm" type="button" id="lvClose">닫기</button></div><div class="modal__body" id="lvBody"></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var t = e.target, b;
      if (t.id === 'lvClose') { m.close(); return; }
      if ((b = t.closest('[data-lv-range]'))) { st.range = b.dataset.lvRange; paint(); return; }
      if ((b = t.closest('[data-lv-card]'))) { var sid = b.dataset.lvCard; m.close(); if (window.Card && Card.open) setTimeout(function () { Card.open(sid); }, 60); }
    });
    return m;
  }
  function paint() { var b = document.getElementById('lvBody'); if (b) b.innerHTML = bodyHtml(); }
  function open() {
    var m = modal();
    if (!m.open) m.showModal();
    load();
  }
  window.addEventListener('jt:roster-changed', function () { var m = document.getElementById('lvModal'); if (m && m.open) load(); });

  window.Leaves = { open: open, rangeOf: rangeOf, REASONS: REASONS };
})();
