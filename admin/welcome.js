/* ============================================================
   welcome.js — 「입구 문자 보내기」 · 「신입생 웰컴 + 마라톤 앱 설치 안내」 (20261101e · migration-052 · sms-send)

   입구 문자 — 학생 명단 위 「학생 입구」 줄 [입구 문자 보내기] (예전 「단톡방 안내 문구 복사」 자리)
     · 받는 사람: 반 고르기(전체 / 반 여러 개) + 「아직 한 번도 로그인 안 한 학생만」(기본 켜짐) · 학생 본인 번호로만
     · 글은 「자주 쓰는 문구」의 「입구 안내」(없으면 기본 글) — 이 창에서 바로 고칠 수 있다
   신입생 웰컴 — 「자주 쓰는 문구」의 「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」 (없으면 예전 「앱 안내(기본)」 글로)
     · 한 명 등록: 「웰컴 문자 보내기」(기본 켜짐)면 저장하는 순간 학생 본인 · 학부모 1 · 2 로 바로 (Welcome.sendNow)
     · 엑셀 · CSV: 다 넣은 뒤 「새로 넣은 n명에게 웰컴 문자 보낼까요? [보내기] [나중에]」 (Welcome.askAfterImport)
     · 다시 보내기: 상담 카드 [웰컴·앱 설치 안내 다시 보내기] · 명단 반 이름 옆 [반 전체에 웰컴 안내]
       (받는 사람 학생 / 학부모 / 둘 다 · 반 전체면 「아직 앱 링크 연결 안 된 학생만」 기본 켜짐)
   과제 독려 (20261101g · migration-054) — 「오늘」 반 카드 「과제 평균」 줄 「진행 중」 옆 [안 낸 학생 n명에게 독려 문자] (today.js)
     · 받는 사람 목록(이름 · 지난 수업 이후 밀린 날짜 모두 「10/27(월) 10/28(화) 10/30(목)」 · 체크를 빼면 제외 · 20261101h) · 「학생에게」 기본 켜짐 · 「학부모에게도」 기본 꺼짐
     · 「자주 쓰는 문구」의 「과제 독려(학생)」 · 「과제 독려(학부모)」 · {밀린날짜}는 학생마다 채워서 같은 글끼리 묶어 보낸다 (함수는 그대로)
   공통
     · 칸: {학생이름} {반이름} {첫수업일}(수강 시작일) {앱입장코드}(반 설정 「앱 입장코드」) {러닝노트주소}(학생 입구 /s/)
       — 예전 칸(#{이름} #{반} #{입장코드} #{앱 설치 링크})도 그대로 바뀐다. 실제 글은 서버(sms_prepare)가 똑같이 만든다
     · 퇴원한 학생 · 번호 없는 사람은 빼고 「번호 없음 n명」 · 오늘 같은 종류를 이미 보낸 사람은 「오늘 이미 보냄」으로 빼 둔다
     · 미리보기 1건 → [n명에게 보내기] → 「n명에게 보냅니다」 확인 → 「보냄 n건 · 실패 n건(이름)」
     · 보낸 기록에 「입구 안내」 · 「웰컴 안내」 (목적 entry · welcome) · 상담 카드 「웰컴 안내 보냄 10/30」
     · 길면(90바이트 넘음) 장문(LMS) — 서버가 정한다. 키는 화면에 없다 (sms-send · Solapi Secrets)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var NOCLS = '(반 없음)';
  var CODE_RE = /^[A-Za-z0-9가-힣_-]{2,30}$/;
  var KIND = {
    entry: { title: '입구 문자 보내기', label: '입구 안내', tpl: ['입구 안내'] },
    welcome: { title: '웰컴·앱 설치 안내', label: '웰컴 안내', tpl: ['신입생 웰컴(학생)', '신입생 웰컴(학부모)'] },
    nudge: { title: '과제 독려 문자', label: '과제 독려', tpl: ['과제 독려(학생)', '과제 독려(학부모)'] }
  };
  /* 「이번 주」라고 쓰지 않는다 — 직전 주 날짜도 들어간다 (migration-055 와 같다 · 20261101h) */
  var NUDGE_ST = '[마라톤국어] {학생이름} 학생, 지난 수업 이후 과제 {밀린날짜}이 아직 제출 안 됐어요. 오늘 안에 마라톤 앱에서 제출해 주세요!';
  var NUDGE_PA = '[마라톤국어] {학생이름} 학생의 지난 수업 이후 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.';
  var ENTRY_BODY = '[마라톤국어] {학생이름} 학생, 러닝노트 입구입니다. {러닝노트주소} 반과 이름을 고르고 휴대폰 번호 010 뺀 8자리로 들어오세요. 홈 화면에 추가해 두면 앱처럼 바로 열려요.';
  /* 웰컴 · 입구 기본 글 끝 「홈 화면에 추가해 두면 앱처럼 바로 열려요.」 (20261101k · migration-057 과 같다) */
  /* 웰컴 기본 글 — 예전 「신입생 앱 안내」(sms.js 앱 안내(기본))와 같은 글 · 학부모용은 첫 줄만 바꾼다 (migration-052 와 같다) */
  var WEL_REST = '1) 앱 설치: #{앱 설치 링크}\n2) 앱에서 입장코드 입력: {앱입장코드}\n궁금한 점은 이 번호로 답장 주세요.\n홈 화면에 추가해 두면 앱처럼 바로 열려요.';
  var WEL_ST = '안녕하세요, 마라톤국어입니다. {학생이름} 학생, 마라톤 스터디 앱을 설치하고 입장코드로 들어와 주세요.\n' + WEL_REST;
  var WEL_PA = '안녕하세요, 마라톤국어입니다. {학생이름} 학생의 등록을 환영합니다.\n학생이 아래 순서대로 설치하도록 함께 확인 부탁드립니다.\n' + WEL_REST;
  var TO_LABEL = { student: '학생', parent1: '학부모', parent2: '학부모' };

  var st = null;          /* 지금 열린 창 */
  var ctx = null;         /* 불러온 것 { links, codes, templates, sent, logged, missing } */

  /* ---------- 학생 ---------- */
  function active() { return UI.activeStudents(); }
  function clsOf(s) { return (s.className || '').trim() || NOCLS; }
  function byId(id) { return active().find(function (s) { return s.id === id; }) || null; }
  function classNames() {
    var seen = {};
    active().forEach(function (s) { seen[clsOf(s)] = 1; });
    var names = Object.keys(seen).filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); });
    return window.TodayView && TodayView.orderClasses ? TodayView.orderClasses(names) : names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function sortList(list) {
    var rank = {};
    classNames().forEach(function (n, i) { rank[n] = i; });
    return list.slice().sort(function (a, b) { return ((rank[clsOf(a)] || 0) - (rank[clsOf(b)] || 0)) || (a.name || '').localeCompare(b.name || '', 'ko'); });
  }
  function digits(v) { return Store.phoneDigits(v || ''); }
  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }
  function numberOf(s, t) { return t === 'parent1' ? s.parentPhone : t === 'parent2' ? s.parentPhone2 : s.studentPhone; }

  /* ---------- 칸 ---------- */
  function firstOf(s) {
    var d = Store.startOf(s) || (Store.defaultStartDate ? Store.defaultStartDate(clsOf(s) === NOCLS ? '' : clsOf(s)) : '');
    return d && window.Sms && Sms.kdate ? Sms.kdate(d) : '';
  }
  function codeOf(s) {
    var c = String((st && st.code) || ctx.codes[clsOf(s)] || '').trim();
    return CODE_RE.test(c) ? c : '';
  }
  function entryUrl() { return CONFIG.siteUrl + '/s/'; }
  function needCode(body) { return body.indexOf('{앱입장코드}') !== -1 || body.indexOf('#{입장코드}') !== -1; }
  function needApp(body) { return body.indexOf('#{앱 설치 링크}') !== -1; }
  /* 바뀌지 않은 칸 (20261101m) — 보내기 직전 글에 {밀린날짜} · #{링크} 같은 칸이 남으면 그 사람에게는 보내지 않는다 (sms-send · note-remind 와 같은 규칙) */
  function leftOf(text) { var out = []; (String(text || '').match(/#?\{[^{}\r\n]{1,20}\}/g) || []).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); }); return out; }
  function leftMsg(left) { return '바뀌지 않은 칸이 있어 보내지 않음: ' + left.join(' '); }
  /* 서버 sms_prepare(052) 와 같은 순서 · 같은 글 */
  function fill(body, s) {
    var code = codeOf(s);
    return String(body)
      .split('#{이름}').join(s.name || '').split('#{반}').join((s.className || '').trim())
      .split('#{입장코드}').join(code).split('#{앱 설치 링크}').join(ctx.links || '')
      .split('{학생이름}').join(s.name || '').split('{반이름}').join((s.className || '').trim())
      .split('{첫수업일}').join(firstOf(s)).split('{앱입장코드}').join(code)
      .split('{러닝노트주소}').join(entryUrl())
      .split('{밀린날짜}').join(missOf(s));
  }
  /* {밀린날짜} — 과제 독려 (학생마다 「10/27(화)·10/29(목)」) · 모르면 칸을 그대로 둔다 → 보내지 않음 (20261101m) */
  function missOf(s) { return (st && st.miss && st.miss[s.id]) || '{밀린날짜}'; }
  /* 함수에 넘기는 글 — {밀린날짜}만 여기서 채운다 (나머지 칸은 서버가) */
  function outBody(x) { return bodyFor(x.t).split('{밀린날짜}').join(missOf(x.s)); }
  function bytes(t) { return window.Sms && Sms.bytes ? Sms.bytes(t) : t.length * 2; }

  /* ---------- 불러오기 ---------- */
  function rpc(name, args) {
    return Promise.resolve(sb().rpc(name, args || {})).then(function (r) {
      if (r.error) { if (isMissing(r.error)) return { missing: true }; throw new Error(r.error.message); }
      return { data: r.data };
    });
  }
  function tplBody(title, def) {
    var t = (ctx.templates || []).find(function (x) { return (x.title || '').trim() === title; });
    return t && String(t.body || '').trim() ? t.body : def;
  }
  function load(kind) {
    var base = window.Sms && Sms.prep ? Sms.prep() : Promise.resolve({ links: '', codes: {}, templates: [] });
    return Promise.all([
      base,
      rpc('sms_sent_today', { p_purpose: kind }),
      kind === 'entry' ? rpc('student_logged_ids') : Promise.resolve({ data: [] })
    ]).then(function (a) {
      var sent = {};
      ((a[1].data) || []).forEach(function (x) { sent[x.student_id + '|' + x.target] = x.at; });
      var logged = {};
      ((a[2].data) || []).forEach(function (id) { logged[id] = true; });
      ctx = { links: a[0].links || '', codes: a[0].codes || {}, templates: a[0].templates || [], sent: sent, logged: logged, missing: !!(a[1].missing || a[2].missing), smsMissing: !!a[0].missing };
      return ctx;
    });
  }

  /* ---------- 보낼 줄 ----------
     students × 보낼 곳 → { items, noPhone, noCode, dup, people }
     · 학부모 2 번호가 1 과 같으면 한 번 · 학생 번호가 학부모 번호와 같고 둘 다 보내면 학생 줄은 뺀다 (학부모 글이 간다)
     · 오늘 같은 종류를 이미 보낸 줄은 dup (again 이면 보낸다) */
  function targetsOf(to) { return to === 'none' ? [] : to === 'student' ? ['student'] : to === 'parent' ? ['parent1', 'parent2'] : ['parent1', 'parent2', 'student']; }
  function bodyFor(t) { return t === 'student' ? st.bodySt : st.bodyPa; }
  function plan(list) {
    var out = { items: [], noPhone: [], noCode: [], dup: [], left: [], people: 0 };
    var ts = targetsOf(st.to), okBy = {};
    list.forEach(function (s) {
      if (st.off && st.off[s.id]) return;
      var mine = {}, anyNum = false;
      var pa = [digits(s.parentPhone), digits(s.parentPhone2)];
      var missing = [];
      if (ts.indexOf('parent1') !== -1 && !mobile(pa[0]) && !mobile(pa[1])) missing.push('학부모');
      if (ts.indexOf('student') !== -1 && !mobile(digits(s.studentPhone))) missing.push('학생');
      ts.forEach(function (t) {
        var d = digits(numberOf(s, t));
        if (!mobile(d)) return;
        anyNum = true;
        if (mine[d]) return;
        if (t === 'student' && ts.indexOf('parent1') !== -1 && pa.indexOf(d) !== -1) return;
        mine[d] = 1;
        var body = bodyFor(t);
        if (needCode(body) && !codeOf(s)) { out.noCode.push({ s: s, t: t }); return; }
        var k = s.id + '|' + t;
        if (ctx.sent[k] && !st.again) { out.dup.push({ s: s, t: t, at: ctx.sent[k] }); return; }
        var text = fill(body, s), b = bytes(text);
        var lf = leftOf(text);
        if (lf.length) { out.left.push({ s: s, t: t, left: lf }); return; }     /* 바뀌지 않은 칸 — 보내지 않음 (20261101m) */
        out.items.push({ s: s, t: t, d: d, text: text, bytes: b, kind: b <= 90 ? 'SMS' : 'LMS', again: !!ctx.sent[k] });
        okBy[s.id] = 1;
      });
      if (missing.length) out.noPhone.push({ s: s, what: missing.join(' · '), none: !anyNum });
    });
    out.people = Object.keys(okBy).length;
    out.lms = out.items.filter(function (x) { return x.kind === 'LMS'; }).length;
    return out;
  }
  function chosen() {
    var list;
    if (st.ids) list = st.ids.map(byId).filter(Boolean);
    else {
      var all = !Object.keys(st.classes).length;
      list = active().filter(function (s) { return (all || st.classes[clsOf(s)]) && (clsOf(s) === NOCLS || !Store.isArchivedClass(clsOf(s))); });
    }
    if (st.kind === 'entry' && st.onlyNew) list = list.filter(function (s) { return !ctx.logged[s.id]; });
    if (st.kind === 'welcome' && st.onlyNoApp) list = list.filter(function (s) { return !(Store.linkOf(s.id) || {}).appCode; });
    return sortList(list);
  }

  /* ---------- 보내기 (sms-send) ---------- */
  function sendItems(items) {
    var groups = {}, order = [];
    items.forEach(function (x) {
      var b = outBody(x);
      if (!groups[b]) { groups[b] = []; order.push(b); }
      groups[b].push(x);
    });
    var all = { ok: true, sent: 0, failed: 0, results: [], skipped: [], message: '' };
    return order.reduce(function (p, body) {
      return p.then(function () {
        if (!all.ok) return null;
        var g = groups[body], vars = {};
        g.forEach(function (x) { var v = {}, c = codeOf(x.s), f = firstOf(x.s); if (c) v.code = c; if (f) v.first = f; if (v.code || v.first) vars[x.s.id] = v; });
        return Sms.invoke({
          action: 'send', body: body, items: g.map(function (x) { return { student_id: x.s.id, to: x.t }; }),
          ad: false, lessons: {}, siblings: true, markWeek: '', label: KIND[st.kind].label, purpose: st.kind, vars: vars
        }).then(function (r) {
          if (!r || !r.ok) { all.ok = all.sent > 0; all.message = (r && r.message) || '보내지 못했습니다.'; all.failed += g.length; g.forEach(function (x) { all.results.push({ student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: all.message }); }); return; }
          all.sent += r.sent || 0; all.failed += r.failed || 0;
          all.results = all.results.concat(r.results || []); all.skipped = all.skipped.concat(r.skipped || []);
        });
      });
    }, Promise.resolve()).then(function () {
      window.dispatchEvent(new CustomEvent('jt:welcome-sent', { detail: { kind: st.kind } }));
      return all;
    });
  }
  /* 바뀌지 않은 칸이 남아 보내지 않은 사람 — 실패로 「바뀌지 않은 칸이 있어 보내지 않음: {밀린날짜}」 (20261101m) */
  function addLeft(res, p) {
    if (!res || !p || !p.left || !p.left.length) return res;
    res.failed = (res.failed || 0) + p.left.length;
    res.results = (res.results || []).concat(p.left.map(function (x) { return { student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: leftMsg(x.left) }; }));
    return res;
  }
  function failNames(res) {
    var seen = {};
    return (res.results || []).filter(function (x) { return !x.ok; }).map(function (x) { return (x.name || '') + (TO_LABEL[x.to] ? '(' + TO_LABEL[x.to] + ')' : ''); })
      .filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
  }
  function resultText(res, p) {
    var bad = failNames(res);
    return '보냄 ' + (res.sent || 0) + '건 · 실패 ' + (res.failed || 0) + '건' + (bad.length ? '(' + bad.slice(0, 8).join(', ') + (bad.length > 8 ? ' 외 ' + (bad.length - 8) : '') + ')' : '') +
      (p && p.noPhone.length ? ' · 번호 없음 ' + p.noPhone.length + '명' : '') +
      (p && p.dup.length ? ' · 오늘 이미 보냄 ' + p.dup.length + '건 뺌' : '');
  }

  /* ---------- 창 ---------- */
  function modal() { return $('#wcModal'); }
  function openDialog(o) {
    st = {
      kind: o.kind, ids: o.ids || null, single: !!o.single, classes: {}, cls: o.cls || '',
      to: o.kind === 'entry' ? 'student' : (o.to || 'both'), onlyNew: true, onlyNoApp: o.kind === 'welcome' && !!o.cls,
      again: false, code: o.code || '', bodySt: '', bodyPa: '', busy: false, res: null, loading: true,
      miss: o.miss || null, off: {}, toSt: true, toPa: false
    };
    if (o.kind === 'nudge') st.to = 'student';
    if (o.cls) st.classes[o.cls] = true;
    $('#wcTitle').textContent = KIND[o.kind].title;
    $('#wcBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    if (!modal().open) modal().showModal();
    return load(o.kind).then(function () {
      if (o.kind === 'entry') st.bodySt = tplBody('입구 안내', ENTRY_BODY);
      else if (o.kind === 'nudge') { st.bodySt = tplBody('과제 독려(학생)', NUDGE_ST); st.bodyPa = tplBody('과제 독려(학부모)', NUDGE_PA); }
      else { st.bodySt = tplBody('신입생 웰컴(학생)', WEL_ST); st.bodyPa = tplBody('신입생 웰컴(학부모)', WEL_PA); }
      st.loading = false;
      paint();
    }, function (e) { $('#wcBody').innerHTML = '<p class="cp-warn">불러오지 못했습니다 — ' + esc(e.message) + '</p>'; });
  }

  function whoHtml() {
    if (st.kind === 'nudge') {
      var ts = targetsOf(st.to);
      return '<ul class="wc-picks" aria-label="받는 사람">' + st.ids.map(byId).filter(Boolean).map(function (s) {
        var sent = ts.some(function (t) { return ctx.sent[s.id + '|' + t]; }) || ctx.sent[s.id + '|student'];
        var noNum = st.toSt && !mobile(digits(s.studentPhone));
        return '<li><label class="wc-pick' + (st.off[s.id] ? ' is-off' : '') + '"><input type="checkbox" data-wc-off="' + esc(s.id) + '"' + (st.off[s.id] ? '' : ' checked') + '>' +
          '<span class="wc-pick__n">' + esc(s.name) + '</span><span class="wc-pick__d num">' + esc(st.miss[s.id] || '') + '</span>' +
          (sent ? '<small class="wc-pick__tag">오늘 보냄</small>' : '') + (noNum ? '<small class="wc-pick__tag is-mute">번호 없음</small>' : '') + '</label></li>';
      }).join('') + '</ul>';
    }
    if (st.ids) {
      var list = st.ids.map(byId).filter(Boolean);
      return '<p class="wc-who">받는 사람: <b>' + esc(list.map(function (s) { return s.name + '(' + clsOf(s) + ')'; }).slice(0, 4).join(', ') + (list.length > 4 ? ' 외 ' + (list.length - 4) + '명' : '')) + '</b></p>';
    }
    if (st.kind === 'welcome') return '<p class="wc-who">받는 반: <b>' + esc(st.cls) + '</b></p>';
    var names = classNames(), none = !Object.keys(st.classes).length;
    return '<div class="wc-cls" role="group" aria-label="받는 반">' +
      '<button type="button" class="chip' + (none ? ' is-on' : '') + '" data-wc-cls="" aria-pressed="' + none + '">전체</button>' +
      names.map(function (n) { var on = !!st.classes[n]; return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-wc-cls="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + '</button>'; }).join('') + '</div>';
  }
  function toHtml() {
    if (st.kind === 'entry') return '<p class="wc-note">학생 본인 번호로만 보냅니다.</p>';
    if (st.kind === 'nudge') {
      return '<div class="wc-to" role="group" aria-label="받는 사람">' +
        '<label class="wc-to__opt' + (st.toSt ? ' is-on' : '') + '"><input type="checkbox" id="wcToSt"' + (st.toSt ? ' checked' : '') + '> 학생에게</label>' +
        '<label class="wc-to__opt' + (st.toPa ? ' is-on' : '') + '"><input type="checkbox" id="wcToPa"' + (st.toPa ? ' checked' : '') + '> 학부모에게도</label></div>';
    }
    return '<div class="wc-to" role="radiogroup" aria-label="받는 사람">' + [['student', '학생'], ['parent', '학부모'], ['both', '둘 다']].map(function (x) {
      return '<label class="wc-to__opt' + (st.to === x[0] ? ' is-on' : '') + '"><input type="radio" name="wcTo" value="' + x[0] + '"' + (st.to === x[0] ? ' checked' : '') + '> ' + x[1] + '</label>';
    }).join('') + '</div>';
  }
  function filterHtml() {
    if (st.kind === 'entry') return '<label class="check-line wc-filter"><input type="checkbox" id="wcOnlyNew"' + (st.onlyNew ? ' checked' : '') + '> <span>아직 한 번도 로그인 안 한 학생만</span></label>';
    if (!st.ids) return '<label class="check-line wc-filter"><input type="checkbox" id="wcOnlyNoApp"' + (st.onlyNoApp ? ' checked' : '') + '> <span>아직 앱 링크 연결 안 된 학생만</span></label>';
    return '';
  }
  function bodyHtml() {
    var ts = targetsOf(st.to), html = '';
    var area = function (id, label, val) {
      return '<label class="field wc-text"><span class="field__label">' + label + '</span><textarea class="input" id="' + id + '" rows="5">' + esc(val) + '</textarea></label>';
    };
    if (st.kind === 'entry') html += area('wcBodySt', '문구 <span class="field__opt">이 창에서 고친 글은 이번에만 · 기본 문구는 「문자 발송 → 자주 쓰는 문구」의 「입구 안내」</span>', st.bodySt);
    else if (st.kind === 'nudge') {
      if (ts.indexOf('student') !== -1) html += area('wcBodySt', '학생에게 갈 문구', st.bodySt);
      if (ts.indexOf('parent1') !== -1) html += area('wcBodyPa', '학부모에게 갈 문구', st.bodyPa);
      html += '<p class="field__hint">고친 글은 <button type="button" class="btn btn--sm btn--ghost" data-wc-savetpl>문구 관리에 저장</button>을 누르면 다음부터 기본 문구가 됩니다 (「과제 독려(학생)」 · 「과제 독려(학부모)」) · {밀린날짜}는 학생마다 바뀝니다</p>';
    } else {
      if (ts.indexOf('student') !== -1) html += area('wcBodySt', '학생용 문구', st.bodySt);
      if (ts.indexOf('parent1') !== -1) html += area('wcBodyPa', '학부모용 문구', st.bodyPa);
      html += '<p class="field__hint">이 창에서 고친 글은 이번에만 씁니다 · 기본 문구는 「문자 발송 → 자주 쓰는 문구」의 「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」</p>';
    }
    return html + '<p class="field__hint wc-vars">쓸 수 있는 칸: {학생이름} {반이름} {첫수업일} {앱입장코드} {러닝노트주소} — 학생마다 바뀝니다</p>';
  }
  function blockOf() {
    if (ctx.smsMissing) return 'migration-023 · 040 SQL 을 실행하고 sms-send 를 배포해야 문자를 보낼 수 있습니다.';
    if (ctx.missing) return 'migration-052 SQL 을 먼저 실행해 주세요 (입구 · 웰컴 문자 칸 · 「오늘 이미 보냄」).';
    var ts = targetsOf(st.to);
    if (!ts.length) return '받는 사람(학생에게 · 학부모에게도)을 하나 이상 골라 주세요.';
    var bodies = [ts.indexOf('student') !== -1 ? st.bodySt : '', ts.indexOf('parent1') !== -1 ? st.bodyPa : ''].filter(function (b) { return b !== ''; });
    if (bodies.some(function (b) { return !String(b).trim(); })) return '문구를 적어 주세요.';
    if (bodies.some(needApp) && !ctx.links) return '「문자 발송 → 연결 상태」에서 앱 설치 링크를 먼저 넣어 주세요.';
    return '';
  }
  function paint() {
    if (!st || st.loading) return;
    var list = chosen(), p = plan(list), block = blockOf();
    var ex = p.items[0];
    var html = '<section class="wc-sec">' + whoHtml() + toHtml() + filterHtml() + '</section>' +
      '<section class="wc-sec">' + bodyHtml() + '</section>';
    html += '<p class="wc-sum"><b class="num">' + p.people + '</b>명 · 문자 <b class="num">' + p.items.length + '</b>건' + (p.lms ? ' (장문 ' + p.lms + ')' : '') +
      ' · 번호 없음 <b class="num">' + p.noPhone.length + '</b>명' + (p.dup.length ? ' · 오늘 이미 보냄 <b class="num">' + p.dup.length + '</b>건 (뺌)' : '') + '</p>';
    if (p.noPhone.length) html += '<p class="wc-miss">번호 없음: ' + esc(p.noPhone.slice(0, 12).map(function (x) { return x.s.name + '(' + x.what + ')'; }).join(', ') + (p.noPhone.length > 12 ? ' 외 ' + (p.noPhone.length - 12) + '명' : '')) + '</p>';
    var dn = st.again ? p.items.filter(function (x) { return x.again; }).length : p.dup.length;
    if (dn) {
      html += '<label class="check-line wc-again"><input type="checkbox" id="wcAgain"' + (st.again ? ' checked' : '') + '> <span>오늘 이미 보낸 ' + dn + '건도 다시 보내기 <span class="field__opt">' +
        esc((st.again ? p.items.filter(function (x) { return x.again; }) : p.dup).slice(0, 6).map(function (x) { return x.s.name + '(' + TO_LABEL[x.t] + ')'; }).join(', ')) + '</span></span></label>';
    }
    if (p.noCode.length) html += '<p class="cp-warn">입장코드가 없는 학생 ' + uniq(p.noCode) + '명은 보내지 않습니다 — 반 관리에서 그 반 「앱 입장코드」를 넣어 주세요.</p>';
    if (p.left.length) {
      var lk = [], ln = [];
      p.left.forEach(function (x) { if (ln.indexOf(x.s.name) === -1) ln.push(x.s.name); x.left.forEach(function (k) { if (lk.indexOf(k) === -1) lk.push(k); }); });
      html += '<p class="cp-warn" id="wcLeft">⚠ 바뀌지 않은 칸이 있어 ' + ln.length + '명에게는 보내지 않습니다: <b>' + esc(lk.join(' ')) + '</b> (' + esc(ln.slice(0, 8).join(' · ')) + (ln.length > 8 ? ' 외 ' + (ln.length - 8) + '명' : '') + ')</p>';
    }
    if (block) html += '<p class="cp-warn" id="wcBlock">' + esc(block) + '</p>';
    html += ex
      ? '<div class="sms-pv wc-pv"><div class="sms-pv__head">미리보기 — ' + esc(ex.s.name) + ' · ' + (ex.t === 'student' ? '학생 본인' : '학부모') + ' <span class="num">…' + esc(ex.d.slice(-4)) + '</span> <span class="sms-kind sms-kind--' + ex.kind + '">' + (ex.kind === 'SMS' ? '단문' : '장문') + ' ' + ex.bytes + '바이트</span></div><pre class="sms-pv__text" id="wcPreview">' + esc(ex.text) + '</pre></div>'
      : '<p class="panel__hint">보낼 사람이 없습니다.</p>';
    if (st.res) html += '<p class="wc-res ' + (st.res.failed || !st.res.ok ? 'is-bad' : 'is-ok') + '" id="wcResult">' + esc(st.resText) + '</p>';
    html += '<div class="wc-foot"><button type="button" class="btn" id="wcCancel">닫기</button>' +
      '<button type="button" class="btn btn--primary" id="wcSend"' + (!p.items.length || block || st.busy ? ' disabled' : '') + '>' + (st.busy ? '보내는 중…' : p.people + '명에게 보내기') + '</button></div>';
    var focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart;
    $('#wcBody').innerHTML = html;
    if (focus && $('#' + focus)) { var el = $('#' + focus); el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} }
    st.plan = p;
  }
  function uniq(list) { var m = {}; list.forEach(function (x) { m[x.s.id] = 1; }); return Object.keys(m).length; }

  function send() {
    var p = st.plan;
    if (!p || !p.items.length || st.busy) return;
    var desc = p.people + '명에게 보냅니다 — 문자 ' + p.items.length + '건' + (p.lms ? ' (장문 ' + p.lms + ')' : '') + '.' +
      (p.noPhone.length ? ' 번호 없음 ' + p.noPhone.length + '명은 뺍니다.' : '') +
      (p.dup.length ? ' 오늘 이미 보낸 ' + p.dup.length + '건은 뺍니다.' : '') +
      (p.items.some(function (x) { return x.again; }) ? ' 오늘 이미 보낸 사람에게 한 번 더 보냅니다.' : '') +
      (p.left.length ? ' ⚠ 바뀌지 않은 칸이 있어 ' + uniq(p.left) + '명에게는 보내지 않습니다.' : '') +
      ' 보낸 기록에 「' + KIND[st.kind].label + '」으로 남습니다.';
    UI.confirmAsk(KIND[st.kind].title, desc, '보내기').then(function (yes) {
      if (!yes) return;
      st.busy = true; paint();
      sendItems(p.items).then(function (res) {
        addLeft(res, p);
        st.busy = false; st.res = res; st.resText = resultText(res, p);
        toast(st.resText, res.failed || !res.ok ? 'bad' : 'good');
        return load(st.kind).then(paint);
      });
    });
  }

  /* ---------- 창 없이 바로 (한 명 등록 · 엑셀 뒤 [보내기]) ---------- */
  function sendNow(ids, o) {
    o = o || {};
    st = { kind: 'welcome', ids: ids, to: o.to || 'both', code: o.code || '', again: false, classes: {}, quiet: true };
    var mine = st;
    return load('welcome').then(function () {
      if (st !== mine) st = mine;
      st.bodySt = tplBody('신입생 웰컴(학생)', WEL_ST); st.bodyPa = tplBody('신입생 웰컴(학부모)', WEL_PA);
      var block = blockOf();
      var p = plan(chosen());
      /* 문자를 아직 안 쓰는 곳 — 등록 창에 이미 안내가 있으니 조용히 넘어간다 */
      if (ctx.smsMissing) return { ok: false, message: block, plan: p, skipped: 'nosms' };
      if (block) { toast('웰컴 문자를 보내지 못했습니다 — ' + block, 'bad'); return { ok: false, message: block, plan: p }; }
      if (!p.items.length && p.left.length) { toast('웰컴 문자 — ' + leftMsg(p.left[0].left), 'bad'); return addLeft({ ok: true, sent: 0, failed: 0, results: [], plan: p }, p); }
      if (!p.items.length) {
        toast('웰컴 문자 — 보낼 번호가 없습니다' + (p.noPhone.length ? ' (번호 없음 ' + p.noPhone.length + '명)' : '') + (p.dup.length ? ' · 오늘 이미 보냄' : ''), 'bad');
        return { ok: true, sent: 0, failed: 0, results: [], plan: p };
      }
      return sendItems(p.items).then(function (res) {
        res.plan = p;
        addLeft(res, p);
        toast('웰컴 문자 — ' + resultText(res, p), res.failed || !res.ok ? 'bad' : 'good');
        return res;
      });
    }, function (e) { toast('웰컴 문자를 보내지 못했습니다 — ' + e.message, 'bad'); return { ok: false, message: e.message }; });
  }
  function askAfterImport(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return Promise.resolve(null);
    return UI.confirmAsk('웰컴 문자', '새로 넣은 ' + ids.length + '명에게 웰컴 문자 보낼까요? (학생 본인 · 학부모 1 · 2 · 번호 없는 사람은 뺍니다)', '보내기', '나중에').then(function (y) {
      return y ? sendNow(ids, { to: 'both' }) : null;
    });
  }

  /* 「문구 관리에 저장」 — 지금 창의 글을 「자주 쓰는 문구」의 그 이름으로 (없으면 새로) */
  function saveTpl() {
    var titles = KIND[st.kind].tpl, ts = targetsOf(st.to), jobs = [];
    var put = function (title, body) {
      var cur = (ctx.templates || []).find(function (x) { return (x.title || '').trim() === title; });
      var who = UI.whoami ? UI.whoami() : '';
      var q = cur ? sb().from('sms_templates').update({ body: body, updated_by: who, updated_at: new Date().toISOString() }).eq('id', cur.id)
                  : sb().from('sms_templates').insert({ title: title, body: body, sort_order: 999, updated_by: who });
      return Promise.resolve(q).then(function (r) { if (r && r.error) throw new Error(r.error.message); });
    };
    if (ts.indexOf('student') !== -1 || st.kind === 'entry') jobs.push(put(titles[0], st.bodySt));
    if (titles[1] && ts.indexOf('parent1') !== -1) jobs.push(put(titles[1], st.bodyPa));
    return Promise.all(jobs).then(function () {
      toast('문구 관리에 저장했습니다 — 다음부터 이 글이 기본입니다', 'good');
      return load(st.kind);
    }, function (e) { toast('문구를 저장하지 못했습니다 — ' + e.message, 'bad'); });
  }
  /* 오늘 보낸 것 (반 카드 「오늘 10:20 보냄 4명」) — 목적마다 30초 기억 · 보내면 새로 */
  var todayMemo = {};
  function sentToday(kind) {
    var m = todayMemo[kind];
    if (m && Date.now() - m.at < 30000) return m.p;
    var p = rpc('sms_sent_today', { p_purpose: kind }).then(function (r) { return r.missing ? null : (r.data || []); }, function () { return null; });
    todayMemo[kind] = { at: Date.now(), p: p };
    return p;
  }
  window.addEventListener('jt:welcome-sent', function (e) { var k = e.detail && e.detail.kind; if (k) delete todayMemo[k]; else todayMemo = {}; });

  /* 상담 카드 「웰컴 안내 보냄 10/30」 */
  function lastSent(sid) {
    return rpc('sms_purpose_last', { p_student: sid }).then(function (r) { return (r && r.data) || {}; }, function () { return {}; });
  }

  /* ---------- 이벤트 ---------- */
  function init() {
    var m = modal();
    if (!m) return;
    m.addEventListener('click', function (e) {
      if (e.target.id === 'wcClose' || e.target.id === 'wcCancel') { m.close(); return; }
      if (e.target.id === 'wcSend') { send(); return; }
      if (e.target.closest('[data-wc-savetpl]')) { saveTpl(); return; }
      var c = e.target.closest('[data-wc-cls]');
      if (c) {
        var n = c.getAttribute('data-wc-cls');
        if (!n) st.classes = {};
        else if (st.classes[n]) delete st.classes[n]; else st.classes[n] = true;
        paint();
      }
    });
    m.addEventListener('change', function (e) {
      if (!st) return;
      var t = e.target;
      if (t.name === 'wcTo') { st.to = t.value; paint(); return; }
      if (t.id === 'wcOnlyNew') { st.onlyNew = t.checked; paint(); return; }
      if (t.id === 'wcOnlyNoApp') { st.onlyNoApp = t.checked; paint(); return; }
      if (t.id === 'wcAgain') { st.again = t.checked; paint(); return; }
      if (t.id === 'wcToSt' || t.id === 'wcToPa') {
        if (t.id === 'wcToSt') st.toSt = t.checked; else st.toPa = t.checked;
        st.to = st.toSt && st.toPa ? 'both' : st.toSt ? 'student' : st.toPa ? 'parent' : 'none';
        paint(); return;
      }
      if (t.hasAttribute('data-wc-off')) { var sid = t.getAttribute('data-wc-off'); if (t.checked) delete st.off[sid]; else st.off[sid] = true; paint(); }
    });
    var tm = null;
    m.addEventListener('input', function (e) {
      if (!st) return;
      if (e.target.id === 'wcBodySt') st.bodySt = e.target.value;
      else if (e.target.id === 'wcBodyPa') st.bodyPa = e.target.value;
      else return;
      clearTimeout(tm); tm = setTimeout(paint, 200);
    });
    /* 명단 반 이름 옆 [반 전체에 웰컴 안내] */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wc-class]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      openDialog({ kind: 'welcome', cls: b.getAttribute('data-wc-class') });
    }, true);
  }
  init();

  window.Welcome = {
    openEntry: function () { return openDialog({ kind: 'entry' }); },
    open: function (o) { o = o || {}; return openDialog({ kind: 'welcome', ids: o.students || null, single: (o.students || []).length === 1, cls: o.cls || '', to: o.to || 'both' }); },
    /* 과제 독려 — o = { students: [id], miss: { id: '10/31(금) 10/30(목)' } } (today.js) */
    nudge: function (o) { return openDialog({ kind: 'nudge', ids: o.students || [], miss: o.miss || {} }); },
    sentToday: sentToday,
    sendNow: sendNow, askAfterImport: askAfterImport, lastSent: lastSent,
    fill: function (body, s) { return fill(body, s); }, defaults: { entry: ENTRY_BODY, student: WEL_ST, parent: WEL_PA }
  };
})();
