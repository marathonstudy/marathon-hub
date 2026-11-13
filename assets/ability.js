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
     5문제 미만 영역도 정답률 % 만 보인다 (등급 · ▲▼ · 주력 스킬 · 성장 포인트에서 뺀다 · 「기록 모으는 중」 없앰 · 20261110l)
   재료 (20261110l) — 과제 안 영역별 결과(history[].parts = 앱 categoryResults · app-sync · app-report 가 받음)가 있으면 그것 ·
     없으면 과제 이름의 영역 + 정답률 · 가진 기록 전체(또는 날짜 있는 기록이 없을 때)는 앱 「영역별 정답률」(categories) 그대로 — 과제 탭 카드와 같은 값
     [최근 4주]가 비거나 적으면(문제 5개 미만) 고르기 전에는 저절로 전체 기간 · 「최근 기록이 적어 전체 기간으로 보여 줘요」
     「과제를 내면 능력치가 열려요」는 낸 과제 · 영역 기록이 정말 0개일 때만
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
  function topOf(k) { k = k.replace(/\s+/g, ''); return k === '독서' ? '독서' : k === '문학' ? '문학' : /^(화법과작문|화작|화법|작문)$/.test(k) ? '화작' : '언매'; }
  var TOPS = '화법과\\s*작문|화작|화법|작문|언어와\\s*매체|언매|언어|매체|문법|독서|문학';
  function areaOf(title) {
    var A = AW();
    if (!A) return null;
    var p = A.partOf(title);
    if (p) return { top: p.genre === 'read' ? '독서' : '문학', sub: SUB[p.part] || p.part };
    var t = A.cleanTitle(title);
    /* 「독서-법학」 「문학-현대산문」 — 큰 영역 + 세부를 먼저 (목록에 없는 세부도 이름 그대로 · 20261114d) */
    var dm = /^(독서|문학)\s*[-–—:]\s*([가-힣]{1,6})(?![가-힣])/.exec(t);
    if (dm) return { top: dm[1], sub: SUB[dm[2]] || dm[2] };
    var m = new RegExp('^(' + TOPS + ')(?=\\s|[-–—]|$|["\'“‘「『(])').exec(t);
    if (m) return { top: topOf(m[1]), sub: null };
    /* 이름 가운데 있어도 (20261110l) — 「수특 독서-과학기술 3강」 · 「목동반 현대시 복습」 · 「고3 문학 6강」 */
    m = /(?:^|[^가-힣])(독서|문학)\s*[-–—:]\s*([가-힣]{1,6})/.exec(t);
    if (m) { return { top: m[1], sub: SUB[m[2]] || m[2] }; }          /* 「독서-법학」 「문학-현대산문」처럼 목록에 없는 세부도 이름 그대로 (20261114d · 예전엔 「독서」 하나로 합쳐짐) */
    var keys = Object.keys(SUB).sort(function (x, y) { return y.length - x.length; });
    for (var i = 0; i < keys.length; i++) {
      if (new RegExp('(?:^|[^가-힣])' + keys[i] + '(?![가-힣])').test(t)) { var g = A.genreOf(keys[i]); if (g) return { top: g === 'read' ? '독서' : '문학', sub: SUB[keys[i]] }; }
    }
    m = new RegExp('(?:^|[^가-힣])(' + TOPS + ')(?![가-힣])').exec(t);
    if (m) return { top: topOf(m[1]), sub: null };
    if (/(?:고전|현대)문학/.test(t)) return { top: '문학', sub: null };
    return null;
  }
  /* 앱 영역 이름(categories · categoryResults) → 큰 영역 · 세부 — 모르는 이름은 그 이름 그대로 한 영역 */
  function areaOfName(name) {
    var a = areaOf(name);
    if (a) return a;
    var n = String(name || '').trim();
    return n ? { top: n, sub: null } : null;
  }
  /* 기록 → [{ date, top, sub, r(정답률), n(문제 수 · 모르면 4) }] — 낸 과제 · 정답률이 있는 것만
     과제 안에 영역별 결과(parts — 앱 categoryResults)가 있으면 그것을 영역마다 (앱 「영역별 정답률」과 같은 재료 · 20261110l)
     없으면 예전처럼 과제 이름의 영역 + 그 과제 정답률 */
  var Q_UNKNOWN = 4;
  /* 앱 옛 기록 합치기 (20261111a · migration-104) — data.old = { history, calendar }(수강 시작일 앞 · 서버가 한 번 받아 둔 것)
     같은 과제(제출 시각 + 제목) · 같은 날은 한 번만 (지금 기록이 먼저) · 능력치 · 학습 분석 · 배지 칸만 쓴다(경험치 · 퀘스트는 data 그대로) */
  var OLDM = typeof WeakMap === 'function' ? new WeakMap() : null;
  function withOld(data) {
    if (!data || typeof data !== 'object' || data._withOld || !data.old || typeof data.old !== 'object') return data;
    if (OLDM && OLDM.has(data)) return OLDM.get(data);
    var o = data.old, out = {}, seenH = {}, seenC = {};
    Object.keys(data).forEach(function (k) { if (k !== 'old') out[k] = data[k]; });
    var key = function (h) { return h && h.submittedAt ? String(h.submittedAt) + '|' + String(h.title || '') : ''; };
    var cur = data.history || data.recent || [];
    cur.forEach(function (h) { var k = key(h); if (k) seenH[k] = 1; });
    var addH = (Array.isArray(o.history) ? o.history : []).filter(function (h) { var k = key(h); if (!k || seenH[k]) return false; seenH[k] = 1; return true; });
    (data.calendar || []).forEach(function (c) { if (c && valid(c.date)) seenC[c.date] = 1; });
    var addC = (Array.isArray(o.calendar) ? o.calendar : []).filter(function (c) { if (!c || !valid(c.date) || seenC[c.date]) return false; seenC[c.date] = 1; return true; });
    out.history = addH.concat(cur).sort(function (a, b) { return String(a.submittedAt || '') < String(b.submittedAt || '') ? -1 : String(a.submittedAt || '') > String(b.submittedAt || '') ? 1 : 0; });
    out.calendar = addC.concat(data.calendar || []).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    out.oldN = addH.length;
    out._withOld = 1;
    if (OLDM) OLDM.set(data, out);
    return out;
  }
  /* 옛 기록 수 (러닝노트 홈 「이전 기록 n개」) — 지금 기록과 겹치지 않는 것만 */
  function oldCount(data) { var m = withOld(data); return m && m !== data ? m.oldN || 0 : 0; }
  /* 정답 정보가 없는 반 (20261113d) — 앱이 맞힌 수를 비워(null) 보내면 예전 받기 함수가 「0개 맞힘」으로 저장했고,
     정답률 칸을 0 으로 주는 경로도 있다 → 한 반(강 번호 1000 단위 묶음) 안에서 점수가 있는 과제가 3개 이상인데 모두 0 이면
     「정답 정보 없음」으로 보고 셈에서 뺀다 (진짜 0점이 섞인 반은 다른 과제에 0 보다 큰 값이 있어 그대로 셈)
     과제 하나 안에서도 영역별 맞힌 수가 모두 0 인데 정답률이 0 보다 크면 정답률을 쓴다 */
  function partsZero(h) { return Array.isArray(h.parts) && h.parts.length && h.parts.every(function (p) { return !(+p.k > 0); }); }
  function realZero(h) { return typeof h.correct === 'number' && h.correct === 0 && typeof h.total === 'number' && h.total > 0; }
  function rateOf(h) { return typeof h.correct === 'number' && typeof h.total === 'number' && h.total > 0 ? h.correct * 100 / h.total : h.correctRate != null && isFinite(Number(h.correctRate)) ? Number(h.correctRate) : null; }
  function blankGroups(list) {
    var g = {};
    list.forEach(function (h) {
      if (!h || !h.submittedAt) return;
      var hasP = Array.isArray(h.parts) && h.parts.length, r = rateOf(h);
      if (!hasP && r == null) return;
      var k = Math.floor((+h.order || 0) / 1000), x = g[k] || (g[k] = { n: 0, pos: 0 });
      x.n++;
      if ((hasP && !partsZero(h)) || r > 0) x.pos++;
    });
    var out = {};
    Object.keys(g).forEach(function (k) { if (g[k].n >= 3 && !g[k].pos) out[k] = 1; });
    return out;
  }
  function items(data) {
    var A = AW(), out = [];
    data = withOld(data);
    if (!A || !data) return out;
    var by = A.orderDays(data), list = data.history || data.recent || [], blank = blankGroups(list);
    list.forEach(function (h) {
      if (!h || !h.submittedAt) return;
      if (blank[Math.floor((+h.order || 0) / 1000)]) return;
      var d = A.hwDateOf(h, by).date;
      if (!valid(d)) return;
      if (Array.isArray(h.parts) && h.parts.length) {
        var rz = partsZero(h) ? rateOf(h) : null;                   /* 영역 맞힌 수가 모두 0 인데 정답률이 있으면 — 영역은 그대로 · 값은 과제 정답률 */
        /* 맞힌 수가 비어 있던 기록(예전 받기 함수가 null → 0 으로 저장 · 20261113e) — 영역 맞힌 수가 모두 0 이고 정답률도 0 보다 크지 않은데
           과제 맞힌 수(correct = 0 · total > 0)가 없으면 「기록 없음」(점 안 찍음) · 진짜로 풀고 다 틀린 것(맞힌 수 0 이 따로 옴)만 0 */
        if (partsZero(h) && !(rz > 0) && !realZero(h)) return;
        h.parts.forEach(function (p) {
          var a = p && +p.n > 0 && p.k != null && p.k !== '' && isFinite(+p.k) ? areaOfName(p.c) : null;
          if (a) out.push({ date: d, top: a.top, sub: a.sub, r: Math.max(0, Math.min(100, rz > 0 ? rz : +p.k * 100 / +p.n)), n: +p.n });
        });
        return;
      }
      var r = null, n = 0, est = false;
      if (typeof h.correct === 'number' && typeof h.total === 'number' && h.total > 0) { r = h.correct * 100 / h.total; n = h.total; }
      else if (typeof h.total === 'number' && h.total <= 0) return;                       /* 문제 수 0 — 안 푼 것 */
      else if (h.correctRate != null && h.correctRate !== '' && isFinite(Number(h.correctRate)) && Number(h.correctRate) > 0) { r = Number(h.correctRate); n = Q_UNKNOWN; est = true; }
      /* 정답률 칸만 0 이고 맞힌 수 · 문제 수가 없으면 기록 없음 (정답률 칸을 0 으로 채워 보내는 경로 · 20261113e) */
      if (r == null) return;
      var a = areaOf(h.title);
      if (!a) return;
      out.push(est ? { date: d, top: a.top, sub: a.sub, r: Math.max(0, Math.min(100, r)), n: n, est: true } : { date: d, top: a.top, sub: a.sub, r: Math.max(0, Math.min(100, r)), n: n });
    });
    return out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
  }
  /* 낸 과제 수 (정답률 · 영역과 상관없이) */
  function submitted(data) { data = withOld(data); return ((data && (data.history || data.recent)) || []).filter(function (h) { return h && h.submittedAt; }).length; }
  /* 앱 「영역별 정답률」(categories · 전체 기간) → 영역 항목 — 과제 탭 카드와 같은 값 · 문제 수는 과제 안 결과에서(없으면 횟수 × 4) */
  function catItems(data) {
    data = withOld(data);
    var cats = (data && data.categories) || [], qn = {};
    ((data && data.history) || []).forEach(function (h) { (h && h.submittedAt && h.parts || []).forEach(function (p) { if (p && p.c) qn[p.c] = (qn[p.c] || 0) + (+p.n || 0); }); });
    /* 20261113e — 앱 영역별 정답률이 0(또는 비어 있음)인 영역은 과제 기록에 그 영역을 실제로 푼 것(맞힌 수가 적힌 것)이 있을 때만 0 으로 둔다
       (맞힌 수가 비어 0 으로 온 영역이 「0점 D · 성장 포인트」로 나오던 것) */
    var solved = {};
    items(data).forEach(function (it) { solved[it.top + '|' + (it.sub || '')] = 1; solved[it.top] = 1; });
    var list = cats.filter(function (c) {
      if (!c || !c.name || !(c.count == null || c.count > 0)) return false;
      if (c.rate == null || c.rate === '' || !isFinite(+c.rate)) return false;
      if (+c.rate > 0) return true;
      var a = areaOfName(c.name);
      return !!(a && (solved[a.top + '|' + (a.sub || '')] || (!a.sub && solved[a.top])));
    });
    /* 20261114d — 0 으로 남은 영역은 과제 기록으로 다시 셈(기록에 맞힌 것이 있으면 그 값 · 모두 진짜 0 이면 0) */
    var itAll = items(data);
    list = list.map(function (c) {
      if (+c.rate > 0) return c;
      var a = areaOfName(c.name), xs = itAll.filter(function (it) { return it.top === a.top && (!a.sub || it.sub === a.sub); });
      var q = xs.reduce(function (s, x) { return s + x.n; }, 0), r = q ? Math.round(xs.reduce(function (s, x) { return s + x.r * x.n; }, 0) / q) : 0;
      return Object.assign({}, c, { rate: r });
    });
    /* 앱 영역별 정답률이 모두 0 이고 과제가 3개 이상이면 정답 정보가 없는 것 (20261113d · 위 blankGroups 와 같은 까닭) */
    if (list.length && list.every(function (c) { return !(+c.rate > 0); }) && list.reduce(function (s, c) { return s + (+c.count || 1); }, 0) >= 3) return [];
    return list.map(function (c) {
      var a = areaOfName(c.name);
      return { date: '', top: a.top, sub: a.sub, r: Math.max(0, Math.min(100, +c.rate || 0)), n: qn[c.name] || Math.max(1, +c.count || 1) * Q_UNKNOWN };
    });
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
  /* 스탯 묶음 (20261113g) — 독서(인문 · 사회 · 과학기술 · 법학 · 경제 …) / 문학(현대시 · 고전시가 · 소설 · 산문 …) / 선택과목(화작 · 언매) / 기타(분류에 안 맞는 영역) */
  var GROUPS = ['독서', '문학', '선택과목', '기타'];
  /* 20261114d — 독서 = 인문 · 사회 · 과학기술 · 법학 · 경제 · 기술 …  문학 = 현대시 · 고전시가 · 소설 · 산문 · 극 …  선택과목 = 화작 · 언매 · 현대문법 · 문법 …  어디에도 안 맞는 것만 기타 */
  var G_SEL = /(화작|화법|작문|언매|언어|매체|문법|선택)/, G_LIT = /(문학|현대시|고전시|시가|소설|산문|수필|희곡|시나리오|극)/, G_READ = /(독서|비문학|인문|사회|과학|기술|법학|법|경제|예술|철학|주제통합|교육|역사|심리)/;
  function groupOf(top, name) {
    var t = String(top || '').replace(/\s+/g, ''), n = String(name || '').replace(/\s+/g, '');
    if (t === '독서') return '독서';
    if (t === '문학') return '문학';
    var s = t + '|' + n;
    if (G_SEL.test(s)) return '선택과목';
    if (G_LIT.test(s) || /^시$/.test(n) || /^시$/.test(t)) return '문학';
    if (G_READ.test(s)) return '독서';
    return '기타';
  }
  /* 문제 수로 무게를 둔 평균 — 기록이 있는 영역만 (영역 목록에는 기록 있는 영역만 들어온다) */
  function sumOf(list) {
    var q = 0, s = 0;
    list.forEach(function (a) { q += a.q; s += a.rate * a.q; });
    if (!q) return null;
    var r = Math.round(s / q);
    return { rate: r, q: q, enough: q >= 5, grade: q >= 5 ? grade(r) : '' };
  }
  function groupsOf(areas) {
    return GROUPS.map(function (gn) {
      var xs = areas.filter(function (a) { return a.group === gn; });
      if (!xs.length) return null;
      var t = sumOf(xs);
      return { name: gn, areas: xs, rate: t.rate, q: t.q, enough: t.enough, grade: t.grade };
    }).filter(Boolean);
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
        return { from: st, to: today, prev: null, all: true, since: st, note: first ? '가진 기록 전체 · ' + mon(st) + '부터' : '' };     /* 기록이 없으면 문구 없음 (20261111a) */
      }
      return { from: y0, to: today, prev: { from: addDays(today, -729), to: addDays(today, -365) }, note: '최근 1년' };
    }
    var w = addDays(today, -27);
    return { from: w, to: today, prev: { from: addDays(today, -55), to: addDays(today, -28) }, note: md(w) + '~' + md(today) };
  }
  function within(list, p) { return list.filter(function (it) { return it.date >= p.from && it.date <= p.to; }); }

  /* 고른 기간의 능력치 */
  /* 그 학생의 실제 첫 기록 날 — 낸 과제 중 가장 이른 제출일(한국 날짜) (20261111a)
     과제 칸 날짜는 강 번호 → 반 수업일이라 반이 먼저 시작했으면 학생이 오기 전 달(예: 7월)이 된다 → 문구 「n월부터」는 제출일로 */
  function firstSub(data) {
    data = withOld(data);
    var ds = ((data && (data.history || data.recent)) || []).map(function (h) {
      var t = Date.parse(String((h && h.submittedAt) || ''));
      return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    }).filter(valid).sort();
    return ds[0] || '';
  }
  function compute(data, kind, today, opt) {
    var all = items(data), first = all.length ? all[0].date : '', cats = opt && opt.noApp && all.length ? [] : catItems(data);
    var fs = firstSub(data), noteDay = fs || first;          /* 셈하는 기간은 과제 칸 날짜 그대로 · 문구의 달만 실제 첫 제출 */
    var p = range(kind || 'w4', today, first);
    if (p.all) p.note = noteDay ? '가진 기록 전체 · ' + mon(noteDay) + '부터' : '';
    var cur = within(all, p), prev = p.prev ? within(all, p.prev) : [], src = 'hw';
    /* 가진 기록 전체(1년보다 짧음)이거나 날짜가 있는 영역 기록이 없으면 — 앱 「영역별 정답률」 그대로 (과제 탭 카드와 같은 값 · 20261110l) */
    /* 옛 기록을 합쳤으면(104) 앱 「영역별 정답률」(지금 받는 기간만 셈)으로 바꾸지 않는다 — 옛 기록까지 날짜별로 센 값 */
    if (cats.length && ((p.all && !oldCount(data)) || !all.length)) {
      cur = cats; prev = []; src = 'app';
      if (!p.all) p = range('y1', today, first || today);
      p = { from: p.from, to: p.to, prev: null, all: true, since: p.since, note: noteDay ? '가진 기록 전체 · ' + mon(noteDay) + '부터' : '' };
    }
    var subs = agg(cur, function (it) { return it.sub; });
    var richSubs = Object.keys(subs).filter(function (k) { return subs[k].enough; });
    var detail = richSubs.length >= 5;                 /* 세부는 넉넉한 세부 파트가 5개 이상일 때만 (육각형이 되게) */
    var key = detail ? function (it) { return it.sub || it.top; } : function (it) { return it.top; };
    var g = agg(cur, key), gp = agg(prev, key), tk = {};
    cur.forEach(function (it) { var k = key(it); if (k && !tk[k]) tk[k] = it.top; });
    var areas = sortAreas(Object.keys(g).map(function (k) {
      var x = g[k], y = gp[k];
      return { name: k, top: tk[k] || k, group: groupOf(tk[k] || k, k), rate: x.rate, q: x.q, enough: x.enough, grade: x.enough ? grade(x.rate) : '',
               delta: x.enough && y && y.enough ? x.rate - y.rate : null };
    }));
    var ok = areas.filter(function (a) { return a.enough; });
    var hi = null, lo = null;
    if (ok.length >= 2) {
      hi = ok.slice().sort(function (a, b) { return b.rate - a.rate; })[0];
      lo = ok.slice().sort(function (a, b) { return a.rate - b.rate; })[0];
      if (hi.rate === lo.rate) lo = null;
    }
    var qSum = areas.reduce(function (s, a) { return s + a.q; }, 0);
    return { groups: groupsOf(areas), total: sumOf(areas), kind: src === 'app' ? 'y1' : (kind || 'w4'), auto: src === 'app' && (kind || 'w4') !== 'y1', range: p, areas: areas, detail: detail, src: src,
             any: all.length > 0 || cats.length > 0 || submitted(data) > 0, submitted: submitted(data), items: all.length,
             inPeriod: cur.length, q: qSum, thin: qSum < 5, first: first, top: hi ? hi.name : '', low: lo ? lo.name : '' };
  }
  /* 화면에 쓰는 기간 — 학생이 고르기 전에는 [최근 4주]가 비거나 적으면(문제 5개 미만) 저절로 전체 기간 (20261110l) */
  function view(data, st, today) {
    var c = compute(data, st.kind, today);
    if (!st.picked && c.kind !== 'y1' && c.thin && (c.items || c.src === 'app' || catItems(data).length)) {
      var y = compute(data, 'y1', today);
      if (y.areas.length) { y.auto = true; return y; }
    }
    return c;
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
    var poly = '<polygon class="ab-rd__val" points="' + areas.map(function (a, i) { return pt(i, a.rate / 100).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ') + '"/>';
    var dots = areas.map(function (a, i) { if (!a.enough) return ''; var p = pt(i, a.rate / 100); return '<circle class="ab-rd__dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" style="fill:' + inkOf(names, a.name) + '"/>'; }).join('');
    var labels = areas.map(function (a, i) {
      var p = pt(i, 1.2), anchor = Math.abs(p[0] - cx) < 6 ? 'middle' : p[0] > cx ? 'start' : 'end';
      return '<text class="ab-rd__lb' + (a.enough ? '' : ' is-few') + '" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(a.name) + '</text>';
    }).join('');
    return '<svg class="ab-radar" viewBox="-24 0 268 210" role="img" aria-label="' + esc('영역별 능력치 육각형 — ' + areas.map(function (a) { return a.name + ' ' + a.rate + '%'; }).join(', ')) + '">' + rings + spokes + poly + dots + labels + '</svg>';
  }
  function deltaHtml(d) {
    if (d == null || d === 0) return '';
    return d > 0 ? '<span class="ab-up num" title="앞 기간보다 ' + d + ' 올랐어요">▲' + d + '</span>' : '<span class="ab-down num" title="앞 기간보다 ' + (-d) + ' 내렸어요">▼' + (-d) + '</span>';
  }
  /* ---------- 스탯 창 (20261113g) ----------
     맨 위 — 레이더(펼쳤을 때 · 축 3개 이상) 옆에(휴대폰은 위) 「종합 A · 86」 · 꼬리표 「주력 스킬: ○○ S」 · 「성장 포인트: ○○ B」
     아래 — 묶음(독서 · 문학 · 선택과목 · 기타)마다 제목 옆 묶음 평균 · 등급 + 작은 스킬 카드 격자(PC 4칸 · 휴대폰 3칸)
     카드 — 영역 이름 · 큰 숫자 · 등급 배지 · ▲n / ▼n(변화 없으면 없음) · 테두리는 등급 색 · S 는 금색 + 은은한 반짝임
     접힌 모양 — 종합 + 묶음 평균만 · 「전체 스탯 보기 ▾」 · 정답 수가 적은 영역(묶음 · 종합도)은 등급 없이 % 만 */
  function gradeTag(x) { return x.enough ? '<span class="ab-gr ab-gr--' + x.grade + '">' + x.grade + '</span>' : '<small class="ab-pctu">%</small>'; }
  function overallHtml(c) {
    var t = c.total, byName = function (n) { return c.areas.filter(function (a) { return a.name === n; })[0]; };
    var hi = c.top ? byName(c.top) : null, lo = c.low ? byName(c.low) : null;
    return '<div class="ab-ov' + (t && t.enough ? ' ab-ov--' + t.grade : '') + '">' +
      '<p class="ab-ov__k">종합</p>' +
      '<p class="ab-ov__v">' + (t ? (t.enough ? '<b class="ab-ov__g">' + t.grade + '</b><span class="ab-ov__dot">·</span>' : '') + '<b class="ab-ov__n num">' + t.rate + '</b>' + (t.enough ? '' : '<small>%</small>') : '<b class="ab-ov__n">-</b>') + '</p>' +
      ((hi || lo) ? '<p class="ab-ov__tags">' +
        (hi ? '<span class="ab-tag ab-tag--top">주력 스킬: ' + esc(hi.name) + ' ' + hi.grade + '</span>' : '') +
        (lo ? '<span class="ab-tag ab-tag--low">성장 포인트: ' + esc(lo.name) + ' ' + lo.grade + '</span>' : '') + '</p>' : '') +
    '</div>';
  }
  function groupSumHtml(c) {
    var gs = c.groups.filter(function (g) { return g.name !== '기타'; });
    if (!gs.length) gs = c.groups;
    return '<ul class="ab-gsum">' + gs.map(function (g) {
      return '<li><button type="button" class="ab-gsum__i" data-ab-go aria-label="' + esc(g.name + ' ' + g.rate + (g.enough ? '점 ' + g.grade + '등급' : '%') + ' — 누르면 영역별 정답률') + '"><span class="ab-gsum__n">' + esc(g.name) + '</span><b class="num">' + g.rate + '</b>' + gradeTag(g) + '</button></li>';
    }).join('') + '</ul>';
  }
  function skillHtml(a, c) {
    var tag = a.name === c.top ? ' is-top' : a.name === c.low ? ' is-low' : '';
    return '<li><button type="button" class="ab-sk' + (a.enough ? ' ab-sk--' + a.grade : ' is-few') + tag + '" data-ab-go aria-label="' + esc(a.name + ' ' + (a.enough ? a.rate + '점 ' + a.grade + '등급' : '정답률 ' + a.rate + '%') + ' — 누르면 영역별 정답률') + '">' +
      '<span class="ab-sk__n">' + esc(a.name) + '</span>' +
      '<span class="ab-sk__v"><b class="num">' + a.rate + '</b>' + gradeTag(a) + '</span>' +
      (a.enough && a.delta ? '<span class="ab-sk__d">' + deltaHtml(a.delta) + '</span>' : '') +
    '</button></li>';
  }
  function groupsHtml(c) {
    return c.groups.map(function (g) {
      return '<section class="ab-grp"><h3 class="ab-grp__t">' + esc(g.name) + ' <span class="ab-grp__a"><b class="num">' + g.rate + '</b>' + gradeTag(g) + '</span></h3>' +
        '<ul class="ab-cards">' + g.areas.map(function (a) { return skillHtml(a, c); }).join('') + '</ul></section>';
    }).join('');
  }
  function statHtml(c, names, open) {
    var radar = open && c.areas.length >= 3 ? radarHtml(c.areas, names) : '';
    return '<div class="ab-top' + (radar ? ' has-radar' : '') + '">' + (radar ? '<div class="ab-top__r">' + radar + '</div>' : '') + overallHtml(c) + '</div>' +
      (open ? groupsHtml(c) : groupSumHtml(c)) +
      '<button type="button" class="ab-more ab-open" data-ab-open aria-expanded="' + !!open + '">' + (open ? '스탯 접기 ▴' : '전체 스탯 보기 ▾') + '</button>';
  }
  function barsHtml(c, names) {
    return '<ul class="ab-bars">' + c.areas.map(function (a) {
      var tag = a.name === c.top ? '<span class="ab-tag ab-tag--top">주력 스킬</span>' : a.name === c.low ? '<span class="ab-tag ab-tag--low">성장 포인트</span>' : '';
      /* 문제 수가 적은 영역(5문제 미만)도 정답률 % 만 — 등급 · ▲▼ · 주력 스킬 · 성장 포인트는 넉넉한 영역에만 (20261110l) */
      return '<li><button type="button" class="ab-row' + (a.enough ? '' : ' is-few') + '" data-ab-go aria-label="' + esc(a.name + ' ' + (a.enough ? a.rate + '점 ' + a.grade + '등급' : '정답률 ' + a.rate + '%') + ' — 누르면 영역별 정답률') + '">' +
        '<span class="ab-row__n"><b>' + esc(a.name) + '</b>' + tag + '</span>' +
        '<span class="ab-row__bar"><i style="width:' + a.rate + '%;background:' + inkOf(names, a.name) + '"></i></span>' +
        (a.enough ? '<span class="ab-row__v"><b class="num">' + a.rate + '</b><span class="ab-gr ab-gr--' + a.grade + '">' + a.grade + '</span>' + deltaHtml(a.delta) + '</span>'
                  : '<span class="ab-row__v ab-pct"><b class="num">' + a.rate + '</b><small>%</small></span>') +
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

  /* 펼침 — st.open 이 있으면 그것 · 없으면 opt.open(코치룸 true) · 러닝노트는 기기에 기억(mount · opt.remember) */
  function isOpen(st, opt) { return st && st.open != null ? !!st.open : !!(opt && opt.open); }
  var OPEN_KEY = 'mh.ab.open';
  function html(data, st, opt) {
    opt = opt || {};
    var today = opt.today, title = opt.parent ? '⚔️ ' + (opt.name || '') + ' 학생의 능력치' : '⚔️ 내 능력치';
    var c = view(data, st, today), on = c.kind;
    var head = '<div class="ab-head"><h2 class="ab-t">' + esc(title) + '</h2>' +
      (c.any ? '<div class="ab-seg" role="group" aria-label="기간">' + PERIODS.map(function (p) {
        return '<button type="button" class="ab-seg__b' + (on === p[0] ? ' is-on' : '') + '" data-ab-k="' + p[0] + '" aria-pressed="' + (on === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' : '') + '</div>';
    /* 「과제를 내면 능력치가 열려요」는 낸 과제 · 영역 기록이 정말 0개일 때만 */
    if (!c.any) return '<section class="ab' + (opt.small ? ' ab--small' : '') + (opt.card === false ? '' : ' gm-card') + '" id="' + (opt.id || 'gmAbility') + '" data-ab-root>' + head +
      '<p class="ab-empty">' + (opt.parent ? esc((opt.name || '') + ' 학생이 과제를 내면 능력치가 열려요') : '과제를 내면 능력치가 열려요') + '</p></section>';
    var names = ORDER.slice();
    c.areas.forEach(function (a) { if (names.indexOf(a.name) < 0) names.push(a.name); });
    var body = !c.areas.length ? '<p class="ab-note">' + (c.items || c.src === 'app' ? '이 기간에는 정답률이 있는 과제가 없어요' : '낸 과제 ' + c.submitted + '개 · 정답 수가 적힌 과제가 쌓이면 영역별 능력치가 보여요') + '</p>'
      : statHtml(c, names, isOpen(st, opt));
    return '<section class="ab' + (opt.small ? ' ab--small' : '') + (opt.card === false ? '' : ' gm-card') + '" id="' + (opt.id || 'gmAbility') + '" data-ab-root>' + head +
      '<p class="ab-range num">' + esc(c.range.note) + (c.range.prev ? ' · 앞 기간과 비교' : '') + '</p>' +
      (c.auto ? '<p class="ab-auto">최근 기록이 적어 전체 기간으로 보여 줘요</p>' : '') + body +
      (c.items ? '<button type="button" class="ab-more" data-ab-graph aria-expanded="' + !!st.graph + '">' + (st.graph ? '성장 그래프 접기 ▴' : '성장 그래프 보기 ▾') + '</button>' +
      (st.graph ? graphHtml(data, today) : '') : '') + '</section>';
  }
  /* opt.state — 기간을 같이 쓰는 칸(학습 분석)과 나눠 쓰는 상태 { kind, picked, graph } · opt.onKind(kind) — 기간을 바꾸면 알림 */
  function mount(host, data, opt) {
    if (!host) return;
    var st = (opt && opt.state) || host._ab || (host._ab = { kind: 'w4', graph: false });
    host._ab = st;
    if (st.open == null && opt && opt.remember) { try { st.open = global.localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { st.open = false; } }
    function paint() { host.innerHTML = html(data, st, opt); }
    paint();
    host.onclick = function (e) {
      var k = e.target.closest('[data-ab-k]');
      if (k) { st.kind = k.getAttribute('data-ab-k'); st.picked = true; paint(); if (opt && opt.onKind) opt.onKind(st.kind); return; }
      if (e.target.closest('[data-ab-graph]')) { st.graph = !st.graph; paint(); return; }
      if (e.target.closest('[data-ab-open]')) { st.open = !isOpen(st, opt); if (opt && opt.remember) { try { global.localStorage.setItem(OPEN_KEY, st.open ? '1' : '0'); } catch (e2) { /* 기억 못 해도 그대로 */ } } paint(); return; }
      if (e.target.closest('[data-ab-go]') && opt && opt.onGo) opt.onGo();
    };
  }

  global.Ability = { mount: mount, html: html, compute: compute, view: view, monthly: monthly, items: items, catItems: catItems, submitted: submitted, withOld: withOld, oldCount: oldCount, grade: grade, groupOf: groupOf, isOpen: isOpen, areaOf: areaOf, areaOfName: areaOfName, range: range, PERIODS: PERIODS, ORDER: ORDER };
})(window);
