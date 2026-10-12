/* ============================================================
   write.js — ② 작성 탭

   주차 선택 · 반 공통 입력 · 학생별 입력 · 실시간 미리보기
   자동 저장 · 지난주 불러오기 · 코멘트 상용구 · 맞춤법 경고

   40~100명을 매주 입력하므로, 반복 입력을 최대한 줄이는 것이 목표다.
     · 수업 내용과 테스트 이름은 반마다 한 번
     · 학생별로는 출결·별점·점수·과제·코멘트만
   퇴원한 학생은 작성 목록에 나오지 않는다.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var STATUSES = [
    { key: 'attend', label: '출석' },
    { key: 'late',   label: '지각' },
    { key: 'absent', label: '결석' },
    { key: 'makeup', label: '보강' }
  ];

  /* ============================================================
     상태
     ============================================================ */

  var draft = null;
  var currentClass = '';
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

  /* 과제 목록을 꺼낸다. 없으면 만들어 둔다. */
  function hwListOf(cls) {
    var c = commonOf(cls);
    if (!Array.isArray(c.homework)) c.homework = [];
    return c.homework;
  }

  function hwOfGroup(cls, group) {
    return hwListOf(cls).filter(function (it) { return Report.groupOf(it) === group; });
  }

  /* 항목 key 는 한 번 정하면 바꾸지 않는다. 학생이 체크해 둔 값이
     이 key 로 붙어 있기 때문에, 이름을 고쳐도 체크가 따라온다. */
  function newHwKey(cls) {
    var used = {};
    hwListOf(cls).forEach(function (it) { used[it.key] = 1; });
    for (var n = 1; n < 999; n++) {
      if (!used['h' + n]) return 'h' + n;
    }
    return 'h' + Date.now();
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

  var saveTimer = null;
  var dirty = false;          /* 이 화면에서 실제로 고친 게 있는가 */

  /* 고친 적이 없으면 저장하지 않는다.
     탭을 두 개 열어 둔 경우, 손대지 않은 탭이 닫히면서
     메모리에 있던 옛 내용으로 다른 탭의 작업을 덮어쓸 수 있다. */
  function flushDraft() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    Store.write(Store.KEYS.draft, draft);
  }

  function saveDraft() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 400);
  }

  /* 탭을 닫거나 화면을 벗어날 때 마지막 타자까지 확실히 저장한다.
     디바운스만 믿으면 마지막 0.4초가 날아갈 수 있다. */
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

  /* 이 학생의 작성 상태. 규칙은 report.js 한 곳에 있다.
     ③ 공개 탭도 같은 함수를 쓰므로 둘이 어긋날 수 없다. */
  function statusOf(id) {
    var s = students().find(function (x) { return x.id === id; });
    return Report.entryStatus(commonOf((s && s.className) || '_'), entryOf(id));
  }

  function isWritten(id) { return statusOf(id).state === 'done'; }

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
    if (!newStart || newStart === draft.weekStart || switching) { renderWeek(); return; }
    switching = true;
    clearTimeout(saveTimer);
    var flush = dirty ? Store.flushNow(Store.KEYS.draft, draft) : Promise.resolve();
    dirty = false;
    Store.writeLocal(Store.KEYS.draft, draft);

    $('#weekSummary').textContent = '불러오는 중…';
    flush.then(function () {
      return Store.loadWeekIntoDraft(newStart);
    }).then(function (d) {
      draft = d;
      /* 서버에 그 주차 종료일이 없으면 지금 쓰던 기간 길이를 그대로 쓴다 */
      if (!d.weekEndTouched && span > 0) {
        draft.weekEnd = Store.autoEnd(newStart, span) || draft.weekEnd;
        draft.weekEndTouched = true;
        saveDraft();
      }
      switching = false;
      selectedId = '';
      collapsedEntries = {};
      renderWeek();
      refreshAll();
      toast(Store.shortDate(newStart) + ' 주차를 열었습니다');
    }).catch(function (e) {
      switching = false;
      renderWeek();
      toast('주차를 불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  $('#weekStart').addEventListener('change', function (e) {
    var span = (draft.weekEndTouched && draft.weekStart && draft.weekEnd)
                 ? Store.daysBetween(draft.weekStart, draft.weekEnd) : 0;
    switchWeek(e.target.value, span);
  });

  $('#weekEnd').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v && draft.weekStart && v < draft.weekStart) {
      toast('종료일이 시작일보다 빠릅니다', 'bad');
      renderWeek();                        /* 옛 값으로 되돌린다 */
      return;
    }
    draft.weekEnd = v;
    draft.weekEndTouched = true;           /* 사람이 고른 값이다 */
    /* 이 길이를 기억해 두고 다음 주차에도 같은 길이를 쓴다 */
    Store.setWeekSpan(Store.daysBetween(draft.weekStart, v));
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
      host.innerHTML = '<p class="panel__hint">명단에 반이 지정된 학생이 없습니다. ① 명단 탭에서 반을 넣어 주세요.</p>';
      currentClass = '';
      return;
    }

    if (!classes.some(function (c) { return c.name === currentClass; })) {
      currentClass = classes[0].name;
    }

    var frag = document.createDocumentFragment();
    classes.forEach(function (c) {
      var list = studentsOfClass(c.name);
      var done = list.filter(function (s) { return isWritten(s.id); }).length;

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.name === currentClass ? ' is-on' : '') +
                    (done === list.length && list.length ? ' is-done' : '');
      b.dataset.cls = c.name;
      b.innerHTML = '<span class="chip__name"></span>' +
                    '<span class="chip__count num">' + done + '/' + list.length + '</span>';
      b.querySelector('.chip__name').textContent = c.name;
      frag.appendChild(b);
    });
    host.appendChild(frag);

    var total = students().length;
    var written = students().filter(function (s) { return isWritten(s.id); }).length;
    $('#classPickerHint').textContent = '전체 ' + written + ' / ' + total + '명 작성됨';
  }

  $('#classPicker').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    currentClass = chip.dataset.cls;
    selectedId = '';
    refreshAll();
  });

  /* ============================================================
     반 공통 — 수업 내용 · 테스트 이름
     ============================================================ */

  /* 반 공통의 과제 이름 목록. 리뷰테스트 목록과 같은 모양이다. */
  function renderHomeworkList(group, hostId, label, placeholder) {
    var host = $('#' + hostId);
    if (!host) return;
    host.textContent = '';

    var items = hwOfGroup(currentClass || '_', group);

    if (!items.length) {
      var p = document.createElement('p');
      p.className = 'panel__hint';
      p.textContent = group === 'required'
        ? '아직 없습니다. 과제 이름을 넣어야 학생 카드에 체크 칸이 생깁니다.'
        : '아직 없습니다. 선택과제가 없으면 레포트에도 안 나옵니다.';
      host.appendChild(p);
      return;
    }

    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'row-item';
      row.innerHTML =
        '<span class="row-item__no">' + label + '</span>' +
        '<input class="input" type="text" data-kind="hw" data-key="' + it.key + '">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="hw"' +
        ' data-key="' + it.key + '" aria-label="삭제">×</button>';
      row.querySelector('input').value = it.name || '';
      row.querySelector('input').placeholder = placeholder;
      host.appendChild(row);
    });
  }

  function renderCommonComment() {
    var c = commonOf(currentClass || '_');
    var ta = $('#commonComment');
    if (ta.value !== (c.comment || '')) ta.value = c.comment || '';

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

    renderHomeworkList('required', 'hwReqList', '필수', '예) 문학 주간지');
    renderHomeworkList('optional', 'hwOptList', '선택', '예) 기출 추가문제');
    renderCommonComment();

    var tests = $('#testList');
    tests.textContent = '';
    (c.tests.length ? c.tests : ['']).forEach(function (name, i) {
      var row = document.createElement('div');
      row.className = 'row-item';
      row.innerHTML =
        '<span class="row-item__no">테스트</span>' +
        '<input class="input" type="text" data-kind="test" data-i="' + i + '"' +
        ' placeholder="예) 문법 리뷰테스트">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="test" data-i="' + i + '" aria-label="삭제">×</button>';
      row.querySelector('input').value = name || '';
      tests.appendChild(row);
    });
  }

  /* 테스트 이름이 바뀌면 학생 카드의 점수 칸 개수도 달라진다.
     타이핑 중에 매번 다시 그리면 무거우니 잠깐 묶어서 처리한다. */
  var entriesTimer = null;
  function scheduleEntries() {
    clearTimeout(entriesTimer);
    entriesTimer = setTimeout(renderEntries, 300);
  }

  $('#commonPanel').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.kind === 'lesson') {
      commonOf(currentClass).lessons[+el.dataset.i] = el.value;
      saveDraft(); schedulePreview();
    } else if (el.dataset.kind === 'test') {
      commonOf(currentClass).tests[+el.dataset.i] = el.value;
      saveDraft(); schedulePreview();
      scheduleEntries();
    } else if (el.dataset.kind === 'hw') {
      var it = hwListOf(currentClass || '_').find(function (x) {
        return x.key === el.dataset.key;
      });
      if (it) it.name = el.value;
      saveDraft(); schedulePreview();
      scheduleEntries();          /* 이름이 생겨야 학생 카드에 체크 칸이 뜬다 */
    }
  });

  $('#commonPanel').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var c = commonOf(currentClass);
    var i = +btn.dataset.i;

    if (btn.dataset.del === 'hw') {
      /* 과제 항목을 지운다. 학생들이 체크해 둔 값도 같이 지운다.
         key 로 붙어 있으므로 다른 항목은 건드리지 않는다. */
      var key = btn.dataset.key;
      var list = hwListOf(currentClass || '_');
      var idx = list.findIndex(function (x) { return x.key === key; });
      if (idx >= 0) list.splice(idx, 1);
      Object.keys(draft.entries).forEach(function (id) {
        if (draft.entries[id].homework) delete draft.entries[id].homework[key];
      });
      saveDraft();
      renderCommon();
      renderEntries();
      schedulePreview();
      return;
    }

    if (btn.dataset.del === 'lesson') {
      c.lessons.splice(i, 1);
      if (!c.lessons.length) c.lessons = [''];
    } else {
      c.tests.splice(i, 1);
      if (!c.tests.length) c.tests = [''];
      /* 테스트를 지우면 학생들의 점수 인덱스도 같이 당긴다 */
      Object.keys(draft.entries).forEach(function (id) {
        var sc = draft.entries[id].scores || {};
        var next = {};
        Object.keys(sc).forEach(function (k) {
          var n = +k;
          if (n < i) next[n] = sc[k];
          else if (n > i) next[n - 1] = sc[k];
        });
        draft.entries[id].scores = next;
      });
    }
    saveDraft();
    renderCommon();
    renderEntries();
    schedulePreview();
  });

  $('#commonComment').addEventListener('input', function (e) {
    /* 읽는 쪽(renderCommonComment)과 같은 자리를 써야 한다.
       반이 아직 안 골라졌으면 양쪽 다 '_' 를 쓴다. */
    commonOf(currentClass || '_').comment = e.target.value;
    renderCommonComment();
    renderEntries();          /* 공통을 쓰는 학생 카드의 미리보기가 같이 바뀐다 */
    saveDraft();
  });

  /* 폰에서 길게 쓰기 — 코멘트 모달을 반 공통 모드로 연다 */
  $('#btnCommonCommentBig').addEventListener('click', function () {
    openCommentModal('', { classComment: true });
  });

  function addHomework(group) {
    var cls = currentClass || '_';
    hwListOf(cls).push({ key: newHwKey(cls), group: group, name: '' });
    saveDraft();
    renderCommon();
    renderEntries();
    /* 새로 생긴 칸에 바로 쓸 수 있게 */
    var host = $(group === 'required' ? '#hwReqList' : '#hwOptList');
    var inputs = host ? host.querySelectorAll('input') : [];
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  $('#btnAddHwReq').addEventListener('click', function () { addHomework('required'); });
  $('#btnAddHwOpt').addEventListener('click', function () { addHomework('optional'); });

  $('#btnAddLesson').addEventListener('click', function () {
    commonOf(currentClass).lessons.push('');
    saveDraft(); renderCommon();
  });

  $('#btnAddTest').addEventListener('click', function () {
    commonOf(currentClass).tests.push('');
    saveDraft(); renderCommon(); renderEntries();
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
      var hasContent = c.lessons.some(function (x) { return String(x || '').trim(); }) ||
                       c.tests.some(function (x) { return String(x || '').trim(); });

      function apply() {
        c.lessons = (h.lessons || ['']).slice();
        c.tests   = (h.tests || ['']).slice();
        if (!c.lessons.length) c.lessons = [''];
        if (!c.tests.length) c.tests = [''];
        /* 과제 이름은 지난주 것을 그대로 쓰는 일이 많다. 체크는 학생마다 새로 한다. */
        if ((h.homework || []).length && !Report.homeworkItems(c).length) {
          c.homework = h.homework.map(function (it) { return { key: it.key, group: it.group, name: it.name }; });
        }
        saveDraft(); renderCommon(); renderEntries(); schedulePreview();
        toast(Store.shortDate(h.weekStart) + ' 주차를 불러왔습니다', 'good');
      }

      if (!hasContent) { apply(); return; }
      UI.confirmAsk('지난주 불러오기',
        Store.shortDate(h.weekStart) + ' 주차 내용으로 바꿉니다. 지금 입력한 수업 내용과 테스트 이름은 사라집니다.',
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
             (e.attendStatus === st.key ? ' is-on' : '') +
             '" data-act="status" data-v="' + st.key + '">' + st.label + '</button>';
    }).join('');

    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="star' + (i <= e.focusScore ? ' is-on' : '') +
               '" data-act="star" data-v="' + i + '" aria-label="' + i + '점">★</button>';
    }

    var scoreRow = tests.length
      ? tests.map(function (name, i) {
          return '<label class="score"><span class="score__name"></span>' +
                 '<input class="input input--num" type="number" inputmode="numeric" min="0" max="100" ' +
                 'data-act="score" data-i="' + i + '" placeholder="-"></label>';
        }).join('')
      : '<span class="muted-note">반 공통에 테스트 이름을 넣으면 점수 칸이 생깁니다</span>';

    var needNote = e.attendStatus === 'late' || e.attendStatus === 'makeup';

    return '' +
      '<div class="entry' + (open ? '' : ' is-collapsed') + (isWritten(s.id) ? ' is-written' : '') +
        (selectedId === s.id ? ' is-selected' : '') + '" data-id="' + s.id + '">' +
        '<div class="entry__head" data-act="head">' +
          '<span class="entry__name"></span>' +
          '<span class="entry__badge"></span>' +
          '<span class="entry__caret" aria-hidden="true">▾</span>' +
        '</div>' +
        '<div class="entry__body">' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">출결</span>' +
            '<span class="att-group">' + statusBtns + '</span>' +
            '<input class="input input--note" type="text" data-act="note" ' +
              'placeholder="예) 10분 지각 · 9/12 보강"' + (needNote ? '' : ' hidden') + '>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">집중도</span>' +
            '<span class="stars">' + stars + '</span>' +
            '<span class="stars__val num">' + (e.focusScore || 0) + ' / 5</span>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">점수</span>' +
            '<span class="scores">' + scoreRow + '</span>' +
          '</div>' +
          '<div class="fieldline fieldline--hw">' +
            '<span class="fieldline__label">과제</span>' +
            '<div class="hwd" data-role="hwchecks"></div>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">코멘트</span>' +
            '<button type="button" class="comment-btn" data-act="comment">' +
              '<span class="comment-btn__text"></span>' +
              '<span class="comment-btn__count num"></span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* 학생 카드의 과제 체크 칸.
     항목은 반 공통에서 오므로 이름을 고치거나 지우면 여기도 같이 바뀐다.

     항목 한 줄:  [필수] 이름 · 월 화 수 목 금 · 3/5
     필수/선택 표시는 그 묶음 첫 줄에만 붙인다. 이름을 누르면 월~금을
     한꺼번에 켜고 끈다. */
  function fillHomework(el, s, e) {
    var host = el.querySelector('[data-role="hwchecks"]');
    if (!host) return;

    var common = commonOf((s && s.className) || '_');
    var items = Report.homeworkItems(common);
    var hw = e.homework || {};
    host.textContent = '';

    if (!items.length) {
      var hint = document.createElement('span');
      hint.className = 'hw-empty';
      hint.textContent = '반 공통에 과제 이름을 넣어 주세요';
      host.appendChild(hint);
      return;
    }

    var first = true;
    ['required', 'optional'].forEach(function (g) {
      var list = items.filter(function (it) { return Report.groupOf(it) === g; });
      if (!list.length) return;

      if (!first) host.appendChild(span('hwd-sep', ''));
      first = false;

      list.forEach(function (it, i) {
        var v = hw[it.key];

        host.appendChild(i === 0
          ? span('hw-tag hw-tag--' + g, g === 'required' ? '필수' : '선택')
          : span('', ''));

        var name = document.createElement('button');
        name.type = 'button';
        name.className = 'hwd-name';
        name.dataset.act = 'hwall';
        name.dataset.key = it.key;
        name.title = '누르면 월~금 한꺼번에 켜고 끕니다';
        name.textContent = it.name;
        host.appendChild(name);

        var days = span('hwd-days', '');
        Report.DAYS.forEach(function (day) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'hw' + (v && typeof v === 'object' && v[day] ? ' is-on' : '');
          b.dataset.act = 'hwday';
          b.dataset.key = it.key;
          b.dataset.day = day;
          b.textContent = day;
          days.appendChild(b);
        });
        host.appendChild(days);

        host.appendChild(span('hwd-n num', Report.daysDone(v) + '/5'));
      });
    });

    var foot = span('hwd-foot', '');
    var rate = span('rate-note num', homeworkRateText(common, hw));
    rate.dataset.role = 'rate';
    foot.appendChild(rate);
    foot.appendChild(span('hwd-hint', '이름을 누르면 월~금 한꺼번에'));
    host.appendChild(foot);
  }

  function span(cls, text) {
    var el = document.createElement('span');
    if (cls) el.className = cls;
    el.textContent = text;
    return el;
  }

  /* '필수 12/15 (80%) · 선택 2/10 (20%)' — 레포트 게이지와 같은 함수로 센다 */
  function homeworkRateText(common, hw) {
    var parts = [];
    [['required', '필수'], ['optional', '선택']].forEach(function (p) {
      var c = Report.countOf(common, hw, p[0]);
      if (!c) return;
      parts.push(p[1] + ' ' + c.done + '/' + c.total +
                 ' (' + Math.round(c.done / c.total * 100) + '%)');
    });
    return parts.join(' · ');
  }

  /* 카드 오른쪽 위 딱지 — 미작성(회색) · 작성 중(주황) · 작성 완료(초록).
     작성 중이면 무엇이 빠졌는지 마우스를 올려 볼 수 있게 적어 둔다. */
  function fillBadge(el, id) {
    var b = el.querySelector('.entry__badge');
    if (!b) return;
    var st = statusOf(id);
    b.textContent = Report.statusLabel(st.state);
    b.className = 'entry__badge entry__badge--' + st.state;
    b.title = st.missing.length ? '아직 필요한 것 — ' + st.missing.join(', ') : '';
  }

  function fillEntryCard(el, s, tests) {
    var e = entryOf(s.id);
    el.querySelector('.entry__name').textContent = s.name || '';
    fillBadge(el, s.id);

    $$('.score', el).forEach(function (lab, i) {
      lab.querySelector('.score__name').textContent = tests[i] || '';
      var inp = lab.querySelector('input');
      var v = e.scores && e.scores[i];
      inp.value = (v === 0 || v) ? v : '';
    });

    var note = el.querySelector('[data-act="note"]');
    if (note) note.value = e.attendNote || '';

    fillHomework(el, s, e);

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

  function renderEntries() {
    var host = $('#entryList');
    var list = studentsOfClass(currentClass);
    var onlyUn = $('#onlyUnwritten').checked;
    var shown = onlyUn ? list.filter(function (s) { return !isWritten(s.id); }) : list;
    var tests = (commonOf(currentClass || '_').tests || [])
      .filter(function (t) { return String(t || '').trim(); });

    host.textContent = '';

    if (!list.length) {
      host.innerHTML = '<div class="empty-state">이 반에 등록된 학생이 없습니다.</div>';
    } else if (!shown.length) {
      host.innerHTML = '<div class="empty-state">이 반은 <b>모두 작성했습니다.</b></div>';
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

    if (act === 'status') {
      e.attendStatus = (e.attendStatus === btn.dataset.v) ? '' : btn.dataset.v;
      if (e.attendStatus !== 'late' && e.attendStatus !== 'makeup') e.attendNote = '';
      $$('.att-btn', card).forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.v === e.attendStatus);
      });
      var note = card.querySelector('[data-act="note"]');
      note.hidden = !(e.attendStatus === 'late' || e.attendStatus === 'makeup');
      if (!note.hidden) note.value = e.attendNote || '';
      card.classList.toggle('is-written', isWritten(id));
      fillBadge(card, id);
      afterChange(id);
      return;
    }

    if (act === 'star') {
      var v = +btn.dataset.v;
      e.focusScore = (e.focusScore === v) ? 0 : v;
      $$('.star', card).forEach(function (b) {
        b.classList.toggle('is-on', +b.dataset.v <= e.focusScore);
      });
      card.querySelector('.stars__val').textContent = e.focusScore + ' / 5';
      afterChange(id);
      return;
    }

    /* 과제 — 요일 한 칸, 또는 이름을 눌러 월~금 한꺼번에.
       '했다' 만 있던 항목(true)은 누르는 순간 요일 모양으로 바뀐다. */
    if (act === 'hwday' || act === 'hwall') {
      var key = btn.dataset.key;
      if (!e.homework) e.homework = {};
      var cur = e.homework[key];
      var days = (cur && typeof cur === 'object') ? cur : {};

      if (act === 'hwday') {
        if (days[btn.dataset.day]) delete days[btn.dataset.day];
        else days[btn.dataset.day] = true;
      } else {
        var all = Report.daysDone(days) === Report.DAYS.length;
        days = {};
        if (!all) Report.DAYS.forEach(function (d) { days[d] = true; });
      }
      e.homework[key] = days;

      var s2 = students().find(function (x) { return x.id === id; });
      fillHomework(card, s2, e);
      fillBadge(card, id);
      afterChange(id);
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

    if (act === 'score') {
      var i = +ev.target.dataset.i;
      var raw = ev.target.value.trim();
      if (raw === '') delete e.scores[i];
      else e.scores[i] = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
      afterChange(id);
    } else if (act === 'note') {
      e.attendNote = ev.target.value;
      afterChange(id);
    }
  });

  function afterChange(id) {
    saveDraft();
    selectStudent(id, true);
    renderClassPicker();
    updateCounts();
  }

  function updateCounts() {
    var list = studentsOfClass(currentClass);
    var n = { none: 0, partial: 0, done: 0 };
    list.forEach(function (s) { n[statusOf(s.id).state]++; });

    $('#entryProgress').textContent = currentClass
      ? currentClass + ' · 작성 완료 ' + n.done + ' / ' + list.length + '명' +
        (n.partial ? ' · 작성 중 ' + n.partial + '명' : '')
      : '';

    $('#queueInfo').textContent = n.done
      ? n.done + '명 작성 완료 · ③ 공개 탭에 올라갑니다' +
        (n.partial ? ' (작성 중 ' + n.partial + '명은 빠집니다)' : '')
      : '필수 항목을 다 채우면 공개 목록에 올라갑니다';

    $('#btnEnqueue').disabled = !n.done;
  }

  $('#onlyUnwritten').addEventListener('change', renderEntries);

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
    if (!s) { $('#previewWho').textContent = '학생 카드를 누르면 그 학생 레포트가 보입니다'; return; }

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

  function openCommentModal(id, opts) {
    opts = opts || {};
    commentIsClass = !!opts.classComment;
    commentTargetId = commentIsClass ? '' : id;

    if (commentIsClass) {
      $('#commentWho').textContent = (currentClass || '') + ' 반 공통 코멘트';
      $('#commentText').value = commonOf(currentClass || '_').comment || '';
      $('#commentMode').hidden = true;
    } else {
      var s = students().find(function (x) { return x.id === id; });
      var own = (entryOf(id).comment || '').trim();
      $('#commentWho').textContent = (s ? s.name + ' 학생 ' : '') + '코멘트';
      /* 공통을 쓰는 중이면 그 글을 보여 준다. 그대로 저장하면 공통인 채로 남는다. */
      commentOwnMode = !!own;
      $('#commentText').value = own || (commonOf((s && s.className) || '_').comment || '');
      renderCommentMode();
    }

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
    $('#commentText').value = commonOf((s && s.className) || '_').comment || '';
    updateCommentCount();
    renderCommentMode();
    toast('반 공통으로 되돌립니다 — 저장을 누르세요');
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

  $('#commentText').addEventListener('input', updateCommentCount);

  $('#btnCommentCancel').addEventListener('click', function () { commentModal.close(); });

  $('#commentForm').addEventListener('submit', function (e) {
    e.preventDefault();

    if (commentIsClass) {
      commonOf(currentClass || '_').comment = $('#commentText').value;
      saveDraft();
      commentModal.close();
      renderCommon();
      renderEntries();
      toast('반 공통 코멘트를 저장했습니다', 'good');
      return;
    }

    /* 학생 창에서 저장하면 그 학생 것이 된다.
       비우고 저장하면 반 공통으로 돌아간다. */
    var v = $('#commentText').value;
    var s = students().find(function (x) { return x.id === commentTargetId; });
    var shared = (commonOf((s && s.className) || '_').comment || '');

    /* 공통으로 돌아가는 경우
         · '공통으로 되돌리기' 를 골랐다
         · 글을 비웠다 (빈 개별 코멘트는 만들 수 없다)
         · 공통과 글자 하나 다르지 않다 (굳이 따로 둘 이유가 없다) */
    var backToShared = !commentOwnMode || !v.trim() || v === shared;

    entryOf(commentTargetId).comment = backToShared ? '' : v;
    saveDraft();
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
    var cur = ta.value;
    ta.value = cur ? (cur.replace(/\s*$/, '') + '\n' + text) : text;
    ta.focus();
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
    var a = ta.selectionStart, z = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(z);
    var pos = a + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
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
    list.push({ id: 'sn_' + Date.now().toString(36), text: t });
    Store.saveSnippets(list);
    $('#snipNew').value = '';
    renderSnipList();
    renderSnipBar();
    toast('상용구를 추가했습니다', 'good');
  });

  $('#snipList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    Store.saveSnippets(Store.getSnippets().filter(function (x) { return x.id !== b.dataset.del; }));
    renderSnipList();
    renderSnipBar();
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
     ③ 공개 탭으로 — 맞춤법만 확인하고 넘겨준다
     ============================================================ */

  var spellModal = $('#spellModal');
  var pendingEnqueue = null;

  $('#btnEnqueue').addEventListener('click', function () {
    if (!draft.weekStart || !draft.weekEnd) { toast('주차를 먼저 정해 주세요', 'bad'); return; }

    var list = studentsOfClass(currentClass).filter(function (s) { return isWritten(s.id); });
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
    renderCommon();
    renderEntries();

    if (!selectedId) {
      var first = studentsOfClass(currentClass)[0];
      if (first) selectedId = first.id;
    }
    schedulePreview();
  }

  /* 작성 탭이 열릴 때마다 최신 명단으로 다시 그린다 */
  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 1) refreshAll();
  });

  /* 서버에서 받아온 뒤에는 그 내용으로 다시 그린다 */
  window.addEventListener('jt:loaded', function () {
    draft = loadDraft();
    selectedId = '';
    collapsedEntries = {};
    renderWeek();
    if (!$('#panel-write').hidden) refreshAll();
  });

  /* ============================================================
     시작
     ============================================================ */

  /* 이름표가 바뀌면(칸 관리) 다시 그린다 */
  window.addEventListener('jt:roster-changed', function () {
    if (!$('#panel-write').hidden) refreshAll();
  });

  /* ③ 공개 탭이 목록을 만들기 전에 마지막 입력까지 저장해 둔다 */
  window.Writer = {
    flush: flushDraft,
    current: function () { return draft; }
  };

  draft = loadDraft();
  renderWeek();

})();
