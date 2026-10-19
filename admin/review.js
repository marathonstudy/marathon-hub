/* ============================================================
   review.js — ② 작성 「반 공통」 → 복습테스트 (migration-013 · 학생은 러닝노트에서 직접 기록)

   · 그 주 시험 줄: 「복습테스트 n회 · 수업일 · 문항 수 · 마감」 / [문항 수] [이번 주 없음]
     (시험은 반 수업일마다 서버가 저절로 만든다. 반 기본 문항 수는 [반 관리])
   · 확인 표: 학생 · 점수 · 틀린 번호 · 사진 · 상태(미제출/제출/확인) · [확인] [고치기] [대신 입력]
     고치기 · 대신 입력은 누가 · 언제 했는지 서버(review_log)에 남는다
   · [지금 제출 현황]: 교실 화면용 — 이름과 제출 여부만 (점수는 아예 불러오지 않는다), 실시간으로 초록색
   · [자주 틀린 번호]: 반 단위, 최근 4회 확인된 기록 (코치룸에서만)
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
  var NEED_SQL = 'migration-013 SQL 을 먼저 실행해 주세요 (README 5-10).';
  var BUCKET = 'review-photos';
  var SHRINK = { maxSide: 1280, target: 150 * 1024 };

  var st = { cls: '', week: '', mon: '', key: '', data: null, missing: false, role: '', edit: null, live: null, liveTimer: null };

  function monday(iso) {
    if (!iso) return '';
    return Lesson.addDays(iso, -((Lesson.dowOf(iso) + 6) % 7));
  }
  function scoreText(s) { return s.correct + ' / ' + s.q_count + ' · ' + s.score + '점'; }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function isTeacher() { return !!st.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */

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
      st.data = r.data || null;
      draw();
    });
  }

  function draw() {
    var line = $('#rvLine'), tools = $('#rvTools'), host = $('#rvTable');
    if (!line) return;
    $('#btnRvLive').disabled = $('#btnRvStats').disabled = !st.cls;
    if (st.missing) { line.textContent = ''; tools.innerHTML = ''; host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    var d = st.data;
    if (!d) { line.textContent = st.cls ? '불러오는 중…' : ''; tools.innerHTML = ''; host.innerHTML = ''; return; }
    var t = d.test;
    if (!t) {
      line.textContent = Store.schedOf(st.cls) ? '이 주에는 수업일이 없습니다 (휴강 · 첫 수업 전)' : '수업 요일을 정하면 수업일마다 저절로 생깁니다';
      tools.innerHTML = isTeacher() ? cleanBtn() : '';
      host.innerHTML = '';
      return;
    }
    if (t.off) {
      line.innerHTML = '<span class="ai-badge">이번 주 없음</span>';
      tools.innerHTML = '<button class="btn btn--sm" type="button" data-rv="on">다시 켜기</button>' + (isTeacher() ? cleanBtn() : '');
      host.innerHTML = '';
      return;
    }
    var rows = d.rows || [];
    var done = rows.filter(function (x) { return x.submission; }).length;
    var ok = rows.filter(function (x) { return x.submission && x.submission.status === 'confirmed'; }).length;
    line.innerHTML = '<b>복습테스트 ' + t.round_no + '회</b> · ' + Lesson.md(t.lesson_date) + ' · ' + t.q_count + '문항 · 마감 ' + Lesson.md(t.lesson_date) + ' 밤 12시' +
      ' <span class="muted-note">제출 ' + done + ' / ' + rows.length + ' · 확인 ' + ok + '</span>';
    tools.innerHTML =
      '<button class="btn btn--sm" type="button" data-rv="q">문항 수 (' + t.q_count + ')</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-rv="off">이번 주 없음</button>' +
      (isTeacher() ? cleanBtn() : '');

    if (!rows.length) { host.innerHTML = '<p class="panel__hint">이 반에 다니는 학생이 없습니다.</p>'; return; }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table rv-table"><thead><tr>' +
      '<th>학생</th><th>점수</th><th>틀린 번호</th><th>사진</th><th>상태</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) { return rowHtml(x, t); }).join('') + '</tbody></table></div>';
  }

  function cleanBtn() { return '<button class="btn btn--sm btn--ghost" type="button" data-rv="clean">지난 시험지 사진 정리</button>'; }

  function stateHtml(s) {
    if (!s) return '<span class="rv-st rv-st--none">미제출</span>';
    if (s.status === 'confirmed') {
      return '<span class="rv-st rv-st--ok">확인</span><br><span class="muted-note">' +
        (s.source === 'staff' ? '조교 입력 · ' : (s.edited_by ? '고침 · ' : '')) + esc(s.confirmed_by) + ' ' + fmtDT(s.confirmed_at) + '</span>';
    }
    return '<span class="rv-st rv-st--sub">제출</span><br><span class="muted-note">학생 입력 · ' + fmtDT(s.submitted_at) + '</span>';
  }

  function rowHtml(x, t) {
    var s = x.submission;
    var editing = st.edit && st.edit.sid === x.student_id;
    var acts = !s
      ? '<button class="btn btn--sm" type="button" data-rv="entry">대신 입력</button>'
      : (s.status === 'confirmed'
          ? '<button class="btn btn--sm btn--ghost" type="button" data-rv="edit">고치기</button>'
          : '<button class="btn btn--sm btn--primary" type="button" data-rv="confirm">확인</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" data-rv="edit">고치기</button>');
    var tr = '<tr data-sid="' + esc(x.student_id) + '"' + (s && s.status !== 'confirmed' ? ' class="is-pending"' : '') + '>' +
      '<td><span class="roster__name">' + esc(x.name) + '</span></td>' +
      '<td class="num">' + (s ? esc(scoreText(s)) : '—') + '</td>' +
      '<td>' + (s ? ((s.wrong || []).length ? esc(s.wrong.join(', ')) : '<span class="muted-note">없음</span>') : '') + '</td>' +
      '<td>' + (s && s.photo_path ? '<button class="btn btn--sm btn--ghost" type="button" data-rv="photo">사진 보기</button>' : (s ? '<span class="muted-note">없음</span>' : '')) + '</td>' +
      '<td>' + stateHtml(s) + '</td>' +
      '<td class="roster__actions tb-acts">' + (editing ? '' : acts) + '</td></tr>';
    if (editing) tr += '<tr class="rv-edit-row" data-sid="' + esc(x.student_id) + '"><td colspan="6">' + editorHtml(t) + '</td></tr>';
    return tr;
  }

  function editorHtml(t) {
    var e = st.edit;
    var nums = '';
    for (var i = 1; i <= t.q_count; i++) {
      nums += '<button type="button" class="rv-n' + (e.wrong[i] ? ' is-wrong' : '') + '" data-rv-n="' + i + '">' + i + '</button>';
    }
    var w = Object.keys(e.wrong).filter(function (k) { return e.wrong[k]; }).length;
    var c = t.q_count - w;
    return '<div class="rv-editor">' +
      '<div class="rv-editor__head"><b>' + (e.mode === 'entry' ? '대신 입력' : '점수 고치기') + '</b> — 틀린 번호를 누르세요 ' +
        '<span class="num rv-editor__score">' + c + ' / ' + t.q_count + ' · ' + Math.round(c / t.q_count * 100) + '점</span></div>' +
      '<div class="rv-ns">' + nums + '</div>' +
      (e.mode === 'entry'
        ? '<label class="btn btn--sm">시험지 사진 (선택)<input type="file" accept="image/*" data-rv-file hidden></label> <span class="muted-note" data-rv-photo-note>' + (e.blob ? '사진 준비됨' : '사진 없이도 저장됩니다 · 「조교 입력」으로 표시') + '</span>'
        : '<span class="muted-note">저장하면 확인까지 함께 됩니다. 고치기 전 값과 고친 사람이 기록됩니다.</span>') +
      '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" data-rv="save">저장</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-rv="cancel">취소</button></div>' +
    '</div>';
  }

  function rowOf(sid) { return ((st.data && st.data.rows) || []).find(function (x) { return x.student_id === sid; }) || null; }

  /* ============================================================
     동작
     ============================================================ */

  function onClick(e) {
    var n = e.target.closest('[data-rv-n]');
    if (n && st.edit) {
      var k = Number(n.dataset.rvN);
      st.edit.wrong[k] = !st.edit.wrong[k];
      draw();
      return;
    }
    var b = e.target.closest('[data-rv]');
    if (!b) return;
    var act = b.dataset.rv;
    var tr = b.closest('tr');
    var x = tr ? rowOf(tr.dataset.sid) : null;
    var t = st.data && st.data.test;

    if (act === 'q') {
      var v = window.prompt('이번 주(' + Lesson.md(t.lesson_date) + ') 복습테스트 문항 수', String(t.q_count));
      if (v == null) return;
      setTest(Math.round(Number(v)), null);
    }
    if (act === 'off') {
      UI.confirmAsk('이번 주 없음', Lesson.md(t.lesson_date) + ' 복습테스트를 끕니다. 학생 러닝노트에 기록 카드가 뜨지 않고, 회차에서도 빠집니다.', '끄기')
        .then(function (yes) { if (yes) setTest(null, true); });
    }
    if (act === 'on') setTest(null, false);
    if (act === 'clean') cleanPhotos();
    if (act === 'confirm' && x) call('review_confirm', { p_sub: x.submission.id }, x.name + ' 확인했습니다');
    if (act === 'edit' && x) { st.edit = { sid: x.student_id, mode: 'edit', wrong: toMap(x.submission.wrong), blob: null }; draw(); }
    if (act === 'entry' && x) { st.edit = { sid: x.student_id, mode: 'entry', wrong: {}, blob: null }; draw(); }
    if (act === 'cancel') { st.edit = null; draw(); }
    if (act === 'save') save();
    if (act === 'photo' && x) showPhoto(x.submission.photo_path);
  }

  function toMap(list) { var m = {}; (list || []).forEach(function (n) { m[n] = true; }); return m; }
  function wrongList() { return Object.keys(st.edit.wrong).filter(function (k) { return st.edit.wrong[k]; }).map(Number).sort(function (a, b) { return a - b; }); }

  function call(fn, args, okMsg) {
    return sb().rpc(fn, args).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return null; }
      if (okMsg) toast(okMsg, 'good');
      st.edit = null;
      return load().then(function () { return r.data; });
    });
  }

  function setTest(q, off) {
    if (q != null && !(q >= 1 && q <= 100)) { toast('문항 수는 1 ~ 100 으로 적어 주세요', 'bad'); return; }
    call('review_set', { p_class: st.cls, p_week: st.mon, p_q: q, p_off: off },
      off === true ? '이번 주 복습테스트를 껐습니다' : off === false ? '다시 켰습니다' : '문항 수를 ' + q + '개로 바꿨습니다');
  }

  function save() {
    var e = st.edit, x = rowOf(e.sid), t = st.data.test;
    if (!x) return;
    if (e.mode === 'edit') {
      call('review_edit', { p_sub: x.submission.id, p_wrong: wrongList() }, x.name + ' 점수를 고치고 확인했습니다');
      return;
    }
    var up = e.blob
      ? (function () {
          var path = 'staff/' + x.student_id + '/' + t.lesson_date + '/' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()) + '.jpg';
          return sb().storage.from(BUCKET).upload(path, e.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
            if (r.error) throw new Error('사진을 올리지 못했습니다 — ' + r.error.message);
            return { path: path, bytes: e.blob.size };
          });
        })()
      : Promise.resolve({ path: null, bytes: 0 });
    up.then(function (p) {
      return call('review_staff_entry', { p_test: t.id, p_student: x.student_id, p_wrong: wrongList(), p_path: p.path, p_bytes: p.bytes }, x.name + ' 대신 입력했습니다 (조교 입력)');
    }).catch(function (err) { toast(err.message, 'bad'); });
  }

  function onChange(e) {
    if (e.target.dataset.rvFile == null || !st.edit) return;
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    Photos.shrink(f, SHRINK).then(function (s) {
      st.edit.blob = s.blob;
      var note = document.querySelector('#rvTable [data-rv-photo-note]');
      if (note) note.textContent = '사진 준비됨 (' + Math.round(s.blob.size / 1024) + 'KB)';
    }).catch(function (err) { toast((err && err.message) || '사진을 열 수 없습니다', 'bad'); });
  }

  function showPhoto(path) {
    sb().storage.from(BUCKET).createSignedUrl(path, 600).then(function (r) {
      if (r.error || !r.data) { toast('사진을 열지 못했습니다', 'bad'); return; }
      var box = document.createElement('div');
      box.className = 'rv-light';
      box.innerHTML = '<img alt="시험지 사진"><button type="button" class="rv-light__close" aria-label="닫기">×</button>';
      box.querySelector('img').src = r.data.signedUrl;
      box.addEventListener('click', function () { box.remove(); });
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
      var mb = (list.reduce(function (a, x) { return a + (x.bytes || 0); }, 0) / 1048576).toFixed(1);
      UI.confirmAsk('지난 시험지 사진 정리', '사진 ' + list.length + '장 (' + mb + 'MB)을 지웁니다. 점수 · 틀린 번호 기록은 그대로 남고, 되살릴 수 없습니다.', '지우기').then(function (yes) {
        if (!yes) return;
        var chunks = [];
        for (var i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
        chunks.reduce(function (p, part) {
          return p.then(function () {
            return sb().storage.from(BUCKET).remove(part.map(function (x) { return x.path; })).then(function (rr) {
              if (rr.error) throw new Error(rr.error.message);
              return sb().rpc('review_photo_clear', { p_ids: part.map(function (x) { return x.id; }) });
            }).then(function (rr) { if (rr.error) throw new Error(rr.error.message); });
          });
        }, Promise.resolve()).then(function () {
          toast('시험지 사진 ' + list.length + '장을 지웠습니다', 'good');
          load();
        }).catch(function (err) { toast('정리하지 못했습니다 — ' + err.message, 'bad'); });
      });
    });
  }

  /* ============================================================
     지금 제출 현황 (교실 화면) — 이름과 제출 여부만
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
      if (!d.test) {
        $('#rvLiveTitle').textContent = L.cls + ' · 이번 주 복습테스트 없음';
        $('#rvLiveCount').textContent = '';
        $('#rvLiveGrid').innerHTML = '';
        return;
      }
      var rows = d.rows || [];
      var n = rows.filter(function (x) { return x.submitted; }).length;
      $('#rvLiveTitle').textContent = d.test.class_name + ' · 복습테스트 ' + d.test.round_no + '회 · ' + Lesson.md(d.test.lesson_date);
      $('#rvLiveCount').textContent = '제출 ' + n + ' / ' + rows.length;
      $('#rvLiveGrid').innerHTML = rows.map(function (x) {
        return '<div class="rv-live__cell' + (x.submitted ? ' is-done' : '') + '">' +
          '<span class="rv-live__name">' + esc(x.name) + '</span>' +
          '<span class="rv-live__mark" aria-hidden="true">' + (x.submitted ? '✓' : '') + '</span>' +
          '<span class="sr-only">' + (x.submitted ? '제출' : '아직') + '</span></div>';
      }).join('');
    });
  }

  /* ============================================================
     자주 틀린 번호 (반 단위 · 최근 4회 · 확인된 기록만)
     가로 막대 한 줄 — 많이 틀린 번호부터, 막대 끝에 '틀린 학생 수 / 낸 학생 수'
     ============================================================ */

  function openStats() {
    if (!st.cls) return;
    $('#rvStatsTitle').textContent = st.cls + ' · 자주 틀린 번호';
    $('#rvStatsBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    $('#rvStatsModal').showModal();
    sb().rpc('review_stats', { p_class: st.cls }).then(function (r) {
      if (r.error) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      var list = r.data || [];
      if (!list.length) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">아직 확인된 복습테스트 기록이 없습니다.</p>'; return; }
      $('#rvStatsBody').innerHTML = list.map(function (t) {
        var items = Object.keys(t.wrong || {}).map(function (q) { return { q: +q, c: +t.wrong[q] }; })
          .sort(function (a, b) { return b.c - a.c || a.q - b.q; }).slice(0, 10);
        return '<div class="rv-stat">' +
          '<div class="rv-stat__head"><b>' + t.round_no + '회</b> · ' + Lesson.md(t.lesson_date) + ' · ' + t.q_count + '문항 · 확인 ' + t.n + '명 · 평균 ' + (t.avg == null ? '—' : t.avg + '점') + '</div>' +
          (items.length ? items.map(function (it) {
            var pct = t.n ? Math.round(it.c / t.n * 100) : 0;
            return '<div class="rv-bar"><span class="rv-bar__q num">' + it.q + '번</span>' +
              '<span class="rv-bar__track"><span class="rv-bar__fill" style="width:' + pct + '%"></span></span>' +
              '<span class="rv-bar__v num">' + it.c + ' / ' + t.n + '명</span></div>';
          }).join('') : '<p class="panel__hint">모두 맞혔습니다.</p>') +
        '</div>';
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
