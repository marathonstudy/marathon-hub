/* ============================================================
   report-view.js — 주간 레포트 한 편을 그린다

   개인 페이지(/me/)의 '내 레포트' 와 생성기 ② 작성 탭의 미리보기가
   이 파일 하나를 같이 쓴다. 그래서 미리보기와 학부모 화면이 어긋나지 않는다.

   ReportView.render(그릴자리, 레포트데이터)

   레포트 데이터 (admin/report.js 의 toReportData 가 만든다)
     school · grade · studentName · startDate · endDate
     attendance {status: attend|late|absent|makeup, note}
     lessons ["1차시 내용", …]  focusScore 0~5
     tests [{name, score}]
     homeworkItems [{key, group: required|optional, name}]
     homework {h1: {"월":true, …}}
     requiredRate · optionalRate (-1 이면 그 묶음 없음)
     comment
     lessonDate · lessonDays[] · hwFrom · hwTo  (반 수업 요일을 정한 뒤 공개한 레포트만 · migration-011)
       있으면 머리에 "수업일 10/15(목) · 과제 기간 10/8~10/14", 없으면(예전 레포트) 예전처럼 기간
   ============================================================ */

(function (global) {
  'use strict';

  var DAYS = ['월', '화', '수', '목', '금'];

  function B() {
    return global.BRAND || { reportBrand: '마라톤국어', commentTitle: '종합 코멘트' };
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pct(v) {
    var n = Math.round(Number(v) || 0);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }

  function formatDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '').trim());
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  function formatPeriod(start, end) {
    var s = formatDate(start), e = formatDate(end);
    if (s && e) return s + ' ~ ' + e;
    return s || e || '';
  }

  function shortDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '').trim());
    return m ? Number(m[2]) + '/' + Number(m[3]) : '';
  }

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function dowDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '').trim());
    if (!m) return '';
    return Number(m[2]) + '/' + Number(m[3]) + '(' + DOW[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ')';
  }

  /* "수업일 10/15(목) · 과제 기간 10/8~10/14" — 수업일이 없는 예전 레포트는 '' */
  function lessonLine(d) {
    if (!d || !shortDate(d.lessonDate)) return '';
    var days = (d.lessonDays && d.lessonDays.length ? d.lessonDays : [d.lessonDate]).map(dowDate).filter(Boolean);
    return '수업일 ' + days.join(' · ') +
      (shortDate(d.hwFrom) && shortDate(d.hwTo) ? ' · 과제 기간 ' + shortDate(d.hwFrom) + '~' + shortDate(d.hwTo) : '');
  }

  function shortPeriod(start, end) {
    var s = shortDate(start), e = shortDate(end);
    if (s && e) return s + '~' + e;
    return s || e || '';
  }

  /* '수업 1차시: 내용' → { no: '1차시', text: '내용' } */
  function splitLesson(raw, index) {
    var text = String(raw == null ? '' : raw).trim();
    var m = /^(?:수업\s*)?(\d+)\s*차시\s*[:：.\-]?\s*([\s\S]*)$/.exec(text);
    if (m && m[2].trim()) return { no: m[1] + '차시', text: m[2].trim() };
    return { no: (index + 1) + '차시', text: text };
  }

  function card(title, body, note) {
    return '<div class="card">' +
             '<h2 class="card-title">' + title +
               (note ? '<span class="card-note">' + esc(note) + '</span>' : '') +
             '</h2>' + body +
           '</div>';
  }

  /* ---------- 헤더 · 학생 정보 ---------- */

  /* 머리의 로고 (assets/brand.js 의 logo). 브랜드 파일이 없으면 예전 책 그림 */
  function logoHtml() {
    var url = B().logoUrl;
    if (!url) return '<div class="header-emoji">📘</div>';
    return '<div class="header-logo"><img src="' + esc(url) + '" alt="' + esc(B().reportBrand) + '" width="105" height="60"></div>';
  }

  function headerHtml(d) {
    var line = lessonLine(d) || formatPeriod(d.startDate, d.endDate);
    return '' +
      '<div class="header">' +
        logoHtml() +
        '<div class="header-title">' + esc(B().reportBrand) + '<br>주간 학습 레포트</div>' +
        (line ? '<div class="header-period num">📅 ' + esc(line) + '</div>' : '') +
      '</div>';
  }

  function studentHtml(d) {
    var rows = [['학교', d.school], ['학년', d.grade], ['이름', d.studentName]];
    var body = '<div class="student-info">' + rows.map(function (r) {
      return '<div class="info-item">' +
               '<div class="info-label">' + r[0] + '</div>' +
               '<div class="info-value">' + (esc(r[1]) || '-') + '</div>' +
             '</div>';
    }).join('') + '</div>';
    return card('📋 학생 정보', body);
  }

  /* ---------- 출결 ---------- */

  var MARKS = {
    attend:
      '<circle cx="29" cy="29" r="26" fill="currentColor"/>' +
      '<path d="M18 29.5 L26 37 L41 21" fill="none" stroke="#fff" stroke-width="4.6"' +
      ' stroke-linecap="round" stroke-linejoin="round"/>',
    late:
      '<path d="M29 9 L51 48 L7 48 Z" fill="currentColor" stroke="currentColor"' +
      ' stroke-width="6" stroke-linejoin="round"/>',
    absent:
      '<path d="M15 15 L43 43 M43 15 L15 43" fill="none" stroke="currentColor"' +
      ' stroke-width="7" stroke-linecap="round"/>',
    makeup:
      '<circle cx="29" cy="29" r="25" fill="none" stroke="currentColor" stroke-width="4.5"/>' +
      '<path d="M18 29.5 L26 37 L41 21" fill="none" stroke="currentColor" stroke-width="4.6"' +
      ' stroke-linecap="round" stroke-linejoin="round"/>',
    none:
      '<circle cx="29" cy="29" r="25" fill="none" stroke="currentColor" stroke-width="4.5"' +
      ' stroke-dasharray="5 7"/>'
  };

  var LABELS = { attend: '출석', late: '지각', absent: '결석', makeup: '보강 완료', none: '기록 없음' };

  function attendanceHtml(d) {
    var a = d.attendance || {};
    var key = MARKS[a.status] && a.status !== 'none' ? a.status : 'none';
    var note = String(a.note == null ? '' : a.note).trim();
    var body = '' +
      '<div class="att-box att-box--' + key + '">' +
        '<div class="att-mark">' +
          '<svg viewBox="0 0 58 58" aria-hidden="true" focusable="false">' + MARKS[key] + '</svg>' +
        '</div>' +
        '<div class="att-state">' + LABELS[key] + '</div>' +
        (note ? '<div class="att-note">' + esc(note) + '</div>' : '') +
      '</div>';
    return card('📅 출결', body);
  }

  /* ---------- 학습 내용 · 집중도 · 테스트 ---------- */

  function lessonsHtml(d) {
    var list = (d.lessons || []).filter(function (l) { return String(l || '').trim(); });
    if (!list.length) return '';
    var body = '<ul class="lesson-list">' + list.map(function (raw, i) {
      var L = splitLesson(raw, i);
      return '<li class="lesson-item">' +
               '<span class="lesson-check">✓</span>' +
               '<span><b class="lesson-no">' + esc(L.no) + '</b>' + esc(L.text) + '</span>' +
             '</li>';
    }).join('') + '</ul>';
    return card('📖 이번주 학습 내용', body, '총 ' + list.length + '차시');
  }

  function focusHtml(d) {
    var score = Math.max(0, Math.min(5, Math.round(Number(d.focusScore) || 0)));
    if (!score && d.attendance && d.attendance.status === 'absent') return '';
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<span class="focus-star' + (i <= score ? ' active' : '') + '">★</span>';
    }
    var body = '<div class="focus-stars" aria-hidden="true">' + stars + '</div>' +
               '<div class="focus-score-text num">' + score + ' / 5 점</div>' +
               '<span class="sr-only">수업 집중도 5점 만점에 ' + score + '점</span>';
    return card('⭐ 수업 집중도', body);
  }

  function testsHtml(d) {
    var list = (d.tests || []).filter(function (t) { return t && String(t.name || '').trim(); });
    if (!list.length) return '';
    var body = list.map(function (t) {
      var score = pct(t.score);
      if (t.kind === 'review') {
        return '<div class="test-item">' +
                 '<div class="test-header">' +
                   '<span class="test-name">' + esc(t.name) + '<span class="test-badge test-badge--ok">선생님 확인</span></span>' +
                   '<span class="test-score-text num">' + (+t.correct) + ' / ' + (+t.total) + ' · ' + score + '<small>점</small></span>' +
                 '</div>' +
                 '<div class="progress-bar"><div class="progress-fill" data-width="' + score + '"></div></div>' +
               '</div>';
      }
      var none = score === 0;
      return '<div class="test-item' + (none ? ' is-none' : '') + '">' +
               '<div class="test-header">' +
                 '<span class="test-name">' + esc(t.name) +
                   (none ? '<span class="test-badge">미응시</span>' : '') +
                 '</span>' +
                 '<span class="test-score-text num">' + score + ' <small>/ 100</small></span>' +
               '</div>' +
               '<div class="progress-bar">' +
                 '<div class="progress-fill" data-width="' + score + '"></div>' +
               '</div>' +
             '</div>';
    }).join('');
    return card('📝 리뷰테스트 점수', body);
  }

  /* ---------- 과제 — 항목마다 월~금 ---------- */

  function hwDaysGroupHtml(title, items, hw, kind) {
    if (!items.length) return '';
    var done = 0;
    var rows = items.map(function (it) {
      var v = hw[it.key];
      var marks = [];
      var dots = DAYS.map(function (day) {
        var ok = !!(v && typeof v === 'object' && v[day]);
        if (ok) { done++; marks.push(day); }
        return '<span class="hwd-dot' + (ok ? ' done' : '') + '">' + (ok ? '✓' : '✗') + '</span>';
      }).join('');
      return '<li class="hwd-row">' +
               '<span class="hwd-name">' + esc(it.name) + '</span>' +
               '<span class="hwd-dots" aria-hidden="true">' + dots + '</span>' +
               '<span class="sr-only">' +
                 (marks.length ? marks.join('·') + '요일 제출' : '제출한 요일 없음') +
               '</span>' +
             '</li>';
    }).join('');

    return '<div class="hwd-group hwd-group--' + kind + '">' +
             '<div class="hwd-head">' +
               '<span class="hwd-title">' + title + '</span>' +
               '<span class="hwd-count num">' + done + ' / ' + (items.length * DAYS.length) + '</span>' +
               '<span class="hwd-days-label" aria-hidden="true">' +
                 DAYS.map(function (day) { return '<span>' + day + '</span>'; }).join('') +
               '</span>' +
             '</div>' +
             '<ul class="hwd-list">' + rows + '</ul>' +
           '</div>';
  }

  function homeworkHtml(d) {
    var items = d.homeworkItems || [];
    if (!items.length) return '';
    var hw = d.homework || {};
    var req = items.filter(function (it) { return it.group !== 'optional'; });
    var opt = items.filter(function (it) { return it.group === 'optional'; });
    return card('✅ 과제 수행',
      hwDaysGroupHtml('필수과제', req, hw, 'required') +
      hwDaysGroupHtml('선택과제', opt, hw, 'optional'));
  }

  /* ---------- 과제 제출률 (원형 게이지) ---------- */

  function rateCircle(value, label) {
    var v = pct(value);
    var R = 45;
    var C = 2 * Math.PI * R;
    return '' +
      '<div class="rate-circle-wrapper' + (v === 0 ? ' is-zero' : '') + '">' +
        '<div class="rate-circle">' +
          '<svg viewBox="0 0 110 110" aria-hidden="true" focusable="false">' +
            '<circle class="rate-circle-bg" cx="55" cy="55" r="' + R + '" fill="none" stroke-width="10"/>' +
            '<circle class="rate-circle-fill" cx="55" cy="55" r="' + R + '" fill="none" stroke-width="10"' +
              ' stroke-dasharray="' + C.toFixed(2) + '"' +
              ' stroke-dashoffset="' + C.toFixed(2) + '"' +
              ' data-offset="' + (C - (v / 100) * C).toFixed(2) + '"/>' +
          '</svg>' +
          '<div class="rate-num num">' + v + '<small>%</small></div>' +
        '</div>' +
        '<div class="rate-label">' + esc(label) + '</div>' +
      '</div>';
  }

  function pctOrNull(v) {
    var n = Number(v);
    if (v == null || isNaN(n) || n < 0) return null;
    return pct(n);
  }

  function ratesHtml(d) {
    var parts = [];
    if (pctOrNull(d.requiredRate) !== null) parts.push(rateCircle(d.requiredRate, '필수과제 제출률'));
    if (pctOrNull(d.optionalRate) !== null) parts.push(rateCircle(d.optionalRate, '선택과제 제출률'));
    if (!parts.length) return '';
    return card('📊 과제 제출률',
      '<div class="rate-grid' + (parts.length === 1 ? ' rate-grid--one' : '') + '">' +
        parts.join('') +
      '</div>');
  }

  /* ---------- 종합 코멘트 ---------- */

  function commentHtml(d) {
    var text = String(d.comment == null ? '' : d.comment).trim();
    if (!text) return '';
    var body = '<div class="comment-box">' +
                 '<span class="comment-quote-open" aria-hidden="true">“</span>' +
                 esc(text) +
                 '<span class="comment-quote-close" aria-hidden="true">”</span>' +
               '</div>';
    return card('✍️ ' + esc(B().commentTitle), body);
  }

  /* ---------- 채움 애니메이션 ---------- */

  function animate(root) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.querySelectorAll('.progress-fill').forEach(function (el) {
          el.style.width = el.getAttribute('data-width') + '%';
        });
        root.querySelectorAll('.rate-circle-fill').forEach(function (el) {
          el.setAttribute('stroke-dashoffset', el.getAttribute('data-offset'));
        });
      });
    });
  }

  /* 원형 게이지가 쓰는 그라데이션. 한 페이지에 한 번만 넣는다. */
  function ensureGradient() {
    if (document.getElementById('brandGrad')) return;
    var holder = document.createElement('div');
    holder.innerHTML =
      '<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">' +
        '<defs><linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">' +
          '<stop offset="0%" stop-color="#9A82F0"/><stop offset="100%" stop-color="#5B42D6"/>' +
        '</linearGradient></defs>' +
      '</svg>';
    document.body.appendChild(holder.firstChild);
  }

  function render(root, data, opts) {
    opts = opts || {};
    ensureGradient();
    try {
      root.innerHTML =
        (opts.noHeader ? '' : headerHtml(data)) +
        studentHtml(data) +
        attendanceHtml(data) +
        lessonsHtml(data) +
        focusHtml(data) +
        testsHtml(data) +
        homeworkHtml(data) +
        ratesHtml(data) +
        commentHtml(data);
      animate(root);
    } catch (e) {
      root.innerHTML = '<div class="empty">레포트를 그리지 못했습니다.<br>선생님께 다시 확인 부탁드립니다.</div>';
    }
  }

  global.ReportView = {
    render: render,
    esc: esc,
    shortPeriod: shortPeriod,
    shortDate: shortDate,
    dowDate: dowDate,
    lessonLine: lessonLine,
    formatPeriod: formatPeriod,
    DAYS: DAYS
  };

})(window);
