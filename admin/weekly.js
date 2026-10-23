/* ============================================================
   weekly.js — 레포트 발송 → 1 작성 「반 공통」 안의 수업일 · 수업 영상 · 배부 자료/과제 파일 (migration-011)

   반과 주차(시작일)마다
     · 수업일      반마다 한 번 「수업 요일 · 첫 수업일」을 정하면 주차마다 저절로 계산 (assets/lesson.js)
                   휴강 · 보강은 [이번 수업만 바꾸기] — 그 수업 그 반만, 다음 수업부터는 원래 요일
     · 수업 영상    1차시 · 2차시 · 보강 (유튜브 링크만). 보강은 반 전체 또는 고른 학생만
     · 자료 파일    끌어다 놓기로 여러 개. 파일명에 '필수과제' / '선택과제' 가 있으면 그 분류, 아니면 배부 자료.
                    필수 · 선택은 학생에게 보여 주는 안내다 — 파일마다 분류 드롭다운으로 고른다 (눈에 띄게 · 20261029g)
                   올린 직후 분류를 보여 주고 바로 바꿀 수 있다.
   파일은 비공개 보관함(class-files)에만 올라간다. 학부모는 Edge Function(class-file)이 만든 2분짜리 주소로만 받는다.
   첫 페이지 그림 (migration-029 · filethumb.js · 20261029i) — PDF · JPG · PNG 를 올리면 브라우저가 가로 400px 안팎 그림을 만들어
     같은 폴더 「원래이름.thumb.jpg」로 올린다 (학생 화면 파일 카드 윗부분). 이미 올린 파일은 [미리보기 그림 만들기]로 한 번에.
     그림을 못 만들어도 파일은 그대로 올라간다. 파일을 지우면 그림도 같이 지운다.
   지우기: 직원 누구나 언제든 ([지난 파일 정리]). 지울 때마다 서버에 기록이 남는다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /does not exist|Could not find the|schema cache|relation .* does not exist/i.test((e && e.message) || ''); }
  var NEED_SQL = 'migration-011 SQL 을 먼저 실행해 주세요 (README 5-8).';
  var NEED_029 = '미리보기 그림은 migration-029 SQL 을 먼저 실행해 주세요 (README 5-26).';

  var BUCKET = 'class-files';
  var MAX_BYTES = 20 * 1024 * 1024;
  var DAY_MS = 24 * 3600 * 1000;
  var MIME = {
    pdf: 'application/pdf', hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'
  };
  var KINDS = [['material', '배부 자료'], ['required', '필수 과제'], ['optional', '선택 과제']];
  var KIND_LABEL = { material: '배부 자료', required: '필수 과제', optional: '선택 과제' };
  /* 기본은 「수업 영상(전체)」 하나 (1 · 2차시가 한 영상). 차시별 영상이 따로 있는 주는 1 · 2차시 칸 (migration-012) */
  var PARTS = [['full', '수업 영상(전체)'], ['1', '1차시'], ['2', '2차시'], ['makeup', '보강']];
  var PART_LABEL = { full: '수업 영상(전체)', '1': '1차시', '2': '2차시', makeup: '보강' };
  function defaultTitle(part) { return part === 'full' ? '수업 영상' : (PART_LABEL[part] || '') + ' 영상'; }

  var st = {
    cls: '', week: '', key: '', loading: null, missing: false,
    videos: [], files: [], fresh: {}, openWho: {}, me: { email: '', role: '' }, usage: null, busy: false, tmp: 0
  };

  /* ============================================================
     작은 도구
     ============================================================ */

  function extOf(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function baseName(name) { return String(name || '').normalize('NFC').replace(/\.[A-Za-z0-9]+$/, '').trim(); }

  /* 파일명 → 분류 */
  function classify(name) {
    var n = String(name || '').normalize('NFC');
    if (/필수\s*과제/.test(n)) return 'required';
    if (/선택\s*과제/.test(n)) return 'optional';
    return 'material';
  }

  function sizeText(b) {
    b = Number(b) || 0;
    if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
    return Math.max(1, Math.round(b / 1024)) + 'KB';
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /* 유튜브 주소만 받는다. http → https, 앞뒤 공백 정리 */
  function normalizeYoutube(u) {
    var v = String(u || '').trim().replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\//i.test(v) && /^(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(v)) v = 'https://' + v;
    return /^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)\/[^\s<>"']+$/i.test(v) && v.length <= 300 ? v : '';
  }

  function classStudents(cls) {
    return Store.activeStudents().filter(function (s) { return (s.className || '') === cls; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
  }

  function isTeacher() { return !!st.me.role; }   /* 조교 · 선생님 같은 권한 (migration-017) */
  function canDelete(f) {
    if (isTeacher()) return true;
    return !!st.me.email && f.created_by === st.me.email && (Date.now() - new Date(f.created_at).getTime()) < DAY_MS;
  }

  /* ============================================================
     그리기 — write.js 의 renderCommon 이 부른다
     ============================================================ */

  function render(cls, week) {
    if (!$('#wkLessonSub')) return;
    var key = (cls || '') + '|' + (week || '');
    st.cls = cls || ''; st.week = week || '';
    renderLesson();
    if (key !== st.key) {
      st.key = key;
      st.videos = []; st.files = []; st.fresh = {}; st.openWho = {};
      renderVideos(); renderFiles();
      load();
    }
    /* AI 수업 요약 (summary.js · migration-012) */
    if (window.Summary) Summary.render(st.cls, st.week);
    /* 복습테스트 (review.js · migration-013) — 과정이면 그 회차 첫 반 시험 목록이 기준 (다른 반에 맞춰진다 · 마감은 반마다 그 반 수업일) */
    if (window.Review) {
      if (isCourseKey()) {
        var c = Course.byKey(st.cls), ms = Course.membersAt(c, Course.roundOfWeek(c, st.week)).filter(function (m) { return m.date; });
        if (ms.length) Review.render(ms[0].cls, ms[0].week, { course: c, members: ms });
      } else Review.render(st.cls, st.week);
    }
  }

  function load() {
    var key = st.key, cls = st.cls, week = st.week;
    if (!cls || !week) { renderVideos(); renderFiles(); return Promise.resolve(); }
    var c = sb();
    st.loading = Promise.all([
      c.from('lesson_videos').select('*').eq('class_name', cls).eq('week_start', week).order('sort').order('created_at'),
      c.from('class_files').select('*').eq('class_name', cls).eq('week_start', week).order('created_at')
    ]).then(function (res) {
      if (key !== st.key) return;
      var err = res[0].error || res[1].error;
      st.missing = !!(err && isMissing(err));
      if (err && !st.missing) throw new Error(err.message);
      var keepNew = st.videos.filter(function (v) { return !v.id; });
      st.videos = (res[0].data || []).map(function (v) { return Object.assign({}, v); }).concat(keepNew);
      st.files = res[1].data || [];
      renderVideos(); renderFiles();
    }).catch(function (e) {
      toast('수업 영상 · 자료를 불러오지 못했습니다 — ' + e.message, 'bad');
    });
    return st.loading;
  }

  /* ============================================================
     수업일
     ============================================================ */

  function dowOptions(sel, withNone) {
    var order = [1, 2, 3, 4, 5, 6, 0];
    return (withNone ? '<option value="">정하지 않음</option>' : '') + order.map(function (d) {
      return '<option value="' + d + '"' + (String(sel) === String(d) ? ' selected' : '') + '>' + Lesson.DOW[d] + '요일</option>';
    }).join('');
  }

  /* 과정 칸(§과정)이 바뀌면 반마다 복사하도록 알린다 (course.js · 20261031a) */
  function changed() { window.dispatchEvent(new CustomEvent('jt:weekly-changed', { detail: { cls: st.cls, week: st.week } })); }
  function isCourseKey() { return !!(window.Course && Course.isKey(st.cls)); }

  function renderLesson() {
    var line = $('#wkLessonLine');
    /* 과정 — 반마다 그 회차 수업일 (반만 바꾸려면 그 반을 골라서) */
    if (isCourseKey()) {
      var c = Course.byKey(st.cls), no = Course.roundOfWeek(c, st.week);
      line.className = 'wk-line';
      line.textContent = Course.label(c, no) + ' — ' + Course.membersAt(c, no).map(function (m) {
        return Course.shortName(m.cls) + ' ' + (m.date ? Store.dateWithDow(m.date) : m.canceled ? '휴강' : '수업 요일 없음');
      }).join(' · ') + ' (한 반만 수업일을 바꾸려면 그 반을 골라서)';
      $('#btnWkSched').hidden = true; $('#btnWkWeek').hidden = true;
      $('#wkSchedEdit').hidden = true; $('#wkWeekEdit').hidden = true;
      return;
    }
    $('#btnWkSched').hidden = false;
    var sched = st.cls ? Store.schedOf(st.cls) : null;
    var L = st.cls ? Store.lessonOf(st.cls, st.week) : null;
    var ov = st.cls ? Store.classWeekOf(st.cls, st.week) : null;
    var text, cls = 'wk-line';
    if (!st.cls) text = '';
    else if (!sched) { text = '수업 요일을 아직 정하지 않았습니다 — 정해 두면 주차마다 수업일 · 과제 기간이 저절로 나옵니다'; cls += ' wk-line--none'; }
    else if (!L) text = '첫 수업일(' + Lesson.md(sched.first) + ') 전 주차입니다 — 레포트에는 예전처럼 기간만 나옵니다';
    else { text = Lesson.line(L); if (L.canceled) cls += ' wk-line--off'; }
    line.className = cls;
    line.textContent = text;
    if (ov) {
      var tag = document.createElement('span');
      tag.className = 'wk-tag';
      tag.textContent = '이 주만 바뀜';
      line.appendChild(tag);
    }
    $('#btnWkSched').textContent = sched ? '수업 요일 바꾸기' : '수업 요일 정하기';
    $('#btnWkSched').disabled = !st.cls;
    $('#btnWkWeek').hidden = !sched;
    if (!$('#wkSchedEdit').hidden && $('#wkSchedEdit').dataset.cls !== st.cls) $('#wkSchedEdit').hidden = true;
    if (!$('#wkWeekEdit').hidden && $('#wkWeekEdit').dataset.key !== st.key) $('#wkWeekEdit').hidden = true;
  }

  function openSched() {
    var box = $('#wkSchedEdit');
    if (!box.hidden) { box.hidden = true; return; }
    $('#wkWeekEdit').hidden = true;
    var s = Store.schedOf(st.cls) || { dow: '', extra: [], first: '' };
    box.dataset.cls = st.cls;
    box.innerHTML =
      '<div class="wk-edit">' +
        '<label class="field"><span class="field__label">기준 요일 (레포트 수업일)</span>' +
          '<select class="input" id="wkDow">' + dowOptions(s.dow, true) + '</select></label>' +
        '<div class="field"><span class="field__label">추가 요일 (주 2회 반만)</span><div class="wk-dows" id="wkExtra">' +
          [1, 2, 3, 4, 5, 6, 0].map(function (d) {
            return '<label class="chk-inline"><input type="checkbox" value="' + d + '"' +
                   ((s.extra || []).indexOf(d) !== -1 ? ' checked' : '') + '> ' + Lesson.DOW[d] + '</label>';
          }).join('') + '</div></div>' +
        '<label class="field"><span class="field__label">첫 수업일</span>' +
          '<input class="input" type="date" id="wkFirst" value="' + esc(s.first || '') + '"></label>' +
        '<p class="panel__hint" id="wkSchedHint">첫 수업일을 고르면 그 요일이 기준 요일로 들어갑니다. 첫 수업일 앞 주차의 레포트는 예전처럼 기간만 나옵니다.</p>' +
        '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" id="btnWkSchedSave">저장</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" id="btnWkSchedCancel">취소</button></div>' +
      '</div>';
    box.hidden = false;
  }

  function saveSched() {
    var dowV = $('#wkDow').value;
    var dow = dowV === '' ? null : Number(dowV);
    var extra = Array.prototype.map.call(document.querySelectorAll('#wkExtra input:checked'), function (i) { return Number(i.value); })
      .filter(function (d) { return d !== dow; });
    var first = $('#wkFirst').value || '';
    if (dow === null && (extra.length || first)) { toast('기준 요일을 먼저 골라 주세요', 'bad'); return; }
    if (first && dow !== null && Lesson.dowOf(first) !== dow && extra.indexOf(Lesson.dowOf(first)) === -1) {
      toast('첫 수업일(' + Lesson.md(first) + ')이 고른 수업 요일이 아닙니다 — 다시 골라 주세요', 'bad'); return;
    }
    var btn = $('#btnWkSchedSave'); btn.disabled = true;
    Store.setSchedule(st.cls, dow, extra, first).then(function () {
      $('#wkSchedEdit').hidden = true;
      toast(st.cls + ' 수업 요일을 저장했습니다', 'good');
    }).catch(function (e) { btn.disabled = false; toast(e.message, 'bad'); });
  }

  function openWeek() {
    var box = $('#wkWeekEdit');
    if (!box.hidden) { box.hidden = true; return; }
    $('#wkSchedEdit').hidden = true;
    var ov = Store.classWeekOf(st.cls, st.week);
    var L = Store.lessonOf(st.cls, st.week);
    var end = Lesson.addDays(st.week, 6);
    box.dataset.key = st.key;
    box.innerHTML =
      '<div class="wk-edit">' +
        '<p class="panel__hint">' + esc(st.cls) + ' · ' + (L && L.date ? Lesson.md(L.date) + ' 수업' : Lesson.md(st.week, false) + '~' + Lesson.md(end, false)) + ' 한 번만 바꿉니다. 다음 수업부터는 원래 요일로 계산합니다.</p>' +
        '<label class="chk-inline"><input type="radio" name="wkOv" value="move"' + (!ov || !ov.canceled ? ' checked' : '') + '> 수업일을 다른 날로</label>' +
        '<input class="input wk-ovdate" type="date" id="wkOvDate" value="' + esc((ov && ov.lesson_date) || (L && L.date) || '') + '">' +
        '<label class="chk-inline"><input type="radio" name="wkOv" value="cancel"' + (ov && ov.canceled ? ' checked' : '') + '> 휴강</label>' +
        '<label class="field"><span class="field__label">메모 (러닝노트에 같이 보입니다 · 선택)</span>' +
          '<input class="input" type="text" id="wkOvNote" maxlength="100" placeholder="예) 학교 시험으로 토요일 보강" value="' + esc((ov && ov.note) || '') + '"></label>' +
        '<div class="wk-edit__btns"><button class="btn btn--sm btn--primary" type="button" id="btnWkWeekSave">저장</button>' +
        (ov ? '<button class="btn btn--sm" type="button" id="btnWkWeekReset">원래 요일로</button>' : '') +
        '<button class="btn btn--sm btn--ghost" type="button" id="btnWkWeekCancel">취소</button></div>' +
      '</div>';
    box.hidden = false;
  }

  function saveWeek(reset) {
    var row = null;
    if (!reset) {
      var cancel = (document.querySelector('input[name="wkOv"]:checked') || {}).value === 'cancel';
      var date = $('#wkOvDate').value;
      if (!cancel && !date) { toast('바꿀 수업일을 골라 주세요', 'bad'); return; }
      row = { canceled: cancel, lesson_date: cancel ? null : date, note: $('#wkOvNote').value.trim() };
    }
    Store.setClassWeek(st.cls, st.week, row).then(function () {
      $('#wkWeekEdit').hidden = true;
      toast(reset ? '원래 요일로 되돌렸습니다' : '이번 수업일을 바꿨습니다', 'good');
    }).catch(function (e) { toast(e.message, 'bad'); });
  }

  /* ============================================================
     수업 영상
     ============================================================ */

  function renderVideos() {
    setTimeout(function () { window.dispatchEvent(new CustomEvent('jt:videos-changed')); }, 0);
    var host = $('#wkVideos');
    if (!host) return;
    if (st.missing) { host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    if (!st.videos.length) {
      host.innerHTML = '<p class="panel__hint">아직 없습니다. [+ 영상 추가]로 유튜브 링크를 넣으면 러닝노트 · 반 공지에 버튼으로 나갑니다.</p>';
      return;
    }
    var studs = classStudents(st.cls);
    host.innerHTML = st.videos.map(function (v) {
      var key = v.id || v.tmp;
      var who = v.student_ids || [];
      var whoText = who.length ? who.length + '명만' : '반 전체';
      /* 과정에서 복사된 영상은 과정 화면에서만 고치고 지운다 (20261031a) */
      if (v.course_src) {
        return '<div class="wk-video is-course" data-v="' + esc(key) + '"><div class="wk-video__row wk-video__row--course">' +
          '<span class="wk-tag wk-tag--course">과정 공통</span><span class="wk-video__ro">' + esc((PARTS.find(function (p) { return p[0] === v.part; }) || ['', ''])[1] + ' · ' + (v.title || defaultTitle(v.part))) + '</span>' +
          '<span class="muted-note">과정 화면에서 고칩니다</span></div></div>';
      }
      return '<div class="wk-video" data-v="' + esc(key) + '">' +
        '<div class="wk-video__row">' +
          '<select class="input wk-video__part" data-wk="part" aria-label="차시">' + PARTS.map(function (p) {
            return '<option value="' + p[0] + '"' + (v.part === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
          }).join('') + '</select>' +
          '<input class="input wk-video__title" data-wk="title" maxlength="100" placeholder="제목 (비우면 \'' + defaultTitle(v.part) + '\')" value="' + esc(v.title || '') + '">' +
          '<input class="input wk-video__url" data-wk="url" inputmode="url" placeholder="https://youtu.be/…" value="' + esc(v.url || '') + '">' +
          (v.part === 'makeup' ? '<button class="btn btn--sm" type="button" data-wk-act="who">' + whoText + '</button>' : '<span></span>') +
          '<button class="btn btn--sm btn--ghost" type="button" data-wk-act="vdel" aria-label="영상 지우기">×</button>' +
        '</div>' +
        (v.part === 'makeup' && st.openWho[key]
          ? '<div class="wk-who"><span class="panel__hint">아무도 안 고르면 반 전체에 보입니다. 고르면 그 학생 개인 링크에만 보입니다.</span><div class="wk-who__list">' +
              studs.map(function (s) {
                return '<label class="chk-inline"><input type="checkbox" data-wk="who" value="' + esc(s.id) + '"' +
                       (who.indexOf(s.id) !== -1 ? ' checked' : '') + '> ' + esc(s.name) + '</label>';
              }).join('') + '</div></div>'
          : '') +
        '<div class="wk-err" data-err>' + (v._err ? esc(v._err) : (!v.id ? '<span class="panel__hint">링크를 넣으면 저장됩니다</span>' : '')) + '</div>' +
      '</div>';
    }).join('');
  }

  function videoOf(el) {
    var box = el.closest('[data-v]');
    if (!box) return null;
    var k = box.dataset.v;
    return st.videos.find(function (v) { return (v.id || v.tmp) === k; }) || null;
  }

  function addVideo() {
    if (!st.cls) return;
    if (st.missing) { toast(NEED_SQL, 'bad'); return; }
    var parts = st.videos.map(function (v) { return v.part; });
    var part = !parts.length ? 'full'
      : parts.indexOf('full') !== -1 ? 'makeup'
      : parts.indexOf('1') !== -1 && parts.indexOf('2') === -1 ? '2' : 'makeup';
    st.videos.push({ tmp: 't' + (++st.tmp), part: part, title: '', url: '', student_ids: [] });
    renderVideos();
    var rows = document.querySelectorAll('#wkVideos .wk-video__url');
    if (rows.length) rows[rows.length - 1].focus();
  }

  /* 저장 뒤 그 줄만 고친다 — 다음 칸으로 옮겨 가던 커서를 잃지 않게 */
  function refreshRow(oldKey, v) {
    var box = document.querySelector('#wkVideos [data-v="' + oldKey + '"]');
    if (!box) { renderVideos(); return; }
    box.dataset.v = v.id || v.tmp;
    var err = box.querySelector('[data-err]');
    if (err) err.innerHTML = v._err ? esc(v._err) : (!v.id ? '<span class="panel__hint">링크를 넣으면 저장됩니다</span>' : '');
    var url = box.querySelector('[data-wk="url"]');
    if (url && document.activeElement !== url && url.value !== v.url) url.value = v.url;
    var who = box.querySelector('[data-wk-act="who"]');
    if (who) who.textContent = (v.student_ids || []).length ? v.student_ids.length + '명만' : '반 전체';
  }

  function saveVideo(v) {
    /* 저장 중에 또 고치면 끝난 뒤 한 번 더 (새 줄이 두 번 들어가지 않게) */
    if (v._saving) { v._again = true; return Promise.resolve(); }
    var oldKey = v.id || v.tmp;
    var url = normalizeYoutube(v.url);
    if (!url) {
      v._err = v.url ? '유튜브 링크(youtube.com · youtu.be)만 넣을 수 있습니다' : '';
      refreshRow(oldKey, v);
      return Promise.resolve();
    }
    v.url = url; v._err = '';
    var body = { class_name: st.cls, week_start: st.week, part: v.part, title: (v.title || '').trim(), url: url,
                 student_ids: v.part === 'makeup' ? (v.student_ids || []) : [],
                 sort: st.videos.indexOf(v) };
    var key = st.key;
    var p = v.id
      ? sb().from('lesson_videos').update(body).eq('id', v.id).select()
      : sb().from('lesson_videos').insert(body).select();
    v._saving = true;
    return p.then(function (r) {
      v._saving = false;
      if (r.error) throw new Error(isMissing(r.error) ? NEED_SQL : r.error.message);
      if (key !== st.key) return;
      var row = r.data && r.data[0];
      if (row) {
        var tmp = v.tmp;
        Object.assign(v, row);
        if (tmp && st.openWho[tmp]) { st.openWho[row.id] = true; delete st.openWho[tmp]; }
        delete v.tmp;
      }
      refreshRow(oldKey, v);
      if (v._again) { v._again = false; return saveVideo(v); }
      toast('수업 영상을 저장했습니다', 'good');
      changed();
    }).catch(function (e) {
      v._saving = false; v._again = false; v._err = '저장하지 못했습니다 — ' + e.message; refreshRow(oldKey, v);
    });
  }

  function onVideoChange(e) {
    var el = e.target, v = videoOf(el);
    if (!v || !el.dataset.wk) return;
    if (el.dataset.wk === 'part') {
      v.part = el.value;
      if (v.part !== 'makeup') v.student_ids = [];
      renderVideos();
    } else if (el.dataset.wk === 'title') v.title = el.value;
    else if (el.dataset.wk === 'url') v.url = el.value;
    else if (el.dataset.wk === 'who') {
      var ids = v.student_ids ? v.student_ids.slice() : [];
      var i = ids.indexOf(el.value);
      if (el.checked && i === -1) ids.push(el.value);
      if (!el.checked && i !== -1) ids.splice(i, 1);
      v.student_ids = ids;
    }
    saveVideo(v);
  }

  function onVideoClick(e) {
    var b = e.target.closest('[data-wk-act]');
    if (!b) return;
    var v = videoOf(b);
    if (!v) return;
    if (b.dataset.wkAct === 'who') {
      var k = v.id || v.tmp;
      st.openWho[k] = !st.openWho[k];
      renderVideos();
      return;
    }
    if (b.dataset.wkAct === 'vdel') {
      var drop = function () { st.videos = st.videos.filter(function (x) { return x !== v; }); renderVideos(); };
      if (!v.id) { drop(); return; }
      UI.confirmAsk('영상 지우기', (PART_LABEL[v.part] || '') + ' 영상 링크를 지웁니다. 러닝노트에서도 사라집니다.', '지우기').then(function (yes) {
        if (!yes) return;
        sb().from('lesson_videos').delete().eq('id', v.id).then(function (r) {
          if (r.error) { toast(r.error.message, 'bad'); return; }
          drop();
          toast('영상을 지웠습니다');
          changed();
        });
      });
    }
  }

  /* ============================================================
     자료 파일
     ============================================================ */

  function renderFiles() {
    var host = $('#wkFiles');
    if (!host) return;
    $('#btnWkCleanup').hidden = !isTeacher();
    if (st.missing) { host.innerHTML = '<p class="panel__hint">' + NEED_SQL + '</p>'; return; }
    if (!st.files.length) { host.innerHTML = '<p class="panel__hint">이 주차에 올린 파일이 없습니다.</p>'; return; }
    var order = { material: 0, required: 1, optional: 2 };
    var list = st.files.slice().sort(function (a, b) {
      return (order[a.kind] - order[b.kind]) || String(a.name).localeCompare(String(b.name), 'ko');
    });
    host.innerHTML = list.map(function (f) {
      var fresh = st.fresh[f.id];
      return '<div class="wk-file' + (fresh ? ' is-fresh' : '') + '" data-f="' + esc(f.id) + '">' +
        '<span class="wk-file__ext">' + esc(String(f.ext).toUpperCase()) + '</span>' +
        '<input class="input wk-file__name" data-wk="fname" maxlength="120" value="' + esc(f.name) + '" aria-label="보이는 이름"' + (f.course_src ? ' disabled' : '') + '>' +
        '<select class="input wk-file__kind wk-kind--' + esc(f.kind) + '" data-wk="kind" aria-label="학생에게 보이는 분류" title="학생에게 보이는 분류 — 필수 과제 · 선택 과제 · 배부 자료"' + (f.course_src ? ' disabled' : '') + '>' + KINDS.map(function (k) {
          return '<option value="' + k[0] + '"' + (f.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>';
        }).join('') + '</select>' +
        '<span class="wk-file__size num">' + sizeText(f.bytes) + (f.thumb_path ? ' <span class="wk-file__th" title="학생 화면 카드에 첫 페이지 그림이 보입니다">🖼</span>' : '') + '</span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-wk-act="fget">열기</button>' +
        (f.course_src ? '<span class="wk-tag wk-tag--course" title="과정 화면에서 고치고 지웁니다">과정 공통</span>'
          : canDelete(f) ? '<button class="btn btn--sm btn--ghost" type="button" data-wk-act="fdel" aria-label="파일 지우기">삭제</button>' : '<span></span>') +
        (fresh ? '<span class="wk-tag">방금 올림 · 자동 분류: ' + esc(KIND_LABEL[fresh]) + '</span>' : '') +
      '</div>';
    }).join('');
  }

  function fileOf(el) {
    var box = el.closest('[data-f]');
    return box ? st.files.find(function (f) { return f.id === box.dataset.f; }) || null : null;
  }

  function loadUsage() {
    var host = $('#wkUsage');
    if (!host) return Promise.resolve();
    return sb().rpc('storage_usage').then(function (r) {
      if (r.error) { host.innerHTML = ''; return; }
      var u = st.usage = r.data || {};
      var limit = u.limit || 1073741824;
      var pct = Math.min(100, Math.round((u.bytes || 0) / limit * 1000) / 10);
      var gb = function (b) { b = b || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(2) + 'GB' : (b / 1048576).toFixed(1) + 'MB'; };
      host.innerHTML = '<div class="ph-usage wk-usage"><div class="ph-usage__text">저장 공간 <b>' + gb(limit) + ' 중 ' + gb(u.bytes || 0) +
        ' (' + pct + '%)</b> 사용 <span class="muted-note">· 자료 파일 ' + (u.files || 0) + '개 ' + gb(u.file_bytes || 0) +
        (u.thumb_bytes != null ? ' · 미리보기 그림 ' + (u.thumbs || 0) + '개 ' + gb(u.thumb_bytes || 0) : '') +
        ' · 필기 사진 ' + (u.photos || 0) + '장 ' + gb(u.photo_bytes || 0) +
        (u.review_bytes != null ? ' · 시험지 사진 ' + (u.reviews || 0) + '장 ' + gb(u.review_bytes || 0) : '') + ' · 무료 1GB 기준</span></div>' +
        '<div class="progress__bar"><div class="progress__fill ph-usage__fill' + (pct >= 80 ? ' is-warn' : '') + '" style="width:' + pct + '%"></div></div>' +
        (pct >= 80 ? '<p class="wk-warn">⚠️ 저장 공간이 80%를 넘었습니다. [지난 파일 정리]로 지난 학기 파일을 지워 주세요. 가득 차면 사진 · 파일을 더 올릴 수 없습니다.</p>' : '') +
        '</div>';
    });
  }

  function uploadFiles(fileList) {
    if (!st.cls || !st.week) { toast('반과 주차를 먼저 골라 주세요', 'bad'); return; }
    if (st.missing) { toast(NEED_SQL, 'bad'); return; }
    if (st.busy) { toast('올리는 중입니다. 끝난 뒤 다시 해 주세요', 'bad'); return; }
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var ok = [], bad = [];
    files.forEach(function (f) {
      var ext = extOf(f.name);
      if (!MIME[ext]) bad.push(f.name + ' — 올릴 수 없는 형식');
      else if (!f.size) bad.push(f.name + ' — 빈 파일');
      else if (f.size > MAX_BYTES) bad.push(f.name + ' — 20MB 초과 (' + sizeText(f.size) + ')');
      else if (!baseName(f.name)) bad.push(f.name + ' — 이름이 없음');
      else ok.push(f);
    });
    var total = ok.reduce(function (n, f) { return n + f.size; }, 0);
    if (st.usage && st.usage.limit && (st.usage.bytes || 0) + total > st.usage.limit) {
      toast('저장 공간이 모자랍니다. 지난 파일을 정리한 뒤 다시 올려 주세요', 'bad');
      return;
    }
    var note = $('#wkUploadNote');
    if (!ok.length) { note.innerHTML = '<div class="wk-err">' + bad.map(esc).join('<br>') + '</div>'; return; }

    st.busy = true;
    var cls = st.cls, week = st.week, key = st.key;
    var done = 0, fails = bad.slice(), freshNow = {}, thumbQ = [];
    note.innerHTML = '<p class="panel__hint">올리는 중… 0 / ' + ok.length + '</p>';
    var chain = Promise.resolve();
    ok.forEach(function (f) {
      chain = chain.then(function () {
        var ext = extOf(f.name);
        var path = week + '/' + uuid() + '.' + ext;
        var kind = classify(f.name);
        return sb().storage.from(BUCKET).upload(path, f, { contentType: MIME[ext], upsert: false }).then(function (up) {
          if (up.error) throw new Error(/bucket not found/i.test(up.error.message) ? NEED_SQL : up.error.message);
          return sb().from('class_files').insert({
            class_name: cls, week_start: week, kind: kind, name: baseName(f.name).slice(0, 120),
            orig_name: f.name.normalize('NFC').slice(0, 200), ext: ext, mime: MIME[ext], bytes: f.size, path: path
          }).select().then(function (r) {
            if (r.error) {
              /* 기록을 못 남겼으면 올린 파일도 지운다 */
              return sb().storage.from(BUCKET).remove([path]).then(function () { throw new Error(isMissing(r.error) ? NEED_SQL : r.error.message); });
            }
            var row = r.data && r.data[0];
            if (row) { freshNow[row.id] = kind; if (key === st.key) st.files.push(row); }
            /* 첫 페이지 그림 — 못 만들어도 파일은 그대로 */
            if (row && window.FileThumb && FileThumb.can(ext)) thumbQ.push({ row: row, blob: f });     /* 다 올린 뒤에 따로 만든다 */
          });
        }).then(function () {
          done++;
        }, function (e) {
          fails.push(f.name + ' — ' + e.message);
        }).then(function () {
          note.innerHTML = '<p class="panel__hint">올리는 중… ' + (done + fails.length - bad.length) + ' / ' + ok.length + '</p>';
        });
      });
    });
    chain.then(function () {
      st.busy = false;
      if (key === st.key) Object.assign(st.fresh, freshNow);
      if (done) changed();
      var counts = { material: 0, required: 0, optional: 0 };
      Object.keys(freshNow).forEach(function (id) { counts[freshNow[id]]++; });
      note.innerHTML =
        (done ? '<p class="wk-done">✅ ' + done + '개를 올렸습니다 — 배부 자료 ' + counts.material + ' · 필수 과제 ' + counts.required +
                ' · 선택 과제 ' + counts.optional + '. 분류가 틀린 파일은 아래에서 바로 바꿔 주세요.</p>' : '') +
        (fails.length ? '<div class="wk-err">올리지 못한 파일<br>' + fails.map(esc).join('<br>') + '</div>' : '');
      renderFiles();
      loadUsage();
      if (done) toast(done + '개 파일을 올렸습니다', 'good');
      /* 첫 페이지 그림 — 파일을 다 올린 뒤 하나씩 (못 만들어도 파일은 그대로) · 끝나면 목록 · 저장 공간을 다시 */
      if (thumbQ.length) {
        thumbQ.reduce(function (p, x) {
          return p.then(function () { return makeThumb(x.row, x.blob).catch(function () { return null; }); });
        }, Promise.resolve()).then(function () { if (key === st.key) renderFiles(); loadUsage(); changed(); });
      }
    });
  }

  /* ---------- 첫 페이지 그림 (migration-029) ---------- */

  /* 한 파일 — blob(없으면 보관함에서 받는다) → 그림 → 같은 폴더 「….thumb.jpg」 → class_files.thumb_path.
     029 전이면(칸이 없으면) 올린 그림을 지우고 'missing' 으로 알린다 */
  function makeThumb(row, blob) {
    var get = blob ? Promise.resolve(blob) : sb().storage.from(BUCKET).download(row.path).then(function (r) {
      if (r.error || !r.data) throw new Error('파일을 받지 못했습니다');
      return r.data;
    });
    return get.then(function (b) { return FileThumb.make(b, row.ext); }).then(function (img) {
      if (!img) return null;
      var tp = FileThumb.pathOf(row.path);
      return sb().storage.from(BUCKET).upload(tp, img, { contentType: 'image/jpeg', upsert: false }).then(function (up) {
        if (up.error && !/exists|duplicate/i.test(up.error.message || '')) throw new Error(up.error.message);
        return sb().from('class_files').update({ thumb_path: tp, thumb_bytes: img.size }).eq('id', row.id).select().then(function (r) {
          if (r.error) {
            return sb().storage.from(BUCKET).remove([tp]).then(function () {
              if (isMissing(r.error)) { var e = new Error(NEED_029); e.missing = true; throw e; }
              throw new Error(r.error.message);
            });
          }
          row.thumb_path = tp; row.thumb_bytes = img.size;
          var mine = st.files.find(function (x) { return x.id === row.id; });
          if (mine) { mine.thumb_path = tp; mine.thumb_bytes = img.size; }
          return tp;
        });
      });
    });
  }

  /* [미리보기 그림 만들기] — 그 반의 모든 주에서 그림이 없는 PDF · JPG · PNG 를 한 번에 */
  function makeAllThumbs() {
    if (!st.cls) { toast('반을 먼저 골라 주세요', 'bad'); return; }
    if (st.busy) { toast('올리는 중입니다. 끝난 뒤 다시 해 주세요', 'bad'); return; }
    if (!window.FileThumb) return;
    var note = $('#wkUploadNote'), cls = st.cls;
    sb().from('class_files').select('*').eq('class_name', cls).is('thumb_path', null).in('ext', ['pdf', 'jpg', 'jpeg', 'png']).order('week_start').then(function (r) {
      if (r.error) { toast(isMissing(r.error) ? NEED_029 : r.error.message, 'bad'); return; }
      var list = r.data || [];
      if (!list.length) { toast(cls + ' — 그림을 만들 PDF · 사진 파일이 없습니다 (모두 만들어져 있습니다)'); return; }
      st.busy = true;
      var done = 0, fails = [];
      note.innerHTML = '<p class="panel__hint">미리보기 그림 만드는 중… 0 / ' + list.length + '</p>';
      list.reduce(function (p, f) {
        return p.then(function () {
          return makeThumb(f, null).then(function (tp) { if (tp) done++; }, function (e) {
            fails.push(f.name + ' — ' + e.message);
            if (e.missing) throw e;
          }).then(function () {
            note.innerHTML = '<p class="panel__hint">미리보기 그림 만드는 중… ' + (done + fails.length) + ' / ' + list.length + '</p>';
          });
        });
      }, Promise.resolve()).catch(function () {}).then(function () {
        st.busy = false;
        note.innerHTML = (done ? '<p class="wk-done">✅ 미리보기 그림 ' + done + '개를 만들었습니다 — 학생 화면 파일 카드에 첫 페이지가 보입니다.</p>' : '') +
          (fails.length ? '<div class="wk-err">만들지 못한 파일<br>' + fails.map(esc).join('<br>') + '</div>' : '');
        renderFiles(); loadUsage();
        if (done) toast('미리보기 그림 ' + done + '개를 만들었습니다', 'good');
      });
    });
  }

  function onFileChange(e) {
    var el = e.target, f = fileOf(el);
    if (!f || !el.dataset.wk) return;
    var patch = {};
    if (el.dataset.wk === 'kind') patch.kind = el.value;
    if (el.dataset.wk === 'fname') {
      var n = el.value.trim();
      if (!n) { el.value = f.name; toast('이름을 비울 수 없습니다', 'bad'); return; }
      patch.name = n.slice(0, 120);
    }
    sb().from('class_files').update(patch).eq('id', f.id).select().then(function (r) {
      if (r.error) { toast('바꾸지 못했습니다 — ' + r.error.message, 'bad'); return; }
      Object.assign(f, (r.data && r.data[0]) || patch);
      if (patch.kind) { delete st.fresh[f.id]; renderFiles(); }
      toast(patch.kind ? KIND_LABEL[patch.kind] + '(으)로 바꿨습니다' : '이름을 바꿨습니다', 'good');
      changed();
    });
  }

  function onFileClick(e) {
    var b = e.target.closest('[data-wk-act]');
    if (!b) return;
    var f = fileOf(b);
    if (!f) return;
    if (b.dataset.wkAct === 'fget') {
      sb().storage.from(BUCKET).createSignedUrl(f.path, 60, { download: f.name + '.' + f.ext }).then(function (r) {
        if (r.error || !r.data) { toast('열지 못했습니다 — ' + ((r.error && r.error.message) || ''), 'bad'); return; }
        window.open(r.data.signedUrl, '_blank', 'noopener');
      });
      return;
    }
    if (b.dataset.wkAct === 'fdel') {
      UI.confirmAsk('파일 지우기', '「' + f.name + '」을(를) 지웁니다. 러닝노트에서도 사라지고 되살릴 수 없습니다. 지운 기록은 남습니다.', '지우기').then(function (yes) {
        if (!yes) return;
        removeFiles([f]).then(function (n) {
          if (!n) return;
          st.files = st.files.filter(function (x) { return x.id !== f.id; });
          renderFiles(); loadUsage();
          toast('파일을 지웠습니다');
          changed();
        }).catch(function (err) { toast(err.message, 'bad'); });
      });
    }
  }

  /* 파일부터 지우고 기록 줄을 지운다 (줄을 먼저 지우면 보관함 권한 확인이 안 된다). 지운 개수를 돌려준다 */
  function removeFiles(list) {
    var n = 0;
    var chunks = [];
    for (var i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
    return chunks.reduce(function (p, part) {
      return p.then(function () {
        /* 첫 페이지 그림도 같이 (migration-029) */
        /* 과정에서 복사된 줄(course_src)은 원본과 같은 파일을 가리킨다 — 줄만 지우고 파일은 그대로 (20261031a) */
        var paths = [];
        part.forEach(function (f) { if (f.course_src) return; paths.push(f.path); if (f.thumb_path) paths.push(f.thumb_path); });
        return (paths.length ? sb().storage.from(BUCKET).remove(paths) : Promise.resolve({})).then(function (r) {
          if (r.error) throw new Error('보관함에서 지우지 못했습니다 — ' + r.error.message);
          return sb().from('class_files').delete().in('id', part.map(function (f) { return f.id; })).select('id');
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          n += (r.data || []).length;
          if ((r.data || []).length < part.length) throw new Error('지울 권한이 없는 파일이 있습니다 (조교는 하루 안에 자기가 올린 파일만)');
        });
      });
    }, Promise.resolve()).then(function () { return n; });
  }

  /* ---------- 지난 파일 정리 ---------- */

  var clean = { rows: [] };

  function openCleanup() {
    if (!isTeacher()) return;
    var d = DDay.today();
    $('#wkCleanBefore').value = Lesson.addDays(d, -120);
    $('#wkCleanList').innerHTML = '<p class="panel__hint">날짜를 고르고 [찾기]를 누르세요. 그 날짜보다 앞선 주차의 파일이 나옵니다.</p>';
    $('#btnWkCleanGo').disabled = true;
    clean.rows = [];
    loadCleanLog();
    $('#wkCleanModal').showModal();
  }

  function findCleanup() {
    var before = $('#wkCleanBefore').value;
    if (!before) { toast('날짜를 골라 주세요', 'bad'); return; }
    $('#wkCleanList').innerHTML = '<p class="panel__hint">찾는 중…</p>';
    var q0 = sb().from('class_files').select('*').lt('week_start', before);
    if (!(window.Course && Course.missing())) q0 = q0.is('course_src', null);      /* 과정 복사 줄은 원본과 함께 지워진다 (033) */
    q0.order('week_start').then(function (r) {
      if (r.error) { $('#wkCleanList').innerHTML = '<p class="panel__hint">' + esc(isMissing(r.error) ? NEED_SQL : r.error.message) + '</p>'; return; }
      clean.rows = r.data || [];
      if (!clean.rows.length) {
        $('#wkCleanList').innerHTML = '<p class="panel__hint">' + Lesson.md(before) + ' 앞 주차의 파일이 없습니다.</p>';
        $('#btnWkCleanGo').disabled = true;
        return;
      }
      var by = {};
      clean.rows.forEach(function (f) { (by[f.class_name] = by[f.class_name] || []).push(f); });
      $('#wkCleanList').innerHTML = '<div class="wk-clean">' + Object.keys(by).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (c) {
        var l = by[c], bytes = l.reduce(function (n, f) { return n + (f.bytes || 0); }, 0);
        return '<label class="wk-clean__row"><input type="checkbox" data-clean="' + esc(c) + '" checked> ' +
          '<b>' + esc(c) + '</b> <span class="num">' + l.length + '개 · ' + sizeText(bytes) + '</span>' +
          '<span class="muted-note"> · ' + esc(Store.lessonLabel(c, l[0].week_start)) + ' ~ ' + esc(Store.lessonLabel(c, l[l.length - 1].week_start)) + '</span></label>';
      }).join('') + '</div>';
      $('#btnWkCleanGo').disabled = false;
    });
  }

  function runCleanup() {
    var picked = Array.prototype.map.call(document.querySelectorAll('#wkCleanList [data-clean]:checked'), function (i) { return i.dataset.clean; });
    var list = clean.rows.filter(function (f) { return picked.indexOf(f.class_name) !== -1; });
    if (!list.length) { toast('지울 반을 골라 주세요', 'bad'); return; }
    var bytes = list.reduce(function (n, f) { return n + (f.bytes || 0); }, 0);
    $('#wkCleanModal').close();
    UI.confirmAsk('지난 파일 정리', picked.join(', ') + ' — 파일 ' + list.length + '개 (' + sizeText(bytes) + ')를 완전히 지웁니다. 러닝노트에서도 사라지고 되살릴 수 없습니다. 지운 기록은 남습니다.', '모두 지우기').then(function (yes) {
      if (!yes) { $('#wkCleanModal').showModal(); return; }
      toast('지우는 중입니다…');
      removeFiles(list).then(function (n) {
        toast(n + '개 파일을 지웠습니다', 'good');
        var gone = {}; list.forEach(function (f) { gone[f.id] = 1; });
        st.files = st.files.filter(function (f) { return !gone[f.id]; });
        renderFiles(); loadUsage();
      }).catch(function (e) { toast(e.message, 'bad'); loadUsage(); });
    });
  }

  function loadCleanLog() {
    var host = $('#wkCleanLog');
    sb().from('class_file_log').select('*').order('at', { ascending: false }).limit(20).then(function (r) {
      if (r.error || !(r.data || []).length) { host.innerHTML = '<p class="panel__hint">아직 지운 기록이 없습니다.</p>'; return; }
      host.innerHTML = '<ul class="ca-log">' + r.data.map(function (l) {
        var d = new Date(l.at);
        return '<li><span class="num">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span> ' + esc(l.by_name) + ' · ' +
               esc(l.class_name) + ' · ' + esc(l.name) + ' <span class="muted-note">(' + esc(KIND_LABEL[l.kind] || '') + ' · ' + sizeText(l.bytes) + ')</span></li>';
      }).join('') + '</ul>';
    });
  }

  /* ============================================================
     시작
     ============================================================ */

  function bind() {
    if (!$('#wkLessonSub')) return;
    $('#btnWkSched').addEventListener('click', openSched);
    $('#btnWkWeek').addEventListener('click', openWeek);
    $('#wkSchedEdit').addEventListener('click', function (e) {
      if (e.target.id === 'btnWkSchedSave') saveSched();
      if (e.target.id === 'btnWkSchedCancel') $('#wkSchedEdit').hidden = true;
    });
    $('#wkSchedEdit').addEventListener('change', function (e) {
      if (e.target.id !== 'wkFirst' || !e.target.value) return;
      var d = Lesson.dowOf(e.target.value);
      var sel = $('#wkDow');
      if (sel.value === '') sel.value = String(d);
      $('#wkSchedHint').textContent = Lesson.md(e.target.value) + '은(는) ' + Lesson.DOW[d] + '요일입니다' +
        (sel.value !== String(d) ? ' — 기준 요일과 다릅니다. 맞는지 확인해 주세요.' : '.');
    });
    $('#wkWeekEdit').addEventListener('click', function (e) {
      if (e.target.id === 'btnWkWeekSave') saveWeek(false);
      if (e.target.id === 'btnWkWeekReset') saveWeek(true);
      if (e.target.id === 'btnWkWeekCancel') $('#wkWeekEdit').hidden = true;
    });

    $('#btnWkAddVideo').addEventListener('click', addVideo);
    $('#wkVideos').addEventListener('change', onVideoChange);
    $('#wkVideos').addEventListener('click', onVideoClick);

    var drop = $('#wkDrop');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) { uploadFiles(e.dataTransfer && e.dataTransfer.files); });
    $('#wkFileInput').addEventListener('change', function (e) { uploadFiles(e.target.files); e.target.value = ''; });
    $('#wkFiles').addEventListener('change', onFileChange);
    $('#wkFiles').addEventListener('click', onFileClick);

    $('#btnWkCleanup').addEventListener('click', openCleanup);
    $('#btnWkThumbs').addEventListener('click', makeAllThumbs);
    $('#btnWkCleanFind').addEventListener('click', findCleanup);
    $('#btnWkCleanGo').addEventListener('click', runCleanup);
    $('#btnWkCleanClose').addEventListener('click', function () { $('#wkCleanModal').close(); });

    /* 수업 요일이 바뀌면 수업일 줄과 레포트 미리보기를 다시 */
    window.addEventListener('jt:schedule-changed', function () {
      renderLesson();
      if (window.Writer && Writer.preview) Writer.preview();
    });
    /* 다른 기기에서 바꾼 것 (sync.js 실시간) */
    window.addEventListener('jt:remote', function (e) {
      var t = e.detail && e.detail.table;
      if ((t === 'lesson_videos' || t === 'class_files') && st.key && !UI.isBusy($('#commonPanel')) && !st.busy) load();
    });
    window.addEventListener('jt:refreshed', function () { if (st.key) renderLesson(); });
    window.addEventListener('jt:loaded', function () {
      st.key = '';
      DB.myStaff().then(function (m) { st.me.role = (m && m.role) || ''; renderFiles(); });
      SB.getSession().then(function (s) { st.me.email = String((s && s.user && s.user.email) || '').toLowerCase(); renderFiles(); }).catch(function () {});
      loadUsage();
    });
  }

  bind();

  /* 자막 붙여 넣기(summary.js)에서 — 그 주 영상 칸이 비어 있을 때만 「수업 영상(전체)」 한 줄로 넣는다 */
  function addVideoUrl(cls, week, url, title) {
    if (!st.cls || st.missing || st.cls !== cls || st.week !== week) return Promise.resolve(false);
    if (st.videos.some(function (x) { return x.id || String(x.url || '').trim(); })) return Promise.resolve(false);
    var u = normalizeYoutube(url);
    if (!u) return Promise.resolve(false);
    /* 링크를 아직 안 넣은 빈 줄이 있으면 그 줄을 쓴다 */
    var v = st.videos[0] || { tmp: 't' + (++st.tmp), part: 'full', student_ids: [] };
    v.url = u;
    if (title && !String(v.title || '').trim()) v.title = String(title).trim().slice(0, 100);
    if (!st.videos.length) st.videos.push(v);
    renderVideos();
    return saveVideo(v).then(function () { return !!v.id; });
  }

  /* 「오늘」 [수업일 미정 · 수업 요일 정하기] — 닫혀 있으면 연다 (20261030e) */
  function openSchedNow() { if ($('#wkSchedEdit').hidden) openSched(); }
  window.Weekly = { render: render, classify: classify, normalizeYoutube: normalizeYoutube, reload: load,
                    openSched: openSchedNow,
                    videos: function () { return st.videos.slice(); }, addVideoUrl: addVideoUrl,
                    where: function () { return { cls: st.cls, week: st.week }; },
                    /* 코멘트 「AI로 초안 쓰기」 자료 — 그 반 그 주 파일 이름 · 분류 (write.js · 20261029g) */
                    fileFacts: function (cls, week) {
                      if (st.cls !== cls || st.week !== week) return null;
                      return st.files.map(function (f) { return { 이름: f.name, 분류: KIND_LABEL[f.kind] || '배부 자료' }; });
                    } };

})();
