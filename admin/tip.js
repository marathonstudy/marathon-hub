/* =========================================================================
   tip.js — 코치룸 설명 상자 (20261103a)
   - 카드 · 머리줄 안이 아니라 화면 맨 위층(body 바로 아래 position: fixed 한 장)에 띄운다
     → 어떤 줄 · 카드 테두리 · 화면 위에 붙어 따라오는 머리줄에도 가리지 않는다
   - 칸 위에 띄우되, 위쪽 자리가 모자라면(첫 줄 · 머리줄 바로 아래 · 화면 위 끝) 칸 아래쪽
   - 오른쪽 · 왼쪽 끝에서는 화면 안으로 당겨 맞춘다
   - 마우스: 올리면 뜨고 벗어나면 닫힘 · 키보드: 칸에 들어가면 뜸
   - 휴대폰(마우스 없음): 칸을 누르면 뜨고(누른 동작은 그대로) 바깥을 누르면 닫힘
   - 대상: [data-tip] 어디서나 · 「오늘」 화면(#panel-today) 안의 [title] (레포트 칩 · 수업 시각 줄 · 띠 버튼 …)
     title 은 처음 쓸 때 data-tip 으로 옮겨 브라우저 기본 설명과 두 번 뜨지 않게 한다
   ========================================================================= */
(function () {
  'use strict';
  var GAP = 6, EDGE = 8;
  var layer = null, anchor = null, touchy = false, viaTap = false;

  function el() {
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'tipLayer';
      layer.className = 'tip-layer';
      layer.setAttribute('role', 'tooltip');
      layer.hidden = true;
    }
    /* 창이 열려 있으면 맨 앞 창 안에 — body 에 두면 창(<dialog>) 뒤에 깔린다 (20261111b) */
    var host = (window.Layer && Layer.top()) || document.body;
    if (layer.parentNode !== host) host.appendChild(layer);
    return layer;
  }
  function scoped(t) {
    return t.closest && t.closest('#panel-today');
  }
  /* 설명이 있는 가장 가까운 칸 (title 은 「오늘」 화면 안만) */
  function target(node) {
    for (var t = node; t && t.nodeType === 1; t = t.parentElement) {
      if (t.id === 'tipLayer') return null;
      if (t.hasAttribute('data-tip') && t.getAttribute('data-tip')) return t;
      if (t.hasAttribute('title') && t.getAttribute('title') && scoped(t)) {
        t.setAttribute('data-tip', t.getAttribute('title'));
        t.removeAttribute('title');
        return t;
      }
    }
    return null;
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  /* 위쪽에서 가려지는 끝 — 화면 위 끝 · 위 탭 막대(--td-sticky) · 그 칸 위에 있는 카드 머리줄 */
  function topLimit(t) {
    var lim = EDGE;
    try { lim = Math.max(lim, num(getComputedStyle(document.documentElement).getPropertyValue('--td-sticky'))); } catch (x) {}
    var r = t.getBoundingClientRect();
    var cd = t.closest && t.closest('.tdc-card');
    if (cd) {
      var hs = cd.querySelectorAll('.tdc-togglebar, .tdc-sub__t');
      for (var i = 0; i < hs.length; i++) {
        if (hs[i].contains(t)) continue;
        var h = hs[i].getBoundingClientRect();
        if (h.height && h.bottom <= r.top + 1 && h.bottom > lim) lim = h.bottom;
      }
    }
    return lim;
  }
  function place(t) {
    var L = el();
    var r = t.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    L.style.maxWidth = Math.max(120, Math.min(320, vw - EDGE * 2)) + 'px';
    L.style.left = '0px'; L.style.top = '0px';
    var b = L.getBoundingClientRect();
    var w = b.width || L.offsetWidth || 0, h = b.height || L.offsetHeight || 0;
    var lim = topLimit(t);
    var top = r.top - GAP - h, side = 'top';
    if (top < lim) {                                  /* 위 자리가 모자라면 아래로 */
      var below = r.bottom + GAP;
      if (below + h <= vh - EDGE || r.top - lim < vh - EDGE - r.bottom) { top = below; side = 'bottom'; }
      else top = lim;
    }
    var left = r.left;
    if (left + w > vw - EDGE) left = vw - EDGE - w;   /* 오른쪽 끝 */
    if (left < EDGE) left = EDGE;                     /* 왼쪽 끝 */
    L.style.left = Math.round(left) + 'px';
    L.style.top = Math.round(top) + 'px';
    L.setAttribute('data-side', side);
  }
  function show(t, tap) {
    var L = el();
    if (anchor && anchor !== t) anchor.removeAttribute('aria-describedby');
    anchor = t; viaTap = !!tap;
    L.textContent = t.getAttribute('data-tip');
    L.hidden = false;
    t.setAttribute('aria-describedby', 'tipLayer');
    place(t);
  }
  function hide() {
    if (layer) layer.hidden = true;
    if (anchor) anchor.removeAttribute('aria-describedby');
    anchor = null; viaTap = false;
  }
  function noHover() {
    try { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); } catch (x) { return false; }
  }

  document.addEventListener('pointerdown', function (e) { touchy = e.pointerType ? e.pointerType !== 'mouse' : noHover(); }, true);
  document.addEventListener('touchstart', function () { touchy = true; }, { capture: true, passive: true });
  document.addEventListener('mouseover', function (e) {
    if (touchy || viaTap) return;
    var t = target(e.target);
    if (t) { if (t !== anchor) show(t); }
    else if (anchor) hide();
  });
  document.addEventListener('mouseout', function (e) {
    if (viaTap || !anchor) return;
    var to = e.relatedTarget;
    if (!to || !anchor.contains(to)) hide();
  });
  document.addEventListener('focusin', function (e) {
    if (touchy) return;
    var t = target(e.target);
    if (t) show(t); else if (anchor && !viaTap) hide();
  });
  document.addEventListener('focusout', function () { if (!viaTap) hide(); });
  /* 휴대폰 — 누르면 뜸 (누른 동작은 그대로 · 다시 그려져도 누른 자리에) · 바깥을 누르면 닫힘 */
  document.addEventListener('click', function (e) {
    if (!(touchy || noHover())) { if (anchor) hide(); return; }   /* 마우스로 누르면 설명은 닫고 동작만 */
    var t = target(e.target);
    if (!t) { if (anchor) hide(); return; }
    if (viaTap && anchor === t) { hide(); return; }
    show(t, true);
  }, true);
  window.addEventListener('scroll', function () { if (anchor) hide(); }, true);
  window.addEventListener('resize', function () { if (anchor) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && anchor) hide(); });

  window.Tip = { show: show, hide: hide, place: place, target: target, current: function () { return anchor; }, layer: el };
})();
