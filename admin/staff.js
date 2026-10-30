/* ============================================================
   staff.js — 더보기 → 「운영진」 (20261031u · migration-047)

   · 코치룸에 들어온 사람 목록: 이름 · 번호 뒤 4자리(이메일 계정은 「이메일 계정」) · 처음 들어온 날 · 마지막 접속
   · [사용 중지] / [다시 사용] — 원장(teacher) 계정 화면에만 보인다. 서버(staff_set_active)도 원장만 받는다.
     사용 중지된 사람은 바로 아무것도 못 읽고(열려 있던 화면도 곧 로그아웃) · 그 사람이 쓴 기록은 그대로 남는다.
   · 팀 가입 코드는 없다 — 조교는 로그인 화면에서 이름 · 번호 8자리로 바로 들어온다.
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$;
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }
  function fmtDT(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  var data = null;

  function load() {
    var host = $('#staffList');
    return sb().rpc('staff_list').then(function (r) {
      if (r.error) {
        host.innerHTML = /Could not find the function|does not exist|schema cache/i.test(r.error.message)
          ? '<p class="panel__hint">운영진 목록 함수가 아직 없습니다. <code>migration-047-phone-login.sql</code> 을 먼저 실행해 주세요.</p>'
          : '<p class="panel__hint">' + esc(r.error.message) + '</p>';
        return;
      }
      data = r.data;
      render();
    });
  }

  function render() {
    var host = $('#staffList');
    var list = data.staff || [];
    $('#staffDesc').textContent = list.filter(function (s) { return s.active; }).length + '명 사용 중' +
      (data.owner ? ' · 사용 중지하면 그 사람은 바로 못 들어오고, 쓴 기록은 그대로 남습니다.' : '');
    host.innerHTML = '<div class="op-list">' + list.map(function (s) {
      var me = s.email === data.me;
      var acts = !data.owner ? '' : me ? '<span class="muted-note">나</span>'
        : s.active ? '<button class="btn btn--sm btn--danger" type="button" data-op="off">사용 중지</button>'
                   : '<button class="btn btn--sm" type="button" data-op="on">다시 사용</button>';
      return '<div class="op-row' + (s.active ? '' : ' is-off') + '" data-email="' + esc(s.email) + '">' +
        '<div class="op-row__main">' +
          '<div class="op-row__name">' + esc(s.name || '(이름 없음)') +
            (s.role === 'teacher' ? ' <span class="tb-badge tb-badge--paid">원장</span>' : '') +
            (s.active ? '' : ' <span class="tb-badge tb-badge--waived">사용 중지</span>') + '</div>' +
          '<div class="op-row__meta num">' + (s.phone ? '번호 뒤 4자리 ' + esc(s.last4 || '—') : '이메일 계정') +
            ' · 처음 들어온 날 ' + esc(fmt(s.created_at)) + ' · 마지막 접속 ' + esc(fmtDT(s.last_seen_at)) +
            (s.active ? '' : '<br>' + esc(s.disabled_by || '') + ' · ' + esc(fmtDT(s.disabled_at)) + ' 에 중지') + '</div>' +
        '</div>' +
        (acts ? '<div class="op-row__acts">' + acts + '</div>' : '') +
      '</div>';
    }).join('') + '</div>';
  }

  $('#staffList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-op]');
    if (!b || !data) return;
    var email = b.closest('[data-email]').dataset.email;
    var s = (data.staff || []).find(function (x) { return x.email === email; }) || {};
    var on = b.dataset.op === 'on';
    var ask = on ? Promise.resolve(true)
      : UI.confirmAsk('사용 중지', (s.name || '이 사람') + ' 님을 사용 중지합니다. 바로 아무것도 볼 수 없게 되고, 쓴 기록은 그대로 남습니다.', '사용 중지');
    ask.then(function (ok) {
      if (!ok) return null;
      return sb().rpc('staff_set_active', { p_email: email, p_active: on });
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw new Error(r.error.message);
      toast(on ? '다시 사용하게 했습니다' : '사용 중지했습니다', 'good');
      return load();
    }).catch(function (x) { toast(x.message, 'bad'); });
  });

  function open() {
    $('#staffList').innerHTML = '<p class="panel__hint">운영진 목록을 불러오는 중…</p>';
    $('#staffDesc').textContent = '';
    $('#staffModal').showModal();
    load().catch(function (x) { $('#staffList').innerHTML = '<p class="panel__hint">' + esc(x.message) + '</p>'; });
  }
  $('#staffClose').addEventListener('click', function () { $('#staffModal').close(); });

  window.Staff = { open: open, reload: load };
})();
