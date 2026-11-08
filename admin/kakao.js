/* ============================================================
   kakao.js — 카카오 알림톡 발송 (솔라피 · Edge Function kakao-send · migration-020)

   레포트 발송 → 3 발송 (send.js 가 그린다 · 20261028a)
     · 학생마다 상태: 보낼 수 있음 / 보냄 / 실패(이유) — 이 파일은 상태 자료(kakao_status)만 불러온다
     · 반 카드 [알림톡 n명 보내기] · 학생 줄 [알림톡] → 「n명에게 알림톡을 보냅니다. 예상 비용 약 n원」 확인
       → 함수가 DB 에서 번호를 찾아 보낸다 (화면은 학생 id 만 넘긴다). 이미 보낸 학생은 건너뛰고,
       ⋯ [알림톡 다시 보내기]로 한 번 더 확인받고 다시.
     · 띠 ⋯ [알림톡 나에게 시험 발송] — 설정에 넣은 내 번호로 한 건만
   「문자 발송」 → 연결 상태의 알림톡 칸 (20261031m · 예전 「오늘」 → [설정]) — 키가 들어갔는지(✓/✗) · 문자로 대신 보내기 · 하루 최대 · 1건 예상 비용
     (내 시험 번호 · 나에게 시험 발송은 연결 상태 위쪽 — sms.js)
   키 값 · 템플릿 ID 값은 어디에도 보이지 않는다 (함수가 있음/없음만 알려 준다).
   학생용 레포트 알림톡 (migration-071 · 20261108c)
     · 연결 상태 알림톡 칸 「학생용 레포트 알림톡 템플릿 코드」 — 원장만 고친다 (kakao_tpl_set · 조교는 「들어감 / 비어 있음」만)
       비어 있으면 학생은 지금처럼 문자 · 코드가 있으면 학생은 학생용 알림톡 (#{날짜} #{이름} #{링크} · 버튼 [레포트 보기])
     · 3 발송 [알림톡 n명 보내기] 옆 「학생에게도 학생용 알림톡 n명」 (기본 켜짐 · 이 기기에 기억) — 학부모를 보낸 뒤 학생에게
   학부모 레포트 알림톡 템플릿 코드 (migration-072 · 20261108d)
     · 같은 칸 「레포트 안내 알림톡 템플릿 코드(학부모)」 — 원장만 · 비어 있으면 지금 코드(Secrets 의 SOLAPI_TEMPLATE_ID) 그대로
       「주간레포트안내_v2」가 승인되면 새 코드만 넣고 [저장] → 바로 그 템플릿으로 · 칸 옆 [시험 발송] → 원장 내 시험 번호로 한 통 (저장 전 코드로도)
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
  /* 3 발송 — 학생에게도 학생용 알림톡 (기본 켜짐 · 이 기기에 기억) */
  var STU_KEY = 'mhub.kkStudent';
  function withStu() { try { return localStorage.getItem(STU_KEY) !== '0'; } catch (e) { return true; } }
  function setWithStu(on) { try { localStorage.setItem(STU_KEY, on ? '1' : '0'); } catch (e) {} }
  function stuTpl() { return !!(st.data && st.data.cfg && st.data.cfg.studentTpl); }
  /* 학생 알림톡을 보낼 수 있는 학생 — 공개 · 학생 링크 · 학생 번호(학부모와 다름) · 아직 안 보냄 */
  function stuTargets(ids, resend) {
    return ids.map(byId).filter(function (s) {
      return s && s.published && s.slink && s.sphone && (resend || !(s.slast && s.slast.status === 'ok'));
    }).map(function (s) { return s.id; });
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

  function byId(id) {
    return ((st.data && st.data.students) || []).find(function (x) { return x.id === id; }) || null;
  }

  function load() {
    var week = window.SendView ? SendView.week() : '';
    var run = ++st.run;
    st.week = week;
    if (!week) { st.data = null; changed(); return Promise.resolve(); }
    return sb().rpc('kakao_status', { p_week: week }).then(function (r) {
      if (run !== st.run) return;
      st.missing = !!(r.error && isMissing(r.error));
      st.data = r.error ? null : r.data;
      if (r.error && !st.missing) toast('알림톡 상태를 불러오지 못했습니다 — ' + r.error.message, 'bad');
      changed();
    });
  }
  function changed() { window.dispatchEvent(new CustomEvent('jt:kakao')); }

  /* 알림톡을 쓸 수 있는가 — 020 을 실행했고 이 주 상태를 불러왔다 */
  function ready() { return !!st.data && !st.missing && st.week === (window.SendView ? SendView.week() : ''); }

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
      parts.push('알림톡 ' + (res.stuSent != null ? '학부모 ' + res.sent + '건 · 학생 ' + res.stuSent + '건' : res.sent + '건') + ' 접수');
      if (res.stuError) parts.push('학생: ' + res.stuError);
      if (res.failed) parts.push('실패 ' + res.failed + '건');
      var sk = (res.skipped || []).length;
      if (sk) parts.push('건너뜀 ' + sk + '명');
    }
    toast(parts.join(' · '), res.failed || (test && !res.sent) ? 'bad' : 'good');
  }

  function after() {
    st.busy = false;
    if (window.SendView) SendView.refresh();     /* 레포트 발송 → 3 발송의 「보냄」 표시도 새로 */
    else load();
  }

  /* ids — 학생 id 목록 (알림톡 상태 자료에 있는 학생만) */
  /* stuIds — 학생용 알림톡을 보낼 학생 (3 발송 반 카드가 넘긴다 · 없으면 ids 에서 고른다) */
  function send(ids, resend, stuIds) {
    var list = ids.map(byId).filter(Boolean);
    var sids = stuTpl() && withStu() ? stuTargets(stuIds || ids, resend) : [];
    if (!list.length && !sids.length) { toast('알림톡을 보낼 학생이 없습니다', 'bad'); return Promise.resolve(); }
    var cfg = (st.data && st.data.cfg) || {};
    var n = list.length;
    var msgs = list.reduce(function (a, s) { return a + Math.max(1, (s.phones || []).length); }, 0);
    var won = msgs * (cfg.unitWon != null ? cfg.unitWon : 13);
    /* 「내 번호로도 한 통 받기(맨 위 학생 기준)」 — 맨 위 학생 알림톡 그대로 내 시험 번호로 (보낸 기록 「내 번호 확인용」 · sms.js · 20261031r) */
    var copy = n > 1 && !!(window.Sms && Sms.copyOn && Sms.copyOn());
    var nm0 = list.length ? (Store.getStudents().find(function (x) { return x.id === list[0].id; }) || {}).name || '첫' : '';
    won += sids.length * (cfg.unitWon != null ? cfg.unitWon : 13);
    var desc = (sids.length ? (n ? '학부모 ' + n + '명 · ' : '') + '학생 ' + sids.length + '명(학생용 알림톡)' : n + '명') + '에게 알림톡을 보냅니다' + (copy ? ' + 내 번호 1통 (맨 위 ' + nm0 + ' 학생 내용 그대로 · ' + Sms.myPhone() + ' · 보냄 표시에는 세지 않음)' : '') + '. 예상 비용 약 ' + won.toLocaleString() + '원' +
      (msgs !== n ? ' (번호 ' + msgs + '개)' : '') + '.' +
      (cfg.smsFallback ? ' 알림톡이 실패하면 문자로 대신 보내며, 그때는 건당 약 ' + LMS_WON + '원까지 더 들 수 있습니다.' : '') +
      (resend ? ' 이미 보낸 학생에게 한 번 더 보냅니다.' : '');
    return UI.confirmAsk(resend ? '알림톡 다시 보내기' : '알림톡 보내기', desc, '보내기').then(function (yes) {
      if (!yes) return;
      st.busy = true; changed();
      var all = list.map(function (s) { return s.id; });
      var chunks = [];
      for (var i = 0; i < all.length; i += 100) chunks.push(all.slice(i, i + 100));
      var total = { ok: true, sent: 0, failed: 0, skipped: [], results: [] };
      return chunks.reduce(function (p, c) {
        return p.then(function () {
          if (!total.ok) return;
          return invoke({ action: 'send', week: st.week, students: c, resend: !!resend }).then(function (r) {
            if (!r || !r.ok) { total = r || { ok: false }; return; }
            total.sent += r.sent || 0; total.failed += r.failed || 0;
            total.skipped = total.skipped.concat(r.skipped || []); total.results = total.results.concat(r.results || []);
          });
        });
      }, Promise.resolve()).then(function () {
        /* 학생 — 학생용 알림톡 (학부모를 보낸 뒤) */
        if (!total.ok || !sids.length) return;
        var sc = [];
        for (var j = 0; j < sids.length; j += 100) sc.push(sids.slice(j, j + 100));
        return sc.reduce(function (p, c) {
          return p.then(function () {
            return invoke({ action: 'send', who: 'student', week: st.week, students: c, resend: !!resend }).then(function (r) {
              if (!r || !r.ok) { total.stuError = (r && r.message) || '학생 알림톡을 보내지 못했습니다.'; return; }
              total.stuSent = (total.stuSent || 0) + (r.sent || 0); total.failed += r.failed || 0;
              total.skipped = total.skipped.concat(r.skipped || []);
            });
          });
        }, Promise.resolve());
      }).then(function () {
        summarize(total, false);
        if (!copy || !total.ok) { after(); return; }
        return invoke({ action: 'test', week: st.week, students: [list[0].id] }).then(function (r) {
          var ok = r && r.ok && r.sent;
          toast(ok ? '내 번호로도 한 통 보냈습니다 (' + nm0 + ' 학생 알림톡)' : '내 번호 확인용 한 통은 보내지 못했습니다' + (r && r.message ? ' — ' + r.message : ''), ok ? 'good' : 'bad');
          after();
        });
      });
    });
  }

  function testSend() {
    var pub = ((st.data && st.data.students) || []).filter(function (s) { return s.published && s.link; });
    if (!pub.length) { toast('이 주에 공개된 레포트가 있어야 시험 발송을 할 수 있습니다', 'bad'); return Promise.resolve(); }
    st.busy = true; changed();
    return invoke({ action: 'test', week: st.week, students: pub.slice(0, 100).map(function (s) { return s.id; }) })
      .then(function (r) { summarize(r, true); after(); });
  }

  /* ---------- 「문자 발송」 → 연결 상태 — 알림톡 칸 ---------- */

  function settingsHtml(fnRes, cfg) {
    var keys = (fnRes && fnRes.keys) || null;
    var KEY_NAME = { SOLAPI_API_KEY: 'API 키', SOLAPI_API_SECRET: 'API 시크릿', SOLAPI_PFID: '카카오 채널(pfId)', SOLAPI_TEMPLATE_ID: '템플릿 ID', SOLAPI_SENDER: '발신번호' };
    return '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">카카오 알림톡 (솔라피)</span></div>' +
      (keys
        ? '<ul class="kk-keys">' + Object.keys(KEY_NAME).map(function (k) {
            return '<li class="' + (keys[k] ? 'is-ok' : 'is-no') + '">' + (keys[k] ? '✓' : '✗') + ' ' + KEY_NAME[k] + ' <code>' + k + '</code></li>';
          }).join('') + '</ul>' +
          '<p class="field__hint">템플릿 ID: ' + (fnRes.templateSet || fnRes.templateId ? '들어감 (템플릿 「주간레포트안내」' + (fnRes.templateFrom === 'settings' ? ' · 아래 설정 코드' : '') + ')' : '아직 없음') + ' · 키 값은 화면에 보이지 않습니다 (Supabase Secrets 에만).</p>'
        : '<p class="panel__hint">' + esc((fnRes && fnRes.message) || '알림톡 함수(kakao-send)가 아직 배포되지 않았습니다.') + '</p>') +
      (cfg
        ? '<label class="check-line"><input type="checkbox" id="kkSms"' + (cfg.smsFallback ? ' checked' : '') + '> <span>알림톡이 실패하면 문자로 대신 보내기 <span class="field__opt">기본 끔 · 켜면 건당 약 ' + LMS_WON + '원까지 더 듭니다</span></span></label>' +
          '<div class="toolbar">' +
            '<label class="field"><span class="field__label">하루 최대 건수</span><input class="input input--num" id="kkDaily" type="number" min="1" max="5000" value="' + esc(cfg.dailyMax) + '"></label>' +
            '<label class="field"><span class="field__label">1건 예상 비용(원)</span><input class="input input--num" id="kkUnit" type="number" min="0" max="1000" value="' + esc(cfg.unitWon) + '"></label>' +
            '<button class="btn btn--sm" type="button" id="kkSaveCfg">알림톡 설정 저장</button>' +
          '</div>' +
          '<p class="field__hint">오늘 알림톡 ' + esc(cfg.today || 0) + '건' + (cfg.testPhone ? ' · 내 시험 번호 <span class="num">' + esc(cfg.testPhone) + '</span> (위에서 바꿉니다)' : '') + '</p>'
        : '<p class="panel__hint">migration-020 SQL 을 실행하면 알림톡 설정을 바꿀 수 있습니다.</p>') +
      tplHtml(cfg);
  }
  /* 학생용 레포트 알림톡 템플릿 코드 — 원장만 고친다 (071 전이면 칸 없음) */
  function tplHtml(cfg) {
    if (!cfg || cfg.studentTpl == null) return '';
    var v = cfg.owner && cfg.tpl ? cfg.tpl.student || '' : '';
    return parentTplHtml(cfg) + '<div class="kk-tpl" id="kkTplStudent">' +
      '<label class="field"><span class="field__label">학생용 레포트 알림톡 템플릿 코드 <span class="field__opt">「주간레포트안내_학생」 · 비우면 학생은 문자</span></span>' +
      (cfg.owner
        ? '<span class="kk-tpl__row"><input class="input" id="kkTplStudentIn" maxlength="80" autocomplete="off" spellcheck="false" placeholder="솔라피 템플릿 코드 (예: KA01TP…)" value="' + esc(v) + '">' +
          '<button class="btn btn--sm" type="button" id="kkTplStudentSave">저장</button></span>'
        : '<span class="kk-tpl__ro">' + (cfg.studentTpl ? '들어감' : '비어 있음') + ' <span class="muted-note">원장 계정만 바꿀 수 있습니다</span></span>') +
      '</label>' +
      '<p class="field__hint">' + (cfg.studentTpl ? '학생은 학생용 알림톡으로 받습니다 (카톡을 안 받으면 문자로).' : '비어 있어 학생은 지금처럼 문자로 받습니다.') +
        ' 학부모는 그대로 「주간레포트안내」 알림톡입니다. 템플릿 변수는 #{날짜} #{이름} #{링크}, 버튼은 [레포트 보기](웹링크 #{링크}).</p></div>' +
      '<div id="awdSettingsHost">' + (window.Award && Award.settingsHtml ? Award.settingsHtml() : '') + '</div>';     /* 월간 루틴 우수자 설정 (award.js · 083) */
  }
  /* 학부모 — 레포트 안내 알림톡 템플릿 코드 (072 전이면 칸 없음) */
  function parentTplHtml(cfg) {
    if (cfg.parentTpl == null) return '';
    var v = cfg.owner && cfg.tpl ? cfg.tpl.parent || '' : '';
    return '<div class="kk-tpl" id="kkTplParent">' +
      '<label class="field"><span class="field__label">레포트 안내 알림톡 템플릿 코드 (학부모) <span class="field__opt">비우면 지금 코드(Secrets 의 SOLAPI_TEMPLATE_ID) 그대로</span></span>' +
      (cfg.owner
        ? '<span class="kk-tpl__row"><input class="input" id="kkTplParentIn" maxlength="80" autocomplete="off" spellcheck="false" placeholder="비우면 지금 코드 · 새 템플릿 코드 (예: KA01TP…)" value="' + esc(v) + '">' +
          '<button class="btn btn--sm" type="button" id="kkTplParentSave">저장</button><button class="btn btn--sm" type="button" id="kkTplParentTest">시험 발송</button></span>'
        : '<span class="kk-tpl__ro">' + (cfg.parentTpl ? '설정한 코드' : '지금 코드(Secrets)') + ' <span class="muted-note">원장 계정만 바꿀 수 있습니다</span></span>') +
      '</label>' +
      '<p class="field__hint">' + (cfg.parentTpl ? '학부모는 설정한 코드로 받습니다.' : '비어 있어 학부모는 지금 「주간레포트안내」 코드로 받습니다.') +
        ' 새 템플릿(「주간레포트안내_v2」)이 승인되면 코드만 넣고 [저장]하면 바로 바뀝니다. 칸(#{이름} #{수업일} #{코드})과 [레포트 보기] 버튼은 지금과 같아야 합니다. [시험 발송]은 칸에 넣은 코드로 원장 내 시험 번호에 한 통(가장 최근 공개 레포트 내용).</p>' +
      '<p class="field__hint" id="kkTplParentMsg" role="status"></p></div>';
  }
  function saveParentTpl() {
    var v = ($('#kkTplParentIn').value || '').trim();
    if (v && !/^[A-Za-z0-9_-]{4,80}$/.test(v)) { toast('템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드를 그대로 넣어 주세요', 'bad'); return; }
    sb().rpc('kakao_tpl_set', { p_kind: 'parent', p_code: v }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast(v ? '학부모 레포트 알림톡 템플릿 코드를 저장했습니다 — 다음 발송부터 이 코드로 갑니다' : '학부모 템플릿 코드를 비웠습니다 — 지금 코드(Secrets)로 갑니다', 'good');
      loadSettings();
    });
  }
  function testParentTpl() {
    var v = ($('#kkTplParentIn').value || '').trim();
    if (v && !/^[A-Za-z0-9_-]{4,80}$/.test(v)) { toast('템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드를 그대로 넣어 주세요', 'bad'); return; }
    var b = $('#kkTplParentTest'), msg = $('#kkTplParentMsg');
    b.disabled = true; msg.textContent = '보내는 중…';
    invoke({ action: 'test', latest: true, tpl: v }).then(function (r) {
      b.disabled = false;
      var ok = r && r.ok && r.sent;
      msg.textContent = ok ? '✓ 내 시험 번호로 한 통 보냈습니다 (' + (v ? '칸에 넣은 코드' : '지금 코드') + ' · 카톡에서 확인해 보세요)'
        : '보내지 못했습니다 — ' + ((r && (r.message || (r.results && r.results[0] && r.results[0].error))) || '이유 모름');
      toast(msg.textContent, ok ? 'good' : 'bad');
    });
  }
  function saveTpl() {
    var v = ($('#kkTplStudentIn').value || '').trim();
    if (v && !/^[A-Za-z0-9_-]{4,80}$/.test(v)) { toast('템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드를 그대로 넣어 주세요', 'bad'); return; }
    sb().rpc('kakao_tpl_set', { p_kind: 'student', p_code: v }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast(v ? '학생용 템플릿 코드를 저장했습니다 — 이제 학생도 알림톡으로 받습니다' : '학생용 템플릿 코드를 비웠습니다 — 학생은 문자로 받습니다', 'good');
      loadSettings(); load();
      if (window.Sms && Sms.reloadKakao) Sms.reloadKakao();
    });
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

  /* ---------- 시작 ---------- */

  function init() {
    var set = $('#kakaoSettings');
    if (set) {
      set.addEventListener('click', function (e) {
        if (e.target.id === 'kkSaveCfg') saveCfg();
        if (e.target.id === 'kkTplStudentSave') saveTpl();
        if (e.target.id === 'kkTplParentSave') saveParentTpl();
        if (e.target.id === 'kkTplParentTest') testParentTpl();
      });
    }
  }
  init();

  window.Kakao = {
    reload: load,
    loadSettings: loadSettings,
    stateOf: stateOf,
    state: function () { return st; },
    ready: ready,
    busy: function () { return st.busy; },
    missing: function () { return st.missing; },
    of: byId,
    cfg: function () { return (st.data && st.data.cfg) || {}; },
    today: function () { return (st.data && st.data.today) || 0; },
    send: send,
    testSend: testSend,
    studentTpl: stuTpl,
    withStudent: withStu,
    setWithStudent: setWithStu,
    studentTargets: stuTargets
  };
})();
