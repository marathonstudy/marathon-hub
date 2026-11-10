/* ============================================================
   mogo.js — 모의고사 분석 레포트(marathon-report) 연동 · 코치룸 화면 (migration-089 · 함수 mogo-sync · 20261109b · 연동약속.md 버전 2)

   브라우저는 모고 주소를 직접 부르지 않는다 — 저장본(mogo_records)만 읽고, [↻]는 코치룸 함수 mogo-sync 를 부른다.
   학생 상세(빠른 상담 창 · 상담 카드) 「모의고사」 칸
     · 위쪽 — [나의 기록장] [종합 분석] · 대표 유형 · 한 줄 요약 (받은 것에 있을 때만)
     · 회차마다 — 회차 이름 · 응시일 · 점수 · 등급 · 완성/작성 중 · 첫 응시/재응시 · 누르면 화면 안 창(iframe)으로 레포트
     · 「일치하는 학생 없음」 → 「모의고사 기록 없음」 · 번호가 없으면 「번호가 없어 찾을 수 없어요」 · 키가 없으면 「연동 설정 필요」
     · 미완성은 「만드는 중」 · 애매하면(check) 「모의고사 기록 연결 확인 필요」 + 이유 · 못 읽으면 「모의고사 기록을 불러오지 못했어요」만
     · [↻] 그 학생만 다시 받기
   「오늘」 맨 위 작은 줄(운영진) — 「모고 레포트 연결 끊김」 · 「모고 레포트에 새 항목이 생겼어요」(받은 버전 > 약속 버전) ·
     「학생 번호가 비어 있는 학생 n명」(펼치면 이름 · 「학생 → 명단 → 번호 한꺼번에 넣기」로 채우면 됨) ·
     「모의고사 기록 연결 확인 필요 n명」(펼치면 이름 · 이유 · 이름을 누르면 빠른 상담 창)
   화면 안 창 높이 — 레포트가 보내는 { type: "mogo:height", height } 를 origin(https://marathon-report.netlify.app) 확인 뒤 받는다
   ============================================================ */

(function () {
  'use strict';

  var ORIGIN = 'https://marathon-report.netlify.app';
  var CONTRACT = 2;                       /* 연동약속.md 버전 — 받은 버전이 이보다 높으면 「새 항목이 생겼어요」 */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function mdw(iso) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
    var d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '(' + DOWK[d.getUTCDay()] + ')';
  }
  function hm(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function okUrl(u) { return typeof u === 'string' && u.indexOf(ORIGIN + '/') === 0 && !/[\s"'<>]/.test(u) ? u : ''; }
  function okId(id) { return typeof id === 'string' && /^[A-Za-z0-9._-]{6,120}$/.test(id); }

  var st = { sql: null, rec: {}, status: {}, counts: {}, busy: {}, loading: false, moreOpen: {} };

  /* ---------- 불러오기 (저장본만) ---------- */
  var COLS = 'student_id,state,reports,extra,version,reason,fails,fetched_at';
  function load() {
    if (!sb() || st.loading) return Promise.resolve();
    st.loading = true;
    return Promise.all([
      Promise.resolve(sb().from('mogo_records').select(COLS)),
      Promise.resolve(sb().rpc('mogo_status'))
    ]).then(function (a) {
      st.loading = false;
      if (a[0].error) { st.sql = false; paintAll(); return; }
      st.sql = true;
      var m = {};
      (a[0].data || []).forEach(function (r) { m[r.student_id] = r; });
      st.rec = m;
      var s = (!a[1].error && a[1].data) || {};
      st.status = s.status || {}; st.counts = s.counts || {};
      paintAll();
    }, function () { st.loading = false; st.sql = false; paintAll(); });
  }
  function loadOne(sid) {
    return Promise.resolve(sb().from('mogo_records').select(COLS).eq('student_id', sid)).then(function (r) {
      if (!r.error) { if (r.data && r.data[0]) st.rec[sid] = r.data[0]; else delete st.rec[sid]; }
      paintAll();
    });
  }

  /* ---------- 학생 상세 「모의고사」 칸 ---------- */
  function newer() {
    var v = +st.status.version || 0;
    Object.keys(st.rec).forEach(function (k) { v = Math.max(v, +st.rec[k].version || 0); });
    return v > CONTRACT ? v : 0;
  }
  function rowHtml(x) {
    if (!x || !okId(x.id)) return '';
    var att = x.firstAttempt === false ? '재응시' + (x.attempt > 1 ? ' ' + x.attempt + '번째' : '') : '첫 응시';
    return '<li><button type="button" class="mg-row" data-mg-open="' + esc(x.id) + '" data-mg-title="' + esc(x.examName || '모의고사') + '">' +
      '<span class="mg-row__n">' + esc(x.examName || '모의고사') + '</span>' +
      '<span class="mg-row__m num">' + esc([mdw(x.date), x.score != null ? x.score + '점' : '', x.grade || ''].filter(Boolean).join(' · ')) + '</span>' +
      '<span class="mg-row__t">' + (x.done ? '<b class="mg-tag mg-tag--done">완성</b>' : '<b class="mg-tag mg-tag--wip">만드는 중</b>') +
        ' <b class="mg-tag' + (x.firstAttempt === false ? ' mg-tag--again' : '') + '">' + esc(att) + '</b></span></button></li>';
  }
  /* 「확인 필요」 이유 — 운영진만 */
  var CHECK_WHY = {
    sibling: '코치룸에 같은 이름 · 같은 번호인 학생이 둘 이상이라 누구 기록인지 가를 수 없어요',
    multi: '학부모 번호 1 · 2 로 서로 다른 모의고사 학생이 나와요',
    mixed: '같은 시험 같은 응시 차례가 두 번 있어 다른 학생 기록이 섞였을 수 있어요'
  };
  var FAIL = '모의고사 기록을 불러오지 못했어요';
  /* 일치 없음 — 모고 연동 주소는 「이름 + 번호」가 함께 맞는지만 알려 줘서 「이름이 없음」과 「이름은 같고 번호가 다름」을 가를 수 없다 (모고 쪽은 고치지 않음) */
  var NONE_WHY = '모고 사이트에 이름 · 번호가 맞는 학생이 없어요 — 이름이 없거나 번호가 달라요';
  /* 옛 연결 (migration-098) — 연결됐던 번호가 모고에서 없어짐(같은 학생 기록 합치기 등) · extra.old = { reports, notebookUrl, at } */
  function oldOf(r) { var o = r && r.extra && r.extra.old; return o && typeof o === 'object' && Array.isArray(o.reports) ? o : null; }
  var OLD_WHY = '예전에 연결됐던 번호로 모고 사이트에서 학생을 찾을 수 없어요(모고 쪽에서 같은 학생 기록을 합쳤을 수 있어요) — 다음 받기 때 이름 + 번호로 다시 찾아요';
  function oldHtml(o, sid) {
    var list = (o.reports || []).slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return '<details class="mg-old" data-mg-old="' + esc(sid) + '"><summary><small>옛 연결 ' + list.length + '개' + (o.at ? ' · ' + esc(mdw(o.at)) + ' 끊김' : '') + '</small></summary>' +
      (list.length ? '<ol class="mg-list">' + list.map(rowHtml).join('') + '</ol>' : '') + '</details>';
  }
  /* 학생 카드 · 숫자 줄 — 연결 상태 한 단어 */
  function linkState(sid) {
    if (st.sql === false) return { k: 'fail', t: '불러오지 못함' };
    var r = st.rec[sid];
    if (!r) return { k: 'wait', t: '아직 안 받음' };
    if (r.state === 'none' && oldOf(r)) return { k: 'old', t: '학생 없음(옛 번호)' };
    return ({ ok: { k: 'ok', t: '연결됨' }, none: { k: 'none', t: '일치 없음' }, nophone: { k: 'nophone', t: '번호 없음' }, check: { k: 'check', t: '확인 필요' } })[r.state] ||
      { k: 'fail', t: '아직 못 받음' };
  }
  function counts(list) {
    var c = { all: list.length, ok: 0, none: 0, old: 0, nophone: 0, check: 0, wait: 0, fail: 0 };
    list.forEach(function (s) { c[linkState(s.id).k]++; });
    return c;
  }
  /* opts.limit — 학생 카드는 최근 3개 + 「더 보기」 (20261109c) */
  function sectionHtml(sid, opts) {
    var lim = opts && +opts.limit > 0 ? +opts.limit : 0;
    if (st.sql === null) return '';
    if (st.sql === false) return '<section class="mg-sec" data-mg-sec="' + esc(sid) + '"><div class="mg-head"><h3 class="mg-title">모의고사</h3></div><p class="mg-muted mg-fail">' + FAIL + '</p></section>';
    var r = st.rec[sid], s = st.status.state || '';
    var head = '<div class="mg-head"><h3 class="mg-title">모의고사</h3>' +
      (s !== 'nokey' ? '<button type="button" class="mg-refresh" data-mg-refresh="' + esc(sid) + '" aria-label="모의고사 목록 다시 받기" title="모의고사 목록 다시 받기"' + (st.busy[sid] ? ' disabled' : '') + '>' + (st.busy[sid] ? '…' : '↻') + '</button>' : '') +
      (r && r.fetched_at ? '<small class="mg-when num">' + esc(hm(r.fetched_at)) + ' 받음</small>' : '') + '</div>';
    var body;
    if (s === 'nokey' && !r) body = '<p class="mg-muted">모의고사 연동 설정 필요</p>';
    else if (!r) body = '<p class="mg-muted">아직 받지 않았어요 — ↻ 로 받기</p>';
    else if (r.state === 'none' && oldOf(r)) body = '<p class="mg-check">학생 없음(옛 번호)</p><p class="mg-muted"><small>' + esc(OLD_WHY) + '</small></p>' + oldHtml(oldOf(r), sid);
    else if (r.state === 'none') body = '<p class="mg-muted">모의고사 기록 없음 <small>(' + esc(NONE_WHY) + ')</small></p>';
    else if (r.state === 'nophone') body = '<p class="mg-muted">모의고사 기록 없음 <small>(번호 없음 — 학생 · 학부모 번호가 없어 찾을 수 없어요)</small></p>';
    else if (r.state === 'check') body = '<p class="mg-check">모의고사 기록 연결 확인 필요</p><p class="mg-muted"><small>' + esc(CHECK_WHY[r.reason] || '찾은 기록이 이 학생 것인지 애매해요') + ' — 학생 번호를 확인하면 다음 받기 때 다시 찾아요</small></p>';
    else if (r.state === 'error' && !(r.reports || []).length) body = '<p class="mg-muted mg-fail">' + FAIL + '</p>';
    else {
      var ex = r.extra || {}, nb = okUrl(ex.notebookUrl), an = okUrl(ex.analysisUrl), list = (r.reports || []).slice();
      list.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      body = (nb || an || ex.typeCode || ex.summary ? '<div class="mg-top">' +
          (nb || an ? '<div class="mg-top__btns">' + (nb ? '<button type="button" class="btn btn--sm" data-mg-url="' + esc(nb) + '" data-mg-title="나의 기록장">📒 나의 기록장</button>' : '') +
            (an ? '<button type="button" class="btn btn--sm" data-mg-url="' + esc(an) + '" data-mg-title="종합 분석">📊 종합 분석</button>' : '') + '</div>' : '') +
          (ex.typeCode ? '<p class="mg-type">대표 풀이 유형 <b class="num">' + esc(ex.typeCode) + '</b></p>' : '') +
          (ex.summary ? '<p class="mg-sum">' + esc(ex.summary) + '</p>' : '') + '</div>' : '') +
        (list.length ? '<ol class="mg-list">' + (lim && !st.moreOpen[sid] ? list.slice(0, lim) : list).map(rowHtml).join('') + '</ol>' +
          (lim && list.length > lim ? '<button type="button" class="mg-more" data-mg-more="' + esc(sid) + '" aria-expanded="' + !!st.moreOpen[sid] + '">' + (st.moreOpen[sid] ? '최근 ' + lim + '개만 ▴' : '더 보기 (' + list.length + '개) ▾') + '</button>' : '')
          : '<p class="mg-muted">모의고사 기록 없음</p>') +
        (r.reason === 'parent' ? '<p class="mg-via"><small>학부모 번호 + 이름으로 찾음</small></p>' : '') +
        (oldOf(r) ? oldHtml(oldOf(r), sid) : '');
    }
    /* 마지막 받기가 실패했으면 — 예전 저장본은 그대로 보여 주고 작게 한 줄 */
    if (r && r.fails > 0 && r.state !== 'error') body += '<p class="mg-muted mg-fail"><small>' + FAIL + ' — 예전에 받은 것을 보여 줘요</small></p>';
    return '<section class="mg-sec" data-mg-sec="' + esc(sid) + '">' + head + body + '</section>';
  }
  function paintAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mg-host]'), function (h) { h.innerHTML = sectionHtml(h.getAttribute('data-mg-host'), { limit: h.getAttribute('data-mg-limit') }); });
    paintOps();
    paintCls();
    if (window.StudentCard && StudentCard.mogoChanged) StudentCard.mogoChanged();
  }
  function mount(host, sid) {
    if (!host) return;
    host.setAttribute('data-mg-host', sid);
    host.innerHTML = sectionHtml(sid);
    if (st.sql === null) load();
  }

  /* ---------- [↻] 그 학생만 (함수 mogo-sync 를 거쳐서만) ---------- */
  function refresh(sid) {
    var fns = sb() && sb().functions;
    if (!fns || st.busy[sid]) return;
    st.busy[sid] = true; paintAll();
    Promise.resolve(fns.invoke('mogo-sync', { body: { action: 'refresh', students: [sid] } })).then(function (r) {
      var d = (r && r.data) || {};
      st.busy[sid] = false;
      if (!d.ok) toast(d.reason === 'nokey' ? '모의고사 연동 설정 필요 (MOGO_HUB_KEY)' : FAIL, 'bad');
      else if (d.stopped || d.failed) toast(FAIL, 'bad');
      else if (d.check) toast('모의고사 기록 연결 확인 필요', 'bad');
      else toast(d.none || d.nophone ? '모의고사 기록 없음' : '모의고사 목록을 받았습니다', 'good');
      return loadOne(sid).then(load);
    }, function () { st.busy[sid] = false; paintAll(); toast(FAIL, 'bad'); });
  }

  /* ---------- 반 카드 [모고 기록 지금 받기] — 그 반 전체 (함수 mogo-sync · 한 번에 20명씩 · 같은 반 10분 안에 다시 못 누름 · 20261109c) ---------- */
  var CLS_GAP = 10 * 60000, clsRes = {};
  function clsKey(cls) { return 'mhub.mogoCls.' + cls; }
  function clsLast(cls) { try { return +localStorage.getItem(clsKey(cls)) || 0; } catch (e) { return clsRes[cls] && clsRes[cls].at || 0; } }
  function classHtml(cls) {
    if (!st.sql || (st.status.state || '') === 'nokey') return '<div class="mg-cls" data-mg-clshost="' + esc(cls) + '" hidden></div>';
    var r = clsRes[cls] || {}, wait = Math.ceil((clsLast(cls) + CLS_GAP - Date.now()) / 60000);
    var btn = r.busy ? '<button type="button" class="btn btn--sm mg-cls__b" disabled>모고 기록 받는 중 <span class="num">' + r.done + '/' + r.total + '</span></button>'
      : '<button type="button" class="btn btn--sm mg-cls__b" data-mg-cls="' + esc(cls) + '"' + (wait > 0 ? ' disabled title="같은 반은 10분 뒤 다시"' : '') + '>모고 기록 지금 받기' + (wait > 0 ? ' <small class="num">(' + wait + '분 뒤)</small>' : '') + '</button>';
    return '<div class="mg-cls" data-mg-clshost="' + esc(cls) + '">' + btn + (r.msg ? '<span class="mg-cls__m num" role="status">' + esc(r.msg) + '</span>' : '') + '</div>';
  }
  function paintCls(cls) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mg-clshost]'), function (h) {
      if (!cls || h.getAttribute('data-mg-clshost') === cls) h.outerHTML = classHtml(h.getAttribute('data-mg-clshost'));
    });
  }
  function refreshClass(cls) {
    var fns = sb() && sb().functions;
    if (!fns || (clsRes[cls] && clsRes[cls].busy) || clsLast(cls) + CLS_GAP > Date.now()) return;
    var ids = (window.UI && UI.activeStudents ? UI.activeStudents() : []).filter(function (s) { return (s.className || '') === cls; }).map(function (s) { return s.id; });
    if (!ids.length) return;
    try { localStorage.setItem(clsKey(cls), String(Date.now())); } catch (e) {}
    var r = clsRes[cls] = { busy: true, done: 0, total: ids.length, msg: '', at: Date.now() }, sum = { found: 0, none: 0, nophone: 0, check: 0, failed: 0 };
    paintCls(cls);
    var parts = [];
    for (var i = 0; i < ids.length; i += 20) parts.push(ids.slice(i, i + 20));
    var stop = '';
    parts.reduce(function (p, part) {
      return p.then(function () {
        if (stop) return;
        return Promise.resolve(fns.invoke('mogo-sync', { body: { action: 'refresh', students: part } })).then(function (x) {
          var d = (x && x.data) || {};
          if (!d.ok) { stop = d.reason === 'nokey' ? '모의고사 연동 설정 필요' : FAIL; return; }
          ['found', 'none', 'nophone', 'check', 'failed'].forEach(function (k) { sum[k] += +d[k] || 0; });
          if (d.stopped) stop = d.stopped === 'busy' ? '모고 사이트가 바빠요 — 10분 뒤 다시' : FAIL;
          r.done += part.length; paintCls(cls);
        }, function () { stop = FAIL; });
      });
    }, Promise.resolve()).then(function () {
      r.busy = false;
      r.msg = '찾음 ' + sum.found + '명 · 일치 없음 ' + (sum.none + sum.nophone) + '명' + (sum.check ? ' · 확인 필요 ' + sum.check + '명' : '') + (stop ? ' · ' + stop : '');
      paintCls(cls);
      return load();
    });
  }
  setInterval(function () { if (!document.hidden && document.querySelector('[data-mg-cls][disabled]')) paintCls(); }, 60000);

  /* ---------- 화면 안 창 (iframe) ---------- */
  function frameModal() {
    var m = document.getElementById('mgModal');
    if (m) return m;
    m = document.createElement('dialog');
    m.id = 'mgModal'; m.className = 'mg-modal'; m.setAttribute('aria-labelledby', 'mgTitle');
    m.innerHTML = '<div class="mg-modal__head"><h2 class="mg-modal__t" id="mgTitle"></h2><a class="mg-modal__new" id="mgNewTab" target="_blank" rel="noopener">새 탭 ↗</a><button type="button" class="mg-modal__x" id="mgClose" aria-label="닫기">✕</button></div>' +
      '<div class="mg-modal__body"><iframe id="mgFrame" class="mg-frame" title="모의고사 분석 레포트" loading="lazy" referrerpolicy="no-referrer"></iframe></div>';
    document.body.appendChild(m);
    return m;
  }
  function openUrl(url, title) {
    if (!okUrl(url)) return;
    var m = frameModal(), f = $('#mgFrame', m);
    $('#mgTitle', m).textContent = title || '모의고사 분석 레포트';
    $('#mgNewTab', m).href = url;
    f.style.height = '70vh';
    f.src = url;
    if (!m.open) m.showModal();
  }
  function openReport(id, title) { if (okId(id)) openUrl(ORIGIN + '/report.html?id=' + encodeURIComponent(id), title); }
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;                                   /* 꼭 origin 확인 (연동약속.md 4) */
    var d = e.data, f = document.getElementById('mgFrame');
    if (!f || !d || d.type !== 'mogo:height' || !Number.isFinite(d.height)) return;
    f.style.height = Math.max(200, Math.min(20000, Math.round(d.height))) + 'px';
  });

  /* ---------- 「오늘」 맨 위 작은 줄 (운영진) ---------- */
  function noPhone() {
    var list = window.UI && UI.activeStudents ? UI.activeStudents() : [];
    return list.filter(function (s) { return !/^01\d{8,9}$/.test(String(s.studentPhone || '').replace(/\D/g, '')); });
  }
  function needCheck() {
    var list = window.UI && UI.activeStudents ? UI.activeStudents() : [];
    return list.map(function (s) { return { s: s, r: st.rec[s.id] }; }).filter(function (x) { return x.r && x.r.state === 'check'; });
  }
  function opsHtml() {
    if (!st.sql) return '';
    var s = st.status.state || '', parts = [];
    /* 「모고 기록 · 대상 46명 · 연결 30명 · 일치 없음 10명 · 번호 없음 2명」 (20261109c) */
    var all = window.UI && UI.activeStudents ? UI.activeStudents() : [];
    if (all.length) {
      var c = counts(all);
      parts.push('<span class="mg-ops__sum num" id="mgSum">모고 기록 · 대상 ' + c.all + '명 · 연결 ' + c.ok + '명 · 일치 없음 ' + c.none + '명' + (c.old ? ' · 학생 없음(옛 번호) ' + c.old + '명' : '') + ' · 번호 없음 ' + c.nophone + '명' +
        (c.wait ? ' · 아직 안 받음 ' + c.wait + '명' : '') + '</span>');
    }
    if (s === 'down' || s === 'badkey') parts.push('<span class="mg-ops__bad" id="mgDown" title="' + esc(s === 'badkey' ? '연동 키가 맞지 않아요 — Supabase Secrets 의 MOGO_HUB_KEY 를 확인해 주세요' : '모의고사 분석 레포트 사이트에 연결되지 않아요 — 다른 기능은 그대로입니다') + '">모고 레포트 연결 끊김</span>');
    var v = newer();
    if (v) parts.push('<span class="mg-ops__new" id="mgNewer" title="연동 버전 ' + v + ' (코치룸은 ' + CONTRACT + ' 까지 앎 · 모르는 항목은 무시하고 그대로 동작)">모고 레포트에 새 항목이 생겼어요</span>');
    var np = noPhone();
    if (np.length) parts.push('<details class="mg-ops__np" id="mgNoPhone"><summary>학생 번호가 비어 있는 학생 <b class="num">' + np.length + '</b>명</summary>' +
      '<p class="mg-ops__names">' + esc(np.map(function (x) { return x.name; }).slice(0, 60).join(', ')) + (np.length > 60 ? ' 외 ' + (np.length - 60) + '명' : '') + '</p>' +
      '<p class="mg-ops__hint">학생 → 명단 → <b>번호 한꺼번에 넣기</b>로 학생 본인 번호를 채우면 모의고사 기록을 더 잘 찾아요 (학부모 번호 + 이름으로도 찾습니다)</p></details>');
    var ck = needCheck();
    if (ck.length) parts.push('<details class="mg-ops__ck" id="mgCheck"><summary>모의고사 기록 연결 확인 필요 <b class="num">' + ck.length + '</b>명</summary>' +
      '<ul class="mg-ops__list">' + ck.map(function (x) {
        return '<li><button type="button" class="mg-ops__who" data-mg-who="' + esc(x.s.id) + '">' + esc(x.s.name) + '</button> <small>' + esc(CHECK_WHY[x.r.reason] || '애매해서 연결하지 않았어요') + '</small></li>';
      }).join('') + '</ul>' +
      '<p class="mg-ops__hint">연결하지 않고 두었어요. 학생 번호를 채우거나 같은 이름 · 번호로 두 번 등록된 학생이 없는지 확인해 주세요 (다음 받기 때 다시 찾음)</p></details>');
    return parts.join('');
  }
  function paintOps() {
    var body = document.getElementById('tdBody');
    if (!body || !body.parentNode) return;
    var el = document.getElementById('mgOps');
    if (!el) { el = document.createElement('div'); el.id = 'mgOps'; el.className = 'mg-ops'; body.parentNode.insertBefore(el, body); }
    var open = Array.prototype.map.call(el.querySelectorAll('details[open]'), function (d) { return d.id; });
    el.innerHTML = opsHtml();
    open.forEach(function (id) { var d = id && document.getElementById(id); if (d) d.open = true; });
    el.hidden = !el.innerHTML;
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var b = t.closest('[data-mg-open], [data-mg-url], [data-mg-refresh], [data-mg-who], [data-mg-cls], [data-mg-more]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (b.hasAttribute('data-mg-more')) { var ms = b.getAttribute('data-mg-more'); st.moreOpen[ms] = !st.moreOpen[ms]; paintAll(); }
      else if (b.hasAttribute('data-mg-cls')) refreshClass(b.getAttribute('data-mg-cls'));
      else if (b.hasAttribute('data-mg-who')) { if (window.QuickNote) QuickNote.open(b.getAttribute('data-mg-who')); }
      else if (b.hasAttribute('data-mg-refresh')) refresh(b.getAttribute('data-mg-refresh'));
      else if (b.hasAttribute('data-mg-url')) openUrl(b.getAttribute('data-mg-url'), b.getAttribute('data-mg-title'));
      else openReport(b.getAttribute('data-mg-open'), b.getAttribute('data-mg-title'));
      return;
    }
    if (t.id === 'mgClose') { var m = document.getElementById('mgModal'); if (m && m.open) m.close(); }
  }, true);
  document.addEventListener('close', function (e) { if (e.target && e.target.id === 'mgModal') { var f = document.getElementById('mgFrame'); if (f) f.src = 'about:blank'; } }, true);
  window.addEventListener('jt:loaded', load);
  window.addEventListener('jt:refreshed', load);
  document.addEventListener('jt:tab', function () { setTimeout(paintOps, 0); });
  setInterval(function () { if (!document.hidden && st.sql) load(); }, 10 * 60000);

  window.Mogo = { load: load, mount: mount, sectionHtml: sectionHtml, classHtml: classHtml, refreshClass: refreshClass, linkState: linkState, counts: counts, NONE_WHY: NONE_WHY, openReport: openReport, openUrl: openUrl, refresh: refresh, paintOps: paintOps,
                  state: function () { return st; }, CONTRACT: CONTRACT, ORIGIN: ORIGIN };
})();
