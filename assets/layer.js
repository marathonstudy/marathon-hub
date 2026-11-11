/* ============================================================
   layer.js — 창 띄우기 공통 (20261111b) · 코치룸 · 러닝노트 · 공지 · 첫 화면 모두
   왜 — 코치룸 학생 카드 같은 창은 <dialog>(브라우저 맨 위 층)라서, body 에 붙인 div 겹창(미리보기 · 사진 보기 …)은
        z-index 가 아무리 커도 그 뒤에 깔린다. 그래서 모든 창은 이 함수로만 띄운다.
   Layer.show(dialog, opts)  — body 바로 아래 <dialog> 를 showModal (나중에 연 것이 늘 맨 앞)
                               · 열린 동안 뒤 화면 스크롤 막음 · 닫으면 아래 창들의 스크롤 위치를 그대로 되돌림
                               · Esc · 바깥 누르기는 맨 앞 창만 닫는다 (아래 창은 그대로)
       opts.full     true — 화면 전체 겹창(미리보기 · 사진 보기 …) — 창 자체가 화면을 덮고, 어두운 바깥(창 자체)을 누르면 닫힘
       opts.outside  false — 바깥을 눌러도 닫지 않음 (고르기 · 확인 창처럼 답을 기다리는 창은 data-ly-keep 도 같음)
                     보통 창은 안에 무엇을 쓰기 시작했으면(input · change) 바깥을 눌러도 닫지 않는다 (Esc · 닫기 버튼은 그대로)
       opts.onClose  닫힌 뒤 한 번 · opts.remove true 면 닫을 때 지움
   Layer.hide(dialog) · Layer.top() · Layer.isTop(dialog) · Layer.count()
   Esc — 맨 앞 창에 cancel 을 보내고(그 창이 막으면 그대로) 닫는다 · 아래 창(학생 카드)까지 닫히지 않게 브라우저 기본 동작은 막는다
   ============================================================ */
(function (W) {
  'use strict';
  if (!W || !W.document || W.Layer) return;
  var D = W.document;
  var STACK = [];                       /* [{ el, opts, spots, dirty }] — 아래에서 위로 */
  var CSS =
    'html.ly-lock, html.ly-lock body { overflow: hidden !important; }' +
    ':where(dialog.ly-full) { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; box-sizing: border-box; background: transparent; color: inherit; overflow: auto; overscroll-behavior: contain; }' +
    'dialog.ly-full:not([open]) { display: none !important; }' +
    'dialog.ly-full::backdrop { background: transparent; }';

  function style() {
    if (D.getElementById('lyStyle')) return;
    var s = D.createElement('style');
    s.id = 'lyStyle';
    s.textContent = CSS;
    (D.head || D.documentElement).appendChild(s);
  }
  function isOpen(el) { return !!el && (el.open === true || el.hasAttribute('open')); }
  function idx(el) { for (var i = STACK.length - 1; i >= 0; i--) if (STACK[i].el === el) return i; return -1; }
  function top() { return STACK.length ? STACK[STACK.length - 1].el : null; }

  /* 지금 스크롤 위치 — 문서 · 열려 있는 창(그 안의 칸까지) · 새로 여는 창은 빼고 */
  function spots(skip) {
    var out = [], se = D.scrollingElement || D.documentElement;
    out.push({ el: se, top: se.scrollTop, left: se.scrollLeft });
    Array.prototype.forEach.call(D.querySelectorAll('dialog[open]'), function (dl) {
      if (dl === skip) return;
      [dl].concat(Array.prototype.slice.call(dl.querySelectorAll('*'))).forEach(function (x) {
        if (x.scrollTop > 0 || x.scrollLeft > 0) out.push({ el: x, id: x.id, top: x.scrollTop, left: x.scrollLeft });
      });
    });
    return out;
  }
  function restore(list) {
    (list || []).forEach(function (s) {
      var el = s.el && s.el.isConnected ? s.el : (s.id ? D.getElementById(s.id) : null);   /* 아래 창을 다시 그렸으면 같은 id 로 */
      if (!el) return;
      if (el.scrollTop !== s.top) el.scrollTop = s.top;
      if (el.scrollLeft !== s.left) el.scrollLeft = s.left;
    });
  }
  function lock() { D.documentElement.classList.add('ly-lock'); }
  function unlock() { if (!STACK.length) D.documentElement.classList.remove('ly-lock'); }

  /* 닫힌 뒤 — 쌓인 줄에서 빼고 스크롤 되돌림 (브라우저 close 이벤트 · hide 둘 다 여기로 · 한 번만) */
  function done(el) {
    if (isOpen(el)) return;
    var i = idx(el);
    if (i < 0) return;
    var it = STACK.splice(i, 1)[0];
    unlock();
    if (it.opts.full) el.hidden = true;                                  /* 화면 전체 겹창 — 예전처럼 hidden 도 (뒤로가기 · 다른 코드가 hidden 으로 본다) */
    restore(it.spots);
    if (it.opts.remove && el.parentNode) el.parentNode.removeChild(el);
    if (typeof it.opts.onClose === 'function') { try { it.opts.onClose(); } catch (e) { if (W.console) console.error(e); } }
  }

  function wire(el) {
    if (el._lyWired) return;
    el._lyWired = true;
    el.addEventListener('close', function () { done(el); });
    /* 브라우저가 Esc 로 보내는 cancel — 맨 앞 창이 아니면 막는다 */
    el.addEventListener('cancel', function (e) { if (top() !== el) e.preventDefault(); });
    /* 안에서 누르고 바깥에서 뗀 것(글 고르기 · 끌기)은 바깥 누르기가 아님 */
    el.addEventListener('mousedown', function (e) { el._lyDown = e.target === el; });
    el.addEventListener('click', function (e) {
      if (e.target !== el || top() !== el) return;
      if (el._lyDown === false) { el._lyDown = null; return; }
      el._lyDown = null;
      var i = idx(el), it = STACK[i];
      if (!it || it.opts.outside === false || el.hasAttribute('data-ly-keep')) return;
      if (!it.opts.full) {
        /* 보통 창 — 창 테두리 밖(어두운 곳)을 누를 때만 · 쓰기 시작한 창은 그대로 */
        var r = el.getBoundingClientRect();
        if ((r.width || r.height) && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
        if (it.dirty) return;
      }
      hide(el);
    });
    var mark = function () { var it = STACK[idx(el)]; if (it) it.dirty = true; };
    el.addEventListener('input', mark, true);
    el.addEventListener('change', mark, true);
  }

  function show(el, opts) {
    if (!el) return el;
    style();
    opts = opts || {};
    wire(el);
    if (opts.full) el.classList.add('ly-full');
    var i = idx(el);
    if (i >= 0 && i === STACK.length - 1 && isOpen(el)) { STACK[i].opts = opts; return el; }   /* 이미 맨 앞 */
    var keep = i >= 0 ? STACK[i].spots : null;
    if (i >= 0) STACK.splice(i, 1);                                     /* 아래에 열려 있던 창을 다시 맨 앞으로 */
    if (isOpen(el)) { try { el.close(); } catch (e) { /* 그대로 */ } el.removeAttribute('open'); }
    /* body 바로 아래로 — 닫힌 창 · 숨긴 칸 안에 있으면 보이지 않는다 */
    if (el.parentNode !== D.body) D.body.appendChild(el);
    STACK.push({ el: el, opts: opts, spots: keep || spots(el), dirty: false });
    lock();
    try { if (typeof el.showModal === 'function') el.showModal(); else el.setAttribute('open', ''); }
    catch (e) { el.setAttribute('open', ''); }
    if (el.hidden) el.hidden = false;
    return el;
  }

  function hide(el) {
    if (!el) return;
    if (isOpen(el)) {
      try { if (typeof el.close === 'function') el.close(); } catch (e) { /* 이미 닫힘 */ }
      el.removeAttribute('open');
    }
    done(el);
  }

  /* Esc — 맨 앞 창만 (그 창이 cancel 을 막으면 그대로 · 안에서 먼저 처리한 Esc(칸 편집 취소 등)는 건드리지 않음)
     window 에 단다 — document 의 다른 Esc 처리가 모두 끝난 뒤에 */
  W.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var el = top();
    if (!el || e.defaultPrevented || e.isComposing) return;
    e.preventDefault();                                                  /* 브라우저가 아래 창까지 닫지 않게 */
    var ev;
    try { ev = new W.Event('cancel', { cancelable: true }); } catch (x) { ev = D.createEvent('Event'); ev.initEvent('cancel', false, true); }
    if (el.dispatchEvent(ev)) hide(el);
  });

  style();                              /* 처음부터 — 닫힌 겹창(<dialog class="ly-full">)이 보이지 않게 */

  W.Layer = {
    show: show,
    hide: hide,
    top: top,
    isTop: function (el) { return !!el && top() === el; },
    count: function () { return STACK.length; },
    /* 새 겹창 만들기 — <dialog class="..."> (화면 전체) · 아직 띄우지 않음 */
    make: function (cls, id, label) {
      var d = D.createElement('dialog');
      d.className = (cls ? cls + ' ' : '') + 'ly-full';
      if (id) d.id = id;
      if (label) d.setAttribute('aria-label', label);
      d.hidden = true;                                                   /* 띄우기 전 · 닫힌 뒤는 hidden (show 가 푼다) */
      return d;
    }
  };
})(typeof window !== 'undefined' ? window : null);
