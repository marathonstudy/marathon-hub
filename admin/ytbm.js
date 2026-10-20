/* ============================================================
   ytbm.js — 즐겨찾기 버튼(북마클릿) 「마라톤 자막 가져오기」 · PC 크롬 전용

   유튜브 영상 화면에서 누르면 그 영상의 스크립트를 읽어 클립보드에 복사한다.
     맨 위  영상 제목
            https://youtu.be/영상ID
     그 아래 [0:14] 문장   (줄마다)
   · 1순위 — 영상의 자막 트랙 (한국어 수동 자막 → 없으면 한국어 자동 자막)
       지금 재생 중인 플레이어에서 영상 정보를 받는다 (다른 영상으로 넘어가도 지금 영상 것)
       ① 자막 주소를 그대로 읽어 보고 ② 비어 있으면 플레이어 자막을 잠깐 다시 켜서
       유튜브가 받아 오는 자막 응답을 그 자리에서 읽는다 (자막 켜짐 · 꺼짐은 원래대로 되돌린다)
   · 2순위 — 「스크립트 표시」 패널을 열어 화면에 나온 줄을 읽는다 (열었으면 다시 닫는다)
   · 어떤 서버로도 보내지 않는다. 외부 스크립트도 불러오지 않는다. 화면 안에서 읽고 복사만 한다.
   · 유튜브는 Trusted Types 를 쓰므로 innerHTML 대신 createElement · textContent 만 쓴다.

   코치룸은 YTBM.href() 로 즐겨찾기 버튼 주소(javascript:…)를 만든다 — 이 파일을 고치면 버튼도 같이 바뀐다.
   시험용: YTBM.run({ only: 'track' | 'panel' }) 을 유튜브 화면에서 부르면 그 방법만 쓴다.
   ============================================================ */

(function (global) {
  'use strict';

  /* 이 함수 본문이 그대로 즐겨찾기 버튼이 된다 — 바깥 변수를 쓰지 않는다 */
  function marathonTranscript(opt) {
    opt = opt || {};
    var D = document, W = window;
    var ok = function (n) { return '복사됐습니다 · ' + n + '줄 · 코치룸 AI 요약 칸에 붙여 넣으세요'; };
    var NONE = '이 영상에는 자막이 없습니다(업로드 직후면 잠시 뒤 다시)';

    function toast(msg, keep) {
      var old = D.getElementById('mt-toast');
      if (old) old.remove();
      var t = D.createElement('div');
      t.id = 'mt-toast';
      t.textContent = msg;
      t.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:12px;' +
        'background:#2C3566;color:#fff;font:600 14px/1.45 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
      D.body.appendChild(t);
      if (!keep) setTimeout(function () { t.remove(); }, 3000);
      return t;
    }

    function videoId() {
      var u = new URL(location.href), h = u.hostname, m;
      if (/(^|\.)youtube\.com$/.test(h)) {
        if (u.pathname === '/watch') return u.searchParams.get('v') || '';
        m = /^\/(shorts|live)\/([\w-]{11})/.exec(u.pathname);
        if (m) return m[2];
      }
      if (h === 'youtu.be') return u.pathname.slice(1, 12);
      return '';
    }

    var id = videoId();
    if (!/^[\w-]{11}$/.test(id)) { toast('유튜브 영상 화면에서 눌러 주세요'); return; }
    if (W.__mtBusy) return;
    W.__mtBusy = 1;
    var shorts = /^\/shorts\//.test(location.pathname);
    var wait = toast('자막을 읽는 중입니다…', 1);

    var mp = null, pr = null, title = '';
    var url = 'https://youtu.be/' + id;
    /* 지금 영상의 정보 — 다른 영상으로 막 넘어왔으면 플레이어가 준비될 때까지 (최대 5초) */
    function player() {
      mp = D.querySelector(shorts ? '#shorts-player' : '#movie_player') || D.querySelector('#movie_player');
      try { pr = mp && mp.getPlayerResponse ? mp.getPlayerResponse() : null; } catch (e) { pr = null; }
      if (pr && (!pr.videoDetails || pr.videoDetails.videoId !== id)) pr = null;
      return pr;
    }
    function ready() {
      return new Promise(function (done) {
        var k = 0;
        (function again() { if (player() || ++k > 20) done(); else setTimeout(again, 250); })();
      });
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function stamp(ms) {
      var s = Math.floor((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
      s = s % 60;
      return '[' + (h ? h + ':' + pad(m) : m) + ':' + pad(s) + ']';
    }
    function clean(x) { return String(x || '').replace(/\s+/g, ' ').trim(); }

    /* 자막 응답 → 줄 (json3 · srv3/xml 모두) */
    function parse(t, join) {
      var out = [], last = '', len = 0;
      function add(ms, x) {
        x = clean(x);
        if (!x || x === last) return;
        last = x;
        /* 자동 자막은 몇 낱말씩 끊겨 있다 — 40자 남짓까지 앞줄에 이어 붙인다 */
        if (join && out.length && len < 40) { out[out.length - 1] += ' ' + x; len += x.length + 1; return; }
        out.push(stamp(ms) + ' ' + x);
        len = x.length;
      }
      t = String(t || '').trim();
      if (!t) return out;
      if (t.charAt(0) === '{') {
        (JSON.parse(t).events || []).forEach(function (e) {
          if (e.segs) add(e.tStartMs, e.segs.map(function (s) { return s.utf8 || ''; }).join(''));
        });
      } else if (t.charAt(0) === '<') {
        var x = new DOMParser().parseFromString(t, 'text/xml');
        Array.prototype.forEach.call(x.querySelectorAll('p, text'), function (p) {
          var ms = p.hasAttribute('t') ? +p.getAttribute('t') : parseFloat(p.getAttribute('start') || '0') * 1000;
          add(ms, p.textContent);
        });
      }
      return out;
    }

    /* 한국어 수동 자막 → 한국어 자동 자막 */
    function pickTrack() {
      var list = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
                  pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
      var ko = list.filter(function (t) { return /^ko/.test(t.languageCode || ''); });
      return ko.filter(function (t) { return t.kind !== 'asr'; })[0] || ko[0] || null;
    }

    function viaUrl(tr) {
      return fetch(tr.baseUrl + '&fmt=json3', { credentials: 'include' })
        .then(function (r) { return r.text(); }).then(function (t) { return parse(t, tr.kind === 'asr'); })
        .catch(function () { return []; });
    }

    /* 플레이어 자막을 잠깐 다시 켜서 유튜브가 받아 오는 응답을 읽는다 */
    function viaPlayer(tr) {
      return new Promise(function (done) {
        if (!mp || !mp.setOption) { done([]); return; }
        var X = XMLHttpRequest.prototype, xo = X.open, xs = X.send, fo = W.fetch, fin = 0, before = null;
        try { before = mp.getOption('captions', 'track'); } catch (e) {}
        function restore() {
          try {
            if (before && before.languageCode) mp.setOption('captions', 'track', before);
            else { mp.setOption('captions', 'track', {}); if (mp.unloadModule) mp.unloadModule('captions'); }
          } catch (e) {}
        }
        function finish(lines) {
          if (fin) return;
          fin = 1;
          X.open = xo; X.send = xs; W.fetch = fo;
          restore();
          done(lines || []);
        }
        function take(u, t) {
          if (String(u).indexOf('/api/timedtext') < 0 || String(u).indexOf(id) < 0) return;
          var l = [];
          try { l = parse(t, tr.kind === 'asr'); } catch (e) {}
          if (l.length) finish(l);
        }
        X.open = function (m, u) { this.__mt = String(u || ''); return xo.apply(this, arguments); };
        X.send = function () {
          var x = this;
          if (x.__mt && x.__mt.indexOf('/api/timedtext') >= 0) {
            x.addEventListener('load', function () { var t = ''; try { t = x.responseText; } catch (e) {} take(x.__mt, t); });
          }
          return xs.apply(this, arguments);
        };
        W.fetch = function (i) {
          var u = typeof i === 'string' ? i : (i && i.url) || '';
          var p = fo.apply(this, arguments);
          if (u.indexOf('/api/timedtext') >= 0) p.then(function (r) { return r.clone().text(); }).then(function (t) { take(u, t); }, function () {});
          return p;
        };
        try { if (mp.loadModule) mp.loadModule('captions'); mp.setOption('captions', 'track', {}); } catch (e) {}
        setTimeout(function () {
          try { mp.setOption('captions', 'track', { languageCode: tr.languageCode, kind: tr.kind || '' }); } catch (e) { finish([]); }
        }, 300);
        setTimeout(function () { finish([]); }, 9000);
      });
    }

    /* 「스크립트 표시」 패널 */
    function viaPanel() {
      var SEG = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
      var old = Array.prototype.slice.call(D.querySelectorAll(SEG));
      function read(list) {
        var out = [];
        list.forEach(function (s) {
          var t = s.querySelector('.segment-timestamp, [class*="SegmentViewModelTimestamp"]:not([class*="A11y"])');
          var x = s.querySelector('.segment-text, [role="text"], .ytAttributedStringHost');
          var tt = clean(t && t.textContent), xx = clean(x && x.textContent);
          if (xx) out.push((tt ? '[' + tt + '] ' : '') + xx);
        });
        return out;
      }
      function btn() { return D.querySelector('ytd-video-description-transcript-section-renderer button'); }
      return new Promise(function (done) {
        var b = btn();
        if (!b) {
          var ex = D.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand, #description #expand');
          if (ex) ex.click();
        }
        setTimeout(function () {
          b = btn();
          if (!b) { done([]); return; }
          b.click();
          var n = -1, same = 0, tries = 0;
          var iv = setInterval(function () {
            var list = Array.prototype.slice.call(D.querySelectorAll(SEG)).filter(function (s) { return old.indexOf(s) < 0; });
            if (list.length && list.length === n) same++; else same = 0;
            n = list.length;
            if ((n && same >= 3) || ++tries > 40) {
              clearInterval(iv);
              var lines = read(list);
              var panel = list[0] && list[0].closest('ytd-engagement-panel-section-list-renderer');
              var close = panel && panel.querySelector('#visibility-button button');
              if (close) close.click();
              done(lines);
            }
          }, 300);
        }, 600);
      });
    }

    function copy(text, n) {
      function box() {
        wait.remove();
        var o = D.createElement('div');
        o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
        var c = D.createElement('div');
        c.style.cssText = 'width:min(640px,92vw);background:#fff;border-radius:14px;padding:16px;font:14px/1.5 sans-serif;color:#2C3566';
        var h = D.createElement('div');
        h.textContent = '자동 복사가 막혔습니다 — 글이 선택된 상태에서 Ctrl+C 를 누른 뒤 [닫기] (' + n + '줄)';
        h.style.cssText = 'font-weight:700;margin-bottom:8px';
        var ta = D.createElement('textarea');
        ta.value = text;
        ta.readOnly = true;
        ta.style.cssText = 'width:100%;height:50vh;box-sizing:border-box;font:13px/1.5 monospace';
        var x = D.createElement('button');
        x.textContent = '닫기';
        x.style.cssText = 'margin-top:8px;padding:8px 16px;border-radius:10px;border:0;background:#7858E8;color:#fff;font-weight:700;cursor:pointer';
        x.onclick = function () { o.remove(); };
        c.appendChild(h); c.appendChild(ta); c.appendChild(x); o.appendChild(c); D.body.appendChild(o);
        ta.focus(); ta.select();
      }
      function legacy() {
        var ta = D.createElement('textarea'), r = false;
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        D.body.appendChild(ta);
        ta.select();
        try { r = D.execCommand('copy'); } catch (e) {}
        ta.remove();
        return r;
      }
      var done = function () { toast(ok(n)); };
      if (opt.noClipboard) { box(); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { if (legacy()) done(); else { wait.remove(); box(); } });
      } else if (legacy()) done();
      else { wait.remove(); box(); }
    }

    var tr = null;
    var p = ready().then(function () {
      title = (pr && pr.videoDetails && pr.videoDetails.title) ||
        String(D.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
      tr = pickTrack();
      if (opt.only === 'panel' || !tr) return [];
      return viaUrl(tr).then(function (l) { return l.length ? l : viaPlayer(tr); });
    });
    if (opt.only !== 'track') {
      p = p.then(function (l) { return l.length ? l : viaPanel(); });
    }
    return p.then(function (lines) {
      W.__mtBusy = 0;
      W.__mtLast = lines;
      if (!lines.length) {
        toast(shorts ? '자막을 찾지 못했습니다 — 일반 화면(youtube.com/watch?v=' + id + ')으로 열어 다시 눌러 주세요' : NONE);
        return 0;
      }
      copy(title + '\n' + url + '\n\n' + lines.join('\n'), lines.length);
      return lines.length;
    }, function () {
      W.__mtBusy = 0;
      toast(NONE);
      return 0;
    });
  }

  /* 즐겨찾기 주소 — 줄 앞 들여쓰기 · 빈 줄만 덜어 낸다 (글자 안 내용은 그대로) */
  function code() {
    var src = marathonTranscript.toString().split('\n').map(function (l) { return l.replace(/^\s+/, ''); })
      .filter(Boolean).join('\n');
    return '(' + src + ')();void 0';      /* 값을 남기지 않는다 (남기면 페이지가 그 글자로 바뀐다) */
  }
  function href() { return 'javascript:' + encodeURIComponent(code()); }

  global.YTBM = { fn: marathonTranscript, code: code, href: href, run: marathonTranscript, NAME: '마라톤 자막 가져오기' };

})(window);
