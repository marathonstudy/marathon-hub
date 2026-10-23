/* ============================================================
   report.js — 작성 내용 → 레포트 데이터 · 작성 완료 판정

   레포트를 '그리는' 코드는 assets/report-view.js 한 곳에 있다.
   여기서는 그릴 데이터를 만들고, 작성이 끝났는지 판정만 한다.
   주간 레포트 → 작성의 딱지와 주간 레포트 → 공개의 목록이 같은 함수를 쓴다.
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
    /* 복습테스트 (migration-013 · 025 · 027) — 시험마다 「10/22(목) 복습 TEST」처럼 날짜 이름으로.
       선생님이 확인한 것만 점수, 학생이 냈지만 아직 확인 전이면 「제출 완료」만 (학부모 화면에 확인 전 점수는 안 나간다).
       예전 수기 「리뷰테스트」 점수(common.tests · entry.scores)는 지우지 않고 레포트에서만 뺀다 (20261029g)
       미응시면 「미응시 · 결석」 사유 이름만 (메모는 넣지 않는다 · migration-028 · 20261029h) */
    var tests = [];
    var rvs = global.Store && global.Store.reviewsOf ? global.Store.reviewsOf(student.id, week.start) : [];
    rvs.forEach(function (rv) {
      var rvName = rv.label || ('복습테스트 ' + rv.round_no + '회');
      if (tests.some(function (t) { return t.name === rvName; })) return;
      if (rv.status === 'absent') tests.push({ name: rvName, kind: 'review', absent: String(rv.reason_label || '').trim() || '미응시' });
      else if (rv.status && rv.status !== 'confirmed') tests.push({ name: rvName, kind: 'review', submitted: true });
      else tests.push({ name: rvName, score: clampPct(rv.score), correct: rv.correct, total: rv.q_count, kind: 'review', confirmed: true });
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
      comment: commentFor(common, entry)
    }, lesson);
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
       코멘트      반 공통이든 개별이든 비어 있지 않을 것
       그리고 (20261026b) — 그 학생 개별 코멘트(선생님 한마디)가 한 글자라도 있거나, 출결을 지각 · 결석으로 바꿨을 때만 작성 완료.
                  출결 · 집중도 기본값(출석 · 5)과 반 공통 내용만 있는 학생은 작성 완료가 아니다 (작성 중).
     state  none(미작성) · partial(작성 중) · done(작성 완료)
     「오늘」 반 카드 · 주간 레포트 → 작성 · 주간 레포트 → 공개가 모두 이 함수 하나를 쓴다 (주차 현황은 서버 staff_class_weeks 가 같은 규칙 · migration-021)
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

  function entryStatus(common, entry) {
    var e = entry || {};
    var att = String(e.attendStatus || '').trim();
    var absent = isAbsent(e);
    var missing = [];

    if (!att) missing.push('출결');
    if (!absent) {
      if (!(Number(e.focusScore) > 0)) missing.push('집중도');
    }
    if (!commentFor(common, e)) missing.push('코멘트');
    /* 그 학생 몫을 직접 쓴 흔적 — 개별 코멘트 또는 지각 · 결석 */
    var own = !!String(e.comment || '').trim() || att === 'late' || att === 'absent';
    if (!own && missing.indexOf('코멘트') === -1) missing.push('개별 코멘트(또는 지각 · 결석)');

    /* 수기 점수 · 과제 체크는 작성 완료 · 진행률에 넣지 않는다 (20261029g) */
    var touched = !!att || Number(e.focusScore) > 0 || !!String(e.comment || '').trim();

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
