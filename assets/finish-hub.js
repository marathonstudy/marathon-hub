/* ============================================================
   finish-hub.js — 러닝노트 「🏁 완주증 모음」 (20261114b · assets/finish.js · migration-110 hub_finish)
   · 이달의 완주증 — 매달 1일부터 지난달 것이 저절로 생긴다(그달 과제 기록이 조금이라도 있을 때만 · 이 화면이 그 학생 기록으로 만든다)
                     직원이 고른 칭호 · 하이라이트 · 확정한 한마디(finish_certs · 이달판)가 있으면 그것
   · 1년 완주증 — 직원이 [확정] + [러닝노트에 공개] 한 것만(공개할 때의 내용 snap 그대로)
   · 홈 — 새 이달의 완주증이 나오면 내 배지 아래 새 카드 「🏁 10월 완주증이 나왔어요」(한 번 보면 이 기기에서 사라짐) · 모음은 아래쪽 한 줄
   · 보기 — A4 한 장을 화면 폭에 맞춰 · 📸 사진으로 공유(사진 저장 · 카톡 공유) · 🔗 링크로 공유(기존 방식) · 문자 · 알림톡 자동 발송 없음
   FinishHub.mount(newHost, rowHost, H) — hub-home.js 가 홈을 그릴 때마다
   ============================================================ */
(function (global) {
  'use strict';
  var D = global.document;
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function store(k, v) { try { if (v === undefined) return global.localStorage.getItem(k); global.localStorage.setItem(k, v); } catch (e) { /* 기억 못 해도 그대로 */ } return null; }
  function kst(v) { var t = Date.parse(String(v || '')); return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 7); }
  function monthEnd(ym) { return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10); }
  function prevYm(ym) { var d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); }

  var F = { key: '', saved: null, loading: false, list: [], H: null, cur: 0, el: null };

  /* 받은 완주증 목록 — 최근 것부터 */
  function build(H) {
    var c = H.ctx, st = c.student || {}, today = c.today || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), out = [];
    var data = H.data || {};
    if (global.Ability && Ability.withOld) data = Ability.withOld(data);
    var months = {};
    ((data.history || data.recent || [])).forEach(function (h) { var m = h && h.submittedAt ? kst(h.submittedAt) : ''; if (m) months[m] = 1; });
    var thisM = today.slice(0, 7), sv = F.saved || {}, saveM = {};
    (sv.month || []).forEach(function (x) { if (x && x.pkey) saveM[x.pkey] = x; });
    var game = (global.Game && H.prof) ? Game.clean(H.prof, H.g ? H.g.level.i : 0) : {};
    Object.keys(months).filter(function (m) { return m < thisM; }).sort().reverse().slice(0, 12).forEach(function (m) {
      var md = c.mode ? c.mode() : null, line = md && md.classes && md.classes[0] ? md.classes[0].line : '';          /* 「목동반 · 토 18:30」 · 「온라인 · 고2 11월 마라톤」 (20261114g) */
      var cert = Finish.compute(data, { kind: 'month', from: m + '-01', to: monthEnd(m), today: today, badges: H.badges, game: game, name: st.name || '', cls: line || st.class_name || st.class || '' });
      var s = saveM[m] || {};
      var v = Finish.view(cert, { title_key: s.title || '', hl_keys: Array.isArray(s.hls) ? s.hls : [], note: s.note || '', note_ok: !!s.note });
      out.push({ key: 'm:' + m, label: (+m.slice(5, 7)) + '월 완주증', sort: m + '-99', v: v });
    });
    (sv.year || []).forEach(function (y) {
      if (!y || !y.snap) return;
      var v = Object.assign({ kind: 'year', hls: [], flow: [], game: {}, level: { i: 0, name: '' } }, y.snap);
      out.push({ key: 'y:' + y.pkey, label: String(v.to || y.pkey).slice(0, 4) + ' 1년 완주증', sort: String(v.to || '') + '-zz', v: v });
    });
    return out.sort(function (a, b) { return a.sort < b.sort ? 1 : -1; });
  }
  function newOne(H) {
    var today = (H.ctx.today || '').slice(0, 7), last = prevYm(today || new Date().toISOString().slice(0, 7));
    /* 새로 나온 것 중 아직 안 본 것 하나 — 1년 완주증(공개된 것) · 지난달 이달의 완주증 */
    return F.list.filter(function (x) { return (x.key === 'm:' + last || x.key.indexOf('y:') === 0) && !store('mh.fin.seen.' + H.ctx.code + '.' + x.key); })[0] || null;
  }
  function mount(newHost, rowHost, H) {
    if (!global.Finish || !H || H.loading || H.data === undefined) return;
    F.H = H;
    var md0 = H.ctx.mode ? H.ctx.mode() : null;
    var key = H.ctx.code + '|' + (H.data ? 1 : 0) + '|' + (H.badges ? 1 : 0) + '|' + (H.prof && H.prof.char || '') + '|' + (md0 && md0.classes && md0.classes[0] ? md0.classes[0].line : '');
    if (F.saved === null && !F.loading && H.ctx.rpc) {
      F.loading = true;
      Promise.resolve(H.ctx.rpc('hub_finish', { p_code: H.ctx.code })).then(function (r) { F.saved = r && r.ok ? r : { year: [], month: [] }; }, function () { F.saved = { year: [], month: [] }; })
        .then(function () { F.loading = false; F.key = ''; mount(D.getElementById('gmFinNew'), D.getElementById('gmFinRow'), F.H); });
    }
    if (F.key !== key || !F.list.length) { F.list = build(H); F.key = key; }
    var n = newOne(H);
    if (newHost) newHost.innerHTML = n ? '<button type="button" class="gm-card gm-row gm-row--btn fh-new" data-fh-open="' + esc(n.key) + '"><span class="gm-row__i" aria-hidden="true">🏁</span>' +
      '<div class="gm-row__t"><b>' + esc(n.label) + '이 도착했어요 <span class="gm-new">NEW</span></b><span>' + (n.key.indexOf('y:') === 0 ? '1년을 끝까지 완주했어요' : '한 달을 완주했어요') + ' · 눌러서 보기</span></div><span class="gm-row__go" aria-hidden="true">›</span></button>' : '';
    if (rowHost) rowHost.innerHTML = F.list.length ? '<button type="button" class="gm-card gm-row gm-row--btn" data-fh-open><span class="gm-row__i" aria-hidden="true">🏁</span>' +
      '<div class="gm-row__t"><b>완주증 모음</b><span>' + F.list.length + '장 · ' + esc(F.list[0].label) + '</span></div><span class="gm-row__go" aria-hidden="true">›</span></button>' : '';
  }

  /* ---------- 보기 ---------- */
  function viewerHtml() {
    var it = F.list[F.cur];
    return '<div class="fh-in" role="dialog" aria-modal="true" aria-label="완주증 모음">' +
      '<div class="fh-top"><h2 class="fh-t">🏁 완주증 모음</h2><button type="button" class="fh-x" data-fh-x aria-label="닫기">✕</button></div>' +
      '<div class="fh-tabs" role="tablist">' + F.list.map(function (x, i) { return '<button type="button" role="tab" class="fh-tab' + (i === F.cur ? ' is-on' : '') + '" aria-selected="' + (i === F.cur) + '" data-fh-i="' + i + '">' + esc(x.label) + '</button>'; }).join('') + '</div>' +
      '<div class="fh-view" data-fh-view><div class="fh-view__in">' + (it ? Finish.pageHtml(it.v, { link: true, base: (F.H && F.H.ctx.base) || '../assets/chars/' }) : '') + '</div></div>' +
      '<div class="fh-acts"><button type="button" class="fh-btn fh-btn--main" data-fh-photo>📸 사진으로 공유</button><button type="button" class="fh-btn" data-fh-link>🔗 링크로 공유</button></div>' +
      '<p class="fh-msg" data-fh-msg role="status"></p><div class="fh-fb" data-fh-fb hidden></div></div>';
  }
  function fit() {
    if (!F.el) return;
    var box = F.el.querySelector('[data-fh-view]'), inn = F.el.querySelector('.fh-view__in');
    if (!box || !inn) return;
    var w = box.clientWidth || 360, k = w / 793.7;
    inn.style.transform = 'scale(' + k + ')';
    box.style.height = Math.ceil(1122.5 * k) + 'px';
  }
  function open(key) {
    if (!F.list.length) return;
    F.cur = Math.max(0, F.list.findIndex(function (x) { return x.key === key; }));
    var it = F.list[F.cur]; if (it) store('mh.fin.seen.' + F.H.ctx.code + '.' + it.key, '1');
    var el = global.Layer.make('fh-dlg an-layer', 'fhDlg');
    el.innerHTML = viewerHtml();
    F.el = el;
    global.Layer.show(el, { full: true, onClose: function () { F.el = null; } });
    fit();
    setTimeout(fit, 60);
    var nh = D.getElementById('gmFinNew'); if (nh && F.H) mount(nh, D.getElementById('gmFinRow'), F.H);
  }
  function close() { if (!F.el) return; var el = F.el; F.el = null; global.Layer.hide(el); if (el.parentNode) el.parentNode.removeChild(el); }
  function msg(t) { var m = F.el && F.el.querySelector('[data-fh-msg]'); if (m) m.textContent = t || ''; }

  /* 사진 — A4 한 장을 그림으로 (그림 · 글꼴 모양은 그 기기에서 · 안 되는 기기는 [사진 저장] 대신 안내) */
  function dataUrl(src) {
    return fetch(src).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(src); }; fr.readAsDataURL(b); }); }, function () { return src; });
  }
  var cssText = null;
  function getCss() {
    if (cssText != null) return Promise.resolve(cssText);
    var href = new URL((F.H && F.H.ctx.base ? F.H.ctx.base.replace(/chars\/?$/, '') : '../assets/') + 'finish.css', global.location.href).href;
    return fetch(href).then(function (r) { return r.text(); }).then(function (t) { cssText = t; return t; }, function () { cssText = ''; return ''; });
  }
  function toBlob(v) {
    var holder = D.createElement('div');
    holder.innerHTML = Finish.pageHtml(v, { link: true, base: (F.H && F.H.ctx.base) || '../assets/chars/' });
    var imgs = Array.prototype.slice.call(holder.querySelectorAll('img'));
    return Promise.all([getCss()].concat(imgs.map(function (im) { return dataUrl(new URL(im.getAttribute('src'), global.location.href).href).then(function (u) { im.setAttribute('src', u); }); }))).then(function (x) {
      var css = x[0] || '';
      var xhtml = new global.XMLSerializer().serializeToString(holder.firstChild);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><foreignObject x="0" y="0" width="794" height="1123"><div xmlns="http://www.w3.org/1999/xhtml" style="width:794px;height:1123px;background:#fff"><style>' +
        css.replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }) + '</style>' + xhtml + '</div></foreignObject></svg>';
      return new Promise(function (res, rej) {
        var img = new global.Image();
        img.onload = function () {
          try {
            var k = 1080 / 794, c = D.createElement('canvas');
            c.width = 1080; c.height = Math.round(1123 * k);
            var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(k, k); g.drawImage(img, 0, 0);
            c.toBlob(function (b) { if (b) res(b); else rej(new Error('blob')); }, 'image/png');
          } catch (e) { rej(e); }
        };
        img.onerror = function () { rej(new Error('img')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    });
  }
  function photo() {
    var it = F.list[F.cur]; if (!it) return;
    msg('사진을 만드는 중…');
    toBlob(it.v).then(function (b) {
      var name = '완주증-' + it.key.replace(/[^0-9a-z-]/gi, '') + '.png';
      var file = global.File ? new File([b], name, { type: 'image/png' }) : null, n = global.navigator || {};
      if (file && n.canShare && n.canShare({ files: [file] }) && n.share) {
        return n.share({ files: [file], title: '마라톤국어 ' + it.label }).then(function () { msg('보냈어요'); }, function (e) { if (!(e && e.name === 'AbortError')) saveFb(b, name); else msg(''); });
      }
      saveFb(b, name);
    }, function () { msg('이 기기에서는 사진을 만들지 못했어요 · 화면을 캡처해 보내 주세요'); });
  }
  function saveFb(b, name) {
    var u = URL.createObjectURL(b), fb = F.el && F.el.querySelector('[data-fh-fb]');
    if (fb) { fb.hidden = false; fb.innerHTML = '<a class="fh-btn fh-btn--main" href="' + u + '" download="' + esc(name) + '">사진 저장</a><p class="fh-msg">저장한 사진을 카톡에서 보내 주세요</p>'; }
    msg('');
  }
  function link() {
    if (global.HubShare && HubShare.shareLink) { HubShare.shareLink(); msg(''); return; }
    var url = global.location.href, n = global.navigator || {};
    if (n.share) n.share({ title: '마라톤국어 러닝노트', url: url }).catch(function () {});
    else if (n.clipboard) n.clipboard.writeText(url).then(function () { msg('링크를 복사했어요'); });
  }
  D.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var o = t.closest('[data-fh-open]');
    if (o) { open(o.getAttribute('data-fh-open') || ''); return; }
    if (!F.el || !F.el.contains(t)) return;
    if (t.closest('[data-fh-x]') || t === F.el) { close(); return; }
    var i = t.closest('[data-fh-i]');
    if (i) { F.cur = +i.getAttribute('data-fh-i'); F.el.innerHTML = viewerHtml(); fit(); return; }
    if (t.closest('[data-fh-photo]')) { photo(); return; }
    if (t.closest('[data-fh-link]')) link();
  });
  global.addEventListener('resize', fit);
  global.FinishHub = { mount: mount, open: open, close: close, toBlob: toBlob, _state: function () { return F; }, _reset: function () { F.saved = null; F.list = []; F.key = ''; } };
})(window);
