/* ============================================================
   hub.js — 학생·학부모 화면 (개인 페이지 /me/ · 반 공지 /notice/)

   로그인이 없다. 주소의 # 뒤 코드를 Supabase 공개 함수에 넘기고,
   함수가 돌려준 것만 그린다. 표를 직접 읽지 않는다.
     /me/#개인링크코드          → hub_get · hub_report · Edge Function(app-report)
     /me/#개인링크코드/report   → 내 레포트 탭의 최신 레포트를 바로 연다
     /me/#개인링크코드/book     → 교재비 탭 (hub_textbook — 그 학생 청구서만)
     /me/#개인링크코드/photo    → 필기 노트 탭 (Edge Function note-photo — 그 학생 사진만)
     /notice/#반코드            → class_notice_get
     자료 파일 내려받기          → Edge Function(class-file) — 링크 코드 · 파일의 반을 확인하고 2분짜리 주소

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

  function appReport(code) {
    if (PV) return PV.app();
    var url = CFG.supabase.url + '/functions/v1/' + CFG.appFunction + '?code=' + encodeURIComponent(code);
    return fetch(url, { headers: { 'apikey': CFG.supabase.key } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http' + r.status }; }); });
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
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<>"']+/g, function (u) {
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

  function weekLabel(n) {
    var sp = ReportView.shortPeriod(n.week_start, n.week_end);
    return sp || ReportView.shortDate(n.week_start);
  }

  function setTitle(t) { document.title = t; }

  /* 주요 시험 D-day — hub_get · class_notice_get 이 돌려준 그 반 시험 하나 (이름 · 날짜).
     한국 날짜 기준, 자정마다 다시 센다. 지났거나 없으면 줄을 숨긴다. */
  function renderDday(exam, who) {
    var el = $('#hubDday');
    if (!el || !global.DDay) return;
    function draw() {
      var text = exam ? DDay.sentence(exam, DDay.today()) : '';
      el.hidden = !text;
      el.textContent = text ? (who ? who + ' · ' : '') + text : '';
    }
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
      html += '<div class="nt-sub">▶️ 수업 다시보기</div><div class="nt-videos">' + vids.map(function (v) {
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
        (String(latest.title || '').trim() ? '<p class="nt-title">' + esc(latest.title) + '</p>' : '') +
        lessonLineHtml(latest.week_start) +
        noticeBodyHtml(latest) +
      '</div>';

    if (list.length > 1) {
      html += '<div class="card"><h2 class="card-title">🗂️ 지난 공지<span class="card-note">' +
              (list.length - 1) + '개</span></h2><div class="nt-archive">' +
              list.slice(1).map(function (n, i) {
                return '<details class="nt-past" data-i="' + (i + 1) + '">' +
                         '<summary><span class="nt-past__week num">' + esc(weekLabel(n)) + '</span>' +
                         '<span class="nt-past__title">' + esc(n.title || '') + '</span></summary>' +
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
  var KIND_ROWS = [['material', '📄 배부 자료'], ['required', '✏️ 필수 과제'], ['optional', '➕ 선택 과제']];
  var PART_NAME = { full: '수업 전체', '1': '1차시', '2': '2차시', makeup: '보강' };
  var PART_ORDER = { full: 0, '1': 1, '2': 2, makeup: 3 };
  /* 한 주 안에서 수업 전체 → 1차시 → 2차시 → 보강 */
  function sortVideos(list) {
    function o(v) { return PART_ORDER[v.part] == null ? 9 : PART_ORDER[v.part]; }
    return list.map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) { return (o(a.v) - o(b.v)) || (a.i - b.i); })
      .map(function (x) { return x.v; });
  }
  function weekVideoHtml(v) {
    var part = PART_NAME[v.part] || '';
    return videoHtml(v.url,
      '<span class="wk-part wk-part--' + esc(v.part) + '">' + esc(part) + (v.personal ? ' · 나만 보는 영상' : '') + '</span>' +
      esc(v.title || (v.part === 'full' ? '수업 영상' : part + ' 영상')));
  }
  var EXT_ICON = { pdf: '📕', hwp: '📘', hwpx: '📘', doc: '📘', docx: '📘', ppt: '📙', pptx: '📙', xlsx: '📗', jpg: '🖼️', jpeg: '🖼️', png: '🖼️' };

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
    return ReportView.shortPeriod(r.week_start, r.week_end) || ReportView.shortDate(r.week_start);
  }

  function weekName(weekStart) {
    var L = lessonOf(weekStart);
    if (L && L.date) return Lesson.md(L.date) + ' 수업';
    return ReportView.shortPeriod(weekStart, plusDays(weekStart, 6));
  }

  function sizeText(b) {
    b = Number(b) || 0;
    return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
  }

  /* 확정된 수업 내용 (AI 요약을 직원이 [확정]한 것만 · migration-012) — "1차시: …" */
  function lessonsHtml(lines) {
    var list = (lines || []).filter(function (t) { return String(t || '').trim(); });
    if (!list.length) return '';
    return '<div class="nt-sub">📖 수업 내용</div><ul class="lesson-list wk-lessons">' + list.map(function (t, i) {
      var m = /^(\d+)\s*차시\s*[:：.\-]?\s*([\s\S]*)$/.exec(String(t).trim());
      var no = m && m[2].trim() ? m[1] + '차시' : (i + 1) + '차시';
      var text = m && m[2].trim() ? m[2].trim() : String(t).trim();
      return '<li class="lesson-item"><span class="lesson-check">✓</span><span><b class="lesson-no">' + esc(no) + '</b>' + esc(text) + '</span></li>';
    }).join('') + '</ul>';
  }

  function weekBodyHtml(w) {
    var html = lessonsHtml(w.lessons);
    var vids = sortVideos((w.videos || []).filter(function (v) { return v && safeUrl(v.url); }));
    if (vids.length) {
      html += '<div class="nt-sub">▶️ 수업 영상</div><div class="nt-videos">' + vids.map(weekVideoHtml).join('') + '</div>';
    }
    var files = w.files || [];
    KIND_ROWS.forEach(function (k) {
      var list = files.filter(function (f) { return f.kind === k[0]; });
      if (!list.length) return;
      html += '<div class="nt-sub">' + k[1] + '</div><div class="nt-files">' + list.map(function (f) {
        return '<button type="button" class="nt-file wk-file" data-file="' + esc(f.id) + '">' +
                 '<span class="nt-file__icon" aria-hidden="true">' + (EXT_ICON[f.ext] || '📄') + '</span>' +
                 '<span class="nt-file__name">' + esc(f.name) +
                   ' <span class="wk-file__meta">' + esc(String(f.ext || '').toUpperCase()) + ' · ' + sizeText(f.bytes) + '</span></span>' +
                 '<span class="nt-file__go" aria-hidden="true">⬇</span>' +
               '</button>';
      }).join('') + '</div>';
    });
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
     다시보기 탭 (#코드/videos) — 영상이 있는 주만, 최신 주가 위.
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
             '<h2 class="card-title">▶️ ' + esc(weekName(x.w.week_start)) + '<span class="card-note">' + x.vids.length + '개</span></h2>' +
             '<div class="nt-videos">' + x.vids.map(weekVideoHtml).join('') + '</div>' +
           '</div>';
  }
  function renderVideos(host) {
    var list = videoWeeks();
    if (!list.length) { host.innerHTML = '<div class="empty">아직 올라온 수업 영상이 없습니다.</div>'; return; }
    host.innerHTML = list.slice(0, 4).map(videoWeekCard).join('') +
      (list.length > 4
        ? '<div id="vdMore"><button type="button" class="hub-more" data-vd-more>이전 주 더 보기 <span class="num">(' + (list.length - 4) + '주)</span></button></div>'
        : '');
    host.onclick = function (e) {
      if (!e.target.closest('[data-vd-more]')) return;
      var box = host.querySelector('#vdMore');
      if (box) box.outerHTML = list.slice(4).map(videoWeekCard).join('');
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

  /* 코치룸 미리보기 띠 */
  function previewBand() {
    if (document.getElementById('pvBand')) return;
    var b = document.createElement('div');
    b.id = 'pvBand';
    b.className = 'pv-band';
    b.textContent = '미리보기 — 조교 화면 · ' + (PV.role === 'student' ? '학생 링크' : '학부모 링크') + '로 열었을 때 모습입니다. 눌러도 아무것도 바뀌지 않습니다';
    document.body.insertBefore(b, document.body.firstChild);
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
     막혔을 때 보여 줄 화면
     ============================================================ */

  function stopScreen(root, kind) {
    var msg = {
      nocode:   '주소가 올바르지 않습니다.<br>받으신 링크를 다시 눌러 주세요.',
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
       주소: #코드 · #코드/reports · #코드/report/주차 · #코드/app · #코드/photo · #코드/book
       # 바로 뒤의 개인 링크 코드는 절대 바꾸지 않는다 (뒤에 /보기 만 붙였다 뗐다 한다)
       코치룸 미리보기(틀 안)에서는 기록하지 않는다 — 코치룸 뒤로가기를 흐트러뜨리지 않게
     ============================================================ */
  var nav = { on: false, code: '', ignore: 0, apply: null };
  function navHash(v, arg) {
    return '#' + nav.code + (v && v !== 'notice' ? '/' + v + (arg ? '/' + arg : '') : '');
  }
  function navPush(v, arg) {
    if (!nav.on) return;
    var hh = navHash(v, arg);
    if (location.hash === hh) return;
    history.pushState({ hub: { v: v, arg: arg || '' }, p: 1 }, '', hh);     /* p = 이 페이지 안에서 쌓은 기록 */
  }
  function lightboxOpen() { return document.querySelector('.ph-light'); }

  function bootMe() {
    var root = $('#hubRoot');
    var head = $('#hubHead');
    var tabs = $('#hubTabs');
    var h = parseHash();

    if (PV) { h = { code: 'preview', view: PV.view || '', arg: PV.arg || '' }; previewBand(); }
    else if (!/^[A-Za-z0-9]{20,64}$/.test(h.code)) { stopScreen(root, 'nocode'); return; }

    rpc('hub_get', { p_code: h.code }).then(function (d) {
      if (!d || !d.ok) { stopScreen(root, (d && d.reason) || 'notfound'); return; }

      /* 학생 링크 · 학부모 링크 (migration-015). 015 전에는 role 이 없다 — 예전처럼 모두 입력 가능 */
      var canWrite = d.can_write !== false;
      roleTag(d.role);

      var st = d.student || {};
      $('#hubName').textContent = (st.name || '') + ' 학생의 러닝노트';
      $('#hubMeta').textContent = [st.class_name, st.school, st.grade].filter(Boolean).join(' · ');
      renderDday(d.exam, (st.name || '') + ' 학생');
      head.hidden = false;
      tabs.hidden = false;
      setTitle(global.BRAND ? BRAND.noteTitle : '마라톤국어 러닝노트');

      root.innerHTML =
        '<section class="hub-panel" id="panelNotice" role="tabpanel"></section>' +
        '<section class="hub-panel" id="panelReport" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelVideo" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelApp" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelBook" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelPhoto" role="tabpanel" hidden></section>';

      /* 반 공지 — 맨 위에 이번 주 수업(수업일 · 영상 · 자료), 그 아래 공지 */
      WEEKLY = d.weekly || null;
      var pn = $('#panelNotice');
      pn.innerHTML = kakaoNoteHtml() + '<div id="reviewCard"></div><div id="weekPhotos"></div>' +
                     weeklyHtml(WEEKLY) + noticesHtml(d.notices || []) + homeGuideHtml();
      bindArchive(pn, d.notices || []);
      bindWeekly(pn, h.code);
      /* 첫 화면 맨 위 — 이번 주 필기 ("○월 ○일 수업 필기입니다") */
      if (global.Photos) { var wk = Photos.thisWeek(); Photos.weekCard($('#weekPhotos'), h.code, wk.from, wk.to); }

      /* 내 레포트 */
      var reports = d.reports || [];
      renderReportList(h.code, reports, d.draft || null);
      if (reports.length) $('#tabReport').classList.add('has-new');

      /* 다시보기 — 영상이 있을 때만 탭이 보인다 */
      var hasVideos = videoWeeks().length > 0;
      var tabVideo = $('#tabVideo');
      if (tabVideo) tabVideo.hidden = !hasVideos;
      var videoOpened = false;
      function openVideos() {
        if (videoOpened) return;
        videoOpened = true;
        renderVideos($('#panelVideo'));
      }

      /* 복습테스트 (migration-013) — 수업일 당일 맨 위 기록 카드, 내 레포트 탭 위 점수 그래프.
         기록 카드와 「확인 전」 내 기록은 입력할 수 있는 링크(학생 링크)에서만 */
      if (global.ReviewCard) {
        ReviewCard.history($('#reviewHist'), d.review || [], []);
        if (canWrite) {
          ReviewCard.bind($('#reviewCard'));
          ReviewCard.mount($('#reviewCard'), h.code, function (rv) {
            ReviewCard.history($('#reviewHist'), d.review || [], rv ? rv.recent : []);
          });
        }
      }

      /* 앱 과제 — 처음 열 때 불러온다 */
      var appLoaded = false;
      function openApp() {
        if (appLoaded) return;
        appLoaded = true;
        renderApp(h.code, d.app || {});
      }

      var photoOpened = false;
      function openPhoto() {
        if (photoOpened || !global.Photos) return;
        photoOpened = true;
        Photos.renderTab($('#panelPhoto'), h.code, { readOnly: !canWrite });
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
        if (which === 'video' && !(tabVideo && !tabVideo.hidden)) which = 'notice';
        closePlayers(null);
        [['notice', '#tabNotice', '#panelNotice'],
         ['report', '#tabReport', '#panelReport'],
         ['video',  '#tabVideo',  '#panelVideo'],
         ['app',    '#tabApp',    '#panelApp'],
         ['photo',  '#tabPhoto',  '#panelPhoto'],
         ['book',   '#tabBook',   '#panelBook']].forEach(function (t) {
          var on = t[0] === which;
          $(t[1]).setAttribute('aria-selected', on ? 'true' : 'false');
          $(t[2]).hidden = !on;
        });
        if (which === 'app') openApp();
        if (which === 'photo') openPhoto();
        if (which === 'video') openVideos();
        if (which === 'report') $('#tabReport').classList.remove('has-new');
      }

      $('#tabNotice').onclick = function () { select('notice'); navPush('notice'); };
      /* 내 레포트 — 가장 최근 주 레포트를 바로 연다 (위 주차 띠 · ◀ ▶ 로 다른 주) */
      $('#tabReport').onclick = function () {
        select('report');
        var first = RP.list[0];
        /* 기록: 전체 주차 → 그 주 레포트 (레포트에서 뒤로가기 = 전체 주차 · 누적 추이) */
        navPush('reports');
        if (first) { openReport(h.code, first); if (!first.draft) navPush('report', first.week_start); }
        else showReportList();
      };
      if (tabVideo) tabVideo.onclick = function () { select('video'); navPush('videos'); };
      $('#tabApp').onclick    = function () { select('app'); navPush('app'); };
      $('#tabBook').onclick   = function () { select('book'); navPush('book'); };
      $('#tabPhoto').onclick  = function () { select('photo'); navPush('photo'); };

      /* 뒤로가기 — 주소(#코드/보기)를 보고 그 화면으로 */
      nav.code = h.code;
      nav.on = !PV;
      nav.apply = function (v, arg) {
        if (v === 'report' || v === 'reports') {
          select('report');
          var rr = arg && reports.find(function (x) { return x.week_start === arg; });
          if (rr) openReport(h.code, rr);
          else if (v === 'report' && !arg && RP.list[0]) openReport(h.code, RP.list[0]);
          else showReportList();
        } else if (v === 'videos') select('video');
        else if (v === 'app' || v === 'photo') select(v);
        else if (v === 'book' && !$('#tabBook').hidden) select('book');
        else select('notice');
      };
      if (nav.on) history.replaceState({ hub: { v: h.view || 'notice', arg: h.arg || '' } }, '', location.hash);

      if (h.view === 'report' && h.arg) {
        nav.apply('report', h.arg);
      } else if (h.view === 'reports') {
        select('report');
      } else if (h.view === 'report') {
        select('report');
        if (RP.list.length) openReport(h.code, RP.list[0]);
      } else if (h.view === 'videos') {
        select('video');
      } else if (h.view === 'app') {
        select('app');
      } else if (h.view === 'photo') {
        select('photo');
      } else {
        select('notice');
      }

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

  /* ---------- 내 레포트 ---------- */

  /* 지금 보이는 레포트 목록 (최신이 앞. 코치룸 미리보기의 '공개 전' 은 맨 앞) */
  var RP = { code: '', list: [], cur: -1 };

  function renderReportList(code, reports, draft) {
    var host = $('#panelReport');
    if (draft) reports = [{ week_start: draft.week_start, week_end: draft.week_end, lesson_date: draft.lesson_date || '', draft: true }].concat(reports);
    RP.code = code; RP.list = reports; RP.cur = -1;
    if (!reports.length) {
      host.innerHTML = '<div id="reviewHist"></div><div class="empty">아직 공개된 주간 레포트가 없습니다.</div>';
      return;
    }
    host.innerHTML =
      '<div id="reportOverview">' +
      '<div id="reviewHist"></div>' +
      '<div id="trendCard"></div>' +
      '<div class="card" id="reportListCard">' +
        '<h2 class="card-title">🗓️ 주간 레포트<span class="card-note">' + reports.length + '편</span></h2>' +
        '<ul class="rp-list">' + reports.map(function (r, i) {
          return '<li><button type="button" class="rp-item' + (r.draft ? ' rp-item--draft' : '') + '" data-i="' + i + '">' +
                   '<span class="rp-item__week num">' + esc(reportLabel(r)) + '</span>' +
                   '<span class="rp-item__label">' + (r.draft ? '공개하면 이렇게 보입니다 (미리보기)' : '주간 학습 레포트') + '</span>' +
                   (i === 0 && !r.draft ? '<span class="rp-item__new">NEW</span>' : '') +
                   '<span class="rp-item__go" aria-hidden="true">›</span>' +
                 '</button></li>';
        }).join('') + '</ul>' +
      '</div>' +
      '</div>' +
      '<div id="reportView" hidden>' +
        '<button type="button" class="hub-back" id="reportBack">‹ 전체 주차 · 누적 추이</button>' +
        '<div class="rw-nav" id="reportNav"></div>' +
        '<div id="reportBody"></div>' +
      '</div>';

    loadTrend(code);

    host.addEventListener('click', function (e) {
      var b = e.target.closest('.rp-item');
      if (b) {
        var rp = reports[+b.dataset.i];
        openReport(code, rp);
        if (!rp.draft) navPush('report', rp.week_start);
        return;
      }
      /* 주차 띠 · ◀ 지난주 · 다음주 ▶ · 추이 그래프의 점 — 같은 화면 안에서 주만 바꾼다 (주소는 바꾸되 기록은 쌓지 않는다) */
      var w = e.target.closest('[data-rw]');
      if (w && !w.disabled) {
        var i = +w.dataset.rw;
        if (reports[i]) { openReport(code, reports[i]); navReplace(reports[i]); }
        return;
      }
      var tp = e.target.closest('[data-tw]');
      if (tp) {
        var k = indexOfWeek(tp.getAttribute('data-tw'));
        if (k !== -1) { openReport(code, reports[k]); navPush('report', reports[k].week_start); }
        return;
      }
      if (e.target.closest('#reportBack')) {
        /* 목록으로 — 뒤로가기 기록이 레포트 한 편이면 뒤로가기와 같게 */
        var hs = nav.on && history.state;
        if (hs && hs.p && hs.hub && hs.hub.v === 'report') history.back();
        else { showReportList(); if (nav.on) history.replaceState({ hub: { v: 'reports', arg: '' }, p: hs && hs.p }, '', navHash('reports')); }
      }
    });
  }

  function showReportList() {
    var list = $('#reportOverview') || $('#reportListCard'), view = $('#reportView');
    if (list) list.hidden = false;
    if (view) view.hidden = true;
    RP.cur = -1;
    closePlayers(null);
  }

  function indexOfWeek(week) {
    for (var i = 0; i < RP.list.length; i++) if (!RP.list[i].draft && RP.list[i].week_start === week) return i;
    return -1;
  }
  function navReplace(r) {
    if (!nav.on) return;
    var hh = r.draft ? navHash('reports') : navHash('report', r.week_start);
    var p = history.state && history.state.p;
    history.replaceState({ hub: r.draft ? { v: 'reports', arg: '' } : { v: 'report', arg: r.week_start }, p: p }, '', hh);
  }

  /* 주차 띠 (가로로 밀기) + ◀ 지난주 · 다음주 ▶ — 목록은 최신이 앞이므로 '지난주' = 다음 칸 */
  function chipLabel(r) {
    if (r.draft) return '공개 전';
    if (r.lesson_date && global.Lesson && Lesson.md) return Lesson.md(r.lesson_date);
    return ReportView.shortDate(r.week_start);
  }
  function reportNavHtml(i) {
    var L = RP.list, n = L.length;
    if (n < 2) return '';
    var chips = L.map(function (r, k) { return k; }).reverse().map(function (k) {
      var r = L[k];
      return '<button type="button" class="rw-chip' + (k === i ? ' is-on' : '') + (r.draft ? ' rw-chip--draft' : '') + '" data-rw="' + k + '"' +
             (k === i ? ' aria-current="true"' : '') + '>' + esc(chipLabel(r)) + '</button>';
    }).join('');
    return '<div class="rw-arrows">' +
             '<button type="button" class="rw-arrow" data-rw="' + (i + 1) + '"' + (i + 1 >= n ? ' disabled' : '') + '>◀ 지난주</button>' +
             '<span class="rw-now num">' + esc(reportLabel(L[i])) + '</span>' +
             '<button type="button" class="rw-arrow" data-rw="' + (i - 1) + '"' + (i - 1 < 0 ? ' disabled' : '') + '>다음주 ▶</button>' +
           '</div>' +
           '<div class="rw-chips" role="list">' + chips + '</div>';
  }
  function drawReportNav(i) {
    var box = $('#reportNav');
    if (!box) return;
    box.innerHTML = reportNavHtml(i);
    var on = box.querySelector('.rw-chip.is-on');
    var strip = box.querySelector('.rw-chips');
    if (on && strip) {
      /* 고른 칩이 보이게 가로로 */
      var left = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
      strip.scrollLeft = Math.max(0, left);
    }
  }

  function openReport(code, r) {
    var body = $('#reportBody');
    var ov = $('#reportOverview') || $('#reportListCard');
    if (ov) ov.hidden = true;
    $('#reportView').hidden = false;
    closePlayers(null);
    var idx = RP.list.indexOf(r);
    if (idx === -1 && !r.draft) idx = indexOfWeek(r.week_start);
    RP.cur = idx;
    drawReportNav(idx);
    body.innerHTML = '<div class="empty">레포트를 불러오는 중입니다…</div>';
    window.scrollTo(0, 0);

    rpc('hub_report', { p_code: code, p_week: r.draft ? '__draft' : r.week_start }).then(function (data) {
      if (RP.cur !== idx) return;                       /* 그 사이 다른 주를 눌렀다 */
      if (!data) { body.innerHTML = '<div class="empty">이 레포트는 지금 볼 수 없습니다.</div>'; return; }
      ReportView.render(body, data);
      reportVideos(body, r);
      if (r.draft) body.insertAdjacentHTML('afterbegin', '<div class="pv-draft">아직 공개 전 — 지금 작성 내용으로 공개하면 이렇게 보입니다</div>');
      /* 그 주차(시작일 ~ 종료일) 필기를 레포트 아래에 함께 */
      if (global.Photos) {
        var box = document.createElement('div');
        box.className = 'report-photos';
        body.appendChild(box);
        var end = r.week_end || data.endDate || Photos.addDays(r.week_start, 6);
        Photos.weekCard(box, code, r.week_start, end);
      }
    }).catch(function () {
      body.innerHTML = '<div class="empty">불러오지 못했습니다. 새로고침해 주세요.</div>';
    });
  }

  /* 레포트 아래 — 그 주 수업 영상 (이번 주 수업 · 다시보기와 같은 목록에서) */
  function reportVideos(body, r) {
    if (r.draft || !WEEKLY || !r.week_start) return;
    function monday(iso) {
      var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
      return plusDays(String(iso).slice(0, 10), -((d.getUTCDay() + 6) % 7));
    }
    var mon = monday(r.week_start);
    var w = (WEEKLY.weeks || []).filter(function (x) { return x.week_start && monday(x.week_start) === mon; })[0];
    var vids = w ? sortVideos((w.videos || []).filter(function (v) { return v && safeUrl(v.url); })) : [];
    if (!vids.length) return;
    var box = document.createElement('div');
    box.className = 'card rw-videos';
    box.innerHTML = '<h2 class="card-title">▶️ 이 주 수업 영상</h2><div class="nt-videos">' + vids.map(weekVideoHtml).join('') + '</div>';
    body.appendChild(box);
  }

  /* ============================================================
     누적 추이 — 출석률 · 집중도 평균 · 복습 점수 · 과제 완료율 (hub_trend · migration-016)
       공개된 레포트의 출결 · 집중도 · 필수과제율, 선생님이 확인한 복습 점수만. 상담 · 성적 · 금액은 없다.
       출석률 = (출석 + 지각) / 기록이 있는 주 — 그래프는 그 주까지의 누적
       집중도 평균은 결석한 주(0)를 뺀다. 과제는 필수과제 완료율.
       점을 누르면 그 주 레포트가 열린다. 2주가 안 되면 "2주차부터 추이가 보입니다".
     ============================================================ */
  var TREND_INK = '#7858E8';

  function loadTrend(code) {
    var host = $('#trendCard');
    if (!host) return;
    rpc('hub_trend', { p_code: code }).then(function (t) {
      if (!t || !t.ok || !Array.isArray(t.weeks)) { host.innerHTML = ''; return; }
      host.innerHTML = trendHtml(t.weeks);
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
        hw: w.hw == null ? null : Math.round(Number(w.hw))
      };
    });
    return { rows: rows, present: present, counted: counted };
  }

  function trendHtml(weeks) {
    var head = '<h2 class="card-title">📈 누적 추이</h2>';
    if (weeks.length < 2) return '<div class="card tr-card">' + head + '<p class="hub-muted">2주차부터 추이가 보입니다.</p></div>';
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
      { key: 'review', name: '복습 점수', max: 100, fmt: function (v) { return Math.round(v) + '점'; } },
      { key: 'hw',     name: '과제 완료', max: 100, fmt: function (v) { return v + '%'; } }
    ].filter(function (c) { return rows.some(function (x) { return x[c.key] != null; }); });

    return '<div class="card tr-card">' + head +
      (summary.length ? '<p class="tr-sum num">' + esc(summary.join(' · ')) + '</p>' : '') +
      '<div class="tr-grid">' + charts.map(function (c) { return miniChart(c, rows); }).join('') + '</div>' +
      '<p class="tr-hint">점을 누르면 그 주 레포트가 열립니다</p>' +
      tableHtml(rows, charts) +
    '</div>';
  }

  function weekShort(x) {
    if (x.date && global.Lesson && Lesson.md) return Lesson.md(x.date);
    return ReportView.shortDate(x.week);
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

  /* ---------- 앱 과제 ---------- */

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

  var CAL_LABEL = { onTime: '정시 제출', late: '늦게 제출', none: '미제출' };

  function calendarHtml(days) {
    if (!days.length) return '';
    var byMonth = {};
    days.forEach(function (d) {
      var ym = d.date.slice(0, 7);
      (byMonth[ym] = byMonth[ym] || {})[d.date] = d;
    });

    var months = Object.keys(byMonth).sort().reverse();
    return months.map(function (ym) {
      var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var first = new Date(y, m - 1, 1).getDay();
      var last = new Date(y, m, 0).getDate();
      var cells = '';
      for (var i = 0; i < first; i++) cells += '<span class="cal-cell cal-cell--blank"></span>';
      for (var dd = 1; dd <= last; dd++) {
        var key = ym + '-' + String(dd).padStart(2, '0');
        var info = byMonth[ym][key];
        cells += '<span class="cal-cell' + (info ? ' cal-cell--' + info.status : '') + '"' +
                 (info ? ' title="' + esc(dd + '일 · ' + (info.order ? info.order + '차시 · ' : '') + CAL_LABEL[info.status]) + '"' : '') +
                 '>' + dd + '</span>';
      }
      return '<div class="cal">' +
               '<div class="cal-month">' + y + '년 ' + m + '월</div>' +
               '<div class="cal-grid">' +
                 ['일', '월', '화', '수', '목', '금', '토'].map(function (w) {
                   return '<span class="cal-dow">' + w + '</span>';
                 }).join('') + cells +
               '</div>' +
             '</div>';
    }).join('') +
    '<div class="cal-legend">' +
      '<span><i class="cal-key cal-cell--onTime"></i>정시 제출</span>' +
      '<span><i class="cal-key cal-cell--late"></i>늦게 제출</span>' +
      '<span><i class="cal-key cal-cell--none"></i>미제출</span>' +
    '</div>';
  }

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

  function recentHtml(list) {
    if (!list.length) return '';
    return '<ul class="app-recent">' + list.map(function (h) {
      var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(h.submittedAt || '');
      return '<li class="app-recent__row">' +
               '<span class="app-recent__date num">' + (d ? (+d[2]) + '/' + (+d[3]) : '-') + '</span>' +
               '<span class="app-recent__title">' + esc(h.title || (h.order + '차시 과제')) + '</span>' +
               (h.late ? '<span class="app-tag app-tag--late">지각</span>' : '<span class="app-tag">정시</span>') +
               (h.correctRate == null ? '' : '<span class="app-recent__rate num">' + h.correctRate + '%</span>') +
             '</li>';
    }).join('') + '</ul>';
  }

  function appOpenButton(app) {
    return app && app.share_url
      ? '<a class="hub-btn" href="' + esc(safeUrl(app.share_url)) + '" target="_blank" rel="noopener">앱 리포트 열기 ›</a>'
      : '';
  }

  function renderApp(code, app) {
    var host = $('#panelApp');

    if (!app.linked) {
      host.innerHTML = '<div class="empty">앱 과제 기록이 아직 연결되지 않았습니다.<br>선생님께 문의해 주세요.</div>';
      return;
    }

    host.innerHTML = '<div class="empty">앱 과제 기록을 불러오는 중입니다…</div>' +
                     '<div class="hub-actions">' + appOpenButton(app) + '</div>';

    appReport(code).then(function (res) {
      if (!res || !res.ok) {
        /* Edge Function 이 아직 없거나 앱 서버가 응답하지 않을 때.
           '앱 리포트 열기' 로 원래 화면을 볼 수 있게 남겨 둔다. */
        var why = res && res.reason === 'expired'
          ? '앱 공유 링크가 바뀐 것 같습니다. 선생님께 새 링크를 요청해 주세요.'
          : '여기서는 앱 과제 기록을 불러오지 못했습니다.<br>아래 버튼으로 앱 리포트를 열어 보세요.';
        host.innerHTML = '<div class="empty">' + why + '</div>' +
                         '<div class="hub-actions">' + appOpenButton(app) + '</div>';
        return;
      }

      var d = res.data || {};
      var s = d.stats || {};
      host.innerHTML =
        '<div class="card">' +
          '<h2 class="card-title">📱 앱 과제 요약' +
            (d.classTitle ? '<span class="card-note">' + esc(d.classTitle) + '</span>' : '') + '</h2>' +
          '<div class="rate-grid rate-grid--three">' +
            ring(s.submissionRate, '과제 제출률') +
            ring(s.onTimeRate, '정시 제출률') +
            ring(s.lectureRate, '강의 시청률') +
          '</div>' +
          '<p class="app-counts num">' +
            '제출 ' + (s.totalSubmitted || 0) + ' / ' + (s.totalHomework || 0) + '개' +
            ' · 정시 ' + (s.totalOnTime || 0) + '개' +
            ' · 강의 ' + (s.totalCompleted || 0) + ' / ' + (s.totalVideos || 0) + '개' +
          '</p>' +
        '</div>' +
        ((d.calendar || []).length
          ? '<div class="card"><h2 class="card-title">🗓️ 날짜별 제출</h2>' + calendarHtml(d.calendar) + '</div>'
          : '') +
        ((d.categories || []).length
          ? '<div class="card"><h2 class="card-title">🎯 영역별 정답률</h2>' + categoriesHtml(d.categories) + '</div>'
          : '') +
        ((d.recent || []).length
          ? '<div class="card"><h2 class="card-title">🧾 최근 제출</h2>' + recentHtml(d.recent) + '</div>'
          : '') +
        '<div class="hub-actions">' + appOpenButton(app) + '</div>';

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
      host.innerHTML = '<div class="empty">여기서는 앱 과제 기록을 불러오지 못했습니다.<br>아래 버튼으로 앱 리포트를 열어 보세요.</div>' +
                       '<div class="hub-actions">' + appOpenButton(app) + '</div>';
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
