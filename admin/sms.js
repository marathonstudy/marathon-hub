/* ============================================================
   sms.js — 사이트에서 문자 보내기 (SMS · LMS · 솔라피 · Edge Function sms-send · migration-023)

   「문자 보내기」 창
     · 받는 사람: 반 전체(여러 반) 또는 학생 골라서 · 보낼 곳: 학부모 1 · 학부모 2 · 학생 본인
     · 내용: #{이름} #{반} #{링크}(학부모에겐 학부모 링크, 학생에겐 학생 링크) #{수업일}
       단문(90바이트까지) · 장문 표시 · 첫 3명 미리보기 · 예상 비용 · 「자주 쓰는 문구」(직원 공용) 저장 · 불러오기
     · 같은 번호는 한 번만 — 형제가 같은 번호를 쓰면 「따로 보내기」를 직접 켰을 때만 따로
     · 광고 문자: 맨 앞 (광고)와 발신처, 끝에 무료수신거부 안내. 수신거부 번호가 [설정]에 없거나 밤(21시 ~ 8시)이면 막는다
     · 보내기 전 「n명 · 예상 약 n원」 확인 · [나에게 시험 발송] · 한 번 · 하루 상한(설정) · 실패 이유 · [실패만 다시 보내기]
     · 화면은 학생 id 와 보낼 곳만 함수에 넘긴다. 번호는 함수가 DB 에서 찾는다 (화면의 번호는 미리보기 · 셈에만 쓴다)
   여는 곳 — 받는 사람이 미리 채워진다
     · ④ 발송 반 카드 [반 전체 문자] · 학생 ⋯ [사이트에서 문자] → 그 주 수업일 · 「보냄」 표시 칸
     · 「오늘」 반 카드 [문자] · 그 안 학생 줄 [문자] · ① 명단 학생 줄 [문자] (data-sms-cls · data-sms-sid)
   「문자 보낸 기록」 창 — 반 · 학생 · 날짜로 찾기 (직원, 시각, 받는 사람, 번호 뒤 4자리, 내용 앞부분, 성공 · 실패)
   「오늘」 → [설정] 문자 칸 — 키 세 개(✓/✗) · 단가 · 한 번 · 하루 최대 · 광고 발신처 · 무료수신거부 번호
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function sb() { return SB.client; }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isMissing(e) { return /Could not find the function|does not exist|schema cache|relation .* does not exist/i.test((e && e.message) || ''); }
  var FN = 'sms-send';
  var NOCLS = '(반 없음)';
  var TARGETS = ['parent1', 'parent2', 'student'];
  var DEF = { smsWon: 20, lmsWon: 50, perSend: 200, dailyMax: 500, adName: '마라톤국어', optout: '' };

  var st = {
    mode: 'class', classes: {}, picked: {}, find: '',
    week: '', from: '',
    cfg: null, missing: false,
    templates: [],
    failed: [],            /* 마지막에 실패한 줄 [{ student_id, to }] — [실패만 다시 보내기] */
    busy: false
  };

  function invoke(body) {
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, reason: 'nofn', message: '문자 함수(sms-send)를 부를 수 없습니다.' });
    return fns.invoke(FN, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().catch(function () { return null; }).then(function (j) {
          return j || { ok: false, reason: 'nofn', message: '문자 함수(sms-send)를 부르지 못했습니다. 배포됐는지 확인해 주세요.' };
        });
      }
      return { ok: false, reason: 'nofn', message: '문자 함수(sms-send)를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) {
      return { ok: false, reason: 'nofn', message: '문자 함수(sms-send)를 부르지 못했습니다 — ' + ((e && e.message) || '') };
    });
  }

  /* ---------- 학생 · 반 ---------- */

  function active() { return UI.activeStudents(); }
  function clsOf(s) { return (s.className || '').trim() || NOCLS; }
  function order(names) {
    if (window.TodayView && TodayView.orderClasses) return TodayView.orderClasses(names);
    return names.slice().sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }
  function classNames() {
    var seen = {};
    active().forEach(function (s) { seen[clsOf(s)] = 1; });
    return order(Object.keys(seen).filter(function (n) { return n === NOCLS || !Store.isArchivedClass(n); }));
  }
  /* 반 순서 → 이름 순 */
  function sortStudents(list) {
    var rank = {};
    classNames().forEach(function (n, i) { rank[n] = i; });
    return list.slice().sort(function (a, b) {
      var c = (rank[clsOf(a)] || 0) - (rank[clsOf(b)] || 0);
      return c || (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }
  function pickedStudents() {
    return sortStudents(active().filter(function (s) {
      return st.mode === 'class' ? !!st.classes[clsOf(s)] : !!st.picked[s.id];
    }));
  }
  function targets() {
    return TARGETS.filter(function (t, i) { return $(['#smsToP1', '#smsToP2', '#smsToSt'][i]).checked; });
  }
  function numberOf(s, t) { return t === 'parent1' ? s.parentPhone : t === 'parent2' ? s.parentPhone2 : s.studentPhone; }
  function labelOf(s, t) { return t === 'parent1' ? Store.parentTitleOf(s) + '(학부모 1)' : t === 'parent2' ? '학부모 2' : '학생 본인'; }
  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }

  /* ---------- 글 ---------- */

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function kdate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (+m[2]) + '월 ' + (+m[3]) + '일(' + DOW[d.getUTCDay()] + ')';
  }
  /* #{수업일} — ④ 발송에서 열면 그 주 수업일, 아니면 다음 수업일 (휴강은 건너뛴다) */
  function lessonText(cls) {
    if (cls === NOCLS) return '';
    if (st.week) {
      var L = Store.lessonOf(cls, st.week);
      if (L && L.date && !L.canceled) return kdate(L.date);
    }
    var nx = window.TodayView && TodayView.nextLesson ? TodayView.nextLesson(cls) : null;
    return nx ? kdate(nx.date) : '';
  }
  function lessonsMap(list) {
    var m = {};
    list.forEach(function (x) { var c = (x.s.className || '').trim(); if (c && !(c in m)) m[c] = lessonText(c); });
    return m;
  }
  function cfg() { return st.cfg || DEF; }
  function bytes(t) {
    var n = 0;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); n += (c > 0 && c < 128) ? 1 : 2; }
    return n;
  }
  function hasLink(body) { return body.indexOf('#{링크}') !== -1; }
  function linkFor(s, t) {
    var l = Store.linkOf(s.id);
    var code = t === 'student' ? l.studentCode : l.hubCode;
    return code ? CONFIG.siteUrl + '/me/#' + code : '';
  }
  function textFor(body, s, t, lessons) {
    var txt = body.split('#{이름}').join(s.name || '')
      .split('#{반}').join((s.className || '').trim())
      .split('#{수업일}').join(String(lessons[(s.className || '').trim()] || '').slice(0, 30))
      .split('#{링크}').join(linkFor(s, t));
    if ($('#smsAd').checked) txt = '(광고)' + cfg().adName + '\n' + txt + '\n무료수신거부 ' + cfg().optout;
    return txt;
  }

  /* 받는 줄 만들기 — 함수(sms_prepare)와 같은 규칙. list = [{ s, t }] (학생 순서 · 보낼 곳 순서) */
  function build(list, body, siblings) {
    var lessons = lessonsMap(list);
    var out = { items: [], sib: [], noPhone: [], noLink: [], tooLong: [], lessons: lessons, people: 0 };
    var seen = {}, mineBy = {}, okBy = {};
    list.forEach(function (x) {
      var s = x.s, t = x.t;
      var d = Store.phoneDigits(numberOf(s, t));
      if (!mobile(d)) return;
      var mine = mineBy[s.id] = mineBy[s.id] || {};
      if (mine[d]) return;                                   /* 같은 학생 · 같은 번호(학부모 1 = 2) — 한 번만 */
      if (hasLink(body) && !linkFor(s, t)) { out.noLink.push(x); return; }
      var sib = !!seen[d] && seen[d] !== s.id;
      if (sib) { out.sib.push(x); if (!siblings) return; }
      var txt = textFor(body, s, t, lessons);
      var b = bytes(txt);
      if (b > 2000) { out.tooLong.push(x); return; }
      mine[d] = 1;
      if (!seen[d]) seen[d] = s.id;
      okBy[s.id] = 1;
      out.items.push({ s: s, t: t, d: d, text: txt, bytes: b, kind: b <= 90 ? 'SMS' : 'LMS' });
    });
    var stuSeen = {};
    list.forEach(function (x) {
      if (stuSeen[x.s.id]) return;
      stuSeen[x.s.id] = 1;
      var any = targetsOfList(list, x.s.id).some(function (t) { return mobile(Store.phoneDigits(numberOf(x.s, t))); });
      if (!any) out.noPhone.push(x.s);
    });
    out.people = Object.keys(okBy).length;
    out.sms = out.items.filter(function (x) { return x.kind === 'SMS'; }).length;
    out.lms = out.items.length - out.sms;
    out.won = out.sms * cfg().smsWon + out.lms * cfg().lmsWon;
    return out;
  }
  function targetsOfList(list, sid) { return list.filter(function (x) { return x.s.id === sid; }).map(function (x) { return x.t; }); }

  function listFromPicks() {
    var ts = targets(), out = [];
    pickedStudents().forEach(function (s) { ts.forEach(function (t) { out.push({ s: s, t: t }); }); });
    return out;
  }

  /* ---------- 그리기 ---------- */

  function renderPick() {
    $$('[data-smsmode]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.smsmode === st.mode); b.setAttribute('aria-pressed', String(b.dataset.smsmode === st.mode)); });
    var names = classNames();
    $('#smsClassBox').hidden = st.mode !== 'class';
    $('#smsStudentBox').hidden = st.mode !== 'student';
    if (st.mode === 'class') {
      $('#smsClassBox').innerHTML = names.map(function (n) {
        var cnt = active().filter(function (s) { return clsOf(s) === n; }).length;
        return '<button class="chip' + (st.classes[n] ? ' is-on' : '') + '" type="button" data-smscls="' + esc(n) + '" aria-pressed="' + !!st.classes[n] + '">' + esc(n) + ' <span class="num">' + cnt + '</span></button>';
      }).join('') || '<p class="panel__hint">다니는 학생이 없습니다.</p>';
    } else {
      var q = st.find.replace(/\s+/g, '').toLowerCase();
      var list = sortStudents(active()).filter(function (s) {
        return !q || ((s.name || '') + clsOf(s)).replace(/\s+/g, '').toLowerCase().indexOf(q) !== -1 || st.picked[s.id];
      });
      $('#smsStuList').innerHTML = list.map(function (s) {
        return '<label class="check-line sms-stu"><input type="checkbox" data-smssid="' + esc(s.id) + '"' + (st.picked[s.id] ? ' checked' : '') + '> <span>' + esc(s.name || '') + ' <span class="muted-note">' + esc(clsOf(s)) + '</span></span></label>';
      }).join('') || '<p class="panel__hint">찾는 학생이 없습니다.</p>';
    }
    var n = pickedStudents().length;
    $('#smsPickedHint').textContent = n ? '학생 ' + n + '명 골랐습니다' : '받는 사람을 골라 주세요';
  }

  function adBlock() {
    if (!$('#smsAd').checked) return '';
    if (!String(cfg().optout || '').trim()) return '무료수신거부 번호가 [설정]에 없어 광고 문자를 보낼 수 없습니다. 「오늘」 → [설정] → 문자에서 넣어 주세요.';
    if (!String(cfg().adName || '').trim()) return '광고 발신처 이름이 [설정]에 없어 광고 문자를 보낼 수 없습니다.';
    var h = (new Date().getUTCHours() + 9) % 24;
    if (h >= 21 || h < 8) return '광고 문자는 밤 9시 ~ 아침 8시에 보낼 수 없습니다.';
    return '';
  }

  var plan = null;
  function renderPreview() {
    var body = $('#smsBody').value;
    var sibOn = !!($('#smsSib') && $('#smsSib').checked);
    plan = build(listFromPicks(), body, sibOn);
    var b0 = bytes(body);
    $('#smsLen').textContent = body ? (b0 <= 90 && !$('#smsAd').checked && !hasLink(body) ? '단문 · ' : '') + '쓴 글 ' + b0 + '바이트 · 이름 · 링크를 넣고 90바이트가 넘으면 장문' : '';
    var warn = adBlock();
    $('#smsAdWarn').hidden = !warn;
    $('#smsAdWarn').textContent = warn;

    var host = $('#smsPreview');
    if (st.missing) { host.innerHTML = ''; updateButtons(); return; }
    if (!pickedStudents().length) { host.innerHTML = '<p class="panel__hint">받는 사람을 고르면 여기에 보입니다.</p>'; updateButtons(); return; }
    if (!targets().length) { host.innerHTML = '<p class="panel__hint">보낼 곳(학부모 1 · 2 · 학생 본인)을 하나 이상 골라 주세요.</p>'; updateButtons(); return; }
    var c = cfg();
    var html = '<p class="sms-sum"><b class="num">' + plan.people + '</b>명 · 문자 <b class="num">' + plan.items.length + '</b>건' +
      (plan.items.length ? ' (단문 ' + plan.sms + ' · 장문 ' + plan.lms + ')' : '') +
      ' · 예상 약 <b class="num">' + plan.won.toLocaleString() + '</b>원 <span class="muted-note">단문 ' + c.smsWon + '원 · 장문 ' + c.lmsWon + '원</span></p>';
    if (plan.noPhone.length) html += '<p class="cp-warn">번호 없음 ' + plan.noPhone.length + '명: ' + esc(plan.noPhone.slice(0, 20).map(function (s) { return s.name; }).join(', ')) + (plan.noPhone.length > 20 ? ' 외' : '') + '</p>';
    if (plan.noLink.length) html += '<p class="cp-warn">링크가 없어 빼는 줄 ' + plan.noLink.length + '개: ' + esc(plan.noLink.slice(0, 10).map(function (x) { return x.s.name + '(' + labelOf(x.s, x.t) + ')'; }).join(', ')) + ' — ① 명단에서 링크를 발급해 주세요</p>';
    if (plan.tooLong.length) html += '<p class="cp-warn">2000바이트가 넘어 빼는 줄 ' + plan.tooLong.length + '개</p>';
    if (plan.sib.length) {
      html += '<label class="check-line sms-sib"><input type="checkbox" id="smsSib"' + (sibOn ? ' checked' : '') + '> <span>같은 번호를 쓰는 형제 ' + plan.sib.length + '명에게도 따로 보내기 <span class="field__opt">' +
        esc(plan.sib.slice(0, 6).map(function (x) { return x.s.name; }).join(', ')) + ' · 끄면 번호마다 한 번만 (앞 학생 이름으로)</span></span></label>';
    }
    if (body.trim()) {
      html += plan.items.slice(0, 3).map(function (x) {
        return '<div class="sms-pv"><div class="sms-pv__head"><b>' + esc(x.s.name) + '</b> <span class="muted-note">' + esc(clsOf(x.s)) + '</span> → ' + esc(labelOf(x.s, x.t)) +
          ' <span class="num">' + esc(Store.phoneMask(x.d)) + '</span> <span class="sms-kind sms-kind--' + x.kind + '">' + (x.kind === 'SMS' ? '단문' : '장문') + ' ' + x.bytes + '바이트</span></div>' +
          '<pre class="sms-pv__text">' + esc(x.text) + '</pre></div>';
      }).join('') + (plan.items.length > 3 ? '<p class="panel__hint">… 외 ' + (plan.items.length - 3) + '건</p>' : '');
    } else {
      html += '<p class="panel__hint">내용을 쓰면 첫 3명에게 갈 글이 여기에 보입니다.</p>';
    }
    if (plan.items.length > c.perSend) html += '<p class="cp-warn">한 번에 ' + c.perSend + '건까지 보낼 수 있습니다. 반을 나눠 보내 주세요.</p>';
    host.innerHTML = html;
    updateButtons();
  }

  function updateButtons() {
    var ok = !st.missing && !st.busy && plan && plan.items.length && $('#smsBody').value.trim() && !adBlock();
    $('#smsSend').disabled = !ok || plan.items.length > cfg().perSend;
    $('#smsTest').disabled = !ok;
    $('#smsSend').textContent = st.busy ? '보내는 중…' : plan && plan.items.length ? plan.items.length + '건 보내기' : '보내기';
  }

  /* ---------- 자주 쓰는 문구 (직원 공용 · sms_templates) ---------- */

  function loadTemplates() {
    return sb().from('sms_templates').select('*').order('sort_order', { ascending: true }).order('title', { ascending: true }).then(function (r) {
      if (r.error) { st.templates = []; if (isMissing(r.error)) st.missing = true; return; }
      st.templates = r.data || [];
    }, function () { st.templates = []; }).then(renderTemplates);
  }
  function renderTemplates() {
    var sel = $('#smsTpl'), keep = sel.value;
    sel.innerHTML = '<option value="">자주 쓰는 문구 (' + st.templates.length + ')</option>' + st.templates.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.title || '(이름 없음)') + '</option>';
    }).join('');
    sel.value = st.templates.some(function (t) { return t.id === keep; }) ? keep : '';
    $('#smsTplDel').disabled = !sel.value;
  }
  function tplById(id) { return st.templates.find(function (t) { return t.id === id; }) || null; }

  function useTemplate(id) {
    var t = tplById(id);
    $('#smsTplDel').disabled = !t;
    if (!t) return;
    var cur = $('#smsBody').value.trim();
    var go = function () { $('#smsBody').value = t.body || ''; $('#smsTplName').value = t.title || ''; renderPreview(); };
    if (cur && cur !== (t.body || '').trim()) {
      UI.confirmAsk('문구 불러오기', '지금 쓴 내용을 「' + (t.title || '') + '」 문구로 바꿉니다.', '바꾸기').then(function (y) { if (y) go(); else $('#smsTpl').value = ''; });
    } else go();
  }

  function saveTemplate() {
    var title = $('#smsTplName').value.trim();
    var body = $('#smsBody').value;
    if (!body.trim()) { toast('저장할 내용을 먼저 써 주세요', 'bad'); return; }
    if (!title) { toast('문구 이름을 적어 주세요', 'bad'); $('#smsTplName').focus(); return; }
    var same = st.templates.find(function (t) { return (t.title || '').trim() === title; });
    var who = UI.whoami();
    var p;
    if (same) {
      p = UI.confirmAsk('문구 덮어쓰기', '「' + title + '」 문구를 지금 내용으로 바꿉니다. 다른 직원에게도 바뀐 내용이 보입니다.', '바꾸기').then(function (y) {
        if (!y) return null;
        return sb().from('sms_templates').update({ body: body, updated_by: who, updated_at: new Date().toISOString() }).eq('id', same.id).select('*');
      });
    } else {
      var next = st.templates.reduce(function (a, t) { return Math.max(a, t.sort_order || 0); }, 0) + 1;
      p = Promise.resolve(sb().from('sms_templates').insert({ title: title, body: body, sort_order: next, updated_by: who }).select('*'));
    }
    p.then(function (r) {
      if (!r) return;
      if (r.error) { toast('문구를 저장하지 못했습니다 — ' + r.error.message, 'bad'); return; }
      var row = r.data && r.data[0];
      return loadTemplates().then(function () { if (row) { $('#smsTpl').value = row.id; $('#smsTplDel').disabled = false; } toast('「' + title + '」 문구를 저장했습니다 (직원 모두 씁니다)', 'good'); });
    });
  }

  function deleteTemplate() {
    var t = tplById($('#smsTpl').value);
    if (!t) return;
    UI.confirmAsk('문구 지우기', '「' + (t.title || '') + '」 문구를 지웁니다. 다른 직원 화면에서도 사라집니다.', '지우기').then(function (y) {
      if (!y) return;
      sb().from('sms_templates').delete().eq('id', t.id).then(function (r) {
        if (r.error) { toast('지우지 못했습니다 — ' + r.error.message, 'bad'); return; }
        $('#smsTplName').value = '';
        loadTemplates().then(function () { toast('문구를 지웠습니다'); });
      });
    });
  }

  /* ---------- 열기 ---------- */

  function loadCfg() {
    return sb().rpc('sms_settings_get').then(function (r) {
      if (r.error) { st.cfg = null; st.missing = isMissing(r.error); if (!st.missing) toast('문자 설정을 불러오지 못했습니다 — ' + r.error.message, 'bad'); return; }
      st.cfg = Object.assign({}, DEF, r.data || {});
      st.missing = false;
    }, function () { st.cfg = null; });
  }

  /* opts — { classes: [반], students: [학생 id], week: '주 시작일', from: 'send' | 'today' | 'roster' } */
  function open(opts) {
    opts = opts || {};
    var ids = (opts.students || []).filter(Boolean);
    st.mode = ids.length ? 'student' : 'class';
    st.classes = {}; st.picked = {}; st.find = '';
    (opts.classes || []).forEach(function (c) { if (c) st.classes[c] = true; });
    ids.forEach(function (id) { st.picked[id] = true; });
    st.week = opts.week || '';
    st.from = opts.from || '';
    st.failed = [];
    st.busy = false;
    $('#smsFind').value = '';
    $('#smsResult').innerHTML = '';
    $('#smsAd').checked = false;
    var mark = st.from === 'send' && !!st.week;
    $('#smsMarkLine').hidden = !mark;
    $('#smsMark').checked = mark;
    $('#smsMarkHint').textContent = mark ? Store.dateWithDow(st.week) + ' 주 레포트 — 공개된 학생 · 학부모 번호로 보낸 문자만' : '';
    $('#smsLessonHint').textContent = st.week ? Store.dateWithDow(st.week) + ' 주 수업일 (그 주가 휴강이면 다음 수업일)' : '다음 수업일 (휴강 주는 건너뜀)';
    renderPick();
    renderPreview();
    $('#smsModal').showModal();
    Promise.all([loadCfg(), loadTemplates()]).then(function () {
      $('#smsMissing').hidden = !st.missing;
      $('#smsMissing').textContent = st.missing ? 'migration-023 SQL 을 실행하고 Edge Function sms-send 를 배포하면 사이트에서 문자를 보낼 수 있습니다.' : '';
      /* ④ 발송에서 열었고 내용이 비어 있으면 「레포트 안내」 문구로 */
      if (st.from === 'send' && !$('#smsBody').value.trim()) {
        var t = st.templates.find(function (x) { return /레포트/.test(x.title || ''); });
        if (t) { $('#smsBody').value = t.body || ''; $('#smsTplName').value = t.title || ''; $('#smsTpl').value = t.id; $('#smsTplDel').disabled = false; }
      }
      renderPreview();
    });
  }

  /* ---------- 보내기 ---------- */

  function payload(items) {
    return {
      items: items.map(function (x) { return { student_id: x.s.id, to: x.t }; }),
      body: $('#smsBody').value,
      ad: $('#smsAd').checked,
      lessons: plan ? plan.lessons : {},
      siblings: !!($('#smsSib') && $('#smsSib').checked),
      markWeek: !$('#smsMarkLine').hidden && $('#smsMark').checked ? st.week : ''
    };
  }

  function send(retryList) {
    var body = $('#smsBody').value;
    var list = retryList || listFromPicks();
    var sibOn = !!($('#smsSib') && $('#smsSib').checked);
    var p = retryList ? build(retryList, body, true) : (plan = build(list, body, sibOn));
    var block = adBlock();
    if (block) { toast(block, 'bad'); return; }
    if (!body.trim()) { toast('내용을 적어 주세요', 'bad'); return; }
    if (!p.items.length) { toast('보낼 수 있는 번호가 없습니다', 'bad'); return; }
    if (p.items.length > cfg().perSend) { toast('한 번에 ' + cfg().perSend + '건까지 보낼 수 있습니다. 반을 나눠 보내 주세요', 'bad'); return; }
    var desc = p.people + '명 · 문자 ' + p.items.length + '건 (단문 ' + p.sms + ' · 장문 ' + p.lms + ') · 예상 약 ' + p.won.toLocaleString() + '원을 보냅니다.' +
      ($('#smsAd').checked ? ' 광고 문자입니다 — (광고) · 발신처 · 무료수신거부 안내가 붙습니다.' : '') +
      (!retryList && p.sib.length ? (sibOn ? ' 같은 번호를 쓰는 형제 ' + p.sib.length + '명에게도 따로 보냅니다.' : ' 같은 번호를 쓰는 형제 ' + p.sib.length + '명은 번호마다 한 번만 보냅니다.') : '') +
      (payload(p.items).markWeek ? ' 보낸 학생은 ④ 발송에 「보냄」으로 표시합니다.' : '') +
      ' 오늘 ' + ((st.cfg && st.cfg.today) || 0) + ' / ' + cfg().dailyMax + '건.';
    UI.confirmAsk(retryList ? '실패만 다시 보내기' : '문자 보내기', desc, '보내기').then(function (yes) {
      if (!yes) return;
      st.busy = true; updateButtons();
      var pl = payload(p.items);
      if (retryList) pl.siblings = true;           /* 다시 보내기는 실패한 줄 그대로 */
      invoke(Object.assign({ action: 'send' }, pl)).then(function (res) {
        st.busy = false;
        showResult(res);
        loadCfg().then(renderPreview);
        if (pl.markWeek && window.SendView) SendView.refresh();
      });
    });
  }

  var TO_LABEL = { parent1: '학부모 1', parent2: '학부모 2', student: '학생 본인', test: '시험' };

  function showResult(res) {
    var host = $('#smsResult');
    if (!res || !res.ok) {
      var m = (res && res.message) || '보내지 못했습니다.';
      host.innerHTML = '<p class="cp-warn">' + esc(m) + '</p>';
      toast(m, 'bad');
      updateButtons();
      return;
    }
    var fails = (res.results || []).filter(function (x) { return !x.ok; });
    st.failed = fails.map(function (x) { return { student_id: x.student_id, to: x.to }; });
    var sk = (res.skipped || []).filter(function (x) { return x.reason !== 'sibling'; });
    host.innerHTML = '<div class="sms-result' + (fails.length ? ' is-bad' : ' is-ok') + '">' +
        '<p><b>보냄 ' + res.sent + '건</b>' + (fails.length ? ' · <b class="sms-bad">실패 ' + fails.length + '건</b>' : '') + (sk.length ? ' · 건너뜀 ' + sk.length + '줄' : '') +
          (res.lms ? ' <span class="muted-note">(장문 ' + res.lms + ')</span>' : '') + ' — 솔라피가 받은 결과입니다. 실제 도착은 솔라피 발송 내역에서 봅니다.</p>' +
        (fails.length ? '<ul class="sms-fail">' + fails.map(function (x) {
          return '<li><b>' + esc(x.name || '') + '</b> ' + esc(TO_LABEL[x.to] || '') + ' — ' + esc(x.error || '이유 모름') + '</li>';
        }).join('') + '</ul><button class="btn btn--sm btn--primary" type="button" id="smsRetry">실패만 다시 보내기 (' + fails.length + '건)</button>' : '') +
        (sk.length ? '<p class="panel__hint">건너뜀: ' + esc(sk.slice(0, 20).map(function (x) { return (x.name || '') + ' ' + (TO_LABEL[x.to] || '') + '(' + (x.label || x.reason) + ')'; }).join(', ')) + '</p>' : '') +
      '</div>';
    toast('문자 ' + res.sent + '건 접수' + (fails.length ? ' · 실패 ' + fails.length + '건' : ''), fails.length ? 'bad' : 'good');
    updateButtons();
  }

  function retry() {
    var by = {};
    active().forEach(function (s) { by[s.id] = s; });
    var list = st.failed.map(function (x) { return by[x.student_id] ? { s: by[x.student_id], t: x.to } : null; }).filter(Boolean);
    if (!list.length) { toast('다시 보낼 줄이 없습니다', 'bad'); return; }
    send(list);
  }

  function testSend() {
    var body = $('#smsBody').value;
    if (!plan || !plan.items.length || !body.trim()) { toast('받는 사람과 내용을 먼저 정해 주세요', 'bad'); return; }
    var block = adBlock();
    if (block) { toast(block, 'bad'); return; }
    st.busy = true; updateButtons();
    var pl = payload(plan.items.slice(0, 20));
    pl.markWeek = '';
    invoke(Object.assign({ action: 'test' }, pl)).then(function (res) {
      st.busy = false;
      updateButtons();
      if (!res || !res.ok) { toast((res && res.message) || '시험 발송을 하지 못했습니다', 'bad'); return; }
      var r0 = (res.results || [])[0];
      toast(res.sent ? '내 번호로 시험 문자를 보냈습니다 (' + (r0 && r0.name ? r0.name + ' 내용' : '첫 사람 내용') + ')' : '시험 발송이 실패했습니다' + (r0 && r0.error ? ' — ' + r0.error : ''), res.sent ? 'good' : 'bad');
      loadCfg().then(renderPreview);
    });
  }

  /* ---------- 문자 보낸 기록 ---------- */

  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function openLog(opts) {
    opts = opts || {};
    var cs = classNames().filter(function (n) { return n !== NOCLS; });
    $('#smsLogClass').innerHTML = '<option value="">전체 반</option>' + cs.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    $('#smsLogStudent').innerHTML = '<option value="">전체 학생</option>' + sortStudents(UI.getStudents ? UI.getStudents() : active()).map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name || '') + ' · ' + esc(clsOf(s)) + (s.archived ? ' (퇴원)' : '') + '</option>';
    }).join('');
    $('#smsLogClass').value = opts.cls || '';
    $('#smsLogStudent').value = opts.student || '';
    var now = new Date(), from = new Date(now.getTime() - 6 * 86400000);
    $('#smsLogFrom').value = isoDay(from);
    $('#smsLogTo').value = isoDay(now);
    $('#smsLogList').innerHTML = '';
    $('#smsLogModal').showModal();
    findLog();
  }
  function fmtAt(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function findLog() {
    var host = $('#smsLogList');
    host.innerHTML = '<p class="panel__hint">찾는 중…</p>';
    sb().rpc('sms_log_search', {
      p_class: $('#smsLogClass').value || null, p_student: $('#smsLogStudent').value || null,
      p_from: $('#smsLogFrom').value || null, p_to: $('#smsLogTo').value || null, p_limit: 300
    }).then(function (r) {
      if (r.error) {
        host.innerHTML = '<p class="cp-warn">' + esc(isMissing(r.error) ? 'migration-023 SQL 을 실행하면 기록을 볼 수 있습니다.' : r.error.message) + '</p>';
        return;
      }
      var rows = r.data || [];
      if (!rows.length) { host.innerHTML = '<p class="panel__hint">이 조건으로 보낸 문자가 없습니다.</p>'; return; }
      var ok = rows.filter(function (x) { return x.status === 'ok'; }).length;
      host.innerHTML = '<p class="sms-sum">' + rows.length + '건 · 성공 ' + ok + ' · 실패 ' + rows.filter(function (x) { return x.status === 'fail'; }).length + (rows.length >= 300 ? ' (최근 300건까지)' : '') + '</p>' +
        '<div class="sms-log">' + rows.map(function (x) {
          var stt = x.status === 'ok' ? '<span class="snd-tag snd-tag--sent">성공</span>' : x.status === 'fail' ? '<span class="snd-tag snd-tag--failed" title="' + esc(x.error) + '">실패</span>' : '<span class="snd-tag">보내는 중</span>';
          return '<div class="sms-log__row">' +
              '<div class="sms-log__top"><span class="num">' + esc(fmtAt(x.at)) + '</span> <b>' + esc(x.name || '') + '</b> <span class="muted-note">' + esc(x.class_name || '') + ' · ' + esc(TO_LABEL[x.target] || x.target) + ' ****' + esc(x.phone_last4 || '') + '</span> ' +
                '<span class="sms-kind sms-kind--' + esc(x.kind) + '">' + (x.kind === 'LMS' ? '장문' : '단문') + '</span>' + (x.ad ? ' <span class="sms-kind">광고</span>' : '') + ' ' + stt + '</div>' +
              '<div class="sms-log__body">' + esc(x.body_head || '') + '</div>' +
              '<div class="sms-log__by muted-note">' + esc(x.by_name || '') + (x.status === 'fail' && x.error ? ' · ' + esc(x.error) : '') + '</div>' +
            '</div>';
        }).join('') + '</div>';
    });
  }

  /* ---------- [설정] 문자 칸 ---------- */

  function settingsHtml(fnRes, c) {
    var keys = (fnRes && fnRes.keys) || null;
    var KEY_NAME = { SOLAPI_API_KEY: 'API 키', SOLAPI_API_SECRET: 'API 시크릿', SOLAPI_SENDER: '발신번호' };
    return '<div class="extra-head" style="margin-top:18px"><span class="extra-head__title">사이트 문자 (SMS · LMS · 솔라피)</span></div>' +
      (keys
        ? '<ul class="kk-keys">' + Object.keys(KEY_NAME).map(function (k) {
            return '<li class="' + (keys[k] ? 'is-ok' : 'is-no') + '">' + (keys[k] ? '✓' : '✗') + ' ' + KEY_NAME[k] + ' <code>' + k + '</code></li>';
          }).join('') + '</ul><p class="field__hint">알림톡과 같은 키를 씁니다 · 키 값은 화면에 보이지 않습니다 (Supabase Secrets 에만).</p>'
        : '<p class="panel__hint">' + esc((fnRes && fnRes.message) || '문자 함수(sms-send)가 아직 배포되지 않았습니다.') + '</p>') +
      (c
        ? '<div class="toolbar">' +
            '<label class="field"><span class="field__label">단문 1건(원)</span><input class="input input--num" id="smsSetSms" type="number" min="0" max="1000" value="' + esc(c.smsWon) + '"></label>' +
            '<label class="field"><span class="field__label">장문 1건(원)</span><input class="input input--num" id="smsSetLms" type="number" min="0" max="1000" value="' + esc(c.lmsWon) + '"></label>' +
            '<label class="field"><span class="field__label">한 번 최대</span><input class="input input--num" id="smsSetPer" type="number" min="1" max="1000" value="' + esc(c.perSend) + '"></label>' +
            '<label class="field"><span class="field__label">하루 최대</span><input class="input input--num" id="smsSetDaily" type="number" min="1" max="10000" value="' + esc(c.dailyMax) + '"></label>' +
          '</div>' +
          '<div class="toolbar">' +
            '<label class="field"><span class="field__label">광고 발신처 <span class="field__opt">(광고) 뒤에 붙는 이름</span></span><input class="input" id="smsSetAdName" type="text" maxlength="30" value="' + esc(c.adName) + '"></label>' +
            '<label class="field"><span class="field__label">무료수신거부 번호 <span class="field__opt">비어 있으면 광고 문자를 못 보냅니다</span></span><input class="input" id="smsSetOptout" type="tel" inputmode="numeric" maxlength="16" placeholder="080-000-0000" value="' + esc(c.optout) + '"></label>' +
            '<button class="btn btn--sm" type="button" id="smsSaveCfg">문자 설정 저장</button>' +
          '</div>' +
          '<p class="field__hint">오늘 ' + esc(c.today || 0) + '건 · [나에게 시험 발송]은 위 알림톡 칸의 「내 시험 번호」로 갑니다' + (c.testPhone ? ' (지금 ' + esc(c.testPhone) + ')' : '') + '.</p>'
        : '<p class="panel__hint">migration-023 SQL 을 실행하면 문자 설정을 바꿀 수 있습니다.</p>');
  }
  function loadSettings() {
    var host = $('#smsSettings');
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<p class="panel__hint">문자 설정을 불러오는 중…</p>';
    Promise.all([
      invoke({ action: 'status' }),
      sb().rpc('sms_settings_get').then(function (r) { return r.error ? null : r.data; }, function () { return null; })
    ]).then(function (res) { host.innerHTML = settingsHtml(res[0] || null, res[1]); });
  }
  function saveSettings() {
    var p = {
      smsWon: Math.round(Number($('#smsSetSms').value)), lmsWon: Math.round(Number($('#smsSetLms').value)),
      perSend: Math.round(Number($('#smsSetPer').value) || 0), dailyMax: Math.round(Number($('#smsSetDaily').value) || 0),
      adName: $('#smsSetAdName').value.trim(), optout: $('#smsSetOptout').value.trim()
    };
    sb().rpc('sms_settings_set', { p: p }).then(function (r) {
      if (r.error) { toast(r.error.message, 'bad'); return; }
      toast('문자 설정을 저장했습니다', 'good');
      loadSettings();
    });
  }

  /* ---------- 시작 ---------- */

  function init() {
    if (!$('#smsModal')) return;
    $('#smsModal').addEventListener('click', function (e) {
      var m = e.target.closest('[data-smsmode]');
      if (m) { st.mode = m.dataset.smsmode; renderPick(); renderPreview(); return; }
      var c = e.target.closest('[data-smscls]');
      if (c) { var n = c.dataset.smscls; if (st.classes[n]) delete st.classes[n]; else st.classes[n] = true; renderPick(); renderPreview(); return; }
      var v = e.target.closest('[data-var]');
      if (v) {
        var ta = $('#smsBody'), s0 = ta.selectionStart || ta.value.length, s1 = ta.selectionEnd || s0;
        ta.value = ta.value.slice(0, s0) + v.dataset.var + ta.value.slice(s1);
        ta.focus();
        try { ta.setSelectionRange(s0 + v.dataset.var.length, s0 + v.dataset.var.length); } catch (er) {}
        renderPreview();
        return;
      }
      if (e.target.id === 'smsRetry') retry();
    });
    $('#smsModal').addEventListener('change', function (e) {
      var b = e.target.closest('[data-smssid]');
      if (b) { if (b.checked) st.picked[b.dataset.smssid] = true; else delete st.picked[b.dataset.smssid]; renderPick(); renderPreview(); return; }
      if (e.target.id === 'smsTpl') { useTemplate(e.target.value); return; }
      if (/^smsTo|^smsAd$|^smsSib$|^smsMark$/.test(e.target.id)) renderPreview();
    });
    var tm = null;
    $('#smsBody').addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(renderPreview, 150); });
    $('#smsFind').addEventListener('input', function () { st.find = $('#smsFind').value; renderPick(); });
    $('#smsTplSave').addEventListener('click', saveTemplate);
    $('#smsTplDel').addEventListener('click', deleteTemplate);
    $('#smsSend').addEventListener('click', function () { send(null); });
    $('#smsTest').addEventListener('click', testSend);
    $('#smsClose').addEventListener('click', function () { $('#smsModal').close(); });
    $('#smsLogFind').addEventListener('click', findLog);
    $('#smsLogClose').addEventListener('click', function () { $('#smsLogModal').close(); });

    /* [문자] 단추 — 「오늘」 반 카드(data-sms-cls) · 학생 줄 · ① 명단(data-sms-sid, 비어 있으면 줄의 data-id) · ④ 발송 [반 전체 문자] */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sms-cls], [data-sms-sid]');
      if (!b || b.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (b.hasAttribute('data-sms-cls')) {
        var wk = b.getAttribute('data-sms-week') || '';
        open({ classes: [b.getAttribute('data-sms-cls')], week: wk, from: wk ? 'send' : 'today' });
        return;
      }
      var holder = b.closest('[data-id]');
      var sid = b.getAttribute('data-sms-sid') || (holder && holder.dataset.id) || '';
      var s = (UI.getStudents ? UI.getStudents() : active()).find(function (x) { return x.id === sid; });
      if (!s) return;
      if (s.archived) { toast('퇴원한 학생에게는 문자를 보낼 수 없습니다', 'bad'); return; }
      open({ students: [sid], from: b.closest('#panel-roster') ? 'roster' : 'today' });
    }, true);

    var set = $('#smsSettings');
    if (set) {
      $('#tdSettingsBtn').addEventListener('click', loadSettings);
      set.addEventListener('click', function (e) { if (e.target.id === 'smsSaveCfg') saveSettings(); });
    }
  }
  init();

  window.Sms = { open: open, openLog: openLog, build: build, bytes: bytes, kdate: kdate, state: function () { return st; } };
})();
