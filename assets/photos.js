/* ============================================================
   photos.js — 러닝노트(/me/) 「필기 노트」

   · 올리기: 휴대폰 카메라로 찍거나 앨범에서 여러 장 고르기.
     올리기 전에 이 화면에서 긴 변 1600px · JPEG · 장당 0.3MB 안팎으로 줄인다.
     수업 날짜는 기본 오늘, 지난 날짜로 바꿀 수 있다.
   · 보기: 날짜별 앨범. 학생 본인은 언제든 지울 수 있다(파일까지).
   · 학부모: 반 공지 첫 화면과 「내 레포트」에 그 주 필기를 "○월 ○일 수업 필기입니다" 로.

   서버는 Edge Function(note-photo) 하나만 부른다. 개인 링크 코드로 그 학생인지 확인하고,
   사진 주소는 10분만 유효한 서명 주소다. 보관함 경로 · 다른 학생 사진은 오지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var MAX_SIDE = 1600;
  var TARGET = 300 * 1024;          /* 목표 0.3MB */
  var HARD = 590 * 1024;            /* 서버 상한 600KB 아래 */

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
     opts 로 바꿀 수 있다 — 복습테스트 시험지는 { maxSide: 1280, target: 150KB } (review-card.js) */
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
    return global.Photos.shrink(file).then(function (s) {
      var fd = new FormData();
      fd.append('code', code);
      fd.append('lesson_date', lessonDate);
      fd.append('width', String(s.width));
      fd.append('height', String(s.height));
      fd.append('file', s.blob, 'note.jpg');
      return fetch(endpoint(), { method: 'POST', headers: { 'apikey': CFG.supabase.key }, body: fd })
        .then(function (r) { return r.json().catch(function () { return { ok: false, message: '올리지 못했습니다.' }; }); });
    });
  }

  /* ---------- 크게 보기 ---------- */

  function lightbox(url) {
    var box = document.createElement('div');
    box.className = 'ph-light';
    box.innerHTML = '<img alt="필기 사진"><button type="button" class="ph-light__close" aria-label="닫기">×</button>';
    box.querySelector('img').src = url;
    box.addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  function groupByDate(photos) {
    var groups = [], idx = {};
    photos.forEach(function (p) {
      if (!(p.lesson_date in idx)) { idx[p.lesson_date] = groups.length; groups.push({ date: p.lesson_date, items: [] }); }
      groups[idx[p.lesson_date]].items.push(p);
    });
    return groups;
  }

  function gridHtml(items, canDelete) {
    return '<div class="ph-grid">' + items.map(function (p) {
      return '<div class="ph-cell"><button type="button" class="ph-thumb" data-url="' + esc(p.url) + '">' +
             '<img loading="lazy" alt="필기 사진" src="' + esc(p.url) + '"></button>' +
             (canDelete ? '<button type="button" class="ph-del" data-del="' + esc(p.id) + '">지우기</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /* ---------- 학부모용 묶음 — "○월 ○일 수업 필기입니다" ---------- */

  function weekCard(host, code, from, to) {
    if (!host) return Promise.resolve();
    return list(code, from, to).then(function (res) {
      if (!res || !res.ok || !(res.photos || []).length) { host.innerHTML = ''; return; }
      host.innerHTML = groupByDate(res.photos).map(function (g) {
        return '<div class="card ph-card"><h2 class="card-title">📝 ' + esc(dayLabel(g.date)) + ' 수업 필기입니다' +
               '<span class="card-note">' + g.items.length + '장</span></h2>' + gridHtml(g.items, false) + '</div>';
      }).join('');
    }).catch(function () { host.innerHTML = ''; });
  }

  /* ---------- 「필기 노트」 탭 ---------- */

  function renderTab(host, code) {
    host.innerHTML =
      '<div class="card ph-up">' +
        '<h2 class="card-title">📝 오늘 필기 올리기<span class="card-note" id="phToday"></span></h2>' +
        '<p class="ph-stat" id="phStat">불러오는 중…</p>' +
        '<p class="ph-guide">필기한 부분만 찍어 주세요. 얼굴이나 친구가 나오지 않게 해 주세요.</p>' +
        '<label class="ph-date">수업 날짜 <input type="date" id="phDate" value="' + today() + '" max="' + today() + '"></label>' +
        '<div class="ph-buttons">' +
          '<label class="hub-btn ph-btn">📷 카메라로 찍기<input type="file" accept="image/*" capture="environment" id="phCam" hidden></label>' +
          '<label class="hub-btn ph-btn ph-btn--ghost">🖼️ 앨범에서 고르기<input type="file" accept="image/*" multiple id="phPick" hidden></label>' +
        '</div>' +
        '<p class="ph-msg" id="phMsg" role="status"></p>' +
      '</div>' +
      '<div id="phAlbum"></div>';

    function refresh() {
      return list(code).then(function (res) {
        if (!res || !res.ok) {
          $('#phStat', host).textContent = res && res.reason === 'closed' ? '더 이상 쓸 수 없는 링크입니다.' : '필기 노트를 불러오지 못했습니다.';
          $('#phAlbum', host).innerHTML = '';
          return;
        }
        $('#phStat', host).textContent = '지금까지 필기 ' + res.total + '장 · ' + res.days + '회 수업';
        $('#phToday', host).textContent = '오늘 ' + (res.today_count || 0) + ' / ' + (res.limit || 10) + '장';
        var groups = groupByDate(res.photos || []);
        $('#phAlbum', host).innerHTML = groups.length ? groups.map(function (g) {
          return '<div class="card ph-day"><h2 class="card-title">' + esc(dayLabel(g.date)) + ' 수업' +
                 '<span class="card-note">' + g.items.length + '장</span></h2>' + gridHtml(g.items, true) + '</div>';
        }).join('') : '<div class="empty">아직 올린 필기가 없습니다.<br>위에서 오늘 필기를 올려 보세요.</div>';
      }).catch(function () { $('#phStat', host).textContent = '필기 노트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'; });
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
      var t = e.target.closest('.ph-thumb');
      if (t) { lightbox(t.dataset.url); return; }
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
    refresh();
  }

  /* 학부모 묶음 카드에서도 누르면 크게 */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.ph-card .ph-thumb');
    if (t) lightbox(t.dataset.url);
  });

  global.Photos = {
    renderTab: renderTab, weekCard: weekCard, thisWeek: thisWeek, addDays: addDays, shrink: shrink, list: list
  };

})(window);
