/* ============================================================
   online-run.js — 온라인 마라톤 구간 (20261117b · 앱 실제 코드 기준으로 다시)

   이미 받아 둔 앱 기록(app_records — 날짜별 제출 calendar · 과제 history · 강별 lectures · 반 정보 classes)만 쓴다. 앱 · 앱 DB 는 건드리지 않는다.

   ① 앱 기준 구간 (학생 · 학부모 · 직원 모두) — 앱과 똑같이
      · 앱 shared/sections.ts calculateSections — 총 일수 = 종료일 - 시작일 + 1(getSectionOnTimeStats 와 같게) · 27일 이상이고 has_sections 반만 3구간
        baseSize = floor(총 일수 / 3) · 1구간 1 ~ base · 2구간 base+1 ~ 2base · 3구간 2base+1 ~ 총 일수(나머지는 3구간) · 회차 = 강 번호(lectures.order)
      · 앱 server/storage.ts getSectionOnTimeStats — 구간 안의 열린 숙제 중 정시(isLate=false) 제출 비율 · 기준(반 refund_threshold → 시스템 → 70) 이상이면 그 구간 환급 가능
        허브는 강마다 앱이 준 「열린 숙제 수(totalHomework) · 정시 제출 수(onTimeHomework)」를 구간마다 더한다
        (앱 강별 정시 수는 「마지막 제출」 기준 · 구간 판정은 「정시 제출이 하나라도」 기준 — 같은 숙제를 늦게 다시 낸 경우만 다를 수 있음)
      · 반 시작 · 종료일 · 구간 반 여부 · 기준 % 를 앱이 아직 보내지 않으면 「앱 기록 확인 전」(지어내지 않음 · .local/replit_구간요청.md)
      · 학생 · 학부모 화면에는 기준 % · 금액 없이 「1구간 완주」처럼만 · 구간이 끝나야 「완주」(끝나기 전에는 「진행 중」)
   ② 허브 기준 (직원 화면만) — 날짜별 인증 + 골든패스(그 달 첫 미제출 1번) + 사정 인정(직원 체크) · 앱에는 없는 규칙
   ③ 영상 · 퀴즈는 판정에서 뺀다 — 「영상 열어 봄」(앱은 페이지만 열어도 완료) · 「퀴즈 답 제출」(앱은 채점 없음 · 앱이 보낼 때만) 참고 표시
   ④ 주말 — 앱처럼 숙제(강 번호)가 걸린 날이면 회차 · 아니면 「숙제 없는 날」
   ============================================================ */
(function (global) {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var KIND = {
    ok:      { t: '정시 인증',  i: '✓',  c: 'ok' },
    excused: { t: '사정 인정',  i: '📋', c: 'ex' },
    golden:  { t: '골든패스',   i: '🎫', c: 'gp' },
    late:    { t: '늦은 인증',  i: '⏰', c: 'late' },
    miss:    { t: '미제출',     i: '·',  c: 'miss' },
    today:   { t: '오늘 진행 중', i: '🏃', c: 'today' },
    future:  { t: '아직 안 옴', i: '',   c: 'fu' },
    nodata:  { t: '기록 없음',  i: '',   c: 'fu' },
    weekend: { t: '숙제 없는 날', i: '',  c: 'we' },
    off:     { t: '',           i: '',   c: 'off' }
  };
  var OKISH = { ok: 1, excused: 1, golden: 1 };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function dowOf(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function isWeekend(d) { var w = dowOf(d); return w === 0 || w === 6; }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function mdw(d) { return md(d) + '(' + DOW[dowOf(d)] + ')'; }
  function ymOf(d) { return String(d || '').slice(0, 7); }
  function lastDay(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function datesOf(ym) { var n = lastDay(ym), out = []; for (var i = 1; i <= n; i++) out.push(ym + '-' + (i < 10 ? '0' : '') + i); return out; }
  function shiftYm(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; var d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); }
  function plus(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function monthName(ym) { return (+ym.slice(5, 7)) + '월'; }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function kst(v) {
    var t = Date.parse(v || '');
    if (!isFinite(t)) return null;
    var s = new Date(t + 9 * 3600000).toISOString();
    return { day: s.slice(0, 10), hm: s.slice(11, 16) };
  }

  /* 날짜별 앱 기록(지금 + 옛 기록) · 강 번호별 과제 · 영상 */
  function index(data) {
    data = data || {};
    var old = data.old && typeof data.old === 'object' ? data.old : {};
    var cal = {}, hist = {}, lec = {};
    [].concat(old.calendar || [], data.calendar || []).forEach(function (c) { if (c && valid(c.date)) cal[c.date] = c; });
    [].concat(old.history || [], data.history || data.recent || []).forEach(function (h) {
      if (!h || h.order == null) return;
      var k = String(+h.order), cur = hist[k];
      if (!cur || String(h.submittedAt || '') < String(cur.submittedAt || '')) hist[k] = h;
    });
    (data.lectures || []).forEach(function (l) { if (l && l.order != null) lec[String(+l.order)] = l; });
    return { cal: cal, hist: hist, lec: lec };
  }

  /* ---------- ① 앱 기준 구간 ---------- */
  /* 앱 calculateSections 그대로 */
  function sectionsOf(totalDays) {
    if (!(totalDays > 26)) return [];
    var b = Math.floor(totalDays / 3);
    return [{ no: 1, s: 1, e: b }, { no: 2, s: b + 1, e: b * 2 }, { no: 3, s: b * 2 + 1, e: totalDays }];
  }
  /* 반(강 번호 묶음)마다 — data.classes(앱 반 정보 · off = 강 번호 띄움) · 없으면 강 번호로 묶음만 */
  function groups(data) {
    data = data || {};
    var lec = (data.lectures || []).filter(function (l) { return l && +l.order > 0 && +l.order < 100000; });
    var metas = Array.isArray(data.classes) ? data.classes.filter(function (c) { return c && typeof c === 'object'; }) : [];
    var offs = {};
    lec.forEach(function (l) { offs[Math.floor(+l.order / 1000) * 1000] = 1; });
    metas.forEach(function (m) { offs[+m.off || 0] = 1; });
    return Object.keys(offs).map(Number).sort(function (a, b) { return a - b; }).map(function (off) {
      var info = metas.filter(function (m) { return (+m.off || 0) === off; })[0] || null;
      var ls = lec.filter(function (l) { return Math.floor(+l.order / 1000) * 1000 === off; }).map(function (l) { return Object.assign({}, l, { raw: +l.order - off }); });
      return { off: off, info: info, lectures: ls };
    });
  }
  /* 한 반의 앱 기준 구간 */
  function appSections(g, today, cal) {
    var info = g.info || {}, out = { off: g.off, title: info.title || '', status: 'unknown', missing: [], secs: [], threshold: null, open: '', close: '' };
    if (!valid(info.openDate)) out.missing.push('반 시작일');
    if (!valid(info.closeDate)) out.missing.push('반 종료일');
    if (typeof info.hasSections !== 'boolean') out.missing.push('구간 반 여부');
    if (!(info.refundThreshold != null && isFinite(+info.refundThreshold))) out.missing.push('환급 기준');
    /* 반 날짜 — 그 반 강 번호가 걸린 날(앱 calendar)로 어림(표시용 · 판정에는 안 씀) */
    var ds = Object.keys(cal || {}).filter(function (d) { var o = +cal[d].order || 0; return o > 0 && o < 100000 && Math.floor(o / 1000) * 1000 === g.off; }).sort();
    out.days = ds;
    out.ym = valid(info.openDate) ? ymOf(info.openDate) : ds.length ? ymOf(ds[Math.floor(ds.length / 2)]) : '';
    if (out.missing.length) return out;
    out.open = info.openDate; out.close = info.closeDate; out.threshold = +info.refundThreshold;
    var total = Math.ceil((Date.parse(info.closeDate + 'T00:00:00Z') - Date.parse(info.openDate + 'T00:00:00Z')) / 864e5) + 1;
    out.totalDays = total;
    if (!info.hasSections || !(total > 26)) { out.status = 'nosec'; return out; }
    out.status = 'ok';
    var given = Array.isArray(info.sectionStats) ? info.sectionStats : null;
    out.fromApp = !!(given && given.length === 3);
    out.secs = sectionsOf(total).map(function (s) {
      var on = 0, n = 0, rate;
      var gv = out.fromApp ? given.filter(function (x) { return +x.section === s.no; })[0] : null;
      if (gv) { on = +gv.on || 0; n = +gv.n || 0; rate = +gv.rate || 0; }           /* 앱이 직접 계산한 값(getSectionOnTimeStats) — 그대로 */
      else {
        g.lectures.forEach(function (l) { if (l.raw >= s.s && l.raw <= s.e) { n += +l.hwTotal || 0; on += +l.hwOnTime || 0; } });
        rate = n > 0 ? Math.round(on / n * 100) : 0;
      }
      var from = plus(info.openDate, s.s - 1), to = plus(info.openDate, s.e - 1);
      var ended = today > to, started = today >= from;
      var pass = rate >= out.threshold;
      return { no: s.no, s: s.s, e: s.e, from: from, to: to, on: on, n: n, rate: rate, pass: pass, ended: ended,
               state: !started ? 'wait' : !ended ? 'run' : pass ? 'done' : 'missed' };
    });
    return out;
  }
  /* 그 달의 반(앱 기준) — 그 달에 열린 반 · 없으면 null */
  function appOf(data, ym, today) {
    var ix = index(data), list = groups(data).map(function (g) { return appSections(g, today, ix.cal); });
    var hit = list.filter(function (a) { return a.ym === ym; });
    return hit[hit.length - 1] || null;
  }
  /* 기본 구간 (20261118c) — 앱 반 정보가 없으면(없음 · 확인 전) 온라인 반은 그 달 1일 ~ 말일(KST)을 반 기간으로
     앱 calculateSections 와 같이 3등분(나머지는 3구간) · 회차 = 숙제가 열린 날짜(그 달 며칠째) · 환급 기준 = 반 설정(허브 · 없으면 70)
     구간마다 열린 숙제(날짜 기록 · 오늘까지) 중 정시 제출 비율 · 앱 반 정보가 오면 자동으로 앱 값(def 없음) */
  var DEF_TH = 70;
  function defaultApp(ym, today, days, th) {      /* days = compute 의 반 달력(20261118d) — 오늘까지 열린 날 · 정시 */
    var by = {}; (days || []).forEach(function (x) { by[x.date] = x; });
    var total = lastDay(ym), first = ym + '-01';
    th = th != null && isFinite(+th) ? +th : DEF_TH;
    var out = { off: 0, title: '', status: 'ok', def: true, missing: [], threshold: th, open: first, close: ym + '-' + String(total).padStart(2, '0'), totalDays: total, fromApp: false };
    out.secs = sectionsOf(total).map(function (s) {
      var on = 0, n = 0;
      for (var i = s.s; i <= s.e; i++) {
        var d = ym + '-' + (i < 10 ? '0' : '') + i, x = by[d];
        if (!x || !x.counted || d > today) continue;
        n++; if (x.kind === 'ok') on++;
      }
      var rate = n > 0 ? Math.round(on / n * 100) : 0, from = plus(first, s.s - 1), to = plus(first, s.e - 1);
      var ended = today > to, started = today >= from, pass = rate >= th;
      return { no: s.no, s: s.s, e: s.e, from: from, to: to, on: on, n: n, rate: rate, pass: pass, ended: ended,
               state: !started ? 'wait' : !ended ? 'run' : pass ? 'done' : 'missed' };
    });
    return out;
  }
  /* 연속 (20261118c · 서버 _online_calc 와 같은 규칙) — 끝에서부터
     · 숙제 있는 날(회차)만 · 오늘이 아직 안 낸 상태(마감 전)면 건너뜀 · 앞으로 올 날 건너뜀
     · 낸 날(정시 · 늦게 · 늦게 낸 날의 골든패스) +1 · 사정 인정은 끊지도 늘리지도 않음 · 안 낸 날(골든패스로 넘긴 미제출 포함)에서 끊김 */
  function streakOf(days, today) {
    var n = 0;
    for (var i = days.length - 1; i >= 0; i--) {
      var y = days[i];
      if (!y.counted || y.date > today || y.kind === 'today' || y.kind === 'future') continue;
      if (y.kind === 'excused') continue;
      var k = y.kind === 'golden' ? y.gpFrom : y.kind;
      if (k === 'ok' || k === 'late') n++; else break;
    }
    return n;
  }

  /* 볼 수 있는 달 — 앱 기록 첫 달 ~ 이번 달 · 최대 12달 */
  function months(data, today) {
    var ix = index(data), first = Object.keys(ix.cal).sort()[0] || '';
    var from = ymOf(first || today), to = ymOf(today), out = [];
    for (var ym = to; ym >= from && out.length < 12; ym = shiftYm(ym, -1)) out.push(ym);
    return out;
  }

  /* ---------- 날짜별 (달력) + ② 허브 기준 ----------
     o.staff — 골든패스 · 사정 인정 · 허브 기준 구간(직원만) · 학생 · 학부모는 날짜별 인증만 */
  function compute(data, ym, o) {
    o = o || {};
    var today = o.today || todayKst();
    ym = ym || ymOf(today);
    var ix = index(data), ex = {}, staff = !!o.staff;
    if (staff) (o.excuse || []).forEach(function (d) { if (valid(d)) ex[d] = 1; });
    var all = datesOf(ym), inCal = all.filter(function (d) { return ix.cal[d]; });
    var empty = !inCal.length;
    /* 반 달력 (20261118d · 서버 _online_calc 와 같은 규칙) — 학생 본인 기록의 날짜 칸이 아니라
       평일 전부 + 주말은 같은 반 누구든 숙제가 있던 날(o.extra · 서버 online_class_extra) · 앱 반 정보가 다 있으면 그 기간 안만
       학생마다 그 달 1일 또는 앱 기록 첫날 중 늦은 날부터 · 기록이 빠진 날은 「안 냄」 */
    var extra = {}; (o.extra || []).forEach(function (d) { if (valid(d)) extra[d] = 1; });
    var join = Object.keys(ix.cal).filter(function (d) { return +ix.cal[d].order > 0; }).sort()[0] || '';
    var app0 = appOf(data, ym, today), rOpen = app0 && valid(app0.open) ? app0.open : '', rClose = app0 && valid(app0.close) ? app0.close : '';
    var days = all.map(function (d) {
      var c = ix.cal[d] || null, order = c ? +c.order || 0 : 0, h = order ? ix.hist[String(order)] : null, l = order ? ix.lec[String(order)] : null;
      var counted = (!isWeekend(d) || extra[d] || (!!c && order > 0)) && (!rOpen || d >= rOpen) && (!rClose || d <= rClose) && (!join || d >= join);
      var x = { date: d, dow: dowOf(d), counted: counted, order: order, day: (h && +h.day > 0 ? +h.day : order % 1000), title: h ? String(h.title || '') : '',
                genre: h && h.parts && h.parts[0] && h.parts[0].c ? String(h.parts[0].c) : '', correct: h && h.total ? +h.correct || 0 : null, total: h && h.total ? +h.total : null,
                at: h && h.submittedAt ? kst(h.submittedAt) : null, quiz: h && typeof h.quiz === 'boolean' ? h.quiz : null,
                vids: l && +l.videosTotal > 0 ? { done: +l.videosDone || 0, total: +l.videosTotal } : null, kind: 'off' };
      if (!counted) { x.kind = c || isWeekend(d) ? 'weekend' : 'off'; return x; }
      var st = c ? c.status : 'none';
      if (st === 'onTime') x.kind = 'ok';
      else if (ex[d]) x.kind = 'excused';
      else if (d > today) x.kind = 'future';
      else if (d === today) x.kind = st === 'late' ? 'late' : 'today';
      else x.kind = st === 'late' ? 'late' : 'miss';
      return x;
    });
    var golden = null;
    if (staff && !empty) days.some(function (x) { if (x.counted && (x.kind === 'miss' || x.kind === 'late')) { x.gpFrom = x.kind; x.kind = 'golden'; golden = x.date; return true; } return false; });
    var cd = days.filter(function (x) { return x.counted; }), n = cd.length;
    /* 허브 기준 구간 — 회차를 3으로(앱처럼 나머지는 3구간) · 직원 화면만 */
    var hub = [];
    if (staff) {
      var b = Math.floor(n / 3), cuts = [[0, b], [b, b * 2], [b * 2, n]];
      cuts.forEach(function (ct, i) {
        var part = cd.slice(ct[0], ct[1]);
        var okN = part.filter(function (x) { return OKISH[x.kind]; }).length;
        var missN = part.filter(function (x) { return x.kind === 'miss' || x.kind === 'late'; }).length;
        var open = part.some(function (x) { return x.kind === 'future' || x.kind === 'today'; });
        hub.push({ no: i + 1, from: part[0] ? part[0].date : '', to: part.length ? part[part.length - 1].date : '', n: part.length, ok: okN,
                   state: !part.length ? 'none' : missN ? 'missed' : !open ? 'done' : okN ? 'run' : 'wait' });
      });
    }
    /* 앱 기준 구간 · 달력의 구간 경계(회차 → 날짜) */
    var app = app0;
    /* 앱 반 정보가 없으면 기본 구간(그 달 1일 ~ 말일 · o.noDefault 면 예전처럼 「앱 기록 확인 전」) · 구간 반이 아니라고 앱이 알려 주면(nosec) 그대로 */
    if (!o.noDefault && (!app || app.status === 'unknown')) {
      app = defaultApp(ym, today, days, o.th);
      days.forEach(function (x) { if (x.counted) { var dn = +x.date.slice(8, 10); app.secs.forEach(function (s) { if (dn >= s.s && dn <= s.e) x.seg = s.no; }); } });
      app.secs.forEach(function (s) { if (s.no > 1) { var f = days.filter(function (x) { return x.seg === s.no; })[0]; if (f) f.segStart = s.no; } });
    } else if (app && app.status === 'ok') app.secs.forEach(function (s) {
      var first = null;
      days.forEach(function (x) { if (x.order && x.order < 100000 && Math.floor(x.order / 1000) * 1000 === app.off) { var r = x.order - app.off; if (r >= s.s && r <= s.e) { x.seg = s.no; if (!first) first = x; } } });
      if (first && s.no > 1) first.segStart = s.no;         /* 그 구간 첫 회차 날에 경계 표시 */
    });
    var streak = streakOf(days, today);
    return { ym: ym, today: today, days: days, app: app, hub: hub, golden: golden, streak: streak, n: n, empty: empty, staff: staff,
             todayDay: days.filter(function (x) { return x.date === today; })[0] || null,
             okN: cd.filter(function (x) { return x.kind === 'ok'; }).length, hubOkN: cd.filter(function (x) { return OKISH[x.kind]; }).length,
             exN: days.filter(function (x) { return x.kind === 'excused'; }).length, current: ym === ymOf(today) };
  }

  /* ---------- 화면 조각 ---------- */
  var NOTE = '<p class="orn-note">영상·퀴즈는 참고로만 보여요 · 구간은 앱의 숙제 정시 제출 기록으로 정해져요</p>';
  /* 학생 · 학부모 — 앱 기준 (기준 % · 금액 없음) */
  function appLine(s) {
    if (s.state === 'done') return s.no + '구간 완주! 🏁';
    if (s.state === 'missed') return s.no < 3 ? '이 구간은 아쉽게 놓쳤어요 · 다음 구간에서 다시 시작할 수 있어요' : '이 구간은 아쉽게 놓쳤어요 · 다음 클래스에서 다시 시작할 수 있어요';
    if (s.state === 'run') return '달리는 중 · ' + md(s.to) + '까지';
    return md(s.from) + '부터 시작해요';
  }
  function appSegsHtml(app, o) {
    o = o || {};
    if (!app || app.status === 'unknown') return '<div class="orn-wait"><b>앱 기준 구간 · 앱 기록 확인 전</b><span>구간은 앱에서 반 정보를 받은 뒤 보여요</span>' +
      (o.staff && app ? '<small>없는 값: ' + esc(app.missing.join(' · ')) + '</small>' : '') + '</div>';
    if (app.status === 'nosec') return '<div class="orn-wait"><b>이 클래스는 구간 없이 진행돼요</b>' + (o.staff ? '<small>총 ' + app.totalDays + '일 · 구간 반 ' + (app.totalDays > 26 ? '아님' : '아님(26일 이하)') + '</small>' : '') + '</div>';
    /* 기본 구간(앱 반 정보 없음 · 그 달 1일 ~ 말일) — 직원 화면에만 작은 「기본」 · 학생 · 학부모는 표시 없이 같은 값 (20261118c) */
    return (o.staff && app.def ? '<p class="orn-def"><span class="orn-def__b">기본</span> 앱 반 정보가 없어 그 달 1일 ~ 말일 · 환급 기준 ' + esc(app.threshold) + '%로 계산했어요 (앱 값이 오면 자동으로 바뀜)</p>' : '') +
      '<ol class="orn-segs">' + app.secs.map(function (s) {
      var pct = s.n ? Math.round(s.on / s.n * 100) : 0;
      return '<li class="orn-seg orn-seg--' + s.state + '"><div class="orn-seg__h"><b>' + s.no + '구간</b><span class="num">' + esc(app.def ? md(s.from) + '~' + md(s.to) : s.s + '~' + s.e + '회차') + '</span>' +
        (o.staff ? '<span class="orn-seg__n num">정시 ' + s.on + '/' + s.n + ' · ' + s.rate + '% (기준 ' + app.threshold + '%)</span>' : '<span class="orn-seg__n num">정시 제출 ' + s.on + '/' + s.n + '</span>') +
        (s.state === 'done' ? '<span class="orn-seg__done">완주</span>' : '') +
        (o.staff && s.state === 'run' ? '<span class="orn-seg__run">' + (s.pass ? '지금 기준 넘음' : '지금 기준 아래') + '</span>' : '') + '</div>' +
        '<div class="orn-bar" role="img" aria-label="' + s.no + '구간 정시 제출 ' + s.on + '/' + s.n + '"><i style="width:' + pct + '%"></i></div>' +
        '<p class="orn-seg__t">' + esc(o.staff ? (s.state === 'done' ? '환급 가능' : s.state === 'missed' ? '환급 기준 아래로 끝남' : s.state === 'run' ? '진행 중 · ' + md(s.to) + '까지' : md(s.from) + '부터') : appLine(s)) + '</p></li>';
    }).join('') + '</ol>';
  }
  function todayHtml(r) {
    var x = r.todayDay;
    if (!r.current) return '';
    if (!x || !x.counted) return '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">🌿</span><span><b>오늘의 지문</b>오늘은 숙제가 없는 날이에요</span></div>';
    var t = x.kind === 'ok' ? '오늘 정시 인증 ✓' + (x.at ? ' · ' + x.at.hm : '') : x.kind === 'late' ? '오늘은 늦게 인증했어요' : x.kind === 'excused' ? '사정 인정 날이에요' : '아직 인증 전 · 오늘 밤 12시까지';
    return '<div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">📖</span><span><b>오늘의 지문' + (x.day ? ' · ' + x.day + '회차' : '') + '</b>' + esc(t) + '</span></div>';
  }
  /* 홈 맨 위 카드 (학생 · 학부모) — 20261117c: 오늘의 지문(제목 · 장르는 앱에 있으면) · 「오늘도 완주!」 · 연속 · 구간 진행 · 구간 완주 배지 · 마라토니 · 마라부기 한마디
     학부모(o.parent) — 맨 위 한 줄 요약(이번 달 인증 n일 · 연속 n일 · 구간) + 같은 구간 + 카카오톡 채널 안내 */
  var KAKAO = '궁금한 점은 카카오톡 채널 <b>jh국어연구소</b>로 문의해 주세요';
  function secLine(app) {
    if (!app || app.status === 'unknown') return '구간 · 앱 기록 확인 전';
    if (app.status === 'nosec') return '구간 없는 클래스';
    var run = app.secs.filter(function (s) { return s.state === 'run'; })[0], done = app.secs.filter(function (s) { return s.state === 'done'; }).map(function (s) { return s.no; });
    return (done.length ? done.join('·') + '구간 완주' : '') + (run ? (done.length ? ' · ' : '') + run.no + '구간 달리는 중' : '') || '구간 시작 전';
  }
  function badgesHtml(app) {
    if (!app || app.status !== 'ok') return '';
    var done = app.secs.filter(function (s) { return s.state === 'done'; });
    return done.length ? '<div class="orn-badges">' + done.map(function (s) { return '<span class="orn-badge">🏅 ' + s.no + '구간 완주</span>'; }).join('') + '</div>' : '';
  }
  function monthBar(r) {
    if (r.app && r.app.status === 'ok') return '';
    var past = r.days.filter(function (x) { return x.counted && x.date <= r.today; }).length, pct = past ? Math.round(r.okN / past * 100) : 0;
    return '<div class="orn-mbar"><span class="num">지금까지 ' + past + '회차 중 정시 인증 ' + r.okN + '회</span><span class="orn-bar"><i style="width:' + pct + '%"></i></span></div>';
  }
  /* 마라토니(장난스럽고 감각적) · 마라부기(차분하고 꾸준) 한마디 — 상황별 · 꼭 · 반드시 · 무조건 · 꾸짖는 말 없음 */
  function talkOf(r) {
    var cd = r.days.filter(function (x) { return x.counted && x.date < r.today; }), last = cd[cd.length - 1];
    var justDone = r.app && r.app.status === 'ok' ? r.app.secs.filter(function (s) { return s.state === 'done' && plus(s.to, 7) >= r.today; }).pop() : null;
    if (justDone) return { who: 'maratoni', t: justDone.no + '구간 결승선 통과! 🏁 박수 짝짝짝, 다음 구간도 같이 뛰어 보자고~' };
    if (last && (last.kind === 'miss' || last.kind === 'late') && r.current) return { who: 'marabugi', t: '어제는 쉬어 갔네요. 괜찮아요, 오늘 한 지문부터 천천히 다시 걸어가요.' };
    if (r.streak >= 3) return (r.streak % 2) ? { who: 'maratoni', t: '벌써 ' + r.streak + '회 연속! 발바닥에 불붙었다 🔥 이 리듬 그대로 가 보자!' } : { who: 'marabugi', t: r.streak + '회째 이어지고 있어요. 꾸준함이 제일 멀리 가요.' };
    return (+r.today.slice(8) % 2) ? { who: 'maratoni', t: '오늘 지문 한 판 어때? 한 지문이면 몸풀기 끝!' } : { who: 'marabugi', t: '오늘도 한 지문, 한 걸음씩이면 충분해요.' };
  }
  function talkHtml(r, base) {
    var x = talkOf(r), nm = x.who === 'maratoni' ? '마라토니' : '마라부기';
    return '<div class="orn-talk orn-talk--' + x.who + '"><img class="orn-talk__img" src="' + esc((base || '../assets/chars/') + x.who + '.png') + '" alt="" width="40" height="40" loading="lazy"><p><b>' + nm + '</b>' + esc(x.t) + '</p></div>';
  }
  function cardHtml(r, o) {
    o = o || {};
    if (o.parent) {
      var sum = '이번 달 인증 ' + r.okN + '일 · 연속 ' + r.streak + '일 · ' + secLine(r.app);
      return '<section class="gm-card orn-card orn-card--parent" id="ornCard" aria-label="이번 달 요약"><div class="orn-card__h"><h2 class="gm-h">🏁 ' + esc(monthName(r.ym)) + ' 한눈에</h2></div>' +
        '<p class="orn-sum num">' + esc(sum) + '</p>' + appSegsHtml(r.app) + monthBar(r) + badgesHtml(r.app) +
        '<p class="orn-kakao">' + KAKAO + '</p>' +
        (o.go ? '<button type="button" class="gm-link orn-card__go" data-orn-go="run">인증 달력 보기 ›</button>' : '') + '</section>';
    }
    var head = '<div class="orn-card__h"><h2 class="gm-h">🏁 ' + esc(monthName(r.ym)) + ' 완주 현황</h2><span class="orn-card__s num">' + r.n + '회차 중 ' + r.okN + '회 정시 인증</span></div>';
    return '<section class="gm-card orn-card" id="ornCard" aria-label="이번 달 완주 현황">' + head +
      todayCardHtml(r) + appSegsHtml(r.app) + monthBar(r) + badgesHtml(r.app) +
      '<div class="orn-stats"><div class="orn-stat"><span class="orn-stat__i" aria-hidden="true">🔥</span><span><b>연속 인증</b><em class="num">' + r.streak + '일</em></span></div></div>' +
      talkHtml(r, o.base) + NOTE +
      (o.go ? '<button type="button" class="gm-link orn-card__go" data-orn-go="run">완주 달력 보기 ›</button>' : '') +
    '</section>';
  }
  /* 오늘의 지문 카드 — 제목 · 장르는 앱 과제 기록에 있으면 · 인증하면 「오늘도 완주!」 */
  function todayCardHtml(r) {
    var x = r.todayDay;
    if (!r.current) return '';
    if (!x || !x.counted) return '<div class="orn-today orn-today--off"><span class="orn-stat__i" aria-hidden="true">🌿</span><div><b>오늘의 지문</b><p>오늘은 숙제가 없는 날이에요 · 주말 자율 과제(어휘테스트 · 모의고사)</p></div></div>';
    var done = x.kind === 'ok' || x.kind === 'late';
    return '<div class="orn-today' + (done ? ' is-done' : '') + '"><span class="orn-stat__i" aria-hidden="true">' + (done ? '🎉' : '📖') + '</span><div><b>오늘의 지문' + (x.day ? ' · DAY ' + x.day : '') + '</b>' +
      (x.title ? '<p class="orn-today__t">' + esc(x.title) + (x.genre ? ' <span class="orn-genre">' + esc(x.genre) + '</span>' : '') + '</p>' : '') +
      '<p>' + (x.kind === 'ok' ? '오늘도 완주! ✓' + (x.at ? ' · ' + esc(x.at.hm) + ' 인증' : '') : x.kind === 'late' ? '오늘도 완주! (조금 늦게 인증)' : '아직 인증 전 · 오늘 밤 12시까지') + '</p></div></div>';
  }

  /* 이번 달 지문 목록 — 날짜 · DAY · 제목 · 인증 · 정답 수(있는 것만) */
  function listHtml(r) {
    var rows = r.days.filter(function (x) { return x.counted && x.date <= r.today; }).reverse();
    if (!rows.length) return '';
    return '<section class="card orn-list"><h2 class="card-title">📚 ' + esc(monthName(r.ym)) + ' 지문 목록</h2><ul class="orn-list__ul">' + rows.map(function (x) {
      var K = KIND[x.kind] || KIND.off;
      return '<li class="orn-list__r"><span class="orn-list__d num">' + esc(mdw(x.date)) + '</span><span class="orn-list__day num">' + (x.day ? 'DAY ' + x.day : '') + '</span>' +
        '<span class="orn-list__t">' + esc(x.title || '—') + '</span><span class="orn-list__k orn-k--' + K.c + '">' + esc(K.t) + '</span>' +
        (x.total ? '<span class="orn-list__s num">' + x.correct + '/' + x.total + '</span>' : '') + '</li>';
    }).join('') + '</ul></section>';
  }

  /* 나의 성장 — 지난 달 vs 이번 달 영역별 정답률 · 풀이 시간(앱에 있을 때만) · 본인 기록끼리만 */
  function growthHtml(data, today) {
    data = data || {};
    var ym = ymOf(today), pm = shiftYm(ym, -1), by = {}, sec = {};
    [].concat((data.old && data.old.history) || [], data.history || []).forEach(function (h) {
      var k = h && h.submittedAt ? kst(h.submittedAt) : null;
      if (!k) return;
      var m = ymOf(k.day);
      if (m !== ym && m !== pm) return;
      (h.parts || []).forEach(function (p) { if (!p || !(+p.n > 0)) return; var b = (by[p.c] = by[p.c] || {}); var x = (b[m] = b[m] || { k: 0, n: 0 }); x.k += +p.k || 0; x.n += +p.n; });
      if (+h.sec > 0) { var s = (sec[m] = sec[m] || { t: 0, n: 0 }); s.t += +h.sec; s.n++; }
    });
    var names = Object.keys(by).filter(function (n) { return by[n][ym] || by[n][pm]; });
    var rate = function (x) { return x && x.n ? Math.round(x.k / x.n * 100) : null; };
    var mins = function (s) { return s && s.n ? Math.round(s.t / s.n / 60 * 10) / 10 : null; };
    if (!names.length && !sec[ym] && !sec[pm]) return '';
    return '<section class="card orn-rec orn-grow"><h2 class="card-title">🌱 나의 성장 <span class="card-note">' + esc(monthName(pm) + ' → ' + monthName(ym)) + ' · 내 기록끼리만</span></h2>' +
      (names.length ? '<ul class="orn-grow__ul">' + names.map(function (n) {
        var a = rate(by[n][pm]), b = rate(by[n][ym]), d = a != null && b != null ? b - a : null;
        return '<li><span class="orn-grow__n">' + esc(n) + '</span><span class="num">' + (a == null ? '—' : a + '%') + ' → <b>' + (b == null ? '—' : b + '%') + '</b></span>' +
          (d != null ? '<span class="orn-d num ' + (d > 0 ? 'is-up' : d < 0 ? 'is-down' : '') + '">' + (d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '=') + '</span>' : '<span></span>') + '</li>';
      }).join('') + '</ul>' : '') +
      (sec[ym] || sec[pm] ? '<p class="orn-hint num">평균 풀이 시간 ' + (mins(sec[pm]) == null ? '—' : mins(sec[pm]) + '분') + ' → <b>' + (mins(sec[ym]) == null ? '—' : mins(sec[ym]) + '분') + '</b></p>' : '') +
    '</section>';
  }
  /* 학부모 — 앱 선생님 피드백 최근 1 ~ 2개(사람이 쓴 것만 · AI 피드백 없음) */
  function fbHtml(data) {
    var fb = (data && Array.isArray(data.fb) ? data.fb : []).filter(function (x) { return x && x.t; }).slice(0, 2);
    if (!fb.length) return '';
    return '<section class="card orn-rec orn-fb"><h2 class="card-title">💬 선생님 피드백 <span class="card-note">최근 ' + fb.length + '개</span></h2>' +
      fb.map(function (x) { return '<blockquote class="orn-fb__q"><p>' + esc(x.t) + '</p><footer class="num">' + esc([x.at ? md(x.at) : '', x.title || ''].filter(Boolean).join(' · ')) + '</footer></blockquote>'; }).join('') + '</section>';
  }

  /* 완주 달력 (학생 · 학부모 — 골든패스 · 사정 인정 없음) */
  function legend(staff) { return (staff ? ['ok', 'golden', 'excused', 'late', 'miss', 'today', 'weekend', 'future'] : ['ok', 'late', 'miss', 'today', 'weekend', 'future']); }
  function calHtml(r, o) {
    o = o || {};
    var mlist = o.months || [r.ym], i = mlist.indexOf(r.ym);
    var prev = i >= 0 && i < mlist.length - 1 ? mlist[i + 1] : '', next = i > 0 ? mlist[i - 1] : '';
    var first = r.days[0] ? r.days[0].dow : 0, cells = [];
    for (var k = 0; k < first; k++) cells.push('<span class="orn-cal__c orn-cal__c--pad" aria-hidden="true"></span>');
    r.days.forEach(function (x) {
      var K = KIND[x.kind] || KIND.off, on = o.open === x.date;
      cells.push('<button type="button" class="orn-cal__c orn-k--' + K.c + (x.segStart ? ' is-segstart' : '') + (x.date === r.today ? ' is-today' : '') + (on ? ' is-open' : '') + '" data-orn-day="' + x.date + '"' +
        ' aria-label="' + esc(mdw(x.date) + (K.t ? ' ' + K.t : '') + (x.seg ? ' · ' + x.seg + '구간' : '')) + '"' + (on ? ' aria-pressed="true"' : '') + '>' +
        (x.segStart ? '<span class="orn-cal__sg">' + x.segStart + '구간</span>' : '') +
        '<b class="num">' + (+x.date.slice(8)) + '</b><span class="orn-cal__i" aria-hidden="true">' + (K.i || '') + '</span></button>');
    });
    var open = o.open ? r.days.filter(function (x) { return x.date === o.open; })[0] : null;
    return '<section class="card orn-calbox" id="ornCal">' +
      '<div class="orn-mnav"><button type="button" class="orn-mnav__b" data-orn-m="' + esc(prev) + '"' + (prev ? '' : ' disabled') + ' aria-label="지난 달">◀</button>' +
        '<h2 class="orn-mnav__t">' + esc(r.ym.slice(0, 4) + '년 ' + monthName(r.ym)) + ' 완주 달력</h2>' +
        '<button type="button" class="orn-mnav__b" data-orn-m="' + esc(next) + '"' + (next ? '' : ' disabled') + ' aria-label="다음 달">▶</button></div>' +
      appSegsHtml(r.app) +
      '<div class="orn-cal" role="group" aria-label="날짜별 인증">' + DOW.map(function (d, j) { return '<span class="orn-cal__w' + (j === 0 || j === 6 ? ' is-we' : '') + '">' + d + '</span>'; }).join('') + cells.join('') + '</div>' +
      (open ? dayHtml(open) : '<p class="orn-hint">날짜를 누르면 그날 지문을 볼 수 있어요</p>') +
      '<ul class="orn-legend">' + legend(false).map(function (k) { var K = KIND[k]; return '<li><i class="orn-k--' + K.c + '">' + (K.i || '') + '</i>' + esc(K.t) + '</li>'; }).join('') + '</ul>' + NOTE +
    '</section>' + listHtml(r);
  }
  function dayHtml(x) {
    var K = KIND[x.kind] || KIND.off, rows = [];
    if (!x.counted) rows.push(x.kind === 'weekend' ? '숙제가 없는 날이에요' + (isWeekend(x.date) ? ' · 주말 자율 과제(어휘테스트 · 모의고사)' : '') : '지문이 없는 날이에요');
    else {
      if (x.title) rows.push('<b>' + esc(x.title) + '</b>');
      rows.push((x.day ? x.day + '회차 · ' : '') + (x.seg ? x.seg + '구간 · ' : '') + esc(K.t));
      if (x.at) rows.push('인증 시각 ' + esc(md(x.at.day) + ' ' + x.at.hm));
      if (x.kind === 'golden') rows.push('골든패스로 인정(허브 기준)');
      if (x.kind === 'excused') rows.push('사정 인정(허브 기준)');
      if (x.kind === 'miss') rows.push('이 날은 인증이 없었어요');
      if (x.vids) rows.push('영상 열어 봄 ' + x.vids.done + '/' + x.vids.total + ' <small>(참고)</small>');
      if (x.quiz != null) rows.push('퀴즈 답 ' + (x.quiz ? '제출' : '아직') + ' <small>(참고)</small>');
    }
    return '<div class="orn-day" id="ornDay"><p class="orn-day__d num">' + esc(mdw(x.date)) + '</p>' + rows.map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>';
  }

  /* 기록 탭 (학생 · 학부모) */
  function recordHtml(data, r, o) {
    o = o || {};
    data = data || {};
    var hist = [].concat((data.old && data.old.history) || [], data.history || data.recent || []);
    var parts = {}, tot = { k: 0, n: 0 }, rates = [];
    hist.forEach(function (h) {
      if (!h) return;
      if (h.correctRate != null && isFinite(+h.correctRate)) rates.push(+h.correctRate);
      (h.parts || []).forEach(function (p) {
        if (!p || !(+p.n > 0)) return;
        var b = parts[String(p.c || '기타')] || (parts[String(p.c || '기타')] = { k: 0, n: 0 });
        b.k += +p.k || 0; b.n += +p.n; tot.k += +p.k || 0; tot.n += +p.n;
      });
    });
    var list = Object.keys(parts).map(function (k) { var b = parts[k]; return { name: k, rate: Math.round(b.k / b.n * 100), k: b.k, n: b.n }; }).sort(function (a, b) { return b.n - a.n; });
    var sc = (o.scores || []).filter(function (x) { return x && (x.k === 'wrong' || x.k === 'text') && isFinite(+x.s); });
    function avg(k) { var v = sc.filter(function (x) { return x.k === k; }).map(function (x) { return +x.s; }); return v.length ? { a: Math.round(v.reduce(function (p, q) { return p + q; }, 0) / v.length), n: v.length } : null; }
    var w = avg('wrong'), t = avg('text');
    var app = r.app, doneN = app && app.status === 'ok' ? app.secs.filter(function (s) { return s.state === 'done'; }).length : null;
    var html = '<section class="card orn-rec"><h2 class="card-title">📒 ' + esc(monthName(r.ym)) + ' 기록</h2>' +
      '<div class="orn-kpis"><div><b class="num">' + r.okN + '회</b><span>정시 인증 (' + r.n + '회차 중)</span></div>' +
      '<div><b class="num">' + (doneN == null ? '확인 전' : doneN + '/3') + '</b><span>완주 구간</span></div>' +
      '<div><b class="num">' + r.streak + '일</b><span>연속 인증</span></div></div></section>';
    html += '<section class="card orn-rec"><h2 class="card-title">🎯 파트별 정답률 <span class="card-note">지금까지 누적</span></h2>' +
      (list.length ? '<ul class="orn-parts">' + list.map(function (p) {
        return '<li><span class="orn-parts__n">' + esc(p.name) + '</span><span class="orn-bar"><i style="width:' + p.rate + '%"></i></span><b class="num">' + p.rate + '%</b><small class="num">' + p.k + '/' + p.n + '문항</small></li>';
      }).join('') + '</ul><p class="orn-hint">전체 ' + (tot.n ? Math.round(tot.k / tot.n * 100) : 0) + '% · ' + tot.n + '문항</p>'
        : rates.length ? '<p class="orn-hint">과제 정답률 평균 ' + Math.round(rates.reduce(function (p, q) { return p + q; }, 0) / rates.length) + '% · ' + rates.length + '개 과제</p>'
        : '<p class="orn-hint">과제를 내면 파트별 정답률이 쌓여요</p>') + '</section>';
    html += growthHtml(data, r.today);
    if (o.parent) html += fbHtml(data);
    if (w || t) html += '<section class="card orn-rec"><h2 class="card-title">✍️ 오답정리 · 필기 점수</h2><div class="orn-kpis">' +
      (w ? '<div><b class="num">' + w.a + '</b><span>오답정리 평균 · ' + w.n + '회</span></div>' : '') +
      (t ? '<div><b class="num">' + t.a + '</b><span>지문 장악(필기) 평균 · ' + t.n + '회</span></div>' : '') + '</div></section>';
    html += '<p class="orn-kakao">' + KAKAO + '</p>';
    return html;
  }

  /* ---------- 코치룸 (직원만) — 앱 기준(정시 제출률 · 기준 %) + 허브 기준(골든패스 · 사정 인정) ---------- */
  function hubSegsHtml(r) {
    return '<ol class="orn-segs orn-segs--hub">' + r.hub.map(function (g) {
      var pct = g.n ? Math.round(g.ok / g.n * 100) : 0;
      var t = g.state === 'done' ? '모든 회차 인정' : g.state === 'missed' ? '빠진 회차 있음' : g.state === 'run' ? '진행 중' : g.state === 'wait' ? '시작 전' : '';
      return '<li class="orn-seg orn-seg--' + g.state + '"><div class="orn-seg__h"><b>' + g.no + '구간</b><span class="num">' + (g.from ? esc(md(g.from) + '~' + md(g.to)) : '') + '</span><span class="orn-seg__n num">' + g.ok + '/' + g.n + '회</span></div>' +
        '<div class="orn-bar"><i style="width:' + pct + '%"></i></div><p class="orn-seg__t">' + esc(t) + '</p></li>';
    }).join('') + '</ol>';
  }
  function staffHtml(r, o) {
    o = o || {};
    var mlist = o.months || [r.ym], i = mlist.indexOf(r.ym);
    var prev = i >= 0 && i < mlist.length - 1 ? mlist[i + 1] : '', next = i > 0 ? mlist[i - 1] : '';
    var ex = {}; (o.excuse || []).forEach(function (d) { ex[d] = 1; });
    var rows = r.days.filter(function (x) { return x.counted; }).map(function (x) {
      var K = KIND[x.kind] || KIND.off, can = x.kind !== 'ok';
      return '<li class="orn-sd orn-k--' + K.c + '"><span class="num">' + esc(mdw(x.date)) + '</span><span class="orn-sd__k">' + esc(K.t) + (x.day ? ' · ' + x.day + '회차' : '') + '</span>' +
        '<label class="chk-inline orn-sd__ex"><input type="checkbox" data-orn-ex="' + x.date + '"' + (ex[x.date] ? ' checked' : '') + (can || ex[x.date] ? '' : ' disabled') + (o.busy ? ' disabled' : '') + '> 사정 인정</label></li>';
    }).join('');
    return '<div class="orn-staff"><div class="orn-mnav orn-mnav--sm"><button type="button" class="btn btn--sm" data-orn-sm="' + esc(prev) + '"' + (prev ? '' : ' disabled') + '>◀</button>' +
        '<b>' + esc(monthName(r.ym)) + '</b><button type="button" class="btn btn--sm" data-orn-sm="' + esc(next) + '"' + (next ? '' : ' disabled') + '>▶</button></div>' +
      '<h4 class="orn-sub">앱 기준 <small>앱과 같은 계산 · 학생 · 학부모 화면에 보이는 것(기준 % 는 직원만)</small></h4>' + appSegsHtml(r.app, { staff: true }) +
      '<h4 class="orn-sub">허브 기준 <small>골든패스 · 사정 인정 반영 · 직원만</small></h4>' + hubSegsHtml(r) +
      '<p class="orn-hint">골든패스 ' + (r.golden ? esc(mdw(r.golden)) : '안 씀') + ' · 사정 인정 ' + r.exN + '회 · 연속 ' + r.streak + '회</p>' +
      (rows ? '<details class="orn-sdbox"' + (o.openList ? ' open' : '') + '><summary>날짜별 인증 · 사정 인정 체크</summary><ul class="orn-sdl">' + rows + '</ul>' +
        '<p class="orn-hint">시험 등으로 미리 알린 날만 체크해 주세요 · 허브 기준에만 반영돼요(앱 기준 · 학생 화면은 그대로)</p></details>' : '') +
      (o.msg ? '<p class="orn-hint" role="status">' + esc(o.msg) + '</p>' : '') +
    '</div>';
  }

  /* 반 표 한 줄 · CSV (직원) */
  function classRow(stu, ym, today, th, extra) {
    var r = compute(stu.data || {}, ym, { today: today, excuse: stu.excuse || [], staff: true, th: th, extra: extra || [] });
    return { id: stu.id, name: stu.name, linked: stu.linked !== false, r: r };
  }
  function appCell(a, no) {
    if (!a || a.status === 'unknown') return '앱 기록 확인 전';
    if (a.status === 'nosec') return '구간 없음';
    var s = a.secs[no - 1];
    return s.rate + '% ' + (s.state === 'done' ? '환급 가능' : s.state === 'missed' ? '기준 아래' : s.state === 'run' ? '진행 중' : '시작 전') + (a.def ? ' (기본)' : '');
  }
  function hubCell(g) { return !g || g.state === 'none' ? '' : g.state === 'done' ? '완주' : g.state === 'missed' ? '미완주' : g.state === 'run' ? '진행 중' : '시작 전'; }
  function csv(cls, ym, rows) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ['반', '달', '이름', '앱 기준 1구간', '앱 기준 2구간', '앱 기준 3구간', '환급 기준 %', '허브 기준 1구간', '허브 기준 2구간', '허브 기준 3구간', '정시 인증 회', '회차', '골든패스', '사정 인정 회'];
    var out = [head].concat(rows.map(function (x) {
      var r = x.r, a = r.app;
      return [cls, ym, x.name, appCell(a, 1), appCell(a, 2), appCell(a, 3), a && a.threshold != null ? a.threshold : '',
              hubCell(r.hub[0]), hubCell(r.hub[1]), hubCell(r.hub[2]), r.okN, r.n, r.golden || '', r.exN];
    }));
    return out.map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }

  global.OnlineRun = { compute: compute, months: months, groups: groups, appSections: appSections, sectionsOf: sectionsOf, appOf: appOf, defaultApp: defaultApp, streakOf: streakOf, DEF_TH: DEF_TH,
    cardHtml: cardHtml, calHtml: calHtml, dayHtml: dayHtml, recordHtml: recordHtml, listHtml: listHtml, growthHtml: growthHtml, fbHtml: fbHtml, talkOf: talkOf, KAKAO: KAKAO, staffHtml: staffHtml, appSegsHtml: appSegsHtml,
    classRow: classRow, csv: csv, appCell: appCell, hubCell: hubCell, KIND: KIND, monthName: monthName, shiftYm: shiftYm, ymOf: ymOf };
})(window);
