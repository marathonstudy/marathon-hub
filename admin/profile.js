/* ============================================================
   profile.js — 학생이 채운 「내 정보」 · 얼굴 사진 (코치룸 · 20261031c · migration-035)

   · student_profile 을 한 번에 읽는다 (작은 사진 thumb · 내 정보 · 학생이 고친 때) — 큰 사진은 상담 카드를 열 때만
   · 이름 옆 작은 동그라미 — 사진이 있으면 얼굴, 없으면 이름 첫 글자 (avatar)
   · 「내 정보 안 채운 학생」 · 「사진 없는 학생」 (학생 명단)
   · 035 를 아직 안 돌렸으면 모두 첫 글자 동그라미 · 셈은 숨긴다
   학생 사진 · 정보는 이 표에만 있다 (깃허브에 없다 · 공개 주소 없음 · 직원만 읽음)
   ============================================================ */

(function (global) {
  'use strict';

  function sb() { return SB.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var st = { by: {}, loaded: false, missing: false };
  var INFO = [['target', '목표 대학 · 학과'], ['electives', '선택과목'], ['mock', '최근 모의고사 등급'], ['academy', '다니는 학원'], ['message', '선생님께 하고 싶은 말']];

  function load() {
    var c = sb();
    if (!c) return Promise.resolve();
    return c.from('student_profile').select('student_id,info,thumb,student_at').then(function (r) {
      if (r.error) { st.missing = /does not exist|schema cache/i.test(r.error.message || ''); st.by = {}; }
      else { st.missing = false; st.by = {}; (r.data || []).forEach(function (x) { st.by[x.student_id] = x; }); }
      st.loaded = true;
      global.dispatchEvent(new CustomEvent('jt:profiles'));
    }, function () { st.loaded = true; });
  }
  function of(sid) { return st.by[sid] || null; }
  /* 「학생이 10/24 수정」 */
  function editedText(sid) {
    var p = of(sid);
    if (!p || !p.student_at) return '';
    var d = new Date(p.student_at);
    return '학생이 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' 수정';
  }
  function hasInfo(sid) { var p = of(sid); return !!(p && (p.student_at || Object.keys(p.info || {}).length)); }
  function hasPhoto(sid) { var p = of(sid); return !!(p && p.thumb); }
  /* 이름 옆 작은 동그라미 (size: s 24px · m 36px · l 56px) */
  function avatar(s, size) {
    var p = s ? of(s.id) : null, cls = 'av av--' + (size || 's');
    if (p && p.thumb) return '<img class="' + cls + '" src="' + esc(p.thumb) + '" alt="" aria-hidden="true">';
    return '<span class="' + cls + ' av--none" aria-hidden="true">' + esc(String((s && s.name) || '?').charAt(0)) + '</span>';
  }
  /* 상담 카드 — 큰 사진 (그때만 읽는다) */
  function photo(sid) {
    return sb().from('student_profile').select('photo').eq('student_id', sid).then(function (r) {
      return (!r.error && r.data && r.data[0] && r.data[0].photo) || '';
    }, function () { return ''; });
  }

  /* 사진 크게 보기 — 화면 가운데 400px 원본 (상담 카드 맨 위 사진 · 학생 명단 「얼굴 사진으로 보기」 · 20261031e)
     바깥을 누르거나 [닫기]로 닫힌다. 사진이 없으면 누를 수 없다 (bigBtn 이 버튼을 만들지 않는다) */
  function showBig(sid, name) {
    var m = document.getElementById('photoBigModal');
    if (!m || !hasPhoto(sid)) return;
    var img = document.getElementById('photoBigImg');
    var p = of(sid);
    img.src = (p && p.thumb) || '';
    img.alt = (name || '') + ' 얼굴 사진';
    document.getElementById('photoBigName').textContent = name || '';
    m.showModal();
    photo(sid).then(function (src) { if (src && m.open) img.src = src; });
  }
  /* 누르면 크게 보이는 동그라미 (사진이 없으면 그냥 동그라미) */
  function bigBtn(s, size) {
    if (!s || !hasPhoto(s.id)) return avatar(s, size);
    return '<button type="button" class="av-big" data-photo-big="' + esc(s.id) + '" data-photo-name="' + esc(s.name || '') + '" aria-label="' + esc((s.name || '') + ' 얼굴 사진 크게 보기') + '" title="사진 크게 보기">' + avatar(s, size) + '</button>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-photo-big]');
    if (b) { e.preventDefault(); e.stopPropagation(); showBig(b.dataset.photoBig, b.dataset.photoName); return; }
    var m = document.getElementById('photoBigModal');
    if (m && m.open && (e.target === m || e.target.id === 'btnPhotoBigClose')) m.close();
  }, true);

  global.addEventListener('jt:loaded', load);
  global.addEventListener('jt:remote', function (e) { if (e.detail && e.detail.table === 'student_profile') load(); });

  global.Profile = { load: load, of: of, editedText: editedText, hasInfo: hasInfo, hasPhoto: hasPhoto, avatar: avatar, photo: photo, showBig: showBig, bigBtn: bigBtn,
                     INFO: INFO, missing: function () { return st.missing; }, loaded: function () { return st.loaded; } };
})(window);
