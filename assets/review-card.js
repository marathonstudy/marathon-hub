/* ============================================================
   review-card.js — 러닝노트 「오늘 복습테스트 기록하기」 · 복습테스트 점수 그래프 (migration-013)

   개인 링크(/me/#코드)에서만 쓴다. 이 링크는 학부모도 함께 본다.
     · 수업일 당일: 맨 위 카드 — 시험마다 전체 문항 수 · 틀린 개수 → 시험지 사진(필수 · 여러 장) → 제출 (migration-025)
       마감 = 수업일 밤 12시. 마감 전에는 고칠 수 있다 (선생님이 고친 시험은 잠긴다).
     · 제출한 뒤: 「제출 ✓」 — 낸 점수가 그대로 레포트에 들어간다. 「확인」 단계는 없앴다 (20261030a · migration-030)
       선생님이 고치면 「선생님이 고침 ✓」, 대신 넣으면 「선생님 입력 ✓」
     · 선생님이 미응시로 둔 시험은 입력 칸 없이 「미응시 · 결석」만 (사유 이름만 · migration-028 · 20261029h)
     · 레포트 탭 「누적 추이」: 낸 점수 그래프 · 최근 기록
   서버: Edge Function(review-test) — 링크 코드 · 오늘 날짜 · 마감을 서버가 확인한다.
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var esc = function (v) { return global.ReportView ? ReportView.esc(v) : String(v == null ? '' : v); };
  var SHRINK = { maxSide: 1280, target: 150 * 1024 };      /* 시험지는 글자만 보이면 된다 */

  function endpoint() { return CFG.supabase.url + '/functions/v1/' + (CFG.reviewFunction || 'review-test'); }
  function md(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    var dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return (+m[2]) + '/' + (+m[3]) + '(' + dow + ')';
  }
  /* "17 / 20 · 85점" */
  function scoreText(correct, q, score) { return correct + ' / ' + q + ' · ' + score + '점'; }

  function status(code) {
    if (global.HUB_PREVIEW) return global.HUB_PREVIEW.review();
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', code: code })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  /* 「확인 전 / 선생님 확인」 표시는 없앴다 — 누가 넣었는지만 */
  function badge(sub) {
    if (!sub) return '';
    if (sub.source === 'staff') return '<span class="rv-badge rv-badge--ok">선생님 입력 ✓</span>';
    if (sub.edited_by) return '<span class="rv-badge rv-badge--ok">선생님이 고침 ✓</span>';
    return '<span class="rv-badge rv-badge--ok">제출 ✓</span>';
  }

  function lightbox(url) {
    var box = document.createElement('div');
    box.className = 'ph-light';
    box.innerHTML = '<img alt="시험지 사진"><button type="button" class="ph-light__close" aria-label="닫기">×</button>';
    box.querySelector('img').src = url;
    box.addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  /* ============================================================
     오늘 카드 (migration-025 · 20261028d)
     오늘 수업일의 시험들(「10/22(목) 복습 TEST」 · 「10/22(목) 화작문 TEST」 …)마다 「전체 문항 수」 · 「틀린 개수」 두 숫자만.
     시험지 사진은 필수 · 여러 장(두 시험을 한 장에 찍어도 된다). 한 번에 내도 되고 하나씩 내도 된다.
     마감 = 수업일 밤 12시까지 고칠 수 있다 · 선생님이 고치거나 대신 넣은 시험은 잠긴다 (예전에 확인된 시험도).
     ============================================================ */

  var MAX_PHOTOS = 10;
  var st = { code: '', data: null, val: {}, blobs: [], previews: [], editing: false, busy: false, host: null, onChange: null };

  function mount(host, code, onChange) {
    st.host = host; st.code = code; st.onChange = onChange || null;
    return refresh();
  }

  function tests() { return (st.data && st.data.tests) || []; }
  function locked(t) { return !!(t.submission && t.submission.status === 'confirmed'); }
  /* 선생님이 미응시로 둔 시험 (아직 안 낸 것만) — 입력하라고 띄우지 않는다 */
  function absent(t) { return !t.submission && !!t.absent; }
  function absentBadge(t) {
    var r = (t.absent && t.absent.label) || '';
    return '<span class="rv-badge rv-badge--abs">' + esc(r ? '미응시 · ' + r : '미응시') + '</span>';
  }
  /* 아직 낼 시험 (안 냈고 미응시도 아닌 것) — hub.js 가 [복습테스트 입력하기]를 띄울지 본다 */
  function pendingOf(d) { return ((d && d.tests) || []).filter(function (t) { return !t.submission && !t.absent; }); }

  function refresh() {
    return status(st.code).then(function (d) {
      st.data = d && d.ok ? d : null;
      /* 예전 함수(시험 하나)만 있을 때도 같은 모양으로 */
      if (st.data && !st.data.tests && st.data.test) {
        st.data.tests = [Object.assign({ test_name: '복습 TEST', label: md(st.data.test.lesson_date) + ' 복습 TEST' }, st.data.test, { submission: st.data.submission })];
      }
      st.editing = false;
      resetInput();
      render();
      if (st.onChange) st.onChange(st.data);
      return st.data;
    }).catch(function () { st.data = null; render(); return null; });
  }

  function resetInput() {
    st.val = {};
    tests().forEach(function (t) {
      var s = t.submission;
      st.val[t.id] = s ? { q: String(s.q_count), w: String(s.wrong_n != null ? s.wrong_n : (s.wrong || []).length) } : { q: '', w: '' };
    });
    st.previews.forEach(function (u) { URL.revokeObjectURL(u); });
    st.blobs = []; st.previews = [];
  }

  /* 한 시험의 입력 — { ok, empty, q, w, score, msg } */
  function check(t) {
    var v = st.val[t.id] || { q: '', w: '' };
    var qs = String(v.q).trim(), ws = String(v.w).trim();
    if (!qs && !ws) return { empty: true };
    var q = Number(qs), w = Number(ws);
    if (!qs || !/^\d+$/.test(qs) || q < 1) return { msg: '전체 문항 수를 1 이상으로 적어 주세요' };
    if (q > 200) return { msg: '전체 문항 수는 200까지 적을 수 있어요' };
    if (!ws || !/^\d+$/.test(ws)) return { msg: '틀린 개수를 적어 주세요 (다 맞았으면 0)' };
    if (w > q) return { msg: '틀린 개수가 전체보다 많아요' };
    return { ok: true, q: q, w: w, correct: q - w, score: Math.round((q - w) / q * 100) };
  }

  function hasPhotos() {
    if (st.blobs.length) return true;
    return tests().some(function (t) { return t.submission && t.submission.has_photo; });
  }
  function oldPhotoUrls() {
    var seen = {}, out = [];
    tests().forEach(function (t) {
      var s = t.submission;
      ((s && (s.photo_urls || (s.photo_url ? [s.photo_url] : []))) || []).forEach(function (u) { if (u && !seen[u]) { seen[u] = 1; out.push(u); } });
    });
    return out;
  }

  /* 낼 수 있는 시험 (잠기지 않은 것 · 두 칸 모두 맞게 적은 것) */
  function plan() {
    var items = [], bad = '';
    tests().forEach(function (t) {
      if (locked(t) || absent(t)) return;
      var c = check(t);
      if (c.empty) return;
      if (!c.ok) { bad = bad || (t.test_name + ' — ' + c.msg); return; }
      var s = t.submission;
      if (s && !st.blobs.length && Number(s.q_count) === c.q && Number(s.wrong_n) === c.w) return;   /* 바뀌지 않은 시험은 다시 안 보낸다 */
      items.push({ test: t.id, q: c.q, wrong: c.w });
    });
    return { items: items, bad: bad };
  }

  function thumbs(urls) {
    return urls.map(function (u, i) {
      return '<button type="button" class="rv-thumb" data-rv-photo="' + esc(u) + '"><img src="' + esc(u) + '" alt="시험지 사진 ' + (i + 1) + '"></button>';
    }).join('');
  }

  function scoreLine(c) {
    return c.ok ? esc(scoreText(c.correct, c.q, c.score)) : c.msg ? esc(c.msg) : '<span class="rv-muted">두 숫자를 적으면 점수가 보여요</span>';
  }

  function render() {
    var host = st.host;
    if (!host) return;
    var list = tests();
    if (!st.data || !list.length) { host.innerHTML = ''; return; }
    var day = md(list[0].lesson_date);
    var head = '<h2 class="card-title">📝 오늘 복습테스트 기록하기<span class="card-note">' + esc(day) + ' · ' + list.length + '개</span></h2>';
    var allDone = list.every(function (t) { return t.submission || absent(t); });

    if (allDone && !st.editing) {
      var canEdit = list.some(function (t) { return t.submission && !locked(t); });
      host.innerHTML =
        '<div class="card rv-card rv-card--done">' + head +
          list.map(function (t) {
            var s = t.submission;
            if (!s) {
              return '<div class="rv-done rv-done--abs">' +
                '<div class="rv-done__mark" aria-hidden="true">–</div>' +
                '<div><div class="rv-done__title">' + esc(t.label) + ' ' + absentBadge(t) + '</div></div>' +
              '</div>';
            }
            return '<div class="rv-done">' +
              '<div class="rv-done__mark" aria-hidden="true">✓</div>' +
              '<div><div class="rv-done__title">' + esc(t.label) + ' ' + badge(s) + '</div>' +
              '<div class="rv-done__score num">' + esc(scoreText(s.correct, s.q_count, s.score)) + '</div></div>' +
            '</div>';
          }).join('') +
          '<div class="rv-thumbs">' + thumbs(oldPhotoUrls()) + '</div>' +
          (canEdit
            ? '<button type="button" class="hub-btn hub-btn--ghost rv-edit">고치기</button>' +
              '<p class="rv-note">오늘 밤 12시까지 고칠 수 있어요. 낸 점수가 그대로 레포트에 들어갑니다.</p>'
            : '<p class="rv-note">낸 점수가 그대로 레포트에 들어갑니다.</p>') +
        '</div>';
      return;
    }

    var p = plan();
    var photoOk = hasPhotos();
    var rows = list.map(function (t) {
      var s = t.submission;
      if (absent(t)) {
        return '<div class="rv-test is-locked is-absent"><div class="rv-test__name">' + esc(t.label) + ' ' + absentBadge(t) + '</div></div>';
      }
      if (locked(t)) {
        return '<div class="rv-test is-locked"><div class="rv-test__name">' + esc(t.label) + ' ' + badge(s) + '</div>' +
          '<div class="rv-test__score num">' + esc(scoreText(s.correct, s.q_count, s.score)) + '</div></div>';
      }
      var v = st.val[t.id] || { q: '', w: '' };
      var c = check(t);
      return '<div class="rv-test" data-rv-test="' + esc(t.id) + '">' +
        '<div class="rv-test__name">' + esc(t.label) + (s ? ' ' + badge(s) : '') + '</div>' +
        '<div class="rv-test__inputs">' +
          '<label class="rv-in"><span>전체 문항</span><input type="number" inputmode="numeric" min="1" max="200" data-rv-q="' + esc(t.id) + '" value="' + esc(v.q) + '" placeholder="20"></label>' +
          '<label class="rv-in"><span>틀린 개수</span><input type="number" inputmode="numeric" min="0" max="200" data-rv-w="' + esc(t.id) + '" value="' + esc(v.w) + '" placeholder="0"></label>' +
        '</div>' +
        '<div class="rv-test__score num' + (c.msg ? ' is-bad' : '') + '" data-rv-score="' + esc(t.id) + '" aria-live="polite">' + scoreLine(c) + '</div>' +
      '</div>';
    }).join('');
    var urls = st.previews.length ? st.previews : oldPhotoUrls();
    var anySub = list.some(function (t) { return t.submission; });
    host.innerHTML =
      '<div class="card rv-card">' + head +
        '<p class="rv-step"><b>1</b> 시험마다 전체 문항 수와 틀린 개수 <span class="rv-muted">(하나만 먼저 내도 돼요)</span></p>' +
        rows +
        '<p class="rv-step"><b>2</b> 시험지 사진 <span class="rv-muted">(필수 · 여러 장 · 두 시험을 한 장에 찍어도 돼요)</span></p>' +
        '<div class="rv-thumbs">' + thumbs(urls) + '</div>' +
        '<label class="hub-btn hub-btn--ghost rv-photo">📷 ' + (st.blobs.length ? '사진 더 찍기 (' + st.blobs.length + '장)' : (urls.length ? '사진 새로 찍기' : '시험지 사진 찍기')) +
          '<input type="file" accept="image/*" multiple class="rv-file" hidden></label>' +
        (st.blobs.length ? '<button type="button" class="rv-cancel rv-clear">찍은 사진 지우기</button>' : '') +
        '<button type="button" class="hub-btn rv-submit"' + (photoOk && p.items.length && !p.bad && !st.busy ? '' : ' disabled') + '>' +
          (st.busy ? '올리는 중…' : p.items.length > 1 ? p.items.length + '개 한 번에 제출하기' : (anySub ? '제출하기 (고친 것 · 남은 것)' : '제출하기')) + '</button>' +
        '<p class="rv-note rv-note--warn"' + (p.bad || !photoOk ? '' : ' hidden') + '>' + esc(p.bad || (!photoOk ? '사진을 찍어야 제출 버튼이 눌려요.' : '')) + '</p>' +
        '<p class="rv-note">마감 오늘 ' + esc(day) + ' 밤 12시 · 그 전까지 고칠 수 있어요.</p>' +
        (st.editing ? '<button type="button" class="rv-cancel">고치지 않고 닫기</button>' : '') +
      '</div>';
  }

  function onInput(e) {
    var q = e.target.getAttribute('data-rv-q'), w = e.target.getAttribute('data-rv-w');
    var id = q || w;
    if (!id) return;
    st.val[id] = st.val[id] || { q: '', w: '' };
    if (q) st.val[id].q = e.target.value; else st.val[id].w = e.target.value;
    /* 점수 · 버튼만 다시 (입력 칸은 그대로 두어 커서가 안 튄다) */
    var t = tests().find(function (x) { return x.id === id; });
    var c = check(t);
    var sc = st.host.querySelector('[data-rv-score="' + id + '"]');
    if (sc) { sc.classList.toggle('is-bad', !!c.msg); sc.innerHTML = scoreLine(c); }
    var p = plan();
    var btn = st.host.querySelector('.rv-submit');
    if (btn) {
      btn.disabled = !(hasPhotos() && p.items.length && !p.bad && !st.busy);
      btn.textContent = p.items.length > 1 ? p.items.length + '개 한 번에 제출하기' : '제출하기';
    }
    var warn = st.host.querySelector('.rv-note--warn');
    if (warn) { warn.textContent = p.bad || (!hasPhotos() ? '사진을 찍어야 제출 버튼이 눌려요.' : ''); warn.hidden = !warn.textContent; }
  }

  function onClick(e) {
    var ph = e.target.closest('[data-rv-photo]');
    if (ph) { lightbox(ph.dataset.rvPhoto); return; }
    if (e.target.closest('.rv-edit')) { st.editing = true; resetInput(); render(); return; }
    if (e.target.closest('.rv-clear')) { st.previews.forEach(function (u) { URL.revokeObjectURL(u); }); st.blobs = []; st.previews = []; render(); return; }
    if (e.target.closest('.rv-cancel')) { st.editing = false; resetInput(); render(); return; }
    if (e.target.closest('.rv-submit')) submit();
  }

  function onChangeFile(e) {
    if (!e.target.classList.contains('rv-file')) return;
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (!global.Photos || !Photos.shrink) { alert('사진을 준비하지 못했습니다. 새로고침해 주세요.'); return; }
    var room = MAX_PHOTOS - st.blobs.length;
    if (files.length > room) { alert('사진은 한 번에 ' + MAX_PHOTOS + '장까지 올릴 수 있어요.'); files = files.slice(0, Math.max(0, room)); }
    var btn = st.host.querySelector('.rv-submit');
    if (btn) { btn.disabled = true; btn.textContent = '사진 준비 중…'; }
    files.reduce(function (pr, f) {
      return pr.then(function () {
        return Photos.shrink(f, SHRINK).then(function (s) {
          st.blobs.push(s.blob);
          st.previews.push(URL.createObjectURL(s.blob));
        });
      });
    }, Promise.resolve()).then(render, function (err) {
      alert((err && err.message) || '사진을 열 수 없습니다. 다시 찍어 주세요.');
      render();
    });
  }

  function submit() {
    if (st.busy || !st.data || !tests().length) return;
    if (global.HUB_PREVIEW) { alert(global.HUB_PREVIEW.blockMsg); return; }   /* 미리보기 — 아무것도 바꾸지 않는다 */
    var p = plan();
    if (p.bad || !p.items.length || !hasPhotos()) return;
    st.busy = true; render();
    var fd = new FormData();
    fd.append('code', st.code);
    fd.append('items', JSON.stringify(p.items));
    st.blobs.forEach(function (b, i) { fd.append('file', b, 'review-' + (i + 1) + '.jpg'); });
    fetch(endpoint(), { method: 'POST', headers: { 'apikey': CFG.supabase.key }, body: fd })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (res) {
        st.busy = false;
        if (!res || !res.ok) {
          render();
          alert((res && res.message) || '제출하지 못했습니다. 잠시 뒤 다시 해 주세요.');
          if (res && /locked|closed_test/.test(res.reason || '')) refresh();
          return;
        }
        refresh();
      })
      .catch(function () { st.busy = false; render(); alert('제출하지 못했습니다. 인터넷 연결을 확인해 주세요.'); });
  }

  function bind(host) {
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChangeFile);
    host.addEventListener('input', onInput);
  }

  /* ============================================================
     복습테스트 점수 (레포트 탭 「누적 추이」) — 낸 점수 그래프 (migration-030 · 확인 단계 없음) · 최근 기록
     시험마다 선을 나눈다 (「복습 TEST」 · 「화작문 TEST」 …). 가로축은 수업일, 점마다 「10/22(목) 복습 TEST · 17/20 · 85점」
     2px 선 · 8px 점(흰 테두리) · 0/50/100 가는 눈금 · 마지막 점에만 값 · 아래 「표로 보기」에 전부 있다.
     ============================================================ */

  var COLORS = ['#7858E8', '#E08A2E', '#2F9C7C', '#C4566F', '#3B6FB6'];
  function nameOf(r) { return r.test_name || '복습 TEST'; }
  function labelOf(r) { return r.label || (md(r.lesson_date) + ' ' + nameOf(r)); }
  function shortDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[2]) + '/' + (+m[3]) : ''; }

  function graphSvg(list) {
    var W = 340, H = 176, L = 30, R = 44, T = 14, B = 26;
    var days = [];
    list.forEach(function (r) { var d = String(r.lesson_date).slice(0, 10); if (days.indexOf(d) === -1) days.push(d); });
    days.sort();
    var n = days.length;
    var x = function (d) { var i = days.indexOf(String(d).slice(0, 10)); return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return T + (100 - v) * (H - T - B) / 100; };
    var names = [];
    list.forEach(function (r) { if (names.indexOf(nameOf(r)) === -1) names.push(nameOf(r)); });
    var grid = [0, 50, 100].map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R + 8) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="rv-g-grid"/>' +
             '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="rv-g-axis" text-anchor="end">' + v + '</text>';
    }).join('');
    var step = Math.ceil(n / 6);
    var xl = days.map(function (d, i) {
      return (i % step === 0 || i === n - 1) ? '<text x="' + x(d) + '" y="' + (H - 8) + '" class="rv-g-axis" text-anchor="middle">' + shortDay(d) + '</text>' : '';
    }).join('');
    var series = names.map(function (nm, k) {
      var color = COLORS[k % COLORS.length];
      var pts = list.filter(function (r) { return nameOf(r) === nm; }).sort(function (a, b) { return String(a.lesson_date) < String(b.lesson_date) ? -1 : 1; });
      var line = pts.length > 1 ? '<polyline points="' + pts.map(function (r) { return x(r.lesson_date).toFixed(1) + ',' + y(r.score).toFixed(1); }).join(' ') +
        '" class="rv-g-line" style="stroke:' + color + '"/>' : '';
      var dots = pts.map(function (r) {
        var label = labelOf(r) + ' · ' + scoreText(r.correct, r.q_count, r.score);
        return '<g class="rv-g-pt" tabindex="0" data-tip="' + esc(label) + '" data-x="' + x(r.lesson_date) + '" data-y="' + y(r.score) + '">' +
                 '<circle cx="' + x(r.lesson_date) + '" cy="' + y(r.score) + '" r="14" class="rv-g-hit"/>' +
                 '<circle cx="' + x(r.lesson_date) + '" cy="' + y(r.score) + '" r="4" class="rv-g-dot" style="fill:' + color + '"/>' +
                 '<title>' + esc(label) + '</title></g>';
      }).join('');
      var last = pts[pts.length - 1];
      var end = '<text x="' + (x(last.lesson_date) + 9) + '" y="' + (y(last.score) + 4 + k * 12) + '" class="rv-g-end" style="fill:' + color + '">' + last.score + '점</text>';
      return line + dots + end;
    }).join('');
    return '<svg class="rv-graph" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="복습테스트 시험별 점수">' + grid + xl + series + '</svg>' +
      (names.length > 1 ? '<div class="rv-legend">' + names.map(function (nm, k) {
        return '<span><i style="background:' + COLORS[k % COLORS.length] + '"></i>' + esc(nm) + '</span>';
      }).join('') + '</div>' : '');
  }

  function history(host, confirmed, recent) {
    confirmed = (confirmed || []).slice(-24);
    recent = recent || [];
    if (!confirmed.length && !recent.length) { host.innerHTML = ''; return; }
    var html = '<div class="card rv-hist">' +
      '<h2 class="card-title">📈 복습테스트 점수</h2>';
    if (confirmed.length) {
      var names = [];
      confirmed.forEach(function (r) { if (names.indexOf(nameOf(r)) === -1) names.push(nameOf(r)); });
      html += '<div class="rv-hist__sum">' + names.map(function (nm) {
        var rs = confirmed.filter(function (r) { return nameOf(r) === nm; });
        var last = rs[rs.length - 1];
        var avg = Math.round(rs.reduce(function (a, r) { return a + r.score; }, 0) / rs.length);
        return '<span>' + esc(nm) + ' 최근 <b class="num">' + esc(scoreText(last.correct, last.q_count, last.score)) + '</b> · 평균 <b class="num">' + avg + '점</b> <span class="rv-muted">(' + rs.length + '번)</span></span>';
      }).join('') + '</div>' +
              '<div class="rv-graph-wrap">' + graphSvg(confirmed) + '<div class="rv-tip" hidden></div></div>' +
              '<details class="rv-table"><summary>표로 보기</summary><table><thead><tr><th>시험</th><th>점수</th></tr></thead><tbody>' +
              confirmed.slice().reverse().map(function (r) {
                return '<tr><td>' + esc(labelOf(r)) + '</td><td class="num">' + esc(scoreText(r.correct, r.q_count, r.score)) + '</td></tr>';
              }).join('') + '</tbody></table></details>';
    } else {
      html += '<p class="hub-muted">아직 낸 점수가 없습니다.</p>';
    }
    if (recent.length) {
      html += '<div class="nt-sub">🧾 최근 기록</div><ul class="rv-recent">' + recent.map(function (s) {
        var urls = s.photo_urls || (s.photo_url ? [s.photo_url] : []);
        return '<li class="rv-recent__row">' +
          '<span class="rv-recent__round num">' + esc(labelOf(s)) + '</span>' +
          '<span class="rv-recent__score num">' + esc(scoreText(s.correct, s.q_count, s.score)) + '</span>' + badge(s) +
          (s.mode === 'numbers' && (s.wrong || []).length ? '<span class="rv-recent__wrong">틀린 번호 ' + s.wrong.join(', ') + '</span>' : '') +
          urls.map(function (u) { return '<button type="button" class="rv-thumb rv-thumb--sm" data-rv-photo="' + esc(u) + '"><img src="' + esc(u) + '" alt="시험지 사진"></button>'; }).join('') +
        '</li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    host.innerHTML = html;

    var tip = host.querySelector('.rv-tip');
    var wrap = host.querySelector('.rv-graph-wrap');
    function show(g) {
      if (!tip || !g) return;
      var svg = wrap.querySelector('svg');
      var k = svg.getBoundingClientRect().width / 340 || 1;
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(wrap.clientWidth - 170, Number(g.dataset.x) * k - 85)) + 'px';
      tip.style.top = Math.max(0, Number(g.dataset.y) * k - 44) + 'px';
    }
    host.onclick = function (e) {
      var ph = e.target.closest('[data-rv-photo]');
      if (ph) { lightbox(ph.dataset.rvPhoto); return; }
      var g = e.target.closest && e.target.closest('.rv-g-pt');
      if (g) show(g); else if (tip) tip.hidden = true;
    };
    host.onmouseover = function (e) { var g = e.target.closest && e.target.closest('.rv-g-pt'); if (g) show(g); };
    host.onfocusin = function (e) { var g = e.target.closest && e.target.closest('.rv-g-pt'); if (g) show(g); };
    if (wrap) wrap.onmouseleave = function () { if (tip) tip.hidden = true; };
  }

  global.ReviewCard = { mount: mount, bind: bind, refresh: refresh, history: history, scoreText: scoreText, labelOf: labelOf, pendingOf: pendingOf };

})(window);
