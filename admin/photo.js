/* ============================================================
   photo.js — 마라톤 코치룸 학생 → 필기 노트

   · 반 · 기간을 고르면 학생 × 수업 날짜 표: 올린 장수 / 안 올림
     (수업 날짜는 교재 「일정」의 날짜 + 실제로 올라온 날짜)
   · 칸을 누르면 사진 보기. [숨기기]/[보이기] 는 staff, [완전 삭제] 는 teacher 만.
   · 저장 공간 사용량 (프로젝트 전체 · 무료 1GB 기준)

   학생이 올리면 실시간으로 표가 바뀐다 (note_photos).
   숨기기는 updated_at 을 확인한다 — 다른 분이 먼저 바꿨으면 묻는다.
   ============================================================ */

(function () {
  'use strict';

  var $ = UI.$, $$ = UI.$$;
  function sb() { return SB.client; }
  function check(r) { if (r && r.error) throw new Error(r.error.message); return r; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache/i.test((e && e.message) || ''); }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  var st = { ready: false, cls: '', from: '', to: '', showHidden: false, rows: [], dates: [], role: '', cell: null };

  function isTeacher() { return !!st.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */

  function init() {
    if (st.ready) return;
    st.ready = true;
    var t = DDay.today();
    var dow = new Date(t + 'T00:00:00Z').getUTCDay();
    var mon = addDays(t, -((dow + 6) % 7));
    $('#phFrom').value = mon;
    $('#phTo').value = addDays(mon, 6);
    ['#phClass', '#phFrom', '#phTo'].forEach(function (s) { $(s).addEventListener('change', load); });
    $('#phShowHidden').addEventListener('change', function (e) { st.showHidden = e.target.checked; render(); });
    $('#phPrevWeek').addEventListener('click', function () { shiftWeek(-7); });
    $('#phNextWeek').addEventListener('click', function () { shiftWeek(7); });
    $('#phTable').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cell]');
      if (c) openCell(c.dataset.sid, c.dataset.date);
    });
    $('#phGallery').addEventListener('click', onGalleryClick);
    $('#btnPhGalleryClose').addEventListener('click', function () { $('#phGalleryModal').close(); });
    DB.myStaff().then(function (m) { st.role = (m && m.role) || ''; });
  }

  function shiftWeek(n) {
    $('#phFrom').value = addDays($('#phFrom').value || DDay.today(), n);
    $('#phTo').value = addDays($('#phTo').value || DDay.today(), n);
    load();
  }

  function fillClasses() {
    var sel = $('#phClass');
    var keep = sel.value;
    sel.innerHTML = Store.getClasses().map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + ' (' + c.count + ')</option>';
    }).join('');
    if (keep && Array.prototype.some.call(sel.options, function (o) { return o.value === keep; })) sel.value = keep;
  }

  function show() {
    init();
    fillClasses();
    loadUsage();
    load();
  }

  /* ---------- 저장 공간 ---------- */

  function loadUsage() {
    sb().rpc('storage_usage').then(function (r) {
      var host = $('#phUsage');
      if (r.error) { host.innerHTML = isMissing(r.error) ? '' : '<p class="panel__hint">' + esc(r.error.message) + '</p>'; return; }
      var u = r.data || {};
      var pct = u.limit ? Math.min(100, Math.round(u.bytes / u.limit * 1000) / 10) : 0;
      var gb = function (b) { return (b / 1073741824).toFixed(2) + 'GB'; };
      host.innerHTML = '<div class="ph-usage"><div class="ph-usage__text">저장 공간 <b>' + gb(u.limit || 1073741824) + ' 중 ' + gb(u.bytes || 0) +
        ' (' + pct + '%)</b> 사용 <span class="muted-note">· 필기 사진 ' + (u.photos || 0) + '장 ' + gb(u.photo_bytes || 0) + ' · 무료 1GB 기준</span></div>' +
        '<div class="progress__bar"><div class="progress__fill ph-usage__fill' + (pct >= 80 ? ' is-warn' : '') + '" style="width:' + pct + '%"></div></div></div>';
    });
  }

  /* ---------- 표 ---------- */

  function load() {
    st.cls = $('#phClass').value;
    st.from = $('#phFrom').value;
    st.to = $('#phTo').value;
    var host = $('#phTable');
    if (!st.cls) { host.innerHTML = '<div class="empty-state">반이 없습니다.</div>'; return; }
    if (!st.from || !st.to || st.from > st.to) { host.innerHTML = '<div class="empty-state">기간을 확인해 주세요.</div>'; return; }
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    var c = sb();
    var studs = Store.getStudents().filter(function (s) { return (s.className || '') === st.cls && !s.archived; });
    Promise.all([
      c.from('note_photos').select('*').gte('lesson_date', st.from).lte('lesson_date', st.to)
        .order('lesson_date').order('created_at'),
      c.from('tb_class_dates').select('lesson_date').eq('class_name', st.cls).gte('lesson_date', st.from).lte('lesson_date', st.to)
    ]).then(function (res) {
      if (res[0].error) throw new Error(res[0].error.message);
      var photos = res[0].data.filter(function (p) {
        return p.class_name === st.cls || studs.some(function (s) { return s.id === p.student_id; });
      });
      var dates = {};
      (res[1].error ? [] : res[1].data).forEach(function (d) { dates[d.lesson_date] = 'lesson'; });
      photos.forEach(function (p) { if (!dates[p.lesson_date]) dates[p.lesson_date] = 'photo'; });
      st.dates = Object.keys(dates).sort();
      st.lessonDates = dates;
      st.photos = photos;
      var ids = {};
      studs.forEach(function (s) { ids[s.id] = true; });
      photos.forEach(function (p) { ids[p.student_id] = true; });
      st.rows = Object.keys(ids).map(function (id) {
        return Store.getStudents().find(function (s) { return s.id === id; }) || { id: id, name: '(학생)' };
      }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
      render();
    }).catch(function (e) {
      host.innerHTML = '<div class="empty-state">' + (isMissing(e)
        ? '필기 사진용 표가 아직 없습니다. Supabase SQL Editor 에서 <code>migration-006-notes-photos.sql</code> 을 먼저 실행해 주세요.'
        : '불러오지 못했습니다 — ' + esc(e.message)) + '</div>';
    });
  }

  function photosOf(sid, date) {
    return (st.photos || []).filter(function (p) {
      return p.student_id === sid && p.lesson_date === date && (st.showHidden || !p.hidden_at);
    });
  }

  function render() {
    var host = $('#phTable');
    if (!st.rows.length) { host.innerHTML = '<div class="empty-state">이 반에 학생이 없습니다.</div>'; return; }
    if (!st.dates.length) {
      host.innerHTML = '<div class="empty-state">이 기간에 수업 날짜도, 올라온 필기도 없습니다.<br>' +
        '교재 「일정」에 수업 날짜를 넣으면 안 올린 학생도 보입니다.</div>';
      return;
    }
    var total = 0, missing = 0;
    var head = '<tr><th class="tb-stu">학생</th>' + st.dates.map(function (d) {
      return '<th class="tb-date">' + esc(Store.dateWithDow(d)) + '</th>';
    }).join('') + '<th class="tb-r">합계</th></tr>';
    var body = st.rows.map(function (s) {
      var sum = 0;
      var cells = st.dates.map(function (d) {
        var list = photosOf(s.id, d);
        var hidden = list.filter(function (p) { return p.hidden_at; }).length;
        var vis = list.length - hidden;
        sum += vis;
        total += vis;
        if (!list.length) {
          if (st.lessonDates[d] === 'lesson') missing++;
          return '<td class="tb-c"><span class="ph-none">' + (st.lessonDates[d] === 'lesson' ? '안 올림' : '–') + '</span></td>';
        }
        return '<td class="tb-c"><button type="button" class="ph-count" data-cell data-sid="' + s.id + '" data-date="' + d + '">' +
               vis + '장' + (hidden ? ' <span class="ph-hidden-tag">숨김 ' + hidden + '</span>' : '') + '</button></td>';
      }).join('');
      return '<tr><td class="tb-stu"><span class="roster__name">' + esc(s.name) + '</span></td>' + cells +
             '<td class="tb-r num">' + sum + '</td></tr>';
    }).join('');
    host.innerHTML = '<p class="panel__hint">이 기간 필기 ' + total + '장 · 수업 날짜 기준 안 올린 칸 ' + missing + '개</p>' +
      '<div class="roster-scroll"><table class="roster tb-table tb-grid">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ---------- 사진 보기 · 숨기기 · 완전 삭제 ---------- */

  function openCell(sid, date) {
    st.cell = { sid: sid, date: date };
    var s = Store.getStudents().find(function (x) { return x.id === sid; }) || {};
    $('#phGalleryTitle').textContent = (s.name || '') + ' · ' + Store.dateWithDow(date) + ' 수업 필기';
    $('#phGallery').innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    $('#phGalleryModal').showModal();
    renderGallery();
  }

  function renderGallery() {
    if (!st.cell) return;
    var list = (st.photos || []).filter(function (p) { return p.student_id === st.cell.sid && p.lesson_date === st.cell.date; });
    if (!list.length) { $('#phGallery').innerHTML = '<p class="panel__hint">사진이 없습니다.</p>'; return; }
    sb().storage.from('note-photos').createSignedUrls(list.map(function (p) { return p.path; }), 600).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var url = {};
      (r.data || []).forEach(function (x) { if (x.signedUrl) url[x.path] = x.signedUrl; });
      $('#phGallery').innerHTML = '<div class="ph-admin-grid">' + list.map(function (p) {
        return '<figure class="ph-admin-item' + (p.hidden_at ? ' is-hidden' : '') + '" data-id="' + p.id + '">' +
          '<a href="' + esc(url[p.path] || '#') + '" target="_blank" rel="noopener"><img alt="필기 사진" loading="lazy" src="' + esc(url[p.path] || '') + '"></a>' +
          '<figcaption><span class="muted-note">올림 ' + esc(fmtDT(p.created_at)) + ' · ' + Math.round(p.bytes / 1024) + 'KB</span>' +
          (p.hidden_at ? '<span class="ph-hidden-tag">숨김 · ' + esc(p.hidden_by || '') + ' · ' + esc(fmtDT(p.hidden_at)) + '</span>' : '') +
          '<span class="ph-admin-acts">' +
            (p.hidden_at ? '<button class="btn btn--sm" type="button" data-pact="show">보이기</button>'
                         : '<button class="btn btn--sm" type="button" data-pact="hide">숨기기</button>') +
            (isTeacher() ? '<button class="btn btn--sm btn--danger" type="button" data-pact="delete">완전 삭제</button>' : '') +
          '</span></figcaption></figure>';
      }).join('') + '</div>';
    }).catch(function (e) { $('#phGallery').innerHTML = '<p class="panel__hint">사진을 열지 못했습니다 — ' + esc(e.message) + '</p>'; });
  }

  function onGalleryClick(e) {
    var b = e.target.closest('[data-pact]');
    if (!b) return;
    var p = (st.photos || []).find(function (x) { return x.id === b.closest('[data-id]').dataset.id; });
    if (!p) return;
    var act = b.dataset.pact;
    if (act === 'hide' || act === 'show') {
      UI.guardedSave('필기 사진', function (chk) {
        return DB.updateIf('note_photos', { id: p.id }, { hidden_at: act === 'hide' ? new Date().toISOString() : null }, chk ? p.updated_at : '');
      }, load).then(function (res) {
        if (!res.ok) return;
        Object.assign(p, res.row);
        render(); renderGallery();
        toast(act === 'hide' ? '숨겼습니다. 학생·학부모 화면에서 안 보입니다' : '다시 보이게 했습니다', 'good');
      }).catch(function (x) { toast(x.message, 'bad'); });
      return;
    }
    if (act === 'delete') {
      UI.confirmAsk('필기 사진 완전 삭제', '파일과 기록을 모두 지웁니다. 되살릴 수 없습니다. 잠깐 가리려면 [숨기기]를 쓰세요.', '완전 삭제')
        .then(function (ok) {
          if (!ok) return;
          return sb().storage.from('note-photos').remove([p.path]).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            return sb().from('note_photos').delete().eq('id', p.id).select('id');
          }).then(check).then(function (r) {
            if (!r.data.length) throw new Error('완전 삭제 권한이 없습니다. migration-017 을 실행했는지 확인해 주세요.');
            st.photos = st.photos.filter(function (x) { return x.id !== p.id; });
            render(); renderGallery(); loadUsage();
            toast('완전히 지웠습니다', 'good');
          });
        }).catch(function (x) { toast(x.message, 'bad'); });
    }
  }

  /* ---------- 탭 · 다른 기기 ---------- */

  document.addEventListener('jt:tab', function (e) { if (e.detail.index === 6) show(); });

  var remoteTimer = null;
  window.addEventListener('jt:remote', function (e) {
    var t = (e.detail && e.detail.table) || '';
    if ((t !== 'note_photos' && t !== '*') || $('#panel-photo').hidden || !st.ready) return;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () {
      if ($('#phGalleryModal').open) { load(); return; }
      if (UI.isBusy($('#panel-photo'))) { if (window.Sync) Sync.markSkipped(); return; }
      load();
      loadUsage();
    }, 400);
  });
  window.addEventListener('jt:refreshed', function (e) {
    if ((e.detail && e.detail.local) && st.ready && !$('#panel-photo').hidden) load();
  });

})();
