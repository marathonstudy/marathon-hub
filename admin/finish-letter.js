/* ============================================================
   finish-letter.js — 완주증 「반 전체에 같은 편지 넣기」 글 바꾸기 (20261114i · 화면 없음 · finish-admin.js 가 씀)
   FinLetter.parts(name)        → { full, given, b(받침 여부), one(외자 · 외국 이름 — 부를 때 성까지) }
   FinLetter.toTpl(text, name, extra) → { tpl, n } — 글 안의 그 학생 이름(성 포함 · 성 뺀 이름)을 {성이름} · {이름} 으로
        extra = [{ s: '준', role: 'given' | 'full' }] — 직원이 글에서 「여기가 이름」으로 고른 곳
        직원이 직접 쓴 {이름} · {성이름} 은 그대로 둔다
   FinLetter.fill(tpl, name)    → 그 학생 이름으로 채운 글 · 부르는 말 아/야 · 조사(이/가 · 은/는 · 을/를 · 와/과 · 이랑/랑 · 이에요/예요)를 받침에 맞게
        {이름}: 친근하게 — 받침 있으면 「서준이는 · 서준이가 · 서준아」 · 없으면 「준후는 · 준후가 · 준후야」 · 외자 · 외국 이름은 성까지(「김준아 · 김준이는」)
        {성이름}: 「이서준은 · 이서준이 · 엄준후는 · 엄준후가」
   FinLetter.fillParts(tpl, name) → [{ t, nm }] — 미리보기에서 바뀐 이름에 색
   ============================================================ */
(function (global) {
  'use strict';
  var SUR2 = ['남궁', '제갈', '선우', '황보', '독고', '사공', '서문', '동방', '망절', '어금'];
  /* 흔한 한 글자 성 — 외국 이름 첫 글자와 겹치기 쉬운 제 · 마 · 사 · 에 등은 뺌 */
  var SUR1 = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설길연위표명기반왕금옥육인맹모탁국은편용예경봉';
  function hangul(ch) { var c = ch.charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3; }
  /* 받침 — 한글은 종성 · 영어는 끝 글자가 모음(a e i o u y w)이 아니면 받침 · 숫자는 읽는 소리 */
  function batchim(word) {
    var w = String(word || '').replace(/[\s)\]」』'"]+$/, ''), ch = w.slice(-1);
    if (!ch) return false;
    if (hangul(ch)) return (ch.charCodeAt(0) - 0xAC00) % 28 !== 0;
    if (/[a-z]/i.test(ch)) return !/[aeiouyw]/i.test(ch);
    if (/[0-9]/.test(ch)) return '013678'.indexOf(ch) >= 0;                 /* 영 일 삼 육 칠 팔 */
    return false;
  }
  function parts(name) {
    var full = String(name || '').replace(/\s+/g, '').trim(), given = full, one = true;
    if (/^[가-힣]{2,5}$/.test(full)) {
      if (full.length >= 4 && SUR2.indexOf(full.slice(0, 2)) >= 0) { given = full.slice(2); one = given.length < 2; }
      else if (full.length >= 3 && SUR1.indexOf(full[0]) >= 0) { given = full.slice(1); one = false; }
      else if (full.length === 2 && SUR1.indexOf(full[0]) >= 0) { given = full.slice(1); one = true; }     /* 외자 「김준」 */
    }
    if (one) given = full;                                  /* 외자 · 외국 이름 — 부를 때 성까지 */
    return { full: full, given: given, b: batchim(one ? full : given), fb: batchim(full), one: one };
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var A = '', B = '';                           /* 바꾸는 동안 쓰는 표시(글에 없는 글자) */
  function toTpl(text, name, extra) {
    var p = parts(name), t = String(text || ''), n = 0;
    t = t.replace(/\{성이름\}/g, A + 'F' + B).replace(/\{이름\}/g, A + 'G' + B);
    var list = [];
    (extra || []).forEach(function (x) { if (x && x.s && String(x.s).trim()) list.push({ s: String(x.s).trim(), r: x.role === 'full' ? 'F' : 'G' }); });
    if (p.full) list.push({ s: p.full, r: p.one ? 'G' : 'F' });
    if (p.given && p.given !== p.full) list.push({ s: p.given, r: 'G' });
    list.sort(function (a, b) { return b.s.length - a.s.length; });             /* 긴 것 먼저(엄준후 → 준후) */
    list.forEach(function (x) {
      t = t.replace(new RegExp(escRe(x.s), 'g'), function () { n++; return A + x.r + B; });
    });
    t = t.replace(new RegExp(A + '([FG])' + B, 'g'), function (m, r) { return r === 'F' ? '{성이름}' : '{이름}'; });
    var own = (String(text || '').match(/\{(성이름|이름)\}/g) || []).length;
    return { tpl: t, n: n + own, found: n, own: own };
  }
  /* 자리표 뒤 — 부르는 말 · 친근한 「이」 · 조사 읽기 */
  var VOC = /^(아|야)(?![가-힣])/;
  var PAR = /^(이)?(에요|예요|랑|는|은|가|를|을|와|과)?/;
  function after(s) {
    var v = VOC.exec(s);
    if (v) return { len: v[0].length, voc: true };
    var m = PAR.exec(s) || ['', '', ''];
    var fam = m[2] || '', fri = !!m[1];
    /* 「이」 하나만 뒤에 한글이 바로 오면(이번 · 이제 …) 이름에 붙은 말이 아님 — 다만 이도 · 이의 · 이한테 · 이에게 · 이만 · 이처럼 · 이보다 · 이까지 · 이한 는 친근한 「이」 */
    if (fri && !fam && /^이[가-힣]/.test(s) && !/^이(도|의|한테|에게|만|처럼|보다|까지|랑|하고)/.test(s)) { fri = false; m = ['', '', '']; }
    var famK = { '에요': 'cop', '예요': 'cop', '랑': 'rang', '는': 'top', '은': 'top', '가': 'sub', '를': 'obj', '을': 'obj', '와': 'with', '과': 'with' }[fam] || '';
    if (fri && !fam) famK = 'fri';                          /* 「서준이 덕분에」 — 친근한 이름만 */
    return { len: (m[0] || '').length, voc: false, fam: famK, fri: fri };
  }
  var NB = { cop: '예요', rang: '랑', top: '는', sub: '가', obj: '를', with: '와' };
  var YB = { cop: '이에요', rang: '이랑', top: '은', sub: '이', obj: '을', with: '과' };
  function word(role, p, a) {
    if (role === 'G') {                                                      /* 친근하게 */
      if (a.voc) return p.given + (p.b ? '아' : '야');
      return p.given + (p.b ? '이' : '') + (a.fam && a.fam !== 'fri' ? NB[a.fam] : '');
    }
    /* 성이름 — 늘 바른 조사(이서준은 · 엄준후는) · 뒤에 「이」만 있으면 주어(「이서준이 1등」 → 「엄준후가 1등」) */
    if (a.voc) return p.full + (p.fb ? '아' : '야');
    var fam = a.fam === 'fri' ? 'sub' : a.fam;
    return p.full + (fam ? (p.fb ? YB : NB)[fam] : '');
  }
  function fillParts(tpl, name) {
    var p = parts(name), s = String(tpl || ''), out = [], re = /\{(성이름|이름)\}/g, i = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > i) out.push({ t: s.slice(i, m.index) });
      var rest = s.slice(re.lastIndex), a = after(rest);
      out.push({ t: word(m[1] === '성이름' ? 'F' : 'G', p, a), nm: true });
      re.lastIndex += a.len;
      i = re.lastIndex;
    }
    if (i < s.length) out.push({ t: s.slice(i) });
    return out;
  }
  function fill(tpl, name) { return fillParts(tpl, name).map(function (x) { return x.t; }).join('').slice(0, 3000); }
  global.FinLetter = { parts: parts, batchim: batchim, toTpl: toTpl, fill: fill, fillParts: fillParts };
})(typeof window !== 'undefined' ? window : globalThis);
