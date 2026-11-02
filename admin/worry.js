/* ============================================================
   worry.js — 걱정 문자 (공통 창) · 과제 칸 상담 기록 (20261101r · migration-061)

   Worry.open({ items: [{ sid, cls, reasons: [{ kind, date, text, dates }], checks: [...] }], from: 'care' | 'hw', hwDay })
     「오늘」 챙길 학생 줄 [문자] · 반 이름 줄 「n명에게 각각 문자」 · 과제 칸 메뉴 [걱정 문자 보내기]
     받는 사람 [학생] [학부모] [둘 다] — 기본: 결석 반복이면 학부모, 과제 · 복습테스트 · 보강 영상 · 자료면 학생
     내용 칸 — 사유(숫자 · 날짜)로 만든 기본 문구가 바로 들어가고, text-polish 'revise' 로 말투 원칙대로 다듬은 3~4줄로 바뀐다
       (손으로 고친 뒤에는 바꾸지 않는다) · 「AI에게 부탁하기」(예: 더 부드럽게)
       Claude 에는 {학생이름} 자리표시가 든 글만 간다 (이름 · 번호 · 상담 내용은 보내지 않는다)
     상담 카드의 상담 내용 · 약속은 문자에 넣지 않는다 — 사유 숫자 · 날짜만
     [보내기] — 학생 1명이면 확인 창 없이 바로 (여러 명이면 확인 창 한 번) · sms-send 목적 worry
       { } 칸이 남은 글은 보내지 않는다 · 오늘 이미 걱정 문자를 보낸 학생은 「오늘 이미 보냄」 표시
       보낸 뒤 그 사유를 「확인함」 · 상담 카드에 「걱정 문자 보냄 · 사유 · 받는 사람 · 날짜」
   Worry.hasHwNote(sid, day) · Worry.saveHwNote(sid, day, head, text) — 과제 칸 「상담 기록 남기기」(분류 「과제」 · hw_day)
   ============================================================ */

(function () {
  'use strict';

  function sb() { return SB.client; }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function today() { return window.DDay ? DDay.today() : Store.toISO(new Date()); }
  var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function mdw(iso) { return md(iso) + '(' + DOWK[Lesson.dowOf(iso)] + ')'; }
  function stu(id) { return (Store.getStudents() || []).find(function (s) { return s.id === id; }) || null; }
  function leftOf(text) { var out = []; (String(text || '').match(/#?\{[^{}\r\n]{1,20}\}/g) || []).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); }); return out; }
  function mobile(d) { return /^01[016789]\d{7,8}$/.test(d); }
  function digits(v) { return Store.phoneDigits ? Store.phoneDigits(v || '') : String(v || '').replace(/\D/g, ''); }

  /* ---------- 말투 원칙 — AI 지시 · 기본 문구 모두 ---------- */
  var BANNED = /꼭|반드시|무조건|말씀\s*부탁|알려\s*주세요|알려\s*주시|연락\s*부탁|답장|왜\s|이유가\s*뭐|혼나|실망/;
  var TONE = {
    parent: '학부모에게 보내는 3~4줄 문자로 다듬어 줘. 걱정돼서 연락드렸다는 정도로 부드럽게. 끝은 「혹시 저희가 도울 일이 있으면 편하게 말씀 주세요」 정도로만 열어 두고, 답장이나 사유 설명을 요구하는 말(말씀 부탁드립니다, 알려 주세요)은 쓰지 마. 「꼭」「반드시」「무조건」은 쓰지 마. 숫자 · 날짜 · {학생이름}은 그대로 두고 새 사실은 넣지 마.',
    student: '학생에게 보내는 3~4줄 문자로 다듬어 줘. 「걱정돼서 연락했어요」로 시작하는 느낌으로, 이번 주에 해 볼 작은 행동 하나만 가볍게 권해. 이유를 묻거나 캐묻거나 혼내는 말은 쓰지 마. 「꼭」「반드시」「무조건」은 쓰지 마. 숫자 · 날짜 · {학생이름}은 그대로 두고 새 사실은 넣지 마.'
  };
  var TONE_SHORT = {
    parent: '부드럽게 · 답장이나 사유 설명 요구 금지 · 꼭 · 반드시 · 무조건 금지 · 숫자 · 날짜 · {학생이름} 그대로',
    student: '걱정돼서 연락했어요 · 작은 행동 하나 · 이유 묻기 · 혼내기 금지 · 꼭 · 반드시 · 무조건 금지 · 숫자 · 날짜 · {학생이름} 그대로'
  };

  /* 사유 → 문장 조각 (학생 · 학부모) — 사유 숫자 · 날짜만 쓴다 */
  var ORDER = ['absent', 'hw', 'review', 'makeup', 'material'];
  var KIND_NAME = { absent: '결석 반복', hw: '과제 밀림', review: '복습테스트 미응시', makeup: '보강 영상 미시청', material: '자료 미배부' };
  function primary(reasons) {
    return reasons.slice().sort(function (a, b) { return ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); })[0] || { kind: 'hw' };
  }
  function absentNums(r) {
    var m = /(\d+)\s*번 중 결석\s*(\d+)\s*번/.exec(r.text || '');
    return m ? { all: m[1], abs: m[2] } : null;
  }
  function datesOf(r) { return r.dates || (r.date ? mdw(r.date) : ''); }
  function phrase(aud, r) {
    var d = datesOf(r), n = r.kind === 'absent' ? absentNums(r) : null;
    if (aud === 'parent') {
      if (r.kind === 'absent') return n ? '최근 수업 ' + n.all + '번 중 ' + n.abs + '번 결석해' : '최근 수업에 자주 결석해';
      if (r.kind === 'review') return (d ? d + ' ' : '') + '복습테스트를 아직 보지 못해';
      if (r.kind === 'makeup') return (d ? d + ' ' : '') + '수업에 결석한 뒤 보강 영상을 아직 보지 못해';
      if (r.kind === 'material') return '결석한 ' + (d ? d + ' ' : '') + '수업 자료를 아직 받지 못해';
      return '이번 주 과제가 조금 밀려' + (d ? '(' + d + ')' : '');
    }
    if (r.kind === 'absent') return n ? '최근 수업 ' + n.all + '번 중 ' + n.abs + '번 결석해서' : '최근 수업에 자주 결석해서';
    if (r.kind === 'review') return (d ? d + ' ' : '') + '복습테스트를 아직 못 본 것 같아';
    if (r.kind === 'makeup') return (d ? d + ' ' : '') + '보강 영상을 아직 못 본 것 같아';
    if (r.kind === 'material') return (d ? d + ' ' : '') + '수업 자료를 아직 못 받은 것 같아';
    return '이번 주 과제가 조금 밀린 것 같아' + (d ? '(' + d + ')' : '');
  }
  var ACT = {
    student: { absent: '이번 주는 보강 영상 하나만 먼저 봐 봐요.', hw: '이번 주는 하루 하나씩만 먼저 해 봐요.', review: '이번 주에 10분만 내서 먼저 풀어 봐요.',
               makeup: '이번 주에 영상 하나만 먼저 봐 봐요.', material: '다음 수업 때 자료부터 같이 챙겨요.' },
    parent: { absent: '놓친 수업은 보강 영상으로 따라올 수 있도록 챙기겠습니다.', hw: '수업에서 밀린 과제를 하나씩 따라잡을 수 있도록 챙기겠습니다.',
              review: '수업에서 한 번 더 챙기겠습니다.', makeup: '놓친 수업은 보강 영상으로 따라올 수 있도록 챙기겠습니다.', material: '다음 수업 때 자료를 챙겨 드리겠습니다.' }
  };
  function baseDraft(aud, reasons) {
    var r = primary(reasons);
    if (aud === 'parent') return '안녕하세요, 마라톤국어입니다. {학생이름} 학생이 ' + phrase('parent', r) + ' 걱정되는 마음에 연락드렸습니다. ' + ACT.parent[r.kind] + ' 혹시 저희가 도울 일이 있으면 편하게 말씀 주세요.';
    return '[마라톤국어] {학생이름} 학생, ' + phrase('student', r) + ' 걱정돼서 연락했어요. ' + ACT.student[r.kind] + ' 수업에서 만나요!';
  }
  /* 「10/29(목) 과제 미제출 · 최근 4번 중 결석 2번」 — 상담 카드 기록 · 창 맨 위 */
  function reasonText(reasons) {
    return reasons.map(function (r) {
      if (r.kind === 'absent') { var n = absentNums(r); return n ? '최근 ' + n.all + '번 중 결석 ' + n.abs + '번' : '결석 반복'; }
      var d = datesOf(r);
      if (r.kind === 'hw') return (d ? d + ' ' : '') + '과제 ' + (r.label || '미제출');
      return (d ? d + ' ' : '') + { review: '복습테스트 안 냄', makeup: '결석 → 보강 영상 안 봄', material: '결석 → 자료 안 받음' }[r.kind];
    }).join(' · ');
  }
  function defaultTo(reasons) { return reasons.some(function (r) { return r.kind === 'absent'; }) ? 'parent' : 'student'; }

  /* ---------- 받는 사람 한 줄씩 (20261102a) ----------
     예전 [학생] [학부모] [둘 다] — 「학부모」는 학부모1 · 2 번호 모두에 갔다 (둘 다 = 학생 + 학부모1 + 학부모2)
     이제 실제 받는 사람을 체크로: ☑ 학생 · 최지민 · 1234 / ☐ 학부모1 · 어머니 · 5678 / ☐ 학부모2 · 9012
     번호는 뒤 4자리만 · 관계 이름(students.parent_title)은 저장돼 있을 때만 학부모1 줄에 · 번호 없으면 흐리게 「번호 없음」(못 고름)
     학부모2 번호가 학부모1과 같으면 「학부모1과 같은 번호」(못 고름 · 한 번만 간다) */
  var WHO = { student: '학생', parent1: '학부모1', parent2: '학부모2' };
  function people(s) {
    s = s || {};
    var d0 = digits(s.studentPhone || s.student_phone), d1 = digits(s.parentPhone || s.parent_phone), d2 = digits(s.parentPhone2 || s.parent_phone2);
    var rel = String(s.parentTitle || s.parent_title || '').trim();
    var row = function (t, d, extra) {
      var ok = mobile(d), same = t === 'parent2' && ok && d === d1 && mobile(d1);
      return { t: t, who: WHO[t], extra: extra || '', d: ok ? d : '', last4: ok ? d.slice(-4) : '', ok: ok && !same, same: same };
    };
    return [row('student', d0, s.name || ''), row('parent1', d1, rel), row('parent2', d2, '')];
  }
  /* 기본 체크 — 한 명만: 결석 반복이면 학부모1, 그 밖(과제 · 복습테스트 · 보강 영상 · 자료)은 학생 · 그 번호가 없으면 다음 사람 */
  function defaultPick(s, reasons) {
    var order = defaultTo(reasons) === 'parent' ? ['parent1', 'parent2', 'student'] : ['student', 'parent1', 'parent2'];
    var ps = people(s), pick = {};
    var first = order.filter(function (t) { return ps.some(function (p) { return p.t === t && p.ok; }); })[0];
    if (first) pick[first] = true;
    return pick;
  }
  function picked(it) { return ['student', 'parent1', 'parent2'].filter(function (t) { return it.pick && it.pick[t]; }); }
  /* 고른 사람으로 정해지는 글 — 학생을 고르면 학생용, 학부모(1 · 2)를 고르면 학부모용, 같이 고르면 둘 (탭) */
  function auds(it) {
    var p = picked(it), o = [];
    if (p.indexOf('student') !== -1) o.push('student');
    if (p.indexOf('parent1') !== -1 || p.indexOf('parent2') !== -1) o.push('parent');
    return o;
  }
  function whoText(list) { return list.map(function (t) { return WHO[t]; }).join(' · '); }
  /* [보내기] 글 — 「최지민 학부모1에게 보내기」 · 「최지민 학생 · 학부모1에게 보내기」 */
  function sendWord(s, it) {
    var p = picked(it);
    return p.length ? (s && s.name ? s.name + ' ' : '') + whoText(p) + '에게 보내기' : '받는 사람을 골라 주세요';
  }

  /* ---------- 상태 ---------- */
  var st = { items: [], i: 0, from: '', busy: false, sent: null, done: {} };
  function cur() { return st.items[st.i]; }
  function prep(it) {
    it.pick = it.pick || defaultPick(stu(it.sid), it.reasons);
    it.text = it.text || { student: baseDraft('student', it.reasons), parent: baseDraft('parent', it.reasons) };
    it.base = it.base || { student: it.text.student, parent: it.text.parent };
    it.touched = it.touched || {};
    it.ai = it.ai || {};
    return it;
  }

  /* ---------- AI (text-polish revise · 기존 함수 · 새 키 없음) ---------- */
  function polish(text, request) {
    var fns = SB.client && SB.client.functions;
    if (!fns || !fns.invoke) return Promise.resolve(null);
    return Promise.resolve(fns.invoke('text-polish', { body: { action: 'revise', kind: 'sms', text: text, request: request.slice(0, 300) } })).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      return ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null;
    }).catch(function () { return null; });
  }
  function okAi(res, base) {
    if (!res || !res.ok || typeof res.text !== 'string' || !res.text.trim()) return '';
    var t = res.text.trim();
    if (BANNED.test(t)) return '';                                    /* 말투 원칙을 어긴 글은 쓰지 않는다 — 기본 문구 그대로 */
    if (base.indexOf('{학생이름}') !== -1 && t.indexOf('{학생이름}') === -1) return '';
    return t;
  }
  function autoDraft(it) {
    auds(it).forEach(function (a) {
      if (it.ai[a] || it.touched[a]) return;
      it.ai[a] = 'busy';
      paint();
      polish(it.base[a], TONE[a]).then(function (res) {
        var t = okAi(res, it.base[a]);
        it.ai[a] = t ? 'ok' : 'fail';
        if (t && !it.touched[a]) it.text[a] = t;
        paint();
      });
    });
  }
  function askAi() {
    var it = cur(), inp = $('#wyAsk'), req = inp ? inp.value.replace(/\s+/g, ' ').trim() : '';
    if (!it || req.length < 2) return;
    var list = auds(it);
    if (list.length > 1 && it.tab) list = [it.tab];                     /* 탭 두 개면 보고 있는 글만 */
    if (!list.length) return;
    it.asking = true; paint();
    Promise.all(list.map(function (a) {
      return polish(it.text[a], req + ' (지킬 것: ' + TONE_SHORT[a] + ')').then(function (res) {
        var t = okAi(res, it.text[a]);
        if (t) { it.undo = it.undo || {}; it.undo[a] = it.text[a]; it.text[a] = t; it.touched[a] = true; }
        return !!t;
      });
    })).then(function (oks) {
      it.asking = false;
      it.askMsg = oks.some(Boolean) ? 'AI가 고친 글을 넣었습니다. 날짜 · 숫자를 한 번 더 확인해 주세요.' : '지금은 AI가 고칠 수 없습니다. 잠시 뒤 다시 눌러 주세요.';
      if (oks.some(Boolean) && inp) inp.value = '';
      paint();
    });
  }

  /* ---------- 받는 번호 ---------- */
  /* 고른 사람 중 번호가 있는 사람만 (같은 번호는 한 번) */
  function targets(s, it) {
    var out = [], seen = {};
    people(s).forEach(function (p) { if (it.pick && it.pick[p.t] && p.ok && !seen[p.d]) { seen[p.d] = 1; out.push({ t: p.t, d: p.d }); } });
    return out;
  }
  function fillName(text, s) { return String(text || '').split('{학생이름}').join(s.name || ''); }

  /* ---------- 그리기 ---------- */
  function $(q) { return document.querySelector(q); }
  function modal() {
    var m = document.getElementById('wyModal');
    if (m) return m;
    m = document.createElement('dialog');
    m.className = 'modal wy-modal';
    m.id = 'wyModal';
    m.setAttribute('aria-labelledby', 'wyTitle');
    m.innerHTML = '<div class="modal__head wy-head"><h2 class="modal__title" id="wyTitle">걱정 문자</h2><button class="btn btn--sm" type="button" id="wyClose">닫기</button></div>' +
      '<div class="modal__body wy-body" id="wyBody"></div>';
    document.body.appendChild(m);
    return m;
  }
  function sentWho(sid) {
    if (!st.sent) return [];
    var o = [];
    st.sent.forEach(function (x) { if (x.student_id === sid) { var w = WHO[x.target] || '학부모'; if (o.indexOf(w) === -1) o.push(w); } });
    return o;
  }
  function bodyHtml() {
    var it = cur();
    if (!it) return '';
    var s = stu(it.sid) || { name: '학생' }, n = st.items.length;
    var h = '';
    if (n > 1) h += '<p class="wy-step num">' + (st.i + 1) + ' / ' + n + '명</p>';
    h += '<div class="wy-who"><b>' + esc(s.name) + '</b><span class="muted-note">' + esc(it.cls || s.className || '') + '</span>' +
      (st.done[it.sid] ? '<span class="wy-ok">보냄 ✓</span>' : '') + '</div>';
    h += '<p class="wy-why">사유: ' + esc(reasonText(it.reasons)) + '</p>';
    var already = sentWho(it.sid);
    if (already.length) h += '<p class="wy-dup" role="status">오늘 이미 걱정 문자 보냄 (' + esc(already.join(' · ')) + ')</p>';
    h += '<fieldset class="wy-to" aria-label="받는 사람"><legend class="wy-lab">받는 사람</legend>' + people(s).map(function (p) {
      var on = !!(it.pick && it.pick[p.t]) && p.ok;
      return '<label class="wy-to__r' + (on ? ' is-on' : '') + (p.ok ? '' : ' is-off') + '">' +
        '<input type="checkbox" data-wy-pick="' + p.t + '"' + (on ? ' checked' : '') + (p.ok ? '' : ' disabled') + '>' +
        '<span class="wy-to__w">' + p.who + '</span>' + (p.extra ? '<span class="wy-to__x"> · ' + esc(p.extra) + '</span>' : '') +
        '<span class="wy-to__d num">' + (p.same ? ' · 학부모1과 같은 번호' : p.ok ? ' · ' + p.last4 : ' · 번호 없음') + '</span></label>';
    }).join('') + '</fieldset>';
    var tg = targets(s, it), as = auds(it);
    if (!picked(it).length) h += '<p class="wy-warn" role="alert">받는 사람을 한 명 이상 골라 주세요</p>';
    else if (!tg.length) h += '<p class="wy-warn" role="alert">고른 사람의 휴대폰 번호가 없습니다</p>';
    /* 학생 + 학부모를 같이 고르면 「학생용」「학부모용」 탭 두 개 — 각각 고친다 */
    if (as.length > 1) {
      if (as.indexOf(it.tab) === -1) it.tab = as[0];
      h += '<div class="wy-tabs" role="tablist" aria-label="초안">' + as.map(function (a) {
        return '<button type="button" role="tab" class="wy-tab' + (it.tab === a ? ' is-on' : '') + '" data-wy-tab="' + a + '" aria-selected="' + (it.tab === a) + '">' + (a === 'student' ? '학생용' : '학부모용') + '</button>';
      }).join('') + '</div>';
    }
    (as.length > 1 ? [it.tab] : as).forEach(function (a) {
      var t = it.text[a], lf = leftOf(fillName(t, s));
      h += '<label class="wy-field"><span class="wy-lab">' + (a === 'student' ? '학생에게' : '학부모에게') +
        (it.ai[a] === 'busy' ? ' <small class="wy-ai">AI 초안 쓰는 중…</small>' : it.ai[a] === 'ok' && !it.touched[a] ? ' <small class="wy-ai">AI 초안</small>' : '') + '</span>' +
        '<textarea class="textarea wy-text" id="wyText-' + a + '" data-wy-text="' + a + '" rows="5" maxlength="1000">' + esc(t) + '</textarea>' +
        (lf.length ? '<small class="wy-left" role="alert">바뀌지 않은 칸이 있어 보내지 않음: ' + esc(lf.join(' ')) + '</small>' : '') + '</label>';
    });
    h += '<div class="wy-ask"><input class="input" id="wyAsk" type="text" maxlength="200" placeholder="AI에게 부탁하기 (예: 더 부드럽게)" aria-label="AI에게 부탁하기">' +
      '<button type="button" class="btn btn--sm" id="wyAskGo"' + (it.asking ? ' disabled' : '') + '>' + (it.asking ? '고치는 중…' : '부탁하기') + '</button></div>' +
      (it.askMsg ? '<p class="wy-askmsg">' + esc(it.askMsg) + '</p>' : '');
    h += '<p class="wy-note">상담 내용 · 약속은 문자에 넣지 않습니다. 보내면 이 사유는 「확인함」이 되고 상담 카드에 「걱정 문자 보냄」이 남습니다.</p>';
    h += '<div class="wy-acts">' +
      (n > 1 ? '<button type="button" class="btn" id="wyPrev"' + (st.i === 0 ? ' disabled' : '') + '>이전</button><button type="button" class="btn" id="wyNext"' + (st.i === n - 1 ? ' disabled' : '') + '>다음</button>' : '') +
      '<button type="button" class="btn btn--primary" id="wySend"' + (st.busy || (n === 1 && !tg.length) ? ' disabled' : '') + '>' + (st.busy ? '보내는 중…' : n > 1 ? sendable().length + '명에게 보내기' : sendWord(s, it)) + '</button></div>';
    return h;
  }
  function paint() {
    var b = document.getElementById('wyBody');
    if (!b) return;
    var f = document.activeElement, fid = f && b.contains(f) ? f.id : '', pos = fid && f.selectionStart != null ? f.selectionStart : null;
    var ask = $('#wyAsk') ? $('#wyAsk').value : '';
    b.innerHTML = bodyHtml();
    if ($('#wyAsk')) $('#wyAsk').value = ask;
    if (fid && document.getElementById(fid)) { var g = document.getElementById(fid); try { g.focus({ preventScroll: true }); } catch (e) { g.focus(); } if (pos != null && g.setSelectionRange) try { g.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function sendable() { return st.items.filter(function (it) { return !st.done[it.sid]; }); }

  /* ---------- 열기 ---------- */
  function open(o) {
    o = o || {};
    st.items = (o.items || []).filter(function (x) { return x && x.sid; }).map(function (x) { return prep(Object.assign({}, x, { reasons: (x.reasons || []).slice() })); });
    if (!st.items.length) return;
    st.i = 0; st.from = o.from || ''; st.busy = false; st.done = {}; st.sent = null;
    var m = modal();
    document.getElementById('wyTitle').textContent = st.items.length > 1 ? '걱정 문자 · ' + st.items.length + '명 각각' : '걱정 문자';
    paint();
    if (!m.open) { if (m.showModal) m.showModal(); else m.setAttribute('open', ''); }
    autoDraft(cur());
    if (window.Welcome && Welcome.sentToday) Promise.resolve(Welcome.sentToday('worry')).then(function (l) { st.sent = l || []; paint(); });
  }
  function go(i) { st.i = Math.max(0, Math.min(st.items.length - 1, i)); paint(); autoDraft(cur()); }

  /* ---------- 보내기 ---------- */
  function invoke(body) {
    var fns = sb() && sb().functions;
    if (!fns || !fns.invoke) return Promise.resolve({ ok: false, message: '문자 함수(sms-send)를 부를 수 없습니다.' });
    return Promise.resolve(fns.invoke('sms-send', { body: body })).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      return ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }).then(function (j) { return j || { ok: false, message: '문자 함수(sms-send)를 부르지 못했습니다.' }; })
        : { ok: false, message: '문자 함수(sms-send)를 부르지 못했습니다 — ' + (r.error.message || '') };
    }).catch(function (e) { return { ok: false, message: (e && e.message) || '보내지 못했습니다' }; });
  }
  /* 한 학생 — 받는 사람마다 그 글로 (이름은 여기서 채운다 · 다른 칸은 함수가 채운다) */
  function sendOne(it) {
    var s = stu(it.sid);
    if (!s) return Promise.resolve({ ok: false, sid: it.sid, msg: '학생을 찾지 못했습니다' });
    var tg = targets(s, it);
    if (!tg.length) return Promise.resolve({ ok: false, sid: it.sid, name: s.name, msg: picked(it).length ? whoText(picked(it)) + ' 번호 없음' : '받는 사람을 고르지 않았습니다' });
    var jobs = [];
    auds(it).forEach(function (a) {
      var mine = tg.filter(function (x) { return a === 'student' ? x.t === 'student' : x.t !== 'student'; });
      if (!mine.length) return;
      var body = fillName(it.text[a], s).trim(), lf = leftOf(body);
      if (!body) { jobs.push(Promise.resolve({ ok: false, msg: '내용이 비었습니다' })); return; }
      if (lf.length) { jobs.push(Promise.resolve({ ok: false, msg: '바뀌지 않은 칸이 있어 보내지 않음: ' + lf.join(' ') })); return; }
      jobs.push(invoke({ action: 'send', items: mine.map(function (x) { return { student_id: s.id, to: x.t }; }), body: body, ad: false, lessons: {}, siblings: true,
        markWeek: '', label: '걱정 문자', purpose: 'worry', vars: {} }).then(function (r) {
        var oks = r && r.ok ? (r.results || []).filter(function (x) { return x.ok; }) : [];
        var good = r && r.ok && (oks.length || (!r.results && r.sent));
        /* 실제로 받은 사람 — 결과에 받는 곳(to)이 있으면 그대로, 없으면 보낸 줄 그대로 */
        var gotT = !good ? [] : r.results ? oks.map(function (x) { return x.to; }) : mine.map(function (x) { return x.t; });
        return { ok: !!good, aud: a, got: gotT, msg: good ? '' : (r && (r.message || ((r.results || []).filter(function (x) { return !x.ok; })[0] || {}).error)) || '보내지 못했습니다' };
      }));
    });
    return Promise.all(jobs).then(function (rs) {
      var okAud = rs.filter(function (x) { return x.ok; }).map(function (x) { return x.aud; });
      var got = [];
      rs.forEach(function (x) { (x.got || []).forEach(function (t) { if (WHO[t] && got.indexOf(t) === -1) got.push(t); }); });
      got.sort(function (a, b) { return ['student', 'parent1', 'parent2'].indexOf(a) - ['student', 'parent1', 'parent2'].indexOf(b); });
      var bad = rs.filter(function (x) { return !x.ok; });
      return { ok: okAud.length > 0, sid: it.sid, name: s.name, auds: okAud, got: got, msg: bad.map(function (x) { return x.msg; }).join(' · ') };
    });
  }
  function record(it, res) {
    /* 상담 카드 기록 — 실제로 받은 사람 (학생 / 학부모1 / 학부모2 · 20261102a) */
    var who = res.got && res.got.length ? whoText(res.got) : res.auds.length > 1 ? '학생 · 학부모' : res.auds[0] === 'parent' ? '학부모' : '학생';
    var row = { student_id: it.sid, note_date: today(), categories: ['걱정 문자'], follow_up: false,
      body: '걱정 문자 보냄 · ' + reasonText(it.reasons) + ' · ' + who + ' · ' + md(today()) };
    if (it.hwDay) row.hw_day = it.hwDay;
    var p1 = Promise.resolve(sb().from('student_notes').insert(row)).then(function (r) {
      if (r && r.error && row.hw_day && /hw_day|schema cache/i.test(r.error.message || '')) { delete row.hw_day; return sb().from('student_notes').insert(row); }
      return r;
    }).then(function (r) {
      if (r && r.error) toast('상담 카드 기록을 남기지 못했습니다 — ' + (/student_notes_cat_check/.test(r.error.message || '') ? 'migration-061 SQL 을 먼저 실행해 주세요' : r.error.message), 'bad');
      else { if (it.hwDay) addHwNote(it.sid, it.hwDay); if (window.Card && Card.notesChanged) Card.notesChanged(it.sid); if (window.QuickNote && QuickNote.changed) QuickNote.changed(it.sid); }
    });
    var p2 = it.checks && it.checks.length && window.Skips && Skips.checkMany ? Promise.resolve(Skips.checkMany(it.checks, '')) : Promise.resolve();
    return Promise.all([p1, p2]);
  }
  function send() {
    if (st.busy) return;
    var list = st.items.length > 1 ? sendable() : st.items.filter(function (it) { return !st.done[it.sid]; });
    if (!list.length) { toast('보낼 학생이 없습니다', 'bad'); return; }
    var go2 = function () {
      st.busy = true; paint();
      var results = [];
      list.reduce(function (p, it) {
        return p.then(function () { return sendOne(it).then(function (res) { results.push(res); if (res.ok) { st.done[it.sid] = 1; return record(it, res); } }); });
      }, Promise.resolve()).then(function () {
        st.busy = false;
        window.dispatchEvent(new CustomEvent('jt:welcome-sent', { detail: { kind: 'worry' } }));
        window.dispatchEvent(new CustomEvent('jt:worry-sent', { detail: { ids: results.filter(function (r) { return r.ok; }).map(function (r) { return r.sid; }) } }));
        var ok = results.filter(function (r) { return r.ok; }), bad = results.filter(function (r) { return !r.ok; });
        if (ok.length && !bad.length) {
          toast((ok.length === 1 ? ok[0].name + ' ' : ok.length + '명에게 ') + '걱정 문자를 보냈습니다 · 확인함 · 상담 카드에 기록', 'good');
          var m = modal(); if (m.open && m.close) m.close();
          return;
        }
        if (ok.length) toast(ok.length + '명 보냄 · ' + bad.length + '명 못 보냄 — ' + bad.map(function (r) { return (r.name || '') + ': ' + r.msg; }).join(' / '), 'warn');
        else toast('보내지 못했습니다 — ' + bad.map(function (r) { return (r.name ? r.name + ': ' : '') + r.msg; }).join(' / '), 'bad');
        var firstBad = st.items.findIndex(function (it) { return !st.done[it.sid]; });
        if (firstBad >= 0) st.i = firstBad;
        paint();
      });
    };
    if (list.length === 1) { go2(); return; }
    UI.confirmAsk('걱정 문자 ' + list.length + '명', list.map(function (it) { var s = stu(it.sid) || {}; return '· ' + (s.name || '') + ' — ' + (whoText(picked(it)) || '받는 사람 없음'); }).join('\n') + '\n\n학생마다 고친 글 그대로 보냅니다.', '보내기').then(function (yes) { if (yes) go2(); });
  }

  /* ---------- 과제 칸 상담 기록 (분류 「과제」 · hw_day) ---------- */
  var hw = { by: {}, loaded: false, sql: true };
  function hwKey(sid, day) { return sid + '|' + day; }
  function addHwNote(sid, day) { hw.by[hwKey(sid, day)] = (hw.by[hwKey(sid, day)] || 0) + 1; window.dispatchEvent(new CustomEvent('jt:hwnote')); }
  function loadHw() {
    if (!window.SB || !SB.client) return Promise.resolve();
    /* 칸 이름을 적지 않고(*) 받는다 — migration-061 전에도 오류 없이 (hw_day 가 없으면 점 없음) */
    return Promise.resolve(sb().from('student_notes').select('*').is('deleted_at', null).gte('note_date', Lesson.addDays(today(), -150))).then(function (r) {
      if (r.error) return;
      hw.by = {};
      (r.data || []).forEach(function (x) { if (!x.hw_day) return; var k = hwKey(x.student_id, String(x.hw_day).slice(0, 10)); hw.by[k] = (hw.by[k] || 0) + 1; });
      hw.loaded = true;
      window.dispatchEvent(new CustomEvent('jt:hwnote'));
    }, function () {});
  }
  function hasHwNote(sid, day) { return !!hw.by[hwKey(sid, day)]; }
  function saveHwNote(sid, day, head, text) {
    var body = String(text || '').trim();
    if (!body) return Promise.resolve({ ok: false, message: '내용을 적어 주세요' });
    var row = { student_id: sid, note_date: today(), categories: ['과제'], body: head + ' — ' + body.slice(0, 1900), follow_up: false, hw_day: day };
    return Promise.resolve(sb().from('student_notes').insert(row)).then(function (r) {
      if (r.error) {
        var m = r.error.message || '';
        return { ok: false, message: /hw_day|student_notes_cat_check|schema cache/i.test(m) ? 'migration-061 SQL 을 먼저 실행해 주세요 (분류 「과제」 · 과제 칸 날짜)' : '저장하지 못했습니다 — ' + m };
      }
      addHwNote(sid, day);
      if (window.Card && Card.notesChanged) Card.notesChanged(sid);
      if (window.QuickNote && QuickNote.changed) QuickNote.changed(sid);
      return { ok: true };
    }, function (e) { return { ok: false, message: (e && e.message) || '저장하지 못했습니다' }; });
  }
  window.addEventListener('jt:loaded', function () { loadHw(); });
  window.addEventListener('jt:remote', function (e) { var t = e.detail && e.detail.table; if ((t === 'student_notes' || t === '*') && !(e.detail && e.detail.local)) loadHw(); });

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var m = document.getElementById('wyModal');
    if (!m || !m.contains(e.target)) return;
    var t = e.target, b;
    if (t.id === 'wyClose') { if (m.close) m.close(); else m.removeAttribute('open'); return; }
    if ((b = t.closest('[data-wy-tab]'))) { cur().tab = b.dataset.wyTab; paint(); return; }
    if (t.id === 'wyAskGo') { askAi(); return; }
    if (t.id === 'wyPrev') { go(st.i - 1); return; }
    if (t.id === 'wyNext') { go(st.i + 1); return; }
    if (t.id === 'wySend') send();
  });
  /* 받는 사람 체크 — 고른 사람에 맞춰 글(학생용 · 학부모용)이 바뀐다 */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.dataset || !t.dataset.wyPick) return;
    var it = cur(); if (!it) return;
    it.pick = it.pick || {};
    if (t.checked) it.pick[t.dataset.wyPick] = true; else delete it.pick[t.dataset.wyPick];
    var as = auds(it);
    if (t.checked) it.tab = t.dataset.wyPick === 'student' ? 'student' : 'parent';
    if (as.indexOf(it.tab) === -1) it.tab = as[0];
    paint(); autoDraft(it);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.dataset || !t.dataset.wyText) return;
    var it = cur(); if (!it) return;
    it.text[t.dataset.wyText] = t.value; it.touched[t.dataset.wyText] = true;
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'wyAsk' && e.key === 'Enter') { e.preventDefault(); askAi(); }
  });

  window.Worry = {
    open: open, baseDraft: baseDraft, defaultTo: defaultTo, defaultPick: defaultPick, people: people, reasonText: reasonText, TONE: TONE, BANNED: BANNED,
    hasHwNote: hasHwNote, saveHwNote: saveHwNote, loadHw: loadHw,
    state: function () { return st; }
  };
})();
