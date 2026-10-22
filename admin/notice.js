/* ============================================================
   notice.js — 더보기 → 반 공지

   · 반과 주차를 고르고 커리큘럼·문학·독서·과제·특이사항·자료·영상·특별 공지를 적는다
   · 여러 반을 고르면 같은 공지가 한 번에 올라간다 → 같은 '묶음'(bundle_id)
   · 묶음을 고치면 묶인 반 전부가 같이 바뀐다
     반을 빼면 그 반 공지는 지워지고, 반을 더하면 그 반에도 올라간다
   · [이 반만 따로] 를 누르면 그 반 공지만 묶음에서 떼어 따로 고친다
   · (반, 주차) 마다 한 줄이다. 지난 주차 공지는 지우지 않고 쌓인다
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var TEXT_FIELDS = [
    ['title', '#ntTitle'], ['special', '#ntSpecial'], ['curriculum', '#ntCurriculum'],
    ['literature', '#ntLiterature'], ['reading', '#ntReading'],
    ['homework', '#ntHomework'], ['notes', '#ntNotes']
  ];

  var state = {
    notices: [],
    codes: {},
    loaded: false,
    editing: null,          /* 고치는 중인 묶음 { bundleId, rows } — 새로 쓰기면 null */
    classes: {},            /* 고른 반 { 반이름: true } */
    files: [],              /* [{name,url}] */
    videos: [],             /* [{title,url}] */
    listClass: ''
  };

  /* ============================================================
     불러오기
     ============================================================ */

  function load() {
    $('#ntList').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    return Promise.all([DB.listNotices(), DB.listClassCodes()]).then(function (res) {
      state.notices = res[0];
      state.codes = res[1];
      state.loaded = true;
      renderList();
      renderCodes();
      renderClassChips();
    }).catch(function (e) {
      $('#ntList').innerHTML = '';
      toast('공지를 불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  /* ============================================================
     입력 칸
     ============================================================ */

  function allClasses() {
    var names = Store.getClasses().map(function (c) { return c.name; });
    /* 지금은 학생이 없어도 예전에 공지를 올린 반은 고를 수 있게 둔다 */
    state.notices.forEach(function (n) {
      if (names.indexOf(n.className) === -1 && !Store.isArchivedClass(n.className)) names.push(n.className);
    });
    return names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  function renderClassChips() {
    var host = $('#ntClasses');
    host.textContent = '';
    var names = allClasses();
    if (!names.length) {
      host.innerHTML = '<p class="panel__hint">아직 반이 없습니다. 학생 → 명단 → 학생 추가 → 반 고르기의 [+ 새 반 만들기]로 만들 수 있습니다.</p>';
      return;
    }
    var counts = {};
    Store.getClasses().forEach(function (c) { counts[c.name] = c.count; });

    names.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.classes[name] ? ' is-on' : '');
      b.dataset.cls = name;
      b.innerHTML = '<span class="chip__name"></span><span class="chip__count num"></span>';
      b.querySelector('.chip__name').textContent = name;
      b.querySelector('.chip__count').textContent = counts[name] ? counts[name] + '명' : '0명';
      host.appendChild(b);
    });

    var n = Object.keys(state.classes).length;
    $('#ntClassHint').textContent = n > 1
      ? n + '개 반에 같은 공지가 올라갑니다'
      : '여러 개 고를 수 있습니다';
  }

  $('#ntClasses').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var name = chip.dataset.cls;
    if (state.classes[name]) delete state.classes[name]; else state.classes[name] = true;
    renderClassChips();
  });

  function renderWeekSummary() {
    var w = $('#ntWeek').value;
    var end = w ? (Store.weekEndOf(w) || Store.autoEnd(w)) : '';
    $('#ntWeekSummary').textContent = w ? Store.dateWithDow(w) + ' ~ ' + Store.dateWithDow(end) + ' 주차' : '';
  }
  $('#ntWeek').addEventListener('change', renderWeekSummary);

  /* 자료 · 영상 줄 */
  function renderLinkRows(kind) {
    var list = kind === 'file' ? state.files : state.videos;
    var host = $(kind === 'file' ? '#ntFiles' : '#ntVideos');
    host.textContent = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'panel__hint';
      p.textContent = kind === 'file' ? '아직 없습니다.' : '아직 없습니다. 영상이 없으면 이 칸은 학부모 화면에 안 나옵니다.';
      host.appendChild(p);
      return;
    }
    list.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'row-item nt-link-row';
      row.innerHTML =
        '<input class="input nt-link-row__name" type="text" data-kind="' + kind + '" data-f="name" data-i="' + i + '">' +
        '<input class="input nt-link-row__url" type="url" inputmode="url" data-kind="' + kind + '" data-f="url" data-i="' + i + '" placeholder="https://…">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="' + kind + '" data-i="' + i + '" aria-label="삭제">×</button>';
      var nameInput = row.querySelector('[data-f="name"]');
      nameInput.value = (kind === 'file' ? it.name : it.title) || '';
      nameInput.placeholder = kind === 'file' ? '예) 3주차 문학 프린트' : '예) 10/9 문학 다시보기';
      row.querySelector('[data-f="url"]').value = it.url || '';
      host.appendChild(row);
    });
  }

  $('#noticeFormPanel').addEventListener('input', function (e) {
    var t = e.target;
    if (!t.dataset.kind) return;
    var list = t.dataset.kind === 'file' ? state.files : state.videos;
    var it = list[+t.dataset.i];
    if (!it) return;
    if (t.dataset.f === 'url') it.url = t.value.trim();
    else if (t.dataset.kind === 'file') it.name = t.value;
    else it.title = t.value;
  });

  $('#noticeFormPanel').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    var kind = b.dataset.del;
    (kind === 'file' ? state.files : state.videos).splice(+b.dataset.i, 1);
    renderLinkRows(kind);
  });

  $('#btnNtAddFile').addEventListener('click', function () {
    state.files.push({ name: '', url: '' });
    renderLinkRows('file');
    var inputs = $('#ntFiles').querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 2].focus();
  });
  $('#btnNtAddVideo').addEventListener('click', function () {
    state.videos.push({ title: '', url: '' });
    renderLinkRows('video');
    var inputs = $('#ntVideos').querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 2].focus();
  });

  /* ============================================================
     폼 채우기 · 비우기
     ============================================================ */

  function defaultWeek() {
    var d = Store.read(Store.KEYS.draft, null);
    return (d && d.weekStart) || Store.thisWeek().start;
  }

  function fillForm(src, opts) {
    opts = opts || {};
    TEXT_FIELDS.forEach(function (f) { $(f[1]).value = (src && src[f[0]]) || ''; });
    state.files = ((!opts.noLinks && src && src.materials) || []).map(function (m) { return { name: m.name || '', url: m.url || '' }; });
    state.videos = ((!opts.noLinks && src && src.videos) || []).map(function (v) { return { title: v.title || '', url: v.url || '' }; });
    /* 예전 「자료 · 다시보기」 링크 칸 — 이미 링크를 넣어 올린 공지를 고칠 때만 보인다.
       새 공지의 영상 · 자료 파일은 주간 레포트 → 작성 → 반 공통 (weekly.js) */
    $('#ntFileSub').hidden = !state.files.length;
    $('#ntVideoSub').hidden = !state.videos.length;
    $('#ntVisible').checked = !src || src.visible !== false;
    $('#ntWeek').value = opts.week || defaultWeek();
    state.classes = {};
    (opts.classes || []).forEach(function (c) { state.classes[c] = true; });
    renderWeekSummary();
    renderLinkRows('file');
    renderLinkRows('video');
    renderClassChips();
    showError('');
  }

  function setModeNew() {
    state.editing = null;
    $('#noticeFormTitle').textContent = '반 공지 올리기';
    $('#noticeFormHint').textContent = '여러 반을 고르면 같은 공지가 한 번에 올라갑니다';
    $('#btnNtSave').textContent = '공지 올리기';
    $('#btnNtCancel').hidden = true;
    $('#btnNoticeNew').hidden = true;
  }

  function setModeEdit(bundleRows) {
    state.editing = { bundleId: bundleRows[0].bundleId, rows: bundleRows.slice() };
    var names = bundleRows.map(function (r) { return r.className; });
    $('#noticeFormTitle').textContent = '공지 고치기';
    $('#noticeFormHint').textContent = bundleRows.length > 1
      ? names.join(' · ') + ' — 같이 올린 ' + bundleRows.length + '개 반이 함께 바뀝니다'
      : names[0] + ' 반 공지를 고칩니다';
    $('#btnNtSave').textContent = '고친 내용 저장';
    $('#btnNtCancel').hidden = false;
    $('#btnNoticeNew').hidden = false;
  }

  function startNew() {
    setModeNew();
    fillForm(null, {});
  }

  function startEdit(bundleId) {
    var rows = state.notices.filter(function (n) { return n.bundleId === bundleId; });
    if (!rows.length) return;
    setModeEdit(rows);
    fillForm(rows[0], { week: rows[0].weekStart, classes: rows.map(function (r) { return r.className; }) });
    $('#noticeFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 지난 공지를 밑글 삼아 새로 쓴다 (주차·반은 지금 고른 것) */
  function startCopy(bundleId) {
    var rows = state.notices.filter(function (n) { return n.bundleId === bundleId; });
    if (!rows.length) return;
    setModeNew();
    fillForm(rows[0], { week: defaultWeek(), classes: rows.map(function (r) { return r.className; }), noLinks: true });
    $('#ntWeek').focus();
    $('#noticeFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('내용을 불러왔습니다. 주차를 확인하고 올려 주세요');
  }

  $('#btnNtCancel').addEventListener('click', startNew);
  $('#btnNoticeNew').addEventListener('click', startNew);

  /* ============================================================
     저장
     ============================================================ */

  function showError(msg) {
    var box = $('#ntError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  function validUrl(u) { return /^https?:\/\/[^\s<>"']+$/i.test(String(u || '').trim()); }

  function collect() {
    var out = {};
    TEXT_FIELDS.forEach(function (f) { out[f[0]] = $(f[1]).value.replace(/\s+$/, ''); });
    out.title = out.title.trim();
    out.materials = state.files
      .filter(function (m) { return (m.name || '').trim() || (m.url || '').trim(); })
      .map(function (m) { return { name: (m.name || '').trim() || '자료', url: (m.url || '').trim() }; });
    out.videos = state.videos
      .filter(function (v) { return (v.title || '').trim() || (v.url || '').trim(); })
      .map(function (v) { return { title: (v.title || '').trim() || '수업 영상', url: (v.url || '').trim() }; });
    out.visible = $('#ntVisible').checked;
    return out;
  }

  $('#btnNtSave').addEventListener('click', function () {
    showError('');
    var week = $('#ntWeek').value;
    var classes = Object.keys(state.classes);
    var body = collect();

    if (!week) { showError('주차 시작일을 골라 주세요.'); return; }
    if (!classes.length) { showError('올릴 반을 하나 이상 골라 주세요.'); return; }
    var hasContent = TEXT_FIELDS.some(function (f) { return String(body[f[0]] || '').trim(); }) ||
                     body.materials.length || body.videos.length;
    if (!hasContent) { showError('공지 내용이 비어 있습니다.'); return; }
    var badLink = body.materials.concat(body.videos).filter(function (x) { return !validUrl(x.url); });
    if (badLink.length) {
      showError('링크가 올바르지 않습니다: ' + (badLink[0].name || badLink[0].title) + ' — https:// 로 시작하는 주소를 넣어 주세요.');
      return;
    }

    var bundleId = state.editing ? state.editing.bundleId : Store.newId();
    var mine = state.editing ? state.editing.rows : [];

    /* 다른 묶음의 공지를 덮게 되는 반 */
    var clash = state.notices.filter(function (n) {
      return n.weekStart === week && classes.indexOf(n.className) !== -1 && n.bundleId !== bundleId;
    });
    /* 이 묶음에서 빠지는 공지 (반을 뺐거나 주차를 바꿨다) */
    var removed = mine.filter(function (n) {
      return !(n.weekStart === week && classes.indexOf(n.className) !== -1);
    });

    var warn = [];
    if (clash.length) {
      warn.push(clash.map(function (n) { return n.className; }).join(', ') +
                ' 반에는 이 주차 공지가 이미 있습니다. 이 내용으로 바뀝니다.');
    }
    if (removed.length) {
      warn.push(removed.map(function (n) { return n.className + '(' + Store.shortDate(n.weekStart) + ')'; }).join(', ') +
                ' 공지는 지워집니다.');
    }

    var go = warn.length ? UI.confirmAsk('확인해 주세요', warn.join(' '), '그대로 저장') : Promise.resolve(true);

    go.then(function (ok) {
      if (!ok) return null;
      /* 불러온 뒤 다른 분이 이 반·주차 공지를 고치거나 새로 올렸는지 본다 */
      return DB.noticeRowsOf(week, classes, mine.map(function (n) { return n.id; })).then(function (srv) {
        /* 고치는 공지는 고치기 시작한 순간의 시각과, 나머지는 지금 목록과 비교한다 */
        var known = {};
        state.notices.forEach(function (n) { known[n.id] = n.updatedAt || ''; });
        mine.forEach(function (n) { known[n.id] = n.updatedAt || ''; });
        var changed = srv.filter(function (r) {
          return !(r.id in known) || known[r.id] !== (r.updated_at || '');
        });
        if (!changed.length) return 'go';
        return UI.conflictAsk(changed.map(function (r) { return r.class_name; }).join(', ') + ' 반 ' +
                              Store.shortDate(week) + ' 주차 공지');
      });
    }).then(function (choice) {
      if (!choice || choice === 'cancel') return;
      if (choice === 'reload') {
        var bid = state.editing && state.editing.bundleId;
        load().then(function () {
          if (bid && state.notices.some(function (n) { return n.bundleId === bid; })) startEdit(bid);
          toast('다른 분이 저장한 공지를 불러왔습니다');
        });
        return;
      }
      var btn = $('#btnNtSave');
      btn.disabled = true;

      var rows = classes.map(function (c) {
        var r = { bundleId: bundleId, className: c, weekStart: week, updatedBy: UI.whoami() };
        Object.keys(body).forEach(function (k) { r[k] = body[k]; });
        return r;
      });

      DB.saveNotices(rows)
        .then(function () { return DB.deleteNotices(removed.map(function (n) { return n.id; })); })
        .then(function () {
          btn.disabled = false;
          toast((state.editing ? '고친 내용을 저장했습니다' : '공지를 올렸습니다') +
                ' · ' + classes.join(', '), 'good');
          startNew();
          return load();
        })
        .catch(function (e) {
          btn.disabled = false;
          showError('저장하지 못했습니다 — ' + e.message);
        });
    }).catch(function (e) { showError('확인하지 못했습니다 — ' + e.message); });
  });

  /* ============================================================
     올린 공지 목록 — 묶음 단위로 보여 준다
     ============================================================ */

  function bundles() {
    var map = {}, order = [];
    state.notices.forEach(function (n) {
      if (state.listClass && n.className !== state.listClass) return;
      if (!map[n.bundleId]) { map[n.bundleId] = []; order.push(n.bundleId); }
      map[n.bundleId].push(n);
    });
    /* 목록 필터가 걸려 있어도 묶음 전체 반 이름은 보여 줘야 한다 */
    return order.map(function (id) {
      var all = state.notices.filter(function (n) { return n.bundleId === id; });
      return { id: id, rows: all, week: map[id][0].weekStart };
    }).sort(function (a, b) { return b.week.localeCompare(a.week); });
  }

  function summaryOf(n) {
    var t = n.title || n.special || n.curriculum || n.literature || n.reading || n.homework || n.notes || '';
    t = String(t).replace(/\s+/g, ' ').trim();
    if (!t && n.materials.length) t = '자료 ' + n.materials.length + '개';
    if (!t && n.videos.length) t = '영상 ' + n.videos.length + '개';
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function renderList() {
    var host = $('#ntList');
    host.textContent = '';

    var sel = $('#ntListClass');
    var keep = state.listClass;
    sel.innerHTML = '<option value="">전체 반</option>';
    allClasses().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    sel.value = keep;

    var list = bundles();
    if (!list.length) {
      host.innerHTML = '<div class="empty-state">아직 올린 공지가 없습니다.</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    var lastWeek = '';
    list.forEach(function (b) {
      if (b.week !== lastWeek) {
        lastWeek = b.week;
        var h = document.createElement('div');
        h.className = 'pub-group';
        var end = Store.weekEndOf(b.week);
        h.innerHTML = '<span class="pub-group__name"></span>';
        h.firstChild.textContent = Store.dateWithDow(b.week) + (end ? ' ~ ' + Store.dateWithDow(end) : '') + ' 주차';
        frag.appendChild(h);
      }

      var first = b.rows[0];
      var hidden = b.rows.every(function (r) { return !r.visible; });
      var card = document.createElement('div');
      card.className = 'nt-item' + (hidden ? ' is-hidden' : '');
      card.dataset.bundle = b.id;
      card.innerHTML =
        '<div class="nt-item__top">' +
          '<span class="nt-item__classes"></span>' +
          (hidden ? '<span class="pub-tag pub-tag--hidden">숨김</span>' : '<span class="pub-tag pub-tag--on">보이는 중</span>') +
        '</div>' +
        '<div class="nt-item__summary"></div>' +
        '<div class="nt-item__meta"></div>' +
        '<div class="nt-item__acts">' +
          '<button class="btn btn--sm btn--primary" type="button" data-nact="edit">' +
            (b.rows.length > 1 ? b.rows.length + '개 반 함께 고치기' : '고치기') + '</button>' +
          '<button class="btn btn--sm" type="button" data-nact="copy">복사해서 새로 쓰기</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-nact="vis">' + (hidden ? '다시 보이기' : '숨기기') + '</button>' +
          '<button class="btn btn--sm btn--danger" type="button" data-nact="del">삭제</button>' +
        '</div>' +
        (b.rows.length > 1
          ? '<div class="nt-item__split"><span class="panel__hint">한 반만 다르게 고치려면 →</span></div>'
          : '');

      var cls = card.querySelector('.nt-item__classes');
      b.rows.forEach(function (r) {
        var chip = document.createElement('span');
        chip.className = 'nt-cls';
        chip.textContent = r.className;
        cls.appendChild(chip);
      });
      card.querySelector('.nt-item__summary').textContent = summaryOf(first) || '(내용 없음)';
      card.querySelector('.nt-item__meta').textContent =
        (first.updatedBy ? first.updatedBy + ' · ' : '') +
        (first.updatedAt ? new Date(first.updatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') +
        (first.materials.length ? ' · 자료 ' + first.materials.length : '') +
        (first.videos.length ? ' · 영상 ' + first.videos.length : '');

      var split = card.querySelector('.nt-item__split');
      if (split) {
        b.rows.forEach(function (r) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn--sm btn--ghost';
          btn.dataset.nact = 'split';
          btn.dataset.id = r.id;
          btn.textContent = r.className + '만 따로';
          split.appendChild(btn);
        });
      }
      frag.appendChild(card);
    });
    host.appendChild(frag);
  }

  $('#ntListClass').addEventListener('change', function (e) {
    state.listClass = e.target.value;
    renderList();
  });

  $('#ntList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-nact]');
    if (!b) return;
    var card = b.closest('.nt-item');
    var bundleId = card.dataset.bundle;
    var rows = state.notices.filter(function (n) { return n.bundleId === bundleId; });
    var act = b.dataset.nact;

    if (act === 'edit') { startEdit(bundleId); return; }
    if (act === 'copy') { startCopy(bundleId); return; }

    if (act === 'vis') {
      var hidden = rows.every(function (r) { return !r.visible; });
      DB.updateBundleVisible(bundleId, hidden).then(function () {
        toast(hidden ? '다시 보이게 했습니다' : '학생·학부모 화면에서 숨겼습니다', 'good');
        return load();
      }).catch(function (err) { toast('바꾸지 못했습니다 — ' + err.message, 'bad'); });
      return;
    }

    if (act === 'del') {
      UI.confirmAsk('공지 삭제',
        rows.map(function (r) { return r.className; }).join(', ') + ' 반의 ' + Store.shortDate(rows[0].weekStart) +
        ' 주차 공지를 지웁니다. 되돌릴 수 없습니다. 잠깐 감추려면 [숨기기]를 쓰세요.', '삭제').then(function (ok) {
        if (!ok) return;
        DB.deleteNotices(rows.map(function (r) { return r.id; })).then(function () {
          if (state.editing && state.editing.bundleId === bundleId) startNew();
          toast('공지를 지웠습니다');
          return load();
        }).catch(function (err) { toast('지우지 못했습니다 — ' + err.message, 'bad'); });
      });
      return;
    }

    if (act === 'split') {
      var row = rows.find(function (r) { return r.id === b.dataset.id; });
      if (!row) return;
      var newId = Store.newId();
      DB.updateNotice(row.id, { bundleId: newId }).then(function () {
        return load();
      }).then(function () {
        startEdit(newId);
        toast(row.className + ' 반 공지를 따로 떼었습니다. 이제 이 반만 고쳐집니다', 'good');
      }).catch(function (err) { toast('떼어 내지 못했습니다 — ' + err.message, 'bad'); });
    }
  });

  /* ============================================================
     반 공용 공지 링크
     ============================================================ */

  function renderCodes() {
    var host = $('#classCodeList');
    host.textContent = '';
    var names = allClasses();
    if (!names.length) {
      host.innerHTML = '<div class="empty-state">반이 없습니다.</div>';
      return;
    }
    names.forEach(function (name) {
      var code = state.codes[name];
      var row = document.createElement('div');
      row.className = 'pub-row';
      row.dataset.cls = name;
      row.innerHTML =
        '<span class="pub-row__name"></span>' +
        (code ? '<code class="pub-row__path"></code>' : '<span class="pub-tag">링크 없음</span>') +
        '<span class="spacer"></span>' +
        (code
          ? '<button class="btn btn--sm" type="button" data-cc="copy">복사</button>' +
            '<a class="btn btn--sm btn--ghost" target="_blank" rel="noopener">열어 보기</a>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-cc="reissue">재발급</button>'
          : '<button class="btn btn--sm btn--primary" type="button" data-cc="issue">발급</button>');
      row.querySelector('.pub-row__name').textContent = name;
      if (code) {
        row.querySelector('code').textContent = Store.noticeUrl(code);
        row.querySelector('a').href = Store.noticeUrl(code);
      }
      host.appendChild(row);
    });
  }

  $('#classCodeList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cc]');
    if (!b) return;
    var name = b.closest('.pub-row').dataset.cls;
    var act = b.dataset.cc;

    if (act === 'copy') {
      UI.copyText(Store.noticeUrl(state.codes[name]))
        .then(function () { toast(name + ' 반 공지 링크를 복사했습니다', 'good'); })
        .catch(function (err) { toast(err.message, 'bad'); });
      return;
    }

    var go = act === 'reissue'
      ? UI.confirmAsk('반 공지 링크 재발급', '새 링크를 만들면 지금까지 돌린 ' + name + ' 반 공지 링크는 열리지 않습니다.', '재발급')
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var code = Store.randomCode(20);
      return DB.saveClassCode(name, code).then(function () {
        state.codes[name] = code;
        renderCodes();
        toast(name + ' 반 공지 링크를 만들었습니다', 'good');
      });
    }).catch(function (err) { toast('만들지 못했습니다 — ' + err.message, 'bad'); });
  });

  /* ============================================================
     시작
     ============================================================ */

  var formReady = false;

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index !== 4) return;
    if (!formReady) { formReady = true; startNew(); }
    load();
  });

  window.addEventListener('jt:loaded', function () {
    state.loaded = false;
    if (!$('#panel-notice').hidden) load();
  });

  /* 다른 기기에서 공지가 바뀌면 목록만 새로 받는다 (쓰고 있는 칸은 그대로) */
  function remoteReload() {
    if ($('#panel-notice').hidden || document.querySelector('dialog[open]')) return;
    load();
  }
  window.addEventListener('jt:remote', function (e) {
    var t = e.detail && e.detail.table;
    if (t === 'class_notices' || t === '*') remoteReload();
  });

})();
