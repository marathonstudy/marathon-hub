/* ============================================================
   dday.js — 「D-day 문자」 매일 자동 발송 (20261110c · migration-094 · 095 · 함수 note-remind)
   문자 발송 → [D-day 문자]
     맨 위 — 「매일 06:00 · 오늘 보냄 n명 · 실패 n명」 · [일시정지] · [시험 발송](내 번호로만 · 오늘 글 한 통)
     발신번호 — 「D-day 문자 발신번호」(설정 · DB 에만 · 저장소에 없음) · 솔라피에 등록이 안 됐으면 「솔라피에 등록되지 않은 발신번호예요 · 등록 후 보낼 수 있어요」
     보내는 시각(기본 06:00 · 밤 쉬기 규칙 예외) · 문자 모양(기본 「{짧은이름} D-{n} {명언}」 · {학생이름} {짧은이름} {n} {명언}) · 단문 / 장문 미리 표시
     [미리보기 · 기록] 앞으로 7일(날짜 · 기준 D-day · D-n · 실제 글 · 대상 수 · 단문/장문) · 날짜별 보냄 · 실패(이유)
     [D-day 목록] 이름 · 짧은 이름 · 날짜 · 대상 학년(기본 전체) · [명언] 분야별 · 켜기/끄기 · 고치기 · 여러 줄 붙여 넣기
     [내 문장] 특정 날짜 · 특정 D-n 이면 명언 대신 · [받는 사람] 반별 켜기/끄기 · 학생별 받지 않기 · 번호 없음
   ============================================================ */
(function (global) {
  'use strict';

  function sb() { return SB.client; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, k) { if (global.UI && UI.toast) UI.toast(m, k); }
  function isMissing(e) { return /Could not find|does not exist|schema cache/i.test((e && e.message) || ''); }
  function bytes(t) { return global.Sms && Sms.bytes ? Sms.bytes(t) : String(t || '').replace(/[^\x01-\x7F]/g, 'xx').length; }
  function kindOf(t) { return bytes(t) > 90 ? 'LMS' : 'SMS'; }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function mdw(iso) { var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '(' + DOWK[d.getUTCDay()] + ')'; }
  var TPL_DEF = '{짧은이름} D-{n} {명언}';
  var UNREG = '솔라피에 등록되지 않은 발신번호예요 · 등록 후 보낼 수 있어요';
  var LMS_WARN = '장문(LMS)으로 나가요 · 비용이 더 들어요';

  var st = { tab: 'pv', status: null, list: [], quotes: [], mine: [], pv: null, missing: false, field: '', busy: false, editQ: 0, editD: '', loaded: false };

  /* 문자 한 줄 — 서버 _dday_text 와 같은 규칙 */
  function textOf(tpl, name, short, n, quote) {
    return String(tpl || '').split('{학생이름}').join(name || '').split('{짧은이름}').join(short || '').split('{n}').join(n === 0 ? 'DAY' : String(n)).split('{명언}').join(quote || '').replace(/ {2,}/g, ' ').trim();
  }
  function kindTag(t) {
    var b = bytes(t), k = b > 90;
    return '<span class="dd-kind ' + (k ? 'is-lms' : 'is-sms') + '" data-dd-kind="' + (k ? 'LMS' : 'SMS') + '">' + (k ? '장문' : '단문') + ' ' + b + '바이트</span>';
  }
  function grades() {
    var m = {};
    (UI.activeStudents ? UI.activeStudents() : []).forEach(function (s) { var g = String(s.grade || '').trim(); if (g) m[g] = 1; });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function classes() {
    var m = {};
    (UI.activeStudents ? UI.activeStudents() : []).forEach(function (s) { var c = String(s.className || '').trim(); if (c) m[c] = 1; });
    var n = Object.keys(m);
    return global.TodayView && TodayView.orderClasses ? TodayView.orderClasses(n) : n.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  /* ---------- 불러오기 ---------- */
  function load() {
    var c = sb();
    return Promise.all([
      Promise.resolve(c.rpc('dday_status')),
      Promise.resolve(c.from('dday_list').select('*').order('day')),
      Promise.resolve(c.from('dday_quotes').select('*').order('id')),
      Promise.resolve(c.from('dday_mine').select('*').order('created_at'))
    ]).then(function (x) {
      if (x[0].error) { st.missing = isMissing(x[0].error); st.err = x[0].error.message; st.status = null; return; }
      st.missing = false; st.err = '';
      st.status = x[0].data || null;
      st.list = (x[1] && x[1].data) || [];
      st.quotes = (x[2] && x[2].data) || [];
      st.mine = (x[3] && x[3].data) || [];
      st.loaded = true;
    });
  }
  function loadPv() {
    return Promise.resolve(sb().rpc('dday_preview', { p_days: 7 })).then(function (r) { st.pv = r.error ? { error: r.error.message } : r.data; }, function () { st.pv = { error: '불러오지 못했어요' }; });
  }

  /* ---------- 그리기 ---------- */
  function root() { return document.getElementById('ddayRoot'); }
  function headHtml() {
    var s = st.status, c = s.cfg, run = s.today_run;
    var line = '매일 <b class="num">' + esc(c.send_time) + '</b> · 오늘 보냄 <b class="num" id="ddSent">' + (s.today_sent || 0) + '</b>명 · 실패 <b class="num" id="ddFail">' + (s.today_failed || 0) + '</b>명' +
      (run ? ' · 번호 없음 ' + (run.nophone || 0) + '명' : '');
    var sstate = !c.sender ? '<p class="cp-warn dd-sender__w" id="ddSenderWarn">D-day 문자 발신번호를 넣어 주세요 · 넣기 전에는 보내지 않아요</p>'
      : c.sender_state === 'unregistered' ? '<p class="cp-warn dd-sender__w" id="ddSenderWarn">' + esc(UNREG) + '</p>'
      : c.sender_state === 'ok' ? '<p class="dd-sender__ok" id="ddSenderOk">솔라피 등록 확인됨</p>'
      : '<p class="dd-sender__u" id="ddSenderUnknown">아직 확인 전 · 보내는 시각에 솔라피 등록을 확인해요</p>';
    return '<div class="dd-head">' +
        '<div class="dd-head__l"><h2 class="panel__title">D-day 문자</h2><p class="dd-line" id="ddLine">' + line + '</p>' +
          (c.paused ? '<p class="cp-warn" id="ddPaused">일시정지 중 — 다시 시작할 때까지 보내지 않아요</p>' : '') + '</div>' +
        '<div class="dd-head__b"><button type="button" class="btn btn--sm' + (c.paused ? ' btn--primary' : '') + '" data-dd-pause>' + (c.paused ? '다시 시작' : '일시정지') + '</button>' +
          '<button type="button" class="btn btn--sm" data-dd-test>시험 발송</button></div>' +
      '</div>' +
      '<section class="dd-sec dd-sender"><label class="field"><span class="field__label">D-day 문자 발신번호 <span class="field__opt">D-day 문자만 이 번호로 · 다른 문자는 지금 번호 그대로</span></span>' +
        '<span class="dd-row"><input class="input num" id="ddSender" inputmode="tel" value="' + esc(c.sender) + '" placeholder="010-0000-0000"><button type="button" class="btn btn--sm" data-dd-sender>저장</button>' +
        (c.sender ? '<button type="button" class="btn btn--sm btn--ghost" data-dd-check>등록 다시 확인</button>' : '') + '</span></label>' + sstate + '</section>' +
      '<section class="dd-sec dd-cfg"><div class="dd-row"><label class="field dd-time"><span class="field__label">보내는 시각</span><input class="input num" type="time" id="ddTime" value="' + esc(c.send_time) + '"></label>' +
        '<span class="dd-night" id="ddNight">밤 쉬기 규칙 예외 — 이른 아침에도 보내요</span></div>' +
        '<label class="field"><span class="field__label">문자 모양 <span class="field__opt">쓸 수 있는 칸: {학생이름} {짧은이름} {n} {명언} · 당일은 D-DAY</span></span>' +
        '<textarea class="input" id="ddTpl" rows="2">' + esc(c.tpl) + '</textarea></label>' +
        '<p class="dd-sample" id="ddSample"></p>' +
        '<div class="dd-row"><button type="button" class="btn btn--sm btn--primary" data-dd-cfg>시각 · 모양 저장</button><button type="button" class="btn btn--sm btn--ghost" data-dd-tpldef>기본 모양으로</button></div></section>';
  }
  function sampleHtml(tpl) {
    var q = (st.quotes.filter(function (x) { return x.on_; })[0] || {}).body || '선은 결코 실패하지 않는 유일한 투자이다.';
    var t = textOf(tpl, '김마라', '수능', 80, q), k = kindOf(t);
    return '예) <b>' + esc(t) + '</b> ' + kindTag(t) + (k === 'LMS' ? ' <span class="dd-lmsw">' + esc(LMS_WARN) + '</span>' : '');
  }
  function tabsHtml() {
    var T = [['pv', '미리보기 · 기록'], ['list', 'D-day 목록'], ['quotes', '명언 ' + st.quotes.length], ['mine', '내 문장'], ['who', '받는 사람']];
    return '<div class="dd-tabs" role="tablist">' + T.map(function (t) {
      return '<button type="button" role="tab" class="chip' + (st.tab === t[0] ? ' is-on' : '') + '" data-dd-tab="' + t[0] + '" aria-selected="' + (st.tab === t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }
  function pvHtml() {
    var p = st.pv;
    var out = '<h3 class="dd-sub">앞으로 7일</h3>';
    if (!p) out += '<p class="panel__hint">불러오는 중…</p>';
    else if (p.error) out += '<p class="cp-warn">' + esc(p.error) + '</p>';
    else out += '<ol class="dd-pv" id="ddPv">' + (p.days || []).map(function (d) {
      var gs = d.groups || [];
      return '<li class="dd-pv__d"><div class="dd-pv__h"><b class="num">' + esc(mdw(d.day)) + '</b>' + (d.nophone ? ' <small class="dd-tag">번호 없음 ' + d.nophone + '명 뺌</small>' : '') + '</div>' +
        (gs.length ? gs.map(function (g) {
          return '<div class="dd-pv__g"><p class="dd-pv__m num">' + esc(g.dday) + ' · ' + (g.n === 0 ? 'D-DAY' : 'D-' + g.n) + ' · <b>' + g.count + '명</b>' + (g.mine ? ' · 내 문장' : '') + ' ' + kindTag(g.text) + '</p>' +
            '<p class="dd-pv__t">' + esc(g.text) + '</p>' + (g.kind === 'LMS' ? '<p class="dd-lmsw">' + esc(LMS_WARN) + '</p>' : '') + '</div>';
        }).join('') : '<p class="dd-pv__none">보낼 D-day 가 없어요 · 이날은 보내지 않아요</p>') + '</li>';
    }).join('') + '</ol>';
    var days = (st.status && st.status.days) || [];
    out += '<h3 class="dd-sub">보낸 기록</h3>' + (days.length ? '<ul class="dd-log" id="ddLog">' + days.map(function (d) {
      return '<li><b class="num">' + esc(mdw(String(d.day))) + '</b> · 보냄 ' + d.sent + '명' + (d.failed ? ' · <span class="dd-bad">실패 ' + d.failed + '명</span>' : '') +
        ((d.fails || []).length ? '<ul class="dd-log__f">' + d.fails.map(function (f) { return '<li>' + esc((f.name || '') + ' — ' + (f.error || '이유 모름')) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="panel__hint">아직 보낸 기록이 없어요</p>');
    return out;
  }
  function listHtml() {
    var gs = grades();
    var row = function (d) {
      var ed = st.editD === d.id;
      if (ed) return '<li class="dd-item is-edit">' + formD(d, gs) + '</li>';
      return '<li class="dd-item"><span class="dd-item__t"><b>' + esc(d.name) + '</b> <small>문자: ' + esc(d.short || d.name) + '</small></span><span class="num">' + esc(mdw(d.day)) + '</span>' +
        '<span class="dd-tag">' + esc((d.grades || []).length ? d.grades.join(' · ') : '전체') + '</span>' +
        '<span class="dd-item__b"><button type="button" class="btn btn--sm btn--ghost" data-dd-dedit="' + esc(d.id) + '">수정</button><button type="button" class="btn btn--sm btn--ghost" data-dd-ddel="' + esc(d.id) + '">삭제</button></span></li>';
    };
    return '<h3 class="dd-sub">D-day 목록 <small class="muted-note">학생마다 그 학년에 드는 것 중 오늘 이후 가장 먼저 오는 D-day · 당일은 D-DAY · 지나면 다음 것</small></h3>' +
      '<ul class="dd-items" id="ddList">' + st.list.map(row).join('') + '</ul>' +
      (st.editD === 'new' ? '<div class="dd-item is-edit">' + formD({ name: '', short: '', day: '', grades: [] }, gs) + '</div>' : '<button type="button" class="btn btn--sm" data-dd-dedit="new">+ D-day 추가</button>');
  }
  function formD(d, gs) {
    var on = d.grades || [];
    return '<div class="dd-form" data-dd-form="' + esc(d.id || 'new') + '">' +
      '<label class="field"><span class="field__label">이름</span><input class="input" data-dd-f="name" value="' + esc(d.name) + '" placeholder="예) 2027 수능"></label>' +
      '<label class="field"><span class="field__label">문자용 짧은 이름 <span class="field__opt">비우면 이름 그대로</span></span><input class="input" data-dd-f="short" value="' + esc(d.short) + '" placeholder="예) 수능 · 6평 · 9평 · 3모"></label>' +
      '<label class="field"><span class="field__label">날짜</span><input class="input" type="date" data-dd-f="day" value="' + esc(d.day) + '"></label>' +
      '<div class="field"><span class="field__label">대상 학년 <span class="field__opt">고르지 않으면 「전체」</span></span><div class="dd-grades">' +
        gs.map(function (g) { return '<label class="chk-inline"><input type="checkbox" data-dd-g value="' + esc(g) + '"' + (on.indexOf(g) !== -1 ? ' checked' : '') + '> ' + esc(g) + '</label>'; }).join('') +
        (gs.length ? '' : '<span class="muted-note">학생 학년이 아직 없어요 — 전체로 보냅니다</span>') + '</div></div>' +
      '<div class="dd-row"><button type="button" class="btn btn--sm btn--primary" data-dd-dsave>저장</button><button type="button" class="btn btn--sm" data-dd-dcancel>취소</button></div></div>';
  }
  function fieldsOf() { var m = {}; st.quotes.forEach(function (q) { var f = q.field || '기타'; m[f] = (m[f] || 0) + 1; }); return m; }
  function quotesHtml() {
    var fm = fieldsOf(), names = Object.keys(fm).sort(function (a, b) { return fm[b] - fm[a]; });
    var list = st.quotes.filter(function (q) { return !st.field || (q.field || '기타') === st.field; });
    var on = st.quotes.filter(function (q) { return q.on_; }).length, lms = st.quotes.filter(function (q) { return kindOf(textOf((st.status && st.status.cfg.tpl) || TPL_DEF, '김마라', '수능', 80, q.body)) === 'LMS'; }).length;
    return '<h3 class="dd-sub">오늘의 명언 <small class="muted-note num">전체 ' + st.quotes.length + ' · 켜짐 ' + on + ' · 장문 ' + lms + ' · 이번 바퀴 남은 것 ' + ((st.status && st.status.quotes && st.status.quotes.left) || 0) + '</small></h3>' +
      '<p class="panel__hint">하루 한 명언 · 모든 학생이 같은 명언 · 켜진 명언을 한 바퀴 다 쓰기 전에는 다시 나오지 않아요</p>' +
      '<div class="dd-fields" role="group" aria-label="분야"><button type="button" class="chip' + (!st.field ? ' is-on' : '') + '" data-dd-field="">전체 ' + st.quotes.length + '</button>' +
        names.map(function (n) { return '<button type="button" class="chip' + (st.field === n ? ' is-on' : '') + '" data-dd-field="' + esc(n) + '">' + esc(n) + ' ' + fm[n] + '</button>'; }).join('') + '</div>' +
      '<details class="dd-add"><summary>명언 추가 (여러 줄 붙여 넣기 · 한 줄에 하나)</summary>' +
        '<textarea class="input" id="ddQLines" rows="4" placeholder="한 줄에 명언 하나씩"></textarea>' +
        '<div class="dd-row"><input class="input" id="ddQField" placeholder="분야 (예: 공부)" value="' + esc(st.field) + '"><input class="input" id="ddQAuthor" placeholder="인물 (모르면 비워 두기)"><button type="button" class="btn btn--sm btn--primary" data-dd-qadd>추가</button></div></details>' +
      '<ul class="dd-quotes" id="ddQuotes">' + list.slice(0, st.qAll ? list.length : 60).map(function (q) {
        if (st.editQ === q.id) return '<li class="dd-q is-edit"><textarea class="input" data-dd-qf="body" rows="2">' + esc(q.body) + '</textarea>' +
          '<div class="dd-row"><input class="input" data-dd-qf="field" value="' + esc(q.field) + '" placeholder="분야"><input class="input" data-dd-qf="author" value="' + esc(q.author) + '" placeholder="인물"></div>' +
          '<div class="dd-row"><button type="button" class="btn btn--sm btn--primary" data-dd-qsave="' + q.id + '">저장</button><button type="button" class="btn btn--sm" data-dd-qcancel>취소</button><button type="button" class="btn btn--sm btn--ghost" data-dd-qdel="' + q.id + '">삭제</button></div></li>';
        var t = textOf((st.status && st.status.cfg.tpl) || TPL_DEF, '김마라', '수능', 80, q.body);
        return '<li class="dd-q' + (q.on_ ? '' : ' is-off') + '"><label class="dd-q__on"><input type="checkbox" data-dd-qon="' + q.id + '"' + (q.on_ ? ' checked' : '') + ' aria-label="켜기"></label>' +
          '<span class="dd-q__b">' + esc(q.body) + '<small class="dd-q__m">' + esc([q.field, q.author].filter(Boolean).join(' · ')) + ' ' + kindTag(t) + '</small></span>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-dd-qedit="' + q.id + '">고치기</button></li>';
      }).join('') + '</ul>' +
      (!st.qAll && list.length > 60 ? '<button type="button" class="btn btn--sm" data-dd-qall>모두 보기 (' + list.length + '개)</button>' : '');
  }
  function mineHtml() {
    return '<h3 class="dd-sub">내 문장 <small class="muted-note">이 날짜 · 이 D-n 이면 명언 대신 이 문장이 나가요 (날짜가 먼저)</small></h3>' +
      '<ul class="dd-items" id="ddMine">' + st.mine.map(function (m) {
        var when = m.on_date ? mdw(m.on_date) : (m.on_n === 0 ? 'D-DAY' : 'D-' + m.on_n);
        return '<li class="dd-item' + (m.on_ ? '' : ' is-off') + '"><span class="dd-tag num">' + esc(when) + '</span><span class="dd-item__t">' + esc(m.body) + ' ' + kindTag(textOf((st.status && st.status.cfg.tpl) || TPL_DEF, '김마라', '수능', 80, m.body)) + '</span>' +
          '<span class="dd-item__b"><button type="button" class="btn btn--sm btn--ghost" data-dd-mdel="' + esc(m.id) + '">삭제</button></span></li>';
      }).join('') + '</ul>' +
      '<div class="dd-form" id="ddMineForm"><label class="field"><span class="field__label">내 문장</span><textarea class="input" id="ddMBody" rows="2" placeholder="예) 오늘부터 100일, 같이 달려 봐요."></textarea></label>' +
      '<div class="dd-row"><label class="field"><span class="field__label">날짜</span><input class="input" type="date" id="ddMDate"></label><span class="muted-note">또는</span>' +
      '<label class="field"><span class="field__label">D-n <span class="field__opt">0 = D-DAY</span></span><input class="input num" id="ddMN" inputmode="numeric" placeholder="100"></label></div>' +
      '<button type="button" class="btn btn--sm btn--primary" data-dd-madd>내 문장 추가</button></div>';
  }
  function whoHtml() {
    var c = st.status.cfg, offC = c.classes_off || [], offS = c.students_off || [];
    var np = {}; (st.status.nophone || []).forEach(function (x) { np[x.id] = 1; });
    var all = UI.activeStudents ? UI.activeStudents() : [];
    return '<h3 class="dd-sub">받는 사람 <small class="muted-note">재원 중인 학생 본인만 (학부모 제외) · 번호 없는 학생은 빠져요</small></h3>' +
      '<ul class="dd-cls" id="ddWho">' + classes().map(function (cl) {
        var on = offC.indexOf(cl) === -1, ss = all.filter(function (s) { return (s.className || '').trim() === cl; });
        return '<li class="dd-cls__i"><label class="dd-cls__h"><input type="checkbox" data-dd-clson="' + esc(cl) + '"' + (on ? ' checked' : '') + '> <b>' + esc(cl) + '</b> <small class="num">' + ss.length + '명</small></label>' +
          (on ? '<div class="dd-stu">' + ss.map(function (s) {
            var off = offS.indexOf(s.id) !== -1;
            return '<label class="dd-stu__i' + (off ? ' is-off' : '') + '"><input type="checkbox" data-dd-stuon="' + esc(s.id) + '"' + (off ? '' : ' checked') + '> ' + esc(s.name) +
              (np[s.id] ? ' <small class="dd-tag is-mute" data-dd-nophone>번호 없음</small>' : '') + '</label>';
          }).join('') + '</div>' : '<p class="muted-note">이 반은 받지 않아요</p>') + '</li>';
      }).join('') + '</ul>';
  }
  function paint() {
    var r = root();
    if (!r) return;
    if (st.missing) { r.innerHTML = '<p class="cp-warn">migration-094 SQL 을 먼저 실행해 주세요 (D-day 문자).</p>'; return; }
    if (!st.status) { r.innerHTML = '<p class="cp-warn">' + esc(st.err || '불러오지 못했어요') + '</p>'; return; }
    var body = st.tab === 'list' ? listHtml() : st.tab === 'quotes' ? quotesHtml() : st.tab === 'mine' ? mineHtml() : st.tab === 'who' ? whoHtml() : pvHtml();
    var tplNow = document.getElementById('ddTpl') ? document.getElementById('ddTpl').value : null;
    r.innerHTML = headHtml() + tabsHtml() + '<section class="dd-sec dd-body" id="ddBody">' + body + '</section>';
    if (tplNow != null) document.getElementById('ddTpl').value = tplNow;
    document.getElementById('ddSample').innerHTML = sampleHtml(document.getElementById('ddTpl').value);
  }
  function refresh(pv) { return load().then(function () { if (pv || st.tab === 'pv') return loadPv(); }).then(paint); }

  /* ---------- 저장 ---------- */
  function cfgSave(p, msg) {
    return Promise.resolve(sb().rpc('dday_cfg_save', { p: p })).then(function (r) {
      if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.message) || (r.error && r.error.message) || '저장하지 못했어요', 'bad'); return false; }
      if (msg) toast(msg, 'good');
      return refresh(true).then(function () { return true; });
    });
  }
  function fn(body) {
    return Promise.resolve(sb().functions.invoke('note-remind', { body: body })).then(function (r) {
      if (!r.error) return r.data || {};
      var ctx = r.error.context;
      return ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return { ok: false, message: 'note-remind 함수를 부르지 못했어요' }; }) : { ok: false, message: 'note-remind 함수를 부르지 못했어요' };
    }, function () { return { ok: false, message: 'note-remind 함수를 부르지 못했어요' }; });
  }
  function testSend() {
    var ph = global.Sms && Sms.myPhone ? Sms.myPhone() || '' : '';
    var run = function (phone) {
      var go = function () { return fn({ action: 'dday', op: 'test' }); };
      return global.Sms && Sms.testTo ? Sms.testTo(phone, go) : go();
    };
    /* 확인 창의 「먼저 나에게 보내 보기」 칸으로 — 번호를 넣고 [보내 보기] (학생에게는 가지 않는다) */
    return UI.confirmAsk('D-day 문자 시험 발송', '오늘 나갈 D-day 문자를 내 번호로만 한 통 보냅니다. 아래에 번호를 넣고 [보내 보기]를 누르세요. 학생에게는 가지 않아요.', '닫기', null,
      { test: { phone: ph, run: run } }).then(function () { refresh(); });
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest || !t.closest('#ddayRoot')) return;
    var c = sb();
    var tb = t.closest('[data-dd-tab]');
    if (tb) { st.tab = tb.getAttribute('data-dd-tab'); if (st.tab === 'pv') { st.pv = null; paint(); loadPv().then(paint); } else paint(); return; }
    if (t.closest('[data-dd-pause]')) { cfgSave({ paused: !st.status.cfg.paused }, st.status.cfg.paused ? '다시 보내요' : '일시정지했어요'); return; }
    if (t.closest('[data-dd-test]')) { testSend(); return; }
    if (t.closest('[data-dd-sender]')) { cfgSave({ sender: document.getElementById('ddSender').value }, '발신번호를 저장했어요 · 보내는 시각에 솔라피 등록을 확인해요'); return; }
    if (t.closest('[data-dd-check]')) { fn({ action: 'dday', op: 'check' }).then(function (r) { toast(r.ok ? (r.sender_state === 'ok' ? '솔라피 등록 확인됨' : r.sender_state === 'unregistered' ? UNREG : '솔라피가 답하지 않아 확인하지 못했어요') : (r.message || '확인하지 못했어요'), r.ok && r.sender_state === 'ok' ? 'good' : 'bad'); refresh(); }); return; }
    if (t.closest('[data-dd-cfg]')) { cfgSave({ send_time: document.getElementById('ddTime').value, tpl: document.getElementById('ddTpl').value }, '저장했어요'); return; }
    if (t.closest('[data-dd-tpldef]')) { document.getElementById('ddTpl').value = TPL_DEF; document.getElementById('ddSample').innerHTML = sampleHtml(TPL_DEF); return; }
    /* D-day 목록 */
    var de = t.closest('[data-dd-dedit]');
    if (de) { st.editD = de.getAttribute('data-dd-dedit'); paint(); return; }
    if (t.closest('[data-dd-dcancel]')) { st.editD = ''; paint(); return; }
    if (t.closest('[data-dd-dsave]')) {
      var f = t.closest('[data-dd-form]'), id = f.getAttribute('data-dd-form');
      var v = function (k) { return (f.querySelector('[data-dd-f="' + k + '"]').value || '').trim(); };
      var row = { name: v('name'), short: v('short'), day: v('day'), grades: Array.prototype.map.call(f.querySelectorAll('[data-dd-g]:checked'), function (x) { return x.value; }) };
      if (!row.name || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) { toast('이름과 날짜를 넣어 주세요', 'bad'); return; }
      var q = id === 'new' ? c.from('dday_list').insert(row) : c.from('dday_list').update(row).eq('id', id);
      Promise.resolve(q).then(function (r) { if (r && r.error) { toast('저장하지 못했어요 — ' + r.error.message, 'bad'); return; } st.editD = ''; toast('D-day 를 저장했어요', 'good'); refresh(true); });
      return;
    }
    var dd = t.closest('[data-dd-ddel]');
    if (dd) {
      UI.confirmAsk('D-day 삭제', '이 D-day 를 지웁니다.', '삭제').then(function (y) { if (!y) return; Promise.resolve(c.from('dday_list').delete().eq('id', dd.getAttribute('data-dd-ddel'))).then(function () { refresh(true); }); });
      return;
    }
    /* 명언 */
    var fb = t.closest('[data-dd-field]');
    if (fb) { st.field = fb.getAttribute('data-dd-field'); st.qAll = false; paint(); return; }
    if (t.closest('[data-dd-qall]')) { st.qAll = true; paint(); return; }
    var qe = t.closest('[data-dd-qedit]');
    if (qe) { st.editQ = +qe.getAttribute('data-dd-qedit'); paint(); return; }
    if (t.closest('[data-dd-qcancel]')) { st.editQ = 0; paint(); return; }
    var qs = t.closest('[data-dd-qsave]');
    if (qs) {
      var li = qs.closest('li'), g = function (k) { return li.querySelector('[data-dd-qf="' + k + '"]').value.trim(); };
      if (!g('body')) { toast('명언을 적어 주세요', 'bad'); return; }
      Promise.resolve(c.from('dday_quotes').update({ body: g('body'), field: g('field'), author: g('author') }).eq('id', +qs.getAttribute('data-dd-qsave'))).then(function (r) {
        if (r && r.error) { toast('저장하지 못했어요 — ' + r.error.message, 'bad'); return; } st.editQ = 0; refresh();
      });
      return;
    }
    var qd = t.closest('[data-dd-qdel]');
    if (qd) { UI.confirmAsk('명언 삭제', '이 명언을 지웁니다. (끄기만 하려면 왼쪽 체크를 빼세요)', '삭제').then(function (y) { if (!y) return; Promise.resolve(c.from('dday_quotes').delete().eq('id', +qd.getAttribute('data-dd-qdel'))).then(function () { st.editQ = 0; refresh(); }); }); return; }
    if (t.closest('[data-dd-qadd]')) {
      var lines = document.getElementById('ddQLines').value;
      if (!lines.trim()) { toast('명언을 붙여 넣어 주세요', 'bad'); return; }
      Promise.resolve(c.rpc('dday_quote_add', { p_lines: lines, p_field: document.getElementById('ddQField').value, p_author: document.getElementById('ddQAuthor').value })).then(function (r) {
        if (r.error) { toast('추가하지 못했어요 — ' + r.error.message, 'bad'); return; }
        toast(r.data.added + '개 추가했어요' + (r.data.lines > r.data.added ? ' · 이미 있는 ' + (r.data.lines - r.data.added) + '개는 건너뜀' : ''), 'good');
        refresh();
      });
      return;
    }
    /* 내 문장 */
    if (t.closest('[data-dd-madd]')) {
      var body = document.getElementById('ddMBody').value.trim(), dt = document.getElementById('ddMDate').value, nn = document.getElementById('ddMN').value.trim();
      if (!body || (!dt && !/^\d{1,3}$/.test(nn))) { toast('문장과 날짜 또는 D-n 을 넣어 주세요', 'bad'); return; }
      Promise.resolve(c.from('dday_mine').insert({ body: body, on_date: dt || null, on_n: dt ? null : +nn })).then(function (r) {
        if (r && r.error) { toast('저장하지 못했어요 — ' + r.error.message, 'bad'); return; } toast('내 문장을 넣었어요', 'good'); refresh(true);
      });
      return;
    }
    var md = t.closest('[data-dd-mdel]');
    if (md) { Promise.resolve(c.from('dday_mine').delete().eq('id', md.getAttribute('data-dd-mdel'))).then(function () { refresh(true); }); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t.closest || !t.closest('#ddayRoot')) return;
    var qo = t.closest('[data-dd-qon]');
    if (qo) { Promise.resolve(sb().from('dday_quotes').update({ on_: qo.checked }).eq('id', +qo.getAttribute('data-dd-qon'))).then(function () { var q = st.quotes.find(function (x) { return x.id === +qo.getAttribute('data-dd-qon'); }); if (q) q.on_ = qo.checked; paint(); }); return; }
    var co = t.closest('[data-dd-clson]');
    if (co) {
      var off = (st.status.cfg.classes_off || []).filter(function (x) { return x !== co.getAttribute('data-dd-clson'); });
      if (!co.checked) off.push(co.getAttribute('data-dd-clson'));
      cfgSave({ classes_off: off }); return;
    }
    var so = t.closest('[data-dd-stuon]');
    if (so) {
      var offs = (st.status.cfg.students_off || []).filter(function (x) { return x !== so.getAttribute('data-dd-stuon'); });
      if (!so.checked) offs.push(so.getAttribute('data-dd-stuon'));
      cfgSave({ students_off: offs }); return;
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'ddTpl') { var s = document.getElementById('ddSample'); if (s) s.innerHTML = sampleHtml(e.target.value); }
  });

  function open() { st.pv = null; if (root()) root().innerHTML = '<p class="panel__hint">불러오는 중…</p>'; return refresh(true); }
  global.Dday = { open: open, textOf: textOf, kindOf: kindOf, _st: function () { return st; } };
})(window);
