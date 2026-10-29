/* ============================================================
   entry.js — 학생 공용 입구 /s/ (migration-024)

   반 고르기 → 이름 고르기 → 비밀번호(학생 휴대폰 번호에서 010 을 뺀 8자리) → [들어가기]
     · 반 · 이름 목록은 보관하지 않은 반 · 재원 학생만 (student_entry_classes · student_entry_names)
     · 서버(student_login)는 맞는지 틀린지만 답한다. 맞으면 그 학생의 「학생 링크」 코드 → /me/#코드 (학생 링크와 똑같은 화면)
     · 「이 휴대폰에서 로그인 유지」(기본 켬) — 이 기기에는 그 학생 링크 코드 하나만 남긴다 (EntryLogin.KEY)
       끄면 이 창(탭)이 열려 있는 동안만. 러닝노트 [로그아웃]이 지운다 (hub.js)
     · 다시 /s/ 를 열면 남겨 둔 코드로 바로 러닝노트. 로그아웃하고 오면(?out=1) 그대로 입구
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var KEY = (CFG && CFG.storagePrefix || 'mhub.') + 'slogin';
  var CODE_RE = /^[A-Za-z0-9]{20,64}$/;

  /* ---------- 로그인 유지 (러닝노트 [로그아웃]도 같이 쓴다) ---------- */
  function get() {
    var v = '';
    try { v = global.localStorage.getItem(KEY) || ''; } catch (e) {}
    if (!v) { try { v = global.sessionStorage.getItem(KEY) || ''; } catch (e) {} }
    return CODE_RE.test(v) ? v : '';
  }
  function save(code, keep) {
    clear();
    try { (keep ? global.localStorage : global.sessionStorage).setItem(KEY, code); } catch (e) {}
  }
  function clear() {
    try { global.localStorage.removeItem(KEY); } catch (e) {}
    try { global.sessionStorage.removeItem(KEY); } catch (e) {}
  }
  global.EntryLogin = { KEY: KEY, get: get, save: save, clear: clear };

  var root = global.document && global.document.getElementById('enForm');
  if (!root) return;                                   /* 러닝노트(/me/)에서는 위 도구만 쓴다 */

  var $ = function (s) { return global.document.querySelector(s); };
  function rpc(name, args) {
    return global.fetch(CFG.supabase.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function go(code) { global.location.replace('../me/#' + code); }
  function msg(t, kind) {
    var el = $('#enMsg');
    el.hidden = !t;
    el.textContent = t || '';
    el.className = 'en-msg' + (kind ? ' en-msg--' + kind : '');
  }
  function option(value, text) {
    var o = global.document.createElement('option');
    o.value = value; o.textContent = text;
    return o;
  }

  /* 로그인을 남겨 둔 기기 — 바로 러닝노트 (로그아웃하고 온 때는 그대로 입구) */
  var out = /[?&]out=1\b/.test(global.location.search || '');
  if (!out && get()) { go(get()); return; }

  var REASON = {
    wrong: '비밀번호는 학생 휴대폰 번호에서 010을 뺀 8자리입니다.',
    nophone: '휴대폰 번호가 아직 등록돼 있지 않아요. 조교 선생님께 휴대폰 번호 등록을 부탁하세요.',
    nolink: '아직 학생 링크가 없어요. 조교 선생님께 학생 링크 발급을 부탁하세요.',
    gone: '이 반에 그 이름이 없습니다. 새로고침한 뒤 반과 이름을 다시 골라 주세요.'
  };

  function ready() {
    $('#enGo').disabled = !($('#enClass').value && $('#enName').value && $('#enPw').value.replace(/\D/g, '').length >= 8);
  }

  function loadClasses() {
    var sel = $('#enClass');
    rpc('student_entry_classes').then(function (list) {
      sel.textContent = '';
      sel.appendChild(option('', (list || []).length ? '반을 골라 주세요' : '열린 반이 없어요'));
      (list || []).forEach(function (c) { sel.appendChild(option(c, c)); });
      sel.disabled = !(list || []).length;
    }).catch(function () {
      sel.textContent = '';
      sel.appendChild(option('', '불러오지 못했어요'));
      msg('불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.', 'bad');
    });
  }

  function loadNames(cls) {
    var sel = $('#enName');
    sel.textContent = '';
    sel.disabled = true;
    if (!cls) { sel.appendChild(option('', '반을 먼저 골라 주세요')); ready(); return; }
    sel.appendChild(option('', '불러오는 중…'));
    rpc('student_entry_names', { p_class: cls }).then(function (list) {
      if ($('#enClass').value !== cls) return;
      sel.textContent = '';
      sel.appendChild(option('', '이름을 골라 주세요'));
      /* 같은 반에 같은 이름이 있으면 「김하늘 (2)」처럼 */
      var seen = {};
      (list || []).forEach(function (x) {
        seen[x.name] = (seen[x.name] || 0) + 1;
        sel.appendChild(option(x.key, x.name + (seen[x.name] > 1 ? ' (' + seen[x.name] + ')' : '')));
      });
      sel.disabled = !(list || []).length;
      ready();
    }).catch(function () { msg('이름을 불러오지 못했어요. 다시 골라 주세요.', 'bad'); });
  }

  $('#enClass').addEventListener('change', function () { msg(''); loadNames($('#enClass').value); });
  $('#enName').addEventListener('change', function () { msg(''); ready(); });
  $('#enPw').addEventListener('input', function () { msg(''); ready(); });

  root.addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('#enGo').disabled) return;
    $('#enGo').disabled = true;
    $('#enGo').textContent = '확인 중…';
    rpc('student_login', { p_class: $('#enClass').value, p_key: $('#enName').value, p_pw: $('#enPw').value }).then(function (r) {
      if (r && r.ok && CODE_RE.test(r.code || '')) {
        save(r.code, $('#enKeep').checked);
        $('#enPw').value = '';
        go(r.code);
        return;
      }
      msg(REASON[(r && r.reason) || ''] || '들어가지 못했어요. 다시 해 주세요.', 'bad');
      if (r && r.reason === 'wrong') { $('#enPw').value = ''; $('#enPw').focus(); }
      $('#enGo').textContent = '들어가기';
      ready();
    }).catch(function () {
      msg('들어가지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad');
      $('#enGo').textContent = '들어가기';
      ready();
    });
  });

  if (out) msg('로그아웃했어요.', 'ok');
  loadClasses();

})(window);
