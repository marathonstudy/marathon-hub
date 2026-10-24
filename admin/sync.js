/* ============================================================
   sync.js — 여러 기기에서 같이 쓸 때 최신 내용 유지

   · 탭을 열 때, 브라우저 창으로 다시 돌아올 때마다 서버에서 다시 받는다
     (Store.refreshAll — 아직 저장 안 된 내 입력은 지킨다).
   · Supabase Realtime 으로 다른 기기에서 바뀐 줄을 바로 받는다.
     출결·과제 체크(entries)는 그 학생 그 칸만 합치고,
     교재 지급·청구 등은 'jt:remote' 를 보내 그 화면이 다시 불러오게 한다.
   · 실시간 연결이 안 되면 30초마다 다시 받는다.
   · 저장이 안 끝났는데 창을 닫으려 하면 경고한다.
   ============================================================ */

(function () {
  'use strict';

  var TABLES = [
    'students', 'student_links', 'entries', 'week_common', 'class_notices', 'published', 'sent',
    'tb_issues', 'tb_bills', 'tb_bill_notices', 'tb_refunds', 'tb_class_dates', 'tb_stock_moves', 'tb_orders',
    'student_cards', 'student_grades', 'student_notes', 'note_photos', 'classes',
    'class_weeks', 'lesson_videos', 'class_files', 'lesson_summaries', 'review_tests', 'review_submissions',
    'report_skips', 'care_checks'      /* 건너뛰기 · 확인함 (migration-036) */
  ];
  var POLL_MS = 30000;
  var THROTTLE_MS = 3000;

  var started = false;
  var channel = null;
  var realtimeOk = false;
  var pollTimer = null;
  var lastRefresh = 0;
  var timers = {};

  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }

  function debounce(key, ms, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, ms);
  }

  /* 서버에서 다시 받기. force 가 아니면 3초 안에 다시 부르지 않는다. */
  function refresh(force) {
    if (!started) return Promise.resolve();
    var now = Date.now();
    if (!force && now - lastRefresh < THROTTLE_MS) return Promise.resolve();
    lastRefresh = now;
    return Store.refreshAll().catch(function (e) { console.error('새로 불러오기 실패', e); });
  }

  /* ---------- 실시간 ---------- */

  function onChange(p) {
    var t = p.table;
    var row = (p.new && Object.keys(p.new).length) ? p.new : null;

    if (t === 'entries' && row) {
      if (Store.mergeRemoteEntry(row)) emit('jt:draft-remote', { entries: [row.student_id] });
      return;
    }
    if (t === 'week_common' && row) {
      if (Store.mergeRemoteCommon(row)) emit('jt:draft-remote', { common: [row.class_name] });
      return;
    }
    if (t === 'students' || t === 'student_links' || t === 'published' || t === 'sent' || t === 'classes' || t === 'class_weeks') {
      debounce('core', 700, function () { refresh(true); });
      return;
    }
    debounce('t:' + t, 500, function () { emit('jt:remote', { table: t }); });
  }

  function startRealtime() {
    if (channel || !SB.client.channel) { if (!channel) startPoll(); return; }
    try {
      channel = SB.client.channel('hub-sync');
      TABLES.forEach(function (t) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange);
      });
      channel.subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          realtimeOk = true;
          stopPoll();
          showMode();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeOk = false;
          startPoll();
          showMode();
        }
      });
    } catch (e) {
      console.error('실시간 연결 실패', e);
      startPoll();
    }
    /* 10초 안에 연결이 안 되면 30초마다 새로 받기로 */
    setTimeout(function () { if (!realtimeOk) { startPoll(); showMode(); } }, 10000);
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      refresh(true).then(function () { emit('jt:remote', { table: '*' }); });
    }, POLL_MS);
  }
  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function showMode() {
    var dot = document.getElementById('syncDot');
    if (dot) dot.dataset.live = realtimeOk ? '실시간 반영 중' : '30초마다 새로 불러오는 중';
  }

  /* ---------- 언제 다시 받나 ---------- */

  window.addEventListener('jt:loaded', function () {
    started = true;
    lastRefresh = Date.now();
    startRealtime();
  });

  document.addEventListener('jt:tab', function () { refresh(false); });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh(false).then(function () { emit('jt:remote', { table: '*' }); });
  });
  window.addEventListener('focus', function () {
    refresh(false).then(function () { emit('jt:remote', { table: '*' }); });
  });

  /* 입력 중이라 다시 그리지 못한 화면 — 칸에서 나오거나 창을 닫으면 다시 그린다 */
  var skipped = false;
  function markSkipped() { skipped = true; }
  function settleLater() {
    if (!skipped) return;
    debounce('settle', 350, function () {
      if (!skipped || UI.isBusy()) return;
      skipped = false;
      emit('jt:refreshed', { local: true });
    });
  }
  document.addEventListener('focusout', settleLater);
  document.addEventListener('close', settleLater, true);

  /* 저장이 안 끝났는데 닫으려 하면 */
  window.addEventListener('beforeunload', function (e) {
    if (Store.pendingCount() > 0) {
      Store.flushAll();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  window.Sync = {
    refresh: refresh,
    markSkipped: markSkipped,
    isLive: function () { return realtimeOk; }
  };

})();
