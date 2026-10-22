/* ============================================================
   preview.js — 코치룸 「학부모 화면 보기」 · 「학생 화면 보기」 (migration-015)

   그 학생의 러닝노트(/me/)를 학부모 링크 · 학생 링크로 열었을 때와 똑같이 보여 준다.
     · 링크 코드를 화면 주소에 쓰지 않는다 — /me/?preview=1 만 열고, 내용은 이 창(로그인한 직원)이
       staff_hub_get 등 직원 전용 함수로 대신 받아 넘긴다 (hub.js 의 HUB_PREVIEW).
     · 아무것도 바뀌지 않는다 — 제출 · 사진 올리기 · 지우기는 눌러도 「미리보기에서는 바뀌지 않습니다」.
     · 학생 · 학부모 쪽 열람 기록은 남지 않는다 (그런 기록 자체가 없고, 직원 함수도 남기지 않는다).
     · 공개 전 이번 주 레포트는 「공개하면 이렇게 보입니다」로 함께 (② 작성 내용으로 만든다).
     · [휴대폰 크기로 보기]
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var BLOCK = '미리보기에서는 바뀌지 않습니다 (조교 화면)';
  var cur = { sid: '', role: 'parent', phone: false };

  function unwrap(r) {
    if (r.error) throw new Error(/Could not find the function|schema cache/i.test(r.error.message) ? 'migration-015 SQL 을 먼저 실행해 주세요.' : r.error.message);
    return r.data;
  }
  function student() { return Store.getStudents().find(function (x) { return x.id === cur.sid; }) || null; }
  function today() { return DDay.today(); }

  /* 공개 전 이번 주 레포트 — ② 작성 내용으로 (그 학생 입력이나 반 공통이 있을 때만) */
  function draftReport() {
    var d = window.Writer && Writer.current();
    var s = student();
    if (!d || !s || !d.weekStart) return null;
    var common = (d.common || {})[s.className || ''] || null;
    var entry = (d.entries || {})[s.id] || null;
    if (!common && !entry) return null;
    return Report.toReportData(s, common || {}, entry || {}, { start: d.weekStart, end: d.weekEnd });
  }

  /* 서명 주소로 바꾸기 (직원은 비공개 보관함을 볼 수 있다) */
  function signAll(bucket, items, key) {
    var paths = items.map(function (x) { return x && x[key]; }).filter(Boolean);
    if (!paths.length) return Promise.resolve({});
    return sb().storage.from(bucket).createSignedUrls(paths, 600).then(function (r) {
      var m = {};
      (r.data || []).forEach(function (x) { if (x.signedUrl) m[x.path] = x.signedUrl; });
      return m;
    });
  }

  /* ---------- hub.js 가 부르는 것 ---------- */

  var bridge = {
    blockMsg: BLOCK,
    get role() { return cur.role; },
    view: '',
    arg: '',

    rpc: function (name, args) {
      if (name === 'hub_get') {
        return sb().rpc('staff_hub_get', { p_student: cur.sid, p_role: cur.role }).then(unwrap).then(function (d) {
          var dr = draftReport();
          if (d && d.ok && dr) d.draft = { week_start: dr.startDate, week_end: dr.endDate, lesson_date: dr.lessonDate || '' };
          return d;
        });
      }
      if (name === 'hub_report') {
        if (args.p_week === '__draft') return Promise.resolve(draftReport());
        return sb().rpc('staff_hub_report', { p_student: cur.sid, p_week: args.p_week }).then(unwrap);
      }
      if (name === 'hub_textbook') return sb().rpc('staff_hub_textbook', { p_student: cur.sid }).then(unwrap);
      if (name === 'hub_trend') return sb().rpc('staff_hub_trend', { p_student: cur.sid }).then(unwrap);
      return Promise.resolve(null);
    },

    /* 필기 사진 — 보기만. 올리기 · 지우기는 막는다 */
    photo: function (body) {
      if (!body || body.action !== 'list') return Promise.resolve({ ok: false, message: BLOCK });
      return sb().from('note_photos').select('id,lesson_date,uploaded_on,width,height,path,created_at')
        .eq('student_id', cur.sid).is('hidden_at', null).order('lesson_date', { ascending: false }).then(function (r) {
          var all = r.data || [];
          var t = today();
          var inRange = all.filter(function (p) {
            return (!body.from || p.lesson_date >= body.from) && (!body.to || p.lesson_date <= body.to);
          });
          return signAll('note-photos', inRange, 'path').then(function (m) {
            var days = {};
            all.forEach(function (p) { days[p.lesson_date] = 1; });
            return {
              ok: true, total: all.length, days: Object.keys(days).length, limit: 10,
              today_count: all.filter(function (p) { return p.uploaded_on === t; }).length,
              photos: inRange.map(function (p) { return { id: p.id, lesson_date: p.lesson_date, width: p.width, height: p.height, url: m[p.path] || '' }; })
                .filter(function (p) { return p.url; })
            };
          });
        });
    },

    /* 복습테스트 — 학생 화면에서 보이는 그대로 (사진은 서명 주소로) */
    review: function () {
      return sb().rpc('staff_review_status', { p_student: cur.sid }).then(unwrap).then(function (d) {
        if (!d || !d.ok) return d;
        /* 시험 여러 개 · 사진 여러 장 (migration-025) — 함수(review-test)가 학생에게 주는 모양과 같게 photo_url · photo_urls */
        var items = [d.submission].concat(d.recent || [], (d.tests || []).map(function (t) { return t.submission; })).filter(Boolean);
        var all = [];
        items.forEach(function (x) { (x.photos || (x.photo_path ? [x.photo_path] : [])).forEach(function (p) { if (all.indexOf(p) === -1) all.push(p); }); });
        return signAll('review-photos', all.map(function (p) { return { p: p }; }), 'p').then(function (m) {
          items.forEach(function (x) {
            x.photo_url = x.photo_path ? (m[x.photo_path] || '') : '';
            x.photo_urls = (x.photos || (x.photo_path ? [x.photo_path] : [])).map(function (p) { return m[p] || ''; }).filter(Boolean);
            delete x.photo_path; delete x.photos;
          });
          return d;
        });
      });
    },

    /* 배부 자료 · 과제 파일 내려받기 */
    fileUrl: function (id) {
      return sb().from('class_files').select('path,name,ext').eq('id', id).then(function (r) {
        var f = r.data && r.data[0];
        if (!f) return { ok: false, message: '파일을 찾을 수 없습니다.' };
        return sb().storage.from('class-files').createSignedUrl(f.path, 120, { download: f.name + '.' + f.ext }).then(function (x) {
          return x.data ? { ok: true, url: x.data.signedUrl } : { ok: false, message: '열지 못했습니다.' };
        });
      });
    },

    /* 앱 과제 — 앱 서버는 학부모 링크 코드로만 받는다 (서버 사이에서만 쓰이고 화면 주소에는 안 나온다) */
    app: function () {
      var code = Store.linkOf(cur.sid).hubCode;
      if (!code) return Promise.resolve({ ok: false, reason: 'nolink' });
      return fetch(CONFIG.supabase.url + '/functions/v1/' + CONFIG.appFunction + '?code=' + encodeURIComponent(code), { headers: { apikey: CONFIG.supabase.key } })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
    }
  };
  window.HubPreview = bridge;

  /* ---------- 미리보기 창 ---------- */

  function el() { return document.getElementById('pvOverlay'); }

  function build() {
    if (el()) return el();
    var o = document.createElement('div');
    o.id = 'pvOverlay';
    o.className = 'pv-overlay';
    o.hidden = true;
    o.innerHTML =
      '<div class="pv-bar">' +
        '<div class="pv-bar__title" id="pvTitle"></div>' +
        '<div class="pv-seg" role="group" aria-label="어느 링크로 볼지">' +
          '<button type="button" class="btn btn--sm" data-pvset="parent">학부모 화면</button>' +
          '<button type="button" class="btn btn--sm" data-pvset="student">학생 화면</button>' +
        '</div>' +
        '<label class="chk-inline"><input type="checkbox" id="pvPhone"> 휴대폰 크기로 보기</label>' +
        '<button type="button" class="btn" id="pvClose">닫기</button>' +
      '</div>' +
      '<div class="pv-frame-wrap" id="pvWrap"><iframe class="pv-frame" id="pvFrame" title="러닝노트 미리보기"></iframe></div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pvset]');
      if (b) { cur.role = b.dataset.pvset; bridge.view = ''; bridge.arg = ''; load(); }
      if (e.target.id === 'pvClose') close();
    });
    o.querySelector('#pvPhone').addEventListener('change', function (e) {
      cur.phone = e.target.checked;
      o.querySelector('#pvWrap').classList.toggle('is-phone', cur.phone);
    });
    return o;
  }

  function load() {
    var o = build(), s = student();
    o.querySelector('#pvTitle').innerHTML = '미리보기 — 조교 화면 · <b>' + esc(s ? s.name : '') + '</b> 학생 · ' +
      (cur.role === 'student' ? '<span class="pv-tag pv-tag--student">학생 링크로 열었을 때</span>' : '<span class="pv-tag pv-tag--parent">학부모 링크로 열었을 때</span>');
    Array.prototype.forEach.call(o.querySelectorAll('[data-pvset]'), function (b) {
      b.classList.toggle('btn--primary', b.dataset.pvset === cur.role);
    });
    o.querySelector('#pvFrame').src = '../me/index.html?preview=1&v=' + encodeURIComponent(CONFIG.version) + '&t=' + Date.now();
  }

  /* view · arg — 처음 열 화면 (주차 현황 [보기] = 'report', 그 주 시작일) */
  function open(sid, role, view, arg) {
    if (!sid) return;
    if (window.Writer && Writer.flush) Writer.flush();
    bridge.view = view || '';
    bridge.arg = arg || '';
    cur.sid = sid;
    cur.role = role === 'student' ? 'student' : 'parent';
    var o = build();
    o.hidden = false;
    document.body.classList.add('pv-open');
    load();
  }

  function close() {
    var o = el();
    if (!o) return;
    o.hidden = true;
    o.querySelector('#pvFrame').src = 'about:blank';
    document.body.classList.remove('pv-open');
  }

  /* 명단 · ② 작성 · ④ 발송의 [학부모 화면] [학생 화면] 단추 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pv]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    var holder = b.closest('[data-id]');
    open(b.dataset.sid || (holder && holder.dataset.id), b.dataset.pv);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el() && !el().hidden) close(); });

  window.Preview = { open: open, close: close };

})();
