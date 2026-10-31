/* ============================================================
   notes.js — 반 카드 수업 시각 · 필기 미제출 · 지금 다시 보내기 · 문의 연락처 (20261031w · 20261101f · migration-049 · 053 · 함수 note-remind)

   「오늘」 반 카드
     · 「수업 토 18:30~22:00 · 수업 전 문자 15:30 켜짐 · 필기·복습 문자 21:55 켜짐 [바꾸기]」 한 줄 — [바꾸기]를 누르면 그 자리에서
       시작 · 끝 시각 · 수업 전 문자 켜기/끄기 · 몇 시간 전(기본 3시간) · 필기·복습 문자 켜기/끄기 · 끝나기 몇 분 전(기본 5분) · 종강일을 고치고 저장
       (class_meta_set · class_pre_set · 반 관리 → 수업 설정과 같은 값 · migration-056)
     · 수업 전 예고를 보낸 날 — 그 아래 작게 「15:30 보냄 11명(다 냄 5 · 일부 4 · 밀림 2)」 (pre_remind_status · 20261101j)
       시각이 비어 있으면 눈에 띄는 [수업 시각 넣기] (보라 테두리)
     · 「필기 미제출 n명」 — 수업 날 · 끝나기 n분 전(기본 5분)부터 그날 밤까지만 (수업 시작 전에는 안 보임)
       누르면 이름(결석 · 번호 없음 표시) · [지금 다시 보내기](안 낸 · 결석 아닌 · 번호 있는 학생 본인에게만)
     · 필기 QR 화면은 없앴다 (20261101f) — 학생은 문자의 링크나 러닝노트 「내 필기」로 올린다
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

  /* ---------- 수업 전 예고 — 오늘 보낸 것 (30초 기억 · migration-056) ---------- */
  var preSt = { at: 0, v: null, off: false, busy: null };
  function loadPre(force) {
    if (preSt.off) return Promise.resolve(null);
    if (!force && preSt.v && Date.now() - preSt.at < 30000) return Promise.resolve(preSt.v);
    if (preSt.busy) return preSt.busy;
    preSt.busy = Promise.resolve(sb().rpc('pre_remind_status', { p_day: today() })).then(function (r) {
      preSt.busy = null;
      if (r.error) { if (missingFn(r.error)) preSt.off = true; return null; }
      preSt.v = r.data || {}; preSt.at = Date.now();
      return preSt.v;
    }, function () { preSt.busy = null; return null; });
    return preSt.busy;
  }
  /* 「15:30 보냄 11명(다 냄 5 · 일부 4 · 밀림 2)」 · 0 인 구간은 빼고 · 실패가 있으면 「· 실패 n」 (migration-058 · 20261101l)
     058 전(구간 없음)이면 「(밀린 n명)」 */
  function preHtml(cls) {
    var x = preSt.v && preSt.v[cls];
    if (!x || !(x.n || x.failed)) return '';
    var parts = [['all', '다 냄'], ['part', '일부'], ['low', '밀림'], ['none', '과제 없음']].filter(function (b) { return x[b[0]]; }).map(function (b) { return b[1] + ' ' + x[b[0]]; });
    var why = 'all' in x ? (parts.length ? '(' + parts.join(' · ') + ')' : '') : (x.missed ? '(밀린 ' + x.missed + '명)' : '');
    return '<small class="tdc-pre num">' + esc(x.at) + ' 보냄 ' + x.n + '명' + why + (x.failed ? ' · 실패 ' + x.failed : '') + '</small>';
  }

  /* ---------- 수업 시각 한 줄 · 그 자리에서 바꾸기 ---------- */
  var DOWS = ['일', '월', '화', '수', '목', '금', '토'];
  var editing = {};
  function hm2min(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function min2hm(n) { n = ((n % 1440) + 1440) % 1440; return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function mdOf(iso) { return iso ? (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) : ''; }
  function dowOf(cls) { var s = Store.schedOf(cls); return s && s.dow != null && s.dow !== '' ? DOWS[+s.dow] || '' : ''; }
  /* 수업 전 문자 보내는 시각 — 시작 시각 − n시간 (migration-056 · 기본 3시간 · 058) */
  function preAt(m) { var s = hm2min(m && m.start); return s == null ? '' : min2hm(s - 60 * (m.preH || 3)); }
  /* 필기 문자 보내는 시각 — 끝 시각 − n분 */
  function remindAt(m) { var e = hm2min(m && m.end); return e == null ? '' : min2hm(e - (m.min || 5)); }
  /* 지금 (한국 시각 · 분) */
  function nowMin() { var d = new Date(Date.now() + 9 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  /* 「필기 미제출」을 보일 때 — 수업 날 · 끝나기 n분 전부터 그날 밤까지 (끝 시각이 없으면 안 보임) */
  function showMissing(c, m) {
    if (!(c.next && c.next.dday === 0) || !m || !m.end) return false;
    var e = hm2min(m.end);
    return nowMin() >= e - (m.min || 5);
  }
  function timeLine(c, m) {
    var has = !!(m && m.start && m.end);
    if (!has) {
      return '<div class="tdc-time tdc-time--empty"><button type="button" class="btn btn--sm tdc-time__add" data-note-edit="' + esc(c.name) + '">수업 시각 넣기</button>' +
        '<span class="muted-note">넣으면 필기·복습 문자를 쓸 수 있어요</span></div>';
    }
    var d = dowOf(c.name);
    return '<div class="tdc-time"><span class="tdc-time__t num">수업 ' + (d ? esc(d) + ' ' : '') + esc(m.start + '~' + m.end) + '</span>' +
      (m.preSql === false ? '' : '<span class="tdc-time__rm tdc-time__pre' + (m.pre ? ' is-on' : '') + '"> · 수업 전 문자 ' + (m.pre ? esc(preAt(m)) + ' 켜짐' : '꺼짐') + '</span>') +
      '<span class="tdc-time__rm' + (m.remind ? ' is-on' : '') + '"> · 필기·복습 문자 ' + (m.remind ? esc(remindAt(m)) + ' 켜짐' : '꺼짐') + '</span>' +
      '<button type="button" class="tdc-time__chg" data-note-edit="' + esc(c.name) + '">바꾸기</button></div>';
  }
  function editHtml(c, m) {
    m = m || {};
    var k = esc(c.name);
    return '<div class="tdc-tedit" data-note-form="' + k + '">' +
      '<div class="tdc-tedit__row">' +
        '<label class="tdc-tedit__f"><span>시작</span><input type="time" class="input" data-tf="start" value="' + esc(m.start || '') + '" step="300"></label>' +
        '<label class="tdc-tedit__f"><span>끝</span><input type="time" class="input" data-tf="end" value="' + esc(m.end || '') + '" step="300"></label>' +
      '</div>' +
      '<div class="tdc-tedit__row">' +
        '<label class="tdc-tedit__chk"><input type="checkbox" data-tf="pre"' + (m.pre || !m.start ? ' checked' : '') + '> 수업 전 문자 켜기</label>' +
        '<label class="tdc-tedit__f tdc-tedit__f--min"><span>시작</span><input type="number" class="input" data-tf="preH" inputmode="numeric" min="1" max="12" value="' + esc(m.preH || 3) + '"><span>시간 전</span></label>' +
      '</div>' +
      '<div class="tdc-tedit__row">' +
        '<label class="tdc-tedit__chk"><input type="checkbox" data-tf="remind"' + (m.remind || !m.end ? ' checked' : '') + '> 필기·복습 문자 켜기</label>' +
        '<label class="tdc-tedit__f tdc-tedit__f--min"><span>끝나기</span><input type="number" class="input" data-tf="min" inputmode="numeric" min="1" max="60" value="' + esc(m.min || 5) + '"><span>분 전</span></label>' +
      '</div>' +
      '<label class="tdc-tedit__f"><span>종강일</span><input type="date" class="input" data-tf="endOn" value="' + esc(m.endOn || '') + '"></label>' +
      '<p class="tdc-tedit__err" data-tf="err" role="alert"></p>' +
      '<div class="tdc-tedit__foot"><button type="button" class="btn btn--sm" data-note-cancel="' + k + '">취소</button>' +
        '<button type="button" class="btn btn--sm btn--primary" data-note-save="' + k + '">저장</button></div>' +
    '</div>';
  }
  function saveTime(cls, form) {
    var g = function (n) { return form.querySelector('[data-tf="' + n + '"]'); };
    var m0 = Store.metaOf(cls) || {};
    var args = { p_class: cls, p_start: g('start').value || '', p_end: g('end').value || '', p_end_on: g('endOn').value || null,
                 p_staff: m0.staff || [], p_remind: g('remind').checked, p_min: parseInt(g('min').value, 10) || 5 };
    var err = g('err');
    if ((args.p_start && !args.p_end) || (!args.p_start && args.p_end)) { err.textContent = '시작 · 끝 시각을 둘 다 넣어 주세요.'; return Promise.resolve(false); }
    if (args.p_remind && !args.p_end) { err.textContent = '필기·복습 문자를 켜려면 수업 끝 시각을 넣어 주세요.'; return Promise.resolve(false); }
    if (args.p_start && args.p_end && hm2min(args.p_end) <= hm2min(args.p_start)) { err.textContent = '끝 시각은 시작 시각보다 뒤여야 합니다.'; return Promise.resolve(false); }
    if (args.p_min < 1 || args.p_min > 60) { err.textContent = '「끝나기 몇 분 전」은 1~60분으로 정해 주세요.'; return Promise.resolve(false); }
    var pre = g('pre').checked && !!args.p_start, preH = parseInt(g('preH').value, 10) || 3;      /* 시각을 비우면 수업 전 문자도 끈다 */
    if (preH < 1 || preH > 12) { err.textContent = '「수업 몇 시간 전」은 1~12시간으로 정해 주세요.'; return Promise.resolve(false); }
    if (pre && hm2min(args.p_start) < preH * 60) { err.textContent = '수업 전 문자 시각이 자정보다 앞이 됩니다 — 몇 시간 전을 줄여 주세요.'; return Promise.resolve(false); }
    var btn = form.querySelector('[data-note-save]');
    btn.disabled = true;
    return Promise.resolve(sb().rpc('class_meta_set', args)).then(function (r) {
      btn.disabled = false;
      if (r.error) { err.textContent = missingFn(r.error) ? 'migration-049 SQL 을 먼저 실행해 주세요.' : r.error.message; return false; }
      var staff = (r.data && r.data.staff) || args.p_staff;
      /* 수업 전 문자 (migration-056) — 아직 안 돌렸으면 필기 문자 값만 저장 */
      return Promise.resolve(sb().rpc('class_pre_set', { p_class: cls, p_on: pre, p_hours: preH })).then(function (r2) {
        var preSql = !(r2.error && missingFn(r2.error));
        if (r2.error && preSql) { err.textContent = r2.error.message; return false; }
        return done(staff, preSql);
      });
    }, function (e) { btn.disabled = false; err.textContent = (e && e.message) || '저장하지 못했습니다'; return false; });
    function done(staff, preSql) {
      Store.setMetaLocal(cls, { start: args.p_start, end: args.p_end, endOn: args.p_end_on || '', staff: staff, remind: args.p_remind, min: args.p_min, pre: preSql && pre, preH: preH, preSql: preSql });
      delete editing[cls];
      toast(cls + ' 수업 시각을 저장했습니다' + (preSql && pre ? ' · 수업 전 문자 ' + preAt({ start: args.p_start, preH: preH }) : '') + (args.p_remind ? ' · 필기·복습 문자 ' + remindAt({ end: args.p_end, min: args.p_min }) : '') + (preSql ? '' : ' (수업 전 문자는 migration-056 SQL 을 실행하면 저장됩니다)'), preSql ? 'good' : 'bad');
      window.dispatchEvent(new CustomEvent('jt:roster-changed'));
      return true;
    }
  }
  function repaintCard(cls) {
    var box = document.querySelector('[data-note-box="' + cssq(cls) + '"]');
    if (!box || !window.TodayView || !TodayView.classCard) { window.dispatchEvent(new CustomEvent('jt:roster-changed')); return; }
    box.outerHTML = cardHtml(TodayView.classCard(cls));
    paint();
  }

  /* 반 카드 (today.js classCardHtml 이 부른다) — 수업 시각 한 줄 · 수업 날 끝나기 n분 전부터 필기 미제출 */
  function cardHtml(c) {
    if (!c || c.name === '(반 없음)' || !c.rows || !c.rows.length) return '';
    var m = Store.metaOf(c.name);
    var html = '<div class="tdc-notebox" data-note-box="' + esc(c.name) + '">' + (editing[c.name] ? editHtml(c, m) : timeLine(c, m)) +
      (c.next && c.next.dday === 0 && m && m.pre ? '<span data-pre-st="' + esc(c.name) + '">' + preHtml(c.name) + '</span>' : '');
    if (showMissing(c, m)) {
      html += '<div class="tdc-note" data-note-cls="' + esc(c.name) + '">' +
          '<span class="tdc-note__st" data-note-st="' + esc(c.name) + '">' + stHtml(c.name) + '</span>' +
        '</div>' + (open[c.name] ? missHtml(c.name) : '');
    }
    return html + '</div>';
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
    if (document.querySelector('[data-pre-st]')) loadPre().then(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-pre-st]'), function (el) { var h = preHtml(el.dataset.preSt); if (el.innerHTML !== h) el.innerHTML = h; });
    });
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
    var ed = e.target.closest('[data-note-edit]');
    if (ed) { editing[ed.dataset.noteEdit] = true; repaintCard(ed.dataset.noteEdit); var f0 = document.querySelector('[data-note-form="' + cssq(ed.dataset.noteEdit) + '"] [data-tf="start"]'); if (f0) try { f0.focus(); } catch (x) {} return; }
    var cc = e.target.closest('[data-note-cancel]');
    if (cc) { delete editing[cc.dataset.noteCancel]; repaintCard(cc.dataset.noteCancel); return; }
    var sv = e.target.closest('[data-note-save]');
    if (sv) { var form = sv.closest('[data-note-form]'); saveTime(sv.dataset.noteSave, form); return; }
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
    if (e.target.closest('#tdSetContactSave')) saveContact();
  });
  $('#tdSettingsBtn').addEventListener('click', loadContact);

  window.Notes = { cardHtml: cardHtml, paint: paint, status: load, showMissing: showMissing, remindAt: remindAt, preAt: preAt, save: saveTime, preStatus: loadPre };
})();
