/* ============================================================
   share.js — 러닝노트 「공유하기」 (20261110k)

   어디에 — 홈 프로필 카드 오른쪽 위 공유 아이콘 · 레포트 탭 맨 위 「주간 레포트」 줄 끝 (코치룸 미리보기에는 없음)
   누르면 버튼 두 개
     🔗 링크로 공유 (나·가족에게) — 지금 화면의 개인 링크(학생 링크면 학생 링크 · 학부모 링크면 학부모 링크)를 휴대폰 공유 창으로 바로
                                    공유 창이 없는 기기는 [링크 복사] · 「이 링크는 내 러닝노트 전체가 열려요 · 나와 가족에게만 보내 주세요」
     📸 사진으로 공유 (카톡·인스타로 자랑) — 「공유 사진」을 만들어 곧바로 휴대폰 공유 창(파일 공유)으로 · 따로 저장 단계 없음
                                    파일 공유가 안 되면(카톡 안 브라우저 · 일부 PC) [사진 저장] + 「저장한 사진을 카톡에서 보내 주세요」
                                    카톡 안에서 열었으면 「다른 브라우저로 열기」 안내도
   공유 사진에 들어가는 것 — 캐릭터 · 레벨 · 레벨 이름 · 이번 주 퀘스트 n/m(퍼펙트면 「퍼펙트 위크!」) · 연속 제출 n일
                              · 주간 · 월간 · 오답정리 · 지문장악 배지 수 · 마라톤국어 RUN 로고 · 「1일 1지문 1코칭」
     이름은 기본 첫 글자 + ○○(강○○) · [이름 보이기]를 켜면 전체 이름
     넣지 않는 것 — 점수 · 정답률 · 모의고사 · 상담 · 제출물 사진 · 개인 링크 · QR (친구가 사진으로 러닝노트에 들어올 수 없게)
     크기 — 세로 1080×1920(인스타 스토리 · 기본) · 정사각 1080×1080
   데이터는 홈(hub-home.js shareData)이 이미 가진 것만 — 새로 모으거나 서버에 보내는 것 없음
   ============================================================ */
(function (global) {
  'use strict';

  var S = { on: false, code: '', role: '', size: 'story', showName: false, file: null, url: '', key: '', job: null, texts: [] };
  var SIZES = { story: { w: 1080, h: 1920, label: '세로 (스토리)' }, square: { w: 1080, h: 1080, label: '정사각' } };
  var FONT = "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif";
  var LINK_NOTE = { student: '이 링크는 내 러닝노트 전체가 열려요 · 나와 가족에게만 보내 주세요', parent: '이 링크는 러닝노트 전체가 열려요 · 가족에게만 보내 주세요' };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(s) { return global.document.querySelector(s); }
  function nav() { return global.navigator || {}; }
  function inKakao() { return /KAKAOTALK/i.test(nav().userAgent || ''); }
  function isParent() { return S.role === 'parent'; }

  /* ---------- 이름 가리기 — 첫 글자 + ○○ ---------- */
  function maskName(name) {
    name = String(name || '').trim();
    if (!name) return '';
    return Array.from(name)[0] + '○○';
  }

  /* ---------- 지금 화면의 개인 링크 (학부모 링크로 열었으면 학부모 링크 — 주소에 있는 코드 그대로) ---------- */
  function linkUrl() {
    var L = global.location, h = (L.hash || '').replace(/^#/, '');
    if (h.split('/')[0] !== S.code) h = S.code + '/home';
    return L.origin + L.pathname + '#' + h;
  }

  /* ---------- 공유 사진에 쓰는 값 — 홈이 가진 값 중 허락된 것만 골라 담는다 ---------- */
  function cardData(src, showName) {
    src = src || {};
    var q = src.quest, b = src.badges || {}, ch = src.char || {}, lv = src.level || {};
    var n = function (v) { v = +v; return isFinite(v) && v > 0 ? Math.floor(v) : 0; };
    return {
      name: showName ? String(src.name || '') : maskName(src.name),
      char: { src: String(ch.src || ''), prop: ch.mascot ? '' : String(ch.prop || ''), ring: /^#[0-9A-Fa-f]{3,8}$/.test(ch.ring || '') ? ch.ring : '#7C6CF0', name: String(ch.name || '') },
      level: { n: n(lv.n) || 1, name: String(lv.name || ''), icon: String(lv.icon || '🏃') },
      quest: q && q.m > 0 ? { done: n(q.done), m: n(q.m), perfect: !!q.perfect } : null,
      streak: n(src.streak),
      badges: { weekly: n(b.weekly), monthly: n(b.monthly), wrong: n(b.wrong), text: n(b.text) }
    };
  }

  /* ============================================================
     그리기
     ============================================================ */
  function loadImg(src) {
    return new Promise(function (ok) {
      if (!src) { ok(null); return; }
      var im = new global.Image(), done = false;
      var fin = function (v) { if (!done) { done = true; ok(v); } };
      im.onload = function () { fin(im); };
      im.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 4000);
      im.src = src;
    });
  }
  function fontsReady(texts) {
    var F = global.document.fonts;
    if (!F || !F.load) return Promise.resolve();
    var t = texts.join('');
    return Promise.race([
      Promise.all(['900', '800', '600'].map(function (w) { return F.load(w + ' 40px "Pretendard Variable"', t).catch(function () {}); })),
      new Promise(function (ok) { setTimeout(ok, 1500); })
    ]);
  }
  function rr(x, c, y, w, h, r) {
    x.beginPath();
    x.moveTo(c + r, y); x.lineTo(c + w - r, y); x.quadraticCurveTo(c + w, y, c + w, y + r);
    x.lineTo(c + w, y + h - r); x.quadraticCurveTo(c + w, y + h, c + w - r, y + h);
    x.lineTo(c + r, y + h); x.quadraticCurveTo(c, y + h, c, y + h - r);
    x.lineTo(c, y + r); x.quadraticCurveTo(c, y, c + r, y); x.closePath();
  }
  /* 글자 — 그린 글은 S.texts 에 남긴다(시험이 「금지 정보 없음」을 본다) · 넓이가 넘치면 줄여서 */
  function T(x, s, px, cx, y, o) {
    o = o || {};
    s = String(s);
    S.texts.push(s);
    var size = px;
    x.font = (o.w || 800) + ' ' + size + 'px ' + FONT;
    if (o.max && x.measureText) { while (size > 18 && x.measureText(s).width > o.max) { size -= 2; x.font = (o.w || 800) + ' ' + size + 'px ' + FONT; } }
    x.textAlign = o.align || 'center';
    x.textBaseline = o.base || 'alphabetic';
    if (o.glow) { x.shadowColor = o.glow; x.shadowBlur = o.blur || 28; }
    x.fillStyle = o.color || '#fff';
    x.fillText(s, cx, y);
    x.shadowBlur = 0; x.shadowColor = 'transparent';
  }
  function background(x, W, H) {
    var g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#5B42D6'); g.addColorStop(.6, '#3B2A9E'); g.addColorStop(1, '#2A1F73');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    var r1 = x.createRadialGradient(W * .88, H * .06, 0, W * .88, H * .06, W * .7);
    r1.addColorStop(0, 'rgba(255,214,110,.34)'); r1.addColorStop(1, 'rgba(255,214,110,0)');
    x.fillStyle = r1; x.fillRect(0, 0, W, H);
    var r2 = x.createRadialGradient(W * .06, H * .96, 0, W * .06, H * .96, W * .75);
    r2.addColorStop(0, 'rgba(120,200,255,.26)'); r2.addColorStop(1, 'rgba(120,200,255,0)');
    x.fillStyle = r2; x.fillRect(0, 0, W, H);
    /* 빗살 무늬 (홈 프로필 카드와 같은 결) */
    x.save(); x.strokeStyle = 'rgba(255,255,255,.045)'; x.lineWidth = 5;
    for (var i = -H; i < W; i += 36) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke(); }
    x.restore();
    /* 아래쪽 트랙 레인 */
    x.save(); x.lineWidth = 6;
    for (var k = 0; k < 5; k++) {
      x.strokeStyle = 'rgba(255,255,255,' + (0.10 - k * 0.015) + ')';
      x.beginPath(); x.ellipse(W / 2, H + 40, W * (0.62 + k * 0.12), H * (0.16 + k * 0.035), 0, Math.PI, 2 * Math.PI); x.stroke();
    }
    x.restore();
  }
  /* RUN 로고를 흰색으로 */
  function whiteLogo(img) {
    if (!img) return null;
    var c = global.document.createElement('canvas');
    c.width = img.naturalWidth || img.width || 210; c.height = img.naturalHeight || img.height || 120;
    var x = c.getContext && c.getContext('2d');
    if (!x) return null;
    x.drawImage(img, 0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function avatar(x, cx, cy, r, d, img, prop) {
    /* 빛 */
    var gl = x.createRadialGradient(cx, cy, r * .6, cx, cy, r * 1.35);
    gl.addColorStop(0, 'rgba(245,200,66,.38)'); gl.addColorStop(1, 'rgba(245,200,66,0)');
    x.fillStyle = gl; x.beginPath(); x.arc(cx, cy, r * 1.35, 0, Math.PI * 2); x.fill();
    /* 테두리 색 고리 + 안쪽 밝은 원 */
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = d.char.ring; x.fill();
    var inn = x.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r * .92);
    inn.addColorStop(0, '#FFFFFF'); inn.addColorStop(1, '#E6E0FF');
    x.beginPath(); x.arc(cx, cy, r * .9, 0, Math.PI * 2); x.fillStyle = inn; x.fill();
    x.save(); x.beginPath(); x.arc(cx, cy, r * .9, 0, Math.PI * 2); x.clip();
    if (img) x.drawImage(img, cx - r * .86, cy - r * .86, r * 1.72, r * 1.72);
    else T(x, '🏃', r, cx, cy + r * .35, {});
    if (prop) x.drawImage(prop, cx - r * .86, cy - r * .86, r * 1.72, r * 1.72);
    x.restore();
    x.lineWidth = Math.max(4, r * .04); x.strokeStyle = 'rgba(255,255,255,.65)';
    x.beginPath(); x.arc(cx, cy, r * .9, 0, Math.PI * 2); x.stroke();
  }
  function pill(x, cx, y, h, text, px, o) {
    o = o || {};
    x.font = '900 ' + px + 'px ' + FONT;
    var w = (x.measureText ? x.measureText(text).width : text.length * px * .6) + h * .9;
    var left = o.align === 'left' ? cx : cx - w / 2;
    rr(x, left, y, w, h, h / 2);
    x.fillStyle = o.bg || 'rgba(255,255,255,.14)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = o.line || 'rgba(255,255,255,.28)'; x.stroke();
    T(x, text, px, left + w / 2, y + h / 2 + px * .36, { w: 900, color: o.color || '#fff' });
    return w;
  }
  function questBox(x, L, y, W, H, d, big) {
    rr(x, L, y, W, H, 36);
    x.fillStyle = d.quest && d.quest.perfect ? 'rgba(245,200,66,.18)' : 'rgba(255,255,255,.11)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = d.quest && d.quest.perfect ? 'rgba(245,200,66,.7)' : 'rgba(255,255,255,.22)'; x.stroke();
    var cx = L + W / 2;
    if (!d.quest) {
      T(x, '이번 주 퀘스트', big * .42, cx, y + H * .36, { w: 800, color: 'rgba(255,255,255,.85)' });
      T(x, '준비 완료! 🏁', big * .7, cx, y + H * .74, { w: 900, color: '#F5C842' });
      return;
    }
    var q = d.quest;
    if (q.perfect) {
      T(x, '★ 퍼펙트 위크! ★', big, cx, y + H * .5, { w: 900, color: '#F5C842', glow: 'rgba(245,200,66,.75)', blur: 34, max: W - 60 });
      T(x, '이번 주 퀘스트 ' + q.done + '/' + q.m + ' 완료', big * .38, cx, y + H * .82, { w: 800, color: '#fff' });
      return;
    }
    T(x, '이번 주 퀘스트', big * .38, cx, y + H * .3, { w: 800, color: 'rgba(255,255,255,.85)' });
    T(x, q.done + '/' + q.m + ' 완료', big, cx, y + H * .66, { w: 900, color: '#F5C842' });
    /* 막대 */
    var bw = W - 120, bx = L + 60, by = y + H * .78, bh = Math.max(16, H * .07);
    rr(x, bx, by, bw, bh, bh / 2); x.fillStyle = 'rgba(255,255,255,.16)'; x.fill();
    var p = Math.max(0, Math.min(1, q.done / q.m));
    if (p > 0) {
      var gg = x.createLinearGradient(bx, 0, bx + bw, 0); gg.addColorStop(0, '#F5C842'); gg.addColorStop(1, '#FF9F6B');
      rr(x, bx, by, Math.max(bh, bw * p), bh, bh / 2); x.fillStyle = gg; x.fill();
    }
  }
  function stats(x, L, y, W, H, d) {
    var b = d.badges;
    var list = [['🔥', d.streak + '일', '연속 제출'], ['⭐', b.weekly, '주간 배지'], ['🏅', b.monthly, '월간 배지'], ['📝', b.wrong, '오답정리왕'], ['🔍', b.text, '지문장악왕']];
    var gap = 16, tw = (W - gap * (list.length - 1)) / list.length;
    list.forEach(function (s, i) {
      var tx = L + i * (tw + gap);
      rr(x, tx, y, tw, H, 28); x.fillStyle = 'rgba(255,255,255,.12)'; x.fill();
      x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.2)'; x.stroke();
      T(x, s[0], H * .24, tx + tw / 2, y + H * .32, {});
      T(x, String(s[1]), H * .25, tx + tw / 2, y + H * .64, { w: 900, color: '#fff', max: tw - 16 });
      T(x, s[2], H * .12, tx + tw / 2, y + H * .86, { w: 700, color: 'rgba(255,255,255,.78)', max: tw - 12 });
    });
  }
  function footer(x, W, y, px) {
    T(x, '1일 1지문 1코칭', px, W / 2, y, { w: 900, color: '#fff' });
    T(x, '마라톤국어 러닝노트', px * .55, W / 2, y + px * .95, { w: 700, color: 'rgba(255,255,255,.7)' });
  }

  /* 한 장 그리기 — canvas 를 돌려준다 */
  function draw(d, size, imgs) {
    S.texts = [];
    var Z = SIZES[size] || SIZES.story, W = Z.w, H = Z.h;
    var c = global.document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext && c.getContext('2d');
    if (!x) return null;
    background(x, W, H);
    var lvText = d.level.icon + ' Lv.' + d.level.n + (d.level.name ? ' · ' + d.level.name : '');
    if (size === 'square') {
      if (imgs.logo) x.drawImage(imgs.logo, 70, 56, 126, 72); else T(x, 'RUN', 60, 130, 116, { w: 900 });
      x.font = '900 28px ' + FONT;
      var sw = (x.measureText ? x.measureText('러닝노트').width : 116) + 52;
      pill(x, W - 70 - sw, 64, 58, '러닝노트', 28, { align: 'left' });
      avatar(x, 290, 440, 210, d, imgs.char, imgs.prop);
      var RX = 560, RW = W - RX - 70;
      pill(x, RX, 250, 74, lvText, 36, { align: 'left', bg: 'rgba(245,200,66,.2)', line: 'rgba(245,200,66,.8)', color: '#FFE08A' });
      if (d.name) T(x, d.name, 84, RX, 410, { w: 900, align: 'left', max: RW });
      questBox(x, RX, 450, RW, 220, d, 82);
      stats(x, 70, 730, W - 140, 200, d);
      footer(x, W, 1000, 40);
    } else {
      if (imgs.logo) x.drawImage(imgs.logo, 80, 96, 168, 96); else T(x, 'RUN', 72, 160, 170, { w: 900 });
      /* 오른쪽 위 작은 표 */
      x.font = '900 34px ' + FONT;
      var pw = (x.measureText ? x.measureText('러닝노트').width : 140) + 62;
      pill(x, W - 80 - pw, 112, 66, '러닝노트', 34, { align: 'left' });
      avatar(x, W / 2, 610, 300, d, imgs.char, imgs.prop);
      pill(x, W / 2, 960, 92, lvText, 46, { bg: 'rgba(245,200,66,.2)', line: 'rgba(245,200,66,.8)', color: '#FFE08A' });
      if (d.name) T(x, d.name, 92, W / 2, 1160, { w: 900, max: W - 200 });
      questBox(x, 80, d.name ? 1210 : 1110, W - 160, 290, d, 108);
      stats(x, 80, d.name ? 1540 : 1450, W - 160, 230, d);
      footer(x, W, 1840, 50);
    }
    return c;
  }
  function propImg(svgInner) {
    if (!svgInner) return Promise.resolve(null);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">' + svgInner + '</svg>';
    return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }
  var LOGO = null;
  function logoSrc() { return (S.base || '../assets/') + 'logo.png'; }

  /* 공유 사진 만들기 → File (같은 값이면 다시 만들지 않는다) */
  function prepare() {
    var src = S.data ? S.data() : null;
    if (!src || !src.ready) return Promise.resolve(null);
    var d = cardData(src, S.showName), key = S.size + '|' + JSON.stringify(d);
    if (S.key === key && S.file) return Promise.resolve(S.file);
    if (S.job && S.job.key === key) return S.job.p;
    var p = Promise.all([loadImg(d.char.src), propImg(d.char.prop), LOGO ? Promise.resolve(LOGO) : loadImg(logoSrc()).then(function (im) { LOGO = whiteLogo(im); return LOGO; })])
      .then(function (a) {
        var texts = ['1일 1지문 1코칭 마라톤국어 러닝노트 이번 주 퀘스트 퍼펙트 위크 완료 연속 제출 주간 월간 배지 오답정리왕 지문장악왕 준비', d.name, d.level.name];
        return fontsReady(texts).then(function () { return draw(d, S.size, { char: a[0], prop: a[1], logo: a[2] }); });
      })
      .then(function (c) {
        if (!c) return null;
        return new Promise(function (ok) {
          var fin = function (blob) {
            if (!blob) { ok(null); return; }
            var name = 'marathon-run-' + (S.size === 'square' ? 'square' : 'story') + '.jpg';
            var f;
            try { f = new global.File([blob], name, { type: 'image/jpeg' }); } catch (e) { f = blob; f.name = name; }
            ok(f);
          };
          if (c.toBlob) c.toBlob(fin, 'image/jpeg', 0.92); else fin(null);
        });
      })
      .then(function (f) {
        if (S.job && S.job.key === key) S.job = null;
        if (f) { S.key = key; S.file = f; if (S.url) { try { global.URL.revokeObjectURL(S.url); } catch (e) {} } S.url = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(f) : ''; }
        return f;
      }, function () { S.job = null; return null; });
    S.job = { key: key, p: p };
    return p;
  }

  /* ============================================================
     공유 창
     ============================================================ */
  function canShareFile(f) {
    var n = nav();
    if (!f || inKakao() || typeof n.share !== 'function' || typeof n.canShare !== 'function') return false;
    try { return !!n.canShare({ files: [f] }); } catch (e) { return false; }
  }
  function btnHtml(where) {
    if (!S.on) return '';
    return '<button type="button" class="sh-open sh-open--' + (where === 'report' ? 'report' : 'home') + '" data-sh-open aria-label="공유하기" title="공유하기">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>';
  }
  function sheetHtml() {
    return '<div class="sh-sheet" role="dialog" aria-modal="true" aria-label="공유하기">' +
      '<div class="sh-h"><b>공유하기</b><button type="button" class="sh-x" data-sh-x aria-label="닫기">✕</button></div>' +
      '<button type="button" class="sh-big" data-sh-link><span class="sh-big__t"><b>🔗 링크로 공유</b><small>나·가족에게</small></span><span class="sh-go" aria-hidden="true">›</span></button>' +
      '<p class="sh-note" id="shLinkNote">' + esc(LINK_NOTE[isParent() ? 'parent' : 'student']) + '</p>' +
      '<div class="sh-copy" id="shCopy" hidden><input class="sh-copy__in" id="shCopyIn" readonly aria-label="개인 링크" value="' + esc(linkUrl()) + '"><button type="button" class="sh-btn" data-sh-copy>링크 복사</button></div>' +
      '<button type="button" class="sh-big sh-big--photo" data-sh-photo><span class="sh-big__t"><b>📸 사진으로 공유</b><small>카톡·인스타로 자랑</small></span><span class="sh-go" aria-hidden="true">›</span></button>' +
      '<div class="sh-opts">' +
        '<span class="sh-pv" id="shPv" aria-hidden="true"><i>공유 사진<br>만드는 중…</i></span>' +
        '<div class="sh-opts__r">' +
          '<div class="sh-seg" role="group" aria-label="공유 사진 크기">' + Object.keys(SIZES).map(function (k) {
            return '<button type="button" class="sh-chip' + (S.size === k ? ' is-on' : '') + '" data-sh-size="' + k + '" aria-pressed="' + (S.size === k) + '">' + esc(SIZES[k].label) + '</button>';
          }).join('') + '</div>' +
          '<label class="sh-tog"><input type="checkbox" data-sh-name' + (S.showName ? ' checked' : '') + '> 이름 보이기</label>' +
          '<span class="sh-mini">공유 사진에는 점수·개인 링크가 들어가지 않아요</span>' +
        '</div>' +
      '</div>' +
      '<div class="sh-fb" id="shFb" hidden></div>' +
      '<p class="sh-msg" id="shMsg" role="status" aria-live="polite"></p>' +
    '</div>';
  }
  function msg(t) { var m = $('#shMsg'); if (m) m.textContent = t || ''; }
  function open() {
    if (!S.on) return;
    close();
    var dim = global.document.createElement('div');
    dim.className = 'sh-dim'; dim.id = 'shDim';
    dim.innerHTML = sheetHtml();
    global.document.body.appendChild(dim);
    var b = dim.querySelector('[data-sh-link]'); if (b && b.focus) b.focus();
    refreshPv();
  }
  function close() { var d = $('#shDim'); if (d) d.remove(); }
  function refreshPv() {
    var fb = $('#shFb'), op = $('.sh-opts');
    if (fb && fb.hidden && op) op.classList.remove('is-fb');
    var pv = $('#shPv');
    if (pv) { pv.className = 'sh-pv sh-pv--' + S.size; pv.innerHTML = '<i>공유 사진<br>만드는 중…</i>'; }
    return prepare().then(function (f) {
      var p2 = $('#shPv');
      if (!p2) return;
      if (f && S.url) p2.innerHTML = '<img src="' + esc(S.url) + '" alt="">';
      else if (!f) p2.innerHTML = '<i>' + (S.data && S.data() && !S.data().ready ? '기록을 불러오는 중…' : '만들지 못했어요') + '</i>';
    });
  }

  function shareLink() {
    var url = linkUrl(), n = nav();
    var showCopy = function () { var c = $('#shCopy'); if (c) { c.hidden = false; var i = $('#shCopyIn'); if (i) i.value = url; } };
    if (typeof n.share === 'function') {
      return Promise.resolve().then(function () { return n.share({ title: '마라톤국어 러닝노트', url: url }); })
        .then(function () { msg('보냈어요'); }, function (e) { if (e && e.name === 'AbortError') return; showCopy(); msg('공유 창을 열지 못했어요 · [링크 복사]로 보내 주세요'); });
    }
    showCopy();
    msg('');
    return Promise.resolve();
  }
  function copyLink() {
    var url = linkUrl(), n = nav();
    var fallback = function () {
      var i = $('#shCopyIn');
      try { if (i) { i.focus(); i.select(); } global.document.execCommand && global.document.execCommand('copy'); msg('링크를 복사했어요'); } catch (e) { msg('링크를 길게 눌러 복사해 주세요'); }
    };
    if (n.clipboard && n.clipboard.writeText) return n.clipboard.writeText(url).then(function () { msg('링크를 복사했어요'); }, fallback);
    fallback();
    return Promise.resolve();
  }

  /* 파일 공유가 안 되는 곳 — [사진 저장] + 「저장한 사진을 카톡에서 보내 주세요」 (카톡 안이면 「다른 브라우저로 열기」도) */
  function fallbackHtml() {
    var kk = inKakao();
    var ext = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(linkUrl());
    var name = S.file && S.file.name ? S.file.name : 'marathon-run.jpg';
    return (S.url ? '<img class="sh-fb__img sh-fb__img--' + S.size + '" src="' + esc(S.url) + '" alt="공유 사진">' : '') +
      '<a class="sh-btn sh-btn--main" data-sh-save href="' + esc(S.url || '#') + '" download="' + esc(name) + '">사진 저장</a>' +
      '<p class="sh-fb__t">저장한 사진을 카톡에서 보내 주세요</p>' +
      (kk ? '<p class="sh-fb__k">카톡 안에서 열었어요 · 사진을 길게 눌러 저장하거나, 오른쪽 위 <b>⋮ · ⋯</b> → <b>다른 브라우저로 열기</b> 를 눌러 주세요</p>' +
            '<a class="sh-btn" data-sh-ext href="' + esc(ext) + '">다른 브라우저로 열기</a>' : '');
  }
  function showFallback() {
    var fb = $('#shFb');
    if (!fb) return;
    fb.innerHTML = fallbackHtml();
    fb.hidden = false;
    var o = $('.sh-opts'); if (o) o.classList.add('is-fb');
    if (fb.scrollIntoView) fb.scrollIntoView({ block: 'nearest' });
  }
  function sendFile(f) {
    var n = nav();
    if (!canShareFile(f)) { showFallback(); return Promise.resolve('fallback'); }
    return Promise.resolve().then(function () { return n.share({ files: [f], title: '마라톤국어 러닝노트' }); })
      .then(function () { msg('보냈어요'); return 'shared'; }, function (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        showFallback(); return 'fallback';
      });
  }
  function sharePhoto() {
    /* 이미 만들어 둔 사진이 있으면 누른 그 순간 바로 공유 창 (휴대폰은 누른 직후에만 공유 창을 열어 준다) */
    var src = S.data ? S.data() : null;
    if (S.file && S.key && src && S.key === S.size + '|' + JSON.stringify(cardData(src, S.showName))) return sendFile(S.file);
    msg('공유 사진을 만드는 중…');
    return refreshPv().then(function () {
      if (!S.file) { msg('공유 사진을 만들지 못했어요'); return 'none'; }
      msg('');
      return sendFile(S.file);
    });
  }

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    var D = global.document;
    D.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-sh-open]')) { e.preventDefault(); open(); return; }
      var dim = t.closest('#shDim');
      if (!dim) return;
      if (t === dim || t.closest('[data-sh-x]')) { close(); return; }
      if (t.closest('[data-sh-link]')) { shareLink(); return; }
      if (t.closest('[data-sh-copy]')) { copyLink(); return; }
      if (t.closest('[data-sh-photo]')) { sharePhoto(); return; }
      var sz = t.closest('[data-sh-size]');
      if (sz) {
        S.size = sz.getAttribute('data-sh-size') === 'square' ? 'square' : 'story';
        dim.querySelectorAll('[data-sh-size]').forEach(function (b) { var on = b.getAttribute('data-sh-size') === S.size; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
        var fb = $('#shFb'); if (fb) fb.hidden = true;
        refreshPv();
      }
    });
    D.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('#shDim [data-sh-name]')) {
        S.showName = !!e.target.checked;
        var fb = $('#shFb'); if (fb) fb.hidden = true;
        refreshPv();
      }
    });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('#shDim')) close(); });
  }

  /* hub.js 가 러닝노트를 연 뒤 한 번 — { code, role, data() → 홈 값, base } · 미리보기면 부르지 않는다 */
  function init(o) {
    o = o || {};
    S.on = !!o.code;
    S.code = o.code || '';
    S.role = o.role || '';
    S.data = o.data || null;
    S.base = o.base || '../assets/';
    S.file = null; S.key = ''; S.job = null;
    bind();
  }

  global.HubShare = {
    init: init, btnHtml: btnHtml, open: open, close: close, prepare: prepare, sharePhoto: sharePhoto, shareLink: shareLink,
    maskName: maskName, cardData: cardData, linkUrl: linkUrl, draw: draw, SIZES: SIZES,
    _state: function () { return S; }, _texts: function () { return S.texts.slice(); }
  };
})(window);
