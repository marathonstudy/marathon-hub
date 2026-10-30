/* ============================================================
   attend.js — 출석 체크 (수업 시작할 때 · 20261031i · migration-037)

   「오늘」 반 카드(과정 카드는 그날 수업하는 반) · 레포트 발송 → 1 작성 위쪽의 [출석 체크]
     수업 당일과 다음 날만 「오늘」에 보인다 · 이미 했으면 「출석 체크 완료 · 결석 2 · 지각 1 · 고치기」
   누르면 그 반 학생 이름 타일 바둑판 (사진이 있으면 사진도) — 처음엔 전원 출석(흰색)
     한 번 누르면 빨간 「결석」 → 다시 누르면 주황 「지각」 → 또 누르면 출석
     결석 타일 아래 [✓ 자료 배부] [✓ 보강 영상 신청] — 기본으로 켜짐 · 아닌 경우만 눌러 「미배부」 「미신청」
     지각 타일 아래 지각 메모 칸 (레포트 학생 카드의 지각 메모와 같은 칸)
     위쪽 「출석 10 · 결석 2 · 지각 0 / 12」
   [저장] — 그 반 그 수업(주)의 출결로 저장한다. 레포트 학생 카드 출결과 같은 칸(entries)이다 (entry_patch)
     결석이면 집중도 0, 결석에서 출석 · 지각으로 바꾸면 집중도 5 (레포트 화면과 같은 규칙)
     「출석 체크 완료」는 attend_checks 한 줄 (누가 · 언제) · 출결을 바꾼 기록은 서버가 attend_log 에 남긴다
   자료 배부 · 보강 영상 신청은 코치룸에서만 쓴다 — 학부모 · 학생 레포트에는 넣지 않는다 (레포트 출결은 「결석」만)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find|schema cache|column/i.test((e && e.message) || ''); }
  function monday(d) { return Lesson.addDays(d, -((Lesson.dowOf(d) + 6) % 7)); }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); }
  var MISSING = '출석 체크 저장 칸이 아직 없습니다 — Supabase SQL Editor 에서 migration-037-attendance.sql 을 먼저 실행해 주세요';

  /* ---------- 「오늘」 · 챙길 학생 · 출석부가 같이 쓰는 기억 ----------
     checks  반|주 → 출석 체크 완료 줄 · rows  주|학생 → { s 결석/지각, m 자료 배부, k 보강 영상 신청 } (최근 10주 · 결석 · 지각만) */
  var cache = { checks: {}, rows: {}, cols: true, sql: true, loaded: false };
  function load() {
    if (!window.SB || !SB.client || !window.Lesson || !window.DDay) return Promise.resolve();
    var from = Lesson.addDays(DDay.today(), -70);
    var fill = function (r) {
      cache.rows = {};
      (r.data || []).forEach(function (x) {
        cache.rows[String(x.week_start).slice(0, 10) + '|' + x.student_id] = { s: x.attend_status, m: x.att_material !== false, k: x.att_makeup !== false };
      });
    };
    var q1 = sb().from('attend_checks').select('class_name,week_start,lesson_date,checked_name,checked_at').gte('week_start', from).then(function (r) {
      cache.checks = {};
      cache.sql = !r.error;
      (r.data || []).forEach(function (x) { cache.checks[x.class_name + '|' + String(x.week_start).slice(0, 10)] = x; });
    }, function () { cache.sql = false; });
    var q2 = sb().from('entries').select('student_id,week_start,attend_status,att_material,att_makeup').gte('week_start', from).in('attend_status', ['absent', 'late']).then(function (r) {
      if (!r.error) { cache.cols = true; fill(r); return; }
      cache.cols = false;                                                   /* 037 실행 전 — 결석 · 지각만 */
      return sb().from('entries').select('student_id,week_start,attend_status').gte('week_start', from).in('attend_status', ['absent', 'late']).then(fill, function () {});
    }, function () {});
    return Promise.all([q1, q2]).then(function () { cache.loaded = true; window.dispatchEvent(new CustomEvent('jt:attend')); });
  }

  /* 그 반 그 수업(주) 학생 — 퇴원일 뒤 수업이면 빠진다 */
  function studentsOf(cls, week) {
    return Store.activeStudents(week).filter(function (s) { return (s.className || '').trim() === cls; }).sort(byName);
  }
  /* 수업 당일 · 다음 날이면 그 수업일 (아니면 '') — 「오늘」 반 카드 */
  function dayFor(cls) {
    if (!cls || !window.Lesson || !window.DDay) return '';
    var T = DDay.today(), w0 = monday(T), D = '';
    [w0, Lesson.addDays(w0, -7)].some(function (w) {
      var L = Store.lessonOf(cls, w);
      if (L && L.date && !L.canceled && L.date <= T) { D = L.date; return true; }
      return false;
    });
    if (!D) return '';
    var sc = Store.schedOf(cls);
    if (sc && sc.first && D < String(sc.first).slice(0, 10)) return '';
    return D === T || Lesson.addDays(D, 1) === T ? D : '';
  }
  function stateOf(cls, date) {
    var week = monday(date), list = studentsOf(cls, week), ab = 0, la = 0;
    list.forEach(function (s) {
      var x = cache.rows[week + '|' + s.id];
      if (x && x.s === 'absent') ab++;
      if (x && x.s === 'late') la++;
    });
    return { checked: !!cache.checks[cls + '|' + week], row: cache.checks[cls + '|' + week] || null, absent: ab, late: la, total: list.length, week: week };
  }
  /* [출석 체크] · 「출석 체크 완료 · 결석 2 · 지각 1 · 고치기」 */
  function buttonHtml(cls, date, opts) {
    if (!cls || !date) return '';
    var x = stateOf(cls, date), when = date === DDay.today() ? '' : ' · ' + Store.dateWithDow(date) + ' 수업';
    if (!x.total) return '';
    var lab = (opts && opts.label) ? esc(opts.label) + ' ' : '';
    if (x.checked) {
      return '<button type="button" class="att-done" data-att-open="' + esc(cls) + '" data-att-date="' + esc(date) + '" title="' + esc((x.row.checked_name ? x.row.checked_name + ' · ' : '') + '누르면 고치기') + '">' +
        '<span class="att-done__ok" aria-hidden="true">✓</span> ' + lab + '출석 체크 완료' + esc(when) + ' · <b class="num">결석 ' + x.absent + '</b> · <b class="num">지각 ' + x.late + '</b> · <u>고치기</u></button>';
    }
    return '<button type="button" class="btn btn--primary att-go" data-att-open="' + esc(cls) + '" data-att-date="' + esc(date) + '">' + lab + '출석 체크' + esc(when) + '</button>';
  }

  /* ---------- 「챙길 학생」 — 자료 미배부 · 보강 영상 미신청 (반 + 수업마다 한 줄) ---------- */
  function careItems() {
    var out = [], grp = {}, order = [];
    if (!cache.cols) return out;
    var byId = {};
    Store.getStudents().forEach(function (s) { byId[s.id] = s; });
    Object.keys(cache.rows).forEach(function (k) {
      var x = cache.rows[k];
      if (x.s !== 'absent') return;
      var week = k.slice(0, 10), sid = k.slice(11), s = byId[sid];
      if (!s || !Store.isActiveOn(s)) return;
      var cls = (s.className || '').trim(), date = Store.lessonDayOf(s, week);
      if (Store.isEnded && Store.isEnded(cls)) return;                 /* 종강한 반은 빼기 (20261031w) */
      [['material', !x.m, '자료 미배부'], ['makeup', !x.k, '보강 영상 미신청']].forEach(function (t) {
        if (!t[1]) return;
        if (window.Skips && (Skips.checked(t[0], cls, date, '') || Skips.checked(t[0], cls, date, sid))) return;
        var g = t[0] + '|' + cls + '|' + date;
        if (!grp[g]) { grp[g] = { kind: t[0], cls: cls, date: date, week: week, ids: [], label: t[2] }; order.push(g); }
        grp[g].ids.push(sid);
      });
    });
    order.sort(function (a, b) { var x = grp[a], y = grp[b]; return x.date < y.date ? 1 : x.date > y.date ? -1 : x.cls.localeCompare(y.cls, 'ko') || (x.kind < y.kind ? 1 : -1); });
    order.forEach(function (g) {
      var it = grp[g];
      it.ids.sort(function (a, b) { return byName(byId[a], byId[b]); });
      out.push({ kind: it.kind, cls: it.cls, week: it.week, date: it.date, sid: it.ids[0], ids: it.ids,
        text: it.cls + ' · ' + Lesson.md(it.date, false) + ' 결석 · ' + it.label + ' ' + it.ids.length + '명',
        names: it.ids.map(function (id) { return byId[id].name; }) });
    });
    return out;
  }

  /* ============================================================
     출석 체크 창
     ============================================================ */
  var M = null;            /* { cls, date, week, list, cur: { sid: { s, note, m, k } }, orig: { sid: 서버 줄 }, focus, busy } */
  function modal() { return $('#attModal'); }

  function open(cls, date, focusSid) {
    if (!cls || !date || !modal()) return Promise.resolve();
    var week = monday(date), list = studentsOf(cls, week);
    M = { cls: cls, date: date, week: week, list: list, cur: {}, orig: {}, focus: focusSid || '', busy: true, loadErr: '' };
    list.forEach(function (s) { M.cur[s.id] = { s: 'attend', note: '', m: true, k: true }; });
    render();
    if (!modal().open) modal().showModal();
    var ids = list.map(function (s) { return s.id; });
    var mine = M;
    var cols = 'student_id,attend_status,attend_note,focus_score,att_material,att_makeup';
    var q = function (c) { return ids.length ? sb().from('entries').select(c).eq('week_start', week).in('student_id', ids) : Promise.resolve({ data: [] }); };
    return q(cols).then(function (r) {
      if (r.error && isMissing(r.error)) { cache.cols = false; return q('student_id,attend_status,attend_note,focus_score'); }
      return r;
    }).then(function (r) {
      if (mine !== M) return;
      if (r.error) { M.loadErr = r.error.message; }
      (r.data || []).forEach(function (x) {
        M.orig[x.student_id] = x;
        var s = x.attend_status === 'absent' || x.attend_status === 'late' ? x.attend_status : 'attend';
        M.cur[x.student_id] = { s: s, note: x.attend_note || '', m: x.att_material !== false, k: x.att_makeup !== false };
      });
      M.busy = false;
      render();
      if (M.focus) setTimeout(function () {
        var t = modal().querySelector('[data-att-cell="' + M.focus + '"]');
        if (!t) return;
        if (t.scrollIntoView) t.scrollIntoView({ block: 'center' });
        t.classList.add('is-flash');
      }, 30);
    }, function (e) { if (mine === M) { M.busy = false; M.loadErr = (e && e.message) || '불러오지 못했습니다'; render(); } });
  }

  function counts() {
    var c = { attend: 0, absent: 0, late: 0, n: M.list.length };
    M.list.forEach(function (s) { c[M.cur[s.id].s]++; });
    return c;
  }
  function countText() {
    var c = counts();
    return '출석 <b class="num">' + c.attend + '</b> · <span class="att-c--ab">결석 <b class="num">' + c.absent + '</b></span> · <span class="att-c--la">지각 <b class="num">' + c.late + '</b></span> <span class="att-c--n">/ <span class="num">' + c.n + '</span></span>';
  }
  var LABEL = { attend: '출석', absent: '결석', late: '지각' };
  function cellHtml(s) {
    var x = M.cur[s.id];
    var sub = '';
    if (x.s === 'absent' && cache.cols) {
      sub = '<div class="att-sub">' +
        /* 휴대폰에서는 짧게 「✓ 자료」 「✓ 영상」 (나란히 · 같은 뜻은 aria-label 에) */
        '<button type="button" class="att-opt' + (x.m ? ' is-on' : ' is-off') + '" data-att-m="' + esc(s.id) + '" aria-pressed="' + x.m + '" aria-label="' + (x.m ? '자료 배부함 · 누르면 미배부' : '자료 미배부 · 누르면 배부') + '">' +
          (x.m ? '<span class="att-lf">✓ 자료 배부</span><span class="att-ls">✓ 자료</span>' : '미배부') + '</button>' +
        '<button type="button" class="att-opt' + (x.k ? ' is-on' : ' is-off') + '" data-att-k="' + esc(s.id) + '" aria-pressed="' + x.k + '" aria-label="' + (x.k ? '보강 영상 신청함 · 누르면 미신청' : '보강 영상 미신청 · 누르면 신청') + '">' +
          (x.k ? '<span class="att-lf">✓ 보강 영상 신청</span><span class="att-ls">✓ 영상</span>' : '미신청') + '</button></div>';
    } else if (x.s === 'late') {
      sub = '<div class="att-sub"><input class="input att-note" type="text" data-att-note="' + esc(s.id) + '" value="' + esc(x.note) + '" placeholder="지각 메모 (예: 10분)" aria-label="' + esc(s.name) + ' 지각 메모"></div>';
    }
    return '<div class="att-cell att-cell--' + x.s + '" data-att-cell="' + esc(s.id) + '">' +
      '<button type="button" class="att-tile att-tile--' + x.s + '" data-att-tile="' + esc(s.id) + '" aria-label="' + esc(s.name + ' ' + LABEL[x.s] + ' · 누르면 바뀜') + '">' +
        (window.Profile ? Profile.avatar({ id: s.id, name: s.name }, 's') : '') +
        '<span class="att-tile__n">' + esc(s.name) + '</span>' +
        (x.s !== 'attend' ? '<span class="att-tile__s">' + LABEL[x.s] + '</span>' : '') +
      '</button>' + sub + '</div>';
  }
  function render() {
    var m = modal();
    if (!m || !M) return;
    var d = Store.dateWithDow(M.date);
    $('#attTitle').textContent = '출석 체크 · ' + M.cls + ' · ' + d + ' 수업';
    $('#attCount').innerHTML = countText();
    var x = stateOf(M.cls, M.date);
    $('#attHint').innerHTML = (x.checked ? '<span class="att-hint__done">✓ ' + esc((x.row.checked_name || '') + ' ' + fmt(x.row.checked_at)) + ' 체크함 · 고쳐서 다시 저장할 수 있습니다</span> · ' : '') +
      '결석 · 지각인 학생만 누르세요 — <b>한 번</b> 결석 · <b>두 번</b> 지각 · <b>세 번</b> 출석' +
      (!cache.sql ? ' <span class="att-warn">' + esc(MISSING) + '</span>' : '');
    var g = $('#attGrid');
    if (M.busy) g.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    else if (M.loadErr) g.innerHTML = '<p class="panel__hint">불러오지 못했습니다 — ' + esc(M.loadErr) + '</p>';
    else if (!M.list.length) g.innerHTML = '<p class="panel__hint">이 반에 학생이 없습니다.</p>';
    else {
      var a = document.activeElement, keep = a && a.matches && a.matches('[data-att-note]') ? [a.dataset.attNote, a.selectionStart] : null;
      g.innerHTML = M.list.map(cellHtml).join('');
      if (keep) { var n = g.querySelector('[data-att-note="' + keep[0] + '"]'); if (n) { n.focus(); try { n.setSelectionRange(keep[1], keep[1]); } catch (e) {} } }
    }
    $('#attSave').disabled = M.busy || !!M.loadErr || !M.list.length;
  }
  function fmt(v) { var t = v ? new Date(v) : null; return t && !isNaN(t) ? (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : ''; }

  var NEXT = { attend: 'absent', absent: 'late', late: 'attend' };
  function onClick(e) {
    if (!M) return;
    var t = e.target.closest('[data-att-tile]');
    if (t) { var x = M.cur[t.dataset.attTile]; x.s = NEXT[x.s]; render(); var nt = modal().querySelector('[data-att-tile="' + t.dataset.attTile + '"]'); if (nt) nt.focus(); return; }
    var mm = e.target.closest('[data-att-m]');
    if (mm) { M.cur[mm.dataset.attM].m = !M.cur[mm.dataset.attM].m; render(); return; }
    var kk = e.target.closest('[data-att-k]');
    if (kk) { M.cur[kk.dataset.attK].k = !M.cur[kk.dataset.attK].k; render(); return; }
  }
  function onInput(e) {
    if (!M || !e.target.matches('[data-att-note]')) return;
    M.cur[e.target.dataset.attNote].note = e.target.value;
  }

  /* 학생 한 명 — 바뀐 칸만 (레포트 학생 카드와 같은 저장 · 같은 규칙) */
  function patchOf(sid) {
    var x = M.cur[sid], o = M.orig[sid] || {}, set = {};
    var was = o.attend_status || '';
    if (x.s !== was && !(x.s === 'attend' && was === 'makeup')) set.attend_status = x.s;
    var note = x.s === 'late' ? x.note.trim() : '';
    if (note !== (o.attend_note || '')) set.attend_note = note;
    var f = o.focus_score || 0;
    if (x.s === 'absent' && f) set.focus_score = 0;
    else if (x.s !== 'absent' && (was === 'absent' || !f)) set.focus_score = 5;
    if (cache.cols && x.s === 'absent') {
      if (x.m !== (o.att_material !== false)) set.att_material = x.m;
      if (x.k !== (o.att_makeup !== false)) set.att_makeup = x.k;
    }
    return set;
  }
  function save() {
    if (!M || M.busy) return Promise.resolve();
    var mine = M;
    M.busy = true;
    $('#attSave').disabled = true;
    var todo = M.list.map(function (s) { return { sid: s.id, set: patchOf(s.id) }; }).filter(function (x) { return Object.keys(x.set).length; });
    var rows = [], i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve();
      var t = todo[i++];
      return DB.entryPatch(mine.week, t.sid, t.set, {}, true).then(function (res) { if (res && res.row) rows.push(res.row); return next(); });
    }
    return Promise.all([next(), next(), next(), next()]).then(function () {
      return sb().from('attend_checks').upsert({ class_name: mine.cls, week_start: mine.week, lesson_date: mine.date }, { onConflict: 'class_name,week_start' }).then(function (r) {
        if (r.error) toast(isMissing(r.error) ? MISSING : '출석 체크 완료 표시를 남기지 못했습니다 — ' + r.error.message, 'warn');
      });
    }).then(function () {
      /* 레포트 작성 화면이 같은 주를 열고 있으면 학생 카드 출결을 바로 바꾼다 (다른 기기에서 온 줄처럼 합친다) */
      var changed = rows.filter(function (r) { return Store.mergeRemoteEntry && Store.mergeRemoteEntry(r); }).map(function (r) { return r.student_id; });
      if (changed.length) window.dispatchEvent(new CustomEvent('jt:draft-remote', { detail: { entries: changed } }));
      var c = counts();
      if (modal().open) modal().close();
      M = null;
      toast(mine.cls + ' 출석 체크를 저장했습니다 · 결석 ' + c.absent + ' · 지각 ' + c.late, 'good');
      return load();
    }).then(function () {
      window.dispatchEvent(new CustomEvent('jt:remote', { detail: { table: 'entries', local: true } }));
    }).catch(function (e) {
      if (M === mine) { M.busy = false; render(); }
      toast('저장하지 못했습니다 — ' + ((e && e.message) || e), 'bad');
    });
  }

  function init() {
    var m = modal();
    if (!m) return;
    m.addEventListener('click', onClick);
    m.addEventListener('input', onInput);
    $('#attSave').addEventListener('click', save);
    $('#attCancel').addEventListener('click', function () { m.close(); });
    m.addEventListener('close', function () { M = null; });
    /* 어디서든 [출석 체크] · 「출석 체크 완료 · 고치기」 */
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-att-open]');
      if (!b) return;
      e.preventDefault();
      open(b.dataset.attOpen, b.dataset.attDate, b.dataset.attSid || '');
    });
    window.addEventListener('jt:loaded', function () { load(); });
    window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if ((t === 'attend_checks' || t === 'entries' || t === '*') && !(e.detail && e.detail.local)) load(); });
  }
  init();

  window.Attend = {
    load: load, open: open, save: save, dayFor: dayFor, stateOf: stateOf, buttonHtml: buttonHtml, careItems: careItems,
    studentsOf: studentsOf, monday: monday, md: md,
    hasCols: function () { return cache.cols; },
    rowOf: function (week, sid) { return cache.rows[week + '|' + sid] || null; },
    current: function () { return M; }
  };
})();
