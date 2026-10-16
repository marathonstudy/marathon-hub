/* ============================================================
   exams.js — 첫 화면 D-day 띠 · [시험 관리]

   app_settings 의 'exams' 한 줄에 저장한다 (새 표 없음).
     { exams: [{id, name, date, memo}], mode: 'auto'|'fixed', fixedId, byClass: { 반이름: 시험id } }
   어느 시험을 띄울지는 assets/dday.js 의 DDay.pick — SQL _exam_for_class 와 같은 규칙.
   저장할 때 다른 분이 먼저 고쳤으면 묻는다 (updated_at).
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$, $$ = UI.$$;
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var EMPTY = function () { return { exams: [], mode: 'auto', fixedId: '', byClass: {} }; };
  var cfg = EMPTY();
  var cfgAt = '';
  var draft = null;

  function normalize(v) {
    var c = EMPTY();
    if (v && typeof v === 'object') {
      c.exams = Array.isArray(v.exams) ? v.exams.filter(Boolean).map(function (e) {
        return { id: e.id || Store.newId(), name: String(e.name || ''), date: String(e.date || ''), memo: String(e.memo || '') };
      }) : [];
      c.mode = v.mode === 'fixed' ? 'fixed' : 'auto';
      c.fixedId = v.fixedId || '';
      c.byClass = (v.byClass && typeof v.byClass === 'object') ? v.byClass : {};
    }
    return c;
  }

  function load() {
    return DB.getSettingRow('exams').then(function (row) {
      cfg = normalize(row && row.value);
      cfgAt = (row && row.updated_at) || '';
      renderBar();
    }).catch(function (e) { console.error('시험 불러오기 실패', e); });
  }

  /* ---------- 첫 화면 띠 ---------- */

  function renderBar() {
    var today = DDay.today();
    var main = DDay.pick(cfg, null, today);
    var others = DDay.upcoming(cfg, today).filter(function (e) { return !main || e.id !== main.id; }).slice(0, 2);
    $('#ddayMain').hidden = !main;
    $('#ddayNext').hidden = !main || !others.length;
    if (main) $('#ddayMain').textContent = DDay.sentence(main, today, ' 입니다.');
    $('#ddayNext').textContent = others.map(function (e) { return e.name + ' ' + DDay.badge(e, today); }).join(' · ');
  }

  /* ---------- 시험 관리 창 ---------- */

  var modal = $('#examModal');

  function classNames() {
    var set = {};
    Store.getClasses().forEach(function (c) { set[c.name] = true; });
    Object.keys(draft.byClass).forEach(function (n) { if (!Store.isArchivedClass(n)) set[n] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  function examOptions(selected, blankLabel) {
    var today = DDay.today();
    return '<option value="">' + esc(blankLabel) + '</option>' + draft.exams.filter(function (e) { return e.name.trim(); }).map(function (e) {
      var past = e.date && e.date < today;
      return '<option value="' + esc(e.id) + '"' + (e.id === selected ? ' selected' : '') + '>' +
             esc(e.name + (e.date ? ' (' + e.date + ')' : '') + (past ? ' · 지남' : '')) + '</option>';
    }).join('');
  }

  function renderModal() {
    var today = DDay.today();
    var list = draft.exams.slice().sort(function (a, b) { return (a.date || '9') < (b.date || '9') ? -1 : 1; });
    $('#exList').innerHTML = list.length ? list.map(function (e) {
      var past = e.date && e.date < today;
      return '<div class="ex-row' + (past ? ' is-past' : '') + '" data-id="' + esc(e.id) + '">' +
        '<input class="input ex-name" data-ef="name" maxlength="40" placeholder="시험 이름 (예: 수능)" value="' + esc(e.name) + '">' +
        '<input class="input ex-date" data-ef="date" type="date" value="' + esc(e.date) + '">' +
        '<input class="input ex-memo" data-ef="memo" maxlength="80" placeholder="메모 (선택)" value="' + esc(e.memo) + '">' +
        '<span class="ex-badge">' + (past ? '지남' : esc(DDay.badge(e, today))) + '</span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-exdel title="지우기">×</button></div>';
    }).join('') : '<p class="panel__hint">아직 시험이 없습니다. <b>+ 시험 추가</b>를 누르세요.</p>';

    $$('#exMode input').forEach(function (i) { i.checked = i.value === draft.mode; });
    $('#exFixed').innerHTML = examOptions(draft.fixedId, '시험 고르기');
    $('#exFixed').disabled = draft.mode !== 'fixed';

    var names = classNames();
    $('#exByClass').innerHTML = names.length ? names.map(function (n) {
      return '<label class="ex-class"><span class="ex-class__name">' + esc(n) + '</span>' +
        '<select class="select" data-cls="' + esc(n) + '">' + examOptions(draft.byClass[n] || '', '전체 기본 따르기') + '</select></label>';
    }).join('') : '<p class="panel__hint">반이 없습니다.</p>';
    $('#exError').classList.remove('is-on');
  }

  function openModal() {
    draft = JSON.parse(JSON.stringify(cfg));
    draft.openedAt = cfgAt;
    renderModal();
    modal.showModal();
  }

  $('#btnExams').addEventListener('click', function () {
    /* 열기 전에 서버 최신으로 */
    load().then(openModal);
  });
  $('#btnExamCancel').addEventListener('click', function () { modal.close(); });

  $('#btnExamAdd').addEventListener('click', function () {
    draft.exams.push({ id: Store.newId(), name: '', date: '', memo: '' });
    renderModal();
    var rows = $$('#exList .ex-row');
    var last = rows.find(function (r) { return !r.querySelector('[data-ef="name"]').value; });
    if (last) last.querySelector('[data-ef="name"]').focus();
  });

  $('#exList').addEventListener('input', function (e) {
    var row = e.target.closest('.ex-row');
    if (!row) return;
    var ex = draft.exams.find(function (x) { return x.id === row.dataset.id; });
    if (ex) ex[e.target.dataset.ef] = e.target.value;
  });
  $('#exList').addEventListener('change', function (e) {
    if (e.target.dataset.ef === 'date' || e.target.dataset.ef === 'name') {
      var ae = document.activeElement;
      if (!ae || !ae.closest('#exList')) renderModal();
      else { $('#exFixed').innerHTML = examOptions(draft.fixedId, '시험 고르기'); }
    }
  });
  $('#exList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-exdel]');
    if (!b) return;
    var id = b.closest('.ex-row').dataset.id;
    draft.exams = draft.exams.filter(function (x) { return x.id !== id; });
    if (draft.fixedId === id) draft.fixedId = '';
    Object.keys(draft.byClass).forEach(function (n) { if (draft.byClass[n] === id) delete draft.byClass[n]; });
    renderModal();
  });
  $('#exMode').addEventListener('change', function () {
    var on = $$('#exMode input').find(function (i) { return i.checked; });
    draft.mode = on ? on.value : 'auto';
    $('#exFixed').disabled = draft.mode !== 'fixed';
  });
  $('#exFixed').addEventListener('change', function (e) { draft.fixedId = e.target.value; });
  $('#exByClass').addEventListener('change', function (e) {
    var cls = e.target.dataset.cls;
    if (!cls) return;
    if (e.target.value) draft.byClass[cls] = e.target.value; else delete draft.byClass[cls];
  });

  $('#examForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#exError');
    var exams = draft.exams.filter(function (x) { return x.name.trim() || x.date || x.memo.trim(); });
    var bad = exams.find(function (x) { return !x.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(x.date); });
    if (bad) { err.textContent = '시험마다 이름과 날짜를 모두 넣어 주세요.'; err.classList.add('is-on'); return; }
    if (draft.mode === 'fixed' && !draft.fixedId) { err.textContent = '고정할 시험을 골라 주세요.'; err.classList.add('is-on'); return; }
    var value = {
      exams: exams.map(function (x) { return { id: x.id, name: x.name.trim(), date: x.date, memo: x.memo.trim() }; }),
      mode: draft.mode, fixedId: draft.mode === 'fixed' ? draft.fixedId : '', byClass: draft.byClass
    };
    var openedAt = draft.openedAt;
    UI.guardedSave('주요 시험', function (chk) {
      return DB.saveSettingIf('exams', value, UI.whoami(), chk ? openedAt : '');
    }, function () {
      load().then(function () { openModal(); toast('다른 분이 저장한 시험 목록을 불러왔습니다'); });
    }).then(function (res) {
      if (!res.ok) return;
      cfg = normalize(value);
      cfgAt = res.row.updated_at || '';
      renderBar();
      modal.close();
      toast('주요 시험을 저장했습니다. 학생·학부모 화면에도 반영됩니다', 'good');
    }).catch(function (x) { err.textContent = '저장하지 못했습니다 — ' + x.message; err.classList.add('is-on'); });
  });

  /* ---------- 언제 다시 그리나 ---------- */

  window.addEventListener('jt:loaded', load);
  window.addEventListener('jt:refreshed', function (e) {
    if (e.detail && e.detail.local) return;
    if (!modal.open) load();
  });
  DDay.everyMidnight(renderBar);

})();
