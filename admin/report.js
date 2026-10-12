/* ============================================================
   report.js — 작성 내용 → 레포트 데이터 · 작성 완료 판정

   레포트를 '그리는' 코드는 assets/report-view.js 한 곳에 있다.
   여기서는 그릴 데이터를 만들고, 작성이 끝났는지 판정만 한다.
   ② 작성 탭의 딱지와 ③ 공개 탭의 목록이 같은 함수를 쓴다.
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
    var tests = (common.tests || [])
      .map(function (name, i) {
        if (name == null || !String(name).trim()) return null;
        return { name: String(name).trim(), score: clampPct(entry.scores ? entry.scores[i] : '') };
      })
      .filter(Boolean);

    return {
      school: student.school || '',
      grade: student.grade || '',
      studentName: student.name || '',
      className: student.className || '',
      startDate: week.start,
      endDate: week.end,
      attendance: { status: entry.attendStatus || '', note: (entry.attendNote || '').trim() },
      lessons: (common.lessons || []).filter(function (l) { return String(l || '').trim(); }),
      focusScore: Number(entry.focusScore) || 0,
      tests: tests,
      homework: entry.homework || {},
      homeworkItems: homeworkItems(common).map(function (it) {
        return { key: it.key, group: groupOf(it), name: String(it.name).trim() };
      }),
      requiredRate: rateOf(common, entry.homework, 'required'),
      optionalRate: rateOf(common, entry.homework, 'optional'),
      comment: commentFor(common, entry)
    };
  }

  /* 학생 코멘트에 글이 있으면 그것, 비어 있으면 반 공통 코멘트 */
  function commentFor(common, entry) {
    var own = ((entry && entry.comment) || '').trim();
    if (own) return own;
    return ((common && common.comment) || '').trim();
  }

  /* ============================================================
     작성 완료 판정
       출결        언제나 필수
       집중도      1점 이상. 결석이면 면제
       리뷰테스트   반 공통에 이름이 있는 것 전부. 결석이면 면제
       코멘트      반 공통이든 개별이든 비어 있지 않을 것
     state  none(미작성) · partial(작성 중) · done(작성 완료)
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

  function hasScore(entry, i) {
    var v = entry && entry.scores ? entry.scores[i] : undefined;
    if (v === 0) return true;
    return v != null && String(v).trim() !== '';
  }

  function entryStatus(common, entry) {
    var e = entry || {};
    var att = String(e.attendStatus || '').trim();
    var absent = isAbsent(e);
    var missing = [];

    if (!att) missing.push('출결');
    if (!absent) {
      if (!(Number(e.focusScore) > 0)) missing.push('집중도');
      var noScore = namedTests(common).filter(function (t) { return !hasScore(e, t.i); });
      if (noScore.length === 1) missing.push(noScore[0].name + ' 점수');
      else if (noScore.length > 1) missing.push('점수 ' + noScore.length + '개');
    }
    if (!commentFor(common, e)) missing.push('코멘트');

    var touched = !!att || Number(e.focusScore) > 0 ||
                  Object.keys(e.scores || {}).length > 0 ||
                  !!String(e.comment || '').trim() ||
                  homeworkTouched(e.homework);

    return { state: !missing.length ? 'done' : (touched ? 'partial' : 'none'), missing: missing };
  }

  var STATUS_LABEL = { none: '미작성', partial: '작성 중', done: '작성 완료' };
  function statusLabel(state) { return STATUS_LABEL[state] || '미작성'; }

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

  function homeworkTouched(hw) {
    return Object.keys(hw || {}).some(function (k) { return daysDone(hw[k]) > 0; });
  }

  global.Report = {
    toReportData: toReportData,
    commentFor: commentFor,
    homeworkItems: homeworkItems,
    groupOf: groupOf,
    rateOf: rateOf,
    countOf: countOf,
    DAYS: DAYS,
    daysDone: daysDone,
    entryStatus: entryStatus,
    statusLabel: statusLabel,
    isAbsent: isAbsent,
    namedTests: namedTests
  };

})(window);
