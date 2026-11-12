/* ============================================================
   online.js — 온라인 반 (20261113b · migration-107)
   · 반 종류 — 현강 / 온라인 · 온라인 반은 수업 시간 · 상담 · 모의고사가 기본으로 꺼짐 · 문자 · 알림톡 · 링크 발송은 켜기 전까지 꺼짐
     (과제 · 학습 분석 · 능력치 · 배지 · 게임 홈은 현강과 같음) — 반 관리 → 반 줄 [반 종류]
   · 앱 반에서 학생 가져오기 — 반 관리 → [앱 반에서 학생 가져오기]
     앱 반 고르기 → 미리보기(새로 추가 n명 · 이미 있음 n명 · 겹침 의심 n명) → [가져오기]를 눌러야 실제로 넣음
     앱 학생 id 로 바로 연결 · 이미 연결된 학생은 새로 만들지 않고 반만 더함 · 겹침 의심은 넣지 않음(학생 카드에서 직접 연결)
     앱에 반 목록 · 명단 주소가 아직 없으면 「앱 업데이트 필요」만 보이고 아무것도 넣지 않음
   · 번호는 화면에 보이지 않는다(이름 · 학년 · 상태만) · 서버 함수가 직원인지 다시 확인한다
   window.OnlineClass — load() · opts(반 이름) · off(반 이름, 'time' | 'consult' | 'mogo' | 'send') · kindHtml(반 이름) · openKind(반 이름) · openImport()
   ============================================================ */
(function () {
  'use strict';

  function sb() { return window.SB && SB.client; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, k) { if (window.UI && UI.toast) UI.toast(m, k); }
  function missing(msg) { return /Could not find the function|does not exist|schema cache/i.test(msg || ''); }

  /* ---------- 반마다 종류 · 켜고 끄기 (class_kinds · 107 전이면 빈 목록 → 모두 현강처럼) ---------- */
  var K = { by: {}, loaded: false, sql: true };
  function load() {
    var c = sb();
    if (!c || !c.rpc) return Promise.resolve(K.by);
    return Promise.resolve(c.rpc('class_kinds')).then(function (r) {
      var by = {};
      if (r && r.error) { K.sql = !missing(r.error.message); }
      else (r && r.data || []).forEach(function (x) { if (x && x.name) by[x.name] = x; });
      K.by = by; K.loaded = true;
      return by;
    }, function () { return K.by; });
  }
  function opts(name) { return K.by[name] || null; }
  var KEY = { time: 'use_time', consult: 'use_consult', mogo: 'use_mogo', send: 'send_on' };
  function off(name, what) { var o = opts(name); return !!(o && KEY[what] && o[KEY[what]] === false); }
  function isOnline(name) { var o = opts(name); return !!(o && o.kind === 'online'); }
  /* 반 관리 줄의 작은 표시 — 「온라인 · 발송 꺼짐」 */
  function kindHtml(name) {
    var o = opts(name);
    if (!o || o.kind !== 'online') return '';
    return ' <span class="ol-badge" title="온라인 반 — 수업 시간 · 상담 · 모의고사 · 발송을 반 종류에서 켜고 끕니다">온라인' + (o.send_on ? '' : ' · 발송 꺼짐') + (+o.members ? ' · 반만 더한 학생 ' + (+o.members) + '명' : '') + '</span>';
  }

  /* ---------- 반 종류 창 ---------- */
  var kindDlg = null, kindFor = '';
  function kindModal() {
    if (kindDlg) return kindDlg;
    var d = document.createElement('dialog');
    d.className = 'modal';
    d.id = 'olKindModal';
    d.setAttribute('aria-labelledby', 'olKindTitle');
    d.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="olKindTitle">반 종류</h2>' +
      '<p class="modal__desc">온라인 반은 수업 시간 · 상담 · 모의고사가 기본으로 꺼져 있어요. 과제 · 학습 분석 · 능력치 · 배지 · 게임 홈은 현강과 같아요.</p></div>' +
      '<div class="modal__body">' +
        '<div class="ol-kinds" role="radiogroup" aria-label="반 종류">' +
          '<label class="chk-inline"><input type="radio" name="olKind" value=""> 현강</label>' +
          '<label class="chk-inline"><input type="radio" name="olKind" value="online"> 온라인</label></div>' +
        '<fieldset class="ol-opts"><legend class="field__label">켜고 끄기</legend>' +
          '<label class="chk-inline"><input type="checkbox" id="olTime"> 수업 시간 (필기 알림 · 수업 전 예고)</label>' +
          '<label class="chk-inline"><input type="checkbox" id="olConsult"> 상담 (학생 카드 상담 칸)</label>' +
          '<label class="chk-inline"><input type="checkbox" id="olMogo"> 모의고사 (모고 기록 받기 · 학생 카드)</label>' +
          '<label class="chk-inline"><input type="checkbox" id="olSend"> 문자 · 알림톡 · 링크 발송</label></fieldset>' +
        '<p class="field__hint" id="olKindHint"></p><p class="cs-err" id="olKindErr" role="alert"></p></div>' +
      '<div class="modal__foot"><div class="spacer"></div><button class="btn" type="button" data-ol-kind-close>닫기</button>' +
        '<button class="btn btn--primary" type="button" data-ol-kind-save>저장</button></div>';
    document.body.appendChild(d);
    d.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'olKind') {                /* 온라인으로 바꾸면 기본값(모두 끔) · 현강으로 바꾸면 모두 켬 */
        var on = e.target.value !== 'online';
        ['olTime', 'olConsult', 'olMogo', 'olSend'].forEach(function (id) { d.querySelector('#' + id).checked = on; });
      }
      hint();
    });
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-ol-kind-close]')) d.close();
      if (e.target.closest('[data-ol-kind-save]')) saveKind();
    });
    kindDlg = d;
    return d;
  }
  function hint() {
    var d = kindDlg, send = d.querySelector('#olSend').checked, online = (d.querySelector('input[name=olKind]:checked') || {}).value === 'online';
    d.querySelector('#olKindHint').textContent = online && !send ? '발송이 꺼져 있으면 이 반에만 있는 학생에게는 문자 · 알림톡 · 링크가 나가지 않아요(보내기 창에서 「온라인 반 · 발송 꺼짐」으로 빠짐).' : '';
  }
  function openKind(name) {
    var d = kindModal(), o = opts(name) || { kind: '', use_time: true, use_consult: true, use_mogo: true, send_on: true };
    kindFor = name;
    d.querySelector('#olKindTitle').textContent = name + ' · 반 종류';
    Array.prototype.forEach.call(d.querySelectorAll('input[name=olKind]'), function (x) { x.checked = x.value === (o.kind || ''); });
    d.querySelector('#olTime').checked = o.use_time !== false;
    d.querySelector('#olConsult').checked = o.use_consult !== false;
    d.querySelector('#olMogo').checked = o.use_mogo !== false;
    d.querySelector('#olSend').checked = o.send_on !== false;
    d.querySelector('#olKindErr').textContent = K.sql ? '' : 'migration-107 SQL 을 먼저 실행해 주세요.';
    hint();
    Layer.show(d);
  }
  function saveKind() {
    var d = kindDlg, c = sb();
    var kind = (d.querySelector('input[name=olKind]:checked') || {}).value || '';
    var args = { p_class: kindFor, p_kind: kind, p_time: d.querySelector('#olTime').checked, p_consult: d.querySelector('#olConsult').checked,
                 p_mogo: d.querySelector('#olMogo').checked, p_send: d.querySelector('#olSend').checked };
    Promise.resolve(c.rpc('class_kind_set', args)).then(function (r) {
      if (r.error) { d.querySelector('#olKindErr').textContent = missing(r.error.message) ? 'migration-107 SQL 을 먼저 실행해 주세요.' : r.error.message; return; }
      d.close();
      toast(kindFor + ' — ' + (kind === 'online' ? '온라인 반' : '현강 반') + (kind === 'online' && !args.p_send ? ' · 발송 꺼짐' : ''), 'good');
      return load().then(function () { window.dispatchEvent(new CustomEvent('jt:class-kinds')); });
    });
  }

  /* ---------- 앱 반에서 학생 가져오기 ---------- */
  var S = { step: 'list', classes: null, pick: null, roster: null, preview: null, target: '', busy: false, err: '', done: null };
  var impDlg = null;
  function impModal() {
    if (impDlg) return impDlg;
    var d = document.createElement('dialog');
    d.className = 'modal modal--wide';
    d.id = 'olImportModal';
    d.setAttribute('aria-labelledby', 'olImpTitle');
    d.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="olImpTitle">앱 반에서 학생 가져오기</h2>' +
      '<p class="modal__desc">앱 반을 고르면 미리보기가 나와요. [가져오기]를 눌러야 실제로 넣어요. 새 반은 온라인 반(발송 꺼짐)으로 만들어요.</p></div>' +
      '<div class="modal__body" id="olImpBody"></div>' +
      '<div class="modal__foot" id="olImpFoot"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', onImpClick);
    d.addEventListener('input', function (e) { if (e.target.id === 'olTarget') S.target = e.target.value; });
    impDlg = d;
    return d;
  }
  var ST = { new: '새로 추가', linked: '이미 있음 · 반만 더함', same: '이미 이 반', suspect: '겹침 의심 · 넣지 않음' };
  var WHY = { name_phone: '이름 · 번호가 같은 학생', name: '이름이 같은 학생' };
  function md(d) { return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function paintImp() {
    var b = impDlg.querySelector('#olImpBody'), f = impDlg.querySelector('#olImpFoot'), h = '', foot = '';
    if (S.err === 'noapi') {
      h = '<div class="ol-need" role="status"><b>앱 업데이트 필요</b><p>마라톤 앱에 아직 반 목록 · 반 명단을 읽는 주소가 없어요. 원장님이 Replit 에 요청문(.local/replit_합친요청.md)을 넣어 앱을 게시하면 여기서 바로 가져올 수 있어요.</p><p class="muted-note">아무것도 넣지 않았어요.</p></div>';
    } else if (S.err) {
      h = '<p class="cs-err" role="alert">' + esc(S.err) + '</p>';
    } else if (S.busy && !S.classes) {
      h = '<p class="panel__hint">앱에서 반 목록을 받는 중…</p>';
    } else if (S.step === 'list') {
      var list = S.classes || [];
      h = list.length ? '<ul class="ol-cls">' + list.map(function (c) {
        return '<li><button type="button" class="ol-cls__b" data-ol-pick="' + c.id + '"><b>' + esc(c.title) + '</b> <span class="muted-note num">' +
          esc([md(c.open) && md(c.open) + '~' + (md(c.close) || ''), c.count ? c.count + '명' : ''].filter(Boolean).join(' · ')) + '</span></button></li>';
      }).join('') + '</ul>' : '<p class="panel__hint">앱에 반이 없어요.</p>';
    } else if (S.step === 'preview') {
      var p = S.preview || { rows: [] }, rows = p.rows || [];
      h = '<div class="ol-tgt"><label class="field__label" for="olTarget">넣을 코치룸 반</label><input class="input" id="olTarget" maxlength="30" value="' + esc(S.target) + '">' +
          '<p class="field__hint">없는 반 이름이면 온라인 반으로 새로 만들어요(수업 시간 · 상담 · 모의고사 · 발송 꺼짐).</p></div>' +
        (S.busy ? '<p class="panel__hint">미리보기 만드는 중…</p>' :
        '<p class="ol-sum" role="status"><b>새로 추가 ' + (+p.new) + '명</b> · 이미 있음 ' + (+p.have) + '명 · <b class="ol-sus">겹침 의심 ' + (+p.suspect) + '명</b></p>' +
        '<table class="roster tb-table ol-tbl"><thead><tr><th>앱 학생</th><th>학년</th><th>어떻게</th><th>코치룸</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="ol-' + esc(r.status) + '"><td>' + esc(r.name) + ' <span class="muted-note num">#' + esc(r.uid) + '</span></td><td>' + esc(r.grade || '') + '</td>' +
            '<td>' + esc(ST[r.status] || r.status) + (r.why ? ' <span class="muted-note">(' + esc(WHY[r.why] || r.why) + ')</span>' : '') + '</td>' +
            '<td>' + (r.student ? esc(r.student.name) + ' <span class="muted-note">' + esc(r.student.class || '') + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (+p.suspect ? '<p class="field__hint">겹침 의심 학생은 넣지 않아요. 같은 학생이면 학생 카드 「앱 연결」에서 앱 학생 번호(#)로 연결한 뒤 다시 가져오면 반만 더해져요.</p>' : ''));
      foot = '<button class="btn" type="button" data-ol-back>앱 반 다시 고르기</button>';
    } else if (S.step === 'done') {
      var d = S.done || {};
      h = '<p class="ol-sum" role="status">‘' + esc(S.target) + '’ — 새로 추가 ' + (+d.created) + '명 · 반만 더함 ' + (+d.added) + '명 · 겹침 의심 건너뜀 ' + (+d.skipped) + '명' + (+d.same ? ' · 이미 이 반 ' + (+d.same) + '명' : '') + '</p>' +
        '<p class="field__hint">새 학생은 다음 동기화(5분 안)부터 앱 기록을 받아요. 이 반은 발송이 꺼져 있어요 — 켜려면 반 관리 → [반 종류].</p>';
    }
    b.innerHTML = h;
    var canGo = S.step === 'preview' && !S.busy && S.preview && ((+S.preview.new) + (+S.preview.have)) > 0;
    f.innerHTML = foot + '<div class="spacer"></div><button class="btn" type="button" data-ol-close>닫기</button>' +
      (S.step === 'preview' ? '<button class="btn btn--primary" type="button" data-ol-go' + (canGo ? '' : ' disabled') + '>가져오기</button>' : '');
  }
  function invoke(body) {
    var c = sb();
    if (!c || !c.functions || !c.functions.invoke) return Promise.resolve({ ok: false, reason: 'noclient' });
    return Promise.resolve(c.functions.invoke('app-sync', { body: body })).then(function (r) { return (r && r.data) || { ok: false, reason: 'upstream' }; }, function () { return { ok: false, reason: 'upstream' }; });
  }
  function why(d) {
    if (!d) return '앱에서 받지 못했어요.';
    if (d.reason === 'noapi') return 'noapi';
    if (d.reason === 'nokey') return '앱 읽기 열쇠(HUB_READ_KEY)가 아직 없어요.';
    if (d.reason === 'timeout') return '앱이 답하지 않아요(timeout). 잠시 뒤 다시 해 주세요.';
    return (d.message || '앱에서 받지 못했어요') + (d.reason ? ' (' + d.reason + ')' : '');
  }
  function openImport() {
    var d = impModal();
    S = { step: 'list', classes: null, pick: null, roster: null, preview: null, target: '', busy: true, err: '', done: null };
    paintImp();
    Layer.show(d);
    invoke({ action: 'app_classes' }).then(function (r) {
      S.busy = false;
      if (!r.ok) { S.err = why(r); paintImp(); return; }
      S.classes = r.classes || [];
      paintImp();
    });
  }
  function previewNow() {
    S.busy = true; paintImp();
    var c = sb();
    return Promise.resolve(c.rpc('app_roster_preview', { p_class: S.target, p_rows: S.roster })).then(function (r) {
      S.busy = false;
      if (r.error) { S.err = missing(r.error.message) ? 'migration-107 SQL 을 먼저 실행해 주세요.' : r.error.message; paintImp(); return; }
      S.preview = r.data; paintImp();
    });
  }
  function pick(id) {
    var cl = (S.classes || []).filter(function (x) { return x.id === id; })[0];
    if (!cl) return;
    S.pick = cl; S.step = 'preview'; S.busy = true; S.preview = null;
    S.target = (cl.title || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    paintImp();
    invoke({ action: 'app_roster', classId: id }).then(function (r) {
      if (!r.ok) { S.busy = false; S.err = why(r); paintImp(); return; }
      S.roster = r.students || [];
      previewNow();
    });
  }
  function go() {
    var name = (S.target || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 30) { toast('넣을 반 이름을 30자 안으로 적어 주세요', 'bad'); return; }
    S.target = name;
    var p = S.preview || {};
    UI.confirmAsk('앱 반에서 학생 가져오기', '‘' + name + '’ 에 새로 추가 ' + (+p.new) + '명 · 반만 더함 ' + (+p.have) + '명을 넣어요. 겹침 의심 ' + (+p.suspect) + '명은 넣지 않아요.', '가져오기').then(function (ok) {
      if (!ok) return;
      S.busy = true; paintImp();
      return Promise.resolve(sb().rpc('app_roster_import', { p_class: name, p_app_class: S.pick ? S.pick.id : null, p_rows: S.roster })).then(function (r) {
        S.busy = false;
        if (r.error) { S.err = missing(r.error.message) ? 'migration-107 SQL 을 먼저 실행해 주세요.' : r.error.message; paintImp(); return; }
        S.done = r.data; S.step = 'done'; paintImp();
        toast('‘' + name + '’ — 새로 ' + (+r.data.created) + '명 · 반만 더함 ' + (+r.data.added) + '명', 'good');
        load();
        if (window.Store && Store.refreshAll) Store.refreshAll().catch(function () {}).then(function () { window.dispatchEvent(new CustomEvent('jt:roster-changed')); });
      });
    });
  }
  function onImpClick(e) {
    var t = e.target;
    if (t.closest('[data-ol-close]')) { impDlg.close(); return; }
    if (S.busy) return;
    var pk = t.closest('[data-ol-pick]');
    if (pk) { pick(+pk.getAttribute('data-ol-pick')); return; }
    if (t.closest('[data-ol-back]')) { S.step = 'list'; S.preview = null; S.err = ''; paintImp(); return; }
    if (t.closest('[data-ol-go]')) go();
  }
  /* 넣을 반 이름을 바꾸면 미리보기를 다시 (이미 이 반 / 반만 더함이 바뀜) */
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'olTarget' && S.step === 'preview' && S.roster) { S.target = e.target.value.trim(); previewNow(); } });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#btnOnlineImport')) openImport();
  });
  window.addEventListener('jt:loaded', function () { load(); });
  window.addEventListener('jt:roster-changed', function () { load(); });

  window.OnlineClass = { load: load, opts: opts, off: off, isOnline: isOnline, kindHtml: kindHtml, openKind: openKind, openImport: openImport, state: function () { return S; } };
})();
