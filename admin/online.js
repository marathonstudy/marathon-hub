/* ============================================================
   online.js — 온라인 반 (20261113b · migration-107)
   · 반 종류 — 현강 / 온라인 · 온라인 반은 수업 시간 · 상담 · 모의고사가 기본으로 꺼짐 · 문자 · 알림톡 · 링크 발송은 켜기 전까지 꺼짐
     (과제 · 학습 분석 · 능력치 · 배지 · 게임 홈은 현강과 같음) — 반 관리 → 반 줄 [반 종류]
   · 앱 반에서 학생 가져오기 — 더보기 맨 위 「📥 온라인 반 가져오기」(20261113f · 예전엔 반 관리 창 맨 아래 · rtabs.js 가 연다)
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

  /* ---------- 앱 반에서 학생 가져오기 ----------
     20261114j — 반 목록 정렬 · 거르기(진행 상태 · 학년 · 종류 · 연도 · 가져온 반 · 테스트 반 · 학생 n명 이상 · 검색) · 카드 / 표 · 기기에 기억
               여러 반 체크 → [선택한 반 미리보기] → 반마다 새로 추가 · 이미 있음 · 겹침 의심 · 현강 학생 수 · 「현강 반에 연결」 / 온라인 반 → [모두 가져오기] 한 번
               반마다 기록 받기 진행(online_progress · migration-114) */
  var S = { step: 'list', classes: null, pick: null, roster: null, preview: null, target: '', busy: false, err: '', done: null, sel: {}, many: null, prog: null, have: { ids: {}, names: {} } };
  var impDlg = null;
  function impModal() {
    if (impDlg) return impDlg;
    var d = document.createElement('dialog');
    d.className = 'modal modal--wide ol-imp';
    d.id = 'olImportModal';
    d.setAttribute('aria-labelledby', 'olImpTitle');
    d.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="olImpTitle">앱 반에서 학생 가져오기</h2>' +
      '<p class="modal__desc">반을 여러 개 체크해 한 번에 미리보기 · 가져오기 할 수 있어요. [가져오기]를 눌러야 실제로 넣어요. 새 반은 온라인 반(발송 꺼짐)으로 만들어요.</p></div>' +
      '<div class="modal__body" id="olImpBody"></div>' +
      '<div class="modal__foot" id="olImpFoot"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', onImpClick);
    d.addEventListener('change', onImpChange);
    d.addEventListener('input', function (e) {
      if (e.target.id === 'olTarget') S.target = e.target.value;
      if (e.target.id === 'olQ') { F.q = e.target.value; fSave(); paintList(true); }
    });
    impDlg = d;
    return d;
  }
  var ST = { new: '새로 추가', linked: '이미 있음 · 반만 더함', same: '이미 이 반', suspect: '겹침 의심 · 넣지 않음' };
  var WHY = { name_phone: '이름 · 번호가 같은 학생', name: '이름이 같은 학생' };
  function md(d) { return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function ymd(d) { return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(0, 4) + '.' + (+d.slice(5, 7)) + '.' + (+d.slice(8, 10)) : ''; }
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

  /* ---------- 반 목록 — 분류 · 정렬 · 거르기 (20261114j) ---------- */
  var GR = [['mid', '중등'], ['g1', '고1'], ['g2', '고2'], ['g3', '고3·N수'], ['etc', '기타']];
  var TY = [['month', '월간 마라톤'], ['weak', '약점 정복'], ['season', '윈터/썸머'], ['trial', '체험'], ['live', '현장'], ['pre', '선수능'], ['etc', '기타']];
  var STS = [['on', '진행 중'], ['soon', '곧 시작'], ['end', '끝남']];
  var SORTS = [['open_desc', '시작일 최신순'], ['open_asc', '시작일 오래된순'], ['close_near', '종료일 가까운순'], ['count_desc', '학생 많은순'], ['count_asc', '학생 적은순'], ['name', '이름 가나다순']];
  function gradeOf(t) {
    t = String(t || '');
    if (/고\s*3|N\s*수|n\s*수|재수|수능 파이널/.test(t)) return 'g3';
    if (/고\s*2/.test(t)) return 'g2';
    if (/고\s*1/.test(t)) return 'g1';
    if (/중등|중\s*[1-3]|중학/.test(t)) return 'mid';
    return 'etc';
  }
  function typeOf(t) {
    t = String(t || '');
    if (/현장/.test(t)) return 'live';
    if (/선수능/.test(t)) return 'pre';
    if (/약점/.test(t)) return 'weak';
    if (/윈터|썸머|겨울|여름|방학/.test(t)) return 'season';
    if (/체험|무료/.test(t)) return 'trial';
    if (/\d{1,2}\s*월.*마라톤|월간/.test(t)) return 'month';
    return 'etc';
  }
  function isTest(t) { return /테스트|test|시험용|연습용|샘플|sample|복사본/i.test(String(t || '')); }
  function metaOf(c) {
    var t = today(), open = /^\d{4}-\d{2}-\d{2}/.test(c.open || '') ? c.open.slice(0, 10) : '', close = /^\d{4}-\d{2}-\d{2}/.test(c.close || '') ? c.close.slice(0, 10) : '';
    var st = c.ended || (close && close < t) ? 'end' : open && open > t ? 'soon' : 'on';
    return { st: st, gr: gradeOf(c.title), ty: typeOf(c.title), yr: open ? open.slice(0, 4) : '', test: isTest(c.title), open: open, close: close, n: +c.count || 0,
             imp: !!(S.have.ids[String(c.id)] || S.have.names[String(c.title || '').replace(/\s+/g, ' ').trim().slice(0, 30)]) };
  }
  var F_KEY = 'mh.ol.list';
  var F0 = function () { return { sort: 'open_desc', st: ['on', 'soon'], gr: [], ty: [], yr: [], hideImp: false, hideTest: true, min: 0, q: '', view: 'card' }; };
  var F = F0();
  function fLoad() { try { var o = JSON.parse(localStorage.getItem(F_KEY) || 'null'); if (o && typeof o === 'object') F = Object.assign(F0(), o, { q: '' }); } catch (e) { F = F0(); } }
  function fSave() { try { localStorage.setItem(F_KEY, JSON.stringify(Object.assign({}, F, { q: '' }))); } catch (e) { /* 기억 못 해도 이번엔 그대로 */ } }
  function filtered() {
    var q = String(F.q || '').trim().toLowerCase();
    var list = (S.classes || []).map(function (c) { return { c: c, m: metaOf(c) }; }).filter(function (x) {
      var m = x.m;
      if (F.st.length && F.st.indexOf(m.st) < 0) return false;
      if (F.gr.length && F.gr.indexOf(m.gr) < 0) return false;
      if (F.ty.length && F.ty.indexOf(m.ty) < 0) return false;
      if (F.yr.length && F.yr.indexOf(m.yr || '-') < 0) return false;
      if (F.hideImp && m.imp) return false;
      if (F.hideTest && m.test) return false;
      if (F.min > 0 && m.n < F.min) return false;
      if (q && String(x.c.title || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      open_desc: function (a, b) { return (b.m.open || '0').localeCompare(a.m.open || '0'); },
      open_asc: function (a, b) { return (a.m.open || '9').localeCompare(b.m.open || '9'); },
      close_near: function (a, b) { var t = today(), ka = a.m.close && a.m.close >= t ? a.m.close : '9' + (a.m.close || ''), kb = b.m.close && b.m.close >= t ? b.m.close : '9' + (b.m.close || ''); return ka.localeCompare(kb); },
      count_desc: function (a, b) { return b.m.n - a.m.n; },
      count_asc: function (a, b) { return a.m.n - b.m.n; },
      name: function (a, b) { return String(a.c.title || '').localeCompare(String(b.c.title || ''), 'ko'); },
      name_desc: function (a, b) { return String(b.c.title || '').localeCompare(String(a.c.title || ''), 'ko'); },
      st: function (a, b) { return ['on', 'soon', 'end'].indexOf(a.m.st) - ['on', 'soon', 'end'].indexOf(b.m.st); }
    };
    var f = by[F.sort] || by.open_desc;
    return list.sort(function (a, b) { return f(a, b) || String(a.c.title || '').localeCompare(String(b.c.title || ''), 'ko'); });
  }
  function chip(group, key, label, on) { return '<button type="button" class="ol-chip' + (on ? ' is-on' : '') + '" data-ol-chip="' + group + '|' + esc(key) + '" aria-pressed="' + on + '">' + esc(label) + '</button>'; }
  function filtersHtml() {
    var years = {}; (S.classes || []).forEach(function (c) { var m = metaOf(c); years[m.yr || '-'] = 1; });
    var yl = Object.keys(years).sort().reverse();
    return '<div class="ol-flt">' +
      '<div class="ol-flt__top"><input class="input ol-q" id="olQ" type="search" placeholder="반 이름 검색" aria-label="반 이름 검색" value="' + esc(F.q) + '">' +
        '<select class="input ol-sort" id="olSort" aria-label="정렬">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (F.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' +
        '<div class="ol-view" role="group" aria-label="보기">' + [['card', '카드'], ['table', '표']].map(function (v) { return '<button type="button" class="ol-chip' + (F.view === v[0] ? ' is-on' : '') + '" data-ol-view="' + v[0] + '" aria-pressed="' + (F.view === v[0]) + '">' + v[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="ol-chips" role="group" aria-label="진행 상태"><span class="ol-chips__l">상태</span>' + chip('st', '*', '전체', !F.st.length) + STS.map(function (s) { return chip('st', s[0], s[1], F.st.indexOf(s[0]) >= 0); }).join('') + '</div>' +
      '<div class="ol-chips" role="group" aria-label="학년"><span class="ol-chips__l">학년</span>' + GR.map(function (s) { return chip('gr', s[0], s[1], F.gr.indexOf(s[0]) >= 0); }).join('') + '</div>' +
      '<div class="ol-chips" role="group" aria-label="종류"><span class="ol-chips__l">종류</span>' + TY.map(function (s) { return chip('ty', s[0], s[1], F.ty.indexOf(s[0]) >= 0); }).join('') + '</div>' +
      '<div class="ol-chips" role="group" aria-label="연도"><span class="ol-chips__l">연도</span>' + yl.map(function (y) { return chip('yr', y, y === '-' ? '날짜 없음' : y + '년', F.yr.indexOf(y) >= 0); }).join('') + '</div>' +
      '<div class="ol-flt__chk"><label class="chk-inline"><input type="checkbox" data-ol-f="hideImp"' + (F.hideImp ? ' checked' : '') + '> 가져온 반 숨기기</label>' +
        '<label class="chk-inline"><input type="checkbox" data-ol-f="hideTest"' + (F.hideTest ? ' checked' : '') + '> 테스트 반 숨기기</label>' +
        '<label class="chk-inline">학생 <input class="input input--num ol-min" type="number" min="0" max="999" data-ol-f="min" value="' + (+F.min || 0) + '" aria-label="학생 수 이상"> 명 이상</label></div>' +
    '</div>';
  }
  var STL = { on: '진행 중', soon: '곧 시작', end: '끝남' };
  function rowsHtml(list) {
    if (!list.length) return '<p class="panel__hint">조건에 맞는 반이 없어요. [조건 초기화]를 눌러 보세요.</p>';
    if (F.view === 'table') {
      var th = function (k1, k2, label) { var on = F.sort === k1 || F.sort === k2; return '<th><button type="button" class="ol-th' + (on ? ' is-on' : '') + '" data-ol-th="' + k1 + '|' + k2 + '">' + label + (on ? (F.sort === k1 ? ' ▼' : ' ▲') : '') + '</button></th>'; };
      return '<div class="ol-tblw"><table class="ol-ctbl"><thead><tr><th class="ol-ck"><span class="sr-only">선택</span></th>' + th('name', 'name_desc', '반 이름') + th('open_desc', 'open_asc', '기간') + th('count_desc', 'count_asc', '학생 수') + th('st', 'st', '상태') + '<th>가져옴</th></tr></thead><tbody>' +
        list.map(function (x) {
          var c = x.c, m = x.m;
          return '<tr class="' + (m.st === 'end' ? 'is-ended' : '') + '"><td class="ol-ck"><input type="checkbox" data-ol-sel="' + esc(c.id) + '"' + (S.sel[c.id] ? ' checked' : '') + ' aria-label="' + esc(c.title) + ' 선택"></td>' +
            '<td><button type="button" class="ol-link" data-ol-pick="' + esc(c.id) + '">' + esc(c.title) + '</button></td><td class="num">' + esc(m.open || m.close ? ymd(m.open) + '~' + ymd(m.close) : '') + '</td>' +
            '<td class="num">' + (m.n ? m.n + '명' : '') + '</td><td>' + STL[m.st] + '</td><td>' + (m.imp ? '✓' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<ul class="ol-cls">' + list.map(function (x) {
      var c = x.c, m = x.m;
      return '<li class="ol-cls__i' + (S.sel[c.id] ? ' is-sel' : '') + (m.st === 'end' ? ' is-ended' : '') + '"><label class="ol-cls__ck"><input type="checkbox" data-ol-sel="' + esc(c.id) + '"' + (S.sel[c.id] ? ' checked' : '') + ' aria-label="' + esc(c.title) + ' 선택"></label>' +
        '<button type="button" class="ol-cls__b' + (m.st === 'end' ? ' is-ended' : '') + '" data-ol-pick="' + esc(c.id) + '"><b>' + esc(c.title) + '</b> <span class="muted-note num">' +
        esc([STL[m.st], m.open || m.close ? ymd(m.open) + '~' + ymd(m.close) : '', m.n ? m.n + '명' : ''].filter(Boolean).join(' · ')) + '</span>' + (m.imp ? ' <span class="ol-imp-badge">✓ 가져옴</span>' : '') + '</button></li>';
    }).join('') + '</ul>';
  }
  function progHtml() {
    var p = (S.prog || []).filter(function (x) { return x.linked > 0; });
    if (!p.length) return '';
    var wait = p.reduce(function (s, x) { return s + (+x.wait || 0); }, 0);
    return '<details class="ol-prog"' + (wait ? ' open' : '') + '><summary><b>기록 받기 진행</b> <span class="muted-note">' + (wait ? '받는 중 ' + wait + '명' : '모두 받음') + ' · 옛 기록 2026-01부터 · 종강 반 → 현강 → 온라인 순서</span></summary>' +
      '<ul class="ol-prog__l">' + p.map(function (x) {
        return '<li><span class="ol-prog__n">' + esc(x.class) + (x.kind === 'online' ? '' : ' <span class="muted-note">현강</span>') + '</span>' +
          '<span class="ol-prog__t">기록 받는 중 <b class="num">' + (+x.wait) + '</b>명 / 다 받음 <b class="num">' + (+x.done) + '</b>명 · <b class="num">' + (+x.pct) + '%</b>' + (x.eta ? ' · 예상 완료 ' + esc(x.eta.slice(5).replace('-', '/')) : '') + (+x.fail ? ' · <span class="ol-sus">다시 시도 ' + (+x.fail) + '명</span>' : '') + '</span>' +
          '<span class="ol-bar" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, +x.pct)) + '%"></i></span></li>';
      }).join('') + '</ul></details>';
  }
  function selIds() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); }
  function paintList(keepTop) {
    if (S.step !== 'list' || !impDlg) return;
    var host = impDlg.querySelector('[data-ol-list]');
    if (!host || !keepTop) { paintImp(); return; }
    var list = filtered();
    host.innerHTML = '<p class="ol-cnt" role="status">조건에 맞는 반 <b class="num">' + list.length + '</b>개 <button type="button" class="btn btn--sm btn--ghost" data-ol-reset>조건 초기화</button></p>' + rowsHtml(list);
    var flt = impDlg.querySelector('[data-ol-flt]'); if (flt && !keepTop) flt.innerHTML = filtersHtml();
    paintFoot();
  }
  function paintFoot() {
    var f = impDlg.querySelector('#olImpFoot'), n = selIds().length, foot = '';
    if (S.step === 'preview' || S.step === 'many') foot = '<button class="btn" type="button" data-ol-back>앱 반 다시 고르기</button>';
    var retry = S.err && S.errD && window.AppErr ? AppErr.retryHtml('data-ol-retry', S.errD) : '';
    f.innerHTML = foot + '<div class="spacer"></div><button class="btn" type="button" data-ol-close>닫기</button>' + retry +
      (S.step === 'list' && S.classes ? '<button class="btn btn--primary" type="button" data-ol-many' + (n ? '' : ' disabled') + '>선택한 반 미리보기 (' + n + ')</button>' : '') +
      (S.step === 'preview' ? '<button class="btn btn--primary" type="button" data-ol-go' + (S.step === 'preview' && !S.busy && S.preview && ((+S.preview.new) + (+S.preview.have)) > 0 ? '' : ' disabled') + '>가져오기</button>' : '') +
      (S.step === 'many' ? '<button class="btn btn--primary" type="button" data-ol-gomany' + (!S.busy && S.many && S.many.items && S.many.items.length ? '' : ' disabled') + '>모두 가져오기</button>' : '');
  }
  function manyHtml() {
    var M = S.many || {};
    if (S.busy) return '<p class="panel__hint" role="status">' + esc(M.msg || '미리보기 만드는 중…') + '</p>';
    var items = M.items || [];
    var sus = items.reduce(function (s, x) { return s + (+x.suspect || 0); }, 0);
    var h = '<p class="ol-sum" role="status">반 <b>' + items.length + '</b>개 · 새 학생 <b>' + (+M.new_uniq || 0) + '</b>명' + (+M.new_dup ? ' <span class="muted-note">(여러 반에 겹친 ' + (+M.new_dup) + '명은 학생 하나 · 반만 여러 개)</span>' : '') +
      ' · <b class="ol-sus">겹침 의심 ' + sus + '명</b> <span class="muted-note">→ 넣지 않고 「앱 연결 필요」 목록으로</span></p>';
    (M.fails || []).forEach(function (f) { h += '<p class="cs-err" role="alert">‘' + esc(f.title) + '’ 명단을 받지 못했어요 — ' + esc(f.why) + ' (이 반은 빼고 가져와요)</p>'; });
    h += '<div class="ol-many">' + items.map(function (x) {
      var link = x.mode === 'link';
      return '<article class="ol-mi' + (link ? ' is-link' : '') + '"><div class="ol-mi__h"><b>' + esc(x.title) + '</b>' +
        (link ? '<span class="ol-mode ol-mode--link">🔗 현강 반에 연결 · ' + esc(x.live_class) + '</span>' : '<span class="ol-mode">🌐 온라인 반 ' + (x.exists ? '「' + esc(x.target) + '」에 더함' : '새로 만듦') + ' · 발송 꺼짐</span>') + '</div>' +
        '<p class="ol-mi__n num">' + (link
          ? '현강 학생 <b>' + (+x.live) + '</b> / ' + (+x.total) + '명 · 새 반 · 새 학생을 만들지 않고 앱 반 연결만(현강 반 · 발송 설정 그대로)' + (+x.new ? ' · 앱에만 있는 ' + (+x.new) + '명은 넣지 않음' : '')
          : '새로 추가 <b>' + (+x.new) + '</b>명 · 이미 있음 ' + (+x.have) + '명' + (+x.same ? ' · 이미 이 반 ' + (+x.same) + '명' : '') + ' · 현강 학생 ' + (+x.live) + '명') +
          (+x.suspect ? ' · <b class="ol-sus">겹침 의심 ' + (+x.suspect) + '명</b>' : '') + '</p>' +
        '<details class="ol-mi__d"><summary>학생 ' + (x.rows || []).length + '명 보기</summary><table class="roster ol-tbl"><thead><tr><th>앱 학생</th><th>학년</th><th>어떻게</th><th>코치룸</th></tr></thead><tbody>' +
          (x.rows || []).map(function (r) {
            return '<tr class="ol-' + esc(r.status) + '"><td>' + esc(r.name) + ' <span class="muted-note num">#' + esc(r.uid) + '</span></td><td>' + esc(r.grade || '') + '</td>' +
              '<td>' + esc(link && r.status === 'new' ? '넣지 않음(현강 반 연결)' : ST[r.status] || r.status) + (r.why ? ' <span class="muted-note">(' + esc(WHY[r.why] || r.why) + ')</span>' : '') + '</td>' +
              '<td>' + (r.student ? esc(r.student.name) + ' <span class="muted-note">' + esc(r.student.class || '') + '</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></details></article>';
    }).join('') + '</div>';
    return h;
  }
  function paintImp() {
    var b = impDlg.querySelector('#olImpBody'), h = '';
    if (S.err === 'noapi') {
      h = '<div class="ol-need" role="status"><b>앱 업데이트 필요</b><p>앱이 반 목록 · 반 명단 주소에 데이터(JSON) 대신 화면(html)을 돌려줬어요' + (S.errD && S.errD.path ? ' (' + esc(S.errD.path) + ')' : '') + '. 앱에 주소가 없거나 게시 전이에요.</p><p class="muted-note">아무것도 넣지 않았어요.</p></div>';
    } else if (S.err) {
      h = '<p class="cs-err" role="alert">' + esc(S.err) + '</p><p class="muted-note">아무것도 넣지 않았어요.</p>';
    } else if (S.busy && !S.classes) {
      h = '<p class="panel__hint">앱에서 반 목록을 받는 중…</p>';
    } else if (S.step === 'list') {
      var list = filtered();
      h = progHtml() + (S.classes && S.classes.length ? '<div data-ol-flt>' + filtersHtml() + '</div><div data-ol-list><p class="ol-cnt" role="status">조건에 맞는 반 <b class="num">' + list.length + '</b>개 <button type="button" class="btn btn--sm btn--ghost" data-ol-reset>조건 초기화</button></p>' + rowsHtml(list) + '</div>'
        : '<p class="panel__hint">앱에 반이 없어요.</p>');
    } else if (S.step === 'many') {
      h = manyHtml();
    } else if (S.step === 'preview') {
      var p = S.preview || { rows: [] }, rows = p.rows || [];
      h = '<div class="ol-tgt"><label class="field__label" for="olTarget">넣을 코치룸 반</label><input class="input" id="olTarget" maxlength="30" value="' + esc(S.target) + '">' +
          '<p class="field__hint">없는 반 이름이면 온라인 반으로 새로 만들어요(수업 시간 · 상담 · 모의고사 · 발송 꺼짐).</p></div>' +
        (S.busy ? '<p class="panel__hint">미리보기 만드는 중…</p>' :
        '<p class="ol-sum" role="status"><b>새로 추가 ' + (+p.new) + '명</b> · 이미 있음 ' + (+p.have) + '명 · <b class="ol-sus">겹침 의심 ' + (+p.suspect) + '명</b></p>' +
        '<table class="roster ol-tbl"><thead><tr><th>앱 학생</th><th>학년</th><th>어떻게</th><th>코치룸</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="ol-' + esc(r.status) + '"><td>' + esc(r.name) + ' <span class="muted-note num">#' + esc(r.uid) + '</span></td><td>' + esc(r.grade || '') + '</td>' +
            '<td>' + esc(ST[r.status] || r.status) + (r.why ? ' <span class="muted-note">(' + esc(WHY[r.why] || r.why) + ')</span>' : '') + '</td>' +
            '<td>' + (r.student ? esc(r.student.name) + ' <span class="muted-note">' + esc(r.student.class || '') + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (+p.suspect ? '<p class="field__hint">겹침 의심 학생은 넣지 않아요. 같은 학생이면 학생 카드 「앱 연결」에서 앱 학생 번호(#)로 연결한 뒤 다시 가져오면 반만 더해져요.</p>' : ''));
    } else if (S.step === 'done') {
      var d = S.done || {};
      if (d.items) {
        h = '<p class="ol-sum" role="status">반 ' + d.items.length + '개를 가져왔어요.</p><ul class="ol-done">' + d.items.map(function (x) {
          return '<li><b>' + esc(x.title || x.class) + '</b> — ' + (x.mode === 'link' ? '🔗 현강 반 「' + esc(x['class']) + '」에 연결 · 새 학생 없음' + (+x.left_new ? ' (앱에만 있는 ' + (+x.left_new) + '명은 넣지 않음)' : '')
            : '🌐 「' + esc(x['class']) + '」 새로 추가 ' + (+x.created) + '명 · 반만 더함 ' + (+x.added) + '명') + (+x.skipped ? ' · 겹침 의심 ' + (+x.skipped) + '명 → 앱 연결 필요' : '') + '</li>';
        }).join('') + '</ul><p class="field__hint">가져온 학생은 앱 학생 번호로 연결돼 다음 동기화부터 기록을 받고, 옛 기록(2026-01부터)도 차례로 받아요. 온라인 반은 발송이 꺼져 있어요.</p>' + progHtml();
      } else {
        h = '<p class="ol-sum" role="status">‘' + esc(S.target) + '’ — 새로 추가 ' + (+d.created) + '명 · 반만 더함 ' + (+d.added) + '명 · 겹침 의심 건너뜀 ' + (+d.skipped) + '명' + (+d.same ? ' · 이미 이 반 ' + (+d.same) + '명' : '') + '</p>' +
          '<p class="field__hint">새 학생은 다음 동기화(5분 안)부터 앱 기록을 받아요. 이 반은 발송이 꺼져 있어요 — 켜려면 반 관리 → [반 종류].</p>';
      }
    }
    b.innerHTML = h;
    paintFoot();
  }
  /* 함수 오류(옛 버전 400 · 없음 404 · 로그인 · 네트워크)까지 이유를 살린다 — 예전에는 모두 「upstream」 (admin/app-err.js · 20261113h) */
  function invoke(body) {
    if (window.AppErr) return AppErr.call(body);
    var c = sb();
    if (!c || !c.functions || !c.functions.invoke) return Promise.resolve({ ok: false, reason: 'noclient' });
    return Promise.resolve(c.functions.invoke('app-sync', { body: body })).then(function (r) { return (r && r.data) || { ok: false, reason: 'upstream' }; }, function () { return { ok: false, reason: 'upstream' }; });
  }
  function why(d) {
    S.errD = d || null;
    if (d && d.reason === 'noapi') return 'noapi';
    return window.AppErr ? AppErr.text(d) : (d && d.message) || '앱에서 받지 못했어요.';
  }
  /* 코치룸 반 — 이미 가져온 반(앱 반 id · 같은 이름) */
  function loadHave() {
    var c = sb();
    return Promise.resolve(c.from('classes').select('name,app_class_id,archived')).then(function (r) {
      var h = { ids: {}, names: {} };
      ((r && r.data) || []).forEach(function (x) { if (x.archived) return; h.names[x.name] = 1; if (x.app_class_id != null) h.ids[String(x.app_class_id)] = 1; });
      S.have = h;
    }, function () {});
  }
  function loadProg() {
    var c = sb();
    return Promise.resolve(c.rpc('online_progress')).then(function (r) { S.prog = r && !r.error && Array.isArray(r.data) ? r.data : null; }, function () { S.prog = null; });
  }
  function openImport() {
    var d = impModal();
    fLoad();
    S = { step: 'list', classes: null, pick: null, roster: null, preview: null, target: '', busy: true, err: '', errD: null, done: null, sel: {}, many: null, prog: null, have: { ids: {}, names: {} } };
    paintImp();
    Layer.show(d);
    Promise.all([invoke({ action: 'app_classes' }), loadHave(), loadProg()]).then(function (x) {
      var r = x[0];
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
    var cl = (S.classes || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!cl) return;
    S.pick = cl; S.step = 'preview'; S.busy = true; S.preview = null; S.err = ''; S.errD = null;
    S.target = (cl.title || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    paintImp();
    invoke({ action: 'app_roster', classId: cl.id }).then(function (r) {
      if (!r.ok) { S.busy = false; S.err = why(r); paintImp(); return; }
      S.roster = r.students || [];
      previewNow();
    });
  }
  /* 여러 반 — 명단을 반마다 차례로 받고(앱 부담 · 함수가 분당 한도를 지킴) 한 번에 미리보기 */
  function previewMany() {
    var ids = selIds(), cls = (S.classes || []).filter(function (c) { return ids.indexOf(String(c.id)) >= 0; });
    if (!cls.length) return;
    S.step = 'many'; S.busy = true; S.err = ''; S.errD = null;
    S.many = { items: [], fails: [], src: [], msg: '명단 받는 중 0 / ' + cls.length };
    paintImp();
    var i = 0;
    (function next() {
      if (i >= cls.length) return manyPreview();
      var c = cls[i++];
      S.many.msg = '명단 받는 중 ' + i + ' / ' + cls.length + ' — ' + c.title;
      paintImp();
      invoke({ action: 'app_roster', classId: c.id }).then(function (r) {
        if (!r.ok) S.many.fails.push({ title: c.title, why: window.AppErr ? AppErr.text(r) : (r && r.reason) || '오류' });
        else S.many.src.push({ key: String(c.id), title: c.title, target: String(c.title || '').replace(/\s+/g, ' ').trim().slice(0, 30), app_class: String(c.id), rows: r.students || [] });
        next();
      });
    })();
  }
  function manyPreview() {
    S.many.msg = '미리보기 만드는 중…'; paintImp();
    if (!S.many.src.length) { S.busy = false; S.err = '고른 반의 명단을 하나도 받지 못했어요.'; paintImp(); return; }
    Promise.resolve(sb().rpc('app_roster_preview_many', { p_items: S.many.src })).then(function (r) {
      S.busy = false;
      if (r.error) { S.err = missing(r.error.message) ? 'migration-114 SQL 을 먼저 실행해 주세요.' : r.error.message; paintImp(); return; }
      S.many.items = (r.data && r.data.items) || [];
      S.many.new_uniq = r.data && r.data.new_uniq; S.many.new_dup = r.data && r.data.new_dup;
      paintImp();
    });
  }
  function goMany() {
    var M = S.many || {}, items = M.items || [];
    if (!items.length) return;
    var link = items.filter(function (x) { return x.mode === 'link'; }).length;
    UI.confirmAsk('여러 반 한 번에 가져오기', '반 ' + items.length + '개를 가져와요 — 새 학생 ' + (+M.new_uniq || 0) + '명' + (link ? ' · 현강 반에 연결 ' + link + '개' : '') + '. 겹침 의심은 넣지 않고 「앱 연결 필요」로 보내요.', '모두 가져오기').then(function (ok) {
      if (!ok) return;
      S.busy = true; S.many.msg = '가져오는 중…'; paintImp();
      return Promise.resolve(sb().rpc('app_roster_import_many', { p_items: M.src })).then(function (r) {
        S.busy = false;
        if (r.error) { S.err = missing(r.error.message) ? 'migration-114 SQL 을 먼저 실행해 주세요.' : r.error.message; paintImp(); return; }
        S.done = r.data; S.step = 'done'; S.sel = {};
        loadProg().then(paintImp);
        paintImp();
        toast('반 ' + ((r.data && r.data.items) || []).length + '개를 가져왔어요', 'good');
        load();
        if (window.Store && Store.refreshAll) Store.refreshAll().catch(function () {}).then(function () { window.dispatchEvent(new CustomEvent('jt:roster-changed')); });
      });
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
    var ch = t.closest('[data-ol-chip]');
    if (ch) {
      var v = ch.getAttribute('data-ol-chip').split('|'), g = v[0], k = v[1];
      if (g === 'st' && k === '*') F.st = [];
      else { var arr = F[g], i = arr.indexOf(k); if (i >= 0) arr.splice(i, 1); else arr.push(k); }
      fSave(); paintImp(); return;
    }
    var vw = t.closest('[data-ol-view]'); if (vw) { F.view = vw.getAttribute('data-ol-view'); fSave(); paintImp(); return; }
    var th = t.closest('[data-ol-th]'); if (th) { var ks = th.getAttribute('data-ol-th').split('|'); F.sort = F.sort === ks[0] ? ks[1] : ks[0]; fSave(); paintImp(); return; }
    if (t.closest('[data-ol-reset]')) { F = Object.assign(F0(), { view: F.view }); fSave(); paintImp(); return; }
    if (t.closest('[data-ol-many]')) { previewMany(); return; }
    if (t.closest('[data-ol-gomany]')) { goMany(); return; }
    var pk = t.closest('[data-ol-pick]');
    if (pk) { pick(pk.getAttribute('data-ol-pick')); return; }
    var rt = t.closest('[data-ol-retry]');
    if (rt && !rt.disabled) { if (S.step === 'preview' && S.pick) pick(S.pick.id); else openImport(); return; }
    if (t.closest('[data-ol-back]')) { S.step = 'list'; S.preview = null; S.many = null; S.err = ''; paintImp(); return; }
    if (t.closest('[data-ol-go]')) go();
  }
  function onImpChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-ol-sel')) { S.sel[t.getAttribute('data-ol-sel')] = t.checked; var li = t.closest('.ol-cls__i'); if (li) li.classList.toggle('is-sel', t.checked); paintFoot(); return; }
    if (t.id === 'olSort') { F.sort = t.value; fSave(); paintImp(); return; }
    var fk = t.getAttribute && t.getAttribute('data-ol-f');
    if (fk) { F[fk] = fk === 'min' ? Math.max(0, Math.min(999, +t.value || 0)) : t.checked; fSave(); paintImp(); }
  }
  /* 넣을 반 이름을 바꾸면 미리보기를 다시 (이미 이 반 / 반만 더함이 바뀜) */
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'olTarget' && S.step === 'preview' && S.roster) { S.target = e.target.value.trim(); previewNow(); } });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#btnOnlineImport')) openImport();       /* 옛 버튼 자리(지금은 없음) — 더보기 메뉴는 rtabs.js */
  });
  window.addEventListener('jt:loaded', function () { load(); });
  window.addEventListener('jt:roster-changed', function () { load(); });

  window.OnlineClass = { load: load, opts: opts, off: off, isOnline: isOnline, kindHtml: kindHtml, openKind: openKind, openImport: openImport, state: function () { return S; } };
})();
