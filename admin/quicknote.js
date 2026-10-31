/* ============================================================
   quicknote.js — 「오늘」 · 레포트 발송 학생 줄에서 바로 상담 적기 (20261031o · migration-042-quick-note)

   · 학생 이름 옆 작은 글씨 「마지막 상담 10/15」 · 없으면 「상담 없음」 · 오늘 적었으면 초록 「오늘 상담 ✓」
   · 줄 오른쪽(휴대폰은 「⋯」 앞) [상담 +] → 그 줄 바로 아래에 칸이 펼쳐진다 (창을 띄우지 않는다 · 한 번에 한 학생)
       맨 위 「지난 상담」 — 날짜(요일) · 분류 · 적은 사람 · 내용 전체 (따옴표 상자 · 16px)
       「지난번 약속」 — 지난 상담의 「다음에 확인할 것」 · 요일 · 날짜가 있으면 그 뒤 과제 기록 「이번 주 화 ✓ 목 ✕」
       [이전 상담 더 보기] — 그 전 상담들 (최근 → 옛날) · 기록이 없으면 「첫 상담입니다」
       분류(과제 독려 · 학습 상담 · 학부모 연락 · 기타) · 내용 · 다음에 확인할 것 · 확인 필요 · [저장] [취소]
   · 저장하면 상담 카드의 상담 · 관찰 기록(student_notes)에 그대로 쌓인다 · 줄은 「오늘 상담 ✓」로만 바뀐다 (정렬은 그대로)
   상담 내용 · 약속은 직원만 본다 (학생 · 학부모 화면은 student_notes 를 읽지 않는다).
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

  var CATS = ['과제 독려', '학습 상담', '학부모 연락', '기타'];
  var st = {
    last: {},            /* 학생 id → 마지막 상담 날짜 */
    loaded: false,
    notes: {},           /* 학생 id → 상담 기록 (최근 → 옛날) */
    open: '', host: '',  /* 펼친 학생 · 그 목록 (#tdBody | #sendList) */
    more: false, busy: false, err: '', focus: '',
    draft: { cat: '', body: '', next: '', follow: false }
  };
  var box = null;

  /* 자동으로 남는 기록(새 학생 앱 안내 문자 · sms.js)은 상담으로 세지 않는다 */
  function isAuto(n) { return (n.categories || []).join() === '기타' && /앱 안내 문자 보냄$/.test(n.body || ''); }

  function loadLast() {
    if (!sb()) return Promise.resolve();
    return sb().from('student_notes').select('student_id,note_date,categories,body')
      .is('deleted_at', null).gte('note_date', addDays(today(), -400))
      .then(function (r) {
        if (r.error) return;
        var next = {};
        (r.data || []).forEach(function (n) { if (!isAuto(n) && (!next[n.student_id] || n.note_date > next[n.student_id])) next[n.student_id] = n.note_date; });
        st.last = next; st.loaded = true;
        paintTags();
      });
  }

  /* ---------- 줄에 넣는 조각 ---------- */
  function tagHtml(sid) {
    var d = st.last[sid] || '', t = today();
    var cls = d === t ? ' is-today' : !d ? ' is-none' : '';
    /* 휴대폰에서는 「마지막 」을 숨겨 「상담 10/15」 (글자는 그대로) */
    var txt = !st.loaded ? '' : d === t ? '오늘 상담 ✓' : d ? '<span class="qn-tag__p">마지막 </span>상담 ' + md(d) : '상담 없음';
    return '<span class="qn-tag' + cls + '" data-qn-tag="' + esc(sid) + '">' + txt + '</span>';
  }
  function btnHtml(sid, name) {
    return '<button type="button" class="btn btn--sm qn-btn" data-qn-open="' + esc(sid) + '" aria-expanded="' + (st.open === sid) + '" aria-label="' + esc((name || '') + ' 상담 적기') + '">상담 +</button>';
  }
  function slotHtml(sid) { return st.open === sid ? '<div class="qn-slot" data-qn-slot="' + esc(sid) + '"></div>' : ''; }
  function paintTags() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-qn-tag]'), function (el) {
      var w = document.createElement('span');
      w.innerHTML = tagHtml(el.dataset.qnTag);
      el.parentNode.replaceChild(w.firstChild, el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qn-open]'), function (b) { b.setAttribute('aria-expanded', String(b.dataset.qnOpen === st.open)); });
  }

  /* ---------- 지난번 약속 — 요일 · 날짜를 찾아 그 뒤 과제 기록 ---------- */
  var DOW_RE = /(^|[^가-힣0-9])([월화수목금토일])(?:요일|욜)?(?=$|[^가-힣]|까지|에|엔|도|마다|랑|이랑|과|와|은|는)/g;
  function promiseDates(text, from) {
    var out = {}, s = String(text || ''), m, y = +from.slice(0, 4);
    DOW_RE.lastIndex = 0;
    while ((m = DOW_RE.exec(s))) {
      var w = DOWK.indexOf(m[2]), d = addDays(from, 1);
      for (var i = 0; i < 7 && dowOf(d) !== w; i++) d = addDays(d, 1);
      out[d] = true;
    }
    var put = function (mo, da) {
      mo = +mo; da = +da;
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return;
      var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
      if (iso <= from) iso = (y + 1) + iso.slice(4);
      out[iso] = true;
    };
    s.replace(/(\d{1,2})\s*\/\s*(\d{1,2})/g, function (_, a, b) { put(a, b); return _; });
    s.replace(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, function (_, a, b) { put(a, b); return _; });
    return Object.keys(out).sort().slice(0, 7);
  }
  var MARK = { onTime: '✓', late: '✓(늦게)', none: '✕', exempt: '면제', off: '–', future: '아직', wkDone: '✓', wk: '○' };
  function trackHtml(sid, n) {
    var ds = promiseDates(n.next_check, n.note_date);
    if (!ds.length) return '';
    var hw = window.Today && Today.hwOn ? Today.hwOn(sid, ds) : null;
    if (hw === false) return '<span class="qn-track qn-track--none">앱 과제 기록이 없습니다 (과제 링크 확인)</span>';
    if (!hw) return '<span class="qn-track qn-track--none">과제 기록 불러오는 중…</span>';
    var t = today(), mon = addDays(t, -((dowOf(t) + 6) % 7)), week = ds.every(function (d) { return d >= mon && d <= addDays(mon, 6); });
    var items = ds.map(function (d) {
      var k = hw[d] || 'off';
      return '<span class="qn-tk qn-tk--' + esc(k) + '">' + esc((week ? DOWK[dowOf(d)] : mdw(d)) + ' ' + MARK[k]) + '</span>';
    });
    return '<span class="qn-track">' + (week ? '이번 주 ' : '') + items.join(' ') + '</span>';
  }

  /* ---------- 펼친 칸 ---------- */
  function noteHead(n) {
    return '<span class="qn-when num">' + esc(mdw(n.note_date)) + '</span>' +
      (n.categories || []).map(function (c) { return '<span class="nt-cat">' + esc(c) + '</span>'; }).join('') +
      '<span class="qn-who">' + esc(n.author_name || '') + '</span>';
  }
  function boxHtml(sid) {
    var list = st.notes[sid];
    var h = '<div class="qn-box" role="group" aria-label="상담 적기">';
    if (!list) h += '<p class="qn-loading">지난 상담을 불러오는 중…</p>';
    else if (!list.length) h += '<p class="qn-first">첫 상담입니다</p>';
    else {
      var n = list[0], prom = list.find(function (x) { return (x.next_check || '').trim(); });
      h += '<div class="qn-last"><div class="qn-last__t">지난 상담</div><div class="qn-last__h">' + noteHead(n) + '</div>' +
        '<blockquote class="qn-quote">' + esc(n.body) + '</blockquote></div>';
      if (prom) h += '<div class="qn-prom"><span class="qn-prom__t">지난번 약속</span><span class="qn-prom__b">' + esc(prom.next_check) + '</span>' +
        (prom !== n ? '<span class="qn-prom__d num">(' + esc(md(prom.note_date)) + ')</span>' : '') + trackHtml(sid, prom) + '</div>';
      if (list.length > 1) {
        h += '<button type="button" class="qn-more" data-qn-more aria-expanded="' + st.more + '">' + (st.more ? '이전 상담 접기 ▴' : '이전 상담 더 보기 (' + (list.length - 1) + ') ▾') + '</button>';
        if (st.more) h += '<ol class="qn-hist">' + list.slice(1).map(function (x) {
          return '<li><div class="qn-last__h">' + noteHead(x) + '</div><div class="qn-hist__b">' + esc(x.body) + '</div>' +
            (x.next_check ? '<div class="qn-hist__n">다음에 확인할 것: ' + esc(x.next_check) + '</div>' : '') + '</li>';
        }).join('') + '</ol>';
      }
    }
    var d = st.draft;
    h += '<div class="qn-form">' +
      '<div class="qn-cats" role="group" aria-label="분류">' + CATS.map(function (c) {
        return '<button type="button" class="qn-cat' + (d.cat === c ? ' is-on' : '') + '" data-qn-cat="' + esc(c) + '" aria-pressed="' + (d.cat === c) + '">' + esc(c) + '</button>';
      }).join('') + '</div>' +
      '<label class="qn-field"><span class="qn-lab">내용</span><textarea class="textarea qn-body" id="qnBody" rows="2" maxlength="2000" placeholder="오늘 나눈 이야기 한두 줄">' + esc(d.body) + '</textarea></label>' +
      '<label class="qn-field"><span class="qn-lab">다음에 확인할 것 <small>(비워도 됨)</small></span><input class="input qn-next" id="qnNext" type="text" maxlength="200" placeholder="예) 화 · 목 과제 내기" value="' + esc(d.next) + '"></label>' +
      '<label class="qn-follow"><input type="checkbox" id="qnFollow"' + (d.follow ? ' checked' : '') + '> 확인 필요 <small>(상담 카드 맨 위 📌)</small></label>' +
      (st.err ? '<p class="qn-err" role="alert">' + esc(st.err) + '</p>' : '') +
      '<div class="qn-acts"><button type="button" class="btn btn--primary qn-save" data-qn-save' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? '저장하는 중…' : '저장') + '</button>' +
        '<button type="button" class="btn qn-cancel" data-qn-cancel>취소</button></div>' +
      '</div></div>';
    return h;
  }
  function paintBox() {
    if (!box || !st.open) return;
    box.innerHTML = boxHtml(st.open);
  }
  /* 목록을 다시 그린 뒤 — 펼친 칸을 그 줄 자리에 다시 붙이고, 쓰던 칸에 다시 커서 */
  function mount() {
    if (!st.open) return;
    var root = document.querySelector(st.host) || document;
    var slot = root.querySelector('[data-qn-slot="' + st.open + '"]');
    if (!slot) return;
    if (!box) { box = document.createElement('div'); box.className = 'qn-wrap'; box.innerHTML = boxHtml(st.open); }
    if (box.parentNode !== slot) slot.appendChild(box);
    if (st.focus) { var f = box.querySelector('#' + st.focus); if (f && document.activeElement !== f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }
  }
  function close() {
    st.open = ''; st.host = ''; st.more = false; st.err = ''; st.focus = ''; st.busy = false;
    st.draft = { cat: '', body: '', next: '', follow: false };
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    Array.prototype.forEach.call(document.querySelectorAll('.qn-slot'), function (el) { el.parentNode.removeChild(el); });
    paintTags();
  }
  function rowOf(btn) { return btn.closest('.tdc-st, .snd-row'); }
  function open(sid, btn) {
    if (st.open === sid) { close(); return; }
    close();
    st.open = sid;
    st.host = btn && btn.closest('#sendList') ? '#sendList' : '#tdBody';
    var row = btn && rowOf(btn);
    if (row) row.insertAdjacentHTML('beforeend', slotHtml(sid));
    mount();
    paintTags();
    if (!st.notes[sid]) loadNotes(sid);
  }
  function loadNotes(sid) {
    return sb().from('student_notes').select('*').eq('student_id', sid).is('deleted_at', null)
      .order('note_date', { ascending: false }).order('created_at', { ascending: false })
      .then(function (r) {
        st.notes[sid] = r.error ? [] : (r.data || []).filter(function (n) { return !isAuto(n); });
        if (r.error) st.err = '지난 상담을 불러오지 못했습니다 — ' + r.error.message;
        if (st.open === sid) paintBox();
      });
  }
  function save() {
    var sid = st.open, d = st.draft;
    if (!sid || st.busy) return;
    if (!d.cat) { st.err = '분류를 골라 주세요'; paintBox(); return; }
    if (!d.body.trim()) { st.err = '내용을 적어 주세요'; paintBox(); var b = box && box.querySelector('#qnBody'); if (b) b.focus(); return; }
    st.busy = true; st.err = ''; paintBox();
    var row = { student_id: sid, note_date: today(), categories: [d.cat], body: d.body.trim(), follow_up: !!d.follow };
    if (d.next.trim()) row.next_check = d.next.trim().slice(0, 200);
    sb().from('student_notes').insert(row).select('*').single().then(function (r) {
      st.busy = false;
      if (r.error) {
        var m = r.error.message || '';
        st.err = /next_check|student_notes_cat_check|schema cache/i.test(m) ? 'migration-042 SQL 을 먼저 실행해 주세요 (다음에 확인할 것 · 새 분류)' : '저장하지 못했습니다 — ' + m;
        paintBox();
        return;
      }
      (st.notes[sid] = st.notes[sid] || []).unshift(r.data);
      st.last[sid] = r.data.note_date;
      var name = (Store.getStudents().find(function (s) { return s.id === sid; }) || {}).name || '';
      close();
      toast((name ? name + ' ' : '') + '상담을 남겼습니다 — 상담 카드에 쌓였습니다', 'good');
      if (window.Card && Card.notesChanged) Card.notesChanged(sid);
    });
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-qn-open], [data-qn-cat], [data-qn-more], [data-qn-save], [data-qn-cancel]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.hasAttribute('data-qn-open')) { open(b.dataset.qnOpen, b); return; }
    if (b.hasAttribute('data-qn-cat')) {
      st.draft.cat = st.draft.cat === b.dataset.qnCat ? '' : b.dataset.qnCat;
      if (st.err === '분류를 골라 주세요') st.err = '';
      Array.prototype.forEach.call(box.querySelectorAll('[data-qn-cat]'), function (x) { var on = x.dataset.qnCat === st.draft.cat; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      return;
    }
    if (b.hasAttribute('data-qn-more')) { st.more = !st.more; paintBox(); return; }
    if (b.hasAttribute('data-qn-save')) { save(); return; }
    if (b.hasAttribute('data-qn-cancel')) close();
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!box || !box.contains(t)) return;
    if (t.id === 'qnBody') st.draft.body = t.value;
    else if (t.id === 'qnNext') st.draft.next = t.value;
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'qnFollow' && box && box.contains(e.target)) st.draft.follow = e.target.checked;
  });
  /* 칸을 누르면 화면이 그 칸으로 (휴대폰 자판이 올라와도 보이게) */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!box || !box.contains(t) || !/^(qnBody|qnNext)$/.test(t.id)) return;
    st.focus = t.id;
    setTimeout(function () { if (document.activeElement === t && t.scrollIntoView) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
  });
  document.addEventListener('focusout', function (e) {
    if (!box || !box.contains(e.target)) return;
    if (e.relatedTarget && !box.contains(e.relatedTarget)) st.focus = '';
  });
  /* 과제 기록이 늦게 오면 「지난번 약속」 옆 과제 기록만 다시 (쓰던 칸은 그대로) */
  window.addEventListener('jt:app', function (e) {
    if (!box || !st.open || !e.detail || e.detail.sid !== st.open) return;
    var old = box.querySelector('.qn-prom');
    if (!old) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = boxHtml(st.open);
    var nu = tmp.querySelector('.qn-prom');
    if (nu) old.parentNode.replaceChild(nu, old);
  });
  /* 처음 · 다른 기기에서 상담 기록이 바뀌면 이름 옆 표시를 다시 */
  window.addEventListener('jt:loaded', function () { loadLast(); });
  window.addEventListener('jt:refreshed', function () { loadLast(); });
  window.addEventListener('jt:remote', function (e) {
    var t = (e.detail && e.detail.table) || '';
    if (t !== '*' && t !== 'student_notes') return;
    st.notes = {};
    loadLast();
    if (st.open && !st.busy) loadNotes(st.open);
  });

  window.QuickNote = {
    tagHtml: tagHtml, btnHtml: btnHtml, slotHtml: slotHtml, mount: mount, close: close, reload: loadLast,
    promiseDates: promiseDates,
    state: function () { return st; },
    /* 상담 카드에서 기록이 바뀌면 (card.js) */
    changed: function (sid) { if (sid) delete st.notes[sid]; loadLast(); }
  };
})();
