/* ============================================================
   appfetch.js — 과제 기록(app-report) 불러오기 한 곳 (20261031b)

   · 학부모 링크 코드마다 한 번만 부른다 — 「오늘」 · 미리보기 · 과제 상세 보기가 같은 기록을 다시 부르지 않는다
     (30분 동안 이 화면 메모리에만 · 브라우저에 저장하지 않는다)
   · 같은 코드를 부르는 중이면 그 요청을 같이 기다린다
   · 15초 안에 답이 없으면 실패로 본다 → 화면은 「과제 기록 못 불러옴 · 다시 시도」
   · 앱 서버는 학생마다 따로 응답해서(한꺼번에 받는 주소가 없다) 여러 명을 동시에 부른다 (호출하는 쪽에서 6명씩)
   ============================================================ */

(function (global) {
  'use strict';

  var TTL = 30 * 60 * 1000, TIMEOUT = 15000;
  var cache = {};      /* code → { at, res } */
  var flying = {};     /* code → Promise */

  function url(code) { return CONFIG.supabase.url + '/functions/v1/' + CONFIG.appFunction + '?code=' + encodeURIComponent(code); }

  /* res = app-report 응답 그대로 ({ ok, data } 또는 { ok: false, reason }) */
  function get(code, force) {
    if (!code) return Promise.resolve({ ok: false, reason: 'nolink' });
    var c = cache[code];
    if (!force && c && Date.now() - c.at < TTL) return Promise.resolve(c.res);
    if (!force && flying[code]) return flying[code];
    var ctl = global.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    var p = Promise.race([
      fetch(url(code), { headers: { apikey: CONFIG.supabase.key }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http' + r.status }; }); }),
      new Promise(function (res) { setTimeout(function () { res({ ok: false, reason: 'timeout' }); }, TIMEOUT + 50); })
    ]).catch(function () { return { ok: false, reason: 'network' }; }).then(function (res) {
      clearTimeout(timer);
      delete flying[code];
      res = res || { ok: false };
      /* 실패는 저장하지 않는다 — [다시 시도]는 새로 부른다 */
      if (res.ok) cache[code] = { at: Date.now(), res: res };
      return res;
    });
    flying[code] = p;
    return p;
  }
  /* 반 단위로 한 번에 (?codes= · 30명까지 · 20261031g) — 「오늘」 첫 화면용 가벼운 기록 { 코드: res }
     함수가 아직 예전 것(codes 를 모름)이면 한 명씩 부르는 것으로 돌아간다 (6명씩 동시에) */
  var manyOff = false;
  function getMany(codes) {
    codes = (codes || []).filter(Boolean);
    if (!codes.length) return Promise.resolve({});
    if (codes.length > 30) {
      var parts = [];
      for (var i = 0; i < codes.length; i += 30) parts.push(codes.slice(i, i + 30));
      return Promise.all(parts.map(getMany)).then(function (rs) { return Object.assign.apply(null, [{}].concat(rs)); });
    }
    if (manyOff) return oneByOne(codes);
    var ctl = global.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT + 10000);
    var u = CONFIG.supabase.url + '/functions/v1/' + CONFIG.appFunction + '?codes=' + encodeURIComponent(codes.join(','));
    return Promise.resolve().then(function () { return fetch(u, { headers: { apikey: CONFIG.supabase.key }, signal: ctl ? ctl.signal : undefined }); })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (j) {
        clearTimeout(timer);
        if (j && j.ok && j.items) {
          var out = {};
          codes.forEach(function (c) { out[c] = j.items[c] || { ok: false, reason: 'upstream' }; });
          return out;
        }
        if (j && j.reason === 'invalid') manyOff = true;      /* 예전 함수 — 반 단위를 모른다 */
        return oneByOne(codes);
      });
  }
  function oneByOne(codes) {
    var out = {}, i = 0;
    function next() {
      if (i >= codes.length) return Promise.resolve();
      var c = codes[i++];
      return get(c).then(function (res) { out[c] = res; return next(); });
    }
    return Promise.all([next(), next(), next(), next(), next(), next()]).then(function () { return out; });
  }

  function peek(code) { var c = cache[code]; return c && Date.now() - c.at < TTL ? c.res : null; }
  function clear() { cache = {}; }
  /* 한 학생만 잊는다 — 링크를 바꾸면 그 학생 기록만 새로 (20261031k) */
  function forget(code) { if (code) { delete cache[code]; delete flying[code]; } }

  global.AppFetch = { get: get, getMany: getMany, peek: peek, clear: clear, forget: forget, TIMEOUT: TIMEOUT, manyOff: function () { return manyOff; } };
})(window);
