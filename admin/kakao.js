/* ============================================================
   kakao.js — 카카오 알림톡 발송 (솔라피 · Edge Function kakao-send · migration-020)

   ④ 발송 탭 위 「알림톡」 칸
     · 학생마다 상태: 번호 없음 / 공개 전 / 보낼 수 있음 / 보냄(시각) / 실패(이유) — 번호는 가려서
     · [알림톡 보내기 (n명)] → 「n명에게 알림톡을 보냅니다. 예상 비용 약 n원」 확인 → 함수가 DB 에서 번호를 찾아 보낸다
       (화면은 학생 id 만 넘긴다). 이미 보낸 학생은 건너뛰고, 줄마다 [다시 보내기]로 한 번 더 확인받고 다시.
     · [나에게 시험 발송] — 설정에 넣은 내 번호로 한 건만
   「오늘」 → [설정] 알림톡 칸 — 키가 들어갔는지(✓/✗) · 템플릿 ID · 문자로 대신 보내기 · 하루 최대 · 1건 예상 비용 · 내 시험 번호
   키 값은 어디에도 보이지 않는다 (함수가 있음/없음만 알려 준다).
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }
  var FN = 'kakao-send';
  var LMS_WON = 45;                     /* 문자로 대신 보낼 때 대략 (LMS) */
  var st = { week: '', data: null, missing: false, busy: false, run: 0 };

  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function invoke(body) {
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, reason: 'nofn', message: '알림톡 함수(kakao-send)를 부를 수 없습니다.' });
    return fns.invoke(FN, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().catch(function () { return null; }).then(function (j) {
          return j || { ok: false, reason: 'nofn', message: '알림톡 함수(kakao-send)를 부르지 못했습니다. 배포됐는지 확인해 주세요.' };
        });
      }
      return { ok: false, reason: 'nofn', message: '알림톡 함수(kakao-send)를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) {
      return { ok: false, reason: 'nofn', message: '알림톡 함수(kakao-send)를 부르지 못했습니다 — ' + ((e && e.message) || '') };
    });
  }

  /* ---------- 상태 ---------- */

  /* 학생 한 명 상태 — 'nophone' | 'unpublished' | 'nolink' | 'ready' | 'sent' | 'failed' */
  function stateOf(s) {
    if (!s.published) return 'unpublished';
    if (s.last && s.last.status === 'ok') return 'sent';
    if (!s.link) return 'nolink';
    if (!(s.phones || []).length) return 'nophone';
    if (s.last && s.last.status === 'fail') return 'failed';
    return 'ready';
  }
  var LABEL = { nophone: '번호 없음', unpublished: '공개 전', nolink: '학부모 링크 없음', ready: '보낼 수 있음', sent: '보냄', failed: '실패' };

  function classFilter() { return window.SendTab ? SendTab.classFilter() : ''; }
  function inClass(s) {
    var cf = classFilter();
    if (!cf) return true;
    var stu = Store.getStudents().find(function (x) { return x.id === s.id; });
    return !!stu && (stu.className || '') === cf;
  }

  function load() {
    var week = window.SendTab ? SendTab.week() : '';
    var run = ++st.run;
    st.week = week;
    if (!week) { st.data = null; render(); return Promise.resolve(); }
    return sb().rpc('kakao_status', { p_week: week }).then(function (r) {
      if (run !== st.run) return;
      st.missing = !!(r.error && isMissing(r.error));
      st.data = r.error ? null : r.data;
      if (r.error && !st.missing) toast('알림톡 상태를 불러오지 못했습니다 — ' + r.error.message, 'bad');
      render();
      decorateRows();
    });
  }

  function counts() {
    var c = { nophone: 0, unpublished: 0, nolink: 0, ready: 0, sent: 0, failed: 0 };
    ((st.data && st.data.students) || []).filter(inClass).forEach(function (s) { c[stateOf(s)]++; });
    return c;
  }
  function targets() {
    return ((st.data && st.data.students) || []).filter(inClass).filter(function (s) { var k = stateOf(s); return k === 'ready' || k === 'failed'; });
  }

  function render() {
    var host = $('#kakaoPanel');
    if (!host) return;
    if (st.missing) {
      host.innerHTML = '<div class="kk-head"><b>알림톡</b><span class="panel__hint">migration-020 SQL 을 실행하면 알림톡으로 보낼 수 있습니다.</span></div>';
      return;
    }
    if (!st.week || !st.data) { host.innerHTML = ''; return; }
    var c = counts(), t = targets();
    var cfg = st.data.cfg || {};
    var unpub = ((st.data.students) || []).filter(inClass).filter(function (s) { return stateOf(s) === 'unpublished'; });
    var names = unpub.map(function (s) { var x = Store.getStudents().find(function (y) { return y.id === s.id; }); return x ? x.name : ''; }).filter(Boolean);
    host.innerHTML =
      '<div class="kk-head"><b>💬 알림톡</b>' +
        '<span class="kk-counts">' +
          '<span class="kk-c kk-c--ready">보낼 수 있음 <b class="num">' + c.ready + '</b></span>' +
          '<span class="kk-c kk-c--sent">보냄 <b class="num">' + c.sent + '</b></span>' +
          (c.failed ? '<span class="kk-c kk-c--failed">실패 <b class="num">' + c.failed + '</b></span>' : '') +
          '<span class="kk-c">번호 없음 <b class="num">' + c.nophone + '</b></span>' +
          (c.nolink ? '<span class="kk-c">링크 없음 <b class="num">' + c.nolink + '</b></span>' : '') +
          '<span class="kk-c">공개 전 <b class="num">' + c.unpublished + '</b></span>' +
        '</span></div>' +
      '<div class="toolbar kk-acts">' +
        '<button class="btn btn--primary" type="button" id="btnKakaoSend"' + (t.length && !st.busy ? '' : ' disabled') + '>알림톡 보내기 (' + t.length + '명)</button>' +
        '<button class="btn" type="button" id="btnKakaoTest"' + (st.busy ? ' disabled' : '') + '>나에게 시험 발송</button>' +
        '<span class="panel__hint">오늘 ' + (st.data.today || 0) + ' / ' + (cfg.dailyMax || 300) + '건 · 1건 약 ' + (cfg.unitWon != null ? cfg.unitWon : 13) + '원' +
          (cfg.smsFallback ? ' · 실패하면 문자로 대신' : '') + '</span>' +
      '</div>' +
      (names.length ? '<p class="kk-unpub">공개 전 (알림톡 못 보냄): ' + esc(names.slice(0, 30).join(', ')) + (names.length > 30 ? ' 외 ' + (names.length - 30) + '명' : '') + '</p>' : '');
  }

  /* ④ 발송 목록의 줄마다 알림톡 상태 */
  function decorateRows() {
    if (!st.data) return;
    var by = {};
    (st.data.students || []).forEach(function (s) { by[s.id] = s; });
    Array.prototype.forEach.call(document.querySelectorAll('#sendList .send-row'), function (row) {
      var s = by[row.dataset.id];
      var box = row.querySelector('.kk-row');
      if (!box) {
        box = document.createElement('div');
        box.className = 'kk-row';
        var acts = row.querySelector('.send-row__acts');
        row.insertBefore(box, acts);
      }
      if (!s) { box.innerHTML = ''; return; }
      var k = stateOf(s);
      var text = LABEL[k] +
        (k === 'sent' ? ' (' + fmtDT(s.last.at) + ')' : '') +
        (k === 'failed' ? ' (' + (s.last.error || '이유 모름') + ')' : '');
      box.innerHTML = '<span class="kk-badge kk-badge--' + k + '">알림톡 · ' + esc(text) + '</span>' +
        (k === 'sent' ? '<button class="btn btn--sm btn--ghost" type="button" data-kk-resend="' + esc(s.id) + '">알림톡 다시 보내기</button>' : '');
    });
  }

  /* ---------- 보내기 ---------- */

  function summarize(res, test) {
    if (!res || !res.ok) {
      var m = (res && res.message) || '보내지 못했습니다.';
      toast(m, 'bad');
      return;
    }
    var parts = [];
    if (test) parts.push(res.sent ? '내 번호로 시험 알림톡을 보냈습니다' : '시험 발송이 실패했습니다' + (res.results && res.results[0] && res.results[0].error ? ' — ' + res.results[0].error : ''));
    else {
      parts.push('알림톡 ' + res.sent + '건 접수');
      if (res.failed) parts.push('실패 ' + res.failed + '건');
      var sk = (res.skipped || []).length;
      if (sk) parts.push('건너뜀 ' + sk + '명');
    }
    toast(parts.join(' · '), res.failed || (test && !res.sent) ? 'bad' : 'good');
  }

  function after() {
    st.busy = false;
    var rb = $('#btnSendRefresh');
    if (rb) rb.click();                  /* ④ 발송의 「보냄」 표시도 새로 */
    load();
  }

  function send(list, resend) {
    var cfg = (st.data && st.data.cfg) || {};
    var n = list.length;
    var msgs = list.reduce(function (a, s) { return a + Math.max(1, (s.phones || []).length); }, 0);
    var won = msgs * (cfg.unitWon != null ? cfg.unitWon : 13);
    var desc = n + '명에게 알림톡을 보냅니다. 예상 비용 약 ' + won.toLocaleString() + '원' +
      (msgs !== n ? ' (번호 ' + msgs + '개)' : '') + '.' +
      (cfg.smsFallback ? ' 알림톡이 실패하면 문자로 대신 보내며, 그때는 건당 약 ' + LMS_WON + '원까지 더 들 수 있습니다.' : '') +
      (resend ? ' 이미 보낸 학생에게 한 번 더 보냅니다.' : '');
    UI.confirmAsk(resend ? '알림톡 다시 보내기' : '알림톡 보내기', desc, '보내기').then(function (yes) {
      if (!yes) return;
      st.busy = true; render();
      var ids = list.map(function (s) { return s.id; });
      var chunks = [];
      for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      var total = { ok: true, sent: 0, failed: 0, skipped: [], results: [] };
      chunks.reduce(function (p, c) {
        return p.then(function () {
          if (!total.ok) return;
          return invoke({ action: 'send', week: st.week, students: c, resend: !!resend }).then(function (r) {
            if (!r || !r.ok) { total = r || { ok: false }; return; }
            total.sent += r.sent || 0; total.failed += r.failed || 0;
            total.skipped = total.skipped.concat(r.skipped || []); total.results = total.results.concat(r.results || []);
          });
        });
      }, Promise.resolve()).then(function () { summarize(total, false); after(); });
    });
  }

  function testSend() {
    var pub = ((st.data && st.data.students) || []).filter(function (s) { return s.published && s.link; });
    if (!pub.length) { toast('이 주에 공개된 레포트가 있어야 시험 발송을 할 수 있습니다', 'bad'); return; }
    st.busy = true; render();
    invoke({ action: 'test', week: st.week, students: pub.slice(0, 100).map(function (s) { return s.id; }) })
      .then(function (r) { summarize(r, true); after(); });
  }

  /* ---------- [설정] 알림톡 칸 ---------- */

  function settingsHtml(fnRes, cfg) {
    var keys = (fnRes && fnRes.keys) || null;
    var KEY_NAME = { SOLAPI_API_KEY: 'API 키', SOLAPI_API_SECRET: 'API 시크릿', SOLAPI_PFID: '카카오 채널(pfId)', SOLAPI_TEMPLATE_ID: '템플릿 ID', SOLAPI_SENDER: '발신번호' };
    return '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">카카오 알림톡 (솔라피)</span></div>' +
      (keys
        ? '<ul class="kk-keys">' + Object.keys(KEY_NAME).map(function (k) {
            return '<li class="' + (keys[k] ? 'is-ok' : 'is-no') + '">' + (keys[k] ? '✓' : '✗') + ' ' + KEY_NAME[k] + ' <code>' + k + '</code></li>';
          }).join('') + '</ul>' +
          '<p class="field__hint">템플릿 ID: ' + (fnRes.templateId ? '<code>' + esc(fnRes.templateId) + '</code>' : '아직 없음') + ' · 키 값은 화면에 보이지 않습니다 (Supabase Secrets 에만).</p>'
        : '<p class="panel__hint">' + esc((fnRes && fnRes.message) || '알림톡 함수(kakao-send)가 아직 배포되지 않았습니다.') + '</p>') +
      (cfg
        ? '<label class="check-line"><input type="checkbox" id="kkSms"' + (cfg.smsFallback ? ' checked' : '') + '> <span>알림톡이 실패하면 문자로 대신 보내기 <span class="field__opt">기본 끔 · 켜면 건당 약 ' + LMS_WON + '원까지 더 듭니다</span></span></label>' +
          '<div class="toolbar">' +
            '<label class="field"><span class="field__label">하루 최대 건수</span><input class="input input--num" id="kkDaily" type="number" min="1" max="5000" value="' + esc(cfg.dailyMax) + '"></label>' +
            '<label class="field"><span class="field__label">1건 예상 비용(원)</span><input class="input input--num" id="kkUnit" type="number" min="0" max="1000" value="' + esc(cfg.unitWon) + '"></label>' +
            '<button class="btn btn--sm" type="button" id="kkSaveCfg">알림톡 설정 저장</button>' +
          '</div>' +
          '<div class="toolbar">' +
            '<label class="field"><span class="field__label">내 시험 번호 <span class="field__opt">나만 보입니다 · [나에게 시험 발송]에 씀</span></span>' +
              '<input class="input" id="kkTestPhone" type="tel" inputmode="numeric" autocomplete="off" placeholder="' + esc(cfg.testPhone || '010-1234-5678') + '"></label>' +
            '<button class="btn btn--sm" type="button" id="kkSaveTest">내 번호 저장</button>' +
          '</div>' +
          (cfg.testPhone ? '<p class="field__hint">지금 내 시험 번호: <span class="num">' + esc(cfg.testPhone) + '</span> (빈 칸으로 저장하면 지웁니다)</p>' : '')
        : '<p class="panel__hint">migration-020 SQL 을 실행하면 알림톡 설정을 바꿀 수 있습니다.</p>');
  }

  function loadSettings() {
    var host = $('#kakaoSettings');
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<p class="panel__hint">알림톡 설정을 불러오는 중…</p>';
    Promise.all([
      invoke({ action: 'status' }),
      sb().rpc('kakao_settings_get').then(function (r) { return r.error ? null : r.data; }, function () { return null; })
    ]).then(function (res) {
      host.innerHTML = settingsHtml(res[0] || null, res[1]);
    });
  }

  function saveCfg() {
    var p = { p_sms: $('#kkSms').checked, p_daily: Math.round(Number($('#kkDaily').value) || 0), p_unit: Math.round(Number($('#kkUnit').value)) };
    sb().rpc('kakao_settings_set', p).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast('알림톡 설정을 저장했습니다', 'good');
      loadSettings(); load();
    });
  }
  function saveTest() {
    sb().rpc('kakao_test_phone_set', { p_phone: $('#kkTestPhone').value }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast(r.data && r.data.testPhone ? '내 시험 번호를 저장했습니다 (' + r.data.testPhone + ')' : '내 시험 번호를 지웠습니다', 'good');
      loadSettings();
    });
  }

  /* ---------- 시작 ---------- */

  function init() {
    var panel = $('#kakaoPanel');
    if (!panel) return;
    panel.addEventListener('click', function (e) {
      if (e.target.closest('#btnKakaoSend')) send(targets(), false);
      if (e.target.closest('#btnKakaoTest')) testSend();
    });
    $('#sendList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kk-resend]');
      if (!b) return;
      e.stopPropagation();
      var s = ((st.data && st.data.students) || []).find(function (x) { return x.id === b.dataset.kkResend; });
      if (s) send([s], true);
    });
    window.addEventListener('jt:send-rendered', function () { if (st.week === (window.SendTab ? SendTab.week() : '')) { render(); decorateRows(); } else load(); });
    document.addEventListener('jt:tab', function (e) { if (e.detail.index === 3) load(); });
    var set = $('#kakaoSettings');
    if (set) {
      $('#tdSettingsBtn').addEventListener('click', loadSettings);
      set.addEventListener('click', function (e) {
        if (e.target.id === 'kkSaveCfg') saveCfg();
        if (e.target.id === 'kkSaveTest') saveTest();
      });
    }
  }
  init();

  window.Kakao = { reload: load, stateOf: stateOf, state: function () { return st; } };
})();
