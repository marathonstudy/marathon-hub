/* ============================================================
   review.js — 레포트 발송 → 1 작성 「반 공통」 → 복습테스트 (migration-013 · 025 · 학생은 러닝노트에서 직접 기록)

   반 수업일마다 기본 시험들(「복습 TEST」 · 「화작문 TEST」, 반 관리에서 바꿈)이 서버에서 저절로 생긴다.
   모든 곳에서 「10/22(목) 복습 TEST」처럼 수업일 + 시험 이름으로 부른다 (회차는 쓰지 않는다).
   · 그 주 시험 줄: [+ 시험 추가](그 주만) · [이번 주 시험 빼기](제출이 있는 시험은 뺄 수 없음) · 뺀 시험은 요약 줄에 「… 이번 주 안 봄 · 되돌리기」 (20261029g)
   · 표: 학생 한 줄 — 시험마다 점수 · 상태(미제출/제출) · [고치기] [대신 입력] [미응시], 사진(여러 장)
     「확인」 단계는 없앴다 (20261030a · migration-030) — 학생이 낸 값을 그대로 쓰고, 이상하면 [고치기]. 고친 기록은 그대로 남는다
   · 미응시 (migration-028 · 20261029h): 사유 결석 · 지각 · 상담 중 · 다른 시험으로 대체 · 기타 (뒤의 둘은 짧은 메모 — 코치룸에서만 보임).
     이름 옆 [이번 주 전부 미응시]는 그 주 안 낸 시험 모두에 같은 사유. 회색 「미응시 · 결석」을 누르면 사유 바꾸기 · [미응시 취소].
     학생이 내거나 [대신 입력]하면 서버가 미응시를 저절로 푼다. 제출 현황은 「제출 9 · 미응시 1 / 11」처럼 따로 센다.
     「결석」을 고르면 그 주 작성 화면 출결이 비어 있거나 처음 채워진 「출석」 그대로일 때만 「출결도 결석으로 바꿀까요?」를 한 번 묻는다
     (이번 주를 열면 모두 「출석」으로 미리 채워지므로 출석은 아직 안 고친 것으로 본다 · 지각 · 결석이면 묻지 않는다)
     고치기 · 대신 입력은 시험마다 「전체 문항 수」 · 「틀린 개수」. 누가 · 언제 했는지 서버(review_log)에 남는다
     예전 기록(틀린 번호 방식)은 「복습 TEST」로 그대로 보인다
   · 작성 화면 학생 줄 [결석] [미응시] [응시] (20261031v · migration-048) — 하나를 누르면 안 낸 시험이 같이 바뀐다 · [따로 정하기]로 시험마다
     따로 정한 줄(안 낸 시험끼리 값이 다름)에는 작게 「따로」. 낸 시험은 점수 그대로(바꾸지 않는다)
     기본값: 그 수업 마감(다음 날 0시)이 지났는데 하나도 안 낸 학생은 처음부터 「결석」(서버 review_default_absent · auto) ·
     하나만 낸 학생은 안 낸 시험 「미응시」 · 직접 고른 값은 다시 불러와도 덮지 않는다
     「결석」을 직접 고르면 예전 미응시 결석처럼 출결이 비었거나 「출석」일 때만 「출결도 결석으로 바꿀까요?」 — 기본값 결석은 출결을 건드리지 않는다
   · [지금 제출 현황]: 교실 화면용 — 이름 옆에 시험별 제출 여부만 (점수는 아예 불러오지 않는다)
   · [시험별 평균]: 반 단위, 최근 시험들의 평균 점수 — 낸 점수 그대로 (코치룸에서만)
   · [지난 시험지 사진 정리] — 점수는 남기고 사진만 지운다
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }
  var NEED_SQL = 'migration-025 SQL 을 먼저 실행해 주세요 (README 5-22).';
  var NEED_028 = '미응시는 migration-028 SQL 을 먼저 실행해 주세요 (README 5-25).';
  /* 미응시 사유 — 서버(migration-028)와 같은 이름 · 메모는 대체 · 기타에만 */
  var REASONS = [['absent', '결석'], ['late', '지각'], ['counsel', '상담 중'], ['replaced', '다른 시험으로 대체'], ['other', '기타']];
  /* 작성 화면에서 고른 미응시(사유 없음) · 응시(점수는 아직) — migration-048 */
  var EXTRA = { none: '미응시', taken: '응시' };
  function reasonLabel(k) { var r = REASONS.filter(function (x) { return x[0] === k; })[0]; return r ? r[1] : EXTRA[k] || ''; }
  function memoOk(k) { return k === 'replaced' || k === 'other'; }
  var BUCKET = 'review-photos';
  var SHRINK = { maxSide: 1280, target: 150 * 1024 };

  var st = { cls: '', week: '', mon: '', key: '', data: null, missing: false, role: '', edit: null, live: null, liveTimer: null };

  function monday(iso) {
    if (!iso) return '';
    return Lesson.addDays(iso, -((Lesson.dowOf(iso) + 6) % 7));
  }
  function scoreText(s) { return s.correct + ' / ' + s.q_count + ' · ' + s.score + '점'; }
  function wrongN(s) { return s.wrong_n != null ? s.wrong_n : (s.wrong || []).length; }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function isTeacher() { return !!st.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */
  function label(t) { return t.label || (Lesson.md(String(t.lesson_date).slice(0, 10)) + ' ' + (t.test_name || '복습 TEST')); }

  /* ============================================================
     불러오기 · 그리기 — weekly.js 의 render 가 부른다
     ============================================================ */

  /* opts.course — 과정 작성 화면: 그 회차 첫 반 시험 목록이 기준이고 다른 반에 맞춰진다 (마감은 반마다 그 반 수업일 · 20261031a) */
  function render(cls, week, opts) {
    if (!$('#rvSub')) return;
    var key = (cls || '') + '|' + monday(week) + (opts && opts.course ? '|c' : '');
    st.course = (opts && opts.course) ? opts : null;
    st.cls = cls || ''; st.week = week || ''; st.mon = monday(week);
    if (key !== st.key) { st.key = key; st.data = null; st.edit = null; draw(); load(); }
  }

  /* 기본값 「결석」 — 그 반 그 주를 처음 열 때 한 번 (마감이 지난 수업 · 하나도 안 냄 · 표시 없음만 · 서버가 본다 · migration-048) */
  var defaulted = {};
  function ensureDefault(cls, mon) {
    var k = cls + '|' + mon;
    if (defaulted[k]) return Promise.resolve();
    defaulted[k] = true;
    return Promise.resolve(sb().rpc('review_default_absent', { p_class: cls, p_week: mon })).then(function () {}, function () {});
  }
  function load() {
    var key = st.key;
    if (!st.cls || !st.mon) { draw(); return Promise.resolve(); }
    return ensureDefault(st.cls, st.mon).then(function () { return sb().rpc('review_week', { p_class: st.cls, p_week: st.mon }); }).then(function (r) {
      if (key !== st.key) return;
      st.missing = !!(r.error && isMissing(r.error));
      if (r.error && !st.missing) { toast('복습테스트를 불러오지 못했습니다 — ' + r.error.message, 'bad'); return; }
      var d = r.data || null;
      /* 025 전 함수(시험 하나) — 같은 모양으로 */
      if (d && !d.tests) {
        st.missing = true;
        d = null;
      }
      st.data = d;
      draw();
    });
  }

  function tests() { return (st.data && st.data.tests) || []; }
  function onTests() { return tests().filter(function (t) { return !t.off; }); }

  function draw() {
    drawInner();
    window.dispatchEvent(new CustomEvent('jt:review-drawn'));     /* 학생 카드 「복습테스트」 줄 (write.js) */
  }
  function drawInner() {
    var line = $('#rvLine'), tools = $('#rvTools'), host = $('#rvTable');
    if (!line) return;
    $('#btnRvLive').disabled = $('#btnRvStats').disabled = !st.cls;
    if (st.missing) { line.textContent = ''; tools.innerHTML = ''; host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    var d = st.data;
    if (!d) { line.textContent = st.cls ? '불러오는 중…' : ''; tools.innerHTML = ''; host.innerHTML = ''; return; }
    var all = tests(), on = onTests();
    if (!all.length) {
      line.textContent = Store.schedOf(st.cls) ? '이 주에는 수업일이 없습니다 (휴강 · 첫 수업 전)' : '수업 요일을 정하면 수업일마다 저절로 생깁니다';
      tools.innerHTML = isTeacher() ? cleanBtn() : '';
      host.innerHTML = '';
      return;
    }
    var rows = d.rows || [];
    var day = all[0].lesson_date;
    /* 요약 줄 — 보는 시험은 굵게, 뺀 시험은 「복습 TEST 이번 주 안 봄 · 되돌리기」 (20261029g)
       시험마다 「복습 TEST 제출 9 · 미응시 1 / 11」 — 미응시는 제출과 따로 센다 (20261029h) */
    line.innerHTML = '<b>' + esc(Lesson.md(String(day).slice(0, 10))) + '</b> · ' + (on.length ? on.map(function (t) { return '<b>' + esc(t.test_name) + '</b>'; }).join(' · ') : '시험 없음') +
      (st.course ? ' · <span class="rv-course">과정 모든 반에 같은 시험 · 마감 ' + esc(st.course.members.map(function (m) { return Course.shortName(m.cls) + ' ' + Lesson.md(m.date); }).join(' · ')) + ' 밤 12시</span>'
        : ' · 마감 ' + esc(Lesson.md(String(day).slice(0, 10))) + ' 밤 12시') +
      (on.length ? ' <span class="muted-note rv-count">' + on.map(function (t) { return esc(countText(t, rows)); }).join(' · ') + '</span>' : '') +
      all.filter(function (t) { return t.off; }).map(function (t) {
        return ' <span class="rv-off">' + esc(t.test_name) + ' 이번 주 안 봄 · <button type="button" class="link-btn" data-rv="on" data-tid="' + esc(t.id) + '">되돌리기</button></span>';
      }).join('');
    tools.innerHTML = '<button class="btn btn--sm" type="button" data-rv="add">+ 시험 추가 (이번 주만)</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-rv="skip"' + (on.length ? '' : ' disabled') + '>이번 주 시험 빼기</button>' +
      (isTeacher() ? cleanBtn() : '');

    if (!on.length) { host.innerHTML = '<p class="panel__hint">이번 주 시험을 모두 껐습니다.</p>'; return; }
    if (!rows.length) { host.innerHTML = '<p class="panel__hint">이 반에 다니는 학생이 없습니다.</p>'; return; }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table rv-table"><thead><tr>' +
      '<th>학생</th>' + on.map(function (t) { return '<th>' + esc(label(t)) + '</th>'; }).join('') + '<th>사진</th></tr></thead><tbody>' +
      rows.map(function (x) { return rowHtml(x, on); }).join('') + '</tbody></table></div>';
  }

  /* 「복습 TEST 제출 9 · 미응시 1 / 11」 (미응시가 없으면 「복습 TEST 제출 9 / 11」) */
  function countText(t, rows) {
    var sub = rows.filter(function (x) { return x.subs && x.subs[t.id]; }).length;
    var ab = rows.filter(function (x) { return absentOf(x, t); }).length;
    return t.test_name + ' 제출 ' + sub + (ab ? ' · 미응시 ' + ab : '') + ' / ' + rows.length;
  }
  function absentOf(x, t) { return (x && !(x.subs && x.subs[t.id]) && x.absent && x.absent[t.id]) || null; }
  /* 「미응시 · 결석」 · 사유 없이 고른 미응시는 「미응시」 · 응시(점수 없음)는 「응시 · 점수 없음」 */
  function absText(ab) {
    if (!ab) return '';
    if (ab.reason === 'taken') return '응시 · 점수 없음';
    var l = ab.label || reasonLabel(ab.reason);
    return l && l !== '미응시' ? '미응시 · ' + l : '미응시';
  }

  function cleanBtn() { return '<button class="btn btn--sm btn--ghost" type="button" data-rv="clean">지난 시험지 사진 정리</button>'; }

  /* 「확인」 표시는 없앴다 — 누가 넣었는지만 (조교 입력 · 고침 · 학생 입력) */
  function stateHtml(s) {
    if (!s) return '<span class="rv-st rv-st--none">미제출</span>';
    if (s.source === 'staff') return '<span class="rv-st rv-st--sub">제출</span> <span class="muted-note">조교 입력 · ' + esc(s.confirmed_by) + ' ' + fmtDT(s.confirmed_at) + '</span>';
    if (s.edited_by) return '<span class="rv-st rv-st--sub">제출</span> <span class="muted-note">고침 · ' + esc(s.edited_by) + ' ' + fmtDT(s.edited_at || s.confirmed_at) + '</span>';
    return '<span class="rv-st rv-st--sub">제출</span> <span class="muted-note">학생 입력 · ' + fmtDT(s.submitted_at) + '</span>';
  }

  function photosOf(x) {
    var seen = {}, out = [];
    Object.keys(x.subs || {}).forEach(function (k) {
      ((x.subs[k] && x.subs[k].photos) || []).forEach(function (p) { if (p && !seen[p]) { seen[p] = 1; out.push(p); } });
    });
    return out;
  }

  function cellHtml(x, t) {
    var s = x.subs && x.subs[t.id];
    var ab = absentOf(x, t);
    /* 미응시 — 회색 「미응시 · 결석」(누르면 사유 바꾸기 · 미응시 취소) · 메모는 여기(코치룸)에서만 */
    if (ab) {
      return '<td class="rv-cell is-absent">' +
        '<button type="button" class="rv-absent" data-rv="absent" data-tid="' + esc(t.id) + '" title="사유 바꾸기 · 미응시 취소">' + esc(absText(ab)) + (ab.auto ? ' <small>(기본값)</small>' : '') + '</button>' +
        (ab.memo ? '<div class="muted-note rv-absent__memo">' + esc(ab.memo) + '</div>' : '') +
        '<div class="muted-note">' + esc(ab.set_by || '') + ' ' + fmtDT(ab.set_at) + '</div>' +
        '<div class="tb-acts"><button class="btn btn--sm btn--ghost" type="button" data-rv="entry" data-tid="' + esc(t.id) + '">대신 입력</button></div></td>';
    }
    var acts = !s
      ? '<button class="btn btn--sm" type="button" data-rv="entry" data-tid="' + esc(t.id) + '">대신 입력</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-rv="absent" data-tid="' + esc(t.id) + '">미응시</button>'
      : '<button class="btn btn--sm btn--ghost" type="button" data-rv="edit" data-tid="' + esc(t.id) + '">고치기</button>';
    return '<td class="rv-cell">' +
      (s ? '<div class="num rv-cell__score">' + esc(scoreText(s)) + '</div>' +
           (s.mode === 'numbers' && (s.wrong || []).length ? '<div class="muted-note">틀린 번호 ' + esc(s.wrong.join(', ')) + '</div>' : '') : '') +
      '<div>' + stateHtml(s) + '</div>' +
      '<div class="tb-acts">' + acts + '</div></td>';
  }

  /* 로그인 불가 · 반 없음 / 학생 번호 없음 — 학생이 /s/ 로 들어와 시험을 낼 수 없다 (app.js · 20261031s) */
  function loginTag(sid) {
    var s = Store.getStudents().find(function (y) { return y.id === sid; });
    return s && window.UI && UI.loginTagHtml ? ' ' + UI.loginTagHtml(s) : '';
  }
  function rowHtml(x, on) {
    var editing = st.edit && st.edit.sid === x.student_id;
    var ph = photosOf(x);
    var left = on.filter(function (t) { return !(x.subs && x.subs[t.id]); });
    var tr = '<tr data-sid="' + esc(x.student_id) + '">' +
      '<td><span class="roster__name">' + esc(x.name) + '</span>' +
        /* 안 낸 시험이 둘 이상일 때만 — 하나면 그 칸 [미응시]와 같은 일이라 겹친다 (20261030b) */
        (left.length > 1 ? ' <button class="btn btn--sm btn--ghost rv-allabs" type="button" data-rv="absent-all" title="이번 주 아직 안 낸 시험 ' + left.length + '개에 같은 사유">이번 주 전부 미응시</button>' : '') + loginTag(x.student_id) + '</td>' +
      on.map(function (t) { return cellHtml(x, t); }).join('') +
      '<td>' + (ph.length ? '<button class="btn btn--sm btn--ghost" type="button" data-rv="photo">사진 ' + ph.length + '장</button>' : '<span class="muted-note">없음</span>') + '</td></tr>';
    if (editing) tr += '<tr class="rv-edit-row" data-sid="' + esc(x.student_id) + '"><td colspan="' + (on.length + 2) + '">' + editorHtml() + '</td></tr>';
    return tr;
  }

  function editCheck(e) {
    var q = Number(e.q), w = Number(e.w);
    if (!/^\d+$/.test(String(e.q)) || q < 1 || q > 200) return { msg: '전체 문항 수를 1 ~ 200 으로 적어 주세요' };
    if (!/^\d+$/.test(String(e.w))) return { msg: '틀린 개수를 적어 주세요 (다 맞았으면 0)' };
    if (w > q) return { msg: '틀린 개수가 전체보다 많습니다' };
    return { ok: true, q: q, w: w, text: (q - w) + ' / ' + q + ' · ' + Math.round((q - w) / q * 100) + '점' };
  }

  function editorHtml() {
    var e = st.edit;
    if (e.mode === 'absent') return absentEditorHtml(e);
    var t = tests().find(function (x) { return x.id === e.tid; }) || {};
    var c = editCheck(e);
    return '<div class="rv-editor">' +
      '<div class="rv-editor__head"><b>' + esc(label(t)) + ' — ' + (e.mode === 'entry' ? '대신 입력' : '점수 고치기') + '</b></div>' +
      '<div class="rv-editor__in">' +
        '<label class="field"><span class="field__label">전체 문항 수</span><input class="input input--num" type="number" min="1" max="200" data-rv-eq value="' + esc(e.q) + '"></label>' +
        '<label class="field"><span class="field__label">틀린 개수</span><input class="input input--num" type="number" min="0" max="200" data-rv-ew value="' + esc(e.w) + '"></label>' +
        '<span class="num rv-editor__score" data-rv-escore>' + esc(c.ok ? c.text : c.msg) + '</span>' +
      '</div>' +
      (e.mode === 'entry'
        ? '<label class="btn btn--sm">시험지 사진 (선택 · 여러 장)<input type="file" accept="image/*" multiple data-rv-file hidden></label> <span class="muted-note" data-rv-photo-note>' +
            (e.blobs.length ? '사진 ' + e.blobs.length + '장 준비됨' : '사진 없이도 저장됩니다 · 「조교 입력」으로 표시') + '</span>'
        : '<span class="muted-note">고치기 전 값과 고친 사람이 기록됩니다.</span>') +
      '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" data-rv="save">저장</button>' +
      '<button class="btn btn--sm btn--ghost" type="button" data-rv="cancel">취소</button></div>' +
    '</div>';
  }

  /* 미응시 사유 고르기 — 결석 · 지각 · 상담 중 · 다른 시험으로 대체 · 기타 (뒤의 둘은 짧은 메모) */
  function absentEditorHtml(e) {
    var x = rowOf(e.sid) || {};
    var name = e.all ? '이번 주 시험 전부 (' + e.tids.length + '개)' : label(testOf(e.tids[0]) || {});
    return '<div class="rv-editor rv-absent-ed">' +
      '<div class="rv-editor__head"><b>' + esc(x.name || '') + ' · ' + esc(name) + ' — 미응시 사유</b></div>' +
      '<div class="rv-reasons" role="radiogroup" aria-label="미응시 사유">' + REASONS.map(function (r) {
        var on = e.reason === r[0];
        return '<button type="button" class="btn btn--sm rv-reason' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-rv="reason" data-v="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div>' +
      (memoOk(e.reason)
        ? '<label class="field rv-memo"><span class="field__label">메모 (선택 · 60자 · 코치룸에서만 보임)</span>' +
            '<input class="input" type="text" maxlength="60" data-rv-memo value="' + esc(e.memo || '') + '" placeholder="' + (e.reason === 'replaced' ? '예: 10/23 재시험으로 대체' : '예: 병원 진료') + '"></label>'
        : '') +
      '<span class="muted-note">학부모 · 학생 화면에는 「미응시 · 결석」처럼 사유 이름만 나갑니다. 나중에 학생이 직접 내거나 대신 입력하면 미응시는 저절로 풀립니다.</span>' +
      '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" data-rv="absent-save"' + (e.reason ? '' : ' disabled') + '>저장</button>' +
        (e.had ? '<button class="btn btn--sm" type="button" data-rv="absent-clear">미응시 취소</button>' : '') +
        '<button class="btn btn--sm btn--ghost" type="button" data-rv="cancel">닫기</button></div>' +
    '</div>';
  }

  function rowOf(sid) { return ((st.data && st.data.rows) || []).find(function (x) { return x.student_id === sid; }) || null; }
  function testOf(id) { return tests().find(function (t) { return t.id === id; }) || null; }

  /* ============================================================
     동작
     ============================================================ */

  function onClick(e) {
    var b = e.target.closest('[data-rv]');
    if (!b) return;
    var act = b.dataset.rv;
    var tr = b.closest('tr');
    var x = tr ? rowOf(tr.dataset.sid) : null;
    var t = b.dataset.tid ? testOf(b.dataset.tid) : null;
    var s = x && t && x.subs ? x.subs[t.id] : null;

    if (act === 'skip') { openSkip(); return; }
    if (act === 'skip-pick' && t) {
      $('#rvSkipModal').close();
      /* 창이 닫힌 뒤 확인 창 (뒤로가기 기록이 꼬이지 않게 · nav.js) */
      setTimeout(function () {
        UI.confirmAsk('이번 주 시험 빼기', label(t) + '를 이번 주 시험에서 뺄까요? 학생 화면에서도 사라집니다.', '빼기')
          .then(function (yes) { if (yes) call('review_test_set', { p_test: t.id, p_off: true }, label(t) + '를 이번 주 시험에서 뺐습니다'); });
      }, 60);
      return;
    }
    if (act === 'on' && t) call('review_test_set', { p_test: t.id, p_off: false }, label(t) + '를 다시 넣었습니다');
    if (act === 'add') {
      var nm = window.prompt('이번 주(' + Lesson.md(String((tests()[0] || {}).lesson_date || st.mon).slice(0, 10)) + ')에만 더 넣을 시험 이름 (예: 어휘 TEST)', '');
      if (nm == null || !nm.trim()) return;
      call('review_test_add', { p_class: st.cls, p_week: st.mon, p_name: nm.trim() }, '「' + nm.trim() + '」을(를) 이번 주에 넣었습니다');
    }
    if (act === 'clean') cleanPhotos();
    if (act === 'edit' && s) { st.edit = { sid: x.student_id, tid: t.id, mode: 'edit', q: String(s.q_count), w: String(wrongN(s)), blobs: [] }; draw(); focusEditor(); }
    if (act === 'entry' && x && t) { st.edit = { sid: x.student_id, tid: t.id, mode: 'entry', q: '', w: '', blobs: [] }; draw(); focusEditor(); }
    if (act === 'absent' && x && t) {
      var ab = absentOf(x, t);
      st.edit = { sid: x.student_id, tids: [t.id], mode: 'absent', all: false, reason: ab ? ab.reason : '', memo: ab ? ab.memo || '' : '', had: !!ab };
      draw(); return;
    }
    if (act === 'absent-all' && x) {
      var left = onTests().filter(function (tt) { return !(x.subs && x.subs[tt.id]); });
      if (!left.length) return;
      var first = left.map(function (tt) { return absentOf(x, tt); }).filter(Boolean)[0];
      st.edit = { sid: x.student_id, tids: left.map(function (tt) { return tt.id; }), mode: 'absent', all: true, reason: first ? first.reason : '', memo: first ? first.memo || '' : '', had: false };
      draw(); return;
    }
    if (act === 'reason' && st.edit && st.edit.mode === 'absent') { st.edit.reason = b.dataset.v; draw(); return; }
    if (act === 'absent-save') { saveAbsent(); return; }
    if (act === 'absent-clear') { clearAbsent(); return; }
    if (act === 'cancel') { st.edit = null; draw(); }
    if (act === 'save') save();
    if (act === 'photo' && x) showPhotos(photosOf(x));
  }

  /* 이번 주 시험 빼기 — 보는 시험 목록에서 고른다. 제출이 있으면 뺄 수 없다 (서버 review_test_set 도 막는다) */
  function subCount(t) {
    return ((st.data && st.data.rows) || []).filter(function (x) { return x.subs && x.subs[t.id]; }).length;
  }
  function openSkip() {
    var on = onTests();
    if (!on.length) return;
    $('#rvSkipList').innerHTML = on.map(function (t) {
      var n = subCount(t);
      return '<div class="rv-skip-row">' +
        '<span class="rv-skip-name"><b>' + esc(label(t)) + '</b>' + (n ? ' <span class="muted-note">제출 ' + n + '명 있음 · 뺄 수 없음</span>' : ' <span class="muted-note">제출 없음</span>') + '</span>' +
        '<button class="btn btn--sm" type="button" data-rv="skip-pick" data-tid="' + esc(t.id) + '"' + (n ? ' disabled' : '') + '>빼기</button>' +
      '</div>';
    }).join('');
    $('#rvSkipModal').showModal();
  }

  function focusEditor() { var i = document.querySelector('#rvTable [data-rv-eq]'); if (i) try { i.focus(); } catch (er) {} }

  function onInput(e) {
    if (!st.edit) return;
    if (e.target.hasAttribute('data-rv-memo')) { st.edit.memo = e.target.value; return; }
    if (e.target.hasAttribute('data-rv-eq')) st.edit.q = e.target.value;
    else if (e.target.hasAttribute('data-rv-ew')) st.edit.w = e.target.value;
    else return;
    var c = editCheck(st.edit);
    var sc = document.querySelector('#rvTable [data-rv-escore]');
    if (sc) sc.textContent = c.ok ? c.text : c.msg;
  }

  function call(fn, args, okMsg, need) {
    return sb().rpc(fn, args).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? (need || NEED_SQL) : r.error.message, 'bad'); return null; }
      if (okMsg) toast(okMsg, 'good');
      st.edit = null;
      if (/^review_test_/.test(fn)) window.dispatchEvent(new CustomEvent('jt:review-changed', { detail: { cls: st.cls, week: st.mon } }));
      return load().then(function () { return r.data; });
    });
  }

  function save() {
    var e = st.edit, x = rowOf(e.sid), t = testOf(e.tid);
    if (!x || !t) return;
    var c = editCheck(e);
    if (!c.ok) { toast(c.msg, 'bad'); return; }
    if (e.mode === 'edit') {
      call('review_edit2', { p_sub: x.subs[t.id].id, p_q: c.q, p_wrong: c.w }, x.name + ' ' + t.test_name + ' 점수를 고쳤습니다');
      return;
    }
    var ups = e.blobs.map(function (blob) {
      var path = 'staff/' + x.student_id + '/' + String(t.lesson_date).slice(0, 10) + '/' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.jpg';
      return sb().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
        if (r.error) throw new Error('사진을 올리지 못했습니다 — ' + r.error.message);
        return { path: path, bytes: blob.size };
      });
    });
    Promise.all(ups).then(function (photos) {
      return call('review_staff_entry2', { p_test: t.id, p_student: x.student_id, p_q: c.q, p_wrong: c.w, p_photos: photos }, x.name + ' ' + t.test_name + ' 대신 입력했습니다 (조교 입력)');
    }).catch(function (err) { toast(err.message, 'bad'); });
  }

  /* 미응시 저장 — 「결석」이면 그 주 작성 화면 출결이 비어 있거나 「출석」(미리 채운 값)일 때만 「출결도 결석으로 바꿀까요?」 한 번 */
  function attendOpen(a) { return a === '' || a === 'attend'; }
  function saveAbsent() {
    var e = st.edit, x = rowOf(e.sid);
    if (!x || !e.reason) return;
    var memo = memoOk(e.reason) ? String(e.memo || '').trim().slice(0, 60) : '';
    var what = e.all ? '이번 주 시험 ' + e.tids.length + '개' : ((testOf(e.tids[0]) || {}).test_name || '');
    var sid = x.student_id, name = x.name, reason = e.reason, mon = st.mon;
    call('review_absent_set', { p_tests: e.tids, p_student: sid, p_reason: reason, p_memo: memo },
         name + ' ' + what + ' 미응시(' + reasonLabel(reason) + ')로 넣었습니다', NEED_028).then(function (res) {
      if (!res || reason !== 'absent' || !window.Writer || !Writer.attendOf) return;
      if (!attendOpen(Writer.attendOf(sid, mon))) return;      /* 지각 · 결석을 넣었거나 다른 주를 쓰는 중이면 묻지 않는다 */
      UI.confirmAsk('출결', name + ' — 출결도 결석으로 바꿀까요?', '결석으로 바꾸기').then(function (yes) {
        if (yes && attendOpen(Writer.attendOf(sid, mon))) Writer.setAbsent(sid);
      });
    });
  }
  function clearAbsent() {
    var e = st.edit, x = rowOf(e.sid), t = testOf(e.tids[0]);
    if (!x || !t) return;
    call('review_absent_clear', { p_test: t.id, p_student: x.student_id }, x.name + ' ' + t.test_name + ' 미응시를 취소했습니다', NEED_028);
  }

  function onChange(e) {
    if (e.target.dataset.rvFile == null || !st.edit) return;
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    files.reduce(function (p, f) {
      return p.then(function () { return Photos.shrink(f, SHRINK).then(function (s) { st.edit.blobs.push(s.blob); }); });
    }, Promise.resolve()).then(function () {
      var note = document.querySelector('#rvTable [data-rv-photo-note]');
      if (note) note.textContent = '사진 ' + st.edit.blobs.length + '장 준비됨';
    }).catch(function (err) { toast((err && err.message) || '사진을 열 수 없습니다', 'bad'); });
  }

  function showPhotos(paths) {
    if (!paths.length) return;
    sb().storage.from(BUCKET).createSignedUrls(paths, 600).then(function (r) {
      var urls = ((r && r.data) || []).map(function (x) { return x.signedUrl; }).filter(Boolean);
      if (r.error || !urls.length) { toast('사진을 열지 못했습니다', 'bad'); return; }
      var box = document.createElement('div');
      box.className = 'rv-light rv-light--many';
      box.innerHTML = urls.map(function (u, i) { return '<img alt="시험지 사진 ' + (i + 1) + '" src="' + esc(u) + '">'; }).join('') +
        '<button type="button" class="rv-light__close" aria-label="닫기">×</button>';
      box.addEventListener('click', function (ev) { if (ev.target.tagName !== 'IMG' || urls.length === 1) box.remove(); });
      box.querySelector('.rv-light__close').addEventListener('click', function () { box.remove(); });
      document.body.appendChild(box);
    });
  }

  /* ---------- 지난 시험지 사진 정리 ---------- */

  function cleanPhotos() {
    var def = Lesson.addDays(DDay.today(), -120);
    var v = window.prompt('이 날짜보다 앞선 수업의 시험지 사진을 지웁니다 (점수 기록은 남습니다). 날짜 (YYYY-MM-DD)', def);
    if (v == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('날짜를 YYYY-MM-DD 로 적어 주세요', 'bad'); return; }
    sb().rpc('review_photo_list', { p_before: v }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      var list = r.data || [];
      if (!list.length) { toast(Lesson.md(v) + ' 앞 시험지 사진이 없습니다'); return; }
      var paths = [], ids = [], seen = {}, bytes = 0;
      list.forEach(function (x) {
        if (ids.indexOf(x.id) === -1) ids.push(x.id);
        if (!seen[x.path]) { seen[x.path] = 1; paths.push(x.path); bytes += x.bytes || 0; }
      });
      var mb = (bytes / 1048576).toFixed(1);
      UI.confirmAsk('지난 시험지 사진 정리', '사진 ' + paths.length + '장 (' + mb + 'MB)을 지웁니다. 점수 기록은 그대로 남고, 되살릴 수 없습니다.', '지우기').then(function (yes) {
        if (!yes) return;
        var chunks = [];
        for (var i = 0; i < paths.length; i += 100) chunks.push(paths.slice(i, i + 100));
        chunks.reduce(function (p, part) {
          return p.then(function () {
            return sb().storage.from(BUCKET).remove(part).then(function (rr) { if (rr.error) throw new Error(rr.error.message); });
          });
        }, Promise.resolve()).then(function () {
          return sb().rpc('review_photo_clear', { p_ids: ids }).then(function (rr) { if (rr.error) throw new Error(rr.error.message); });
        }).then(function () {
          toast('시험지 사진 ' + paths.length + '장을 지웠습니다', 'good');
          load();
        }).catch(function (err) { toast('정리하지 못했습니다 — ' + err.message, 'bad'); });
      });
    });
  }

  /* ============================================================
     지금 제출 현황 (교실 화면) — 이름 옆에 시험별 제출 여부만
     ============================================================ */

  function openLive() {
    if (!st.cls) return;
    st.live = { cls: st.cls, mon: st.mon };
    $('#rvLive').hidden = false;
    document.body.classList.add('rv-live-open');
    loadLive();
    clearInterval(st.liveTimer);
    st.liveTimer = setInterval(loadLive, 8000);      /* 실시간이 끊겨도 8초마다 */
  }

  function closeLive() {
    $('#rvLive').hidden = true;
    document.body.classList.remove('rv-live-open');
    clearInterval(st.liveTimer); st.liveTimer = null; st.live = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  function loadLive() {
    var L = st.live;
    if (!L) return;
    sb().rpc('review_live', { p_class: L.cls, p_week: L.mon }).then(function (r) {
      if (!st.live) return;
      if (r.error) { $('#rvLiveGrid').innerHTML = '<p class="rv-live__msg">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      var d = r.data || {};
      var ts = d.tests || [];
      if (!ts.length) {
        $('#rvLiveTitle').textContent = L.cls + ' · 이번 주 복습테스트 없음';
        $('#rvLiveCount').textContent = '';
        $('#rvLiveGrid').innerHTML = '';
        return;
      }
      var rows = d.rows || [];
      var n = rows.filter(function (x) { return x.submitted; }).length;
      /* 미응시 — 안 낸 시험이 모두 미응시인 학생 (제출과 따로 센다 · migration-028) */
      var settled = function (x) { var dn = x.done || {}, ab = x.absent || {}; return ts.every(function (t) { return dn[t.id] || ab[t.id]; }); };
      var abN = rows.filter(function (x) { return !x.submitted && settled(x); }).length;
      $('#rvLiveTitle').textContent = (d.class_name || L.cls) + ' · ' + Lesson.md(String(ts[0].lesson_date).slice(0, 10)) + ' ' + ts.map(function (t) { return t.test_name; }).join(' · ');
      $('#rvLiveCount').textContent = '모두 제출 ' + n + (abN ? ' · 미응시 ' + abN : '') + ' / ' + rows.length;
      $('#rvLiveGrid').innerHTML = rows.map(function (x) {
        var done = x.done || {}, ab = x.absent || {};
        return '<div class="rv-live__cell' + (x.submitted ? ' is-done' : settled(x) ? ' is-absent' : '') + '">' +
          '<span class="rv-live__name">' + esc(x.name) + '</span>' +
          '<span class="rv-live__tests">' + ts.map(function (t) {
            var ok = !!done[t.id], no = !ok && !!ab[t.id];
            return '<span class="rv-live__t' + (ok ? ' is-ok' : no ? ' is-absent' : '') + '">' + esc(t.test_name.replace(/ TEST$/, '')) + ' ' + (ok ? '✓' : no ? '미응시' : '·') + '</span>';
          }).join('') + '</span>' +
          '<span class="sr-only">' + ts.map(function (t) { return t.test_name + (done[t.id] ? ' 제출' : ab[t.id] ? ' 미응시 ' + ab[t.id] : ' 아직'); }).join(', ') + '</span></div>';
      }).join('');
    });
  }

  /* ============================================================
     시험별 평균 (반 단위 · 최근 시험들 · 낸 점수 그대로 · migration-030) — 「자주 틀린 번호」 대신 (migration-025)
     ============================================================ */

  function openStats() {
    if (!st.cls) return;
    $('#rvStatsTitle').textContent = st.cls + ' · 시험별 평균';
    $('#rvStatsBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    $('#rvStatsModal').showModal();
    sb().rpc('review_stats', { p_class: st.cls }).then(function (r) {
      if (r.error) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      var list = r.data || [];
      if (!list.length) { $('#rvStatsBody').innerHTML = '<p class="panel__hint">아직 낸 복습테스트 기록이 없습니다.</p>'; return; }
      $('#rvStatsBody').innerHTML = list.map(function (t) {
        var avg = t.avg == null ? 0 : Number(t.avg);
        return '<div class="rv-bar rv-bar--avg"><span class="rv-bar__q">' + esc(t.label || t.test_name) + '</span>' +
          '<span class="rv-bar__track"><span class="rv-bar__fill" style="width:' + avg + '%"></span></span>' +
          '<span class="rv-bar__v num">' + (t.avg == null ? '—' : t.avg + '점') + ' · ' + t.n + '명</span></div>';
      }).join('');
    });
  }

  /* ============================================================
     시작
     ============================================================ */

  function bind() {
    if (!$('#rvSub')) return;
    $('#rvSub').addEventListener('click', onClick);
    $('#rvSkipList').addEventListener('click', onClick);
    $('#rvSkipClose').addEventListener('click', function () { $('#rvSkipModal').close(); });
    $('#rvSub').addEventListener('change', onChange);
    $('#rvSub').addEventListener('input', onInput);
    $('#btnRvLive').addEventListener('click', openLive);
    $('#btnRvLiveClose').addEventListener('click', closeLive);
    $('#btnRvLiveFull').addEventListener('click', function () {
      var el = $('#rvLive');
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.live) closeLive(); });
    $('#btnRvStats').addEventListener('click', openStats);
    $('#btnRvStatsClose').addEventListener('click', function () { $('#rvStatsModal').close(); });

    /* 학생이 내면 실시간 (sync.js) — 현황 화면은 바로, 표는 고치는 중이 아닐 때 */
    window.addEventListener('jt:remote', function (e) {
      var t = e.detail && e.detail.table;
      if (t !== 'review_submissions' && t !== 'review_tests' && t !== 'review_absences') return;
      if (st.live) loadLive();
      if (st.key && !st.edit) load();
    });
    window.addEventListener('jt:schedule-changed', function () { if (st.key) load(); });
    window.addEventListener('jt:loaded', function () {
      st.key = '';
      DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; draw(); });
    });
  }

  bind();

  /* 학생 카드 「복습테스트」 한 줄 (write.js · 20261029g) — 그 반 그 주를 아직 안 불러왔으면 null
     「복습 TEST 6/10 · 화작문 TEST 10/10」 · 하나도 안 냈으면 「아직 제출 안 함」 (「확인 전 / 확인 완료」는 없앴다 · 20261030a) */
  function lineOf(cls, week, sid) {
    if (st.missing) return '복습테스트 SQL(025) 전';
    if (!cls || st.cls !== cls || st.mon !== monday(week) || !st.data) return null;
    var on = onTests();
    if (!on.length) return '이번 주 복습테스트 없음';
    var x = rowOf(sid);
    var subs = (x && x.subs) || {};
    var anySub = on.some(function (t) { return subs[t.id]; });
    if (!anySub && !on.some(function (t) { return absentOf(x, t); })) return '아직 제출 안 함';
    /* 미응시 — 「복습 TEST 미응시(결석)」 (migration-028) */
    var parts = on.map(function (t) {
      var s = subs[t.id], ab = absentOf(x, t);
      if (!s) return t.test_name + (!ab ? ' 미제출' : ab.reason === 'taken' ? ' 응시(점수 없음)' : ab.reason === 'none' ? ' 미응시' : ' 미응시(' + (ab.label || reasonLabel(ab.reason)) + ')');
      return t.test_name + ' ' + s.correct + '/' + s.q_count;
    });
    return parts.join(' · ');
  }

  /* 학생 카드 [고치기] — 복습테스트 화면으로 가서 그 학생 줄을 잠깐 표시 */
  function focusStudent(sid) {
    var sub = $('#rvSub');
    if (!sub) return;
    sub.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var tr = document.querySelector('#rvTable tr[data-sid="' + sid + '"]');
    if (!tr) return;
    tr.classList.add('is-focus');
    setTimeout(function () { tr.classList.remove('is-focus'); }, 2400);
    var b = tr.querySelector('[data-rv="edit"], [data-rv="entry"]');
    if (b) try { b.focus(); } catch (er) {}
  }

  /* 코멘트 「AI로 초안 쓰기」 자료 — 제출 여부만 (점수는 보내지 않는다 · write.js · 20261029g) */
  function ready(cls, week) { return !!cls && st.cls === cls && st.mon === monday(week) && !!st.data; }
  function classFacts(cls, week) {
    if (!ready(cls, week)) return null;
    var rows = st.data.rows || [];
    return onTests().map(function (t) {
      var f = { 시험: t.test_name, 제출: rows.filter(function (x) { return x.subs && x.subs[t.id]; }).length, 전체: rows.length };
      var ab = rows.filter(function (x) { return absentOf(x, t); }).length;
      if (ab) f.미응시 = ab;
      return f;
    });
  }
  /* 미응시는 「미응시(결석)」 사유 이름까지만 — 메모는 넘기지 않는다 (20261029h) */
  function studentFacts(cls, week, sid) {
    if (!ready(cls, week)) return null;
    var x = rowOf(sid) || {}, subs = x.subs || {};
    return onTests().map(function (t) {
      var ab = absentOf(x, t);
      return { 시험: t.test_name, 제출: subs[t.id] ? '냄' : ab ? '미응시(' + (ab.label || reasonLabel(ab.reason)) + ')' : '안 냄' };
    });
  }

  /* ============================================================
     작성 화면 학생 줄 — 결석 · 미응시 · 응시 (20261031v · migration-048)
       시험마다 상태: 낸 것 sub(점수) · absent(결석) · taken(응시 · 점수 없음) · missing(미응시 — 다른 사유 · 사유 없음 · 표시 없음)
       마감(수업 다음 날 0시) 전이고 아무 표시도 없으면 pending(아직)
     ============================================================ */
  var STATES = [['absent', '결석'], ['missing', '미응시'], ['taken', '응시']];
  var splitOpen = {};
  function stateOf(x, t, closed) {
    if (x && x.subs && x.subs[t.id]) return 'sub';
    var ab = absentOf(x, t);
    if (ab) return ab.reason === 'absent' ? 'absent' : ab.reason === 'taken' ? 'taken' : 'missing';
    return closed ? 'missing' : 'pending';
  }
  function statusOf(cls, week, sid) {
    if (!ready(cls, week) || st.missing) return null;
    var on = onTests();
    if (!on.length) return null;
    var x = rowOf(sid), ld = String(st.data.lesson_date || on[0].lesson_date || '').slice(0, 10);
    var closed = !!ld && ld < DDay.today();
    var list = on.map(function (t) { var s = x && x.subs && x.subs[t.id]; return { id: t.id, name: t.test_name, state: stateOf(x, t, closed), score: s ? s.correct + '/' + s.q_count : '' }; });
    var open = list.filter(function (t) { return t.state !== 'sub'; });
    var kinds = {};
    open.forEach(function (t) { kinds[t.state] = 1; });
    var ks = Object.keys(kinds);
    return { tests: list, open: open, closed: closed, split: ks.length > 1, all: ks.length === 1 ? ks[0] : '' };
  }
  function segHtml(cur, attrs, dis) {
    return '<span class="rvst-seg" role="group" aria-label="테스트 상태">' + STATES.map(function (s) {
      return '<button type="button" class="rvst-b rvst-b--' + s[0] + (cur === s[0] ? ' is-on' : '') + '" data-rvst="' + s[0] + '"' + attrs + ' aria-pressed="' + (cur === s[0]) + '"' + (dis ? ' disabled' : '') + '>' + s[1] + '</button>';
    }).join('') + '</span>';
  }
  function statusHtml(cls, week, sid) {
    var v = statusOf(cls, week, sid);
    if (!v) return '';
    if (!v.open.length) return '<div class="rvst" data-rvst-sid="' + esc(sid) + '"><span class="rvst-done">모두 응시 ✓</span></div>';
    var open = splitOpen[sid] || v.split;
    var hint = !v.closed && v.open.every(function (t) { return t.state === 'pending'; }) ? '<span class="rvst-hint">마감 전 · 아직 안 냄</span>' : '';
    return '<div class="rvst" data-rvst-sid="' + esc(sid) + '">' +
      '<div class="rvst-main">' + segHtml(v.split ? '' : v.all, '', false) +
        (v.split ? '<span class="rvst-split" title="시험마다 따로 정했습니다">따로</span>' : '') + hint +
        (v.tests.length > 1 ? '<button type="button" class="rvst-sep" data-rvst-open aria-expanded="' + !!open + '">' + (open ? '같이 정하기' : '따로 정하기') + '</button>' : '') +
      '</div>' +
      (open && v.tests.length > 1 ? '<div class="rvst-each">' + v.tests.map(function (t) {
        return '<div class="rvst-row"><span class="rvst-name">' + esc(t.name) + '</span>' +
          (t.state === 'sub' ? '<span class="rvst-score num">응시 ' + esc(t.score) + '</span>' : segHtml(t.state, ' data-rvst-tid="' + esc(t.id) + '"', false)) + '</div>';
      }).join('') + '</div>' : '') +
    '</div>';
  }
  function setStatus(cls, week, sid, state, tid) {
    var v = statusOf(cls, week, sid), x = rowOf(sid);
    if (!v || !x) return Promise.resolve(null);
    var ids = tid ? [tid] : v.open.map(function (t) { return t.id; });
    if (!ids.length) return Promise.resolve(null);
    var name = x.name, mon = st.mon, lab = STATES.filter(function (s) { return s[0] === state; })[0][1];
    return call('review_status_set', { p_tests: ids, p_student: sid, p_state: state },
                name + ' ' + (tid ? ((testOf(tid) || {}).test_name || '') : '테스트') + ' 「' + lab + '」', '작성 화면 테스트 상태는 migration-048 SQL 을 먼저 실행해 주세요.').then(function (res) {
      if (!res || state !== 'absent' || !window.Writer || !Writer.attendOf) return res;
      if (!attendOpen(Writer.attendOf(sid, mon))) return res;
      return UI.confirmAsk('출결', name + ' — 출결도 결석으로 바꿀까요?', '결석으로 바꾸기').then(function (yes) {
        if (yes && attendOpen(Writer.attendOf(sid, mon))) Writer.setAbsent(sid);
        return res;
      });
    });
  }
  document.addEventListener('click', function (e) {
    var host = e.target.closest && e.target.closest('[data-rvst-sid]');
    if (!host) return;
    var sid = host.dataset.rvstSid;
    if (e.target.closest('[data-rvst-open]')) {
      var v = statusOf(st.cls, st.week, sid);
      splitOpen[sid] = !(splitOpen[sid] || (v && v.split));
      window.dispatchEvent(new CustomEvent('jt:review-drawn'));
      return;
    }
    var b = e.target.closest('[data-rvst]');
    if (!b || b.disabled || b.classList.contains('is-on')) return;
    setStatus(st.cls, st.week, sid, b.dataset.rvst, b.dataset.rvstTid || '');
  });

  window.Review = { render: render, reload: load, openLive: openLive, lineOf: lineOf, focusStudent: focusStudent,
                    classFacts: classFacts, studentFacts: studentFacts, statusOf: statusOf, statusHtml: statusHtml, setStatus: setStatus };

})();
