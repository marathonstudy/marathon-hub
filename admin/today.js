/* ============================================================
   today.js — 마라톤 코치룸 「오늘」 총괄 (로그인 첫 화면)

   · 서버 함수 coach_today() 한 번으로 반·학생별 숫자를 받는다 (새 표 없음).
   · '작성 완료' 는 ② 작성 탭과 같은 규칙(report.js Report.entryStatus)으로 센다.
   · 앱 과제는 바깥 앱 서버 자료라 화면이 뜬 뒤 app-report 함수로 4명씩 차례로 불러온다.
     날짜별 기록으로 그 반 직전 과제 기간의 「제출일 / 과제 있던 날」을 센다 (러닝노트 표와 같은 AppWeek.compute).
     불러온 값은 30분 동안 이 화면 메모리에만 둔다(브라우저에 저장하지 않는다).
   · 조교 금액 숨김이 켜져 있으면 서버가 금액을 보내지 않는다 (이 화면에만 적용).
   · 첫 화면은 반 카드 — 다음 수업이 가까운 반부터. 카드를 누르면 그 반 학생(급함 → 살펴보기 → 나머지)이 펼쳐진다.
   · 「오늘」 탭 이름 옆 숫자 = 급함 학생 수. 금액은 이 화면에 넣지 않는다.
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
      '① 명단에서 반마다 [학생 링크 모두 복사]로 학생 링크를 다 보내면 <b>끄세요</b>.' +
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
    Promise.all([sb().rpc('coach_today'), DB.getSettingRow('dashboard').catch(function () { return null; })]).then(function (res) {
      var r = res[0];
      st.loading = false;
      if (r.error) throw new Error(r.error.message);
      st.dash = (res[1] && res[1].value) || {};
      st.data = prepare(r.data);
      st.classes = classList(st.data);
      return loadCycle(st.classes).then(function (cy) {
        st.cycleMissing = !cy;
        st.cycle = null;
        if (cy) {
          st.cycle = {};
          (cy.classes || []).forEach(function (c) { var by = {}; (c.students || []).forEach(function (x) { by[x.id] = x; }); st.cycle[c['class']] = { test: c.test, by: by }; });
        }
      }, function () { st.cycleMissing = false; st.cycle = null; });
    }).then(function () {
      if (!st.data) return;
      render();
      loadApp();
      loadReviewMissing();
    }).catch(function (e) {
      st.loading = false;
      $('#tdBody').innerHTML = '<div class="empty-state">' + (isMissing(e)
        ? '「오늘」 화면용 함수가 아직 없습니다. Supabase SQL Editor 에서 <code>migration-007-dashboard.sql</code> 을 먼저 실행해 주세요.'
        : '불러오지 못했습니다 — ' + esc(e.message)) + '</div>';
    });
  }

  /* 서버 값 + 화면 계산(작성 완료 · 챙길 이유) */
  function prepare(d) {
    var entries = {}, commons = {};
    (d.entries || []).forEach(function (r) { entries[r.student_id] = DB.fromDbEntry(r); });
    (d.commons || []).forEach(function (r) { commons[r.class_name] = DB.fromDbCommon(r); });
    d.students.forEach(function (s) {
      var common = commons[s.class_name] || { lessons: [], tests: [] };
      s.written = Report.entryStatus(common, entries[s.id]).state === 'done';
    });
    return d;
  }

  /* 복습테스트 — 지난 7일 안에 마감이 지났는데 안 낸 학생 (migration-013). 함수가 없으면 조용히 건너뛴다 */
  var reviewMiss = {};
  function loadReviewMissing() {
    sb().rpc('review_missing').then(function (r) {
      if (r.error) return;
      reviewMiss = {};
      (r.data || []).forEach(function (x) { (reviewMiss[x.student_id] = reviewMiss[x.student_id] || []).push(x); });
      if (Object.keys(reviewMiss).length) render();
    });
  }


  /* ---------- 앱 과제 제출률 (app-report, 4명씩) ---------- */

  function loadApp() {
    var d = st.data;
    if (!d) return;
    var run = ++appRun;
    var todo = d.students.filter(function (s) {
      var a = app[s.id];
      return s.app && s.code && (!a || Date.now() - a.at > APP_TTL);
    });
    var total = d.students.filter(function (s) { return s.app && s.code; }).length;
    if (!todo.length) { renderApp(total, total); return; }
    var i = 0, done = total - todo.length;
    function one() {
      if (run !== appRun || i >= todo.length) return Promise.resolve();
      var s = todo[i++];
      var url = CFG.supabase.url + '/functions/v1/' + CFG.appFunction + '?code=' + encodeURIComponent(s.code);
      return fetch(url, { headers: { apikey: CFG.supabase.key } })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          /* 날짜별 기록만 남긴다 — 반마다 직전 과제 기간을 그릴 때 AppWeek.compute 로 센다 (러닝노트 「이번 주 과제·강의」 표와 같은 계산) */
          var dt = res && res.ok && res.data ? res.data : null;
          app[s.id] = { ok: !!dt, data: dt ? { calendar: dt.calendar || [], lectures: dt.lectures || [], history: dt.history || dt.recent || [] } : null, at: Date.now() };
        }, function () { app[s.id] = { ok: false, data: null, at: Date.now() }; })
        .then(function () {
          done++;
          if (run === appRun) renderApp(done, total);
          return one();
        });
    }
    renderApp(done, total);
    Promise.all([one(), one(), one(), one()]).then(function () {
      if (run === appRun) render();
    });
  }

  function renderApp(done, total) {
    var el = $('#tdAppProgress');
    if (el) el.textContent = total && done < total ? '앱 과제 불러오는 중 ' + done + '/' + total : '';
  }

  /* ---------- 그리기 ---------- */




  /* ---------- 반 카드 (20261026a) ----------
     반마다 카드: 반 이름 · 학원 · 다음 수업(「오늘 수업」 / 「D-2 10/22(목)」, 휴강 주 건너뜀) · 인원 · 이번 주 작성 · 공개 n/전체 ·
     급함 n · 살펴보기 n · [이번 주 작성하기]. 순서 = 다음 수업이 가까운 반부터 (오늘 수업 맨 위, 같은 날은 이름 순, 수업일 미정은 맨 아래).
     카드를 누르면 그 반 학생 목록이 펼쳐진다 (여러 반 함께 · 펼친 반은 이 기기에만 기억).
       급함     최근 결석 기준 이상 · 복습테스트 미제출 · 확인 필요 상담
       살펴보기 앱 과제 제출 기준(기본 50%) 미만 — 그 반 직전 과제 기간(지난 수업일 ~ 이번 수업일 전날)의 제출일 / 과제 있던 날 (20261028b)
                · 필기 2주 연속 없음(설정에서 켰을 때만, 기본 끔)
     금액은 이 화면에 넣지 않는다. */
  var OPEN_KEY = 'mhub.today.open';
  function readOpen() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveOpen() { try { localStorage.setItem(OPEN_KEY, JSON.stringify(st.open)); } catch (e) {} }
  st.open = readOpen();
  st.rest = {};
  st.appOpen = {};

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
     레포트   L 이 든 주의 레포트. L ~ L+1일은 「작성 중」(급함 아님), L+[설정 · 기본 2]일부터 아직 안 보낸 학생 = 급함
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
  /* 화면이 계산한 주기를 넘기고 반마다 공개 · 발송 · 복습 · 필기를 받는다 (022 전에는 null → 예전 기준) */
  function loadCycle(classes) {
    var list = classes.filter(function (c) { return c.cy && c.cy.L; }).map(function (c) {
      return { 'class': c.name, week: c.cy.week, from: c.cy.from, to: c.cy.to, pfrom: c.cy.pfrom, pto: c.cy.pto };
    });
    if (!list.length) return Promise.resolve({ ok: true, classes: [] });
    return sb().rpc('coach_cycle', { p: list }).then(function (r) {
      if (r.error) return isMissing(r.error) ? null : Promise.reject(new Error(r.error.message));
      return r.data;
    });
  }
  function cycleRow(cls, id) {
    var c = st.cycle && st.cycle[cls];
    return c ? c.by[id] || null : null;
  }
  function urgentOf(s, set, dv, cy) {
    var out = [];
    if (s.absent_n >= set.absentMin) out.push({ k: 'absent', t: '최근 ' + set.absentWeeks + '주 결석 ' + s.absent_n + '회' });
    /* 그 반 수업 주기 자료가 있으면 그것으로, 없으면(요일 미정 · 022 전) 예전 기준 */
    var row = st.cycle ? cycleRow(s.class_name, s.id) : null;
    if (row) {
      var c = st.cycle[s.class_name];
      if (cy && cy.L && cy.since >= dv.grace && !row.sent) out.push({ k: 'report', t: Lesson.md(cy.L, false) + ' 레포트 미발송' });
      if (c && c.test && DDay.today() > String(c.test.lesson_date).slice(0, 10) && row.submitted === false) out.push({ k: 'review', t: '복습테스트 ' + c.test.round_no + '회 미제출' });
    } else {
      (reviewMiss[s.id] || []).forEach(function (x) { out.push({ k: 'review', t: '복습테스트 ' + x.round_no + '회 미제출' }); });
    }
    if (s.follow_n) out.push({ k: 'follow', t: '확인 필요 상담 ' + s.follow_n });
    return out;
  }
  /* 앱 과제 — 그 반 직전 과제 기간 (주기의 pfrom ~ pto · 오늘이 수업일이면 막 끝난 기간). 과제 있던 날이 없으면 null */
  function appWeekOf(s, cy) {
    var a = app[s.id];
    if (!s.app || !a || !a.ok || !a.data || !cy || !cy.L || !window.AppWeek) return null;
    var w = AppWeek.compute(a.data, cy.pfrom, cy.pto, DDay.today());
    return w && w.hwDays ? w : null;
  }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function watchOf(s, dv, cy) {
    var out = [];
    var w = appWeekOf(s, cy);
    if (w && w.hwDone / w.hwDays * 100 < dv.appLow) {
      out.push({ k: 'app', t: '앱 과제 ' + w.hwDone + '/' + w.hwDays + '일', sid: s.id,
        detail: md(w.from) + '~' + md(w.to) + ' · 정시 ' + w.hwOnTime + '일 · 늦게 ' + (w.hwDone - w.hwOnTime) + '일 · 미제출 ' + (w.hwDays - w.hwDone) + '일' });
    }
    if (dv.photoWatch) {
      var row = st.cycle ? cycleRow(s.class_name, s.id) : null;
      if (row) { if (!row.photos_cur && !row.photos_prev) out.push({ k: 'photo', t: '필기 2주기 연속 없음' }); }
      else if (!s.photos_week && !s.photos_prev) out.push({ k: 'photo', t: '필기 2주 연속 없음' });
    }
    return out;
  }

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

  function tagsHtml(list, cls) {
    return list.map(function (w) {
      /* 앱 과제 꼬리표는 누르면 기간 · 정시 · 늦게 · 미제출을 펼친다 */
      if (w.detail) return '<button type="button" class="td-why td-why--' + w.k + ' td-why--btn ' + cls + '" data-appd="' + esc(w.sid) + '" aria-expanded="' + !!st.appOpen[w.sid] + '" title="' + esc(w.detail) + '">' + esc(w.t) + '</button>';
      return '<span class="td-why td-why--' + w.k + ' ' + cls + '">' + esc(w.t) + '</span>';
    }).join('');
  }
  function appDetailHtml(s, why) {
    var w = why.watch.filter(function (x) { return x.detail; })[0];
    return w && st.appOpen[s.id] ? '<div class="tdc-st__detail num">앱 과제 ' + esc(w.detail) + '</div>' : '';
  }
  function studentRow(s, why) {
    return '<div class="tdc-st' + (why.urgent.length ? ' is-urgent' : why.watch.length ? ' is-watch' : '') + '" data-id="' + esc(s.id) + '">' +
      '<div class="tdc-st__main"><button type="button" class="roster__name roster__name-btn" data-card="' + esc(s.id) + '">' + esc(s.name) + '</button>' +
        tagsHtml(why.urgent, 'td-why--urgent') + tagsHtml(why.watch, 'td-why--watch') + '</div>' + appDetailHtml(s, why) +
      '<div class="tdc-st__acts"><button type="button" class="btn btn--sm" data-card="' + esc(s.id) + '">상담 카드</button>' +
        '<button type="button" class="btn btn--sm" data-sms-sid="' + esc(s.id) + '">문자</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-pv="student" data-sid="' + esc(s.id) + '">학생 화면 보기</button></div>' +
    '</div>';
  }

  function render() {
    var d = st.data;
    if (!d) return;
    var set = d.settings, dv = dash();
    var list = d.students;
    var classes = classList(d);             /* 반이 바뀌어도 바로 (주기 자료는 반 이름으로 찾는다) */
    var cyBy = {};
    classes.forEach(function (c) { cyBy[c.name] = c.cy; });
    var why = {};
    list.forEach(function (s) { why[s.id] = { urgent: urgentOf(s, set, dv, cyBy[s.class_name]), watch: watchOf(s, dv, cyBy[s.class_name]) }; });

    /* 탭 옆 숫자 = 급함 학생 수 (보관한 반 학생도 센다) */
    var urgentN = list.filter(function (s) { return why[s.id].urgent.length; }).length;
    var badge = $('#todayBadge');
    badge.hidden = !urgentN;
    badge.textContent = urgentN;
    badge.title = '급함 학생 ' + urgentN + '명';

    /* 반마다 지난 수업일 레포트 · 지금 주기 필기로 센 값의 합 (022 전에는 예전 이번 주 값) */
    function rowOf(s) { return st.cycle ? cycleRow(s.class_name, s.id) : null; }
    var unsent = list.filter(function (s) { var x = rowOf(s); return x ? !x.sent : !s.sent; }).length;
    var unpaidN = list.filter(function (s) { return s.unpaid_n; }).length;
    var follow = list.reduce(function (a, s) { return a + s.follow_n; }, 0);
    var noPhoto = list.filter(function (s) { var x = rowOf(s); return x ? !x.photos_cur : !s.photos_week; }).length;
    var summary = [
      ['재원생', list.length + '명'],
      ['레포트 미발송', unsent + '명'],
      ['교재비 미납', unpaidN + '명'],
      ['확인 필요 상담', follow + '건'],
      ['필기 미제출', noPhoto + '명']
    ];
    $('#tdWeek').textContent = '이번 주 ' + Store.dateWithDow(d.week.start) + ' ~ ' + Store.dateWithDow(d.week.end);

    $('#tdBody').innerHTML = transitionHtml() +
      '<div class="tb-cards td-summary">' + summary.map(function (c) {
        return '<div class="tb-card"><div class="tb-card__label">' + c[0] + '</div><div class="tb-card__val num">' + esc(c[1]) + '</div></div>';
      }).join('') + '</div>' +
      (st.cycleMissing ? '<p class="panel__hint tdc-rule">migration-022 를 실행하면 반마다 수업 주기(지난 수업일 ~ 다음 수업 전날)로 셉니다. 지금은 달력 주 기준입니다.</p>' : '') +
      '<p class="panel__hint tdc-rule">급함 — 레포트 미발송(수업일 +' + dv.grace + '일부터) · 복습테스트 미제출(마감 뒤) · 최근 ' + set.absentWeeks + '주 결석 ' + set.absentMin + '회 이상 · 확인 필요 상담 &nbsp;|&nbsp; 살펴보기 — 앱 과제 제출 ' + dv.appLow + '% 미만(직전 과제 기간)' +
        (dv.photoWatch ? ' · 필기 2주기 연속 없음' : '') + '</p>' +
      '<div class="tdc-list-wrap">' + classes.map(function (c) {
        var rows = c.rows, n = rows.length;
        var urgent = rows.filter(function (s) { return why[s.id].urgent.length; });
        var watch = rows.filter(function (s) { return !why[s.id].urgent.length && why[s.id].watch.length; });
        var rest = rows.filter(function (s) { return !why[s.id].urgent.length && !why[s.id].watch.length; });
        var written = rows.filter(function (s) { return s.written; }).length;
        var pub = rows.filter(function (s) { return s.published; }).length;
        var cy = c.cy, cd = st.cycle && st.cycle[c.name];
        var meta = n + '명 · 작성 ' + written + '/' + n + ' · 공개 ' + pub + '/' + n;
        var status = '';
        if (cy && !cy.L) status = '<span class="tdc-status">첫 수업 전</span>';
        else if (cy && cd && n) {
          /* 그 반 상태 한마디 — 레포트 미발송(급함) → 복습테스트 진행 중 → 작성 중 → 발송 완료 */
          var cpub = rows.filter(function (s) { return (cd.by[s.id] || {}).published; }).length;
          var csent = rows.filter(function (s) { return (cd.by[s.id] || {}).sent; }).length;
          meta = n + '명 · ' + Lesson.md(cy.L, false) + ' 레포트 공개 ' + cpub + '/' + n + ' · 발송 ' + csent + '/' + n;
          var t = cd.test, open2 = t && DDay.today() <= String(t.lesson_date).slice(0, 10);
          if (cy.since >= dv.grace && csent < n) status = '<span class="tdc-status tdc-status--bad">' + esc(Lesson.md(cy.L, false)) + ' 수업 레포트 미발송 ' + (n - csent) + '명</span>';
          else if (open2) status = '<span class="tdc-status tdc-status--live">복습테스트 진행 중 ' + rows.filter(function (s) { return (cd.by[s.id] || {}).submitted; }).length + '/' + n + ' 제출</span>';
          else if (csent < n) status = '<span class="tdc-status">' + esc(Lesson.md(cy.L, false)) + ' 레포트 작성 중</span>';
          else status = '<span class="tdc-status tdc-status--ok">' + esc(Lesson.md(cy.L, false)) + ' 레포트 발송 완료 ✓</span>';
        }
        var nx = c.next;
        var nextTxt = !nx ? '<span class="tdc-next tdc-next--none">수업일 미정</span>'
          : nx.dday === 0 ? '<span class="tdc-next tdc-next--today">오늘 수업</span>'
          : '<span class="tdc-next">D-' + nx.dday + ' ' + esc(Lesson.md(nx.date)) + '</span>';
        var open = !!st.open[c.name];
        var byName = function (x, y) { return (x.name || '').localeCompare(y.name || '', 'ko'); };
        return '<div class="tdc-card' + (open ? ' is-open' : '') + (nx && nx.dday === 0 ? ' is-today' : '') + '" data-cls="' + esc(c.name) + '">' +
          '<div class="tdc-head">' +
            '<button type="button" class="tdc-toggle" data-toggle aria-expanded="' + open + '">' +
              '<span class="tdc-title"><span class="tdc-name">' + esc(c.name) + '</span>' + (c.academy ? '<span class="muted-note">' + esc(c.academy) + '</span>' : '') +
                '<span class="class-head__caret" aria-hidden="true">▾</span></span>' +
              '<span class="tdc-row">' + nextTxt + (status ? '<span class="tdc-dot" aria-hidden="true">·</span>' + status : '') + '</span>' +
              '<span class="tdc-row"><span class="tdc-meta num">' + esc(meta) + '</span></span>' +
              '<span class="tdc-row">' +
                '<span class="tdc-flag tdc-flag--urgent' + (urgent.length ? '' : ' is-zero') + '">급함 <b class="num">' + urgent.length + '</b></span>' +
                '<span class="tdc-flag tdc-flag--watch' + (watch.length ? '' : ' is-zero') + '">살펴보기 <b class="num">' + watch.length + '</b></span>' +
              '</span>' +
            '</button>' +
            (c.name === '(반 없음)' || !n ? '' : '<button type="button" class="btn btn--sm tdc-sms" data-sms-cls="' + esc(c.name) + '" aria-label="' + esc(c.name) + ' 문자 보내기">문자</button>') +
            (c.name === '(반 없음)' ? '' : '<button type="button" class="btn btn--sm tdc-write" data-write="' + esc(c.name) + '">이번 주 작성하기</button>') +
          '</div>' +
          (open ? '<div class="tdc-list">' +
            (!n ? '<p class="panel__hint">아직 학생이 없습니다. ① 명단 → 학생 추가에서 이 반을 고르세요.</p>' :
              urgent.sort(byName).map(function (s) { return studentRow(s, why[s.id]); }).join('') +
              watch.sort(byName).map(function (s) { return studentRow(s, why[s.id]); }).join('') +
              (rest.length ? (st.rest[c.name]
                ? rest.sort(byName).map(function (s) { return studentRow(s, why[s.id]); }).join('') + '<button type="button" class="btn btn--sm btn--ghost tdc-rest" data-rest>나머지 접기</button>'
                : '<button type="button" class="btn btn--sm btn--ghost tdc-rest" data-rest>나머지 ' + rest.length + '명 [펼치기]</button>') : '')) +
          '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  $('#tdBody').addEventListener('click', function (e) {
    var c = e.target.closest('[data-card]');
    if (c) { if (window.Card) Card.open(c.dataset.card); return; }
    var w = e.target.closest('[data-write]');
    if (w) { writeWeek(w.dataset.write); return; }
    var ad = e.target.closest('[data-appd]');
    if (ad) { var sid = ad.dataset.appd; if (st.appOpen[sid]) delete st.appOpen[sid]; else st.appOpen[sid] = true; render(); return; }
    var r = e.target.closest('[data-rest]');
    if (r) { var cn = r.closest('.tdc-card').dataset.cls; st.rest[cn] = !st.rest[cn]; render(); return; }
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
  $('#tdRefresh').addEventListener('click', function () { app = {}; load(true); loadLinks(); });

  /* [이번 주 작성하기] — ② 작성 탭에서 그 반 이번 주 작성 화면 */
  function writeWeek(cls) {
    if (!window.Writer) return;
    UI.selectTab(1);
    Writer.selectClass(cls);
    Writer.openWeek(Store.thisWeek().start);
  }
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

  /* 뒤로가기 · 새로고침 (nav.js) — 펼친 반 목록 */
  window.TodayView = {
    /* ④ 발송 · 문자 보내기도 같은 반 순서 — 오늘 수업 → 가까운 날 → 같은 날은 이름 순 → 수업일 미정 맨 아래 */
    orderClasses: function (names) {
      return names.map(function (n) { return { name: n, next: n === '(반 없음)' ? null : nextLesson(n) }; })
        .sort(function (x, y) {
          if (!!x.next !== !!y.next) return x.next ? -1 : 1;
          if (x.next && y.next && x.next.date !== y.next.date) return x.next.date < y.next.date ? -1 : 1;
          if ((x.name === '(반 없음)') !== (y.name === '(반 없음)')) return x.name === '(반 없음)' ? 1 : -1;
          return x.name.localeCompare(y.name, 'ko');
        }).map(function (x) { return x.name; });
    },
    nextLesson: nextLesson,
    openList: function () { return Object.keys(st.open).sort(); },
    setOpen: function (list) {
      st.open = {};
      (list || []).forEach(function (n) { if (n) st.open[n] = true; });
      saveOpen();
      if (st.data) render();
    }
  };

})();
