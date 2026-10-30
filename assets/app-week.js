/* ============================================================
   app-week.js — 앱 과제 · 강의를 레포트 주차의 과제 기간만 잘라 보여 준다
   (러닝노트 각 수업 레포트 · 과제 상세 탭 · 누적 추이 · 코치룸 미리보기가 같이 쓴다)

   레포트(수업일 D)의 앱 과제 = 그 수업 전 일주일 D-7 ~ D-1 (lastWeek · forLesson — 열어 보는 날과 상관없이 · 20261029h)
     예: 10/22(목) 수업 레포트 → 10/15(목) ~ 10/21(수). 전체 누적도 시작일 ~ D-1. 앱 기록이 D-1 뒤에 시작했으면 first(「첫 주라 지난 기록이 없습니다」)
     러닝노트 · 코치룸(「오늘」 · AI 초안)이 모두 이 함수를 쓴다. 지금 진행 중인 주(D ~ 다음 수업 전날)는 러닝노트 「과제 상세」 탭에서만
   app-report 함수가 넘기는 것만 쓴다:
     calendar [{ date, order(강 번호), status: onTime | late | none }]
     lectures [{ order, videosDone, videosTotal }]
     history  [{ order, submittedAt, late, correctRate }]  (예전 함수는 recent 10건만 — 그때는 그것으로)
   날마다
     과제 줄  ● 정시 · ◐ 늦게 · ○ 미제출 (그날 과제가 없으면 빈칸, 아직 오지 않은 날은 흐리게)
     강의 줄  그날 강 번호의 강의 영상을 다 봤으면 ✓, 아니면 –   (강 번호는 화면에 보여 주지 않는다)
   오른쪽에 「n/5일 제출」 · 평균 정답률, 「n/5일 시청」. 5 = 그 기간에 과제가 있었던 평일 수
   토 · 일 = 「주중 복습」 (20261030d) — 앱 기록이 없어도 늘 「주중 복습」 칸(옅은 색 · 과제 · 강의 두 줄을 한 칸으로),
     그날 앱에 제출한 기록이 있으면 「주중 복습 ✓」. 미제출로 치지 않고 제출률 · 정시율 · 강의 시청률의 분자 · 분모에서 모두 뺀다
     (compute · cumulative · 이것을 쓰는 「오늘」 앱 과제 알림 · AI 초안 수치 · 누적 추이가 모두 같이)
   과제 수정 (20261031j · migration-038) — 조교가 고친 값을 앱 기록 위에 덮는다 (withFix). 앱 기록은 바꾸지 않는다
     fix = { 'YYYY-MM-DD': onTime | late | none | exempt } — exempt(면제)는 셈에서 뺀다 (제출 수 · 과제 있던 날 모두)
     코치룸은 hwfix.js 가, 러닝노트는 hub_hw_fix 로 받은 값을 덮는다 (「수정」 표시 · 사유는 코치룸에만)
   오늘 (20261031v) — 앱 과제 · 강의 마감은 그날 밤 12시(한국 시간 · 복습테스트와 같다). 오늘은 마감 전이라
     아직 안 냈으면 분모에 넣지 않고 칸에 연하게 「오늘」 (hw · lec 'today') · 오늘 이미 냈으면(강의를 다 봤으면) 넣는다.
     예: 목 제출 · 오늘(금) 아직 → 1/1일 100%. compute · cumulative 를 쓰는 곳(러닝노트 · 레포트 · 전체 누적 · 과제 색 · 챙길 학생 · 반 평균)이 모두 같이
     today 에는 꼭 진짜 오늘을 넘긴다 (어제를 넘기면 어제가 「오늘」로 보인다)
   과제 날짜 (20261031y) — 과제 기록(history)은 「낸 날」이 아니라 「과제 날짜」로 묶는다:
     강 번호의 달력 날짜 → 과제 이름 안의 날짜(「… 10/23(금)」) → (둘 다 없으면) 낸 날(한국 날짜)
     과제 날짜 다음 날 마감을 넘겨 낸 과제(앱의 지각 표시 · 또는 다음 날보다 뒤에 냄)는 「늦게」 —
     달력이 정시로 적혀 있어도 그날 낸 과제가 모두 늦었으면 그날은 「늦게」, 달력에 없던 과제 날짜는 새 칸으로 (조교가 고친 칸은 그대로)
     compute · cumulative(제출 수 · 정시율 · 정답률 · 레포트 과제 칸 · 과제 색)와 러닝노트 「날짜별 과제」가 같은 기준 (normalize)
   신입생 (20261031q · migration-044) — data.startOn(수강 시작일)이 있으면 그 앞 날은 회색 「신입생」(hw · lec 'new')
     제출 수 · 과제 있던 날 · 누적 어디에도 세지 않는다. 기간 중간에 시작했으면 시작일부터만 (예: 2/2일) · 시작일 뒤 평일이 없으면 allNew
     그 수업 레포트 기간(D-7 ~ D-1)이 모두 시작 전이면 forLesson 의 newStudent — 「첫 수업입니다 · 다음 레포트부터 과제 기록이 보입니다」
   ============================================================ */

(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var LEGEND = '● 정시 제출 ◐ 늦게 제출 ○ 미제출 / ✓ 그날 강의 영상을 다 봄 – 아직 안 봄 / 오늘은 밤 12시 마감 전이라 아직 안 냈으면 「오늘」(세지 않음) / ' +
               '토 · 일은 주중 복습 날이라 제출 수에 넣지 않아요(앱에 제출하면 ✓). ' +
               '강의는 오늘까지 본 것을 기준으로 표시돼요. 지난 강의를 나중에 봐도 ✓로 바뀝니다.';

  function valid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /* 토 · 일 — 주중 복습 날 */
  function isWeekend(iso) { var w = new Date(String(iso).slice(0, 10) + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6; }
  /* 그날 앱에 제출한 기록이 있는지 (달력 정시 · 늦게 또는 그날 제출 시각) */
  function submittedOn(c, subDays, iso) { return !!(c && (c.status === 'onTime' || c.status === 'late')) || !!subDays[iso]; }
  function subDaysOf(data) {
    var out = {};
    ((data && (data.history || data.recent)) || []).forEach(function (h) { var x = String((h && h.submittedAt) || '').slice(0, 10); if (valid(x)) out[x] = 1; });
    return out;
  }
  /* ---------- 과제 날짜 (20261031y) ---------- */
  function kstDay(v) {
    var x = String(v || '');
    if (/T/.test(x) && /(Z|[+-]\d\d:?\d\d)$/i.test(x)) { var t = Date.parse(x); if (!isNaN(t)) return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
    return x.slice(0, 10);
  }
  /* 과제 이름 안의 날짜 「10/23(금)」 · 「10.23」 — 해는 낸 날에 맞춘다 (12월 과제를 1월에 내면 지난해) */
  var TITLE_DATE = /(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:\(\s*[월화수목금토일]\s*\))?/;
  function titleDate(title, ref) {
    var m = TITLE_DATE.exec(String(title || ''));
    if (!m) return '';
    var mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    var y = +(String(ref || '').slice(0, 4)) || new Date().getUTCFullYear(), rm = +(String(ref || '').slice(5, 7)) || mo;
    if (mo - rm > 6) y--; else if (rm - mo > 6) y++;
    var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return valid(iso) ? iso : '';
  }
  /* 과제 이름 — 앞의 [숙제인증] · 이름 안의 날짜는 칸 날짜와 겹치니 뺀다 */
  function cleanTitle(t) {
    return String(t || '').replace(/^\s*\[[^\]]{1,12}\]\s*/, '').replace(new RegExp('\\s*' + TITLE_DATE.source + '\\s*', 'g'), ' ').replace(/\s+/g, ' ').trim() || String(t || '').trim();
  }
  function orderDays(data) {
    var by = {};
    ((data && data.calendar) || []).forEach(function (c) { if (c && c.order && valid(c.date)) by[c.order] = c.date; });
    return by;
  }
  /* 과제 날짜 { date, how: 'order' | 'title' | 'sub' } */
  function hwDateOf(h, byOrder) {
    if (h && h.order && byOrder && byOrder[h.order]) return { date: byOrder[h.order], how: 'order' };
    var sub = kstDay(h && h.submittedAt), td = titleDate(h && h.title, sub);
    if (td) return { date: td, how: 'title' };
    return { date: valid(sub) ? sub : '', how: 'sub' };
  }
  /* 늦게 낸 과제 — 앱의 지각 표시 · 또는 과제 날짜 다음 날보다 뒤에 냄 */
  function lateOf(h, date) {
    if (h && h.late) return true;
    var sub = kstDay(h && h.submittedAt);
    return !!(valid(sub) && valid(date) && sub > addDays(date, 1));
  }
  /* 달력을 과제 기록에 맞춘다 — 결과는 기억해 둔다 (같은 data 를 여러 번 센다) */
  var NORM = typeof WeakMap === 'function' ? new WeakMap() : null;
  function normalize(data) {
    if (!data || data._norm || !(data.history || data.recent)) return data;
    if (NORM && NORM.has(data)) return NORM.get(data);
    var byOrder = orderDays(data), groups = {};
    (data.history || data.recent || []).forEach(function (h) {
      if (!h || !h.submittedAt) return;
      var d = hwDateOf(h, byOrder);
      if (!valid(d.date) || d.how === 'sub') return;              /* 날짜를 모르면 달력을 건드리지 않는다 */
      (groups[d.date] = groups[d.date] || []).push(h);
    });
    var cal = (data.calendar || []).map(function (c) {
      var g = c && groups[c.date];
      if (!g || c.fixed || isWeekend(c.date)) return c;
      var allLate = g.every(function (h) { return lateOf(h, c.date); });
      var st = allLate ? 'late' : 'onTime';
      if (c.status === st) return c;
      if (c.status === 'onTime' && st === 'onTime') return c;
      var x = {}; Object.keys(c).forEach(function (k) { x[k] = c[k]; });
      x.status = c.status === 'none' || c.status === 'onTime' ? st : c.status;
      return x;
    });
    var have = {};
    cal.forEach(function (c) { if (c) have[c.date] = 1; });
    Object.keys(groups).forEach(function (d) {
      if (have[d] || isWeekend(d)) return;
      var g = groups[d];
      cal.push({ date: d, order: g[0].order || 0, status: g.every(function (h) { return lateOf(h, d); }) ? 'late' : 'onTime', fromHistory: true });
    });
    var out = {};
    Object.keys(data).forEach(function (k) { out[k] = data[k]; });
    out.calendar = cal;
    out._norm = true;
    if (NORM) NORM.set(data, out);
    return out;
  }

  /* 수정값 덮기 — data 는 그대로 두고 calendar 만 새로 (그날 앱 칸이 없으면 새 칸) */
  var FIX_OK = { onTime: 1, late: 1, none: 1, exempt: 1 };
  function withFix(data, fix) {
    if (!data || !fix || typeof fix !== 'object') return data;
    var keys = Object.keys(fix).filter(function (k) { return valid(k) && FIX_OK[fix[k]]; });
    if (!keys.length) return data;
    var out = {}, seen = {};
    Object.keys(data).forEach(function (k) { out[k] = data[k]; });
    out.calendar = (data.calendar || []).map(function (c) {
      if (!c || !fix[c.date] || !FIX_OK[fix[c.date]]) return c;
      seen[c.date] = 1;
      var x = {}; Object.keys(c).forEach(function (k) { x[k] = c[k]; });
      x.status = fix[c.date];
      x.fixed = 1;                                       /* 조교가 고친 칸 — 과제 날짜 맞추기(normalize)가 건드리지 않는다 */
      return x;
    });
    keys.forEach(function (k) { if (!seen[k]) out.calendar.push({ date: k, order: 0, status: fix[k], fixed: 1 }); });
    return out;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* data = app-report 의 data · from ~ to = 과제 기간 · today = 오늘(한국 날짜) */
  function compute(data, from, to, today) {
    if (!data || !valid(from) || !valid(to) || to < from) return null;
    data = normalize(data);
    var cal = {}, lec = {}, dateOfOrder = {};
    (data.calendar || []).forEach(function (c) {
      if (!c || !valid(c.date)) return;
      cal[c.date] = c;
      if (c.order) dateOfOrder[c.order] = c.date;
    });
    (data.lectures || []).forEach(function (l) { if (l && l.order) lec[l.order] = l; });

    var days = [], hwDone = 0, hwOnTime = 0, hwDays = 0, lecDone = 0, lecDays = 0, wkDays = 0, wkDone = 0, subs = subDaysOf(data);
    var start = valid(data.startOn) ? data.startOn : '', newDays = 0;
    for (var d = from, k = 0; d <= to && k < 31; d = addDays(d, 1), k++) {
      var c = cal[d] || null;
      if (start && d < start) {
        newDays++;
        days.push({ date: d, dow: DOW[new Date(d + 'T00:00:00Z').getUTCDay()], hw: 'new', lec: 'new', weekend: isWeekend(d) });
        continue;
      }
      if (isWeekend(d)) {
        /* 토 · 일 = 주중 복습 — 세지 않는다 (제출 기록이 있으면 ✓ 만) */
        var wd = !(today && d > today) && submittedOn(c, subs, d);
        wkDays++; if (wd) wkDone++;
        days.push({ date: d, dow: DOW[new Date(d + 'T00:00:00Z').getUTCDay()], hw: wd ? 'wkDone' : 'wk', lec: 'wk', weekend: true });
        continue;
      }
      var future = !!today && d > today, isToday = !!today && d === today;
      var hw = future ? 'future' : !c ? 'off' : (c.status === 'onTime' ? 'onTime' : c.status === 'late' ? 'late' : c.status === 'exempt' ? 'exempt' : 'none');
      var L = c && c.order ? lec[c.order] : null;
      var lv = future ? 'future' : !c || !c.order || !L ? 'off' : (L.videosTotal > 0 && L.videosDone >= L.videosTotal ? 'done' : 'todo');
      /* 오늘 — 마감 전 · 아직이면 세지 않는다 (냈으면 · 다 봤으면 센다) */
      if (isToday && hw === 'none') hw = 'today';
      if (isToday && lv === 'todo') lv = 'today';
      if (hw !== 'off' && hw !== 'future' && hw !== 'exempt' && hw !== 'today') { hwDays++; if (hw === 'onTime' || hw === 'late') hwDone++; if (hw === 'onTime') hwOnTime++; }
      if (lv === 'done' || lv === 'todo') { lecDays++; if (lv === 'done') lecDone++; }
      days.push({ date: d, dow: DOW[new Date(d + 'T00:00:00Z').getUTCDay()], hw: hw, lec: lv });
    }

    /* 그 기간 과제의 평균 정답률 — 과제 날짜(강 번호의 날짜 → 과제 이름 안의 날짜 → 낸 날)로 기간 안인지 본다 */
    var rates = [];
    (data.history || data.recent || []).forEach(function (h) {
      if (!h || h.correctRate == null) return;
      var day = hwDateOf(h, dateOfOrder).date;
      if (day >= from && day <= to) rates.push(Number(h.correctRate));
    });
    var rate = rates.length ? Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length) : null;

    return { from: from, to: to, days: days, hwDone: hwDone, hwOnTime: hwOnTime, hwDays: hwDays, lecDone: lecDone, lecDays: lecDays, rate: rate,
             wkDays: wkDays, wkDone: wkDone, newDays: newDays,
             allNew: newDays > 0 && !days.some(function (x) { return x.hw !== 'new' && !x.weekend; }),
             any: hwDays > 0 || lecDays > 0 };
  }

  /* 그 수업 전 일주일 — 수업일 D → { from: D-7, to: D-1, lesson: D } */
  function lastWeek(lessonDate) {
    var d = String(lessonDate || '').slice(0, 10);
    if (!valid(d)) return null;
    return { from: addDays(d, -7), to: addDays(d, -1), lesson: d };
  }

  /* 앱 기록의 첫 날 (날짜별 기록 중 가장 이른 날) — 없으면 '' */
  function startOf(data) {
    var first = '';
    ((data && data.calendar) || []).forEach(function (c) { if (c && valid(c.date) && (!first || c.date < first)) first = c.date; });
    return first;
  }

  /* 전체 누적 — 시작일 ~ to (과제 제출 · 정시 · 강의 시청 %, 강의가 있던 날이 없으면 lec = null) · 토 · 일(주중 복습)은 세지 않는다 */
  function cumulative(data, to, today) {
    if (!data || !valid(to)) return null;
    data = normalize(data);
    var lec = {};
    (data.lectures || []).forEach(function (l) { if (l && l.order) lec[l.order] = l; });
    var days = 0, done = 0, onTime = 0, lDays = 0, lDone = 0, start = valid(data.startOn) ? data.startOn : '';
    (data.calendar || []).forEach(function (c) {
      if (!c || !valid(c.date) || c.date > to || (today && c.date > today) || isWeekend(c.date) || c.status === 'exempt' || (start && c.date < start)) return;
      var sub = c.status === 'onTime' || c.status === 'late', isToday = !!today && c.date === today;
      var L = c.order ? lec[c.order] : null, seen = !!L && L.videosTotal > 0 && L.videosDone >= L.videosTotal;
      /* 오늘 — 마감 전이라 아직이면 세지 않는다 (20261031v) */
      if (!(isToday && !sub)) {
        days++;
        if (sub) done++;
        if (c.status === 'onTime') onTime++;
      }
      if (L && !(isToday && !seen)) { lDays++; if (seen) lDone++; }
    });
    var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
    return { hw: pct(done, days), onTime: pct(onTime, days), lec: lDays ? pct(lDone, lDays) : null, days: days };
  }

  /* 레포트 한 편의 앱 과제 — 수업일 D 기준 D-7 ~ D-1 표(w) · 전체 누적(total, 시작일 ~ D-1) · 첫 주(first) */
  function forLesson(data, lessonDate, today) {
    var p = lastWeek(lessonDate);
    if (!p || !data) return null;
    var start = startOf(data);
    p.newStudent = valid(data.startOn) && data.startOn > p.to;          /* 수강 시작일 뒤 첫 레포트 (20261031q) */
    p.first = p.newStudent || !start || start > p.to;
    p.w = p.first ? null : compute(data, p.from, p.to, today);
    p.total = p.first ? null : cumulative(data, p.to, today);
    return p;
  }

  /* 누적 추이용 — 제출한 날 / 과제가 있던 날 (%) */
  /* 과제 칩 색 — 비율로 (20261031g): 100% 초록 ok · 50% 이상(60~80%) 파랑 mid · 0% 초과(20~40%) 주황 low · 0% 빨강 zero
     (5일 기준이면 5일 초록 · 3~4일 파랑 · 1~2일 주황 · 0일 빨강 — 「오늘」 · 레포트 발송 · 과제 상세가 같이) */
  function tone(done, days) { var r = days ? done / days : 0; return r >= 1 ? 'ok' : r >= 0.5 ? 'mid' : r > 0 ? 'low' : 'zero'; }
  function hwRate(w) { return w && w.hwDays ? Math.round(w.hwDone / w.hwDays * 100) : null; }

  var HW_MARK = { onTime: '●', late: '◐', none: '○', exempt: '면제', future: '·', off: '', today: '오늘' };
  var HW_TIP = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제(셈에서 뺌)', future: '아직', off: '과제 없음', wk: '주중 복습', wkDone: '주중 복습 · 제출함', today: '오늘 — 밤 12시 마감 전 (아직 세지 않음)' };
  var LEC_MARK = { done: '✓', todo: '–', future: '·', off: '', today: '오늘' };
  var LEC_TIP = { done: '강의 영상을 다 봄', todo: '아직 안 봄', future: '아직', off: '강의 없음', today: '오늘 — 아직 세지 않음' };

  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }

  /* opt.pending — 진행 중 기간: 과제 · 강의가 있는 날이 아직 없으면 「0/0일」 대신 「아직 과제 시작 전」 · 「아직 강의 전」 */
  function tableHtml(w, opt) {
    if (!w) return '';
    var pending = !!(opt && opt.pending);
    var cols = 'grid-template-columns: 30px repeat(' + w.days.length + ', minmax(0, 1fr)) auto';
    function cells(kind) {
      return w.days.map(function (d) {
        /* 토 · 일 — 과제 · 강의 두 줄을 한 칸으로 「주중 복습」(제출 기록이 있으면 ✓) · 옅은 색 */
        if (d.hw === 'new') {
          if (kind !== 'hw' && d.weekend) return '';
          return kind === 'hw' ? '<span class="aw-cell aw-new' + (d.weekend ? ' aw-wk' : '') + '" title="' + esc(md(d.date) + ' 신입생 — 수강 시작 전 (세지 않음)') + '">신입생</span>'
            : '<span class="aw-cell aw-lec aw-lec--new"><span class="aw-blank" aria-hidden="true"></span><span class="sr-only">신입생</span></span>';
        }
        if (d.weekend) {
          if (kind !== 'hw') return '';
          return '<span class="aw-cell aw-wk' + (d.hw === 'wkDone' ? ' aw-wk--done' : '') + '" title="' + esc(md(d.date) + ' ' + HW_TIP[d.hw]) + '">' +
                 '주중<br>복습' + (d.hw === 'wkDone' ? '<b> ✓</b>' : '') + '</span>';
        }
        var v = d[kind], mark = kind === 'hw' ? HW_MARK[v] : LEC_MARK[v], tip = kind === 'hw' ? HW_TIP[v] : LEC_TIP[v];
        return '<span class="aw-cell aw-' + kind + ' aw-' + kind + '--' + v + '" title="' + esc(md(d.date) + ' ' + tip) + '">' +
               (mark || '<span class="aw-blank" aria-hidden="true"></span>') + '<span class="sr-only">' + esc(tip) + '</span></span>';
      }).join('');
    }
    return '<div class="aw" role="group" aria-label="' + esc(md(w.from) + '~' + md(w.to) + ' 과제 · 강의') + '">' +
      '<div class="aw-grid" style="' + cols + '">' +
        '<span class="aw-head"></span>' +
        w.days.map(function (d) { return '<span class="aw-head aw-day"><b class="num">' + md(d.date).split('/')[1] + '</b>' + d.dow + '</span>'; }).join('') +
        '<span class="aw-head"></span>' +
        '<span class="aw-label">과제</span>' + cells('hw') +
        (w.allNew ? '<span class="aw-sum aw-sum--new">신입생</span>'
          : pending && !w.hwDays ? '<span class="aw-sum aw-sum--wait">아직 과제 시작 전</span>'
          : '<span class="aw-sum aw-sum--' + tone(w.hwDone, w.hwDays) + ' num">' + w.hwDone + '/' + w.hwDays + '일 제출' + (w.rate != null ? '<small>정답률 ' + w.rate + '%</small>' : '') + '</span>') +
        '<span class="aw-label">강의</span>' + cells('lec') +
        (w.allNew ? '<span class="aw-sum aw-sum--new">신입생</span>'
          : pending && !w.lecDays ? '<span class="aw-sum aw-sum--wait">아직 강의 전</span>'
          : '<span class="aw-sum num">' + w.lecDone + '/' + w.lecDays + '일 시청</span>') +
      '</div>' +
      '<p class="aw-legend">' + esc(LEGEND + (w.days.some(function (d) { return d.hw === 'exempt'; }) ? ' 「면제」인 날은 제출 수에 넣지 않아요.' : '')) + '</p>' +
    '</div>';
  }

  global.AppWeek = { compute: compute, tableHtml: tableHtml, hwRate: hwRate, tone: tone, LEGEND: LEGEND, HW_MARK: HW_MARK, HW_TIP: HW_TIP,
                     lastWeek: lastWeek, startOf: startOf, cumulative: cumulative, forLesson: forLesson,
                     isWeekend: isWeekend, subDaysOf: subDaysOf, withFix: withFix,
                     normalize: normalize, hwDateOf: hwDateOf, orderDays: orderDays, lateOf: lateOf, cleanTitle: cleanTitle, kstDay: kstDay, titleDate: titleDate };

})(window);
