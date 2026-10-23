/* ============================================================
   me-info.js — 학생 「내 정보」 탭 (학생 링크 · /s/ 로그인만 · 20261031c · migration-035)

   학생이 기본 정보를 직접 채우고 · 고치고 · 지운다 → 코치룸 상담 카드에 바로 (「학생이 10/24 수정」)
     이름 · 반은 바꿀 수 없다 (코치룸에서만)
     학교 · 학년 · 내 휴대폰 번호 · 목표 대학·학과 · 선택과목 · 최근 모의고사 등급 · 다니는 학원 · 선생님께 하고 싶은 말
     휴대폰 번호는 로그인 비밀번호(번호 뒤 8자리)와 같아서, 바꾸면 「로그인 비밀번호도 바뀝니다」를 먼저 묻는다
   얼굴 사진 한 장 — 올리기 전에 「선생님이 얼굴을 기억하고 관리하는 데만 씁니다 …」
     정사각으로 가운데를 잘라 가로 400px(상담 카드) · 96px(명단 · 「오늘」) JPEG 로 줄여 저장 (공개 주소 없음 · 본인과 코치룸만)
   선생님 · 조교의 상담 기록 · 특이사항 · 성적 · 결석 기록은 이 화면에 오지 않는다 (함수가 주지 않는다)
   ============================================================ */

(function (global) {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var FIELDS = [
    ['school', '학교', '예) 마라톤고', 40],
    ['grade', '학년', '예) 고3', 20],
    ['phone', '내 휴대폰 번호', '010-1234-5678', 13],
    ['target', '목표 대학 · 학과', '예) ○○대 국어교육과', 100],
    ['electives', '선택과목', '예) 언어와 매체 · 미적분 · 생명과학Ⅰ', 100],
    ['mock', '최근 모의고사 등급', '예) 9월 모의 국어 3등급', 100],
    ['academy', '다니는 학원', '예) 수학 ○○학원', 100],
    ['message', '선생님께 하고 싶은 말', '공부하면서 힘든 점, 바라는 점을 편하게 적어 주세요', 500]
  ];
  var REASON = { phone: '휴대폰 번호를 다시 확인해 주세요 (010으로 시작하는 번호)', long: '글이 너무 깁니다', notstudent: '학생 링크로 로그인해야 쓸 수 있습니다', photo: '사진을 저장하지 못했습니다' };

  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function phoneFmt(v) { var d = digits(v); return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : d; }

  /* 사진 — 가운데를 정사각으로 잘라 size px JPEG 로 (data: 글자) */
  function squareJpeg(img, size, q) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, m = Math.min(w, h);
    c.getContext('2d').drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size);
    return c.toDataURL('image/jpeg', q);
  }
  function makePhotos(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var big = squareJpeg(img, 400, 0.82), small = squareJpeg(img, 96, 0.8);
          URL.revokeObjectURL(url);
          resolve({ photo: big, thumb: small });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진을 열지 못했습니다')); };
      img.src = url;
    });
  }

  function render(host, code, rpc) {
    var st = { d: null, busy: false, pending: null };
    host.innerHTML = '<div class="card mi-card"><p class="tw-loading"><i class="spin" aria-hidden="true"></i> 내 정보를 불러오는 중</p></div>';
    function load() {
      return rpc('me_info_get', { p_code: code }).then(function (d) {
        if (!d || !d.ok) { host.innerHTML = '<div class="empty">' + esc((d && REASON[d.reason]) || '내 정보를 불러오지 못했습니다') + '</div>'; return; }
        st.d = d; draw();
      }, function () { host.innerHTML = '<div class="empty">내 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</div>'; });
    }
    function val(k) { var d = st.d || {}; return k === 'school' || k === 'grade' ? d[k] : k === 'phone' ? phoneFmt(d.phone) : ((d.info || {})[k] || ''); }
    function draw(note) {
      var d = st.d;
      host.innerHTML =
        '<div class="card mi-card">' +
          '<h2 class="card-title">🙋 내 정보</h2>' +
          '<p class="mi-sub">선생님이 나를 더 잘 알 수 있게 직접 채워 주세요. 언제든 고치거나 지울 수 있어요.</p>' +
          '<div class="mi-fixed"><span><b>이름</b> ' + esc(d.name) + '</span><span><b>반</b> ' + esc(d.class_name || '—') + '</span><span class="mi-muted">이름 · 반은 선생님께 말해 주세요</span></div>' +
          '<form class="mi-form" data-mi-form>' + FIELDS.map(function (f) {
            var v = val(f[0]);
            var input = f[0] === 'message'
              ? '<textarea class="mi-input" name="' + f[0] + '" rows="3" maxlength="' + f[3] + '" placeholder="' + esc(f[2]) + '">' + esc(v) + '</textarea>'
              : '<input class="mi-input" name="' + f[0] + '" maxlength="' + f[3] + '" placeholder="' + esc(f[2]) + '" value="' + esc(v) + '"' + (f[0] === 'phone' ? ' inputmode="tel"' : '') + '>';
            return '<label class="mi-field"><span class="mi-label">' + esc(f[1]) + (f[0] === 'phone' ? ' <small>로그인 비밀번호(번호 뒤 8자리)와 같아요</small>' : '') + '</span>' + input + '</label>';
          }).join('') +
            '<div class="mi-warn" data-mi-warn hidden></div>' +
            '<div class="mi-actions"><button type="submit" class="hub-btn">저장</button>' + (d.student_at ? '<span class="mi-muted">마지막 저장 ' + esc(String(d.student_at).slice(5, 10).replace('-', '/')) + '</span>' : '') + '</div>' +
            (note ? '<p class="mi-ok" role="status">' + esc(note) + '</p>' : '') +
          '</form>' +
        '</div>' +
        '<div class="card mi-card">' +
          '<h2 class="card-title">📷 얼굴 사진</h2>' +
          '<p class="mi-consent">선생님이 얼굴을 기억하고 관리하는 데만 씁니다. 다른 사람에게 보이지 않고 언제든 지울 수 있습니다.</p>' +
          '<div class="mi-photo">' + (d.photo ? '<img class="mi-photo__img" src="' + esc(d.photo) + '" alt="내 얼굴 사진">' : '<span class="mi-photo__none">' + esc(String(d.name || '?').charAt(0)) + '</span>') +
            '<div class="mi-photo__btns"><label class="hub-btn hub-btn--sm mi-file">' + (d.photo ? '사진 바꾸기' : '사진 올리기') + '<input type="file" accept="image/*" data-mi-file hidden></label>' +
              (d.photo ? '<button type="button" class="hub-btn hub-btn--sm hub-btn--ghost" data-mi-del>사진 지우기</button>' : '') + '</div></div>' +
          '<p class="mi-muted">가운데를 정사각으로 잘라 작게 줄여 저장합니다.</p>' +
        '</div>';
    }
    function fields() {
      var f = host.querySelector('[data-mi-form]'), out = {};
      FIELDS.forEach(function (x) { out[x[0]] = f.elements[x[0]].value.trim(); });
      return out;
    }
    function save(force) {
      if (st.busy) return;
      var out = fields();
      var warn = host.querySelector('[data-mi-warn]');
      /* 번호를 바꾸면 로그인 비밀번호도 바뀐다 — 먼저 알린다 */
      if (!force && digits(out.phone) !== digits(st.d.phone)) {
        warn.hidden = false;
        warn.innerHTML = '<b>로그인 비밀번호도 바뀝니다</b> — 다음 로그인부터 새 번호 뒤 8자리' + (digits(out.phone).length >= 8 ? '(' + esc(digits(out.phone).slice(-8)) + ')' : '') + '를 넣어야 해요. ' +
          (digits(out.phone) ? '' : '번호를 비우면 학생 입구로 로그인할 수 없어요. ') +
          '<button type="button" class="hub-btn hub-btn--sm" data-mi-go>그래도 저장</button> <button type="button" class="hub-btn hub-btn--sm hub-btn--ghost" data-mi-cancel>취소</button>';
        return;
      }
      st.busy = true;
      rpc('me_info_save', { p_code: code, p_fields: out }).then(function (r) {
        st.busy = false;
        if (!r || !r.ok) { warn.hidden = false; warn.textContent = (r && REASON[r.reason]) || '저장하지 못했습니다'; return; }
        st.d.school = out.school; st.d.grade = out.grade; st.d.phone = digits(out.phone);
        st.d.info = {}; ['target', 'electives', 'mock', 'academy', 'message'].forEach(function (k) { if (out[k]) st.d.info[k] = out[k]; });
        st.d.student_at = new Date().toISOString();
        draw(r.phone_changed ? '저장했습니다 · 다음 로그인부터 비밀번호는 새 번호 뒤 8자리입니다' : '저장했습니다 · 선생님 화면에 바로 보입니다');
      }, function () { st.busy = false; warn.hidden = false; warn.textContent = '저장하지 못했습니다. 인터넷을 확인하고 다시 눌러 주세요.'; });
    }
    function savePhoto(p) {
      return rpc('me_photo_save', { p_code: code, p_photo: p ? p.photo : '', p_thumb: p ? p.thumb : '' }).then(function (r) {
        if (!r || !r.ok) { alertMsg((r && REASON[r.reason]) || '사진을 저장하지 못했습니다'); return; }
        st.d.photo = p ? p.photo : null;
        draw(p ? '사진을 저장했습니다' : '사진을 지웠습니다');
      });
    }
    function alertMsg(m) { var w = host.querySelector('[data-mi-warn]'); if (w) { w.hidden = false; w.textContent = m; } }
    host.addEventListener('submit', function (e) { if (e.target.matches('[data-mi-form]')) { e.preventDefault(); save(false); } });
    host.addEventListener('click', function (e) {
      if (e.target.closest('[data-mi-go]')) { save(true); return; }
      if (e.target.closest('[data-mi-cancel]')) { var w = host.querySelector('[data-mi-warn]'); w.hidden = true; w.innerHTML = ''; return; }
      if (e.target.closest('[data-mi-del]')) savePhoto(null);
    });
    host.addEventListener('change', function (e) {
      var inp = e.target.closest('[data-mi-file]');
      if (!inp || !inp.files || !inp.files[0]) return;
      MeInfo.makePhotos(inp.files[0]).then(savePhoto, function (err) { alertMsg(err.message || '사진을 열지 못했습니다'); });
    });
    load();
  }

  global.MeInfo = { render: render, makePhotos: makePhotos };
})(window);
