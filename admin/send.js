/* ============================================================
   send.js — ④ 발송 탭

   공개한 레포트를 학부모에게 알린다.
   문자에 들어가는 주소는 학생 개인 페이지(/me/#코드/report)다.
   매주 같은 링크이고, 열면 그 주 레포트가 바로 펼쳐진다.

   유료 문자 서비스는 쓰지 않는다.
   sms: 링크로 이 기기의 문자 앱을 열고, 안 열릴 때를 위해 복사 버튼을 함께 둔다.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };

  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function students() { return (window.UI ? UI.activeStudents() : Store.activeStudents()); }
  function copyText(t) { return UI.copyText(t); }
  function linkFor(s) { return Store.hubUrl(Store.linkOf(s.id).hubCode, 'report'); }

  var DEFAULT_GREETING = '안녕하세요 {호칭}, 마라톤국어입니다. 이번 주 {이름} 학생 레포트 보내드립니다^^\n{링크}';

  var state = {
    week: '',
    weekEnd: '',
    weeks: [],
    weekEnds: {},            /* 주차 시작일 → 종료일. 주차 칸에 기간을 적는 데 쓴다 */
    published: {},
    sent: {},
    greeting: DEFAULT_GREETING,
    filter: 'all',
    classFilter: ''
  };

  /* ============================================================
     기기 판별과 sms: 링크

     iOS 는 sms:번호&body=, 안드로이드·윈도우는 sms:번호?body= 다.
     한 글자 차이로 문구가 안 채워지거나 앱이 아예 안 열린다.
     ============================================================ */

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    /* 아이패드는 데스크톱 모드에서 Mac 으로 보인다 */
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function smsHref(number, body) {
    var digits = Store.phoneDigits(number);
    var sep = isIOS() ? '&' : '?';
    return 'sms:' + digits + sep + 'body=' + encodeURIComponent(body);
  }

  /* ============================================================
     문구 만들기
     ============================================================ */

  function messageFor(student, url) {
    return String(state.greeting || DEFAULT_GREETING)
      .split('{호칭}').join(Store.parentTitleOf(student))
      .split('{이름}').join(student.name || '')
      .split('{링크}').join(url || '');
  }

  /* ============================================================
     보냄 표시
     ============================================================ */

  function whoami() { return UI.whoami(); }

  function markSent(studentId, via) {
    state.sent[studentId] = { at: new Date().toISOString(), via: via, by: whoami() };
    updateRow(studentId);
    updateProgress();

    DB.markSent(state.week, studentId, via, whoami()).catch(function (e) {
      toast('보냄 표시를 저장하지 못했습니다 — ' + e.message, 'bad');
    });

    /* 로컬 사본도 맞춰 둔다 */
    var all = Store.read(Store.KEYS.sent, {});
    all[state.week] = all[state.week] || {};
    all[state.week][studentId] = state.sent[studentId];
    Store.writeLocal(Store.KEYS.sent, all);
  }

  function unmarkSent(studentId) {
    delete state.sent[studentId];
    updateRow(studentId);
    updateProgress();

    DB.unmarkSent(state.week, studentId).catch(function (e) {
      toast('되돌리지 못했습니다 — ' + e.message, 'bad');
    });

    var all = Store.read(Store.KEYS.sent, {});
    if (all[state.week]) {
      delete all[state.week][studentId];
      Store.writeLocal(Store.KEYS.sent, all);
    }
  }

  /* ============================================================
     목록
     ============================================================ */

  function rowsForWeek() {
    var byId = {};
    students().forEach(function (s) { byId[s.id] = s; });

    return Object.keys(state.published).map(function (sid) {
      var s = byId[sid];
      if (!s) return null;                       /* 지워졌거나 퇴원한 학생 */
      return { student: s, url: linkFor(s), sent: !!state.sent[sid] };
    }).filter(Boolean).sort(function (a, b) {
      var c = (a.student.className || '').localeCompare(b.student.className || '', 'ko');
      if (c !== 0) return c;
      return (a.student.name || '').localeCompare(b.student.name || '', 'ko');
    });
  }

  function rowHtml(r) {
    var s = r.student;
    var phones = Store.phonesOf(s);

    var phoneText = phones.length
      ? phones.map(function (p) { return p.label + ' ' + Store.phoneFormat(p.number); }).join(' · ')
      : '번호 없음';

    var hasLink = !!r.url;
    var canSms = phones.length > 0 && hasLink;

    return '' +
      '<div class="send-row' + (r.sent ? ' is-sent' : '') + '" data-id="' + s.id + '">' +
        '<div class="send-row__top">' +
          '<span class="send-row__name"></span>' +
          '<span class="send-row__cls"></span>' +
          '<span class="send-row__badge">' + (r.sent ? '보냄' : '미발송') + '</span>' +
        '</div>' +
        '<div class="send-row__phone"></div>' +
        (hasLink ? '' : '<div class="send-row__warn">개인 링크가 없습니다 — ① 명단에서 발급해 주세요</div>') +
        '<div class="send-row__acts">' +
          '<button class="btn btn--sm btn--primary" data-act="sms"' + (canSms ? '' : ' disabled') + '>' +
            '문자 보내기</button>' +
          (phones.length ? '<button class="btn btn--sm" data-act="copyphone">번호</button>' : '') +
          '<button class="btn btn--sm" data-act="copymsg"' + (hasLink ? '' : ' disabled') + '>문구</button>' +
          '<button class="btn btn--sm" data-act="copykakao"' + (hasLink ? '' : ' disabled') + '>카톡용</button>' +
          (navigator.share && hasLink ? '<button class="btn btn--sm" data-act="share">공유</button>' : '') +
          '<button class="btn btn--sm btn--ghost" data-act="undo"' + (r.sent ? '' : ' hidden') + '>' +
            '되돌리기</button>' +
        '</div>' +
      '</div>';
  }

  function fillRow(el, r) {
    var s = r.student;
    var phones = Store.phonesOf(s);
    el.querySelector('.send-row__name').textContent = s.name || '';
    el.querySelector('.send-row__cls').textContent = s.className || '';
    el.querySelector('.send-row__phone').textContent = phones.length
      ? phones.map(function (p) { return p.label + ' ' + Store.phoneFormat(p.number); }).join('  ·  ')
      : '번호 없음 — 명단에서 넣어 주세요';
  }

  function renderList() {
    var host = $('#sendList');
    host.textContent = '';

    if (!state.week) {
      host.innerHTML = '<div class="empty-state">아직 공개한 레포트가 없습니다.<br>' +
                       '③ 공개 탭에서 먼저 공개해 주세요.</div>';
      return;
    }

    var rows = rowsForWeek();
    refreshClassOptions(rows);

    var shown = rows.filter(function (r) {
      if (state.classFilter && (r.student.className || '') !== state.classFilter) return false;
      return state.filter === 'all' ? true
           : state.filter === 'todo' ? !r.sent
           : r.sent;
    });

    if (!rows.length) {
      host.innerHTML = '<div class="empty-state">이 주차에 공개한 레포트가 없습니다.</div>';
      return;
    }
    if (!shown.length) {
      host.innerHTML = '<div class="empty-state">' +
        (state.filter === 'todo' ? '<b>모두 보냈습니다.</b>' : '아직 보낸 학생이 없습니다.') + '</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    shown.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.innerHTML = rowHtml(r);
      var el = wrap.firstElementChild;
      fillRow(el, r);
      frag.appendChild(el);
    });
    host.appendChild(frag);
  }

  /* 이 주차에 공개한 학생들의 반만 고를 수 있게 한다.
     반이 5~6개면 전체 목록에서 찾는 것보다 반으로 먼저 좁히는 게 빠르다. */
  function refreshClassOptions(rows) {
    var sel = $('#sendClassFilter');
    var counts = {};
    rows.forEach(function (r) {
      var c = (r.student.className || '').trim() || '(반 없음)';
      counts[c] = (counts[c] || 0) + 1;
    });

    var names = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    var keep = state.classFilter;

    sel.textContent = '';
    var all = document.createElement('option');
    all.value = ''; all.textContent = '전체 반 (' + rows.length + ')';
    sel.appendChild(all);

    names.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n + ' (' + counts[n] + ')';
      sel.appendChild(o);
    });

    /* 고르고 있던 반이 이 주차에 없으면 전체로 되돌린다 */
    if (keep && names.indexOf(keep) === -1) state.classFilter = '';
    sel.value = state.classFilter;
    sel.hidden = names.length < 2;
  }

  /* 한 줄만 다시 그린다. 40명을 매번 다시 그리지 않는다. */
  function updateRow(studentId) {
    var el = $('.send-row[data-id="' + studentId + '"]', $('#sendList'));
    if (!el) return;
    var isSent = !!state.sent[studentId];

    el.classList.toggle('is-sent', isSent);
    el.querySelector('.send-row__badge').textContent = isSent ? '보냄' : '미발송';
    var undo = el.querySelector('[data-act="undo"]');
    if (undo) undo.hidden = !isSent;

    /* 필터가 걸려 있으면 조건에 안 맞는 줄은 사라져야 한다 */
    if ((state.filter === 'todo' && isSent) || (state.filter === 'done' && !isSent)) {
      el.remove();
      if (!$('#sendList').children.length) renderList();
    }
  }

  function updateProgress() {
    var rows = rowsForWeek();
    var scope = state.classFilter
      ? rows.filter(function (r) { return (r.student.className || '') === state.classFilter; })
      : rows;
    var done = scope.filter(function (r) { return r.sent; }).length;

    $('#sendProgress').textContent = scope.length
      ? (state.classFilter ? state.classFilter + ' ' : '') + done + ' / ' + scope.length + '명 보냄'
      : '';
  }

  /* ============================================================
     동작
     ============================================================ */

  $('#sendList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    var row = btn.closest('.send-row');
    if (!row) return;

    var sid = row.dataset.id;
    var s = students().find(function (x) { return x.id === sid; });
    if (!s) return;

    if (!state.published[sid]) return;
    var url = linkFor(s);
    if (!url && btn.dataset.act !== 'undo' && btn.dataset.act !== 'copyphone') {
      toast('개인 링크가 없습니다. ① 명단에서 발급해 주세요', 'bad');
      return;
    }

    var msg = messageFor(s, url);
    var act = btn.dataset.act;

    if (act === 'undo') { unmarkSent(sid); toast('되돌렸습니다'); return; }

    if (act === 'copyphone') {
      var phones = Store.phonesOf(s);
      pickPhone(s, phones, function (num) {
        copyText(Store.phoneFormat(num))
          .then(function () { toast('번호를 복사했습니다', 'good'); })
          .catch(function (e) { toast(e.message, 'bad'); });
      });
      return;
    }

    if (act === 'copymsg' || act === 'copykakao') {
      copyText(msg).then(function () {
        markSent(sid, act === 'copykakao' ? 'kakao' : 'copy');
        toast((act === 'copykakao' ? '카톡용 문구를' : '문구를') + ' 복사했습니다', 'good');
      }).catch(function (e) { toast(e.message, 'bad'); });
      return;
    }

    if (act === 'share') {
      navigator.share({ text: msg }).then(function () {
        markSent(sid, 'share');
      }).catch(function () { /* 사용자가 취소한 경우 — 표시하지 않는다 */ });
      return;
    }

    if (act === 'sms') {
      pickPhone(s, Store.phonesOf(s), function (num) {
        /* 문자 앱으로 넘어가면 이 화면을 떠나므로 먼저 표시해 둔다 */
        markSent(sid, 'sms');
        location.href = smsHref(num, msg);
      });
    }
  });

  /* 번호가 하나면 바로, 둘이면 고르게 한다 */
  function pickPhone(student, phones, done) {
    if (!phones.length) { toast('저장된 번호가 없습니다', 'bad'); return; }
    if (phones.length === 1) { done(phones[0].number); return; }

    var modal = $('#phonePickModal');
    $('#phonePickTitle').textContent = student.name + ' 학생 — 번호 고르기';

    var host = $('#phonePickList');
    host.textContent = '';
    phones.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn phone-pick__btn';
      b.innerHTML = '<span class="phone-pick__label"></span><span class="phone-pick__num num"></span>';
      b.querySelector('.phone-pick__label').textContent = p.label;
      b.querySelector('.phone-pick__num').textContent = Store.phoneFormat(p.number);
      b.addEventListener('click', function () {
        modal.close();
        done(p.number);
      });
      host.appendChild(b);
    });
    modal.showModal();
  }

  $('#btnPhonePickCancel').addEventListener('click', function () { $('#phonePickModal').close(); });

  $('#sendWeek').addEventListener('change', function (e) {
    state.week = e.target.value;
    loadWeek();
  });

  $('#sendFilter').addEventListener('change', function (e) {
    state.filter = e.target.value;
    renderList();
    updateProgress();
  });

  $('#sendClassFilter').addEventListener('change', function (e) {
    state.classFilter = e.target.value;
    renderList();
    updateProgress();
  });

  $('#btnSendRefresh').addEventListener('click', function () {
    refresh().then(function () { toast('다시 읽었습니다'); });
  });

  /* ============================================================
     인사말 고치기
     ============================================================ */

  var greetModal = $('#greetingModal');

  $('#btnEditGreeting').addEventListener('click', function () {
    $('#greetingText').value = state.greeting;
    $('#greetingError').classList.remove('is-on');
    updateGreetPreview();
    greetModal.showModal();
  });

  $('#btnGreetingCancel').addEventListener('click', function () { greetModal.close(); });

  $('#greetingText').addEventListener('input', updateGreetPreview);

  function updateGreetPreview() {
    var sample = students()[0] || { name: '김하늘', parentTitle: '어머님' };
    var text = $('#greetingText').value || '';
    var preview = text
      .split('{호칭}').join(Store.parentTitleOf(sample))
      .split('{이름}').join(sample.name || '김하늘')
      .split('{링크}').join(CONFIG.siteUrl + '/me/#예시코드/report');
    $('#greetingPreview').textContent = preview;
  }

  $('#greetingForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('#greetingText').value.trim();
    var err = $('#greetingError');

    if (!text) {
      err.textContent = '인사말을 입력해 주세요.';
      err.classList.add('is-on');
      return;
    }
    if (text.indexOf('{링크}') === -1) {
      err.textContent = '{링크} 가 빠졌습니다. 개인 페이지 주소가 들어갈 자리가 필요합니다.';
      err.classList.add('is-on');
      return;
    }

    state.greeting = text;
    greetModal.close();

    DB.saveSetting('greeting', { sms: text, kakao: text }, whoami())
      .then(function () { toast('인사말을 저장했습니다. 모든 기기에 반영됩니다', 'good'); })
      .catch(function (e2) { toast('저장하지 못했습니다 — ' + e2.message, 'bad'); });
  });

  /* ============================================================
     불러오기
     ============================================================ */

  function loadWeek() {
    if (!state.week) { renderList(); updateProgress(); return Promise.resolve(); }

    return DB.weekSendData(state.week).then(function (d) {
      state.published = d.published;
      state.sent = d.sent;
      state.weekEnd = d.weekEnd;
      if (d.weekEnd) {
        state.weekEnds[state.week] = d.weekEnd;
        renderWeekOptions();          /* 기간을 알게 됐으니 주차 칸을 다시 적는다 */
      }
      renderList();
      updateProgress();
    }).catch(function (e) {
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  function renderWeekOptions() {
    var sel = $('#sendWeek');
    sel.textContent = '';

    if (!state.weeks.length) {
      var o = document.createElement('option');
      o.value = ''; o.textContent = '공개한 주차 없음';
      sel.appendChild(o);
      return;
    }

    state.weeks.forEach(function (wk) {
      var o = document.createElement('option');
      o.value = wk;
      /* 보내기 전에 기간을 눈으로 확인할 수 있게 끝 날짜까지 적는다.
         예전에는 시작일만 보여서 종료일이 틀려도 알 수 없었다. */
      var end = state.weekEnds[wk] || '';
      o.textContent = end
        ? Store.dateWithDow(wk) + ' ~ ' + Store.dateWithDow(end) +
          ' · ' + Store.daysBetween(wk, end) + '일'
        : Store.shortDate(wk) + ' 주차';
      sel.appendChild(o);
    });
    sel.value = state.week;
  }

  function refresh() {
    return Promise.all([
      DB.publishedWeeks(),
      DB.getSetting('greeting')
    ]).then(function (res) {
      state.weeks = res[0] || [];

      var g = res[1];
      state.greeting = (g && (g.sms || g.kakao)) || DEFAULT_GREETING;

      if (!state.week || state.weeks.indexOf(state.week) === -1) {
        /* 작성 중인 주차가 공개돼 있으면 그걸, 아니면 가장 최근 것 */
        var draft = Store.read(Store.KEYS.draft, null);
        var prefer = draft && draft.weekStart;
        state.week = (prefer && state.weeks.indexOf(prefer) !== -1) ? prefer : (state.weeks[0] || '');
      }

      renderWeekOptions();
      return loadWeek();
    }).catch(function (e) {
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  }

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 3) refresh();
  });

  window.addEventListener('jt:loaded', function () {
    if (!$('#panel-send').hidden) refresh();
  });

  /* 기기마다 형식이 다른 sms 링크와 문구 조립은 여기서 가장 깨지기 쉽다.
     밖에서 직접 확인할 수 있게 내보낸다. */
  window.Send = {
    smsHref: smsHref,
    messageFor: messageFor,
    isIOS: isIOS,
    setGreeting: function (t) { state.greeting = t; },
    getGreeting: function () { return state.greeting; }
  };

})();
