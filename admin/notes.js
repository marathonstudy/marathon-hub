/* ============================================================
   notes.js — 필기 QR · 필기 미제출 · 지금 다시 보내기 · 문의 연락처 (20261031w · migration-049 · 함수 note-remind)

   「오늘」 반 카드 (수업 당일)
     · [필기 QR 띄우기] — 그 반 전용 QR 을 화면 가득 (학생이 찍으면 /s/?note=반 → 로그인돼 있으면 바로, 아니면 이름 + 8자리 로그인 뒤
       러닝노트 「내 필기」 오늘 칸 — 사진 여러 장 · 카메라 바로 찍기). QR 화면에는 「지금 제출 n/전체」만 (학생 이름은 안 보임) · 10초마다
     · 「필기 미제출 n명」 — 누르면 이름(결석 · 번호 없음 표시) · [지금 다시 보내기](안 낸 · 결석 아닌 · 번호 있는 학생 본인에게만)
     · 수업 끝 시각이 비어 있는 반은 작게 「수업 끝 시각을 넣으면 필기 알림을 쓸 수 있어요」
   운영진 문자의 「QR 띄우기」 링크(admin/#qr=반)로 들어오면 그 반 QR 을 바로 띄운다
   [설정] 「문의 연락처(카카오채널 링크)」 — 러닝노트 레포트 맨 아래 [문의하기] 버튼 (비우면 버튼 없이 문구만)
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$;
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function today() { return DDay.today(); }
  function missingFn(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  /* ---------- 반마다 필기 현황 (30초 기억) ---------- */
  var stat = {}, open = {}, off = false;
  function load(cls, force) {
    var c = stat[cls];
    if (off) return Promise.resolve(null);
    if (!force && c && Date.now() - c.at < 30000) return Promise.resolve(c.v);
    return Promise.resolve(sb().rpc('note_status', { p_class: cls, p_day: today() })).then(function (r) {
      if (r.error) { if (missingFn(r.error)) off = true; return null; }
      stat[cls] = { at: Date.now(), v: r.data };
      return r.data;
    }, function () { return null; });
  }

  /* 반 카드 한 줄 (today.js classCardHtml 이 부른다) — 수업 당일만 QR · 미제출 · 끝 시각이 없으면 안내 */
  function cardHtml(c) {
    if (!c || c.name === '(반 없음)' || !c.rows || !c.rows.length) return '';
    var m = Store.metaOf(c.name), lesson = !!(c.next && c.next.dday === 0);
    var hint = !m || !m.end ? '<p class="tdc-note-hint">수업 끝 시각을 넣으면 필기 알림을 쓸 수 있어요 <span class="muted-note">(반 관리 → 수업 설정)</span></p>' : '';
    if (!lesson) return hint;
    return '<div class="tdc-note" data-note-cls="' + esc(c.name) + '">' +
        '<button type="button" class="btn btn--sm tdc-note__qr" data-note-qr="' + esc(c.name) + '">필기 QR 띄우기</button>' +
        '<span class="tdc-note__st" data-note-st="' + esc(c.name) + '">' + stHtml(c.name) + '</span>' +
        (m && m.end ? '<span class="muted-note tdc-note__rm">' + (m.remind ? '필기 알림 ' + esc(m.end) + ' ' + m.min + '분 전' : '필기 알림 꺼짐') + '</span>' : '') +
      '</div>' + (open[c.name] ? missHtml(c.name) : '') + hint;
  }
  function stHtml(cls) {
    var v = stat[cls] && stat[cls].v;
    if (off) return '';
    if (!v) return '<span class="muted-note">필기 확인 중…</span>';
    var miss = (v.missing || []).length;
    if (!v.total) return '';
    return miss ? '<button type="button" class="tdc-note__miss num" data-note-miss="' + esc(cls) + '" aria-expanded="' + !!open[cls] + '">필기 미제출 ' + miss + '명</button>'
      : '<span class="tdc-note__ok num">필기 ' + v.done + '/' + v.total + ' 다 냄 ✓</span>';
  }
  function missHtml(cls) {
    var v = stat[cls] && stat[cls].v;
    if (!v) return '';
    var list = v.missing || [];
    return '<div class="tdc-note__list" data-note-list="' + esc(cls) + '">' +
      '<p class="tdc-note__names">' + (list.length ? list.map(function (x) {
        return '<span class="tdc-note__nm">' + esc(x.name) + (x.absent ? ' <small>결석</small>' : !x.phone ? ' <small>번호 없음</small>' : '') + '</span>';
      }).join('') : '모두 냈습니다') + '</p>' +
      (list.some(function (x) { return !x.absent && x.phone; })
        ? '<button type="button" class="btn btn--sm btn--primary" data-note-send="' + esc(cls) + '">지금 다시 보내기</button><span class="muted-note"> 안 낸 학생 본인에게만 (결석 · 번호 없음 제외 · 학부모에게는 안 감)</span>' : '') +
    '</div>';
  }
  function paint() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-note-st]'), function (el) {
      var cls = el.dataset.noteSt;
      load(cls).then(function () {
        var h = stHtml(cls);
        if (el.innerHTML !== h) el.innerHTML = h;
        var box = document.querySelector('[data-note-list="' + cssq(cls) + '"]');
        if (box) box.outerHTML = missHtml(cls);
      });
    });
  }
  function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function sendNow(cls) {
    UI.confirmAsk('필기 알림', cls + ' — 필기를 안 낸 학생 본인에게 지금 문자를 보냅니다 (결석 · 번호 없음 제외 · 학부모에게는 안 감).', '지금 보내기').then(function (ok) {
      if (!ok) return;
      return sb().functions.invoke('note-remind', { body: { action: 'now', class: cls } }).then(function (r) {
        var d = r && r.data;
        if (r.error || !d || !d.ok) { toast((d && d.message) || '보내지 못했습니다 — note-remind 함수 배포 · 문자 키를 확인해 주세요', 'bad'); return; }
        toast(d.rows ? '필기 알림 ' + d.sent + '통 보냄' + (d.failed ? ' · 실패 ' + d.failed : '') : '보낼 학생이 없습니다', d.failed ? 'bad' : 'good');
        return load(cls, true).then(paint);
      });
    });
  }

  /* ---------- 필기 QR — 화면 가득 · 「지금 제출 n/전체」만 ---------- */
  var QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  var qrLib = null, qrTimer = null, qrCls = '';
  function libLoad() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLib) return qrLib;
    qrLib = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = QR_LIB; s.async = true;
      s.onload = function () { window.qrcode ? res(window.qrcode) : rej(new Error('qr')); };
      s.onerror = function () { qrLib = null; rej(new Error('qr')); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  function qrUrl(cls) { return CONFIG.siteUrl + '/s/?note=' + encodeURIComponent(cls); }
  function openQr(cls) {
    qrCls = cls;
    var m = $('#noteQrModal');
    $('#noteQrTitle').textContent = cls + ' · 오늘 수업 필기';
    $('#noteQrCount').textContent = '지금 제출 —';
    $('#noteQrUrl').textContent = qrUrl(cls);
    $('#noteQrBox').innerHTML = '<p class="muted-note">QR 만드는 중…</p>';
    if (!m.open) m.showModal();
    libLoad().then(function (qrcode) {
      var q = qrcode(0, 'M');
      q.addData(qrUrl(cls));
      q.make();
      $('#noteQrBox').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    }).catch(function () {
      $('#noteQrBox').innerHTML = '<p class="panel__hint">QR 을 만들지 못했습니다 (인터넷 연결 확인). 아래 주소를 화면에 보여 주세요.</p>';
    });
    count();
    clearInterval(qrTimer);
    qrTimer = setInterval(count, 10000);
  }
  function count() {
    if (!qrCls) return;
    load(qrCls, true).then(function (v) {
      $('#noteQrCount').textContent = v && v.total ? '지금 제출 ' + v.done + '/' + v.total : '지금 제출 —';
    });
  }
  function closeQr() { clearInterval(qrTimer); qrTimer = null; qrCls = ''; paint(); }

  /* ---------- 문의 연락처 (설정 창) ---------- */
  function loadContact() {
    var inp = $('#tdSetContact');
    if (!inp) return;
    sb().from('app_settings').select('value').eq('key', 'contact').then(function (r) {
      inp.value = (!r.error && r.data && r.data[0] && r.data[0].value && r.data[0].value.kakao) || '';
    }, function () {});
  }
  function saveContact() {
    var v = ($('#tdSetContact').value || '').trim();
    sb().rpc('contact_set', { p_url: v }).then(function (r) {
      if (r.error) { toast(missingFn(r.error) ? 'migration-049 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); return; }
      toast(v ? '문의 연락처를 저장했습니다 — 러닝노트 레포트 맨 아래 [문의하기]' : '문의 연락처를 비웠습니다 — 문구만 보입니다', 'good');
    });
  }

  document.addEventListener('click', function (e) {
    var q = e.target.closest('[data-note-qr]');
    if (q) { openQr(q.dataset.noteQr); return; }
    var mi = e.target.closest('[data-note-miss]');
    if (mi) {
      var cls = mi.dataset.noteMiss;
      open[cls] = !open[cls];
      var card = mi.closest('[data-note-cls]');
      var box = document.querySelector('[data-note-list="' + cssq(cls) + '"]');
      if (box) box.remove();
      if (open[cls] && card) card.insertAdjacentHTML('afterend', missHtml(cls));
      mi.setAttribute('aria-expanded', String(!!open[cls]));
      return;
    }
    var sn = e.target.closest('[data-note-send]');
    if (sn) { sendNow(sn.dataset.noteSend); return; }
    if (e.target.closest('#noteQrClose')) { $('#noteQrModal').close(); return; }
    if (e.target.closest('#tdSetContactSave')) saveContact();
  });
  $('#noteQrModal').addEventListener('close', closeQr);
  $('#tdSettingsBtn').addEventListener('click', loadContact);

  /* 운영진 문자의 「QR 띄우기」 링크 — admin/#qr=반 */
  function fromHash() {
    var m = /(?:^#|&)qr=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    var cls = decodeURIComponent(m[1]);
    try { history.replaceState(null, '', location.pathname); } catch (x) {}
    if (cls) setTimeout(function () { openQr(cls); }, 300);
  }
  window.addEventListener('jt:loaded', fromHash);

  window.Notes = { cardHtml: cardHtml, paint: paint, openQr: openQr, qrUrl: qrUrl, status: load };
})();
