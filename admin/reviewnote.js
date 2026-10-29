/* ============================================================
   reviewnote.js — 복습 노트 만들기 → 고치기 → 확정 (레포트 발송 → 1 작성 「반 공통」 · 20261031l · migration-039)

   「수업 내용」 제목 줄의 [📒 복습 노트 만들기] — 「✨ 영상 자막으로 채우기」에 넣은 그 수업 자막(같은 자료)으로 초안
     자막이 없으면 「영상 자막을 먼저 넣어 주세요」 + 자막 칸을 펼친다 (자막은 저장하지 않는다 — 이 화면 메모리에만)
   AI 는 Edge Function lesson-summary 의 복습 노트 모드 (Sonnet · 수업 요약과 같은 월 상한)
   차시마다 칸: 오늘의 한 줄 · 다룬 지문 · 현장 행동 강령 · 이렇게 적용했다 · 자주 하는 실수 · 꼭 기억할 말 (칸마다 [다시 만들기])
     확실하지 않은 칸은 비워 두고 「자막에서 확인 안 됨」
   맨 아래 OX 4~6문항 — 문항마다 [지우기] · [OX 다시 만들기] · [OX 빼기] · 좋은 문항이 4개 미만이면 「이번 수업은 OX 없음」
   [AI로 다듬기] · [다시 만들기] · [임시 저장] · [확정] — 확정해야 학생 · 학부모 화면(러닝노트)에 나온다
   「AI에게 고쳐 달라고 하기」(20261031p) — 칸은 그대로 손으로 고치고, 요청(빠른 버튼 · 300자)대로 지금 노트를 고친다 (lesson-summary polish + request)
     [한 단계 전으로] · 「이 요청을 이 반 기본으로 기억하기」(aipolish.js memAdd · migration-043) — 다음 [복습 노트 만들기]부터 처음부터 따른다
     확정 뒤 고치면 「다시 공개해야 반영됩니다」 → [고친 내용으로 다시 확정]
   과정(고3) 회차 — 「§과정」 칸에서 한 번 만들고 확정하면 그 회차의 모든 반 레포트에 들어간다
   「오늘」 반 카드 — 「이번 복습 노트 연 학생 8/11」(반 전체 숫자만 · 누가 열었는지 · OX 점수는 없다)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }
  var NEED_SQL = 'migration-039 SQL 을 먼저 실행해 주세요.';
  var FIELDS = [
    ['oneLine', '오늘의 한 줄', '그 차시 핵심을 한 문장으로'],
    ['passages', '다룬 지문', '한 줄에 하나 — 시행 연월 · 작품/지문 이름'],
    ['actions', '현장 행동 강령', '한 줄에 하나 — 시험장에서 쓸 행동 3~5개'],
    ['applied', '이렇게 적용했다', '한 줄에 하나 — 지문 이름 — 적용한 방법'],
    ['mistakes', '자주 하는 실수', '한 줄에 하나 — 「이러면 틀린다」'],
    ['remember', '꼭 기억할 말', '한 줄에 하나 — 선생님이 강조한 문장 1~2개']
  ];
  var UNSURE = '자막에서 확인 안 됨';

  var st = { cls: '', week: '', key: '', row: null, edit: null, busy: '', missing: false, req: '', remember: false, hist: [] };

  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function lines(v) { return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean); }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function current() {
    if (st.edit) return st.edit;
    var r = st.row;
    if (!r) return null;
    return r.status === 'confirmed' && r.confirmed ? r.confirmed : r.draft;
  }
  function confirmedEdited() { return !!(st.row && st.row.status === 'confirmed' && st.edit && JSON.stringify(st.edit) !== JSON.stringify(st.row.confirmed)); }
  function isCourse() { return st.cls.charAt(0) === '§' && !!window.Course; }
  function courseArgs() {
    if (!isCourse()) return { p_course: null, p_no: null };
    var c = Course.byKey(st.cls);
    return c ? { p_course: c.id, p_no: Course.roundOfWeek(c, st.week) } : { p_course: null, p_no: null };
  }
  function lessonDate() {
    if (isCourse() || !window.Store || !Store.lessonOf) return null;
    var L = Store.lessonOf(st.cls, st.week);
    return L && L.date && !L.canceled ? L.date : null;
  }

  /* ---------- 불러오기 · 그리기 ---------- */
  function render(cls, week) {
    if (!$('#rnSub')) return;
    var key = (cls || '') + '|' + (week || '');
    st.cls = cls || ''; st.week = week || '';
    if (key === st.key) return;
    st.key = key; st.row = null; st.edit = null; st.hist = []; st.req = '';
    draw();
    load();
  }
  function load() {
    var key = st.key;
    if (!st.cls || !st.week || !window.SB || !SB.client) { draw(); return Promise.resolve(); }
    return sb().from('review_notes').select('*').eq('class_name', st.cls).eq('week_start', st.week).then(function (r) {
      if (key !== st.key) return;
      st.missing = !!(r.error && isMissing(r.error));
      st.row = (r.data && r.data[0]) || null;
      st.edit = null;
      draw();
    });
  }

  function badgeHtml() {
    var r = st.row;
    if (!r) return '';
    if (r.status === 'confirmed' && !st.edit) return '<span class="ai-badge ai-badge--ok">확정됨 · ' + esc(r.confirmed_by) + ' · ' + fmtDT(r.confirmed_at) + ' · 학생 · 학부모 화면에 보임</span>';
    if (confirmedEdited()) return '<span class="ai-badge rn-badge--warn">확정 뒤 고침 — 다시 공개해야 반영됩니다</span>';
    return '<span class="ai-badge">초안 · 확인 필요' + (r.draft_by ? ' · ' + esc(r.draft_by) + ' ' + fmtDT(r.draft_at) : '') + ' · 아직 학생 화면에 안 보임</span>';
  }
  function fieldHtml(l, i, f) {
    var k = f[0], unsure = lines(l.unsure).indexOf(k) !== -1, v = k === 'oneLine' ? String(l.oneLine || '') : lines(l[k]).join('\n');
    var empty = !v.trim();
    var input = k === 'oneLine'
      ? '<input class="input rn-ed__in" type="text" maxlength="300" data-rn-f="' + i + '|' + k + '" value="' + esc(v) + '" placeholder="' + esc(empty && unsure ? UNSURE : f[2]) + '">'
      : '<textarea class="textarea rn-ed__in" rows="' + Math.max(2, Math.min(8, v.split('\n').length + (k === 'applied' ? 1 : 0))) + '" data-rn-f="' + i + '|' + k + '" placeholder="' + esc(empty && unsure ? UNSURE : f[2]) + '">' + esc(v) + '</textarea>';
    return '<div class="rn-ed__f">' +
      '<div class="rn-ed__fh"><span class="rn-ed__lab">' + f[1] + '</span>' +
        (empty && unsure ? '<span class="rn-ed__unsure">' + UNSURE + '</span>' : '') +
        '<button type="button" class="btn btn--sm btn--ghost rn-ed__re" data-rn-regen="' + i + '|' + k + '"' + (st.busy ? ' disabled' : '') + '>다시 만들기</button></div>' +
      input + '</div>';
  }
  function quizHtml(n) {
    var qs = Array.isArray(n.quiz) ? n.quiz : [];
    var head = '<div class="rn-ed__qh"><span class="sub__title">OX 퀴즈</span>' +
      (n.quizOff ? '<span class="rn-ed__unsure">OX 뺌 — 학생 화면에 안 나옴</span>' : n.quizNone || !qs.length ? '<span class="rn-ed__unsure">이번 수업은 OX 없음</span>' : '<span class="muted-note num">' + qs.length + '문항</span>') +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-rn-act="quiz"' + (st.busy ? ' disabled' : '') + '>OX 다시 만들기</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-rn-act="' + (n.quizOff ? 'quizon' : 'quizoff') + '">' + (n.quizOff ? 'OX 넣기' : 'OX 빼기') + '</button></div>';
    if (n.quizOff) return '<div class="rn-ed__quiz is-off">' + head + '</div>';
    return '<div class="rn-ed__quiz">' + head +
      '<p class="muted-note">수업의 큰 원칙(행동 강령)만 묻습니다 — 작품 · 지문 이름, 연월, 숫자, 특정 구절이 든 문항은 빼 주세요. 「그 지문을 안 봐도 수업을 들었다면 풀 수 있는가」</p>' +
      qs.map(function (q, i) {
        return '<div class="rn-ed__q" data-rn-q="' + i + '">' +
          '<span class="rn-ed__qn num">' + (i + 1) + '</span>' +
          '<textarea class="textarea rn-ed__qt" rows="2" data-rn-qf="' + i + '|q" maxlength="200" aria-label="' + (i + 1) + '번 문항">' + esc(q.q) + '</textarea>' +
          '<select class="input rn-ed__qa" data-rn-qf="' + i + '|a" aria-label="' + (i + 1) + '번 정답"><option value="O"' + (q.a === 'O' ? ' selected' : '') + '>O</option><option value="X"' + (q.a === 'X' ? ' selected' : '') + '>X</option></select>' +
          '<input class="input rn-ed__qw" type="text" maxlength="200" data-rn-qf="' + i + '|why" value="' + esc(q.why) + '" placeholder="해설 한 줄 (X 는 바른 행동 강령)" aria-label="' + (i + 1) + '번 해설">' +
          '<button type="button" class="btn btn--sm btn--ghost" data-rn-qdel="' + i + '">지우기</button>' +
        '</div>';
      }).join('') + '</div>';
  }
  function draw() {
    var body = $('#rnBody'), btn = $('#btnRnMake');
    if (!body) return;
    var n = current(), r = st.row;
    if (btn) {
      btn.textContent = !r ? '📒 복습 노트 만들기' : r.status === 'confirmed' && !st.edit ? '📒 복습 노트 확정됨' : '📒 복습 노트 초안 · 확인 필요';
      btn.classList.toggle('ai-open--draft', !!r && (r.status === 'draft' || !!st.edit));
      btn.classList.toggle('ai-open--ok', !!r && r.status === 'confirmed' && !st.edit);
    }
    $('#rnSub').hidden = !st.cls;
    if (st.missing) { body.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    if (!n || !Array.isArray(n.lessons) || !n.lessons.length) {
      body.innerHTML = st.busy === 'make' ? '<p class="panel__hint"><i class="spin" aria-hidden="true"></i> 복습 노트를 만드는 중입니다… 1~2분 걸립니다. 창을 닫지 마세요.</p>'
        : '<p class="panel__hint">위 [📒 복습 노트 만들기]를 누르면 「✨ 영상 자막으로 채우기」에 넣은 자막으로 차시마다 한 장 요약 + OX 퀴즈 초안을 만듭니다. 고친 뒤 [확정]해야 학생 · 학부모 화면에 나옵니다.</p>';
      return;
    }
    var confirmed = r && r.status === 'confirmed' && !st.edit;
    body.innerHTML = '<div class="rn-ed' + (confirmed ? ' is-ok' : '') + '">' +
      '<div class="ai-result__head">' + badgeHtml() + (st.busy ? '<span class="muted-note"><i class="spin" aria-hidden="true"></i> AI 가 쓰는 중…</span>' : '') + '</div>' +
      (r && r.draft_note && !confirmed ? '<p class="ai-note">⚠️ AI 확인 메모: ' + esc(r.draft_note) + '</p>' : '') +
      (confirmedEdited() ? '<p class="rn-ed__warn">확정한 뒤 고쳤습니다 — 다시 공개해야 반영됩니다. [고친 내용으로 다시 확정]을 눌러 주세요.</p>' : '') +
      n.lessons.map(function (l, i) {
        return '<div class="rn-ed__l" data-rn-l="' + i + '"><div class="rn-ed__lh">' + (i + 1) + '차시</div>' + FIELDS.map(function (f) { return fieldHtml(l, i, f); }).join('') + '</div>';
      }).join('') +
      quizHtml(n) +
      '<div class="wk-edit__btns rn-ed__btns">' +
        '<button class="btn btn--sm" type="button" data-rn-act="polish"' + (st.busy ? ' disabled' : '') + '>AI로 다듬기</button>' +
        '<button class="btn btn--sm" type="button" data-rn-act="remake"' + (st.busy ? ' disabled' : '') + '>다시 만들기</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-rn-act="save"' + (st.edit ? '' : ' disabled') + '>임시 저장</button>' +
        '<div class="spacer"></div>' +
        (r && r.status === 'confirmed' ? '<button class="btn btn--sm btn--ghost" type="button" data-rn-act="unconfirm">확정 취소</button>'
          : '<button class="btn btn--sm btn--ghost" type="button" data-rn-act="discard">초안 지우기</button>') +
        '<button class="btn btn--sm btn--primary" type="button" data-rn-act="confirm"' + (st.busy ? ' disabled' : '') + '>' + (r && r.confirmed ? (confirmed ? '다시 확정' : '고친 내용으로 다시 확정') : '확정') + '</button>' +
      '</div>' +
      askHtml() +
      '<p class="panel__hint">[확정]하면 러닝노트 레포트(수업 영상 아래) · 「복습 노트 모음」에 나옵니다' + (isCourse() ? ' — 과정이라 이 회차의 모든 반 레포트에 들어갑니다' : '') + '. 학부모에게 풀었는지는 알리지 않습니다.</p>' +
    '</div>';
  }

  /* 「AI에게 고쳐 달라고 하기」 — 다른 AI 칸과 같은 모양 (aipolish.js 의 빠른 버튼 · 반 기본 요청) */
  function scopeLabel() { return isCourse() ? '과정' : '반'; }
  function memList() { return window.AiPolish && st.cls ? AiPolish.memOf(st.cls) : []; }
  function withMem(b) {
    if (!window.AiPolish || !st.cls) return Promise.resolve(b);
    return AiPolish.memLoad(st.cls).then(function (l) { if (l.length) b.requests = l.map(function (x) { return x.request; }); return b; });
  }
  function askHtml() {
    var A = window.AiPolish, max = A ? A.MAX_REQ : 300, ms = memList();
    return '<div class="aip-ask rn-ask" role="group" aria-label="AI에게 고쳐 달라고 하기"><div class="aip-ask__t">AI에게 고쳐 달라고 하기</div>' +
      '<div class="aip-quick">' + (A ? A.QUICK : []).filter(function (q) { return !q[2]; }).map(function (q) {
        return '<button type="button" class="aip-q" data-rn-q="' + esc(q[1]) + '"' + (st.busy ? ' disabled' : '') + '>' + esc(q[0]) + '</button>';
      }).join('') + '</div>' +
      '<textarea class="textarea aip-req" id="rnReq" rows="2" maxlength="' + max + '" placeholder="예: 행동 강령은 세 줄로 줄이고, 자주 하는 실수는 더 쉽게 써 줘" aria-label="어떻게 고칠지">' + esc(st.req) + '</textarea>' +
      (ms.length ? '<div class="aip-mem"><span class="aip-mem__t">이 ' + scopeLabel() + ' 기본 요청</span>' + ms.map(function (x) {
        return '<span class="aip-mem__c">' + esc(x.request) + '<button type="button" class="aip-mem__x" data-rn-memdel="' + esc(x.id) + '" aria-label="' + esc('「' + x.request + '」 지우기') + '">×</button></span>';
      }).join('') + '</div>' : '') +
      '<label class="aip-remember"><input type="checkbox" id="rnRemember"' + (st.remember ? ' checked' : '') + '> 이 요청을 이 ' + scopeLabel() + ' 기본으로 기억하기</label>' +
      '<div class="aip-ask__acts"><button type="button" class="btn btn--sm btn--primary" data-rn-act="revise" id="rnRevise"' + (st.busy || st.req.trim().length < 2 ? ' disabled' : '') + '>' + (st.busy === 'revise' ? '고치는 중…' : '이대로 고치기') + '</button>' +
        (st.hist.length ? '<button type="button" class="btn btn--sm btn--ghost" data-rn-act="back" id="rnBack"' + (st.busy ? ' disabled' : '') + '>한 단계 전으로</button>' : '') +
        '<span class="muted-note aip-req-n num" id="rnReqN">' + st.req.length + '/' + max + '</span></div></div>';
  }
  function reviseNote() {
    if (st.busy) return;
    var req = st.req.replace(/\s+/g, ' ').trim();
    if (req.length < 2) { toast('어떻게 고칠지 적어 주세요', 'bad'); return; }
    var n = readDom(), key = st.key, cls = st.cls, remember = st.remember;
    st.hist.push(clone(n));
    st.edit = n; st.busy = 'revise'; draw();
    var b = base('polish', null); b.lessons = Math.min(4, Math.max(1, n.lessons.length)); b.note = { lessons: n.lessons, quiz: n.quizOff ? [] : n.quiz || [] }; b.request = req;
    withMem(b).then(invoke).then(function (res) {
      st.busy = '';
      if (key !== st.key) return;
      if (!res || !res.ok) { st.hist.pop(); toast((res && res.message) || '고치지 못했습니다', 'bad'); draw(); return; }
      if (Array.isArray(res.lessons) && res.lessons.length) st.edit.lessons = res.lessons;
      if (!n.quizOff && Array.isArray(res.quiz) && res.quiz.length) st.edit.quiz = res.quiz;
      st.req = '';
      var fin = function () { draw(); saveDraft(true); toast('요청대로 고쳤습니다 — 읽어 보고 [확정]해 주세요 · [한 단계 전으로]로 되돌릴 수 있습니다', 'good'); };
      if (remember && window.AiPolish) AiPolish.memAdd(cls, req).then(function (ok) { if (ok) st.remember = false; fin(); });
      else fin();
    });
  }

  /* 화면 → 노트 (고치는 중) */
  function readDom() {
    var n = clone(current());
    Array.prototype.forEach.call(document.querySelectorAll('#rnBody [data-rn-f]'), function (el) {
      var p = el.dataset.rnF.split('|'), l = n.lessons[+p[0]], k = p[1];
      if (!l) return;
      if (k === 'oneLine') l.oneLine = el.value.replace(/\s+/g, ' ').trim();
      else l[k] = el.value.split('\n').map(function (t) { return t.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      var has = k === 'oneLine' ? !!l.oneLine : l[k].length;
      if (has) l.unsure = lines(l.unsure).filter(function (u) { return u !== k; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#rnBody [data-rn-qf]'), function (el) {
      var p = el.dataset.rnQf.split('|'), q = (n.quiz || [])[+p[0]];
      if (q) q[p[1]] = p[1] === 'a' ? el.value : el.value.replace(/\s+/g, ' ').trim();
    });
    return n;
  }

  /* ---------- AI ---------- */
  function invoke(body) {
    var name = (window.CONFIG && CONFIG.summaryFunction) || 'lesson-summary';
    return sb().functions.invoke(name, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false, message: '복습 노트 함수를 부르지 못했습니다. Edge Function lesson-summary 를 다시 배포했는지 확인해 주세요.' }; });
      return { ok: false, message: '복습 노트 함수를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) { return { ok: false, message: '복습 노트 함수를 부르지 못했습니다 — ' + ((e && e.message) || '') }; });
  }
  /* 그 수업 자막 — 「✨ 영상 자막으로 채우기」 칸에 넣은 것 (없으면 안내하고 그 칸을 편다) */
  function source() {
    var s = window.Summary && Summary.source ? Summary.source() : null;
    if (s) return s;
    toast('영상 자막을 먼저 넣어 주세요 — 「✨ 영상 자막으로 채우기」 칸에 자막을 넣은 뒤 다시 눌러 주세요', 'bad');
    if (window.Summary && Summary.openPanel) Summary.openPanel();
    return null;
  }
  function base(op, src) {
    return { kind: 'review', op: op, class_name: st.cls, week_start: st.week, mode: src ? src.mode : 'one', lessons: src ? src.n : 2, texts: src ? src.texts : [] };
  }
  function make() {
    if (st.busy) return;
    if (!st.cls || !st.week) { toast('반과 주차를 먼저 골라 주세요', 'bad'); return; }
    if (st.missing) { toast(NEED_SQL, 'bad'); return; }
    var src = source();
    if (!src) return;
    var go = function () {
      var key = st.key;
      st.busy = 'make'; st.edit = null; draw();
      withMem(base('make', src)).then(invoke).then(function (res) {
        st.busy = '';
        if (!res || !res.ok) { toast((res && res.message) || '복습 노트를 만들지 못했습니다', 'bad'); draw(); return; }
        if (key === st.key) { st.row = res.note || st.row; st.edit = null; draw(); }
        toast('복습 노트 초안을 만들었습니다 — 읽고 고친 뒤 [확정]을 눌러 주세요', 'good');
        var b = $('#rnSub'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    };
    if (st.row && (st.row.status === 'draft' || st.edit)) {
      UI.confirmAsk('복습 노트 다시 만들기', '지금 초안(고친 내용 포함)은 새 초안으로 바뀝니다. 이번 달 AI 횟수도 1회 씁니다.', '다시 만들기').then(function (y) { if (y) go(); });
    } else go();
  }
  function regen(i, k) {
    if (st.busy) return;
    var src = source();
    if (!src) return;
    var n = readDom(), key = st.key;
    st.edit = n; st.busy = 'field'; draw();
    var b = base('field', src); b.lesson = i + 1; b.field = k;
    invoke(b).then(function (res) {
      st.busy = '';
      if (key !== st.key) return;
      if (!res || !res.ok) { toast((res && res.message) || '다시 만들지 못했습니다', 'bad'); draw(); return; }
      var l = st.edit.lessons[i];
      if (l) {
        l[k] = k === 'oneLine' ? String(res.value || '') : lines(res.value);
        l.unsure = lines(l.unsure).filter(function (u) { return u !== k; });
        if (res.unsure && !(k === 'oneLine' ? l.oneLine : l[k].length)) l.unsure.push(k);
      }
      draw();
      saveDraft(true);
      toast((i + 1) + '차시 「' + FIELDS.filter(function (f) { return f[0] === k; })[0][1] + '」을 다시 만들었습니다', 'good');
    });
  }
  function regenQuiz() {
    if (st.busy) return;
    var src = source();
    if (!src) return;
    var n = readDom(), key = st.key;
    st.edit = n; st.busy = 'quiz'; draw();
    var b = base('quiz', src); b.note = { lessons: n.lessons };
    invoke(b).then(function (res) {
      st.busy = '';
      if (key !== st.key) return;
      if (!res || !res.ok) { toast((res && res.message) || 'OX 를 다시 만들지 못했습니다', 'bad'); draw(); return; }
      st.edit.quiz = res.quiz || []; st.edit.quizNone = !!res.quizNone || !(res.quiz || []).length; st.edit.quizOff = false;
      draw(); saveDraft(true);
      toast(st.edit.quizNone ? '좋은 문항이 4개가 안 돼 이번 수업은 OX 없음으로 두었습니다' : 'OX ' + st.edit.quiz.length + '문항을 다시 만들었습니다', st.edit.quizNone ? '' : 'good');
    });
  }
  function polish() {
    if (st.busy) return;
    var n = readDom(), key = st.key;
    st.edit = n; st.busy = 'polish'; draw();
    var b = base('polish', null); b.lessons = Math.min(4, Math.max(1, n.lessons.length)); b.note = { lessons: n.lessons, quiz: n.quizOff ? [] : n.quiz || [] };
    withMem(b).then(invoke).then(function (res) {
      st.busy = '';
      if (key !== st.key) return;
      if (!res || !res.ok) { toast((res && res.message) || '다듬지 못했습니다', 'bad'); draw(); return; }
      if (Array.isArray(res.lessons) && res.lessons.length) st.edit.lessons = res.lessons;
      if (!n.quizOff && Array.isArray(res.quiz) && res.quiz.length) st.edit.quiz = res.quiz;
      draw(); saveDraft(true);
      toast('AI 로 말을 다듬었습니다 — 읽어 보고 [확정]해 주세요', 'good');
    });
  }

  /* ---------- 저장 · 확정 ---------- */
  function saveDraft(quiet) {
    var n = st.edit ? readDomSafe() : null;
    if (!n) return Promise.resolve();
    var key = st.key, cls = st.cls, week = st.week;
    var wasConfirmed = st.row && st.row.status === 'confirmed';
    if (wasConfirmed) { st.edit = n; if (!quiet) toast('확정본은 그대로 두고 고친 내용은 이 화면에만 있습니다 — 다시 공개해야 반영됩니다. [고친 내용으로 다시 확정]을 눌러 주세요'); draw(); return Promise.resolve(); }
    return sb().rpc('review_note_draft', { p_class: cls, p_week: week, p_draft: n, p_note: '', p_model: '' }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return; }
      if (key === st.key) { st.row = (r.data && r.data.note) || st.row; st.edit = null; draw(); }
      if (!quiet) toast('초안을 저장했습니다 (아직 학생 화면에는 안 보입니다)', 'good');
    });
  }
  function readDomSafe() { return document.querySelector('#rnBody [data-rn-f]') ? readDom() : st.edit; }
  function confirmNote() {
    var n = readDomSafe() || current();
    if (!n || !n.lessons || !n.lessons.some(function (l) { return String(l.oneLine || '').trim() || lines(l.actions).length; })) { toast('오늘의 한 줄이나 행동 강령을 적어 주세요', 'bad'); return; }
    n.quiz = (n.quiz || []).filter(function (q) { return String(q.q || '').trim() && (q.a === 'O' || q.a === 'X'); });
    if (!n.quizOff && n.quiz.length && n.quiz.length < 4) {
      UI.confirmAsk('OX 문항이 적습니다', 'OX 가 ' + n.quiz.length + '문항뿐입니다. 4문항보다 적으면 「이번 수업은 OX 없음」으로 확정합니다.', 'OX 없이 확정').then(function (y) { if (y) { n.quiz = []; n.quizNone = true; send(n); } });
      return;
    }
    if (!n.quiz.length) n.quizNone = true;
    send(n);
  }
  function send(n) {
    var key = st.key, ca = courseArgs();
    sb().rpc('review_note_confirm', { p_class: st.cls, p_week: st.week, p_note: n, p_lesson: lessonDate(), p_course: ca.p_course, p_no: ca.p_no }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return; }
      if (key === st.key) { st.row = (r.data && r.data.note) || st.row; st.edit = null; draw(); }
      var k = r.data && r.data.classes;
      toast('확정했습니다 — 학생 · 학부모 러닝노트에 나옵니다' + (k ? ' (' + k + '개 반)' : ''), 'good');
      loadOpens();
    });
  }
  function serverAct(fn, title, desc, okLabel, done, args) {
    var key = st.key;
    UI.confirmAsk(title, desc, okLabel).then(function (y) {
      if (!y) return;
      sb().rpc(fn, Object.assign({ p_class: st.cls, p_week: st.week }, args || {})).then(function (r) {
        if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return; }
        if (key === st.key) { st.row = (r.data && r.data.note) || null; st.edit = null; draw(); }
        toast(done, 'good');
      });
    });
  }

  /* ---------- 「오늘」 반 카드 — 이번 복습 노트 연 학생 n/전체 ---------- */
  var opens = {};
  function loadOpens() {
    if (!window.SB || !SB.client) return Promise.resolve();
    return sb().rpc('staff_review_note_opens', {}).then(function (r) {
      opens = {};
      (r.error ? [] : r.data || []).forEach(function (x) { (opens[x.class_name] = opens[x.class_name] || []).push(x); });
      window.dispatchEvent(new CustomEvent('jt:rnote'));
    }, function () {});
  }
  /* 그 반의 가장 최근 확정 노트 (오늘까지) */
  function cardLine(cls, total) {
    var l = (opens[cls] || []).filter(function (x) { return !window.DDay || String(x.lesson_date || x.week_start).slice(0, 10) <= DDay.today(); })
      .sort(function (a, b) { return String(a.week_start) < String(b.week_start) ? 1 : -1; })[0];
    if (!l || !total) return '';
    var n = Math.min(total, Number(l.opened) || 0);
    return '<div class="tdc-line tdc-line--rn"><span class="tdc-line__t">복습 노트</span><span class="tdc-rn num" title="학생 링크로 이번 복습 노트를 연 학생 수 (반 전체 숫자만)">이번 복습 노트 연 학생 ' + n + '/' + total + '</span></div>';
  }

  /* ---------- 시작 ---------- */
  function bind() {
    var b = $('#btnRnMake');
    if (b) b.addEventListener('click', function () {
      if (st.row || st.busy) { var s = $('#rnSub'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); if (st.row) return; }
      make();
    });
    var body = $('#rnBody');
    if (!body) return;
    body.addEventListener('input', function (e) {
      if (!e.target.closest('[data-rn-f], [data-rn-qf]')) return;
      var was = !!st.edit;
      st.edit = readDom();
      if (!was || confirmedEdited()) {
        var head = body.querySelector('.ai-result__head'); if (head) head.innerHTML = badgeHtml();
        var sv = body.querySelector('[data-rn-act="save"]'); if (sv) sv.disabled = false;
        var cf = body.querySelector('[data-rn-act="confirm"]'); if (cf && st.row && st.row.confirmed) cf.textContent = '고친 내용으로 다시 확정';
        if (confirmedEdited() && !body.querySelector('.rn-ed__warn')) head.insertAdjacentHTML('afterend', '<p class="rn-ed__warn">확정한 뒤 고쳤습니다 — 다시 공개해야 반영됩니다. [고친 내용으로 다시 확정]을 눌러 주세요.</p>');
      }
    });
    body.addEventListener('change', function (e) {
      if (e.target.id === 'rnRemember') { st.remember = e.target.checked; return; }
      if (e.target.closest('[data-rn-qf]')) st.edit = readDom();
    });
    /* 요청 칸 — 다시 그려도 남게 */
    body.addEventListener('input', function (e) {
      if (e.target.id !== 'rnReq') return;
      st.req = e.target.value;
      var n = body.querySelector('#rnReqN'); if (n) n.textContent = st.req.length + '/' + (window.AiPolish ? AiPolish.MAX_REQ : 300);
      var rv = body.querySelector('#rnRevise'); if (rv) rv.disabled = !!st.busy || st.req.trim().length < 2;
    });
    body.addEventListener('click', function (e) {
      var rg = e.target.closest('[data-rn-regen]');
      if (rg) { var p = rg.dataset.rnRegen.split('|'); regen(+p[0], p[1]); return; }
      var rq = e.target.closest('[data-rn-q]');
      if (rq) {
        var cur = st.req.replace(/\s+$/, ''), add = rq.dataset.rnQ;
        if (cur.indexOf(add) === -1) st.req = ((cur ? cur.replace(/[,.]$/, '') + ', ' : '') + add).slice(0, window.AiPolish ? AiPolish.MAX_REQ : 300);
        st.edit = readDom(); draw();
        var ta = body.querySelector('#rnReq'); if (ta) ta.focus();
        return;
      }
      var mdl = e.target.closest('[data-rn-memdel]');
      if (mdl && window.AiPolish) { AiPolish.memDel(mdl.dataset.rnMemdel).then(function () { st.edit = readDomSafe(); draw(); }); return; }
      var qd = e.target.closest('[data-rn-qdel]');
      if (qd) { var n = readDom(); n.quiz.splice(+qd.dataset.rnQdel, 1); st.edit = n; draw(); return; }
      var a = e.target.closest('[data-rn-act]');
      if (!a) return;
      var act = a.dataset.rnAct;
      if (act === 'quizoff' || act === 'quizon') { var n2 = readDom(); n2.quizOff = act === 'quizoff'; st.edit = n2; draw(); return; }
      if (act === 'quiz') regenQuiz();
      else if (act === 'polish') polish();
      else if (act === 'revise') reviseNote();
      else if (act === 'back') { var pv = st.hist.pop(); if (pv) { st.edit = pv; draw(); saveDraft(true); toast('한 단계 전으로 돌아갔습니다'); } }
      else if (act === 'remake') make();
      else if (act === 'save') saveDraft(false);
      else if (act === 'confirm') confirmNote();
      else if (act === 'discard') serverAct('review_note_discard', '초안 지우기', '이 복습 노트 초안을 지웁니다. 되돌릴 수 없습니다. (이번 달 AI 횟수는 돌아오지 않습니다)', '지우기', '초안을 지웠습니다');
      else if (act === 'unconfirm') { var ca = courseArgs(); serverAct('review_note_unconfirm', '확정 취소', '학생 · 학부모 화면에서 이 복습 노트가 내려가고 초안으로 돌아갑니다.', '확정 취소', '확정을 취소했습니다 — 초안으로 돌아갔습니다', ca); }
    });
    window.addEventListener('jt:remote', function (e) {
      var t = e.detail && e.detail.table;
      if (t === 'review_notes' && st.key && !st.busy && !st.edit) load();
      if (t === 'review_notes' || t === '*') loadOpens();
    });
    window.addEventListener('jt:loaded', function () { st.key = ''; loadOpens(); });
  }
  bind();

  window.RNote = { render: render, reload: load, make: make, cardLine: cardLine, loadOpens: loadOpens, state: function () { return { row: st.row, edit: st.edit, busy: st.busy }; } };
})();
