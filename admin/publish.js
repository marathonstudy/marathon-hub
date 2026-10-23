/* ============================================================
   publish.js — 레포트 발송 → 2 공개

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
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var state = {
    week: '', weekEnd: '',
    rows: [],              /* [{ student, pub, checked }] */
    published: {}
  };

  function draft() {
    if (window.Writer) Writer.flush();
    return Store.read(Store.KEYS.draft, null);
  }

  /* 지금 고른 반 (레포트 발송 → 1 작성의 반 고르기) — 공개 화면은 이 반 학생만 (20261030b) */
  function curClass() { return (window.Writer && Writer.currentClass && Writer.currentClass()) || ''; }
  function grpOf(s) { return (s.className || '').trim() || '(반 없음)'; }
  /* 반 체크 칸이 기준으로 삼는 학생 — 아직 공개 안 한 학생, 없으면 반 전원 */
  function grpBasis(rows) {
    var fresh = rows.filter(function (r) { return !r.pub; });
    return fresh.length ? fresh : rows;
  }

  /* 고른 반 학생 전원 (반 하나 + 수업 하나 · 다른 반은 보이지 않는다 · 20261030e) — 비어 있는 칸은 레포트에서 숨는다
     미리 체크는 아직 공개 안 한 학생만 */
  /* 과정 (course.js · 20261031a) — 그 회차에 같은 주로 쓰는 반들 · 반마다 수업일 · 마감(그 반 수업일 밤 12시) */
  function isCourse() { return !!(window.Course && Course.isKey(curClass())); }
  function memberOf(cls) {
    if (!isCourse()) return null;
    return Course.split(curClass(), state.week).same.find(function (m) { return m.cls === cls; }) || null;
  }
  /* 마감이 지났나 — 수업일 다음 날부터 (개별 반은 늘 지난 것으로 · 지금 흐름 그대로) */
  function closed(cls) {
    var m = memberOf(cls);
    return !m || (!!m.date && DDay.today() > m.date);
  }
  function buildRows(d) {
    var cur = curClass(), order = {};
    if (isCourse()) Course.split(cur, state.week).same.forEach(function (m, i) { order[m.cls] = i; });
    var commonOf = function (k) { return (d.common || {})[k] || null; };
    return UI.activeStudents().filter(function (s) { return !cur || (isCourse() ? grpOf(s) in order : grpOf(s) === cur); }).map(function (s) {
      var common = (window.Course ? Course.effectiveCommon(s.className || '', state.week, commonOf) : null) || (d.common || {})[s.className || ''] || { lessons: [], tests: [] };
      var pub = state.published[s.id] || null;
      return {
        student: s, common: common, entry: (d.entries || {})[s.id] || {},
        pub: pub, eligible: true,
        /* 아직 공개 안 한 학생은 미리 체크해 둔다 — 과정은 마감이 지난 반만 */
        checked: !pub && closed(grpOf(s))
      };
    }).sort(function (a, b) {
      var c = isCourse() ? order[grpOf(a.student)] - order[grpOf(b.student)] : (a.student.className || '').localeCompare(b.student.className || '', 'ko');
      return c !== 0 ? c : (a.student.name || '').localeCompare(b.student.name || '', 'ko');
    });
  }

  /* 「10/22(목) 수업」 — 주 시작일 대신 그 반 수업일 (반을 안 골랐거나 수업 요일이 없으면 「10/12~10/18」 · 20261030b) */
  function whenText() {
    if (isCourse()) { var co = Course.byKey(curClass()); return co.name + ' ' + Course.label(co, Course.roundOfWeek(co, state.week)) + ' 레포트'; }
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
      host.innerHTML = '<div class="empty-state">레포트 발송 → 1 작성에서 주차를 먼저 정해 주세요.</div>';
      refreshButton();
      return;
    }

    $('#pubWeekHint').textContent = whenText() + (curClass() && !isCourse() ? ' · ' + curClass() : '');

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
    var mine = groups;
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
      var mm = memberOf(g.name);
      if (mm) {
        var dl = document.createElement('span');
        dl.className = 'pub-group__dl' + (closed(g.name) ? ' is-closed' : ' is-open');
        dl.textContent = (mm.date ? Store.dateWithDow(mm.date) + ' 수업 · ' : '') + (closed(g.name) ? '마감 지남' : '마감 전 (' + Lesson.md(mm.date, false) + ' 밤 12시)');
        head.querySelector('.pub-group__name').after(dl);
      }
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

  /* 과정 — 마감 전인 반을 체크했으면 누른 사람에게만 묻는다: [마감 끝난 반만 공개](기본) · [그래도 공개] · [취소] (20261031a) */
  function askOpen(picked) {
    var open = [];
    picked.forEach(function (r) { var g = grpOf(r.student); if (!closed(g) && open.indexOf(g) === -1) open.push(g); });
    if (!open.length) return Promise.resolve(picked);
    var names = open.map(function (g) { return Course.shortName(g); }).join(' · ');
    $('#pubWarnDesc').textContent = names + '은(는) 아직 마감 전입니다. 지금 공개하면 안 낸 학생이 「미응시」로 나갑니다.';
    var onlyClosed = picked.filter(function (r) { return closed(grpOf(r.student)); });
    $('#pubWarnClosed').disabled = !onlyClosed.length;
    $('#pubWarnClosed').textContent = onlyClosed.length ? '마감 끝난 반만 공개 (' + onlyClosed.length + '명)' : '마감 끝난 반이 없습니다';
    return new Promise(function (resolve) {
      var m = $('#pubWarnModal');
      function done(v) { m.close(); ['pubWarnClosed', 'pubWarnAll', 'pubWarnCancel'].forEach(function (id) { $('#' + id).onclick = null; }); resolve(v); }
      $('#pubWarnClosed').onclick = function () { done(onlyClosed); };
      $('#pubWarnAll').onclick = function () { done(picked); };
      $('#pubWarnCancel').onclick = function () { done(null); };
      m.onclose = function () { if (m.returnValue !== 'x') resolve(null); };
      m.showModal();
      setTimeout(function () { $('#pubWarnClosed').focus(); }, 0);
    });
  }
  /* 「미응시로 나갈 학생 — 목동 2명 · 반포 5명」 (반별) */
  function absentLine(rows) {
    var by = {}, order = [];
    rows.forEach(function (r) {
      if (!(r.data.tests || []).some(function (t) { return t.absent === '미응시'; })) return;
      var g = grpOf(r.student);
      if (!(g in by)) { by[g] = 0; order.push(g); }
      by[g]++;
    });
    if (!order.length) return '';
    return '미응시로 나갈 학생 — ' + order.map(function (g) { return (isCourse() ? Course.shortName(g) : g) + ' ' + by[g] + '명'; }).join(' · ');
  }

  $('#btnPublish').addEventListener('click', function () {
    var picked = state.rows.filter(function (r) { return r.checked; });
    if (!picked.length) return;
    (isCourse() ? askOpen(picked) : Promise.resolve(picked)).then(function (list) {
      if (list && list.length) confirmPublish(list);
    });
  });

  function confirmPublish(picked) {

    /* 정말 빠진 것만 한 줄 (막지는 않는다 · 개별 코멘트는 넣지 않는다) */
    var gap = Report.gapLine(picked.map(function (r) { return { name: r.student.name, common: r.common, entry: r.entry }; }));
    var ab = absentLine(picked.map(function (r) { return { student: r.student, data: Report.toReportData(r.student, r.common, r.entry, { start: state.week, end: state.weekEnd }) }; }));
    UI.confirmAsk('학부모에게 공개',
      picked.length + '명의 ' + whenText() + '를 공개합니다. 공개하면 바로 학생 개인 페이지에서 보입니다.' +
      (gap ? '\n\n' + gap + ' — 비어 있는 칸은 레포트에서 숨습니다.' : '') +
      (ab ? '\n\n' + ab : ''), '공개').then(function (ok) {
      if (!ok) return;
      var btn = $('#btnPublish');
      btn.disabled = true;
      btn.textContent = '공개하는 중…';
      showError('');

      var rows = picked.map(function (r) {
        return {
          studentId: r.student.id, name: r.student.name,
          data: Report.toReportData(r.student, r.common, r.entry, { start: state.week, end: state.weekEnd })
        };
      });
      var again = rows.filter(function (r) { return state.published[r.studentId]; }).map(function (r) { return r.studentId; });
      var changed = [];

      /* 다시 공개 — 지금 공개된 내용과 견줘 바뀐 것을 레포트 위에 「10/24 업데이트 · 복습테스트 결과 추가」로 남긴다 (20261030e) */
      /* 과정 — 기다리는 공통 내용 복사(영상 · 자료)를 먼저 (course.js) */
      (isCourse() ? Course.flush(curClass(), state.week) : Promise.resolve()).then(function () { return DB.publishedDataOf(state.week, again); }).then(function (old) {
        rows.forEach(function (r) {
          var o = old[r.studentId];
          if (!o) return;
          var ch = Report.changesOf(o, r.data);
          if (ch.length) {
            r.data._upd = { date: DDay.today(), what: ch.join(', ') };
            changed.push({ id: r.studentId, name: r.name, what: ch.join(', ') });
          } else if (o._upd) r.data._upd = o._upd;          /* 바뀐 게 없으면 지난 표시를 그대로 */
        });
        return DB.publishReports(state.week, rows, UI.whoami());
      }).then(function () {
        var all = Store.read(Store.KEYS.published, {});
        all[state.week] = all[state.week] || {};
        rows.forEach(function (r) { all[state.week][r.studentId] = { visible: true, publishedAt: new Date().toISOString() }; });
        Store.writeLocal(Store.KEYS.published, all);
        toast(rows.length + '명 공개했습니다. 레포트 발송 → 3 발송에서 링크를 보내세요', 'good');
        if (window.RTabs) RTabs.counts();           /* 단계 버튼 「2 공개 11/11 ✓」 바로 */
        return load().then(function () { return changed.length ? askNotify(changed) : null; });
      }).catch(function (e) {
        showError('공개하지 못했습니다 — ' + e.message);
        refreshButton();
      });
    });
    }

  /* ---------- 바뀐 내용 알리기 (20261030e) ----------
     이미 보낸 학생 중 다시 공개로 내용이 실제로 바뀐 학생만 — 학생마다 바뀐 것 한 줄 · 체크로 일부만
     [바뀐 학생에게 알리기] → 문자 창(바뀐 내용 알리기 · 보낼 곳 · 결과 표시는 일반 발송과 같다) · [알리지 않고 공개만] → 닫기 */
  var NOTIFY_BODY = '#{수업일} 수업 #{이름} 학생 레포트에 #{바뀐 내용}이 반영되었습니다. #{링크}';
  var notifyList = [];
  function askNotify(changed) {
    return DB.weekSendData(state.week).then(function (x) {
      notifyList = changed.filter(function (c) { return x.sent && x.sent[c.id]; });
      if (!notifyList.length) return;
      $('#notifyDesc').textContent = '이미 레포트를 보낸 학생 중 내용이 바뀐 ' + notifyList.length + '명입니다. 알릴 학생만 체크하세요.';
      $('#notifyList').innerHTML = notifyList.map(function (c) {
        return '<label class="notify-row"><input type="checkbox" data-nt="' + esc(c.id) + '" checked> <b>' + esc(c.name) + '</b> <span class="notify-row__what">' + esc(c.what) + '</span></label>';
      }).join('');
      $('#notifyModal').showModal();
    }, function () {});
  }
  $('#notifyNo').addEventListener('click', function () { $('#notifyModal').close(); toast('알리지 않고 공개만 했습니다'); });
  $('#notifyYes').addEventListener('click', function () {
    var ids = Array.prototype.map.call(document.querySelectorAll('#notifyList [data-nt]:checked'), function (b) { return b.dataset.nt; });
    if (!ids.length) { toast('알릴 학생을 하나 이상 체크해 주세요', 'bad'); return; }
    var what = {};
    notifyList.forEach(function (c) { if (ids.indexOf(c.id) !== -1) what[c.id] = c.what; });
    $('#notifyModal').close();
    setTimeout(function () {
      if (window.Sms) Sms.open({ students: ids, week: state.week, from: 'notify', notify: what, body: NOTIFY_BODY });
    }, 60);
  });

  /* 다음 단계로 — 「발송하러 가기 →」 */
  $('#btnGoSend').addEventListener('click', function () { UI.selectTab(3); });

  $('#btnPubRefresh').addEventListener('click', function () {
    load().then(function () { toast('다시 읽었습니다'); });
  });

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 2) load();
  });

  /* 레포트 발송 주차 띠에서 주를 바꾸면 (rtabs.js · 20261029a) */
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
