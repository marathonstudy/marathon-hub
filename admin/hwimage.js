/* ============================================================
   hwimage.js — 반별 과제 현황 이미지 · 운영진에게 보내기 (20261031o · migration-042 · sms-send "mms")

   · 「오늘」 반 카드(과정 카드는 반별) · 레포트 발송 학생 목록 위 [과제 현황 이미지] → 미리보기 창에 세로 이미지 한 장 (가로 1080px)
       맨 위 「반 · 과제 현황 · 기간 · 10/29 20:40 기준」
       학생 줄 — 이름 · 세 기간 숫자 칩(코치룸과 같은 색: 100% 초록 · 50% 이상 파랑 · 0% 초과 주황 · 0% 빨강) · 가장 최근 기간 7칸 점
                 가장 최근 기간 적게 한 학생이 위 · 퇴원생 · 학부모 번호 · 상담 · 점수는 넣지 않는다 (자료는 Today.board)
       맨 아래 「0~1일 학생 n명: 이름… · 링크 연결 안 된 학생 n명」
   · [이미지 저장] PNG 내려받기 · [운영진에게 보내기] 운영진 체크 · 번호 직접 넣기 · 운영진으로 저장 → 사진 문자(MMS)
       JPG 로 200KB 안팎까지 줄여서 sms-send 가 솔라피에 올린 뒤 보낸다. 본문 「[마라톤국어] 반 과제 현황 · 10/29 20:40 기준」
       못 올리거나 실패하면 「이미지 저장 후 직접 보내 주세요」. 보낸 결과는 「문자 발송 → 보낸 기록」.
   · 「문자 발송 → 운영진」 — 이름 · 번호 · 역할(강사 / 조교 / 행정) 넣기 · 고치기 · 지우기 · 번호는 뒤 4자리만
   이미지는 이 기기 안에서만 만들고, 서버에는 보낼 때 솔라피로만 넘긴다 (깃허브 · DB 에 남기지 않는다).
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$;
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var W = 1080, PAD = 48, NAME_W = 268, CHIP_W = 136, ROW_H = 72, TOP = 270;
  var MAX_BYTES = 195 * 1024;              /* 솔라피 MMS 이미지 200KB 안팎 */
  var FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  var TONE = {
    ok:   { bg: '#DDF3E8', fg: '#135C3B', line: '#B5E0CB' },
    mid:  { bg: '#E2EDFD', fg: '#1A4A99', line: '#BAD1F4' },
    low:  { bg: '#FFEDD6', fg: '#874A0B', line: '#F1CC99' },
    zero: { bg: '#FCE4E9', fg: '#9E1F3B', line: '#F0B9C6' }
  };
  var ROLES = ['강사', '조교', '행정'];
  var st = { cls: '', board: null, canvas: null, stamp: '', png: '', ops: null, opsErr: '', picked: {}, sending: false, result: null, edit: '' };

  /* 10/29 20:40 (한국 시각) */
  function stampNow() {
    var d = new Date(Date.now() + 9 * 3600000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function fileStamp() {
    var d = new Date(Date.now() + 9 * 3600000);
    return String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0') + '_' + String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function titleOf(b, stamp) { return b.cls + ' · 과제 현황 · ' + (b.range ? b.range + ' · ' : '') + stamp + ' 기준'; }
  function bodyOf(b, stamp) { return '[마라톤국어] ' + b.cls + ' 과제 현황 · ' + stamp + ' 기준'; }
  function summaryOf(b) {
    return '0~1일 학생 ' + b.low.length + '명' + (b.low.length ? ': ' + b.low.join(', ') : '') + ' · 링크 연결 안 된 학생 ' + b.nolink + '명';
  }
  var STATE_TEXT = { need: '링크 연결 안 됨', wait: '불러오는 중', fail: '못 불러옴' };
  function stateText(r) { return r.state === 'need' && r.why === 'expired' ? '링크 만료' : STATE_TEXT[r.state] || ''; }

  /* ---------- 그리기 ---------- */
  function wrap(ctx, text, maxW) {
    var out = [], line = '';
    String(text).split(' ').forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    });
    if (line) out.push(line);
    return out;
  }
  function fit(ctx, text, maxW) {
    var t = String(text);
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function text(ctx, t, x, y, size, color, weight, align) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  }
  function chipX(i) { return PAD + NAME_W + i * CHIP_W; }
  function dotsX() { return chipX(3) + 20; }
  function dotW(n) { return (W - PAD - dotsX()) / Math.max(n, 7); }
  function dot(ctx, d, cx, cy) {
    var k = d.hw;
    ctx.lineWidth = 3;
    if (d.weekend) {
      rrect(ctx, cx - 10, cy - 10, 20, 20, 4);
      if (k === 'wkDone') { ctx.fillStyle = '#3A6FD8'; ctx.fill(); } else { ctx.strokeStyle = '#C9CED9'; ctx.stroke(); }
      return;
    }
    if (k === 'onTime') { ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fillStyle = '#1F8A5B'; ctx.fill(); return; }
    if (k === 'late') {
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.strokeStyle = '#D9822B'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.arc(cx, cy, 10, -Math.PI / 2, Math.PI / 2, true); ctx.closePath(); ctx.fillStyle = '#D9822B'; ctx.fill();
      return;
    }
    if (k === 'none') { ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.strokeStyle = '#C8324F'; ctx.stroke(); return; }
    if (k === 'exempt') { text(ctx, '면제', cx, cy, 18, '#8A90AC', 600, 'center'); return; }
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#D3D7E2'; ctx.fill();   /* 과제 없음 · 아직 */
  }
  var LEGEND = '● 정시  ◐ 늦게  ○ 미제출  ■ 주중 복습(토 · 일)  · 빈 점 과제 없음 / 숫자 = 제출한 날 / 과제 있던 평일 · 초록 100% · 파랑 50% 이상 · 주황 0% 초과 · 빨강 0%';

  /* 높이 먼저 — 맨 아래 요약 · 범례 줄 수에 따라 */
  function layout(ctx, b) {
    ctx.font = '600 30px ' + FONT;
    var sum = wrap(ctx, summaryOf(b), W - PAD * 2);
    ctx.font = '400 22px ' + FONT;
    var leg = wrap(ctx, LEGEND, W - PAD * 2);
    var rowsH = Math.max(1, b.rows.length) * ROW_H;
    return { sum: sum, leg: leg, h: TOP + rowsH + 40 + sum.length * 44 + 16 + leg.length * 32 + 64 };
  }
  function draw(canvas, b, stamp) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return false;
    var L = layout(ctx, b);
    canvas.width = W; canvas.height = L.h;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, L.h);
    /* 맨 위 */
    ctx.fillStyle = '#5B45D6'; ctx.fillRect(0, 0, W, 10);
    text(ctx, '마라톤국어 코치룸', PAD, 52, 24, '#7858E8', 700);
    text(ctx, fit(ctx, b.cls + ' · 과제 현황', W - PAD * 2), PAD, 106, 50, '#2C3566', 800);
    text(ctx, (b.range ? b.range + ' · ' : '') + stamp + ' 기준', PAD, 162, 30, '#6A7091', 500);
    /* 머리칸 */
    var hy = 228;
    ctx.fillStyle = '#F3F1FD'; rrect(ctx, PAD - 12, hy - 28, W - PAD * 2 + 24, 56, 12); ctx.fill();
    text(ctx, '이름', PAD + 4, hy, 24, '#4E5691', 700);
    b.heads.forEach(function (h, i) {
      if (!h) return;
      text(ctx, h.label, chipX(i) + CHIP_W / 2, hy - (h.sub ? 9 : 0), i === 1 ? 24 : 22, i === 1 ? '#2C3566' : '#4E5691', i === 1 ? 800 : 600, 'center');
      if (h.sub) text(ctx, h.sub, chipX(i) + CHIP_W / 2, hy + 14, 18, '#8A90AC', 500, 'center');
    });
    var first = b.rows.find(function (r) { return r.days.length; });
    var n = first ? first.days.length : 7, dw = dotW(n);
    if (first) first.days.forEach(function (d, j) { text(ctx, d.dow, dotsX() + dw * j + dw / 2, hy, 20, d.weekend ? '#8A90AC' : '#4E5691', 600, 'center'); });
    else text(ctx, '최근 기간 7일', dotsX() + (W - PAD - dotsX()) / 2, hy, 20, '#8A90AC', 600, 'center');
    /* 학생 줄 */
    if (!b.rows.length) text(ctx, '학생이 없습니다', W / 2, TOP + ROW_H / 2, 28, '#8A90AC', 500, 'center');
    b.rows.forEach(function (r, i) {
      var y = TOP + i * ROW_H, cy = y + ROW_H / 2;
      if (i % 2) { ctx.fillStyle = '#F8F9FD'; ctx.fillRect(PAD - 12, y, W - PAD * 2 + 24, ROW_H); }
      ctx.font = '700 32px ' + FONT;
      text(ctx, fit(ctx, r.name, NAME_W - 16), PAD + 4, cy, 32, '#333A57', 700);
      var st0 = stateText(r);
      if (st0) {
        ctx.fillStyle = '#F1F2F6'; rrect(ctx, chipX(0) + 8, cy - 22, CHIP_W * 3 - 16, 44, 22); ctx.fill();
        text(ctx, st0, chipX(0) + CHIP_W * 1.5, cy, 24, '#6A7091', 600, 'center');
      } else {
        r.vals.forEach(function (v, k) {
          var cx = chipX(k) + CHIP_W / 2;
          if (!b.heads[k]) return;
          if (!v || v.k !== 'ok') { text(ctx, !v || v.k === 'pre' ? '시작 전' : '없음', cx, cy, 22, '#A2A7BD', 500, 'center'); return; }
          var t = TONE[v.tone] || TONE.zero;
          rrect(ctx, cx - 56, cy - 24, 112, 48, 24);
          ctx.fillStyle = t.bg; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = t.line;
          if (b.heads[k].live && ctx.setLineDash) ctx.setLineDash([6, 4]);
          ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash([]);
          text(ctx, v.done + '/' + v.days, cx, cy + 1, 30, t.fg, 800, 'center');
        });
      }
      r.days.forEach(function (d, j) { dot(ctx, d, dotsX() + dw * j + dw / 2, cy); });
    });
    /* 맨 아래 — 요약 · 범례 */
    var fy = TOP + Math.max(1, b.rows.length) * ROW_H + 24;
    ctx.fillStyle = '#E2E5F0'; ctx.fillRect(PAD, fy, W - PAD * 2, 2);
    fy += 38;
    L.sum.forEach(function (t) { text(ctx, t, PAD, fy, 30, '#2C3566', 700); fy += 44; });
    fy += 4;
    L.leg.forEach(function (t) { text(ctx, t, PAD, fy, 22, '#8A90AC', 400); fy += 32; });
    return true;
  }

  /* ---------- JPG 로 줄이기 (MMS · 200KB 안팎) ---------- */
  function b64bytes(u) { var s = String(u).split(',')[1] || ''; return Math.floor(s.length * 3 / 4) - (/==$/.test(s) ? 2 : /=$/.test(s) ? 1 : 0); }
  function toJpeg(src) {
    var scale = Math.min(1, 1000 / src.width, 1500 / src.height);
    for (var round = 0; round < 6; round++) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * scale)); c.height = Math.max(1, Math.round(src.height * scale));
      var x = c.getContext && c.getContext('2d');
      if (!x) return null;
      x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(src, 0, 0, c.width, c.height);
      var qs = [0.9, 0.8, 0.7, 0.6, 0.5];
      for (var i = 0; i < qs.length; i++) {
        var u = c.toDataURL('image/jpeg', qs[i]);
        if (!/^data:image\/jpe?g;base64,/.test(u)) return null;
        var n = b64bytes(u);
        if (n <= MAX_BYTES) return { data: u.split(',')[1], bytes: n, w: c.width, h: c.height, q: qs[i] };
      }
      scale *= 0.8;
    }
    return null;
  }

  /* ---------- 미리보기 창 ---------- */
  function modal() {
    var m = $('#hwImgModal');
    if (m) return m;
    m = document.createElement('dialog');
    m.className = 'modal modal--wide hwi-modal';
    m.id = 'hwImgModal';
    m.setAttribute('aria-labelledby', 'hwImgTitle');
    m.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="hwImgTitle">과제 현황 이미지</h2><p class="modal__desc" id="hwImgDesc"></p></div>' +
      '<div class="modal__body hwi-body"><div class="hwi-pv" id="hwImgPv"></div><p class="hwi-note" id="hwImgNote" hidden></p>' +
        '<div class="hwi-acts"><button class="btn btn--primary" type="button" id="hwImgSave">이미지 저장</button>' +
          '<button class="btn" type="button" id="hwImgOpsOpen" aria-expanded="false">운영진에게 보내기</button>' +
          '<button class="btn btn--ghost" type="button" id="hwImgRedo">다시 만들기</button>' +
          '<span class="spacer"></span><button class="btn btn--ghost" type="button" id="hwImgClose">닫기</button></div>' +
        '<div class="hwi-ops" id="hwImgOps" hidden></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', onModalClick);
    m.addEventListener('change', onModalChange);
    m.addEventListener('input', onModalChange);
    return m;
  }
  function build() {
    var b = window.Today && Today.board ? Today.board(st.cls) : null;
    st.board = b;
    st.stamp = stampNow();
    st.png = '';
    var pv = $('#hwImgPv'), note = $('#hwImgNote');
    if (!b) { pv.innerHTML = '<p class="panel__hint">「오늘」 자료를 불러오는 중입니다 — 잠시 뒤 [다시 만들기]를 눌러 주세요.</p>'; $('#hwImgDesc').textContent = st.cls; return; }
    $('#hwImgDesc').textContent = titleOf(b, st.stamp);
    var c = document.createElement('canvas');
    if (!draw(c, b, st.stamp)) { st.canvas = null; pv.innerHTML = '<p class="panel__hint">이 브라우저에서는 이미지를 만들 수 없습니다.</p>'; return; }
    st.canvas = c;
    try { st.png = c.toDataURL('image/png'); } catch (e) { st.png = ''; }
    pv.innerHTML = '<img class="hwi-img" id="hwImgImg" src="' + esc(st.png) + '" width="' + c.width + '" height="' + c.height + '" alt="' + esc(titleOf(b, st.stamp) + ' — ' + summaryOf(b)) + '">';
    note.hidden = !b.waiting;
    note.textContent = b.waiting ? '아직 과제 기록을 불러오는 학생이 있습니다 — 잠시 뒤 [다시 만들기]' : '';
  }
  function open(cls) {
    if (!cls) return;
    var m = modal();
    st.cls = cls; st.result = null; st.picked = {};
    $('#hwImgOps').hidden = true;
    $('#hwImgOpsOpen').setAttribute('aria-expanded', 'false');
    $('#hwImgSave').classList.remove('is-hint');
    build();
    if (!m.open) m.showModal();
  }
  function savePng() {
    if (!st.canvas) return;
    var name = '과제현황_' + st.cls.replace(/[\\/:*?"<>|\s]+/g, '') + '_' + fileStamp() + '.png';
    var go = function (href, revoke) {
      var a = document.createElement('a');
      a.href = href; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
      if (revoke) setTimeout(function () { try { URL.revokeObjectURL(href); } catch (e) {} }, 4000);
      toast('이미지를 저장했습니다 (' + name + ')', 'good');
    };
    if (st.canvas.toBlob && window.URL && URL.createObjectURL) st.canvas.toBlob(function (bl) { if (bl) go(URL.createObjectURL(bl), true); else if (st.png) go(st.png); }, 'image/png');
    else if (st.png) go(st.png);
  }

  /* ---------- 운영진 ---------- */
  function tail4(x) { return '****' + (x.last4 || ''); }
  function loadOps(force) {
    if (st.ops && !force) return Promise.resolve(st.ops);
    return sb().rpc(force === 'import' ? 'ops_contacts_import' : 'ops_contacts_list').then(function (r) {
      if (r.error) { st.opsErr = isMissing(r.error) ? 'migration-042 SQL 을 실행하면 운영진을 넣을 수 있습니다.' : r.error.message; st.ops = null; return null; }
      st.opsErr = '';
      st.ops = (r.data && r.data.rows) || [];
      if (r.data && r.data.imported && force === 'import') toast('설정에서 ' + r.data.imported + '명을 가져왔습니다', 'good');
      else if (force === 'import') toast('새로 가져올 번호가 없습니다');
      return st.ops;
    });
  }
  function opsBox() {
    var b = st.board, list = st.ops || [], res = st.result;
    var n = list.filter(function (x) { return st.picked[x.id]; }).length + phonesTyped().length;
    var h = '<div class="sms-sec__title">운영진에게 사진 문자로 보내기</div>';
    if (st.opsErr) h += '<p class="cp-warn">' + esc(st.opsErr) + '</p>';
    else if (!list.length) h += '<p class="panel__hint">아직 운영진이 없습니다 — 아래에 번호를 직접 넣거나 <button type="button" class="linkbtn" data-hwi-go-ops>「문자 발송 → 운영진」</button>에서 넣어 주세요.</p>';
    else h += '<ul class="hwi-oplist">' + list.map(function (x) {
      return '<li><label class="hwi-op"><input type="checkbox" data-hwi-op="' + esc(x.id) + '"' + (st.picked[x.id] ? ' checked' : '') + '>' +
        '<span class="hwi-op__n">' + esc(x.name) + '</span><span class="hwi-op__r">' + esc(x.role) + '</span><span class="hwi-op__p num">' + esc(tail4(x)) + '</span></label></li>';
    }).join('') + '</ul>';
    h += '<label class="field hwi-direct"><span class="field__label">번호 직접 넣기 <span class="field__opt">여러 개는 쉼표로</span></span>' +
        '<input class="input" id="hwImgPhones" type="tel" inputmode="tel" autocomplete="off" placeholder="010-0000-0000" value="' + esc(st.typed || '') + '"></label>' +
      '<label class="hwi-save"><input type="checkbox" id="hwImgSaveOps"' + (st.saveOps ? ' checked' : '') + '> 운영진으로 저장 <small>(다음부터 위 목록에 · 이름은 「운영진 뒤 4자리」 — 「문자 발송 → 운영진」에서 고칠 수 있습니다)</small></label>' +
      '<p class="hwi-body-line"><span class="muted-note">문자 내용</span> ' + esc(b ? bodyOf(b, st.stamp) : '') + '</p>' +
      '<div class="hwi-acts"><button class="btn btn--primary" type="button" id="hwImgSend"' + (n && !st.sending && st.canvas ? '' : ' disabled') + '>' + (st.sending ? '보내는 중…' : '사진 문자 보내기' + (n ? ' (' + n + '명)' : '')) + '</button></div>' +
      '<div id="hwImgRes" role="status" aria-live="polite">' + (res ? resultHtml(res) : '') + '</div>';
    return h;
  }
  var FALLBACK = '이미지 저장 후 직접 보내 주세요';
  function resultHtml(res) {
    if (res.ok && !res.failed) return '<p class="hwi-res hwi-res--ok">✓ ' + res.sent + '명에게 보냈습니다 · 「보낸 기록」에 남겼습니다 <button type="button" class="linkbtn" data-hwi-log>보낸 기록 보기</button></p>';
    var bad = (res.results || []).filter(function (x) { return !x.ok; });
    return '<div class="hwi-res hwi-res--bad"><p><b>' + (res.sent ? res.sent + '명 보냄 · ' + bad.length + '명 실패' : esc(res.message || '보내지 못했습니다')) + '</b>' +
        (bad.length ? ' <span class="muted-note">' + esc(bad.slice(0, 6).map(function (x) { return x.name + (x.error ? ' — ' + x.error : ''); }).join(' · ')) + '</span>' : '') + '</p>' +
      '<p class="hwi-res__fb">' + FALLBACK + ' <button type="button" class="btn btn--sm btn--primary" data-hwi-savepng>이미지 저장</button></p></div>';
  }
  function phonesTyped() {
    return String(st.typed || '').split(/[,\n;]+/).map(function (x) { return x.replace(/\D/g, ''); }).filter(Boolean);
  }
  function paintOps() { var el = $('#hwImgOps'); if (el && !el.hidden) el.innerHTML = opsBox(); }
  function openOps() {
    var el = $('#hwImgOps');
    el.hidden = !el.hidden;
    $('#hwImgOpsOpen').setAttribute('aria-expanded', String(!el.hidden));
    if (el.hidden) return;
    el.innerHTML = '<p class="panel__hint">운영진 목록을 불러오는 중…</p>';
    loadOps(false).then(paintOps);
  }
  function send() {
    if (st.sending || !st.canvas || !st.board) return;
    var ops = (st.ops || []).filter(function (x) { return st.picked[x.id]; }).map(function (x) { return x.id; });
    var phones = phonesTyped();
    if (!ops.length && !phones.length) { toast('받을 사람을 골라 주세요', 'bad'); return; }
    var bad = phones.filter(function (d) { return !/^01[016789]\d{7,8}$/.test(d); });
    if (bad.length) { toast('휴대폰 번호(010…)를 확인해 주세요: …' + bad[0].slice(-4), 'bad'); return; }
    var jpg = toJpeg(st.canvas);
    var fail = function (msg) { st.sending = false; st.result = { ok: false, sent: 0, failed: 0, message: msg, results: [] }; $('#hwImgSave').classList.add('is-hint'); paintOps(); };
    if (!jpg) { fail('이미지를 200KB 안으로 줄이지 못했습니다'); return; }
    st.sending = true; st.result = null; paintOps();
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) { fail('문자 함수(sms-send)를 부를 수 없습니다'); return; }
    fns.invoke('sms-send', { body: { action: 'mms', ops: ops, phones: phones, save: !!st.saveOps, body: bodyOf(st.board, st.stamp), cls: st.cls, image: jpg.data } }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; });
      return { ok: false, message: '문자 함수(sms-send)를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) { return { ok: false, message: '문자 함수(sms-send)를 부르지 못했습니다 — ' + ((e && e.message) || '') }; }).then(function (res) {
      st.sending = false;
      res = res || { ok: false, message: '문자 함수(sms-send)가 응답하지 않았습니다' };
      if (res.reason === 'input' && /알 수 없는 요청/.test(res.message || '')) res.message = 'sms-send 함수를 새 코드로 다시 배포해 주세요 (사진 문자)';
      st.result = res;
      if (res.contacts) st.ops = res.contacts;
      if (res.ok && res.saved) { st.typed = ''; st.saveOps = false; }
      $('#hwImgSave').classList.toggle('is-hint', !(res.ok && !res.failed));
      if (res.ok) { st.picked = {}; toast(res.sent + '명에게 과제 현황 이미지를 보냈습니다' + (res.failed ? ' · 실패 ' + res.failed + '명' : ''), res.failed ? 'bad' : 'good'); }
      paintOps();
      window.dispatchEvent(new CustomEvent('jt:ops'));
    });
  }
  function onModalClick(e) {
    var t = e.target;
    if (t.closest('#hwImgClose')) { $('#hwImgModal').close(); return; }
    if (t.closest('#hwImgSave') || t.closest('[data-hwi-savepng]')) { savePng(); return; }
    if (t.closest('#hwImgRedo')) { st.result = null; build(); paintOps(); return; }
    if (t.closest('#hwImgOpsOpen')) { openOps(); return; }
    if (t.closest('#hwImgSend')) { send(); return; }
    if (t.closest('[data-hwi-log]')) { $('#hwImgModal').close(); if (window.Sms) Sms.openLog({}); return; }
    if (t.closest('[data-hwi-go-ops]')) { $('#hwImgModal').close(); if (window.Sms) Sms.showPane('ops'); return; }
  }
  function onModalChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-hwi-op')) { if (t.checked) st.picked[t.dataset.hwiOp] = true; else delete st.picked[t.dataset.hwiOp]; }
    else if (t.id === 'hwImgPhones') st.typed = t.value;
    else if (t.id === 'hwImgSaveOps') st.saveOps = t.checked;
    else return;
    var n = (st.ops || []).filter(function (x) { return st.picked[x.id]; }).length + phonesTyped().length;
    var b = $('#hwImgSend');
    if (b) { b.disabled = !n || st.sending || !st.canvas; b.textContent = st.sending ? '보내는 중…' : '사진 문자 보내기' + (n ? ' (' + n + '명)' : ''); }
  }

  /* ---------- 「문자 발송 → 운영진」 ---------- */
  function roleSel(id, v) {
    return '<select class="select" id="' + id + '" aria-label="역할">' + ROLES.map(function (r) { return '<option' + (r === (v || '조교') ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>';
  }
  function paneHtml() {
    if (st.opsErr) return '<p class="cp-warn">' + esc(st.opsErr) + '</p>';
    var list = st.ops || [];
    return (list.length ? '<ul class="ops-list">' + list.map(function (x) {
      if (st.edit === x.id) return '<li class="ops-row ops-row--edit" data-ops-id="' + esc(x.id) + '">' +
          '<input class="input" id="opsEditName" type="text" maxlength="30" aria-label="이름" value="' + esc(x.name) + '">' + roleSel('opsEditRole', x.role) +
          '<input class="input" id="opsEditPhone" type="tel" inputmode="tel" autocomplete="off" aria-label="번호 (바꿀 때만)" placeholder="번호 바꿀 때만 (지금 ' + esc(tail4(x)) + ')">' +
          '<span class="ops-row__btns"><button class="btn btn--sm btn--primary" type="button" data-ops-save>저장</button><button class="btn btn--sm" type="button" data-ops-cancel>취소</button></span></li>';
      return '<li class="ops-row" data-ops-id="' + esc(x.id) + '"><span class="ops-row__n">' + esc(x.name) + '</span><span class="ops-row__r">' + esc(x.role) + '</span><span class="ops-row__p num">' + esc(tail4(x)) + '</span>' +
        '<span class="ops-row__btns"><button class="btn btn--sm" type="button" data-ops-edit>고치기</button><button class="btn btn--sm btn--ghost" type="button" data-ops-del>지우기</button></span></li>';
    }).join('') + '</ul>' : '<p class="panel__hint">아직 운영진이 없습니다. 아래에서 넣어 주세요.</p>') +
      '<div class="ops-add"><div class="sms-sec__title">운영진 넣기</div>' +
        '<input class="input" id="opsName" type="text" maxlength="30" placeholder="이름" aria-label="이름">' + roleSel('opsRole', '조교') +
        '<input class="input" id="opsPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="010-0000-0000" aria-label="번호">' +
        '<button class="btn btn--sm btn--primary" type="button" id="opsAdd">넣기</button></div>';
  }
  function renderPane(force) {
    var host = $('#smsOps');
    if (!host) return Promise.resolve();
    if (!st.ops || force) host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    return loadOps(force).then(function () { host.innerHTML = paneHtml(); });
  }
  function saveOp(id, name, phone, role) {
    return sb().rpc('ops_contacts_save', { p_id: id || null, p_name: name, p_phone: phone, p_role: role }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? 'migration-042 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); return false; }
      st.ops = r.data.rows || [];
      st.edit = '';
      toast(id ? '운영진을 고쳤습니다' : '운영진을 넣었습니다 (' + name + ' · ' + tail4(r.data.row || {}) + ')', 'good');
      $('#smsOps').innerHTML = paneHtml();
      paintOps();
      return true;
    });
  }
  function onPaneClick(e) {
    var t = e.target, row = t.closest('[data-ops-id]'), id = row ? row.dataset.opsId : '';
    if (t.closest('#opsAdd')) {
      var nm = $('#opsName').value.trim(), ph = $('#opsPhone').value;
      if (!nm) { toast('이름을 적어 주세요', 'bad'); $('#opsName').focus(); return; }
      if (!/^01[016789]\d{7,8}$/.test(ph.replace(/\D/g, ''))) { toast('휴대폰 번호(010…)를 적어 주세요', 'bad'); $('#opsPhone').focus(); return; }
      saveOp(null, nm, ph, $('#opsRole').value);
      return;
    }
    if (t.closest('#opsImport')) { renderPane('import'); return; }
    if (t.closest('[data-ops-edit]')) { st.edit = id; $('#smsOps').innerHTML = paneHtml(); var f = $('#opsEditName'); if (f) f.focus(); return; }
    if (t.closest('[data-ops-cancel]')) { st.edit = ''; $('#smsOps').innerHTML = paneHtml(); return; }
    if (t.closest('[data-ops-save]')) {
      var en = $('#opsEditName').value.trim(), ep = $('#opsEditPhone').value;
      if (!en) { toast('이름을 적어 주세요', 'bad'); return; }
      if (ep.trim() && !/^01[016789]\d{7,8}$/.test(ep.replace(/\D/g, ''))) { toast('휴대폰 번호(010…)를 적어 주세요', 'bad'); return; }
      saveOp(id, en, ep, $('#opsEditRole').value);
      return;
    }
    if (t.closest('[data-ops-del]')) {
      var x = (st.ops || []).find(function (o) { return o.id === id; });
      if (!x) return;
      UI.confirmAsk('운영진 지우기', x.name + ' (' + x.role + ' · ' + tail4(x) + ')을 목록에서 지웁니다. 보낸 기록은 그대로 남습니다.', '지우기').then(function (y) {
        if (!y) return;
        sb().rpc('ops_contacts_delete', { p_id: id }).then(function (r) {
          if (r.error) { toast(r.error.message, 'bad'); return; }
          st.ops = r.data.rows || [];
          delete st.picked[id];
          toast('지웠습니다', 'good');
          $('#smsOps').innerHTML = paneHtml();
          paintOps();
        });
      });
    }
  }

  function init() {
    /* [과제 현황 이미지] — 「오늘」 반 카드 · 과정 카드 반 줄 · 레포트 발송 학생 목록 위 (data-hwimg = 반 이름) */
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-hwimg]');
      if (!b || b.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      open(b.getAttribute('data-hwimg'));
    }, true);
    var host = $('#smsPaneOps');
    if (host) host.addEventListener('click', onPaneClick);
    window.addEventListener('jt:ops', function () { var p = $('#smsPaneOps'); if (p && !p.hidden && $('#smsOps')) $('#smsOps').innerHTML = paneHtml(); });
  }
  init();

  window.HwImage = {
    open: open, renderPane: renderPane, draw: draw, toJpeg: toJpeg,
    state: function () { return st; },
    title: function () { return st.board ? titleOf(st.board, st.stamp) : ''; },
    body: function () { return st.board ? bodyOf(st.board, st.stamp) : ''; },
    summary: function () { return st.board ? summaryOf(st.board) : ''; }
  };
})();
