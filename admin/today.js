/* ============================================================
   today.js — 마라톤 코치룸 「오늘」 총괄 (로그인 첫 화면)

   · 서버 함수 coach_today() 한 번으로 반·학생별 숫자를 받는다 (새 표 없음).
   · '작성 완료' 는 ② 작성 탭과 같은 규칙(report.js Report.entryStatus)으로 센다.
   · 앱 과제 제출률은 바깥 앱 서버 자료라 화면이 뜬 뒤 app-report 함수로 4명씩 차례로 불러온다.
     불러온 값은 30분 동안 이 화면 메모리에만 둔다(브라우저에 저장하지 않는다).
   · 조교 금액 숨김이 켜져 있으면 서버가 금액을 보내지 않는다 (이 화면에만 적용).
   · 「오늘」 탭 이름 옆 숫자 = 챙겨야 할 학생 수.
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
  function won(n) { return (Math.round(Number(n) || 0)).toLocaleString('ko-KR') + '원'; }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }

  var APP_LOW = 50;                 /* 앱 과제 제출률 이 값 미만이면 챙기기 */
  var APP_TTL = 30 * 60 * 1000;

  var st = { data: null, loading: false, last: 0, open: {}, role: '', settingsAt: '' };
  var app = {};                     /* 학생 id → { rate, ok, at } */
  var appRun = 0;

  /* ---------- 불러오기 ---------- */

  function load(force) {
    if (st.loading || $('#appRoot').hidden) return;            /* 로그아웃된 뒤에는 부르지 않는다 */
    if (!force && Date.now() - st.last < 10000) return;
    st.loading = true;
    st.last = Date.now();
    if (!st.data) $('#tdBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    sb().rpc('coach_today').then(function (r) {
      st.loading = false;
      if (r.error) throw new Error(r.error.message);
      st.data = prepare(r.data);
      render();
      loadApp();
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

  function reasonsOf(s, set) {
    var out = [];
    if (s.absent_n >= set.absentMin) out.push({ k: 'absent', t: '최근 ' + set.absentWeeks + '주 결석 ' + s.absent_n + '회' });
    var a = app[s.id];
    if (s.app && a && a.ok && a.rate < APP_LOW) out.push({ k: 'app', t: '앱 과제 ' + a.rate + '%' });
    if (!s.photos_week && !s.photos_prev) out.push({ k: 'photo', t: '필기 2주 연속 없음' });
    if (s.follow_n) out.push({ k: 'follow', t: '확인 필요 상담 ' + s.follow_n });
    return out;
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
          var rate = res && res.ok && res.data && res.data.stats ? Number(res.data.stats.submissionRate) : NaN;
          app[s.id] = { ok: !isNaN(rate), rate: isNaN(rate) ? null : Math.round(rate), at: Date.now() };
        }, function () { app[s.id] = { ok: false, rate: null, at: Date.now() }; })
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

  function bar(n, total, label) {
    var pct = total ? Math.round(n / total * 100) : 0;
    return '<div class="td-bar"><span class="td-bar__label">' + label + '</span>' +
           '<span class="td-bar__track"><span class="td-bar__fill" style="width:' + pct + '%"></span></span>' +
           '<span class="td-bar__num num">' + n + '/' + total + '</span></div>';
  }

  function appAvg(list) {
    var withApp = list.filter(function (s) { return s.app; });
    var ok = withApp.filter(function (s) { return app[s.id] && app[s.id].ok; });
    var fail = withApp.filter(function (s) { return app[s.id] && !app[s.id].ok; }).length;
    var avg = ok.length ? Math.round(ok.reduce(function (a, s) { return a + app[s.id].rate; }, 0) / ok.length) : null;
    return { n: withApp.length, avg: avg, fail: fail, pending: withApp.length - ok.length - fail };
  }

  var ATT = { attend: '출석', late: '지각', absent: '결석', makeup: '보강' };

  function render() {
    var d = st.data;
    if (!d) return;
    var set = d.settings;
    var list = d.students;

    /* 반 묶기 — 학원 → 반 */
    var classes = [], idx = {};
    list.forEach(function (s) {
      var k = s.class_name || '(반 없음)';
      if (!(k in idx)) { idx[k] = classes.length; classes.push({ name: k, academy: s.academy, rows: [] }); }
      classes[idx[k]].rows.push(s);
    });
    /* 학생이 아직 0명인 반도 보인다 (반 목록은 Store.getClasses() 하나) */
    Store.getClasses().forEach(function (c) {
      if (!(c.name in idx)) { idx[c.name] = classes.length; classes.push({ name: c.name, academy: '', rows: [] }); }
    });
    /* 보관한 반은 카드만 숨긴다 — 그 반 학생은 위 '챙겨야 할 학생' 에 그대로 나온다 */
    classes = classes.filter(function (c) { return !Store.isArchivedClass(c.name); });
    classes.sort(function (a, b) {
      return (a.academy || '힣').localeCompare(b.academy || '힣', 'ko') || a.name.localeCompare(b.name, 'ko');
    });

    /* 이유가 많은 학생부터 */
    var care = list.map(function (s) { return { s: s, why: reasonsOf(s, set) }; })
      .filter(function (x) { return x.why.length; })
      .sort(function (a, b) { return b.why.length - a.why.length || (a.s.name || '').localeCompare(b.s.name || '', 'ko'); });
    var badge = $('#todayBadge');
    badge.hidden = !care.length;
    badge.textContent = care.length;
    badge.title = '챙겨야 할 학생 ' + care.length + '명';

    var unsent = list.filter(function (s) { return !s.sent; }).length;
    var unpaidN = list.filter(function (s) { return s.unpaid_n; }).length;
    var unpaidSum = list.reduce(function (a, s) { return a + (s.unpaid_amt || 0); }, 0);
    var follow = list.reduce(function (a, s) { return a + s.follow_n; }, 0);
    var noPhoto = list.filter(function (s) { return !s.photos_week; }).length;

    var summary = [
      ['재원생', list.length + '명'],
      ['이번 주 레포트 미발송', unsent + '명'],
      ['교재비 미납', set.money ? won(unpaidSum) + ' · ' + unpaidN + '명' : unpaidN + '명'],
      ['확인 필요 상담', follow + '건'],
      ['이번 주 필기 미제출', noPhoto + '명']
    ];

    $('#tdWeek').textContent = '이번 주 ' + Store.dateWithDow(d.week.start) + ' ~ ' + Store.dateWithDow(d.week.end);

    $('#tdBody').innerHTML =
      '<div class="tb-cards td-summary">' + summary.map(function (c) {
        return '<div class="tb-card"><div class="tb-card__label">' + c[0] + '</div><div class="tb-card__val num">' + esc(c[1]) + '</div></div>';
      }).join('') + '</div>' +

      '<div class="sub"><div class="sub__head"><span class="sub__title">챙겨야 할 학생 ' + care.length + '명</span>' +
        '<span class="sub__hint">최근 ' + set.absentWeeks + '주 결석(보강 포함) ' + set.absentMin + '회 이상 · 앱 과제 ' + APP_LOW + '% 미만 · 필기 2주 연속 없음 · 확인 필요 상담</span></div>' +
        (care.length ? '<div class="td-care">' + care.map(function (x) {
          return '<div class="td-care__row"><button type="button" class="roster__name roster__name-btn" data-card="' + x.s.id + '">' + esc(x.s.name) + '</button>' +
            '<span class="muted-note">' + esc(x.s.class_name) + '</span>' +
            x.why.map(function (w) { return '<span class="td-why td-why--' + w.k + '">' + esc(w.t) + '</span>'; }).join('') + '</div>';
        }).join('') + '</div>' : '<p class="panel__hint">지금은 챙겨야 할 학생이 없습니다 👍</p>') +
      '</div>' +

      '<div class="td-classes">' + classes.map(function (c) {
        var rows = c.rows;
        var n = rows.length;
        if (!n) {
          return '<div class="td-card td-card--empty" data-cls="' + esc(c.name) + '"><div class="td-card__head">' +
            '<span class="td-card__name">' + esc(c.name) + '</span><span class="spacer"></span>' +
            '<span class="td-card__count">0명</span></div>' +
            '<div class="td-card__body"><div class="td-line muted-note">아직 학생이 없습니다. ① 명단 → 학생 추가에서 이 반을 고르세요.</div></div></div>';
        }
        var cnt = { attend: 0, late: 0, absent: 0 };
        rows.forEach(function (s) {
          if (s.attend === 'attend') cnt.attend++;
          else if (s.attend === 'late') cnt.late++;
          else if (s.attend === 'absent' || s.attend === 'makeup') cnt.absent++;
        });
        var written = rows.filter(function (s) { return s.written; }).length;
        var pub = rows.filter(function (s) { return s.published; }).length;
        var sent = rows.filter(function (s) { return s.sent; }).length;
        var ap = appAvg(rows);
        var photo = rows.filter(function (s) { return s.photos_week; }).length;
        var upN = rows.filter(function (s) { return s.unpaid_n; }).length;
        var upSum = rows.reduce(function (a, s) { return a + (s.unpaid_amt || 0); }, 0);
        var fol = rows.reduce(function (a, s) { return a + s.follow_n; }, 0);
        var low = (d.low_stock || {})[c.name] || [];
        var open = !!st.open[c.name];
        return '<div class="td-card' + (open ? ' is-open' : '') + '" data-cls="' + esc(c.name) + '">' +
          '<button type="button" class="td-card__head" data-toggle>' +
            '<span class="td-card__name">' + esc(c.name) + '</span>' +
            (c.academy ? '<span class="muted-note">' + esc(c.academy) + '</span>' : '') +
            '<span class="spacer"></span><span class="td-card__count">' + n + '명</span><span class="class-head__caret" aria-hidden="true">▾</span>' +
          '</button>' +
          '<div class="td-card__body">' +
            '<div class="td-line">출결 <b>출석 ' + cnt.attend + '</b> · 지각 ' + cnt.late + ' · <span class="' + (cnt.absent ? 'tb-warn' : '') + '">결석 ' + cnt.absent + '</span>' +
              ' <span class="muted-note">(미입력 ' + (n - cnt.attend - cnt.late - cnt.absent) + ')</span></div>' +
            bar(written, n, '작성') + bar(pub, n, '공개') + bar(sent, n, '발송') +
            '<div class="td-line">앱 과제 ' + (ap.n ? (ap.avg == null ? (ap.pending ? '불러오는 중…' : '—') : '평균 <b>' + ap.avg + '%</b>') +
              ' <span class="muted-note">(앱 연결 ' + ap.n + '명' + (ap.fail ? ' · 불러오기 실패 ' + ap.fail + '명' : '') + ')</span>' : '<span class="muted-note">앱 연결된 학생 없음</span>') + '</div>' +
            '<div class="td-line">필기 <b>' + photo + '</b> / ' + n + '명</div>' +
            '<div class="td-line">교재비 미납 ' + (upN ? '<b class="tb-warn">' + upN + '명' + (set.money ? ' · ' + won(upSum) : '') + '</b>' : '0명') +
              (low.length ? ' · <span class="tb-warn">재고 부족 ' + low.map(esc).join(', ') + '</span>' : '') + '</div>' +
            '<div class="td-line">다음 상담 때 확인 ' + (fol ? '<b class="tb-warn">' + fol + '건</b>' : '0건') + '</div>' +
          '</div>' +
          (open ? studentTable(rows, set) : '') +
        '</div>';
      }).join('') + '</div>';
  }

  function studentTable(rows, set) {
    return '<div class="roster-scroll td-students"><table class="roster tb-table"><thead><tr>' +
      '<th>학생</th><th>출결</th><th>작성</th><th>공개</th><th>발송</th><th class="tb-r">앱</th><th class="tb-r">필기</th><th>미납</th><th>확인</th></tr></thead><tbody>' +
      rows.map(function (s) {
        var a = app[s.id];
        var appTxt = !s.app ? '—' : !a ? '…' : a.ok ? a.rate + '%' : '실패';
        return '<tr><td><button type="button" class="roster__name roster__name-btn" data-card="' + s.id + '">' + esc(s.name) + '</button></td>' +
          '<td>' + esc(ATT[s.attend] || '—') + (s.absent_n ? ' <span class="muted-note">' + set.absentWeeks + '주 결석 ' + s.absent_n + '</span>' : '') + '</td>' +
          '<td>' + (s.written ? '✓' : '') + '</td><td>' + (s.published ? '✓' : '') + '</td><td>' + (s.sent ? '✓' : '') + '</td>' +
          '<td class="tb-r num' + (a && a.ok && a.rate < APP_LOW ? ' tb-warn' : '') + '">' + appTxt + '</td>' +
          '<td class="tb-r num">' + (s.photos_week || '') + '</td>' +
          '<td>' + (s.unpaid_n ? '<span class="tb-warn">' + (set.money ? won(s.unpaid_amt) : s.unpaid_n + '건') + '</span>' : '') + '</td>' +
          '<td>' + (s.follow_n ? '<span class="note-badge">확인 ' + s.follow_n + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  $('#tdBody').addEventListener('click', function (e) {
    var c = e.target.closest('[data-card]');
    if (c) { if (window.Card) Card.open(c.dataset.card); return; }
    var t = e.target.closest('[data-toggle]');
    if (t) {
      var name = t.closest('.td-card').dataset.cls;
      st.open[name] = !st.open[name];
      render();
    }
  });
  $('#tdRefresh').addEventListener('click', function () { app = {}; load(true); });

  /* ---------- 설정 (teacher 만 바꿀 수 있다) ---------- */

  $('#tdSettingsBtn').addEventListener('click', function () {
    DB.getSettingRow('dashboard').then(function (row) {
      var v = (row && row.value) || {};
      st.settingsAt = (row && row.updated_at) || '';
      $('#tdSetMoney').checked = v.assistantSeeMoney !== false;
      $('#tdSetWeeks').value = v.absentWeeks || 4;
      $('#tdSetMin').value = v.absentMin || 2;
      var teacher = st.role === 'teacher';
      ['#tdSetMoney', '#tdSetWeeks', '#tdSetMin'].forEach(function (s) { $(s).disabled = !teacher; });
      $('#tdSetSave').hidden = !teacher;
      $('#tdSetNote').textContent = teacher ? '' : '이 설정은 선생님(teacher) 계정만 바꿀 수 있습니다.';
      $('#tdSettingsModal').showModal();
    }).catch(function (e) { toast(e.message, 'bad'); });
  });
  $('#tdSetCancel').addEventListener('click', function () { $('#tdSettingsModal').close(); });
  $('#tdSettingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = {
      assistantSeeMoney: $('#tdSetMoney').checked,
      absentWeeks: Math.max(1, Math.min(12, parseInt($('#tdSetWeeks').value, 10) || 4)),
      absentMin: Math.max(1, Math.min(12, parseInt($('#tdSetMin').value, 10) || 2))
    };
    UI.guardedSave('「오늘」 화면 설정', function (chk) {
      return DB.saveSettingIf('dashboard', v, UI.whoami(), chk ? st.settingsAt : '');
    }, function () { $('#tdSettingsModal').close(); }).then(function (res) {
      if (!res.ok) return;
      $('#tdSettingsModal').close();
      toast('설정을 저장했습니다', 'good');
      load(true);
    }).catch(function (x) { toast('저장하지 못했습니다 — ' + x.message, 'bad'); });
  });

  /* ---------- 언제 다시 계산하나 ---------- */

  window.addEventListener('jt:loaded', function () {
    DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; });
    load(true);
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

})();
