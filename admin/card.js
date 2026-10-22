/* ============================================================
   card.js — 학생 상담 카드 · 상담·관찰 기록

   명단에서 학생 이름을 누르면 열린다. 위에서부터
     다음 상담 때 확인 (고정) → 기본 정보 → 내신 → 모의고사 → 기록 타임라인
   주간 레포트 → 작성에서 학생을 고르면 오른쪽 '최근 기록' 상자에 확인 필요 + 최근 5개.

   민감 정보다. 표(student_cards · student_grades · student_notes)는
   staff 만 읽고 쓰며 학부모 화면 · 공개 함수 어디에도 나가지 않는다.
   기록 · 성적 줄은 지우지 않는다. 삭제 = 숨김(누가 · 언제), teacher 만 숨기고 되살린다.

   저장 방식은 다른 화면과 같다 — 바뀐 칸만, 다른 분이 먼저 고쳤으면 묻는다, 실시간 반영.
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$, $$ = UI.$$;
  function sb() { return SB.client; }
  function check(r) { if (r && r.error) throw new Error(r.error.message); return r; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }

  var CATS = ['상담', '집중', '정서·컨디션', '출결', '학습', '기타'];
  var SUBJ = [['kor', '국어'], ['eng', '영어'], ['math', '수학'], ['inq', '탐구']];
  var COLS = ['kor_raw', 'kor_grade', 'eng_raw', 'eng_grade', 'math_raw', 'math_grade', 'inq_raw', 'inq_grade'];
  var LEVELS = ['N수', '고3', '고2', '고1', '중3', '중2', '중1'];
  var KIND = { school: '내신', mock: '모의고사' };
  var MOCK_DEFAULT = ['3', '6', '9', '11'];
  var SCHOOL_DEFAULT = ['1학기', '2학기'];

  var me = { email: '', name: '', role: '' };
  var follow = {};                 /* 학생 id → 확인 필요 개수 */
  var ready = false;

  function isTeacher() { return !!me.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */
  function todayKST() { return window.DDay ? DDay.today() : Store.toISO(new Date()); }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[1].slice(2) + '.' + (+m[2]) + '.' + (+m[3]) : '';
  }
  function student(id) { return Store.getStudents().find(function (s) { return s.id === id; }) || null; }

  /* ============================================================
     확인 필요 개수 (명단 배지)
     ============================================================ */

  function loadFollow() {
    return sb().from('student_notes').select('student_id')
      .eq('follow_up', true).is('followed_at', null).is('deleted_at', null)
      .then(function (r) {
        if (r.error) { if (!isMissing(r.error)) console.error(r.error); return; }
        var next = {};
        r.data.forEach(function (x) { next[x.student_id] = (next[x.student_id] || 0) + 1; });
        var changed = JSON.stringify(next) !== JSON.stringify(follow);
        follow = next;
        if (changed) window.dispatchEvent(new CustomEvent('jt:roster-changed'));
      });
  }

  /* ============================================================
     상담 카드
     ============================================================ */

  var modal = $('#cardModal');
  var C = null;   /* 열린 카드 { sid, card, cardAt, studentAt, grades, notes, extra, filter, editing } */

  function open(sid, opts) {
    var s = student(sid);
    if (!s) return;
    C = {
      sid: sid, card: null, cardAt: '', studentAt: Store.baseAt('students', sid),
      grades: [], notes: [], showDeleted: false, editing: null, pendingNotes: false,
      extra: { school: { levels: [], terms: {} }, mock: { levels: [], terms: {} } },
      filter: { cats: {}, from: '', to: '', author: '', consult: false }
    };
    $('#cardTitle').textContent = s.name + ' 상담 카드';
    $('#cardDesc').textContent = [s.className, s.school, s.grade].filter(Boolean).join(' · ') +
      ' — 선생님·조교만 봅니다. 학부모 화면에는 나가지 않습니다';
    $('#cardBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    modal.showModal();
    loadAll().then(function () {
      if (opts && opts.compose) {
        var ta = $('#cnBody');
        if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); }
      }
    });
  }

  function loadAll() {
    if (!C) return Promise.resolve();
    var sid = C.sid;
    return Promise.all([
      sb().from('student_cards').select('*').eq('student_id', sid).maybeSingle(),
      sb().from('student_grades').select('*').eq('student_id', sid),
      sb().from('student_notes').select('*').eq('student_id', sid)
        .order('note_date', { ascending: false }).order('created_at', { ascending: false })
    ]).then(function (res) {
      res.forEach(check);
      if (!C || C.sid !== sid) return;
      C.card = res[0].data;
      C.cardAt = (C.card && C.card.updated_at) || '';
      C.grades = res[1].data || [];
      C.notes = res[2].data || [];
      renderAll();
    }).catch(function (e) {
      $('#cardBody').innerHTML = '<div class="empty-state">' + (isMissing(e)
        ? '상담 카드용 표가 아직 없습니다. Supabase SQL Editor 에서 <code>migration-004-notes.sql</code> 을 먼저 실행해 주세요.'
        : '불러오지 못했습니다 — ' + esc(e.message)) + '</div>';
    });
  }

  function renderAll() {
    $('#cardBody').innerHTML =
      '<div id="cdPinned"></div>' +
      '<section class="cd-sec" id="cdBasic"></section>' +
      '<section class="cd-sec" id="cdLogin"></section>' +
      '<section class="cd-sec" id="cdGrades-school"></section>' +
      '<section class="cd-sec" id="cdGrades-mock"></section>' +
      '<section class="cd-sec" id="cdNotes"></section>';
    renderPinned();
    renderBasic();
    loadLogin();
    renderGrades('school');
    renderGrades('mock');
    renderNotes();
  }

  /* ---------- 다음 상담 때 확인 (맨 위 고정) ---------- */

  function openFollow(list) {
    return (list || C.notes).filter(function (n) { return n.follow_up && !n.followed_at && !n.deleted_at; });
  }

  function renderPinned() {
    var host = $('#cdPinned');
    var list = openFollow();
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="cd-pinned"><div class="cd-pinned__title">📌 다음 상담 때 확인 ' + list.length + '건</div>' +
      list.map(function (n) {
        return '<div class="cd-pin" data-id="' + n.id + '">' +
          '<div class="cd-pin__top"><span class="num">' + esc(fmtDate(n.note_date)) + '</span> ' + catsHtml(n.categories) +
          ' <span class="muted-note">' + esc(n.author_name) + '</span>' +
          '<span class="spacer"></span><button class="btn btn--sm btn--primary" type="button" data-nact="done">확인 완료</button></div>' +
          '<div class="cd-pin__body">' + esc(n.body) + '</div></div>';
      }).join('') + '</div>';
  }

  /* ---------- 학생 입구 로그인 기록 (migration-024) — 학생 · 시각 · 성공/실패만 ---------- */

  var LOGIN_WHY = { wrong: '비밀번호 틀림', nophone: '휴대폰 번호 없음', nolink: '학생 링크 없음' };
  function loadLogin() {
    var sid = C.sid;
    sb().rpc('student_login_log', { p_student: sid }).then(function (r) {
      var host = $('#cdLogin');
      if (!host || !C || C.sid !== sid) return;
      if (r.error) {
        host.innerHTML = isMissing(r.error) ? '' : '<p class="panel__hint">학생 입구 로그인 기록을 불러오지 못했습니다 — ' + esc(r.error.message) + '</p>';
        return;
      }
      var rows = r.data || [];
      var last = rows.find(function (x) { return x.ok; });
      host.innerHTML = '<details class="cd-login"><summary>학생 입구 로그인 기록 — ' +
          (rows.length ? '최근 ' + rows.length + '회 · 마지막 성공 ' + (last ? esc(fmtDT(last.at)) : '없음') : '아직 없음') + '</summary>' +
        (rows.length ? '<ul>' + rows.map(function (x) {
          return '<li><span class="num">' + esc(fmtDT(x.at)) + '</span> · ' +
            (x.ok ? '<b class="is-ok">성공</b>' : '<b class="is-no">실패</b> ' + esc(LOGIN_WHY[x.reason] || x.reason)) + '</li>';
        }).join('') + '</ul>' : '<p class="panel__hint">학생이 학생 입구(/s/)로 들어오면 여기에 남습니다.</p>') +
        '</details>';
    }, function () {});
  }

  /* ---------- 기본 정보 ---------- */

  function renderBasic() {
    var s = student(C.sid) || {};
    var c = C.card || {};
    $('#cdBasic').innerHTML =
      '<h3 class="cd-title">기본 정보</h3>' +
      '<div class="grid2">' +
        '<label class="field"><span class="field__label">이름</span><input class="input" id="cdName" value="' + esc(s.name) + '"></label>' +
        '<label class="field"><span class="field__label">학교</span><input class="input" id="cdSchool" value="' + esc(s.school) + '"></label>' +
        '<label class="field"><span class="field__label">학년</span><input class="input" id="cdGrade" list="gradeOptions" value="' + esc(s.grade) + '"></label>' +
        '<label class="field"><span class="field__label">수강 시작일</span><input class="input" id="cdStart" type="date" value="' + esc(c.start_date || '') + '"></label>' +
        '<label class="field grid2__full"><span class="field__label">특이사항 <span class="field__opt">고정 메모 · 여러 줄</span></span>' +
          '<textarea class="textarea" id="cdNotesText" rows="3">' + esc(c.notes || '') + '</textarea></label>' +
      '</div>' +
      '<div class="toolbar cd-basic-foot">' +
        '<span class="muted-note">' + (c.updated_at ? '특이사항 마지막 수정 · ' + esc(c.updated_by) + ' · ' + esc(fmtDT(c.updated_at)) : '') + '</span>' +
        '<span class="spacer"></span><button class="btn btn--primary btn--sm" type="button" id="cdBasicSave">기본 정보 저장</button>' +
      '</div>';
  }

  function saveBasic() {
    var s = student(C.sid);
    if (!s) return;
    var sid = C.sid;
    var name = $('#cdName').value.trim();
    if (!name) { toast('이름은 비울 수 없습니다', 'bad'); return; }
    var stud = { name: name, school: $('#cdSchool').value.trim(), grade: $('#cdGrade').value.trim() };
    var stChanged = stud.name !== s.name || stud.school !== (s.school || '') || stud.grade !== (s.grade || '');
    var cardPatch = { start_date: $('#cdStart').value || null, notes: $('#cdNotesText').value.replace(/\s+$/, '') };
    var c = C.card || {};
    var cdChanged = (cardPatch.start_date || null) !== (c.start_date || null) || cardPatch.notes !== (c.notes || '');
    if (!stChanged && !cdChanged) { toast('바뀐 내용이 없습니다'); return; }

    var p = Promise.resolve(true);
    if (stChanged) {
      /* 이름·학교·학년 — 명단과 같은 줄. 카드를 연 뒤 다른 분이 고쳤으면 묻는다 */
      p = UI.staleCheck('students', sid, C.studentAt, s.name + ' 학생 정보', function () {
        if (C && C.sid === sid) { C.studentAt = Store.baseAt('students', sid); renderBasic(); }
      }).then(function (go) {
        if (!go) return false;
        var rec = Object.assign({}, s, stud);
        Store.upsertStudent(rec);
        return Store.flushNow(Store.KEYS.students).then(function () {
          if (C && C.sid === sid) C.studentAt = Store.baseAt('students', sid);
          window.dispatchEvent(new CustomEvent('jt:roster-changed'));
          return true;
        });
      });
    }
    p.then(function (go) {
      if (!go || !cdChanged) return go;
      var attempt = C.card
        ? function (chk) { return DB.updateIf('student_cards', { student_id: sid }, cardPatch, chk ? C.cardAt : ''); }
        : function () {
            return sb().from('student_cards').insert(Object.assign({ student_id: sid }, cardPatch)).select('*').then(function (r) {
              if (r.error && /duplicate/i.test(r.error.message)) {
                return sb().from('student_cards').select('*').eq('student_id', sid).maybeSingle().then(check)
                  .then(function (x) { return { conflict: true, row: x.data }; });
              }
              check(r);
              return { ok: true, row: r.data[0] };
            });
          };
      return UI.guardedSave(name + ' 특이사항·수강 시작일', attempt, function () { loadAll(); }).then(function (res) {
        if (res.ok && C && C.sid === sid) { C.card = res.row; C.cardAt = res.row.updated_at || ''; }
        return res.ok;
      });
    }).then(function (done) {
      if (!done || !C || C.sid !== sid) return;
      var s2 = student(sid);
      $('#cardTitle').textContent = (s2 ? s2.name : name) + ' 상담 카드';
      renderBasic();
      toast('기본 정보를 저장했습니다', 'good');
    }).catch(function (e) { toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  }

  /* ---------- 성적 표 ---------- */

  function levelRank(l) { var i = LEVELS.indexOf(l); return i < 0 ? 99 : i; }
  function normLevel(g) {
    var m = /(중|고)\s*([1-3])/.exec(String(g || ''));
    if (m) return m[1] + m[2];
    return /N수|재수|반수/.test(String(g || '')) ? 'N수' : '';
  }
  function termRank(kind, t) {
    if (kind === 'mock') return +t || 99;
    var i = SCHOOL_DEFAULT.indexOf(t);
    return i < 0 ? 50 + String(t).length : i;
  }
  function termLabel(kind, t) { return kind === 'mock' ? t + '월' : t; }

  function activeRows(kind) {
    return C.grades.filter(function (g) { return g.kind === kind && !g.deleted_at; });
  }
  function rowOf(kind, level, term) {
    return activeRows(kind).find(function (g) { return g.grade_level === level && g.term === term; }) || null;
  }

  function levelsOf(kind) {
    var set = {};
    activeRows(kind).forEach(function (g) { set[g.grade_level] = true; });
    C.extra[kind].levels.forEach(function (l) { set[l] = true; });
    var cur = normLevel((student(C.sid) || {}).grade);
    if (cur) set[cur] = true;
    return Object.keys(set).sort(function (a, b) { return levelRank(a) - levelRank(b) || a.localeCompare(b, 'ko'); });
  }

  function termsOf(kind, level) {
    var set = {};
    (kind === 'mock' ? MOCK_DEFAULT : SCHOOL_DEFAULT).forEach(function (t) { set[t] = true; });
    activeRows(kind).forEach(function (g) { if (g.grade_level === level) set[g.term] = true; });
    (C.extra[kind].terms[level] || []).forEach(function (t) { set[t] = true; });
    return Object.keys(set).sort(function (a, b) { return termRank(kind, a) - termRank(kind, b) || a.localeCompare(b, 'ko'); });
  }

  function numStr(v) { return v == null ? '' : String(+v); }

  function renderGrades(kind) {
    var host = $('#cdGrades-' + kind);
    var levels = levelsOf(kind);
    var head = '<tr><th rowspan="2" class="gt-term">' + (kind === 'mock' ? '시험' : '학기') + '</th>' +
      SUBJ.map(function (s) { return '<th colspan="2" class="gt-subj">' + s[1] + '</th>'; }).join('') +
      '<th rowspan="2" class="gt-meta"></th></tr><tr>' +
      SUBJ.map(function () { return '<th class="gt-sub">원점수</th><th class="gt-sub">등급</th>'; }).join('') + '</tr>';

    var html = '<div class="cd-title-row"><h3 class="cd-title">' + KIND[kind] + ' 성적</h3>' +
      '<span class="muted-note">비워 둬도 됩니다 · 원점수는 숫자, 등급은 1~9</span><span class="spacer"></span>' +
      '<button class="btn btn--sm" type="button" data-gact="addlevel" data-kind="' + kind + '">+ 학년 추가</button></div>';

    if (!levels.length) {
      html += '<p class="panel__hint">학년이 정해지지 않았습니다. <b>+ 학년 추가</b>로 시작하세요.</p>';
    }
    levels.forEach(function (level) {
      var rows = termsOf(kind, level).map(function (term) {
        var r = rowOf(kind, level, term);
        return '<tr data-kind="' + kind + '" data-level="' + esc(level) + '" data-term="' + esc(term) + '">' +
          '<th class="gt-term">' + esc(termLabel(kind, term)) + '</th>' +
          COLS.map(function (col) {
            var v = r ? numStr(r[col]) : '';
            var isGrade = /_grade$/.test(col);
            return '<td><input class="input gt-in' + (isGrade ? ' gt-in--grade' : '') + '" inputmode="' + (isGrade ? 'numeric' : 'decimal') + '"' +
              ' data-col="' + col + '" data-base="' + esc(v) + '" value="' + esc(v) + '" aria-label="' +
              esc(level + ' ' + termLabel(kind, term) + ' ' + SUBJ.find(function (s) { return col.indexOf(s[0] + '_') === 0; })[1] + (isGrade ? ' 등급' : ' 원점수')) + '"></td>';
          }).join('') +
          '<td class="gt-meta">' + (r ? '<span class="muted-note">' + esc(r.updated_by) + ' · ' + esc(fmtDT(r.updated_at)) + '</span>' +
            (isTeacher() ? ' <button class="tb-x" type="button" data-gact="del" data-id="' + r.id + '" title="이 줄 삭제(숨김)">×</button>' : '') : '') +
          '</td></tr>';
      }).join('');
      var deleted = isTeacher() && C.showDeleted
        ? C.grades.filter(function (g) { return g.kind === kind && g.grade_level === level && g.deleted_at; }) : [];
      html += '<div class="gt-block"><div class="gt-block__head"><b>' + esc(level) + '</b>' +
        '<span class="spacer"></span><button class="btn btn--sm btn--ghost" type="button" data-gact="addterm" data-kind="' + kind + '" data-level="' + esc(level) + '">' +
        (kind === 'mock' ? '+ 다른 달 추가' : '+ 학기 추가') + '</button></div>' +
        '<div class="roster-scroll gt-scroll"><table class="gt">' + '<thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
        (deleted.length ? '<div class="gt-deleted">' + deleted.map(function (g) {
          return '<div class="gt-deleted__row">🗑 ' + esc(termLabel(kind, g.term)) + ' · ' +
            SUBJ.map(function (s) {
              var raw = g[s[0] + '_raw'], gr = g[s[0] + '_grade'];
              return raw == null && gr == null ? '' : s[1] + ' ' + numStr(raw) + (gr != null ? '(' + gr + '등급)' : '');
            }).filter(Boolean).join(' ') +
            ' — 삭제됨 · ' + esc(g.deleted_by || '') + ' · ' + esc(fmtDT(g.deleted_at)) +
            ' <button class="btn btn--sm" type="button" data-gact="restore" data-id="' + g.id + '">되살리기</button></div>';
        }).join('') + '</div>' : '') +
        '</div>';
    });
    html += '<p class="gt-msg" id="gtMsg-' + kind + '" role="alert"></p>';
    host.innerHTML = html;
  }

  /* 칸 하나 검사. 돌려주는 값: { ok, value(null=빈칸), msg } */
  function validateCell(input) {
    var t = input.value.trim();
    var col = input.dataset.col;
    var subj = SUBJ.find(function (s) { return col.indexOf(s[0] + '_') === 0; })[1];
    if (t === '') return { ok: true, value: null };
    if (/_grade$/.test(col)) {
      if (!/^[1-9]$/.test(t)) return { ok: false, msg: subj + ' 등급은 1~9 숫자만 넣을 수 있습니다' };
      return { ok: true, value: +t };
    }
    if (!/^\d{1,3}(\.\d)?$/.test(t) || +t > 200) return { ok: false, msg: subj + ' 원점수는 숫자만 넣을 수 있습니다 (예: 92 또는 87.5)' };
    return { ok: true, value: +t };
  }

  function showCellState(input, v) {
    input.setAttribute('aria-invalid', v.ok ? 'false' : 'true');
    input.title = v.ok ? '' : v.msg;
    var msg = $('#gtMsg-' + input.closest('tr').dataset.kind);
    if (msg) msg.textContent = v.ok ? '' : '⚠️ ' + v.msg;
  }

  function saveCell(input) {
    var v = validateCell(input);
    showCellState(input, v);
    if (!v.ok) return;
    var base = input.dataset.base === '' ? null : +input.dataset.base;
    if (v.value === base) return;
    var tr = input.closest('tr');
    var kind = tr.dataset.kind, level = tr.dataset.level, term = tr.dataset.term, col = input.dataset.col;
    var sid = C.sid;
    var set = {}, bs = {};
    set[col] = v.value;
    bs[col] = base;
    var what = level + ' ' + termLabel(kind, term) + ' ' + input.getAttribute('aria-label').split(' ').slice(-2).join(' ');
    input.classList.add('is-saving');
    DB.gradePatch(sid, kind, level, term, set, bs, false).then(function (res) {
      if (!C || C.sid !== sid) return;
      applyGradeRow(res.row);
      if (res.ok) { input.dataset.base = v.value == null ? '' : String(v.value); input.classList.remove('is-saving'); refreshMeta(kind); return; }
      return UI.conflictAsk(what).then(function (choice) {
        if (choice === 'overwrite') {
          return DB.gradePatch(sid, kind, level, term, set, {}, true).then(function (r2) {
            applyGradeRow(r2.row);
            input.dataset.base = v.value == null ? '' : String(v.value);
          });
        }
        if (choice === 'reload') {
          var sv = numStr(res.row[col]);
          input.value = sv;
          input.dataset.base = sv;
        }
      }).then(function () { input.classList.remove('is-saving'); refreshMeta(kind); });
    }).catch(function (e) {
      input.classList.remove('is-saving');
      toast('성적을 저장하지 못했습니다 — ' + e.message, 'bad');
    });
  }

  function applyGradeRow(row) {
    if (!row || !C) return;
    var i = C.grades.findIndex(function (g) { return g.id === row.id; });
    if (i >= 0) C.grades[i] = row; else C.grades.push(row);
  }

  /* 마지막 수정자 칸만 다시 */
  function refreshMeta(kind) {
    $$('#cdGrades-' + kind + ' tbody tr').forEach(function (tr) {
      var r = rowOf(kind, tr.dataset.level, tr.dataset.term);
      var cell = tr.querySelector('.gt-meta');
      if (!r || !cell) return;
      cell.innerHTML = '<span class="muted-note">' + esc(r.updated_by) + ' · ' + esc(fmtDT(r.updated_at)) + '</span>' +
        (isTeacher() ? ' <button class="tb-x" type="button" data-gact="del" data-id="' + r.id + '" title="이 줄 삭제(숨김)">×</button>' : '');
    });
  }

  /* 다른 기기에서 성적이 바뀌었을 때 — 고치는 중인 칸은 두고 나머지만 */
  function mergeGrades(rows) {
    C.grades = rows;
    ['school', 'mock'].forEach(function (kind) {
      var host = $('#cdGrades-' + kind);
      if (!host) return;
      var focused = host.contains(document.activeElement);
      if (!focused) { renderGrades(kind); return; }
      $$('#cdGrades-' + kind + ' tbody tr').forEach(function (tr) {
        var r = rowOf(kind, tr.dataset.level, tr.dataset.term);
        $$('.gt-in', tr).forEach(function (inp) {
          if (inp === document.activeElement || inp.value !== inp.dataset.base) return;
          var sv = r ? numStr(r[inp.dataset.col]) : '';
          inp.value = sv; inp.dataset.base = sv;
        });
      });
      refreshMeta(kind);
    });
  }

  function onGradeAction(btn) {
    var act = btn.dataset.gact;
    var kind = btn.dataset.kind;
    if (act === 'addlevel') {
      var lv = (window.prompt('추가할 학년 (예: 고1, 고2, 고3, 중3, N수)', '') || '').trim();
      if (!lv) return;
      lv = normLevel(lv) || lv;
      if (C.extra[kind].levels.indexOf(lv) === -1) C.extra[kind].levels.push(lv);
      renderGrades(kind);
      return;
    }
    if (act === 'addterm') {
      var level = btn.dataset.level;
      var t;
      if (kind === 'mock') {
        t = (window.prompt(level + ' 모의고사 — 추가할 달 (1~12 숫자, 예: 4, 7, 10)', '') || '').trim().replace(/월$/, '');
        if (!t) return;
        if (!/^(1[0-2]|[1-9])$/.test(t)) { toast('달은 1~12 숫자로 적어 주세요', 'bad'); return; }
      } else {
        t = (window.prompt(level + ' 내신 — 추가할 학기 이름 (예: 1학기, 2학기)', '') || '').trim();
        if (!t) return;
        if (/^[12]$/.test(t)) t += '학기';
      }
      var m = C.extra[kind].terms;
      m[level] = m[level] || [];
      if (m[level].indexOf(t) === -1) m[level].push(t);
      renderGrades(kind);
      return;
    }
    var g = C.grades.find(function (x) { return x.id === btn.dataset.id; });
    if (!g) return;
    if (act === 'del') {
      UI.confirmAsk('성적 줄 삭제', g.grade_level + ' ' + termLabel(g.kind, g.term) + ' ' + KIND[g.kind] +
        ' 줄을 숨깁니다. 지우지 않고 "삭제됨"으로 남으며, 「숨긴 기록·성적 보기」에서 되살릴 수 있습니다.', '삭제(숨김)')
        .then(function (ok) {
          if (!ok) return;
          return UI.guardedSave(KIND[g.kind] + ' ' + g.grade_level + ' ' + termLabel(g.kind, g.term), function (chk) {
            return DB.updateIf('student_grades', { id: g.id }, { deleted_at: new Date().toISOString() }, chk ? g.updated_at : '');
          }, reloadGrades).then(function (res) { if (res.ok) { applyGradeRow(res.row); renderGrades(g.kind); } });
        }).catch(function (e) { toast(e.message, 'bad'); });
    } else if (act === 'restore') {
      DB.updateIf('student_grades', { id: g.id }, { deleted_at: null }, '').then(function (res) {
        if (res.ok) { applyGradeRow(res.row); renderGrades(g.kind); toast('되살렸습니다', 'good'); }
      }).catch(function (e) {
        toast(/duplicate|unique/i.test(e.message) ? '같은 학년·학기 줄이 이미 있어 되살릴 수 없습니다. 그 줄을 먼저 정리하세요' : e.message, 'bad');
      });
    }
  }

  function reloadGrades() {
    if (!C) return;
    var sid = C.sid;
    sb().from('student_grades').select('*').eq('student_id', sid).then(check).then(function (r) {
      if (C && C.sid === sid) mergeGrades(r.data || []);
    }).catch(function () {});
  }

  /* ---------- 상담·관찰 기록 ---------- */

  function catsHtml(cats) {
    return (cats || []).map(function (c) {
      return '<span class="nt-cat' + (c === '상담' ? ' nt-cat--consult' : '') + '">' + esc(c) + '</span>';
    }).join('');
  }

  function catChips(prefix, picked) {
    return CATS.map(function (c) {
      return '<button type="button" class="chip' + (picked[c] ? ' is-on' : '') + (c === '상담' ? ' chip--consult' : '') +
        '" data-' + prefix + '="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
  }

  function visibleNotes() {
    var f = C.filter;
    var anyCat = Object.keys(f.cats).filter(function (k) { return f.cats[k]; });
    return C.notes.filter(function (n) {
      if (n.deleted_at && !(isTeacher() && C.showDeleted)) return false;
      if (f.consult && (n.categories || []).indexOf('상담') === -1) return false;
      if (anyCat.length && !anyCat.some(function (c) { return (n.categories || []).indexOf(c) !== -1; })) return false;
      if (f.from && n.note_date < f.from) return false;
      if (f.to && n.note_date > f.to) return false;
      if (f.author && n.author_email !== f.author) return false;
      return true;
    });
  }

  function renderNotes() {
    var host = $('#cdNotes');
    var authors = {};
    C.notes.forEach(function (n) { authors[n.author_email] = n.author_name || n.author_email; });
    host.innerHTML =
      '<h3 class="cd-title">상담·관찰 기록</h3>' +
      '<div class="cn-compose">' +
        '<div class="toolbar">' +
          '<input class="input" type="date" id="cnDate" value="' + todayKST() + '" aria-label="날짜">' +
          '<div class="chips tb-chips-sm" id="cnCats">' + catChips('ccat', {}) + '</div>' +
        '</div>' +
        '<textarea class="textarea" id="cnBody" rows="3" placeholder="오늘 상담·관찰한 내용을 적으세요"></textarea>' +
        '<div class="toolbar">' +
          '<label class="chk-inline"><input type="checkbox" id="cnFollow"> 다음 상담 때 확인</label>' +
          '<span class="muted-note">쓴 사람: ' + esc(me.name || UI.whoami()) + '</span>' +
          '<span class="spacer"></span><button class="btn btn--primary btn--sm" type="button" id="cnAdd">기록 남기기</button>' +
        '</div>' +
      '</div>' +
      '<div class="cn-filter">' +
        '<div class="chips tb-chips-sm" id="cnFilterCats">' +
          '<button type="button" class="chip chip--consult' + (C.filter.consult ? ' is-on' : '') + '" id="cnOnlyConsult">상담만 보기</button>' +
          CATS.filter(function (c) { return c !== '상담'; }).map(function (c) {
            return '<button type="button" class="chip' + (C.filter.cats[c] ? ' is-on' : '') + '" data-fcat="' + esc(c) + '">' + esc(c) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="toolbar">' +
          '<input class="input" type="date" id="cnFrom" value="' + esc(C.filter.from) + '" aria-label="시작 날짜"> ~ ' +
          '<input class="input" type="date" id="cnTo" value="' + esc(C.filter.to) + '" aria-label="끝 날짜">' +
          '<select class="select" id="cnAuthor" aria-label="쓴 사람"><option value="">쓴 사람 전체</option>' +
            Object.keys(authors).map(function (e) {
              return '<option value="' + esc(e) + '"' + (C.filter.author === e ? ' selected' : '') + '>' + esc(authors[e]) + '</option>';
            }).join('') + '</select>' +
          (isTeacher() ? '<label class="chk-inline"><input type="checkbox" id="cnShowDeleted"' + (C.showDeleted ? ' checked' : '') + '> 숨긴 기록·성적 보기</label>' : '') +
        '</div>' +
      '</div>' +
      '<div id="cnList"></div>';
    renderNoteList();
  }

  function noteHtml(n) {
    var editing = C.editing === n.id;
    var consult = (n.categories || []).indexOf('상담') !== -1;
    var meta = [];
    if (n.edited_at) meta.push('수정됨 · ' + esc(n.edited_by) + ' · ' + esc(fmtDT(n.edited_at)));
    if (n.follow_up && n.followed_at) meta.push('확인 완료 · ' + esc(n.followed_by) + ' · ' + esc(fmtDT(n.followed_at)));
    if (n.follow_up && !n.followed_at) meta.push('📌 다음 상담 때 확인');
    if (n.deleted_at) meta.push('삭제됨 · ' + esc(n.deleted_by) + ' · ' + esc(fmtDT(n.deleted_at)));

    var body;
    if (editing) {
      var picked = {};
      (n.categories || []).forEach(function (c) { picked[c] = true; });
      body = '<div class="cn-edit">' +
        '<div class="toolbar"><input class="input" type="date" data-ef="date" value="' + esc(n.note_date) + '">' +
        '<div class="chips tb-chips-sm">' + catChips('ecat', picked) + '</div></div>' +
        '<textarea class="textarea" data-ef="body" rows="3">' + esc(n.body) + '</textarea>' +
        '<div class="toolbar"><label class="chk-inline"><input type="checkbox" data-ef="follow"' + (n.follow_up ? ' checked' : '') + '> 다음 상담 때 확인</label>' +
        '<span class="spacer"></span><button class="btn btn--sm" type="button" data-nact="cancel">취소</button>' +
        '<button class="btn btn--sm btn--primary" type="button" data-nact="save">저장</button></div></div>';
    } else {
      body = '<div class="cn-item__body">' + esc(n.body) + '</div>';
    }
    var acts = n.deleted_at
      ? (isTeacher() ? '<button class="btn btn--sm" type="button" data-nact="restore">되살리기</button>' : '')
      : (editing ? '' : '<button class="btn btn--sm btn--ghost" type="button" data-nact="edit">고치기</button>' +
         (isTeacher() ? '<button class="btn btn--sm btn--ghost" type="button" data-nact="del">삭제</button>' : ''));
    return '<div class="cn-item' + (consult ? ' cn-item--consult' : '') + (n.deleted_at ? ' is-deleted' : '') + '" data-id="' + n.id + '">' +
      '<div class="cn-item__top"><span class="cn-item__date num">' + esc(fmtDate(n.note_date)) + '</span>' + catsHtml(n.categories) +
      '<span class="muted-note">' + esc(n.author_name) + '</span><span class="spacer"></span>' + acts + '</div>' +
      body + (meta.length ? '<div class="cn-item__meta">' + meta.join(' · ') + '</div>' : '') + '</div>';
  }

  function renderNoteList() {
    var host = $('#cnList');
    if (!host) return;
    var list = visibleNotes();
    host.innerHTML = list.length ? list.map(noteHtml).join('')
      : '<p class="panel__hint">' + (C.notes.length ? '조건에 맞는 기록이 없습니다.' : '아직 기록이 없습니다.') + '</p>';
  }

  function addNote() {
    var body = $('#cnBody').value.trim();
    if (!body) { toast('내용을 적어 주세요', 'bad'); $('#cnBody').focus(); return; }
    var cats = $$('#cnCats .chip.is-on').map(function (b) { return b.dataset.ccat; });
    var sid = C.sid;
    var btn = $('#cnAdd');
    btn.disabled = true;
    sb().from('student_notes').insert({
      student_id: sid, note_date: $('#cnDate').value || todayKST(), categories: cats, body: body,
      follow_up: $('#cnFollow').checked
    }).select('*').single().then(check).then(function (r) {
      btn.disabled = false;
      if (!C || C.sid !== sid) return;
      C.notes.unshift(r.data);
      sortNotes();
      $('#cnBody').value = '';
      $('#cnFollow').checked = false;
      $$('#cnCats .chip').forEach(function (b) { b.classList.remove('is-on'); });
      renderPinned();
      renderNoteList();
      loadFollow();
      afterNotesChanged(sid);
      toast('기록을 남겼습니다', 'good');
    }).catch(function (e) { btn.disabled = false; toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  }

  function sortNotes() {
    C.notes.sort(function (a, b) {
      return a.note_date < b.note_date ? 1 : a.note_date > b.note_date ? -1 : (a.created_at < b.created_at ? 1 : -1);
    });
  }

  function replaceNote(row) {
    var i = C.notes.findIndex(function (n) { return n.id === row.id; });
    if (i >= 0) C.notes[i] = row; else C.notes.push(row);
    sortNotes();
  }

  function onNoteAction(btn) {
    var item = btn.closest('[data-id]');
    var n = C.notes.find(function (x) { return x.id === item.dataset.id; });
    if (!n) return;
    var act = btn.dataset.nact;
    var sid = C.sid;

    if (act === 'edit') { C.editing = n.id; C.editAt = n.updated_at; renderNoteList(); return; }
    if (act === 'cancel') { C.editing = null; renderNoteList(); if (C.pendingNotes) reloadNotes(); return; }
    if (act === 'save') {
      var ed = item.querySelector('.cn-edit');
      var patch = {
        note_date: ed.querySelector('[data-ef="date"]').value || n.note_date,
        body: ed.querySelector('[data-ef="body"]').value.trim(),
        categories: $$('.chip.is-on', ed).map(function (b) { return b.dataset.ecat; }),
        follow_up: ed.querySelector('[data-ef="follow"]').checked
      };
      if (!patch.body) { toast('내용을 비울 수 없습니다', 'bad'); return; }
      if (!patch.follow_up) patch.followed_at = null;
      UI.guardedSave('이 기록', function (chk) {
        return DB.updateIf('student_notes', { id: n.id }, patch, chk ? C.editAt : '');
      }, function () { C.editing = null; reloadNotes(); }).then(function (res) {
        if (!res.ok || !C || C.sid !== sid) return;
        C.editing = null;
        replaceNote(res.row);
        renderPinned(); renderNoteList(); loadFollow(); afterNotesChanged(sid);
        toast('고쳤습니다 (수정됨으로 남습니다)', 'good');
      }).catch(function (e) { toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
      return;
    }
    if (act === 'done') {
      sb().from('student_notes').update({ followed_at: new Date().toISOString() })
        .eq('id', n.id).is('followed_at', null).select('*').then(check).then(function (r) {
          if (!C || C.sid !== sid) return;
          if (r.data.length) { replaceNote(r.data[0]); toast('확인 완료 — 일반 기록으로 내려갔습니다', 'good'); }
          else { toast('다른 분이 먼저 확인 완료했습니다'); return reloadNotes(); }
          renderPinned(); renderNoteList(); loadFollow(); afterNotesChanged(sid);
        }).catch(function (e) { toast(e.message, 'bad'); });
      return;
    }
    if (act === 'del') {
      UI.confirmAsk('기록 삭제', '이 기록을 숨깁니다. 지우지 않고 "삭제됨(누가·언제)"으로 남으며, 「숨긴 기록·성적 보기」에서 되살릴 수 있습니다.', '삭제(숨김)')
        .then(function (ok) {
          if (!ok) return;
          return UI.guardedSave('이 기록', function (chk) {
            return DB.updateIf('student_notes', { id: n.id }, { deleted_at: new Date().toISOString() }, chk ? n.updated_at : '');
          }, reloadNotes).then(function (res) {
            if (!res.ok) return;
            replaceNote(res.row);
            renderPinned(); renderNoteList(); loadFollow(); afterNotesChanged(sid);
          });
        }).catch(function (e) { toast(e.message, 'bad'); });
      return;
    }
    if (act === 'restore') {
      DB.updateIf('student_notes', { id: n.id }, { deleted_at: null }, '').then(function (res) {
        if (!res.ok) return;
        replaceNote(res.row);
        renderPinned(); renderNoteList(); loadFollow(); afterNotesChanged(sid);
        toast('되살렸습니다', 'good');
      }).catch(function (e) { toast(e.message, 'bad'); });
    }
  }

  function reloadNotes() {
    if (!C) return Promise.resolve();
    var sid = C.sid;
    C.pendingNotes = false;
    return sb().from('student_notes').select('*').eq('student_id', sid)
      .order('note_date', { ascending: false }).order('created_at', { ascending: false })
      .then(check).then(function (r) {
        if (!C || C.sid !== sid) return;
        C.notes = r.data || [];
        renderPinned();
        /* 고치는 중인 기록이 있으면 다 고친 뒤에. 새 기록 쓰는 칸·거르기 칸은 건드리지 않고 목록만 */
        if (C.editing) { C.pendingNotes = true; return; }
        renderNoteList();
      }).catch(function () {});
  }

  /* ---------- 카드 안 이벤트 ---------- */

  $('#cardBody').addEventListener('click', function (e) {
    var g = e.target.closest('[data-gact]');
    if (g) { onGradeAction(g); return; }
    var nb = e.target.closest('[data-nact]');
    if (nb) { onNoteAction(nb); return; }
    if (e.target.closest('#cdBasicSave')) { saveBasic(); return; }
    if (e.target.closest('#cnAdd')) { addNote(); return; }
    var cc = e.target.closest('[data-ccat], [data-ecat]');
    if (cc) { cc.classList.toggle('is-on'); return; }
    var fc = e.target.closest('[data-fcat]');
    if (fc) { C.filter.cats[fc.dataset.fcat] = !C.filter.cats[fc.dataset.fcat]; fc.classList.toggle('is-on'); renderNoteList(); return; }
    if (e.target.closest('#cnOnlyConsult')) {
      C.filter.consult = !C.filter.consult;
      e.target.closest('#cnOnlyConsult').classList.toggle('is-on', C.filter.consult);
      renderNoteList();
    }
  });

  $('#cardBody').addEventListener('input', function (e) {
    if (e.target.classList.contains('gt-in')) showCellState(e.target, validateCell(e.target));
  });

  $('#cardBody').addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList.contains('gt-in')) { saveCell(t); return; }
    if (t.id === 'cnFrom') { C.filter.from = t.value; renderNoteList(); }
    else if (t.id === 'cnTo') { C.filter.to = t.value; renderNoteList(); }
    else if (t.id === 'cnAuthor') { C.filter.author = t.value; renderNoteList(); }
    else if (t.id === 'cnShowDeleted') {
      C.showDeleted = t.checked;
      renderNoteList(); renderGrades('school'); renderGrades('mock');
    }
  });

  /* 성적 칸에서 Enter = 그 칸 저장 */
  $('#cardBody').addEventListener('keydown', function (e) {
    if (e.target.classList.contains('gt-in') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });

  $('#btnCardClose').addEventListener('click', function () { modal.close(); });
  modal.addEventListener('close', function () { C = null; });

  /* ============================================================
     주간 레포트 → 작성 — 고른 학생의 최근 기록
     ============================================================ */

  var side = { sid: null };

  function renderSide(sid) {
    var host = $('#notesSide');
    if (!host) return;
    side.sid = sid;
    var s = student(sid);
    if (!s) { host.innerHTML = '<p class="panel__hint">학생 카드를 누르면 그 학생의 최근 기록이 보입니다.</p>'; return; }
    $('#notesSideWho').textContent = s.name + ' · 최근 상담·관찰 기록';
    sb().from('student_notes').select('*').eq('student_id', sid).is('deleted_at', null)
      .order('note_date', { ascending: false }).order('created_at', { ascending: false }).limit(30)
      .then(function (r) {
        if (side.sid !== sid) return;
        if (r.error) {
          host.innerHTML = '<p class="panel__hint">' + (isMissing(r.error) ? '상담 기록용 표가 아직 없습니다 (SQL 004).' : esc(r.error.message)) + '</p>';
          return;
        }
        var pins = openFollow(r.data);
        var recent = r.data.filter(function (n) { return pins.indexOf(n) === -1; }).slice(0, 5);
        function line(n, pin) {
          return '<li class="ns-item' + (pin ? ' ns-item--pin' : '') + ((n.categories || []).indexOf('상담') !== -1 ? ' ns-item--consult' : '') + '">' +
            '<div class="ns-item__top"><span class="num">' + esc(fmtDate(n.note_date)) + '</span>' + catsHtml(n.categories) +
            '<span class="muted-note">' + esc(n.author_name) + '</span></div>' +
            '<div class="ns-item__body">' + (pin ? '📌 ' : '') + esc(n.body) + '</div></li>';
        }
        host.innerHTML =
          (pins.length ? '<div class="ns-sub">다음 상담 때 확인 ' + pins.length + '건</div><ul class="ns-list">' + pins.map(function (n) { return line(n, true); }).join('') + '</ul>' : '') +
          '<div class="ns-sub">최근 기록</div>' +
          (recent.length ? '<ul class="ns-list">' + recent.map(function (n) { return line(n, false); }).join('') + '</ul>'
                         : '<p class="panel__hint">아직 기록이 없습니다.</p>');
      });
  }

  function afterNotesChanged(sid) { if (side.sid === sid) renderSide(sid); }

  window.addEventListener('jt:student-selected', function (e) { renderSide(e.detail.id); });
  $('#btnNotesSideCard').addEventListener('click', function () { if (side.sid) open(side.sid); });
  $('#btnNotesSideAdd').addEventListener('click', function () { if (side.sid) open(side.sid, { compose: true }); });

  /* ============================================================
     시작 · 다른 기기에서 바뀌었을 때
     ============================================================ */

  window.addEventListener('jt:loaded', function () {
    ready = true;
    DB.myStaff().then(function (m) { if (m) me = m; });
    loadFollow();
  });

  var remoteTimer = null;
  window.addEventListener('jt:remote', function (e) {
    var t = (e.detail && e.detail.table) || '';
    if (!ready || (t !== '*' && t.indexOf('student_') !== 0)) return;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () {
      if (t === '*' || t === 'student_notes') {
        loadFollow();
        if (side.sid) renderSide(side.sid);
        if (C) reloadNotes();
      }
      if (C && (t === '*' || t === 'student_grades')) reloadGrades();
      if (C && (t === '*' || t === 'student_cards')) {
        var sid = C.sid;
        sb().from('student_cards').select('*').eq('student_id', sid).maybeSingle().then(function (r) {
          if (!C || C.sid !== sid || r.error) return;
          C.card = r.data;
          if (!$('#cdBasic').contains(document.activeElement)) { C.cardAt = (r.data && r.data.updated_at) || ''; renderBasic(); }
        });
      }
    }, 300);
  });

  window.addEventListener('jt:refreshed', function () { if (ready) loadFollow(); });

  window.Card = {
    open: open,
    followCount: function (sid) { return follow[sid] || 0; }
  };

})();
