/* ============================================================
   stucard.js — 학생 카드 위쪽 세 칸 (20261109c · 빠른 상담 창 quicknote.js 안에 그린다)

   학생 이름을 누르면 「학생 카드」 — 위에서 아래로
     1) 기본 정보 — 반 · 수업 요일/시각 · n주째 · 모고 연결 상태 / 학생 · 학부모 번호(누르면 전화 · 문자, 없으면 흐리게 「번호 없음」) · [확인 필요 📌]
        「더 보기」 — 학교 · 학년 · 등록일 · [러닝노트 미리보기] · [정보 수정](그 자리에서 · 학생 등록과 같은 저장 Store.upsertStudent)
     2) 과제 — 「지난주(11/2~11/6) 과제 3/5 · 안 낸 날 …」 · 「이번 주 진행 중 n/n」
        「더 보기」 — 최근 8주 제출률 막대(주를 누르면 날짜별 ✓/✕ · 그 주 과제 상담 💬) · [과제 상세 전체](러닝노트 과제 상세 미리보기)
     3) 모의고사 추이 — 요약 한 줄 「최근 3회 평균 · 첫 시험 대비 · 최고(날짜)」 · 기록 1개면 그 점수만 크게 · 없으면 모의고사 칸이 「모의고사 기록 없음」
        「더 보기」 — 꺾은선 그래프(가로 날짜 · 세로 점수) [점수][등급](1등급이 위) · 점을 누르면 날짜 · 이름 · 점수 · 등급 · [레포트 보기]
        영역별 점수는 연동 약속(버전 2)에 없어 [전체][독서][문학][선택] 전환은 보이지 않는다 (없는 값은 만들지 않는다)
   번호 · 과제 · 모의고사 점수는 코치룸(직원)만 본다 — 러닝노트 · 문자에는 나가지 않는다
   ============================================================ */

(function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function today() { return window.DDay ? DDay.today() : Store.toISO(new Date()); }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function mdw(iso) { return md(iso) + '(' + DOWK[Lesson.dowOf(iso)] + ')'; }
  function stu(sid) { return (Store.getStudents() || []).find(function (s) { return s.id === sid; }) || null; }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function phoneFmt(v) { var d = digits(v); return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : String(v || ''); }

  /* 열린 학생마다 펼침 · 고르기 상태 (창을 다시 그려도 그대로) */
  var ui = { sid: '', infoMore: false, edit: false, hwMore: false, wk: -1, mgMore: false, mgMode: 'score', mgPt: -1 };
  function reset(sid) { ui = { sid: sid, infoMore: false, edit: false, hwMore: false, wk: -1, mgMore: false, mgMode: 'score', mgPt: -1 }; }

  /* ---------- 1) 기본 정보 ---------- */
  function phoneHtml(label, num) {
    var d = digits(num);
    if (d.length < 9) return '<span class="sc-ph is-none">' + esc(label) + ' 번호 없음</span>';
    return '<span class="sc-ph"><a class="sc-ph__call" href="tel:' + d + '" aria-label="' + esc(label + ' 전화 ' + phoneFmt(num)) + '">📞 ' + esc(label) + '</a>' +
      '<a class="sc-ph__sms" href="sms:' + d + '" aria-label="' + esc(label + ' 문자') + '">문자</a></span>';
  }
  function whenOf(cls) {
    var sc = Store.schedOf ? Store.schedOf(cls) : null, m = (Store.metaOf && Store.metaOf(cls)) || {};
    var ds = sc ? [sc.dow].concat(sc.extra || []).filter(function (x) { return x !== null && x !== undefined && x !== '' && !isNaN(+x); }).map(function (x) { return DOWK[+x % 7]; }) : [];
    return [ds.join('·'), m.start ? m.start + (m.end ? '~' + m.end : '') : ''].filter(Boolean).join(' ');
  }
  function infoHtml(sid) {
    var s = stu(sid) || {}, cls = s.className || '', start = Store.joinedOf ? Store.joinedOf(s) : (s.startOn || '');
    var wk = start && start <= today() ? Math.floor((Date.parse(today()) - Date.parse(start)) / (7 * 864e5)) + 1 : 0;
    var ln = window.Mogo && Mogo.linkState ? Mogo.linkState(sid) : null;
    var line1 = [cls, whenOf(cls), wk ? wk + '주째' : ''].filter(Boolean).map(esc).join(' · ') +
      (ln ? ' <span class="sc-mg is-' + esc(ln.k) + '">모고 ' + esc(ln.t) + '</span>' : '');
    var p2 = digits(s.parentPhone2) && digits(s.parentPhone2) !== digits(s.parentPhone);
    var line2 = phoneHtml('학생', s.studentPhone) + phoneHtml('학부모', s.parentPhone) + (p2 ? phoneHtml('학부모2', s.parentPhone2) : '') +
      '<button type="button" class="sc-pin" data-sc-pin aria-label="확인 필요로 표시 — 상담 칸의 체크">📌 확인 필요</button>';
    var more = '';
    if (ui.edit) {
      var f = function (k, label, v, type) { return '<label class="sc-f"><span>' + label + '</span><input class="input" data-sc-f="' + k + '"' + (type ? ' type="' + type + '" inputmode="numeric"' : '') + ' value="' + esc(v || '') + '"></label>'; };
      more = '<div class="sc-edit">' + f('school', '학교', s.school) + f('grade', '학년', s.grade) + f('studentPhone', '학생 번호', s.studentPhone, 'tel') +
        f('parentPhone', '학부모 번호', s.parentPhone, 'tel') + f('parentPhone2', '학부모 번호 2', s.parentPhone2, 'tel') +
        '<div class="sc-acts"><button type="button" class="btn btn--sm btn--primary" data-sc-save>정보 저장</button><button type="button" class="btn btn--sm" data-sc-edit>취소</button></div></div>';
    } else if (ui.infoMore) {
      more = '<dl class="sc-dl"><dt>학교</dt><dd>' + esc(s.school || '—') + '</dd><dt>학년</dt><dd>' + esc(s.grade || '—') + '</dd>' +
        '<dt>등록일</dt><dd class="num">' + esc(start ? mdw(start) + (wk ? ' · ' + wk + '주째' : '') : '—') + '</dd>' +
        '<dt>학생 번호</dt><dd class="num">' + esc(digits(s.studentPhone) ? phoneFmt(s.studentPhone) : '번호 없음') + '</dd>' +
        '<dt>학부모 번호</dt><dd class="num">' + esc([s.parentPhone, p2 ? s.parentPhone2 : ''].filter(function (x) { return digits(x); }).map(phoneFmt).join(' · ') || '번호 없음') + '</dd></dl>' +
        '<div class="sc-acts"><button type="button" class="btn btn--sm" data-sc-pv>러닝노트 미리보기</button><button type="button" class="btn btn--sm" data-sc-edit>정보 수정</button></div>';
    }
    return '<section class="sc-sec sc-info" id="scInfo" aria-label="기본 정보">' +
      '<p class="sc-l1">' + line1 + '</p><div class="sc-l2">' + line2 + '</div>' + more +
      (ui.edit ? '' : '<button type="button" class="sc-more" data-sc-tg="infoMore" aria-expanded="' + ui.infoMore + '">' + (ui.infoMore ? '접기 ▴' : '더 보기 ▾') + '</button>') +
      '</section>';
  }
  function saveInfo(sid, root) {
    var s = stu(sid);
    if (!s) return;
    var v = {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-sc-f]'), function (i) { v[i.getAttribute('data-sc-f')] = i.value.trim(); });
    var bad = ['studentPhone', 'parentPhone', 'parentPhone2'].filter(function (k) { var d = digits(v[k]); return d && !/^01\d{8,9}$/.test(d); });
    if (bad.length) { UI.toast('휴대폰 번호는 010으로 시작하는 10~11자리로 적어 주세요', 'bad'); return; }
    var rec = Object.assign({}, s, v);
    Store.upsertStudent(rec);                                   /* 학생 등록 · 상담 카드 기본 정보와 같은 저장 */
    Promise.resolve(Store.flushNow(Store.KEYS.students)).then(function () {
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
      ui.edit = false; ui.infoMore = true;
      UI.toast((s.name || '') + ' 정보를 저장했습니다', 'good');
      if (window.QuickNote) QuickNote.repaint();
    }, function (e) { UI.toast('저장하지 못했습니다 — ' + ((e && e.message) || ''), 'bad'); });
  }

  /* ---------- 2) 과제 ---------- */
  function info(sid) { return window.Today && Today.consultInfo ? Today.consultInfo(sid) : null; }
  function hwHtml(sid, hwOf) {
    var h = info(sid), head;
    if (h && h.known) {
      head = '<p class="sc-hwl"><b class="cs-hw num">' + esc(h.period.word + '(' + h.period.label + ') 과제 ' + h.done + '/' + h.total) + '</b>' +
        (h.miss.length ? ' <span class="cs-miss num">' + esc('안 낸 날 ' + h.miss.map(function (d) { return md(d) + ' ' + DOWK[Lesson.dowOf(d)]; }).join(' · ')) + '</span>' : ' <span class="cs-miss is-ok">안 낸 과제 없음</span>') + '</p>' +
        (h.live ? '<p class="cs-live num">이번 주 진행 중 ' + h.live.done + '/' + h.live.total + '</p>' : '');
    } else if (h) head = '<p class="sc-hwl"><span class="cs-hw is-mute">' + esc(h.period.word + '(' + h.period.label + ') 과제 기록 없음') + '</span></p>';
    else head = '<p class="sc-hwl"><span class="cs-hw is-mute">과제 기록 없음</span></p>';
    var more = '';
    if (ui.hwMore) {
      var ws = window.Today && Today.recentWeeks ? Today.recentWeeks(sid, 8) : [];
      more = ws.length ? '<div class="sc-bars" role="group" aria-label="최근 ' + ws.length + '주 제출률">' + ws.map(function (w, i) {
        var pct = w.total ? Math.round(w.done * 100 / w.total) : 0, cm = hwOf && hwOf(w.from);
        return '<button type="button" class="sc-bar' + (ui.wk === i ? ' is-on' : '') + '" data-sc-wk="' + i + '" aria-pressed="' + (ui.wk === i) + '" aria-label="' + esc(md(w.from) + '~' + md(w.to) + ' ' + (w.total ? w.done + '/' + w.total : '기록 없음') + (cm ? ' · 과제 상담 있음' : '')) + '">' +
          '<span class="sc-bar__v"><i style="height:' + (w.total ? Math.max(4, pct) : 0) + '%" class="' + (pct >= 80 ? 'is-hi' : pct >= 50 ? 'is-mid' : 'is-lo') + '"></i></span>' +
          '<span class="sc-bar__n num">' + (w.total ? w.done + '/' + w.total : '–') + '</span><span class="sc-bar__d num">' + md(w.lesson) + (cm ? '💬' : '') + '</span></button>';
      }).join('') + '</div>' : '<p class="cs-first">수업일이 정해지면 주마다 보여요</p>';
      if (ui.wk >= 0 && ws[ui.wk]) {
        var w = ws[ui.wk], days = window.Today && Today.hwWeek ? Today.hwWeek(sid, w.from, w.to) : null, cm2 = hwOf && hwOf(w.from);
        var MARK = { onTime: '✓', late: '△', none: '✕', exempt: '면제', off: '·', today: '오늘', future: '·' };
        more += '<div class="sc-wk"><p class="sc-wk__t num">' + esc(md(w.from) + '~' + md(w.to) + ' · ' + md(w.lesson) + ' 수업 전 주') + '</p>' +
          /* 낸 날을 누르면 그날 제출물 (sub-view.js · 20261110j) */
          (days ? '<ol class="sc-days">' + days.map(function (d) {
            var inner = '<span class="num">' + esc(md(d.date)) + ' ' + DOWK[Lesson.dowOf(d.date)] + '</span><b>' + esc(MARK[d.hw] || '·') + '</b>';
            return '<li class="is-' + esc(d.hw) + '">' + ((d.hw === 'onTime' || d.hw === 'late') && window.SubView
              ? '<button type="button" class="sc-day-b" data-sc-sub="' + esc(d.date) + '" aria-label="' + esc(md(d.date) + ' 제출물 보기') + '">' + inner + '</button>' : inner) + '</li>';
          }).join('') + '</ol>' : '<p class="cs-first">과제 기록을 불러오지 못했어요</p>') +
          (cm2 ? '<div class="sc-wk__cm"><span class="sc-wk__cmt">💬 그 주 과제 상담</span>' + cm2 + '</div>' : '') + '</div>';
      }
      more += '<button type="button" class="btn btn--sm" data-sc-hwall>과제 상세 전체</button>';
    }
    return '<section class="sc-sec sc-hw" id="scHw" aria-label="과제"><h3 class="sc-t">과제</h3>' + head + more +
      '<button type="button" class="sc-more" data-sc-tg="hwMore" aria-expanded="' + ui.hwMore + '">' + (ui.hwMore ? '접기 ▴' : '최근 8주 더 보기 ▾') + '</button></section>';
  }

  /* ---------- 3) 모의고사 추이 ---------- */
  function gradeNum(g) { var m = /(\d)/.exec(String(g || '')); return m ? +m[1] : null; }
  function scored(sid) {
    var r = window.Mogo && Mogo.state ? Mogo.state().rec[sid] : null;
    return ((r && r.reports) || []).filter(function (x) { return x && typeof x.score === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(x.date || ''); })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function summary(pts) {
    var last3 = pts.slice(-3), avg = Math.round(last3.reduce(function (a, x) { return a + x.score; }, 0) / last3.length * 10) / 10;
    var best = pts.reduce(function (a, x) { return !a || x.score > a.score ? x : a; }, null), diff = pts[pts.length - 1].score - pts[0].score;
    return '최근 ' + last3.length + '회 평균 ' + avg + '점 · 첫 시험 대비 ' + (diff >= 0 ? '+' : '') + diff + '점 · 최고 ' + best.score + '점(' + md(best.date) + ')';
  }
  function chartHtml(pts) {
    var byGrade = ui.mgMode === 'grade', W = 320, H = 150, L = 30, R = 10, T = 12, B = 24;
    var vals = pts.map(function (x) { return byGrade ? gradeNum(x.grade) : x.score; });
    var use = vals.filter(function (v) { return v != null; });
    if (!use.length) return '<p class="cs-first">' + (byGrade ? '등급 기록이 없어요' : '점수 기록이 없어요') + '</p>';
    var lo, hi;
    if (byGrade) { lo = 1; hi = 9; } else { lo = Math.max(0, Math.min.apply(null, use) - 5); hi = Math.min(100, Math.max.apply(null, use) + 5); if (hi - lo < 10) { hi = Math.min(100, lo + 10); lo = Math.max(0, hi - 10); } }
    var t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date), span = Math.max(1, t1 - t0);
    var X = function (d) { return pts.length === 1 ? (L + W - R) / 2 : L + (W - L - R) * (Date.parse(d) - t0) / span; };
    /* 점수는 높을수록 위 · 등급은 1등급이 위 */
    var Y = function (v) { return byGrade ? T + (H - T - B) * (v - lo) / (hi - lo) : T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var seg = [], path = '';
    pts.forEach(function (x, i) { var v = vals[i]; if (v == null) return; path += (path ? 'L' : 'M') + X(x.date).toFixed(1) + ' ' + Y(v).toFixed(1); });
    var ticks = byGrade ? [1, 3, 5, 7, 9] : [lo, Math.round((lo + hi) / 2), hi];
    var grid = ticks.map(function (v) { var y = Y(v).toFixed(1); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="sc-grid"/><text x="' + (L - 4) + '" y="' + (+y + 4) + '" class="sc-ax" text-anchor="end">' + v + (byGrade ? '' : '') + '</text>'; }).join('');
    var xl = [pts[0], pts[pts.length - 1]].filter(function (x, i, a) { return i === 0 || x !== a[0]; }).map(function (x, i) {
      return '<text x="' + X(x.date).toFixed(1) + '" y="' + (H - 6) + '" class="sc-ax" text-anchor="' + (i ? 'end' : 'start') + '">' + md(x.date) + '</text>'; }).join('');
    var dots = pts.map(function (x, i) {
      var v = vals[i]; if (v == null) return '';
      return '<circle cx="' + X(x.date).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (ui.mgPt === i ? 7 : 5) + '" class="sc-dot' + (ui.mgPt === i ? ' is-on' : '') + '" data-sc-pt="' + i + '" tabindex="0" role="button" aria-label="' + esc(mdw(x.date) + ' ' + (x.examName || '') + ' ' + x.score + '점' + (x.grade ? ' ' + x.grade : '')) + '"/>';
    }).join('');
    seg.push('<svg class="sc-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (byGrade ? '모의고사 등급 추이 (1등급이 위)' : '모의고사 점수 추이') + '">' + grid + '<path d="' + path + '" class="sc-line"/>' + dots + xl + '</svg>');
    return seg.join('');
  }
  function mogoHtml(sid) {
    if (!window.Mogo) return '';
    var pts = scored(sid), top = '', more = '';
    if (pts.length === 1) {
      var x = pts[0];
      top = '<p class="sc-big"><b class="num">' + x.score + '점</b>' + (x.grade ? ' <span>' + esc(x.grade) + '</span>' : '') + ' <small class="num">' + esc(mdw(x.date) + ' · ' + (x.examName || '')) + '</small></p>';
    } else if (pts.length > 1) {
      top = '<p class="sc-sum num">' + esc(summary(pts)) + '</p>';
      if (ui.mgMore) {
        var p = ui.mgPt >= 0 ? pts[ui.mgPt] : null;
        more = '<div class="sc-mode" role="group" aria-label="그래프 기준">' +
          '<button type="button" class="sc-mode__b' + (ui.mgMode === 'score' ? ' is-on' : '') + '" data-sc-mode="score" aria-pressed="' + (ui.mgMode === 'score') + '">점수</button>' +
          '<button type="button" class="sc-mode__b' + (ui.mgMode === 'grade' ? ' is-on' : '') + '" data-sc-mode="grade" aria-pressed="' + (ui.mgMode === 'grade') + '">등급</button></div>' +
          chartHtml(pts) +
          (p ? '<div class="sc-pt"><span class="num">' + esc(mdw(p.date)) + '</span> · ' + esc(p.examName || '모의고사') + ' · <b class="num">' + p.score + '점</b>' + (p.grade ? ' · ' + esc(p.grade) : '') +
            ' <button type="button" class="btn btn--sm" data-mg-open="' + esc(p.id) + '" data-mg-title="' + esc(p.examName || '모의고사') + '">레포트 보기</button></div>' : '<p class="sc-hint">점을 누르면 그 시험을 볼 수 있어요</p>');
      }
    }
    return '<section class="sc-sec sc-mogo" id="scMogo" aria-label="모의고사 추이">' + top + more +
      (pts.length > 1 ? '<button type="button" class="sc-more" data-sc-tg="mgMore" aria-expanded="' + ui.mgMore + '">' + (ui.mgMore ? '그래프 접기 ▴' : '그래프 더 보기 ▾') + '</button>' : '') +
      '<div class="cs-mogo" data-mg-host="' + esc(sid) + '" data-mg-limit="3">' + Mogo.sectionHtml(sid, { limit: 3 }) + '</div></section>';
  }

  /* ---------- 2-1) 능력치 (ability.js · 러닝노트 홈과 같은 계산 · 20261110h) ----------
     과제 기록 저장본(app_records.data — 직원만 읽음)을 그 학생 것만 한 번 읽어 기억 · 기간 [이번 달][최근 4주][1년] · 성장 그래프 */
  var AB = { sid: '', data: null, busy: false, st: { kind: 'w4', graph: false } };
  function abLoad(sid) {
    var c = window.SB && SB.client;
    if (!c || AB.busy) return;
    AB.busy = true;
    /* 학습 분석(20261110l) — 배지 · 오답정리 · 지문 장악 점수(숫자만 · staff_scores · 101 전이면 없음)도 같이 */
    var side = Promise.all([
      Promise.resolve(c.rpc('staff_badges', { p_student: sid })).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; }),
      Promise.resolve(c.rpc('staff_scores', { p_student: sid })).then(function (r) { return r && !r.error && Array.isArray(r.data) ? r.data : []; }, function () { return []; })
    ]);
    Promise.all([Promise.resolve(c.from('app_records').select('data').eq('student_id', sid)), side]).then(function (x) {
      var r = x[0];
      AB.busy = false;
      if (AB.sid !== sid) return;
      AB.badges = x[1][0]; AB.scores = x[1][1];
      AB.data = (!r.error && r.data && r.data[0] && r.data[0].data) || {};
      if (window.QuickNote && QuickNote.state().open) QuickNote.repaint();
    }, function () { AB.busy = false; if (AB.sid === sid) { AB.data = {}; if (window.QuickNote && QuickNote.state().open) QuickNote.repaint(); } });
  }
  function abilityHtml(sid) {
    if (!window.Ability || !sid) return '';
    if (AB.sid !== sid) { AB = { sid: sid, data: null, busy: false, st: { kind: 'w4', graph: false } }; }
    if (AB.data === null) { abLoad(sid); return '<section class="sc-sec sc-ab" id="scAbility" aria-label="능력치"><p class="ab-note">능력치 불러오는 중…</p></section>'; }
    return '<section class="sc-sec sc-ab" id="scAbility" aria-label="능력치">' +
      Ability.html(AB.data, AB.st, { today: today(), small: true, card: false, id: 'scAb' }) +
      (window.Analysis ? Analysis.summary(anCtx(sid)) : '') + '</section>';
  }
  /* 학습 분석 — 러닝노트와 같은 계산 · 기간은 능력치와 같이 (AB.st) */
  function anCtx(sid) {
    var s0 = stu(sid) || {};
    return { data: AB.data || {}, today: today(), state: AB.st, badges: AB.badges || null, scores: AB.scores || [], small: true, id: 'scAn', staff: true,
      parent: true, name: s0.name || '',
      onKind: function () { if (window.QuickNote) QuickNote.repaint(); },
      openSubs: window.SubView ? function (from, to) { SubView.openStaff({ student: sid, from: from, to: to, who: s0.name || '', title: (s0.name || '') + ' ' + md(from) + (from === to ? '' : '~' + md(to)) }); } : null };
  }

  /* ---------- 클릭 (창 안) — 처리했으면 true ---------- */
  function onClick(t, sid, root) {
    var sv = t.closest('[data-sc-sub]');
    if (sv && window.SubView) { var dd = sv.getAttribute('data-sc-sub'), s0 = stu(sid) || {}; SubView.openStaff({ student: sid, from: dd, to: dd, who: s0.name || '', title: (s0.name || '') + ' ' + md(dd) }); return true; }
    if (window.Analysis && t.closest('#scAbility [data-an-root]') && Analysis.click(t, anCtx(sid))) return true;
    var ab = t.closest('#scAbility [data-ab-k], #scAbility [data-ab-graph], #scAbility [data-ab-go]');
    if (ab) {
      if (ab.hasAttribute('data-ab-k')) { AB.st.kind = ab.getAttribute('data-ab-k'); AB.st.picked = true; }
      else if (ab.hasAttribute('data-ab-graph')) AB.st.graph = !AB.st.graph;
      else { if (window.Preview) Preview.open(sid, 'parent', 'app'); return true; }
      if (window.QuickNote) QuickNote.repaint();
      return true;
    }
    var b = t.closest('[data-sc-tg], [data-sc-wk], [data-sc-mode], [data-sc-pt], [data-sc-edit], [data-sc-save], [data-sc-pv], [data-sc-hwall], [data-sc-pin]');
    if (!b) return false;
    if (b.hasAttribute('data-sc-tg')) { var k = b.getAttribute('data-sc-tg'); ui[k] = !ui[k]; if (k === 'hwMore' && !ui[k]) ui.wk = -1; }
    else if (b.hasAttribute('data-sc-wk')) { var i = +b.getAttribute('data-sc-wk'); ui.wk = ui.wk === i ? -1 : i; }
    else if (b.hasAttribute('data-sc-mode')) ui.mgMode = b.getAttribute('data-sc-mode') === 'grade' ? 'grade' : 'score';
    else if (b.hasAttribute('data-sc-pt')) { var j = +b.getAttribute('data-sc-pt'); ui.mgPt = ui.mgPt === j ? -1 : j; }
    else if (b.hasAttribute('data-sc-edit')) { ui.edit = !ui.edit; }
    else if (b.hasAttribute('data-sc-save')) { saveInfo(sid, root); return true; }
    else if (b.hasAttribute('data-sc-pv')) { if (window.Preview) Preview.open(sid, 'parent'); return true; }
    else if (b.hasAttribute('data-sc-hwall')) { if (window.Preview) Preview.open(sid, 'parent', 'app'); return true; }
    else if (b.hasAttribute('data-sc-pin')) { if (window.QuickNote) QuickNote.pin(); return true; }
    if (window.QuickNote) QuickNote.repaint();
    return true;
  }

  window.StuCard = { reset: reset, infoHtml: infoHtml, hwHtml: hwHtml, abilityHtml: abilityHtml, mogoHtml: mogoHtml, onClick: onClick, state: function () { return ui; },
    mogoChanged: function () { if (window.QuickNote && QuickNote.state().open) QuickNote.repaint(true); } };
  window.StudentCard = window.StuCard;
})();
