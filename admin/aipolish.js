/* ============================================================
   aipolish.js — 글 칸 「AI로 다듬기」 · 「AI로 초안 쓰기」 공통 부품 (Edge Function text-polish · migration-026 · 20261029g)

   AiPolish.attach(칸, 옵션) — 학생 · 학부모가 읽는 여러 줄 글 칸 하나에 붙인다. 모든 칸이 같은 모양 · 같은 동작이다.
     · 칸 오른쪽 위 [AI로 다듬기] (내용이 비어 있으면 누를 수 없다) · 코멘트 칸은 옆에 [AI로 초안 쓰기]
     · 결과는 원래 글과 나란히 — [이걸로 바꾸기] [다시 다듬기 · 처음부터 다시 쓰기] [그대로 두기], 바꾼 뒤에는 [되돌리기]
     · 다듬는 동안 「다듬는 중…」, 실패하면 「지금은 다듬기가 안 됩니다. 잠시 뒤 다시 눌러 주세요.」 (원래 글은 그대로)
   20261031p
     · 초안(다듬은 문장) 칸은 바로 고칠 수 있는 입력 칸 — 고치면 오른쪽 위 「직접 고친 내용 있음」 · [AI 초안으로 되돌리기]
       [이걸로 바꾸기]는 고친 그대로 칸에 넣는다
     · 「AI에게 고쳐 달라고 하기」 — 빠른 버튼(누르면 아래 칸에 그 말이 이어 붙는다) · 직접 쓰는 칸(300자) · [이대로 고치기]
       지금 초안(손으로 고친 것 포함)을 요청대로 고친다 (text-polish action 'revise' · 처음부터 새로 쓰지 않는다) · [한 단계 전으로]
       「이 요청을 이 반 기본으로 기억하기」 — ai_requests(migration-043) · 반 이름 또는 과정(§과정) 단위 · 다음 초안부터 처음부터 따른다
       「빼 줘」 요청 항목(과제율 · 복습테스트 …)은 그 자료를 AI 에 아예 보내지 않는다 (exclude)
     · 칸에 이미 글이 있는데 [AI로 초안 쓰기] — 그 글은 지우지 않고 초안 맨 끝에 한 글자도 안 바꾸고 붙인다 · 「원래 글을 초안 끝에 살렸습니다」
     · 「확인할 것」은 정말 확인할 것만 2개까지 (함수가 거른다)
   옵션
     kind     sms(짧게, 메신저용) · notice(학생이 바로 알아보게) · comment(주간 코멘트) · lessons(차시 줄) · general
     lengths  true 면 길이(짧게 · 보통 · 자세히, 기본 보통) — 문자 보내기
     left     true 면 버튼 옆에 「이번 달 n회 남음」
     id       버튼 · 칸 id 앞부분 (시험 · 다른 코드가 찾을 때) — 예) 'smsAi' → #smsAiBtn #smsAiResult …
     draft    function() → Promise<{ target: 'class'|'student', facts: {…}, note: '안내 한 줄' } | null>  (있으면 [AI로 초안 쓰기])
     isEmpty  function() → 칸에 살릴 글이 없는가 (기본: 칸 글이 비었는가)
     scope    function() → { key: 반 이름 | '§과정', label: '반' | '과정' } | null  (있으면 「이 반 기본으로 기억하기」)
     get/set  칸이 textarea 가 아닐 때 (수업 내용 차시 줄 묶음) — 글 읽기 · 쓰기
     host     get/set 일 때 버튼 줄 · 결과를 붙일 자리
   Claude 에는 칸 글(또는 화면이 모은 자료)만 간다. 학생 이름 · 전화번호는 보내지 않는다.
   ============================================================ */

(function () {
  'use strict';

  var FN = 'text-polish';
  var FAIL = '지금은 다듬기가 안 됩니다. 잠시 뒤 다시 눌러 주세요.';
  var LENS = [['short', '짧게'], ['normal', '보통'], ['long', '자세히']];
  var MAX_REQ = 300;
  /* 빠른 버튼 — 누르면 요청 칸에 이 말이 이어 붙는다 (앞 셋은 초안 칸에만) */
  var QUICK = [
    ['수업 내용 짧게', '수업 내용은 짧게 줄여 줘', true],
    ['과제율 빼기', '과제율은 빼 줘', true],
    ['복습테스트 빼기', '복습테스트 이야기는 빼 줘', true],
    ['더 자세히', '조금 더 자세히 써 줘'],
    ['더 짧게', '더 짧게 줄여 줘'],
    ['더 따뜻하게', '더 따뜻한 말투로 바꿔 줘'],
    ['원래 글 살리기', '원래 글의 표현을 살려 줘']
  ];
  var KEPT_NOTE = '원래 글을 초안 끝에 살렸습니다';
  var all = [];
  var left = null;
  var mem = {};        /* 반(§과정) → [{ id, request }] · 이 화면 메모리 */

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sb() { return window.SB && SB.client; }

  function invoke(body) {
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false });
    return fns.invoke(FN, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false }; });
      return { ok: false };
    }).catch(function () { return { ok: false }; });
  }

  /* 이번 달 남은 횟수 (모든 칸이 같이 쓴다 · AI 요약과 따로) */
  function loadLeft() {
    if (!sb() || !sb().rpc) return Promise.resolve();
    /* 로그인 전(관문)에는 부르지 않는다 — 들어온 뒤 jt:loaded 에 다시 */
    if (document.body.classList.contains('is-locked')) return Promise.resolve();
    return Promise.resolve(sb().rpc('polish_status')).then(function (r) {
      left = r && !r.error && r.data ? Math.max(0, (r.data.cap || 0) - (r.data.used || 0)) : null;
      all.forEach(draw);
    }, function () { left = null; });
  }
  window.addEventListener('jt:loaded', function () { if (left == null) loadLeft(); });

  /* ---------- 「빼 줘」 — 그 자료를 AI 에 아예 보내지 않는다 ---------- */
  var DROP = [
    [/과제율|과제|앱/, ['앱과제', '지난기간']],
    [/복습 ?테스트|복테/, ['복습테스트']],
    [/출결|결석|지각/, ['출결', '최근결석']],
    [/집중/, ['집중도']],
    [/배부|자료/, ['배부자료']],
    [/수업 ?내용/, ['수업내용', '이번주수업']],
    [/반 ?공통/, ['반공통코멘트']]
  ];
  var NO_RE = /빼|제외|넣지 ?마|쓰지 ?마|없이|언급하지 ?마/;
  function dropKeys(reqs) {
    var out = {};
    (reqs || []).forEach(function (r) {
      String(r || '').split(/[,.·\n;]|그리고|하고 /).forEach(function (part) {
        if (!NO_RE.test(part)) return;
        DROP.forEach(function (d) { if (d[0].test(part)) d[1].forEach(function (k) { out[k] = true; }); });
      });
    });
    return Object.keys(out);
  }
  function exclude(facts, reqs) {
    if (!facts || typeof facts !== 'object') return facts;
    var ks = dropKeys(reqs), f = JSON.parse(JSON.stringify(facts));
    ks.forEach(function (k) { delete f[k]; });
    return f;
  }

  /* ---------- 반 기본 요청 (ai_requests · migration-043) ---------- */
  function memLoad(key, force) {
    if (!key || !sb() || !sb().from) return Promise.resolve([]);
    if (mem[key] && !force) return Promise.resolve(mem[key]);
    return Promise.resolve(sb().from('ai_requests').select('id,request,created_at').eq('scope', key).order('created_at', { ascending: true })).then(function (r) {
      mem[key] = r && !r.error ? (r.data || []) : [];
      return mem[key];
    }, function () { return []; });
  }
  function memAll() {
    if (!sb() || !sb().from) return Promise.resolve(null);
    return Promise.resolve(sb().from('ai_requests').select('id,scope,request,created_at').order('created_at', { ascending: true })).then(function (r) {
      if (!r || r.error) return null;
      var by = {};
      (r.data || []).forEach(function (x) { (by[x.scope] = by[x.scope] || []).push(x); });
      mem = by;
      return by;
    }, function () { return null; });
  }
  function memAdd(key, text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_REQ);
    if (!key || t.length < 2) return Promise.resolve(false);
    if ((mem[key] || []).some(function (x) { return x.request === t; })) return Promise.resolve(true);
    return Promise.resolve(sb().from('ai_requests').insert({ scope: key, request: t }).select('id,request,created_at').single()).then(function (r) {
      if (r.error) { if (window.UI) UI.toast(/ai_requests|schema cache|does not exist/i.test(r.error.message || '') ? 'migration-043 SQL 을 먼저 실행해 주세요 (반 기본 요청)' : '기억하지 못했습니다 — ' + r.error.message, 'bad'); return false; }
      (mem[key] = mem[key] || []).push(r.data);
      window.dispatchEvent(new CustomEvent('jt:ai-requests'));
      return true;
    });
  }
  function memDel(id) {
    return Promise.resolve(sb().from('ai_requests').delete().eq('id', id)).then(function (r) {
      if (r && r.error) { if (window.UI) UI.toast(r.error.message, 'bad'); return false; }
      Object.keys(mem).forEach(function (k) { mem[k] = mem[k].filter(function (x) { return x.id !== id; }); });
      window.dispatchEvent(new CustomEvent('jt:ai-requests'));
      return true;
    });
  }
  function scopeOf(P) { try { var s = P.o.scope ? P.o.scope() : null; return s && s.key ? s : null; } catch (e) { return null; } }

  function attach(el, opts) {
    opts = opts || {};
    if (!el || el.__aip) return el && el.__aip;
    var pre = opts.id || '';
    var idA = function (s) { return pre ? ' id="' + pre + s + '"' : ''; };
    var P = {
      el: el, o: opts, len: 'normal', busy: '', res: null, undo: null, src: '', keep: '', msg: '', note: '', ai: '', hist: [],
      get: opts.get || function () { return el.value; },
      set: opts.set || function (v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    el.__aip = P;
    var bar = document.createElement('div');
    bar.className = 'aip-bar';
    bar.innerHTML =
      (opts.lengths ? '<span class="aip-len" role="group" aria-label="다듬을 길이">' + LENS.map(function (l) {
        return '<button type="button" class="btn btn--sm btn--ghost" data-polish-len="' + l[0] + '" aria-pressed="false">' + l[1] + '</button>';
      }).join('') + '</span>' : '') +
      (opts.left ? '<span class="muted-note aip-left"' + idA('Left') + '></span>' : '') +
      '<span class="aip-spacer"></span>' +
      '<button type="button" class="btn btn--sm btn--ghost aip-undo" data-aip="undo" hidden' + idA('Undo') + '>되돌리기</button>' +
      (opts.draft ? '<button type="button" class="btn btn--sm aip-btn aip-btn--draft" data-aip="draft"' + idA('Draft') + '>AI로 초안 쓰기</button>' : '') +
      '<button type="button" class="btn btn--sm aip-btn" data-aip="polish"' + idA('Btn') + '>AI로 다듬기</button>';
    var box = document.createElement('div');
    box.className = 'aip-box';
    box.innerHTML =
      '<p class="aip-note" hidden></p>' +
      '<p class="cp-warn aip-msg" hidden' + idA('Msg') + '></p>' +
      '<div class="aip-result" hidden' + idA('Result') + '>' +
        '<p class="aip-kept" hidden' + idA('Kept') + '>' + KEPT_NOTE + '</p>' +
        '<div class="aip-cols">' +
          '<div class="aip-col aip-col--orig"><div class="aip-col__t">원래 글</div><div class="aip-text aip-text--orig"></div></div>' +
          '<div class="aip-col aip-col--new"><div class="aip-col__t aip-col__t--new"><span class="aip-col__name">다듬은 문장</span> <span class="sms-len aip-bytes"' + idA('Bytes') + '></span>' +
            '<span class="aip-col__right"><span class="aip-edited" hidden' + idA('Edited') + '>직접 고친 내용 있음</span>' +
            '<button type="button" class="aip-revert" data-aip="revertai" hidden' + idA('RevertAi') + '>AI 초안으로 되돌리기</button></span></div>' +
            '<textarea class="textarea aip-text aip-text--new" rows="6"' + idA('Text') + ' aria-label="AI 초안 — 눌러서 직접 고칠 수 있습니다" spellcheck="false"></textarea></div>' +
        '</div>' +
        '<div class="aip-check" hidden><b>확인할 것</b><ul' + idA('Check') + '></ul></div>' +
        '<div class="aip-acts">' +
          '<button type="button" class="btn btn--sm btn--primary" data-aip="use"' + idA('Use') + '>이걸로 바꾸기</button>' +
          '<button type="button" class="btn btn--sm" data-aip="again"' + idA('Again') + '>다시 다듬기</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-aip="drop"' + idA('Drop') + '>그대로 두기</button>' +
        '</div>' +
        '<div class="aip-ask" role="group" aria-label="AI에게 고쳐 달라고 하기">' +
          '<div class="aip-ask__t">AI에게 고쳐 달라고 하기</div>' +
          '<div class="aip-quick">' + QUICK.filter(function (q) { return opts.draft || !q[2]; }).map(function (q) {
            return '<button type="button" class="aip-q" data-aip-q="' + esc(q[1]) + '">' + esc(q[0]) + '</button>';
          }).join('') + '</div>' +
          '<textarea class="textarea aip-req" rows="2" maxlength="' + MAX_REQ + '"' + idA('Req') + ' placeholder="예: 수업 내용은 두 문장으로 줄이고, 과제율은 빼 줘" aria-label="어떻게 고칠지"></textarea>' +
          '<div class="aip-mem" hidden' + idA('Mem') + '></div>' +
          '<label class="aip-remember" hidden><input type="checkbox"' + idA('Remember') + '> <span class="aip-remember__t">이 요청을 이 반 기본으로 기억하기</span></label>' +
          '<div class="aip-ask__acts"><button type="button" class="btn btn--sm btn--primary" data-aip="revise"' + idA('Revise') + '>이대로 고치기</button>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-aip="back"' + idA('Back') + ' hidden>한 단계 전으로</button>' +
            '<span class="muted-note aip-req-n num"' + idA('ReqN') + '>0/' + MAX_REQ + '</span></div>' +
        '</div>' +
        '<p class="field__hint">AI가 고친 글입니다. 날짜 · 시간 · 숫자 · 이름을 한 번 더 확인해 주세요.</p>' +
      '</div>';
    if (opts.host) { opts.host.appendChild(bar); opts.host.appendChild(box); }
    else { el.parentNode.insertBefore(bar, el); el.parentNode.insertBefore(box, el.nextSibling); }
    if (pre) box.id = pre;
    P.bar = bar; P.box = box;
    P.ta = box.querySelector('.aip-text--new');
    P.req = box.querySelector('.aip-req');
    bar.addEventListener('click', function (e) { onClick(P, e); });
    box.addEventListener('click', function (e) { onClick(P, e); });
    P.ta.addEventListener('input', function () { drawEdit(P); });
    P.req.addEventListener('input', function () { drawReq(P); });
    if (!opts.get) {
      el.addEventListener('input', function () { draw(P); });
      el.addEventListener('focus', function () { draw(P); });
    }
    all.push(P);
    draw(P);
    if (opts.left && left == null) loadLeft();
    return P;
  }

  function isEmpty(P) { try { return !String(P.get() || '').trim(); } catch (e) { return true; } }
  function keepEmpty(P) { return P.o.isEmpty ? !!P.o.isEmpty() : isEmpty(P); }

  /* 초안 칸만 — 직접 고친 내용 있음 · 바이트 */
  function drawEdit(P) {
    var box = P.box, v = P.ta.value, edited = !!P.res && v !== P.ai;
    box.querySelector('.aip-edited').hidden = !edited;
    box.querySelector('[data-aip="revertai"]').hidden = !edited;
    if (P.res) box.querySelector('.aip-bytes').textContent = P.o.kind === 'sms' ? bytes(v) + '바이트' + (bytes(v) <= 90 ? ' · 단문 크기' : '') : '';
  }
  function drawReq(P) {
    var n = P.req.value.length, box = P.box;
    box.querySelector('.aip-req-n').textContent = n + '/' + MAX_REQ;
    box.querySelector('[data-aip="revise"]').disabled = !!P.busy || P.req.value.trim().length < 2;
  }
  function bytes(t) { var n = 0; t = String(t || ''); for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); n += (c > 0 && c < 128) ? 1 : 2; } return n; }
  function drawMem(P) {
    var box = P.box, sc = scopeOf(P), host = box.querySelector('.aip-mem'), lab = box.querySelector('.aip-remember');
    lab.hidden = !sc;
    if (sc) lab.querySelector('.aip-remember__t').textContent = '이 요청을 이 ' + (sc.label || '반') + ' 기본으로 기억하기';
    var list = sc ? mem[sc.key] || [] : [];
    host.hidden = !list.length;
    host.innerHTML = list.length ? '<span class="aip-mem__t">이 ' + esc(sc.label || '반') + ' 기본 요청</span>' + list.map(function (x) {
      return '<span class="aip-mem__c">' + esc(x.request) + '<button type="button" class="aip-mem__x" data-aip-memdel="' + esc(x.id) + '" aria-label="' + esc('「' + x.request + '」 지우기') + '">×</button></span>';
    }).join('') : '';
  }

  function draw(P) {
    var bar = P.bar, box = P.box;
    var empty = isEmpty(P);
    var pb = bar.querySelector('[data-aip="polish"]'), db = bar.querySelector('[data-aip="draft"]');
    pb.disabled = !!P.busy || empty;
    pb.textContent = P.busy === 'polish' ? '다듬는 중…' : 'AI로 다듬기';
    pb.title = empty ? '내용을 먼저 써 주세요' : '';
    if (db) { db.disabled = !!P.busy; db.textContent = P.busy === 'draft' ? '초안 쓰는 중…' : 'AI로 초안 쓰기'; }
    Array.prototype.forEach.call(bar.querySelectorAll('[data-polish-len]'), function (b) {
      var on = b.dataset.polishLen === P.len; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
    });
    var lf = bar.querySelector('.aip-left');
    if (lf) lf.textContent = left == null ? '' : '이번 달 ' + left + '회 남음';
    bar.querySelector('[data-aip="undo"]').hidden = P.undo == null;
    var note = box.querySelector('.aip-note');
    note.hidden = !P.note; note.textContent = P.note || '';
    var msg = box.querySelector('.aip-msg');
    msg.hidden = !P.msg; msg.textContent = P.msg || '';
    var r = P.res, rb = box.querySelector('.aip-result');
    rb.hidden = !r;
    if (r) {
      box.querySelector('.aip-kept').hidden = !P.keep;
      box.querySelector('.aip-col--orig').hidden = !String(P.src || '').trim();
      box.querySelector('.aip-text--orig').textContent = P.src;
      box.querySelector('.aip-col__name').textContent = r.draft ? '초안' : '다듬은 문장';
      var ck = box.querySelector('.aip-check');
      ck.hidden = !(r.check && r.check.length);
      ck.querySelector('ul').innerHTML = (r.check || []).slice(0, 2).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      box.querySelector('[data-aip="again"]').textContent = P.busy === 'again' ? (r.draft ? '쓰는 중…' : '다듬는 중…') : r.draft ? '처음부터 다시 쓰기' : '다시 다듬기';
      box.querySelector('[data-aip="use"]').textContent = String(P.src || '').trim() || !r.draft ? '이걸로 바꾸기' : '칸에 넣기';
      Array.prototype.forEach.call(box.querySelectorAll('.aip-acts .btn, .aip-q'), function (b) { b.disabled = !!P.busy; });
      var rv = box.querySelector('[data-aip="revise"]');
      box.querySelector('[data-aip="back"]').hidden = !P.hist.length;
      box.querySelector('[data-aip="back"]').disabled = !!P.busy;
      P.ta.readOnly = !!P.busy;
      drawReq(P);
      rv.textContent = P.busy === 'revise' ? '고치는 중…' : '이대로 고치기';
      drawEdit(P);
      drawMem(P);
    }
  }

  function onClick(P, e) {
    var lb = e.target.closest('[data-polish-len]');
    if (lb) { P.len = lb.dataset.polishLen; draw(P); return; }
    var q = e.target.closest('[data-aip-q]');
    if (q) {
      var cur = P.req.value.replace(/\s+$/, ''), add = q.dataset.aipQ;
      if (cur.indexOf(add) === -1) P.req.value = (cur ? cur.replace(/[,.]$/, '') + ', ' : '') + add;
      P.req.value = P.req.value.slice(0, MAX_REQ);
      drawReq(P);
      return;
    }
    var md = e.target.closest('[data-aip-memdel]');
    if (md) { memDel(md.dataset.aipMemdel).then(function () { all.forEach(function (x) { if (x.res) drawMem(x); }); }); return; }
    var b = e.target.closest('[data-aip]');
    if (!b) return;
    var a = b.dataset.aip;
    if (a === 'polish') run(P, false);
    else if (a === 'draft') run(P, true);
    else if (a === 'again') run(P, !!(P.res && P.res.draft), true);
    else if (a === 'use') use(P);
    else if (a === 'drop') { P.res = null; P.hist = []; draw(P); }
    else if (a === 'undo') { if (P.undo != null) { P.set(P.undo); P.undo = null; draw(P); } }
    else if (a === 'revertai') { P.ta.value = P.ai; drawEdit(P); }
    else if (a === 'revise') revise(P);
    else if (a === 'back') { var h = P.hist.pop(); if (h) { P.ta.value = h.text; P.ai = h.ai; if (h.check) P.res.check = h.check; draw(P); } }
  }

  function done(res) { if (res && res.cap != null && res.used != null) left = Math.max(0, res.cap - res.used); }
  function failMsg(res) { return res && res.reason === 'input' && res.message ? res.message : FAIL; }
  /* 결과를 초안 칸에 (새 결과 — 고친 흔적 · 한 단계 전 기록은 처음부터) */
  function show(P, r) {
    P.res = r; P.ai = r.text; P.ta.value = r.text; P.hist = [];
    all.forEach(draw);
  }

  function run(P, isDraft, again) {
    if (P.busy) return;
    var text = again && !isDraft ? P.src : String(P.get() || '');
    if (!isDraft && !text.trim()) { draw(P); return; }
    P.msg = ''; P.note = ''; P.busy = again ? 'again' : isDraft ? 'draft' : 'polish';
    draw(P);
    var sc = scopeOf(P);
    var prep = isDraft ? Promise.all([Promise.resolve(P.o.draft()).catch(function () { return null; }), memLoad(sc && sc.key)]) : Promise.resolve([null, []]);
    prep.then(function (x) {
      var d = x[0], reqs = (x[1] || []).map(function (m) { return m.request; });
      if (isDraft && !d) { P.busy = ''; P.msg = FAIL; draw(P); return null; }
      if (d && d.note) P.note = d.note;
      /* 칸에 이미 있는 글 — 초안 맨 끝에 그대로 (지우지 않는다) */
      var cur = String(P.get() || ''), keep = isDraft && !keepEmpty(P) ? cur.trim() : '';
      var body = isDraft
        ? { action: 'draft', target: d.target, facts: exclude(d.facts, reqs), requests: reqs, keep: keep }
        : { text: text, kind: P.o.kind || 'general', length: P.o.lengths ? P.len : 'normal' };
      return invoke(body).then(function (res) {
        P.busy = '';
        done(res);
        if (!res || !res.ok || typeof res.text !== 'string') {
          P.res = null;
          P.msg = failMsg(res);
          all.forEach(draw);
          return;
        }
        P.keep = keep;
        P.src = isDraft ? (keepEmpty(P) ? '' : cur) : text;
        show(P, { text: res.text + (keep ? '\n\n' + keep : ''), check: res.check || [], bytes: res.bytes || 0, draft: isDraft });
      });
    });
  }

  /* 「AI에게 고쳐 달라고 하기」 — 지금 초안(손으로 고친 것 포함)을 요청대로 */
  function revise(P) {
    if (P.busy || !P.res) return;
    var req = P.req.value.replace(/\s+/g, ' ').trim();
    if (req.length < 2) { P.msg = '어떻게 고칠지 적어 주세요'; draw(P); P.req.focus(); return; }
    if (req.length > MAX_REQ) { P.msg = '요청은 ' + MAX_REQ + '자까지 쓸 수 있습니다'; draw(P); return; }
    var now = P.ta.value, tail = '', base = now;
    if (P.keep && now.slice(-P.keep.length) === P.keep && now.length > P.keep.length) { base = now.slice(0, now.length - P.keep.length).replace(/\s+$/, ''); tail = P.keep; }
    if (!base.trim()) { P.msg = '고칠 글이 없습니다'; draw(P); return; }
    var sc = scopeOf(P), remember = !!(sc && P.box.querySelector('.aip-remember input').checked);
    P.msg = ''; P.busy = 'revise'; draw(P);
    Promise.all([P.o.draft && P.res.draft ? Promise.resolve(P.o.draft()).catch(function () { return null; }) : null, memLoad(sc && sc.key)]).then(function (x) {
      var d = x[0], reqs = (x[1] || []).map(function (m) { return m.request; });
      var body = { action: 'revise', text: base, request: req, requests: reqs, kind: P.o.kind || 'general', orig: String(P.src || '') };
      if (d && d.facts) body.facts = exclude(d.facts, reqs.concat([req]));
      return invoke(body).then(function (res) {
        P.busy = '';
        done(res);
        if (!res || !res.ok || typeof res.text !== 'string') { P.msg = failMsg(res); all.forEach(draw); return; }
        P.hist.push({ text: now, ai: P.ai, check: P.res.check });
        var nt = res.text + (tail ? '\n\n' + tail : '');
        P.ai = nt; P.ta.value = nt; P.res.check = res.check || [];
        P.req.value = '';
        var rm = P.box.querySelector('.aip-remember input');
        var after = function () { all.forEach(draw); };
        if (remember) memAdd(sc.key, req).then(function (ok) { if (ok) { rm.checked = false; if (window.UI) UI.toast('「' + req + '」를 이 ' + (sc.label || '반') + ' 기본 요청으로 기억했습니다 — 다음 초안부터 처음부터 따릅니다', 'good'); } after(); });
        else after();
      });
    });
  }

  function use(P) {
    if (!P.res) return;
    P.undo = String(P.get() || '');
    P.set(P.ta.value);
    P.res = null; P.hist = [];
    draw(P);
  }

  /* 칸 글을 코드가 바꿨을 때(다른 학생 · 다른 주) — 결과 · 되돌리기를 지운다. 칸 또는 붙일 때 준 id */
  function find(x) { return typeof x === 'string' ? all.filter(function (p) { return p.o.id === x; })[0] : x && x.__aip; }
  function reset(el) {
    var P = find(el);
    if (!P) return;
    P.res = null; P.undo = null; P.msg = ''; P.note = ''; P.busy = ''; P.hist = []; P.keep = '';
    draw(P);
  }
  function refresh(el) { var P = find(el); if (P) draw(P); }

  /* 코드가 값을 바꾼 칸도 비었는지 알아보게 — 가볍게 자주 (붙인 칸 몇 개뿐) */
  setInterval(function () { all.forEach(function (P) { if (!P.busy && P.bar.isConnected) { var pb = P.bar.querySelector('[data-aip="polish"]'); if (pb.disabled !== isEmpty(P)) draw(P); } }); }, 700);
  window.addEventListener('jt:ai-requests', function () { all.forEach(function (P) { if (P.res) drawMem(P); }); });

  /* 늘 있는 칸 — 반 공지 · 교재 납부 안내 · 문자 · 카톡 인사말 · 코멘트 상용구.
     문자 내용(sms.js) · 반 공통 코멘트 · 학생 코멘트 · 수업 내용(write.js)은 그 파일이 붙인다 */
  var STATIC = [
    ['ntSpecial', 'notice'], ['ntCurriculum', 'notice'], ['ntLiterature', 'notice'], ['ntReading', 'notice'], ['ntHomework', 'notice'], ['ntNotes', 'notice'],
    ['tbTemplate', 'sms'], ['tbNoticeText', 'sms'], ['greetingText', 'sms'], ['snipNew', 'comment']
  ];
  STATIC.forEach(function (x) { var el = document.getElementById(x[0]); if (el) attach(el, { kind: x[1], id: x[0] + 'Ai' }); });

  window.AiPolish = {
    attach: attach, reset: reset, refresh: refresh, loadLeft: loadLeft, FAIL: FAIL,
    /* 20261031p — 빼 줘 · 반 기본 요청 (reviewnote.js · classes.js · course.js 도 쓴다) */
    QUICK: QUICK, MAX_REQ: MAX_REQ, exclude: exclude, dropKeys: dropKeys,
    memLoad: memLoad, memAll: memAll, memAdd: memAdd, memDel: memDel, memOf: function (k) { return mem[k] || []; }
  };
})();
