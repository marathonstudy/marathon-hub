/* ============================================================
   auth.js — 로그인 관문 · 조교 가입 · 비밀번호 찾기

   로그인하기 전에는 아무 화면도 보이지 않는다.
   로그인해도 staff 표에 '사용 중' 으로 등록돼 있어야 들어간다.

   가입: 이름 · 이메일 · 비밀번호 · 팀 가입 코드
     1) staff_join_check 로 코드만 먼저 확인 — 틀리면 계정을 만들지 않는다
     2) Supabase 가입(이메일 인증 끔 → 바로 로그인)
     3) staff_join 이 코드를 다시 확인하고 조교로 등록 → 코치룸
   로그인했는데 아직 등록 안 된 계정은 '팀 가입 코드 입력' 칸이 나온다.
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

  var PANES = ['loginForm', 'signupForm', 'resetForm', 'newPwForm', 'joinForm'];
  var REASON = {
    code:     '팀 가입 코드가 맞지 않습니다.',
    locked:   '잘못된 코드를 여러 번 넣어 잠깐 막혔습니다. 15분쯤 뒤에 다시 해 주세요.',
    closed:   '지금은 가입을 받지 않습니다. 선생님께 팀 가입 코드를 물어봐 주세요.',
    exists:   '이미 가입된 이메일입니다. 로그인해 주세요.',
    disabled: '사용이 중지된 계정입니다. 선생님께 문의해 주세요.',
    email:    '이메일 주소를 확인해 주세요.',
    name:     '이름을 적어 주세요.',
    login:    '로그인이 필요합니다.'
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
  function showError(msg) { err('#loginError', msg); }

  function setBusy(on, label) {
    btn.disabled = on;
    btn.textContent = on ? (label || '확인 중…') : '로그인';
    idInput.disabled = on;
    pwInput.disabled = on;
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
      if (st === 'disabled') {
        var d = new Error(REASON.disabled);
        d.notStaff = true;
        throw d;
      }
      if (st !== 'active') {
        setBusy(false);
        showJoin(email);
        return 'join';
      }
      setBusy(true, '불러오는 중…');
      return Store.loadAll().then(function () {
        Store.enableSync(true);
        gate.hidden = true;
        appRoot.hidden = false;
        topbar.hidden = false;
        $('#whoami').textContent = email.split('@')[0];
        $('#whoami').title = email;
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
        showPane('loginForm');
        showError(e.message);
      } else {
        console.error(e);
        showPane('loginForm');
        showError((e && e.message) || '데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 로그인해 주세요.');
      }
    });
  }

  function showLogin() {
    Store.enableSync(false);
    showPane('loginForm');
    appRoot.hidden = true;
    topbar.hidden = true;
    document.body.classList.add('is-locked');
    setBusy(false);
    pwInput.value = '';
    setTimeout(function () { idInput.focus(); }, 60);
  }

  /* ---------- 로그인 ---------- */

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
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

  $('#goSignup').addEventListener('click', function () {
    err('#suError', '');
    $('#suEmail').value = idInput.value.trim();
    showPane('signupForm');
    setTimeout(function () { $('#suName').focus(); }, 30);
  });
  $('#goReset').addEventListener('click', function () {
    err('#rsError', '');
    $('#rsOk').hidden = true;
    $('#rsEmail').value = idInput.value.trim();
    showPane('resetForm');
    setTimeout(function () { $('#rsEmail').focus(); }, 30);
  });
  Array.prototype.forEach.call(document.querySelectorAll('#authGate [data-back]'), function (b) {
    b.addEventListener('click', function () { showPane('loginForm'); showError(''); });
  });

  /* ---------- 가입 ---------- */

  $('#signupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#suName').value.trim();
    var email = $('#suEmail').value.trim().toLowerCase();
    var pw = $('#suPw').value, pw2 = $('#suPw2').value;
    var code = $('#suCode').value.trim();
    if (!name) { err('#suError', REASON.name); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err('#suError', REASON.email); return; }
    if (pw.length < 8) { err('#suError', '비밀번호는 8자 이상으로 정해 주세요.'); return; }
    if (pw !== pw2) { err('#suError', '두 비밀번호가 서로 다릅니다.'); return; }
    if (!code) { err('#suError', '팀 가입 코드를 넣어 주세요.'); return; }
    err('#suError', '');
    var b = $('#btnSignup');
    busyBtn(b, true, '코드 확인 중…', '가입하기');

    SB.joinCheck(email, code).then(function (r) {
      if (!r.ok) throw new Error(REASON[r.reason] || REASON.code);
      busyBtn(b, true, '가입하는 중…', '가입하기');
      return SB.signUp(email, pw);
    }).then(function (data) {
      if (!data.session) {
        /* 대시보드에서 이메일 인증이 켜져 있는 경우 */
        busyBtn(b, false, '', '가입하기');
        showPane('loginForm');
        showError('가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하면 팀 가입 코드 칸이 나옵니다.');
        return;
      }
      return SB.join(name, code).then(function (r) {
        busyBtn(b, false, '', '가입하기');
        try { localStorage.setItem(CONFIG.storagePrefix + 'lastEmail', email); } catch (x) {}
        if (!r.ok) {
          showJoin(email);
          err('#joError', REASON[r.reason] || REASON.code);
          return;
        }
        idInput.value = email;
        $('#suPw').value = ''; $('#suPw2').value = ''; $('#suCode').value = '';
        return showApp(data.session);
      });
    }).catch(function (x) {
      busyBtn(b, false, '', '가입하기');
      err('#suError', (x && x.message) || '가입하지 못했습니다.');
    });
  });

  /* ---------- 로그인은 됐지만 아직 팀에 등록 안 됨 ---------- */

  function showJoin(email) {
    $('#joWho').textContent = (email || '이 계정') + ' 은(는) 아직 팀에 등록되지 않았습니다. 선생님께 받은 팀 가입 코드를 넣어 주세요.';
    err('#joError', '');
    showPane('joinForm');
    setTimeout(function () { $('#joName').focus(); }, 30);
  }

  $('#joinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#joName').value.trim(), code = $('#joCode').value.trim();
    if (!name) { err('#joError', REASON.name); return; }
    if (!code) { err('#joError', '팀 가입 코드를 넣어 주세요.'); return; }
    var b = $('#btnJoin');
    busyBtn(b, true, '확인 중…', '등록하고 들어가기');
    SB.join(name, code).then(function (r) {
      busyBtn(b, false, '', '등록하고 들어가기');
      if (!r.ok) { err('#joError', REASON[r.reason] || REASON.code); return; }
      $('#joCode').value = '';
      return SB.getSession().then(showApp);
    }).catch(function (x) {
      busyBtn(b, false, '', '등록하고 들어가기');
      err('#joError', (x && x.message) || '등록하지 못했습니다.');
    });
  });

  $('#joLogout').addEventListener('click', function () {
    SB.signOut().then(function () { showLogin(); showError(''); });
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
        showError(st === 'disabled' ? REASON.disabled : '팀 등록이 해제된 계정입니다. 선생님께 문의해 주세요.');
      });
    }, function () {});
  });

  /* ---------- 시작 ---------- */

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
