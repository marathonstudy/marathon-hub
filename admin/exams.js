/* ============================================================
   exams.js — 첫 화면 D-day 띠 · [D-day 시험 등록] (20261031c — 여러 개 한 번에 · 시험마다 전체 반 / 반 · 과정)

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
        return { id: e.id || Store.newId(), name: String(e.name || ''), date: String(e.date || ''), memo: String(e.memo || ''),
                 scope: e.scope && e.scope.all === false ? { all: false, classes: e.scope.classes || [], courses: e.scope.courses || [] } : { all: true } };
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
    if (main) $('#ddayMain').textContent = main.name + ' ' + DDay.badge(main, today);
    $('#ddayNext').textContent = others.map(function (e) { return e.name + ' ' + DDay.badge(e, today); }).join(' · ');
  }

  /* ---------- D-day 시험 등록 창 (20261031c) ----------
     줄마다 「시험 이름 · 날짜 · 대상 · 지우기」 · [+ 줄 추가]로 여러 개를 한 번에 (예: 6월 모의평가 · 9월 모의평가 · 수능)
     대상 = 전체 반(기본) 또는 반 · 과정 여러 개 고르기. 띠에는 그 반에 드는 시험 중 오늘 이후 가장 가까운 하나 (migration-034) */

  var modal = $('#examModal');

  function classNames() {
    return Store.getClasses().map(function (c) { return c.name; }).filter(function (n) { return !Store.isArchivedClass(n); })
      .sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function courseList() { return window.Course ? Course.list() : []; }
  function scopeOf(e) { return e.scope && e.scope.all === false ? e.scope : { all: true, classes: [], courses: [] }; }
  function scopeText(e) {
    var sc = scopeOf(e);
    if (sc.all) return '전체 반';
    var parts = (sc.courses || []).map(function (id) { var c = window.Course && Course.byId(id); return c ? '📚 ' + c.name : ''; }).filter(Boolean).concat(sc.classes || []);
    return parts.length ? parts.join(' · ') : '고른 반 없음';
  }

  function renderModal() {
    var today = DDay.today();
    $('#exList').innerHTML = draft.exams.length ? '<div class="ex-head" aria-hidden="true"><span>시험 이름</span><span>날짜</span><span>대상</span><span></span></div>' + draft.exams.map(function (e) {
      var past = e.date && e.date < today, sc = scopeOf(e);
      return '<div class="ex-row' + (past ? ' is-past' : '') + '" data-id="' + esc(e.id) + '">' +
        '<input class="input ex-name" data-ef="name" maxlength="40" placeholder="예) 6월 모의평가" value="' + esc(e.name) + '" aria-label="시험 이름">' +
        '<input class="input ex-date" data-ef="date" type="date" value="' + esc(e.date) + '" aria-label="날짜">' +
        '<details class="ex-scope"' + (e._open ? ' open' : '') + '><summary class="ex-scope__sum">' + esc(scopeText(e)) + '</summary>' +
          '<div class="ex-scope__box">' +
            '<label class="chk-inline ex-scope__all"><input type="checkbox" data-scope-all' + (sc.all ? ' checked' : '') + '> 전체 반</label>' +
            (courseList().length ? '<div class="ex-scope__grp"><span class="muted-note">과정</span>' + courseList().map(function (c) {
              return '<label class="chk-inline"><input type="checkbox" data-scope-course="' + esc(c.id) + '"' + (!sc.all && (sc.courses || []).indexOf(c.id) !== -1 ? ' checked' : '') + (sc.all ? ' disabled' : '') + '> 📚 ' + esc(c.name) + '</label>';
            }).join('') + '</div>' : '') +
            '<div class="ex-scope__grp"><span class="muted-note">반</span>' + classNames().map(function (n) {
              return '<label class="chk-inline"><input type="checkbox" data-scope-class="' + esc(n) + '"' + (!sc.all && (sc.classes || []).indexOf(n) !== -1 ? ' checked' : '') + (sc.all ? ' disabled' : '') + '> ' + esc(n) + '</label>';
            }).join('') + '</div>' +
          '</div></details>' +
        '<span class="ex-badge">' + (past ? '지남' : esc(DDay.badge(e, today))) + '</span>' +
        '<button class="btn btn--sm btn--ghost ex-del" type="button" data-exdel title="이 줄 지우기" aria-label="이 줄 지우기">지우기</button></div>';
    }).join('') : '<p class="panel__hint">아직 등록된 시험이 없습니다. <b>+ 줄 추가</b>를 눌러 시험 이름과 날짜를 넣으세요. 하나도 없으면 띠가 숨겨집니다.</p>';
    $('#exError').classList.remove('is-on');
  }

  function openModal() {
    draft = JSON.parse(JSON.stringify(cfg));
    draft.openedAt = cfgAt;
    draft.exams.sort(function (a, b) { return (a.date || '9') < (b.date || '9') ? -1 : 1; });
    if (!draft.exams.length) draft.exams.push({ id: Store.newId(), name: '', date: '', memo: '', scope: { all: true } });
    renderModal();
    modal.showModal();
  }

  $('#btnExams').addEventListener('click', function () {
    /* 열기 전에 서버 최신으로 */
    load().then(openModal);
  });
  $('#btnExamCancel').addEventListener('click', function () { modal.close(); });

  $('#btnExamAdd').addEventListener('click', function () {
    draft.exams.push({ id: Store.newId(), name: '', date: '', memo: '', scope: { all: true } });
    renderModal();
    var rows = $$('#exList .ex-row');
    var last = rows[rows.length - 1];
    if (last) last.querySelector('[data-ef="name"]').focus();
  });

  function rowExam(el) {
    var row = el.closest('.ex-row');
    return row ? draft.exams.find(function (x) { return x.id === row.dataset.id; }) : null;
  }
  $('#exList').addEventListener('input', function (e) {
    var ex = rowExam(e.target);
    if (ex && e.target.dataset.ef) ex[e.target.dataset.ef] = e.target.value;
  });
  $('#exList').addEventListener('change', function (e) {
    var t = e.target, ex = rowExam(t);
    if (!ex) return;
    if (t.hasAttribute('data-scope-all') || t.hasAttribute('data-scope-class') || t.hasAttribute('data-scope-course')) {
      var box = t.closest('.ex-scope__box');
      var all = box.querySelector('[data-scope-all]').checked;
      ex.scope = all ? { all: true } : {
        all: false,
        classes: Array.prototype.filter.call(box.querySelectorAll('[data-scope-class]'), function (c) { return c.checked; }).map(function (c) { return c.dataset.scopeClass; }),
        courses: Array.prototype.filter.call(box.querySelectorAll('[data-scope-course]'), function (c) { return c.checked; }).map(function (c) { return c.dataset.scopeCourse; })
      };
      ex._open = true;
      renderModal();
      return;
    }
    if (t.dataset.ef === 'date') {
      var badge = t.closest('.ex-row').querySelector('.ex-badge');
      if (badge) badge.textContent = ex.date && ex.date < DDay.today() ? '지남' : DDay.badge(ex, DDay.today());
    }
  });
  $('#exList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-exdel]');
    if (!b) return;
    var id = b.closest('.ex-row').dataset.id;
    draft.exams = draft.exams.filter(function (x) { return x.id !== id; });
    renderModal();
  });

  $('#examForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#exError');
    var exams = draft.exams.filter(function (x) { return x.name.trim() || x.date; });
    var bad = exams.find(function (x) { return !x.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(x.date); });
    if (bad) { err.textContent = '줄마다 시험 이름과 날짜를 모두 넣어 주세요. 필요 없는 줄은 [지우기].'; err.classList.add('is-on'); return; }
    var none = exams.find(function (x) { var sc = scopeOf(x); return !sc.all && !(sc.classes || []).length && !(sc.courses || []).length; });
    if (none) { err.textContent = '「' + none.name + '」의 대상을 고르세요 (전체 반 또는 반 · 과정).'; err.classList.add('is-on'); return; }
    var value = {
      exams: exams.map(function (x) { var sc = scopeOf(x); return { id: x.id, name: x.name.trim(), date: x.date, memo: String(x.memo || '').trim(), scope: sc.all ? { all: true } : { all: false, classes: sc.classes || [], courses: sc.courses || [] } }; }),
      mode: 'auto', fixedId: '', byClass: {}
    };
    var openedAt = draft.openedAt;
    UI.guardedSave('D-day 시험', function (chk) {
      return DB.saveSettingIf('exams', value, UI.whoami(), chk ? openedAt : '');
    }, function () {
      load().then(function () { openModal(); toast('다른 분이 저장한 시험 목록을 불러왔습니다'); });
    }).then(function (res) {
      if (!res.ok) return;
      cfg = normalize(value);
      cfgAt = res.row.updated_at || '';
      renderBar();
      modal.close();
      toast('D-day 시험을 저장했습니다. 학생 · 학부모 화면 위 띠에 가장 가까운 시험이 보입니다', 'good');
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
