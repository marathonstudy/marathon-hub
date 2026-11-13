/* ============================================================
   finish-admin.js — 코치룸 더보기 「🏁 완주증」 (직원만 · 20261114a · migration-110 · assets/finish.js)
   위쪽 [1년 완주증 | 이달의 완주증] · 반 · 기간(1년: 개강일 ~ 종강일 · 반 관리 → 수업 설정 값) / 달(이달)
   반 전체를 작게 훑어보는 목록 — 학생마다 작은 A4 미리보기 · 칭호 바꾸기 · 하이라이트 고르기(3개까지 · 빼기) · 선생님 한마디
     1년판 한마디: [AI 초안](text-polish · draft — 키는 Secrets · 이름은 보내지 않음) → 고치고 [확정] 해야 인쇄 · 링크에 들어감 · 확정 전 빨간 「한마디 확인 필요」
     이달판 한마디: 기본 없음 · 넣고 [확정]하면 보임
   「확인 필요」(기록이 아주 적음 · 옛 기록을 다 못 받음 「기록 받는 중 n/11달」)는 맨 위에 모은다
   [이 반 전체 인쇄] · 학생마다 [인쇄] — 새 창에 A4 장마다 한 학생(Ctrl+P) · 학생 정보는 화면에서만(파일로 남기지 않음)
   ============================================================ */
(function () {
  'use strict';
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { if (window.UI && UI.toast) UI.toast(m, k); }
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function prevMonth(t) { var d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); }
  function monthEnd(ym) { return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10); }
  function abs(p) { try { return new URL(p, location.href).href; } catch (e) { return p; } }

  var S = { kind: 'year', cls: '', from: '', to: '', month: '', classes: [], rows: [], busy: false, err: '', open: {} };
  var dlg = null;
  function pkey() { return S.kind === 'year' ? S.from + '~' + S.to : S.month; }

  function modal() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'modal modal--wide fa-modal';
    dlg.id = 'finishModal';
    dlg.setAttribute('aria-labelledby', 'faTitle');
    dlg.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="faTitle">🏁 완주증</h2>' +
      '<p class="modal__desc">반을 고르면 학생마다 A4 한 장씩 만들어져요. 칭호 · 하이라이트를 바꾸고 한마디를 확정한 뒤 인쇄하세요.</p></div>' +
      '<div class="modal__body" id="faBody"></div>' +
      '<div class="modal__foot"><div class="spacer"></div><button class="btn" type="button" data-fa-close>닫기</button></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('change', onChange);
    dlg.addEventListener('input', onInput);
    return dlg;
  }

  /* ---------- 불러오기 ---------- */
  function loadClasses() {
    var c = sb();
    return Promise.resolve(c.from('classes').select('name,first_lesson,end_on,archived,kind')).then(function (r) {
      if (r.error) return Promise.resolve(c.from('classes').select('name,first_lesson,end_on,archived')).then(function (r2) { return r2.data || []; });
      return r.data || [];
    }).then(function (list) {
      S.classes = list.filter(function (x) { return !x.archived; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    });
  }
  function setClass(name) {
    S.cls = name;
    var c = S.classes.filter(function (x) { return x.name === name; })[0] || {};
    S.from = c.first_lesson || (today().slice(0, 4) + '-01-01');
    S.to = c.end_on || today();
  }
  function badgesOf(id) {
    return Promise.resolve(sb().rpc('staff_badges', { p_student: id })).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
  }
  function load() {
    if (!S.cls) { paint(); return; }
    S.busy = true; S.err = ''; S.rows = []; paint();
    var key = pkey(), kind = S.kind;
    Promise.resolve(sb().rpc('finish_class', { p_class: S.cls, p_kind: kind, p_key: key })).then(function (r) {
      if (r.error) { S.busy = false; S.err = /finish_class|function/.test(r.error.message || '') ? 'migration-110 SQL 을 먼저 실행해 주세요.' : r.error.message; paint(); return; }
      var list = r.data || [], out = [], i = 0;
      /* 배지는 4명씩 나눠 받기 */
      function next() {
        var part = list.slice(i, i + 4); i += 4;
        if (!part.length) { S.busy = false; S.rows = out; build(); paint(); return; }
        Promise.all(part.map(function (s) { return badgesOf(s.id).then(function (b) { s.badges = b; return s; }); })).then(function (xs) { out = out.concat(xs); next(); });
      }
      next();
    }, function (e) { S.busy = false; S.err = String((e && e.message) || e); paint(); });
  }
  /* 옛 기록 받는 중 — 1월 ~ 이번 달 중 받은 달(옛 기록 달 + 지금 기록이 있는 달) */
  function oldProgress(s) {
    if (!s.linked || s.old_at) return null;
    var t = today(), y = (S.kind === 'year' ? S.from : S.month + '-01').slice(0, 4), months = [];
    for (var m = 1; m <= +t.slice(5, 7) && y === t.slice(0, 4); m++) months.push(y + '-' + String(m).padStart(2, '0'));
    if (!months.length) return null;
    var got = {};
    (s.old_parts || []).forEach(function (m2) { got[m2] = 1; });
    ((s.data && s.data.history) || []).forEach(function (h) { var k = String(h && h.submittedAt || '').slice(0, 7); if (k) got[k] = 1; });
    var n = months.filter(function (m2) { return got[m2]; }).length;
    return n >= months.length ? null : { n: n, total: months.length };      /* 모든 달이 있으면 받는 중 표시 없음 */
  }
  function build() {
    var from = S.kind === 'year' ? S.from : S.month + '-01', to = S.kind === 'year' ? S.to : monthEnd(S.month);
    S.rows.forEach(function (s) {
      /* finish_class 가 주는 cert = 저장된 고르기(finish_certs) → dbCert 로 옮기고, cert 자리에는 계산한 완주증 */
      if (!('dbCert' in s)) s.dbCert = s.cert && !s.cert.titles ? s.cert : null;
      s._saved = null;
      var data = Object.assign({}, s.data || {});
      if (s.old && typeof s.old === 'object') data.old = s.old;
      s.cert = Finish.compute(data, { kind: S.kind, from: from, to: to, today: today(), badges: s.badges, game: s.game || {}, name: s.name, cls: S.cls });
    });
  }
  function savedOf(s) { return s._saved || (s._saved = Object.assign({ title_key: '', hl_keys: [], note: '', note_ok: false, published: false }, s.dbCert || {})); }
  function viewOf(s) { return Finish.view(s.cert, savedOf(s)); }
  function needCheck(s) { return s.cert.low || !!oldProgress(s); }

  /* ---------- 그리기 ---------- */
  function headHtml() {
    var kinds = [['year', '1년 완주증'], ['month', '이달의 완주증']];
    return '<div class="fa-head">' +
      '<div class="fa-seg" role="group" aria-label="종류">' + kinds.map(function (k) { return '<button type="button" class="fa-seg__b' + (S.kind === k[0] ? ' is-on' : '') + '" data-fa-kind="' + k[0] + '" aria-pressed="' + (S.kind === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      '<label class="fa-f"><span>반</span><select class="input" id="faClass"><option value="">반 고르기</option>' + S.classes.map(function (c) { return '<option' + (c.name === S.cls ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      (S.kind === 'year'
        ? '<label class="fa-f"><span>개강일</span><input class="input" type="date" id="faFrom" value="' + esc(S.from) + '"></label><label class="fa-f"><span>종강일</span><input class="input" type="date" id="faTo" value="' + esc(S.to) + '"></label>'
        : '<label class="fa-f"><span>달</span><input class="input" type="month" id="faMonth" value="' + esc(S.month) + '"></label>') +
      (S.rows.length ? '<button type="button" class="btn btn--primary" data-fa-printall>이 반 전체 인쇄</button>' : '') +
      '</div>' + (S.kind === 'year' ? '<p class="field__hint">종강일 · 개강일은 반 관리 → 수업 설정에서 반마다 바꿀 수 있어요. 여기서 바꾸면 이 화면에만 써요.</p>' : '');
  }
  function cardHtml(s) {
    var sv = savedOf(s), v = viewOf(s), op = oldProgress(s), year = S.kind === 'year', open = !!S.open[s.id];
    var flags = (s.cert.low ? '<span class="fa-flag">기록 적음</span>' : '') + (op ? '<span class="fa-flag">기록 받는 중 ' + op.n + '/' + op.total + '달</span>' : '') +
      (year && !sv.note_ok ? '<span class="fa-flag fa-flag--red">한마디 확인 필요</span>' : '') + (sv.published ? '<span class="fa-flag fa-flag--ok">러닝노트 공개</span>' : '');
    var titles = '<select class="input fa-title" data-fa-title="' + s.id + '">' + s.cert.titles.map(function (t) { return '<option value="' + esc(t.key) + '"' + (v.title === t.text ? ' selected' : '') + '>' + esc(t.text) + '</option>'; }).join('') + '</select>';
    var chosen = v.hls;
    var hls = s.cert.hls.length ? '<div class="fa-hls">' + s.cert.hls.map(function (h) {
      var on = chosen.indexOf(h.text) >= 0;
      return '<label class="fa-hl' + (on ? ' is-on' : '') + '"><input type="checkbox" data-fa-hl="' + s.id + '" value="' + esc(h.key) + '"' + (on ? ' checked' : '') + '> ' + esc(h.text) + '</label>';
    }).join('') + '</div><p class="field__hint">3개까지 · 모두 끄면 하이라이트 없이 「함께 달렸어요」 한 줄</p>' : '<p class="field__hint">기준에 맞는 하이라이트가 없어요 — 「함께 달렸어요」 한 줄로 나가요</p>';
    var note = '<div class="fa-note"><label class="field__label" for="faN' + s.id + '">선생님 한마디' + (year ? '' : ' (넣으면 보여요)') + '</label>' +
      '<textarea class="input" rows="3" maxlength="400" id="faN' + s.id + '" data-fa-note="' + s.id + '">' + esc(sv.note) + '</textarea>' +
      '<div class="fa-note__b">' + (year ? '<button type="button" class="btn btn--sm" data-fa-ai="' + s.id + '">AI 초안</button>' : '') +
        '<button type="button" class="btn btn--sm' + (sv.note_ok ? '' : ' btn--primary') + '" data-fa-ok="' + s.id + '">' + (sv.note_ok ? '확정됨 ✓' : '확정') + '</button>' +
        '<span class="fa-note__m" data-fa-msg="' + s.id + '"></span></div></div>';
    return '<article class="fa-card' + (needCheck(s) ? ' is-check' : '') + '" data-fa-id="' + s.id + '">' +
      '<div class="fa-thumb" aria-hidden="true"><div class="fa-thumb__in">' + Finish.pageHtml(v, { base: '../assets/chars/' }) + '</div></div>' +
      '<div class="fa-ctl"><div class="fa-ctl__h"><b>' + esc(s.name) + '</b>' + flags + '</div>' +
        '<label class="field__label">칭호</label>' + titles +
        '<label class="field__label">하이라이트</label>' + hls + note +
        '<div class="fa-ctl__b"><button type="button" class="btn btn--sm" data-fa-print="' + s.id + '">이 학생 인쇄</button>' +
          (year ? '<button type="button" class="btn btn--sm" data-fa-pub="' + s.id + '"' + (sv.note_ok ? '' : ' disabled title="한마디를 확정해야 공개할 수 있어요"') + '>' + (sv.published ? '러닝노트 공개 다시(내용 업데이트)' : '러닝노트에 공개') + '</button>' : '') +
        '</div></div></article>';
  }
  function paint() {
    var b = $('#faBody', dlg), h = headHtml();
    if (S.err) h += '<p class="cs-err" role="alert">' + esc(S.err) + '</p>';
    else if (S.busy) h += '<p class="panel__hint">학생 기록을 불러오는 중…</p>';
    else if (!S.cls) h += '<p class="panel__hint">반을 고르세요.</p>';
    else if (!S.rows.length) h += '<p class="panel__hint">이 반에 학생이 없어요.</p>';
    else {
      var chk = S.rows.filter(needCheck), rest = S.rows.filter(function (s) { return !needCheck(s); });
      if (chk.length) h += '<h3 class="fa-h">확인 필요 <span class="muted-note">' + chk.length + '명 — 기록이 아주 적거나 옛 기록을 다 못 받았어요</span></h3>' + chk.map(cardHtml).join('');
      h += '<h3 class="fa-h">' + esc(S.cls) + ' <span class="muted-note">' + rest.length + '명</span></h3>' + rest.map(cardHtml).join('');
    }
    b.innerHTML = h;
  }
  function repaintCard(s) { var el = dlg.querySelector('[data-fa-id="' + s.id + '"]'); if (el) el.outerHTML = cardHtml(s); }
  function rowOf(id) { return S.rows.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- 저장 ---------- */
  function save(s, patch) {
    Object.assign(savedOf(s), patch);
    var row = Object.assign({ student: s.id, kind: S.kind, pkey: pkey(), class: S.cls }, patch);
    return Promise.resolve(sb().rpc('finish_save', { p_row: row })).then(function (r) {
      if (r.error) toast('저장하지 못했어요 — ' + r.error.message, 'bad');
      return r;
    });
  }
  /* AI 초안 — 이름 · 번호는 보내지 않는다(「학생」) · 사실만 */
  function aiDraft(s) {
    var msg = dlg.querySelector('[data-fa-msg="' + s.id + '"]'), v = viewOf(s);
    if (msg) msg.textContent = 'AI 초안 쓰는 중…';
    var facts = { 종류: '1년 완주증 (한 해를 마치는 종강)', 기간: S.from + ' ~ ' + S.to, 칭호: v.title, 하이라이트: v.hls,
      정답률흐름: (s.cert.flow || []).filter(function (p) { return p.v != null; }).map(function (p) { return (+p.m.slice(5, 7)) + '월 ' + p.v + '%'; }), 기록적음: s.cert.low };
    var req = '완주증에 들어갈 「선생님 한마디」를 2~3문장으로 쓴다. 한 해를 끝까지 달린 학생에게 따뜻하게 축하하고, 자료의 칭호 · 하이라이트 중 하나를 구체적으로 짚고, 앞으로의 응원으로 맺는다. 학생 이름은 쓰지 않는다. 제출률 · 과제 수 · 등수 · 다른 학생 비교는 쓰지 않는다.';
    var f = sb() && sb().functions;
    Promise.resolve(f.invoke('text-polish', { body: { action: 'draft', target: 'student', kind: 'comment', facts: facts, request: req } })).then(function (r) {
      var d = r && r.data;
      if (!d || !d.ok || !d.text) { if (msg) msg.textContent = 'AI 초안을 받지 못했어요' + (d && d.why ? ' (' + d.why + ')' : '') + ' · 직접 써 주세요'; return; }
      save(s, { note: d.text, note_ok: false }).then(function () { repaintCard(s); });
    }, function () { if (msg) msg.textContent = 'AI 초안을 받지 못했어요 · 직접 써 주세요'; });
  }
  function views(list) {
    return list.map(function (s) { var v = viewOf(s); if (S.kind === 'year' && !savedOf(s).note_ok) v.note = ''; return v; });
  }
  function printList(list) {
    if (!list.length) return;
    var w = window.open('', '_blank');
    if (!w) { toast('팝업이 막혀 있어요 — 이 사이트의 팝업을 허용해 주세요', 'bad'); return; }
    w.document.open();
    w.document.write(Finish.printDoc(views(list), { base: abs('../assets/chars/'), css: abs('../assets/finish.css'), title: (S.kind === 'year' ? '완주증' : S.month + ' 완주증') + ' · ' + S.cls }));
    w.document.close();
    var go = function () { try { w.focus(); w.print(); } catch (e) { /* 사람이 Ctrl+P */ } };
    if (w.document.readyState === 'complete') setTimeout(go, 500); else w.addEventListener('load', function () { setTimeout(go, 300); });
  }
  function publish(s) {
    var v = viewOf(s);
    if (!savedOf(s).note_ok) { toast('한마디를 확정해야 공개할 수 있어요', 'bad'); return; }
    var snap = { kind: v.kind, from: v.from, to: v.to, name: v.name, cls: v.cls, game: v.game, level: v.level, title: v.title, hls: v.hls, flow: v.flow, note: v.note };
    save(s, { published: true, snap: snap }).then(function (r) { if (!r.error) { toast(s.name + ' 완주증을 러닝노트에 공개했어요', 'good'); repaintCard(s); } });
  }

  /* ---------- 누르기 ---------- */
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-fa-close]')) { dlg.close(); return; }
    var k = t.closest('[data-fa-kind]');
    if (k) { S.kind = k.getAttribute('data-fa-kind'); if (S.cls) setClass(S.cls); if (!S.month) S.month = prevMonth(today()); load(); return; }
    if (t.closest('[data-fa-printall]')) { printList(S.rows); return; }
    var p = t.closest('[data-fa-print]'); if (p) { printList([rowOf(p.getAttribute('data-fa-print'))].filter(Boolean)); return; }
    var ai = t.closest('[data-fa-ai]'); if (ai) { aiDraft(rowOf(ai.getAttribute('data-fa-ai'))); return; }
    var ok = t.closest('[data-fa-ok]');
    if (ok) {
      var s = rowOf(ok.getAttribute('data-fa-ok')), ta = dlg.querySelector('[data-fa-note="' + s.id + '"]'), note = ta ? ta.value.trim() : '';
      if (!note && S.kind === 'year') { toast('한마디를 먼저 써 주세요', 'bad'); return; }
      save(s, { note: note, note_ok: !!note }).then(function () { repaintCard(s); });
      return;
    }
    var pub = t.closest('[data-fa-pub]'); if (pub) { publish(rowOf(pub.getAttribute('data-fa-pub'))); return; }
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === 'faClass') { setClass(t.value); if (!S.month) S.month = prevMonth(today()); load(); return; }
    if (t.id === 'faFrom' || t.id === 'faTo') { S[t.id === 'faFrom' ? 'from' : 'to'] = t.value; load(); return; }
    if (t.id === 'faMonth') { S.month = t.value; load(); return; }
    if (t.hasAttribute('data-fa-title')) { var s = rowOf(t.getAttribute('data-fa-title')); save(s, { title: t.value }).then(function () { savedOf(s).title_key = t.value; repaintCard(s); }); savedOf(s).title_key = t.value; return; }
    if (t.hasAttribute('data-fa-hl')) {
      var s2 = rowOf(t.getAttribute('data-fa-hl')), box = dlg.querySelector('[data-fa-id="' + s2.id + '"]');
      var keys = Array.prototype.map.call(box.querySelectorAll('[data-fa-hl]:checked'), function (x) { return x.value; });
      if (keys.length > 3) { t.checked = false; toast('하이라이트는 3개까지 고를 수 있어요', 'bad'); return; }
      savedOf(s2).hl_keys = keys.length ? keys : ['-'];
      save(s2, { hls: savedOf(s2).hl_keys }).then(function () { repaintCard(s2); });
    }
  }
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-fa-note')) { var s = rowOf(t.getAttribute('data-fa-note')); if (s && savedOf(s).note_ok) { savedOf(s).note_ok = false; } }
  }

  function open() {
    modal();
    S.month = S.month || prevMonth(today());
    Layer.show(dlg);
    paint();
    loadClasses().then(function () {
      if (!S.cls) { var m = S.classes.filter(function (c) { return /목동/.test(c.name) && c.kind !== 'online'; })[0]; if (m) setClass(m.name); }
      if (S.cls) load(); else paint();
    }, function (e) { S.err = String((e && e.message) || e); paint(); });
  }
  window.FinishAdmin = { open: open, state: function () { return S; }, _views: views };
})();
