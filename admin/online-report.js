/* ============================================================
   online-report.js — 온라인 반 「📨 레포트 알림톡 보내기」 (20261126a · migration-129 · 함수 kakao-send kind "online")

   자동 발송 없음. 온라인 반 화면 제목 줄 버튼 → 창 하나
     · 주(이번 주 · 지난주 · 2주 전 — 월 ~ 일) · 받는 사람 [학생] [학부모] · 알림톡이 안 되면 문자로 대신(기본 켬)
     · 학생마다 체크 · 이번 주 낸 날 · 경우(다 완주 / 1~n일 빠짐 / 더 빠짐 — 자동, 직원이 바꿀 수 있음) · [문구 보기](그 학생에게 나갈 글)
       이름 없음 · 번호 없음 · 링크 없음 · 학부모와 같은 번호 · 템플릿 등록 전 · 이번 주 숙제 없음은 표시하고 빼 둔다
       이번 주 이미 보냄 — 표시 · 기본 체크 안 함 · 체크해 보내면 확인 창에서 한 번 더 경고
     · [🧪 내 시험 번호로 시험 발송](경우마다 한 통) → 그 경우들이 시험을 거쳐야 [📨 보내기] 가 켜짐 → 확인 창 → 발송
     · 「템플릿 등록 전」 경우만 막고 나머지는 보낼 수 있다 · ⚙ 템플릿 코드(원장만 고침 · 「1~n일」의 n) · 🧾 보낸 기록
   문구는 서버(online_report_preview → cfg.bodies · SQL _online_report_body)가 하나뿐인 원본 — 여기서는 채워서 보여 주기만
   번호는 가린 것만 받는다(010-****-1234) · 순위 · 비교 · 금액 · 환급 기준 · 사진 · 모의고사 · AI 는 넣지 않는다
   ============================================================ */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, k) { if (global.UI && UI.toast) UI.toast(m, k); }
  function sb() { return global.SB && SB.client; }
  function errText(e) { return global.ErrKo ? ErrKo.ko(e) : (e && e.message) || String(e || ''); }
  function needSql(e) { return /Could not find the function|does not exist|schema cache|PGRST202/i.test((e && (e.message || e.code)) || ''); }
  function today() { return global.DDay && DDay.today ? DDay.today() : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function mondayOf(iso) { var d = new Date(iso + 'T00:00:00Z'), w = (d.getUTCDay() + 6) % 7; return addDays(iso, -w); }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function hm(ts) { var d = new Date(ts); if (isNaN(d)) return ''; var k = new Date(d.getTime() + 9 * 3600000); return (k.getUTCMonth() + 1) + '/' + k.getUTCDate() + ' ' + String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0'); }

  var CASES = ['full', 'some', 'many'];
  var KEYS = ['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many'];
  var KEY_LABEL = { s: '학생', p: '학부모' };
  function caseLabel(c, n) {
    n = n || 2;
    return c === 'full' ? '다 완주' : c === 'some' ? '1~' + n + '일 빠짐' : c === 'many' ? (n + 1) + '일 이상 빠짐' : '이번 주 숙제 없음';
  }

  var S = { cls: '', week: '', target: 'student', data: null, err: '', busy: false, loading: false, pick: {}, cases: {}, open: {}, tested: {}, fallback: true,
            view: 'form', msg: '', log: null, logErr: '', run: 0, tplIn: {} };
  var dlg = null;

  function cfg() { return (S.data && S.data.cfg) || {}; }
  function someMax() { return +cfg().some_max || 2; }
  function keyOf(c) { return (S.target === 'parent' ? 'p_' : 's_') + c; }
  function tplOk(c) { return !!(cfg().tplSet || {})[keyOf(c)]; }
  function rows() { return (S.data && S.data.rows) || []; }
  function caseOf(r) { var c = S.cases[r.id]; return CASES.indexOf(c) >= 0 ? c : r.auto; }
  function submitOf(r) { var w = r.w || {}; return (w.open || 0) + '일 중 ' + (w.done || 0) + '일'; }
  function streakOf(r) { var w = r.w || {}; return Math.max(1, +w.run || 0) + '일'; }

  /* 받는 사람 기준으로 이 학생을 보낼 수 있는가 — 막는 이유(없으면 '') · 경고(이미 보냄) */
  function blockOf(r) {
    if (!r.name) return '이름 없음';
    if (S.target === 'student') {
      if (!r.sp) return '학생 번호 없음';
      if (r.same) return '학부모와 같은 번호';
      if (!r.slink) return '학생 링크 없음';
    } else {
      if (!(r.pp || []).length) return '학부모 번호 없음';
      if (!r.plink) return '학부모 링크 없음';
    }
    var c = caseOf(r);
    if (c === 'none') return '이번 주 숙제 없음 — 경우를 고르면 보낼 수 있어요';
    if (!tplOk(c)) return '템플릿 등록 전';
    return '';
  }
  function sentOf(r) { return (r.sent || {})[S.target] || null; }
  function defaultPick() {
    S.pick = {};
    rows().forEach(function (r) { if (!blockOf(r) && !sentOf(r)) S.pick[r.id] = true; });
  }
  function picked() { return rows().filter(function (r) { return S.pick[r.id] && !blockOf(r); }); }
  function msgCount(list) { return list.reduce(function (n, r) { return n + (S.target === 'parent' ? (r.pp || []).length : 1); }, 0); }
  function casesIn(list) { var o = {}; list.forEach(function (r) { o[caseOf(r)] = (o[caseOf(r)] || 0) + 1; }); return o; }
  function untested(list) { return Object.keys(casesIn(list)).filter(function (c) { return !S.tested[S.target + '|' + c]; }); }

  function fill(key, r, sms) {
    var b = (cfg().bodies || {})[key] || '';
    if (sms) b = b.replace('아래 [레포트 보기]에서', '아래 링크에서') + '\n(링크)';
    return b.split('#{이름}').join(r.name || '').split('#{반}').join(S.cls).split('#{제출}').join(submitOf(r)).split('#{연속}').join(streakOf(r));
  }

  /* ---------- 그리기 ---------- */
  function weekOpts() {
    var t = today(), m = mondayOf(t);
    return [[m, '이번 주'], [addDays(m, -7), '지난주'], [addDays(m, -14), '2주 전']].map(function (x) {
      var end = addDays(x[0], 6);
      return '<option value="' + x[0] + '"' + (S.week === x[0] ? ' selected' : '') + '>' + x[1] + ' (' + md(x[0]) + ' ~ ' + md(end) + ')</option>';
    }).join('');
  }
  function tplLine() {
    var n = someMax();
    return '<div class="orp-tpls" aria-label="템플릿 상태">' + CASES.map(function (c) {
      var ok = tplOk(c);
      return '<span class="orp-tpl' + (ok ? ' is-ok' : ' is-no') + '">' + KEY_LABEL[S.target === 'parent' ? 'p' : 's'] + ' · ' + esc(caseLabel(c, n)) + ' <b>' + (ok ? '등록됨' : '템플릿 등록 전') + '</b></span>';
    }).join('') + '</div>';
  }
  function rowHtml(r) {
    var why = blockOf(r), sent = sentOf(r), c = caseOf(r), n = someMax(), id = esc(r.id);
    var on = !why && !!S.pick[r.id];
    var w = r.w || {};
    var phone = S.target === 'parent' ? ((r.pp || []).length ? (r.pp || []).map(esc).join(' · ') : '') : esc(r.sp || '');
    var tags = '';
    if (!r.name) tags += '<span class="orp-tag is-bad">이름 없음 · 보내기에서 뺌</span>';
    if (sent) tags += '<span class="orp-tag is-warn">이번 주 보냄 ' + esc(hm(sent.at)) + ' · ' + esc(caseLabel(sent.case, n)) + '</span>';
    if (why && r.name) tags += '<span class="orp-tag is-bad">' + esc(why) + '</span>';
    if (w.unk) tags += '<span class="orp-tag" title="129 전에 지나간 달이라 그날 기록을 못 셌어요">모르는 날 ' + w.unk + '</span>';
    var sel = '<select class="input input--sm orp-case" data-orp-case="' + id + '" aria-label="' + esc((r.name || '이름 없음') + ' 경우') + '"' + (!r.name ? ' disabled' : '') + '>' +
      (r.auto === 'none' ? '<option value="none"' + (c === 'none' ? ' selected' : '') + '>이번 주 숙제 없음</option>' : '') +
      CASES.map(function (k) { return '<option value="' + k + '"' + (c === k ? ' selected' : '') + '>' + esc(caseLabel(k, n)) + (k === r.auto ? ' (자동)' : '') + (tplOk(k) ? '' : ' · 등록 전') + '</option>'; }).join('') + '</select>';
    var text = S.open[r.id] && c !== 'none' ? '<pre class="orp-text" aria-label="나갈 글">' + esc(fill(keyOf(c), r)) + '\n\n[레포트 보기] 버튼</pre>' : '';
    return '<li class="orp-r' + (on ? ' is-on' : '') + (why ? ' is-off' : '') + '">' +
      '<label class="orp-chk"><input type="checkbox" data-orp-pick="' + id + '"' + (on ? ' checked' : '') + (why ? ' disabled' : '') + ' aria-label="' + esc((r.name || '이름 없음') + ' 보내기') + '">' +
        '<span class="orp-nm">' + (r.name ? esc(r.name) : '<i>이름 없음</i>') + '</span></label>' +
      '<span class="orp-ph">' + (phone || '<i>번호 없음</i>') + '</span>' +
      '<span class="orp-wk num">이번 주 ' + (w.open || 0) + '일 중 ' + (w.done || 0) + '일' + (w.miss ? ' · 빠진 날 ' + w.miss : '') + '</span>' +
      sel + (c !== 'none' ? '<button type="button" class="btn btn--sm btn--ghost orp-see" data-orp-see="' + id + '" aria-expanded="' + !!S.open[r.id] + '">' + (S.open[r.id] ? '문구 닫기' : '문구 보기') + '</button>' : '') +
      (tags ? '<span class="orp-tags">' + tags + '</span>' : '') + text + '</li>';
  }
  function formHtml() {
    var d = S.data, c = cfg();
    var top = '<div class="orp-ctl"><label class="orp-f">주 <select class="input input--sm" data-orp-week>' + weekOpts() + '</select></label>' +
      '<div class="orp-seg" role="group" aria-label="받는 사람">' + [['student', '학생'], ['parent', '학부모']].map(function (x) {
        return '<button type="button" class="orp-sg' + (S.target === x[0] ? ' is-on' : '') + '" aria-pressed="' + (S.target === x[0]) + '" data-orp-target="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="orp-f orp-fb"><input type="checkbox" data-orp-fb' + (S.fallback ? ' checked' : '') + '> 알림톡이 안 되면 문자로 대신</label></div>';
    var body;
    if (S.err) body = '<p class="orp-err" role="alert">' + esc(S.err) + '</p>';
    else if (!d) body = '<p class="muted-note">불러오는 중…</p>';
    else {
      var list = rows(), pk = picked(), cnt = casesIn(pk), n = someMax(), off = list.filter(function (r) { return blockOf(r); });
      var noName = list.filter(function (r) { return !r.name; }).length;
      var resend = pk.filter(function (r) { return sentOf(r); }).length;
      var need = untested(pk);
      var canTest = pk.length && c.testPhone && !S.busy;
      var canGo = pk.length && !need.length && !S.busy;
      body = tplLine() +
        '<p class="muted-note orp-legend">경우는 이번 주(' + md(d.week) + ' ~ ' + md(addDays(d.week, 6)) + ') 숙제가 열린 날 기준 · 오늘은 마감 전이라 빠진 날로 안 셈 · 자동으로 골라 두었고 바꿀 수 있어요' +
          (noName ? ' · <b>이름 없는 학생 ' + noName + '명은 보내기에서 뺐어요</b>' : '') + '</p>' +
        '<div class="orp-all"><button type="button" class="btn btn--sm" data-orp-all>보낼 수 있는 학생 모두 고르기</button><button type="button" class="btn btn--sm btn--ghost" data-orp-none>모두 풀기</button>' +
          '<small class="muted-note">' + list.length + '명 중 보낼 수 없음 ' + off.length + '명</small></div>' +
        '<ul class="orp-list">' + (list.length ? list.map(rowHtml).join('') : '<li class="muted-note">이 반에 학생이 없어요</li>') + '</ul>' +
        '<div class="orp-sum" aria-live="polite"><b>' + KEY_LABEL[S.target === 'parent' ? 'p' : 's'] + ' ' + pk.length + '명</b>' + (S.target === 'parent' ? ' (번호 ' + msgCount(pk) + '개)' : '') +
          (pk.length ? ' · ' + CASES.filter(function (k) { return cnt[k]; }).map(function (k) { return esc(caseLabel(k, n)) + ' ' + cnt[k]; }).join(' · ') : '') +
          (resend ? ' · <span class="orp-warn">이번 주 이미 보낸 학생 ' + resend + '명 포함</span>' : '') +
          '<br><small class="muted-note">오늘 보낸 알림톡 ' + (c.todayCount || 0) + ' / 하루 최대 ' + (c.dailyMax || 0) + '건</small></div>' +
        (S.msg ? '<p class="orp-msg" role="status">' + esc(S.msg) + '</p>' : '');
      var testWhy = !c.testPhone ? '「문자 발송 → 연결 상태」에서 내 시험 번호를 먼저 넣어 주세요' : '';
      var goWhy = !pk.length ? '보낼 학생을 골라 주세요' : need.length ? '먼저 시험 발송: ' + need.map(function (k) { return caseLabel(k, n); }).join(' · ') : '';
      body += '<div class="orp-go"><button type="button" class="btn" data-orp-test' + (canTest ? '' : ' disabled') + (testWhy ? ' title="' + esc(testWhy) + '"' : '') + '>🧪 원장 번호로 시험 발송' + (c.testPhone ? ' <small>(' + esc(c.testPhone) + ')</small>' : '') + '</button>' +
        '<button type="button" class="btn btn--primary" data-orp-go' + (canGo ? '' : ' disabled') + (goWhy ? ' title="' + esc(goWhy) + '"' : '') + '>📨 보내기 (' + pk.length + '명)</button></div>' +
        '<p class="muted-note orp-why">' + esc(testWhy || goWhy || '시험 발송을 마쳤어요 · 보내기 전에 한 번 더 물어봐요') + '</p>';
    }
    return '<div class="orp-body">' + top + body + '</div>' +
      '<div class="modal__foot orp-foot"><button type="button" class="btn btn--sm" data-orp-view="log">🧾 보낸 기록</button><button type="button" class="btn btn--sm" data-orp-view="tpl">⚙ 템플릿 코드</button><div class="spacer"></div>' +
      '<button type="button" class="btn" data-orp-close>닫기</button></div>';
  }
  function tplHtml() {
    var c = cfg(), own = !!c.owner, n = someMax();
    var list = KEYS.map(function (k) {
      var cs = k.slice(2), set = !!(c.tplSet || {})[k], v = S.tplIn[k] != null ? S.tplIn[k] : ((c.tpl || {})[k] || '');
      return '<li class="orp-ti"><span class="orp-ti__n">' + KEY_LABEL[k[0]] + ' · ' + esc(caseLabel(cs, n)) + '</span>' +
        (own ? '<input class="input input--sm" data-orp-tin="' + k + '" value="' + esc(v) + '" placeholder="솔라피 템플릿 코드 (비우면 등록 전)" aria-label="' + esc(KEY_LABEL[k[0]] + ' ' + caseLabel(cs, n) + ' 템플릿 코드') + '"><button type="button" class="btn btn--sm" data-orp-tsave="' + k + '">저장</button>' : '') +
        '<b class="orp-tag ' + (set ? 'is-ok' : 'is-bad') + '">' + (set ? '등록됨' : '등록 전') + '</b></li>';
    }).join('');
    return '<div class="orp-body"><p class="muted-note">템플릿은 카카오 비즈니스 채널(솔라피)에 원장님이 직접 등록해요 — 등록용 초안은 코치룸 .local/알림톡_온라인레포트_템플릿.md · 심사가 끝난 코드만 여기에 넣어 주세요.' +
        (own ? '' : ' 코드는 원장 계정만 바꿀 수 있어요.') + '</p><ul class="orp-tlist">' + list + '</ul>' +
      '<div class="orp-some"><label>「1~n일 빠짐」의 n <input class="input input--sm" type="number" min="1" max="6" inputmode="numeric" data-orp-some value="' + n + '"' + (own ? '' : ' disabled') + '></label>' +
        (own ? '<button type="button" class="btn btn--sm" data-orp-somesave>저장</button>' : '') + '<small class="muted-note">n일보다 많이 빠지면 「' + esc(caseLabel('many', n)) + '」</small></div>' +
      (S.msg ? '<p class="orp-msg" role="status">' + esc(S.msg) + '</p>' : '') + '</div>' +
      '<div class="modal__foot orp-foot"><button type="button" class="btn btn--sm" data-orp-view="form">◀ 보내기로</button><div class="spacer"></div><button type="button" class="btn" data-orp-close>닫기</button></div>';
  }
  function logHtml() {
    var n = someMax(), body;
    if (S.logErr) body = '<p class="orp-err">' + esc(S.logErr) + '</p>';
    else if (!S.log) body = '<p class="muted-note">불러오는 중…</p>';
    else if (!S.log.length) body = '<p class="muted-note">아직 보낸 기록이 없어요</p>';
    else body = '<ul class="orp-log">' + S.log.map(function (g) {
      return '<li class="orp-log__i"><b>' + esc(hm(g.at)) + '</b> · ' + esc(g.by || '') + (g.test ? ' <span class="orp-tag">시험</span>' : '') + '<br>' +
        esc(g.class) + ' · ' + esc(md(g.week)) + ' 주 · ' + KEY_LABEL[g.target === 'parent' ? 'p' : 's'] + ' ' + g.people + '명(' + g.msgs + '통)<br>' +
        '<small>' + CASES.filter(function (k) { return g[k]; }).map(function (k) { return esc(caseLabel(k, n)) + ' ' + g[k]; }).join(' · ') + '</small><br>' +
        '<span class="orp-res">알림톡 접수 ' + g.ok + ' · 대체 문자 ' + g.alt + ' · 실패 ' + g.fail + (g.wait ? ' · 보내는 중 ' + g.wait : '') + '</span></li>';
    }).join('') + '</ul>';
    return '<div class="orp-body">' + body + '<p class="muted-note">대체 문자는 알림톡 결과가 온 뒤(1분쯤) 채워져요</p></div>' +
      '<div class="modal__foot orp-foot"><button type="button" class="btn btn--sm" data-orp-view="form">◀ 보내기로</button><div class="spacer"></div><button type="button" class="btn" data-orp-close>닫기</button></div>';
  }
  function paint() {
    if (!dlg) return;
    var sc = dlg.querySelector('.orp-body'), top = sc ? sc.scrollTop : 0;
    var title = S.view === 'log' ? '🧾 레포트 알림톡 보낸 기록' : S.view === 'tpl' ? '⚙ 레포트 알림톡 템플릿 코드' : '📨 레포트 알림톡 보내기';
    dlg.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="orpTitle">' + title + ' <small>· ' + esc(S.cls) + '</small></h2>' +
      (S.view === 'form' ? '<p class="modal__desc">자동으로 보내지 않아요 · 시험 발송 → 확인 → 발송 · 이름 · 반 · 이번 주 낸 날 · 연속만 나가요</p>' : '') + '</div>' +
      (S.view === 'log' ? logHtml() : S.view === 'tpl' ? tplHtml() : formHtml());
    var b = dlg.querySelector('.orp-body'); if (b) b.scrollTop = top;
  }

  /* ---------- 불러오기 · 보내기 ---------- */
  function load() {
    var c = sb(), run = ++S.run;
    S.err = ''; S.data = null; S.msg = ''; paint();
    if (!c) { S.err = '서버에 연결되지 않았어요'; paint(); return; }
    Promise.resolve(c.rpc('online_report_preview', { p_class: S.cls, p_week: S.week })).then(function (r) {
      if (run !== S.run) return;
      if (r && r.error) { S.err = needSql(r.error) ? 'migration-129 SQL 을 먼저 실행해 주세요' : '불러오지 못했어요 — ' + errText(r.error); paint(); return; }
      S.data = r && r.data; S.cases = {}; S.open = {};
      if (S.data && S.data.week) S.week = S.data.week;
      defaultPick(); paint();
    }, function (e) { if (run === S.run) { S.err = '불러오지 못했어요 — ' + errText(e); paint(); } });
  }
  function invoke(body) {
    var c = sb(), fns = c && c.functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, message: '알림톡 함수(kakao-send)를 부를 수 없습니다.' });
    return fns.invoke('kakao-send', { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false, message: '알림톡 함수(kakao-send)를 부르지 못했습니다. 배포됐는지 확인해 주세요.' }; });
      return { ok: false, message: '알림톡 함수(kakao-send)를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) { return { ok: false, message: '알림톡 함수(kakao-send)를 부르지 못했습니다 — ' + ((e && e.message) || '') }; });
  }
  function items(list) { return list.map(function (r) { return { id: r.id, case: caseOf(r) }; }); }
  function skippedText(res) {
    var sk = (res && res.skipped) || [];
    if (!sk.length) return '';
    var by = {};
    sk.forEach(function (s) { by[s.label || s.reason] = (by[s.label || s.reason] || 0) + 1; });
    return ' · 건너뜀 ' + Object.keys(by).map(function (k) { return k + ' ' + by[k]; }).join(', ');
  }
  function test() {
    var pk = picked();
    if (!pk.length || S.busy) return;
    S.busy = true; S.msg = '시험 발송 중…'; paint();
    var tgt = S.target, cs = Object.keys(casesIn(pk));
    invoke({ kind: 'online', action: 'test', cls: S.cls, week: S.week, target: tgt, items: items(pk) }).then(function (res) {
      S.busy = false;
      if (!res || !res.ok) { S.msg = '시험 발송 실패 — ' + ((res && res.message) || '보내지 못했어요') + skippedText(res); paint(); toast(S.msg, 'bad'); return; }
      var okCases = {};
      (res.results || []).forEach(function (x) { if (x.ok) okCases[x.case] = true; });
      cs.forEach(function (k) { if (okCases[k]) S.tested[tgt + '|' + k] = true; });
      var bad = (res.results || []).filter(function (x) { return !x.ok; });
      S.msg = (res.sent ? '내 시험 번호로 ' + res.sent + '통 보냈어요(경우마다 한 통) — 휴대폰에서 글을 확인한 뒤 보내기를 눌러 주세요' : '시험 발송이 접수되지 않았어요') +
        (bad.length ? ' · 실패 ' + bad.length + ' — ' + (bad[0].error || '') : '') + skippedText(res);
      paint(); toast(S.msg, res.sent && !bad.length ? 'good' : 'bad');
    });
  }
  function go() {
    var pk = picked(), n = someMax();
    if (!pk.length || S.busy || untested(pk).length) return;
    var cnt = casesIn(pk), resend = pk.filter(function (r) { return sentOf(r); });
    var who = S.target === 'parent' ? '학부모 ' + pk.length + '명(번호 ' + msgCount(pk) + '개)' : '학생 ' + pk.length + '명';
    var text = S.cls + ' · ' + md(S.week) + ' 주 레포트 알림톡을 ' + who + '에게 보냅니다.\n' +
      CASES.filter(function (k) { return cnt[k]; }).map(function (k) { return caseLabel(k, n) + ' ' + cnt[k] + '명'; }).join(' · ') +
      (S.fallback ? '\n알림톡이 안 되면 같은 글을 문자로 대신 보내요.' : '') +
      (resend.length ? '\n\n⚠ 이번 주에 이미 보낸 학생 ' + resend.length + '명(' + resend.slice(0, 5).map(function (r) { return r.name; }).join(', ') + (resend.length > 5 ? ' 외' : '') + ')에게 한 번 더 갑니다.' : '');
    UI.confirmAsk('레포트 알림톡 보내기', text, '보내기').then(function (ok) {
      if (!ok) return;
      S.busy = true; S.msg = '보내는 중…'; paint();
      invoke({ kind: 'online', action: 'send', cls: S.cls, week: S.week, target: S.target, items: items(pk), resend: resend.length > 0, fallback: S.fallback }).then(function (res) {
        S.busy = false;
        if (!res || !res.ok) { S.msg = '보내지 못했어요 — ' + ((res && res.message) || '') + skippedText(res); paint(); toast(S.msg, 'bad'); return; }
        var msg = '알림톡 ' + res.sent + '통 접수' + (res.failed ? ' · 실패 ' + res.failed + '통' + (S.fallback ? '(문자로 대신 보내요)' : '') : '') + skippedText(res);
        toast(msg, res.failed ? 'bad' : 'good');
        var keep = S.target; load(); S.target = keep; S.msg = msg;
      });
    });
  }
  function loadLog() {
    var c = sb();
    S.log = null; S.logErr = ''; paint();
    if (!c) { S.logErr = '서버에 연결되지 않았어요'; paint(); return; }
    Promise.resolve(c.rpc('online_report_log_list', { p_class: S.cls, p_limit: 50 })).then(function (r) {
      if (r && r.error) S.logErr = needSql(r.error) ? 'migration-129 SQL 을 먼저 실행해 주세요' : '불러오지 못했어요 — ' + errText(r.error);
      else S.log = Array.isArray(r && r.data) ? r.data : [];
      paint();
    }, function (e) { S.logErr = '불러오지 못했어요 — ' + errText(e); paint(); });
  }
  function saveTpl(k) {
    var c = sb(), v = String(S.tplIn[k] != null ? S.tplIn[k] : ((cfg().tpl || {})[k] || '')).trim();
    Promise.resolve(c.rpc('online_report_tpl_set', { p_case: k, p_code: v })).then(function (r) {
      if (r && r.error) { S.msg = '저장하지 못했어요 — ' + errText(r.error); paint(); return; }
      var d = cfg(); d.tplSet = d.tplSet || {}; d.tpl = d.tpl || {}; d.tplSet[k] = v !== ''; d.tpl[k] = v;
      delete S.tplIn[k];
      Object.keys(S.tested).forEach(function (t) { if (t.split('|')[1] === k.slice(2) && t.split('|')[0] === (k[0] === 'p' ? 'parent' : 'student')) delete S.tested[t]; });   /* 코드가 바뀌면 그 경우는 시험을 다시 */
      S.msg = KEY_LABEL[k[0]] + ' · ' + caseLabel(k.slice(2), someMax()) + ' — ' + (v ? '저장했어요' : '비웠어요(등록 전)');
      paint();
    });
  }
  function saveSome() {
    var el = dlg.querySelector('[data-orp-some]'), v = Math.round(+(el && el.value));
    if (!(v >= 1 && v <= 6)) { S.msg = '1 ~ 6 사이로 넣어 주세요'; paint(); return; }
    Promise.resolve(sb().rpc('online_report_some_set', { p_n: v })).then(function (r) {
      if (r && r.error) { S.msg = '저장하지 못했어요 — ' + errText(r.error); paint(); return; }
      S.view = 'form'; load();
    });
  }

  /* ---------- 누르기 ---------- */
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-orp-close]')) { hide(); return; }
    var b;
    if ((b = t.closest('[data-orp-target]'))) { var v = b.getAttribute('data-orp-target'); if (v !== S.target) { S.target = v; S.msg = ''; defaultPick(); paint(); } return; }
    if ((b = t.closest('[data-orp-see]'))) { var id = b.getAttribute('data-orp-see'); S.open[id] = !S.open[id]; paint(); return; }
    if (t.closest('[data-orp-all]')) { rows().forEach(function (r) { if (!blockOf(r)) S.pick[r.id] = true; }); paint(); return; }
    if (t.closest('[data-orp-none]')) { S.pick = {}; paint(); return; }
    if (t.closest('[data-orp-test]')) { test(); return; }
    if (t.closest('[data-orp-go]')) { go(); return; }
    if ((b = t.closest('[data-orp-view]'))) { S.view = b.getAttribute('data-orp-view'); S.msg = ''; if (S.view === 'log') loadLog(); else paint(); return; }
    if ((b = t.closest('[data-orp-tsave]'))) { saveTpl(b.getAttribute('data-orp-tsave')); return; }
    if (t.closest('[data-orp-somesave]')) { saveSome(); return; }
  }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-orp-pick')) { S.pick[t.getAttribute('data-orp-pick')] = t.checked; paint(); return; }
    if (t.hasAttribute('data-orp-case')) {
      var id = t.getAttribute('data-orp-case'), r = rows().filter(function (x) { return x.id === id; })[0];
      S.cases[id] = t.value;
      if (r && !blockOf(r) && !sentOf(r)) S.pick[id] = true;
      paint(); return;
    }
    if (t.hasAttribute('data-orp-week')) { S.week = t.value; S.tested = {}; load(); return; }
    if (t.hasAttribute('data-orp-fb')) { S.fallback = t.checked; return; }
  }
  function onInput(e) { var t = e.target; if (t.hasAttribute('data-orp-tin')) S.tplIn[t.getAttribute('data-orp-tin')] = t.value; }

  function hide() { if (!dlg) return; if (global.Layer && Layer.hide) Layer.hide(dlg); else if (dlg.close) dlg.close(); }
  function open(cls) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'modal orp-modal'; dlg.id = 'orpModal'; dlg.setAttribute('aria-labelledby', 'orpTitle');
      document.body.appendChild(dlg);
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('change', onChange);
      dlg.addEventListener('input', onInput);
    }
    var t = today(), m = mondayOf(t);
    if (S.cls !== cls) { S.tested = {}; S.target = 'student'; }
    S.cls = cls; S.view = 'form'; S.busy = false; S.msg = ''; S.tplIn = {};
    S.week = new Date(t + 'T00:00:00Z').getUTCDay() === 1 ? addDays(m, -7) : m;   /* 월요일이면 지난주 · 아니면 이번 주 */
    paint();
    if (global.Layer && Layer.show) Layer.show(dlg);
    load();
  }
  function btnHtml(cls) {
    if (!cls) return '';
    return '<button type="button" class="btn btn--sm orp-open" data-orp-open="' + esc(cls) + '" title="이 반 학생 · 학부모에게 이번 주 레포트 알림톡 (미리보기 → 시험 발송 → 확인 → 발송)">📨 레포트 알림톡 보내기</button>';
  }
  if (global.document && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-orp-open]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      open(b.getAttribute('data-orp-open') || '');
    }, true);
  }

  global.OnlineReport = { open: open, btnHtml: btnHtml, state: function () { return S; }, caseLabel: caseLabel, mondayOf: mondayOf, fill: fill, blockOf: blockOf };
})(window);
