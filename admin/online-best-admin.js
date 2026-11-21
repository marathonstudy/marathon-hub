/* ============================================================
   online-best-admin.js — 코치룸 학생 카드 「🏅 우수 수행 관리」 (20261118b · 직원만 · 온라인 반 학생만)
     · 러닝노트 「우수 수행」 탭에 나가는 우수 오답정리 · 우수 지문 장악(점수 높은 순 · 학생에게는 3개) — 항목 [숨김] · 사진마다 [사진 숨김](얼굴이 나온 사진 등)
     · 우수 질문 — 학생 글에서 「질문 후보」를 자동으로 찾고 직원이 골라야 공개(자동 공개 없음) · 앱이 학생 메시지 · 댓글을 아직 안 보내 「앱 연결 준비 중」
   서버: staff_best(학생 · 숨긴 것도) · online_mark_set(학생, item | photo | q, 열쇠, hide | pick | '') — migration-120
   다른 학생과 비교 · 순위 없음
   ============================================================ */
(function () {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sb() { return window.SB && SB.client; }
  function md(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function stu(sid) { return window.Store ? Store.getStudents().find(function (x) { return x.id === sid; }) : null; }
  var B = { sid: '', open: false, data: null, busy: false, err: '', ai: {}, wait: false };

  function isOnline(sid) { var s = stu(sid) || {}; return !!(window.OnlineClass && OnlineClass.isOnline(s.className || s.class_name)); }
  function load(sid) {
    var c = sb();
    if (!c) return;
    B.busy = true; B.err = '';
    paint();
    Promise.resolve(c.rpc('staff_best', { p_student: sid })).then(function (r) {
      if (B.sid !== sid) return;
      B.busy = false;
      if (r && r.error) B.err = /Could not find the function|schema cache/i.test(r.error.message || '') ? 'migration-120 SQL 을 먼저 실행해 주세요' : (window.ErrKo ? ErrKo.ko(r.error) : r.error.message);
      else B.data = r && r.data ? r.data : { wrong: [], text: [], q: { ready: false } };
      paint();
      if (B.data && !B.err) autoDraft(sid);                       /* 선정 이유 AI 초안 — 카드 하나에 한 번 (20261120d) */
    }, function (e) { B.busy = false; B.err = window.ErrKo ? ErrKo.ko(e) : '불러오지 못했어요'; paint(); });
  }
  /* 선정 이유 (20261120d · migration-126 · 함수 online-best) — 사람 피드백이 없거나 한 줄 이하인 카드만
     AI 초안(카드 하나에 한 번 · 저장 · 다시 부르지 않음) → 직원이 고치고 [확인]해야 학생 · 학부모 화면에 · 확인 전에는 「선정 이유 준비 중」
     [다시 쓰기] — 사진이 연결된 뒤 사진 근거로 새 초안(확인한 글은 다시 [확인]할 때까지 그대로) · 크레딧 부족은 다시 시도하지 않고 「AI 크레딧 부족」 */
  var ERR = { credit: 'AI 크레딧 부족', nokey: 'AI 연결 설정 필요(Supabase Secrets)', ai: '초안을 만들지 못했어요', input: '초안을 만들지 못했어요', auth: '권한을 확인하지 못했어요', fn: 'migration-126 SQL · 함수 online-best 배포가 먼저예요' };
  function clean(t) { return window.OnlineRun && OnlineRun.cleanTitle ? OnlineRun.cleanTitle(t) : String(t || ''); }
  function whyHtml(x, sid, kind) {
    if (x.need === false) return '';
    var n = x.note || {}, run = B.ai[kind + x.key] === 'run', txt = n.state === 'ok' ? n.final : n.draft;
    var st = run ? 'AI 초안 만드는 중…' : n.err ? ERR[n.err] || ERR.ai : n.state === 'ok' ? '확인함 · 학생 · 학부모 화면에 보여요' + (n.draft && n.draft !== n.final ? ' (새 초안은 확인 전)' : '') : n.draft ? '확인 전 · 학생 · 학부모 화면은 「선정 이유 준비 중」' : '초안 없음';
    var id = esc(kind + '|' + x.key);
    return '<div class="oba-why" id="obaWhy-' + esc(kind + '-' + x.key.replace(/[^0-9A-Za-z]/g, '')) + '"><p class="oba-why__h"><b>선정 이유</b> <span class="oba-why__st' + (n.err ? ' is-err' : n.state === 'ok' ? ' is-ok' : '') + '">' + esc(st) + '</span>' +
      (n.photo ? ' <span class="oba-tag">사진 보고 씀</span>' : n.draft ? ' <span class="oba-tag">사진 없이 씀</span>' : '') + '</p>' +
      '<textarea class="oba-why__t" rows="4" maxlength="1000" data-oba-txt="' + id + '" aria-label="선정 이유 고치기"' + (run ? ' disabled' : '') + '>' + esc(n.state === 'ok' && n.draft && n.draft !== n.final ? n.draft : txt || '') + '</textarea>' +
      '<div class="oba-why__b"><button type="button" class="btn btn--sm btn--primary" data-oba-ok="' + esc(sid + '|' + id) + '"' + (run ? ' disabled' : '') + '>확인</button>' +
        (n.state === 'ok' ? '<button type="button" class="btn btn--sm btn--ghost" data-oba-unok="' + esc(sid + '|' + id) + '">확인 풀기</button>' : '') +
        '<button type="button" class="btn btn--sm" data-oba-ai="' + esc(sid + '|' + id) + '"' + (run ? ' disabled' : '') + '>' + (n.draft || n.err ? '다시 쓰기' + (x.app && !n.photo ? ' (사진 보고)' : '') : 'AI 초안 받기') + '</button></div>' +
      '<p class="sc-hint">사진에서 확인되는 것만 · 다른 학생과 비교 · 과장 · 「꼭 · 반드시 · 무조건」 없이 · [확인]해야 학생 · 학부모에게 보여요</p></div>';
  }
  function rowHtml(x, sid, kind) {
    var ref = esc(sid + '|item|' + x.key), lab = kind === 'wrong' ? '오답정리' : '지문 장악';
    return '<li class="oba-it' + (x.hidden ? ' is-hidden' : '') + '"><div class="oba-it__h"><span class="muted-note num">' + esc(md(x.day)) + (x.sday && x.sday !== x.day ? ' · ' + esc(md(x.sday)) + ' 제출' : '') + '</span>' +
      '<b class="oba-it__t" title="' + esc(x.title || '') + '">' + esc(clean(x.title) || '지문') + '</b><span class="oba-s num">' + lab + ' ' + esc(x.s) + '점</span>' +
      (x.hidden ? '<span class="oba-tag">숨김</span>' : '') +
      '<button type="button" class="btn btn--sm" data-oba-mark="' + ref + '|' + (x.hidden ? '' : 'hide') + '">' + (x.hidden ? '다시 보이기' : '숨김') + '</button></div>' +
      ((x.photos || []).length ? '<div class="oba-ph ob-ph">' + x.photos.map(function (p, i) {
        return '<span class="oba-ph__i' + (p.hidden ? ' is-hidden' : '') + '"><button type="button" class="ob-ph__b" data-ob-ph="' + esc(x.key + '|' + p.i) + '" data-ob-kind="' + (p.kind === 'pdf' ? 'pdf' : 'image') + '" data-ob-d="' + esc(x.day || '') + '"' +
            (p.id ? ' data-ob-id="' + esc(p.id) + '" data-ob-day="' + esc(x.sday || x.day) + '"' : '') + ' aria-label="' + (p.kind === 'pdf' ? 'PDF' : '사진') + ' ' + (i + 1) + ' 크게 보기"><span class="ob-ph__w">' + (p.kind === 'pdf' ? 'PDF' : '사진') + ' ' + (i + 1) + '</span></button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-oba-mark="' + esc(sid + '|photo|' + (p.ref || p.id)) + '|' + (p.hidden ? '' : 'hide') + '">' + (p.hidden ? '사진 보이기' : '사진 숨김') + '</button></span>';
      }).join('') + '<button type="button" class="btn btn--sm btn--ghost" data-oba-see="' + esc(sid + '|' + (x.sday || x.day)) + '">제출물 보기</button></div>' : '') +
      (x.fb ? '<p class="oba-fb">선생님 한마디: ' + esc(x.fb) + '</p>' : '') + whyHtml(x, sid, kind) + '</li>';
  }
  function bodyHtml(sid) {
    if (B.busy && !B.data) return '<p class="sc-hint">불러오는 중…</p>';
    if (B.err) return '<p class="sc-hint" role="alert">' + esc(B.err) + ' <button type="button" class="btn btn--sm" data-oba-load="' + esc(sid) + '">다시 시도</button></p>';
    var d = B.data || {}, part = function (t, list, kind) {
      return '<h4 class="oba-h">' + t + '</h4>' + ((list || []).length ? '<ol class="oba-list">' + list.map(function (x) { return rowHtml(x, sid, kind); }).join('') + '</ol>' : '<p class="sc-hint">선생님 점수가 매겨진 제출이 아직 없어요</p>');
    };
    return '<p class="sc-hint">러닝노트 「우수 수행」에는 숨기지 않은 것 중 점수 높은 3개만 나가요 · 다른 학생과 비교하지 않아요 · 카드 날짜는 지문 날짜</p>' +
      (B.wait ? '<p class="sc-hint oba-wait">📷 앱 사진 연결 준비 중 — 앱에 사진 주소(/api/hub/submission-file)가 생기면 코드 수정 없이 바로 보여요</p>' : '') +
      part('🏅 우수 오답정리', d.wrong, 'wrong') + part('🔍 우수 지문 장악', d.text, 'text') +
      '<h4 class="oba-h">💬 우수 질문</h4>' + (d.q && d.q.ready
        ? '<p class="sc-hint">학생 글에서 찾은 「질문 후보」 중 골라야 러닝노트에 보여요(자동 공개 없음)</p>'
        : '<p class="sc-hint">앱 연결 준비 중 — 숙제 제출 메시지 · 선생님 피드백 원문 · 댓글을 앱이 아직 보내지 않아요(Replit 요청서). 연결되면 물음표 · 「궁금 · 모르겠 · 왜 · 어떻게 · 질문」이 든 글을 「질문 후보」로 보여 주고, 직원이 고른 것만 공개해요.</p>');
  }
  function html(sid) {
    if (!sid || !isOnline(sid)) return '';
    if (B.sid !== sid) B = { sid: sid, open: false, data: null, busy: false, err: '', ai: {}, wait: false };
    if (B.open && B.data) setTimeout(afterPaint, 0);                    /* 학생 카드가 다시 그려져도 사진을 붙인다 */
    return '<section class="sc-sec sc-best" id="scBest" aria-label="우수 수행 관리"><h3 class="sc-t">🏅 우수 수행 관리 ' +
      '<button type="button" class="btn btn--sm btn--ghost" data-oba-open="' + esc(sid) + '" aria-expanded="' + B.open + '">' + (B.open ? '접기' : '열기') + '</button></h3>' +
      (B.open ? bodyHtml(sid) : '<p class="sc-hint">러닝노트 「우수 수행」 탭에 나갈 제출물 · 사진을 숨기거나 우수 질문을 골라요</p>') + '</section>';
  }
  function paint() {
    var el = document.getElementById('scBest');
    if (!el || !B.sid) return;
    var w = document.createElement('div'); w.innerHTML = html(B.sid);
    if (w.firstChild) el.parentNode.replaceChild(w.firstChild, el);
  }
  /* ---------- 20261120d 사진 · 선정 이유 ---------- */
  function fns() { var c = sb(); return c && c.functions && c.functions.invoke ? c.functions : null; }
  function staffFiles(sid) {
    return function (items) {
      var f = fns();
      if (!f) return Promise.resolve(null);
      return Promise.resolve(f.invoke('online-best', { body: { action: 'files', student: sid, items: items } })).then(function (r) { return r && !r.error && r.data && r.data.ok ? r.data : null; }, function () { return null; });
    };
  }
  var mounting = null;
  function afterPaint() {
    var el = document.getElementById('scBest');
    if (!el || !B.open || !B.data || !window.OnlineBest || el.__obMounted) return;
    el.__obMounted = 1;
    var sid = B.sid;
    mounting = OnlineBest.mountPhotos(el, '', { staffFiles: staffFiles(sid) }).then(function (res) {
      if (B.sid !== sid || !res || !res.wait || B.wait) return;
      B.wait = true;
      var h = el.querySelector('.sc-hint');
      if (h && !el.querySelector('.oba-wait')) { var p = document.createElement('p'); p.className = 'sc-hint oba-wait'; p.textContent = '📷 앱 사진 연결 준비 중 — 앱에 사진 주소(/api/hub/submission-file)가 생기면 코드 수정 없이 바로 보여요'; h.parentNode.insertBefore(p, h.nextSibling); }
    });
  }
  function itemOf(kind, key) { return ((B.data && B.data[kind]) || []).filter(function (x) { return x.key === key; })[0] || null; }
  function paintWhy(sid, kind, x) {
    var el = document.getElementById('obaWhy-' + kind + '-' + x.key.replace(/[^0-9A-Za-z]/g, ''));
    if (!el) return;
    var w = document.createElement('div'); w.innerHTML = whyHtml(x, sid, kind);
    if (w.firstChild) el.parentNode.replaceChild(w.firstChild, el);
  }
  function draft(sid, kind, x, force) {
    var f = fns();
    if (!f || !x) return Promise.resolve();
    B.ai[kind + x.key] = 'run'; paintWhy(sid, kind, x);
    return Promise.resolve(f.invoke('online-best', { body: { action: 'draft', student: sid, kind: kind, key: x.key, force: !!force } })).then(function (r) {
      var d = r && !r.error && r.data ? r.data : { ok: false, reason: 'fn' };
      delete B.ai[kind + x.key];
      var n = x.note || (x.note = { draft: '', final: '', state: 'none', photo: false, err: '' });
      if (d.ok && d.draft) { n.draft = d.draft; n.photo = !!d.photo; n.err = ''; if (n.state === 'none') n.state = 'draft'; }
      else if (d.ok && d.saved && d.note) x.note = d.note;
      else if (!d.ok) n.err = d.reason || 'ai';
      paintWhy(sid, kind, x);
      if (!d.ok && d.reason === 'credit' && window.UI) UI.toast('AI 크레딧 부족 — 초안을 만들지 못했어요(다시 시도하지 않아요)', 'bad');
    }, function () { delete B.ai[kind + x.key]; (x.note = x.note || { draft: '', final: '', state: 'none' }).err = 'fn'; paintWhy(sid, kind, x); });
  }
  /* 처음 열 때 — 학생 화면에 나가는 카드(숨기지 않은 위 3개)만 · 초안 · 오류가 없는 것만 차례로 한 번 */
  function autoDraft(sid) {
    var d = B.data || {}, todo = [];
    ['wrong', 'text'].forEach(function (k) {
      (d[k] || []).filter(function (x) { return !x.hidden; }).slice(0, 3).forEach(function (x) {
        if (x.need !== false && !(x.note && (String(x.note.draft || '').trim() || x.note.err))) todo.push([k, x]);
      });
    });
    var next = function () { if (B.sid !== sid || !B.open || !todo.length) return; var t = todo.shift(); draft(sid, t[0], t[1], false).then(next); };
    next();
  }
  function txtOf(kind, key) {
    var id = kind + '|' + key, el = Array.prototype.filter.call(document.querySelectorAll('[data-oba-txt]'), function (x) { return x.getAttribute('data-oba-txt') === id; })[0];
    return el ? el.value : '';
  }
  function confirmNote(sid, kind, key, ok) {
    var c = sb(), x = itemOf(kind, key);
    if (!c || !x) return;
    var t = txtOf(kind, key).trim();
    if (ok && !t) { if (window.UI) UI.toast('선정 이유를 먼저 써 주세요', 'bad'); return; }
    Promise.resolve(c.rpc('best_note_set', { p_student: sid, p_kind: kind, p_key: key, p_text: t, p_ok: !!ok })).then(function (r) {
      if (r && r.error) { if (window.UI) UI.toast(/best_note_set|function/.test(r.error.message || '') ? 'migration-126 SQL 을 먼저 실행해 주세요' : '저장하지 못했어요 — ' + (window.ErrKo ? ErrKo.ko(r.error) : r.error.message), 'bad'); return; }
      var n = x.note || (x.note = {});
      n.draft = t; n.final = ok ? t : ''; n.state = ok ? 'ok' : t ? 'draft' : 'none'; n.err = '';
      paintWhy(sid, kind, x);
      if (window.UI) UI.toast(ok ? '확인했어요 · 학생 · 학부모 화면에 보여요' : '확인을 풀었어요 · 학생 · 학부모 화면은 「선정 이유 준비 중」', 'good');
    }, function () { if (window.UI) UI.toast('저장하지 못했어요', 'bad'); });
  }
  function mark(sid, kind, ref, state) {
    var c = sb();
    if (!c) return;
    Promise.resolve(c.rpc('online_mark_set', { p_student: sid, p_kind: kind, p_ref: ref, p_state: state })).then(function (r) {
      if (r && r.error) { if (window.UI) UI.toast('바꾸지 못했어요 — ' + (window.ErrKo ? ErrKo.ko(r.error) : r.error.message), 'bad'); return; }
      if (window.UI) UI.toast(state === 'hide' ? '학생 · 학부모 화면에서 숨겼어요' : state === 'pick' ? '우수 질문으로 골랐어요' : '다시 보이게 했어요', 'good');
      load(sid);
    }, function () { if (window.UI) UI.toast('바꾸지 못했어요', 'bad'); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target, b;
    if (!t.closest) return;
    b = t.closest('[data-oba-open]');
    if (b) { var sid = b.getAttribute('data-oba-open'); B.open = !B.open; if (B.open && !B.data) load(sid); else paint(); return; }
    b = t.closest('[data-oba-load]');
    if (b) { load(b.getAttribute('data-oba-load')); return; }
    b = t.closest('[data-oba-mark]');
    if (b) { var p = b.getAttribute('data-oba-mark').split('|'); mark(p[0], p[1], p.slice(2, -1).join('|'), p[p.length - 1]); return; }
    b = t.closest('[data-oba-see]');
    if (b) { var q = b.getAttribute('data-oba-see').split('|'); if (window.SubView && SubView.openStaff) SubView.openStaff({ student: q[0], from: q[1], to: q[1], title: md(q[1]) }); return; }
    b = t.closest('[data-oba-ok]') || t.closest('[data-oba-unok]') || t.closest('[data-oba-ai]');
    if (b && !b.disabled) {
      var at = b.hasAttribute('data-oba-ok') ? 'data-oba-ok' : b.hasAttribute('data-oba-unok') ? 'data-oba-unok' : 'data-oba-ai';
      var v = b.getAttribute(at).split('|'), s0 = v[0], k0 = v[1], key0 = v.slice(2).join('|');
      if (at === 'data-oba-ai') draft(s0, k0, itemOf(k0, key0), true);
      else confirmNote(s0, k0, key0, at === 'data-oba-ok');
    }
  });
  window.OnlineBestAdmin = { html: html, state: function () { return B; }, whyHtml: whyHtml, rowHtml: rowHtml };
})();
