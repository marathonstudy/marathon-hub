/* ============================================================
   quicknote.js — 현장 빠른 상담 기록 (20261108s · migration-087 · 예전 20261031o 「상담 기록 +」 펼침 칸을 대신)

   학생 줄 — [상담 3] 버튼 하나 (예전 [상담 카드] · [상담 기록 +] 를 합침 · 지난 상담 개수) · 이름 · 줄 아무 곳을 눌러도 같은 창
     이름 아래 작은 글씨 — 「오늘 상담 ✓ 바빠서 → 최소 3개」 · 「지난 약속 3개 → 4개 ✓」 · 「상담 10/15」 · 「상담 없음」
   창 (휴대폰은 아래에서 올라오는 창 · 화면 아래 절반쯤 · 키보드가 올라와도 [저장]이 보이게)
     맨 위 — 이름 · 「지난주(11/2~11/6) 과제 3/5」 · 「안 낸 날 11/5 목 · 11/6 금」 · 작게 「이번 주 진행 중 1/1」 (20261109c)
       기준 기간 = 그 반의 가장 최근 수업 전 주로 고정 (today.js consultInfo · 예전엔 월요일에 진행 중인 주로 넘어가 0/0 · 1/1)
     탭 [과제 상담] [일반 상담] (20261109c · migration-090 · 예전 [과제][학습][생활][기타])
       과제 상담 — 지난 약속(숫자 약속 판정 · 직접 약속 「지켰나요?」) · 「과제 못 한 이유」 · 「다음 주 약속」
         그 기간(예: 11/2~11/6) 과제에 붙는다 · 기간마다 하나 · 다시 저장하면 그 기록을 고친다(창을 열면 칸에 채워져 있음)
         이유 버튼 [바빠서] [깜빡해서] [어려워서] [직접 입력] · 약속 버튼 [최소 n개] [전부 m개] [직접 입력] (설정에서 원장이 바꿈)
         m = 가장 최근에 다 끝난 주의 과제 수(다음 주 과제 수는 미리 알 수 없음 · 모르면 평일 수) · n = m × 상담 기준(기본 60%) 올림 · n = m 이면 [최소] 숨김
         숫자 약속 판정 = 다음 수업 전 주 (goal_lesson = 다음 수업)
         아래에 지난 과제 상담 최근 4주 「11/2~11/6 · 3/5 · 이유 · 약속 · 지킴」
       일반 상담 — 「상담 내용」 한 칸 · 저장할 때마다 쌓임 · 최근 3건 + [일반 상담 전체 보기] · 없으면 「첫 상담입니다」
       예전 기록 — 분류 「과제」에 이유나 약속이 있으면 그날까지 가장 최근 수업의 전 주 과제 상담으로 · 학습 · 생활 · 기타 등은 일반 상담으로 보인다 (지우지 않음)
       버튼을 누르면 칸에 글로 들어감(있으면 「 · 」로 이어 붙이고 커서는 끝) · 누른 버튼은 picks 에 따로 (통계)
     과제 표(「오늘」 세 칸) — 과제 상담이 있는 기간 칸에 작은 💬 · 누르면 그 상담
     [걱정 문자] · [상담 카드 전체](기본 정보 · 성적 · 퇴원 사유 · 미리보기) · 확인 필요 📌(두 탭 모두) · 모의고사 칸 · 버튼 · 상담 기준 설정
   일반 상담은 여럿이 동시에 써도 기록마다 한 줄씩 · 과제 상담은 기간마다 하나(나중에 저장한 내용으로 고침 · 처음 쓴 사람은 남고 「수정됨」) · 누가 적었는지 남음 (author_name)
   이유 · 약속 · 판정 · 상담 내용은 직원만 본다 (학생 · 학부모 화면 · 문자는 student_notes 를 읽지 않는다)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function today() { return window.DDay ? DDay.today() : Store.toISO(new Date()); }
  function addDays(iso, n) { return Lesson.addDays(iso, n); }
  function dowOf(iso) { return Lesson.dowOf(iso); }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function mdw(iso) { return md(iso) + '(' + DOWK[dowOf(iso)] + ')'; }
  function mdSp(iso) { return md(iso) + ' ' + DOWK[dowOf(iso)]; }
  function stu(sid) { return (Store.getStudents() || []).find(function (s) { return s.id === sid; }) || null; }

  /* 탭 두 개 (20261109c) — 과제 상담(그 기간 과제에 붙음 · 기간마다 하나 · 다시 저장하면 고침) · 일반 상담(저장할 때마다 쌓임) */
  var TABS = [['hw', '과제 상담'], ['general', '일반 상담']];
  var DEF_CFG = { pct: 60, reasons: ['바빠서', '깜빡해서', '어려워서'], promises: [], owner: false };
  var VERD = { kept: '✓ 지킴', partial: '△ 일부', missed: '✕ 못 지킴' };
  var BASE = 'id,student_id,note_date,categories,body,created_at,author_name,next_check';
  var COLS87 = BASE + ',reason,promise,picks,goal_n,goal_all,goal_lesson,miss_days,verdict,verdict_done,verdict_total,verdict_by,hw_day,follow_up';
  var COLS = COLS87 + ',kind,hw_from,hw_to,hw_done,hw_total';
  var st = {
    last: {}, cnt: {}, today: {}, prom: {}, hw: {}, loaded: false, newCols: true, kindCols: true,
    notes: {}, cfg: null,
    open: '', opts: {}, kind: 'hw', more: false, busy: false, err: '', setOpen: false, judging: {},
    draft: null, filled: ''
  };
  function blank() { return { reason: '', promise: '', body: '', picks: { reason: [], promise: '' }, goal: null, follow: false }; }
  st.draft = blank();

  /* 자동으로 남는 기록(새 학생 앱 안내 문자 · sms.js)은 상담으로 세지 않는다 */
  function isAuto(n) { return (n.categories || []).join() === '기타' && /앱 안내 문자 보냄$/.test(n.body || ''); }
  function isNum(n) { return !!n && (n.goal_n != null || n.goal_all); }
  /* 상담 종류 — hw 과제 상담 · general 일반 상담 · other 그 밖 기록(퇴원 · 재등록 · 걱정 문자 · 자동 안내)
     예전 기록(kind 없음) — 분류 「과제」에 이유나 약속이 있으면 과제 상담 · 학습 · 생활 · 기타 · 그 밖 상담 분류는 일반 상담 */
  var OTHER = ['퇴원', '재등록', '걱정 문자'];
  function kindOf(n) {
    if (!n) return 'other';
    if (n.kind === 'hw' || n.kind === 'general') return n.kind;
    if (isAuto(n)) return 'other';
    var c = n.categories || [];
    if (c.some(function (x) { return OTHER.indexOf(x) !== -1; })) return 'other';
    if (c.indexOf('과제') !== -1 && ((n.reason || '').trim() || (n.promise || '').trim())) return 'hw';
    return 'general';
  }
  /* 과제 상담이 붙는 기간 — 새 기록은 hw_from · 예전 기록은 그날까지 가장 최근 수업의 전 주 (today.js periodAt) */
  function iso10(v) { return v ? String(v).slice(0, 10) : ''; }
  function periodOf(n) {
    if (n.hw_from) return { from: iso10(n.hw_from), to: iso10(n.hw_to) || addDays(iso10(n.hw_from), 6) };
    var s = stu(n.student_id), p = s && window.Today && Today.periodAt ? Today.periodAt(s.className || s.class_name || '', n.note_date) : null;
    return p ? { from: p.from, to: p.to } : { from: n.note_date, to: n.note_date };
  }
  /* 「11/2~11/6」 — 기간 안 평일 처음 ~ 끝 */
  function perLabel(p) {
    var a = p.from, b = p.to;
    while (a < b && (dowOf(a) === 0 || dowOf(a) === 6)) a = addDays(a, 1);
    while (b > a && (dowOf(b) === 0 || dowOf(b) === 6)) b = addDays(b, -1);
    return md(a) + '~' + md(b);
  }
  /* 학생마다 기간별 과제 상담 하나 — 새 기록(kind hw) 먼저 · 없으면 그 기간 가장 최근 예전 기록 */
  function hwByPeriod(list) {
    var by = {};
    list.forEach(function (n) {
      if (kindOf(n) !== 'hw') return;
      var p = periodOf(n), cur = by[p.from];
      var better = !cur || (n.kind === 'hw') > (cur.kind === 'hw') ||
        ((n.kind === 'hw') === (cur.kind === 'hw') && (n.note_date > cur.note_date || (n.note_date === cur.note_date && String(n.created_at) > String(cur.created_at))));
      if (better) by[p.from] = Object.assign({}, n, { _p: p });
    });
    return by;
  }

  /* ---------- 불러오기 ---------- */
  function loadLast() {
    if (!sb()) return Promise.resolve();
    var q = function (cols) { return sb().from('student_notes').select(cols).is('deleted_at', null).gte('note_date', addDays(today(), -400)); };
    return Promise.resolve(q(COLS)).then(function (r) {
      if (!r.error) { st.newCols = true; st.kindCols = true; return r; }
      st.kindCols = false;
      return Promise.resolve(q(COLS87)).then(function (r2) {
        if (!r2.error) { st.newCols = true; return r2; }
        st.newCols = false;
        return q(BASE);
      });
    }).then(function (r) {
      if (r.error) return;
      var last = {}, cnt = {}, td = {}, prom = {}, per = {}, t = today();
      (r.data || []).forEach(function (n) {
        if (isAuto(n)) return;
        var sid = n.student_id;
        cnt[sid] = (cnt[sid] || 0) + 1;
        if (!last[sid] || n.note_date > last[sid]) last[sid] = n.note_date;
        if (n.note_date === t && (!td[sid] || n.created_at > td[sid].created_at)) td[sid] = n;
        if (kindOf(n) === 'hw') (per[sid] = per[sid] || []).push(n);
        /* 지난 약속 — 과제 상담의 약속만 */
        if (kindOf(n) === 'hw' && (n.promise || '').trim() && n.note_date < t && (!prom[sid] || n.note_date > prom[sid].note_date || (n.note_date === prom[sid].note_date && n.created_at > prom[sid].created_at))) prom[sid] = n;
      });
      var hw = {};
      Object.keys(per).forEach(function (sid) { hw[sid] = hwByPeriod(per[sid]); });
      var changed = JSON.stringify(Object.keys(td).sort()) !== JSON.stringify(Object.keys(st.today || {}).sort());
      st.last = last; st.cnt = cnt; st.today = td; st.prom = prom; st.hw = hw; st.loaded = true;
      paintTags();
      paintMarks();
      judgeRows();
      if (changed) window.dispatchEvent(new CustomEvent('jt:consult-loaded'));
    });
  }
  /* 과제 표 칸의 💬 — 그 기간에 과제 상담이 있으면 (today.js triCell 이 그릴 때 · 불러온 뒤에는 여기서 고침) */
  function hwMark(sid, from) {
    var n = st.hw[sid] && st.hw[sid][from];
    if (!n) return '';
    return '<span class="tdc-cmt" data-qn-hw="' + esc(sid) + '" data-qn-from="' + esc(from) + '" role="button" tabindex="0" aria-label="' + esc(perLabel(n._p) + ' 과제 상담 보기') + '" title="과제 상담 보기">💬</span>';
  }
  function paintMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-app-detail][data-app-from]:not([data-app-live])'), function (b) {
      var want = hwMark(b.getAttribute('data-app-detail'), b.getAttribute('data-app-from')), cur = b.querySelector('.tdc-cmt');
      if (!want) { if (cur) cur.remove(); return; }
      if (!cur) b.insertAdjacentHTML('beforeend', want);
    });
  }
  window.addEventListener('jt:rendered', paintMarks);
  /* 💬 를 누르면 — 그 기간 과제 상담 (작은 창 · 직원만) */
  function hwPop(sid, from) {
    var n = st.hw[sid] && st.hw[sid][from];
    if (!n) return;
    var d = document.getElementById('qnHwPop');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'qnHwPop'; d.className = 'qn-pop'; d.setAttribute('aria-labelledby', 'qnHwPopT');
      document.body.appendChild(d);
    }
    var s = stu(sid) || {};
    d.innerHTML = '<div class="qn-pop__head"><h3 class="qn-pop__t" id="qnHwPopT">' + esc((s.name || '') + ' · ' + perLabel(n._p) + ' 과제 상담') + '</h3>' +
      '<button type="button" class="cs-x" data-qn-popx aria-label="닫기">✕</button></div>' + hwRowBody(sid, n) +
      '<p class="qn-pop__m num">' + esc(mdw(n.note_date) + ' · ' + (n.author_name || '')) + '</p>';
    if (!d.open) d.showModal();
  }
  /* 학생 줄 — 판정일이 지난 숫자 약속을 과제 기록이 오면 저장 (수업 전 예고를 끈 반 · 한 번씩) */
  var judgeTm = null;
  function judgeRows() {
    if (!st.newCols || !window.Today || !Today.hwCount) return;
    var t = today(), jobs = [];
    Object.keys(st.prom).forEach(function (sid) {
      var p = st.prom[sid];
      if (!isNum(p) || p.verdict || !p.goal_lesson || p.goal_lesson > t || st.judging[p.id]) return;
      var c = Today.hwCount(sid, addDays(p.goal_lesson, -7), addDays(p.goal_lesson, -1));
      if (!c || !c.total) return;
      st.judging[p.id] = true;
      jobs.push(Promise.resolve(sb().rpc('consult_judge', { p_note: p.id, p_done: c.done, p_total: c.total })).then(function (r) { return r && !r.error && r.data; }, function () { return false; }));
    });
    if (!jobs.length) return;
    Promise.all(jobs).then(function (a) { if (a.some(Boolean)) { clearTimeout(judgeTm); judgeTm = setTimeout(loadLast, 50); } });
  }
  window.addEventListener('jt:app', function () { if (st.loaded) judgeRows(); });
  function loadCfg() {
    if (st.cfg) return Promise.resolve(st.cfg);
    return Promise.resolve(sb().rpc('consult_cfg')).then(function (r) {
      st.cfg = !r.error && r.data && r.data.reasons ? r.data : Object.assign({}, DEF_CFG);
      return st.cfg;
    }, function () { st.cfg = Object.assign({}, DEF_CFG); return st.cfg; });
  }
  function loadNotes(sid) {
    return sb().from('student_notes').select('*').eq('student_id', sid).is('deleted_at', null)
      .order('note_date', { ascending: false }).order('created_at', { ascending: false })
      .then(function (r) {
        st.notes[sid] = r.error ? [] : (r.data || []).filter(function (n) { return !isAuto(n); });
        if (r.error) st.err = '지난 상담을 불러오지 못했습니다 — ' + r.error.message;
        if (st.open === sid) { judgeDue(sid); paint(); }
      });
  }

  /* ---------- 짧은 글 ---------- */
  function promShort(n) {
    if (n.goal_all) return '전부 ' + (n.goal_n || '') + '개';
    if (n.goal_n != null) return '최소 ' + n.goal_n + '개';
    var p = (n.promise || '').trim();
    return p.length > 10 ? p.slice(0, 10) + '…' : p;
  }
  function reasonShort(n) {
    var pk = (n.picks && n.picks.reason) || [];
    var r = pk.length ? pk[0] : (n.reason || '').trim();
    return r.length > 8 ? r.slice(0, 8) + '…' : r;
  }
  /* 숫자 약속 판정 글 — 「3개 → 4개 ✓」 */
  function verdictShort(n) {
    if (!n || !n.verdict) return '';
    if (isNum(n)) {
      var tg = n.goal_all ? n.verdict_total : Math.min(n.goal_n, n.verdict_total);
      return tg + '개 → ' + n.verdict_done + '개 ' + (n.verdict === 'kept' ? '✓' : '✕');
    }
    return VERD[n.verdict] || '';
  }

  /* ---------- 학생 줄 조각 ---------- */
  function tagHtml(sid) {
    var d = st.last[sid] || '', t = today(), tn = st.today[sid], p = st.prom[sid];
    var cls = tn ? ' is-today' : !d ? ' is-none' : '';
    var txt;
    if (!st.loaded) txt = '';
    else if (tn) {
      var r = reasonShort(tn), pr = (tn.promise || '').trim() ? promShort(tn) : '';
      txt = '오늘 상담 ✓' + (r || pr ? ' <span class="qn-tag__s">' + esc(r + (pr ? ' → ' + pr : '')) + '</span>' : '');
    } else if (p && p.verdict) txt = '<span class="qn-tag__v is-' + esc(p.verdict) + '">지난 약속 ' + esc(verdictShort(p)) + '</span>';
    else txt = d === t ? '오늘 상담 ✓' : d ? '<span class="qn-tag__p">마지막 </span>상담 ' + md(d) : '상담 없음';
    return '<span class="qn-tag' + cls + '" data-qn-tag="' + esc(sid) + '">' + txt + '</span>';
  }
  function btnHtml(sid, name) {
    var n = st.cnt[sid] || 0;
    return '<button type="button" class="btn btn--sm qn-btn" data-cs-open="' + esc(sid) + '" data-cs-focus="consult" data-qn-btn="' + esc(sid) + '" aria-label="' + esc((name || '') + ' 상담' + (n ? ' — 지난 상담 ' + n + '개' : '')) + '">상담' + (n ? ' <span class="num">' + n + '</span>' : '') + '</button>';
  }
  function slotHtml() { return ''; }
  function paintTags() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-qn-tag]'), function (el) {
      var w = document.createElement('span');
      w.innerHTML = tagHtml(el.dataset.qnTag);
      el.parentNode.replaceChild(w.firstChild, el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qn-btn]'), function (b) {
      var w = document.createElement('span'), s = stu(b.dataset.qnBtn);
      w.innerHTML = btnHtml(b.dataset.qnBtn, s && s.name);
      b.parentNode.replaceChild(w.firstChild, b);
    });
  }

  /* ---------- 과제 정보 · 약속 숫자 ---------- */
  /* 기준 기간 — 그 반의 가장 최근 수업 전 주로 고정 (today.js consultInfo · 20261109c) */
  function info(sid) { return window.Today && Today.consultInfo ? Today.consultInfo(sid) : null; }
  function cfg() { return st.cfg || DEF_CFG; }
  function goals(h) {
    var m = Math.max(1, (h && h.m) || 5), n = Math.ceil(m * (cfg().pct || 60) / 100);
    return { m: m, n: Math.min(Math.max(n, 1), m) };
  }

  /* 숫자 약속 — 판정 수업일이 지났는데 판정이 없으면 (수업 전 예고를 끈 반) 같은 셈으로 저장 */
  function judgeDue(sid) {
    var p = prevPromise(sid);
    if (!p || !isNum(p) || p.verdict || !p.goal_lesson || p.goal_lesson > today() || st.judging[p.id]) return;
    var c = window.Today && Today.hwCount ? Today.hwCount(sid, addDays(p.goal_lesson, -7), addDays(p.goal_lesson, -1)) : null;
    if (!c || !c.total) return;
    st.judging[p.id] = true;
    Promise.resolve(sb().rpc('consult_judge', { p_note: p.id, p_done: c.done, p_total: c.total })).then(function (r) {
      if (r && !r.error && r.data) { delete st.notes[sid]; loadLast(); if (st.open === sid) loadNotes(sid); }
    });
  }

  /* ---------- 창 ---------- */
  /* 창은 처음 열 때 만든다 (index.html 은 그대로) */
  function modal() {
    var m = document.getElementById('csModal');
    if (!m && document.body) {
      m = document.createElement('dialog');
      m.className = 'cs-modal'; m.id = 'csModal'; m.setAttribute('aria-labelledby', 'csTitle');
      document.body.appendChild(m);
    }
    return m;
  }
  /* 이 학생 과제 상담 — 기간별 하나 (최근 기간부터) */
  function hwList(sid) {
    var by = hwByPeriod(st.notes[sid] || []);
    return Object.keys(by).sort().reverse().map(function (k) { return by[k]; });
  }
  /* 지금 기간(기준 기간)의 과제 상담 — 있으면 창을 열 때 칸에 채우고, 저장하면 그 기록을 고친다 */
  function curHw(sid) { var h = info(sid); if (!h) return null; return hwList(sid).find(function (n) { return n._p.from === h.period.from; }) || null; }
  /* 지난 약속 — 지금 기간보다 앞 기간의 과제 상담 약속 (기간을 모르면 오늘 전) */
  function prevPromise(sid) {
    var h = info(sid);
    return hwList(sid).find(function (n) { return (n.promise || '').trim() && (h ? n._p.from < h.period.from : n.note_date < today()); }) || null;
  }
  function headHtml(sid) {
    var s = stu(sid) || {}, h = info(sid);
    var line = '', live = '';
    if (h && h.known) {
      line = '<span class="cs-hw num">' + esc(h.period.word + '(' + h.period.label + ') 과제 ' + h.done + '/' + h.total) + '</span>' +
        (h.miss.length ? '<span class="cs-miss num">' + esc('안 낸 날 ' + h.miss.map(mdSp).join(' · ')) + '</span>' : '<span class="cs-miss is-ok">안 낸 과제 없음</span>');
      if (h.live) live = '<p class="cs-live num">이번 주 진행 중 ' + h.live.done + '/' + h.live.total + '</p>';
    } else if (h) line = '<span class="cs-hw is-mute">' + esc(h.period.word + '(' + h.period.label + ') 과제 기록 없음') + '</span>';
    /* 학생 카드 (stucard.js · 20261109c) — 머리에는 이름만 · 과제 줄은 아래 「과제」 칸 */
    if (window.StuCard) return '<div class="cs-head"><h2 class="cs-name" id="csTitle">' + esc(s.name || '') + '</h2><button type="button" class="cs-x" id="csClose" aria-label="닫기">✕</button></div>';
    return '<div class="cs-head"><h2 class="cs-name" id="csTitle">' + esc(s.name || '') + '</h2><button type="button" class="cs-x" id="csClose" aria-label="닫기">✕</button>' +
      (line ? '<p class="cs-hwline">' + line + '</p>' : '') + live + '</div>';
  }
  /* 학생 카드 「과제」 칸 — 그 기간 과제 상담 (8주 막대 💬 · 주를 누르면 내용) */
  function hwOfFn(sid) {
    var by = hwByPeriod(st.notes[sid] || []);
    return function (from) { var n = by[from]; return n ? hwRowBody(sid, n) : ''; };
  }
  function prevHtml(sid) {
    var p = prevPromise(sid);
    if (!p) return '';
    var h = '<div class="cs-prev" data-cs-prev="' + esc(p.id) + '"><span class="cs-prev__t">지난 약속(' + esc(md(p.note_date)) + ')</span> ';
    if (isNum(p)) {
      if (p.verdict) {
        var tg = p.goal_all ? p.verdict_total : Math.min(p.goal_n, p.verdict_total);
        h += '<b class="cs-verd is-' + esc(p.verdict) + ' num">목표 ' + tg + '개 → 실제 ' + p.verdict_done + '개 ' + (p.verdict === 'kept' ? '✓ 지킴' : '✕ 못 지킴') + '</b>';
      } else h += '<span class="cs-prev__b">' + esc(p.promise) + '</span> <small class="cs-prev__w num">' + esc(p.goal_lesson ? mdw(p.goal_lesson) + ' 수업 전에 판정' : '') + '</small>';
    } else {
      h += '<span class="cs-prev__b">' + esc(p.promise) + '</span>';
      if (p.verdict) h += ' <b class="cs-verd is-' + esc(p.verdict) + '">' + esc(VERD[p.verdict]) + '</b>';
      else h += ' <span class="cs-ask">지켰나요?</span><span class="cs-askb">' + ['kept', 'partial', 'missed'].map(function (k) {
        return '<button type="button" class="cs-chip" data-cs-verd="' + k + '">' + ({ kept: '지킴', partial: '일부', missed: '못 지킴' })[k] + '</button>';
      }).join('') + '</span>';
    }
    return h + '</div>';
  }
  function chip(attr, val, label, extra) { return '<button type="button" class="cs-chip" ' + attr + '="' + esc(val) + '"' + (extra || '') + '>' + esc(label) + '</button>'; }
  function tabsHtml() {
    return '<div class="cs-kinds" role="tablist" aria-label="상담 종류">' + TABS.map(function (k) {
      return '<button type="button" role="tab" class="cs-kind' + (st.kind === k[0] ? ' is-on' : '') + '" data-cs-kind="' + k[0] + '" aria-selected="' + (st.kind === k[0]) + '">' + k[1] + '</button>';
    }).join('') + '</div>';
  }
  function followHtml() {
    return '<label class="cs-follow"><input type="checkbox" id="csFollow"' + (st.draft.follow ? ' checked' : '') + '> 확인 필요 <small>(상담 카드 맨 위 📌)</small></label>';
  }
  function formHtml(sid) {
    var d = st.draft, h = info(sid), g = goals(h), c = cfg(), html = '';
    if (st.kind === 'hw') {
      var cur = curHw(sid);
      html += '<p class="cs-per num">' + (h ? esc(h.period.label + ' 과제에 붙어요') + (cur ? ' <b class="cs-per__e">· 이미 남긴 상담을 고칩니다</b>' : '') : '수업일이 정해지면 과제 상담을 남길 수 있어요') + '</p>';
      html += '<div class="cs-field"><span class="cs-lab">과제 못 한 이유</span><div class="cs-chips">' +
        c.reasons.map(function (r) { return chip('data-cs-reason', r, r); }).join('') + chip('data-cs-reason', '', '직접 입력', ' data-cs-free="reason"') + '</div>' +
        '<textarea class="textarea cs-in" id="csReason" rows="2" maxlength="500" enterkeyhint="next" placeholder="말하는 그대로 적거나 키보드 마이크로">' + esc(d.reason) + '</textarea></div>';
      html += '<div class="cs-field"><span class="cs-lab">다음 주 약속</span><div class="cs-chips">' +
        (g.n < g.m ? chip('data-cs-goal', 'min', '최소 ' + g.n + '개') : '') + chip('data-cs-goal', 'all', '전부 ' + g.m + '개') +
        (c.promises || []).map(function (p) { return chip('data-cs-prom', p, p); }).join('') + chip('data-cs-prom', '', '직접 입력', ' data-cs-free="promise"') + '</div>' +
        '<textarea class="textarea cs-in" id="csPromise" rows="2" maxlength="500" enterkeyhint="done" placeholder="예) 다음 주 최소 ' + g.n + '개 내기">' + esc(d.promise) + '</textarea></div>';
    } else {
      html += '<div class="cs-field"><span class="cs-lab">상담 내용</span><textarea class="textarea cs-in" id="csBodyIn" rows="4" maxlength="2000" placeholder="예) 진로 고민, 수업 태도, 학부모 요청 등">' + esc(d.body) + '</textarea></div>';
    }
    return html + followHtml();
  }
  /* 과제 상담 한 줄 — 「11/2~11/6 · 3/5 · 이유 · 약속 · 지킴」 */
  function hwCnt(sid, n) {
    if (n.hw_total != null && n.hw_total !== '') return n.hw_done + '/' + n.hw_total;
    var c = window.Today && Today.hwCount ? Today.hwCount(sid, n._p.from, n._p.to) : null;
    return c && c.total ? c.done + '/' + c.total : '';
  }
  function hwRowBody(sid, n) {
    var vd = n.verdict ? (isNum(n) ? verdictShort(n) : VERD[n.verdict]) : (n.promise || '').trim() ? '판정 전' : '';
    return '<div class="cs-past__b">' + [(n.reason || '').trim() ? '이유: ' + esc(n.reason) : '', (n.promise || '').trim() ? '약속: ' + esc(n.promise) : ''].filter(Boolean).join('<br>') + '</div>' +
      ((n.miss_days || []).length ? '<div class="cs-past__m num">안 낸 날 ' + esc(n.miss_days.map(function (x) { return mdSp(iso10(x)); }).join(' · ')) + '</div>' : '') +
      (vd ? '<div class="cs-past__v"><b class="cs-verd' + (n.verdict ? ' is-' + esc(n.verdict) : '') + '">' + esc(vd) + '</b></div>' : '');
  }
  function hwPastHtml(sid) {
    if (!st.notes[sid]) return '<p class="cs-loading">지난 상담을 불러오는 중…</p>';
    var list = hwList(sid).slice(0, 4);
    if (!list.length) return '<p class="cs-first">아직 과제 상담이 없어요</p>';
    return '<h3 class="cs-sub">지난 과제 상담 <small>(최근 4주)</small></h3><ol class="cs-past cs-past--hw">' + list.map(function (n) {
      var cnt = hwCnt(sid, n);
      return '<li><div class="cs-past__h num">' + esc(perLabel(n._p) + (cnt ? ' · ' + cnt : '') + ' · ' + (n.author_name || '')) + '</div>' + hwRowBody(sid, n) + '</li>';
    }).join('') + '</ol>';
  }
  function genList(sid) { return (st.notes[sid] || []).filter(function (n) { return kindOf(n) === 'general'; }); }
  function genPastHtml(sid) {
    if (!st.notes[sid]) return '<p class="cs-loading">지난 상담을 불러오는 중…</p>';
    var list = genList(sid);
    if (!list.length) return '<p class="cs-first">첫 상담입니다</p>';
    var show = st.more ? list : list.slice(0, 3);
    return '<h3 class="cs-sub">지난 일반 상담 <small class="num">(' + list.length + '건)</small></h3><ol class="cs-past cs-past--gen">' + show.map(function (n) {
      var cat = (n.categories || []).filter(function (c) { return c !== '상담'; }).join(', ');
      return '<li><div class="cs-past__h num">' + esc(mdw(n.note_date) + (cat ? ' · ' + cat : '') + ' · ' + (n.author_name || '')) + '</div><div class="cs-past__b">' + esc(n.body || '') + '</div></li>';
    }).join('') + '</ol>' +
      (list.length > 3 ? '<button type="button" class="cs-more" data-cs-more aria-expanded="' + st.more + '">' + (st.more ? '최근 3건만 보기 ▴' : '일반 상담 전체 보기 (' + list.length + '건) ▾') + '</button>' : '');
  }
  function pastHtml(sid) { return st.kind === 'hw' ? hwPastHtml(sid) : genPastHtml(sid); }
  /* 창을 열 때 — 지금 기간 과제 상담이 있으면 칸에 채운다 (한 번만 · 이미 적고 있으면 그대로) */
  function prefill(sid) {
    if (st.filled === sid) return;
    var d = st.draft, n = curHw(sid);
    st.filled = sid;
    if (!n || d.reason || d.promise) return;
    d.reason = n.reason || ''; d.promise = n.promise || '';
    d.picks = n.picks && typeof n.picks === 'object' ? { reason: n.picks.reason || [], promise: n.picks.promise || '' } : { reason: [], promise: '' };
    d.goal = isNum(n) ? { n: n.goal_n, all: !!n.goal_all } : null;
    d.follow = !!n.follow_up;
  }
  function setHtml() {
    var c = cfg();
    if (!c.owner) return '';
    if (!st.setOpen) return '<button type="button" class="cs-link" data-cs-set>버튼 · 상담 기준 설정</button>';
    return '<div class="cs-set"><p class="cs-lab">상담 설정 (원장)</p>' +
      '<label class="cs-setrow">상담 기준 <input class="input cs-pct" id="csPct" type="number" inputmode="numeric" min="1" max="100" value="' + esc(c.pct) + '">% <small>(최소 n개 = 과제 수 × 기준 · 올림)</small></label>' +
      '<label class="cs-setrow">이유 버튼 <input class="input" id="csSetReasons" value="' + esc((c.reasons || []).join(', ')) + '"></label>' +
      '<label class="cs-setrow">약속 버튼 더하기 <input class="input" id="csSetProms" placeholder="예) 매일 밤 10시에 하기" value="' + esc((c.promises || []).join(', ')) + '"></label>' +
      '<div class="cs-setact"><button type="button" class="btn btn--sm btn--primary" data-cs-setsave>설정 저장</button><button type="button" class="btn btn--sm" data-cs-set>닫기</button></div></div>';
  }
  function paint() {
    var m = modal(), sid = st.open;
    if (!m || !sid) return;
    var s = stu(sid) || {}, h = info(sid);
    var focus = document.activeElement && m.contains(document.activeElement) ? document.activeElement.id : '';
    var pos = focus && document.activeElement.selectionStart;
    if (st.notes[sid]) prefill(sid);
    var scroll = document.getElementById('csScroll'), top = scroll ? scroll.scrollTop : 0;
    var SC = window.StuCard;
    m.innerHTML = '<div class="cs-sheet">' + headHtml(sid) +
      '<div class="cs-scroll" id="csScroll">' +
        /* 학생 카드 — 기본 정보 · 과제 · 모의고사 추이 (stucard.js · 20261109c) */
        /* 머리 — 얼굴 사진(없으면 고른 캐릭터) · [사진 올리기] [사진 지우기] · 레벨 · XP (faces.js · 20261110b) */
        (SC && window.Faces ? Faces.cardHtml(sid) : '') +
        (SC ? SC.infoHtml(sid) + SC.hwHtml(sid, hwOfFn(sid)) + SC.mogoHtml(sid) : '') +
        '<section class="sc-sec sc-consult" id="scConsult" aria-label="상담"><h3 class="sc-t">상담</h3>' +
        tabsHtml() + (st.kind === 'hw' ? prevHtml(sid) : '') + formHtml(sid) +
        (st.err ? '<p class="cs-err" role="alert">' + esc(st.err) + '</p>' : '') +
        '<div class="cs-tools">' + (h && h.known && h.miss.length && window.Worry ? '<button type="button" class="btn btn--sm" data-cs-worry>걱정 문자</button>' : '') +
          '<button type="button" class="btn btn--sm" data-cs-card>상담 카드 전체</button></div>' +
        /* 모의고사 (mogo.js) — 학생 카드가 없을 때만 여기 (있으면 위 「모의고사 추이」 칸 안) */
        (!SC && window.Mogo ? '<div class="cs-mogo" data-mg-host="' + esc(sid) + '">' + Mogo.sectionHtml(sid) + '</div>' : '') +
        pastHtml(sid) + setHtml() + '</section></div>' +
      '<div class="cs-foot">' + (st.ask
        ? '<p class="cs-ask2" role="alert">저장하지 않고 닫을까요?</p><button type="button" class="btn" data-cs-keep>계속 쓰기</button><button type="button" class="btn btn--danger" data-cs-drop>저장 안 하고 닫기</button>'
        : '<button type="button" class="btn btn--primary cs-save" id="csSave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? '저장하는 중…' : '저장') + '</button>') + '</div></div>';
    var sc2 = document.getElementById('csScroll');
    if (sc2) sc2.scrollTop = top;
    if (focus) { var el = document.getElementById(focus); if (el) { el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} } }
    m.setAttribute('aria-label', (s.name || '') + ' 학생 카드');
    /* 상담 명단 · [상담] 버튼에서 열면 상담 칸으로 바로 */
    if (st.goConsult) {
      var cs = document.getElementById('scConsult');
      if (cs && sc2) { sc2.scrollTop = Math.max(0, cs.offsetTop - 4); st.goConsult = st.notes[sid] ? false : st.goConsult; }
    }
  }
  /* 적고 있던 글이 있는지 — 처음 채운 값(지금 기간 과제 상담)과 다르면 */
  function dirty() {
    var d = st.draft, n = st.open ? curHw(st.open) : null;
    var r0 = n ? n.reason || '' : '', p0 = n ? n.promise || '' : '';
    return !!(d.body.trim() || d.reason.trim() !== r0.trim() || d.promise.trim() !== p0.trim());
  }
  function open(sid, opts) {
    var m = modal();
    if (!m || !sid) { if (window.Card) Card.open(sid); return; }
    st.open = sid; st.opts = opts || {}; st.kind = 'hw'; st.more = false; st.err = ''; st.busy = false; st.setOpen = false; st.draft = blank(); st.filled = ''; st.ask = false;
    st.goConsult = st.opts.focus === 'consult' || !!st.opts.hwDay;
    if (window.StuCard) StuCard.reset(sid);
    var sc0 = document.getElementById('csScroll');
    if (sc0) sc0.scrollTop = 0;
    paint();
    if (!m.open) m.showModal();
    kb();
    loadCfg().then(paint);
    loadNotes(sid);
    if (window.Mogo && Mogo.state().sql === null) Mogo.load();
  }
  /* 적던 글이 있으면 「저장하지 않고 닫을까요?」 (force = 저장 뒤 · 다른 창으로 넘어갈 때) */
  function close(force) {
    var m = modal();
    if (force !== true && st.open && m && m.open && dirty()) { st.ask = true; paint(); return; }
    st.open = ''; st.draft = blank(); st.err = ''; st.filled = ''; st.ask = false;
    if (m && m.open) m.close();
    paintTags();
  }

  /* ---------- 버튼으로 글 넣기 ---------- */
  function put(id, text) {
    var ta = document.getElementById(id);
    if (!ta) return;
    var v = ta.value.replace(/\s+$/, '');
    ta.value = text ? (v ? v + ' · ' + text : text) : ta.value;
    if (id === 'csReason') st.draft.reason = ta.value; else st.draft.promise = ta.value;
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    var n = ta.value.length;
    try { ta.setSelectionRange(n, n); } catch (e) {}
  }

  /* ---------- 저장 ----------
     과제 상담 — consult_hw_save (migration-090) · 그 기간에 이미 있으면 고친다 · 이유 · 약속 · 안 낸 날 · 그 기간 과제 수 · 판정 수업
     일반 상담 — 저장할 때마다 새 기록 한 건 (분류 「상담」 · kind general) */
  var NEED90 = 'migration-090 SQL 을 먼저 실행해 주세요 (과제 상담 · 일반 상담)';
  function save() {
    var sid = st.open, d = st.draft;
    if (!sid || st.busy) return;
    var h = info(sid), t = today();
    st.err = '';
    if (st.kind === 'hw' && !d.reason.trim() && !d.promise.trim()) { st.err = '이유나 약속 중 하나는 적어 주세요'; paint(); return; }
    if (st.kind === 'hw' && !h) { st.err = '수업일이 정해지지 않아 과제 기간을 알 수 없어요 — 일반 상담으로 남겨 주세요'; paint(); return; }
    if (st.kind !== 'hw' && !d.body.trim()) { st.err = '상담 내용을 적어 주세요'; paint(); return; }
    var goal = d.goal && d.promise.trim() ? d.goal : null;
    var goalLesson = goal && h ? h.goalLesson || null : null;
    st.busy = true; paint();
    var hwDay = st.opts.hwDay || '';
    var done = function (msg) {
      st.busy = false;
      /* 과제 칸에서 연 상담 — 그 칸의 작은 점 (worry.js) */
      if (hwDay && window.Worry && Worry.loadHw) Worry.loadHw().then(function () { window.dispatchEvent(new CustomEvent('jt:hwnote')); });
      var name = (stu(sid) || {}).name || '';
      delete st.notes[sid];
      close(true);
      loadLast();
      toast((name ? name + ' ' : '') + msg, 'good');
      if (window.Card && Card.notesChanged) Card.notesChanged(sid);
      window.dispatchEvent(new CustomEvent('jt:consult', { detail: { sid: sid } }));
    };
    var fail = function (m) {
      st.busy = false;
      st.err = /kind|hw_from|hw_to|hw_done|consult_hw_save|student_notes_cat_check|schema cache|Could not find|does not exist/i.test(m || '') ? NEED90 : '저장하지 못했습니다 — ' + m;
      paint();
    };
    if (st.kind === 'hw') {
      var p = {
        student: sid, from: h.period.from, to: h.period.to, reason: d.reason.trim(), promise: d.promise.trim(), picks: d.picks,
        goal_n: goal ? goal.n : null, goal_all: !!(goal && goal.all), goal_lesson: goalLesson,
        miss: h.known ? h.miss.slice() : [], done: h.known ? h.done : null, total: h.known ? h.total : null,
        follow: !!d.follow, hw_day: st.opts.hwDay || null
      };
      Promise.resolve(sb().rpc('consult_hw_save', { p: p })).then(function (r) {
        if (r.error) { fail(r.error.message); return; }
        done(r.data && r.data.updated ? h.period.label + ' 과제 상담을 고쳤습니다' : h.period.label + ' 과제 상담을 남겼습니다');
      }, function (e) { fail(e && e.message); });
      return;
    }
    var row = { student_id: sid, note_date: t, categories: ['상담'], kind: 'general', body: d.body.trim(), follow_up: !!d.follow };
    var ins = function (x) { return Promise.resolve(sb().from('student_notes').insert(x).select('id').single()); };
    /* 090 전(kind 칸 없음)이면 kind 없이 — 분류 「상담」이라 일반 상담으로 보인다 */
    ins(row).then(function (r) {
      if (r && r.error && /kind|schema cache|Could not find/i.test(r.error.message || '')) { var x = Object.assign({}, row); delete x.kind; return ins(x); }
      return r;
    }).then(function (r) {
      if (r.error) { fail(r.error.message); return; }
      done('일반 상담을 남겼습니다');
    }, function (e) { fail(e && e.message); });
  }
  function setVerdict(noteId, v) {
    Promise.resolve(sb().rpc('consult_verdict_set', { p_note: noteId, p_verdict: v })).then(function (r) {
      if (r.error || !r.data) { toast('저장하지 못했습니다' + (r.error ? ' — ' + r.error.message : ''), 'bad'); return; }
      toast('지난 약속 — ' + VERD[v], 'good');
      var sid = st.open;
      delete st.notes[sid];
      loadLast();
      loadNotes(sid);
    });
  }
  function saveCfg() {
    var split = function (id) { return (document.getElementById(id).value || '').split(/[,，\n]/).map(function (x) { return x.trim(); }).filter(Boolean); };
    var body = { pct: +document.getElementById('csPct').value, reasons: split('csSetReasons'), promises: split('csSetProms') };
    Promise.resolve(sb().rpc('consult_cfg_save', { p: body })).then(function (r) {
      if (r.error) { toast('설정을 저장하지 못했습니다 — ' + r.error.message, 'bad'); return; }
      st.cfg = Object.assign({ owner: true }, r.data.cfg);
      st.setOpen = false;
      toast('상담 설정을 저장했습니다', 'good');
      paint();
    });
  }

  /* ---------- 키보드 — 창을 키보드 위로 (휴대폰) ---------- */
  function kb() {
    var m = modal(), vv = window.visualViewport;
    if (!m || !vv) return;
    var gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    m.style.setProperty('--cs-kb', gap + 'px');
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', kb); window.visualViewport.addEventListener('scroll', kb); }

  /* ---------- 이벤트 ---------- */
  /* 과제 표 칸 💬 — 칸(날짜별 표)보다 먼저 받는다 (window 캡처) */
  window.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var mk = t.closest('[data-qn-hw]');
    if (mk) { e.preventDefault(); e.stopPropagation(); hwPop(mk.getAttribute('data-qn-hw'), mk.getAttribute('data-qn-from')); return; }
    if (t.closest('[data-qn-popx]') || t.id === 'qnHwPop') { var d = document.getElementById('qnHwPop'); if (d && d.open) d.close(); }
  }, true);
  window.addEventListener('keydown', function (e) {
    var mk = e.target && e.target.closest && e.target.closest('[data-qn-hw]');
    if (mk && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); hwPop(mk.getAttribute('data-qn-hw'), mk.getAttribute('data-qn-from')); }
  }, true);
  var NOOPEN = 'button, a, input, textarea, select, label, summary, details, [data-app-detail], .tdc-tri, .tdc-app-slot, .applink, .hd-menu';
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var ob = t.closest('[data-cs-open]');
    if (ob) { e.preventDefault(); e.stopPropagation(); open(ob.getAttribute('data-cs-open'), ob.hasAttribute('data-cs-focus') ? { focus: ob.getAttribute('data-cs-focus') } : null); return; }
    /* 줄 아무 곳 (버튼 · 과제 칸 · 펼친 칸은 빼고) */
    var row = t.closest('[data-cs-row]');
    if (row && !t.closest(NOOPEN) && (t === row || t.closest('.tdc-st__main'))) { open(row.getAttribute('data-cs-row')); return; }
    var m = modal();
    if (!m || !m.contains(t)) return;
    if (t === m || t.id === 'csClose') { close(); return; }
    if (t.closest('[data-cs-keep]')) { st.ask = false; paint(); return; }
    if (t.closest('[data-cs-drop]')) { close(true); return; }
    if (window.StuCard && StuCard.onClick(t, st.open, m)) { e.preventDefault(); return; }
    var b = t.closest('[data-cs-kind], [data-cs-reason], [data-cs-goal], [data-cs-prom], [data-cs-verd], [data-cs-more], [data-cs-card], [data-cs-worry], [data-cs-set], [data-cs-setsave], #csSave');
    if (!b) return;
    var sid = st.open;
    if (b.id === 'csSave') { save(); return; }
    if (b.hasAttribute('data-cs-kind')) { st.kind = b.getAttribute('data-cs-kind') === 'general' ? 'general' : 'hw'; st.err = ''; st.more = false; paint(); return; }
    if (b.hasAttribute('data-cs-reason')) {
      var r = b.getAttribute('data-cs-reason');
      st.draft.picks.reason = (st.draft.picks.reason || []).concat([r || '직접 입력']);
      put('csReason', r);
      return;
    }
    if (b.hasAttribute('data-cs-goal')) {
      var g = goals(info(sid)), all = b.getAttribute('data-cs-goal') === 'all';
      st.draft.goal = all ? { n: g.m, all: true } : { n: g.n, all: false };
      st.draft.picks.promise = all ? 'all' : 'min';
      put('csPromise', all ? '다음 주 ' + g.m + '개 전부 내기' : '다음 주 최소 ' + g.n + '개 내기');
      return;
    }
    if (b.hasAttribute('data-cs-prom')) {
      var p = b.getAttribute('data-cs-prom');
      st.draft.picks.promise = p || '직접 입력';
      put('csPromise', p);
      return;
    }
    if (b.hasAttribute('data-cs-verd')) { var pv = t.closest('[data-cs-prev]'); if (pv) setVerdict(pv.getAttribute('data-cs-prev'), b.getAttribute('data-cs-verd')); return; }
    if (b.hasAttribute('data-cs-more')) { st.more = !st.more; paint(); return; }
    if (b.hasAttribute('data-cs-card')) { close(true); if (window.Card) Card.open(sid); return; }
    if (b.hasAttribute('data-cs-set')) { st.setOpen = !st.setOpen; paint(); return; }
    if (b.hasAttribute('data-cs-setsave')) { saveCfg(); return; }
    if (b.hasAttribute('data-cs-worry')) {
      var h = info(sid), s = stu(sid) || {};
      close(true);
      Worry.open({ from: 'hw', items: [{ sid: sid, cls: h.cls || s.className || '', hwDay: h.miss[h.miss.length - 1], checks: [],
        reasons: [{ kind: 'hw', date: h.miss[h.miss.length - 1], dates: h.miss.map(mdw).join('·'), label: '미제출' }] }] });
    }
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target, m = modal();
    if (!m || !m.contains(t)) return;
    if (t.id === 'csReason') st.draft.reason = t.value;
    else if (t.id === 'csPromise') st.draft.promise = t.value;
    else if (t.id === 'csBodyIn') st.draft.body = t.value;
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'csFollow') st.draft.follow = e.target.checked;
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target, m = modal();
    if (!m || !m.contains(t) || !/^(csReason|csPromise|csBodyIn)$/.test(t.id)) return;
    kb();
    setTimeout(function () { kb(); if (document.activeElement === t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' }); }, 250);
  });
  document.addEventListener('close', function (e) { if (e.target === modal()) { st.open = ''; paintTags(); } }, true);
  /* Esc — 적던 글이 있으면 먼저 묻는다 */
  document.addEventListener('cancel', function (e) { if (e.target === modal() && st.open && dirty()) { e.preventDefault(); st.ask = true; paint(); } }, true);
  window.addEventListener('jt:app', function () { if (st.open && modal() && modal().open) { var a = document.activeElement; if (!a || !/^cs/.test(a.id || '')) paint(); } });
  window.addEventListener('jt:loaded', function () { loadLast(); });
  window.addEventListener('jt:refreshed', function () { loadLast(); });
  window.addEventListener('jt:remote', function (e) {
    var t = (e.detail && e.detail.table) || '';
    if (t !== '*' && t !== 'student_notes') return;
    st.notes = {};
    loadLast();
    if (st.open && !st.busy) loadNotes(st.open);
  });

  /* 예전 「지난번 약속」 날짜 찾기 — 상담 카드가 그대로 쓴다 */
  var DOW_RE = /(^|[^가-힣0-9])([월화수목금토일])(?:요일|욜)?(?=$|[^가-힣]|까지|에|엔|도|마다|랑|이랑|과|와|은|는)/g;
  function promiseDates(text, from) {
    var out = {}, s = String(text || ''), m, y = +from.slice(0, 4);
    DOW_RE.lastIndex = 0;
    while ((m = DOW_RE.exec(s))) {
      var w = DOWK.indexOf(m[2]), d = addDays(from, 1);
      for (var i = 0; i < 7 && dowOf(d) !== w; i++) d = addDays(d, 1);
      out[d] = true;
    }
    var putd = function (mo, da) {
      mo = +mo; da = +da;
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return;
      var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
      if (iso <= from) iso = (y + 1) + iso.slice(4);
      out[iso] = true;
    };
    s.replace(/(\d{1,2})\s*\/\s*(\d{1,2})/g, function (_, a, b) { putd(a, b); return _; });
    s.replace(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, function (_, a, b) { putd(a, b); return _; });
    return Object.keys(out).sort().slice(0, 7);
  }

  window.QuickNote = {
    tagHtml: tagHtml, btnHtml: btnHtml, slotHtml: slotHtml, mount: function () {}, close: close, reload: loadLast, open: open,
    hwMark: hwMark, kindOf: kindOf, periodOf: periodOf, perLabel: perLabel,      /* 과제 표 💬 · 상담 카드 분류 (20261109c) */
    /* 학생 카드 (stucard.js) — 다시 그리기 (soft = 글을 쓰는 중이면 그리지 않음) · 📌 확인 필요 → 상담 칸 체크 */
    repaint: function (soft) {
      var m = modal();
      if (!st.open || !m || !m.open) return;
      var a = document.activeElement;
      if (soft && a && m.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName)) return;
      paint();
    },
    pin: function () { st.draft.follow = true; st.goConsult = true; paint(); st.goConsult = false; toast('확인 필요(📌)에 체크했어요 — 상담을 저장하면 남습니다'); },
    promiseDates: promiseDates, goals: function (m, pct) { var n = Math.ceil(m * (pct || cfg().pct) / 100); return { m: m, n: Math.min(Math.max(n, 1), m) }; },
    todayNote: function (sid) { return st.today[sid] || null; },
    state: function () { return st; },
    /* 상담 카드에서 기록이 바뀌면 (card.js) */
    changed: function (sid) { if (sid) delete st.notes[sid]; loadLast(); }
  };
})();
