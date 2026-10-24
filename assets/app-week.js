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
   ============================================================ */

(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var LEGEND = '● 정시 제출 ◐ 늦게 제출 ○ 미제출 / ✓ 그날 강의 영상을 다 봄 – 아직 안 봄 / ' +
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
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* data = app-report 의 data · from ~ to = 과제 기간 · today = 오늘(한국 날짜) */
  function compute(data, from, to, today) {
    if (!data || !valid(from) || !valid(to) || to < from) return null;
    var cal = {}, lec = {}, dateOfOrder = {};
    (data.calendar || []).forEach(function (c) {
      if (!c || !valid(c.date)) return;
      cal[c.date] = c;
      if (c.order) dateOfOrder[c.order] = c.date;
    });
    (data.lectures || []).forEach(function (l) { if (l && l.order) lec[l.order] = l; });

    var days = [], hwDone = 0, hwOnTime = 0, hwDays = 0, lecDone = 0, lecDays = 0, wkDays = 0, wkDone = 0, subs = subDaysOf(data);
    for (var d = from, k = 0; d <= to && k < 31; d = addDays(d, 1), k++) {
      var c = cal[d] || null;
      if (isWeekend(d)) {
        /* 토 · 일 = 주중 복습 — 세지 않는다 (제출 기록이 있으면 ✓ 만) */
        var wd = !(today && d > today) && submittedOn(c, subs, d);
        wkDays++; if (wd) wkDone++;
        days.push({ date: d, dow: DOW[new Date(d + 'T00:00:00Z').getUTCDay()], hw: wd ? 'wkDone' : 'wk', lec: 'wk', weekend: true });
        continue;
      }
      var future = !!today && d > today;
      var hw = future ? 'future' : !c ? 'off' : (c.status === 'onTime' ? 'onTime' : c.status === 'late' ? 'late' : 'none');
      var L = c && c.order ? lec[c.order] : null;
      var lv = future ? 'future' : !c || !c.order || !L ? 'off' : (L.videosTotal > 0 && L.videosDone >= L.videosTotal ? 'done' : 'todo');
      if (hw !== 'off' && hw !== 'future') { hwDays++; if (hw === 'onTime' || hw === 'late') hwDone++; if (hw === 'onTime') hwOnTime++; }
      if (lv === 'done' || lv === 'todo') { lecDays++; if (lv === 'done') lecDone++; }
      days.push({ date: d, dow: DOW[new Date(d + 'T00:00:00Z').getUTCDay()], hw: hw, lec: lv });
    }

    /* 그 기간 과제의 평균 정답률 — 강 번호의 날짜(없으면 제출한 날)로 기간 안인지 본다 */
    var rates = [];
    (data.history || data.recent || []).forEach(function (h) {
      if (!h || h.correctRate == null) return;
      var day = (h.order && dateOfOrder[h.order]) || String(h.submittedAt || '').slice(0, 10);
      if (day >= from && day <= to) rates.push(Number(h.correctRate));
    });
    var rate = rates.length ? Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length) : null;

    return { from: from, to: to, days: days, hwDone: hwDone, hwOnTime: hwOnTime, hwDays: hwDays, lecDone: lecDone, lecDays: lecDays, rate: rate,
             wkDays: wkDays, wkDone: wkDone,
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
    var lec = {};
    (data.lectures || []).forEach(function (l) { if (l && l.order) lec[l.order] = l; });
    var days = 0, done = 0, onTime = 0, lDays = 0, lDone = 0;
    (data.calendar || []).forEach(function (c) {
      if (!c || !valid(c.date) || c.date > to || (today && c.date > today) || isWeekend(c.date)) return;
      days++;
      if (c.status === 'onTime' || c.status === 'late') done++;
      if (c.status === 'onTime') onTime++;
      var L = c.order ? lec[c.order] : null;
      if (L) { lDays++; if (L.videosTotal > 0 && L.videosDone >= L.videosTotal) lDone++; }
    });
    var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
    return { hw: pct(done, days), onTime: pct(onTime, days), lec: lDays ? pct(lDone, lDays) : null, days: days };
  }

  /* 레포트 한 편의 앱 과제 — 수업일 D 기준 D-7 ~ D-1 표(w) · 전체 누적(total, 시작일 ~ D-1) · 첫 주(first) */
  function forLesson(data, lessonDate, today) {
    var p = lastWeek(lessonDate);
    if (!p || !data) return null;
    var start = startOf(data);
    p.first = !start || start > p.to;
    p.w = p.first ? null : compute(data, p.from, p.to, today);
    p.total = p.first ? null : cumulative(data, p.to, today);
    return p;
  }

  /* 누적 추이용 — 제출한 날 / 과제가 있던 날 (%) */
  /* 과제 칩 색 — 비율로 (20261031g): 100% 초록 ok · 50% 이상(60~80%) 파랑 mid · 0% 초과(20~40%) 주황 low · 0% 빨강 zero
     (5일 기준이면 5일 초록 · 3~4일 파랑 · 1~2일 주황 · 0일 빨강 — 「오늘」 · 레포트 발송 · 과제 상세가 같이) */
  function tone(done, days) { var r = days ? done / days : 0; return r >= 1 ? 'ok' : r >= 0.5 ? 'mid' : r > 0 ? 'low' : 'zero'; }
  function hwRate(w) { return w && w.hwDays ? Math.round(w.hwDone / w.hwDays * 100) : null; }

  var HW_MARK = { onTime: '●', late: '◐', none: '○', future: '·', off: '' };
  var HW_TIP = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', future: '아직', off: '과제 없음', wk: '주중 복습', wkDone: '주중 복습 · 제출함' };
  var LEC_MARK = { done: '✓', todo: '–', future: '·', off: '' };
  var LEC_TIP = { done: '강의 영상을 다 봄', todo: '아직 안 봄', future: '아직', off: '강의 없음' };

  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }

  /* opt.pending — 진행 중 기간: 과제 · 강의가 있는 날이 아직 없으면 「0/0일」 대신 「아직 과제 시작 전」 · 「아직 강의 전」 */
  function tableHtml(w, opt) {
    if (!w) return '';
    var pending = !!(opt && opt.pending);
    var cols = 'grid-template-columns: 30px repeat(' + w.days.length + ', minmax(0, 1fr)) auto';
    function cells(kind) {
      return w.days.map(function (d) {
        /* 토 · 일 — 과제 · 강의 두 줄을 한 칸으로 「주중 복습」(제출 기록이 있으면 ✓) · 옅은 색 */
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
        (pending && !w.hwDays ? '<span class="aw-sum aw-sum--wait">아직 과제 시작 전</span>'
          : '<span class="aw-sum aw-sum--' + tone(w.hwDone, w.hwDays) + ' num">' + w.hwDone + '/' + w.hwDays + '일 제출' + (w.rate != null ? '<small>정답률 ' + w.rate + '%</small>' : '') + '</span>') +
        '<span class="aw-label">강의</span>' + cells('lec') +
        (pending && !w.lecDays ? '<span class="aw-sum aw-sum--wait">아직 강의 전</span>'
          : '<span class="aw-sum num">' + w.lecDone + '/' + w.lecDays + '일 시청</span>') +
      '</div>' +
      '<p class="aw-legend">' + esc(LEGEND) + '</p>' +
    '</div>';
  }

  global.AppWeek = { compute: compute, tableHtml: tableHtml, hwRate: hwRate, tone: tone, LEGEND: LEGEND,
                     lastWeek: lastWeek, startOf: startOf, cumulative: cumulative, forLesson: forLesson,
                     isWeekend: isWeekend, subDaysOf: subDaysOf };

})(window);
