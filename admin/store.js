/* ============================================================
   store.js — 화면이 쓰는 자료 · 서버 저장 · 암호 백업 · 공용 도구

   서버(Supabase)가 기준이다. 여러 기기·여러 조교가 동시에 쓴다.
     · 학생·작성·칸·반 현황 같은 자료는 이 화면의 메모리에만 둔다.
       브라우저 저장소(localStorage)에는 화면 설정(KEYS.settings)만 남긴다.
     · 저장은 '바뀐 줄(항목)만' 보낸다. 마지막으로 서버에서 받은 값(base)과
       지금 화면 값을 비교해서 다른 것만 보낸다.
     · 화면 목록에 없다는 이유로 서버 줄을 지우지 않는다.
       지우기는 deleteStudent · deleteFieldDef · deleteSnippet — 삭제 버튼에서만.
     · 고칠 때는 내가 불러온 뒤 다른 분이 고쳤는지(updated_at) 확인하고,
       고쳤으면 "다른 분이 먼저 수정했습니다" 창을 띄운다 (UI.conflictAsk).
     · refreshAll() 은 서버 최신 내용을 받아 오되, 아직 저장 안 된 내 입력은 지킨다.
   저장소(GitHub)에는 학생 정보가 절대 올라가지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  var SCHEMA_VERSION = 2;
  var P = global.CONFIG.storagePrefix;

  var KEYS = {
    students:  P + 'students',
    links:     P + 'links',      /* 개인 링크 · 앱 공유 코드 (서버에 한 줄씩 바로 저장) */
    draft:     P + 'draft',      /* 작성 중인 주차 */
    published: P + 'published',
    snippets:  P + 'snippets',
    sent:      P + 'sent',
    settings:  P + 'settings',   /* 이 기기만의 화면 설정 — 이것만 브라우저에 남는다 */
    fieldDefs: P + 'fielddefs',
    classInfo: P + 'classinfo',
    classes:   P + 'classes',    /* 반 목록 (classes 표 · migration-009). 표가 없으면 null */
    classesOff: P + 'classesoff', /* 보관한 반 (migration-010) */
    classSched: P + 'classsched', /* 수업 요일 · 첫 수업일 (migration-011) */
    classWeeks: P + 'classweeks', /* 그 주만 바꾼 수업일 · 휴강 (migration-011) */
    weekEnds:  P + 'weekends'
  };

  /* ---------- 메모리 · 화면 설정 ---------- */

  var mem = {};
  function isLocal(key) { return key === KEYS.settings; }

  /* 예전 버전이 브라우저에 남긴 명단·작성 사본을 지운다 (기준으로 쓰지 않는다) */
  Object.keys(KEYS).forEach(function (k) {
    if (isLocal(KEYS[k])) return;
    try { localStorage.removeItem(KEYS[k]); } catch (e) {}
  });

  function read(key, fallback) {
    if (!isLocal(key)) return (key in mem) ? mem[key] : fallback;
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    if (!isLocal(key)) { mem[key] = value; return true; }
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function remove(key) {
    delete mem[key];
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }

  /* 화면에 두고, 바뀐 줄만 서버로 보낸다 */
  function write(key, value) {
    writeLocal(key, value);
    try { pushToServer(key); } catch (e) { console.error(e); }
    if (key === KEYS.draft) scheduleBackup();
    return true;
  }

  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { console.error(e); }
  }

  /* ---------- 저장 상태 표시 ---------- */

  var syncEnabled = false;
  var syncTimers = {};
  var syncState = { pending: 0, error: null };
  var syncListeners = [];
  var chains = {};

  function onSyncChange(fn) { syncListeners.push(fn); }
  function emitSync() {
    syncListeners.forEach(function (fn) { try { fn(syncState); } catch (e) { console.error(e); } });
  }

  function enableSync(on) {
    syncEnabled = !!on;
    syncState.error = null;
    emitSync();
  }

  /* 같은 종류의 저장은 한 줄로 세워 차례로 보낸다 (앞 저장 결과가 base 가 된다) */
  function queue(label, fn) {
    var p = (chains[label] || Promise.resolve()).then(function () {
      syncState.pending++;
      emitSync();
      return Promise.resolve().then(fn).then(function (v) {
        syncState.pending--;
        syncState.error = null;
        emitSync();
        return v;
      }, function (e) {
        syncState.pending--;
        syncState.error = (e && e.message) || String(e);
        console.error('저장 실패 [' + label + ']', e);
        emitSync();
        throw e;
      });
    });
    chains[label] = p.catch(function () {});
    return p;
  }

  /* 서버로 바로 보내야 할 때(엑셀 넣기 등) 화면 위 '저장 중' 표시를 같이 쓴다 */
  function track(label, promise) {
    return queue(label, function () { return promise; });
  }

  function pendingCount() { return syncState.pending + Object.keys(syncTimers).filter(function (k) { return syncTimers[k]; }).length; }

  var PUSHERS = {};
  var DELAY = {};

  function pushToServer(key) {
    var fn = PUSHERS[key];
    if (!fn || !syncEnabled || !global.DB) return;
    clearTimeout(syncTimers[key]);
    syncTimers[key] = setTimeout(function () {
      syncTimers[key] = null;
      queue(key, fn).catch(function () {});
    }, DELAY[key] || 300);
  }

  /* 기다리지 않고 바로 보낸다 (주차를 바꾸기 직전 · 개인 링크 저장 전 등) */
  function flushNow(key) {
    var fn = PUSHERS[key];
    if (!fn) return Promise.resolve();
    clearTimeout(syncTimers[key]);
    syncTimers[key] = null;
    if (!syncEnabled) return Promise.reject(new Error('로그인 상태가 아닙니다.'));
    return queue(key, fn);
  }

  function flushAll() {
    return Promise.all(Object.keys(PUSHERS).map(function (k) {
      return syncTimers[k] ? flushNow(k).catch(function () {}) : chains[k] || null;
    }));
  }

  /* ============================================================
     줄 단위 저장 — 학생 · 칸 · 반 현황 · 상용구
     base[종류][id] = { sig: 마지막으로 서버와 맞춘 내용, at: 서버 updated_at }
     ============================================================ */

  var base = { students: {}, fields: {}, classInfo: {}, snippets: {}, week: null };

  function sigStudent(s) { return JSON.stringify(global.DB.toDbStudent(s)); }
  function sigField(f) { return JSON.stringify(global.DB.toDbField(f)); }

  function each(list, limit, fn) {
    var i = 0, out = [];
    function next() {
      if (i >= list.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(list[k], k)).then(function (v) { out[k] = v; return next(); });
    }
    var runners = [];
    for (var n = 0; n < Math.min(limit, list.length); n++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }

  /* 그 줄을 마지막으로 서버와 맞춘 시각 — 고치기 창을 열 때 적어 두고, 저장할 때 바뀌었는지 본다 */
  function baseAt(kind, id) {
    var b = base[kind] && base[kind][id];
    return (b && b.at) || '';
  }

  /* 사용자가 [내 내용으로 덮어쓰기] 를 골랐을 때 — 다음 저장이 서버의 지금 시각을 기준으로 하게 */
  function setBaseAt(kind, id, at) {
    if (base[kind] && base[kind][id]) base[kind][id].at = at || '';
  }

  function askConflict(what) {
    if (global.UI && global.UI.conflictAsk) return global.UI.conflictAsk(what);
    return Promise.resolve('reload');
  }

  /* 목록형(학생·칸) 공통 저장기 */
  function rowPusher(opt) {
    return function () {
      var list = read(opt.key, []) || [];
      var B = base[opt.kind];
      var jobs = list.filter(function (x) {
        var b = B[x.id];
        return !b || b.sig !== opt.sig(x);
      });
      if (!jobs.length) return Promise.resolve();
      var conflicts = [];

      function apply(x, res) {
        if (res.ok) {
          var fresh = opt.fromRow(res.row);
          B[x.id] = { sig: opt.sig(fresh), at: res.row.updated_at || '' };
          x.updatedAt = res.row.updated_at || '';
        } else if (res.gone) {
          delete B[x.id];
          writeLocal(opt.key, read(opt.key, []).filter(function (y) { return y.id !== x.id; }));
          if (global.UI) UI.toast('‘' + opt.label(x) + '’ 은(는) 다른 분이 지웠습니다', 'warn');
          emit(opt.changed);
        } else if (res.conflict) {
          conflicts.push({ x: x, row: res.row });
        }
      }

      var adds = jobs.filter(function (x) { return !B[x.id]; });
      var edits = jobs.filter(function (x) { return B[x.id]; });

      return Promise.resolve()
        .then(function () {
          if (!adds.length) return null;
          return opt.insertMany(adds).then(function (rows) {
            rows.forEach(function (row) {
              var x = adds.find(function (a) { return a.id === row.id; });
              if (x) apply(x, { ok: true, row: row });
            });
          });
        })
        .then(function () {
          return each(edits, 4, function (x) {
            return opt.save(x, B[x.id].at || '').then(function (res) { apply(x, res); });
          });
        })
        .then(function () {
          if (!conflicts.length) return null;
          return askConflict(opt.what(conflicts.map(function (c) { return c.x; }))).then(function (choice) {
            if (choice === 'overwrite') {
              return each(conflicts, 4, function (c) {
                return opt.save(c.x, '').then(function (res) { apply(c.x, res); });
              });
            }
            if (choice === 'reload') {
              var cur = read(opt.key, []);
              conflicts.forEach(function (c) {
                var fresh = opt.fromRow(c.row);
                B[c.x.id] = { sig: opt.sig(fresh), at: c.row.updated_at || '' };
                var i = cur.findIndex(function (y) { return y.id === c.x.id; });
                if (i >= 0) cur[i] = fresh;
              });
              writeLocal(opt.key, cur);
              emit(opt.changed);
            }
            return null;
          });
        });
    };
  }

  function insertMany(table, rows) {
    return global.SB.client.from(table).insert(rows).select('*').then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }

  PUSHERS[KEYS.students] = rowPusher({
    key: KEYS.students, kind: 'students', sig: sigStudent, changed: 'jt:roster-changed',
    fromRow: function (r) { return global.DB.fromDbStudent(r); },
    label: function (s) { return s.name; },
    what: function (list) { return list.map(function (s) { return s.name; }).join(', ') + ' 학생 정보'; },
    insertMany: function (list) { return insertMany('students', list.map(global.DB.toDbStudent)); },
    save: function (s, at) { return global.DB.saveStudentRow(s, at); }
  });

  PUSHERS[KEYS.fieldDefs] = rowPusher({
    key: KEYS.fieldDefs, kind: 'fields', sig: sigField, changed: 'jt:fields',
    fromRow: function (r) { return global.DB.fromDbField(r); },
    label: function (f) { return f.label; },
    what: function (list) { return '칸 ‘' + list.map(function (f) { return f.label; }).join(', ') + '’'; },
    insertMany: function (list) { return insertMany('field_defs', list.map(global.DB.toDbField)); },
    save: function (f, at) { return global.DB.saveFieldRow(f, at); }
  });
  DELAY[KEYS.fieldDefs] = 400;

  /* 반 현황 — { 반이름: extra } */
  PUSHERS[KEYS.classInfo] = function () {
    var map = read(KEYS.classInfo, {}) || {};
    var B = base.classInfo;
    var names = Object.keys(map).filter(function (n) {
      var b = B[n];
      return !b || b.sig !== JSON.stringify(map[n] || {});
    });
    var conflicts = [];
    return each(names, 4, function (n) {
      var b = B[n];
      return global.DB.saveClassInfoRow(n, map[n], b ? (b.at || '') : null).then(function (res) {
        if (res.ok) B[n] = { sig: JSON.stringify(res.row.extra || {}), at: res.row.updated_at || '' };
        else if (res.conflict) conflicts.push({ n: n, row: res.row });
        else if (res.gone) delete B[n];
      });
    }).then(function () {
      if (!conflicts.length) return null;
      return askConflict(conflicts.map(function (c) { return c.n; }).join(', ') + ' 반 현황').then(function (choice) {
        if (choice === 'overwrite') {
          return each(conflicts, 4, function (c) {
            return global.DB.saveClassInfoRow(c.n, map[c.n], '').then(function (res) {
              if (res.ok) B[c.n] = { sig: JSON.stringify(res.row.extra || {}), at: res.row.updated_at || '' };
            });
          });
        }
        if (choice === 'reload') {
          conflicts.forEach(function (c) {
            map[c.n] = (c.row && c.row.extra) || {};
            B[c.n] = { sig: JSON.stringify(map[c.n]), at: (c.row && c.row.updated_at) || '' };
          });
          emit('jt:roster-changed');
        }
        return null;
      });
    });
  };
  DELAY[KEYS.classInfo] = 400;

  /* 상용구 — 새로 생긴 것만 넣는다. 지우기는 deleteSnippet */
  PUSHERS[KEYS.snippets] = function () {
    var list = read(KEYS.snippets, []) || [];
    var adds = list.filter(function (s) { return !base.snippets[s.id] && String(s.text || '').trim(); });
    return each(adds, 4, function (s) {
      return global.DB.insertSnippet(s, list.indexOf(s)).then(function () { base.snippets[s.id] = true; });
    });
  };

  /* ============================================================
     작성 중인 주차 — 학생 한 명 · 항목 하나 단위로 저장
     ============================================================ */

  var TEXT_KEYS = { comment: true, attend_note: true };   /* 글로 쓰는 항목 — 동시 수정 확인 */
  var ENTRY_DEFAULT = { attend_status: '', attend_note: '', focus_score: 0, on_time_rate: 100, comment: '' };

  function clamp(v, lo, hi, dflt) {
    var n = Number(v);
    if (v == null || isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  /* 화면의 학생 입력 → 항목별 평평한 모양 */
  function flatEntry(e) {
    e = e || {};
    var o = {
      attend_status: e.attendStatus || '',
      attend_note: e.attendNote || '',
      focus_score: clamp(e.focusScore, 0, 5, 0),
      on_time_rate: clamp(e.onTimeRate, 0, 100, 100),
      comment: e.comment || ''
    };
    Object.keys(e.scores || {}).forEach(function (k) { o['scores.' + k] = e.scores[k]; });
    Object.keys(e.homework || {}).forEach(function (k) { o['homework.' + k] = e.homework[k]; });
    return o;
  }

  /* 서버 줄 → 같은 모양 */
  function flatRaw(r) {
    if (!r) return JSON.parse(JSON.stringify(ENTRY_DEFAULT));
    var o = {
      attend_status: r.attend_status || '',
      attend_note: r.attend_note || '',
      focus_score: r.focus_score || 0,
      on_time_rate: r.on_time_rate == null ? 100 : r.on_time_rate,
      comment: r.comment || ''
    };
    Object.keys(r.scores || {}).forEach(function (k) { o['scores.' + k] = r.scores[k]; });
    Object.keys(r.homework || {}).forEach(function (k) { o['homework.' + k] = r.homework[k]; });
    return o;
  }

  /* 평평한 모양 → 화면 입력 (같은 객체를 고친다) */
  function unflat(f, target) {
    target.attendStatus = f.attend_status || '';
    target.attendNote = f.attend_note || '';
    target.focusScore = f.focus_score || 0;
    target.onTimeRate = f.on_time_rate == null ? 100 : f.on_time_rate;
    target.comment = f.comment || '';
    target.scores = {};
    target.homework = {};
    Object.keys(f).forEach(function (k) {
      if (f[k] == null) return;
      if (k.indexOf('scores.') === 0) target.scores[k.slice(7)] = f[k];
      else if (k.indexOf('homework.') === 0) target.homework[k.slice(9)] = f[k];
    });
    return target;
  }

  var COMMON_KEYS = ['lessons', 'tests', 'homework', 'comment'];
  function rawCommon(r) {
    return r ? { lessons: r.lessons || [], tests: r.tests || [], homework: r.homework || [], comment: r.comment || '' }
             : { lessons: [], tests: [], homework: [], comment: '' };
  }
  function normCommon(c) { return global.DB.fromDbCommon(rawCommon(c)); }

  function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
  function keysOf() {
    var seen = {};
    Array.prototype.forEach.call(arguments, function (o) { Object.keys(o || {}).forEach(function (k) { seen[k] = true; }); });
    return Object.keys(seen);
  }

  /* 서버 값과 합친다.
     내가 보낸 항목(sent)        → base 를 서버 값으로
     다른 분과 겹친 항목(clash)   → 그대로 둔다 (사용자에게 묻는다)
     내가 손대지 않은 항목        → 화면도 서버 값으로
     아직 저장 안 된 내 입력       → 화면 값을 지킨다
     others = 지금 고치는 중이거나 아직 저장 안 된 칸을 다른 사람이 바꾼 것 — 덮지 않고 알린다 */
  /* 값 복사 — 과제 요일({월:true}) 같은 묶음 값은 화면 쪽과 '마지막 저장 값' 쪽이 따로 가져야 한다.
     같은 상자를 같이 쓰면 버튼을 누를 때 둘이 함께 바뀌어 '바뀐 것 없음' 으로 보고 저장하지 않았다
     (다시 보면 안 눌린 상태로 돌아가던 원인). */
  function copyVal(v) { return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v; }

  function mergeFlat(local, b, srv, sent, clash, prot) {
    var nl = {}, nb = {}, changed = false, others = [];
    prot = prot || {};
    keysOf(local, b, srv).forEach(function (k) {
      if (clash[k]) { nl[k] = local[k]; nb[k] = copyVal(b[k]); return; }
      if (sent[k]) { nl[k] = local[k]; nb[k] = copyVal(srv[k]); return; }
      /* 지금 그 칸을 고치는 중 — 화면도 base 도 그대로 둔다.
         저장하면 서버가 base 와 달라진 것을 알아채고 '다른 분이 먼저 수정' 으로 묻는다. */
      if (prot[k]) { nl[k] = local[k]; nb[k] = copyVal(b[k]); if (!same(srv[k], b[k]) && !same(srv[k], local[k])) others.push(k); return; }
      if (same(local[k], b[k])) {
        nl[k] = copyVal(srv[k]); nb[k] = copyVal(srv[k]);
        if (!same(local[k], srv[k])) changed = true;
      } else {
        nl[k] = local[k]; nb[k] = copyVal(b[k]);
        if (!same(srv[k], b[k]) && !same(srv[k], local[k])) others.push(k);
      }
    });
    Object.keys(nl).forEach(function (k) { if (nl[k] === undefined) delete nl[k]; });
    Object.keys(nb).forEach(function (k) { if (nb[k] === undefined) delete nb[k]; });
    return { local: nl, base: nb, changed: changed, others: others };
  }

  /* 서버 줄의 수정 시각 — 이것보다 옛 줄(늦게 도착한 실시간 알림 · 저장 전에 받아 둔 다시 불러오기)은 합치지 않는다.
     (예전에는 내 저장의 옛 알림이 나중에 도착하면 화면 글이 그때 글로 되돌아갔다) */
  function tsOf(x) { var n = Date.parse(x || ''); return isNaN(n) ? 0 : n; }
  function knownAt(kind, id) {
    var bw = base.week;
    return (bw && bw.at && bw.at[kind] && bw.at[kind][id]) || '';
  }
  function noteAt(kind, id, row) {
    var bw = base.week;
    if (!bw || !row || !row.updated_at) return;
    bw.at = bw.at || { entry: {}, common: {} };
    if (tsOf(row.updated_at) >= tsOf(bw.at[kind][id])) bw.at[kind][id] = row.updated_at;
  }
  function isStale(kind, id, row) {
    var known = knownAt(kind, id);
    if (!row) return !!known;                       /* 서버에 줄이 있는 걸 아는데 '없음' 으로 온 옛 응답 */
    if (!known || !row.updated_at) return false;
    return tsOf(row.updated_at) < tsOf(known);
  }

  var OTHER_KEYS = { entry: { comment: true, attend_note: true }, common: { comment: true, lessons: true, tests: true, homework: true } };
  function tellOthers(kind, id, keys, row) {
    var ks = (keys || []).filter(function (k) { return OTHER_KEYS[kind][k]; });
    if (ks.length) emit('jt:draft-others', { kind: kind, id: id, keys: ks, row: row });
  }

  /* 저장 상태 — 화면이 칸 옆에 「저장 중 · 저장됨 · 저장 실패」 를 보여 준다 */
  var saveState = { entry: {}, common: {} };
  function setSaveState(kind, id, state) {
    saveState[kind][id] = state;
    emit('jt:save-state', { kind: kind, id: id, state: state });
  }
  function saveStateOf(kind, id) { return saveState[kind][id] || ''; }

  function draftNow() { return read(KEYS.draft, null); }

  /* 화면이 알려 준다: 지금 고치는 중인 항목 (작성 탭이 등록한다) */
  var editingHook = null;
  function setEditingHook(fn) { editingHook = fn; }
  function protectedKeys(kind, id) {
    var out = {};
    if (!editingHook) return out;
    try { (editingHook(kind, id) || []).forEach(function (k) { out[k] = true; }); } catch (e) { console.error(e); }
    return out;
  }

  function emptyEntryObj() {
    return { attendStatus: '', attendNote: '', focusScore: 0, scores: {}, homework: {}, onTimeRate: 100, comment: '' };
  }

  /* remote = 실시간 알림 · 다시 불러오기에서 온 줄 (내 저장 응답이 아닌 것) */
  function mergeEntry(sid, serverRow, sent, clash, remote) {
    var d = draftNow(), bw = base.week;
    if (!d || !bw) return false;
    if (remote && isStale('entry', sid, serverRow)) return false;
    var cur = d.entries[sid] || emptyEntryObj();
    var m = mergeFlat(flatEntry(cur), bw.entries[sid] || flatRaw(null), flatRaw(serverRow), sent || {}, clash || {},
                      protectedKeys('entry', sid));
    bw.entries[sid] = m.base;
    d.entries[sid] = unflat(m.local, cur);
    noteAt('entry', sid, serverRow);
    if (remote) tellOthers('entry', sid, m.others, serverRow);
    return m.changed;
  }

  function mergeCommon(cls, serverRow, sent, clash, remote) {
    var d = draftNow(), bw = base.week;
    if (!d || !bw) return false;
    if (remote && isStale('common', cls, serverRow)) return false;
    var cur = d.common[cls] || normCommon(null);
    var braw = bw.common[cls] || rawCommon(null);
    var sraw = rawCommon(serverRow);
    var ln = {}, bn = normCommon(braw), sn = normCommon(sraw);
    COMMON_KEYS.forEach(function (k) { ln[k] = cur[k]; });
    var m = mergeFlat(ln, bn, sn, sent || {}, clash || {}, protectedKeys('common', cls));
    var nraw = {};
    COMMON_KEYS.forEach(function (k) {
      cur[k] = m.local[k];
      nraw[k] = same(m.base[k], bn[k]) ? braw[k] : sraw[k];
    });
    bw.common[cls] = nraw;
    d.common[cls] = cur;
    noteAt('common', cls, serverRow);
    if (remote) tellOthers('common', cls, m.others, serverRow);
    return m.changed;
  }

  /* 알림에서 [그 내용으로 바꾸기] — 그 칸을 서버 값으로 (화면 · base 모두) */
  function acceptRemote(kind, id, keys, row) {
    var d = draftNow(), bw = base.week;
    if (!d || !bw || !row) return;
    if (kind === 'entry') {
      var cur = d.entries[id] || emptyEntryObj();
      var fl = flatEntry(cur), sv = flatRaw(row), b = bw.entries[id] || flatRaw(null);
      keys.forEach(function (k) { fl[k] = copyVal(sv[k]); b[k] = copyVal(sv[k]); if (fl[k] === undefined) delete fl[k]; if (b[k] === undefined) delete b[k]; });
      bw.entries[id] = b;
      d.entries[id] = unflat(fl, cur);
      emit('jt:draft-remote', { entries: [id] });
    } else {
      var c = d.common[id] || normCommon(null), braw = bw.common[id] || rawCommon(null), sraw = rawCommon(row), sn = normCommon(sraw);
      keys.forEach(function (k) { c[k] = copyVal(sn[k]); braw[k] = copyVal(sraw[k]); });
      bw.common[id] = braw;
      d.common[id] = c;
      emit('jt:draft-remote', { common: [id] });
    }
    noteAt(kind, id, row);
    scheduleBackup();
  }

  /* 알림에서 [내 내용 유지] — 다른 사람 글을 이전 내용에 남기고, 내 글로 저장한다 (확인 창 없이) */
  function keepMine(kind, id, keys, row) {
    var bw = base.week;
    if (!bw || !row) return;
    if (kind === 'entry') {
      var b = bw.entries[id] || flatRaw(null), sv = flatRaw(row);
      keys.forEach(function (k) { b[k] = sv[k]; });
      bw.entries[id] = b;
    } else {
      var braw = bw.common[id] || rawCommon(null), sraw = rawCommon(row);
      keys.forEach(function (k) { braw[k] = sraw[k]; });
      bw.common[id] = braw;
    }
    pushToServer(KEYS.draft);
  }

  var draftInflight = 0;
  var retryTimer = null;
  PUSHERS[KEYS.draft] = function () {
    var d = draftNow(), bw = base.week;
    if (!d || !bw || d.weekStart !== bw.weekStart) return Promise.resolve();
    var week = d.weekStart;
    var known = {};
    getStudents().forEach(function (s) { known[s.id] = true; });
    var jobs = [];
    var clashes = [];

    /* 종료일 */
    if (d.weekEnd && d.weekEnd !== bw.weekEnd && d.weekEnd >= week) {
      var we = d.weekEnd;
      jobs.push(function () {
        return global.DB.saveWeekMeta(week, we).then(function () { bw.weekEnd = we; setWeekEndLocal(week, we); });
      });
    }

    /* 학생 입력 */
    Object.keys(d.entries).forEach(function (sid) {
      if (!known[sid]) return;
      var cur = flatEntry(d.entries[sid]);
      var b = bw.entries[sid] || flatRaw(null);
      var set = {}, bs = {}, any = false;
      keysOf(cur, b).forEach(function (k) {
        if (same(cur[k], b[k])) return;
        set[k] = cur[k] === undefined ? null : cur[k];
        if (TEXT_KEYS[k]) bs[k] = b[k];
        any = true;
      });
      if (!any) return;
      jobs.push(function () {
        setSaveState('entry', sid, 'saving');
        return global.DB.entryPatch(week, sid, set, bs, false).then(function (res) {
          if (!base.week || base.week.weekStart !== week) return;
          var clash = {};
          (res.conflicts || []).forEach(function (k) { clash[k] = true; });
          var sent = {};
          Object.keys(set).forEach(function (k) { if (!clash[k]) sent[k] = true; });
          if (mergeEntry(sid, res.row, sent, clash)) emit('jt:draft-remote', { entries: [sid] });
          if (res.conflicts && res.conflicts.length) clashes.push({ kind: 'entry', id: sid, keys: res.conflicts, row: res.row });
          setSaveState('entry', sid, res.conflicts && res.conflicts.length ? 'conflict' : 'saved');
        }, function (e) { setSaveState('entry', sid, 'failed'); throw e; });
      });
    });

    /* 반 공통 */
    Object.keys(d.common).forEach(function (cls) {
      if (!cls || cls === '_') return;
      var curN = {}, c = d.common[cls];
      COMMON_KEYS.forEach(function (k) { curN[k] = c[k]; });
      var braw = bw.common[cls] || rawCommon(null);
      var bn = normCommon(braw);
      var set = {}, bs = {}, any = false;
      COMMON_KEYS.forEach(function (k) {
        if (same(normCommon(curN)[k], bn[k])) return;
        set[k] = curN[k] == null ? (k === 'comment' ? '' : []) : curN[k];
        bs[k] = braw[k];
        any = true;
      });
      if (!any) return;
      jobs.push(function () {
        setSaveState('common', cls, 'saving');
        return global.DB.commonPatch(week, cls, set, bs, false).then(function (res) {
          if (!base.week || base.week.weekStart !== week) return;
          var clash = {};
          (res.conflicts || []).forEach(function (k) { clash[k] = true; });
          var sent = {};
          Object.keys(set).forEach(function (k) { if (!clash[k]) sent[k] = true; });
          if (mergeCommon(cls, res.row, sent, clash)) emit('jt:draft-remote', { common: [cls] });
          if (res.conflicts && res.conflicts.length) clashes.push({ kind: 'common', id: cls, keys: res.conflicts, row: res.row });
          setSaveState('common', cls, res.conflicts && res.conflicts.length ? 'conflict' : 'saved');
        }, function (e) { setSaveState('common', cls, 'failed'); throw e; });
      });
    });

    if (!jobs.length) { scheduleBackup(); return Promise.resolve(); }
    var failed = null;
    draftInflight++;
    return each(jobs, 4, function (job) {
      return job().catch(function (e) { failed = failed || e; });   /* 하나가 실패해도 나머지는 저장 */
    }).then(function () {
      draftInflight--;
      scheduleBackup();
      if (failed) {
        /* 인터넷이 끊겼을 때 — 임시 보관은 남기고 10초 뒤 다시 보낸다 */
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { pushToServer(KEYS.draft); }, 10000);
        throw failed;
      }
      if (!clashes.length) return null;
      return resolveDraftClashes(week, clashes);
    }, function (e) { draftInflight--; throw e; });
  };
  /* 입력을 멈추고 1.2초 뒤 저장 (칸을 벗어날 때 · 화면을 떠날 때 · 탭을 숨길 때는 바로 — write.js) */
  DELAY[KEYS.draft] = 1200;

  var KEY_LABEL = { comment: '코멘트', attend_note: '출결 메모', lessons: '수업 내용', tests: '리뷰테스트', homework: '과제', };

  function resolveDraftClashes(week, clashes) {
    /* 작성 글 칸이 겹치면 덮어쓰지 않고 그 칸 옆에 알린다 — 「다른 사람이 이 칸을 수정했습니다 [그 내용 보기]」 (작성 탭) */
    clashes.forEach(function (c) { emit('jt:draft-others', { kind: c.kind, id: c.id, keys: c.keys, row: c.row, clash: true }); });
    return Promise.resolve(null);
  }

  /* 다른 기기에서 바뀐 줄 하나 (실시간 반영) */
  function mergeRemoteEntry(row) {
    var d = draftNow();
    if (!row || !d || row.week_start !== d.weekStart) return false;
    /* 곧 보낼 내 입력이 있어도 합친다 — 아직 저장 안 된 칸은 mergeFlat 이 지키고, 겹치면 알린다 */
    return mergeEntry(row.student_id, row, {}, {}, true);
  }
  function mergeRemoteCommon(row) {
    var d = draftNow();
    if (!row || !d || row.week_start !== d.weekStart || !row.class_name) return false;
    return mergeCommon(row.class_name, row, {}, {}, true);
  }

  /* ---------- 전화번호 ---------- */

  function phoneDigits(v) { return String(v || '').replace(/\D/g, ''); }

  function phoneFormat(v) {
    var d = phoneDigits(v);
    if (!d) return '';
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) {
      if (d.slice(0, 2) === '02') return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6);
      return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    }
    return d;
  }

  function phoneValid(v) {
    var d = phoneDigits(v);
    return d === '' || (d.length >= 9 && d.length <= 11);
  }

  /* 화면에 보이는 번호 — 010-****-1234 (복사 · 문자 앱 열기에는 원래 번호를 쓴다) */
  function phoneMask(v) {
    var d = phoneDigits(v);
    if (!d) return '';
    if (d.length < 8) return d.slice(0, 2) + '****';
    return d.slice(0, 3) + '-****-' + d.slice(-4);
  }

  function parentTitleOf(s) {
    return (s && String(s.parentTitle || '').trim()) || '어머님';
  }

  function phonesOf(s) {
    var out = [];
    if (s && s.parentPhone) out.push({ who: 'parent', label: parentTitleOf(s), number: s.parentPhone });
    if (s && s.parentPhone2 && phoneDigits(s.parentPhone2) !== phoneDigits(s.parentPhone)) out.push({ who: 'parent2', label: parentTitleOf(s) + ' 2', number: s.parentPhone2 });
    if (s && s.studentPhone) out.push({ who: 'student', label: '학생 본인', number: s.studentPhone });
    return out;
  }

  /* ---------- 아이디 · 랜덤 코드 ---------- */

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    var h = Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* 추측할 수 없는 코드. 영문 대소문자+숫자 62가지에서 고르게 뽑는다.
     24자 ≈ 143비트 — 아무리 많이 넣어 봐도 맞힐 수 없는 크기다. */
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function randomCode(len) {
    var out = '';
    var buf = new Uint8Array(len * 2);
    while (out.length < len) {
      crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length && out.length < len; i++) {
        if (buf[i] < 248) out += ALPHA[buf[i] % 62];     /* 248 = 62×4. 넘는 값은 버려 치우침을 없앤다 */
      }
    }
    return out;
  }

  /* 앱 공유 링크 전체를 붙여도 코드만 뽑는다.
     https://marathonstudy.com/share/report/274bda… → 274bda… */
  function extractAppCode(input) {
    var v = String(input || '').trim();
    if (!v) return '';
    var m = /\/share\/report\/([A-Za-z0-9_-]+)/.exec(v);
    if (m) return m[1];
    m = /^([A-Za-z0-9_-]{8,128})$/.exec(v);
    return m ? m[1] : null;              /* null = 알아볼 수 없는 값 */
  }

  /* ---------- 개인 링크 ---------- */

  function getLinks() {
    var m = read(KEYS.links, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }
  function linkOf(studentId) { return getLinks()[studentId] || {}; }
  function setLinkLocal(studentId, link) {
    var m = getLinks();
    m[studentId] = link;
    writeLocal(KEYS.links, m);
  }

  function hubUrl(code, view) {
    if (!code) return '';
    return global.CONFIG.siteUrl + '/me/#' + code + (view ? '/' + view : '');
  }
  function noticeUrl(code) {
    return code ? global.CONFIG.siteUrl + '/notice/#' + code : '';
  }

  /* ---------- 학생 명단 ---------- */

  function getStudents() {
    var list = read(KEYS.students, []);
    return Array.isArray(list) ? list : [];
  }

  function activeStudents() {
    return getStudents().filter(function (s) { return !s.archived; });
  }

  function saveStudents(list) { return write(KEYS.students, list); }

  function upsertStudent(s) {
    var list = getStudents().slice();
    var i = list.findIndex(function (x) { return x.id === s.id; });
    if (i >= 0) {
      if (!s.updatedAt) s.updatedAt = list[i].updatedAt;
      list[i] = s;
    } else list.push(s);
    saveStudents(list);
    return s;
  }

  /* 삭제 버튼 — 그 학생 한 명만 서버에서 지운다 */
  function deleteStudent(id) {
    return track('students-delete', global.DB.deleteStudentRow(id)).then(function () {
      delete base.students[id];
      writeLocal(KEYS.students, getStudents().filter(function (x) { return x.id !== id; }));
    });
  }

  /* 반 목록 — 모든 화면이 이것 하나를 쓴다.
     classes 표(반 기준 · 학생 0명인 반 포함) + 다니는 학생의 반. count = 다니는 학생 수.
     퇴원생만 남은 반은 classes 표에 없으면 나오지 않는다.
     보관한 반(반 관리)은 재원생이 있어도 나오지 않는다 — 학생은 명단 · 「오늘」 챙길 학생에 그대로 남는다. */
  var localClasses = [];   /* classes 표가 아직 없을 때 이 창에서 만든 반 (학생을 저장하면 학생의 반으로 남는다) */
  function getClasses() {
    var seen = {};
    (read(KEYS.classes, null) || []).concat(localClasses).forEach(function (n) { seen[n] = 0; });
    activeStudents().forEach(function (s) {
      var c = (s.className || '').trim();
      if (c) seen[c] = (seen[c] || 0) + 1;
    });
    return Object.keys(seen).filter(function (n) { return !isArchivedClass(n); })
      .sort(function (a, b) { return a.localeCompare(b, 'ko'); })
      .map(function (name) { return { name: name, count: seen[name] }; });
  }

  /* 보관한 반 이름들 (migration-010) */
  function archivedClasses() { return (read(KEYS.classesOff, null) || []).slice(); }
  function isArchivedClass(n) { return archivedClasses().indexOf(String(n || '').trim()) !== -1; }

  /* 비교용 — 띄어쓰기 · 끝의 '반' · 대소문자를 뺀 이름 (SQL 의 '비슷한_이름' 과 같은 규칙) */
  function classKey(n) { return String(n || '').replace(/\s+/g, '').replace(/반$/, '').toLowerCase(); }

  /* 이름이 비슷한 다른 반 — 합치지 않고 알려 주기만 한다 */
  function similarClasses(name) {
    var k = classKey(name);
    return getClasses().map(function (c) { return c.name; }).concat(archivedClasses())
      .filter(function (n) { return n !== name && classKey(n) === k; });
  }

  /* 새 반 만들기 — 서버의 classes 표에 한 줄. 이미 있으면 그대로 둔다. */
  function addClass(name) {
    name = String(name || '').trim();
    if (!name) return Promise.reject(new Error('반 이름을 적어 주세요'));
    return track('classes-add', global.DB.addClassRow(name)).then(function (r) {
      if (r.missing) {
        if (localClasses.indexOf(name) === -1) localClasses.push(name);
      } else {
        var list = (read(KEYS.classes, null) || []).slice();
        if (list.indexOf(name) === -1) list.push(name);
        writeLocal(KEYS.classes, list);
      }
      emit('jt:roster-changed');
      return name;
    });
  }

  /* ---------- 내가 만든 칸 ---------- */

  var FIELD_TYPES = [
    { type: 'text',     name: '글자',      hint: '한 줄짜리 짧은 내용 (예: 시험 범위)' },
    { type: 'textarea', name: '여러 줄 글', hint: '길게 적는 내용 (예: 수업 진도, 상담 기록)' },
    { type: 'date',     name: '날짜',      hint: '달력에서 고르는 날짜 (예: 등록일)' },
    { type: 'checkbox', name: '체크박스',   hint: '예/아니오 하나 (예: 교재 배부)' },
    { type: 'select',   name: '선택지',    hint: '미리 정한 것 중 하나 (예: 상/중/하)' }
  ];

  var SCOPES = {
    student: { name: '학생 칸', desc: '학생마다 따로 적습니다' },
    class:   { name: '반 칸',   desc: '반마다 한 번만 적으면 그 반 전체에 적용됩니다' }
  };

  function scopeOf(f) { return f && f.scope === 'class' ? 'class' : 'student'; }

  function getFieldDefs(scope) {
    var list = read(KEYS.fieldDefs, []);
    if (!Array.isArray(list)) return [];
    if (scope) list = list.filter(function (f) { return scopeOf(f) === scope; });
    return list.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }

  /* 칸 목록을 고친다 (추가 · 이름 · 순서). 바뀐 칸만 서버로 간다. 지우기는 deleteFieldDef. */
  function saveFieldDefs(list, scope) {
    var prev = {};
    getFieldDefs().forEach(function (f) { prev[f.id] = f; });
    function clean(f, i) {
      return {
        id: f.id, key: f.key, label: String(f.label || '').trim(), type: f.type || 'text',
        options: Array.isArray(f.options) ? f.options : [], showInTable: f.showInTable !== false,
        scope: scopeOf(f), sortOrder: i, updatedAt: (prev[f.id] && prev[f.id].updatedAt) || f.updatedAt || ''
      };
    }
    var next;
    if (!scope) {
      next = (list || []).map(clean);
    } else {
      var mine = (list || []).map(function (f, i) { var c = clean(f, i); c.scope = scope; return c; });
      var others = getFieldDefs().filter(function (f) { return scopeOf(f) !== scope; });
      next = others.concat(mine);
    }
    return write(KEYS.fieldDefs, next);
  }

  function deleteFieldDef(id) {
    return track('fields-delete', global.DB.deleteFieldRow(id)).then(function () {
      delete base.fields[id];
      writeLocal(KEYS.fieldDefs, getFieldDefs().filter(function (f) { return f.id !== id; }));
    });
  }

  function newFieldKey() {
    var used = {};
    getFieldDefs().forEach(function (f) { used[f.key] = true; });
    for (var i = 0; i < 500; i++) {
      var k = 'f_' + Date.now().toString(36) + '_' + i.toString(36);
      if (!used[k]) return k;
    }
    return 'f_' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 반 현황 ---------- */

  function getClassInfo() {
    var m = read(KEYS.classInfo, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }
  function saveClassInfo(map) { return write(KEYS.classInfo, map || {}); }
  function setClassExtra(className, extra) {
    var m = getClassInfo();
    m[className] = extra || {};
    return saveClassInfo(m);
  }
  function classExtra(className) { return getClassInfo()[className] || {}; }

  function fieldValue(owner, def) {
    if (!owner || !def) return '';
    var bag = scopeOf(def) === 'class'
      ? (typeof owner === 'string' ? classExtra(owner) : (owner.extra || owner))
      : (owner.extra || {});
    var v = bag[def.key];
    return v == null ? '' : v;
  }

  function fieldText(owner, def) {
    var v = fieldValue(owner, def);
    if (def.type === 'checkbox') return v ? '✓' : '';
    return String(v);
  }

  /* ---------- 암호 백업 (PBKDF2 + AES-GCM) ---------- */

  var PBKDF2_ITER = 250000;

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function deriveKey(password, salt) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
          baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  /* 담는 것: 명단 · 개인 링크 · 칸 정의 · 반 현황 · 상용구 · 발송 기록 */
  function exportEncrypted(password) {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      students:  getStudents(),
      links:     getLinks(),
      snippets:  read(KEYS.snippets, []),
      fieldDefs: read(KEYS.fieldDefs, []),
      classInfo: read(KEYS.classInfo, {}),
      sent:      read(KEYS.sent, {})
    };
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv   = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    }).then(function (cipherBuf) {
      return {
        app: 'marathon-hub-admin', type: 'device-backup',
        contains: { students: payload.students.length },
        version: SCHEMA_VERSION, encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITER, salt: b64(salt) },
        cipher: { name: 'AES-GCM', iv: b64(iv) },
        data: b64(cipherBuf)
      };
    });
  }

  function importEncrypted(fileObj, password) {
    return Promise.resolve().then(function () {
      if (!fileObj || fileObj.type !== 'device-backup' || fileObj.app !== 'marathon-hub-admin') {
        throw new Error('이 시스템의 백업 파일이 아닙니다.');
      }
      var salt = unb64(fileObj.kdf.salt), iv = unb64(fileObj.cipher.iv), data = unb64(fileObj.data);
      return deriveKey(password, salt).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
      }).then(function (plainBuf) {
        var p = JSON.parse(new TextDecoder().decode(plainBuf));
        if (!Array.isArray(p.students)) throw new Error('명단이 들어 있지 않습니다.');
        return p;
      }).catch(function (e) {
        if (e instanceof Error && e.message.indexOf('명단') === 0) throw e;
        throw new Error('암호가 맞지 않거나 파일이 손상되었습니다.');
      });
    });
  }

  /* 백업을 되살린다 — 더하거나 고치기만 한다.
     백업에 없다고 서버의 학생·칸·반 현황·상용구를 지우지 않는다.
     개인 링크는 따로 한 번에 올린다(학생이 서버에 생긴 뒤에). */
  function restorePayload(p) {
    var done = [];
    var cur = getStudents().slice();
    var n = 0;
    (p.students || []).forEach(function (s) {
      var i = cur.findIndex(function (x) { return x.id === s.id; });
      var rec = Object.assign({}, s);
      if (i >= 0) { rec.updatedAt = cur[i].updatedAt; cur[i] = rec; } else cur.push(rec);
      n++;
    });
    saveStudents(cur);
    done.push('명단 ' + n + '명');

    if (Array.isArray(p.fieldDefs)) {
      var fd = (read(KEYS.fieldDefs, []) || []).slice();
      p.fieldDefs.forEach(function (f) {
        var i = fd.findIndex(function (x) { return x.id === f.id; });
        var rec = Object.assign({}, f);
        if (i >= 0) { rec.updatedAt = fd[i].updatedAt; fd[i] = rec; } else fd.push(rec);
      });
      write(KEYS.fieldDefs, fd);
      done.push('칸 정의 ' + p.fieldDefs.length + '개');
    }
    if (p.classInfo && typeof p.classInfo === 'object') {
      var ci = getClassInfo();
      Object.keys(p.classInfo).forEach(function (k) { ci[k] = p.classInfo[k]; });
      write(KEYS.classInfo, ci);
    }
    if (Array.isArray(p.snippets)) {
      var sn = (read(KEYS.snippets, []) || []).slice();
      p.snippets.forEach(function (x) {
        if (x && x.id && !sn.some(function (y) { return y.id === x.id; })) sn.push({ id: x.id, text: x.text });
      });
      write(KEYS.snippets, sn);
    }
    if (p.links && typeof p.links === 'object') {
      var lk = getLinks();
      Object.keys(p.links).forEach(function (k) { lk[k] = p.links[k]; });
      writeLocal(KEYS.links, lk);
    }
    return { restored: done, links: p.links || {} };
  }

  /* ---------- 날짜 ---------- */

  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function mondayOf(d) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  /* 주차 = 시작일 ~ 시작일+6일 (수업일 기준 한 주). 종료일은 손으로 바꿀 수 있다. */
  var DEFAULT_SPAN = 7;

  function weekSpan() { return DEFAULT_SPAN; }

  function setWeekSpan(days) {
    var n = Math.round(Number(days) || 0);
    if (n < 1 || n > 31) return;
    var s = read(KEYS.settings, {});
    if (s.weekSpan === n) return;
    s.weekSpan = n;
    writeLocal(KEYS.settings, s);
  }

  function endFromSpan(startISO, days) {
    var d = parseISO(startISO);
    if (!d || !days || days < 1) return '';
    d.setDate(d.getDate() + days - 1);
    return toISO(d);
  }

  /* 시작일만 고른 상태에서 자동으로 채울 종료일 — 시작일 + 6일.
     어떤 요일로 시작해도 종료일이 시작일보다 빠를 수 없다. */
  function autoEnd(startISO, span) {
    var e = endFromSpan(startISO, span || weekSpan());
    if (!e) return '';
    return e < startISO ? startISO : e;
  }

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function dateWithDow(iso) {
    var d = parseISO(iso);
    return d ? (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')' : '';
  }

  function daysBetween(startISO, endISO) {
    var a = parseISO(startISO), b = parseISO(endISO);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  function thisWeek() {
    var start = toISO(mondayOf(new Date()));
    return { start: start, end: autoEnd(start) };
  }

  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Number(m[2]) + '/' + Number(m[3]) : '';
  }

  function weekEndOf(weekStart) {
    return read(KEYS.weekEnds, {})[weekStart] || '';
  }
  function setWeekEndLocal(weekStart, weekEnd) {
    var m = read(KEYS.weekEnds, {}) || {};
    m[weekStart] = weekEnd;
    writeLocal(KEYS.weekEnds, m);
  }

  /* ---------- 수업일 (migration-011 · 계산은 assets/lesson.js) ---------- */

  /* 그 반의 일정 { dow, extra, first, weeks:{주차: {lesson_date, canceled, note}} } — 요일을 안 정했으면 null */
  function schedOf(cls) {
    cls = String(cls || '').trim();
    var s = (read(KEYS.classSched, {}) || {})[cls];
    if (!s) return null;
    var weeks = {};
    (read(KEYS.classWeeks, []) || []).forEach(function (w) { if (w.class_name === cls) weeks[w.week_start] = w; });
    return { dow: s.dow, extra: s.extra || [], first: s.first || '', weeks: weeks };
  }

  function lessonOf(cls, weekStart) {
    if (!global.Lesson) return null;
    var s = schedOf(cls);
    return s ? global.Lesson.of(s, weekStart) : null;
  }

  function classWeekOf(cls, weekStart) {
    return (read(KEYS.classWeeks, []) || []).find(function (w) { return w.class_name === cls && w.week_start === weekStart; }) || null;
  }

  /* 수업 요일 정하기 — 서버 함수(class_schedule_set)가 저장한다 */
  function setSchedule(cls, dow, extra, first) {
    return track('class-schedule', global.SB.client.rpc('class_schedule_set', {
      p_name: cls, p_dow: dow, p_extra: extra || [], p_first: first || null
    })).then(function (r) {
      if (r.error) throw new Error(/Could not find the function|schema cache/i.test(r.error.message)
        ? 'migration-011 SQL 을 먼저 실행해 주세요.' : r.error.message);
      var m = Object.assign({}, read(KEYS.classSched, {}) || {});
      if (dow === null || dow === undefined) delete m[cls];
      else m[cls] = { dow: dow, extra: (r.data && r.data.extra_dows) || extra || [], first: first || '' };
      writeLocal(KEYS.classSched, m);
      emit('jt:schedule-changed', { cls: cls });
    });
  }

  /* 그 주만 수업일 바꾸기 / 휴강 — row 가 null 이면 원래대로 */
  function setClassWeek(cls, weekStart, row) {
    var c = global.SB.client;
    var p = row
      ? c.from('class_weeks').upsert({ class_name: cls, week_start: weekStart, lesson_date: row.canceled ? null : row.lesson_date,
                                       canceled: !!row.canceled, note: row.note || '' }).select()
      : c.from('class_weeks').delete().eq('class_name', cls).eq('week_start', weekStart);
    return track('class-week', p).then(function (r) {
      if (r.error) throw new Error(/does not exist|schema cache/i.test(r.error.message)
        ? 'migration-011 SQL 을 먼저 실행해 주세요.' : r.error.message);
      var list = (read(KEYS.classWeeks, []) || []).filter(function (w) { return !(w.class_name === cls && w.week_start === weekStart); });
      if (row) list.push((r.data && r.data[0]) || { class_name: cls, week_start: weekStart, lesson_date: row.lesson_date || null, canceled: !!row.canceled, note: row.note || '' });
      writeLocal(KEYS.classWeeks, list);
      emit('jt:schedule-changed', { cls: cls });
    });
  }

  /* ---------- 복습테스트 — 그 주 확인된 점수 (migration-013 · 레포트에 넣는다) ---------- */

  var reviewScores = {};     /* 주차(월요일) → { 학생 id: {round_no, correct, q_count, score} } */
  function mondayISO(iso) {
    var d = parseISO(iso);
    return d ? toISO(mondayOf(d)) : '';
  }
  function loadReview(week) {
    var mon = mondayISO(week);
    if (!mon || !global.SB) return Promise.resolve({});
    return global.SB.client.rpc('review_week_scores', { p_week: mon }).then(function (r) {
      if (r.error) return reviewScores[mon] || {};
      var m = {};
      (r.data || []).forEach(function (x) { m[x.student_id] = x; });
      reviewScores[mon] = m;
      emit('jt:review-scores', { week: mon });
      return m;
    }, function () { return reviewScores[mon] || {}; });
  }
  function reviewOf(studentId, week) {
    var m = reviewScores[mondayISO(week)];
    return (m && m[studentId]) || null;
  }

  /* ---------- 저장 전 내용 임시 보관 (이 기기 브라우저) ----------
     저장되지 않은 칸만 남긴다. 저장되면 지우고, 로그아웃하면 지운다.
     화면이 멈췄다 다시 열리면 작성 탭이 「저장 안 된 내용이 있습니다 [복구]」 를 띄운다. */
  var UNS = P + 'unsaved', UNS_P = P + 'unsaved.pending';
  var backupUser = '';
  var backupTimer = null;
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function setBackupUser(email) { backupUser = String(email || '').toLowerCase(); }

  function computeUnsaved() {
    var d = draftNow(), bw = base.week;
    if (!d || !bw || d.weekStart !== bw.weekStart) return null;
    var out = { week: d.weekStart, user: backupUser, at: new Date().toISOString(), entries: {}, common: {}, n: 0 };
    Object.keys(d.entries || {}).forEach(function (sid) {
      var cur = flatEntry(d.entries[sid]), b = bw.entries[sid] || flatRaw(null), diff = null;
      keysOf(cur, b).forEach(function (k) {
        if (same(cur[k], b[k])) return;
        diff = diff || {};
        diff[k] = cur[k] === undefined ? null : cur[k];
        out.n++;
      });
      if (diff) out.entries[sid] = diff;
    });
    Object.keys(d.common || {}).forEach(function (cls) {
      if (!cls || cls === '_') return;
      var c = d.common[cls], bn = normCommon(bw.common[cls] || rawCommon(null)), diff = null;
      COMMON_KEYS.forEach(function (k) {
        if (same(normCommon(c)[k], bn[k])) return;
        diff = diff || {};
        diff[k] = c[k];
        out.n++;
      });
      if (diff) out.common[cls] = diff;
    });
    return out;
  }
  function backupNow() {
    backupTimer = null;
    if (!backupUser) return;
    var u = computeUnsaved();
    if (!u) return;
    if (u.n) lsSet(UNS, u); else lsDel(UNS);
  }
  function scheduleBackup() {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(backupNow, 250);
  }
  /* 다시 열었을 때 — 지난번에 남은 임시 보관을 「복구 대기」 로 옮겨 둔다 (그사이 새로 쓰는 것과 섞이지 않게) */
  function takePendingBackup() {
    var live = lsGet(UNS);
    if (live && live.n && live.user === backupUser) { lsSet(UNS_P, live); lsDel(UNS); }
    var p = lsGet(UNS_P);
    if (p && p.user !== backupUser) { lsDel(UNS_P); return null; }
    return p && p.n ? p : null;
  }
  /* [복구] — 그 칸들을 내가 새로 쓴 것처럼 넣고 바로 저장한다 */
  function applyBackup(p) {
    var d = draftNow();
    if (!p || !d || p.week !== d.weekStart) return false;
    var ids = [], classes = [];
    Object.keys(p.entries || {}).forEach(function (sid) {
      var cur = d.entries[sid] || emptyEntryObj();
      var fl = flatEntry(cur);
      Object.keys(p.entries[sid]).forEach(function (k) { if (p.entries[sid][k] === null) delete fl[k]; else fl[k] = p.entries[sid][k]; });
      d.entries[sid] = unflat(fl, cur);
      ids.push(sid);
    });
    Object.keys(p.common || {}).forEach(function (cls) {
      var c = d.common[cls] || normCommon(null);
      Object.keys(p.common[cls]).forEach(function (k) { c[k] = p.common[cls][k]; });
      d.common[cls] = c;
      classes.push(cls);
    });
    lsDel(UNS_P);
    writeLocal(KEYS.draft, d);
    emit('jt:draft-remote', { entries: ids, common: classes });
    return flushNow(KEYS.draft).then(function () { return true; }, function () { scheduleBackup(); return true; });
  }
  function discardBackup() { lsDel(UNS_P); }
  function clearBackups() { clearTimeout(backupTimer); backupTimer = null; lsDel(UNS); lsDel(UNS_P); }

  /* ---------- 상용구 ---------- */

  function getSnippets()      { return read(KEYS.snippets, []); }
  function saveSnippets(list) { return write(KEYS.snippets, list); }
  function deleteSnippet(id) {
    return track('snippets-delete', global.DB.deleteSnippet(id)).then(function () {
      delete base.snippets[id];
      writeLocal(KEYS.snippets, getSnippets().filter(function (x) { return x.id !== id; }));
    });
  }

  /* ============================================================
     서버에서 받기
     ============================================================ */

  function setBaseFrom(d) {
    base.students = {};
    d.students.forEach(function (s) { base.students[s.id] = { sig: sigStudent(s), at: s.updatedAt || '' }; });
    base.fields = {};
    d.fieldDefs.forEach(function (f) { base.fields[f.id] = { sig: sigField(f), at: f.updatedAt || '' }; });
    base.classInfo = {};
    Object.keys(d.classInfo).forEach(function (n) {
      base.classInfo[n] = { sig: JSON.stringify(d.classInfo[n] || {}), at: (d.classInfoAt || {})[n] || '' };
    });
    base.snippets = {};
    d.snippets.forEach(function (s) { base.snippets[s.id] = true; });
  }

  /* 로그인 직후 — 전부 받는다 */
  function loadAll() {
    return global.DB.loadAll().then(function (d) {
      writeLocal(KEYS.students, d.students);
      writeLocal(KEYS.links, d.links);
      writeLocal(KEYS.snippets, d.snippets);
      writeLocal(KEYS.fieldDefs, d.fieldDefs);
      writeLocal(KEYS.classInfo, d.classInfo);
      writeLocal(KEYS.classes, d.classes);
      writeLocal(KEYS.classesOff, d.classesOff);
      writeLocal(KEYS.classSched, d.classSched || {});
      writeLocal(KEYS.classWeeks, d.classWeeks || []);
      writeLocal(KEYS.sent, d.sent);
      writeLocal(KEYS.published, d.published);
      writeLocal(KEYS.weekEnds, d.weekEnds);
      setBaseFrom(d);

      /* 열어 둘 주차 — 이 기기에서 마지막으로 보던 주차(화면 설정), 없으면 서버에서 마지막으로 손댄 주차 */
      var week = read(KEYS.settings, {}).lastWeek || d.latestWeek || thisWeek().start;
      return loadWeekIntoDraft(week).then(function () { return d; });
    });
  }

  /* 주차 하나를 서버에서 받아 작성 중인 주차로 둔다 */
  function loadWeekIntoDraft(week) {
    return global.DB.loadWeek(week).then(function (w) {
      var end = w.weekEnd || '';
      var touched = !!end && end >= week;
      if (!touched) end = autoEnd(week);
      var draft = { weekStart: week, weekEnd: end, weekEndTouched: touched,
                    common: w.common || {}, entries: w.entries || {} };
      var bw = { weekStart: week, weekEnd: w.weekEnd || '', entries: {}, common: {}, at: { entry: {}, common: {} } };
      Object.keys(w.rawEntries || {}).forEach(function (sid) { bw.entries[sid] = flatRaw(w.rawEntries[sid]); bw.at.entry[sid] = w.rawEntries[sid].updated_at || ''; });
      Object.keys(w.rawCommon || {}).forEach(function (cls) { bw.common[cls] = rawCommon(w.rawCommon[cls]); bw.at.common[cls] = w.rawCommon[cls].updated_at || ''; });
      base.week = bw;
      writeLocal(KEYS.draft, draft);
      loadReview(week);
      var s = read(KEYS.settings, {});
      if (s.lastWeek !== week) { s.lastWeek = week; writeLocal(KEYS.settings, s); }
      setTimeout(function () { ensureDefaults(week); }, 0);
      return draft;
    });
  }

  /* ============================================================
     출결 기본값 — 이번 주와 그 뒤 주차에서, 서버에 아직 줄이 없는 학생만 「출석 · 집중도 5」
       서버 함수(entry_defaults, migration-016)가 줄이 없을 때만 만든다 — 이미 있는 값은 절대 덮지 않는다.
       받아 온 줄은 다른 기기에서 온 줄처럼 합친다 (내가 아직 저장 안 한 칸은 그대로).
       지난 주차 · 함수가 아직 없는 서버(016 실행 전)에서는 아무것도 하지 않는다.
     ============================================================ */
  var defaultsTried = {};
  var defaultsOff = false;
  function ensureDefaults(week) {
    var d = draftNow(), bw = base.week;
    if (defaultsOff || !d || !bw || !week || d.weekStart !== week || bw.weekStart !== week) return Promise.resolve(null);
    var wk = parseISO(week);
    if (!wk || toISO(mondayOf(wk)) < thisWeek().start) return Promise.resolve(null);     /* 월요일 기준 — 지난 주차는 채우지 않는다 */
    if (!global.SB || !global.SB.client || !global.SB.client.rpc) return Promise.resolve(null);
    var ids = activeStudents().filter(function (s) {
      return !bw.entries[s.id] && !defaultsTried[week + '|' + s.id];
    }).map(function (s) { return s.id; });
    if (!ids.length) return Promise.resolve(null);
    return global.SB.client.rpc('entry_defaults', { p_week: week, p_students: ids }).then(function (res) {
      if (res.error) {
        if (/entry_defaults|function|schema cache/i.test(res.error.message || '')) defaultsOff = true;   /* 016 실행 전 */
        return null;
      }
      var d2 = draftNow();
      if (!d2 || d2.weekStart !== week || !base.week || base.week.weekStart !== week) return null;
      var changed = [];
      (res.data || []).forEach(function (row) {
        if (!row || !row.student_id) return;
        defaultsTried[week + '|' + row.student_id] = true;
        if (mergeEntry(row.student_id, row, {}, {}, true)) changed.push(row.student_id);
        /* 그 사이 결석을 눌렀으면 집중도는 0 그대로 */
        var e = d2.entries[row.student_id];
        if (e && e.attendStatus === 'absent' && e.focusScore) { e.focusScore = 0; pushToServer(KEYS.draft); }
      });
      if (changed.length) { writeLocal(KEYS.draft, d2); emit('jt:draft-remote', { entries: changed }); }
      return changed;
    }, function () { return null; });
  }

  /* 목록을 서버 최신으로 — 아직 저장 안 된 내 줄은 지킨다 */
  function mergeRows(key, kind, serverList, sig) {
    var local = read(key, []) || [];
    var B = base[kind];
    var byId = {};
    local.forEach(function (x) { byId[x.id] = x; });
    var out = [];
    var seen = {};
    serverList.forEach(function (srv) {
      seen[srv.id] = true;
      var mine = byId[srv.id];
      var b = B[srv.id];
      if (mine && b && sig(mine) !== b.sig) { out.push(mine); return; }   /* 저장 대기 중인 내 수정 */
      out.push(srv);
      B[srv.id] = { sig: sig(srv), at: srv.updatedAt || '' };
    });
    local.forEach(function (x) {
      if (seen[x.id]) return;
      if (B[x.id]) { delete B[x.id]; return; }      /* 서버에서 지워졌다 (다른 분이 삭제) */
      out.push(x);                                  /* 아직 서버에 안 올라간 새 줄 */
    });
    writeLocal(key, out);
  }

  /* 서버 최신 내용 받기 — 탭을 열 때 · 창으로 돌아올 때 · 30초마다(실시간이 안 될 때) */
  var refreshing = null;
  function refreshAll() {
    if (refreshing) return refreshing;
    refreshing = global.DB.loadAll().then(function (d) {
      if (!syncTimers[KEYS.students]) mergeRows(KEYS.students, 'students', d.students, sigStudent);
      if (!syncTimers[KEYS.fieldDefs]) mergeRows(KEYS.fieldDefs, 'fields', d.fieldDefs, sigField);
      writeLocal(KEYS.links, d.links);
      writeLocal(KEYS.classes, d.classes);
      writeLocal(KEYS.classesOff, d.classesOff);
      writeLocal(KEYS.classSched, d.classSched || {});
      writeLocal(KEYS.classWeeks, d.classWeeks || []);
      writeLocal(KEYS.sent, d.sent);
      writeLocal(KEYS.published, d.published);
      writeLocal(KEYS.weekEnds, d.weekEnds);

      if (!syncTimers[KEYS.classInfo]) {
        var ci = getClassInfo();
        var B = base.classInfo;
        Object.keys(d.classInfo).forEach(function (n) {
          var b = B[n];
          if (ci[n] && b && JSON.stringify(ci[n]) !== b.sig) return;
          ci[n] = d.classInfo[n];
          B[n] = { sig: JSON.stringify(ci[n] || {}), at: (d.classInfoAt || {})[n] || '' };
        });
        writeLocal(KEYS.classInfo, ci);
      }

      var sn = getSnippets().slice();
      d.snippets.forEach(function (s) {
        if (!sn.some(function (x) { return x.id === s.id; })) sn.push(s);
        base.snippets[s.id] = true;
      });
      sn = sn.filter(function (x) {
        return d.snippets.some(function (s) { return s.id === x.id; }) || !base.snippets[x.id];
      });
      writeLocal(KEYS.snippets, sn);

      var dr = draftNow();
      if (!dr || !dr.weekStart || syncTimers[KEYS.draft] || draftInflight) return null;
      var week = dr.weekStart;
      return global.DB.loadWeek(week).then(function (w) {
        var d2 = draftNow();
        /* 불러오는 사이 저장이 있었으면 받아 온 줄이 옛것일 수 있다 — 줄마다 수정 시각으로 한 번 더 거른다 */
        if (!d2 || d2.weekStart !== week || !base.week || base.week.weekStart !== week || syncTimers[KEYS.draft] || draftInflight) return;
        var changedE = [], changedC = [];
        keysOf(w.rawEntries, d2.entries).forEach(function (sid) {
          if (mergeEntry(sid, w.rawEntries[sid] || null, {}, {}, true)) changedE.push(sid);
        });
        keysOf(w.rawCommon, d2.common).forEach(function (cls) {
          if (!cls || cls === '_') return;
          if (mergeCommon(cls, w.rawCommon[cls] || null, {}, {}, true)) changedC.push(cls);
        });
        if (w.weekEnd && d2.weekEnd === base.week.weekEnd && w.weekEnd !== d2.weekEnd) {
          d2.weekEnd = w.weekEnd; d2.weekEndTouched = true; changedC.push('_week');
        }
        if (w.weekEnd) base.week.weekEnd = w.weekEnd;
        if (changedE.length || changedC.length) emit('jt:draft-remote', { entries: changedE, common: changedC });
        return ensureDefaults(week);          /* 새로 들어온 학생도 */
      });
    }).then(function () {
      refreshing = null;
      emit('jt:refreshed');
    }, function (e) {
      refreshing = null;
      throw e;
    });
    return refreshing;
  }

  function clearAll() {
    clearBackups();
    Object.keys(KEYS).forEach(function (k) { remove(KEYS[k]); });
    mem = {};
    localClasses = [];
    base = { students: {}, fields: {}, classInfo: {}, snippets: {}, week: null };
  }

  global.Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KEYS: KEYS,
    read: read, write: write, writeLocal: writeLocal, remove: remove,
    flushNow: flushNow, flushAll: flushAll, track: track, pendingCount: pendingCount,

    loadAll: loadAll,
    loadWeekIntoDraft: loadWeekIntoDraft,
    ensureDefaults: ensureDefaults,
    refreshAll: refreshAll,
    baseAt: baseAt,
    setBaseAt: setBaseAt,
    mergeRemoteEntry: mergeRemoteEntry,
    mergeRemoteCommon: mergeRemoteCommon,
    setEditingHook: setEditingHook,
    enableSync: enableSync,
    onSyncChange: onSyncChange,
    syncState: syncState,

    newId: newId,
    randomCode: randomCode,
    extractAppCode: extractAppCode,
    getLinks: getLinks, linkOf: linkOf, setLinkLocal: setLinkLocal,
    hubUrl: hubUrl, noticeUrl: noticeUrl,

    getStudents: getStudents,
    activeStudents: activeStudents,
    saveStudents: saveStudents,
    upsertStudent: upsertStudent,
    deleteStudent: deleteStudent,
    getClasses: getClasses,
    schedOf: schedOf,
    acceptRemote: acceptRemote,
    KEY_LABEL: KEY_LABEL,
    keepMine: keepMine,
    saveStateOf: saveStateOf,
    setBackupUser: setBackupUser,
    takePendingBackup: takePendingBackup,
    applyBackup: applyBackup,
    discardBackup: discardBackup,
    clearBackups: clearBackups,
    backupNow: backupNow,
    /* 아직 서버에 저장되지 않은 것이 있는가 — 떠나기 전 확인 (nav.js) */
    hasUnsaved: function () {
      if (pendingCount() > 0) return true;
      var u = computeUnsaved();
      return !!(u && u.n);
    },
    loadReview: loadReview,
    reviewOf: reviewOf,
    lessonOf: lessonOf,
    classWeekOf: classWeekOf,
    setSchedule: setSchedule,
    setClassWeek: setClassWeek,
    similarClasses: similarClasses,
    archivedClasses: archivedClasses,
    isArchivedClass: isArchivedClass,
    addClass: addClass,

    phoneDigits: phoneDigits,
    phoneFormat: phoneFormat,
    phoneMask: phoneMask,
    phoneValid: phoneValid,
    parentTitleOf: parentTitleOf,
    phonesOf: phonesOf,

    exportEncrypted: exportEncrypted,
    importEncrypted: importEncrypted,
    restorePayload: restorePayload,

    toISO: toISO, parseISO: parseISO, thisWeek: thisWeek,
    dateWithDow: dateWithDow, daysBetween: daysBetween, endFromSpan: endFromSpan,
    autoEnd: autoEnd, weekSpan: weekSpan, setWeekSpan: setWeekSpan,
    shortDate: shortDate, weekEndOf: weekEndOf, setWeekEndLocal: setWeekEndLocal,

    getSnippets: getSnippets, saveSnippets: saveSnippets, deleteSnippet: deleteSnippet,
    getFieldDefs: getFieldDefs, saveFieldDefs: saveFieldDefs, deleteFieldDef: deleteFieldDef,
    newFieldKey: newFieldKey, FIELD_TYPES: FIELD_TYPES, SCOPES: SCOPES,
    fieldValue: fieldValue, fieldText: fieldText, scopeOf: scopeOf,
    getClassInfo: getClassInfo, saveClassInfo: saveClassInfo,
    setClassExtra: setClassExtra, classExtra: classExtra,

    clearAll: clearAll
  };

})(window);
