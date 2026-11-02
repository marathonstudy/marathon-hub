/* ============================================================
   setstate.js — 설정 칸 아래 「아직 비어 있음」 · 「저장됨」 (20261102b)

   빈 칸의 회색 예시 글이 저장된 값처럼 보여 헷갈렸다 — 예시 글 앞에 「예:」 · 더 연한 색(style.css)
   칸 아래 작은 글 <small class="set-state" data-set-state="칸 id"> 를 저장된 값 기준으로 채운다
     SetState.mark('tdSetAppAdmin', true)  → 「저장됨」
     SetState.mark('tdSetAppAdmin', false) → 「아직 비어 있음」
   (입력 중인 글이 아니라 서버에 저장된 값 기준 · 불러오기 전에는 비워 둔다)
   ============================================================ */
(function () {
  'use strict';
  function mark(id, saved) {
    var el = document.querySelector('[data-set-state="' + id + '"]');
    if (!el) return;
    el.textContent = saved ? '저장됨' : '아직 비어 있음';
    el.classList.toggle('is-saved', !!saved);
    el.classList.toggle('is-empty', !saved);
  }
  /* 링크 칸 (20261102c) — 앞뒤 공백(줄바꿈 · 전각 공백 포함)을 지우고, http:// 로 넣으면 오류 없이 https:// 로 바꿔 저장한다
     SetState.url('  http://pf.kakao.com/_x/chat ') → 'https://pf.kakao.com/_x/chat' · 빈 값은 그대로 빈 값 */
  function url(v) {
    var s = String(v == null ? '' : v).replace(/^[\s\u00a0\u3000\ufeff]+|[\s\u00a0\u3000\ufeff]+$/g, '');
    return s.replace(/^http:\/\//i, 'https://').replace(/^https:\/\//i, 'https://');
  }
  /* 칸 값을 고쳐 넣고 고친 값을 돌려준다 */
  function fixInput(el) { if (!el) return ''; var v = url(el.value); if (el.value !== v) el.value = v; return v; }
  window.SetState = { mark: mark, url: url, fixInput: fixInput };
})();
