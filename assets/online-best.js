/* ============================================================
   online-best.js — 온라인 학생 「🏅 우수 수행」 탭 (20261118b · 러닝노트 학생 · 학부모 · 영상·필기 탭 자리)

     · 우수 오답정리 — 이 학생 제출 중 선생님 오답정리 점수 높은 것 3개(날짜 · 지문 제목 · 점수 · 제출 사진 · 선생님 한마디)
     · 우수 지문 장악 — 지문 장악 점수 높은 것 3개(같은 모양) · 20261121a: 카드에 스스로 칭찬 · 발전 · 퀴즈 답변(앱 기록에 있을 때만)
     · 우수 질문 — 선생님과 주고받은 메시지에서 직원이 고른 것만(자동 공개 없음) · 앱이 아직 메시지를 안 보내면 「앱 연결 준비 중」
     · 이번 주 공부한 지문 — 월 ~ 일 날짜마다 지문 제목 · DAY · 제출 여부 (영상 · 필기노트 링크는 앱 연결 준비 중)
   서버: hub_best(링크 · 그 학생 것만 · 직원이 숨긴 항목 · 사진 빼고 · migration-120 · 126 지문 날짜 · 선정 이유)
   사진은 함수 online-best(앱 /api/hub/submission-file 5분 서명 주소 · 서버에서만 · 20261120d) · 앱 주소가 아직 없으면 예전 sub-view 미리보기 · 자리표시
   다른 학생과 비교 · 순위 · 상담 · 금액 · 전화번호 · AI 피드백 없음
   ============================================================ */
(function (global) {
  'use strict';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var WAIT = '앱 연결 준비 중';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function mdw(d) { if (!valid(d)) return ''; var x = new Date(d + 'T00:00:00Z'); return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '(' + DOW[x.getUTCDay()] + ')'; }
  function plus(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function monday(d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return plus(d, -((w + 6) % 7)); }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

  /* 학생 글이 질문인가 — 물음표 · 궁금 · 모르겠 · 왜 · 어떻게 · 질문 … (직원 화면 「질문 후보」 · 자동 공개는 하지 않음) */
  var QW = /[?？]|궁금|모르겠|모르겟|몰라요|왜\s|왜요|왜[가-힣]|어떻게|어떡|질문|헷갈|이해가\s*안|이해\s*안|맞나요|맞을까요|되나요|인가요|일까요/;
  function isQuestion(t) { return QW.test(String(t || '')); }

  function md(d) { return valid(d) ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function clean(t) { return global.OnlineRun && OnlineRun.cleanTitle ? OnlineRun.cleanTitle(t) : String(t || ''); }
  /* 카드 한 장 (20261120d · migration-126)
     · 날짜 = 지문 날짜(반 달력) · 제출일이 다르면 작게 「11/20 제출」 · 제목은 지문 목록과 같이 다듬기(한 줄 넘으면 말줄임 · 누르면 전체)
     · 점수에 종류(「오답정리 100점」 · 「지문 장악 100점」)
     · 사진 — 썸네일 → 누르면 크게(앱 서명 주소 · 함수 online-best · 그 학생 것만) · 앱 주소가 아직 없으면 자리표시(직원 화면에만 「앱 사진 연결 준비 중」)
     · 선생님 한마디(사람이 쓴 피드백) · 피드백이 없거나 한 줄 이하면 「선정 이유」(직원이 [확인]한 글만 · 확인 전 「선정 이유 준비 중」) */
  /* 그 제출의 앱 기록 한 줄(제출 열쇠 = 제출 시각 앞 19자 + '#' + 강 번호) — 스스로 칭찬 · 발전 · 퀴즈 답변 (20261121a) */
  function histOf(x, data) {
    var k = String(x && x.key || ''), i = k.lastIndexOf('#');
    if (!data || i < 0) return null;
    var at = k.slice(0, i), ord = +k.slice(i + 1);
    return [].concat((data.old && data.old.history) || [], data.history || []).filter(function (h) { return h && String(h.submittedAt || '').slice(0, 19) === at && +h.order === ord; })[0] || null;
  }
  function selfHtml(h) {
    if (!h) return '';
    var b = function (n, t, c) { return t ? '<div class="hwc-bub ' + c + '"><span class="hwc-bub__n">' + n + '</span><p class="hwc-txt' + (t.length > 70 ? ' is-clamp' : '') + '">' + esc(t) + '</p>' + (t.length > 70 ? '<button type="button" class="hwc-more" data-hwc-more aria-expanded="false">더 보기</button>' : '') + '</div>' : ''; };
    var s = function (v) { return typeof v === 'string' ? v.trim() : ''; };
    return b('스스로 칭찬해 주고 싶은 점', s(h.sp), 'hwc-bub--me') + b('발전하고 싶은 점', s(h.im), 'hwc-bub--me') + b('영상 강의 퀴즈 답변', s(h.qa), 'hwc-bub--q');
  }
  function itemHtml(x, kind, data) {
    var ph = (x.photos || []).filter(function (p) { return p && p.i != null; });
    var lab = kind === 'wrong' ? '오답정리' : '지문 장악', t = clean(x.title) || '지문';
    return '<li class="ob-it"><div class="ob-it__h"><span class="ob-it__d num">' + esc(mdw(x.day)) + (x.sday && x.day && x.sday !== x.day ? ' <small class="ob-it__sd">' + esc(md(x.sday)) + ' 제출</small>' : '') + '</span>' +
      '<button type="button" class="ob-it__t" data-ob-t aria-expanded="false" title="' + esc(x.title || t) + '">' + esc(t) + '</button>' +
      '<span class="ob-it__s num" aria-label="' + lab + ' 점수 ' + esc(x.s) + '점">' + lab + ' ' + esc(x.s) + '점</span></div>' +
      (ph.length ? '<div class="ob-ph">' + ph.slice(0, 4).map(function (p) {
        return '<button type="button" class="ob-ph__b" data-ob-ph="' + esc(x.key + '|' + p.i) + '"' + (p.id ? ' data-ob-id="' + esc(p.id) + '" data-ob-day="' + esc(x.sday || x.day) + '"' : '') + ' data-ob-kind="' + (p.kind === 'pdf' ? 'pdf' : 'image') + '" data-ob-d="' + esc(x.day || '') + '"' +
          ' aria-label="' + esc(mdw(x.day)) + ' 제출 ' + (p.kind === 'pdf' ? 'PDF' : '사진') + ' 크게 보기"><span class="ob-ph__w">' + (p.kind === 'pdf' ? 'PDF' : '사진') + '</span></button>';
      }).join('') + '</div>' : '') +
      selfHtml(histOf(x, data)) +
      (x.fb ? '<p class="ob-fb"><span class="ob-fb__n">선생님 한마디</span>' + esc(x.fb) + '</p>' : '') +
      (x.need === false ? '' : x.reason ? '<p class="ob-why"><span class="ob-fb__n">선정 이유</span>' + esc(x.reason) + '</p>' : '<p class="ob-why is-wait">선정 이유 준비 중</p>') + '</li>';
  }
  function listHtml(title, icon, list, kind, empty, data) {
    return '<section class="card ob-sec"><h2 class="card-title">' + icon + ' ' + esc(title) + '</h2>' +
      (list && list.length ? '<ol class="ob-list">' + list.map(function (x) { return itemHtml(x, kind, data); }).join('') + '</ol>' : '<p class="ob-empty">' + esc(empty) + '</p>') + '</section>';
  }
  function qHtml(q) {
    q = q || {};
    var picked = Array.isArray(q.picked) ? q.picked : [];
    var body = picked.length ? '<ol class="ob-q">' + picked.map(function (x) {
      return '<li class="ob-q__it"><p class="ob-q__h num">' + esc(mdw(x.day)) + (x.title ? ' · ' + esc(x.title) : '') + '</p>' +
        '<p class="ob-bub ob-bub--me">' + esc(x.q) + '</p>' + (x.a ? '<p class="ob-bub ob-bub--t"><span class="ob-fb__n">선생님</span>' + esc(x.a) + '</p>' : '') + '</li>';
    }).join('') + '</ol>'
      : q.ready ? '<p class="ob-empty">선생님이 고른 질문이 생기면 여기에 모여요</p>'
      : '<p class="ob-empty ob-wait">' + WAIT + ' · 선생님과 주고받은 질문은 앱 연결이 끝나면 여기에 모여요</p>';
    return '<section class="card ob-sec"><h2 class="card-title">💬 우수 질문</h2>' + body + '</section>';
  }
  /* 이번 주(월 ~ 일) — 앱 기록(날짜별 숙제 · 과제 제목 · DAY)만 */
  function weekRows(data, today) {
    var R = global.OnlineRun;
    if (!R || !data) return [];
    var mon = monday(today), days = [], yms = {};
    for (var i = 0; i < 7; i++) { var d = plus(mon, i); days.push(d); yms[d.slice(0, 7)] = 1; }
    var by = {};
    Object.keys(yms).forEach(function (ym) { R.compute(data, ym, { today: today }).days.forEach(function (x) { by[x.date] = x; }); });
    return days.map(function (d) { return by[d] || { date: d, counted: false, kind: 'off' }; });
  }
  function weekHtml(data, today) {
    var rows = weekRows(data, today);
    var K = { ok: ['✓ 제출', 'ok'], late: ['✓ 늦게 제출', 'ok'], miss: ['미제출', 'miss'], today: ['오늘 진행 중', 'wait'], future: ['아직', 'off'] };
    return '<section class="card ob-sec"><h2 class="card-title">📅 이번 주 공부한 지문</h2>' +
      (rows.length ? '<ul class="ob-week">' + rows.map(function (x) {
        if (!x.counted) return '<li class="ob-wk is-off"><span class="ob-wk__d num">' + esc(mdw(x.date)) + '</span><span class="ob-wk__t">숙제 없는 날</span></li>';
        var k = K[x.kind] || K.future;
        return '<li class="ob-wk"><span class="ob-wk__d num">' + esc(mdw(x.date)) + '</span>' + (x.day ? '<span class="ob-wk__day num">DAY ' + esc(x.day) + '</span>' : '') +
          '<span class="ob-wk__t">' + esc(clean(x.title) || '오늘의 지문') + '</span><span class="ob-wk__k ob-k--' + k[1] + '">' + k[0] + '</span></li>';
      }).join('') + '</ul>' : '<p class="ob-empty">과제 기록이 연결되면 여기에 보여요</p>') +
      '<p class="ob-note">영상 바로 보기 · 필기노트 · ' + WAIT + '</p></section>';
  }
  function html(best, data, o) {
    o = o || {};
    var today = o.today || todayKst();
    if (best === undefined) return '<div class="card app-wait"><p class="tw-loading"><i class="spin" aria-hidden="true"></i> 불러오는 중</p></div>';
    var fail = !best || best.__fail;
    var top = fail ? '<div class="empty errko" role="alert"><p>잠시 후 다시 시도해 주세요</p><button type="button" class="btn-ghost" data-ob-retry>다시 시도</button></div>'
      : listHtml('우수 오답정리', '🏅', best.wrong, 'wrong', best.scores ? '아직 선생님 점수가 매겨진 오답정리가 없어요' : '선생님 점수는 ' + WAIT, data) +
        listHtml('우수 지문 장악', '🔍', best.text, 'text', best.scores ? '아직 선생님 점수가 매겨진 지문 장악이 없어요' : '선생님 점수는 ' + WAIT, data) + qHtml(best.q);
    return '<div class="ob">' + '<p class="ob-lead">선생님이 높게 본 내 제출물 · 질문 · 이번 주 공부</p>' + top + weekHtml(data, today) + '</div>';
  }
  /* 사진 (20261120d) — 함수 online-best(앱 /api/hub/submission-file 서명 주소 · 서버에서만 · 그 학생 것만 · 숨긴 사진 빼고)
     o.code — 러닝노트 링크 · o.staffFiles(items) — 코치룸 미리보기 · 학생 카드(직원 권한)
     앱 주소가 아직 없으면(wait) — 예전 미리보기(sub-view · 있으면)로 · 없으면 자리표시 그대로 · o.staff 면 「앱 사진 연결 준비 중」 한 줄 */
  var APP_WAIT = '앱 사진 연결 준비 중';
  function callFiles(o, items) {
    if (o.staffFiles) return Promise.resolve(o.staffFiles(items)).catch(function () { return null; });
    var C = global.CONFIG && global.CONFIG.supabase;
    if (!C || !o.code) return Promise.resolve(null);
    return fetch(C.url + '/functions/v1/online-best', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key }, body: JSON.stringify({ action: 'files', code: o.code, items: items }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.ok ? d : null; }, function () { return null; });
  }
  function oldThumbs(host, code, btns) {
    var SV = global.SubView, days = {};
    if (!SV || !SV.hubFetch || !code) return;
    btns.forEach(function (b) { if (b.getAttribute('data-ob-id')) days[b.getAttribute('data-ob-day')] = 1; });
    Object.keys(days).forEach(function (d) {
      SV.hubFetch(code, d, d).then(function (res) {
        var files = (res && res.files) || [];
        btns.forEach(function (b) {
          if (b.getAttribute('data-ob-day') !== d || b.__ob) return;
          var f = files.filter(function (x) { return String(x.id) === b.getAttribute('data-ob-id'); })[0];
          if (!f || !f.thumb) return;
          b.__ob = 1; b.innerHTML = '<img src="' + esc(f.thumb) + '" alt="" loading="lazy">';
          b.onclick = function () { if (SV.lbOpen) SV.lbOpen([{ f: f }], 0); };
        });
      });
    });
  }
  function mountPhotos(host, code, o) {
    o = o || {}; if (code && !o.code) o.code = code;
    if (!host) return Promise.resolve(null);
    var btns = Array.prototype.slice.call(host.querySelectorAll('[data-ob-ph]'));
    if (!btns.length) return Promise.resolve(null);
    var items = btns.slice(0, 12).map(function (b) { var p = b.getAttribute('data-ob-ph').split('|'); return { key: p[0], i: +p[1] }; });
    return callFiles(o, items).then(function (res) {
      var files = (res && res.files) || [], wait = !res || res.wait || files.some(function (f) { return !f.ok && f.reason === 'wait'; });
      btns.forEach(function (b) {
        var p = b.getAttribute('data-ob-ph').split('|');
        var f = files.filter(function (x) { return x.key === p[0] && String(x.i) === p[1]; })[0];
        if (!f || !f.ok || !f.url) { if (f && f.reason === 'hidden') b.hidden = true; return; }
        b.__ob = 1;
        var pdf = (f.kind || b.getAttribute('data-ob-kind')) === 'pdf';
        if (pdf) { b.classList.add('is-pdf'); b.onclick = function () { global.open(f.url, '_blank', 'noopener'); }; return; }
        b.innerHTML = '<img src="' + esc(f.url) + '" alt="" loading="lazy" decoding="async">';
        b.onclick = function () { var SV = global.SubView; if (SV && SV.lbOpen) SV.lbOpen([{ f: { big: f.url, kind: 'image', day: b.getAttribute('data-ob-d') || '' } }], 0); };
      });
      if (wait) {
        oldThumbs(host, o.code, btns);
        if (o.staff && !host.querySelector('.ob-appwait')) {
          var n = document.createElement('p'); n.className = 'ob-note ob-appwait'; n.textContent = APP_WAIT + ' · 앱에 사진 주소가 생기면 코드 수정 없이 바로 보여요';
          var lead = host.querySelector('.ob-lead'); if (lead && lead.parentNode) lead.parentNode.insertBefore(n, lead.nextSibling); else host.insertBefore(n, host.firstChild);
        }
      }
      return { wait: wait, files: files };
    });
  }
  global.OnlineBest = { html: html, itemHtml: itemHtml, weekRows: weekRows, isQuestion: isQuestion, mountPhotos: mountPhotos, WAIT: WAIT, APP_WAIT: APP_WAIT };
})(window);
