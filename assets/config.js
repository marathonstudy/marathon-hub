/* ============================================================
   config.js — 접속 설정 (생성기 · 개인 페이지 · 반 공지 페이지가 같이 쓴다)

   여기 적힌 publishable key 는 공개돼도 되는 키다.
   단, 그것은 모든 표에 RLS 가 켜져 있을 때만 성립한다.
   (supabase/schema.sql 참고)
   secret key · service_role key 는 절대 여기 넣지 않는다.

   선생님 표기·학원명·문의처는 여기가 아니라 assets/brand.js 에 있다.
   ============================================================ */

(function (global) {
  'use strict';

  global.CONFIG = {

    /* 파일을 고칠 때마다 이 값과 각 index.html 의 ?v= 를 함께 올린다.
       안 올리면 깃허브 페이지스 캐시 때문에 최대 10분간 옛 파일이 나간다.
       생성기 로그인 화면 왼쪽 아래에 보인다. */
    version: '20261031d',

    /* 배포 주소. 끝에 / 를 붙이지 않는다. */
    siteUrl: 'https://marathonstudy.github.io/marathon-hub',

    supabase: {
      url: 'https://hfimvleiljqwortkzkrl.supabase.co',
      key: 'sb_publishable_7pHxNb12uvxBfmKpW7SVwg_RRvy41bw'
    },

    /* 앱 과제 Edge Function 이름 (대시보드에서 만든 이름과 같아야 한다) */
    appFunction: 'app-report',

    /* 필기 노트 사진 Edge Function 이름 */
    photoFunction: 'note-photo',

    /* 배부 자료 · 과제 파일 내려받기 Edge Function 이름 (migration-011) */
    fileFunction: 'class-file',

    /* 자막으로 AI 수업 요약 Edge Function 이름 (migration-012 · 코치룸 직원만) */
    summaryFunction: 'lesson-summary',

    /* 복습테스트 학생 기록 Edge Function 이름 (migration-013 · 개인 링크) */
    reviewFunction: 'review-test',

    /* 브라우저 저장 이름 앞에 붙는다. 같은 github.io 주소를 쓰는
       다른 사이트와 겹치지 않게 한다. */
    storagePrefix: 'mhub.'
  };

})(window);
