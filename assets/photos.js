/* ============================================================
   photos.js — 러닝노트(/me/) 「내 필기」 (예전 「필기 노트」 · 20261029i)

   학생이 수업 시간에 직접 쓴 필기를 사진으로 모아 두는 곳이다 (선생님 자료가 아니다).
   · 올리기: 휴대폰 카메라로 찍거나 앨범에서 여러 장 고르기.
     올리기 전에 이 화면에서 긴 변 1600px · JPEG · 장당 0.3MB 안팎으로 줄이고,
     목록에 쓸 작은 그림(긴 변 480px 안팎)도 같이 만들어 보낸다 (note-photo 함수가 「…_s.jpg」로 둔다).
     수업 날짜는 기본 오늘, 지난 날짜로 바꿀 수 있다.
   · 보기: 날짜별 앨범. 학생 본인은 언제든 지울 수 있다(파일까지). 학부모 링크는 보기만.
   · 레포트: 그 수업일에 올라온 필기를 「오늘 수업 필기」 칸으로 (lessonCard — 첫 장 크게 · 나머지 2열 · 4장 넘으면 펼치기)
   · 크게 보기: 화면 가득 · 손가락으로 넘기기 · 두 손가락으로 확대 · 두 번 눌러 확대 (gallery).
     목록에는 작은 그림, 크게 볼 때 원본을 불러온다.

   서버는 Edge Function(note-photo) 하나만 부른다. 개인 링크 코드로 그 학생인지 확인하고,
   사진 주소는 10분만 유효한 서명 주소다. 보관함 경로 · 다른 학생 사진은 오지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var MAX_SIDE = 1600;
  var TARGET = 300 * 1024;          /* 목표 0.3MB */
  var HARD = 590 * 1024;            /* 서버 상한 600KB 아래 */
  var THUMB = { maxSide: 480, target: 40 * 1024 };    /* 목록에 쓸 작은 그림 */
  var SHOW = 4;                     /* 레포트 칸 — 처음에 보이는 장수 (첫 장 크게 + 3장) */

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function endpoint() { return CFG.supabase.url + '/functions/v1/' + (CFG.photoFunction || 'note-photo'); }
  function today() { return global.DDay ? DDay.today() : new Date().toISOString().slice(0, 10); }
  function dayLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[2]) + '월 ' + (+m[3]) + '일' : '';
  }
  /* 「10/22(목)」 */
  function mdDow(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return (+m[2]) + '/' + (+m[3]) + '(' + ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ')';
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /* 이번 주 월요일 ~ 일요일 (한국 날짜) */
  function thisWeek() {
    var t = today();
    var dow = new Date(t + 'T00:00:00Z').getUTCDay();
    var mon = addDays(t, -((dow + 6) % 7));
    return { from: mon, to: addDays(mon, 6) };
  }

  function call(body) {
    if (global.HUB_PREVIEW) return global.HUB_PREVIEW.photo(body);
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http' + r.status }; }); });
  }

  function list(code, from, to) { return call({ action: 'list', code: code, from: from || null, to: to || null }); }

  /* ---------- 사진 줄이기 ---------- */

  function loadBitmap(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return loadImg(file); });
    }
    return loadImg(file);
  }
  function loadImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진을 열 수 없습니다.')); };
      img.src = url;
    });
  }
  function toBlob(canvas, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); });
  }

  /* 긴 변 1600px, JPEG, 0.3MB 가 될 때까지 화질을 낮추고 그래도 크면 크기를 줄인다.
     opts 로 바꿀 수 있다 — 복습테스트 시험지는 { maxSide: 1280, target: 150KB } (review-card.js) · 작은 그림은 THUMB */
  function shrink(file, opts) {
    opts = opts || {};
    var MAXS = opts.maxSide || MAX_SIDE, TGT = opts.target || TARGET;
    return loadBitmap(file).then(function (img) {
      var w0 = img.width, h0 = img.height;
      if (!w0 || !h0) throw new Error('사진을 열 수 없습니다.');
      var side = Math.min(MAXS, Math.max(w0, h0));
      function attempt(maxSide, q) {
        var scale = Math.min(1, maxSide / Math.max(w0, h0));
        var w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return toBlob(c, q).then(function (b) {
          if (!b) throw new Error('사진을 줄이지 못했습니다.');
          if (b.size <= TGT || (q <= 0.5 && b.size <= HARD)) return { blob: b, width: w, height: h };
          if (q > 0.5) return attempt(maxSide, Math.round((q - 0.08) * 100) / 100);
          if (maxSide > 700) return attempt(Math.round(maxSide * 0.82), 0.72);
          if (b.size <= HARD) return { blob: b, width: w, height: h };
          throw new Error('사진이 너무 큽니다.');
        });
      }
      return attempt(side, 0.82);
    });
  }

  function uploadOne(code, lessonDate, file) {
    if (global.HUB_PREVIEW) return Promise.resolve({ ok: false, message: global.HUB_PREVIEW.blockMsg });
    return global.Photos.shrink(file).then(function (s) {
      /* 작은 그림 — 못 만들어도 원본은 올린다 */
      return global.Photos.shrink(file, THUMB).then(function (t) { return { s: s, t: t }; }, function () { return { s: s, t: null }; });
    }).then(function (x) {
      var fd = new FormData();
      fd.append('code', code);
      fd.append('lesson_date', lessonDate);
      fd.append('width', String(x.s.width));
      fd.append('height', String(x.s.height));
      fd.append('file', x.s.blob, 'note.jpg');
      if (x.t && x.t.blob && x.t.blob.size <= 120 * 1024) fd.append('thumb', x.t.blob, 'note_s.jpg');
      return fetch(endpoint(), { method: 'POST', headers: { 'apikey': CFG.supabase.key }, body: fd })
        .then(function (r) { return r.json().catch(function () { return { ok: false, message: '올리지 못했습니다.' }; }); });
    });
  }

  /* ============================================================
     크게 보기 — 화면 가득 · 손가락으로 넘기기 · 두 손가락 확대 · 두 번 눌러 확대
     items [{ url(원본), thumb(작은 그림) }] — 작은 그림을 먼저 띄우고 원본이 오면 바꾼다.
     .ph-light 이름은 그대로 (hub.js 가 뒤로가기 = 닫기로 쓴다)
     ============================================================ */
  var GAL = { n: 0, sets: {} };
  function register(items) { var id = 'g' + (++GAL.n); GAL.sets[id] = items; return id; }

  function gallery(items, start) {
    items = (items || []).filter(function (p) { return p && (p.url || p.thumb); });
    if (!items.length) return;
    var i = Math.max(0, Math.min(items.length - 1, start || 0));
    var box = document.createElement('div');
    box.className = 'ph-light ph-gal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '필기 크게 보기');
    box.innerHTML =
      '<div class="ph-gal__stage"><img class="ph-gal__img" alt="필기 사진" draggable="false"></div>' +
      (items.length > 1
        ? '<button type="button" class="ph-gal__nav ph-gal__prev" aria-label="이전 사진">‹</button>' +
          '<button type="button" class="ph-gal__nav ph-gal__next" aria-label="다음 사진">›</button>' +
          '<div class="ph-gal__count num" aria-live="polite"></div>'
        : '') +
      '<button type="button" class="ph-light__close" aria-label="닫기">×</button>';
    var img = box.querySelector('.ph-gal__img');
    var z = { s: 1, x: 0, y: 0 };
    function apply() { img.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')'; }
    function reset() { z.s = 1; z.x = 0; z.y = 0; apply(); }
    function show(k) {
      i = (k + items.length) % items.length;
      var p = items[i];
      reset();
      img.src = p.thumb || p.url;
      if (p.url && p.url !== p.thumb) {
        var full = new Image();
        full.onload = function () { if (items[i] === p) img.src = p.url; };
        full.src = p.url;
      }
      var c = box.querySelector('.ph-gal__count');
      if (c) c.textContent = (i + 1) + ' / ' + items.length;
    }
    function close() { box.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) {
      if (!document.body.contains(box)) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && items.length > 1) show(i + 1);
      else if (e.key === 'ArrowLeft' && items.length > 1) show(i - 1);
    }
    box.addEventListener('click', function (e) {
      if (e.target.closest('.ph-gal__next')) { show(i + 1); return; }
      if (e.target.closest('.ph-gal__prev')) { show(i - 1); return; }
      if (e.target.closest('.ph-light__close')) { close(); return; }
      if (e.target === img) return;
      close();
    });
    /* 두 번 눌러(두 번 클릭) 확대 · 원래대로 */
    var lastTap = 0;
    function toggleZoom() { if (z.s > 1) reset(); else { z.s = 2.2; apply(); } }
    img.addEventListener('dblclick', function (e) { e.preventDefault(); toggleZoom(); });
    /* 손가락 — 한 손가락: 확대 안 했으면 넘기기, 확대했으면 옮기기 · 두 손가락: 확대 */
    var t0 = null;
    function dist(t) { var a = t[0], b = t[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    box.addEventListener('touchstart', function (e) {
      var t = e.touches || [];
      if (t.length === 2) t0 = { pinch: dist(t), s: z.s };
      else if (t.length === 1) {
        t0 = { x: t[0].clientX, y: t[0].clientY, ox: z.x, oy: z.y, at: Date.now() };
        if (e.target === img && Date.now() - lastTap < 300) { toggleZoom(); t0 = null; lastTap = 0; return; }
        if (e.target === img) lastTap = Date.now();
      }
    }, { passive: true });
    box.addEventListener('touchmove', function (e) {
      if (!t0) return;
      var t = e.touches || [];
      if (t.length === 2 && t0.pinch) {
        z.s = Math.max(1, Math.min(4, t0.s * dist(t) / t0.pinch));
        if (z.s === 1) { z.x = 0; z.y = 0; }
        apply(); e.preventDefault();
      } else if (t.length === 1 && t0.x != null && z.s > 1) {
        z.x = t0.ox + (t[0].clientX - t0.x); z.y = t0.oy + (t[0].clientY - t0.y);
        apply(); e.preventDefault();
      }
    }, { passive: false });
    box.addEventListener('touchend', function (e) {
      if (!t0) return;
      if (t0.x != null && z.s === 1 && items.length > 1 && e.changedTouches && e.changedTouches.length) {
        var dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) show(dx < 0 ? i + 1 : i - 1);
      }
      if (!(e.touches && e.touches.length)) t0 = null;
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    show(i);
  }

  /* 예전 이름 — 한 장만 크게 */
  function lightbox(url) { gallery([{ url: url, thumb: url }], 0); }

  /* 목록 그림을 누르면 크게 (그 묶음 안에서 넘긴다) */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-gal]');
    if (!t) return;
    var set = GAL.sets[t.getAttribute('data-gal')];
    if (set) gallery(set, +t.getAttribute('data-i') || 0);
  });

  function groupByDate(photos) {
    var groups = [], idx = {};
    photos.forEach(function (p) {
      if (!(p.lesson_date in idx)) { idx[p.lesson_date] = groups.length; groups.push({ date: p.lesson_date, items: [] }); }
      groups[idx[p.lesson_date]].items.push(p);
    });
    return groups;
  }

  function imgTag(p, alt, cls) {
    var wh = p.width && p.height ? ' width="' + (+p.width) + '" height="' + (+p.height) + '"' : '';
    return '<img class="' + (cls || '') + '" loading="lazy" decoding="async" alt="' + esc(alt) + '" src="' + esc(p.thumb || p.url) + '"' + wh + '>';
  }

  function gridHtml(items, canDelete) {
    var g = register(items);
    return '<div class="ph-grid">' + items.map(function (p, i) {
      return '<div class="ph-cell"><button type="button" class="ph-thumb" data-gal="' + g + '" data-i="' + i + '">' + imgTag(p, '필기 사진 ' + (i + 1)) + '</button>' +
             (canDelete ? '<button type="button" class="ph-del" data-del="' + esc(p.id) + '">지우기</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function dayCard(g, canDelete) {
    return '<div class="card ph-day" id="ph-day-' + esc(g.date) + '" data-ph-day="' + esc(g.date) + '"><h2 class="card-title">' + esc(mdDow(g.date)) + ' 수업 필기' +
           '<span class="card-note">' + g.items.length + '장</span></h2>' + gridHtml(g.items, canDelete) + '</div>';
  }

  /* 「내 필기에서 전체 보기」로 들어오면 그 날짜 칸으로 */
  function focusDay(host, date) {
    if (!date) return;
    var el = host.querySelector('[data-ph-day="' + date + '"]');
    if (!el) return;
    el.classList.add('is-focus');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    setTimeout(function () { el.classList.remove('is-focus'); }, 2400);
  }

  /* ============================================================
     레포트 「오늘 수업 필기」 — 그 수업일에 올라온 그 학생 필기 (없으면 칸을 숨긴다)
       첫 장은 화면 너비에 가깝게 크게, 나머지는 큼직한 2열. 4장이 넘으면 「+n장 더 보기」.
       맨 아래 「내 필기에서 전체 보기 ›」 → 「내 필기」 탭의 그 날짜 (hub.js 가 data-photo-go 를 받는다)
     ============================================================ */
  function lessonCardHtml(photos, date) {
    var items = photos.slice();
    if (!items.length) return '';
    var g = register(items);
    var rest = items.slice(1);
    var hidden = Math.max(0, items.length - SHOW);
    return '<div class="card ph-lesson">' +
      '<h2 class="card-title">📝 오늘 수업 필기<span class="card-note num">' + esc(mdDow(date)) + ' · 필기 ' + items.length + '장</span></h2>' +
      '<button type="button" class="ph-paper ph-paper--big" data-gal="' + g + '" data-i="0" aria-label="' + esc(mdDow(date)) + ' 필기 1 크게 보기">' + imgTag(items[0], mdDow(date) + ' 수업 필기 1') + '</button>' +
      (rest.length ? '<div class="ph-two">' + rest.map(function (p, k) {
        var i = k + 1;
        return '<button type="button" class="ph-paper' + (i >= SHOW ? ' is-more' : '') + '"' + (i >= SHOW ? ' hidden' : '') +
               ' data-gal="' + g + '" data-i="' + i + '" aria-label="' + esc(mdDow(date)) + ' 필기 ' + (i + 1) + ' 크게 보기">' + imgTag(p, mdDow(date) + ' 수업 필기 ' + (i + 1)) + '</button>';
      }).join('') + '</div>' : '') +
      (hidden ? '<button type="button" class="ph-more" data-ph-more>+' + hidden + '장 더 보기</button>' : '') +
      '<button type="button" class="ph-all" data-photo-go="' + esc(date) + '">내 필기에서 전체 보기 ›</button>' +
    '</div>';
  }
  function lessonCard(host, code, date) {
    if (!host || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { if (host) host.innerHTML = ''; return Promise.resolve(0); }
    return list(code, date, date).then(function (res) {
      var ps = res && res.ok ? (res.photos || []).filter(function (p) { return p.lesson_date === date; }) : [];
      host.innerHTML = lessonCardHtml(ps, date);
      return ps.length;
    }).catch(function () { host.innerHTML = ''; return 0; });
  }
  document.addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('[data-ph-more]');
    if (!m) return;
    var card = m.closest('.ph-lesson');
    Array.prototype.forEach.call(card.querySelectorAll('.ph-paper.is-more'), function (b) { b.hidden = false; });
    m.remove();
  });

  /* ---------- 예전 묶음 카드 (주 단위) — 다른 화면이 부르면 그대로 ---------- */

  function weekCard(host, code, from, to) {
    if (!host) return Promise.resolve();
    return list(code, from, to).then(function (res) {
      if (!res || !res.ok || !(res.photos || []).length) { host.innerHTML = ''; return; }
      host.innerHTML = groupByDate(res.photos).map(function (g) {
        return '<div class="card ph-card"><h2 class="card-title">📝 ' + esc(mdDow(g.date)) + ' 수업 필기' +
               '<span class="card-note">' + g.items.length + '장</span></h2>' + gridHtml(g.items, false) + '</div>';
      }).join('');
    }).catch(function () { host.innerHTML = ''; });
  }

  /* ============================================================
     「내 필기」 탭 — 수업 시간에 쓴 내 필기
       opts.readOnly — 학부모 링크: 보기만 (올리기 · 지우기 없음) · opts.focus — 처음에 보여 줄 날짜
     ============================================================ */
  var TAB_HEAD = '<h2 class="ph-title">수업 시간에 쓴 내 필기</h2>';
  var EMPTY = '아직 올라온 필기가 없습니다';

  function renderTab(host, code, opts) {
    opts = opts || {};
    if (opts.readOnly) return renderView(host, code, opts);
    host.innerHTML = TAB_HEAD +
      '<div class="card ph-up">' +
        '<h2 class="card-title">📷 오늘 필기 올리기<span class="card-note" id="phToday"></span></h2>' +
        '<p class="ph-stat" id="phStat">불러오는 중…</p>' +
        '<p class="ph-guide">수업 시간에 내가 직접 쓴 필기만 찍어 주세요. 얼굴이나 친구가 나오지 않게 해 주세요.</p>' +
        '<label class="ph-date">수업 날짜 <input type="date" id="phDate" value="' + today() + '" max="' + today() + '"></label>' +
        '<div class="ph-buttons">' +
          '<label class="hub-btn ph-btn">📷 카메라로 찍기<input type="file" accept="image/*" capture="environment" id="phCam" hidden></label>' +
          '<label class="hub-btn ph-btn ph-btn--ghost">🖼️ 앨범에서 고르기<input type="file" accept="image/*" multiple id="phPick" hidden></label>' +
        '</div>' +
        '<p class="ph-msg" id="phMsg" role="status"></p>' +
      '</div>' +
      '<div id="phAlbum"></div>';

    var focus = opts.focus || '';
    function refresh() {
      return list(code).then(function (res) {
        if (!res || !res.ok) {
          $('#phStat', host).textContent = res && res.reason === 'closed' ? '더 이상 쓸 수 없는 링크입니다.' : '내 필기를 불러오지 못했습니다.';
          $('#phAlbum', host).innerHTML = '';
          return;
        }
        $('#phStat', host).textContent = '지금까지 내 필기 ' + res.total + '장 · ' + res.days + '회 수업';
        $('#phToday', host).textContent = '오늘 ' + (res.today_count || 0) + ' / ' + (res.limit || 10) + '장';
        var groups = groupByDate(res.photos || []);
        $('#phAlbum', host).innerHTML = groups.length ? groups.map(function (g) { return dayCard(g, true); }).join('')
          : '<div class="empty">' + EMPTY + '<br>위에서 오늘 필기를 올려 보세요.</div>';
        if (focus) { focusDay(host, focus); focus = ''; }
      }).catch(function () { $('#phStat', host).textContent = '내 필기를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'; });
    }

    function msg(t, bad) {
      var m = $('#phMsg', host);
      m.textContent = t || '';
      m.classList.toggle('is-bad', !!bad);
    }

    function onFiles(input) {
      var files = Array.prototype.slice.call(input.files || []).filter(function (f) { return /^image\//.test(f.type) || !f.type; });
      input.value = '';
      if (!files.length) return;
      var date = $('#phDate', host).value || today();
      if (date > today()) { msg('수업 날짜는 오늘이나 지난 날짜만 고를 수 있어요.', true); return; }
      var done = 0, i = 0;
      host.classList.add('is-busy');
      function next() {
        if (i >= files.length) {
          host.classList.remove('is-busy');
          msg(done ? done + '장을 올렸습니다. ' + dayLabel(date) + ' 수업 필기로 저장됐어요.' : '', false);
          return refresh();
        }
        msg((i + 1) + ' / ' + files.length + ' 올리는 중…');
        return uploadOne(code, date, files[i++]).then(function (r) {
          if (r && r.ok) { done++; return next(); }
          host.classList.remove('is-busy');
          msg((done ? done + '장을 올렸습니다. ' : '') + ((r && r.message) || '올리지 못했습니다.'), true);
          return refresh();
        }, function (e) {
          host.classList.remove('is-busy');
          msg((done ? done + '장을 올렸습니다. ' : '') + (e.message || '올리지 못했습니다.'), true);
          return refresh();
        });
      }
      next();
    }

    $('#phCam', host).addEventListener('change', function (e) { onFiles(e.target); });
    $('#phPick', host).addEventListener('change', function (e) { onFiles(e.target); });
    host.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]');
      if (d) {
        if (!global.confirm('이 사진을 지울까요? 지우면 되살릴 수 없습니다.')) return;
        d.disabled = true;
        call({ action: 'delete', code: code, id: d.dataset.del }).then(function (r) {
          msg(r && r.ok ? '사진을 지웠습니다.' : '지우지 못했습니다.', !(r && r.ok));
          refresh();
        });
      }
    });
    host.phFocus = function (date) { focus = date; if ($('#phAlbum', host).children.length) { focusDay(host, date); focus = ''; } };
    refresh();
  }

  /* 학부모 링크 — 날짜별 앨범 보기만 */
  function renderView(host, code, opts) {
    var focus = (opts && opts.focus) || '';
    host.innerHTML = TAB_HEAD + '<div class="card ph-up"><h2 class="card-title">📝 내 필기<span class="card-note">보기 전용</span></h2>' +
      '<p class="ph-stat" id="phStat">불러오는 중…</p>' +
      '<p class="ph-guide">학생이 수업 시간에 직접 쓴 필기 사진입니다. 학생이 학생 링크에서 올립니다.</p></div><div id="phAlbum"></div>';
    host.phFocus = function (date) { focus = date; if ($('#phAlbum', host).children.length) { focusDay(host, date); focus = ''; } };
    list(code).then(function (res) {
      if (!res || !res.ok) { $('#phStat', host).textContent = '내 필기를 불러오지 못했습니다.'; return; }
      $('#phStat', host).textContent = '지금까지 내 필기 ' + res.total + '장 · ' + res.days + '회 수업';
      var groups = groupByDate(res.photos || []);
      $('#phAlbum', host).innerHTML = groups.length ? groups.map(function (g) { return dayCard(g, false); }).join('')
        : '<div class="empty">' + EMPTY + '</div>';
      if (focus) { focusDay(host, focus); focus = ''; }
    }).catch(function () { $('#phStat', host).textContent = '내 필기를 불러오지 못했습니다.'; });
  }

  global.Photos = {
    renderTab: renderTab, weekCard: weekCard, lessonCard: lessonCard, lessonCardHtml: lessonCardHtml, gallery: gallery, lightbox: lightbox,
    thisWeek: thisWeek, addDays: addDays, shrink: shrink, list: list, mdDow: mdDow
  };

})(window);
