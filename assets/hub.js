/* ============================================================
   hub.js — 학생·학부모 화면 (개인 페이지 /me/ · 반 공지 /notice/)

   로그인이 없다. 주소의 # 뒤 코드를 Supabase 공개 함수에 넘기고,
   함수가 돌려준 것만 그린다. 표를 직접 읽지 않는다.
     /me/#개인링크코드          → 레포트 탭 — 가장 최근 수업 레포트 (hub_get · hub_report · Edge Function(app-report))
     /me/#개인링크코드/report/주 → 그 수업 레포트 · /reports → 누적 추이
     /me/#개인링크코드/app      → 과제 상세 탭 (예전 「앱 과제」)
     /me/#개인링크코드/book     → 교재비 탭 (hub_textbook — 그 학생 청구서만)
     /me/#개인링크코드/photo    → 내 필기 탭 (예전 「필기 노트」 · Edge Function note-photo — 그 학생 사진만)
     예전 주소 #코드/notice · /week · /this-week 는 레포트 탭으로 (20261029i)
     /notice/#반코드            → class_notice_get
     자료 파일 내려받기          → Edge Function(class-file) — 링크 코드 · 파일의 반을 확인하고 2분짜리 주소
     자료 카드의 첫 페이지 그림  → 같은 함수의 action thumbs (migration-029 · 10분짜리 주소)

   # 뒤의 값은 서버 로그에도, 다른 사이트로 넘어가는 주소(referrer)에도
   남지 않는다. 그래서 코드를 ?code= 가 아니라 # 뒤에 둔다.
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var esc = function (v) { return global.ReportView ? ReportView.esc(v) : String(v == null ? '' : v); };

  /* 코치룸 미리보기 — 코치룸 창 안의 틀(iframe)로 열렸을 때만. 링크 코드 없이, 코치룸이 직원 권한으로 내용을 대신 준다.
     미리보기에서는 제출 · 사진 올리기 · 지우기가 아무것도 바꾸지 않는다. */
  var PV = (function () {
    try {
      if (/[?&]preview=1\b/.test(global.location.search) && global.parent && global.parent !== global && global.parent.HubPreview) {
        return global.parent.HubPreview;
      }
    } catch (e) {}
    return null;
  })();
  global.HUB_PREVIEW = PV;

  /* ============================================================
     서버 부르기
     ============================================================ */

  function rpc(name, args) {
    if (PV) return PV.rpc(name, args || {});
    return fetch(CFG.supabase.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* 과제 기록 — 15초 안에 답이 없으면 실패로 (「과제 기록 못 불러옴 · 다시 시도」 · 20261031b) */
  var APP_TIMEOUT = 15000;
  function appReport(code) {
    if (PV) return PV.app();
    var url = CFG.supabase.url + '/functions/v1/' + CFG.appFunction + '?code=' + encodeURIComponent(code);
    return Promise.race([
      fetch(url, { headers: { 'apikey': CFG.supabase.key } })
        .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http' + r.status }; }); }),
      new Promise(function (res) { setTimeout(function () { res({ ok: false, reason: 'timeout' }); }, APP_TIMEOUT); })
    ]);
  }

  /* ============================================================
     작은 도구
     ============================================================ */

  function $(s, r) { return (r || document).querySelector(s); }

  function safeUrl(u) {
    var v = String(u || '').trim();
    return /^https?:\/\/[^\s<>"']+$/i.test(v) ? v : '';
  }

  /* 글 안의 주소를 눌러지는 링크로. 먼저 이스케이프하고 나서 바꾼다. */
  /* 글 칸 — ** · __ · # 같은 표시 기호는 보이지 않게 (report-view.js 의 mdHtml · 저장된 글은 그대로 · 20261029g) */
  function md(text) { return global.ReportView && ReportView.mdHtml ? ReportView.mdHtml(text) : esc(text); }
  function linkify(text) {
    return md(text).replace(/https?:\/\/[^\s<>"']+/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
  }

  function youtubeId(url) {
    var u = String(url || '');
    var m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([A-Za-z0-9_-]{11})/.exec(u);
    return m ? m[1] : '';
  }

  /* ============================================================
     수업 영상 — 눌러서 그 자리에서 재생 (youtube-nocookie · 16:9 · 한 번에 하나만)
       아래에 [유튜브 앱에서 보기]. 영상 번호를 못 찾는 주소는 예전처럼 링크로 연다.
     ============================================================ */
  function videoHtml(url, titleHtml) {
    var u = safeUrl(url), id = youtubeId(u);
    var thumb = id
      ? '<span class="nt-video__thumb" style="background-image:url(https://i.ytimg.com/vi/' + id + '/mqdefault.jpg)">' +
          '<span class="nt-video__play" aria-hidden="true">▶</span></span>'
      : '<span class="nt-video__thumb nt-video__thumb--none"><span class="nt-video__play" aria-hidden="true">▶</span></span>';
    if (!id) {
      return '<a class="nt-video" href="' + esc(u) + '" target="_blank" rel="noopener">' + thumb +
               '<span class="nt-video__title">' + titleHtml + '</span></a>';
    }
    return '<div class="nt-video nt-video--yt" data-yt="' + id + '" data-url="' + esc(u) + '">' +
             '<button type="button" class="nt-video__btn" data-yt-play>' + thumb +
               '<span class="nt-video__title">' + titleHtml + '</span></button>' +
           '</div>';
  }

  function closePlayers(except) {
    Array.prototype.forEach.call(document.querySelectorAll('.nt-video.is-playing'), function (v) {
      if (v === except) return;
      var p = v.querySelector('.yt-player');
      if (p) p.remove();
      v.classList.remove('is-playing');
      var b = v.querySelector('[data-yt-play]');
      if (b) b.hidden = false;
    });
  }

  function playVideo(box) {
    var id = box.dataset.yt;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return;
    closePlayers(box);
    if (box.classList.contains('is-playing')) return;
    var title = (box.querySelector('.nt-video__title') || {}).textContent || '수업 영상';
    var p = document.createElement('div');
    p.className = 'yt-player';
    p.innerHTML =
      '<div class="yt-frame"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0" ' +
        'title="' + esc(title) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen ' +
        'referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' +
      '<div class="yt-actions">' +
        '<a class="yt-app" href="' + esc(safeUrl(box.dataset.url) || ('https://youtu.be/' + id)) + '" target="_blank" rel="noopener">유튜브 앱에서 보기</a>' +
        '<button type="button" class="yt-close" data-yt-close>닫기</button>' +
      '</div>';
    box.querySelector('[data-yt-play]').hidden = true;
    box.appendChild(p);
    box.classList.add('is-playing');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var play = t.closest('[data-yt-play]');
    if (play) { playVideo(play.closest('.nt-video')); return; }
    if (t.closest('[data-yt-close]')) closePlayers(null);
  });

  /* 공지 · 자료 묶음의 날짜 — 그 주 수업일 「10/22(목) 수업」 (주 시작일은 쓰지 않는다 · 20261029i) */
  function weekLabel(n) { return weekName(n.week_start); }

  function setTitle(t) { document.title = t; }

  /* 주요 시험 D-day — hub_get · class_notice_get 이 돌려준 그 반 시험 하나 (이름 · 날짜).
     한국 날짜 기준, 자정마다 다시 센다. 지났거나 없으면 줄을 숨긴다. */
  /* D-day 띠 — 「6월 모의평가 D-42」 (당일 「D-day」 · 지나면 다음 시험 · 그 반에 드는 시험이 없으면 숨김 · migration-034)
     누르면 그 반에 드는 시험 전체가 날짜순으로 작게 펼쳐진다 (지난 시험은 회색 · 20261031c) */
  function renderDday(exam, who) {
    var el = $('#hubDday');
    if (!el || !global.DDay) return;
    var open = false;
    function pickNow() {
      var t = DDay.today(), list = (exam && exam.list) || (exam ? [exam] : []);
      return list.filter(function (x) { return x && x.date >= t; })[0] || null;
    }
    function draw() {
      var t = DDay.today(), cur = pickNow();
      el.hidden = !cur;
      if (!cur) { el.innerHTML = ''; return; }
      var list = (exam && exam.list) || [cur];
      el.innerHTML = '<button type="button" class="dd-btn" aria-expanded="' + open + '">' + esc((who ? who + ' · ' : '') + cur.name + ' ' + DDay.badge(cur, t)) +
          (list.length > 1 ? ' <span class="dd-caret" aria-hidden="true">▾</span>' : '') + '</button>' +
        (open && list.length > 1 ? '<ul class="dd-list">' + list.map(function (x) {
          var past = x.date < t;
          return '<li class="dd-item' + (past ? ' is-past' : '') + (x === cur || (x.name === cur.name && x.date === cur.date) ? ' is-cur' : '') + '"><span>' + esc(x.name) + '</span><span class="num">' +
            esc(global.Lesson && Lesson.md ? Lesson.md(x.date) : x.date) + ' · ' + (past ? '지남' : esc(DDay.badge(x, t))) + '</span></li>';
        }).join('') + '</ul>' : '');
    }
    el.onclick = function (e) { if (e.target.closest('.dd-btn')) { open = !open; draw(); } };
    draw();
    DDay.everyMidnight(draw);
  }

  /* ============================================================
     반 공지 그리기 (두 화면이 같이 쓴다)
     ============================================================ */

  var NOTICE_ROWS = [
    ['curriculum', '📚 커리큘럼'],
    ['literature', '📖 문학 수업'],
    ['reading',    '📰 독서 수업'],
    ['homework',   '✏️ 다음주까지 과제'],
    ['notes',      '💬 특이사항']
  ];

  function noticeBodyHtml(n) {
    var html = '';

    if (String(n.special || '').trim()) {
      html += '<div class="nt-special"><div class="nt-special__label">📌 특별 공지</div>' +
              '<div class="nt-text">' + linkify(n.special) + '</div></div>';
    }

    var rows = NOTICE_ROWS.filter(function (r) { return String(n[r[0]] || '').trim(); });
    if (rows.length) {
      html += '<dl class="nt-rows">' + rows.map(function (r) {
        return '<div class="nt-row"><dt>' + r[1] + '</dt>' +
               '<dd class="nt-text">' + linkify(n[r[0]]) + '</dd></div>';
      }).join('') + '</dl>';
    }

    var mats = (n.materials || []).filter(function (m) { return m && safeUrl(m.url); });
    if (mats.length) {
      html += '<div class="nt-sub">📎 자료</div><div class="nt-files">' + mats.map(function (m) {
        return '<a class="nt-file" href="' + esc(safeUrl(m.url)) + '" target="_blank" rel="noopener">' +
                 '<span class="nt-file__icon" aria-hidden="true">📄</span>' +
                 '<span class="nt-file__name">' + esc(m.name || '자료') + '</span>' +
                 '<span class="nt-file__go" aria-hidden="true">›</span>' +
               '</a>';
      }).join('') + '</div>';
    }

    var vids = (n.videos || []).filter(function (v) { return v && safeUrl(v.url); });
    if (vids.length) {
      html += '<div class="nt-sub">▶️ 수업 영상</div><div class="nt-videos">' + vids.map(function (v) {
        return videoHtml(v.url, esc(v.title || '수업 영상'));
      }).join('') + '</div>';
    }

    return html || '<p class="hub-muted">내용이 없습니다.</p>';
  }

  function noticesHtml(list) {
    if (!list || !list.length) {
      return '<div class="empty">아직 올라온 반 공지가 없습니다.</div>';
    }
    var latest = list[0];
    var html =
      '<div class="card nt-card">' +
        '<h2 class="card-title">📢 ' + esc(weekLabel(latest)) + ' 공지' +
          '<span class="card-note">최신</span></h2>' +
        (String(latest.title || '').trim() ? '<p class="nt-title">' + md(latest.title) + '</p>' : '') +
        lessonLineHtml(latest.week_start) +
        noticeBodyHtml(latest) +
      '</div>';

    if (list.length > 1) {
      html += '<div class="card"><h2 class="card-title">🗂️ 지난 공지<span class="card-note">' +
              (list.length - 1) + '개</span></h2><div class="nt-archive">' +
              list.slice(1).map(function (n, i) {
                return '<details class="nt-past" data-i="' + (i + 1) + '">' +
                         '<summary><span class="nt-past__week num">' + esc(weekLabel(n)) + '</span>' +
                         '<span class="nt-past__title">' + md(n.title || '') + '</span></summary>' +
                         '<div class="nt-past__body"></div>' +
                       '</details>';
              }).join('') + '</div></div>';
    }
    return html;
  }

  /* 지난 공지는 펼칠 때 그린다. 52주를 한꺼번에 그리지 않는다. */
  function bindArchive(root, list) {
    root.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.classList || !d.classList.contains('nt-past') || d.classList.contains('wk-past') || !d.open) return;
      var body = d.querySelector('.nt-past__body');
      if (body && !body.dataset.done) {
        body.innerHTML = lessonLineHtml(list[+d.dataset.i].week_start) + noticeBodyHtml(list[+d.dataset.i]);
        body.dataset.done = '1';
      }
    }, true);
  }

  /* ============================================================
     이번 주 수업 — 수업일 · 과제 기간 · 수업 영상 · 배부 자료/과제 파일 (migration-011)
     hub_get · class_notice_get 의 weekly 만 쓴다. 파일 보관 위치는 받지 않는다.
     ============================================================ */

  var WEEKLY = null;
  var PART_NAME = { full: '수업 전체', '1': '1차시', '2': '2차시', makeup: '보강' };
  var PART_ORDER = { full: 0, '1': 1, '2': 2, makeup: 3 };
  /* 한 주 안에서 수업 전체 → 1차시 → 2차시 → 보강 */
  function sortVideos(list) {
    function o(v) { return PART_ORDER[v.part] == null ? 9 : PART_ORDER[v.part]; }
    return list.map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) { return (o(a.v) - o(b.v)) || (a.i - b.i); })
      .map(function (x) { return x.v; });
  }
  /* 영상 한 줄 — 「▶ 수업 영상 보기」 · 여러 개면 차시 이름을 붙인다 (「▶ 1교시 영상 보기」 · 20261031x) */
  var PART_WATCH = { full: '수업 전체 영상 보기', '1': '1교시 영상 보기', '2': '2교시 영상 보기', makeup: '보강 영상 보기' };
  var VD_PLAIN = /^\s*(수업\s*영상|수업\s*전체|전체\s*영상|전체|영상|\d\s*(차시|교시)(\s*영상)?|강의\s*영상|보강(\s*영상)?)?\s*$/;
  function weekVideoHtml(v, i, all) {
    var many = all && all.length > 1;
    /* 선생님이 붙인 제목(예: 관동별곡 해설 · 가나 보강)은 그 제목 한 줄 · 기본값이면 「수업 영상 보기」 */
    var label = !VD_PLAIN.test(v.title || '') ? String(v.title).trim()
      : many ? (PART_WATCH[v.part] || '수업 영상 보기') : (v.part === 'makeup' ? '보강 영상 보기' : '수업 영상 보기');
    return videoHtml(v.url, '<span class="vd-watch">▶ ' + esc(label) + (v.personal ? ' · 나만 보는 영상' : '') + '</span>');
  }

  /* 「어떤 수업이었는지」 (20261031t · migration-046) — 확정된 수업 내용 요약 · 키워드 칩(복습 노트 「다룬 지문」 우선) */
  function lessonLines(w) { return ((w && w.lessons) || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean); }
  /* 「수업」 카드 안 (20261031x) — 큰 제목 없이 차시마다 「1교시  독서 · 인문」 머리말 + 점 목록 (예전 한 줄 요약도 같은 모양)
     키워드는 # 없이 · 수업 영상 탭 카드(opt.kws)에서만 */
  function lessonInfoHtml(w, vids, opt) {
    var lines = lessonLines(w), kws = opt && opt.kws ? ((w && w.keywords) || []).filter(function (k) { return String(k || '').trim(); }).slice(0, 5) : [];
    if (!lines.length && !kws.length) return '';
    return '<div class="vd-info">' +
      (lines.length ? ReportView.lessonBlocksHtml(lines) : '') +
      (kws.length ? '<div class="vd-kws" aria-label="수업 영상 키워드">' + kws.map(function (k) { return '<span class="vd-kw">' + esc(k) + '</span>'; }).join('') + '</div>' : '') +
    '</div>';
  }
  function vdText(x) { return [weekName(x.w.week_start)].concat(lessonLines(x.w), (x.w.keywords || []), x.vids.map(function (v) { return v.title || ''; })).join(' ').toLowerCase(); }

  function plusDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function lessonOf(weekStart) {
    if (!WEEKLY || !WEEKLY.schedule || !global.Lesson || !weekStart) return null;
    return Lesson.of(WEEKLY.schedule, String(weekStart).slice(0, 10));
  }

  /* 공지 · 자료 카드 위의 "수업일 10/15(목) · 과제 기간 10/8~10/14" */
  function lessonLineHtml(weekStart) {
    var L = lessonOf(weekStart);
    if (!L) return '';
    return '<p class="nt-lesson' + (L.canceled ? ' nt-lesson--off' : '') + '">' + (L.canceled ? '🔕 ' : '🗓️ ') + esc(Lesson.line(L)) + '</p>';
  }

  /* 레포트 목록 — 수업일이 있는 레포트는 "10/15(목) 수업", 예전 레포트는 기간 */
  function reportLabel(r) {
    if (r.lesson_date && ReportView.dowDate) return ReportView.dowDate(r.lesson_date) + ' 수업';
    return weekName(r.week_start);
  }

  /* 그 주 수업일 「10/22(목) 수업」 — 수업 요일을 정하기 전 예전 주는 「10/18까지」 (주 시작일은 쓰지 않는다 · 20261029i) */
  function weekName(weekStart) {
    var L = lessonOf(weekStart);
    if (L && L.date) return Lesson.md(L.date) + ' 수업';
    var ws = String(weekStart || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ws) ? ReportView.shortDate(plusDays(ws, 6)) + '까지' : '';
  }

  function sizeText(b) {
    b = Number(b) || 0;
    return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
  }

  /* 확정된 수업 내용 (AI 요약을 직원이 [확정]한 것만 · migration-012) — "1차시: …" */
  function lessonsHtml(lines) {
    var list = (lines || []).filter(function (t) { return String(t || '').trim(); });
    if (!list.length) return '';
    return '<div class="nt-sub">📖 수업 내용</div>' + ReportView.lessonBlocksHtml(list);
  }

  function weekBodyHtml(w) {
    var html = lessonsHtml(w.lessons);
    var vids = sortVideos((w.videos || []).filter(function (v) { return v && safeUrl(v.url); }));
    if (vids.length) {
      html += '<div class="nt-sub">▶️ 수업 영상</div><div class="nt-videos">' + vids.map(weekVideoHtml).join('') + '</div>';
    }
    html += filesOf(w);                 /* 카드 — 필수 과제 → 선택 과제 → 배부 자료 (20261029i) */
    return html || '<p class="hub-muted">이 주에는 영상 · 자료가 없습니다.</p>';
  }

  function weeklyHtml(weekly) {
    if (!weekly) return '';
    var weeks = weekly.weeks || [];
    if (!weeks.length) {
      /* 영상 · 자료는 아직 없지만 수업 요일은 있을 때 — 이번 주 수업일만 */
      var t = (global.DDay && DDay.today) ? DDay.today() : new Date().toISOString().slice(0, 10);
      var mon = plusDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7));
      var line = lessonLineHtml(mon);
      return line ? '<div class="card wk-card"><h2 class="card-title">🏃 이번 주 수업</h2>' + line + '</div>' : '';
    }
    var latest = weeks[0];
    var html =
      '<div class="card wk-card">' +
        '<h2 class="card-title">🏃 ' + esc(weekName(latest.week_start)) + ' 영상 · 자료' +
          '<span class="card-note">최신</span></h2>' +
        lessonLineHtml(latest.week_start) +
        weekBodyHtml(latest) +
      '</div>';
    if (weeks.length > 1) {
      html += '<div class="card"><h2 class="card-title">🗂️ 지난 수업 영상 · 자료<span class="card-note">' +
              (weeks.length - 1) + '주</span></h2><div class="nt-archive">' +
              weeks.slice(1).map(function (w, i) {
                return '<details class="nt-past wk-past" data-w="' + (i + 1) + '">' +
                         '<summary><span class="nt-past__week num">' + esc(weekName(w.week_start)) + '</span>' +
                         '<span class="nt-past__title">' + esc(weekCount(w)) + '</span></summary>' +
                         '<div class="nt-past__body"></div>' +
                       '</details>';
              }).join('') + '</div></div>';
    }
    return html;
  }

  function weekCount(w) {
    var parts = [];
    if ((w.lessons || []).length) parts.push('수업 내용');
    if ((w.videos || []).length) parts.push('영상 ' + w.videos.length);
    if ((w.files || []).length) parts.push('자료 ' + w.files.length);
    return parts.join(' · ');
  }

  function bindFiles(root, code) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-file]');
      if (!b || b.disabled) return;
      b.disabled = true;
      fileUrl(code, b.dataset.file).then(function (res) {
        if (res && res.ok && res.url) { location.href = res.url; return; }
        flash((res && res.message) || '내려받지 못했습니다. 잠시 뒤 다시 눌러 주세요');
      }).catch(function () { flash('내려받지 못했습니다. 인터넷 연결을 확인해 주세요'); })
        .then(function () { setTimeout(function () { b.disabled = false; }, 1200); });
    });
  }

  /* 지난 주 펼치기 · 파일 내려받기 */
  function bindWeekly(root, code) {
    root.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.classList || !d.classList.contains('wk-past') || !d.open) return;
      var body = d.querySelector('.nt-past__body');
      if (body && !body.dataset.done && WEEKLY) {
        var w = (WEEKLY.weeks || [])[+d.dataset.w];
        if (w) body.innerHTML = lessonLineHtml(w.week_start) + weekBodyHtml(w);
        body.dataset.done = '1';
        loadThumbs(body, code);
      }
    }, true);

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-file]');
      if (!b || b.disabled) return;
      b.disabled = true;
      b.classList.add('is-busy');
      fileUrl(code, b.dataset.file).then(function (res) {
        if (res && res.ok && res.url) { location.href = res.url; return; }
        flash((res && res.message) || '내려받지 못했습니다. 잠시 뒤 다시 눌러 주세요');
      }).catch(function () {
        flash('내려받지 못했습니다. 인터넷 연결을 확인해 주세요');
      }).then(function () {
        setTimeout(function () { b.disabled = false; b.classList.remove('is-busy'); }, 1200);
      });
    });
  }

  /* ============================================================
     수업 영상 탭 (#코드/videos · 탭 이름 「수업 영상」, 안 제목 「강의 다시 보기」) — 영상이 있는 주만, 최신 주가 위.
       최근 4주는 펼쳐 두고, 그 앞 주는 [이전 주 더 보기].
       보강 영상은 서버가 대상 학생에게만 준다 (그대로 쓴다).
     ============================================================ */
  function videoWeeks() {
    return ((WEEKLY && WEEKLY.weeks) || []).map(function (w) {
      return { w: w, vids: sortVideos((w.videos || []).filter(function (v) { return v && safeUrl(v.url); })) };
    }).filter(function (x) { return x.vids.length; });
  }
  function videoWeekCard(x) {
    return '<div class="card vd-week">' +
             '<h2 class="card-title">' + esc(weekName(x.w.week_start)) + '</h2>' +
             lessonInfoHtml(x.w, x.vids, { kws: true }) +
             '<div class="nt-videos">' + x.vids.map(weekVideoHtml).join('') + '</div>' +
           '</div>';
  }
  function renderVideos(host) {
    var list = videoWeeks();
    var head = '<h2 class="vd-title">강의 다시 보기</h2>';
    if (!list.length) { host.innerHTML = head + '<div class="empty">아직 올라온 수업 영상이 없습니다.</div>'; return; }
    /* 맨 위 키워드로 찾기 — 키워드 · 차시 한 줄 · 영상 제목 · 수업일에서 (찾는 중에는 모든 주에서) */
    host.innerHTML = head +
      '<label class="vd-find"><span class="sr-only">키워드로 찾기</span><input type="search" class="vd-find__in" data-vd-find placeholder="키워드로 찾기 (예: 진달래꽃 · 비문학)" autocomplete="off"></label>' +
      '<div class="vd-list" data-vd-list></div>';
    var box = host.querySelector('[data-vd-list]'), all = false;
    function draw(q) {
      q = String(q || '').trim().toLowerCase();
      var hit = q ? list.filter(function (x) { return vdText(x).indexOf(q) !== -1; }) : list;
      if (q) { box.innerHTML = hit.length ? hit.map(videoWeekCard).join('') : '<div class="empty">「' + esc(q) + '」이(가) 들어간 수업 영상이 없습니다.</div>'; return; }
      box.innerHTML = (all ? list : list.slice(0, 4)).map(videoWeekCard).join('') +
        (!all && list.length > 4 ? '<div id="vdMore"><button type="button" class="hub-more" data-vd-more>이전 주 더 보기 <span class="num">(' + (list.length - 4) + '주)</span></button></div>' : '');
    }
    draw('');
    host.oninput = function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-vd-find')) draw(e.target.value); };
    host.onclick = function (e) {
      if (!e.target.closest('[data-vd-more]')) return;
      all = true;
      draw(host.querySelector('[data-vd-find]').value);
    };
  }

  function fileUrl(code, id) {
    if (PV) return PV.fileUrl(id);
    return fetch(CFG.supabase.url + '/functions/v1/' + (CFG.fileFunction || 'class-file'), {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'url', code: code, id: id })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }


  /* 머리 — 「학생용」 / 「학부모용」 작게 */
  function roleTag(role) {
    var top = $('.hub-head__top');
    if (!top || !role) return;
    var t = document.createElement('span');
    t.className = 'hub-role hub-role--' + role;
    t.textContent = role === 'student' ? '학생용' : '학부모용';
    var id = top.querySelector('.hub-head__id');
    (id || top).appendChild(t);
  }

  /* 학생 입구로 로그인한 기기 — 머리에 [로그아웃] (이 기기에 남긴 학생 링크 코드를 지우고 입구로) */
  function logoutButton(EL) {
    var head = $('#hubHead');
    if (!head || document.getElementById('hubLogout')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'hubLogout';
    b.className = 'hub-logout';
    b.textContent = '로그아웃';
    b.addEventListener('click', function () {
      EL.clear();
      global.location.replace('../s/?out=1');
    });
    head.appendChild(b);
  }

  /* 코치룸 미리보기 띠 */
  /* 띠 글은 코치룸(preview.js)이 정한다 — 「이 주차 · 아직 공개 전입니다 · 공개하면 학부모에게 이렇게 보입니다」 등 (20261029g) */
  function previewBand() {
    var b = document.getElementById('pvBand');
    if (!b) {
      b = document.createElement('div');
      b.id = 'pvBand';
      b.className = 'pv-band';
      document.body.insertBefore(b, document.body.firstChild);
    }
    b.textContent = PV.band || ('미리보기 — 조교 화면 · ' + (PV.role === 'student' ? '학생 링크' : '학부모 링크') + '로 열었을 때 모습입니다. 눌러도 아무것도 바뀌지 않습니다');
  }

  /* ============================================================
     홈 화면에 추가하는 법 (개인 페이지) · 카톡 안에서 열었을 때 안내
     ============================================================ */

  function inKakao() { return /KAKAOTALK/i.test(navigator.userAgent || ''); }

  function kakaoNoteHtml() {
    if (!inKakao()) return '';
    return '<div class="card a2hs-kakao">💡 카톡 안에서 열었어요. 홈 화면에 추가하려면 오른쪽 아래(또는 위) <b>⋮ · ⋯</b> → <b>다른 브라우저로 열기</b> 를 눌러 주세요.</div>';
  }

  function homeGuideHtml() {
    return '<details class="card a2hs">' +
      '<summary>📲 홈 화면에 추가하는 법 — 다음부터 링크를 찾지 않고 바로 열어요</summary>' +
      '<p class="a2hs__warn">카톡 안에서는 추가가 안 돼요. 먼저 <b>⋮ · ⋯ → 다른 브라우저로 열기</b> 로 연 다음 아래대로 하세요.</p>' +
      '<div class="a2hs__os"><b>갤럭시 (삼성 인터넷)</b><ol><li>아래쪽 <b>≡ 메뉴</b></li><li><b>현재 페이지 추가</b> → <b>홈 화면</b></li></ol></div>' +
      '<div class="a2hs__os"><b>갤럭시 (크롬)</b><ol><li>오른쪽 위 <b>⋮</b></li><li><b>홈 화면에 추가</b> → <b>추가</b></li></ol></div>' +
      '<div class="a2hs__os"><b>아이폰 (Safari)</b><ol><li>아래쪽 <b>공유 버튼 (□↑)</b></li><li><b>홈 화면에 추가</b> → <b>추가</b></li></ol></div>' +
      '<p class="hub-muted">홈 화면 아이콘에는 이 학생의 개인 링크가 그대로 담깁니다. 다른 사람과 휴대폰을 같이 쓰면 주의해 주세요.</p>' +
    '</details>';
  }


  /* ============================================================
     앱 기록 — 한 번만 불러와 레포트 · 과제 상세 탭 · 누적 추이가 같이 쓴다 (app-week.js)
     ============================================================ */
  var APP = { code: '', p: null, info: null };
  /* 과제 수정 (migration-038 · 20261031j) — 선생님이 고친 날은 고친 값으로 (바꾼 상태만 · 사유나 「수정」 표시는 없다)
     공개한 레포트 기간은 공개할 때 담은 값 · SQL 이 아직 없으면 앱 기록 그대로 */
  function hwFix(code) {
    return Promise.resolve().then(function () { return rpc('hub_hw_fix', { p_code: code }); })
      .then(function (m) { return m && typeof m === 'object' ? m : {}; }, function () { return {}; });
  }
  /* 수강 시작일 — 레포트(report_data.startOn · 코치룸이 공개할 때 담는다)에서 · 그 앞 날은 「신입생」 (20261031q) */
  var HUBSTART = '';
  function withStart(d) { return d && HUBSTART && !d.startOn ? Object.assign({}, d, { startOn: HUBSTART }) : d; }
  function appData(code) {
    if (APP.code !== code || !APP.p) {
      APP.code = code;
      APP.p = Promise.all([appReport(code), hwFix(code)]).then(function (x) {
        var r = x[0];
        APP.why = r && !r.ok ? String(r.reason || '') : '';      /* 'expired' — 링크 만료 (과제 상세 탭 안내 · 20261031n) */
        if (!(r && r.ok)) return null;
        return global.AppWeek && AppWeek.withFix ? AppWeek.withFix(r.data || {}, x[1]) : (r.data || {});
      }, function () { return null; });
      /* 실패는 남기지 않는다 — [다시 시도]는 새로 부른다 */
      APP.p.then(function (d) { if (!d && APP.code === code) APP.p = null; });
    }
    return APP.p.then(withStart);
  }
  /* 불러오는 동안 — 빙글빙글 「과제 불러오는 중」 (10초가 넘으면 「조금 오래 걸리고 있습니다」) · 실패 — 「과제 기록 못 불러옴 · 다시 시도」 */
  function appWaitHtml() {
    return '<div class="card app-wait" data-app-wait><p class="tw-loading"><i class="spin" aria-hidden="true"></i> <span data-app-wait-t>과제 불러오는 중</span></p></div>';
  }
  function appWaitSlow(box) {
    setTimeout(function () {
      var t = box && box.querySelector('[data-app-wait-t]');
      if (t) t.textContent = '조금 오래 걸리고 있습니다 · 과제 불러오는 중';
    }, 10000);
  }
  function appFailHtml(key) {
    return '<div class="card app-fail"><span>과제 기록 못 불러옴</span> <button type="button" class="hub-btn hub-btn--sm" data-app-retry="' + esc(key) + '">다시 시도</button></div>';
  }
  var APP_RETRY = {};
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-app-retry]');
    if (!b || !APP_RETRY[b.dataset.appRetry]) return;
    APP.p = null;
    APP_RETRY[b.dataset.appRetry]();
  });
  function todayISO() { return (global.DDay && DDay.today) ? DDay.today() : new Date().toISOString().slice(0, 10); }
  function mondayOf(iso) {
    var s = String(iso).slice(0, 10);
    return plusDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));
  }
  function weekOf(mon) {
    return ((WEEKLY && WEEKLY.weeks) || []).filter(function (x) { return x.week_start && mondayOf(x.week_start) === mon; })[0] || null;
  }

  /* ============================================================
     「앱 과제 요약」 한 덩어리 — 각 레포트 · 과제 상세 탭 · 코치룸 미리보기가 같이 쓴다
       큰 동그라미 3개 = 그 기간(주간) 기준 — 아래 표(app-week.js)와 같은 날짜 계산
         과제 제출 = 제출일 / 과제 있던 날 · 정시 제출 = 정시 제출일 / 과제 있던 날 · 강의 시청 = ✓ 날 / 강의 있던 날
       아래 작은 줄 = 앱이 주는 전체 누적 그대로 · 「날짜별 제출」 달력은 한 달씩 (◀ ▶ 는 앱 기록이 있는 달 사이만)
       레포트(수업일 D)에서는 모두 「지난 일주일」 D-7 ~ D-1 — 전체 누적도 시작일 ~ D-1, 달력은 그 7일만 강조 (reportAppHtml · 20261029h)
     ============================================================ */
  var AWB = { n: 0, list: {} };
  function pctOf(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function dashRing(label) {
    return ring(0, label).replace(/<div class="rate-num num">0<small>%<\/small><\/div>/, '<div class="rate-num num">—</div>');
  }
  function calMonths(data, first) {
    var set = {};
    ((data && data.calendar) || []).forEach(function (c) { if (c && /^\d{4}-\d{2}/.test(c.date || '')) set[c.date.slice(0, 7)] = 1; });
    if (first) set[first] = 1;
    return Object.keys(set).sort();
  }
  function calMonthHtml(id) {
    var b = AWB.list[id];
    if (!b || !b.months.length) return '';
    var ym = b.months[b.i];
    var byDay = {};
    ((b.data && b.data.calendar) || []).forEach(function (c) { if (c && String(c.date || '').slice(0, 7) === ym) byDay[c.date] = c; });
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var cells = '', subs = AppWeek.subDaysOf(b.data), t = todayISO();
    for (var i = 0; i < first; i++) cells += '<span class="cal-cell cal-cell--blank"></span>';
    for (var dd = 1; dd <= last; dd++) {
      var key = ym + '-' + String(dd).padStart(2, '0'), info = byDay[key];
      var inR = b.range && key >= b.range.from && key <= b.range.to;
      if (b.data && b.data.startOn && key < b.data.startOn) {
        cells += '<span class="cal-cell cal-cell--new' + (inR ? ' cal-cell--range' : '') + '" title="' + esc(dd + '일 · 신입생 (수강 시작 전 · 세지 않음)') + '"><b>' + dd + '</b><small>신입생</small></span>';
        continue;
      }
      if (AppWeek.isWeekend(key)) {
        /* 토 · 일 = 늘 「주중 복습」(옅은 색 · 미제출로 치지 않음) · 앱에 제출한 기록이 있으면 ✓ (20261030d) */
        var wkd = key <= t && ((info && (info.status === 'onTime' || info.status === 'late')) || !!subs[key]);
        cells += '<span class="cal-cell cal-cell--wk' + (wkd ? ' cal-cell--wkdone' : '') + (inR ? ' cal-cell--range' : '') + '" title="' +
                 esc(dd + '일 · 주중 복습' + (wkd ? ' · 제출함' : '')) + '"><b>' + dd + '</b><small>주중 복습' + (wkd ? ' ✓' : '') + '</small></span>';
        continue;
      }
      /* 오늘 — 밤 12시 마감 전 · 아직 안 냈으면 「미제출」 대신 연하게 (20261031v) */
      var stt = info ? (key === t && info.status === 'none' ? 'today' : info.status) : '';
      cells += '<span class="cal-cell' + (stt ? ' cal-cell--' + stt : '') + (inR ? ' cal-cell--range' : '') + '"' +
               (stt ? ' title="' + esc(dd + '일 · ' + CAL_LABEL[stt]) + '"' : '') + '>' + dd + '</span>';
    }
    return '<div class="cal">' +
        '<div class="cal-nav"><button type="button" class="cal-step" data-awb="' + id + '" data-cal-step="-1" aria-label="이전 달"' + (b.i > 0 ? '' : ' disabled') + '>◀</button>' +
          '<span class="cal-month">' + y + '년 ' + m + '월</span>' +
          '<button type="button" class="cal-step" data-awb="' + id + '" data-cal-step="1" aria-label="다음 달"' + (b.i < b.months.length - 1 ? '' : ' disabled') + '>▶</button></div>' +
        '<div class="cal-grid">' + ['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return '<span class="cal-dow">' + w + '</span>'; }).join('') + cells + '</div>' +
      '</div>' +
      '<div class="cal-legend"><span><i class="cal-key cal-cell--onTime"></i>정시 제출</span><span><i class="cal-key cal-cell--late"></i>늦게 제출</span><span><i class="cal-key cal-cell--none"></i>미제출</span>' +
        '<span><i class="cal-key cal-cell--wk"></i>주중 복습(토 · 일)</span>' +
        (b.range ? '<span><i class="cal-key cal-cell--range"></i>이 레포트 기간</span>' : '') + '</div>';
  }
  /* opt: { title, sub, month('YYYY-MM'), pending(진행 중 기간), card(false 면 겉 카드 없이),
           total(전체 누적을 앱 값 대신 · AppWeek.cumulative), range({from,to} 달력에서 강조), first(첫 주 — 지난 기록 없음) } */
  function appBlockHtml(data, w, opt) {
    opt = opt || {};
    var id = 'awb' + (++AWB.n);
    var months = calMonths(data, opt.month || '');
    AWB.list[id] = { data: data, months: months, i: Math.max(0, months.indexOf(opt.month || '')), range: opt.range || null };
    var s = (data && data.stats) || {};
    if (opt.first) {
      var fin = '<h2 class="card-title">📱 ' + esc(opt.title || '과제 요약') + '</h2>' +
        (opt.sub ? '<p class="awb-sub">' + opt.sub + '</p>' : '') + '<p class="awb-wait">' + (opt.newStudent ? '첫 수업입니다 · 다음 레포트부터 과제 기록이 보입니다' : '첫 주라 지난 기록이 없습니다') + '</p>';
      return opt.card === false ? '<div class="awb" id="' + id + '">' + fin + '</div>' : '<div class="card awb aw-card" id="' + id + '">' + fin + '</div>';
    }
    var body = !w || !w.hwDays
      ? '<p class="awb-wait">' + (w && w.allNew ? '신입생 — 수강 시작 전 기간입니다' : opt.range ? '이 기간에는 과제가 없었습니다' : '아직 과제 시작 전') + '</p>'
      : '<div class="rate-grid rate-grid--three">' +
          ring(pctOf(w.hwDone, w.hwDays), '과제 제출') + ring(pctOf(w.hwOnTime, w.hwDays), '정시 제출') +
          (w.lecDays ? ring(pctOf(w.lecDone, w.lecDays), '강의 시청') : dashRing('강의 시청')) +
        '</div>' +
        '<p class="app-counts num"><span class="hw-tone hw-tone--' + AppWeek.tone(w.hwDone, w.hwDays) + '">' + w.hwDone + '/' + w.hwDays + '일 제출</span> · 정시 ' + w.hwOnTime + '일 · 강의 ' + w.lecDone + '/' + w.lecDays + '일</p>';
    /* 전체 누적은 날짜별 기록으로 직접 센다 (토 · 일 주중 복습은 빼고 · 20261030d) — 날짜별 기록이 없을 때만 앱 값 그대로 */
    var tt = opt.total || ((data && data.calendar && data.calendar.length && AppWeek.cumulative) ? AppWeek.cumulative(data, todayISO(), todayISO()) : null);
    var total = tt
      ? '<p class="awb-total">전체 누적(시작일부터): 과제 ' + tt.hw + '% · 정시 ' + tt.onTime + '% · 강의 ' + (tt.lec == null ? '—' : tt.lec + '%') + '</p>'
      : '<p class="awb-total">전체 누적(시작일부터): 과제 ' + Math.round(Number(s.submissionRate) || 0) + '% · 정시 ' +
        Math.round(Number(s.onTimeRate) || 0) + '% · 강의 ' + Math.round(Number(s.lectureRate) || 0) + '%</p>';
    var inner = '<h2 class="card-title">📱 ' + esc(opt.title || '과제 요약') + '</h2>' +
      (opt.sub ? '<p class="awb-sub">' + opt.sub + '</p>' : '') +
      body + (opt.noTotal ? '' : total) +
      (w ? AppWeek.tableHtml(w, { pending: !!opt.pending }) : '') +
      (months.length && !opt.noCal ? '<div class="awb-cal"><div class="awb-cal__t">🗓️ 날짜별 제출</div><div class="awb-cal__m" data-awb-cal="' + id + '">' + calMonthHtml(id) + '</div></div>' : '');
    return opt.card === false ? '<div class="awb" id="' + id + '">' + inner + '</div>' : '<div class="card awb aw-card" id="' + id + '">' + inner + '</div>';
  }
  function periodTitle(label, from, to) { return '과제 요약 · ' + label + ' (' + Lesson.md(from, false) + '~' + Lesson.md(to, false) + ')'; }
  /* 레포트(수업일 D)의 앱 과제 요약 — 「앱 과제 요약 · 지난 일주일 (10/15~10/21)」 · 「10/22 수업 전까지 한 것」 (20261029h)
     원형 3개 · n/n일 제출 · 날짜 칸(7칸) · 전체 누적(시작일 ~ D-1)이 모두 같은 기간. 앱 기록이 그 뒤에 시작했으면 「첫 주라 지난 기록이 없습니다」 */
  function reportAppHtml(data, lessonDate, card) {
    var p = data && global.AppWeek ? AppWeek.forLesson(data, lessonDate, todayISO()) : null;
    if (!p || (!p.first && !(p.w && p.w.any))) return '';      /* 그 일주일에 과제 · 강의가 하나도 없던 주는 그리지 않는다 (예전 그대로) */
    return appBlockHtml(data, p.w, { title: periodTitle('지난 일주일', p.from, p.to), sub: esc(Lesson.md(p.lesson, false)) + ' 수업 전까지 한 것',
                                     month: p.to.slice(0, 7), total: p.total, range: { from: p.from, to: p.to }, first: p.first, newStudent: !!p.newStudent, card: card });
  }
  function animateRings(root) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        (root || document).querySelectorAll('.rate-circle-fill').forEach(function (el) { el.setAttribute('stroke-dashoffset', el.getAttribute('data-offset')); });
      });
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-cal-step]');
    if (!b || b.disabled) return;
    var blk = AWB.list[b.dataset.awb];
    if (!blk) return;
    blk.i = Math.max(0, Math.min(blk.months.length - 1, blk.i + Number(b.dataset.calStep)));
    var host = document.querySelector('[data-awb-cal="' + b.dataset.awb + '"]');
    if (host) host.innerHTML = calMonthHtml(b.dataset.awb);
  });
  /* ---------- 과제 상세 탭 — 레포트 수업일 L 기준 두 덩어리 (20261031v) ----------
       「이 수업 과제 (L-7 ~ L-1)」 레포트 과제 칸과 같은 기간 · 숫자 (AppWeek.forLesson) — 원형 3개 · 요일 칸 · 정답률
       「진행 중 · 다음 수업까지 (L ~ 다음 수업 전날)」 원형 없이 요일 칸 한 줄 · 「지금까지 n/n일 제출」(작고 연하게 · 다음 레포트에 반영)
       L = 지금 열어 둔 레포트의 수업일 (지난 레포트를 열면 그 수업일) · 바로 열면 가장 최근 수업일(오늘 포함)
       전체 누적(시작일부터) · 날짜별 제출 달력은 맨 아래 */
  function latestLessonDate() {
    var t = todayISO(), mon = mondayOf(t);
    for (var k = 0; k < 9; k++) {
      var L = lessonOf(plusDays(mon, -7 * k));
      if (L && !L.canceled && L.date && L.date <= t) return L.date;
    }
    return '';
  }
  function appBaseDate(reports) {
    if (RP.cur >= 0 && RP.cur !== RP.latest && RP.list[RP.cur]) { var ld = lessonDateOf(RP.list[RP.cur], RP.cur === RP.list.indexOf(RP.r) ? RP.data : null); if (ld) return ld; }
    var L = latestLessonDate();
    if (L) return L;
    var rep = (reports || []).filter(function (r) { return r && r.week_start && !r.draft; })[0];
    return rep ? lessonDateOf(rep, null) : '';
  }
  function nextPeriod(L) {
    var nx = nextLessonAfter(L);
    return { from: L, to: nx ? plusDays(nx.date, -1) : plusDays(L, 6), next: nx ? nx.date : '' };
  }
  /* 진행 중 덩어리 — 요일 칸 한 줄(과제) · 「지금까지 n/n일 제출」 · 아직 안 온 날은 비움 · 오늘은 「오늘」 */
  function progressHtml(w, p) {
    var t = todayISO(), live = p.from <= t && t <= p.to;
    var head = (live ? '진행 중 · 다음 수업까지' : '다음 수업까지') + ' (' + Lesson.md(p.from, false) + '~' + Lesson.md(p.to, false) + ')';
    var cells = w ? w.days.map(function (d) {
      var v = d.weekend ? (d.hw === 'wkDone' ? 'wkDone' : 'wk') : d.hw;
      var mark = d.hw === 'new' ? '신입' : d.weekend ? (d.hw === 'wkDone' ? '✓' : '') : v === 'future' ? '' : (AppWeek.HW_MARK[v] || '');
      var tip = Lesson.md(d.date, false) + ' ' + (d.hw === 'new' ? '신입생' : AppWeek.HW_TIP[v] || '');
      return '<span class="apg-c apg-c--' + esc(v) + (d.weekend ? ' apg-c--wk' : '') + '" title="' + esc(tip) + '"><b class="num">' + (+d.date.slice(8)) + '</b><small>' + d.dow + '</small><i>' + esc(mark) + '</i></span>';
    }).join('') : '';
    var sum = !w ? '' : w.allNew ? '신입생' : w.hwDays ? '지금까지 ' + w.hwDone + '/' + w.hwDays + '일 제출' : '아직 센 날이 없어요';
    return '<div class="card apg" aria-label="' + esc(head) + '">' +
      '<div class="apg-h"><span class="apg-t">' + esc(head) + '</span><span class="apg-note">다음 레포트에 반영돼요</span></div>' +
      (cells ? '<div class="apg-row" style="grid-template-columns:repeat(' + w.days.length + ', minmax(0, 1fr))">' + cells + '</div>' : '') +
      (sum ? '<p class="apg-sum num">' + esc(sum) + '</p>' : '') +
    '</div>';
  }
  /* 맨 아래 — 전체 누적(시작일부터) · 날짜별 제출 달력 */
  function apBottomHtml(d, range) {
    var id = 'awb' + (++AWB.n), t = todayISO(), months = calMonths(d, t.slice(0, 7));
    AWB.list[id] = { data: d, months: months, i: Math.max(0, months.indexOf(t.slice(0, 7))), range: range || null };
    var tt = d && d.calendar && d.calendar.length ? AppWeek.cumulative(d, t, t) : null, s = (d && d.stats) || {};
    var total = tt ? '과제 ' + tt.hw + '% · 정시 ' + tt.onTime + '% · 강의 ' + (tt.lec == null ? '—' : tt.lec + '%')
      : '과제 ' + Math.round(Number(s.submissionRate) || 0) + '% · 정시 ' + Math.round(Number(s.onTimeRate) || 0) + '% · 강의 ' + Math.round(Number(s.lectureRate) || 0) + '%';
    return '<div class="card awb aw-card ap-bottom" id="' + id + '"><p class="awb-total">전체 누적(시작일부터): ' + total + '</p>' +
      (months.length ? '<div class="awb-cal"><div class="awb-cal__t">🗓️ 날짜별 제출</div><div class="awb-cal__m" data-awb-cal="' + id + '">' + calMonthHtml(id) + '</div></div>' : '') + '</div>';
  }

  /* 과제 상세 탭의 진행 중 기간 — 가장 최근 공개 레포트 수업일 ~ 다음 수업일 전날 (레포트가 없으면 오늘 기준 다음 수업의 과제 기간) */
  function currentPeriod(rep, lessonDate) {
    var start = rep ? (lessonDate || rep.lesson_date || ((lessonOf(rep.week_start) || {}).date) || '') : '';
    start = /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : '';
    if (rep && !start) return null;
    var next = nextLessonAfter(start || plusDays(todayISO(), -1));
    if (!next) return null;
    var from = start || next.hwFrom || '', to = plusDays(next.date, -1);
    return { next: next.date, from: from && from <= to ? from : '', to: to };
  }

  /* 누적 추이의 과제 칸 — 앱이 연결된 학생은 그 주 과제 기간의 앱 제출일 비율로 */
  function appAdjust(weeks, data) {
    if (!data || !global.AppWeek) return weeks;
    return weeks.map(function (w) {
      /* 그 레포트 수업 전 일주일 (D-7 ~ D-1 · 레포트 앱 과제 요약과 같은 기간 · 20261029h) */
      var L = lessonOf(w.week_start);
      var p = AppWeek.lastWeek(/^\d{4}-\d{2}-\d{2}/.test(w.lesson_date || '') ? w.lesson_date : (L && !L.canceled ? L.date : ''));
      if (!p) return w;
      var r = AppWeek.hwRate(AppWeek.compute(data, p.from, p.to, todayISO()));
      var x = {}; Object.keys(w).forEach(function (k) { x[k] = w[k]; });
      x.hw = r;
      return x;
    });
  }

  /* ============================================================
     「레포트」 탭의 수업 레포트 한 편 (20261029i — 예전 「이번 주」 · 「내 레포트」를 하나로 합쳤다)
       열면 가장 최근에 공개된 수업 레포트. 위 한 줄 「◀ 지난주 · 10/22(목) 수업 ▾ · 다음주 ▶ · 누적 추이」로 다른 수업.
       차례: 머리(수업일) → 출결 · 집중도 · 복습테스트 → 오늘 수업 필기 → 앱 과제 요약 · 지난 일주일
             → 수업 내용(레포트에 담긴 것 · 없으면 확정된 요약 「오늘 배운 것」) → 종합 코멘트(선생님 한마디)
             → 수업 영상(20261030b — 선생님 한마디 바로 아래) → 이 수업 과제 · 자료(카드) → 선생님 공지 → 학생 정보
       예전 「이번 주」에만 있던 것도 빠뜨리지 않는다 — 가장 최근 레포트에는 「다른 주 과제 · 자료」(접어서) · 지난 공지까지.
       [복습테스트 입력하기](학생 링크 · 제출 기간)는 탭 맨 위, 홈 화면 추가 안내는 맨 아래.
       공개된 레포트 · 낸 복습 점수 · 확정된 요약 · 앱 기록 · 학생이 올린 필기만. 상담 · 성적 · 금액 · 다른 학생 정보는 넣지 않는다.
       주 시작일(10/12 같은 날짜)은 화면에 쓰지 않는다 — 수업일로 (레포트에 없으면 반 일정의 수업일).
     ============================================================ */
  var HUBD = null;        /* hub_get 이 준 것 (낸 복습 점수 · 공지 — 030 부터 확인 단계 없이 낸 점수 그대로) */
  var RVW = {};           /* 주(월요일) → hub_review_week (낸 것 · 맞은 수 / 전체 · 미응시 사유 이름) */

  /* 그 주 복습테스트 — 시험마다 맞은 수 / 전체 · 같은 시험 지난번과의 차이 (migration-025 · 030) */
  function reviewOfWeek(list, mon) {
    var end = plusDays(mon, 6), out = [];
    list.forEach(function (x, k) {
      var d = String(x.lesson_date || '').slice(0, 10);
      if (d < mon || d > end) return;
      var name = x.test_name || '복습 TEST', prev = null;
      for (var j = k - 1; j >= 0; j--) if ((list[j].test_name || '복습 TEST') === name) { prev = list[j]; break; }
      out.push({ name: name, score: Number(x.score), correct: x.correct, q: x.q_count, diff: diffOf(x, prev) });
    });
    return out.length ? out : null;
  }
  /* ▲▼ — 문항 수가 같으면 맞은 개수 차이, 다르면 표시하지 않는다 */
  function diffOf(x, prev) {
    if (!prev || x.correct == null || prev.correct == null || Number(x.q_count) !== Number(prev.q_count)) return null;
    return Number(x.correct) - Number(prev.correct);
  }

  function tile(label, value, wide) {
    return '<div class="tw-tile' + (wide ? ' tw-tile--wide' : '') + '"><div class="tw-tile__k">' + label + '</div><div class="tw-tile__v">' + value + '</div></div>';
  }

  /* 그 레포트의 수업일 — 레포트에 저장된 수업일, 없으면 반 일정으로 */
  function lessonDateOf(r, data) {
    var d = (data && data.lessonDate) || (r && r.lesson_date) || '';
    if (!/^\d{4}-\d{2}-\d{2}/.test(d) && r && r.week_start) { var L = lessonOf(r.week_start); d = L && !L.canceled ? L.date : ''; }
    return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? String(d).slice(0, 10) : '';
  }
  function stripDay(n) { return String(n || '').replace(/^\d+\/\d+(\([^)]*\))?\s*/, ''); }

  /* 복습테스트 칸 — 「복습 TEST 8/10 · 화작문 TEST 10/10」 (낸 점수 그대로 · 확인 단계 없음 · 20261030a)
     미응시면 「미응시 · 결석」, 낸 것도 사유도 없이 공개됐으면 「미응시」. 「아직 입력 전」 · 「미제출」은 쓰지 않는다 (비면 칸을 숨긴다)
     낸 것 · 미응시는 hub_review_week(027 · 028 · 030)와 레포트에 담긴 것을 합친다 — 나중에 낸 점수가 있으면 그것이 이긴다 */
  function rvTileHtml(r, data) {
    var mon = mondayOf(r.week_start);
    var got = reviewOfWeek((HUBD && HUBD.review) || [], mon) || [];
    var tests = (data && data.tests) || [];
    var has = function (n) { return got.some(function (x) { return x.name === n; }) || done.indexOf(n) !== -1 || abs.some(function (a) { return a.name === n; }); };
    var done = [], abs = [];
    tests.forEach(function (t) {
      if (!t || t.kind !== 'review' || t.submitted || t.absent || t.score == null) return;
      var n = stripDay(t.name);
      if (n && !has(n)) got.push({ name: n, score: Number(t.score), correct: t.correct, q: t.total, diff: null });
    });
    var live = Array.isArray(RVW[mon]) ? RVW[mon] : null;
    (live || []).forEach(function (x) {
      if (!x || has(x.test_name)) return;
      if (x.status === 'absent') abs.push({ name: x.test_name, reason: x.reason_label || '' });
      else if (x.correct != null && x.q_count != null) got.push({ name: x.test_name, score: null, correct: x.correct, q: x.q_count, diff: null });
      else done.push(x.test_name);         /* 030 전 서버 — 맞은 수가 안 오면 「제출 완료」 */
    });
    tests.forEach(function (t) {
      if (!t || t.kind !== 'review') return;
      var n = stripDay(t.name);
      if (!n || has(n)) return;
      if (t.submitted) done.push(n);
      else if (t.absent) abs.push({ name: n, reason: t.absent });
    });
    if (!got.length && !done.length && !abs.length) return '';
    var dot = '<span class="tw-dot"> · </span>';
    return '<span class="tw-rvs">' + got.map(function (x) {
      var df = x.diff;
      return '<span>' + esc(x.name) + ' <b class="num">' + (x.q != null && x.correct != null ? esc(x.correct) + '/' + esc(x.q) : esc(x.score) + '점') + '</b>' +
        (df > 0 ? ' <span class="tw-up num">▲' + df + '</span>' : df < 0 ? ' <span class="tw-down num">▼' + (-df) + '</span>' : '') + '</span>';
    }).concat(done.map(function (n) {
      return '<span>' + esc(n) + ' <b class="tw-ok">제출 완료</b></span>';
    })).concat(abs.map(function (a) {
      return '<span>' + esc(a.name) + ' <b class="tw-abs">' + esc(ReportView.absentText(a.reason)) + '</b></span>';
    })).join(dot) + '</span>';
  }

  /* 출결 · 집중도 · 복습테스트 칸 — 비어 있는 칸은 숨긴다 (20261030a) */
  function sumHtml(r, data) {
    var a = (data && data.attendance) || {};
    var st = a.status === 'makeup' ? 'attend' : a.status;
    var ATT = { attend: '출석', late: '지각', absent: '결석' };
    var note = String(a.note == null ? '' : a.note).trim();
    var att = ATT[st] ? '<b class="tw-att tw-att--' + st + '">' + ATT[st] + '</b>' + (note ? '<small class="tw-note">' + esc(note) + '</small>' : '') : '';
    var focus = '';
    if (st !== 'absent' && Number(data && data.focusScore) > 0) {
      var sc = Math.max(0, Math.min(5, Math.round(Number(data.focusScore))));
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += '<span class="tw-star' + (i <= sc ? ' is-on' : '') + '">★</span>';
      focus = '<span class="tw-stars" aria-label="5점 만점에 ' + sc + '점">' + stars + '</span>';
    }
    var rv = rvTileHtml(r, data);
    var small = (att ? 1 : 0) + (focus ? 1 : 0);
    var html = (att ? tile('출결', att, small === 1) : '') + (focus ? tile('집중도', focus, small === 1) : '') + (rv ? tile('복습테스트', rv, true) : '');
    if (!html) return '';
    return '<div class="card tw-card rw-sum" id="rwSum"><div class="tw-tiles">' + html + '</div></div>';
  }

  /* 확정된 수업 요약 — 레포트에 수업 내용이 없을 때 「오늘 배운 것」으로 */
  function learnHtml(w) {
    var list = ((w && w.lessons) || []).filter(function (t) { return String(t || '').trim(); });
    if (!list.length) return '';
    var html = lessonsHtml(list).replace('<div class="nt-sub">📖 수업 내용</div>', '');
    return '<div class="card tw-learn' + (list.length > 3 ? ' is-short' : '') + '" id="twLearn">' +
      '<h2 class="card-title">📖 오늘 배운 것</h2>' + html +
      (list.length > 3 ? '<button type="button" class="tw-more" data-tw-more>더 보기 (' + list.length + '차시)</button>' : '') + '</div>';
  }

  /* ============================================================
     배부 자료 · 과제 파일 카드 (20261029i) — 한 줄에 두 개, 정사각형. 필수 과제 → 선택 과제 → 배부 자료 (빈 묶음은 숨김)
       윗부분 = PDF 첫 페이지 그림 · JPG/PNG 는 그 그림 (코치룸이 올릴 때 만든 작은 그림 · migration-029 · class-file 함수 action thumbs)
       그림이 없거나 HWP · DOC · PPT · XLSX 는 종류별 색 아이콘. 아래 = 파일 이름 두 줄 · 「PDF · 2.4MB」. 카드 전체를 누르면 내려받기.
     ============================================================ */
  var FILE_ORDER = [['required', '✏️ 필수 과제'], ['optional', '➕ 선택 과제'], ['material', '📄 배부 자료']];
  var THUMB_EXT = { pdf: 1, jpg: 1, jpeg: 1, png: 1 };
  var EXT_KIND = { pdf: 'pdf', hwp: 'hwp', hwpx: 'hwp', doc: 'doc', docx: 'doc', ppt: 'ppt', pptx: 'ppt', xlsx: 'xls', jpg: 'img', jpeg: 'img', png: 'img' };
  function kindOf(f) { return f.kind === 'required' || f.kind === 'optional' ? f.kind : 'material'; }
  function extName(ext) { ext = String(ext || '').toLowerCase(); return ext === 'jpeg' ? 'JPG' : ext.toUpperCase(); }
  function fileCardHtml(f) {
    var ext = String(f.ext || '').toLowerCase(), kd = kindOf(f);
    return '<button type="button" class="fc fc--' + (EXT_KIND[ext] || 'etc') + '" data-file="' + esc(f.id) + '"' + (THUMB_EXT[ext] ? ' data-thumb="1"' : '') +
             ' aria-label="' + esc(f.name + ' 내려받기') + '">' +
             '<span class="fc__top"><span class="fc__icon" aria-hidden="true">' + esc(extName(ext) || '파일') + '</span>' +
               (kd === 'required' ? '<span class="fc__tag fc__tag--req">필수</span>' : kd === 'optional' ? '<span class="fc__tag fc__tag--opt">선택</span>' : '') + '</span>' +
             '<span class="fc__name">' + esc(f.name) + '</span>' +
             '<span class="fc__meta num">' + esc(extName(ext)) + ' · ' + sizeText(f.bytes) + '</span>' +
           '</button>';
  }
  function filesOf(w) {
    var files = (w && w.files) || [], html = '';
    FILE_ORDER.forEach(function (k) {
      var list = files.filter(function (f) { return kindOf(f) === k[0]; });
      if (list.length) html += '<div class="nt-sub">' + k[1] + '</div><div class="fc-grid">' + list.map(fileCardHtml).join('') + '</div>';
    });
    return html;
  }
  /* 가장 최근 레포트 아래 — 그 수업 말고 다른 주에 올린 과제 · 자료 (예전 「이번 주」의 지난 과제 · 자료) */
  function otherFilesHtml(mon) {
    var other = ((WEEKLY && WEEKLY.weeks) || []).filter(function (x) { return x.week_start && mondayOf(x.week_start) !== mon && (x.files || []).length; });
    if (!other.length) return '';
    return '<details class="card tw-pastfiles"><summary>🗂️ 다른 주 과제 · 자료 <span class="card-note">' + other.length + '주</span></summary>' +
      other.map(function (x) { return '<div class="tw-pastweek"><div class="nt-past__week num">' + esc(weekName(x.week_start)) + '</div>' + filesOf(x) + '</div>'; }).join('') +
      '</details>';
  }

  /* 카드 윗부분 그림 — 10분짜리 서명 주소를 받아 넣는다 (못 받으면 아이콘 카드 그대로) */
  var THUMBS = {};
  function fileThumbs(code, ids) {
    if (PV) return PV.fileThumbs ? PV.fileThumbs(ids) : Promise.resolve({ ok: false });
    return fetch(CFG.supabase.url + '/functions/v1/' + (CFG.fileFunction || 'class-file'), {
      method: 'POST',
      headers: { 'apikey': CFG.supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'thumbs', code: code, ids: ids })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function setThumb(b, url) {
    var top = b.querySelector('.fc__top');
    if (!top || top.querySelector('.fc__img')) return;
    var img = document.createElement('img');
    img.className = 'fc__img';
    img.alt = '';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.onerror = function () { img.remove(); b.classList.remove('has-img'); };
    img.src = url;
    top.insertBefore(img, top.firstChild);
    b.classList.add('has-img');
  }
  function loadThumbs(root, code) {
    if (!root || !code) return;
    var btns = Array.prototype.filter.call(root.querySelectorAll('.fc[data-thumb]'), function (b) { return !b.dataset.thumbDone; });
    if (!btns.length) return;
    var now = Date.now(), need = [];
    btns.forEach(function (b) {
      b.dataset.thumbDone = '1';
      var c = THUMBS[b.dataset.file];
      if (c && now - c.at < 540000) setThumb(b, c.url);
      else if (need.indexOf(b.dataset.file) === -1) need.push(b.dataset.file);
    });
    for (var k = 0; k < need.length; k += 60) {
      fileThumbs(code, need.slice(k, k + 60)).then(function (res) {
        var urls = (res && res.ok && res.urls) || {};
        Object.keys(urls).forEach(function (id) { THUMBS[id] = { url: urls[id], at: Date.now() }; });
        btns.forEach(function (b) { if (urls[b.dataset.file]) setThumb(b, urls[b.dataset.file]); });
      }).catch(function () {});
    }
  }

  /* 그 수업 영상 (수업 영상 탭과 같은 목록에서) */
  function weekVideosHtml(w) {
    var vids = w ? sortVideos((w.videos || []).filter(function (v) { return v && safeUrl(v.url); })) : [];
    if (!vids.length) return '';
    return '<div class="card tw-videos rw-videos"><h2 class="card-title">' + esc(weekName(w.week_start)) + '</h2>' + lessonInfoHtml(w, vids) + '<div class="nt-videos">' + vids.map(weekVideoHtml).join('') + '</div></div>';
  }

  /* 선생님 공지 — 수업일 · 영상 · 자료는 위 칸과 겹치므로 빼고, 공지 글만 */
  function noticeHasText(n) {
    return !!(String(n.special || '').trim() || NOTICE_ROWS.some(function (r) { return String(n[r[0]] || '').trim(); }) ||
      (n.materials || []).some(function (m) { return m && safeUrl(m.url); }) || (n.videos || []).some(function (v) { return v && safeUrl(v.url); }));
  }
  function noticeItems() { return ((HUBD && HUBD.notices) || []).filter(noticeHasText); }
  /* 가장 최근 레포트(과 레포트가 없을 때) — 가장 최근 공지 + 지난 공지(접어서) · 예전 「이번 주」와 같다 */
  function teacherNoticeHtml(items) {
    if (!items.length) return '';
    var latest = items[0];
    return '<div class="card tw-notice" id="twNotice">' +
      '<h2 class="card-title">📢 선생님 공지<span class="card-note">' + esc(weekLabel(latest)) + '</span></h2>' +
      (String(latest.title || '').trim() ? '<p class="nt-title">' + md(latest.title) + '</p>' : '') +
      noticeBodyHtml(latest) +
      (items.length > 1 ? '<details class="tw-pastnotice"><summary>지난 공지 ' + (items.length - 1) + '개</summary><div class="nt-archive">' +
        items.slice(1).map(function (n, i) {
          return '<details class="nt-past" data-i="' + (i + 1) + '"><summary><span class="nt-past__week num">' + esc(weekLabel(n)) + '</span>' +
                 '<span class="nt-past__title">' + md(n.title || '') + '</span></summary><div class="nt-past__body"></div></details>';
        }).join('') + '</div></details>' : '') +
    '</div>';
  }
  /* 지난 레포트 — 그 수업 주의 공지만 */
  function weekNoticeHtml(mon) {
    var n = noticeItems().filter(function (x) { return x.week_start && mondayOf(x.week_start) === mon; })[0];
    if (!n) return '';
    return '<div class="card tw-notice"><h2 class="card-title">📢 선생님 공지<span class="card-note">' + esc(weekLabel(n)) + '</span></h2>' +
      (String(n.title || '').trim() ? '<p class="nt-title">' + md(n.title) + '</p>' : '') + noticeBodyHtml(n) + '</div>';
  }

  /* date 보다 뒤의 첫 수업 (휴강 주는 건너뛴다 · 8주 안) — 과제 상세 탭의 진행 중 기간 */
  function nextLessonAfter(date) {
    if (!WEEKLY || !WEEKLY.schedule || !date) return null;
    var mon = mondayOf(date);
    for (var k = 0; k < 9; k++) {
      var L = lessonOf(plusDays(mon, 7 * k));
      if (L && !L.canceled && L.date && L.date > date) return L;
    }
    return null;
  }

  /* 레포트의 앱 과제 요약 — 그 레포트 수업일 D 기준 「지난 일주일」 D-7 ~ D-1 (20261029h).
     지금 진행 중인 주(D ~ 다음 수업 전날)는 「과제 상세」 탭에서만. 수업일을 모르는 예전 레포트는 저장된 과제 기간으로 */
  function drawReportApp(box, code, r, data, idx) {
    if (!box) return;
    if (!(APP.info && APP.info.linked)) { box.innerHTML = ''; return; }
    var ld = lessonDateOf(r, data);
    if (data && data.startOn) HUBSTART = String(data.startOn).slice(0, 10);
    box.innerHTML = appWaitHtml();
    appWaitSlow(box);
    APP_RETRY.report = function () { drawReportApp(box, code, r, data, idx); };
    appData(code).then(function (dd) {
      if (RP.cur !== idx) return;
      if (!dd) {
        box.innerHTML = appFailHtml('report');      /* 멈춰 있지 않고 다시 시도 (20261031b) */
        return;
      }
      if (ld) box.innerHTML = reportAppHtml(dd, ld);
      else {
        var L = lessonOf(r.week_start) || {};
        var from = data.hwFrom || L.hwFrom, to = data.hwTo || L.hwTo;
        var aw = from && to ? AppWeek.compute(dd, from, to, todayISO()) : null;
        box.innerHTML = aw && aw.any ? appBlockHtml(dd, aw, { title: periodTitle('과제 기간', from, to), month: to.slice(0, 7) }) : '';
      }
      /* 과제 요약 칸 아래 작은 한 줄 — 「앱에서 자세히 보기 ↗」 */
      if (box.innerHTML) box.innerHTML += appMoreHtml(APP.info, true);
      animateRings(box);
    });
  }

  /* ============================================================
     복습 노트 (review-note.js · migration-039 · 20261031l) — 확정된 노트만 (hub_review_notes · 그 학생 반)
       레포트 수업 영상 아래 「이번 수업 복습 노트」 칸 · 레포트 위 줄 「복습 노트 모음」(수업일 순 목록)
       학생 링크로 열면 「연 학생」 숫자에만 남는다 (hub_review_note_open · 학부모 링크 · 미리보기는 남기지 않는다)
       OX 결과는 이 기기에만 (review-note.js) — 학부모 화면에는 풀었는지 · 점수가 없다
     ============================================================ */
  var RN = { code: '', p: null, list: [] };
  function notesOf(code) {
    if (RN.code !== code || !RN.p) {
      RN.code = code;
      RN.p = Promise.resolve().then(function () { return rpc('hub_review_notes', { p_code: code }); })
        .then(function (l) { RN.list = Array.isArray(l) ? l.filter(function (x) { return x && x.note; }) : []; return RN.list; }, function () { RN.list = []; return []; });
    }
    return RN.p;
  }
  function noteRole() { return (PV ? PV.role : HUBD && HUBD.role) === 'student' ? 'student' : 'parent'; }
  function openNote(code, week) {
    if (!global.ReviewNote) return;
    var it = RN.list.filter(function (x) { return x.week_start === week; })[0];
    if (!it) return;
    ReviewNote.open(it, {
      role: noteRole(),
      onOpen: function (item) {
        if (PV || noteRole() !== 'student') return;
        Promise.resolve().then(function () { return rpc('hub_review_note_open', { p_code: code, p_week: item.week_start }); }).catch(function () {});
      }
    });
  }
  /* 그 레포트 수업의 노트 칸 (확정하지 않은 수업은 칸 없음) */
  function drawNote(code, r, idx) {
    var box = $('#rwNote');
    if (!box || !global.ReviewNote) return;
    var mon = mondayOf(r.week_start);
    notesOf(code).then(function (list) {
      if (RP.cur !== idx) return;
      var it = list.filter(function (x) { return mondayOf(x.week_start) === mon; })[0];
      box.innerHTML = it ? ReviewNote.cardHtml(it) : '';
    });
  }
  function showNotesList(code) {
    var box = $('#reportNotes'), view = $('#reportView');
    if (!box) return;
    box.hidden = false;
    if (view) view.hidden = true;
    var body = $('#reportNotesBody');
    body.innerHTML = '<p class="hub-muted">불러오는 중…</p>';
    notesOf(code).then(function (list) { body.innerHTML = ReviewNote.listHtml(list); });
    window.scrollTo(0, 0);
  }

  /* 레포트 한 편 — latest: 가장 최근 레포트 (다른 주 과제 · 자료와 지난 공지까지) */
  /* 공개한 뒤 고쳐 다시 공개했을 때 — 「10/24 업데이트 · 복습테스트 결과 추가」 (코치룸 publish.js 가 report_data._upd 에 남긴다 · 바뀐 게 없으면 없음 · 20261030e) */
  function updHtml(u) {
    if (!u || !/^\d{4}-\d{2}-\d{2}/.test(String(u.date || '')) || !String(u.what || '').trim()) return '';
    return '<p class="rw-upd">' + esc(Lesson.md(String(u.date).slice(0, 10), false) + ' 업데이트 · ' + String(u.what).trim()) + '</p>';
  }
  function reportHtml(r, data, latest) {
    var ld = lessonDateOf(r, data);
    var d2 = {};
    Object.keys(data || {}).forEach(function (k) { d2[k] = data[k]; });
    if (!d2.lessonDate && ld) d2.lessonDate = ld;
    var mon = mondayOf(r.week_start);
    var w = weekOf(mon);
    var hasLessons = (d2.lessons || []).some(function (t) { return String(t || '').trim(); });
    var files = filesOf(w);
    return (r.draft ? '<div class="pv-draft">아직 공개 전 — 지금 작성 내용으로 공개하면 이렇게 보입니다</div>' : '') +
      ReportView.partsHtml(d2, ['header'], { noPeriod: true }) +
      updHtml(d2._upd) +
      sumHtml(r, d2) +
      '<div id="rwNotes"></div>' +
      '<div id="rwApp"></div>' +
      (hasLessons ? ReportView.partsHtml(d2, ['lessons']) : learnHtml(w)) +
      ReportView.partsHtml(d2, ['comment']) +
      weekVideosHtml(w) +                         /* 이 수업 영상 — 선생님 한마디 바로 아래 (영상이 없으면 칸 없음 · 20261030b) */
      '<div id="rwNote"></div>' +                 /* 이번 수업 복습 노트 — 확정된 노트가 있을 때만 (20261031l) */
      (files ? '<div class="card tw-files rw-files"><h2 class="card-title">✏️ 이 수업 과제 · 자료</h2>' + files + '</div>' : '') +
      (latest ? otherFilesHtml(mon) : '') +
      (latest ? teacherNoticeHtml(noticeItems()) : weekNoticeHtml(mon)) +
      ReportView.partsHtml(d2, ['student']) +
      contactHtml();
  }

  /* 문의 안내 (20261031w · migration-049) — 레포트 맨 아래 · 학생 · 학부모 · 미리보기 같다
     [문의하기] = 코치룸 설정의 「문의 연락처(카카오채널 링크)」 · 비어 있으면 버튼 없이 문구만 · 전화번호는 쓰지 않는다 */
  var CONTACT_TEXT = '수정하실 내용이나 궁금한 점은 카카오톡 채널 \'jh국어연구소\'로 언제든 편하게 문의해 주세요.';
  var CONTACT = { url: null, p: null };
  function contactHtml() {
    if (CONTACT.url === null && !CONTACT.p) {
      CONTACT.p = Promise.resolve().then(function () { return rpc('hub_contact', {}); }).then(function (u) {
        CONTACT.url = /^https:\/\/[^\s<>"]{4,300}$/.test(String(u || '')) ? String(u) : '';
      }, function () { CONTACT.url = ''; }).then(function () {
        Array.prototype.forEach.call(document.querySelectorAll('.rw-contact'), function (el) { el.outerHTML = contactHtml(); });
      });
    }
    return '<div class="card rw-contact"><p class="rw-contact__t">' + esc(CONTACT_TEXT) + '</p>' +
      (CONTACT.url ? '<a class="hub-btn rw-contact__btn" href="' + esc(CONTACT.url) + '" target="_blank" rel="noopener">문의하기</a>' : '') + '</div>';
  }

  /* ============================================================
     막혔을 때 보여 줄 화면
     ============================================================ */

  function stopScreen(root, kind) {
    var msg = {
      nocode:   '주소가 올바르지 않습니다.<br>받으신 링크를 다시 눌러 주세요.<br><a class="hub-btn hub-entry-link" href="../s/">학생은 여기에서 로그인</a>',
      notfound: '링크를 찾을 수 없습니다.<br>받으신 링크가 맞는지 확인해 주세요.',
      closed:   '더 이상 열 수 없는 링크입니다.<br>궁금한 점은 아래 문의처로 연락해 주세요.',
      network:  '불러오지 못했습니다.<br>인터넷 연결을 확인하고 새로고침해 주세요.'
    }[kind] || '불러오지 못했습니다.';
    root.innerHTML = '<div class="empty">' + msg + '</div>';
  }

  /* ============================================================
     개인 페이지 /me/
     ============================================================ */

  function parseHash() {
    var h = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
    var parts = h.split('/');
    return { code: parts[0] || '', view: parts[1] || '', arg: parts[2] || '' };
  }

  /* ============================================================
     뒤로가기 (개인 페이지) — 탭 · 레포트 한 편 · 크게 보기 사진마다 기록
       주소: #코드(레포트) · #코드/reports(누적 추이) · #코드/report/주차 · #코드/app · #코드/photo(/날짜) · #코드/book
         · #코드/review(복습테스트 입력 카드 바로) · #코드/todo/날짜(복습테스트 입력 + 「필기 사진도 올려 주세요」) — 수업 끝 필기·복습 문자 링크 (migration-056)
       # 바로 뒤의 개인 링크 코드는 절대 바꾸지 않는다 (뒤에 /보기 만 붙였다 뗐다 한다)
       코치룸 미리보기(틀 안)에서는 기록하지 않는다 — 코치룸 뒤로가기를 흐트러뜨리지 않게
     ============================================================ */
  var nav = { on: false, code: '', ignore: 0, apply: null };
  function navHash(v, arg) {
    return '#' + nav.code + (v && v !== 'notice' && v !== 'week' ? '/' + v + (arg ? '/' + arg : '') : '');
  }
  function navPush(v, arg) {
    if (!nav.on) return;
    var hh = navHash(v, arg);
    if (location.hash === hh) return;
    history.pushState({ hub: { v: v, arg: arg || '' }, p: 1 }, '', hh);     /* p = 이 페이지 안에서 쌓은 기록 */
  }
  function lightboxOpen() { return document.querySelector('.ph-light'); }

  /* 알림톡 버튼은 /me/?c=코드 로 연다 (알림톡 변수 #{…} 와 # 주소가 겹쳐서). 열리면 #코드 주소로 바꾼다 */
  function fromQuery() {
    var m = /[?&]c=([A-Za-z0-9]{20,64})(?:&|$)/.exec(global.location.search || '');
    if (!m || PV) return;
    try { history.replaceState(null, '', global.location.pathname + '#' + m[1]); } catch (e) { global.location.hash = m[1]; }
  }

  function bootMe() {
    if (PV) { APP.p = null; RN.p = null; RN.list = []; }                  /* 코치룸 미리보기 — 열 때마다 과제 기록 · 고친 값을 새로 (20261031j) */
    fromQuery();
    var root = $('#hubRoot');
    var head = $('#hubHead');
    var tabs = $('#hubTabs');
    var h = parseHash();

    /* 학생 입구(/s/)에서 로그인해 둔 기기 — 주소에 코드가 없으면 남겨 둔 학생 링크로 (migration-024) */
    var EL = PV ? null : global.EntryLogin;
    if (!PV && !/^[A-Za-z0-9]{20,64}$/.test(h.code) && EL && EL.get()) {
      try { history.replaceState(null, '', global.location.pathname + '#' + EL.get()); } catch (e) { global.location.hash = EL.get(); }
      h = parseHash();
    }

    if (PV) { h = { code: 'preview', view: PV.view || '', arg: PV.arg || '' }; previewBand(); }
    else if (!/^[A-Za-z0-9]{20,64}$/.test(h.code)) { stopScreen(root, 'nocode'); return; }

    rpc('hub_get', { p_code: h.code }).then(function (d) {
      if (PV) previewBand();          /* 공개 여부를 안 뒤 띠 글을 다시 */
      if (!d || !d.ok) {
        /* 남겨 둔 로그인이 더 이상 열리지 않으면(재발급 · 퇴원) 지우고 입구 안내 */
        if (EL && EL.get() === h.code) EL.clear();
        stopScreen(root, (d && d.reason) || 'notfound');
        return;
      }

      /* 학생 링크 · 학부모 링크 (migration-015). 015 전에는 role 이 없다 — 예전처럼 모두 입력 가능 */
      var canWrite = d.can_write !== false;
      roleTag(d.role);
      if (EL && EL.get() === h.code) logoutButton(EL);

      var st = d.student || {};
      $('#hubName').textContent = (st.name || '') + ' 학생의 러닝노트';
      $('#hubMeta').textContent = [st.class_name, st.school, st.grade].filter(Boolean).join(' · ');
      renderDday(d.exam, (st.name || '') + ' 학생');
      head.hidden = false;
      tabs.hidden = false;
      setTitle(global.BRAND ? BRAND.noteTitle : '마라톤국어 러닝노트');

      /* 탭 네 개 — 레포트 · 수업 영상 · 과제 상세 · 내 필기 (교재비는 청구서가 있을 때만 · 20261029i)
         예전 「이번 주」 · 「내 레포트」는 「레포트」 하나로 합쳤다 */
      root.innerHTML =
        '<section class="hub-panel" id="panelReport" role="tabpanel"></section>' +
        '<section class="hub-panel" id="panelVideo" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelApp" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelBook" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelPhoto" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelInfo" role="tabpanel" hidden></section>';

      WEEKLY = d.weekly || null;
      APP.info = d.app || null;
      HUBD = d;

      /* 레포트 — 새 레포트 알림 빨간 점은 탭을 눌러 볼 때까지 */
      var reports = d.reports || [];
      renderReportList(h.code, reports, d.draft || null);
      if (reports.length) $('#tabReport').classList.add('has-new');

      /* 수업 영상 — 영상이 있을 때만 탭이 보인다 */
      var hasVideos = videoWeeks().length > 0;
      var tabVideo = $('#tabVideo');
      if (tabVideo) tabVideo.hidden = !hasVideos;
      var videoOpened = false;
      function openVideos() {
        if (videoOpened) return;
        videoOpened = true;
        renderVideos($('#panelVideo'));
      }

      /* 복습테스트 (migration-013) — 수업일 당일 레포트 탭 맨 위 기록 카드, 누적 추이 화면 점수 그래프.
         기록 카드와 최근 내 기록은 입력할 수 있는 링크(학생 링크)에서만 */
      if (global.ReviewCard) {
        ReviewCard.history($('#reviewHist'), d.review || [], []);
        if (canWrite) {
          ReviewCard.bind($('#reviewCard'));
          ReviewCard.mount($('#reviewCard'), h.code, function (rv) {
            ReviewCard.history($('#reviewHist'), d.review || [], rv ? rv.recent : []);
            /* 제출 기간이고 아직 안 냈으면 큰 [복습테스트 입력하기] → 누르면 입력 카드. 냈으면 「제출함」 카드 그대로 */
            var btn = $('#twRvBtn'), card = $('#reviewCard');
            if (!btn || !card) return;
            /* 시험 여러 개 (migration-025) — 하나라도 냈으면 카드를 그대로 (남은 시험도 거기서 낸다) */
            var open = !!(rv && ((rv.tests && rv.tests.length) || rv.test));
            if (!open) { btn.hidden = true; card.hidden = true; return; }
            var anySub = !!rv.submission || (rv.tests || []).some(function (t) { return t.submission; });
            /* 선생님이 미응시로 둔 시험만 남았으면 입력하라고 띄우지 않는다 (migration-028) */
            var left = rv.tests ? ReviewCard.pendingOf(rv).length : (rv.submission ? 0 : 1);
            if (anySub) { btn.hidden = true; card.hidden = false; }
            else if (!left) { btn.hidden = true; card.hidden = true; }
            else if (card.hidden) btn.hidden = false;
            rvLast = { left: left, any: anySub };
            rvShow();
          });
        }
      }

      /* 문자 링크 #코드/review · #코드/todo/날짜 — 남은 복습테스트가 있으면 입력 카드를 바로 연다 (한 번만) */
      var rvLast = null, rvWant = null;
      function rvShow() {
        if (!rvWant || !rvLast) return;
        var btn = $('#twRvBtn'), card = $('#reviewCard'), top = $('#rvTop');
        if (!btn || !card || !top) return;
        if (rvLast.left || rvLast.any) { btn.hidden = true; card.hidden = false; }
        var old = $('#twTodo'); if (old) old.remove();
        if (rvWant.photo) top.insertAdjacentHTML('afterbegin', '<div class="tw-todo" id="twTodo"><span>📷 오늘 필기 사진도 올려 주세요</span>' +
          '<button type="button" class="tw-todo__btn" data-photo-go="' + esc(rvWant.photo) + '">필기 올리기</button></div>');
        var go = (rvLast.left || rvLast.any) ? card : top;
        if (go.scrollIntoView) go.scrollIntoView({ block: 'start' });
        rvWant = null;
      }

      /* 과제 상세 (예전 「앱 과제」) — 처음 열 때 불러온다 */
      var appLoaded = null;
      function openApp() {
        var b = appBaseDate(d.reports || []);
        if (appLoaded === b) return;
        appLoaded = b;
        renderApp(h.code, d.app || {}, d.reports || [], b);
      }

      /* 내 필기 (예전 「필기 노트」) — date 가 있으면 그 수업일 칸으로 */
      var photoOpened = false;
      function openPhoto(date) {
        if (!global.Photos) return;
        var host = $('#panelPhoto');
        if (photoOpened) { if (date && host.phFocus) host.phFocus(date); return; }
        photoOpened = true;
        Photos.renderTab(host, h.code, { readOnly: !canWrite, focus: date || '' });
      }

      /* 내 정보 — 학생 링크(/s/ 로그인)에서만 (학부모 링크 · 반 공용 링크 · 코치룸 미리보기에는 없다 · 20261031c) */
      var tabInfo = $('#tabInfo');
      var infoOn = !PV && d.role === 'student' && !!global.MeInfo;
      if (tabInfo) tabInfo.hidden = !infoOn;
      var infoOpened = false;
      function openInfo() {
        if (infoOpened || !infoOn) return;
        infoOpened = true;
        MeInfo.render($('#panelInfo'), h.code, rpc);
      }

      /* 탭 수에 맞춰 칸을 나눈다 (교재비 탭은 청구서가 있을 때만) */
      function layoutTabs() {
        var n = Array.prototype.filter.call(tabs.querySelectorAll('.hub-tab'), function (b) { return !b.hidden; }).length;
        tabs.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
        tabs.classList.toggle('hub-tabs--many', n >= 5);
        tabs.classList.toggle('hub-tabs--six', n >= 6);
      }
      layoutTabs();

      function select(which) {
        if (which === 'week') which = 'report';
        if (which === 'video' && !(tabVideo && !tabVideo.hidden)) which = 'report';
        closePlayers(null);
        [['report', '#tabReport', '#panelReport'],
         ['video',  '#tabVideo',  '#panelVideo'],
         ['app',    '#tabApp',    '#panelApp'],
         ['photo',  '#tabPhoto',  '#panelPhoto'],
         ['book',   '#tabBook',   '#panelBook'],
         ['info',   '#tabInfo',   '#panelInfo']].forEach(function (t) {
          if (!$(t[1]) || !$(t[2])) return;
          var on = t[0] === which;
          $(t[1]).setAttribute('aria-selected', on ? 'true' : 'false');
          $(t[2]).hidden = !on;
        });
        if (which === 'app') openApp();
        if (which === 'photo') openPhoto('');
        if (which === 'video') openVideos();
        if (which === 'info') openInfo();
      }

      /* 레포트 — 가장 최근 수업 레포트를 바로 연다 (위 한 줄 ◀ ▶ · 수업일 목록으로 다른 수업) */
      $('#tabReport').onclick = function () {
        $('#tabReport').classList.remove('has-new');
        select('report'); showLatest(); navPush('week');
      };
      if (tabVideo) tabVideo.onclick = function () { select('video'); navPush('videos'); };
      $('#tabApp').onclick    = function () { select('app'); navPush('app'); };
      $('#tabBook').onclick   = function () { select('book'); navPush('book'); };
      $('#tabPhoto').onclick  = function () { select('photo'); navPush('photo'); };
      if (tabInfo) tabInfo.onclick = function () { select('info'); navPush('info'); };
      /* 레포트 「오늘 수업 필기」의 「내 필기에서 전체 보기」 → 내 필기 탭의 그 날짜 */
      $('#panelReport').addEventListener('click', function (e) {
        var g = e.target.closest('[data-photo-go]');
        if (!g) return;
        var date = g.getAttribute('data-photo-go');
        select('photo'); openPhoto(date); navPush('photo', date);
      });

      /* 뒤로가기 — 주소(#코드/보기)를 보고 그 화면으로
         예전 주소도 새 탭으로: #코드/notice · /week · /this-week → 레포트, /app → 과제 상세, /photo → 내 필기 */
      nav.code = h.code;
      nav.on = !PV;
      nav.apply = function (v, arg) {
        if (v === 'report' && arg) {
          select('report');
          var rr = reports.find(function (x) { return x.week_start === arg; });
          if (rr) openReport(h.code, rr); else showLatest();
        } else if (v === 'reports') { select('report'); showReportList(); }
        else if (v === 'videos' || v === 'video') select('video');
        else if (v === 'app') select('app');
        else if (v === 'photo') { select('photo'); if (arg) openPhoto(arg); }
        else if (v === 'review' || v === 'todo') {
          select('report'); showLatest();
          rvWant = { photo: v === 'todo' ? (/^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) : '' };
          rvShow();
        }
        else if (v === 'book' && !$('#tabBook').hidden) select('book');
        else if (v === 'info' && infoOn) select('info');
        else { select('report'); showLatest(); }
      };
      if (/^(notice|week|this-week|thisweek)$/.test(h.view)) { h.view = ''; h.arg = ''; if (nav.on) history.replaceState(null, '', navHash('week')); }
      if (h.view === 'report' && !h.arg) h.view = '';
      if (nav.on) history.replaceState({ hub: { v: h.view || 'week', arg: h.arg || '' } }, '', location.hash);
      nav.apply(h.view || 'week', h.arg || '');

      /* 교재비 — 청구서가 있는 학생에게만 탭이 보인다.
         2단계 SQL 을 아직 안 돌렸거나 실패해도 다른 탭은 그대로 쓴다. */
      rpc('hub_textbook', { p_code: h.code }).then(function (tb) {
        if (!tb || !tb.ok || !(tb.bills || []).length) return;
        renderBook(tb);
        $('#tabBook').hidden = false;
        layoutTabs();
        if (tb.unpaid_total > 0) $('#tabBook').classList.add('has-new');
        if (h.view === 'book') select('book');
      }).catch(function () {});
    }).catch(function () { stopScreen(root, 'network'); });
  }

  /* ---------- 교재비 ---------- */

  var BK_STATUS = { unpaid: '미납', paid: '납부 완료', waived: '면제' };
  var BK_METHOD = { transfer: '계좌이체', card: '현장 카드', payssam: '결제선생' };

  function won(n) { return (Math.round(Number(n) || 0)).toLocaleString('ko-KR') + '원'; }
  function signedWon(n) {
    n = Math.round(Number(n) || 0);
    return (n < 0 ? '− ' : '+ ') + Math.abs(n).toLocaleString('ko-KR') + '원';
  }
  function monthLabel(m) {
    var x = /^(\d{4})-(\d{2})/.exec(m || '');
    return x ? x[1] + '년 ' + (+x[2]) + '월' : '';
  }
  function shortDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
    function fallback() {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove();
        ok ? resolve() : reject(new Error('copy'));
      });
    }
  }

  function flash(msg) {
    var el = document.createElement('div');
    el.className = 'bk-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1800);
  }

  function renderBook(tb) {
    var host = $('#panelBook');
    var bank = tb.bank || null;
    var unpaid = tb.unpaid_total || 0;
    var html = '';

    if (unpaid > 0) {
      html += '<div class="card bk-due">' +
        '<h2 class="card-title">💳 납부하실 교재비</h2>' +
        '<div class="bk-due__amount num">' + won(unpaid) + '</div>';
      if (bank && bank.account) {
        html += '<div class="bk-bank">' +
            '<div class="bk-bank__row"><span class="bk-bank__label">은행</span><span>' + esc(bank.bank) + '</span></div>' +
            '<div class="bk-bank__row"><span class="bk-bank__label">계좌번호</span><span class="num">' + esc(bank.account) + '</span></div>' +
            (bank.holder ? '<div class="bk-bank__row"><span class="bk-bank__label">예금주</span><span>' + esc(bank.holder) + '</span></div>' : '') +
          '</div>' +
          '<div class="bk-copy">' +
            '<button type="button" class="hub-btn bk-btn" data-copy="' + esc(String(bank.account).replace(/[^\d-]/g, '')) + '" data-msg="계좌번호를 복사했습니다">계좌번호 복사</button>' +
            '<button type="button" class="hub-btn bk-btn bk-btn--ghost" data-copy="' + unpaid + '" data-msg="금액을 복사했습니다">금액 복사</button>' +
          '</div>';
      } else {
        html += '<p class="hub-muted">납부 방법은 선생님 안내를 확인해 주세요.</p>';
      }
      html += '</div>';
    } else {
      html += '<div class="card bk-done"><h2 class="card-title">💳 교재비</h2>' +
              '<p class="bk-done__msg">모든 교재비 납부가 완료되었습니다. 감사합니다 😊</p></div>';
    }

    html += (tb.bills || []).map(function (b) {
      var items = (b.items || []).map(function (it) {
        return '<li class="bk-item"><span class="bk-item__name">' + esc(it.name) +
                 ' <span class="bk-item__qty num">' + it.qty + (it.kind === 'single' ? '권' : '회') + ' × ' + won(it.unit_price) + '</span></span>' +
               '<span class="bk-item__amt num">' + won(it.amount) + '</span></li>';
      }).join('');
      if (b.carry_in) {
        items += '<li class="bk-item bk-item--sub"><span class="bk-item__name">지난 선불 차액</span>' +
                 '<span class="bk-item__amt num">' + signedWon(b.carry_in) + '</span></li>';
      }
      if (b.adjust) {
        items += '<li class="bk-item bk-item--sub"><span class="bk-item__name">조정' +
                 (b.adjust_reason ? ' · ' + esc(b.adjust_reason) : '') + '</span>' +
                 '<span class="bk-item__amt num">' + signedWon(b.adjust) + '</span></li>';
      }
      var refunds = (b.refunds || []).map(function (r) {
        return '<div class="bk-refund">환불 ' + won(r.amount) + ' · ' +
               (r.status === 'done' ? '완료' + (r.done_at ? ' (' + shortDT(r.done_at) + ')' : '') : '진행 중') + '</div>';
      }).join('');
      return '<div class="card bk-bill">' +
        '<h2 class="card-title">' + esc(monthLabel(b.month)) + ' 교재비' +
          (b.status === 'unpaid' && !b.total
            ? '<span class="bk-status">납부할 금액 없음</span>'
            : '<span class="bk-status bk-status--' + esc(b.status) + '">' + (BK_STATUS[b.status] || '') + '</span>') + '</h2>' +
        '<ul class="bk-items">' + (items || '<li class="bk-item"><span class="hub-muted">내역 없음</span></li>') + '</ul>' +
        '<div class="bk-total"><span>합계</span><span class="num">' + won(b.total) + '</span></div>' +
        (b.status === 'paid'
          ? '<div class="bk-paid">' + shortDT(b.paid_at) + ' · ' + (BK_METHOD[b.pay_method] || '') + ' 납부</div>' : '') +
        refunds +
      '</div>';
    }).join('');

    host.innerHTML = html;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy]');
      if (!btn) return;
      copyText(btn.dataset.copy).then(function () { flash(btn.dataset.msg); })
        .catch(function () { flash('복사하지 못했습니다. 길게 눌러 복사해 주세요'); });
    });
  }

  /* ---------- 「레포트」 탭 (20261029i) ---------- */

  /* 공개된 레포트 목록 (최신이 앞. 코치룸 미리보기의 '공개 전' 은 맨 앞) · latest = 가장 최근 공개 레포트 */
  var RP = { code: '', list: [], cur: -1, latest: -1, data: null, r: null };

  function firstHtml() {
    return '<div class="card tw-card tw-card--first" id="twCard"><p class="tw-first">첫 레포트는 첫 수업 날 올라옵니다</p></div>' +
      teacherNoticeHtml(noticeItems());
  }

  function renderReportList(code, reports, draft) {
    var host = $('#panelReport');
    if (draft) reports = [{ week_start: draft.week_start, week_end: draft.week_end, lesson_date: draft.lesson_date || '', draft: true }].concat(reports);
    RP.code = code; RP.list = reports; RP.cur = -1;
    RP.latest = -1;
    for (var k = 0; k < reports.length; k++) if (!reports[k].draft) { RP.latest = k; break; }
    host.innerHTML =
      '<div id="rvTop"><button type="button" class="tw-rv-btn" id="twRvBtn" hidden>📝 복습테스트 입력하기</button><div id="reviewCard" hidden></div></div>' +
      '<div id="reportView">' +
        '<div class="rw-nav" id="reportNav"></div>' +
        '<div id="reportBody">' + (reports.length ? '' : firstHtml()) + '</div>' +
      '</div>' +
      '<div id="reportNotes" class="rn-all" hidden>' +
        '<button type="button" class="hub-back" id="notesBack">‹ 레포트로</button>' +
        '<div class="card"><h2 class="card-title">📒 복습 노트 모음<span class="card-note">수업일 순서</span></h2><div id="reportNotesBody"></div></div>' +
      '</div>' +
      '<div id="reportOverview" hidden>' +
        '<button type="button" class="hub-back" id="reportBack">‹ 레포트로</button>' +
        '<div id="reviewHist"></div>' +
        '<div id="trendCard"></div>' +
        (reports.length
          ? '<div class="card" id="reportListCard">' +
              '<h2 class="card-title">🗓️ 수업 레포트<span class="card-note">' + reports.length + '편</span></h2>' +
              '<ul class="rp-list">' + reports.map(function (r, i) {
                return '<li><button type="button" class="rp-item' + (r.draft ? ' rp-item--draft' : '') + '" data-i="' + i + '">' +
                         '<span class="rp-item__week num">' + esc(reportLabel(r)) + '</span>' +
                         '<span class="rp-item__label">' + (r.draft ? '공개하면 이렇게 보입니다 (미리보기)' : '레포트')     /* 「10/15(목) 수업 레포트」 — 「수업 수업 레포트」로 겹치지 않게 (20261030b) */ + '</span>' +
                         (i === RP.latest ? '<span class="rp-item__new">NEW</span>' : '') +
                         '<span class="rp-item__go" aria-hidden="true">›</span>' +
                       '</button></li>';
              }).join('') + '</ul>' +
            '</div>'
          : '') +
      '</div>' +
      kakaoNoteHtml() + homeGuideHtml();

    loadTrend(code);
    /* 확정된 복습 노트가 있으면 위 줄에 「복습 노트 모음」 */
    if (global.ReviewNote) notesOf(code).then(function (l) { if (l.length && RP.cur !== -1 && !document.querySelector('[data-rw-notes]')) drawReportNav(RP.cur); });
    bindArchive(host, noticeItems());
    bindFiles(host, code);

    host.addEventListener('toggle', function (e) {
      if (e.target.classList && e.target.classList.contains('tw-pastfiles') && e.target.open) loadThumbs(e.target, code);
    }, true);
    host.addEventListener('click', function (e) {
      var b = e.target.closest('.rp-item');
      if (b) {
        var rp = reports[+b.dataset.i];
        openReport(code, rp);
        if (!rp.draft) navPush('report', rp.week_start);
        return;
      }
      /* 가운데 수업일 — 공개된 수업일 목록을 작게 펼친다 */
      if (e.target.closest('#rwNow')) {
        var pick = $('#rwPick'), now = $('#rwNow');
        if (pick) { pick.hidden = !pick.hidden; now.setAttribute('aria-expanded', String(!pick.hidden)); }
        return;
      }
      /* ◀ 지난주 · 다음주 ▶ · 목록에서 고르기 — 같은 화면 안에서 수업만 바꾼다 (주소는 바꾸되 기록은 쌓지 않는다) */
      var w = e.target.closest('[data-rw]');
      if (w && !w.disabled) {
        var i = +w.dataset.rw;
        if (reports[i]) { openReport(code, reports[i]); navReplace(reports[i]); }
        return;
      }
      /* 복습 노트 — 레포트 칸 · 모음 목록에서 열기 · 모음 (20261031l) */
      var rno = e.target.closest('[data-rn-open]');
      if (rno) { openNote(code, rno.dataset.rnOpen); return; }
      if (e.target.closest('[data-rw-notes]')) { showNotesList(code); return; }
      if (e.target.closest('#notesBack')) { $('#reportNotes').hidden = true; $('#reportView').hidden = false; return; }
      if (e.target.closest('[data-rw-trend]')) {
        showReportList(); navPush('reports');
        var tc = $('#trendCard'); if (tc && tc.scrollIntoView) tc.scrollIntoView({ block: 'start' });
        return;
      }
      var tp = e.target.closest('[data-tw]');
      if (tp) {
        var k2 = indexOfWeek(tp.getAttribute('data-tw'));
        if (k2 !== -1) { openReport(code, reports[k2]); navPush('report', reports[k2].week_start); }
        return;
      }
      if (e.target.closest('[data-tw-more]')) {
        var c = $('#twLearn'); if (c) c.classList.remove('is-short');
        e.target.closest('[data-tw-more]').remove();
        return;
      }
      if (e.target.closest('#twRvBtn')) {
        $('#twRvBtn').hidden = true;
        $('#reviewCard').hidden = false;
        var rc = $('#reviewCard'); if (rc.scrollIntoView) rc.scrollIntoView({ block: 'start' });
        return;
      }
      if (e.target.closest('#reportBack')) {
        /* 레포트로 — 뒤로가기 기록이 누적 추이면 뒤로가기와 같게 */
        var hs = nav.on && history.state;
        if (hs && hs.p && hs.hub && hs.hub.v === 'reports') history.back();
        else { showLatest(); if (nav.on) history.replaceState({ hub: { v: 'week', arg: '' }, p: hs && hs.p }, '', navHash('week')); }
      }
    });
  }

  /* 누적 추이 (전체 수업 · 복습테스트 점수 그래프) */
  function showReportList() {
    var ov = $('#reportOverview'), view = $('#reportView');
    if (ov) ov.hidden = false;
    if (view) view.hidden = true;
    RP.cur = -1;
    closePlayers(null);
  }
  /* 가장 최근 공개 레포트 (레포트가 없으면 「첫 레포트는 첫 수업 날 올라옵니다」) */
  function showLatest() {
    var r = RP.list[RP.latest] || RP.list[0];
    if (r) { openReport(RP.code, r); return; }
    var ov = $('#reportOverview'), view = $('#reportView');
    if (ov) ov.hidden = true;
    if (view) view.hidden = false;
  }

  function indexOfWeek(week) {
    for (var i = 0; i < RP.list.length; i++) if (!RP.list[i].draft && RP.list[i].week_start === week) return i;
    return -1;
  }
  function navReplace(r) {
    if (!nav.on) return;
    var hh = r.draft ? navHash('week') : navHash('report', r.week_start);
    var p = history.state && history.state.p;
    history.replaceState({ hub: r.draft ? { v: 'week', arg: '' } : { v: 'report', arg: r.week_start }, p: p }, '', hh);
  }

  /* 한 줄 — ◀ 지난주 · [10/22(목) 수업 ▾] · 다음주 ▶ · 누적 추이 (목록은 최신이 앞이므로 '지난주' = 다음 칸)
     가운데를 누르면 공개된 수업일 목록. 주 시작일은 쓰지 않는다 */
  function reportNavHtml(i) {
    var L = RP.list, n = L.length;
    if (!n) return '';
    var cur = L[i] || L[0];
    var name = function (r) { return (r.draft ? '공개 전 · ' : '') + reportLabel(r); };
    return '<div class="rw-bar">' +
             '<button type="button" class="rw-arrow" data-rw="' + (i + 1) + '"' + (i + 1 >= n ? ' disabled' : '') + ' aria-label="지난 수업 레포트">◀ 지난주</button>' +
             '<button type="button" class="rw-now num" id="rwNow" aria-haspopup="listbox" aria-expanded="false"' + (n < 2 ? ' disabled' : '') + '>' +
               esc(name(cur)) + (n > 1 ? '<span class="rw-caret" aria-hidden="true">▾</span>' : '') + '</button>' +
             '<button type="button" class="rw-arrow" data-rw="' + (i - 1) + '"' + (i - 1 < 0 ? ' disabled' : '') + ' aria-label="다음 수업 레포트">다음주 ▶</button>' +
             '<button type="button" class="rw-trend" data-rw-trend>누적 추이</button>' +
           '</div>' +
           (RN.list.length ? '<div class="rw-bar2"><button type="button" class="rw-notes" data-rw-notes>📒 복습 노트 모음</button></div>' : '') +
           (n > 1 ? '<div class="rw-pick" id="rwPick" role="listbox" aria-label="공개된 수업 레포트" hidden>' + L.map(function (r, k) {
             return '<button type="button" class="rw-pick__i num' + (k === i ? ' is-on' : '') + '" role="option" aria-selected="' + (k === i) + '" data-rw="' + k + '">' + esc(name(r)) + '</button>';
           }).join('') + '</div>' : '');
  }
  function drawReportNav(i) {
    var box = $('#reportNav');
    if (box) box.innerHTML = reportNavHtml(i);
  }

  function openReport(code, r) {
    var body = $('#reportBody');
    var ov = $('#reportOverview');
    if (ov) ov.hidden = true;
    var nb = $('#reportNotes');
    if (nb) nb.hidden = true;
    $('#reportView').hidden = false;
    closePlayers(null);
    var idx = RP.list.indexOf(r);
    if (idx === -1 && !r.draft) idx = indexOfWeek(r.week_start);
    RP.cur = idx;
    drawReportNav(idx);
    body.innerHTML = '<div class="empty">레포트를 불러오는 중입니다…</div>';
    window.scrollTo(0, 0);
    var mon = mondayOf(r.week_start);
    /* 그 주 복습테스트 낸 것(맞은 수 / 전체) · 미응시 (027 · 028 · 030). 함수가 없으면 레포트에 담긴 것으로 */
    if (!(mon in RVW)) {
      RVW[mon] = 'loading';
      rpc('hub_review_week', { p_code: code, p_week: mon }).then(function (list) {
        RVW[mon] = Array.isArray(list) ? list : null;
        if (RP.cur === idx && RP.data) { var s = $('#rwSum'); if (s) s.outerHTML = sumHtml(RP.r, RP.data); }
      }, function () { RVW[mon] = null; });
    }

    rpc('hub_report', { p_code: code, p_week: r.draft ? '__draft' : r.week_start }).then(function (data) {
      if (RP.cur !== idx) return;                       /* 그 사이 다른 수업을 눌렀다 */
      if (!data) { body.innerHTML = '<div class="empty">이 레포트는 지금 볼 수 없습니다.</div>'; return; }
      RP.data = data; RP.r = r;
      try {
        body.innerHTML = reportHtml(r, data, idx === RP.latest);
      } catch (e) {
        body.innerHTML = '<div class="empty">레포트를 그리지 못했습니다.<br>선생님께 다시 확인 부탁드립니다.</div>';
        return;
      }
      if (ReportView.animate) ReportView.animate(body);
      /* 오늘 수업 필기 — 그 수업일에 올라온 그 학생 필기 (없으면 칸이 없다) */
      var ld = lessonDateOf(r, data);
      if (global.Photos && Photos.lessonCard && ld) Photos.lessonCard($('#rwNotes'), code, ld);
      drawReportApp($('#rwApp'), code, r, data, idx);
      drawNote(code, r, idx);
      loadThumbs(body, code);
    }).catch(function () {
      body.innerHTML = '<div class="empty">불러오지 못했습니다. 새로고침해 주세요.</div>';
    });
  }

  /* ============================================================
     누적 추이 — 출석률 · 집중도 평균 · 복습 점수 · 과제 완료율 (hub_trend · migration-016)
       공개된 레포트의 출결 · 집중도 · 필수과제율, 낸 복습 점수만. 상담 · 성적 · 금액은 없다.
       출석률 = (출석 + 지각) / 기록이 있는 주 — 그래프는 그 주까지의 누적
       집중도 평균은 결석한 주(0)를 뺀다. 과제는 필수과제 완료율 — 앱이 연결된 학생은 그 주 과제 기간의 앱 제출일 비율(app-week.js).
       점을 누르면 그 수업 레포트가 열린다. 레포트가 하나뿐이면 "레포트가 두 번 쌓이면 추이가 보입니다".
     ============================================================ */
  var TREND_INK = '#7858E8';

  function loadTrend(code) {
    var host = $('#trendCard');
    if (!host) return;
    rpc('hub_trend', { p_code: code }).then(function (t) {
      if (!t || !t.ok || !Array.isArray(t.weeks)) { host.innerHTML = ''; return; }
      host.innerHTML = trendHtml(t.weeks);
      if (APP.info && APP.info.linked) appData(code).then(function (data) { if (data) host.innerHTML = trendHtml(appAdjust(t.weeks, data)); });
    }).catch(function () { host.innerHTML = ''; });   /* 016 실행 전 — 카드 없이 */
  }

  function avg(list) {
    var v = list.filter(function (x) { return x != null && !isNaN(x); });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  function trendSeries(weeks) {
    var present = 0, counted = 0;
    var rows = weeks.map(function (w) {
      var st = w.status === 'makeup' ? 'attend' : w.status;
      var known = st === 'attend' || st === 'late' || st === 'absent';
      if (known) { counted++; if (st !== 'absent') present++; }
      var focus = (st === 'absent' || w.focus == null || !(Number(w.focus) > 0)) ? null : Number(w.focus);
      return {
        week: w.week_start, date: w.lesson_date || '',
        att: counted ? Math.round(present / counted * 100) : null,
        focus: focus,
        review: w.review == null ? null : Number(w.review),
        reviews: w.reviews || null,
        hw: w.hw == null ? null : Math.round(Number(w.hw))
      };
    });
    /* 시험별 점수 (migration-025 — 「복습 TEST」 · 「화작문 TEST」 …) — 시험마다 따로 선을 그린다 */
    var names = [];
    rows.forEach(function (x) { Object.keys(x.reviews || {}).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); }); });
    names.sort(function (a, b) { return (a === '복습 TEST' ? 0 : 1) - (b === '복습 TEST' ? 0 : 1) || a.localeCompare(b, 'ko'); });
    rows.forEach(function (x) { names.forEach(function (n) { var v = x.reviews ? x.reviews[n] : null; x['rv:' + n] = v == null ? null : Number(v); }); });
    return { rows: rows, present: present, counted: counted, reviewNames: names };
  }

  function trendHtml(weeks) {
    var head = '<h2 class="card-title">📈 누적 추이</h2>';
    if (weeks.length < 2) return '<div class="card tr-card">' + head + '<p class="hub-muted">레포트가 두 번 쌓이면 추이가 보입니다.</p></div>';
    var S = trendSeries(weeks), rows = S.rows;
    var fAvg = avg(rows.map(function (x) { return x.focus; }));
    var rAvg = avg(rows.map(function (x) { return x.review; }));
    var hAvg = avg(rows.map(function (x) { return x.hw; }));
    var summary = [];
    if (S.counted) summary.push('출석 ' + S.present + '/' + S.counted);
    if (fAvg != null) summary.push('집중도 ' + round1(fAvg).toFixed(1));
    if (rAvg != null) summary.push('복습 평균 ' + Math.round(rAvg) + '점');
    if (hAvg != null) summary.push('과제 ' + Math.round(hAvg) + '%');

    var charts = [
      { key: 'att',    name: '출석률',    max: 100, fmt: function (v) { return v + '%'; } },
      { key: 'focus',  name: '집중도',    max: 5,   fmt: function (v) { return round1(v).toFixed(1); } },
    ].concat(S.reviewNames.length
      ? S.reviewNames.map(function (n) { return { key: 'rv:' + n, name: esc(n.replace(/ TEST$/, '')) + ' 점수', max: 100, fmt: function (v) { return Math.round(v) + '점'; } }; })
      : [{ key: 'review', name: '복습 점수', max: 100, fmt: function (v) { return Math.round(v) + '점'; } }]
    ).concat([
      { key: 'hw',     name: '과제 완료', max: 100, fmt: function (v) { return v + '%'; } }
    ]).filter(function (c) { return rows.some(function (x) { return x[c.key] != null; }); });

    return '<div class="card tr-card">' + head +
      (summary.length ? '<p class="tr-sum num">' + esc(summary.join(' · ')) + '</p>' : '') +
      '<div class="tr-grid">' + charts.map(function (c) { return miniChart(c, rows); }).join('') + '</div>' +
      '<p class="tr-hint">점을 누르면 그 수업 레포트가 열립니다</p>' +
      tableHtml(rows, charts) +
    '</div>';
  }

  function weekShort(x) {
    if (x.date && global.Lesson && Lesson.md) return Lesson.md(x.date);
    return weekName(x.week).replace(/ 수업$/, '');
  }

  /* 작은 꺾은선 — 한 줄짜리라 범례 없이, 마지막 점에만 값. 값이 빈 주는 선을 끊는다 */
  function miniChart(c, rows) {
    var W = 160, H = 64, padX = 8, top = 8, bot = 8;
    var n = rows.length;
    function X(i) { return n === 1 ? W / 2 : padX + i * (W - padX * 2) / (n - 1); }
    function Y(v) { return top + (1 - Math.max(0, Math.min(c.max, v)) / c.max) * (H - top - bot); }
    var segs = [], cur = [], last = null;
    rows.forEach(function (x, i) {
      var v = x[c.key];
      if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([X(i), Y(v)]);
      last = { i: i, v: v };
    });
    if (cur.length) segs.push(cur);
    var grid = [0, .5, 1].map(function (g) {
      var y = top + g * (H - top - bot);
      return '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="tr-gridline"/>';
    }).join('');
    var area = segs.filter(function (sg) { return sg.length > 1; }).map(function (sg) {
      return '<path class="tr-area" d="M' + sg[0][0] + ' ' + (H - bot) + ' L' + sg.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L') +
             ' L' + sg[sg.length - 1][0].toFixed(1) + ' ' + (H - bot) + ' Z"/>';
    }).join('');
    var lines = segs.map(function (sg) {
      return '<polyline class="tr-line" points="' + sg.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
    }).join('');
    var dots = rows.map(function (x, i) {
      var v = x[c.key];
      if (v == null) return '';
      var label = weekShort(x) + ' ' + c.name + ' ' + c.fmt(v);
      return '<g class="tr-pt" data-tw="' + esc(x.week) + '" role="button" tabindex="0" aria-label="' + esc(label + ' — 레포트 열기') + '">' +
               '<title>' + esc(label) + '</title>' +
               '<circle class="tr-hit" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="15"/>' +
               '<circle class="tr-dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4"/>' +
             '</g>';
    }).join('');
    return '<div class="tr-chart">' +
             '<div class="tr-chart__head"><span class="tr-chart__name">' + c.name + '</span>' +
               (last ? '<span class="tr-chart__val num">' + esc(c.fmt(last.v)) + '</span>' : '') + '</div>' +
             '<svg class="tr-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(c.name + ' 추이') + '"' +
               ' style="--tr-ink:' + TREND_INK + '">' + grid + area + lines + dots + '</svg>' +
           '</div>';
  }

  function tableHtml(rows, charts) {
    return '<details class="tr-table"><summary>표로 보기</summary><div class="tr-table__wrap"><table>' +
      '<thead><tr><th>주</th>' + charts.map(function (c) { return '<th>' + c.name + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice().reverse().map(function (x) {
        return '<tr><th><button type="button" class="tr-week" data-tw="' + esc(x.week) + '">' + esc(weekShort(x)) + '</button></th>' +
          charts.map(function (c) { var v = x[c.key]; return '<td class="num">' + (v == null ? '—' : esc(c.fmt(v))) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  /* 키보드로 점을 고를 때도 */
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('tr-pt')) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

  /* ---------- 과제 상세 (예전 「앱 과제」 탭 · 20261029i) — 지금 진행 중인 주는 여기에서만 ---------- */

  function ring(value, label) {
    var v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    var R = 45, C = 2 * Math.PI * R;
    return '<div class="rate-circle-wrapper' + (v === 0 ? ' is-zero' : '') + '">' +
             '<div class="rate-circle">' +
               '<svg viewBox="0 0 110 110" aria-hidden="true" focusable="false">' +
                 '<circle class="rate-circle-bg" cx="55" cy="55" r="' + R + '" fill="none" stroke-width="10"/>' +
                 '<circle class="rate-circle-fill" cx="55" cy="55" r="' + R + '" fill="none" stroke-width="10"' +
                   ' stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '"' +
                   ' data-offset="' + (C - v / 100 * C).toFixed(2) + '"/>' +
               '</svg>' +
               '<div class="rate-num num">' + v + '<small>%</small></div>' +
             '</div>' +
             '<div class="rate-label">' + esc(label) + '</div>' +
           '</div>';
  }

  var CAL_LABEL = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제', today: '오늘 — 밤 12시 마감 전' };

  function categoriesHtml(list) {
    if (!list.length) return '';
    return list.slice().sort(function (a, b) { return b.rate - a.rate; }).map(function (c) {
      return '<div class="test-item">' +
               '<div class="test-header">' +
                 '<span class="test-name">' + esc(c.name) +
                   (c.count ? '<span class="test-badge">' + c.count + '회</span>' : '') + '</span>' +
                 '<span class="test-score-text num">' + c.rate + ' <small>%</small></span>' +
               '</div>' +
               '<div class="progress-bar"><div class="progress-fill" data-width="' + c.rate + '"></div></div>' +
             '</div>';
    }).join('');
  }

  /* ============================================================
     과제 상세 — 앱이 주는 세부 기록을 모두 (20261030a). 레포트는 큰 흐름만, 여기는 자세히.
       app-report 함수가 넘기는 것만 쓴다 (없는 것은 만들어 내지 않는다):
         stats(전체 누적 %) · calendar(과제 날짜 · 정시/늦게/미제출) · lectures(차시 제목 · 강의 영상 n/n · 차시 과제 n/n)
         history(과제 제목 · 제출 시각 · 지각 · 정답률) · categories(영역 이름 · 정답률 · 횟수 — 앱이 전체 기간만 준다)
       기간 고르기 「지난 일주일 · 이번 달 · 전체」 — 요약 칸 · 날짜별 과제가 바뀐다 (영역별 정답률 · 차시별 진도는 전체 기간)
       문항별 정오 · 오답 문항 · 풀이 시간 · 시청 시간(분)은 앱이 주지 않아 화면에 없다
     ============================================================ */
  var APD = { period: 'week' };
  var PERIODS = [['week', '지난 일주일'], ['month', '이번 달'], ['all', '전체']];
  function isDay(x) { return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')); }

  /* 기간 — 지난 일주일 = 오늘까지 7일 · 이번 달 = 1일부터 오늘 · 전체 = 앱 기록 첫날부터 오늘 */
  function periodRange(d, key) {
    var t = todayISO();
    if (key === 'week') return { from: plusDays(t, -6), to: t };
    if (key === 'month') return { from: t.slice(0, 8) + '01', to: t };
    var first = (global.AppWeek && AppWeek.startOf) ? AppWeek.startOf(d) : '';
    (d.history || []).forEach(function (h) { var x = String(h.submittedAt || '').slice(0, 10); if (isDay(x) && (!first || x < first)) first = x; });
    return { from: first || t, to: t };
  }

  /* 과제 날짜마다 — 앱 달력의 그날 상태 · 그날 차시(강의 영상) · 그 차시 과제 기록
     토 · 일은 앱 기록이 없어도 늘 「주중 복습」 줄 (weekend · 제출 기록이 있으면 ✓ · 요약 칸에서는 세지 않는다 · 20261030d) */
  function appDays(d, from, to) {
    d = AppWeek.normalize ? AppWeek.normalize(d) : d;           /* 과제 날짜로 맞춘 달력 (요약 · 요일 칸과 같은 정시 기준 · 20261031y) */
    var t = todayISO(), lec = {}, byOrder = AppWeek.orderDays ? AppWeek.orderDays(d) : {}, days = {};
    for (var wd = from, k = 0; wd <= to && wd <= t && k < 400; wd = plusDays(wd, 1), k++) {
      if (AppWeek.isWeekend(wd)) days[wd] = { date: wd, status: 'wk', weekend: true, lecture: null, items: [] };
    }
    (d.lectures || []).forEach(function (l) { if (l && l.order) lec[l.order] = l; });
    (d.calendar || []).forEach(function (c) {
      if (!c || !isDay(c.date) || c.date < from || c.date > to || c.date > t) return;
      var we = AppWeek.isWeekend(c.date);
      days[c.date] = { date: c.date, status: we ? (c.status === 'onTime' || c.status === 'late' ? 'wkDone' : 'wk') : c.date === t && c.status === 'none' ? 'today' : c.status, weekend: we,
                       lecture: c.order ? lec[c.order] || null : null, items: [] };
      if (c.order) byOrder[c.order] = c.date;
    });
    (d.history || d.recent || []).forEach(function (h) {
      if (!h) return;
      var day = AppWeek.hwDateOf ? AppWeek.hwDateOf(h, byOrder).date : String(h.submittedAt || '').slice(0, 10);
      if (!isDay(day) || day < from || day > to) return;
      if (!days[day]) days[day] = { date: day, status: AppWeek.lateOf(h, day) ? 'late' : 'onTime', weekend: AppWeek.isWeekend(day), lecture: h.order ? lec[h.order] || null : null, items: [] };
      if (days[day].weekend) days[day].status = 'wkDone';
      days[day].items.push(h);
    });
    return Object.keys(days).sort().reverse().map(function (k) { return days[k]; });
  }

  function hhmm(iso) {
    var m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? m[1] + ':' + m[2] : '';
  }
  function rateAvg(items) {
    var r = items.filter(function (h) { return h.correctRate != null; }).map(function (h) { return Number(h.correctRate); });
    return r.length ? Math.round(r.reduce(function (a, b) { return a + b; }, 0) / r.length) : null;
  }

  /* 기간 요약 칸 — 과제 제출 · 정시 · 늦게 · 미제출 · 평균 정답률 · 강의 시청 */
  function apSumHtml(list) {
    var all = list, on = 0, late = 0, none = 0, lecN = 0, lecDone = 0, items = [];
    all.forEach(function (x) { items = items.concat(x.items); });
    list = list.filter(function (x) { return !x.weekend && x.status !== 'exempt'; });      /* 토 · 일(주중 복습) · 면제한 날은 제출 · 정시 · 강의 수에 넣지 않는다 */
    var tday = todayISO();
    list.forEach(function (x) {
      var seen = !!x.lecture && x.lecture.videosTotal > 0 && x.lecture.videosDone >= x.lecture.videosTotal;
      if (x.lecture && x.lecture.videosTotal > 0 && !(x.date === tday && !seen)) { lecN++; if (seen) lecDone++; }
    });
    list = list.filter(function (x) { return x.status !== 'today'; });                     /* 오늘 — 마감 전 · 아직이면 세지 않는다 (20261031v) */
    var n = list.length;
    list.forEach(function (x) {
      if (x.status === 'onTime') on++; else if (x.status === 'late') late++; else none++;
    });
    if (!n) return '<p class="awb-wait">이 기간에는 과제가 없었습니다</p>';
    var avg = rateAvg(items);
    var t = function (k, v, sub) { return '<div class="ap-stat"><div class="ap-stat__k">' + k + '</div><div class="ap-stat__v num">' + v + '</div>' + (sub ? '<div class="ap-stat__s">' + sub + '</div>' : '') + '</div>'; };
    return '<div class="ap-stats">' +
      t('과제 제출', (on + late) + '<small>/' + n + '일</small>', pctOf(on + late, n) + '%') +
      t('정시 · 늦게', on + '<small> · </small>' + late, none ? '미제출 ' + none + '일' : '미제출 없음') +
      t('평균 정답률', avg == null ? '—' : avg + '<small>%</small>', items.length ? '과제 ' + items.length + '개' : '') +
      t('강의 시청', lecN ? lecDone + '<small>/' + lecN + '일</small>' : '—', lecN ? pctOf(lecDone, lecN) + '%' : '') +
    '</div>';
  }

  /* 영역별 정답률 막대 + 자주 틀리는 영역 TOP 3 (정답률이 낮은 순) */
  function apCatsHtml(cats) {
    if (!cats.length) return '';
    var low = cats.filter(function (c) { return c.count == null || c.count > 0; }).slice().sort(function (a, b) { return a.rate - b.rate; }).slice(0, 3);
    return '<div class="card ap-cats"><h2 class="card-title">🎯 영역별 정답률<span class="card-note">전체 기간</span></h2>' +
      (cats.length > 1 && low.length ? '<div class="ap-top"><div class="ap-top__t">자주 틀리는 영역 TOP ' + low.length + '</div><ol class="ap-top__list">' + low.map(function (c) {
        return '<li><b>' + esc(c.name) + '</b> <span class="num">' + c.rate + '%</span>' + (c.count ? ' <span class="ap-muted num">' + c.count + '회</span>' : '') + '</li>';
      }).join('') + '</ol></div>' : '') +
      categoriesHtml(cats) + '</div>';
  }

  var AP_ST = { onTime: ['정시', 'app-tag'], late: ['늦게', 'app-tag app-tag--late'], none: ['미제출', 'app-tag app-tag--none'],
                exempt: ['면제', 'app-tag app-tag--wk'], today: ['오늘 · 마감 전', 'app-tag app-tag--wk'],
                wk: ['주중 복습', 'app-tag app-tag--wk'], wkDone: ['주중 복습 ✓', 'app-tag app-tag--wk app-tag--wkdone'] };
  /* 날짜별 과제 — 펼치면 그날 과제마다 제목 · 제출 시각 · 정답률, 그날 강의 영상 */
  function apDaysHtml(list) {
    if (!list.length) return '';
    var nWeek = list.filter(function (x) { return !x.weekend; }).length;
    /* 처음 펼치는 줄 = 가장 최근 평일 과제 (없으면 맨 위) */
    var openAt = Math.max(0, list.findIndex(function (x) { return !x.weekend || x.items.length; }));
    return '<div class="card ap-days"><h2 class="card-title">📅 날짜별 과제<span class="card-note">' + (nWeek ? '과제 ' + nWeek + '일' : '') + '</span></h2>' +
      list.map(function (x, i) {
        /* 머리줄 「10/29(목) · 정시 · 67%」 — 과제 날짜 칸 · 정시 기준은 과제 요약과 같다 · 개수는 하루 2개 이상일 때만 (20261031y) */
        var st = AP_ST[x.status] || AP_ST.none, avg = rateAvg(x.items), L = x.lecture;
        return '<details class="ap-day' + (x.weekend ? ' ap-day--wk' : '') + '"' + (i === openAt ? ' open' : '') + '><summary>' +
            '<span class="ap-day__d num">' + esc(Lesson.md(x.date)) + '</span>' +
            '<span class="' + st[1] + '">' + st[0] + '</span>' +
            (avg == null ? '' : '<span class="ap-day__r num">' + avg + '%</span>') +
            (x.items.length >= 2 ? '<span class="ap-muted">과제 ' + x.items.length + '개</span>' : '') +
          '</summary><div class="ap-day__body">' +
            (L && L.videosTotal ? '<p class="ap-lec">▶ 강의 ' + (L.videosDone >= L.videosTotal ? '다 봄' : '안 봄') + '</p>' : '') +
            (x.items.length ? '<ul class="app-recent">' + x.items.map(function (h) {
              var late = AppWeek.lateOf ? AppWeek.lateOf(h, x.date) : !!h.late, sub = AppWeek.kstDay ? AppWeek.kstDay(h.submittedAt) : String(h.submittedAt || '').slice(0, 10);
              return '<li class="app-recent__row">' +
                '<span class="app-recent__title">' + esc(AppWeek.cleanTitle ? AppWeek.cleanTitle(h.title || '과제') : (h.title || '과제')) + '</span>' +
                (late ? '<span class="app-tag app-tag--late">늦게' + (isDay(sub) ? ' · ' + esc(Lesson.md(sub, false)) + ' 제출' : '') + '</span>' : '<span class="app-tag">정시</span>') +
                (h.correctRate == null ? '' : '<span class="app-recent__rate num">' + h.correctRate + '%</span>') +
              '</li>';
            }).join('') + '</ul>' : '<p class="ap-muted">' + (x.weekend ? '토 · 일은 주중 복습 날입니다 (제출 수에 넣지 않아요)' : x.status === 'exempt' ? '면제한 날입니다 (제출 수에 넣지 않아요)' : x.status === 'today' ? '오늘은 밤 12시 마감 전이에요 (아직 세지 않아요)' : x.status === 'none' ? '제출한 과제가 없습니다' : '과제 기록이 없습니다') + '</p>') +
          '</div></details>';
      }).join('') + '</div>';
  }

  /* 차시별 진도 — 차시 제목 · 강의 영상 n/n · 차시 과제 n/n (정시 n) */
  function apLecturesHtml(list) {
    list = (list || []).filter(function (l) { return l && (l.title || l.order); }).slice().sort(function (a, b) { return (b.order || 0) - (a.order || 0); });
    if (!list.length) return '';
    return '<details class="card ap-lecs"><summary class="card-title">📚 차시별 진도<span class="card-note">' + list.length + '차시 · 눌러서 펼치기</span></summary>' +
      '<table class="ap-table"><thead><tr><th>차시</th><th>강의 영상</th><th>과제</th></tr></thead><tbody>' +
      list.map(function (l) {
        return '<tr><td>' + esc(l.title || '') + '</td>' +
          '<td class="num">' + (l.videosTotal ? l.videosDone + '/' + l.videosTotal : '—') + '</td>' +
          '<td class="num">' + (l.hwTotal ? l.hwSubmitted + '/' + l.hwTotal + (l.hwOnTime < l.hwSubmitted ? ' <span class="ap-muted">(정시 ' + l.hwOnTime + ')</span>' : '') : '—') + '</td></tr>';
      }).join('') + '</tbody></table></details>';
  }

  function apDetailHtml(d) {
    var r = periodRange(d, APD.period), list = appDays(d, r.from, r.to);
    return '<div class="card ap-period">' +
        '<h2 class="card-title">📊 기간별 기록</h2>' +
        '<div class="ap-seg" role="group" aria-label="기간">' + PERIODS.map(function (p) {
          return '<button type="button" class="ap-seg__b' + (p[0] === APD.period ? ' is-on' : '') + '" data-ap-period="' + p[0] + '" aria-pressed="' + (p[0] === APD.period) + '">' + p[1] + '</button>';
        }).join('') + '</div>' +
        '<p class="awb-sub">' + esc(Lesson.md(r.from, false) + ' ~ ' + Lesson.md(r.to, false)) + '</p>' +
        apSumHtml(list) +
      '</div>' +
      apDaysHtml(list);
  }

  /* 코치룸 미리보기에서만 — 앱이 실제로 보내는 항목 이름 (app-report 의 shape · 값은 없다) */
  function apShapeHtml(d) {
    if (!PV || !d.shape) return '';
    var sh = d.shape;
    return '<details class="card ap-shape"><summary class="card-title">🔎 앱이 보내는 항목 이름<span class="card-note">코치룸 미리보기에서만</span></summary><ul>' +
      Object.keys(sh).map(function (k) { return '<li><b>' + esc(k) + '</b> ' + esc([].concat(sh[k] || []).join(', ')) + '</li>'; }).join('') + '</ul></details>';
  }

  /* 「앱에서 자세히 보기 ↗」 (20261031n) — 과제 상세 탭 맨 위(차분한 안내 한 줄 + 버튼) · 레포트 과제 요약 아래(작은 글씨 한 줄)
     공유 링크가 없는 학생은 아무것도 그리지 않는다. 반짝임 같은 효과는 넣지 않는다 */
  var APP_MORE = '마라톤 앱에서는 학생이 실제로 푼 흔적까지 더 자세히 볼 수 있습니다';
  function appMoreHtml(app, small, warn) {
    if (!(app && app.linked && app.share_url)) return '';
    var url = esc(safeUrl(app.share_url));
    /* 링크가 만료됐을 때 — 코치룸 미리보기에서만 주황 점 · 「링크가 만료됐을 수 있습니다 · 링크 바꾸기」(코치룸 과제 칩 아래에서) */
    if (warn && PV) {
      return '<div class="ap-more ap-more--warn"><p class="ap-more__t"><i class="ap-more__dot" aria-hidden="true"></i>링크가 만료됐을 수 있습니다 · 코치룸 과제 칩의 [링크 바꾸기]에서 새 링크를 넣어 주세요</p>' +
        '<a class="hub-btn hub-btn--ghost ap-more__btn" href="' + url + '" target="_blank" rel="noopener">그래도 앱에서 열기 ↗</a></div>';
    }
    return small
      ? '<p class="ap-more ap-more--sm"><span>' + APP_MORE + '</span> <a class="ap-more__btn" href="' + url + '" target="_blank" rel="noopener">앱에서 자세히 보기 ↗</a></p>'
      : '<div class="ap-more"><p class="ap-more__t">' + APP_MORE + '</p><a class="hub-btn ap-more__btn" href="' + url + '" target="_blank" rel="noopener">앱에서 자세히 보기 ↗</a></div>';
  }

  function renderApp(code, app, reports, base) {
    var host = $('#panelApp');

    if (!app.linked) {
      host.innerHTML = '<div class="empty">과제 기록이 아직 연결되지 않았습니다.<br>선생님께 문의해 주세요.</div>';
      return;
    }

    host.innerHTML = appMoreHtml(app) + appWaitHtml();
    appWaitSlow(host);
    APP_RETRY.detail = function () { renderApp(code, app, reports, base); };

    appData(code).then(function (dd) {
      var res = dd ? { ok: true, data: dd } : { ok: false, reason: APP.why || '' };
      if (!res || !res.ok) {
        /* Edge Function 이 아직 없거나 앱 서버가 응답하지 않을 때.
           맨 위 「앱에서 자세히 보기 ↗」로 원래 화면을 볼 수 있게 남겨 둔다. */
        var why = res && res.reason === 'expired'
          ? '앱 공유 링크가 바뀐 것 같습니다. 선생님께 새 링크를 요청해 주세요.'
          : '';
        host.innerHTML = appMoreHtml(app, false, !!why) + (why ? '<div class="empty">' + why + '</div>' : appFailHtml('detail'));
        return;
      }

      var d = res.data || {};
      if (d.startOn) HUBSTART = String(d.startOn).slice(0, 10);
      else if (HUBSTART) { d = Object.assign({}, d, { startOn: HUBSTART }); }
      /* 레포트 수업일 L 기준 (20261031v) — 이 수업 과제 (L-7 ~ L-1) · 진행 중 (L ~ 다음 수업 전날) */
      var L = base || appBaseDate(reports), t = todayISO();
      var lp = L && global.AppWeek ? AppWeek.forLesson(d, L, t) : null;
      var np = L ? nextPeriod(L) : null;
      var nw = np ? AppWeek.compute(d, np.from, np.to, t) : null;
      var top = !lp ? appBlockHtml(d, null, { title: '이 수업 과제', noTotal: true, noCal: true })
        : appBlockHtml(d, lp.w, { title: '이 수업 과제 (' + Lesson.md(lp.from, false) + '~' + Lesson.md(lp.to, false) + ')', sub: esc(Lesson.md(L, false)) + ' 수업 레포트와 같은 기간',
                                  first: lp.first, newStudent: !!lp.newStudent, range: { from: lp.from, to: lp.to }, noTotal: true, noCal: true });
      host.innerHTML = appMoreHtml(app) + top +
        (np ? progressHtml(nw, np) : '') +
        '<div id="apDetail">' + apDetailHtml(d) + '</div>' +
        apCatsHtml(d.categories || []) +
        apLecturesHtml(d.lectures) +
        apShapeHtml(d) +
        apBottomHtml(d, lp ? { from: lp.from, to: lp.to } : null);
      /* 기간 고르기 — 요약 칸 · 날짜별 과제만 다시 그린다 */
      host.onclick = function (e) {
        var b = e.target.closest && e.target.closest('[data-ap-period]');
        if (!b) return;
        APD.period = b.dataset.apPeriod;
        $('#apDetail').innerHTML = apDetailHtml(d);
      };

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          host.querySelectorAll('.progress-fill').forEach(function (el) {
            el.style.width = el.getAttribute('data-width') + '%';
          });
          host.querySelectorAll('.rate-circle-fill').forEach(function (el) {
            el.setAttribute('stroke-dashoffset', el.getAttribute('data-offset'));
          });
        });
      });
    }).catch(function () {
      host.innerHTML = appMoreHtml(app) + appFailHtml('detail');
    });
  }

  /* ============================================================
     반 공용 공지 /notice/
     ============================================================ */

  function bootNotice() {
    var root = $('#hubRoot');
    var code = parseHash().code;
    if (!/^[A-Za-z0-9]{16,64}$/.test(code)) { stopScreen(root, 'nocode'); return; }

    rpc('class_notice_get', { p_code: code }).then(function (d) {
      if (!d || !d.ok) { stopScreen(root, 'notfound'); return; }
      $('#hubName').textContent = d.class_name + ' 반 공지';
      renderDday(d.exam, '');
      $('#hubHead').hidden = false;
      setTitle(global.BRAND ? BRAND.noticeTitle : '마라톤국어 반 공지');
      WEEKLY = d.weekly || null;
      root.innerHTML = weeklyHtml(WEEKLY) + noticesHtml(d.notices || []);
      bindArchive(root, d.notices || []);
      bindWeekly(root, code);
      loadThumbs(root, code);
    }).catch(function () { stopScreen(root, 'network'); });
  }

  /* 주소의 # 뒤 코드를 바꿔 다른 링크를 열면 새로 읽는다 (/보기 만 바뀐 것은 뒤로가기 — 새로 읽지 않는다) */
  global.addEventListener('hashchange', function () {
    var c = parseHash().code;
    if (nav.code && c === nav.code) return;
    if (!nav.code && !PV && c) { location.reload(); return; }
    if (nav.code && c !== nav.code) location.reload();
  });

  global.addEventListener('popstate', function (e) {
    if (!nav.on) return;
    if (nav.ignore > 0) { nav.ignore--; return; }
    var lb = lightboxOpen();
    if (lb) { nav.lbClosing = true; lb.remove(); return; }       /* 크게 보던 사진 닫기 */
    if (parseHash().code !== nav.code) return;
    var st = (e.state && e.state.hub) || { v: parseHash().view, arg: parseHash().arg };
    if (nav.apply) nav.apply(st.v, st.arg);
  });

  /* 사진을 크게 열면 기록 하나 — 뒤로가기 = 닫기. 눌러서 닫으면 그 기록도 지운다 */
  if (global.MutationObserver) {
    new MutationObserver(function (list) {
      if (!nav.on) return;
      list.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.classList && n.classList.contains('ph-light')) history.pushState({ hub: (history.state && history.state.hub) || { v: 'notice' }, lb: 1 }, '', location.hash);
        });
        Array.prototype.forEach.call(m.removedNodes, function (n) {
          if (!(n.classList && n.classList.contains('ph-light'))) return;
          if (nav.lbClosing) { nav.lbClosing = false; return; }
          if (history.state && history.state.lb) { nav.ignore++; history.back(); }
        });
      });
    }).observe(document.body, { childList: true });
  }

  global.Hub = { bootMe: bootMe, bootNotice: bootNotice, youtubeId: youtubeId, trendSeries: trendSeries };

})(window);
