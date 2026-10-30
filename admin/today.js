/* ============================================================
   today.js — 마라톤 코치룸 「오늘」 총괄 (로그인 첫 화면)

   · 서버 함수 coach_today() 한 번으로 반 · 학생을 받고, 최근 6주 보낸 표시(sent)를 한 번 더 읽는다.
   · 맨 위 「오늘 할 일」 — 발송 안 한 레포트가 있는 반만 「목동반 · 10/20 레포트 안 보냄 12명 [보내기]」, 없으면 「오늘 할 일 없음」 (20261030e)
   · 반 카드 (촘촘하게 위아래로) — 반 이름 · 인원 / 최근 3번 수업 레포트 칩(보낸 학생 %) / 「수업일 10/29(목)」 · 「수업까지 D-3!」 / [전체 문자 발송] [레포트 작성]
       칩: 100% 초록 · 1~99% 주황 「64% · 안 보냄 4명」 · 0% 빨강 · 수업 당일 회색 「작성 중」 — 누르면 그 수업 발송 화면
       수업일이 없으면 [수업일 미정 · 수업 요일 정하기] → 그 반 작성 화면의 수업 요일 칸
     「학생 11명 보기 ▾」 — 누르면 전원 (펼친 반은 이 기기에 기억). 학생 줄 = 이름 · 「과제 n/5일」 · 상담 카드 · 문자 · 미리보기 둘
   · 과제는 바깥 앱 서버 자료라 화면이 뜬 뒤 app-report 함수로 6명씩 동시에 불러오고, 한 명 받을 때마다 그 학생 칸을 바로 채운다 (appfetch.js · 미리보기와 같은 기록을 같이 씀).
     그 반 지난 수업(L) 전 일주일 L-7 ~ L-1 의 평일 중 제출한 날 (토 · 일 주중 복습은 세지 않는다 · 러닝노트 레포트와 같은 AppWeek).
     불러온 값은 30분 동안 이 화면 메모리에만 둔다(브라우저에 저장하지 않는다).
   · 탭 배지 — 「오늘」 · 「레포트 발송」 모두 발송 안 한 레포트 학생 수 (수업 당일은 빼고). 금액은 이 화면에 넣지 않는다.
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$, $$ = UI.$$;
  var CFG = window.CONFIG;
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }

  var APP_TTL = 30 * 60 * 1000;

  var st = { data: null, loading: false, last: 0, open: {}, role: '', settingsAt: '', links: null, linksAt: '' };

  /* 링크 전환 기간 (migration-015) — 학부모 링크로도 입력 허용. 켜져 있는 동안 맨 위에 알림 */
  function loadLinks() {
    return DB.getSettingRow('links').then(function (row) {
      st.links = row ? (row.value || {}) : null;
      st.linksAt = (row && row.updated_at) || '';
      if (st.data) render();
    }, function () { st.links = null; });
  }
  function transitionHtml() {
    if (!st.links || st.links.parentWrite === false) return '';
    return '<div class="td-transition">🔁 <b>전환 기간</b> — 학부모 링크로도 복습테스트 · 필기 사진 입력이 됩니다. ' +
      '학생 → 명단에서 반마다 [학생 링크 모두 복사]로 학생 링크를 다 보내면 <b>끄세요</b>.' +
      (st.role ? ' <button type="button" class="btn btn--sm" id="tdTransitionOpen">설정에서 끄기</button>' : ' (「설정」에서 끕니다)') +
      '</div>';
  }
  var app = {};                     /* 학생 id → { rate, ok, at } */
  var appRun = 0;

  /* ---------- 불러오기 ---------- */

  function load(force) {
    if (st.loading || $('#appRoot').hidden) return;            /* 로그아웃된 뒤에는 부르지 않는다 */
    if (!force && Date.now() - st.last < 10000) return;
    st.loading = true;
    st.last = Date.now();
    if (!st.data) $('#tdBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    Promise.all([sb().rpc('coach_today'), DB.getSettingRow('dashboard').catch(function () { return null; }), loadRecentSent(), loadCare(), loadFails()]).then(function (res) {
      var r = res[0];
      st.loading = false;
      if (r.error) throw new Error(r.error.message);
      st.dash = (res[1] && res[1].value) || {};
      st.data = prepare(r.data);
      st.classes = classList(st.data);
      render();
      loadApp();
      window.dispatchEvent(new CustomEvent('jt:today'));       /* 레포트 발송 — 반 고르기 「안 보냄 n」 · 지금 보낼 차례 (write.js · weeks.js · 20261031h) */
    }).catch(function (e) {
      st.loading = false;
      $('#tdBody').innerHTML = '<div class="empty-state">' + (isMissing(e)
        ? '「오늘」 화면용 함수가 아직 없습니다. Supabase SQL Editor 에서 <code>migration-007-dashboard.sql</code> 을 먼저 실행해 주세요.'
        : '불러오지 못했습니다 — ' + esc(e.message)) + '</div>';
    });
  }

  /* ---------- 최근 수업 레포트 발송 (20261030e) ----------
     최근 6주 동안 보낸 표시(sent)를 한 번에 — 주 시작일 → { 학생 id: 보낸 시각 }.
     반마다 최근 3번 수업일로 「그 수업 레포트를 보낸 학생 / 반 학생」을 센다 (반 + 수업일 단위) */
  st.recent = {};
  st.todoOpen = {};
  function loadRecentSent() {
    var from = Lesson.addDays(DDay.today(), -42);
    return sb().from('sent').select('week_start,student_id,sent_at').gte('week_start', from).then(function (r) {
      if (r.error) return;
      var m = {};
      (r.data || []).forEach(function (x) { (m[x.week_start] = m[x.week_start] || {})[x.student_id] = x.sent_at || true; });
      st.recent = m;
    }, function () {});
  }

  /* 보낸 시각 — 오늘이면 18:09, 아니면 10/22 18:09 */
  function sentAt(iso) {
    var d = new Date(iso), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  /* 서버 값 그대로 (작성 완료 판정은 없앴다 · 20261030a) */
  /* 퇴원 표시 · 퇴원일이 지난 학생은 「오늘」 학생 목록에서 뺀다 (퇴원일을 지우면 다시 · 20261031i) */
  function prepare(d) {
    if (d && d.students) { st.allStudents = d.students; d.students = activeOnly(d.students); }
    return d;
  }
  /* 종강한 반(종강일이 지남 · migration-049) 학생은 「오늘」 · 챙길 학생 · 발송 차례에서 뺀다 (기록 · 러닝노트는 그대로) */
  function activeOnly(list) {
    var by = {};
    Store.getStudents().forEach(function (s) { by[s.id] = s; });
    return (list || []).filter(function (s) { var x = by[s.id]; return (!x || Store.isActiveOn(x)) && !Store.isEnded(s.class_name); });
  }

  /* ---------- 과제 기록 불러오기 (20261031g) ----------
     예전: 학생마다 app-report 를 따로(6명씩) → 32명이면 약 6초 · 다시 열어도 처음부터
     지금: 반마다 한 번(app-report ?codes= · 함수 안에서 8명씩 동시에) · 반 여러 개를 함께
           받은 기록은 이 기기에 10분 동안 기억(mhub.appCache · 최근 70일만) → 10분 안에 다시 열면 바로 보이고, 뒤에서 조용히 새로 받아 바뀐 칸만 고친다
           「오늘」을 보고 있는 동안 5분마다 다시 받는다(다른 탭 · 다른 창이면 멈춤) · 반 카드 오른쪽 위 「과제 10:35 기준 · 새로고침」
           다시 받는 동안에는 칸만 바꾼다(깜빡이거나 줄 순서가 바뀌지 않게) · 처음 받을 때만 「과제 기록 불러오는 중 3/11」
     [다시 시도] · 링크를 새로 넣은 학생 한 명은 예전처럼 학생 하나로 (appfetch.js · 미리보기와 같은 기록) */
  var CACHE_KEY = 'mhub.appCache', CACHE_TTL = 10 * 60 * 1000, REFRESH_MS = 5 * 60 * 1000, KEEP_DAYS = 70;
  var appMeta = { at: 0, shown: 0, busy: false, cacheRead: false };     /* at = 마지막으로 새로 받은 때 · shown = 지금 보이는 기록의 때(기억한 것이면 그때) */
  var appProg = { done: 0, total: 0, start: 0, timer: null };
  function readCache() { try { var m = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
  function writeCache(m) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); }
    catch (e) { try { localStorage.removeItem(CACHE_KEY); } catch (e2) {} }        /* 가득 차면 비운다 (다음에 새로 받는다) */
  }
  /* 기억할 때는 최근 70일만 (세 기간 · 날짜별 표에 충분) */
  function trimData(d) {
    var cutD = Lesson.addDays(DDay.today(), -KEEP_DAYS);
    var cal = (d.calendar || []).filter(function (c) { return c && c.date >= cutD; });
    var orders = {};
    cal.forEach(function (c) { if (c.order) orders[c.order] = 1; });
    return {
      who: String(d.who || ''),
      calendar: cal,
      lectures: (d.lectures || []).filter(function (l) { return l && orders[l.order]; }).map(function (l) { return { order: l.order, title: l.title, videosDone: l.videosDone, videosTotal: l.videosTotal }; }),
      history: (d.history || d.recent || []).filter(function (h) { return h && (orders[h.order] || String(h.submittedAt || '').slice(0, 10) >= cutD); })
        .map(function (h) { return { title: h.title, order: h.order, submittedAt: h.submittedAt, late: h.late }; })
    };
  }
  /* app-report 답 → 학생 칸 상태 · 앱 링크가 없음(nolink) · 만료(expired) = 「+ 과제 링크 연결」 · 그 밖의 실패 = 「못 불러옴 · 다시 시도」 */
  function entryOf(res) {
    var dt = res && res.ok && res.data ? res.data : null, why = (res && res.reason) || '';
    return dt ? { ok: true, data: trimData(dt), at: Date.now() }
      : why === 'nolink' || why === 'expired' ? { ok: false, need: true, reason: why, data: null, at: Date.now() }
      : { ok: false, failed: true, reason: why, data: null, at: Date.now() };
  }
  /* 과제 수정 (hwfix.js · migration-038 · 20261031j) — 앱 기록(raw)은 그대로 두고 고친 값을 덮은 것(data)으로 센다 */
  function fixed(sid, raw) { return withStart(sid, raw && window.HwFix ? HwFix.apply(sid, raw) : raw); }
  /* 신입생 (20261031q · migration-044) — 앱 기록에 수강 시작일을 붙인다 · 그 앞 날은 AppWeek 가 「신입생」으로 (세지 않음) */
  function stu(sid) { return Store.getStudents().find(function (x) { return x.id === sid; }) || null; }
  function withStart(sid, d) {
    var s0 = d ? Store.startOf(stu(sid)) : '';
    return s0 && d && d.startOn !== s0 ? Object.assign({}, d, { startOn: s0 }) : d;
  }
  /* 그 수업 레포트에 드는 학생 — 수강 시작일 · 퇴원일 · 학생마다 건너뛰기(×) */
  function inLessonId(sid, cls, date) {
    var s = stu(sid);
    if (s && !Store.inLesson(s, date)) return false;
    return !(window.Skips && Skips.checked('report', cls, date, sid));
  }
  /* 짐작한 이유 — 신입 · 번호 없음 · 보내기 실패 · 결석 · 퇴원 예정 (모르면 '') */
  function whyOf(sid, date, week) {
    var s = stu(sid);
    if (!s) return '';
    var j = Store.joinedOf(s), cAt = Store.kstDay(s.createdAt), reg = cAt && cAt > j ? cAt : j;
    if (reg && date && reg > date) return '신입 · ' + md(reg) + ' 등록';
    if (week && (fails[week] || {})[sid]) return '보내기 실패';
    var A0 = window.Attend && Attend.rowOf ? Attend.rowOf(week, sid) : null;
    if (A0 && A0.s === 'absent') return '결석';
    if (!(Store.phonesOf(s) || []).length) return '번호 없음';
    var t = DDay.today();
    if (s.leftOn && s.leftOn >= t && (Date.parse(s.leftOn) - Date.parse(t)) / 86400000 <= 14) return '퇴원 예정';
    return '';
  }
  /* 보내기 실패 — 최근 6주 알림톡 · 문자 실패 (그 주 레포트) */
  var fails = {};
  function loadFails() {
    var from = Lesson.addDays(DDay.today(), -42) + 'T00:00:00Z';
    var put = function (w, sid) { if (w && sid) (fails[String(w).slice(0, 10)] = fails[String(w).slice(0, 10)] || {})[sid] = true; };
    return Promise.all([
      Promise.resolve(sb().from('kakao_log').select('week_start,student_id').eq('status', 'fail').gte('created_at', from)).then(function (r) { return r && !r.error ? r.data || [] : []; }, function () { return []; }),
      Promise.resolve(sb().from('sms_log').select('mark_week,student_id').eq('status', 'fail').gte('created_at', from)).then(function (r) { return r && !r.error ? r.data || [] : []; }, function () { return []; })
    ]).then(function (x) {
      fails = {};
      x[0].forEach(function (r) { put(r.week_start, r.student_id); });
      x[1].forEach(function (r) { put(r.mark_week, r.student_id); });
    });
  }
  function sameEntry(a, b) { return !!a && !!b && a.ok === b.ok && !!a.need === !!b.need && !!a.failed === !!b.failed && JSON.stringify(a.data) === JSON.stringify(b.data); }
  function setEntry(s, e) {
    var old = app[s.id];
    e.raw = e.data;
    e.data = fixed(s.id, e.raw);
    app[s.id] = e;
    if (!e.failed) {
      var m = readCache();
      m[s.code] = { at: e.at, ok: e.ok, need: !!e.need, reason: e.reason || '', data: e.raw };
      writeCache(m);
    }
    if (!sameEntry(old, e)) paintApp(s.id);
  }
  /* 처음 한 번 — 10분 안의 기억으로 바로 채운다 */
  function fromCache(list) {
    if (appMeta.cacheRead) return;
    appMeta.cacheRead = true;
    var m = readCache(), now = Date.now(), oldest = now;
    list.forEach(function (s) {
      var c = m[s.code];
      if (!c || now - c.at > CACHE_TTL || app[s.id]) return;
      app[s.id] = { ok: c.ok, need: c.need, reason: c.reason, raw: c.data, data: fixed(s.id, c.data), at: c.at, cached: true };
      if (c.at < oldest) oldest = c.at;
    });
    if (oldest < now) appMeta.shown = oldest;            /* at 은 그대로 0 — 기억한 것을 보여 준 뒤 곧바로 뒤에서 새로 받는다 */
    /* 기억한 기록을 바로 칸에 — 이미 그려진 줄이면 그 줄만 다시 (20261031q) */
    list.forEach(function (s) { if (app[s.id] && app[s.id].cached) setTimeout(function () { paintApp(s.id); }, 0); });
    setTimeout(paintAvg, 0);
  }
  function liveList() { return st.data ? st.data.students.filter(function (s) { return s.app && s.code; }) : []; }
  function loadApp(only, force) {
    var d = st.data;
    if (!d) return;
    var all = liveList();
    if (only) {
      var one = all.find(function (s) { return s.id === only; });
      if (!one) return;
      delete app[one.id]; paintApp(one.id);
      AppFetch.get(one.code, true).then(function (res) { setEntry(one, entryOf(res)); paintAvg(); window.dispatchEvent(new CustomEvent('jt:app', { detail: { done: true } })); });
      return;
    }
    fromCache(all);
    var missing = all.filter(function (s) { return !app[s.id] || app[s.id].failed; });
    if (appMeta.busy) return;
    if (!force && !missing.length && Date.now() - appMeta.at < REFRESH_MS) return;     /* 5분 안이면 그대로 */
    appMeta.busy = true;
    paintStamp();
    /* 처음 받는 학생이 있을 때만 위에 「과제 기록 불러오는 중 3/11」 */
    appProg.total = missing.length; appProg.done = 0; appProg.start = Date.now();
    clearInterval(appProg.timer);
    if (missing.length) appProg.timer = setInterval(function () { renderApp(); }, 1000);
    renderApp();
    var firstFill = missing.length > 0;
    /* 반마다 한 번 — 반 4개씩 함께 */
    var by = {}, groups = [];
    all.forEach(function (s) { var k = s.class_name || '(반 없음)'; if (!by[k]) { by[k] = []; groups.push(k); } by[k].push(s); });
    var gi = 0;
    function nextGroup() {
      if (gi >= groups.length) return Promise.resolve();
      var rows = by[groups[gi++]];
      return AppFetch.getMany(rows.map(function (s) { return s.code; })).then(function (res) {
        rows.forEach(function (s) {
          var wasMissing = !app[s.id] || app[s.id].failed;
          var e = entryOf(res[s.code]);
          if (e.failed && app[s.id] && !app[s.id].failed) return;          /* 다시 받다 실패하면 원래 값을 둔다 */
          setEntry(s, e);
          if (wasMissing) appProg.done++;
        });
        renderApp();
        paintAvg();
        return nextGroup();
      });
    }
    Promise.all([nextGroup(), nextGroup(), nextGroup(), nextGroup()]).then(function () {
      appMeta.busy = false;
      appMeta.at = appMeta.shown = Date.now();
      clearInterval(appProg.timer);
      appProg.total = 0;
      renderApp();
      paintStamp();
      /* 처음 채웠을 때만 한 번 — 펼친 반을 정렬대로 다시 세운다 (다시 받을 때는 줄 순서를 바꾸지 않는다) */
      if (firstFill && !$('#appRoot').hidden && Object.keys(st.open).length) render();
      window.dispatchEvent(new CustomEvent('jt:app', { detail: { done: true } }));
    });
  }
  /* 5분마다 — 「오늘」이 보일 때만 (다른 탭 · 숨긴 창이면 멈춤) */
  function todayVisible() { var p = $('#panel-today'); return !document.hidden && !$('#appRoot').hidden && !!p && !p.hidden; }
  function autoRefresh() { if (st.data && todayVisible() && !appMeta.busy && Date.now() - appMeta.at >= REFRESH_MS) loadApp(null, true); }
  setInterval(autoRefresh, 30000);
  document.addEventListener('visibilitychange', autoRefresh);

  /* 반 카드 오른쪽 위 「과제 10:35 기준 · 새로고침」 */
  function stampHtml() { return '<div class="td-appstamp" id="tdAppStamp" aria-live="polite"></div>'; }
  function paintStamp() {
    var el = $('#tdAppStamp');
    if (!el) return;
    if (!liveList().length) { el.hidden = true; return; }
    el.hidden = false;
    var t = appMeta.shown ? new Date(appMeta.shown) : null;
    el.innerHTML = (appMeta.busy ? '<span class="td-appstamp__t">과제 받는 중…</span>'
      : '<span class="td-appstamp__t num">' + (t ? '과제 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ' 기준' : '과제') + '</span>') +
      ' · <button type="button" class="td-appstamp__b" data-app-refresh' + (appMeta.busy ? ' disabled' : '') + '>새로고침</button>';
  }

  /* 반 카드 위 「과제 기록 불러오는 중 3/11」 (처음 받는 학생이 있을 때만 · 10초가 넘으면 「조금 오래 걸리고 있습니다」) */
  function renderApp() {
    var el = $('#tdAppBar');
    var t = appProg.total, n = Math.min(appProg.done, t);
    var busy = t && n < t;
    if (!busy) clearInterval(appProg.timer);
    if (!el) return;
    el.hidden = !busy;
    el.innerHTML = busy ? '<i class="spin" aria-hidden="true"></i> ' + (Date.now() - appProg.start > 10000 ? '조금 오래 걸리고 있습니다 · ' : '') + '과제 기록 불러오는 중 <span class="num">' + n + '/' + t + '</span>' : '';
  }
  /* 그 학생 줄의 과제 칸만 다시 (세 칸 · 레포트 발송 · 명단도 jt:app 으로) */
  function paintApp(sid) {
    var s = st.data && st.data.students.find(function (x) { return x.id === sid; });
    if (!s) return;
    var c = (st.clsBy || {})[s.class_name || '(반 없음)'];
    Array.prototype.forEach.call(document.querySelectorAll('#tdBody .tdc-st[data-id="' + sid + '"] .tdc-app-slot'), function (el) {
      el.innerHTML = c ? triHtml(s, c) : appCell(s, (st.cyBy || {})[s.class_name || '(반 없음)']);
    });
    if (det.sid === sid) paintDetail();
    window.dispatchEvent(new CustomEvent('jt:app', { detail: { sid: sid } }));
  }
  /* 과제 평균 줄만 다시 (반 카드 · 과정 카드의 반마다) */
  function paintAvg() {
    Array.prototype.forEach.call(document.querySelectorAll('#tdBody .tdc-line--app[data-cls]'), function (el) {
      var c = (st.clsBy || {})[el.dataset.cls];
      if (!c) return;
      var h = avgLineHtml(c);
      if (h) el.outerHTML = h;
    });
  }

  /* ---------- 그리기 ---------- */




  /* ---------- 반 카드 (20261026a) ----------
     반마다 카드: 반 이름 · 학원 · 다음 수업(「오늘 수업」 / 「D-2 10/22(목)」, 휴강 주 건너뜀) · 인원 · 이번 주 작성 · 공개 n/전체 ·
     급함 n · 살펴보기 n · [레포트 작성]. 순서 = 다음 수업이 가까운 반부터 (오늘 수업 맨 위, 같은 날은 이름 순, 수업일 미정은 맨 아래).
     카드를 누르면 그 반 학생 목록이 펼쳐진다 (여러 반 함께 · 펼친 반은 이 기기에만 기억).
       급함     최근 결석 기준 이상 · 복습테스트 미제출 · 확인 필요 상담
       살펴보기 과제 제출 기준(기본 50%) 미만 — 그 반 지난 수업일 L 의 레포트와 같은 기간(L-7 ~ L-1)의 제출일 / 과제 있던 날 (20261029h)
                · 필기 2주 연속 없음(설정에서 켰을 때만, 기본 끔)
     금액은 이 화면에 넣지 않는다. */
  var OPEN_KEY = 'mhub.today.open';
  function readOpen() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveOpen() { try { localStorage.setItem(OPEN_KEY, JSON.stringify(st.open)); } catch (e) {} }
  st.open = readOpen();

  function dash() {
    var v = st.dash || {};
    var g = parseInt(v.reportGrace, 10);
    return { appLow: Math.max(1, Math.min(100, parseInt(v.appLow, 10) || 50)), photoWatch: v.photoWatch === true,
             grace: isNaN(g) ? 2 : Math.max(0, Math.min(14, g)) };
  }

  /* 다음 수업일 — 오늘 포함, 휴강 주는 건너뛴다 (주 2회 반은 가까운 요일) · 요일을 안 정했으면 null */
  function nextLesson(cls) {
    var s = Store.schedOf(cls);
    if (!s || !window.Lesson) return null;
    var today = DDay.today();
    var mon = Lesson.addDays(today, -((Lesson.dowOf(today) + 6) % 7));
    for (var k = 0; k < 10; k++) {
      var L = Lesson.of(s, Lesson.addDays(mon, 7 * k));
      if (!L || L.canceled) continue;
      var days = (L.days && L.days.length ? L.days : [L.date]).filter(function (d) { return d && d >= today; }).sort();
      if (days.length) return { date: days[0], dday: Math.round((Date.parse(days[0]) - Date.parse(today)) / 86400000) };
    }
    return null;
  }


  /* ---------- 반마다 수업 주기 (20261027a · migration-022) ----------
     지난 수업일 L = 오늘 이하의 가장 최근 수업(휴강 반영) · 지금 주기 = L ~ 다음 수업 전날 · 직전 주기 = 그 앞 수업 ~ L 전날
     레포트   L 이 든 주의 레포트. L ~ L+1일은 「발송 전」(급함 아님), L+[설정 · 기본 2]일부터 아직 안 보낸 학생 = 급함
     복습     그 반 그 주에 실제로 만든 시험만. 시험 수업일 밤 12시(마감)가 지나도 안 낸 학생 = 급함
     필기     지금 주기 · 직전 주기 모두 사진이 없으면 살펴보기 (설정에서 켰을 때만) */
  function lessonDates(cls) {
    var s = Store.schedOf(cls);
    if (!s || !window.Lesson) return null;
    var today = DDay.today();
    var mon = Lesson.addDays(today, -((Lesson.dowOf(today) + 6) % 7));
    var out = [];
    for (var k = -14; k <= 10; k++) {
      var L = Lesson.of(s, Lesson.addDays(mon, 7 * k));
      if (!L || L.canceled) continue;
      (L.days && L.days.length ? L.days : [L.date]).forEach(function (d) { if (d && out.indexOf(d) === -1) out.push(d); });
    }
    return out.sort();
  }
  function cycleOf(cls) {
    var ds = lessonDates(cls);
    if (!ds) return null;
    var today = DDay.today();
    var past = ds.filter(function (d) { return d <= today; });
    var L = past.length ? past[past.length - 1] : '';
    if (!L) return { L: '' };
    var prev = ds.filter(function (d) { return d < L; }).pop() || '';
    var next = ds.filter(function (d) { return d > L; })[0] || '';
    return {
      L: L, prev: prev, next: next,
      week: Lesson.addDays(L, -((Lesson.dowOf(L) + 6) % 7)),
      from: L, to: next ? Lesson.addDays(next, -1) : Lesson.addDays(L, 6),
      pfrom: prev || Lesson.addDays(L, -7), pto: Lesson.addDays(L, -1),
      since: Math.round((Date.parse(today) - Date.parse(L)) / 86400000)
    };
  }
  /* 과제 — 수업일 D 레포트와 같은 기간 D-7 ~ D-1 (D = 그 반 지난 수업일 L · 오늘이 수업일이면 오늘). 과제 있던 날이 없으면 null (20261029h) */
  function appWeekOf(s, cy, lessonDate) {
    var a = app[s.id];
    var p = window.AppWeek && AppWeek.lastWeek ? AppWeek.lastWeek(lessonDate || (cy && cy.L)) : null;
    if (!s.app || !a || !a.ok || !a.data || !p) return null;
    var w = AppWeek.compute(a.data, p.from, p.to, DDay.today());
    return w && w.hwDays ? w : null;
  }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function classList(d) {
    var by = {};
    d.students.forEach(function (s) { var k = s.class_name || '(반 없음)'; (by[k] = by[k] || { name: k, academy: s.academy || '', rows: [] }).rows.push(s); });
    Store.getClasses().forEach(function (c) { if (!by[c.name]) by[c.name] = { name: c.name, academy: '', rows: [] }; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .filter(function (c) { return !Store.isArchivedClass(c.name) && !Store.isEnded(c.name); })
      .map(function (c) { var no = c.name === '(반 없음)'; c.next = no ? null : nextLesson(c.name); c.cy = no ? null : cycleOf(c.name); c.per = no ? null : periodsOf(c.name); return c; })
      .sort(function (x, y) {
        if (!!x.next !== !!y.next) return x.next ? -1 : 1;               /* 수업일 미정은 맨 아래 */
        if (x.next && y.next && x.next.date !== y.next.date) return x.next.date < y.next.date ? -1 : 1;
        if ((x.name === '(반 없음)') !== (y.name === '(반 없음)')) return x.name === '(반 없음)' ? 1 : -1;
        return x.name.localeCompare(y.name, 'ko');
      });
  }

  /* ---------- 반 카드 (20261030e — 단순하게) ----------
     반 이름 · 인원 / 최근 3번 수업 레포트 발송 칩 / 「수업일 10/29(목)」 · 「수업까지 D-3!」 / [전체 문자 발송] [레포트 작성]
     수업일이 없으면 [수업일 미정 · 수업 요일 정하기] · 학생 목록은 접어 두고 「학생 11명 보기 ▾」 (펼친 반은 이 기기에 기억) */
  /* 최근 3번 수업 (오늘 포함 · 휴강 빼고) — 옛날 → 최근 */
  /* 「오늘 수업 D-day!」 · 「수업까지 D-3!」 (20261031c) */
  function ddayText(n) { return n === 0 ? '오늘 수업 D-day!' : '수업까지 D-' + n + '!'; }
  /* 최근 수업 — 그 반이 사이트를 쓰기 시작한 날(수업 요일 정하기의 첫 수업일)부터만 (그 앞 수업이 「0%」 빨간 칩으로 보이지 않게 · 20261031c)
     칩 · 「오늘 할 일」 · 탭 배지 · 과정 카드가 모두 이것으로 센다 */
  function recentLessons(cls, k) {
    var ds = lessonDates(cls);
    if (!ds) return [];
    var today = DDay.today(), s = Store.schedOf(cls), first = (s && s.first) || '';
    return ds.filter(function (d) { return d <= today && (!first || d >= first); }).slice(-(k || 3));
  }
  function weekOfDate(d) { return Lesson.addDays(d, -((Lesson.dowOf(d) + 6) % 7)); }
  /* 칩 하나 — { date, week, n, sent, pct, kind: ok | part | none | wip } */
  function chipOf(c, date) {
    var week = weekOfDate(date), m = st.recent[week] || {};
    /* 수강 시작일 앞 수업 · 퇴원일 뒤 수업 · 이 학생만 건너뛴 레포트는 세지 않는다 (20261031q) */
    var rows = c.rows.filter(function (s) { return !!m[s.id] || inLessonId(s.id, c.name, date); });
    var n = rows.length;
    var sent = rows.filter(function (s) { return !!m[s.id]; }).length;
    var ids = rows.filter(function (s) { return !m[s.id]; }).map(function (s) { return s.id; });
    var pct = n ? Math.round(sent / n * 100) : 0;
    var wip = date === DDay.today() && sent < n;              /* 수업 당일 — 아직 보낼 때가 아니다 */
    /* 건너뛴 수업 (skips.js · migration-036) — 회색 「건너뜀」 · 「오늘 할 일」 · 배지에서 빠진다 (다 보냈으면 그대로 초록) */
    var skip = sent < n && !!(window.Skips && Skips.skipped(c.name, date));
    var kind = skip ? 'skip' : wip ? 'wip' : !n ? 'wip' : sent === n ? 'ok' : sent ? 'part' : 'none';
    return { date: date, week: week, n: n, sent: sent, pct: pct, kind: kind, left: n - sent, ids: ids };
  }
  function chipsOf(c) {
    if (c.name === '(반 없음)' || !c.rows.length) return [];
    return recentLessons(c.name, 3).map(function (d) { return chipOf(c, d); });
  }
  function chipHtml(c, x) {
    var day = Store.dateWithDow(x.date);
    if (x.kind === 'skip') {
      var sk = window.Skips && Skips.skipRow(c.name, x.date);
      return '<button type="button" class="tdc-chip tdc-chip--skip num" data-unskip-cls="' + esc(c.name) + '" data-unskip-date="' + esc(x.date) + '" title="' +
        esc(day + ' 레포트 — 보내지 않고 건너뜀' + (sk && sk.skipped_name ? ' (' + sk.skipped_name + ')' : '') + ' · 누르면 되돌리기') + '">' + esc(day + ' 건너뜀') + '</button>';
    }
    var t = x.kind === 'wip' ? day + ' 작성 중' : x.kind === 'part' ? day + ' ' + x.pct + '% · 안 보냄 ' + x.left + '명' : day + ' ' + x.pct + '%';
    return '<button type="button" class="tdc-chip tdc-chip--' + x.kind + ' num" data-go-send="' + esc(c.name) + '" data-week="' + esc(x.week) + '" title="' +
      esc(day + ' 수업 레포트 — 보냄 ' + x.sent + '/' + x.n + ' · 누르면 발송 화면') + '">' + esc(t) + '</button>';
  }
  /* 아직 다 안 보낸 지난 수업 레포트 (수업 당일은 빼고) — 「오늘 할 일」 · 배지 */
  function unsentOf(classes) {
    var out = [];
    classes.forEach(function (c) {
      chipsOf(c).forEach(function (x) { if (x.kind === 'part' || x.kind === 'none') out.push({ cls: c.name, x: x }); });
    });
    return out;
  }

  /* 과제 칸 상태 (20261031d)
       need  과제 링크 연결 필요 — 앱 공유 링크가 없음 · 학부모 링크 코드가 없음(과제 기록을 그 코드로 부른다) · 앱에서 링크가 만료됨
             (예전에는 앱 링크가 없으면 칸이 아예 비었고, 학부모 링크 코드가 없으면 「불러오는 중」에 멈춰 있었다)
       wait  불러오는 중 · fail  링크는 있는데 못 불러옴(시간 초과 · 앱 서버 오류) → 다시 시도
       ok    그 기간 과제 n/5일 (w) · none  그 기간 과제 없음 */
  function appState(s, cy, lessonDate) {
    if (!s.app || !s.code) return { k: 'need', why: !s.app ? 'nolink' : 'nohub' };
    var a = app[s.id];
    if (!a) return { k: 'wait' };
    if (a.need) return { k: 'need', why: a.reason };
    if (a.failed) return { k: 'fail' };
    /* 셀 기간이 없다 = 수업일이 정해지지 않은 반 · 기간은 있는데 앱 과제가 하나도 없다 = 과제 없음 (20261031e) */
    if (!(window.AppWeek && AppWeek.lastWeek && AppWeek.lastWeek(lessonDate || (cy && cy.L)))) return { k: 'nosched' };
    var w = appWeekOf(s, cy, lessonDate);
    return w ? { k: 'ok', w: w } : { k: 'none' };
  }
  /* ---------- 링크 확인 필요 (20261031k) ----------
     앱 공유 링크가 만료됐거나(expired) · 앱에 등록된 이름(app-report 의 who)이 우리 학생 이름과 달라 보이면(다른 학생 링크를 넣은 것) — 주황 「링크 확인 필요」
     누르면 그 자리에 「링크 바꾸기」 칸 (applink.js). 이름은 띄어쓰기 · 괄호를 빼고 비교 · 한쪽이 다른 쪽을 품으면 같다고 본다 · 「김*수」처럼 가린 글자는 건너뛴다 */
  function normName(v) { return String(v || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ''); }
  function nameDiffers(who, name) {
    var a = normName(who), b = normName(name);
    if (!a || !b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return false;
    if (/[*＊○●]/.test(a) && a.length === b.length) {
      for (var i = 0; i < a.length; i++) if (!/[*＊○●]/.test(a[i]) && a[i] !== b[i]) return true;
      return false;
    }
    return true;
  }
  function linkWarn(s) {
    var a = app[s.id];
    if (!a || !s.app) return '';
    if (a.need && a.reason === 'expired') return 'expired';
    return a.ok && a.raw && nameDiffers(a.raw.who, s.name) ? 'other' : '';
  }
  var WARN_TIP = { expired: '앱 공유 링크가 만료되었습니다 — 누르면 새 링크를 넣는 칸', other: '앱에 등록된 이름이 이 학생과 다릅니다 — 다른 학생 링크일 수 있습니다 · 누르면 링크 바꾸기' };
  function warnHtml(s) {
    var w = linkWarn(s);
    if (!w) return '';
    var a = app[s.id], who = w === 'other' && a && a.raw ? a.raw.who : '';
    return '<button type="button" class="tdc-warn" data-app-relink="' + esc(s.id) + '" data-warn="' + w + '" title="' + esc(WARN_TIP[w] + (who ? ' (앱 이름: ' + who + ')' : '')) + '">링크 확인 필요</button>';
  }
  /* 과제 칩 색 — 5일(다 냄) 초록 · 3~4일 파랑 · 1~2일 주황 · 0일 빨강 (레포트 발송 · 과제 상세와 같은 색 · 20261031e) */
  function hwTone(done, days) { return AppWeek.tone ? AppWeek.tone(done, days) : done >= days ? 'ok' : done >= 3 ? 'mid' : done >= 1 ? 'low' : 'zero'; }
  var NEED_TIP = { nolink: '앱 공유 링크가 아직 없습니다', nohub: '학부모 링크가 없어 과제 기록을 못 부릅니다', expired: '앱 공유 링크가 만료되었습니다 — 새 링크를 붙여 넣어 주세요' };
  /* 과제 「n/5일」 — 그 반 지난 수업 레포트 기간(D-7 ~ D-1)의 평일 중 제출한 날 (토 · 일은 세지 않는다) */
  function appCell(s, cy, lessonDate) {
    var x = appState(s, cy, lessonDate);
    if (x.k === 'need' && x.why === 'expired') return warnHtml(s) || '<button type="button" class="tdc-warn" data-app-relink="' + esc(s.id) + '" data-warn="expired">링크 확인 필요</button>';
    if (x.k === 'need') return '<button type="button" class="tdc-link-btn" data-app-link="' + esc(s.id) + '" aria-expanded="' + (window.AppLink && AppLink.current() === s.id) + '" title="' + esc((NEED_TIP[x.why] || NEED_TIP.nolink) + ' · 누르면 바로 아래에 링크 칸') + '">+ 과제 링크 연결</button>';
    if (x.k === 'wait') return '<span class="tdc-app tdc-app--wait" title="과제 기록 불러오는 중"><i class="spin" aria-hidden="true"></i>과제 불러오는 중</span>';
    if (x.k === 'fail') return '<button type="button" class="tdc-app tdc-app--fail" data-app-retry="' + esc(s.id) + '">과제 기록 못 불러옴 · 다시 시도</button>';
    if (x.k === 'nosched') return '<span class="tdc-app tdc-app--none" title="수업 요일을 정하면 그 수업 전 일주일 과제를 셉니다">과제 · 수업일 정하면 보임</span>';
    var w = x.w;
    if (!w) {
      var lw = AppWeek.lastWeek(lessonDate || (cy && cy.L)), a0 = app[s.id];
      var nw = lw && a0 && a0.data ? AppWeek.compute(a0.data, lw.from, lw.to, DDay.today()) : null;
      if (nw && nw.allNew) return '<span class="tdc-app tdc-app--none tdc-app--new" title="수강 시작 전 기간 — 세지 않습니다 · 다음 레포트부터 과제 기록이 보입니다">신입생</span>';
      return '<span class="tdc-app tdc-app--none" title="그 수업 전 일주일에 앱 과제가 하나도 없었습니다">과제 없음(이 기간)</span>';
    }
    var k = hwTone(w.hwDone, w.hwDays);
    /* 누르면 그 학생 줄 아래 기간 · 날짜별 표 (마우스를 올리면 한 줄 말풍선 · 20261031f) */
    var L = lessonDate || (cy && cy.L) || '', tip = tipOf(w);
    return '<button type="button" class="tdc-app tdc-app--' + k + ' tdc-app--btn num" data-app-detail="' + esc(s.id) + '" data-app-from="' + esc(w.from) + '" data-app-to="' + esc(w.to) + '" data-app-lesson="' + esc(L) + '" data-tip="' + esc(tip) + '"' +
      ' aria-expanded="' + (det.sid === s.id && det.from === w.from) + '" aria-label="' + esc('과제 ' + w.hwDone + '/' + w.hwDays + '일 · ' + tip + ' · 누르면 날짜별 표') + '">과제 ' + w.hwDone + '/' + w.hwDays + '일</button>' + warnHtml(s);
  }

  /* ---------- 과제 칩 → 기간 · 날짜별 표 (20261031f) ----------
     칩을 누르면 그 학생 줄 바로 아래에 펼친다 (다시 누르면 접힘 · 한 번에 한 학생). 이미 불러온 과제 기록만 쓴다 (새로 부르지 않는다)
       맨 위 「10/15(목) ~ 10/21(수) · 10/22(목) 수업 레포트 기준」
       7칸 — 날짜 · 요일 / 과제 ● 정시 ◐ 늦게 ○ 미제출 (과제 없는 날 빈칸) / 강의 ✓ 다 봄 – 안 봄 · 토 · 일은 두 줄을 합친 「주중 복습」
       칸을 누르면 「10/19(월) 독서 1지문 · 23:40 제출(늦게)」 · 맨 아래 [과제 상세 보기 →] (러닝노트 과제 상세)
     「오늘」 · 레포트 발송 · 학생 명단이 같이 쓴다 — 줄을 다시 그린 뒤 paintDetail() 이 표를 다시 붙인다 */
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function mdw(iso) { return md(iso) + '(' + DOWK[Lesson.dowOf(iso)] + ')'; }
  function tipOf(w) { return mdw(w.from) + ' ~ ' + mdw(w.to) + ' · 평일 ' + w.hwDays + '일 중 ' + w.hwDone + '일 제출'; }
  var det = { sid: '', from: '', to: '', lesson: '', live: false, day: '' };
  function closedDet() { return { sid: '', from: '', to: '', lesson: '', live: false, day: '' }; }

  /* ---------- 과제 수정 — 7칸 표에서 칸을 누르면 그날 과제 아래 [고치기] (hwfix.js · 20261031j) ----------
     정시 제출 · 늦게 제출 · 미제출 · 면제(셈에서 뺌) 중 하나 + 사유(앱 오류 · 종이로 제출 · 결석으로 면제 · 기타 직접 입력)를 꼭 고른다
     고친 칸에는 작은 「수정」 — 누르면 「원래 앱: 미제출 → 수정: 정시 제출 · 종이로 제출 · 김OO 10/25 10:12」 · [원래대로]
     이미 공개한 레포트 기간이면 「다시 공개해야 학부모에게 반영됩니다」 · 수정 기록은 지우지 않는다 (원래대로도 한 줄) */
  var fx = { edit: false, st: '', rs: '', other: '', err: '', busy: false };
  function fxReset() { fx = { edit: false, st: '', rs: '', other: '', err: '', busy: false }; }
  var FIX_NAME = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제', off: '과제 없음' };
  var FIX_OPT = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제(셈에서 뺌)' };
  var FIX_RS = [['앱 오류', '앱 오류'], ['종이로 제출', '종이로 제출'], ['결석으로 면제', '결석으로 면제'], ['기타', '기타 직접 입력']];
  /* 앱이 준 그날 상태 (고치기 전 · onTime | late | none | off) */
  function appStatusOf(sid, day) {
    var a = app[sid], c = a && a.raw ? (a.raw.calendar || []).find(function (x) { return x && x.date === day; }) : null;
    return !c ? 'off' : c.status === 'onTime' || c.status === 'late' ? c.status : 'none';
  }
  function fxReason() { return fx.rs === '기타' ? fx.other.trim() : fx.rs; }
  function fxReady() { return !!fx.st && !!fxReason() && !fx.busy; }
  function fixHtml(sid, d) {
    if (!window.HwFix || d.weekend || d.hw === 'future' || d.hw === 'off') return '';
    var x = HwFix.activeOf(sid, d.date), rows = HwFix.rowsOf(sid, d.date), was = appStatusOf(sid, d.date);
    var cut = HwFix.cutKnown(sid);
    if (cut === null) HwFix.cutOf(sid).then(function (v) { if (v && det.sid === sid && det.day === d.date) paintDetail(); });
    var pub = !!cut && d.date <= cut;
    var h = '<div class="hd-fix">';
    if (x) h += '<p class="hd-fix__was"><i class="hd-fx">수정</i> 원래 앱: ' + esc(FIX_NAME[was]) + ' → 수정: ' + esc(FIX_NAME[x.status]) + ' · ' + esc(x.reason) + (HwFix.stamp(x) ? ' · ' + esc(HwFix.stamp(x)) : '') + '</p>';
    if (!fx.edit) {
      h += '<div class="hd-fix__act"><button type="button" class="btn btn--sm" data-hd-fix="open">' + (x ? '다시 고치기' : '고치기') + '</button>' +
        (x ? '<button type="button" class="btn btn--sm btn--ghost" data-hd-fix="revert"' + (fx.busy ? ' disabled' : '') + '>원래대로</button>' : '') + '</div>';
    } else {
      h += '<div class="hd-fix__form" role="group" aria-label="' + esc(mdw(d.date) + ' 과제 고치기') + '">' +
        '<p class="hd-fix__q">바꿀 상태</p><div class="hd-fix__opts">' + HwFix.STATUSES.map(function (k) {
          return '<button type="button" class="hd-fix__o' + (fx.st === k ? ' is-on' : '') + '" data-hd-st="' + k + '" aria-pressed="' + (fx.st === k) + '">' + FIX_OPT[k] + '</button>';
        }).join('') + '</div>' +
        '<p class="hd-fix__q">사유 <small>(꼭 고르기)</small></p><div class="hd-fix__opts">' + FIX_RS.map(function (r) {
          return '<button type="button" class="hd-fix__o' + (fx.rs === r[0] ? ' is-on' : '') + '" data-hd-rs="' + esc(r[0]) + '" aria-pressed="' + (fx.rs === r[0]) + '">' + esc(r[1]) + '</button>';
        }).join('') + '</div>' +
        (fx.rs === '기타' ? '<input class="input hd-fix__other" data-hd-other type="text" maxlength="100" placeholder="사유를 적어 주세요" aria-label="기타 사유" value="' + esc(fx.other) + '">' : '') +
        '<div class="hd-fix__act"><button type="button" class="btn btn--sm btn--primary" data-hd-fix="save"' + (fxReady() ? '' : ' disabled') + '>' + (fx.busy ? '저장하는 중…' : '저장') + '</button>' +
        '<button type="button" class="btn btn--sm" data-hd-fix="cancel">취소</button></div>' +
        '<p class="hd-fix__hint">' + (fx.err ? '<b role="alert">' + esc(fx.err) + '</b>' : '앱 기록은 그대로 두고 코치룸에 「과제 수정」으로 따로 남깁니다 · 원래 앱: ' + esc(FIX_NAME[was])) + '</p>' +
      '</div>';
    }
    if (pub && (x || fx.edit)) h += '<p class="hd-fix__pub">이미 공개한 레포트 기간입니다 — 고치면 다시 공개해야 학부모에게 반영됩니다</p>';
    if (rows.length) h += '<details class="hd-fix__log"><summary>수정 기록 ' + rows.length + '건</summary><ol>' + rows.slice().reverse().map(function (r) {
      return '<li>' + (r.status === 'app' ? '원래대로(앱 값)' : esc(FIX_NAME[r.status]) + ' · ' + esc(r.reason)) + (HwFix.stamp(r) ? ' · ' + esc(HwFix.stamp(r)) : '') + '</li>';
    }).join('') + '</ol></details>';
    return h + '</div>';
  }
  function fxDone(res, msg, sid, day) {
    fx.busy = false;
    if (!res || !res.ok) { fx.err = (res && res.message) || '저장하지 못했습니다'; paintDetail(); return; }
    var cut = HwFix.cutKnown(sid);
    fxReset();
    paintDetail();
    if (window.UI && UI.toast) UI.toast(msg + (cut && day <= cut ? ' · 이미 공개한 레포트 기간이라 다시 공개해야 학부모에게 반영됩니다' : ''), 'good');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-hd-fix], [data-hd-st], [data-hd-rs]');
    if (!b || !det.sid || !det.day || !window.HwFix) return;
    e.preventDefault();
    e.stopPropagation();
    var sid = det.sid, day = det.day;
    if (b.hasAttribute('data-hd-st')) { fx.st = b.dataset.hdSt; fx.err = ''; paintDetail(); return; }
    if (b.hasAttribute('data-hd-rs')) {
      fx.rs = b.dataset.hdRs; fx.err = '';
      if (fx.rs === '결석으로 면제' && !fx.st) fx.st = 'exempt';
      paintDetail();
      if (fx.rs === '기타') { var inp = document.querySelector('[data-hd-other]'); if (inp) inp.focus(); }
      return;
    }
    var act = b.dataset.hdFix;
    if (act === 'open') { fxReset(); fx.edit = true; paintDetail(); return; }
    if (act === 'cancel') { fxReset(); paintDetail(); return; }
    if (act === 'save') {
      if (!fxReady()) { fx.err = !fx.st ? '바꿀 상태를 골라 주세요' : '사유를 골라 주세요'; paintDetail(); return; }
      var was = appStatusOf(sid, day);
      if (fx.st === was && !HwFix.activeOf(sid, day)) { fx.err = '앱 기록과 같습니다 — 다른 상태를 골라 주세요'; paintDetail(); return; }
      var to = fx.st;
      fx.busy = true; paintDetail();
      HwFix.save(sid, day, to, fxReason(), was).then(function (res) { fxDone(res, mdw(day) + ' 과제를 「' + FIX_NAME[to] + '」로 고쳤습니다', sid, day); });
      return;
    }
    if (act === 'revert') {
      fx.busy = true; paintDetail();
      HwFix.revert(sid, day, appStatusOf(sid, day)).then(function (res) { fxDone(res, mdw(day) + ' 과제를 원래 앱 기록(' + FIX_NAME[appStatusOf(sid, day)] + ')으로 되돌렸습니다', sid, day); });
    }
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-hd-other')) return;
    fx.other = t.value;
    Array.prototype.forEach.call(document.querySelectorAll('[data-hd-fix="save"]'), function (b) { b.disabled = !fxReady(); });
  });
  /* 수정값이 바뀌면 (이 화면 · 다른 직원) — 덮은 값을 다시 만들고 과제 칸 · 평균을 다시 */
  window.addEventListener('jt:hwfix', function () {
    Object.keys(app).forEach(function (sid) { var a = app[sid]; if (a && a.raw) a.data = fixed(sid, a.raw); });
    if (!st.data) return;
    Object.keys(app).forEach(paintApp);
    paintAvg();
    if (det.sid) paintDetail();
  });
  /* 제출 시각 「23:40」 — 시간대가 붙은 값은 한국 시각으로, 없으면 적힌 그대로 */
  function hhmm(v) {
    var x = String(v || '');
    if (!/T\d\d:\d\d/.test(x)) return '';
    if (/(Z|[+-]\d\d:?\d\d)$/i.test(x)) { var d = new Date(Date.parse(x) + 9 * 3600000); return isNaN(d) ? '' : String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
    return x.slice(11, 16);
  }
  function kstDay(v) {
    var x = String(v || '');
    if (/(Z|[+-]\d\d:?\d\d)$/i.test(x) && /T/.test(x)) { var d = new Date(Date.parse(x) + 9 * 3600000); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
    return x.slice(0, 10);
  }
  function dayInfo(data, d) {
    var date = d.date;
    var c = (data.calendar || []).find(function (x) { return x.date === date; });
    var hs = (data.history || []).filter(function (h) { return (c && c.order && h.order === c.order) || (!(c && c.order) && kstDay(h.submittedAt) === date); });
    var lec = c && c.order ? (data.lectures || []).find(function (l) { return l.order === c.order; }) : null;
    var title = (hs[0] && hs[0].title) || (lec && lec.title) || (d.weekend ? '주중 복습' : '과제');
    var h = hs.filter(function (x) { return x.submittedAt; }).pop();
    var how = d.hw === 'onTime' ? '정시' : d.hw === 'late' ? '늦게' : '';
    var tail = '';
    if (h && (d.hw === 'onTime' || d.hw === 'late' || d.weekend)) {
      var sd = kstDay(h.submittedAt);
      tail = (sd && sd !== date ? md(sd) + ' ' : '') + hhmm(h.submittedAt) + ' 제출' + (how ? '(' + how + ')' : '');
    } else if (d.hw === 'onTime' || d.hw === 'late') tail = '제출(' + how + ')';
    else if (d.hw === 'none') tail = '미제출';
    else if (d.hw === 'future') tail = '아직 오지 않은 날';
    else if (d.hw === 'today') tail = '오늘 — 밤 12시 마감 전 (아직 세지 않음)';
    else if (d.weekend) tail = '제출 기록 없음';
    return mdw(date) + ' ' + title + (tail ? ' · ' + tail.replace(/^ /, '') : '');
  }
  var HW_MARK = { onTime: '●', late: '◐', none: '○', exempt: '면제', off: '', future: '', today: '오늘' };
  var HW_NAME = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제', off: '과제 없음', future: '아직', today: '오늘 — 마감 전 (아직 세지 않음)' };
  var LEC_MARK = { done: '✓', todo: '–', off: '', future: '', today: '오늘' };
  /* 오늘은 밤 12시 마감 전 — 아직 안 냈으면 연하게 「오늘」 · 세지 않음 (AppWeek · 20261031v) */
  function detailHtml(sid, from, to, lesson, live) {
    var a = app[sid];
    if (!a || !a.ok || !a.data || !from || !to || !window.AppWeek) return '';
    var w = AppWeek.compute(a.data, from, to, DDay.today());
    if (!w) return '';
    var n = w.days.length, cells = '<span class="hd-lab" style="grid-column:1;grid-row:2">과제</span><span class="hd-lab" style="grid-column:1;grid-row:3">강의</span>';
    var pick = null;
    w.days.forEach(function (d, i) {
      var col = 'grid-column:' + (i + 2) + ';';
      var on = det.day === d.date;
      if (on) pick = d;
      cells += '<span class="hd-h' + (d.weekend ? ' hd-h--wk' : '') + '" style="' + col + 'grid-row:1"><b class="num">' + (+d.date.slice(8)) + '</b>' + d.dow + '</span>';
      if (d.hw === 'new') {
        cells += '<span class="hd-c hd-c--new" style="' + col + 'grid-row:2 / span 2" aria-label="' + esc(mdw(d.date) + ' 신입생 — 수강 시작 전 (세지 않음)') + '">신입생</span>';
        return;
      }
      if (d.weekend) {
        cells += '<button type="button" class="hd-c hd-c--wk' + (d.hw === 'wkDone' ? ' is-done' : '') + (on ? ' is-pick' : '') + '" style="' + col + 'grid-row:2 / span 2" data-hd-day="' + d.date + '" aria-label="' + esc(mdw(d.date) + ' 주중 복습' + (d.hw === 'wkDone' ? ' 제출' : '')) + '">주중<br>복습' + (d.hw === 'wkDone' ? '<b>✓</b>' : '') + '</button>';
        return;
      }
      var fxr = window.HwFix ? HwFix.activeOf(sid, d.date) : null;
      cells += (d.hw === 'off'
        ? '<span class="hd-c hd-c--off" style="' + col + 'grid-row:2" aria-label="' + esc(mdw(d.date) + ' 과제 없음') + '"></span>'
        : '<button type="button" class="hd-c hd-c--' + d.hw + (fxr ? ' is-fixed' : '') + (on ? ' is-pick' : '') + '" style="' + col + 'grid-row:2" data-hd-day="' + d.date + '" aria-label="' + esc(mdw(d.date) + ' ' + HW_NAME[d.hw] + (fxr ? ' (수정)' : '')) + '">' + HW_MARK[d.hw] +
            (fxr ? '<i class="hd-fx" aria-hidden="true">수정</i>' : '') + '</button>') +
        '<span class="hd-l hd-l--' + d.lec + '" style="' + col + 'grid-row:3">' + LEC_MARK[d.lec] + '</span>';
    });
    return '<div class="hd-box" data-hd-box="' + esc(sid) + '">' +
      '<div class="hd-head num">' + esc(mdw(w.from) + ' ~ ' + mdw(w.to) + (live ? ' · 진행 중' + (lesson ? ' (' + mdw(lesson) + ' 수업 레포트 기간)' : '') : lesson ? ' · ' + mdw(lesson) + ' 수업 레포트 기준' : '')) + '</div>' +
      '<div class="hd-grid" style="grid-template-columns:2.4em repeat(' + n + ', minmax(0, 1fr))">' + cells + '</div>' +
      (pick ? '<p class="hd-pick">' + esc(dayInfo(a.data, pick)) + '</p>' + fixHtml(sid, pick) : '') +
      '<p class="hd-legend">● 정시 제출 ◐ 늦게 제출 ○ 미제출 · 빈칸 그날 과제 없음 / ✓ 강의 다 봄 – 안 봄 · 「오늘」 = 밤 12시 마감 전(아직 세지 않음) · 토 · 일은 주중 복습 · 칸을 누르면 그날 과제 · 「수정」 = 조교가 고친 칸</p>' +
      '<div class="hd-foot"><button type="button" class="hd-relink" data-app-relink="' + esc(sid) + '" aria-expanded="' + !!(window.AppLink && AppLink.current() === sid && AppLink.editing()) + '">링크 바꾸기</button>' +
        '<button type="button" class="hd-more" data-pv="parent" data-pv-view="app" data-sid="' + esc(sid) + '">과제 상세 보기 →</button>' +
        (window.AppLink && AppLink.openHtml ? AppLink.openHtml(sid, { noAdd: true, cls: 'hd-open' }) : '') + '</div>' +
    '</div>';
  }
  /* 펼친 표를 그 칩이 있는 줄 아래에 다시 붙인다 (칩의 기준 수업일이 같은 곳만) */
  function paintDetail() {
    Array.prototype.forEach.call(document.querySelectorAll('.hd-box, .hd-tr'), function (el) { el.parentNode.removeChild(el); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-app-detail]'), function (b) {
      b.setAttribute('aria-expanded', String(b.dataset.appDetail === det.sid && b.dataset.appFrom === det.from));
    });
    if (!det.sid) return;
    var html = detailHtml(det.sid, det.from, det.to, det.lesson, det.live);
    if (!html) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-app-detail="' + det.sid + '"]'), function (b) {
      if (b.dataset.appFrom !== det.from) return;
      var row = b.closest('.tdc-st, .snd-row, .fieldline--app, tr');
      if (!row) return;
      if (row.tagName === 'TR') {
        var tr = document.createElement('tr');
        tr.className = 'hd-tr';
        tr.innerHTML = '<td colspan="' + row.children.length + '">' + html + '</td>';
        row.parentNode.insertBefore(tr, row.nextSibling);
      } else row.insertAdjacentHTML('beforeend', html);
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-app-detail], [data-hd-day]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.hasAttribute('data-hd-day')) { det.day = det.day === b.dataset.hdDay ? '' : b.dataset.hdDay; fxReset(); paintDetail(); return; }
    var same = det.sid === b.dataset.appDetail && det.from === b.dataset.appFrom;
    fxReset();
    det = same ? closedDet() : { sid: b.dataset.appDetail, from: b.dataset.appFrom, to: b.dataset.appTo, lesson: b.dataset.appLesson || '', live: b.dataset.appLive === '1', day: '' };
    paintDetail();
  }, true);
  /* ---------- 세 기간 (20261031g) ----------
     반마다 — 지지난 레포트 기간 「10/8~14」 · 가장 최근 레포트 기간 「10/15~21」 · 진행 중 「진행 중 10/22~」
       레포트 기간 = 그 수업 전 일주일 (D-7 ~ D-1 · AppWeek.lastWeek) — 가장 최근 수업 L1(오늘 포함) · 그 앞 수업 L0
       진행 중 = L1 ~ 오늘 (다음 수업 전날까지의 기간 · 오늘은 아직 안 냈으면 세지 않고 냈으면 센다 — AppWeek 「오늘」 기준 20261031v · 토 · 일은 세지 않는다)
     반이 사이트를 쓰기 시작한 날(첫 수업일) 앞 수업은 넣지 않는다 (칩과 같다) */
  function periodsOf(cls) {
    var ds = lessonDates(cls);
    if (!ds || !window.AppWeek) return null;
    var today = DDay.today(), sc = Store.schedOf(cls), first = (sc && sc.first) || '';
    var past = ds.filter(function (d) { return d <= today && (!first || d >= first); });
    var L1 = past[past.length - 1] || '', L0 = past[past.length - 2] || '';
    var N = ds.filter(function (d) { return d > today; })[0] || '';
    if (!L1 && !N) return null;
    var rep = function (L) { if (!L) return null; var x = AppWeek.lastWeek(L); return { from: x.from, to: x.to, lesson: L, live: false }; };
    return {
      prev: rep(L0), recent: rep(L1),
      now: L1 ? { from: L1, to: N ? Lesson.addDays(N, -1) : Lesson.addDays(L1, 6), lesson: N, live: true } : null
    };
  }
  var PKEYS = ['prev', 'recent', 'now'];
  function dayOf(iso) { return +iso.slice(8, 10); }
  function perLabel(p) { return p.live ? '진행 중 ' + md(p.from) + '~' : md(p.from) + '~' + (p.from.slice(5, 7) === p.to.slice(5, 7) ? dayOf(p.to) : md(p.to)); }
  function perShort(p) { return p.live ? '진행' : md(p.from) + '~'; }
  function perTip(p) {
    return p.live ? mdw(p.from) + ' ~ 오늘 · 진행 중' + (p.lesson ? ' (' + mdw(p.lesson) + ' 수업 레포트 기간)' : '')
      : mdw(p.from) + ' ~ ' + mdw(p.to) + ' · ' + mdw(p.lesson) + ' 수업 레포트 기간';
  }
  /* 학생 한 명 · 한 기간 — { k: ok | none | pre, done, days, from, to } */
  function perVal(s, p) {
    var a = app[s.id];
    if (!p || !a || !a.ok || !a.data) return null;
    if (p.live) {
      var t0 = DDay.today(), to = p.to < t0 ? p.to : t0;
      if (to < p.from || !weekdays(p.from, to)) return { k: 'pre' };
      var wl = AppWeek.compute(a.data, p.from, to, t0);
      if (wl && wl.hwDays) return { k: 'ok', done: wl.hwDone, days: wl.hwDays, from: p.from, to: to };
      /* 아직 센 날이 없고 오늘만 남았으면(마감 전) 「아직」 */
      return { k: wl && wl.allNew ? 'new' : wl && !wl.days.some(function (x) { return !x.weekend && x.date < t0; }) ? 'pre' : 'none' };
    }
    var w = AppWeek.compute(a.data, p.from, p.to, DDay.today());
    return w && w.hwDays ? { k: 'ok', done: w.hwDone, days: w.hwDays, from: p.from, to: p.to } : { k: w && w.allNew ? 'new' : 'none' };
  }

  /* ---------- 학생 줄 정렬 — 머리칸을 누르면 그 기간 기준 (많이 한 순 ↔ 적게 한 순 · 20261031g) ----------
     기본은 가장 최근 레포트 기간 · 많이 한 순. 비율 → 제출한 날 → 이름순 · 숫자가 없는 학생은 그 아래 · 「+ 과제 링크 연결」은 맨 아래
     모든 반에 같이 적용 · 이 기기에 기억 (mhub.appSort = most | least · mhub.appSortP = prev | recent | now)
     레포트 발송 학생 목록은 그 레포트 기간 하나로 같은 방향(sortStudents) */
  var SORT_KEY = 'mhub.appSort', SORTP_KEY = 'mhub.appSortP';
  function appSort() { try { return localStorage.getItem(SORT_KEY) === 'least' ? 'least' : 'most'; } catch (e) { return 'most'; } }
  function appSortP() { try { var v = localStorage.getItem(SORTP_KEY); return PKEYS.indexOf(v) !== -1 ? v : 'recent'; } catch (e) { return 'recent'; } }
  function setAppSort(v, pk) {
    try {
      localStorage.setItem(SORT_KEY, v === 'least' ? 'least' : 'most');
      if (pk) localStorage.setItem(SORTP_KEY, pk);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('jt:appsort'));
  }
  /* 머리칸 — 같은 칸이면 방향만 바꾸고, 다른 칸이면 그 칸 · 많이 한 순 */
  function sortByHead(pk) { setAppSort(appSortP() === pk ? (appSort() === 'most' ? 'least' : 'most') : 'most', pk); }
  function sortKeyOf(s, c) {
    var x = appState(s, c.cy);
    if (x.k === 'need') return { g: 3 };
    var v = c.per ? perVal(s, c.per[appSortP()]) : null;
    return v && v.k === 'ok' ? { g: 0, r: v.done / v.days, n: v.done } : { g: x.k === 'wait' || x.k === 'fail' ? 2 : 1 };
  }
  function sortRows(rows, c) {
    var dir = appSort() === 'least' ? 1 : -1;
    return rows.map(function (s) { return { s: s, k: sortKeyOf(s, c) }; }).sort(function (a, b) {
      if (a.k.g !== b.k.g) return a.k.g - b.k.g;
      if (a.k.g === 0 && a.k.r !== b.k.r) return (a.k.r - b.k.r) * dir;
      if (a.k.g === 0 && a.k.n !== b.k.n) return (a.k.n - b.k.n) * dir;
      return byName(a.s, b.s);
    }).map(function (x) { return x.s; });
  }
  /* 레포트 발송 — 그 레포트 기간 칩 하나 (예전과 같은 정렬 · 방향만 같이 씀) */
  function sortByLesson(rows, cy, lessonDate) {
    var dir = appSort() === 'least' ? 1 : -1;
    return rows.map(function (s) {
      var x = appState(s, cy, lessonDate);
      return { s: s, g: x.k === 'need' ? 2 : x.k === 'ok' ? 0 : 1, r: x.w ? x.w.hwDone / x.w.hwDays : 0, n: x.w ? x.w.hwDone : 0 };
    }).sort(function (a, b) {
      if (a.g !== b.g) return a.g - b.g;
      if (a.g === 0 && a.r !== b.r) return (a.r - b.r) * dir;
      if (a.g === 0 && a.n !== b.n) return (a.n - b.n) * dir;
      return byName(a.s, b.s);
    }).map(function (x) { return x.s; });
  }
  /* 레포트 발송 목록 머리줄의 작은 글자 버튼 두 개 (그 화면은 기간이 하나라 예전처럼) */
  function sortBarHtml() {
    var v = appSort();
    return '<span class="app-sort" role="group" aria-label="학생 줄 정렬">' +
      [['most', '많이 한 순'], ['least', '적게 한 순']].map(function (o) {
        return '<button type="button" class="app-sort__b' + (v === o[0] ? ' is-on' : '') + '" data-app-sort="' + o[0] + '" aria-pressed="' + (v === o[0]) + '" title="과제 ' + o[1] + ' (이 기기에 기억)">' + o[1] + '</button>';
      }).join('') + '</span>';
  }
  /* 세 기간 머리칸 — 마우스를 올리면 전체 기간 · 누르면 그 기간 정렬 · 지금 기준 칸에 ▼(많이 한 순) ▲(적게 한 순) */
  function headHtml(c) {
    if (!c.per) return '<span class="tdc-tri tdc-tri--head" aria-hidden="true"></span>';
    var pk = appSortP(), dir = appSort();
    return '<span class="tdc-tri tdc-tri--head" role="group" aria-label="과제 기간 (누르면 그 기간으로 정렬)">' + PKEYS.map(function (k) {
      var p = c.per[k];
      if (!p) return '<span class="tdc-th tdc-th--empty"></span>';
      var on = pk === k, tip = perTip(p);
      return '<button type="button" class="tdc-th' + (p.live ? ' is-live' : '') + (on ? ' is-on' : '') + '" data-app-sortp="' + k + '" data-tip="' + esc(tip) + '" aria-pressed="' + on + '"' +
        ' aria-label="' + esc(tip + (on ? ' · 지금 ' + (dir === 'most' ? '많이 한 순' : '적게 한 순') : '') + ' · 누르면 이 기간으로 정렬') + '">' +
        '<span class="hd-full">' + esc(perLabel(p)) + '</span><span class="hd-short">' + esc(perShort(p)) + '</span>' + (on ? '<i class="tdc-th__dir">' + (dir === 'most' ? '▼' : '▲') + '</i>' : '') + '</button>';
    }).join('') + '</span>';
  }
  /* 학생 줄 세 칸 — 숫자 칩만 「4/5」 (100% 초록 · 60~80% 파랑 · 20~40% 주황 · 0% 빨강) · 진행 중은 점선 ·
     링크 없는 학생은 세 칸을 합쳐 [+ 과제 링크 연결] 하나 · 불러오는 중 · 못 불러옴 · 수업일 미정도 세 칸을 합친다 */
  function triHtml(s, c) {
    var x = appState(s, c.cy);
    var span = function (h) { return '<span class="tdc-tri__span">' + h + '</span>'; };
    if (x.k === 'need' || x.k === 'wait' || x.k === 'fail') return span(appCell(s, c.cy));
    if (!c.per) return span('<span class="tdc-app tdc-app--none">과제 · 수업일 정하면 보임</span>');
    if (!c.per.recent && !c.per.now) return span('<span class="tdc-app tdc-app--none">과제 · 첫 수업 뒤부터 보임</span>');
    return PKEYS.map(function (k) {
      var p = c.per[k];
      if (!p) return '<span class="tdc-tc tdc-tc--empty" aria-hidden="true"></span>';
      var v = perVal(s, p), live = p.live ? ' is-live' : '';
      if (!v || v.k === 'pre') return '<span class="tdc-tc tdc-tc--muted' + live + '" title="' + esc(perTip(p)) + '">시작 전</span>';
      if (v.k === 'new') return '<span class="tdc-tc tdc-tc--muted tdc-tc--new' + live + '" title="' + esc(perTip(p) + ' — 신입생 (수강 시작 전 · 세지 않음)') + '">신입생</span>';
      if (v.k === 'none') return '<span class="tdc-tc tdc-tc--muted' + live + '" title="' + esc(perTip(p) + ' — 앱 과제 없음') + '">없음</span>';
      var tip = mdw(v.from) + ' ~ ' + mdw(v.to) + ' · 평일 ' + v.days + '일 중 ' + v.done + '일 제출' + (p.live ? ' (진행 중 · 오늘은 내면 셈)' : '');
      return '<button type="button" class="tdc-tc tdc-app--btn tdc-app--' + hwTone(v.done, v.days) + live + ' num" data-app-detail="' + esc(s.id) + '" data-app-from="' + esc(p.from) + '" data-app-to="' + esc(p.to) + '" data-app-lesson="' + esc(p.lesson || '') + '"' + (p.live ? ' data-app-live="1"' : '') +
        ' data-tip="' + esc(tip) + '" aria-expanded="' + (det.sid === s.id && det.from === p.from) + '" aria-label="' + esc(v.done + '/' + v.days + ' · ' + tip + ' · 누르면 날짜별 표') + '">' + v.done + '/' + v.days + '</button>';
    }).join('');
  }
  function toggleBar(key, n, open, c) {
    return '<div class="tdc-togglebar' + (open && c ? ' tdc-grid' : '') + '"><button type="button" class="tdc-toggle" data-toggle aria-expanded="' + open + '"><span class="tg-x">학생 </span>' + n + '명 <span class="tg-x">' + (open ? '접기 ' : '보기 ') + '</span>' + (open ? '▴' : '▾') + '</button>' +
      (open && c ? headHtml(c) + '<span class="tdc-grid__rest" aria-hidden="true"></span>' : '') + '</div>';
  }
  /* 반 카드 위 「+ 과제 링크 연결 필요 n명」 — 누르면 그 학생들 링크 칸이 차례로 펼쳐진다 (applink.js) */
  function needIds(rows, cy) { return rows.filter(function (s) { var x = appState(s, cy); return x.k === 'need' && x.why !== 'expired'; }).map(function (s) { return s.id; }); }
  function needBtn(ids) {
    return ids.length ? '<button type="button" class="tdc-link-btn tdc-need num" data-app-need="' + esc(ids.join(',')) + '" title="누르면 그 학생들 링크 칸이 차례로 펼쳐집니다">+ 과제 링크 연결 필요 ' + ids.length + '명</button>' : '';
  }
  function openAppLink(ids) { if (window.AppLink) AppLink.open(ids); }

  /* ---------- 과제 평균 (20261031g) ----------
     세 기간과 같다 — 「과제 평균  10/8~14 62% · 10/15~21 58% · 진행 중 40%」 (학생마다 제출한 날 / 과제 있던 날의 평균)
     80% 이상 초록 · 50~79% 파랑 · 50% 미만 주황 · 진행 중은 점선. 「+ 과제 링크 연결」 학생 · 못 불러온 학생은 빼고 「(링크 없는 2명 제외)」 */
  function avgOfPer(rows, cy, p) {
    var rates = [], need = 0, wait = 0, fail = 0, pre = true;
    rows.forEach(function (s) {
      var x = appState(s, cy);
      if (x.k === 'need') { need++; return; }
      if (x.k === 'wait') { wait++; return; }
      if (x.k === 'fail') { fail++; return; }
      var v = perVal(s, p);
      if (v && v.k !== 'pre') pre = false;
      if (v && v.k === 'ok') rates.push(v.done / v.days);
    });
    return { need: need, wait: wait, fail: fail, pre: pre, pct: rates.length ? Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length * 100) : null };
  }
  function avgTone(p) { return p >= 80 ? 'ok' : p >= 50 ? 'mid' : 'low'; }
  function weekdays(from, to) { var n = 0; for (var d = from; d <= to; d = Lesson.addDays(d, 1)) { var w = Lesson.dowOf(d); if (w !== 0 && w !== 6) n++; } return n; }
  function avgLineHtml(c) {
    if (c.name === '(반 없음)' || !c.rows.length || !c.per) return '';
    var ps = PKEYS.map(function (k) { return c.per[k]; }).filter(Boolean);
    if (!ps.length) return '';
    var avgs = ps.map(function (p) { return { p: p, a: avgOfPer(c.rows, c.cy, p) }; });
    var body;
    if (avgs.some(function (v) { return v.a.wait; })) body = '<span class="tdc-avg tdc-avg--wait"><i class="spin" aria-hidden="true"></i>불러오는 중</span>';
    else {
      body = '<span class="tdc-chips">' + avgs.map(function (v) {
        var name = v.p.live ? '진행 중' : perLabel(v.p), live = v.p.live ? ' is-live' : '', tip = perTip(v.p);
        if (v.p.live && v.a.pre) return '<span class="tdc-avg tdc-avg--none' + live + ' num" title="' + esc(tip) + '">진행 중 시작 전</span>';
        return v.a.pct === null
          ? '<span class="tdc-avg tdc-avg--none' + live + ' num" title="' + esc(tip + ' — 과제 기록이 있는 학생이 없습니다') + '">' + esc(name) + ' 과제 없음</span>'
          : '<span class="tdc-avg tdc-avg--' + avgTone(v.a.pct) + live + ' num" title="' + esc(tip + ' — 반 평균 과제율') + '">' + esc(name + ' ' + v.a.pct + '%') + '</span>';
      }).join('') + '</span>';
      var a0 = avgs[0].a, ex = [];
      if (a0.need) ex.push('링크 없는 ' + a0.need + '명');
      if (a0.fail) ex.push('못 불러온 ' + a0.fail + '명');
      if (ex.length) body += '<span class="tdc-line__note">(' + ex.join(' · ') + ' 제외)</span>';
    }
    return '<div class="tdc-line tdc-line--app" data-cls="' + esc(c.name) + '"><span class="tdc-line__t">과제 평균</span>' + body + '</div>';
  }
  function linesHtml(c, chips) {
    if (c.name === '(반 없음)' || !c.rows.length) return '';
    return (chips.length ? '<div class="tdc-line"><span class="tdc-line__t">레포트 발송</span><span class="tdc-chips" aria-label="최근 수업 레포트 발송">' + chips.map(function (x) { return chipHtml(c, x); }).join('') + '</span></div>' : '') +
      avgLineHtml(c) +
      (window.RNote ? RNote.cardLine(c.name, c.rows.length) : '');          /* 이번 복습 노트 연 학생 8/11 — 반 전체 숫자만 (20261031l) */
  }

  /* 학생 줄 — 이름 | 세 칸 | 버튼 (휴대폰에서는 버튼을 「⋯」 하나로 묶는다 · 20261031g) */
  function actsHtml(s) {
    var id = esc(s.id);
    var btns = '<button type="button" class="btn btn--sm" data-card="' + id + '">상담 카드</button>' +
      '<button type="button" class="btn btn--sm" data-sms-sid="' + id + '">문자</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-pv="parent" data-sid="' + id + '">학부모 화면 미리보기</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-pv="student" data-sid="' + id + '">학생 화면 미리보기</button>';
    /* [상담 +] — 휴대폰에서도 「⋯」 앞에 그대로 (quicknote.js · 20261031o) */
    return '<div class="tdc-st__acts">' + btns + (window.QuickNote ? QuickNote.btnHtml(s.id, s.name) : '') +
      '<details class="tdc-more"><summary class="btn btn--sm tdc-more__b" aria-label="' + esc(s.name) + ' 더 보기">⋯</summary><div class="tdc-more__menu">' + btns +
        (window.AppLink && AppLink.openHtml ? AppLink.openHtml(s.id, { noAdd: true, cls: 'btn btn--sm' }) : '') + '</div></details></div>';
  }
  /* 「신입」 — 수강 시작한 지 2주가 안 된 학생 (20261031q) */
  function newBadge(sid) {
    var x = stu(sid);
    return x && Store.isNew(x) ? '<span class="new-badge" title="' + esc('수강 시작 ' + md(Store.startOf(x))) + '">신입</span>' : '';
  }
  function studentRow(s, c) {
    return '<div class="tdc-st tdc-grid" data-id="' + esc(s.id) + '">' +
      '<div class="tdc-st__main">' + (window.Profile ? Profile.avatar({ id: s.id, name: s.name }, 's') : '') + '<span class="qn-namebox"><span class="qn-nameline"><button type="button" class="roster__name roster__name-btn" data-card="' + esc(s.id) + '">' + esc(s.name) + '</button>' + newBadge(s.id) + '</span>' + (window.QuickNote ? QuickNote.tagHtml(s.id) : '') + '</span>' + (linkWarn(s) === 'other' ? warnHtml(s) : '') + '</div>' +
      '<span class="tdc-app-slot tdc-tri">' + triHtml(s, c) + '</span>' +
      actsHtml(s) +
      (window.AppLink ? AppLink.boxHtml(s.id) : '') +
      (window.QuickNote ? QuickNote.slotHtml(s.id) : '') +
    '</div>';
  }

  /* 「오늘 할 일」 — 발송 안 한 레포트가 있는 반만 「목동반 · 10/20 레포트 안 보냄 12명 [보내기]」 · 없으면 「오늘 할 일 없음」 */
  /* 이름 — 3명까지는 다 · 넘으면 「홍민기 외 4명」(누르면 펼침) · 이름 옆 작은 회색 「짐작한 이유」 · 펼친 목록 이름 옆 ×(그 학생만 건너뛰기 · 20261031q) */
  function todoNames(u) {
    var ids = u.x.ids || [], key = u.cls + '|' + u.x.date, open = !!st.todoOpen[key] || ids.length <= 3;
    var one = function (id) {
      var s = rowById(id) || stu(id) || {}, why = whyOf(id, u.x.date, u.x.week);
      return '<span class="td-todo__nm">' + esc(s.name || '') + (why ? '<small class="td-guess">' + esc(why) + '</small>' : '') +
        (open ? '<button type="button" class="td-todo__x" data-skip1-sid="' + esc(id) + '" data-skip1-cls="' + esc(u.cls) + '" data-skip1-date="' + esc(u.x.date) + '" aria-label="' + esc((s.name || '') + ' 이 레포트 건너뛰기') + '" title="이 학생만 이 레포트를 보내지 않고 넘깁니다">×</button>' : '') + '</span>';
    };
    if (!ids.length) return '';
    if (open) return '<span class="td-todo__names">' + ids.map(one).join('') + (ids.length > 3 ? '<button type="button" class="td-todo__more" data-todo-open="' + esc(key) + '" aria-expanded="true">접기</button>' : '') + '</span>';
    return '<span class="td-todo__names">' + one(ids[0]) + '<button type="button" class="td-todo__more" data-todo-open="' + esc(key) + '" aria-expanded="false">외 ' + (ids.length - 1) + '명 ▾</button></span>';
  }
  function todoHtml(list) {
    return '<div class="td-todo"><div class="td-todo__title">오늘 할 일</div>' +
      (list.length ? '<ul class="td-todo__list">' + list.map(function (u) {
        return '<li class="td-todo__item' + (u.x.kind === 'none' ? ' is-urgent' : '') + '"><span class="td-todo__t">' +
          esc(u.cls + ' · ' + Lesson.md(u.x.date, false) + ' 레포트 안 보냄 ' + u.x.left + '명') + '</span>' + todoNames(u) +
          '<button type="button" class="btn btn--sm btn--primary td-todo__btn" data-go-send="' + esc(u.cls) + '" data-week="' + esc(u.x.week) + '">보내기</button>' +
          '<button type="button" class="btn btn--sm btn--ghost td-todo__btn" data-skip-cls="' + esc(u.cls) + '" data-skip-date="' + esc(u.x.date) + '" title="이 레포트를 보내지 않고 넘깁니다 (기록은 남음)">건너뛰기</button></li>';
      }).join('') + '</ul>' : '<p class="td-todo__none">오늘 할 일 없음</p>') + '</div>';
  }

  /* ---------- 챙길 학생 (20261031a) — 「오늘 할 일」 바로 아래 · 없으면 숨김 · 탭 배지에는 넣지 않는다 ----------
     복습테스트 안 낸 학생  마감(그 반 수업일 밤 12시)이 지났는데 제출 · 대신 입력 · 미응시 사유가 모두 없는 학생 (review_missing)
                           「고2 선수능반 · 10/22 복습테스트 안 낸 학생 2명 · 김가나, 이다라」 → 누르면 복습테스트 화면의 그 학생 줄
                           그 수업 레포트를 보내고 나면 사라진다
     결석 잦은 학생        설정의 결석 기준을 넘은 학생 「반포반 · 최근 4번 중 결석 2번 · 박마바」 → 누르면 상담 카드
                           마지막 결석 뒤에 상담 카드에 기록을 남기면 그 결석 건으로는 다시 뜨지 않는다 */
  var reviewMiss = [], care = { abs: {}, note: {} };
  function loadCare() {
    var from = Lesson.addDays(DDay.today(), -70);
    return Promise.all([
      sb().rpc('review_missing').then(function (r) { reviewMiss = r.error ? [] : (r.data || []); }, function () { reviewMiss = []; }),
      sb().from('entries').select('student_id,week_start').eq('attend_status', 'absent').gte('week_start', from).then(function (r) {
        care.abs = {};
        (r.data || []).forEach(function (x) { if (!care.abs[x.student_id] || care.abs[x.student_id] < x.week_start) care.abs[x.student_id] = x.week_start; });
      }, function () { care.abs = {}; }),
      sb().from('student_notes').select('student_id,created_at').gte('created_at', from).then(function (r) {
        care.note = {};
        (r.data || []).forEach(function (x) { var d = String(x.created_at || '').slice(0, 10); if (!care.note[x.student_id] || care.note[x.student_id] < d) care.note[x.student_id] = d; });
      }, function () { care.note = {}; })
    ]);
  }
  function careItems(d) {
    var set = d.settings || {}, byId = {}, out = [];
    d.students.forEach(function (s) { byId[s.id] = s; });
    /* 복습테스트 — 반 + 수업일마다 한 줄 (그 수업 레포트를 이미 보낸 학생은 뺀다) */
    var grp = {}, order = [];
    reviewMiss.forEach(function (x) {
      var s = byId[x.student_id];
      if (!s) return;
      var day = String(x.lesson_date).slice(0, 10), wk = weekOfDate(day);
      if ((st.recent[wk] || {})[s.id]) return;
      if (!Store.inLesson(stu(s.id), day)) return;                              /* 수강 시작일 앞 시험 — 미응시로 세지 않는다 (20261031q) */
      /* 「확인함」 묶음 · 이름 옆 × 로 뺀 학생 (skips.js · 20261031e) — 같은 수업이면 다시 뜨지 않는다 */
      if (checked('review', s.class_name || '', day, '') || checked('review', s.class_name || '', day, s.id)) return;
      var k = (s.class_name || '') + '|' + day;
      if (!grp[k]) { grp[k] = { cls: s.class_name || '', day: day, week: wk, ids: [] }; order.push(k); }
      if (grp[k].ids.indexOf(s.id) === -1) grp[k].ids.push(s.id);
    });
    order.forEach(function (k) {
      var g = grp[k];
      out.push({ kind: 'review', cls: g.cls, week: g.week, date: g.day, sid: g.ids[0], ids: g.ids,
        text: g.cls + ' · ' + Lesson.md(g.day, false) + ' 복습테스트 안 낸 학생 ' + g.ids.length + '명',
        names: g.ids.map(function (id) { return byId[id].name; }) });
    });
    /* 결석 잦은 학생 */
    d.students.forEach(function (s) {
      if (!(s.absent_n >= (set.absentMin || 2))) return;
      var last = care.abs[s.id];
      if (last && care.note[s.id] && care.note[s.id] >= last) return;          /* 마지막 결석 뒤에 상담 기록이 있으면 다시 띄우지 않는다 */
      if (checked('absent', s.class_name || '', last || '', s.id)) return;     /* 확인함 — 그 결석 건(마지막 결석 주)으로는 다시 뜨지 않는다 */
      out.push({ kind: 'absent', cls: s.class_name || '', sid: s.id, ids: [s.id], date: last || '', group: false,
        text: (s.class_name || '(반 없음)') + ' · 최근 ' + (set.absentWeeks || 4) + '번 중 결석 ' + s.absent_n + '번', names: [s.name] });
    });
    /* 결석생 — 자료 미배부 · 보강 영상 미신청 (반 + 수업마다 · 출석 체크에서 「배부」 「신청」으로 바꾸면 사라진다 · attend.js · 20261031i) */
    if (window.Attend) out = out.concat(Attend.careItems());
    return out;
  }
  function checked(kind, cls, date, sid) { return !!(window.Skips && Skips.checked(kind, cls, date, sid)); }
  /* 묶음마다 [확인함] · 학생 이름마다 [×] (그 학생만 빼기) · 아래 「확인함 기록 보기」에서 되돌리기 (skips.js · migration-036 · 20261031e)
     결석은 한 줄이 학생 한 명이라 [확인함] · [×] 모두 그 학생 그 결석 건 */
  function careHtml(items) {
    var hist = window.Skips ? Skips.history() : [];
    if (!items.length && !hist.length) return '';
    var attrs = function (it, sid) { return ' data-k="' + it.kind + '" data-cls="' + esc(it.cls) + '" data-date="' + esc(it.date || '') + '" data-sid="' + esc(sid || '') + '"'; };
    return '<div class="td-care2"><div class="td-todo__title">챙길 학생</div>' +
      (items.length ? '<ul class="td-todo__list">' + items.map(function (it) {
        return '<li class="td-care2__item td-care2__item--' + it.kind + '"><button type="button" class="td-care2__btn" data-care="' + it.kind + '" data-care-cls="' + esc(it.cls) + '" data-care-sid="' + esc(it.sid) + '"' +
          (it.week ? ' data-care-week="' + esc(it.week) + '"' : '') + '>' +
          '<span class="td-care2__t">' + esc(it.text) + '</span>' +
          '<span class="td-care2__go">' + (it.kind === 'review' ? '대신 입력 · 미응시 ›' : it.kind === 'material' || it.kind === 'makeup' ? '출석 체크에서 바꾸기 ›' : '상담 카드 ›') + '</span></button>' +
          '<div class="td-care2__foot"><span class="td-care2__names">' + it.ids.map(function (id, i) {
            var why = it.kind === 'review' ? whyOf(id, it.date, it.week || weekOfDate(it.date || DDay.today())) : '';
            return '<span class="td-care2__nm">' + esc(it.names[i]) + (why ? '<small class="td-guess">' + esc(why) + '</small>' : '') + '<button type="button" class="td-care2__x" data-care-x' + attrs(it, id) + ' aria-label="' + esc(it.names[i]) + ' 목록에서 빼기" title="이 학생만 목록에서 빼기 (대신 입력 · 미응시를 안 해도 다시 뜨지 않음)">×</button></span>';
          }).join('') + '</span>' +
          '<button type="button" class="btn btn--sm btn--ghost td-care2__ok" data-care-ok' + attrs(it, it.kind === 'absent' ? it.sid : '') + ' title="이 묶음을 확인했습니다 — 다시 뜨지 않음">확인함</button></div></li>';
      }).join('') + '</ul>' : '') +
      (hist.length ? '<button type="button" class="td-care2__hist" data-care-hist aria-expanded="' + !!st.careHist + '">확인함 기록 보기 (' + hist.length + ')</button>' +
        (st.careHist ? '<ul class="td-care2__hlist">' + hist.map(function (x) {
          var nm = x.student_id ? ((rowById(x.student_id) || {}).name || '학생') : '묶음 전체';
          var what = x.kind === 'review' ? (x.class_name || '') + ' · ' + (x.basis_date ? Lesson.md(String(x.basis_date).slice(0, 10), false) + ' ' : '') + '복습테스트 안 낸 학생 · ' + nm
            : x.kind === 'material' || x.kind === 'makeup' ? (x.class_name || '') + ' · ' + (x.basis_date ? Lesson.md(String(x.basis_date).slice(0, 10), false) + ' ' : '') + '결석 · ' + (x.kind === 'material' ? '자료 미배부' : '보강 영상 미신청') + ' · ' + nm
            : (x.class_name || '(반 없음)') + ' · 결석 잦은 학생 · ' + nm;
          var at = x.checked_at ? new Date(x.checked_at) : null;
          return '<li><span>' + esc(what) + '</span><span class="muted-note">' + esc((x.checked_name || '') + (at ? ' ' + (at.getMonth() + 1) + '/' + at.getDate() : '')) + '</span>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-care-undo="' + esc(x.ckey) + '">되돌리기</button></li>';
        }).join('') + '</ul>' : '') : '') +
    '</div>';
  }

  /* ---------- 과정 카드 (20261031a) ----------
     맨 위 「고3 수능국어 · 7회차 · 10/24(토) ~ 10/25(일)」 / 이번 회차 일주일 한 줄 달력(토 일 월 …) — 수업 있는 날에 반 이름 · ✓ 보냄 / 안 보냄 / 수업 전 · 오늘 강조
     반마다 한 줄 「목동 · 수업일 10/24(토) · 수업까지 D-1! · 최근 발송 칩 3개」 · 펼치면 반별 학생 목록 */
  var DOWS = ['일', '월', '화', '수', '목', '금', '토'];
  function classWhen(c) {
    var nx = c.next;
    if (!nx) return c.name === '(반 없음)' ? '' : '<button type="button" class="btn btn--sm tdc-sched" data-sched="' + esc(c.name) + '">수업일 미정 · 수업 요일 정하기</button>';
    return '<span class="tdc-when"><span class="tdc-when__d">수업일 ' + esc(Store.dateWithDow(nx.date)) + '</span>' +
      '<b class="tdc-when__dd' + (nx.dday === 0 ? ' is-today' : '') + '">' + ddayText(nx.dday) + '</b></span>';
  }
  function byName(x, y) { return (x.name || '').localeCompare(y.name || '', 'ko'); }
  /* [출석 체크] — 수업 당일 · 다음 날만 (과정 카드는 그날 수업하는 반마다 · attend.js · 20261031i) */
  function attHtml(cls, label) {
    if (!window.Attend || cls === '(반 없음)') return '';
    var d = Attend.dayFor(cls);
    var h = d ? Attend.buttonHtml(cls, d, label ? { label: label } : null) : '';
    return h ? '<div class="tdc-att">' + h + '</div>' : '';
  }
  function courseCardHtml(co, cls) {
    var no = Course.roundNow(co), ms = Course.membersAt(co, no), t = DDay.today();
    var rs = Course.roundStart(co, no), ckey = '§' + co.name, open = !!st.open[ckey];
    var sentOf = function (m) {
      var c = cls.find(function (x) { return x.name === m.cls; }), sm = st.recent[m.week] || {};
      var rows = (c ? c.rows : []).filter(function (s) { return !!sm[s.id] || !m.date || inLessonId(s.id, m.cls, m.date); });
      return { n: rows.length, sent: rows.filter(function (s) { return !!sm[s.id]; }).length };
    };
    var days = '';
    for (var i = 0; i < 7; i++) {
      var day = Lesson.addDays(rs, i), here = ms.filter(function (m) { return m.date === day; });
      days += '<div class="tdw-day' + (day === t ? ' is-today' : '') + (here.length ? ' has-class' : '') + '"><span class="tdw-dow">' + DOWS[Lesson.dowOf(day)] + ' <span class="num">' + (+day.slice(8, 10)) + '</span></span>' +
        here.map(function (m) {
          var x = sentOf(m), stt = m.date > t ? ['wait', '수업 전'] : x.n && x.sent === x.n ? ['ok', '✓ 보냄'] : ['no', '안 보냄'];
          return '<span class="tdw-cls tdw-cls--' + stt[0] + '"><b>' + esc(Course.shortName(m.cls)) + '</b><small>' + stt[1] + '</small></span>';
        }).join('') + '</div>';
    }
    var n = cls.reduce(function (a, c) { return a + c.rows.length; }, 0);
    var need = [];
    cls.forEach(function (c) { need = need.concat(needIds(c.rows, c.cy)); });
    return '<div class="tdc-card tdc-card--course' + (open ? ' is-open' : '') + '" data-cls="' + esc(ckey) + '">' +
      '<div class="tdc-head"><div class="tdc-main">' +
        '<div class="tdc-title"><span class="tdc-name">📚 ' + esc(co.name) + '</span><span class="tdc-round">' + esc(Course.label(co, no)) + '</span><span class="muted-note num tdc-n">' + n + '명</span>' + needBtn(need) + '</div>' +
        '<div class="tdw" aria-label="이번 회차 일주일">' + days + '</div>' +
        cls.map(function (c) {
          return '<div class="tdc-crow' + (Course.mine(c.name) ? ' is-mine' : '') + '"><div class="tdc-crow__top"><b class="tdc-crow__n">' + esc(Course.shortName(c.name)) + '</b>' + classWhen(c) +
            (c.rows.length ? '<button type="button" class="btn btn--sm tdc-sms" data-sms-cls="' + esc(c.name) + '" aria-label="' + esc(c.name) + ' 전체 문자 발송">전체 문자 발송</button>' : '') + '</div>' +
            linesHtml(c, chipsOf(c)) + attHtml(c.name, Course.shortName(c.name)) + '</div>';
        }).join('') +
      '</div><div class="tdc-btns"><button type="button" class="btn btn--sm btn--primary tdc-write" data-write-course="' + esc(ckey) + '">레포트 작성</button></div></div>' +
      (n ? toggleBar(ckey, n, open, null) : '') +
      /* 과정 — 반마다 수업일이 달라 반별 목록마다 머리칸을 따로 */
      (open ? '<div class="tdc-list">' + cls.map(function (c) {
        return '<div class="tdc-sub"><div class="tdc-sub__t tdc-grid"><span class="tdc-sub__n">' + esc(c.name) + ' · ' + c.rows.length + '명</span>' + headHtml(c) + '<span class="tdc-grid__rest" aria-hidden="true"></span></div>' +
          sortRows(c.rows, c).map(function (s) { return studentRow(s, c); }).join('') + '</div>';
      }).join('') + '</div>' : '') +
    '</div>';
  }
  function classCardHtml(c) {
    var rows = c.rows, n = rows.length, nx = c.next;
    var chips = chipsOf(c);
    var open = !!st.open[c.name];
    return '<div class="tdc-card' + (open ? ' is-open' : '') + (nx && nx.dday === 0 ? ' is-today' : '') + (window.Course && Course.mine(c.name) ? ' is-mine' : '') + '" data-cls="' + esc(c.name) + '">' +
      '<div class="tdc-head">' +
        '<div class="tdc-main">' +
          '<div class="tdc-title"><span class="tdc-name">' + esc(c.name) + '</span>' + (c.academy ? '<span class="muted-note">' + esc(c.academy) + '</span>' : '') +
            '<span class="muted-note num tdc-n">' + n + '명</span>' + needBtn(needIds(rows, c.cy)) + '</div>' +
          linesHtml(c, chips) +
          classWhen(c) +
          attHtml(c.name, '') +
          (window.Notes ? Notes.cardHtml(c) : '') +          /* 필기 QR · 필기 미제출 · 끝 시각 안내 (notes.js · 20261031w) */
        '</div>' +
        '<div class="tdc-btns">' +
          (c.name === '(반 없음)' || !n ? '' : '<button type="button" class="btn btn--sm tdc-sms" data-sms-cls="' + esc(c.name) + '" aria-label="' + esc(c.name) + ' 전체 문자 발송">전체 문자 발송</button>') +
          (c.name === '(반 없음)' ? '' : '<button type="button" class="btn btn--sm btn--primary tdc-write" data-write="' + esc(c.name) + '">레포트 작성</button>') +
        '</div>' +
      '</div>' +
      (n ? toggleBar(c.name, n, open, c) : '') +
      (open ? '<div class="tdc-list">' + sortRows(rows, c).map(function (s) { return studentRow(s, c); }).join('') + '</div>' : '') +
    '</div>';
  }
  /* 카드 차례 — 과정은 한 묶음 (가장 가까운 반 수업일 자리) · 담당 조교의 반(또는 그 반이 든 과정)이 맨 위 */
  function cardsOf(classes) {
    var courses = window.Course ? Course.list() : [], used = {}, items = [];
    courses.forEach(function (co) {
      var names = Course.membersAt(co, Course.roundNow(co)).map(function (m) { return m.cls; });
      var cls = classes.filter(function (c) { return names.indexOf(c.name) !== -1; })
        .sort(function (a, b) { return names.indexOf(a.name) - names.indexOf(b.name); });
      if (!cls.length) return;
      cls.forEach(function (c) { used[c.name] = true; });
      items.push({ course: co, cls: cls, at: classes.indexOf(cls[0]), mine: cls.some(function (c) { return Course.mine(c.name); }) });
    });
    classes.forEach(function (c, i) { if (!used[c.name]) items.push({ c: c, at: i, mine: !!(window.Course && Course.mine(c.name)) }); });
    items.sort(function (a, b) { return (b.mine - a.mine) || (a.at - b.at); });
    return items;
  }

  /* 종강한 반 — 맨 아래 접힌 한 줄 (이름만 · 지난 레포트 · 기록은 그대로) */
  function endedHtml() {
    var ended = Store.getClasses().filter(function (c) { return Store.isEnded(c.name); });
    if (!ended.length) return '';
    return '<details class="tdc-ended"><summary>종강 ' + ended.length + '개 반</summary><p class="muted-note">' +
      ended.map(function (c) { var m = Store.metaOf(c.name); return esc(c.name) + (m && m.endOn ? ' (' + md(m.endOn) + ' 종강)' : ''); }).join(' · ') +
      ' — 「오늘」 · 필기 알림 · 레포트 발송 대상 · 챙길 학생에서 빠집니다. 지난 레포트와 러닝노트는 그대로입니다.</p></details>';
  }

  function render() {
    var d = st.data;
    if (!d) return;
    var classes = classList(d);
    st.cyBy = {}; st.clsBy = {};
    classes.forEach(function (c) { st.cyBy[c.name] = c.cy; st.clsBy[c.name] = c; });
    var unsent = unsentOf(classes);
    var unsentN = unsent.reduce(function (a, u) { return a + u.x.left; }, 0);

    /* 탭 배지 — 「오늘」 · 「레포트 발송」 모두 발송 안 한 레포트(학생 수) 기준. 0 이면 숨김 (챙길 학생은 세지 않는다) */
    var tip = unsent.map(function (u) { return u.cls + ' ' + Lesson.md(u.x.date, false) + ' 레포트 안 보냄 ' + u.x.left + '명'; }).join('\n');
    ['#todayBadge', '#reportBadge'].forEach(function (sel) {
      var b = $(sel);
      if (!b) return;
      b.hidden = !unsentN;
      b.textContent = unsentN ? unsentN : '';
      b.title = tip;
      if (unsentN) b.setAttribute('aria-label', '발송 안 한 레포트 ' + unsentN + '명'); else b.removeAttribute('aria-label');
    });
    $('#tdTitle').textContent = '오늘 · ' + Store.dateWithDow(DDay.today());
    $('#tdInfo').setAttribute('aria-expanded', String(!!st.rulesOpen));

    setTimeout(renderApp, 0);
    $('#tdBody').innerHTML = transitionHtml() +
      '<div class="td-rules" id="tdRules"' + (st.rulesOpen ? '' : ' hidden') + '><p class="panel__hint tdc-rule">반 이름 아래 칩 = 최근 3번 수업 레포트를 보낸 학생 비율 (초록 100% · 주황 일부 · 빨강 0% · 회색 수업 당일 작성 중). 칩을 누르면 그 수업 발송 화면으로 갑니다. ' +
        '학생 줄 「과제 n/5일」 = 지난 수업 레포트 기간(수업 전 일주일) 평일 중 과제를 낸 날 (토 · 일은 세지 않음). 회색 「과제 링크 연결 필요」 = 마라톤 앱 공유 링크가 없는 학생(누르면 링크 넣는 칸). ' +
        '챙길 학생 = 마감이 지났는데 복습테스트를 안 낸 학생(그 수업 레포트를 보내면 사라짐) · 결석이 기준(설정)을 넘은 학생(그 뒤 상담 기록을 남기면 사라짐).</p></div>' +
      todoHtml(unsent) +
      careHtml(careItems(d)) +
      '<div class="td-appbar" id="tdAppBar" hidden role="status" aria-live="polite"></div>' + stampHtml() +
      '<div class="tdc-list-wrap">' + cardsOf(classes).map(function (it) { return it.course ? courseCardHtml(it.course, it.cls) : classCardHtml(it.c); }).join('') + '</div>' +
      endedHtml();
    paintDetail();
    if (window.Notes) setTimeout(Notes.paint, 0);
    paintStamp();
    if (window.QuickNote) QuickNote.mount();
  }


  /* ---------- 코멘트 「AI로 초안 쓰기」 자료 (write.js · 20261029g) ----------
     과제 — 그 레포트 수업일 D 기준 D-7 ~ D-1 (레포트 과제 요약과 같은 기간)과 그 앞 일주일 D-14 ~ D-8 (20261029h).
     D 를 안 주면 그 반 지난 수업일. 앱 기록을 아직 못 불러왔으면 null */
  function appFactsOf(s, lessonDate) {
    if (!s) return null;
    var cy = cycleOf(s.class_name || '');
    var D = lessonDate || (cy && cy.L) || '';
    var w = appWeekOf(s, cy, D);
    if (!w) return null;
    /* 과제있던날 · 제출한날은 평일만 (토 · 일 주중 복습은 AppWeek.compute 가 뺀다 · 20261030d) */
    var out = { 기간: md(w.from) + '~' + md(w.to), 과제있던날: w.hwDays, 제출한날: w.hwDone, 정시제출: w.hwOnTime };
    if (w.wkDone) out.주말주중복습제출 = w.wkDone;
    var a = app[s.id];
    if (a && a.data && window.AppWeek) {
      var pf = Lesson.addDays(D, -14), pt = Lesson.addDays(D, -8);
      var p = AppWeek.compute(a.data, pf, pt, DDay.today());
      if (p && p.hwDays) out.지난기간 = { 기간: md(pf) + '~' + md(pt), 과제있던날: p.hwDays, 제출한날: p.hwDone };
    }
    return out;
  }
  /* ---------- 레포트 발송 차례 (20261031h) ----------
     반(여럿이면 과정) — 「오늘」 반 카드 칩과 같은 최근 3번 수업 기준 · 수업 당일 · 건너뛴 수업 · 첫 수업일 앞 수업은 빠진다
       unsent  안 보낸 지난 수업 (오래된 것부터) { cls, date, week, left } · left = 안 보낸 학생 합 · done = 다 보냄(보낼 것이 없고 지난 수업이 있음)
       chips   그 반 최근 수업 칩 전부 { cls, date, week, kind } */
  function sendStateOf(names) {
    var out = { unsent: [], chips: [], left: 0, done: false };
    if (!st.data || !st.classes) return out;
    var ok = 0;
    (names || []).forEach(function (n) {
      var c = st.classes.find(function (x) { return x.name === n; });
      if (!c) return;
      chipsOf(c).forEach(function (x) {
        out.chips.push({ cls: n, date: x.date, week: x.week, kind: x.kind });
        if (x.kind === 'part' || x.kind === 'none') { out.unsent.push({ cls: n, date: x.date, week: x.week, left: x.left, ids: x.ids }); out.left += x.left; }
        else if (x.kind === 'ok' || x.kind === 'skip') ok++;
      });
    });
    out.unsent.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    out.done = !out.unsent.length && ok > 0;
    return out;
  }
  function rowById(sid) { return st.data ? st.data.students.find(function (x) { return x.id === sid; }) || null : null; }
  /* ---------- 작성 화면 「못 불러온 n명 다시 불러오기」 (write.js · 20261031v) ----------
     못 불러옴(failed)인 학생만 한꺼번에 · 6명씩 동시에 · 하나 끝날 때마다 onProg(끝난 수, 전체)
     끝나면 그래도 안 되는 학생 [{ id, name, why }] — why = 짐작한 이유 (링크 없음 · 링크 만료 · 앱 응답 없음 · 인터넷 연결 · 앱 서버 오류 …) */
  var WHY = { nolink: '링크 없음', nohub: '학부모 링크 없음', expired: '링크 만료', timeout: '앱 응답 없음', network: '인터넷 연결 확인',
              upstream: '앱 서버 오류', lookup: '앱 서버 오류', invalid: '링크 형식 확인', config: '서버 설정 확인' };
  function whyText(sid) {
    var s = rowById(sid), a = app[sid];
    if (!s) return '명단 확인';
    if (!s.app || !s.code) return WHY[!s.app ? 'nolink' : 'nohub'];
    if (!a) return '불러오는 중';
    var r = String(a.reason || '');
    return WHY[r] || (/^http5/.test(r) ? '앱 서버 오류' : /^http/.test(r) ? '앱 응답 이상' : '앱 응답 없음');
  }
  function failedIds(ids) {
    return (ids || []).filter(function (id) { var s = rowById(id), a = app[id]; return !!(s && s.app && s.code && a && a.failed); });
  }
  function retryMany(ids, onProg) {
    var rows = failedIds(ids).map(rowById), total = rows.length, done = 0, i = 0;
    if (!total) return Promise.resolve([]);
    function next() {
      if (i >= rows.length) return Promise.resolve();
      var s = rows[i++];
      return AppFetch.get(s.code, true).then(function (res) {
        setEntry(s, entryOf(res));
        done++;
        if (onProg) try { onProg(done, total); } catch (e) {}
        return next();
      });
    }
    return Promise.all([next(), next(), next(), next(), next(), next()]).then(function () {
      paintAvg();
      window.dispatchEvent(new CustomEvent('jt:app', { detail: { done: true } }));
      return rows.filter(function (s) { var a = app[s.id]; return !a || !a.ok; }).map(function (s) { return { id: s.id, name: s.name, why: whyText(s.id) }; });
    });
  }
  window.Today = {
    appFailed: failedIds,
    appWhy: whyText,
    retryMany: retryMany,
    /* 처음 불러오기가 끝났나 (작성 화면이 한 번 저절로 다시 시도할 때 본다) */
    appSettled: function () { return !!st.data && !appMeta.busy && liveList().every(function (s) { return !!app[s.id]; }); },
    studentFacts: function (sid, lessonDate) {
      var s = rowById(sid);
      if (!s) return null;
      var set = st.data.settings || {};
      var out = {};
      var a = appFactsOf(s, lessonDate);
      if (a) out.앱과제 = a;
      out.최근결석 = '최근 ' + (set.absentWeeks || 4) + '주 ' + (s.absent_n || 0) + '회';
      return out;
    },
    /* 레포트 발송 학생 줄 — 같은 과제 칸 · 같은 정렬 (send.js · 20261031d). lessonDate = 그 레포트 수업일 */
    appCell: function (sid, lessonDate) { var s = rowById(sid); return s ? appCell(s, cycleOf(s.class_name || ''), lessonDate) : ''; },
    appNeed: function (sid) { var s = rowById(sid); if (!s) return false; var x = appState(s, null); return x.k === 'need' && x.why !== 'expired'; },
    /* 링크 확인 필요 — 'expired' | 'other' | '' (20261031k) */
    linkWarn: function (sid) { var s = rowById(sid); return s ? linkWarn(s) : ''; },
    sortStudents: function (list, lessonDate) {
      if (!st.data) return list.slice().sort(byName);
      var known = [], rest = [];
      list.forEach(function (x) { (rowById(x.id) ? known : rest).push(x); });
      var by = {};
      list.forEach(function (x) { by[x.id] = x; });
      var cy = known.length ? cycleOf(rowById(known[0].id).class_name || '') : null;
      return sortByLesson(known.map(function (x) { return rowById(x.id); }), cy, lessonDate).map(function (s) { return by[s.id]; }).concat(rest.sort(byName));
    },
    sortBarHtml: sortBarHtml,
    paintDetail: paintDetail,
    /* 그날그날 과제 — { 날짜: onTime | late | none | exempt | off | future | wk | wkDone } · 불러오는 중 null · 앱 기록 없음 false (quicknote.js 지난번 약속 · 20261031o) */
    hwOn: function (sid, dates) {
      var s = rowById(sid), a = app[sid];
      if (!s || !s.app || !s.code || (a && !a.ok)) return false;            /* 링크 없음 · 만료 · 못 불러옴 */
      if (!a || !a.data || !window.AppWeek) return null;                     /* 불러오는 중 */
      var out = {};
      (dates || []).forEach(function (d) { var w = AppWeek.compute(a.data, d, d, DDay.today()); out[d] = w && w.days[0] ? w.days[0].hw : 'off'; });
      return out;
    },
    /* 과제 칸이 모두 채워졌나 (불러오는 중인 학생이 없음) — 시험 · 로딩 시간 재기 */
    appReady: function () { return !!st.data && liveList().every(function (s) { return !!app[s.id]; }); },
    detailOpen: function () { return { sid: det.sid, from: det.from, day: det.day }; },
    setAppSort: setAppSort,
    appSort: appSort,
    retryApp: function (sid) { loadApp(sid); },
    openAppLink: openAppLink,
    /* 레포트 발송 (write.js · weeks.js · 20261031h) — ready = 「오늘」 자료를 받았나 · sendState([반]) · nextToSend = 모든 반에서 가장 급한 것 */
    ready: function () { return !!(st.data && st.classes); },
    sendState: sendStateOf,
    nextToSend: function () { return st.classes ? sendStateOf(st.classes.map(function (c) { return c.name; })).unsent[0] || null : null; },
    /* 작성 화면 학생 카드 「과제」 — known = 「오늘」 명단에 있는 학생인가 */
    appKnown: function (sid) { return !!rowById(sid); },
    classApp: function (cls, lessonDate) {
      if (!st.data) return null;
      var ws = st.data.students.filter(function (s) { return (s.class_name || '') === cls; }).map(function (s) { return appFactsOf(s, lessonDate); }).filter(Boolean);
      if (!ws.length) return null;
      var avg = function (k) { return Math.round(ws.reduce(function (x, w) { return x + w[k]; }, 0) / ws.length * 10) / 10; };
      return { 기간: ws[0].기간, 앱연결학생: ws.length, 평균제출한날: avg('제출한날'), 평균과제있던날: avg('과제있던날') };
    }
  };

  $('#tdBody').addEventListener('click', function (e) {
    if (e.target.closest('.al-box')) return;                 /* 과제 링크 칸 (applink.js) */
    var rt = e.target.closest('[data-app-retry]');
    if (rt) { loadApp(rt.dataset.appRetry); return; }
    var to = e.target.closest('[data-todo-open]');
    if (to) { var k0 = to.dataset.todoOpen; if (st.todoOpen[k0]) delete st.todoOpen[k0]; else st.todoOpen[k0] = true; render(); return; }
    var ss = e.target.closest('[data-skip1-sid]');
    if (ss) { if (window.Skips) Skips.check('report', ss.dataset.skip1Cls, ss.dataset.skip1Date, ss.dataset.skip1Sid); return; }
    var sk = e.target.closest('[data-skip-cls]');
    if (sk) { if (window.Skips) Skips.skip(sk.dataset.skipCls, sk.dataset.skipDate); return; }
    var us = e.target.closest('[data-unskip-cls]');
    if (us) { if (window.Skips) Skips.unskip(us.dataset.unskipCls, us.dataset.unskipDate, true); return; }
    var ck = e.target.closest('[data-care-ok], [data-care-x]');
    if (ck) { if (window.Skips) Skips.check(ck.dataset.k, ck.dataset.cls, ck.dataset.date, ck.dataset.sid || ''); return; }
    if (e.target.closest('[data-care-hist]')) { st.careHist = !st.careHist; render(); return; }
    var uc = e.target.closest('[data-care-undo]');
    if (uc) { if (window.Skips) Skips.uncheck(uc.dataset.careUndo); return; }
    var sp = e.target.closest('[data-app-sortp]');
    if (sp) { sortByHead(sp.dataset.appSortp); return; }
    if (e.target.closest('[data-app-refresh]')) { loadApp(null, true); return; }
    var so = e.target.closest('[data-app-sort]');
    if (so) { setAppSort(so.dataset.appSort); return; }
    var ca = e.target.closest('[data-care]');
    if (ca) { careGo(ca.dataset.care, ca.dataset.careCls, ca.dataset.careWeek, ca.dataset.careSid); return; }
    var wc = e.target.closest('[data-write-course]');
    if (wc) { writeCourse(wc.dataset.writeCourse); return; }
    var gs = e.target.closest('[data-go-send]');
    if (gs) { goSend(gs.dataset.goSend, gs.dataset.week); return; }
    var sc = e.target.closest('[data-sched]');
    if (sc) { openSched(sc.dataset.sched); return; }
    var c = e.target.closest('[data-card]');
    if (c) { if (window.Card) Card.open(c.dataset.card); return; }
    var w = e.target.closest('[data-write]');
    if (w) { writeWeek(w.dataset.write); return; }
    var t = e.target.closest('[data-toggle]');
    if (t) {
      var name = t.closest('.tdc-card').dataset.cls;
      var opening = !st.open[name];
      if (opening) st.open[name] = true; else delete st.open[name];
      saveOpen();
      /* 펼치면 뒤로가기 기록을 하나 더(뒤로가기 = 접기), 직접 접으면 기록을 고치기만 (nav.js) */
      setTimeout(function () { if (opening) window.dispatchEvent(new CustomEvent('jt:write-nav')); else if (window.Nav) Nav.replace(); }, 0);
      render();
    }
  });
  /* [새로고침] — 칸을 비우지 않고 다시 받는다 (깜빡이지 않게) */
  $('#tdRefresh').addEventListener('click', function () { if (window.AppFetch) AppFetch.clear(); load(true); loadLinks(); loadApp(null, true); });

  /* [레포트 작성] — 레포트 발송 → 1 작성에서 그 반 이번 주 작성 화면 */
  function writeWeek(cls, week) {
    if (!window.Writer) return;
    UI.selectTab(1);
    Writer.selectClass(cls);
    Writer.openWeek(week || Store.thisWeek().start);
  }

  /* 챙길 학생 — 복습테스트: 그 반 그 수업 작성 화면의 복습테스트 그 학생 줄 ([대신 입력] · [미응시]) · 결석: 상담 카드 */
  function careGo(kind, cls, week, sid) {
    if (kind === 'absent') { if (window.Card) Card.open(sid); return; }
    /* 결석생 자료 · 보강 영상 — 출석 체크 창의 그 학생 (20261031i) */
    if (kind === 'material' || kind === 'makeup') { if (window.Attend) Attend.open(cls, Store.lessonDayOf({ className: cls }, week), sid); return; }
    writeWeek(cls, week);
    /* 복습테스트 표가 다 그려질 때까지 (최대 5초) 기다렸다가 그 학생 줄로 */
    var tries = 0;
    (function wait() {
      if (document.querySelector('#rvTable tr[data-sid="' + sid + '"]')) { if (window.Review && Review.focusStudent) Review.focusStudent(sid); return; }
      if (++tries < 25) setTimeout(wait, 200);
    })();
  }
  /* 과정 [레포트 작성] — 과정 화면 그 회차 */
  function writeCourse(key) {
    var co = window.Course && Course.byKey(key);
    if (!co || !window.Writer) return;
    UI.selectTab(1);
    Writer.selectClass(key);
    Writer.openWeek(Course.weekOfRound(co, Course.roundNow(co)));
  }
  /* 칩 · 「오늘 할 일」 [보내기] — 그 반 그 수업의 레포트 발송 → 3 발송 화면 (20261030e) */
  function goSend(cls, week) {
    if (!window.Writer) return;
    UI.selectTab(1);
    Writer.selectClass(cls);
    Promise.resolve(Writer.openWeek(week || Store.thisWeek().start)).then(function () { UI.selectTab(3); });
  }
  /* [수업일 미정 · 수업 요일 정하기] — 그 반 작성 화면을 열고 수업 요일 정하는 칸을 바로 펼친다 */
  function openSched(cls) {
    writeWeek(cls);
    setTimeout(function () {
      if (window.Weekly && Weekly.openSched) Weekly.openSched();
      var box = document.getElementById('wkSchedEdit');
      if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
    }, 80);
  }
  $('#tdInfo').addEventListener('click', function () {
    st.rulesOpen = !st.rulesOpen;
    $('#tdInfo').setAttribute('aria-expanded', String(st.rulesOpen));
    var r = $('#tdRules');
    if (r) r.hidden = !st.rulesOpen;
  });
  $('#tdBody').addEventListener('click', function (e) { if (e.target.id === 'tdTransitionOpen') $('#tdSettingsBtn').click(); });

  /* ---------- 설정 (teacher 만 바꿀 수 있다) ---------- */

  $('#tdSettingsBtn').addEventListener('click', function () {
    DB.getSettingRow('dashboard').then(function (row) {
      var v = (row && row.value) || {};
      st.settingsAt = (row && row.updated_at) || '';
      $('#tdSetMoney').checked = v.assistantSeeMoney !== false;
      $('#tdSetWeeks').value = v.absentWeeks || 4;
      $('#tdSetMin').value = v.absentMin || 2;
      $('#tdSetAppLow').value = Math.max(1, Math.min(100, parseInt(v.appLow, 10) || 50));
      $('#tdSetPhoto').checked = v.photoWatch === true;
      var g0 = parseInt(v.reportGrace, 10);
      $('#tdSetGrace').value = isNaN(g0) ? 2 : g0;
      $('#tdSetParentWrite').checked = !st.links || st.links.parentWrite !== false;
      var teacher = !!st.role;   /* 조교 · 선생님 같은 권한 (migration-017) */
      ['#tdSetMoney', '#tdSetWeeks', '#tdSetMin', '#tdSetAppLow', '#tdSetPhoto', '#tdSetGrace', '#tdSetParentWrite'].forEach(function (s) { $(s).disabled = !teacher; });
      $('#tdSetSave').hidden = !teacher;
      $('#tdSetNote').textContent = teacher ? '' : '직원 정보를 불러오는 중입니다. 잠시 뒤 다시 열어 주세요.';
      $('#tdSettingsModal').showModal();
    }).catch(function (e) { toast(e.message, 'bad'); });
  });
  $('#tdSetCancel').addEventListener('click', function () { $('#tdSettingsModal').close(); });
  $('#tdSettingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = {
      assistantSeeMoney: $('#tdSetMoney').checked,
      absentWeeks: Math.max(1, Math.min(12, parseInt($('#tdSetWeeks').value, 10) || 4)),
      absentMin: Math.max(1, Math.min(12, parseInt($('#tdSetMin').value, 10) || 2)),
      appLow: Math.max(1, Math.min(100, parseInt($('#tdSetAppLow').value, 10) || 50)),
      photoWatch: $('#tdSetPhoto').checked,
      reportGrace: Math.max(0, Math.min(14, parseInt($('#tdSetGrace').value, 10) || 0))
    };
    var pw = $('#tdSetParentWrite').checked;
    var pwChanged = !st.links || (st.links.parentWrite !== false) !== pw;
    UI.guardedSave('「오늘」 화면 설정', function (chk) {
      return DB.saveSettingIf('dashboard', v, UI.whoami(), chk ? st.settingsAt : '');
    }, function () { $('#tdSettingsModal').close(); }).then(function (res) {
      if (!res.ok) return;
      if (pwChanged) {
        return DB.saveSettingIf('links', Object.assign({}, st.links || {}, { parentWrite: pw }), UI.whoami(), '').then(function () {
          toast(pw ? '전환 기간을 켰습니다 — 학부모 링크로도 입력됩니다' : '전환 기간을 껐습니다 — 이제 입력은 학생 링크에서만 됩니다', 'good');
          return loadLinks().then(function () { return res; });
        });
      }
      return res;
    }).then(function (res) {
      if (!res || !res.ok) return;
      $('#tdSettingsModal').close();
      toast('설정을 저장했습니다', 'good');
      load(true);
    }).catch(function (x) { toast('저장하지 못했습니다 — ' + x.message, 'bad'); });
  });

  /* ---------- 언제 다시 계산하나 ---------- */

  window.addEventListener('jt:loaded', function () {
    DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; if (st.data) render(); });
    load(true);
    loadLinks();
  });
  document.addEventListener('jt:tab', function (e) { if (e.detail.index === 7) load(false); });
  var TABLES = { '*': 1, entries: 1, published: 1, sent: 1, note_photos: 1, tb_bills: 1, student_notes: 1, students: 1 };
  var remoteTimer = null;
  function remote() {
    clearTimeout(remoteTimer);
    /* 다른 탭을 보고 있어도 「오늘」 탭 옆 숫자가 맞도록 다시 계산한다 (10초에 한 번까지) */
    remoteTimer = setTimeout(function () { load(false); }, 800);
  }
  window.addEventListener('jt:remote', function (e) { if (TABLES[(e.detail && e.detail.table) || '']) remote(); });
  window.addEventListener('jt:refreshed', function (e) { if (!(e.detail && e.detail.local)) remote(); });
  /* 반이 새로 생기면 (학생 0명 반 카드) 바로 다시 그린다 */
  window.addEventListener('jt:roster-changed', function () { if (st.data && !$('#appRoot').hidden) render(); });
  /* 과정 · 담당 조교를 불러오면 카드 묶음 · 차례를 다시 (course.js) */
  window.addEventListener('jt:courses', function () { if (st.data && !$('#appRoot').hidden) render(); });
  /* 휴대폰 「⋯」 메뉴 — 바깥을 누르거나 메뉴 안 버튼을 누르면 닫는다 · 한 번에 하나만 */
  document.addEventListener('click', function (e) {
    var mine = e.target.closest && e.target.closest('details.tdc-more');
    Array.prototype.forEach.call(document.querySelectorAll('details.tdc-more[open]'), function (d) {
      if (d !== mine || e.target.closest('.tdc-more__menu button')) d.open = false;
    });
  });
  /* 건너뛰기 · 확인함 (skips.js) · 과제 링크 칸을 펼치거나 접으면 (applink.js) 다시 그린다 */
  window.addEventListener('jt:skips', function () { if (st.data && !$('#appRoot').hidden) render(); });
  window.addEventListener('jt:applink-ui', function () { if (st.data && !$('#appRoot').hidden) render(); });
  /* 「+ 과제 링크 연결 필요 n명」 — 그 반 학생 목록을 펼친다 */
  window.addEventListener('jt:applink-need', function (e) {
    var k = e.detail && e.detail.cls;
    if (k && !st.open[k]) { st.open[k] = true; saveOpen(); }
    if (st.data && !$('#appRoot').hidden) render();
  });
  /* 정렬을 바꾸면 다시 세운다 (레포트 발송에서 바꿔도 같이) */
  window.addEventListener('jt:appsort', function () { if (st.data && !$('#appRoot').hidden) render(); });
  /* 과제 링크를 넣으면 (applink.js) 그 학생 과제 기록을 바로 불러온다 */
  window.addEventListener('jt:applink', function (e) {
    var s = e.detail && rowById(e.detail.sid);
    if (!s) return;
    /* 링크를 바꾸거나 지우면 그 학생만 잊고 새로 (화면 메모리 · 10분 기억 — 다른 학생은 그대로 · 20261031k) */
    if (s.code) {
      if (window.AppFetch && AppFetch.forget) AppFetch.forget(s.code);
      var m = readCache(); if (m[s.code]) { delete m[s.code]; writeCache(m); }
    }
    s.app = !e.detail.cleared;
    if (e.detail.hubCode) s.code = e.detail.hubCode;
    delete app[s.id];
    if (det.sid === s.id) det = closedDet();
    render();
    if (s.app) loadApp(s.id);
    else window.dispatchEvent(new CustomEvent('jt:app', { detail: { sid: s.id } }));
  });
  /* 출석 체크를 저장하거나 새로 읽으면 (attend.js) — 반 카드 버튼 · 챙길 학생 */
  window.addEventListener('jt:attend', function () { if (st.data && !$('#appRoot').hidden) render(); });
  window.addEventListener('jt:rnote', function () { if (st.data && !$('#appRoot').hidden) render(); });
  /* 퇴원일을 넣거나 지우면 학생 목록도 (20261031i) */
  window.addEventListener('jt:roster-changed', function () {
    /* 수강 시작일이 바뀌었을 수 있다 — 앱 기록에 다시 붙인다 (20261031q) */
    Object.keys(app).forEach(function (sid) { var a = app[sid]; if (a && a.raw) a.data = fixed(sid, a.raw); });
    if (st.data && st.allStudents) { st.data.students = activeOnly(st.allStudents); st.classes = classList(st.data); if (!$('#appRoot').hidden) render(); }
  });
  /* 학생 얼굴 사진을 불러오면 학생 줄 동그라미를 다시 (profile.js) */
  window.addEventListener('jt:profiles', function () { if (st.data && !$('#appRoot').hidden) render(); });

  /* 뒤로가기 · 새로고침 (nav.js) — 펼친 반 목록 */
  window.TodayView = {
    /* 레포트 발송 → 3 발송 · 문자 보내기도 같은 반 순서 — 오늘 수업 → 가까운 날 → 같은 날은 이름 순 → 수업일 미정 맨 아래 */
    orderClasses: function (names) {
      var out = names.map(function (n) { return { name: n, next: n === '(반 없음)' ? null : nextLesson(n) }; })
        .sort(function (x, y) {
          if (!!x.next !== !!y.next) return x.next ? -1 : 1;
          if (x.next && y.next && x.next.date !== y.next.date) return x.next.date < y.next.date ? -1 : 1;
          if ((x.name === '(반 없음)') !== (y.name === '(반 없음)')) return x.name === '(반 없음)' ? 1 : -1;
          return x.name.localeCompare(y.name, 'ko');
        }).map(function (x) { return x.name; });
      /* 담당 조교의 반을 맨 위로 (course.js · 20261031a) */
      return window.Course ? Course.mineFirst(out) : out;
    },
    nextLesson: nextLesson,
    /* 그 반 가장 최근 수업(오늘 포함)의 주 시작일 — 문자 창 레포트 안내의 「공개 전 · 발송 불가」 (sms.js · 20261030e) */
    lastLessonWeek: function (cls) { var r = recentLessons(cls, 1); return r.length ? weekOfDate(r[0]) : ''; },
    openList: function () { return Object.keys(st.open).sort(); },
    setOpen: function (list) {
      st.open = {};
      (list || []).forEach(function (n) { if (n) st.open[n] = true; });
      saveOpen();
      if (st.data) render();
    }
  };

})();
