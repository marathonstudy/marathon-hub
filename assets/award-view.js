/* ============================================================
   award-view.js — 월간 과제 루틴 우수자 화면 (러닝노트 #코드/award/2026-10 · 코치룸 미리보기 · 20261108i · migration-077)

   AwardView.html(v)  — v = hub_award / staff_award_view 가 주는 값 (그 학생 것만)
     맨 위 카드(이미지로 저장하는 부분): 「🏅 10월 과제 루틴 우수자」 배지 · 캐릭터 · 보라 + 금색
       상위 % 가 기준 안이면 「김민서 학생의 10월 과제 제출률은 96%로, 마라톤국어 전체 수강생 중 상위 8%입니다.」 (96% 크게)
       밖이면 「김민서 학생의 10월 과제 제출률은 92%입니다.」
     과제 n개 중 m개 · 연속 제출 최장 n일 · 한 달 ○ △ ✕ 달력 · 영역별 정답률(지난달보다 오르면 ▲) · 선생님 한마디(있을 때만) · 지금까지 모은 배지 n개
     [이미지로 저장] — 배지 · 제출률 · 상위 % 부분만 세로 카드(1080×1920 · 인스타 스토리)로
   다른 학생의 이름 · 순위 · 인원은 넣지 않는다 (상위 % 는 그 학생 것만)
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
})(window);
