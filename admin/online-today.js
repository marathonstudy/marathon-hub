/* ============================================================
   online-today.js — 코치룸 「오늘」 💻 온라인 탭 (20261117c · 20261118a 빠르게 · 직원만)

   온라인 마라톤(1일 1지문 · 데일리 영상코칭 · 월 단위 클래스 · 3구간 완주) — 수업일 · 출결 · 수업 레포트 · 필기 · 수업 전 알림이 없다

   20261118a — 첫 화면이 느리고 반 카드에 「statement timeout」이 뜨던 문제
     예전: 반마다 online_run_class(학생 전원의 앱 기록 통째 · 옛 기록까지)를 한꺼번에 불러 브라우저에서 계산
     지금: 서버가 학생마다 미리 계산해 둔 한 줄(online_student_stats · migration-119)만 읽는다
       · 반 카드 — 요약 한 줄만 먼저(online_stats_sum): 「오늘 제출 n/n · 이틀 이상 미제출 n명 · 구간 위험 n명」
         보이는 카드부터 차례로 · 동시에 2개까지 · 실패하면 그 카드만 「불러오지 못했어요 [다시 불러오기]」
       · 📋 반 현황표(예전 「챙길 학생」 자리) — 반을 고르면 그때 불러온다(online_stats_class)
         이름 | 오늘 | 이번 달 제출 | 연속 | 1구간 | 2구간 | 3구간 | 마지막 제출 · 정렬 · 거르기 칩 · 응원 문자 초안(복사만) · 엑셀
         앱 기록이 2시간 넘게 오래됐거나 비면 「기록 늦음」 + [다시 받기](그 학생만 · 분당 28회 한도 · 차례로) · [이 반 전부 다시 받기]
         요약이 아직 없으면 「계산 중」 + [지금 계산] · 앱 반 정보가 없으면 「앱 반 정보 없음 — Replit 요청 필요」(버튼 없음)
       · 월말 정리 — 누를 때만 불러온다(online-run-admin.js · 그대로)
     숨김(코드는 둠): 오늘 현황판 · 챙길 학생 목록(「이번 달 새로 합류」 꼬리표 · 거르기) · 반 카드 학생 목록 · 긴 구간 꼬리표 · 정답률
   ============================================================ */
(function () {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sb() { return window.SB && SB.client; }
  function today() { return window.DDay ? DDay.today() : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function ago(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var m = Math.floor(Math.max(0, Date.now() - t) / 60000);
    return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전';
  }
  function kstOf(iso) { var t = Date.parse(iso || ''); if (!isFinite(t)) return null; var s = new Date(t + 9 * 3600000).toISOString(); return { day: s.slice(0, 10), hm: s.slice(11, 16) }; }
  function errHtml(e, attr, label) { return window.ErrKo ? ErrKo.html(e, { retry: attr, label: label, staff: true, text: label === '다시 불러오기' ? '불러오지 못했어요' : '' }) : '<span class="muted-note">불러오지 못했어요</span> <button type="button" class="btn btn--sm" ' + attr + '>' + esc(label) + '</button>'; }
  function needSql(e) { return /Could not find the function|schema cache|does not exist/i.test(String((e && e.message) || e || '')); }

  var KEY = 'mh.ot.care', TKEY = 'mh.ot.tbl';
  var S = { by: {}, busy: {}, err: {}, open: {}, care: { cls: '', grade: '' }, pick: {}, draft: false, repaint: null, kings: {},
            classes: [], sum: {}, sq: [], fly: 0, vis: {}, obs: null,
            tbl: { cls: '', sort: 'care', filter: 'all', rows: null, busy: false, err: null, at: 0, more: {}, why: {}, pick: {}, draft: false, calc: {} },
            rf: { queue: [], run: [], st: {}, msg: {}, last: 0, until: 0, timer: null, total: 0 } };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv && typeof sv === 'object') S.care = { cls: String(sv.cls || ''), grade: String(sv.grade || '') }; } catch (e) { /* 그대로 */ }
  try { var tv = JSON.parse(localStorage.getItem(TKEY) || 'null'); if (tv && typeof tv === 'object') { S.tbl.cls = String(tv.cls || ''); S.tbl.sort = String(tv.sort || 'care'); S.tbl.dir = tv.dir === 'asc' ? 'asc' : 'desc'; S.tbl.filter = String(tv.filter || 'all'); } } catch (e) { /* 그대로 */ }
  function saveCare() { try { localStorage.setItem(KEY, JSON.stringify(S.care)); } catch (e) { /* 그대로 */ } }
  function saveTbl() { try { localStorage.setItem(TKEY, JSON.stringify({ cls: S.tbl.cls, sort: S.tbl.sort, dir: S.tbl.dir, filter: S.tbl.filter })); } catch (e) { /* 그대로 */ } }

  /* ============================================================
     예전 길(20261117c) — 반 하나의 앱 기록 통째 · 브라우저 계산 (월말 정리 · 시험에서 씀 · 첫 화면에서는 안 부름)
     ============================================================ */
  function load(cls, force) {
    var c = sb(), x = S.by[cls];
    if (!c || S.busy[cls] || (!force && x && Date.now() - x.at < 300000)) return;
    S.busy[cls] = true;
    Promise.resolve(c.rpc('online_run_class', { p_class: cls })).then(function (r) {
      S.busy[cls] = false;
      if (r && r.error) S.err[cls] = needSql(r.error) ? 'migration-117 · 118 SQL 을 먼저 실행해 주세요' : (window.ErrKo ? ErrKo.ko(r.error) : r.error.message);
      else { S.err[cls] = ''; S.by[cls] = { at: Date.now(), list: Array.isArray(r && r.data) ? r.data : [] }; }
      if (S.repaint) S.repaint();
    }, function () { S.busy[cls] = false; S.err[cls] = '불러오지 못했어요'; if (S.repaint) S.repaint(); });
  }
  /* 학생 한 명 — 오늘 · 연속 미제출 · 아슬아슬 · 새로 합류 (서버 _online_calc 와 같은 규칙 · e2e151 이 맞춰 본다) */
  function stuOf(s, t) {
    var ym = t.slice(0, 7), r = OnlineRun.compute(s.data || {}, ym, { today: t, excuse: s.excuse || [], staff: true });
    var cd = r.days.filter(function (x) { return x.counted && x.date < t; });
    var last2 = cd.slice(-2), two = last2.length === 2 && last2.every(function (x) { return (x.gpFrom || x.kind) === 'miss'; });
    var run = 0; for (var i = cd.length - 1; i >= 0; i--) { if ((cd[i].gpFrom || cd[i].kind) === 'miss') run++; else break; }
    var td = r.todayDay, todayKind = td && td.counted ? td.kind : 'none';
    var tight = '', sec = null, risk = '', riskSec = null, riskLeft = null;
    if (r.app && r.app.status === 'ok') {
      sec = r.app.secs.filter(function (x) { return x.state === 'run'; })[0] || null;
      if (sec) {
        var left = r.days.filter(function (x) { return x.counted && x.date >= t && x.seg === sec.no && x.kind !== 'ok'; }).length;
        var th = r.app.threshold, best = sec.n + left ? (sec.on + left) / (sec.n + left) * 100 : 0, miss1 = sec.n + left ? (sec.on + left - 1) / (sec.n + left) * 100 : 0;
        if (left > 0 && best >= th && miss1 < th) { tight = sec.no + '구간 · 남은 ' + left + '회 다 내야 완주(앱 기준)'; risk = 'app'; riskSec = sec.no; riskLeft = left; }
      }
    } else {
      var hs = r.hub.filter(function (g) { return g.state === 'run'; })[0];
      if (hs && r.golden) { tight = hs.no + '구간 · 골든패스를 써서 남은 날 다 내야 완주(허브 기준)'; risk = 'hub'; riskSec = hs.no; }
    }
    var first = Object.keys((function () { var o = {}; [].concat(((s.data || {}).old || {}).calendar || [], (s.data || {}).calendar || []).forEach(function (c) { if (c && c.date && +c.order > 0) o[c.date] = 1; }); return o; })()).sort()[0] || '';
    var fresh = (s.start_on && String(s.start_on).slice(0, 7) === ym) || (first && first.slice(0, 7) === ym);
    var appSec = r.app && r.app.status === 'ok' ? r.app.secs : null;
    return { id: s.id, name: s.name, grade: s.grade || '', r: r, today: todayKind, two: two, missRun: run, tight: tight, risk: risk, riskSec: riskSec, riskLeft: riskLeft, fresh: !!fresh, appSec: appSec, fetched: s.fetched };
  }
  function rowsOf(cls) {
    var x = S.by[cls], t = today();
    if (!x || !window.OnlineRun) return null;
    if (!x.rows || x.rowsDay !== t) { x.rows = x.list.map(function (s) { return stuOf(s, t); }); x.rowsDay = t; }
    return x.rows;
  }
  var TODAY_T = { ok: ['✓ 인증', 'ok'], late: ['⏰ 늦게', 'late'], today: ['아직', 'wait'], excused: ['사정 인정', 'ex'], golden: ['골든패스', 'ex'], none: ['숙제 없음', 'off'], future: ['—', 'off'], miss: ['아직', 'wait'], weekend: ['숙제 없음', 'off'], off: ['숙제 없음', 'off'] };

  /* 예전 오늘 현황판 · 챙길 학생 (20261117c · 숨김 — 지우지 않음) */
  function boardHtml(classes) {
    var rows = classes.map(function (c) {
      var rs = rowsOf(c.name);
      if (!rs) return '<li class="ot-b"><b>' + esc(c.name) + '</b><span class="muted-note">' + (S.err[c.name] ? esc(S.err[c.name]) : '불러오는 중…') + '</span></li>';
      var has = rs.filter(function (x) { return x.today !== 'none' && x.today !== 'off' && x.today !== 'weekend'; });
      var ok = has.filter(function (x) { return x.today === 'ok' || x.today === 'late'; }), wait = has.filter(function (x) { return x.today === 'today' || x.today === 'miss'; });
      var two = rs.filter(function (x) { return x.two; });
      var nm = function (list) { return list.map(function (x) { return '<button type="button" class="ot-nm" data-cs-open="' + esc(x.id) + '">' + esc(x.name) + '</button>'; }).join(''); };
      return '<li class="ot-b"><b>' + esc(c.name) + '</b>' +
        (has.length ? '<span class="ot-b__n"><span class="ot-ok">오늘 인증 <b class="num">' + ok.length + '</b></span> · <span class="ot-wait">아직 <b class="num">' + wait.length + '</b></span> · <span class="ot-two">이틀 연속 미제출 <b class="num">' + two.length + '</b></span></span>'
          : '<span class="muted-note">오늘은 숙제가 없는 날 · 이틀 연속 미제출 ' + two.length + '명</span>') +
        (wait.length ? '<span class="ot-b__names"><small>아직</small>' + nm(wait) + '</span>' : '') +
        (two.length ? '<span class="ot-b__names"><small>이틀 연속</small>' + nm(two) + '</span>' : '') + '</li>';
    });
    return '<section class="ot-sec" aria-label="오늘 현황판"><h3 class="td-todo__title">📊 오늘 현황판 <small class="muted-note">' + esc(md(today())) + ' · 앱에서 받아 둔 기록</small></h3><ul class="ot-board">' + rows.join('') + '</ul></section>';
  }
  function careList(classes) {
    var out = [];
    classes.forEach(function (c) {
      (rowsOf(c.name) || []).forEach(function (x) {
        var why = [];
        if (x.two) why.push({ k: 'two', t: '이틀 연속 미제출' });
        if (x.tight) why.push({ k: 'tight', t: x.tight });
        if (x.fresh) why.push({ k: 'fresh', t: '이번 달 새로 합류' });
        if (why.length) out.push({ x: x, cls: c.name, why: why });
      });
    });
    return out;
  }
  function draftOf(it) {
    var n = it.x.name, k = it.why.map(function (w) { return w.k; }), sec = (it.x.r.app && it.x.r.app.status === 'ok' ? (it.x.r.app.secs.filter(function (s) { return s.state === 'run'; })[0] || {}).no : (it.x.r.hub.filter(function (g) { return g.state === 'run'; })[0] || {}).no) || '';
    if (k.indexOf('two') !== -1) return n + ' 학생, 요즘 바빴나요? 오늘의 지문 하나로 다시 리듬을 찾아봐요. 하루 한 지문, 지금부터 다시 시작해도 충분해요. 응원할게요! - 마라톤국어';
    if (k.indexOf('tight') !== -1) return n + ' 학생, ' + (sec ? sec + '구간 ' : '이번 구간 ') + '완주가 눈앞이에요. 남은 지문도 하루에 하나씩 같이 달려 봐요! - 마라톤국어';
    if (k.indexOf('fresh') !== -1) return n + ' 학생, 온라인 마라톤에 온 걸 환영해요! 매일 지문 하나, 천천히 리듬을 만들어 가 봐요. 궁금한 건 카카오톡 채널 jh국어연구소로 편하게 물어봐요. - 마라톤국어';
    return n + ' 학생, 오늘도 지문 하나로 리듬을 이어가 봐요. 매일 한 걸음이 완주를 만들어요. 응원할게요! - 마라톤국어';
  }
  function careHtml(classes) {
    var all = careList(classes);
    var grades = {}; all.forEach(function (it) { if (it.x.grade) grades[it.x.grade] = 1; });
    var list = all.filter(function (it) { return (!S.care.cls || it.cls === S.care.cls) && (!S.care.grade || it.x.grade === S.care.grade); });
    return '<section class="ot-sec ot-care" aria-label="챙길 학생"><h3 class="td-todo__title">💛 챙길 학생 <small class="muted-note num">' + list.length + '명</small></h3>' +
      (list.length ? '<ul class="ot-care__list">' + list.map(function (it) {
        return '<li class="ot-care__row"><button type="button" class="ot-nm" data-cs-open="' + esc(it.x.id) + '">' + esc(it.x.name) + '</button><span class="muted-note">' + esc(it.cls + (it.x.grade ? ' · ' + it.x.grade : '')) + '</span>' +
          '<span class="ot-care__why">' + it.why.map(function (w) { return '<span class="ot-why ot-why--' + w.k + '">' + esc(w.t) + '</span>'; }).join('') + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted-note">지금 챙길 학생이 없어요</p>') + '</section>';
  }

  /* ============================================================
     반 카드 요약 한 줄 — 보이는 카드부터 · 동시에 2개까지 (20261118a)
     ============================================================ */
  var MAX_FLY = 2, SUM_TTL = 300000;
  function wantSum(cls, force) {
    var x = S.sum[cls];
    if (x && x.busy) return;
    if (!force && x && x.d && Date.now() - x.at < SUM_TTL) return;
    if (!force && x && x.err && !x.retry) return;            /* 실패는 [다시 불러오기]로만 */
    if (S.sq.indexOf(cls) === -1) S.sq.push(cls);
    pump();
  }
  function pump() {
    while (S.fly < MAX_FLY && S.sq.length) {
      var i = 0;
      for (var j = 0; j < S.sq.length; j++) if (S.vis[S.sq[j]]) { i = j; break; }
      var cls = S.sq.splice(i, 1)[0];
      fetchSum(cls);
    }
  }
  function fetchSum(cls) {
    var c = sb();
    if (!c) return;
    var x = S.sum[cls] = Object.assign(S.sum[cls] || {}, { busy: true, retry: false });
    S.fly++;
    paintCard(cls);
    var done = function (err, d) {
      S.fly--;
      x.busy = false;
      if (err) { x.err = err; x.at = Date.now(); try { console.warn('[온라인 반 요약] ' + cls, err.message || err); } catch (e0) { /* 그대로 */ } }
      else { x.err = null; x.d = d || {}; x.at = Date.now(); }
      paintCard(cls);
      if (S.tbl.cls === cls) paintTblHead();
      pump();
    };
    Promise.resolve(c.rpc('online_stats_sum', { p_class: cls })).then(function (r) {
      if (r && r.error) done(needSql(r.error) ? { message: 'migration-119 SQL 을 먼저 실행해 주세요 · ' + r.error.message } : r.error);
      else done(null, r && r.data);
    }, function (e) { done(e || { message: 'network' }); });
  }
  function observe() {
    if (typeof IntersectionObserver === 'undefined') { S.classes.forEach(function (c) { S.vis[c.name] = true; }); pump(); return; }
    if (!S.obs) S.obs = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { var n = en.target.getAttribute('data-ot-card'); if (n) S.vis[n] = en.isIntersecting; });
      pump();
    }, { rootMargin: '200px 0px' });
    Array.prototype.forEach.call(document.querySelectorAll('.ot-card[data-ot-card]'), function (el) { if (!el.__otObs) { el.__otObs = 1; S.obs.observe(el); } });
  }

  function sumLine(cls) {
    var x = S.sum[cls] || {}, k = esc(cls);
    if (x.busy && !x.d) return '<span class="muted-note">요약 불러오는 중…</span>';
    if (x.err) return errHtml(x.err, 'data-ot-sumretry="' + k + '"', '다시 불러오기');
    if (!x.d) return '<span class="muted-note">요약 불러오는 중…</span>';
    var d = x.d;
    return '<button type="button" class="ot-sum" data-ot-pickcls="' + k + '">' +
      (d.today_open ? '오늘 제출 <b class="num">' + (d.today_done || 0) + '/' + d.today_open + '</b>' : '<span>오늘은 숙제 없는 날</span>') +
      ' · 이틀 이상 미제출 <b class="num">' + (d.miss2 || 0) + '</b>명 · 구간 위험 <b class="num">' + (d.risk || 0) + '</b>명' +
      (d.pending ? ' · <span class="ot-calc">계산 중 ' + d.pending + '명</span>' : '') + ' <small>(반 현황표 ›)</small></button>';
  }
  function cardHtml(c, rep) {
    var n = c.rows ? c.rows.length : 0, k = esc(c.name), x = S.sum[c.name] || {}, d = x.d || null;
    var miss = d ? Math.max(0, (d.today_open || 0) - (d.today_done || 0)) : 0;
    var kingsOn = !!(window.OnlineClass && (OnlineClass.opts(c.name) || {}).kings_on) || !!S.kings[c.name];
    return '<div class="tdc-card ot-card' + (S.tbl.cls === c.name ? ' is-pick' : '') + '" data-cls="' + k + '" data-ot-card="' + k + '">' +
      '<div class="tdc-head"><div class="tdc-main">' +
        '<div class="tdc-title"><span class="tdc-name">💻 ' + esc(c.name) + '</span><span class="muted-note num tdc-n">' + n + '명</span>' +
          '<span class="ot-at muted-note" data-ot-at="' + k + '">' + (d && d.fetched ? '앱 기록 받음: ' + esc(ago(d.fetched)) : '') + '</span></div>' +
        '<div class="ot-line" data-ot-line="' + k + '">' + sumLine(c.name) + '</div>' +
        (window.SubView && n ? '<div class="sv-clsbox">' + SubView.classBtnHtml(c.name) + '<span class="ot-miss' + (miss ? ' is-on' : '') + '" data-ot-miss="' + k + '"' + (d ? '' : ' hidden') + '>오늘 미제출 <b class="num">' + miss + '</b>명</span></div>' : '') +
        '<div class="tdc-appcls ot-app"><span>앱 클래스: <b>' + esc(rep || c.name) + '</b> 연결됨</span><button type="button" class="btn btn--sm tdc-appcls__check" data-app-check="' + k + '" title="클래스 이름을 복사하고 앱 관리자를 새 창으로 엽니다">앱에서 확인 ↗</button></div>' +
        '<div class="ot-kings"><label class="chk-inline"><input type="checkbox" data-ot-kings="' + k + '"' + (kingsOn ? ' checked' : '') + '> 이번 주 왕 뽑기 켜기</label><small class="muted-note">월 ~ 일을 한 주로 · 일요일 밤 자동 선정 · 확정은 직원</small></div>' +
        (kingsOn && window.Kings && n ? Kings.classHtml(c.name) : '') +
      '</div><div class="tdc-btns"><button type="button" class="btn btn--sm" data-ot-pickcls="' + k + '">📋 반 현황표</button><button type="button" class="btn btn--sm" data-ot-table="' + k + '">월말 정리</button><button type="button" class="btn btn--sm btn--ghost" data-ot-reload="' + k + '">다시 읽기</button></div></div>' +
    '</div>';
  }
  function paintCard(cls) {
    var q = String(cls).replace(/["\\]/g, '\\$&');
    var ln = document.querySelector('[data-ot-line="' + q + '"]');
    if (ln) ln.innerHTML = sumLine(cls);
    var d = (S.sum[cls] || {}).d;
    var at = document.querySelector('[data-ot-at="' + q + '"]');
    if (at) at.textContent = d && d.fetched ? '앱 기록 받음: ' + ago(d.fetched) : '';
    var ms = document.querySelector('[data-ot-miss="' + q + '"]');
    if (ms && d) { var m = Math.max(0, (d.today_open || 0) - (d.today_done || 0)); ms.hidden = false; ms.classList.toggle('is-on', !!m); ms.innerHTML = '오늘 미제출 <b class="num">' + m + '</b>명'; }
  }

  /* ============================================================
     📋 반 현황표 (20261118a) — 누를 때(반을 고를 때) 불러온다
     ============================================================ */
  /* 학년 표시 — 「1」 · 빈칸이면 반 이름의 학년(「[고2] 11월 …」)으로 보충 · 저장값은 그대로 (20261118b) */
  function gradeOf(g, cls) {
    var s = String(g || '').replace(/\s+/g, '');
    if (!s || /^\d$/.test(s)) { var m = String(cls || '').match(/([중고])\s*([1-3])/); if (m) return m[1] + m[2]; }
    return gradeLabel(g);
  }
  function gradeLabel(g) {
    var s = String(g || '').replace(/\s+/g, '');
    var m = s.match(/^(?:중|중학교?|중등|M)([1-3])(?:학년)?$/i); if (m) return '중' + m[1];
    m = s.match(/^(?:고|고등학교?|고등|H)([1-3])(?:학년)?$/i); if (m) return '고' + m[1];
    m = s.match(/^([1-3])학년$/); if (m) return s;
    return String(g || '');
  }
  function lastText(iso) {
    var k = kstOf(iso);
    if (!k) return '—';
    var t = today();
    if (k.day === t) return '오늘 ' + k.hm;
    var n = Math.round((Date.parse(t + 'T00:00:00Z') - Date.parse(k.day + 'T00:00:00Z')) / 864e5);
    return n > 0 ? n + '일 전' : md(k.day);
  }
  function stale(x) { var s = x.stat; return !s || !s.calc_day || s.calc_day !== today() || !!s.err; }
  function lateRec(x) { var s = x.stat || {}; var f = Date.parse(s.fetched || ''); return !s.has_rec || !isFinite(f) || Date.now() - f > 2 * 3600000; }
  /* 앱 기록이 비어 있음 — 기록이 아예 없거나 이번 달 날짜 기록이 0 (정말 안 낸 것과 구분 · 120 month_cal) (20261118b) */
  function emptyRec(x) { var s = x.stat || {}; return !stale(x) && (!s.has_rec || s.month_cal === 0); }
  function rateOf(s) { return s && s.open ? Math.round((s.done || 0) / s.open * 100) : null; }
  /* 오늘 기록을 아직 못 받음 — 오늘 날짜 기록이 없거나(120 today_cal) 마지막 받은 때가 오늘 전 */
  function todayWait(x) { var s = x.stat || {}, k = kstOf(s.fetched); return s.today === 'today' && (s.today_cal === false || !k || k.day < today()); }
  var TD = { ok: ['✓', 'ok', '제출'], late: ['✓', 'ok', '늦게 제출'], golden: ['✓', 'ok', '늦게 제출(골든패스)'], today: ['✗', 'miss', '미제출'], excused: ['—', 'off', '사정 인정'], none: ['—', 'off', '숙제 없는 날'] };
  var SEC = { done: ['●', 'done', '완주'], run: ['◐', 'run', '진행 중'], risk: ['⚠', 'risk', '위험 — 남은 날 다 내야 완주'], missed: ['✕', 'missed', '놓침'], wait: ['·', 'wait', '아직'] };
  function appSec(st, no) { return (st.app || []).filter(function (s) { return +s.no === no; })[0] || null; }
  function hubSec(st, no) { return (st.hub || []).filter(function (s) { return +s.no === no; })[0] || null; }
  function secKey(st, no) {
    var a = appSec(st, no);
    if (!a) return 'wait';
    if (a.state === 'run' && st.risk === 'app' && +st.risk_sec === no) return 'risk';
    return SEC[a.state] ? a.state : 'wait';
  }
  function hubDiff(st, no) {
    var a = appSec(st, no), h = hubSec(st, no);
    if (!a || !h) return false;
    var hs = h.state === 'none' ? 'wait' : h.state;
    return hs !== a.state;
  }
  function hubWhy(st, no) {
    var h = hubSec(st, no) || {}, T = { done: '완주', run: '진행 중', missed: '놓침', wait: '아직', none: '회차 없음' };
    return '허브 기준 ' + no + '구간: ' + (T[h.state] || '—') + (h.n ? ' (인정 ' + (h.ok || 0) + '/' + h.n + '회)' : '') +
      (st.golden ? ' · 골든패스 ' + md(st.golden) + ' 사용' : '') + (st.ex_n ? ' · 사정 인정 ' + st.ex_n + '일' : '') + (st.risk === 'hub' && +st.risk_sec === no ? ' · 남은 날 다 내야 완주' : '');
  }
  function curSecNo(st) { var a = (st.app || []).filter(function (s) { return s.state === 'run'; })[0] || (st.app || []).filter(function (s) { return s.state !== 'wait'; }).pop(); return a ? +a.no : 0; }
  function tblRows() {
    var T = S.tbl, list = (T.rows || []).slice(), t = today();
    var f = T.filter;
    list = list.filter(function (x) {
      var s = x.stat || {};
      if (f === 'today') return !stale(x) && s.today === 'today';
      if (f === 'miss2') return !stale(x) && s.miss_run >= 2;
      if (f === 'risk') return !stale(x) && !!s.risk;
      return true;
    });
    var nm = function (a, b) { return String(a.name).localeCompare(String(b.name), 'ko'); };
    var dir = T.dir === 'asc' ? 1 : -1, num = function (v) { return v == null || !isFinite(v) ? -1 : v; };
    /* 열 제목 누르기 — 이름 · 제출률 · 연속 · 마지막 제출 (▲ 오름 · ▼ 내림 · 20261118b) */
    if (T.sort === 'name') list.sort(function (a, b) { return T.dir === 'desc' ? nm(b, a) : nm(a, b); });
    else if (T.sort === 'rate') list.sort(function (a, b) { return dir * (num(rateOf(a.stat)) - num(rateOf(b.stat))) || nm(a, b); });
    else if (T.sort === 'streak') list.sort(function (a, b) { return dir * (((a.stat || {}).streak || 0) - ((b.stat || {}).streak || 0)) || nm(a, b); });
    else if (T.sort === 'last') list.sort(function (a, b) { return dir * (num(Date.parse((a.stat || {}).last || '')) - num(Date.parse((b.stat || {}).last || ''))) || nm(a, b); });
    else if (T.sort === 'done') list.sort(function (a, b) { return ((b.stat || {}).done || 0) - ((a.stat || {}).done || 0) || nm(a, b); });
    else list.sort(function (a, b) {
      var x = a.stat || {}, y = b.stat || {};
      return (y.miss_run || 0) - (x.miss_run || 0) || (y.risk ? 1 : 0) - (x.risk ? 1 : 0) || (y.today === 'today' ? 1 : 0) - (x.today === 'today' ? 1 : 0) || nm(a, b);
    });
    void t;
    return list;
  }
  function tblSum(rows) {
    var ok = rows.filter(function (x) { return !stale(x); }), s = function (x) { return x.stat; };
    var open = ok.filter(function (x) { return /^(ok|late|golden|today)$/.test(s(x).today); }).length, done = ok.filter(function (x) { return /^(ok|late|golden)$/.test(s(x).today); }).length;
    return { open: open, done: done, miss2: ok.filter(function (x) { return s(x).miss_run >= 2; }).length, risk: ok.filter(function (x) { return !!s(x).risk; }).length,
             fin: ok.filter(function (x) { return (s(x).app || []).some(function (a) { return a.state === 'done'; }); }).length, appOk: ok.filter(function (x) { return s(x).app_status === 'ok'; }).length,
             pending: rows.length - ok.length, late: rows.filter(lateRec).length,
             mDone: ok.reduce(function (a, x) { return a + (s(x).done || 0); }, 0), mOpen: ok.reduce(function (a, x) { return a + (s(x).open || 0); }, 0),
             wait: open > 0 && done === 0 && ok.some(todayWait),
             fetched: ok.map(function (x) { return s(x).fetched; }).filter(Boolean).sort().pop() || '' };
  }
  function rfText(id) {
    var R = S.rf, st = R.st[id];
    if (!st) return '';
    if (st === 'wait' || st === 'run') return '<span class="ot-rf is-run">받는 중…</span>';
    if (st === 'limit') return '<span class="ot-rf is-wait">한도 대기 · 곧 이어서</span>';
    if (st === 'ok') return '<span class="ot-rf is-ok">✓ 새로 받음</span>';
    if (st === 'fail') return '<span class="ot-rf is-bad" title="' + esc(R.msg[id] || '') + '">다시 받지 못했어요</span>';
    return '';
  }
  function rowHtml(x) {
    var T = S.tbl, s = x.stat || {}, id = esc(x.id), pend = stale(x), empty = emptyRec(x), late = !empty && lateRec(x), g = gradeOf(x.grade, T.cls), rt = pend ? null : rateOf(s);
    var name = '<td class="ot-tn"><label class="ot-tchk"><input type="checkbox" data-ot-tpick="' + id + '"' + (T.pick[x.id] ? ' checked' : '') + ' aria-label="' + esc(x.name + ' 응원 문자 초안에 넣기') + '"></label>' +
      '<button type="button" class="ot-nm" data-cs-open="' + id + '">' + esc(x.name) + '</button>' + (g ? '<small class="ot-g">' + esc(g) + '</small>' : '') +
      (empty ? '<span class="ot-tag ot-tag--late" title="앱 기록이 비어 있어요 · 정말 안 낸 것인지 앱에서 다시 받아 확인해요">기록 없음</span>' : '') +
      (late ? '<span class="ot-tag ot-tag--late">기록 늦음</span>' : '') + (pend ? '<span class="ot-tag ot-tag--calc">계산 중</span>' : '') +
      '<button type="button" class="ot-more" data-ot-more="' + id + '" aria-expanded="' + !!T.more[x.id] + '" aria-label="' + esc(x.name) + ' 자세히">' + (T.more[x.id] ? '▴' : '▾') + '</button></td>';
    var tdk = pend ? null : T._wait && todayWait(x) ? ['⏳', 'off', '오늘 기록 받는 중'] : (TD[s.today] || TD.none);
    var today_ = '<td class="ot-tc">' + (tdk ? '<span class="ot-td ot-td--' + tdk[1] + '" title="' + esc(tdk[2]) + '">' + tdk[0] + '</span>' : '<span class="muted-note">…</span>') + '</td>';
    var mon = '<td class="ot-tc num">' + (pend ? '…' : (s.done || 0) + '/' + (s.open || 0)) + '</td>' +
      '<td class="ot-tc ot-x num ot-rate">' + (pend ? '…' : rt == null ? '—' : rt + '%') + '</td>';
    var cur = pend ? 0 : curSecNo(s);
    var mcell = '<td class="ot-tc ot-m">' + (pend ? '…' : s.app_status === 'ok' && cur ? cur + '구간 <span class="ot-sg ot-sg--' + SEC[secKey(s, cur)][1] + '">' + SEC[secKey(s, cur)][0] + '</span>' : '<small class="muted-note">정보 없음</small>') + '</td>';
    var streak = '<td class="ot-tc ot-x num">' + (pend ? '…' : (s.streak || 0) + '일') + '</td>';
    var secs;
    if (pend) secs = '<td class="ot-tc ot-x" colspan="3"><span class="muted-note">…</span></td>';
    else if (s.app_status !== 'ok') secs = '<td class="ot-tc ot-x ot-noapp" colspan="3"><small>앱 반 정보 없음 — Replit 요청 필요</small>' +
      (s.risk === 'hub' ? ' <button type="button" class="ot-hub" data-ot-why="' + id + '|' + (s.risk_sec || 0) + '" title="허브 기준 이유">허 ⚠</button>' : '') + '</td>';
    else secs = [1, 2, 3].map(function (no) {
      var k = SEC[secKey(s, no)];
      return '<td class="ot-tc ot-x"><span class="ot-sg ot-sg--' + k[1] + '" title="' + esc(no + '구간 ' + k[2]) + '">' + k[0] + '</span>' +
        (hubDiff(s, no) ? '<button type="button" class="ot-hub" data-ot-why="' + id + '|' + no + '" title="허브 기준과 다름 — 누르면 이유">허</button>' : '') + '</td>';
    }).join('');
    var act = rfText(x.id) || ((late || empty) && x.linked ? '<button type="button" class="btn btn--sm ot-act" data-ot-refetch="' + id + '">다시 받기</button>' : '') +
      (pend ? '<button type="button" class="btn btn--sm ot-act" data-ot-calc="' + id + '"' + (T.calc[x.id] ? ' disabled' : '') + '>' + (T.calc[x.id] ? '계산 중…' : '지금 계산') + '</button>' : '');
    var last = '<td class="ot-tc ot-x ot-last">' + (pend ? '…' : esc(lastText(s.last))) + (act ? '<span class="ot-acts">' + act + '</span>' : '') + '</td>';
    var why = T.why[x.id];
    var more = '<tr class="ot-tmore" data-ot-morerow="' + id + '"' + (T.more[x.id] ? '' : ' hidden') + '><td colspan="10"><dl class="ot-tdl">' +
      '<dt>제출률</dt><dd>' + (pend ? '…' : rt == null ? '—' : rt + '%') + '</dd>' +
      '<dt>연속</dt><dd>' + (pend ? '…' : (s.streak || 0) + '일') + '</dd>' +
      (pend ? '' : s.app_status === 'ok' ? [1, 2, 3].map(function (no) { var k = SEC[secKey(s, no)]; return '<dt>' + no + '구간</dt><dd>' + k[0] + ' ' + esc(k[2]) + (hubDiff(s, no) ? ' <button type="button" class="ot-hub" data-ot-why="' + id + '|' + no + '">허</button>' : '') + '</dd>'; }).join('')
        : '<dt>구간</dt><dd>앱 반 정보 없음 — Replit 요청 필요' + (s.risk === 'hub' ? ' <button type="button" class="ot-hub" data-ot-why="' + id + '|' + (s.risk_sec || 0) + '">허 ⚠</button>' : '') + '</dd>') +
      '<dt>마지막 제출</dt><dd>' + (pend ? '…' : esc(lastText(s.last))) + '</dd>' + (act ? '<dt></dt><dd>' + act + '</dd>' : '') + '</dl></td></tr>';
    var whyRow = why ? '<tr class="ot-twhy"><td colspan="10"><small>' + esc(why) + '</small></td></tr>' : '';
    return '<tr class="ot-tr' + (s.miss_run >= 2 && !pend ? ' is-two' : '') + '" data-ot-row="' + id + '">' + name + today_ + mon + mcell + streak + secs + last + '</tr>' + whyRow + more;
  }
  function tblHeadHtml() {
    var T = S.tbl, rows = T.rows || [], sm = tblSum(rows);
    if (!T.cls || !T.rows) return '';
    var R = S.rf, left = R.queue.length + R.run.length;
    var fk = kstOf(sm.fetched);
    return '<p class="ot-tsum num" data-ot-tsum>' + (sm.wait ? '<span class="ot-calc">오늘 기록 받는 중</span> <small class="muted-note">(앱 기록 마지막 받음 ' + esc(fk ? (fk.day === today() ? '오늘 ' : md(fk.day) + ' ') + fk.hm : '—') + ')</small>'
        : sm.open ? '오늘 제출 <b>' + sm.done + '/' + sm.open + '</b>' : '오늘은 숙제 없는 날') +
      ' · 이 반 제출률 <b>' + (sm.mOpen ? Math.round(sm.mDone / sm.mOpen * 100) + '%' : '—') + '</b> <small class="muted-note">(제출 ' + sm.mDone + ' / 숙제 ' + sm.mOpen + ' · 이번 달 1일 ~ 오늘)</small>' +
      ' · 이틀 이상 미제출 <b>' + sm.miss2 + '</b>명 · 이번 구간 위험 <b>' + sm.risk + '</b>명 · 이번 달 구간 완주 ' +
      (sm.appOk ? '<b>' + sm.fin + '</b>명' : '<b>—</b> <small class="muted-note">(앱 반 정보 없음)</small>') + (sm.pending ? ' · <span class="ot-calc">계산 중 ' + sm.pending + '명</span>' : '') + '</p>' +
      (left ? '<p class="ot-rfbar" role="status">' + (R.until > Date.now() ? '한도 대기 — ' + Math.ceil((R.until - Date.now()) / 1000) + '초 뒤 이어서 받아요' : '받는 중… 약 ' + Math.max(1, Math.ceil(left / 28)) + '분') + ' · 남은 ' + left + '명 <small class="muted-note">(분당 28회 한도 · 차례로)</small></p>' : '');
  }
  function paintTblHead() { var h = document.querySelector('[data-ot-thead]'); if (h) h.innerHTML = tblHeadHtml(); }
  function tableHtml() {
    var T = S.tbl, cls = S.classes.map(function (c) { return c.name; });
    if (T.cls && cls.indexOf(T.cls) === -1) T.cls = '';
    var pickSel = '<label class="ot-tpick">반 <select class="input input--sm" data-ot-tcls><option value="">반을 고르세요</option>' + cls.map(function (n) { return '<option value="' + esc(n) + '"' + (T.cls === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>';
    var head = '<h3 class="td-todo__title">📋 반 현황표 <small class="muted-note">' + esc(md(today())) + ' · 서버가 미리 계산해 둔 요약</small></h3>';
    if (!T.cls) return '<section class="ot-sec ot-tbl" aria-label="반 현황표">' + head + '<div class="ot-tbar">' + pickSel + '</div><p class="muted-note">반을 고르거나 반 카드의 [📋 반 현황표]를 누르면 보여요</p></section>';
    var body;
    if (T.err && !T.rows) body = errHtml(T.err, 'data-ot-treload', '다시 불러오기');
    else if (!T.rows) body = '<p class="muted-note">불러오는 중…</p>';
    else {
      var rows = tblRows(), all = T.rows, sm = tblSum(all), picked = all.filter(function (x) { return T.pick[x.id]; });
      T._wait = sm.wait;
      var noApp = !all.some(function (x) { return !stale(x) && x.stat.app_status === 'ok'; });
      /* 열 제목 — 누르면 정렬(▲ ▼) · 이름 · 제출률 · 연속 · 마지막 제출 */
      var sh = function (key, label, cls) {
        var on = T.sort === key, ar = on ? (T.dir === 'asc' ? ' ▲' : ' ▼') : '';
        return '<th scope="col"' + (cls ? ' class="' + cls + '"' : '') + ' aria-sort="' + (on ? (T.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="ot-sh' + (on ? ' is-on' : '') + '" data-ot-sh="' + key + '">' + label + ar + '</button></th>';
      };
      var cnt = { all: all.length, today: all.filter(function (x) { return !stale(x) && x.stat.today === 'today'; }).length, miss2: sm.miss2, risk: sm.risk };
      var chips = [['all', '전체'], ['today', '오늘 미제출'], ['miss2', '이틀 이상 미제출'], ['risk', '구간 위험']].map(function (c) {
        return '<button type="button" class="ot-chip' + (T.filter === c[0] ? ' is-on' : '') + '" aria-pressed="' + (T.filter === c[0]) + '" data-ot-filter="' + c[0] + '">' + c[1] + ' <b class="num">' + cnt[c[0]] + '</b></button>';
      }).join('');
      var late = all.filter(function (x) { return x.linked; }).length;
      body = '<div class="ot-tctl"><div class="ot-chips" role="group" aria-label="거르기">' + chips + '</div>' +
          '<label class="ot-tsort">정렬 <select class="input input--sm" data-ot-sort><option value="care"' + (T.sort === 'care' ? ' selected' : '') + '>챙길 학생 먼저</option><option value="name"' + (T.sort === 'name' ? ' selected' : '') + '>이름순</option><option value="done"' + (T.sort === 'done' ? ' selected' : '') + '>제출 많은 순</option></select></label></div>' +
        '<div class="ot-tacts"><button type="button" class="btn btn--sm" data-ot-rfall' + (late ? '' : ' disabled') + '>↻ 이 반 전부 다시 받기</button><button type="button" class="btn btn--sm" data-ot-csv>📥 엑셀 받기</button>' +
          '<button type="button" class="btn btn--sm" data-ot-tdraft' + (picked.length ? '' : ' disabled') + '>✉️ 고른 ' + picked.length + '명 응원 문자 초안</button><small class="muted-note">문자는 복사만 해요 · 자동으로 보내지 않아요</small></div>' +
        (T.draft && picked.length ? '<div class="ot-drafts">' + picked.map(function (x) {
          return '<div class="ot-draft"><b>' + esc(x.name) + '</b><textarea class="input ot-draft__t" rows="3" data-ot-dt="' + esc(x.id) + '">' + esc(draftOf(itemOf(x))) + '</textarea><button type="button" class="btn btn--sm" data-ot-copy="' + esc(x.id) + '">복사</button></div>';
        }).join('') + '</div>' : '') +
        '<div class="ot-twrap"><table class="ot-tb"><thead><tr>' + sh('name', '이름') + '<th scope="col">오늘</th><th scope="col">이번 달 제출</th>' + sh('rate', '제출률', 'ot-x') +
          '<th scope="col" class="ot-m">지금 구간</th>' + sh('streak', '연속', 'ot-x') +
          (noApp ? '<th scope="col" class="ot-x ot-secs" colspan="3">1 · 2 · 3구간</th>' : '<th scope="col" class="ot-x">1구간</th><th scope="col" class="ot-x">2구간</th><th scope="col" class="ot-x">3구간</th>') +
          sh('last', '마지막 제출', 'ot-x') + '</tr></thead><tbody>' +
          (rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="10" class="muted-note">해당하는 학생이 없어요</td></tr>') + '</tbody></table></div>' +
        '<p class="muted-note ot-tlegend">오늘 ✓ 제출 · ✗ 미제출 · — 숙제 없는 날 &nbsp; 구간 ● 완주 · ◐ 진행 중 · ⚠ 위험(남은 날 다 내야 완주) · ✕ 놓침 · · 아직 (앱 기준 · 「허」 = 허브 기준과 다름)</p>';
    }
    return '<section class="ot-sec ot-tbl" aria-label="반 현황표">' + head + '<div class="ot-tbar">' + pickSel + '<button type="button" class="btn btn--sm btn--ghost" data-ot-treload>다시 읽기</button></div>' +
      '<div data-ot-thead>' + tblHeadHtml() + '</div>' + body + '</section>';
  }
  function itemOf(x) {
    var s = x.stat || {}, why = [];
    if (s.miss_run >= 2) why.push({ k: 'two' });
    if (s.risk) why.push({ k: 'tight' });
    return { x: { name: x.name, r: { app: s.app_status === 'ok' ? { status: 'ok', secs: s.app || [] } : null, hub: s.hub || [] } }, why: why };
  }
  function paintTbl() { var el = document.querySelector('.ot-tbl'); if (el) { var w = document.createElement('div'); w.innerHTML = tableHtml(); el.parentNode.replaceChild(w.firstChild, el); } }
  function loadTbl(force) {
    var T = S.tbl, c = sb(), cls = T.cls;
    if (!cls || !c || T.busy) return;
    if (!force && T.rows && T.for === cls && Date.now() - T.at < SUM_TTL) return;
    if (T.for !== cls) { T.rows = null; T.err = null; T.pick = {}; T.more = {}; T.why = {}; T.draft = false; }
    T.busy = true; T.for = cls;
    paintTbl();
    Promise.resolve(c.rpc('online_stats_class', { p_class: cls })).then(function (r) {
      T.busy = false;
      if (cls !== T.cls) return;
      if (r && r.error) { T.err = needSql(r.error) ? { message: 'migration-119 SQL 을 먼저 실행해 주세요 · ' + r.error.message } : r.error; }
      else { T.err = null; T.rows = Array.isArray(r && r.data) ? r.data : []; T.at = Date.now(); }
      paintTbl();
      autoCalc();
    }, function (e) { T.busy = false; T.err = e || { message: 'network' }; paintTbl(); });
  }
  /* 요약이 아직 없거나 날짜가 지난 학생 — 열 때 한 번 자동으로(60명까지) · 줄마다 [지금 계산] */
  function autoCalc() {
    var T = S.tbl, ids = (T.rows || []).filter(function (x) { return stale(x) && !T.calc[x.id] && !T.autoTried; }).map(function (x) { return x.id; });
    if (!ids.length) return;
    T.autoTried = true;
    calc(ids.slice(0, 60));
  }
  function mergeRows(list) {
    var T = S.tbl, by = {};
    (list || []).forEach(function (x) { by[x.id] = x; });
    if (T.rows) T.rows = T.rows.map(function (x) { return by[x.id] ? Object.assign({}, x, by[x.id]) : x; });
  }
  function calc(ids) {
    var T = S.tbl, c = sb();
    if (!c || !ids.length) return Promise.resolve(null);
    ids.forEach(function (id) { T.calc[id] = true; });
    paintTbl();
    return Promise.resolve(c.rpc('online_stats_calc', { p_students: ids })).then(function (r) {
      ids.forEach(function (id) { delete T.calc[id]; });
      if (r && r.error) { if (window.UI) UI.toast('계산하지 못했어요 — ' + (window.ErrKo ? ErrKo.ko(r.error) : r.error.message), 'bad'); paintTbl(); return null; }
      mergeRows(r && r.data);
      paintTbl();
      if (T.cls) wantSum(T.cls, true);
      return r && r.data;
    }, function () { ids.forEach(function (id) { delete T.calc[id]; }); paintTbl(); return null; });
  }

  /* ---------- 다시 받기 — 그 학생만 앱에서 새로 (app-sync refresh · 기존 「새로고침」과 같은 길) · 분당 28회 · 차례로 ---------- */
  var PER = 28, GAP = 60000;
  function refetch(ids) {
    var R = S.rf, T = S.tbl, by = {};
    (T.rows || []).forEach(function (x) { by[x.id] = x; });
    var skip = 0;
    ids.forEach(function (id) {
      if (by[id] && !by[id].linked) { skip++; return; }
      if (R.queue.indexOf(id) !== -1 || R.run.indexOf(id) !== -1) return;
      R.queue.push(id); R.st[id] = 'wait'; delete R.msg[id];
    });
    if (skip && window.UI) UI.toast('앱 연결이 안 된 ' + skip + '명은 건너뛰어요', 'bad');
    paintTbl();
    step();
  }
  function step() {
    var R = S.rf;
    if (R.run.length || !R.queue.length) { paintTblHead(); return; }
    /* 지난 60초 안에 보낸 학생 수 + 이번 묶음 ≤ 28 (app-sync 분당 28회 한도와 같게) · 한도(429 · busy)면 그 시간만큼 */
    var now = Date.now();
    R.sent = (R.sent || []).filter(function (t0) { return now - t0 < GAP; });
    var room = PER - R.sent.length, wait = R.until > now ? R.until - now : room <= 0 ? R.sent[0] + GAP - now : 0;
    if (wait > 0) { clearTimeout(R.timer); R.timer = setTimeout(step, Math.min(wait, 1000) + 20); paintTblHead(); return; }
    var chunk = R.queue.splice(0, room), start = Date.now();
    chunk.forEach(function () { R.sent.push(start); });
    R.run = chunk; R.last = start; R.until = 0;
    chunk.forEach(function (id) { R.st[id] = 'run'; });
    paintTbl();
    var call = window.AppErr ? AppErr.call({ action: 'refresh', students: chunk })
      : Promise.resolve(sb().functions.invoke('app-sync', { body: { action: 'refresh', students: chunk } })).then(function (r) { return r && !r.error && r.data ? r.data : { ok: false, reason: 'fn' }; });
    Promise.resolve(call).then(function (d) {
      d = d || { ok: false };
      var w = !d.ok && window.AppErr ? AppErr.wait(d) : 0;
      if (!d.ok && (w > 0 || /429|limit|rate/i.test(String(d.reason || '')))) {
        /* 한도 — 그 학생들을 맨 앞으로 돌려 놓고 기다렸다가 이어서 */
        R.run = []; R.queue = chunk.concat(R.queue); R.until = Date.now() + Math.max(w || 60, 5) * 1000;
        chunk.forEach(function (id) { R.st[id] = 'limit'; });
        paintTbl(); step(); return;
      }
      return calc(chunk).then(function (rows) {
        var by = {};
        (rows || []).forEach(function (x) { by[x.id] = x; });
        chunk.forEach(function (id) {
          var x = by[id], f = x && x.stat ? Date.parse(x.stat.fetched || '') : NaN;
          if (d.ok && isFinite(f) && f >= start - 5000) R.st[id] = 'ok';
          else { R.st[id] = 'fail'; R.msg[id] = d.ok ? '앱이 새 기록을 주지 않았어요(다음 차례에 다시)' : (window.AppErr ? AppErr.text(d) : String(d.reason || '')); }
        });
        R.run = [];
        paintTbl(); step();
      });
    }, function () { R.run = []; chunk.forEach(function (id) { R.st[id] = 'fail'; R.msg[id] = '연결이 끊겼어요'; }); paintTbl(); step(); });
  }

  function csvText() {
    var T = S.tbl, q = function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ['이름', '학년', '오늘', '이번 달 제출', '제출률', '연속', '1구간', '2구간', '3구간', '마지막 제출'];
    var rows = tblRows().map(function (x) {
      var s = x.stat || {}, pend = stale(x), rt = rateOf(s);
      if (pend) return [x.name, gradeOf(x.grade, T.cls), '계산 중', '', '', '', '', '', '', ''];
      var sc = function (no) { return s.app_status === 'ok' ? SEC[secKey(s, no)][2] : '앱 반 정보 없음'; };
      return [x.name, gradeOf(x.grade, T.cls), emptyRec(x) ? '기록 없음' : (TD[s.today] || TD.none)[2], (s.done || 0) + '/' + (s.open || 0), rt == null ? '' : rt + '%', (s.streak || 0) + '일', sc(1), sc(2), sc(3), lastText(s.last)];
    });
    void T;
    return [head].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }
  function download() {
    var name = '반현황표_' + String(S.tbl.cls).replace(/[\\/:*?"<>|]/g, '') + '_' + today() + '.csv', text = csvText();
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    try { a.href = URL.createObjectURL(blob); } catch (e) { a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + text); }
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); try { URL.revokeObjectURL(a.href); } catch (e) { /* 그대로 */ } }, 500);
  }

  /* ============================================================
     온라인 탭 전체
     ============================================================ */
  function inner(opts) {
    var classes = S.classes;
    if (!classes.length) return '<p class="panel__hint">온라인 반이 없어요 · [📥 온라인 반 가져오기]로 앱 반 명단을 가져올 수 있어요</p>';
    return tableHtml() + '<div class="tdc-list-wrap">' + classes.map(function (c) { return cardHtml(c, opts.rep ? opts.rep(c.name) : ''); }).join('') + '</div>';
  }
  var lastOpts = {};
  function html(classes, opts) {
    opts = opts || {};
    lastOpts = opts;
    S.classes = classes || [];
    S.repaint = opts.repaint || S.repaint;
    S.classes.forEach(function (c) { wantSum(c.name); });
    if (S.tbl.cls) setTimeout(function () { loadTbl(); }, 0);
    setTimeout(observe, 0);
    return inner(opts);
  }
  function repaintWrap() {
    var w = document.querySelector('.ot-wrap');
    if (w) { w.innerHTML = inner(lastOpts); setTimeout(observe, 0); } else if (S.repaint) S.repaint();
  }
  function pickCls(n) {
    S.tbl.cls = n; S.tbl.autoTried = false; saveTbl();
    Array.prototype.forEach.call(document.querySelectorAll('.ot-card'), function (el) { el.classList.toggle('is-pick', el.getAttribute('data-ot-card') === n); });
    loadTbl(true);
    setTimeout(function () { var el = document.querySelector('.ot-tbl'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 30);
  }

  function click(e) {
    var t = e.target, b;
    b = t.closest('[data-ot-sumretry]');
    if (b) { var n0 = b.getAttribute('data-ot-sumretry'); var x0 = S.sum[n0] = S.sum[n0] || {}; x0.err = null; x0.retry = true; wantSum(n0, true); return true; }
    b = t.closest('[data-ot-pickcls]');
    if (b) { pickCls(b.getAttribute('data-ot-pickcls')); return true; }
    b = t.closest('[data-ot-treload]');
    if (b) { S.tbl.autoTried = false; loadTbl(true); if (S.tbl.cls) wantSum(S.tbl.cls, true); return true; }
    b = t.closest('[data-ot-sh]');
    if (b) { var sk = b.getAttribute('data-ot-sh'); if (S.tbl.sort === sk) S.tbl.dir = S.tbl.dir === 'asc' ? 'desc' : 'asc'; else { S.tbl.sort = sk; S.tbl.dir = sk === 'name' ? 'asc' : 'desc'; } saveTbl(); paintTbl(); return true; }
    b = t.closest('[data-ot-filter]');
    if (b) { S.tbl.filter = b.getAttribute('data-ot-filter'); saveTbl(); paintTbl(); return true; }
    b = t.closest('[data-ot-more]');
    if (b) { var id = b.getAttribute('data-ot-more'); S.tbl.more[id] = !S.tbl.more[id]; paintTbl(); return true; }
    b = t.closest('[data-ot-why]');
    if (b) { var p = b.getAttribute('data-ot-why').split('|'), row = (S.tbl.rows || []).filter(function (x) { return x.id === p[0]; })[0]; if (row) { S.tbl.why[p[0]] = S.tbl.why[p[0]] ? '' : hubWhy(row.stat || {}, +p[1] || 1); paintTbl(); } return true; }
    b = t.closest('[data-ot-calc]');
    if (b) { calc([b.getAttribute('data-ot-calc')]); return true; }
    b = t.closest('[data-ot-refetch]');
    if (b) { refetch([b.getAttribute('data-ot-refetch')]); return true; }
    b = t.closest('[data-ot-rfall]');
    if (b) { refetch((S.tbl.rows || []).filter(function (x) { return x.linked; }).map(function (x) { return x.id; })); return true; }
    b = t.closest('[data-ot-csv]');
    if (b) { download(); return true; }
    b = t.closest('[data-ot-tdraft]');
    if (b) { S.tbl.draft = true; paintTbl(); return true; }
    b = t.closest('[data-ot-toggle]');
    if (b) { var n = b.getAttribute('data-ot-toggle'); S.open[n] = !S.open[n]; repaintWrap(); return true; }
    b = t.closest('[data-ot-table]');
    if (b) { if (window.OnlineRunTable) OnlineRunTable.open(b.getAttribute('data-ot-table')); return true; }
    b = t.closest('[data-ot-reload]');
    if (b) { var n2 = b.getAttribute('data-ot-reload'); wantSum(n2, true); if (S.tbl.cls === n2) loadTbl(true); return true; }
    b = t.closest('[data-ot-draft]');
    if (b) { S.draft = true; repaintWrap(); return true; }
    b = t.closest('[data-ot-copy]');
    if (b) {
      var ta = document.querySelector('[data-ot-dt="' + String(b.getAttribute('data-ot-copy')).replace(/["\\]/g, '\\$&') + '"]');
      var txt = ta ? ta.value : '';
      if (txt && window.UI && UI.copyText) UI.copyText(txt).then(function () { UI.toast('문자 초안을 복사했어요 (보내지는 않았어요)', 'good'); }, function () { UI.toast('복사하지 못했어요', 'bad'); });
      return true;
    }
    return false;
  }
  function change(e) {
    var t = e.target;
    if (t.matches && t.matches('[data-ot-tcls]')) { if (t.value) pickCls(t.value); else { S.tbl.cls = ''; saveTbl(); paintTbl(); } return true; }
    if (t.matches && t.matches('[data-ot-sort]')) { S.tbl.sort = t.value; S.tbl.dir = t.value === 'name' ? 'asc' : 'desc'; saveTbl(); paintTbl(); return true; }
    if (t.matches && t.matches('[data-ot-tpick]')) { S.tbl.pick[t.getAttribute('data-ot-tpick')] = t.checked; S.tbl.draft = false; paintTbl(); return true; }
    if (t.matches && t.matches('[data-ot-pick]')) { S.pick[t.getAttribute('data-ot-pick')] = t.checked; S.draft = false; repaintWrap(); return true; }
    if (t.matches && t.matches('[data-ot-fcls]')) { S.care.cls = t.value; saveCare(); repaintWrap(); return true; }
    if (t.matches && t.matches('[data-ot-fgrade]')) { S.care.grade = t.value; saveCare(); repaintWrap(); return true; }
    if (t.matches && t.matches('[data-ot-kings]')) {
      var cls = t.getAttribute('data-ot-kings'), on = t.checked, c = sb();
      if (!c) return true;
      Promise.resolve(c.rpc('online_kings_set', { p_class: cls, p_on: on })).then(function (r) {
        if (r && r.error) { t.checked = !on; if (window.UI) UI.toast(needSql(r.error) ? 'migration-118 SQL 을 먼저 실행해 주세요' : (window.ErrKo ? ErrKo.ko(r.error) : r.error.message), 'bad'); return; }
        S.kings[cls] = on;
        var o = window.OnlineClass && OnlineClass.opts(cls); if (o) o.kings_on = on;
        if (window.UI) UI.toast(cls + ' — 이번 주 왕 뽑기 ' + (on ? '켬 (일요일 밤 자동 선정)' : '끔'), 'good');
        repaintWrap();
      }, function () { t.checked = !on; });
      return true;
    }
    return false;
  }
  window.OnlineToday = { html: html, click: click, change: change, load: load, state: function () { return S; }, rowsOf: rowsOf, draftOf: draftOf, stuOf: stuOf,
                         boardHtml: boardHtml, careHtml: careHtml, gradeLabel: gradeLabel, gradeOf: gradeOf, lastText: lastText, csvText: csvText, refetch: refetch, pickCls: pickCls };
})();
