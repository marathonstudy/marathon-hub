/* ============================================================
   rupd.js — 보낸 레포트 업데이트 문자 (migration-073 · 함수 note-remind · 20261108e)

   이미 보낸 레포트에 수업 영상 · 자료 · 선생님 코멘트가 바뀌면 서버(트리거)가 기록하고,
   마지막으로 바뀐 뒤 10분(설정 5 ~ 60분) 동안 더 안 바뀌면 note-remind 가 모아 한 통 보낸다 (밤 10시 ~ 아침 8시는 8시 · 같은 레포트 하루 한 번).
   출석 · 과제 상태 · 필기 · 사본 · 설정 · 반 공지 · 수업 내용 변경으로는 안 나간다. 원장 · 조교가 같은 내용을 직접 보냈으면 그 항목은 뺀다 (migration-085 · 20261108q)
   이 파일은 화면만:
     · 맨 위 띠 「목동반 11/7 레포트 · 수업 영상 · 학생 10명 — 10분 뒤(14:35) 업데이트 문자가 나가요 [지금 보내기] [이번엔 안 보내기]」 (눈에 띄게 · 085)
       고친 직후(영상 넣기 · 다시 공개 · 자료 · 공지 저장 뒤) 바로 · 그 밖에는 1분마다 다시 읽는다
       반 설정에서 자동 발송을 껐으면 「자동 발송 꺼짐 · [지금 보내기]」
     · [지금 보내기] → note-remind { action: "rupd", week, class } (운영진 로그인) · [이번엔 안 보내기] → report_upd_skip
     · 문자 발송 → 연결 상태 「레포트 업데이트 문자」 — 「학부모에게도 업데이트 문자 보내기」(기본 끔 · 학부모는 일반 문자) · 「마지막 변경 뒤 기다리는 시간」 5 ~ 60분 (기본 10 · 085)
   073 전이면 아무것도 안 보인다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return window.SB && SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function missing(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var st = { list: [], parents: false, wait: 10, sql: null, busy: false, timer: 0 };

  function bar() {
    var b = document.getElementById('rupdBar');
    if (b) return b;
    var root = document.getElementById('appRoot');
    if (!root) return null;
    b = document.createElement('section');
    b.id = 'rupdBar';
    b.className = 'rupd';
    b.hidden = true;
    b.setAttribute('aria-live', 'polite');
    root.insertBefore(b, root.firstChild);
    return b;
  }
  function hm(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function md(s) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(s || ''); return m ? (+m[1]) + '/' + (+m[2]) : ''; }
  function whenText(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (ms <= 60000) return '곧';
    var min = Math.round(ms / 60000);
    var d = new Date(iso), now = new Date();
    var day = d.toDateString() === now.toDateString() ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ';
    return (min <= 90 ? min + '분 뒤(' + day + hm(iso) + ')' : day + hm(iso) + '에');
  }

  function render() {
    var b = bar();
    if (!b) return;
    var list = st.list || [];
    b.hidden = !list.length;
    b.classList.toggle('rupd--hot', list.some(function (x) { return x.auto; }));
    b.innerHTML = list.map(function (x) {
      var what = (x.items || []).join(' · ');
      return '<div class="rupd__row" data-rupd-week="' + esc(x.week) + '" data-rupd-cls="' + esc(x['class']) + '">' +
        '<span class="rupd__t"><b>' + esc(x['class']) + ' ' + esc(md(x.lesson) || md(x.week)) + ' 레포트</b> · ' + esc(what) + ' · 받는 학생 ' + esc(x.students) + '명 — ' +
          (x.auto ? esc(whenText(x.due)) + ' 업데이트 문자가 나가요' : '반 설정에서 자동 발송이 꺼져 있어요') + '</span>' +
        '<span class="rupd__acts"><button type="button" class="btn btn--sm btn--primary" data-rupd-now>지금 보내기</button>' +
          (x.auto ? '<button type="button" class="btn btn--sm" data-rupd-skip>이번엔 안 보내기</button>' : '') + '</span></div>';
    }).join('');
  }

  function load() {
    if (!sb() || st.sql === false) return Promise.resolve();
    return Promise.resolve(sb().rpc('report_upd_pending')).then(function (r) {
      if (r.error) { if (missing(r.error)) st.sql = false; st.list = []; render(); return; }
      st.sql = true;
      st.list = (r.data && r.data.list) || [];
      st.parents = !!(r.data && r.data.parents);
      if (r.data && r.data.wait) st.wait = r.data.wait;
      render();
      paintSettings();
    }, function () {});
  }
  /* 고친 직후 — 트리거가 기록한 뒤 바로 다시 읽는다 */
  function soon() { clearTimeout(st.timer); st.timer = setTimeout(load, 800); }

  function invokeNow(week, cls) {
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, message: '문자 함수(note-remind)를 부를 수 없습니다.' });
    return fns.invoke('note-remind', { body: { action: 'rupd', week: week, class: cls } }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') return ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false, message: 'note-remind 함수를 부르지 못했습니다.' }; });
      return { ok: false, message: 'note-remind 함수를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) { return { ok: false, message: 'note-remind 함수를 부르지 못했습니다 — ' + ((e && e.message) || '') }; });
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-rupd-week]');
    if (!row || st.busy) return;
    var week = row.dataset.rupdWeek, cls = row.dataset.rupdCls;
    var x = (st.list || []).find(function (y) { return y.week === week && y['class'] === cls; }) || {};
    if (e.target.closest('[data-rupd-now]')) {
      UI.confirmAsk('업데이트 문자 지금 보내기', cls + ' ' + (md(x.lesson) || md(week)) + ' 레포트를 받은 학생 ' + (x.students || 0) + '명에게 지금 보냅니다 — ' + (x.items || []).join(', ') + '.' +
        (st.parents ? ' 학부모에게도 일반 문자로 갑니다.' : ' 학부모에게는 보내지 않습니다(설정에서 켤 수 있음).'), '지금 보내기').then(function (ok) {
        if (!ok) return;
        st.busy = true;
        invokeNow(week, cls).then(function (r) {
          st.busy = false;
          if (!r || !r.ok) { toast((r && r.message) || '보내지 못했습니다', 'bad'); return; }
          toast('업데이트 문자를 보냈습니다 — ' + (r.sent || 0) + '통' + (r.failed ? ' · 실패 ' + r.failed : ''), r.failed ? 'bad' : 'good');
          load();
        });
      });
      return;
    }
    if (e.target.closest('[data-rupd-skip]')) {
      st.busy = true;
      Promise.resolve(sb().rpc('report_upd_skip', { p_week: week, p_class: cls })).then(function (r) {
        st.busy = false;
        if (r.error) { toast(r.error.message, 'bad'); return; }
        toast('이번 업데이트 문자는 보내지 않습니다', 'good');
        load();
      });
    }
  });

  /* 문자 발송 → 연결 상태 — 「학부모에게도 업데이트 문자 보내기」 */
  function paintSettings() {
    var host = document.getElementById('rupdSettings');
    if (!host) return;
    if (!st.sql) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">레포트 업데이트 문자</span></div>' +
      '<p class="field__hint">이미 보낸 레포트에 수업 영상 · 자료 · 선생님 코멘트가 바뀌면 마지막 변경 ' + st.wait + '분 뒤 모아 한 통 (밤 10시 ~ 아침 8시는 8시 · 같은 레포트 하루 한 번). 출석 · 과제 상태 · 필기 · 공지 · 설정 변경으로는 안 나갑니다. 같은 내용을 직접 보냈으면(수업 영상 알림 등) 그 항목은 뺍니다. 반마다 끄기는 「오늘」 반 카드 수업 [바꾸기] · 문구는 「레포트 업데이트」.</p>' +
      '<label class="field rupd-wait"><span class="field__label">마지막 변경 뒤 기다리는 시간</span><span class="rupd-wait__row"><input class="input num" id="rupdWait" type="number" min="5" max="60" step="1" value="' + st.wait + '" aria-label="기다리는 시간(분)"> 분 <span class="field__opt">5 ~ 60분 · 기본 10분</span></span></label>' +
      '<label class="check-line"><input type="checkbox" id="rupdParents"' + (st.parents ? ' checked' : '') + '> <span>학부모에게도 업데이트 문자 보내기 <span class="field__opt">기본 끔 · 켜면 레포트를 받은 학부모에게 일반 문자</span></span></label>';
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'rupdWait') {
      var m = Math.max(5, Math.min(60, Math.round(+e.target.value || 10)));
      e.target.value = m;
      Promise.resolve(sb().rpc('report_upd_wait_set', { p_min: m })).then(function (r) {
        if (r.error) { toast(missing(r.error) ? 'migration-085 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); e.target.value = st.wait; return; }
        st.wait = (r.data && r.data.wait) || m;
        toast('업데이트 문자는 마지막 변경 ' + st.wait + '분 뒤에 나갑니다', 'good');
        paintSettings(); load();
      });
      return;
    }
    if (e.target.id !== 'rupdParents') return;
    var on = e.target.checked;
    Promise.resolve(sb().rpc('report_upd_parents_set', { p_on: on })).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); e.target.checked = !on; return; }
      st.parents = on;
      toast(on ? '학부모에게도 업데이트 문자를 보냅니다 (일반 문자)' : '업데이트 문자는 학생에게만 보냅니다', 'good');
    });
  });

  /* 고친 뒤 · 다른 기기에서 바뀐 뒤 · 1분마다 */
  ['jt:loaded', 'jt:video-linked', 'jt:rupd', 'jt:refreshed', 'jt:remote', 'jt:files-changed', 'jt:notice-saved'].forEach(function (ev) {
    window.addEventListener(ev, soon);
  });
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  document.addEventListener('jt:tab', function () { paintSettings(); });

  window.RUpd = { reload: load, soon: soon, has: function () { return st.sql === true; }, state: function () { return st; } };
})();
