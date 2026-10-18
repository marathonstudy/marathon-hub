/* ============================================================
   classes.js — 반 관리 (① 명단 → [반 관리] · 선생님만 보인다)

   · 이름 바꾸기 — 그 반의 모든 기록이 새 이름을 따라간다 (서버 함수 class_rename 이 한 번에)
   · 보관 / 되살리기 — 보관한 반은 모든 반 목록에서 숨긴다. 기록 · 학생은 그대로
   · 삭제 — 학생(퇴원생 포함) 0명 · 기록 0건인 반만 버튼이 보인다
   전부 서버 함수(class_*)가 teacher 인지 다시 확인한다. 바뀐 내용은 class_log 에 남는다.
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
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function classKey(n) { return String(n || '').replace(/\s+/g, '').replace(/반$/, '').toLowerCase(); }

  var modal = $('#classAdminModal');
  var data = null;
  var editing = '';          /* 이름을 바꾸고 있는 반 */
  var busy = false;

  var TABLE_NAMES = {
    students: '학생', class_info: '반 현황', class_codes: '공용 링크', class_notices: '반 공지', week_common: '레포트 반 공통',
    tb_class_academy: '교재 학원', tb_class_books: '교재', tb_class_dates: '교재 일정', tb_issues: '교재 지급',
    tb_order_lines: '교재 주문', tb_bill_plans: '청구 계획', tb_bills: '청구서', note_photos: '필기 사진', exams: '시험'
  };

  function isMissing(msg) { return /Could not find the function|does not exist|schema cache/i.test(msg || ''); }

  function load() {
    return sb().rpc('class_admin_get').then(function (r) {
      if (r.error) {
        $('#caBody').innerHTML = isMissing(r.error.message)
          ? '<p class="panel__hint">반 관리용 함수가 아직 없습니다. Supabase SQL Editor 에서 <code>migration-010-class-admin.sql</code> 을 먼저 실행해 주세요.</p>'
          : '<p class="panel__hint">' + esc(r.error.message) + '</p>';
        data = null;
        return;
      }
      data = r.data;
      if (editing && !data.classes.some(function (c) { return c.name === editing; })) editing = '';
      render();
    });
  }

  function records(c) {
    var p = [];
    if (+c.reports)  p.push('레포트 ' + c.reports);
    if (+c.notices)  p.push('공지 ' + c.notices);
    if (+c.textbook) p.push('교재 ' + c.textbook);
    if (+c.exam)     p.push('시험');
    if (+c.photos)   p.push('필기 ' + c.photos);
    if (+c.info)     p.push('반 현황');
    if (+c.videos)   p.push('영상 ' + c.videos);
    if (+c.files)    p.push('자료 ' + c.files);
    if (+c.summaries) p.push('AI 요약 ' + c.summaries);
    if (+c.reviews)  p.push('복습테스트 ' + c.reviews);
    return p.length ? p.join(' · ') : '<span class="muted-note">없음</span>';
  }

  function canDelete(c) { return +c.active === 0 && +c.records === 0; }

  function row(c, keys) {
    var like = data.classes.filter(function (x) { return x.name !== c.name && classKey(x.name) === classKey(c.name); })
      .map(function (x) { return x.name; });
    var nameCell = editing === c.name
      ? '<div class="ca-rename"><input class="input" id="caNewName" type="text" maxlength="30" autocomplete="off" value="' + esc(c.name) + '">' +
        '<button class="btn btn--sm btn--primary" type="button" data-ca="rename-ok">바꾸기</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-ca="rename-cancel">취소</button></div>'
      : '<span class="roster__name">' + esc(c.name) + '</span>' +
        (like.length ? ' <span class="ca-like" title="이름이 비슷한 반 — 합치지 않습니다">비슷한 이름: ' + esc(like.join(', ')) + '</span>' : '') +
        (c.archived ? '<br><span class="muted-note">보관 — ' + esc(c.archived_by || '') + ' · ' + esc(fmtDT(c.archived_at)) + '</span>' : '');
    var acts = editing === c.name ? '' :
      '<button class="btn btn--sm" type="button" data-ca="rename">이름 바꾸기</button>' +
      (c.archived ? '<button class="btn btn--sm btn--primary" type="button" data-ca="restore">되살리기</button>'
                  : '<button class="btn btn--sm" type="button" data-ca="archive">보관</button>') +
      (canDelete(c) ? '<button class="btn btn--sm btn--danger" type="button" data-ca="delete">삭제</button>' : '');
    return '<tr data-name="' + esc(c.name) + '"' + (c.archived ? ' class="is-archived"' : '') + '>' +
      '<td>' + nameCell + '</td>' +
      '<td class="num">' + (+c.active) + '</td>' +
      '<td class="num">' + (+c.left) + '</td>' +
      '<td>' + records(c) + '</td>' +
      '<td>' + (c.review_q == null ? '<span class="muted-note">—</span>'
        : '<input class="input ca-q" type="number" min="1" max="100" inputmode="numeric" data-ca-q value="' + (+c.review_q) + '" aria-label="복습테스트 기본 문항 수">') + '</td>' +
      '<td class="roster__actions tb-acts">' + acts + '</td></tr>';
  }

  function table(list, empty) {
    if (!list.length) return '<p class="panel__hint">' + empty + '</p>';
    return '<div class="roster-scroll"><table class="roster tb-table ca-table"><thead><tr>' +
      '<th>반</th><th>재원</th><th>퇴원</th><th>기록</th><th title="복습테스트 기본 문항 수 — 그 주만 바꾸기는 ② 작성 반 공통에서">복습 문항</th><th></th></tr></thead><tbody>' +
      list.map(row).join('') + '</tbody></table></div>';
  }

  var ACT = { rename: '이름 바꿈', archive: '보관', restore: '되살림', delete: '삭제' };

  function logLine(l) {
    var what = l.action === 'rename' ? '‘' + l.old_name + '’ → ‘' + l.new_name + '’' : '‘' + l.old_name + '’';
    var d = l.detail || {};
    var extra = '';
    if (l.action === 'rename') {
      extra = Object.keys(d).map(function (k) { return (TABLE_NAMES[k] || k) + ' ' + d[k]; }).join(' · ');
    } else if (l.action === 'archive' && +d.active) {
      extra = '재원생 ' + d.active + '명';
    }
    return '<li><span class="num">' + esc(fmtDT(l.at)) + '</span> <b>' + esc(l.by_name || '') + '</b> — ' +
      esc(ACT[l.action] || l.action) + ' ' + esc(what) + (extra ? ' <span class="muted-note">(' + esc(extra) + ')</span>' : '') + '</li>';
  }

  function render() {
    if (!data) return;
    var on = data.classes.filter(function (c) { return !c.archived; });
    var off = data.classes.filter(function (c) { return c.archived; });
    var showOff = $('#caShowArchived').checked;
    $('#caBody').innerHTML =
      table(on, '반이 없습니다. 학생 추가 창의 반 고르기에서 [+ 새 반 만들기]로 만들 수 있습니다.') +
      '<p class="field__hint">[삭제]는 학생(퇴원생 포함)이 0명이고 레포트 · 공지 · 교재 · 시험 · 필기 기록이 하나도 없는 반에만 보입니다. 기록이 있으면 보관만 할 수 있습니다.</p>' +
      (showOff ? '<div class="extra-head" style="margin-top:14px"><span class="extra-head__title">보관된 반 ' + off.length + '개</span></div>' +
                 table(off, '보관된 반이 없습니다.') : (off.length ? '<p class="field__hint">보관된 반 ' + off.length + '개 — 아래 [보관된 반 보기]를 켜면 되살릴 수 있습니다.</p>' : '')) +
      '<div class="extra-head" style="margin-top:14px"><span class="extra-head__title">최근 변경 기록</span></div>' +
      (data.log.length ? '<ul class="ca-log">' + data.log.map(logLine).join('') + '</ul>' : '<p class="panel__hint">아직 없습니다.</p>');
    if (editing) {
      var inp = $('#caNewName');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function find(name) { return data && data.classes.find(function (c) { return c.name === name; }); }

  /* 서버에서 바꾼 뒤 — 이 창 · 다른 탭들의 반 목록을 새로 */
  function after(msg) {
    toast(msg, 'good');
    return Promise.all([load(), Store.refreshAll().catch(function () {})]).then(function () {
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
    });
  }

  function fail(x) {
    var m = x && x.message || String(x);
    toast(m, 'bad');
    if (/없습니다|먼저/.test(m)) load();
  }

  function call(fn, args) {
    return sb().rpc(fn, args).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }

  function doRename(c) {
    var w = ($('#caNewName').value || '').replace(/\s+/g, ' ').trim();
    if (!w) { toast('새 반 이름을 적어 주세요', 'bad'); return; }
    if (w === c.name) { editing = ''; render(); return; }
    if (w.length > 30) { toast('반 이름은 30자까지 적을 수 있습니다', 'bad'); return; }
    if (find(w)) { toast('‘' + w + '’ 반이 이미 있습니다' + (find(w).archived ? ' (보관된 반)' : '') + '. 다른 이름을 적어 주세요', 'bad'); return; }
    var like = data.classes.filter(function (x) { return x.name !== c.name && classKey(x.name) === classKey(w); });
    UI.confirmAsk('반 이름 바꾸기',
      '‘' + c.name + '’ → ‘' + w + '’ 으로 바꿉니다. 학생 ' + (+c.active + +c.left) + '명과 레포트 · 반 현황 · 공용 링크 · 반 공지 · 시험 · 교재 · 필기 기록이 모두 새 이름을 따라갑니다.' +
      ' 학부모가 받은 반 공지 링크는 그대로 열립니다.' +
      (like.length ? ' (이름이 비슷한 반: ' + like.map(function (x) { return x.name; }).join(', ') + ' — 합치지 않습니다)' : ''), '바꾸기')
      .then(function (ok) {
        if (!ok) return;
        busy = true;
        return call('class_rename', { p_old: c.name, p_new: w }).then(function () {
          editing = '';
          return after('‘' + c.name + '’ 반 이름을 ‘' + w + '’ 으로 바꿨습니다');
        });
      }).catch(fail).then(function () { busy = false; });
  }

  function doArchive(c) {
    busy = true;
    call('class_archive', { p_name: c.name, p_archive: true, p_confirm: false }).then(function (r) {
      if (r && r.need_confirm) {
        return UI.confirmAsk('반 보관',
          '재원생 ' + r.active + '명이 있습니다. 보관하면 학생 추가 · 작성 · 반 공지 · 시험 · 교재 · 「오늘」 반 카드 등 모든 반 목록에서 ‘' + c.name + '’ 반이 숨겨집니다.' +
          ' 학생과 기록은 그대로이고, 학생은 명단과 「오늘」의 챙겨야 할 학생에 계속 나옵니다. 그래도 보관할까요?', '보관')
          .then(function (ok) {
            if (!ok) return;
            return call('class_archive', { p_name: c.name, p_archive: true, p_confirm: true })
              .then(function () { return after('‘' + c.name + '’ 반을 보관했습니다'); });
          });
      }
      return after('‘' + c.name + '’ 반을 보관했습니다');
    }).catch(fail).then(function () { busy = false; });
  }

  function doRestore(c) {
    busy = true;
    call('class_archive', { p_name: c.name, p_archive: false, p_confirm: false })
      .then(function () { return after('‘' + c.name + '’ 반을 되살렸습니다'); })
      .catch(fail).then(function () { busy = false; });
  }

  function doDelete(c) {
    UI.confirmAsk('반 삭제', '‘' + c.name + '’ 반을 완전히 지웁니다. 학생과 기록이 하나도 없는 반이라 지워도 잃는 기록은 없습니다.', '삭제')
      .then(function (ok) {
        if (!ok) return;
        busy = true;
        return call('class_delete', { p_name: c.name }).then(function () { return after('‘' + c.name + '’ 반을 지웠습니다'); });
      }).catch(fail).then(function () { busy = false; });
  }

  $('#caBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ca]');
    if (!b || busy) return;
    var c = find(b.closest('tr').dataset.name);
    if (!c) return;
    var act = b.dataset.ca;
    if (act === 'rename') { editing = c.name; render(); return; }
    if (act === 'rename-cancel') { editing = ''; render(); return; }
    if (act === 'rename-ok') { doRename(c); return; }
    if (act === 'archive') doArchive(c);
    if (act === 'restore') doRestore(c);
    if (act === 'delete') doDelete(c);
  });

  /* 복습테스트 기본 문항 수 (migration-013) — 칸에서 나오면 저장. 이미 만들어진 주는 그대로, 앞으로 생기는 주부터 */
  $('#caBody').addEventListener('change', function (e) {
    if (e.target.dataset.caQ == null) return;
    var c = find(e.target.closest('tr').dataset.name);
    var q = Math.round(Number(e.target.value));
    if (!c) return;
    if (!(q >= 1 && q <= 100)) { UI.toast('문항 수는 1 ~ 100 으로 적어 주세요', 'bad'); e.target.value = c.review_q; return; }
    sb().rpc('class_review_q_set', { p_name: c.name, p_q: q }).then(function (r) {
      if (r.error) { UI.toast(/Could not find the function|schema cache/i.test(r.error.message) ? 'migration-013 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); e.target.value = c.review_q; return; }
      c.review_q = q;
      UI.toast('‘' + c.name + '’ 복습테스트 기본 ' + q + '문항 — 앞으로 생기는 주부터', 'good');
    });
  });

  $('#caBody').addEventListener('keydown', function (e) {
    if (e.target.id !== 'caNewName') return;
    if (e.key === 'Enter') { e.preventDefault(); var c = find(editing); if (c && !busy) doRename(c); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = ''; render(); }
  });

  $('#caShowArchived').addEventListener('change', render);
  $('#btnClassAdminClose').addEventListener('click', function () { modal.close(); });

  $('#btnClassAdmin').addEventListener('click', function () {
    editing = '';
    data = null;
    $('#caBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    modal.showModal();
    load();
  });

  /* 선생님 계정에만 버튼을 보인다 (서버 함수도 선생님인지 다시 확인한다) */
  window.addEventListener('jt:loaded', function () {
    $('#btnClassAdmin').hidden = true;
    DB.myStaff().then(function (m) { $('#btnClassAdmin').hidden = !(m && m.role === 'teacher'); }).catch(function () {});
  });

  /* 다른 기기에서 반이 바뀌면 — 이름을 고치는 중이 아니면 새로 */
  window.addEventListener('jt:refreshed', function (e) {
    if (modal.open && !editing && !busy && !(e.detail && e.detail.local)) load();
  });

})();
