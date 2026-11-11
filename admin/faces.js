/* ============================================================
   faces.js — 학생 얼굴 사진(코치룸 전용) · 이름 외우기 (20261110b · migration-093 face_staff_save · 035 student_profile)

   사진은 코치룸(학생 카드 · 학생 목록 · 출석 화면 · 「오늘」)에서만. 학생 러닝노트엔 캐릭터, 학부모 화면 · 문자 · 다른 학생에겐 절대 안 보인다
     저장 = 035 student_profile.photo(400px) · thumb(96px) — 직원만 읽는 표 · 공개 주소 없음
     올리기: 정사각형(세로 사진은 위쪽)으로 잘라 400px JPEG 로 다시 그림(위치 정보 등 부가 정보 없음) · 5MB 넘는 파일 · 이미지 아닌 파일 거부 (face-crop.js)
     휴대폰은 [사진 올리기]에서 카메라로 바로 찍을 수 있다 (capture) · [사진 지우기] = 표에서 사진 · 작은 사진 · 동의 기록 모두 지움
     대신 올릴 때는 「학생 동의 받음」 체크를 해야 [사진 올리기]가 눌린다 (서버도 확인 · face_staff_save p_agree) · 동의한 날짜 · 올린 사람을 남기고 학생 카드에 「동의 11/10 · 올린 사람 김선생」
     AI 변환 · 외부 서비스 전송 없음
   학생 카드 머리 — 사진(없으면 학생이 고른 캐릭터) · [사진 올리기] [사진 지우기] · 안내 한 줄 · 레벨 · XP 작게
   이름 외우기 — 반 고르기 → 사진이 있는 학생 카드가 섞여 나옴 → 누르면 이름 · 학교 → [알았어요][헷갈려요]
     헷갈린 학생은 2장 뒤에 다시, 다음 바퀴에도 더 자주 (이 기기에만 기억) · 반마다 「사진 있음 n명 / 없음 n명」 · 없는 학생 바로 올리기
   ============================================================ */
(function (global) {
  'use strict';

  function sb() { return SB.client; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, k) { if (global.UI && UI.toast) UI.toast(m, k); }
  function stu(sid) { return (UI.activeStudents ? UI.activeStudents() : []).find(function (s) { return s.id === sid; }) || (Store.getStudent ? Store.getStudent(sid) : null); }
  var NOTE = function () { return global.FaceCrop ? FaceCrop.NOTE : '선생님이 이름을 익히는 용도로만 쓰고, 선생님만 볼 수 있어요 · 언제든 지울 수 있어요'; };

  /* ---------- 동의 · 올린 사람 (093 consent_at · photo_by) ---------- */
  var agreed = {};          /* 학생마다 「학생 동의 받음」 체크 (이 화면에서만) */
  var meta = { by: {}, p: null };
  function loadMeta(force) {
    if (meta.p && !force) return meta.p;
    meta.p = Promise.resolve(sb().from('student_profile').select('student_id,consent_at,photo_by')).then(function (r) {
      meta.by = {};
      if (r && !r.error) (r.data || []).forEach(function (x) { meta.by[x.student_id] = x; });
      if (global.QuickNote && QuickNote.repaint && document.getElementById('scFace')) QuickNote.repaint(true);
    }, function () {});
    return meta.p;
  }
  function metaText(sid) {
    var m = meta.by[sid];
    if (!m || !m.consent_at) return '';
    var d = new Date(m.consent_at);
    return '동의 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' · 올린 사람 ' + (m.photo_by || '—');
  }
  function agreeBox(sid) {
    return '<label class="fc-agree"><input type="checkbox" data-fc-agree="' + esc(sid) + '"' + (agreed[sid] ? ' checked' : '') + '> 학생 동의 받음</label>';
  }

  /* ---------- 올리기 · 지우기 ---------- */
  var busy = {};
  function upload(sid, file) {
    if (!global.FaceCrop || busy[sid]) return Promise.resolve(false);
    if (!agreed[sid]) { toast('「학생 동의 받음」에 체크해야 올릴 수 있습니다', 'bad'); return Promise.resolve(false); }
    var why = FaceCrop.check(file);
    if (why) { toast(why, 'bad'); return Promise.resolve(false); }
    busy[sid] = true; changed();
    return FaceCrop.makeData(file).then(function (x) {
      return Promise.resolve(sb().rpc('face_staff_save', { p_student: sid, p_photo: x.photo, p_thumb: x.thumb, p_agree: true })).then(function (r) {
        if (r.error || !r.data || !r.data.ok) throw new Error(r.error ? (/face_staff_save/.test(r.error.message || '') ? 'migration-093 SQL 을 먼저 실행해 주세요' : r.error.message) : r.data && r.data.reason === 'agree' ? '「학생 동의 받음」에 체크해 주세요' : '사진을 저장하지 못했습니다');
        if (global.Profile && Profile.setThumb) Profile.setThumb(sid, x.thumb);
        meta.by[sid] = { student_id: sid, consent_at: new Date().toISOString(), photo_by: (global.UI && UI.whoami ? UI.whoami() : '') || '직원' };
        loadMeta(true);
        toast('사진을 올렸습니다 — 코치룸에서만 보여요', 'good');
        return true;
      });
    }).catch(function (e) { toast((e && e.message) || '사진을 올리지 못했습니다', 'bad'); return false; })
      .then(function (ok) { delete busy[sid]; changed(); return ok; });
  }
  function remove(sid) {
    var s = stu(sid) || {};
    return UI.confirmAsk('사진 지우기', (s.name || '') + ' 학생 사진을 지웁니다. 저장된 사진이 완전히 지워집니다.', '지우기').then(function (y) {
      if (!y) return false;
      return Promise.resolve(sb().rpc('face_staff_save', { p_student: sid, p_photo: '', p_thumb: '', p_agree: false })).then(function (r) {
        if (r.error || !r.data || !r.data.ok) { toast('지우지 못했습니다' + (r.error ? ' — ' + r.error.message : ''), 'bad'); return false; }
        if (global.Profile && Profile.setThumb) Profile.setThumb(sid, null);
        delete meta.by[sid]; delete agreed[sid];
        toast('사진을 지웠습니다');
        changed();
        return true;
      });
    });
  }
  function changed() {
    if (global.QuickNote && QuickNote.repaint) QuickNote.repaint(true);
    if (drill.open) paintDrill();
  }
  /* [사진 올리기] — 「학생 동의 받음」 체크 전에는 눌리지 않는다 */
  function fileInput(sid, label, cls) {
    var on = !!agreed[sid];
    return agreeBox(sid) + '<label class="btn btn--sm ' + (cls || '') + ' fc-file' + (on ? '' : ' is-off') + '" title="' + (on ? '' : '「학생 동의 받음」에 먼저 체크') + '">' + esc(label) +
      '<input type="file" accept="image/*" capture="user" data-fc-up="' + esc(sid) + '" hidden' + (on ? '' : ' disabled') + '></label>';
  }

  /* ---------- 학생 카드 머리 ---------- */
  function cardHtml(sid) {
    var s = stu(sid) || { id: sid, name: '' }, has = global.Profile && Profile.hasPhoto(sid);
    var g = global.Today && Today.gameOf ? Today.gameOf(sid) : null;
    if (!meta.p) loadMeta();
    var mt = has ? metaText(sid) : '';
    return '<section class="sc-sec fc-head" id="scFace" aria-label="사진">' +
      '<span class="fc-pic">' + (global.Profile ? Profile.avatar(s, 'xl') : '') + '</span>' +
      '<div class="fc-side">' +
        (g ? '<p class="fc-lv num" data-fc-lv>Lv.' + (g.level.i + 1) + ' ' + esc(g.level.name) + ' · ' + g.xp + ' XP</p>' : '') +
        '<div class="fc-btns">' + (busy[sid] ? '<span class="fc-busy">올리는 중…</span>' : fileInput(sid, has ? '사진 바꾸기' : '사진 올리기', '')) +
          (has && !busy[sid] ? '<button type="button" class="btn btn--sm btn--ghost" data-fc-del="' + esc(sid) + '">사진 지우기</button>' : '') + '</div>' +
        (mt ? '<p class="fc-meta num" data-fc-meta>' + esc(mt) + '</p>' : '') +
        '<p class="fc-note">' + esc(NOTE()) + '</p>' +
      '</div></section>';
  }

  /* ---------- 이름 외우기 ---------- */
  var drill = { open: false, cls: '', deck: [], cur: '', shown: false, done: 0, miss: {}, round: 1 };
  var WKEY = 'mhub.drill.w';
  function weights() { try { return JSON.parse(global.localStorage.getItem(WKEY) || '{}') || {}; } catch (e) { return {}; } }
  function setWeight(sid, w) { var m = weights(); if (w <= 1) delete m[sid]; else m[sid] = Math.min(5, w); try { global.localStorage.setItem(WKEY, JSON.stringify(m)); } catch (e) {} }
  function classNames() {
    var seen = {};
    (UI.activeStudents ? UI.activeStudents() : []).forEach(function (s) { var c = (s.className || '').trim(); if (c && !(Store.isArchivedClass && Store.isArchivedClass(c))) seen[c] = 1; });
    var names = Object.keys(seen);
    return global.TodayView && TodayView.orderClasses ? TodayView.orderClasses(names) : names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function inClass(cls) { return (UI.activeStudents ? UI.activeStudents() : []).filter(function (s) { return (s.className || '').trim() === cls; }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); }); }
  function shuffle(a, rnd) { rnd = rnd || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* 한 바퀴 — 사진 있는 학생 모두 한 번씩 + 헷갈렸던 학생은 무게만큼 더 */
  function makeDeck(cls) {
    var w = weights(), out = [];
    inClass(cls).forEach(function (s) {
      if (!(global.Profile && Profile.hasPhoto(s.id))) return;
      out.push(s.id);
      for (var k = 1; k < (w[s.id] || 1); k++) out.push(s.id);
    });
    out = shuffle(out);
    for (var i = 1; i < out.length; i++) if (out[i] === out[i - 1]) { var j = (i + 2) % out.length; var t = out[i]; out[i] = out[j]; out[j] = t; }   /* 같은 학생이 연달아 나오지 않게 */
    return out;
  }
  function startClass(cls) {
    drill.cls = cls; drill.deck = makeDeck(cls); drill.cur = drill.deck.shift() || ''; drill.shown = false; drill.done = 0; drill.miss = {};
    paintDrill();
  }
  function next(knew) {
    var sid = drill.cur;
    if (!sid) return;
    var w = weights()[sid] || 1;
    if (knew) setWeight(sid, w - 1);
    else {
      setWeight(sid, w + 2);
      drill.miss[sid] = 1;
      drill.deck.splice(Math.min(2, drill.deck.length), 0, sid);      /* 헷갈리면 2장 뒤에 다시 */
    }
    drill.done++;
    drill.cur = drill.deck.shift() || '';
    drill.shown = false;
    paintDrill();
  }
  function statsHtml(cls) {
    var list = inClass(cls), has = list.filter(function (s) { return global.Profile && Profile.hasPhoto(s.id); }), none = list.filter(function (s) { return !(global.Profile && Profile.hasPhoto(s.id)); });
    return '<p class="fd-stat num" id="fdStat">사진 있음 <b>' + has.length + '</b>명 / 없음 <b>' + none.length + '</b>명</p>' +
      (none.length ? '<details class="fd-none"' + (drill.noneOpen ? ' open' : '') + ' data-fd-none><summary>사진 없는 학생 ' + none.length + '명 — 바로 올리기</summary><ul class="fd-none__list">' + none.map(function (s) {
        return '<li><span class="fd-none__n">' + (global.Profile ? Profile.avatar(s, 's') : '') + esc(s.name || '') + '</span>' + (busy[s.id] ? '<span class="fc-busy">올리는 중…</span>' : fileInput(s.id, '사진 올리기', 'btn--ghost')) + '</li>';
      }).join('') + '</ul></details>' : '');
  }
  function cardOf(sid) {
    var s = stu(sid) || {};
    return '<div class="fd-card' + (drill.shown ? ' is-shown' : '') + '">' +
      '<button type="button" class="fd-photo" data-fd-show aria-label="누르면 이름이 보여요">' + (global.Profile ? Profile.avatar(s, 'xxl') : '') + '</button>' +
      (drill.shown
        ? '<p class="fd-name" id="fdName">' + esc(s.name || '') + '</p><p class="fd-school">' + esc([s.school, s.grade].filter(Boolean).join(' · ') || '학교 정보 없음') + '</p>' +
          '<div class="fd-acts"><button type="button" class="btn btn--primary" data-fd-knew>알았어요</button><button type="button" class="btn" data-fd-miss>헷갈려요</button></div>'
        : '<p class="fd-hint">얼굴을 보고 이름을 떠올린 뒤 사진을 누르세요</p>') +
    '</div>';
  }
  function paintDrill() {
    var body = document.getElementById('fdBody');
    if (!body) return;
    var names = classNames();
    if (!drill.cls && names.length) drill.cls = names[0];
    var html = '<div class="fd-cls" role="group" aria-label="반 고르기">' + names.map(function (c) {
      return '<button type="button" class="chip' + (c === drill.cls ? ' is-on' : '') + '" data-fd-cls="' + esc(c) + '" aria-pressed="' + (c === drill.cls) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';
    if (drill.cls) html += statsHtml(drill.cls);
    if (drill.cur) html += '<p class="fd-prog num">' + (drill.done + 1) + '번째 · 남은 카드 ' + drill.deck.length + '장</p>' + cardOf(drill.cur);
    else if (drill.cls) {
      var missN = Object.keys(drill.miss).length;
      html += drill.done
        ? '<div class="fd-end"><p>한 바퀴 끝 · ' + drill.done + '장' + (missN ? ' · 헷갈린 학생 ' + missN + '명은 다음에 더 자주 나와요' : ' · 모두 알았어요 👏') + '</p><button type="button" class="btn btn--primary" data-fd-again>다시 하기</button></div>'
        : '<p class="fd-empty">이 반에 사진이 있는 학생이 없어요 · 위에서 사진을 올려 주세요</p>';
    }
    body.innerHTML = html;
  }
  function ensureModal() {
    var m = document.getElementById('fdModal');
    if (m) return m;
    m = document.createElement('dialog');
    m.className = 'modal fd-modal'; m.id = 'fdModal';
    m.innerHTML = '<div class="modal__head fd-head"><h2 class="modal__title">이름 외우기</h2><button type="button" class="btn btn--sm" data-fd-close>닫기</button></div>' +
      '<p class="fd-note">' + esc(NOTE()) + '</p><div class="modal__body" id="fdBody"></div>';
    document.body.appendChild(m);
    m.addEventListener('close', function () { drill.open = false; });
    return m;
  }
  function openDrill(cls) {
    var m = ensureModal();
    drill.open = true;
    if (cls) drill.cls = cls;
    if (!m.open) Layer.show(m);
    if (drill.cls) startClass(drill.cls); else paintDrill();
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var del = t.closest && t.closest('[data-fc-del]');
    if (del) { e.preventDefault(); remove(del.getAttribute('data-fc-del')); return; }
    if (t.closest && t.closest('[data-fd-open]')) { e.preventDefault(); openDrill(t.closest('[data-fd-open]').getAttribute('data-fd-open') || ''); return; }
    if (!t.closest || !t.closest('#fdModal')) return;
    if (t.closest('[data-fd-close]')) { document.getElementById('fdModal').close(); return; }
    var c = t.closest('[data-fd-cls]');
    if (c) { startClass(c.getAttribute('data-fd-cls')); return; }
    if (t.closest('[data-fd-show]')) { drill.shown = true; paintDrill(); return; }
    if (t.closest('[data-fd-knew]')) { next(true); return; }
    if (t.closest('[data-fd-miss]')) { next(false); return; }
    if (t.closest('[data-fd-again]')) { startClass(drill.cls); return; }
  }, true);
  document.addEventListener('toggle', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-fd-none')) drill.noneOpen = e.target.open; }, true);
  document.addEventListener('change', function (e) {
    var ag = e.target.closest && e.target.closest('[data-fc-agree]');
    if (ag) {
      var aid = ag.getAttribute('data-fc-agree');
      if (ag.checked) agreed[aid] = true; else delete agreed[aid];
      /* 다시 그리지 않고 그 학생 [사진 올리기]만 켠다 · 끈다 (같은 학생 칸이 여러 곳이면 모두) */
      Array.prototype.forEach.call(document.querySelectorAll('[data-fc-agree="' + aid + '"]'), function (x) { x.checked = !!agreed[aid]; });
      Array.prototype.forEach.call(document.querySelectorAll('[data-fc-up="' + aid + '"]'), function (x) { x.disabled = !agreed[aid]; var l = x.closest('label'); if (l) l.classList.toggle('is-off', !agreed[aid]); });
      return;
    }
    var inp = e.target.closest && e.target.closest('[data-fc-up]');
    if (!inp || !inp.files || !inp.files[0]) return;
    var sid = inp.getAttribute('data-fc-up');
    upload(sid, inp.files[0]).then(function (ok) { if (ok && drill.open && drill.cls && !drill.cur && !drill.done) startClass(drill.cls); });
  });

  global.Faces = { cardHtml: cardHtml, upload: upload, remove: remove, openDrill: openDrill, makeDeck: makeDeck, _drill: function () { return drill; }, next: next,
                   agree: function (sid, on) { if (on) agreed[sid] = true; else delete agreed[sid]; }, loadMeta: loadMeta, metaText: metaText };
})(window);
