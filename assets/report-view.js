/* ============================================================
   report-view.js — 주간 레포트 한 편을 그린다

   개인 페이지(/me/)의 「레포트」 탭과 코치룸 미리보기가
   이 파일 하나를 같이 쓴다. 그래서 미리보기와 학부모 화면이 어긋나지 않는다.

   ReportView.render(그릴자리, 레포트데이터)

   레포트 데이터 (admin/report.js 의 toReportData 가 만든다)
     school · grade · studentName · startDate · endDate
     attendance {status: attend|late|absent (예전 makeup 은 출석으로 보임), note}
     lessons ["1차시 내용", …]  focusScore 0~5
     tests [{name, score, correct, total}] — 복습테스트(kind: review)만 보인다. 낸 점수 그대로 「8/10」 (확인 단계 없음 · 20261030a)
           예전 레포트의 {submitted: true} → 「제출 완료」 · 미응시면 {absent: 사유 이름} → 「미응시 · 결석」 (사유 없이 안 냈으면 「미응시」)
     비어 있는 칸(출결 · 집중도 · 코멘트 · 복습테스트)은 그리지 않는다 (20261030a)
     (예전 레포트의 수기 리뷰테스트 점수 · homework · requiredRate 는 남아 있어도 그리지 않는다 · 20261029g)
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

  /* 글 표시 — **굵게** · __굵게__ 는 굵게, 줄 앞 # 제목 기호와 남은 ** · __ 는 지운다 (저장된 글은 그대로 · 20261029g) */
  function mdHtml(v) {
    return esc(v)
      .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
      .replace(/__([^_\n]+?)__/g, '<b>$1</b>')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/\*\*|__/g, '');
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

  /* opts.noPeriod — 수업일을 모르는 예전 레포트도 주 시작일 · 기간은 쓰지 않는다 (러닝노트 · 20261029i) */
  function headerHtml(d, opts) {
    var line = lessonLine(d) || (opts && opts.noPeriod ? '' : formatPeriod(d.startDate, d.endDate));
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
  /* 예전 기록의 보강(makeup)은 「출석」으로 보인다 (저장된 값은 그대로) */
  function statusOf(d) {
    var st = (d && d.attendance && d.attendance.status) || '';
    return st === 'makeup' ? 'attend' : st;
  }

  function attendanceHtml(d) {
    var a = d.attendance || {};
    var st = statusOf(d);
    if (!MARKS[st] || st === 'none') return '';      /* 출결을 안 넣었으면 칸을 숨긴다 (20261030a) */
    var key = MARKS[st] && st !== 'none' ? st : 'none';
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

  /* ---------- 수업 요약 한 차시 → 머리말 + 점 목록 (20261031x) ----------
     새 모양: 「독서 · 인문\n· 롤스와 매킨타이어의 정의관\n· …」 (lesson-summary 가 만든다 · 번호는 화면이 「1교시」로)
     예전 한 줄 「1차시: 현대시 「진달래꽃」 — 화자의 정서와 반어 표현 분석」도 같은 모양으로 보여 준다
       (— 앞 = 머리말 · 뒤 = 점 · 쉼표로 이어 붙인 것은 나눈다) · 저장된 글은 바꾸지 않는다 */
  function lessonBlock(raw, i) {
    var parts = String(raw == null ? '' : raw).replace(/\r/g, '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    var first = parts[0] || '';
    var m = /^(?:수업\s*)?(\d+)\s*(?:차시|교시)\s*[:：.\-]?\s*([\s\S]*)$/.exec(first);
    var no = i + 1, rest = m ? m[2].trim() : first;          /* 번호는 자리 순서로 (적힌 「N차시」는 떼어 낸다) */
    var head = rest, points = [];
    if (parts.length > 1) {
      points = parts.slice(1).map(function (p) { return p.replace(/^[·•\-*]\s*/, '').trim(); }).filter(Boolean);
    } else {
      var seg = rest.split(/\s+[—–]\s+/);
      if (seg.length > 1) {
        head = seg[0];
        seg.slice(1).join(', ').split(/\s*,\s+|\s+·\s+/).forEach(function (p) { p = p.trim(); if (p) points.push(p); });
      } else if (rest.length > 18) { head = ''; points = [rest]; }
    }
    return { no: no, head: head.replace(/^[·•\-*]\s*/, '').trim(), points: points.slice(0, 6) };
  }
  function lessonBlocksHtml(list) {
    list = (list || []).filter(function (l) { return String(l || '').trim(); });
    if (!list.length) return '';
    return '<div class="lb-list">' + list.map(function (raw, i) {
      var b = lessonBlock(raw, i);
      return '<div class="lb">' +
               '<p class="lb-head"><b class="lb-no">' + b.no + '교시</b>' + (b.head ? '<span class="lb-topic">' + mdHtml(b.head) + '</span>' : '') + '</p>' +
               (b.points.length ? '<ul class="lb-pts">' + b.points.map(function (p) { return '<li>' + mdHtml(p) + '</li>'; }).join('') + '</ul>' : '') +
             '</div>';
    }).join('') + '</div>';
  }

  function lessonsHtml(d) {
    var list = (d.lessons || []).filter(function (l) { return String(l || '').trim(); });
    if (!list.length) return '';
    return card('📖 이번주 학습 내용', lessonBlocksHtml(list), '총 ' + list.length + '차시');
  }

  function focusHtml(d) {
    var score = Math.max(0, Math.min(5, Math.round(Number(d.focusScore) || 0)));
    if (statusOf(d) === 'absent') return '';          /* 결석한 주는 집중도 줄을 숨긴다 */
    if (!score) return '';                            /* 집중도를 안 넣었으면 숨긴다 (20261030a) */
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<span class="focus-star' + (i <= score ? ' active' : '') + '">★</span>';
    }
    var body = '<div class="focus-stars" aria-hidden="true">' + stars + '</div>' +
               '<div class="focus-score-text num">' + score + ' / 5 점</div>' +
               '<span class="sr-only">수업 집중도 5점 만점에 ' + score + '점</span>';
    return card('⭐ 수업 집중도', body);
  }

  /* 복습테스트 — 학생 QR 기록만 (수기 리뷰테스트 점수는 그리지 않는다 · 20261029g).
     낸 시험은 「8 / 10」 그대로(확인 단계 없음 · 20261030a), 미응시면 「미응시 · 결석」(사유 이름만 · 20261029h) · 사유 없이 안 냈으면 「미응시」 */
  function testsHtml(d) {
    var list = (d.tests || []).filter(function (t) { return t && t.kind === 'review' && String(t.name || '').trim(); });
    if (!list.length) return '';
    var body = list.map(function (t) {
      if (t.absent) {
        return '<div class="test-item test-item--abs">' +
                 '<div class="test-header">' +
                   '<span class="test-name">' + esc(t.name) + '</span>' +
                   '<span class="test-badge test-badge--abs">' + esc(absentText(t.absent)) + '</span>' +
                 '</div>' +
               '</div>';
      }
      if (t.submitted) {
        return '<div class="test-item test-item--sub">' +
                 '<div class="test-header">' +
                   '<span class="test-name">' + esc(t.name) + '</span>' +
                   '<span class="test-badge test-badge--sub">제출 완료</span>' +
                 '</div>' +
               '</div>';
      }
      var score = pct(t.score);
      return '<div class="test-item">' +
               '<div class="test-header">' +
                 '<span class="test-name">' + esc(t.name) + '</span>' +
                 '<span class="test-score-text num">' + (t.correct != null && t.total != null ? (+t.correct) + ' / ' + (+t.total) : score + '<small>점</small>') + '</span>' +
               '</div>' +
               '<div class="progress-bar"><div class="progress-fill" data-width="' + score + '"></div></div>' +
             '</div>';
    }).join('');
    return card('📝 복습테스트', body);
  }

  /* 「미응시 · 결석」 — 사유 이름이 없으면 「미응시」 · 작성 화면에서 「응시」(점수는 아직)로 둔 것은 「응시」 (migration-048) */
  function absentText(reason) {
    var r = String(reason === true ? '' : reason || '').trim();
    if (r === '응시') return '응시';
    return r && r !== '미응시' ? '미응시 · ' + r : '미응시';
  }

  /* ---------- 종합 코멘트 ---------- */

  function commentHtml(d) {
    var text = String(d.comment == null ? '' : d.comment).trim();
    if (!text) return '';
    var body = '<div class="comment-box">' +
                 '<span class="comment-quote-open" aria-hidden="true">“</span>' +
                 mdHtml(text) +
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
        commentHtml(data);       /* 수기 과제 수행 · 과제 제출률 카드는 그리지 않는다 (앱 연동으로 · 20261029g) */
      animate(root);
    } catch (e) {
      root.innerHTML = '<div class="empty">레포트를 그리지 못했습니다.<br>선생님께 다시 확인 부탁드립니다.</div>';
    }
  }

  /* 러닝노트 「레포트」 탭이 칸을 골라 다시 늘어놓을 때 (hub.js · 20261029i)
     parts: header · student · attendance · lessons · focus · tests · comment */
  var PARTS = { header: headerHtml, student: studentHtml, attendance: attendanceHtml, lessons: lessonsHtml,
                focus: focusHtml, tests: testsHtml, comment: commentHtml };
  function partsHtml(data, parts, opts) {
    ensureGradient();
    return (parts || []).map(function (p) {
      try { return PARTS[p] ? PARTS[p](data || {}, opts) : ''; } catch (e) { return ''; }
    }).join('');
  }

  global.ReportView = {
    render: render,
    partsHtml: partsHtml,
    animate: animate,
    esc: esc,
    mdHtml: mdHtml,
    absentText: absentText,
    shortPeriod: shortPeriod,
    shortDate: shortDate,
    dowDate: dowDate,
    lessonLine: lessonLine,
    lessonBlock: lessonBlock,
    lessonBlocksHtml: lessonBlocksHtml,
    formatPeriod: formatPeriod,
    DAYS: DAYS
  };

})(window);
