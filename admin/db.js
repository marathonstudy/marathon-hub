/* ============================================================
   db.js — Supabase 읽기·쓰기

   화면 코드는 되도록 store.js 를 거친다. 저장할 때 여기로 넘어온다.

   여러 기기·여러 조교가 동시에 쓴다. 그래서
     · 목록 전체를 서버에 덮어쓰지 않는다. 고친 줄(항목)만 보낸다.
     · 화면 목록에 없다는 이유로 서버 줄을 지우지 않는다. 지우기는 삭제 버튼 → 그 줄 하나.
     · 고칠 때는 내가 불러온 뒤 다른 분이 고쳤는지(updated_at) 확인한다 (updateIf).
   표 이름과 칸 이름은 supabase/schema.sql 과 맞춘다.
   화면에서는 camelCase, DB 에서는 snake_case 를 쓰므로 여기서 바꿔 준다.
   ============================================================ */

(function (global) {
  'use strict';

  function sb() { return SB.client; }

  function check(r) {
    if (r && r.error) throw new Error(r.error.message);
    return r;
  }

  /* ---------- 학생 ---------- */

  function toDbStudent(s) {
    return {
      id: s.id,
      name: s.name || '',
      school: s.school || '',
      grade: s.grade || '',
      class_name: s.className || '',
      parent_title: s.parentTitle || '',
      parent_phone: s.parentPhone || '',
      student_phone: s.studentPhone || '',
      extra: s.extra || {},
      archived: !!s.archived,
      sort_order: s.sortOrder || 0
    };
  }

  function fromDbStudent(r) {
    return {
      id: r.id,
      name: r.name,
      school: r.school || '',
      grade: r.grade || '',
      className: r.class_name || '',
      parentTitle: r.parent_title || '',
      parentPhone: r.parent_phone || '',
      studentPhone: r.student_phone || '',
      extra: r.extra || {},
      archived: !!r.archived,
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at || ''
    };
  }

  /* ---------- 한 줄 저장 · 동시 수정 확인 ----------
     여러 기기에서 같이 쓴다. 화면 목록 전체를 서버에 덮어쓰지 않는다.
     고친 줄 하나만, 내가 불러온 뒤 아무도 안 고쳤을 때만(updated_at 이 같을 때만) 저장한다.

     결과: { ok: true, row }            저장됨
           { conflict: true, row }      다른 분이 먼저 고침 (row = 서버의 지금 줄)
           { gone: true }               다른 분이 지움
     base 가 비어 있으면(예전 줄이라 수정 시각을 모를 때) 확인 없이 저장한다. */
  function updateIf(table, match, patch, base) {
    var q = sb().from(table).update(patch).match(match);
    if (base) q = q.eq('updated_at', base);
    return q.select('*').then(check).then(function (r) {
      if (r.data && r.data.length) return { ok: true, row: r.data[0] };
      return sb().from(table).select('*').match(match).maybeSingle().then(check).then(function (c) {
        return c.data ? { conflict: true, row: c.data } : { gone: true };
      });
    });
  }

  /* 그 줄의 지금 수정 시각 (고치기 창에서 저장 직전에 확인) */
  function currentAt(table, match) {
    return sb().from(table).select('updated_at').match(match).maybeSingle().then(check)
      .then(function (r) { return r.data ? (r.data.updated_at || '') : null; });
  }

  /* 학생 한 명. base === null 이면 새 학생(추가), 아니면 그 줄만 고친다. */
  function saveStudentRow(s, base) {
    var row = toDbStudent(s);
    if (base === null) {
      return sb().from('students').insert(row).select('*').then(check)
        .then(function (r) { return { ok: true, row: r.data[0] }; });
    }
    var patch = Object.assign({}, row);
    delete patch.id;
    return updateIf('students', { id: s.id }, patch, base);
  }

  /* 삭제 버튼을 눌렀을 때만, 그 학생 한 명만 */
  function deleteStudentRow(id) {
    return sb().from('students').delete().eq('id', id).then(check);
  }

  /* 교재 지급·청구 기록이 있어 지울 수 없는 학생 id.
     2단계 SQL(migration-002-textbook.sql)을 아직 안 돌렸으면 빈 목록 → 1단계 그대로 동작한다. */
  function lockedStudentIds() {
    return sb().rpc('tb_locked_students').then(function (r) {
      if (r.error) {
        if (/Could not find the function|does not exist|schema cache/i.test(r.error.message)) return [];
        throw new Error(r.error.message);
      }
      return (r.data || []).map(function (x) { return typeof x === 'string' ? x : x.tb_locked_students; })
        .filter(Boolean);
    });
  }

  /* ---------- 개인 링크 · 앱 공유 코드 ----------
     명단과 따로, 한 줄씩 바로 저장한다. */

  function fromDbLink(r) {
    return {
      hubCode: r.hub_code || '',
      appCode: r.app_share_code || '',
      hubIssuedAt: r.hub_issued_at || '',
      appUpdatedAt: r.app_code_updated_at || ''
    };
  }

  /* patch: { hubCode?, appCode? } — 준 것만 바꾼다 */
  function saveLink(studentId, patch) {
    var row = { student_id: studentId };
    var now = new Date().toISOString();
    if (patch.hubCode !== undefined) { row.hub_code = patch.hubCode || null; row.hub_issued_at = now; }
    if (patch.appCode !== undefined) { row.app_share_code = patch.appCode || ''; row.app_code_updated_at = now; }
    return sb().from('student_links').upsert(row, { onConflict: 'student_id' })
      .select('*')
      .then(check)
      .then(function (r) { return fromDbLink((r.data && r.data[0]) || row); });
  }

  /* 여러 명 한꺼번에 (엑셀 넣기 · 링크 일괄 발급) */
  function saveLinks(list) {
    if (!list.length) return Promise.resolve();
    var now = new Date().toISOString();
    var withHub = [], withApp = [];
    list.forEach(function (p) {
      if (p.hubCode !== undefined) withHub.push({ student_id: p.studentId, hub_code: p.hubCode, hub_issued_at: now });
      if (p.appCode !== undefined) withApp.push({ student_id: p.studentId, app_share_code: p.appCode, app_code_updated_at: now });
    });
    var c = sb();
    return Promise.resolve()
      .then(function () { return withHub.length ? c.from('student_links').upsert(withHub, { onConflict: 'student_id' }).then(check) : null; })
      .then(function () { return withApp.length ? c.from('student_links').upsert(withApp, { onConflict: 'student_id' }).then(check) : null; });
  }

  /* ---------- 내가 만든 칸 (field_defs) ---------- */

  function toDbField(f) {
    return {
      id: f.id, key: f.key, label: f.label || '', type: f.type || 'text',
      options: f.options || [], show_in_table: f.showInTable !== false,
      scope: f.scope === 'class' ? 'class' : 'student', sort_order: f.sortOrder || 0
    };
  }

  function fromDbField(r) {
    return {
      id: r.id, key: r.key, label: r.label || '', type: r.type || 'text',
      options: r.options || [], showInTable: r.show_in_table !== false,
      scope: r.scope === 'class' ? 'class' : 'student', sortOrder: r.sort_order || 0,
      updatedAt: r.updated_at || ''
    };
  }

  /* 칸 하나. base === null 이면 새 칸 */
  function saveFieldRow(f, base) {
    var row = toDbField(f);
    if (base === null) {
      return sb().from('field_defs').insert(row).select('*').then(check)
        .then(function (r) { return { ok: true, row: r.data[0] }; });
    }
    var patch = Object.assign({}, row);
    delete patch.id;
    return updateIf('field_defs', { id: f.id }, patch, base);
  }

  function deleteFieldRow(id) {
    return sb().from('field_defs').delete().eq('id', id).then(check);
  }

  /* ---------- 반 현황 (class_info) ---------- */

  /* 반 하나. base === null 이면 처음 적는 반 (그새 다른 분이 먼저 만들었으면 conflict) */
  function saveClassInfoRow(name, extra, base) {
    if (base === null) {
      return sb().from('class_info').insert({ class_name: name, extra: extra || {} }).select('*')
        .then(function (r) {
          if (r.error && /duplicate/i.test(r.error.message)) {
            return sb().from('class_info').select('*').eq('class_name', name).maybeSingle().then(check)
              .then(function (c) { return { conflict: true, row: c.data }; });
          }
          check(r);
          return { ok: true, row: r.data[0] };
        });
    }
    return updateIf('class_info', { class_name: name }, { extra: extra || {}, updated_at: new Date().toISOString() }, base);
  }

  /* ---------- 반 목록 (classes · migration-009) ---------- */

  /* 새 반 하나. 그새 다른 분이 같은 이름으로 만들었으면 그대로 성공으로 본다.
     { ok } / { missing: true } (표가 아직 없음) */
  function addClassRow(name) {
    return sb().from('classes').insert({ name: name }).then(function (r) {
      if (!r.error) return { ok: true };
      if (r.error.code === '23505' || /duplicate/i.test(r.error.message)) return { ok: true };
      if (r.error.code === '42P01' || /does not exist|schema cache|Could not find/i.test(r.error.message)) return { missing: true };
      throw new Error(r.error.message);
    });
  }

  /* ---------- 주간 입력 ---------- */

  function fromDbEntry(r) {
    return {
      attendStatus: r.attend_status || '',
      attendNote: r.attend_note || '',
      focusScore: r.focus_score || 0,
      scores: r.scores || {},
      homework: r.homework || {},
      onTimeRate: r.on_time_rate == null ? 100 : r.on_time_rate,
      comment: r.comment || ''
    };
  }

  function fromDbCommon(r) {
    return {
      lessons: (r.lessons && r.lessons.length) ? r.lessons : [''],
      tests: (r.tests && r.tests.length) ? r.tests : [''],
      comment: r.comment || '',
      homework: Array.isArray(r.homework) ? r.homework : []
    };
  }

  /* ============================================================
     전체 읽기 — 로그인 직후 한 번
     ============================================================ */

  function loadAll() {
    var c = sb();
    return Promise.all([
      c.from('students').select('*').order('class_name').order('name'),
      c.from('snippets').select('*').order('sort_order'),
      c.from('field_defs').select('*').order('sort_order'),
      c.from('class_info').select('*'),
      c.from('student_links').select('*'),
      c.from('published').select('week_start,student_id,visible,published_at'),
      c.from('sent').select('*'),
      c.from('week_meta').select('*'),
      /* 마지막으로 손댄 주차. 로그인하면 이 주차를 연다. */
      c.from('entries').select('week_start,updated_at').order('updated_at', { ascending: false }).limit(1),
      /* 반 기준 표 (migration-009). 아직 없으면 null — 예전처럼 학생의 반으로만 목록을 만든다 */
      c.from('classes').select('name,created_at').order('name').then(function (r) {
        return r.error ? { data: null } : r;
      })
    ]).then(function (res) {
      res.forEach(function (r) {
        if (r.error) throw new Error('불러오기 실패: ' + r.error.message);
      });

      var links = {};
      res[4].data.forEach(function (r) { links[r.student_id] = fromDbLink(r); });

      var published = {};
      res[5].data.forEach(function (r) {
        published[r.week_start] = published[r.week_start] || {};
        published[r.week_start][r.student_id] = { visible: r.visible, publishedAt: r.published_at };
      });

      var sent = {};
      res[6].data.forEach(function (r) {
        sent[r.week_start] = sent[r.week_start] || {};
        sent[r.week_start][r.student_id] = { at: r.sent_at, via: r.via, by: r.sent_by };
      });

      var weekEnds = {};
      res[7].data.forEach(function (r) { weekEnds[r.week_start] = r.week_end; });

      var classInfo = {}, classInfoAt = {};
      res[3].data.forEach(function (r) { classInfo[r.class_name] = r.extra || {}; classInfoAt[r.class_name] = r.updated_at || ''; });

      return {
        students: res[0].data.map(fromDbStudent),
        snippets: res[1].data.map(function (r) { return { id: r.id, text: r.text, updatedAt: r.updated_at || '' }; }),
        classInfoAt: classInfoAt,
        fieldDefs: res[2].data.map(fromDbField),
        classInfo: classInfo,
        links: links,
        published: published,
        sent: sent,
        weekEnds: weekEnds,
        latestWeek: (res[8].data[0] && res[8].data[0].week_start) || '',
        classes: res[9].data ? res[9].data.map(function (r) { return r.name; }) : null
      };
    });
  }

  /* 한 주차의 반 공통 + 학생별 입력 + 종료일 */
  function loadWeek(weekStart) {
    var c = sb();
    return Promise.all([
      c.from('week_common').select('*').eq('week_start', weekStart),
      c.from('entries').select('*').eq('week_start', weekStart),
      c.from('week_meta').select('week_end').eq('week_start', weekStart).limit(1)
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw new Error(r.error.message); });
      var common = {}, rawCommon = {};
      res[0].data.forEach(function (r) { common[r.class_name] = fromDbCommon(r); rawCommon[r.class_name] = r; });
      var entries = {}, rawEntries = {};
      res[1].data.forEach(function (r) { entries[r.student_id] = fromDbEntry(r); rawEntries[r.student_id] = r; });
      var weekEnd = res[2].data.length ? res[2].data[0].week_end : '';
      return { common: common, entries: entries, weekEnd: weekEnd, rawCommon: rawCommon, rawEntries: rawEntries };
    });
  }

  /* ============================================================
     쓰기
     ============================================================ */

  function saveWeekMeta(weekStart, weekEnd) {
    if (!weekStart || !weekEnd || weekEnd < weekStart) return Promise.resolve({ skipped: true });
    return sb().from('week_meta').upsert({
      week_start: weekStart, week_end: weekEnd, updated_at: new Date().toISOString()
    }, { onConflict: 'week_start' }).then(check);
  }

  /* 주간 입력 — 바뀐 항목만 (SQL entry_patch).
     set  : {"attend_status":"late", "homework.h1":{…}, "scores.0":95, "comment":"…"}
     base : 내가 불러왔던 값 (글로 쓰는 항목만). 서버 값이 다르면 그 항목은 저장하지 않고 conflicts 로 돌려준다. */
  function entryPatch(weekStart, studentId, set, base, force) {
    return sb().rpc('entry_patch', {
      p_week: weekStart, p_student: studentId, p_set: set, p_base: base || {}, p_force: !!force
    }).then(check).then(function (r) { return r.data; });
  }

  /* 반 공통 — 바뀐 항목만 (SQL common_patch) */
  function commonPatch(weekStart, className, set, base, force) {
    return sb().rpc('common_patch', {
      p_week: weekStart, p_class: className, p_set: set, p_base: base || {}, p_force: !!force
    }).then(check).then(function (r) { return r.data; });
  }

  /* 성적 칸 — 바뀐 칸만 (SQL grade_patch). base 와 서버 값이 다르면 conflicts 로 돌려준다 */
  function gradePatch(studentId, kind, level, term, set, base, force) {
    return sb().rpc('grade_patch', {
      p_student: studentId, p_kind: kind, p_level: level, p_term: term,
      p_set: set, p_base: base || {}, p_force: !!force
    }).then(check).then(function (r) { return r.data; });
  }

  /* 내 이름 · 역할 (teacher 만 숨긴 기록 보기 · 되살리기). 004 를 아직 안 돌렸으면 null */
  function myStaff() {
    return sb().rpc('my_staff').then(function (r) { return r.error ? null : r.data; });
  }

  /* 상용구 — 하나씩 넣고 하나씩 지운다 */
  function insertSnippet(sn, order) {
    return sb().from('snippets').insert({ id: sn.id, text: sn.text, sort_order: order || 0 }).select('*').then(check)
      .then(function (r) { return r.data[0]; });
  }
  function deleteSnippet(id) {
    return sb().from('snippets').delete().eq('id', id).then(check);
  }

  function markSent(weekStart, studentId, via, by) {
    return sb().from('sent').upsert({
      week_start: weekStart, student_id: studentId,
      via: via || 'copy', sent_by: by || '', sent_at: new Date().toISOString()
    }, { onConflict: 'week_start,student_id' }).then(check);
  }

  function unmarkSent(weekStart, studentId) {
    return sb().from('sent').delete().eq('week_start', weekStart).eq('student_id', studentId).then(check);
  }

  /* 그 반의 '지난 회차' 반 공통 — 이번 주보다 앞선 가장 최근 주 */
  function lastCommonOf(className, beforeWeek) {
    return sb().from('week_common').select('*')
      .eq('class_name', className).lt('week_start', beforeWeek)
      .order('week_start', { ascending: false }).limit(1)
      .then(function (r) {
        check(r);
        if (!r.data || !r.data.length) return null;
        var c = fromDbCommon(r.data[0]);
        c.weekStart = r.data[0].week_start;
        return c;
      });
  }

  /* ---------- 공용 설정 ---------- */

  function getSetting(key) {
    return sb().from('app_settings').select('*').eq('key', key).limit(1)
      .then(function (r) {
        check(r);
        return (r.data && r.data.length) ? r.data[0].value : null;
      });
  }

  function getSettingRow(key) {
    return sb().from('app_settings').select('*').eq('key', key).maybeSingle().then(check)
      .then(function (r) { return r.data; });
  }

  /* 설정 한 줄. base(updated_at) 가 있으면 그 사이 아무도 안 고쳤을 때만 저장 */
  function saveSettingIf(key, value, by, base) {
    if (!base) {
      return sb().from('app_settings').upsert({ key: key, value: value, updated_by: by || '' }, { onConflict: 'key' })
        .select('*').then(check).then(function (r) { return { ok: true, row: r.data[0] }; });
    }
    return updateIf('app_settings', { key: key }, { value: value, updated_by: by || '' }, base);
  }

  function saveSetting(key, value, by) {
    return sb().from('app_settings').upsert({
      key: key, value: value, updated_by: by || '', updated_at: new Date().toISOString()
    }, { onConflict: 'key' }).then(check);
  }

  /* ============================================================
     공개 (published) — 깃허브 대신 여기에 레포트 내용을 고정해 둔다
     ============================================================ */

  /* rows: [{ studentId, data }] */
  function publishReports(weekStart, rows, by) {
    if (!rows.length) return Promise.resolve();
    var now = new Date().toISOString();
    var payload = rows.map(function (r) {
      return {
        week_start: weekStart, student_id: r.studentId,
        report_data: r.data, visible: true, published_by: by || '', published_at: now
      };
    });
    return sb().from('published').upsert(payload, { onConflict: 'week_start,student_id' }).then(check);
  }

  function setPublishedVisible(weekStart, studentIds, visible) {
    if (!studentIds.length) return Promise.resolve();
    return sb().from('published').update({ visible: !!visible })
      .eq('week_start', weekStart).in('student_id', studentIds).then(check);
  }

  function publishedOfWeek(weekStart) {
    return sb().from('published').select('student_id,visible,published_at,published_by')
      .eq('week_start', weekStart)
      .then(function (r) {
        check(r);
        var out = {};
        r.data.forEach(function (row) {
          out[row.student_id] = { visible: row.visible, publishedAt: row.published_at, by: row.published_by };
        });
        return out;
      });
  }

  function publishedWeeks() {
    return sb().from('published').select('week_start').eq('visible', true)
      .order('week_start', { ascending: false })
      .then(function (r) {
        check(r);
        var seen = {}, out = [];
        r.data.forEach(function (row) {
          if (seen[row.week_start]) return;
          seen[row.week_start] = 1;
          out.push(row.week_start);
        });
        return out;
      });
  }

  /* ④ 발송 — 그 주차에 공개한 학생 + 보냄 표시 + 종료일 */
  function weekSendData(weekStart) {
    var c = sb();
    return Promise.all([
      c.from('published').select('student_id').eq('week_start', weekStart).eq('visible', true),
      c.from('sent').select('*').eq('week_start', weekStart),
      c.from('week_meta').select('week_end').eq('week_start', weekStart).limit(1)
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw new Error(r.error.message); });
      var published = {};
      res[0].data.forEach(function (r) { published[r.student_id] = true; });
      var sent = {};
      res[1].data.forEach(function (r) {
        sent[r.student_id] = { at: r.sent_at, via: r.via, by: r.sent_by };
      });
      var weekEnd = res[2].data.length ? res[2].data[0].week_end : '';
      return { published: published, sent: sent, weekEnd: weekEnd };
    });
  }

  /* ============================================================
     반 공지 (class_notices) · 반 공용 코드 (class_codes)
     ============================================================ */

  function fromDbNotice(r) {
    return {
      id: r.id, bundleId: r.bundle_id, className: r.class_name, weekStart: r.week_start,
      title: r.title || '', curriculum: r.curriculum || '', literature: r.literature || '',
      reading: r.reading || '', homework: r.homework || '', notes: r.notes || '',
      special: r.special || '', materials: r.materials || [], videos: r.videos || [],
      visible: r.visible !== false, updatedBy: r.updated_by || '', updatedAt: r.updated_at
    };
  }

  function toDbNotice(n) {
    var row = {
      bundle_id: n.bundleId, class_name: n.className, week_start: n.weekStart,
      title: n.title || '', curriculum: n.curriculum || '', literature: n.literature || '',
      reading: n.reading || '', homework: n.homework || '', notes: n.notes || '',
      special: n.special || '', materials: n.materials || [], videos: n.videos || [],
      visible: n.visible !== false, updated_by: n.updatedBy || ''
    };
    if (n.id) row.id = n.id;
    return row;
  }

  function listNotices() {
    return sb().from('class_notices').select('*')
      .order('week_start', { ascending: false }).order('class_name').limit(1000)
      .then(function (r) { check(r); return r.data.map(fromDbNotice); });
  }

  /* (반, 주차) 가 같으면 덮어쓴다 */
  function saveNotices(list) {
    if (!list.length) return Promise.resolve();
    return sb().from('class_notices')
      .upsert(list.map(toDbNotice), { onConflict: 'class_name,week_start' })
      .then(check);
  }

  /* 저장 직전 확인용 — 그 주차·그 반들의 지금 공지 */
  function noticeRowsOf(weekStart, classes, ids) {
    var c = sb();
    return Promise.all([
      c.from('class_notices').select('id,class_name,week_start,bundle_id,updated_at').eq('week_start', weekStart).in('class_name', classes),
      ids.length ? c.from('class_notices').select('id,class_name,week_start,bundle_id,updated_at').in('id', ids) : Promise.resolve({ data: [] })
    ]).then(function (res) {
      res.forEach(check);
      var m = {};
      res[0].data.concat(res[1].data).forEach(function (r) { m[r.id] = r; });
      return Object.keys(m).map(function (k) { return m[k]; });
    });
  }

  function deleteNotices(ids) {
    if (!ids.length) return Promise.resolve();
    return sb().from('class_notices').delete().in('id', ids).then(check);
  }

  function updateNotice(id, patch) {
    var row = {};
    if (patch.bundleId !== undefined) row.bundle_id = patch.bundleId;
    if (patch.visible !== undefined) row.visible = !!patch.visible;
    return sb().from('class_notices').update(row).eq('id', id).then(check);
  }

  function updateBundleVisible(bundleId, visible) {
    return sb().from('class_notices').update({ visible: !!visible }).eq('bundle_id', bundleId).then(check);
  }

  function listClassCodes() {
    return sb().from('class_codes').select('*').then(function (r) {
      check(r);
      var m = {};
      r.data.forEach(function (row) { m[row.class_name] = row.code; });
      return m;
    });
  }

  function saveClassCode(className, code) {
    return sb().from('class_codes').upsert({ class_name: className, code: code }, { onConflict: 'class_name' })
      .then(check);
  }

  global.DB = {
    loadAll: loadAll,
    addClassRow: addClassRow,
    loadWeek: loadWeek,
    updateIf: updateIf,
    currentAt: currentAt,
    toDbStudent: toDbStudent,
    fromDbStudent: fromDbStudent,
    toDbField: toDbField,
    fromDbField: fromDbField,
    fromDbEntry: fromDbEntry,
    fromDbCommon: fromDbCommon,
    saveStudentRow: saveStudentRow,
    deleteStudentRow: deleteStudentRow,
    saveFieldRow: saveFieldRow,
    deleteFieldRow: deleteFieldRow,
    saveClassInfoRow: saveClassInfoRow,
    entryPatch: entryPatch,
    gradePatch: gradePatch,
    myStaff: myStaff,
    commonPatch: commonPatch,
    insertSnippet: insertSnippet,
    deleteSnippet: deleteSnippet,
    getSettingRow: getSettingRow,
    saveSettingIf: saveSettingIf,
    noticeRowsOf: noticeRowsOf,
    saveLink: saveLink,
    saveLinks: saveLinks,
    saveWeekMeta: saveWeekMeta,
    markSent: markSent,
    unmarkSent: unmarkSent,
    lastCommonOf: lastCommonOf,
    getSetting: getSetting,
    saveSetting: saveSetting,
    publishReports: publishReports,
    setPublishedVisible: setPublishedVisible,
    publishedOfWeek: publishedOfWeek,
    publishedWeeks: publishedWeeks,
    weekSendData: weekSendData,
    listNotices: listNotices,
    saveNotices: saveNotices,
    deleteNotices: deleteNotices,
    updateNotice: updateNotice,
    updateBundleVisible: updateBundleVisible,
    listClassCodes: listClassCodes,
    saveClassCode: saveClassCode,
    lockedStudentIds: lockedStudentIds
  };

})(window);
