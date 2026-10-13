/* ============================================================
   hub.js — 학생·학부모 화면 (개인 페이지 /me/ · 반 공지 /notice/)

   로그인이 없다. 주소의 # 뒤 코드를 Supabase 공개 함수에 넘기고,
   함수가 돌려준 것만 그린다. 표를 직접 읽지 않는다.
     /me/#개인링크코드          → hub_get · hub_report · Edge Function(app-report)
     /me/#개인링크코드/report   → 내 레포트 탭의 최신 레포트를 바로 연다
     /me/#개인링크코드/book     → 교재비 탭 (hub_textbook — 그 학생 청구서만)
     /notice/#반코드            → class_notice_get

   # 뒤의 값은 서버 로그에도, 다른 사이트로 넘어가는 주소(referrer)에도
   남지 않는다. 그래서 코드를 ?code= 가 아니라 # 뒤에 둔다.
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var esc = function (v) { return global.ReportView ? ReportView.esc(v) : String(v == null ? '' : v); };

  /* ============================================================
     서버 부르기
     ============================================================ */

  function rpc(name, args) {
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
        var id = youtubeId(v.url);
        return '<a class="nt-video" href="' + esc(safeUrl(v.url)) + '" target="_blank" rel="noopener">' +
                 (id
                   ? '<span class="nt-video__thumb" style="background-image:url(https://i.ytimg.com/vi/' + id + '/mqdefault.jpg)">' +
                       '<span class="nt-video__play" aria-hidden="true">▶</span></span>'
                   : '<span class="nt-video__thumb nt-video__thumb--none"><span class="nt-video__play" aria-hidden="true">▶</span></span>') +
                 '<span class="nt-video__title">' + esc(v.title || '수업 영상') + '</span>' +
               '</a>';
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
      if (!d.classList || !d.classList.contains('nt-past') || !d.open) return;
      var body = d.querySelector('.nt-past__body');
      if (body && !body.dataset.done) {
        body.innerHTML = noticeBodyHtml(list[+d.dataset.i]);
        body.dataset.done = '1';
      }
    }, true);
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
    return { code: parts[0] || '', view: parts[1] || '' };
  }

  function bootMe() {
    var root = $('#hubRoot');
    var head = $('#hubHead');
    var tabs = $('#hubTabs');
    var h = parseHash();

    if (!/^[A-Za-z0-9]{20,64}$/.test(h.code)) { stopScreen(root, 'nocode'); return; }

    rpc('hub_get', { p_code: h.code }).then(function (d) {
      if (!d || !d.ok) { stopScreen(root, (d && d.reason) || 'notfound'); return; }

      var st = d.student || {};
      $('#hubName').textContent = (st.name || '') + ' 학생';
      $('#hubMeta').textContent = [st.class_name, st.school, st.grade].filter(Boolean).join(' · ');
      renderDday(d.exam, (st.name || '') + ' 학생');
      head.hidden = false;
      tabs.hidden = false;
      setTitle((st.name || '') + ' · ' + (global.BRAND ? BRAND.brandName : '마라톤국어'));

      root.innerHTML =
        '<section class="hub-panel" id="panelNotice" role="tabpanel"></section>' +
        '<section class="hub-panel" id="panelReport" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelApp" role="tabpanel" hidden></section>' +
        '<section class="hub-panel" id="panelBook" role="tabpanel" hidden></section>';

      /* 반 공지 */
      var pn = $('#panelNotice');
      pn.innerHTML = noticesHtml(d.notices || []);
      bindArchive(pn, d.notices || []);

      /* 내 레포트 */
      var reports = d.reports || [];
      renderReportList(h.code, reports);
      if (reports.length) $('#tabReport').classList.add('has-new');

      /* 앱 과제 — 처음 열 때 불러온다 */
      var appLoaded = false;
      function openApp() {
        if (appLoaded) return;
        appLoaded = true;
        renderApp(h.code, d.app || {});
      }

      function select(which) {
        [['notice', '#tabNotice', '#panelNotice'],
         ['report', '#tabReport', '#panelReport'],
         ['app',    '#tabApp',    '#panelApp'],
         ['book',   '#tabBook',   '#panelBook']].forEach(function (t) {
          var on = t[0] === which;
          $(t[1]).setAttribute('aria-selected', on ? 'true' : 'false');
          $(t[2]).hidden = !on;
        });
        if (which === 'app') openApp();
        if (which === 'report') $('#tabReport').classList.remove('has-new');
      }

      $('#tabNotice').onclick = function () { select('notice'); };
      $('#tabReport').onclick = function () { select('report'); showReportList(); };
      $('#tabApp').onclick    = function () { select('app'); };
      $('#tabBook').onclick   = function () { select('book'); };

      if (h.view === 'report') {
        select('report');
        if (reports.length) openReport(h.code, reports[0]);
      } else if (h.view === 'app') {
        select('app');
      } else {
        select('notice');
      }

      /* 교재비 — 청구서가 있는 학생에게만 탭이 보인다.
         2단계 SQL 을 아직 안 돌렸거나 실패해도 다른 탭은 그대로 쓴다. */
      rpc('hub_textbook', { p_code: h.code }).then(function (tb) {
        if (!tb || !tb.ok || !(tb.bills || []).length) return;
        renderBook(tb);
        $('#tabBook').hidden = false;
        tabs.classList.add('hub-tabs--4');
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

  function renderReportList(code, reports) {
    var host = $('#panelReport');
    if (!reports.length) {
      host.innerHTML = '<div class="empty">아직 공개된 주간 레포트가 없습니다.</div>';
      return;
    }
    host.innerHTML =
      '<div class="card" id="reportListCard">' +
        '<h2 class="card-title">🗓️ 주간 레포트<span class="card-note">' + reports.length + '편</span></h2>' +
        '<ul class="rp-list">' + reports.map(function (r, i) {
          return '<li><button type="button" class="rp-item" data-i="' + i + '">' +
                   '<span class="rp-item__week num">' + esc(ReportView.shortPeriod(r.week_start, r.week_end) || ReportView.shortDate(r.week_start)) + '</span>' +
                   '<span class="rp-item__label">주간 학습 레포트</span>' +
                   (i === 0 ? '<span class="rp-item__new">NEW</span>' : '') +
                   '<span class="rp-item__go" aria-hidden="true">›</span>' +
                 '</button></li>';
        }).join('') + '</ul>' +
      '</div>' +
      '<div id="reportView" hidden>' +
        '<button type="button" class="hub-back" id="reportBack">‹ 레포트 목록</button>' +
        '<div id="reportBody"></div>' +
      '</div>';

    host.addEventListener('click', function (e) {
      var b = e.target.closest('.rp-item');
      if (b) { openReport(code, reports[+b.dataset.i]); return; }
      if (e.target.closest('#reportBack')) showReportList();
    });
  }

  function showReportList() {
    var list = $('#reportListCard'), view = $('#reportView');
    if (list) list.hidden = false;
    if (view) view.hidden = true;
  }

  function openReport(code, r) {
    var body = $('#reportBody');
    $('#reportListCard').hidden = true;
    $('#reportView').hidden = false;
    body.innerHTML = '<div class="empty">레포트를 불러오는 중입니다…</div>';
    window.scrollTo(0, 0);

    rpc('hub_report', { p_code: code, p_week: r.week_start }).then(function (data) {
      if (!data) { body.innerHTML = '<div class="empty">이 레포트는 지금 볼 수 없습니다.</div>'; return; }
      ReportView.render(body, data);
    }).catch(function () {
      body.innerHTML = '<div class="empty">불러오지 못했습니다. 새로고침해 주세요.</div>';
    });
  }

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
      setTitle(d.class_name + ' 반 공지 · ' + (global.BRAND ? BRAND.brandName : '마라톤국어'));
      root.innerHTML = noticesHtml(d.notices || []);
      bindArchive(root, d.notices || []);
    }).catch(function () { stopScreen(root, 'network'); });
  }

  /* 주소의 # 뒤만 바꿔 다른 링크를 열면 새로 읽는다 */
  global.addEventListener('hashchange', function () { location.reload(); });

  global.Hub = { bootMe: bootMe, bootNotice: bootNotice, youtubeId: youtubeId };

})(window);
