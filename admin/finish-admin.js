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

  var S = { kind: 'year', cls: '', from: '', to: '', month: '', classes: [], rows: [], busy: false, err: '', open: {}, mark: {} };
  /* 원장님 서명 (20261114h · migration-113) — Storage 비공개 버킷 staff-private/signature.png · 직원 로그인으로 짧은 signed URL(2분) → 그림을 받아 이 화면 메모리(blob:)에만
     저장소 · 파일 · 러닝노트 · 사진 공유 · 링크에는 넣지 않음 · 못 받으면 빈 서명 칸 · 인쇄는 그대로 */
  var SIGN = { url: '', state: '', p: null };
  function loadSign() {
    if (SIGN.p) return SIGN.p;
    SIGN.state = 'loading';
    var st = sb() && sb().storage;
    if (!st || !st.from) { SIGN.state = 'fail'; return (SIGN.p = Promise.resolve('')); }
    SIGN.p = Promise.resolve(st.from('staff-private').createSignedUrl('signature.png', 120)).then(function (r) {
      var u = r && !r.error && r.data && (r.data.signedUrl || r.data.signedURL);
      if (!u) throw new Error('nourl');
      return fetch(u, { cache: 'no-store' });
    }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.blob();
    }).then(function (b) {
      if (!b || !/^image\//.test(b.type || 'image/png') || !b.size) throw new Error('type');
      SIGN.url = URL.createObjectURL(b); SIGN.state = 'ok';
      return SIGN.url;
    }).catch(function () { SIGN.url = ''; SIGN.state = 'fail'; SIGN.p = null; return ''; });
    return SIGN.p;
  }
  /* 서명 · 편지 글꼴을 기다린 뒤(최대 2.5초) — 못 받아도 그대로 진행 */
  function ready() {
    var t = new Promise(function (res) { setTimeout(res, 2500); });
    return Promise.race([Promise.all([loadSign(), Finish.loadFont ? Finish.loadFont(2500) : null]), t]);
  }
  function popt(extra) { return Object.assign({ base: '../assets/chars/', signImg: SIGN.url || '' }, extra || {}); }
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
  /* 반 이름 줄 (migration-112 class_lines) — { 반: { kind, line } } · 112 전이면 반 이름만 */
  var LINES = {};
  function loadLines() { return Promise.resolve(sb().rpc('class_lines')).then(function (r) { LINES = (r && !r.error && r.data) || {}; }, function () { LINES = {}; }); }
  function lineOf(cls) { return (LINES[cls] && LINES[cls].line) || cls; }
  function onlineCls(cls) { return !!(LINES[cls] && LINES[cls].kind === 'online'); }
  /* 온라인 반 1년판 — 앱 학생 id 로 이어 붙인 기록의 첫 달 1일 ~ 마지막 달 말일(오늘을 넘지 않음) */
  function spanOf(data, old) {
    var ds = [];
    ((data && data.history) || []).concat((old && old.history) || []).forEach(function (h) { var d = String(h && h.submittedAt || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) ds.push(d); });
    if (!ds.length) return null;
    ds.sort();
    var f = ds[0].slice(0, 8) + '01', l = monthEnd(ds[ds.length - 1].slice(0, 7));
    return { from: f, to: l > today() ? today() : l };
  }
  function loadClasses() {
    var c = sb();
    loadLines();
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
    S.busy = true; S.err = ''; S.rows = []; S.mark = {}; paint();
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
  function covered(s) {
    var t = today(), y = (S.kind === 'year' ? S.from : S.month + '-01').slice(0, 4), months = [], got = {};
    for (var m = 1; m <= +t.slice(5, 7) && y === t.slice(0, 4); m++) months.push(y + '-' + String(m).padStart(2, '0'));
    (s.old_parts || []).forEach(function (m2) { got[m2] = 1; });
    ((s.old && s.old.history) || []).concat((s.data && s.data.history) || []).forEach(function (h) { var k = String(h && h.submittedAt || '').slice(0, 7); if (k) got[k] = 1; });
    return { n: months.filter(function (m2) { return got[m2]; }).length, total: months.length };
  }
  function dataFirst(s) { var f = ''; ((s.data && s.data.history) || []).forEach(function (h) { var d = String(h && h.submittedAt || '').slice(0, 10); if (d && (!f || d < f)) f = d; }); return f; }
  function oldProgress(s) {
    if (!s.linked) return null;
    var cut = s.old && s.old.cut ? String(s.old.cut) : '', df = dataFirst(s);
    /* 20261114c — 예전에는 수강 시작일 전까지만 받아 1월 개강 학생은 「다 받음」으로 끝났다 → 받은 끝(cut)이 지금 기록 시작보다 앞이면 아직 받는 중 */
    var stale = s.old_at && df && (!cut || cut.slice(0, 7) < df.slice(0, 7));
    if (s.old_at && !stale) return null;
    var t = today(), y = (S.kind === 'year' ? S.from : S.month + '-01').slice(0, 4), months = [];
    for (var m = 1; m <= +t.slice(5, 7) && y === t.slice(0, 4); m++) months.push(y + '-' + String(m).padStart(2, '0'));
    if (!months.length) return null;
    var c = covered(s);
    return c.n >= c.total ? null : c;                                      /* 모든 달이 있으면 받는 중 표시 없음 */
  }
  function build() {
    var from = S.kind === 'year' ? S.from : S.month + '-01', to = S.kind === 'year' ? S.to : monthEnd(S.month);
    S.rows.forEach(function (s) {
      /* finish_class 가 주는 cert = 저장된 고르기(finish_certs) → dbCert 로 옮기고, cert 자리에는 계산한 완주증 */
      if (!('dbCert' in s)) s.dbCert = s.cert && !s.cert.titles ? s.cert : null;
      s._saved = null;
      var data = Object.assign({}, s.data || {});
      if (s.old && typeof s.old === 'object') data.old = s.old;
      var sp = S.kind === 'year' && onlineCls(S.cls) ? spanOf(s.data, s.old) : null;
      s.cert = Finish.compute(data, { kind: S.kind, from: sp ? sp.from : from, to: sp ? sp.to : to, today: today(), badges: s.badges, game: s.game || {}, name: s.name, cls: lineOf(S.cls) });
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
      (S.kind === 'year' && S.cls ? '<label class="fa-p2"><input type="checkbox" data-fa-p2' + (p2On() ? ' checked' : '') + '> 2쪽 「나의 1년 레이스 기록」</label>' : '') +
      (S.rows.length ? '<button type="button" class="btn btn--primary" data-fa-printall>이 반 전체 인쇄</button>' : '') +
      (S.rows.length ? '<button type="button" class="btn" data-fa-send>📨 완주증 보내기</button>' : '') +
      '</div>' + (S.kind === 'year' ? '<p class="field__hint">' + (onlineCls(S.cls) ? '온라인 반은 학생마다 앱 기록의 첫 달 ~ 마지막 달로 만들어요(여러 앱 반 기록을 이어 붙임).' : '종강일 · 개강일은 반 관리 → 수업 설정에서 반마다 바꿀 수 있어요. 여기서 바꾸면 이 화면에만 써요.') + '</p>' : '');
  }
  function cardHtml(s) {
    var sv = savedOf(s), v = viewOf(s), op = oldProgress(s), year = S.kind === 'year', open = !!S.open[s.id];
    var flags = (s.cert.low ? '<span class="fa-flag">기록 적음</span>' : '') + (op ? '<span class="fa-flag">기록 받는 중 ' + op.n + '/' + op.total + '달</span>' : '') +
      (year && !sv.note_ok ? '<span class="fa-flag fa-flag--red">한마디 확인 필요</span>' : '') + (sv.published ? '<span class="fa-flag fa-flag--ok">러닝노트 공개</span>' : '');
    var titles = '<select class="input fa-title" data-fa-title="' + s.id + '">' + s.cert.titles.map(function (t) { return '<option value="' + esc(t.key) + '"' + (v.title === t.text ? ' selected' : '') + '>' + esc(t.text) + '</option>'; }).join('') + '</select>';
    var chosen = v.hls.map(function (x) { return x.key; });
    var hls = s.cert.hls.length ? '<div class="fa-hls">' + s.cert.hls.map(function (h) {
      var on = chosen.indexOf(h.key) >= 0;
      return '<label class="fa-hl' + (on ? ' is-on' : '') + '"><input type="checkbox" data-fa-hl="' + s.id + '" value="' + esc(h.key) + '"' + (on ? ' checked' : '') + '> ' + esc(h.text) + '</label>';
    }).join('') + '</div><p class="field__hint">처음에는 후보 전부 체크 · 빼고 싶은 것만 끄세요 · 1쪽에는 앞의 6개(1~3개 큰 카드 · 4~6개 두 칸) · 나머지는 2쪽 · 모두 끄면 「함께 달렸어요」 한 줄</p>' : '<p class="field__hint">기준에 맞는 하이라이트가 없어요 — 「함께 달렸어요」 한 줄로 나가요</p>';
    var note = '<div class="fa-note"><label class="field__label" for="faN' + s.id + '">선생님 한마디' + (year ? ' <span class="muted-note">→ 마지막 쪽 「선생님의 편지」 · 빈 줄 = 문단 · **글자** = 굵게</span>' : ' (넣으면 보여요 · 길면 편지 쪽)') + '</label>' +
      '<textarea class="input" rows="' + (year ? 6 : 3) + '" maxlength="3000" id="faN' + s.id + '" data-fa-note="' + s.id + '">' + esc(sv.note) + '</textarea>' +
      '<div class="fa-note__b">' + (year ? '<button type="button" class="btn btn--sm" data-fa-ai="' + s.id + '">AI 초안</button>' : '') +
        '<button type="button" class="btn btn--sm' + (sv.note_ok ? '' : ' btn--primary') + '" data-fa-ok="' + s.id + '">' + (sv.note_ok ? '확정됨 ✓' : '확정') + '</button>' +
        '<span class="fa-note__m" data-fa-msg="' + s.id + '"></span></div>' +
      '<button type="button" class="btn btn--sm fa-note__all" data-fa-all="' + s.id + '">✉️ 이 편지를 반 전체에 넣기</button></div>';      /* 20261114i */
    return '<article class="fa-card' + (needCheck(s) ? ' is-check' : '') + (S.mark[s.id] ? ' is-marked' : '') + '" data-fa-id="' + s.id + '">' +
      '<button type="button" class="fa-thumb" data-fa-big="' + s.id + '" aria-label="' + esc(s.name + ' 완주증 크게 보기') + '"><span class="fa-thumb__in">' + Finish.pageHtml(v, popt()) + '</span><span class="fa-thumb__z" aria-hidden="true">🔍 크게</span></button>' +
      '<div class="fa-ctl"><div class="fa-ctl__h"><label class="fa-mark" title="표시 — 위의 [표시한 학생 모두 확정]"><input type="checkbox" data-fa-mark="' + s.id + '"' + (S.mark[s.id] ? ' checked' : '') + ' aria-label="' + esc(s.name) + ' 표시"></label><b>' + esc(s.name) + '</b>' + flags + '</div>' +
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
      if (S.kind === 'year') h += oldSummaryHtml();
      h += '<div class="fa-bulk" data-fa-bulk>' + bulkHtml() + '</div>';
      if (chk.length) h += '<h3 class="fa-h">확인 필요 <span class="muted-note">' + chk.length + '명 — 기록이 아주 적거나 옛 기록을 다 못 받았어요</span></h3>' + chk.map(cardHtml).join('');
      h += '<h3 class="fa-h">' + esc(S.cls) + ' <span class="muted-note">' + rest.length + '명</span></h3>' + rest.map(cardHtml).join('');
    }
    b.innerHTML = h;
  }
  /* ---------- 표시한 학생 모두 확정 (20261114i) — 목록 위 · 체크(표시)한 학생만 · 확인 창 「n명 확정할까요?」 ---------- */
  function marked() { return S.rows.filter(function (s) { return S.mark[s.id]; }); }
  function bulkHtml() {
    var m = marked(), all = S.rows.length && m.length === S.rows.length;
    return '<label class="fa-bulk__all"><input type="checkbox" data-fa-markall' + (all ? ' checked' : '') + '> 모두 표시</label>' +
      '<span class="fa-bulk__n">표시 <b class="num">' + m.length + '</b>명</span>' +
      '<button type="button" class="btn btn--sm btn--primary" data-fa-okall' + (m.length ? '' : ' disabled') + '>표시한 학생 모두 확정</button>';
  }
  function paintBulk() {
    var el = dlg && dlg.querySelector('[data-fa-bulk]'); if (el) el.innerHTML = bulkHtml();
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-fa-id]'), function (c) { c.classList.toggle('is-marked', !!S.mark[c.getAttribute('data-fa-id')]); });
  }
  function noteNow(s) { var ta = dlg.querySelector('[data-fa-note="' + s.id + '"]'); return (ta ? ta.value : savedOf(s).note || '').trim(); }
  function okAll() {
    var m = marked(), go = m.filter(function (s) { return noteNow(s); }), skip = m.length - go.length;
    if (!go.length) { toast('표시한 학생 중 한마디가 있는 학생이 없어요', 'bad'); return; }
    var ask = window.UI && UI.confirmAsk ? UI.confirmAsk('표시한 학생 모두 확정', go.length + '명 확정할까요?' + (skip ? ' (한마디가 빈 ' + skip + '명은 빼요)' : ''), go.length + '명 확정') : Promise.resolve(true);
    ask.then(function (ok) {
      if (!ok) return;
      var i = 0;
      (function next() {
        var part = go.slice(i, i + 4); i += 4;
        if (!part.length) { toast(go.length + '명 확정했어요', 'good'); return; }
        Promise.all(part.map(function (s) { var n = noteNow(s); return save(s, { note: n, note_ok: true }).then(function () { repaintCard(s); }); })).then(next);
      })();
    });
  }

  /* ---------- 반 전체에 같은 편지 넣기 (20261114i · admin/finish-letter.js) ----------
     그 학생의 글을 틀로 — 이름(성 포함 · 성 뺀 이름)을 자리표로 · 학생마다 자기 이름 · 부르는 말 · 조사 받침에 맞게
     못 찾으면 글에서 이름 부분을 골라 「여기가 이름」 · 또는 {이름} · {성이름} 직접
     미리보기 창(공통 Layer) — 기본 전원 체크 · 이미 한마디가 있는 학생은 체크 해제 + 「이미 있음」 · 앞 두 줄 · 바뀐 이름 색
     [넣기] → 체크한 학생에게 「확정 전」으로 저장 · 그 뒤 학생마다 따로 고치기 */
  var LT = null;
  function openAll(s) {
    var text = noteNow(s);
    if (!text) { toast('먼저 이 학생의 한마디를 써 주세요', 'bad'); return; }
    if (!window.FinLetter) { toast('화면을 새로 고쳐 주세요', 'bad'); return; }
    var ck = {};
    S.rows.forEach(function (r) { ck[r.id] = !String(savedOf(r).note || '').trim(); });
    var old = document.getElementById('faLetter'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('dialog'); el.className = 'modal modal--wide fa-lt'; el.id = 'faLetter'; el.setAttribute('aria-label', '반 전체에 같은 편지 넣기');
    LT = { el: el, src: s, text: text, extra: [], ck: ck };
    paintLt(true);
    Layer.show(el, { onClose: function () { LT = null; } });
  }
  function ltTpl() { return FinLetter.toTpl(LT.text, LT.src.name, LT.extra); }
  function pvHtml(tpl, name) {
    var h = FinLetter.fillParts(tpl, name).map(function (x) { var t = esc(x.t.replace(/\*\*/g, '')); return x.nm ? '<mark class="fa-lt__nm">' + t + '</mark>' : t; }).join('');
    return h.split('\n').filter(function (l) { return l.trim(); }).slice(0, 2).join('<br>');
  }
  function paintLt(full) {
    if (!LT) return;
    var T = ltTpl(), n = S.rows.filter(function (r) { return LT.ck[r.id]; }).length;
    var status = T.n ? '<p class="fa-lt__ok">✓ 이름 <b>' + T.n + '</b>곳을 찾았어요 — 학생마다 자기 이름으로 바뀌어요(색으로 표시)</p>'
      : '<p class="fa-lt__warn" role="alert">⚠️ 글에서 「' + esc(LT.src.name) + '」 이름을 못 찾았어요. 아래 글에서 이름 부분을 끌어서 고른 뒤 [여기가 이름]을 누르거나, {이름} · {성이름}을 직접 써 주세요.</p>';
    var list = S.rows.map(function (r) {
      var has = !!String(savedOf(r).note || '').trim();
      return '<label class="fa-lt__r' + (LT.ck[r.id] ? ' is-on' : '') + '"><input type="checkbox" data-lt-ck="' + r.id + '"' + (LT.ck[r.id] ? ' checked' : '') + '>' +
        '<span class="fa-lt__who"><b>' + esc(r.name) + '</b>' + (has ? '<span class="fa-flag">이미 있음</span>' : '') + (r.id === LT.src.id ? '<span class="fa-flag fa-flag--ok">원본</span>' : '') + '</span>' +
        '<span class="fa-lt__pv">' + pvHtml(T.tpl, r.name) + '</span></label>';
    }).join('');
    var body = '<div class="fa-lt__st" data-lt-st>' + status + '</div>' +
      '<div class="fa-lt__src"><label class="field__label" for="faLtSrc">틀로 쓸 글 <span class="muted-note">' + esc(LT.src.name) + ' 학생 것 · 여기서 고치면 미리보기에 바로 반영 · 3,000자까지</span></label>' +
        '<textarea class="input" id="faLtSrc" rows="5" maxlength="3000">' + esc(LT.text) + '</textarea>' +
        '<div class="fa-lt__pick"><button type="button" class="btn btn--sm" data-lt-pick="given">여기가 이름 (성 빼고)</button><button type="button" class="btn btn--sm" data-lt-pick="full">여기가 성 + 이름</button>' +
          (LT.extra.length ? '<span class="muted-note">고른 이름: ' + LT.extra.map(function (x) { return '「' + esc(x.s) + '」'; }).join(' ') + ' <button type="button" class="btn btn--sm btn--ghost" data-lt-unpick>지우기</button></span>' : '<span class="muted-note">글에서 이름 부분을 끌어서 고른 뒤 누르세요</span>') + '</div></div>' +
      '<div class="fa-lt__bar"><button type="button" class="btn btn--sm" data-lt-all="1">모두 체크</button><button type="button" class="btn btn--sm" data-lt-all="0">모두 해제</button><span class="muted-note" data-lt-n>체크 <b class="num">' + n + '</b>명 · 「이미 있음」은 덮어쓰려면 직접 체크</span></div>' +
      '<div class="fa-lt__list" data-lt-list>' + list + '</div>';
    var foot = '<div class="modal__foot"><div class="spacer"></div><button type="button" class="btn" data-lt-x>취소</button><button type="button" class="btn btn--primary" data-lt-go' + (n ? '' : ' disabled') + '>넣기 (' + n + '명)</button></div>';
    if (full) {
      LT.el.innerHTML = '<div class="modal__head"><h2 class="modal__title">✉️ 반 전체에 같은 편지 넣기</h2><p class="modal__desc">' + esc(LT.src.name) + ' 학생의 편지를 틀로 써요 · 넣은 뒤에는 「확정 전」 · 학생마다 따로 고칠 수 있어요</p></div>' +
        '<div class="modal__body fa-lt__b">' + body + '</div>' + foot;
      return;
    }
    /* 글을 고치는 중 — 글 칸은 그대로 두고 나머지만 다시 */
    var st = LT.el.querySelector('[data-lt-st]'); if (st) st.innerHTML = status;
    var ls = LT.el.querySelector('[data-lt-list]'); if (ls) ls.innerHTML = list;
    var nn = LT.el.querySelector('[data-lt-n]'); if (nn) nn.innerHTML = '체크 <b class="num">' + n + '</b>명 · 「이미 있음」은 덮어쓰려면 직접 체크';
    var go = LT.el.querySelector('[data-lt-go]'); if (go) { go.disabled = !n; go.textContent = '넣기 (' + n + '명)'; }
  }
  function ltGo() {
    var T = ltTpl(), list = S.rows.filter(function (r) { return LT.ck[r.id]; });
    if (!list.length) return;
    var el = LT.el, i = 0, done = 0;
    var go = el.querySelector('[data-lt-go]'); if (go) { go.disabled = true; go.textContent = '넣는 중…'; }
    (function next() {
      var part = list.slice(i, i + 4); i += 4;
      if (!part.length) {
        Layer.hide(el); LT = null;
        toast(done + '명에게 편지를 넣었어요 · 「확정 전」이에요 — 학생마다 고친 뒤 확정하세요', 'good');
        return;
      }
      Promise.all(part.map(function (r) {
        return save(r, { note: FinLetter.fill(T.tpl, r.name), note_ok: false }).then(function (res) { if (res && !res.error) done++; repaintCard(r); });
      })).then(next);
    })();
  }
  document.addEventListener('click', function (e) {
    if (!LT || !e.target.closest || !LT.el.contains(e.target)) return;
    var t = e.target;
    if (t.closest('[data-lt-x]')) { Layer.hide(LT.el); LT = null; return; }
    if (t.closest('[data-lt-go]')) { ltGo(); return; }
    var a = t.closest('[data-lt-all]');
    if (a) { var on = a.getAttribute('data-lt-all') === '1'; S.rows.forEach(function (r) { LT.ck[r.id] = on; }); paintLt(false); return; }
    var pk = t.closest('[data-lt-pick]');
    if (pk) {
      var ta = LT.el.querySelector('#faLtSrc'), sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() : '';
      if (!sel) { toast('글에서 이름 부분을 먼저 끌어서 고르세요', 'bad'); return; }
      if (sel.length > 12) { toast('이름만 골라 주세요 (12자까지)', 'bad'); return; }
      LT.extra.push({ s: sel, role: pk.getAttribute('data-lt-pick') });
      paintLt(true); return;
    }
    if (t.closest('[data-lt-unpick]')) { LT.extra = []; paintLt(true); return; }
  });
  document.addEventListener('change', function (e) {
    if (!LT || !e.target || !LT.el.contains(e.target)) return;
    var t = e.target;
    if (t.hasAttribute('data-lt-ck')) { LT.ck[t.getAttribute('data-lt-ck')] = t.checked; paintLt(false); }
  });
  document.addEventListener('input', function (e) {
    if (!LT || !e.target || e.target.id !== 'faLtSrc') return;
    LT.text = e.target.value.slice(0, 3000);
    paintLt(false);
  });
  /* 반마다 2쪽 켜고 끄기 — 이 기기에 기억 (기본 켬) */
  function p2On() { try { return localStorage.getItem('mh.fin.p2.' + S.cls) !== '0'; } catch (e) { return true; } }
  /* 옛 기록 받은 달 — 학생마다 n/11달 (적은 학생부터) */
  function oldSummaryHtml() {
    var list = S.rows.filter(function (s) { return s.linked; }).map(function (s) { var c = covered(s); return { s: s, c: c, wait: !!oldProgress(s) }; }).sort(function (a, b) { return a.c.n - b.c.n || (a.s.name < b.s.name ? -1 : 1); });
    if (!list.length) return '';
    var wait = list.filter(function (x) { return x.wait; }).length;
    return '<details class="fa-old"' + (wait ? ' open' : '') + '><summary><b>옛 기록 받은 달</b> <span class="muted-note">' + (wait ? '받는 중 ' + wait + '명' : '모두 받음') + ' · 1월 ~ 이번 달 중 기록이 있는 달</span></summary>' +
      '<ul class="fa-old__l">' + list.map(function (x) { return '<li class="' + (x.wait ? 'is-wait' : '') + '"><span>' + esc(x.s.name) + '</span><b class="num">' + x.c.n + '/' + x.c.total + '달</b>' + (x.wait ? '<small>받는 중</small>' : '') + '</li>'; }).join('') + '</ul></details>';
  }
  /* 크게 미리보기 — A4 실제 비율 · 여러 쪽이면 좌우로 · 창 안에서 [이 학생 인쇄] (공통 Layer) */
  var BIG = null;
  function openBig(s) { ready().then(function () { openBig0(s); }); }
  function openBig0(s) {
    var pages = Finish.pagesHtml(views([s])[0], popt({ p2: p2On() }));
    /* 인쇄와 같게 — 화면 밖에 실제 크기로 그려 넘침을 맞춘 뒤(능력치 칩 줄이기 · 3쪽으로) 쪽들을 다시 모음 (20261114d) */
    if (Finish.fit) {
      var tmp = document.createElement('div');
      tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden';
      tmp.innerHTML = pages.join('');
      document.body.appendChild(tmp);
      try { Finish.fit(tmp); pages = Array.prototype.map.call(tmp.querySelectorAll('.fc-page'), function (p) { return p.outerHTML; }); } catch (e) { /* 그대로 */ }
      tmp.parentNode.removeChild(tmp);
    }
    var el = Layer.make('fa-big', 'faBig');
    BIG = { el: el, s: s, pages: pages, i: 0 };
    paintBig();
    Layer.show(el, { full: true, onClose: function () { BIG = null; } });
    fitBig();
  }
  function paintBig() {
    if (!BIG) return;
    var n = BIG.pages.length, i = BIG.i;
    BIG.el.innerHTML = '<div class="fa-big__in" role="dialog" aria-modal="true" aria-label="' + esc(BIG.s.name + ' 완주증 미리보기') + '">' +
      '<div class="fa-big__top"><b>' + esc(BIG.s.name) + '</b> <span class="muted-note num">' + (i + 1) + ' / ' + n + '쪽</span><div class="spacer"></div>' +
        '<button type="button" class="btn btn--primary btn--sm" data-fa-bigprint>이 학생 인쇄</button><button type="button" class="btn btn--sm" data-fa-bigx aria-label="닫기">닫기</button></div>' +
      '<div class="fa-big__stage"><button type="button" class="fa-big__nav" data-fa-bigp="-1"' + (i ? '' : ' disabled') + ' aria-label="앞 쪽">◀</button>' +
        '<div class="fa-big__page" data-fa-bigbox><div class="fa-big__scale">' + BIG.pages[i] + '</div></div>' +
        '<button type="button" class="fa-big__nav" data-fa-bigp="1"' + (i < n - 1 ? '' : ' disabled') + ' aria-label="다음 쪽">▶</button></div></div>';
    fitBig();
  }
  function fitBig() {
    if (!BIG) return;
    var box = BIG.el.querySelector('[data-fa-bigbox]'), sc = BIG.el.querySelector('.fa-big__scale');
    if (!box || !sc) return;
    var w = Math.max(200, BIG.el.clientWidth - 120), h = Math.max(260, BIG.el.clientHeight - 90);
    var k = Math.min(w / 793.7, h / 1122.5);
    sc.style.transform = 'scale(' + k + ')';
    box.style.width = Math.floor(793.7 * k) + 'px'; box.style.height = Math.floor(1122.5 * k) + 'px';
  }
  document.addEventListener('click', function (e) {
    if (!BIG || !e.target.closest || !BIG.el.contains(e.target)) return;
    var t = e.target;
    if (t.closest('[data-fa-bigx]')) { Layer.hide(BIG.el); BIG = null; return; }
    if (t.closest('[data-fa-bigprint]')) { printList([BIG.s]); return; }
    var nv = t.closest('[data-fa-bigp]');
    if (nv && !nv.disabled) { BIG.i = Math.max(0, Math.min(BIG.pages.length - 1, BIG.i + (+nv.getAttribute('data-fa-bigp')))); paintBig(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!BIG || Layer.top() !== BIG.el) return;
    if (e.key === 'ArrowRight' && BIG.i < BIG.pages.length - 1) { BIG.i++; paintBig(); }
    if (e.key === 'ArrowLeft' && BIG.i > 0) { BIG.i--; paintBig(); }
  });
  window.addEventListener('resize', fitBig);
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
  /* ---------- 인쇄 설정 창 (20261114f · 공통 Layer) ----------
     [이 반 전체 인쇄] · [이 학생 인쇄] → 이 창 먼저 · 빠른 선택(🏅 상장처럼 = 1쪽만 · 단면 / 📘 기록까지 전부 = 전체 쪽 · 양면)
     범위(전체 쪽 · 1쪽만 · 2쪽부터 — 2쪽이 꺼진 반 · 이달판은 막힘) · 방식(양면 · 단면) · 양면이면 쪽 수가 홀수인 학생 뒤에 빈 쪽(한 명만이면 없음)
     미리보기(처음 3장 · 종이 앞 / 뒤) · 요약 「학생 n명 · 총 n쪽 · 종이 n장」 · 「프린터 설정도 ○면으로」 · 고른 범위 · 방식은 이 기기에 기억 */
  var PS = null, PS_KEY = 'mh.fin.print';
  function psLoad() { try { var o = JSON.parse(localStorage.getItem(PS_KEY) || '{}'); return { range: /^(all|p1|p1l|p2)$/.test(o.range) ? o.range : 'all', mode: o.mode === 'simplex' ? 'simplex' : 'duplex' }; } catch (e) { return { range: 'all', mode: 'duplex' }; } }
  function psSave() { try { localStorage.setItem(PS_KEY, JSON.stringify({ range: PS.range, mode: PS.mode })); } catch (e) { /* 기억 못 해도 이번엔 그대로 */ } }
  /* 학생마다 실제 쪽(넘침 맞춘 뒤 — 2쪽이 넘치면 3쪽) — 화면 밖에 A4 크기로 그려 잰다 */
  function studPages(list) {
    var tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden';
    document.body.appendChild(tmp);
    var out = views(list).map(function (v) {
      tmp.innerHTML = Finish.pagesHtml(v, popt({ base: abs('../assets/chars/'), p2: S.kind === 'year' ? p2On() : false })).join('');
      try { if (Finish.fit) Finish.fit(tmp); } catch (e) { /* 그대로 */ }
      return { name: v.name, pages: Array.prototype.map.call(tmp.querySelectorAll('.fc-page'), function (p) { return p.outerHTML; }) };
    });
    tmp.parentNode.removeChild(tmp);
    return out;
  }
  function printList(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) return;
    ready().then(function () { printList0(list); });
  }
  function printList0(list) {
    var o = psLoad();
    PS = { list: list, single: list.length === 1, studs: studPages(list), range: o.range, mode: o.mode, hint: '' };
    if (!canP2() && PS.range === 'p2') PS.range = 'all';
    /* 가운데 뜨는 보통 창 — 띄우기 · 닫기 · Esc · 맨 앞은 공통 Layer.show (Layer.make 는 화면 전체 모양이라 쓰지 않음) */
    var old = document.getElementById('faPrint'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('dialog'); el.className = 'modal fa-ps'; el.id = 'faPrint'; el.setAttribute('aria-label', '인쇄 설정');
    PS.el = el;
    paintPs();
    Layer.show(el, { onClose: function () { PS = null; } });
  }
  function canP2() { return PS && PS.studs.some(function (x) { return x.pages.length > 1; }); }
  function psPlan() { return Finish.plan(PS.studs, { range: PS.range, mode: PS.mode, single: PS.single }); }
  function pageLabel(p) { return p ? (p.blank ? '빈 쪽' : p.name + ' ' + p.no + '쪽') : ''; }
  function paintPs() {
    if (!PS) return;
    var pl = psPlan(), duplex = PS.mode === 'duplex', p2ok = canP2();
    var quick = [['p1l', 'simplex', '🏅 상장처럼', '1쪽 + 편지 · 단면', '두꺼운 상장 용지에 좋아요'], ['all', 'duplex', '📘 기록까지 전부', '전체 쪽 · 양면', '레이스 기록 · 편지까지 한 묶음']];
    var ranges = [['all', '전체 쪽', ''], ['p1l', '1쪽 + 편지', PS.studs.some(function (x) { return x.pages.some(function (h) { return /fc-letter/.test(h); }); }) ? '' : '편지(확정한 한마디)가 없으면 1쪽만'], ['p1', '1쪽만 (완주증)', ''], ['p2', '2쪽부터 (레이스 기록 · 편지)', p2ok ? '' : '1쪽뿐이에요']];
    var modes = [['duplex', '양면', '종이를 아껴요 · 학생마다 새 종이에서 시작'], ['simplex', '단면', '양면이 안 되는 프린터 · 두꺼운 종이 · 액자용']];
    /* 미리보기 — 처음 3장 */
    var sheets = [], i = 0;
    while (i < pl.pages.length && sheets.length < 3) { sheets.push({ front: pl.pages[i], back: duplex ? pl.pages[i + 1] : null }); i += duplex ? 2 : 1; }
    PS.el.innerHTML = '<div class="modal__head"><h2 class="modal__title">🖨️ 인쇄 설정</h2><p class="modal__desc">' + (PS.single ? esc(PS.studs[0].name) + ' 한 명' : esc(S.cls) + ' ' + PS.studs.length + '명') + ' · ' + (S.kind === 'year' ? '1년 완주증' : esc(S.month) + ' 완주증') + '</p></div>' +
      '<div class="modal__body fa-ps__b">' +
        '<div class="fa-ps__quick">' + quick.map(function (q) {
          var on = PS.range === q[0] && PS.mode === q[1], dis = q[0] === 'all' && !p2ok && q[1] === 'duplex' && false;
          return '<button type="button" class="fa-ps__q' + (on ? ' is-on' : '') + '" data-ps-quick="' + q[0] + '|' + q[1] + '"' + (dis ? ' disabled' : '') + '><b>' + q[2] + '</b><span>' + q[3] + '</span><small>' + q[4] + '</small></button>';
        }).join('') + '</div>' +
        '<fieldset class="fa-ps__f"><legend>인쇄 범위</legend><div class="fa-ps__opts">' + ranges.map(function (r) {
          var dis = r[0] === 'p2' && !p2ok;
          return '<label class="fa-ps__o' + (PS.range === r[0] ? ' is-on' : '') + (dis ? ' is-off' : '') + '"><input type="radio" name="psRange" value="' + r[0] + '"' + (PS.range === r[0] ? ' checked' : '') + (dis ? ' disabled' : '') + '><b>' + r[1] + '</b>' + (r[2] ? '<small>' + r[2] + '</small>' : '') + '</label>';
        }).join('') + '</div></fieldset>' +
        '<fieldset class="fa-ps__f"><legend>인쇄 방식</legend><div class="fa-ps__opts">' + modes.map(function (m) {
          return '<label class="fa-ps__o' + (PS.mode === m[0] ? ' is-on' : '') + '"><input type="radio" name="psMode" value="' + m[0] + '"' + (PS.mode === m[0] ? ' checked' : '') + '><b>' + m[1] + '</b><small>' + m[2] + '</small></label>';
        }).join('') + '</div>' + (PS.hint ? '<p class="fa-ps__hint" role="status">' + esc(PS.hint) + '</p>' : '') + '</fieldset>' +
        '<div class="fa-ps__pv" aria-label="미리보기 처음 3장">' + sheets.map(function (sh, k) {
          return '<div class="fa-ps__sheet"><p class="fa-ps__st">종이 ' + (k + 1) + '</p><div class="fa-ps__sides">' +
            '<div class="fa-ps__side' + (sh.front && sh.front.blank ? ' is-blank' : '') + '"><small>앞</small><span>' + esc(pageLabel(sh.front)) + '</span></div>' +
            (duplex ? '<div class="fa-ps__side' + (!sh.back || sh.back.blank ? ' is-blank' : '') + '"><small>뒤</small><span>' + esc(sh.back ? pageLabel(sh.back) : '빈 쪽') + '</span></div>' : '') +
          '</div></div>';
        }).join('') + (pl.sheets > 3 ? '<p class="fa-ps__more">… 종이 ' + (pl.sheets - 3) + '장 더</p>' : '') + '</div>' +
        '<p class="fa-ps__sum" data-ps-sum>학생 <b>' + pl.students + '</b>명 · 총 <b>' + pl.count + '</b>쪽 · 종이 <b>' + pl.sheets + '</b>장</p>' +
        '<p class="fa-ps__warn">⚠️ 프린터 설정도 <b>' + (duplex ? '양면' : '단면') + '</b>으로 맞춰 주세요' + (duplex ? ' (긴 쪽으로 넘기기)' : '') + '</p>' +
      '</div>' +
      '<div class="modal__foot"><div class="spacer"></div><button type="button" class="btn" data-ps-x>취소</button><button type="button" class="btn btn--primary" data-ps-go' + (pl.count ? '' : ' disabled') + '>인쇄하기</button></div>';
  }
  function psGo() {
    var pl = psPlan();
    if (!pl.count) return;
    psSave();
    var w = window.open('', '_blank');
    if (!w) { toast('팝업이 막혀 있어요 — 이 사이트의 팝업을 허용해 주세요', 'bad'); return; }
    w.document.open();
    w.document.write(Finish.printPlanDoc(pl, { css: abs('../assets/finish.css'), title: (S.kind === 'year' ? '완주증' : S.month + ' 완주증') + ' · ' + (PS.single ? PS.studs[0].name : S.cls) }));
    w.document.close();
    var tries = 0, go = function () { if (!w.__fcFitDone && tries++ < 30) { setTimeout(go, 150); return; } try { w.focus(); w.print(); } catch (e) { /* 사람이 Ctrl+P */ } };
    setTimeout(go, 300);
    Layer.hide(PS.el); PS = null;
  }
  document.addEventListener('click', function (e) {
    if (!PS || !e.target.closest || !PS.el.contains(e.target)) return;
    var t = e.target;
    if (t.closest('[data-ps-x]')) { Layer.hide(PS.el); PS = null; return; }
    if (t.closest('[data-ps-go]')) { psGo(); return; }
    var q = t.closest('[data-ps-quick]');
    if (q && !q.disabled) { var v = q.getAttribute('data-ps-quick').split('|'); PS.range = v[0] === 'p2' && !canP2() ? 'all' : v[0]; PS.mode = v[1]; PS.hint = ''; paintPs(); }
  });
  document.addEventListener('change', function (e) {
    if (!PS || !e.target || !PS.el.contains(e.target)) return;
    var t = e.target;
    if (t.name === 'psRange') { PS.range = t.value; PS.hint = ''; if ((t.value === 'p1' || t.value === 'p1l') && PS.mode === 'duplex') { PS.mode = 'simplex'; PS.hint = (t.value === 'p1' ? '1쪽만은' : '1쪽 + 편지는') + ' 단면이 좋아요 · 양면으로 바꿀 수도 있어요'; } paintPs(); }
    if (t.name === 'psMode') { PS.mode = t.value; PS.hint = ''; paintPs(); }
  });
  /* ---------- 완주증 보내기 (20261114j · migration-114 finish_send_info · finish_send_mark · 함수 sms-send purpose 'finish') ----------
     반마다 [완주증 보내기] — 학생마다 러닝노트 링크를 문자(LMS)로 · 1년판은 [러닝노트에 공개]한 학생만 · 이달판은 그 달 기록이 있는 학생
     받는 사람 학생 / 학부모 / 둘 다 · 확인 창(대상 · 번호 없음 · 링크 없음 · 이미 보냄 · 예상 비용 · 실제 한 건 문구)
     [원장님 번호로 시험 발송](설정의 내 시험 번호 · 한 건) 먼저 → [실제 발송] → 「n명에게 보낼까요?」 한 번 더
     온라인 반 자동 발송은 계속 꺼짐 — 이 버튼으로만 나감 · 같은 완주증을 같은 사람에게 두 번 보내지 않게 기록 · 번호는 화면에 보이지 않음 */
  var FS = null;
  var SITE_ME = 'https://marathonstudy.github.io/marathon-hub/me/#';
  function fsLabel() { return S.kind === 'year' ? '1년' : (+String(S.month).slice(5, 7)) + '월'; }
  function fsBodies() {
    var k = fsLabel();
    return {
      s: S.kind === 'year'
        ? '[마라톤국어] #{이름} 학생의 1년 완주증이 도착했어요. 한 해 동안 끝까지 달려 줘서 고마워요. 선생님의 편지도 함께 있어요. #{링크}'
        : '[마라톤국어] #{이름} 학생의 ' + k + ' 완주증이 도착했어요. 한 달 동안 달려온 기록을 확인해 보세요. #{링크}',
      p: '[마라톤국어] #{이름} 학생의 ' + (S.kind === 'year' ? '1년' : k) + ' 완주증이 나왔어요. 편하실 때 한 번 봐 주세요. #{링크}'
    };
  }
  function fsCan(s) { return S.kind === 'year' ? !!savedOf(s).published : !!(s.cert && s.cert.items > 0); }
  function fsBytes(t) { var n = 0; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); n += c > 0 && c < 128 ? 1 : 2; } return n; }
  function fsText(body, name) { return body.split('#{이름}').join(name).split('#{링크}').join(SITE_ME + '…'); }
  /* 보낼 줄 — [{ s, to, body }] · 빠진 이유별 학생 수 */
  function fsPlan() {
    var items = [], why = { off: 0, nophone: 0, nolink: 0, sent: 0 }, who = {};
    S.rows.forEach(function (s) {
      if (!fsCan(s)) { why.off++; return; }
      var inf = FS.info[s.id] || {}, sent = inf.sent || [], add = 0, miss = 0, nolink = 0, dup = 0;
      if (FS.to !== 'parent') {
        if (!inf.sp) miss++; else if (!inf.scode) nolink++; else if (sent.indexOf('student') >= 0) dup++; else { items.push({ s: s, to: 'student', body: FS.bs }); add++; }
      }
      if (FS.to !== 'student') {
        var pt = inf.pp ? 'parent1' : inf.pp2 ? 'parent2' : '';
        if (!pt) miss++; else if (!inf.hcode) nolink++; else if (sent.indexOf('parent1') >= 0 || sent.indexOf('parent2') >= 0) dup++; else { items.push({ s: s, to: pt, body: FS.bp }); add++; }
      }
      if (add) who[s.id] = 1;
      if (miss) why.nophone++;                    /* 그 번호만 빠짐(다른 쪽 번호가 있으면 그쪽은 보냄) */
      if (nolink) why.nolink++;
      if (dup) why.sent++;
    });
    var cfg = (window.Sms && Sms.state && Sms.state().cfg) || {}, lms = +cfg.lmsWon || 50, sms = +cfg.smsWon || 20;
    var won = items.reduce(function (w, x) { return w + (fsBytes(fsText(x.body, x.s.name) + 'xxxxxxxxxxxxxxxxxxxxxx') > 90 ? lms : sms); }, 0);
    return { items: items, people: Object.keys(who).length, why: why, won: won, lms: lms };
  }
  function openSend() {
    if (!S.rows.length) return;
    var b = fsBodies();
    var old = document.getElementById('faSend'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('dialog'); el.className = 'modal modal--wide fa-fs'; el.id = 'faSend'; el.setAttribute('aria-label', '완주증 보내기');
    FS = { el: el, to: 'student', bs: b.s, bp: b.p, info: {}, busy: true, msg: '', tested: false, loaded: false };
    paintSend();
    Layer.show(el, { onClose: function () { FS = null; } });
    Promise.resolve(sb().rpc('finish_send_info', { p_class: S.cls, p_kind: S.kind, p_key: pkey() })).then(function (r) {
      if (!FS) return;
      FS.busy = false;
      if (r.error) { FS.msg = /finish_send_info|function/.test(r.error.message || '') ? 'migration-114 SQL 을 먼저 실행해 주세요.' : r.error.message; FS.err = true; paintSend(); return; }
      (r.data || []).forEach(function (x) { FS.info[x.id] = x; });
      FS.loaded = true; paintSend();
    });
  }
  function paintSend() {
    if (!FS) return;
    var title = esc(S.cls) + ' · ' + fsLabel() + ' 완주증';
    if (FS.busy && !FS.loaded) { FS.el.innerHTML = '<div class="modal__head"><h2 class="modal__title">📨 완주증 보내기</h2><p class="modal__desc">' + title + '</p></div><div class="modal__body"><p class="panel__hint">학생 번호 · 링크를 확인하는 중…</p></div>'; return; }
    var pl = FS.loaded ? fsPlan() : { items: [], people: 0, why: { off: 0, nophone: 0, nolink: 0, sent: 0 }, won: 0 };
    var first = pl.items[0], firstP = pl.items.filter(function (x) { return x.to !== 'student'; })[0], firstS = pl.items.filter(function (x) { return x.to === 'student'; })[0];
    var tos = [['student', '학생'], ['parent', '학부모'], ['both', '둘 다']];
    FS.el.innerHTML = '<div class="modal__head"><h2 class="modal__title">📨 완주증 보내기</h2><p class="modal__desc">' + title + ' · 러닝노트 링크를 문자(LMS)로 · 온라인 반도 이 버튼으로만 나가요</p></div>' +
      '<div class="modal__body fa-fs__b">' +
        (FS.err ? '<p class="cs-err" role="alert">' + esc(FS.msg) + '</p>' : '') +
        '<fieldset class="fa-ps__f"><legend>받는 사람</legend><div class="fa-ps__opts">' + tos.map(function (t) {
          return '<label class="fa-ps__o' + (FS.to === t[0] ? ' is-on' : '') + '"><input type="radio" name="fsTo" value="' + t[0] + '"' + (FS.to === t[0] ? ' checked' : '') + '><b>' + t[1] + '</b></label>';
        }).join('') + '</div></fieldset>' +
        (FS.to !== 'parent' ? '<label class="field__label" for="fsBodyS">학생용 문구 <span class="muted-note">#{이름} · #{링크}(학생 러닝노트)</span></label><textarea class="input" id="fsBodyS" rows="3" maxlength="500">' + esc(FS.bs) + '</textarea>' : '') +
        (FS.to !== 'student' ? '<label class="field__label" for="fsBodyP">학부모용 문구 <span class="muted-note">#{이름} · #{링크}(학부모 러닝노트)</span></label><textarea class="input" id="fsBodyP" rows="3" maxlength="500">' + esc(FS.bp) + '</textarea>' : '') +
        '<div class="fa-fs__sum" data-fs-sum><p>대상 <b class="num">' + pl.people + '</b>명 · 문자 <b class="num">' + pl.items.length + '</b>건 · 예상 약 <b class="num">' + pl.won.toLocaleString() + '</b>원 <span class="muted-note">(장문 ' + pl.lms + '원 기준)</span></p>' +
          '<p class="muted-note">빠짐 — 번호 없음 <b>' + pl.why.nophone + '</b>명(그 번호만) · 링크 없음 ' + pl.why.nolink + '명 · 이미 보냄 ' + pl.why.sent + '명' +
            (S.kind === 'year' ? ' · 러닝노트 공개 안 함 ' + pl.why.off + '명' : ' · 이달 기록 없음 ' + pl.why.off + '명') + '</p></div>' +
        '<div class="fa-fs__pv"><p class="field__label">실제 한 건 미리보기</p>' +
          (firstS ? '<p class="fa-fs__msg"><small>학생 · ' + esc(firstS.s.name) + '</small>' + esc(fsText(firstS.body, firstS.s.name)) + '</p>' : '') +
          (firstP ? '<p class="fa-fs__msg"><small>학부모 · ' + esc(firstP.s.name) + '</small>' + esc(fsText(firstP.body, firstP.s.name)) + '</p>' : '') +
          (!first ? '<p class="panel__hint">보낼 학생이 없어요.</p>' : '') + '</div>' +
        (FS.msg && !FS.err ? '<p class="fa-fs__res" role="status">' + esc(FS.msg) + '</p>' : '') +
      '</div>' +
      '<div class="modal__foot"><button type="button" class="btn" data-fs-x>닫기</button><div class="spacer"></div>' +
        '<button type="button" class="btn" data-fs-test' + (first && !FS.busy ? '' : ' disabled') + '>원장님 번호로 시험 발송</button>' +
        '<button type="button" class="btn btn--primary" data-fs-go' + (first && FS.tested && !FS.busy ? '' : ' disabled title="먼저 시험 발송을 해 보세요"') + '>실제 발송 (' + pl.people + '명)</button></div>';
  }
  function fsCall(body) {
    if (window.Sms && Sms.invoke) return Promise.resolve(Sms.invoke(body));
    var f = sb() && sb().functions;
    return Promise.resolve(f.invoke('sms-send', { body: body })).then(function (r) { return (r && r.data) || { ok: false, message: '보내지 못했어요' }; });
  }
  function fsTest() {
    var pl = fsPlan(), x = pl.items[0];
    if (!x) return;
    FS.busy = true; FS.msg = '시험 발송 중…'; paintSend();
    fsCall({ action: 'test', items: [{ student_id: x.s.id, to: x.to }], body: x.body, purpose: 'finish', label: '완주증 시험 ' + pkey() }).then(function (r) {
      if (!FS) return;
      FS.busy = false;
      if (r && r.ok && r.sent) { FS.tested = true; FS.msg = '✓ 원장님 시험 번호로 한 건 보냈어요(맨 앞 「[테스트]」). 받은 문자를 확인한 뒤 [실제 발송]을 누르세요.'; }
      else FS.msg = '시험 발송 실패 — ' + ((r && (r.message || (r.results && r.results[0] && r.results[0].error))) || '설정 → 문자에서 내 시험 번호를 확인해 주세요');
      paintSend();
    }, function () { if (FS) { FS.busy = false; FS.msg = '시험 발송 실패'; paintSend(); } });
  }
  function fsGo() {
    var pl = fsPlan();
    if (!pl.items.length || !FS.tested) return;
    UI.confirmAsk('완주증 보내기', pl.people + '명에게 보낼까요? (문자 ' + pl.items.length + '건 · 예상 약 ' + pl.won.toLocaleString() + '원)', pl.people + '명에게 보내기').then(function (ok) {
      if (!ok || !FS) return;
      FS.busy = true; FS.msg = '보내는 중…'; paintSend();
      var groups = [], seen = {};
      pl.items.forEach(function (x) { var k = x.to === 'student' ? 's' : 'p'; if (!seen[k]) { seen[k] = { body: x.body, items: [] }; groups.push(seen[k]); } seen[k].items.push({ student_id: x.s.id, to: x.to }); });
      var chunks = [];
      groups.forEach(function (g) { for (var i = 0; i < g.items.length; i += 150) chunks.push({ body: g.body, items: g.items.slice(i, i + 150) }); });
      var sent = 0, failed = 0, marks = [], why = '';
      (function next() {
        var c = chunks.shift();
        if (!c) {
          var fin = function () {
            if (!FS) return;
            FS.busy = false; FS.tested = false;
            FS.msg = '보냈어요 — 접수 ' + sent + '건' + (failed ? ' · 실패 ' + failed + '건' + (why ? ' (' + why + ')' : '') : '') + ' · 같은 사람에게는 다시 보내지 않아요';
            Promise.resolve(sb().rpc('finish_send_info', { p_class: S.cls, p_kind: S.kind, p_key: pkey() })).then(function (r) { if (FS && r && !r.error) { (r.data || []).forEach(function (x) { FS.info[x.id] = x; }); } paintSend(); });
          };
          if (marks.length) Promise.resolve(sb().rpc('finish_send_mark', { p_kind: S.kind, p_key: pkey(), p_rows: marks })).then(fin, fin); else fin();
          toast('완주증 문자 — 접수 ' + sent + '건' + (failed ? ' · 실패 ' + failed + '건' : ''), failed ? 'bad' : 'good');
          return;
        }
        fsCall({ action: 'send', items: c.items, body: c.body, purpose: 'finish', label: '완주증 ' + pkey() }).then(function (r) {
          if (!r || !r.ok) { failed += c.items.length; why = (r && r.message) || why; }
          else (r.results || []).forEach(function (x) { if (x.ok) { sent++; marks.push({ student: x.student_id, target: x.to }); } else { failed++; why = why || x.error; } });
          next();
        }, function () { failed += c.items.length; next(); });
      })();
    });
  }
  document.addEventListener('click', function (e) {
    if (!FS || !e.target.closest || !FS.el.contains(e.target)) return;
    var t = e.target;
    if (t.closest('[data-fs-x]')) { Layer.hide(FS.el); FS = null; return; }
    if (FS.busy) return;
    if (t.closest('[data-fs-test]')) { fsTest(); return; }
    if (t.closest('[data-fs-go]')) { fsGo(); return; }
  });
  document.addEventListener('change', function (e) {
    if (!FS || !e.target || !FS.el.contains(e.target)) return;
    if (e.target.name === 'fsTo') { FS.to = e.target.value; FS.tested = false; paintSend(); }
  });
  document.addEventListener('input', function (e) {
    if (!FS || !e.target || !FS.el.contains(e.target)) return;
    if (e.target.id === 'fsBodyS') FS.bs = e.target.value;
    else if (e.target.id === 'fsBodyP') FS.bp = e.target.value;
    else return;
    FS.tested = false;
    var pl = fsPlan(), sum = FS.el.querySelector('[data-fs-sum]'), go = FS.el.querySelector('[data-fs-go]');
    if (sum) sum.querySelector('p').innerHTML = '대상 <b class="num">' + pl.people + '</b>명 · 문자 <b class="num">' + pl.items.length + '</b>건 · 예상 약 <b class="num">' + pl.won.toLocaleString() + '</b>원 <span class="muted-note">(장문 ' + pl.lms + '원 기준)</span>';
    if (go) { go.disabled = true; go.title = '문구를 바꿨어요 — 시험 발송을 다시 해 보세요'; }
  });
  function publish(s) {
    var v = viewOf(s);
    if (!savedOf(s).note_ok) { toast('한마디를 확정해야 공개할 수 있어요', 'bad'); return; }
    var snap = { kind: v.kind, from: v.from, to: v.to, name: v.name, cls: v.cls, game: v.game, level: v.level, title: v.title, hls: v.hls, flow: v.flow, medals: v.medals, stats: v.stats, note: v.note };
    save(s, { published: true, snap: snap }).then(function (r) { if (!r.error) { toast(s.name + ' 완주증을 러닝노트에 공개했어요', 'good'); repaintCard(s); } });
  }

  /* ---------- 누르기 ---------- */
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-fa-close]')) { dlg.close(); return; }
    var la = t.closest('[data-fa-all]'); if (la) { openAll(rowOf(la.getAttribute('data-fa-all'))); return; }
    if (t.closest('[data-fa-okall]')) { okAll(); return; }
    if (t.closest('[data-fa-send]')) { openSend(); return; }
    var k = t.closest('[data-fa-kind]');
    if (k) { S.kind = k.getAttribute('data-fa-kind'); if (S.cls) setClass(S.cls); if (!S.month) S.month = prevMonth(today()); load(); return; }
    if (t.closest('[data-fa-printall]')) { printList(S.rows); return; }
    var bg = t.closest('[data-fa-big]'); if (bg) { openBig(rowOf(bg.getAttribute('data-fa-big'))); return; }
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
    if (t.hasAttribute('data-fa-mark')) { S.mark[t.getAttribute('data-fa-mark')] = t.checked; paintBulk(); return; }
    if (t.hasAttribute('data-fa-markall')) { S.rows.forEach(function (s) { S.mark[s.id] = t.checked; }); Array.prototype.forEach.call(dlg.querySelectorAll('[data-fa-mark]'), function (x) { x.checked = t.checked; }); paintBulk(); return; }
    if (t.id === 'faClass') { setClass(t.value); if (!S.month) S.month = prevMonth(today()); load(); return; }
    if (t.id === 'faFrom' || t.id === 'faTo') { S[t.id === 'faFrom' ? 'from' : 'to'] = t.value; load(); return; }
    if (t.id === 'faMonth') { S.month = t.value; load(); return; }
    if (t.hasAttribute('data-fa-p2')) { try { localStorage.setItem('mh.fin.p2.' + S.cls, t.checked ? '1' : '0'); } catch (e2) { /* 기억 못 해도 이번엔 그대로 */ } return; }
    if (t.hasAttribute('data-fa-title')) { var s = rowOf(t.getAttribute('data-fa-title')); save(s, { title: t.value }).then(function () { savedOf(s).title_key = t.value; repaintCard(s); }); savedOf(s).title_key = t.value; return; }
    if (t.hasAttribute('data-fa-hl')) {
      var s2 = rowOf(t.getAttribute('data-fa-hl')), box = dlg.querySelector('[data-fa-id="' + s2.id + '"]');
      var keys = Array.prototype.map.call(box.querySelectorAll('[data-fa-hl]:checked'), function (x) { return x.value; });
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
    loadSign();
    S.month = S.month || prevMonth(today());
    Layer.show(dlg);
    paint();
    loadClasses().then(function () {
      if (!S.cls) { var m = S.classes.filter(function (c) { return /목동/.test(c.name) && c.kind !== 'online'; })[0]; if (m) setClass(m.name); }
      if (S.cls) load(); else paint();
    }, function (e) { S.err = String((e && e.message) || e); paint(); });
  }
  window.FinishAdmin = { open: open, state: function () { return S; }, _views: views, _ps: function () { return PS; }, _sign: function () { return SIGN; }, _lt: function () { return LT; }, _fs: function () { return FS; } };
})();
