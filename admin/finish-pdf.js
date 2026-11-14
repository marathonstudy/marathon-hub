/* ============================================================
   finish-pdf.js — 완주증 학생별 PDF · ZIP (20261114k · 코치룸 직원 화면 · 브라우저 안에서만)
   쪽 그리기: 인쇄 창과 같은 문서(finish.css + 편지 글꼴)를 화면 밖 iframe 에 펼쳐 넘침 맞춤 → 쪽마다
     SVG foreignObject 로 브라우저가 그대로 그림(글꼴 · 그림은 data: 로 넣어 화면 미리보기와 같은 모양) → canvas → JPEG
   A4 · 220dpi(1819 × 2572) · 학생 한 명 3MB 넘으면 JPEG 품질을 낮춰 다시(그래도 넘으면 200dpi)
   PDF · ZIP 은 이 파일이 직접 만든다(라이브러리 · 서버 없음) — PDF 1.4 JPEG(DCTDecode) 쪽 · ZIP 저장 방식 + UTF-8 이름
   파일은 직원 PC 에만 저장(a download) · 서버로 보내는 것 없음
   ============================================================ */
(function (global) {
  'use strict';
  var W = 793.7, H = 1122.5;                       /* 210mm × 297mm (CSS px) */
  var MAX = 3 * 1024 * 1024 - 64 * 1024;           /* 학생 한 명 목표 — 3MB 아래 */
  var STEPS = [[220, 0.9], [220, 0.82], [220, 0.74], [220, 0.66], [200, 0.6], [200, 0.52]];

  /* ---------- 파일 이름 — 쓸 수 없는 글자(\ / : * ? " < > | · 제어 문자) 빼기 · 끝 점 · 공백 빼기 ---------- */
  function safeName(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/ +/g, ' ').trim().replace(/[. ]+$/, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = '_' + t;
    return t.slice(0, 80).replace(/[. ]+$/, '');
  }
  /* 같은 이름이 또 있으면 「 (2)」 */
  function uniq(name, used) {
    var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '', n = 1, out = name;
    while (used[out.toLowerCase()]) out = base + ' (' + (++n) + ')' + ext;
    used[out.toLowerCase()] = 1;
    return out;
  }

  /* ---------- 바이트 ---------- */
  function utf8(s) { return new TextEncoder().encode(s); }
  function latin(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function concat(parts) {
    var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  var CT = null;
  function crc32(u8) {
    if (!CT) { CT = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CT[n] = c >>> 0; } }
    var x = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) x = CT[(x ^ u8[i]) & 255] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP (저장 방식 · 압축 없음 — JPEG 든 PDF 는 더 줄지 않음 · 이름 UTF-8 표시 비트) ---------- */
  function zip(files, when) {
    var d = when || new Date(), parts = [], cen = [], off = 0;
    var dtime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var ddate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    function hdr(len) { var b = new Uint8Array(len); return { b: b, v: new DataView(b.buffer) }; }
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, crc = crc32(data);
      var L = hdr(30), v = L.v;
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, dtime, true); v.setUint16(12, ddate, true); v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      parts.push(L.b, name, data);
      var C = hdr(46), c = C.v;
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dtime, true); c.setUint16(14, ddate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      cen.push(C.b, name);
      off += 30 + name.length + data.length;
    });
    var cs = 0; cen.forEach(function (x) { cs += x.length; });
    var E = hdr(22), e = E.v;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return concat(parts.concat(cen, [E.b]));
  }

  /* ---------- PDF 1.4 — 쪽마다 A4 한 장 그림(JPEG) ---------- */
  function hex16(s) { var h = 'FEFF'; for (var i = 0; i < s.length; i++) h += ('000' + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4); return '<' + h + '>'; }
  function pdf(imgs, title) {
    var parts = [], off = 0, xref = [], PW = '595.28', PH = '841.89', n = imgs.length, kids = [];
    function put(x) { var b = typeof x === 'string' ? latin(x) : x; parts.push(b); off += b.length; }
    function obj(k, body) { xref[k] = off; put(k + ' 0 obj\n'); body(); put('\nendobj\n'); }
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    var info = 3 + n * 3;
    put('%PDF-1.4\n%âãÏÓ\n');
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>'); });
    imgs.forEach(function (g, j) {
      var pg = 3 + j * 3, ct = pg + 1, im = pg + 2, cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im' + j + ' Do Q';
      obj(pg, function () { put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im' + j + ' ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>'); });
      obj(ct, function () { put('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'); });
      obj(im, function () {
        put('<< /Type /XObject /Subtype /Image /Width ' + g.w + ' /Height ' + g.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + g.data.length + ' >>\nstream\n');
        put(g.data); put('\nendstream');
      });
    });
    obj(info, function () { put('<< /Title ' + hex16(title || '') + ' /Creator (Marathon Coachroom) /Producer (Marathon Coachroom) >>'); });
    var xo = off, size = info + 1, t = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (var k = 1; k < size; k++) t += ('000000000' + xref[k]).slice(-10) + ' 00000 n \n';
    put(t + 'trailer\n<< /Size ' + size + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xo + '\n%%EOF\n');
    return concat(parts);
  }

  /* ---------- 내려받기 (직원 PC) ---------- */
  function save(bytes, name, type) {
    var blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: type || 'application/octet-stream' });
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(u); }, 60000);
  }

  /* ---------- 글꼴 · 그림을 data: 로 ---------- */
  var DATA = {};
  function toData(url) {
    if (/^data:/.test(url)) return Promise.resolve(url);
    if (!DATA[url]) DATA[url] = fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); }).then(function (b) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
    });
    var p = DATA[url];
    p.catch(function () { if (DATA[url] === p) delete DATA[url]; });
    return p;
  }
  var TEXT = {};
  function getText(url) {
    if (!TEXT[url]) TEXT[url] = fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); });
    var p = TEXT[url];
    p.catch(function () { if (TEXT[url] === p) delete TEXT[url]; });
    return p;
  }
  /* css 의 font-family 목록에 나오는 이름들 */
  function familiesOf(css) {
    var out = {};
    (css.match(/font-family\s*:[^;}]+/g) || []).forEach(function (d) {
      d.replace(/font-family\s*:/, '').split(',').forEach(function (x) { var n = x.trim().replace(/^['"]|['"]$/g, '').replace(/\s*!important$/, '').toLowerCase(); if (n) out[n] = 1; });
    });
    return out;
  }
  function ranges(s) {
    if (!s) return null;
    return s.split(',').map(function (x) {
      x = x.trim().replace(/^u\+/i, '');
      if (/\?/.test(x)) return [parseInt(x.replace(/\?/g, '0'), 16), parseInt(x.replace(/\?/g, 'F'), 16)];
      var m = x.split('-'); return [parseInt(m[0], 16), parseInt(m[1] || m[0], 16)];
    }).filter(function (r) { return !isNaN(r[0]) && !isNaN(r[1]); });
  }
  /* @font-face 블록 — { fam, rule(url 자리 표시), url, rg } */
  function faces(css, base, want) {
    var out = [];
    (css.match(/@font-face\s*\{[^}]*\}/g) || []).forEach(function (b) {
      var fam = (b.match(/font-family\s*:\s*([^;]+);?/) || [])[1];
      fam = fam ? fam.trim().replace(/^['"]|['"]$/g, '').toLowerCase() : '';
      if (!fam || !want[fam]) return;
      var src = (b.match(/src\s*:\s*([^;}]+)/) || [])[1] || '', u = (src.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/) || [])[1];
      if (!u) return;
      var fm = (src.match(/format\(\s*['"]?([^'")]+)['"]?\s*\)/) || [])[1];
      var abs; try { abs = new URL(u, base).href; } catch (e) { return; }
      var rule = b.replace(/src\s*:\s*[^;}]+;?/, 'src: url("@@U@@")' + (fm ? ' format("' + fm + '")' : '') + ';');
      out.push({ fam: fam, rule: rule, url: abs, rg: ranges((b.match(/unicode-range\s*:\s*([^;}]+)/) || [])[1]) });
    });
    return out;
  }
  function hits(f, cps) {
    if (!f.rg) return true;
    for (var i = 0; i < cps.length; i++) for (var j = 0; j < f.rg.length; j++) if (cps[i] >= f.rg[j][0] && cps[i] <= f.rg[j][1]) return true;
    return false;
  }
  function codepoints(text) {
    var seen = {}, out = [];
    for (var ch of String(text)) { var c = ch.codePointAt(0); if (!seen[c]) { seen[c] = 1; out.push(c); } }
    for (var a = 32; a < 127; a++) if (!seen[a]) out.push(a);
    return out;
  }

  /* ---------- 한 번 만들기 (여러 학생) ----------
     o = { css: finish.css 주소, fontCss: [글꼴 css 주소 …] } → { student(pages html[], alive) → Promise<{ bytes, pages, dpi, q, fontOk }>, close() } */
  function session(o) {
    o = o || {};
    var fr = null, doc = null, prep = null, CSS = '', FACES = [], fontOk = true;
    function start() {
      if (prep) return prep;
      prep = Promise.all([
        getText(o.css),
        Promise.all((o.fontCss || []).filter(Boolean).map(function (u) { return getText(u).then(function (t) { return { u: u, t: t }; }, function () { fontOk = false; return null; }); }))
      ]).then(function (r) {
        CSS = r[0].replace(/@charset[^;]+;/g, '').replace(/@media\s+print\s*\{[^{}]*(\{[^}]*\}[^{}]*)*\}/g, '');
        var want = familiesOf(CSS);
        r[1].forEach(function (x) { if (x) FACES = FACES.concat(faces(x.t, x.u, want)); });
        /* 인쇄 창과 같은 문서 — 화면 밖(보이는 상태여야 글꼴 · 넘침을 잰다) */
        fr = document.createElement('iframe');
        fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1; fr.title = '완주증 PDF 만들기';
        fr.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + Math.ceil(W + 20) + 'px;height:' + Math.ceil(H + 20) + 'px;border:0;pointer-events:none;';
        document.body.appendChild(fr);
        doc = fr.contentDocument;
        doc.open();
        doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + CSS + '\nhtml, body { margin: 0; } .fc-page { margin: 0 !important; }</style>' +
          (o.fontCss || []).filter(Boolean).map(function (u) { return '<link rel="stylesheet" href="' + String(u).replace(/"/g, '&quot;') + '">'; }).join('') + '</head><body class="fc-print"></body></html>');
        doc.close();
        return new Promise(function (res) { if (doc.readyState === 'complete') res(); else { fr.onload = function () { res(); }; setTimeout(res, 3000); } });
      });
      return prep;
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function settle() {
      var imgs = Array.prototype.slice.call(doc.images);
      var a = Promise.all(imgs.map(function (im) { return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = r; }); }));
      var f = doc.fonts && doc.fonts.ready ? doc.fonts.ready : null;
      var fl = doc.fonts && doc.fonts.load ? Promise.all([doc.fonts.load('400 20px Gaegu', '가'), doc.fonts.load('700 20px Gaegu', '가')]).catch(function () {}) : null;
      return Promise.race([Promise.all([a, f, fl]), wait(4000)]);
    }
    /* 인쇄 창과 같게 — 글꼴이 뜬 뒤 편지 글이 칸을 넘치면 글자만 조금 줄임 */
    function shrink() {
      Array.prototype.forEach.call(doc.querySelectorAll('.fc-letter .fc-lbody'), function (b) {
        var s = parseFloat(b.style.fontSize) || 15, g = 0;
        while (b.scrollHeight - b.clientHeight > 0.5 && s > 9 && g++ < 40) { s -= 0.5; b.style.fontSize = s + 'px'; }
      });
    }
    function inline(pg) {
      return Promise.all(Array.prototype.map.call(pg.querySelectorAll('img'), function (im) {
        var u = im.getAttribute('src'); if (!u) return null;
        var abs; try { abs = new URL(u, global.location.href).href; } catch (e) { abs = u; }
        return toData(abs).then(function (d) { im.setAttribute('src', d); }, function () { im.removeAttribute('src'); });
      }));
    }
    function fontRules(text) {
      var cps = codepoints(text), use = FACES.filter(function (f) { return hits(f, cps); });
      return Promise.all(use.map(function (f) { return toData(f.url).then(function (d) { return f.rule.replace('@@U@@', d); }, function () { fontOk = false; return ''; }); })).then(function (x) { return x.join('\n'); });
    }
    function draw(svg, dpi) {
      return new Promise(function (res, rej) {
        var img = new Image(), k = dpi / 96, cw = Math.round(210 / 25.4 * dpi), ch = Math.round(297 / 25.4 * dpi);
        img.onload = function () {
          var go = function () {
            try {
              var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
              var cx = cv.getContext('2d');
              cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
              cx.drawImage(img, 0, 0, cw, ch);
              res(cv);
            } catch (e) { rej(e); }
          };
          /* 글꼴(data:)이 다 풀린 뒤 그리기 */
          (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { setTimeout(go, 60); });
        };
        img.onerror = function () { rej(new Error('쪽 그림을 만들지 못했어요')); };
        img.width = Math.round(W * k); img.height = Math.round(H * k);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    }
    function svgOf(pg, fonts, dpi) {
      var k = dpi / 96, xml = new XMLSerializer().serializeToString(pg);
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W * k) + '" height="' + Math.round(H * k) + '" viewBox="0 0 ' + W + ' ' + H + '">' +
        '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '"><div xmlns="http://www.w3.org/1999/xhtml" class="fc-print" style="margin:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden">' +
        '<style>' + fonts.replace(/<\/style/gi, '') + '\n' + CSS.replace(/<\/style/gi, '') + '\n.fc-page { margin: 0 !important; }</style>' + xml + '</div></foreignObject></svg>';
    }
    function jpeg(cv, q) {
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { if (!b) { rej(new Error('JPEG 를 만들지 못했어요')); return; } b.arrayBuffer().then(function (ab) { res({ data: new Uint8Array(ab), w: cv.width, h: cv.height }); }, rej); }, 'image/jpeg', q);
      });
    }
    function student(pages, title, alive) {
      alive = alive || function () { return true; };
      return start().then(function () {
        doc.body.innerHTML = pages.join('');
        return settle();
      }).then(function () {
        shrink();
        var pgs = Array.prototype.slice.call(doc.querySelectorAll('.fc-page'));
        if (!pgs.length) throw new Error('쪽이 없어요');
        var clones = pgs.map(function (p) { return p.cloneNode(true); });
        return Promise.all(clones.map(inline)).then(function () {
          return Promise.all(clones.map(function (c, i) { return fontRules(pgs[i].textContent || ''); }));
        }).then(function (fonts) {
          /* 해상도마다 한 번 그리고 · 3MB 넘으면 같은 그림을 품질만 낮춰 다시 JPEG */
          var stepAt = 0, cvs = null, cvDpi = 0;
          function free() { (cvs || []).forEach(function (cv) { cv.width = cv.height = 0; }); cvs = null; }
          function render(dpi) {
            var out = [], i = 0;
            function one() {
              if (!alive()) return Promise.reject(new Error('멈춤'));
              if (i >= clones.length) return Promise.resolve(out);
              var c = clones[i], f = fonts[i]; i++;
              return draw(svgOf(c, f, dpi), dpi).then(function (cv) { out.push(cv); return one(); });
            }
            return one().catch(function (e) { out.forEach(function (cv) { cv.width = cv.height = 0; }); throw e; });
          }
          function pass() {
            var st = STEPS[stepAt], dpi = st[0], q = st[1];
            var ready = cvDpi === dpi && cvs ? Promise.resolve(cvs) : (free(), render(dpi).then(function (x) { cvs = x; cvDpi = dpi; return x; }));
            return ready.then(function (list) {
              return Promise.all(list.map(function (cv) { return jpeg(cv, q); }));
            }).then(function (imgs) {
              var bytes = pdf(imgs, title);
              if (bytes.length > MAX && stepAt < STEPS.length - 1 && alive()) { stepAt++; return pass(); }
              free();
              return { bytes: bytes, pages: imgs.length, dpi: dpi, q: q, fontOk: fontOk };
            });
          }
          return pass().catch(function (e) { free(); throw e; });
        });
      });
    }
    function close() { if (fr && fr.parentNode) fr.parentNode.removeChild(fr); fr = doc = null; }
    return { student: student, close: close, _doc: function () { return doc; } };
  }

  global.FinPdf = { safeName: safeName, uniq: uniq, crc32: crc32, zip: zip, pdf: pdf, save: save, session: session, ranges: ranges, faces: faces, familiesOf: familiesOf, MAX: MAX, STEPS: STEPS };
})(window);
