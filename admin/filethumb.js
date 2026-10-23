/* ============================================================
   filethumb.js — 배부 자료 · 과제 파일 「첫 페이지 그림」 만들기 (weekly.js · migration-029 · 20261029i)

   학생 · 학부모 화면의 파일 카드 윗부분에 보일 작은 그림(가로 400px 안팎 · JPG)을 브라우저에서 만든다.
     · PDF       첫 페이지 — pdf.js 를 cdnjs 에서 버전을 고정해 필요할 때만 불러온다
     · JPG · PNG  그 그림을 줄인 것
     · 그 밖(HWP · DOC · PPT · XLSX)  만들지 않는다 (학생 화면은 종류별 아이콘 카드)
   만든 그림은 같은 보관함(class-files) · 같은 폴더에 「원래이름.thumb.jpg」로 올리고 class_files.thumb_path 에 적는다.
   ============================================================ */

(function () {
  'use strict';

  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var WIDTH = 400;
  var TARGET = 60 * 1024;
  var CAN = { pdf: 1, jpg: 1, jpeg: 1, png: 1 };

  var loading = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('PDF 그림 도구를 불러오지 못했습니다')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { loading = null; reject(new Error('PDF 그림 도구를 불러오지 못했습니다 (인터넷 연결 확인)')); };
      /* 20초 안에 안 오면 포기 (파일은 이미 올라가 있다) */
      setTimeout(function () { if (!window.pdfjsLib) { loading = null; reject(new Error('PDF 그림 도구를 불러오지 못했습니다 (시간 초과)')); } }, 20000);
      document.head.appendChild(s);
    });
    return loading;
  }

  function toJpeg(canvas) {
    function at(q) {
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); }).then(function (b) {
        if (!b) throw new Error('그림을 만들지 못했습니다');
        if (b.size <= TARGET || q <= 0.5) return b;
        return at(Math.round((q - 0.1) * 100) / 100);
      });
    }
    return at(0.8);
  }

  /* 흰 바탕 · 가로 WIDTH 로 줄여 그린다 */
  function drawScaled(src, w0, h0) {
    var scale = Math.min(1, WIDTH / w0);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale));
    c.height = Math.max(1, Math.round(h0 * scale));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function fromPdf(blob) {
    return pdfjs().then(function (lib) {
      return blob.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (doc) {
      return doc.getPage(1).then(function (page) {
        var v1 = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: WIDTH / v1.width });
        var c = document.createElement('canvas');
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise.then(function () {
          if (doc.destroy) doc.destroy();
          return toJpeg(c);
        });
      });
    });
  }

  function fromImage(blob) {
    var make = window.createImageBitmap
      ? createImageBitmap(blob)
      : new Promise(function (resolve, reject) {
          var u = URL.createObjectURL(blob), img = new Image();
          img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
          img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('그림을 열 수 없습니다')); };
          img.src = u;
        });
    return make.then(function (img) { return toJpeg(drawScaled(img, img.width, img.height)); });
  }

  /* 파일(또는 받은 Blob) → 작은 그림 Blob (못 만드는 형식이면 null) */
  function make(blob, ext) {
    ext = String(ext || '').toLowerCase();
    if (!CAN[ext] || !blob) return Promise.resolve(null);
    return ext === 'pdf' ? fromPdf(blob) : fromImage(blob);
  }

  /* 보관함 경로 → 그림 경로 (같은 폴더 · 「원래이름.thumb.jpg」 — migration-029 이 이 이름만 받는다) */
  function pathOf(path) { return String(path || '').replace(/\.[A-Za-z0-9]+$/, '') + '.thumb.jpg'; }

  window.FileThumb = { make: make, pathOf: pathOf, can: function (ext) { return !!CAN[String(ext || '').toLowerCase()]; }, PDFJS: PDFJS };
})();
