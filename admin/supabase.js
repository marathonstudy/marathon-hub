/* ============================================================
   supabase.js — 로그인 (조교: 이름 + 번호 8자리 · 원장: 이메일 + 비밀번호)

   접속 주소·키는 assets/config.js 에 있다.
   publishable key 는 공개돼도 되는 키다. 모든 표에 RLS 가 켜져 있고,
   staff 표에 등록된 이메일만 표를 읽고 쓸 수 있기 때문이다.
   secret key 는 절대 넣지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.CONFIG) throw new Error('assets/config.js 를 먼저 불러와야 합니다.');

  var APP_VERSION = global.CONFIG.version;
  var STORAGE_KEY = global.CONFIG.storagePrefix + 'auth';
  var client = null;

  function init() {
    if (client) return client;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    client = global.supabase.createClient(global.CONFIG.supabase.url, global.CONFIG.supabase.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: STORAGE_KEY
      }
    });
    return client;
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, ms);
      promise.then(function (v) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(e);
      });
    });
  }

  /* 로그인. 응답에 세션이 들어 있으므로 뒤이어 getSession() 을 부르지 않는다.
     (라이브러리 내부 잠금을 서로 기다리다 멈출 수 있다) */
  function signIn(email, password) {
    email = String(email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) return Promise.reject(new Error('이메일 주소를 입력해 주세요.'));
    if (!password) return Promise.reject(new Error('비밀번호를 입력해 주세요.'));

    var call;
    try {
      call = init().auth.signInWithPassword({ email: email, password: password });
    } catch (e) {
      return Promise.reject(translate(e));
    }

    return withTimeout(call, 20000, '서버 응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      .then(function (res) {
        if (res.error) throw translate(res.error);
        if (!res.data || !res.data.session) {
          throw new Error('로그인은 됐지만 세션을 받지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        }
        return res.data.session;
      });
  }

  /* 조교 — 이름 + 휴대폰 번호 8자리 (Edge Function staff-login · migration-047).
     처음 보는 번호면 그 이름으로 바로 가입된다. 받은 세션은 이 기기에 계속 남는다 (persistSession) */
  var PHONE_REASON = {
    name: '이름을 적어 주세요.',
    phone: '휴대폰 번호는 010 을 뺀 8자리 숫자로 넣어 주세요.',
    mismatch: '이름이나 번호가 맞지 않습니다',
    disabled: '사용이 중지된 계정입니다. 원장님께 문의해 주세요.',
    locked: '여러 번 맞지 않아 잠깐 막혔습니다. 15분쯤 뒤에 다시 해 주세요.',
    busy: '지금 들어오는 사람이 많습니다. 잠시 뒤에 다시 해 주세요.',
    nosql: '번호로 들어가기가 아직 설치되지 않았습니다. 원장님께 문의해 주세요.'
  };
  function phoneDigits(v) {
    var d = String(v || '').replace(/\D/g, '');
    return d.length === 11 && d.indexOf('010') === 0 ? d.slice(3) : d;
  }
  function phoneLogin(name, phone) {
    name = String(name || '').trim();
    phone = phoneDigits(phone);
    if (!name) return Promise.reject(new Error(PHONE_REASON.name));
    if (!/^\d{8}$/.test(phone)) return Promise.reject(new Error(PHONE_REASON.phone));
    var call;
    try {
      init();
      call = global.fetch(global.CONFIG.supabase.url + '/functions/v1/staff-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: global.CONFIG.supabase.key },
        body: JSON.stringify({ name: name, phone: phone })
      }).then(function (r) { return r.json(); });
    } catch (e) {
      return Promise.reject(translate(e));
    }
    return withTimeout(call, 25000, '서버 응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      .then(function (j) {
        if (!j || !j.ok || !j.session) throw new Error(PHONE_REASON[j && j.reason] || (j && j.message) || '들어가지 못했습니다. 잠시 뒤에 다시 해 주세요.');
        return init().auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token });
      }, function (e) { throw translate(e); })
      .then(function (r) {
        if (r.error) throw translate(r.error);
        if (!r.data || !r.data.session) throw new Error('로그인은 됐지만 세션을 받지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        return r.data.session;
      });
  }

  /* staff 표에 이 계정이 있는가. 없으면 생성기를 열지 않는다.
     (RLS 가 어차피 막지만, 빈 화면 대신 이유를 알려 주려고 먼저 본다) */
  function checkStaff() {
    return withTimeout(init().rpc('is_staff'), 15000, '권한을 확인하지 못했습니다.')
      .then(function (r) {
        if (r.error) {
          if (/is_staff/.test(r.error.message || '')) {
            throw new Error('Supabase 에 schema.sql 이 아직 실행되지 않았습니다. README 의 순서를 확인해 주세요.');
          }
          throw new Error(r.error.message);
        }
        return r.data === true;
      });
  }

  function signOut() { return init().auth.signOut(); }

  /* ---------- 상태 · 마지막 접속 · 비밀번호 찾기 (migration-008) ---------- */

  function missingFn(err) { return /Could not find the function|does not exist|schema cache/i.test((err && err.message) || ''); }

  /* 로그인한 사람의 상태 — 'active' · 'disabled' · 'none'. 008 을 아직 안 돌렸으면 is_staff 로 */
  function staffStatus() {
    return withTimeout(init().rpc('staff_status'), 15000, '권한을 확인하지 못했습니다.').then(function (r) {
      if (!r.error) return r.data || 'none';
      if (!missingFn(r.error)) throw new Error(r.error.message);
      return checkStaff().then(function (ok) { return ok ? 'active' : 'none'; });
    });
  }

  var lastTouch = 0;
  function touch() {
    if (Date.now() - lastTouch < 10 * 60 * 1000) return;
    lastTouch = Date.now();
    init().rpc('staff_touch').then(function () {}, function () {});
  }

  /* 비밀번호 재설정 메일 — 메일의 링크를 누르면 코치룸이 열리고 새 비밀번호 칸이 나온다 */
  function sendReset(email) {
    email = String(email || '').trim().toLowerCase();
    return withTimeout(init().auth.resetPasswordForEmail(email, { redirectTo: global.CONFIG.siteUrl + '/admin/' }),
      20000, '서버 응답이 없습니다.').then(function (res) { if (res.error) throw translate(res.error); });
  }

  /* 재설정 메일 링크로 들어왔는가. 맞으면 그 세션으로 로그인해 두고 'recovery'.
     링크가 만료 등으로 실패했으면 { error } */
  function recoveryFromUrl() {
    var hash = String(global.location.hash || '').replace(/^#/, '');
    var q = {};
    hash.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    var search = new URLSearchParams(global.location.search || '');
    if (q.error || search.get('error')) {
      return Promise.resolve({ error: q.error_description || search.get('error_description') || '링크를 쓸 수 없습니다.' });
    }
    if (q.type === 'recovery' && q.access_token && q.refresh_token) {
      return init().auth.setSession({ access_token: q.access_token, refresh_token: q.refresh_token })
        .then(function (r) { if (r.error) return { error: r.error.message }; return 'recovery'; });
    }
    if (search.get('code') && search.get('type') !== 'signup') {
      return init().auth.exchangeCodeForSession(search.get('code'))
        .then(function (r) { if (r.error) return { error: r.error.message }; return 'recovery'; });
    }
    return Promise.resolve(null);
  }

  function clearUrl() {
    try { global.history.replaceState(null, '', global.location.pathname); } catch (e) {}
  }

  function updatePassword(password) {
    return init().auth.updateUser({ password: password }).then(function (r) {
      if (r.error) throw translate(r.error);
      return r.data;
    });
  }

  function getSession() {
    return withTimeout(init().auth.getSession(), 15000, '로그인 상태를 확인하지 못했습니다.')
      .then(function (r) { return r.data ? r.data.session : null; });
  }

  function onAuthChange(fn) {
    init().auth.onAuthStateChange(function (event, session) {
      setTimeout(function () {
        try { fn(event, session); }
        catch (e) { console.error('auth 콜백 오류', e); }
      }, 0);
    });
  }

  function translate(err) {
    var m = String(err && err.message || '');
    if (/Invalid login credentials/i.test(m)) return new Error('이메일 또는 비밀번호가 맞지 않습니다.');
    if (/Email not confirmed/i.test(m)) return new Error('이메일 확인이 안 된 계정입니다. Supabase 에서 계정을 만들 때 Auto Confirm 을 켜 주세요.');
    if (/rate limit|too many/i.test(m)) return new Error('시도가 너무 잦습니다. 잠시 뒤에 다시 해 주세요.');
    if (/already registered|already been registered|user already exists/i.test(m)) return new Error('이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 써 주세요.');
    if (/password should be|weak password|at least/i.test(m)) return new Error('비밀번호가 너무 짧거나 쉽습니다. 8자 이상으로 정해 주세요.');
    if (/signups not allowed|signup is disabled/i.test(m)) return new Error('지금은 가입을 받지 않도록 설정되어 있습니다. 선생님께 문의해 주세요.');
    if (/same.*password|different from the old/i.test(m)) return new Error('예전과 다른 비밀번호로 정해 주세요.');
    if (/Failed to fetch|NetworkError/i.test(m)) return new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return new Error(m || '로그인에 실패했습니다.');
  }

  global.SB = {
    VERSION: APP_VERSION,
    init: init,
    get client() { return init(); },
    withTimeout: withTimeout,
    signIn: signIn,
    phoneLogin: phoneLogin,
    phoneDigits: phoneDigits,
    signOut: signOut,
    checkStaff: checkStaff,
    staffStatus: staffStatus,
    touch: touch,
    sendReset: sendReset,
    recoveryFromUrl: recoveryFromUrl,
    clearUrl: clearUrl,
    updatePassword: updatePassword,
    getSession: getSession,
    onAuthChange: onAuthChange
  };

})(window);
