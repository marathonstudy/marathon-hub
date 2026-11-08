/* ============================================================
   award.js — 월간 과제 루틴 우수자 🏅 (20261108i · migration-077 · 함수 note-remind)

   매달 1일 08:00 note-remind 가 지난달 후보를 계산해 둔다 (자동 발송 없음)
   「오늘」 맨 위 띠 「10월 루틴 우수자 후보 7명 · 확인하고 보내기」 → 확인 창
     반별 후보 — 이름 · 제출률 · 상위 %(기준 안일 때) · 연속 제출 최장 일수 · 과제 n개 중 m개
     학생별 체크 빼기 · 「선생님 한마디」 한 줄(비워도 됨) · [미리보기] = 학생 · 학부모가 볼 화면 그대로 (AwardView)
     [보내기]는 원장만 (서버도 원장인지 본다) · 같은 달은 한 학생에게 한 번만 · [우수자 다시 계산](보낸 학생은 그대로)
     기준 · 발송 방식(문자 / 알림톡 템플릿 코드 · 비어 있으면 문자) — 원장만 바꾼다
   조교도 창을 열어 볼 수 있다 (빼기 · 한마디 · 보내기는 원장만)
   077 전이면 아무것도 안 보인다.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function missing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }
  function monOf(m) { return m ? +String(m).slice(5, 7) : 0; }
  function ym(m) { return String(m || '').slice(0, 7); }
  function md(iso) { var d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); }

  var st = { d: null, off: false, busy: false, pv: '' };

  function load() {
    if (st.off || !sb()) return Promise.resolve(null);
    return Promise.resolve(sb().rpc('award_list', {})).then(function (r) {
      if (r.error) { if (missing(r.error)) st.off = true; return null; }
      st.d = r.data || null;
      return st.d;
    }, function () { return null; });
  }
  function left() { return ((st.d && st.d.list) || []).filter(function (x) { return !x.sent; }); }
  function willSend() { return left().filter(function (x) { return !x.excluded; }); }

  /* ---------- 「오늘」 맨 위 띠 ---------- */
  function bar() {
    var b = document.getElementById('awardBar');
    if (b) return b;
    var p = document.getElementById('panel-today');
    if (!p) return null;
    b = document.createElement('section');
    b.id = 'awardBar'; b.className = 'awd-bar'; b.hidden = true;
    p.insertBefore(b, p.firstChild);
    return b;
  }
  function paintBar() {
    var b = bar();
    if (!b) return;
    var d = st.d, n = left().length;
    var on = !!(d && d.month && d.cur && ym(d.month) === ym(d.cur) && n > 0);
    b.hidden = !on;
    if (!on) { b.innerHTML = ''; return; }
    b.innerHTML = '<span class="awd-bar__t">🏅 ' + monOf(d.month) + '월 루틴 우수자 후보 <b class="num">' + n + '명</b> · </span>' +
      '<button type="button" class="btn btn--sm btn--primary" data-awd-open>확인하고 보내기</button>';
  }

  /* ---------- 확인 창 ---------- */
  function dialog() {
    var d = document.getElementById('awdModal');
    if (d) return d;
    d = document.createElement('dialog');
    d.className = 'modal awd-modal'; d.id = 'awdModal';
    d.setAttribute('aria-labelledby', 'awdTitle');
    d.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="awdTitle">루틴 우수자</h2><p class="modal__desc" id="awdDesc"></p></div>' +
      '<div class="modal__body awd-mbody" id="awdBody"></div>' +
      '<div class="modal__foot awd-foot" id="awdFoot"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('change', onChange);
    return d;
  }
  function viewOf(x) {
    var d = st.d || {};
    return { month: ym(d.month), mon: monOf(d.month), name: x.name, pct: x.pct, top: x.showTop ? x.top : null, done: x.done, total: x.total,
             streak: x.streak, cal: x.cal || {}, areas: x.areas || [], note: x.note || null, badges: x.badges || 0 };
  }
  function cfgText(c) {
    return '기준 — 그달 제출률 ' + c.pct + '% 이상 · 그달 과제 ' + c.min + '개 이상 · 상위 % 는 ' + c.top + '% 이내만 보여 줌 · 늦게 낸 것은 냄 · 면제 뺌 · 직접 바꾼 값 반영';
  }
  function cfgHtml(c, owner) {
    if (!owner) return '<p class="muted-note">' + esc(cfgText(c)) + ' · 발송 ' + (c.via === 'kakao' && c.tplSet ? '알림톡' : '문자') + '</p>';
    return '<details class="awd-cfg"><summary>' + esc(cfgText(c)) + ' · 발송 ' + (c.via === 'kakao' && c.tpl ? '알림톡' : '문자') + ' — 바꾸기</summary>' +
      '<div class="awd-cfg__g">' +
        '<label>제출률 <input class="input num" type="number" min="50" max="100" id="awdCfgPct" value="' + esc(c.pct) + '">% 이상</label>' +
        '<label>그달 과제 <input class="input num" type="number" min="1" max="31" id="awdCfgMin" value="' + esc(c.min) + '">개 이상</label>' +
        '<label>상위 <input class="input num" type="number" min="1" max="100" id="awdCfgTop" value="' + esc(c.top) + '">% 이내만 보여 줌</label>' +
        '<fieldset class="awd-cfg__via"><legend>발송 방식</legend>' +
          '<label><input type="radio" name="awdVia" value="sms"' + (c.via !== 'kakao' ? ' checked' : '') + '> 문자(LMS)</label>' +
          '<label><input type="radio" name="awdVia" value="kakao"' + (c.via === 'kakao' ? ' checked' : '') + '> 알림톡</label></fieldset>' +
        '<label class="awd-cfg__tpl">알림톡 템플릿 코드 <input class="input" id="awdCfgTpl" maxlength="80" placeholder="비어 있으면 문자로 보냅니다" value="' + esc(c.tpl || '') + '"></label>' +
        '<p class="muted-note">알림톡 변수 #{이름} #{월} #{링크} · 템플릿 코드가 비어 있으면 알림톡을 골라도 문자로 보냅니다</p>' +
        '<button type="button" class="btn btn--sm btn--primary" data-awd-cfg-save>설정 저장</button>' +
      '</div></details>';
  }
  function rowHtml(x, owner) {
    var meta = x.pct + '%' + (x.showTop ? ' · 상위 ' + x.top + '%' : '') + ' · 연속 ' + x.streak + '일 · 과제 ' + x.total + '개 중 ' + x.done + '개';
    var to = [x.phone ? '학생' : '', x.parent ? '학부모' : ''].filter(Boolean).join(' · ') || '번호 없음';
    if (x.sent) {
      return '<li class="awd-row is-sent"><span class="awd-row__n"><b>' + esc(x.name) + '</b> <small class="num">' + esc(meta) + '</small></span>' +
        '<span class="awd-row__sent">보냄 ' + esc(md(x.sent)) + '</span>' +
        '<button type="button" class="link-btn" data-awd-pv="' + esc(x.id) + '">학생 화면</button></li>';
    }
    return '<li class="awd-row' + (x.excluded ? ' is-out' : '') + '">' +
      '<label class="awd-row__n"><input type="checkbox" data-awd-pick="' + esc(x.id) + '"' + (x.excluded ? '' : ' checked') + (owner ? '' : ' disabled') + '> <b>' + esc(x.name) + '</b> <small class="num">' + esc(meta) + '</small> <small class="awd-row__to">' + esc(to) + '</small></label>' +
      '<input class="input awd-row__note" data-awd-note="' + esc(x.id) + '" maxlength="120" placeholder="선생님 한마디 (비워도 됨)" value="' + esc(x.note || '') + '"' + (owner ? '' : ' disabled') + ' aria-label="' + esc(x.name + ' 선생님 한마디') + '">' +
      '<button type="button" class="btn btn--sm" data-awd-pv="' + esc(x.id) + '" aria-expanded="' + (st.pv === x.id) + '">미리보기</button>' +
    '</li>';
  }
  function render() {
    var dlg = dialog(), d = st.d;
    if (!d || !d.month) {
      $('#awdTitle', dlg).textContent = '루틴 우수자';
      $('#awdDesc', dlg).textContent = '아직 계산한 달이 없습니다 — 매달 1일 08:00 에 지난달 후보를 계산합니다';
      $('#awdBody', dlg).innerHTML = '';
      $('#awdFoot', dlg).innerHTML = (d && d.owner ? '<button type="button" class="btn" data-awd-calc>지난달 우수자 계산</button>' : '') + '<button type="button" class="btn" data-awd-close>닫기</button>';
      return;
    }
    var list = d.list || [], owner = !!d.owner, n = left().length, ws = willSend();
    $('#awdTitle', dlg).textContent = monOf(d.month) + '월 루틴 우수자 후보 ' + n + '명' + (list.length > n ? ' · 보냄 ' + (list.length - n) + '명' : '');
    $('#awdDesc', dlg).textContent = (d.computed ? md(d.computed) + ' 계산(' + (d.by || '자동') + ')' : '') + ' · 전체 수강생(과제 ' + d.cfg.min + '개 이상) ' + d.eligible + '명 중';
    var by = {};
    list.forEach(function (x) { (by[x.class || '(반 없음)'] = by[x.class || '(반 없음)'] || []).push(x); });
    var pv = list.find(function (x) { return x.id === st.pv; });
    $('#awdBody', dlg).innerHTML = cfgHtml(d.cfg, owner) +
      (list.length ? Object.keys(by).map(function (c) {
        return '<section class="awd-cls"><h3 class="awd-cls__t">' + esc(c) + ' <small class="num">' + by[c].length + '명</small></h3><ul class="awd-rows">' + by[c].map(function (x) { return rowHtml(x, owner); }).join('') + '</ul></section>';
      }).join('') : '<p class="panel__hint">기준을 넘은 학생이 없습니다</p>') +
      (pv ? '<div class="awd-pv" id="awdPv"><p class="awd-pv__t">' + esc(pv.name) + ' 학생 · 학부모가 볼 화면</p>' + (window.AwardView ? AwardView.html(viewOf(pv), { noSave: true }) : '') + '</div>' : '');
    $('#awdFoot', dlg).innerHTML = owner
      ? '<button type="button" class="btn" data-awd-calc>우수자 다시 계산</button>' +
        '<button type="button" class="btn btn--primary" data-awd-send' + (ws.length && !st.busy ? '' : ' disabled') + '>' + (st.busy ? '보내는 중…' : '보내기 ' + ws.length + '명') + '</button>' +
        '<button type="button" class="btn" data-awd-close>닫기</button>'
      : '<p class="muted-note">빼기 · 한마디 · 보내기는 원장만 할 수 있어요</p><button type="button" class="btn" data-awd-close>닫기</button>';
  }
  function open() {
    var dlg = dialog();
    st.pv = '';
    render();
    if (!dlg.open) dlg.showModal();
    load().then(function () { render(); paintBar(); });
  }
  function fn(body) {
    return sb().functions.invoke('note-remind', { body: body }).then(function (r) {
      var d = r && r.data;
      if (r.error || !d) return { ok: false, message: '서버에 연결하지 못했습니다 — note-remind 함수 배포를 확인해 주세요' };
      return d;
    }, function () { return { ok: false, message: '서버에 연결하지 못했습니다' }; });
  }
  function pick(id, patch) {
    var x = ((st.d && st.d.list) || []).find(function (y) { return y.id === id; });
    if (!x) return Promise.resolve();
    return Promise.resolve(sb().rpc('award_pick_set', { p_month: st.d.month, p_student: id, p_excluded: patch.excluded != null ? patch.excluded : x.excluded, p_note: patch.note != null ? patch.note : x.note })).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      if (patch.excluded != null) x.excluded = patch.excluded;
      if (patch.note != null) x.note = patch.note;
      render(); paintBar();
    });
  }
  function onChange(e) {
    var c = e.target.closest('[data-awd-pick]');
    if (c) { pick(c.dataset.awdPick, { excluded: !c.checked }); return; }
    var n = e.target.closest('[data-awd-note]');
    if (n) pick(n.dataset.awdNote, { note: n.value.trim() });
  }
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-awd-close]')) { dialog().close(); return; }
    var p = t.closest('[data-awd-pv]');
    if (p) { st.pv = st.pv === p.dataset.awdPv ? '' : p.dataset.awdPv; render(); var el = $('#awdPv'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); return; }
    if (t.closest('[data-awd-cfg-save]')) {
      var via = (document.querySelector('input[name="awdVia"]:checked') || {}).value || 'sms';
      Promise.resolve(sb().rpc('award_cfg_set', { p: { pct: +$('#awdCfgPct').value, min: +$('#awdCfgMin').value, top: +$('#awdCfgTop').value, via: via, tpl: $('#awdCfgTpl').value.trim() } })).then(function (r) {
        if (r.error) { toast(r.error.message, 'bad'); return; }
        toast('루틴 우수자 설정을 저장했습니다 — 기준을 바꿨으면 [우수자 다시 계산]을 눌러 주세요', 'good');
        return load().then(render);
      });
      return;
    }
    if (t.closest('[data-awd-calc]')) {
      if (st.busy) return;
      st.busy = true; render();
      fn({ action: 'award', op: 'calc', month: st.d && st.d.month ? ym(st.d.month) : '' }).then(function (d) {
        st.busy = false;
        if (!d.ok) { toast(d.message || '계산하지 못했습니다', 'bad'); render(); return; }
        toast(monOf(d.month) + '월 우수자를 다시 계산했습니다 — 후보 ' + (d.candidates || 0) + '명 (보낸 학생은 그대로)', 'good');
        return load().then(function () { render(); paintBar(); });
      });
      return;
    }
    if (t.closest('[data-awd-send]')) {
      var ws = willSend();
      if (!ws.length || st.busy) return;
      var nst = ws.filter(function (x) { return x.phone; }).length, npa = ws.filter(function (x) { return x.parent; }).length;
      var via = st.d.cfg.via === 'kakao' && st.d.cfg.tpl ? '알림톡' : '문자';
      UI.confirmAsk(monOf(st.d.month) + '월 루틴 우수자', ws.length + '명에게 ' + via + '를 보냅니다 (학생 ' + nst + '명 · 학부모 ' + npa + '명 · 같은 달은 한 번만).', '보내기').then(function (ok) {
        if (!ok) return;
        st.busy = true; render();
        return fn({ action: 'award', op: 'send', month: ym(st.d.month) }).then(function (d) {
          st.busy = false;
          if (!d.ok) { toast(d.message || '보내지 못했습니다', 'bad'); render(); return; }
          toast(monOf(st.d.month) + '월 루틴 우수자 ' + (d.students || 0) + '명에게 보냈습니다 (' + (d.sent || 0) + '통' + (d.failed ? ' · 실패 ' + d.failed : '') + ')', d.failed ? 'bad' : 'good');
          return load().then(function () { render(); paintBar(); });
        });
      });
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-awd-open]')) { e.preventDefault(); open(); }
  });
  window.addEventListener('jt:loaded', function () { load().then(paintBar); });
  window.addEventListener('jt:remote', function (e) {
    var t = e.detail && e.detail.table;
    if (t === 'routine_awards' || t === '*') load().then(function () { paintBar(); var d = document.getElementById('awdModal'); if (d && d.open) render(); });
  });

  window.Award = { load: load, open: open, paintBar: paintBar, state: function () { return st.d; } };
})();
