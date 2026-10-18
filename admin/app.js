/* ============================================================
   app.js — 공용 화면 도구 · ① 명단 탭

   100명까지 느려지지 않도록
     · 목록은 DocumentFragment 로 한 번에 붙인다
     · 행마다 리스너를 달지 않고 이벤트 위임을 쓴다
     · 검색은 0.15초 묶어서 처리한다
   ============================================================ */

(function () {
  'use strict';

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ============================================================
     공용 — 토스트 · 확인 창 · 복사 · 탭
     ============================================================ */

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = msg;
    $('#toastHost').appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, 2400);
  }

  var confirmModal = $('#confirmModal');

  function confirmAsk(title, desc, okLabel) {
    return new Promise(function (resolve) {
      $('#confirmTitle').textContent = title;
      $('#confirmDesc').textContent = desc;
      $('#btnConfirmYes').textContent = okLabel || '삭제';
      function cleanup(result) {
        $('#btnConfirmYes').removeEventListener('click', onYes);
        $('#btnConfirmNo').removeEventListener('click', onNo);
        confirmModal.close();
        resolve(result);
      }
      function onYes() { cleanup(true); }
      function onNo()  { cleanup(false); }
      $('#btnConfirmYes').addEventListener('click', onYes);
      $('#btnConfirmNo').addEventListener('click', onNo);
      confirmModal.showModal();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();

    function fallback() {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove();
        ok ? resolve() : reject(new Error('복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.'));
      });
    }
  }

  /* 다른 분이 먼저 고친 줄을 저장하려 할 때.
     돌려주는 값: 'reload' 새로 불러오기 · 'overwrite' 내 내용으로 덮어쓰기 · 'cancel' 나중에
     여러 개가 한꺼번에 오면 하나씩 차례로 묻는다. */
  var conflictChain = Promise.resolve();
  function conflictAsk(what) {
    var p = conflictChain.then(function () {
      return new Promise(function (resolve) {
        var modal = $('#conflictModal');
        $('#conflictDesc').textContent = (what ? '‘' + what + '’ — ' : '') + '다른 분이 먼저 수정했습니다. 새로 불러올까요?';
        function done(v) {
          ['#btnConflictReload', '#btnConflictMine', '#btnConflictLater'].forEach(function (id) { $(id).onclick = null; });
          modal.removeEventListener('cancel', onCancel);
          if (modal.open) modal.close();
          resolve(v);
        }
        function onCancel(e) { e.preventDefault(); done('cancel'); }
        $('#btnConflictReload').onclick = function () { done('reload'); };
        $('#btnConflictMine').onclick = function () { done('overwrite'); };
        $('#btnConflictLater').onclick = function () { done('cancel'); };
        modal.addEventListener('cancel', onCancel);
        modal.showModal();
      });
    });
    conflictChain = p.catch(function () {});
    return p;
  }

  /* 고친 줄 하나를 저장한다 (updated_at 확인). 다른 분이 먼저 고쳤으면 묻는다.
     attempt(checkBase) → DB.updateIf 결과. onReload() 는 '새로 불러오기' 를 골랐을 때. */
  function guardedSave(what, attempt, onReload) {
    return attempt(true).then(function (res) {
      if (res.ok) return res;
      if (res.gone) {
        toast('‘' + what + '’ 은(는) 다른 분이 지웠습니다', 'warn');
        if (onReload) onReload();
        return res;
      }
      return conflictAsk(what).then(function (choice) {
        if (choice === 'overwrite') return attempt(false);
        if (choice === 'reload' && onReload) onReload(res.row);
        return res;
      });
    });
  }

  /* 입력 중이거나 창이 열려 있으면 화면을 통째로 다시 그리지 않는다 */
  function isBusy(root) {
    if (document.querySelector('dialog[open]')) return true;
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    if (root && !root.contains(a)) return false;
    /* 닫힌 창이나 숨긴 탭 안에 포커스가 남아 있는 것은 입력 중이 아니다 */
    if (a.closest('dialog:not([open]), [hidden]') || a.disabled) return false;
    return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable ||
           (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file)$/i.test(a.type));
  }

  function whoami() { return ($('#whoami') && $('#whoami').textContent) || ''; }

  var TABS = [
    { tab: '#tab-roster',  panel: '#panel-roster'  },
    { tab: '#tab-write',   panel: '#panel-write'   },
    { tab: '#tab-publish', panel: '#panel-publish' },
    { tab: '#tab-send',    panel: '#panel-send'    },
    { tab: '#tab-notice',  panel: '#panel-notice'  },
    { tab: '#tab-book',    panel: '#panel-book'    },
    { tab: '#tab-photo',   panel: '#panel-photo'   },
    { tab: '#tab-today',   panel: '#panel-today'   }     /* 7 — 화면 맨 앞 · 로그인 첫 화면 */
  ];

  function selectTab(idx) {
    TABS.forEach(function (t, i) {
      var on = i === idx;
      $(t.tab).setAttribute('aria-selected', on ? 'true' : 'false');
      $(t.panel).hidden = !on;
    });
    document.dispatchEvent(new CustomEvent('jt:tab', { detail: { index: idx } }));
  }

  TABS.forEach(function (t, i) {
    $(t.tab).addEventListener('click', function () { selectTab(i); });
  });

  /* 공용 PC 안내 — 닫으면 기억한다 */
  var settings = Store.read(Store.KEYS.settings, {});
  if (!settings.hidePublicPcNotice) $('#publicPcNotice').hidden = false;
  $('#publicPcClose').addEventListener('click', function () {
    $('#publicPcNotice').hidden = true;
    settings.hidePublicPcNotice = true;
    Store.writeLocal(Store.KEYS.settings, settings);
  });

  /* ============================================================
     개인 링크 발급
     ============================================================ */

  /* 학생 한 명에게 새 코드를 준다. 재발급이면 예전 링크는 바로 막힌다. */
  function issueLink(studentId) {
    var code = Store.randomCode(24);
    return DB.saveLink(studentId, { hubCode: code }).then(function (link) {
      var cur = Store.linkOf(studentId);
      cur.hubCode = link.hubCode || code;
      cur.hubIssuedAt = link.hubIssuedAt || new Date().toISOString();
      if (link.appCode !== undefined) cur.appCode = link.appCode;
      Store.setLinkLocal(studentId, cur);
      return cur.hubCode;
    });
  }

  /* ---------- 학생 링크 (migration-015) ----------
     학부모 링크(hubCode)와 따로. 처음 복사할 때 만든다. 재발급하면 예전 학생 링크만 막힌다. */
  function saveStudentCode(studentId, code) {
    return DB.saveLink(studentId, { studentCode: code }).then(function (link) {
      var cur = Store.linkOf(studentId);
      cur.studentCode = link.studentCode || code;
      cur.studentIssuedAt = link.studentIssuedAt || new Date().toISOString();
      Store.setLinkLocal(studentId, cur);
      return cur.studentCode;
    });
  }
  function ensureStudentLink(studentId) {
    var l = Store.linkOf(studentId);
    return l.studentCode ? Promise.resolve(l.studentCode) : saveStudentCode(studentId, Store.randomCode(24));
  }
  function reissueStudentLink(studentId) { return saveStudentCode(studentId, Store.randomCode(24)); }
  function ensureStudentLinks(ids) {
    var list = ids.filter(function (id) { return !Store.linkOf(id).studentCode; })
      .map(function (id) { return { studentId: id, studentCode: Store.randomCode(24) }; });
    return DB.saveLinks(list).then(function () {
      list.forEach(function (p) {
        var cur = Store.linkOf(p.studentId);
        cur.studentCode = p.studentCode;
        cur.studentIssuedAt = new Date().toISOString();
        Store.setLinkLocal(p.studentId, cur);
      });
      return list.length;
    });
  }

  /* 링크가 없는 학생 여럿에게 한 번에 */
  function issueMissing(ids) {
    var list = ids.map(function (id) { return { studentId: id, hubCode: Store.randomCode(24) }; });
    return DB.saveLinks(list).then(function () {
      list.forEach(function (p) {
        var cur = Store.linkOf(p.studentId);
        cur.hubCode = p.hubCode;
        cur.hubIssuedAt = new Date().toISOString();
        Store.setLinkLocal(p.studentId, cur);
      });
      return list.length;
    });
  }

  /* ============================================================
     명단 — 상태
     ============================================================ */

  var students = Store.getStudents();
  var fields = Store.getFieldDefs('student');
  var classFields = Store.getFieldDefs('class');
  var collapsed = {};
  var filterText = '';
  var filterClass = '';
  var showArchived = false;

  var rosterList = $('#rosterList');
  var ARCHIVE_GROUP = '퇴원';

  function sortStudents(list) {
    return list.slice().sort(function (a, b) {
      var c = (a.className || '￿').localeCompare(b.className || '￿', 'ko');
      if (c !== 0) return c;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }

  function matches(s) {
    if (s.archived && !showArchived) return false;
    if (filterClass && (s.className || '') !== filterClass) return false;
    if (!filterText) return true;
    var hay = [s.name, s.school, s.grade, s.className, s.parentPhone, s.studentPhone];
    fields.forEach(function (f) { hay.push(Store.fieldText(s, f)); });
    return hay.join(' ').toLowerCase().indexOf(filterText) !== -1;
  }

  function tableFields() {
    return fields.filter(function (f) { return f.showInTable !== false; });
  }

  function rowHtml() {
    var extra = tableFields().map(function () {
      return '<td class="roster__extra"><span class="roster__extraval"></span></td>';
    }).join('');
    return '' +
      '<td data-label="이름"><button type="button" class="roster__name roster__name-btn" data-act="card" title="상담 카드 열기"></button>' +
        '<span class="note-badge" hidden></span></td>' +
      '<td data-label="학교"></td>' +
      '<td data-label="학년"></td>' +
      '<td data-label="연락처"><span class="phone-lines"></span></td>' +
      extra +
      '<td data-label="개인 링크" class="roster__link"></td>' +
      '<td data-label="앱 과제" class="roster__app"></td>' +
      '<td class="roster__actions">' +
        '<button class="btn btn--sm btn--ghost" data-pv="parent" title="학부모 링크로 열었을 때 모습 (미리보기)">학부모 화면</button>' +
        '<button class="btn btn--sm btn--ghost" data-pv="student" title="학생 링크로 열었을 때 모습 (미리보기)">학생 화면</button>' +
        '<button class="btn btn--sm" data-act="edit">수정</button>' +
      '</td>';
  }

  /* textContent 로 넣어 이름·학교에 든 특수문자를 안전하게 표시한다 */
  function fillRow(tr, s) {
    tr.dataset.id = s.id;
    tr.innerHTML = rowHtml();
    tr.classList.toggle('is-archived', !!s.archived);
    var tds = tr.children;
    tds[0].querySelector('.roster__name').textContent = s.name || '';
    var nf = window.Card ? Card.followCount(s.id) : 0;
    var nb = tds[0].querySelector('.note-badge');
    nb.hidden = !nf;
    nb.textContent = '확인 ' + nf;
    nb.title = '다음 상담 때 확인할 기록 ' + nf + '개';
    tds[1].textContent = s.school || '-';
    tds[2].textContent = s.grade || '-';

    var phones = Store.phonesOf(s);
    var box = tds[3].querySelector('.phone-lines');
    if (!phones.length) {
      box.innerHTML = '<span class="roster__phone is-empty">없음</span>';
    } else {
      phones.forEach(function (p) {
        var line = document.createElement('span');
        line.className = 'phone-line';
        line.innerHTML = '<span class="phone-line__title"></span><span class="phone-line__num"></span>';
        line.firstChild.textContent = p.label;
        line.lastChild.textContent = Store.phoneFormat(p.number);
        box.appendChild(line);
      });
    }

    tableFields().forEach(function (f, i) {
      var td = tds[4 + i];
      if (!td) return;
      td.setAttribute('data-label', f.label);
      var v = Store.fieldText(s, f);
      var el = td.querySelector('.roster__extraval');
      el.textContent = v || '-';
      el.classList.toggle('is-empty', !v);
      td.classList.toggle('is-empty', !v);
    });

    var link = Store.linkOf(s.id);
    var linkTd = tds[4 + tableFields().length];
    var appTd = tds[5 + tableFields().length];

    if (s.archived) {
      linkTd.innerHTML = '<span class="link-tag link-tag--off">퇴원 · 막힘</span>';
    } else {
      linkTd.innerHTML = (link.hubCode
          ? '<button class="btn btn--sm btn--parent" data-act="copylink" title="학부모 링크 복사 — 레포트 · 안내용 (보기 전용)">학부모 링크</button>'
          : '<button class="btn btn--sm btn--primary" data-act="issue">학부모 링크 발급</button>') +
        '<button class="btn btn--sm btn--student" data-act="copystudent" title="학생 링크 복사 — 복습테스트 · 필기 사진 입력용">학생 링크</button>';
    }
    appTd.innerHTML = link.appCode
      ? '<span class="link-tag link-tag--on">연결됨</span>'
      : '<span class="link-tag">없음</span>';
  }

  function render() {
    var visible = sortStudents(students).filter(matches);
    var active = students.filter(function (s) { return !s.archived; });

    $('#brandCount').textContent = '학생 ' + active.length + '명';
    $('#rosterHint').textContent = (filterText || filterClass) && students.length
      ? visible.length + '명 표시 중'
      : '서버에 저장되어 모든 기기에서 같이 보입니다';

    renderLinkNotice();
    rosterList.textContent = '';

    if (!students.length) {
      rosterList.innerHTML =
        '<div class="empty-state">아직 등록된 학생이 없습니다.<br>' +
        '<b>+ 학생 추가</b> 또는 <b>엑셀·CSV로 넣기</b>로 시작하세요.</div>';
      refreshClassOptions();
      renderClassInfo();
      return;
    }
    if (!visible.length) {
      rosterList.innerHTML = '<div class="empty-state">조건에 맞는 학생이 없습니다.</div>';
      refreshClassOptions();
      renderClassInfo();
      return;
    }

    var groups = [];
    var index = {};
    visible.forEach(function (s) {
      var key = s.archived ? ARCHIVE_GROUP : ((s.className || '').trim() || '(반 없음)');
      if (!(key in index)) { index[key] = groups.length; groups.push({ name: key, rows: [] }); }
      groups[index[key]].rows.push(s);
    });
    /* 퇴원 묶음은 맨 아래 */
    groups.sort(function (a, b) {
      return (a.name === ARCHIVE_GROUP) - (b.name === ARCHIVE_GROUP);
    });

    var frag = document.createDocumentFragment();
    var forceExpand = !!(filterText || filterClass);

    groups.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'class-group' + (!forceExpand && collapsed[g.name] ? ' is-collapsed' : '') +
                       (g.name === ARCHIVE_GROUP ? ' class-group--archived' : '');
      wrap.dataset.cls = g.name;

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'class-head';
      head.dataset.act = 'toggle';
      head.innerHTML = '<span class="class-head__name"></span>' +
                       '<span class="class-head__count">' + g.rows.length + '명</span>' +
                       '<span class="class-head__caret" aria-hidden="true">▾</span>';
      head.querySelector('.class-head__name').textContent = g.name;
      if (g.name !== ARCHIVE_GROUP && Store.isArchivedClass(g.name)) {
        var tag = document.createElement('span');
        tag.className = 'class-head__tag';
        tag.textContent = '보관됨';
        tag.title = '반 관리에서 보관한 반 — 작성 · 「오늘」 등 반 목록에는 나오지 않습니다';
        head.querySelector('.class-head__name').after(tag);
      }
      wrap.appendChild(head);
      if (g.name !== ARCHIVE_GROUP) {
        var tools = document.createElement('div');
        tools.className = 'class-tools';
        tools.innerHTML = '<button type="button" class="btn btn--sm btn--student" data-act="copyclassstudent">학생 링크 모두 복사</button>' +
          '<span class="muted-note">이름 + 학생 링크 목록 — 학생 단톡방 첫 안내용 (없는 학생 링크는 만들어서)</span>';
        tools.querySelector('button').dataset.cls = g.name;
        wrap.appendChild(tools);
      }

      var table = document.createElement('table');
      table.className = 'roster';
      table.innerHTML = '<thead><tr><th>이름</th><th>학교</th><th>학년</th><th>연락처</th>' +
        tableFields().map(function () { return '<th></th>'; }).join('') +
        '<th>링크 (학부모 · 학생)</th><th>앱 과제</th><th></th></tr></thead><tbody></tbody>';
      var ths = table.querySelectorAll('thead th');
      tableFields().forEach(function (f, i) { ths[4 + i].textContent = f.label; });

      var tbody = table.querySelector('tbody');
      g.rows.forEach(function (s) {
        var tr = document.createElement('tr');
        fillRow(tr, s);
        tbody.appendChild(tr);
      });

      var scroller = document.createElement('div');
      scroller.className = 'roster-scroll';
      scroller.appendChild(table);
      wrap.appendChild(scroller);
      frag.appendChild(wrap);
    });

    rosterList.appendChild(frag);
    refreshClassOptions();
    syncExpandButton();
    renderClassInfo();
  }

  function missingLinkIds() {
    return students.filter(function (s) {
      return !s.archived && !Store.linkOf(s.id).hubCode;
    }).map(function (s) { return s.id; });
  }

  function renderLinkNotice() {
    var n = missingLinkIds().length;
    $('#linkBulkNotice').hidden = !n;
    $('#linkBulkText').textContent = '개인 링크가 없는 학생이 ' + n + '명 있습니다.';
  }

  $('#btnIssueAll').addEventListener('click', function () {
    var ids = missingLinkIds();
    if (!ids.length) return;
    var btn = this;
    btn.disabled = true;
    issueMissing(ids).then(function (n) {
      btn.disabled = false;
      render();
      toast(n + '명에게 개인 링크를 발급했습니다', 'good');
    }).catch(function (e) {
      btn.disabled = false;
      toast('발급하지 못했습니다 — ' + e.message, 'bad');
    });
  });

  function collapseIfCrowded() {
    if (students.length <= 30) return;
    Store.getClasses().forEach(function (c) { collapsed[c.name] = true; });
    collapsed['(반 없음)'] = true;
    collapsed[ARCHIVE_GROUP] = true;
  }

  function refreshClassOptions() {
    var classes = Store.getClasses();
    var sel = $('#classFilter');
    var keep = sel.value;
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = ''; optAll.textContent = '전체 반';
    sel.appendChild(optAll);
    classes.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + ' (' + c.count + ')';
      sel.appendChild(o);
    });
    /* 보관한 반이라도 재원생이 남아 있으면 명단에서는 걸러 볼 수 있게 */
    var off = {};
    Store.activeStudents().forEach(function (s) {
      var n = (s.className || '').trim();
      if (n && Store.isArchivedClass(n)) off[n] = (off[n] || 0) + 1;
    });
    Object.keys(off).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n + ' (' + off[n] + ') · 보관됨';
      sel.appendChild(o);
    });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === keep; }) ? keep : '';
  }

  /* ---------- 학생 창의 반 고르기 — 목록 + 맨 아래 [+ 새 반 만들기] ---------- */

  var NEW_CLASS = '__new__';
  var classConfirm = '';   /* 비슷한 이름 경고를 본 뒤 한 번 더 누르면 만든다 */

  function fillStudentClass(value, keepUnknown) {
    var sel = $('#fClass');
    var classes = Store.getClasses();
    sel.textContent = '';
    function add(v, t) {
      var o = document.createElement('option');
      o.value = v; o.textContent = t;
      sel.appendChild(o);
      return o;
    }
    add('', '반 없음');
    classes.forEach(function (c) { add(c.name, c.name + ' (' + c.count + '명)'); });
    var known = !value || classes.some(function (c) { return c.name === value; });
    if (!known && keepUnknown) add(value, value + (Store.isArchivedClass(value) ? ' (보관됨)' : ''));
    add(NEW_CLASS, '+ 새 반 만들기');
    sel.value = known || keepUnknown ? value : '';
    sel.dataset.prev = sel.value;
    showNewClass(false);
  }

  function classHint(msg, bad) {
    var h = $('#fClassHint');
    h.hidden = !msg;
    h.textContent = msg || '';
    h.classList.toggle('tb-warn', !!bad);
  }

  function showNewClass(on) {
    $('#fClassNew').hidden = !on;
    classConfirm = '';
    classHint(on ? '만들면 이 학생의 반으로 바로 골라지고, 모든 탭의 반 목록에 나옵니다.' : '');
    if (on) { $('#fClassNewName').value = ''; setTimeout(function () { $('#fClassNewName').focus(); }, 0); }
  }

  $('#fClass').addEventListener('change', function () {
    var sel = $('#fClass');
    if (sel.value === NEW_CLASS) { showNewClass(true); return; }
    sel.dataset.prev = sel.value;
    showNewClass(false);
  });

  $('#btnClassNewCancel').addEventListener('click', function () {
    var sel = $('#fClass');
    sel.value = sel.dataset.prev || '';
    showNewClass(false);
  });

  function createClass() {
    var name = $('#fClassNewName').value.replace(/\s+/g, ' ').trim();
    if (!name) { classHint('새 반 이름을 적어 주세요.', true); return; }
    if (name.length > 30) { classHint('반 이름은 30자까지 적을 수 있습니다.', true); return; }
    if (Store.isArchivedClass(name)) {
      classHint('‘' + name + '’ 은 보관된 반입니다. 선생님이 ① 명단 → [반 관리] → 보관된 반 보기에서 되살릴 수 있습니다.', true);
      return;
    }
    var same = Store.getClasses().some(function (c) { return c.name === name; });
    if (same) {
      fillStudentClass(name);
      toast('이미 있는 반이라 그 반으로 골랐습니다');
      return;
    }
    var like = Store.similarClasses(name);
    if (like.length && classConfirm !== name) {
      classConfirm = name;
      classHint('이름이 비슷한 반이 있습니다: ' + like.join(', ') + '. 같은 반이면 목록에서 고르세요. ' +
                '다른 반이 맞으면 [만들기]를 한 번 더 누르세요.', true);
      return;
    }
    var btn = $('#btnClassNewOk');
    btn.disabled = true;
    Store.addClass(name).then(function () {
      btn.disabled = false;
      fillStudentClass(name, true);
      toast('새 반 ‘' + name + '’을 만들었습니다', 'good');
    }).catch(function (e) {
      btn.disabled = false;
      classHint('반을 만들지 못했습니다 — ' + e.message, true);
    });
  }

  $('#btnClassNewOk').addEventListener('click', createClass);
  $('#fClassNewName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); createClass(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('#btnClassNewCancel').click(); }
  });

  rosterList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;

    if (btn.dataset.act === 'toggle') {
      var g = btn.closest('.class-group');
      collapsed[g.dataset.cls] = !collapsed[g.dataset.cls];
      g.classList.toggle('is-collapsed', !!collapsed[g.dataset.cls]);
      syncExpandButton();
      return;
    }

    if (btn.dataset.act === 'copyclassstudent') {
      var cls = btn.dataset.cls;
      var list = students.filter(function (x) { return !x.archived && (x.className || '') === cls; })
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
      if (!list.length) { toast('다니는 학생이 없습니다', 'bad'); return; }
      btn.disabled = true;
      ensureStudentLinks(list.map(function (x) { return x.id; })).then(function (made) {
        var text = cls + ' 학생 링크 (복습테스트 · 필기 사진은 이 링크에서)\n' + list.map(function (x) {
          return x.name + ' ' + Store.hubUrl(Store.linkOf(x.id).studentCode);
        }).join('\n');
        return copyText(text).then(function () {
          toast(cls + ' ' + list.length + '명 학생 링크를 복사했습니다' + (made ? ' (새로 만든 ' + made + '명)' : ''), 'good');
        });
      }).catch(function (err) { toast('복사하지 못했습니다 — ' + err.message, 'bad'); })
        .then(function () { btn.disabled = false; });
      return;
    }

    var tr = btn.closest('tr');
    var s = tr && students.find(function (x) { return x.id === tr.dataset.id; });
    if (!s) return;

    if (btn.dataset.act === 'edit') openStudentModal(s);
    if (btn.dataset.act === 'card' && window.Card) Card.open(s.id);

    if (btn.dataset.act === 'copylink') {
      copyText(Store.hubUrl(Store.linkOf(s.id).hubCode))
        .then(function () { toast(s.name + ' 학부모 링크를 복사했습니다 (보기 전용)', 'good'); })
        .catch(function (err) { toast(err.message, 'bad'); });
    }

    if (btn.dataset.act === 'copystudent') {
      btn.disabled = true;
      ensureStudentLink(s.id).then(function (code) {
        return copyText(Store.hubUrl(code)).then(function () { toast(s.name + ' 학생 링크를 복사했습니다 (입력용)', 'good'); });
      }).catch(function (err) { toast('복사하지 못했습니다 — ' + err.message, 'bad'); })
        .then(function () { btn.disabled = false; });
    }

    if (btn.dataset.act === 'issue') {
      btn.disabled = true;
      issueLink(s.id).then(function () {
        fillRow(tr, s);
        renderLinkNotice();
        toast(s.name + ' 개인 링크를 발급했습니다', 'good');
      }).catch(function (err) {
        btn.disabled = false;
        toast('발급하지 못했습니다 — ' + err.message, 'bad');
      });
    }
  });

  var searchTimer = null;
  $('#searchInput').addEventListener('input', function (e) {
    var v = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { filterText = v; render(); }, 150);
  });

  $('#classFilter').addEventListener('change', function (e) { filterClass = e.target.value; render(); });
  $('#showArchived').addEventListener('change', function (e) { showArchived = e.target.checked; render(); });

  function visibleClassNames() {
    return $$('.class-group', rosterList).map(function (g) { return g.dataset.cls; });
  }

  function syncExpandButton() {
    var names = visibleClassNames();
    var anyCollapsed = names.some(function (n) { return collapsed[n]; });
    var btn = $('#btnExpandAll');
    btn.textContent = anyCollapsed ? '모두 펼치기' : '모두 접기';
    btn.hidden = names.length < 2 || !!(filterText || filterClass);
  }

  $('#btnExpandAll').addEventListener('click', function () {
    var names = visibleClassNames();
    var anyCollapsed = names.some(function (n) { return collapsed[n]; });
    names.forEach(function (n) { collapsed[n] = !anyCollapsed; });
    render();
  });

  /* ============================================================
     학생 추가 · 수정
     ============================================================ */

  var studentModal = $('#studentModal');
  var editingId = null;

  function showStudentError(msg) {
    var box = $('#studentError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  function extraFieldNode(f) {
    var wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.dataset.key = f.key;

    var lab = document.createElement('span');
    lab.className = 'field__label';
    lab.textContent = f.label;

    var input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'textarea';
    } else if (f.type === 'select') {
      input = document.createElement('select');
      input.className = 'select';
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = '(비움)';
      input.appendChild(blank);
      (f.options || []).forEach(function (o) {
        var el = document.createElement('option');
        el.value = o; el.textContent = o;
        input.appendChild(el);
      });
    } else if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      wrap.className = 'check-line';
      wrap.appendChild(input);
      var t = document.createElement('span');
      t.textContent = f.label;
      wrap.appendChild(t);
      input.dataset.role = 'extra';
      return wrap;
    } else {
      input = document.createElement('input');
      input.className = 'input';
      input.type = f.type === 'date' ? 'date' : 'text';
      input.autocomplete = 'off';
    }
    input.dataset.role = 'extra';
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function renderExtraFields(s) {
    var host = $('#extraFields');
    host.textContent = '';
    if (!fields.length) return;

    var head = document.createElement('div');
    head.className = 'extra-head';
    head.innerHTML = '<span class="extra-head__title">내가 만든 칸</span>';
    host.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'grid2';
    fields.forEach(function (f) {
      var node = extraFieldNode(f);
      if (f.type === 'textarea') node.classList.add('grid2__full');
      var input = node.querySelector('[data-role="extra"]');
      var v = s ? Store.fieldValue(s, f) : '';
      if (f.type === 'checkbox') input.checked = !!v;
      else input.value = v == null ? '' : String(v);
      grid.appendChild(node);
    });
    host.appendChild(grid);
  }

  /* 지금 없는 칸(나중에 지운 칸)에 적혀 있던 값은 그대로 둔다 */
  function collectExtra(s) {
    var out = {};
    var known = {};
    fields.forEach(function (f) { known[f.key] = true; });
    Object.keys((s && s.extra) || {}).forEach(function (k) { if (!known[k]) out[k] = s.extra[k]; });
    fields.forEach(function (f) {
      var wrap = $('#extraFields [data-key="' + f.key + '"]');
      var input = wrap && wrap.querySelector('[data-role="extra"]');
      if (!input) return;
      if (f.type === 'checkbox') { if (input.checked) out[f.key] = true; return; }
      var v = String(input.value || '').trim();
      if (v) out[f.key] = v;
    });
    return out;
  }

  function renderLinkBox() {
    var isNew = !editingId;
    var link = isNew ? {} : Store.linkOf(editingId);
    var url = Store.hubUrl(link.hubCode);

    $('#fHubUrl').textContent = url || (isNew ? '저장하면 자동 발급' : '아직 없음');
    $('#btnHubIssue').textContent = link.hubCode ? '재발급' : '발급';
    $('#btnHubIssue').hidden = isNew;
    $('#btnHubCopy').hidden = !url;
    $('#btnHubOpen').hidden = !url;
    if (url) $('#btnHubOpen').href = url;
    $('#linkBoxNew').hidden = !isNew;

    var surl = isNew ? '' : Store.hubUrl(link.studentCode);
    $('#fStuUrl').textContent = surl || (isNew ? '저장한 뒤 만들 수 있습니다' : '아직 없음 — [복사]를 누르면 만듭니다');
    $('#btnStuIssue').hidden = isNew || !link.studentCode;
    $('#btnStuCopy').hidden = isNew;
    $('#btnStuOpen').hidden = !surl;
    if (surl) $('#btnStuOpen').href = surl;
  }

  /* 창을 연 순간의 서버 시각. 창이 열려 있는 동안 다른 분이 저장했으면 저장 때 묻는다. */
  var editingAt = '';

  /* 고치기 창을 연 뒤 다른 분이 같은 줄을 저장했는가 → 물어보고, 계속하면 true */
  var STALE_TABLE = {
    students:  function (id) { return ['students', { id: id }]; },
    classInfo: function (id) { return ['class_info', { class_name: id }]; },
    fields:    function (id) { return ['field_defs', { id: id }]; }
  };

  /* 저장 직전에 서버에서 그 줄의 지금 시각을 본다 (실시간 연결이 없어도 알아챈다) */
  function staleCheck(kind, id, openedAt, what, onReload) {
    if (!id || !openedAt) return Promise.resolve(true);
    var t = STALE_TABLE[kind](id);
    return DB.currentAt(t[0], t[1]).catch(function () { return Store.baseAt(kind, id); }).then(function (nowAt) {
      if (nowAt === null) return true;               /* 다른 분이 지웠다 — 저장하면 store 가 알려 준다 */
      if (nowAt === openedAt) return true;
      return conflictAsk(what).then(function (c) {
        if (c === 'overwrite') { Store.setBaseAt(kind, id, nowAt); return true; }
        if (c === 'reload') Store.refreshAll().then(onReload, onReload);
        return false;
      });
    });
  }

  function openStudentModal(s) {
    editingId = s ? s.id : null;
    editingAt = s ? Store.baseAt('students', s.id) : '';

    $('#studentModalTitle').textContent = s ? '학생 수정' : '학생 추가';
    $('#fName').value   = s ? (s.name || '') : '';
    $('#fSchool').value = s ? (s.school || '') : (settings.lastSchool || '');
    $('#fGrade').value  = s ? (s.grade || '') : (settings.lastGrade || '');
    fillStudentClass(s ? (s.className || '') : (settings.lastClass || ''), !!s);
    $('#fParentTitle').value = s ? (s.parentTitle || '') : (settings.lastParentTitle || '');
    $('#fPhone').value  = s && s.parentPhone ? Store.phoneFormat(s.parentPhone) : '';
    $('#fPhone2').value = s && s.studentPhone ? Store.phoneFormat(s.studentPhone) : '';
    $('#fArchived').checked = !!(s && s.archived);

    var link = s ? Store.linkOf(s.id) : {};
    $('#fAppCode').value = link.appCode ? 'https://marathonstudy.com/share/report/' + link.appCode : '';
    $('#fAppHint').textContent = link.appUpdatedAt
      ? '마지막 갱신 ' + new Date(link.appUpdatedAt).toLocaleDateString('ko-KR') + ' · 링크 전체를 붙여 넣어도 코드만 저장됩니다.'
      : '링크 전체를 붙여 넣어도 코드만 저장됩니다.';
    $('#btnStudentDelete').hidden = !s;

    renderLinkBox();
    renderExtraFields(s);
    showStudentError('');
    studentModal.showModal();
    setTimeout(function () { $('#fName').focus(); }, 30);
  }

  $('#btnAddStudent').addEventListener('click', function () { openStudentModal(null); });
  $('#btnStudentCancel').addEventListener('click', function () { studentModal.close(); });

  ['#fPhone', '#fPhone2'].forEach(function (sel) {
    $(sel).addEventListener('blur', function (e) {
      var d = Store.phoneDigits(e.target.value);
      if (d) e.target.value = Store.phoneFormat(d);
    });
  });

  $('#btnHubIssue').addEventListener('click', function () {
    if (!editingId) return;
    var had = !!Store.linkOf(editingId).hubCode;
    var go = had
      ? confirmAsk('학부모 링크 재발급', '새 학부모 링크를 만들면 지금까지 보낸 학부모 링크는 바로 열리지 않습니다. 학생 링크는 그대로입니다.', '재발급')
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      return issueLink(editingId).then(function () {
        renderLinkBox();
        render();
        toast(had ? '새 링크를 만들었습니다. 예전 링크는 막혔습니다' : '개인 링크를 발급했습니다', 'good');
      });
    }).catch(function (e) { toast('발급하지 못했습니다 — ' + e.message, 'bad'); });
  });

  $('#btnHubCopy').addEventListener('click', function () {
    var url = Store.hubUrl(Store.linkOf(editingId).hubCode);
    copyText(url).then(function () { toast('학부모 링크를 복사했습니다', 'good'); })
      .catch(function (e) { toast(e.message, 'bad'); });
  });

  $('#btnStuCopy').addEventListener('click', function () {
    if (!editingId) return;
    ensureStudentLink(editingId).then(function (code) {
      renderLinkBox();
      return copyText(Store.hubUrl(code)).then(function () { toast('학생 링크를 복사했습니다', 'good'); });
    }).catch(function (e) { toast(e.message, 'bad'); });
  });

  $('#btnStuIssue').addEventListener('click', function () {
    if (!editingId) return;
    confirmAsk('학생 링크 재발급', '새 학생 링크를 만들면 지금까지 보낸 학생 링크는 바로 열리지 않습니다. 학부모 링크는 그대로입니다.', '재발급').then(function (ok) {
      if (!ok) return;
      return reissueStudentLink(editingId).then(function () {
        renderLinkBox();
        render();
        toast('새 학생 링크를 만들었습니다. 예전 학생 링크는 막혔습니다', 'good');
      });
    }).catch(function (e) { toast('발급하지 못했습니다 — ' + e.message, 'bad'); });
  });

  $('#btnStudentDelete').addEventListener('click', function () {
    var s = students.find(function (x) { return x.id === editingId; });
    if (!s) return;
    /* 교재 지급·청구 기록이 있는 학생은 지우지 않는다 (기록이 학생에 묶여 있다) */
    DB.lockedStudentIds().then(function (locked) {
      if (locked.indexOf(s.id) !== -1) {
        showStudentError('교재·상담·성적 기록이 있는 학생이라 지울 수 없습니다. 퇴원 처리하세요 — ' +
                         '[퇴원]에 체크하고 저장하면 개인 링크는 막히고 기록은 그대로 남습니다.');
        return false;
      }
      return confirmAsk('학생 삭제',
        '‘' + s.name + '’ 학생과 그 학생의 작성 내용·공개한 레포트·개인 링크를 모두 지웁니다. 되돌릴 수 없습니다. ' +
        '다니지 않게 된 학생은 지우지 말고 [퇴원]에 체크하세요.', '삭제');
    })
      .then(function (ok) {
        if (!ok) return;
        studentModal.close();
        return Store.deleteStudent(s.id).then(function () {
          students = Store.getStudents();
          render();
          toast(s.name + ' 학생을 지웠습니다');
        });
      })
      .catch(function (e) { showStudentError('확인하지 못했습니다 — ' + e.message); });
  });

  $('#studentForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var sid = editingId;
    staleCheck('students', sid, editingAt, ($('#fName').value.trim() || '이 학생') + ' 학생 정보', function () {
      var fresh = Store.getStudents().find(function (x) { return x.id === sid; });
      if (fresh) { openStudentModal(fresh); toast('다른 분이 저장한 내용을 불러왔습니다'); }
    }).then(function (go) { if (go) saveStudentForm(); });
  });

  function saveStudentForm() {

    var name   = $('#fName').value.trim();
    var phone  = Store.phoneDigits($('#fPhone').value);
    var phone2 = Store.phoneDigits($('#fPhone2').value);
    var appCode = Store.extractAppCode($('#fAppCode').value);

    if (!name) { showStudentError('이름을 입력해 주세요.'); return; }
    if ($('#fClass').value === NEW_CLASS) { showStudentError('새 반 이름을 적고 [만들기]를 누르거나, 목록에서 반을 골라 주세요.'); return; }
    if (!Store.phoneValid(phone))  { showStudentError('학부모 연락처의 자릿수를 확인해 주세요.'); return; }
    if (!Store.phoneValid(phone2)) { showStudentError('학생 연락처의 자릿수를 확인해 주세요.'); return; }
    if (appCode === null) {
      showStudentError('앱 공유 링크를 알아볼 수 없습니다. marathonstudy.com/share/report/… 주소를 그대로 붙여 넣어 주세요.');
      return;
    }

    /* 이름 + 학부모 번호가 같은 학생이 이미 있으면 막는다 (엑셀 넣기와 같은 규칙) */
    var dup = phone && students.find(function (x) {
      return x.id !== editingId && x.name === name && x.parentPhone === phone;
    });
    if (dup) { showStudentError('이름과 학부모 연락처가 같은 학생이 이미 있습니다 (' + (dup.className || '반 없음') + ').'); return; }

    var prev = editingId ? students.find(function (x) { return x.id === editingId; }) : null;
    var rec = {
      id: editingId || Store.newId(),
      name: name,
      school: $('#fSchool').value.trim(),
      grade: $('#fGrade').value.trim(),
      className: $('#fClass').value.trim(),
      parentTitle: $('#fParentTitle').value.trim(),
      parentPhone: phone,
      studentPhone: phone2,
      archived: $('#fArchived').checked,
      extra: collectExtra(prev),
      sortOrder: prev ? prev.sortOrder || 0 : 0,
      createdAt: prev ? prev.createdAt : new Date().toISOString()
    };

    Store.upsertStudent(rec);
    students = Store.getStudents();

    settings.lastGrade = rec.grade;
    settings.lastClass = rec.className;
    settings.lastSchool = rec.school;
    settings.lastParentTitle = rec.parentTitle;
    Store.writeLocal(Store.KEYS.settings, settings);

    var link = Store.linkOf(rec.id);
    var needIssue = !rec.archived && !link.hubCode;
    var appChanged = (appCode || '') !== (link.appCode || '');

    studentModal.close();
    render();

    if (!needIssue && !appChanged) {
      toast(prev ? rec.name + ' 학생을 수정했습니다' : rec.name + ' 학생을 추가했습니다', 'good');
      return;
    }

    /* 링크는 학생 줄이 서버에 생긴 뒤에 저장할 수 있다 */
    var btn = $('#btnStudentSave');
    btn.disabled = true;
    Store.flushNow(Store.KEYS.students, students)
      .then(function () { return needIssue ? issueLink(rec.id) : null; })
      .then(function () {
        if (!appChanged) return null;
        return DB.saveLink(rec.id, { appCode: appCode || '' }).then(function (l) {
          var cur = Store.linkOf(rec.id);
          cur.appCode = l.appCode;
          cur.appUpdatedAt = l.appUpdatedAt;
          Store.setLinkLocal(rec.id, cur);
        });
      })
      .then(function () {
        btn.disabled = false;
        render();
        toast(rec.name + ' 학생을 저장했습니다' + (needIssue ? ' · 개인 링크 발급' : '') +
              (appChanged ? ' · 앱 코드 ' + (appCode ? '저장' : '지움') : ''), 'good');
      })
      .catch(function (err) {
        btn.disabled = false;
        render();
        toast('학생은 저장했지만 링크를 저장하지 못했습니다 — ' + err.message, 'bad');
      });
  }

  /* ============================================================
     반 현황
     ============================================================ */

  var classInfoModal = $('#classInfoModal');
  var editingClass = null;

  function renderClassInfo() {
    var host = $('#classInfoList');
    var classes = Store.getClasses();
    host.textContent = '';

    if (!classes.length) {
      host.innerHTML = '<div class="empty-state">아직 반이 없습니다.<br>학생 추가 창의 반 고르기에서 <b>+ 새 반 만들기</b>로 만들 수 있습니다.</div>';
      return;
    }
    if (!classFields.length) {
      host.innerHTML = '<div class="empty-state">아직 만든 반 칸이 없습니다.<br>' +
                       '<b>반 칸 관리</b>에서 시험 범위·수업 진도 같은 칸을 만들어 보세요.</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    classes.forEach(function (c) {
      var bag = Store.classExtra(c.name);
      var card = document.createElement('div');
      card.className = 'cinfo';
      card.dataset.cls = c.name;

      var head = document.createElement('div');
      head.className = 'cinfo__head';
      head.innerHTML = '<span class="cinfo__name"></span><span class="cinfo__count"></span>' +
                       '<span class="spacer"></span>' +
                       '<button class="btn btn--sm" type="button" data-cact="edit">적기</button>';
      head.querySelector('.cinfo__name').textContent = c.name;
      head.querySelector('.cinfo__count').textContent = c.count + '명';
      card.appendChild(head);

      var body = document.createElement('div');
      body.className = 'cinfo__body';
      classFields.forEach(function (f) {
        var v = Store.fieldText(bag, f);
        var line = document.createElement('div');
        line.className = 'cinfo__line' + (v ? '' : ' is-empty');
        var name = document.createElement('span');
        name.className = 'cinfo__label';
        name.textContent = f.label;
        var val = document.createElement('span');
        val.className = 'cinfo__val';
        val.textContent = v || '비어 있음';
        line.appendChild(name);
        line.appendChild(val);
        body.appendChild(line);
      });
      card.appendChild(body);
      frag.appendChild(card);
    });
    host.appendChild(frag);
  }

  var editingClassAt = '';

  function openClassInfoModal(name) {
    editingClass = name;
    editingClassAt = Store.baseAt('classInfo', name);
    $('#classInfoTitle').textContent = name + ' 반 현황';
    $('#classInfoDesc').textContent = '여기에 적은 내용은 ' + name + ' 반 학생 전체에 쓰입니다';
    var host = $('#classInfoFields');
    host.textContent = '';
    var bag = Store.classExtra(name);
    var grid = document.createElement('div');
    grid.className = 'grid2';
    classFields.forEach(function (f) {
      var node = extraFieldNode(f);
      if (f.type === 'textarea') node.classList.add('grid2__full');
      var input = node.querySelector('[data-role="extra"]');
      var v = bag[f.key];
      if (f.type === 'checkbox') input.checked = !!v;
      else input.value = v == null ? '' : String(v);
      grid.appendChild(node);
    });
    host.appendChild(grid);
    classInfoModal.showModal();
  }

  $('#classInfoList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cact="edit"]');
    var card = btn && btn.closest('.cinfo');
    if (card) openClassInfoModal(card.dataset.cls);
  });

  $('#btnClassInfoCancel').addEventListener('click', function () { classInfoModal.close(); });

  $('#classInfoForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editingClass) { classInfoModal.close(); return; }
    var cls = editingClass;
    staleCheck('classInfo', cls, editingClassAt, cls + ' 반 현황', function () {
      openClassInfoModal(cls);
      toast('다른 분이 저장한 내용을 불러왔습니다');
    }).then(function (go) { if (go) saveClassInfoForm(); });
  });

  function saveClassInfoForm() {
    var out = {};
    var known = {};
    classFields.forEach(function (f) { known[f.key] = true; });
    var old = Store.classExtra(editingClass);
    Object.keys(old).forEach(function (k) { if (!known[k]) out[k] = old[k]; });
    classFields.forEach(function (f) {
      var wrap = $('#classInfoFields [data-key="' + f.key + '"]');
      var input = wrap && wrap.querySelector('[data-role="extra"]');
      if (!input) return;
      if (f.type === 'checkbox') { if (input.checked) out[f.key] = true; return; }
      var v = String(input.value || '').trim();
      if (v) out[f.key] = v;
    });
    Store.setClassExtra(editingClass, out);
    classInfoModal.close();
    renderClassInfo();
    toast(editingClass + ' 반 현황을 저장했습니다', 'good');
  }

  /* ============================================================
     칸 관리
     ============================================================ */

  var fieldsModal = $('#fieldsModal');
  var fieldEditModal = $('#fieldEditModal');
  var editingFieldId = null;
  var fieldScope = 'student';

  function scopeList() { return fieldScope === 'class' ? classFields : fields; }
  function scopeName() { return Store.SCOPES[fieldScope].name; }
  function typeName(t) {
    var hit = Store.FIELD_TYPES.find(function (x) { return x.type === t; });
    return hit ? hit.name : t;
  }

  function usedCount(f) {
    function has(bag) {
      var v = (bag || {})[f.key];
      return v !== undefined && v !== '' && v !== false;
    }
    if (Store.scopeOf(f) === 'class') {
      var info = Store.getClassInfo();
      return Object.keys(info).filter(function (n) { return has(info[n]); }).length;
    }
    return students.filter(function (s) { return has(s.extra); }).length;
  }
  function usedUnit(f) { return Store.scopeOf(f) === 'class' ? '개 반' : '명'; }

  function renderFieldList() {
    var host = $('#fieldList');
    var list = scopeList();
    host.textContent = '';
    $('#fieldsTitle').textContent = scopeName() + ' 관리';
    $('#fieldsDesc').textContent = fieldScope === 'class'
      ? '반마다 한 번만 적으면 되는 칸을 만듭니다. 만든 칸은 명단 아래 [반 현황]에 나옵니다.'
      : '학생마다 따로 적어 둘 칸을 만듭니다. 학생·학부모 화면에는 나가지 않습니다.';
    $('#fieldsCount').textContent = list.length ? list.length + '개' : '';

    if (!list.length) {
      host.innerHTML = '<div class="empty-state">아직 만든 ' + scopeName() + '이 없습니다.</div>';
      return;
    }

    list.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.id = f.id;
      row.innerHTML =
        '<div class="field-row__main"><span class="field-row__label"></span><span class="field-row__meta"></span></div>' +
        '<div class="field-row__acts">' +
          '<button class="btn btn--sm btn--ghost" type="button" data-fact="up"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">↑</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-fact="down"' + (i === list.length - 1 ? ' disabled' : '') + ' aria-label="아래로">↓</button>' +
          '<button class="btn btn--sm" type="button" data-fact="edit">수정</button>' +
          '<button class="btn btn--sm btn--danger" type="button" data-fact="del">삭제</button>' +
        '</div>';
      row.querySelector('.field-row__label').textContent = f.label;
      var meta = [typeName(f.type)];
      if (fieldScope !== 'class') meta.push(f.showInTable !== false ? '표에 보임' : '표에 숨김');
      var n = usedCount(f);
      if (n) meta.push(n + usedUnit(f) + ' 작성됨');
      row.querySelector('.field-row__meta').textContent = meta.join(' · ');
      host.appendChild(row);
    });
  }

  function showFieldEditError(msg) {
    var box = $('#fieldEditError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  Store.FIELD_TYPES.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.type; o.textContent = t.name;
    $('#fdType').appendChild(o);
  });

  function syncTypeUi() {
    var t = $('#fdType').value;
    var hit = Store.FIELD_TYPES.find(function (x) { return x.type === t; });
    $('#fdTypeHint').textContent = hit ? hit.hint : '';
    $('#fdOptionsWrap').hidden = t !== 'select';
    $('#fdTableWrap').hidden = fieldScope === 'class';
    if (t === 'textarea' && editingFieldId === null) $('#fdShowInTable').checked = false;
  }
  $('#fdType').addEventListener('change', syncTypeUi);

  var editingFieldAt = '';

  function openFieldEdit(f) {
    editingFieldId = f ? f.id : null;
    editingFieldAt = f ? Store.baseAt('fields', f.id) : '';
    $('#fieldEditTitle').textContent = scopeName() + (f ? ' 수정' : ' 추가');
    $('#fdLabel').value = f ? (f.label || '') : '';
    $('#fdType').value = f ? (f.type || 'text') : 'text';
    $('#fdOptions').value = f && Array.isArray(f.options) ? f.options.join('\n') : '';
    $('#fdShowInTable').checked = f ? f.showInTable !== false : true;
    syncTypeUi();
    showFieldEditError('');
    fieldEditModal.showModal();
  }

  function saveFields(next) {
    Store.saveFieldDefs(next, fieldScope);
    fields = Store.getFieldDefs('student');
    classFields = Store.getFieldDefs('class');
    renderFieldList();
    render();
    window.dispatchEvent(new CustomEvent('jt:fields'));
  }

  function openFieldsModal(scope) {
    fieldScope = scope;
    renderFieldList();
    fieldsModal.showModal();
  }

  $('#btnManageFields').addEventListener('click', function () { openFieldsModal('student'); });
  $('#btnManageClassFields').addEventListener('click', function () { openFieldsModal('class'); });
  $('#btnFieldAdd').addEventListener('click', function () { openFieldEdit(null); });
  $('#btnFieldEditCancel').addEventListener('click', function () { fieldEditModal.close(); });

  $('#fieldList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fact]');
    if (!btn) return;
    var id = btn.closest('.field-row').dataset.id;
    var list = scopeList();
    var i = list.findIndex(function (f) { return f.id === id; });
    if (i < 0) return;
    var next = list.slice();
    var act = btn.dataset.fact;

    if (act === 'up' && i > 0) { next.splice(i - 1, 0, next.splice(i, 1)[0]); saveFields(next); }
    else if (act === 'down' && i < next.length - 1) { next.splice(i + 1, 0, next.splice(i, 1)[0]); saveFields(next); }
    else if (act === 'edit') openFieldEdit(list[i]);
    else if (act === 'del') {
      var f = list[i];
      var n = usedCount(f);
      confirmAsk('‘' + f.label + '’ ' + scopeName() + '을 지울까요?',
        n ? n + usedUnit(f) + '이 적어 둔 내용이 화면에서 사라집니다.' : '아직 아무 데도 적지 않은 칸입니다.',
        '지우기').then(function (ok) {
          if (!ok) return;
          return Store.deleteFieldDef(f.id).then(function () {
            fields = Store.getFieldDefs('student');
            classFields = Store.getFieldDefs('class');
            renderFieldList();
            render();
            window.dispatchEvent(new CustomEvent('jt:fields'));
          });
        }).catch(function (err) { toast('지우지 못했습니다 — ' + err.message, 'bad'); });
    }
  });

  $('#fieldEditForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var fid = editingFieldId;
    staleCheck('fields', fid, editingFieldAt, '칸 ‘' + ($('#fdLabel').value.trim() || '') + '’', function () {
      var fresh = scopeList().find(function (x) { return x.id === fid; });
      if (fresh) { openFieldEdit(fresh); toast('다른 분이 저장한 내용을 불러왔습니다'); }
    }).then(function (go) { if (go) saveFieldForm(); });
  });

  function saveFieldForm() {
    var label = $('#fdLabel').value.trim();
    var type = $('#fdType').value;
    var opts = $('#fdOptions').value.split('\n')
      .map(function (x) { return x.trim(); })
      .filter(function (x, i2, arr) { return x && arr.indexOf(x) === i2; });

    if (!label) { showFieldEditError('칸 이름을 적어 주세요.'); return; }
    var list = scopeList();
    if (list.some(function (f) { return f.label === label && f.id !== editingFieldId; })) {
      showFieldEditError('‘' + label + '’ ' + scopeName() + '이 이미 있습니다.');
      return;
    }
    if (type === 'select' && !opts.length) { showFieldEditError('선택지를 한 줄에 하나씩 적어 주세요.'); return; }

    var next = list.slice();
    var i = next.findIndex(function (f) { return f.id === editingFieldId; });
    var inTable = fieldScope === 'class' ? false : $('#fdShowInTable').checked;
    if (i >= 0) {
      next[i] = { id: next[i].id, key: next[i].key, label: label, type: type, options: opts,
                  showInTable: inTable, scope: fieldScope, sortOrder: next[i].sortOrder };
    } else {
      next.push({ id: Store.newId(), key: Store.newFieldKey(), label: label, type: type, options: opts,
                  showInTable: inTable, scope: fieldScope, sortOrder: next.length });
    }
    saveFields(next);
    fieldEditModal.close();
    if (studentModal.open) renderExtraFields(students.find(function (x) { return x.id === editingId; }));
    if (classInfoModal.open && editingClass) openClassInfoModal(editingClass);
  }

  /* ============================================================
     암호 백업
     ============================================================ */

  var passModal = $('#passModal');
  var passResolve = null;

  function askPassword(mode) {
    return new Promise(function (resolve) {
      passResolve = resolve;
      var isExport = mode === 'export';
      $('#passTitle').textContent = isExport ? '백업 암호 정하기' : '백업 암호 입력';
      $('#passDesc').textContent = isExport
        ? '이 암호로 파일을 잠급니다. 암호를 잊으면 다시 열 수 없습니다.'
        : '이 백업 파일을 잠글 때 쓴 암호를 넣어 주세요.';
      $('#passConfirmField').hidden = !isExport;
      $('#fPass1').value = '';
      $('#fPass2').value = '';
      $('#passError').classList.remove('is-on');
      passModal.showModal();
    });
  }

  function passFinish(value) {
    if (!passResolve) return;
    var r = passResolve;
    passResolve = null;
    passModal.close();
    r(value);
  }

  $('#btnPassCancel').addEventListener('click', function () { passFinish(null); });
  passModal.addEventListener('cancel', function () { passFinish(null); });

  $('#passForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var p1 = $('#fPass1').value, p2 = $('#fPass2').value;
    var isExport = !$('#passConfirmField').hidden;
    var err = $('#passError');
    if (p1.length < 4) { err.textContent = '암호는 4자 이상으로 정해 주세요.'; err.classList.add('is-on'); return; }
    if (isExport && p1 !== p2) { err.textContent = '두 암호가 서로 다릅니다.'; err.classList.add('is-on'); return; }
    passFinish(p1);
  });

  $('#btnExport').addEventListener('click', function () {
    if (!students.length) { toast('내보낼 학생이 없습니다', 'bad'); return; }
    askPassword('export').then(function (pass) {
      if (!pass) return;
      return Store.exportEncrypted(pass).then(function (backup) {
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'marathon-hub-' + Store.toISO(new Date()) + '.mhbak';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast(students.length + '명을 암호 백업으로 내려받았습니다', 'good');
      });
    }).catch(function () { toast('백업을 만들지 못했습니다', 'bad'); });
  });

  $('#btnRestore').addEventListener('click', function () { $('#restoreFile').click(); });

  $('#restoreFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then(function (text) {
      var obj;
      try { obj = JSON.parse(text); } catch (err) { throw new Error('백업 파일이 아닙니다.'); }
      return askPassword('import').then(function (pass) {
        if (pass == null) return null;
        return Store.importEncrypted(obj, pass);
      });
    }).then(function (payload) {
      if (!payload) return;
      return confirmAsk('백업 되살리기',
        '백업에 든 학생 ' + payload.students.length + '명을 서버 명단에 더하거나 백업 내용으로 고칩니다. ' +
        '백업에 없는 학생은 지우지 않습니다.', '되살리기').then(function (ok) {
        if (!ok) return;
        var r = Store.restorePayload(payload);
        students = Store.getStudents();
        return Store.flushNow(Store.KEYS.students, students).then(function () {
          var ids = students.map(function (s) { return s.id; });
          var list = [];
          Object.keys(r.links).forEach(function (sid) {
            if (ids.indexOf(sid) === -1) return;
            var l = r.links[sid] || {};
            list.push({ studentId: sid, hubCode: l.hubCode || null, studentCode: l.studentCode || undefined, appCode: l.appCode || '' });
          });
          return DB.saveLinks(list);
        }).then(function () {
          fields = Store.getFieldDefs('student');
          classFields = Store.getFieldDefs('class');
          render();
          toast(r.restored.join(' · ') + ' 되살렸습니다', 'good');
        });
      });
    }).catch(function (err) { toast(err.message || '되살리지 못했습니다', 'bad'); });
  });

  /* ============================================================
     이 기기 정리
     ============================================================ */

  $('#btnClearAll').addEventListener('click', function () {
    confirmAsk('이 기기에서 로그아웃하고 정리',
      '이 브라우저에 남아 있는 로그인과 임시 저장을 지우고 로그아웃합니다. 서버의 기록은 지워지지 않습니다.',
      '정리하고 로그아웃').then(function (ok) {
      if (!ok) return;
      Store.enableSync(false);
      Store.clearAll();
      SB.signOut().then(function () { location.reload(); });
    });
  });

  /* ============================================================
     시작
     ============================================================ */

  function reloadFromStore() {
    students = Store.getStudents();
    fields = Store.getFieldDefs('student');
    classFields = Store.getFieldDefs('class');
    render();
  }

  window.addEventListener('jt:loaded', function () {
    settings = Store.read(Store.KEYS.settings, {});
    collapsed = {};
    students = Store.getStudents();
    collapseIfCrowded();
    reloadFromStore();
  });

  window.addEventListener('jt:roster-changed', reloadFromStore);
  window.addEventListener('jt:fields', reloadFromStore);
  /* 서버에서 새로 받아 온 뒤 (탭 열기 · 창으로 돌아오기 · 실시간 반영) */
  window.addEventListener('jt:refreshed', function () {
    if (!$('#panel-roster').hidden && isBusy($('#panel-roster'))) { if (window.Sync) Sync.markSkipped(); return; }
    reloadFromStore();
  });

  window.UI = {
    $: $, $$: $$,
    toast: toast,
    confirmAsk: confirmAsk,
    conflictAsk: conflictAsk,
    guardedSave: guardedSave,
    staleCheck: staleCheck,
    isBusy: isBusy,
    copyText: copyText,
    selectTab: selectTab,
    whoami: whoami,
    issueMissing: issueMissing,
    getStudents: function () { return students; },
    activeStudents: function () { return students.filter(function (s) { return !s.archived; }); }
  };

})();
