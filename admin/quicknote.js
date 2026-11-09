/* ============================================================
   quicknote.js — 현장 빠른 상담 기록 (20261108s · migration-087 · 예전 20261031o 「상담 기록 +」 펼침 칸을 대신)

   학생 줄 — [상담 3] 버튼 하나 (예전 [상담 카드] · [상담 기록 +] 를 합침 · 지난 상담 개수) · 이름 · 줄 아무 곳을 눌러도 같은 창
     이름 아래 작은 글씨 — 「오늘 상담 ✓ 바빠서 → 최소 3개」 · 「지난 약속 3개 → 4개 ✓」 · 「상담 10/15」 · 「상담 없음」
   창 (휴대폰은 아래에서 올라오는 창 · 화면 아래 절반쯤 · 키보드가 올라와도 [저장]이 보이게)
     맨 위 — 이름 · 「이번 주 과제 2/5」 · 「11/5 목 · 11/6 금 안 냄」
     지난 약속 — 숫자 약속은 판정(「목표 3개 → 실제 4개 ✓ 지킴」) · 직접 약속은 「지켰나요? [지킴] [일부] [못 지킴]」
     종류 [과제] [학습] [생활] [기타] — 과제는 「과제 못 한 이유」 · 「다음 주 약속」 두 칸 · 다른 종류는 내용 칸 하나
       이유 버튼 [바빠서] [깜빡해서] [어려워서] [직접 입력] · 약속 버튼 [최소 n개] [전부 m개] [직접 입력] (설정에서 원장이 바꿈)
       m = 다음 주 과제 수(모르면 이번 주) · n = m × 상담 기준(기본 60%) 올림 · n = m 이면 [최소] 숨김
       버튼을 누르면 칸에 글로 들어감(있으면 「 · 」로 이어 붙이고 커서는 끝) · 누른 버튼은 picks 에 따로 (통계)
     [저장] 한 번 = 한 기록 (한 칸만 써도 됨 · 약속만 적으면 오늘 남긴 기록에 덧붙임) · 과제 상담은 안 낸 날짜를 함께 저장
     맨 아래 「지난 상담 n개 ▾」(접힘) · [걱정 문자] · [상담 카드 전체](기본 정보 · 성적 · 퇴원 사유 · 미리보기) · 확인 필요 📌
   조교 여럿이 동시에 써도 기록마다 한 줄씩 (덮어쓰지 않음) · 누가 적었는지 남음 (student_notes 의 author_name)
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

  var KINDS = ['과제', '학습', '생활', '기타'];
  var DEF_CFG = { pct: 60, reasons: ['바빠서', '깜빡해서', '어려워서'], promises: [], owner: false };
  var VERD = { kept: '✓ 지킴', partial: '△ 일부', missed: '✕ 못 지킴' };
  var COLS = 'id,student_id,note_date,categories,body,created_at,author_name,next_check,reason,promise,picks,goal_n,goal_all,goal_lesson,miss_days,verdict,verdict_done,verdict_total,verdict_by,hw_day,follow_up';
  var st = {
    last: {}, cnt: {}, today: {}, prom: {}, loaded: false, newCols: true,
    notes: {}, cfg: null,
    open: '', opts: {}, kind: '과제', more: false, busy: false, err: '', setOpen: false, judging: {},
    draft: null
  };
  function blank() { return { reason: '', promise: '', body: '', picks: { reason: [], promise: '' }, goal: null, follow: false }; }
  st.draft = blank();

  /* 자동으로 남는 기록(새 학생 앱 안내 문자 · sms.js)은 상담으로 세지 않는다 */
  function isAuto(n) { return (n.categories || []).join() === '기타' && /앱 안내 문자 보냄$/.test(n.body || ''); }
  function isNum(n) { return !!n && (n.goal_n != null || n.goal_all); }

  /* ---------- 불러오기 ---------- */
  function loadLast() {
    if (!sb()) return Promise.resolve();
    var q = function (cols) { return sb().from('student_notes').select(cols).is('deleted_at', null).gte('note_date', addDays(today(), -400)); };
    return Promise.resolve(q(COLS)).then(function (r) {
      if (r.error) { st.newCols = false; return q('id,student_id,note_date,categories,body,created_at,author_name,next_check'); }
      st.newCols = true;
      return r;
    }).then(function (r) {
      if (r.error) return;
      var last = {}, cnt = {}, td = {}, prom = {}, t = today();
      (r.data || []).forEach(function (n) {
        if (isAuto(n)) return;
        var sid = n.student_id;
        cnt[sid] = (cnt[sid] || 0) + 1;
        if (!last[sid] || n.note_date > last[sid]) last[sid] = n.note_date;
        if (n.note_date === t && (!td[sid] || n.created_at > td[sid].created_at)) td[sid] = n;
        if ((n.promise || '').trim() && n.note_date < t && (!prom[sid] || n.note_date > prom[sid].note_date || (n.note_date === prom[sid].note_date && n.created_at > prom[sid].created_at))) prom[sid] = n;
      });
      var changed = JSON.stringify(Object.keys(td).sort()) !== JSON.stringify(Object.keys(st.today || {}).sort());
      st.last = last; st.cnt = cnt; st.today = td; st.prom = prom; st.loaded = true;
      paintTags();
      judgeRows();
      if (changed) window.dispatchEvent(new CustomEvent('jt:consult-loaded'));
    });
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
    return '<button type="button" class="btn btn--sm qn-btn" data-cs-open="' + esc(sid) + '" data-qn-btn="' + esc(sid) + '" aria-label="' + esc((name || '') + ' 상담' + (n ? ' — 지난 상담 ' + n + '개' : '')) + '">상담' + (n ? ' <span class="num">' + n + '</span>' : '') + '</button>';
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
  function info(sid) { return window.Today && Today.hwInfo ? Today.hwInfo(sid) : null; }
  function cfg() { return st.cfg || DEF_CFG; }
  function goals(h) {
    var m = Math.max(1, (h && h.m) || 5), n = Math.ceil(m * (cfg().pct || 60) / 100);
    return { m: m, n: Math.min(Math.max(n, 1), m) };
  }

  /* 숫자 약속 — 판정 수업일이 지났는데 판정이 없으면 (수업 전 예고를 끈 반) 같은 셈으로 저장 */
  function judgeDue(sid) {
    var p = (st.notes[sid] || []).find(function (n) { return (n.promise || '').trim() && n.note_date < today(); });
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
  function prevPromise(sid) { return (st.notes[sid] || []).find(function (n) { return (n.promise || '').trim() && n.note_date < today(); }) || null; }
  function todayOpen(sid) { return (st.notes[sid] || []).find(function (n) { return n.note_date === today() && (n.categories || []).indexOf('과제') !== -1 && !(n.promise || '').trim() && (n.reason || '').trim(); }) || null; }
  function headHtml(sid) {
    var s = stu(sid) || {}, h = info(sid);
    var line = '';
    if (h && h.known) {
      line = '<span class="cs-hw num">' + esc(h.period.word + ' 과제 ' + h.done + '/' + h.total) + '</span>' +
        (h.miss.length ? '<span class="cs-miss num">' + esc(h.miss.map(mdSp).join(' · ') + ' 안 냄') + '</span>' : '<span class="cs-miss is-ok">안 낸 과제 없음</span>');
    } else if (h) line = '<span class="cs-hw is-mute">과제 기록 없음</span>';
    return '<div class="cs-head"><h2 class="cs-name" id="csTitle">' + esc(s.name || '') + '</h2><button type="button" class="cs-x" id="csClose" aria-label="닫기">✕</button>' +
      (line ? '<p class="cs-hwline">' + line + '</p>' : '') + '</div>';
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
  function formHtml(sid) {
    var d = st.draft, h = info(sid), g = goals(h), c = cfg();
    var html = '<div class="cs-kinds" role="tablist" aria-label="상담 종류">' + KINDS.map(function (k) {
      return '<button type="button" role="tab" class="cs-kind' + (st.kind === k ? ' is-on' : '') + '" data-cs-kind="' + k + '" aria-selected="' + (st.kind === k) + '">' + k + '</button>';
    }).join('') + '</div>';
    if (st.kind === '과제') {
      var open1 = todayOpen(sid);
      html += '<div class="cs-field"><span class="cs-lab">과제 못 한 이유</span><div class="cs-chips">' +
        c.reasons.map(function (r) { return chip('data-cs-reason', r, r); }).join('') + chip('data-cs-reason', '', '직접 입력', ' data-cs-free="reason"') + '</div>' +
        '<textarea class="textarea cs-in" id="csReason" rows="2" maxlength="500" enterkeyhint="next" placeholder="말하는 그대로 적거나 키보드 마이크로">' + esc(d.reason) + '</textarea></div>';
      html += '<div class="cs-field"><span class="cs-lab">다음 주 약속</span><div class="cs-chips">' +
        (g.n < g.m ? chip('data-cs-goal', 'min', '최소 ' + g.n + '개') : '') + chip('data-cs-goal', 'all', '전부 ' + g.m + '개') +
        (c.promises || []).map(function (p) { return chip('data-cs-prom', p, p); }).join('') + chip('data-cs-prom', '', '직접 입력', ' data-cs-free="promise"') + '</div>' +
        '<textarea class="textarea cs-in" id="csPromise" rows="2" maxlength="500" enterkeyhint="done" placeholder="예) 다음 주 최소 3개 내기">' + esc(d.promise) + '</textarea>' +
        (open1 ? '<p class="cs-hint">오늘 남긴 기록(' + esc(reasonShort(open1)) + ')에 약속이 없어요 — 약속만 적고 저장하면 그 기록에 덧붙입니다</p>' : '') + '</div>';
    } else {
      html += '<div class="cs-field"><span class="cs-lab">' + esc(st.kind) + ' 상담 내용</span><textarea class="textarea cs-in" id="csBodyIn" rows="3" maxlength="2000" placeholder="오늘 나눈 이야기">' + esc(d.body) + '</textarea></div>';
    }
    html += '<label class="cs-follow"><input type="checkbox" id="csFollow"' + (d.follow ? ' checked' : '') + '> 확인 필요 <small>(상담 카드 맨 위 📌)</small></label>';
    return html;
  }
  function pastHtml(sid) {
    var list = st.notes[sid];
    if (!list) return '<p class="cs-loading">지난 상담을 불러오는 중…</p>';
    if (!list.length) return '<p class="cs-first">첫 상담입니다</p>';
    var html = '<button type="button" class="cs-more" data-cs-more aria-expanded="' + st.more + '">지난 상담 ' + list.length + '개 ' + (st.more ? '▴' : '▾') + '</button>';
    if (st.more) html += '<ol class="cs-past">' + list.map(function (n) {
      var parts = (n.reason || n.promise) ? [(n.reason ? '이유: ' + n.reason : ''), (n.promise ? '약속: ' + n.promise : '')].filter(Boolean).join(' / ') : n.body;
      return '<li><div class="cs-past__h num">' + esc(mdw(n.note_date)) + ' · ' + esc((n.categories || []).join(', ')) + ' · ' + esc(n.author_name || '') +
        (n.verdict ? ' · <b class="cs-verd is-' + esc(n.verdict) + '">' + esc(isNum(n) ? verdictShort(n) : VERD[n.verdict]) + '</b>' : '') + '</div>' +
        '<div class="cs-past__b">' + esc(parts) + '</div>' + ((n.miss_days || []).length ? '<div class="cs-past__m num">안 낸 날 ' + esc(n.miss_days.map(mdSp).join(' · ')) + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
    return html;
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
    m.innerHTML = '<div class="cs-sheet">' + headHtml(sid) +
      '<div class="cs-scroll" id="csScroll">' + prevHtml(sid) + formHtml(sid) +
        (st.err ? '<p class="cs-err" role="alert">' + esc(st.err) + '</p>' : '') +
        '<div class="cs-tools">' + (h && h.known && h.miss.length && window.Worry ? '<button type="button" class="btn btn--sm" data-cs-worry>걱정 문자</button>' : '') +
          '<button type="button" class="btn btn--sm" data-cs-card>상담 카드 전체</button></div>' +
        /* 모의고사 (mogo.js · 20261109b) — 저장본만 · 누르면 화면 안 창 */
        (window.Mogo ? '<div class="cs-mogo" data-mg-host="' + esc(sid) + '">' + Mogo.sectionHtml(sid) + '</div>' : '') +
        pastHtml(sid) + setHtml() + '</div>' +
      '<div class="cs-foot"><button type="button" class="btn btn--primary cs-save" id="csSave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? '저장하는 중…' : '저장') + '</button></div></div>';
    if (focus) { var el = document.getElementById(focus); if (el) { el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} } }
    m.setAttribute('aria-label', (s.name || '') + ' 상담');
  }
  function open(sid, opts) {
    var m = modal();
    if (!m || !sid) { if (window.Card) Card.open(sid); return; }
    st.open = sid; st.opts = opts || {}; st.kind = '과제'; st.more = false; st.err = ''; st.busy = false; st.setOpen = false; st.draft = blank();
    paint();
    if (!m.open) m.showModal();
    kb();
    loadCfg().then(paint);
    loadNotes(sid);
    if (window.Mogo && Mogo.state().sql === null) Mogo.load();
  }
  function close() {
    var m = modal();
    st.open = ''; st.draft = blank(); st.err = '';
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

  /* ---------- 저장 ---------- */
  function composeBody(d, miss) {
    return [d.reason.trim() ? '이유: ' + d.reason.trim() : '', d.promise.trim() ? '약속: ' + d.promise.trim() : '',
      miss.length ? '안 낸 날: ' + miss.map(mdw).join(' · ') : ''].filter(Boolean).join('\n');
  }
  function save() {
    var sid = st.open, d = st.draft;
    if (!sid || st.busy) return;
    var h = info(sid), t = today();
    st.err = '';
    if (st.kind === '과제' && !d.reason.trim() && !d.promise.trim()) { st.err = '이유나 약속 중 하나는 적어 주세요'; paint(); return; }
    if (st.kind !== '과제' && !d.body.trim()) { st.err = '내용을 적어 주세요'; paint(); return; }
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
      close();
      loadLast();
      toast((name ? name + ' ' : '') + msg, 'good');
      if (window.Card && Card.notesChanged) Card.notesChanged(sid);
      window.dispatchEvent(new CustomEvent('jt:consult', { detail: { sid: sid } }));
    };
    var fail = function (m) {
      st.busy = false;
      st.err = /promise|reason|picks|goal_|student_notes_cat_check|schema cache|consult_/i.test(m || '') ? 'migration-087 SQL 을 먼저 실행해 주세요 (빠른 상담 칸)' : '저장하지 못했습니다 — ' + m;
      paint();
    };
    /* 약속만 적었고 오늘 남긴 과제 기록에 약속이 없으면 — 그 기록에 덧붙이기 (다른 사람이 먼저 덧붙였으면 새 기록) */
    var o1 = st.kind === '과제' && !d.reason.trim() && d.promise.trim() ? todayOpen(sid) : null;
    var insert = function () {
      var miss = st.kind === '과제' && h && h.known ? h.miss.slice() : [];
      var row = { student_id: sid, note_date: t, categories: [st.kind], follow_up: !!d.follow };
      if (st.kind === '과제') {
        row.body = composeBody(d, miss);
        if (d.promise.trim()) row.next_check = d.promise.trim().slice(0, 200);
        if (st.opts.hwDay) row.hw_day = st.opts.hwDay;
        if (st.newCols) Object.assign(row, {
          reason: d.reason.trim(), promise: d.promise.trim(), picks: d.picks, miss_days: miss,
          goal_n: goal ? goal.n : null, goal_all: !!(goal && goal.all), goal_lesson: goalLesson
        });
      } else row.body = d.body.trim();
      return Promise.resolve(sb().from('student_notes').insert(row).select('id').single()).then(function (r) {
        if (r.error) { fail(r.error.message); return; }
        done('상담을 남겼습니다');
      }, function (e) { fail(e && e.message); });
    };
    if (o1 && st.newCols) {
      Promise.resolve(sb().rpc('consult_promise_add', { p_note: o1.id, p_promise: d.promise.trim(), p_picks: d.picks, p_goal_n: goal ? goal.n : null, p_goal_all: !!(goal && goal.all), p_goal_lesson: goalLesson }))
        .then(function (r) {
          if (r.error) { fail(r.error.message); return; }
          if (r.data) done('오늘 기록에 약속을 덧붙였습니다');
          else insert();
        });
      return;
    }
    insert();
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
  var NOOPEN = 'button, a, input, textarea, select, label, summary, details, [data-app-detail], .tdc-tri, .tdc-app-slot, .applink, .hd-menu';
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var ob = t.closest('[data-cs-open]');
    if (ob) { e.preventDefault(); e.stopPropagation(); open(ob.getAttribute('data-cs-open')); return; }
    /* 줄 아무 곳 (버튼 · 과제 칸 · 펼친 칸은 빼고) */
    var row = t.closest('[data-cs-row]');
    if (row && !t.closest(NOOPEN) && (t === row || t.closest('.tdc-st__main'))) { open(row.getAttribute('data-cs-row')); return; }
    var m = modal();
    if (!m || !m.contains(t)) return;
    if (t === m || t.id === 'csClose') { close(); return; }
    var b = t.closest('[data-cs-kind], [data-cs-reason], [data-cs-goal], [data-cs-prom], [data-cs-verd], [data-cs-more], [data-cs-card], [data-cs-worry], [data-cs-set], [data-cs-setsave], #csSave');
    if (!b) return;
    var sid = st.open;
    if (b.id === 'csSave') { save(); return; }
    if (b.hasAttribute('data-cs-kind')) { st.kind = b.getAttribute('data-cs-kind'); st.err = ''; paint(); return; }
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
    if (b.hasAttribute('data-cs-card')) { close(); if (window.Card) Card.open(sid); return; }
    if (b.hasAttribute('data-cs-set')) { st.setOpen = !st.setOpen; paint(); return; }
    if (b.hasAttribute('data-cs-setsave')) { saveCfg(); return; }
    if (b.hasAttribute('data-cs-worry')) {
      var h = info(sid), s = stu(sid) || {};
      close();
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
    promiseDates: promiseDates, goals: function (m, pct) { var n = Math.ceil(m * (pct || cfg().pct) / 100); return { m: m, n: Math.min(Math.max(n, 1), m) }; },
    todayNote: function (sid) { return st.today[sid] || null; },
    state: function () { return st; },
    /* 상담 카드에서 기록이 바뀌면 (card.js) */
    changed: function (sid) { if (sid) delete st.notes[sid]; loadLast(); }
  };
})();
