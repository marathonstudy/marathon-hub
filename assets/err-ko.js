/* ============================================================
   err-ko.js — DB · 네트워크 오류를 화면에는 한국어로 (20261118a · 코치룸 · 러닝노트 같이)
     ErrKo.ko(raw)          → 한국어 한 줄 (「불러오는 데 시간이 오래 걸려요. 잠시 후 다시 시도해 주세요」 …)
     ErrKo.fix(text)        → 섞인 글(「저장하지 못했습니다 — canceling statement …」)의 영어 원문만 한국어로 바꿈 · 한국어 글은 그대로
     ErrKo.html(raw, o)     → 한국어 안내 + [다시 시도](o.retry = 버튼 속성) + 직원 화면이면(o.staff) 「자세히」 안에만 영어 원문
     ErrKo.isTech(text)     → 영어 오류 원문이 들어 있나
   영어 원문은 콘솔 · 직원 「자세히」 안에만 · 학생 이름 · 키는 넣지 않는다(원문에 없음)
   ============================================================ */
(function (global) {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var SLOW = '불러오는 데 시간이 오래 걸려요. 잠시 후 다시 시도해 주세요';
  var RULES = [
    [/statement timeout|canceling statement|timed? ?out|timeout|\b504\b|\b524\b|upstream request timeout/i, SLOW],
    [/Failed to fetch|NetworkError|Network request failed|Load failed|fetch failed|ERR_NETWORK|ECONN|ENOTFOUND|net::/i, '인터넷 연결이 불안정해요. 연결을 확인하고 다시 시도해 주세요'],
    [/Too Many Requests|\b429\b|rate limit/i, '요청이 많아 잠시 쉬는 중이에요. 1분 뒤에 다시 시도해 주세요'],
    [/JWT|jwt expired|not authenticated|Invalid login|\b401\b|refresh token/i, '로그인이 풀렸어요. 다시 로그인해 주세요'],
    [/permission denied|staff only|row-level security|violates row-level|\b403\b|not allowed/i, '이 기능을 쓸 권한이 없어요'],
    [/Could not find the function|schema cache|does not exist|PGRST20\d|42883|42P01/i, '서버 준비가 아직 안 됐어요(SQL 실행 전). 원장님께 알려 주세요'],
    [/duplicate key|already exists|23505/i, '이미 같은 내용이 있어요'],
    [/violates|invalid input|22P02|23502|23503|check constraint/i, '입력한 값을 저장할 수 없어요. 내용을 확인해 주세요'],
    [/\b5\d\d\b|Internal Server Error|Bad Gateway|Service Unavailable/i, '서버가 잠시 답하지 않아요. 잠시 후 다시 시도해 주세요']
  ];
  var TECH = /[A-Za-z]{3,}(?:[ _:.-]+[A-Za-z0-9]{2,}){1,}|\b[45]\d\d\b|PGRST|\b\d{5}\b/;
  function isTech(t) {
    var s = String(t || '');
    if (!s) return false;
    if (RULES.some(function (r) { return r[0].test(s); })) return true;
    /* 한글이 거의 없고 영어 낱말이 이어지면 원문 */
    var ko = (s.match(/[가-힣]/g) || []).length;
    return ko < 2 && TECH.test(s);
  }
  function ko(raw) {
    var s = String((raw && (raw.message || raw.error_description || raw.error || raw.reason)) || raw || '');
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(s)) return RULES[i][1];
    return '불러오지 못했어요. 잠시 후 다시 시도해 주세요';
  }
  /* 「한국어 — 영어 원문」 → 「한국어 — 한국어 안내」 · 통째로 영어면 한국어 안내만 */
  function fix(text) {
    var s = String(text == null ? '' : text);
    if (!isTech(s)) return s;
    var m = s.match(/^([\s\S]*?[가-힣][^—:·]*?)\s*(?:—|:|·|-)\s*([^가-힣]*[A-Za-z][^가-힣]*)$/);
    if (m && isTech(m[2])) return m[1].replace(/\s+$/, '') + ' — ' + ko(m[2]);
    if ((s.match(/[가-힣]/g) || []).length >= 2 && !RULES.some(function (r) { return r[0].test(s); })) return s;
    return ko(s);
  }
  function html(raw, o) {
    o = o || {};
    var s = String((raw && raw.message) || raw || '');
    var msg = o.text || ko(s);
    return '<div class="errko" role="alert"><p class="errko__t">' + esc(msg) + '</p>' +
      (o.retry ? '<button type="button" class="btn btn--sm errko__btn" ' + o.retry + '>' + esc(o.label || '다시 시도') + '</button>' : '') +
      (o.staff && s ? '<details class="errko__d"><summary>자세히</summary><code>' + esc(s.slice(0, 300)) + '</code></details>' : '') + '</div>';
  }
  global.ErrKo = { ko: ko, fix: fix, html: html, isTech: isTech, SLOW: SLOW };
})(window);
