/* ============================================================
   summary.js — 레포트 발송 → 1 작성 「반 공통」 → [자막으로 AI 요약] (migration-012 · Edge Function lesson-summary)

   · 자막 파일(.srt · .vtt · .txt)을 끌어다 놓거나, 스크립트를 붙여 넣는다
     [붙여 넣기] = 클립보드 글을 바로 (즐겨찾기 버튼 「마라톤 자막 가져오기」 ytbm.js 로 복사한 것)
     맨 위 「영상 제목 / 영상 주소」는 AI 에 보내지 않고, 그 주 영상 칸이 비어 있으면 그 주소로 채울지 묻는다
     — 영상 하나에 1 · 2차시가 다 들어 있으면 「영상 하나」, 차시마다 영상이 따로면 「차시별」
   · 파일은 올리지 않는다. 브라우저에서 글자만 뽑아 Edge Function 에 보내고, 서버도 원문을 저장하지 않는다
   · Claude(Sonnet 5.5)가 만든 "1차시: … / 2차시: …" 는 **초안** — 학부모에게 안 보인다
   · 직원(조교 포함)이 읽고 고친 뒤 [확정] → 러닝노트 · 반 공지에 보이고, 「수업 내용」 칸에 들어가 레포트와 함께 공개
     누가 · 언제 확정했는지 서버에 남는다
   · 한 달 상한(기본 80회)은 서버가 센다. 직원 누구나 바꾼다
   · 자리: 「수업 내용」 제목 줄의 [✨ 영상 자막으로 채우기]로 그 아래에 펼친다 (초안이 있으면 「초안 보기 · 확인 필요」)
     ① 이번 주 영상(없으면 링크 넣기) ② 유튜브에서 「마라톤 자막 가져오기」 ③ [붙여 넣기] → 초안 → [확정]
   · AI 에 보내기 전에 그 반 명단 이름을 「학생」으로 바꾼다 (바꾼 글도 저장하지 않는다)
   · [초안 지우기] · [확정 취소] — migration-019 (직원만)
   · 복습 노트 (reviewnote.js · 20261031l) — 같은 자막을 쓴다 (Summary.source). 자막은 이 화면 메모리에만 두고 반 · 주를 바꾸면 지운다
     (예전에는 요약을 만들면 바로 지웠다 — 이제는 이어서 복습 노트를 만들 수 있게 남겨 둔다 · 서버 · 브라우저 저장소에는 넣지 않는다)
   · 과정(§) 칸이면 이름 가리기는 모든 학생 명단으로
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }
  var NEED_SQL = 'migration-012 SQL 을 먼저 실행해 주세요 (README 5-9).';
  var MAX_CHARS = 300000;

  var st = {
    cls: '', week: '', key: '', row: null, missing: false, busy: false, role: '',
    mode: 'one', n: 2, texts: ['', '', '', ''], source: 'file', usage: null, edit: null
  };

  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ============================================================
     자막 → 글자만 (.srt · .vtt · 유튜브 「스크립트 표시」 복사본)
     번호 · 시간 줄 · 태그를 빼고, 자동 자막에서 겹쳐 나오는 줄을 한 번만 남긴다
     ============================================================ */
  function captionText(raw) {
    var lines = String(raw || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n');
    var out = [];
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      if (/^WEBVTT/i.test(t) || /^(NOTE|STYLE|REGION)\b/.test(t) || /^(Kind|Language):/i.test(t)) return;
      if (/^\d+$/.test(t)) return;                                    /* srt 번호 */
      if (/-->/.test(t)) return;                                      /* 시간 줄 */
      if (/^\d{1,2}(:\d{2}){1,2}$/.test(t)) return;                    /* 스크립트 표시의 0:05 · 1:02:03 */
      t = t.replace(/^\[\d{1,2}(:\d{2}){1,2}\]\s*/, '')               /* 줄 앞 [0:14] (자막 가져오기 버튼) */
           .replace(/^\d{1,2}(:\d{2}){1,2}\s+/, '')                   /* 줄 앞 시각 */
           .replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')
           .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
           .replace(/\s+/g, ' ').trim();
      if (!t) return;
      var prev = out[out.length - 1];
      if (prev === t) return;                                         /* 똑같은 줄 반복 */
      if (prev && t.indexOf(prev) === 0) { out[out.length - 1] = t; return; }   /* 앞줄을 이어 쓴 줄 */
      if (prev && prev.slice(-t.length) === t) return;
      out.push(t);
    });
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* 자막 가져오기 버튼으로 복사한 글 — 맨 위 「제목 / https://youtu.be/…」 를 떼어 낸다 */
  var YT_URL = /^https:\/\/(youtu\.be\/[\w-]{11}|(www\.|m\.)?youtube\.com\/(watch\?v=|shorts\/|live\/)[\w-]{11})\S*$/;
  function ytHeader(raw) {
    var lines = String(raw || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    var idx = [];
    for (var i = 0; i < lines.length && idx.length < 2; i++) if (lines[i].trim()) idx.push(i);
    for (var k = 0; k < idx.length; k++) {
      var u = lines[idx[k]].trim();
      if (!YT_URL.test(u)) continue;
      return { url: u, title: k === 1 ? lines[idx[0]].trim() : '', body: lines.slice(idx[k] + 1).join('\n') };
    }
    return null;
  }

  /* ============================================================
     학생 이름 가리기 — 요약은 반 학부모 모두가 보므로 AI 에 보내기 전에 명단 이름을 「학생」으로
     전체 이름 · 성을 뺀 이름(3자 → 뒤 2자, 4자 → 뒤 2자), 뒤에 붙은 「이」 · 조사까지. 한 글자 이름은 바꾸지 않는다.
     앞뒤가 한글이 아닐 때만 (「지원하다」 같은 낱말은 그대로)
     ============================================================ */
  function rosterNames(cls) {
    var all = (window.Store && Store.getStudents ? Store.getStudents() : []).filter(function (s) { return String(cls || '').charAt(0) === '§' || (s.className || '') === cls; });
    var set = {};
    all.forEach(function (s) {
      var n = String(s.name || '').replace(/\s+/g, '');
      if (!/^[가-힣]{2,5}$/.test(n)) return;
      set[n] = 1;
      var given = n.length === 3 || n.length === 4 ? n.slice(-2) : '';
      if (given.length >= 2) set[given] = 1;
    });
    return Object.keys(set).sort(function (a, b) { return b.length - a.length; });
  }
  function maskNames(text, cls) {
    var names = rosterNames(cls);
    if (!names.length) return text;
    var re = new RegExp('(^|[^가-힣])(' + names.join('|') + ')(이)?(이가|이는|이도|이랑|이한테|가|는|은|도|랑|한테|에게|의|를|을|만|아|야|님|씨|요)?(?=$|[^가-힣])', 'g');
    return String(text || '').replace(re, function (m, pre, name, i, josa) { return pre + '학생' + (josa || ''); });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!/\.(srt|vtt|txt)$/i.test(file.name || '')) { reject(new Error('자막 파일(.srt · .vtt · .txt)만 넣을 수 있습니다')); return; }
      if (file.size > 5 * 1024 * 1024) { reject(new Error('파일이 너무 큽니다 (5MB 까지)')); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  /* ============================================================
     그리기
     ============================================================ */

  function render(cls, week) {
    if (!$('#aiSub')) return;
    var key = (cls || '') + '|' + (week || '');
    st.cls = cls || ''; st.week = week || '';
    if (key !== st.key) {
      st.key = key;
      st.row = null; st.edit = null;
      st.texts = ['', '', '', ''];
      $('#aiSub').hidden = true;
      $('#btnAiOpen').setAttribute('aria-expanded', 'false');
      renderResult();
      load();
    }
  }

  function load() {
    var key = st.key;
    if (!st.cls || !st.week) { renderResult(); return Promise.resolve(); }
    return sb().from('lesson_summaries').select('*').eq('class_name', st.cls).eq('week_start', st.week).then(function (r) {
      if (key !== st.key) return;
      st.missing = !!(r.error && isMissing(r.error));
      st.row = (r.data && r.data[0]) || null;
      st.edit = null;
      renderResult();
    });
  }

  function loadUsage() {
    return sb().rpc('ai_summary_status').then(function (r) {
      var host = $('#aiUsage');
      if (r.error) { host.textContent = ''; return; }
      st.usage = r.data || {};
      host.innerHTML = '이번 달 AI 요약 <b class="num">' + (st.usage.used || 0) + ' / ' + (st.usage.cap || 0) + '회</b>' +
        ' · 약 $' + Number(st.usage.cost_usd || 0).toFixed(2) +
        (st.role ? ' <button class="btn btn--sm btn--ghost" type="button" id="btnAiCap">상한 바꾸기</button>' : '');
    });
  }

  /* 지금 보여 줄 줄 — 고치는 중이면 그것, 새 초안이면 초안, 확정만 있으면 확정본 */
  function currentLines() {
    if (st.edit) return st.edit;
    var r = st.row;
    if (!r) return [];
    return (r.status === 'confirmed' && r.confirmed ? r.confirmed : r.draft) || [];
  }

  function renderResult() {
    var host = $('#aiResult');
    if (!host) return;
    if (st.missing) { host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    var r = st.row;
    if (!r) {
      host.innerHTML = '<p class="panel__hint">아직 초안이 없습니다. 위 ① ② ③ 순서로 자막을 넣고 [요약 초안 만들기]를 누르면 "1차시: … / 2차시: …" 초안이 생깁니다. 초안은 [확정]해야 학부모에게 보입니다.</p>';
      aiButton();
      return;
    }
    var lines = currentLines();
    var confirmed = r.status === 'confirmed' && !st.edit;
    var badge = confirmed
      ? '<span class="ai-badge ai-badge--ok">확정됨 · ' + esc(r.confirmed_by) + ' · ' + fmtDT(r.confirmed_at) + '</span>'
      : '<span class="ai-badge">초안 · 확인 필요' + (r.draft_by ? ' · ' + esc(r.draft_by) + ' ' + fmtDT(r.draft_at) + ' 만듦' : '') + '</span>' +
        (r.confirmed ? '<span class="muted-note">지금 학부모 화면에는 이전 확정본(' + esc(r.confirmed_by) + ' · ' + fmtDT(r.confirmed_at) + ')이 보입니다</span>' : '');
    host.innerHTML =
      '<div class="ai-result' + (confirmed ? ' is-ok' : '') + '">' +
        '<div class="ai-result__head">' + badge + '</div>' +
        (!confirmed && r.draft_note ? '<p class="ai-note">⚠️ AI 확인 메모: ' + esc(r.draft_note) + '</p>' : '') +
        '<div class="ai-lines">' + lines.map(function (t, i) {
          return '<div class="row-item ai-line">' +
            '<input class="input" type="text" maxlength="300" data-ai-line="' + i + '" value="' + esc(t) + '">' +
            '<button class="btn btn--sm btn--ghost" type="button" data-ai-del="' + i + '" aria-label="줄 지우기">×</button>' +
          '</div>';
        }).join('') + '</div>' +
        '<div class="wk-edit__btns">' +
          '<button class="btn btn--sm" type="button" data-ai-act="add">+ 줄 추가</button>' +
          '<div class="spacer"></div>' +
          (confirmed
            ? '<button class="btn btn--sm btn--ghost" type="button" data-ai-act="unconfirm">확정 취소</button>'
            : '<button class="btn btn--sm btn--ghost" type="button" data-ai-act="discard">초안 지우기</button>') +
          '<button class="btn btn--sm btn--primary" type="button" data-ai-act="confirm">' + (confirmed ? '고친 내용으로 다시 확정' : '확정') + '</button>' +
        '</div>' +
        '<p class="panel__hint">[확정]하면 러닝노트 「레포트」 · 반 공지에 보이고, 위 「수업 내용」 차시 칸에 들어가 레포트를 공개할 때 함께 나갑니다. 자동 자막은 작품명 · 용어를 틀리게 받아 적을 때가 많으니 꼭 읽고 고쳐 주세요.</p>' +
      '</div>';
    aiButton();
  }

  /* [✨ 영상 자막으로 채우기] — 초안이 있으면 「초안 보기 · 확인 필요」(주황), 확정된 주는 「AI 요약 확정됨」(흐리게) */
  function aiButton() {
    var b = $('#btnAiOpen');
    if (!b) return;
    var r = st.row;
    var draft = !!(r && r.status === 'draft' && (r.draft || []).length);
    var ok = !!(r && r.status === 'confirmed' && r.confirmed);
    b.textContent = draft ? '초안 보기 · 확인 필요' : ok ? 'AI 요약 확정됨' : '✨ 영상 자막으로 채우기';
    b.classList.toggle('ai-open--draft', draft);
    b.classList.toggle('ai-open--ok', ok && !draft);
    b.classList.toggle('btn--ghost', ok && !draft);
  }

  /* ① 이번 주 그 반 수업 영상 ② 자막 버튼 ③ 붙여 넣기 */
  function savedVideos() {
    var W = window.Weekly;
    if (!W || !W.videos) return [];
    var at = W.where ? W.where() : {};
    if (at.cls !== st.cls || at.week !== st.week) return [];
    return W.videos().filter(function (v) { return v.id && v.url; });
  }
  function ytId(u) {
    var m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/.exec(String(u || ''));
    return m ? m[1] : '';
  }
  var PART = { full: '수업 전체', '1': '1차시', '2': '2차시', makeup: '보강' };
  function renderSteps() {
    var host = $('#aiSteps');
    if (!host) return;
    var vids = savedVideos();
    var p = $('#aiPanel');
    if (!vids.length) {
      /* 링크가 없으면 ① 만 크게 — ② ③ · 차시 고르기 · 자막 칸 · [요약 초안 만들기]는 접어 둔다 */
      host.innerHTML = '<div class="ai-steps">' +
        '<div class="ai-step ai-step--big" data-step="1"><div class="ai-step__t">① 이번 주 수업 영상 링크를 먼저 넣어 주세요</div>' +
          '<div class="toolbar"><input class="input" id="aiVidUrl" type="url" inputmode="url" placeholder="https://youtu.be/…" aria-label="유튜브 링크">' +
          '<button class="btn btn--primary" type="button" id="btnAiVidAdd">넣기</button></div>' +
          '<p class="muted-note">넣으면 위 「수업 영상」 칸(기본 「전체」)에 저장되고 학생 · 학부모 화면에도 올라갑니다.</p></div>' +
        '<p class="ai-next">링크를 넣으면 다음 단계가 열립니다</p>' +
      '</div>';
      if (p) p.hidden = true;
      return false;
    }
    /* 링크가 있으면 ① 은 「영상: 제목 [유튜브에서 열기 ↗]」 한 줄로 작게, 나머지는 바로 펼친다 */
    host.innerHTML = '<div class="ai-steps">' +
      vids.map(function (v) {
        return '<div class="ai-vid ai-vid--small" data-step="1"><span class="ai-step__t">영상:</span><span class="ai-vid__name">' + esc((PART[v.part] ? PART[v.part] + ' · ' : '') + (v.title || v.url)) + '</span>' +
          '<a class="btn btn--sm" href="' + esc(v.url) + '" target="_blank" rel="noopener">유튜브에서 열기 ↗</a></div>';
      }).join('') +
      '<div class="ai-step" data-step="2"><span class="ai-step__t">② 열린 유튜브 화면에서 즐겨찾기 [마라톤 자막 가져오기] 누르기</span> ' +
        '<button class="btn btn--sm btn--ghost" id="btnYtbmHelp" type="button">자막 버튼 설치</button></div>' +
      '<div class="ai-step" data-step="3"><span class="ai-step__t">③ [붙여 넣기] → [요약 초안 만들기] → 고치기 → [확정]</span></div>' +
    '</div>';
    if (p) p.hidden = false;
    return true;
  }

  /* 머리 띠(sticky) 바로 아래에 오도록 내린다 — 위쪽 메뉴 + 띠 높이만큼 비워 둔다 */
  function scrollUnderBar(el, smooth) {
    if (!el || !el.getBoundingClientRect) return;
    var top = document.getElementById('topbar'), bar = document.getElementById('writeBar');
    /* 띠가 붙어 있으면(position: fixed) offsetParent 가 비므로 실제 크기로 잰다 (숨어 있으면 0) */
    var gap = (top && !top.hidden ? top.getBoundingClientRect().height : 0) + (bar ? bar.getBoundingClientRect().height : 0) + 8;
    var y = el.getBoundingClientRect().top + (window.pageYOffset || 0) - gap;
    try { window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { window.scrollTo(0, Math.max(0, y)); }
  }
  function focusLink() {
    var inp = $('#aiVidUrl');
    if (!inp) return;
    try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
  }
  function addVideoFromStep() {
    var inp = $('#aiVidUrl');
    var W = window.Weekly;
    var url = W && W.normalizeYoutube ? W.normalizeYoutube(inp ? inp.value : '') : '';
    if (!url) { toast('유튜브 링크(youtube.com · youtu.be)를 넣어 주세요', 'bad'); if (inp) inp.focus(); return; }
    W.addVideoUrl(st.cls, st.week, url, '').then(function (ok) {
      if (!ok) { toast('영상을 넣지 못했습니다 — 위 「수업 영상」 칸을 확인해 주세요', 'bad'); renderSteps(); focusLink(); return; }
      if (renderSteps()) scrollUnderBar(document.querySelector('#aiSteps [data-step="2"]'), true);
    });
  }

  /* ---------- 입력 창 ---------- */

  function renderPanel() {
    var box = $('#aiPanel');
    var n = st.n;
    var areas = st.mode === 'one'
      ? [areaHtml(0, '수업 영상(전체) 자막 — 1 · 2차시가 한 영상에 들어 있을 때')]
      : Array.apply(null, { length: n }).map(function (_, i) { return areaHtml(i, (i + 1) + '차시 자막'); });
    box.innerHTML =
      '<div class="wk-edit ai-panel">' +
        '<div class="ai-opts">' +
          '<label class="chk-inline"><input type="radio" name="aiMode" value="one"' + (st.mode === 'one' ? ' checked' : '') + '> 영상 하나 (1 · 2차시 함께)</label>' +
          '<label class="chk-inline"><input type="radio" name="aiMode" value="split"' + (st.mode === 'split' ? ' checked' : '') + '> 차시마다 영상 따로</label>' +
          '<label class="chk-inline">차시 수 <select class="input ai-n" id="aiN">' + [1, 2, 3, 4].map(function (k) {
            return '<option value="' + k + '"' + (k === n ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select></label>' +
        '</div>' +
        areas.join('') +
        guideHtml() +
        '<div class="wk-edit__btns">' +
          '<button class="btn btn--sm btn--primary" type="button" id="btnAiRun">요약 초안 만들기</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" id="btnAiClose">접기</button>' +
          '<span class="panel__hint" id="aiRunNote">Claude(Sonnet 5.5)로 요약합니다. 1번에 대략 150~200원(3시간 수업 기준) · 1분 안팎 · 한 달 80회를 다 써도 대략 1만 1천~1만 7천 원. 자막 원문은 저장하지 않습니다.</span>' +
        '</div>' +
      '</div>';
  }

  function areaHtml(i, label) {
    var t = st.texts[i] || '';
    return '<div class="ai-area" data-ai-area="' + i + '">' +
      '<div class="ai-area__head"><span class="sub__title">' + esc(label) + '</span>' +
        '<span class="muted-note num" data-ai-count="' + i + '">' + (t ? t.length.toLocaleString() + '자' : '') + '</span>' +
        '<button class="btn btn--sm" type="button" data-ai-paste="' + i + '">붙여 넣기</button>' +
        '<label class="btn btn--sm">파일 고르기<input type="file" accept=".srt,.vtt,.txt" data-ai-file="' + i + '" hidden></label>' +
      '</div>' +
      '<textarea class="textarea ai-text" rows="4" data-ai-text="' + i + '" placeholder="자막 파일(.srt · .vtt · .txt)을 여기에 끌어다 놓거나, 스크립트를 붙여 넣으세요">' + esc(t) + '</textarea>' +
    '</div>';
  }

  function guideHtml() {
    return '<details class="ai-guide">' +
      '<summary>유튜브 스튜디오에서 자막 파일 받는 법 (조교도 따라 할 수 있어요)</summary>' +
      '<ol>' +
        '<li><b>studio.youtube.com</b> 에 들어갑니다. 선생님 채널 계정으로 로그인되어 있어야 합니다.<br>' +
          '<span class="muted-note">조교 계정으로 받으려면 선생님이 먼저 스튜디오 왼쪽 아래 <b>설정 → 권한 → 초대</b>에서 조교를 초대해 주세요.</span></li>' +
        '<li>왼쪽 메뉴에서 <b>자막</b>을 누릅니다.</li>' +
        '<li>영상 목록에서 그 주 <b>수업 영상</b>을 누릅니다.</li>' +
        '<li>언어 목록의 <b>한국어(자동)</b> 줄에 마우스를 올리고 <b>⋮(옵션)</b> → <b>다운로드</b> → <b>.srt</b> 를 고릅니다.<br>' +
          '<span class="muted-note">자동 자막은 영상을 올린 뒤 만들어지기까지 몇 분 ~ 몇 시간 걸립니다. 줄이 없으면 조금 뒤에 다시 보세요.</span></li>' +
        '<li>받은 파일(다운로드 폴더)을 위 칸에 <b>끌어다 놓기</b> 하거나 <b>[파일 고르기]</b>로 고릅니다.</li>' +
      '</ol>' +
      '<p class="muted-note"><b>가장 쉬운 방법 — 자막 버튼:</b> PC 크롬에 즐겨찾기 버튼 「마라톤 자막 가져오기」를 한 번 설치해 두면(위 「자막 버튼 설치」), 유튜브 영상 화면에서 버튼을 누르고 → 여기 <b>[붙여 넣기]</b> 한 번이면 됩니다.</p>' +
      '<p class="muted-note"><b>파일을 받을 수 없을 때 — 붙여 넣기:</b> 유튜브에서 그 영상을 열고 설명란 아래 <b>[스크립트 표시]</b> → 오른쪽 스크립트 창의 <b>⋮ → 타임스탬프 전환</b>으로 시각을 끄고 → 내용을 모두 드래그해 복사 → 위 칸에 붙여 넣기. 화면 이름은 조금 다를 수 있습니다.</p>' +
    '</details>';
  }

  function updateCount(i) {
    var el = document.querySelector('#aiPanel [data-ai-count="' + i + '"]');
    var t = st.texts[i] || '';
    if (el) el.textContent = t ? t.length.toLocaleString() + '자' + (t.length > MAX_CHARS ? ' — 너무 깁니다' : '') : '';
  }

  /* 넣은 글 → 칸. 맨 위가 「제목 / 영상 주소」면 떼어 내고, 이번 주 영상과 다른 영상이면 묻는다 (Promise: 넣었는가) */
  function setText(i, raw, source) {
    var h = ytHeader(raw);
    function put(text) {
      st.texts[i] = captionText(text);
      st.source = source;
      var ta = document.querySelector('#aiPanel [data-ai-text="' + i + '"]');
      if (ta) ta.value = st.texts[i];
      updateCount(i);
      return true;
    }
    if (!h) return Promise.resolve(put(raw));
    var vids = savedVideos();
    if (vids.length && ytId(h.url) && !vids.some(function (v) { return ytId(v.url) === ytId(h.url); })) {
      return UI.confirmAsk('다른 영상의 자막', '이번 주 영상과 다른 영상의 자막입니다. 계속할까요?\n' + h.url + (h.title ? '\n(' + h.title + ')' : ''), '계속')
        .then(function (yes) { return yes ? put(h.body) : false; });
    }
    put(h.body);
    offerVideo(h.url, h.title);
    return Promise.resolve(true);
  }

  /* 그 주 영상 칸이 비어 있으면 붙여 넣은 자막의 영상 주소로 채울지 묻는다 */
  function offerVideo(url, title) {
    var W = window.Weekly;
    if (!W || !W.addVideoUrl || !W.videos || W.videos().length) return;
    var at = W.where ? W.where() : {};
    if (at.cls !== st.cls || at.week !== st.week) return;
    var cls = st.cls, week = st.week;
    UI.confirmAsk('수업 영상 채우기', '이번 주 「수업 영상」 칸이 비어 있습니다. 붙여 넣은 자막의 영상 주소를 넣을까요?\n' + url +
      (title ? '\n(' + title + ')' : ''), '넣기').then(function (yes) {
      if (!yes || W.videos().length) return;
      W.addVideoUrl(cls, week, url, title);
    });
  }

  /* [붙여 넣기] — 클립보드 글을 바로. 브라우저가 막으면 Ctrl+V 로 */
  function pasteInto(i) {
    var ta = document.querySelector('#aiPanel [data-ai-text="' + i + '"]');
    var manual = function () { toast('Ctrl+V로 붙여 넣어 주세요', 'bad'); if (ta) ta.focus(); };
    if (!navigator.clipboard || !navigator.clipboard.readText) { manual(); return; }
    navigator.clipboard.readText().then(function (raw) {
      if (!String(raw || '').trim()) { toast('클립보드가 비어 있습니다 — 유튜브에서 「마라톤 자막 가져오기」를 먼저 눌러 주세요', 'bad'); return; }
      setText(i, raw, 'paste').then(function (done) {
        if (done) toast('자막 ' + st.texts[i].length.toLocaleString() + '자를 넣었습니다');
      });
    }, manual);
  }

  function takeFiles(i, files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    /* 차시별 모드에서 여러 파일을 한 번에 놓으면 이름 순서대로 1차시 · 2차시 … */
    if (st.mode === 'split' && list.length > 1) {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko', { numeric: true }); });
      list.slice(0, st.n - i).forEach(function (f, k) {
        readFile(f).then(function (raw) { setText(i + k, raw, 'file'); }, function (e) { toast(e.message, 'bad'); });
      });
      return;
    }
    readFile(list[0]).then(function (raw) {
      return setText(i, raw, 'file').then(function (done) {
        if (done) toast('자막 ' + st.texts[i].length.toLocaleString() + '자를 넣었습니다');
      });
    }, function (e) { toast(e.message, 'bad'); });
  }

  /* ---------- 요약 ---------- */

  function run() {
    if (st.busy) return;
    if (!st.cls || !st.week) { toast('반과 주차를 먼저 골라 주세요', 'bad'); return; }
    var n = st.n;
    var texts = st.mode === 'one' ? [st.texts[0]] : st.texts.slice(0, n);
    if (texts.some(function (t) { return !t || t.length < 200; })) { toast('자막을 넣어 주세요 (너무 짧으면 요약할 수 없습니다)', 'bad'); return; }
    var total = texts.reduce(function (a, t) { return a + t.length; }, 0);
    if (total > MAX_CHARS) { toast('자막이 너무 깁니다 (' + MAX_CHARS.toLocaleString() + '자까지)', 'bad'); return; }
    if (st.usage && st.usage.cap != null && st.usage.used >= st.usage.cap) { toast('이번 달 AI 요약 상한을 모두 썼습니다', 'bad'); return; }

    var go = function () {
      st.busy = true;
      var btn = $('#btnAiRun'); if (btn) btn.disabled = true;
      $('#aiRunNote').textContent = '요약 중입니다… 1분 안팎 걸립니다. 창을 닫지 마세요.';
      var key = st.key;
      var cls0 = st.cls;
      invoke({ class_name: st.cls, week_start: st.week, mode: st.mode, lessons: n, texts: texts.map(function (t) { return maskNames(t, cls0); }), source: st.source }).then(function (res) {
        st.busy = false;
        if (btn) btn.disabled = false;
        if (!res || !res.ok) {
          $('#aiRunNote').textContent = (res && res.message) || '요약하지 못했습니다. 잠시 뒤 다시 해 주세요.';
          toast((res && res.message) || '요약하지 못했습니다', 'bad');
          loadUsage();
          return;
        }
        if (key === st.key) { st.row = res.summary || st.row; st.edit = null; renderResult(); }
        $('#aiPanel').hidden = true;
        $('#aiPanel').innerHTML = '';
        /* 자막은 지우지 않고 이 화면 메모리에만 둔다 — 이어서 [복습 노트 만들기]에 쓴다 (반 · 주를 바꾸면 지운다 · 20261031l) */
        loadUsage();
        toast('초안을 만들었습니다 — 읽고 고친 뒤 [확정]을 눌러 주세요', 'good');
      });
    };

    if (st.row && st.row.status === 'draft' && (st.row.draft || []).length) {
      UI.confirmAsk('초안 다시 만들기', '확정하지 않은 지금 초안은 새 초안으로 바뀝니다. 이번 달 횟수도 1회 씁니다.', '다시 만들기').then(function (yes) { if (yes) go(); });
    } else go();
  }

  function invoke(body) {
    var name = (CONFIG.summaryFunction || 'lesson-summary');
    return sb().functions.invoke(name, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().catch(function () { return null; }).then(function (j) {
          return j || { ok: false, message: '요약 함수를 부르지 못했습니다. Edge Function lesson-summary 가 배포됐는지 확인해 주세요.' };
        });
      }
      return { ok: false, message: '요약 함수를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) {
      return { ok: false, message: '요약 함수를 부르지 못했습니다 — ' + ((e && e.message) || '') };
    });
  }

  /* ---------- 확정 ---------- */

  function readLines() {
    return Array.prototype.map.call(document.querySelectorAll('#aiResult [data-ai-line]'), function (el) { return el.value.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean);
  }

  function confirm() {
    var lines = readLines();
    if (!lines.length) { toast('확정할 내용을 적어 주세요', 'bad'); return; }
    if (lines.length > 6) { toast('6줄까지 확정할 수 있습니다', 'bad'); return; }
    var cls = st.cls, week = st.week, key = st.key;
    var have = window.Writer && Writer.lessonsOf ? Writer.lessonsOf(cls) : [];
    var same = have.join('\n') === lines.join('\n');
    var ask = (have.length && !same)
      ? UI.confirmAsk('수업 내용 바꾸기', '지금 쓴 내용을 바꿀까요? 「수업 내용」 칸에 이미 적힌 글(' + have.length + '줄)이 확정한 요약으로 바뀝니다.', '바꾸고 확정')
      : Promise.resolve(true);
    ask.then(function (yes) {
      if (!yes) return;
      sb().rpc('summary_confirm', { p_class: cls, p_week: week, p_lessons: lines }).then(function (r) {
        if (r.error) { toast(isMissing(r.error) ? NEED_SQL : r.error.message, 'bad'); return; }
        if (window.Writer && Writer.setLessons && !same) Writer.setLessons(cls, lines);
        if (key === st.key) { st.row = (r.data && r.data.summary) || st.row; st.edit = null; renderResult(); }
        toast('확정했습니다 — 러닝노트에 보이고, 수업 내용 칸에 들어갔습니다', 'good');
      });
    });
  }

  /* ---------- 초안 지우기 · 확정 취소 (migration-019) ---------- */

  function serverAct(fn, title, desc, okLabel, done) {
    var cls = st.cls, week = st.week, key = st.key;
    UI.confirmAsk(title, desc, okLabel).then(function (yes) {
      if (!yes) return;
      sb().rpc(fn, { p_class: cls, p_week: week }).then(function (r) {
        if (r.error) { toast(isMissing(r.error) ? 'migration-019 SQL 을 먼저 실행해 주세요.' : r.error.message, 'bad'); return; }
        if (key === st.key) { st.row = (r.data && r.data.summary) || null; st.edit = null; renderResult(); }
        toast(done, 'good');
      });
    });
  }

  /* ============================================================
     시작
     ============================================================ */

  function bind() {
    if (!$('#aiSub')) return;
    $('#btnAiOpen').addEventListener('click', function () {
      if (!st.cls) { toast('반을 먼저 골라 주세요', 'bad'); return; }
      if (st.missing) { toast(NEED_SQL, 'bad'); return; }
      var sub = $('#aiSub');
      if (!sub.hidden) { sub.hidden = true; $('#btnAiOpen').setAttribute('aria-expanded', 'false'); return; }
      var box = $('#aiPanel');
      /* 차시별 영상이 따로 있는 주면 「차시마다」로 시작 */
      var parts = window.Weekly && Weekly.videos ? Weekly.videos().map(function (v) { return v.part; }) : [];
      if (parts.indexOf('full') === -1 && parts.indexOf('1') !== -1 && parts.indexOf('2') !== -1) st.mode = 'split';
      renderPanel();
      box.hidden = false;
      sub.hidden = false;
      $('#btnAiOpen').setAttribute('aria-expanded', 'true');
      var ready = renderSteps();
      renderResult();
      scrollUnderBar(document.querySelector('#aiSteps [data-step="1"]') || sub, false);   /* ① 이 띠 바로 아래 */
      if (!ready) focusLink();
    });
    /* ① 영상 넣기 · ② 자막 버튼 설치 (펼친 칸 안 — 다시 그려지므로 위임) */
    $('#aiSub').addEventListener('click', function (e) {
      if (e.target.closest('#btnAiVidAdd')) addVideoFromStep();
    });
    $('#aiSub').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.id === 'aiVidUrl') { e.preventDefault(); addVideoFromStep(); }
    });
    window.addEventListener('jt:videos-changed', function () { if (!$('#aiSub').hidden) renderSteps(); });

    /* 자막 버튼 설치 창 (ytbm.js) */
    var ym = $('#ytbmModal');
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#btnYtbmHelp') || !window.YTBM) return;
      $('#ytbmLink').href = YTBM.href();
      ym.showModal();
    });
    $('#btnYtbmClose').addEventListener('click', function () { ym.close(); });
    $('#btnYtbmCopy').addEventListener('click', function () {
      UI.copyText(YTBM.href()).then(function () { toast('코드를 복사했습니다 — 즐겨찾기 URL 칸에 붙여 넣으세요', 'good'); }, function () { toast('복사하지 못했습니다', 'bad'); });
    });
    /* 코치룸에서 누르면 실행하지 않고 안내만 (끌어다 놓기는 그대로) */
    $('#ytbmLink').addEventListener('click', function (e) { e.preventDefault(); toast('이 버튼을 크롬 즐겨찾기 줄로 끌어다 놓아 주세요'); });

    var panel = $('#aiPanel');
    panel.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'aiMode') { st.mode = t.value; renderPanel(); }
      else if (t.id === 'aiN') { st.n = Number(t.value) || 2; renderPanel(); }
      else if (t.dataset.aiFile != null) { takeFiles(Number(t.dataset.aiFile), t.files); t.value = ''; }
    });
    panel.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.aiText == null) return;
      st.texts[Number(t.dataset.aiText)] = t.value;
      st.source = 'paste';
      updateCount(Number(t.dataset.aiText));
    });
    /* 붙여 넣으면 시각 · 번호를 바로 정리 */
    panel.addEventListener('paste', function (e) {
      var t = e.target;
      if (t.dataset.aiText == null || !e.clipboardData) return;
      var raw = e.clipboardData.getData('text');
      if (!raw) return;
      e.preventDefault();
      var i = Number(t.dataset.aiText);
      var start = t.selectionStart || 0, end = t.selectionEnd || 0;
      setText(i, t.value.slice(0, start) + '\n' + raw + '\n' + t.value.slice(end), 'paste');
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      panel.addEventListener(ev, function (e) {
        var a = e.target.closest && e.target.closest('[data-ai-area]');
        if (!a) return;
        e.preventDefault(); a.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      panel.addEventListener(ev, function (e) {
        var a = e.target.closest && e.target.closest('[data-ai-area]');
        if (!a) return;
        e.preventDefault(); a.classList.remove('is-over');
        if (ev === 'drop') takeFiles(Number(a.dataset.aiArea), e.dataTransfer && e.dataTransfer.files);
      });
    });
    panel.addEventListener('click', function (e) {
      if (e.target.id === 'btnAiRun') run();
      var pb = e.target.closest('[data-ai-paste]');
      if (pb) pasteInto(Number(pb.dataset.aiPaste));
      if (e.target.id === 'btnAiClose') { $('#aiSub').hidden = true; $('#btnAiOpen').setAttribute('aria-expanded', 'false'); }
    });

    var result = $('#aiResult');
    result.addEventListener('input', function (e) {
      if (e.target.dataset.aiLine == null) return;
      st.edit = Array.prototype.map.call(document.querySelectorAll('#aiResult [data-ai-line]'), function (el) { return el.value; });
      var btn = result.querySelector('[data-ai-act="confirm"]');
      if (btn) btn.textContent = st.row && st.row.confirmed ? '고친 내용으로 다시 확정' : '확정';
    });
    result.addEventListener('click', function (e) {
      var del = e.target.closest('[data-ai-del]');
      if (del) {
        var lines = currentLines().slice();
        lines.splice(Number(del.dataset.aiDel), 1);
        st.edit = lines; renderResult(); return;
      }
      var act = e.target.closest('[data-ai-act]');
      if (!act) return;
      if (act.dataset.aiAct === 'add') {
        var l2 = currentLines().slice();
        l2.push((l2.length + 1) + '차시: ');
        st.edit = l2; renderResult();
        var ins = document.querySelectorAll('#aiResult [data-ai-line]');
        if (ins.length) ins[ins.length - 1].focus();
      }
      if (act.dataset.aiAct === 'confirm') confirm();
      if (act.dataset.aiAct === 'discard') serverAct('summary_discard', '초안 지우기', '이 초안을 지웁니다. 되돌릴 수 없습니다. (이번 달 사용 횟수는 돌아오지 않습니다)', '지우기', '초안을 지웠습니다');
      if (act.dataset.aiAct === 'unconfirm') serverAct('summary_unconfirm', '확정 취소', '학부모 화면에서 요약이 내려가고 초안으로 돌아갑니다. 「수업 내용」 칸과 이미 공개한 레포트는 그대로입니다.', '확정 취소', '확정을 취소했습니다 — 초안으로 돌아갔습니다');
    });

    $('#aiUsage').addEventListener('click', function (e) {
      if (e.target.id !== 'btnAiCap') return;
      var v = window.prompt('한 달 AI 요약 상한 (회)', String((st.usage && st.usage.cap) || 80));
      if (v == null) return;
      var n = Math.round(Number(v));
      if (!(n >= 0 && n <= 1000)) { toast('0 ~ 1000 사이로 적어 주세요', 'bad'); return; }
      sb().rpc('ai_cap_set', { p_cap: n }).then(function (r) {
        if (r.error) { toast(r.error.message, 'bad'); return; }
        toast('월 상한을 ' + n + '회로 바꿨습니다', 'good');
        loadUsage();
      });
    });

    /* 다른 기기에서 만들거나 확정한 것 (sync.js 실시간) */
    window.addEventListener('jt:remote', function (e) {
      if (e.detail && e.detail.table === 'lesson_summaries' && st.key && !st.busy && !st.edit) { load(); loadUsage(); }
    });
    window.addEventListener('jt:loaded', function () {
      st.key = '';
      DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; loadUsage(); });
    });
  }

  bind();

  /* 복습 노트가 쓰는 자막 — 지금 넣어 둔 자막 (이름은 가린 것) · 없거나 너무 짧으면 null */
  function source() {
    var n = st.n, texts = st.mode === 'one' ? [st.texts[0]] : st.texts.slice(0, n);
    if (!st.cls || texts.some(function (t) { return !t || t.length < 200; })) return null;
    return { mode: st.mode, n: n, texts: texts.map(function (t) { return maskNames(t, st.cls); }), source: st.source };
  }
  function openPanel() {
    var sub = $('#aiSub');
    if (sub && sub.hidden) $('#btnAiOpen').click();
    else if (sub && sub.scrollIntoView) sub.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  window.Summary = { render: render, captionText: captionText, reload: load, source: source, openPanel: openPanel, maskNames: maskNames };

})();
