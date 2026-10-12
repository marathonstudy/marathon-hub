/* ============================================================
   store.js — 브라우저 저장소(캐시) · 서버 동기화 · 암호 백업 · 공용 도구

   명단은 서버(Supabase)가 주인이다. 이 브라우저에는 사본만 둔다.
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
    settings:  P + 'settings',   /* 이 기기만의 화면 설정 */
    fieldDefs: P + 'fielddefs',
    classInfo: P + 'classinfo',
    weekEnds:  P + 'weekends'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /* ---------- 서버 동기화 ----------
     모든 저장이 write() 한 곳을 지난다. 로컬 저장은 바로 끝내고,
     서버 전송은 묶어서 보낸다. */

  var syncEnabled = false;
  var syncTimers = {};
  var syncState = { pending: 0, error: null };
  var syncListeners = [];

  function onSyncChange(fn) { syncListeners.push(fn); }
  function emitSync() {
    syncListeners.forEach(function (fn) { try { fn(syncState); } catch (e) { console.error(e); } });
  }

  function enableSync(on) {
    syncEnabled = !!on;
    syncState.error = null;
    emitSync();
  }

  function runSync(label, fn) {
    syncState.pending++;
    emitSync();
    return Promise.resolve().then(fn).then(function () {
      syncState.pending--;
      syncState.error = null;
      emitSync();
    }).catch(function (e) {
      syncState.pending--;
      syncState.error = (e && e.message) || String(e);
      console.error('동기화 실패 [' + label + ']', e);
      emitSync();
    });
  }

  /* 서버로 바로 보내야 할 때(엑셀 넣기 등) 화면 위 '저장 중' 표시를 같이 쓴다 */
  function track(label, promise) {
    return runSync(label, function () { return promise; }).then(function () {
      if (syncState.error) throw new Error(syncState.error);
    });
  }

  var fieldClearOk = false;

  function queueSync(label, delay, fn) {
    if (!syncEnabled || !global.DB) return;
    clearTimeout(syncTimers[label]);
    syncTimers[label] = setTimeout(function () { runSync(label, fn); }, delay);
  }

  function pushToServer(key, value) {
    if (key === KEYS.students) {
      queueSync('students', 500, function () { return global.DB.syncStudents(value); });
    } else if (key === KEYS.snippets) {
      queueSync('snippets', 700, function () { return global.DB.saveSnippets(value); });
    } else if (key === KEYS.draft) {
      queueSync('draft', 800, function () { return pushDraft(value); });
    } else if (key === KEYS.fieldDefs) {
      var allowClear = fieldClearOk;
      queueSync('fieldDefs', 500, function () {
        return global.DB.syncFieldDefs(value, { allowClear: allowClear });
      });
    } else if (key === KEYS.classInfo) {
      queueSync('classInfo', 500, function () { return global.DB.syncClassInfo(value); });
    }
  }

  function pushDraft(draft) {
    if (!draft || !draft.weekStart) return Promise.resolve();
    var ids = getStudents().map(function (s) { return s.id; });
    var jobs = [global.DB.saveWeekMeta(draft.weekStart, draft.weekEnd)];
    Object.keys(draft.common || {}).forEach(function (cls) {
      if (!cls || cls === '_') return;
      jobs.push(global.DB.saveWeekCommon(draft.weekStart, cls, draft.common[cls]));
    });
    jobs.push(global.DB.saveEntries(draft.weekStart, draft.entries, ids));
    return Promise.all(jobs);
  }

  /* 지금 묶여 있는 저장을 기다리지 않고 바로 보낸다 (주차를 바꾸기 직전 등) */
  function flushNow(key, value) {
    if (key === KEYS.students) {
      /* 개인 링크는 학생 줄이 서버에 있어야 저장된다(외래키). 그래서 기다렸다가 바로 보낸다. */
      clearTimeout(syncTimers.students);
      if (!syncEnabled) return Promise.reject(new Error('로그인 상태가 아닙니다.'));
      return track('students', global.DB.syncStudents(value || getStudents()));
    }
    if (key === KEYS.draft) {
      clearTimeout(syncTimers.draft);
      if (!syncEnabled) return Promise.resolve();
      return runSync('draft', function () { return pushDraft(value); });
    }
    return Promise.resolve();
  }

  function write(key, value) {
    var ok = true;
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('저장 실패:', key, e); ok = false; }
    try { pushToServer(key, value); } catch (e) { console.error(e); }
    return ok;
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
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

  function parentTitleOf(s) {
    return (s && String(s.parentTitle || '').trim()) || '어머님';
  }

  function phonesOf(s) {
    var out = [];
    if (s && s.parentPhone) out.push({ who: 'parent', label: parentTitleOf(s), number: s.parentPhone });
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
    var list = getStudents();
    var i = list.findIndex(function (x) { return x.id === s.id; });
    if (i >= 0) list[i] = s; else list.push(s);
    saveStudents(list);
    return s;
  }

  function deleteStudent(id) {
    saveStudents(getStudents().filter(function (x) { return x.id !== id; }));
  }

  /* 반 목록 — 다니는 학생 기준. 퇴원생만 남은 반은 나오지 않는다. */
  function getClasses() {
    var seen = {};
    activeStudents().forEach(function (s) {
      var c = (s.className || '').trim();
      if (c) seen[c] = (seen[c] || 0) + 1;
    });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ko'); })
      .map(function (name) { return { name: name, count: seen[name] }; });
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

  function saveFieldDefs(list, scope) {
    function clean(f, i) {
      return {
        id: f.id, key: f.key, label: String(f.label || '').trim(), type: f.type || 'text',
        options: Array.isArray(f.options) ? f.options : [], showInTable: f.showInTable !== false,
        scope: scopeOf(f), sortOrder: i
      };
    }
    var next;
    if (!scope) {
      next = (list || []).map(clean);
    } else {
      var mine = (list || []).map(function (f) { var c = clean(f, 0); c.scope = scope; return c; });
      var others = getFieldDefs().filter(function (f) { return scopeOf(f) !== scope; });
      mine.forEach(function (f, i) { f.sortOrder = i; });
      others.forEach(function (f, i) { f.sortOrder = i; });
      next = others.concat(mine);
    }
    fieldClearOk = true;
    try { return write(KEYS.fieldDefs, next); }
    finally { fieldClearOk = false; }
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

  /* 백업을 되살린다. 명단·칸·반 현황·상용구는 서버로 올라가고,
     개인 링크는 따로 한 번에 올린다(학생이 서버에 생긴 뒤에). */
  function restorePayload(p) {
    var done = [];
    saveStudents(p.students || []);
    done.push('명단 ' + (p.students || []).length + '명');
    if (Array.isArray(p.snippets)) write(KEYS.snippets, p.snippets);
    if (Array.isArray(p.fieldDefs)) { write(KEYS.fieldDefs, p.fieldDefs); done.push('칸 정의 ' + p.fieldDefs.length + '개'); }
    if (p.classInfo && typeof p.classInfo === 'object') write(KEYS.classInfo, p.classInfo);
    if (p.links && typeof p.links === 'object') writeLocal(KEYS.links, p.links);
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

  var DEFAULT_SPAN = 5;

  function weekSpan() {
    var n = Number(read(KEYS.settings, {}).weekSpan);
    return (n >= 1 && n <= 31) ? Math.round(n) : DEFAULT_SPAN;
  }

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

  /* 시작일만 고른 상태에서 자동으로 채울 종료일 — 지난번과 같은 기간 길이.
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
    var m = read(KEYS.weekEnds, {});
    m[weekStart] = weekEnd;
    writeLocal(KEYS.weekEnds, m);
  }

  /* ---------- 상용구 ---------- */

  function getSnippets()      { return read(KEYS.snippets, []); }
  function saveSnippets(list) { return write(KEYS.snippets, list); }

  /* ============================================================
     서버에서 전체 받아 캐시에 넣기 (로그인 직후)
     ============================================================ */

  function loadAll() {
    return global.DB.loadAll().then(function (d) {
      writeLocal(KEYS.students, d.students);
      writeLocal(KEYS.links, d.links);
      writeLocal(KEYS.snippets, d.snippets);
      writeLocal(KEYS.fieldDefs, d.fieldDefs);
      writeLocal(KEYS.classInfo, d.classInfo);
      writeLocal(KEYS.sent, d.sent);
      writeLocal(KEYS.published, d.published);
      writeLocal(KEYS.weekEnds, d.weekEnds);

      /* 열어 둘 주차 — 이 기기에서 보던 주차, 없으면 서버에서 마지막으로 손댄 주차 */
      var local = read(KEYS.draft, null);
      var week = (local && local.weekStart) || d.latestWeek || thisWeek().start;
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
      writeLocal(KEYS.draft, draft);
      return draft;
    });
  }

  function clearAll() {
    Object.keys(KEYS).forEach(function (k) { remove(KEYS[k]); });
  }

  global.Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KEYS: KEYS,
    read: read, write: write, writeLocal: writeLocal, remove: remove,
    flushNow: flushNow, track: track,

    loadAll: loadAll,
    loadWeekIntoDraft: loadWeekIntoDraft,
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

    phoneDigits: phoneDigits,
    phoneFormat: phoneFormat,
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

    getSnippets: getSnippets, saveSnippets: saveSnippets,
    getFieldDefs: getFieldDefs, saveFieldDefs: saveFieldDefs,
    newFieldKey: newFieldKey, FIELD_TYPES: FIELD_TYPES, SCOPES: SCOPES,
    fieldValue: fieldValue, fieldText: fieldText, scopeOf: scopeOf,
    getClassInfo: getClassInfo, saveClassInfo: saveClassInfo,
    setClassExtra: setClassExtra, classExtra: classExtra,

    clearAll: clearAll
  };

})(window);
