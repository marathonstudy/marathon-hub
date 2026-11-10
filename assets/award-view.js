/* ============================================================
   award-view.js — 월간 배지(월간 과제 루틴 우수자) 화면 (러닝노트 #코드/award/2026-10 · 코치룸 미리보기 · 20261108i · migration-077)

   AwardView.html(v)  — v = hub_award / staff_award_view 가 주는 값 (그 학생 것만)
     맨 위 카드(이미지로 저장하는 부분): 「🏅 10월 월간 배지」 배지 · 캐릭터 · 보라 + 금색
       상위 % 가 기준 안이면 「김민서 학생의 10월 과제 제출률은 96%로, 마라톤국어 전체 수강생 중 상위 8%입니다.」 (96% 크게)
       밖이면 「김민서 학생의 10월 과제 제출률은 92%입니다.」
     과제 n개 중 m개 · 연속 제출 최장 n일 · 한 달 ○ △ ✕ 달력 · 영역별 정답률(지난달보다 오르면 ▲) · 선생님 한마디(있을 때만) · 지금까지 모은 배지 n개
     [이미지로 저장] — 배지 · 제출률 · 상위 % 부분만 세로 카드(1080×1920 · 인스타 스토리)로
   다른 학생의 이름 · 순위 · 인원은 넣지 않는다 (상위 % 는 그 학생 것만)
   BadgeView — 「🏅 내 배지」 주간 배지 · 월간 배지 (아래 · 20261108j → 20261110g)
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
      '<div class="awd-badge"><span class="awd-medal" aria-hidden="true">🏅</span><span class="awd-badge__t">' + num(v.mon) + '월 월간 배지</span></div>' +
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
    if (!v) return '<div class="awd awd--none"><p>이 달의 월간 배지 기록이 없습니다.</p></div>';
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
    ctx.fillText(num(v.mon) + '월 월간 배지', 540, 660);
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
    var name = '월간배지-' + (v.month || '') + '.png';
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
     BadgeView — 「🏅 내 배지」 (러닝노트 홈 · 레포트 탭 접는 칸 · 코치룸 미리보기 · 20261108j → 20261110g · migration-078 · 097)
       v = hub_badges / staff_badges { today, perfect, weeks: [{ week, from, to, lesson, total, done, perfect }](모든 주 · 0개인 주도), months: ['2026-10'], start, first, cur }
       제목 하나 「🏅 내 배지」(바깥 접는 칸에 제목이 있으면 opt.noTitle) · ◀ 해 ▶ 하나로 두 칸을 같이
       [주간 배지] — 「⭐ 주간 배지 n개 · 최장 연속 n주」(2주 이상일 때) · 「이번 주 진행 중」
              그해 주마다 작은 도장(1~4월 · 5~8월 · 9~12월 세 줄 · 위에 작게 달 이름 · 깃허브 잔디처럼)
              받은 주 ⭐ 색 · 못 받은 주 연회색 빈 도장(빨강 없음) · 과제 0개인 주 「쉼」 점선 · 이번 주 은은한 빛 · 누르면 「11/2~11/6 · 5/5 · 주간 배지 ⭐」
              칸은 「학생이 시작한 주」와 「배지 기록이 있는 첫 주」 중 늦은 쪽부터 — 기록 없는 지난 주는 빈 도장으로 채우지 않음(빈자리) · 지난 기록을 채우면 앞쪽 칸이 저절로 늘어남
       [월간 배지] — 「🏅 월간 배지 n개」 · 그 시작 달부터 달 칸 · 받은 달 금색(누르면 그달 화면) · 못 받은 달 연회색 · 아직 안 끝난 달 흐리게 · 3개월 연속부터 테두리 더 화려하게
       하나도 없으면 작게 「한 주 과제를 모두 내면 주간 배지, 한 달 제출률이 높으면 월간 배지를 받아요」
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
  /* 가장 최근 주부터 이어진 주간 배지 수 — 과제 0개인 주(쉼)는 건너뛴다 */
  function weekRun(weeks) {
    var n = 0;
    for (var i = (weeks || []).length - 1; i >= 0; i--) {
      if (weeks[i].perfect) n++;
      else if (weeks[i].total != null && !num(weeks[i].total)) continue;
      else break;
    }
    return n;
  }
  /* ---------- 날짜 (UTC 로만 셈 · 'YYYY-MM-DD') ---------- */
  function dOf(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function isoOf(d) { return d.toISOString().slice(0, 10); }
  function monOf(iso) { var d = dOf(iso); if (!d) return ''; d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return isoOf(d); }
  function addDays(iso, n) { var d = dOf(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
  function mdOf(iso) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[1]) + '/' + (+m[2]) : ''; }
  /* 그 학생이 시작한 날 — start(수강 시작일) → first → 첫 주 기록 → 오늘 */
  function startOf(v) {
    var c = [v.start, v.first, (v.weeks || [])[0] && v.weeks[0].week, v.today];
    for (var i = 0; i < c.length; i++) if (dOf(c[i])) return String(c[i]).slice(0, 10);
    return isoOf(new Date());
  }
  /* 주(월요일) → 기록 */
  function weekMap(v) { var o = {}; (v.weeks || []).forEach(function (w) { var k = monOf(w.week || w.from); if (k) o[k] = w; }); return o; }
  function curMon(v) { return monOf(v.today) || monOf(isoOf(new Date())); }
  /* 칸을 그리기 시작하는 주 — 「학생이 시작한 주」와 「배지 기록이 실제로 있는 첫 주」 중 늦은 쪽 (20261110g)
     기록이 없는 지난 주를 빈 도장으로 채우지 않는다 · 나중에 지난 기록을 채우면 그만큼 앞쪽 칸이 저절로 늘어난다
     기록이 하나도 없으면 이번 주만 */
  function gridStart(v) {
    var ks = Object.keys(weekMap(v)).sort(), cur = curMon(v);
    if (!ks.length) return cur;
    var st = monOf(startOf(v)), first = ks[0];
    var k = st > first ? st : first;
    return k > cur ? cur : k;
  }
  /* 주간 배지 최장 연속 — 칸 시작 주부터 이번 주까지 · 쉼은 건너뜀 · 기록 없는 주 · 못 받은 주에서 끊김 */
  function bestRun(v) {
    var map = weekMap(v), cur = curMon(v), k = gridStart(v), n = 0, best = 0, guard = 0;
    while (k && k <= cur && guard++ < 600) {
      var w = map[k];
      if (w && w.perfect) { n++; if (n > best) best = n; }
      else if (w && !num(w.total)) { /* 쉼 */ }
      else if (k < cur) n = 0;
      k = addDays(k, 7);
    }
    return best;
  }
  /* 한 칸의 상태 — got ⭐ · miss 회색 빈 도장 · rest 쉼(과제 0개) · now 이번 주 진행 중 · none 기록 없음 · future 아직 */
  function weekState(w, k, cur) {
    if (w && w.perfect) return 'got';
    if (k === cur) return 'now';
    if (k > cur) return 'future';
    if (!w) return 'none';
    return num(w.total) ? 'miss' : 'rest';
  }
  function weekInfo(k, w, s) {
    var t = mdOf(k) + '~' + mdOf(addDays(k, 4));
    if (w && num(w.total)) t += ' · ' + num(w.done) + '/' + num(w.total);
    return t + (s === 'got' ? ' · 주간 배지 ⭐' : s === 'rest' ? ' · 쉼(과제 없음)' : s === 'none' ? ' · 기록 없음' : s === 'now' ? ' · 이번 주 진행 중' : s === 'future' ? ' · 아직' : '');
  }
  /* 주간 배지 — 그해 1~4월 · 5~8월 · 9~12월 세 줄(한 줄 18칸) · 위에 작게 달 이름
     칸 시작 주(gridStart) 앞 · 사이에 기록이 없는 지난 주는 도장 없이 빈자리 · 시작 주가 없는 줄은 안 그림 */
  function weekGridHtml(v, y) {
    var map = weekMap(v), cur = curMon(v), st = gridStart(v);
    var k = monOf(y + '-01-04'), rows = [[], [], []];
    while (true) {                                           /* 그 주의 목요일이 그해에 있는 주 (달도 목요일로) */
      var th = addDays(k, 3);
      if (+th.slice(0, 4) > y) break;
      if (+th.slice(0, 4) === y) rows[Math.floor((+th.slice(5, 7) - 1) / 4)].push({ k: k, m: +th.slice(5, 7) });
      k = addDays(k, 7);
    }
    return '<div class="bdg-grid">' + rows.map(function (row) {
      if (!row.length || row[row.length - 1].k < st) return '';
      var labels = '', cells = '', lastM = 0;
      row.forEach(function (c, i) {
        var span = 1;
        /* 달 이름 — 그달 칸이 하나라도 시작 주 뒤에 있을 때만 */
        if (c.m !== lastM) { for (var j = i + 1; j < row.length && row[j].m === c.m; j++) span++; if (row[i + span - 1].k >= st) labels += '<span class="bdg-ml" style="grid-column:' + (i + 1) + ' / span ' + span + '">' + c.m + '월</span>'; lastM = c.m; }
        var w = map[c.k], s = weekState(w, c.k, cur);
        if (c.k < st || s === 'none') { cells += '<span class="bdg-w is-pad" aria-hidden="true"></span>'; return; }
        cells += '<button type="button" class="bdg-w is-' + s + (c.k === cur && s !== 'now' ? ' is-now' : '') + '" data-bdg-k="' + c.k + '" aria-label="' + esc(weekInfo(c.k, w, s)) + '">' +
          (s === 'got' ? '⭐' : s === 'rest' ? '쉼' : '') + '</button>';
      });
      return '<div class="bdg-row"><div class="bdg-ml-row">' + labels + '</div><div class="bdg-cells">' + cells + '</div></div>';
    }).join('') + '</div>';
  }
  /* 월간 배지 — 그해 칸(시작한 달부터) · 받은 달 금색(누르면 그달 화면) · 못 받은 달 연회색 · 아직 안 끝난 달 흐리게 */
  function monthCellsHtml(v, y) {
    var today = String(v.today || '').slice(0, 7), m0 = (v.months || []).slice().sort()[0] || '', stM = gridStart(v).slice(0, 7), runs = monthRuns(v.months), got = {}, cells = '';
    (v.months || []).forEach(function (m) { got[m] = 1; });
    if (m0 && m0 < stM) stM = m0;                                        /* 받은 월간 배지가 더 앞이면 그달부터 */
    for (var m = 1; m <= 12; m++) {
      var ym = y + '-' + String(m).padStart(2, '0');
      if (ym < stM) continue;
      var on = !!got[ym], fut = ym >= today;
      var cls = on ? 'is-got' + (runs.run[ym] >= 3 ? ' is-streak' : '') : fut ? 'is-future' : 'is-miss';
      cells += on
        ? '<button type="button" class="bdg-m ' + cls + '" data-bdg-m="' + ym + '" aria-label="' + esc(m + '월 월간 배지 — 누르면 그달 화면') + '"><span aria-hidden="true">🏅</span><small>' + m + '월</small></button>'
        : '<span class="bdg-m ' + cls + '" aria-label="' + esc(m + '월' + (fut ? ' (아직)' : '')) + '"><span aria-hidden="true">🏅</span><small>' + m + '월</small></span>';
    }
    return { html: cells, best: runs.best };
  }
  function yearsOf(v) {
    var lastY = +String(v.today || '').slice(0, 4) || new Date().getFullYear();
    var g = gridStart(v), ms = (v.months || []).slice().sort(), fy = +g.slice(0, 4) || lastY;
    if (ms.length && +ms[0].slice(0, 4) < fy) fy = +ms[0].slice(0, 4);     /* 받은 월간 배지가 더 앞이면 그해도 */
    return { first: Math.min(fy, lastY), last: lastY };
  }
  /* opt.noTitle — 바깥(접는 칸)에 이미 「🏅 내 배지」 제목이 있을 때 · opt.note — 제목 옆 작은 글 */
  function boxHtml(v, year, opt) {
    opt = opt || {};
    if (!v) return '';
    var Y = yearsOf(v), y = Math.max(Y.first, Math.min(Y.last, year || Y.last));
    var cur = curMon(v), cw = weekMap(v)[cur];
    var nowOn = cur >= monOf(startOf(v)) && !(cw && cw.perfect);          /* 이번 주 아직 배지 전 — 「이번 주 진행 중」 */
    var best = bestRun(v), mc = monthCellsHtml(v, y), nm = (v.months || []).length;
    var none = !num(v.perfect) && !nm;
    return '<div class="card bdg" data-bdg-year="' + y + '">' +
      (opt.noTitle ? '' : '<h2 class="card-title">🏅 내 배지' + (opt.note ? '<span class="card-note">' + esc(opt.note) + '</span>' : '') + '</h2>') +
      '<div class="bdg-year"><button type="button" class="bdg-y" data-bdg-y="-1"' + (y <= Y.first ? ' disabled' : '') + ' aria-label="지난해">◀</button><b class="num">' + y + '년</b>' +
        '<button type="button" class="bdg-y" data-bdg-y="1"' + (y >= Y.last ? ' disabled' : '') + ' aria-label="다음 해">▶</button></div>' +
      '<section class="bdg-sec bdg-sec--w"><h3 class="bdg-h">주간 배지</h3>' +
        '<p class="bdg-sum"><b>⭐ 주간 배지 <span class="num">' + num(v.perfect) + '개</span></b>' +
          (best >= 2 ? ' <span class="bdg-dot">·</span> <span>최장 연속 <b class="num">' + best + '주</b></span>' : '') +
          (nowOn && y === Y.last ? ' <span class="bdg-wrun">이번 주 진행 중</span>' : '') + '</p>' +
        weekGridHtml(v, y) +
        '<p class="bdg-info" data-bdg-info hidden></p>' +
      '</section>' +
      '<section class="bdg-sec bdg-sec--m"><h3 class="bdg-h">월간 배지</h3>' +
        '<p class="bdg-sum"><b>🏅 월간 배지 <span class="num">' + nm + '개</span></b>' +
          (mc.best >= 2 ? ' <span class="bdg-dot">·</span> <span>최장 연속 <b class="num">' + mc.best + '개월</b></span>' : '') + '</p>' +
        (mc.html ? '<div class="bdg-months">' + mc.html + '</div>' : '') +
      '</section>' +
      (none ? '<p class="bdg-hint">한 주 과제를 모두 내면 주간 배지, 한 달 제출률이 높으면 월간 배지를 받아요</p>' : '') +
    '</div>';
  }
  function nowHtml(v) {
    if (!v || !v.cur) return '';
    return '<button type="button" class="bdg-now" data-bdg-m="' + esc(v.cur) + '">🏅 ' + (+v.cur.slice(5, 7)) + '월 월간 배지</button>';
  }
  /* 한 곳에 붙이고 ◀ ▶ · 주 칸 · 달 누르기를 맡는다 — onMonth(ym) 는 그달 화면 열기 */
  function mount(host, v, onMonth, opt) {
    if (!host) return;
    var year = 0;
    function paint() { host.innerHTML = (opt && opt.noNow ? '' : nowHtml(v)) + boxHtml(v, year, opt); }
    paint();
    host.onclick = function (e) {
      var yb = e.target.closest('[data-bdg-y]');
      if (yb && !yb.disabled) { year = (year || yearsOf(v).last) + (+yb.dataset.bdgY); paint(); return; }
      var mb = e.target.closest('[data-bdg-m]');
      if (mb && onMonth) { onMonth(mb.dataset.bdgM); return; }
      var sb = e.target.closest('[data-bdg-k]');
      if (sb) {
        var k = sb.dataset.bdgK, w = weekMap(v)[k], cur = monOf(v.today) || monOf(isoOf(new Date())), info = host.querySelector('[data-bdg-info]');
        if (info) { info.hidden = false; info.textContent = weekInfo(k, w, weekState(w, k, cur)); }
        Array.prototype.forEach.call(host.querySelectorAll('[data-bdg-k]'), function (b) { b.classList.toggle('is-pick', b === sb); });
      }
    };
  }
  /* 접는 칸 제목 옆 요약 — 「주간 6 · 월간 2」 */
  function sumText(v) {
    if (!v) return '';
    return '⭐ 주간 ' + num(v.perfect) + ' · 🏅 월간 ' + (v.months || []).length;
  }
  /* 코치룸 한 줄 — 「⭐ 주간 배지 6개 · 🏅 월간 배지 2개(10월 · 9월) · 3주 연속」 */
  function lineText(v) {
    if (!v) return '';
    var ms = (v.months || []).slice().reverse().map(function (m) { return (+m.slice(5, 7)) + '월'; });
    var wr = weekRun(v.weeks || []);
    return '⭐ 주간 배지 ' + num(v.perfect) + '개 · 🏅 월간 배지 ' + ms.length + '개' + (ms.length ? '(' + ms.slice(0, 3).join(' · ') + (ms.length > 3 ? ' …' : '') + ')' : '') + (wr >= 3 ? ' · ' + wr + '주 연속' : '');
  }
  global.BadgeView = { html: boxHtml, nowHtml: nowHtml, mount: mount, lineText: lineText, sumText: sumText, monthRuns: monthRuns, weekRun: weekRun, bestRun: bestRun, gridStart: gridStart };
})(window);
