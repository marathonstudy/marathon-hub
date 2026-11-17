/* ============================================================
   online-run.js — 온라인 마라톤 「1일 1지문 1코칭」 구간 완주 (20261117a)

   이미 받아 둔 앱 기록(app_records — 날짜별 제출 calendar · 과제 history · 강별 영상 lectures)만 쓴다. 앱 · 앱 DB 는 건드리지 않는다.
   러닝노트(온라인 반 학생 홈 · 완주 달력 · 기록 탭) · 코치룸(학생 카드 · 반 구간 완주 표)이 같은 계산을 쓴다.

   규칙
     · 클래스 = 매월 1일 ~ 말일. 일차 = 평일. 토 · 일은 어휘테스트 · 모의고사 자율 과제라 일차에서 뺀다
       단, 앱 기록에 주말 날짜가 일차(강 번호)로 잡혀 있으면 앱 기준으로 일차에 넣는다
       앱 기록이 있는 달은 앱 날짜를 일차로(앱에 없는 평일은 그 달 지문이 없던 날) · 마지막 앱 날짜 뒤 평일은 「아직 안 옴」
     · 하루 인정 = 과제 24시간 안 인증(앱 onTime) + 데일리 영상 70% 이상 + 데일리 퀴즈 정답 제출
       지금 앱 기록에는 날짜별 영상 시청률 · 퀴즈 제출 칸이 없다 → 그 둘은 판정에서 빼고 「영상·퀴즈 확인 전」 · 「구간 완주」 대신 「인증 완료」
       (칸이 생기면 calendar 의 video(%) · quiz(true/false) 로 세 조건 모두 판정 — 없는 값은 지어내지 않는다)
     · 늦은 인증(앱 late)은 그날 인정이 아니다 · 지난 평일인데 인증이 없으면 미제출 · 오늘은 「진행 중」
     · 골든패스 — 한 달에 한 번, 그 달 첫 미제출(늦은 인증 포함 · 사정 인정 날 제외)을 자동 인정
     · 사정 인정 — 직원이 코치룸에서 체크한 날(시험 등으로 미리 알린 날) · 인정으로 계산 · 사유는 학생 · 학부모 화면에 안 보임
     · 일차를 3구간으로(나머지는 앞 구간부터 1일씩) · 구간마다 모든 일차가 인정이면 구간 완주 · 앞 구간을 놓쳐도 뒤 구간은 따로
   학생 · 학부모 화면에 환급 금액 · 순위 · 비교 · 전화번호 · 상담 · 성적 그래프 없음
   ============================================================ */
(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var KIND = {
    ok:      { t: '인정',       i: '✓',  c: 'ok' },
    excused: { t: '사정 인정',  i: '📋', c: 'ex' },
    golden:  { t: '골든패스',   i: '🎫', c: 'gp' },
    late:    { t: '늦은 인증',  i: '⏰', c: 'late' },
    miss:    { t: '미제출',     i: '·',  c: 'miss' },
    today:   { t: '오늘 진행 중', i: '🏃', c: 'today' },
    future:  { t: '아직 안 옴', i: '',   c: 'fu' },
    nodata:  { t: '기록 없음',  i: '',   c: 'fu' },
    weekend: { t: '주말 자율',  i: '',   c: 'we' },
    off:     { t: '',           i: '',   c: 'off' }
  };
  var OKISH = { ok: 1, excused: 1, golden: 1 };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function dowOf(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function isWeekend(d) { var w = dowOf(d); return w === 0 || w === 6; }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function mdw(d) { return md(d) + '(' + DOW[dowOf(d)] + ')'; }
  function ymOf(d) { return String(d || '').slice(0, 7); }
  function lastDay(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function datesOf(ym) { var n = lastDay(ym), out = []; for (var i = 1; i <= n; i++) out.push(ym + '-' + (i < 10 ? '0' : '') + i); return out; }
  function shiftYm(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; var d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); }
  function monthName(ym) { return (+ym.slice(5, 7)) + '월'; }
  /* 제출 시각 → 한국 날짜 · 시각 */
  function kst(v) {
    var t = Date.parse(v || '');
    if (!isFinite(t)) return null;
    var s = new Date(t + 9 * 3600000).toISOString();
    return { day: s.slice(0, 10), hm: s.slice(11, 16) };
  }

  /* 날짜별 앱 기록(지금 + 옛 기록 · 같은 날은 지금 기록) · 강 번호별 과제 · 영상 */
  function index(data) {
    data = data || {};
    var old = data.old && typeof data.old === 'object' ? data.old : {};
    var cal = {}, hist = {}, lec = {};
    [].concat(old.calendar || [], data.calendar || []).forEach(function (c) { if (c && valid(c.date)) cal[c.date] = c; });
    [].concat(old.history || [], data.history || data.recent || []).forEach(function (h) {
      if (!h || h.order == null) return;
      var k = String(+h.order), cur = hist[k];
      if (!cur || String(h.submittedAt || '') < String(cur.submittedAt || '')) hist[k] = h;
    });
    (data.lectures || []).forEach(function (l) { if (l && l.order != null) lec[String(+l.order)] = l; });
    var has = { video: false, quiz: false };
    Object.keys(cal).forEach(function (d) { var c = cal[d]; if (c.video != null && isFinite(+c.video)) has.video = true; if (typeof c.quiz === 'boolean') has.quiz = true; });
    return { cal: cal, hist: hist, lec: lec, has: has };
  }

  /* 볼 수 있는 달 — 앱 기록 첫 달(또는 시작일) ~ 이번 달 · 최대 12달 */
  function months(data, today, start) {
    var ix = index(data), first = Object.keys(ix.cal).sort()[0] || '';
    var from = ymOf(first || start || today);
    var to = ymOf(today), out = [];
    for (var ym = to; ym >= from && out.length < 12; ym = shiftYm(ym, -1)) out.push(ym);
    return out;
  }

  /* 한 달 계산 */
  function compute(data, ym, o) {
    o = o || {};
    var today = o.today || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    ym = ym || ymOf(today);
    var ix = index(data), ex = {};
    (o.excuse || []).forEach(function (d) { if (valid(d)) ex[d] = 1; });
    var all = datesOf(ym), inCal = all.filter(function (d) { return ix.cal[d]; });
    var lastCal = inCal[inCal.length - 1] || '';
    var full = ix.has.video && ix.has.quiz;
    var count = {};
    all.forEach(function (d) {
      var c = ix.cal[d];
      if (c) { if (!isWeekend(d) || +c.order > 0) count[d] = 1; }
      else if (!isWeekend(d) && (!inCal.length || d > lastCal)) count[d] = 1;
    });
    var empty = !inCal.length;
    var days = all.map(function (d) {
      var c = ix.cal[d] || null, order = c ? +c.order || 0 : 0, h = order ? ix.hist[String(order)] : null, l = order ? ix.lec[String(order)] : null;
      var x = { date: d, dow: dowOf(d), counted: !!count[d], order: order, day: order > 100000 ? order - 100000 : order, title: h ? String(h.title || '') : '',
                at: h && h.submittedAt ? kst(h.submittedAt) : null, video: c && c.video != null && isFinite(+c.video) ? Math.round(+c.video) : null,
                quiz: c && typeof c.quiz === 'boolean' ? c.quiz : null,
                vids: l && +l.videosTotal > 0 ? { done: +l.videosDone || 0, total: +l.videosTotal } : null, kind: 'off' };
      if (!x.counted) { x.kind = isWeekend(d) ? 'weekend' : 'off'; return x; }
      var st = c ? c.status : 'none';
      var pass = st === 'onTime' && (!full || ((x.video || 0) >= 70 && x.quiz === true));
      if (pass) x.kind = 'ok';
      else if (ex[d]) x.kind = 'excused';
      else if (d > today) x.kind = 'future';
      else if (d === today) x.kind = st === 'late' ? 'late' : 'today';
      else if (empty) x.kind = 'nodata';
      else x.kind = st === 'late' || st === 'onTime' ? 'late' : 'miss';
      return x;
    });
    /* 골든패스 — 그 달 첫 미제출 · 늦은 인증 하나 (오늘 늦은 인증도 하루가 끝난 것과 같이) */
    var golden = null;
    if (!empty) days.some(function (x) { if (x.counted && (x.kind === 'miss' || x.kind === 'late')) { x.gpFrom = x.kind; x.kind = 'golden'; golden = x.date; return true; } return false; });
    var cd = days.filter(function (x) { return x.counted; }), n = cd.length;
    var base = Math.floor(n / 3), rest = n % 3, segs = [], p = 0;
    for (var s = 0; s < 3; s++) {
      var size = base + (s < rest ? 1 : 0), part = cd.slice(p, p + size);
      p += size;
      var okN = part.filter(function (x) { return OKISH[x.kind]; }).length;
      var missN = part.filter(function (x) { return x.kind === 'miss' || x.kind === 'late'; }).length;
      var open = part.some(function (x) { return x.kind === 'future' || x.kind === 'today' || x.kind === 'nodata'; });
      var state = !part.length ? 'none' : missN ? 'missed' : !open ? 'done' : okN ? 'run' : 'wait';
      part.forEach(function (x) { x.seg = s + 1; });
      segs.push({ no: s + 1, from: part[0] ? part[0].date : '', to: part.length ? part[part.length - 1].date : '', n: part.length, ok: okN, state: state });
    }
    /* 구간 첫날 표시 (달력의 경계선) */
    segs.forEach(function (g) { days.forEach(function (x) { if (x.date === g.from && g.no > 1) x.segStart = g.no; }); });
    /* 연속 인증 — 오늘까지 거꾸로(오늘 진행 중은 건너뜀 · 지난달에서 이어지지는 않음) */
    var streak = 0;
    for (var i = cd.length - 1; i >= 0; i--) {
      var y = cd[i];
      if (y.date > today) continue;
      if (y.kind === 'today') continue;
      if (OKISH[y.kind]) streak++; else break;
    }
    var td = days.filter(function (x) { return x.date === today; })[0] || null;
    var exN = days.filter(function (x) { return x.kind === 'excused'; }).length;
    return { ym: ym, today: today, days: days, segs: segs, golden: golden, streak: streak, todayDay: td, n: n, empty: empty, full: full, has: ix.has,
             okN: cd.filter(function (x) { return OKISH[x.kind]; }).length, exN: exN, current: ym === ymOf(today),
             label: full ? '구간 완주' : '인증 완료', doneN: segs.filter(function (g) { return g.state === 'done'; }).length };
  }

  /* ---------- 화면 조각 ---------- */
  function segLine(g, r) {
    if (g.state === 'done') return r.full ? '구간 완주! 🏁' : '모든 일차 인증 완료 ✓';
    if (g.state === 'missed') return g.no < 3 ? '이 구간은 아쉽게 놓쳤어요 · 다음 구간에서 다시 시작할 수 있어요' : '이 구간은 아쉽게 놓쳤어요 · 다음 달 1구간에서 다시 시작할 수 있어요';
    if (g.state === 'run') return '달리는 중 · 남은 일차 ' + (g.n - g.ok) + '일';
    if (g.state === 'wait') return md(g.from) + '부터 시작해요';
    return '';
  }
  function segsHtml(r) {
    return '<ol class="orn-segs">' + r.segs.map(function (g) {
      var pct = g.n ? Math.round(g.ok / g.n * 100) : 0;
      return '<li class="orn-seg orn-seg--' + g.state + '"><div class="orn-seg__h"><b>' + g.no + '구간</b><span class="num">' + (g.from ? esc(md(g.from) + '~' + md(g.to)) : '') + '</span>' +
        '<span class="orn-seg__n num">' + g.ok + '/' + g.n + '일</span>' + (g.state === 'done' ? '<span class="orn-seg__done">' + (r.full ? '완주' : '인증 완료') + '</span>' : '') + '</div>' +
        '<div class="orn-bar" role="img" aria-label="' + g.no + '구간 ' + g.ok + '/' + g.n + '일"><i style="width:' + pct + '%"></i></div>' +
        '<p class="orn-seg__t">' + esc(segLine(g, r)) + '</p></li>';
    }).join('') + '</ol>';
  }
  function checkNote(r) {
    return r.full ? '' : '<p class="orn-note">영상·퀴즈 확인 전 — 지금은 과제 인증 기록으로만 보여요</p>';
  }
  function todayHtml(r) {
    var x = r.todayDay;
    if (!r.current) return '';
    if (!x || !x.counted) return '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">🌿</span><span><b>오늘의 지문</b>' + (x && x.kind === 'weekend' ? '주말 자율 과제 날이에요' : '오늘은 지문이 없는 날이에요') + '</span></div>';
    var t = OKISH[x.kind] && x.kind === 'ok' ? '오늘 인증 완료 ✓' + (x.at ? ' · ' + x.at.hm : '') : x.kind === 'late' ? '오늘은 늦게 인증했어요' : x.kind === 'excused' ? '사정 인정 날이에요' : '아직 인증 전 · 오늘 밤 12시까지';
    return '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">📖</span><span><b>오늘의 지문' + (x.day ? ' · DAY ' + x.day : '') + '</b>' + esc(t) + '</span></div>';
  }
  /* 홈 맨 위 카드 */
  function cardHtml(r, o) {
    o = o || {};
    var head = '<div class="orn-card__h"><h2 class="gm-h">🏁 ' + esc(monthName(r.ym)) + ' 완주 현황</h2><span class="orn-card__s num">' + r.n + '일 중 ' + r.okN + '일 ' + esc(r.full ? '인정' : '인증') + '</span></div>';
    if (r.empty && !r.n) return '<section class="gm-card orn-card" id="ornCard">' + head + '<p class="orn-note">이번 달 지문 기록이 아직 없어요</p></section>';
    return '<section class="gm-card orn-card" id="ornCard" aria-label="이번 달 완주 현황">' + head +
      (r.empty ? '<p class="orn-note">앱에서 이번 달 기록을 받는 중이에요</p>' : '') +
      segsHtml(r) +
      '<div class="orn-stats">' + todayHtml(r) +
        '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">🔥</span><span><b>연속 인증</b><em class="num">' + r.streak + '일</em></span></div>' +
        '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">🎫</span><span><b>골든패스</b>' + (r.golden ? esc(mdw(r.golden)) + '에 썼어요' : '아직 안 썼어요 · 이번 달 1번') + '</span></div>' +
      '</div>' + checkNote(r) +
      (o.go ? '<button type="button" class="gm-link orn-card__go" data-orn-go="run">완주 달력 보기 ›</button>' : '') +
    '</section>';
  }

  /* 완주 달력 */
  var LEGEND = ['ok', 'golden', 'excused', 'late', 'miss', 'today', 'weekend', 'future'];
  function calHtml(r, o) {
    o = o || {};
    var mlist = o.months || [r.ym], i = mlist.indexOf(r.ym);
    var prev = i >= 0 && i < mlist.length - 1 ? mlist[i + 1] : '', next = i > 0 ? mlist[i - 1] : '';
    var first = r.days[0] ? r.days[0].dow : 0, cells = [];
    for (var k = 0; k < first; k++) cells.push('<span class="orn-cal__c orn-cal__c--pad" aria-hidden="true"></span>');
    r.days.forEach(function (x) {
      var K = KIND[x.kind] || KIND.off, on = o.open === x.date;
      cells.push('<button type="button" class="orn-cal__c orn-k--' + K.c + (x.segStart ? ' is-segstart' : '') + (x.date === r.today ? ' is-today' : '') + (on ? ' is-open' : '') + '" data-orn-day="' + x.date + '"' +
        ' aria-label="' + esc(mdw(x.date) + (K.t ? ' ' + K.t : '') + (x.seg ? ' · ' + x.seg + '구간' : '')) + '"' + (on ? ' aria-pressed="true"' : '') + '>' +
        (x.segStart ? '<span class="orn-cal__sg">' + x.segStart + '구간</span>' : '') +
        '<b class="num">' + (+x.date.slice(8)) + '</b><span class="orn-cal__i" aria-hidden="true">' + (K.i || '') + '</span></button>');
    });
    var open = o.open ? r.days.filter(function (x) { return x.date === o.open; })[0] : null;
    return '<section class="card orn-calbox" id="ornCal">' +
      '<div class="orn-mnav"><button type="button" class="orn-mnav__b" data-orn-m="' + esc(prev) + '"' + (prev ? '' : ' disabled') + ' aria-label="지난 달">◀</button>' +
        '<h2 class="orn-mnav__t">' + esc(r.ym.slice(0, 4) + '년 ' + monthName(r.ym)) + ' 완주 달력</h2>' +
        '<button type="button" class="orn-mnav__b" data-orn-m="' + esc(next) + '"' + (next ? '' : ' disabled') + ' aria-label="다음 달">▶</button></div>' +
      segsHtml(r) + checkNote(r) +
      '<div class="orn-cal" role="group" aria-label="날짜별 인증">' + DOW.map(function (d, j) { return '<span class="orn-cal__w' + (j === 0 || j === 6 ? ' is-we' : '') + '">' + d + '</span>'; }).join('') + cells.join('') + '</div>' +
      (open ? dayHtml(open, r) : '<p class="orn-hint">날짜를 누르면 그날 지문을 볼 수 있어요</p>') +
      '<ul class="orn-legend">' + LEGEND.map(function (k) { var K = KIND[k]; return '<li><i class="orn-k--' + K.c + '">' + (K.i || '') + '</i>' + esc(K.t) + '</li>'; }).join('') + '</ul>' +
      (r.golden ? '<p class="orn-gp">🎫 골든패스 — ' + esc(mdw(r.golden)) + '에 썼어요</p>' : '') +
    '</section>';
  }
  function dayHtml(x, r) {
    var K = KIND[x.kind] || KIND.off, rows = [];
    if (!x.counted) {
      rows.push(x.kind === 'weekend' ? '주말 — 어휘테스트 · 모의고사 자율 과제 날이에요' : '지문이 없는 날이에요');
    } else {
      if (x.title) rows.push('<b>' + esc(x.title) + '</b>');
      rows.push((x.day ? 'DAY ' + x.day + ' · ' : '') + (x.seg ? x.seg + '구간 · ' : '') + esc(K.t));
      if (x.at) rows.push('인증 시각 ' + esc(md(x.at.day) + ' ' + x.at.hm));
      if (x.kind === 'golden') rows.push('골든패스로 인정했어요');
      if (x.kind === 'excused') rows.push('미리 알린 날이라 인정했어요');
      if (x.kind === 'miss') rows.push('이 날은 인증이 없었어요');
      if (x.video != null) rows.push('데일리 영상 ' + x.video + '% 시청');
      else if (x.vids) rows.push('영상 ' + x.vids.done + '/' + x.vids.total + ' 완료 (앱 기준)');
      if (x.quiz != null) rows.push('데일리 퀴즈 ' + (x.quiz ? '제출' : '아직'));
    }
    return '<div class="orn-day" id="ornDay"><p class="orn-day__d num">' + esc(mdw(x.date)) + '</p>' + rows.map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>';
  }

  /* 기록 탭 — 파트별 누적 정답률 · 이번 달 인증 · 오답정리 · 지문 장악 점수(앱 · 코치룸에 있는 것만) */
  function recordHtml(data, r, o) {
    o = o || {};
    data = data || {};
    var hist = [].concat((data.old && data.old.history) || [], data.history || data.recent || []);
    var parts = {}, tot = { k: 0, n: 0 }, rates = [];
    hist.forEach(function (h) {
      if (!h) return;
      if (h.correctRate != null && isFinite(+h.correctRate)) rates.push(+h.correctRate);
      (h.parts || []).forEach(function (p) {
        if (!p || !(+p.n > 0)) return;
        var name = String(p.c || '기타');
        var b = parts[name] || (parts[name] = { k: 0, n: 0, t: 0 });
        b.k += +p.k || 0; b.n += +p.n; b.t++;
        tot.k += +p.k || 0; tot.n += +p.n;
      });
    });
    var list = Object.keys(parts).map(function (k) { var b = parts[k]; return { name: k, rate: Math.round(b.k / b.n * 100), k: b.k, n: b.n }; })
      .sort(function (a, b) { return b.n - a.n; });
    var sc = (o.scores || []).filter(function (x) { return x && (x.k === 'wrong' || x.k === 'text') && isFinite(+x.s); });
    function avg(k) { var v = sc.filter(function (x) { return x.k === k; }).map(function (x) { return +x.s; }); return v.length ? { a: Math.round(v.reduce(function (p, q) { return p + q; }, 0) / v.length), n: v.length, last: v[v.length - 1] } : null; }
    var w = avg('wrong'), t = avg('text');
    var html = '<section class="card orn-rec"><h2 class="card-title">📒 ' + esc(monthName(r.ym)) + ' 기록</h2>' +
      '<div class="orn-kpis"><div><b class="num">' + r.okN + '일</b><span>' + (r.full ? '인정' : '인증') + ' 일차 (' + r.n + '일 중)</span></div>' +
      '<div><b class="num">' + r.doneN + '/3</b><span>' + esc(r.label) + ' 구간</span></div>' +
      '<div><b class="num">' + r.streak + '일</b><span>연속 인증</span></div></div>' + checkNote(r) + '</section>';
    html += '<section class="card orn-rec"><h2 class="card-title">🎯 파트별 정답률 <span class="card-note">지금까지 누적</span></h2>' +
      (list.length ? '<ul class="orn-parts">' + list.map(function (p) {
        return '<li><span class="orn-parts__n">' + esc(p.name) + '</span><span class="orn-bar"><i style="width:' + p.rate + '%"></i></span><b class="num">' + p.rate + '%</b><small class="num">' + p.k + '/' + p.n + '문항</small></li>';
      }).join('') + '</ul>' + '<p class="orn-hint">전체 ' + (tot.n ? Math.round(tot.k / tot.n * 100) : 0) + '% · ' + tot.n + '문항</p>'
        : rates.length ? '<p class="orn-hint">과제 정답률 평균 ' + Math.round(rates.reduce(function (p, q) { return p + q; }, 0) / rates.length) + '% · ' + rates.length + '개 과제</p>'
        : '<p class="orn-hint">과제를 내면 파트별 정답률이 쌓여요</p>') + '</section>';
    if (w || t) html += '<section class="card orn-rec"><h2 class="card-title">✍️ 오답정리 · 필기 점수</h2><div class="orn-kpis">' +
      (w ? '<div><b class="num">' + w.a + '</b><span>오답정리 평균 · ' + w.n + '회</span></div>' : '') +
      (t ? '<div><b class="num">' + t.a + '</b><span>지문 장악(필기) 평균 · ' + t.n + '회</span></div>' : '') + '</div></section>';
    return html;
  }

  /* 코치룸 학생 카드 — 같은 현황 + 날짜마다 사정 인정 체크(직원만) */
  function staffHtml(r, o) {
    o = o || {};
    var mlist = o.months || [r.ym], i = mlist.indexOf(r.ym);
    var prev = i >= 0 && i < mlist.length - 1 ? mlist[i + 1] : '', next = i > 0 ? mlist[i - 1] : '';
    var ex = {}; (o.excuse || []).forEach(function (d) { ex[d] = 1; });
    var rows = r.days.filter(function (x) { return x.counted; }).map(function (x) {
      var K = KIND[x.kind] || KIND.off, can = x.kind !== 'ok';
      return '<li class="orn-sd orn-k--' + K.c + '"><span class="num">' + esc(mdw(x.date)) + '</span><span class="orn-sd__k">' + esc(K.t) + (x.seg ? ' · ' + x.seg + '구간' : '') + '</span>' +
        '<label class="chk-inline orn-sd__ex"><input type="checkbox" data-orn-ex="' + x.date + '"' + (ex[x.date] ? ' checked' : '') + (can || ex[x.date] ? '' : ' disabled') + (o.busy ? ' disabled' : '') + '> 사정 인정</label></li>';
    }).join('');
    return '<div class="orn-staff"><div class="orn-mnav orn-mnav--sm"><button type="button" class="btn btn--sm" data-orn-sm="' + esc(prev) + '"' + (prev ? '' : ' disabled') + '>◀</button>' +
        '<b>' + esc(monthName(r.ym)) + ' 구간 ' + esc(r.label) + ' ' + r.doneN + '/3</b><button type="button" class="btn btn--sm" data-orn-sm="' + esc(next) + '"' + (next ? '' : ' disabled') + '>▶</button></div>' +
      segsHtml(r) + checkNote(r) +
      '<p class="orn-hint">골든패스 ' + (r.golden ? esc(mdw(r.golden)) : '안 씀') + ' · 사정 인정 ' + r.exN + '일 · 연속 인증 ' + r.streak + '일</p>' +
      (rows ? '<details class="orn-sdbox"' + (o.openList ? ' open' : '') + '><summary>날짜별 인증 · 사정 인정 체크</summary><ul class="orn-sdl">' + rows + '</ul>' +
        '<p class="orn-hint">시험 등으로 미리 알린 날만 체크해 주세요 · 체크한 날은 인정으로 계산돼요 · 사유는 학생 · 학부모 화면에 안 보여요</p></details>' : '') +
      (o.msg ? '<p class="orn-hint" role="status">' + esc(o.msg) + '</p>' : '') +
    '</div>';
  }

  /* 반 표 한 줄 · CSV */
  function classRow(stu, ym, today) {
    var r = compute(stu.data || {}, ym, { today: today, excuse: stu.excuse || [], start: stu.start_on || '' });
    return { id: stu.id, name: stu.name, linked: stu.linked !== false, r: r };
  }
  function csv(cls, ym, rows) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ['반', '달', '이름', '일차', '인정·인증 일차', '1구간', '2구간', '3구간', '완주(인증 완료) 구간 수', '골든패스', '사정 인정 일수', '판정 기준'];
    var out = [head].concat(rows.map(function (x) {
      var r = x.r, sg = r.segs.map(function (g) { return g.state === 'done' ? (r.full ? '완주' : '인증 완료') : g.state === 'missed' ? (r.full ? '미완주' : '미완료') : g.state === 'none' ? '' : '진행 중'; });
      return [cls, ym, x.name, r.n, r.okN].concat(sg, [r.doneN, r.golden || '', r.exN, r.full ? '과제·영상·퀴즈' : '과제 인증만(영상·퀴즈 확인 전)']);
    }));
    return out.map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }

  global.OnlineRun = { compute: compute, months: months, cardHtml: cardHtml, calHtml: calHtml, dayHtml: dayHtml, recordHtml: recordHtml, staffHtml: staffHtml,
    classRow: classRow, csv: csv, KIND: KIND, monthName: monthName, shiftYm: shiftYm, ymOf: ymOf };
})(window);
