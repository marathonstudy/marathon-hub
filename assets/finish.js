/* ============================================================
   finish.js — 「🏁 완주증」 (1년 완주증 · 이달의 완주증 · 코치룸 인쇄 · 러닝노트 링크 공통 · 20261114a)
   새 데이터는 모으지 않는다 — 앱 과제 기록(data · old) · 배지(staff_badges / hub_badges) · 고른 캐릭터만
   넣지 않는 것: 총 제출 과제 수 · 제출률 % · 분수(n/n) · 모의고사 점수 · 반 등수 · 다른 학생 비교 · 상담 · 전화번호 · 사진

   Finish.compute(data, o) → cert
     o = { kind: 'year' | 'month', from, to, today, badges, game: { char, frame, prop }, name, cls }
     cert = { kind, from, to, name, cls, game, level { i, name }, titles: [{ key, text, score }], hls: [{ key, text, score }],
              flow: [{ m, v }](1년만), low(기록이 아주 적음), items, subs }
   Finish.pick(cert, saved) → { title, hls[], note } — 저장된 고르기(finish_certs)가 있으면 그것 · 없으면 점수 높은 칭호 1 · 하이라이트 3
   Finish.pageHtml(view, opt) — A4 세로 한 장(인쇄) · 링크판(opt.link — 서명 칸 대신 글자만)
     view = Finish.view(cert, saved) — 화면 · 인쇄 · 러닝노트 공개(snap)가 쓰는 모양 하나
   Finish.printDoc(views, opt) — 새 창에 넣어 바로 인쇄(Ctrl+P)할 문서 한 벌 (학생 정보는 화면에서만 · 파일로 남기지 않음)
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function monday(d) { return addDays(d, -((dow(d) + 6) % 7)); }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function ymd(d) { return d.slice(0, 4) + '. ' + (+d.slice(5, 7)) + '. ' + (+d.slice(8, 10)) + '.'; }
  function mon(d) { return (+String(d).slice(5, 7)) + '월'; }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function kstDay(v) { var t = Date.parse(String(v || '')); if (isNaN(t)) return valid(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : ''; return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
  function wavg(xs) { var q = 0, s = 0; xs.forEach(function (x) { s += x.r * x.n; q += x.n; }); return q ? Math.round(s / q) : null; }
  function qsum(xs) { return xs.reduce(function (s, x) { return s + x.n; }, 0); }
  function AB() { return global.Ability; }
  function nextMonth(m) { var x = new Date(m + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); }
  function monthEnd(m) { var x = new Date(m + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); }

  /* 기준 — 이달판은 한 달에 맞게 낮춘다 */
  var RULE = {
    year: { q: 20, area: 30, steadyWeeks: 10, steadyRatio: 0.8, spurt: 6, half: 3, growQ: 8, grow: 5, dayQ: 8, run: 10, streakW: 3, wBadge: 5, together: 8, low: 10 },
    month: { q: 8, area: 10, steadyWeeks: 3, steadyRatio: 0.75, spurt: 8, half: 2, growQ: 4, grow: 6, dayQ: 4, run: 5, streakW: 2, wBadge: 2, together: 0, low: 3 }
  };

  /* ---------- 계산 ---------- */
  function compute(data, o) {
    o = o || {};
    var kind = o.kind === 'month' ? 'month' : 'year', R = RULE[kind], from = o.from, to = o.to;
    data = data || {};
    var Ab = AB();
    if (Ab && Ab.withOld) data = Ab.withOld(data);
    var inR = function (d) { return d && d >= from && d <= to; };
    var its = (Ab ? Ab.items(data) : []).filter(function (x) { return inR(x.date); });
    var subs = ((data.history || data.recent || [])).map(function (h) { return h && h.submittedAt ? kstDay(h.submittedAt) : ''; }).filter(inR).sort();
    var subDays = {}; subs.forEach(function (d) { subDays[d] = (subDays[d] || 0) + 1; });
    var dayList = Object.keys(subDays).sort();
    var titles = [], hls = [];

    /* 꾸준함 — 기록이 있는 첫 주부터 끝 주까지 과제를 낸 주의 비율 */
    var wk = {}; dayList.forEach(function (d) { wk[monday(d)] = 1; });
    var firstW = dayList.length ? monday(dayList[0]) : '', lastW = monday(to > (o.today || to) ? (o.today || to) : to), wn = 0, wOn = 0;
    if (firstW) for (var w = firstW; w <= lastW && wn < 60; w = addDays(w, 7)) { wn++; if (wk[w]) wOn++; }
    var steady = wn >= R.steadyWeeks && wOn / wn >= R.steadyRatio;
    if (steady) titles.push({ key: 'steady', text: '흔들림 없는 페이스메이커', score: 60 + Math.round(wOn / wn * 30) });

    /* 후반 상승 — 앞 절반 · 뒤 절반 정답률 */
    if (its.length) {
      var mid = addDays(its[0].date, Math.floor(days(its[0].date, its[its.length - 1].date) / 2));
      var A = its.filter(function (x) { return x.date < mid; }), B = its.filter(function (x) { return x.date >= mid; });
      if (A.length >= R.half && B.length >= R.half) {
        var dd = wavg(B) - wavg(A);
        if (dd >= R.spurt) titles.push({ key: 'spurt', text: '막판 스퍼트 러너', score: 55 + dd });
      }
    }
    /* 영역 — 큰 영역마다 정답률 · 문제 수 */
    var tops = {};
    its.forEach(function (x) { (tops[x.top] = tops[x.top] || []).push(x); });
    var areas = Object.keys(tops).map(function (k) { return { name: k, rate: wavg(tops[k]), q: qsum(tops[k]), xs: tops[k] }; });
    var best = areas.filter(function (a) { return a.q >= R.area; }).sort(function (a, b) { return b.rate - a.rate; })[0];
    if (best && best.rate >= 85) titles.push({ key: 'master', text: best.name + ' 마스터', score: best.rate - 15 });

    var low = its.length + subs.length < R.low * 2 && subs.length < R.low;
    titles.push({ key: 'together', text: kind === 'month' ? '이번 달도 함께 달린 러너' : '끝까지 함께 달린 러너', score: low ? 90 : 15 });
    titles.push({ key: 'finisher', text: kind === 'month' ? '한 달을 완주한 러너' : '끝까지 달린 완주 러너', score: 20 });

    /* ---------- 하이라이트 후보 (기준에 못 미치면 뺀다) ---------- */
    var bv = global.BadgeView, b = o.badges;
    /* 최장 연속 — 1년: 주간 배지 연속 · 이달: 그달 주간 배지 수 */
    if (b && bv && kind === 'year') { var br = bv.bestRun ? bv.bestRun(b) : 0; if (br >= R.streakW) hls.push({ key: 'streak', text: '주간 배지 ' + br + '주 연속', score: 40 + br * 2 }); }
    var wGot = b ? (b.weeks || []).filter(function (x) { var k = String(x.week || x.from || '').slice(0, 10); return x.perfect && inR(k); }).length : 0;
    if (wGot >= R.wBadge) hls.push({ key: 'wbadge', text: (kind === 'month' ? '이달 ' : '') + '주간 배지 ⭐ ' + wGot + '개', score: 30 + wGot * (kind === 'month' ? 8 : 1) });
    var mGot = b ? (b.months || []).filter(function (m) { return inR(m + '-01') || (kind === 'month' && m === from.slice(0, 7)); }).length : 0;
    if (mGot) hls.push({ key: 'mbadge', text: kind === 'month' ? '이달의 월간 배지 🏅' : '월간 배지 🏅 ' + mGot + '개', score: kind === 'month' ? 75 : 45 + mGot * 5 });
    /* 연속 제출 — 과제 있던 평일 기준 가장 긴 줄 */
    var run = 0, bestRun = 0;
    if (global.Game && Game.hwDays) Game.hwDays(data, o.today || to).forEach(function (d) { if (!inR(d.date)) return; if (d.done) { run++; if (run > bestRun) bestRun = run; } else run = 0; });
    if (bestRun >= R.run) hls.push({ key: 'run', text: '연속 제출 최장 ' + bestRun + '일', score: 30 + bestRun });
    /* 가장 성장한 영역 — 앞쪽 · 뒤쪽 정답률 */
    var grow = null;
    areas.forEach(function (a) {
      if (a.xs.length < 2) return;
      var m2 = addDays(a.xs[0].date, Math.floor(days(a.xs[0].date, a.xs[a.xs.length - 1].date) / 2));
      var P = a.xs.filter(function (x) { return x.date < m2; }), Q = a.xs.filter(function (x) { return x.date >= m2; });
      if (qsum(P) < R.growQ || qsum(Q) < R.growQ) return;
      var g = wavg(Q) - wavg(P);
      if (g >= R.grow && (!grow || g > grow.d)) grow = { name: a.name, d: g };
    });
    if (grow) hls.push({ key: 'grow', text: '가장 성장한 영역 · ' + grow.name + ' +' + grow.d + '%', score: 45 + grow.d * 2 });
    /* 주력 스킬 */
    var skill = areas.filter(function (a) { return a.q >= R.q; }).sort(function (a, b2) { return b2.rate - a.rate; })[0];
    if (skill && skill.rate >= 75) hls.push({ key: 'skill', text: '주력 스킬 · ' + skill.name + ' ' + skill.rate + '%', score: skill.rate - 30 });
    /* 가장 꾸준했던 달(1년) · 주(이달) — 과제를 낸 날이 가장 많은 */
    var by = {};
    dayList.forEach(function (d) { var k = kind === 'year' ? d.slice(0, 7) : monday(d); by[k] = (by[k] || 0) + 1; });
    var top = Object.keys(by).sort(function (x, y) { return by[y] - by[x] || (x < y ? -1 : 1); })[0];
    if (top && by[top] >= (kind === 'year' ? 8 : 4)) hls.push({ key: 'steadyp', text: kind === 'year' ? '가장 꾸준했던 달 · ' + mon(top + '-01') : '가장 꾸준했던 주 · ' + md(top) + ' 주', score: 28 + by[top] });
    /* 최고 정답률을 찍은 날 */
    var byDay = {};
    its.forEach(function (x) { (byDay[x.date] = byDay[x.date] || []).push(x); });
    var bd = Object.keys(byDay).filter(function (d) { return qsum(byDay[d]) >= R.dayQ; }).map(function (d) { return { d: d, v: wavg(byDay[d]) }; }).sort(function (x, y) { return y.v - x.v || (x.d < y.d ? 1 : -1); })[0];
    if (bd && bd.v >= 80) hls.push({ key: 'bestday', text: '최고 정답률 ' + bd.v + '% · ' + md(bd.d), score: bd.v - 45 });
    /* 함께한 기간 */
    if (kind === 'year' && dayList.length) { var wks = Math.max(1, Math.round(days(dayList[0], dayList[dayList.length - 1]) / 7) + 1); if (wks >= R.together) hls.push({ key: 'weeks', text: '함께 달린 시간 ' + wks + '주', score: 25 + Math.round(wks / 4) }); }
    if (kind === 'month' && dayList.length && days(dayList[0], dayList[dayList.length - 1]) >= 20) hls.push({ key: 'weeks', text: '한 달 내내 함께 달렸어요', score: 32 });

    /* 1년판 — 정답률 월별 흐름(기록 없는 달은 끊김) */
    var flow = [];
    if (kind === 'year') for (var m = from.slice(0, 8) + '01'; m <= to && flow.length < 13; m = nextMonth(m)) { var e = monthEnd(m), xs = its.filter(function (x) { return x.date >= m && x.date <= e; }); flow.push({ m: m, v: xs.length ? wavg(xs) : null }); }

    var G = global.Game, lv = G ? G.compute(data, { today: o.today || to }).level : { i: 0, name: '' };
    return { kind: kind, from: from, to: to, name: o.name || '', cls: o.cls || '', game: o.game || {}, level: { i: lv.i, name: lv.name },
             titles: titles.sort(function (a, b2) { return b2.score - a.score; }), hls: hls.sort(function (a, b2) { return b2.score - a.score; }),
             flow: flow, low: low, items: its.length, subs: subs.length };
  }

  /* 저장된 고르기 + 자동 → 화면 · 인쇄 · 공개에 쓰는 모양 */
  function view(cert, saved) {
    saved = saved || {};
    var t = cert.titles.filter(function (x) { return x.key === saved.title_key; })[0] || cert.titles[0];
    var keys = Array.isArray(saved.hl_keys) ? saved.hl_keys : [];
    var hl = keys.length ? (keys[0] === '-' ? [] : keys.map(function (k) { return cert.hls.filter(function (x) { return x.key === k; })[0]; }).filter(Boolean)) : cert.hls.slice(0, 3);
    return { kind: cert.kind, from: cert.from, to: cert.to, name: cert.name, cls: cert.cls, game: cert.game, level: cert.level,
             title: t ? t.text : '', hls: hl.slice(0, 3).map(function (x) { return x.text; }), flow: cert.flow, low: cert.low,
             note: saved.note_ok ? String(saved.note || '') : '', noteOk: !!saved.note_ok };
  }

  /* ---------- 그림 ---------- */
  function charSrc(id, base) { return global.Game ? Game.charSrc(id || 'maratoni', base) : (base || '../assets/chars/') + 'maratoni.png'; }
  function flowSvg(flow) {
    var pts = flow.map(function (p, i) { return { i: i, v: p.v, m: p.m }; }), n = pts.length;
    if (pts.filter(function (p) { return p.v != null; }).length < 2) return '';
    var W = 520, H = 96, L = 30, Rr = 12, T = 14, B = 22, lo = Math.max(0, Math.floor(Math.min.apply(null, pts.filter(function (p) { return p.v != null; }).map(function (p) { return p.v; })) / 10) * 10 - 10), x = function (i) { return n > 1 ? L + i * (W - L - Rr) / (n - 1) : L; }, y = function (v) { return T + (100 - v) * (H - T - B) / (100 - lo || 1); };
    var segs = [], cur = [];
    pts.forEach(function (p) { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); });
    if (cur.length) segs.push(cur);
    var grid = [lo, Math.round((lo + 100) / 2), 100].map(function (v) { return '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="fc-g"/><text x="' + (L - 4) + '" y="' + (y(v) + 3) + '" class="fc-ax" text-anchor="end">' + v + '</text>'; }).join('');
    var lines = segs.map(function (s) { return s.length > 1 ? '<polyline class="fc-ln" points="' + s.map(function (p) { return x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ') + '"/>' : ''; }).join('');
    var dots = pts.map(function (p) { return p.v == null ? '' : '<circle cx="' + x(p.i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3.2" class="fc-dot"/>'; }).join('');
    var xl = pts.map(function (p) { return '<text x="' + x(p.i).toFixed(1) + '" y="' + (H - 6) + '" class="fc-ax" text-anchor="middle">' + (+p.m.slice(5, 7)) + '</text>'; }).join('');
    return '<svg class="fc-flow" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="정답률 월별 흐름">' + grid + lines + dots + xl + '</svg>';
  }
  /* 결승선 — 체크무늬 띠 + 리본 · 마라토니 · 마라부기가 통과 */
  function finishLine(base, small) {
    var sq = '';
    for (var r = 0; r < 2; r++) for (var c = 0; c < 4; c++) sq += '<rect x="' + (c * 6) + '" y="' + (r * 6) + '" width="6" height="6" fill="' + ((r + c) % 2 ? '#fff' : '#2E2266') + '"/>';
    return '<div class="fc-line' + (small ? ' fc-line--s' : '') + '">' +
      '<img class="fc-mascot fc-mascot--a" src="' + esc(charSrc('maratoni', base)) + '" alt="마라토니">' +
      '<svg class="fc-tape" viewBox="0 0 240 40" aria-hidden="true"><path d="M0 22 Q60 14 120 22 T240 22" fill="none" stroke="#E0A920" stroke-width="3"/>' +
        '<g transform="translate(108 4)">' + sq + '</g><text x="120" y="38" text-anchor="middle" class="fc-tape__t">FINISH</text></svg>' +
      '<img class="fc-mascot fc-mascot--b" src="' + esc(charSrc('marabugi', base)) + '" alt="마라부기">' +
    '</div>';
  }
  function corner(pos) {
    return '<svg class="fc-cn fc-cn--' + pos + '" viewBox="0 0 60 60" aria-hidden="true"><path d="M4 56 L4 4 L56 4" fill="none" stroke="#5A3FD0" stroke-width="2"/><path d="M12 56 L12 12 L56 12" fill="none" stroke="#E0A920" stroke-width="1.2"/><circle cx="4" cy="4" r="3" fill="#E0A920"/></svg>';
  }
  /* A4 한 장 — opt = { base(그림 주소 앞), link(러닝노트 · 서명 칸 없음), sign('마라톤국어 대표 김종현') } */
  function pageHtml(v, opt) {
    opt = opt || {};
    var year = v.kind === 'year', base = opt.base, g = v.game || {};
    var title = year ? '완주증' : mon(v.from) + ' 완주증';
    var period = year ? ymd(v.from) + ' ~ ' + ymd(v.to) : v.from.slice(0, 4) + '년 ' + mon(v.from);
    var ava = '<span class="fc-ava"><img src="' + esc(charSrc(g.char, base)) + '" alt="' + esc(global.Game ? Game.charOf(g.char).name : '') + '"></span>';
    var hl = v.hls.length ? '<ul class="fc-hls">' + v.hls.map(function (t) { return '<li><span class="fc-hl__i" aria-hidden="true">★</span>' + esc(t) + '</li>'; }).join('') + '</ul>'
      : '<p class="fc-plain">' + (year ? '한 해 동안 함께 달렸어요.' : '이번 달도 함께 달렸어요.') + '</p>';
    var flow = year && v.flow && v.flow.length ? flowSvg(v.flow) : '';
    var sign = opt.sign || '마라톤국어 대표 김종현';
    return '<article class="fc-page fc-page--' + (year ? 'year' : 'month') + (opt.link ? ' fc-page--link' : '') + '">' +
      (year ? corner('tl') + corner('tr') + corner('bl') + corner('br') : '') +
      '<div class="fc-in">' +
        '<p class="fc-brand">마라톤국어</p>' +
        '<h1 class="fc-title">' + esc(title) + '</h1>' +
        '<p class="fc-sub">' + (year ? 'FINISHER CERTIFICATE' : 'MONTHLY FINISHER') + '</p>' +
        '<div class="fc-who">' + ava +
          '<div class="fc-who__t"><p class="fc-name">' + esc(v.name) + '</p>' +
          '<p class="fc-meta">' + esc([v.cls, period].filter(Boolean).join(' · ')) + '</p>' +
          '<p class="fc-lv">Lv.' + ((v.level && v.level.i) + 1) + ' ' + esc((v.level && v.level.name) || '') + '</p></div></div>' +
        (v.title ? '<p class="fc-ribbon"><span>' + esc(v.title) + '</span></p>' : '') +
        hl +
        (flow ? '<div class="fc-box"><p class="fc-box__t">정답률 흐름</p>' + flow + '</div>' : '') +
        (v.note ? '<div class="fc-box fc-note"><p class="fc-box__t">선생님 한마디</p><p class="fc-note__t">' + esc(v.note) + '</p></div>' : '') +
        finishLine(base, !year) +
        (year ? '<div class="fc-foot"><span class="fc-date">' + ymd(v.to) + '</span>' +
          (opt.link ? '<span class="fc-sign">' + esc(sign) + '</span>' : '<span class="fc-sign">' + esc(sign) + ' <span class="fc-sign__box" aria-label="서명"></span></span>') + '</div>'
          : '<div class="fc-foot fc-foot--m"><span class="fc-sign">마라톤국어</span></div>') +
      '</div></article>';
  }
  /* 새 창 인쇄 문서 — css 는 링크로 · 그림이 다 뜬 뒤 인쇄 */
  function printDoc(views, opt) {
    opt = opt || {};
    var css = opt.css || '../assets/finish.css';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(opt.title || '완주증') + '</title>' +
      '<link rel="stylesheet" href="' + esc(css) + '"><style>@page { size: A4 portrait; margin: 0; } html, body { margin: 0; }</style></head><body class="fc-print">' + views.map(function (v) { return pageHtml(v, opt); }).join('') + '</body></html>';
  }

  global.Finish = { compute: compute, view: view, pageHtml: pageHtml, printDoc: printDoc, flowSvg: flowSvg, RULE: RULE };
})(window);
