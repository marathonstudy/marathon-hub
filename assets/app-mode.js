/* ============================================================
   app-mode.js — 마라톤 앱 안 「내 러닝노트」 (앱 모드 · 20261127a · migration-133 · 함수 hub-embed)

   앱이 서버에서 만든 서명 링크 /me/?e=v1.<앱 학생번호>.<만료>.<서명> 으로 열 때만 켜진다.
     일반 링크(#코드 · ?c=코드 · 기억한 기기) · 코치룸 미리보기 · 현강 화면은 이 파일이 아무것도 하지 않는다 (AppMode.on = false)
   1) 함수 hub-embed { do: "open", t } → 그 학생의 학생 링크 코드 → 러닝노트가 지금처럼 그 코드로 연다 (#코드/home)
      만료 · 위조 → 「앱에서 다시 열어 주세요」 · 스위치 꺼짐 · 대상 아님 → 「잠시 쉬는 중」 (코치룸 설정 「앱 러닝노트」)
      같은 창에서 다시 열면(새로고침) 이 창(sessionStorage)에 남긴 코드로 — 서버에 다시 묻지 않는다 · 이 기기(localStorage)에는 남기지 않는다
   2) 모습(app-mode.css · 통과 시안 .local/앱모드시안) — 앱 위쪽 막대(닫기 + 「내 러닝노트」) → 보라 프로필 카드 → 알약 탭 →
      오늘 할 일(완주 현황 · 이번 주 퀘스트) → 이번 달 완주 달력 미리보기(온라인 반) → 나머지
      휴대폰 1단 · 패드(768~1279) · 노트북(1280~) 2단(왼쪽 프로필 · 탭 · 오늘 / 오른쪽 나머지 · 최대 1100)
   3) 뒤로(닫기) — 앱에 「닫기」 신호만 보낸다 (React Native · iOS · 안드로이드 · iframe 부모). 받는 곳이 없으면 아무 일도 없다
   ============================================================ */
(function (global) {
  'use strict';

  var TOKEN_RE = /[?&]e=(v1\.[0-9]{1,18}\.[0-9]{9,11}\.[A-Za-z0-9_-]{40,90})(?:&|$)/;
  var SKEY = 'mh.inapp';
  var OPEN_TIMEOUT = 8000;
  var AM = { on: false, runPreview: null };

  function token() { var m = TOKEN_RE.exec(String(global.location.search || '')); return m ? m[1] : ''; }
  function sess(v) {
    try {
      if (v === undefined) return JSON.parse(global.sessionStorage.getItem(SKEY) || 'null');
      global.sessionStorage.setItem(SKEY, JSON.stringify(v));
    } catch (e) { /* 그대로 */ }
    return null;
  }
  function $(id) { return document.getElementById(id); }

  /* ---------- 앱에 「닫기」 신호 ---------- */
  function close() {
    var msg = { type: 'hub:close' };
    try { if (global.ReactNativeWebView && global.ReactNativeWebView.postMessage) { global.ReactNativeWebView.postMessage(JSON.stringify(msg)); return; } } catch (e) {}
    try { if (global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.hubClose) { global.webkit.messageHandlers.hubClose.postMessage('close'); return; } } catch (e) {}
    try { if (global.HubBridge && typeof global.HubBridge.close === 'function') { global.HubBridge.close(); return; } } catch (e) {}
    try { if (global.parent && global.parent !== global) global.parent.postMessage(msg, '*'); } catch (e) {}
    /* 받는 곳이 없으면 아무 일도 하지 않는다 */
  }

  /* ---------- 모습 ---------- */
  var BACK_SVG = '<svg width="24" height="24" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="#212121" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="M328 112L184 256l144 144"/></svg>';
  var L = null, R = null, slotP = null, slotT = null, lay = null;
  function look() {
    document.documentElement.classList.add('in-app');
    var c = document.querySelector('.container');
    if (!c || $('appTop')) return;
    var top = document.createElement('header');
    top.className = 'app-topbar'; top.id = 'appTop';
    top.innerHTML = '<div class="app-topbar__in"><button class="app-topbar__back" id="appBack" type="button" aria-label="닫기 (앱으로)">' + BACK_SVG + '</button>' +
      '<h1 class="app-topbar__t">내 러닝노트</h1><span class="app-topbar__sp"></span></div>';
    document.body.insertBefore(top, document.body.firstChild);
    $('appBack').addEventListener('click', close);
    /* 2단 틀 — 왼쪽(프로필 · 상단 바 · 탭 · 오늘) / 오른쪽(본문) */
    lay = document.createElement('div'); lay.className = 'lay'; lay.id = 'appLay';
    L = document.createElement('div'); L.className = 'lay__l';
    R = document.createElement('div'); R.className = 'lay__r';
    slotP = document.createElement('div'); slotP.className = 'gm-home app-slot'; slotP.id = 'appProf';
    slotT = document.createElement('div'); slotT.className = 'gm-home app-slot'; slotT.id = 'appToday';
    var bar = $('hubBar'), tabs = $('hubTabs'), root = $('hubRoot');
    c.insertBefore(lay, tabs || root);
    L.appendChild(slotP);
    if (bar) L.appendChild(bar);
    if (tabs) L.appendChild(tabs);
    L.appendChild(slotT);
    lay.appendChild(L); lay.appendChild(R);
    if (root) R.appendChild(root);
  }

  /* 홈이 다시 그려질 때마다 — 프로필 카드는 왼쪽 맨 위 · 오늘 할 일은 탭 아래 · 완주 달력 미리보기는 오른쪽 맨 위 */
  var moving = false, calHtml = null, calAsked = false;
  function sync() {
    if (moving || !slotP) return;
    moving = true;
    try {
      var ph = $('panelHome');
      if (ph) {
        var prof = ph.querySelector('#gmProfile');
        if (prof) { slotP.innerHTML = ''; slotP.appendChild(prof); }
        var today = ph.querySelector('#ornCard') || ph.querySelector('#gmQuest');
        if (today) { slotT.innerHTML = ''; slotT.appendChild(today); }
        var home = ph.querySelector('.gm-home');
        if (home && !home.querySelector('#appCalPrev')) {
          if (calHtml) home.insertBefore(calCard(calHtml), home.firstChild);
          else askCal();
        }
      }
      var onHome = !!(ph && !ph.hidden);
      slotT.hidden = !onHome;
      L.classList.toggle('has-prof', !!slotP.firstChild);
    } finally { moving = false; }
  }
  function calCard(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var cal = box.querySelector('.orn-cal');
    var card = document.createElement('section');
    card.className = 'card calprev'; card.id = 'appCalPrev';
    card.innerHTML = '<div class="card-title">🗓️ 이번 달 완주 달력</div>';
    if (cal) { cal.setAttribute('aria-hidden', 'true'); card.appendChild(cal); }
    var go = document.createElement('button');
    go.type = 'button'; go.className = 'hub-btn hub-btn--ghost calprev__go'; go.setAttribute('data-app-go', 'run'); go.textContent = '완주 달력 보기 ›';
    card.appendChild(go);
    return card;
  }
  function askCal() {
    if (calAsked || typeof AM.runPreview !== 'function') return;
    calAsked = true;
    Promise.resolve().then(function () { return AM.runPreview(); }).then(function (html) {
      if (!html || !/orn-cal/.test(html)) { calAsked = false; return; }      /* 온라인 반이 아니거나 아직 — 다음에 다시 */
      calHtml = html;
      sync();
    }, function () { calAsked = false; });
  }
  function watch() {
    var root = $('hubRoot');
    if (!root || !global.MutationObserver) return;
    new MutationObserver(function () { sync(); }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    /* 미리보기 달력 · 「완주 달력 보기 ›」 → 완주 달력 탭 */
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-app-go], #appCalPrev .orn-cal');
      if (!g) return;
      var t = $('tabRun');
      if (t && !t.hidden) { t.click(); global.scrollTo(0, 0); }
    });
  }

  /* ---------- 막혔을 때 ---------- */
  var MSG = {
    paused:  '앱 러닝노트가 잠시 쉬는 중이에요.<br>조금 뒤에 다시 열어 주세요.',
    expired: '앱에서 다시 열어 주세요.',
    bad:     '앱에서 다시 열어 주세요.',
    nolink:  '러닝노트 연결이 아직 안 됐어요.<br>선생님께 알려 주세요.',
    fail:    '불러오지 못했어요.<br>앱에서 다시 열어 주세요.'
  };
  function stop(reason) {
    var root = $('hubRoot');
    if (root) root.innerHTML = '<div class="empty app-stop" role="alert" data-app-stop="' + (MSG[reason] ? reason : 'fail') + '">' + (MSG[reason] || MSG.fail) + '</div>';
  }

  /* ---------- 서명 확인 → 코드 ---------- */
  function open(t) {
    var cfg = global.CONFIG && global.CONFIG.supabase;
    if (!cfg || !cfg.url) return Promise.resolve({ ok: false, reason: 'fail' });
    var url = cfg.url + '/functions/v1/' + ((global.CONFIG && global.CONFIG.embedFunction) || 'hub-embed');
    return Promise.race([
      fetch(url, { method: 'POST', headers: { 'apikey': cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ do: 'open', t: t }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'fail' }; }); }),
      new Promise(function (res) { setTimeout(function () { res({ ok: false, reason: 'fail' }); }, OPEN_TIMEOUT); })
    ]).catch(function () { return { ok: false, reason: 'fail' }; });
  }

  /* boot = Hub.bootMe — 앱 모드가 아니면 바로 부른다 (지금과 같음) */
  function start(boot) {
    var t = token();
    if (!t) { boot(); return; }
    AM.on = true;
    look();
    watch();
    var go = function (code) {
      var want = /^[A-Za-z0-9]{20,64}$/.test(code) ? code : '';
      if (!want) { stop('fail'); return; }
      var cur = String(global.location.hash || '').replace(/^#/, '').split('/');
      var view = cur[0] === want && cur[1] ? cur.slice(1).join('/') : 'home';
      try { global.history.replaceState(null, '', global.location.pathname + global.location.search + '#' + want + '/' + view); } catch (e) { global.location.hash = want + '/' + view; }
      boot();
    };
    var kept = sess();
    if (kept && kept.t === t && kept.code) { go(kept.code); return; }
    open(t).then(function (r) {
      if (r && r.ok && r.code) { sess({ t: t, code: r.code }); go(r.code); return; }
      stop((r && r.reason) || 'fail');
    });
  }

  AM.start = start;
  AM.close = close;
  AM.sync = sync;
  global.AppMode = AM;
})(typeof window !== 'undefined' ? window : globalThis);
