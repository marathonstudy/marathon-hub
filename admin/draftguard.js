/* ============================================================
   draftguard.js — 주간 레포트 → 작성 글 지키기 (유실 방지 화면 부분)

   · 다른 사람이 내가 고치는 중(또는 아직 저장 안 된) 칸을 바꾸면 덮어쓰지 않고 알린다
     「다른 사람이 이 칸을 수정했습니다 [그 내용 보기]」 → [그 내용으로 바꾸기] / [내 내용 유지]
     어느 쪽이든 바뀌기 전 글은 서버 [이전 내용]에 남는다 (migration-014)
   · 화면이 멈췄다 다시 열리면 「저장 안 된 내용이 있습니다 [복구]」 (이 기기 브라우저 임시 보관 · store.js)
   · 칸마다 [이전 내용 보기] — 최근 저장본을 보고 되살린다
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
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
  function week() { var d = window.Writer && Writer.current(); return (d && d.weekStart) || ''; }
  function studentName(id) { var s = Store.getStudents().find(function (x) { return x.id === id; }); return s ? s.name : '학생'; }
  function label(kind, id, key) {
    return (kind === 'entry' ? studentName(id) + ' 학생 ' : id + ' 반 공통 ') + ((Store.KEY_LABEL || {})[key] || key);
  }
  /* 값 → 보여 줄 글 (수업 내용 · 테스트 · 과제는 목록) */
  function textOf(v) {
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === 'object' && x ? (x.name || '') : String(x || ''); }).filter(Boolean).join('\n');
    return String(v == null ? '' : v);
  }
  function serverValue(kind, row, key) {
    if (!row) return '';
    if (kind === 'entry') return key === 'attend_note' ? (row.attend_note || '') : (row[key] == null ? '' : row[key]);
    return row[key] == null ? (key === 'comment' ? '' : []) : row[key];
  }
  function localValue(kind, id, key) {
    if (!window.Writer) return '';
    if (kind === 'entry') { var e = Writer.entryOf(id); return key === 'attend_note' ? (e.attendNote || '') : (e[key] || ''); }
    return Writer.commonOf(id)[key];
  }
  /* 바뀌기 전 글을 서버 [이전 내용]에 남긴다 (014 를 아직 안 돌렸으면 조용히 건너뛴다) */
  function keepHistory(kind, id, key, value) {
    if (!textOf(value).trim()) return Promise.resolve();
    return sb().rpc('text_history_add', { p_week: week(), p_kind: kind, p_target: id, p_field: key, p_value: value })
      .then(function () {}, function () {});
  }

  /* ============================================================
     다른 사람이 고친 칸 알림
     ============================================================ */

  var notes = [];       /* { kind, id, key, row } */

  function addNote(d) {
    (d.keys || []).forEach(function (key) {
      var i = notes.findIndex(function (n) { return n.kind === d.kind && n.id === d.id && n.key === key; });
      var n = { kind: d.kind, id: d.id, key: key, row: d.row };
      if (i >= 0) notes[i] = n; else notes.push(n);
    });
    renderNotes();
  }

  function renderNotes() {
    var host = $('#draftNotes');
    if (!host) return;
    host.innerHTML = notes.map(function (n, i) {
      return '<div class="dn">' +
        '<span class="dn__msg">⚠️ 다른 사람이 이 칸을 수정했습니다 — <b>' + esc(label(n.kind, n.id, n.key)) + '</b></span>' +
        '<button class="btn btn--sm" type="button" data-dn="view" data-i="' + i + '">그 내용 보기</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-dn="close" data-i="' + i + '" aria-label="알림 닫기">×</button>' +
      '</div>';
    }).join('');
  }

  var viewing = null;
  function openView(i) {
    viewing = notes[i];
    if (!viewing) return;
    var v = viewing;
    var dlg = $('#draftNoteView');
    $('#dnvTitle').textContent = label(v.kind, v.id, v.key);
    $('#dnvTheirs').textContent = textOf(serverValue(v.kind, v.row, v.key)) || '(비어 있음)';
    $('#dnvMine').textContent = textOf(localValue(v.kind, v.id, v.key)) || '(비어 있음)';
    dlg.showModal();
  }

  function closeNote(n) {
    notes = notes.filter(function (x) { return x !== n; });
    renderNotes();
  }

  /* [그 내용으로 바꾸기] — 내 글은 [이전 내용]에 남기고 그 사람 글로 */
  function take() {
    var n = viewing;
    if (!n) return;
    $('#draftNoteView').close();
    keepHistory(n.kind, n.id, n.key, localValue(n.kind, n.id, n.key)).then(function () {
      var a = document.activeElement;
      if (a && a.blur && a.closest && a.closest('#panel-write')) a.blur();
      Store.acceptRemote(n.kind, n.id, [n.key], n.row);
      var m = Writer.modal();
      if (m && n.key === 'comment' && ((n.kind === 'entry' && !m.isClass && m.id === n.id) || (n.kind === 'common' && m.isClass && m.cls === n.id))) {
        Writer.setModalText(textOf(serverValue(n.kind, n.row, n.key)));
      }
      Writer.refresh();
      closeNote(n);
      toast('그 내용으로 바꿨습니다. 내가 쓴 글은 [이전 내용 보기]에 있습니다', 'good');
    });
  }

  /* [내 내용 유지] — 그 사람 글은 [이전 내용]에 남기고 내 글로 저장 */
  function keep() {
    var n = viewing;
    if (!n) return;
    $('#draftNoteView').close();
    keepHistory(n.kind, n.id, n.key, serverValue(n.kind, n.row, n.key)).then(function () {
      Store.keepMine(n.kind, n.id, [n.key], n.row);
      closeNote(n);
      toast('내 글로 저장합니다. 그 사람 글은 [이전 내용 보기]에 있습니다');
    });
  }

  /* ============================================================
     저장 안 된 내용 복구 (이 기기 임시 보관)
     ============================================================ */

  var pending = null;

  function checkRestore() {
    pending = Store.takePendingBackup();
    renderRestore();
  }

  function renderRestore() {
    var bar = $('#draftRestore');
    if (!bar) return;
    if (!pending) { bar.hidden = true; bar.innerHTML = ''; return; }
    var other = pending.week !== week();
    bar.hidden = false;
    bar.innerHTML = '<span class="dr__msg">💾 저장 안 된 내용이 있습니다 — ' + pending.n + '칸 · ' + fmtDT(pending.at) +
      (other ? ' · ' + esc(Store.lessonLabel(window.Writer && Writer.currentClass ? Writer.currentClass() : '', pending.week)) : '') + '</span>' +
      '<button class="btn btn--sm btn--primary" type="button" data-dr="restore">' + (other ? '그 수업 열고 복구' : '복구') + '</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-dr="discard">버리기</button>';
  }

  function restore() {
    var p = pending;
    if (!p) return;
    var go = Writer.openWeek ? Writer.openWeek(p.week) : (p.week !== week() ? Writer.switchWeek(p.week, 0) : Promise.resolve());
    go.then(function () {
      return Store.applyBackup(p);
    }).then(function (ok) {
      if (!ok) { toast('복구하지 못했습니다 — 주차를 확인해 주세요', 'bad'); return; }
      pending = null;
      renderRestore();
      Writer.refresh();
      toast('저장 안 된 내용을 복구해 저장했습니다', 'good');
    });
  }

  function discard() {
    UI.confirmAsk('임시 보관 버리기', '이 기기에 남아 있던 저장 안 된 내용(' + pending.n + '칸)을 버립니다.', '버리기').then(function (yes) {
      if (!yes) return;
      Store.discardBackup();
      pending = null;
      renderRestore();
    });
  }

  /* ============================================================
     [이전 내용 보기] — 그 칸의 최근 저장본
     ============================================================ */

  var hist = { kind: '', id: '', key: '', list: [] };
  var REASON = { shrink: '크게 줄기 전', auto: '자동 보관', replaced: '다른 글로 바뀌기 전' };

  function openHistory(kind, id, key) {
    if (!id || !week()) return;
    hist = { kind: kind, id: id, key: key, list: [] };
    $('#thTitle').textContent = '이전 내용 — ' + label(kind, id, key);
    $('#thBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    $('#textHistoryModal').showModal();
    sb().rpc('text_history_list', { p_week: week(), p_kind: kind, p_target: id, p_field: key }).then(function (r) {
      if (r.error) {
        $('#thBody').innerHTML = '<p class="panel__hint">' + (/Could not find the function|schema cache/i.test(r.error.message) ? 'migration-014 SQL 을 먼저 실행해 주세요.' : esc(r.error.message)) + '</p>';
        return;
      }
      hist.list = r.data || [];
      $('#thBody').innerHTML = hist.list.length ? hist.list.map(function (h, i) {
        return '<div class="th-item">' +
          '<div class="th-item__head"><b>' + fmtDT(h.at) + '</b> · ' + esc(h.by_name || '') + ' · ' + esc(REASON[h.reason] || '') + ' · ' + h.chars + '자' +
          '<button class="btn btn--sm" type="button" data-th="restore" data-i="' + i + '">되살리기</button></div>' +
          '<div class="th-item__text">' + esc(textOf(h.value)) + '</div>' +
        '</div>';
      }).join('') : '<p class="panel__hint">아직 남은 이전 내용이 없습니다. (글이 크게 줄거나, 같은 칸을 10분 넘게 고칠 때마다 남습니다)</p>';
    });
  }

  function restoreHistory(i) {
    var h = hist.list[i];
    if (!h) return;
    var v = h.value;
    var cur = localValue(hist.kind, hist.id, hist.key);
    keepHistory(hist.kind, hist.id, hist.key, cur).then(function () {
      $('#textHistoryModal').close();
      var m = Writer.modal();
      if (hist.key === 'comment' && m && ((hist.kind === 'entry' && !m.isClass && m.id === hist.id) || (hist.kind === 'common' && m.isClass && m.cls === hist.id))) {
        Writer.setModalText(textOf(v));
      } else if (hist.kind === 'entry') {
        var e = Writer.entryOf(hist.id);
        if (hist.key === 'attend_note') e.attendNote = textOf(v); else e.comment = textOf(v);
        Writer.save();
        Writer.replaceCard(hist.id);
      } else {
        var a = document.activeElement;
        if (a && a.blur && a.closest && a.closest('#commonPanel')) a.blur();
        Writer.commonOf(hist.id)[hist.key] = hist.key === 'comment' ? textOf(v) : (Array.isArray(v) ? v : []);
        Writer.save();
        Writer.renderCommon();
      }
      toast('이전 내용을 되살렸습니다 (지금 글은 [이전 내용]에 남겼습니다)', 'good');
    });
  }

  /* ============================================================
     시작
     ============================================================ */

  function bind() {
    if (!$('#draftNotes')) return;
    window.addEventListener('jt:draft-others', function (e) { addNote(e.detail || {}); });
    $('#draftNotes').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dn]');
      if (!b) return;
      if (b.dataset.dn === 'view') openView(+b.dataset.i);
      if (b.dataset.dn === 'close') closeNote(notes[+b.dataset.i]);
    });
    $('#draftNoteView').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dn]');
      if (!b) return;
      if (b.dataset.dn === 'take') take();
      if (b.dataset.dn === 'keep') keep();
      if (b.dataset.dn === 'later') $('#draftNoteView').close();
    });
    $('#draftRestore').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dr]');
      if (!b) return;
      if (b.dataset.dr === 'restore') restore();
      if (b.dataset.dr === 'discard') discard();
    });
    $('#btnCommonHistory').addEventListener('click', function () {
      var cls = Writer.currentClass && Writer.currentClass();
      openHistory('common', cls, 'comment');
    });
    $('#btnLessonHistory').addEventListener('click', function () {
      var cls = Writer.currentClass && Writer.currentClass();
      openHistory('common', cls, 'lessons');
    });
    $('#btnCommentHistory').addEventListener('click', function () {
      var m = Writer.modal();
      if (!m) return;
      if (m.isClass) openHistory('common', m.cls, 'comment'); else openHistory('entry', m.id, 'comment');
    });
    $('#thBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-th="restore"]');
      if (b) restoreHistory(+b.dataset.i);
    });
    $('#btnThClose').addEventListener('click', function () { $('#textHistoryModal').close(); });
    /* 주차를 바꾸면 그 주차에 맞게 */
    window.addEventListener('jt:loaded', function () { notes = []; renderNotes(); });
  }

  bind();

  window.DraftGuard = { checkRestore: checkRestore, openHistory: openHistory };

})();
