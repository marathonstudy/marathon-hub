/* ============================================================
   badges.js — 코치룸 배지 표시 (20261108j · migration-078)
     반 카드 학생 줄 이름 옆 작게 「⭐6」 (퍼펙트 배지 수 · staff_badge_counts · 30초 기억)
     학생 상세(상담 카드) 이름 옆 「⭐ 퍼펙트 6개 · 🏅 루틴 배지 2개(10월 · 9월) · 3주 연속」 (staff_badges)
   078 전이면 아무것도 안 보인다.
   ============================================================ */
(function () {
  'use strict';

  function sb() { return window.SB && SB.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function missing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var st = { c: null, at: 0, off: false, busy: null };
  function load(force) {
    if (st.off || !sb()) return Promise.resolve(null);
    if (!force && st.c && Date.now() - st.at < 30000) return Promise.resolve(st.c);
    if (st.busy) return st.busy;
    st.busy = Promise.resolve(sb().rpc('staff_badge_counts')).then(function (r) {
      st.busy = null;
      if (r.error) { if (missing(r.error)) st.off = true; return null; }
      st.c = r.data || {}; st.at = Date.now();
      paintTags();
      return st.c;
    }, function () { st.busy = null; return null; });
    return st.busy;
  }
  function textOf(sid) { var x = st.c && st.c[sid]; return x && x.p > 0 ? '⭐' + x.p : ''; }
  function titleOf(sid) { var x = st.c && st.c[sid]; return x ? '퍼펙트 배지 ' + (x.p || 0) + '개' + (x.m ? ' · 루틴 배지 ' + x.m + '개' : '') : ''; }
  /* 반 카드 이름 옆 — 처음 그릴 때 값이 없어도 자리만 두고, 불러오면 채운다 */
  function tag(sid) {
    if (st.off) return '';
    if (!st.c) load();
    return '<span class="bdg-tag num" data-bdg-tag="' + esc(sid) + '" title="' + esc(titleOf(sid)) + '">' + esc(textOf(sid)) + '</span>';
  }
  function paintTags() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bdg-tag]'), function (el) {
      var sid = el.getAttribute('data-bdg-tag'), t = textOf(sid);
      if (el.textContent !== t) el.textContent = t;
      el.title = titleOf(sid);
    });
  }
  /* 학생 상세 한 줄 */
  function paintCard(sid) {
    var el = document.getElementById('cardBadges');
    if (!el) return;
    el.textContent = '';
    if (st.off || !sb() || !sid) return;
    Promise.resolve(sb().rpc('staff_badges', { p_student: sid })).then(function (r) {
      if (r.error) { if (missing(r.error)) st.off = true; return; }
      var v = r.data, cur = document.getElementById('cardBadges');
      if (!cur || !v || (!v.perfect && !(v.months || []).length)) return;
      if (window.Card && Card.sid && Card.sid() && Card.sid() !== sid) return;
      cur.textContent = window.BadgeView ? BadgeView.lineText(v) : '';
    }, function () {});
  }

  window.addEventListener('jt:loaded', function () { load(true); });
  window.addEventListener('jt:remote', function (e) {
    var t = e.detail && e.detail.table;
    if (t === 'hw_weeks' || t === 'routine_awards' || t === '*') load(true);
  });

  window.Badges = { load: load, tag: tag, paintTags: paintTags, paintCard: paintCard, counts: function () { return st.c; } };
})();
