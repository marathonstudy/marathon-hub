/* ============================================================
   db.js — Supabase 읽기·쓰기

   화면 코드는 되도록 store.js 를 거친다. 저장할 때 여기로 넘어온다.
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
      createdAt: r.created_at
    };
  }

  /* 명단 전체 맞추기.
     빈 목록이 넘어오면 지우지 않는다(실수로 비워진 캐시가 서버 명단을 지우는 사고 방지).
     정말 비울 때만 purge=true. */
  function syncStudents(list, purge) {
    var c = sb();
    var rows = (list || []).map(toDbStudent);

    if (!rows.length) {
      if (!purge) return Promise.resolve({ skipped: true });
      return lockedStudentIds().then(function (locked) {
        var q = c.from('students').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (locked.length) q = q.not('id', 'in', '(' + locked.join(',') + ')');
        return q.then(check);
      });
    }

    return c.from('students').upsert(rows, { onConflict: 'id' })
      .then(check)
      .then(lockedStudentIds)
      .then(function (locked) {
        /* 교재 기록이 있는 학생은 목록에 없어도 지우지 않는다.
           (지우려 하면 외래키 때문에 명단 저장 전체가 실패한다) */
        var keep = {};
        rows.forEach(function (r) { keep[r.id] = true; });
        locked.forEach(function (id) { keep[id] = true; });
        return c.from('students').delete().not('id', 'in', '(' + Object.keys(keep).join(',') + ')').then(check);
      });
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
      scope: r.scope === 'class' ? 'class' : 'student', sortOrder: r.sort_order || 0
    };
  }

  /* 칸 목록 전체 맞추기. 빈 목록으로 서버를 비우는 것은 칸 관리에서 직접 지웠을 때만. */
  function syncFieldDefs(list, opts) {
    var c = sb();
    opts = opts || {};
    var rows = (list || []).map(toDbField);

    if (!rows.length) {
      if (!opts.allowClear) return Promise.resolve({ skipped: true });
      return c.from('field_defs').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(check);
    }

    return c.from('field_defs').upsert(rows, { onConflict: 'id' })
      .then(check)
      .then(function () {
        var ids = rows.map(function (r) { return r.id; });
        return c.from('field_defs').delete().not('id', 'in', '(' + ids.join(',') + ')').then(check);
      });
  }

  /* ---------- 반 현황 (class_info) ---------- */

  function quoteList(names) {
    return '(' + names.map(function (n) { return '"' + String(n).split('"').join('""') + '"'; }).join(',') + ')';
  }

  function syncClassInfo(map) {
    var c = sb();
    var names = Object.keys(map || {});
    if (!names.length) return Promise.resolve({ skipped: true });

    var rows = names.map(function (n) {
      return { class_name: n, extra: map[n] || {}, updated_at: new Date().toISOString() };
    });
    return c.from('class_info').upsert(rows, { onConflict: 'class_name' })
      .then(check)
      .then(function () {
        return c.from('class_info').delete().not('class_name', 'in', quoteList(names)).then(check);
      });
  }

  /* ---------- 주간 입력 ---------- */

  function toDbEntry(weekStart, studentId, e) {
    return {
      week_start: weekStart,
      student_id: studentId,
      attend_status: e.attendStatus || '',
      attend_note: e.attendNote || '',
      focus_score: Math.max(0, Math.min(5, Number(e.focusScore) || 0)),
      scores: e.scores || {},
      homework: e.homework || {},
      on_time_rate: Math.max(0, Math.min(100, e.onTimeRate == null ? 100 : Number(e.onTimeRate))),
      comment: e.comment || ''
    };
  }

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
      c.from('entries').select('week_start,updated_at').order('updated_at', { ascending: false }).limit(1)
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

      var classInfo = {};
      res[3].data.forEach(function (r) { classInfo[r.class_name] = r.extra || {}; });

      return {
        students: res[0].data.map(fromDbStudent),
        snippets: res[1].data.map(function (r) { return { id: r.id, text: r.text }; }),
        fieldDefs: res[2].data.map(fromDbField),
        classInfo: classInfo,
        links: links,
        published: published,
        sent: sent,
        weekEnds: weekEnds,
        latestWeek: (res[8].data[0] && res[8].data[0].week_start) || ''
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
      var common = {};
      res[0].data.forEach(function (r) { common[r.class_name] = fromDbCommon(r); });
      var entries = {};
      res[1].data.forEach(function (r) { entries[r.student_id] = fromDbEntry(r); });
      var weekEnd = res[2].data.length ? res[2].data[0].week_end : '';
      return { common: common, entries: entries, weekEnd: weekEnd };
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

  function saveWeekCommon(weekStart, className, c) {
    if (!weekStart || !className) return Promise.resolve();
    return sb().from('week_common').upsert({
      week_start: weekStart,
      class_name: className,
      lessons: c.lessons || [],
      tests: c.tests || [],
      comment: c.comment || '',
      homework: c.homework || []
    }, { onConflict: 'week_start,class_name' }).then(check);
  }

  function saveEntries(weekStart, entryMap, studentIds) {
    if (!weekStart) return Promise.resolve();
    var rows = [];
    Object.keys(entryMap || {}).forEach(function (sid) {
      if (studentIds && studentIds.indexOf(sid) === -1) return;   /* 명단에 없는 학생은 보내지 않는다 */
      rows.push(toDbEntry(weekStart, sid, entryMap[sid]));
    });
    if (!rows.length) return Promise.resolve();
    return sb().from('entries').upsert(rows, { onConflict: 'week_start,student_id' }).then(check);
  }

  function saveSnippets(list) {
    var c = sb();
    var rows = (list || []).map(function (s, i) {
      return { id: s.id, text: s.text, sort_order: i };
    }).filter(function (r) { return r.text && String(r.text).trim(); });

    return c.from('snippets').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      .then(check)
      .then(function () { return rows.length ? c.from('snippets').insert(rows).then(check) : null; });
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
    loadWeek: loadWeek,
    syncStudents: syncStudents,
    saveLink: saveLink,
    saveLinks: saveLinks,
    syncFieldDefs: syncFieldDefs,
    syncClassInfo: syncClassInfo,
    saveWeekMeta: saveWeekMeta,
    saveWeekCommon: saveWeekCommon,
    saveEntries: saveEntries,
    saveSnippets: saveSnippets,
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
