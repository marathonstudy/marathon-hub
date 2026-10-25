/* ============================================================
   hwfix.js — 과제 수정 (앱에서 받아 온 과제 기록을 조교가 날짜별로 고친다 · 20261031j · migration-038)

   앱 기록은 바꾸지 않는다. 고친 값은 코치룸 DB(hw_fixes)에 「과제 수정」 한 줄로 따로 남긴다
     (학생 · 날짜 · 바꾼 상태 · 사유 · 고친 사람 · 시각 — 사람 · 시각은 서버가 채운다)
   그 학생 · 그 날짜의 가장 마지막 줄이 지금 값 · 「원래대로」도 한 줄(app)로 남긴다 — 기록은 지우지 않는다
   화면은 앱 기록 위에 덮어서 센다 (AppWeek.withFix) — 「오늘」 과제 칩 · 7칸 표 · 과제 평균 · 정렬 · AI 초안 · 미리보기
     앱에서 다시 받아 와도 덮는 값은 그대로다 (앱 기록과 따로 두므로)
   학부모 · 학생 화면은 hub_hw_fix — 바꾼 상태만 · 공개한 레포트 기간은 다시 공개해야 반영 (publish.js 가 hwFix 를 레포트에 담는다)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function isMissing(e) { return /does not exist|Could not find|schema cache|relation/i.test((e && e.message) || ''); }

  var NAME = { onTime: '정시 제출', late: '늦게 제출', none: '미제출', exempt: '면제(셈에서 뺌)', off: '과제 없음', app: '원래대로' };
  var STATUSES = ['onTime', 'late', 'none', 'exempt'];
  var REASONS = ['앱 오류', '종이로 제출', '결석으로 면제', '기타'];
  var MISSING = '과제 수정 저장 칸이 아직 없습니다 — Supabase SQL Editor 에서 migration-038-hw-fix.sql 을 먼저 실행해 주세요';

  /* by[학생][날짜] = [기록 줄 (오래된 것부터)] */
  var st = { by: {}, sql: true, loaded: false, cut: {} };
  function load() {
    if (!window.SB || !SB.client) return Promise.resolve();
    return sb().from('hw_fixes').select('id,student_id,day,status,app_status,reason,fixed_name,fixed_at').order('id', { ascending: true }).then(function (r) {
      st.sql = !r.error;
      st.by = {};
      (r.data || []).forEach(function (x) {
        var d = String(x.day).slice(0, 10), m = st.by[x.student_id] = st.by[x.student_id] || {};
        x.day = d;
        (m[d] = m[d] || []).push(x);
      });
      st.loaded = true;
      window.dispatchEvent(new CustomEvent('jt:hwfix'));
    }, function () { st.sql = false; });
  }

  function rowsOf(sid, day) { return ((st.by[sid] || {})[day] || []).slice(); }
  /* 지금 덮는 값 (마지막 줄이 「원래대로」면 없음) */
  function activeOf(sid, day) {
    var l = (st.by[sid] || {})[day];
    var x = l && l[l.length - 1];
    return x && x.status !== 'app' ? x : null;
  }
  /* { 날짜: 상태 } — to 를 주면 그날까지만 (공개할 때 레포트에 담는 값) */
  function mapOf(sid, to) {
    var out = {}, m = st.by[sid] || {};
    Object.keys(m).forEach(function (d) {
      if (to && d > to) return;
      var x = activeOf(sid, d);
      if (x) out[d] = x.status;
    });
    return out;
  }
  function apply(sid, data) { return data && window.AppWeek && AppWeek.withFix ? AppWeek.withFix(data, mapOf(sid)) : data; }

  /* 「김OO 10/25 10:12」 */
  function stamp(x) {
    var t = x && x.fixed_at ? new Date(x.fixed_at) : null;
    var when = t && !isNaN(t) ? (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
    return [x && x.fixed_name, when].filter(Boolean).join(' ');
  }

  function add(sid, day, status, reason, appStatus) {
    if (!st.sql) return Promise.resolve({ ok: false, message: MISSING });
    return sb().from('hw_fixes').insert({ student_id: sid, day: day, status: status, reason: reason || '', app_status: appStatus || '' }).then(function (r) {
      if (r.error) { if (isMissing(r.error)) st.sql = false; return { ok: false, message: isMissing(r.error) ? MISSING : r.error.message }; }
      return load().then(function () {
        window.dispatchEvent(new CustomEvent('jt:remote', { detail: { table: 'hw_fixes', local: true } }));
        return { ok: true };
      });
    }, function (e) { return { ok: false, message: (e && e.message) || '저장하지 못했습니다' }; });
  }
  function save(sid, day, status, reason, appStatus) {
    if (STATUSES.indexOf(status) === -1) return Promise.resolve({ ok: false, message: '바꿀 상태를 골라 주세요' });
    if (!String(reason || '').trim()) return Promise.resolve({ ok: false, message: '사유를 골라 주세요' });
    return add(sid, day, status, String(reason).trim().slice(0, 200), appStatus);
  }
  function revert(sid, day, appStatus) { return add(sid, day, 'app', '', appStatus); }

  /* 그 학생의 공개한 레포트 기간 끝 (수업 전날 · 없으면 '') — 「다시 공개해야 학부모에게 반영됩니다」 */
  function cutOf(sid) {
    if (st.cut[sid] != null) return Promise.resolve(st.cut[sid]);
    /* 모르면 ''로 기억한다 — 기억하지 않으면 표를 그릴 때마다 다시 묻고 다시 그린다 */
    if (!st.sql || !window.SB || !SB.client) { st.cut[sid] = ''; return Promise.resolve(''); }
    st.cut[sid] = '';
    return sb().rpc('staff_hw_fix_cut', { p_student: sid }).then(function (r) {
      var v = r.error || !r.data ? '' : String(r.data).slice(0, 10);
      st.cut[sid] = v;
      return v;
    }, function () { return ''; });
  }
  function cutKnown(sid) { return st.cut[sid] == null ? null : st.cut[sid]; }

  window.addEventListener('jt:loaded', function () { load(); });
  window.addEventListener('jt:remote', function (e) {
    var t = e.detail && e.detail.table;
    if (t === 'published' || t === '*') st.cut = {};
    if ((t === 'hw_fixes' || t === '*') && !(e.detail && e.detail.local)) load();
  });

  window.HwFix = {
    load: load, mapOf: mapOf, apply: apply, activeOf: activeOf, rowsOf: rowsOf, stamp: stamp,
    save: save, revert: revert, cutOf: cutOf, cutKnown: cutKnown,
    clearCut: function (sid) { if (sid) delete st.cut[sid]; else st.cut = {}; },
    NAME: NAME, STATUSES: STATUSES, REASONS: REASONS,
    sql: function () { return st.sql; }, loaded: function () { return st.loaded; }
  };
})();
