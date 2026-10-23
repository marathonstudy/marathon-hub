/* ============================================================
   course.js — 「과정 + 회차」 (20261031a · migration-033)

   과정 = 여러 반이 같은 회차 수업을 요일만 다르게 듣는 묶음 (예: 고3 수능국어 — 토 목동반 · 일 반포반)
     · 회차 = 과정의 첫 회차 시작일부터 7일씩 (달력 주가 아니다). 「7회차 · 10/24(토) ~ 10/25(일)」처럼 늘 날짜 범위와 함께
     · 각 반의 그 회차 수업일 = 그 7일 안의 반 수업 요일 (그 반만 바꾼 날 · 휴강은 반 일정 그대로)
     · 반은 과정 하나에만. 넣은 회차부터 · 뺀 반의 지난 레포트는 그 반에 그대로
   과정 공통 내용(수업 내용 · 반 공통 코멘트 · 영상 · 자료 · 확정 요약 · 복습테스트 목록)은 「§과정 이름」 칸의 회차 시작 주에 한 번 쓰고,
     course_sync 가 각 반의 그 주 칸으로 복사한다 (학부모 화면은 그대로 자기 반 칸만 읽는다)
   학생 카드 · 공개 · 보냄은 반마다 따로 저장 → 과정으로 보낸 뒤에도 반 하나로 열어 고칠 수 있다
   담당 조교(classes.assistant) — 「오늘」 · 레포트 발송에서 자기 반을 맨 위에 · 과정 작성 화면에서 자기 반 학생 카드를 펼친다
   033 을 아직 안 돌렸으면 과정이 없는 것으로 (지금 흐름 그대로)
   ============================================================ */

(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { if (global.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }

  var st = { courses: [], assist: {}, me: '', staff: [], missing: false, loaded: false };
  var KEY = '§';

  /* ---------- 날짜 ---------- */
  function add(d, n) { return Lesson.addDays(d, n); }
  function mon(d) { return add(d, -((Lesson.dowOf(d) + 6) % 7)); }
  function diffDays(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
  function today() { return global.DDay ? DDay.today() : new Date().toISOString().slice(0, 10); }

  /* ---------- 과정 · 반 ---------- */
  function keyOf(c) { return c ? KEY + c.name : ''; }
  function isKey(x) { return typeof x === 'string' && x.charAt(0) === KEY; }
  function byKey(k) { return st.courses.find(function (c) { return keyOf(c) === k; }) || null; }
  function byId(id) { return st.courses.find(function (c) { return c.id === id; }) || null; }
  function list() { return st.courses.slice(); }
  /* 반 이름 줄임 — 「목동반」 → 「목동」 (달력 · 현황 줄) */
  function shortName(cls) { var s = String(cls || '').replace(/\s*반$/, ''); return s || cls; }

  function roundStart(c, no) { return add(c.start, 7 * (no - c.startNo)); }
  function roundOfDate(c, d) { return c.startNo + Math.floor(diffDays(d, c.start) / 7); }
  function roundNow(c) { return Math.max(c.startNo, roundOfDate(c, today())); }
  /* 작성 화면의 주(월요일) ↔ 회차 — 과정 칸은 회차 첫날이 든 주에 쓴다 */
  function weekOfRound(c, no) { return mon(roundStart(c, no)); }
  function roundOfWeek(c, week) { return c.startNo + Math.round(diffDays(week, mon(c.start)) / 7); }
  function memberRowsAt(c, no) {
    return c.members.filter(function (m) { return m.from <= no && (m.to == null || no <= m.to); });
  }
  /* 그 회차에 든 반마다 { cls, date, week, canceled } — 수업일 순 */
  function membersAt(c, no) {
    var rs = roundStart(c, no);
    return memberRowsAt(c, no).map(function (m) {
      var s = Store.schedOf(m.cls);
      if (!s || s.dow === '' || s.dow == null) return { cls: m.cls, date: '', week: '', canceled: false, nosched: true };
      var d0 = add(rs, (Number(s.dow) - Lesson.dowOf(rs) + 7) % 7);
      var w = mon(d0);
      var L = Store.lessonOf(m.cls, w);
      return { cls: m.cls, date: L && !L.canceled ? L.date : '', week: w, canceled: !!(L && L.canceled), nosched: !L };
    }).sort(function (a, b) { return (a.date || '9') < (b.date || '9') ? -1 : (a.date || '9') > (b.date || '9') ? 1 : a.cls.localeCompare(b.cls, 'ko'); });
  }
  function range(c, no) {
    var ds = membersAt(c, no).map(function (m) { return m.date; }).filter(Boolean).sort();
    if (!ds.length) { var rs = roundStart(c, no); return { from: rs, to: add(rs, 6) }; }
    return { from: ds[0], to: ds[ds.length - 1] };
  }
  /* 「7회차 · 10/24(토) ~ 10/25(일)」 (설정에서 켜면 「7회차(10월 4주)」) */
  function label(c, no) {
    var r = range(c, no), rs = roundStart(c, no);
    var wk = c.weekLabel ? '(' + (+rs.slice(5, 7)) + '월 ' + Math.ceil(+rs.slice(8, 10) / 7) + '주)' : '';
    return no + '회차' + wk + ' · ' + Store.dateWithDow(r.from) + (r.to !== r.from ? ' ~ ' + Store.dateWithDow(r.to) : '');
  }
  /* 반의 과정 — 그 회차(없으면 지금)에 든 과정 */
  function ofClass(cls, no) {
    for (var i = 0; i < st.courses.length; i++) {
      var c = st.courses[i], n = no == null ? roundNow(c) : no;
      if (memberRowsAt(c, n).some(function (m) { return m.cls === cls; })) return c;
    }
    return null;
  }
  /* 반의 그 주가 과정 몇 회차인가 — { course, no, date } 또는 null */
  function roundOfClassWeek(cls, week) {
    for (var i = 0; i < st.courses.length; i++) {
      var c = st.courses[i];
      if (!c.members.some(function (m) { return m.cls === cls; })) continue;
      var L = Store.lessonOf(cls, week);
      var d = L && L.date ? L.date : week;
      var no = roundOfDate(c, d);
      if (no < c.startNo) continue;
      if (memberRowsAt(c, no).some(function (m) { return m.cls === cls; })) return { course: c, no: no, date: L && !L.canceled ? L.date : '' };
    }
    return null;
  }
  /* 작성 · 공개 · 발송의 「지금 고른 것」에 이 반 학생이 드는가 — 반 이름이면 그 반, 과정이면 그 주 회차의 반들 */
  function inScope(cur, cls, week) {
    if (!cur) return true;
    if (!isKey(cur)) return cls === cur;
    var c = byKey(cur);
    if (!c) return false;
    var no = week ? roundOfWeek(c, week) : roundNow(c);
    return membersAt(c, no).some(function (m) { return m.cls === cls && (!week || m.week === week); });
  }
  /* 과정 화면에서 그 주에 같이 쓰는 반 · 다른 주라서 따로 여는 반 */
  function split(cur, week) {
    var c = byKey(cur);
    if (!c) return { same: [], other: [], course: null, no: 0 };
    var no = roundOfWeek(c, week), ms = membersAt(c, no);
    return { course: c, no: no, same: ms.filter(function (m) { return m.week === week; }), other: ms.filter(function (m) { return m.week !== week; }) };
  }

  /* 반 레포트에 들어갈 반 공통 — 과정 내용 + 이 반에서 직접 고친 칸 + 「이 반만 한 줄 추가」 */
  function effectiveCommon(cls, week, commonOf) {
    var own = commonOf(cls) || {};
    var r = roundOfClassWeek(cls, week);
    if (!r) return own;
    var cw = weekOfRound(r.course, r.no);
    var cc = cw === week ? (commonOf(keyOf(r.course)) || null) : null;
    if (!cc) return own;
    var local = own.local || [];
    var has = function (k) { return local.indexOf(k) !== -1; };
    var lessonsOf = function (x) { return (x && x.lessons || []).filter(function (l) { return String(l || '').trim(); }); };
    return Object.assign({}, own, {
      lessons: has('lessons') ? own.lessons : (lessonsOf(cc).length ? cc.lessons : own.lessons),
      comment: has('comment') ? own.comment : (String(cc.comment || '').trim() ? cc.comment : own.comment),
      extra: own.extra || ''
    });
  }

  /* ---------- 담당 조교 ---------- */
  function assistantOf(cls) { return st.assist[cls] || ''; }
  function mine(cls) { return !!st.me && assistantOf(cls) === st.me; }
  /* 자기 반을 맨 위로 (나머지 순서는 그대로) */
  function mineFirst(names, nameOf) {
    nameOf = nameOf || function (x) { return x; };
    var a = [], b = [];
    names.forEach(function (x) { (mine(nameOf(x)) ? a : b).push(x); });
    return a.concat(b);
  }

  /* ---------- 불러오기 ---------- */
  function load() {
    var c = sb();
    if (!c) return Promise.resolve();
    try { var sess = c.auth && c.auth.session ? c.auth.session() : null; if (sess && sess.user) st.me = String(sess.user.email || '').toLowerCase(); } catch (e) {}
    var me = c.auth && c.auth.getSession ? c.auth.getSession().then(function (r) {
      var u = r && r.data && r.data.session && r.data.session.user;
      if (u && u.email) st.me = String(u.email).toLowerCase();
    }, function () {}) : Promise.resolve();
    return Promise.all([
      c.from('courses').select('*').order('name'),
      c.from('course_members').select('*'),
      c.from('classes').select('name,assistant'),
      me
    ]).then(function (res) {
      if (res[0].error || res[1].error) {
        st.missing = isMissing(res[0].error || res[1].error);
        st.courses = [];
      } else {
        st.missing = false;
        var mem = res[1].data || [];
        st.courses = (res[0].data || []).map(function (r) {
          return {
            id: r.id, name: r.name, start: String(r.start_date).slice(0, 10), startNo: r.start_no || 1, weekLabel: !!r.week_label,
            members: mem.filter(function (m) { return m.course_id === r.id; }).map(function (m) { return { cls: m.class_name, from: m.from_no, to: m.to_no == null ? null : m.to_no }; })
          };
        });
      }
      st.assist = {};
      if (!res[2].error) (res[2].data || []).forEach(function (r) { if (r.assistant) st.assist[r.name] = String(r.assistant).toLowerCase(); });
      st.loaded = true;
      global.dispatchEvent(new CustomEvent('jt:courses'));
    }, function () { st.loaded = true; });
  }

  /* ---------- 과정 공통 내용 → 반마다 (course_sync) ---------- */
  var syncT = {}, syncP = {};
  function syncNow(c, no) {
    if (!c) return Promise.resolve();
    var k = c.id + '|' + no;
    clearTimeout(syncT[k]); delete syncT[k];
    syncP[k] = sb().rpc('course_sync', { p_course: c.id, p_no: no }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? '과정을 쓰려면 migration-033 SQL 을 실행해 주세요' : '과정 내용을 반마다 넣지 못했습니다 — ' + r.error.message, 'bad'); return; }
      global.dispatchEvent(new CustomEvent('jt:course-synced', { detail: { id: c.id, no: no } }));
    });
    return syncP[k];
  }
  function syncSoon(cls, week, ms) {
    var c = byKey(cls);
    if (!c || !week) return;
    var no = roundOfWeek(c, week), k = c.id + '|' + no;
    clearTimeout(syncT[k]);
    syncT[k] = setTimeout(function () { syncNow(c, no); }, ms == null ? 1500 : ms);
  }
  /* 공개 전에 — 기다리는 복사가 있으면 바로 */
  function flush(cls, week) {
    var c = byKey(cls);
    if (!c || !week) return Promise.resolve();
    return syncNow(c, roundOfWeek(c, week));
  }
  window.addEventListener('jt:common-saved', function (e) { var d = e.detail || {}; if (isKey(d.cls)) syncSoon(d.cls, d.week); });
  window.addEventListener('jt:weekly-changed', function (e) { var d = e.detail || {}; if (isKey(d.cls)) syncSoon(d.cls, d.week, 300); });
  window.addEventListener('jt:review-changed', function (e) {
    var d = e.detail || {};
    var r = d.cls && d.week ? roundOfClassWeek(d.cls, d.week) : null;
    if (r) syncSoon(keyOf(r.course), weekOfRound(r.course, r.no), 300);
  });

  /* ---------- 회차 달력 (회차 고르기) ----------
     작은 한 달 달력 — 회차마다 날짜 칸을 같은 색 띠로 묶고, 각 반 수업일 칸에 「목동」「반포」 · 오늘은 동그라미 · 누르면 그 회차 */
  var BAND = ['a', 'b', 'c'];
  function calendarHtml(c, month, curNo) {
    var y = +month.slice(0, 4), mo = +month.slice(5, 7);
    var first = month + '-01', last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var lead = Lesson.dowOf(first), t = today();
    var byDate = {};
    var n0 = roundOfDate(c, first) - 1, n1 = roundOfDate(c, month + '-' + String(last).padStart(2, '0')) + 1;
    for (var n = Math.max(c.startNo, n0); n <= n1; n++) {
      membersAt(c, n).forEach(function (m) { if (m.date) (byDate[m.date] = byDate[m.date] || []).push(shortName(m.cls)); });
    }
    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<span class="rc-cell rc-cell--blank"></span>';
    for (var d = 1; d <= last; d++) {
      var iso = month + '-' + String(d).padStart(2, '0'), no = roundOfDate(c, iso), on = no >= c.startNo;
      var cl = 'rc-cell' + (on ? ' rc-band--' + BAND[((no % 3) + 3) % 3] : ' rc-cell--off') + (on && no === curNo ? ' is-cur' : '') + (iso === t ? ' is-today' : '') + (byDate[iso] ? ' has-class' : '');
      cells += (on ? '<button type="button" class="' + cl + '" data-round="' + no + '" title="' + esc(label(c, no)) + '">' : '<span class="' + cl + '">') +
        '<b class="rc-d num">' + d + '</b>' + (byDate[iso] ? '<small class="rc-cls">' + esc(byDate[iso].join(' · ')) + '</small>' : '') + (on ? '</button>' : '</span>');
    }
    return '<div class="rc">' +
      '<div class="rc-nav"><button type="button" class="btn btn--sm" data-rc-month="-1" aria-label="이전 달">◀</button><b class="rc-month">' + y + '년 ' + mo + '월</b>' +
        '<button type="button" class="btn btn--sm" data-rc-month="1" aria-label="다음 달">▶</button></div>' +
      '<div class="rc-grid">' + ['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return '<span class="rc-dow">' + w + '</span>'; }).join('') + cells + '</div>' +
      '<p class="rc-legend">같은 색 띠 = 한 회차 · 반 이름 = 그 반 수업일 · ○ = 오늘 · 날짜를 누르면 그 회차가 열립니다</p>' +
    '</div>';
  }

  /* ---------- 과정 관리 창 (더보기 → 과정 관리) ---------- */
  var edit = { id: '' };
  function loadStaff() {
    return sb().from('staff').select('email,name,active').then(function (r) {
      st.staff = (r.data || []).filter(function (x) { return x.active !== false; });
    }, function () { st.staff = []; });
  }
  function classNames() { return Store.getClasses().map(function (c) { return c.name; }).filter(function (n) { return !Store.isArchivedClass(n); }); }
  function renderManage() {
    var host = $('#courseList');
    if (!host) return;
    if (st.missing) { host.innerHTML = '<p class="cp-warn">migration-033 SQL 을 실행하면 과정을 만들 수 있습니다.</p>'; return; }
    var names = classNames();
    host.innerHTML = (st.courses.length ? st.courses.map(function (c) {
      var no = roundNow(c), act = memberRowsAt(c, no).map(function (m) { return m.cls; });
      return '<div class="cm-card" data-cid="' + esc(c.id) + '">' +
        '<div class="cm-head"><b class="cm-name">📚 ' + esc(c.name) + '</b><span class="muted-note">지금 ' + esc(label(c, no)) + '</span>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-cm-edit="' + esc(c.id) + '">이름 · 시작일 고치기</button></div>' +
        '<div class="cm-sub">들어갈 반 <span class="muted-note">체크하면 지금 회차부터 · 빼도 지난 레포트는 그 반에 남습니다 · 한 반은 과정 하나에만</span></div>' +
        '<div class="cm-classes">' + names.map(function (n) {
          var other = ofClass(n), busy = other && other.id !== c.id;
          return '<label class="chk-inline cm-cls' + (busy ? ' is-busy' : '') + '"><input type="checkbox" data-cm-member="' + esc(n) + '"' + (act.indexOf(n) !== -1 ? ' checked' : '') + (busy ? ' disabled title="' + esc(other.name) + ' 과정에 들어 있습니다"' : '') + '> ' + esc(n) +
            (busy ? ' <span class="muted-note">(' + esc(other.name) + ')</span>' : '') + '</label>';
        }).join('') + '</div>' +
        '<div class="cm-mem">' + (act.length ? membersAt(c, no).map(function (m) { return esc(shortName(m.cls)) + ' ' + (m.date ? esc(Store.dateWithDow(m.date)) : m.nosched ? '(수업 요일 없음)' : '(휴강)'); }).join(' · ') : '<span class="muted-note">아직 들어간 반이 없습니다</span>') + '</div>' +
        '<label class="check-line"><input type="checkbox" data-cm-wl="' + esc(c.id) + '"' + (c.weekLabel ? ' checked' : '') + '> <span>회차 이름에 「10월 4주」도 함께 쓰기</span></label>' +
      '</div>';
    }).join('') : '<p class="panel__hint">아직 과정이 없습니다. 아래에서 만듭니다.</p>') +
    '<div class="cm-assist"><div class="cm-sub">반마다 담당 조교 <span class="muted-note">(선택) 지정된 조교에게는 그 반이 「오늘」 · 레포트 발송 맨 위에 오고, 과정 작성 화면에서 그 반 학생 카드가 펼쳐져 있습니다. 권한은 모두 같습니다.</span></div>' +
      names.map(function (n) {
        return '<label class="cm-arow"><span>' + esc(n) + '</span><select class="select" data-cm-asst="' + esc(n) + '"><option value="">없음</option>' +
          st.staff.map(function (s) { var em = String(s.email || '').toLowerCase(); return '<option value="' + esc(em) + '"' + (assistantOf(n) === em ? ' selected' : '') + '>' + esc(s.name || em) + '</option>'; }).join('') + '</select></label>';
      }).join('') + '</div>';
  }
  function openForm(c) {
    edit.id = c ? c.id : '';
    $('#cmFormTitle').textContent = c ? '과정 고치기' : '새 과정 만들기';
    $('#cmName').value = c ? c.name : '';
    $('#cmStart').value = c ? c.start : '';
    $('#cmStartNo').value = c ? c.startNo : 1;
    $('#cmError').textContent = '';
  }
  function openManage() {
    $('#courseModal').showModal();
    openForm(null);
    renderManage();
    Promise.all([load(), loadStaff()]).then(renderManage);
  }
  function save() {
    var name = $('#cmName').value.trim(), start = $('#cmStart').value, no = parseInt($('#cmStartNo').value, 10) || 1;
    if (!name) { $('#cmError').textContent = '과정 이름을 적어 주세요.'; return; }
    if (!start) { $('#cmError').textContent = '첫 회차 시작일(예: 첫 수업 토요일)을 골라 주세요.'; return; }
    var c = edit.id ? byId(edit.id) : null;
    sb().rpc('course_save', { p_id: edit.id || null, p_name: name, p_start: start, p_start_no: no, p_week_label: c ? c.weekLabel : false }).then(function (r) {
      if (r.error) { $('#cmError').textContent = isMissing(r.error) ? 'migration-033 SQL 을 먼저 실행해 주세요.' : r.error.message; return; }
      toast(c ? '과정을 고쳤습니다' : '「' + name + '」 과정을 만들었습니다 — 들어갈 반을 체크하세요', 'good');
      openForm(null);
      return load().then(renderManage);
    });
  }
  function init() {
    if (!$('#courseModal')) return;
    $('#cmSave').addEventListener('click', save);
    $('#cmNew').addEventListener('click', function () { openForm(null); $('#cmName').focus(); });
    $('#courseClose').addEventListener('click', function () { $('#courseModal').close(); });
    $('#courseList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cm-edit]');
      if (b) { openForm(byId(b.dataset.cmEdit)); $('#cmName').focus(); }
    });
    $('#courseList').addEventListener('change', function (e) {
      var t = e.target, cid = t.closest('[data-cid]') && t.closest('[data-cid]').dataset.cid;
      if (t.hasAttribute('data-cm-member')) {
        var on = t.checked, cls = t.dataset.cmMember;
        sb().rpc('course_member_set', { p_course: cid, p_class: cls, p_on: on }).then(function (r) {
          if (r.error) { t.checked = !on; toast(r.error.message, 'bad'); return; }
          toast(on ? cls + ' 을(를) 넣었습니다 — 지금 회차부터 과정으로 씁니다' : cls + ' 을(를) 뺐습니다 — 지난 레포트는 그 반에 그대로', 'good');
          load().then(renderManage);
        });
      }
      if (t.hasAttribute('data-cm-wl')) {
        var c = byId(t.dataset.cmWl);
        sb().rpc('course_save', { p_id: c.id, p_name: c.name, p_start: c.start, p_start_no: c.startNo, p_week_label: t.checked }).then(function (r) {
          if (r.error) { toast(r.error.message, 'bad'); return; }
          load().then(renderManage);
        });
      }
      if (t.hasAttribute('data-cm-asst')) {
        sb().rpc('class_assistant_set', { p_name: t.dataset.cmAsst, p_email: t.value }).then(function (r) {
          if (r.error) { toast(r.error.message, 'bad'); return; }
          toast(t.dataset.cmAsst + ' 담당 조교를 ' + (t.value ? '정했습니다' : '비웠습니다'), 'good');
          load().then(renderManage);
        });
      }
    });
  }
  init();

  window.addEventListener('jt:loaded', function () { load(); });
  window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if (t === 'courses' || t === 'course_members') load(); });

  global.Course = {
    load: load, list: list, byKey: byKey, byId: byId, keyOf: keyOf, isKey: isKey, shortName: shortName,
    roundStart: roundStart, roundOfDate: roundOfDate, roundNow: roundNow, weekOfRound: weekOfRound, roundOfWeek: roundOfWeek,
    membersAt: membersAt, range: range, label: label, ofClass: ofClass, roundOfClassWeek: roundOfClassWeek,
    inScope: inScope, split: split, effectiveCommon: effectiveCommon,
    assistantOf: assistantOf, mine: mine, mineFirst: mineFirst, me: function () { return st.me; },
    syncNow: syncNow, syncSoon: syncSoon, flush: flush, calendarHtml: calendarHtml, openManage: openManage,
    missing: function () { return st.missing; }
  };
})(window);
