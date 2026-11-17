/* ============================================================
   online-today.js — 코치룸 「오늘」 💻 온라인 탭 (20261117c · 직원만)

   온라인 마라톤(1일 1지문 · 데일리 영상코칭 · 월 단위 클래스 · 3구간 완주) — 수업일 · 출결 · 수업 레포트 · 필기 · 수업 전 알림이 없다
   이미 받아 둔 앱 기록만(online_run_class · migration-117 · 118) · 계산은 러닝노트 · 학생 카드와 같은 online-run.js

     · 오늘 현황판(반별) — 오늘 인증 n / 아직 n / 이틀 연속 미제출 n · 이름을 누르면 학생 카드
     · 챙길 학생 — 이틀 연속 미제출 · 이번 구간 완주 아슬아슬(남은 날 다 내야 완주) · 이번 달 새로 합류 · 반 · 학년 거르기
       응원 문자 초안 — 고른 학생마다 짧은 초안 · [복사]만(자동 발송 없음 · 「꼭 · 반드시 · 무조건」 · 꾸짖는 말 없음)
     · 반 카드 — 학생 수 · 「앱 기록 받음: n분 전」 · 「이번 달 1구간 완주 n명 · 진행 중 n명」(앱 기준 · 누르면 반 표) ·
       [오늘 제출물 보기] 옆 「오늘 미제출 n명」 · 「앱 클래스: (반 이름) 연결됨 · 앱에서 확인 ↗」 · [이번 주 왕 뽑기 켜기](118 · 월 ~ 일 · 일요일 밤 자동 선정) · 학생 목록
     · 월말 정리 — 반별 구간 완주 표(앱 기준 · 허브 기준 · 골든패스 · 사정 인정 내역 · 엑셀)
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
  var KEY = 'mh.ot.care';
  var S = { by: {}, busy: {}, err: {}, open: {}, care: { cls: '', grade: '' }, pick: {}, draft: false, repaint: null, kings: {} };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv && typeof sv === 'object') S.care = { cls: String(sv.cls || ''), grade: String(sv.grade || '') }; } catch (e) { /* 그대로 */ }
  function saveCare() { try { localStorage.setItem(KEY, JSON.stringify(S.care)); } catch (e) { /* 그대로 */ } }

  /* 반 하나 불러오기 (5분 안에 다시 부르면 기억한 것) */
  function load(cls, force) {
    var c = sb(), x = S.by[cls];
    if (!c || S.busy[cls] || (!force && x && Date.now() - x.at < 300000)) return;
    S.busy[cls] = true;
    Promise.resolve(c.rpc('online_run_class', { p_class: cls })).then(function (r) {
      S.busy[cls] = false;
      if (r && r.error) S.err[cls] = /Could not find the function|schema cache|does not exist/i.test(r.error.message || '') ? 'migration-117 · 118 SQL 을 먼저 실행해 주세요' : r.error.message;
      else { S.err[cls] = ''; S.by[cls] = { at: Date.now(), list: Array.isArray(r && r.data) ? r.data : [] }; }
      if (S.repaint) S.repaint();
    }, function () { S.busy[cls] = false; S.err[cls] = '불러오지 못했습니다'; if (S.repaint) S.repaint(); });
  }

  /* 학생 한 명 — 오늘 · 연속 미제출 · 아슬아슬 · 새로 합류 */
  function stuOf(s, t) {
    var ym = t.slice(0, 7), r = OnlineRun.compute(s.data || {}, ym, { today: t, excuse: s.excuse || [], staff: true });
    var cd = r.days.filter(function (x) { return x.counted && x.date < t; });
    /* 이틀 연속 미제출 — 실제로 안 낸 날(골든패스로 인정한 날도 안 낸 날로 셈 · 사정 인정 날은 뺌) */
    var last2 = cd.slice(-2), two = last2.length === 2 && last2.every(function (x) { return (x.gpFrom || x.kind) === 'miss'; });
    var td = r.todayDay, todayKind = td && td.counted ? td.kind : 'none';
    /* 아슬아슬 — 앱 기준(반 정보가 있으면): 지금 구간에서 남은 회차를 다 내야 기준을 넘음 · 없으면 허브 기준: 골든패스를 이미 썼고 이번 구간이 진행 중 */
    var tight = '', sec = null;
    if (r.app && r.app.status === 'ok') {
      sec = r.app.secs.filter(function (x) { return x.state === 'run'; })[0] || null;
      if (sec) {
        var left = r.days.filter(function (x) { return x.counted && x.date >= t && x.seg === sec.no && x.kind !== 'ok'; }).length;
        var th = r.app.threshold, best = sec.n + left ? (sec.on + left) / (sec.n + left) * 100 : 0, miss1 = sec.n + left ? (sec.on + left - 1) / (sec.n + left) * 100 : 0;
        if (left > 0 && best >= th && miss1 < th) tight = sec.no + '구간 · 남은 ' + left + '회 다 내야 완주(앱 기준)';
      }
    } else {
      var hs = r.hub.filter(function (g) { return g.state === 'run'; })[0];
      if (hs && r.golden) tight = hs.no + '구간 · 골든패스를 써서 남은 날 다 내야 완주(허브 기준)';
    }
    var first = Object.keys((function () { var o = {}; [].concat(((s.data || {}).old || {}).calendar || [], (s.data || {}).calendar || []).forEach(function (c) { if (c && c.date && +c.order > 0) o[c.date] = 1; }); return o; })()).sort()[0] || '';
    var fresh = (s.start_on && String(s.start_on).slice(0, 7) === ym) || (first && first.slice(0, 7) === ym);
    var appSec = r.app && r.app.status === 'ok' ? r.app.secs : null;
    return { id: s.id, name: s.name, grade: s.grade || '', r: r, today: todayKind, two: two, tight: tight, fresh: !!fresh, appSec: appSec, fetched: s.fetched };
  }
  function rowsOf(cls) {
    var x = S.by[cls], t = today();
    if (!x || !window.OnlineRun) return null;
    if (!x.rows || x.rowsDay !== t) { x.rows = x.list.map(function (s) { return stuOf(s, t); }); x.rowsDay = t; }
    return x.rows;
  }
  var TODAY_T = { ok: ['✓ 인증', 'ok'], late: ['⏰ 늦게', 'late'], today: ['아직', 'wait'], excused: ['사정 인정', 'ex'], golden: ['골든패스', 'ex'], none: ['숙제 없음', 'off'], future: ['—', 'off'], miss: ['아직', 'wait'], weekend: ['숙제 없음', 'off'], off: ['숙제 없음', 'off'] };

  /* ---------- 오늘 현황판 ---------- */
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

  /* ---------- 챙길 학생 · 응원 문자 초안 ---------- */
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
    return n + ' 학생, 온라인 마라톤에 온 걸 환영해요! 매일 지문 하나, 천천히 리듬을 만들어 가 봐요. 궁금한 건 카카오톡 채널 jh국어연구소로 편하게 물어봐요. - 마라톤국어';
  }
  function careHtml(classes) {
    var all = careList(classes);
    var grades = {}; all.forEach(function (it) { if (it.x.grade) grades[it.x.grade] = 1; });
    var list = all.filter(function (it) { return (!S.care.cls || it.cls === S.care.cls) && (!S.care.grade || it.x.grade === S.care.grade); });
    var picked = list.filter(function (it) { return S.pick[it.x.id]; });
    return '<section class="ot-sec ot-care" aria-label="챙길 학생"><h3 class="td-todo__title">💛 챙길 학생 <small class="muted-note num">' + list.length + '명</small></h3>' +
      '<div class="ot-filters"><label>반 <select class="input input--sm" data-ot-fcls><option value="">전체</option>' + classes.map(function (c) { return '<option value="' + esc(c.name) + '"' + (S.care.cls === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>학년 <select class="input input--sm" data-ot-fgrade><option value="">전체</option>' + Object.keys(grades).sort().map(function (g) { return '<option value="' + esc(g) + '"' + (S.care.grade === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></label></div>' +
      (list.length ? '<ul class="ot-care__list">' + list.map(function (it) {
        return '<li class="ot-care__row"><label class="ot-care__chk"><input type="checkbox" data-ot-pick="' + esc(it.x.id) + '"' + (S.pick[it.x.id] ? ' checked' : '') + ' aria-label="' + esc(it.x.name + ' 응원 문자 초안에 넣기') + '"></label>' +
          '<button type="button" class="ot-nm" data-cs-open="' + esc(it.x.id) + '">' + esc(it.x.name) + '</button><span class="muted-note">' + esc(it.cls + (it.x.grade ? ' · ' + it.x.grade : '')) + '</span>' +
          '<span class="ot-care__why">' + it.why.map(function (w) { return '<span class="ot-why ot-why--' + w.k + '">' + esc(w.t) + '</span>'; }).join('') + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted-note">지금 챙길 학생이 없어요</p>') +
      '<div class="ot-care__acts"><button type="button" class="btn btn--sm" data-ot-draft' + (picked.length ? '' : ' disabled') + '>✉️ 고른 ' + picked.length + '명 응원 문자 초안</button><span class="muted-note">복사만 해요 · 자동으로 보내지 않아요</span></div>' +
      (S.draft && picked.length ? '<div class="ot-drafts">' + picked.map(function (it) {
        return '<div class="ot-draft"><b>' + esc(it.x.name) + '</b><textarea class="input ot-draft__t" rows="3" data-ot-dt="' + esc(it.x.id) + '">' + esc(draftOf(it)) + '</textarea><button type="button" class="btn btn--sm" data-ot-copy="' + esc(it.x.id) + '">복사</button></div>';
      }).join('') + '</div>' : '') +
    '</section>';
  }

  /* ---------- 반 카드 ---------- */
  function cardHtml(c, rep) {
    var rs = rowsOf(c.name), n = c.rows ? c.rows.length : 0, open = !!S.open[c.name], k = esc(c.name);
    var at = rs ? rs.map(function (x) { return x.fetched; }).filter(Boolean).sort()[0] : '';
    var line = '';
    if (rs) {
      var known = rs.filter(function (x) { return x.appSec; });
      if (!known.length) line = '<button type="button" class="ot-sum" data-ot-table="' + k + '">이번 달 구간 · 앱 기록 확인 전 <small>(반 표 ›)</small></button>';
      else {
        var cur = (known[0].appSec.filter(function (s) { return s.state === 'run'; })[0] || known[0].appSec.filter(function (s) { return s.state === 'done' || s.state === 'missed'; }).pop() || known[0].appSec[0]);
        var no = cur.no, done = known.filter(function (x) { var s = x.appSec[no - 1]; return s && s.state === 'done'; }).length, run = known.filter(function (x) { var s = x.appSec[no - 1]; return s && s.state === 'run'; }).length;
        line = '<button type="button" class="ot-sum" data-ot-table="' + k + '">이번 달 ' + no + '구간 완주 <b class="num">' + done + '</b>명 · 진행 중 <b class="num">' + run + '</b>명 <small>(앱 기준 · 반 표 ›)</small></button>';
      }
    } else line = '<span class="muted-note">' + (S.err[c.name] ? esc(S.err[c.name]) : '불러오는 중…') + '</span>';
    var miss = rs ? rs.filter(function (x) { return x.today === 'today' || x.today === 'miss'; }).length : 0;
    var kingsOn = !!(window.OnlineClass && (OnlineClass.opts(c.name) || {}).kings_on) || !!S.kings[c.name];
    return '<div class="tdc-card ot-card' + (open ? ' is-open' : '') + '" data-cls="' + k + '" data-ot-card="' + k + '">' +
      '<div class="tdc-head"><div class="tdc-main">' +
        '<div class="tdc-title"><span class="tdc-name">💻 ' + esc(c.name) + '</span><span class="muted-note num tdc-n">' + n + '명</span>' +
          (at ? '<span class="ot-at muted-note">앱 기록 받음: ' + esc(ago(at)) + '</span>' : '') + '</div>' +
        '<div class="ot-line">' + line + '</div>' +
        (window.SubView && n ? '<div class="sv-clsbox">' + SubView.classBtnHtml(c.name) + (rs ? ' <span class="ot-miss' + (miss ? ' is-on' : '') + '">오늘 미제출 <b class="num">' + miss + '</b>명</span>' : '') + '</div>' : '') +
        '<div class="tdc-appcls ot-app"><span>앱 클래스: <b>' + esc(rep || c.name) + '</b> 연결됨</span><button type="button" class="btn btn--sm tdc-appcls__check" data-app-check="' + k + '" title="클래스 이름을 복사하고 앱 관리자를 새 창으로 엽니다">앱에서 확인 ↗</button></div>' +
        '<div class="ot-kings"><label class="chk-inline"><input type="checkbox" data-ot-kings="' + k + '"' + (kingsOn ? ' checked' : '') + '> 이번 주 왕 뽑기 켜기</label><small class="muted-note">월 ~ 일을 한 주로 · 일요일 밤 자동 선정 · 확정은 직원</small></div>' +
        (kingsOn && window.Kings && n ? Kings.classHtml(c.name) : '') +
      '</div><div class="tdc-btns"><button type="button" class="btn btn--sm" data-ot-table="' + k + '">📋 월말 정리</button><button type="button" class="btn btn--sm btn--ghost" data-ot-reload="' + k + '">다시 읽기</button></div></div>' +
      (n ? '<div class="tdc-togglebar"><span class="tdc-tgcell"><button type="button" class="tdc-pill" data-ot-toggle="' + k + '" aria-expanded="' + open + '">' + (open ? '접기 ▴' : '학생 ' + n + '명 ▾') + '</button></span></div>' : '') +
      (open && rs ? '<ul class="ot-stu">' + rs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).map(function (x) {
        var T = TODAY_T[x.today] || TODAY_T.none, sec = x.appSec ? (x.appSec.filter(function (s) { return s.state === 'run'; })[0] || null) : null;
        return '<li class="ot-stu__r"><button type="button" class="ot-nm" data-cs-open="' + esc(x.id) + '">' + esc(x.name) + '</button>' +
          '<span class="ot-t ot-t--' + T[1] + '">' + T[0] + '</span><span class="muted-note num">연속 ' + x.r.streak + '회</span>' +
          (sec ? '<span class="muted-note num">' + sec.no + '구간 정시 ' + sec.on + '/' + sec.n + '</span>' : '') +
          (x.two ? '<span class="ot-why ot-why--two">이틀 연속 미제출</span>' : '') + '</li>';
      }).join('') + '</ul>' : '') +
    '</div>';
  }

  /* 온라인 탭 전체 */
  function html(classes, opts) {
    opts = opts || {};
    S.repaint = opts.repaint || S.repaint;
    classes.forEach(function (c) { load(c.name); });
    if (!classes.length) return '<p class="panel__hint">온라인 반이 없어요 · [📥 온라인 반 가져오기]로 앱 반 명단을 가져올 수 있어요</p>';
    return boardHtml(classes) + careHtml(classes) +
      '<div class="tdc-list-wrap">' + classes.map(function (c) { return cardHtml(c, opts.rep ? opts.rep(c.name) : ''); }).join('') + '</div>';
  }

  function click(e) {
    var t = e.target;
    var b = t.closest('[data-ot-toggle]');
    if (b) { var n = b.getAttribute('data-ot-toggle'); S.open[n] = !S.open[n]; if (S.repaint) S.repaint(); return true; }
    b = t.closest('[data-ot-table]');
    if (b) { if (window.OnlineRunTable) OnlineRunTable.open(b.getAttribute('data-ot-table')); return true; }
    b = t.closest('[data-ot-reload]');
    if (b) { load(b.getAttribute('data-ot-reload'), true); return true; }
    b = t.closest('[data-ot-draft]');
    if (b) { S.draft = true; if (S.repaint) S.repaint(); return true; }
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
    if (t.matches && t.matches('[data-ot-pick]')) { S.pick[t.getAttribute('data-ot-pick')] = t.checked; S.draft = false; if (S.repaint) S.repaint(); return true; }
    if (t.matches && t.matches('[data-ot-fcls]')) { S.care.cls = t.value; saveCare(); if (S.repaint) S.repaint(); return true; }
    if (t.matches && t.matches('[data-ot-fgrade]')) { S.care.grade = t.value; saveCare(); if (S.repaint) S.repaint(); return true; }
    if (t.matches && t.matches('[data-ot-kings]')) {
      var cls = t.getAttribute('data-ot-kings'), on = t.checked, c = sb();
      if (!c) return true;
      Promise.resolve(c.rpc('online_kings_set', { p_class: cls, p_on: on })).then(function (r) {
        if (r && r.error) { t.checked = !on; if (window.UI) UI.toast(/Could not find the function|schema cache/i.test(r.error.message || '') ? 'migration-118 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); return; }
        S.kings[cls] = on;
        var o = window.OnlineClass && OnlineClass.opts(cls); if (o) o.kings_on = on;
        if (window.UI) UI.toast(cls + ' — 이번 주 왕 뽑기 ' + (on ? '켬 (일요일 밤 자동 선정)' : '끔'), 'good');
        if (S.repaint) S.repaint();
      }, function () { t.checked = !on; });
      return true;
    }
    return false;
  }
  window.OnlineToday = { html: html, click: click, change: change, load: load, state: function () { return S; }, rowsOf: rowsOf, draftOf: draftOf };
})();
