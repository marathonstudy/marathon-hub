/* ============================================================
   send.js — 레포트 발송 → 3 발송 (20261028a — 반마다 카드 · 20261030e — 고른 반 하나만, 늘 펼침 · 「알림 n회」)

   공개한 레포트를 학부모에게 알린다.
   문자에 들어가는 주소는 학생 개인 페이지(/me/#코드/report)다.
   매주 같은 링크이고, 열면 그 주 레포트가 바로 펼쳐진다.

   맨 위 띠  [◀] 「발송 · 10/15(목) 수업 레포트」 [▶] [⋯]  (작성 화면 띠와 같은 모양)
     · 반마다 수업 요일이 다르면 「발송 · 10/13~10/16 수업 레포트」, 각 카드에 그 반 수업일
     · ⋯ — 인사말 고치기 · 알림톡 나에게 시험 발송 · 문자 보내기 · 문자 보낸 기록 · 새로고침
   반 카드 (「오늘」과 같은 순서 — 수업이 가까운 반 먼저)
     · 머리: 반 이름 · 수업일 · 「공개 n/전체 · 보냄 n/전체」 · 다 보냈으면 ✓
     · 다 보낸 반은 접어 두고 남은 일이 있는 반만 처음에 펼친다. 펼침은 주소에 남는다(#tab=send&week=…&open=반)
       → 뒤로가기로 접힌다 (nav.js)
     · 공개 전 학생만 있는 반은 「아직 공개 전입니다 [공개하러 가기]」만
     · 안 맨 위 [알림톡 n명 보내기] (그 반 보낼 수 있는 학생만) · [반 전체 문자] (sms.js)
   학생 줄 한 줄: 이름 · 상태 꼬리표(공개 전 / 보낼 수 있음 / 보냄 시각 / 실패 …) · 주 버튼 하나 · ⋯
     · ⋯ — 사이트에서 문자 · 내 폰으로 보내기 · 번호 복사 · 문구 복사 · 카톡용 복사 · 공유 · 보냄 되돌리기 ·
           학부모 화면 미리보기 · 학생 화면 미리보기 (가린 번호는 ⋯ 안이나 줄을 눌렀을 때만)

   「내 폰으로 보내기」는 sms: 링크로 이 기기의 문자 앱을 연다 (유료 문자 아님).
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };

  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function students() { return (window.UI ? UI.activeStudents(state.week) : Store.activeStudents(state.week)); }     /* 퇴원일 뒤 수업은 빠짐 (20261031i) */
  function copyText(t) { return UI.copyText(t); }
  function linkFor(s) { return Store.hubUrl(Store.linkOf(s.id).hubCode, 'report'); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var NOCLS = '(반 없음)';
  function clsOf(s) { return (s.className || '').trim() || NOCLS; }
  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); }

  var DEFAULT_GREETING = '안녕하세요 {호칭}, 마라톤국어입니다. 이번 주 {이름} 학생 레포트 보내드립니다^^\n{링크}';

  var state = {
    week: '',
    weeks: [],               /* 공개한 주차 (최근 → 옛날) */
    published: {},
    sent: {},
    greeting: DEFAULT_GREETING,
    greetingAt: '',
    open: null,              /* null = 기본(남은 일이 있는 반만) · { 반: true } = 직접 펼치고 접은 상태 */
    defOpen: {},             /* 기본으로 펼친 반 — 보는 동안 다 보내도 갑자기 접지 않는다 (주가 바뀌면 새로) */
    rowOpen: {},             /* 줄을 눌러 번호를 펼친 학생 */
    loaded: false,
    run: 0
  };

  /* ============================================================
     기기 판별과 sms: 링크

     iOS 는 sms:번호&body=, 안드로이드·윈도우는 sms:번호?body= 다.
     한 글자 차이로 문구가 안 채워지거나 앱이 아예 안 열린다.
     ============================================================ */

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    /* 아이패드는 데스크톱 모드에서 Mac 으로 보인다 */
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function smsHref(number, body) {
    var digits = Store.phoneDigits(number);
    var sep = isIOS() ? '&' : '?';
    return 'sms:' + digits + sep + 'body=' + encodeURIComponent(body);
  }

  /* ============================================================
     문구 만들기
     ============================================================ */

  /* 마라톤 앱 공유 링크가 있는 학생에게는 끝에 한 줄 (레포트의 「앱에서 자세히 보기 ↗」 · 20261031n) */
  var APP_NOTE = "과제를 더 자세히 보시려면 레포트의 '앱에서 자세히 보기'를 눌러 주세요";
  function messageFor(student, url) {
    var t = String(state.greeting || DEFAULT_GREETING)
      .split('{호칭}').join(Store.parentTitleOf(student))
      .split('{이름}').join(student.name || '')
      .split('{링크}').join(url || '');
    var has = !!(Store.linkOf(student.id) || {}).appCode;
    return has && t.indexOf('앱에서 자세히 보기') === -1 ? t + '\n' + APP_NOTE : t;
  }

  /* ============================================================
     보냄 표시
     ============================================================ */

  function whoami() { return UI.whoami(); }

  function markSent(studentId, via) {
    state.sent[studentId] = { at: new Date().toISOString(), via: via, by: whoami() };
    render();

    DB.markSent(state.week, studentId, via, whoami()).catch(function (e) {
      toast('보냄 표시를 저장하지 못했습니다 — ' + e.message, 'bad');
    });

    /* 로컬 사본도 맞춰 둔다 */
    var all = Store.read(Store.KEYS.sent, {});
    all[state.week] = all[state.week] || {};
    all[state.week][studentId] = state.sent[studentId];
    Store.writeLocal(Store.KEYS.sent, all);
  }

  function unmarkSent(studentId) {
    delete state.sent[studentId];
    render();

    DB.unmarkSent(state.week, studentId).catch(function (e) {
      toast('되돌리지 못했습니다 — ' + e.message, 'bad');
    });

    var all = Store.read(Store.KEYS.sent, {});
    if (all[state.week]) {
      delete all[state.week][studentId];
      Store.writeLocal(Store.KEYS.sent, all);
    }
  }

  /* ============================================================
     상태 · 묶기
     ============================================================ */

  function parentPhones(s) { return Store.phonesOf(s).filter(function (p) { return p.who !== 'student'; }); }

  /* 'unpublished' | 'sent' | 'nolink' | 'nophone' | 'failed' | 'ready' */
  function rowState(s) {
    if (!state.published[s.id]) return 'unpublished';
    if (state.sent[s.id]) return 'sent';
    if (!Store.linkOf(s.id).hubCode) return 'nolink';
    if (!parentPhones(s).length) return 'nophone';
    var k = window.Kakao && Kakao.ready() ? Kakao.of(s.id) : null;
    if (k && k.last && k.last.status === 'fail') return 'failed';
    return 'ready';
  }

  function kakaoOn() { return !!(window.Kakao && Kakao.ready()); }

  function fmtSent(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate();
  }

  function tagOf(s, k) {
    if (k === 'sent') {
      var x = state.sent[s.id] || {};
      return { cls: 'sent', text: '보냄 ' + fmtSent(x.at), title: (VIA[x.via] || '') + (x.by ? ' · ' + x.by : '') };
    }
    if (k === 'failed') {
      var kk = Kakao.of(s.id);
      return { cls: 'failed', text: '실패', title: '알림톡 실패 — ' + ((kk && kk.last && kk.last.error) || '이유 모름') };
    }
    return { cls: k, text: LABEL[k], title: '' };
  }
  /* 고친 레포트 알림 — 「알림 2회 · 마지막 10/24 10:12」 (migration-032 · 20261030e) */
  function notifyTag(s) {
    var x = state.sent[s.id];
    if (!x || !x.notifyN) return '';
    var d = x.notifyAt ? new Date(x.notifyAt) : null;
    var when = d ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';
    return '<span class="snd-tag snd-tag--notify num" title="고친 레포트를 다시 알린 횟수">알림 ' + x.notifyN + '회' + (when ? ' · 마지막 ' + esc(when) : '') + '</span>';
  }
  /* 안 보낸 학생은 회색 「안 보냄」 · 보낸 학생은 초록 「보냄 18:09」 (20261030b) */
  var LABEL = { unpublished: '공개 전', ready: '안 보냄', nolink: '링크 없음', nophone: '번호 없음' };
  var VIA = { kakao: '알림톡', sms: '내 폰 문자', sitesms: '사이트 문자', copy: '문구 복사', share: '공유' };

  /* 반 순서 — 「오늘」과 같다 (오늘 수업 → 가까운 날 → 같은 날은 이름 순 → 수업일 미정 맨 아래) */
  function orderClasses(names) {
    if (window.TodayView && TodayView.orderClasses) return TodayView.orderClasses(names);
    return names.slice().sort(function (a, b) {
      if ((a === NOCLS) !== (b === NOCLS)) return a === NOCLS ? 1 : -1;
      return a.localeCompare(b, 'ko');
    });
  }

  /* 고른 반 하나만 (반 하나 + 수업 하나 · 다른 반은 보이지 않는다 · 20261030e) — 반을 안 골랐으면 예전처럼 모든 반 */
  function curClass() { return (window.Writer && Writer.currentClass && Writer.currentClass()) || ''; }
  /* 과정이면 그 회차에 같은 주로 쓰는 반들 — 수업일 순 (course.js · 20261031a) */
  function isCourse() { return !!(window.Course && Course.isKey(curClass())); }
  function groups() {
    var by = {}, cur = curClass(), course = isCourse();
    students().forEach(function (s) { if (!cur || (course ? Course.inScope(cur, clsOf(s), state.week) : clsOf(s) === cur)) (by[clsOf(s)] = by[clsOf(s)] || []).push(s); });
    var names = Object.keys(by).filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); });
    if (course) {
      var order = Course.split(cur, state.week).same.map(function (m) { return m.cls; });
      names.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    } else names = orderClasses(names);
    return names.map(function (n) {
      var rows = sortRows(by[n], lessonOf(n));
      var pub = rows.filter(function (s) { return state.published[s.id]; }).length;
      var sent = rows.filter(function (s) { return state.published[s.id] && state.sent[s.id]; }).length;
      return { name: n, rows: rows, pub: pub, sent: sent, done: rows.length > 0 && sent === rows.length, lesson: lessonOf(n) };
    });
  }

  /* 학생 줄 차례 — 「오늘」과 같은 「과제 많이 한 순」 · 「과제 적게 한 순」(같으면 이름순 · 과제 링크 연결 필요는 맨 아래 · 20261031d)
     과제는 그 레포트 수업일 D 의 D-7 ~ D-1 (레포트 과제 요약과 같은 기간) */
  function appDate(lesson) { return lesson && !lesson.canceled ? lesson.date || '' : ''; }
  function sortRows(rows, lesson) {
    return window.Today && Today.sortStudents ? Today.sortStudents(rows, appDate(lesson)) : rows.slice().sort(byName);
  }

  /* 그 반의 이 주 수업일 { date, canceled } (요일을 안 정했으면 null) */
  function lessonOf(cls) {
    if (cls === NOCLS || !state.week) return null;
    var L = Store.lessonOf(cls, state.week);
    return L ? { date: L.date || '', canceled: !!L.canceled } : null;
  }

  function isOpen(g) {
    if (curClass()) return true;                 /* 반 하나만 보일 때는 늘 펼친다 */
    if (state.open) return !!state.open[g.name];
    return !!state.defOpen[g.name];      /* 기본 — 남은 일이 있는 반만 */
  }

  /* ============================================================
     그리기
     ============================================================ */

  function titleText(gs) {
    if (isCourse() && state.week) { var co = Course.byKey(curClass()); return '발송 · ' + co.name + ' ' + Course.label(co, Course.roundOfWeek(co, state.week)) + ' 레포트'; }
    var ds = [];
    gs.forEach(function (g) { if (g.lesson && g.lesson.date && !g.lesson.canceled && ds.indexOf(g.lesson.date) === -1) ds.push(g.lesson.date); });
    ds.sort();
    if (!state.week) return '발송';
    if (ds.length === 1) return '발송 · ' + Store.dateWithDow(ds[0]) + ' 수업 레포트';
    if (ds.length > 1) return '발송 · ' + Store.shortDate(ds[0]) + '~' + Store.shortDate(ds[ds.length - 1]) + ' 수업 레포트';
    return '발송 · ' + Store.lessonLabel([], state.week) + ' 레포트';
  }

  function renderBar(gs) {
    $('#sendNow').innerHTML = '<b>' + esc(titleText(gs)) + '</b>';
    var i = stepList().indexOf(state.week);
    $('#btnSendPrev').disabled = !state.week || i <= 0;
    $('#btnSendNext').disabled = !state.week || i === -1 || i >= stepList().length - 1;
  }

  /* ◀ ▶ 로 다니는 주 — 공개한 주 + 이번 주 (옛날 → 최근) */
  function stepList() {
    var list = state.weeks.slice();
    var tw = Store.thisWeek().start;
    if (list.indexOf(tw) === -1) list.push(tw);
    if (state.week && list.indexOf(state.week) === -1) list.push(state.week);
    return list.sort();
  }

  function rowHtml(s, lesson) {
    var k = rowState(s);
    var t = tagOf(s, k);
    var main = '';
    if (k === 'ready' || k === 'failed') {
      main = kakaoOn()
        ? '<button class="btn btn--sm btn--primary snd-main" type="button" data-act="kakao"' + (Kakao.busy() ? ' disabled' : '') + '>알림톡</button>'
        : '<button class="btn btn--sm btn--primary snd-main" type="button" data-act="sms">문자 앱</button>';
    }
    var open = !!state.rowOpen[s.id];
    var phones = Store.phonesOf(s);
    return '<div class="snd-row snd-row--' + k + (open ? ' is-expanded' : '') + '" data-id="' + esc(s.id) + '">' +
        '<div class="snd-row__line">' +
          (window.Profile ? Profile.avatar(s, 's') : '') +
          '<button class="snd-row__name" type="button" data-expand aria-expanded="' + open + '">' + esc(s.name || '') + '</button>' +
          '<span class="snd-tag snd-tag--' + t.cls + '"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + '>' + esc(t.text) + '</span>' +
          notifyTag(s) +
          main +
          '<button class="btn btn--sm btn--ghost snd-more" type="button" data-more aria-label="' + esc(s.name || '') + ' 더 보기">⋯</button>' +
        '</div>' +
        (window.Today && Today.appCell ? '<div class="snd-row__app tdc-app-slot">' + Today.appCell(s.id, appDate(lesson)) + '</div>' : '') +
        (window.AppLink ? AppLink.boxHtml(s.id) : '') +
        (open ? '<div class="snd-row__phones num">' + esc(phones.length ? phones.map(function (p) { return p.label + ' ' + Store.phoneMask(p.number); }).join(' · ') : '번호 없음 — 학생 → 명단에서 넣어 주세요') + '</div>' : '') +
      '</div>';
  }

  function cardHtml(g) {
    var n = g.rows.length;
    var open = isOpen(g);
    var L = g.lesson;
    var when = !L ? '' : L.canceled ? '휴강' : L.date ? Store.dateWithDow(L.date) + ' 수업' : '';
    var body = '';
    if (open) {
      if (!g.pub) {
        body = isCourse()
          ? '<div class="snd-unpub snd-unpub--course">' + esc(Course.shortName(g.name)) + ' 공개 전 · 발송 불가 <button class="btn btn--sm" type="button" data-gopub>공개하러 가기</button></div>'
          : '<div class="snd-unpub">아직 공개 전입니다 <button class="btn btn--sm" type="button" data-gopub>공개하러 가기</button></div>';
      } else {
        var targets = kakaoOn() ? g.rows.filter(function (s) { var k = rowState(s); return k === 'ready' || k === 'failed'; }) : [];
        var need = window.Today && Today.appNeed ? g.rows.filter(function (s) { return Today.appNeed(s.id); }).map(function (s) { return s.id; }) : [];
        body = '<div class="snd-acts">' +
            (kakaoOn() ? '<button class="btn btn--sm btn--primary" type="button" data-kk-class' + (targets.length && !Kakao.busy() ? '' : ' disabled') + '>알림톡 ' + targets.length + '명 보내기</button>' : '') +
            (g.name === NOCLS ? '' : '<button class="btn btn--sm" type="button" data-sms-cls="' + esc(g.name) + '" data-sms-week="' + esc(state.week) + '" title="문자 창 — 보낼 표 · 이 수업 레포트를 누구에게 언제 보냈는지도 표에 나옵니다">반 전체 문자 · 보낸 표</button>') +
            (need.length ? '<button type="button" class="tdc-link-btn tdc-need num" data-app-need="' + esc(need.join(',')) + '" title="누르면 그 학생들 링크 칸이 차례로 펼쳐집니다">+ 과제 링크 연결 필요 ' + need.length + '명</button>' : '') +
            /* 학생 정렬 — 목록 머리줄 오른쪽 끝 (「오늘」과 같은 작은 글자 버튼 · 20261031e) */
            (window.Today && Today.sortBarHtml ? Today.sortBarHtml() : '') +
          '</div>' +
          g.rows.map(function (s) { return rowHtml(s, g.lesson); }).join('');
      }
    }
    return '<section class="snd-card' + (open ? ' is-open' : '') + (g.done ? ' is-done' : '') + '" data-cls="' + esc(g.name) + '">' +
        '<button class="snd-head" type="button" data-toggle aria-expanded="' + open + '">' +
          '<span class="snd-head__top"><span class="snd-name">' + esc(g.name) + '</span>' +
            (when ? '<span class="snd-when">' + esc(when) + '</span>' : '') +
            (g.done ? '<span class="snd-done" aria-label="다 보냄">✓</span>' : '') +
            '<span class="class-head__caret" aria-hidden="true">▾</span></span>' +
          '<span class="snd-count num">공개 ' + g.pub + '/' + n + ' · 보냄 ' + g.sent + '/' + n + '</span>' +
        '</button>' +
        (open ? '<div class="snd-body">' + body + '</div>' : '') +
      '</section>';
  }

  function render() {
    var host = $('#sendList');
    if (!host) return;
    var gs = groups();
    if (state.loaded) gs.forEach(function (g) { if (!g.done) state.defOpen[g.name] = true; });
    renderBar(gs);

    var total = gs.reduce(function (a, g) { return a + g.rows.length; }, 0);
    var pub = gs.reduce(function (a, g) { return a + g.pub; }, 0);
    var sent = gs.reduce(function (a, g) { return a + g.sent; }, 0);
    var kk = kakaoOn() ? ' · 알림톡 오늘 ' + Kakao.today() + ' / ' + (Kakao.cfg().dailyMax || 300) + '건' : '';
    $('#sendProgress').textContent = state.week && total ? (isCourse()
      /* 과정 — 반별 「목동 100% · 반포 92%」 (보낸 학생 / 반 학생 · 공개 전 반은 「공개 전」) */
      ? gs.map(function (g) { return Course.shortName(g.name) + ' ' + (!g.pub ? '공개 전' : Math.round(g.sent / Math.max(1, g.rows.length) * 100) + '%'); }).join(' · ') + kk
      : '전체 공개 ' + pub + '/' + total + ' · 보냄 ' + sent + '/' + total + kk) : '';

    if (!state.loaded) { host.innerHTML = '<div class="empty-state">불러오는 중…</div>'; return; }
    if (!state.week) {
      host.innerHTML = '<div class="empty-state">아직 공개한 레포트가 없습니다.<br>레포트 발송 → 2 공개에서 먼저 공개해 주세요.</div>';
      return;
    }
    if (!gs.length) { host.innerHTML = '<div class="empty-state">다니는 학생이 없습니다.</div>'; return; }
    host.innerHTML = gs.map(cardHtml).join('');
    if (window.Today && Today.paintDetail) Today.paintDetail();       /* 펼친 과제 표 (today.js · 20261031f) */
  }

  /* ============================================================
     ⋯ 메뉴 (작은 창 하나를 같이 쓴다 — 뒤로가기로 닫힌다)
     ============================================================ */

  var menuPick = null;
  function menu(title, desc, items, onPick) {
    $('#sendMenuTitle').textContent = title;
    $('#sendMenuDesc').textContent = desc || '';
    $('#sendMenuDesc').hidden = !desc;
    $('#sendMenuList').innerHTML = items.map(function (it) {
      return '<button class="btn sheet__btn' + (it.danger ? ' sheet__btn--danger' : '') + '" type="button" data-pick="' + esc(it.act) + '"' + (it.disabled ? ' disabled' : '') + '>' +
        '<span>' + esc(it.label) + '</span>' + (it.hint ? '<span class="sheet__hint">' + esc(it.hint) + '</span>' : '') + '</button>';
    }).join('');
    menuPick = onPick;
    $('#sendMenu').showModal();
  }
  $('#sendMenuList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (!b || b.disabled) return;
    var f = menuPick, act = b.dataset.pick;
    menuPick = null;
    $('#sendMenu').close();
    /* 메뉴를 닫으며 지운 뒤로가기 기록(nav.js)이 먼저 끝난 다음에 다음 창을 연다 */
    if (f) setTimeout(function () { f(act); }, 60);
  });
  $('#sendMenuClose').addEventListener('click', function () { $('#sendMenu').close(); });

  function studentMenu(s) {
    var k = rowState(s);
    var pub = !!state.published[s.id];
    var url = linkFor(s);
    var phones = Store.phonesOf(s);
    var needPub = pub ? '' : '공개 전';
    var needLink = url ? '' : '링크 없음';
    var items = [
      { act: 'sitesms', label: '사이트에서 문자' },
      { act: 'sms', label: '내 폰으로 보내기', hint: needPub || needLink || (phones.length ? '' : '번호 없음'), disabled: !pub || !url || !phones.length },
      { act: 'copyphone', label: '번호 복사', hint: phones.length ? '' : '번호 없음', disabled: !phones.length },
      { act: 'copymsg', label: '문구 복사', hint: needPub || needLink, disabled: !pub || !url },
      { act: 'copykakao', label: '카톡용 복사', hint: needPub || needLink, disabled: !pub || !url }
    ];
    if (navigator.share) items.push({ act: 'share', label: '공유', hint: needPub || needLink, disabled: !pub || !url });
    if (k === 'sent' && kakaoOn()) items.push({ act: 'kkresend', label: '알림톡 다시 보내기' });
    if (k === 'sent') items.push({ act: 'undo', label: '보냄 되돌리기', danger: true });
    items.push({ act: 'pvparent', label: '학부모 화면 미리보기' }, { act: 'pvstudent', label: '학생 화면 미리보기' });
    /* 마라톤 앱 공유 링크 — 있으면 「앱에서 보기 ↗」(만료 · 확인 필요면 먼저 안내), 없으면 「+ 과제 링크 연결」 (20261031n) */
    var aw = window.Today && Today.linkWarn ? Today.linkWarn(s.id) : '';
    if (window.AppLink && AppLink.url(s.id)) items.push({ act: 'appopen', label: '앱에서 보기 ↗', hint: aw ? '링크 확인 필요' : '' });
    else items.push({ act: 'applink', label: '+ 과제 링크 연결' });
    var desc = phones.length ? phones.map(function (p) { return p.label + ' ' + Store.phoneMask(p.number); }).join(' · ') : '번호 없음';
    menu((s.name || '') + ' · ' + clsOf(s), desc, items, function (act) { doAct(s, act); });
  }

  function doAct(s, act) {
    var sid = s.id;
    var url = linkFor(s);
    var msg = messageFor(s, url);

    if (act === 'pvparent' || act === 'pvstudent') { if (window.Preview) Preview.open(sid, act === 'pvparent' ? 'parent' : 'student'); return; }
    if (act === 'sitesms') { if (window.Sms) Sms.open({ students: [sid], single: true, week: state.week, from: 'send' }); return; }
    if (act === 'kakao') { if (kakaoOn()) Kakao.send([sid], false); return; }
    if (act === 'kkresend') { if (kakaoOn()) Kakao.send([sid], true); return; }
    if (act === 'undo') { unmarkSent(sid); toast('되돌렸습니다'); return; }
    if (act === 'applink') { if (window.AppLink) AppLink.open([sid]); return; }
    if (act === 'appopen') {
      var au = window.AppLink ? AppLink.url(sid) : '';
      if (!au) return;
      if (window.Today && Today.linkWarn && Today.linkWarn(sid)) {
        UI.confirmAsk('앱에서 보기', '링크가 만료됐을 수 있습니다. 링크를 먼저 바꾸시겠어요? (그 학생 줄 아래에 링크 칸이 펼쳐집니다)', '링크 바꾸기').then(function (y) {
          if (y) { if (window.AppLink) AppLink.open([sid], { edit: true }); } else window.open(au, '_blank', 'noopener');
        });
        return;
      }
      window.open(au, '_blank', 'noopener');
      return;
    }

    if (act === 'copyphone') {
      pickPhone(s, Store.phonesOf(s), function (num) {
        copyText(Store.phoneFormat(num))
          .then(function () { toast('번호를 복사했습니다', 'good'); })
          .catch(function (e) { toast(e.message, 'bad'); });
      });
      return;
    }

    if (!state.published[sid]) { toast('아직 공개 전입니다. 레포트 발송 → 2 공개에서 먼저 공개해 주세요', 'bad'); return; }
    if (!url) { toast('개인 링크가 없습니다. 학생 → 명단에서 발급해 주세요', 'bad'); return; }

    if (act === 'copymsg' || act === 'copykakao') {
      copyText(msg).then(function () {
        markSent(sid, act === 'copykakao' ? 'kakao' : 'copy');
        toast((act === 'copykakao' ? '카톡용 문구를' : '문구를') + ' 복사했습니다', 'good');
      }).catch(function (e) { toast(e.message, 'bad'); });
      return;
    }

    if (act === 'share') {
      navigator.share({ text: msg }).then(function () {
        markSent(sid, 'share');
      }).catch(function () { /* 사용자가 취소한 경우 — 표시하지 않는다 */ });
      return;
    }

    if (act === 'sms') {
      pickPhone(s, Store.phonesOf(s), function (num) {
        /* 문자 앱으로 넘어가면 이 화면을 떠나므로 먼저 표시해 둔다 */
        markSent(sid, 'sms');
        location.href = smsHref(num, msg);
      });
    }
  }

  function barMenu() {
    var kk = kakaoOn();
    menu('발송', '', [
      { act: 'greeting', label: '인사말 고치기', hint: '문구 복사 · 카톡용 · 내 폰 문자에 들어가는 글' },
      { act: 'kktest', label: '알림톡 나에게 시험 발송', hint: kk ? '[설정]의 내 시험 번호로 한 건' : '알림톡을 쓸 수 없습니다', disabled: !kk || !state.week },
      { act: 'sms', label: '문자 보내기', hint: '반 · 학생을 골라 사이트에서 바로' },
      { act: 'smslog', label: '문자 보낸 기록' },
      { act: 'refresh', label: '새로고침' }
    ], function (act) {
      if (act === 'greeting') openGreeting();
      if (act === 'kktest') Kakao.testSend();
      if (act === 'sms' && window.Sms) Sms.open({ week: state.week, from: 'send' });
      if (act === 'smslog' && window.Sms) Sms.openLog();
      if (act === 'refresh') refresh().then(function () { toast('다시 읽었습니다'); });
    });
  }

  /* ============================================================
     동작
     ============================================================ */

  function findStudent(sid) { return students().find(function (x) { return x.id === sid; }); }

  $('#sendList').addEventListener('click', function (ev) {
    /* 과제 칸 · 정렬 (「오늘」과 같은 동작 · today.js · applink.js) */
    /* 「+ 과제 링크 연결」 · 링크 칸은 applink.js 가 받는다 */
    if (ev.target.closest('.al-box, .hd-box')) return;
    var ap = ev.target.closest('[data-app-sort], [data-app-retry]');
    if (ap && window.Today) {
      if (ap.dataset.appSort) Today.setAppSort(ap.dataset.appSort);
      else if (ap.dataset.appRetry) Today.retryApp(ap.dataset.appRetry);
      return;
    }
    var card = ev.target.closest('.snd-card');
    if (!card) return;
    var cls = card.dataset.cls;

    var t = ev.target.closest('[data-toggle]');
    if (t) { toggle(cls); return; }

    if (ev.target.closest('[data-gopub]')) { goPublish(); return; }

    var kc = ev.target.closest('[data-kk-class]');
    if (kc && !kc.disabled) {
      var g = groups().find(function (x) { return x.name === cls; });
      var ids = g ? g.rows.filter(function (s) { var k = rowState(s); return k === 'ready' || k === 'failed'; }).map(function (s) { return s.id; }) : [];
      Kakao.send(ids, false);
      return;
    }

    var row = ev.target.closest('.snd-row');
    if (!row) return;
    var s = findStudent(row.dataset.id);
    if (!s) return;

    if (ev.target.closest('[data-more]')) { studentMenu(s); return; }
    var b = ev.target.closest('[data-act]');
    if (b) { if (!b.disabled) doAct(s, b.dataset.act); return; }
    if (ev.target.closest('button, a, input')) {
      if (!ev.target.closest('[data-expand]')) return;
    }
    /* 줄(이름)을 누르면 가린 번호를 펼친다 */
    state.rowOpen[s.id] = !state.rowOpen[s.id];
    render();
  });

  function toggle(cls) {
    var gs = groups();
    if (!state.open) {
      state.open = {};
      gs.forEach(function (g) { if (state.defOpen[g.name]) state.open[g.name] = true; });
    }
    var opening = !state.open[cls];
    if (opening) state.open[cls] = true; else delete state.open[cls];
    render();
    /* 펼치면 뒤로가기 기록을 하나 더(뒤로가기 = 접기), 직접 접으면 기록을 고치기만 (nav.js) */
    setTimeout(function () { if (opening) window.dispatchEvent(new CustomEvent('jt:write-nav')); else if (window.Nav) Nav.replace(); }, 0);
  }

  /* [공개하러 가기] — 레포트 발송 → 2 공개는 레포트 발송 → 1 작성의 주차를 쓴다. 이 주로 맞춘 뒤 연다 */
  function goPublish() {
    var w = state.week;
    var p = (window.Writer && Writer.current && Writer.current() && Writer.current().weekStart !== w && Writer.switchWeek)
      ? (Writer.switchWeek(w, 0) || Promise.resolve()) : Promise.resolve();
    Promise.resolve(p).then(function () { UI.selectTab(2); });
  }

  /* 번호가 하나면 바로, 둘 이상이면 고르게 한다 */
  function pickPhone(student, phones, done) {
    if (!phones.length) { toast('저장된 번호가 없습니다', 'bad'); return; }
    if (phones.length === 1) { done(phones[0].number); return; }

    var modal = $('#phonePickModal');
    $('#phonePickTitle').textContent = student.name + ' 학생 — 번호 고르기';

    var host = $('#phonePickList');
    host.textContent = '';
    phones.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn phone-pick__btn';
      b.innerHTML = '<span class="phone-pick__label"></span><span class="phone-pick__num num"></span>';
      b.querySelector('.phone-pick__label').textContent = p.label;
      b.querySelector('.phone-pick__num').textContent = Store.phoneFormat(p.number);
      b.addEventListener('click', function () {
        modal.close();
        done(p.number);
      });
      host.appendChild(b);
    });
    modal.showModal();
  }

  $('#btnPhonePickCancel').addEventListener('click', function () { $('#phonePickModal').close(); });

  function step(dir) {
    var list = stepList();
    var i = list.indexOf(state.week);
    var to = list[i + dir];
    if (!to) return;
    state.week = to;
    state.open = null;
    state.defOpen = {};
    state.rowOpen = {};
    loadWeek().then(function () { window.dispatchEvent(new CustomEvent('jt:write-nav')); });
  }
  $('#btnSendPrev').addEventListener('click', function () { step(-1); });
  $('#btnSendNext').addEventListener('click', function () { step(1); });
  $('#btnSendMore').addEventListener('click', barMenu);

  /* ============================================================
     인사말 고치기 (띠 ⋯)
     ============================================================ */

  var greetModal = $('#greetingModal');

  function openGreeting() {
    $('#greetingText').value = state.greeting;
    $('#greetingError').classList.remove('is-on');
    updateGreetPreview();
    greetModal.showModal();
  }

  $('#btnGreetingCancel').addEventListener('click', function () { greetModal.close(); });

  $('#greetingText').addEventListener('input', updateGreetPreview);

  function updateGreetPreview() {
    var sample = students()[0] || { name: '김하늘', parentTitle: '어머님' };
    var text = $('#greetingText').value || '';
    var preview = text
      .split('{호칭}').join(Store.parentTitleOf(sample))
      .split('{이름}').join(sample.name || '김하늘')
      .split('{링크}').join(CONFIG.siteUrl + '/me/#예시코드/report');
    $('#greetingPreview').textContent = preview;
  }

  $('#greetingForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('#greetingText').value.trim();
    var err = $('#greetingError');

    if (!text) {
      err.textContent = '인사말을 입력해 주세요.';
      err.classList.add('is-on');
      return;
    }
    if (text.indexOf('{링크}') === -1) {
      err.textContent = '{링크} 가 빠졌습니다. 개인 페이지 주소가 들어갈 자리가 필요합니다.';
      err.classList.add('is-on');
      return;
    }

    greetModal.close();

    /* 불러온 뒤 다른 분이 인사말을 고쳤으면 묻는다 */
    UI.guardedSave('인사말', function (check) {
      return DB.saveSettingIf('greeting', { sms: text, kakao: text }, whoami(), check ? state.greetingAt : '');
    }, function (row) {
      var g = row && row.value;
      state.greeting = (g && (g.sms || g.kakao)) || state.greeting;
      state.greetingAt = (row && row.updated_at) || state.greetingAt;
      render();
    }).then(function (res) {
      if (!res.ok) return;
      state.greeting = text;
      state.greetingAt = res.row.updated_at || '';
      render();
      toast('인사말을 저장했습니다. 모든 기기에 반영됩니다', 'good');
    }).catch(function (e2) { toast('저장하지 못했습니다 — ' + e2.message, 'bad'); });
  });

  /* ============================================================
     불러오기
     ============================================================ */

  function loadWeek() {
    var run = ++state.run;
    if (!state.week) { state.loaded = true; render(); return Promise.resolve(); }

    return DB.weekSendData(state.week).then(function (d) {
      if (run !== state.run) return;
      if (state.loadedWeek !== state.week) { state.defOpen = {}; state.loadedWeek = state.week; }
      state.published = d.published;
      state.sent = d.sent;
      state.loaded = true;
      render();
      if (window.Kakao) Kakao.reload();
      if (!$('#panel-send').hidden && window.Nav) Nav.replace();
    }).catch(function (e) {
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  function refresh() {
    return Promise.all([
      DB.publishedWeeks(),
      DB.getSettingRow('greeting')
    ]).then(function (res) {
      state.weeks = res[0] || [];

      var g = res[1] && res[1].value;
      state.greetingAt = (res[1] && res[1].updated_at) || '';
      state.greeting = (g && (g.sms || g.kakao)) || DEFAULT_GREETING;

      /* 레포트 발송의 주차 띠와 같은 주 (20261029a — 작성 · 공개 · 발송이 같은 주를 본다) */
      var wk = writerWeek();
      if (wk) {
        if (wk !== state.week) { state.open = null; state.defOpen = {}; state.rowOpen = {}; }
        state.week = wk;
      } else if (!state.week || stepList().indexOf(state.week) === -1) {
        state.week = state.weeks[0] || '';
      }
      return loadWeek();
    }).catch(function (e) {
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  function writerWeek() {
    var d = window.Writer && Writer.current && Writer.current();
    return (d && d.weekStart) || '';
  }

  /* 띠에서 고른 반을 먼저 — 펼치고 그 카드로 */
  function focusClass(cls) {
    if (!cls) return;
    var gs = groups();
    if (!gs.some(function (g) { return g.name === cls; })) return;
    if (!state.open) {
      state.open = {};
      gs.forEach(function (g) { if (state.defOpen[g.name]) state.open[g.name] = true; });
    }
    state.open[cls] = true;
    render();
    var card = $('#sendList .snd-card[data-cls="' + (window.CSS && CSS.escape ? CSS.escape(cls) : cls) + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 3) refresh().then(function () { focusClass(window.Writer && Writer.currentClass ? Writer.currentClass() : ''); });
  });

  /* 띠에서 주를 바꾸면 (rtabs.js) */
  window.addEventListener('jt:report-week', function () {
    if (!$('#panel-send').hidden) refresh();
  });

  window.addEventListener('jt:loaded', function () {
    if (!$('#panel-send').hidden) refresh();
  });

  /* 다른 기기에서 보냄 표시·공개가 바뀌었을 때 */
  window.addEventListener('jt:refreshed', function () {
    if ($('#panel-send').hidden) return;
    if (UI.isBusy($('#panel-send'))) { if (window.Sync) Sync.markSkipped(); return; }
    refresh();
  });

  window.addEventListener('jt:kakao', function () { if (state.loaded) render(); });
  window.addEventListener('jt:profiles', function () { if (state.loaded) render(); });
  /* 과제 기록을 받거나 · 정렬을 바꾸거나 · 과제 링크를 넣으면 (today.js · applink.js) — 보고 있을 때만, 받는 동안은 0.4초에 한 번 */
  var appTimer = null;
  function appRender() {
    clearTimeout(appTimer);
    appTimer = setTimeout(function () { if (state.loaded && !$('#panel-send').hidden) render(); }, 400);
  }
  window.addEventListener('jt:app', function (e) {
    if (!state.loaded || $('#panel-send').hidden) return;
    var sid = e.detail && e.detail.sid;
    if (!sid) { appRender(); return; }               /* 다 받았다 — 정렬까지 다시 */
    /* 한 명 받을 때마다 그 학생 칸만 (줄이 뛰지 않게) */
    var s = findStudent(sid), el = document.querySelector('#sendList .snd-row[data-id="' + sid + '"] .snd-row__app');
    if (s && el) { el.innerHTML = Today.appCell(sid, appDate(lessonOf(clsOf(s)))); if (Today.detailOpen().sid === sid) Today.paintDetail(); }
  });
  window.addEventListener('jt:appsort', function () { if (state.loaded) render(); });
  window.addEventListener('jt:applink', appRender);
  window.addEventListener('jt:applink-ui', function () { if (state.loaded && !$('#panel-send').hidden) render(); });
  /* 수업 요일 · 반이 바뀌면 제목 · 순서도 */
  window.addEventListener('jt:schedule-changed', function () { if (state.loaded) render(); });
  window.addEventListener('jt:roster-changed', function () { if (state.loaded && !$('#panel-send').hidden) render(); });

  /* 뒤로가기 · 새로고침 (nav.js) — 주차 · 펼친 반
     open: undefined = 기본(남은 일이 있는 반만) · [] = 모두 접음 · [반 …] */
  window.SendView = {
    week: function () { return state.week; },
    explicit: function () { return !!state.open; },
    openList: function () {
      if (!state.open) return [];
      return Object.keys(state.open).sort();
    },
    apply: function (week, open) {
      var weekChanged = !!week && week !== state.week;
      /* 주소에 적힌 주 — 주차 띠(작성 · 공개)도 같은 주로 */
      if (week && window.Writer && Writer.switchWeek && writerWeek() && writerWeek() !== week) Writer.switchWeek(week, 0);
      if (week) state.week = week;
      if (open === undefined) state.open = null;
      else { state.open = {}; open.forEach(function (n) { if (n) state.open[n] = true; }); }
      if (weekChanged) { state.rowOpen = {}; state.defOpen = {}; }
      if ($('#panel-send').hidden) return Promise.resolve();
      return weekChanged ? refresh() : (render(), Promise.resolve());
    },
    refresh: refresh,
    render: render
  };

  /* 기기마다 형식이 다른 sms 링크와 문구 조립은 여기서 가장 깨지기 쉽다.
     밖에서 직접 확인할 수 있게 내보낸다. */
  window.Send = {
    smsHref: smsHref,
    messageFor: messageFor,
    isIOS: isIOS,
    setGreeting: function (t) { state.greeting = t; },
    getGreeting: function () { return state.greeting; },
    rowState: rowState
  };

})();
