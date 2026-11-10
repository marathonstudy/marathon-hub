/* ============================================================
   game.js — 러닝노트 게임 프로필: XP · 레벨 · 퀘스트 · 캐릭터 · 꾸미기 해금 (20261110b)

   규칙은 여기 한 곳 (RULES · LEVELS · CHARS · ITEMS) — config.js 의 CONFIG.game 으로 덮어쓸 수 있다
     CONFIG.game = { rules: { hw: 10, perfect: 30, streakEvery: 5, streakBonus: 20 }, levels: [0, 100, 250, 450, 700, 1100, 1600] }
   새 데이터는 모으지 않는다 — 앱 과제 기록(app-report 의 calendar · 조교가 고친 값 withFix)만으로 센다
     · 과제 1개(그날 낸 과제 · 늦게 낸 것도) +10 · 감점 없음
     · 퍼펙트 주 +30 — 수업 기준 기간(그 반 수업일 L ~ 다음 수업 전날)에 과제가 있던 평일을 모두 냄 (기간이 끝났거나 남은 날이 없을 때)
     · 연속 제출 5일마다 +20 — 과제가 있던 평일을 빠짐없이 낸 날 수 (토 · 일 · 과제 없던 날 · 면제는 건너뜀 · 오늘 마감 전은 끊지 않음)
   학생 · 학부모 화면에 다른 학생과 비교 · 순위는 없다 (자기 기록만)

   캐릭터 그림 — assets/chars/<id>.svg (14종 · 이름 규칙 = 아래 CHARS 의 id)
     그림만 갈아끼우려면 같은 이름의 파일로 바꾸거나, PNG 로 넣고 CHAR_FILES 에 { id: 'id.png' } 를 적는다
     마스코트 진짜 그림 (넣어야 할 파일) — assets/chars/maratoni.png · assets/chars/marabugi.png (512×512 · 투명 배경 PNG · 얼굴이 가운데)
   ============================================================ */

(function (global) {
  'use strict';

  var CFG = (global.CONFIG && global.CONFIG.game) || {};

  /* ---------- XP 규칙 ---------- */
  var RULES = Object.assign({ hw: 10, late: 10, perfect: 30, streakEvery: 5, streakBonus: 20 }, CFG.rules || {});

  /* ---------- 레벨 — 한 학기(16주 · 평일 과제 80개) 꾸준히(90% 안팎) 하면 「풀코스」쯤
       예: 72개 × 10 = 720 · 퍼펙트 주 8번 × 30 = 240 · 연속 보너스 약 10번 × 20 = 200 → 1,160 XP ---------- */
  var LEVEL_XP = (CFG.levels && CFG.levels.length === 7) ? CFG.levels : [0, 100, 250, 450, 700, 1100, 1600];
  var LEVELS = [
    { key: 'warmup', name: '워밍업' }, { key: 'jog', name: '조깅' }, { key: 'pace', name: '페이스러너' },
    { key: '10k', name: '10K' }, { key: 'half', name: '하프' }, { key: 'full', name: '풀코스' }, { key: 'marathoner', name: '마라토너' }
  ].map(function (l, i) { l.xp = LEVEL_XP[i]; l.i = i; return l; });
  function levelIndex(key) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].key === key) return i; return 0; }

  /* ---------- 캐릭터 14종 (마스코트 2 + 동물 러너 12) ---------- */
  /* 마스코트 마라토니(토끼) · 마라부기(거북) — 진짜 그림 PNG (20261110f) · 동물 러너에서 토끼 · 거북은 빼고 사슴 · 코알라 */
  var CHARS = [
    { id: 'maratoni', name: '마라토니', mascot: true }, { id: 'marabugi', name: '마라부기', mascot: true },
    { id: 'deer', name: '사슴' }, { id: 'koala', name: '코알라' }, { id: 'cheetah', name: '치타' }, { id: 'penguin', name: '펭귄' },
    { id: 'fox', name: '여우' }, { id: 'bear', name: '곰' }, { id: 'cat', name: '고양이' }, { id: 'dog', name: '강아지' },
    { id: 'otter', name: '수달' }, { id: 'owl', name: '부엉이' }, { id: 'squirrel', name: '다람쥐' }, { id: 'hedgehog', name: '고슴도치' }
  ];
  var CHAR_FILES = Object.assign({ maratoni: 'maratoni.png', marabugi: 'marabugi.png' }, CFG.charFiles || {});
  /* 예전에 토끼 · 거북을 고른 학생 → 마라토니 · 마라부기 (서버도 migration-096 이 옮긴다) */
  var MOVED = { rabbit: 'maratoni', turtle: 'marabugi' };
  function charOf(id) { id = MOVED[id] || id; return CHARS.filter(function (c) { return c.id === id; })[0] || CHARS[0]; }

  /* ---------- 꾸미기 해금 표 (테두리 색 · 소품) — at = 그 레벨부터 열림 ---------- */
  var ITEMS = {
    frame: [
      { id: 'violet', name: '보라', color: '#7C6CF0', at: 'warmup' },
      { id: 'mint', name: '민트', color: '#3FBFA3', at: 'warmup' },
      { id: 'coral', name: '코랄', color: '#F08A7A', at: 'warmup' },
      { id: 'navy', name: '남색', color: '#2F3A8F', at: 'pace' },
      { id: 'silver', name: '은빛', color: '#A9B4C8', at: 'half' },
      { id: 'gold', name: '금빛', color: '#E2B23C', at: 'full' }
    ],
    prop: [
      { id: 'none', name: '없음', at: 'warmup' },
      { id: 'headband', name: '별 머리띠', at: 'warmup' },
      { id: 'cap', name: '러닝 캡', at: 'jog' },
      { id: 'shoes', name: '10K 운동화', at: '10k' },
      { id: 'silver', name: '하프 은메달', at: 'half' },
      { id: 'gold', name: '풀코스 금메달', at: 'full' },
      { id: 'trophy', name: '마라토너 트로피', at: 'marathoner' }
    ]
  };
  function item(kind, id) { return (ITEMS[kind] || []).filter(function (x) { return x.id === id; })[0] || null; }
  function isOpen(kind, id, lvl) { var x = item(kind, id); return !!x && levelIndex(x.at) <= lvl; }
  function lockText(x) { return LEVELS[levelIndex(x.at)].name + ' 달성 시 열림'; }
  /* 그 레벨에서 새로 열리는 것 (레벨 업 연출 「새 아이템 열림!」) */
  function newItemsAt(lvl) {
    var key = LEVELS[lvl] && LEVELS[lvl].key, out = [];
    ['frame', 'prop'].forEach(function (k) { ITEMS[k].forEach(function (x) { if (x.at === key && lvl > 0) out.push(x); }); });
    return out;
  }
  /* 저장된 고르기를 레벨에 맞게 — 잠긴 것은 기본으로 (서버에도 같은 규칙 · hub_profile_save) */
  function clean(p, lvl) {
    p = p || {};
    var pc = MOVED[p.char] || p.char;
    var ch = CHARS.some(function (c) { return c.id === pc; }) ? pc : '';
    return { char: ch, frame: isOpen('frame', p.frame, lvl) ? p.frame : 'violet', prop: isOpen('prop', p.prop, lvl) ? p.prop : 'headband' };
  }

  /* ---------- 날짜 ---------- */
  function valid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
  function weekend(iso) { var w = dow(iso); return w === 0 || w === 6; }
  function monday(iso) { return addDays(iso, -((dow(iso) + 6) % 7)); }

  /* 과제 있던 평일 — [{ date, done, late }] (오늘 마감 전 미제출 · 면제 · 토 · 일 · 수강 시작 전 · 앞으로 날은 뺀다) */
  function hwDays(data, today) {
    if (!data) return [];
    if (global.AppWeek && AppWeek.normalize) data = AppWeek.normalize(data);
    var start = valid(data.startOn) ? data.startOn : '', seen = {}, out = [];
    (data.calendar || []).forEach(function (c) {
      if (!c || !valid(c.date) || seen[c.date]) return;
      seen[c.date] = 1;
      if (weekend(c.date) || c.status === 'exempt' || (start && c.date < start) || (today && c.date > today)) return;
      var done = c.status === 'onTime' || c.status === 'late';
      if (today && c.date === today && !done) return;
      out.push({ date: c.date, done: done, late: c.status === 'late' });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /* 날짜 → 수업 기준 기간 시작 (bounds = 그 반 수업일 · 없거나 그 앞이면 그 주 월요일) */
  function periodStart(date, bounds) {
    var s = '';
    for (var i = 0; i < bounds.length; i++) if (bounds[i] <= date) s = bounds[i];
    return s && date < addDays(s, 14) ? s : monday(date);
  }
  function periodEnd(start, bounds) {
    for (var i = 0; i < bounds.length; i++) if (bounds[i] > start) return addDays(bounds[i], -1) < addDays(start, 13) ? addDays(bounds[i], -1) : addDays(start, 6);
    return addDays(start, 6);
  }

  /* ---------- 전체 계산 — opt = { today, bounds: [수업일 YYYY-MM-DD], period: { from, to } (이번 주 퀘스트) } ---------- */
  function compute(data, opt) {
    opt = opt || {};
    var today = opt.today || '', bounds = (opt.bounds || []).filter(valid).sort();
    var days = hwDays(data, today);
    var total = 0, run = 0, best = 0, bonus = 0;
    days.forEach(function (d) {
      if (d.done) { total++; run++; if (run > best) best = run; if (run % RULES.streakEvery === 0) bonus += RULES.streakBonus; }
      else run = 0;
    });
    /* 기간별 — 과제 있던 평일이 모두 제출 · 기간이 끝났을 때만 (이번 기간은 퀘스트가 따로 본다) */
    var per = {};
    days.forEach(function (d) { var s = periodStart(d.date, bounds); (per[s] = per[s] || { n: 0, done: 0 }); per[s].n++; if (d.done) per[s].done++; });
    var perfect = 0, perfectList = [];
    Object.keys(per).forEach(function (s) {
      var end = periodEnd(s, bounds), p = per[s];
      if (p.n > 0 && p.done === p.n && (!today || end < today)) { perfect++; perfectList.push(s); }
    });
    var q = opt.period ? quest(data, opt.period, today) : null;
    if (q && q.perfect && perfectList.indexOf(opt.period.from) === -1) { perfect++; perfectList.push(opt.period.from); }
    var lateN = days.filter(function (d) { return d.done && d.late; }).length;
    var xp = (total - lateN) * RULES.hw + lateN * RULES.late + perfect * RULES.perfect + bonus;
    var lv = levelOf(xp);
    return { xp: xp, total: total, streak: run, best: best, streakBonus: bonus, perfect: perfect, perfectList: perfectList.sort(), level: lv, quest: q };
  }
  function levelOf(xp) {
    var i = 0;
    for (var k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k;
    var cur = LEVELS[i], nx = LEVELS[i + 1] || null;
    return { i: i, key: cur.key, name: cur.name, xp: xp, next: nx ? nx.name : '', toNext: nx ? nx.xp - xp : 0,
             pct: nx ? Math.max(0, Math.min(100, Math.round((xp - cur.xp) / (nx.xp - cur.xp) * 100))) : 100 };
  }

  /* ---------- 이번 주 퀘스트 — 기간의 평일 칸 (낸 날 ✓ · 오늘 · 아직 · 예정 · 면제) ----------
     m = 과제가 있던 평일 + 앞으로 남은 평일(과제가 있을 날로 본다) · 퍼펙트 = m 개를 모두 냄 (남은 날 없음) */
  function quest(data, period, today) {
    if (!period || !valid(period.from) || !valid(period.to) || period.to < period.from) return null;
    if (data && global.AppWeek && AppWeek.normalize) data = AppWeek.normalize(data);
    var cal = {}, start = data && valid(data.startOn) ? data.startOn : '';
    ((data && data.calendar) || []).forEach(function (c) { if (c && valid(c.date)) cal[c.date] = c; });
    var cells = [], done = 0, m = 0, left = 0;
    for (var d = period.from, k = 0; d <= period.to && k < 15; d = addDays(d, 1), k++) {
      if (weekend(d)) continue;
      var c = cal[d], st;
      if (start && d < start) st = 'off';
      else if (today && d > today) st = c && c.status === 'exempt' ? 'exempt' : 'future';
      else if (!c) st = d === today ? 'future' : 'off';
      else if (c.status === 'exempt') st = 'exempt';
      else if (c.status === 'onTime' || c.status === 'late') st = 'done';
      else st = d === today ? 'today' : 'todo';
      if (st === 'done') { done++; m++; }
      else if (st === 'todo' || st === 'today' || st === 'future') { m++; left++; }
      cells.push({ date: d, state: st, today: d === today, late: !!(c && c.status === 'late') });
    }
    return { from: period.from, to: period.to, cells: cells, done: done, m: m, toPerfect: Math.max(0, m - done),
             perfect: m > 0 && done === m, xp: done * RULES.hw };
  }

  /* ---------- 캐릭터 그리기 — 테두리 색 원 + 그림 + 소품(같은 200×200 좌표에 겹침) ---------- */
  var INK = '#2B2350';
  var PROP_SVG = {
    none: '', headband: '',
    cap: '<path d="M46 66 Q100 4 154 66 Z" fill="#E85D75" stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"/><path d="M128 60 Q160 58 176 70 Q150 72 130 68 Z" fill="#C2405A" stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"/>',
    shoes: '<g transform="translate(4 150)"><path d="M4 30 L8 10 Q20 8 26 18 L46 24 Q54 28 52 36 L6 36 Z" fill="#22C1A5" stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 36 L52 36" stroke="#fff" stroke-width="3"/><text x="27" y="31" font-family="Arial" font-weight="800" font-size="9" fill="#fff" text-anchor="middle">10K</text></g>',
    silver: '<path d="M88 132 L100 150 L112 132" fill="none" stroke="#5B7BD5" stroke-width="5"/><circle cx="100" cy="160" r="13" fill="#D7DEEA" stroke="' + INK + '" stroke-width="2.5"/><text x="100" y="165" font-family="Arial" font-weight="800" font-size="11" fill="' + INK + '" text-anchor="middle">H</text>',
    gold: '<path d="M88 132 L100 150 L112 132" fill="none" stroke="#E85D75" stroke-width="5"/><circle cx="100" cy="160" r="14" fill="#F5C842" stroke="' + INK + '" stroke-width="2.5"/><text x="100" y="165" font-family="Arial" font-weight="800" font-size="11" fill="' + INK + '" text-anchor="middle">42</text>',
    trophy: '<g transform="translate(148 138)"><path d="M6 4 L40 4 L38 22 Q23 36 8 22 Z" fill="#F5C842" stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 8 Q-4 10 4 20 M40 8 Q50 10 42 20" fill="none" stroke="' + INK + '" stroke-width="2.5"/><rect x="17" y="30" width="12" height="8" fill="#F5C842" stroke="' + INK + '" stroke-width="2.5"/><rect x="11" y="38" width="24" height="7" rx="2" fill="#8E7CF5" stroke="' + INK + '" stroke-width="2.5"/></g>'
  };
  /* 별 머리띠 — 기본 머리띠 위에 노란 별 */
  PROP_SVG.headband = '<path d="M100 44 L104 54 L115 54 L106 60 L110 71 L100 64 L90 71 L94 60 L85 54 L96 54 Z" fill="#F5C842" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
  var PROP_BADGE = { headband: '⭐', cap: '🧢', shoes: '👟', silver: '🥈', gold: '🥇', trophy: '🏆' };
  function escA(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  /* p = { char, frame, prop } · o = { size, base, cls, label } */
  function avatarHtml(p, o) {
    p = p || {}; o = o || {};
    var c = charOf(p.char), fr = item('frame', p.frame) || ITEMS.frame[0], pr = PROP_SVG[p.prop] || '';
    var size = o.size || 96;
    var ava = '<span class="gm-ava' + (c.mascot ? ' gm-ava--mascot' : '') + (o.cls ? ' ' + o.cls : '') + '" style="--gm-ring:' + fr.color + ';width:' + size + 'px;height:' + size + 'px" data-gm-char="' + escA(c.id) + '">' +
      '<img class="gm-ava__img" src="' + escA(global.Game.charSrc(c.id, o.base)) + '" alt="' + escA(o.label || c.name) + '" width="' + size + '" height="' + size + '" draggable="false">' +
      (pr && !c.mascot ? '<svg class="gm-ava__prop" viewBox="0 0 200 200" aria-hidden="true" data-gm-prop="' + escA(p.prop) + '">' + pr + '</svg>' : '') +
    '</span>';
    /* 마스코트(진짜 그림)는 소품을 그림 위에 겹치지 않고 테두리 오른쪽 아래 작은 배지로 */
    if (c.mascot && p.prop && p.prop !== 'none') {
      return '<span class="gm-ava-wrap" style="--gm-ring:' + fr.color + ';width:' + size + 'px;height:' + size + 'px">' + ava +
        '<span class="gm-ava__badge" data-gm-prop="' + escA(p.prop) + '" title="' + escA((item('prop', p.prop) || {}).name || '') + '" aria-hidden="true">' + (PROP_BADGE[p.prop] || '') + '</span></span>';
    }
    return ava;
  }

  global.Game = {
    avatarHtml: avatarHtml, PROP_SVG: PROP_SVG,
    RULES: RULES, LEVELS: LEVELS, CHARS: CHARS, ITEMS: ITEMS, CHAR_FILES: CHAR_FILES,
    compute: compute, quest: quest, levelOf: levelOf, levelIndex: levelIndex, hwDays: hwDays,
    charOf: charOf, item: item, isOpen: isOpen, lockText: lockText, newItemsAt: newItemsAt, clean: clean,
    charSrc: function (id, base) { var c = charOf(id); return (base || '../assets/chars/') + (CHAR_FILES[c.id] || c.id + '.svg'); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
