/* ============================================================
   award-view.js — 월간 과제 루틴 우수자 화면 (러닝노트 #코드/award/2026-10 · 코치룸 미리보기 · 20261108i · migration-077)

   AwardView.html(v)  — v = hub_award / staff_award_view 가 주는 값 (그 학생 것만)
     맨 위 카드(이미지로 저장하는 부분): 「🏅 10월 과제 루틴 우수자」 배지 · 캐릭터 · 보라 + 금색
       상위 % 가 기준 안이면 「김민서 학생의 10월 과제 제출률은 96%로, 마라톤국어 전체 수강생 중 상위 8%입니다.」 (96% 크게)
       밖이면 「김민서 학생의 10월 과제 제출률은 92%입니다.」
     과제 n개 중 m개 · 연속 제출 최장 n일 · 한 달 ○ △ ✕ 달력 · 영역별 정답률(지난달보다 오르면 ▲) · 선생님 한마디(있을 때만) · 지금까지 모은 배지 n개
     [이미지로 저장] — 배지 · 제출률 · 상위 % 부분만 세로 카드(1080×1920 · 인스타 스토리)로
   다른 학생의 이름 · 순위 · 인원은 넣지 않는다 (상위 % 는 그 학생 것만)
   BadgeView — 「🏅 내 루틴 배지」 (아래 · 20261108j)
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* 캐릭터 — 머리띠를 맨 마라톤 러너 (직접 그린 단순한 그림) */
  var CHAR = '<svg class="awd-char" viewBox="0 0 120 120" role="img" aria-label="마라톤 러너 캐릭터">' +
    '<circle cx="60" cy="62" r="40" fill="#FFE3B8"/>' +
    '<path d="M22 50 Q60 30 98 50 L98 58 Q60 40 22 58 Z" fill="#F2C14E"/>' +
    '<path d="M96 52 l16 -8 l-4 12 z" fill="#F2C14E"/>' +
    '<circle cx="46" cy="66" r="5" fill="#2E2266"/><circle cx="74" cy="66" r="5" fill="#2E2266"/>' +
    '<circle cx="47.5" cy="64.5" r="1.6" fill="#fff"/><circle cx="75.5" cy="64.5" r="1.6" fill="#fff"/>' +
    '<path d="M48 80 Q60 90 72 80" stroke="#2E2266" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<circle cx="36" cy="78" r="5" fill="#FFB4B4" opacity=".7"/><circle cx="84" cy="78" r="5" fill="#FFB4B4" opacity=".7"/>' +
    '</svg>';

  function lead(v) {
    var big = '<b class="awd-pct num">' + num(v.pct) + '%</b>';
    return v.top
      ? esc(v.name) + ' 학생의 ' + num(v.mon) + '월 과제 제출률은 ' + big + '로, 마라톤국어 전체 수강생 중 <b class="awd-top num">상위 ' + num(v.top) + '%</b>입니다.'
      : esc(v.name) + ' 학생의 ' + num(v.mon) + '월 과제 제출률은 ' + big + '입니다.';
  }
  function cardHtml(v) {
    return '<div class="awd-card" data-awd-card>' +
      '<div class="awd-badge"><span class="awd-medal" aria-hidden="true">🏅</span><span class="awd-badge__t">' + num(v.mon) + '월 과제 루틴 우수자</span></div>' +
      CHAR +
      '<p class="awd-lead">' + lead(v) + '</p>' +
      '<p class="awd-brand">마라톤국어</p>' +
    '</div>';
  }
  /* 한 달 달력 — 일 ~ 토 · ○ 냄 △ 늦게 ✕ 안 냄 · 면 면제 · 빈칸 과제 없음 */
  var MARK = { onTime: ['○', '냄'], late: ['△', '늦게 냄'], none: ['✕', '안 냄'], exempt: ['면', '면제'] };
  function calHtml(v) {
    var m = /^(\d{4})-(\d{2})$/.exec(v.month || '');
    if (!m) return '';
    var y = +m[1], mo = +m[2], first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var cal = v.cal || {}, h = '';
    ['일', '월', '화', '수', '목', '금', '토'].forEach(function (d, i) { h += '<span class="awd-cal__h' + (i === 0 || i === 6 ? ' is-wk' : '') + '">' + d + '</span>'; });
    for (var k = 0; k < first.getUTCDay(); k++) h += '<span class="awd-cal__c is-pad"></span>';
    for (var d = 1; d <= days; d++) {
      var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), st = cal[iso], mk = MARK[st];
      var wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      h += '<span class="awd-cal__c' + (wd === 0 || wd === 6 ? ' is-wk' : '') + (st ? ' is-' + st : '') + '"' + (mk ? ' title="' + mo + '/' + d + ' ' + mk[1] + '"' : '') + '><i class="num">' + d + '</i><b>' + (mk ? mk[0] : '') + '</b></span>';
    }
    return '<div class="awd-box"><h3 class="awd-h">한 달 과제 달력</h3><div class="awd-cal">' + h + '</div>' +
      '<p class="awd-legend">○ 냄 · △ 늦게 냄 · ✕ 안 냄 · 면 면제 · 빈칸은 과제 없는 날</p></div>';
  }
  function areasHtml(v) {
    var a = (v.areas || []).filter(function (x) { return x && x.name && x.rate != null; });
    if (!a.length) return '';
    return '<div class="awd-box"><h3 class="awd-h">영역별 정답률</h3><ul class="awd-areas">' + a.map(function (x) {
      var up = x.prev != null && num(x.rate) > num(x.prev);
      return '<li><span class="awd-area__n">' + esc(x.name) + '</span><span class="awd-area__bar"><i style="width:' + Math.max(0, Math.min(100, num(x.rate))) + '%"></i></span>' +
        '<span class="awd-area__v num">' + num(x.rate) + '%' + (up ? ' <b class="awd-up" title="지난달 ' + num(x.prev) + '%">▲</b>' : '') + '</span></li>';
    }).join('') + '</ul><p class="awd-legend">▲ 지난달보다 올랐어요</p></div>';
  }
  function html(v, opt) {
    if (!v) return '<div class="awd awd--none"><p>이 달의 루틴 우수자 기록이 없습니다.</p></div>';
    opt = opt || {};
    return '<div class="awd" data-awd-month="' + esc(v.month) + '">' +
      (opt.back ? '<button type="button" class="awd-back" data-awd-back>← 레포트로</button>' : '') +
      cardHtml(v) +
      '<div class="awd-stats">' +
        '<div class="awd-stat"><span class="awd-stat__k">과제</span><b class="num">' + num(v.total) + '개 중 ' + num(v.done) + '개</b></div>' +
        '<div class="awd-stat"><span class="awd-stat__k">연속 제출 최장</span><b class="num">' + num(v.streak) + '일</b></div>' +
      '</div>' +
      calHtml(v) + areasHtml(v) +
      (v.note ? '<div class="awd-box awd-note"><h3 class="awd-h">선생님 한마디</h3><p>' + esc(v.note) + '</p></div>' : '') +
      '<p class="awd-count">🏅 지금까지 모은 배지 <b class="num">' + num(v.badges) + '개</b></p>' +
      (opt.noSave ? '' : '<button type="button" class="btn btn--primary awd-save" data-awd-save>이미지로 저장</button>') +
    '</div>';
  }

  /* ---------- 이미지로 저장 — 세로 카드 1080 × 1920 (배지 · 제출률 · 상위 % 만) ---------- */
  function wrap(ctx, text, maxW) {
    var out = [], line = '';
    String(text).split(' ').forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    });
    if (line) out.push(line);
    return out;
  }
  function drawChar(ctx, cx, cy, r) {
    ctx.save();
    ctx.fillStyle = '#FFE3B8'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F2C14E'; ctx.fillRect(cx - r, cy - r * 0.42, r * 2, r * 0.2);
    ctx.fillStyle = '#2E2266';
    ctx.beginPath(); ctx.arc(cx - r * 0.35, cy + r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.35, cy + r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2E2266'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.3, r * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  function canvasOf(v) {
    var c = document.createElement('canvas');
    c.width = 1080; c.height = 1920;
    var ctx = c.getContext && c.getContext('2d');
    if (!ctx) return null;
    var g = ctx.createLinearGradient(0, 0, 0, 1920);
    g.addColorStop(0, '#2E2266'); g.addColorStop(1, '#5A3FD0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
    ctx.strokeStyle = '#F2C14E'; ctx.lineWidth = 10; ctx.strokeRect(60, 60, 960, 1800);
    ctx.textAlign = 'center'; ctx.fillStyle = '#F2C14E';
    ctx.beginPath(); ctx.arc(540, 380, 150, 0, Math.PI * 2); ctx.fill();
    ctx.font = '160px sans-serif'; ctx.fillText('🏅', 540, 440);
    ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 76px sans-serif';
    ctx.fillText(num(v.mon) + '월 과제 루틴 우수자', 540, 660);
    drawChar(ctx, 540, 860, 110);
    ctx.font = 'bold 64px sans-serif'; ctx.fillText(String(v.name || '') + ' 학생', 540, 1080);
    ctx.font = '48px sans-serif'; ctx.fillStyle = '#E8E2FF'; ctx.fillText(num(v.mon) + '월 과제 제출률', 540, 1190);
    ctx.fillStyle = '#F2C14E'; ctx.font = 'bold 240px sans-serif'; ctx.fillText(num(v.pct) + '%', 540, 1430);
    if (v.top) {
      ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 60px sans-serif';
      wrap(ctx, '마라톤국어 전체 수강생 중 상위 ' + num(v.top) + '%', 900).forEach(function (l, i) { ctx.fillText(l, 540, 1560 + i * 76); });
    }
    ctx.fillStyle = '#E8E2FF'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('마라톤국어', 540, 1790);
    return c;
  }
  function saveImage(v) {
    var c = canvasOf(v);
    if (!c) return Promise.resolve(false);
    var name = '루틴우수자-' + (v.month || '') + '.png';
    return new Promise(function (res) {
      function go(url, done) {
        var a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        if (done) setTimeout(done, 1000);
        res(true);
      }
      if (c.toBlob) c.toBlob(function (b) {
        if (!b) { go(c.toDataURL('image/png')); return; }
        var u = URL.createObjectURL(b);
        go(u, function () { URL.revokeObjectURL(u); });
      }, 'image/png');
      else go(c.toDataURL('image/png'));
    });
  }

  global.AwardView = { html: html, cardHtml: cardHtml, lead: lead, saveImage: saveImage, canvasOf: canvasOf };

  /* ============================================================
     BadgeView — 「🏅 내 루틴 배지」 (러닝노트 레포트 탭 위쪽 · 코치룸 학생 상세 · 20261108j · migration-078)
       v = hub_badges / staff_badges { today, perfect, weeks: [{ week, from, to, total, done, perfect }], months: ['2026-10'], first, cur }
       위쪽 — 월간 배지 12칸(1월~12월 · 두 줄) · 받은 달 금색 · 안 받은 달 회색 · 아직 안 온 달 흐리게 · ◀ 해 ▶ (지난해도)
              누르면 그달 우수자 화면 · 2개월 이상 연속이면 「연속 달성 최장 n개월」 · 3개월 연속부터 테두리 더 화려하게
       아래쪽 — 「⭐ 퍼펙트 배지 n개」 + 최근 주들의 별 줄(받은 주 금별 · 못 받은 주 빈 별) · 별을 누르면 그 주 날짜 · 과제 수
              3주 이상 연속(가장 최근 주부터)이면 「n주 연속 퍼펙트」
       하나도 없으면 작게 「매주 과제를 모두 내면 퍼펙트 배지, 한 달 제출률이 높으면 루틴 배지를 받아요」
     ============================================================ */
  function ymAdd(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  function monthRuns(list) {
    var set = {}, run = {}, best = 0;
    (list || []).forEach(function (m) { set[m] = 1; });
    Object.keys(set).sort().forEach(function (m) {
      if (set[ymAdd(m, -1)]) return;                 /* 이어진 줄의 첫 달에서만 센다 */
      var k = m, n = 0, part = [];
      while (set[k]) { part.push(k); n++; k = ymAdd(k, 1); }
      part.forEach(function (x) { run[x] = n; });
      if (n > best) best = n;
    });
    return { run: run, best: best };
  }
  function weekRun(weeks) {
    var n = 0;
    for (var i = (weeks || []).length - 1; i >= 0; i--) { if (weeks[i].perfect) n++; else break; }
    return n;
  }
  function mdOf(iso) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[1]) + '/' + (+m[2]) : ''; }
  function weekInfo(w) { return mdOf(w.from) + '~' + mdOf(w.to) + ' · 과제 ' + num(w.total) + '개' + (w.perfect ? ' 모두 냄 ⭐' : ' 중 ' + num(w.done) + '개 냄'); }
  function boxHtml(v, year, opt) {
    opt = opt || {};
    if (!v) return '';
    var today = String(v.today || '').slice(0, 7) || '';
    var y = year || +today.slice(0, 4) || new Date().getFullYear();
    var firstY = +(String(v.first || '').slice(0, 4)) || y, lastY = +today.slice(0, 4) || y;
    var runs = monthRuns(v.months), got = {};
    (v.months || []).forEach(function (m) { got[m] = 1; });
    var cells = '';
    for (var m = 1; m <= 12; m++) {
      var ym = y + '-' + String(m).padStart(2, '0'), on = !!got[ym], fut = ym >= today;
      var cls = on ? 'is-got' + (runs.run[ym] >= 3 ? ' is-streak' : '') : fut ? 'is-future' : 'is-miss';
      cells += on
        ? '<button type="button" class="bdg-m ' + cls + '" data-bdg-m="' + ym + '" aria-label="' + esc(m + '월 루틴 우수자 — 누르면 그달 화면') + '"><span aria-hidden="true">🏅</span><small>' + m + '월</small></button>'
        : '<span class="bdg-m ' + cls + '" aria-label="' + esc(m + '월' + (fut ? ' (아직)' : '')) + '"><span aria-hidden="true">🏅</span><small>' + m + '월</small></span>';
    }
    var weeks = v.weeks || [], wr = weekRun(weeks), none = !num(v.perfect) && !(v.months || []).length;
    return '<div class="card bdg" data-bdg-year="' + y + '">' +
      '<h2 class="card-title">🏅 내 루틴 배지' + (opt.note ? '<span class="card-note">' + esc(opt.note) + '</span>' : '') + '</h2>' +
      '<div class="bdg-year"><button type="button" class="bdg-y" data-bdg-y="-1"' + (y <= firstY ? ' disabled' : '') + ' aria-label="지난해">◀</button><b class="num">' + y + '년</b>' +
        '<button type="button" class="bdg-y" data-bdg-y="1"' + (y >= lastY ? ' disabled' : '') + ' aria-label="다음 해">▶</button></div>' +
      '<div class="bdg-months">' + cells + '</div>' +
      (runs.best >= 2 ? '<p class="bdg-run">연속 달성 최장 <b class="num">' + runs.best + '개월</b></p>' : '') +
      '<div class="bdg-perfect"><b>⭐ 퍼펙트 배지 <span class="num">' + num(v.perfect) + '개</span></b>' + (wr >= 3 ? ' <span class="bdg-wrun">' + wr + '주 연속 퍼펙트</span>' : '') + '</div>' +
      (weeks.length ? '<div class="bdg-stars">' + weeks.map(function (w, i) {
        return '<button type="button" class="bdg-s' + (w.perfect ? ' is-got' : '') + '" data-bdg-w="' + i + '" aria-label="' + esc(weekInfo(w)) + '">' + (w.perfect ? '★' : '☆') + '</button>';
      }).join('') + '</div><p class="bdg-info" data-bdg-info hidden></p>' : '') +
      (none ? '<p class="bdg-hint">매주 과제를 모두 내면 퍼펙트 배지, 한 달 제출률이 높으면 루틴 배지를 받아요</p>' : '') +
    '</div>';
  }
  function nowHtml(v) {
    if (!v || !v.cur) return '';
    return '<button type="button" class="bdg-now" data-bdg-m="' + esc(v.cur) + '">🏅 ' + (+v.cur.slice(5, 7)) + '월 루틴 우수자</button>';
  }
  /* 한 곳에 붙이고 ◀ ▶ · 별 · 달 누르기를 맡는다 — onMonth(ym) 는 그달 화면 열기 */
  function mount(host, v, onMonth, opt) {
    if (!host) return;
    var year = 0;
    function paint() { host.innerHTML = (opt && opt.noNow ? '' : nowHtml(v)) + boxHtml(v, year, opt); }
    paint();
    host.onclick = function (e) {
      var yb = e.target.closest('[data-bdg-y]');
      if (yb && !yb.disabled) { year = (year || +String(v.today || '').slice(0, 4)) + (+yb.dataset.bdgY); paint(); return; }
      var mb = e.target.closest('[data-bdg-m]');
      if (mb && onMonth) { onMonth(mb.dataset.bdgM); return; }
      var sb = e.target.closest('[data-bdg-w]');
      if (sb) {
        var w = (v.weeks || [])[+sb.dataset.bdgW], info = host.querySelector('[data-bdg-info]');
        if (w && info) { info.hidden = false; info.textContent = weekInfo(w); }
        Array.prototype.forEach.call(host.querySelectorAll('[data-bdg-w]'), function (b) { b.classList.toggle('is-pick', b === sb); });
      }
    };
  }
  /* 코치룸 한 줄 — 「⭐ 퍼펙트 6개 · 🏅 루틴 배지 2개(10월 · 9월) · 3주 연속」 */
  function lineText(v) {
    if (!v) return '';
    var ms = (v.months || []).slice().reverse().map(function (m) { return (+m.slice(5, 7)) + '월'; });
    var wr = weekRun(v.weeks || []);
    return '⭐ 퍼펙트 ' + num(v.perfect) + '개 · 🏅 루틴 배지 ' + ms.length + '개' + (ms.length ? '(' + ms.slice(0, 3).join(' · ') + (ms.length > 3 ? ' …' : '') + ')' : '') + (wr >= 3 ? ' · ' + wr + '주 연속' : '');
  }
  global.BadgeView = { html: boxHtml, nowHtml: nowHtml, mount: mount, lineText: lineText, monthRuns: monthRuns, weekRun: weekRun };
})(window);
