/* ============================================================
   vidlink.js — 「영상 연결하기」 창 (20261107a)

   수업 영상이 빠진 레포트에 영상을 바로 넣는다.
   여는 곳 (모두 data-vidlink-cls · data-vidlink-week 를 단 단추 — 여기서 한 번에 받는다)
     · 「오늘」 반 카드 레포트 칩 옆 「영상 없음」 (today.js)
     · 레포트 발송 → 1 작성 → 반 공통 「수업 영상」 칸 [🔗 영상 연결하기] (weekly.js)
     · 레포트 발송 → 3 발송 반 카드의 「영상 없음」 (send.js)

   창 (위에서 아래로)
     1. 링크 직접 붙여 넣기
     2. 「같은 수업 같아요」 — 같은 주(월~일) 다른 반 수업 중 나간 자료가 같은 수업의 영상. 근거를 작게
        근거: 수업 자료(배부 파일 이름) · 과제 지문 제목(앱 과제 기록 저장본) · 교재 범위(수업 내용의 쪽 · 강) ·
              수업 내용(차시 번호를 뺀 글 전체) · 복습 테스트(시험 이름 · 「복습 TEST」 같은 기본 이름은 빼고)
        차시 · 회차 번호만 같은 것은 근거로 쓰지 않는다. 근거가 없으면 이 칸은 아예 안 보인다
        판단 기준은 VidLink.sameLessons 하나 — 나중에 「같은 회차 영상 자동 채우기」를 붙이면 이것을 같이 쓴다
     3. 「다른 반에 넣은 영상」 — 모든 반 lesson_videos 의 유튜브 영상, 최근 넣은 순 · 아래로 내리면 계속 더
        같은 영상(유튜브 영상 번호가 같음)은 한 줄로 합치고 「목동반 11/1 · 반포반 11/2」
     줄 = 썸네일(작게) · 넣은 반 · 날짜 · 영상 제목(유튜브에서 못 받으면 저장된 제목 · 그것도 없으면 링크)
     줄을 고르고 [이 영상 넣기] → lesson_videos 에 그 반 그 주 「수업 영상(전체)」로 저장
       → 「목동반 10/31 레포트에 넣었어요」 · 「영상 없음」 표시가 바로 사라진다 (jt:video-linked)
   이미 보낸 레포트: 러닝노트 · 레포트 화면은 열 때마다 lesson_videos 를 읽으므로 다시 공개 없이 바로 보인다.
     문자 · 알림톡은 다시 보내지 않는다 (「알릴까요?」도 묻지 않는다)
     보낸 레포트면 레포트 업데이트 문자(rupd.js · migration-073)가 30분 뒤 모아 「· 수업 영상」으로 알린다 (jt:video-linked 로 맨 위 띠가 바로 뜬다)
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var PAGE = 60;
  var DEFAULT_TITLE = /^(수업 영상|1차시 영상|2차시 영상|보강 영상)?$/;

  /* ---------- 유튜브 ---------- */
  function ytId(u) {
    var m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/))([\w-]{11})/i.exec(String(u || ''));
    return m ? m[1] : '';
  }
  function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }
  var titles = {};            /* 영상 번호 → 유튜브 제목 ('' = 못 받음) */
  function fetchTitle(id) {
    if (id in titles || typeof fetch !== 'function') return Promise.resolve(titles[id] || '');
    titles[id] = '';
    var url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    return Promise.resolve(fetch(url)).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) {
      var t = j && typeof j.title === 'string' ? j.title.trim().slice(0, 100) : '';
      titles[id] = t;
      return t;
    }).catch(function () { return ''; });
  }

  /* ---------- 이름 · 날짜 ---------- */
  function isKey(c) { return !!(window.Course && Course.isKey && Course.isKey(c)); }
  function clsLabel(c) {
    if (isKey(c)) { var k = Course.byKey ? Course.byKey(c) : null; return (k && k.name) || String(c).slice(1); }
    return c;
  }
  function lessonDate(cls, week) {
    var L = !isKey(cls) && window.Store && Store.lessonOf ? Store.lessonOf(cls, week) : null;
    return L && L.date && !L.canceled ? L.date : week;
  }
  function md(d) { return window.Lesson ? Lesson.md(d, false) : d; }

  /* ============================================================
     같은 수업 판단 — 한 곳 (VidLink.sameLessons)
     ============================================================ */
  /* 비교용 글 — 공백 · 기호를 빼고 소문자 · 「1차시」 「3회차」 「2주차」 같은 번호는 지운다 */
  function strip(s) {
    return String(s || '').normalize('NFC').toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/, '')
      .replace(/\d+\s*(차시|회차|주차|교시|회)/g, '')
      .replace(/[\s ·.,:;!?'"`~\-_=+()[\]{}<>\/\\|#*&^%$@]+/g, '');
  }
  function words(list, drop) {
    var out = {};
    (list || []).forEach(function (x) {
      var k = strip(x);
      (drop || []).forEach(function (d) { if (d) k = k.split(d).join(''); });
      if (k.replace(/\d/g, '').length >= 2) out[k] = 1;            /* 숫자만 남으면(번호뿐) 근거가 아니다 */
    });
    return out;
  }
  function common(a, b) { return Object.keys(a).filter(function (k) { return b[k]; }).length; }
  /* 복습 테스트 — 「복습 TEST」 「화작문 테스트」처럼 이름뿐인 기본값은 어느 반이나 같아서 뺀다 */
  var GENERIC_TEST = /^(복습|화작문|문법|어휘|독서|문학|리뷰|주간|단어)?(test|테스트|시험|리뷰테스트|퀴즈|quiz)\d*$/;
  function tests(list) {
    var out = {};
    (list || []).forEach(function (x) { var k = strip(x); if (k.replace(/\d/g, '').length >= 2 && !GENERIC_TEST.test(k)) out[k] = 1; });
    return out;
  }
  /* 교재 범위 — 수업 내용 글에서 「p.12~20」 「12~20쪽」 「수특 3강」 「수능특강 독서 3~4강」 */
  function ranges(lessons) {
    var out = {};
    (lessons || []).forEach(function (t) {
      var s = String(t || '').normalize('NFC');
      var m, re1 = /p\.?\s*(\d+)\s*(?:[~\-–]\s*(\d+))?/gi, re2 = /(\d+)\s*(?:[~\-–]\s*(\d+))?\s*(?:쪽|페이지)/g,
          re3 = /([가-힣A-Za-z]{2,}(?:\s+[가-힣A-Za-z]{2,})?)\s*(\d+)\s*(?:[~\-–]\s*(\d+))?\s*강/g;
      while ((m = re1.exec(s))) out['p' + m[1] + (m[2] ? '-' + m[2] : '')] = 1;
      while ((m = re2.exec(s))) out['p' + m[1] + (m[2] ? '-' + m[2] : '')] = 1;
      while ((m = re3.exec(s))) out[strip(m[1]) + m[2] + (m[3] ? '-' + m[3] : '') + '강'] = 1;
    });
    return out;
  }
  function lessonText(lessons) {
    var k = strip((lessons || []).join(' '));
    return k.replace(/\d/g, '').length >= 6 ? k : '';
  }
  /* 앱 과제 기록 저장본 — 그 주(월~일) 수업 날짜의 차시(order)에 딸린 과제 제목 (번호가 아니라 제목만 쓴다) */
  function hwTitles(lites, week) {
    var end = window.Lesson ? Lesson.addDays(week, 6) : week;
    var out = [];
    (lites || []).forEach(function (d) {
      if (!d) return;
      var orders = {};
      (d.calendar || []).forEach(function (c) { if (c && c.date >= week && c.date <= end && c.order != null) orders[c.order] = 1; });
      (d.history || []).forEach(function (h) { if (h && orders[h.order] && h.title) out.push(String(h.title).replace(/^(독서|문학)\s*-\s*/, '')); });
    });
    return out;
  }
  /* facts[반] = { files: [이름], lessons: [글], tests: [이름], hw: [과제 제목] } → [{ cls, score, why: ['복습 테스트 같음', …] }] */
  function sameLessons(target, facts) {
    var me = facts[target];
    if (!me) return [];
    var drop = function (c) { var s = strip(c), sh = strip(window.Course && Course.shortName ? Course.shortName(c) : c); return [s, sh]; };
    var mine = {
      files: words(me.files, drop(target)), tests: tests(me.tests), hw: words(me.hw),
      ranges: ranges(me.lessons), text: lessonText(me.lessons)
    };
    return Object.keys(facts).filter(function (c) { return c !== target; }).map(function (c) {
      var f = facts[c], why = [], score = 0;
      var t = common(mine.tests, tests(f.tests));
      if (t) { why.push('복습 테스트 같음'); score += 3; }
      var h = common(mine.hw, words(f.hw));
      if (h) { why.push('과제 지문 ' + h + '개 같음'); score += 2 * h; }
      var m = common(mine.files, words(f.files, drop(c)));
      if (m) { why.push('수업 자료 ' + m + '개 같음'); score += 2 * m; }
      var r = common(mine.ranges, ranges(f.lessons));
      if (r) { why.push('교재 범위 같음'); score += 2; }
      if (mine.text && mine.text === lessonText(f.lessons)) { why.push('수업 내용 같음'); score += 2; }
      return { cls: c, score: score, why: why };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.cls.localeCompare(b.cls, 'ko'); });
  }

  /* ============================================================
     창
     ============================================================ */
  var st = { cls: '', week: '', run: 0, groups: [], byId: {}, seen: {}, cursor: null, lim: PAGE, done: false, busy: false, pick: '', same: [], saving: false };

  function dialog() {
    var d = $('#vlModal');
    if (d) return d;
    d = document.createElement('dialog');
    d.className = 'modal vl-modal'; d.id = 'vlModal';
    d.setAttribute('aria-labelledby', 'vlTitle');
    d.innerHTML =
      '<div class="modal__head"><h2 class="modal__title" id="vlTitle">영상 연결하기</h2><p class="modal__desc" id="vlDesc"></p></div>' +
      '<div class="vl-body" id="vlBody">' +
        '<div class="vl-paste"><label class="field__label" for="vlUrl">유튜브 링크 직접 붙여 넣기</label>' +
          '<div class="vl-paste__row"><input class="input" id="vlUrl" inputmode="url" autocomplete="off" placeholder="https://youtu.be/…">' +
          '<button class="btn btn--sm btn--primary" type="button" id="vlUrlAdd">넣기</button></div></div>' +
        '<section class="vl-sec" id="vlSame" hidden><h3 class="vl-sec__t">같은 수업 같아요</h3><div class="vl-list" id="vlSameList"></div></section>' +
        '<section class="vl-sec" id="vlAllSec"><h3 class="vl-sec__t">다른 반에 넣은 영상 <span class="muted-note">최근 넣은 순</span></h3>' +
          '<div class="vl-list vl-list--all" id="vlList"></div>' +
          '<p class="vl-more muted-note" id="vlMore" aria-live="polite"></p></section>' +
      '</div>' +
      '<div class="modal__foot vl-foot">' +
        '<button class="btn" type="button" id="vlClose">닫기</button>' +
        '<button class="btn btn--primary" type="button" id="vlPut" disabled>이 영상 넣기</button>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'vlUrl') { e.preventDefault(); putUrl(); } });
    $('#vlBody', d).addEventListener('scroll', function () { var b = $('#vlBody'); if (b.scrollTop + b.clientHeight >= b.scrollHeight - 120) more(); });
    return d;
  }

  function open(o) {
    o = o || {};
    if (!o.cls || !o.week || !sb()) return;
    var d = dialog();
    st.cls = o.cls; st.week = o.week; st.run++;
    st.groups = []; st.byId = {}; st.seen = {}; st.cursor = null; st.lim = PAGE; st.done = false; st.busy = false; st.pick = ''; st.same = []; st.saving = false;
    $('#vlDesc').textContent = clsLabel(st.cls) + ' ' + md(lessonDate(st.cls, st.week)) + ' 수업 레포트 — 넣으면 러닝노트 · 레포트에 바로 보입니다 (문자는 다시 보내지 않습니다)';
    $('#vlUrl').value = '';
    $('#vlSame').hidden = true; $('#vlSameList').innerHTML = '';
    $('#vlList').innerHTML = '';
    $('#vlMore').textContent = '불러오는 중…';
    $('#vlBody').scrollTop = 0;
    paintPut();
    if (!d.open) Layer.show(d);
    loadSame(st.run);
    more();
  }
  function close() { var d = $('#vlModal'); if (d && d.open) d.close(); st.run++; }

  /* ---------- 줄 ---------- */
  function placeText(g) {
    return g.places.map(function (p) { return clsLabel(p.cls) + ' ' + md(p.date); }).join(' · ');
  }
  function nameOf(g) {
    return titles[g.id] || (g.title && !DEFAULT_TITLE.test(g.title) ? g.title : '') || g.url;
  }
  function rowHtml(g, why) {
    var on = st.pick === g.id;
    return '<button type="button" class="vl-row' + (on ? ' is-on' : '') + '" data-vl="' + esc(g.id) + '" aria-pressed="' + on + '">' +
      '<img class="vl-row__img" src="' + esc(thumb(g.id)) + '" alt="" loading="lazy" width="80" height="45">' +
      '<span class="vl-row__txt"><span class="vl-row__where num">' + esc(placeText(g)) + '</span>' +
        '<span class="vl-row__name">' + esc(nameOf(g)) + '</span>' +
        (why ? '<span class="vl-row__why">' + esc(why) + '</span>' : '') + '</span>' +
    '</button>';
  }
  function paintAll() {
    var host = $('#vlList');
    if (!host) return;
    host.innerHTML = st.groups.length ? st.groups.map(function (g) { return rowHtml(g); }).join('')
      : (st.done ? '<p class="panel__hint">아직 다른 반에 넣은 영상이 없습니다. 위에 링크를 붙여 넣어 주세요.</p>' : '');
    $('#vlMore').textContent = st.busy ? '더 불러오는 중…' : st.done ? '' : '아래로 내리면 더 나옵니다';
  }
  function paintSame() {
    var box = $('#vlSame');
    if (!box) return;
    var rows = [];
    st.same.forEach(function (x) { x.groups.forEach(function (g) { rows.push(rowHtml(g, x.why.join(' · '))); }); });
    box.hidden = !rows.length;
    $('#vlSameList').innerHTML = rows.join('');
  }
  function paintPut() {
    var b = $('#vlPut');
    if (b) { b.disabled = !st.pick || st.saving; b.textContent = st.saving ? '넣는 중…' : '이 영상 넣기'; }
  }
  function lookupTitles(list) {
    list.forEach(function (g) {
      if (g.id in titles) return;
      var run = st.run;
      fetchTitle(g.id).then(function (t) {
        if (!t || run !== st.run) return;
        Array.prototype.forEach.call(document.querySelectorAll('#vlModal [data-vl="' + g.id + '"] .vl-row__name'), function (el) { el.textContent = t; });
      });
    });
  }
  /* 영상 줄들 → 같은 영상끼리 합친 묶음 (먼저 나온 것이 위) */
  function addRows(rows, groups, byId, seen) {
    rows.forEach(function (v) {
      if (seen[v.id]) return;
      seen[v.id] = 1;
      var id = ytId(v.url);
      if (!id || isKey(v.class_name) || (v.class_name === st.cls && v.week_start === st.week)) return;
      var g = byId[id];
      if (!g) { g = byId[id] = { id: id, url: v.url, title: v.title || '', places: [] }; groups.push(g); }
      if (!g.title || DEFAULT_TITLE.test(g.title)) g.title = v.title || g.title;
      var date = lessonDate(v.class_name, v.week_start);
      if (!g.places.some(function (p) { return p.cls === v.class_name && p.date === date; })) g.places.push({ cls: v.class_name, date: date });
    });
  }

  /* ---------- 다른 반에 넣은 영상 — 최근 순 · 계속 불러오기 ---------- */
  function more() {
    if (st.busy || st.done || !sb()) return Promise.resolve();
    var run = st.run;
    st.busy = true; paintAll();
    var q = sb().from('lesson_videos').select('id,class_name,week_start,title,url,created_at');
    if (st.cursor) q = q.lte('created_at', st.cursor);
    var lim = st.lim;
    return Promise.resolve(q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(lim)).then(function (r) {
      if (run !== st.run) return;
      st.busy = false;
      if (!r || r.error) { st.done = true; paintAll(); $('#vlMore').textContent = '영상 목록을 불러오지 못했습니다' + (r && r.error ? ' — ' + r.error.message : ''); return; }
      var rows = r.data || [];
      var fresh = rows.filter(function (v) { return !st.seen[v.id]; });
      addRows(rows, st.groups, st.byId, st.seen);
      /* 다음 쪽은 마지막 줄의 시각부터 (같은 시각에 넣은 줄이 많으면 — 과정 복사 — 한 번에 더 많이) */
      if (rows.length < lim) st.done = true;
      else if (!fresh.length) { st.lim = lim * 2; if (st.lim > 2000) st.done = true; }
      else { st.cursor = rows[rows.length - 1].created_at; st.lim = PAGE; }
      paintAll();
      lookupTitles(st.groups);
      /* 창이 다 안 찼으면 한 번 더 (휴대폰 · 큰 화면) */
      var b = $('#vlBody');
      if (!st.done && b && b.scrollHeight <= b.clientHeight + 120) return more();
    }, function (e) { if (run === st.run) { st.busy = false; st.done = true; paintAll(); $('#vlMore').textContent = '영상 목록을 불러오지 못했습니다 — ' + ((e && e.message) || ''); } });
  }

  /* ---------- 같은 수업 같아요 — 같은 주 다른 반 ---------- */
  function rowsOf(r) { return r && !r.error && Array.isArray(r.data) ? r.data : []; }
  function loadSame(run) {
    var c = sb(), wk = st.week, cls = st.cls;
    return Promise.resolve(c.from('lesson_videos').select('id,class_name,week_start,title,url,student_ids,created_at').eq('week_start', wk).order('created_at', { ascending: false })).then(function (r) {
      if (run !== st.run) return;
      var vids = rowsOf(r).filter(function (v) { return v.class_name !== cls && !isKey(v.class_name) && !(v.student_ids || []).length && ytId(v.url); });
      var names = {};
      vids.forEach(function (v) { names[v.class_name] = 1; });
      var list = Object.keys(names);
      if (!list.length) return;
      var all = list.concat([cls]);
      var studs = window.Store && Store.activeStudents ? Store.activeStudents(wk).filter(function (s) { return all.indexOf((s.className || '').trim()) !== -1; }) : [];
      return Promise.all([
        c.from('class_files').select('class_name,name').eq('week_start', wk).in('class_name', all),
        c.from('week_common').select('class_name,lessons,tests').eq('week_start', wk).in('class_name', all),
        c.from('review_tests').select('class_name,test_name,off').eq('week_start', wk).in('class_name', all),
        studs.length ? c.from('app_records').select('student_id,lite').in('student_id', studs.map(function (s) { return s.id; })) : Promise.resolve({ data: [] })
      ].map(function (p) { return Promise.resolve(p).then(function (x) { return x; }, function () { return null; }); })).then(function (res) {
        if (run !== st.run) return;
        var facts = {};
        all.forEach(function (n) { facts[n] = { files: [], lessons: [], tests: [], hw: [] }; });
        rowsOf(res[0]).forEach(function (f) { if (facts[f.class_name]) facts[f.class_name].files.push(f.name); });
        rowsOf(res[1]).forEach(function (w) {
          var f = facts[w.class_name]; if (!f) return;
          f.lessons = f.lessons.concat(Array.isArray(w.lessons) ? w.lessons : []);
          f.tests = f.tests.concat(Array.isArray(w.tests) ? w.tests : []);
        });
        rowsOf(res[2]).forEach(function (t) { if (facts[t.class_name] && !t.off && t.test_name) facts[t.class_name].tests.push(t.test_name); });
        var lite = {};
        rowsOf(res[3]).forEach(function (a) { lite[a.student_id] = a.lite; });
        var byCls = {};
        studs.forEach(function (s) { var n = (s.className || '').trim(); (byCls[n] = byCls[n] || []).push(lite[s.id]); });
        all.forEach(function (n) { facts[n].hw = hwTitles(byCls[n], wk); });
        st.same = sameLessons(cls, facts).map(function (m) {
          var gs = [], by = {}, seen = {};
          addRows(vids.filter(function (v) { return v.class_name === m.cls; }), gs, by, seen);
          return { cls: m.cls, why: m.why, groups: gs };
        }).filter(function (m) { return m.groups.length; });
        paintSame();
        st.same.forEach(function (m) { lookupTitles(m.groups); });
      });
    }).catch(function () {});
  }

  /* ---------- 넣기 ---------- */
  function pickGroup(id) {
    if (st.byId[id]) return st.byId[id];
    for (var i = 0; i < st.same.length; i++) {
      var g = st.same[i].groups.find(function (x) { return x.id === id; });
      if (g) return g;
    }
    return null;
  }
  function onClick(e) {
    var t = e.target;
    if (t.closest('#vlClose')) { close(); return; }
    if (t.closest('#vlUrlAdd')) { putUrl(); return; }
    if (t.closest('#vlPut')) { var g = pickGroup(st.pick); if (g) put(g.url, nameOf(g) === g.url ? '' : nameOf(g)); return; }
    var row = t.closest('[data-vl]');
    if (row) {
      st.pick = st.pick === row.dataset.vl ? '' : row.dataset.vl;
      Array.prototype.forEach.call(document.querySelectorAll('#vlModal [data-vl]'), function (el) {
        var on = el.dataset.vl === st.pick;
        el.classList.toggle('is-on', on); el.setAttribute('aria-pressed', String(on));
      });
      paintPut();
    }
  }
  function putUrl() {
    var inp = $('#vlUrl');
    var u = window.Weekly && Weekly.normalizeYoutube ? Weekly.normalizeYoutube(inp.value) : '';
    if (!u || !ytId(u)) { toast('유튜브 링크(youtube.com · youtu.be)를 넣어 주세요', 'bad'); inp.focus(); return; }
    put(u, titles[ytId(u)] || '');
  }
  function put(url, title) {
    if (st.saving) return Promise.resolve(false);
    var cls = st.cls, week = st.week, run = st.run, c = sb();
    st.saving = true; paintPut();
    return Promise.resolve(c.from('lesson_videos').select('part').eq('class_name', cls).eq('week_start', week)).then(function (r) {
      var parts = rowsOf(r).map(function (v) { return v.part; });
      var part = parts.indexOf('full') === -1 && parts.indexOf('1') === -1 ? 'full' : parts.indexOf('2') === -1 && parts.indexOf('1') !== -1 ? '2' : 'makeup';
      return c.from('lesson_videos').insert({ class_name: cls, week_start: week, part: part, title: String(title || '').trim().slice(0, 100), url: url, student_ids: [], sort: parts.length }).select();
    }).then(function (r) {
      st.saving = false;
      if (!r || r.error) throw new Error((r && r.error && r.error.message) || '저장하지 못했습니다');
      if (run === st.run) close();
      toast(clsLabel(cls) + ' ' + md(lessonDate(cls, week)) + ' 레포트에 넣었어요', 'good');
      window.dispatchEvent(new CustomEvent('jt:video-linked', { detail: { cls: cls, week: week, url: url } }));
      window.dispatchEvent(new CustomEvent('jt:weekly-changed', { detail: { cls: cls, week: week } }));     /* 과정 칸이면 반마다 복사 (course.js) */
      return true;
    }).catch(function (e) {
      st.saving = false; paintPut();
      toast('영상을 넣지 못했습니다 — ' + e.message, 'bad');
      return false;
    });
  }

  /* 「영상 없음」 표시 — 넣으면 그 반 그 주 것을 모두 지운다 · 작성 화면이 그 반이면 다시 읽는다 */
  window.addEventListener('jt:video-linked', function (e) {
    var d = e.detail || {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-vidlink-cls][data-vidlink-gone]'), function (el) {
      if (el.dataset.vidlinkCls === d.cls && el.dataset.vidlinkWeek === d.week) el.remove();
    });
    if (window.Weekly && Weekly.where && Weekly.reload) { var w = Weekly.where(); if (w.cls === d.cls && w.week === d.week) Weekly.reload(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-vidlink-cls]');
    if (!b || b.closest('#vlModal')) return;
    e.preventDefault(); e.stopPropagation();
    open({ cls: b.dataset.vidlinkCls, week: b.dataset.vidlinkWeek });
  }, true);

  window.VidLink = { open: open, close: close, sameLessons: sameLessons, ytId: ytId, put: function (url, title) { return put(url, title); } };
})();
