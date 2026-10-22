/* ============================================================
   tb.js — 교재의 뼈대 · 설정 · 일정

   하위 화면: 대시보드 / 지급 / 일정 / 재고·주문 / 청구·수납 / 환불 / 설정
   각 하위 화면은 tb-*.js 가 TB.register(이름, { show }) 로 붙인다.

   표 이름은 supabase/migration-002-textbook.sql 과 맞춘다.
   금액 합계는 SQL 함수가 계산한 값을 그대로 보여 준다(화면에서 다시 더하지 않는다).
   계좌번호는 저장소가 아니라 app_settings('textbook_bank') 에만 저장된다.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function sb() { return SB.client; }
  function check(r) {
    if (r && r.error) throw new Error(r.error.message);
    return r;
  }
  function toast(m, k) { UI.toast(m, k); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 돈 · 날짜 ---------- */

  function won(n) { return (Math.round(Number(n) || 0)).toLocaleString('ko-KR') + '원'; }
  function signedWon(n) { n = Math.round(Number(n) || 0); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'; }
  function toInt(v) {
    var n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  function today() { return Store.toISO(new Date()); }
  function monthOf(iso) { return String(iso || '').slice(0, 7) + '-01'; }
  function thisMonth() { return monthOf(today()); }
  function addMonths(m, k) {
    var d = Store.parseISO(monthOf(m)) || Store.parseISO(thisMonth());
    d.setMonth(d.getMonth() + k);
    return Store.toISO(d);
  }
  function monthLabel(m) {
    var x = /^(\d{4})-(\d{2})/.exec(m || '');
    return x ? x[1] + '년 ' + (+x[2]) + '월' : '';
  }
  function nextMonthStart(m) { return addMonths(m, 1); }

  /* 월 고르기 select — 앞뒤 몇 달 */
  function fillMonthSelect(sel, value, back, ahead) {
    var cur = thisMonth();
    var keep = value || sel.value || cur;
    sel.textContent = '';
    for (var k = ahead; k >= -back; k--) {
      var m = addMonths(cur, k);
      var o = document.createElement('option');
      o.value = m;
      o.textContent = monthLabel(m) + (k === 0 ? ' (이번 달)' : '');
      sel.appendChild(o);
    }
    if (!$$('option', sel).some(function (o) { return o.value === keep; })) {
      var extra = document.createElement('option');
      extra.value = keep; extra.textContent = monthLabel(keep);
      sel.appendChild(extra);
    }
    sel.value = keep;
  }

  var METHOD = { transfer: '계좌이체', card: '현장 카드', payssam: '결제선생' };
  var REFUND_METHOD = { transfer: '계좌이체', card: '카드 취소', cash: '현금', payssam: '결제선생 취소' };
  var KIND = { session: '회차형', single: '단권' };

  /* ============================================================
     공용 상태 — 학원 · 교재 · 반 연결 · 계좌
     ============================================================ */

  var state = {
    loaded: false,
    loading: null,
    missing: false,
    academies: [],
    books: [],
    classAcademy: {},     /* 반이름 → 학원 id */
    classBooks: {},       /* 반이름 → [교재 id] */
    bank: { bank: '', account: '', holder: '' },
    bankAt: '',
    template: '',
    templateAt: '',
    sub: 'dash'
  };

  var DEFAULT_TEMPLATE =
    '안녕하세요 {호칭}, 마라톤국어입니다.\n' +
    '{이름} 학생 {월} 교재비 {금액} 안내드립니다.\n' +
    '내역 확인과 계좌번호 복사는 아래 링크에서 하실 수 있습니다.\n{링크}';

  function isMissing(e) {
    return /does not exist|Could not find the|schema cache/i.test((e && e.message) || '');
  }

  function load(force) {
    if (state.loading && !force) return state.loading;
    var c = sb();
    state.loading = Promise.all([
      c.from('tb_academies').select('*').order('sort_order').order('name'),
      c.from('tb_books').select('*').order('sort_order').order('name'),
      c.from('tb_class_academy').select('*'),
      c.from('tb_class_books').select('*'),
      c.from('app_settings').select('key,value,updated_at').in('key', ['textbook_bank', 'textbook_notice'])
    ]).then(function (res) {
      res.forEach(check);
      state.academies = res[0].data;
      state.books = res[1].data;
      state.classAcademy = {};
      res[2].data.forEach(function (r) { state.classAcademy[r.class_name] = r.academy_id; });
      state.classBooks = {};
      res[3].data.forEach(function (r) {
        (state.classBooks[r.class_name] = state.classBooks[r.class_name] || []).push(r.book_id);
      });
      state.bank = { bank: '', account: '', holder: '' };
      state.bankAt = '';
      state.template = DEFAULT_TEMPLATE;
      state.templateAt = '';
      res[4].data.forEach(function (r) {
        if (r.key === 'textbook_bank') { state.bank = Object.assign(state.bank, r.value || {}); state.bankAt = r.updated_at || ''; }
        if (r.key === 'textbook_notice') {
          if (r.value && r.value.text) state.template = r.value.text;
          state.templateAt = r.updated_at || '';
        }
      });
      state.loaded = true;
      state.missing = false;
      $('#tbNeedSql').hidden = true;
      return state;
    }).catch(function (e) {
      state.loading = null;
      if (isMissing(e)) {
        state.missing = true;
        $('#tbNeedSql').hidden = false;
      }
      throw e;
    });
    return state.loading;
  }

  /* ---------- 조회 도구 ---------- */

  function book(id) { return state.books.find(function (b) { return b.id === id; }) || null; }
  function academyName(cls) {
    var id = state.classAcademy[cls];
    var a = id && state.academies.find(function (x) { return x.id === id; });
    return a ? a.name : '';
  }
  function booksOf(cls, kind) {
    var ids = state.classBooks[cls] || [];
    return state.books.filter(function (b) {
      return b.active && ids.indexOf(b.id) !== -1 && (!kind || b.kind === kind);
    });
  }

  /* 반 목록 — 지금 다니는 학생의 반 + 교재·학원을 붙여 둔 반 */
  function classes() {
    var seen = {};
    Store.getClasses().forEach(function (c) { seen[c.name] = c.count; });
    Object.keys(state.classBooks).concat(Object.keys(state.classAcademy)).forEach(function (n) {
      if (!(n in seen)) seen[n] = 0;
    });
    return Object.keys(seen).filter(function (n) { return !Store.isArchivedClass(n); })
      .sort(function (a, b) { return a.localeCompare(b, 'ko'); })
      .map(function (n) { return { name: n, count: seen[n] }; });
  }

  function activeStudentsOf(cls) {
    return UI.activeStudents().filter(function (s) { return (s.className || '') === cls; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
  }
  function student(id) { return UI.getStudents().find(function (s) { return s.id === id; }) || null; }

  function fillClassSelect(sel, value, allLabel) {
    var keep = value != null ? value : sel.value;
    sel.textContent = '';
    if (allLabel) {
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = allLabel;
      sel.appendChild(o0);
    }
    classes().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      var ac = academyName(c.name);
      o.textContent = c.name + (ac ? ' · ' + ac : '') + (c.count ? ' (' + c.count + ')' : '');
      sel.appendChild(o);
    });
    if ($$('option', sel).some(function (o) { return o.value === keep; })) sel.value = keep;
    else if (!allLabel && sel.options.length) sel.value = sel.options[0].value;
    return sel.value;
  }

  function errBox(host, e) {
    host.innerHTML = '<div class="empty-state">' +
      (isMissing(e) ? '교재 관리용 표가 아직 없습니다. 위 안내대로 SQL 을 먼저 실행해 주세요.'
                    : '불러오지 못했습니다 — ' + esc(e.message)) + '</div>';
  }

  /* ============================================================
     하위 화면 전환
     ============================================================ */

  var modules = {};
  function register(name, mod) { modules[name] = mod; }

  function showSub(name) {
    state.sub = name;
    $$('#tbSubtabs .tb-subtab').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.sub === name ? 'true' : 'false');
    });
    $$('#panel-book .tb-sub').forEach(function (p) { p.hidden = p.dataset.sub !== name; });
    load().then(function () {
      if (modules[name] && modules[name].show) modules[name].show();
    }).catch(function (e) {
      var host = $('#panel-book .tb-sub[data-sub="' + name + '"]');
      if (host) errBox(host, e);
    });
  }

  $('#tbSubtabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tb-subtab');
    if (b) showSub(b.dataset.sub);
  });

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index !== 5) return;
    showSub(state.sub);
  });

  window.addEventListener('jt:loaded', function () {
    state.loading = null;
    state.loaded = false;
    if (!$('#panel-book').hidden) showSub(state.sub);
  });

  /* 다른 기기에서 바뀐 내용 — 지금 보는 화면만 새로 받는다.
     입력 중이거나 창이 열려 있으면 다 끝난 뒤에 (Sync 가 다시 알려 준다). */
  var remoteTimer = null;
  function remoteRefresh() {
    if ($('#panel-book').hidden || !state.loaded) return;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () {
      if (UI.isBusy()) { if (window.Sync) Sync.markSkipped(); return; }
      load(true).then(function () {
        var m = modules[state.sub];
        if (m) (m.refresh || m.show)();
      }).catch(function () {});
    }, 300);
  }
  window.addEventListener('jt:remote', function (e) {
    var t = (e.detail && e.detail.table) || '';
    if (t === '*' || t.indexOf('tb_') === 0) remoteRefresh();
  });
  window.addEventListener('jt:refreshed', remoteRefresh);

  /* ============================================================
     설정 — 학원 · 반 연결 · 교재 · 계좌
     ============================================================ */

  function renderSetup() {
    renderAcademies();
    renderClassLinks();
    renderBooks();
    $('#tbBank').value = state.bank.bank || '';
    $('#tbAccount').value = state.bank.account || '';
    $('#tbHolder').value = state.bank.holder || '';
    $('#tbTemplate').value = state.template;
  }

  function renderAcademies() {
    var host = $('#tbAcademyList');
    if (!state.academies.length) {
      host.innerHTML = '<p class="panel__hint">아직 학원이 없습니다. 예) 목동 PGA · 반포 송림 · 대치 예섬</p>';
      return;
    }
    host.innerHTML = '<div class="chips">' + state.academies.map(function (a) {
      var n = Object.keys(state.classAcademy).filter(function (c) { return state.classAcademy[c] === a.id; }).length;
      return '<span class="chip tb-chip-static" data-id="' + a.id + '">' + esc(a.name) +
             '<span class="chip__count">' + n + '개 반</span>' +
             '<button class="tb-x" type="button" data-act="ren" title="이름 바꾸기">✎</button>' +
             '<button class="tb-x" type="button" data-act="del" title="지우기">×</button></span>';
    }).join('') + '</div>';
  }

  $('#tbAcademyAdd').addEventListener('click', function () {
    var name = $('#tbAcademyName').value.trim();
    if (!name) { toast('학원 이름을 적어 주세요', 'bad'); return; }
    sb().from('tb_academies').insert({ name: name, sort_order: state.academies.length }).then(check)
      .then(function () { $('#tbAcademyName').value = ''; return load(true); })
      .then(function () { renderSetup(); toast(name + ' 학원을 추가했습니다', 'good'); })
      .catch(function (e) { toast(/duplicate/.test(e.message) ? '같은 이름의 학원이 있습니다' : '추가하지 못했습니다 — ' + e.message, 'bad'); });
  });

  $('#tbAcademyList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.closest('[data-id]').dataset.id;
    var a = state.academies.find(function (x) { return x.id === id; });
    if (!a) return;
    if (btn.dataset.act === 'ren') {
      var name = (window.prompt('학원 이름', a.name) || '').trim();
      if (!name || name === a.name) return;
      UI.guardedSave('학원 ' + a.name, function (chk) {
        return DB.updateIf('tb_academies', { id: id }, { name: name }, chk ? a.updated_at : '');
      }, function () { load(true).then(renderSetup); })
        .then(function (res) { if (res.ok) return load(true).then(renderSetup); })
        .catch(function (err) { toast('바꾸지 못했습니다 — ' + err.message, 'bad'); });
      return;
    }
    UI.confirmAsk('‘' + a.name + '’ 학원을 지울까요?', '이 학원에 연결된 반은 학원 없음으로 바뀝니다. 지급·청구 기록은 그대로입니다.', '지우기')
      .then(function (ok) {
        if (!ok) return;
        return sb().from('tb_academies').delete().eq('id', id).then(check)
          .then(function () { return load(true); }).then(renderSetup);
      }).catch(function (err) { toast('지우지 못했습니다 — ' + err.message, 'bad'); });
  });

  function renderClassLinks() {
    var host = $('#tbClassLinks');
    var list = classes();
    if (!list.length) {
      host.innerHTML = '<div class="empty-state">아직 반이 없습니다. 학생 → 명단에서 학생의 반을 적으면 여기에 나옵니다.</div>';
      return;
    }
    var active = state.books.filter(function (b) { return b.active; });
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table">' +
      '<thead><tr><th>반</th><th>학원</th><th>이 반이 쓰는 교재 <span class="tb-th-hint">눌러서 켜고 끕니다</span></th></tr></thead><tbody>' +
      list.map(function (c) {
        var ids = state.classBooks[c.name] || [];
        return '<tr data-cls="' + esc(c.name) + '">' +
          '<td><span class="roster__name">' + esc(c.name) + '</span> <span class="muted-note">' + c.count + '명</span></td>' +
          '<td><select class="select tb-ac-sel" aria-label="학원"><option value="">(학원 없음)</option>' +
            state.academies.map(function (a) {
              return '<option value="' + a.id + '"' + (state.classAcademy[c.name] === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
            }).join('') + '</select></td>' +
          '<td><div class="chips tb-chips-sm">' + (active.length ? active.map(function (b) {
            return '<button type="button" class="chip' + (ids.indexOf(b.id) !== -1 ? ' is-on' : '') + '" data-book="' + b.id + '">' +
                   esc(b.name) + '<span class="chip__count">' + KIND[b.kind] + '</span></button>';
          }).join('') : '<span class="muted-note">아래에서 교재를 먼저 등록하세요</span>') + '</div></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  $('#tbClassLinks').addEventListener('change', function (e) {
    if (!e.target.classList.contains('tb-ac-sel')) return;
    var cls = e.target.closest('tr').dataset.cls;
    var v = e.target.value || null;
    sb().from('tb_class_academy').upsert({ class_name: cls, academy_id: v, updated_at: new Date().toISOString() }, { onConflict: 'class_name' })
      .then(check)
      .then(function () { state.classAcademy[cls] = v; renderAcademies(); toast(cls + ' 반 학원을 저장했습니다', 'good'); })
      .catch(function (err) { toast('저장하지 못했습니다 — ' + err.message, 'bad'); });
  });

  $('#tbClassLinks').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-book]');
    if (!chip) return;
    var cls = chip.closest('tr').dataset.cls;
    var id = chip.dataset.book;
    var on = !chip.classList.contains('is-on');
    chip.classList.toggle('is-on', on);
    var q = on
      ? sb().from('tb_class_books').upsert({ class_name: cls, book_id: id }, { onConflict: 'class_name,book_id', ignoreDuplicates: true })
      : sb().from('tb_class_books').delete().eq('class_name', cls).eq('book_id', id);
    q.then(check).then(function () {
      var ids = state.classBooks[cls] = state.classBooks[cls] || [];
      if (on && ids.indexOf(id) === -1) ids.push(id);
      if (!on) state.classBooks[cls] = ids.filter(function (x) { return x !== id; });
    }).catch(function (err) {
      chip.classList.toggle('is-on', !on);
      toast('저장하지 못했습니다 — ' + err.message, 'bad');
    });
  });

  function renderBooks() {
    var host = $('#tbBookList');
    if (!state.books.length) {
      host.innerHTML = '<div class="empty-state">아직 교재가 없습니다. 위 칸에 적고 <b>+ 교재 추가</b>를 누르세요.</div>';
      return;
    }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table tb-book-table">' +
      '<thead><tr><th>교재명</th><th>종류</th><th class="tb-r">학생 판매가</th><th>공급처</th>' +
      '<th class="tb-r">공급가</th><th class="tb-r">안전 재고</th><th>사용</th><th></th></tr></thead><tbody>' +
      state.books.map(function (b) {
        return '<tr data-id="' + b.id + '"' + (b.active ? '' : ' class="is-archived"') + '>' +
          '<td><input class="input" data-k="name" value="' + esc(b.name) + '" aria-label="교재명"></td>' +
          '<td><select class="select" data-k="kind" aria-label="종류">' +
            '<option value="session"' + (b.kind === 'session' ? ' selected' : '') + '>회차형</option>' +
            '<option value="single"' + (b.kind === 'single' ? ' selected' : '') + '>단권</option></select></td>' +
          '<td><input class="input tb-money-in" data-k="price" inputmode="numeric" value="' + b.price + '" aria-label="학생 판매가"></td>' +
          '<td><input class="input" data-k="supplier" value="' + esc(b.supplier) + '" aria-label="공급처"></td>' +
          '<td><input class="input tb-money-in" data-k="cost" inputmode="numeric" value="' + b.cost + '" aria-label="공급가"></td>' +
          '<td><input class="input tb-money-in" data-k="min_stock" inputmode="numeric" value="' + b.min_stock + '" aria-label="안전 재고"></td>' +
          '<td><input type="checkbox" data-k="active"' + (b.active ? ' checked' : '') + ' aria-label="사용"></td>' +
          '<td><button class="btn btn--sm btn--ghost" type="button" data-act="del" title="지우기">×</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  $('#tbBookAdd').addEventListener('click', function () {
    var name = $('#tbNewBookName').value.trim();
    if (!name) { toast('교재명을 적어 주세요', 'bad'); return; }
    var row = {
      name: name,
      kind: $('#tbNewBookKind').value,
      price: Math.max(0, toInt($('#tbNewBookPrice').value)),
      supplier: $('#tbNewBookSupplier').value.trim(),
      cost: Math.max(0, toInt($('#tbNewBookCost').value)),
      sort_order: state.books.length
    };
    sb().from('tb_books').insert(row).then(check)
      .then(function () {
        ['#tbNewBookName', '#tbNewBookPrice', '#tbNewBookSupplier', '#tbNewBookCost'].forEach(function (s) { $(s).value = ''; });
        return load(true);
      })
      .then(function () { renderSetup(); toast(name + ' 교재를 추가했습니다. 위 표에서 쓰는 반을 켜 주세요', 'good'); })
      .catch(function (e) { toast('추가하지 못했습니다 — ' + e.message, 'bad'); });
  });

  /* 칸을 벗어나면 바로 저장 (bookie 와 같은 방식) */
  $('#tbBookList').addEventListener('change', function (e) {
    var el = e.target.closest('[data-k]');
    if (!el) return;
    var id = el.closest('tr').dataset.id;
    var k = el.dataset.k;
    var b = book(id);
    var v;
    if (k === 'active') v = el.checked;
    else if (k === 'price' || k === 'cost' || k === 'min_stock') { v = Math.max(0, toInt(el.value)); el.value = v; }
    else v = el.value.trim();
    if (k === 'name' && !v) { el.value = b.name; toast('교재명은 비울 수 없습니다', 'bad'); return; }
    var patch = {}; patch[k] = v;
    /* 불러온 뒤 다른 분이 이 교재를 고쳤으면 묻는다 */
    UI.guardedSave(b.name, function (chk) {
      return DB.updateIf('tb_books', { id: id }, patch, chk ? b.updated_at : '');
    }, function () { load(true).then(renderSetup); }).then(function (res) {
      if (!res.ok) return;
      Object.assign(b, res.row);
      if (k === 'active') { el.closest('tr').classList.toggle('is-archived', !v); renderClassLinks(); }
      toast(k === 'price' ? '판매가를 바꿨습니다. 이미 지급한 교재는 지급 당시 가격 그대로입니다' : '저장했습니다', 'good');
    }).catch(function (err) { toast('저장하지 못했습니다 — ' + err.message, 'bad'); });
  });

  $('#tbBookList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act="del"]');
    if (!btn) return;
    var b = book(btn.closest('tr').dataset.id);
    UI.confirmAsk('‘' + b.name + '’ 교재를 지울까요?',
      '지급·입고·주문 기록이 있는 교재는 지울 수 없습니다. 그럴 때는 [사용] 체크를 끄세요.', '지우기')
      .then(function (ok) {
        if (!ok) return;
        return sb().from('tb_books').delete().eq('id', b.id).then(check)
          .then(function () { return load(true); })
          .then(function () { renderSetup(); toast('지웠습니다'); });
      }).catch(function (err) {
        toast(/foreign key/i.test(err.message) ? '기록이 있어 지울 수 없습니다. [사용] 체크를 끄세요' : '지우지 못했습니다 — ' + err.message, 'bad');
      });
  });

  $('#tbBankSave').addEventListener('click', function () {
    var v = { bank: $('#tbBank').value.trim(), account: $('#tbAccount').value.trim(), holder: $('#tbHolder').value.trim() };
    UI.guardedSave('계좌 안내', function (chk) {
      return DB.saveSettingIf('textbook_bank', v, UI.whoami(), chk ? state.bankAt : '');
    }, function () { load(true).then(renderSetup); }).then(function (res) {
      if (!res.ok) return;
      state.bank = v;
      state.bankAt = res.row.updated_at || '';
      toast('계좌 안내를 저장했습니다', 'good');
    }).catch(function (e) { toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  });

  $('#tbTemplateSave').addEventListener('click', function () {
    var t = $('#tbTemplate').value.trim() || DEFAULT_TEMPLATE;
    UI.guardedSave('납부 안내 문구', function (chk) {
      return DB.saveSettingIf('textbook_notice', { text: t }, UI.whoami(), chk ? state.templateAt : '');
    }, function () { load(true).then(renderSetup); }).then(function (res) {
      if (!res.ok) return;
      state.template = t;
      state.templateAt = res.row.updated_at || '';
      toast('납부 안내 문구를 저장했습니다', 'good');
    }).catch(function (e) { toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  });

  $('#tbTemplateReset').addEventListener('click', function () { $('#tbTemplate').value = DEFAULT_TEMPLATE; });

  register('setup', { show: renderSetup });

  /* ============================================================
     일정 — 반별 수업 날짜 (bookie 와 같은 방식)
       방법 A. 연·월·요일로 자동 생성
       방법 B. 날짜 직접 추가
     같은 반 같은 날짜는 표의 unique 제약이 막는다.
     ============================================================ */

  var sched = { picked: {}, dows: {}, month: '', ready: false };
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function initSchedule() {
    if (sched.ready) return;
    sched.ready = true;
    var y = new Date().getFullYear();
    var ys = $('#tbSchYear');
    [y - 1, y, y + 1].forEach(function (v) {
      var o = document.createElement('option'); o.value = v; o.textContent = v + '년'; ys.appendChild(o);
    });
    ys.value = y;
    var ms = $('#tbSchMonth');
    for (var m = 1; m <= 12; m++) {
      var o = document.createElement('option'); o.value = m; o.textContent = m + '월'; ms.appendChild(o);
    }
    ms.value = new Date().getMonth() + 1;
    $('#tbSchDows').innerHTML = DOW.map(function (d, i) {
      return '<button type="button" class="chip" data-dow="' + i + '">' + d + '</button>';
    }).join('');
    fillMonthSelect($('#tbSchListMonth'), thisMonth(), 6, 6);
  }

  function genDates() {
    var y = +$('#tbSchYear').value, m = +$('#tbSchMonth').value;
    var last = new Date(y, m, 0).getDate();
    var out = [];
    for (var d = 1; d <= last; d++) {
      var dt = new Date(y, m - 1, d);
      if (sched.dows[dt.getDay()]) out.push(Store.toISO(dt));
    }
    return out;
  }

  function pickedClasses() { return Object.keys(sched.picked).filter(function (k) { return sched.picked[k]; }); }

  function renderSchedulePicker() {
    $('#tbSchClasses').innerHTML = classes().map(function (c) {
      return '<button type="button" class="chip' + (sched.picked[c.name] ? ' is-on' : '') + '" data-cls="' + esc(c.name) + '">' +
             esc(c.name) + '<span class="chip__count">' + c.count + '</span></button>';
    }).join('') || '<span class="muted-note">반이 없습니다</span>';
    var dates = genDates();
    $('#tbSchPreview').textContent = dates.length
      ? '생성될 날짜: ' + dates.map(function (d) { return Store.dateWithDow(d); }).join(', ')
      : '요일을 고르면 생성될 날짜가 보입니다';
  }

  function renderScheduleList() {
    var host = $('#tbSchList');
    var m0 = $('#tbSchListMonth').value;
    var m1 = nextMonthStart(m0);
    var want = pickedClasses();
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    var q = sb().from('tb_class_dates').select('*').gte('lesson_date', m0).lt('lesson_date', m1)
      .order('class_name').order('lesson_date');
    if (want.length) q = q.in('class_name', want);
    q.then(check).then(function (r) {
      if (!r.data.length) {
        host.innerHTML = '<div class="empty-state">' + monthLabel(m0) + '에 등록된 날짜가 없습니다.</div>';
        return;
      }
      var by = {};
      r.data.forEach(function (d) { (by[d.class_name] = by[d.class_name] || []).push(d); });
      host.innerHTML = Object.keys(by).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (cls) {
        return '<div class="tb-sch-row"><div class="tb-sch-cls">' + esc(cls) +
               ' <span class="muted-note">' + by[cls].length + '회</span></div><div class="chips tb-chips-sm">' +
               by[cls].map(function (d) {
                 return '<span class="chip tb-chip-static">' + esc(Store.dateWithDow(d.lesson_date)) +
                        '<button class="tb-x" type="button" data-del="' + d.id + '" data-cls="' + esc(cls) +
                        '" data-date="' + d.lesson_date + '" title="지우기">×</button></span>';
               }).join('') + '</div></div>';
      }).join('');
    }).catch(function (e) { errBox(host, e); });
  }

  function addDates(dates) {
    var cls = pickedClasses();
    if (!cls.length) { toast('대상 반을 먼저 고르세요', 'bad'); return; }
    if (!dates.length) { toast('추가할 날짜가 없습니다', 'bad'); return; }
    var rows = [];
    cls.forEach(function (c) { dates.forEach(function (d) { rows.push({ class_name: c, lesson_date: d }); }); });
    sb().from('tb_class_dates').upsert(rows, { onConflict: 'class_name,lesson_date', ignoreDuplicates: true })
      .then(check).then(function () {
        $('#tbSchListMonth').value = monthOf(dates[0]);
        if ($('#tbSchListMonth').value !== monthOf(dates[0])) fillMonthSelect($('#tbSchListMonth'), monthOf(dates[0]), 6, 6);
        renderScheduleList();
        toast(cls.length + '개 반에 날짜 ' + dates.length + '개를 넣었습니다 (이미 있던 날짜는 건너뜀)', 'good');
      }).catch(function (e) { toast('추가하지 못했습니다 — ' + e.message, 'bad'); });
  }

  $('#tbSchClasses').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cls]');
    if (!b) return;
    sched.picked[b.dataset.cls] = !sched.picked[b.dataset.cls];
    renderSchedulePicker();
    renderScheduleList();
  });
  $('#tbSchDows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dow]');
    if (!b) return;
    sched.dows[b.dataset.dow] = !sched.dows[b.dataset.dow];
    b.classList.toggle('is-on', !!sched.dows[b.dataset.dow]);
    renderSchedulePicker();
  });
  ['#tbSchYear', '#tbSchMonth'].forEach(function (s) { $(s).addEventListener('change', renderSchedulePicker); });
  $('#tbSchGen').addEventListener('click', function () { addDates(genDates()); });
  $('#tbSchAdd').addEventListener('click', function () {
    var d = $('#tbSchDate').value;
    if (!d) { toast('날짜를 고르세요', 'bad'); return; }
    addDates([d]);
  });
  $('#tbSchListMonth').addEventListener('change', renderScheduleList);

  $('#tbSchList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    var cls = b.dataset.cls, date = b.dataset.date;
    sb().from('tb_issues').select('id', { count: 'exact', head: true }).eq('class_name', cls).eq('lesson_date', date)
      .then(check).then(function (r) {
        var n = r.count || 0;
        return UI.confirmAsk(cls + ' · ' + Store.dateWithDow(date) + ' 수업을 지울까요?',
          n ? '이 날짜에 지급 기록이 ' + n + '건 있습니다. 날짜를 지워도 지급 기록은 남습니다.' : '이 날짜에는 지급 기록이 없습니다.', '지우기');
      }).then(function (ok) {
        if (!ok) return;
        return sb().from('tb_class_dates').delete().eq('id', b.dataset.del).then(check).then(renderScheduleList);
      }).catch(function (err) { toast('지우지 못했습니다 — ' + err.message, 'bad'); });
  });

  register('schedule', {
    show: function () { initSchedule(); renderSchedulePicker(); renderScheduleList(); },
    refresh: function () { if (sched.ready) renderScheduleList(); }
  });

  /* ============================================================
     다른 하위 화면이 쓰는 것
     ============================================================ */

  window.TB = {
    $: $, $$: $$, sb: sb, check: check, esc: esc, toast: toast,
    won: won, signedWon: signedWon, toInt: toInt,
    today: today, monthOf: monthOf, thisMonth: thisMonth, addMonths: addMonths,
    monthLabel: monthLabel, nextMonthStart: nextMonthStart, fillMonthSelect: fillMonthSelect,
    METHOD: METHOD, REFUND_METHOD: REFUND_METHOD, KIND: KIND,
    state: state, load: load, book: book, academyName: academyName, booksOf: booksOf,
    classes: classes, activeStudentsOf: activeStudentsOf, student: student,
    fillClassSelect: fillClassSelect, errBox: errBox, isMissing: isMissing,
    register: register, showSub: showSub, DEFAULT_TEMPLATE: DEFAULT_TEMPLATE
  };

})();
