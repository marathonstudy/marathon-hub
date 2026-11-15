/* ============================================================
   finish-rec.js — 완주증 학생 카드 「기록 상태」 (직원만 · 20261115d · migration-116 · admin/finish-admin.js 가 씀)
   카드마다 접이식 칸 — 한 줄 판정
     「기록을 다 받았는데 원래 적은 학생」(또는 「기록을 다 받았어요」) · 「아직 받는 중」 · 「받기 실패 — 이유」 · 「앱 연결 안 됨」
   자세히 — 앱 연결 여부 · 받는 경로(학생 기준 주소 / 공유 코드) · 옛 기록 받은 달 n/11 · 마지막 시도 시각 · 실패 이유 · 달별 실제 받은 과제 수(작은 막대)
   버튼 — [지금 다시 받기](옛 기록을 처음부터 · 대기 줄 맨 앞 · 실제 받기는 app-sync 가 5분마다 · 분당 28회 한도 그대로)
          [앱 학생 다시 찾기](app-sync link · 후보 여럿이면 고르기 → app_link_set) · [학생 카드 앱 연결 열기]
   반 위 — 「기록 확인 필요 n명 · [이 반 전부 다시 받기]」
   다시 받기가 끝나면(20초마다 확인) 그 학생 기록을 다시 불러와 상장 · 하이라이트 · 칭호를 다시 계산 · 직원이 확정한 한마디는 그대로
   전화번호는 받지도 보이지도 않는다 · 학생 · 학부모 화면(러닝노트)에는 없음
   ============================================================ */
(function () {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sb() { return window.SB && SB.client; }
  function kst(t) { var x = Date.parse(String(t || '')); if (isNaN(x)) return ''; var d = new Date(x + 9 * 3600000).toISOString(); return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + ' ' + d.slice(11, 16); }

  /* host — finish-admin.js 가 넘김: { S, rowOf, needCheck, oldProgress, covered, reload(ids) → Promise, repaint(s), paintList(), pkey(), toast, resetPick(ids) } */
  var H = null;
  var R = { cls: '', map: {}, sql: null, busy: false, open: {}, msg: {}, timer: null, cands: {} };

  function load(cls) {
    if (!sb()) return Promise.resolve(null);
    R.cls = cls;
    return Promise.resolve(sb().rpc('finish_rec_state', { p_class: cls })).then(function (r) {
      if (R.cls !== cls) return null;
      if (r && r.error) { R.sql = /finish_rec_state|function/.test(r.error.message || '') ? false : R.sql; return null; }
      R.sql = true;
      var prev = R.map, map = {}, done = [];
      ((r && r.data) || []).forEach(function (x) {
        map[x.id] = x;
        var p = prev[x.id];
        if (p && p.old_rush && !p.old_at && x.old_at) done.push(x.id);       /* 다시 받기가 끝난 학생 */
      });
      R.map = map;
      tick();
      return done;
    }, function () { return null; });
  }
  /* 다시 받는 학생이 있으면 20초마다 확인 · 끝난 학생은 기록을 다시 불러와 다시 계산 */
  function pending() { return Object.keys(R.map).filter(function (k) { var x = R.map[k]; return x.old_rush && !x.old_at; }); }
  function tick() {
    if (R.timer || !pending().length) return;
    R.timer = setTimeout(function () {
      R.timer = null;
      if (!H || !H.open()) return;
      load(R.cls).then(function (done) {
        if (done && done.length) H.reload(done).then(function () { H.toast(done.length + '명 기록을 다시 받았어요 · 상장 · 칭호 · 하이라이트를 새 기록으로 다시 계산했어요(확정한 한마디는 그대로)', 'good'); });
        else H.paintList();
      });
    }, 20000);
  }

  /* ---------- 판정 ---------- */
  var WHY = { no_phone: '번호 없음', phone_mismatch: '번호 불일치', name_mismatch: '이름 불일치', no_account: '앱 계정 없음', many: '후보 여러 명' };
  function errText(x) {
    var e = String((x && x.old_err) || '');
    if (/timeout/i.test(e)) return '앱이 제때 답하지 않음(timeout)';
    if (/http40[13]/.test(e)) return '앱 읽기 열쇠 문제(관리자 확인)';
    if (/http404/.test(e)) return '앱에 이 학생 계정 없음';
    if (/http429/.test(e)) return '앱 요청 한도 초과 · 잠시 뒤 저절로 다시';
    if (/http5\d\d/.test(e)) return '앱 서버 오류';
    if (/noapi/.test(e)) return '앱 주소 없음(앱 업데이트 필요)';
    if (x && x.old_status === 'none') return '앱이 이 학생 기록을 주지 않음';
    return e ? e.replace(/^앱\s*/, '앱 ') : '이유 모름';
  }
  function linkWhy(x) {
    if (!x) return '';
    if (x.state === 'retry') return '다시 찾는 중';
    return WHY[x.why] || (x.state === 'many' ? WHY.many : x.state === 'need' ? WHY.no_account : '아직 찾기 전');
  }
  /* { k: nolink | fail | wait | done, t: 한 줄 } */
  function verdict(s) {
    var x = R.map[s.id];
    if (!x) {
      if (!s.linked) return { k: 'nolink', t: '앱 연결 안 됨' };
      if (H.oldProgress(s)) return { k: 'wait', t: '아직 받는 중' };
      return { k: 'done', t: s.cert.low ? '기록을 다 받았는데 원래 적은 학생' : '기록을 다 받았어요' };
    }
    if (!x.uid) return { k: 'nolink', t: '앱 연결 안 됨 — ' + linkWhy(x) };
    if (x.old_rush && !x.old_at && (x.rush_wait || !x.old_fails)) return { k: 'wait', t: '다시 받는 중' + (x.old_month ? ' · ' + (+String(x.old_month).slice(5, 7)) + '월까지 받음' : ' · 대기 줄 맨 앞(5분 안에 시작)') };
    if (!x.old_at && (x.old_fails > 0 || x.old_status === 'fail')) return { k: 'fail', t: '받기 실패 — ' + errText(x) };
    var fresh = x.old_rush && x.old_at && Date.parse(x.old_at) >= Date.parse(x.old_rush);            /* 다시 받기를 끝까지 받음 — 서버 끝 표시를 믿음 */
    if (!x.old_at || (!fresh && H.oldProgress(s))) return { k: 'wait', t: '아직 받는 중' };
    return { k: 'done', t: s.cert.low ? '기록을 다 받았는데 원래 적은 학생' : '기록을 다 받았어요' };
  }

  /* 달별 실제 받은 과제 수 — 지금 기록 + 옛 기록(같은 제출 시각 + 제목은 한 번) · 1월 ~ 이번 달 */
  function monthly(s) {
    var S = H.S(), y = (S.kind === 'year' ? S.from : S.month + '-01').slice(0, 4), seen = {}, cnt = {};
    ((s.data && s.data.history) || []).concat((s.old && s.old.history) || []).forEach(function (h) {
      if (!h || !h.submittedAt) return;
      var k = h.submittedAt + '|' + (h.title || ''); if (seen[k]) return; seen[k] = 1;
      var t = Date.parse(h.submittedAt); if (isNaN(t)) return;
      var m = new Date(t + 9 * 3600000).toISOString().slice(0, 7);
      cnt[m] = (cnt[m] || 0) + 1;
    });
    var now = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7), last = y === now.slice(0, 4) ? +now.slice(5, 7) : 12, out = [];
    for (var m = 1; m <= last; m++) { var k = y + '-' + String(m).padStart(2, '0'); out.push({ m: m, n: cnt[k] || 0 }); }
    return out;
  }
  function barsHtml(s) {
    var ms = monthly(s), mx = Math.max.apply(null, ms.map(function (x) { return x.n; }).concat([1]));
    return '<div class="fa-rec__bars" role="img" aria-label="달별 받은 과제 수 ' + esc(ms.map(function (x) { return x.m + '월 ' + x.n; }).join(', ')) + '">' + ms.map(function (x) {
      return '<span class="fa-rec__bar' + (x.n ? '' : ' is-0') + '"><b class="num">' + x.n + '</b><i style="height:' + Math.round(x.n / mx * 100) + '%"></i><small>' + x.m + '월</small></span>';
    }).join('') + '</div>';
  }
  function rows(s) {
    var x = R.map[s.id], c = H.covered(s), out = [];
    if (!x) {
      out.push(['앱 연결', s.linked ? '됨' : '안 됨']);
      out.push(['옛 기록 받은 달', c.n + '/' + c.total + '달']);
      if (R.sql === false) out.push(['', 'migration-116 SQL 을 실행하면 받는 경로 · 마지막 시도 · 실패 이유도 보여요']);
      return out;
    }
    out.push(['앱 연결', x.uid ? '됨 · 앱 학생 #' + x.uid + (x.by === 'share' ? ' (공유 코드로 찾음)' : x.by === 'find' ? ' (이름 · 번호로 찾음)' : x.by === 'staff' ? ' (직접 넣음)' : '') : '안 됨 — ' + linkWhy(x) + (x.guess ? ' (짐작)' : '')]);
    out.push(['받는 경로', x.src === 'user' ? '학생 기준 주소(반이 바뀌어도 그대로)' : x.share ? '공유 코드' + (x.user_fail ? ' — 학생 기준 주소 실패: ' + x.user_fail : '') : x.uid ? '학생 기준 주소' : '없음']);
    out.push(['옛 기록 받은 달', c.n + '/' + c.total + '달' + (x.old_at ? ' · 다 받음 ' + kst(x.old_at) : '')]);
    out.push(['마지막 시도', x.old_try ? kst(x.old_try) + (x.old_tries ? ' · ' + x.old_tries + '번째' : '') : '아직 없음']);
    if (x.old_fails || x.old_status === 'fail') out.push(['실패 이유', errText(x) + (x.old_fails > 1 ? ' · 연속 ' + x.old_fails + '번' : '')]);
    else if (!x.uid && x.why) out.push(['실패 이유', linkWhy(x)]);
    if (x.fail) out.push(['지금 기록', '받기 실패 — ' + x.fail]);
    return out;
  }
  function panelHtml(s) {
    if (!H) return '';
    var v = verdict(s), x = R.map[s.id], open = !!R.open[s.id], cands = R.cands[s.id] || (x && x.cands) || [];
    var body = open ? '<dl class="fa-rec__dl">' + rows(s).map(function (r) { return (r[0] ? '<dt>' + esc(r[0]) + '</dt>' : '<dt></dt>') + '<dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p class="fa-rec__bt">달별 실제 받은 과제 수</p>' + barsHtml(s) +
      (cands.length > 1 && !(x && x.uid) ? '<div class="fa-rec__cands" role="group" aria-label="앱 학생 후보"><span class="muted-note">후보 ' + cands.length + '명 — 맞는 앱 학생을 골라 주세요</span>' +
        cands.map(function (u) { return '<button type="button" class="btn btn--sm" data-rec-pick="' + esc(s.id) + '|' + esc(u) + '">#' + esc(u) + '으로 연결</button>'; }).join('') + '</div>' : '') +
      '<div class="fa-rec__b">' +
        '<button type="button" class="btn btn--sm btn--primary" data-rec-redo="' + esc(s.id) + '"' + ((x ? x.uid : s.linked) ? '' : ' disabled title="앱 연결이 먼저예요"') + '>지금 다시 받기</button>' +
        '<button type="button" class="btn btn--sm" data-rec-find="' + esc(s.id) + '">앱 학생 다시 찾기</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-rec-card="' + esc(s.id) + '">학생 카드 앱 연결 열기</button></div>' +
      (R.msg[s.id] ? '<p class="fa-rec__m" role="status">' + esc(R.msg[s.id]) + '</p>' : '') : '';
    return '<details class="fa-rec fa-rec--' + v.k + '" data-rec="' + esc(s.id) + '"' + (open ? ' open' : '') + '><summary><span class="fa-rec__s">기록 상태</span> <b class="fa-rec__v">' + esc(v.t) + '</b></summary>' + body + '</details>';
  }
  /* 반 위 — 「기록 확인 필요 n명 · [이 반 전부 다시 받기]」 */
  function barHtml() {
    if (!H) return '';
    var S = H.S(), need = S.rows.filter(H.needCheck).length, wait = pending().length;
    var linked = S.rows.filter(function (s) { var x = R.map[s.id]; return x ? !!x.uid : s.linked; }).length;
    return '<div class="fa-recbar" data-rec-bar><span>기록 확인 필요 <b class="num">' + need + '</b>명' + (wait ? ' · 다시 받는 중 <b class="num">' + wait + '</b>명' : '') + '</span>' +
      '<button type="button" class="btn btn--sm" data-rec-all' + (linked && !R.busy ? '' : ' disabled') + '>이 반 전부 다시 받기</button></div>';
  }

  /* ---------- 다시 받기 ---------- */
  function redo(ids) {
    var S = H.S();
    if (!ids.length || R.busy) return Promise.resolve(false);
    R.busy = true;
    return Promise.resolve(sb().rpc('finish_old_redo', { p_students: ids, p_kind: S.kind, p_key: H.pkey() })).then(function (r) {
      R.busy = false;
      if (r && r.error) { H.toast(/finish_old_redo|function/.test(r.error.message || '') ? 'migration-116 SQL 을 먼저 실행해 주세요' : '다시 받기를 걸지 못했어요 — ' + r.error.message, 'bad'); H.paintList(); return false; }
      var n = (r.data && r.data.n) || 0, skip = (r.data && r.data.skip) || 0, now = new Date().toISOString();
      ids.forEach(function (id) { var x = R.map[id]; if (x && x.uid) { x.old_rush = now; x.old_at = null; x.old_month = null; x.old_fails = 0; x.old_status = ''; x.old_err = ''; x.rush_wait = true; } });
      H.resetPick(ids);
      H.toast(n + '명 옛 기록을 처음부터 다시 받아요 · 대기 줄 맨 앞(5분 안에 시작 · 분당 28회)' + (skip ? ' · 앱 연결 안 된 ' + skip + '명은 건너뜀' : ''), n ? 'good' : 'bad');
      H.paintList();
      tick();
      return true;
    }, function () { R.busy = false; H.toast('다시 받기를 걸지 못했어요', 'bad'); return false; });
  }
  function askAll() {
    var S = H.S(), ids = S.rows.filter(function (s) { var x = R.map[s.id]; return x ? !!x.uid : s.linked; }).map(function (s) { return s.id; });
    var off = S.rows.length - ids.length, mins = Math.max(5, Math.ceil(ids.length * 11 / 28) + 5);
    var old = document.getElementById('faRecAll'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('dialog'); el.className = 'modal fa-bk'; el.id = 'faRecAll'; el.setAttribute('aria-labelledby', 'faRecAllT'); el.setAttribute('data-ly-keep', '');
    el.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="faRecAllT">이 반 전부 다시 받기</h2><p class="modal__desc">' + esc(S.cls) + '</p></div>' +
      '<div class="modal__body fa-bk__b"><p class="fa-bk__q">' + ids.length + '명의 옛 기록을 처음부터 다시 받을까요?' + (off ? ' (앱 연결 안 된 ' + off + '명은 건너뜀)' : '') + '</p>' +
        '<p class="fa-bk__note">대기 줄 맨 앞으로 · 분당 28회 한도라 약 ' + mins + '분 걸려요. 받는 동안에도 지금 기록은 그대로 보여요. 끝나면 상장 · 칭호 · 하이라이트를 새 기록으로 다시 계산해요(확정한 한마디는 그대로).</p></div>' +
      '<div class="modal__foot"><div class="spacer"></div><button type="button" class="btn" data-recall-no>취소</button><button type="button" class="btn btn--primary" data-recall-yes' + (ids.length ? '' : ' disabled') + '>' + ids.length + '명 다시 받기</button></div>';
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-recall-yes]')) { Layer.hide(el); redo(ids); }
      else if (e.target.closest('[data-recall-no]')) Layer.hide(el);
    });
    Layer.show(el, { outside: false });
  }
  function find(id) {
    var f = sb() && sb().functions;
    if (!f || !f.invoke) return;
    R.msg[id] = '앱에서 찾는 중…'; H.paintList();
    var call = window.AppErr ? AppErr.call({ action: 'link', students: [id] }) : Promise.resolve(f.invoke('app-sync', { body: { action: 'link', students: [id] } })).then(function (r) { return r && r.data; });
    Promise.resolve(call).then(function (d) {
      R.msg[id] = d && d.ok ? (d.linked ? '찾아서 연결했어요 · [지금 다시 받기]로 옛 기록을 받으세요' : d.many ? '여럿이 나왔어요 · 아래에서 골라 주세요' : d.stopped ? '앱이 지금 답하지 않아요 (' + d.stopped + ')' : '이번에도 찾지 못했어요 · 학생 카드에서 번호를 확인해 주세요')
        : (window.AppErr ? AppErr.text(d) : (d && d.message) || '찾지 못했어요');
      if (d && d.cands) R.cands[id] = d.cands;
      load(R.cls).then(function () { H.paintList(); });
    }, function () { R.msg[id] = '찾지 못했어요'; H.paintList(); });
  }
  function pick(id, uid) {
    R.msg[id] = '연결하는 중…'; H.paintList();
    Promise.resolve(sb().rpc('app_link_set', { p_student: id, p_user: +uid })).then(function (r) {
      var d = r && r.data;
      R.msg[id] = r && !r.error && d && d.ok ? '#' + uid + '으로 연결했어요 · 다음 받기 때 앱 기록을 받아요 · [지금 다시 받기]로 옛 기록도' : d && d.reason === 'taken' ? '다른 학생이 이미 쓰는 번호예요' : '연결하지 못했어요';
      delete R.cands[id];
      load(R.cls).then(function () { H.paintList(); });
    }, function () { R.msg[id] = '연결하지 못했어요'; H.paintList(); });
  }
  function openCard(id) {
    if (!window.QuickNote || !QuickNote.open) { H.toast('학생 카드를 열 수 없어요 · 학생 탭에서 열어 주세요', 'bad'); return; }
    QuickNote.open(id);
    /* 학생 카드가 뜬 뒤 「앱 연결」 칸 펼치기 (정보를 받아 오면 버튼이 생김) */
    var n = 0;
    (function go() {
      var b = document.querySelector('[data-sc-al]');
      if (b) { if (b.getAttribute('aria-expanded') !== 'true') b.click(); return; }
      if (n++ < 20) setTimeout(go, 150);
    })();
  }

  /* 누르기 — finish 창 안 */
  function onClick(e) {
    var t = e.target;
    if (!H || !t.closest) return false;
    var sm = t.closest('.fa-rec > summary');
    if (sm) { e.preventDefault(); var id0 = sm.parentNode.getAttribute('data-rec'); R.open[id0] = !R.open[id0]; H.repaint(H.rowOf(id0)); return true; }
    var a = t.closest('[data-rec-redo]'); if (a) { if (!a.disabled) redo([a.getAttribute('data-rec-redo')]); return true; }
    var f = t.closest('[data-rec-find]'); if (f) { find(f.getAttribute('data-rec-find')); return true; }
    var p = t.closest('[data-rec-pick]'); if (p) { var v = p.getAttribute('data-rec-pick').split('|'); pick(v[0], v[1]); return true; }
    var c = t.closest('[data-rec-card]'); if (c) { openCard(c.getAttribute('data-rec-card')); return true; }
    if (t.closest('[data-rec-all]')) { if (!t.closest('[data-rec-all]').disabled) askAll(); return true; }
    return false;
  }
  function reset() { R.map = {}; R.open = {}; R.msg = {}; R.cands = {}; R.busy = false; if (R.timer) { clearTimeout(R.timer); R.timer = null; } }

  window.FinRec = { bind: function (h) { H = h; }, load: load, reset: reset, panelHtml: panelHtml, barHtml: barHtml, verdict: verdict, monthly: monthly, onClick: onClick, redo: redo, errText: errText,
                    state: function () { return R; } };
})();
