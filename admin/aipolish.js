/* ============================================================
   aipolish.js — 글 칸 「AI로 다듬기」 · 코멘트 칸 「AI에게 부탁하기」 공통 부품 (Edge Function text-polish · migration-026 · 20261029g)

   AiPolish.attach(칸, 옵션) — 학생 · 학부모가 읽는 여러 줄 글 칸 하나에 붙인다. 모든 칸이 같은 모양 · 같은 동작이다.
     · 칸 오른쪽 위 [AI로 다듬기] (내용이 비어 있으면 누를 수 없다)
     · 결과는 원래 글과 나란히 — [이걸로 바꾸기] [다시 다듬기] [그대로 두기], 바꾼 뒤에는 [되돌리기]
     · 다듬는 동안 「다듬는 중…」, 실패하면 「지금은 다듬기가 안 됩니다. 잠시 뒤 다시 눌러 주세요.」 (원래 글은 그대로)
   20261031p
     · 다듬은 문장 칸은 바로 고칠 수 있는 입력 칸 — 고치면 오른쪽 위 「직접 고친 내용 있음」 · [AI 초안으로 되돌리기]
       [이걸로 바꾸기]는 고친 그대로 칸에 넣는다
     · 「AI에게 고쳐 달라고 하기」 — 빠른 버튼(누르면 아래 칸에 그 말이 이어 붙는다) · 직접 쓰는 칸(300자) · [이대로 고치기]
       지금 초안(손으로 고친 것 포함)을 요청대로 고친다 (text-polish action 'revise' · 처음부터 새로 쓰지 않는다) · [한 단계 전으로]
       「이 요청을 이 반 기본으로 기억하기」 — ai_requests(migration-043) · 반 이름 또는 과정(§과정) 단위 · 다음 초안부터 처음부터 따른다
       「빼 줘」 요청 항목(과제율 · 복습테스트 …)은 그 자료를 AI 에 아예 보내지 않는다 (exclude)
     · 「확인할 것」은 정말 확인할 것만 2개까지 (함수가 거른다)
   20261106d — ask: true (반 공통 · 학생 코멘트) — 칸 하나 · 그 칸 글이 그대로 나간다
     · 칸 위 [비우기] (5초 동안 [되돌리기]) · 칸 아래 빠른 버튼(더 짧게 · 더 따뜻하게 · 과제율 빼기 · 복습테스트 빼기) · 「AI에게 부탁하기」 한 줄 + [써 줘]
     · 칸이 비면 부탁대로 새로 쓴다(action draft + request · 수업 내용 · 과제 · 복습테스트 자료 참고 · 부탁을 안 적으면 자료만으로) · 글이 있으면 부탁대로 고친다(action revise)
     · 결과는 칸에 바로 · [되돌리기] = 바로 전 글 · 「확인할 것」은 칸 아래 접을 수 있게
     · 실패 — 칸 글 · 부탁 문장 그대로 · 화면에는 짧은 이유 · 자세한 것은 브라우저 콘솔 · 함수 로그
   옵션
     kind     sms(짧게, 메신저용) · notice(학생이 바로 알아보게) · comment(주간 코멘트) · lessons(차시 줄) · general
     lengths  true 면 길이(짧게 · 보통 · 자세히, 기본 보통) — 문자 보내기
     left     true 면 버튼 옆에 「이번 달 n회 남음」
     id       버튼 · 칸 id 앞부분 (시험 · 다른 코드가 찾을 때) — 예) 'smsAi' → #smsAiBtn #smsAiResult …
     ask      true 면 위 20261106d 모양
     field    (ask) function() → 지금 글 칸 (칸이 다시 만들어질 때)
     draft    (ask) function() → Promise<{ target: 'class'|'student', facts: {…}, note: '안내 한 줄' } | null>  부탁할 때 AI 에 줄 자료
     isEmpty  (ask) function() → 고칠 글이 없는가 — 그러면 새로 쓴다 (기본: 칸 글이 비었는가)
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
  /* 빠른 버튼 — 누르면 요청 칸에 이 말이 이어 붙는다 */
  var QUICK = [
    ['더 자세히', '조금 더 자세히 써 줘'],
    ['더 짧게', '더 짧게 줄여 줘'],
    ['더 따뜻하게', '더 따뜻한 말투로 바꿔 줘'],
    ['원래 글 살리기', '원래 글의 표현을 살려 줘']
  ];
  /* 코멘트 칸 — 누르면 바로 그 부탁으로 고친다 (20261106d) */
  var ASK_QUICK = [['더 짧게', '더 짧게 줄여 줘'], ['더 따뜻하게', '더 따뜻한 말투로 바꿔 줘'], ['과제율 빼기', '과제율은 빼 줘'], ['복습테스트 빼기', '복습테스트 이야기는 빼 줘']];
  var ASK_EX = '예: 12/27(일) 개강 안내하고, 기말고사 응원과 채널로 질문하면 자료 준다는 내용으로 써 줘';
  var ASK_FAIL = 'AI 응답이 늦어요. 잠시 뒤 다시 눌러 주세요';
  var ASK_WAIT = 70000;
  /* 실패 이유 — 화면에는 짧게 (자세한 것은 콘솔 · 함수 로그) */
  var WHY_SHORT = { timeout: '시간 초과', 'auth-key': '키 확인', permission: '키 확인', credit: '크레딧 확인', nokey: '키 없음', cap: '이번 달 상한', 'rate-limit': '요청이 많음',
    overload: 'AI 서버 바쁨', connect: 'AI 연결', login: '로그인 확인', auth: '로그인 확인', network: '인터넷 확인', nofn: '함수 없음', check: '글 검사 걸림' };
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
      var ctx = r.error.context, st = ctx && ctx.status;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false, reason: st === 404 ? 'nofn' : 'server', status: st }; });
      return { ok: false, reason: 'network', detail: String(r.error.message || '') };
    }).catch(function (e) { return { ok: false, reason: 'network', detail: String((e && e.message) || e) }; });
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
      el: el, o: opts, len: 'normal', busy: '', res: null, undo: null, src: '', msg: '', note: '', ai: '', hist: [],
      ask: !!opts.ask, tok: 0, check: [], clearing: false, timer: null, setting: false,
      get: opts.get || function () { return el.value; },
      set: opts.set || function (v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    el.__aip = P;
    if (P.ask) return attachAsk(P, el, opts, idA, pre);
    var bar = document.createElement('div');
    bar.className = 'aip-bar';
    bar.innerHTML =
      (opts.lengths ? '<span class="aip-len" role="group" aria-label="다듬을 길이">' + LENS.map(function (l) {
        return '<button type="button" class="btn btn--sm btn--ghost" data-polish-len="' + l[0] + '" aria-pressed="false">' + l[1] + '</button>';
      }).join('') + '</span>' : '') +
      (opts.left ? '<span class="muted-note aip-left"' + idA('Left') + '></span>' : '') +
      '<span class="aip-spacer"></span>' +
      '<button type="button" class="btn btn--sm btn--ghost aip-undo" data-aip="undo" hidden' + idA('Undo') + '>되돌리기</button>' +
      '<button type="button" class="btn btn--sm aip-btn" data-aip="polish"' + idA('Btn') + '>AI로 다듬기</button>';
    var box = document.createElement('div');
    box.className = 'aip-box';
    box.innerHTML =
      '<p class="aip-note" hidden></p>' +
      '<p class="cp-warn aip-msg" hidden' + idA('Msg') + '></p>' +
      '<div class="aip-result" hidden' + idA('Result') + '>' +
        '<div class="aip-cols">' +
          '<div class="aip-col aip-col--orig"><div class="aip-col__t">원래 글</div><div class="aip-text aip-text--orig"></div></div>' +
          '<div class="aip-col aip-col--new"><div class="aip-col__t aip-col__t--new"><span class="aip-col__name">다듬은 문장</span> <span class="sms-len aip-bytes"' + idA('Bytes') + '></span>' +
            '<span class="aip-col__right"><span class="aip-edited" hidden' + idA('Edited') + '>직접 고친 내용 있음</span>' +
            '<button type="button" class="aip-revert" data-aip="revertai" hidden' + idA('RevertAi') + '>AI 글로 되돌리기</button></span></div>' +
            '<textarea class="textarea aip-text aip-text--new" rows="6"' + idA('Text') + ' aria-label="AI 글 — 눌러서 직접 고칠 수 있습니다" spellcheck="false"></textarea></div>' +
        '</div>' +
        '<div class="aip-check" hidden><b>확인할 것</b><ul' + idA('Check') + '></ul></div>' +
        '<div class="aip-acts">' +
          '<button type="button" class="btn btn--sm btn--primary" data-aip="use"' + idA('Use') + '>이걸로 바꾸기</button>' +
          '<button type="button" class="btn btn--sm" data-aip="again"' + idA('Again') + '>다시 다듬기</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-aip="drop"' + idA('Drop') + '>그대로 두기</button>' +
        '</div>' +
        '<div class="aip-ask" role="group" aria-label="AI에게 고쳐 달라고 하기">' +
          '<div class="aip-ask__t">AI에게 고쳐 달라고 하기</div>' +
          '<div class="aip-quick">' + QUICK.map(function (q) {
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

  /* 코멘트 칸 — 칸 하나 · 부탁 한 줄 (20261106d) */
  function attachAsk(P, el, opts, idA, pre) {
    var bar = document.createElement('div');
    bar.className = 'aip-bar aip-bar--ask';
    bar.innerHTML = '<span class="aip-spacer"></span>' +
      '<button type="button" class="btn btn--sm btn--ghost aip-undo" data-ask="undo" hidden' + idA('Undo') + '>되돌리기</button>' +
      '<button type="button" class="btn btn--sm btn--ghost aip-clear" data-ask="clear"' + idA('Clear') + '>비우기</button>';
    var box = document.createElement('div');
    box.className = 'aip-box aip-askbox';
    if (pre) box.id = pre;
    box.innerHTML =
      '<p class="cp-warn aip-msg" role="alert" hidden' + idA('Msg') + '></p>' +
      '<details class="aip-check aip-check--fold" open hidden' + idA('CheckBox') + '><summary>확인할 것</summary><ul' + idA('Check') + '></ul></details>' +
      '<div class="aip-quick aip-quick--ask" role="group" aria-label="자주 쓰는 부탁">' + ASK_QUICK.map(function (q) {
        return '<button type="button" class="aip-q" data-ask-q="' + esc(q[1]) + '">' + esc(q[0]) + '</button>';
      }).join('') + '</div>' +
      '<div class="aip-askline">' +
        '<label class="aip-askline__t"' + (pre ? ' for="' + pre + 'Req"' : '') + '>AI에게 부탁하기</label>' +
        '<span class="aip-askline__row"><input type="text" class="input aip-req" maxlength="' + MAX_REQ + '" autocomplete="off"' + idA('Req') + ' placeholder="' + esc(ASK_EX) + '">' +
        '<button type="button" class="btn btn--sm btn--primary aip-send" data-ask-send' + idA('Send') + '>써 줘</button></span>' +
      '</div>' +
      '<p class="aip-note" hidden></p>';
    opts.host.appendChild(bar);
    el.parentNode.insertBefore(box, el.nextSibling);
    P.bar = bar; P.box = box;
    P.req = box.querySelector('.aip-req');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ask]');
      if (!b) return;
      if (b.dataset.ask === 'clear') clearText(P); else undoAsk(P);
    });
    box.addEventListener('click', function (e) {
      var q = e.target.closest('[data-ask-q]');
      if (q) { sendAsk(P, q.dataset.askQ, true); return; }
      if (e.target.closest('[data-ask-send]')) sendAsk(P, P.req.value, false);
    });
    P.req.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (!box.querySelector('.aip-send').disabled) sendAsk(P, P.req.value, false);
    });
    P.req.addEventListener('input', function () { draw(P); });
    document.addEventListener('input', function (e) {
      if (e.target !== fieldOf(P)) return;
      if (!P.setting && P.clearing) stopClear(P, true);
      draw(P);
    });
    all.push(P);
    draw(P);
    return P;
  }
  /* 글 칸은 다시 그릴 때 새로 만들어진다 — 늘 지금 칸을 본다 */
  function fieldOf(P) { return P.o.field ? P.o.field() : P.el; }
  function drawAsk(P) {
    var box = P.box, empty = isEmpty(P), noText = keepEmpty(P), n = P.check.length, req = P.req.value.trim();
    var cb = P.bar.querySelector('[data-ask="clear"]');
    cb.disabled = !!P.busy || empty;
    P.bar.querySelector('[data-ask="undo"]').hidden = P.undo == null;
    fieldOf(P).readOnly = !!P.busy;
    P.req.readOnly = !!P.busy;
    var send = box.querySelector('.aip-send');
    send.disabled = !!P.busy || (!noText && req.length < 2);
    send.textContent = P.busy ? '쓰는 중…' : '써 줘';
    Array.prototype.forEach.call(box.querySelectorAll('[data-ask-q]'), function (b) {
      b.disabled = !!P.busy || noText;
      b.title = noText ? '칸에 글이 있을 때 누를 수 있습니다' : '';
    });
    var ck = box.querySelector('.aip-check--fold');
    ck.hidden = !n;
    ck.querySelector('summary').textContent = '확인할 것 ' + n + '개';
    var ckh = P.check.slice(0, 2).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join(''), ul = ck.querySelector('ul');
    if (ul.innerHTML !== ckh) ul.innerHTML = ckh;
    var note = box.querySelector('.aip-note');
    note.hidden = !P.note; note.textContent = P.note || '';
    var msg = box.querySelector('.aip-msg');
    msg.hidden = !P.msg; msg.textContent = P.msg || '';
  }
  /* 칸에 넣기 — 저장 흐름은 그대로 · 「사람이 고쳤다」로 치지 않는다 */
  function put(P, v) { P.setting = true; try { P.set(v); } finally { P.setting = false; } }
  function stopClear(P, drop) {
    clearTimeout(P.timer);
    P.clearing = false;
    if (drop) P.undo = null;
  }
  function clearText(P) {
    if (P.busy || isEmpty(P)) return;
    stopClear(P);
    P.undo = String(P.get() || ''); P.clearing = true;
    P.check = []; P.note = ''; P.msg = '';
    put(P, '');
    P.timer = setTimeout(function () { stopClear(P, true); draw(P); }, 5000);
    draw(P);
    try { fieldOf(P).focus(); } catch (e) {}
  }
  function undoAsk(P) {
    if (P.busy || P.undo == null) return;
    var was = P.undo;
    stopClear(P, true);
    P.check = []; P.note = ''; P.msg = '';
    put(P, was);
    draw(P);
  }
  function askFail(P, res) {
    var why = String((res && (res.why || res.reason)) || 'server'), k = why.split(' ')[0];
    if (res && res.reason === 'input' && res.message) { P.msg = res.message; }
    else P.msg = ASK_FAIL + ' (' + (WHY_SHORT[k] || '함수 오류') + ')';
    if (window.console) console.warn('[AI 부탁] 실패', { reason: res && res.reason, why: res && res.why, status: res && res.status, detail: res && res.detail, message: res && res.message });
  }
  function sendAsk(P, request, quick) {
    if (P.busy) return;
    var req = String(request || '').replace(/\s+/g, ' ').trim(), noText = keepEmpty(P), cur = String(P.get() || '');
    if (quick && noText) return;
    if (!noText && req.length < 2) { P.msg = '어떻게 고칠지 적어 주세요'; draw(P); P.req.focus(); return; }
    var sc = scopeOf(P), tok = ++P.tok;
    stopClear(P, P.clearing);
    P.msg = ''; P.note = ''; P.busy = 'ask';
    draw(P);
    Promise.all([Promise.resolve(P.o.draft()).catch(function () { return null; }), memLoad(sc && sc.key)]).then(function (x) {
      if (tok !== P.tok) return null;
      var d = x[0], reqs = (x[1] || []).map(function (m) { return m.request; }), allReq = req ? reqs.concat([req]) : reqs;
      if (noText && !d) return { ok: false, reason: 'server', why: 'nofacts' };
      var facts = d ? exclude(d.facts, allReq) : null;
      var body = noText
        ? { action: 'draft', ask: true, target: d.target, kind: 'comment', facts: facts, requests: reqs, request: req }
        : { action: 'revise', ask: true, text: cur, request: req, requests: reqs, kind: 'comment' };
      if (!noText && facts) body.facts = facts;
      var note = noText && d && d.note ? d.note : '';
      return Promise.race([invoke(body), new Promise(function (ok) { setTimeout(function () { ok({ ok: false, reason: 'claude', why: 'timeout', detail: '화면에서 ' + ASK_WAIT / 1000 + '초 기다림' }); }, ASK_WAIT); })]).then(function (res) {
        if (res && res.ok) res.__note = note;
        return res;
      });
    }).then(function (res) {
      if (tok !== P.tok || res === null) return;
      P.busy = '';
      done(res);
      if (!res || !res.ok || typeof res.text !== 'string') { askFail(P, res); draw(P); return; }
      P.undo = cur; P.check = res.check || []; P.note = res.__note || ''; P.req.value = '';
      if (P.check.length) P.box.querySelector('.aip-check--fold').open = true;
      put(P, res.text);
      draw(P);
    }, function (e) {
      if (tok !== P.tok) return;
      P.busy = ''; askFail(P, { reason: 'network', detail: String((e && e.message) || e) }); draw(P);
    });
  }

  /* 다듬은 문장 칸만 — 직접 고친 내용 있음 · 바이트 */
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
    if (P.ask) { drawAsk(P); return; }
    var bar = P.bar, box = P.box;
    var empty = isEmpty(P);
    var pb = bar.querySelector('[data-aip="polish"]');
    pb.disabled = !!P.busy || empty;
    pb.textContent = P.busy === 'polish' ? '다듬는 중…' : 'AI로 다듬기';
    pb.title = empty ? '내용을 먼저 써 주세요' : '';
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
      box.querySelector('.aip-col--orig').hidden = !String(P.src || '').trim();
      box.querySelector('.aip-text--orig').textContent = P.src;
      var ck = box.querySelector('.aip-check');
      ck.hidden = !(r.check && r.check.length);
      ck.querySelector('ul').innerHTML = (r.check || []).slice(0, 2).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      box.querySelector('[data-aip="again"]').textContent = P.busy === 'again' ? '다듬는 중…' : '다시 다듬기';
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
    if (a === 'polish') run(P);
    else if (a === 'again') run(P, true);
    else if (a === 'use') use(P);
    else if (a === 'drop') { P.res = null; P.hist = []; draw(P); }
    else if (a === 'undo') { if (P.undo != null) { P.set(P.undo); P.undo = null; draw(P); } }
    else if (a === 'revertai') { P.ta.value = P.ai; drawEdit(P); }
    else if (a === 'revise') revise(P);
    else if (a === 'back') { var h = P.hist.pop(); if (h) { P.ta.value = h.text; P.ai = h.ai; if (h.check) P.res.check = h.check; draw(P); } }
  }

  function done(res) { if (res && res.cap != null && res.used != null) left = Math.max(0, res.cap - res.used); }
  function failMsg(res) { return res && res.reason === 'input' && res.message ? res.message : FAIL; }
  /* 결과를 다듬은 문장 칸에 (새 결과 — 고친 흔적 · 한 단계 전 기록은 처음부터) */
  function show(P, r) {
    P.res = r; P.ai = r.text; P.ta.value = r.text; P.hist = [];
    all.forEach(draw);
  }

  function run(P, again) {
    if (P.busy) return;
    var text = again ? P.src : String(P.get() || '');
    if (!text.trim()) { draw(P); return; }
    P.msg = ''; P.note = ''; P.busy = again ? 'again' : 'polish';
    var tok = ++P.tok;
    draw(P);
    invoke({ text: text, kind: P.o.kind || 'general', length: P.o.lengths ? P.len : 'normal' }).then(function (res) {
      if (tok !== P.tok) return;
      P.busy = '';
      done(res);
      if (!res || !res.ok || typeof res.text !== 'string') {
        P.res = null;
        P.msg = failMsg(res);
        all.forEach(draw);
        return;
      }
      P.src = text;
      show(P, { text: res.text, check: res.check || [], bytes: res.bytes || 0 });
    });
  }

  /* 「AI에게 고쳐 달라고 하기」 — 지금 글(손으로 고친 것 포함)을 요청대로 */
  function revise(P) {
    if (P.busy || !P.res) return;
    var req = P.req.value.replace(/\s+/g, ' ').trim();
    if (req.length < 2) { P.msg = '어떻게 고칠지 적어 주세요'; draw(P); P.req.focus(); return; }
    if (req.length > MAX_REQ) { P.msg = '요청은 ' + MAX_REQ + '자까지 쓸 수 있습니다'; draw(P); return; }
    var now = P.ta.value;
    if (!now.trim()) { P.msg = '고칠 글이 없습니다'; draw(P); return; }
    var sc = scopeOf(P), remember = !!(sc && P.box.querySelector('.aip-remember input').checked);
    P.msg = ''; P.busy = 'revise';
    var tok = ++P.tok;
    draw(P);
    memLoad(sc && sc.key).then(function (list) {
      var reqs = (list || []).map(function (m) { return m.request; });
      var body = { action: 'revise', text: now, request: req, requests: reqs, kind: P.o.kind || 'general', orig: String(P.src || '') };
      if (tok !== P.tok) return null;
      return invoke(body).then(function (res) {
        if (tok !== P.tok) return;
        P.busy = '';
        done(res);
        if (!res || !res.ok || typeof res.text !== 'string') { P.msg = failMsg(res); all.forEach(draw); return; }
        P.hist.push({ text: now, ai: P.ai, check: P.res.check });
        var nt = res.text;
        P.ai = nt; P.ta.value = nt; P.res.check = res.check || [];
        P.req.value = '';
        var rm = P.box.querySelector('.aip-remember input');
        var after = function () { all.forEach(draw); };
        if (remember) memAdd(sc.key, req).then(function (ok) { if (ok) { rm.checked = false; if (window.UI) UI.toast('「' + req + '」를 이 ' + (sc.label || '반') + ' 기본 요청으로 기억했습니다 — 다음부터 처음부터 따릅니다', 'good'); } after(); });
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
    P.tok++;
    if (P.ask) { stopClear(P); P.check = []; if (P.req) P.req.value = ''; }
    P.res = null; P.undo = null; P.msg = ''; P.note = ''; P.busy = ''; P.hist = [];
    draw(P);
  }
  function refresh(el) { var P = find(el); if (P) draw(P); }

  /* 코드가 값을 바꾼 칸도 비었는지 알아보게 — 가볍게 자주 (붙인 칸 몇 개뿐) */
  setInterval(function () { all.forEach(function (P) { if (!P.busy && P.bar.isConnected) { if (P.ask) { drawAsk(P); return; } var pb = P.bar.querySelector('[data-aip="polish"]'); if (pb.disabled !== isEmpty(P)) draw(P); } }); }, 700);
  window.addEventListener('jt:ai-requests', function () { all.forEach(function (P) { if (P.res && !P.ask) drawMem(P); }); });

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
