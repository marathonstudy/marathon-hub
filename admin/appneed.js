/* ============================================================
   appneed.js — 「앱 연결 필요」 목록 (20261111a · migration-104)

   학생 → 명단 위 [앱 연결 필요 n명] → 창 하나에 앱 학생 id 가 아직 없는 재원 학생과 못 찾은 이유
     이유 — 번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음 · 후보 여러 명 (앱 응답만으로 확실하지 않으면 「짐작」)
     그 자리에서 학생 · 학부모 번호를 고치면(학생 정보 저장과 같은 길 · Store) 다음 동기화(5분마다) 때 다시 찾는다(DB 트리거)
     후보가 있으면 [#번호로 연결] (app_link_set) · [지금 다시 찾기] (app-sync link)
   번호 · 후보는 코치룸(직원)에서만 — app_link_need_list 는 직원만 · 러닝노트(학생 · 학부모 화면)에는 이 목록 · 이유 · 번호가 나가지 않는다
   학생 카드 「앱 연결 필요」 칸도 같은 이유 글을 쓴다 (AppNeed.whyHtml)
   ============================================================ */
(function () {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { if (window.UI && UI.toast) UI.toast(m, k); }

  var WHY = {
    no_phone: ['번호 없음', '학생 · 학부모 번호가 없어 앱에 물어보지 못했어요'],
    phone_mismatch: ['번호 불일치', '앱에 같은 이름은 있는데 번호가 달라요'],
    name_mismatch: ['이름 불일치', '번호는 앱에 있는데 이름이 달라요'],
    no_account: ['앱 계정 없음', '이름 + 번호로 앱 학생을 찾지 못했어요'],
    many: ['후보 여러 명', '같은 이름 · 번호의 앱 학생이 여럿이에요 · 맞는 번호를 골라 주세요']
  };
  var ORDER = ['no_phone', 'phone_mismatch', 'name_mismatch', 'no_account', 'many'];
  var GUESS_T = '앱 응답만으로는 확실하지 않아 가장 가까운 이유로 적었어요';
  /* 이유 한 줄 — { state, why, guess, note } */
  function whyOf(i) {
    if (!i) return null;
    if (i.state === 'retry') return { k: 'retry', label: '다시 찾는 중', desc: '번호를 고쳤어요 · 다음 동기화(5분 안)에 다시 찾아요', guess: false };
    var w = WHY[i.why];
    if (!w) return i.state === 'many' ? { k: 'many', label: WHY.many[0], desc: WHY.many[1], guess: false }
      : i.state === 'need' ? { k: 'no_account', label: WHY.no_account[0], desc: WHY.no_account[1], guess: true } : { k: 'notyet', label: '아직 찾기 전', desc: '다음 동기화 때 찾아요', guess: false };
    return { k: i.why, label: w[0], desc: i.note === 'taken' ? '나온 앱 학생이 이미 다른 학생에 연결돼 있어요' : w[1], guess: !!i.guess };
  }
  function whyHtml(i) {
    var w = whyOf(i);
    if (!w) return '';
    return '<span class="an-why an-why--' + esc(w.k) + '">' + esc(w.label) + '</span>' +
      (w.guess ? ' <span class="an-why__g" title="' + esc(GUESS_T) + '">짐작</span>' : '') + ' <span class="an-why__d">' + esc(w.desc) + '</span>';
  }

  var S = { list: null, busy: false, msg: {}, open: false };
  function modal() { return document.getElementById('appNeedModal'); }
  function btn() { return document.getElementById('btnAppNeed'); }
  function stu(id) { return ((window.Store && Store.getStudents && Store.getStudents()) || []).find(function (s) { return s.id === id; }) || null; }

  function load() {
    var c = sb();
    if (!c || S.busy) return Promise.resolve(null);
    S.busy = true;
    return Promise.resolve(c.rpc('app_link_need_list')).then(function (r) {
      S.busy = false;
      S.list = r && !r.error && Array.isArray(r.data) ? r.data : null;       /* 104 전 · 권한 없음 — 버튼을 숨긴다 */
      paintBtn(); paint();
      return S.list;
    }, function () { S.busy = false; S.list = null; paintBtn(); });
  }
  function paintBtn() {
    var b = btn();
    if (!b) return;
    var n = S.list ? S.list.length : 0;
    b.hidden = !S.list || !n;
    b.textContent = '앱 연결 필요 ' + n + '명';
  }
  function counts() {
    var o = {};
    (S.list || []).forEach(function (x) { var w = whyOf(x); o[w.k] = (o[w.k] || 0) + 1; });
    return o;
  }
  function rowHtml(x) {
    var cands = Array.isArray(x.cands) ? x.cands : [], m = S.msg[x.id] || '';
    return '<li class="anl-row" data-anl="' + esc(x.id) + '">' +
      '<div class="anl-h"><b class="anl-n">' + esc(x.name) + '</b><span class="anl-c">' + esc(x.class || '반 없음') + '</span></div>' +
      '<p class="anl-w">' + whyHtml(x) + '</p>' +
      '<div class="anl-f">' +
        '<label class="anl-i"><span>학생 번호</span><input class="input" type="tel" inputmode="numeric" data-anl-ph value="' + esc(x.phone || '') + '" placeholder="01012345678"></label>' +
        '<label class="anl-i"><span>학부모 번호</span><input class="input" type="tel" inputmode="numeric" data-anl-pp value="' + esc(x.parent || '') + '" placeholder="01012345678"></label>' +
        '<button type="button" class="btn btn--sm btn--primary" data-anl-save>번호 저장 · 다시 찾기</button>' +
      '</div>' +
      (cands.length ? '<div class="anl-cands"><span class="anl-cands__t">후보</span>' + cands.map(function (u) { return '<button type="button" class="btn btn--sm" data-anl-pick="' + esc(u) + '">#' + esc(u) + '으로 연결</button>'; }).join('') + '</div>' : '') +
      '<div class="anl-more"><input class="input anl-uid" inputmode="numeric" data-anl-uid placeholder="앱 학생 번호" aria-label="앱 학생 번호 직접 넣기"><button type="button" class="btn btn--sm" data-anl-set>직접 연결</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-anl-find>지금 다시 찾기</button></div>' +
      (m ? '<p class="anl-m" role="status">' + esc(m) + '</p>' : '') + '</li>';
  }
  function paint() {
    var m = modal();
    if (!m || !m.open) return;
    var body = m.querySelector('#appNeedBody');
    if (!body) return;
    if (!S.list) { body.innerHTML = '<p class="panel__hint">' + (S.busy ? '불러오는 중…' : '목록을 불러오지 못했어요 (SQL 104 실행 전이면 이 목록이 없어요)') + '</p>'; return; }
    if (!S.list.length) { body.innerHTML = '<p class="panel__hint">앱 연결이 필요한 학생이 없어요 🎉</p>'; return; }
    var c = counts(), top = body.scrollTop;
    body.innerHTML = '<p class="anl-sum">' + ORDER.concat(['retry', 'notyet']).filter(function (k) { return c[k]; }).map(function (k) {
      var lb = WHY[k] ? WHY[k][0] : k === 'retry' ? '다시 찾는 중' : '아직 찾기 전';
      return '<span class="an-why an-why--' + k + '">' + esc(lb) + ' <b class="num">' + c[k] + '</b></span>';
    }).join(' ') + '</p>' +
      '<p class="panel__hint">번호를 고치면 다음 동기화(5분 안)에 앱에서 다시 찾아요 · 「짐작」은 앱 응답만으로 확실하지 않은 이유예요</p>' +
      '<ul class="anl-list">' + S.list.map(rowHtml).join('') + '</ul>';
    body.scrollTop = top;
  }
  function open() {
    var m = modal();
    if (!m) return;
    if (!m.open) Layer.show(m);
    paint();
    load();
  }
  function setMsg(id, t) { S.msg[id] = t; paint(); }

  /* 번호 고치기 — 학생 정보 저장과 같은 길(Store) · DB 트리거가 다음 동기화 때 다시 찾게 한다 */
  function savePhones(row) {
    var id = row.getAttribute('data-anl'), s = stu(id);
    var ph = digits(row.querySelector('[data-anl-ph]').value), pp = digits(row.querySelector('[data-anl-pp]').value);
    if ([ph, pp].some(function (d) { return d && !/^01\d{8,9}$/.test(d); })) { setMsg(id, '휴대폰 번호는 010으로 시작하는 10~11자리로 적어 주세요'); return; }
    if (!s || !window.Store || !Store.upsertStudent) { setMsg(id, '명단을 아직 못 불러왔어요 · 잠시 뒤에 다시'); return; }
    Store.upsertStudent(Object.assign({}, s, { studentPhone: ph, parentPhone: pp }));
    setMsg(id, '저장하는 중…');
    Promise.resolve(Store.flushNow ? Store.flushNow(Store.KEYS.students) : null).then(function () {
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
      S.msg[id] = '저장했어요 · 다음 동기화(5분 안)에 다시 찾아요';
      load();
    }, function (e) { setMsg(id, '저장하지 못했어요 — ' + ((e && e.message) || '')); });
  }
  function link(id, uid) {
    var c = sb();
    if (!c) return;
    setMsg(id, '연결하는 중…');
    Promise.resolve(c.rpc('app_link_set', { p_student: id, p_user: uid })).then(function (r) {
      var d = r && r.data;
      if (r && !r.error && d && d.ok) { toast('#' + uid + '으로 연결했어요 · 다음 받기 때 앱 기록을 받아요', 'good'); delete S.msg[id]; load(); }
      else setMsg(id, d && d.reason === 'taken' ? '다른 학생이 이미 쓰는 번호예요' : '연결하지 못했어요');
    }, function () { setMsg(id, '연결하지 못했어요'); });
  }
  function findNow(id) {
    var f = sb() && sb().functions;
    if (!f || !f.invoke) return;
    setMsg(id, '앱에서 찾는 중…');
    Promise.resolve(f.invoke('app-sync', { body: { action: 'link', students: [id] } })).then(function (r) {
      var d = r && r.data;
      S.msg[id] = d && d.ok ? (d.linked ? '찾아서 연결했어요' : d.many ? '여럿이 나왔어요 · 골라 주세요' : d.stopped ? '앱이 지금 답하지 않아요 (' + d.stopped + ')' : '이번에도 찾지 못했어요') : (d && d.message) || '찾지 못했어요';
      load();
    }, function () { setMsg(id, '찾지 못했어요'); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#btnAppNeed')) { open(); return; }
    var m = modal();
    if (!m || !m.contains(t)) return;
    if (t.closest('[data-anl-close]')) { m.close(); return; }
    var row = t.closest('[data-anl]');
    if (!row) return;
    var id = row.getAttribute('data-anl');
    if (t.closest('[data-anl-save]')) { savePhones(row); return; }
    var pk = t.closest('[data-anl-pick]');
    if (pk) { link(id, +pk.getAttribute('data-anl-pick')); return; }
    if (t.closest('[data-anl-set]')) { var v = digits(row.querySelector('[data-anl-uid]').value); if (!v) setMsg(id, '앱 학생 번호를 넣어 주세요'); else link(id, +v); return; }
    if (t.closest('[data-anl-find]')) findNow(id);
  });
  /* 명단이 열리면 숫자만 한 번 (직원 로그인 뒤) */
  window.addEventListener('jt:roster-changed', function () { if (S.list) paintBtn(); });
  function boot() { if (sb() && btn()) load(); }
  window.addEventListener('jt:loaded', boot);                 /* 로그인 · 명단을 불러온 뒤 (mogo.js 와 같은 때) */
  window.addEventListener('jt:refreshed', boot);

  window.AppNeed = { whyOf: whyOf, whyHtml: whyHtml, open: open, load: load, WHY: WHY, _state: function () { return S; } };
})();
