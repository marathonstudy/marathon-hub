/* ============================================================
   auth.js — 로그인 관문

   로그인하기 전에는 아무 화면도 보이지 않는다.
   로그인해도 staff 표에 이메일이 없으면 들어가지 못한다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var gate    = $('#authGate');
  var appRoot = $('#appRoot');
  var topbar  = $('#topbar');
  var idInput = $('#loginId');
  var pwInput = $('#loginPw');
  var errBox  = $('#loginError');
  var btn     = $('#btnLogin');

  function showError(msg) {
    errBox.textContent = msg || '';
    errBox.classList.toggle('is-on', !!msg);
  }

  function setBusy(on, label) {
    btn.disabled = on;
    btn.textContent = on ? (label || '확인 중…') : '로그인';
    idInput.disabled = on;
    pwInput.disabled = on;
  }

  /* 권한 확인 → 서버에서 전부 받아 온 다음 화면을 연다.
     받아오기 전에 열면 빈 명단이 잠깐 보이고, 그 상태로 저장이 돌면
     서버 명단을 덮어쓸 위험이 있다. */
  function showApp(session) {
    var email = (session && session.user && session.user.email) || '';
    setBusy(true, '권한 확인 중…');

    return SB.checkStaff().then(function (ok) {
      if (!ok) {
        var e = new Error(email + ' 은(는) 등록된 선생님·조교 계정이 아닙니다. 선생님께 staff 등록을 요청해 주세요.');
        e.notStaff = true;
        throw e;
      }
      setBusy(true, '불러오는 중…');
      return Store.loadAll();
    }).then(function () {
      Store.enableSync(true);

      gate.hidden = true;
      appRoot.hidden = false;
      topbar.hidden = false;
      $('#whoami').textContent = email.split('@')[0];
      $('#whoami').title = email;
      $('#whoamiWrap').hidden = !email;
      document.body.classList.remove('is-locked');
      setBusy(false);

      window.dispatchEvent(new CustomEvent('jt:loaded'));
    }).catch(function (err) {
      Store.enableSync(false);
      setBusy(false);
      console.error(err);
      if (err && err.notStaff) {
        SB.signOut();
        showError(err.message);
      } else {
        showError((err && err.message) || '데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 로그인해 주세요.');
      }
      gate.hidden = false;
    });
  }

  function showLogin() {
    Store.enableSync(false);
    gate.hidden = false;
    appRoot.hidden = true;
    topbar.hidden = true;
    document.body.classList.add('is-locked');
    setBusy(false);
    pwInput.value = '';
    setTimeout(function () { idInput.focus(); }, 60);
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    setBusy(true);
    SB.signIn(idInput.value, pwInput.value)
      .then(function (session) {
        try { localStorage.setItem(CONFIG.storagePrefix + 'lastEmail', idInput.value.trim()); } catch (x) {}
        showApp(session);
      })
      .catch(function (err) {
        setBusy(false);
        showError(err && err.message ? err.message : '로그인에 실패했습니다.');
        pwInput.value = '';
        pwInput.focus();
      });
  });

  $('#btnLogout').addEventListener('click', function () {
    SB.signOut().then(function () { showLogin(); showError(''); });
  });

  function boot() {
    var verEl = $('#appVersion');
    if (verEl) verEl.textContent = 'v' + (window.SB ? SB.VERSION : '?');

    try { idInput.value = localStorage.getItem(CONFIG.storagePrefix + 'lastEmail') || ''; } catch (x) {}

    var dot = $('#syncDot');
    Store.onSyncChange(function (s) {
      if (s.error) {
        dot.className = 'sync sync--bad'; dot.textContent = '저장 실패'; dot.title = s.error;
      } else if (s.pending > 0) {
        dot.className = 'sync sync--busy'; dot.textContent = '저장 중'; dot.title = '';
      } else {
        dot.className = 'sync sync--ok'; dot.textContent = '저장됨'; dot.title = '';
      }
    });

    try {
      SB.init();
    } catch (e) {
      showError(e.message);
      gate.hidden = false;
      return;
    }

    SB.getSession().then(function (session) {
      if (session) showApp(session);
      else showLogin();
    }).catch(function () {
      showLogin();
      showError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
    });

    SB.onAuthChange(function (event, session) {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        if (!gate.hidden) return;
        showLogin();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
