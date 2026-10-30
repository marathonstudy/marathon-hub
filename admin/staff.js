/* ============================================================
   staff.js — 더보기 → 「운영진」 (20261031u · migration-047)

   · 코치룸에 들어온 사람 목록: 이름 · 번호 뒤 4자리(이메일 계정은 「이메일 계정」) · 처음 들어온 날 · 마지막 접속
   · [사용 중지] / [다시 사용] — 원장(teacher) 계정 화면에만 보인다. 서버(staff_set_active)도 원장만 받는다.
     사용 중지된 사람은 바로 아무것도 못 읽고(열려 있던 화면도 곧 로그아웃) · 그 사람이 쓴 기록은 그대로 남는다.
   · 팀 가입 코드는 없다 — 조교는 로그인 화면에서 이름 · 번호 8자리 → 원장 승인 뒤 다시 들어온다 (migration-051)
   · 맨 위 「승인 대기 n명」 · 사람마다 [승인] [거절] — 사용 중인 운영진 누구나 (20261031z) · 승인한 사람은 목록에 「○○ 승인」
     「오늘」 맨 위에도 운영진 모두에게 「새 조교 승인 대기: 이름(뒤 4자리) [승인] [거절]」 — 그 자리에서 바로 누른다
     [사용 중지] · [다시 사용]은 지금처럼 원장 계정만
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

  var data = null, pend = null;

  /* 승인 대기 — 사용 중인 운영진 누구나 */
  function loadPending() {
    return Promise.resolve(sb().rpc('staff_pending')).then(function (r) {
      pend = !r.error && r.data ? r.data.list || [] : null;
      return pend;
    }, function () { pend = null; return null; });
  }
  function pendingHtml() {
    if (!pend || !pend.length) return '';
    return '<div class="op-pend"><div class="op-pend__t">승인 대기 ' + pend.length + '명</div>' + pend.map(function (p) {
      return '<div class="op-row op-row--pend" data-email="' + esc(p.email) + '"><div class="op-row__main"><div class="op-row__name">' + esc(p.name) + '</div>' +
        '<div class="op-row__meta num">번호 뒤 4자리 ' + esc(p.last4 || '—') + ' · ' + esc(fmtDT(p.created_at)) + ' 요청</div></div>' +
        '<div class="op-row__acts"><button class="btn btn--sm btn--primary" type="button" data-op="approve">승인</button><button class="btn btn--sm btn--danger" type="button" data-op="reject">거절</button></div></div>';
    }).join('') + '</div>';
  }

  function load() {
    var host = $('#staffList');
    return loadPending().then(function () { return sb().rpc('staff_list'); }).then(function (r) {
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
    host.innerHTML = pendingHtml() + '<div class="op-list">' + list.map(function (s) {
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
            (s.approved_by ? ' · ' + esc(s.approved_by) + ' 승인' : '') +
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
    if (b.dataset.op === 'approve' || b.dataset.op === 'reject') { decide(email, b.dataset.op === 'approve').then(load); return; }
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

  /* 승인 · 거절 — 운영진 창 · 「오늘」 맨 위가 같이 쓴다 */
  function decide(email, yes) {
    var pp = (pend || []).find(function (x) { return x.email === email; }) || {};
    return (yes ? Promise.resolve(true) : UI.confirmAsk('거절', (pp.name || '이 사람') + ' 님의 가입 요청을 거절합니다. 그 번호로는 「승인되지 않은 번호입니다」가 뜹니다.', '거절'))
      .then(function (ok) { return ok ? sb().rpc('staff_approve', { p_email: email, p_ok: yes }) : null; })
      .then(function (r) {
        if (!r) return;
        if (r.error) throw new Error(r.error.message);
        toast(yes ? (pp.name || '') + ' 님을 승인했습니다 — 같은 이름 · 번호로 다시 들어오면 됩니다' : '거절했습니다', 'good');
        window.dispatchEvent(new CustomEvent('jt:staff-pending'));
      }).catch(function (x) { toast(x.message, 'bad'); });
  }

  /* 「오늘」 맨 위 — 운영진 모두에게 「새 조교 승인 대기: 이름(뒤 4자리) [승인] [거절]」 (today.js 가 그린 자리 #tdPending) */
  function paintToday() {
    var el = document.getElementById('tdPending');
    if (!el) return;
    loadPending().then(function (list) {
      list = list || [];
      el.hidden = !list.length;
      el.innerHTML = list.map(function (p) {
        return '<div class="td-pending" data-email="' + esc(p.email) + '"><span class="td-pending__t">새 조교 승인 대기: <b>' + esc(p.name) + '</b>(' + esc(p.last4 || '—') + ')</span>' +
          '<button type="button" class="btn btn--sm btn--primary" data-pend="approve">승인</button><button type="button" class="btn btn--sm btn--danger" data-pend="reject">거절</button></div>';
      }).join('');
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pend]');
    if (!b) return;
    decide(b.closest('[data-email]').dataset.email, b.dataset.pend === 'approve').then(paintToday);
  });
  window.addEventListener('jt:staff-pending', paintToday);

  window.Staff = { open: open, reload: load, paintToday: paintToday };
})();
