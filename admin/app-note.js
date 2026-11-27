/* ============================================================
   app-note.js — 「오늘」 설정 창 「앱 러닝노트」 (20261127a · migration-133 · 함수 hub-embed)
   마라톤 앱 안 「내 러닝노트」 켜기/끄기 · 보여 줄 대상(원장 · 직원 계정 / 특정 반 / 전체) · 최근 7일 오류 요약
   꺼짐(처음 값) · 대상 아님 → 앱 홈 요약 카드 숨김 · 앱 러닝노트 링크 「잠시 쉬는 중」
   오류 기록은 날짜 · 종류 · 횟수만 (학생 이름 · 번호 없음)
   ============================================================ */
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function missingFn(e) { return /Could not find the function|does not exist|schema cache/i.test((e && e.message) || ''); }

  var KIND = { bad: '서명 위조 · 모양 틀림', expired: '서명 만료', fail: '값 불러오기 실패', slow: '느린 응답(2.5초 넘음)', nolink: '앱 연결된 학생 없음' };
  var cur = null;

  function target() { var r = document.querySelector('input[name="anTarget"]:checked'); return r ? r.value : 'staff'; }
  function showParts() {
    var t = target();
    $('#anUidsBox').hidden = t !== 'staff';
    $('#anClsBox').hidden = t !== 'classes';
  }
  function paint(v) {
    cur = v;
    $('#anOn').checked = !!v.on;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="anTarget"]'), function (r) { r.checked = r.value === (v.target || 'staff'); });
    $('#anUids').value = (v.uids || []).join(', ');
    var pick = {};
    (v.classes || []).forEach(function (c) { pick[c] = 1; });
    var all = (v.all_classes || []).slice();
    (v.classes || []).forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); });
    $('#anCls').innerHTML = all.length ? all.map(function (c) {
      return '<label class="check-line an-cls__i"><input type="checkbox" data-an-cls value="' + esc(c) + '"' + (pick[c] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>';
    }).join('') : '<span class="field__hint">반이 없습니다</span>';
    $('#anState').textContent = (v.on ? '켜짐' : '꺼짐') + ' · 앱 학생번호 연결된 학생 ' + (v.linked || 0) + '명';
    showParts();
  }
  function paintLog(rows) {
    var box = $('#anLog');
    if (!Array.isArray(rows)) { box.textContent = '오류 기록을 불러오지 못했습니다'; return; }
    if (!rows.length) { box.textContent = '최근 7일 오류 없음'; return; }
    var byKind = {};
    rows.forEach(function (r) { byKind[r.kind] = (byKind[r.kind] || 0) + (+r.n || 0); });
    box.innerHTML = '<p>' + Object.keys(byKind).map(function (k) { return esc(KIND[k] || k) + ' <b>' + byKind[k] + '회</b>'; }).join(' · ') + '</p>' +
      '<table class="an-log"><thead><tr><th>날짜</th><th>종류</th><th>횟수</th><th>마지막</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var t = r.last ? new Date(r.last) : null;
        var hm = t && !isNaN(t) ? String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
        return '<tr><td>' + esc(String(r.day || '').slice(5)) + '</td><td>' + esc(KIND[r.kind] || r.kind) + '</td><td>' + (+r.n || 0) + '</td><td>' + esc(hm) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function load() {
    if (!$('#anBox')) return;
    $('#anLog').textContent = '불러오는 중…';
    sb().rpc('app_note_get').then(function (r) {
      if (r.error) { $('#anState').textContent = missingFn(r.error) ? 'migration-133 SQL 을 먼저 실행해 주세요' : r.error.message; $('#anSave').disabled = true; return; }
      $('#anSave').disabled = false;
      paint(r.data || {});
    }, function () {});
    sb().rpc('app_note_log7').then(function (r) { paintLog(r.error ? null : r.data); }, function () { paintLog(null); });
  }
  function save() {
    var uids = String($('#anUids').value || '').split(/[\s,，、]+/).filter(function (x) { return /^[0-9]{1,18}$/.test(x); });
    var bad = String($('#anUids').value || '').split(/[\s,，、]+/).filter(function (x) { return x && !/^[0-9]{1,18}$/.test(x); });
    var classes = Array.prototype.map.call(document.querySelectorAll('[data-an-cls]:checked'), function (c) { return c.value; });
    var v = { on: $('#anOn').checked, target: target(), uids: uids, classes: classes };
    if (bad.length) { toast('앱 학생번호는 숫자만 넣어 주세요: ' + bad.join(', '), 'bad'); return; }
    if (v.on && v.target === 'staff' && !uids.length) { toast('원장 · 직원 계정으로 켤 때는 시험용 앱 학생번호를 넣어 주세요', 'bad'); return; }
    if (v.on && v.target === 'classes' && !classes.length) { toast('특정 반으로 켤 때는 반을 하나 이상 골라 주세요', 'bad'); return; }
    $('#anSave').disabled = true;
    sb().rpc('app_note_set', { p: v }).then(function (r) {
      $('#anSave').disabled = false;
      if (r.error) { toast(missingFn(r.error) ? 'migration-133 SQL 을 먼저 실행해 주세요' : r.error.message, 'bad'); return; }
      paint(Object.assign({}, cur || {}, r.data || v));
      toast(v.on ? '앱 러닝노트를 켰습니다 — ' + (v.target === 'all' ? '전체' : v.target === 'classes' ? '고른 반 ' + classes.length + '개' : '시험용 계정 ' + uids.length + '개') : '앱 러닝노트를 껐습니다 — 앱 카드 숨김 · 「잠시 쉬는 중」', 'good');
    }, function () { $('#anSave').disabled = false; });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#anSave')) save();
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'anTarget') showParts();
  });
  /* 시험용 번호 칸에서 Enter — 「오늘」 설정 저장으로 넘어가지 않게 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'anUids') { e.preventDefault(); save(); }
  });
  var btn = $('#tdSettingsBtn');
  if (btn) btn.addEventListener('click', load);

  window.AppNote = { load: load };
})();
