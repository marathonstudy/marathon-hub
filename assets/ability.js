/* ============================================================
   ability.js — 「⚔️ 내 능력치」 (러닝노트 홈 · 코치룸 학생 카드 · 20261110h)

   새 데이터를 모으지 않는다 — 지금 받는 앱 과제 기록(history)만 쓴다. 기준은 「과제」 탭 파트 칩과 같다.
     과제 이름의 파트(AppWeek.partOf — 「독서-과학기술 …」 → 독서 · 과학기술) · 과제 날짜(AppWeek.hwDateOf)
     정답 수 / 문제 수(앱이 줄 때) · 없으면 정답률을 「한 과제 = 4문제」로 셈
   나중에 학생 기준 연동으로 지난 기록(1년치)이 들어오면 그만큼 저절로 늘어난다. 기간은 「가진 기록의 첫 날 ~ 오늘」.

   기간 [이번 달][최근 4주][1년] — 기본 최근 4주
     비교 = 바로 앞 같은 길이 기간(이번 달 → 지난달 같은 날짜까지 · 최근 4주 → 그 앞 4주 · 1년 → 그 앞 1년)
     1년보다 기록이 짧으면 「가진 기록 전체」 · 「10월부터」 (비교 없음)
   영역 — 기록에 실제로 있는 것만
     기본은 큰 영역(독서 · 문학 · 화작 · 언매) · 그 기간에 넉넉한(5문제 이상) 세부 파트가 5개 이상이면 세부(인문 · 사회 · 과학기술 · 현대시 · 고전시가 …)
     3개 이하 → 게임 스탯 막대 · 5개 이상 → 육각형(레이더) + 막대 · 4개 → 막대
   숫자 — 정답률(0~100) 크게 · 등급 S(90+) A(80+) B(70+) C(60+) D · 앞 기간보다 오르면 ▲n(초록 · 은은하게 반짝) · 내리면 ▼n(회색 · 빨강 없음)
     5문제 미만 영역은 「기록 모으는 중」 흐리게 (등급 · ▲▼ · 주력 스킬 · 성장 포인트에서 뺀다)
   가장 높은 영역 「주력 스킬」 · 가장 낮은 영역 「성장 포인트」 (넉넉한 영역이 2개 이상일 때) · 다른 학생과 비교 · 순위 없음
   [성장 그래프 보기] — 영역별 월별 정답률 꺾은선 + 요약 한 줄 「처음보다 독서 +12 · 가장 많이 큰 달 11월」 · 한 달뿐이면 안내

   Ability.mount(host, data, { today, parent, name, small, onGo }) — 기간 · 그래프 상태는 host 에 남긴다(다시 그려도 그대로)
   Ability.compute(data, period, today) · Ability.monthly(data, today) · Ability.grade(r) — 시험용
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function AW() { return global.AppWeek; }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function monthStart(d) { return d.slice(0, 8) + '01'; }
  function monthEnd(d) { var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)); return x.toISOString().slice(0, 10); }
  function prevMonth(d) { var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 2, 1)); return x.toISOString().slice(0, 10); }
  function mon(d) { return +String(d).slice(5, 7) + '월'; }
  function md(d) { return +d.slice(5, 7) + '/' + (+d.slice(8, 10)); }

  /* ---------- 영역 ---------- */
  var SUB = { '인문예술': '인문', '인문': '인문', '예술': '인문', '사회문화': '사회', '사회': '사회', '문화': '사회', '과학기술': '과학기술', '과학': '과학기술', '기술': '과학기술',
              '주제통합': '주제통합', '현대시가': '현대시', '현대시': '현대시', '고전시가': '고전시가', '고전시': '고전시가', '현대소설': '현대소설', '고전소설': '고전소설', '수필': '수필', '극': '극' };
  var ORDER = ['독서', '문학', '화작', '언매', '인문', '사회', '과학기술', '주제통합', '현대시', '고전시가', '현대소설', '고전소설', '수필', '극'];
  function areaOf(title) {
    var A = AW();
    if (!A) return null;
    var p = A.partOf(title);
    if (p) return { top: p.genre === 'read' ? '독서' : '문학', sub: SUB[p.part] || p.part };
    var t = A.cleanTitle(title);
    var m = /^(화법과\s*작문|화작|화법|작문|언어와\s*매체|언매|언어|매체|문법|독서|문학)(?=\s|[-–—]|$|["'“‘「『(])/.exec(t);
    if (!m) return null;
    var k = m[1].replace(/\s+/g, '');
    return { top: k === '독서' ? '독서' : k === '문학' ? '문학' : /^(화법과작문|화작|화법|작문)$/.test(k) ? '화작' : '언매', sub: null };
  }
  /* 기록 → [{ date, top, sub, r(정답률), n(문제 수 · 모르면 4) }] — 낸 과제 · 정답률이 있는 것만 */
  var Q_UNKNOWN = 4;
  function items(data) {
    var A = AW(), out = [];
    if (!A || !data) return out;
    var by = A.orderDays(data);
    (data.history || data.recent || []).forEach(function (h) {
      if (!h || !h.submittedAt) return;
      var r = null, n = 0;
      if (typeof h.correct === 'number' && typeof h.total === 'number' && h.total > 0) { r = h.correct * 100 / h.total; n = h.total; }
      else if (h.correctRate != null && isFinite(Number(h.correctRate))) { r = Number(h.correctRate); n = Q_UNKNOWN; }
      if (r == null) return;
      var a = areaOf(h.title);
      if (!a) return;
      var d = A.hwDateOf(h, by).date;
      if (!valid(d)) return;
      out.push({ date: d, top: a.top, sub: a.sub, r: Math.max(0, Math.min(100, r)), n: n });
    });
    return out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
  }
  function agg(list, keyOf) {
    var g = {};
    list.forEach(function (it) {
      var k = keyOf(it);
      if (!k) return;
      var x = g[k] || (g[k] = { name: k, sum: 0, q: 0, cnt: 0 });
      x.sum += it.r * it.n; x.q += it.n; x.cnt++;
    });
    Object.keys(g).forEach(function (k) { g[k].rate = Math.round(g[k].sum / g[k].q); g[k].enough = g[k].q >= 5; });
    return g;
  }
  function grade(r) { return r >= 90 ? 'S' : r >= 80 ? 'A' : r >= 70 ? 'B' : r >= 60 ? 'C' : 'D'; }
  function sortAreas(a) { return a.sort(function (x, y) { var i = ORDER.indexOf(x.name), j = ORDER.indexOf(y.name); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || (x.name < y.name ? -1 : 1); }); }

  /* ---------- 기간 ---------- */
  var PERIODS = [['month', '이번 달'], ['w4', '최근 4주'], ['y1', '1년']];
  function range(kind, today, first) {
    if (kind === 'month') {
      var f = monthStart(today), days = +today.slice(8, 10) - 1, pf = prevMonth(today), pt = addDays(pf, days);
      if (pt > monthEnd(pf)) pt = monthEnd(pf);
      return { from: f, to: today, prev: { from: pf, to: pt }, note: md(f) + '~' + md(today) };
    }
    if (kind === 'y1') {
      var y0 = addDays(today, -364);
      if (!first || first >= y0) {
        var st = first || today;
        return { from: st, to: today, prev: null, all: true, since: st, note: '가진 기록 전체 · ' + mon(st) + '부터' };
      }
      return { from: y0, to: today, prev: { from: addDays(today, -729), to: addDays(today, -365) }, note: '최근 1년' };
    }
    var w = addDays(today, -27);
    return { from: w, to: today, prev: { from: addDays(today, -55), to: addDays(today, -28) }, note: md(w) + '~' + md(today) };
  }
  function within(list, p) { return list.filter(function (it) { return it.date >= p.from && it.date <= p.to; }); }

  /* 고른 기간의 능력치 */
  function compute(data, kind, today) {
    var all = items(data), first = all.length ? all[0].date : '';
    var p = range(kind || 'w4', today, first);
    var cur = within(all, p), prev = p.prev ? within(all, p.prev) : [];
    var subs = agg(cur, function (it) { return it.sub; });
    var richSubs = Object.keys(subs).filter(function (k) { return subs[k].enough; });
    var detail = richSubs.length >= 5;                 /* 세부는 넉넉한 세부 파트가 5개 이상일 때만 (육각형이 되게) */
    var key = detail ? function (it) { return it.sub || it.top; } : function (it) { return it.top; };
    var g = agg(cur, key), gp = agg(prev, key);
    var areas = sortAreas(Object.keys(g).map(function (k) {
      var x = g[k], y = gp[k];
      return { name: k, rate: x.rate, q: x.q, enough: x.enough, grade: x.enough ? grade(x.rate) : '',
               delta: x.enough && y && y.enough ? x.rate - y.rate : null };
    }));
    var ok = areas.filter(function (a) { return a.enough; });
    var hi = null, lo = null;
    if (ok.length >= 2) {
      hi = ok.slice().sort(function (a, b) { return b.rate - a.rate; })[0];
      lo = ok.slice().sort(function (a, b) { return a.rate - b.rate; })[0];
      if (hi.rate === lo.rate) lo = null;
    }
    return { kind: kind || 'w4', range: p, areas: areas, detail: detail, any: all.length > 0, inPeriod: cur.length, first: first, top: hi ? hi.name : '', low: lo ? lo.name : '' };
  }

  /* 영역별 월별 정답률 (큰 영역) — 가진 기록의 첫 달 ~ 이번 달 */
  function monthly(data, today) {
    var all = items(data);
    if (!all.length) return { months: [], series: [], summary: '' };
    var months = [], m = monthStart(all[0].date), last = monthStart(today);
    while (m <= last && months.length < 36) { months.push(m.slice(0, 7)); m = monthStart(addDays(monthEnd(m), 1)); }
    var names = sortAreas(Object.keys(agg(all, function (it) { return it.top; })).map(function (k) { return { name: k }; })).map(function (a) { return a.name; });
    var series = names.map(function (nm) {
      return { name: nm, pts: months.map(function (ym) {
        var g = agg(all.filter(function (it) { return it.top === nm && it.date.slice(0, 7) === ym; }), function () { return nm; })[nm];
        return g ? g.rate : null;
      }) };
    });
    /* 요약 — 처음 기록한 달보다 가장 많이 오른 영역 · 평균이 가장 많이 오른 달 */
    var best = null;
    series.forEach(function (s) {
      var v = s.pts.filter(function (x) { return x != null; });
      if (v.length >= 2) { var d = v[v.length - 1] - v[0]; if (!best || d > best.d) best = { name: s.name, d: d }; }
    });
    var avg = months.map(function (ym, i) { var v = series.map(function (s) { return s.pts[i]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; });
    var up = null;
    for (var i = 1; i < avg.length; i++) {
      var j = i - 1;
      while (j >= 0 && avg[j] == null) j--;
      if (avg[i] == null || j < 0) continue;
      var d2 = avg[i] - avg[j];
      if (d2 > 0 && (!up || d2 > up.d)) up = { m: months[i], d: d2 };
    }
    var parts = [];
    if (best && best.d > 0) parts.push('처음보다 ' + best.name + ' +' + best.d);
    if (up) parts.push('가장 많이 큰 달 ' + mon(up.m + '-01'));
    return { months: months, series: series, summary: parts.join(' · ') || (months.length > 1 ? '차근차근 기록이 쌓이고 있어요' : '') };
  }

  /* ---------- 그림 ---------- */
  var INK = ['#5A3FD0', '#E0A920', '#1F9D74', '#E06A8C', '#3B82C4', '#8A5CF6', '#C27B2E', '#4C9A2A', '#9C4DCC', '#2F8F9D', '#B5651D', '#6B7280', '#D9467A', '#2E7D32'];
  function inkOf(names, nm) { var i = names.indexOf(nm); return INK[(i < 0 ? 0 : i) % INK.length]; }
  function radarHtml(areas, names) {
    var n = areas.length, cx = 110, cy = 104, R = 74, pt = function (i, r) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r]; };
    var rings = [0.25, 0.5, 0.75, 1].map(function (k) { return '<polygon class="ab-rd__ring" points="' + areas.map(function (a, i) { return pt(i, k).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ') + '"/>'; }).join('');
    var spokes = areas.map(function (a, i) { var p = pt(i, 1); return '<line class="ab-rd__spoke" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; }).join('');
    var poly = '<polygon class="ab-rd__val" points="' + areas.map(function (a, i) { return pt(i, (a.enough ? a.rate : 0) / 100).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ') + '"/>';
    var dots = areas.map(function (a, i) { if (!a.enough) return ''; var p = pt(i, a.rate / 100); return '<circle class="ab-rd__dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" style="fill:' + inkOf(names, a.name) + '"/>'; }).join('');
    var labels = areas.map(function (a, i) {
      var p = pt(i, 1.2), anchor = Math.abs(p[0] - cx) < 6 ? 'middle' : p[0] > cx ? 'start' : 'end';
      return '<text class="ab-rd__lb' + (a.enough ? '' : ' is-few') + '" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(a.name) + '</text>';
    }).join('');
    return '<svg class="ab-radar" viewBox="0 0 220 210" role="img" aria-label="' + esc('영역별 능력치 육각형 — ' + areas.map(function (a) { return a.name + (a.enough ? ' ' + a.rate : ' 기록 모으는 중'); }).join(', ')) + '">' + rings + spokes + poly + dots + labels + '</svg>';
  }
  function deltaHtml(d) {
    if (d == null || d === 0) return '';
    return d > 0 ? '<span class="ab-up num" title="앞 기간보다 ' + d + ' 올랐어요">▲' + d + '</span>' : '<span class="ab-down num" title="앞 기간보다 ' + (-d) + ' 내렸어요">▼' + (-d) + '</span>';
  }
  function barsHtml(c, names) {
    return '<ul class="ab-bars">' + c.areas.map(function (a) {
      var tag = a.name === c.top ? '<span class="ab-tag ab-tag--top">주력 스킬</span>' : a.name === c.low ? '<span class="ab-tag ab-tag--low">성장 포인트</span>' : '';
      return '<li><button type="button" class="ab-row' + (a.enough ? '' : ' is-few') + '" data-ab-go aria-label="' + esc(a.name + ' ' + (a.enough ? a.rate + '점 ' + a.grade + '등급' : '기록 모으는 중') + ' — 누르면 영역별 정답률') + '">' +
        '<span class="ab-row__n"><b>' + esc(a.name) + '</b>' + tag + '</span>' +
        '<span class="ab-row__bar"><i style="width:' + (a.enough ? a.rate : 0) + '%;background:' + inkOf(names, a.name) + '"></i></span>' +
        (a.enough ? '<span class="ab-row__v"><b class="num">' + a.rate + '</b><span class="ab-gr ab-gr--' + a.grade + '">' + a.grade + '</span>' + deltaHtml(a.delta) + '</span>'
                  : '<span class="ab-row__v ab-few">기록 모으는 중</span>') +
      '</button></li>';
    }).join('') + '</ul>';
  }
  function lineHtml(mm) {
    var W = 320, H = 170, L = 30, Rr = 10, T = 12, B = 26, n = mm.months.length;
    var x = function (i) { return n > 1 ? L + i * (W - L - Rr) / (n - 1) : L; }, y = function (v) { return T + (100 - v) * (H - T - B) / 100; };
    var names = mm.series.map(function (s) { return s.name; });
    var grid = [0, 50, 100].map(function (v) { return '<line class="ab-ln__g" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="ab-ln__y" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>'; }).join('');
    var step = Math.max(1, Math.ceil(n / 6));
    var xl = mm.months.map(function (ym, i) { return i % step && i !== n - 1 ? '' : '<text class="ab-ln__x" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + mon(ym + '-01') + '</text>'; }).join('');
    var lines = mm.series.map(function (s) {
      var c = inkOf(names, s.name), segs = [], cur = [];
      s.pts.forEach(function (v, i) { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
      if (cur.length) segs.push(cur);
      return segs.map(function (sg) { return sg.length > 1 ? '<polyline class="ab-ln__l" style="stroke:' + c + '" points="' + sg.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>' : ''; }).join('') +
        s.pts.map(function (v, i) { return v == null ? '' : '<circle class="ab-ln__d" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3" style="fill:' + c + '"><title>' + esc(s.name + ' ' + mon(mm.months[i] + '-01') + ' ' + v) + '</title></circle>'; }).join('');
    }).join('');
    var legend = '<ul class="ab-lg">' + mm.series.map(function (s) { return '<li><i style="background:' + inkOf(names, s.name) + '"></i>' + esc(s.name) + '</li>'; }).join('') + '</ul>';
    return '<svg class="ab-line" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="영역별 월별 정답률 꺾은선">' + grid + xl + lines + '</svg>' + legend;
  }
  function graphHtml(data, today) {
    var mm = monthly(data, today);
    if (mm.months.length < 2) return '<div class="ab-graph"><p class="ab-note">다음 달부터 성장 그래프가 그려져요</p></div>';
    return '<div class="ab-graph">' + (mm.summary ? '<p class="ab-sum">📈 ' + esc(mm.summary) + '</p>' : '') + lineHtml(mm) + '</div>';
  }

  function html(data, st, opt) {
    opt = opt || {};
    var today = opt.today, title = opt.parent ? '⚔️ ' + (opt.name || '') + ' 학생의 능력치' : '⚔️ 내 능력치';
    var c = compute(data, st.kind, today);
    var head = '<div class="ab-head"><h2 class="ab-t">' + esc(title) + '</h2>' +
      (c.any ? '<div class="ab-seg" role="group" aria-label="기간">' + PERIODS.map(function (p) {
        return '<button type="button" class="ab-seg__b' + (st.kind === p[0] ? ' is-on' : '') + '" data-ab-k="' + p[0] + '" aria-pressed="' + (st.kind === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' : '') + '</div>';
    if (!c.any) return '<section class="ab' + (opt.small ? ' ab--small' : '') + (opt.card === false ? '' : ' gm-card') + '" id="' + (opt.id || 'gmAbility') + '" data-ab-root>' + head +
      '<p class="ab-empty">' + (opt.parent ? esc((opt.name || '') + ' 학생이 과제를 내면 능력치가 열려요') : '과제를 내면 능력치가 열려요') + '</p></section>';
    var names = ORDER.slice();
    c.areas.forEach(function (a) { if (names.indexOf(a.name) < 0) names.push(a.name); });
    var body = !c.areas.length ? '<p class="ab-note">이 기간에는 정답률이 있는 과제가 없어요</p>'
      : (c.areas.length >= 5 ? radarHtml(c.areas, names) : '') + barsHtml(c, names);
    return '<section class="ab' + (opt.small ? ' ab--small' : '') + (opt.card === false ? '' : ' gm-card') + '" id="' + (opt.id || 'gmAbility') + '" data-ab-root>' + head +
      '<p class="ab-range num">' + esc(c.range.note) + (c.range.prev ? ' · 앞 기간과 비교' : '') + '</p>' + body +
      '<button type="button" class="ab-more" data-ab-graph aria-expanded="' + !!st.graph + '">' + (st.graph ? '성장 그래프 접기 ▴' : '성장 그래프 보기 ▾') + '</button>' +
      (st.graph ? graphHtml(data, today) : '') + '</section>';
  }
  function mount(host, data, opt) {
    if (!host) return;
    var st = host._ab || (host._ab = { kind: 'w4', graph: false });
    function paint() { host.innerHTML = html(data, st, opt); }
    paint();
    host.onclick = function (e) {
      var k = e.target.closest('[data-ab-k]');
      if (k) { st.kind = k.getAttribute('data-ab-k'); paint(); return; }
      if (e.target.closest('[data-ab-graph]')) { st.graph = !st.graph; paint(); return; }
      if (e.target.closest('[data-ab-go]') && opt && opt.onGo) opt.onGo();
    };
  }

  global.Ability = { mount: mount, html: html, compute: compute, monthly: monthly, items: items, grade: grade, areaOf: areaOf, range: range };
})(window);
