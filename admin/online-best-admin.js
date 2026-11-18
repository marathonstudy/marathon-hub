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
  var B = { sid: '', open: false, data: null, busy: false, err: '' };

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
    }, function (e) { B.busy = false; B.err = window.ErrKo ? ErrKo.ko(e) : '불러오지 못했어요'; paint(); });
  }
  function rowHtml(x, sid) {
    var ref = esc(sid + '|item|' + x.key);
    return '<li class="oba-it' + (x.hidden ? ' is-hidden' : '') + '"><div class="oba-it__h"><span class="muted-note num">' + esc(md(x.day)) + '</span><b>' + esc(x.title || '지문') + '</b><span class="oba-s num">' + esc(x.s) + '점</span>' +
      (x.hidden ? '<span class="oba-tag">숨김</span>' : '') +
      '<button type="button" class="btn btn--sm" data-oba-mark="' + ref + '|' + (x.hidden ? '' : 'hide') + '">' + (x.hidden ? '다시 보이기' : '숨김') + '</button></div>' +
      ((x.photos || []).length ? '<div class="oba-ph">' + x.photos.map(function (p, i) {
        return '<span class="oba-ph__i' + (p.hidden ? ' is-hidden' : '') + '">' + (p.kind === 'pdf' ? 'PDF' : '사진') + ' ' + (i + 1) +
          '<button type="button" class="btn btn--sm btn--ghost" data-oba-mark="' + esc(sid + '|photo|' + p.id) + '|' + (p.hidden ? '' : 'hide') + '">' + (p.hidden ? '사진 보이기' : '사진 숨김') + '</button></span>';
      }).join('') + '<button type="button" class="btn btn--sm btn--ghost" data-oba-see="' + esc(sid + '|' + x.day) + '">사진 보기</button></div>' : '') +
      (x.fb ? '<p class="oba-fb">선생님 한마디: ' + esc(x.fb) + '</p>' : '') + '</li>';
  }
  function bodyHtml(sid) {
    if (B.busy && !B.data) return '<p class="sc-hint">불러오는 중…</p>';
    if (B.err) return '<p class="sc-hint" role="alert">' + esc(B.err) + ' <button type="button" class="btn btn--sm" data-oba-load="' + esc(sid) + '">다시 시도</button></p>';
    var d = B.data || {}, part = function (t, list) {
      return '<h4 class="oba-h">' + t + '</h4>' + ((list || []).length ? '<ol class="oba-list">' + list.map(function (x) { return rowHtml(x, sid); }).join('') + '</ol>' : '<p class="sc-hint">선생님 점수가 매겨진 제출이 아직 없어요</p>');
    };
    return '<p class="sc-hint">러닝노트 「우수 수행」에는 숨기지 않은 것 중 점수 높은 3개만 나가요 · 다른 학생과 비교하지 않아요</p>' +
      part('🏅 우수 오답정리', d.wrong) + part('🔍 우수 지문 장악', d.text) +
      '<h4 class="oba-h">💬 우수 질문</h4>' + (d.q && d.q.ready
        ? '<p class="sc-hint">학생 글에서 찾은 「질문 후보」 중 골라야 러닝노트에 보여요(자동 공개 없음)</p>'
        : '<p class="sc-hint">앱 연결 준비 중 — 숙제 제출 메시지 · 선생님 피드백 원문 · 댓글을 앱이 아직 보내지 않아요(Replit 요청서). 연결되면 물음표 · 「궁금 · 모르겠 · 왜 · 어떻게 · 질문」이 든 글을 「질문 후보」로 보여 주고, 직원이 고른 것만 공개해요.</p>');
  }
  function html(sid) {
    if (!sid || !isOnline(sid)) return '';
    if (B.sid !== sid) B = { sid: sid, open: false, data: null, busy: false, err: '' };
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
    if (b) { var q = b.getAttribute('data-oba-see').split('|'); if (window.SubView && SubView.openStaff) SubView.openStaff({ student: q[0], from: q[1], to: q[1], title: md(q[1]) }); }
  });
  window.OnlineBestAdmin = { html: html, state: function () { return B; } };
})();
