/* ============================================================
   app-err.js — 코치룸이 서버 함수 app-sync(앱 읽기)를 부를 때 쓰는 공통 도우미 (20261113h)
     AppErr.call(body)  → Promise<결과> — 함수가 2xx 가 아니어도(옛 버전 400 · 없음 404 · 로그인 401 · 운영진 403 · 네트워크) 이유를 살려 돌려준다
                          (예전에는 함수 오류를 모두 「upstream」 한 단어로 덮어 원인을 알 수 없었다)
     AppErr.text(d)     → 직원이 원인을 알 수 있는 한 줄 — 「앱 응답 404 (/api/hub/classes)」 「앱 응답 401 · 키 확인」 「앱 응답 429 · 잠시 뒤」 「앱 시간 초과 25초」 …
     AppErr.wait(d)     → 다시 누를 수 있을 때까지 초(429 · 요청 제한) · 아니면 0
     AppErr.retryHtml(attr, d) → 「다시 시도」 버튼(429 면 n초 동안 막혀 있고 숫자가 줄어든다)
   키 값 · 학생 이름 · 번호는 화면에 넣지 않는다 (서버도 이유 코드 · 상태 번호 · 앱 주소 경로만 돌려준다)
   ============================================================ */
(function (global) {
  'use strict';
  function sb() { return global.SB && SB.client; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clean(d) {
    /* 서버가 준 것 중 화면에 써도 되는 칸만 */
    if (!d || typeof d !== 'object') return null;
    return d;
  }
  /* 함수가 2xx 가 아닐 때 — supabase-js 의 error.context(Response) 에서 상태 번호와 몸통을 읽는다 */
  function fromError(err) {
    var ctx = err && err.context, name = (err && err.name) || '';
    if (ctx && typeof ctx.status === 'number') {
      var st = ctx.status;
      var p = typeof ctx.json === 'function' ? Promise.resolve().then(function () { return (ctx.clone ? ctx.clone() : ctx).json(); }).catch(function () { return null; }) : Promise.resolve(null);
      return p.then(function (j) {
        j = j && typeof j === 'object' ? j : {};
        if (st === 404 && !j.reason) return { ok: false, reason: 'fn404', fn: 404 };
        if (st === 400 && j.reason === 'input') return { ok: false, reason: 'fnold', fn: 400 };
        return Object.assign({ fn: st }, j, { ok: false, reason: j.reason || 'fn' + st });
      });
    }
    if (/FetchError|Relay/i.test(name)) return Promise.resolve({ ok: false, reason: 'fnnet' });
    return Promise.resolve({ ok: false, reason: 'fnnet', detail: String((err && err.message) || '').slice(0, 60) });
  }
  function call(body) {
    var c = sb();
    if (!c || !c.functions || !c.functions.invoke) return Promise.resolve({ ok: false, reason: 'noclient' });
    return Promise.resolve(c.functions.invoke('app-sync', { body: body })).then(function (r) {
      if (r && r.error) return fromError(r.error);
      return clean(r && r.data) || { ok: false, reason: 'empty' };
    }, function (e) { return fromError(e); });
  }
  function wait(d) { return d && (d.reason === 'busy' || d.status === 429) ? Math.max(5, Math.min(120, +d.retry || 60)) : 0; }
  function text(d) {
    if (!d) return '앱에서 받지 못했어요.';
    var path = d.path ? ' (' + d.path + ')' : '', r = String(d.reason || '');
    if (r === 'noclient') return '코치룸이 서버에 연결되지 않았어요 · 다시 로그인해 주세요.';
    if (r === 'fn404') return '서버 함수 app-sync 를 찾지 못했어요 (함수 응답 404) · 함수 배포를 확인해 주세요.';
    if (r === 'fnold') return '서버 함수 app-sync 가 옛 버전이에요 (함수 응답 400) · app-sync 를 다시 배포해 주세요.';
    if (r === 'fnnet') return '서버 함수에 닿지 못했어요 (네트워크) · 인터넷 연결을 확인하고 다시 시도해 주세요.';
    if (r === 'login' || d.fn === 401) return '코치룸 로그인이 끝났어요 (함수 응답 401) · 다시 로그인해 주세요.';
    if (r === 'auth' || d.fn === 403) return '운영진 계정만 할 수 있어요 (함수 응답 403).';
    if (r === 'nokey') return '앱 읽기 키(HUB_READ_KEY)가 서버 Secrets 에 없어요.';
    if (r === 'timeout') return '앱 시간 초과 ' + (+d.sec || 25) + '초' + path + ' · 잠시 뒤 다시 시도해 주세요.';
    if (r === 'busy' || d.status === 429) return '앱 응답 429 · 잠시 뒤' + path + ' · ' + wait(d) + '초 뒤 다시 누를 수 있어요.';
    if (r === 'http401' || r === 'http403') return '앱 응답 ' + r.slice(4) + ' · 키 확인' + path + ' (HUB_READ_KEY 가 앱의 키와 같은지)';
    if (/^http\d{3}$/.test(r)) return '앱 응답 ' + r.slice(4) + path + (r === 'http404' ? ' · 앱에 이 주소가 없거나 아직 게시 전이에요' : '');
    if (r === 'shape') return '앱 응답 모양을 읽지 못했어요' + path + ' · 받은 칸: ' + (d.keys || '없음');
    if (r === 'network') return '앱 서버에 닿지 못했어요 (네트워크)' + path;
    if (r === 'upstream') return '앱에서 받지 못했어요' + path + (d.detail ? ' · ' + d.detail : '');
    if (d.status) return '앱 응답 ' + d.status + path + (r ? ' · ' + r : '');                 /* 앱이 준 이유 코드(예: class_not_found) 그대로 */
    return (d.message || '앱에서 받지 못했어요') + (r ? ' (' + r + ')' : '') + path;
  }
  /* 「다시 시도」 — 429 면 n초 동안 막고 숫자를 줄인다 (버튼이 화면에서 사라지면 멈춤) */
  function retryHtml(attr, d) {
    var w = wait(d), until = w ? Date.now() + w * 1000 : 0;
    if (until) loop();
    return '<button type="button" class="btn btn--primary app-retry" ' + attr + (until ? ' data-retry-until="' + until + '" disabled' : '') + '>' + (until ? '다시 시도 (' + w + '초)' : '다시 시도') + '</button>';
  }
  function tick() {
    var bs = document.querySelectorAll('[data-retry-until]');
    Array.prototype.forEach.call(bs, function (b) {
      var left = Math.ceil((+b.getAttribute('data-retry-until') - Date.now()) / 1000);
      if (left <= 0) { b.removeAttribute('data-retry-until'); b.disabled = false; b.textContent = '다시 시도'; }
      else b.textContent = '다시 시도 (' + left + '초)';
    });
  }
  /* 막힌 버튼이 있을 때만 1초마다 (없으면 멈춤 — 화면이 쉴 때 타이머가 돌지 않게) */
  var running = false;
  function loop() {
    if (running) return;
    running = true;
    setTimeout(function step() {
      tick();
      if (document.querySelector('[data-retry-until]')) setTimeout(step, 1000); else running = false;
    }, 1000);
  }
  global.AppErr = { call: call, text: text, wait: wait, retryHtml: retryHtml, tick: tick, _fromError: fromError, _esc: esc };
})(window);
