/* ============================================================
   hwstat.js — 수업 20분 전 운영진 과제 현황 문자 (20261108a · migration-069 · 함수 note-remind)

   「오늘」 반 카드 (수업 날 · 시작 시각이 있는 반 · 종강 반 제외)
     「과제 현황 문자 09:10 보냄 · 운영진 3명」 (보내기 전에는 「09:10 보낼 예정」) · [미리보기] [지금 운영진에게 보내기]
     미리보기 = 실제로 나갈 글 그대로(넘치면 (1/2) (2/2)) + 받는 사람(원장 · 조교 · 번호 뒤 4자리 · 번호 없음 · 받기 끔)
     지금 보내기 = 그 반 하나 · 받기 켠 운영진에게만 (학생 · 학부모에게는 안 감) · 오늘 이미 보냈으면 한 번 더 묻는다
   받기 켜기/끄기 · 상담 기준(기본 60%) — 더보기 → 운영진 (staff.js)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function missingFn(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }
  function hm2min(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function min2hm(n) { n = ((n % 1440) + 1440) % 1440; return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function nowMin() { var d = new Date(Date.now() + 9 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  var LEAD = 20;                                  /* 수업 시작 몇 분 전 (서버와 같다) */
  function dueAt(m) { var s = hm2min(m && m.start); return s == null ? '' : min2hm(s - LEAD); }

  /* ---------- 오늘 보낸 것 (30초 기억) ---------- */
  var st = { at: 0, v: null, off: false, busy: null };
  function load(force) {
    if (st.off) return Promise.resolve(null);
    if (!force && st.v && Date.now() - st.at < 30000) return Promise.resolve(st.v);
    if (st.busy) return st.busy;
    st.busy = Promise.resolve(sb().rpc('hw_status_status', { p_day: DDay.today() })).then(function (r) {
      st.busy = null;
      if (r.error) { if (missingFn(r.error)) st.off = true; return null; }
      st.v = r.data || {}; st.at = Date.now();
      return st.v;
    }, function () { st.busy = null; return null; });
    return st.busy;
  }

  /* 「과제 현황 문자 09:10 보냄 · 운영진 3명 · 번호 없음 1」 */
  function stText(cls) {
    var x = st.v && st.v[cls];
    var m = Store.metaOf(cls) || {};
    if (!x) {
      var s = hm2min(m.start);
      if (s == null) return '';
      return nowMin() < s ? '과제 현황 문자 ' + dueAt(m) + ' 보낼 예정' : '과제 현황 문자 안 보냄';
    }
    var bits = ['과제 현황 문자 ' + x.at + ' 보냄' + (x.manual ? (x.by ? '(' + x.by + ')' : '(직접)') : '')];
    if (x.people) bits.push('운영진 ' + x.people + '명');
    if (x.pending) bits.push('보내는 중 ' + x.pending);
    if (x.failed) bits.push('실패 ' + x.failed + '명');
    if (x.nophone) bits.push('번호 없음 ' + x.nophone + '명');
    return bits.join(' · ');
  }
  function lineInner(cls) {
    var x = st.v && st.v[cls];
    return '<span class="tdc-hws__t num' + (x ? ' is-sent' : '') + '" data-hws-st="' + esc(cls) + '">' + esc(stText(cls)) + '</span>' +
      '<button type="button" class="tdc-time__chg" data-hws-view="' + esc(cls) + '">미리보기</button>' +
      '<button type="button" class="tdc-time__chg" data-hws-send="' + esc(cls) + '">지금 운영진에게 보내기</button>';
  }
  /* 반 카드 한 줄 (today.js 가 부른다) — 수업 날 · 시작 시각이 있는 반만 */
  function cardHtml(c) {
    if (!c || c.name === '(반 없음)' || !c.rows || !c.rows.length || st.off) return '';
    if (!(c.next && c.next.dday === 0)) return '';
    var m = Store.metaOf(c.name);
    if (!m || !m.start) return '';
    return '<div class="tdc-hws" data-hws="' + esc(c.name) + '">' + lineInner(c.name) + '</div>';
  }
  function paint() {
    if (!document.querySelector('[data-hws]')) return;
    load().then(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-hws]'), function (el) {
        if (st.off) { el.remove(); return; }
        var h = lineInner(el.dataset.hws);
        if (el.innerHTML !== h) el.innerHTML = h;
      });
    });
  }

  /* ---------- 미리보기 창 ---------- */
  function dialog() {
    var d = document.getElementById('hwsModal');
    if (d) return d;
    d = document.createElement('dialog');
    d.className = 'modal hws-modal'; d.id = 'hwsModal';
    d.setAttribute('aria-labelledby', 'hwsTitle');
    d.innerHTML =
      '<div class="modal__head"><h2 class="modal__title" id="hwsTitle">과제 현황 문자 미리보기</h2><p class="modal__desc" id="hwsDesc">운영진 전용 — 학생 · 학부모에게는 보내지 않습니다</p></div>' +
      '<div class="modal__body" id="hwsBody"></div>' +
      '<div class="modal__foot"><div class="spacer"></div><button class="btn" type="button" id="hwsClose">닫기</button>' +
        '<button class="btn btn--primary" type="button" id="hwsSend" disabled>지금 운영진에게 보내기</button></div>';
    document.body.appendChild(d);
    d.querySelector('#hwsClose').addEventListener('click', function () { d.close(); });
    d.querySelector('#hwsSend').addEventListener('click', function () { var c = d.dataset.cls; d.close(); send(c); });
    return d;
  }
  function call(cls, dry) {
    return sb().functions.invoke('note-remind', { body: { action: 'hwstat', class: cls, dry: !!dry } }).then(function (r) {
      var d = r && r.data;
      if (r.error || !d) return { ok: false, message: '서버에 연결하지 못했습니다 — note-remind 함수 배포를 확인해 주세요' };
      return d;
    }, function () { return { ok: false, message: '서버에 연결하지 못했습니다' }; });
  }
  function peopleHtml(list) {
    if (!list || !list.length) return '<p class="muted-note">받을 운영진이 없습니다</p>';
    return '<ul class="hws-people">' + list.map(function (p) {
      var why = !p.on ? '받기 끔' : !p.phone ? '번호 없음' : '…' + p.last4;
      return '<li class="hws-person' + (!p.on || !p.phone ? ' is-off' : '') + '">' + esc(p.name) + (p.teacher ? ' <span class="tb-badge tb-badge--paid">원장</span>' : '') +
        ' <small class="num">' + esc(why) + '</small></li>';
    }).join('') + '</ul>';
  }
  function view(cls) {
    var d = dialog();
    d.dataset.cls = cls;
    d.querySelector('#hwsTitle').textContent = cls + ' 과제 현황 문자 미리보기';
    d.querySelector('#hwsBody').innerHTML = '<p class="panel__hint">글을 만드는 중…</p>';
    d.querySelector('#hwsSend').disabled = true;
    if (!d.open) d.showModal();
    call(cls, true).then(function (res) {
      if (d.dataset.cls !== cls) return;
      var p = res && res.preview;
      if (!res.ok || !p) { d.querySelector('#hwsBody').innerHTML = '<p class="panel__hint">' + esc((res && res.message) || '미리보기를 만들지 못했습니다') + '</p>'; return; }
      var n = (p.texts || []).length;
      d.querySelector('#hwsBody').innerHTML =
        (p.sent ? '<p class="hws-sent">오늘 ' + esc(p.sent) + ' 에 이미 보냈습니다</p>' : '') +
        (p.texts || []).map(function (t, i) {
          return (n > 1 ? '<p class="hws-part num">' + (i + 1) + '/' + n + '통</p>' : '') + '<pre class="hws-text">' + esc(t) + '</pre>';
        }).join('') +
        '<h3 class="hws-sub">받는 사람</h3>' + peopleHtml(p.people) +
        '<p class="muted-note">상담 기준 ' + esc(p.cut) + '% — 더보기 → 운영진에서 바꿉니다</p>';
      d.querySelector('#hwsSend').disabled = !(p.people || []).some(function (x) { return x.on && x.phone; });
    });
  }

  /* ---------- 지금 보내기 ---------- */
  var sending = {};
  function send(cls) {
    if (sending[cls]) return;
    var x = st.v && st.v[cls];
    UI.confirmAsk('과제 현황 문자', (x ? '오늘 ' + x.at + ' 에 이미 보냈습니다. ' : '') + cls + ' 과제 현황 명단을 받기 켠 운영진에게 지금 보냅니다 (학생 · 학부모에게는 안 감).', x ? '한 번 더 보내기' : '지금 보내기').then(function (ok) {
      if (!ok) return;
      sending[cls] = true;
      return call(cls, false).then(function (d) {
        sending[cls] = false;
        if (!d.ok) { toast(d.message || '보내지 못했습니다', 'bad'); return; }
        toast(d.rows ? '과제 현황 ' + d.sent + '통 보냄' + (d.failed ? ' · 실패 ' + d.failed : '') : '보낼 운영진이 없습니다 (번호 · 받기 설정을 확인해 주세요)', d.failed || !d.rows ? 'bad' : 'good');
        return load(true).then(paint);
      });
    });
  }

  document.addEventListener('click', function (e) {
    var v = e.target.closest('[data-hws-view]');
    if (v) { view(v.dataset.hwsView); return; }
    var s = e.target.closest('[data-hws-send]');
    if (s) { send(s.dataset.hwsSend); return; }
  });

  window.HwStat = { cardHtml: cardHtml, paint: paint, status: load, stText: stText, dueAt: dueAt };
})();
