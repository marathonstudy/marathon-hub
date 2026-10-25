/* ============================================================
   review-note.js — 복습 노트 (한 장 요약 + OX 퀴즈) 보기 · 20261031l · migration-039
   러닝노트(학생 · 학부모 링크)와 코치룸 미리보기가 같이 쓴다. 확정된 노트만 받는다 (hub_review_notes).

   휴대폰(360~390px 세로)이 먼저 — 컴퓨터에서는 가운데 좁은 폭(최대 560px)으로 같은 모양
     · 표 · 2단 없이 위에서 아래로 한 칸씩 · 본문 16px · 줄 간격 1.7 · 좌우 여백 16px
     · 맨 위 「약 8분 · 2차시 · OX 5문항」 + 읽은 만큼 차오르는 얇은 막대 · 「1차시 · 2차시 · OX」 탭 고정(누르면 그 카드로 부드럽게)
     · 차시마다 카드 하나: 오늘의 한 줄 · 행동 강령(굵은 번호 목록) · 꼭 기억할 말(인용 상자)은 늘 펼침,
       「이렇게 적용했다」 「자주 하는 실수」는 두 줄만 보이다 [더 보기]
     · OX — 학생 링크: 한 화면에 한 문제 · 큰 O · X(56px) · 누르면 정답 · 해설 · [다음 문제 →] · 「3/5」 · 끝나면 「4/5 맞음 · 다시 풀기」
             결과는 이 기기에만 「지난번 4/5」 (서버 · 학부모 화면에는 없다)
             학부모 링크: 문제와 정답 · 해설을 접어서 (풀었는지 · 몇 개 맞았는지는 어디에도 없다)
     · [인쇄 / PDF 저장] — A4 한 장(넘치면 두 장) · OX 정답은 맨 아래 작게
   ============================================================ */

(function (global) {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function md(iso) {
    var d = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '(' + DOW[new Date(d + 'T00:00:00Z').getUTCDay()] + ')';
  }
  function list(v) { return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean); }

  /* 보여 줄 OX — 「OX 빼기」 · 「OX 없음」이면 [] */
  function quizOf(note) {
    if (!note || note.quizOff || note.quizNone) return [];
    return (Array.isArray(note.quiz) ? note.quiz : []).filter(function (q) { return q && String(q.q || '').trim() && (q.a === 'O' || q.a === 'X'); });
  }
  function lessonsOf(note) { return (note && Array.isArray(note.lessons) ? note.lessons : []).filter(function (l) { return l && (String(l.oneLine || '').trim() || list(l.actions).length); }); }
  /* 읽는 시간 — 한글 1분 450자 · OX 한 문항 20초 · 1분 아래는 1분 */
  function minutes(note) {
    var chars = 0;
    lessonsOf(note).forEach(function (l) {
      chars += String(l.oneLine || '').length;
      ['passages', 'actions', 'applied', 'mistakes', 'remember'].forEach(function (k) { list(l[k]).forEach(function (t) { chars += t.length; }); });
    });
    return Math.max(1, Math.ceil(chars / 450 + quizOf(note).length / 3));
  }
  function metaText(note) {
    var q = quizOf(note).length;
    return '약 ' + minutes(note) + '분 · ' + lessonsOf(note).length + '차시' + (q ? ' · OX ' + q + '문항' : '');
  }
  function dayOf(item) { return md(item && (item.lesson_date || item.week_start)); }

  /* ---------- 레포트 안 「이번 수업 복습 노트」 칸 ---------- */
  function cardHtml(item) {
    if (!item || !item.note) return '';
    var ls = lessonsOf(item.note);
    if (!ls.length) return '';
    return '<div class="card rn-card">' +
      '<h2 class="card-title">📒 이번 수업 복습 노트<span class="card-note num">' + esc(metaText(item.note)) + '</span></h2>' +
      '<ul class="rn-card__list">' + ls.map(function (l, i) {
        return '<li><b class="num">' + (i + 1) + '차시</b> ' + esc(l.oneLine || '') + '</li>';
      }).join('') + '</ul>' +
      '<button type="button" class="hub-btn rn-card__open" data-rn-open="' + esc(item.week_start) + '">복습 노트 열기</button>' +
    '</div>';
  }

  /* ---------- 노트 한 장 ---------- */
  function foldHtml(title, items, cls) {
    if (!items.length) return '';
    return '<section class="rn-sec rn-sec--' + cls + '"><h3 class="rn-h">' + title + '</h3>' +
      '<div class="rn-fold" data-rn-fold><ul class="rn-ul">' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '<button type="button" class="rn-more" data-rn-more aria-expanded="false">더 보기</button></section>';
  }
  function lessonHtml(l, i) {
    var acts = list(l.actions), rem = list(l.remember), pas = list(l.passages);
    return '<article class="rn-lesson" id="rnL' + (i + 1) + '" data-rn-sec="l' + (i + 1) + '">' +
      '<div class="rn-lesson__no">' + (i + 1) + '차시</div>' +
      (String(l.oneLine || '').trim() ? '<section class="rn-sec"><h3 class="rn-h">오늘의 한 줄</h3><p class="rn-one">' + esc(l.oneLine) + '</p></section>' : '') +
      (pas.length ? '<section class="rn-sec"><h3 class="rn-h">다룬 지문</h3><ul class="rn-ul rn-ul--pas">' + pas.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>' : '') +
      (acts.length ? '<section class="rn-sec"><h3 class="rn-h">현장 행동 강령</h3><ol class="rn-acts">' + acts.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol></section>' : '') +
      foldHtml('이렇게 적용했다', list(l.applied), 'applied') +
      foldHtml('자주 하는 실수', list(l.mistakes), 'mistakes') +
      (rem.length ? '<section class="rn-sec"><h3 class="rn-h">꼭 기억할 말</h3>' + rem.map(function (t) { return '<blockquote class="rn-quote">' + esc(t) + '</blockquote>'; }).join('') + '</section>' : '') +
    '</article>';
  }

  /* OX — 학생: 한 문제씩 · 학부모: 접어서 문제 · 정답 · 해설 */
  var QZ = { key: '', i: 0, picks: [], last: null };
  function lastKey(item) { return 'mhub.rnox.' + (item.week_start || ''); }
  function readLast(item) { try { var v = JSON.parse(global.localStorage.getItem(lastKey(item)) || 'null'); return v && v.n ? v : null; } catch (e) { return null; } }
  function writeLast(item, v) { try { global.localStorage.setItem(lastKey(item), JSON.stringify(v)); } catch (e) {} }
  function quizPlayHtml(item) {
    var qs = quizOf(item.note), n = qs.length;
    var head = '<h2 class="rn-ox__t">OX 퀴즈</h2>' + (QZ.last ? '<p class="rn-ox__last num">지난번 ' + QZ.last.score + '/' + QZ.last.n + '</p>' : '');
    if (QZ.i >= n) {
      var score = QZ.picks.filter(function (p, k) { return p === qs[k].a; }).length;
      return head + '<div class="rn-ox__done"><p class="rn-ox__score num">' + score + '/' + n + ' 맞음</p>' +
        '<button type="button" class="rn-ox__again" data-rn-again>다시 풀기</button></div>';
    }
    var q = qs[QZ.i], pick = QZ.picks[QZ.i];
    return head + '<p class="rn-ox__step num">' + (QZ.i + 1) + '/' + n + '</p>' +
      '<p class="rn-ox__q">' + esc(q.q) + '</p>' +
      '<div class="rn-ox__btns">' + ['O', 'X'].map(function (a) {
        var cls = pick ? (a === q.a ? ' is-right' : a === pick ? ' is-wrong' : '') : '';
        return '<button type="button" class="rn-ox__b' + cls + '" data-rn-pick="' + a + '"' + (pick ? ' disabled' : '') + ' aria-label="' + a + '">' + a + '</button>';
      }).join('') + '</div>' +
      (pick ? '<div class="rn-ox__ans" role="status"><p class="rn-ox__res">' + (pick === q.a ? '맞았어요' : '아쉬워요') + ' · 정답 ' + q.a + '</p>' +
        (q.why ? '<p class="rn-ox__why">' + esc(q.why) + '</p>' : '') +
        '<button type="button" class="rn-ox__next" data-rn-next>' + (QZ.i + 1 >= n ? '결과 보기' : '다음 문제 →') + '</button></div>' : '');
  }
  function quizParentHtml(item) {
    var qs = quizOf(item.note);
    return '<h2 class="rn-ox__t">OX 퀴즈 <small class="num">' + qs.length + '문항</small></h2>' +
      '<details class="rn-ox__fold"><summary>문제와 정답 · 해설 보기</summary><ol class="rn-ox__list">' + qs.map(function (q) {
        return '<li><p>' + esc(q.q) + '</p><p class="rn-ox__a">정답 <b>' + q.a + '</b>' + (q.why ? ' — ' + esc(q.why) : '') + '</p></li>';
      }).join('') + '</ol></details>';
  }
  /* 인쇄본 — 문제만 · 정답은 맨 아래 작게 */
  function printOxHtml(item) {
    var qs = quizOf(item.note);
    if (!qs.length) return '';
    return '<section class="rn-print-ox"><h2 class="rn-ox__t">OX 퀴즈</h2><ol>' + qs.map(function (q) { return '<li>' + esc(q.q) + ' <span class="rn-print-box">( O · X )</span></li>'; }).join('') + '</ol>' +
      '<p class="rn-print-ans">정답 — ' + qs.map(function (q, i) { return (i + 1) + '. ' + q.a + (q.why ? ' (' + esc(q.why) + ')' : ''); }).join(' · ') + '</p></section>';
  }

  /* ---------- 읽기 화면 (화면 전체 · 가운데 최대 560px) ---------- */
  var R = { item: null, opt: null, el: null };
  function readerHtml(item, opt) {
    var note = item.note, ls = lessonsOf(note), qs = quizOf(note), student = opt.role === 'student';
    var noOx = note && (note.quizNone || note.quizOff);
    return '<div class="rn-page">' +
      '<div class="rn-top">' +
        '<div class="rn-top__row"><button type="button" class="rn-close" data-rn-close aria-label="복습 노트 닫기">‹ 닫기</button>' +
          '<button type="button" class="rn-print" data-rn-print>인쇄 / PDF 저장</button></div>' +
        '<h1 class="rn-title">' + esc(dayOf(item)) + ' 수업 복습 노트</h1>' +
        '<p class="rn-meta num">' + esc(metaText(note)) + '</p>' +
        '<div class="rn-prog" aria-hidden="true"><i data-rn-prog></i></div>' +
        '<nav class="rn-tabs" aria-label="복습 노트 차례">' + ls.map(function (l, i) {
          return '<button type="button" class="rn-tab' + (i ? '' : ' is-on') + '" data-rn-go="l' + (i + 1) + '">' + (i + 1) + '차시</button>';
        }).join('') + (qs.length ? '<button type="button" class="rn-tab" data-rn-go="ox">OX</button>' : '') + '</nav>' +
      '</div>' +
      ls.map(lessonHtml).join('') +
      (qs.length ? '<section class="rn-ox" id="rnOx" data-rn-sec="ox"><div data-rn-quiz>' + (student ? quizPlayHtml(item) : quizParentHtml(item)) + '</div></section>'
        : noOx ? '<p class="rn-noox">이번 수업은 OX 없음</p>' : '') +
      printOxHtml(item) +
    '</div>';
  }
  function host() {
    var el = document.getElementById('rnReader');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'rnReader';
    el.className = 'rn-reader';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '복습 노트');
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('scroll', onScroll, { passive: true });
    return el;
  }
  function onScroll() {
    var el = R.el;
    if (!el) return;
    var max = el.scrollHeight - el.clientHeight;
    var p = max > 0 ? Math.min(100, Math.round(el.scrollTop / max * 100)) : 100;
    var bar = el.querySelector('[data-rn-prog]');
    if (bar) bar.style.width = p + '%';
    /* 지금 보는 카드의 탭 */
    var top = (el.querySelector('.rn-top') || {}).offsetHeight || 0, on = '';
    Array.prototype.forEach.call(el.querySelectorAll('[data-rn-sec]'), function (s) { if (s.getBoundingClientRect().top - el.getBoundingClientRect().top <= top + 24) on = s.dataset.rnSec; });
    if (!on) { var f = el.querySelector('[data-rn-sec]'); on = f ? f.dataset.rnSec : ''; }
    Array.prototype.forEach.call(el.querySelectorAll('[data-rn-go]'), function (b) { b.classList.toggle('is-on', b.dataset.rnGo === on); });
  }
  function folds() {
    /* 두 줄을 넘지 않으면 [더 보기]를 숨긴다 */
    Array.prototype.forEach.call(R.el.querySelectorAll('[data-rn-fold]'), function (f) {
      var more = f.parentNode.querySelector('[data-rn-more]');
      if (more && f.scrollHeight <= f.clientHeight + 2 && f.clientHeight > 0) more.hidden = true;
      else f.classList.add('has-more');                 /* 넘칠 때만 아래를 흐리게 */
    });
  }
  function drawQuiz() {
    var box = R.el && R.el.querySelector('[data-rn-quiz]');
    if (box) box.innerHTML = quizPlayHtml(R.item);
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-rn-close], [data-rn-print], [data-rn-go], [data-rn-more], [data-rn-pick], [data-rn-next], [data-rn-again]');
    if (!t) return;
    if (t.hasAttribute('data-rn-close')) { close(); return; }
    if (t.hasAttribute('data-rn-print')) { print(); return; }
    if (t.hasAttribute('data-rn-go')) {
      var sec = R.el.querySelector('[data-rn-sec="' + t.dataset.rnGo + '"]');
      if (sec) {
        var top = (R.el.querySelector('.rn-top') || {}).offsetHeight || 0;
        var y = sec.getBoundingClientRect().top - R.el.getBoundingClientRect().top + R.el.scrollTop - top - 8;
        try { R.el.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); } catch (x) { R.el.scrollTop = Math.max(0, y); }
      }
      return;
    }
    if (t.hasAttribute('data-rn-more')) {
      var f = t.parentNode.querySelector('[data-rn-fold]'), open = !f.classList.contains('is-open');
      f.classList.toggle('is-open', open);
      t.setAttribute('aria-expanded', String(open));
      t.textContent = open ? '접기' : '더 보기';
      return;
    }
    var qs = quizOf(R.item.note);
    if (t.hasAttribute('data-rn-pick')) { if (!QZ.picks[QZ.i]) { QZ.picks[QZ.i] = t.dataset.rnPick; drawQuiz(); } return; }
    if (t.hasAttribute('data-rn-next')) {
      QZ.i++;
      if (QZ.i >= qs.length) {
        var score = QZ.picks.filter(function (p, k) { return p === qs[k].a; }).length;
        writeLast(R.item, { score: score, n: qs.length, at: Date.now() });
      }
      drawQuiz();
      return;
    }
    if (t.hasAttribute('data-rn-again')) { QZ.last = readLast(R.item); QZ.i = 0; QZ.picks = []; drawQuiz(); }
  }
  function onKey(e) { if (e.key === 'Escape' && R.el && !R.el.hidden) close(); }

  /* item = { week_start, lesson_date, note } · opt = { role: 'student'|'parent', onOpen(item) } */
  function open(item, opt) {
    if (!item || !item.note) return;
    R.item = item; R.opt = opt || {};
    QZ = { key: item.week_start, i: 0, picks: [], last: readLast(item) };
    var el = R.el = host();
    el.innerHTML = readerHtml(item, R.opt);
    el.hidden = false;
    el.scrollTop = 0;
    document.documentElement.classList.add('rn-lock');
    document.addEventListener('keydown', onKey);
    setTimeout(function () { folds(); onScroll(); }, 0);
    var c = el.querySelector('[data-rn-close]');
    if (c) try { c.focus({ preventScroll: true }); } catch (x) { c.focus(); }
    if (R.opt.onOpen) R.opt.onOpen(item);
  }
  function close() {
    if (!R.el) return;
    R.el.hidden = true;
    R.el.innerHTML = '';
    document.documentElement.classList.remove('rn-lock');
    document.removeEventListener('keydown', onKey);
    if (R.opt && R.opt.onClose) R.opt.onClose();
  }
  function print() {
    var html = document.documentElement;
    html.classList.add('rn-printing');
    Array.prototype.forEach.call(R.el.querySelectorAll('[data-rn-fold]'), function (f) { f.classList.add('is-open'); });
    var done = function () { html.classList.remove('rn-printing'); global.removeEventListener('afterprint', done); };
    global.addEventListener('afterprint', done);
    try { global.print(); } catch (e) {}
    setTimeout(done, 1500);
  }

  /* ---------- 「복습 노트 모음」 — 확정된 노트를 수업일 순서로 (수업일 · 오늘의 한 줄) ---------- */
  function listHtml(items) {
    if (!items || !items.length) return '<p class="rn-empty">아직 확정된 복습 노트가 없습니다.</p>';
    return '<ul class="rn-list">' + items.map(function (it) {
      var ls = lessonsOf(it.note);
      return '<li><button type="button" class="rn-list__i" data-rn-open="' + esc(it.week_start) + '">' +
        '<span class="rn-list__d num">' + esc(dayOf(it)) + '</span>' +
        '<span class="rn-list__t">' + esc(ls.map(function (l) { return l.oneLine; }).filter(Boolean).join(' / ') || '복습 노트') + '</span>' +
        '<span class="rn-list__m num">' + esc(metaText(it.note)) + '</span>' +
        '<span class="rn-list__go" aria-hidden="true">›</span></button></li>';
    }).join('') + '</ul>';
  }

  global.ReviewNote = { cardHtml: cardHtml, listHtml: listHtml, open: open, close: close, minutes: minutes, metaText: metaText, quizOf: quizOf, lessonsOf: lessonsOf, readerHtml: readerHtml };
})(window);
