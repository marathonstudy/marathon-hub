/* ============================================================
   kings.js — 「이번 주 오답정리왕 · 지문 장악왕 후보」 (코치룸 「오늘」 반 카드 · 20261110i · migration-099 · 함수 king-pick)

   반 카드 안 접는 칸 「👑 이번 주 오답정리왕 · 지문 장악왕」 — 그 반 가장 최근 수업일(수업 전 예고와 같은 기간) 한 주
     종류마다 1~3위: 이름 · 점수(0~100) · 근거 한 줄 · 사진 미리보기(앱 사진 주소 그대로 · 복사하지 않음) · [확정]
     확정되면 「확정: 이름 (누가 · 자동이면 자동)」 · [다른 학생으로](그 반 학생 고르기) · [확정 풀기]
     사진이 없던 종류는 「사진이 없어 자동 후보가 없어요 — 학생을 골라 주세요」(사람이 고름)
     [후보 다시 계산] — king-pick 에 그 반 · 수업일만 (AI 비용 · 확정은 그대로)
   설정(원장만) — 「n시간 안에 안 누르면 1위 자동 확정」 0 = 끔(기본) · 자동 계산 켜기 / 끄기
   점수 · 근거 · 사진은 코치룸에서만 — 학생 화면에는 확정된 배지(📝 · 🔍)만 · 문자 · 알림톡 없음
   099 전이면 칸이 없다
   ============================================================ */
(function () {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function md(iso) { return iso ? (+String(iso).slice(5, 7)) + '/' + (+String(iso).slice(8, 10)) : ''; }
  var KIND = { wrong: ['📝', '오답정리왕'], text: ['🔍', '지문 장악왕'] };
  var st = { sql: null, rows: [], cfg: { on: true, auto_hours: 0 }, owner: false, open: {}, other: {}, busy: {} };

  function load() {
    if (!sb()) return Promise.resolve();
    return Promise.resolve(sb().rpc('king_list', { p_days: 21 })).then(function (r) {
      if (r.error || !r.data) { st.sql = false; paint(); return; }
      st.sql = true; st.rows = r.data.rows || []; st.cfg = r.data.cfg || st.cfg; st.owner = !!r.data.owner;
      paint();
    }, function () { st.sql = false; paint(); });
  }
  /* 그 반 가장 최근 수업일의 두 줄 */
  function weekOf(cls) {
    var rows = st.rows.filter(function (r) { return r.class === cls; });
    if (!rows.length) return null;
    var L = rows[0].lesson;
    return { lesson: L, from: rows[0].from, to: rows[0].to, rows: rows.filter(function (r) { return r.lesson === L; }) };
  }
  function students(cls) { return (window.UI && UI.activeStudents ? UI.activeStudents() : []).filter(function (s) { return (s.className || '') === cls; }); }
  function kindHtml(r, cls) {
    var K = KIND[r.kind] || ['', r.kind], h = '<div class="kg-k" data-kg-row="' + r.id + '"><p class="kg-k__t"><span aria-hidden="true">' + K[0] + '</span> <b>' + K[1] + '</b>';
    if (r.status === 'picked') h += ' <span class="kg-done">확정: <b>' + esc(r.picked_name || '') + '</b> <small>(' + esc(r.auto ? r.picked_by || '자동' : r.picked_by || '') + ')</small></span>';
    h += '</p>';
    if (r.cands && r.cands.length) h += '<ol class="kg-list">' + r.cands.map(function (c, i) {
      var on = r.status === 'picked' && r.picked === c.sid;
      return '<li class="kg-c' + (on ? ' is-on' : '') + '">' +
        (c.img ? '<a class="kg-img" href="' + esc(c.img) + '" target="_blank" rel="noopener" aria-label="' + esc((c.name || '') + ' 사진 크게 보기') + '"><img src="' + esc(c.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></a>' : '<span class="kg-img kg-img--none" aria-hidden="true">—</span>') +
        '<span class="kg-c__m"><span class="kg-c__n"><span class="num">' + (i + 1) + '위</span> <b>' + esc(c.name || '(학생)') + '</b> <span class="kg-score num">' + (+c.score || 0) + '점</span></span>' +
        (c.why ? '<span class="kg-why">' + esc(c.why) + '</span>' : '') + '</span>' +
        (on ? '' : '<button type="button" class="btn btn--sm kg-pick" data-kg-pick="' + r.id + '" data-kg-sid="' + esc(c.sid) + '">확정</button>') +
      '</li>';
    }).join('') + '</ol>';
    else h += '<p class="muted-note kg-none">사진이 없어 자동 후보가 없어요 — 학생을 골라 주세요</p>';
    var key = String(r.id), list = students(cls);
    h += '<div class="kg-acts">' +
      (st.other[key] ? '<select class="input kg-sel" data-kg-sel="' + r.id + '" aria-label="' + esc(K[1] + ' 학생 고르기') + '"><option value="">학생 고르기</option>' +
        list.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select>'
        : '<button type="button" class="btn btn--sm btn--ghost" data-kg-other="' + r.id + '">다른 학생으로</button>') +
      (r.status === 'picked' ? '<button type="button" class="btn btn--sm btn--ghost" data-kg-unpick="' + r.id + '">확정 풀기</button>' : '') +
    '</div></div>';
    return h;
  }
  function bodyHtml(cls) {
    var w = weekOf(cls);
    var calc = '<button type="button" class="btn btn--sm kg-calc" data-kg-calc="' + esc(cls) + '"' + (w ? ' data-kg-lesson="' + esc(w.lesson) + '"' : ' disabled title="이번 주 수업 전 예고가 계산된 뒤에 할 수 있어요"') + (st.busy[cls] ? ' disabled' : '') + '>' + (st.busy[cls] ? '계산 중…' : '후보 다시 계산') + '</button>';
    var cfg = st.owner ? '<div class="kg-cfg"><label>자동 확정 <input class="input kg-hours num" type="number" min="0" max="72" step="1" value="' + (+st.cfg.auto_hours || 0) + '" data-kg-hours aria-label="몇 시간 안에 안 누르면 1위 자동 확정"> 시간 (0 = 끔 · 사람이 확정)</label>' +
      '<label><input type="checkbox" data-kg-on' + (st.cfg.on !== false ? ' checked' : '') + '> 매주 후보 자동 계산</label></div>' : '';
    if (!w) return '<p class="muted-note">아직 이번 주 후보가 없어요 — 수업 전 예고가 계산되면 15분 안에 생겨요</p>' + calc + cfg;
    var order = ['wrong', 'text'];
    return '<p class="kg-period muted-note num">' + esc(md(w.lesson) + ' 수업 전 주 (' + md(w.from) + '~' + md(w.to) + ')') + ' · 사진을 AI 가 보고 매긴 점수 · 학생 화면엔 확정된 배지만</p>' +
      order.map(function (k) { var r = w.rows.find(function (x) { return x.kind === k; }); return r ? kindHtml(r, cls) : ''; }).join('') + calc + cfg;
  }
  function classHtml(cls) {
    if (!st.sql) return '<div class="kg-host" data-kg-cls="' + esc(cls) + '" hidden></div>';
    var w = weekOf(cls), pend = w ? w.rows.filter(function (r) { return r.status === 'open'; }).length : 0;
    var sum = w ? w.rows.map(function (r) { var K = KIND[r.kind] || ['', '']; return K[0] + ' ' + (r.status === 'picked' ? esc(r.picked_name || '') : r.status === 'open' ? '후보 ' + r.cands.length + '명' : '없음'); }).join(' · ') : '아직 없음';
    return '<details class="kg-host" data-kg-cls="' + esc(cls) + '"' + (st.open[cls] ? ' open' : '') + '><summary class="kg-s">👑 이번 주 오답정리왕 · 지문 장악왕 <span class="kg-s__n num">' + sum + '</span>' + (pend ? ' <span class="kg-need">확정 필요</span>' : '') + '</summary>' +
      '<div class="kg-b">' + bodyHtml(cls) + '</div></details>';
  }
  function paint(cls) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kg-cls]'), function (h) {
      var c = h.getAttribute('data-kg-cls');
      if (!cls || c === cls) h.outerHTML = classHtml(c);
    });
  }
  function rowById(id) { return st.rows.find(function (r) { return String(r.id) === String(id); }); }
  function pick(id, sid) {
    var r = rowById(id);
    return Promise.resolve(sb().rpc('king_pick', { p_id: +id, p_student: sid || null })).then(function (x) {
      if (x.error || !x.data || !x.data.ok) { toast('확정하지 못했습니다' + (x.data && x.data.reason === 'class' ? ' — 그 반 학생만 고를 수 있어요' : ''), 'bad'); return; }
      st.other[String(id)] = false;
      toast(sid ? '확정했습니다 — 학생 러닝노트 「내 배지」에 쌓여요 (문자는 가지 않아요)' : '확정을 풀었습니다', 'good');
      return load();
    }).then(function () { if (r) paint(r.class); });
  }
  function calc(cls, lesson) {
    var fns = sb() && sb().functions;
    if (!fns || st.busy[cls]) return;
    st.busy[cls] = true; paint(cls);
    fns.invoke('king-pick', { body: { action: 'calc', class: cls, lesson: lesson } }).then(function (r) {
      var d = (r && r.data) || {};
      st.busy[cls] = false;
      if (!d.ok) toast(d.message || (d.reason === 'time' ? '시간이 모자라 다 못 했어요 — 한 번 더 눌러 주세요' : '후보를 계산하지 못했습니다'), 'bad');
      else toast('후보를 다시 계산했습니다 · 사진 있는 학생 ' + (d.photos || 0) + '명 · 비용 약 $' + (d.cost || 0), 'good');
      return load();
    }, function () { st.busy[cls] = false; toast('후보를 계산하지 못했습니다', 'bad'); paint(cls); });
  }
  function saveCfg(host) {
    var h = host.querySelector('[data-kg-hours]'), on = host.querySelector('[data-kg-on]');
    var p = { auto_hours: Math.max(0, Math.min(72, Math.round(+((h && h.value) || 0)))), on: on ? on.checked : true };
    Promise.resolve(sb().rpc('king_cfg_set', { p: p })).then(function (r) {
      if (r.error) { toast('설정을 저장하지 못했습니다 (원장 계정만)', 'bad'); return; }
      st.cfg = r.data || p;
      toast(p.auto_hours ? p.auto_hours + '시간 안에 안 누르면 1위를 자동 확정합니다' : '자동 확정 끔 — 사람이 확정합니다', 'good');
      paint();
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var b;
    if ((b = t.closest('[data-kg-pick]'))) { pick(b.getAttribute('data-kg-pick'), b.getAttribute('data-kg-sid')); return; }
    if ((b = t.closest('[data-kg-unpick]'))) { pick(b.getAttribute('data-kg-unpick'), null); return; }
    if ((b = t.closest('[data-kg-other]'))) { var r = rowById(b.getAttribute('data-kg-other')); st.other[String(r.id)] = true; paint(r.class); return; }
    if ((b = t.closest('[data-kg-calc]'))) { calc(b.getAttribute('data-kg-calc'), b.getAttribute('data-kg-lesson')); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-kg-sel]') && t.value) { pick(t.getAttribute('data-kg-sel'), t.value); return; }
    if (t.matches && (t.matches('[data-kg-hours]') || t.matches('[data-kg-on]'))) saveCfg(t.closest('.kg-b'));
  });
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.classList && d.classList.contains('kg-host')) st.open[d.getAttribute('data-kg-cls')] = d.open;
  }, true);
  window.addEventListener('jt:loaded', load);
  window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if (t === 'king_weeks' || t === '*') load(); });

  window.Kings = { load: load, classHtml: classHtml, paint: paint, state: function () { return st; } };
})();
