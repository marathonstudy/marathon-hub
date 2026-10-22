/* ============================================================
   aipolish.js — 글 칸 「AI로 다듬기」 · 「AI로 초안 쓰기」 공통 부품 (Edge Function text-polish · migration-026 · 20261029g)

   AiPolish.attach(칸, 옵션) — 학생 · 학부모가 읽는 여러 줄 글 칸 하나에 붙인다. 모든 칸이 같은 모양 · 같은 동작이다.
     · 칸 오른쪽 위 [AI로 다듬기] (내용이 비어 있으면 누를 수 없다) · 코멘트 칸은 옆에 [AI로 초안 쓰기]
     · 결과는 원래 글과 나란히 — [이걸로 바꾸기] [다시 다듬기] [그대로 두기], 바꾼 뒤에는 [되돌리기]
     · 다듬는 동안 「다듬는 중…」, 실패하면 「지금은 다듬기가 안 됩니다. 잠시 뒤 다시 눌러 주세요.」 (원래 글은 그대로)
     · 초안 — 칸이 비어 있으면 바로 넣고(되돌리기 됨), 글이 있으면 나란히 보여 주고 고르게 한다
   옵션
     kind     sms(짧게, 메신저용) · notice(학생이 바로 알아보게) · comment(주간 코멘트) · lessons(차시 줄) · general
     lengths  true 면 길이(짧게 · 보통 · 자세히, 기본 보통) — 문자 보내기
     left     true 면 버튼 옆에 「이번 달 n회 남음」
     id       버튼 · 칸 id 앞부분 (시험 · 다른 코드가 찾을 때) — 예) 'smsAi' → #smsAiBtn #smsAiResult …
     draft    function() → Promise<{ target: 'class'|'student', facts: {…}, note: '안내 한 줄' } | null>  (있으면 [AI로 초안 쓰기])
     isEmpty  function() → 초안을 바로 넣어도 되는 빈 칸인가 (기본: 칸 글이 비었는가)
     get/set  칸이 textarea 가 아닐 때 (수업 내용 차시 줄 묶음) — 글 읽기 · 쓰기
     host     get/set 일 때 버튼 줄 · 결과를 붙일 자리
   Claude 에는 칸 글(또는 화면이 모은 자료)만 간다. 학생 이름 · 전화번호는 보내지 않는다.
   ============================================================ */

(function () {
  'use strict';

  var FN = 'text-polish';
  var FAIL = '지금은 다듬기가 안 됩니다. 잠시 뒤 다시 눌러 주세요.';
  var LENS = [['short', '짧게'], ['normal', '보통'], ['long', '자세히']];
  var all = [];
  var left = null;

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
    return Promise.resolve(sb().rpc('polish_status')).then(function (r) {
      left = r && !r.error && r.data ? Math.max(0, (r.data.cap || 0) - (r.data.used || 0)) : null;
      all.forEach(draw);
    }, function () { left = null; });
  }

  function attach(el, opts) {
    opts = opts || {};
    if (!el || el.__aip) return el && el.__aip;
    var pre = opts.id || '';
    var P = {
      el: el, o: opts, len: 'normal', busy: '', res: null, undo: null, src: '', msg: '', note: '',
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
      (opts.left ? '<span class="muted-note aip-left"' + (pre ? ' id="' + pre + 'Left"' : '') + '></span>' : '') +
      '<span class="aip-spacer"></span>' +
      '<button type="button" class="btn btn--sm btn--ghost aip-undo" data-aip="undo" hidden' + (pre ? ' id="' + pre + 'Undo"' : '') + '>되돌리기</button>' +
      (opts.draft ? '<button type="button" class="btn btn--sm aip-btn aip-btn--draft" data-aip="draft"' + (pre ? ' id="' + pre + 'Draft"' : '') + '>AI로 초안 쓰기</button>' : '') +
      '<button type="button" class="btn btn--sm aip-btn" data-aip="polish"' + (pre ? ' id="' + pre + 'Btn"' : '') + '>AI로 다듬기</button>';
    var box = document.createElement('div');
    box.className = 'aip-box';
    box.innerHTML =
      '<p class="aip-note" hidden></p>' +
      '<p class="cp-warn aip-msg" hidden' + (pre ? ' id="' + pre + 'Msg"' : '') + '></p>' +
      '<div class="aip-result" hidden' + (pre ? ' id="' + pre + 'Result"' : '') + '>' +
        '<div class="aip-cols">' +
          '<div class="aip-col"><div class="aip-col__t">원래 글</div><div class="aip-text aip-text--orig"></div></div>' +
          '<div class="aip-col aip-col--new"><div class="aip-col__t aip-col__t--new">다듬은 문장 <span class="sms-len aip-bytes"' + (pre ? ' id="' + pre + 'Bytes"' : '') + '></span></div>' +
            '<div class="aip-text aip-text--new"' + (pre ? ' id="' + pre + 'Text"' : '') + '></div></div>' +
        '</div>' +
        '<div class="aip-check" hidden><b>확인할 것</b><ul' + (pre ? ' id="' + pre + 'Check"' : '') + '></ul></div>' +
        '<div class="aip-acts">' +
          '<button type="button" class="btn btn--sm btn--primary" data-aip="use"' + (pre ? ' id="' + pre + 'Use"' : '') + '>이걸로 바꾸기</button>' +
          '<button type="button" class="btn btn--sm" data-aip="again"' + (pre ? ' id="' + pre + 'Again"' : '') + '>다시 다듬기</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-aip="drop"' + (pre ? ' id="' + pre + 'Drop"' : '') + '>그대로 두기</button>' +
        '</div>' +
        '<p class="field__hint">AI가 고친 글입니다. 날짜 · 시간 · 숫자 · 이름을 한 번 더 확인해 주세요.</p>' +
      '</div>';
    if (opts.host) { opts.host.appendChild(bar); opts.host.appendChild(box); }
    else { el.parentNode.insertBefore(bar, el); el.parentNode.insertBefore(box, el.nextSibling); }
    if (pre) box.id = pre;
    P.bar = bar; P.box = box;
    bar.addEventListener('click', function (e) { onClick(P, e); });
    box.addEventListener('click', function (e) { onClick(P, e); });
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
      box.querySelector('.aip-text--orig').textContent = P.src;
      box.querySelector('.aip-text--new').textContent = r.text;
      box.querySelector('.aip-col__t--new').firstChild.textContent = r.draft ? '초안 ' : '다듬은 문장 ';
      box.querySelector('.aip-bytes').textContent = P.o.kind === 'sms' ? r.bytes + '바이트' + (r.bytes <= 90 ? ' · 단문 크기' : '') : '';
      var ck = box.querySelector('.aip-check');
      ck.hidden = !(r.check && r.check.length);
      ck.querySelector('ul').innerHTML = (r.check || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      box.querySelector('[data-aip="again"]').textContent = r.draft ? '다시 쓰기' : '다시 다듬기';
    }
  }

  function onClick(P, e) {
    var lb = e.target.closest('[data-polish-len]');
    if (lb) { P.len = lb.dataset.polishLen; draw(P); return; }
    var b = e.target.closest('[data-aip]');
    if (!b) return;
    var a = b.dataset.aip;
    if (a === 'polish') run(P, false);
    else if (a === 'draft') run(P, true);
    else if (a === 'again') run(P, !!(P.res && P.res.draft), true);
    else if (a === 'use') use(P);
    else if (a === 'drop') { P.res = null; draw(P); }
    else if (a === 'undo') { if (P.undo != null) { P.set(P.undo); P.undo = null; draw(P); } }
  }

  function run(P, isDraft, again) {
    if (P.busy) return;
    var text = again && !isDraft ? P.src : String(P.get() || '');
    if (!isDraft && !text.trim()) { draw(P); return; }
    P.msg = ''; P.note = ''; P.busy = isDraft ? 'draft' : 'polish';
    draw(P);
    var prep = isDraft ? Promise.resolve(P.o.draft()).catch(function () { return null; }) : Promise.resolve(null);
    prep.then(function (d) {
      if (isDraft && !d) { P.busy = ''; P.msg = FAIL; draw(P); return null; }
      if (d && d.note) P.note = d.note;
      var body = isDraft
        ? { action: 'draft', target: d.target, facts: d.facts }
        : { text: text, kind: P.o.kind || 'general', length: P.o.lengths ? P.len : 'normal' };
      return invoke(body).then(function (res) {
        P.busy = '';
        if (res && res.cap != null && res.used != null) left = Math.max(0, res.cap - res.used);
        if (!res || !res.ok || typeof res.text !== 'string') {
          P.res = null;
          P.msg = res && res.reason === 'input' && res.message ? res.message : FAIL;
          all.forEach(draw);
          return;
        }
        var cur = String(P.get() || '');
        var r = { text: res.text, check: res.check || [], bytes: res.bytes || 0, draft: isDraft };
        /* 초안 — 칸이 비어 있으면 바로 넣는다 (되돌리기 됨) */
        if (isDraft && (P.o.isEmpty ? P.o.isEmpty() : !cur.trim())) {
          P.undo = cur; P.res = null; P.set(r.text);
          if (r.check.length) P.note = (P.note ? P.note + ' · ' : '') + '확인할 것: ' + r.check.join(' · ');
        } else {
          P.src = isDraft ? cur : text;
          P.res = r;
        }
        all.forEach(draw);
      });
    });
  }

  function use(P) {
    if (!P.res) return;
    P.undo = String(P.get() || '');
    P.set(P.res.text);
    P.res = null;
    draw(P);
  }

  /* 칸 글을 코드가 바꿨을 때(다른 학생 · 다른 주) — 결과 · 되돌리기를 지운다. 칸 또는 붙일 때 준 id */
  function find(x) { return typeof x === 'string' ? all.filter(function (p) { return p.o.id === x; })[0] : x && x.__aip; }
  function reset(el) {
    var P = find(el);
    if (!P) return;
    P.res = null; P.undo = null; P.msg = ''; P.note = ''; P.busy = '';
    draw(P);
  }
  function refresh(el) { var P = find(el); if (P) draw(P); }

  /* 코드가 값을 바꾼 칸도 비었는지 알아보게 — 가볍게 자주 (붙인 칸 몇 개뿐) */
  setInterval(function () { all.forEach(function (P) { if (!P.busy && P.bar.isConnected) { var pb = P.bar.querySelector('[data-aip="polish"]'); if (pb.disabled !== isEmpty(P)) draw(P); } }); }, 700);

  /* 늘 있는 칸 — 반 공지 · 교재 납부 안내 · 문자 · 카톡 인사말 · 코멘트 상용구.
     문자 내용(sms.js) · 반 공통 코멘트 · 학생 코멘트 · 수업 내용(write.js)은 그 파일이 붙인다 */
  var STATIC = [
    ['ntSpecial', 'notice'], ['ntCurriculum', 'notice'], ['ntLiterature', 'notice'], ['ntReading', 'notice'], ['ntHomework', 'notice'], ['ntNotes', 'notice'],
    ['tbTemplate', 'sms'], ['tbNoticeText', 'sms'], ['greetingText', 'sms'], ['snipNew', 'comment']
  ];
  STATIC.forEach(function (x) { var el = document.getElementById(x[0]); if (el) attach(el, { kind: x[1], id: x[0] + 'Ai' }); });

  window.AiPolish = { attach: attach, reset: reset, refresh: refresh, loadLeft: loadLeft, FAIL: FAIL };
})();
