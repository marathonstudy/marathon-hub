/* ============================================================
   welcome.js — 「입구 문자 보내기」 · 「신입생 웰컴 + 마라톤 앱 설치 안내」 (20261101e · migration-052 · sms-send)

   입구 문자 — 학생 명단 위 「학생 입구」 줄 [입구 문자 보내기] (예전 「단톡방 안내 문구 복사」 자리)
     · 받는 사람: 반 고르기(전체 / 반 여러 개) + 「아직 한 번도 로그인 안 한 학생만」(기본 켜짐) · 학생 본인 번호로만
     · 글은 「자주 쓰는 문구」의 「입구 안내」(없으면 기본 글) — 이 창에서 바로 고칠 수 있다
   신입생 웰컴 — 「자주 쓰는 문구」의 「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」 (없으면 예전 「앱 안내(기본)」 글로)
     · 한 명 등록: 「웰컴 문자 보내기」(기본 켜짐)면 저장하는 순간 학생 본인 · 학부모 1 · 2 로 바로 (Welcome.sendNow)
     · 엑셀 · CSV: 다 넣은 뒤 「새로 넣은 n명에게 웰컴 문자 보낼까요? [보내기] [나중에]」 (Welcome.askAfterImport)
     · 다시 보내기: 상담 카드 [웰컴·앱 설치 안내 다시 보내기] · 명단 반 이름 옆 [반 전체에 웰컴 안내]
       (받는 사람 학생 / 학부모 / 둘 다 · 반 전체면 「아직 앱 링크 연결 안 된 학생만」 기본 켜짐)
   과제 문자 (20261107c · migration-068) — 「오늘」 반 카드 [과제 문자 · 독려 19 · 칭찬 3] (today.js) · 창은 「독려」 「칭찬」 두 묶음
     · 칭찬 — 그 주 지금까지 나온 과제를 모두 낸 학생(늦게 낸 것 포함 · 면제는 개수에서 뺌 · 0개면 없음) · 학생 본인에게만
       「자주 쓰는 문구」의 「과제 칭찬(학생)」 · {전체수}는 학생마다 · 묶음 전체 끄기(기본 켜짐) · 학생마다 체크로 빼기
       오늘 이미 칭찬 받은 학생(직접 보낸 칭찬 · 수업 전 예고 모두 제출)은 빼고 「오늘 이미 칭찬 받음 n명 제외」 (sms_praised_today)
       보낸 기록에 「과제 칭찬」(목적 praise) · 사본은 독려와 한 통 (068)
   과제 독려 (20261101g · migration-054) — 「오늘」 반 카드 「과제 평균」 줄 「진행 중」 옆 버튼 (today.js)
     · 받는 사람 목록(이름 · 지난 수업 이후 밀린 날짜 모두 「10/27(월) 10/28(화) 10/30(목)」 · 체크를 빼면 제외 · 20261101h) · 「학생에게」 기본 켜짐 · 「학부모에게도」 기본 꺼짐
     · 「자주 쓰는 문구」의 「과제 독려(학생)」 · 「과제 독려(학부모)」 · {밀린날짜}는 학생마다 채워서 같은 글끼리 묶어 보낸다 (함수는 그대로)
   공통
     · 칸: {학생이름} {반이름} {첫수업일}(수강 시작일) {앱입장코드}(반 설정 「앱 핀번호(입장코드)」) {러닝노트주소}(학생 입구 /s/)
       — 예전 칸(#{이름} #{반} #{입장코드} #{앱 설치 링크})도 그대로 바뀐다. 실제 글은 서버(sms_prepare)가 똑같이 만든다
     · 퇴원한 학생 · 번호 없는 사람은 빼고 「번호 없음 n명」 · 오늘 같은 종류를 이미 보낸 사람은 「오늘 이미 보냄」으로 빼 둔다
     · 미리보기 1건 → [n명에게 보내기] → 「n명에게 보냅니다」 확인 → 「보냄 n건 · 실패 n건(이름)」
     · 보낸 기록에 「입구 안내」 · 「웰컴 안내」 (목적 entry · welcome) · 상담 카드 「웰컴 안내 보냄 10/30」
     · 길면(90바이트 넘음) 장문(LMS) — 서버가 정한다. 키는 화면에 없다 (sms-send · Solapi Secrets)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var NOCLS = '(반 없음)';
  var CODE_RE = /^[A-Za-z0-9가-힣_-]{2,30}$/;
  var KIND = {
    entry: { title: '입구 문자 보내기', label: '입구 안내', tpl: ['입구 안내'] },
    welcome: { title: '웰컴·앱 설치 안내', label: '웰컴 안내', tpl: ['신입생 웰컴(학생)', '신입생 웰컴(학부모)'] },
    nudge: { title: '과제 문자', label: '과제 독려', tpl: ['과제 독려(학생)', '과제 독려(학부모)'] }
  };
  /* 과제 칭찬 기본 글 (migration-068 과 같다) */
  var PRAISE_ST = '[마라톤국어] {학생이름} 학생, 이번 주 지금까지 나온 과제 {전체수}개를 모두 제출했어요! 매일 루틴을 지켜 내느라 정말 수고했어요. 이 루틴 그대로 이어가 봐요!';
  /* 「이번 주」라고 쓰지 않는다 — 직전 주 날짜도 들어간다 (migration-055 와 같다 · 20261101h) */
  var NUDGE_ST = '[마라톤국어] {학생이름} 학생, 지난 수업 이후 과제 {밀린날짜}이 아직 제출 안 됐어요. 오늘 안에 마라톤 앱에서 제출해 주세요!';
  /* 학부모 독려 · 칭찬 다섯 가지 (20261110a · migration-092 와 같다) — 「과제 독려(학부모) 1」~「5」 · 「과제 칭찬(학부모) 1」~「5」
     학생 쪽과 같이 학생마다 돌린다 · 예전 기본 글(054 · 055 「확인 부탁드립니다」)은 쓰지 않는다 · 사람이 고친 예전 글은 092 전에는 그대로 쓴다 */
  var NUDGE_PA_OLD = [
    '[마라톤국어] {학생이름} 학생의 이번 주 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생의 지난 수업 이후 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.'];
  var NUDGE_PA_DEF = [
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. 이번 주 과제 중 {밀린날짜} 과제가 아직 제출되지 않아 안내드립니다. 바쁜 주에는 밀릴 수 있어 수업에서도 함께 챙기고 있습니다. 할 수 있는 만큼 이어 갈 수 있도록 따뜻한 응원 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 제출되지 않았습니다. 수업에서 함께 살피며 다시 루틴을 잡아 가겠습니다. 가정에서도 격려 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 남아 있어 알려 드립니다. 조금씩 이어 갈 수 있도록 저희가 함께 챙기겠습니다. 따뜻한 응원 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 제출 전입니다. 한 번에 다 하지 않아도 되도록 수업에서 함께 돕고 있습니다. 응원의 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. 바쁜 한 주라 {밀린날짜} 과제가 조금 밀렸습니다. 다시 리듬을 찾도록 학원에서 함께 챙기고 있습니다. 가정에서도 힘이 되는 한마디 부탁드립니다.'];
  var PRAISE_PA_DEF = [
    '[마라톤국어] {학생이름} 학생이 이번 주 지금까지 나온 과제 {전체}개를 모두 제출했습니다. 매일 루틴을 꾸준히 지켜 내고 있습니다. 가정에서도 칭찬 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 이번 주 과제 {전체}개를 빠짐없이 제출했습니다. 하루하루 꾸준히 해내는 모습이 대견합니다. 가정에서도 칭찬 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 과제 {전체}개를 모두 제출했습니다. 바쁜 중에도 루틴을 지켜 낸 노력이 돋보입니다. 따뜻한 칭찬 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 이번 주 과제를 하나도 빠뜨리지 않고 제출했습니다({전체}개). 이 꾸준함이 큰 힘이 될 것입니다. 가정에서도 격려 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 과제 {전체}개를 모두 해냈습니다. 매일 조금씩 쌓은 노력이 잘 보이고 있습니다. 가정에서도 응원의 말 부탁드립니다.'];
  var NUDGE_PA = NUDGE_PA_DEF[0];
  /* 과제 문자 문구 다섯 가지 (20261108r · migration-086 과 같다) — 「과제 독려(학생) 1」~「5」 · 「과제 칭찬(학생) 1」~「5」
     학생마다 지난번 번호 다음 번호로 돌린다 (처음이면 무작위) · 문구 칸을 직접 고치면 그 글을 모두에게 (돌림 안 함)
     086 을 아직 안 돌려 번호 문구가 없으면 예전 「과제 독려(학생)」 · 「과제 칭찬(학생)」 하나만 쓴다 */
  var NUDGE_DEF = [
    '[마라톤국어] {학생이름} 학생, 지난주 과제 중 {밀린날짜}이 아직 제출되지 않았어요. 마라톤 앱에서 한번 확인해 보고, 할 수 있는 만큼 제출해 봐요!',
    '[마라톤국어] {학생이름} 학생, {밀린날짜} 과제가 아직 비어 있어요. 조금씩이라도 채워 가면 루틴이 다시 잡혀요. 앱에서 확인해 봐요!',
    '[마라톤국어] {학생이름} 학생, 바쁜 한 주였죠? {밀린날짜} 과제가 아직 남아 있어요. 시간 날 때 마라톤 앱에서 하나씩 제출해 봐요.',
    '[마라톤국어] {학생이름} 학생, {밀린날짜} 과제를 기다리고 있어요. 한 지문씩만 해도 충분하니, 앱에서 이어서 달려 봐요!',
    '[마라톤국어] {학생이름} 학생, 아직 제출 안 된 과제가 있어요({밀린날짜}). 다시 루틴으로 돌아오는 첫걸음, 오늘 하나만 먼저 해 봐요!'];
  var PRAISE_DEF = [
    '[마라톤국어] {학생이름} 학생, 이번 주 지금까지 나온 과제 {전체}개를 모두 제출했어요! 매일 루틴을 지켜 내느라 정말 수고했어요. 이 루틴 그대로 이어가 봐요!',
    '[마라톤국어] {학생이름} 학생, 과제 {전체}개 모두 제출 완료! 하루도 빠짐없이 해낸 거, 정말 대단해요. 수고했어요!',
    '[마라톤국어] {학생이름} 학생, 이번 주 과제를 빠짐없이 다 냈어요. 꾸준함이 제일 큰 실력이에요. 정말 수고 많았어요!',
    '[마라톤국어] {학생이름} 학생, 과제 {전체}개 퍼펙트! 이렇게 쌓은 매일이 시험장에서 힘이 될 거예요. 수고했어요!',
    '[마라톤국어] {학생이름} 학생, 이번 주도 루틴 완주! 과제 {전체}개를 모두 해낸 노력, 선생님이 잘 보고 있어요. 수고했어요!'];
  var HW_BASE = { nudge: '과제 독려(학생)', praise: '과제 칭찬(학생)', nudgePa: '과제 독려(학부모)', praisePa: '과제 칭찬(학부모)' };
  var HW_DEF = { nudge: NUDGE_DEF, praise: PRAISE_DEF, nudgePa: NUDGE_PA_DEF, praisePa: PRAISE_PA_DEF };
  var HW_KINDS = ['nudge', 'praise', 'nudgePa', 'praisePa'];
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  var ENTRY_BODY = '[마라톤국어] {학생이름} 학생, 러닝노트 입구입니다. {러닝노트주소} 반과 이름을 고르고 휴대폰 번호 010 뺀 8자리로 들어오세요. 홈 화면에 추가해 두면 앱처럼 바로 열려요.';
  /* 웰컴 · 입구 기본 글 끝 「홈 화면에 추가해 두면 앱처럼 바로 열려요.」 (20261101k · migration-057 과 같다) */
  /* 웰컴 기본 글 — 예전 「신입생 앱 안내」(sms.js 앱 안내(기본))와 같은 글 · 학부모용은 첫 줄만 바꾼다 (migration-052 와 같다) */
  var WEL_REST = '1) 앱 설치: #{앱 설치 링크}\n2) 앱에서 입장코드 입력: {앱입장코드}\n궁금한 점은 이 번호로 답장 주세요.\n홈 화면에 추가해 두면 앱처럼 바로 열려요.';
  var WEL_ST = '안녕하세요, 마라톤국어입니다. {학생이름} 학생, 마라톤 스터디 앱을 설치하고 입장코드로 들어와 주세요.\n' + WEL_REST;
  var WEL_PA = '안녕하세요, 마라톤국어입니다. {학생이름} 학생의 등록을 환영합니다.\n학생이 아래 순서대로 설치하도록 함께 확인 부탁드립니다.\n' + WEL_REST;
  var TO_LABEL = { student: '학생', parent1: '학부모', parent2: '학부모' };

  var st = null;          /* 지금 열린 창 */
  var ctx = null;         /* 불러온 것 { links, codes, templates, sent, logged, missing } */

  /* ---------- 학생 ---------- */
  function active() { return UI.activeStudents(); }
  function clsOf(s) { return (s.className || '').trim() || NOCLS; }
  function byId(id) { return active().find(function (s) { return s.id === id; }) || null; }
  function classNames() {
    var seen = {};
    active().forEach(function (s) { seen[clsOf(s)] = 1; });
    var names = Object.keys(seen).filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); });
    return window.TodayView && TodayView.orderClasses ? TodayView.orderClasses(names) : names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function sortList(list) {
    var rank = {};
    classNames().forEach(function (n, i) { rank[n] = i; });
    return list.slice().sort(function (a, b) { return ((rank[clsOf(a)] || 0) - (rank[clsOf(b)] || 0)) || (a.name || '').localeCompare(b.name || '', 'ko'); });
  }
  function digits(v) { return Store.phoneDigits(v || ''); }
  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }
  function numberOf(s, t) { return t === 'parent1' ? s.parentPhone : t === 'parent2' ? s.parentPhone2 : s.studentPhone; }

  /* ---------- 칸 ---------- */
  function firstOf(s) {
    var d = Store.startOf(s) || (Store.defaultStartDate ? Store.defaultStartDate(clsOf(s) === NOCLS ? '' : clsOf(s)) : '');
    return d && window.Sms && Sms.kdate ? Sms.kdate(d) : '';
  }
  function codeOf(s) {
    var c = String((st && st.code) || ctx.codes[clsOf(s)] || '').trim();
    return CODE_RE.test(c) ? c : '';
  }
  function entryUrl() { return CONFIG.siteUrl + '/s/'; }
  function needCode(body) { return body.indexOf('{앱입장코드}') !== -1 || body.indexOf('#{입장코드}') !== -1; }
  function needApp(body) { return body.indexOf('#{앱 설치 링크}') !== -1; }
  /* 바뀌지 않은 칸 (20261101m) — 보내기 직전 글에 {밀린날짜} · #{링크} 같은 칸이 남으면 그 사람에게는 보내지 않는다 (sms-send · note-remind 와 같은 규칙) */
  function leftOf(text) { var out = []; (String(text || '').match(/#?\{[^{}\r\n]{1,20}\}/g) || []).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); }); return out; }
  function leftMsg(left) { return '바뀌지 않은 칸이 있어 보내지 않음: ' + left.join(' '); }
  /* 서버 sms_prepare(052) 와 같은 순서 · 같은 글 */
  function fill(body, s) {
    var code = codeOf(s);
    return String(body)
      .split('#{이름}').join(s.name || '').split('#{반}').join((s.className || '').trim())
      .split('#{입장코드}').join(code).split('#{앱 설치 링크}').join(ctx.links || '')
      .split('{학생이름}').join(s.name || '').split('{반이름}').join((s.className || '').trim())
      .split('{첫수업일}').join(firstOf(s)).split('{앱입장코드}').join(code)
      .split('{러닝노트주소}').join(entryUrl())
      .split('{밀린날짜}').join(missOf(s));
  }
  /* {밀린날짜} — 과제 독려 (학생마다 「10/27(화)·10/29(목)」) · 모르면 칸을 그대로 둔다 → 보내지 않음 (20261101m) */
  function missOf(s) { return (st && st.miss && st.miss[s.id]) || '{밀린날짜}'; }
  /* 함수에 넘기는 글 — {밀린날짜}만 여기서 채운다 (나머지 칸은 서버가) */
  function outBody(x) { return x.pr ? prBody(x.s, x.t) : bodyFor(x.t, x.s).split('{밀린날짜}').join(missOf(x.s)); }
  /* 칭찬 — {전체}({전체수})만 여기서 채운다 (나머지 칸은 서버가) · 직접 고친 글이 없으면 그 학생 차례 문구 · 학부모는 「과제 칭찬(학부모)」 (20261110a) */
  function prBody(s, t) {
    var n = String((st.pr.total || {})[s.id] || '');
    var pa = !!t && t !== 'student', k = pa ? 'praisePa' : 'praise';
    var b = st.custom && !st.custom[k] && st.pick ? tplOf(k, s.id) : (pa ? st.pr.bodyPa : st.pr.body);
    return String(b).split('{전체수}').join(n || '{전체수}').split('{전체}').join(n || '{전체}');
  }

  /* ---------- 과제 문자 — 문구 돌리기 · 기준 기간 · 발송 이력 (20261108r) ---------- */
  /* 번호 문구 목록 [{ no, body }] — 번호 문구가 없으면 예전 이름 하나(no: null) · 그것도 없으면 기본 다섯 */
  function hwTpls(kind) {
    var base = HW_BASE[kind], out = [];
    (ctx.templates || []).forEach(function (t) {
      var ti = (t.title || '').trim();
      if (ti.indexOf(base + ' ') !== 0) return;
      var n = ti.slice(base.length + 1);
      if (/^\d{1,2}$/.test(n) && String(t.body || '').trim()) out.push({ no: +n, body: t.body });
    });
    if (out.length) return out.sort(function (a, b) { return a.no - b.no; });
    var old = tplBody(base, '');
    if (old && !(kind === 'nudgePa' && NUDGE_PA_OLD.indexOf(String(old).trim()) !== -1)) return [{ no: null, body: old }];
    return HW_DEF[kind].map(function (b, i) { return { no: i + 1, body: b }; });
  }
  function rotating(kind) { return hwTpls(kind).length > 1; }
  function rangeText(kind) { var L = hwTpls(kind); return L.length > 1 ? '문구 ' + L[0].no + '~' + L[L.length - 1].no + '번' : ''; }
  /* 학생 차례 번호 — 지난번 번호 다음(끝이면 처음으로) · 처음 받는 학생은 무작위 */
  function nextNo(kind, sid) {
    var nums = hwTpls(kind).map(function (x) { return x.no; });
    if (nums.length < 2) return nums[0];
    var last = st.lastNo && st.lastNo[kind] ? st.lastNo[kind][sid] : null;
    if (last == null) return nums[Math.floor(Math.random() * nums.length) % nums.length];
    var nx = nums.filter(function (n) { return n > last; })[0];
    return nx != null ? nx : nums[0];
  }
  function tplOf(kind, sid) {
    var L = hwTpls(kind), no = st.pick[kind][sid];
    var x = L.find(function (y) { return y.no === no; }) || L[0];
    return x.body;
  }
  /* 그 학생에게 갈 문구 번호 (직접 고친 글이면 없음) */
  function noOf(x) {
    if (!st.pick || !st.custom) return null;
    var k = (x.pr ? 'praise' : 'nudge') + (x.t === 'student' ? '' : 'Pa');
    return st.custom[k] ? null : st.pick[k][x.s.id];
  }
  /* 학생 · 학부모로 나눈 수 — 「학부모 5명 포함」 (같은 학생의 학부모 1 · 2 는 한 명) */
  function sideCount(items, pa) { var m = {}; items.forEach(function (x) { if ((x.t !== 'student') === pa) m[x.s.id] = 1; }); return Object.keys(m).length; }
  /* 기준 기간이 이번 주(아직 수업 전)면 독려 문구의 「지난주」 → 「이번 주」 (직접 고친 글은 그대로) */
  function weekWord(t) { return st.period && st.period.word === '이번 주' ? String(t).split('지난주').join('이번 주') : t; }
  function kst(at) { var d = new Date(new Date(at).getTime() + 9 * 3600000); return { day: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; }
  function mdw(iso) { var d = new Date(iso + 'T00:00:00Z'); return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '(' + DOWK[d.getUTCDay()] + ')'; }
  function todayIso() { return window.DDay && DDay.today ? DDay.today() : kst(Date.now()).day; }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  /* 이번 기준 기간에 받은 과제 문자 (직접 + 수업 전 자동) */
  function winRows(sid, kind) {
    var P = st.period || {}, f = P.winFrom || addDays(todayIso(), -7), t = P.winTo || todayIso();
    return (st.hist || []).filter(function (r) { var d = kst(r.at).day; return r.student_id === sid && d >= f && d <= t && (!kind || r.kind === kind); });
  }
  function gotToday(kind, sid) {
    var t = todayIso();
    if (st.hist) return st.hist.some(function (r) { return r.student_id === sid && r.kind === kind && kst(r.at).day === t; });
    if (kind === 'praise') return !!(ctx.praised && ctx.praised[sid]);
    return ['student', 'parent1', 'parent2'].some(function (x) { return ctx.sent[sid + '|' + x]; });
  }
  var KW = { nudge: '독려', praise: '칭찬' };
  function byText(r) { return r.how === 'pre' ? '수업 전 자동' : (r.by || '직접'); }
  function whenText(r) { var k = kst(r.at); return mdw(k.day) + ' ' + k.hm; }
  function histLine(kind, sid) {
    var rows = winRows(sid, kind);
    if (!rows.length) return '아직 안 받음';
    var last = rows[rows.length - 1];
    return KW[kind] + ' ' + rows.length + '번 · 마지막 ' + whenText(last) + ' ' + byText(last);
  }
  function histList(sid) {
    var rows = winRows(sid);
    if (!rows.length) return '<p class="wc-hist__none">이번 기간에 받은 과제 문자가 없습니다.</p>';
    return '<ol class="wc-hist__list">' + rows.map(function (r) {
      var to = r.to || [];
      return '<li class="num">' + esc(whenText(r) + ' · ' + KW[r.kind] + ' · ' + byText(r) + (r.no ? ' · 문구 ' + r.no + '번' : '') + (r.pno ? ' · 학부모 문구 ' + r.pno + '번' : '') +
        (to.indexOf('parent1') !== -1 || to.indexOf('parent2') !== -1 ? (to.indexOf('student') !== -1 ? ' · 학생 · 학부모' : ' · 학부모') : '')) + '</li>';
    }).join('') + '</ol>';
  }
  function bytes(t) { return window.Sms && Sms.bytes ? Sms.bytes(t) : t.length * 2; }

  /* ---------- 불러오기 ---------- */
  function rpc(name, args) {
    return Promise.resolve(sb().rpc(name, args || {})).then(function (r) {
      if (r.error) { if (isMissing(r.error)) return { missing: true }; throw new Error(r.error.message); }
      return { data: r.data };
    });
  }
  function tplBody(title, def) {
    var t = (ctx.templates || []).find(function (x) { return (x.title || '').trim() === title; });
    return t && String(t.body || '').trim() ? t.body : def;
  }
  function load(kind) {
    var base = window.Sms && Sms.prep ? Sms.prep() : Promise.resolve({ links: '', codes: {}, templates: [] });
    return Promise.all([
      base,
      rpc('sms_sent_today', { p_purpose: kind }),
      kind === 'entry' ? rpc('student_logged_ids') : Promise.resolve({ data: [] }),
      /* 오늘 이미 칭찬 받은 학생 (068) — 없으면 직접 보낸 칭찬만 */
      kind === 'nudge' ? rpc('sms_praised_today').then(function (r) { return r.missing ? rpc('sms_sent_today', { p_purpose: 'praise' }) : r; }) : Promise.resolve({ data: [] }),
      /* 과제 문자 발송 이력 (086) — 지난 90일 (지난번 문구 번호) · 없으면 null */
      kind === 'nudge' ? rpc('hw_msg_history', { p_from: addDays(todayIso(), -90), p_to: todayIso() }).then(function (r) { return r.missing ? null : (r.data || []); }, function () { return null; }) : Promise.resolve(null)
    ]).then(function (a) {
      if (st && kind === 'nudge') st.hist = a[4];
      var praised = {};
      ((a[3] && a[3].data) || []).forEach(function (x) { if (x.student_id) praised[x.student_id] = x.how || 'manual'; });
      var sent = {};
      ((a[1].data) || []).forEach(function (x) { sent[x.student_id + '|' + x.target] = x.at; });
      var logged = {};
      ((a[2].data) || []).forEach(function (id) { logged[id] = true; });
      ctx = { links: a[0].links || '', codes: a[0].codes || {}, templates: a[0].templates || [], sent: sent, logged: logged, praised: praised, missing: !!(a[1].missing || a[2].missing), smsMissing: !!a[0].missing };
      return ctx;
    });
  }

  /* ---------- 보낼 줄 ----------
     students × 보낼 곳 → { items, noPhone, noCode, dup, people }
     · 학부모 2 번호가 1 과 같으면 한 번 · 학생 번호가 학부모 번호와 같고 둘 다 보내면 학생 줄은 뺀다 (학부모 글이 간다)
     · 오늘 같은 종류를 이미 보낸 줄은 dup (again 이면 보낸다) */
  function targetsOf(to) { return to === 'none' ? [] : to === 'student' ? ['student'] : to === 'parent' ? ['parent1', 'parent2'] : ['parent1', 'parent2', 'student']; }
  function bodyFor(t, s) {
    if (st.kind !== 'nudge') return t === 'student' ? st.bodySt : st.bodyPa;
    if (t !== 'student') return weekWord(st.custom && !st.custom.nudgePa && s && st.pick ? tplOf('nudgePa', s.id) : st.bodyPa);
    if (st.custom && st.custom.nudge) return st.bodySt;
    return weekWord(s && st.pick ? tplOf('nudge', s.id) : st.bodySt);
  }
  function plan(list) {
    var out = { items: [], noPhone: [], noCode: [], dup: [], left: [], people: 0 };
    var ts = targetsOf(st.to), okBy = {};
    list.forEach(function (s) {
      if (st.off && st.off[s.id]) return;
      var mine = {}, anyNum = false;
      var pa = [digits(s.parentPhone), digits(s.parentPhone2)];
      var missing = [];
      if (ts.indexOf('parent1') !== -1 && !mobile(pa[0]) && !mobile(pa[1])) missing.push('학부모');
      if (ts.indexOf('student') !== -1 && !mobile(digits(s.studentPhone))) missing.push('학생');
      ts.forEach(function (t) {
        var d = digits(numberOf(s, t));
        if (!mobile(d)) return;
        anyNum = true;
        if (mine[d]) return;
        if (t === 'student' && ts.indexOf('parent1') !== -1 && pa.indexOf(d) !== -1) return;
        mine[d] = 1;
        var body = bodyFor(t, s);
        if (needCode(body) && !codeOf(s)) { out.noCode.push({ s: s, t: t }); return; }
        var k = s.id + '|' + t;
        if (ctx.sent[k] && !st.again) { out.dup.push({ s: s, t: t, at: ctx.sent[k] }); return; }
        var text = fill(body, s), b = bytes(text);
        var lf = leftOf(text);
        if (lf.length) { out.left.push({ s: s, t: t, left: lf }); return; }     /* 바뀌지 않은 칸 — 보내지 않음 (20261101m) */
        var it = { s: s, t: t, d: d, text: text, bytes: b, kind: b <= 90 ? 'SMS' : 'LMS', again: !!ctx.sent[k] };
        if (st.kind === 'nudge') it.no = noOf(it);
        out.items.push(it);
        okBy[s.id] = 1;
      });
      if (missing.length) out.noPhone.push({ s: s, what: missing.join(' · '), none: !anyNum });
    });
    out.people = Object.keys(okBy).length;
    out.lms = out.items.filter(function (x) { return x.kind === 'LMS'; }).length;
    return out;
  }
  function chosen() {
    var list;
    if (st.ids) list = st.ids.map(byId).filter(Boolean);
    else {
      var all = !Object.keys(st.classes).length;
      list = active().filter(function (s) { return (all || st.classes[clsOf(s)]) && (clsOf(s) === NOCLS || !Store.isArchivedClass(clsOf(s))); });
    }
    if (st.kind === 'entry' && st.onlyNew) list = list.filter(function (s) { return !ctx.logged[s.id]; });
    if (st.kind === 'welcome' && st.onlyNoApp) list = list.filter(function (s) { return !(Store.linkOf(s.id) || {}).appCode; });
    return sortList(list);
  }

  /* ---------- 보내기 (sms-send) ---------- */
  function sendItems(items) {
    var groups = {}, order = [];
    items.forEach(function (x) {
      var b = (x.pr ? 'P' : 'N') + '\n' + outBody(x);
      if (!groups[b]) { groups[b] = []; order.push(b); }
      groups[b].push(x);
    });
    var all = { ok: true, sent: 0, failed: 0, results: [], skipped: [], message: '' }, marks = [], marksPa = [];
    return order.reduce(function (p, key) {
      return p.then(function () {
        if (!all.ok) return null;
        var g = groups[key], vars = {}, body = key.slice(2), pr = key.charAt(0) === 'P';
        g.forEach(function (x) { var v = {}, c = codeOf(x.s), f = firstOf(x.s); if (c) v.code = c; if (f) v.first = f; if (v.code || v.first) vars[x.s.id] = v; });
        return Sms.invoke({
          action: 'send', body: body, items: g.map(function (x) { return { student_id: x.s.id, to: x.t }; }),
          ad: false, lessons: {}, siblings: true, markWeek: '', label: pr ? '과제 칭찬' : KIND[st.kind].label, purpose: pr ? 'praise' : st.kind, vars: vars
        }).then(function (r) {
          if (!r || !r.ok) { all.ok = all.sent > 0; all.message = (r && r.message) || '보내지 못했습니다.'; all.failed += g.length; g.forEach(function (x) { all.results.push({ student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: all.message }); }); return; }
          all.sent += r.sent || 0; all.failed += r.failed || 0;
          all.results = all.results.concat(r.results || []); all.skipped = all.skipped.concat(r.skipped || []);
          /* 간 줄의 문구 번호 (다음엔 다른 번호 · 20261108r) — 학부모 줄은 hw_tpl_mark_pa (092 · 20261110a) */
          (r.results || []).forEach(function (y) {
            if (!y.ok) return;
            var x = g.find(function (z) { return z.s.id === y.student_id && z.t === y.to; });
            if (!x || !x.no) return;
            var row = { student_id: y.student_id, kind: pr ? 'praise' : 'nudge', no: x.no };
            if (y.to === 'student') marks.push(row);
            else if (!marksPa.some(function (m) { return m.student_id === row.student_id && m.kind === row.kind; })) marksPa.push(row);
          });
        });
      });
    }, Promise.resolve()).then(function () {
      if (!marks.length) return null;
      return rpc('hw_tpl_mark', { p_rows: marks }).catch(function () { return null; });
    }).then(function () {
      if (!marksPa.length) return null;
      return rpc('hw_tpl_mark_pa', { p_rows: marksPa }).catch(function () { return null; });
    }).then(function () {
      window.dispatchEvent(new CustomEvent('jt:welcome-sent', { detail: { kind: st.kind } }));
      return all;
    });
  }
  /* 바뀌지 않은 칸이 남아 보내지 않은 사람 — 실패로 「바뀌지 않은 칸이 있어 보내지 않음: {밀린날짜}」 (20261101m) */
  function addLeft(res, p) {
    if (!res || !p || !p.left || !p.left.length) return res;
    res.failed = (res.failed || 0) + p.left.length;
    res.results = (res.results || []).concat(p.left.map(function (x) { return { student_id: x.s.id, to: x.t, name: x.s.name, ok: false, error: leftMsg(x.left) }; }));
    return res;
  }
  function failNames(res) {
    var seen = {};
    return (res.results || []).filter(function (x) { return !x.ok; }).map(function (x) { return (x.name || '') + (TO_LABEL[x.to] ? '(' + TO_LABEL[x.to] + ')' : ''); })
      .filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
  }
  function resultText(res, p) {
    var bad = failNames(res);
    return '보냄 ' + (res.sent || 0) + '건 · 실패 ' + (res.failed || 0) + '건' + (bad.length ? '(' + bad.slice(0, 8).join(', ') + (bad.length > 8 ? ' 외 ' + (bad.length - 8) : '') + ')' : '') +
      (p && p.noPhone.length ? ' · 번호 없음 ' + p.noPhone.length + '명' : '') +
      (p && p.dup.length ? ' · 오늘 이미 보냄 ' + p.dup.length + '건 뺌' : '');
  }

  /* ---------- 창 ---------- */
  function modal() { return $('#wcModal'); }
  function openDialog(o) {
    st = {
      kind: o.kind, ids: o.ids || null, single: !!o.single, classes: {}, cls: o.cls || '',
      to: o.kind === 'entry' ? 'student' : (o.to || 'both'), onlyNew: true, onlyNoApp: o.kind === 'welcome' && !!o.cls,
      again: false, code: o.code || '', bodySt: '', bodyPa: '', busy: false, res: null, loading: true,
      miss: o.miss || null, off: {}, toSt: true, toPa: false,
      pr: o.kind === 'nudge' ? { ids: o.praise || [], total: o.total || {}, on: true, off: {}, body: '', bodyPa: '', toSt: true, toPa: false } : null,
      period: o.period || null, hist: null, tab: (o.ids || []).length ? 'nudge' : 'praise', open: {},
      custom: o.kind === 'nudge' ? { nudge: false, praise: false, nudgePa: false, praisePa: false } : null, pick: null, lastNo: null
    };
    if (o.kind === 'nudge') { st.to = 'student'; st.again = true; }      /* 오늘 이미 받은 학생은 체크를 풀어 두고 시작 — 다시 체크하면 보낸다 (20261108r) */
    var dlg = modal(); if (dlg) dlg.classList.toggle('wc-modal--hw', o.kind === 'nudge');
    if (o.cls) st.classes[o.cls] = true;
    $('#wcTitle').textContent = KIND[o.kind].title;
    $('#wcBody').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    if (!modal().open) Layer.show(modal());
    return load(o.kind).then(function () {
      if (o.kind === 'entry') st.bodySt = tplBody('입구 안내', ENTRY_BODY);
      else if (o.kind === 'nudge') hwSetup();
      else { st.bodySt = tplBody('신입생 웰컴(학생)', WEL_ST); st.bodyPa = tplBody('신입생 웰컴(학부모)', WEL_PA); }
      st.loading = false;
      paint();
    }, function (e) { $('#wcBody').innerHTML = '<p class="cp-warn">불러오지 못했습니다 — ' + esc(e.message) + '</p>'; });
  }

  /* 과제 문자 창을 열 때 — 문구 칸(첫 번호 글) · 학생마다 차례 번호 · 오늘 이미 받은 학생 체크 풀기 */
  function hwSetup() {
    st.bodyPa = st.bodyPaInit = hwTpls('nudgePa')[0].body;
    st.bodySt = st.bodyStInit = hwTpls('nudge')[0].body;
    st.pr.body = st.prInit = hwTpls('praise')[0].body;
    st.pr.bodyPa = st.prPaInit = hwTpls('praisePa')[0].body;
    hwRefresh();
  }
  /* 보낸 뒤 다시 — 번호 차례 · 오늘 받은 학생 체크 풀기 (고친 글 · 직접 고른 체크는 그대로) */
  function hwRefresh() {
    st.lastNo = {}; st.pick = {};
    HW_KINDS.forEach(function (k) { st.lastNo[k] = {}; st.pick[k] = {}; });
    (st.hist || []).forEach(function (r) {         /* 시각 순 — 마지막이 남는다 · 학부모는 pno (092) */
      if (r.how !== 'manual' || !st.lastNo[r.kind]) return;
      if (r.no != null) st.lastNo[r.kind][r.student_id] = r.no;
      if (r.pno != null) st.lastNo[r.kind + 'Pa'][r.student_id] = r.pno;
    });
    st.ids.forEach(function (id) { st.pick.nudge[id] = nextNo('nudge', id); st.pick.nudgePa[id] = nextNo('nudgePa', id); if (gotToday('nudge', id)) st.off[id] = true; });
    st.pr.ids.forEach(function (id) { st.pick.praise[id] = nextNo('praise', id); st.pick.praisePa[id] = nextNo('praisePa', id); if (gotToday('praise', id)) st.pr.off[id] = true; });
  }
  function whoHtml() {
    if (st.kind === 'nudge') return picksHtml('nudge');
    if (st.ids) {
      var list = st.ids.map(byId).filter(Boolean);
      return '<p class="wc-who">받는 사람: <b>' + esc(list.map(function (s) { return s.name + '(' + clsOf(s) + ')'; }).slice(0, 4).join(', ') + (list.length > 4 ? ' 외 ' + (list.length - 4) + '명' : '')) + '</b></p>';
    }
    if (st.kind === 'welcome') return '<p class="wc-who">받는 반: <b>' + esc(st.cls) + '</b></p>';
    var names = classNames(), none = !Object.keys(st.classes).length;
    return '<div class="wc-cls" role="group" aria-label="받는 반">' +
      '<button type="button" class="chip' + (none ? ' is-on' : '') + '" data-wc-cls="" aria-pressed="' + none + '">전체</button>' +
      names.map(function (n) { var on = !!st.classes[n]; return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-wc-cls="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + '</button>'; }).join('') + '</div>';
  }
  function toHtml() {
    if (st.kind === 'entry') return '<p class="wc-note">학생 본인 번호로만 보냅니다.</p>';
    if (st.kind === 'nudge') return hwToHtml('wc', st.toSt, st.toPa, '독려 받는 사람');
    return '<div class="wc-to" role="radiogroup" aria-label="받는 사람">' + [['student', '학생'], ['parent', '학부모'], ['both', '둘 다']].map(function (x) {
      return '<label class="wc-to__opt' + (st.to === x[0] ? ' is-on' : '') + '"><input type="radio" name="wcTo" value="' + x[0] + '"' + (st.to === x[0] ? ' checked' : '') + '> ' + x[1] + '</label>';
    }).join('') + '</div>';
  }
  /* 과제 문자 받는 사람 두 칸 — 독려(wcToSt · wcToPa) · 칭찬(wcPrToSt · wcPrToPa) 같은 모양 (20261110a) */
  function hwToHtml(pre, s, p, label) {
    return '<div class="wc-to wc-to--hw" role="group" aria-label="' + label + '">' +
      '<label class="wc-to__opt' + (s ? ' is-on' : '') + '"><input type="checkbox" id="' + pre + 'ToSt"' + (s ? ' checked' : '') + '> 학생에게</label>' +
      '<label class="wc-to__opt' + (p ? ' is-on' : '') + '"><input type="checkbox" id="' + pre + 'ToPa"' + (p ? ' checked' : '') + '> 학부모에게도</label></div>';
  }
  function filterHtml() {
    if (st.kind === 'entry') return '<label class="check-line wc-filter"><input type="checkbox" id="wcOnlyNew"' + (st.onlyNew ? ' checked' : '') + '> <span>아직 한 번도 로그인 안 한 학생만</span></label>';
    if (!st.ids) return '<label class="check-line wc-filter"><input type="checkbox" id="wcOnlyNoApp"' + (st.onlyNoApp ? ' checked' : '') + '> <span>아직 앱 링크 연결 안 된 학생만</span></label>';
    return '';
  }
  function bodyHtml() {
    var ts = targetsOf(st.to), html = '';
    var area = function (id, label, val) {
      return '<label class="field wc-text"><span class="field__label">' + label + '</span><textarea class="input" id="' + id + '" rows="5">' + esc(val) + '</textarea></label>';
    };
    if (st.kind === 'entry') html += area('wcBodySt', '문구 <span class="field__opt">이 창에서 고친 글은 이번에만 · 기본 문구는 「문자 발송 → 자주 쓰는 문구」의 「입구 안내」</span>', st.bodySt);
    else if (st.kind === 'nudge') {
      if (ts.indexOf('student') !== -1) html += area('wcBodySt', '학생에게 갈 문구' + rotLabel('nudge'), st.bodySt) + rotBack('nudge');
      if (ts.indexOf('parent1') !== -1) html += area('wcBodyPa', '학부모에게 갈 문구' + rotLabel('nudgePa'), st.bodyPa) + rotBack('nudgePa');
      html += rotating('nudge')
        ? '<p class="field__hint">문구는 「문자 발송 → 자주 쓰는 문구」의 「과제 독려(학생) 1~' + hwTpls('nudge').slice(-1)[0].no + '」' +
          (ts.indexOf('parent1') !== -1 && rotating('nudgePa') ? ' · 「과제 독려(학부모) 1~' + hwTpls('nudgePa').slice(-1)[0].no + '」' : '') + '에서 고치거나 더하거나 뺍니다' +
          (ts.indexOf('parent1') !== -1 && !rotating('nudgePa') ? ' · 학부모 글은 <button type="button" class="btn btn--sm btn--ghost" data-wc-savetpl>문구 관리에 저장</button> (「과제 독려(학부모)」)' : '') + ' · {밀린날짜}는 학생마다 바뀝니다' + (st.period && st.period.word === '이번 주' ? ' · 이번 주 기준이라 「지난주」는 「이번 주」로 바꿔 보냅니다' : '') + '</p>'
        : '<p class="field__hint">고친 글은 <button type="button" class="btn btn--sm btn--ghost" data-wc-savetpl>문구 관리에 저장</button>을 누르면 다음부터 기본 문구가 됩니다 (「과제 독려(학생)」 · 「과제 독려(학부모)」) · {밀린날짜}는 학생마다 바뀝니다</p>';
    } else {
      if (ts.indexOf('student') !== -1) html += area('wcBodySt', '학생용 문구', st.bodySt);
      if (ts.indexOf('parent1') !== -1) html += area('wcBodyPa', '학부모용 문구', st.bodyPa);
      html += '<p class="field__hint">이 창에서 고친 글은 이번에만 씁니다 · 기본 문구는 「문자 발송 → 자주 쓰는 문구」의 「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」</p>';
    }
    return html + '<p class="field__hint wc-vars">쓸 수 있는 칸: {학생이름} {반이름} {첫수업일} {앱입장코드} {러닝노트주소} — 학생마다 바뀝니다</p>';
  }
  function blockOf() {
    if (ctx.smsMissing) return 'migration-023 · 040 SQL 을 실행하고 sms-send 를 배포해야 문자를 보낼 수 있습니다.';
    if (ctx.missing) return 'migration-052 SQL 을 먼저 실행해 주세요 (입구 · 웰컴 문자 칸 · 「오늘 이미 보냄」).';
    var ts = targetsOf(st.to);
    if (st.kind === 'nudge' && !st.ids.length) return prEmpty();
    if (st.kind === 'nudge' && !ts.length && st.pr && st.pr.ids.length) return '';         /* 독려 받는 사람을 다 끄면 칭찬만 */
    if (!ts.length) return '받는 사람(학생에게 · 학부모에게도)을 하나 이상 골라 주세요.';
    if (st.kind === 'nudge' && prEmpty()) return prEmpty();
    var bodies = [ts.indexOf('student') !== -1 ? st.bodySt : '', ts.indexOf('parent1') !== -1 ? st.bodyPa : ''].filter(function (b) { return b !== ''; });
    if (bodies.some(function (b) { return !String(b).trim(); })) return '문구를 적어 주세요.';
    if (bodies.some(needApp) && !ctx.links) return '「문자 발송 → 연결 상태」에서 앱 설치 링크를 먼저 넣어 주세요.';
    return '';
  }
  /* 칭찬 문구가 비었는지 — 고른 받는 사람 쪽만 본다 */
  function prEmpty() {
    if (!st.pr || !st.pr.on || !st.pr.ids.length) return '';
    if (st.pr.toSt && !String(st.pr.body).trim()) return '칭찬 문구를 적어 주세요.';
    if (st.pr.toPa && !String(st.pr.bodyPa).trim()) return '학부모에게 갈 칭찬 문구를 적어 주세요.';
    return '';
  }
  /* ---------- 과제 문자 — 칭찬 묶음 ----------
     받는 사람 [학생에게](기본) [학부모에게도] (20261110a) — 독려와 같은 규칙: 학부모 2 가 1 과 같으면 한 번 · 학생 번호가 학부모 번호와 같으면 학생 줄은 뺀다
     학부모 번호가 없는 학생은 학부모 쪽에서만 빠진다 (이름 옆 「학부모 번호 없음」) */
  function planPraise() {
    var out = { items: [], noPhone: [], praised: [], left: [], people: 0, lms: 0 };
    if (!st.pr) return out;
    var ts = (st.pr.toPa ? ['parent1', 'parent2'] : []).concat(st.pr.toSt ? ['student'] : []);
    st.pr.ids.map(byId).filter(Boolean).forEach(function (s) {
      if (!st.pr.on || st.pr.off[s.id] || !ts.length) return;            /* 오늘 이미 받은 학생은 처음에 체크가 풀려 있다 — 다시 체크하면 보낸다 (20261108r) */
      var pa = [digits(s.parentPhone), digits(s.parentPhone2)], mine = {}, missing = [], anyNum = false;
      if (st.pr.toPa && !mobile(pa[0]) && !mobile(pa[1])) missing.push('학부모');
      if (st.pr.toSt && !mobile(digits(s.studentPhone))) missing.push('학생');
      ts.forEach(function (t) {
        var d = digits(numberOf(s, t));
        if (!mobile(d)) return;
        anyNum = true;
        if (mine[d]) return;
        if (t === 'student' && st.pr.toPa && pa.indexOf(d) !== -1) return;
        mine[d] = 1;
        var text = fill(prBody(s, t), s), b = bytes(text), lf = leftOf(text);
        if (lf.length) { out.left.push({ s: s, t: t, left: lf }); return; }
        var it = { s: s, t: t, d: d, text: text, bytes: b, kind: b <= 90 ? 'SMS' : 'LMS', pr: true };
        it.no = noOf(it);
        out.items.push(it);
      });
      if (missing.length) out.noPhone.push({ s: s, what: missing.join(' · '), none: !anyNum });
    });
    out.people = uniq(out.items);
    out.lms = out.items.filter(function (x) { return x.kind === 'LMS'; }).length;
    return out;
  }
  /* 묶음 미리보기 — 독려는 예전과 같은 id(wcPreview) · 칭찬은 wcPreviewPr */
  function pvHtml(ex, label, id) {
    return '<div class="sms-pv wc-pv"><div class="sms-pv__head">' + esc(label) + ' 미리보기 — ' + esc(ex.s.name) + ' · ' + (ex.t === 'student' ? '학생 본인' : '학부모') + ' <span class="num">…' + esc(ex.d.slice(-4)) + '</span> ' +
      (ex.no ? '<span class="wc-pv__no num">문구 ' + ex.no + '번</span> ' : '') +
      '<span class="sms-kind sms-kind--' + ex.kind + '">' + (ex.kind === 'SMS' ? '단문' : '장문') + ' ' + ex.bytes + '바이트</span></div><pre class="sms-pv__text" id="' + id + '">' + esc(ex.text) + '</pre></div>';
  }
  /* 학생마다 갈 글 모두 (문구가 학생마다 다르다) */
  function pvAllHtml(items, kind) {
    if (items.length < 2) return '';
    return '<details class="wc-pv-all" data-wc-pvall="' + kind + '"' + (st.pvOpen && st.pvOpen[kind] ? ' open' : '') + '><summary>학생마다 갈 글 모두 보기 (' + items.length + '건)</summary><ol class="wc-pv-all__list">' + items.map(function (x) {
      return '<li><div class="wc-pv-all__h"><b>' + esc(x.s.name) + '</b> · ' + (x.t === 'student' ? '학생' : '학부모') + (x.no ? ' · <span class="num">문구 ' + x.no + '번</span>' : '') + '</div><pre class="sms-pv__text">' + esc(x.text) + '</pre></li>';
    }).join('') + '</ol></details>';
  }
  /* 문구 칸 이름 꼬리 · [돌려 쓰기로 되돌리기] */
  function rotLabel(kind) {
    if (!rotating(kind)) return '';
    return st.custom[kind] ? ' <span class="field__opt wc-rot is-custom">직접 고친 글 — 모두에게 이 글</span>' : ' <span class="field__opt wc-rot">' + esc(rangeText(kind)) + '을 학생마다 돌려 씁니다 · 고치면 모두에게 이 글</span>';
  }
  function rotBack(kind) {
    return rotating(kind) && st.custom[kind] ? '<p class="wc-rot-back"><button type="button" class="btn btn--sm btn--ghost" data-wc-unrot="' + kind + '">' + esc(rangeText(kind)) + ' 돌려 쓰기로 되돌리기</button></p>' : '';
  }
  /* 학생 줄 — 체크 · 이름 · 안 낸 날짜(독려) / 낸 과제 수(칭찬) · 이번 기간 발송 이력 (누르면 펼침) */
  function picksHtml(kind) {
    var isN = kind === 'nudge', ids = isN ? st.ids : st.pr.ids;
    return '<ul class="wc-picks wc-picks--hw" aria-label="' + (isN ? '독려 받는 학생' : '칭찬 받는 학생') + '">' + ids.map(byId).filter(Boolean).map(function (s) {
      var off = isN ? st.off[s.id] : st.pr.off[s.id];
      var today = gotToday(kind, s.id), many = st.hist && winRows(s.id, 'nudge').length >= 3;
      var toS = isN ? st.toSt : st.pr.toSt, toP = isN ? st.toPa : st.pr.toPa;
      var noNum = toS && !mobile(digits(s.studentPhone));
      var noPa = toP && !mobile(digits(s.parentPhone)) && !mobile(digits(s.parentPhone2));
      var key = kind + ':' + s.id, open = !!st.open[key];
      return '<li class="wc-row" data-wc-row="' + esc(s.id) + '"><label class="wc-pick' + (off ? ' is-off' : '') + '"><input type="checkbox" ' + (isN ? 'data-wc-off' : 'data-wc-proff') + '="' + esc(s.id) + '"' + (off ? '' : ' checked') + '>' +
        '<span class="wc-pick__n">' + esc(s.name) + '</span>' +
        (many ? '<small class="wc-pick__tag is-many" title="이번 기간 독려를 3번 이상 받았어요 — 문자 대신 상담이 필요한지 봐 주세요">독려 많음</small>' : '') +
        '<span class="wc-pick__d num">' + esc(isN ? (st.miss[s.id] || '') : (st.pr.total[s.id] || 0) + '개 모두') + '</span>' +
        (today ? '<small class="wc-pick__tag is-today">오늘 이미 받음</small>' : '') + (noNum ? '<small class="wc-pick__tag is-mute">' + (toP ? '학생 번호 없음' : '번호 없음') + '</small>' : '') +
        (noPa ? '<small class="wc-pick__tag is-mute" data-wc-nopa>학부모 번호 없음</small>' : '') + '</label>' +
        (st.hist ? '<button type="button" class="wc-hist num" data-wc-hist="' + esc(key) + '" aria-expanded="' + open + '">' + esc(histLine(kind, s.id)) + '<span class="wc-hist__arrow" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>' +
          (open ? '<div class="wc-hist__box">' + histList(s.id) + '</div>' : '') : '') + '</li>';
    }).join('') + '</ul>';
  }
  /* 맨 위 — 기준 기간 · 수업 뒤 안내 */
  function periodHtml() {
    var P = st.period;
    if (!P) return '';
    var html = '<div class="wc-period" id="wcPeriod"><b class="wc-period__t num">' + esc(P.fromLabel + '~' + P.toLabel + ' 과제 기준') + '</b>' +
      (P.lessonLabel ? '<span class="wc-period__s num">' + esc(P.lessonLabel + ' 수업 전 주') + '</span>' : '') + '</div>';
    var range = P.hwFrom === P.hwTo ? P.hwFrom : P.hwFrom + '~' + P.hwTo;
    if (P.after === 'today') html += '<p class="wc-after" id="wcAfter">오늘 수업은 끝났어요. 지금 보내면 지난주(' + esc(range) + ') 과제 기준이에요</p>';
    else if (P.after === 'nonew') html += '<p class="wc-after" id="wcAfter">새 주 과제가 아직 없어요. 지금 보내면 지난주(' + esc(range) + ') 과제 기준이에요</p>';
    if (!st.hist) html += '<p class="wc-note">학생별 발송 이력 · 문구 돌려 쓰기는 migration-086 SQL 을 실행하면 보입니다.</p>';
    return html;
  }
  function paintHw() {
    var p = plan(chosen()), q = planPraise(), block = blockOf();
    var nN = st.ids.length, pN = st.pr.ids.length, both = !!(nN && pN);
    if (!both) st.tab = nN ? 'nudge' : 'praise';
    var chk = function (ids, off) { return ids.filter(function (id) { return byId(id) && !off[id]; }).length; };
    var cN = chk(st.ids, st.off), cP = chk(st.pr.ids, st.pr.off);
    var html = periodHtml();
    if (both) {
      html += '<div class="wc-tabs" role="tablist" aria-label="독려 · 칭찬">' +
        '<button type="button" role="tab" class="wc-tab' + (st.tab === 'nudge' ? ' is-on' : '') + '" data-wc-tab="nudge" aria-selected="' + (st.tab === 'nudge') + '">독려 <b class="num">' + nN + '</b>명 <small class="wc-tab__n num">' + cN + '/' + nN + '</small></button>' +
        '<button type="button" role="tab" class="wc-tab wc-tab--pr' + (st.tab === 'praise' ? ' is-on' : '') + '" data-wc-tab="praise" aria-selected="' + (st.tab === 'praise') + '">칭찬 <b class="num">' + pN + '</b>명 <small class="wc-tab__n num">' + cP + '/' + pN + '</small></button></div>';
    }
    html += '<div class="wc-hw' + (both ? ' has-tabs' : '') + '">';
    if (nN) {
      html += '<section class="wc-sec wc-grp' + (st.tab === 'nudge' ? ' is-on' : '') + '" data-wc-grp="nudge"><h3 class="wc-grp__t">독려 <b class="num">' + nN + '</b>명 <small class="muted-note">안 낸 과제가 있는 학생</small></h3>' +
        toHtml() + whoHtml() + bodyHtml() + (p.items[0] ? pvHtml(p.items[0], '독려', 'wcPreview') + pvAllHtml(p.items, 'nudge') : '<p class="panel__hint">독려를 보낼 사람이 없습니다.</p>') + '</section>';
    }
    if (pN) {
      var prHint = [];
      if (st.pr.toSt) prHint.push(rotating('praise') ? '「과제 칭찬(학생) 1~' + hwTpls('praise').slice(-1)[0].no + '」' : '「과제 칭찬(학생)」');
      if (st.pr.toPa) prHint.push(rotating('praisePa') ? '「과제 칭찬(학부모) 1~' + hwTpls('praisePa').slice(-1)[0].no + '」' : '「과제 칭찬(학부모)」');
      html += '<section class="wc-sec wc-grp' + (st.tab === 'praise' ? ' is-on' : '') + '" data-wc-grp="praise"><h3 class="wc-grp__t">칭찬 <b class="num">' + pN + '</b>명 <small class="muted-note">나온 과제를 모두 낸 학생</small></h3>' +
        hwToHtml('wcPr', st.pr.toSt, st.pr.toPa, '칭찬 받는 사람') +
        picksHtml('praise') +
        (st.pr.toSt ? '<label class="field wc-text"><span class="field__label">' + (st.pr.toPa ? '학생에게 갈 문구' : '칭찬 문구') + rotLabel('praise') + '</span><textarea class="input" id="wcBodyPr" rows="4">' + esc(st.pr.body) + '</textarea></label>' + rotBack('praise') : '') +
        (st.pr.toPa ? '<label class="field wc-text"><span class="field__label">학부모에게 갈 문구' + rotLabel('praisePa') + '</span><textarea class="input" id="wcBodyPrPa" rows="4">' + esc(st.pr.bodyPa) + '</textarea></label>' + rotBack('praisePa') : '') +
        '<p class="field__hint">{전체}는 학생마다 그 기간 지금까지 나온 과제 수' + (prHint.length ? ' · 문구는 「문자 발송 → 자주 쓰는 문구」의 ' + prHint.join(' · ') + '에서 고칩니다' : ' · 받는 사람(학생에게 · 학부모에게도)을 고르면 칭찬을 보냅니다') + '</p>' +
        (q.items[0] ? pvHtml(q.items[0], '칭찬', 'wcPreviewPr') + pvAllHtml(q.items, 'praise') : '<p class="panel__hint">칭찬을 보낼 사람이 없습니다.</p>') + '</section>';
    }
    html += '</div>';
    var people = p.people + q.people, n = p.items.length + q.items.length, lms = p.lms + q.lms;
    html += '<p class="wc-sum"><b class="num">' + people + '</b>명 · 문자 <b class="num">' + n + '</b>건' + (lms ? ' (장문 ' + lms + ')' : '') +
      (nN ? ' · 독려 <b class="num">' + p.people + '</b>' : '') + (pN ? ' · 칭찬 <b class="num">' + q.people + '</b>' : '') +
      sumNoPhone(p.noPhone.concat(q.noPhone)) + '</p>';
    var left = p.left.concat(q.left);
    if (left.length) {
      var lk = [], ln = [];
      left.forEach(function (x) { if (ln.indexOf(x.s.name) === -1) ln.push(x.s.name); x.left.forEach(function (k) { if (lk.indexOf(k) === -1) lk.push(k); }); });
      html += '<p class="cp-warn" id="wcLeft">⚠ 바뀌지 않은 칸이 있어 ' + ln.length + '명에게는 보내지 않습니다: <b>' + esc(lk.join(' ')) + '</b> (' + esc(ln.slice(0, 8).join(' · ')) + (ln.length > 8 ? ' 외 ' + (ln.length - 8) + '명' : '') + ')</p>';
    }
    if (block) html += '<p class="cp-warn" id="wcBlock">' + esc(block) + '</p>';
    if (st.res) html += '<p class="wc-res ' + (st.res.failed || !st.res.ok ? 'is-bad' : 'is-ok') + '" id="wcResult">' + esc(st.resText) + '</p>';
    html += '<div class="wc-foot"><button type="button" class="btn" id="wcCancel">닫기</button>' +
      '<button type="button" class="btn btn--primary" id="wcSend"' + (!n || block || st.busy ? ' disabled' : '') + '>' + (st.busy ? '보내는 중…' : sendLabel(p, q)) + '</button></div>';
    var focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart;
    $('#wcBody').innerHTML = html;
    if (focus && $('#' + focus)) { var el = $('#' + focus); el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} }
    st.plan = { items: p.items.concat(q.items), people: people, lms: lms, noPhone: p.noPhone.concat(q.noPhone), dup: p.dup, left: left, nudge: p, praise: q };
  }
  /* 맨 아래 한 줄 — 「번호 없음 n명」(아무 번호도 없음) · 「학부모 번호 없음 n명」(학부모 쪽만 빠짐) */
  function sumNoPhone(list) {
    var none = {}, part = {};
    list.forEach(function (x) { if (x.none) none[x.s.id] = 1; else if (x.what === '학부모') part[x.s.id] = 1; });
    var n = Object.keys(none).length, a = Object.keys(part).filter(function (k) { return !none[k]; }).length;
    var other = list.filter(function (x) { return !x.none && x.what !== '학부모'; }).length;
    return (n + other ? ' · 번호 없음 <b class="num">' + (n + other) + '</b>명' : '') + (a ? ' · 학부모 번호 없음 <b class="num">' + a + '</b>명' : '');
  }
  /* 「독려 5명 · 칭찬 5명(학부모 5명 포함) 보내기」 — 실제 보낼 학생 수 (체크 · 번호 있음) · 학부모에게 가는 학생 수 (20261110a) */
  function sendLabel(p, q) {
    var one = function (w, x) {
      if (!x.people) return '';
      var pa = sideCount(x.items, true);
      return w + ' ' + x.people + '명' + (pa ? '(학부모 ' + pa + '명 포함)' : '');
    };
    var parts = [one('독려', p), one('칭찬', q)].filter(Boolean);
    return parts.length ? parts.join(' · ') + ' 보내기' : '보낼 사람 없음';
  }
  /* 확인 창 — 「독려: 학생 5명 · 학부모 3명」 */
  function sideText(w, x) {
    if (!x || !x.people) return '';
    var a = sideCount(x.items, false), b = sideCount(x.items, true);
    return w + ': ' + [a ? '학생 ' + a + '명' : '', b ? '학부모 ' + b + '명' : ''].filter(Boolean).join(' · ');
  }

  function paint() {
    if (!st || st.loading) return;
    if (st.kind === 'nudge') { paintHw(); return; }
    var list = chosen(), p = plan(list), block = blockOf();
    var ex = p.items[0];
    var html = '<section class="wc-sec">' + whoHtml() + toHtml() + filterHtml() + '</section>' +
      '<section class="wc-sec">' + bodyHtml() + '</section>';
    html += '<p class="wc-sum"><b class="num">' + p.people + '</b>명 · 문자 <b class="num">' + p.items.length + '</b>건' + (p.lms ? ' (장문 ' + p.lms + ')' : '') +
      ' · 번호 없음 <b class="num">' + p.noPhone.length + '</b>명' + (p.dup.length ? ' · 오늘 이미 보냄 <b class="num">' + p.dup.length + '</b>건 (뺌)' : '') + '</p>';
    if (p.noPhone.length) html += '<p class="wc-miss">번호 없음: ' + esc(p.noPhone.slice(0, 12).map(function (x) { return x.s.name + '(' + x.what + ')'; }).join(', ') + (p.noPhone.length > 12 ? ' 외 ' + (p.noPhone.length - 12) + '명' : '')) + '</p>';
    var dn = st.again ? p.items.filter(function (x) { return x.again; }).length : p.dup.length;
    if (dn) {
      html += '<label class="check-line wc-again"><input type="checkbox" id="wcAgain"' + (st.again ? ' checked' : '') + '> <span>오늘 이미 보낸 ' + dn + '건도 다시 보내기 <span class="field__opt">' +
        esc((st.again ? p.items.filter(function (x) { return x.again; }) : p.dup).slice(0, 6).map(function (x) { return x.s.name + '(' + TO_LABEL[x.t] + ')'; }).join(', ')) + '</span></span></label>';
    }
    if (p.noCode.length) html += '<p class="cp-warn">앱 핀번호(입장코드)가 없는 학생 ' + uniq(p.noCode) + '명은 보내지 않습니다 — 반 관리 또는 「오늘」 반 카드에서 그 반 「앱 핀번호(입장코드)」를 넣어 주세요.</p>';
    if (p.left.length) {
      var lk = [], ln = [];
      p.left.forEach(function (x) { if (ln.indexOf(x.s.name) === -1) ln.push(x.s.name); x.left.forEach(function (k) { if (lk.indexOf(k) === -1) lk.push(k); }); });
      html += '<p class="cp-warn" id="wcLeft">⚠ 바뀌지 않은 칸이 있어 ' + ln.length + '명에게는 보내지 않습니다: <b>' + esc(lk.join(' ')) + '</b> (' + esc(ln.slice(0, 8).join(' · ')) + (ln.length > 8 ? ' 외 ' + (ln.length - 8) + '명' : '') + ')</p>';
    }
    if (block) html += '<p class="cp-warn" id="wcBlock">' + esc(block) + '</p>';
    html += ex
      ? '<div class="sms-pv wc-pv"><div class="sms-pv__head">미리보기 — ' + esc(ex.s.name) + ' · ' + (ex.t === 'student' ? '학생 본인' : '학부모') + ' <span class="num">…' + esc(ex.d.slice(-4)) + '</span> <span class="sms-kind sms-kind--' + ex.kind + '">' + (ex.kind === 'SMS' ? '단문' : '장문') + ' ' + ex.bytes + '바이트</span></div><pre class="sms-pv__text" id="wcPreview">' + esc(ex.text) + '</pre></div>'
      : '<p class="panel__hint">보낼 사람이 없습니다.</p>';
    if (st.res) html += '<p class="wc-res ' + (st.res.failed || !st.res.ok ? 'is-bad' : 'is-ok') + '" id="wcResult">' + esc(st.resText) + '</p>';
    html += '<div class="wc-foot"><button type="button" class="btn" id="wcCancel">닫기</button>' +
      '<button type="button" class="btn btn--primary" id="wcSend"' + (!p.items.length || block || st.busy ? ' disabled' : '') + '>' + (st.busy ? '보내는 중…' : p.people + '명에게 보내기') + '</button></div>';
    var focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart;
    $('#wcBody').innerHTML = html;
    if (focus && $('#' + focus)) { var el = $('#' + focus); el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} }
    st.plan = p;
  }
  function uniq(list) { var m = {}; list.forEach(function (x) { m[x.s.id] = 1; }); return Object.keys(m).length; }
  /* 확인 창 — 번호가 하나도 없는 사람은 「뺍니다」 · 학부모 번호만 없는 사람은 「학부모 쪽만 뺍니다」 (20261110a) */
  function noPhoneText(list) {
    var none = {}, pa = {}, other = {};
    (list || []).forEach(function (x) {
      if (x.none) none[x.s.id] = 1;
      else if (x.what === '학부모') pa[x.s.id] = 1;
      else other[x.s.id] = 1;
    });
    var n = Object.keys(none).length, a = Object.keys(pa).filter(function (k) { return !none[k]; }).length, o = Object.keys(other).filter(function (k) { return !none[k]; }).length;
    return (n ? ' 번호 없음 ' + n + '명은 뺍니다.' : '') + (a ? ' 학부모 번호 없음 ' + a + '명은 학부모 쪽만 뺍니다.' : '') + (o ? ' 학생 번호 없음 ' + o + '명은 학생 쪽만 뺍니다.' : '');
  }

  function send() {
    var p = st.plan;
    if (!p || !p.items.length || st.busy) return;
    var desc = p.people + '명에게 보냅니다 — 문자 ' + p.items.length + '건' + (p.lms ? ' (장문 ' + p.lms + ')' : '') + '.' +
      (p.praise ? ' ' + [sideText('독려', p.nudge), sideText('칭찬', p.praise)].filter(Boolean).join(' / ') + '.' + (rotating('nudge') || rotating('praise') ? ' 문구는 학생마다 돌려 씁니다.' : '') : '') +
      noPhoneText(p.noPhone) +
      (p.dup.length ? ' 오늘 이미 보낸 ' + p.dup.length + '건은 뺍니다.' : '') +
      (p.items.some(function (x) { return x.again; }) ? ' 오늘 이미 보낸 사람에게 한 번 더 보냅니다.' : '') +
      (p.left.length ? ' ⚠ 바뀌지 않은 칸이 있어 ' + uniq(p.left) + '명에게는 보내지 않습니다.' : '') +
      ' 보낸 기록에 「' + KIND[st.kind].label + '」' + (p.praise && p.praise.people ? ' · 「과제 칭찬」' : '') + '으로 남습니다.';
    /* 먼저 나에게 보내 보기 — 첫 사람 글 그대로 한 통 (sms.js testTo · 20261108q) */
    var x0 = p.items[0];
    var test = { phone: Sms.myPhone ? Sms.myPhone() || '' : '', run: function (ph) {
      var v = {}, c = codeOf(x0.s), f = firstOf(x0.s), vars = {};
      if (c) v.code = c;
      if (f) v.first = f;
      if (v.code || v.first) vars[x0.s.id] = v;
      return Sms.testTo(ph, function () {
        return Sms.invoke({ action: 'test', body: outBody(x0), items: [{ student_id: x0.s.id, to: x0.t }], ad: false, lessons: {}, siblings: true, markWeek: '',
          label: x0.pr ? '과제 칭찬' : KIND[st.kind].label, purpose: x0.pr ? 'praise' : st.kind, vars: vars });
      });
    } };
    UI.confirmAsk(p.people === 1 ? '1명에게만 보냅니다. 맞나요?' : KIND[st.kind].title, desc, '보내기', null, { test: test }).then(function (yes) {
      if (!yes) return;
      st.busy = true; paint();
      sendItems(p.items).then(function (res) {
        addLeft(res, p);
        st.busy = false; st.res = res; st.resText = resultText(res, p);
        toast(st.resText, res.failed || !res.ok ? 'bad' : 'good');
        return load(st.kind).then(function () { if (st.kind === 'nudge') hwRefresh(); paint(); });
      });
    });
  }

  /* ---------- 창 없이 바로 (한 명 등록 · 엑셀 뒤 [보내기]) ---------- */
  function sendNow(ids, o) {
    o = o || {};
    st = { kind: 'welcome', ids: ids, to: o.to || 'both', code: o.code || '', again: false, classes: {}, quiet: true };
    var mine = st;
    return load('welcome').then(function () {
      if (st !== mine) st = mine;
      st.bodySt = tplBody('신입생 웰컴(학생)', WEL_ST); st.bodyPa = tplBody('신입생 웰컴(학부모)', WEL_PA);
      var block = blockOf();
      var p = plan(chosen());
      /* 문자를 아직 안 쓰는 곳 — 등록 창에 이미 안내가 있으니 조용히 넘어간다 */
      if (ctx.smsMissing) return { ok: false, message: block, plan: p, skipped: 'nosms' };
      if (block) { toast('웰컴 문자를 보내지 못했습니다 — ' + block, 'bad'); return { ok: false, message: block, plan: p }; }
      if (!p.items.length && p.left.length) { toast('웰컴 문자 — ' + leftMsg(p.left[0].left), 'bad'); return addLeft({ ok: true, sent: 0, failed: 0, results: [], plan: p }, p); }
      if (!p.items.length) {
        toast('웰컴 문자 — 보낼 번호가 없습니다' + (p.noPhone.length ? ' (번호 없음 ' + p.noPhone.length + '명)' : '') + (p.dup.length ? ' · 오늘 이미 보냄' : ''), 'bad');
        return { ok: true, sent: 0, failed: 0, results: [], plan: p };
      }
      return sendItems(p.items).then(function (res) {
        res.plan = p;
        addLeft(res, p);
        toast('웰컴 문자 — ' + resultText(res, p), res.failed || !res.ok ? 'bad' : 'good');
        return res;
      });
    }, function (e) { toast('웰컴 문자를 보내지 못했습니다 — ' + e.message, 'bad'); return { ok: false, message: e.message }; });
  }
  function askAfterImport(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return Promise.resolve(null);
    return UI.confirmAsk('웰컴 문자', '새로 넣은 ' + ids.length + '명에게 웰컴 문자 보낼까요? (학생 본인 · 학부모 1 · 2 · 번호 없는 사람은 뺍니다)', '보내기', '나중에').then(function (y) {
      return y ? sendNow(ids, { to: 'both' }) : null;
    });
  }

  /* 「문구 관리에 저장」 — 지금 창의 글을 「자주 쓰는 문구」의 그 이름으로 (없으면 새로) */
  function saveTpl() {
    var titles = KIND[st.kind].tpl, ts = targetsOf(st.to), jobs = [];
    var put = function (title, body) {
      var cur = (ctx.templates || []).find(function (x) { return (x.title || '').trim() === title; });
      var who = UI.whoami ? UI.whoami() : '';
      var q = cur ? sb().from('sms_templates').update({ body: body, updated_by: who, updated_at: new Date().toISOString() }).eq('id', cur.id)
                  : sb().from('sms_templates').insert({ title: title, body: body, sort_order: 999, updated_by: who });
      return Promise.resolve(q).then(function (r) { if (r && r.error) throw new Error(r.error.message); });
    };
    /* 과제 문자 — 번호 문구(1~5)는 문구 관리에서 고친다 · 여기서는 학부모 글만 (번호 문구가 없을 때는 예전처럼) */
    var rotN = st.kind === 'nudge' && rotating('nudge'), rotP = st.kind === 'nudge' && rotating('praise');
    if ((ts.indexOf('student') !== -1 && !rotN) || st.kind === 'entry') jobs.push(put(titles[0], st.bodySt));
    if (titles[1] && ts.indexOf('parent1') !== -1 && !(st.kind === 'nudge' && rotating('nudgePa'))) jobs.push(put(titles[1], st.bodyPa));
    if (st.kind === 'nudge' && st.pr && st.pr.ids.length && st.pr.on && !rotP) jobs.push(put('과제 칭찬(학생)', st.pr.body));
    return Promise.all(jobs).then(function () {
      toast('문구 관리에 저장했습니다 — 다음부터 이 글이 기본입니다', 'good');
      return load(st.kind);
    }, function (e) { toast('문구를 저장하지 못했습니다 — ' + e.message, 'bad'); });
  }
  /* 오늘 보낸 것 (반 카드 「오늘 10:20 보냄 4명」) — 목적마다 30초 기억 · 보내면 새로 */
  var todayMemo = {};
  function sentToday(kind) {
    var m = todayMemo[kind];
    if (m && Date.now() - m.at < 30000) return m.p;
    var p = rpc('sms_sent_today', { p_purpose: kind }).then(function (r) { return r.missing ? null : (r.data || []); }, function () { return null; });
    todayMemo[kind] = { at: Date.now(), p: p };
    return p;
  }
  window.addEventListener('jt:welcome-sent', function (e) { var k = e.detail && e.detail.kind; if (k) { delete todayMemo[k]; if (k === 'nudge') { delete todayMemo.praise; Object.keys(todayMemo).forEach(function (x) { if (x.indexOf('hw:') === 0) delete todayMemo[x]; }); } } else todayMemo = {}; });

  /* 상담 카드 「웰컴 안내 보냄 10/30」 */
  function lastSent(sid) {
    return rpc('sms_purpose_last', { p_student: sid }).then(function (r) { return (r && r.data) || {}; }, function () { return {}; });
  }

  /* ---------- 이벤트 ---------- */
  function init() {
    var m = modal();
    if (!m) return;
    m.addEventListener('click', function (e) {
      if (e.target.id === 'wcClose' || e.target.id === 'wcCancel') { m.close(); return; }
      if (e.target.id === 'wcSend') { send(); return; }
      if (e.target.closest('[data-wc-savetpl]')) { saveTpl(); return; }
      /* 과제 문자 — 탭 · 이력 펼치기 · 돌려 쓰기로 되돌리기 (20261108r) */
      var tb = e.target.closest('[data-wc-tab]');
      if (tb && st) { st.tab = tb.getAttribute('data-wc-tab'); paint(); return; }
      var hb = e.target.closest('[data-wc-hist]');
      if (hb && st) { var hk = hb.getAttribute('data-wc-hist'); if (st.open[hk]) delete st.open[hk]; else st.open[hk] = true; paint(); return; }
      var ub = e.target.closest('[data-wc-unrot]');
      if (ub && st) {
        var uk = ub.getAttribute('data-wc-unrot');
        st.custom[uk] = false;
        if (uk === 'nudge') st.bodySt = st.bodyStInit;
        else if (uk === 'nudgePa') st.bodyPa = st.bodyPaInit;
        else if (uk === 'praisePa') st.pr.bodyPa = st.prPaInit;
        else st.pr.body = st.prInit;
        paint(); return;
      }
      var c = e.target.closest('[data-wc-cls]');
      if (c) {
        var n = c.getAttribute('data-wc-cls');
        if (!n) st.classes = {};
        else if (st.classes[n]) delete st.classes[n]; else st.classes[n] = true;
        paint();
      }
    });
    m.addEventListener('change', function (e) {
      if (!st) return;
      var t = e.target;
      if (t.name === 'wcTo') { st.to = t.value; paint(); return; }
      if (t.id === 'wcOnlyNew') { st.onlyNew = t.checked; paint(); return; }
      if (t.id === 'wcOnlyNoApp') { st.onlyNoApp = t.checked; paint(); return; }
      if (t.id === 'wcAgain') { st.again = t.checked; paint(); return; }
      if (t.id === 'wcToSt' || t.id === 'wcToPa') {
        if (t.id === 'wcToSt') st.toSt = t.checked; else st.toPa = t.checked;
        st.to = st.toSt && st.toPa ? 'both' : st.toSt ? 'student' : st.toPa ? 'parent' : 'none';
        paint(); return;
      }
      if ((t.id === 'wcPrToSt' || t.id === 'wcPrToPa') && st.pr) {
        if (t.id === 'wcPrToSt') st.pr.toSt = t.checked; else st.pr.toPa = t.checked;
        paint(); return;
      }
      if (t.hasAttribute('data-wc-off')) { var sid = t.getAttribute('data-wc-off'); if (t.checked) delete st.off[sid]; else st.off[sid] = true; paint(); return; }
      if (t.id === 'wcPrOn') { st.pr.on = t.checked; paint(); return; }
      if (t.closest && t.closest('[data-wc-pvall]')) return;
      if (t.hasAttribute('data-wc-proff')) { var pid = t.getAttribute('data-wc-proff'); if (t.checked) delete st.pr.off[pid]; else st.pr.off[pid] = true; paint(); }
    });
    m.addEventListener('toggle', function (e) {
      var d = e.target && e.target.getAttribute && e.target.getAttribute('data-wc-pvall');
      if (d && st) { st.pvOpen = st.pvOpen || {}; st.pvOpen[d] = e.target.open; }
    }, true);
    var tm = null;
    m.addEventListener('input', function (e) {
      if (!st) return;
      if (e.target.id === 'wcBodySt') { st.bodySt = e.target.value; if (st.custom) st.custom.nudge = st.bodySt !== st.bodyStInit; }
      else if (e.target.id === 'wcBodyPa') { st.bodyPa = e.target.value; if (st.custom) st.custom.nudgePa = st.bodyPa !== st.bodyPaInit; }
      else if (e.target.id === 'wcBodyPr' && st.pr) { st.pr.body = e.target.value; if (st.custom) st.custom.praise = st.pr.body !== st.prInit; }
      else if (e.target.id === 'wcBodyPrPa' && st.pr) { st.pr.bodyPa = e.target.value; if (st.custom) st.custom.praisePa = st.pr.bodyPa !== st.prPaInit; }
      else return;
      clearTimeout(tm); tm = setTimeout(paint, 200);
    });
    /* 명단 반 이름 옆 [반 전체에 웰컴 안내] */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wc-class]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      openDialog({ kind: 'welcome', cls: b.getAttribute('data-wc-class') });
    }, true);
  }
  init();

  window.Welcome = {
    openEntry: function () { return openDialog({ kind: 'entry' }); },
    open: function (o) { o = o || {}; return openDialog({ kind: 'welcome', ids: o.students || null, single: (o.students || []).length === 1, cls: o.cls || '', to: o.to || 'both' }); },
    /* 과제 독려 — o = { students: [id], miss: { id: '10/31(금) 10/30(목)' } } (today.js) */
    nudge: function (o) { return openDialog({ kind: 'nudge', ids: o.students || [], miss: o.miss || {}, praise: o.praise || [], total: o.total || {}, period: o.period || null }); },
    /* 과제 문자 발송 이력 (반 카드 「이번 주 독려 18통 · 칭찬 6통」 · 30초 기억 · 086 전이면 []) */
    hwHistory: function (from, to) {
      var k = from + '|' + to, m = todayMemo['hw:' + k];
      if (m && Date.now() - m.at < 30000) return m.p;
      var p = rpc('hw_msg_history', { p_from: from, p_to: to }).then(function (r) { return r.missing ? [] : (r.data || []); }, function () { return []; });
      todayMemo['hw:' + k] = { at: Date.now(), p: p };
      return p;
    },
    /* 오늘 이미 칭찬 받은 학생 id (반 카드 칭찬 수 · 30초 기억) */
    praisedToday: function () {
      var m = todayMemo.praise;
      if (m && Date.now() - m.at < 30000) return m.p;
      var p = rpc('sms_praised_today').then(function (r) { return r.missing ? rpc('sms_sent_today', { p_purpose: 'praise' }) : r; })
        .then(function (r) { return r.missing ? [] : (r.data || []).map(function (x) { return x.student_id; }); }, function () { return []; });
      todayMemo.praise = { at: Date.now(), p: p };
      return p;
    },
    sentToday: sentToday,
    sendNow: sendNow, askAfterImport: askAfterImport, lastSent: lastSent,
    fill: function (body, s) { return fill(body, s); }, defaults: { entry: ENTRY_BODY, student: WEL_ST, parent: WEL_PA }
  };
})();
