/* ============================================================
   write.js — 레포트 발송 → 1 작성

   주차 선택 · 반 공통 입력 · 학생별 입력 · 실시간 미리보기
   자동 저장 · 지난주 불러오기 · 코멘트 상용구 · 맞춤법 경고

   40~100명을 매주 입력하므로, 반복 입력을 최대한 줄이는 것이 목표다.
     · 수업 내용은 반마다 한 번 (수기 테스트 이름 · 필수/선택 과제 칸은 없앴다 — 시험은 복습테스트, 과제는 앱 연동 · 20261029g)
     · 학생별로는 출결·별점·코멘트 · 복습테스트는 그 주 기록을 보여 주기만
   퇴원한 학생은 작성 목록에 나오지 않는다.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 출결 — 출석 · 지각 · 결석. 예전 기록의 '보강(makeup)'은 지우지 않고 「출석」으로 보인다 */
  var STATUSES = [
    { key: 'attend', label: '출석' },
    { key: 'late',   label: '지각' },
    { key: 'absent', label: '결석' }
  ];
  function shownStatus(e) { return e.attendStatus === 'makeup' ? 'attend' : (e.attendStatus || ''); }

  /* ============================================================
     상태
     ============================================================ */

  var draft = null;
  var currentClass = '';
  var mode = 'weeks';           /* weeks 주차 현황 (weeks.js) · edit 작성 화면 */
  var selectedId = '';          /* 미리보기 중인 학생 */
  var collapsedEntries = {};
  var commentTargetId = '';

  function students() { return (window.UI ? UI.activeStudents() : Store.activeStudents()); }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }

  function emptyDraft() {
    var w = Store.thisWeek();
    return { weekStart: w.start, weekEnd: w.end, weekEndTouched: false,
             common: {}, entries: {} };
  }

  function emptyEntry() {
    return {
      attendStatus: '', attendNote: '',
      focusScore: 0, scores: {},
      homework: {}, onTimeRate: 100,
      comment: ''
    };
  }

  function emptyCommon() {
    return { lessons: [''], tests: [''], comment: '', homework: [] };
  }


  /* 이 학생 레포트에 실제로 들어갈 코멘트와 그 출처.
     학생 코멘트에 글이 있으면 그것, 비어 있으면 반 공통.
     레포트를 만드는 report.js 의 commentFor 와 같은 규칙이다. */
  function commentOf(studentId) {
    var s = students().find(function (x) { return x.id === studentId; });
    var own = (entryOf(studentId).comment || '').trim();
    if (own) return { text: own, shared: false };
    var shared = ((commonOf((s && s.className) || '_').comment) || '').trim();
    return { text: shared, shared: true };
  }

  function loadDraft() {
    var d = Store.read(Store.KEYS.draft, null);
    if (!d || !d.weekStart) d = emptyDraft();
    d.common = d.common || {};
    d.entries = d.entries || {};
    return d;
  }

  /* 저장은 store.js 가 '바뀐 항목만' 서버로 보낸다 (학생 한 명 · 항목 하나 단위).
     고치지 않은 화면은 아무것도 보내지 않으므로, 오래 켜 둔 다른 탭이 남의 작업을 덮지 않는다. */
  function saveDraft() {
    if (draft) Store.write(Store.KEYS.draft, draft);
  }

  function flushDraft() {
    applyModalNow();          /* 코멘트 창에 아직 넣지 않은 글이 있으면 먼저 */
    return Store.flushNow(Store.KEYS.draft).catch(function () {});
  }

  /* ============================================================
     작성 글 지키기 (유실 방지)
       · 코드로 칸 값을 바꿀 때 — 지금 커서가 있는 칸은 건드리지 않고, 아니면 칸을 새로 만든다.
         같은 칸의 value 를 코드로 바꾸면 브라우저 실행 취소(Ctrl+Z)가 그 전 글로 되돌아가
         써 둔 글이 지워질 수 있었다. 새 칸은 실행 취소 기록이 비어 있어 사용자가 직접 친 것만 되돌린다.
       · 자동 저장: 입력을 멈추고 1.2초 뒤 · 칸을 벗어날 때 · 화면을 떠나거나 탭을 숨길 때
       · 저장 상태를 칸 옆에 작게 (저장 중 · 저장됨 · 저장 실패)
     ============================================================ */
  function setFresh(el, v) {
    if (!el) return el;
    v = v == null ? '' : String(v);
    if (el.value === v || document.activeElement === el) return el;
    var n = el.cloneNode(true);
    n.value = v;
    el.replaceWith(n);
    return n;
  }

  /* 상용구 · 정보 넣기 — 실행 취소 한 번에 그 넣은 글만 되돌아가게 */
  function insertText(ta, text, atEnd) {
    ta.focus();
    if (atEnd) { var L = ta.value.length; ta.setSelectionRange(L, L); }
    var ok = false;
    try { ok = document.execCommand && document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      var a = ta.selectionStart, z = ta.selectionEnd;
      ta.value = ta.value.slice(0, a) + text + ta.value.slice(z);
      ta.setSelectionRange(a + text.length, a + text.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  var SAVE_TEXT = { saving: '저장 중…', saved: '저장됨', failed: '저장 실패 — 다시 시도합니다', conflict: '다른 분이 고친 칸 — 위 알림 확인' };
  var uiState = { entry: {}, common: {} };
  function showState(kind, id, state) {
    uiState[kind][id] = state;
    var text = SAVE_TEXT[state] || '';
    var cls = 'save-state' + (state ? ' save-state--' + state : '');
    if (kind === 'common' && id === currentClass) { var c = $('#commonSaveState'); if (c) { c.textContent = text; c.className = cls; } }
    if (kind === 'entry') {
      var card = $('#entryList .entry[data-id="' + id + '"] [data-save]');
      if (card) { card.textContent = text; card.className = 'entry__save ' + cls; }
    }
    if (commentModal && commentModal.open && ((kind === 'entry' && !commentIsClass && id === commentTargetId) || (kind === 'common' && commentIsClass && id === currentClass))) {
      var m = $('#commentSaveState'); if (m) { m.textContent = text; m.className = cls; }
    }
  }
  window.addEventListener('jt:save-state', function (e) { var d = e.detail || {}; showState(d.kind, d.id, d.state); });

  /* 탭을 닫거나 화면을 벗어날 때 마지막 타자까지 확실히 저장한다.
     디바운스만 믿으면 마지막 1.2초가 날아갈 수 있다. */
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushDraft();
  });
  /* 입력칸에서 포커스가 빠지면 바로 저장 */
  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.closest && e.target.closest('#panel-write')) flushDraft();
  });

  function commonOf(cls) {
    if (!draft.common[cls]) draft.common[cls] = emptyCommon();
    return draft.common[cls];
  }

  function entryOf(id) {
    if (!draft.entries[id]) draft.entries[id] = emptyEntry();
    return draft.entries[id];
  }

  function studentsOfClass(cls) {
    return students()
      .filter(function (s) { return (s.className || '') === cls; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
  }

  /* ============================================================
     주차
     ============================================================ */

  function renderWeek() {
    $('#weekStart').value = draft.weekStart || '';
    $('#weekEnd').value   = draft.weekEnd || '';

    /* 종료일이 시작일보다 빠를 수 없다. 화면에서 먼저 막는다. */
    $('#weekEnd').min = draft.weekStart || '';

    var host = $('#weekSummary');
    if (!draft.weekStart || !draft.weekEnd) { host.textContent = ''; return; }

    if (draft.weekEnd < draft.weekStart) {
      host.textContent = '종료일이 시작일보다 빠릅니다 — 다시 골라 주세요';
      host.className = 'week-summary week-summary--bad';
      return;
    }

    /* 요일과 일수를 같이 보여 준다. 잘못 고른 날짜가 눈에 띈다. */
    var days = Store.daysBetween(draft.weekStart, draft.weekEnd);
    host.textContent = Store.dateWithDow(draft.weekStart) + ' ~ ' +
                       Store.dateWithDow(draft.weekEnd) + ' · ' + days + '일';
    host.className = 'week-summary num';
  }

  /* 다른 주차로 옮긴다.
     지금 주차를 먼저 서버에 다 올리고, 새 주차의 내용을 서버에서 받아 온다.
     (예전 방식은 주차를 바꿔도 지난 주 입력이 그대로 따라와 새 주에 저장됐다) */
  var switching = false;

  function switchWeek(newStart, span) {
    if (!newStart || newStart === draft.weekStart || switching) { renderWeek(); return Promise.resolve(); }
    switching = true;
    var flush = flushDraft();

    $('#weekSummary').textContent = '불러오는 중…';
    return flush.then(function () {
      return Store.loadWeekIntoDraft(newStart);
    }).then(function (d) {
      draft = d;
      /* 서버에 그 주차 종료일이 없으면 시작일 + 6일 (Store.autoEnd) */
      if (!d.weekEndTouched && !draft.weekEnd) draft.weekEnd = Store.autoEnd(newStart);
      switching = false;
      selectedId = '';
      collapsedEntries = {};
      renderWeek();
      refreshAll();
      window.dispatchEvent(new CustomEvent('jt:write-nav'));   /* 뒤로가기 기록 (nav.js) */
      toast(Store.lessonLabel(currentClass, newStart) + '을 열었습니다');
    }).catch(function (e) {
      switching = false;
      renderWeek();
      toast('주차를 불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  /* 시작일을 고르면 종료일은 시작일 + 6일로 채워진다 (그 주차를 서버에 저장해 둔 종료일이 있으면 그것) */
  $('#weekStart').addEventListener('change', function (e) {
    switchWeek(e.target.value, 0);
  });

  $('#weekEnd').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v && draft.weekStart && v < draft.weekStart) {
      toast('종료일이 시작일보다 빠릅니다', 'bad');
      renderWeek();                        /* 옛 값으로 되돌린다 */
      return;
    }
    draft.weekEnd = v;
    draft.weekEndTouched = true;           /* 사람이 고른 값이다 (이 주차만) */
    renderWeek();
    saveDraft();
  });

  $('#btnThisWeek').addEventListener('click', function () {
    switchWeek(Store.thisWeek().start, 0);
  });

  /* ============================================================
     반 고르기
     ============================================================ */

  function renderClassPicker() {
    var classes = Store.getClasses();
    var host = $('#classPicker');
    host.textContent = '';

    if (!classes.length) {
      host.innerHTML = '<p class="panel__hint">아직 반이 없습니다. 학생 → 명단 → 학생 추가 → 반 고르기의 [+ 새 반 만들기]로 만들 수 있습니다.</p>';
      currentClass = '';
      return;
    }

    if (!classes.some(function (c) { return c.name === currentClass; })) {
      currentClass = classes[0].name;
    }

    var frag = document.createDocumentFragment();
    classes.forEach(function (c) {
      var list = studentsOfClass(c.name);

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.name === currentClass ? ' is-on' : '');
      b.dataset.cls = c.name;
      b.innerHTML = '<span class="chip__name"></span>' +
                    '<span class="chip__count num">' + list.length + '명</span>';
      b.querySelector('.chip__name').textContent = c.name;
      frag.appendChild(b);
    });
    host.appendChild(frag);

    $('#classPickerHint').textContent = '전체 ' + students().length + '명';
  }

  $('#classPicker').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    currentClass = chip.dataset.cls;
    selectedId = '';
    refreshAll();
    if (mode === 'weeks') setMode('weeks');                   /* 주차 현황이면 그 반 주차로 */
    window.dispatchEvent(new CustomEvent('jt:write-nav'));     /* 뒤로가기 기록 (nav.js) */
  });

  /* ============================================================
     주차 현황 ↔ 작성 화면
     ============================================================ */

  function setMode(m) {
    mode = m === 'edit' ? 'edit' : 'weeks';
    $('#writeMain').classList.toggle('is-weeks', mode === 'weeks');
    renderBar();
    showRePub();
    window.dispatchEvent(new CustomEvent('jt:write-mode', { detail: { mode: mode } }));
  }

  /* ---------- 이미 보낸 주를 고쳤을 때 — 「고친 내용은 다시 공개해야 학부모에게 반영됩니다 [다시 공개]」 (20261029g) ----------
     그 반 그 주에 보낸 학생이 있고, 이 화면에서 무엇이든 고치면 띠를 보인다. [다시 공개] → 레포트 발송 → 2 공개 */
  var rePub = { key: '', sent: 0, edited: {} };
  function rePubKey() { return (currentClass || '') + '|' + (draft.weekStart || ''); }
  function checkSent() {
    var key = rePubKey();
    if (!currentClass || !draft.weekStart || !window.DB || !DB.weekSendData) { rePub.key = key; rePub.sent = 0; showRePub(); return; }
    DB.weekSendData(draft.weekStart).then(function (x) {
      if (key !== rePubKey()) return;
      rePub.key = key;
      rePub.sent = studentsOfClass(currentClass).filter(function (s) { return x.sent && x.sent[s.id]; }).length;
      showRePub();
    }, function () {});
  }
  function showRePub() {
    var n = $('#rePubNote');
    if (n) n.hidden = !(mode === 'edit' && rePub.key === rePubKey() && rePub.sent > 0 && rePub.edited[rePubKey()]);
  }
  function markEdited(ev) {
    if (!ev.target.closest || !ev.target.closest('#commonPanel, #entryList, #commentModal')) return;
    /* 누르기는 출결 · 별점 · 차시 지우기만 고친 것으로 (펼치기 · 상담 기록 · 미리보기는 아님) */
    if (ev.type === 'click' && !ev.target.closest('[data-act="status"], [data-act="star"], [data-del]')) return;
    rePub.edited[rePubKey()] = true;
    showRePub();
  }
  document.addEventListener('input', markEdited, true);
  document.addEventListener('click', markEdited, true);
  window.addEventListener('jt:write-nav', function () { setTimeout(checkSent, 0); });
  window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if (t === 'sent' || t === 'published') checkSent(); });
  $('#btnRePublish').addEventListener('click', function () { flushDraft(); UI.selectTab(2); });

  /* 그 주 작성 화면으로 (주차 현황의 줄 · [이번 주 작성하기]) */
  function openWeek(start) {
    setMode('edit');
    var p = (start && start !== draft.weekStart) ? switchWeek(start, 0) : Promise.resolve();
    return p.then(function () {
      window.scrollTo(0, 0);
      window.dispatchEvent(new CustomEvent('jt:write-nav'));
    });
  }

  function openWeeks() {
    flushDraft();
    setMode('weeks');
    window.scrollTo(0, 0);
    window.dispatchEvent(new CustomEvent('jt:write-nav'));
  }

  /* ---------- 머리 띠 — [← 주차 목록] · 반 · 주차 · 수업일 · [◀ 지난주] [다음주 ▶] ---------- */

  function monOf(iso) { return Lesson.addDays(iso, -((Lesson.dowOf(iso) + 6) % 7)); }
  /* 옆 주로 갈 수 있는가 — 첫 수업일이 든 주 ~ 이번 주의 다음 주 (주차 현황과 같은 범위) */
  function stepOk(start, dir) {
    var to = monOf(Lesson.addDays(start, 7 * dir));
    if (dir > 0) return to <= Lesson.addDays(Store.thisWeek().start, 7);
    var s = Store.schedOf(currentClass);
    return !(s && s.first && to < monOf(s.first));
  }
  function renderBar() {
    var now = $('#wbarNow');
    if (!now || !draft || !draft.weekStart || !window.Lesson) return;
    var start = draft.weekStart;
    var s = Store.schedOf(currentClass);
    var L = s ? Lesson.of(s, start) : null;
    /* 작성 · 공개 · 발송 맨 위에 늘 크게 「고2 선수능반 · 10/22(목) 수업」 — 반 하나 + 수업 하나 (20261030e) */
    var when = L && L.date && !L.canceled ? Store.dateWithDow(L.date) + ' 수업' : Store.lessonLabel(currentClass, start);
    now.innerHTML = '<span class="wbar__cls">' + escapeHtml(currentClass || '반 없음') + ' · </span>' +
      '<b>' + escapeHtml(when) + '</b>' +
      (L && L.canceled ? ' <span class="wbar__off">휴강</span>' : '');
    $('#btnWbarPrev').disabled = !stepOk(start, -1);
    $('#btnWbarNext').disabled = !stepOk(start, 1);
    stickBar();
  }
  function step(dir) {
    if (!draft || !draft.weekStart || !stepOk(draft.weekStart, dir)) return;
    openWeek(Lesson.addDays(draft.weekStart, 7 * dir));     /* switchWeek 가 지금 주를 먼저 저장(flushDraft)한 뒤 넘어간다 */
  }
  /* 내려도 위에 붙어 있게 — 넓은 화면은 칸(grid) 안이라 CSS sticky 가 칸을 못 벗어나므로 직접 붙인다 */
  function stickBar() {
    var wrap = $('#writeBarWrap'), bar = $('#writeBar'), top = $('#topbar');
    if (!wrap || !bar) return;
    var topH = top && !top.hidden ? top.offsetHeight : 0;
    /* 띠는 레포트 발송 머리에 있고 작성 · 공개 · 발송이 함께 쓴다 (20261029a) — 지금 보이는 단계 화면 끝까지 붙어 있다 */
    var panel = ['#panel-write', '#panel-publish', '#panel-send'].map(function (id) { return $(id); }).filter(function (el) { return el && !el.hidden; })[0];
    var r = wrap.getBoundingClientRect(), main = panel ? panel.getBoundingClientRect() : { bottom: 0 };
    var on = !!panel && r.height > 0 && r.top < topH && main.bottom > topH + bar.offsetHeight;
    wrap.style.height = on ? bar.offsetHeight + 'px' : '';
    bar.classList.toggle('is-stuck', on);
    bar.style.top = on ? topH + 'px' : '';
    bar.style.left = on ? r.left + 'px' : '';
    bar.style.width = on ? r.width + 'px' : '';
  }
  window.addEventListener('scroll', stickBar, { passive: true });
  window.addEventListener('resize', stickBar);
  $('#btnWbarBack').addEventListener('click', openWeeks);
  $('#btnWbarPrev').addEventListener('click', function () { step(-1); });
  $('#btnWbarNext').addEventListener('click', function () { step(1); });
  window.addEventListener('jt:schedule-changed', renderBar);

  /* ============================================================
     반 공통 — 수업 내용 · 테스트 이름
     ============================================================ */

  function renderCommonComment() {
    var c = commonOf(currentClass || '_');
    setFresh($('#commonComment'), c.comment || '');

    var n = (c.comment || '').length;
    $('#commonCommentCount').textContent = n + '자';

    /* 이 반에서 몇 명이 공통을 쓰고 있는지 */
    var list = studentsOfClass(currentClass);
    var shared = list.filter(function (s) {
      return !((entryOf(s.id).comment || '').trim());
    }).length;

    $('#commonCommentUse').textContent = !list.length ? ''
      : n ? shared + ' / ' + list.length + '명이 이 글을 씁니다'
          : (shared < list.length
              ? (list.length - shared) + '명은 따로 썼습니다'
              : '비어 있으면 코멘트 칸이 레포트에 안 나옵니다');
  }

  function renderCommon() {
    $('#commonTitle').textContent = currentClass ? currentClass + ' 공통' : '반 공통';
    var c = commonOf(currentClass || '_');

    var lessons = $('#lessonList');
    lessons.textContent = '';
    (c.lessons.length ? c.lessons : ['']).forEach(function (text, i) {
      var row = document.createElement('div');
      row.className = 'row-item';
      row.innerHTML =
        '<span class="row-item__no num">' + (i + 1) + '차시</span>' +
        '<input class="input" type="text" data-kind="lesson" data-i="' + i + '"' +
        ' placeholder="예) 현대시 「진달래꽃」 — 화자의 정서와 반어 표현 분석">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="lesson" data-i="' + i + '" aria-label="삭제">×</button>';
      row.querySelector('input').value = text || '';
      lessons.appendChild(row);
    });

    /* 수업일 · 수업 영상 · 자료 파일 (weekly.js) */
    if (window.Weekly) Weekly.render(currentClass, draft.weekStart);

    /* 수기 과제(필수 · 선택) · 테스트 이름 칸은 없앴다 (20261029g) — 예전 값은 그대로 두고 화면에서만 숨긴다 */
    renderCommonComment();
  }

  $('#commonPanel').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.kind === 'lesson') {
      showState('common', currentClass, 'saving');
      commonOf(currentClass).lessons[+el.dataset.i] = el.value;
      saveDraft(); schedulePreview();
    }
  });

  $('#commonPanel').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var c = commonOf(currentClass);
    var i = +btn.dataset.i;
    if (btn.dataset.del !== 'lesson') return;
    c.lessons.splice(i, 1);
    if (!c.lessons.length) c.lessons = [''];
    saveDraft();
    renderCommon();
    renderEntries();
    schedulePreview();
  });

  /* 반 공통 코멘트 — 칸이 새로 만들어질 수 있어 반 공통 칸 묶음(#commonPanel)에서 받는다 */
  $('#commonPanel').addEventListener('input', function (e) {
    if (e.target.id !== 'commonComment') return;
    /* 읽는 쪽(renderCommonComment)과 같은 자리를 써야 한다.
       반이 아직 안 골라졌으면 양쪽 다 '_' 를 쓴다. */
    commonOf(currentClass || '_').comment = e.target.value;
    renderCommonComment();
    renderEntries();          /* 공통을 쓰는 학생 카드의 미리보기가 같이 바뀐다 */
    saveDraft();
    showState('common', currentClass, 'saving');
  });

  /* 폰에서 길게 쓰기 — 코멘트 모달을 반 공통 모드로 연다 */
  $('#btnCommonCommentBig').addEventListener('click', function () {
    openCommentModal('', { classComment: true });
  });

  $('#btnAddLesson').addEventListener('click', function () {
    commonOf(currentClass).lessons.push('');
    saveDraft(); renderCommon();
  });

  /* ---------- 지난주 불러오기 (C단계) ---------- */

  /* 지난 회차는 서버에서 찾는다. 조교가 쓴 것을 선생님 기기에서도 불러올 수 있어야 한다. */
  $('#btnLoadLast').addEventListener('click', function () {
    if (!currentClass) { toast('반을 먼저 고르세요', 'bad'); return; }
    if (!draft.weekStart) { toast('주차를 먼저 정하세요', 'bad'); return; }

    var btn = this;
    btn.disabled = true;
    btn.textContent = '찾는 중…';

    DB.lastCommonOf(currentClass, draft.weekStart).then(function (h) {
      btn.disabled = false;
      btn.textContent = '지난주 불러오기';

      if (!h) { toast('이 반의 지난 회차 기록이 없습니다', 'bad'); return; }

      var c = commonOf(currentClass);
      var hasContent = c.lessons.some(function (x) { return String(x || '').trim(); });

      function apply() {
        /* 수업 내용만 (수기 테스트 이름 · 과제 칸은 없앴다 · 20261029g) */
        c.lessons = (h.lessons || ['']).slice();
        if (!c.lessons.length) c.lessons = [''];
        saveDraft(); renderCommon(); renderEntries(); schedulePreview();
        toast(Store.lessonLabel(currentClass, h.weekStart) + ' 내용을 불러왔습니다', 'good');
      }

      if (!hasContent) { apply(); return; }
      UI.confirmAsk('지난주 불러오기',
        Store.lessonLabel(currentClass, h.weekStart) + ' 내용으로 바꿉니다. 지금 입력한 수업 내용은 사라집니다.',
        '바꾸기').then(function (ok) { if (ok) apply(); });

    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '지난주 불러오기';
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  });

  /* ============================================================
     학생별 입력
     ============================================================ */

  function entryCardHtml(s, tests) {
    var e = entryOf(s.id);
    var open = !collapsedEntries[s.id];

    var statusBtns = STATUSES.map(function (st) {
      return '<button type="button" class="att-btn att-btn--' + st.key +
             (shownStatus(e) === st.key ? ' is-on' : '') +
             '" data-act="status" data-v="' + st.key + '">' + st.label + '</button>';
    }).join('');

    var stars = '';
    var absent = e.attendStatus === 'absent';
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="star' + (i <= e.focusScore ? ' is-on' : '') +
               '" data-act="star" data-v="' + i + '" aria-label="' + i + '점"' + (absent ? ' disabled' : '') + '>★</button>';
    }

    var needNote = e.attendStatus === 'late';

    return '' +
      '<div class="entry' + (open ? '' : ' is-collapsed') +
        (selectedId === s.id ? ' is-selected' : '') + '" data-id="' + s.id + '">' +
        '<div class="entry__head" data-act="head">' +
          '<span class="entry__name"></span>' +
          '<span class="entry__save" data-save aria-live="polite"></span>' +
          '<span class="entry__caret" aria-hidden="true">▾</span>' +
        '</div>' +
        '<div class="entry__body">' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">출결</span>' +
            '<span class="att-group">' + statusBtns + '</span>' +
            '<input class="input input--note" type="text" data-act="note" ' +
              'placeholder="예) 10분 지각"' + (needNote ? '' : ' hidden') + '>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">집중도</span>' +
            '<span class="stars">' + stars + '</span>' +
            '<span class="stars__val num">' + (e.focusScore || 0) + ' / 5</span>' +
          '</div>' +
          '<div class="fieldline fieldline--rv">' +
            '<span class="fieldline__label">복습테스트</span>' +
            '<span class="entry__rv" data-role="rv"></span>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-act="rvfix">고치기</button>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">코멘트 <span class="say-note">학부모 화면의 \'선생님 한마디\'에 나옵니다</span></span>' +
            '<button type="button" class="comment-btn" data-act="comment">' +
              '<span class="comment-btn__text"></span>' +
              '<span class="comment-btn__count num"></span>' +
            '</button>' +
          '</div>' +
          '<div class="fieldline fieldline--notes">' +
            '<span class="fieldline__label">상담</span>' +
            '<button type="button" class="btn btn--sm btn--ghost entry__notes-btn" data-act="notes" aria-expanded="false">상담 기록 ▾</button>' +
            '<div class="entry__notes" data-role="notes" hidden></div>' +
          '</div>' +
          '<div class="fieldline fieldline--pv">' +
            '<span class="fieldline__label">미리보기</span>' +
            '<button type="button" class="btn btn--sm" data-pv="parent">학부모 화면 미리보기</button>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-pv="student">학생 화면 미리보기</button>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-pv="parent" data-pv-view="app">과제 상세 보기</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function span(cls, text) {
    var el = document.createElement('span');
    if (cls) el.className = cls;
    el.textContent = text;
    return el;
  }

  function fillEntryCard(el, s, tests) {
    var e = entryOf(s.id);
    el.querySelector('.entry__name').textContent = s.name || '';
    var sv = el.querySelector('[data-save]');
    if (sv && uiState.entry[s.id]) { sv.textContent = SAVE_TEXT[uiState.entry[s.id]] || ''; sv.className = 'entry__save save-state save-state--' + uiState.entry[s.id]; }

    var note = el.querySelector('[data-act="note"]');
    if (note) note.value = e.attendNote || '';

    fillReview(el, s.id);

    var c = commentOf(s.id);
    var txt = c.text;
    var btn = el.querySelector('.comment-btn');
    btn.classList.toggle('is-shared', c.shared && !!txt);
    el.querySelector('.comment-btn__text').textContent =
      txt ? (c.shared ? '[반 공통] ' : '') +
            txt.replace(/\s+/g, ' ').slice(0, 36) + (txt.length > 36 ? '…' : '')
          : '코멘트 작성';
    el.querySelector('.comment-btn__count').textContent = txt ? txt.length + '자' : '';
  }

  /* 학생 카드 「복습테스트」 — 그 주 수업일 복습테스트 기록 (review.js 가 불러온 것 · 20261029g)
     「복습 TEST 6/10 · 화작문 TEST 10/10」 · 제출이 없으면 「아직 제출 안 함」 */
  function fillReview(el, id) {
    var host = el.querySelector('[data-role="rv"]');
    if (!host) return;
    var line = window.Review && Review.lineOf ? Review.lineOf(currentClass, draft.weekStart, id) : null;
    host.textContent = line == null ? '불러오는 중…' : line;
    host.classList.toggle('is-none', line === '아직 제출 안 함');
  }
  window.addEventListener('jt:review-drawn', function () {
    $$('#entryList .entry').forEach(function (el) { fillReview(el, el.dataset.id); });
  });

  function renderEntries() {
    var host = $('#entryList');
    var list = studentsOfClass(currentClass);
    var shown = list;
    var tests = (commonOf(currentClass || '_').tests || [])
      .filter(function (t) { return String(t || '').trim(); });

    host.textContent = '';

    if (!list.length) {
      host.innerHTML = '<div class="empty-state">이 반에 등록된 학생이 없습니다.</div>';
    } else {
      var frag = document.createDocumentFragment();
      shown.forEach(function (s) {
        var wrap = document.createElement('div');
        wrap.innerHTML = entryCardHtml(s, tests);
        var card = wrap.firstElementChild;
        fillEntryCard(card, s, tests);
        frag.appendChild(card);
      });
      host.appendChild(frag);
    }

    updateCounts();
  }

  /* ---------- 입력 반응 (이벤트 위임) ---------- */

  $('#entryList').addEventListener('click', function (ev) {
    var card = ev.target.closest('.entry');
    if (!card) return;
    var id = card.dataset.id;
    var e = entryOf(id);
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;

    var act = btn.dataset.act;

    if (act === 'head') {
      collapsedEntries[id] = !collapsedEntries[id];
      card.classList.toggle('is-collapsed', !!collapsedEntries[id]);
      selectStudent(id);
      return;
    }

    /* [상담 기록 ▾] — 그 학생 최근 기록 · [기록 추가] · [상담 카드 열기] (card.js 가 그린다 · 20261029b) */
    if (act === 'notes') {
      var box = card.querySelector('[data-role="notes"]');
      var opening = box.hidden;
      box.hidden = !opening;
      btn.setAttribute('aria-expanded', String(opening));
      btn.textContent = opening ? '상담 기록 ▴' : '상담 기록 ▾';
      if (opening && window.Card && Card.renderInline) Card.renderInline(box, id);
      return;
    }

    /* [고치기] — 반 공통의 복습테스트 화면으로 (그 학생 줄을 표시) */
    if (act === 'rvfix') {
      if (window.Review && Review.focusStudent) Review.focusStudent(id);
      return;
    }

    if (act === 'status') {
      var was = e.attendStatus;
      e.attendStatus = (shownStatus(e) === btn.dataset.v) ? '' : btn.dataset.v;
      if (e.attendStatus !== 'late') e.attendNote = '';
      /* 결석 → 집중도 0 (별 잠금) · 결석에서 출석/지각으로 → 집중도 5 */
      if (e.attendStatus === 'absent') e.focusScore = 0;
      else if (was === 'absent' && (e.attendStatus === 'attend' || e.attendStatus === 'late')) e.focusScore = 5;
      $$('.att-btn', card).forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.v === shownStatus(e));
      });
      $$('.star', card).forEach(function (b) {
        b.disabled = e.attendStatus === 'absent';
        b.classList.toggle('is-on', +b.dataset.v <= e.focusScore);
      });
      card.querySelector('.stars__val').textContent = (e.focusScore || 0) + ' / 5';
      var note = card.querySelector('[data-act="note"]');
      note.hidden = e.attendStatus !== 'late';
      if (!note.hidden) note.value = e.attendNote || '';
      afterChange(id, true);
      return;
    }

    if (act === 'star') {
      if (e.attendStatus === 'absent') return;
      var v = +btn.dataset.v;
      e.focusScore = (e.focusScore === v) ? 0 : v;
      $$('.star', card).forEach(function (b) {
        b.classList.toggle('is-on', +b.dataset.v <= e.focusScore);
      });
      card.querySelector('.stars__val').textContent = e.focusScore + ' / 5';
      afterChange(id, true);
      return;
    }

    if (act === 'comment') {
      openCommentModal(id);
    }
  });

  $('#entryList').addEventListener('input', function (ev) {
    var card = ev.target.closest('.entry');
    if (!card) return;
    var id = card.dataset.id;
    var e = entryOf(id);
    var act = ev.target.dataset.act;

    if (act === 'note') {
      e.attendNote = ev.target.value;
      afterChange(id);
    }
    showState('entry', id, 'saving');
  });

  /* now = 한 칸씩 누르는 기록(출결·별점·과제 체크) → 누르자마자 그 칸만 저장 */
  function afterChange(id, now) {
    saveDraft();
    if (now) flushDraft();
    selectStudent(id, true);
    renderClassPicker();
    updateCounts();
  }

  function updateCounts() {
    var list = studentsOfClass(currentClass);

    $('#entryProgress').textContent = currentClass ? currentClass + ' · ' + list.length + '명' : '';

    /* 「작성 중 / 작성 완료」 구분 없이 반 학생 전원이 공개에 올라간다 (20261030a) */
    $('#queueInfo').textContent = list.length
      ? list.length + '명 모두 레포트 발송 → 2 공개에 올라갑니다 · 비어 있는 칸은 레포트에서 숨습니다'
      : '';

    $('#btnEnqueue').disabled = !list.length;
  }

  $('#btnCollapseEntries').addEventListener('click', function () {
    var list = studentsOfClass(currentClass);
    var anyOpen = list.some(function (s) { return !collapsedEntries[s.id]; });
    list.forEach(function (s) { collapsedEntries[s.id] = anyOpen; });
    this.textContent = anyOpen ? '모두 펼치기' : '모두 접기';
    renderEntries();
  });

  /* ============================================================
     미리보기
     ============================================================ */

  var previewTimer = null;

  function selectStudent(id, keepScroll) {
    if (selectedId !== id) window.dispatchEvent(new CustomEvent('jt:student-selected', { detail: { id: id } }));
    selectedId = id;
    $$('.entry', $('#entryList')).forEach(function (c) {
      c.classList.toggle('is-selected', c.dataset.id === id);
    });
    schedulePreview();
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 300);
  }

  function abs(path) {
    return new URL(path + '?v=' + encodeURIComponent(CONFIG.version), location.href).href;
  }

  /* 학부모 화면과 같은 파일(report.css · report-view.js)로 그린다.
     생성기 스타일과 섞이지 않게 iframe 안에서 그린다. */
  function previewHtml(data) {
    var json = JSON.stringify(data).replace(/</g, '\\u003C');
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">' +
      '<link rel="stylesheet" href="' + abs('../assets/report.css') + '">' +
      '</head><body><div class="container"><div id="report-body"></div></div>' +
      '<script src="' + abs('../assets/brand.js') + '"><\/script>' +
      '<script src="' + abs('../assets/report-view.js') + '"><\/script>' +
      '<script>ReportView.render(document.getElementById("report-body"), ' + json + ');<\/script>' +
      '</body></html>';
  }

  function renderPreview() {
    var s = students().find(function (x) { return x.id === selectedId; });
    if (!s) {
      /* 처음에는 안내만 — 학생 줄을 누르면 그 학생으로 (20261029b) */
      $('#previewWho').textContent = '학생을 누르면 그 학생 레포트 미리보기가 나옵니다';
      $('#previewFrame').srcdoc = '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#8A90AC;display:grid;place-items:center;height:90vh;margin:0;text-align:center;font-size:14px">학생을 누르면 그 학생 레포트<br>미리보기가 나옵니다</body></html>';
      return;
    }

    $('#previewWho').textContent = s.name + ' 학생';
    var data = Report.toReportData(s, commonOf(currentClass), entryOf(s.id),
                                   { start: draft.weekStart, end: draft.weekEnd });
    $('#previewFrame').srcdoc = previewHtml(data);
  }

  $('#btnPreviewReload').addEventListener('click', renderPreview);

  /* ============================================================
     코멘트 (전체화면) + 상용구
     ============================================================ */

  var commentModal = $('#commentModal');

  /* 코멘트 창은 두 가지로 열린다.
       반 공통  — 이 반 전원에게 들어갈 글
       학생 개별 — 그 학생만 따로 쓰는 글 (비우면 반 공통으로 돌아간다) */
  var commentIsClass = false;
  /* 학생 창에서 '이 학생만' 을 고른 상태인가.
     비어 있는 개별 코멘트는 만들 수 없으므로(비면 공통으로 돌아간다)
     저장할 때 이 값과 글 내용을 같이 본다. */
  var commentOwnMode = false;

  /* 코멘트 창의 글 칸은 열 때마다 새로 만든다 — 앞 학생 글이 실행 취소(Ctrl+Z)로 넘어오지 않게 */
  function freshCommentText(v) {
    var el = $('#commentText');
    var n = el.cloneNode(false);
    n.value = v == null ? '' : String(v);
    el.replaceWith(n);
    return n;
  }

  var commentOrig = null;     /* 연 때 글 — [취소] 하면 이것으로 되돌린다 */
  var modalTimer = null;

  function openCommentModal(id, opts) {
    opts = opts || {};
    applyModalNow();
    commentIsClass = !!opts.classComment;
    commentTargetId = commentIsClass ? '' : id;

    if (commentIsClass) {
      $('#commentWho').textContent = (currentClass || '') + ' 반 공통 코멘트';
      commentOrig = { cls: currentClass || '_', value: commonOf(currentClass || '_').comment || '' };
      freshCommentText(commonOf(currentClass || '_').comment || '');
      $('#commentMode').hidden = true;
    } else {
      var s = students().find(function (x) { return x.id === id; });
      var own = (entryOf(id).comment || '').trim();
      $('#commentWho').textContent = (s ? s.name + ' 학생 ' : '') + '코멘트';
      commentOrig = { id: id, value: entryOf(id).comment || '' };
      /* 공통을 쓰는 중이면 그 글을 보여 준다. 그대로 저장하면 공통인 채로 남는다. */
      commentOwnMode = !!own;
      freshCommentText(own || (commonOf((s && s.className) || '_').comment || ''));
      renderCommentMode();
    }
    var ms = $('#commentSaveState');
    if (ms) { ms.textContent = ''; ms.className = 'save-state'; }

    updateCommentCount();
    renderInfoBar();
    renderSnipBar();
    $('#commentWarn').classList.remove('is-on');
    commentModal.showModal();
    setTimeout(function () { $('#commentText').focus(); }, 40);
  }

  /* 창 위쪽의 '지금 무엇을 쓰는 중인가' 줄 */
  function renderCommentMode() {
    var bar = $('#commentMode');
    if (commentIsClass || !commentTargetId) { bar.hidden = true; return; }

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var shared = (commonOf((s && s.className) || '_').comment || '').trim();
    var own = commentOwnMode;

    bar.hidden = false;
    bar.classList.toggle('is-own', own);

    if (own) {
      $('#commentModeTag').textContent = '이 학생만';
      $('#commentModeDesc').textContent = shared
        ? '반 공통 대신 이 글이 나갑니다'
        : '이 학생에게만 나갑니다';
    } else {
      $('#commentModeTag').textContent = '반 공통';
      $('#commentModeDesc').textContent = shared
        ? '이 반 전원과 같은 글이 나갑니다'
        : '반 공통이 비어 있어 코멘트 칸이 안 나옵니다';
    }

    $('#btnCommentOwn').hidden = own;
    $('#btnCommentShared').hidden = !own;
  }

  /* [이 학생만 고치기] — 보이는 글을 밑글 삼아 이 학생 것으로 쓴다.
     저장을 눌러야 실제로 반영된다. */
  $('#btnCommentOwn').addEventListener('click', function () {
    commentOwnMode = true;
    renderCommentMode();
    toast('이 학생만 쓰는 중입니다 — 고치고 저장을 누르세요');
    setTimeout(function () { $('#commentText').focus(); }, 40);
  });

  /* [공통으로 되돌리기] — 반 공통 글을 다시 불러온다 */
  $('#btnCommentShared').addEventListener('click', function () {
    var s = students().find(function (x) { return x.id === commentTargetId; });
    commentOwnMode = false;
    freshCommentText(commonOf((s && s.className) || '_').comment || '');
    updateCommentCount();
    renderCommentMode();
    scheduleModalSave();
    toast('반 공통으로 되돌립니다');
  });

  function updateCommentCount() {
    var t = $('#commentText').value;
    $('#commentCount').textContent = t.length + '자';

    var s = students().find(function (x) { return x.id === commentTargetId; });

    /* 학생 창에서 공통과 다르게 고치기 시작하면 저절로 '이 학생만' 이 된다.
       단추를 따로 누르지 않아도 된다. */
    if (!commentIsClass && commentTargetId && !commentOwnMode) {
      var shared = (commonOf((s && s.className) || '_').comment || '');
      if (t !== shared && t.trim()) {
        commentOwnMode = true;
        renderCommentMode();
      }
    }

    var warns = checkText(t, s ? s.name : '');
    var box = $('#commentWarn');
    if (warns.length) {
      box.innerHTML = '⚠️ ' + warns.map(function (w) {
        return '<b>' + escapeHtml(w.found) + '</b> → ' + escapeHtml(w.suggest);
      }).join(' · ');
      box.classList.add('is-on');
    } else {
      box.classList.remove('is-on');
    }
  }

  /* 코멘트 창 글 칸은 새로 만들어지므로 창에서 받는다 */
  commentModal.addEventListener('input', function (e) {
    if (e.target.id !== 'commentText') return;
    updateCommentCount();
    scheduleModalSave();
  });

  /* 코멘트 창 — 입력을 멈추고 1.2초 뒤 그 칸에 넣고 바로 저장 (저장 단추를 안 눌러도) */
  function scheduleModalSave() {
    clearTimeout(modalTimer);
    showState(commentIsClass ? 'common' : 'entry', commentIsClass ? currentClass : commentTargetId, 'saving');
    modalTimer = setTimeout(function () { modalTimer = null; applyModal(); flushDraft(); }, 1200);
  }
  function applyModalNow() {
    if (!modalTimer) return;
    clearTimeout(modalTimer); modalTimer = null;
    applyModal();
  }

  /* 창의 글 → 그 칸 (저장 단추와 같은 규칙). 돌려주는 값: 공통으로 돌아갔는지 */
  function applyModal() {
    if (!draft) return false;
    var v = $('#commentText').value;
    if (commentIsClass) {
      commonOf(currentClass || '_').comment = v;
      saveDraft();
      renderCommonComment();
      renderEntries();
      return false;
    }
    if (!commentTargetId) return false;
    var s = students().find(function (x) { return x.id === commentTargetId; });
    var shared = (commonOf((s && s.className) || '_').comment || '');
    /* 공통으로 돌아가는 경우
         · '공통으로 되돌리기' 를 골랐다
         · 글을 비웠다 (빈 개별 코멘트는 만들 수 없다)
         · 공통과 글자 하나 다르지 않다 (굳이 따로 둘 이유가 없다) */
    var backToShared = !commentOwnMode || !v.trim() || v === shared;
    entryOf(commentTargetId).comment = backToShared ? '' : v;
    saveDraft();
    replaceCard(commentTargetId);
    return backToShared;
  }

  /* [취소] — 연 때 글로 되돌린다 (그사이 자동 저장한 것도) */
  $('#btnCommentCancel').addEventListener('click', function () {
    clearTimeout(modalTimer); modalTimer = null;
    if (commentOrig && draft) {
      if (commentOrig.cls != null) {
        if ((commonOf(commentOrig.cls).comment || '') !== commentOrig.value) { commonOf(commentOrig.cls).comment = commentOrig.value; saveDraft(); flushDraft(); }
      } else if (commentOrig.id) {
        if ((entryOf(commentOrig.id).comment || '') !== commentOrig.value) { entryOf(commentOrig.id).comment = commentOrig.value; saveDraft(); flushDraft(); }
      }
    }
    commentOrig = null;
    commentModal.close();
    renderCommonComment();
    renderEntries();
  });

  /* Esc 로 닫을 때 — 쓴 글은 지키고 닫는다 */
  commentModal.addEventListener('cancel', function () {
    if (modalTimer) { applyModalNow(); flushDraft(); }
    commentOrig = null;
  });
  commentModal.addEventListener('close', function () {
    if (modalTimer) { applyModalNow(); flushDraft(); }
  });

  $('#commentForm').addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(modalTimer); modalTimer = null;
    commentOrig = null;

    if (commentIsClass) {
      applyModal();
      flushDraft();
      commentModal.close();
      renderCommon();
      renderEntries();
      toast('반 공통 코멘트를 저장했습니다', 'good');
      return;
    }

    /* 학생 창에서 저장하면 그 학생 것이 된다.
       비우고 저장하면 반 공통으로 돌아간다. */
    var s = students().find(function (x) { return x.id === commentTargetId; });
    var shared = (commonOf((s && s.className) || '_').comment || '');
    var backToShared = applyModal();
    flushDraft();
    commentModal.close();
    renderEntries();
    renderCommonComment();
    selectStudent(commentTargetId);

    toast(backToShared
      ? (shared.trim() ? '반 공통 코멘트를 씁니다' : '코멘트를 비웠습니다')
      : '이 학생 코멘트를 저장했습니다', 'good');
  });

  function renderSnipBar() {
    var host = $('#snipBar');
    var list = Store.getSnippets();
    host.textContent = '';
    if (!list.length) {
      host.innerHTML = '<span class="muted-note">상용구가 없습니다. [상용구 관리]에서 등록하세요.</span>';
      return;
    }
    list.forEach(function (sn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'snip-chip';
      b.textContent = sn.text.replace(/\s+/g, ' ').slice(0, 22) + (sn.text.length > 22 ? '…' : '');
      b.title = sn.text;
      b.dataset.id = sn.id;
      host.appendChild(b);
    });
  }

  $('#snipBar').addEventListener('click', function (e) {
    var b = e.target.closest('.snip-chip');
    if (!b) return;
    var sn = Store.getSnippets().find(function (x) { return x.id === b.dataset.id; });
    if (!sn) return;

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var text = sn.text.split('OO').join(s ? s.name : 'OO');

    var ta = $('#commentText');
    insertText(ta, ta.value.trim() ? '\n' + text : text, true);
    updateCommentCount();
  });

  /* ---------- 정보 불러오기 ----------
     명단에서 만든 칸에 적어 둔 내용을 코멘트 창 위에 보여 주고,
     누르면 코멘트에 넣는다. 값이 빈 칸은 보이지 않는다.

     두 줄로 나눠 보여 준다.
       반  — 이 학생이 속한 반에 적어 둔 것 (시험 범위, 수업 진도 …)
       학생 — 이 학생에게만 적어 둔 것
     같은 이름의 칸이 양쪽에 있을 수 있어서 어느 쪽인지 보이게 한다. */

  function infoRow(kind, title, defs, owner) {
    var usable = defs.filter(function (f) {
      if (f.type === 'checkbox') return false;      /* 넣을 글자가 없다 */
      return String(Store.fieldValue(owner, f) || '').trim() !== '';
    });
    if (!usable.length) return null;

    var row = document.createElement('div');
    row.className = 'info-row info-row--' + kind;

    var lab = document.createElement('span');
    lab.className = 'info-bar__label';
    lab.textContent = title;
    row.appendChild(lab);

    usable.forEach(function (f) {
      var v = String(Store.fieldValue(owner, f)).trim();
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'info-chip info-chip--' + kind;
      b.dataset.key = f.key;
      b.title = title + ' · ' + f.label + ': ' + v;

      var n = document.createElement('span');
      n.className = 'info-chip__name';
      n.textContent = f.label;
      var t = document.createElement('span');
      t.className = 'info-chip__val';
      t.textContent = v.replace(/\s+/g, ' ').slice(0, 24) + (v.length > 24 ? '…' : '');

      b.appendChild(n);
      b.appendChild(t);
      row.appendChild(b);
    });

    return row;
  }

  function renderInfoBar() {
    var host = $('#infoBar');
    var s = students().find(function (x) { return x.id === commentTargetId; });

    host.textContent = '';

    var cls = s ? (s.className || '').trim() : '';
    var rows = [
      cls ? infoRow('class', '반 ' + cls, Store.getFieldDefs('class'), Store.classExtra(cls)) : null,
      infoRow('student', '학생', Store.getFieldDefs('student'), s)
    ].filter(Boolean);

    if (!rows.length) { host.hidden = true; return; }

    host.hidden = false;
    rows.forEach(function (r) { host.appendChild(r); });
  }

  /* 칩을 누르면 커서 자리에 값을 넣는다. 문장 중간에 끼워 쓰는 일이 많다. */
  $('#infoBar').addEventListener('click', function (e) {
    var b = e.target.closest('.info-chip');
    if (!b) return;

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var f = Store.getFieldDefs().find(function (x) { return x.key === b.dataset.key; });
    if (!f) return;

    var owner = Store.scopeOf(f) === 'class'
      ? Store.classExtra((s && s.className) || '')
      : s;
    var text = String(Store.fieldValue(owner, f) || '').trim();
    if (!text) return;

    var ta = $('#commentText');
    insertText(ta, text, false);
    updateCommentCount();
  });

  /* ---------- 상용구 관리 ---------- */

  var snipModal = $('#snipModal');

  $('#btnManageSnips').addEventListener('click', function () {
    renderSnipList();
    snipModal.showModal();
  });

  function renderSnipList() {
    var host = $('#snipList');
    var list = Store.getSnippets();
    host.textContent = '';
    if (!list.length) {
      host.innerHTML = '<p class="muted-note">아직 등록한 상용구가 없습니다.</p>';
      return;
    }
    list.forEach(function (sn) {
      var row = document.createElement('div');
      row.className = 'snip-row';
      row.innerHTML = '<span class="snip-row__text"></span>' +
                      '<button class="btn btn--sm btn--danger" type="button" data-del="' + sn.id + '">삭제</button>';
      row.querySelector('.snip-row__text').textContent = sn.text;
      host.appendChild(row);
    });
  }

  $('#btnSnipAdd').addEventListener('click', function () {
    var t = $('#snipNew').value.trim();
    if (!t) { toast('내용을 입력해 주세요', 'bad'); return; }
    var list = Store.getSnippets();
    list.push({ id: Store.newId(), text: t });
    Store.saveSnippets(list);
    $('#snipNew').value = '';
    renderSnipList();
    renderSnipBar();
    toast('상용구를 추가했습니다', 'good');
  });

  $('#snipList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    Store.deleteSnippet(b.dataset.del).then(function () {
      renderSnipList();
      renderSnipBar();
    }).catch(function (err) { toast('지우지 못했습니다 — ' + err.message, 'bad'); });
  });

  $('#snipForm').addEventListener('submit', function () { renderSnipBar(); });

  /* ============================================================
     맞춤법 경고 (C단계)
     자주 나는 오타만 본다. 맞춤법 검사기가 아니다.
     ============================================================ */

  function hasBatchim(ch) {
    var code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return false;
    return (code % 28) !== 0;
  }

  var FIXED = [
    { re: /언머니/g,   suggest: '어머니' },
    { re: /어머님께서는요/g, suggest: '어머님께서는' },
    { re: /되요/g,     suggest: '돼요' },
    { re: /감사합니당/g, suggest: '감사합니다' },
    { re: /하겠슴니다/g, suggest: '하겠습니다' },
    { re: /했읍니다/g,  suggest: '했습니다' }
  ];

  function checkText(text, studentName) {
    var out = [];
    if (!text) return out;

    FIXED.forEach(function (f) {
      var m = text.match(f.re);
      if (m) out.push({ found: m[0], suggest: f.suggest });
    });

    /* 이름 + 조사 — 받침 있는 이름 뒤에는 '이가/이는/이를' 을 쓴다 */
    var name = String(studentName || '').trim();
    if (name.length >= 2) {
      var given = name.slice(1);                 /* 성을 뺀 이름 */
      [given, name].forEach(function (base) {
        if (!base) return;
        var last = base[base.length - 1];
        if (!hasBatchim(last)) return;
        ['가', '는', '를'].forEach(function (josa) {
          var bad = base + josa;
          if (text.indexOf(bad) !== -1) {
            out.push({ found: bad, suggest: base + '이' + josa });
          }
        });
      });
    }

    /* 중복 제거 */
    var seen = {};
    return out.filter(function (w) {
      if (seen[w.found]) return false;
      seen[w.found] = 1;
      return true;
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ============================================================
     공개 단계로 — 맞춤법만 확인하고 넘겨준다
     ============================================================ */

  var spellModal = $('#spellModal');
  var pendingEnqueue = null;

  $('#btnEnqueue').addEventListener('click', function () {
    if (!draft.weekStart || !draft.weekEnd) { toast('주차를 먼저 정해 주세요', 'bad'); return; }

    var list = studentsOfClass(currentClass);
    if (!list.length) { toast('담을 학생이 없습니다', 'bad'); return; }

    /* 맞춤법 확인 */
    var warns = [];
    list.forEach(function (s) {
      /* 실제로 나갈 글을 본다. 반 공통을 쓰는 학생도 검사 대상이다. */
      checkText(commentOf(s.id).text, s.name).forEach(function (w) {
        warns.push({ name: s.name, found: w.found, suggest: w.suggest });
      });
    });

    pendingEnqueue = list;
    if (warns.length) {
      $('#spellList').innerHTML = warns.map(function (w) {
        return '<div class="spell-row"><b>' + escapeHtml(w.name) + '</b> · ' +
               '<span class="spell-bad">' + escapeHtml(w.found) + '</span> → ' +
               '<span class="spell-ok">' + escapeHtml(w.suggest) + '</span></div>';
      }).join('');
      spellModal.showModal();
    } else {
      doEnqueue();
    }
  });

  $('#btnSpellFix').addEventListener('click', function () {
    spellModal.close();
    pendingEnqueue = null;
  });

  $('#btnSpellIgnore').addEventListener('click', function () {
    spellModal.close();
    doEnqueue();
  });

  function doEnqueue() {
    var list = pendingEnqueue;
    pendingEnqueue = null;
    if (!list) return;

    flushDraft();                 /* 넘어가기 전에 마지막 입력까지 저장 */
    UI.selectTab(2);
  }

  /* ============================================================
     새로 그리기
     ============================================================ */

  function refreshAll() {
    if (!students().length) {
      $('#writeNoStudents').hidden = false;
      $('#writeMain').hidden = true;
      return;
    }
    $('#writeNoStudents').hidden = true;
    $('#writeMain').hidden = false;

    renderWeek();
    renderClassPicker();
    renderBar();
    renderCommon();
    renderEntries();

    /* 미리보기는 학생을 누르기 전에는 안내만 (예전처럼 첫 학생을 저절로 고르지 않는다 · 20261029b) */
    schedulePreview();
  }

  /* 작성 탭이 열릴 때마다 최신 명단으로 다시 그린다 */
  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 1) refreshAll();
    else flushDraft();          /* 다른 화면으로 갈 때 마지막 글까지 저장 */
  });

  /* ---------- 여러 기기 ----------
     다른 기기에서 바뀐 내용이 들어오면 그 학생 카드만 다시 그린다.
     지금 고치는 칸은 건드리지 않는다 (store.js 에 알려 준다). */

  Store.setEditingHook(function (kind, id) {
    var keys = [];
    if (commentModal.open) {
      if (kind === 'entry' && !commentIsClass && commentTargetId === id) keys.push('comment');
      if (kind === 'common' && id === currentClass) keys.push('comment');
    }
    var a = document.activeElement;
    if (a && a.closest && !$('#panel-write').hidden) {
      var card = a.closest('.entry');
      if (kind === 'entry' && card && card.dataset.id === id) {
        if (a.dataset.act === 'note') keys.push('attend_note');
        if (a.dataset.act === 'score') keys.push('scores.' + a.dataset.i);
      }
      if (kind === 'common' && id === currentClass && a.closest('#commonPanel')) {
        keys.push('lessons', 'tests', 'homework', 'comment');
      }
    }
    return keys;
  });

  function currentTests() {
    return (commonOf(currentClass || '_').tests || []).filter(function (t) { return String(t || '').trim(); });
  }

  function replaceCard(id) {
    var old = $('#entryList .entry[data-id="' + id + '"]');
    if (!old || old.contains(document.activeElement)) return;
    var s = students().find(function (x) { return x.id === id; });
    if (!s) return;
    var tests = currentTests();
    var wrap = document.createElement('div');
    wrap.innerHTML = entryCardHtml(s, tests);
    var card = wrap.firstElementChild;
    fillEntryCard(card, s, tests);
    card.className = old.className;
    old.replaceWith(card);
  }

  window.addEventListener('jt:draft-remote', function (e) {
    if (!draft || $('#panel-write').hidden) return;
    var d = e.detail || {};
    if ((d.common || []).indexOf('_week') !== -1) renderWeek();
    if ((d.common || []).indexOf(currentClass) !== -1) {
      if (!$('#commonPanel').contains(document.activeElement)) renderCommon();
      else renderCommonComment();       /* 다른 칸에 커서가 있어도 코멘트 칸은 맞춘다 (커서가 있는 칸은 그대로) */
      if (!$('#entryList').contains(document.activeElement)) renderEntries();
      else (d.entries || []).forEach(replaceCard);
    } else {
      (d.entries || []).forEach(replaceCard);
    }
    if (commentModal.open) renderCommentMode();
    renderClassPicker();
    updateCounts();
    schedulePreview();
  });

  /* 명단 등이 서버에서 새로 왔을 때 */
  window.addEventListener('jt:refreshed', function () {
    if (!draft || $('#panel-write').hidden) return;
    if (UI.isBusy($('#panel-write')) || commentModal.open) {
      if (window.Sync) Sync.markSkipped();
      renderClassPicker();
      updateCounts();
      return;
    }
    refreshAll();
  });

  /* 서버에서 받아온 뒤에는 그 내용으로 다시 그린다 */
  window.addEventListener('jt:loaded', function () {
    draft = loadDraft();
    selectedId = '';
    collapsedEntries = {};
    renderWeek();
    if (!$('#panel-write').hidden) refreshAll();
    SB.getSession().then(function (sess) {
      Store.setBackupUser(sess && sess.user && sess.user.email);
      if (window.DraftGuard) DraftGuard.checkRestore();
    }).catch(function () {});
  });

  /* ============================================================
     시작
     ============================================================ */

  /* 복습테스트 확인 점수가 오면 미리보기 다시 (migration-013) */
  window.addEventListener('jt:review-scores', function () { if (!$('#panel-write').hidden) schedulePreview(); });

  /* 이름표가 바뀌면(칸 관리) 다시 그린다 */
  window.addEventListener('jt:roster-changed', function () {
    if (!$('#panel-write').hidden) refreshAll();
  });

  /* 레포트 발송 → 2 공개이 목록을 만들기 전에 마지막 입력까지 저장해 둔다 */
  /* ============================================================
     「AI로 다듬기」 · 「AI로 초안 쓰기」 (aipolish.js · text-polish · 20261029g)
       반 공통 코멘트 · 학생 코멘트(코멘트 창) — 다듬기 + 초안 · 수업 내용(차시 줄 묶음) — 다듬기
       글 칸은 다시 그릴 때 새로 만들어지므로(setFresh · freshCommentText) 읽기 · 쓰기를 함수로 준다
       초안 자료는 화면에 이미 있는 것만 — 수업 내용 · 앱 과제 수행 · 복습테스트 제출 여부(점수 없음) · 자료 이름 · 출결 · 집중도.
       학생 이름 · 전화번호 · 금액 · 상담 내용은 넣지 않는다
     ============================================================ */

  function lessonsOfClass() {
    if (!draft) return [];
    return (commonOf(currentClass || '_').lessons || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  }
  var NEED_LESSONS = '수업 내용 요약을 먼저 채우면 더 정확합니다';

  function classDraftFacts() {
    var cls = currentClass;
    if (!cls) return null;
    var f = {};
    var L = window.Lesson && Store.lessonOf ? Lesson.reportFields(Store.lessonOf(cls, draft.weekStart)) : {};
    if (L && L.lessonDate) f.수업일 = Lesson.md(L.lessonDate);
    var ls = lessonsOfClass();
    if (ls.length) f.수업내용 = ls;
    /* 앱 과제 — 이 레포트 수업일 D 기준 D-7 ~ D-1 (러닝노트 레포트와 같은 기간 · 20261029h) */
    var app = window.Today && Today.classApp ? Today.classApp(cls, (L && L.lessonDate) || '') : null;
    if (app) f.앱과제 = app;
    var rv = window.Review && Review.classFacts ? Review.classFacts(cls, draft.weekStart) : null;
    if (rv && rv.length) f.복습테스트 = rv;
    var files = window.Weekly && Weekly.fileFacts ? Weekly.fileFacts(cls, draft.weekStart) : null;
    if (files && files.length) f.배부자료 = files;
    return { target: 'class', facts: f, note: ls.length ? '' : NEED_LESSONS };
  }

  var ATT_LABEL = { attend: '출석', late: '지각', absent: '결석', makeup: '출석' };
  function studentDraftFacts(id) {
    var s = students().find(function (x) { return x.id === id; });
    if (!s) return null;
    var e = entryOf(id);
    var f = {};
    f.출결 = (ATT_LABEL[e.attendStatus] || '기록 없음') + (e.attendStatus === 'late' && String(e.attendNote || '').trim() ? ' (' + String(e.attendNote).trim() + ')' : '');
    if (e.attendStatus !== 'absent') f.집중도 = (Number(e.focusScore) || 0) + '/5';
    var L = window.Lesson && Store.lessonOf ? Lesson.reportFields(Store.lessonOf(currentClass, draft.weekStart)) : {};
    var t = window.Today && Today.studentFacts ? Today.studentFacts(id, (L && L.lessonDate) || '') : null;
    if (t) Object.keys(t).forEach(function (k) { f[k] = t[k]; });
    var rv = window.Review && Review.studentFacts ? Review.studentFacts(currentClass, draft.weekStart, id) : null;
    if (rv && rv.length) f.복습테스트 = rv;
    var ls = lessonsOfClass();
    if (ls.length) f.이번주수업 = ls;
    var cc = String(commonOf((s.className || '').trim() || currentClass || '_').comment || '').trim();
    if (cc) f.반공통코멘트 = cc;
    return { target: 'student', facts: f, note: ls.length ? '' : NEED_LESSONS };
  }

  if (window.AiPolish) {
    /* 반 공통 코멘트 */
    AiPolish.attach($('#commonComment'), {
      kind: 'comment', id: 'commonAi', host: $('#commonAiHost'),
      get: function () { return $('#commonComment').value; },
      set: function (v) { var el = $('#commonComment'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      draft: function () { return Promise.resolve(classDraftFacts()); }
    });
    /* 코멘트 창 — 반 공통(크게 쓰기) 또는 학생 한 명. 학생 창에서 반 공통을 쓰는 중이면 빈 칸으로 보고 초안을 바로 넣는다 */
    AiPolish.attach($('#commentText'), {
      kind: 'comment', id: 'commentAi', host: $('#commentAiHost'),
      get: function () { return $('#commentText').value; },
      set: function (v) { var el = $('#commentText'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      isEmpty: function () { return !$('#commentText').value.trim() || (!commentIsClass && !commentOwnMode); },
      draft: function () { return Promise.resolve(commentIsClass ? classDraftFacts() : studentDraftFacts(commentTargetId)); }
    });
    /* 수업 내용 — 차시 줄을 한 번에 (줄 수 그대로) */
    AiPolish.attach($('#lessonList'), {
      kind: 'lessons', id: 'lessonAi', host: $('#lessonAiHost'),
      get: function () { return lessonsOfClass().join('\n'); },
      set: function (v) {
        var c = commonOf(currentClass || '_');
        c.lessons = String(v || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!c.lessons.length) c.lessons = [''];
        showState('common', currentClass, 'saving');
        saveDraft(); renderCommon(); schedulePreview();
      }
    });
    /* 다른 반 · 다른 주 · 다른 학생으로 바뀌면 결과 · 되돌리기를 지운다 */
    window.addEventListener('jt:write-nav', function () {
      AiPolish.reset('commonAi'); AiPolish.reset('lessonAi');
    });
    commentModal.addEventListener('close', function () { AiPolish.reset('commentAi'); });
  }

  window.Writer = {
    flush: flushDraft,
    switchWeek: switchWeek,
    refresh: function () { if (!$('#panel-write').hidden) refreshAll(); },
    commonOf: function (cls) { return commonOf(cls); },
    entryOf: function (id) { return entryOf(id); },
    /* 복습테스트 「미응시 · 결석」 (review.js · 20261029h) — 지금 쓰는 주가 그 주일 때만 출결 ('' = 비어 있음, null = 다른 주) */
    attendOf: function (id, week) {
      if (!draft || !week || !window.Lesson) return null;
      var mon = function (d) { return Lesson.addDays(d, -((Lesson.dowOf(d) + 6) % 7)); };
      if (mon(String(draft.weekStart).slice(0, 10)) !== mon(String(week).slice(0, 10))) return null;
      return entryOf(id).attendStatus || '';
    },
    setAbsent: function (id) {
      var e = entryOf(id);
      e.attendStatus = 'absent'; e.attendNote = ''; e.focusScore = 0;
      rePub.edited[rePubKey()] = true; showRePub();
      saveDraft(); flushDraft();
      replaceCard(id); updateCounts(); renderClassPicker();
    },
    save: function () { saveDraft(); return flushDraft(); },
    renderCommon: function () { renderCommon(); renderEntries(); },
    replaceCard: function (id) { replaceCard(id); },
    setFresh: setFresh,
    modal: function () {
      return commentModal.open ? { isClass: commentIsClass, id: commentTargetId, cls: currentClass } : null;
    },
    setModalText: function (v) { freshCommentText(v); updateCommentCount(); applyModal(); return flushDraft(); },
    current: function () { return draft; },
    currentClass: function () { return currentClass; },
    mode: function () { return mode; },
    setMode: setMode,
    openWeek: openWeek,
    openWeeks: openWeeks,
    /* 뒤로가기 · 새로고침으로 반을 되돌릴 때 (nav.js) */
    selectClass: function (cls) {
      if (!cls || cls === currentClass) return;
      if (!Store.getClasses().some(function (c) { return c.name === cls; })) return;
      currentClass = cls;
      selectedId = '';
      if (!$('#panel-write').hidden) refreshAll();
    },
    /* 코멘트 창에 아직 넣지 않은 글이 있는가 (떠나기 전 확인) */
    pending: function () { return !!modalTimer; },
    preview: schedulePreview,
    /* AI 요약 [확정] → 그 반 「수업 내용」 칸 (summary.js) */
    lessonsOf: function (cls) {
      return ((draft && commonOf(cls || '_').lessons) || []).filter(function (l) { return String(l || '').trim(); });
    },
    setLessons: function (cls, lines) {
      if (!draft) return;
      commonOf(cls || '_').lessons = lines.length ? lines.slice() : [''];
      saveDraft();
      flushDraft();
      if (cls === currentClass && !$('#panel-write').hidden) renderCommon();
      schedulePreview();
    }
  };

  draft = loadDraft();
  renderWeek();

})();
