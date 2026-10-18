/* ============================================================
   nav.js — 코치룸 뒤로가기 · 새로고침

   · 탭(① 명단 · ② 작성 · 「오늘」 …) · ② 작성의 반 · 주차를 바꿀 때마다 뒤로가기 기록을 남긴다
     주소: #tab=write&cls=반포반&week=2026-10-12  → 새로고침해도 그 탭 · 반 · 주차가 그대로 열린다
   · 창(학생 정보 · 코멘트 · 확인 창 · 미리보기 · 지금 제출 현황 …)이 열리면 기록을 하나 더 —
     뒤로가기 = 창 닫기. 창을 단추로 닫으면 그 기록도 같이 지운다.
   · 더 돌아갈 곳이 없을 때만 사이트 밖으로 나간다.
   · 저장 안 된 글이 있을 때 사이트를 떠나려 하면 브라우저가 「저장 안 된 내용이 있습니다」 확인을 띄운다
     (자동 저장이 끝났으면 띄우지 않는다).
   휴대폰의 뒤로가기 단추 · 밀어서 뒤로가기도 브라우저 뒤로가기와 같다.
   ============================================================ */

(function () {
  'use strict';

  var TABS = ['roster', 'write', 'publish', 'send', 'notice', 'book', 'photo', 'today'];
  var OVERLAYS = ['pvOverlay', 'rvLive'];           /* dialog 가 아닌 전체 화면 창 */
  var ready = false, restoring = 0, ignorePop = 0;
  var stack = [];                                     /* 지금 열린 창 (위가 마지막) */
  var closingByBack = [];

  function enc(v) { return encodeURIComponent(v); }
  function parse() {
    var o = {};
    String(location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { try { o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} }
    });
    return o.tab ? o : null;
  }
  function activeTab() {
    for (var i = 0; i < TABS.length; i++) {
      var t = document.getElementById('tab-' + TABS[i]);
      if (t && t.getAttribute('aria-selected') === 'true') return i;
    }
    return -1;
  }
  function navNow() {
    var i = activeTab();
    var o = { tab: TABS[i] || 'today' };
    if (o.tab === 'write' && window.Writer) {
      var cls = Writer.currentClass && Writer.currentClass();
      var d = Writer.current && Writer.current();
      if (cls) o.cls = cls;
      if (d && d.weekStart) o.week = d.weekStart;
    }
    return o;
  }
  function hashOf(o) {
    var p = ['tab=' + o.tab];
    if (o.cls) p.push('cls=' + enc(o.cls));
    if (o.week) p.push('week=' + o.week);
    return '#' + p.join('&');
  }
  function sameNav(a, b) {
    return !!a && !!b && a.tab === b.tab && (a.cls || '') === (b.cls || '') && (a.week || '') === (b.week || '');
  }

  function push() {
    if (!ready || restoring) return;
    var o = navNow();
    var st = history.state;
    if (st && st.nav && !st.modal && sameNav(st.nav, o)) return;
    history.pushState({ nav: o }, '', hashOf(o));
  }
  function replace() {
    var o = navNow();
    history.replaceState({ nav: o }, '', hashOf(o));
  }

  /* 뒤로가기 · 새로고침 — 그 탭 · 주차 · 반으로 */
  function apply(o) {
    if (!o || !o.tab) return Promise.resolve();
    restoring++;
    var idx = TABS.indexOf(o.tab);
    if (idx >= 0 && idx !== activeTab()) UI.selectTab(idx);
    var p = Promise.resolve();
    if (o.tab === 'write' && window.Writer) {
      var d = Writer.current && Writer.current();
      if (o.week && d && o.week !== d.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(o.week)) p = Writer.switchWeek(o.week, 0) || Promise.resolve();
      p = p.then(function () { if (o.cls) Writer.selectClass(o.cls); });
    }
    return p.then(function () { restoring--; }, function () { restoring--; });
  }

  /* ---------- 창 ---------- */

  function isOpen(el) {
    return el.tagName === 'DIALOG' ? !!el.open : !el.hidden;
  }
  function keyOf(el) { return el.id || ''; }

  function onOpen(el) {
    if (stack.indexOf(el) !== -1) return;
    stack.push(el);
    if (!ready) return;
    history.pushState({ nav: navNow(), modal: keyOf(el) }, '', location.hash);
  }
  function onClose(el) {
    var i = stack.indexOf(el);
    if (i === -1) return;
    stack.splice(i, 1);
    var j = closingByBack.indexOf(el);
    if (j !== -1) { closingByBack.splice(j, 1); return; }      /* 뒤로가기로 닫은 것 — 기록은 이미 지나갔다 */
    if (!ready) return;
    var st = history.state;
    if (st && st.modal === keyOf(el)) { ignorePop++; history.back(); }
  }

  /* 창 닫기 — 그 창의 [취소] · [닫기] 단추를 누른 것처럼 (열려 있던 일이 끝까지 정리되게) */
  var CLOSE_BTN = '[id$="Cancel"], [id$="Close"], #btnConfirmNo, #btnConflictLater, [data-dn="later"], #btnThClose, #btnRvLiveClose, #pvClose';
  function closeEl(el) {
    closingByBack.push(el);
    /* 코멘트 창은 [취소](= 연 때 글로 되돌림)가 아니라 Esc 처럼 — 쓴 글을 지키고 닫는다 */
    if (el.id === 'commentModal') { el.close(); return; }
    /* 창 아래쪽 단추 줄의 [취소] · [닫기] 를 먼저 (창 안 다른 작은 [취소] 단추를 누르지 않게) */
    var b = el.querySelector('.modal__foot ' + CLOSE_BTN.split(', ').join(', .modal__foot ')) || el.querySelector(CLOSE_BTN);
    if (b) b.click();
    if (isOpen(el)) {
      if (el.id === 'pvOverlay' && window.Preview) Preview.close();
      else if (el.tagName === 'DIALOG') el.close();
      else el.hidden = true;
    }
  }

  function watch() {
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        var el = m.target;
        if (!(el.tagName === 'DIALOG' || OVERLAYS.indexOf(el.id) !== -1)) return;
        if (isOpen(el)) onOpen(el); else onClose(el);
      });
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  }

  window.addEventListener('popstate', function (e) {
    if (ignorePop > 0) { ignorePop--; return; }
    var top = stack[stack.length - 1];
    if (top) { closeEl(top); return; }
    if (!ready) return;
    apply((e.state && e.state.nav) || parse());
  });

  /* 탭 · 반 · 주차가 바뀌면 기록 */
  document.addEventListener('jt:tab', function () { setTimeout(push, 0); });
  window.addEventListener('jt:write-nav', function () { setTimeout(push, 0); });

  /* 로그인 뒤 — 주소에 적힌 탭 · 반 · 주차를 연다 (새로고침) */
  window.addEventListener('jt:loaded', function () {
    setTimeout(function () {
      var h = parse();
      ready = true;
      (h ? apply(h) : Promise.resolve()).then(replace);
    }, 0);
  });

  /* 저장 안 된 글이 있으면 떠나기 전에 묻는다 */
  window.addEventListener('beforeunload', function (e) {
    var unsaved = (window.Store && Store.hasUnsaved && Store.hasUnsaved()) || (window.Writer && Writer.pending && Writer.pending());
    if (!unsaved) return;
    if (window.Writer && Writer.flush) Writer.flush();
    e.preventDefault();
    e.returnValue = '저장 안 된 내용이 있습니다';
    return e.returnValue;
  });

  watch();

  window.Nav = { push: push, replace: replace, apply: apply, stack: function () { return stack.slice(); } };

})();
