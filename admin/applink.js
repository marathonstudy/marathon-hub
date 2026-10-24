/* ============================================================
   applink.js — 과제 링크(마라톤 앱 공유 링크) 연결 창 (20261031d)

   「오늘」 · 레포트 발송 학생 줄의 회색 「과제 링크 연결 필요」 칩, 반 카드의 「과제 링크 연결 필요 n명」을 누르면 열린다.
   · 한 명이면 그 학생 칸 하나 · 여러 명이면 차례로 「2/5」 — [저장하고 다음] · [건너뛰기]
   · 학생 수정 창의 「마라톤 앱 공유 링크」 칸과 같은 값(student_links.app_share_code)을 저장한다
   · 학부모 링크 코드가 없는 학생은 같이 발급한다 (과제 기록은 그 코드로 불러온다)
   · 저장하면 jt:applink { sid } — 「오늘」이 그 학생 과제 기록을 바로 불러온다
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function toast(m, k) { if (window.UI) UI.toast(m, k); }

  var q = { list: [], i: 0, saved: 0, busy: false };

  /* list = [{ id, name, cls }] */
  function open(list) {
    list = (list || []).filter(function (x) { return x && x.id; });
    if (!list.length || !$('#appLinkModal')) return;
    q = { list: list, i: 0, saved: 0, busy: false };
    show();
    $('#appLinkModal').showModal();
  }

  function show() {
    var s = q.list[q.i], n = q.list.length;
    $('#appLinkTitle').textContent = '과제 링크 연결' + (n > 1 ? ' · ' + (q.i + 1) + '/' + n : '');
    $('#appLinkWho').textContent = (s.name || '') + (s.cls ? ' · ' + s.cls : '');
    var cur = Store.linkOf(s.id).appCode;
    $('#appLinkInput').value = cur ? 'https://marathonstudy.com/share/report/' + cur : '';
    $('#appLinkErr').textContent = '';
    $('#appLinkErr').hidden = true;
    $('#btnAppLinkSave').textContent = n > 1 && q.i < n - 1 ? '저장하고 다음' : '저장';
    $('#btnAppLinkSkip').hidden = n < 2 || q.i >= n - 1;
    setTimeout(function () { $('#appLinkInput').focus(); }, 30);
  }

  function err(t) { $('#appLinkErr').textContent = t; $('#appLinkErr').hidden = !t; }

  function next() {
    if (q.i < q.list.length - 1) { q.i++; show(); return; }
    $('#appLinkModal').close();
    if (q.list.length > 1) toast('과제 링크 ' + q.saved + '명 연결했습니다', q.saved ? 'good' : '');
  }

  function save() {
    if (q.busy) return;
    var s = q.list[q.i];
    var code = Store.extractAppCode($('#appLinkInput').value);
    if (code === '') { err('앱 공유 링크를 붙여 넣어 주세요.'); return; }
    if (code === null) { err('앱 공유 링크를 알아볼 수 없습니다. marathonstudy.com/share/report/… 주소를 그대로 붙여 넣어 주세요.'); return; }
    var cur = Store.linkOf(s.id);
    var patch = { appCode: code };
    if (!cur.hubCode) patch.hubCode = Store.randomCode(24);          /* 과제 기록은 학부모 링크 코드로 불러온다 */
    q.busy = true;
    $('#btnAppLinkSave').disabled = true;
    DB.saveLink(s.id, patch).then(function (l) {
      var c = Store.linkOf(s.id);
      c.appCode = l.appCode || code;
      c.appUpdatedAt = l.appUpdatedAt;
      if (patch.hubCode) { c.hubCode = l.hubCode || patch.hubCode; c.hubIssuedAt = l.hubIssuedAt || new Date().toISOString(); }
      Store.setLinkLocal(s.id, c);
      q.saved++;
      q.busy = false;
      $('#btnAppLinkSave').disabled = false;
      window.dispatchEvent(new CustomEvent('jt:applink', { detail: { sid: s.id, hubCode: c.hubCode } }));
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
      if (q.list.length === 1) toast((s.name || '') + ' 학생 과제 링크를 연결했습니다', 'good');
      next();
    }).catch(function (e) {
      q.busy = false;
      $('#btnAppLinkSave').disabled = false;
      err('저장하지 못했습니다 — ' + (e && e.message || e));
    });
  }

  if ($('#appLinkModal')) {
    $('#btnAppLinkSave').addEventListener('click', save);
    $('#btnAppLinkSkip').addEventListener('click', next);
    $('#btnAppLinkClose').addEventListener('click', function () { $('#appLinkModal').close(); });
    $('#appLinkInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  window.AppLink = { open: open };
})();
