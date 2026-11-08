/* ============================================================
   staff.js — 더보기 → 「운영진」 (20261031u · migration-047)

   · 코치룸에 들어온 사람 목록: 이름 · 번호 뒤 4자리(이메일 계정은 「이메일 계정」) · 처음 들어온 날 · 마지막 접속
   · [사용 중지] / [다시 사용] — 원장(teacher) 계정 화면에만 보인다. 서버(staff_set_active)도 원장만 받는다.
     사용 중지된 사람은 바로 아무것도 못 읽고(열려 있던 화면도 곧 로그아웃) · 그 사람이 쓴 기록은 그대로 남는다.
   · 팀 가입 코드는 없다 — 조교는 로그인 화면에서 이름 · 번호 8자리 → 원장 승인 뒤 다시 들어온다 (migration-051)
   · 맨 위 「승인 대기 n명」 · 사람마다 [승인] [거절] — 사용 중인 운영진 누구나 (20261031z) · 승인한 사람은 목록에 「○○ 승인」
     「오늘」 맨 위에도 운영진 모두에게 「새 조교 승인 대기: 이름(뒤 4자리) [승인] [거절]」 — 그 자리에서 바로 누른다
     [사용 중지] · [다시 사용]은 지금처럼 원장 계정만
   · 「수업 전 과제 현황 받기」 켜짐/꺼짐 — 사람마다 (기본 켜짐 · 나 자신 · 원장은 누구나 · staff_hwstat_set · migration-069 · 20261108a)
     번호가 없으면 「번호 없음」 (원장 = 내 시험 번호 · 조교 = 로그인 번호) · 맨 위 「상담 기준 60%」 (hw_status_cut_set · 운영진 누구나)
   · 맨 위 [조교 추가] — 원장만 (staff_add · migration-070 · 20261108b): 이름 + 휴대폰 번호(어떤 형식이든) → 승인 대기 없이 바로 사용 중
     로그인은 지금처럼 이름 + 번호 8자리 · 과제 현황 문자 · 필기 알림(운영진)도 바로 그 번호로
   · 줄마다 번호는 뒤 4자리만 「010-****-5678」 · 없으면 「번호 없음 · 넣기」 · 있으면 [번호 바꾸기] — 원장만 (staff_phone_set)
     조교 번호를 바꾸면 로그인 번호도 같이 바뀐다고 확인창에서 알린다 · 원장 번호는 문자용만 (원장 로그인은 이메일 + 비밀번호)
     같은 번호가 다른 운영진에 있으면 서버가 막고 「이미 등록된 번호입니다 — 김조교(사용 중)」
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
    host.innerHTML = addHtml() + pendingHtml() + hwsHead() + '<div class="op-list">' + list.map(function (s) {
      var me = s.email === data.me;
      var acts = !data.owner ? '' : me ? '<span class="muted-note">나</span>'
        : s.active ? '<button class="btn btn--sm btn--danger" type="button" data-op="off">사용 중지</button>'
                   : '<button class="btn btn--sm" type="button" data-op="on">다시 사용</button>';
      return '<div class="op-row' + (s.active ? '' : ' is-off') + '" data-email="' + esc(s.email) + '">' +
        '<div class="op-row__main">' +
          '<div class="op-row__name">' + esc(s.name || '(이름 없음)') +
            (s.role === 'teacher' ? ' <span class="tb-badge tb-badge--paid">원장</span>' : '') +
            (s.active ? '' : ' <span class="tb-badge tb-badge--waived">사용 중지</span>') + '</div>' +
          '<div class="op-row__meta num">' + phoneMeta(s) +
            ' · 처음 들어온 날 ' + esc(fmt(s.created_at)) + ' · 마지막 접속 ' + esc(fmtDT(s.last_seen_at)) +
            (s.active ? '' : '<br>' + esc(s.disabled_by || '') + ' · ' + esc(fmtDT(s.disabled_at)) + ' 에 중지') + '</div>' +
          byHtml(s) +
          (s.active ? hwsRow(s, me) : '') +
          (editing === s.email ? phoneForm(s) : '') +
        '</div>' +
        (acts ? '<div class="op-row__acts">' + acts + '</div>' : '') +
      '</div>';
    }).join('') + '</div>';
  }

  /* 각 줄 작게 「추가한 사람: 김민서 · 11/8」 (080 · 20261108l) — 직접 가입해 승인받은 사람은 「승인한 사람: 원장 · 11/3」 */
  function md(iso) { var d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); }
  function byHtml(s) {
    if (s.addedBy) return '<div class="op-row__by">추가한 사람: ' + esc(s.addedBy) + (s.addedAt ? ' · ' + esc(md(s.addedAt)) : '') + '</div>';
    if (s.approved_by) return '<div class="op-row__by">승인한 사람: ' + esc(s.approved_by) + (s.approved_at ? ' · ' + esc(md(s.approved_at)) : '') + '</div>';
    return '';
  }
  /* 조교 추가 · 번호 넣기 · 바꾸기 (migration-070) — 원장 · 080 부터 사용 중인 조교도 [조교 추가] (서버가 「사용 중인 운영진」인지 본다)
     번호 바꾸기 · 사용 중지는 원장만 · 조교는 자기 번호만 · 070 전이면 (smsLast4 칸이 없어) 옛 표시 그대로 */
  var adding = false, editing = '';
  function canAdd() { return !!data && (data.owner || data.assistAdd) && data.canAdd !== false; }
  function canPhone(s) { return !!data && (data.owner || (data.assistAdd && s.email === data.me)); }
  function addHtml() {
    if (!canAdd()) return '';
    if (!adding) return '<div class="op-add"><button class="btn btn--primary" type="button" id="opAddOpen">조교 추가</button>' +
      '<span class="muted-note">이름 · 휴대폰 번호만 넣으면 바로 사용 중 · 로그인은 이름 + 번호 8자리</span></div>';
    return '<form class="op-add op-add--form" id="opAddForm" autocomplete="off">' +
      '<label class="op-add__f"><span>이름</span><input class="input" id="opAddName" maxlength="20" placeholder="홍길동"></label>' +
      '<label class="op-add__f"><span>휴대폰 번호</span><input class="input num" id="opAddPhone" inputmode="tel" maxlength="20" placeholder="010-1234-5678"></label>' +
      '<div class="op-add__acts"><button class="btn btn--primary" type="submit" id="opAddSave">추가</button><button class="btn" type="button" id="opAddCancel">취소</button></div>' +
      '<p class="muted-note op-add__hint">승인 대기 없이 바로 「사용 중」입니다. 조교는 로그인 화면에서 이 이름 + 번호 8자리로 들어옵니다. 과제 현황 문자 · 필기 알림도 이 번호로 갑니다.</p></form>';
  }
  function mask(l4) { return '010-****-' + l4; }
  function phoneMeta(s) {
    if (!('smsLast4' in s)) return s.phone ? '번호 뒤 4자리 ' + esc(s.last4 || '—') : '이메일 계정';
    var t = s.smsLast4 ? '<span class="op-phone">' + esc(mask(s.smsLast4)) + '</span>' : '<span class="op-phone is-none">번호 없음</span>';
    if (canPhone(s)) t += s.smsLast4 ? ' <button class="link-btn" type="button" data-phone-edit>번호 바꾸기</button>' : ' · <button class="link-btn" type="button" data-phone-edit>넣기</button>';
    if (!s.phone) t += ' · 이메일 계정';
    return t;
  }
  function phoneForm(s) {
    return '<form class="op-phoneform" data-phone-form autocomplete="off"><input class="input num" data-phone-in inputmode="tel" maxlength="20" placeholder="010-1234-5678" aria-label="' + esc(s.name || '') + ' 휴대폰 번호">' +
      '<button class="btn btn--sm btn--primary" type="submit">저장</button><button class="btn btn--sm" type="button" data-phone-cancel>취소</button>' +
      (s.role === 'teacher' ? '<small class="muted-note">문자용 번호만 — 원장 로그인은 이메일 + 비밀번호 그대로</small>'
        : '<small class="muted-note">조교 로그인 번호도 이 번호로 바뀝니다</small>') + '</form>';
  }
  /* 화면에서 먼저 보는 번호 형식 — 서버(_staff_ph8)와 같다 */
  function ph8(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (/^8210\d{8}$/.test(d)) d = '0' + d.slice(2);
    if (/^\d{8}$/.test(d)) d = '010' + d;
    return /^010\d{8}$/.test(d) ? d.slice(3) : '';
  }
  function addSubmit() {
    var nm = ($('#opAddName').value || '').trim(), p = ph8($('#opAddPhone').value);
    if (!nm) { toast('조교 이름을 넣어 주세요', 'bad'); $('#opAddName').focus(); return; }
    if (!p) { toast('휴대폰 번호를 010-1234-5678 처럼 넣어 주세요', 'bad'); $('#opAddPhone').focus(); return; }
    var b = $('#opAddSave'); b.disabled = true;
    Promise.resolve(sb().rpc('staff_add', { p_name: nm, p_phone: '010' + p })).then(function (r) {
      b.disabled = false;
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast(nm + ' 님을 추가했습니다 — 바로 사용 중 · 로그인은 이름 + 번호 8자리', 'good');
      adding = false;
      window.dispatchEvent(new CustomEvent('jt:staff-pending'));
      return load();
    }, function (x) { b.disabled = false; toast(x.message, 'bad'); });
  }
  function phoneSubmit(form) {
    var em = form.closest('[data-email]').dataset.email;
    var s = (data.staff || []).find(function (x) { return x.email === em; }) || {};
    var p = ph8(form.querySelector('[data-phone-in]').value);
    if (!p) { toast('휴대폰 번호를 010-1234-5678 처럼 넣어 주세요', 'bad'); return; }
    var login = s.role !== 'teacher';
    var change = !!s.smsLast4 || (login && !!s.phone);
    UI.confirmAsk(change ? '번호 바꾸기' : '번호 넣기', (s.name || '이 사람') + ' 님 번호를 ' + mask(p.slice(4)) + ' 로 ' + (change ? '바꿉니다. ' : '넣습니다. ') +
        (login ? '로그인 번호도 같이 바뀌어, 다음 로그인부터 이 번호 8자리로 들어옵니다. 과제 현황 문자 · 필기 알림도 이 번호로 갑니다.'
               : '문자용 번호만 바뀌고, 원장 로그인은 이메일 + 비밀번호 그대로입니다.'), change ? '바꾸기' : '넣기')
      .then(function (ok) {
        if (!ok) return null;
        return sb().rpc('staff_phone_set', { p_email: em, p_phone: '010' + p });
      }).then(function (r) {
        if (!r) return;
        if (r.error) throw new Error(r.error.message);
        toast((s.name || '') + ' 님 번호를 ' + mask(p.slice(4)) + ' 로 저장했습니다' + (login ? ' — 로그인 번호도 같이 바뀌었습니다' : ''), 'good');
        editing = '';
        return load();
      }).catch(function (x) { toast(x.message, 'bad'); });
  }
  $('#staffList').addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'opAddForm') { addSubmit(); return; }
    if (e.target.matches('[data-phone-form]')) phoneSubmit(e.target);
  });

  /* 수업 전 과제 현황 (migration-069) — 069 전이면 칸이 없어 아무것도 안 보인다 */
  function hwsHead() {
    if (!data || data.hwCut == null) return '';
    return '<div class="op-hws"><span class="op-hws__t">수업 전 과제 현황 문자</span><span class="muted-note">수업 30분 전 · 운영진에게만 · 이번 주 퍼펙트 · 학생 완료율 명단</span>' +
      '<label class="tdc-tedit__f tdc-tedit__f--min"><span>상담 기준</span><input type="number" class="input" id="opHwsCut" inputmode="numeric" min="1" max="100" value="' + esc(data.hwCut) + '"><span>% 미만</span></label>' +
      '<button class="btn btn--sm" type="button" id="opHwsCutSave">저장</button></div>';
  }
  function hwsRow(s, me) {
    if (!data || data.hwCut == null || s.hwStatus == null) return '';
    var can = me || data.owner, on = s.hwStatus !== false;
    var lbl = '수업 전 과제 현황 받기 ' + (on ? '켜짐' : '꺼짐');
    return '<div class="op-row__hws">' + (can
      ? '<button class="btn btn--sm op-hwsbtn' + (on ? ' is-on' : '') + '" type="button" data-hws-on="' + (on ? '0' : '1') + '" aria-pressed="' + on + '">' + esc(lbl) + '</button>'
      : '<span class="muted-note">' + esc(lbl) + '</span>') +
      (on && !s.smsPhone && !('smsLast4' in s) ? ' <small class="muted-note">번호 없음' + (s.role === 'teacher' ? ' — 문자 발송 → 연결 상태에 내 시험 번호를 넣어 주세요' : '') + '</small>' : '') + '</div>';
  }
  $('#staffList').addEventListener('click', function (e) {
    if (e.target.closest('#opAddOpen')) { adding = true; render(); var n = $('#opAddName'); if (n) n.focus(); return; }
    if (e.target.closest('#opAddCancel')) { adding = false; render(); return; }
    var pe = e.target.closest('[data-phone-edit]');
    if (pe && data) { editing = pe.closest('[data-email]').dataset.email; render(); var f = $('#staffList [data-phone-in]'); if (f) f.focus(); return; }
    if (e.target.closest('[data-phone-cancel]')) { editing = ''; render(); return; }
    if (e.target.closest('#opHwsCutSave')) {
      var v = parseInt(($('#opHwsCut') || {}).value, 10);
      if (!(v >= 1 && v <= 100)) { toast('상담 기준은 1~100% 로 정해 주세요', 'bad'); return; }
      sb().rpc('hw_status_cut_set', { p_cut: v }).then(function (r) {
        if (r.error) { toast(r.error.message, 'bad'); return; }
        toast('상담 기준을 ' + v + '% 로 저장했습니다 — 다음 과제 현황 문자부터', 'good');
        data.hwCut = v;
      });
      return;
    }
    var hb = e.target.closest('[data-hws-on]');
    if (hb && data) {
      var em = hb.closest('[data-email]').dataset.email, on = hb.dataset.hwsOn === '1';
      hb.disabled = true;
      sb().rpc('staff_hwstat_set', { p_email: em, p_on: on }).then(function (r) {
        hb.disabled = false;
        if (r.error) { toast(r.error.message, 'bad'); return; }
        toast('수업 전 과제 현황 받기를 ' + (on ? '켰습니다' : '껐습니다'), 'good');
        var s = (data.staff || []).find(function (x) { return x.email === em; });
        if (s) s.hwStatus = on;
        render();
      });
      return;
    }
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
    adding = false; editing = '';
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
