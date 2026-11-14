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
  function mdK(d) { return (+d.slice(5, 7)) + '월 ' + (+d.slice(8, 10)) + '일'; }          /* 완주증 글 — 「11/12」는 분수처럼 보여 「11월 12일」 (20261114e) */
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
    if (b && bv && kind === 'year') { var br = bv.bestRun ? bv.bestRun(b) : 0; if (br >= R.streakW) hls.push({ key: 'streak', icon: '⭐', big: br + '주', desc: '주간 배지 연속', text: '주간 배지 ' + br + '주 연속', score: 40 + br * 2 }); }
    var wGot = b ? (b.weeks || []).filter(function (x) { var k = String(x.week || x.from || '').slice(0, 10); return x.perfect && inR(k); }).length : 0;
    if (wGot >= R.wBadge) hls.push({ key: 'wbadge', icon: '⭐', big: wGot + '개', desc: (kind === 'month' ? '이달 ' : '') + '주간 배지', text: (kind === 'month' ? '이달 ' : '') + '주간 배지 ⭐ ' + wGot + '개', score: 30 + wGot * (kind === 'month' ? 8 : 1) });
    var mGot = b ? (b.months || []).filter(function (m) { return inR(m + '-01') || (kind === 'month' && m === from.slice(0, 7)); }).length : 0;
    if (mGot) hls.push({ key: 'mbadge', icon: '🏅', big: kind === 'month' ? '획득' : mGot + '개', desc: kind === 'month' ? '이달의 월간 배지' : '월간 배지', text: kind === 'month' ? '이달의 월간 배지 🏅' : '월간 배지 🏅 ' + mGot + '개', score: kind === 'month' ? 75 : 45 + mGot * 5 });
    /* 연속 제출 — 과제 있던 평일 기준 가장 긴 줄 */
    var run = 0, bestRun = 0;
    if (global.Game && Game.hwDays) Game.hwDays(data, o.today || to).forEach(function (d) { if (!inR(d.date)) return; if (d.done) { run++; if (run > bestRun) bestRun = run; } else run = 0; });
    if (bestRun >= R.run) hls.push({ key: 'run', icon: '🔥', big: bestRun + '일', desc: '연속 제출 최장', text: '연속 제출 최장 ' + bestRun + '일', score: 30 + bestRun });
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
    if (grow) hls.push({ key: 'grow', icon: '📈', big: '+' + grow.d + '%', desc: '가장 성장한 영역 · ' + grow.name, text: '가장 성장한 영역 · ' + grow.name + ' +' + grow.d + '%', score: 45 + grow.d * 2 });
    /* 주력 스킬 */
    var skill = areas.filter(function (a) { return a.q >= R.q; }).sort(function (a, b2) { return b2.rate - a.rate; })[0];
    if (skill && skill.rate >= 75) hls.push({ key: 'skill', icon: '🎯', big: skill.rate + '%', desc: '주력 스킬 · ' + skill.name, text: '주력 스킬 · ' + skill.name + ' ' + skill.rate + '%', score: skill.rate - 30 });
    /* 가장 꾸준했던 달(1년) · 주(이달) — 과제를 낸 날이 가장 많은 */
    var by = {};
    dayList.forEach(function (d) { var k = kind === 'year' ? d.slice(0, 7) : monday(d); by[k] = (by[k] || 0) + 1; });
    var top = Object.keys(by).sort(function (x, y) { return by[y] - by[x] || (x < y ? -1 : 1); })[0];
    if (top && by[top] >= (kind === 'year' ? 8 : 4)) hls.push({ key: 'steadyp', icon: '📅', big: kind === 'year' ? mon(top + '-01') : mdK(top) + ' 주', desc: kind === 'year' ? '가장 꾸준했던 달' : '가장 꾸준했던 주', text: kind === 'year' ? '가장 꾸준했던 달 · ' + mon(top + '-01') : '가장 꾸준했던 주 · ' + mdK(top) + ' 주', score: 28 + by[top] });
    /* 최고 정답률을 찍은 날 */
    var byDay = {};
    its.forEach(function (x) { (byDay[x.date] = byDay[x.date] || []).push(x); });
    var bd = Object.keys(byDay).filter(function (d) { return qsum(byDay[d]) >= R.dayQ; }).map(function (d) { return { d: d, v: wavg(byDay[d]) }; }).sort(function (x, y) { return y.v - x.v || (x.d < y.d ? 1 : -1); })[0];
    if (bd && bd.v >= 80) hls.push({ key: 'bestday', icon: '💯', big: bd.v + '%', desc: '최고 정답률 · ' + mdK(bd.d), text: '최고 정답률 ' + bd.v + '% · ' + mdK(bd.d), score: bd.v - 45 });
    /* 함께한 기간 */
    if (kind === 'year' && dayList.length) { var wks = Math.max(1, Math.round(days(dayList[0], dayList[dayList.length - 1]) / 7) + 1); if (wks >= R.together) hls.push({ key: 'weeks', icon: '🏃', big: wks + '주', desc: '함께 달린 시간', text: '함께 달린 시간 ' + wks + '주', score: 25 + Math.round(wks / 4) }); }
    if (kind === 'month' && dayList.length && days(dayList[0], dayList[dayList.length - 1]) >= 20) hls.push({ key: 'weeks', icon: '🏃', big: '한 달', desc: '내내 함께 달렸어요', text: '한 달 내내 함께 달렸어요', score: 32 });

    /* 1년판 — 정답률 월별 흐름(기록 없는 달은 끊김) */
    var flow = [];
    if (kind === 'year') for (var m = from.slice(0, 8) + '01'; m <= to && flow.length < 13; m = nextMonth(m)) { var e = monthEnd(m), xs = its.filter(function (x) { return x.date >= m && x.date <= e; }); flow.push({ m: m, v: xs.length ? wavg(xs) : null }); }

    var medals = kind === 'year' && b ? (b.months || []).filter(function (m) { return m >= from.slice(0, 7) && m <= to.slice(0, 7); }) : [];
    var stats = null;
    if (kind === 'year' && Ab && Ab.compute) { try { var cc = Ab.compute(data, 'y1', to, { noApp: true }); stats = { total: cc.total, groups: (cc.groups || []).map(function (g) { return { name: g.name, rate: g.rate, grade: g.grade, enough: g.enough, areas: g.areas.map(function (a) { return { name: a.name, rate: a.rate, grade: a.grade, enough: a.enough }; }) }; }) }; } catch (e) { stats = null; } }
    var G = global.Game, lv = G ? G.compute(data, { today: o.today || to }).level : { i: 0, name: '' };
    return { kind: kind, from: from, to: to, name: o.name || '', cls: o.cls || '', game: o.game || {}, level: { i: lv.i, name: lv.name },
             titles: titles.sort(function (a, b2) { return b2.score - a.score; }), hls: hls.sort(function (a, b2) { return b2.score - a.score; }),
             flow: flow, medals: medals, stats: stats, low: low, items: its.length, subs: subs.length };
  }

  /* 저장된 고르기 + 자동 → 화면 · 인쇄 · 공개에 쓰는 모양 */
  function view(cert, saved) {
    saved = saved || {};
    var t = cert.titles.filter(function (x) { return x.key === saved.title_key; })[0] || cert.titles[0];
    var keys = Array.isArray(saved.hl_keys) ? saved.hl_keys : [];
    var hl = keys.length ? (keys[0] === '-' ? [] : keys.map(function (k) { return cert.hls.filter(function (x) { return x.key === k; })[0]; }).filter(Boolean)) : cert.hls.slice();      /* 기본은 후보 전부(점수 높은 순 · 20261114e) */
    return { kind: cert.kind, from: cert.from, to: cert.to, name: cert.name, cls: cert.cls, game: cert.game, level: cert.level,
             title: t ? t.text : '', hls: hl.map(function (x) { return { key: x.key, icon: x.icon || '★', big: x.big || '', desc: x.desc || x.text, text: x.text }; }),
             flow: cert.flow, medals: cert.medals || [], stats: cert.stats || null, low: cert.low,
             note: saved.note_ok ? String(saved.note || '') : '', noteOk: !!saved.note_ok };
  }

  /* ---------- 그림 (20261114c — 1년판 1쪽 균형 · 하이라이트 카드 · 2쪽 「나의 1년 레이스 기록」) ---------- */
  function charSrc(id, base) { return global.Game ? Game.charSrc(id || 'maratoni', base) : (base || '../assets/chars/') + 'maratoni.png'; }
  /* 옛 공개본(글자만)도 카드로 */
  function hlOf(h) { return typeof h === 'string' ? { icon: '★', big: '', desc: h, text: h } : h || { icon: '★', big: '', desc: '' }; }
  function flowSvg(flow, big) {
    var pts = (flow || []).map(function (p, i) { return { i: i, v: p.v, m: p.m }; }), n = pts.length, vs = pts.filter(function (p) { return p.v != null; });
    if (vs.length < 2) return '';
    var W = 520, H = big ? 165 : 96, L = 30, Rr = 12, T = 16, B = 24;
    var lo = Math.max(0, Math.floor(Math.min.apply(null, vs.map(function (p) { return p.v; })) / 10) * 10 - 10);
    var x = function (i) { return n > 1 ? L + i * (W - L - Rr) / (n - 1) : L; }, y = function (v) { return T + (100 - v) * (H - T - B) / (100 - lo || 1); };
    var segs = [], cur = [];
    pts.forEach(function (p) { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); });
    if (cur.length) segs.push(cur);
    var grid = [lo, Math.round((lo + 100) / 2), 100].map(function (v) { return '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="fc-g"/><text x="' + (L - 4) + '" y="' + (y(v) + 3) + '" class="fc-ax" text-anchor="end">' + v + '</text>'; }).join('');
    var lines = segs.map(function (s) { return s.length > 1 ? '<polyline class="fc-ln" points="' + s.map(function (p) { return x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ') + '"/>' : ''; }).join('');
    var dots = pts.map(function (p) { return p.v == null ? '' : '<circle cx="' + x(p.i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (big ? 4 : 3.2) + '" class="fc-dot"/>' + (big ? '<text x="' + x(p.i).toFixed(1) + '" y="' + (y(p.v) - 8).toFixed(1) + '" class="fc-ax fc-ax--v" text-anchor="middle">' + p.v + '</text>' : ''); }).join('');
    var xl = pts.map(function (p) { return '<text x="' + x(p.i).toFixed(1) + '" y="' + (H - 7) + '" class="fc-ax" text-anchor="middle">' + (+p.m.slice(5, 7)) + '월</text>'; }).join('');
    var brk = lo > 0 ? '<text x="' + (L - 13) + '" y="' + (H - B + 11) + '" class="fc-ax fc-brk" text-anchor="end">~</text>' : '';      /* 세로축이 0 에서 시작하지 않음 — 「50」 아래 · 「1월」 왼쪽 */
    return '<svg class="fc-flow' + (big ? ' fc-flow--big' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="정답률 월별 흐름">' + grid + brk + lines + dots + xl + '</svg>';
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
  function corners() { return corner('tl') + corner('tr') + corner('bl') + corner('br'); }
  function cardHtml(h) {
    h = hlOf(h);
    return '<div class="fc-card"><span class="fc-card__i" aria-hidden="true">' + esc(h.icon || '★') + '</span>' +
      (h.big ? '<b class="fc-card__b">' + esc(h.big) + '</b>' : '') + '<span class="fc-card__d">' + esc(h.desc || h.text || '') + '</span></div>';
  }
  function cardsHtml(list, cls) { return '<div class="fc-cards ' + (cls || '') + '">' + list.map(cardHtml).join('') + '</div>'; }
  var P1 = 6;                                            /* 1쪽 하이라이트 최대 */
  function periodText(v) { return v.kind === 'year' ? ymd(v.from) + ' ~ ' + ymd(v.to) : v.from.slice(0, 4) + '년 ' + mon(v.from); }
  function noteCls(v) { var n = String(v.note || '').length; return !n ? ' fc-note-0' : n > 150 ? ' fc-note-l' : ''; }

  /* ---------- 선생님 한마디 글 (20261114h) — 「**글자**」 → 굵게 · 빈 줄(문단) 살림 ---------- */
  function segsOf(line) {
    var out = [], re = /\*\*([\s\S]+?)\*\*/g, i = 0, m;
    while ((m = re.exec(line))) { if (m.index > i) out.push({ t: line.slice(i, m.index), b: 0 }); out.push({ t: m[1], b: 1 }); i = re.lastIndex; }
    if (i < line.length) out.push({ t: line.slice(i), b: 0 });
    return out.map(function (s) { return { t: s.t.replace(/\*\*/g, ''), b: s.b }; }).filter(function (s) { return s.t; });
  }
  function segHtml(s) { return s.b ? '<b>' + esc(s.t) + '</b>' : esc(s.t); }
  /* 상자 안(이달판 · 러닝노트) — 줄바꿈은 그대로(pre-wrap) · 굵게만 */
  function noteInline(t) { return String(t || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return segsOf(l).map(segHtml).join(''); }).join('\n'); }
  /* 편지 — 문단 <p data-k> · 줄 <br> · 문장 <span class="fc-ls">(넘치면 문장 단위로 다음 면에 이어짐) · 빈 줄 1 ~ 2개 = 문단 사이 한 줄 · 두 줄 */
  function letterBody(t) {
    var lines = String(t || '').replace(/\r\n?/g, '\n').split('\n'), paras = [], cur = null;
    lines.forEach(function (l) {
      if (!l.trim()) { if (cur) { paras.push(cur); cur = null; } if (paras.length) paras[paras.length - 1].gap = Math.min(2, paras[paras.length - 1].gap + 1); return; }
      if (!cur) cur = { ls: [], gap: 0 };
      cur.ls.push(l.trim());
    });
    if (cur) paras.push(cur);
    if (paras.length) paras[paras.length - 1].gap = 0;
    return paras.map(function (p, k) {
      return '<p class="fc-lp fc-lp--g' + p.gap + '" data-k="' + k + '">' + p.ls.map(function (l) {
        var sents = [], now = '';
        segsOf(l).forEach(function (s) {
          var parts = s.t.replace(/([.!?…~])\s+/g, '$1\u0001').split('\u0001');
          parts.forEach(function (x, j) { if (j) { sents.push(now); now = ''; } if (x) now += segHtml({ t: x, b: s.b }); });
        });
        if (now) sents.push(now);
        return sents.map(function (x) { return '<span class="fc-ls">' + x + '</span>'; }).join(' ');
      }).join('<br>') + '</p>';
    }).join('');
  }
  /* 원장님 서명 — opt.signImg(코치룸이 직원 로그인으로 받은 그림 · 인쇄 · 크게 보기에만) · 없거나 못 받으면 빈 서명 칸 */
  function signBox(opt) {
    return opt && opt.signImg ? '<span class="fc-sign__box has-img"><img class="fc-sign__img" src="' + esc(opt.signImg) + '" alt="서명"></span>' : '<span class="fc-sign__box" aria-label="서명"></span>';
  }
  /* 「선생님의 편지」 쪽 — 같은 테두리 · 작은 머리글 · To. ○○○ · 줄 노트 · From. 김종현 쌤 + 서명 · 날짜(종강일) · 모서리 마라토니 · 마라부기
     글자 크기는 fit 이 한 면에 맞춰 고른다(LF.max ~ LF.min) · 그래도 넘치면 같은 모양의 다음 면으로 이어짐(fc-letter--more → fc-letter--cont) */
  var LF = { max: 30, min: 15 };
  function letterHtml(v, opt, spare) {
    var base = opt.base;
    return '<article class="fc-page fc-letter' + (spare ? ' fc-letter--spare' : '') + '">' + corners() +
      '<div class="fc-in fc-in--l">' +
        '<header class="fc-lhd"><p class="fc-brand fc-brand--s">마라톤국어</p><p class="fc-lhd__t">선생님의 편지</p></header>' +
        '<p class="fc-to">To. <b>' + esc(v.name) + '</b><span class="fc-to__c"> · 이어서</span></p>' +
        '<div class="fc-lbody" style="font-size:' + LF.max + 'px">' + letterBody(v.note) + '</div>' +
        '<p class="fc-lnext">다음 장에 이어져요 →</p>' +
        '<div class="fc-from"><span class="fc-from__m" aria-hidden="true"><img src="' + esc(charSrc('maratoni', base)) + '" alt=""><img src="' + esc(charSrc('marabugi', base)) + '" alt=""></span>' +
          '<div class="fc-from__r"><p class="fc-from__n"><span class="fc-sign">From. 김종현 쌤 ' + signBox(opt) + '</span></p><p class="fc-from__d">' + ymd(v.to) + '</p></div></div>' +
      '</div></article>';
  }

  /* 1쪽 — opt = { base(그림 주소 앞), link(러닝노트 · 서명 칸 없음), sign } */
  function pageHtml(v, opt) {
    opt = opt || {};
    if (v.kind !== 'year') return monthHtml(v, opt);
    var base = opt.base, g = v.game || {}, hls = (v.hls || []).map(hlOf), p1 = hls.slice(0, P1), n = p1.length;
    var sign = opt.sign || '마라톤국어 대표 김종현';
    var cards = n ? cardsHtml(p1, n > 3 ? 'fc-cards--grid' : 'fc-cards--col') : '<p class="fc-plain">한 해 동안 함께 달렸어요.</p>';
    /* 20261114h — 인쇄 · 코치룸에서는 한마디를 마지막 쪽 「선생님의 편지」로(1쪽 상자 없음 · 캐릭터 · 칭호 · 카드가 그만큼 커짐) · 러닝노트 링크판만 상자 그대로 */
    var inNote = opt.link && v.note;
    return '<article class="fc-page fc-page--year fc-y fc-h' + n + (inNote ? noteCls(v) : ' fc-note-0') + (opt.link ? ' fc-page--link' : '') + '">' + corners() +
      '<div class="fc-in fc-in--y">' +
        '<header class="fc-hd"><p class="fc-brand">마라톤국어</p><h1 class="fc-title">완주증</h1><p class="fc-sub">FINISHER CERTIFICATE</p></header>' +
        '<div class="fc-person"><p class="fc-name">' + esc(v.name) + '</p><p class="fc-meta">' + esc([v.cls, periodText(v)].filter(Boolean).join(' · ')) + '</p></div>' +
        '<div class="fc-hero"><span class="fc-ava fc-ava--big"><img src="' + esc(charSrc(g.char, base)) + '" alt="' + esc(global.Game ? Game.charOf(g.char).name : '') + '"></span>' +
          '<span class="fc-lv">Lv.' + ((v.level && v.level.i) + 1) + ' ' + esc((v.level && v.level.name) || '') + '</span></div>' +
        (v.title ? '<p class="fc-ribbon"><span>' + esc(v.title) + '</span></p>' : '') +
        cards +
        (inNote ? '<div class="fc-box fc-note"><p class="fc-box__t">선생님 한마디</p><p class="fc-note__t">' + noteInline(v.note) + '</p></div>' : '') +
        '<div class="fc-end">' + finishLine(base, false) +
          '<div class="fc-foot"><span class="fc-date">' + ymd(v.to) + '</span>' +
          (opt.link ? '<span class="fc-sign">' + esc(sign) + '</span>' : '<span class="fc-sign">' + esc(sign) + ' ' + signBox(opt) + '</span>') + '</div></div>' +
      '</div></article>';
  }
  function monthHtml(v, opt) {
    var base = opt.base, g = v.game || {}, hls = (v.hls || []).map(hlOf);
    var cards = hls.length ? cardsHtml(hls.slice(0, 8), hls.length > 3 ? 'fc-cards--grid' : 'fc-cards--col') : '<p class="fc-plain">이번 달도 함께 달렸어요.</p>';
    return '<article class="fc-page fc-page--month' + (opt.link ? ' fc-page--link' : '') + '"><div class="fc-in">' +
      '<p class="fc-brand">마라톤국어</p><h1 class="fc-title">' + esc(mon(v.from) + ' 완주증') + '</h1><p class="fc-sub">MONTHLY FINISHER</p>' +
      '<div class="fc-who"><span class="fc-ava"><img src="' + esc(charSrc(g.char, base)) + '" alt=""></span><div class="fc-who__t"><p class="fc-name">' + esc(v.name) + '</p>' +
        '<p class="fc-meta">' + esc([v.cls, periodText(v)].filter(Boolean).join(' · ')) + '</p><p class="fc-lv">Lv.' + ((v.level && v.level.i) + 1) + ' ' + esc((v.level && v.level.name) || '') + '</p></div></div>' +
      (v.title ? '<p class="fc-ribbon"><span>' + esc(v.title) + '</span></p>' : '') + cards +
      (v.note ? '<div class="fc-box fc-note"><p class="fc-box__t">선생님 한마디</p><p class="fc-note__t">' + noteInline(v.note) + '</p></div>' : '') +
      finishLine(base, true) +
      (opt.link ? '<div class="fc-foot fc-foot--m"><span class="fc-sign">마라톤국어</span></div>'
        : '<div class="fc-foot fc-foot--ms"><span class="fc-date">' + ymd(v.to) + '</span><span class="fc-sign">마라톤국어 대표 김종현 ' + signBox(opt) + '</span></div>') +      /* 인쇄본 — 서명 자리 (20261114h) */
      '</div></article>';
  }
  /* 2쪽 「나의 1년 레이스 기록」 — 월간 메달 12칸 → 정답률 흐름(크게) → 능력치 스탯 카드(묶음별) → 1쪽에 못 들어간 하이라이트 */
  function medalsHtml(v) {
    var y = v.to.slice(0, 4), got = {}, cells = '';
    (v.medals || []).forEach(function (m) { got[m] = 1; });
    for (var m = 1; m <= 12; m++) { var ym = y + '-' + String(m).padStart(2, '0'); cells += '<span class="fc-md' + (got[ym] ? ' is-got' : '') + '"><i aria-hidden="true">' + (got[ym] ? '🏅' : '') + '</i><small>' + m + '월</small></span>'; }
    return '<section class="fc-sec fc-sec--md"><p class="fc-box__t">월간 메달 <span class="fc-box__n">' + (v.medals || []).length + '개</span></p><div class="fc-mds">' + cells + '</div></section>';
  }
  function statsHtml(v) {
    var st = v.stats;
    if (!st || !st.groups || !st.groups.length) return '';
    var gr = function (x) { return x.enough && x.grade ? '<span class="fc-gr fc-gr--' + x.grade + '">' + x.grade + '</span>' : '<small>%</small>'; };
    return '<section class="fc-sec fc-sec--st"><p class="fc-box__t">능력치' + (st.total ? ' <span class="fc-box__n">종합 ' + (st.total.enough && st.total.grade ? st.total.grade + ' · ' : '') + st.total.rate + '</span>' : '') + '</p>' +
      st.groups.map(function (g) {
        return '<div class="fc-sg"><p class="fc-sg__t">' + esc(g.name) + ' <b>' + g.rate + '</b>' + gr(g) + '</p><div class="fc-chips">' +
          g.areas.map(function (a) { return '<span class="fc-chip' + (a.enough && a.grade ? ' fc-chip--' + a.grade : ' is-few') + '"><span class="fc-chip__n">' + esc(a.name) + '</span><b>' + a.rate + '</b>' + gr(a) + '</span>'; }).join('') + '</div></div>';
      }).join('') + '</section>';
  }
  function page2Html(v, opt, extra, part) {
    var flow = flowSvg(v.flow, true);
    return '<article class="fc-page fc-page--year fc-p2' + (opt.link ? ' fc-page--link' : '') + '">' + corners() +
      '<div class="fc-in fc-in--p2">' +
        '<header class="fc-hd fc-hd--p2"><p class="fc-brand">마라톤국어</p><h1 class="fc-title fc-title--p2">나의 1년 레이스 기록</h1>' +
          '<p class="fc-meta">' + esc([v.name, v.cls, periodText(v)].filter(Boolean).join(' · ')) + (part ? ' · ' + part : '') + '</p></header>' +
        (part ? '' : medalsHtml(v) + (flow ? '<section class="fc-sec fc-sec--flow"><p class="fc-box__t">1년 정답률 흐름</p><div class="fc-flowbox">' + flow + '</div></section>' : '') + statsHtml(v)) +
        (extra.length ? '<section class="fc-sec fc-sec--more"><p class="fc-box__t">더 빛난 기록</p>' + cardsHtml(extra, 'fc-cards--grid') + '</section>' : '') +
        '<div class="fc-foot fc-foot--m"><span class="fc-sign">마라톤국어 · ' + ymd(v.to) + '</span></div>' +
      '</div></article>';
  }
  /* 한 학생의 쪽들 — 1년판: 1쪽 + (opt.p2 가 false 가 아니면) 2쪽 · 2쪽에 못 들어간 하이라이트가 아주 많을 때만 3쪽 */
  var P2 = 6, P3 = 12;
  function pagesHtml(v, opt) {
    opt = opt || {};
    /* 이달판 — 한마디는 같은 쪽 · 넘칠 때만 편지 쪽(fit 이 fc-letter--spare 를 살리거나 지움) */
    if (v.kind !== 'year') return v.note && !opt.link ? [monthHtml(v, opt), letterHtml(v, opt, true)] : [monthHtml(v, opt)];
    var out = [pageHtml(v, opt)], hls = (v.hls || []).map(hlOf), rest = hls.slice(P1);
    if (opt.p2 !== false) {
      out.push(page2Html(v, opt, rest.slice(0, P2), ''));
      if (rest.length > P2) out.push(page2Html(v, opt, rest.slice(P2, P2 + P3), '이어서'));
    }
    if (v.note && !opt.link) out.push(letterHtml(v, opt, false));          /* 마지막 쪽 「선생님의 편지」 — 한마디가 비었거나 확정 전이면 없음(view 가 비움) */
    return out;
  }
  /* 편지 맞춤 — 넘침 = 줄 노트 칸 안 넘침 · 쪽 넘침 중 큰 것 */
  function lOver(pg) { var b = pg.querySelector('.fc-lbody'); return Math.max(b ? b.scrollHeight - b.clientHeight : 0, overOf(pg)); }
  /* 맨 끝 문장(또는 문단)을 다음 면 맨 앞으로 — 같은 문단이면 이어 붙임 */
  function lMove(b, cb) {
    var p = b.lastElementChild; if (!p) return false;
    var spans = p.querySelectorAll('.fc-ls'), first = cb.firstElementChild, same = first && first.getAttribute('data-k') === p.getAttribute('data-k');
    if (spans.length <= 1) {
      if (same) { while (p.lastChild) first.insertBefore(p.lastChild, first.firstChild); p.parentNode.removeChild(p); }
      else cb.insertBefore(p, cb.firstChild);
      return true;
    }
    var tgt = same ? first : p.cloneNode(false);
    if (!same) cb.insertBefore(tgt, cb.firstChild);
    while (p.lastChild) { var nd = p.lastChild; tgt.insertBefore(nd, tgt.firstChild); if (nd.nodeType === 1 && nd.classList.contains('fc-ls')) break; }
    return true;
  }
  /* 면 경계의 빈 줄바꿈 · 공백 정리 */
  function lTidy(b, cb) {
    var a = b.lastElementChild, c = cb.firstElementChild;
    while (a && a.lastChild && (a.lastChild.nodeName === 'BR' || (a.lastChild.nodeType === 3 && !a.lastChild.nodeValue.trim()))) a.removeChild(a.lastChild);
    while (c && c.firstChild && (c.firstChild.nodeName === 'BR' || (c.firstChild.nodeType === 3 && !c.firstChild.nodeValue.trim()))) c.removeChild(c.firstChild);
  }
  /* 글자 크기 — 한 면에 맞는 가장 큰 크기(짧으면 크게 · 길면 작게 · LF.min 아래로 안 내려감) · 그래도 넘치면 다음 면으로 */
  function fitLetter(pg, depth) {
    var b = pg.querySelector('.fc-lbody'); if (!b) return 0;
    depth = depth || 0;
    if (!depth) {
      var hi = LF.max, lo = LF.min;
      b.style.fontSize = hi + 'px';
      if (lOver(pg) <= 0.5) return 0;
      b.style.fontSize = lo + 'px';
      if (lOver(pg) <= 0.5) {
        while (hi - lo > 0.25) { var mid = (hi + lo) / 2; b.style.fontSize = mid + 'px'; if (lOver(pg) <= 0.5) lo = mid; else hi = mid; }
        b.style.fontSize = (Math.floor(lo * 4) / 4) + 'px';
        return 0;
      }
    } else if (lOver(pg) <= 0.5) return 0;
    if (depth > 5) return 0;
    var cont = pg.cloneNode(true), cb = cont.querySelector('.fc-lbody');
    cb.innerHTML = '';
    pg.classList.add('fc-letter--more'); cont.classList.add('fc-letter--cont');
    pg.parentNode.insertBefore(cont, pg.nextSibling);
    var guard = 0;
    while (lOver(pg) > 0.5 && b.children.length && guard++ < 4000) { if (!lMove(b, cb)) break; }
    if (!b.children.length && cb.firstElementChild) b.appendChild(cb.firstElementChild);     /* 한 문장이 한 면보다 길면 — 그대로 두고 멈춤 */
    lTidy(b, cb);
    if (!cb.children.length) { cont.parentNode.removeChild(cont); pg.classList.remove('fc-letter--more'); return 0; }
    var fr = pg.querySelector('.fc-from'); if (fr) fr.parentNode.removeChild(fr);              /* From · 서명은 마지막 면에만 */
    return 1 + fitLetter(cont, depth + 1);
  }
  /* 넘침 자동 맞춤 (20261114d) — 화면에 그린 뒤 쪽마다 내용이 테두리 안쪽 여백 위에서 끝나는지 재고
       1쪽: fc-tight → fc-tighter(캐릭터 · 간격 줄임) · 2쪽: ① 능력치 칩을 더 작게(fc-compact) ② 그래도 넘치면 「더 빛난 기록」을 3쪽으로(같은 테두리 · 머리글)
       root 안의 .fc-page 들 · 인쇄 창 · 코치룸 크게 보기에서 부른다 */
  function overOf(pg) {
    var i = pg.querySelector('.fc-in'); if (!i) return 0;
    var cs = global.getComputedStyle ? getComputedStyle(i) : null, pb = cs ? parseFloat(cs.paddingBottom) || 0 : 0, bb = cs ? parseFloat(cs.borderBottomWidth) || 0 : 0;
    var limit = i.getBoundingClientRect().bottom - pb - bb, low = 0;
    Array.prototype.forEach.call(i.children, function (k) { var b = k.getBoundingClientRect().bottom; if (b > low) low = b; });
    return Math.max(low - limit, i.scrollHeight - i.clientHeight);
  }
  function fit(root) {
    if (!root || !root.querySelectorAll) return 0;
    var moved = 0;
    Array.prototype.slice.call(root.querySelectorAll('.fc-page')).forEach(function (pg) {
      /* 편지 (20261114h) — 이달판 여분은 이달 쪽이 넘칠 때만 남김 */
      if (pg.classList.contains('fc-letter--spare')) { if (pg.parentNode) pg.parentNode.removeChild(pg); return; }
      if (pg.classList.contains('fc-letter')) { moved += fitLetter(pg, 0); return; }
      if (pg.classList.contains('fc-page--month')) {
        var sp = pg.nextElementSibling, nb = pg.querySelector('.fc-note');
        if (overOf(pg) > 0.5 && nb && sp && sp.classList.contains('fc-letter--spare')) { nb.parentNode.removeChild(nb); sp.classList.remove('fc-letter--spare'); }
        return;
      }
      if (overOf(pg) <= 0.5) return;
      if (pg.classList.contains('fc-y')) { pg.classList.add('fc-tight'); if (overOf(pg) > 0.5) pg.classList.add('fc-tighter'); return; }
      if (!pg.classList.contains('fc-p2')) return;
      pg.classList.add('fc-compact');
      var more = pg.querySelector('.fc-sec--more');
      if (overOf(pg) <= 0.5 || !more) return;
      var p3 = pg.cloneNode(true);
      Array.prototype.forEach.call(p3.querySelectorAll('.fc-sec'), function (x) { x.parentNode.removeChild(x); });
      var meta = p3.querySelector('.fc-hd .fc-meta'); if (meta) meta.textContent = meta.textContent + ' · 이어서';
      var foot = p3.querySelector('.fc-in > .fc-foot');
      p3.querySelector('.fc-in').insertBefore(more, foot);
      p3.classList.remove('fc-compact'); p3.classList.add('fc-p3');
      pg.parentNode.insertBefore(p3, pg.nextSibling);
      moved++;
    });
    return moved;
  }
  /* 인쇄 배치 (20261114f) — studs = [{ name, pages: [쪽 html …] }](넘침 맞춘 뒤) · o = { range: all | p1 | p2, mode: duplex | simplex, single }
     range p1 = 1쪽만 · p2 = 2쪽부터 · 양면이면 고른 쪽 수가 홀수인 학생 뒤에 빈 쪽 → 다음 학생이 늘 새 종이 앞면(맨 끝 학생 · 한 명만 인쇄면 넣지 않음)
     → { pages: [{ stu, name, no, html } | { blank, stu, name }], count, sheets, students } */
  function plan(studs, o) {
    o = o || {};
    /* range p1l = 1쪽 + 편지 (20261114h) · 쪽 번호(no)는 그 학생의 실제 쪽 번호 */
    var range = /^(p1|p1l|p2)$/.test(o.range) ? o.range : 'all', duplex = o.mode !== 'simplex', out = [], who = 0;
    var parts = (studs || []).map(function (st) {
      return (st.pages || []).map(function (h, j) { return { h: h, no: j + 1 }; }).filter(function (x) {
        return range === 'p1' ? x.no === 1 : range === 'p2' ? x.no > 1 : range === 'p1l' ? x.no === 1 || /\bfc-letter\b/.test(x.h) : true;
      });
    });
    parts.forEach(function (pg, i) {
      if (!pg.length) return;
      who++;
      pg.forEach(function (x) { out.push({ stu: i, name: studs[i].name, no: x.no, html: x.h, letter: /\bfc-letter\b/.test(x.h) }); });
      var later = parts.slice(i + 1).some(function (x) { return x.length; });
      if (duplex && !o.single && later && pg.length % 2 === 1) out.push({ blank: true, stu: i, name: studs[i].name });
    });
    return { pages: out, count: out.length, sheets: duplex ? Math.ceil(out.length / 2) : out.length, students: who, duplex: duplex, range: range };
  }
  /* 배치대로 인쇄 문서 — 빈 쪽은 완전 흰 종이(테두리 없음) */
  function printPlanDoc(pl, opt) {
    opt = opt || {};
    var css = opt.css || '../assets/finish.css';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(opt.title || '완주증') + '</title>' +
      '<link rel="stylesheet" href="' + esc(css) + '">' + FONT_LINK + '<style>@page { size: A4 portrait; margin: 0; } html, body { margin: 0; }</style></head><body class="fc-print">' +
      pl.pages.map(function (p) { return p.blank ? '<article class="fc-page fc-blank" aria-label="빈 쪽"></article>' : p.html; }).join('') +
      /* 쪽은 코치룸에서 이미 나눠 옴 — 글꼴이 다 뜬 뒤 편지 글이 칸을 넘치면 글자만 조금 줄임(쪽 수는 그대로) */
      '<script>(function () { function shrink() { Array.prototype.forEach.call(document.querySelectorAll(".fc-letter .fc-lbody"), function (b) { var s = parseFloat(b.style.fontSize) || 15, g = 0; while (b.scrollHeight - b.clientHeight > 0.5 && s > 9 && g++ < 40) { s -= 0.5; b.style.fontSize = s + "px"; } }); }' +
      ' function done() { try { shrink(); } catch (e) {} window.__fcFitDone = true; }' +
      ' window.addEventListener("load", function () { var f = document.fonts && document.fonts.ready; if (f) f.then(done, done); else done(); }); })();</scr' + 'ipt></body></html>';
  }
  /* 편지 글꼴 — Google Fonts 「Gaegu」(따뜻한 손글씨 · 인쇄에 깨끗함) · 못 받으면 Pretendard · 맑은 고딕 */
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&display=swap';
  var FONT_LINK = '<link rel="stylesheet" href="' + esc(FONT_URL) + '">';
  /* 새 창 인쇄 문서 — css 는 링크로 · 그림이 다 뜬 뒤 넘침 맞춤 → 인쇄 · opt.p2 */
  function printDoc(views, opt) {
    opt = opt || {};
    var css = opt.css || '../assets/finish.css';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(opt.title || '완주증') + '</title>' +
      '<link rel="stylesheet" href="' + esc(css) + '">' + FONT_LINK + '<style>@page { size: A4 portrait; margin: 0; } html, body { margin: 0; }</style></head><body class="fc-print">' +
      views.map(function (v) { return pagesHtml(v, opt).join(''); }).join('') +
      '<script>window.__fcFit = function () { var getComputedStyle = window.getComputedStyle.bind(window); var global = window; var LF = ' + JSON.stringify(LF) + '; ' +
        [overOf, lOver, lMove, lTidy, fitLetter, fit].map(function (f) { return f.toString(); }).join('\n') + ' return fit(document.body); };' +
      'window.addEventListener("load", function () { var go = function () { window.__fcFitN = window.__fcFit(); window.__fcFitDone = true; }; var f = document.fonts && document.fonts.ready; if (f) f.then(go, go); else go(); });</scr' + 'ipt></body></html>';
  }
  /* 코치룸 — 편지 글꼴을 이 문서에도 불러 둔다(넘침을 잴 때 인쇄와 같은 글꼴) · 최대 ms 기다림 */
  var FONT_P = null;
  function loadFont(ms) {
    var D = global.document;
    if (!D || !D.head) return Promise.resolve(false);
    if (!D.fonts || !D.fonts.load) return Promise.resolve(false);
    /* 글꼴 정의(@font-face)가 든 css 가 다 뜬 뒤에 글꼴 파일을 부른다 — 먼저 부르면 「없음」으로 끝남 */
    if (!FONT_P) FONT_P = new Promise(function (res) {
      var l = D.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_URL; l.setAttribute('data-fc-font', '1');
      l.onload = function () { res(true); }; l.onerror = function () { res(false); };
      D.head.appendChild(l);
    }).then(function (okCss) {
      if (!okCss) return false;
      return Promise.all([D.fonts.load('400 20px Gaegu', '가'), D.fonts.load('700 20px Gaegu', '가')]).then(function (x) { return !!(x[0] && x[0].length); }, function () { return false; });
    });
    var t = new Promise(function (res) { setTimeout(function () { res(false); }, ms || 2500); });
    return Promise.race([FONT_P, t]);
  }

  global.Finish = { compute: compute, view: view, pageHtml: pageHtml, pagesHtml: pagesHtml, letterHtml: letterHtml, letterBody: letterBody, noteInline: noteInline, printDoc: printDoc, plan: plan, printPlanDoc: printPlanDoc, flowSvg: flowSvg, fit: fit, overOf: overOf, loadFont: loadFont, RULE: RULE, P1: P1, LF: LF };
})(window);
