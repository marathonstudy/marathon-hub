/* ============================================================
   rtabs.js — 위쪽 탭 5개 (20261029a)

   오늘 · 주간 레포트 · 학생 · 교재 · 더보기 (번호 없음)
     · 화면(panel)은 예전 그대로 8개다. app.js 의 UI.selectTab(번호)도 그대로 쓴다
       (0 명단 · 1 작성 · 2 공개 · 3 발송 · 4 반 공지 · 5 교재 · 6 필기 노트 · 7 오늘).
       예전 탭 단추(#tab-write …)는 같은 id 로 안쪽 단계 · 화면 단추가 되었다 — 주소(#tab=write …)와 뒤로가기도 그대로 맞는다.
     · 주간 레포트 = 작성 · 공개 · 발송 세 단계. 맨 위 주차 띠(write.js)를 세 단계가 함께 쓰고, 그 아래 「작성 ── 공개 ── 발송」.
       지금 단계만 강조하고, 단계마다 그 반 그 주 진행(작성 n/전체 · 공개 n/전체 · 발송 n/전체)을 작게.
       주를 바꾸면(띠 ◀ ▶ · 날짜 직접 고르기 · 이번 주로) 세 단계가 같은 주를 본다 (jt:report-week).
     · 학생 = 명단 / 필기 노트 두 화면.
     · 더보기 = 반 공지 · 시험 관리 · 설정 · 사용 설명서.
     · 배지 — 「오늘」 급함 학생 수(today.js) · 주간 레포트 아직 발송 안 된 학생 수(today.js 가 반마다 수업 주기로 센 것)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var REPORT = [1, 2, 3], STUDENTS = [0, 6];
  var last = { report: 1, students: 0 };
  var cur = -1;
  var counts = { week: '', pub: null, run: 0 };

  function active() {
    var ids = ['tab-roster', 'tab-write', 'tab-publish', 'tab-send', 'tab-notice', 'tab-book', 'tab-photo', 'tab-today'];
    for (var i = 0; i < ids.length; i++) {
      var t = document.getElementById(ids[i]);
      if (t && t.getAttribute('aria-selected') === 'true') return i;
    }
    return -1;
  }

  function sync(idx) {
    cur = idx;
    var inReport = REPORT.indexOf(idx) !== -1, inStudents = STUDENTS.indexOf(idx) !== -1;
    if (inReport) last.report = idx;
    if (inStudents) last.students = idx;
    $('#grp-report').setAttribute('aria-selected', String(inReport));
    $('#grp-students').setAttribute('aria-selected', String(inStudents));
    $('#grp-more').setAttribute('aria-selected', String(idx === 4));
    $('#reportHead').hidden = !inReport;
    $('#studentsNav').hidden = !inStudents;
    document.body.classList.toggle('in-report', inReport);
    document.body.classList.toggle('report-step-write', idx === 1);
    updateCounts();
  }

  /* ---------- 위쪽 묶음 탭 ---------- */
  $('#grp-report').addEventListener('click', function () { UI.selectTab(last.report); });
  $('#grp-students').addEventListener('click', function () { UI.selectTab(last.students); });
  $('#grp-more').addEventListener('click', function () { $('#moreMenu').showModal(); });

  /* ---------- 더보기 ---------- */
  function closeMore(then) {
    $('#moreMenu').close();
    /* 메뉴를 닫으며 지운 뒤로가기 기록(nav.js)이 먼저 끝난 다음에 다음 창을 연다 */
    if (then) setTimeout(then, 60);
  }
  /* 반 공지 — 메뉴를 먼저 닫고(뒤로가기 기록 정리) 그다음 화면을 연다. app.js 의 바로 열기는 막는다 */
  $('#moreMenu').addEventListener('click', function (e) {
    if (!e.target.closest('#tab-notice')) return;
    e.stopPropagation();
    closeMore(function () { UI.selectTab(4); });
  }, true);
  $('#moreMenu').addEventListener('click', function (e) {
    var b = e.target.closest('[data-more]');
    if (!b) return;
    var k = b.dataset.more;
    if (k === 'guide') { closeMore(); return; }                         /* 새 창으로 링크가 열린다 */
    if (k === 'exams') closeMore(function () { $('#btnExams').click(); });
    if (k === 'settings') closeMore(function () { $('#tdSettingsBtn').click(); });
  });
  $('#moreMenuClose').addEventListener('click', function () { $('#moreMenu').close(); });

  /* ---------- 주차 띠 ⋯ — 날짜 직접 고르기 · 이번 주로 ---------- */
  $('#btnWbarMore').addEventListener('click', function () { $('#weekPickModal').showModal(); });
  $('#weekPickClose').addEventListener('click', function () { $('#weekPickModal').close(); });
  $('#btnThisWeek').addEventListener('click', function () { setTimeout(function () { if ($('#weekPickModal').open) $('#weekPickModal').close(); }, 0); });

  /* [← 주차 목록] 은 공개 · 발송에서 눌러도 작성 단계의 주차 목록으로 */
  $('#btnWbarBack').addEventListener('click', function () { if (cur !== 1) UI.selectTab(1); });

  /* ---------- 같은 주 — 띠에서 주를 바꾸면 세 단계에 알린다 ---------- */
  var lastWeek = '';
  function weekNow() {
    var d = window.Writer && Writer.current && Writer.current();
    return (d && d.weekStart) || '';
  }
  function checkWeek() {
    var w = weekNow();
    if (w && w !== lastWeek) {
      lastWeek = w;
      window.dispatchEvent(new CustomEvent('jt:report-week', { detail: { week: w } }));
      updateCounts();
    }
  }

  /* ---------- 단계마다 진행 — 그 반 그 주 (반을 안 골랐으면 모든 학생) ---------- */
  function classStudents() {
    var cls = window.Writer && Writer.currentClass ? Writer.currentClass() : '';
    var list = (window.UI ? UI.activeStudents() : Store.activeStudents()) || [];
    return cls ? list.filter(function (s) { return (s.className || '').trim() === cls; }) : list;
  }
  function updateCounts() {
    if (!$('#rstepWrite')) return;
    if (REPORT.indexOf(cur) === -1) return;
    var list = classStudents(), n = list.length;
    var d = Store.read(Store.KEYS.draft, null) || {};
    var written = 0;
    if (window.Report && Report.entryStatus) {
      list.forEach(function (s) {
        var common = (d.common || {})[(s.className || '').trim()] || (d.common || {})[s.className || ''] || { lessons: [], tests: [] };
        var st = Report.entryStatus(common, (d.entries || {})[s.id]);
        if (st && st.state === 'done') written++;
      });
    }
    $('#rstepWrite').textContent = n ? written + '/' + n : '';
    var w = weekNow();
    if (!w || !window.DB || !DB.weekSendData) { $('#rstepPublish').textContent = $('#rstepSend').textContent = ''; return; }
    var run = ++counts.run;
    DB.weekSendData(w).then(function (x) {
      if (run !== counts.run) return;
      var pub = list.filter(function (s) { return x.published[s.id]; }).length;
      var sent = list.filter(function (s) { return x.published[s.id] && x.sent[s.id]; }).length;
      $('#rstepPublish').textContent = n ? pub + '/' + n : '';
      $('#rstepSend').textContent = n ? sent + '/' + n : '';
    }, function () {});
  }

  document.addEventListener('jt:tab', function (e) { sync(e.detail.index); setTimeout(checkWeek, 0); });
  window.addEventListener('jt:write-nav', function () { setTimeout(checkWeek, 0); setTimeout(updateCounts, 0); });
  window.addEventListener('jt:write-mode', function (e) {
    document.body.classList.toggle('write-weeks', !!(e.detail && e.detail.mode === 'weeks'));
    setTimeout(checkWeek, 0);
  });
  window.addEventListener('jt:refreshed', function () { if (REPORT.indexOf(cur) !== -1) updateCounts(); });
  window.addEventListener('jt:remote', function (e) {
    var t = e.detail && e.detail.table;
    if (REPORT.indexOf(cur) !== -1 && (t === 'published' || t === 'sent' || t === 'entries')) updateCounts();
  });
  window.addEventListener('jt:loaded', function () {
    setTimeout(function () {
      document.body.classList.add('is-app');            /* 휴대폰 아래 탭 줄만큼 아래 여백 (style.css) */
      document.body.classList.toggle('write-weeks', !!(window.Writer && Writer.mode && Writer.mode() === 'weeks'));
      sync(active()); lastWeek = weekNow();
    }, 0);
  });
  /* 주간 레포트 → 작성에서 입력하면 작성 수가 바뀐다 (저장된 뒤 1초 안에 한 번) */
  var t0 = null;
  document.addEventListener('input', function () {
    if (cur !== 1) return;
    clearTimeout(t0); t0 = setTimeout(updateCounts, 1000);
  });

  window.RTabs = { sync: sync, counts: updateCounts, week: weekNow };
})();
