/* ============================================================
   contacts.js — 학생 → 명단 → [번호 한꺼번에 넣기] (학부모 번호 1 · 2 · 학생 본인 번호)

   엑셀에서 「이름 · 번호」 두 칸을 복사해 붙여 넣는다 (탭 · 쉼표 · 띄어쓰기로 나뉜 두 칸).
   이름으로 다니는 학생을 찾아 [미리 보기] → 확인 → [저장].
     · 학부모 번호 1 이 비었으면 1, 아니면 2 에 넣는다. 이미 같은 번호면 건너뛴다. 두 칸이 다 차 있으면 따로 알린다.
     · 「학생 본인 번호」를 고르면 학생 연락처 칸(students.student_phone)에 — 비었을 때만 넣고, 다른 번호가 있으면 따로 알린다 (20261028a)
     · 같은 이름이 둘 이상이거나 못 찾은 이름, 번호 모양이 이상한 줄은 저장하지 않고 알려 준다.
   번호는 students 표(직원만 읽는다)에만 저장된다. 화면에는 가려서(010-****-1234) 보여 준다.
   학부모 번호 2 칸은 migration-020 을 실행해야 저장된다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var plan = null;
  var to = 'parent';                      /* 'parent' 학부모 번호 1 · 2 | 'student' 학생 본인 번호 */

  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }

  function parse(text) {
    var active = Store.getStudents().filter(function (s) { return !s.archived; });
    var byName = {};
    active.forEach(function (s) { var k = String(s.name || '').replace(/\s+/g, ''); (byName[k] = byName[k] || []).push(s); });
    var out = { ok: [], same: [], bad: [], none: [], twin: [], full: [] };
    var seen = {};
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line, i) {
      var t = line.trim();
      if (!t) return;
      var m = /^(.+?)[\t,;]\s*([0-9\-\s.()+]+)$/.exec(t) || /^(\S+)\s+([0-9][0-9\-\s.()]+)$/.exec(t);
      if (!m) { out.bad.push({ line: i + 1, text: t, why: '「이름, 번호」 두 칸이 아닙니다' }); return; }
      var name = m[1].replace(/\s+/g, ''), d = Store.phoneDigits(m[2]);
      if (/^(이름|학생|성명)$/.test(name)) return;                 /* 머리 줄 */
      if (!mobile(d)) { out.bad.push({ line: i + 1, text: name, why: '휴대폰 번호(010 …) 모양이 아닙니다' }); return; }
      var hits = byName[name] || [];
      if (!hits.length) { out.none.push({ line: i + 1, text: name }); return; }
      if (hits.length > 1) { out.twin.push({ line: i + 1, text: name, n: hits.length }); return; }
      var s = hits[0];
      if (to === 'student') {
        var mine = seen[s.id] ? seen[s.id].st : Store.phoneDigits(s.studentPhone);
        if (mine === d) { out.same.push({ line: i + 1, text: name }); return; }
        if (mine) { out.full.push({ line: i + 1, text: name }); return; }
        seen[s.id] = { st: d };
        out.ok.push({ line: i + 1, student: s, slot: 's', digits: d });
        return;
      }
      var cur = seen[s.id] || { p1: Store.phoneDigits(s.parentPhone), p2: Store.phoneDigits(s.parentPhone2) };
      if (cur.p1 === d || cur.p2 === d) { out.same.push({ line: i + 1, text: name }); return; }
      var slot = !cur.p1 ? 1 : !cur.p2 ? 2 : 0;
      if (!slot) { out.full.push({ line: i + 1, text: name }); return; }
      if (slot === 2 && !DB.hasPhone2()) { out.bad.push({ line: i + 1, text: name, why: '학부모 번호 2 칸은 migration-020 을 실행해야 저장됩니다' }); return; }
      if (slot === 1) cur.p1 = d; else cur.p2 = d;
      seen[s.id] = cur;
      out.ok.push({ line: i + 1, student: s, slot: slot, digits: d });
    });
    return out;
  }

  function previewHtml(p) {
    function list(arr, fn) { return arr.map(fn).join(''); }
    return '<p class="cp-sum"><b class="num">' + p.ok.length + '</b>줄 저장 · 이미 같은 번호 ' + p.same.length +
        ' · 못 넣음 ' + (p.bad.length + p.none.length + p.twin.length + p.full.length) + '</p>' +
      (p.ok.length ? '<ul class="cp-list">' + list(p.ok, function (r) {
        return '<li><b>' + esc(r.student.name) + '</b> <span class="muted-note">' + esc(r.student.className || '반 없음') + '</span> → ' + (r.slot === 's' ? '학생 본인 번호' : '학부모 번호 ' + r.slot) +
               ' <span class="num">' + esc(Store.phoneMask(r.digits)) + '</span></li>';
      }) + '</ul>' : '') +
      (p.none.length ? '<p class="cp-warn">못 찾은 이름: ' + esc(p.none.map(function (r) { return r.text; }).join(', ')) + '</p>' : '') +
      (p.twin.length ? '<p class="cp-warn">같은 이름이 여럿 — 학생 창에서 직접 넣어 주세요: ' + esc(p.twin.map(function (r) { return r.text + '(' + r.n + '명)'; }).join(', ')) + '</p>' : '') +
      (p.full.length ? '<p class="cp-warn">' + (to === 'student' ? '다른 학생 번호가 이미 있음' : '번호 칸 두 개가 이미 차 있음') + ' — 학생 창에서 고쳐 주세요: ' + esc(p.full.map(function (r) { return r.text; }).join(', ')) + '</p>' : '') +
      (p.bad.length ? '<p class="cp-warn">' + list(p.bad, function (r) { return esc(r.line + '번째 줄 ' + r.text + ' — ' + r.why) + '<br>'; }) + '</p>' : '');
  }

  var DESC = {
    parent: '엑셀에서 「이름」 「번호」 두 칸을 같이 골라 복사(Ctrl+C)한 뒤 아래에 붙여 넣으세요. 학부모 번호 1 이 비었으면 1, 아니면 2 에 들어갑니다.',
    student: '엑셀에서 「이름」 「학생 번호」 두 칸을 같이 골라 복사(Ctrl+C)한 뒤 아래에 붙여 넣으세요. 학생 연락처 칸이 비어 있는 학생에게만 들어갑니다.'
  };
  function setTo(v) {
    to = v === 'student' ? 'student' : 'parent';
    Array.prototype.forEach.call(document.querySelectorAll('[data-cpto]'), function (b) {
      var on = b.dataset.cpto === to;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if ($('#cpDesc')) $('#cpDesc').textContent = DESC[to];
    plan = null;
    $('#cpSave').disabled = true;
    $('#cpPreview').innerHTML = '<p class="panel__hint">붙여 넣고 [미리 보기]를 누르세요.</p>';
  }

  function open() {
    setTo('parent');
    plan = null;
    $('#cpText').value = '';
    $('#cpPreview').innerHTML = '<p class="panel__hint">붙여 넣고 [미리 보기]를 누르세요.</p>';
    $('#cpSave').disabled = true;
    $('#phonePasteModal').showModal();
    setTimeout(function () { $('#cpText').focus(); }, 30);
  }

  function preview() {
    plan = parse($('#cpText').value);
    $('#cpPreview').innerHTML = previewHtml(plan);
    $('#cpSave').disabled = !plan.ok.length;
  }

  function save() {
    if (!plan || !plan.ok.length) return;
    var n = 0;
    plan.ok.forEach(function (r) {
      var s = Store.getStudents().find(function (x) { return x.id === r.student.id; });
      if (!s) return;
      var rec = Object.assign({}, s);
      if (r.slot === 's') rec.studentPhone = r.digits;
      else if (r.slot === 1) rec.parentPhone = r.digits; else rec.parentPhone2 = r.digits;
      Store.upsertStudent(rec);
      n++;
    });
    window.dispatchEvent(new CustomEvent('jt:roster-changed'));
    $('#phonePasteModal').close();
    toast((to === 'student' ? '학생 본인 번호 ' : '학부모 번호 ') + n + '개를 넣었습니다', 'good');
  }

  function init() {
    if (!$('#btnPhonePaste')) return;
    $('#btnPhonePaste').addEventListener('click', open);
    $('#cpPreviewBtn').addEventListener('click', preview);
    $('#cpSave').addEventListener('click', save);
    $('#cpCancel').addEventListener('click', function () { $('#phonePasteModal').close(); });
    $('#cpText').addEventListener('input', function () { $('#cpSave').disabled = true; });
    $('#phonePasteModal').addEventListener('click', function (e) { var b = e.target.closest('[data-cpto]'); if (b) setTo(b.dataset.cpto); });
  }
  init();

  window.Contacts = { parse: parse, setTo: setTo };
})();
