/* ============================================================
   applink.js — 「+ 과제 링크 연결」 (마라톤 앱 공유 링크 · 20261031d · 그 자리에 펼침 20261031e)

   「오늘」 · 레포트 발송 학생 줄의 [+ 과제 링크 연결], 반 카드의 [+ 과제 링크 연결 필요 n명]을 누르면
   창을 따로 띄우지 않고 그 학생 줄 바로 아래에 링크 칸이 펼쳐진다.
     [마라톤 사이트 열기 ↗] 로그인 → 학생 찾기 → 공유 링크 복사 → 여기 붙여 넣기 · [아이디 복사] [비밀번호 복사]
     [링크 칸] [저장] [취소]  (n명이면 「1/3」 · [건너뛰기] — 저장하면 다음 학생 줄이 펼쳐진다)
   · 학생 수정 창의 「마라톤 앱 공유 링크」 칸과 같은 값(student_links.app_share_code)을 저장한다
   · 학부모 링크 코드가 없는 학생은 같이 발급한다 (과제 기록은 그 코드로 불러온다)
   · 저장하면 jt:applink { sid } — 「오늘」이 그 학생 과제 기록을 바로 불러와 「과제 3/5일」로
   · 아이디 · 비밀번호는 코드에 없다 — 설정 「마라톤 사이트 로그인 정보」(staff_vault · 직원만 · migration-036)에서 읽어 복사만 한다
     (화면에 글자로 내보내지 않는다). 값이 없으면 [설정에서 로그인 정보 넣기]
   펼친 칸은 화면을 다시 그려도 남는다 — 학생 줄을 그리는 쪽이 AppLink.boxHtml(학생 id)를 줄 끝에 붙인다.
   ============================================================ */

(function () {
  'use strict';

  var SITE = 'https://www.marathonstudy.com';
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fire() { window.dispatchEvent(new CustomEvent('jt:applink-ui')); }

  /* q.list = [학생 id] · q.i = 지금 펼친 학생 */
  var q = { list: [], i: 0, value: '', err: '', busy: false, saved: 0 };
  var login = { loaded: false, has: false, val: null, missing: false };

  function cur() { return q.list[q.i] || ''; }

  function open(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return;
    q = { list: ids, i: 0, value: '', err: '', busy: false, saved: 0 };
    loadLogin();
    fire();
    focusSoon();
  }
  function close() { q = { list: [], i: 0, value: '', err: '', busy: false, saved: 0 }; fire(); }
  function next() {
    if (q.i < q.list.length - 1) { q.i++; q.value = ''; q.err = ''; fire(); focusSoon(); return; }
    var n = q.list.length, saved = q.saved;
    close();
    if (n > 1) toast('과제 링크 ' + saved + '명 연결했습니다', saved ? 'good' : '');
  }
  function focusSoon() {
    setTimeout(function () {
      var el = document.querySelector('[data-al-box="' + cur() + '"] [data-al-input]');
      if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }, 40);
  }

  /* 마라톤 사이트 로그인 정보 — 직원만 읽는 표 (값은 복사할 때만 쓴다) */
  function loadLogin(force) {
    if ((login.loaded && !force) || !window.SB || !SB.client) return Promise.resolve();
    return SB.client.from('staff_vault').select('value').eq('key', 'marathon_site').then(function (r) {
      login.loaded = true;
      login.missing = !!r.error;
      var v = (!r.error && r.data && r.data[0] && r.data[0].value) || {};
      login.val = { id: String(v.id || ''), pw: String(v.pw || '') };
      login.has = !!(login.val.id || login.val.pw);
      if (q.list.length) fire();
    }, function () { login.loaded = true; login.has = false; });
  }

  function boxHtml(sid) {
    if (!sid || sid !== cur()) return '';
    var n = q.list.length;
    var creds = login.has
      ? '<button type="button" class="al-mini" data-al-copy="id"' + (login.val.id ? '' : ' disabled') + '>아이디 복사</button>' +
        '<button type="button" class="al-mini" data-al-copy="pw"' + (login.val.pw ? '' : ' disabled') + '>비밀번호 복사</button>'
      : '<button type="button" class="al-link" data-al-setup>설정에서 로그인 정보 넣기</button>';
    return '<div class="al-box" data-al-box="' + esc(sid) + '">' +
      '<div class="al-help">' +
        '<a class="al-mini al-site" href="' + SITE + '" target="_blank" rel="noopener">마라톤 사이트 열기 ↗</a>' +
        '<span class="al-steps">로그인 → 학생 찾기 → 공유 링크 복사 → 여기 붙여 넣기</span>' +
        '<span class="al-creds">' + creds + '</span>' +
      '</div>' +
      '<div class="al-row">' +
        (n > 1 ? '<span class="al-n num">' + (q.i + 1) + '/' + n + '</span>' : '') +
        '<input class="input al-input" type="text" data-al-input autocomplete="off" spellcheck="false" aria-label="마라톤 앱 공유 링크" placeholder="https://marathonstudy.com/share/report/…" value="' + esc(q.value) + '">' +
        '<button type="button" class="btn btn--sm btn--primary" data-al-save' + (q.busy ? ' disabled' : '') + '>저장</button>' +
        (n > 1 && q.i < n - 1 ? '<button type="button" class="btn btn--sm" data-al-skip>건너뛰기</button>' : '') +
        '<button type="button" class="btn btn--sm btn--ghost" data-al-cancel>취소</button>' +
      '</div>' +
      (q.err ? '<p class="al-err" role="alert">' + esc(q.err) + '</p>' : '') +
    '</div>';
  }

  function save() {
    if (q.busy) return;
    var sid = cur();
    var code = Store.extractAppCode(q.value);
    if (!code) { q.err = '앱 공유 링크가 아닙니다'; fire(); focusSoon(); return; }
    var link = Store.linkOf(sid);
    var patch = { appCode: code };
    if (!link.hubCode) patch.hubCode = Store.randomCode(24);          /* 과제 기록은 학부모 링크 코드로 불러온다 */
    q.busy = true; q.err = '';
    fire();
    DB.saveLink(sid, patch).then(function (l) {
      var c = Store.linkOf(sid);
      c.appCode = l.appCode || code;
      c.appUpdatedAt = l.appUpdatedAt;
      if (patch.hubCode) { c.hubCode = l.hubCode || patch.hubCode; c.hubIssuedAt = l.hubIssuedAt || new Date().toISOString(); }
      Store.setLinkLocal(sid, c);
      q.saved++;
      q.busy = false;
      if (q.list.length === 1) toast('과제 링크를 연결했습니다', 'good');
      next();
      window.dispatchEvent(new CustomEvent('jt:applink', { detail: { sid: sid, hubCode: c.hubCode } }));
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
    }).catch(function (e) {
      q.busy = false;
      q.err = '저장하지 못했습니다 — ' + ((e && e.message) || e);
      fire();
    });
  }

  function copyLogin(k) {
    var v = login.val && login.val[k];
    if (!v) return;
    UI.copyText(v).then(function () { toast(k === 'id' ? '아이디를 복사했습니다' : '비밀번호를 복사했습니다', 'good'); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }
  function openSetup() {
    var b = document.getElementById('tdSettingsBtn');
    if (!b) return;
    b.click();
    setTimeout(function () {
      var el = document.getElementById('mlSiteBox');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      var i = document.getElementById('mlSiteId');
      if (i) i.focus();
    }, 300);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-al-save], [data-al-skip], [data-al-cancel], [data-al-copy], [data-al-setup], [data-app-link], [data-app-need]');
    if (!t) return;
    if (t.hasAttribute('data-app-link')) { e.preventDefault(); e.stopPropagation(); if (cur() === t.dataset.appLink && q.list.length === 1) close(); else open([t.dataset.appLink]); return; }
    if (t.hasAttribute('data-app-need')) { e.preventDefault(); e.stopPropagation(); open(t.dataset.appNeed.split(',')); var hc = t.closest('[data-cls]'); window.dispatchEvent(new CustomEvent('jt:applink-need', { detail: { ids: q.list, cls: hc ? hc.dataset.cls : '' } })); return; }
    e.stopPropagation();
    if (t.hasAttribute('data-al-save')) save();
    else if (t.hasAttribute('data-al-skip')) next();
    else if (t.hasAttribute('data-al-cancel')) close();
    else if (t.hasAttribute('data-al-copy')) copyLogin(t.dataset.alCopy);
    else if (t.hasAttribute('data-al-setup')) openSetup();
  }, true);
  document.addEventListener('input', function (e) {
    if (!e.target.matches || !e.target.matches('[data-al-input]')) return;
    q.value = e.target.value;
    if (q.err) { q.err = ''; var p = e.target.closest('.al-box').querySelector('.al-err'); if (p) p.remove(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!e.target.matches || !e.target.matches('[data-al-input]')) return;
    if (e.key === 'Enter') { e.preventDefault(); q.value = e.target.value; save(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  /* 설정에서 로그인 정보를 저장하면 다시 읽는다 */
  window.addEventListener('jt:vault', function () { loadLogin(true); });

  /* ---------- 설정 「마라톤 사이트 로그인 정보」 ----------
     아이디는 칸에 보이고, 비밀번호는 칸에 채우지 않는다(「저장됨 · 바꿀 때만 입력」). 비밀번호 칸을 비워 두고 저장하면 예전 비밀번호를 그대로 둔다 */
  function fillSetup() {
    var id = document.getElementById('mlSiteId');
    if (!id) return;
    loadLogin(true).then(function () {
      id.value = (login.val && login.val.id) || '';
      document.getElementById('mlSitePw').value = '';
      document.getElementById('mlSitePwHint').textContent = login.missing ? 'migration-036 SQL 을 먼저 실행해 주세요' : login.val && login.val.pw ? '저장됨 · 바꿀 때만 입력' : '';
    });
  }
  var setBtn = document.getElementById('tdSettingsBtn');
  if (setBtn) setBtn.addEventListener('click', fillSetup);
  var saveBtn = document.getElementById('mlSiteSave');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    var id = document.getElementById('mlSiteId').value.trim(), pw = document.getElementById('mlSitePw').value;
    var v = { id: id, pw: pw || (login.val && login.val.pw) || '' };
    SB.client.from('staff_vault').upsert({ key: 'marathon_site', value: v }, { onConflict: 'key' }).then(function (r) {
      if (r.error) { toast(/does not exist|schema cache/i.test(r.error.message) ? 'migration-036 SQL 을 먼저 실행해 주세요' : '저장하지 못했습니다 — ' + r.error.message, 'bad'); return; }
      toast('마라톤 사이트 로그인 정보를 저장했습니다', 'good');
      window.dispatchEvent(new CustomEvent('jt:vault'));
      fillSetup();
    });
  });

  window.AppLink = { open: open, close: close, boxHtml: boxHtml, current: cur, loadLogin: loadLogin, login: function () { return { loaded: login.loaded, has: login.has }; } };
})();
