/* ============================================================
   online-best.js — 온라인 학생 「🏅 우수 수행」 탭 (20261118b · 러닝노트 학생 · 학부모 · 영상·필기 탭 자리)

     · 우수 오답정리 — 이 학생 제출 중 선생님 오답정리 점수 높은 것 3개(날짜 · 지문 제목 · 점수 · 제출 사진 · 선생님 한마디)
     · 우수 지문 장악 — 필기 점수 높은 것 3개(같은 모양)
     · 우수 질문 — 선생님과 주고받은 메시지에서 직원이 고른 것만(자동 공개 없음) · 앱이 아직 메시지를 안 보내면 「앱 연결 준비 중」
     · 이번 주 공부한 지문 — 월 ~ 일 날짜마다 지문 제목 · DAY · 제출 여부 (영상 · 필기노트 링크는 앱 연결 준비 중)
   서버: hub_best(링크 · 그 학생 것만 · 직원이 숨긴 항목 · 사진 빼고 · migration-120) · 사진은 sub-view 함수(10분짜리 서명 주소 · 그 학생 것만)
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

  function itemHtml(x, kind) {
    var ph = (x.photos || []).filter(function (p) { return p && p.id; });
    return '<li class="ob-it"><div class="ob-it__h"><span class="ob-it__d num">' + esc(mdw(x.day)) + '</span><b class="ob-it__t">' + esc(x.title || '지문') + '</b>' +
      '<span class="ob-it__s num" aria-label="' + (kind === 'wrong' ? '오답정리' : '지문 장악') + ' 점수 ' + esc(x.s) + '점">' + esc(x.s) + '점</span></div>' +
      (ph.length ? '<div class="ob-ph" data-ob-day="' + esc(x.day) + '">' + ph.slice(0, 4).map(function (p) {
        return '<button type="button" class="ob-ph__b" data-ob-ph="' + esc(p.id) + '" aria-label="' + esc(mdw(x.day)) + ' 제출 사진 크게 보기"><span class="ob-ph__w">' + (p.kind === 'pdf' ? 'PDF' : '사진') + '</span></button>';
      }).join('') + '</div>' : '') +
      (x.fb ? '<p class="ob-fb"><span class="ob-fb__n">선생님 한마디</span>' + esc(x.fb) + '</p>' : '') + '</li>';
  }
  function listHtml(title, icon, list, kind, empty) {
    return '<section class="card ob-sec"><h2 class="card-title">' + icon + ' ' + esc(title) + '</h2>' +
      (list && list.length ? '<ol class="ob-list">' + list.map(function (x) { return itemHtml(x, kind); }).join('') + '</ol>' : '<p class="ob-empty">' + esc(empty) + '</p>') + '</section>';
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
          '<span class="ob-wk__t">' + esc(x.title || '오늘의 지문') + '</span><span class="ob-wk__k ob-k--' + k[1] + '">' + k[0] + '</span></li>';
      }).join('') + '</ul>' : '<p class="ob-empty">과제 기록이 연결되면 여기에 보여요</p>') +
      '<p class="ob-note">영상 바로 보기 · 필기노트 · ' + WAIT + '</p></section>';
  }
  function html(best, data, o) {
    o = o || {};
    var today = o.today || todayKst();
    if (best === undefined) return '<div class="card app-wait"><p class="tw-loading"><i class="spin" aria-hidden="true"></i> 불러오는 중</p></div>';
    var fail = !best || best.__fail;
    var top = fail ? '<div class="empty errko" role="alert"><p>잠시 후 다시 시도해 주세요</p><button type="button" class="btn-ghost" data-ob-retry>다시 시도</button></div>'
      : listHtml('우수 오답정리', '🏅', best.wrong, 'wrong', best.scores ? '아직 선생님 점수가 매겨진 오답정리가 없어요' : '선생님 점수는 ' + WAIT) +
        listHtml('우수 지문 장악', '🔍', best.text, 'text', best.scores ? '아직 선생님 점수가 매겨진 필기가 없어요' : '선생님 점수는 ' + WAIT) + qHtml(best.q);
    return '<div class="ob">' + '<p class="ob-lead">선생님이 높게 본 내 제출물 · 질문 · 이번 주 공부</p>' + top + weekHtml(data, today) +
      (o.preview ? '<p class="ob-note">미리보기에서는 제출 사진을 열지 않아요</p>' : '') + '</div>';
  }
  /* 사진 — 날짜마다 sub-view(그 학생 것만 · 10분 서명 주소)로 · 숨긴 사진은 서버가 이미 뺌 */
  function mountPhotos(host, code) {
    var SV = global.SubView;
    if (!host || !SV || !SV.hubFetch) return;
    var boxes = host.querySelectorAll('[data-ob-day]'), days = {};
    Array.prototype.forEach.call(boxes, function (b) { days[b.getAttribute('data-ob-day')] = 1; });
    var all = [];
    Object.keys(days).forEach(function (d) {
      SV.hubFetch(code, d, d).then(function (res) {
        var files = (res && res.files) || [];
        files.forEach(function (f) { all.push(f); });
        Array.prototype.forEach.call(host.querySelectorAll('[data-ob-day="' + d + '"] [data-ob-ph]'), function (b) {
          var f = files.filter(function (x) { return String(x.id) === b.getAttribute('data-ob-ph'); })[0];
          if (!f) { b.hidden = true; return; }
          if (f.thumb) b.innerHTML = '<img src="' + esc(f.thumb) + '" alt="" loading="lazy">';
          b.onclick = function () { if (SV.lbOpen) SV.lbOpen([{ f: f }], 0); };
        });
      });
    });
  }
  global.OnlineBest = { html: html, weekRows: weekRows, isQuestion: isQuestion, mountPhotos: mountPhotos, WAIT: WAIT };
})(window);
