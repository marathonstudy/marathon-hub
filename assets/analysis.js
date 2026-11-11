/* ============================================================
   analysis.js — 「📊 내 학습 분석」 (러닝노트 홈 · 코치룸 학생 카드 · 20261110l)

   새 데이터는 모으지 않는다 — 지금 저장된 것만:
     앱 과제 기록(history · calendar · categories — 러닝노트 appData · 코치룸 app_records.data) · 배지(hub_badges · staff_badges)
     오답정리 · 지문 장악 점수(king-pick 이 매긴 숫자 · hub_scores · staff_scores · migration-101 — 근거 문장 · 사진 없음)
   데이터가 없는 항목은 칸을 만들지 않는다. 다른 학생과 비교 · 순위 없음. 모의고사 점수 없음.

   홈 — 능력치 아래 요약 카드 4~6개(큰 숫자 · 작은 추이선 · 앞 기간 대비 ▲n 초록 반짝 / ▼n 회색 · 「NEW 최고 기록!」)
        맨 위 「이번 주 한눈에」 한 줄 · [자세히 보기] 전체 분석 · [▶ 지난주 리캡] 3~5장 스토리(마지막 장 「📸 사진으로 공유」)
   전체 분석 — 오답정리 · 지문 장악 점수(평균 · 최고 · 주별) · 정답률(전체 · 영역별 켜고 끄기) · 제출 습관(주별 제출률 · 제때/늦게 도넛 ·
        시간대 24칸 · 요일 · 한 해 잔디) · 기록(누적 제출 · 연속 제출 최장 · 퍼펙트 위크 · 배지 네 가지와 받은 주)
        그래프마다 짧고 따뜻한 한 줄 해석 · 최고점 ★ · 점을 누르면 그 주(날) 값과 그때 제출물
   기간 [이번 달][최근 4주][1년]은 능력치와 같이 움직인다(같은 상태 · 고르기 전에는 능력치처럼 기록이 적으면 전체 기간)
   그래프는 화면에 들어올 때만 그린다 · 처음 볼 때 숫자 차오름 · 선 그리기(동작 줄이기 기기에서는 끔) · 휴대폰 가로 스크롤 없음

   Analysis.build(data, { today, kind, badges, scores, streak }) — 계산만(시험용)
   Analysis.mountSummary(host, ctx) · Analysis.openFull(ctx) · Analysis.openRecap(ctx)
     ctx = { data, today, state{kind,picked}, onKind(), badges, scores, streak, parent, name, staff, openSubs(from, to, host), share() }
   ============================================================ */
(function (global) {
  'use strict';

  var D = global.document;
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function monday(d) { var w = dow(d); return addDays(d, w === 0 ? -6 : 1 - w); }
  function md(d) { return +d.slice(5, 7) + '/' + (+d.slice(8, 10)); }
  function kst(v) {
    var x = String(v || '');
    var t = Date.parse(x);
    if (/T/.test(x) && !isNaN(t)) { var k = new Date(t + 9 * 3600000); return { d: k.toISOString().slice(0, 10), h: k.getUTCHours() }; }
    return valid(x.slice(0, 10)) ? { d: x.slice(0, 10), h: null } : null;
  }
  function reduced() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function AB() { return global.Ability; }
  function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var COLORS = { rate: '#F5C842', sub: '#7EE0C3', wrong: '#FF9F6B', text: '#8FB8FF', streak: '#FF7A59', total: '#C9B8FF' };
  var AREA_INK = ['#F5C842', '#7EE0C3', '#FF9F6B', '#8FB8FF', '#E58CFF', '#FFD6E0', '#B4F06A', '#6FD3FF'];

  /* ============================================================
     계산
     ============================================================ */
  function weeksOf(from, to) { var out = [], m = monday(from); while (m <= to && out.length < 60) { out.push(m); m = addDays(m, 7); } return out; }
  /* 주마다 [{ w(월요일), v }] — 값이 없는 주는 v=null */
  function weekly(list, weeks, f) {
    return weeks.map(function (w) { var xs = list.filter(function (x) { return x.date >= w && x.date <= addDays(w, 6); }); return { w: w, v: xs.length ? f(xs) : null }; });
  }
  function wavg(xs) { var q = 0, s = 0; xs.forEach(function (x) { s += x.r * x.n; q += x.n; }); return q ? Math.round(s / q) : null; }
  function lastVal(pts) { for (var i = pts.length - 1; i >= 0; i--) if (pts[i].v != null) return pts[i]; return null; }
  /* 개인 최고 — 마지막 값이 지난 모든 값보다 높으면(값 3개 이상) NEW */
  function isNewBest(allPts) {
    var v = allPts.filter(function (p) { return p.v != null; });
    if (v.length < 3) return false;
    var last = v[v.length - 1].v, before = v.slice(0, -1).map(function (p) { return p.v; });
    return last > Math.max.apply(null, before);
  }
  function rising(pts) { var v = pts.filter(function (p) { return p.v != null; }).map(function (p) { return p.v; }), n = 0; for (var i = v.length - 1; i > 0 && v[i] > v[i - 1]; i--) n++; return n; }

  function calendarOf(data) {
    var A = global.AppWeek, d = data && A && A.normalize ? A.normalize(data) : data;
    return ((d && d.calendar) || []).filter(function (c) { return c && valid(c.date); });
  }
  function build(data, o) {
    o = o || {};
    data = data || {};
    var today = o.today, Ab = AB();
    var hist = (data.history || data.recent || []).filter(function (h) { return h && h.submittedAt; });
    var subs = hist.map(function (h) { var k = kst(h.submittedAt); return k ? { date: k.d, h: k.h, late: !!h.late } : null; }).filter(Boolean);
    var cal = calendarOf(data).filter(function (c) { return c.date <= today; });
    var its = Ab ? Ab.items(data) : [];
    var scores = (o.scores || []).filter(function (x) { return x && valid(String(x.d).slice(0, 10)) && (x.k === 'wrong' || x.k === 'text') && isFinite(+x.s); })
      .map(function (x) { return { date: String(x.d).slice(0, 10), k: x.k, s: +x.s }; });
    var firstAll = [subs[0] && subs[0].date, cal[0] && cal[0].date, its[0] && its[0].date, scores[0] && scores[0].date].filter(Boolean).sort()[0] || today;
    var kind = o.kind || 'w4';
    var R = Ab ? Ab.range(kind, today, firstAll) : { from: addDays(today, -27), to: today, prev: null, note: '' };
    var inR = function (d, r) { return r && d >= r.from && d <= r.to; };
    var weeks = weeksOf(R.from, today), allWeeks = weeksOf(firstAll, today);
    var out = { kind: kind, range: R, weeks: weeks, cards: [], sections: {} };

    /* 정답률 */
    if (its.length) {
      var cur = its.filter(function (x) { return inR(x.date, R); }), prv = its.filter(function (x) { return inR(x.date, R.prev); });
      var tops = [], areaPts = {};
      cur.forEach(function (x) { if (tops.indexOf(x.top) < 0) tops.push(x.top); });
      tops.sort(function (a, b) { var O = Ab.ORDER, i = O.indexOf(a), j = O.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
      tops.forEach(function (t) { areaPts[t] = weekly(cur.filter(function (x) { return x.top === t; }), weeks, wavg); });
      var rp = weekly(cur, weeks, wavg), all = weekly(its, allWeeks, wavg);
      var v = wavg(cur), pv = wavg(prv);
      if (v != null) {
        out.sections.rate = { avg: v, pts: rp, areas: tops.map(function (t, i) { return { name: t, color: AREA_INK[i % AREA_INK.length], pts: areaPts[t] }; }), isNew: isNewBest(all), allPts: all };
        out.cards.push({ key: 'rate', label: '정답률', v: v, unit: '%', pts: rp, delta: pv != null ? v - pv : null, isNew: isNewBest(all), color: COLORS.rate });
      }
    }
    /* 제출률 · 제때/늦게 */
    if (cal.length) {
      var due = function (xs) { var dn = 0, tot = 0; xs.forEach(function (c) { if (c.status === 'exempt') return; if (c.status === 'onTime' || c.status === 'late') { dn++; tot++; } else if (c.date < today) tot++; }); return tot ? Math.round(dn * 100 / tot) : null; };
      var cc = cal.filter(function (c) { return inR(c.date, R) && dow(c.date) % 6 !== 0; }), cp = cal.filter(function (c) { return inR(c.date, R.prev) && dow(c.date) % 6 !== 0; });
      var sp = weekly(cc, weeks, due), sAll = weekly(cal.filter(function (c) { return dow(c.date) % 6 !== 0; }), allWeeks, due);
      var sv = due(cc), spv = due(cp);
      var onT = cc.filter(function (c) { return c.status === 'onTime'; }).length, lt = cc.filter(function (c) { return c.status === 'late'; }).length;
      if (sv != null) {
        out.sections.sub = { avg: sv, pts: sp, onTime: onT, late: lt };
        out.cards.push({ key: 'sub', label: '제출률', v: sv, unit: '%', pts: sp, delta: spv != null ? sv - spv : null, isNew: false, color: COLORS.sub });
      }
    }
    /* 시간대 · 요일 · 잔디 */
    var ps = subs.filter(function (x) { return inR(x.date, R); });
    if (ps.length) {
      var hours = []; for (var i = 0; i < 24; i++) hours.push(0);
      var dows = [0, 0, 0, 0, 0, 0, 0];
      ps.forEach(function (x) { if (x.h != null) hours[x.h]++; dows[dow(x.date)]++; });
      if (hours.some(Boolean)) out.sections.hours = { bins: hours };
      out.sections.dows = { bins: dows };
    }
    if (subs.length || cal.length) {
      var days = {}, g0 = addDays(monday(today), -52 * 7);
      subs.forEach(function (x) { if (x.date >= g0) days[x.date] = (days[x.date] || 0) + 1; });
      if (!subs.length) cal.forEach(function (c) { if ((c.status === 'onTime' || c.status === 'late') && c.date >= g0) days[c.date] = 1; });
      out.sections.grass = { from: g0, to: today, days: days };
    }
    /* 오답정리 · 지문 장악 */
    ['wrong', 'text'].forEach(function (k) {
      var xs = scores.filter(function (x) { return x.k === k; });
      if (!xs.length) return;
      var f = function (a) { return Math.round(avg(a.map(function (x) { return x.s; }))); };
      var c2 = xs.filter(function (x) { return inR(x.date, R); }), p2 = xs.filter(function (x) { return inR(x.date, R.prev); });
      var pts = weekly(c2, weeks, f), all = weekly(xs, allWeeks, f);
      var useAll = !c2.length;                               /* 이 기간에 점수가 없으면 가진 점수 전체로 */
      var base = useAll ? xs : c2, a = f(base), mx = Math.max.apply(null, base.map(function (x) { return x.s; }));
      out.sections[k] = { avg: a, max: mx, pts: useAll ? all : pts, all: useAll, isNew: isNewBest(all), rise: rising(all) };
      out.cards.push({ key: k, label: k === 'wrong' ? '오답정리 점수' : '지문 장악 점수', v: a, unit: '', pts: useAll ? all : pts, delta: !useAll && p2.length ? a - f(p2) : null, isNew: isNewBest(all), color: COLORS[k] });
    });
    /* 기록 — 누적 제출 · 연속 제출 최장 · 퍼펙트 위크 · 배지 */
    var best = 0, run = 0;
    cal.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (c) {
      if (c.status === 'exempt' || dow(c.date) % 6 === 0) return;
      if (c.status === 'onTime' || c.status === 'late') { run++; if (run > best) best = run; } else if (c.date < today) run = 0;
    });
    var nowRun = o.streak != null ? +o.streak || 0 : run;
    if (best > 0) out.cards.push({ key: 'streak', label: '연속 제출 최장', v: best, unit: '일', pts: null, delta: null, isNew: nowRun > 0 && nowRun >= best && best >= 5, color: COLORS.streak, sub: nowRun ? '지금 ' + nowRun + '일째' : '' });
    if (subs.length) {
      var cum = [], n = 0, si = 0, ss = subs.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      allWeeks.forEach(function (w) { var e = addDays(w, 6); while (si < ss.length && ss[si].date <= e) { n++; si++; } cum.push({ w: w, v: n }); });
      var inP = ss.filter(function (x) { return inR(x.date, R); }).length;
      out.sections.total = { n: ss.length, pts: cum, inPeriod: inP };
      out.cards.push({ key: 'total', label: '총 제출', v: ss.length, unit: '개', pts: cum.slice(-Math.max(2, weeks.length)), delta: null, isNew: false, color: COLORS.total, sub: inP ? '이 기간 +' + inP : '' });
    }
    var b = o.badges || null;
    out.sections.records = {
      best: best, now: nowRun,
      perfect: b ? +b.perfect || 0 : null,
      badges: b ? { weekly: +b.perfect || 0, monthly: (b.months || []).length, wrong: +((b.kings || {}).wrong) || 0, text: +((b.kings || {}).text) || 0,
                    weeks: (b.weeks || []).filter(function (x) { return x && x.perfect; }).map(function (x) { return x.lesson || x.week; }),
                    months: (b.months || []).slice(), kings: ((b.kings || {}).weeks || []).slice() } : null
    };
    out.cards = out.cards.slice(0, 6);
    out.glance = glance(out);
    out.recap = recap(data, o, out, its, cal, scores);
    return out;
  }
  /* 「이번 주 한눈에」 한 줄 — 짧고 따뜻하게 */
  function glance(a) {
    var s = a.sections, parts = [];
    if (s.rate) {
      var lv = lastVal(s.rate.allPts), last4 = s.rate.allPts.slice(-4).filter(function (p) { return p.v != null; });
      if (lv && last4.length >= 2 && lv.v >= Math.max.apply(null, last4.map(function (p) { return p.v; }))) parts.push('정답률 ' + lv.v + '%로 4주 중 최고');
      else if (lv) parts.push('정답률 ' + s.rate.avg + '%');
    }
    ['wrong', 'text'].forEach(function (k) { if (s[k] && s[k].rise >= 2) parts.push((k === 'wrong' ? '오답정리' : '지문 장악') + ' 점수 ' + s[k].rise + '주째 상승'); });
    if (parts.length < 2 && s.sub) { var sl = lastVal(s.sub.pts); if (sl && sl.v === 100) parts.push('이번 주 과제 모두 냈어요'); }
    if (!parts.length && s.total && s.total.inPeriod) parts.push('이 기간에 과제 ' + s.total.inPeriod + '개를 냈어요');
    return parts.slice(0, 2).join(' · ');
  }
  /* 지난주 리캡 — 데이터 있는 장만 (2장 이상일 때만) */
  function recap(data, o, a, its, cal, scores) {
    var today = o.today, w0 = addDays(monday(today), -7), w1 = addDays(w0, 6), slides = [];
    var wk = cal.filter(function (c) { return c.date >= w0 && c.date <= w1 && dow(c.date) % 6 !== 0 && c.status !== 'exempt'; });
    if (wk.length) {
      var dn = wk.filter(function (c) { return c.status === 'onTime' || c.status === 'late'; }).length;
      slides.push({ k: 'quest', t: '지난주 퀘스트', big: dn + '/' + wk.length, sub: dn === wk.length ? '퍼펙트 위크!' : dn ? '한 주 동안 ' + dn + '번 달렸어요' : '이번 주에 다시 출발해요' });
    }
    var wi = its.filter(function (x) { return x.date >= w0 && x.date <= w1; });
    if (wi.length) {
      var g = {}; wi.forEach(function (x) { (g[x.top] = g[x.top] || []).push(x); });
      var bestA = Object.keys(g).map(function (k) { return { k: k, v: wavg(g[k]) }; }).sort(function (x, y) { return y.v - x.v; })[0];
      slides.push({ k: 'area', t: '가장 잘한 영역', big: bestA.k, sub: '정답률 ' + bestA.v + '%' });
    }
    var ws = scores.filter(function (x) { return x.date >= w0 && x.date <= addDays(w1, 7); });
    if (ws.length) {
      var w = ws.filter(function (x) { return x.k === 'wrong'; }).pop(), t = ws.filter(function (x) { return x.k === 'text'; }).pop();
      slides.push({ k: 'score', t: '오답정리 · 지문 장악', big: (w ? w.s : '–') + ' · ' + (t ? t.s : '–'), sub: '점수가 쌓일수록 풀이가 단단해져요' });
    }
    var news = a.cards.filter(function (c) { return c.isNew; }).map(function (c) { return c.label; });
    if (news.length) slides.push({ k: 'new', t: '새 기록', big: '🏆 ' + news.length + '개', sub: news.join(' · ') + ' 최고 기록!' });
    if (slides.length < 2) return [];
    slides.push({ k: 'next', t: '다음 주 한마디', big: '한 지문씩, 같이 달려요', sub: '1일 1지문 1코칭 🏃' });
    return slides.slice(0, 5);
  }

  /* ============================================================
     그림 (SVG · 가로 320 · 화면 폭에 맞춰 줄어듦)
     ============================================================ */
  function spark(pts, color) {
    var v = (pts || []).map(function (p) { return p.v; });
    var idx = []; v.forEach(function (x, i) { if (x != null) idx.push(i); });
    if (idx.length < 2) return '';
    var nums = idx.map(function (i) { return v[i]; }), lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums), W = 100, H = 28;
    var x = function (i) { return v.length > 1 ? i * W / (v.length - 1) : 0; }, y = function (n) { return hi === lo ? H / 2 : H - 3 - (n - lo) * (H - 6) / (hi - lo); };
    return '<svg class="an-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><polyline class="an-draw" pathLength="1" points="' +
      idx.map(function (i) { return x(i).toFixed(1) + ',' + y(v[i]).toFixed(1); }).join(' ') + '" style="stroke:' + color + '"/></svg>';
  }
  /* 꺾은선 — series [{ name, color, pts:[{w,v}], off }] · 최고점 ★ · 점 누르면 그 주 */
  function lineSvg(series, o) {
    o = o || {};
    var W = 320, H = 150, L = 26, Rr = 8, T = 14, B = 22;
    var n = Math.max.apply(null, series.map(function (s) { return s.pts.length; }).concat([1]));
    var vals = []; series.forEach(function (s) { if (!s.off) s.pts.forEach(function (p) { if (p.v != null) vals.push(p.v); }); });
    var max = o.max || Math.max(10, Math.ceil(Math.max.apply(null, vals.concat([0])) / 10) * 10), min = o.min != null ? o.min : 0;
    var x = function (i) { return n > 1 ? L + i * (W - L - Rr) / (n - 1) : (L + W - Rr) / 2; }, y = function (v) { return T + (max - v) * (H - T - B) / ((max - min) || 1); };
    var grid = [min, (min + max) / 2, max].map(function (v) { return '<line class="an-g" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="an-ax" x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + Math.round(v) + '</text>'; }).join('');
    var ref = series[0] ? series[0].pts : [], step = Math.max(1, Math.ceil(n / 6));
    var xl = ref.map(function (p, i) { return i % step && i !== n - 1 ? '' : '<text class="an-ax" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + md(p.w) + '</text>'; }).join('');
    var bestV = vals.length ? Math.max.apply(null, vals) : null, starred = false;
    var body = series.map(function (s, si) {
      if (s.off) return '';
      var segs = [], cur = [];
      s.pts.forEach(function (p, i) { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
      if (cur.length) segs.push(cur);
      var lines = segs.map(function (sg) { return sg.length > 1 ? '<polyline class="an-ln an-draw" pathLength="1" style="stroke:' + s.color + '" points="' + sg.map(function (i) { return x(i).toFixed(1) + ',' + y(s.pts[i].v).toFixed(1); }).join(' ') + '"/>' : ''; }).join('');
      var dots = s.pts.map(function (p, i) {
        if (p.v == null) return '';
        var star = !starred && si === 0 && p.v === bestV && vals.length >= 2;
        if (star) starred = true;
        return '<g class="an-pt" tabindex="0" role="button" data-an-pt="' + esc(p.w + '|' + (p.to || addDays(p.w, 6)) + '|' + s.name + '|' + p.v + (o.unit || '')) + '" aria-label="' + esc(md(p.w) + ' 주 ' + s.name + ' ' + p.v + (o.unit || '')) + '">' +
          '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="9" class="an-hit"/>' +
          '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3.2" style="fill:' + s.color + '"/>' +
          (star ? '<text class="an-star" x="' + x(i).toFixed(1) + '" y="' + (y(p.v) - 7).toFixed(1) + '" text-anchor="middle">★</text>' : '') + '</g>';
      }).join('');
      return lines + dots;
    }).join('');
    return '<svg class="an-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '추이') + '">' + grid + xl + body + '</svg>';
  }
  function barSvg(bins, labels, o) {
    o = o || {};
    var W = 320, H = 120, L = 6, B = 18, T = 14, n = bins.length, gap = n > 12 ? 2 : 6, bw = (W - L * 2 - gap * (n - 1)) / n, mx = Math.max.apply(null, bins.concat([1]));
    var top = bins.indexOf(Math.max.apply(null, bins));
    return '<svg class="an-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '') + '">' + bins.map(function (v, i) {
      var h = v ? Math.max(3, v * (H - B - T) / mx) : 0, x = L + i * (bw + gap);
      return '<rect class="an-bar' + (i === top && v ? ' is-top' : '') + '" x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"><title>' + esc(labels[i] + ' ' + v + '번') + '</title></rect>' +
        (o.every && i % o.every ? '' : '<text class="an-ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + esc(o.short ? o.short[i] : labels[i]) + '</text>');
    }).join('') + '</svg>';
  }
  function donutSvg(a, b) {
    var t = a + b, r = 42, c = 2 * Math.PI * r, p = t ? a / t : 0;
    return '<svg class="an-donut" viewBox="0 0 120 120" role="img" aria-label="' + esc('제때 ' + a + '번 · 늦게 ' + b + '번') + '">' +
      '<circle cx="60" cy="60" r="' + r + '" class="an-dn-bg"/>' +
      '<circle cx="60" cy="60" r="' + r + '" class="an-dn-v an-draw-c" style="stroke-dasharray:' + (c * p).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="58" text-anchor="middle" class="an-dn-n">' + Math.round(p * 100) + '%</text><text x="60" y="76" text-anchor="middle" class="an-dn-l">제때</text></svg>';
  }
  function grassSvg(g) {
    var cols = 53, cell = 5.4, gap = 0.6, W = cols * (cell + gap), H = 7 * (cell + gap) + 12, mx = 1, html = '';
    Object.keys(g.days).forEach(function (k) { if (g.days[k] > mx) mx = g.days[k]; });
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < 7; r++) {
        var d = addDays(g.from, c * 7 + r);
        if (d > g.to) continue;
        var v = g.days[d] || 0, lv = v ? Math.min(4, Math.ceil(v * 4 / mx)) : 0;
        html += '<rect class="an-gr an-gr--' + lv + '" x="' + (c * (cell + gap)).toFixed(1) + '" y="' + (12 + r * (cell + gap)).toFixed(1) + '" width="' + cell + '" height="' + cell + '" rx="1"' +
          (v ? ' data-an-pt="' + esc(d + '|' + d + '|제출|' + v + '개') + '" tabindex="0" role="button"' : '') + '><title>' + esc(md(d) + ' ' + v + '개') + '</title></rect>';
        if (r === 0 && +d.slice(8, 10) <= 7) html += '<text class="an-ax" x="' + (c * (cell + gap)).toFixed(1) + '" y="8">' + (+d.slice(5, 7)) + '월</text>';
      }
    }
    return '<svg class="an-chart an-grass" viewBox="0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1) + '" role="img" aria-label="한 해 날짜별 제출">' + html + '</svg>';
  }

  /* ---------- 한 줄 해석 (짧고 따뜻하게) ---------- */
  function hourWord(h) { return h < 6 ? '새벽 ' + h + '시대' : h < 12 ? '오전 ' + h + '시대' : h === 12 ? '낮 12시대' : h < 18 ? '오후 ' + (h - 12) + '시대' : '밤 ' + (h - 12) + '시대'; }
  function says(a, key) {
    var s = a.sections[key];
    if (!s) return '';
    if (key === 'hours') { var mx = Math.max.apply(null, s.bins); return hourWord(s.bins.indexOf(mx)) + '에 가장 많이 내요'; }
    if (key === 'dows') { var m2 = Math.max.apply(null, s.bins); return m2 ? WD[s.bins.indexOf(m2)] + '요일에 가장 많이 냈어요' : ''; }
    if (key === 'sub') { var t = s.onTime + s.late; return t ? '낸 과제의 ' + Math.round(s.onTime * 100 / t) + '%를 제때 냈어요' : ''; }
    if (key === 'rate') { return s.isNew ? '지난주가 지금까지 가장 높았어요 ★' : '정답률 평균 ' + s.avg + '% · 한 주씩 쌓이고 있어요'; }
    if (key === 'wrong' || key === 'text') return s.rise >= 2 ? s.rise + '주째 오르는 중이에요' : '평균 ' + s.avg + ' · 최고 ' + s.max + (s.all ? ' (가진 점수 전체)' : '');
    if (key === 'total') return '지금까지 ' + s.n + '개 · 꾸준함이 실력이 돼요';
    if (key === 'grass') { var n = Object.keys(s.days).length; return n ? '한 해 동안 ' + n + '일 과제를 냈어요' : ''; }
    return '';
  }

  /* ============================================================
     요약 카드 (홈 · 코치룸)
     ============================================================ */
  function deltaHtml(d) {
    if (d == null || d === 0) return '';
    return d > 0 ? '<span class="an-up num">▲' + d + '</span>' : '<span class="an-down num">▼' + (-d) + '</span>';
  }
  function effKind(ctx) {
    var st = ctx.state || { kind: 'w4' };
    if (AB() && AB().view) return AB().view(ctx.data || {}, st, ctx.today).kind;
    return st.kind || 'w4';
  }
  function analyze(ctx) { return build(ctx.data, { today: ctx.today, kind: effKind(ctx), badges: ctx.badges, scores: ctx.scores, streak: ctx.streak }); }
  function titleOf(ctx) { return ctx.parent ? '📊 ' + (ctx.name || '') + ' 학생의 학습 분석' : '📊 내 학습 분석'; }
  function cardHtml(c) {
    return '<div class="an-card' + (c.isNew ? ' is-new' : '') + '" data-an-card="' + c.key + '" style="--an-c:' + c.color + '">' +
      (c.isNew ? '<span class="an-newb">NEW 최고 기록!</span>' : '') +
      '<span class="an-card__l">' + esc(c.label) + '</span>' +
      '<span class="an-card__v"><b class="num" data-an-count="' + c.v + '">' + c.v + '</b><small>' + esc(c.unit) + '</small>' + deltaHtml(c.delta) + '</span>' +
      (c.pts ? spark(c.pts, c.color) : '') + (c.sub ? '<span class="an-card__s">' + esc(c.sub) + '</span>' : '') + '</div>';
  }
  function summaryHtml(ctx, a) {
    if (!a.cards.length) return '';
    return '<section class="an gm-card' + (ctx.small ? ' an--small' : '') + '" id="' + (ctx.id || 'gmAnalysis') + '" data-an-root aria-label="학습 분석">' +
      '<div class="an-head"><h2 class="an-t">' + esc(titleOf(ctx)) + '</h2><span class="an-range num">' + esc(a.range.note || '') + '</span></div>' +
      (a.glance ? '<p class="an-glance"><b>이번 주 한눈에</b> ' + esc(a.glance) + '</p>' : '') +
      '<div class="an-cards">' + a.cards.map(cardHtml).join('') + '</div>' +
      '<div class="an-acts"><button type="button" class="an-btn an-btn--main" data-an-full>자세히 보기</button>' +
        (a.recap.length ? '<button type="button" class="an-btn" data-an-recap>▶ 지난주 리캡</button>' : '') + '</div></section>';
  }
  /* 숫자 차오름 · 선 그리기 — 처음 볼 때 한 번 (동작 줄이기면 끔) */
  var SEEN = {};
  function animate(root, key) {
    if (!root) return;
    if (reduced() || SEEN[key]) { root.classList.add('an-static'); return; }
    SEEN[key] = 1;
    root.classList.add('an-anim');
    var nums = root.querySelectorAll('[data-an-count]'), t0 = null, raf = global.requestAnimationFrame;
    if (!raf) return;
    var step = function (t) {
      if (t0 == null) t0 = t;
      var p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3);
      nums.forEach(function (el) { el.textContent = Math.round(+el.getAttribute('data-an-count') * e); });
      if (p < 1) raf(step);
    };
    raf(step);
  }
  function whenSeen(el, fn) {
    if (!el) return;
    var IO = global.IntersectionObserver;
    if (!IO) { fn(); return; }
    var io = new IO(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); } }, { rootMargin: '80px' });
    io.observe(el);
  }
  function mountSummary(host, ctx) {
    if (!host) return;
    var a = analyze(ctx);
    host.innerHTML = summaryHtml(ctx, a);
    host._an = ctx;
    var root = host.querySelector('[data-an-root]');
    if (root) whenSeen(root, function () { animate(root, (ctx.id || 'gm') + ':' + a.kind); });
    host.onclick = function (e) {
      if (e.target.closest('[data-an-full]')) { openFull(ctx); return; }
      if (e.target.closest('[data-an-recap]')) { openRecap(ctx); return; }
      if (e.target.closest('[data-an-card]')) openFull(ctx, e.target.closest('[data-an-card]').getAttribute('data-an-card'));
    };
  }

  /* ============================================================
     전체 분석 (화면 전체 · 아래에서)
     ============================================================ */
  var FULL = null;
  function secHtml(key, title, chart, note, extra) {
    return '<section class="an-sec" id="anSec-' + key + '" data-an-sec="' + key + '"><h3 class="an-sec__t">' + title + '</h3>' + (extra || '') +
      '<div class="an-sec__c" data-an-chart="' + key + '"><div class="an-ph" aria-hidden="true"></div></div>' + (note ? '<p class="an-say">' + esc(note) + '</p>' : '') +
      '<div class="an-info" data-an-info hidden></div></section>';
  }
  function chartFor(a, key, off) {
    var s = a.sections[key];
    if (key === 'rate') {
      var ser = [{ name: '전체', color: COLORS.rate, pts: s.pts }].concat(s.areas.map(function (x) { return { name: x.name, color: x.color, pts: x.pts, off: !!(off && off[x.name]) }; }));
      return lineSvg(ser, { max: 100, unit: '%', label: '주별 정답률' }) +
        (s.areas.length ? '<div class="an-legend" role="group" aria-label="영역 켜고 끄기">' + s.areas.map(function (x) {
          var on = !(off && off[x.name]);
          return '<button type="button" class="an-lg' + (on ? ' is-on' : '') + '" data-an-area="' + esc(x.name) + '" aria-pressed="' + on + '"><i style="background:' + x.color + '"></i>' + esc(x.name) + '</button>';
        }).join('') + '</div>' : '');
    }
    if (key === 'wrong' || key === 'text') return lineSvg([{ name: key === 'wrong' ? '오답정리' : '지문 장악', color: COLORS[key], pts: s.pts }], { max: 100, label: '주별 점수' });
    if (key === 'sub') return lineSvg([{ name: '제출률', color: COLORS.sub, pts: s.pts }], { max: 100, unit: '%', label: '주별 제출률' }) +
      ((s.onTime + s.late) ? '<div class="an-dn-row">' + donutSvg(s.onTime, s.late) + '<ul class="an-dn-lg"><li><i class="is-on"></i>제때 <b class="num">' + s.onTime + '</b>번</li><li><i></i>늦게 <b class="num">' + s.late + '</b>번</li></ul></div>' : '');
    if (key === 'hours') { var hl = []; for (var i = 0; i < 24; i++) hl.push(i + '시'); return barSvg(s.bins, hl, { every: 3, short: hl.map(function (x, i) { return String(i); }), label: '시간대별 제출' }); }
    if (key === 'dows') { var order = [1, 2, 3, 4, 5, 6, 0]; return barSvg(order.map(function (i) { return s.bins[i]; }), order.map(function (i) { return WD[i]; }), { label: '요일별 제출' }); }
    if (key === 'grass') return grassSvg(s) + '<p class="an-grass-lg"><span>적게</span><i class="an-gr--1"></i><i class="an-gr--2"></i><i class="an-gr--3"></i><i class="an-gr--4"></i><span>많이</span></p>';
    if (key === 'total') return lineSvg([{ name: '누적 제출', color: COLORS.total, pts: s.pts.slice(-Math.max(8, a.weeks.length)) }], { unit: '개', label: '누적 제출' });
    return '';
  }
  function statsHtml(items) { return '<div class="an-stats">' + items.map(function (x) { return '<div class="an-stat"><b class="num">' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>'; }
  function recordsHtml(a) {
    var r = a.sections.records, b = r.badges, it = [];
    if (r.best) it.push([r.best + '일', '연속 제출 최장']);
    if (r.now) it.push([r.now + '일', '지금 연속']);
    if (r.perfect != null) it.push([r.perfect + '주', '퍼펙트 위크']);
    var badges = b ? [['⭐', '주간 배지', b.weekly, b.weeks], ['🏅', '월간 배지', b.monthly, b.months.map(function (m) { return m + '-01'; })],
      ['📝', '오답정리왕', b.wrong, b.kings.filter(function (k) { return k.kind === 'wrong'; }).map(function (k) { return k.lesson; })],
      ['🔍', '지문장악왕', b.text, b.kings.filter(function (k) { return k.kind === 'text'; }).map(function (k) { return k.lesson; })]].filter(function (x) { return x[2] > 0; }) : [];
    if (!it.length && !badges.length) return '';
    return '<section class="an-sec" id="anSec-records"><h3 class="an-sec__t">🏆 기록</h3>' + (it.length ? statsHtml(it) : '') +
      (badges.length ? '<ul class="an-badges">' + badges.map(function (x) {
        return '<li><span class="an-bd__i" aria-hidden="true">' + x[0] + '</span><b>' + esc(x[1]) + ' <span class="num">' + x[2] + '</span></b>' +
          (x[3] && x[3].length ? '<span class="an-bd__w num">' + x[3].slice(-6).map(function (d) { return x[1] === '월간 배지' ? (+String(d).slice(5, 7)) + '월' : md(String(d)); }).join(' · ') + (x[3].length > 6 ? ' …' : '') + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '') + '</section>';
  }
  function fullHtml(ctx, a) {
    var S = a.sections, st = ctx.state || {}, per = AB() ? AB().PERIODS : [['month', '이번 달'], ['w4', '최근 4주'], ['y1', '1년']];
    var secs = '';
    if (S.wrong) secs += secHtml('wrong', '📝 오답정리 점수', '', says(a, 'wrong'), statsHtml([[S.wrong.avg, '평균'], [S.wrong.max, '최고']]));
    if (S.text) secs += secHtml('text', '🔍 지문 장악 점수', '', says(a, 'text'), statsHtml([[S.text.avg, '평균'], [S.text.max, '최고']]));
    if (S.rate) secs += secHtml('rate', '🎯 정답률', '', says(a, 'rate'), statsHtml([[S.rate.avg + '%', '이 기간 평균']]));
    if (S.sub) secs += secHtml('sub', '✅ 제출 습관', '', says(a, 'sub'), statsHtml([[S.sub.avg + '%', '제출률']]));
    if (S.hours) secs += secHtml('hours', '⏰ 주로 내는 시간', '', says(a, 'hours'));
    if (S.dows) secs += secHtml('dows', '📅 요일별 제출', '', says(a, 'dows'));
    if (S.grass) secs += secHtml('grass', '🌱 한 해 제출 잔디', '', says(a, 'grass'));
    if (S.total) secs += secHtml('total', '📈 총 제출 누적', '', says(a, 'total'), statsHtml([[S.total.n + '개', '지금까지']]));
    secs += recordsHtml(a);
    return '<div class="an-full__in" role="dialog" aria-modal="true" aria-label="' + esc(titleOf(ctx)) + '">' +
      '<div class="an-full__top"><h2 class="an-t">' + esc(titleOf(ctx)) + '</h2><button type="button" class="an-x" data-an-x aria-label="닫기">✕</button></div>' +
      '<div class="an-seg" role="group" aria-label="기간">' + per.map(function (p) { var on = a.kind === p[0]; return '<button type="button" class="an-seg__b' + (on ? ' is-on' : '') + '" data-an-k="' + p[0] + '" aria-pressed="' + on + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<p class="an-range num">' + esc(a.range.note || '') + '</p>' +
      (a.glance ? '<p class="an-glance"><b>이번 주 한눈에</b> ' + esc(a.glance) + '</p>' : '') +
      '<div class="an-cards">' + a.cards.map(cardHtml).join('') + '</div>' +
      secs +
      (a.recap.length ? '<button type="button" class="an-btn an-btn--main an-btn--wide" data-an-recap>▶ 지난주 리캡 보기</button>' : '') +
      '<p class="an-foot">다른 학생과 비교하지 않아요 · 내 기록만 보여요</p></div>';
  }
  function drawCharts(el, a, off) {
    el.querySelectorAll('[data-an-chart]').forEach(function (box) {
      var key = box.getAttribute('data-an-chart');
      whenSeen(box, function () { box.innerHTML = chartFor(a, key, off); if (!reduced()) box.classList.add('an-anim'); else box.classList.add('an-static'); });
    });
  }
  function openFull(ctx, focus) {
    closeFull();
    var a = analyze(ctx), el = D.createElement('div');
    el.className = 'an-full'; el.id = 'anFull';
    el.innerHTML = fullHtml(ctx, a);
    D.body.appendChild(el);
    D.body.classList.add('an-lock');
    FULL = { el: el, ctx: ctx, a: a, off: {} };
    animate(el.querySelector('.an-full__in'), 'full:' + a.kind);
    drawCharts(el, a, FULL.off);
    if (focus) { var s = el.querySelector('#anSec-' + focus); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start' }); }
    var x = el.querySelector('[data-an-x]'); if (x && x.focus) x.focus();
  }
  function closeFull() { var e = D.getElementById('anFull'); if (e) e.remove(); D.body.classList.remove('an-lock'); FULL = null; }
  function repaintFull() {
    if (!FULL) return;
    var top = FULL.el.scrollTop;
    FULL.a = analyze(FULL.ctx);
    FULL.el.innerHTML = fullHtml(FULL.ctx, FULL.a);
    FULL.el.querySelector('.an-full__in').classList.add('an-static');
    drawCharts(FULL.el, FULL.a, FULL.off);
    FULL.el.scrollTop = top;
  }
  function showPoint(pt) {
    var sec = pt.closest('.an-sec'), info = sec && sec.querySelector('[data-an-info]');
    if (!info || !FULL) return;
    var p = pt.getAttribute('data-an-pt').split('|');
    var label = p[0] === p[1] ? md(p[0]) : md(p[0]) + '~' + md(p[1]) + ' 주';
    info.hidden = false;
    info.innerHTML = '<p class="an-info__t"><b>' + esc(label) + '</b> · ' + esc(p[2]) + ' <b class="num">' + esc(p[3]) + '</b></p>' +
      (FULL.ctx.openSubs ? '<button type="button" class="an-btn" data-an-subs="' + esc(p[0] + '|' + p[1]) + '">그때 제출물 보기</button><div class="an-subs" data-an-subs-host></div>' : '');
  }

  /* ============================================================
     주간 리캡 (스토리 3~5장)
     ============================================================ */
  var RC = null;
  function recapHtml(ctx, slides, i) {
    var s = slides[i], last = i === slides.length - 1;
    return '<div class="an-rc__in" role="dialog" aria-modal="true" aria-label="지난주 리캡">' +
      '<div class="an-rc__bars">' + slides.map(function (x, k) { return '<i class="' + (k < i ? 'is-done' : k === i ? 'is-on' : '') + '"></i>'; }).join('') + '</div>' +
      '<button type="button" class="an-x an-rc__x" data-an-rc-x aria-label="닫기">✕</button>' +
      '<div class="an-rc__card an-rc--' + s.k + '">' +
        '<p class="an-rc__k">' + esc(ctx.parent ? (ctx.name || '') + ' 학생의 지난주' : '나의 지난주') + ' · ' + (i + 1) + '/' + slides.length + '</p>' +
        '<h3 class="an-rc__t">' + esc(s.t) + '</h3><p class="an-rc__big">' + esc(s.big) + '</p><p class="an-rc__sub">' + esc(s.sub) + '</p>' +
        (last && ctx.share ? '<button type="button" class="an-btn an-btn--gold" data-an-rc-share>📸 사진으로 공유</button>' : '') +
      '</div>' +
      '<div class="an-rc__nav"><button type="button" class="an-btn" data-an-rc="' + (i - 1) + '"' + (i ? '' : ' disabled') + '>◀ 이전</button>' +
        (last ? '<button type="button" class="an-btn an-btn--main" data-an-rc-x>다 봤어요</button>' : '<button type="button" class="an-btn an-btn--main" data-an-rc="' + (i + 1) + '">다음 ▶</button>') + '</div></div>';
  }
  function openRecap(ctx) {
    var a = analyze(ctx);
    if (!a.recap.length) return;
    closeRecap();
    var el = D.createElement('div');
    el.className = 'an-rc'; el.id = 'anRecap';
    D.body.appendChild(el);
    RC = { el: el, ctx: ctx, slides: a.recap, i: 0 };
    el.innerHTML = recapHtml(ctx, RC.slides, 0);
    if (ctx.prepareShare) ctx.prepareShare();
  }
  function closeRecap() { var e = D.getElementById('anRecap'); if (e) e.remove(); RC = null; }

  /* ---------- 누르기 (한 번만) ---------- */
  var bound = false;
  function bind() {
    if (bound || !D) return;
    bound = true;
    D.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (RC && t.closest('#anRecap')) {
        if (t.closest('[data-an-rc-x]') || t === RC.el) { closeRecap(); return; }
        var go = t.closest('[data-an-rc]');
        if (go && !go.disabled) { RC.i = Math.max(0, Math.min(RC.slides.length - 1, +go.getAttribute('data-an-rc'))); RC.el.innerHTML = recapHtml(RC.ctx, RC.slides, RC.i); return; }
        if (t.closest('[data-an-rc-share]') && RC.ctx.share) { var c = RC.ctx; closeRecap(); c.share(); }
        return;
      }
      if (!FULL || !t.closest('#anFull')) return;
      if (t.closest('[data-an-x]')) { closeFull(); return; }
      if (t.closest('[data-an-recap]')) { var cx = FULL.ctx; closeFull(); openRecap(cx); return; }
      var k = t.closest('[data-an-k]');
      if (k) { var st = FULL.ctx.state; if (st) { st.kind = k.getAttribute('data-an-k'); st.picked = true; } if (FULL.ctx.onKind) FULL.ctx.onKind(); repaintFull(); return; }
      var ar = t.closest('[data-an-area]');
      if (ar) { var nm = ar.getAttribute('data-an-area'); FULL.off[nm] = !FULL.off[nm]; var box = FULL.el.querySelector('[data-an-chart="rate"]'); if (box) box.innerHTML = chartFor(FULL.a, 'rate', FULL.off); return; }
      var sb = t.closest('[data-an-subs]');
      if (sb && FULL.ctx.openSubs) { var q = sb.getAttribute('data-an-subs').split('|'), host = sb.parentNode.querySelector('[data-an-subs-host]'); FULL.ctx.openSubs(q[0], q[1], host); return; }
      var pt = t.closest('[data-an-pt]');
      if (pt) showPoint(pt);
    });
    D.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (RC) closeRecap(); else if (FULL) closeFull(); }
      if ((e.key === 'Enter' || e.key === ' ') && FULL && e.target && e.target.closest && e.target.closest('#anFull [data-an-pt]')) { e.preventDefault(); showPoint(e.target.closest('[data-an-pt]')); }
    });
  }
  bind();

  /* 코치룸 학생 카드 — 글만 돌려주고(창이 통째로 다시 그려짐) 누르기는 click(t, ctx)로 */
  function summary(ctx) { var a = analyze(ctx); return summaryHtml(ctx, a).replace('class="an gm-card', 'class="an an-static gm-card'); }
  function click(t, ctx) {
    if (t.closest('[data-an-full]')) { openFull(ctx); return true; }
    if (t.closest('[data-an-recap]')) { openRecap(ctx); return true; }
    var c = t.closest('[data-an-card]');
    if (c) { openFull(ctx, c.getAttribute('data-an-card')); return true; }
    return false;
  }

  global.Analysis = { build: build, mountSummary: mountSummary, summary: summary, click: click, openFull: openFull, closeFull: closeFull, openRecap: openRecap, closeRecap: closeRecap, refresh: function () { repaintFull(); },
    _lineSvg: lineSvg, _says: says, _full: function () { return FULL; } };
})(window);
