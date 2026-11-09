/* ============================================================
   mogo-view.js — 러닝노트(학생 · 학부모 화면) 「모의고사」 (migration-089 hub_mogo · 20261109b · 연동약속.md 버전 2)

   · 브라우저는 모고 연동 주소를 부르지 않는다 — 코치룸 DB 의 저장본(hub_mogo · 그 학생 링크로만)만 읽는다
   · 완성된 레포트만 · 마감 여부 · 작성 중은 서버가 아예 안 보낸다 · 다른 학생 이름 · 점수 · 순위는 없다
   · 「모의고사」 탭 — 맨 위 점수 추이 작은 그래프 · [나의 기록장] [종합 분석] · 회차 최근 순 · 누르면 화면 안 창(iframe)
   · 주간 레포트 아래 「📝 모의고사 기록 · 지금까지 n회」 — 최근 3회 + [전체 보기] · 그 레포트 기간 이후 새 회차는 NEW
   화면 안 창 높이 — { type: "mogo:height", height } · origin https://marathon-report.netlify.app 확인 뒤만 받는다
   ============================================================ */

(function (global) {
  'use strict';

  var ORIGIN = 'https://marathon-report.netlify.app';
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function mdw(iso) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
    var d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '(' + DOWK[d.getUTCDay()] + ')';
  }
  function okUrl(u) { return typeof u === 'string' && u.indexOf(ORIGIN + '/') === 0 && !/[\s"'<>]/.test(u) ? u : ''; }
  function okId(id) { return typeof id === 'string' && /^[A-Za-z0-9._-]{6,120}$/.test(id); }
  function list(d) {
    return ((d && d.reports) || []).filter(function (x) { return x && okId(x.id); })
      .slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }
  function has(d) { return !!d && (list(d).length > 0 || !!okUrl(d.notebookUrl) || !!okUrl(d.analysisUrl)); }

  /* 점수 추이 — 오래된 것부터 · 점수가 있는 회차만 (0 ~ 100) */
  function trendHtml(d) {
    var pts = list(d).filter(function (x) { return typeof x.score === 'number'; }).reverse().slice(-12);
    if (pts.length < 2) return '';
    var W = 300, H = 72, P = 8, n = pts.length;
    /* 세로 칸 — 그 학생 점수 범위에 맞춰 (위아래 여유 10점 · 0 ~ 100 안) */
    var sc = pts.map(function (x) { return Math.max(0, Math.min(100, x.score)); });
    var lo = Math.max(0, Math.min.apply(null, sc) - 10), hi = Math.min(100, Math.max.apply(null, sc) + 10);
    if (hi - lo < 20) { hi = Math.min(100, lo + 20); lo = Math.max(0, hi - 20); }
    var xy = pts.map(function (x, i) { var v = Math.max(0, Math.min(100, x.score)); return [P + (W - 2 * P) * (n === 1 ? 0.5 : i / (n - 1)), P + (H - 2 * P) * (1 - (v - lo) / (hi - lo))]; });
    var line = xy.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<figure class="mgv-trend" aria-label="점수 추이"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' +
      esc(pts.map(function (x) { return mdw(x.date) + ' ' + x.score + '점'; }).join(', ')) + '">' +
      '<path d="' + line + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      xy.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2"/>'; }).join('') + '</svg>' +
      '<figcaption class="mgv-trend__cap num">점수 추이 · 최근 ' + n + '회 · 마지막 ' + esc(pts[n - 1].score) + '점</figcaption></figure>';
  }
  function btnsHtml(d) {
    var nb = okUrl(d && d.notebookUrl), an = okUrl(d && d.analysisUrl);
    if (!nb && !an) return '';
    return '<div class="mgv-btns">' + (nb ? '<button type="button" class="mgv-btn" data-mgv-url="' + esc(nb) + '" data-mgv-title="나의 기록장">📒 나의 기록장</button>' : '') +
      (an ? '<button type="button" class="mgv-btn" data-mgv-url="' + esc(an) + '" data-mgv-title="나의 종합 분석">📊 종합 분석</button>' : '') + '</div>';
  }
  /* 한 줄 — 「11/8(일) · 한수 파이널 13회차 · [레포트 보기]」 (20261109c) · 아래 작게 점수 · 등급 */
  function rowHtml(x, since) {
    var isNew = since && x.date && x.date >= since;
    var sub = [x.score != null ? x.score + '점' : '', x.grade || '', x.firstAttempt === false ? '재응시' : ''].filter(Boolean).join(' · ');
    return '<li><button type="button" class="mgv-row" data-mgv-id="' + esc(x.id) + '" data-mgv-title="' + esc(x.examName || '모의고사') + '">' +
      '<span class="mgv-row__n"><span class="mgv-row__d num">' + esc(mdw(x.date)) + '</span>' + (x.date ? ' · ' : '') + esc(x.examName || '모의고사') + (isNew ? ' <b class="mgv-new">NEW</b>' : '') + '</span>' +
      (sub ? '<span class="mgv-row__m num">' + esc(sub) + '</span>' : '') +
      '<span class="mgv-row__go">레포트 보기 ›</span></button></li>';
  }
  /* 저장본을 못 읽었을 때 — 이 한 줄만 (러닝노트 다른 칸은 그대로) */
  var FAIL = '모의고사 기록을 불러오지 못했어요';
  function failHtml() { return '<div class="empty mgv-fail">' + FAIL + '</div>'; }
  /* 「모의고사」 탭 */
  /* 「모의고사」 탭 — 모든 학생에게 보인다 (20261109c) · 없으면 한 줄만 (일치 없음 같은 안쪽 사정은 쓰지 않는다) */
  var EMPTY = '아직 받은 모의고사 레포트가 없어요';
  function panelHtml(d) {
    if (d && d.failed) return failHtml();
    var L = list(d);
    if (!L.length && !has(d)) return '<div class="card mgv"><h2 class="mgv-title">모의고사 분석 레포트</h2><p class="mgv-empty">' + EMPTY + '</p></div>';
    return '<div class="card mgv">' +
      '<h2 class="mgv-title">모의고사 분석 레포트</h2>' + btnsHtml(d) + trendHtml(d) +
      (L.length ? '<ol class="mgv-list">' + L.map(function (x) { return rowHtml(x, ''); }).join('') + '</ol>' : '<p class="mgv-empty">' + EMPTY + '</p>') +
      '</div>';
  }
  /* 주간 레포트 아래 — 「📝 모의고사 기록 · 지금까지 n회」 최근 3회 + 전체 보기 */
  function reportBlockHtml(d, since) {
    var L = list(d);
    if (!L.length) return '';
    return '<section class="card mgv mgv--week" aria-label="모의고사 기록"><h3 class="mgv-wt">📝 모의고사 기록 · 지금까지 <b class="num">' + L.length + '</b>회</h3>' +
      '<ol class="mgv-list">' + L.slice(0, 3).map(function (x) { return rowHtml(x, since); }).join('') + '</ol>' +
      '<button type="button" class="mgv-all" data-mgv-all>전체 보기 ›</button></section>';
  }

  /* 화면 안 창 */
  function overlay() {
    var o = document.getElementById('mgvOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'mgvOverlay'; o.className = 'mgv-ov'; o.hidden = true;
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 'mgvTitle');
    o.innerHTML = '<div class="mgv-ov__head"><button type="button" class="mgv-ov__x" id="mgvClose" aria-label="닫기">‹ 닫기</button><h2 class="mgv-ov__t" id="mgvTitle"></h2>' +
      '<a class="mgv-ov__new" id="mgvNewTab" target="_blank" rel="noopener noreferrer">새 탭 ↗</a></div>' +
      '<div class="mgv-ov__body"><iframe id="mgvFrame" class="mgv-frame" title="모의고사 분석 레포트" referrerpolicy="no-referrer"></iframe></div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) { if (e.target.closest('#mgvClose')) close(); });
    return o;
  }
  function openUrl(url, title) {
    if (!okUrl(url)) return;
    var o = overlay(), f = document.getElementById('mgvFrame');
    document.getElementById('mgvTitle').textContent = title || '모의고사 분석 레포트';
    document.getElementById('mgvNewTab').href = url;
    f.style.height = '70vh';
    f.src = url;
    o.hidden = false;
    document.documentElement.classList.add('mgv-open');
  }
  function close() {
    var o = document.getElementById('mgvOverlay');
    if (!o || o.hidden) return;
    o.hidden = true;
    document.documentElement.classList.remove('mgv-open');
    var f = document.getElementById('mgvFrame'); if (f) f.src = 'about:blank';
  }
  global.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var d = e.data, f = document.getElementById('mgvFrame');
    if (!f || !d || d.type !== 'mogo:height' || !Number.isFinite(d.height)) return;
    f.style.height = Math.max(200, Math.min(20000, Math.round(d.height))) + 'px';
  });
  global.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mgv-id], [data-mgv-url]');
    if (!b) return;
    e.preventDefault();
    if (b.hasAttribute('data-mgv-url')) openUrl(b.getAttribute('data-mgv-url'), b.getAttribute('data-mgv-title'));
    else if (okId(b.getAttribute('data-mgv-id'))) openUrl(ORIGIN + '/report.html?id=' + encodeURIComponent(b.getAttribute('data-mgv-id')), b.getAttribute('data-mgv-title'));
  });

  global.MogoView = { has: has, list: list, panelHtml: panelHtml, failHtml: failHtml, FAIL: FAIL, EMPTY: EMPTY, reportBlockHtml: reportBlockHtml, trendHtml: trendHtml, openUrl: openUrl, close: close, ORIGIN: ORIGIN };
})(window);
