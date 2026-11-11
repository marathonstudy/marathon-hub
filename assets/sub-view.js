/* ============================================================
   sub-view.js — 학생 제출물 보기 (러닝노트 레포트 「✍️ 이번 주 풀이 흔적」 · 코치룸 학생 카드 · 반 카드 · 20261110j · migration-100 · 함수 sub-view)

   가볍게 — 화면에는 작은 미리보기(긴 변 600px 안팎)만 · 원본은 [원본 열기 ↗]을 눌렀을 때만 앱 주소로
     러닝노트는 그 칸이 화면에 들어올 때만 부른다(지연 불러오기 · 레포트 여는 속도 그대로) · 사진은 loading="lazy"
     크게 보기는 지금 장 하나만 그린다(앞뒤 장은 넘길 때)
   러닝노트 — 그 학생 링크로만 · 그 학생 것만(hub_sub_list) · 점수 · 순위 · AI 근거 없음
     「✍️ 이번 주 풀이 흔적」 — 대표 1~2장(정성 점수가 높은 것 · 없으면 최근 것) 크게 · 그 아래 날짜별 작은 칸 · 누르면 크게 보기
   코치룸 — SubView.openStaff({ student, from, to, title }) · SubView.openClass(반, 날짜) — 학생별로 넘겨 보기
     PDF 미리보기가 아직 없으면 그 장을 열 때 한 번 그려 올린다(king-pick AI 가 고른 쪽 · 없으면 잉크가 가장 많은 쪽 · pdf.js)
   사진이 안 열리면 「앱에서 열기」 안내만 (앱 로그인이 필요한 길은 쓰지 않는다)
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function md(d) { return d ? (+String(d).slice(5, 7)) + '/' + (+String(d).slice(8, 10)) : ''; }
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function mdw(d) { if (!d) return ''; var x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return md(d) + '(' + DOW[x.getUTCDay()] + ')'; }
  function okOpen(u) { return /^https:\/\/(www\.)?marathonstudy\.com\//.test(String(u || '')) ? String(u) : ''; }
  function okThumb(u) { return /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\//.test(String(u || '')) ? String(u) : ''; }
  var FAIL = '사진이 안 열려요 · 앱에서 열어 주세요';

  /* ---------- 러닝노트 — 함수 부르기 ---------- */
  function hubFetch(code, from, to) {
    var C = global.CONFIG && global.CONFIG.supabase;
    if (!C) return Promise.resolve(null);
    return fetch(C.url + '/functions/v1/sub-view', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key }, body: JSON.stringify({ action: 'hub', code: code, from: from, to: to }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.ok ? d : null; }, function () { return null; });
  }
  function thumbHtml(f, big) {
    var t = okThumb(f.thumb), o = okOpen(f.open);
    var label = esc(mdw(f.day) + (f.kind === 'pdf' ? ' · PDF' + (f.page ? ' ' + f.page + '쪽' : '') : ''));
    if (!t) return '<span class="sv-ph' + (big ? ' sv-ph--big' : '') + '">' + (f.kind === 'pdf' ? '📄 PDF' : '🖼️') + '<small>' + (f.wait ? '미리보기 준비 중' : '미리보기 없음') + '</small>' +
      (o ? '<a class="sv-app" href="' + esc(o) + '" target="_blank" rel="noopener">앱에서 열기 ↗</a>' : '') + '</span>';
    return '<img class="sv-img" src="' + esc(t) + '" alt="' + label + ' 제출물" loading="lazy" decoding="async" data-sv-fail="' + esc(o) + '"' + (f.w && f.h ? ' width="' + f.w + '" height="' + f.h + '"' : '') + '>';
  }
  /* 「✍️ 이번 주 풀이 흔적」 */
  function weekHtml(d, opt) {
    opt = opt || {};
    var files = (d && d.files) || [];
    if (!files.length) return '';
    var rep = (d.rep || []).map(function (id) { return files.find(function (f) { return f.id === id; }); }).filter(Boolean);
    if (!rep.length) rep = files.slice(-1);
    var days = {}, order = [];
    files.forEach(function (f, i) { var k = String(f.day || ''); if (!days[k]) { days[k] = []; order.push(k); } days[k].push(i); });
    return '<div class="card sv-week" id="svWeek"><h2 class="card-title">✍️ 이번 주 풀이 흔적' + (opt.note ? '<span class="card-note">' + esc(opt.note) + '</span>' : '') + '</h2>' +
      '<div class="sv-rep' + (rep.length > 1 ? ' sv-rep--two' : '') + '">' + rep.map(function (f) { var i = files.indexOf(f); return '<button type="button" class="sv-big" data-sv-i="' + i + '" aria-label="' + esc(mdw(f.day)) + ' 제출물 크게 보기">' + thumbHtml(f, true) + '<span class="sv-cap num">' + esc(mdw(f.day)) + '</span></button>'; }).join('') + '</div>' +
      '<div class="sv-days">' + order.map(function (k) {
        return '<div class="sv-day"><p class="sv-day__t num">' + esc(mdw(k)) + ' <small>' + days[k].length + '장</small></p><div class="sv-day__l">' +
          days[k].map(function (i) { return '<button type="button" class="sv-sm" data-sv-i="' + i + '" aria-label="' + esc(mdw(k) + ' ' + (i + 1)) + '번째 제출물 크게 보기">' + thumbHtml(files[i], false) + '</button>'; }).join('') + '</div></div>';
      }).join('') + '</div></div>';
  }

  /* ---------- 크게 보기 (러닝노트 · 코치룸 같이) — 지금 장 하나만 그림 · 탭하면 확대 · 휴대폰은 두 손가락 확대 ---------- */
  var LB = { list: [], i: 0, el: null, staff: null };
  function lbItem() { return LB.list[LB.i]; }
  function lbPaint() {
    var it = lbItem();
    if (!LB.el || !it) return;
    var f = it.f, t = okThumb(f.thumb), o = okOpen(f.open);
    LB.el.innerHTML = '<div class="sv-lb__top"><span class="sv-lb__t">' + esc((it.who ? it.who + ' · ' : '') + mdw(f.day) + (f.kind === 'pdf' ? ' · PDF' + (f.page ? ' ' + f.page + '쪽' : '') : '')) + '</span>' +
        '<span class="sv-lb__n num">' + (LB.i + 1) + ' / ' + LB.list.length + '</span><button type="button" class="sv-lb__x" data-sv-close aria-label="닫기">✕</button></div>' +
      '<div class="sv-lb__body" data-sv-zoom>' + (t ? '<img class="sv-lb__img" src="' + esc(t) + '" alt="' + esc(mdw(f.day)) + ' 제출물" data-sv-fail="' + esc(o) + '">'
        : '<p class="sv-lb__none">' + (f.kind === 'pdf' && LB.staff && LB.staff.pdf ? 'PDF 대표 쪽을 그리는 중…' : f.wait ? '미리보기 준비 중이에요' : FAIL) + '</p>') + '</div>' +
      '<div class="sv-lb__bar"><button type="button" class="btn btn--sm" data-sv-step="-1"' + (LB.i ? '' : ' disabled') + '>‹ 앞</button>' +
        (o ? '<a class="btn btn--sm sv-lb__open" href="' + esc(o) + '" target="_blank" rel="noopener">원본 열기 ↗</a>' : '') +
        '<button type="button" class="btn btn--sm" data-sv-step="1"' + (LB.i < LB.list.length - 1 ? '' : ' disabled') + '>뒤 ›</button></div>';
    if (!t && f.kind === 'pdf' && LB.staff && LB.staff.pdf) LB.staff.pdf(f).then(function (url) { if (url && lbItem() && lbItem().f === f) { f.thumb = url; lbPaint(); } else if (lbItem() && lbItem().f === f) { f.wait = false; lbPaint(); } });
  }
  function lbOpen(list, i, staff) {
    LB.list = list; LB.i = Math.max(0, Math.min(list.length - 1, i || 0)); LB.staff = staff || null;
    /* 맨 앞 층 (20261111a) — 학생 카드 창 · 학습 분석 창이 <dialog> 라 body 의 div 는 그 뒤에 깔린다 → 이것도 <dialog>(나중에 연 것이 맨 앞) */
    /* 20261111b — 공통 Layer 로 (Esc · 바깥은 이 창만 · 닫으면 아래 창 스크롤 그대로) */
    if (!LB.el) {
      LB.el = Layer.make('sv-lb', '', '제출물 크게 보기');
      LB.el.addEventListener('close', function () { if (!LB.el.open) { LB.el.innerHTML = ''; LB.list = []; } });
    }
    LB.el.hidden = false;
    Layer.show(LB.el, { full: true });
    lbPaint();
  }
  function lbClose() {
    if (LB.el) { Layer.hide(LB.el); LB.el.hidden = true; LB.el.innerHTML = ''; }
    LB.list = [];
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (LB.el && !LB.el.hidden && LB.el.contains(t)) {
      if (t.closest('[data-sv-close]')) { lbClose(); return; }
      var st = t.closest('[data-sv-step]');
      if (st && !st.disabled) { LB.i += +st.getAttribute('data-sv-step'); lbPaint(); return; }
      var z = t.closest('.sv-lb__img');
      if (z) { z.classList.toggle('is-zoom'); return; }
      return;
    }
    var b = t.closest('[data-sv-i]');
    if (b) { var host = b.closest('[data-sv-host]'); if (host && host._sv) lbOpen(host._sv.files.map(function (f) { return { f: f }; }), +b.getAttribute('data-sv-i')); return; }
    var c = t.closest('[data-sub-cls]');
    if (c) { openClass(c.getAttribute('data-sub-cls'), c.getAttribute('data-sub-day') || ''); }
  });
  document.addEventListener('keydown', function (e) {
    if (!LB.el || !Layer.isTop(LB.el)) return;                          /* Esc 는 Layer 가 이 창만 닫는다 */
    if (e.key === 'ArrowRight' && LB.i < LB.list.length - 1) { LB.i++; lbPaint(); }
    else if (e.key === 'ArrowLeft' && LB.i > 0) { LB.i--; lbPaint(); }
  });
  /* 사진이 안 열리면 — 「앱에서 열기」 안내만 */
  document.addEventListener('error', function (e) {
    var im = e.target;
    if (!im || im.tagName !== 'IMG' || !im.hasAttribute('data-sv-fail')) return;
    var o = okOpen(im.getAttribute('data-sv-fail'));
    var s = document.createElement('span');
    s.className = 'sv-ph sv-ph--fail';
    s.innerHTML = esc(FAIL) + (o ? ' <a class="sv-app" href="' + esc(o) + '" target="_blank" rel="noopener">앱에서 열기 ↗</a>' : '');
    im.replaceWith(s);
  }, true);

  /* ---------- 러닝노트 — 그 칸이 화면에 들어올 때만 ---------- */
  function mountHub(host, code, from, to, opt) {
    if (!host || !code || !from || !to) return;
    host.setAttribute('data-sv-host', '');
    var done = false;
    function go() {
      if (done) return; done = true;
      hubFetch(code, from, to).then(function (d) {
        if (!d || !host.isConnected) return;
        host._sv = d;
        host.innerHTML = weekHtml(d, opt);
      });
    }
    if (global.IntersectionObserver) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); go(); } }, { rootMargin: '200px 0px' });
      io.observe(host);
    } else setTimeout(go, 1500);         /* 지켜보는 기능이 없으면 레포트가 다 열린 뒤에 */
  }

  /* ---------- 코치룸 ---------- */
  function sb() { return global.SB && global.SB.client; }
  function invoke(body) {
    var c = sb();
    if (!c || !c.functions) return Promise.resolve(null);
    return c.functions.invoke('sub-view', { body: body }).then(function (r) { return r && r.data ? r.data : null; }, function () { return null; });
  }
  function toast(m, k) { if (global.UI && global.UI.toast) global.UI.toast(m, k); }
  /* PDF 대표 쪽 그리기 — pdf.js(cdnjs) · AI 가 고른 쪽 · 없으면 잉크가 가장 많은 쪽(12쪽까지 작게 그려 어두운 점을 셈) · 긴 변 600px JPEG 를 올린다 */
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  function pdfLib() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = PDFJS; s.onload = function () { if (global.pdfjsLib) { global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS.replace('pdf.min.js', 'pdf.worker.min.js'); res(global.pdfjsLib); } else rej(); }; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function inkOf(canvas) {
    var ctx = canvas.getContext('2d'), d = ctx.getImageData(0, 0, canvas.width, canvas.height).data, n = 0;
    for (var i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 360) n++;
    return n / (d.length / 16);
  }
  function renderPage(doc, no, long) {
    return doc.getPage(no).then(function (p) {
      var v1 = p.getViewport({ scale: 1 }), k = long / Math.max(v1.width, v1.height), v = p.getViewport({ scale: k });
      var c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return p.render({ canvasContext: ctx, viewport: v }).promise.then(function () { return c; });
    });
  }
  function pickInk(doc) {
    var n = Math.min(doc.numPages, 12), best = 1, bestInk = -1, i = 1;
    function next() {
      if (i > n) return Promise.resolve(best);
      var k = i++;
      return renderPage(doc, k, 160).then(function (c) { var ink = inkOf(c); if (ink > bestInk) { bestInk = ink; best = k; } return next(); });
    }
    return next();
  }
  function staffPdf(f) {
    var c = sb();
    if (!c || !c.functions) return Promise.resolve('');
    return Promise.all([pdfLib(), c.functions.invoke('sub-view', { body: { action: 'pdf', id: f.id } })]).then(function (a) {
      var lib = a[0], blob = a[1] && a[1].data;
      if (!blob || typeof blob.arrayBuffer !== 'function') return '';
      return blob.arrayBuffer().then(function (buf) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }).then(function (doc) {
        var byAi = f.page && f.page >= 1 && f.page <= doc.numPages;
        return (byAi ? Promise.resolve(f.page) : pickInk(doc)).then(function (no) {
          return renderPage(doc, no, 600).then(function (cv) {
            var url = cv.toDataURL('image/jpeg', 0.72);
            return invoke({ action: 'put', id: f.id, jpeg: url, w: cv.width, h: cv.height, page: no, by: byAi ? 'ai' : 'ink' }).then(function (r) { f.page = no; return r && r.ok ? url : ''; });
          });
        });
      });
    }).catch(function () { return ''; });
  }
  var STAFF = { pdf: staffPdf };
  function openStaff(o) {
    o = o || {};
    return invoke({ action: 'staff', student: o.student, from: o.from, to: o.to || o.from }).then(function (d) {
      var files = (d && d.files) || [];
      if (!files.length) { toast((o.title ? o.title + ' — ' : '') + '제출물이 없어요 (앱에 낸 사진 · PDF)', ''); return; }
      lbOpen(files.map(function (f) { return { f: f, who: o.who || '' }; }), 0, STAFF);
    });
  }
  function today() { return global.DDay && global.DDay.today ? global.DDay.today() : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function openClass(cls, day) {
    day = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : today();
    return invoke({ action: 'class', class: cls, day: day }).then(function (d) {
      var list = [];
      ((d && d.students) || []).forEach(function (s) { (s.files || []).forEach(function (f) { list.push({ f: f, who: s.name }); }); });
      if (!list.length) { toast(cls + ' — ' + md(day) + ' 낸 제출물이 아직 없어요', ''); return; }
      lbOpen(list, 0, STAFF);
    });
  }
  function classBtnHtml(cls) { return '<button type="button" class="btn btn--sm sv-cls" data-sub-cls="' + esc(cls) + '">오늘 제출물 보기</button>'; }

  global.SubView = { weekHtml: weekHtml, mountHub: mountHub, openStaff: openStaff, openClass: openClass, classBtnHtml: classBtnHtml, lbOpen: lbOpen, lbClose: lbClose,
                     _inkOf: inkOf, _state: function () { return LB; } };
})(window);
