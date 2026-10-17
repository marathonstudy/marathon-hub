/* ============================================================
   lesson.js — 수업일 · 과제 기간 계산 (코치룸 · 러닝노트 · 반 공지가 같이 쓴다)

   반마다 한 번 정한 것
     dow    기준 요일 (레포트에 적히는 수업일) 0=일 1=월 … 6=토
     extra  추가 요일 [..] (주 2회 반. 없으면 [])
     first  첫 수업일 'YYYY-MM-DD' (없으면 '')
     weeks  그 주만 바꾼 것 { 'YYYY-MM-DD'(주차 시작일): { date, canceled, note } }

   주차 = ② 작성의 시작일 ~ 시작일+6일. 그 안에서 기준 요일인 날이 그 주 수업일.
   과제 기간 = 지난 수업일 ~ 이번 수업일 하루 전  (예: 10/15(목) 수업 → 10/8(목) ~ 10/14(수))
     지난주 수업일을 모르면(휴강 · 첫 주 이전) 수업일 7일 전부터.
     첫 수업일 그 주에는 과제 기간이 없다.

   Lesson.of(일정, 주차시작일) → null (요일 미설정 · 첫 수업 전 주)
                                 | { date, days[], hwFrom, hwTo, canceled, moved, note }
   Lesson.line(결과)          → "수업일 10/15(목) · 과제 기간 10/8~10/14"
   ============================================================ */

(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function valid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function dowOf(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }

  /* 'YYYY-MM-DD' → '10/15(목)' */
  function md(iso, withDow) {
    if (!valid(iso)) return '';
    var s = (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));
    return withDow === false ? s : s + '(' + DOW[dowOf(iso)] + ')';
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return (n >= 0 && n <= 6 && Math.round(n) === n) ? n : null;
  }

  /* 서버 모양(classes 줄 · hub_get 의 schedule) → 계산용 모양 */
  function normalize(s) {
    if (!s) return null;
    var dow = num(s.dow !== undefined ? s.dow : s.lesson_dow);
    if (dow === null) return null;
    var extra = (s.extra || s.extra_dows || []).map(num)
      .filter(function (d, i, a) { return d !== null && d !== dow && a.indexOf(d) === i; })
      .sort();
    var weeks = {};
    var src = s.weeks || {};
    if (Array.isArray(src)) {
      src.forEach(function (w) { if (w && valid(w.week_start)) weeks[w.week_start] = w; });
    } else {
      Object.keys(src).forEach(function (k) { weeks[k] = src[k]; });
    }
    var first = s.first !== undefined ? s.first : s.first_lesson;
    return { _n: true, dow: dow, extra: extra, first: valid(first) ? String(first).slice(0, 10) : '', weeks: weeks };
  }

  /* 주차 안에서 그 요일인 날 (주차시작일 ~ +6일) */
  function dayIn(weekStart, dow) {
    return addDays(weekStart, (dow - dowOf(weekStart) + 7) % 7);
  }

  /* 그 주 기준 수업일 — 바꾼 날 우선, 휴강이면 '' , 첫 수업 전이면 '' */
  function baseDate(s, weekStart) {
    var o = s.weeks[weekStart];
    if (o && o.canceled) return '';
    if (o && valid(o.lesson_date || o.date)) return String(o.lesson_date || o.date).slice(0, 10);
    var d = dayIn(weekStart, s.dow);
    if (s.first && d < s.first) return '';
    return d;
  }

  function of(sched, weekStart) {
    var s = sched && sched._n ? sched : normalize(sched);
    if (!s || !valid(weekStart)) return null;
    var end = addDays(weekStart, 6);
    if (s.first && end < s.first) return null;              /* 첫 수업 전 주 — 예전처럼 기간만 */

    var o = s.weeks[weekStart] || null;
    var note = o ? String(o.note || '').trim() : '';
    if (o && o.canceled) {
      return { date: '', days: [], hwFrom: '', hwTo: '', canceled: true, moved: false, note: note };
    }

    var date = baseDate(s, weekStart);
    var days = date ? [date] : [];
    s.extra.forEach(function (d) {
      var x = dayIn(weekStart, d);
      if ((!s.first || x >= s.first) && days.indexOf(x) === -1) days.push(x);
    });
    days.sort();
    if (!date) {
      if (!days.length) return null;
      date = days[days.length - 1];                         /* 첫 주에 추가 요일만 있으면 그날 */
    }

    var hwFrom = '', hwTo = '';
    if (!(s.first && date <= s.first)) {
      var prev = baseDate(s, addDays(weekStart, -7));
      hwFrom = (prev && prev < date) ? prev : addDays(date, -7);
      hwTo = addDays(date, -1);
      if (hwTo < hwFrom) { hwFrom = ''; hwTo = ''; }
    }

    return {
      date: date, days: days, hwFrom: hwFrom, hwTo: hwTo,
      canceled: false, moved: !!(o && valid(o.lesson_date || o.date)), note: note
    };
  }

  /* "수업일 10/15(목) · 과제 기간 10/8~10/14"  (주 2회: "수업일 10/13(화) · 10/15(목) · …") */
  function line(L) {
    if (!L) return '';
    if (L.canceled) return '이번 주 휴강' + (L.note ? ' · ' + L.note : '');
    var days = (L.days && L.days.length ? L.days : [L.date]).map(function (d) { return md(d); }).join(' · ');
    return '수업일 ' + days +
      (L.hwFrom && L.hwTo ? ' · 과제 기간 ' + md(L.hwFrom, false) + '~' + md(L.hwTo, false) : '');
  }

  /* 레포트 데이터에 넣는 칸 (저장된 레포트는 그대로 — 새로 공개하는 레포트에만 들어간다) */
  function reportFields(L) {
    if (!L || L.canceled || !L.date) return {};
    return { lessonDate: L.date, lessonDays: (L.days || []).slice(), hwFrom: L.hwFrom || '', hwTo: L.hwTo || '' };
  }

  global.Lesson = {
    DOW: DOW, of: of, line: line, md: md, normalize: normalize,
    reportFields: reportFields, addDays: addDays, dowOf: dowOf
  };

})(window);
