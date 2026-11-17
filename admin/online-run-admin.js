/* ============================================================
   online-run-admin.js — 온라인 반 「🏁 구간 완주 표」 (20261117a · 직원만)
   반 관리 → 온라인 반 줄 [🏁 구간 완주 표] → 학생마다 1 · 2 · 3구간 완주 여부 · 인정 일차 · 골든패스 · 사정 인정 (월말 환급 확인용)
   [◀ ▶] 달 넘기기 · [엑셀로 받기](CSV · 엑셀에서 열림) · 계산은 러닝노트 · 학생 카드와 같은 online-run.js
   서버: online_run_class(반) — migration-117 · 직원만 · 이미 받아 둔 앱 기록만(앱 · 앱 DB 는 건드리지 않음) · 전화번호 없음
   ============================================================ */
(function () {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function today() { return window.DDay ? DDay.today() : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  var S = { cls: '', ym: '', list: null, err: '' };
  var SEG = { done: ['완주', 'is-done'], missed: ['미완주', 'is-missed'], run: ['진행 중', ''], wait: ['시작 전', ''], none: ['—', ''] };

  function dlg() {
    var el = document.getElementById('ornTbl');
    if (el) return el;
    el = document.createElement('dialog');
    el.className = 'modal modal--wide orn-tblm';
    el.id = 'ornTbl';
    el.setAttribute('aria-labelledby', 'ornTblT');
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var m = e.target.closest('[data-ornt-m]');
      if (m) { S.ym = OnlineRun.shiftYm(S.ym, +m.getAttribute('data-ornt-m')); paint(); return; }
      if (e.target.closest('[data-ornt-csv]')) { download(); return; }
      if (e.target.closest('[data-ornt-close]')) Layer.hide(el);
    });
    return el;
  }
  function rows() { return (S.list || []).map(function (s) { return OnlineRun.classRow(s, S.ym, today()); }); }
  function paint() {
    var el = dlg(), cur = OnlineRun.ymOf(today());
    var body;
    if (S.err) body = '<p class="sc-hint" role="alert">' + esc(S.err) + '</p>';
    else if (!S.list) body = '<p class="sc-hint">불러오는 중…</p>';
    else if (!S.list.length) body = '<p class="sc-hint">이 반에 학생이 없어요</p>';
    else {
      var rs = rows(), full = rs.some(function (x) { return x.r.full; });
      var done3 = rs.filter(function (x) { return x.r.doneN === 3; }).length;
      body = '<p class="orn-hint">' + rs.length + '명 · 3구간 모두 ' + (full ? '완주' : '인증 완료') + ' ' + done3 + '명' + (full ? '' : ' · 영상·퀴즈 확인 전(앱 기록에 영상 시청률 · 퀴즈 제출 칸이 없어 과제 인증만으로 판정)') + '</p>' +
        '<div class="orn-tbl-wrap"><table class="orn-tbl"><thead><tr><th>이름</th><th>1구간</th><th>2구간</th><th>3구간</th><th>인정 일차</th><th>골든패스</th><th>사정 인정</th></tr></thead><tbody>' +
        rs.map(function (x) {
          var r = x.r;
          return '<tr data-ornt-id="' + esc(x.id) + '"><td>' + esc(x.name) + (x.linked ? '' : ' <span class="muted-note">앱 연결 안 됨</span>') + '</td>' +
            r.segs.map(function (g) { var k = SEG[g.state] || SEG.none, lb = r.full ? k[0] : g.state === 'done' ? '인증 완료' : g.state === 'missed' ? '미완료' : k[0]; return '<td class="' + k[1] + '">' + lb + (g.n ? ' <small class="num">' + g.ok + '/' + g.n + '</small>' : '') + '</td>'; }).join('') +
            '<td class="num">' + r.okN + '/' + r.n + '</td><td class="num">' + (r.golden ? esc(r.golden.slice(5).replace('-', '/')) : '—') + '</td><td class="num">' + r.exN + '일</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    el.innerHTML = '<div class="modal__head"><h2 class="modal__title" id="ornTblT">🏁 구간 완주 표 — ' + esc(S.cls) + '</h2>' +
        '<p class="modal__desc">학생마다 1 · 2 · 3구간 완주 여부 (월말 환급 확인용 · 직원만)</p></div>' +
      '<div class="modal__body"><div class="orn-mnav orn-mnav--sm"><button type="button" class="btn btn--sm" data-ornt-m="-1">◀</button><b>' + esc(S.ym.slice(0, 4) + '년 ' + OnlineRun.monthName(S.ym)) + '</b>' +
        '<button type="button" class="btn btn--sm" data-ornt-m="1"' + (S.ym >= cur ? ' disabled' : '') + '>▶</button></div>' + body + '</div>' +
      '<div class="modal__foot"><div class="spacer"></div><button type="button" class="btn" data-ornt-csv' + (S.list && S.list.length ? '' : ' disabled') + '>📥 엑셀로 받기</button><button type="button" class="btn btn--primary" data-ornt-close>닫기</button></div>';
  }
  function download() {
    if (!S.list || !S.list.length) return;
    var text = OnlineRun.csv(S.cls, S.ym, rows());
    var name = '구간완주_' + String(S.cls).replace(/[\\/:*?"<>|]/g, '') + '_' + S.ym + '.csv';
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    try { a.href = URL.createObjectURL(blob); } catch (e) { a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + text); }
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); try { URL.revokeObjectURL(a.href); } catch (e) {} }, 500);
    if (window.UI) UI.toast(name + ' 내려받기', 'good');
  }
  function open(cls) {
    S = { cls: cls, ym: OnlineRun.ymOf(today()), list: null, err: '' };
    var el = dlg();
    paint();
    Layer.show(el);
    var c = window.SB && SB.client;
    if (!c) { S.err = '로그인이 필요합니다'; paint(); return; }
    Promise.resolve(c.rpc('online_run_class', { p_class: cls })).then(function (r) {
      if (S.cls !== cls) return;
      if (r && r.error) S.err = /Could not find the function|schema cache|does not exist/i.test(r.error.message || '') ? 'migration-117 SQL 을 먼저 실행해 주세요' : r.error.message;
      else S.list = Array.isArray(r && r.data) ? r.data : [];
      paint();
    }, function () { S.err = '불러오지 못했습니다'; paint(); });
  }
  window.OnlineRunTable = { open: open, state: function () { return S; } };
})();
