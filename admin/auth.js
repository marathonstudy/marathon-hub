/* ============================================================
   auth.js — 로그인 관문 · 비밀번호 찾기

   로그인하기 전에는 아무 화면도 보이지 않는다.
   로그인해도 staff 표에 '사용 중' 으로 등록돼 있어야 들어간다.

   조교: 이름 · 휴대폰 번호(010 뺀 8자리) → [들어가기] (Edge Function staff-login · migration-047 · 051)
     처음 보는 번호면 「승인 대기」 — 「승인을 기다리는 중입니다…」 · 사용 중인 운영진 누구나 「오늘」 맨 위 · 운영진 창에서 [승인]
     승인되면 같은 이름 · 번호로 다시 들어온다 · 거절된 번호는 「승인되지 않은 번호입니다」
     이미 있는 번호면 이름이 맞을 때만. 로그인 상태는 이 기기에 계속 남는다.
   원장(내 계정): 아래 「다른 방법으로 로그인」 안의 이메일 · 비밀번호 (비밀번호 찾기도 그 안)
   staff 에 없는 이메일 계정은 들어가지 못한다.
   사용 중지된 계정은 들어가지 못하고, 열려 있던 화면도 곧 로그아웃된다.
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

  var phName  = $('#phName');
  var phNum   = $('#phNum');
  var phBtn   = $('#btnPhone');

  var PANES = ['phoneForm', 'resetForm', 'newPwForm'];
  var REASON = {
    disabled: '사용이 중지된 계정입니다. 원장님께 문의해 주세요.',
    none:     '코치룸에 등록되지 않은 이메일 계정입니다. 조교는 위에서 이름과 번호로 들어오세요.',
    email:    '이메일 주소를 확인해 주세요.'
  };

  function showPane(id) {
    PANES.forEach(function (p) { $('#' + p).hidden = p !== id; });
    gate.hidden = false;
  }

  function err(boxId, msg) {
    var b = $(boxId);
    b.textContent = msg || '';
    b.classList.toggle('is-on', !!msg);
  }
  /* 오류는 고른 방법의 칸 아래에 (이메일로 로그인하던 중이면 그 아래) */
  var via = 'phone';
  function showError(msg) {
    err(via === 'email' ? '#loginError' : '#phError', msg);
    err(via === 'email' ? '#phError' : '#loginError', '');
  }

  function setBusy(on, label) {
    btn.disabled = on; phBtn.disabled = on;
    btn.textContent = on && via === 'email' ? (label || '확인 중…') : '이메일로 로그인';
    phBtn.textContent = on && via === 'phone' ? (label || '확인 중…') : '들어가기';
    idInput.disabled = on; pwInput.disabled = on;
    phName.disabled = on; phNum.disabled = on;
  }

  function busyBtn(b, on, label, normal) {
    b.disabled = on;
    b.textContent = on ? label : normal;
  }

  /* 권한 확인 → 서버에서 전부 받아 온 다음 화면을 연다.
     받아오기 전에 열면 빈 명단이 잠깐 보이고, 그 상태로 저장이 돌면
     서버 명단을 덮어쓸 위험이 있다. */
  function showApp(session) {
    var email = (session && session.user && session.user.email) || '';
    setBusy(true, '권한 확인 중…');

    return SB.staffStatus().then(function (st) {
      if (st === 'pending' || st === 'rejected') {
        var pz = new Error(st === 'pending' ? '승인을 기다리는 중입니다. 옆의 운영진이 승인하면 같은 이름·번호로 다시 들어오세요' : '승인되지 않은 번호입니다');
        pz.notStaff = true;
        throw pz;
      }
      if (st === 'disabled') {
        var d = new Error(REASON.disabled);
        d.notStaff = true;
        throw d;
      }
      if (st !== 'active') {
        var n = new Error(REASON.none);
        n.notStaff = true;
        throw n;
      }
      setBusy(true, '불러오는 중…');
      /* 위쪽 이름 — 번호로 들어온 조교는 이메일 칸이 ph-… 라서 staff 표의 이름으로 (쓴 사람 · 고친 사람에도 쓰인다) */
      var me = DB.myStaff().catch(function () { return null; });
      return Promise.all([Store.loadAll(), me]).then(function (res) {
        var nm = (res[1] && res[1].name) || email.split('@')[0];
        Store.enableSync(true);
        gate.hidden = true;
        appRoot.hidden = false;
        topbar.hidden = false;
        $('#whoami').textContent = nm;
        $('#whoami').title = /^ph-/.test(email) ? nm : email;
        $('#whoamiWrap').hidden = !email;
        document.body.classList.remove('is-locked');
        setBusy(false);
        SB.touch();
        window.dispatchEvent(new CustomEvent('jt:loaded'));
      });
    }).catch(function (e) {
      Store.enableSync(false);
      setBusy(false);
      if (e && e.notStaff) {
        SB.signOut();
        showPane('phoneForm');
        showError(e.message);
      } else {
        console.error(e);
        showPane('phoneForm');
        showError((e && e.message) || '데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 로그인해 주세요.');
      }
    });
  }

  function showLogin() {
    Store.enableSync(false);
    showPane('phoneForm');
    appRoot.hidden = true;
    topbar.hidden = true;
    document.body.classList.add('is-locked');
    setBusy(false);
    pwInput.value = '';
    setTimeout(function () { ($('#otherLogin').open ? idInput : phName).focus(); }, 60);
  }

  /* ---------- 로그인 ---------- */

  function emailLogin() {
    via = 'email';
    showError('');
    setBusy(true);
    SB.signIn(idInput.value, pwInput.value)
      .then(function (session) {
        try { localStorage.setItem(CONFIG.storagePrefix + 'lastEmail', idInput.value.trim()); } catch (x) {}
        showApp(session);
      })
      .catch(function (x) {
        setBusy(false);
        showError(x && x.message ? x.message : '로그인에 실패했습니다.');
        pwInput.value = '';
        pwInput.focus();
      });
  }
  btn.addEventListener('click', emailLogin);

  /* 조교 — 이름 + 번호 8자리. 이메일 칸에서 Enter 를 누르면 이메일 로그인 */
  $('#phoneForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('#loginForm').contains(document.activeElement)) { emailLogin(); return; }
    via = 'phone';
    showError('');
    setBusy(true);
    SB.phoneLogin(phName.value, phNum.value)
      .then(function (session) {
        try { localStorage.setItem(CONFIG.storagePrefix + 'lastName', phName.value.trim()); } catch (x) {}
        phNum.value = '';
        showApp(session);
      })
      .catch(function (x) {
        setBusy(false);
        showError(x && x.message ? x.message : '들어가지 못했습니다.');
        phNum.focus();
      });
  });

  $('#btnLogout').addEventListener('click', function () {
    /* 작성 중이던 글을 먼저 저장하고, 이 기기에 임시 보관한 글은 지운다 */
    var flush = window.Writer ? Writer.flush() : Promise.resolve();
    flush.then(function () { return Store.flushAll ? Store.flushAll() : null; }).catch(function () {}).then(function () {
      Store.setBackupUser('');
      Store.clearBackups();
      return SB.signOut();
    }).then(function () { showLogin(); showError(''); });
  });

  $('#goReset').addEventListener('click', function () {
    err('#rsError', '');
    $('#rsOk').hidden = true;
    $('#rsEmail').value = idInput.value.trim();
    showPane('resetForm');
    setTimeout(function () { $('#rsEmail').focus(); }, 30);
  });
  Array.prototype.forEach.call(document.querySelectorAll('#authGate [data-back]'), function (b) {
    b.addEventListener('click', function () { showPane('phoneForm'); showError(''); });
  });

  /* ---------- 비밀번호 찾기 ---------- */

  $('#resetForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#rsEmail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err('#rsError', REASON.email); return; }
    err('#rsError', '');
    var b = $('#btnReset');
    busyBtn(b, true, '보내는 중…', '재설정 메일 보내기');
    SB.sendReset(email).then(function () {
      busyBtn(b, false, '', '재설정 메일 보내기');
      $('#rsOk').hidden = false;
      $('#rsOk').textContent = email + ' 으로 메일을 보냈습니다. 메일의 링크를 누르면 코치룸에서 새 비밀번호를 정할 수 있습니다. ' +
                               '(가입된 이메일일 때만 메일이 갑니다. 몇 분 안에 안 오면 스팸함도 확인해 주세요.)';
    }).catch(function (x) {
      busyBtn(b, false, '', '재설정 메일 보내기');
      err('#rsError', (x && x.message) || '메일을 보내지 못했습니다.');
    });
  });

  $('#newPwForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('#npPw').value, pw2 = $('#npPw2').value;
    if (pw.length < 8) { err('#npError', '비밀번호는 8자 이상으로 정해 주세요.'); return; }
    if (pw !== pw2) { err('#npError', '두 비밀번호가 서로 다릅니다.'); return; }
    var b = $('#btnNewPw');
    busyBtn(b, true, '저장하는 중…', '저장하고 들어가기');
    SB.updatePassword(pw).then(function () {
      busyBtn(b, false, '', '저장하고 들어가기');
      $('#npPw').value = ''; $('#npPw2').value = '';
      SB.clearUrl();
      return SB.getSession().then(showApp);
    }).catch(function (x) {
      busyBtn(b, false, '', '저장하고 들어가기');
      err('#npError', (x && x.message) || '저장하지 못했습니다.');
    });
  });

  /* ---------- 열려 있는 화면 — 사용 중지되면 로그아웃 ---------- */

  var lastCheck = 0;
  window.addEventListener('jt:refreshed', function (e) {
    if ((e.detail && e.detail.local) || appRoot.hidden || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    SB.touch();
    SB.staffStatus().then(function (st) {
      if (st === 'active') return;
      Store.enableSync(false);
      SB.signOut().then(function () {
        showLogin();
        showError(st === 'disabled' ? REASON.disabled : '코치룸 등록이 해제된 계정입니다. 원장님께 문의해 주세요.');
      });
    }, function () {});
  });

  /* ---------- 시작 ---------- */

  function boot() {
    var verEl = $('#appVersion');
    if (verEl) verEl.textContent = 'v' + (window.SB ? SB.VERSION : '?');

    try {
      idInput.value = localStorage.getItem(CONFIG.storagePrefix + 'lastEmail') || '';
      phName.value = localStorage.getItem(CONFIG.storagePrefix + 'lastName') || '';
    } catch (x) {}

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

    /* 비밀번호 재설정 메일의 링크로 들어왔으면 새 비밀번호부터 */
    SB.recoveryFromUrl().then(function (rec) {
      if (rec === 'recovery') {
        showPane('newPwForm');
        setTimeout(function () { $('#npPw').focus(); }, 60);
        return;
      }
      if (rec && rec.error) {
        SB.clearUrl();
        showLogin();
        showError('링크가 만료됐거나 이미 쓴 링크입니다. 비밀번호 찾기를 다시 해 주세요.');
        return;
      }
      return SB.getSession().then(function (session) {
        if (session) showApp(session);
        else showLogin();
      });
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
