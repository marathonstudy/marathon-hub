/* ============================================================
   skips.js — 레포트 「건너뛰기」 · 챙길 학생 「확인함」 (migration-036 · 20261031e)

   건너뛰기  「오늘 할 일」 레포트 줄 [건너뛰기] · 레포트 발송 → 1 작성 「수업일 고르기」 줄 [건너뛰기]
             → 「10/10 레포트를 보내지 않고 넘어갈까요?」 → 「오늘 할 일」 · 탭 배지에서 빠지고 다시 나오지 않는다
             반 카드 칩은 회색 「10/10(토) 건너뜀」(누르면 되돌리기) · 수업일 고르기 줄은 옅게 「건너뜀」 · 그 작성 화면 위 「건너뛴 수업입니다 · 되돌리기」
   확인함    「챙길 학생」 묶음 [확인함] · 학생 이름 [×] — 같은 수업 · 같은 알림 기준이면 다시 뜨지 않는다
             「확인함 기록 보기」에서 되돌린다
   지우지 않는다 — 되돌리면 undone_* 를 채운다 (누가 · 언제는 서버가 채운다)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function fire() { window.dispatchEvent(new CustomEvent('jt:skips')); }
  var MISSING = 'migration-036 SQL 을 먼저 실행해 주세요.';
  function isMissing(e) { return /does not exist|schema cache|Could not find/i.test((e && e.message) || ''); }

  var st = { skips: {}, checks: {}, rows: [], loaded: false, missing: false };

  function skipKey(cls, date) { return cls + '|' + String(date || '').slice(0, 10); }
  function checkKey(kind, cls, date, sid) { return [kind, cls || '', String(date || '').slice(0, 10), sid || ''].join('|'); }

  function load() {
    if (!window.SB || !SB.client) return Promise.resolve();
    var from = Lesson.addDays(DDay.today(), -120);
    return Promise.all([
      sb().from('report_skips').select('*').gte('lesson_date', from),
      sb().from('care_checks').select('*').gte('checked_at', from + 'T00:00:00Z')
    ]).then(function (res) {
      var miss = res.some(function (r) { return r.error && isMissing(r.error); });
      st.missing = miss;
      st.skips = {};
      ((res[0] && !res[0].error && res[0].data) || []).forEach(function (x) { st.skips[skipKey(x.class_name, x.lesson_date)] = x; });
      st.checks = {};
      st.rows = (res[1] && !res[1].error && res[1].data) || [];
      st.rows.forEach(function (x) { st.checks[x.ckey] = x; });
      st.loaded = true;
      fire();
    }, function () { st.loaded = true; fire(); });
  }

  function skipped(cls, date) { var x = st.skips[skipKey(cls, date)]; return !!x && !x.undone_at; }
  function skipRow(cls, date) { return st.skips[skipKey(cls, date)] || null; }
  function checked(kind, cls, date, sid) { var x = st.checks[checkKey(kind, cls, date, sid)]; return !!x && !x.undone_at; }

  function done(r, ok) {
    if (r && r.error) { toast(isMissing(r.error) ? MISSING : '저장하지 못했습니다 — ' + r.error.message, 'bad'); return false; }
    if (ok) toast(ok, 'good');
    return load().then(function () { return true; });
  }

  /* 건너뛰기 — 한 번 묻는다 */
  function skip(cls, date) {
    var d = String(date || '').slice(0, 10);
    if (!cls || !d) return Promise.resolve(false);
    if (st.missing) { toast(MISSING, 'bad'); return Promise.resolve(false); }
    return UI.confirmAsk(Lesson.md(d, false) + ' 레포트를 보내지 않고 넘어갈까요?',
      cls + ' · ' + Store.dateWithDow(d) + ' 수업 — 「오늘 할 일」 · 탭 배지에서 빠지고 다시 나오지 않습니다. 기록은 남고, 반 카드 칩이나 수업일 고르기에서 되돌릴 수 있습니다.', '건너뛰기')
      .then(function (yes) {
        if (!yes) return false;
        return sb().from('report_skips').upsert({ class_name: cls, lesson_date: d, undone_at: null }, { onConflict: 'class_name,lesson_date' })
          .then(function (r) { return done(r, Lesson.md(d, false) + ' 레포트를 건너뛰었습니다'); });
      });
  }
  function unskip(cls, date, ask) {
    var d = String(date || '').slice(0, 10);
    var go = function () {
      return sb().from('report_skips').update({ undone_at: new Date().toISOString() }).eq('class_name', cls).eq('lesson_date', d)
        .then(function (r) { return done(r, Lesson.md(d, false) + ' 레포트 건너뛰기를 되돌렸습니다'); });
    };
    if (!ask) return go();
    return UI.confirmAsk(Lesson.md(d, false) + ' 레포트 건너뛰기를 되돌릴까요?', cls + ' · ' + Store.dateWithDow(d) + ' 수업 — 다시 「오늘 할 일」에 나옵니다.', '되돌리기')
      .then(function (yes) { return yes ? go() : false; });
  }

  /* 확인함 — sid 가 없으면 묶음 전체 */
  function check(kind, cls, date, sid) {
    if (st.missing) { toast(MISSING, 'bad'); return Promise.resolve(false); }
    var row = { ckey: checkKey(kind, cls, date, sid), kind: kind, class_name: cls || '', basis_date: String(date || '').slice(0, 10) || null, student_id: sid || null, undone_at: null };
    return sb().from('care_checks').upsert(row, { onConflict: 'ckey' }).then(function (r) { return done(r, sid ? '목록에서 뺐습니다' : '확인함으로 넘겼습니다'); });
  }
  /* 여러 건 한 번에 — 학생 한 줄 [확인함] · 반 [모두 확인함] (today.js · 20261031z2) · list = [{ kind, cls, date, sid }] */
  function checkMany(list, msg) {
    if (st.missing) { toast(MISSING, 'bad'); return Promise.resolve(false); }
    var seen = {}, rows = [];
    (list || []).forEach(function (x) {
      var k = checkKey(x.kind, x.cls, x.date, x.sid);
      if (seen[k]) return;
      seen[k] = 1;
      rows.push({ ckey: k, kind: x.kind, class_name: x.cls || '', basis_date: String(x.date || '').slice(0, 10) || null, student_id: x.sid || null, undone_at: null });
    });
    if (!rows.length) return Promise.resolve(false);
    return sb().from('care_checks').upsert(rows, { onConflict: 'ckey' }).then(function (r) { return done(r, msg || '확인함으로 넘겼습니다'); });
  }
  function uncheck(ckey) {
    return sb().from('care_checks').update({ undone_at: new Date().toISOString() }).eq('ckey', ckey).then(function (r) { return done(r, '되돌렸습니다'); });
  }
  /* 확인함 기록 — 되돌리지 않은 것 · 최근 순 */
  function history() {
    return st.rows.filter(function (x) { return !x.undone_at; }).sort(function (a, b) { return String(b.checked_at).localeCompare(String(a.checked_at)); });
  }

  /* 작성 화면 위 「건너뛴 수업입니다 · 되돌리기」 — 수업일 고르기에서 건너뛴 수업을 열었을 때 */
  function lessonOfWriter() {
    if (!window.Writer || !Writer.current || !Writer.current()) return null;
    var cls = Writer.currentClass(), d = Writer.current();
    if (!cls || (window.Course && Course.isKey(cls)) || Writer.mode() !== 'edit') return null;
    var L = Store.lessonOf(cls, d.weekStart);
    return L && L.date && !L.canceled ? { cls: cls, date: L.date } : null;
  }
  function paintNote() {
    var el = document.getElementById('skipNote');
    if (!el) return;
    var x = lessonOfWriter();
    var on = !!x && skipped(x.cls, x.date);
    el.hidden = !on;
    el.innerHTML = on ? '<span>⏭ <b>건너뛴 수업입니다</b> · ' + Store.dateWithDow(x.date) + ' 레포트는 보내지 않고 넘겼습니다' +
      (function (r) { return r && r.skipped_name ? ' (' + r.skipped_name + ')' : ''; })(skipRow(x.cls, x.date)) + '</span>' +
      ' <button type="button" class="btn btn--sm" data-skip-undo>되돌리기</button>' : '';
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#skipNote [data-skip-undo]')) return;
    var x = lessonOfWriter();
    if (x) unskip(x.cls, x.date, false);
  });
  window.addEventListener('jt:skips', paintNote);
  window.addEventListener('jt:write-nav', function () { setTimeout(paintNote, 0); });

  window.addEventListener('jt:loaded', function () { load(); });
  window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if (t === 'report_skips' || t === 'care_checks' || t === '*') load(); });

  window.Skips = { load: load, skipped: skipped, skipRow: skipRow, skip: skip, unskip: unskip, checked: checked, check: check, checkMany: checkMany, uncheck: uncheck,
    history: history, checkKey: checkKey, paintNote: paintNote, missing: function () { return st.missing; }, loaded: function () { return st.loaded; } };
})();
