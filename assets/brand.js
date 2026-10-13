/* ============================================================
   brand.js — 선생님 표기 · 학원명 · 문의처

   여기 한 곳만 고치면 아래가 전부 같이 바뀐다.
     · 개인 페이지 · 반 공지 페이지 · 레포트의 제목과 맨 아래 문의처
     · 마라톤 코치룸(관리 페이지) 제목 · 러닝노트(개인 페이지) 이름
   ============================================================ */

(function (global) {
  'use strict';

  var BRAND = {
    teacherName:  '김종현 T',
    brandName:    '마라톤국어',

    signEmoji:    '✒️',
    footerThanks: '이번주도 함께해주셔서 감사합니다',

    contactName:  '김종현 T',
    contactPhone: '010-7200-9055',   /* 화면에 보이는 번호 */
    contactTel:   '01072009055',     /* 눌러서 거는 번호 — 숫자만 */
    kakaoUrl:     'http://pf.kakao.com/_hxaLJxj/chat',
    kakaoLabel:   '카카오채널 문의'
  };

  BRAND.reportBrand  = BRAND.brandName;                        /* 마라톤국어 */
  BRAND.reportTitle  = BRAND.brandName + ' 주간 학습 레포트';
  BRAND.adminTitle   = '마라톤 코치룸';                          /* 관리 페이지 */
  BRAND.noteTitle    = BRAND.brandName + ' 러닝노트';             /* 학생·학부모 개인 페이지 */
  BRAND.noticeTitle  = BRAND.brandName + ' 반 공지';              /* 반 공용 공지 페이지 */
  BRAND.tagline      = '1일 1지문 1코칭';
  BRAND.motto        = '루틴이 점수를 만든다 · ' + BRAND.brandName;
  BRAND.commentTitle = BRAND.teacherName + ' 종합 코멘트';
  BRAND.signName     = BRAND.teacherName + ' 드림';

  global.BRAND = BRAND;

  /* ------------------------------------------------------------
     data-brand 속성이 붙은 자리를 채운다.
       <span data-brand="brandName"></span>   → 글자
       <a data-brand-tel></a>                 → 번호 + tel: 링크
       <a data-brand-kakao></a>               → 카카오채널 링크
     ------------------------------------------------------------ */
  function fill(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-brand]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-brand');
      if (BRAND[key] != null) nodes[i].textContent = BRAND[key];
    }
    var tels = root.querySelectorAll('[data-brand-tel]');
    for (var j = 0; j < tels.length; j++) {
      tels[j].textContent = BRAND.contactPhone;
      tels[j].setAttribute('href', 'tel:' + BRAND.contactTel);
    }
    var kakao = root.querySelectorAll('[data-brand-kakao]');
    for (var k = 0; k < kakao.length; k++) {
      kakao[k].textContent = BRAND.kakaoLabel;
      kakao[k].setAttribute('href', BRAND.kakaoUrl);
      kakao[k].setAttribute('target', '_blank');
      kakao[k].setAttribute('rel', 'noopener');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { fill(); });
  } else {
    fill();
  }

  BRAND.fill = fill;

})(window);
