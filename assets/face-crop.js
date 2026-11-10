/* ============================================================
   face-crop.js — 학생 얼굴 사진 고르기 → 정사각형 400px JPEG (20261110b · 코치룸 · 러닝노트 같이)
     · 5MB 넘는 파일 · 이미지가 아닌 파일은 받지 않는다 (check)
     · 정사각형으로 자른다 — 세로 사진은 위쪽 1/3 쪽(얼굴이 보통 있는 곳), 가로 사진은 가운데
     · 긴 변 400px 로 줄여 canvas 로 다시 그린다 → 위치 정보(EXIF GPS) · 찍은 기기 등 부가 정보는 남지 않는다
     · 사진은 이 기기 안에서만 다룬다 — AI 변환 · 외부 서비스 전송 없음
     · 저장은 035 의 student_profile.photo · thumb (직원만 읽는 표 · 공개 주소 없음) — 학생은 me_photo_save · 코치룸은 face_staff_save (093)
   ============================================================ */
(function (global) {
  'use strict';
  var MAX_IN = 5 * 1024 * 1024, SIDE = 400;
  var NOTE = '선생님이 이름을 익히는 용도로만 쓰고, 선생님만 볼 수 있어요 · 언제든 지울 수 있어요';

  /* 고른 파일 검사 — '' 이면 통과 */
  function check(file) {
    if (!file) return '사진을 골라 주세요.';
    if (!/^image\//.test(String(file.type || '')) || /svg/i.test(String(file.type || ''))) return '사진 파일만 올릴 수 있어요.';
    if (file.size > MAX_IN) return '5MB 보다 작은 사진만 올릴 수 있어요.';
    return '';
  }
  /* 자를 칸 — { sx, sy, s } (원본 w × h) */
  function box(w, h) {
    var s = Math.min(w, h);
    var sx = Math.round((w - s) / 2);
    var sy = h > w ? Math.round((h - s) / 3) : Math.round((h - s) / 2);
    return { sx: sx, sy: sy, s: s };
  }
  function loadImage(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('사진을 열지 못했어요. 다른 사진을 골라 주세요.')); };
      img.src = url;
    });
  }
  /* → Promise<{ blob, url(미리보기), side }> */
  function make(file) {
    var why = check(file);
    if (why) return Promise.reject(new Error(why));
    return loadImage(file).then(function (x) {
      var w = x.img.naturalWidth || x.img.width, h = x.img.naturalHeight || x.img.height;
      if (!w || !h) throw new Error('사진을 열지 못했어요. 다른 사진을 골라 주세요.');
      var b = box(w, h), side = Math.min(SIDE, b.s);
      var c = document.createElement('canvas');
      c.width = side; c.height = side;
      c.getContext('2d').drawImage(x.img, b.sx, b.sy, b.s, b.s, 0, 0, side, side);
      URL.revokeObjectURL(x.url);
      return new Promise(function (ok, bad) {
        c.toBlob(function (blob) {
          if (!blob) { bad(new Error('사진을 만들지 못했어요.')); return; }
          ok({ blob: blob, url: URL.createObjectURL(blob), side: side });
        }, 'image/jpeg', 0.85);
      });
    });
  }
  /* → Promise<{ photo(400px data: 글자), thumb(96px data: 글자) }> — 저장(035 student_profile · me_photo_save · face_staff_save) 모양 */
  function makeData(file) {
    var why = check(file);
    if (why) return Promise.reject(new Error(why));
    return loadImage(file).then(function (x) {
      var w = x.img.naturalWidth || x.img.width, h = x.img.naturalHeight || x.img.height;
      if (!w || !h) throw new Error('사진을 열지 못했어요. 다른 사진을 골라 주세요.');
      var b = box(w, h);
      var draw = function (side, q) {
        var c = document.createElement('canvas');
        c.width = side; c.height = side;
        c.getContext('2d').drawImage(x.img, b.sx, b.sy, b.s, b.s, 0, 0, side, side);
        return c.toDataURL('image/jpeg', q);
      };
      var big = Math.min(SIDE, b.s), photo = draw(big, 0.85);
      if (photo.length > 200000) photo = draw(big, 0.7);
      var thumb = draw(96, 0.8);
      URL.revokeObjectURL(x.url);
      return { photo: photo, thumb: thumb };
    });
  }
  global.FaceCrop = { check: check, box: box, make: make, makeData: makeData, NOTE: NOTE, MAX_IN: MAX_IN, SIDE: SIDE };
})(typeof window !== 'undefined' ? window : globalThis);
