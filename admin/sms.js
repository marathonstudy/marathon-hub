/* ============================================================
   sms.js — 「문자 발송」 탭 (SMS · LMS · 솔라피 · Edge Function sms-send · migration-023 · 040)

   문자에 관한 것은 모두 위쪽 탭 「문자 발송」에 있다 (20261031m). 안쪽 작은 탭 네 개:
   「보내기」 (20261101i — 휴대폰 기준 · 위에서 아래로 세 덩어리)
     · 맨 위 「보내는 번호: 02-…」 (sms-send status — 솔라피 등록 발신번호)
     ① 누구에게 — 반 버튼(여러 개 · 종강한 반은 「종강한 반 보기」 안) → 그 반 학생 체크 목록(기본 전체 · 반별로 묶음 · 「전체 선택/해제」 · 「n명 중 n명」)
       이름 검색(고른 반 안 · 다른 반 학생은 「다른 반」 [+ 추가]) · 받는 사람 [학생] [학부모] [둘 다] (기본 학생 · 레포트 안내는 둘 다)
       학부모는 등록된 학부모 번호(1 · 2) 모두로. 학생 번호가 학부모 번호와 같으면 학부모 링크로 한 통만 · 번호 없는 사람 · 퇴원생은 빠지고 「번호 없음 n명」
       다른 화면에서 학생을 정해 열면(학생 줄 [문자] · 상담 카드 …) 그 학생만 체크된 채로
     ② 무엇을 — 「자주 쓰는 문구」 버튼 · 「AI에게 부탁하기」(비었으면 새로 · 있으면 부탁대로 고침 · text-polish revise) · 내용 칸 · 칸 넣기 버튼 · 글자 수 · 단문/장문
     ③ 보내기 — 요약(명 · 통 · 예상 원) · 맨 아래 고정 「n명에게 보내기」 위에 첫 번째 받는 사람 미리보기 1건
       확인 한 번(「목동반 학생 11명에게 보냅니다」) → 「보냄 n · 실패 n(이름)」 · 학생 줄마다 「보냄 18:09」 / 「실패(사유)」
     · 카톡 알림톡이 연동돼 있고 레포트 안내(3 발송에서 · 「레포트」 + #{링크})면 「카톡으로 보내기(안 받는 사람은 문자로)」 / 「문자로만」
       카톡은 학부모에게 템플릿(주간레포트안내) 그대로 · 학생 본인 번호는 문자로 (kakao-send · fallback)
     · 보낸 뒤 맨 위 띠 「✓ 보냄 22 · 실패 0」(실패면 빨간 띠 · 실패만 다시 보내기)
     · 내용 칸: {학생이름} {반이름} #{링크}(학부모에겐 학부모 링크, 학생에겐 학생 링크) #{수업일} {첫수업일} {앱입장코드} #{앱 설치 링크} {러닝노트주소}
       예전 칸 #{이름} #{반} #{입장코드}도 그대로 · 단문(90바이트까지) · 장문 표시 · 예상 비용 · [내용 비우기] · [이 글을 문구로 저장]
     · 같은 번호는 한 번만 — 형제가 같은 번호를 쓰면 「따로 보내기」를 직접 켰을 때만 따로
     · 광고 문자: 맨 앞 (광고)와 발신처, 끝에 무료수신거부 안내. 수신거부 번호가 없거나 밤(21시 ~ 8시)이면 막는다
     · 보내기 전 확인 — 「n명 · 예상 약 n원」 · 몇 건 안 되거나 앱 안내면 받는 사람 · 번호 뒤 4자리 · 실제 문구까지
     · 화면은 학생 id 와 보낼 곳만 함수에 넘긴다. 번호는 함수가 DB 에서 찾는다 (화면의 번호는 미리보기 · 셈에만 쓴다)
   「자주 쓰는 문구」 — 이름 · 첫 줄 · [고치기] [복사해서 새로 만들기] [삭제](확인) · [+ 새 문구] · ⠿ 끌어서 순서
       고치기 화면: 칸 넣기 버튼 · 예시 학생으로 미리보기 · 「AI로 다듬기」(aipolish.js · text-polish)
   「보낸 기록」 — 「10/29 15:30 · 고2 선수능반 레포트 안내 · 22건 · 성공 22」 · 누르면 받는 사람 표(보냄 시각 · 실패 사유) · [실패만 다시 보내기]
   「연결 상태」 — 카톡 알림톡(「연동됨 · 템플릿 주간레포트안내」 / 「템플릿 ID 없음」 / 「함수 응답 없음」) · 보내는 번호 ·
       이번 달 남은 건수 · 내 시험 번호(바로 고침) · [나에게 시험 발송](문자 한 통 · 카톡 한 통) · 앱 설치 링크 · 키 · 단가 · 상한
   여는 곳 — Sms.open(…) · [data-sms-cls] · [data-sms-sid] · [data-app-invite] 모두 이 탭의 「보내기」를 골라진 채로 연다 (창으로 따로 열지 않는다)
   새 학생 앱 안내 — 학생 등록(한 명 · 엑셀) 아래 체크 → 저장 뒤 「보내기」에 「앱 안내(기본)」 · 입장코드 · 받는 사람을 채우고 확인 → 보내기
       보내면 상담 카드에 「10/29 앱 안내 문자 보냄」 · 보낸 기록에도
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache|relation .* does not exist/i.test((e && e.message) || ''); }
  var FN = 'sms-send', KFN = 'kakao-send';
  var TAB = 9;                                   /* app.js TABS — 9 문자 발송 */
  var NOCLS = '(반 없음)';
  var KK_TEMPLATE = '주간레포트안내';            /* kakao/template.txt 의 템플릿 이름 */
  var APP_TPL = '앱 안내(기본)';
  var APP_BODY = '안녕하세요, 마라톤국어입니다. #{이름} 학생, 마라톤 스터디 앱을 설치하고 입장코드로 들어와 주세요.\n1) 앱 설치: #{앱 설치 링크}\n2) 앱에서 입장코드 입력: #{입장코드}\n궁금한 점은 이 번호로 답장 주세요.';
  var CODE_RE = /^[A-Za-z0-9가-힣_-]{2,30}$/;
  var DEF = { smsWon: 20, lmsWon: 50, perSend: 200, dailyMax: 500, monthMax: 3000, adName: '마라톤국어', optout: '', androidUrl: '', iosUrl: '' };

  var st = {
    classes: {},           /* 고른 반 (반 버튼 · 여러 개) */
    extra: {},             /* 고른 반 밖에서 더한 학생 id (검색 「다른 반」 · 다른 화면에서 학생을 정해 열 때) */
    find: '',
    to: 'student',         /* 받는 사람 — student | parent | both (기본 학생 · 20261101i) */
    tplOn: '',             /* 지금 들어간 「자주 쓰는 문구」 id */
    week: '', from: '',
    cfg: null, missing: false,
    templates: [],
    failed: [],            /* 마지막에 실패한 줄 [{ student_id, to }] — [실패만 다시 보내기] */
    busy: false,
    off: {},               /* 체크를 끈 학생 id (명단에서 빼고 보낸다) */
    prev: {},              /* 그 주 레포트를 이미 보낸 학생 id → 보낸 시각 (레포트 발송 → 3 발송에서 열었을 때) */
    res: null,             /* 보낸 결과 { at, by: { '학생id|대상': { ok, error } } } */
    done: false,           /* 보냈다 — [보냄 완료] (다시 보내려면 [다시 보내기]) */
    pubBy: null,           /* 주 시작일 → { 학생 id: true } — 공개된 레포트 (레포트 안내 문자에서 공개 전 학생을 막는다 · 20261030e) */
    notify: null,          /* 「바뀐 내용 알리기」 — 학생 id → 바뀐 내용 (publish.js · 20261030e) */
    label: '',             /* 묶음 이름 (불러온 문구 이름) — 보낸 기록 */
    purpose: '',           /* app = 앱 안내 (보내면 상담 카드에 한 줄) */
    codes: {},             /* 반 → 앱 입장코드 (classes.app_code · migration-040) */
    kk: null,              /* 카톡 알림톡 상태 (kakao-send health) */
    ask: null,             /* AI에게 부탁하기 — { busy, undo, check } */
    pane: 'send',
    back: -1,              /* 「← 돌아가기」 — 연 화면 */
    started: false
  };

  function invoke(body, fn) {
    var name = fn || FN;
    var what = name === KFN ? '알림톡 함수(kakao-send)' : '문자 함수(sms-send)';
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, reason: 'nofn', message: what + '를 부를 수 없습니다.' });
    return fns.invoke(name, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().catch(function () { return null; }).then(function (j) {
          return j || { ok: false, reason: 'nofn', message: what + '를 부르지 못했습니다. 배포됐는지 확인해 주세요.' };
        });
      }
      return { ok: false, reason: 'nofn', message: what + '를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) {
      return { ok: false, reason: 'nofn', message: what + '를 부르지 못했습니다 — ' + ((e && e.message) || '') };
    });
  }

  /* ---------- 「내 번호로도 한 통 받기(맨 위 학생 기준)」 (20261031r) ----------
     여러 명에게 보낼 때(문자 발송 → 보내기 · 레포트 발송 반 카드 알림톡) 맨 위 학생에게 실제로 가는 내용 그대로 내 시험 번호로 한 통 더.
     알림톡이면 알림톡(kakao-send test), 문자면 문자(sms-send test) — 학생 발송 현황(보냄 표시)에 세지 않고 보낸 기록에 「내 번호 확인용」.
     기본 켜짐 · 이 기기에 기억 (mhub.copyMe). 내 시험 번호가 비어 있으면 안내하고 체크를 끈다 */
  var COPY_KEY = 'mhub.copyMe';
  var me = { phone: null, p: null };
  function loadMyPhone(force) {
    if (me.p && !force) return me.p;
    me.p = Promise.resolve(sb().rpc('sms_settings_get')).then(function (r) {
      if (r && !r.error && r.data) return r.data.testPhone || '';
      return Promise.resolve(sb().rpc('kakao_settings_get')).then(function (k) { return k && !k.error && k.data ? k.data.testPhone || '' : ''; });
    }).then(function (p) { setMyPhone(p); return p; }, function () { setMyPhone(''); return ''; });
    return me.p;
  }
  function setMyPhone(p) {
    var was = me.phone;
    me.phone = p || '';
    if (was !== me.phone) window.dispatchEvent(new CustomEvent('jt:copyme'));
  }
  function copyPref() { try { return localStorage.getItem(COPY_KEY) !== '0'; } catch (e) { return true; } }
  function copyOn() { return copyPref() && !!me.phone; }
  function copyHtml(id) {
    if (me.phone === null) loadMyPhone();
    var has = !!me.phone;
    return '<label class="copyme' + (has ? '' : ' is-off') + '"><input type="checkbox" data-copyme' + (id ? ' id="' + id + '"' : '') + (copyOn() ? ' checked' : '') + (has ? '' : ' disabled') + '>' +
      ' <span>내 번호로도 한 통 받기 <small>(맨 위 학생 기준' + (has ? ' · ' + esc(me.phone) : '') + ')</small></span>' +
      (has || me.phone === null ? '' : '<small class="copyme__why">내 시험 번호가 없어 꺼 두었습니다 — 「문자 발송 → 연결 상태」에서 넣으면 켤 수 있습니다</small>') + '</label>';
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-copyme')) return;
    try { localStorage.setItem(COPY_KEY, t.checked ? '1' : '0'); } catch (er) {}
    Array.prototype.forEach.call(document.querySelectorAll('[data-copyme]'), function (x) { if (x !== t && !x.disabled) x.checked = t.checked; });
  });
  /* 맨 위 학생 내용 그대로 내 번호로 — 알림톡(학부모 · 카톡으로 보냈을 때)이면 알림톡, 아니면 문자 */
  function sendCopy(pl, first, kk) {
    if (!first) return Promise.resolve();
    var useKk = !!kk && first.t !== 'student';
    var body = st.notify ? String(pl.body).split('#{바뀐 내용}').join(String(st.notify[first.s.id] || '내용')) : pl.body;
    var q = useKk
      ? invoke({ action: 'test', week: st.week, students: [first.s.id] }, KFN)
      : invoke(Object.assign({}, pl, { action: 'test', body: body, items: [{ student_id: first.s.id, to: first.t }], markWeek: '', label: ((pl.label || '문자') + ' · 내 번호 확인용').slice(0, 60) }));
    return q.then(function (r) {
      var ok = r && r.ok && r.sent;
      toast(ok ? '내 번호로도 한 통 보냈습니다 (' + first.s.name + ' 학생 내용 · ' + (useKk ? '알림톡' : '문자') + ')' : '내 번호 확인용 한 통은 보내지 못했습니다' + (r && r.message ? ' — ' + r.message : ''), ok ? 'good' : 'bad');
    });
  }

  /* ---------- 학생 · 반 ---------- */

  function active() { return UI.activeStudents(); }
  function clsOf(s) { return (s.className || '').trim() || NOCLS; }
  function order(names) {
    if (window.TodayView && TodayView.orderClasses) return TodayView.orderClasses(names);
    return names.slice().sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function classNames() {
    var seen = {};
    active().forEach(function (s) { seen[clsOf(s)] = 1; });
    return order(Object.keys(seen).filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); }));
  }
  /* 반 순서 → 이름 순 */
  function sortStudents(list) {
    var rank = {};
    classNames().forEach(function (n, i) { rank[n] = i; });
    return list.slice().sort(function (a, b) {
      var c = (rank[clsOf(a)] || 0) - (rank[clsOf(b)] || 0);
      return c || (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }
  function numberOf(s, t) { return t === 'parent1' ? s.parentPhone : t === 'parent2' ? s.parentPhone2 : s.studentPhone; }
  function labelOf(s, t) { return t === 'student' ? '학생 본인' : '학부모(' + Store.parentTitleOf(s) + ')'; }
  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }
  /* 명단에 보이는 학생 — 고른 반 학생 전부 + 더한 학생 (체크를 끈 학생도 들어 있다 · 빼는 것은 listFromPicks) */
  function pickedStudents() {
    return sortStudents(active().filter(function (s) { return !!st.classes[clsOf(s)] || !!st.extra[s.id]; }));
  }
  /* 받는 사람 — 「학부모」는 등록된 학부모 번호(1 · 2) 모두 */
  function targets() {
    return st.to === 'parent' ? ['parent1', 'parent2'] : st.to === 'both' ? ['parent1', 'parent2', 'student'] : ['student'];
  }
  function toWord() { return st.to === 'parent' ? '학부모' : st.to === 'both' ? '학생 · 학부모' : '학생'; }
  /* 지금 받는 사람 기준으로 보낼 번호가 하나라도 있는가 */
  function hasNum(s) { return targets().some(function (t) { return mobile(Store.phoneDigits(numberOf(s, t))); }); }
  /* 이 학생이 보낼 수 있는 줄인가 (체크 · 번호 · 공개 전) */
  function sendable(s) { return !st.off[s.id] && hasNum(s) && !blocked(s); }

  /* ---------- 글 ---------- */

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function kdate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (+m[2]) + '월 ' + (+m[3]) + '일(' + DOW[d.getUTCDay()] + ')';
  }
  /* #{수업일} — 레포트 발송 → 3 발송에서 열면 그 주 수업일, 아니면 다음 수업일 (휴강은 건너뛴다) */
  function lessonText(cls) {
    if (cls === NOCLS) return '';
    if (st.week) {
      var L = Store.lessonOf(cls, st.week);
      if (L && L.date && !L.canceled) return kdate(L.date);
    }
    var nx = window.TodayView && TodayView.nextLesson ? TodayView.nextLesson(cls) : null;
    return nx ? kdate(nx.date) : '';
  }
  function lessonsMap(list) {
    var m = {};
    list.forEach(function (x) { var c = (x.s.className || '').trim(); if (c && !(c in m)) m[c] = lessonText(c); });
    return m;
  }
  function cfg() { return st.cfg || DEF; }
  function bytes(t) {
    var n = 0;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); n += (c > 0 && c < 128) ? 1 : 2; }
    return n;
  }
  function hasLink(body) { return body.indexOf('#{링크}') !== -1; }
  function hasCode(body) { return body.indexOf('#{입장코드}') !== -1 || body.indexOf('{앱입장코드}') !== -1; }
  function hasApp(body) { return body.indexOf('#{앱 설치 링크}') !== -1; }
  function linkFor(s, t) {
    var l = Store.linkOf(s.id);
    var code = t === 'student' ? l.studentCode : l.hubCode;
    return code ? CONFIG.siteUrl + '/me/#' + code : '';
  }
  /* #{앱 설치 링크} — 서버(_sms_app_links)와 같은 모양 */
  function appLinks(c) {
    c = c || cfg();
    var a = String(c.androidUrl || '').trim(), i = String(c.iosUrl || '').trim();
    return a && i ? '\n안드로이드 ' + a + '\n아이폰 ' + i : a || i || '';
  }
  /* #{입장코드} — 직접 친 값이 먼저, 없으면 그 반 「앱 입장코드」 */
  function entryOf(s) {
    var typed = String(($('#smsEntry') && $('#smsEntry').value) || '').trim();
    var c = typed || st.codes[clsOf(s)] || '';
    return CODE_RE.test(c) ? c : '';
  }
  /* #{앱 안내} — 앱 공유 링크가 있는 학생만 한 줄 · 없으면 그 줄을 뺀다 (서버 sms_prepare · migration-041 과 같다 · 20261031n) */
  var APP_NOTE = "과제를 더 자세히 보시려면 레포트의 '앱에서 자세히 보기'를 눌러 주세요";
  function appNote(body, s) {
    if (body.indexOf('#{앱 안내}') === -1) return body;
    var has = !!(Store.linkOf(s.id) || {}).appCode;
    return has ? body.split('#{앱 안내}').join(APP_NOTE) : body.split('\n#{앱 안내}').join('').split('#{앱 안내}').join('');
  }
  /* {첫수업일} — 수강 시작일 (없으면 반 첫 수업일) · welcome.js 와 같다 */
  function firstOf(s) {
    var d = Store.startOf(s) || (Store.defaultStartDate ? Store.defaultStartDate(clsOf(s) === NOCLS ? '' : clsOf(s)) : '');
    return d ? kdate(d) : '';
  }
  /* 바뀌지 않은 칸 (20261101m) — 보내기 직전 글에 {밀린날짜} · #{링크} 같은 칸이 남으면 그 사람에게는 보내지 않는다 (sms-send · note-remind 와 같은 규칙) */
  function leftOf(text) { var out = []; (String(text || '').match(/#?\{[^{}\r\n]{1,20}\}/g) || []).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); }); return out; }
  function leftMsg(left) { return '바뀌지 않은 칸이 있어 보내지 않음: ' + left.join(' '); }
  /* {밀린날짜} — 「오늘」 과제 기록으로 센 그 학생의 밀린 날 (과제 독려와 같다). 모르거나 밀린 날이 없으면 칸을 그대로 둔다 → 보내지 않음 */
  function missFor(s) { var v = window.Today && Today.missFor ? Today.missFor(s.id) : null; return v ? v : '{밀린날짜}'; }
  function hasMiss(body) { return String(body || '').indexOf('{밀린날짜}') !== -1; }
  /* 서버 sms_prepare(052) 와 같은 순서 — 예전 칸 #{…} 다음에 새 칸 {…} · {밀린날짜}는 화면이 채워서 보낸다 (20261101m) */
  function render(body, s, t, lessons, opt) {
    opt = opt || {};
    var code = opt.code != null ? opt.code : entryOf(s);
    var txt = appNote(body, s).split('#{이름}').join(s.name || '')
      .split('#{반}').join((s.className || '').trim())
      .split('#{수업일}').join(String(lessons[(s.className || '').trim()] || '').slice(0, 30))
      .split('#{바뀐 내용}').join(st.notify ? String(st.notify[s.id] || '내용') : '')
      .split('#{입장코드}').join(code)
      .split('#{앱 설치 링크}').join(appLinks())
      .split('#{링크}').join(linkFor(s, t))
      .split('{학생이름}').join(s.name || '').split('{반이름}').join((s.className || '').trim())
      .split('{첫수업일}').join(firstOf(s)).split('{앱입장코드}').join(code)
      .split('{러닝노트주소}').join(CONFIG.siteUrl + '/s/')
      .split('{밀린날짜}').join(missFor(s));
    if (opt.ad) txt = '(광고)' + cfg().adName + '\n' + txt + '\n무료수신거부 ' + cfg().optout;
    return txt;
  }
  function textFor(body, s, t, lessons) { return render(body, s, t, lessons, { ad: $('#smsAd').checked }); }

  /* 받는 줄 만들기 — 함수(sms_prepare)와 같은 규칙. list = [{ s, t }] (학생 순서 · 보낼 곳 순서) */
  function build(list, body, siblings) {
    var lessons = lessonsMap(list);
    var out = { items: [], sib: [], noPhone: [], noLink: [], noCode: [], tooLong: [], left: [], lessons: lessons, people: 0 };
    var seen = {}, mineBy = {}, okBy = {};
    list.forEach(function (x) {
      var s = x.s, t = x.t;
      var d = Store.phoneDigits(numberOf(s, t));
      if (!mobile(d)) return;
      var mine = mineBy[s.id] = mineBy[s.id] || {};
      if (mine[d]) return;                                   /* 같은 학생 · 같은 번호(학부모 1 = 2) — 한 번만 */
      if (hasLink(body) && !linkFor(s, t)) { out.noLink.push(x); return; }
      var sib = !!seen[d] && seen[d] !== s.id;
      if (sib) { out.sib.push(x); if (!siblings) return; }
      if (hasCode(body) && !entryOf(s)) { out.noCode.push(x); return; }
      var txt = textFor(body, s, t, lessons);
      var lf = leftOf(txt);
      if (lf.length) { out.left.push({ s: s, t: t, left: lf }); return; }     /* 바뀌지 않은 칸 — 보내지 않음 (20261101m) */
      var b = bytes(txt);
      if (b > 2000) { out.tooLong.push(x); return; }
      mine[d] = 1;
      if (!seen[d]) seen[d] = s.id;
      okBy[s.id] = 1;
      out.items.push({ s: s, t: t, d: d, text: txt, bytes: b, kind: b <= 90 ? 'SMS' : 'LMS' });
    });
    var stuSeen = {};
    list.forEach(function (x) {
      if (stuSeen[x.s.id]) return;
      stuSeen[x.s.id] = 1;
      var any = targetsOfList(list, x.s.id).some(function (t) { return mobile(Store.phoneDigits(numberOf(x.s, t))); });
      if (!any) out.noPhone.push(x.s);
    });
    out.people = Object.keys(okBy).length;
    out.sms = out.items.filter(function (x) { return x.kind === 'SMS'; }).length;
    out.lms = out.items.length - out.sms;
    out.won = out.sms * cfg().smsWon + out.lms * cfg().lmsWon;
    return out;
  }
  function targetsOfList(list, sid) { return list.filter(function (x) { return x.s.id === sid; }).map(function (x) { return x.t; }); }

  /* ---------- 레포트 안내 — 공개 전 학생은 보내지 않는다 (20261030e) ----------
     내용에 「레포트」와 #{링크}가 있으면 레포트 안내로 본다. 학생마다 그 반 그 수업(3 발송에서 열면 그 주 · 아니면 그 반 가장 최근 수업)의
     레포트가 공개 전이면 「공개 전 · 발송 불가」(회색 · 체크 꺼짐 · 못 켬) */
  function isReportBody() { var b = $('#smsBody').value; return /레포트/.test(b) && hasLink(b); }
  function reportWeekOf(s) {
    if (st.week) return st.week;
    var c = clsOf(s);
    return c !== NOCLS && window.TodayView && TodayView.lastLessonWeek ? TodayView.lastLessonWeek(c) : '';
  }
  function blocked(s) {
    if (st.notify || !st.pubBy || !isReportBody()) return false;
    var w = reportWeekOf(s);
    if (!w) return false;
    return !(st.pubBy[w] && st.pubBy[w][s.id]);
  }
  function loadPub() {
    var from = Lesson.addDays(DDay.today(), -49);
    return sb().from('published').select('week_start,student_id').eq('visible', true).gte('week_start', st.week && st.week < from ? st.week : from).then(function (r) {
      if (r.error) { st.pubBy = null; return; }
      var m = {};
      (r.data || []).forEach(function (x) { (m[x.week_start] = m[x.week_start] || {})[x.student_id] = true; });
      st.pubBy = m;
    }, function () { st.pubBy = null; });
  }

  function listFromPicks() {
    var ts = targets(), out = [];
    pickedStudents().forEach(function (s) {
      if (st.off[s.id] || blocked(s)) return;
      ts.forEach(function (t) { out.push({ s: s, t: t }); });
    });
    return out;
  }

  /* ---------- 카톡 알림톡으로 보내기 (레포트 안내만 · 학부모) ---------- */
  function kakaoReady() { return !!(st.kk && st.kk.ok && st.kk.ready); }
  function viaKakao() { return !$('#smsViaSec').hidden && $('#smsViaKakao').checked; }
  function renderVia() {
    var show = kakaoReady() && !!st.week && !st.notify && isReportBody();
    var sec = $('#smsViaSec');
    if (sec.hidden === show) {
      sec.hidden = !show;
      if (show && !st.viaTouched) $('#smsViaKakao').checked = true;
    }
    $('#smsViaHint').textContent = show
      ? (viaKakao() ? '학부모에게는 알림톡 「' + KK_TEMPLATE + '」 템플릿 그대로 갑니다 (위 글이 아니라 템플릿 글 · 카톡을 안 받으면 문자로). 학생 본인 번호는 위 글로 문자.' : '모두 위 글 그대로 문자로 보냅니다.')
      : '';
  }

  /* ---------- 그리기 ---------- */

  /* ============================================================
     ① 누구에게 (20261101i)
       반 버튼(여러 개 · 종강한 반은 「종강한 반 보기」 안) → 바로 아래 그 반 학생 체크 목록(기본 전체 체크 · 반별로 묶음)
       반 줄에 「전체 선택/해제」 · 「n명 중 n명」 · 이름 검색 — 고른 반 안에서 찾고, 다른 반 학생은 「다른 반」 [+ 추가]
       받는 사람 [학생] [학부모] [둘 다] (기본 학생) · 번호 없는 사람 · 퇴원생은 저절로 빠지고 「번호 없음 n명」만
       학생 줄 표시 — 이미 보냄(그 주 레포트 · 처음부터 체크 꺼 둠) · 공개 전 · 발송 불가 · 바뀐 내용 · 보낸 뒤 「보냄 18:09」 · 「실패(사유)」
     ============================================================ */
  function tail(d) { d = Store.phoneDigits(d || ''); return d ? '…' + d.slice(-4) : ''; }
  function tailsOf(s) {
    var seen = [];
    targets().forEach(function (t) { var d = Store.phoneDigits(numberOf(s, t)); if (mobile(d) && seen.indexOf(d) === -1) seen.push(d); });
    return seen.map(tail).join(' ');
  }
  function clsBtn(n) {
    var cnt = active().filter(function (s) { return clsOf(s) === n; }).length, on = !!st.classes[n];
    return '<button class="sms-cls__b' + (on ? ' is-on' : '') + '" type="button" data-smscls="' + esc(n) + '" aria-pressed="' + on + '"' + (st.done ? ' disabled' : '') + '>' +
      '<span class="sms-cls__n">' + esc(n) + '</span><span class="sms-cls__c num">' + cnt + '명</span></button>';
  }
  /* 학생 한 줄 결과 — 보낸 뒤 (그 학생 번호들 중 하나라도 실패면 실패) */
  function resOf(s) {
    if (!st.res) return '';
    var rs = Object.keys(st.res.by).filter(function (k) { return k.split('|')[0] === s.id; }).map(function (k) { return st.res.by[k]; });
    if (!rs.length) return '';
    var bad = rs.filter(function (r) { return !r.ok; })[0];
    return bad ? '<span class="sms-st sms-st--bad" title="' + esc(bad.error || '') + '">실패(' + esc(String(bad.error || '이유 모름').slice(0, 24)) + ')</span>'
      : '<span class="sms-st sms-st--ok">보냄 ' + esc(hm(st.res.at)) + (rs.some(function (r) { return r.via === 'kakao'; }) ? ' · 카톡' : '') + '</span>';
  }
  function rowHtml(s, otherCls) {
    var blk = blocked(s), num = hasNum(s), on = !st.off[s.id] && num && !blk, prev = st.prev[s.id];
    return '<li><label class="sms-row' + (on ? '' : ' is-off') + (num ? '' : ' is-nonum') + '">' +
      '<input type="checkbox" data-smsrow="' + esc(s.id) + '"' + (on ? ' checked' : '') + (st.done || blk || !num ? ' disabled' : '') + ' aria-label="' + esc(s.name || '') + ' 보내기">' +
      '<span class="sms-row__n">' + esc(s.name || '') + '</span>' +
      (otherCls ? '<small class="sms-tag sms-tag--other">다른 반</small>' : '') +
      '<span class="sms-row__d num">' + esc(num ? tailsOf(s) : '') + '</span>' +
      (!num ? '<small class="sms-tag is-mute">번호 없음</small>' : '') +
      (prev ? '<span class="sms-st sms-st--prev">이미 보냄 ' + esc(fmtPrev(prev)) + '</span>' : '') +
      (blk ? '<span class="sms-st sms-st--blocked" title="이 수업 레포트를 아직 공개하지 않았습니다 — 레포트 발송 → 2 공개에서 먼저 공개하세요">공개 전 · 발송 불가</span>' : '') +
      (st.notify && st.notify[s.id] ? '<span class="sms-st sms-st--chg">' + esc(st.notify[s.id]) + '</span>' : '') +
      resOf(s) + '</label></li>';
  }
  /* 반 버튼 — 다니는 학생이 있는 반 모두 (종강한 반은 따로 접어 둔다) */
  function allClassNames() {
    var seen = {};
    active().forEach(function (s) { seen[clsOf(s)] = 1; });
    return order(Object.keys(seen));
  }
  function renderPick() {
    var names = allClassNames(), open = names.filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); });
    var ended = names.filter(function (n) { return n !== NOCLS && Store.isArchivedClass(n); });
    var endedOn = ended.some(function (n) { return st.classes[n]; });
    $('#smsClassBox').innerHTML = (open.map(clsBtn).join('') || '<p class="panel__hint">다니는 학생이 없습니다.</p>') +
      (ended.length ? '<details class="sms-cls__ended"' + (endedOn ? ' open' : '') + '><summary>종강한 반 보기 <span class="num">' + ended.length + '</span></summary><div class="sms-cls">' + ended.map(clsBtn).join('') + '</div></details>' : '');
    var q = st.find.replace(/\s+/g, '').toLowerCase();
    var hit = function (s) { return !q || (s.name || '').replace(/\s+/g, '').toLowerCase().indexOf(q) !== -1; };
    var list = pickedStudents();
    /* 반별로 묶는다 (반 순서) */
    var groups = [], by = {};
    list.forEach(function (s) { var c = clsOf(s); if (!by[c]) { by[c] = []; groups.push(c); } by[c].push(s); });
    var html = groups.map(function (c) {
      var all = by[c], rows = all.filter(hit);
      if (q && !rows.length) return '';
      var can = all.filter(function (s) { return hasNum(s) && !blocked(s); }), on = can.filter(function (s) { return !st.off[s.id]; });
      var whole = !!st.classes[c];
      return '<div class="sms-grp" data-grp="' + esc(c) + '"><div class="sms-grp__h">' +
          '<b class="sms-grp__n">' + esc(c) + '</b>' + (whole ? '' : '<small class="sms-tag">골라 담은 학생</small>') +
          '<span class="sms-grp__c num">' + all.length + '명 중 ' + on.length + '명</span>' +
          '<button type="button" class="sms-grp__all" data-sms-gall="' + esc(c) + '"' + (st.done || !can.length ? ' disabled' : '') + '>' + (can.length && on.length === can.length ? '전체 해제' : '전체 선택') + '</button>' +
        '</div><ul class="sms-rows">' + rows.map(function (s) { return rowHtml(s, false); }).join('') + '</ul></div>';
    }).join('');
    /* 검색 — 명단에 없는 학생은 「다른 반」으로 · [+ 추가] */
    if (q) {
      var more = sortStudents(active()).filter(function (s) { return hit(s) && list.indexOf(s) === -1; }).slice(0, 12);
      if (more.length) html += '<div class="sms-grp sms-grp--other"><div class="sms-grp__h"><b class="sms-grp__n">' + (list.length ? '다른 반' : '찾은 학생') + '</b></div><ul class="sms-rows">' + more.map(function (s) {
        return '<li><div class="sms-row sms-row--add"><span class="sms-row__n">' + esc(s.name || '') + '</span><small class="sms-tag sms-tag--other">' + (list.length ? '다른 반 · ' : '') + esc(clsOf(s)) + '</small>' +
          '<button type="button" class="btn btn--sm sms-row__add" data-sms-add="' + esc(s.id) + '"' + (st.done ? ' disabled' : '') + '>+ 추가</button></div></li>';
      }).join('') + '</ul></div>';
      else if (!html) html = '<p class="panel__hint">「' + esc(st.find.trim()) + '」 학생이 없습니다.</p>';
    }
    if (!list.length && !q) html = '<p class="panel__hint">위에서 반을 고르거나, 이름으로 찾아 더해 주세요.</p>';
    $('#smsStuList').innerHTML = html;
    $$('[data-smsto]').forEach(function (b) { var on = b.dataset.smsto === st.to; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); b.disabled = st.done; });
    var go = list.filter(sendable).length, noNum = list.filter(function (s) { return !hasNum(s); }).length;
    $('#smsPickedHint').innerHTML = list.length ? '<b>' + go + '명</b>에게 · ' + esc(toWord()) + (noNum ? ' <small class="sms-who-note__mute">번호 없음 ' + noNum + '명</small>' : '') : '';
  }

  /* 보낼 수 없는 까닭 — 광고 문자 규칙 · 앱 설치 링크 */
  function adBlock() {
    var body = $('#smsBody').value;
    if (hasApp(body) && !appLinks()) return '문자 발송 → 연결 상태에서 앱 설치 링크를 먼저 넣어 주세요.';
    if (!$('#smsAd').checked) return '';
    if (!String(cfg().optout || '').trim()) return '무료수신거부 번호가 [설정]에 없어 광고 문자를 보낼 수 없습니다. 「문자 발송」 → 연결 상태에서 넣어 주세요.';
    if (!String(cfg().adName || '').trim()) return '광고 발신처 이름이 [설정]에 없어 광고 문자를 보낼 수 없습니다.';
    var h = (new Date().getUTCHours() + 9) % 24;
    if (h >= 21 || h < 8) return '광고 문자는 밤 9시 ~ 아침 8시에 보낼 수 없습니다.';
    return '';
  }

  function hm(iso) {
    var d = iso ? new Date(iso) : new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function mdhm(iso) {
    var d = iso ? new Date(iso) : new Date();
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(iso);
  }
  function key(sid, t) { return sid + '|' + t; }
  /* 이미 보낸 시각 — 오늘이면 18:09, 아니면 10/22 18:09 */
  function fmtPrev(iso) {
    var d = new Date(iso), now = new Date();
    return d.toDateString() === now.toDateString() ? hm(iso) : mdhm(iso);
  }

  /* #{입장코드} 칸 — 글에 있을 때만 · 반 코드가 있으면 안내 */
  function renderEntry() {
    var on = hasCode($('#smsBody').value);
    $('#smsEntryRow').hidden = !on;
    if (!on) return;
    var cs = {};
    pickedStudents().forEach(function (s) { cs[clsOf(s)] = st.codes[clsOf(s)] || ''; });
    var have = Object.keys(cs).filter(function (c) { return cs[c]; });
    var typed = $('#smsEntry').value.trim();
    $('#smsEntryHint').textContent = typed
      ? (CODE_RE.test(typed) ? '모두 이 코드로 보냅니다' : '영문 · 숫자 · 한글 2 ~ 30자 (띄어쓰기 없이)')
      : have.length ? '비우면 반 설정의 「앱 입장코드」 — ' + have.map(function (c) { return c + ' ' + cs[c]; }).join(' · ')
      : '반 설정에 「앱 입장코드」가 없습니다 — 여기에 입장코드를 적어 주세요';
  }

  var plan = null;
  /* ③ 보내기 — 요약 한 줄 · 경고 · 맨 아래 미리보기 1건(첫 번째 받는 사람) · 「n명에게 보내기」 */
  function renderPreview() {
    var body = $('#smsBody').value;
    var sibOn = !!($('#smsSib') && $('#smsSib').checked);
    renderEntry();
    renderVia();
    plan = build(listFromPicks(), body, sibOn);
    var b0 = bytes(body), ex = plan.items[0];
    var kind = ex ? ex.kind : b0 <= 90 && !$('#smsAd').checked && !hasLink(body) && !hasApp(body) ? 'SMS' : 'LMS';
    $('#smsLen').innerHTML = body ? '<span class="sms-kind sms-kind--' + kind + '">' + (kind === 'SMS' ? '단문' : '장문') + '</span> ' + body.length + '자 · ' + (ex ? ex.bytes : b0) + '바이트 <span class="muted-note">90바이트가 넘으면 장문</span>' : '';
    var warn = adBlock();
    $('#smsAdWarn').hidden = !warn;
    $('#smsAdWarn').innerHTML = warn ? esc(warn) + (/연결 상태/.test(warn) ? ' <button class="btn btn--sm" type="button" data-smspane-go="conn">연결 상태 열기</button>' : '') : '';

    var host = $('#smsPreview');
    renderPick();
    var pv = $('#smsFootPv');
    if (st.missing) { host.innerHTML = ''; pv.innerHTML = ''; updateButtons(); return; }
    var list = pickedStudents();
    if (!list.length) { host.innerHTML = '<p class="panel__hint">① 에서 받는 사람을 고르면 여기에 보입니다.</p>'; pv.innerHTML = ''; updateButtons(); return; }
    var c = cfg();
    var par = plan.items.filter(function (x) { return x.t !== 'student'; }).length, stu = plan.items.length - par;
    var blockedN = list.filter(blocked).length;
    var html = (blockedN ? '<p class="sms-blocked-note">레포트 공개 전인 학생 ' + blockedN + '명은 보내지 않습니다 (회색 「공개 전 · 발송 불가」)</p>' : '') +
      '<p class="sms-sum"><b class="num">' + plan.people + '</b>명 · ' + (par ? '학부모 <b class="num">' + par + '</b>통 · ' : '') + (stu ? '학생 <b class="num">' + stu + '</b>통 · ' : '') + '총 <b class="num">' + plan.items.length + '</b>통 · 약 <b class="num">' + plan.won.toLocaleString() + '</b>원' +
      ' <span class="muted-note">단문 ' + c.smsWon + '원 · 장문 ' + c.lmsWon + '원' + (viaKakao() ? ' · 카톡이면 학부모는 알림톡 요금' : '') + '</span></p>';
    if (plan.noCode.length) html += '<p class="cp-warn">입장코드가 없는 학생 ' + plan.noCode.map(function (x) { return x.s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length + '명은 보내지 않습니다 — 「입장코드」 칸에 적거나 반 설정에 「앱 입장코드」를 넣어 주세요.</p>';
    if (plan.noLink.length) html += '<p class="cp-warn">링크가 없는 학생 ' + plan.noLink.map(function (x) { return x.s.name; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 6).join(', ') + '은(는) 보내지 않습니다.</p>';
    if (plan.sib.length) {
      html += '<label class="check-line sms-sib"><input type="checkbox" id="smsSib"' + (sibOn ? ' checked' : '') + (st.done ? ' disabled' : '') + '> <span>같은 번호를 쓰는 형제 ' + plan.sib.length + '명에게도 따로 보내기 <span class="field__opt">' +
        esc(plan.sib.slice(0, 6).map(function (x) { return x.s.name; }).join(', ')) + ' · 끄면 번호마다 한 번만 (앞 학생 이름으로)</span></span></label>';
    }
    if (plan.items.length > c.perSend) html += '<p class="cp-warn">한 번에 ' + c.perSend + '건까지 보낼 수 있습니다. 반을 나눠 보내 주세요.</p>';
    if (plan.left.length) html += leftWarn(plan.left, body);
    host.innerHTML = html;
    /* 미리보기 1건 — 첫 번째 받는 사람 */
    pv.innerHTML = body.trim() && ex
      ? '<div class="sms-pv sms-pv--ex"><div class="sms-pv__head">미리보기 <span class="muted-note">' + esc(ex.s.name) + ' · ' + esc(labelOf(ex.s, ex.t)) + '</span></div><pre class="sms-pv__text">' + esc(ex.text) + '</pre></div>'
      : body.trim() ? '<p class="sms-foot__none">보낼 번호가 없습니다</p>' : '';
    updateButtons();
  }

  /* 바뀌지 않은 칸 경고 — 「바뀌지 않은 칸이 있어 n명에게는 보내지 않습니다: {밀린날짜} (김지우 · 이서준)」 */
  function leftWarn(left, body) {
    var names = [], keys = [];
    left.forEach(function (x) { if (names.indexOf(x.s.name) === -1) names.push(x.s.name); x.left.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
    return '<p class="cp-warn sms-left" id="smsLeftWarn">⚠ 바뀌지 않은 칸이 있어 ' + names.length + '명에게는 보내지 않습니다: <b>' + esc(keys.join(' ')) + '</b> (' + esc(names.slice(0, 8).join(' · ') + (names.length > 8 ? ' 외 ' + (names.length - 8) + '명' : '')) + ')' +
      (hasMiss(body) ? ' — {밀린날짜}는 「오늘」에서 과제 기록을 불러온 학생 중 밀린 날이 있는 학생만 채워집니다. 과제 독려는 「오늘」 반 카드 [안 낸 학생 n명에게 독려 문자]가 편합니다.' : ' — 이 화면에서 쓸 수 없는 칸입니다. 칸 버튼으로 넣거나 지워 주세요.') + '</p>';
  }
  function updateButtons() {
    var ok = !st.missing && !st.busy && plan && plan.items.length && $('#smsBody').value.trim() && !adBlock();
    $('#smsSend').disabled = st.done || !ok || plan.items.length > cfg().perSend;
    $('#smsTest').disabled = st.busy || !(plan && plan.items.length && $('#smsBody').value.trim());
    $('#smsSend').textContent = st.busy ? '보내는 중…' : st.done ? '보냄 완료' : plan && plan.people ? plan.people + '명에게 보내기' : '보내기';
    $('#smsResend').hidden = !st.done;
    /* 여러 명에게 보낼 때만 「내 번호로도 한 통 받기」 */
    var ch = $('#smsCopyHost');
    if (ch) {
      var h = plan && plan.people > 1 && !st.done ? copyHtml('smsCopyMe') : '';
      if (ch.dataset.h !== h) { ch.innerHTML = h; ch.dataset.h = h; }
    }
  }

  /* ---------- 자주 쓰는 문구 (직원 공용 · sms_templates) ---------- */

  function loadTemplates() {
    return sb().from('sms_templates').select('*').order('sort_order', { ascending: true }).order('title', { ascending: true }).then(function (r) {
      if (r.error) { st.templates = []; if (isMissing(r.error)) st.missing = true; return; }
      st.templates = r.data || [];
    }, function () { st.templates = []; }).then(function () { renderTemplates(); renderTplList(); });
  }
  /* 「자주 쓰는 문구」 — 버튼 (누르면 내용 칸에 · 지금 들어간 문구는 진하게) */
  function renderTemplates() {
    var host = $('#smsTplBtns');
    if (!host) return;
    host.innerHTML = st.templates.length ? '<span class="sms-tpls__t">자주 쓰는 문구</span>' + st.templates.map(function (t) {
      var on = st.tplOn === t.id;
      return '<button type="button" class="sms-tpl-b' + (on ? ' is-on' : '') + '" data-smstpl="' + esc(t.id) + '" aria-pressed="' + on + '">' + esc(t.title || '(이름 없음)') + '</button>';
    }).join('') : '<span class="sms-tpls__t">자주 쓰는 문구 없음 <button type="button" class="sms-tpl-b" data-smspane-go="tpl">+ 만들기</button></span>';
  }
  function tplById(id) { return st.templates.find(function (t) { return t.id === id; }) || null; }
  function tplByTitle(title) { return st.templates.find(function (t) { return (t.title || '').trim() === title; }) || null; }

  function setBody(text, title) {
    $('#smsBody').value = text || '';
    st.label = title || '';
    if (/앱 안내/.test(title || '') || hasCode(text || '')) st.purpose = st.purpose || 'app';
    else if (st.purpose === 'app') st.purpose = '';
  }

  function useTemplate(id) {
    var t = tplById(id);
    if (!t) return;
    var cur = $('#smsBody').value.trim();
    var go = function () { setBody(t.body || '', t.title || ''); st.tplOn = t.id; $('#smsTplName').value = t.title || ''; if (st.ask) st.ask.undo = null; renderTemplates(); renderAsk(); renderPreview(); };
    if (cur && cur !== (t.body || '').trim()) {
      UI.confirmAsk('문구 불러오기', '지금 쓴 내용을 「' + (t.title || '') + '」 문구로 바꿉니다.', '바꾸기').then(function (y) { if (y) go(); });
    } else go();
  }

  /* 「이 글을 문구로 저장」 — 이름 칸이 열리고 [문구로 저장] (같은 이름이면 덮어쓸지 묻는다) */
  function saveTemplate() {
    var title = $('#smsTplName').value.trim();
    var body = $('#smsBody').value;
    if (!body.trim()) { toast('저장할 내용을 먼저 써 주세요', 'bad'); return; }
    if (!title) { toast('문구 이름을 적어 주세요', 'bad'); $('#smsTplName').focus(); return; }
    upsertTemplate(null, title, body).then(function (row) {
      if (!row) return;
      st.tplOn = row.id; renderTemplates();
      st.label = title;
      $('#smsTplSaveRow').hidden = true;
    });
  }
  /* id 가 없으면 새 문구 (같은 이름이 있으면 덮어쓸지 묻는다) */
  function upsertTemplate(id, title, body) {
    var same = st.templates.find(function (t) { return (t.title || '').trim() === title && t.id !== id; });
    var who = UI.whoami();
    var p;
    if (same && !id) {
      p = UI.confirmAsk('문구 덮어쓰기', '「' + title + '」 문구를 지금 내용으로 바꿉니다. 다른 직원에게도 바뀐 내용이 보입니다.', '바꾸기').then(function (y) {
        if (!y) return null;
        return sb().from('sms_templates').update({ body: body, updated_by: who, updated_at: new Date().toISOString() }).eq('id', same.id).select('*');
      });
    } else if (same) {
      toast('같은 이름의 문구가 이미 있습니다 — 이름을 바꿔 주세요', 'bad');
      return Promise.resolve(null);
    } else if (id) {
      p = Promise.resolve(sb().from('sms_templates').update({ title: title, body: body, updated_by: who, updated_at: new Date().toISOString() }).eq('id', id).select('*'));
    } else {
      var next = st.templates.reduce(function (a, t) { return Math.max(a, t.sort_order || 0); }, 0) + 1;
      p = Promise.resolve(sb().from('sms_templates').insert({ title: title, body: body, sort_order: next, updated_by: who }).select('*'));
    }
    return p.then(function (r) {
      if (!r) return null;
      if (r.error) { toast('문구를 저장하지 못했습니다 — ' + r.error.message, 'bad'); return null; }
      var row = r.data && r.data[0];
      return loadTemplates().then(function () { toast('「' + title + '」 문구를 저장했습니다 (직원 모두 씁니다)', 'good'); return row || null; });
    });
  }

  function deleteTemplate(id) {
    var t = tplById(id);
    if (!t) return Promise.resolve();
    return UI.confirmAsk('문구 삭제', '「' + (t.title || '') + '」 문구를 지웁니다. 다른 직원 화면에서도 사라집니다.', '삭제').then(function (y) {
      if (!y) return;
      return sb().from('sms_templates').delete().eq('id', t.id).then(function (r) {
        if (r.error) { toast('지우지 못했습니다 — ' + r.error.message, 'bad'); return; }
        if (st.tplEditing === t.id) closeTplEdit();
        return loadTemplates().then(function () { toast('「' + (t.title || '') + '」 문구를 지웠습니다'); });
      });
    });
  }

  /* 「자주 쓰는 문구」 목록 — 이름 · 첫 줄 · [고치기] [복사해서 새로 만들기] [삭제] · ⠿ 끌어서 순서 (휴대폰은 ▲ ▼) */
  function firstLine(b) { return String(b || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || ''; }
  /* ---------- 수업 전 예고 문구 (20261101l · migration-058) ----------
     네 문구를 나란히 — 이름 · 언제 가는지 · 글 · 우리 반 학생 한 명 기준 미리보기 · [고치기]
     미리보기 숫자는 예시 (실제로는 수업 3시간 전에 함수가 학생마다 앱 기록으로 센다)
       다 냄 5/5 · 일부 냄 5개 중 3개(밀린 2) · 많이 밀림 5개 중 1개(밀린 4) · 과제 없음 0 */
  var PRE = [
    { title: '수업 전 예고(다 냄)', when: '이번 주 과제를 모두 냄', done: 5, total: 5, miss: 0 },
    { title: '수업 전 예고(일부 냄)', when: '절반 이상 냄', done: 3, total: 5, miss: 2 },
    { title: '수업 전 예고(많이 밀림)', when: '절반 미만 냄', done: 1, total: 5, miss: 4 },
    { title: '수업 전 예고(과제 없음)', when: '과제가 없던 주', done: 0, total: 0, miss: 0 }
  ];
  /* SQL _pre_text2 와 같다 — {오늘수업}이 비면 둘러싼 괄호까지 뺀다 */
  function preFill(body, v) {
    var t = String(body || '');
    t = v.title ? t.split('{오늘수업}').join(v.title) : t.replace(/\s*[(\[「『<]?\{오늘수업\}[)\]」』>]?/g, '');
    t = t.replace(/  +/g, ' ').trim();
    [['{학생이름}', v.name], ['#{이름}', v.name], ['{반이름}', v.cls], ['#{반}', v.cls], ['{수업시각}', v.time], ['{밀린날짜}', v.miss], ['{제출수}', String(v.done)], ['{전체수}', String(v.total)]]
      .forEach(function (p) { t = t.split(p[0]).join(p[1] == null ? '' : p[1]); });
    return t;
  }
  /* 예시 학생 — 수업 전 문자가 켜진 반의 첫 학생 (없으면 아무 반) · 밀린 날은 지난주 평일 */
  function preSample() {
    var list = exStudents(), meta = function (s) { return (window.Store && Store.metaOf && Store.metaOf(clsOf(s))) || {}; };
    var s = list.find(function (x) { var m = meta(x); return m.pre && m.start; }) || list.find(function (x) { return meta(x).start; }) || list[0];
    var days = [], d = new Date(Date.now() + 9 * 3600000 - 7 * 86400000), W = ['일', '월', '화', '수', '목', '금', '토'];
    for (var k = 0; k < 10 && days.length < 5; k++, d = new Date(d.getTime() + 86400000)) { var w = d.getUTCDay(); if (w && w < 6) days.push((d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + W[w] + ')'); }
    return { s: s, name: s ? s.name || '' : '가나', cls: s ? clsOf(s) : '', time: (s && meta(s).start) || '18:30', days: days };
  }
  function renderPreBox() {
    var host = $('#tplPre');
    if (!host) return;
    var rows = PRE.map(function (p) { return { p: p, t: st.templates.find(function (t) { return (t.title || '').trim() === p.title; }) }; });
    if (st.missing || !rows.some(function (r) { return r.t; })) { host.hidden = true; host.innerHTML = ''; return; }
    var x = preSample();
    host.hidden = false;
    host.innerHTML = '<div class="tpl-pre__head"><b>수업 전 예고 문자</b><span class="panel__hint">수업 시작 전(기본 3시간 전) 학생 본인에게 · 이번 주 과제 제출 수에 따라 넷 중 하나 · 미리보기: ' + esc(x.name) + ' 학생' + (x.cls ? ' · ' + esc(x.cls) : '') + ' ' + esc(x.time) + ' (숫자는 예시)</span></div>' +
      '<div class="tpl-pre__grid">' + rows.map(function (r) {
        var body = r.t ? r.t.body : '';
        var pv = r.t ? preFill(body, { name: x.name, cls: x.cls, time: x.time, done: r.p.done, total: r.p.total, miss: x.days.slice(5 - r.p.miss).join(' '), title: '' }) : '';
        return '<div class="tpl-pre__card">' +
          '<div class="tpl-pre__top"><b>' + esc(r.p.title.replace('수업 전 예고', '').replace(/[()]/g, '')) + '</b><span class="tpl-pre__when">' + esc(r.p.when) + '</span></div>' +
          (r.t ? '<pre class="tpl-pre__body">' + esc(body) + '</pre><div class="tpl-pre__pv"><span class="tpl-pre__lbl">미리보기</span><pre class="sms-pv__text">' + esc(pv) + '</pre></div>' +
                 '<button class="btn btn--sm" type="button" data-pre-edit="' + esc(r.t.id) + '">고치기</button>'
               : '<p class="panel__hint">「' + esc(r.p.title) + '」 문구가 없습니다 — migration-058 SQL 을 실행해 주세요.</p>') +
        '</div>';
      }).join('') + '</div>';
  }

  function renderTplList() {
    var host = $('#tplList');
    if (!host) return;
    renderPreBox();
    if (st.missing) { host.innerHTML = '<p class="panel__hint">migration-023 SQL 을 실행하면 문구를 저장할 수 있습니다.</p>'; return; }
    host.innerHTML = st.templates.length ? '<ul class="tpl-list">' + st.templates.map(function (t, i) {
      return '<li class="tpl-row' + (st.tplEditing === t.id ? ' is-editing' : '') + '" draggable="true" data-tid="' + esc(t.id) + '">' +
          '<span class="tpl-row__grip" aria-hidden="true" title="끌어서 순서 바꾸기">⠿</span>' +
          '<div class="tpl-row__text"><b class="tpl-row__name">' + esc(t.title || '(이름 없음)') + '</b><span class="tpl-row__line">' + esc(firstLine(t.body)) + '</span></div>' +
          '<div class="tpl-row__acts">' +
            '<button class="btn btn--sm tpl-row__mv" type="button" data-tact="up" aria-label="위로"' + (i ? '' : ' disabled') + '>▲</button>' +
            '<button class="btn btn--sm tpl-row__mv" type="button" data-tact="down" aria-label="아래로"' + (i < st.templates.length - 1 ? '' : ' disabled') + '>▼</button>' +
            '<button class="btn btn--sm" type="button" data-tact="edit">고치기</button>' +
            '<button class="btn btn--sm" type="button" data-tact="copy">복사해서 새로 만들기</button>' +
            '<button class="btn btn--sm btn--danger" type="button" data-tact="del">삭제</button>' +
          '</div></li>';
    }).join('') + '</ul>' : '<p class="panel__hint">아직 저장한 문구가 없습니다. [+ 새 문구]로 만들어 주세요.</p>';
  }
  function reorder(ids) {
    var by = {};
    st.templates.forEach(function (t) { by[t.id] = t; });
    st.templates = ids.map(function (id, i) { var t = by[id]; t.sort_order = i + 1; return t; });
    renderTplList(); renderTemplates();
    return sb().rpc('sms_templates_reorder', { p_ids: ids }).then(function (r) {
      if (!r.error) { toast('문구 순서를 바꿨습니다', 'good'); return; }
      if (!isMissing(r.error)) { toast('순서를 저장하지 못했습니다 — ' + r.error.message, 'bad'); return; }
      /* 040 전 — 한 줄씩 */
      return Promise.all(ids.map(function (id, i) { return sb().from('sms_templates').update({ sort_order: i + 1 }).eq('id', id); }))
        .then(function () { toast('문구 순서를 바꿨습니다', 'good'); });
    });
  }
  function moveTpl(id, delta) {
    var ids = st.templates.map(function (t) { return t.id; });
    var i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    reorder(ids);
  }

  /* 고치기 화면 */
  function exStudents() { return sortStudents(active()); }
  function openTplEdit(id, copy) {
    var t = id ? tplById(id) : null;
    st.tplEditing = copy ? null : (t ? t.id : null);
    $('#tplEditTitle').textContent = copy ? '복사해서 새로 만들기' : t ? '「' + (t.title || '') + '」 고치기' : '새 문구';
    $('#tplTitle').value = t ? (copy ? (t.title || '') + ' (복사)' : t.title || '') : '';
    $('#tplBody').value = t ? t.body || '' : '';
    var list = exStudents();
    $('#tplExStu').innerHTML = list.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name || '') + ' · ' + esc(clsOf(s)) + '</option>'; }).join('') || '<option value="">(학생 없음)</option>';
    $('#tplEdit').hidden = false;
    if (window.AiPolish) AiPolish.reset($('#tplBody'));
    renderTplList();
    renderTplPreview();
    try { $('#tplEdit').scrollIntoView({ block: 'start' }); } catch (e) {}
    setTimeout(function () { (t ? $('#tplBody') : $('#tplTitle')).focus(); }, 30);
  }
  function closeTplEdit() { st.tplEditing = null; $('#tplEdit').hidden = true; renderTplList(); }
  function renderTplPreview() {
    var body = $('#tplBody').value;
    var s = active().find(function (x) { return x.id === $('#tplExStu').value; }) || exStudents()[0];
    if (!s) { $('#tplPreview').textContent = body; $('#tplLen').textContent = ''; return; }
    var lessons = {}; lessons[(s.className || '').trim()] = lessonText(clsOf(s));
    var code = st.codes[clsOf(s)] || 'MARA2026';
    var txt = render(body, s, 'parent1', lessons, { code: code });
    var b = bytes(txt);
    $('#tplPreview').textContent = txt || '(내용을 쓰면 여기에 보입니다)';
    $('#tplLen').textContent = body ? (b <= 90 ? '단문' : '장문') + ' ' + b + '바이트 · ' + esc(s.name || '') + ' 학부모에게 가는 글' + (hasCode(body) ? ' · 입장코드 ' + code + (st.codes[clsOf(s)] ? '' : '(예시)') : '') + (hasApp(body) && !appLinks() ? ' · 앱 설치 링크가 아직 없습니다 (연결 상태)' : '') : '';
  }
  function saveTplEdit() {
    var title = $('#tplTitle').value.trim(), body = $('#tplBody').value;
    if (!title) { toast('문구 이름을 적어 주세요', 'bad'); $('#tplTitle').focus(); return; }
    if (!body.trim()) { toast('내용을 써 주세요', 'bad'); $('#tplBody').focus(); return; }
    upsertTemplate(st.tplEditing, title, body).then(function (row) { if (row) closeTplEdit(); });
  }

  /* ---------- AI에게 부탁하기 (20261101i · text-polish 'revise' · 새 키 없음) ----------
     내용 칸이 비어 있으면 — 부탁 글을 메모로 넘기고 그 메모대로 문자를 새로 써 달라고 한다
     내용이 있으면 — 그 글을 부탁대로 고친다 (「더 짧게」 「학부모용으로」)
     결과는 바로 내용 칸에 · [되돌리기] · 「확인할 것」 2개까지. Claude 에는 글만 간다 (학생 이름 · 번호는 보내지 않는다) */
  var ASK_NEW = '지금 글은 선생님이 쓴 부탁 메모다. 메모대로 학부모 · 학생에게 보낼 문자 한 통을 정중하고 짧게 완성해서, 지금 글을 그 문자로 바꿔 줘. 메모에 없는 사실은 넣지 마.';
  function askState() { return st.ask || (st.ask = { busy: false, undo: null, check: [], msg: '' }); }
  function renderAsk() {
    var a = askState(), go = $('#smsAskGo'), req = $('#smsAsk').value.trim();
    go.disabled = a.busy || req.length < 2 || st.done;
    go.textContent = a.busy ? '쓰는 중…' : '써 줘';
    $('#smsAskMsg').hidden = !a.msg;
    $('#smsAskMsg').textContent = a.msg || '';
    var d = $('#smsAskDone');
    d.hidden = a.undo == null;
    d.innerHTML = a.undo == null ? '' : '<span>AI가 쓴 글을 내용 칸에 넣었습니다. 날짜 · 시간 · 숫자 · 이름을 한 번 더 확인해 주세요.</span> <button type="button" class="btn btn--sm btn--ghost" id="smsAskUndo">되돌리기</button>' +
      (a.check && a.check.length ? '<ul class="sms-ask__check">' + a.check.slice(0, 2).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
    $('#smsAskLeft').textContent = a.left == null ? '' : '이번 달 ' + a.left + '회 남음';
  }
  function askRun() {
    var a = askState(), req = $('#smsAsk').value.replace(/\s+/g, ' ').trim(), cur = $('#smsBody').value;
    if (a.busy || req.length < 2) return;
    var fns = SB.client && SB.client.functions;
    if (!fns || !fns.invoke) return;
    a.busy = true; a.msg = ''; renderAsk();
    var body = cur.trim()
      ? { action: 'revise', kind: 'sms', text: cur, request: req }
      : { action: 'revise', kind: 'sms', text: req, request: ASK_NEW };
    Promise.resolve(fns.invoke('text-polish', { body: body })).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      return ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null;
    }).catch(function () { return null; }).then(function (res) {
      a.busy = false;
      if (res && res.cap != null && res.used != null) a.left = Math.max(0, res.cap - res.used);
      if (window.AiPolish) AiPolish.loadLeft();          /* 문구 고치기 칸의 「이번 달 n회 남음」도 같이 */
      if (!res || !res.ok || typeof res.text !== 'string') {
        a.msg = res && res.reason === 'input' && res.message ? res.message : window.AiPolish ? AiPolish.FAIL : '지금은 AI가 쓸 수 없습니다. 잠시 뒤 다시 눌러 주세요.';
        renderAsk(); return;
      }
      a.undo = cur; a.check = res.check || [];
      $('#smsBody').value = res.text;
      st.tplOn = ''; renderTemplates();
      $('#smsAsk').value = '';
      renderAsk(); renderPreview();
    });
  }
  /* 이번 달 남은 횟수 (AI로 다듬기와 같이 센다 · migration-026) */
  function askLeft() {
    if (!sb() || !sb().rpc) return;
    Promise.resolve(sb().rpc('polish_status')).then(function (r) {
      if (r && !r.error && r.data) { askState().left = Math.max(0, (r.data.cap || 0) - (r.data.used || 0)); renderAsk(); }
    }, function () {});
  }
  function askUndo() {
    var a = askState();
    if (a.undo == null) return;
    $('#smsBody').value = a.undo; a.undo = null; a.check = [];
    renderAsk(); renderPreview();
  }

  /* ---------- 열기 ---------- */

  /* 보내는 번호 — 솔라피에 등록된 발신번호 (서버 Secrets 의 SOLAPI_SENDER 를 sms-send 함수가 읽어 번호만 준다 · 20261031e) */
  function loadSender() {
    var el = $('#smsFrom');
    if (st.sender) { el.textContent = '보내는 번호: ' + st.sender; return Promise.resolve(); }
    el.textContent = '보내는 번호: 확인 중…';
    return invoke({ action: 'status' }).then(function (r) {
      st.smsStatus = r || null;
      var n = r && r.ok && r.sender ? String(r.sender) : '';
      if (!n) { el.textContent = '보내는 번호: ' + (r && r.ok ? '발신번호가 아직 없습니다 (연결 상태)' : '확인하지 못했습니다 (연결 상태)'); return; }
      st.sender = Store.phoneFormat ? Store.phoneFormat(n) : n;
      el.textContent = '보내는 번호: ' + st.sender;
    });
  }
  /* 카톡 알림톡 상태 — 함수는 Secrets 가 있는지만 true/false 로 (값은 돌려주지 않는다) */
  function loadKakao() {
    return invoke({ action: 'health' }, KFN).then(function (r) {
      if (r && r.ok && r.keys) {
        var miss = Object.keys(r.keys).filter(function (k) { return !r.keys[k]; });
        st.kk = { ok: true, ready: !miss.length, keys: r.keys, missing: miss };
      } else st.kk = { ok: false, ready: false, message: (r && r.message) || '' };
      return st.kk;
    });
  }

  function loadCfg() {
    return sb().rpc('sms_settings_get').then(function (r) {
      if (r.error) { st.cfg = null; st.missing = isMissing(r.error); if (!st.missing) toast('문자 설정을 불러오지 못했습니다 — ' + r.error.message, 'bad'); return; }
      st.cfg = Object.assign({}, DEF, r.data || {});
      st.missing = false;
      setMyPhone(st.cfg.testPhone || '');
    }, function () { st.cfg = null; });
  }
  /* 반 「앱 입장코드」 (classes.app_code · migration-040) — 아직 없으면 빈 칸 */
  function loadCodes() {
    return sb().from('classes').select('name,app_code').then(function (r) {
      st.codes = {};
      st.noCodeCol = !!r.error;
      if (r.error) return;
      (r.data || []).forEach(function (c) { if (c.app_code) st.codes[c.name] = c.app_code; });
    }, function () { st.codes = {}; });
  }

  /* 「10/22(목) 수업」 — 연 주의 수업일 (반이 여럿이고 날이 다르면 「10/20~10/22 수업」) · 주 시작일은 쓰지 않는다 */
  function weekLesson() {
    if (!st.week) return '';
    var ds = [];
    Object.keys(st.classes).concat(pickedStudents().map(clsOf)).forEach(function (c) {
      var L = c !== NOCLS ? Store.lessonOf(c, st.week) : null;
      if (L && L.date && !L.canceled && ds.indexOf(L.date) === -1) ds.push(L.date);
    });
    ds.sort();
    if (ds.length === 1) return Store.dateWithDow(ds[0]) + ' 수업';
    if (ds.length > 1) return Store.shortDate(ds[0]) + '~' + Store.shortDate(ds[ds.length - 1]) + ' 수업';
    return Store.shortDate(st.week) + '~' + Store.shortDate(Lesson.addDays(st.week, 6)) + ' 수업';
  }

  /* 그 주 레포트를 이미 보낸 학생 — 「이미 보냄 18:09」 · 처음부터 체크를 꺼 둔다 */
  function loadPrev() {
    if (!st.week || !window.DB || !DB.weekSendData) return Promise.resolve();
    return DB.weekSendData(st.week).then(function (x) {
      st.prev = {};
      Object.keys(x.sent || {}).forEach(function (id) { st.prev[id] = x.sent[id].at; st.off[id] = true; });
    }, function () {});
  }

  /* ---------- 안쪽 작은 탭 ---------- */
  function showPane(name) {
    st.pane = name;
    ['send', 'tpl', 'log', 'conn'].forEach(function (p) {
      var el = $('#smsPane' + p.charAt(0).toUpperCase() + p.slice(1));
      if (el) el.hidden = p !== name;
    });
    $$('[data-smspane]').forEach(function (b) { var on = b.dataset.smspane === name; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    if (name === 'send' && !st.started) setTimeout(firstShow, 0);
    if (name === 'tpl') { if (!st.templates.length) loadTemplates(); else renderTplList(); }
    if (name === 'log') openLog();
    if (name === 'conn') loadConn();
  }
  function goTab() {
    var cur = (window.RTabs && RTabs.current) ? RTabs.current() : -1;
    if (cur !== TAB) UI.selectTab(TAB);
  }

  /* opts — { classes: [반], students: [학생 id], week: '주 시작일', from: 'send' | 'today' | 'roster' | 'card' | 'notify' | 'invite',
              single, to: 'student' | 'parent' | 'both', body, template: '문구 이름', entry: '입장코드', purpose: 'app', confirm }
     받는 사람 — opts.to 가 먼저 · 레포트 안내(3 발송 · 바뀐 내용 알리기)는 예전처럼 둘 다 · 그 밖은 학생 (20261101i) */
  function open(opts) {
    opts = opts || {};
    st.started = true;
    var ids = (opts.students || []).filter(Boolean);
    st.classes = {}; st.extra = {}; st.find = '';
    (opts.classes || []).forEach(function (c) { if (c) st.classes[c] = true; });
    ids.forEach(function (id) { st.extra[id] = true; });
    st.week = opts.week || '';
    st.from = opts.from || '';
    st.failed = [];
    st.busy = false;
    st.off = {}; st.prev = {}; st.res = null; st.done = false;
    st.label = ''; st.purpose = opts.purpose || ''; st.viaTouched = false; st.tplOn = '';
    st.ask = null;
    /* 「바뀐 내용 알리기」 (publish.js) — 학생마다 바뀐 내용 · 문구 기본값 · 보냄 표시는 하지 않고 알림 횟수만 (20261030e) */
    st.notify = opts.notify || null;
    st.to = opts.to === 'parent' || opts.to === 'both' || opts.to === 'student' ? opts.to
      : st.notify || st.from === 'send' ? 'both' : 'student';
    $('#smsTitle').textContent = st.notify ? '바뀐 내용 알리기' : st.purpose === 'app' ? '앱 안내 문자' : '문자 보내기';
    $('#smsVarChange').hidden = !st.notify;
    $('#smsBody').value = opts.body || '';
    $('#smsEntry').value = opts.entry || '';
    $('#smsAsk').value = '';
    $('#smsTplSaveRow').hidden = true;
    $('#smsTplName').value = '';
    $('#smsViaSms').checked = true;
    $('#smsViaSec').hidden = true;
    $('#smsFind').value = '';
    $('#smsResult').innerHTML = '';
    banner('', '');
    $('#smsAd').checked = false;
    var mark = st.from === 'send' && !!st.week;
    $('#smsMarkLine').hidden = !mark;
    $('#smsMark').checked = mark;
    var wl = weekLesson();
    $('#smsMarkHint').textContent = mark ? wl + ' 레포트 — 공개된 학생 · 학부모 번호로 보낸 문자만' : '';
    $('#smsLessonHint').textContent = st.week ? wl + ' (휴강이면 다음 수업일)' : '다음 수업일 (휴강 주는 건너뜀)';
    /* 「← 돌아가기」 — 다른 화면에서 열었으면 그 화면으로 */
    var cur = window.RTabs && RTabs.current ? RTabs.current() : -1;
    if (st.from) st.back = cur !== TAB ? cur : st.back; else st.back = -1;
    $('#smsClose').hidden = !(st.from && st.back >= 0);
    renderTemplates();
    renderAsk();
    askLeft();
    renderPreview();
    goTab();
    showPane('send');
    try { window.scrollTo(0, 0); } catch (e) {}
    loadSender();
    return Promise.all([loadCfg(), loadTemplates(), loadCodes(), loadKakao(), st.notify ? null : loadPrev(), st.notify ? null : loadPub()]).then(function () {
      $('#smsMissing').hidden = !st.missing;
      $('#smsMissing').textContent = st.missing ? 'migration-023 SQL 을 실행하고 Edge Function sms-send 를 배포하면 사이트에서 문자를 보낼 수 있습니다.' : '';
      /* 문구 이름으로 열기 (앱 안내) — 문구가 지워졌으면 기본 글 */
      if (opts.template && !$('#smsBody').value.trim()) {
        var tt = tplByTitle(opts.template);
        setBody(tt ? tt.body : (opts.template === APP_TPL ? APP_BODY : ''), opts.template);
        if (tt) st.tplOn = tt.id;
      }
      /* 레포트 발송 → 3 발송에서 열었고 내용이 비어 있으면 「레포트 안내」 문구로 */
      if (st.from === 'send' && !$('#smsBody').value.trim()) {
        var t = st.templates.find(function (x) { return /레포트/.test(x.title || ''); });
        if (t) { setBody(t.body || '', t.title || ''); $('#smsTplName').value = t.title || ''; st.tplOn = t.id; }
      }
      if (!st.label && opts.body) st.label = opts.label || '';
      renderTemplates();
      renderPreview();
      /* 등록하면서 앱 안내를 골랐으면 — 받는 사람 · 번호 뒤 4자리 · 실제 문구 확인을 바로 띄운다 ([보내기]를 눌러야 나간다) */
      if (opts.confirm && plan && plan.items.length && !adBlock()) send(null);
    });
  }
  /* 「문자 발송」 탭을 직접 눌렀을 때 — 처음이면 빈 「보내기」 (연결 상태 · 보낸 기록으로 바로 왔으면 「보내기」를 누를 때) */
  function firstShow() {
    if (st.started || st.pane !== 'send') return;
    open({});
  }

  /* ---------- 보내기 ---------- */

  function varsFor(items) {
    var body = $('#smsBody').value, v = {};
    var code = hasCode(body), first = body.indexOf('{첫수업일}') !== -1;
    if (!code && !first) return v;
    items.forEach(function (x) {
      var o = {}, c = code ? entryOf(x.s) : '', f = first ? firstOf(x.s) : '';
      if (c) o.code = c;
      if (f) o.first = f;
      if (c || f) v[x.s.id] = o;
    });
    return v;
  }
  function payload(items) {
    var body = $('#smsBody').value;
    return {
      items: items.map(function (x) { return { student_id: x.s.id, to: x.t }; }),
      body: body,
      ad: $('#smsAd').checked,
      lessons: plan ? plan.lessons : {},
      siblings: !!($('#smsSib') && $('#smsSib').checked),
      markWeek: !$('#smsMarkLine').hidden && $('#smsMark').checked ? st.week : '',
      label: (st.label || '').slice(0, 60),
      purpose: st.notify ? 'notify' : st.purpose || (isReportBody() ? 'report' : ''),
      vars: varsFor(items)
    };
  }

  /* 맨 위 띠 — 보낸 결과 · 시험 발송 · 시험 번호 없음 (작은 알림만으로는 놓치기 쉬워 맨 위에 크게 · 20261030b) */
  function banner(kind, html) {
    var b = $('#smsBanner');
    b.className = 'sms-banner sms-banner--' + kind;
    b.innerHTML = html;
    b.hidden = !html;
    if (html && b.scrollIntoView) { try { b.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { b.scrollIntoView(); } }
  }

  /* 보내기 전 확인 — 몇 건 안 되거나 앱 안내면 받는 사람 · 번호 뒤 4자리 · 실제 문구까지 */
  function detailLines(items) {
    var many = items.length > 30;
    return items.slice(0, 30).map(function (x) {
      return '· ' + (x.s.name || '') + ' — ' + labelOf(x.s, x.t) + ' …' + x.d.slice(-4) + '\n' + x.text;
    }).join('\n\n') + (many ? '\n\n… 외 ' + (items.length - 30) + '건 (아래 표에서 모두 볼 수 있습니다)' : '');
  }

  function detailText(items) { return items.length ? '\n\n' + detailLines(items) : ''; }

  /* 확인 창 첫 줄 — 「목동반 학생 11명에게 보냅니다」 */
  function leadOf(p) {
    var cs = [];
    p.items.forEach(function (x) { var c = clsOf(x.s); if (cs.indexOf(c) === -1) cs.push(c); });
    var where = cs.length > 3 ? cs.slice(0, 2).join(' · ') + ' 외 ' + (cs.length - 2) + '개 반' : cs.join(' · ');
    var one = p.people === 1 && p.items[0] ? p.items[0].s.name + ' ' : '';
    return (one ? where + ' ' + one + toWord() + '에게 보냅니다' : where + ' ' + toWord() + ' ' + p.people + '명에게 보냅니다').replace(/^ +/, '');
  }
  function send(retryList, again) {
    var body = $('#smsBody').value;
    var list = retryList || listFromPicks();
    var sibOn = !!($('#smsSib') && $('#smsSib').checked);
    var p = retryList ? build(retryList, body, true) : (plan = build(list, body, sibOn));
    var block = adBlock();
    if (block) { toast(block, 'bad'); return; }
    if (!body.trim()) { toast('내용을 적어 주세요', 'bad'); return; }
    if (!p.items.length) { toast('보낼 수 있는 번호가 없습니다', 'bad'); return; }
    if (p.items.length > cfg().perSend) { toast('한 번에 ' + cfg().perSend + '건까지 보낼 수 있습니다. 반을 나눠 보내 주세요', 'bad'); return; }
    var kk = !retryList && viaKakao();
    var prevN = p.items.filter(function (x) { return st.prev[x.s.id]; }).map(function (x) { return x.s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length;
    var kkN = kk ? p.items.filter(function (x) { return x.t !== 'student'; }).map(function (x) { return x.s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length : 0;
    var copy = !retryList && p.people > 1 && copyOn();
    var lead = retryList || again ? '' : leadOf(p);
    var desc = (lead ? lead + '. ' : '') + p.people + '명 · 문자 ' + p.items.length + '건' + (copy ? ' + 내 번호 1통' : '') + ' (단문 ' + p.sms + ' · 장문 ' + p.lms + ') · 예상 약 ' + p.won.toLocaleString() + '원을 보냅니다.' +
      (copy ? ' 맨 위 ' + p.items[0].s.name + ' 학생에게 가는 내용 그대로 내 번호(' + me.phone + ')로도 한 통 갑니다 (보냄 표시에는 세지 않음).' : '') +
      (kk ? ' 학부모 ' + kkN + '명은 카톡 알림톡(「' + KK_TEMPLATE + '」 템플릿)으로 — 카톡을 안 받으면 문자로 대신 갑니다.' : '') +
      (again ? ' 방금 보낸 사람에게 한 번 더 보냅니다.' : '') +
      (prevN ? ' 이 레포트를 이미 보낸 학생 ' + prevN + '명에게도 다시 보냅니다.' : '') +
      ($('#smsAd').checked ? ' 광고 문자입니다 — (광고) · 발신처 · 무료수신거부 안내가 붙습니다.' : '') +
      (!retryList && p.sib.length ? (sibOn ? ' 같은 번호를 쓰는 형제 ' + p.sib.length + '명에게도 따로 보냅니다.' : ' 같은 번호를 쓰는 형제 ' + p.sib.length + '명은 번호마다 한 번만 보냅니다.') : '') +
      (payload(p.items).markWeek ? ' 보낸 학생은 레포트 발송 → 3 발송에 「보냄」으로 표시합니다.' : '') +
      (st.notify ? ' 바뀐 내용 알림입니다 — 3 발송의 「보냄」은 그대로 두고 「알림 n회」만 늘어납니다.' : '') +
      (st.purpose === 'app' ? ' 보내면 상담 카드에 「앱 안내 문자 보냄」이 남습니다.' : '') +
      (p.left.length ? ' ⚠ 바뀌지 않은 칸이 있어 ' + p.left.map(function (x) { return x.s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length + '명에게는 보내지 않습니다 (' + p.left.map(function (x) { return x.left.join(' '); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ').' : '') +
      ' 오늘 ' + ((st.cfg && st.cfg.today) || 0) + ' / ' + cfg().dailyMax + '건.' +
      detailText(st.purpose === 'app' || p.items.length <= 5 ? (kk ? p.items.filter(function (x) { return x.t === 'student'; }) : p.items) : []);
    UI.confirmAsk(retryList ? '실패만 다시 보내기' : again ? '다시 보내기' : lead || '문자 보내기', desc, '보내기').then(function (yes) {
      if (!yes) return;
      st.busy = true; updateButtons();
      var pl = payload(p.items);
      if (retryList) pl.siblings = true;           /* 다시 보내기는 실패한 줄 그대로 */
      var go = st.notify ? sendNotify(pl, p.items) : kk ? sendKakao(pl, p.items) : hasMiss(pl.body) ? sendMiss(pl, p.items) : invoke(Object.assign({ action: 'send' }, pl));
      go.then(function (res) {
        st.busy = false;
        /* 바뀌지 않은 칸이 남아 보내지 않은 사람 — 실패로 (20261101m) */
        if (res && res.ok && p.left.length) {
          res.failed = (res.failed || 0) + p.left.length;
          res.results = (res.results || []).concat(p.left.map(function (x) { return { student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: leftMsg(x.left) }; }));
        }
        showResult(res, !!retryList);
        if (copy && res && res.ok) sendCopy(pl, p.items[0], kk);
        if (st.notify) recordNotify(res);
        if (st.purpose === 'app') recordInvite(res);
        loadCfg().then(renderPreview);
        if (pl.markWeek && window.SendView) SendView.refresh();
        if (pl.markWeek || kk) window.dispatchEvent(new CustomEvent('jt:remote', { detail: { table: 'sent' } }));
      });
    });
  }

  /* 카톡 — 학부모는 kakao-send(레포트 템플릿 · 안 받으면 문자로) · 학생 본인 번호는 문자로. 결과는 한 모양으로 모은다 */
  function sendKakao(pl, items) {
    var par = items.filter(function (x) { return x.t !== 'student'; });
    var stu = items.filter(function (x) { return x.t === 'student'; });
    var ids = par.map(function (x) { return x.s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var all = { ok: true, sent: 0, failed: 0, results: [], skipped: [] };
    var chunks = [];
    for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    var resend = ids.some(function (id) { return st.prev[id]; });
    return chunks.reduce(function (pr, c) {
      return pr.then(function () {
        if (!all.ok) return null;
        return invoke({ action: 'send', week: st.week, students: c, resend: resend, fallback: true }, KFN).then(function (r) {
          if (!r || !r.ok) { all = r || { ok: false, message: '알림톡을 보내지 못했습니다.' }; return; }
          all.sent += r.sent || 0; all.failed += r.failed || 0;
          (r.results || []).forEach(function (x) {
            par.filter(function (y) { return y.s.id === x.student_id; }).forEach(function (y) {
              all.results.push({ student_id: x.student_id, to: y.t, name: y.s.name, ok: x.ok, error: x.error || '', via: 'kakao' });
            });
          });
          (r.skipped || []).forEach(function (x) { all.skipped.push({ student_id: x.id, name: x.name, to: 'parent1', reason: x.reason, label: x.label }); });
        });
      });
    }, Promise.resolve()).then(function () {
      if (!all.ok || !stu.length) return all;
      return invoke(Object.assign({ action: 'send' }, pl, { items: stu.map(function (x) { return { student_id: x.s.id, to: x.t }; }), vars: varsFor(stu) })).then(function (r) {
        if (!r || !r.ok) { all.results = all.results.concat(stu.map(function (x) { return { student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: (r && r.message) || '보내지 못함' }; })); return all; }
        all.sent += r.sent || 0; all.failed += r.failed || 0;
        all.results = all.results.concat(r.results || []); all.skipped = all.skipped.concat(r.skipped || []);
        return all;
      });
    });
  }

  /* {밀린날짜} — 학생마다 달라서 같은 날짜끼리 묶어 채운 글로 보낸다 (20261101m · 함수는 그대로) */
  function sendMiss(pl, items) {
    var groups = {}, order = [];
    items.forEach(function (x) {
      var k = missFor(x.s);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(x);
    });
    var all = { ok: true, sent: 0, failed: 0, results: [], skipped: [] };
    return order.reduce(function (p, k) {
      return p.then(function () {
        if (!all.ok) return null;
        var g = groups[k];
        return invoke(Object.assign({ action: 'send' }, pl, { items: g.map(function (x) { return { student_id: x.s.id, to: x.t }; }), body: pl.body.split('{밀린날짜}').join(k), vars: varsFor(g) })).then(function (r) {
          if (!r || !r.ok) { all = r || { ok: false, message: '보내지 못했습니다.' }; return; }
          all.sent += r.sent || 0; all.failed += r.failed || 0;
          all.results = all.results.concat(r.results || []); all.skipped = all.skipped.concat(r.skipped || []);
        });
      });
    }, Promise.resolve()).then(function () { return all; });
  }

  /* 「바뀐 내용 알리기」 — #{바뀐 내용}은 학생마다 달라서 바뀐 내용이 같은 학생끼리 묶어 한 번씩 보낸다 (함수는 그대로) */
  function sendNotify(pl, items) {
    var body = pl.body, groups = {}, order = [];
    items.forEach(function (x) {
      var k = String(st.notify[x.s.id] || '내용');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push({ student_id: x.s.id, to: x.t });
    });
    var all = { ok: true, sent: 0, failed: 0, results: [], skipped: [] };
    return order.reduce(function (p, k) {
      return p.then(function () {
        if (!all.ok) return null;
        return invoke(Object.assign({ action: 'send' }, pl, { items: groups[k], body: body.split('#{바뀐 내용}').join(k), markWeek: '', label: pl.label || '바뀐 내용 알리기' })).then(function (r) {
          if (!r || !r.ok) { all = r || { ok: false, message: '보내지 못했습니다.' }; return; }
          all.sent += r.sent || 0; all.failed += r.failed || 0;
          all.results = all.results.concat(r.results || []); all.skipped = all.skipped.concat(r.skipped || []);
        });
      });
    }, Promise.resolve()).then(function () { return all; });
  }
  /* 알림 횟수 · 마지막 시각 — 3 발송 표에 「알림 2회 · 마지막 10/24 10:12」 (migration-032 report_notified) */
  function recordNotify(res) {
    if (!res || !res.ok || !st.week) return;
    var ids = [];
    (res.results || []).forEach(function (x) { if (x.ok && ids.indexOf(x.student_id) === -1) ids.push(x.student_id); });
    if (!ids.length) return;
    sb().rpc('report_notified', { p_week: st.week, p_ids: ids }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? '알림 횟수를 남기려면 migration-032 SQL 을 실행해 주세요' : '알림 횟수를 남기지 못했습니다 — ' + r.error.message, 'bad'); return; }
      if (window.SendView) SendView.refresh();
      window.dispatchEvent(new CustomEvent('jt:remote', { detail: { table: 'sent' } }));
    });
  }
  /* 앱 안내 — 보낸 학생 상담 카드에 「10/29 앱 안내 문자 보냄」 */
  function todayKST() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function recordInvite(res) {
    if (!res || !res.ok) return Promise.resolve();
    var ids = [];
    (res.results || []).forEach(function (x) { if (x.ok && ids.indexOf(x.student_id) === -1) ids.push(x.student_id); });
    if (!ids.length) return Promise.resolve();
    var d = todayKST(), md = (+d.slice(5, 7)) + '/' + (+d.slice(8, 10));
    return Promise.resolve(sb().from('student_notes').insert(ids.map(function (id) {
      return { student_id: id, note_date: d, categories: ['기타'], body: md + ' 앱 안내 문자 보냄' };
    }))).then(function (r) {
      if (r && r.error) { toast('상담 카드에 남기지 못했습니다 — ' + r.error.message, 'bad'); return; }
      window.dispatchEvent(new CustomEvent('jt:remote', { detail: { table: 'student_notes' } }));
    }, function () {});
  }

  var TO_LABEL = { parent1: '학부모', parent2: '학부모', parent: '학부모', student: '학생 본인', test: '내 번호 확인용' };

  function showResult(res, isRetry) {
    var host = $('#smsResult');
    host.innerHTML = '';
    if (!res || !res.ok) {
      var m = (res && res.message) || '보내지 못했습니다.';
      banner('bad', '<b>보내지 못했습니다</b> · ' + esc(m));
      updateButtons();
      return;
    }
    var now = new Date().toISOString();
    if (!st.res || !isRetry) st.res = { at: now, by: {} };
    else st.res.at = now;
    (res.results || []).forEach(function (x) { st.res.by[key(x.student_id, x.to)] = { ok: x.ok, error: x.error || '', via: x.via || 'sms' }; });
    var all = Object.keys(st.res.by).map(function (k) { return st.res.by[k]; });
    var okN = all.filter(function (x) { return x.ok; }).length, bad = all.length - okN;
    st.failed = Object.keys(st.res.by).filter(function (k) { return !st.res.by[k].ok && st.res.by[k].via !== 'kakao'; }).map(function (k) { var a = k.split('|'); return { student_id: a[0], to: a[1] }; });
    st.done = true;
    var sk = (res.skipped || []).filter(function (x) { return x.reason !== 'sibling'; });
    var badNames = [];
    (res.results || []).forEach(function (x) { if (!x.ok && x.name && badNames.indexOf(x.name) === -1) badNames.push(x.name); });
    if (bad) {
      banner('bad', '<b>보냄 ' + okN + ' · 실패 ' + bad + (badNames.length ? '(' + esc(badNames.slice(0, 8).join(', ')) + ')' : '') + '</b>' + (st.failed.length ? ' <button class="btn btn--sm btn--primary" type="button" id="smsRetry">실패만 다시 보내기</button>' : '') +
        '<span class="sms-banner__sub">' + esc(mdhm(now)) + ' · 실패한 칸은 아래 표에 빨간 글씨로 사유가 있습니다</span>');
    } else {
      banner('ok', '<b>✓ 보냄 ' + okN + ' · 실패 0</b> <span class="num">' + esc(mdhm(now)) + '</span><span class="sms-banner__sub">솔라피가 받은 결과입니다. 실제 도착은 솔라피 발송 내역에서 봅니다 · 「보낸 기록」에도 남았습니다.</span>');
    }
    if (sk.length) host.innerHTML = '<p class="panel__hint">건너뜀: ' + esc(sk.slice(0, 20).map(function (x) { return (x.name || '') + ' ' + (TO_LABEL[x.to] || '') + '(' + (x.label || x.reason) + ')'; }).join(', ')) + '</p>';
    toast('문자 ' + okN + '건 접수' + (bad ? ' · 실패 ' + bad + '건' : ''), bad ? 'bad' : 'good');
    renderPick();
    updateButtons();
  }

  function retry() {
    var by = {};
    active().forEach(function (s) { by[s.id] = s; });
    var list = st.failed.map(function (x) { return by[x.student_id] ? { s: by[x.student_id], t: x.to } : null; }).filter(Boolean);
    if (!list.length) { toast('다시 보낼 줄이 없습니다', 'bad'); return; }
    send(list);
  }

  /* 같은 사람에게 다시 — 따로 눌러 확인을 받는다 */
  function resend() {
    st.done = false; st.res = null; st.failed = [];
    banner('', '');
    renderPreview();
    send(null, true);
  }

  /* 「연결 상태」 열기 (예전 「오늘」 → [설정]의 알림톡 · 문자 칸) */
  function openSettings() { goTab(); showPane('conn'); }

  function testSend() {
    var body = $('#smsBody').value;
    if (!plan || !plan.items.length || !body.trim()) { banner('warn', '받는 사람과 내용을 먼저 정해 주세요'); return; }
    var block = adBlock();
    if (block) { banner('warn', esc(block)); return; }
    /* 내 시험 번호가 없으면 서버까지 가지 않고 바로 알려 준다 */
    if (st.cfg && !st.cfg.testPhone) {
      banner('warn', '<b>연결 상태에 내 시험 번호를 먼저 넣어 주세요</b> <button class="btn btn--sm" type="button" id="smsOpenSet">연결 상태 열기</button>');
      return;
    }
    st.busy = true; updateButtons();
    var pl = payload(plan.items.slice(0, 20));
    pl.markWeek = '';
    invoke(Object.assign({ action: 'test' }, pl)).then(function (res) {
      st.busy = false;
      updateButtons();
      if (!res || !res.ok) {
        if (res && res.reason === 'notest') { banner('warn', '<b>연결 상태에 내 시험 번호를 먼저 넣어 주세요</b> <button class="btn btn--sm" type="button" id="smsOpenSet">연결 상태 열기</button>'); return; }
        banner('bad', '<b>시험 발송을 하지 못했습니다</b> · ' + esc((res && res.message) || ''));
        return;
      }
      var r0 = (res.results || [])[0];
      if (res.sent) banner('ok', '<b>✓ 내 번호로 시험 문자를 보냈습니다</b><span class="sms-banner__sub">' + esc((r0 && r0.name ? r0.name + ' 내용' : '첫 사람 내용') + ' · ' + mdhm()) + (st.cfg && st.cfg.testPhone ? ' · ' + esc(st.cfg.testPhone) : '') + '</span>');
      else banner('bad', '<b>시험 발송이 실패했습니다</b>' + (r0 && r0.error ? ' · ' + esc(r0.error) : ''));
      loadCfg().then(renderPreview);
    });
  }

  /* ============================================================
     보낸 기록 — 묶음 한 줄 「10/29 15:30 · 고2 선수능반 레포트 안내 · 22건 · 성공 22」 · 누르면 받는 사람 표 · [실패만 다시 보내기]
     ============================================================ */

  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var logReady = false;
  function openLog(opts) {
    opts = opts || {};
    if (!logReady || opts.cls != null || opts.student != null) {
      var cs = classNames().filter(function (n) { return n !== NOCLS; });
      $('#smsLogClass').innerHTML = '<option value="">전체 반</option>' + cs.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
      $('#smsLogStudent').innerHTML = '<option value="">전체 학생</option>' + sortStudents(UI.getStudents ? UI.getStudents() : active()).map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.name || '') + ' · ' + esc(clsOf(s)) + (s.archived ? ' (퇴원)' : '') + '</option>';
      }).join('');
      $('#smsLogClass').value = opts.cls || '';
      $('#smsLogStudent').value = opts.student || '';
      var now = new Date(), from = new Date(now.getTime() - 13 * 86400000);
      $('#smsLogFrom').value = isoDay(from);
      $('#smsLogTo').value = isoDay(now);
      logReady = true;
    }
    if (st.pane !== 'log') { goTab(); showPane('log'); return; }
    $('#smsLogDetail').hidden = true;
    findLog();
  }
  function fmtAt(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function logArgs() {
    return { p_class: $('#smsLogClass').value || null, p_student: $('#smsLogStudent').value || null, p_from: $('#smsLogFrom').value || null, p_to: $('#smsLogTo').value || null };
  }
  var batches = [];
  function findLog() {
    var host = $('#smsLogList');
    host.innerHTML = '<p class="panel__hint">찾는 중…</p>';
    $('#smsLogDetail').hidden = true;
    sb().rpc('sms_batch_list', Object.assign(logArgs(), { p_limit: 200 })).then(function (r) {
      if (r.error && isMissing(r.error)) return findLogFlat(host);
      if (r.error) { host.innerHTML = '<p class="cp-warn">' + esc(r.error.message) + '</p>'; return; }
      batches = r.data || [];
      if (!batches.length) { host.innerHTML = '<p class="panel__hint">이 조건으로 보낸 문자가 없습니다.</p>'; return; }
      host.innerHTML = '<p class="sms-sum">' + batches.length + '번 보냄 · ' + batches.reduce(function (a, x) { return a + x.n; }, 0) + '건 · 성공 ' + batches.reduce(function (a, x) { return a + x.ok; }, 0) + ' · 실패 ' + batches.reduce(function (a, x) { return a + x.fail; }, 0) + '</p>' +
        '<ul class="sms-batches">' + batches.map(function (x, i) {
          var name = x.label || firstLine(x.body).slice(0, 24) || '(이름 없음)';
          var cls = (x.classes || []).slice(0, 3).join(', ') + ((x.classes || []).length > 3 ? ' 외 ' + ((x.classes || []).length - 3) : '');
          return '<li><button type="button" class="sms-batch' + (x.fail ? ' has-fail' : '') + '" data-batch="' + i + '">' +
              '<span class="sms-batch__main"><span class="num">' + esc(fmtAt(x.at)) + '</span> · ' + (cls ? esc(cls) + ' ' : '') + esc(name) + ' · <span class="num">' + x.n + '</span>건 · 성공 <span class="num">' + x.ok + '</span>' + (x.fail ? ' · <b class="sms-batch__bad">실패 ' + x.fail + '</b>' : '') + '</span>' +
              '<span class="sms-batch__sub muted-note">' + (x.via === 'kakao' ? '알림톡' : '문자') + (x.test ? ' · 내 번호 확인용' : '') + ' · ' + esc(x.by_name || '') + '</span>' +
            '</button></li>';
        }).join('') + '</ul>';
    });
  }
  /* 040 전 — 예전처럼 한 건씩 */
  function findLogFlat(host) {
    return sb().rpc('sms_log_search', Object.assign(logArgs(), { p_limit: 300 })).then(function (r) {
      if (r.error) {
        host.innerHTML = '<p class="cp-warn">' + esc(isMissing(r.error) ? 'migration-023 SQL 을 실행하면 기록을 볼 수 있습니다.' : r.error.message) + '</p>';
        return;
      }
      var rows = r.data || [];
      if (!rows.length) { host.innerHTML = '<p class="panel__hint">이 조건으로 보낸 문자가 없습니다.</p>'; return; }
      var ok = rows.filter(function (x) { return x.status === 'ok'; }).length;
      host.innerHTML = '<p class="field__hint">migration-040 SQL 을 실행하면 보낸 묶음마다 한 줄로 보이고 [실패만 다시 보내기]를 쓸 수 있습니다.</p>' +
        '<p class="sms-sum">' + rows.length + '건 · 성공 ' + ok + ' · 실패 ' + rows.filter(function (x) { return x.status === 'fail'; }).length + (rows.length >= 300 ? ' (최근 300건까지)' : '') + '</p>' +
        '<div class="sms-log">' + rows.map(function (x) {
          var stt = x.status === 'ok' ? '<span class="snd-tag snd-tag--sent">성공</span>' : x.status === 'fail' ? '<span class="snd-tag snd-tag--failed" title="' + esc(x.error) + '">실패</span>' : '<span class="snd-tag">보내는 중</span>';
          return '<div class="sms-log__row">' +
              '<div class="sms-log__top"><span class="num">' + esc(fmtAt(x.at)) + '</span> <b>' + esc(x.name || '') + '</b> <span class="muted-note">' + esc(x.class_name || '') + ' · ' + esc(TO_LABEL[x.target] || x.target) + ' ****' + esc(x.phone_last4 || '') + '</span> ' +
                '<span class="sms-kind sms-kind--' + esc(x.kind) + '">' + (x.kind === 'LMS' ? '장문' : '단문') + '</span>' + (x.ad ? ' <span class="sms-kind">광고</span>' : '') + ' ' + stt + '</div>' +
              '<div class="sms-log__body">' + esc(x.body_head || '') + '</div>' +
              '<div class="sms-log__by muted-note">' + esc(x.by_name || '') + (x.status === 'fail' && x.error ? ' · ' + esc(x.error) : '') + '</div>' +
            '</div>';
        }).join('') + '</div>';
    });
  }
  var detail = null;
  function openBatch(i) {
    var x = batches[i];
    if (!x) return;
    var host = $('#smsLogDetail');
    host.hidden = false;
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    sb().rpc('sms_batch_get', { p_key: x.key }).then(function (r) {
      if (r.error) { host.innerHTML = '<p class="cp-warn">' + esc(r.error.message) + '</p>'; return; }
      detail = Object.assign({ head: x }, r.data);
      renderBatch();
      try { host.scrollIntoView({ block: 'start' }); } catch (e) {}
    });
  }
  function renderBatch() {
    var d = detail, host = $('#smsLogDetail');
    var rows = d.rows || [];
    var fails = rows.filter(function (r) { return r.status === 'fail' && r.student_id && !r.test; });
    var canRetry = fails.length && (d.via === 'kakao' ? !!d.week : !!d.hasBody);
    host.innerHTML = '<div class="sms-sec__title">' + esc(fmtAt(d.head.at)) + ' · ' + esc(d.label || firstLine(d.body).slice(0, 30) || '보낸 문자') + ' <span class="muted-note">' + rows.length + '건 · 성공 ' + rows.filter(function (r) { return r.status === 'ok'; }).length + ' · 실패 ' + fails.length + '</span></div>' +
      (d.body ? '<pre class="sms-pv__text sms-log-detail__body">' + esc(d.body) + '</pre>' : '') +
      '<div class="sms-table-wrap"><table class="sms-table sms-log-table"><thead><tr><th>받는 사람</th><th>보낼 곳</th><th>번호</th><th>결과</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var res = r.status === 'ok' ? '<span class="sms-st sms-st--ok">보냄 ' + esc(fmtAt(r.done_at || r.at)) + '</span>'
          : r.status === 'fail' ? '<span class="sms-st sms-st--bad">실패 · ' + esc(r.error || '이유 모름') + '</span>' : '<span class="sms-st sms-st--muted">보내는 중</span>';
        return '<tr><td>' + esc(r.name || '') + ' <span class="muted-note">' + esc(r.class_name || '') + '</span></td><td>' + esc(TO_LABEL[r.target] || r.target) + (r.kind ? ' <span class="muted-note">' + esc(r.kind === 'LMS' ? '장문' : r.kind === 'SMS' ? '단문' : r.kind) + '</span>' : '') + '</td>' +
          '<td class="num">****' + esc(r.last4 || '') + '</td><td>' + res + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="toolbar">' + (canRetry ? '<button class="btn btn--primary btn--sm" type="button" id="smsLogRetry">실패만 다시 보내기 (' + fails.length + '건)</button>' : fails.length ? '<span class="muted-note">이 기록은 글이 남아 있지 않아 다시 보낼 수 없습니다</span>' : '') +
      '<div class="spacer"></div><button class="btn btn--sm" type="button" id="smsLogDetailClose">닫기</button></div>';
  }
  /* 기록의 실패만 — 같은 글 · 같은 수업일 · 같은 입장코드로 (문자) · 알림톡은 다시 보내기로 */
  function retryBatch() {
    var d = detail;
    var fails = (d.rows || []).filter(function (r) { return r.status === 'fail' && r.student_id && !r.test; });
    if (!fails.length) return;
    var desc = fails.length + '건을 다시 보냅니다 — ' + fails.slice(0, 8).map(function (r) { return (r.name || '') + ' ' + (TO_LABEL[r.target] || '') + ' ****' + (r.last4 || ''); }).join(', ') + (fails.length > 8 ? ' 외 ' + (fails.length - 8) + '건' : '') + '.';
    UI.confirmAsk('실패만 다시 보내기', desc, '보내기').then(function (y) {
      if (!y) return;
      var ids = fails.map(function (r) { return r.student_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var p = d.via === 'kakao'
        ? invoke({ action: 'send', week: d.week, students: ids, resend: true, fallback: true }, KFN)
        : invoke({ action: 'send', items: fails.map(function (r) { return { student_id: r.student_id, to: r.target }; }), body: d.body, ad: !!d.ad, lessons: d.lessons || {},
                   siblings: true, markWeek: '', label: ((d.label || '') + ' (다시)').slice(0, 60), purpose: d.purpose || '', vars: d.vars || {} });
      p.then(function (res) {
        if (!res || !res.ok) { toast((res && res.message) || '보내지 못했습니다', 'bad'); return; }
        toast('다시 보냄 ' + (res.sent || 0) + '건' + (res.failed ? ' · 실패 ' + res.failed + '건' : ''), res.failed ? 'bad' : 'good');
        if (d.purpose === 'app') recordInvite(res);
        findLog();
      });
    });
  }

  /* ============================================================
     연결 상태 — 카톡 · 보내는 번호 · 이번 달 남은 건수 · 내 시험 번호 · 시험 발송 · 앱 설치 링크 · (아래) 키 · 단가 · 상한
     ============================================================ */
  function kkLine(k) {
    if (!k || !k.ok) return { cls: 'bad', text: '함수 응답 없음', sub: 'kakao-send 함수가 배포되지 않았거나 응답하지 않습니다' + (k && k.message ? ' — ' + k.message : '') };
    if (!k.keys.SOLAPI_TEMPLATE_ID) return { cls: 'warn', text: '템플릿 ID 없음', sub: 'Supabase Secrets 에 SOLAPI_TEMPLATE_ID 를 넣으면 카톡으로 보낼 수 있습니다 (kakao/HOW-TO.md)' };
    if (k.missing.length) return { cls: 'warn', text: '키 ' + k.missing.length + '개 없음', sub: k.missing.join(' · ') };
    return { cls: 'ok', text: '연동됨 · 템플릿 ' + KK_TEMPLATE, sub: '레포트 안내를 카톡 알림톡으로 보낼 수 있습니다' };
  }
  function connHtml(sms, kk, c, kc) {
    var L = kkLine(kk);
    var sender = sms && sms.ok && sms.sender ? (Store.phoneFormat ? Store.phoneFormat(sms.sender) : sms.sender) : '';
    var month = c ? (c.month || 0) : null, mmax = c ? c.monthMax || DEF.monthMax : null;
    var phone = (c && c.testPhone) || (kc && kc.testPhone) || '';
    return '<div class="conn-grid">' +
      '<div class="conn-card conn-card--' + L.cls + '"><div class="conn-card__k">카톡 알림톡</div><div class="conn-card__v" id="connKakao">' + esc(L.text) + '</div><div class="conn-card__s">' + esc(L.sub) + '</div></div>' +
      '<div class="conn-card conn-card--' + (sender ? 'ok' : 'warn') + '"><div class="conn-card__k">보내는 번호</div><div class="conn-card__v num" id="connSender">' + esc(sender || (sms && sms.ok ? '발신번호 없음' : '함수 응답 없음')) + '</div><div class="conn-card__s">' + (sender ? '솔라피에 등록된 발신번호' : esc((sms && sms.message) || 'Supabase Secrets 에 SOLAPI_SENDER 를 넣어 주세요')) + '</div></div>' +
      '<div class="conn-card conn-card--' + (c ? (mmax - month > 0 ? 'ok' : 'bad') : 'warn') + '"><div class="conn-card__k">이번 달 남은 건수</div><div class="conn-card__v" id="connMonth">' + (c ? '<span class="num">' + Math.max(0, mmax - month).toLocaleString() + '</span>건' : '—') + '</div><div class="conn-card__s">' + (c ? '이번 달 ' + month.toLocaleString() + '건 보냄 · 한 달 최대 ' + mmax.toLocaleString() + '건 · 오늘 ' + (c.today || 0) + ' / ' + c.dailyMax : 'migration-023 · 040 SQL 을 실행하면 보입니다') + '</div></div>' +
      '</div>' +
      '<div class="conn-row">' +
        '<label class="field"><span class="field__label">내 시험 번호 <span class="field__opt">나만 보입니다 · [나에게 시험 발송]이 이 번호로</span></span>' +
          '<input class="input" id="connTestPhone" type="tel" inputmode="numeric" autocomplete="off" placeholder="' + esc(phone || '010-1234-5678') + '"></label>' +
        '<button class="btn btn--sm" type="button" id="connTestSave">내 번호 저장</button>' +
        '<span class="field__hint" id="connTestNow">' + (phone ? '지금: <span class="num">' + esc(phone) + '</span> (빈 칸으로 저장하면 지웁니다)' : '아직 없습니다') + '</span>' +
      '</div>' +
      '<div class="conn-row">' +
        '<span class="field__label">나에게 시험 발송</span>' +
        '<button class="btn btn--sm" type="button" id="connTestSms">문자 한 통</button>' +
        '<button class="btn btn--sm" type="button" id="connTestKakao"' + (kk && kk.ready ? '' : ' disabled title="카톡 알림톡이 연동되면 쓸 수 있습니다"') + '>카톡 한 통</button>' +
        '<span class="field__hint" id="connTestMsg" role="status"></span>' +
      '</div>' +
      '<div class="extra-head" style="margin-top:16px"><span class="extra-head__title">마라톤 앱 설치 링크</span></div>' +
      (c ? '<div class="conn-row conn-row--app">' +
          '<label class="field"><span class="field__label">안드로이드 (구글 플레이)</span><input class="input" id="connAndroid" type="url" autocomplete="off" spellcheck="false" placeholder="https://play.google.com/store/apps/details?id=…" value="' + esc(c.androidUrl || '') + '"></label>' +
          '<label class="field"><span class="field__label">아이폰 (앱스토어)</span><input class="input" id="connIos" type="url" autocomplete="off" spellcheck="false" placeholder="https://apps.apple.com/kr/app/…" value="' + esc(c.iosUrl || '') + '"></label>' +
          '<button class="btn btn--sm" type="button" id="connAppSave">링크 저장</button>' +
        '</div><p class="field__hint">앱 안내 문자의 #{앱 설치 링크}에 들어갑니다' + (appLinks(c) ? '' : ' · 지금은 비어 있어 앱 안내 문자를 보낼 수 없습니다') + '.</p>'
        : '<p class="panel__hint">migration-040 SQL 을 실행하면 넣을 수 있습니다.</p>');
  }
  function loadConn() {
    var host = $('#smsConn');
    host.innerHTML = '<p class="panel__hint">연결 상태를 확인하는 중…</p>';
    var kc = sb().rpc('kakao_settings_get').then(function (r) { return r.error ? null : r.data; }, function () { return null; });
    return Promise.all([invoke({ action: 'status' }), loadKakao(), loadCfg().then(function () { return st.cfg; }), kc]).then(function (res) {
      st.smsStatus = res[0];
      host.innerHTML = connHtml(res[0], res[1], res[2], res[3]);
      if (res[0] && res[0].ok && res[0].sender) { st.sender = Store.phoneFormat ? Store.phoneFormat(res[0].sender) : res[0].sender; $('#smsFrom').textContent = '보내는 번호: ' + st.sender; }
      loadSettings(res[0]);
      if (window.Kakao && Kakao.loadSettings) Kakao.loadSettings();
    });
  }
  function saveTestPhone() {
    sb().rpc('kakao_test_phone_set', { p_phone: $('#connTestPhone').value }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast(r.data && r.data.testPhone ? '내 시험 번호를 저장했습니다 (' + r.data.testPhone + ')' : '내 시험 번호를 지웠습니다', 'good');
      loadConn();
    });
  }
  function saveAppLinks() {
    sb().rpc('sms_app_links_set', { p_android: $('#connAndroid').value.trim(), p_ios: $('#connIos').value.trim() }).then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? 'migration-040 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); return; }
      st.cfg = Object.assign({}, DEF, st.cfg || {}, r.data || {});
      toast('앱 설치 링크를 저장했습니다', 'good');
      loadConn();
      checkInvites();
    });
  }
  /* 연결 시험 — 문자 한 통(번호가 있는 첫 학생 이름으로) · 카톡 한 통(가장 최근 공개된 레포트로) */
  function connMsg(t, kind) { var el = $('#connTestMsg'); if (el) { el.textContent = t; el.className = 'field__hint conn-msg conn-msg--' + (kind || ''); } }
  function connTestSms() {
    var s = sortStudents(active()).find(function (x) { return ['parent1', 'parent2', 'student'].some(function (t) { return mobile(Store.phoneDigits(numberOf(x, t))); }); });
    if (!s) { connMsg('번호가 있는 학생이 없어 시험 문자를 만들 수 없습니다', 'bad'); return; }
    var t = ['parent1', 'parent2', 'student'].find(function (x) { return mobile(Store.phoneDigits(numberOf(s, x))); });
    connMsg('보내는 중…');
    invoke({ action: 'test', items: [{ student_id: s.id, to: t }], body: '[마라톤국어] 문자 연결 시험입니다.', ad: false, lessons: {}, siblings: false, markWeek: '', label: '연결 시험' }).then(function (r) {
      if (!r || !r.ok) { connMsg(r && r.reason === 'notest' ? '위에 내 시험 번호를 먼저 넣어 주세요' : '보내지 못했습니다 — ' + ((r && r.message) || ''), 'bad'); return; }
      connMsg(r.sent ? '✓ 내 번호로 문자 한 통을 보냈습니다 · ' + mdhm() : '실패 — ' + (((r.results || [])[0] || {}).error || ''), r.sent ? 'ok' : 'bad');
      loadCfg();
    });
  }
  function connTestKakao() {
    connMsg('보내는 중…');
    sb().from('published').select('week_start,student_id').eq('visible', true).order('week_start', { ascending: false }).limit(200).then(function (r) {
      var rows = (!r.error && r.data) || [];
      if (!rows.length) { connMsg('공개된 레포트가 있어야 카톡 시험 발송을 할 수 있습니다', 'bad'); return; }
      var wk = rows[0].week_start;
      var ids = rows.filter(function (x) { return x.week_start === wk; }).map(function (x) { return x.student_id; }).slice(0, 100);
      invoke({ action: 'test', week: wk, students: ids }, KFN).then(function (k) {
        if (!k || !k.ok) { connMsg('보내지 못했습니다 — ' + ((k && k.message) || ''), 'bad'); return; }
        connMsg(k.sent ? '✓ 내 번호로 카톡 한 통을 보냈습니다 · ' + mdhm() : '실패 — ' + (((k.results || [])[0] || {}).error || ''), k.sent ? 'ok' : 'bad');
      });
    });
  }

  /* ---------- 연결 상태 아래 — 문자 키 · 단가 · 상한 · 광고 · AI로 다듬기 상한 ---------- */

  function settingsHtml(fnRes, c) {
    var keys = (fnRes && fnRes.keys) || null;
    var KEY_NAME = { SOLAPI_API_KEY: 'API 키', SOLAPI_API_SECRET: 'API 시크릿', SOLAPI_SENDER: '발신번호' };
    return '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">사이트 문자 (SMS · LMS · 솔라피)</span></div>' +
      (keys
        ? '<ul class="kk-keys">' + Object.keys(KEY_NAME).map(function (k) {
            return '<li class="' + (keys[k] ? 'is-ok' : 'is-no') + '">' + (keys[k] ? '✓' : '✗') + ' ' + KEY_NAME[k] + ' <code>' + k + '</code></li>';
          }).join('') + '</ul><p class="field__hint">알림톡과 같은 키를 씁니다 · 키 값은 화면에 보이지 않습니다 (Supabase Secrets 에만).</p>'
        : '<p class="panel__hint">' + esc((fnRes && fnRes.message) || '문자 함수(sms-send)가 아직 배포되지 않았습니다.') + '</p>') +
      (c
        ? '<div class="toolbar">' +
            '<label class="field"><span class="field__label">단문 1건(원)</span><input class="input input--num" id="smsSetSms" type="number" min="0" max="1000" value="' + esc(c.smsWon) + '"></label>' +
            '<label class="field"><span class="field__label">장문 1건(원)</span><input class="input input--num" id="smsSetLms" type="number" min="0" max="1000" value="' + esc(c.lmsWon) + '"></label>' +
            '<label class="field"><span class="field__label">한 번 최대</span><input class="input input--num" id="smsSetPer" type="number" min="1" max="1000" value="' + esc(c.perSend) + '"></label>' +
            '<label class="field"><span class="field__label">하루 최대</span><input class="input input--num" id="smsSetDaily" type="number" min="1" max="10000" value="' + esc(c.dailyMax) + '"></label>' +
            '<label class="field"><span class="field__label">한 달 최대</span><input class="input input--num" id="smsSetMonth" type="number" min="1" max="100000" value="' + esc(c.monthMax || DEF.monthMax) + '"></label>' +
          '</div>' +
          '<div class="toolbar">' +
            '<label class="field"><span class="field__label">광고 발신처 <span class="field__opt">(광고) 뒤에 붙는 이름</span></span><input class="input" id="smsSetAdName" type="text" maxlength="30" value="' + esc(c.adName) + '"></label>' +
            '<label class="field"><span class="field__label">무료수신거부 번호 <span class="field__opt">비어 있으면 광고 문자를 못 보냅니다</span></span><input class="input" id="smsSetOptout" type="tel" inputmode="numeric" maxlength="16" placeholder="080-000-0000" value="' + esc(c.optout) + '"></label>' +
            '<button class="btn btn--sm" type="button" id="smsSaveCfg">문자 설정 저장</button>' +
          '</div>' +
          '<p class="field__hint">오늘 ' + esc(c.today || 0) + '건 · [나에게 시험 발송]은 위 「내 시험 번호」로 갑니다' + (c.testPhone ? ' (지금 ' + esc(c.testPhone) + ')' : '') + '.</p>'
        : '<p class="panel__hint">migration-023 SQL 을 실행하면 문자 설정을 바꿀 수 있습니다.</p>');
  }
  function polishHtml(p) {
    return '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">문자 「AI로 다듬기」</span></div>' +
      (p
        ? '<div class="toolbar">' +
            '<label class="field"><span class="field__label">한 달 최대 <span class="field__opt">AI 요약과 따로 셉니다</span></span><input class="input input--num" id="polishCap" type="number" min="0" max="5000" value="' + esc(p.cap) + '"></label>' +
            '<button class="btn btn--sm" type="button" id="polishCapSave">상한 저장</button>' +
          '</div>' +
          '<p class="field__hint">이번 달 ' + esc(p.used) + ' / ' + esc(p.cap) + '회 · Claude Haiku 5.5 · 1번 약 1원 안팎 · 글은 저장하지 않습니다 (Edge Function text-polish).</p>'
        : '<p class="panel__hint">migration-026 SQL 을 실행하고 Edge Function text-polish 를 배포하면 쓸 수 있습니다.</p>');
  }
  function loadSettings(status) {
    var host = $('#smsSettings');
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<p class="panel__hint">문자 설정을 불러오는 중…</p>';
    Promise.all([
      status ? Promise.resolve(status) : invoke({ action: 'status' }),
      sb().rpc('sms_settings_get').then(function (r) { return r.error ? null : r.data; }, function () { return null; }),
      sb().rpc('polish_status').then(function (r) { return r.error ? null : r.data; }, function () { return null; })
    ]).then(function (res) { host.innerHTML = settingsHtml(res[0] || null, res[1]) + polishHtml(res[2]); });
  }
  function saveSettings() {
    var p = {
      smsWon: Math.round(Number($('#smsSetSms').value)), lmsWon: Math.round(Number($('#smsSetLms').value)),
      perSend: Math.round(Number($('#smsSetPer').value) || 0), dailyMax: Math.round(Number($('#smsSetDaily').value) || 0),
      monthMax: Math.round(Number($('#smsSetMonth').value) || 0),
      adName: $('#smsSetAdName').value.trim(), optout: $('#smsSetOptout').value.trim()
    };
    sb().rpc('sms_settings_set', { p: p }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast('문자 설정을 저장했습니다', 'good');
      loadConn();
    });
  }

  /* ============================================================
     새 학생 앱 안내 문자 — 학생 등록(한 명 'f' · 엑셀 'i') 아래 체크
       체크 → 입장코드 칸 · 받는 사람(학생 · 학부모, 기본 둘 다) · 앱 설치 링크가 없으면 안내
       저장한 뒤 Sms.appInvite(학생 id 들, inviteOpts) — 「보내기」를 채우고 확인을 띄운다
     ============================================================ */
  var INV = ['f', 'i'];
  function checkInvites() {
    INV.forEach(function (p) {
      var on = $('#' + p + 'InvOn');
      if (!on) return;
      $('#' + p + 'InvBody').hidden = !on.checked;
      var w = $('#' + p + 'InvWarn');
      var msg = '';
      if (on.checked && st.cfg && !appLinks()) msg = '문자 발송 → 연결 상태에서 앱 설치 링크를 먼저 넣어 주세요';
      else if (on.checked && st.missing) msg = 'migration-023 · 040 SQL 을 실행해야 문자를 보낼 수 있습니다';
      var code = $('#' + p + 'InvCode').value.trim();
      if (!msg && on.checked && code && !CODE_RE.test(code)) msg = '입장코드는 영문 · 숫자 · 한글 2 ~ 30자로 적어 주세요 (띄어쓰기 없이)';
      if (!msg && on.checked && !$('#' + p + 'InvSt').checked && !$('#' + p + 'InvPa').checked) msg = '받는 사람(학생 · 학부모)을 하나 이상 골라 주세요';
      w.hidden = !msg;
      w.textContent = msg;
    });
  }
  /* 반을 바꾸면 — 손대지 않은 입장코드는 그 반 「앱 입장코드」로 */
  function fillClassCode() {
    var inp = $('#fInvCode');
    if (!inp || inp.dataset.typed === '1') return;
    inp.value = st.codes[($('#fClass').value || '').trim()] || '';
  }
  /* 학생 등록 창을 열 때 (app.js) — 새 학생만 · 「웰컴 문자 보내기」 기본 켜짐 (20261101e · 예전에는 꺼진 채로)
     엑셀 · CSV 는 체크 없이 다 넣은 뒤 묻는다 (welcome.js askAfterImport) */
  function resetInvite(p, isNew) {
    var box = $('#' + p + 'Inv');
    if (!box) return;
    box.hidden = !isNew;
    $('#' + p + 'InvOn').checked = true;
    $('#' + p + 'InvSt').checked = true;
    $('#' + p + 'InvPa').checked = true;
    var inp = $('#' + p + 'InvCode');
    inp.value = ''; inp.dataset.typed = '';
    checkInvites();
    Promise.all([loadCfg(), loadCodes()]).then(function () { if (p === 'f') fillClassCode(); checkInvites(); });
  }
  /* 저장할 때 읽는다 — 체크가 꺼져 있으면 null */
  function inviteOpts(p) {
    var on = $('#' + p + 'InvOn');
    if (!on || !on.checked || $('#' + p + 'Inv').hidden) return null;
    var st0 = $('#' + p + 'InvSt').checked, pa = $('#' + p + 'InvPa').checked;
    if (!st0 && !pa) return null;
    return { code: $('#' + p + 'InvCode').value.trim(), to: st0 && pa ? 'both' : st0 ? 'student' : 'parent' };
  }
  /* 앱 안내 문자 — 「보내기」를 「앱 안내(기본)」 · 입장코드 · 받는 사람으로 채운다. o.confirm 이면 확인을 바로 띄운다 */
  function appInvite(ids, o) {
    o = o || {};
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return Promise.resolve();
    return open({ students: ids, single: ids.length === 1, template: APP_TPL, purpose: 'app', entry: o.code || '', to: o.to || 'both', from: o.from || 'invite', confirm: !!o.confirm });
  }

  /* ---------- 시작 ---------- */

  function init() {
    if (!$('#panel-sms')) return;
    var pane = $('#panel-sms');
    pane.addEventListener('click', function (e) {
      var pb = e.target.closest('[data-smspane]');
      if (pb) { showPane(pb.dataset.smspane); return; }
      var pg = e.target.closest('[data-smspane-go]');
      if (pg) { showPane(pg.dataset.smspaneGo); return; }
      var to = e.target.closest('[data-smsto]');
      if (to) { st.to = to.dataset.smsto; renderPreview(); return; }
      var c = e.target.closest('[data-smscls]');
      if (c) { var n = c.dataset.smscls; if (st.classes[n]) delete st.classes[n]; else st.classes[n] = true; renderPreview(); return; }
      var ad = e.target.closest('[data-sms-add]');
      if (ad) { st.extra[ad.dataset.smsAdd] = true; delete st.off[ad.dataset.smsAdd]; st.find = ''; $('#smsFind').value = ''; renderPreview(); return; }
      var ga = e.target.closest('[data-sms-gall]');
      if (ga) {
        var g = ga.dataset.smsGall;
        var mine = pickedStudents().filter(function (s) { return clsOf(s) === g && hasNum(s) && !blocked(s); });
        var allOn = mine.every(function (s) { return !st.off[s.id]; });
        mine.forEach(function (s) { if (allOn) st.off[s.id] = true; else delete st.off[s.id]; });
        renderPreview(); return;
      }
      var tb = e.target.closest('[data-smstpl]');
      if (tb) { useTemplate(tb.dataset.smstpl); return; }
      if (e.target.id === 'smsAskUndo') { askUndo(); return; }
      var v = e.target.closest('[data-var], [data-tvar]');
      if (v) {
        var ta = v.dataset.var ? $('#smsBody') : $('#tplBody'), word = v.dataset.var || v.dataset.tvar;
        var s0 = ta.selectionStart || ta.value.length, s1 = ta.selectionEnd || s0;
        ta.value = ta.value.slice(0, s0) + word + ta.value.slice(s1);
        ta.focus();
        try { ta.setSelectionRange(s0 + word.length, s0 + word.length); } catch (er) {}
        if (ta.id === 'smsBody') renderPreview(); else renderTplPreview();
        return;
      }
      if (e.target.id === 'smsRetry') retry();
      if (e.target.id === 'smsOpenSet') openSettings();
      /* 자주 쓰는 문구 목록 */
      var ta2 = e.target.closest('[data-tact]');
      if (ta2) {
        var tid = ta2.closest('[data-tid]').dataset.tid, act = ta2.dataset.tact;
        if (act === 'edit') openTplEdit(tid, false);
        if (act === 'copy') openTplEdit(tid, true);
        if (act === 'del') deleteTemplate(tid);
        if (act === 'up') moveTpl(tid, -1);
        if (act === 'down') moveTpl(tid, 1);
        return;
      }
      /* 보낸 기록 */
      var bt = e.target.closest('[data-batch]');
      if (bt) { openBatch(+bt.dataset.batch); return; }
      if (e.target.id === 'smsLogRetry') retryBatch();
      if (e.target.id === 'smsLogDetailClose') $('#smsLogDetail').hidden = true;
      /* 연결 상태 */
      if (e.target.id === 'connTestSave') saveTestPhone();
      if (e.target.id === 'connAppSave') saveAppLinks();
      if (e.target.id === 'connTestSms') connTestSms();
      if (e.target.id === 'connTestKakao') connTestKakao();
      if (e.target.id === 'smsSaveCfg') saveSettings();
      if (e.target.id === 'polishCapSave') {
        sb().rpc('polish_cap_set', { p_cap: Math.round(Number($('#polishCap').value)) }).then(function (r) {
          if (r.error) { toast(r.error.message, 'bad'); return; }
          toast('「AI로 다듬기」 한 달 최대를 저장했습니다', 'good');
          loadSettings(st.smsStatus);
        });
      }
    });
    pane.addEventListener('change', function (e) {
      if (e.target.id === 'tplExStu') { renderTplPreview(); return; }
      var rw = e.target.closest('[data-smsrow]');
      if (rw) { if (rw.checked) delete st.off[rw.dataset.smsrow]; else st.off[rw.dataset.smsrow] = true; renderPreview(); return; }
      if (e.target.name === 'smsVia') { st.viaTouched = true; renderPreview(); return; }
      if (/^smsAd$|^smsSib$|^smsMark$/.test(e.target.id)) renderPreview();
    });
    var tm = null;
    $('#smsBody').addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(renderPreview, 150); if (st.tplOn) { var tt = tplById(st.tplOn); if (!tt || (tt.body || '') !== $('#smsBody').value) { st.tplOn = ''; renderTemplates(); } } });
    $('#smsEntry').addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(renderPreview, 150); });
    $('#tplBody').addEventListener('input', renderTplPreview);
    $('#smsFind').addEventListener('input', function () { st.find = $('#smsFind').value; renderPick(); });
    /* AI에게 부탁하기 — [써 줘] · 칸에서 Ctrl/⌘ + Enter */
    $('#smsAsk').addEventListener('input', renderAsk);
    $('#smsAsk').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); askRun(); } });
    $('#smsAskGo').addEventListener('click', askRun);
    $('#smsTplSaveOpen').addEventListener('click', function () {
      if (!$('#smsBody').value.trim()) { toast('저장할 내용을 먼저 써 주세요', 'bad'); return; }
      $('#smsTplSaveRow').hidden = false;
      if (!$('#smsTplName').value) $('#smsTplName').value = st.label || '';
      $('#smsTplName').focus();
    });
    $('#smsTplSaveCancel').addEventListener('click', function () { $('#smsTplSaveRow').hidden = true; });
    $('#smsTplSave').addEventListener('click', saveTemplate);
    $('#smsBodyClear').addEventListener('click', function () {
      if (!$('#smsBody').value) return;
      UI.confirmAsk('본문 비우기', '지금 쓴 글을 지웁니다. 저장된 「자주 쓰는 문구」는 그대로입니다.', '비우기').then(function (y) {
        if (!y) return;
        setBody('', ''); st.tplOn = ''; askState().undo = null;
        renderTemplates(); renderAsk();
        renderPreview();
      });
    });
    /* 「AI로 다듬기」 — 공통 부품 (aipolish.js) · 문자는 짧게 메신저용 · 길이 고르기 · 남은 횟수 */
    if (window.AiPolish) {
      AiPolish.attach($('#tplBody'), { kind: 'sms', lengths: true, left: true, id: 'tplAi' });
    }
    $('#smsSend').addEventListener('click', function () { send(null); });
    $('#smsResend').addEventListener('click', resend);
    $('#smsTest').addEventListener('click', testSend);
    $('#smsClose').addEventListener('click', function () { if (st.back >= 0) UI.selectTab(st.back); });
    $('#smsReset').addEventListener('click', function () { open({}); });
    $('#smsLogFind').addEventListener('click', findLog);
    $('#tplNew').addEventListener('click', function () { openTplEdit(null, false); });
    $('#tplCancel').addEventListener('click', closeTplEdit);
    $('#tplSave').addEventListener('click', saveTplEdit);
    $('#connRefresh').addEventListener('click', loadConn);

    /* 끌어서 순서 바꾸기 */
    var drag = null;
    /* 수업 전 예고 문구 [고치기] (20261101l) */
    $('#tplPre').addEventListener('click', function (e) { var b = e.target.closest('[data-pre-edit]'); if (b) openTplEdit(b.dataset.preEdit); });
    $('#tplList').addEventListener('dragstart', function (e) {
      var li = e.target.closest('[data-tid]'); if (!li) return;
      drag = li.dataset.tid; li.classList.add('is-drag');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); } catch (er) {}
    });
    $('#tplList').addEventListener('dragover', function (e) {
      if (!drag) return;
      var li = e.target.closest('[data-tid]'); if (!li) return;
      e.preventDefault();
      $$('#tplList .tpl-row').forEach(function (x) { x.classList.toggle('is-over', x === li); });
    });
    $('#tplList').addEventListener('drop', function (e) {
      if (!drag) return;
      var li = e.target.closest('[data-tid]'); if (!li) return;
      e.preventDefault();
      var ids = st.templates.map(function (t) { return t.id; });
      var from = ids.indexOf(drag), to = ids.indexOf(li.dataset.tid);
      drag = null;
      if (from < 0 || to < 0 || from === to) { renderTplList(); return; }
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      reorder(ids);
    });
    $('#tplList').addEventListener('dragend', function () { drag = null; $$('#tplList .tpl-row').forEach(function (x) { x.classList.remove('is-drag', 'is-over'); }); });

    /* [문자] 단추 — 「오늘」 반 카드(data-sms-cls) · 학생 줄 · 학생 → 명단(data-sms-sid, 비어 있으면 줄의 data-id) · 레포트 발송 → 3 발송 [반 전체 문자]
       [앱 안내 문자] — 학생 명단 줄 · 상담 카드 (data-app-invite) */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sms-cls], [data-sms-sid], [data-app-invite]');
      if (!b || b.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (b.hasAttribute('data-sms-cls')) {
        var wk = b.getAttribute('data-sms-week') || '';
        open({ classes: [b.getAttribute('data-sms-cls')], week: wk, from: wk ? 'send' : 'today' });
        return;
      }
      var holder = b.closest('[data-id]');
      var sid = b.getAttribute('data-sms-sid') || b.getAttribute('data-app-invite') || (holder && holder.dataset.id) || '';
      var s = (UI.getStudents ? UI.getStudents() : active()).find(function (x) { return x.id === sid; });
      if (!s) return;
      if (s.archived) { toast('퇴원한 학생에게는 문자를 보낼 수 없습니다', 'bad'); return; }
      var from = b.closest('#panel-roster') ? 'roster' : b.closest('#cardModal') ? 'card' : 'today';
      if (b.closest('#cardModal') && $('#cardModal').open && !b.hasAttribute('data-app-invite')) $('#cardModal').close();
      /* [웰컴·앱 설치 안내 다시 보내기] — 학생 / 학부모 / 둘 다 · 미리보기 · 보내기 (welcome.js · 20261101e) */
      if (b.hasAttribute('data-app-invite')) {
        if (window.Welcome) Welcome.open({ students: [sid] }); else appInvite([sid], { to: 'both', from: from });
        return;
      }
      open({ students: [sid], single: true, from: from });
    }, true);

    /* 학생 등록 — 앱 안내 체크 */
    INV.forEach(function (p) {
      var on = $('#' + p + 'InvOn');
      if (!on) return;
      /* 켤 때마다 설정을 새로 읽는다 — 다른 직원이 방금 앱 설치 링크를 넣었을 수 있다 */
      ['InvOn', 'InvSt', 'InvPa'].forEach(function (k) { $('#' + p + k).addEventListener('change', function () { if (k === 'InvOn' && on.checked) loadCfg().then(checkInvites); checkInvites(); }); });
      $('#' + p + 'InvCode').addEventListener('input', function (e) { e.target.dataset.typed = '1'; checkInvites(); });
    });
    if ($('#fClass')) $('#fClass').addEventListener('change', fillClassCode);

    /* 「오늘」 → [설정]에서 — 알림톡 · 문자 칸은 연결 상태로 옮겼다 */
    var go = $('#tdSetSmsGo');
    if (go) go.addEventListener('click', function () {
      var m = $('#tdSettingsModal');
      if (m && m.open) m.close();
      setTimeout(openSettings, 60);
    });
    /* 위쪽 「문자 발송」 탭을 직접 누르면 — 처음이면 빈 「보내기」 */
    document.addEventListener('jt:tab', function (e) { if (e.detail && e.detail.index === TAB) setTimeout(firstShow, 0); });
  }
  init();

  window.Sms = {
    open: open, openLog: function (o) { goTab(); openLog(o); }, openSettings: openSettings, showPane: function (p) { goTab(); showPane(p); },
    appInvite: appInvite, inviteOpts: inviteOpts, resetInvite: resetInvite,
    /* 입구 문자 · 웰컴 문자 (welcome.js · 20261101e) — 함수 · 설정 · 반 입장코드 · 자주 쓰는 문구를 같이 쓴다 */
    invoke: function (body) { return invoke(body); },
    prep: function () {
      /* 문자 설정(migration-023)이 없으면 문구 · 입장코드는 읽지 않는다 */
      return loadCfg().then(function () {
        if (st.missing) return null;
        return Promise.all([loadCodes(), loadTemplates()]);
      }).then(function () {
        return { links: appLinks(), codes: st.codes, templates: st.templates, missing: st.missing };
      });
    },
    build: build, bytes: bytes, kdate: kdate, state: function () { return st; },
    isOpen: function () { return !!$('#panel-sms') && !$('#panel-sms').hidden && st.pane === 'send'; },
    /* 「내 번호로도 한 통 받기」 — kakao.js · send.js 도 같이 (20261031r) */
    copyHtml: copyHtml, copyOn: copyOn, myPhone: function () { return me.phone; }, loadMyPhone: loadMyPhone
  };
})();
