/* ============================================================
   dday.js — 주요 시험 D-day (생성기 · 개인 페이지 · 반 공지 페이지가 같이 쓴다)

   날짜는 언제나 한국 시간(Asia/Seoul) 기준이다. 자정이 지나면 하루가 줄어든다.
   어느 시험을 띄울지 고르는 규칙은 supabase/migration-005-exams.sql 의
   _exam_for_class 와 같다:
     반별로 고른 시험 → 없으면 전체 기본(고정이면 그 시험)
     → 그 시험이 지났거나 없으면 가장 가까운 다음 시험
     → 다가오는 시험이 하나도 없으면 띄우지 않는다
   ============================================================ */

(function (global) {
  'use strict';

  var DAY = 86400000;
  var KST = 9 * 3600000;          /* 한국은 서머타임이 없다 */

  function pad(n) { return String(n).padStart(2, '0'); }

  /* 오늘 (한국 날짜) 'YYYY-MM-DD' */
  function today() {
    var d = new Date(Date.now() + KST);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  function toUTC(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  /* 오늘부터 그 날까지 남은 날 (당일 0, 지났으면 음수) */
  function daysUntil(dateISO, todayISO) {
    if (!validDate(dateISO)) return null;
    return Math.round((toUTC(dateISO) - toUTC(todayISO || today())) / DAY);
  }

  /* 다가오는 시험 (가까운 순) */
  function upcoming(cfg, todayISO) {
    var t = todayISO || today();
    return ((cfg && cfg.exams) || []).filter(function (e) {
      return e && String(e.name || '').trim() && validDate(e.date) && e.date >= t;
    }).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name), 'ko');
    });
  }

  /* 그 반(없으면 전체)에 띄울 시험 하나 */
  function pick(cfg, className, todayISO) {
    var list = upcoming(cfg, todayISO);
    if (!list.length) return null;
    var id = (cfg.byClass && className && cfg.byClass[className]) || '';
    if (!id && cfg.mode === 'fixed') id = cfg.fixedId || '';
    var hit = id && list.find(function (e) { return e.id === id; });
    return hit || list[0];
  }

  /* 'D-12' · 'D-day' */
  function badge(exam, todayISO) {
    var n = daysUntil(exam && exam.date, todayISO);
    if (n === null || n < 0) return '';
    return n === 0 ? 'D-day' : 'D-' + n;
  }

  /* 문장. 당일은 '○○ 당일입니다. 모두 화이팅!' */
  function sentence(exam, todayISO, tail) {
    var n = daysUntil(exam && exam.date, todayISO);
    if (n === null || n < 0) return '';
    if (n === 0) return exam.name + ' 당일입니다. 모두 화이팅!';
    return exam.name + '까지 D-' + n + (tail || '');
  }

  /* 한국 시간 자정마다 부른다 (켜 둔 화면의 D-day 를 하루씩 줄인다) */
  function everyMidnight(fn) {
    function next() {
      var now = Date.now() + KST;
      var wait = DAY - (now % DAY) + 2000;
      setTimeout(function () {
        try { fn(); } catch (e) { console.error(e); }
        next();
      }, wait);
    }
    next();
  }

  global.DDay = {
    today: today, daysUntil: daysUntil, upcoming: upcoming, pick: pick,
    badge: badge, sentence: sentence, everyMidnight: everyMidnight
  };

})(window);
