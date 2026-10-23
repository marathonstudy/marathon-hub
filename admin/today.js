/* ============================================================
   today.js — 마라톤 코치룸 「오늘」 총괄 (로그인 첫 화면)

   · 서버 함수 coach_today() 한 번으로 반 · 학생을 받고, 최근 6주 보낸 표시(sent)를 한 번 더 읽는다.
   · 맨 위 「오늘 할 일」 — 발송 안 한 레포트가 있는 반만 「목동반 · 10/20 레포트 안 보냄 12명 [보내기]」, 없으면 「오늘 할 일 없음」 (20261030e)
   · 반 카드 (촘촘하게 위아래로) — 반 이름 · 인원 / 최근 3번 수업 레포트 칩(보낸 학생 %) / 「수업일 10/29(목)」 · 「수업까지 D-3!」 / [문자] [이번 주 작성하기]
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
    Promise.all([sb().rpc('coach_today'), DB.getSettingRow('dashboard').catch(function () { return null; }), loadRecentSent(), loadCare()]).then(function (res) {
      var r = res[0];
      st.loading = false;
      if (r.error) throw new Error(r.error.message);
      st.dash = (res[1] && res[1].value) || {};
      st.data = prepare(r.data);
      st.classes = classList(st.data);
      render();
      loadApp();
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
  function prepare(d) {
    return d;
  }

  /* ---------- 과제 제출률 (app-report, 4명씩) ---------- */

  /* 과제 기록 — 학생마다 app-report 를 6명씩 동시에 (앱 서버가 한꺼번에 주는 주소가 없다) · 미리보기와 같은 기록을 같이 쓴다 (appfetch.js)
     예전에는 4명씩 부르고 마지막 학생이 끝나야 학생 줄을 다시 그려서, 그때까지 모두 「앱 …」이었다 → 한 명 받을 때마다 그 학생 칸만 바로 (20261031b)
     15초 안에 답이 없거나 실패하면 「과제 기록 못 불러옴 · 다시 시도」 */
  var appProg = { done: 0, total: 0, start: 0, timer: null };
  function loadApp(only) {
    var d = st.data;
    if (!d) return;
    var run = ++appRun;
    var all = d.students.filter(function (s) { return s.app && s.code; });
    var todo = all.filter(function (s) {
      if (only) return s.id === only;
      var a = app[s.id];
      return !a || a.failed || Date.now() - a.at > APP_TTL;
    });
    todo.forEach(function (s) { delete app[s.id]; paintApp(s.id); });
    appProg.total = all.length;
    appProg.done = all.length - all.filter(function (s) { return !app[s.id]; }).length;
    appProg.start = Date.now();
    clearInterval(appProg.timer);
    appProg.timer = setInterval(function () { renderApp(); }, 1000);     /* 10초가 넘으면 「조금 오래 걸리고 있습니다」 */
    renderApp();
    var i = 0;
    function one() {
      if (run !== appRun || i >= todo.length) return Promise.resolve();
      var s = todo[i++];
      return AppFetch.get(s.code).then(function (res) {
        /* 날짜별 기록만 남긴다 — 반마다 지난 수업 전 일주일(D-7 ~ D-1)을 AppWeek.compute 로 센다 (러닝노트 레포트 과제 요약과 같은 계산) */
        var dt = res && res.ok && res.data ? res.data : null;
        app[s.id] = dt ? { ok: true, data: { calendar: dt.calendar || [], lectures: dt.lectures || [], history: dt.history || dt.recent || [] }, at: Date.now() }
                       : { ok: false, failed: true, data: null, at: Date.now() };
        appProg.done++;
        paintApp(s.id);
        renderApp();
        return one();
      });
    }
    Promise.all([one(), one(), one(), one(), one(), one()]).then(function () {
      if (run === appRun) { clearInterval(appProg.timer); renderApp(); }
    });
  }

  /* 반 카드 위 「과제 기록 불러오는 중 3/11」 (다 불러오면 사라짐 · 10초가 넘으면 「조금 오래 걸리고 있습니다」) */
  function renderApp() {
    var el = $('#tdAppBar');
    var t = appProg.total, n = Math.min(appProg.done, t);
    var busy = t && n < t;
    if (!busy) clearInterval(appProg.timer);
    if (!el) return;
    el.hidden = !busy;
    el.innerHTML = busy ? '<i class="spin" aria-hidden="true"></i> ' + (Date.now() - appProg.start > 10000 ? '조금 오래 걸리고 있습니다 · ' : '') + '과제 기록 불러오는 중 <span class="num">' + n + '/' + t + '</span>' : '';
  }
  /* 그 학생 줄의 과제 칸만 다시 */
  function paintApp(sid) {
    var s = st.data && st.data.students.find(function (x) { return x.id === sid; });
    if (!s) return;
    Array.prototype.forEach.call(document.querySelectorAll('#tdBody .tdc-st[data-id="' + sid + '"] .tdc-app-slot'), function (el) {
      el.innerHTML = appCell(s, (st.cyBy || {})[s.class_name || '(반 없음)']);
    });
  }

  /* ---------- 그리기 ---------- */




  /* ---------- 반 카드 (20261026a) ----------
     반마다 카드: 반 이름 · 학원 · 다음 수업(「오늘 수업」 / 「D-2 10/22(목)」, 휴강 주 건너뜀) · 인원 · 이번 주 작성 · 공개 n/전체 ·
     급함 n · 살펴보기 n · [이번 주 작성하기]. 순서 = 다음 수업이 가까운 반부터 (오늘 수업 맨 위, 같은 날은 이름 순, 수업일 미정은 맨 아래).
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
      .filter(function (c) { return !Store.isArchivedClass(c.name); })
      .map(function (c) { c.next = c.name === '(반 없음)' ? null : nextLesson(c.name); c.cy = c.name === '(반 없음)' ? null : cycleOf(c.name); return c; })
      .sort(function (x, y) {
        if (!!x.next !== !!y.next) return x.next ? -1 : 1;               /* 수업일 미정은 맨 아래 */
        if (x.next && y.next && x.next.date !== y.next.date) return x.next.date < y.next.date ? -1 : 1;
        if ((x.name === '(반 없음)') !== (y.name === '(반 없음)')) return x.name === '(반 없음)' ? 1 : -1;
        return x.name.localeCompare(y.name, 'ko');
      });
  }

  /* ---------- 반 카드 (20261030e — 단순하게) ----------
     반 이름 · 인원 / 최근 3번 수업 레포트 발송 칩 / 「수업일 10/29(목)」 · 「수업까지 D-3!」 / [문자] [이번 주 작성하기]
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
    var n = c.rows.length;
    var sent = c.rows.filter(function (s) { return !!m[s.id]; }).length;
    var pct = n ? Math.round(sent / n * 100) : 0;
    var wip = date === DDay.today() && sent < n;              /* 수업 당일 — 아직 보낼 때가 아니다 */
    var kind = wip ? 'wip' : !n ? 'wip' : sent === n ? 'ok' : sent ? 'part' : 'none';
    return { date: date, week: week, n: n, sent: sent, pct: pct, kind: kind, left: n - sent };
  }
  function chipsOf(c) {
    if (c.name === '(반 없음)' || !c.rows.length) return [];
    return recentLessons(c.name, 3).map(function (d) { return chipOf(c, d); });
  }
  function chipHtml(c, x) {
    var day = Store.dateWithDow(x.date);
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

  /* 과제 「n/5일」 — 그 반 지난 수업 레포트 기간(D-7 ~ D-1)의 평일 중 제출한 날 (토 · 일은 세지 않는다) */
  function appCell(s, cy) {
    if (!s.app) return '';
    var a = app[s.id];
    if (!a) return '<span class="tdc-app tdc-app--wait" title="과제 기록 불러오는 중"><i class="spin" aria-hidden="true"></i>과제 불러오는 중</span>';
    if (a.failed) return '<button type="button" class="tdc-app tdc-app--fail" data-app-retry="' + esc(s.id) + '">과제 기록 못 불러옴 · 다시 시도</button>';
    var w = appWeekOf(s, cy);
    if (!w) return '<span class="tdc-app tdc-app--none" title="이 기간 과제 없음">과제 —</span>';
    var k = w.hwDone >= w.hwDays ? 'ok' : w.hwDone >= 3 ? 'mid' : 'low';
    return '<span class="tdc-app tdc-app--' + k + ' num" title="' + esc(md(w.from) + '~' + md(w.to) + ' 평일 ' + w.hwDays + '일 중 제출 ' + w.hwDone + '일 · 정시 ' + w.hwOnTime + '일') + '">과제 ' + w.hwDone + '/' + w.hwDays + '일</span>';
  }
  function studentRow(s, cy) {
    return '<div class="tdc-st" data-id="' + esc(s.id) + '">' +
      '<div class="tdc-st__main"><button type="button" class="roster__name roster__name-btn" data-card="' + esc(s.id) + '">' + esc(s.name) + '</button><span class="tdc-app-slot">' + appCell(s, cy) + '</span></div>' +
      '<div class="tdc-st__acts"><button type="button" class="btn btn--sm" data-card="' + esc(s.id) + '">상담 카드</button>' +
        '<button type="button" class="btn btn--sm" data-sms-sid="' + esc(s.id) + '">문자</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-pv="parent" data-sid="' + esc(s.id) + '">학부모 화면 미리보기</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-pv="student" data-sid="' + esc(s.id) + '">학생 화면 미리보기</button></div>' +
    '</div>';
  }

  /* 「오늘 할 일」 — 발송 안 한 레포트가 있는 반만 「목동반 · 10/20 레포트 안 보냄 12명 [보내기]」 · 없으면 「오늘 할 일 없음」 */
  function todoHtml(list) {
    return '<div class="td-todo"><div class="td-todo__title">오늘 할 일</div>' +
      (list.length ? '<ul class="td-todo__list">' + list.map(function (u) {
        return '<li class="td-todo__item' + (u.x.kind === 'none' ? ' is-urgent' : '') + '"><span class="td-todo__t">' +
          esc(u.cls + ' · ' + Lesson.md(u.x.date, false) + ' 레포트 안 보냄 ' + u.x.left + '명') + '</span>' +
          '<button type="button" class="btn btn--sm btn--primary td-todo__btn" data-go-send="' + esc(u.cls) + '" data-week="' + esc(u.x.week) + '">보내기</button></li>';
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
      var k = (s.class_name || '') + '|' + day;
      if (!grp[k]) { grp[k] = { cls: s.class_name || '', day: day, week: wk, ids: [] }; order.push(k); }
      if (grp[k].ids.indexOf(s.id) === -1) grp[k].ids.push(s.id);
    });
    order.forEach(function (k) {
      var g = grp[k];
      out.push({ kind: 'review', cls: g.cls, week: g.week, sid: g.ids[0], ids: g.ids,
        text: g.cls + ' · ' + Lesson.md(g.day, false) + ' 복습테스트 안 낸 학생 ' + g.ids.length + '명',
        names: g.ids.map(function (id) { return byId[id].name; }) });
    });
    /* 결석 잦은 학생 */
    d.students.forEach(function (s) {
      if (!(s.absent_n >= (set.absentMin || 2))) return;
      var last = care.abs[s.id];
      if (last && care.note[s.id] && care.note[s.id] >= last) return;          /* 마지막 결석 뒤에 상담 기록이 있으면 다시 띄우지 않는다 */
      out.push({ kind: 'absent', cls: s.class_name || '', sid: s.id,
        text: (s.class_name || '(반 없음)') + ' · 최근 ' + (set.absentWeeks || 4) + '번 중 결석 ' + s.absent_n + '번', names: [s.name] });
    });
    return out;
  }
  function careHtml(items) {
    if (!items.length) return '';
    return '<div class="td-care2"><div class="td-todo__title">챙길 학생</div><ul class="td-todo__list">' + items.map(function (it) {
      return '<li class="td-care2__item td-care2__item--' + it.kind + '"><button type="button" class="td-care2__btn" data-care="' + it.kind + '" data-care-cls="' + esc(it.cls) + '" data-care-sid="' + esc(it.sid) + '"' +
        (it.week ? ' data-care-week="' + esc(it.week) + '"' : '') + '>' +
        '<span class="td-care2__t">' + esc(it.text) + '</span> <span class="td-care2__names">' + esc(it.names.join(', ')) + '</span>' +
        '<span class="td-care2__go">' + (it.kind === 'review' ? '대신 입력 · 미응시 ›' : '상담 카드 ›') + '</span></button></li>';
    }).join('') + '</ul></div>';
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
  function courseCardHtml(co, cls) {
    var no = Course.roundNow(co), ms = Course.membersAt(co, no), t = DDay.today();
    var rs = Course.roundStart(co, no), ckey = '§' + co.name, open = !!st.open[ckey];
    var sentOf = function (m) {
      var c = cls.find(function (x) { return x.name === m.cls; }), rows = c ? c.rows : [];
      var sm = st.recent[m.week] || {};
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
    return '<div class="tdc-card tdc-card--course' + (open ? ' is-open' : '') + '" data-cls="' + esc(ckey) + '">' +
      '<div class="tdc-head"><div class="tdc-main">' +
        '<div class="tdc-title"><span class="tdc-name">📚 ' + esc(co.name) + '</span><span class="tdc-round">' + esc(Course.label(co, no)) + '</span><span class="muted-note num tdc-n">' + n + '명</span></div>' +
        '<div class="tdw" aria-label="이번 회차 일주일">' + days + '</div>' +
        cls.map(function (c) {
          var chips = chipsOf(c);
          return '<div class="tdc-crow' + (Course.mine(c.name) ? ' is-mine' : '') + '"><b class="tdc-crow__n">' + esc(Course.shortName(c.name)) + '</b>' + classWhen(c) +
            (chips.length ? '<span class="tdc-chips">' + chips.map(function (x) { return chipHtml(c, x); }).join('') + '</span>' : '') +
            (c.rows.length ? '<button type="button" class="btn btn--sm tdc-sms" data-sms-cls="' + esc(c.name) + '" aria-label="' + esc(c.name) + ' 문자 보내기">문자</button>' : '') + '</div>';
        }).join('') +
      '</div><div class="tdc-btns"><button type="button" class="btn btn--sm btn--primary tdc-write" data-write-course="' + esc(ckey) + '">이번 회차 작성하기</button></div></div>' +
      (n ? '<button type="button" class="tdc-toggle" data-toggle aria-expanded="' + open + '">학생 ' + n + '명 ' + (open ? '접기 ▴' : '보기 ▾') + '</button>' : '') +
      (open ? '<div class="tdc-list">' + cls.map(function (c) {
        return '<div class="tdc-sub"><div class="tdc-sub__t">' + esc(c.name) + ' · ' + c.rows.length + '명</div>' + c.rows.slice().sort(byName).map(function (s) { return studentRow(s, c.cy); }).join('') + '</div>';
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
            '<span class="muted-note num tdc-n">' + n + '명</span></div>' +
          (chips.length ? '<div class="tdc-chips" aria-label="최근 3번 수업 레포트 발송">' + chips.map(function (x) { return chipHtml(c, x); }).join('') + '</div>' : '') +
          classWhen(c) +
        '</div>' +
        '<div class="tdc-btns">' +
          (c.name === '(반 없음)' || !n ? '' : '<button type="button" class="btn btn--sm tdc-sms" data-sms-cls="' + esc(c.name) + '" aria-label="' + esc(c.name) + ' 문자 보내기">문자</button>') +
          (c.name === '(반 없음)' ? '' : '<button type="button" class="btn btn--sm btn--primary tdc-write" data-write="' + esc(c.name) + '">이번 주 작성하기</button>') +
        '</div>' +
      '</div>' +
      (n ? '<button type="button" class="tdc-toggle" data-toggle aria-expanded="' + open + '">학생 ' + n + '명 ' + (open ? '접기 ▴' : '보기 ▾') + '</button>' : '') +
      (open ? '<div class="tdc-list">' + rows.slice().sort(byName).map(function (s) { return studentRow(s, c.cy); }).join('') + '</div>' : '') +
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

  function render() {
    var d = st.data;
    if (!d) return;
    var classes = classList(d);
    st.cyBy = {};
    classes.forEach(function (c) { st.cyBy[c.name] = c.cy; });
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
        '학생 줄 「과제 n/5일」 = 지난 수업 레포트 기간(수업 전 일주일) 평일 중 과제를 낸 날 (토 · 일은 세지 않음). ' +
        '챙길 학생 = 마감이 지났는데 복습테스트를 안 낸 학생(그 수업 레포트를 보내면 사라짐) · 결석이 기준(설정)을 넘은 학생(그 뒤 상담 기록을 남기면 사라짐).</p></div>' +
      todoHtml(unsent) +
      careHtml(careItems(d)) +
      '<div class="td-appbar" id="tdAppBar" hidden role="status" aria-live="polite"></div>' +
      '<div class="tdc-list-wrap">' + cardsOf(classes).map(function (it) { return it.course ? courseCardHtml(it.course, it.cls) : classCardHtml(it.c); }).join('') + '</div>';
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
  function rowById(sid) { return st.data ? st.data.students.find(function (x) { return x.id === sid; }) || null : null; }
  window.Today = {
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
    classApp: function (cls, lessonDate) {
      if (!st.data) return null;
      var ws = st.data.students.filter(function (s) { return (s.class_name || '') === cls; }).map(function (s) { return appFactsOf(s, lessonDate); }).filter(Boolean);
      if (!ws.length) return null;
      var avg = function (k) { return Math.round(ws.reduce(function (x, w) { return x + w[k]; }, 0) / ws.length * 10) / 10; };
      return { 기간: ws[0].기간, 앱연결학생: ws.length, 평균제출한날: avg('제출한날'), 평균과제있던날: avg('과제있던날') };
    }
  };

  $('#tdBody').addEventListener('click', function (e) {
    var rt = e.target.closest('[data-app-retry]');
    if (rt) { loadApp(rt.dataset.appRetry); return; }
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
  $('#tdRefresh').addEventListener('click', function () { app = {}; if (window.AppFetch) AppFetch.clear(); load(true); loadLinks(); });

  /* [이번 주 작성하기] — 레포트 발송 → 1 작성에서 그 반 이번 주 작성 화면 */
  function writeWeek(cls, week) {
    if (!window.Writer) return;
    UI.selectTab(1);
    Writer.selectClass(cls);
    Writer.openWeek(week || Store.thisWeek().start);
  }

  /* 챙길 학생 — 복습테스트: 그 반 그 수업 작성 화면의 복습테스트 그 학생 줄 ([대신 입력] · [미응시]) · 결석: 상담 카드 */
  function careGo(kind, cls, week, sid) {
    if (kind === 'absent') { if (window.Card) Card.open(sid); return; }
    writeWeek(cls, week);
    /* 복습테스트 표가 다 그려질 때까지 (최대 5초) 기다렸다가 그 학생 줄로 */
    var tries = 0;
    (function wait() {
      if (document.querySelector('#rvTable tr[data-sid="' + sid + '"]')) { if (window.Review && Review.focusStudent) Review.focusStudent(sid); return; }
      if (++tries < 25) setTimeout(wait, 200);
    })();
  }
  /* 과정 [이번 회차 작성하기] — 과정 화면 그 회차 */
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
