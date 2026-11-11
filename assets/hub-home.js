/* ============================================================
   hub-home.js — 러닝노트(/me) 홈 + 게임 프로필 + 캐릭터 고르기 + 내 사진 올리기 (20261110b)

   위에서 아래로 — 프로필 카드(캐릭터 · 레벨 · XP 막대 · 숫자 4개) → 이번 주 퀘스트 → 새 레포트 → 최근 모의고사 레포트 1개
                    → 「🏅 내 배지」(주간 배지 · 월간 배지 · 누르면 펼침) → 최근 수업 영상 1개
   새 데이터는 모으지 않는다 — 앱 과제 기록(hub.js appData) · 공개 레포트 · 모의고사 저장본 · 배지(주간 · 월간) · 수업 영상만
   XP · 레벨 · 해금은 game.js 한 곳. 다른 학생과 비교 · 순위 없음. 상담 · 약속 · 금액 · 번호 · 모의고사 점수 그래프 · 얼굴 사진은 여기 없다
   (내 사진은 올릴 때 이 기기에서 만든 미리보기만 잠깐 — 서버 사진 주소는 받지 않는다)
   고른 캐릭터 · 꾸미기 · 이미 본 레벨 · 이미 본 퍼펙트는 학생 기록(student_game · migration-093) — 093 전이면 이 기기에만
   내 사진은 035 의 student_profile(직원만 읽음) — me_photo_save 로 올리고 지운다 · 서버 사진은 이 화면에 오지 않는다
   ============================================================ */
(function (global) {
  'use strict';

  var G = function () { return global.Game; };
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function mdw(iso) { return md(iso) + '(' + DOWK[new Date(iso + 'T00:00:00Z').getUTCDay()] + ')'; }
  function store(k, v) {
    try { if (v === undefined) return global.localStorage.getItem(k); if (v === null) global.localStorage.removeItem(k); else global.localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function reduced() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  var H = null;   /* 지금 홈 { host, ctx, prof, g, q, open } */

  /* ---------- 프로필 ---------- */
  function localProf(code) { try { return JSON.parse(store('mhub.gm.' + code) || 'null') || {}; } catch (e) { return {}; } }
  function loadProfile(ctx) {
    var local = localProf(ctx.code);
    var role = ctx.role === 'student' || (!ctx.role && ctx.canWrite);
    return Promise.resolve().then(function () { return ctx.rpc('hub_profile', { p_code: ctx.code }); }).then(function (p) {
      if (!p || typeof p !== 'object') return Object.assign({ can_edit: role && !ctx.preview, local: true }, local);
      /* 학부모 링크는 저장하지 못한다 — 이미 본 레벨 · 퍼펙트는 이 기기 것과 큰 쪽 (연출은 기기마다 한 번) */
      p.seen_level = Math.max(Number(p.seen_level) || 0, Number(local.seen_level) || 0);
      if (String(local.seen_perfect || '') > String(p.seen_perfect || '')) p.seen_perfect = local.seen_perfect;
      return p;
    }, function () { return Object.assign({ can_edit: role && !ctx.preview, local: true }, local); });
  }
  function saveProfile(patch) {
    var ctx = H.ctx;
    Object.assign(H.prof, patch);
    var keep = { char: H.prof.char, frame: H.prof.frame, prop: H.prof.prop, seen_level: H.prof.seen_level, seen_perfect: H.prof.seen_perfect };
    store('mhub.gm.' + ctx.code, JSON.stringify(keep));
    if (H.prof.local || ctx.preview) return Promise.resolve({ ok: true, local: true });
    return Promise.resolve().then(function () { return ctx.rpc('hub_profile_save', { p_code: ctx.code, p: patch }); })
      .then(function (r) { return r || { ok: false }; }, function () { return { ok: false }; });
  }

  /* ---------- 그리기 ---------- */
  function statTile(icon, n, label, extra) {
    return '<div class="gm-stat' + (extra || '') + '"><span class="gm-stat__n num">' + icon + ' ' + n + '</span><span class="gm-stat__l">' + esc(label) + '</span></div>';
  }
  /* 숫자가 0 이면 기죽지 않게 — 「오늘 내면 🔥1일 시작!」 · 「이번 주 첫 주간 배지 도전!」 (학부모 링크는 학부모 시점 · 20261110d) */
  function zeroTile(kind) {
    var pa = isParent();
    var t = kind === 'streak' ? (pa ? '오늘 제출하면 🔥1일 시작' : '오늘 내면 🔥1일 시작!') : (pa ? '이번 주 첫 주간 배지 도전 중' : '이번 주 첫 주간 배지 도전!');
    return '<div class="gm-stat gm-stat--zero" data-gm-zero="' + kind + '"><span class="gm-stat__z">' + esc(t) + '</span><span class="gm-stat__l">' + (kind === 'streak' ? '연속 제출' : '주간 배지') + '</span></div>';
  }
  function isParent() { return !!H && H.ctx.role === 'parent'; }
  var LV_ICON = ['🌱', '👟', '⚡', '🏃', '🥈', '🥇', '🏆'];
  function profileHtml() {
    var c = H.ctx, st = c.student || {}, g = H.g, lv = g ? g.level : G().levelOf(0), p = G().clean(H.prof, lv.i);
    /* D-day — 「D-day 문자」 목록(hub_dday)이 있으면 그것 · 그 학생에게 남은 D-day 가 없으면 숨김 · 094 전이면 예전 시험 */
    var dd = H.dd ? H.dd : H.dd === false ? null : (c.dday ? c.dday() : null);
    var ava = G().avatarHtml(p, { size: 104, label: (isParent() ? (st.name || '') + ' 학생의 캐릭터 ' : '내 캐릭터 ') + G().charOf(p.char).name });
    var nx = G().LEVELS[lv.i + 1];
    /* 홈의 주인공 — 맨 위 작게 RUN 로고 · 학생용/학부모용 (큰 보라 머리는 홈에서 숨김) */
    return '<section class="gm-card gm-profile" id="gmProfile" aria-label="' + (isParent() ? esc((st.name || '') + ' 학생의 프로필') : '내 프로필') + '">' +
      '<div class="gm-brand"><img class="gm-brand__logo" src="' + esc((c.base || '../assets/chars/').replace(/chars\/$/, '') + 'logo.png') + '" alt="마라톤국어" width="44" height="25">' +
        /* 오른쪽 위 — 학생용/학부모용 · 공유 아이콘 (share.js · 20261110k · 미리보기에는 없음) */
        '<span class="gm-brand__r">' + (c.role ? '<span class="gm-brand__role">' + (c.role === 'student' ? '학생용' : '학부모용') + '</span>' : '') +
        (global.HubShare && !c.preview ? HubShare.btnHtml('home') : '') + '</span></div>' +
      '<div class="gm-top">' +
        (H.prof.can_edit ? '<button type="button" class="gm-ava-btn" data-gm-pick aria-label="캐릭터 고르기">' + ava + '<span class="gm-ava-edit" aria-hidden="true">✎</span></button>' : '<span class="gm-ava-btn is-static">' + ava + '</span>') +
        '<div class="gm-id">' +
          '<b class="gm-name">' + esc(st.name || '') + '</b>' +
          (st.class_name ? '<span class="gm-cls">' + esc(st.class_name) + '</span>' : '') +
          '<span class="gm-lv" id="gmLevel"><i class="gm-lv__i" aria-hidden="true">' + LV_ICON[lv.i] + '</i><b class="num">Lv.' + (lv.i + 1) + '</b> <span class="gm-lv__n">' + esc(lv.name) + '</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="gm-xp" aria-label="경험치">' +
        '<div class="gm-xp__t num"><b id="gmXp">' + (nx ? lv.xp + ' / ' + nx.xp + ' XP' : lv.xp + ' XP') + '</b><span id="gmToNext">' + (lv.next ? lv.next + '까지 ' + lv.toNext + ' XP' : '최고 레벨이에요') + '</span></div>' +
        '<div class="gm-xp__bar"><i style="width:' + lv.pct + '%"></i></div>' +
      '</div>' +
      '<div class="gm-stats">' +
        (g && g.streak > 0 ? statTile('🔥', g.streak + '일', '연속 제출') : g ? zeroTile('streak') : statTile('🔥', '–', '연속 제출')) +
        (g && g.perfect > 0 ? statTile('⭐', g.perfect + '개', '주간 배지') : g ? zeroTile('perfect') : statTile('⭐', '–', '주간 배지')) +
        statTile('', g ? g.total + '개' : '–', '총 제출') +
        (dd ? statTile('', esc(dd.badge), dd.name, ' gm-stat--dday') : '') +
      '</div>' +
      (H.empty ? '<p class="gm-hint">' + (isParent() ? esc((st.name || '') + ' 학생이 과제를 내면 XP가 쌓여요') : '과제를 내면 XP가 쌓여요') + '</p>' : '') +
      /* 앱 옛 기록(수강 시작 전 · 104) — XP · 레벨 · 퀘스트에는 안 넣고 작게 수만 (분석 · 능력치 · 배지 칸에는 같이 보임 · 20261111a) */
      (oldN() ? '<p class="gm-old num" id="gmOld">이전 기록 ' + oldN() + '개 · 학습 분석 · 능력치에 같이 보여요</p>' : '') +
    '</section>';
  }
  function oldN() { return H && H.data && global.Ability && Ability.oldCount ? Ability.oldCount(H.data) : 0; }
  /* 학부모 링크 — 「예진 학생의 이번 주」 */
  function questTitle() { return isParent() ? ((H.ctx.student || {}).name || '') + ' 학생의 이번 주' : '이번 주 퀘스트'; }
  var Q_TEXT = { done: '✓', todo: '아직', today: '오늘', future: '예정', exempt: '면제', off: '—' };
  function questHtml() {
    var q = H.q;
    if (!q) return '<section class="gm-card gm-quest" id="gmQuest"><h2 class="gm-h" id="gmQuestT">' + esc(questTitle()) + '</h2><p class="gm-hint">' + (H.loading ? '과제 기록을 불러오는 중…' : '이번 주 과제가 나오면 여기에 보여요') + '</p></section>';
    var pct = q.m ? Math.round(q.done / q.m * 100) : 0;
    return '<section class="gm-card gm-quest' + (q.perfect ? ' is-perfect' : '') + '" id="gmQuest" aria-label="이번 주 퀘스트">' +
      '<div class="gm-quest__h"><h2 class="gm-h" id="gmQuestT">' + esc(questTitle()) + '</h2><span class="gm-quest__p num">' + esc(md(q.from) + '~' + md(q.to)) + '</span></div>' +
      '<div class="gm-quest__sum num"><b>' + q.done + '/' + q.m + ' 완료</b><span>' + (q.perfect ? '주간 배지 달성! +' + G().RULES.perfect + 'XP' : '주간 배지까지 ' + q.toPerfect + '개') + '</span></div>' +
      '<div class="gm-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="gm-days" style="grid-template-columns:repeat(' + q.cells.length + ', minmax(0, 1fr))">' + q.cells.map(function (x) {
        return '<button type="button" class="gm-day gm-day--' + x.state + (x.today ? ' is-today' : '') + (H.open === x.date ? ' is-open' : '') + '" data-gm-day="' + x.date + '" aria-label="' + esc(mdw(x.date) + ' ' + (x.state === 'done' ? '냈어요' : x.state === 'todo' ? '아직 안 냈어요' : x.state === 'today' ? '오늘 과제' : x.state === 'future' ? '예정' : x.state === 'exempt' ? '면제' : '과제 없음')) + '">' +
          '<small>' + DOWK[new Date(x.date + 'T00:00:00Z').getUTCDay()] + '</small><b class="num">' + (+x.date.slice(8)) + '</b>' +
          '<span class="gm-day__m">' + Q_TEXT[x.state] + '</span>' + (x.state === 'done' ? '<span class="gm-day__xp num">+' + G().RULES.hw + 'XP</span>' : '') + '</button>';
      }).join('') + '</div>' +
      (H.open ? dayDetailHtml(H.open) : '') +
    '</section>';
  }
  function dayDetailHtml(date) {
    var x = (H.q.cells || []).filter(function (c) { return c.date === date; })[0];
    if (!x) return '';
    var t = x.state === 'done' ? (x.late ? '늦게 냈어요 · 그래도 +' + G().RULES.late + 'XP' : '냈어요 · +' + G().RULES.hw + 'XP') : x.state === 'todo' ? '아직 안 냈어요 · 지금 내도 XP를 받아요' :
            x.state === 'today' ? '오늘 과제 · 밤 12시까지' : x.state === 'future' ? '예정된 날이에요' : x.state === 'exempt' ? '면제된 날이에요' : '과제가 없는 날이에요';
    return '<div class="gm-dayinfo" id="gmDayInfo"><b class="num">' + esc(mdw(date)) + '</b> <span>' + esc(t) + '</span>' +
      '<button type="button" class="gm-link" data-gm-go="app">과제 상세 ›</button></div>';
  }
  function reportCardHtml() {
    var r = H.ctx.latestReport ? H.ctx.latestReport() : null;
    if (!r) return '<section class="gm-card gm-row" id="gmReport"><span class="gm-row__i" aria-hidden="true">🗞️</span><div class="gm-row__t"><b>수업 레포트</b><span>첫 레포트는 첫 수업 날 올라와요</span></div></section>';
    var isNew = store('mhub.seenrep.' + H.ctx.code) !== r.week_start;
    return '<button type="button" class="gm-card gm-row gm-row--btn" id="gmReport" data-gm-go="report">' +
      '<span class="gm-row__i" aria-hidden="true">🗞️</span><div class="gm-row__t"><b>' + esc(r.label) + ' 레포트' + (isNew ? ' <span class="gm-new">NEW</span>' : '') + '</b><span>' + (isNew ? '새 레포트가 올라왔어요' : '지난 레포트도 볼 수 있어요') + '</span></div><span class="gm-row__go" aria-hidden="true">›</span></button>';
  }
  function mogoHtml() {
    var m = H.ctx.mogo ? H.ctx.mogo() : null, r = m && m.reports && m.reports[0];
    if (!r) return '';
    return '<button type="button" class="gm-card gm-row gm-row--btn" id="gmMogo" data-gm-go="mogo"><span class="gm-row__i" aria-hidden="true">📝</span>' +
      '<div class="gm-row__t"><b>최근 모의고사 레포트</b><span>' + esc([r.date ? md(String(r.date).slice(0, 10)) : '', r.examName || ''].filter(Boolean).join(' · ')) + '</span></div><span class="gm-row__go" aria-hidden="true">›</span></button>';
  }
  function badgeHtml() {
    var v = H.badges;
    if (!v) return '';
    /* 제목은 「🏅 내 배지」 하나 · 옆에 작게 「⭐ 주간 n · 🏅 월간 n」 (「0/0주」 같은 셈은 없앰 · 20261110g) */
    var sum = global.BadgeView && BadgeView.sumText ? BadgeView.sumText(v) : '';
    return '<details class="gm-card gm-fold" id="gmBadge"><summary class="gm-fold__s"><span aria-hidden="true">🏅</span> <b>내 배지</b> <span class="num">' + esc(sum) + '</span></summary><div class="gm-fold__b" id="gmBadgeBox"></div></details>';
  }
  function videoHtml() {
    var v = H.ctx.latestVideo ? H.ctx.latestVideo() : null;
    if (!v) return '';
    return '<button type="button" class="gm-card gm-row gm-row--btn" id="gmVideo" data-gm-go="video"><span class="gm-row__i" aria-hidden="true">▶️</span>' +
      '<div class="gm-row__t"><b>최근 수업 영상</b><span>' + esc(v.label || '') + '</span></div><span class="gm-row__go" aria-hidden="true">›</span></button>';
  }
  /* 홈이 아닌 탭의 얇은 상단 바 (20261110f) — 작은 캐릭터 · 이름 · Lv.n 레벨 이름 · 작은 XP 막대 · 오른쪽 학생용/학부모용 */
  function barHtml() {
    var c = H.ctx, st = c.student || {}, lv = H.g ? H.g.level : G().levelOf(0), p = G().clean(H.prof, lv.i);
    return '<div class="hub-bar__in">' +
      '<span class="hub-bar__ava">' + G().avatarHtml({ char: p.char, frame: p.frame, prop: 'none' }, { size: 36, label: G().charOf(p.char).name }) + '</span>' +
      '<span class="hub-bar__id"><b class="hub-bar__n">' + esc(st.name || '') + '</b><span class="hub-bar__lv num" id="hubBarLv">Lv.' + (lv.i + 1) + ' ' + esc(lv.name) + '</span></span>' +
      '<span class="hub-bar__xp" aria-label="경험치 ' + lv.pct + '%"><i style="width:' + lv.pct + '%"></i></span>' +
      (c.role ? '<span class="hub-bar__role">' + (c.role === 'student' ? '학생용' : '학부모용') + '</span>' : '') +
    '</div>';
  }
  /* 능력치 — 과제 기록을 받은 뒤에만(그 전에는 빈칸) · 누르면 레포트 탭 「🎯 영역별 정답률」로 */
  /* 능력치 · 학습 분석은 기간 상태 하나를 같이 쓴다 (H.per — 한쪽에서 바꾸면 둘 다 · 20261110l) */
  function paintAbility() {
    var host = document.getElementById('gmAbilityHost');
    if (!host || !global.Ability || H.loading || H.data === undefined) return;
    Ability.mount(host, H.data || {}, { today: H.ctx.today, parent: isParent(), name: (H.ctx.student || {}).name || '', state: H.per,
      onKind: function () { paintAnalysis(); if (global.Analysis) Analysis.refresh(); },
      onGo: function () { if (H.ctx.go) H.ctx.go('report-cats'); } });
  }
  /* 「📊 내 학습 분석」 — 능력치 바로 아래 요약 카드 · [자세히 보기] · [▶ 지난주 리캡] (analysis.js · 20261110l) */
  function anaCtx() {
    var c = H.ctx, nm = (c.student || {}).name || '';
    return { data: H.data || {}, today: c.today, state: H.per, badges: H.badges, scores: H.scores || [], streak: H.g ? H.g.streak : null,
      parent: isParent(), name: nm,
      onKind: function () { paintAbility(); paintAnalysis(); },
      openSubs: global.SubView && !c.preview ? function (from, to, host) { if (host) SubView.mountHub(host, c.code, from, to); } : null,
      share: global.HubShare && !c.preview ? function () { HubShare.open(); HubShare.sharePhoto(); } : null,
      prepareShare: global.HubShare && !c.preview ? function () { HubShare.prepare(); } : null };
  }
  function paintAnalysis() {
    var host = document.getElementById('gmAnaHost');
    if (!host || !global.Analysis || H.loading || H.data === undefined) return;
    Analysis.mountSummary(host, anaCtx());
  }
  function paint() {
    if (!H) return;
    /* 「⚔️ 내 능력치」 — 프로필 카드 바로 아래 · 이번 주 퀘스트보다 위 (ability.js · 20261110h) · 기간 · 그래프 상태는 H.per 에 남김
       「📊 내 학습 분석」 — 능력치 바로 아래 (20261110l) */
    H.host.innerHTML = '<div class="gm-home">' + profileHtml() + '<div id="gmAbilityHost"></div><div id="gmAnaHost"></div>' + questHtml() + reportCardHtml() + mogoHtml() + badgeHtml() + videoHtml() + '</div>';
    paintAbility();
    paintAnalysis();
    var bar = document.getElementById('hubBar');
    if (bar) { bar.innerHTML = barHtml(); bar.hidden = false; }
  }

  /* ---------- 레벨 업 · 퍼펙트 위크 연출 — 처음 한 번만 (학생 기록 · 093 전이면 이 기기) ---------- */
  function celebrate() {
    if (!H || !H.g) return;
    var lv = H.g.level, seen = Math.max(0, Number(H.prof.seen_level) || 0);
    if (lv.i > seen) {
      var items = [];
      for (var k = seen + 1; k <= lv.i; k++) items = items.concat(G().newItemsAt(k));
      pop('레벨 업!', lv.name + ' 달성' + (items.length ? ' · 새 아이템 열림!' : ''), items.map(function (x) { return x.name; }));
      saveProfile({ seen_level: lv.i });
      return;
    }
    if (H.q && H.q.perfect && String(H.prof.seen_perfect || '') < H.q.from) {
      pop('주간 배지 ⭐', '이번 주 과제를 모두 냈어요 · +' + G().RULES.perfect + 'XP', []);
      saveProfile({ seen_perfect: H.q.from });
    }
  }
  function pop(title, sub, items) {
    var old = document.getElementById('gmPop'); if (old) { global.Layer.hide(old); if (old.parentNode) old.parentNode.removeChild(old); }
    /* 맨 앞 층 (20261111b) — Layer · <dialog> (Esc · 바깥 · 좋아요는 이 창만) */
    var el = global.Layer.make('gm-pop' + (reduced() ? ' is-still' : ''), 'gmPop', title);
    el.innerHTML = '<div class="gm-pop__in" role="status"><b class="gm-pop__t">' + esc(title) + '</b><span class="gm-pop__s">' + esc(sub) + '</span>' +
      (items.length ? '<span class="gm-pop__i">' + items.map(function (n) { return '<i>' + esc(n) + '</i>'; }).join('') + '</span>' : '') +
      '<button type="button" class="gm-pop__x" data-gm-popx>좋아요</button></div>';
    global.Layer.show(el, { full: true, remove: true });
    el.addEventListener('click', function (e) { if (e.target.closest('[data-gm-popx]')) global.Layer.hide(el); });
  }

  /* ---------- 캐릭터 고르기 ---------- */
  function pickerHtml() {
    var lv = H.g ? H.g.level : G().levelOf(0), d = H.draft;
    var row = function (kind, list) {
      return list.map(function (x) {
        var open = G().isOpen(kind, x.id, lv.i), on = d[kind] === x.id;
        return '<button type="button" class="gm-opt gm-opt--' + kind + (on ? ' is-on' : '') + (open ? '' : ' is-locked') + '" data-gm-' + kind + '="' + x.id + '"' + (open ? '' : ' aria-disabled="true"') +
          ' aria-pressed="' + on + '">' + (kind === 'frame' ? '<i style="background:' + x.color + '"></i>' : '') + '<span>' + esc(x.name) + '</span>' +
          (open ? '' : '<small class="gm-lock">🔒 ' + esc(G().lockText(x)) + '</small>') + '</button>';
      }).join('');
    };
    return '<div class="gm-sheet__in" role="dialog" aria-modal="true" aria-label="캐릭터 고르기">' +
      '<div class="gm-sheet__h"><b>캐릭터 고르기</b><button type="button" class="gm-x" data-gm-close aria-label="닫기">✕</button></div>' +
      '<div class="gm-sheet__pv">' + G().avatarHtml(d, { size: 112 }) + '<span class="gm-sheet__nm">' + esc(G().charOf(d.char).name) + '</span></div>' +
      /* 맨 앞 「마라톤국어 대표」 — 마라토니 · 마라부기 크게 (20261110f) · 그 아래 동물 러너 12종 */
      (function () {
        var btn = function (c, big) {
          var on = d.char === c.id, sz = big ? 96 : 56;
          return '<button type="button" class="gm-char' + (big ? ' gm-char--big' : '') + (on ? ' is-on' : '') + '" data-gm-char-pick="' + c.id + '" role="option" aria-selected="' + on + '">' +
            '<img src="' + esc(G().charSrc(c.id, H.ctx.base)) + '" alt="" width="' + sz + '" height="' + sz + '" loading="lazy"><span>' + esc(c.name) + '</span></button>';
        };
        var ms = G().CHARS.filter(function (c) { return c.mascot; }), rs = G().CHARS.filter(function (c) { return !c.mascot; });
        return '<div class="gm-chars-wrap" role="listbox" aria-label="캐릭터 14종">' +
          '<h3 class="gm-sub gm-sub--rep">마라톤국어 대표</h3><div class="gm-chars gm-chars--rep">' + ms.map(function (c) { return btn(c, true); }).join('') + '</div>' +
          '<h3 class="gm-sub">동물 러너</h3><div class="gm-chars">' + rs.map(function (c) { return btn(c, false); }).join('') + '</div></div>';
      })() +
      '<h3 class="gm-sub">테두리</h3><div class="gm-opts">' + row('frame', G().ITEMS.frame) + '</div>' +
      '<h3 class="gm-sub">소품</h3><div class="gm-opts">' + row('prop', G().ITEMS.prop) + '</div>' +
      faceHtml() +
      '<div class="gm-sheet__f"><button type="button" class="gm-btn gm-btn--ghost" data-gm-close>닫기</button><button type="button" class="gm-btn" data-gm-save>저장</button></div>' +
      '<p class="gm-msg" id="gmMsg" hidden></p>' +
    '</div>';
  }
  /* 내 사진 — 학생 링크만 (hub_face · 093) · 미리보기는 방금 고른 사진만 이 기기에서 */
  function faceHtml() {
    var f = H.face;
    if (!f || !f.can) return '';
    return '<div class="gm-face" id="gmFace"><h3 class="gm-sub">선생님이 이름을 익힐 수 있게 내 사진 올리기</h3>' +
      '<p class="gm-face__note">' + esc(global.FaceCrop ? FaceCrop.NOTE : '') + '</p>' +
      (H.facePv ? '<img class="gm-face__pv" src="' + esc(H.facePv) + '" alt="방금 올린 내 사진 (확인용)" width="96" height="96">' : '') +
      /* 안내 문구 확인 체크 — 체크해야 올라간다 (093 · 동의한 날짜 · 「학생」이 올림을 남긴다) */
      '<label class="gm-agree"><input type="checkbox" data-gm-agree' + (H.faceAgree ? ' checked' : '') + '> <span>위 안내를 읽었고 사진을 올리는 데 동의해요</span></label>' +
      '<div class="gm-face__b"><label class="gm-btn gm-btn--ghost gm-file' + (H.faceAgree ? '' : ' is-off') + '">' + (f.has ? '사진 바꾸기' : '사진 올리기') + '<input type="file" accept="image/*" data-gm-face hidden' + (H.faceAgree ? '' : ' disabled') + '></label>' +
      (f.has ? '<button type="button" class="gm-btn gm-btn--ghost" data-gm-face-del>사진 지우기</button>' : '') + '</div>' +
      '<p class="gm-face__s" id="gmFaceMsg">' + (f.has ? '사진이 올라가 있어요' : '아직 올린 사진이 없어요') + '</p></div>';
  }
  function openPicker() {
    if (!H || !H.prof.can_edit) return;
    var lv = H.g ? H.g.level : G().levelOf(0);
    H.draft = G().clean(H.prof, lv.i);
    if (!H.draft.char) H.draft.char = 'maratoni';
    var el = document.getElementById('gmSheet');
    /* 맨 앞 층 (20261111b) — Layer · <dialog> (Esc · 바깥 · 닫기는 이 창만) */
    if (!el) {
      el = global.Layer.make('gm-sheet', 'gmSheet', '캐릭터 고르기');
      el.addEventListener('close', function () { if (!el.open) document.documentElement.classList.remove('gm-noscroll'); });
      document.body.appendChild(el);
    }
    el.innerHTML = pickerHtml();
    global.Layer.show(el, { full: true });
    document.documentElement.classList.add('gm-noscroll');
    if (!H.face && H.ctx.rpc) {
      Promise.resolve().then(function () { return H.ctx.preview ? { has: false, can: false } : H.ctx.rpc('hub_face', { p_code: H.ctx.code }); })
        .then(function (f) { H.face = f || { can: false }; repaintPicker(); }, function () { H.face = { can: false }; });
    }
  }
  function repaintPicker() { var el = document.getElementById('gmSheet'); if (el && el.open) { var sc = el.querySelector('.gm-sheet__in'), top = sc ? sc.scrollTop : 0; el.innerHTML = pickerHtml(); var s2 = el.querySelector('.gm-sheet__in'); if (s2) s2.scrollTop = top; } }
  function closePicker() {
    var el = document.getElementById('gmSheet');
    if (el) global.Layer.hide(el);
    document.documentElement.classList.remove('gm-noscroll');
  }
  function msg(t) { var m = document.getElementById('gmMsg'); if (m) { m.hidden = !t; m.textContent = t || ''; } }
  function faceMsg(t) { var m = document.getElementById('gmFaceMsg'); if (m) m.textContent = t; }
  /* 올리기 · 지우기 — 035 me_photo_save (학생 링크만 · 비우면 표에서 지움) · 화면에는 방금 만든 미리보기만 */
  function uploadFace(file) {
    if (!global.FaceCrop) return;
    var why = FaceCrop.check(file);
    if (why) { faceMsg(why); return; }
    if (!H.faceAgree) { faceMsg('먼저 안내를 읽고 동의에 체크해 주세요'); return; }
    faceMsg('올리는 중…');
    FaceCrop.makeData(file).then(function (x) {
      var a3 = { p_code: H.ctx.code, p_photo: x.photo, p_thumb: x.thumb };
      return Promise.resolve(H.ctx.rpc('me_photo_save', Object.assign({ p_agree: true }, a3))).catch(function () { return H.ctx.rpc('me_photo_save', a3); }).then(function (r) {   /* 093 전이면 세 칸짜리로 */
        if (!r || !r.ok) { faceMsg(r && r.reason === 'agree' ? '먼저 안내를 읽고 동의에 체크해 주세요' : '올리지 못했어요. 잠시 뒤 다시 해 주세요.'); return; }
        H.face.has = true; H.facePv = x.thumb; repaintPicker(); faceMsg('올렸어요 · 선생님만 볼 수 있어요');
      });
    }).catch(function (e) { faceMsg(e.message || '올리지 못했어요.'); });
  }
  function deleteFace() {
    faceMsg('지우는 중…');
    var d3 = { p_code: H.ctx.code, p_photo: '', p_thumb: '' };
    Promise.resolve(H.ctx.rpc('me_photo_save', Object.assign({ p_agree: false }, d3))).catch(function () { return H.ctx.rpc('me_photo_save', d3); }).then(function (r) {
      if (!r || !r.ok) { faceMsg('지우지 못했어요.'); return; }
      H.face.has = false; H.facePv = ''; repaintPicker(); faceMsg('사진을 지웠어요');
    }, function () { faceMsg('지우지 못했어요.'); });
  }

  /* ---------- 이벤트 (한 번만) ---------- */
  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      if (!H) return;
      var t = e.target;
      if (t.closest('[data-gm-pick]')) { openPicker(); return; }
      var go = t.closest('[data-gm-go]');
      if (go && H.ctx.go) { H.ctx.go(go.getAttribute('data-gm-go')); return; }
      var day = t.closest('[data-gm-day]');
      if (day) { var dt = day.getAttribute('data-gm-day'); H.open = H.open === dt ? '' : dt; var qs = document.getElementById('gmQuest'); if (qs) qs.outerHTML = questHtml(); return; }
      var sheet = t.closest('#gmSheet');
      if (!sheet) return;
      if (t.closest('[data-gm-close]') || t === sheet) { closePicker(); return; }
      var c = t.closest('[data-gm-char-pick]');
      if (c) { H.draft.char = c.getAttribute('data-gm-char-pick'); repaintPicker(); return; }
      var lv = H.g ? H.g.level.i : 0;
      var fr = t.closest('[data-gm-frame]');
      if (fr) { var fid = fr.getAttribute('data-gm-frame'); if (G().isOpen('frame', fid, lv)) { H.draft.frame = fid; repaintPicker(); } else msg('🔒 ' + G().lockText(G().item('frame', fid))); return; }
      var pr = t.closest('[data-gm-prop]');
      if (pr && pr.tagName === 'BUTTON') { var pid = pr.getAttribute('data-gm-prop'); if (G().isOpen('prop', pid, lv)) { H.draft.prop = pid; repaintPicker(); } else msg('🔒 ' + G().lockText(G().item('prop', pid))); return; }
      if (t.closest('[data-gm-face-del]')) { deleteFace(); return; }
      if (t.closest('[data-gm-save]')) {
        var d = { char: H.draft.char, frame: H.draft.frame, prop: H.draft.prop };
        msg('저장하는 중…');
        saveProfile(d).then(function (r) {
          if (r && r.ok) { closePicker(); paint(); }
          else msg(r && r.reason === 'parent' ? '캐릭터는 학생 링크에서 고를 수 있어요' : '저장하지 못했어요 · 이 기기에는 남겨 두었어요');
          if (!(r && r.ok)) paint();
        });
      }
    });
    document.addEventListener('change', function (e) {
      if (H && e.target.matches && e.target.matches('[data-gm-agree]')) { H.faceAgree = !!e.target.checked; repaintPicker(); return; }
      if (H && e.target.matches && e.target.matches('[data-gm-face]') && e.target.files && e.target.files[0]) uploadFace(e.target.files[0]);
    });
    document.addEventListener('toggle', function (e) {
      if (!H || !e.target || e.target.id !== 'gmBadge' || !e.target.open) return;
      var box = document.getElementById('gmBadgeBox');
      if (box && global.BadgeView && !box.childNodes.length) BadgeView.mount(box, H.badges, function (m) { if (global.HubAward) HubAward.open(m); }, { noTitle: true, noNow: false });
    }, true);
  }

  /* ---------- 홈 열기 ----------
     ctx = { code, student, canWrite, preview, rpc, appData() → Promise<data>, today, bounds[], period { from, to }, dday() → { name, badge },
             latestReport() → { week_start, label }, mogo() → { reports }, latestVideo() → { label }, badges Promise, go(view), base } */
  function render(host, ctx) {
    if (!host || !G()) return;
    bind();
    H = { host: host, ctx: ctx, prof: { can_edit: false }, g: null, q: null, open: '', loading: true, empty: false, badges: null, face: null, facePv: '',
          per: { kind: 'w4', picked: false, graph: false }, scores: [] };
    var mine = H;
    paint();
    /* 오답정리 · 지문 장악 점수 (숫자만 · hub_scores · migration-101 전이면 없음) */
    if (ctx.scoresP) ctx.scoresP.then(function (v) { if (H !== mine || !Array.isArray(v) || !v.length) return; H.scores = v; paintAnalysis(); }, function () {});
    loadProfile(ctx).then(function (p) { if (H !== mine) return; H.prof = p || { can_edit: false }; paint(); });
    if (ctx.badges) ctx.badges.then(function (v) { if (H !== mine || !v) return; H.badges = v; paint(); }, function () {});
    H.dd = null;
    if (ctx.ddayP) ctx.ddayP.then(function (v) {
      if (H !== mine || !v || typeof v !== 'object') return;
      H.dd = v.none ? false : { name: v.short || v.name, badge: v.n === 0 ? 'D-DAY' : 'D-' + v.n };
      paint();
    }, function () {});
    Promise.resolve().then(function () { return ctx.appData(); }).then(function (data) {
      if (H !== mine) return;
      H.loading = false;
      H.data = data || null;
      var period = typeof ctx.period === 'function' ? ctx.period() : ctx.period;
      H.g = data ? G().compute(data, { today: ctx.today, bounds: ctx.bounds || [], period: period }) : null;
      H.q = H.g ? H.g.quest : null;
      H.empty = !H.g || !H.g.total;
      if (!H.g) H.g = G().compute({ calendar: [] }, { today: ctx.today });
      paint();
      if (!ctx.preview) celebrate();
    }, function () { if (H !== mine) return; H.loading = false; H.data = null; H.g = G().compute({ calendar: [] }, { today: ctx.today }); H.empty = true; paint(); });
  }
  function refresh() { paint(); }
  /* 공유 사진에 쓰는 값 (share.js · 20261110k) — 홈이 이미 가진 것 중 캐릭터 · 레벨 · 이번 주 퀘스트 · 연속 제출 · 배지 수 · 이름만
     점수 · 정답률 · 모의고사 · 상담 · 제출물 · 링크 코드는 넘기지 않는다 */
  function shareData() {
    if (!H) return null;
    var c = H.ctx, st = c.student || {}, g = H.g, lv = g ? g.level : G().levelOf(0), p = G().clean(H.prof, lv.i);
    var ch = G().charOf(p.char), fr = G().item('frame', p.frame) || G().ITEMS.frame[0], b = H.badges || {}, k = b.kings || {};
    return {
      ready: !H.loading, name: st.name || '',
      char: { name: ch.name, src: G().charSrc(ch.id, c.base), mascot: !!ch.mascot, prop: ch.mascot ? '' : (G().PROP_SVG[p.prop] || ''), ring: fr.color },
      level: { n: lv.i + 1, name: lv.name, icon: LV_ICON[lv.i] },
      quest: H.q ? { done: H.q.done, m: H.q.m, perfect: !!H.q.perfect } : null,
      streak: g ? g.streak || 0 : 0,
      badges: { weekly: +b.perfect || 0, monthly: (b.months || []).length, wrong: +k.wrong || 0, text: +k.text || 0 }
    };
  }
  function markSeen(code, week) { if (code && week) store('mhub.seenrep.' + code, week); }

  global.HubHome = { render: render, refresh: refresh, markSeen: markSeen, openPicker: openPicker, shareData: shareData, _state: function () { return H; } };
})(window);
