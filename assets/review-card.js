/* ============================================================
   review-card.js — 러닝노트 「오늘 복습테스트 기록하기」 · 복습테스트 점수 그래프 (migration-013)

   개인 링크(/me/#코드)에서만 쓴다. 이 링크는 학부모도 함께 본다.
     · 수업일 당일: 맨 위 카드 — 틀린 번호만 누르기 → 시험지 사진(필수) → 제출 (1분 안에)
       마감 = 수업일 밤 12시. 마감 전 · 선생님 확인 전에는 고칠 수 있다.
     · 제출한 뒤: 「학생 입력 · 확인 전」 → 선생님이 확인하면 「선생님 확인 ✓」
     · 내 레포트 탭 위: 확인된 점수만 그래프로, 최근 기록은 확인 전도 「확인 전」 표시와 함께
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

  function badge(sub) {
    if (!sub) return '';
    if (sub.status === 'confirmed') {
      return '<span class="rv-badge rv-badge--ok">' + (sub.source === 'staff' ? '선생님 입력 ✓' : '선생님 확인 ✓') + '</span>';
    }
    return '<span class="rv-badge">학생 입력 · 확인 전</span>';
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
     오늘 카드
     ============================================================ */

  var st = { code: '', data: null, wrong: {}, blob: null, preview: '', editing: false, busy: false, host: null, onChange: null };

  function mount(host, code, onChange) {
    st.host = host; st.code = code; st.onChange = onChange || null;
    return refresh();
  }

  function refresh() {
    return status(st.code).then(function (d) {
      st.data = d && d.ok ? d : null;
      st.editing = false;
      resetInput();
      render();
      if (st.onChange) st.onChange(st.data);
      return st.data;
    }).catch(function () { st.data = null; render(); return null; });
  }

  function resetInput() {
    st.wrong = {};
    var sub = st.data && st.data.submission;
    if (sub) (sub.wrong || []).forEach(function (n) { st.wrong[n] = true; });
    if (st.preview) URL.revokeObjectURL(st.preview);
    st.blob = null; st.preview = '';
  }

  function counts() {
    var q = st.data.test.q_count;
    var w = Object.keys(st.wrong).filter(function (k) { return st.wrong[k]; }).length;
    return { q: q, wrong: w, correct: q - w, score: Math.round((q - w) / q * 100) };
  }

  function render() {
    var host = st.host;
    if (!host) return;
    var d = st.data;
    if (!d || !d.test) { host.innerHTML = ''; return; }
    var t = d.test, sub = d.submission;
    var head = '<h2 class="card-title">📝 오늘 복습테스트 기록하기<span class="card-note">' + t.round_no + '회 · ' + t.q_count + '문항</span></h2>';

    if (sub && !st.editing) {
      host.innerHTML =
        '<div class="card rv-card rv-card--done">' + head +
          '<div class="rv-done">' +
            '<div class="rv-done__mark" aria-hidden="true">✓</div>' +
            '<div><div class="rv-done__title">제출 완료 ' + badge(sub) + '</div>' +
            '<div class="rv-done__score num">' + esc(scoreText(sub.correct, sub.q_count, sub.score)) + '</div>' +
            '<div class="rv-done__wrong">' + ((sub.wrong || []).length ? '틀린 번호 ' + sub.wrong.join(', ') : '모두 맞혔어요 👏') + '</div></div>' +
          '</div>' +
          (sub.photo_url ? '<button type="button" class="rv-thumb" data-rv-photo="' + esc(sub.photo_url) + '"><img src="' + esc(sub.photo_url) + '" alt="제출한 시험지 사진"></button>' : '') +
          (sub.status !== 'confirmed'
            ? '<button type="button" class="hub-btn hub-btn--ghost rv-edit">고치기</button>' +
              '<p class="rv-note">오늘 밤 12시까지, 선생님이 확인하기 전에는 고칠 수 있어요.</p>'
            : '<p class="rv-note">선생님이 확인한 점수가 레포트에 들어갑니다.</p>') +
        '</div>';
      return;
    }

    var c = counts();
    var hasPhoto = !!st.blob || !!(sub && sub.has_photo);
    var nums = '';
    for (var i = 1; i <= t.q_count; i++) {
      nums += '<button type="button" class="rv-num' + (st.wrong[i] ? ' is-wrong' : '') + '" data-rv-n="' + i + '" aria-pressed="' + (st.wrong[i] ? 'true' : 'false') + '">' + i + '</button>';
    }
    host.innerHTML =
      '<div class="card rv-card">' + head +
        '<p class="rv-step"><b>1</b> 틀린 번호만 누르세요 <span class="rv-muted">(다시 누르면 취소)</span></p>' +
        '<div class="rv-grid" role="group" aria-label="틀린 번호 고르기">' + nums + '</div>' +
        '<div class="rv-score num" aria-live="polite">' + esc(scoreText(c.correct, c.q, c.score)) + '</div>' +
        '<p class="rv-step"><b>2</b> 시험지 사진 <span class="rv-muted">(필수)</span></p>' +
        (st.preview ? '<button type="button" class="rv-thumb" data-rv-photo="' + esc(st.preview) + '"><img src="' + esc(st.preview) + '" alt="찍은 시험지 사진"></button>' :
          (sub && sub.photo_url ? '<button type="button" class="rv-thumb" data-rv-photo="' + esc(sub.photo_url) + '"><img src="' + esc(sub.photo_url) + '" alt="제출한 시험지 사진"></button>' : '')) +
        '<label class="hub-btn hub-btn--ghost rv-photo">📷 ' + (hasPhoto ? '사진 다시 찍기' : '시험지 사진 찍기') +
          '<input type="file" accept="image/*" capture="environment" class="rv-file" hidden></label>' +
        '<button type="button" class="hub-btn rv-submit"' + (hasPhoto && !st.busy ? '' : ' disabled') + '>' +
          (st.busy ? '올리는 중…' : (sub ? '고친 내용 제출하기' : '제출하기')) + '</button>' +
        (!hasPhoto ? '<p class="rv-note rv-note--warn">사진을 찍어야 제출 버튼이 눌려요.</p>' : '') +
        '<p class="rv-note">마감 오늘 ' + md(t.lesson_date) + ' 밤 12시 · 선생님 확인 전까지 고칠 수 있어요.</p>' +
        (st.editing ? '<button type="button" class="rv-cancel">고치지 않고 닫기</button>' : '') +
      '</div>';
  }

  function onClick(e) {
    var n = e.target.closest('[data-rv-n]');
    if (n) {
      var k = Number(n.dataset.rvN);
      st.wrong[k] = !st.wrong[k];
      n.classList.toggle('is-wrong', st.wrong[k]);
      n.setAttribute('aria-pressed', st.wrong[k] ? 'true' : 'false');
      var c = counts();
      var sc = st.host.querySelector('.rv-score');
      if (sc) sc.textContent = scoreText(c.correct, c.q, c.score);
      return;
    }
    var ph = e.target.closest('[data-rv-photo]');
    if (ph) { lightbox(ph.dataset.rvPhoto); return; }
    if (e.target.closest('.rv-edit')) { st.editing = true; resetInput(); render(); return; }
    if (e.target.closest('.rv-cancel')) { st.editing = false; resetInput(); render(); return; }
    if (e.target.closest('.rv-submit')) submit();
  }

  function onChangeFile(e) {
    if (!e.target.classList.contains('rv-file')) return;
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!global.Photos || !Photos.shrink) { alert('사진을 준비하지 못했습니다. 새로고침해 주세요.'); return; }
    var btn = st.host.querySelector('.rv-submit');
    if (btn) { btn.disabled = true; btn.textContent = '사진 준비 중…'; }
    Photos.shrink(f, SHRINK).then(function (s) {
      if (st.preview) URL.revokeObjectURL(st.preview);
      st.blob = s.blob;
      st.preview = URL.createObjectURL(s.blob);
      render();
    }).catch(function (err) {
      alert((err && err.message) || '사진을 열 수 없습니다. 다시 찍어 주세요.');
      render();
    });
  }

  function submit() {
    if (st.busy || !st.data || !st.data.test) return;
    if (global.HUB_PREVIEW) { alert(global.HUB_PREVIEW.blockMsg); return; }   /* 미리보기 — 아무것도 바꾸지 않는다 */
    var sub = st.data.submission;
    if (!st.blob && !(sub && sub.has_photo)) return;
    st.busy = true; render();
    var fd = new FormData();
    fd.append('code', st.code);
    fd.append('test_id', st.data.test.id);
    fd.append('wrong', JSON.stringify(Object.keys(st.wrong).filter(function (k) { return st.wrong[k]; }).map(Number).sort(function (a, b) { return a - b; })));
    if (st.blob) fd.append('file', st.blob, 'review.jpg');
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
  }

  /* ============================================================
     복습테스트 점수 (내 레포트 탭 위) — 확인된 점수만 그래프, 최근 기록은 확인 전도
     한 줄 그래프: 2px 선 · 8px 점(흰 테두리) · 옅은 면 · 0/50/100 가는 눈금 · 마지막 점에만 값
     누르면 그 회차 값이 뜬다. 아래 「표로 보기」에 전부 있다.
     ============================================================ */

  var INK = '#7858E8';

  function graphSvg(list) {
    var W = 340, H = 168, L = 30, R = 44, T = 14, B = 26;
    var n = list.length;
    var x = function (i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return T + (100 - v) * (H - T - B) / 100; };
    var grid = [0, 50, 100].map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R + 8) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="rv-g-grid"/>' +
             '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="rv-g-axis" text-anchor="end">' + v + '</text>';
    }).join('');
    var pts = list.map(function (r, i) { return x(i).toFixed(1) + ',' + y(r.score).toFixed(1); });
    var area = n > 1 ? '<path d="M' + x(0) + ',' + y(0) + ' L' + pts.join(' L') + ' L' + x(n - 1) + ',' + y(0) + ' Z" class="rv-g-area"/>' : '';
    var line = n > 1 ? '<polyline points="' + pts.join(' ') + '" class="rv-g-line"/>' : '';
    var step = Math.ceil(n / 7);
    var xl = list.map(function (r, i) {
      return (i % step === 0 || i === n - 1)
        ? '<text x="' + x(i) + '" y="' + (H - 8) + '" class="rv-g-axis" text-anchor="middle">' + r.round_no + '회</text>' : '';
    }).join('');
    var dots = list.map(function (r, i) {
      var label = r.round_no + '회 · ' + md(r.lesson_date) + ' · ' + scoreText(r.correct, r.q_count, r.score);
      return '<g class="rv-g-pt" tabindex="0" data-tip="' + esc(label) + '" data-x="' + x(i) + '" data-y="' + y(r.score) + '">' +
               '<circle cx="' + x(i) + '" cy="' + y(r.score) + '" r="14" class="rv-g-hit"/>' +
               '<circle cx="' + x(i) + '" cy="' + y(r.score) + '" r="4" class="rv-g-dot"/>' +
               '<title>' + esc(label) + '</title></g>';
    }).join('');
    var last = list[n - 1];
    var end = '<text x="' + (x(n - 1) + 9) + '" y="' + (y(last.score) + 4) + '" class="rv-g-end">' + last.score + '점</text>';
    return '<svg class="rv-graph" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="복습테스트 회차별 점수 (선생님 확인)">' +
             grid + area + line + xl + dots + end + '</svg>';
  }

  function history(host, confirmed, recent) {
    confirmed = (confirmed || []).slice(-12);
    recent = recent || [];
    if (!confirmed.length && !recent.length) { host.innerHTML = ''; return; }
    var avg = confirmed.length ? Math.round(confirmed.reduce(function (a, r) { return a + r.score; }, 0) / confirmed.length) : null;
    var html = '<div class="card rv-hist">' +
      '<h2 class="card-title">📈 복습테스트 점수<span class="card-note">선생님 확인한 점수</span></h2>';
    if (confirmed.length) {
      var last = confirmed[confirmed.length - 1];
      html += '<div class="rv-hist__sum"><span>최근 <b class="num">' + esc(scoreText(last.correct, last.q_count, last.score)) + '</b></span>' +
              '<span>평균 <b class="num">' + avg + '점</b> <span class="rv-muted">(' + confirmed.length + '회)</span></span></div>' +
              '<div class="rv-graph-wrap">' + graphSvg(confirmed) + '<div class="rv-tip" hidden></div></div>' +
              '<details class="rv-table"><summary>표로 보기</summary><table><thead><tr><th>회차</th><th>수업일</th><th>점수</th></tr></thead><tbody>' +
              confirmed.slice().reverse().map(function (r) {
                return '<tr><td>' + r.round_no + '회</td><td>' + md(r.lesson_date) + '</td><td class="num">' + esc(scoreText(r.correct, r.q_count, r.score)) + '</td></tr>';
              }).join('') + '</tbody></table></details>';
    } else {
      html += '<p class="hub-muted">아직 선생님이 확인한 점수가 없습니다.</p>';
    }
    if (recent.length) {
      html += '<div class="nt-sub">🧾 최근 기록</div><ul class="rv-recent">' + recent.map(function (s) {
        return '<li class="rv-recent__row">' +
          '<span class="rv-recent__round num">' + s.round_no + '회 · ' + md(s.lesson_date) + '</span>' +
          '<span class="rv-recent__score num">' + esc(scoreText(s.correct, s.q_count, s.score)) + '</span>' + badge(s) +
          ((s.wrong || []).length ? '<span class="rv-recent__wrong">틀린 번호 ' + s.wrong.join(', ') + '</span>' : '') +
          (s.photo_url ? '<button type="button" class="rv-thumb rv-thumb--sm" data-rv-photo="' + esc(s.photo_url) + '"><img src="' + esc(s.photo_url) + '" alt="시험지 사진"></button>' : '') +
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
      tip.style.left = Math.max(0, Math.min(wrap.clientWidth - 150, Number(g.dataset.x) * k - 75)) + 'px';
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

  global.ReviewCard = { mount: mount, bind: bind, refresh: refresh, history: history, scoreText: scoreText };

})(window);
