/* ============================================================
   publish.js — 주간 레포트 → 공개

   깃허브에 파일을 올리지 않는다. 학생 정보가 공개 저장소에 남으면 안 되기 때문이다.
   '공개' 는 그 순간의 레포트 내용을 Supabase(published)에 고정해 두고
   학생 개인 페이지 [레포트] 탭에 보이게 표시하는 것이다.

   공개한 뒤 작성 내용을 고치면 다시 공개해야 학부모 화면이 바뀐다.
   [숨기기] 를 누르면 지우지 않고 학부모 화면에서만 감춘다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function toast(m, k) { UI.toast(m, k); }

  var state = {
    week: '', weekEnd: '',
    rows: [],              /* [{ student, pub, checked }] */
    published: {}
  };

  function draft() {
    if (window.Writer) Writer.flush();
    return Store.read(Store.KEYS.draft, null);
  }

  /* 지금 고른 반 (주간 레포트 → 작성의 반 고르기) — 공개 화면은 이 반 학생만 (20261030b) */
  function curClass() { return (window.Writer && Writer.currentClass && Writer.currentClass()) || ''; }
  function grpOf(s) { return (s.className || '').trim() || '(반 없음)'; }
  /* 반 체크 칸이 기준으로 삼는 학생 — 아직 공개 안 한 학생, 없으면 반 전원 */
  function grpBasis(rows) {
    var fresh = rows.filter(function (r) { return !r.pub; });
    return fresh.length ? fresh : rows;
  }

  /* 「작성 중 / 작성 완료」 구분 없이 반 학생 전원 (20261030a) — 비어 있는 칸은 레포트에서 숨는다
     미리 체크는 지금 고른 반의 아직 공개 안 한 학생만 (다른 반은 맨 아래 「다른 반도 함께 공개」에서 직접 고른다) */
  function buildRows(d) {
    var cur = curClass();
    return UI.activeStudents().map(function (s) {
      var common = (d.common || {})[s.className || ''] || { lessons: [], tests: [] };
      var pub = state.published[s.id] || null;
      return {
        student: s, common: common, entry: (d.entries || {})[s.id] || {},
        pub: pub, eligible: true,
        /* 아직 공개 안 한 학생은 미리 체크해 둔다 (지금 고른 반만) */
        checked: !pub && (!cur || grpOf(s) === cur)
      };
    }).sort(function (a, b) {
      var c = (a.student.className || '').localeCompare(b.student.className || '', 'ko');
      return c !== 0 ? c : (a.student.name || '').localeCompare(b.student.name || '', 'ko');
    });
  }

  /* 「10/22(목) 수업」 — 주 시작일 대신 그 반 수업일 (반을 안 골랐거나 수업 요일이 없으면 「10/12~10/18」 · 20261030b) */
  function whenText() {
    var cls = curClass(), L = cls && Store.lessonOf ? Store.lessonOf(cls, state.week) : null;
    if (L && L.date && !L.canceled) return Store.dateWithDow(L.date) + ' 수업 레포트';
    if (L && L.canceled) return Store.shortDate(state.week) + '~' + Store.shortDate(state.weekEnd) + ' (휴강 주) 레포트';
    return Store.shortDate(state.week) + '~' + Store.shortDate(state.weekEnd) + ' 레포트';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
           String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function render() {
    var host = $('#pubList');
    host.textContent = '';

    if (!state.week) {
      $('#pubWeekHint').textContent = '';
      host.innerHTML = '<div class="empty-state">주간 레포트 → 작성에서 주차를 먼저 정해 주세요.</div>';
      refreshButton();
      return;
    }

    $('#pubWeekHint').textContent = whenText() + (curClass() ? ' · ' + curClass() : '');

    if (!state.rows.length) {
      host.innerHTML = '<div class="empty-state">다니는 학생이 없습니다.</div>';
      refreshButton();
      return;
    }

    var groups = [], index = {};
    state.rows.forEach(function (r) {
      var key = (r.student.className || '').trim() || '(반 없음)';
      if (!(key in index)) { index[key] = groups.length; groups.push({ name: key, rows: [] }); }
      groups[index[key]].rows.push(r);
    });

    var frag = document.createDocumentFragment();
    var cur = curClass();
    var mine = cur ? groups.filter(function (g) { return g.name === cur; }) : groups;
    var others = cur ? groups.filter(function (g) { return g.name !== cur; }) : [];
    if (cur && !mine.length) {
      var em = document.createElement('div');
      em.className = 'empty-state';
      em.textContent = cur + ' 반에 다니는 학생이 없습니다.';
      frag.appendChild(em);
    }
    function groupInto(target, g) {
      var head = document.createElement('div');
      head.className = 'pub-group';
      var eligible = g.rows.filter(function (r) { return r.eligible; });
      head.innerHTML = '<label class="chk-inline"><input type="checkbox" data-grp></label>' +
                       '<span class="pub-group__name"></span>' +
                       '<span class="pub-group__count"></span>';
      head.querySelector('[data-grp]').dataset.grp = g.name;
      head.querySelector('[data-grp]').disabled = !eligible.length;
      /* 반 체크 칸 = 아직 공개 안 한 학생이 모두 체크돼 있으면 켜짐 (모두 공개한 반은 전원 기준 · 20261030c) */
      var basis = grpBasis(eligible);
      head.querySelector('[data-grp]').checked = basis.length > 0 && basis.every(function (r) { return r.checked; });
      head.querySelector('.pub-group__name').textContent = g.name;
      head.querySelector('.pub-group__count').textContent =
        g.rows.filter(function (r) { return r.pub && r.pub.visible; }).length + ' / ' + g.rows.length + '명 공개';
      target.appendChild(head);

      g.rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'pub-row';
        row.dataset.id = r.student.id;

        /* 학생 줄 상태는 「공개 전 / 공개됨」 두 가지만 (숨긴 레포트는 공개 전으로 · 언제 공개했는지는 마우스를 올리면) */
        var tag = r.pub && r.pub.visible
          ? '<span class="pub-tag pub-tag--on" title="' + fmtTime(r.pub.publishedAt) + ' 공개">공개됨</span>'
          : '<span class="pub-tag">공개 전</span>';

        var noLink = !Store.linkOf(r.student.id).hubCode;

        row.innerHTML =
          '<label class="chk-inline"><input type="checkbox" data-pick' +
            (r.eligible ? '' : ' disabled') + (r.checked ? ' checked' : '') + '></label>' +
          '<span class="pub-row__name"></span>' +
          tag +
          (noLink ? '<span class="pub-tag pub-tag--warn" title="학생 → 명단에서 개인 링크를 발급해야 학부모가 볼 수 있습니다">링크 없음</span>' : '') +
          '<span class="spacer"></span>' +
          (r.pub
            ? '<button class="btn btn--sm btn--ghost" type="button" data-vis="' + (r.pub.visible ? '0' : '1') + '">' +
                (r.pub.visible ? '숨기기' : '다시 보이기') + '</button>'
            : '');
        row.querySelector('.pub-row__name').textContent = r.student.name;
        var gaps = Report.gapsOf(r.common, r.entry);
        if (gaps.length) row.title = '비어 있는 칸 — ' + gaps.join(', ') + ' (레포트에서 숨습니다)';
        target.appendChild(row);
      });
    }
    mine.forEach(function (g) { groupInto(frag, g); });
    /* 여러 반을 한 번에 — 맨 아래 접힌 메뉴에서만 */
    if (others.length) {
      var box = document.createElement('details');
      box.className = 'pub-others';
      box.open = others.some(function (g) { return g.rows.some(function (r) { return r.checked; }); }) || !!state.othersOpen;
      box.innerHTML = '<summary>다른 반도 함께 공개 <span class="muted-note">' + others.length + '개 반</span></summary>';
      box.addEventListener('toggle', function () { state.othersOpen = box.open; });
      others.forEach(function (g) { groupInto(box, g); });
      frag.appendChild(box);
    }
    host.appendChild(frag);
    refreshButton();
  }

  function refreshButton() {
    var picked = state.rows.filter(function (r) { return r.checked; });
    var again = picked.filter(function (r) { return r.pub; }).length;

    $('#btnPublish').disabled = !picked.length;
    $('#btnPublish').textContent = picked.length ? picked.length + '명 공개' : '체크한 학생 공개';
    $('#pubInfo').textContent =
      picked.length ? picked.length + '명 선택' + (again ? ' (그중 ' + again + '명은 다시 공개 — 내용이 새로 바뀝니다)' : '') : '공개할 학생을 체크하세요';
  }

  function load() {
    var d = draft();
    if (!d || !d.weekStart) { state.week = ''; render(); return Promise.resolve(); }
    state.week = d.weekStart;
    state.weekEnd = d.weekEnd;
    $('#pubList').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    return Promise.all([DB.publishedOfWeek(d.weekStart), Store.loadReview ? Store.loadReview(d.weekStart) : null]).then(function (res) {
      var pub = res[0];
      state.published = pub;
      state.rows = buildRows(d);
      render();
    }).catch(function (e) {
      $('#pubList').innerHTML = '';
      showError('불러오지 못했습니다 — ' + e.message);
    });
  }

  function showError(msg) {
    var box = $('#pubError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  /* ---------- 체크 ---------- */

  $('#pubList').addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-pick]')) {
      var id = t.closest('.pub-row').dataset.id;
      var r = state.rows.find(function (x) { return x.student.id === id; });
      if (r) r.checked = t.checked;
      render();
    } else if (t.matches('[data-grp]')) {
      var name = t.dataset.grp;
      var inGrp = state.rows.filter(function (r) { return grpOf(r.student) === name && r.eligible; });
      /* 켜면 아직 공개 안 한 학생을 모두 체크 (없으면 전원 · 이미 고른 학생은 그대로) · 끄면 반 전원 해제 */
      if (t.checked) {
        grpBasis(inGrp).forEach(function (r) { r.checked = true; });
      } else {
        inGrp.forEach(function (r) { r.checked = false; });
      }
      render();
    }
  });

  /* ---------- 숨기기 · 다시 보이기 ---------- */

  $('#pubList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-vis]');
    if (!b) return;
    var id = b.closest('.pub-row').dataset.id;
    var vis = b.dataset.vis === '1';
    b.disabled = true;
    DB.setPublishedVisible(state.week, [id], vis).then(function () {
      toast(vis ? '다시 보이게 했습니다' : '학부모 화면에서 숨겼습니다', 'good');
      return load();
    }).catch(function (err) {
      b.disabled = false;
      toast('바꾸지 못했습니다 — ' + err.message, 'bad');
    });
  });

  /* ---------- 공개 ---------- */

  $('#btnPublish').addEventListener('click', function () {
    var picked = state.rows.filter(function (r) { return r.checked; });
    if (!picked.length) return;

    /* 정말 빠진 것만 한 줄 (막지는 않는다 · 개별 코멘트는 넣지 않는다) */
    var gap = Report.gapLine(picked.map(function (r) { return { name: r.student.name, common: r.common, entry: r.entry }; }));
    UI.confirmAsk('학부모에게 공개',
      picked.length + '명의 ' + whenText() + '를 공개합니다. 공개하면 바로 학생 개인 페이지에서 보입니다.' +
      (gap ? '\n\n' + gap + ' — 비어 있는 칸은 레포트에서 숨습니다.' : ''), '공개').then(function (ok) {
      if (!ok) return;
      var btn = $('#btnPublish');
      btn.disabled = true;
      btn.textContent = '공개하는 중…';
      showError('');

      var rows = picked.map(function (r) {
        return {
          studentId: r.student.id,
          data: Report.toReportData(r.student, r.common, r.entry, { start: state.week, end: state.weekEnd })
        };
      });

      DB.publishReports(state.week, rows, UI.whoami()).then(function () {
        var all = Store.read(Store.KEYS.published, {});
        all[state.week] = all[state.week] || {};
        rows.forEach(function (r) { all[state.week][r.studentId] = { visible: true, publishedAt: new Date().toISOString() }; });
        Store.writeLocal(Store.KEYS.published, all);
        toast(rows.length + '명 공개했습니다. 주간 레포트 → 발송에서 링크를 보내세요', 'good');
        return load();
      }).catch(function (e) {
        showError('공개하지 못했습니다 — ' + e.message);
        refreshButton();
      });
    });
  });

  $('#btnPubRefresh').addEventListener('click', function () {
    load().then(function () { toast('다시 읽었습니다'); });
  });

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 2) load();
  });

  /* 주간 레포트 주차 띠에서 주를 바꾸면 (rtabs.js · 20261029a) */
  window.addEventListener('jt:report-week', function () {
    if (!$('#panel-publish').hidden) load();
  });

  window.addEventListener('jt:loaded', function () {
    if (!$('#panel-publish').hidden) load();
  });

  /* 다른 기기에서 공개·작성 내용이 바뀌었을 때 */
  window.addEventListener('jt:refreshed', function () {
    if ($('#panel-publish').hidden) return;
    if (UI.isBusy($('#panel-publish'))) { if (window.Sync) Sync.markSkipped(); return; }
    load();
  });

})();
