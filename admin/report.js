/* ============================================================
   report.js — 작성 내용 → 레포트 데이터 · 빠진 칸 알림

   레포트를 '그리는' 코드는 assets/report-view.js 한 곳에 있다.
   여기서는 그릴 데이터를 만들고, 비어 있는 칸(출결 · 집중도 · 코멘트)을 알려 준다.
   레포트 발송 → 2 공개의 「공개 직전 한 줄」이 이 함수를 쓴다.
   ============================================================ */

(function (global) {
  'use strict';

  var DAYS = ['월', '화', '수', '목', '금'];

  function clampPct(v) {
    var n = Math.round(Number(v) || 0);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }

  /* 작성 탭의 입력값 → 레포트 데이터 (report-view.js 가 그린다) */
  function toReportData(student, common, entry, week) {
    common = common || {};
    entry = entry || {};
    /* 복습테스트 (migration-013 · 025 · 027 · 030) — 시험마다 「10/22(목) 복습 TEST」처럼 날짜 이름으로.
       학생이 낸 점수를 그대로 쓴다 (「확인」 단계는 없앴다 · 20261030a). 이상하면 코치룸에서 「고치기」.
       예전 수기 「리뷰테스트」 점수(common.tests · entry.scores)는 지우지 않고 레포트에서만 뺀다 (20261029g)
       미응시면 「미응시 · 결석」 사유 이름만 (메모는 넣지 않는다 · migration-028 · 20261029h)
       낸 것도 사유도 없으면 「미응시」 (migration-030 이 status missing 줄을 준다) */
    var tests = [];
    var rvs = global.Store && global.Store.reviewsOf ? global.Store.reviewsOf(student.id, week.start) : [];
    rvs.forEach(function (rv) {
      var rvName = rv.label || ('복습테스트 ' + rv.round_no + '회');
      if (tests.some(function (t) { return t.name === rvName; })) return;
      if (rv.status === 'absent') tests.push({ name: rvName, kind: 'review', absent: String(rv.reason_label || '').trim() || '미응시' });
      else if (rv.status === 'missing') tests.push({ name: rvName, kind: 'review', absent: '미응시' });
      else tests.push({ name: rvName, score: clampPct(rv.score), correct: rv.correct, total: rv.q_count, kind: 'review' });
    });

    /* 수업일 · 과제 기간 (반 수업 요일을 정했을 때만 · migration-011). 예전 레포트에는 없다 */
    var lesson = (global.Store && global.Store.lessonOf && global.Lesson)
      ? global.Lesson.reportFields(global.Store.lessonOf(student.className || '', week.start)) : {};

    return Object.assign({
      school: student.school || '',
      grade: student.grade || '',
      studentName: student.name || '',
      className: student.className || '',
      startDate: week.start,
      endDate: week.end,
      attendance: { status: entry.attendStatus === 'makeup' ? 'attend' : (entry.attendStatus || ''), note: (entry.attendNote || '').trim() },
      lessons: (common.lessons || []).filter(function (l) { return String(l || '').trim(); }),
      focusScore: Number(entry.focusScore) || 0,
      tests: tests,
      /* 수기 과제 체크는 레포트에 넣지 않는다 (과제 수행은 앱 연동으로 · 20261029g) */
      homework: {},
      homeworkItems: [],
      requiredRate: -1,
      optionalRate: -1,
      comment: commentFor(common, entry),
      /* 수강 시작일 (migration-044 · 20261031q) — 러닝노트가 그 앞 날을 「신입생」으로 · 첫 레포트는 「첫 수업입니다」 */
      startOn: global.Store && global.Store.startOf ? global.Store.startOf(student) : ''
    }, lesson);
  }

  /* 학생 코멘트에 글이 있으면 그것, 비어 있으면 반 공통 코멘트 */
  function commentFor(common, entry) {
    var own = ((entry && entry.comment) || '').trim();
    if (own) return own;
    /* 과정에 든 반 — 반 공통 코멘트 뒤에 「이 반만 한 줄 추가」 (migration-033 · 20261031a) */
    var base = ((common && common.comment) || '').trim(), extra = ((common && common.extra) || '').trim();
    return base && extra ? base + String.fromCharCode(10) + extra : (base || extra);
  }

  /* ============================================================
     빠진 칸 (20261030a) — 「작성 중 / 작성 완료」 구분은 없앴다.
       출결 · 집중도(결석이면 면제) · 코멘트(반 공통이든 개별이든) 중 정말 비어 있는 것만 알려 준다.
       개별 코멘트는 선택이다 — 비어 있으면 반 공통 코멘트가 나간다. 막지는 않는다 (공개 직전에 한 줄로만).
       비어 있는 칸은 레포트에서 숨긴다 (report-view.js · hub.js)
     ============================================================ */

  function isAbsent(entry) {
    return String((entry && entry.attendStatus) || '').trim() === 'absent';
  }

  function namedTests(common) {
    var out = [];
    ((common && common.tests) || []).forEach(function (name, i) {
      if (name != null && String(name).trim()) out.push({ i: i, name: String(name).trim() });
    });
    return out;
  }

  /* ['출결', '집중도', '코멘트'] 중 빈 것 */
  function gapsOf(common, entry) {
    var e = entry || {};
    var out = [];
    if (!String(e.attendStatus || '').trim()) out.push('출결');
    if (!isAbsent(e) && !(Number(e.focusScore) > 0)) out.push('집중도');
    if (!commentFor(common, e)) out.push('코멘트');
    return out;
  }

  /* 공개 직전 한 줄 — 「출결 안 넣은 학생 2명: 김OO, 이OO」. 빠진 게 없으면 ''
     rows: [{ name, common, entry }] */
  var GAP_TEXT = { '출결': '출결 안 넣은', '집중도': '집중도 안 넣은', '코멘트': '코멘트 없는' };
  function gapLine(rows) {
    var by = {};
    (rows || []).forEach(function (r) {
      gapsOf(r.common, r.entry).forEach(function (g) { (by[g] = by[g] || []).push(r.name || ''); });
    });
    return ['출결', '집중도', '코멘트'].filter(function (g) { return by[g]; }).map(function (g) {
      return GAP_TEXT[g] + ' 학생 ' + by[g].length + '명: ' + by[g].join(', ');
    }).join(' · ');
  }

  /* ============================================================
     과제 — 반 공통에 항목 이름, 학생마다 항목별 월~금 체크
       반 공통  [{key:'h1', group:'required', name:'문학 주간지'}]
       학생     {h1:{월:true, 수:true}}
     제출률 = 체크한 요일 칸 / (항목 수 × 5)
     ============================================================ */

  function homeworkItems(common, group) {
    var list = (common && common.homework) || [];
    if (!Array.isArray(list)) return [];
    return list.filter(function (it) {
      if (!it || !it.key || !String(it.name || '').trim()) return false;
      return !group || groupOf(it) === group;
    });
  }

  function groupOf(it) { return (it && it.group === 'optional') ? 'optional' : 'required'; }

  function daysDone(v) {
    if (!v || typeof v !== 'object') return 0;
    return DAYS.filter(function (d) { return !!v[d]; }).length;
  }

  function countOf(common, hw, group) {
    var items = homeworkItems(common, group);
    if (!items.length) return null;
    var done = 0;
    items.forEach(function (it) { done += daysDone(hw && hw[it.key]); });
    return { done: done, total: items.length * DAYS.length };
  }

  function rateOf(common, hw, group) {
    var c = countOf(common, hw, group);
    if (!c) return -1;
    return Math.round(c.done / c.total * 100);
  }

  /* ============================================================
     다시 공개할 때 무엇이 바뀌었나 (20261030e) — 학부모가 보는 칸만 비교한다
       복습테스트 결과 추가 · 복습테스트 점수 변경 · 출결 변경 · 집중도 변경 · 코멘트 수정 · 수업 내용 수정
       필기 사진 · 수업 영상 · 자료는 러닝노트가 그때그때 읽어 와서 다시 공개 없이도 바로 바뀐다 (여기서는 세지 않는다)
     old · next = report_data · 바뀐 것이 없으면 []
     ============================================================ */
  function changesOf(old, next) {
    if (!old || !next) return [];
    var out = [];
    var add = function (t) { if (out.indexOf(t) === -1) out.push(t); };
    var ot = {}, nt = {};
    (old.tests || []).forEach(function (t) { ot[t.name] = t; });
    (next.tests || []).forEach(function (t) { nt[t.name] = t; });
    var scored = function (t) { return !!t && !t.absent && t.score != null; };
    Object.keys(nt).forEach(function (k) {
      var a = ot[k], b = nt[k];
      if (scored(b) && !scored(a)) add('복습테스트 결과 추가');
      else if (scored(a) && scored(b) && (a.score !== b.score || a.correct !== b.correct || a.total !== b.total)) add('복습테스트 점수 변경');
      else if (scored(a) && !scored(b)) add('복습테스트 결과 변경');
      else if (!a && b) add('복습테스트 결과 추가');
    });
    Object.keys(ot).forEach(function (k) { if (!nt[k] && scored(ot[k])) add('복습테스트 결과 변경'); });
    var oa = old.attendance || {}, na = next.attendance || {};
    if ((oa.status || '') !== (na.status || '') || (oa.note || '') !== (na.note || '')) add('출결 변경');
    if ((Number(old.focusScore) || 0) !== (Number(next.focusScore) || 0)) add('집중도 변경');
    if (String(old.comment || '').trim() !== String(next.comment || '').trim()) add('코멘트 수정');
    if (JSON.stringify(old.lessons || []) !== JSON.stringify(next.lessons || [])) add('수업 내용 수정');
    /* 과제 수정 (20261031j) — 공개할 때 담은 고친 값이 달라졌으면 */
    var fk = function (m) { m = m && typeof m === 'object' ? m : {}; return JSON.stringify(Object.keys(m).sort().map(function (k) { return [k, m[k]]; })); };
    if (('hwFix' in next || 'hwFix' in old) && fk(old.hwFix) !== fk(next.hwFix)) add('과제 기록 수정');
    return out;
  }

  global.Report = {
    changesOf: changesOf,
    toReportData: toReportData,
    commentFor: commentFor,
    homeworkItems: homeworkItems,
    groupOf: groupOf,
    rateOf: rateOf,
    countOf: countOf,
    DAYS: DAYS,
    daysDone: daysDone,
    gapsOf: gapsOf,
    gapLine: gapLine,
    isAbsent: isAbsent,
    namedTests: namedTests
  };

})(window);
