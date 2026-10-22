/* ============================================================
   review.js — 주간 레포트 → 작성 「반 공통」 → 복습테스트 (migration-013 · 025 · 학생은 러닝노트에서 직접 기록)

   반 수업일마다 기본 시험들(「복습 TEST」 · 「화작문 TEST」, 반 관리에서 바꿈)이 서버에서 저절로 생긴다.
   모든 곳에서 「10/22(목) 복습 TEST」처럼 수업일 + 시험 이름으로 부른다 (회차는 쓰지 않는다).
   · 그 주 시험 줄: 시험마다 [이번 주 없음] · [다시 켜기], [+ 시험 추가](그 주만)
   · 확인 표: 학생 한 줄 — 시험마다 점수 · 상태(미제출/제출/확인) · [확인] [고치기] [대신 입력], 사진(여러 장)
     고치기 · 대신 입력은 시험마다 「전체 문항 수」 · 「틀린 개수」. 누가 · 언제 했는지 서버(review_log)에 남는다
     예전 기록(틀린 번호 방식)은 「복습 TEST」로 그대로 보인다
   · [지금 제출 현황]: 교실 화면용 — 이름 옆에 시험별 제출 여부만 (점수는 아예 불러오지 않는다)
   · [시험별 평균]: 반 단위, 최근 확인된 시험들의 평균 점수 (코치룸에서만)
   · [지난 시험지 사진 정리] — 점수는 남기고 사진만 지운다
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
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }
  var NEED_SQL = 'migration-025 SQL 을 먼저 실행해 주세요 (README 5-22).';
  var BUCKET = 'review-photos';
  var SHRINK = { maxSide: 1280, target: 150 * 1024 };

  var st = { cls: '', week: '', mon: '', key: '', data: null, missing: false, role: '', edit: null, live: null, liveTimer: null };

  function monday(iso) {
    if (!iso) return '';
    return Lesson.addDays(iso, -((Lesson.dowOf(iso) + 6) % 7));
  }
  function scoreText(s) { return s.correct + ' / ' + s.q_count + ' · ' + s.score + '점'; }
  function wrongN(s) { return s.wrong_n != null ? s.wrong_n : (s.wrong || []).length; }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function isTeacher() { return !!st.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */
  function label(t) { return t.label || (Lesson.md(String(t.lesson_date).slice(0, 10)) + ' ' + (t.test_name || '복습 TEST')); }

  /* ============================================================
     불러오기 · 그리기 — weekly.js 의 render 가 부른다
     ============================================================ */

  function render(cls, week) {
    if (!$('#rvSub')) return;
    var key = (cls || '') + '|' + monday(week);
    st.cls = cls || ''; st.week = week || ''; st.mon = monday(week);
    if (key !== st.key) { st.key = key; st.data = null; st.edit = null; draw(); load(); }
  }

  function load() {
    var key = st.key;
    if (!st.cls || !st.mon) { draw(); return Promise.resolve(); }
    return sb().rpc('review_week', { p_class: st.cls, p_week: st.mon }).then(function (r) {
      if (key !== st.key) return;
      st.missing = !!(r.error && isMissing(r.error));
      if (r.error && !st.missing) { toast('복습테스트를 불러오지 못했습니다 — ' + r.error.message, 'bad'); return; }
      var d = r.data || null;
      /* 025 전 함수(시험 하나) — 같은 모양으로 */
      if (d && !d.tests) {
        st.missing = true;
        d = null;
      }
      st.data = d;
      draw();
    });
  }

  function tests() { return (st.data && st.data.tests) || []; }
  function onTests() { return tests().filter(function (t) { return !t.off; }); }

  function draw() {
    var line = $('#rvLine'), tools = $('#rvTools'), host = $('#rvTable');
    if (!line) return;
    $('#btnRvLive').disabled = $('#btnRvStats').disabled = !st.cls;
    if (st.missing) { line.textContent = ''; tools.innerHTML = ''; host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    var d = st.data;
    if (!d) { line.textContent = st.cls ? '불러오는 중…' : ''; tools.innerHTML = ''; host.innerHTML = ''; return; }
    var all = tests(), on = onTests();
    if (!all.length) {
      line.textContent = Store.schedOf(st.cls) ? '이 주에는 수업일이 없습니다 (휴강 · 첫 수업 전)' : '수업 요일을 정하면 수업일마다 저절로 생깁니다';
      tools.innerHTML = isTeacher() ? cleanBtn() : '';
      host.innerHTML = '';
      return;
    }
    var rows = d.rows || [];
    var allDone = rows.filter(function (x) { return on.length && on.every(function (t) { return x.subs && x.subs[t.id]; }); }).length;
    var ok = 0;
    rows.forEach(function (x) { on.forEach(function (t) { var s = x.subs && x.subs[t.id]; if (s && s.status === 'confirmed') ok++; }); });
    var day = all[0].lesson_date;
    line.innerHTML = '<b>' + esc(Lesson.md(String(day).slice(0, 10))) + '</b> · ' + all.map(function (t) {
        return t.off ? '<s>' + esc(t.test_name) + '</s>' : '<b>' + esc(t.test_name) + '</b>';
      }).join(' · ') + ' · 마감 ' + esc(Lesson.md(String(day).slice(0, 10))) + ' 밤 12시' +
      ' <span class="muted-note">모두 제출 ' + allDone + ' / ' + rows.length + ' · 확인 ' + ok + '</span>';
    tools.innerHTML = all.map(function (t) {
        return t.off
          ? '<button class="btn btn--sm" type="button" data-rv="on" data-tid="' + esc(t.id) + '">' + esc(t.test_name) + ' 다시 켜기</button>'
          : '<button class="btn btn--sm btn--ghost" type="button" data-rv="off" data-tid="' + esc(t.id) + '">' + esc(t.test_name) + ' 이번 주 없음</button>';
      }).join('') +
      '<button class="btn btn--sm" type="button" data-rv="add">+ 시험 추가 (이번 주만)</button>' +
      (isTeacher() ? cleanBtn() : '');

    if (!on.length) { host.innerHTML = '<p class="panel__hint">이번 주 시험을 모두 껐습니다.</p>'; return; }
    if (!rows.length) { host.innerHTML = '<p class="panel__hint">이 반에 다니는 학생이 없습니다.</p>'; return; }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table rv-table"><thead><tr>' +
      '<th>학생</th>' + on.map(function (t) { return '<th>' + esc(label(t)) + '</th>'; }).join('') + '<th>사진</th></tr></thead><tbody>' +
      rows.map(function (x) { return rowHtml(x, on); }).join('') + '</tbody></table></div>';
  }

  function cleanBtn() { return '<button class="btn btn--sm btn--ghost" type="button" data-rv="clean">지난 시험지 사진 정리</button>'; }

  function stateHtml(s) {
    if (!s) return '<span class="rv-st rv-st--none">미제출</span>';
    if (s.status === 'confirmed') {
      return '<span class="rv-st rv-st--ok">확인</span> <span class="muted-note">' +
        (s.source === 'staff' ? '조교 입력 · ' : (s.edited_by ? '고침 · ' : '')) + esc(s.confirmed_by) + ' ' + fmtDT(s.confirmed_at) + '</span>';
    }
    return '<span class="rv-st rv-st--sub">제출</span> <span class="muted-note">학생 입력 · ' + fmtDT(s.submitted_at) + '</span>';
  }

  function photosOf(x) {
    var seen = {}, out = [];
    Object.keys(x.subs || {}).forEach(function (k) {
      ((x.subs[k] && x.subs[k].photos) || []).forEach(function (p) { if (p && !seen[p]) { seen[p] = 1; out.push(p); } });
    });
    return out;
  }

  function cellHtml(x, t) {
    var s = x.subs && x.subs[t.id];
    var acts = !s
      ? '<button class="btn btn--sm" type="button" data-rv="entry" data-tid="' + esc(t.id) + '">대신 입력</button>'
      : (s.status === 'confirmed'
          ? '<button class="btn btn--sm btn--ghost" type="button" data-rv="edit" data-tid="' + esc(t.id) + '">고치기</button>'
          : '<button class="btn btn--sm btn--primary" type="button" data-rv="confirm" data-tid="' + esc(t.id) + '">확인</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-rv="edit" data-tid="' + esc(t.id) + '">고치기</button>');
    return '<td class="rv-cell' + (s && s.status !== 'confirmed' ? ' is-pending' : '') + '">' +
      (s ? '<div class="num rv-cell__score">' + esc(scoreText(s)) + '</div>' +
           (s.mode === 'numbers' && (s.wrong || []).length ? '<div class="muted-note">틀린 번호 ' + esc(s.wrong.join(', ')) + '</div>' : '') : '') +
      '<div>' + stateHtml(s) + '</div>' +
      '<div class="tb-acts">' + acts + '</div></td>';
  }

  function rowHtml(x, on) {
    var editing = st.edit && st.edit.sid === x.student_id;
    var ph = photosOf(x);
    var tr = '<tr data-sid="' + esc(x.student_id) + '">' +
      '<td><span class="roster__name">' + esc(x.name) + '</span></td>' +
      on.map(function (t) { return cellHtml(x, t); }).join('') +
      '<td>' + (ph.length ? '<button class="btn btn--sm btn--ghost" type="button" data-rv="photo">사진 ' + ph.length + '장</button>' : '<span class="muted-note">없음</span>') + '</td></tr>';
    if (editing) tr += '<tr class="rv-edit-row" data-sid="' + esc(x.student_id) + '"><td colspan="' + (on.length + 2) + '">' + editorHtml() + '</td></tr>';
    return tr;
  }

  function editCheck(e) {
    var q = Number(e.q), w = Number(e.w);
    if (!/^\d+$/.test(String(e.q)) || q < 1 || q > 200) return { msg: '전체 문항 수를 1 ~ 200 으로 적어 주세요' };
    if (!/^\d+$/.test(String(e.w))) return { msg: '틀린 개수를 적어 주세요 (다 맞았으면 0)' };
    if (w > q) return { msg: '틀린 개수가 전체보다 많습니다' };
    return { ok: true, q: q, w: w, text: (q - w) + ' / ' + q + ' · ' + Math.round((q - w) / q * 100) + '점' };
  }

  function editorHtml() {
    var e = st.edit;
    var t = tests().find(function (x) { return x.id === e.tid; }) || {};
    var c = editCheck(e);
    return '<div class="rv-editor">' +
      '<div class="rv-editor__head"><b>' + esc(label(t)) + ' — ' + (e.mode === 'entry' ? '대신 입력' : '점수 고치기') + '</b></div>' +
      '<div class="rv-editor__in">' +
        '<label class="field"><span class="field__label">전체 문항 수</span><input class="input input--num" type="number" min="1" max="200" data-rv-eq value="' + esc(e.q) + '"></label>' +
        '<label class="field"><span class="field__label">틀린 개수</span><input class="input input--num" type="number" min="0" max="200" data-rv-ew value="' + esc(e.w) + '"></label>' +
        '<span class="num rv-editor__score" data-rv-escore>' + esc(c.ok ? c.text : c.msg) + '</span>' +
      '</div>' +
      (e.mode === 'entry'
        ? '<label class="btn btn--sm">시험지 사진 (선택 · 여러 장)<input type="file" accept="image/*" multiple data-rv-file hidden></label> <span class="muted-note" data-rv-photo-note>' +
            (e.blobs.length ? '사진 ' + e.blobs.length + '장 준비됨' : '사진 없이도 저장됩니다 · 「조교 입력」으로 표시') + '</span>'
        : '<span class="muted-note">저장하면 확인까지 함께 됩니다. 고치기 전 값과 고친 사람이 기록됩니다.</span>') +
      '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" data-rv="save">저장</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-rv="cancel">취소</button></div>' +
    '</div>';
  }

  function rowOf(sid) { return ((st.data && st.data.rows) || []).find(function (x) { return x.student_id === sid; }) || null; }
  function testOf(id) { return tests().find(function (t) { return t.id === id; }) || null; }

  /* ============================================================
     동작
     ============================================================ */

  function onClick(e) {
    var b = e.target.closest('[data-rv]');
    if (!b) return;
    var act = b.dataset.rv;
    var tr = b.closest('tr');
    var x = tr ? rowOf(tr.dataset.sid) : null;
    var t = b.dataset.tid ? testOf(b.dataset.tid) : null;
    var s = x && t && x.subs ? x.subs[t.id] : null;

    if (act === 'off' && t) {
      UI.confirmAsk('이번 주 없음', label(t) + ' 을(를) 끕니다. 학생 러닝노트 기록 카드에 이 시험이 뜨지 않습니다.', '끄기')
        .then(function (yes) { if (yes) call('review_test_set', { p_test: t.id, p_off: true }, label(t) + ' 을(를) 껐습니다'); });
    }
    if (act === 'on' && t) call('review_test_set', { p_test: t.id, p_off: false }, label(t) + ' 을(를) 다시 켰습니다');
    if (act === 'add') {
      var nm = window.prompt('이번 주(' + Lesson.md(String((tests()[0] || {}).lesson_date || st.mon).slice(0, 10)) + ')에만 더 넣을 시험 이름 (예: 어휘 TEST)', '');
      if (nm == null || !nm.trim()) return;
      call('review_test_add', { p_class: st.cls, p_week: st.mon, p_name: nm.trim() }, '「' + nm.trim() + '」을(를) 이번 주에 넣었습니다');
    }
    if (act === 'clean') cleanPhotos();
    if (act === 'confirm' && s) call('review_confirm', { p_sub: s.id }, x.name + ' ' + t.test_name + ' 확인했습니다');
    if (act === 'edit' && s) { st.edit = { sid: x.student_id, tid: t.id, mode: 'edit', q: String(s.q_count), w: String(wrongN(s)), blobs: [] }; draw(); focusEditor(); }
    if (act === 'entry' && x && t) { st.edit = { sid: x.student_id, tid: t.id, mode: 'entry', q: '', w: '', blobs: [] }; draw(); focusEditor(); }
    if (act === 'cancel') { st.edit = null; draw(); }
    if (act === 'save') save();
    if (act === 'photo' && x) showPhotos(photosOf(x));
  }

  function focusEditor() { var i = document.querySelector('#rvTable [data-rv-eq]'); if (i) try { i.focus(); } catch (er) {} }

  function onInput(e) {
    if (!st.edit) return;
    if (e.target.hasAttribute('data-rv-eq')) st.edit.q = e.target.value;
    else if (e.target.hasAttribute('data-rv-ew')) st.edit.w = e.target.value;
    else return;
    var c = editCheck(st.edit);
    var sc = document.querySelector('#rvTable [data-rv-escore]');
    if (sc) sc.textContent = c.ok ? c.text : c.msg;
  }

  function call(fn, args, okMsg) {
    return sb().rpc(fn, args).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return null; }
      if (okMsg) toast(okMsg, 'good');
      st.edit = null;
      return load().then(function () { return r.data; });
    });
  }

  function save() {
    var e = st.edit, x = rowOf(e.sid), t = testOf(e.tid);
    if (!x || !t) return;
    var c = editCheck(e);
    if (!c.ok) { toast(c.msg, 'bad'); return; }
    if (e.mode === 'edit') {
      call('review_edit2', { p_sub: x.subs[t.id].id, p_q: c.q, p_wrong: c.w }, x.name + ' ' + t.test_name + ' 점수를 고치고 확인했습니다');
      return;
    }
    var ups = e.blobs.map(function (blob) {
      var path = 'staff/' + x.student_id + '/' + String(t.lesson_date).slice(0, 10) + '/' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.jpg';
      return sb().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
        if (r.error) throw new Error('사진을 올리지 못했습니다 — ' + r.error.message);
        return { path: path, bytes: blob.size };
      });
    });
    Promise.all(ups).then(function (photos) {
      return call('review_staff_entry2', { p_test: t.id, p_student: x.student_id, p_q: c.q, p_wrong: c.w, p_photos: photos }, x.name + ' ' + t.test_name + ' 대신 입력했습니다 (조교 입력)');
    }).catch(function (err) { toast(err.message, 'bad'); });
  }

  function onChange(e) {
    if (e.target.dataset.rvFile == null || !st.edit) return;
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    files.reduce(function (p, f) {
      return p.then(function () { return Photos.shrink(f, SHRINK).then(function (s) { st.edit.blobs.push(s.blob); }); });
    }, Promise.resolve()).then(function () {
      var note = document.querySelector('#rvTable [data-rv-photo-note]');
      if (note) note.textContent = '사진 ' + st.edit.blobs.length + '장 준비됨';
    }).catch(function (err) { toast((err && err.message) || '사진을 열 수 없습니다', 'bad'); });
  }

  function showPhotos(paths) {
    if (!paths.length) return;
    sb().storage.from(BUCKET).createSignedUrls(paths, 600).then(function (r) {
      var urls = ((r && r.data) || []).map(function (x) { return x.signedUrl; }).filter(Boolean);
      if (r.error || !urls.length) { toast('사진을 열지 못했습니다', 'bad'); return; }
      var box = document.createElement('div');
      box.className = 'rv-light rv-light--many';
      box.innerHTML = urls.map(function (u, i) { return '<img alt="시험지 사진 ' + (i + 1) + '" src="' + esc(u) + '">'; }).join('') +
        '<button type="button" class="rv-light__close" aria-label="닫기">×</button>';
      box.addEventListener('click', function (ev) { if (ev.target.tagName !== 'IMG' || urls.length === 1) box.remove(); });
      box.querySelector('.rv-light__close').addEventListener('click', function () { box.remove(); });
      document.body.appendChild(box);
    });
  }

  /* ---------- 지난 시험지 사진 정리 ---------- */

  function cleanPhotos() {
    var def = Lesson.addDays(DDay.today(), -120);
    var v = window.prompt('이 날짜보다 앞선 수업의 시험지 사진을 지웁니다 (점수 기록은 남습니다). 날짜 (YYYY-MM-DD)', def);
    if (v == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('날짜를 YYYY-MM-DD 로 적어 주세요', 'bad'); return; }
    sb().rpc('review_photo_list', { p_before: v }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      var list = r.data || [];
      if (!list.length) { toast(Lesson.md(v) + ' 앞 시험지 사진이 없습니다'); return; }
      var paths = [], ids = [], seen = {}, bytes = 0;
      list.forEach(function (x) {
        if (ids.indexOf(x.id) === -1) ids.push(x.id);
        if (!seen[x.path]) { seen[x.path] = 1; paths.push(x.path); bytes += x.bytes || 0; }
      });
      var mb = (bytes / 1048576).toFixed(1);
      UI.confirmAsk('지난 시험지 사진 정리', '사진 ' + paths.length + '장 (' + mb + 'MB)을 지웁니다. 점수 기록은 그대로 남고, 되살릴 수 없습니다.', '지우기').then(function (yes) {
        if (!yes) return;
        var chunks = [];
        for (var i = 0; i < paths.length; i += 100) chunks.push(paths.slice(i, i + 100));
        chunks.reduce(function (p, part) {
          return p.then(function () {
            return sb().storage.from(BUCKET).remove(part).then(function (rr) { if (rr.error) throw new Error(rr.error.message); });
          });
        }, Promise.resolve()).then(function () {
          return sb().rpc('review_photo_clear', { p_ids: ids }).then(function (rr) { if (rr.error) throw new Error(rr.error.message); });
        }).then(function () {
          toast('시험지 사진 ' + paths.length + '장을 지웠습니다', 'good');
          load();
        }).catch(function (err) { toast('정리하지 못했습니다 — ' + err.message, 'bad'); });
      });
    });
  }

  /* ============================================================
     지금 제출 현황 (교실 화면) — 이름 옆에 시험별 제출 여부만
     ============================================================ */

  function openLive() {
    if (!st.cls) return;
    st.live = { cls: st.cls, mon: st.mon };
    $('#rvLive').hidden = false;
    document.body.classList.add('rv-live-open');
    loadLive();
    clearInterval(st.liveTimer);
    st.liveTimer = setInterval(loadLive, 8000);      /* 실시간이 끊겨도 8초마다 */
  }

  function closeLive() {
    $('#rvLive').hidden = true;
    document.body.classList.remove('rv-live-open');
    clearInterval(st.liveTimer); st.liveTimer = null; st.live = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  function loadLive() {
    var L = st.live;
    if (!L) return;
    sb().rpc('review_live', { p_class: L.cls, p_week: L.mon }).then(function (r) {
      if (!st.live) return;
      if (r.error) { $('#rvLiveGrid').innerHTML = '<p class="rv-live__msg">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      var d = r.data || {};
      var ts = d.tests || [];
      if (!ts.length) {
        $('#rvLiveTitle').textContent = L.cls + ' · 이번 주 복습테스트 없음';
        $('#rvLiveCount').textContent = '';
        $('#rvLiveGrid').innerHTML = '';
        return;
      }
      var rows = d.rows || [];
      var n = rows.filter(function (x) { return x.submitted; }).length;
      $('#rvLiveTitle').textContent = (d.class_name || L.cls) + ' · ' + Lesson.md(String(ts[0].lesson_date).slice(0, 10)) + ' ' + ts.map(function (t) { return t.test_name; }).join(' · ');
      $('#rvLiveCount').textContent = '모두 제출 ' + n + ' / ' + rows.length;
      $('#rvLiveGrid').innerHTML = rows.map(function (x) {
        var done = x.done || {};
        return '<div class="rv-live__cell' + (x.submitted ? ' is-done' : '') + '">' +
          '<span class="rv-live__name">' + esc(x.name) + '</span>' +
          '<span class="rv-live__tests">' + ts.map(function (t) {
            var ok = !!done[t.id];
            return '<span class="rv-live__t' + (ok ? ' is-ok' : '') + '">' + esc(t.test_name.replace(/ TEST$/, '')) + ' ' + (ok ? '✓' : '·') + '</span>';
          }).join('') + '</span>' +
          '<span class="sr-only">' + ts.map(function (t) { return t.test_name + (done[t.id] ? ' 제출' : ' 아직'); }).join(', ') + '</span></div>';
      }).join('');
    });
  }

  /* ============================================================
     시험별 평균 (반 단위 · 최근 확인된 시험들) — 「자주 틀린 번호」 대신 (migration-025)
     ============================================================ */

  function openStats() {
    if (!st.cls) return;
    $('#rvStatsTitle').textContent = st.cls + ' · 시험별 평균';
    $('#rvStatsBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    $('#rvStatsModal').showModal();
    sb().rpc('review_stats', { p_class: st.cls }).then(function (r) {
      if (r.error) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      var list = r.data || [];
      if (!list.length) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">아직 확인된 복습테스트 기록이 없습니다.</p>'; return; }
      $('#rvStatsBody').innerHTML = list.map(function (t) {
        var avg = t.avg == null ? 0 : Number(t.avg);
        return '<div class="rv-bar rv-bar--avg"><span class="rv-bar__q">' + esc(t.label || t.test_name) + '</span>' +
          '<span class="rv-bar__track"><span class="rv-bar__fill" style="width:' + avg + '%"></span></span>' +
          '<span class="rv-bar__v num">' + (t.avg == null ? '—' : t.avg + '점') + ' · ' + t.n + '명</span></div>';
      }).join('');
    });
  }

  /* ============================================================
     시작
     ============================================================ */

  function bind() {
    if (!$('#rvSub')) return;
    $('#rvSub').addEventListener('click', onClick);
    $('#rvSub').addEventListener('change', onChange);
    $('#rvSub').addEventListener('input', onInput);
    $('#btnRvLive').addEventListener('click', openLive);
    $('#btnRvLiveClose').addEventListener('click', closeLive);
    $('#btnRvLiveFull').addEventListener('click', function () {
      var el = $('#rvLive');
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.live) closeLive(); });
    $('#btnRvStats').addEventListener('click', openStats);
    $('#btnRvStatsClose').addEventListener('click', function () { $('#rvStatsModal').close(); });

    /* 학생이 내면 실시간 (sync.js) — 현황 화면은 바로, 표는 고치는 중이 아닐 때 */
    window.addEventListener('jt:remote', function (e) {
      var t = e.detail && e.detail.table;
      if (t !== 'review_submissions' && t !== 'review_tests') return;
      if (st.live) loadLive();
      if (st.key && !st.edit) load();
    });
    window.addEventListener('jt:schedule-changed', function () { if (st.key) load(); });
    window.addEventListener('jt:loaded', function () {
      st.key = '';
      DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; draw(); });
    });
  }

  bind();

  window.Review = { render: render, reload: load, openLive: openLive };

})();
