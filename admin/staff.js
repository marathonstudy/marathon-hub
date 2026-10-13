/* ============================================================
   staff.js — 직원 관리 (「오늘」 [설정] 창 안 · teacher 만 보인다)

   · 팀 가입 코드 보기 · 복사 · 새로 만들기 · 직접 바꾸기 (바꾸면 옛 코드로는 가입 불가)
   · 직원 목록: 이름 · 이메일 · 역할 · 가입일 · 마지막 접속 · 상태
   · [사용 중지] / [다시 사용] · [teacher 로] / [조교로]
   전부 서버 함수(staff_*)가 teacher 인지 다시 확인한다. 자기 자신 · 마지막 teacher 는 바꿀 수 없다.
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
  var ROLE = { teacher: '선생님', assistant: '조교' };

  /* 헷갈리는 글자(0 O 1 I l)를 뺀 10자리 */
  function newCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var buf = new Uint8Array(20), out = '';
    crypto.getRandomValues(buf);
    for (var i = 0; i < buf.length && out.length < 10; i++) if (buf[i] < 224) out += A[buf[i] % 32];
    return out.length === 10 ? out : newCode();
  }

  function load() {
    var host = $('#staffAdmin');
    return sb().rpc('staff_admin_get').then(function (r) {
      if (r.error) {
        host.innerHTML = /Could not find the function|does not exist|schema cache/i.test(r.error.message)
          ? '<p class="panel__hint">직원 관리용 함수가 아직 없습니다. <code>migration-008-staff-join.sql</code> 을 먼저 실행해 주세요.</p>'
          : '<p class="panel__hint">' + esc(r.error.message) + '</p>';
        return;
      }
      data = r.data;
      render();
    });
  }

  function render() {
    var j = data.join;
    var host = $('#staffAdmin');
    host.innerHTML =
      '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">직원 관리 — 선생님만 보입니다</span></div>' +
      '<div class="sa-code">' +
        '<div class="sa-code__now">팀 가입 코드 ' + (j ? '<code class="sa-code__val" id="saCodeVal">' + esc(j.code) + '</code>' +
          '<button class="btn btn--sm" type="button" id="saCopy">복사</button>'
          : '<b class="tb-warn">아직 없음 — 지금은 가입이 닫혀 있습니다</b>') + '</div>' +
        (j ? '<p class="field__hint">' + esc(j.updated_by || '') + ' · ' + esc(fmtDT(j.updated_at)) + ' 에 바꿈. 조교에게 이 코드를 알려 주면 로그인 화면 [가입하기]에서 바로 가입합니다.</p>' : '') +
        '<div class="toolbar" style="margin-top:8px">' +
          '<input class="input" id="saCodeNew" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="새 코드 (6자 이상, 띄어쓰기 없이)">' +
          '<button class="btn btn--sm" type="button" id="saGen">새 코드 만들기</button>' +
          '<button class="btn btn--sm btn--primary" type="button" id="saSet">이 코드로 바꾸기</button>' +
        '</div>' +
        '<p class="field__hint">바꾸면 옛 코드로는 더 이상 가입할 수 없습니다. 이미 가입한 사람은 그대로입니다.</p>' +
      '</div>' +
      '<div class="roster-scroll" style="margin-top:12px"><table class="roster tb-table sa-table"><thead><tr>' +
        '<th>이름</th><th>이메일</th><th>역할</th><th>가입일</th><th>마지막 접속</th><th>상태</th><th></th></tr></thead><tbody>' +
      data.staff.map(function (s) {
        var me = s.email === data.me;
        var acts = me ? '<span class="muted-note">나</span>' :
          (s.active ? '<button class="btn btn--sm btn--danger" type="button" data-sa="off">사용 중지</button>'
                    : '<button class="btn btn--sm" type="button" data-sa="on">다시 사용</button>') +
          (s.role === 'teacher' ? '<button class="btn btn--sm btn--ghost" type="button" data-sa="assistant">조교로</button>'
                                : '<button class="btn btn--sm btn--ghost" type="button" data-sa="teacher">선생님으로</button>');
        return '<tr data-email="' + esc(s.email) + '"' + (s.active ? '' : ' class="is-archived"') + '>' +
          '<td><span class="roster__name">' + esc(s.name || '') + '</span></td>' +
          '<td class="sa-email">' + esc(s.email) + '</td>' +
          '<td>' + (ROLE[s.role] || s.role) + '</td>' +
          '<td class="num">' + esc(fmt(s.created_at)) + '</td>' +
          '<td class="num">' + esc(fmtDT(s.last_seen_at)) + '</td>' +
          '<td>' + (s.active ? '<span class="tb-badge tb-badge--paid">사용 중</span>'
                             : '<span class="tb-badge tb-badge--waived">중지</span><br><span class="muted-note">' + esc(s.disabled_by || '') + ' · ' + esc(fmtDT(s.disabled_at)) + '</span>') + '</td>' +
          '<td class="roster__actions tb-acts">' + acts + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function setCode(code, base) {
    return sb().rpc('staff_set_code', { p_code: code, p_base: base }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      if (r.data && r.data.conflict) {
        return UI.conflictAsk('팀 가입 코드').then(function (c) {
          if (c === 'overwrite') return setCode(code, null);
          if (c === 'reload') return load();
        });
      }
      $('#saCodeNew').value = '';
      toast('팀 가입 코드를 바꿨습니다. 옛 코드로는 가입할 수 없습니다', 'good');
      return load();
    });
  }

  $('#staffAdmin').addEventListener('click', function (e) {
    if (e.target.closest('#saCopy')) {
      UI.copyText($('#saCodeVal').textContent).then(function () { toast('코드를 복사했습니다', 'good'); });
      return;
    }
    if (e.target.closest('#saGen')) { $('#saCodeNew').value = newCode(); return; }
    if (e.target.closest('#saSet')) {
      var c = $('#saCodeNew').value.trim();
      if (c.length < 6 || /\s/.test(c)) { toast('코드는 띄어쓰기 없이 6자 이상으로 정해 주세요', 'bad'); return; }
      setCode(c, data.join ? data.join.updated_at : null).catch(function (x) { toast(x.message, 'bad'); });
      return;
    }
    var b = e.target.closest('[data-sa]');
    if (!b) return;
    var email = b.closest('tr').dataset.email;
    var s = data.staff.find(function (x) { return x.email === email; });
    var act = b.dataset.sa;
    var p;
    if (act === 'off') {
      p = UI.confirmAsk('사용 중지', (s.name || email) + ' 님을 사용 중지합니다. 바로 아무것도 볼 수 없게 되고, 남긴 기록은 그대로 남습니다.', '사용 중지')
        .then(function (ok) { return ok ? sb().rpc('staff_set_active', { p_email: email, p_active: false }) : null; });
    } else if (act === 'on') {
      p = sb().rpc('staff_set_active', { p_email: email, p_active: true });
    } else {
      p = UI.confirmAsk('역할 바꾸기', (s.name || email) + ' 님을 ' + ROLE[act] + ' 역할로 바꿉니다.' +
          (act === 'teacher' ? ' 선생님 역할은 기록 삭제·되살리기, 직원 관리, 설정 변경을 할 수 있습니다.' : ''), '바꾸기')
        .then(function (ok) { return ok ? sb().rpc('staff_set_role', { p_email: email, p_role: act }) : null; });
    }
    p.then(function (r) {
      if (!r) return;
      if (r.error) throw new Error(r.error.message);
      toast('바꿨습니다', 'good');
      return load();
    }).catch(function (x) { toast(x.message, 'bad'); });
  });

  /* [설정] 창이 열릴 때 — teacher 면 직원 관리도 */
  $('#tdSettingsBtn').addEventListener('click', function () {
    var host = $('#staffAdmin');
    host.hidden = true;
    host.innerHTML = '';
    DB.myStaff().then(function (m) {
      if (!m || m.role !== 'teacher') return;
      host.hidden = false;
      host.innerHTML = '<p class="panel__hint">직원 목록을 불러오는 중…</p>';
      return load();
    }).catch(function () {});
  });

})();
