/* ============================================================
   숙제 한 건 카드 · 하루 활동 타임라인 (20261121a) — 러닝노트 현강 · 온라인 · 학생 · 학부모 · 코치룸 미리보기가 같이 쓴다
   재료 = 저장해 둔 앱 기록(app_records.data · hub_app_record — 그 학생 링크로만) 의 history · lectures · calendar
     history 한 줄(app-sync pick): title · order · day · submittedAt · late · correct/total · sec · parts
       + 20261121a: wa(오답정리 점수) · tc(지문 장악 점수) · sp(스스로 칭찬해 주고 싶은 점) · im(발전하고 싶은 점) · qa(영상 강의 퀴즈 답변)
                    fb · fbAt(사람이 쓴 선생님 피드백 · 작성 시각 — AI 피드백은 받지 않음) · re(반려됐다 다시 냄) · rs(앱이 다시 낸 횟수)
     lectures 한 줄: order · title · videosDone/videosTotal + va(영상 처음 연 시각) · na(필기노트 처음 연 시각) — 앱이 보내 줄 때만
     data.sk — 앱이 점수 칸(wrongAnswerScore · textComprehensionScore)을 보내는지(보내는데 비어 있으면 「채점 전」 · 안 보내면 줄 숨김)
   빠진 값은 그 줄만 숨긴다 · 순위 · 비교 · AI 분석 · 금액 · 전화번호 없음
   ============================================================ */
(function (global) {
  'use strict';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }
  function AW() { return global.AppWeek || {}; }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function mdw(d) { return md(d) + '(' + DOW[new Date(d + 'T00:00:00Z').getUTCDay()] + ')'; }
  /* 한국 시각 { day, hm, t(정렬용 ms) } — 시각이 없는 날짜만이면 hm '' */
  function kst(v) {
    var x = String(v || '');
    if (!x) return null;
    if (/T\d{2}:\d{2}/.test(x)) {
      var tz = /(Z|[+-]\d\d:?\d\d)$/i.test(x), t = Date.parse(tz ? x : x + '+09:00');
      if (!isNaN(t)) { var k = new Date(t + 9 * 3600000).toISOString(); return { day: k.slice(0, 10), hm: k.slice(11, 16), t: t }; }
    }
    return valid(x.slice(0, 10)) ? { day: x.slice(0, 10), hm: '', t: Date.parse(x.slice(0, 10) + 'T23:59:00+09:00') } : null;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function txt(v) { return typeof v === 'string' && v.trim() ? v.trim() : ''; }
  function clean(t) { return global.OnlineRun && OnlineRun.cleanTitle ? OnlineRun.cleanTitle(t) : AW().cleanTitle ? AW().cleanTitle(t) : String(t || ''); }

  /* 지문 제목 「독서 · 과학기술 · "해시 함수는…"」 — 장르 · 영역을 모르면 다듬은 제목만 */
  function titleOf(h) {
    if (global.OnlineRun && OnlineRun.cleanTitle) return OnlineRun.cleanTitle(h && h.title) || '숙제';     /* 지문 목록과 같은 다듬기(「장르 · 영역 · 제목」) */
    var p = AW().partOf ? AW().partOf(h && h.title) : null, t = clean(h && h.title);
    if (!p) return t || '숙제';
    return [p.genre === 'read' ? '독서' : p.genre === 'lit' ? '문학' : '', p.part, clean(p.rest)].filter(Boolean).join(' · ');
  }
  function all(data) { return [].concat((data && data.old && data.old.history) || [], (data && (data.history || data.recent)) || []).filter(function (h) { return h && typeof h === 'object'; }); }
  /* 그 숙제의 날짜(지문 날짜) — 강 번호의 반 달력 날짜 → 이름 안 날짜 → 낸 날 */
  function dayOf(h, data) {
    var A = AW();
    if (A.hwDateOf) return A.hwDateOf(h, A.orderDays ? A.orderDays(data) : {}).date || '';
    var k = kst(h && h.submittedAt); return k ? k.day : '';
  }
  function itemsOn(data, date) {
    return all(data).filter(function (h) { return dayOf(h, data) === date; })
      .sort(function (a, b) { return (+a.io || 0) - (+b.io || 0) || String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')); });
  }
  function lectureOn(data, date) {
    var c = ((data && data.calendar) || []).filter(function (x) { return x && x.date === date && x.order; })[0];
    if (!c) { var it = itemsOn(data, date).filter(function (h) { return h.order; })[0]; c = it ? { order: it.order } : null; }
    if (!c) return null;
    return ((data && data.lectures) || []).filter(function (l) { return l && l.order === c.order; })[0] || null;
  }
  function graded(data) { return !!(data && data.sk); }
  function waOf(h) { var v = num(h && h.wa); return v == null ? null : Math.round(v); }
  function tcOf(h) { var v = num(h && h.tc); return v == null ? null : Math.round(v); }

  /* 점수 줄 — 정답 n/n · 풀이 n분 · 오답정리 n점 · 지문 장악 n점(아직이면 「채점 전」) */
  function scoreBits(h, data) {
    var out = [];
    if (num(h.total) > 0 && num(h.correct) != null) out.push('정답 ' + h.correct + '/' + h.total);
    else if (h.correctRate != null && isFinite(+h.correctRate)) out.push('정답률 ' + Math.round(+h.correctRate) + '%');
    if (num(h.sec) > 0) out.push('풀이 ' + (h.sec >= 60 ? Math.round(h.sec / 6) / 10 + '분' : h.sec + '초'));
    /* 「채점 전」 = 앱이 점수 칸을 보내는데(sk) 아직 채점 전(g 아님 · 반려 아님) — 채점이 끝났는데 점수가 비면 그 줄은 숨김 */
    var wait = !!h.submittedAt && graded(data) && !h.g && !h.rj, w = waOf(h), t = tcOf(h);
    if (w != null) out.push('오답정리 ' + w + '점'); else if (wait) out.push('오답정리 채점 전');
    if (t != null) out.push('지문 장악 ' + t + '점'); else if (wait) out.push('지문 장악 채점 전');
    return out;
  }
  /* 긴 글 — 3줄까지 · [더 보기] */
  function longText(t, cls) {
    var long = t.length > 70 || (t.match(/\n/g) || []).length >= 2;
    return '<p class="hwc-txt ' + cls + (long ? ' is-clamp' : '') + '">' + esc(t) + '</p>' + (long ? '<button type="button" class="hwc-more" data-hwc-more aria-expanded="false">더 보기</button>' : '');
  }
  function bubble(label, t, cls) {
    return '<div class="hwc-bub ' + cls + '"><span class="hwc-bub__n">' + esc(label) + '</span>' + longText(t, '') + '</div>';
  }
  /* 「숙제 한 건」 카드 — o.date(지문 날짜) · o.day(DAY) · o.open(details 펼침) · o.fold(접어 두기) */
  function itemHtml(h, data, o) {
    o = o || {};
    var date = o.date || dayOf(h, data), day = o.day || (+h.day > 0 ? +h.day : 0), sub = kst(h.submittedAt);
    var head = '<div class="hwc-h"><span class="hwc-d num">' + (valid(date) ? esc(mdw(date)) : '') + (day ? ' · DAY ' + day : '') + '</span>' +
      (h.re ? '<span class="hwc-tag hwc-tag--re">다시 제출</span>' : h.rj ? '<span class="hwc-tag hwc-tag--rj">반려 · 다시 내기</span>' : '') +
      (!h.submittedAt ? '<span class="hwc-tag hwc-tag--miss">미제출</span>' : h.late ? '<span class="hwc-tag hwc-tag--late">늦게 제출</span>' : '<span class="hwc-tag">정시 제출</span>') + '</div>' +
      '<p class="hwc-t">' + esc(titleOf(h)) + '</p>';
    var bits = h.submittedAt ? scoreBits(h, data) : [];
    var body = (bits.length ? '<p class="hwc-s num">' + bits.map(function (b) { return '<span' + (/채점 전/.test(b) ? ' class="is-wait"' : '') + '>' + esc(b) + '</span>'; }).join('') + '</p>' : '') +
      (sub && sub.day !== date && sub.hm ? '<p class="hwc-at num">' + esc(md(sub.day) + ' ' + sub.hm) + ' 제출</p>' : '') +
      (txt(h.sp) ? bubble('스스로 칭찬해 주고 싶은 점', txt(h.sp), 'hwc-bub--me') : '') +
      (txt(h.im) ? bubble('발전하고 싶은 점', txt(h.im), 'hwc-bub--me') : '') +
      (txt(h.qa) ? bubble('영상 강의 퀴즈 답변', txt(h.qa), 'hwc-bub--q') : '') +
      (txt(h.fb) ? bubble('선생님 피드백', txt(h.fb), 'hwc-bub--t') : '');
    if (o.fold) return '<details class="hwc hwc--fold"' + (o.open ? ' open' : '') + '><summary>' + head + (bits.length ? '<p class="hwc-s hwc-s--sum num">' + esc(bits.join(' · ')) + '</p>' : '') + '</summary>' + body + '</details>';
    return '<article class="hwc">' + head + body + '</article>';
  }

  /* 하루 활동 타임라인 — 시간 순서 · 빠진 값은 그 줄만 숨김 */
  function timeline(data, date, items) {
    var ev = [], L = lectureOn(data, date);
    if (L) {
      var va = kst(L.va), na = kst(L.na);
      if (va && va.hm) ev.push({ t: va.t, hm: va.hm, d: va.day, k: 'v', s: '영상 코칭 시청' });
      else if (num(L.videosTotal) > 0 && num(L.videosDone) >= L.videosTotal) ev.push({ t: Infinity, hm: '', k: 'v', s: '영상 코칭 다 봄' });
      if (na && na.hm) ev.push({ t: na.t, hm: na.hm, d: na.day, k: 'n', s: '필기노트 열어 봄' });
    }
    (items || itemsOn(data, date)).forEach(function (h) {
      var s = kst(h.submittedAt);
      if (!s) return;
      var bits = scoreBits(h, data);
      ev.push({ t: s.t, hm: s.hm, d: s.day, k: 'h', s: (h.re ? '반려 후 다시 제출' : '숙제 제출') + ' (' + (h.late ? '늦게' : '정시') + ')',
                sub: [bits.join(' · '), txt(h.sp) ? '스스로 칭찬 ' + txt(h.sp) : '', txt(h.im) ? '발전 ' + txt(h.im) : '', txt(h.qa) ? '퀴즈 답 ' + txt(h.qa) : ''].filter(Boolean) });
      var f = kst(h.fbAt);
      if (txt(h.fb)) ev.push({ t: f ? f.t : s.t + 1, hm: f ? f.hm : '', d: f ? f.day : '', k: 'f', s: '선생님 피드백' });
    });
    if (!ev.length) return '';
    ev.sort(function (a, b) { return a.t - b.t; });
    return '<ol class="hwt">' + ev.map(function (e) {
      return '<li class="hwt-r hwt-r--' + e.k + '"><span class="hwt-hm num">' + esc(e.hm ? (e.d && e.d !== date ? md(e.d) + ' ' : '') + e.hm : '') + '</span><div class="hwt-b"><b>' + esc(e.s) + '</b>' +
        (e.sub ? e.sub.map(function (x) { return '<span class="hwt-sub">' + esc(x.length > 60 ? x.slice(0, 58) + '…' : x) + '</span>'; }).join('') : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  /* 날짜 하나 — 타임라인 + 그날 「숙제 한 건」 카드 · o.day(DAY) · o.items(그날 숙제 — 온라인 반 달력이 고른 것 · 없으면 지문 날짜로 찾음) */
  function dayHtml(data, date, o) {
    o = o || {};
    var its = (o.items || itemsOn(data, date)).filter(function (h) { return h && (h.submittedAt || h.title); }), tl = timeline(data, date, its);
    if (!tl && !its.length) return '<div class="hwd"><p class="hwd-none">이 날은 앱 활동 기록이 없어요</p></div>';
    return '<div class="hwd"><p class="hwd-t num">' + esc(mdw(date)) + ' 하루 활동</p>' + tl +
      (its.length ? '<div class="hwd-cards">' + its.map(function (h) { return itemHtml(h, data, { date: date, day: o.day }); }).join('') + '</div>' : '') + '</div>';
  }

  /* 평균 — from ~ to(지문 날짜) 오답정리 · 지문 장악 { wa:{a,n}, tc:{a,n} } */
  function avg(data, from, to) {
    var w = [], t = [];
    all(data).forEach(function (h) {
      if (!h.submittedAt) return;
      var d = dayOf(h, data);
      if ((from && d < from) || (to && d > to)) return;
      if (waOf(h) != null) w.push(waOf(h));
      if (tcOf(h) != null) t.push(tcOf(h));
    });
    var a = function (v) { return v.length ? { a: Math.round(v.reduce(function (p, q) { return p + q; }, 0) / v.length), n: v.length } : null; };
    return { wa: a(w), tc: a(t) };
  }
  function avgText(av) {
    return [av.wa ? '오답정리 평균 ' + av.wa.a + '점' : '', av.tc ? '지문 장악 평균 ' + av.tc.a + '점' : ''].filter(Boolean).join(' · ');
  }

  /* 이번 달 활동 한눈에 (온라인 기록 탭) — 숙제 제출 · 정시 · 영상 · 필기노트 · 선생님 피드백 · 스스로 쓴 칭찬/발전 · 점수 평균 · 날짜별 추이 · 숙제 카드(최신순) */
  function monthHtml(data, ym, today) {
    var from = ym + '-01', to = ym + '-31', its = all(data).filter(function (h) { var d = dayOf(h, data); return h.submittedAt && d >= from && d <= to; });
    var on = its.filter(function (h) { return !h.late; }).length, fb = its.filter(function (h) { return txt(h.fb); }).length;
    var self = its.reduce(function (s, h) { return s + (txt(h.sp) ? 1 : 0) + (txt(h.im) ? 1 : 0); }, 0);
    var cal = {}; ((data && data.calendar) || []).forEach(function (c) { if (c && c.order && String(c.date || '').slice(0, 7) === ym && (!today || c.date <= today)) cal[c.order] = c.date; });
    var vids = 0, notes = 0, anyNote = false;
    ((data && data.lectures) || []).forEach(function (l) {
      if (!l || !cal[l.order]) return;
      vids += num(l.videosDone) || 0;
      if (l.na !== undefined) anyNote = true;
      if (kst(l.na)) notes++;
    });
    var av = avg(data, from, to);
    var k = function (v, label) { return '<div><b class="num">' + v + '</b><span>' + esc(label) + '</span></div>'; };
    var mon = (+ym.slice(5, 7)) + '월';
    var html = '<section class="card hwm"><h2 class="card-title">🗂️ ' + esc(mon) + ' 활동 한눈에</h2><div class="hwm-k">' +
      k(its.length + '회', '숙제 제출') + k(on + '회', '정시 제출') + k(vids + '편', '영상 시청') + (anyNote ? k(notes + '회', '필기노트 열어 봄') : '') +
      k(fb + '개', '선생님 피드백') + k(self + '개', '스스로 쓴 칭찬 · 발전') + '</div>';
    if (av.wa || av.tc) {
      var days = {};
      its.forEach(function (h) { var d = dayOf(h, data), x = days[d] || (days[d] = { w: [], t: [] }); if (waOf(h) != null) x.w.push(waOf(h)); if (tcOf(h) != null) x.t.push(tcOf(h)); });
      var mean = function (v) { return v.length ? Math.round(v.reduce(function (p, q) { return p + q; }, 0) / v.length) : null; };
      var keys = Object.keys(days).sort().filter(function (d) { return days[d].w.length || days[d].t.length; });
      html += '<p class="hwm-avg num">' + esc(avgText(av)) + '</p>' +
        (keys.length ? '<div class="hwm-bars" role="img" aria-label="' + esc(mon + ' 날짜별 오답정리 · 지문 장악 점수') + '">' + keys.map(function (d) {
          var w = mean(days[d].w), t = mean(days[d].t);
          return '<span class="hwm-bar" title="' + esc(md(d) + (w != null ? ' 오답정리 ' + w : '') + (t != null ? ' 지문 장악 ' + t : '')) + '">' +
            '<i class="hwm-bar__w" style="height:' + (w == null ? 0 : Math.max(4, w)) + '%"></i><i class="hwm-bar__t" style="height:' + (t == null ? 0 : Math.max(4, t)) + '%"></i><small class="num">' + (+d.slice(8)) + '</small></span>';
        }).join('') + '</div><p class="hwm-lg"><i class="hwm-bar__w"></i>오답정리 <i class="hwm-bar__t"></i>지문 장악</p>' : '');
    }
    html += '</section>';
    var list = its.slice().sort(function (a, b) { return dayOf(b, data).localeCompare(dayOf(a, data)) || String(b.submittedAt).localeCompare(String(a.submittedAt)); });
    if (list.length) html += '<section class="card hwm-list"><h2 class="card-title">📝 ' + esc(mon) + ' 숙제 <span class="card-note">최신순 · ' + list.length + '개</span></h2>' +
      list.map(function (h, i) { return itemHtml(h, data, { fold: true, open: i === 0 }); }).join('') + '</section>';
    return html;
  }

  /* 오늘의 지문 카드 아래 — 오늘 낸 숙제가 있으면 점수 줄 + 스스로 칭찬 · 발전 한 줄씩 */
  function todayHtml(items, data) {
    var its = (items || []).filter(function (h) { return h && h.submittedAt; });
    if (!its.length) return '';
    return '<div class="hwc-today">' + its.map(function (h) {
      var bits = scoreBits(h, data);
      return (bits.length ? '<p class="hwc-s num">' + bits.map(function (b) { return '<span' + (/채점 전/.test(b) ? ' class="is-wait"' : '') + '>' + esc(b) + '</span>'; }).join('') + '</p>' : '') +
        (txt(h.sp) ? '<p class="hwc-one"><b>스스로 칭찬</b> ' + esc(txt(h.sp)) + '</p>' : '') +
        (txt(h.im) ? '<p class="hwc-one"><b>발전</b> ' + esc(txt(h.im)) + '</p>' : '');
    }).join('') + '</div>';
  }

  /* 오답정리 · 지문 장악 작은 칩(지문 목록 · 과제 탭 줄 끝) */
  function chipHtml(h) {
    var w = waOf(h), t = tcOf(h);
    if (w == null && t == null) return '';
    return '<span class="hwc-chip num">' + (w != null ? '<i title="오답정리">오 ' + w + '</i>' : '') + (t != null ? '<i title="지문 장악">장 ' + t + '</i>' : '') + '</span>';
  }

  /* [더 보기] — 어디서든 */
  if (global.document && !global.__hwcBound) {
    global.__hwcBound = true;
    global.document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-hwc-more]');
      if (!b) return;
      e.stopPropagation();
      var p = b.previousElementSibling;
      if (!p) return;
      var on = p.classList.toggle('is-open');
      b.textContent = on ? '접기' : '더 보기';
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    }, true);
  }

  global.HwCard = { itemHtml: itemHtml, dayHtml: dayHtml, timeline: timeline, monthHtml: monthHtml, todayHtml: todayHtml, chipHtml: chipHtml,
                    avg: avg, avgText: avgText, itemsOn: itemsOn, dayOf: dayOf, titleOf: titleOf, scoreBits: scoreBits, kst: kst };
})(typeof window !== 'undefined' ? window : globalThis);
