/* ============================================================
   supabase.js — 로그인 (이메일 + 비밀번호)

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
    if (/Failed to fetch|NetworkError/i.test(m)) return new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return new Error(m || '로그인에 실패했습니다.');
  }

  global.SB = {
    VERSION: APP_VERSION,
    init: init,
    get client() { return init(); },
    withTimeout: withTimeout,
    signIn: signIn,
    signOut: signOut,
    checkStaff: checkStaff,
    getSession: getSession,
    onAuthChange: onAuthChange
  };

})(window);
