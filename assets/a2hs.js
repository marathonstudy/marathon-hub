/* ============================================================
   a2hs.js — 홈 화면에 추가 (러닝노트 /s/ · /me/ · 코치룸 /admin/ · 20261101k)

   1. 띠 — 휴대폰에서 로그인한 직후 첫 화면 맨 위
        「📱 홈 화면에 추가하면 앱처럼 바로 열려요 [추가하기] [다음에]」
      보이지 않는 때: PC · 이미 홈 화면 앱으로 열었음 · [다음에] 뒤 7일 · [다음에]를 세 번 누름
      기록은 이 기기에만 (localStorage · 러닝노트와 코치룸 따로)
   2. [추가하기]
        카카오톡 안 — 「다른 브라우저로 열기」 먼저 (아이폰 · 안드로이드 모두) · 주소 복사
        안드로이드 크롬 · 삼성 인터넷 — 바로 설치 창 (beforeinstallprompt)
          바로 안 되면 「오른쪽 위 ⋮ → 홈 화면에 추가」(삼성 인터넷은 「아래 ≡ → 현재 페이지 추가 → 홈 화면」) 그림
        아이폰 사파리 — 「아래 공유 버튼(□↑) → 홈 화면에 추가 → 추가」 3단계 그림
        아이폰 다른 브라우저 — 「사파리로 열어 주세요」 · 주소 복사
   3. 「홈 화면에 추가하는 법」 — 러닝노트 내 정보 · 코치룸 더보기에서 언제든 (PC 에서는 휴대폰별 방법을 모두)
   서비스워커(../sw.js · admin/sw.js)는 화면을 저장하지 않는다 — 인터넷이 끊겼을 때 안내 한 장만
   ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;
  var WEEK = 7 * 24 * 3600 * 1000;
  var deferred = null;                 /* 안드로이드 바로 설치 (beforeinstallprompt) */
  var envOver = null;                  /* 시험용 */

  global.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; });
  global.addEventListener('appinstalled', function () { deferred = null; removeBand(); });
  /* 「홈 화면에 추가하는 법」 버튼 어디서나 — data-a2hs-how="hub" | "coach" */
  doc.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-a2hs-how]');
    if (b) how(b.getAttribute('data-a2hs-how') || 'hub');
  });

  /* ---------- 기기 · 브라우저 ---------- */
  function env() {
    if (envOver) return envOver;
    var nav = global.navigator || {};
    var ua = String(nav.userAgent || '');
    var ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
    var android = /Android/i.test(ua);
    var standalone = nav.standalone === true;
    try { standalone = standalone || !!(global.matchMedia && (global.matchMedia('(display-mode: standalone)').matches || global.matchMedia('(display-mode: fullscreen)').matches)); } catch (e) {}
    return {
      ios: ios, android: android, mobile: ios || android, standalone: standalone,
      kakao: /KAKAOTALK/i.test(ua),
      samsung: /SamsungBrowser/i.test(ua),
      safari: ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|Whale|GSA\//i.test(ua)
    };
  }

  /* ---------- [다음에] 기록 { until, n } ---------- */
  function keyOf(app) { return ((global.CONFIG && global.CONFIG.storagePrefix) || 'mhub.') + 'a2hs.' + (app || 'hub'); }
  function readSkip(app) {
    try { var v = JSON.parse(global.localStorage.getItem(keyOf(app)) || 'null'); return v && typeof v === 'object' ? v : { until: 0, n: 0 }; } catch (e) { return { until: 0, n: 0 }; }
  }
  function later(app) {
    var v = readSkip(app);
    v.n = (v.n || 0) + 1;
    v.until = Date.now() + WEEK;
    try { global.localStorage.setItem(keyOf(app), JSON.stringify(v)); } catch (e) {}
    return v;
  }
  /* 띠를 보여 줄까 — 휴대폰 · 앱으로 연 게 아님 · 7일 숨김 아님 · 세 번 안 넘음 */
  function shouldShow(app) {
    var e = env();
    if (!e.mobile || e.standalone) return false;
    var v = readSkip(app);
    if ((v.n || 0) >= 3) return false;
    return !(v.until && Date.now() < v.until);
  }

  /* ---------- 모양 (한 번만 넣는다 · 러닝노트 · 코치룸 어디서나 같게) ---------- */
  function style() {
    if (doc.getElementById('a2hsStyle')) return;
    var s = doc.createElement('style');
    s.id = 'a2hsStyle';
    s.textContent =
      '.a2hs-band{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#F1EEFD;color:#2B2550;font-size:14px;line-height:1.4}' +
      '.a2hs-band__t{flex:1 1 180px}' +
      '.a2hs-band button,.a2hs-sheet button,.a2hs-sheet a.a2hs-btn{appearance:none;border:0;font:inherit;cursor:pointer;border-radius:10px;padding:8px 12px;font-weight:700;text-decoration:none;display:inline-block}' +
      '.a2hs-band__go,.a2hs-btn--go{background:#7858E8;color:#fff}' +
      '.a2hs-band__later,.a2hs-btn{background:#fff;color:#4B4380;border:1px solid #D9D3F5 !important}' +
      '.a2hs-dim{position:fixed;inset:0;background:rgba(20,16,40,.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center}' +
      '.a2hs-sheet{background:#fff;color:#222;width:100%;max-width:480px;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;padding:18px 16px 22px;box-sizing:border-box;font-size:15px;line-height:1.5}' +
      '.a2hs-sheet h3{margin:0 0 10px;font-size:17px}' +
      '.a2hs-sheet h4{margin:14px 0 6px;font-size:15px}' +
      '.a2hs-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}' +
      '.a2hs-steps li{display:flex;align-items:center;gap:12px;padding:10px;border-radius:12px;background:#F7F6FC}' +
      '.a2hs-steps .a2hs-n{flex:0 0 24px;height:24px;border-radius:50%;background:#7858E8;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}' +
      '.a2hs-steps svg{flex:0 0 44px;width:44px;height:44px}' +
      '.a2hs-note{margin:10px 0 0;color:#666;font-size:13px}' +
      '.a2hs-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}' +
      '.a2hs-close{float:right;background:transparent !important;color:#666 !important;padding:2px 6px !important;font-size:20px !important}';
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ---------- 그림 (작은 SVG — 실제 버튼 모양) ---------- */
  var P = 'fill="none" stroke="#7858E8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
  var PIC = {
    share: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><path ' + P + ' d="M15 19h-2v14h18V19h-2M22 10v15M17 15l5-5 5 5"/></svg>',
    add: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><rect x="12" y="12" width="20" height="20" rx="5" ' + P + '/><path ' + P + ' d="M22 17v10M17 22h10"/></svg>',
    ok: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#7858E8"/><text x="22" y="27" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">추가</text></svg>',
    dots: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><circle cx="22" cy="14" r="2.6" fill="#7858E8"/><circle cx="22" cy="22" r="2.6" fill="#7858E8"/><circle cx="22" cy="30" r="2.6" fill="#7858E8"/></svg>',
    menu: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><path ' + P + ' d="M13 15h18M13 22h18M13 29h18"/></svg>',
    home: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><rect x="13" y="9" width="18" height="26" rx="4" ' + P + '/><path ' + P + ' d="M19 30h6"/></svg>',
    out: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><path ' + P + ' d="M19 13h-6v18h18v-6M24 13h7v7M31 13l-11 11"/></svg>',
    safari: '<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="10" fill="#fff" stroke="#D9D3F5"/><circle cx="22" cy="22" r="11" ' + P + '/><path fill="#7858E8" d="M27 17l-3 7-7 3 3-7z"/></svg>'
  };
  function steps(list) {
    return '<ol class="a2hs-steps">' + list.map(function (x, i) {
      return '<li><span class="a2hs-n">' + (i + 1) + '</span>' + PIC[x[0]] + '<span>' + x[1] + '</span></li>';
    }).join('') + '</ol>';
  }
  var IOS = [['share', '아래쪽 <b>공유 버튼 (□↑)</b>을 눌러요'], ['add', '목록을 내려 <b>홈 화면에 추가</b>를 눌러요'], ['ok', '오른쪽 위 <b>추가</b>를 누르면 끝!']];
  var CHROME = [['dots', '오른쪽 위 <b>⋮</b>를 눌러요'], ['add', '<b>홈 화면에 추가</b> (또는 <b>앱 설치</b>)를 눌러요'], ['ok', '<b>추가</b> · <b>설치</b>를 누르면 끝!']];
  var SAMSUNG = [['menu', '아래쪽 <b>≡ 메뉴</b>를 눌러요'], ['add', '<b>현재 페이지 추가</b>를 눌러요'], ['home', '<b>홈 화면</b>을 고르면 끝!']];
  var KAKAO = [['dots', '오른쪽 아래(또는 위) <b>⋮ · ⋯</b>를 눌러요'], ['out', '<b>다른 브라우저로 열기</b> (아이폰은 <b>Safari로 열기</b>)'], ['home', '열린 화면에서 다시 <b>[추가하기]</b>']];

  /* ---------- 안내 창 ---------- */
  function closeSheet() { var d = doc.getElementById('a2hsDim'); if (d) d.remove(); }
  function sheet(title, body, buttons) {
    style();
    closeSheet();
    var d = doc.createElement('div');
    d.className = 'a2hs-dim'; d.id = 'a2hsDim';
    d.innerHTML = '<div class="a2hs-sheet" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '<button type="button" class="a2hs-close" data-a2hs-close aria-label="닫기">×</button><h3>' + title + '</h3>' + body +
      '<div class="a2hs-row">' + (buttons || '') + '<button type="button" class="a2hs-btn" data-a2hs-close>닫기</button></div></div>';
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-a2hs-close]')) { closeSheet(); return; }
      var cp = e.target.closest('[data-a2hs-copy]');
      if (cp) copyUrl(cp);
    });
    doc.body.appendChild(d);
    return d;
  }
  function here() { return String(global.location.href || '').replace(/[?&]app=1\b/, ''); }
  function copyUrl(btn) {
    var url = here();
    var done = function () { btn.textContent = '주소를 복사했어요'; };
    try {
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) { global.navigator.clipboard.writeText(url).then(done, done); return; }
    } catch (e) {}
    try { var t = doc.createElement('textarea'); t.value = url; doc.body.appendChild(t); t.select(); doc.execCommand('copy'); t.remove(); } catch (e) {}
    done();
  }
  var COPY = '<button type="button" class="a2hs-btn" data-a2hs-copy>주소 복사</button>';

  function kakaoSheet() {
    var open = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(here());
    return sheet('카카오톡 밖에서 열어 주세요',
      '<p>카카오톡 안에서는 홈 화면에 추가할 수 없어요. 먼저 다른 브라우저로 연 다음 다시 <b>[추가하기]</b>를 눌러 주세요.</p>' + steps(KAKAO),
      '<a class="a2hs-btn a2hs-btn--go" href="' + open + '" data-a2hs-out>다른 브라우저로 열기</a>' + COPY);
  }
  function iosSheet() { return sheet('아이폰 홈 화면에 추가', steps(IOS) + '<p class="a2hs-note">사파리(Safari)에서만 할 수 있어요.</p>'); }
  function iosOther() {
    return sheet('사파리로 열어 주세요',
      '<p>아이폰은 <b>사파리(Safari)</b>에서만 홈 화면에 추가할 수 있어요. 주소를 복사해 사파리 주소창에 붙여 넣은 뒤 다시 <b>[추가하기]</b>를 눌러 주세요.</p>' +
      steps([['safari', '<b>사파리</b>를 열고 주소창에 붙여 넣기'], ['share', '아래쪽 <b>공유 버튼 (□↑)</b>'], ['add', '<b>홈 화면에 추가</b> → <b>추가</b>']]), COPY);
  }
  function androidSheet(e) {
    return e.samsung ? sheet('홈 화면에 추가 (삼성 인터넷)', steps(SAMSUNG)) : sheet('홈 화면에 추가', steps(CHROME) + '<p class="a2hs-note">삼성 인터넷은 아래쪽 ≡ 메뉴 → 현재 페이지 추가 → 홈 화면</p>');
  }
  /* PC · 「홈 화면에 추가하는 법」 — 휴대폰별 방법 모두 */
  function allSheet() {
    return sheet('홈 화면에 추가하는 법',
      '<h4>아이폰 (사파리)</h4>' + steps(IOS) +
      '<h4>갤럭시 · 안드로이드 (크롬)</h4>' + steps(CHROME) +
      '<h4>갤럭시 (삼성 인터넷)</h4>' + steps(SAMSUNG) +
      '<h4>카카오톡에서 열었을 때</h4>' + steps(KAKAO));
  }

  /* [추가하기] — 지금 브라우저에 맞게. 안드로이드에서 바로 설치 창이 뜨면 'prompt' */
  function add(app) {
    var e = env();
    if (e.kakao) { kakaoSheet(); return 'kakao'; }
    if (e.android && deferred) {
      var p = deferred; deferred = null;
      try {
        p.prompt();
        if (p.userChoice && p.userChoice.then) p.userChoice.then(function (c) { if (c && c.outcome === 'accepted') removeBand(); }, function () {});
      } catch (x) { androidSheet(e); return 'android'; }
      return 'prompt';
    }
    if (e.ios) { if (e.safari) iosSheet(); else iosOther(); return e.safari ? 'ios' : 'ios-other'; }
    if (e.android) { androidSheet(e); return 'android'; }
    allSheet(); return 'all';
  }
  /* 「홈 화면에 추가하는 법」 버튼 — 휴대폰이면 그 브라우저 방법 · PC 면 모두 */
  function how(app) {
    var e = env();
    if (!e.mobile) { allSheet(); return 'all'; }
    if (e.standalone) { sheet('이미 홈 화면 앱으로 열었어요', '<p>지금 화면이 홈 화면 아이콘으로 연 앱입니다. 다른 휴대폰에 추가하려면 그 휴대폰에서 이 주소를 열어 주세요.</p>' + steps(IOS.slice(0, 1).concat(CHROME.slice(0, 1)))); return 'standalone'; }
    return add(app);
  }

  /* ---------- 띠 ---------- */
  function removeBand() { var b = doc.getElementById('a2hsBand'); if (b) b.remove(); }
  /* host 맨 위에 띠 하나 (이미 있으면 그대로) — 보이면 true */
  function band(host, app) {
    if (!host || !shouldShow(app)) { removeBand(); return false; }
    if (doc.getElementById('a2hsBand')) return true;
    style();
    var b = doc.createElement('div');
    b.className = 'a2hs-band'; b.id = 'a2hsBand';
    b.innerHTML = '<span class="a2hs-band__t">📱 홈 화면에 추가하면 앱처럼 바로 열려요</span>' +
      '<button type="button" class="a2hs-band__go" data-a2hs-add>추가하기</button>' +
      '<button type="button" class="a2hs-band__later" data-a2hs-later>다음에</button>';
    b.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-a2hs-add]')) add(app);
      else if (ev.target.closest('[data-a2hs-later]')) { later(app); removeBand(); }
    });
    host.insertBefore(b, host.firstChild);
    return true;
  }

  /* ---------- 서비스워커 — 인터넷이 끊겼을 때 안내 한 장 (화면은 저장하지 않는다) ---------- */
  function register(url) {
    try {
      if (!global.navigator.serviceWorker || !/^https:|^http:\/\/localhost/.test(String(global.location.href))) return;
      global.addEventListener('load', function () { global.navigator.serviceWorker.register(url).catch(function () {}); });
    } catch (e) {}
  }

  global.A2HS = {
    env: env, shouldShow: shouldShow, later: later, band: band, add: add, how: how, register: register, close: closeSheet,
    setEnv: function (o) { envOver = o || null; }, setPrompt: function (p) { deferred = p || null; }, key: keyOf
  };
})(window);
