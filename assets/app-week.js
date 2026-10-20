/* ============================================================
   app-week.js — 앱 과제 · 강의를 레포트 주차의 과제 기간만 잘라 보여 준다
   (러닝노트 「이번 주」 카드 · 각 주차 레포트 · 앱 과제 탭 · 누적 추이 · 코치룸 미리보기가 같이 쓴다)

   과제 기간 = 지난 수업일 ~ 이번 수업일 전날 (assets/lesson.js 계산 그대로 — 레포트에는 hwFrom · hwTo 로 저장돼 있다)
   app-report 함수가 넘기는 것만 쓴다:
     calendar [{ date, order(강 번호), status: onTime | late | none }]
     lectures [{ order, videosDone, videosTotal }]
     history  [{ order, submittedAt, late, correctRate }]  (예전 함수는 recent 10건만 — 그때는 그것으로)
   날마다
     과제 줄  ● 정시 · ◐ 늦게 · ○ 미제출 (그날 과제가 없으면 빈칸, 아직 오지 않은 날은 흐리게)
     강의 줄  그날 강 번호의 강의 영상을 다 봤으면 ✓, 아니면 –   (강 번호는 화면에 보여 주지 않는다)
   오른쪽에 「n/7일 제출」 · 평균 정답률, 「n/7일 시청」. 7 = 그 기간에 과제가 있었던 날 수(보통 7일)
   ============================================================ */

(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var LEGEND = '● 정시 제출 ◐ 늦게 제출 ○ 미제출 / ✓ 그날 강의 영상을 다 봄 – 아직 안 봄 / ' +
               '강의는 오늘까지 본 것을 기준으로 표시돼요. 지난 강의를 나중에 봐도 ✓로 바뀝니다.';

  function valid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
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

    var days = [], hwDone = 0, hwDays = 0, lecDone = 0, lecDays = 0;
    for (var d = from, k = 0; d <= to && k < 31; d = addDays(d, 1), k++) {
      var c = cal[d] || null;
      var future = !!today && d > today;
      var hw = future ? 'future' : !c ? 'off' : (c.status === 'onTime' ? 'onTime' : c.status === 'late' ? 'late' : 'none');
      var L = c && c.order ? lec[c.order] : null;
      var lv = future ? 'future' : !c || !c.order || !L ? 'off' : (L.videosTotal > 0 && L.videosDone >= L.videosTotal ? 'done' : 'todo');
      if (hw !== 'off' && hw !== 'future') { hwDays++; if (hw === 'onTime' || hw === 'late') hwDone++; }
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

    return { from: from, to: to, days: days, hwDone: hwDone, hwDays: hwDays, lecDone: lecDone, lecDays: lecDays, rate: rate,
             any: hwDays > 0 || lecDays > 0 };
  }

  /* 누적 추이용 — 제출한 날 / 과제가 있던 날 (%) */
  function hwRate(w) { return w && w.hwDays ? Math.round(w.hwDone / w.hwDays * 100) : null; }

  var HW_MARK = { onTime: '●', late: '◐', none: '○', future: '·', off: '' };
  var HW_TIP = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', future: '아직', off: '과제 없음' };
  var LEC_MARK = { done: '✓', todo: '–', future: '·', off: '' };
  var LEC_TIP = { done: '강의 영상을 다 봄', todo: '아직 안 봄', future: '아직', off: '강의 없음' };

  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }

  function tableHtml(w) {
    if (!w) return '';
    var cols = 'grid-template-columns: 30px repeat(' + w.days.length + ', minmax(0, 1fr)) auto';
    function cells(kind) {
      return w.days.map(function (d) {
        var v = d[kind], mark = kind === 'hw' ? HW_MARK[v] : LEC_MARK[v], tip = kind === 'hw' ? HW_TIP[v] : LEC_TIP[v];
        return '<span class="aw-cell aw-' + kind + ' aw-' + kind + '--' + v + '" title="' + esc(md(d.date) + ' ' + tip) + '">' +
               (mark || '<span class="aw-blank" aria-hidden="true"></span>') + '<span class="sr-only">' + esc(tip) + '</span></span>';
      }).join('');
    }
    return '<div class="aw" role="group" aria-label="' + esc(md(w.from) + '~' + md(w.to) + ' 앱 과제 · 강의') + '">' +
      '<div class="aw-grid" style="' + cols + '">' +
        '<span class="aw-head"></span>' +
        w.days.map(function (d) { return '<span class="aw-head aw-day"><b class="num">' + md(d.date).split('/')[1] + '</b>' + d.dow + '</span>'; }).join('') +
        '<span class="aw-head"></span>' +
        '<span class="aw-label">과제</span>' + cells('hw') +
        '<span class="aw-sum num">' + w.hwDone + '/' + w.hwDays + '일 제출' + (w.rate != null ? '<small>정답률 ' + w.rate + '%</small>' : '') + '</span>' +
        '<span class="aw-label">강의</span>' + cells('lec') +
        '<span class="aw-sum num">' + w.lecDone + '/' + w.lecDays + '일 시청</span>' +
      '</div>' +
      '<p class="aw-legend">' + esc(LEGEND) + '</p>' +
    '</div>';
  }

  global.AppWeek = { compute: compute, tableHtml: tableHtml, hwRate: hwRate, LEGEND: LEGEND };

})(window);
