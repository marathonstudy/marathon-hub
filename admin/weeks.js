/* ============================================================
   weeks.js — ② 작성 → 반을 고르면 처음 나오는 「주차 현황」 (migration-018)

   · 그 반의 첫 주부터 다음 주까지 모든 주차 — 최신 주가 위. 최근 8주만 펼치고 나머지는 [이전 주 더 보기]
   · 주차마다: 수업일(휴강 · 바뀐 날), 레포트(빈칸 · 작성 중 n/전체 · 보냄), 수업 내용 첫 줄 · 초안,
     배부 · 필수 · 선택 파일 수, 영상 차시, 출석, 복습테스트, 빠진 것(빨간 표시)
   · 줄을 누르면 그 주 작성 화면, [보기] = 그 주 공개된 레포트를 학부모 화면 미리보기로
   · 주소: #tab=write&cls=반이름 (작성 화면은 &week= 가 붙는다 — nav.js)
   서버 함수 staff_class_weeks 하나로 가져온다 (직원만 — 학생 · 학부모 링크는 못 부른다).
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$;
  var SHOW = 8;
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var st = { cls: '', data: null, more: false, run: 0, err: '' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function host() { return $('#wkvPanel'); }
  function firstLine(s) { return String(s || '').split('\n')[0].trim(); }

  function load(cls) {
    var run = ++st.run;
    st.cls = cls;
    st.err = '';
    if (!st.data || st.data.class !== cls) { st.data = null; st.more = false; }
    render();
    if (!cls) return Promise.resolve();
    return SB.client.rpc('staff_class_weeks', { p_class: cls }).then(function (r) {
      if (run !== st.run) return;
      if (r.error) {
        st.err = /Could not find the function|does not exist|schema cache/i.test(r.error.message) ? 'missing' : r.error.message;
      } else if (!r.data || !r.data.ok) {
        st.err = '이 반을 찾지 못했습니다.';
      } else {
        st.data = r.data;
      }
      render();
    }, function (e) {
      if (run !== st.run) return;
      st.err = e.message || '불러오지 못했습니다.';
      render();
    });
  }

  function schedText(s) {
    if (!s || s.dow === null || s.dow === undefined) return '수업 요일 미정';
    var days = [s.dow].concat(s.extra || []).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    return '매주 ' + days.map(function (d) { return DOW[d]; }).join(' · ') +
      (s.first ? ' · 첫 수업 ' + Lesson.md(String(s.first).slice(0, 10), false) : '');
  }

  /* Lesson.of 가 쓰는 일정 — 그 주만 바꾼 것은 작성 화면이 여는 시작일로 */
  function schedOf(d) {
    var s = d.schedule || {};
    var weeks = {};
    d.weeks.forEach(function (w) { if (w.cw) weeks[w.open_start] = w.cw; });
    return Lesson.normalize({ dow: s.dow, extra: s.extra || [], first: s.first || '', weeks: weeks });
  }

  function dateHtml(L) {
    if (!L) return '<span class="wkv-muted">수업일 —</span>';
    if (L.canceled) return '<span class="wkv-tag wkv-tag--off">휴강</span>' + (L.note ? ' <span class="wkv-muted">' + esc(L.note) + '</span>' : '');
    var days = (L.days && L.days.length ? L.days : [L.date]).map(function (x) { return Lesson.md(x); }).join(' · ');
    return esc(days) + (L.moved ? ' <span class="wkv-tag wkv-tag--moved">바뀜</span>' : '') +
      (L.note && !L.canceled ? ' <span class="wkv-muted">' + esc(L.note) + '</span>' : '');
  }

  function statusHtml(w, total) {
    if (total > 0 && w.sent >= total) return '<span class="wkv-st wkv-st--sent">보냄</span>';
    if (w.published > 0 || w.written > 0) return '<span class="wkv-st wkv-st--doing">작성 중 <b class="num">' + w.published + '/' + total + '</b></span>';
    return '<span class="wkv-st wkv-st--empty">빈칸</span>';
  }

  function missingOf(w, L, d) {
    var out = [];
    if (w.week_start > d.this_week) return out;               /* 다음 주 — 아직 */
    if (L && L.canceled) return out;                          /* 휴강 */
    var s = d.schedule || {};
    if (!L && s.dow !== null && s.dow !== undefined) return out;   /* 첫 수업 전 주 */
    if (!w.lesson) out.push('수업 내용 없음');
    if (!w.videos.n) out.push('영상 없음');
    if (!w.files.required && !w.files.optional && !w.hw_names) out.push('과제 없음');
    if (w.week_start < d.this_week && d.total > 0 && w.sent < d.total) out.push('미제출 레포트 ' + (d.total - w.sent));
    return out;
  }

  function rowHtml(w, d, sched) {
    var L = Lesson.of(sched, w.open_start);
    var isNow = w.week_start === d.this_week, isNext = w.week_start > d.this_week;
    var total = d.total;
    var v = w.videos;
    var parts = [v.p1 ? '1차시' : '', v.p2 ? '2차시' : '', v.makeup ? '보강' : ''].filter(Boolean).join(' · ');
    var rv = w.review;
    var rvText = !rv ? '복습 —' : rv.off ? '복습 없음' :
      '복습 ' + (rv.confirmed ? '평균 <b class="num">' + rv.avg + '</b>' : '확인 전') + ' · 제출 <span class="num">' + rv.submitted + '/' + total + '</span>';
    var miss = missingOf(w, L, d);
    return '<div class="wkv-row' + (isNow ? ' is-now' : '') + (isNext ? ' is-next' : '') + '" role="button" tabindex="0" data-wo="' + esc(w.open_start) + '" aria-label="' + esc(Lesson.md(w.week_start, false)) + ' 주 작성 화면 열기">' +
      '<div class="wkv-wk">' +
        '<div class="wkv-wk__name"><b>' + esc(Lesson.md(w.week_start, false)) + ' 주</b>' +
          (isNow ? ' <span class="wkv-tag wkv-tag--now">이번 주</span>' : isNext ? ' <span class="wkv-tag">다음 주</span>' : '') + '</div>' +
        '<div class="wkv-wk__date">' + dateHtml(L) + '</div>' +
      '</div>' +
      '<div class="wkv-status">' + statusHtml(w, total) + '</div>' +
      '<div class="wkv-body">' +
        '<div class="wkv-lesson">' + (w.lesson ? esc(firstLine(w.lesson)) : '<span class="wkv-muted">수업 내용 —</span>') +
          (w.draft ? ' <span class="wkv-tag wkv-tag--draft">초안</span>' : '') + '</div>' +
        '<div class="wkv-stats">' +
          '<span>배부 <b class="num">' + w.files.material + '</b> · 필수 <b class="num">' + w.files.required + '</b> · 선택 <b class="num">' + w.files.optional + '</b></span>' +
          '<span>영상 <b class="num">' + v.n + '</b>' + (parts ? ' <span class="wkv-muted">' + parts + '</span>' : '') + '</span>' +
          (isNext ? '' : '<span>출석 <b class="num">' + w.attend + '/' + total + '</b></span><span>' + rvText + '</span>') +
        '</div>' +
        (miss.length ? '<div class="wkv-miss">' + miss.map(function (m) { return '<span class="wkv-miss__i">' + esc(m) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="wkv-act"><button class="btn btn--sm" type="button" data-wv="' + esc(w.pub_week || '') + '" data-sid="' + esc(w.pub_sid || '') + '"' +
        (w.pub_sid ? ' title="이 주 레포트를 학부모 화면으로 미리보기"' : ' disabled title="공개된 레포트가 없습니다"') + '>보기</button></div>' +
    '</div>';
  }

  function render() {
    var h = host();
    if (!h) return;
    var d = st.data;
    var head = '<div class="panel__head wkv-head">' +
        '<div class="wkv-head__text"><h2 class="panel__title">' + esc(st.cls || '반을 골라 주세요') + ' · 주차 현황</h2>' +
        '<p class="panel__hint">' + (d ? esc(schedText(d.schedule)) + ' · 학생 ' + d.total + '명' : '') + '</p></div>' +
        '<div class="spacer"></div>' +
        (st.cls ? '<button class="btn btn--primary" type="button" id="wkvThisWeek">이번 주 작성하기</button>' : '') +
      '</div>';
    if (!st.cls) { h.innerHTML = head; return; }
    if (st.err === 'missing') {
      h.innerHTML = head + '<p class="panel__hint">주차 현황용 함수가 아직 없습니다. <code>migration-018-class-weeks.sql</code> 을 실행해 주세요. 그 전에도 [이번 주 작성하기]로 작성할 수 있습니다.</p>';
      return;
    }
    if (st.err) { h.innerHTML = head + '<p class="panel__hint">' + esc(st.err) + '</p>'; return; }
    if (!d) { h.innerHTML = head + '<p class="panel__hint">불러오는 중…</p>'; return; }
    var sched = schedOf(d);
    var shown = st.more ? d.weeks : d.weeks.slice(0, SHOW);
    var rest = d.weeks.length - shown.length;
    h.innerHTML = head +
      '<div class="wkv-list">' + shown.map(function (w) { return rowHtml(w, d, sched); }).join('') + '</div>' +
      (rest > 0 ? '<button class="btn wkv-more" type="button" id="wkvMore">이전 주 더 보기 (' + rest + '주)</button>' : '');
  }

  function thisWeekStart() {
    var d = st.data;
    var w = d && d.weeks.find(function (x) { return x.week_start === d.this_week; });
    return w ? w.open_start : Store.thisWeek().start;
  }

  function onClick(e) {
    if (e.target.closest('#wkvThisWeek')) { Writer.openWeek(thisWeekStart()); return; }
    if (e.target.closest('#wkvMore')) { st.more = true; render(); return; }
    var v = e.target.closest('[data-wv]');
    if (v) {
      if (!v.disabled && v.dataset.sid && window.Preview) Preview.open(v.dataset.sid, 'parent', 'report', v.dataset.wv);
      return;
    }
    var row = e.target.closest('[data-wo]');
    if (row) Writer.openWeek(row.dataset.wo);
  }

  function init() {
    var h = host();
    if (!h) return;
    h.addEventListener('click', onClick);
    h.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-wo]')) {
        e.preventDefault();
        Writer.openWeek(e.target.dataset.wo);
      }
    });
    /* ② 작성 탭을 열 때 · 주차 현황으로 오거나 반을 바꾸면 새로 */
    document.addEventListener('jt:tab', function (e) {
      if (e.detail.index === 1 && Writer.mode() === 'weeks') load(Writer.currentClass());
    });
    window.addEventListener('jt:write-mode', function () {
      if (Writer.mode() === 'weeks') load(Writer.currentClass());
    });
    window.addEventListener('jt:schedule-changed', function () {
      if (Writer.mode() === 'weeks' && !$('#panel-write').hidden) load(Writer.currentClass());
    });
  }

  init();

  window.WeeksView = { load: load, state: function () { return st; } };

})();
