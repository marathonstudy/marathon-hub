/* ============================================================
   tb-stock.js — 교재 > 재고·주문

   현재 재고 = 입고 합계 − 지급 합계 ± 반품·조정   (SQL 함수 tb_stock)
   권장 주문 부수 = 다음 수업에 필요한 부수 − 나눠 줄 수 있는 재고 (tb_order_suggest)
   실제 주문 부수는 반마다 직접 고쳐서 확정한다 (여유분은 그때그때 다르다).
   확정 → 공급처별 주문표 엑셀 → 들어오면 [입고 처리] 로 재고에 더한다.
   ============================================================ */

(function () {
  'use strict';

  var $ = TB.$, $$ = TB.$$, esc = TB.esc, sb = TB.sb, check = TB.check, toast = TB.toast;

  var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  var st = {
    ready: false,
    stock: [],          /* tb_stock() */
    stockMap: {},
    lines: [],          /* 주문 편집 중인 줄 */
    editing: null,      /* 고치는 중인 임시 주문 id */
    editingAt: '',      /* 그 주문을 불러온 시각 (updated_at) — 다른 분이 고쳤는지 확인 */
    orders: []
  };

  var STATUS = { draft: '임시 저장', confirmed: '확정 · 입고 대기', received: '입고 완료', canceled: '취소' };

  function init() {
    if (st.ready) return;
    st.ready = true;
    $('#tbStockRefresh').addEventListener('click', show);
    $('#tbStockList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-adjust]');
      if (b) openAdjust(b.dataset.adjust);
    });
    $('#tbOrderRefill').addEventListener('click', function () {
      st.editing = null;
      $('#tbOrderMemo').value = '';
      loadSuggest();
    });
    $('#tbOrderEdit').addEventListener('input', function (e) {
      var inp = e.target.closest('[data-line]');
      if (!inp) return;
      st.lines[+inp.dataset.line].qty = Math.max(0, TB.toInt(inp.value));
      renderOrderSummary();
    });
    $('#tbOrderDraft').addEventListener('click', function () { saveOrder('draft'); });
    $('#tbOrderConfirm').addEventListener('click', function () { saveOrder('confirmed'); });
    $('#tbOrderList').addEventListener('click', onOrderListClick);
    $('#tbAdjustForm').addEventListener('submit', submitAdjust);
    $('#btnTbAdjustCancel').addEventListener('click', function () { $('#tbAdjustModal').close(); });
    $('#tbReceiveForm').addEventListener('submit', submitReceive);
    $('#btnTbReceiveCancel').addEventListener('click', function () { $('#tbReceiveModal').close(); });
  }

  function show() {
    init();
    loadStock().then(function () {
      if (!st.editing) loadSuggest(); else renderOrderEdit();
    });
    loadOrders();
    loadMoves();
  }

  /* ============================================================
     현재 재고
     ============================================================ */

  function loadStock() {
    var host = $('#tbStockList');
    return sb().rpc('tb_stock').then(check).then(function (r) {
      st.stock = r.data || [];
      st.stockMap = {};
      st.stock.forEach(function (b) { st.stockMap[b.book_id] = b; });
      renderStock();
    }).catch(function (e) { TB.errBox(host, e); });
  }

  function renderStock() {
    var host = $('#tbStockList');
    if (!st.stock.length) {
      host.innerHTML = '<div class="empty-state">등록된 교재가 없습니다. <b>설정</b>에서 교재를 먼저 등록하세요.</div>';
      return;
    }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table">' +
      '<thead><tr><th>교재</th><th>종류</th><th>공급처</th><th class="tb-r">입고</th><th class="tb-r">지급</th>' +
      '<th class="tb-r">반품·조정</th><th class="tb-r">현재 재고</th><th class="tb-r">입고 예정</th><th></th></tr></thead><tbody>' +
      st.stock.map(function (b) {
        var low = b.active && b.stock <= b.min_stock;
        return '<tr' + (b.active ? '' : ' class="is-archived"') + '>' +
          '<td><span class="roster__name">' + esc(b.name) + '</span></td>' +
          '<td>' + TB.KIND[b.kind] + '</td>' +
          '<td>' + esc(b.supplier || '-') + '</td>' +
          '<td class="tb-r num">' + b.received + '</td>' +
          '<td class="tb-r num">' + b.issued + '</td>' +
          '<td class="tb-r num">' + (b.adjusted > 0 ? '+' : '') + b.adjusted + '</td>' +
          '<td class="tb-r num"><b class="' + (b.stock < 0 ? 'tb-neg' : low ? 'tb-warn' : '') + '">' + b.stock + '</b>' +
            (low ? ' <span class="tb-badge tb-badge--warn">부족</span>' : '') + '</td>' +
          '<td class="tb-r num">' + (b.incoming || '') + '</td>' +
          '<td class="roster__actions"><button class="btn btn--sm" type="button" data-adjust="' + b.book_id + '">조정</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function loadMoves() {
    var host = $('#tbMoveList');
    sb().from('tb_stock_moves').select('*, tb_books(name)').order('created_at', { ascending: false }).limit(40)
      .then(check).then(function (r) {
        if (!r.data.length) { host.innerHTML = '<p class="panel__hint">기록이 없습니다.</p>'; return; }
        var KINDS = { receive: '입고', return: '반품', adjust: '조정' };
        host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table"><thead><tr>' +
          '<th>날짜</th><th>교재</th><th>구분</th><th class="tb-r">수량</th><th>사유</th><th>처리</th></tr></thead><tbody>' +
          r.data.map(function (m) {
            return '<tr><td class="num">' + esc(Store.shortDate(m.moved_on)) + '</td>' +
              '<td>' + esc(m.tb_books ? m.tb_books.name : '') + '</td>' +
              '<td>' + KINDS[m.kind] + '</td>' +
              '<td class="tb-r num">' + (m.qty > 0 ? '+' : '') + m.qty + '</td>' +
              '<td>' + esc(m.reason) + '</td><td class="muted-note">' + esc((m.created_by || '').split('@')[0]) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }).catch(function (e) { TB.errBox(host, e); });
  }

  /* ---------- 수동 조정 ---------- */

  function openAdjust(bookId) {
    var b = st.stockMap[bookId];
    $('#tbAdjustTitle').textContent = b.name + ' 재고 조정';
    $('#tbAdjustDesc').textContent = '지금 재고 ' + b.stock + '부. 분실·파손·반품·실사 차이를 사유와 함께 남깁니다.';
    $('#tbAdjustBook').value = bookId;
    $('#tbAdjustKind').value = 'minus';
    $('#tbAdjustQty').value = '';
    $('#tbAdjustReason').value = '';
    $('#tbAdjustError').classList.remove('is-on');
    $('#tbAdjustModal').showModal();
  }

  function submitAdjust(e) {
    e.preventDefault();
    var kind = $('#tbAdjustKind').value;
    var n = Math.abs(TB.toInt($('#tbAdjustQty').value));
    var reason = $('#tbAdjustReason').value.trim();
    var err = $('#tbAdjustError');
    if (!n) { err.textContent = '수량을 적어 주세요.'; err.classList.add('is-on'); return; }
    if (!reason) { err.textContent = '사유를 적어 주세요. (예: 분실 1부, 공급처 반품)'; err.classList.add('is-on'); return; }
    var row = {
      book_id: $('#tbAdjustBook').value,
      kind: kind === 'return' ? 'return' : 'adjust',
      qty: kind === 'plus' ? n : -n,
      reason: reason,
      created_by: UI.whoami()
    };
    sb().from('tb_stock_moves').insert(row).then(check).then(function () {
      $('#tbAdjustModal').close();
      toast('재고를 조정했습니다', 'good');
      loadStock(); loadMoves();
    }).catch(function (x) { err.textContent = '저장하지 못했습니다 — ' + x.message; err.classList.add('is-on'); });
  }

  /* ============================================================
     주문 만들기
     ============================================================ */

  function loadSuggest() {
    var host = $('#tbOrderEdit');
    host.innerHTML = '<p class="panel__hint">계산하는 중…</p>';
    sb().rpc('tb_order_suggest').then(check).then(function (r) {
      st.lines = (r.data || []).map(function (x) { x.qty = x.suggested; return x; });
      st.editing = null;
      $('#tbOrderTitle').textContent = '주문 만들기';
      renderOrderEdit();
    }).catch(function (e) { TB.errBox(host, e); });
  }

  function renderOrderEdit() {
    var host = $('#tbOrderEdit');
    if (!st.lines.length) {
      host.innerHTML = '<div class="empty-state">주문할 줄이 없습니다.<br>' +
        '<b>설정</b>에서 반마다 쓰는 교재를 켜고, <b>일정</b>에 오늘 이후 수업 날짜가 있어야 계산됩니다.</div>';
      renderOrderSummary();
      return;
    }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table"><thead><tr>' +
      '<th>반</th><th>다음 수업</th><th>교재</th><th class="tb-r">재원생</th><th class="tb-r">필요</th>' +
      '<th class="tb-r">권장</th><th class="tb-r">주문 부수</th></tr></thead><tbody>' +
      st.lines.map(function (l, i) {
        return '<tr><td><span class="roster__name">' + esc(l.class_name) + '</span>' +
            (l.academy ? ' <span class="muted-note">' + esc(l.academy) + '</span>' : '') + '</td>' +
          '<td class="num">' + esc(l.next_date ? Store.dateWithDow(l.next_date) : '-') + '</td>' +
          '<td>' + esc(l.book_name) + ' <span class="muted-note">' + TB.KIND[l.kind] + '</span></td>' +
          '<td class="tb-r num">' + (l.students == null ? '-' : l.students) + '</td>' +
          '<td class="tb-r num">' + l.needed + '</td>' +
          '<td class="tb-r num">' + l.suggested + '</td>' +
          '<td class="tb-r"><input class="input input--num" inputmode="numeric" data-line="' + i + '" value="' + l.qty + '" aria-label="주문 부수"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="sub"><div class="sub__head"><span class="sub__title">교재별 합계</span>' +
      '<span class="sub__hint">주문 후 예상 = 지금 재고 + 입고 예정 + 이번 주문 − 필요</span></div><div id="tbOrderBooks"></div></div>';
    renderOrderSummary();
  }

  function bookTotals() {
    var by = {};
    st.lines.forEach(function (l) {
      var t = by[l.book_id] = by[l.book_id] || { book_id: l.book_id, name: l.book_name, supplier: l.supplier, needed: 0, suggested: 0, qty: 0 };
      t.needed += l.needed || 0;
      t.suggested += l.suggested || 0;
      t.qty += l.qty || 0;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function renderOrderSummary() {
    var totals = bookTotals();
    var sum = totals.reduce(function (a, t) { return a + t.qty; }, 0);
    $('#tbOrderSum').textContent = sum ? '총 ' + sum + '부' : '';
    var host = $('#tbOrderBooks');
    if (!host) return;
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table"><thead><tr>' +
      '<th>교재</th><th>공급처</th><th class="tb-r">지금 재고</th><th class="tb-r">입고 예정</th>' +
      '<th class="tb-r">필요</th><th class="tb-r">권장</th><th class="tb-r">주문</th><th class="tb-r">주문 후 예상</th></tr></thead><tbody>' +
      totals.map(function (t) {
        var s = st.stockMap[t.book_id] || { stock: 0, incoming: 0 };
        var after = s.stock + s.incoming + t.qty - t.needed;
        return '<tr><td><span class="roster__name">' + esc(t.name) + '</span></td><td>' + esc(t.supplier || '-') + '</td>' +
          '<td class="tb-r num">' + s.stock + '</td><td class="tb-r num">' + (s.incoming || 0) + '</td>' +
          '<td class="tb-r num">' + t.needed + '</td><td class="tb-r num">' + t.suggested + '</td>' +
          '<td class="tb-r num"><b>' + t.qty + '</b></td>' +
          '<td class="tb-r num"><b class="' + (after < 0 ? 'tb-neg' : '') + '">' + after + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function saveOrder(status) {
    var lines = st.lines.filter(function (l) { return l.qty > 0; });
    if (!lines.length) { toast('주문 부수가 0입니다', 'bad'); return; }
    var total = lines.reduce(function (a, l) { return a + l.qty; }, 0);
    var go = status === 'confirmed'
      ? UI.confirmAsk('주문 확정', '총 ' + total + '부를 주문 확정합니다. 확정하면 공급처별 주문표를 내려받을 수 있고, 들어오면 [입고 처리]를 누릅니다.', '확정')
      : Promise.resolve(true);
    var c = sb();
    go.then(function (ok) {
      if (!ok) return;
      var head = { status: status, memo: $('#tbOrderMemo').value.trim() };
      if (status === 'confirmed') head.confirmed_at = new Date().toISOString();
      var p = st.editing
        ? UI.guardedSave('임시 저장한 주문', function (chk) {
            return DB.updateIf('tb_orders', { id: st.editing }, head, chk ? st.editingAt : '');
          }, function () { st.editing = null; show(); }).then(function (res) {
            if (!res.ok) throw { quiet: true };
            return { data: res.row };
          })
        : c.from('tb_orders').insert(Object.assign({ created_by: UI.whoami() }, head)).select('id').single().then(check);
      return p.then(function (r) {
        var id = r.data.id;
        return c.from('tb_order_lines').delete().eq('order_id', id).then(check).then(function () {
          return c.from('tb_order_lines').insert(lines.map(function (l) {
            return { order_id: id, book_id: l.book_id, class_name: l.class_name, next_date: l.next_date || null,
                     needed: l.needed || 0, suggested: l.suggested || 0, qty: l.qty };
          })).then(check);
        });
      }).then(function () {
        toast(status === 'confirmed' ? '주문을 확정했습니다. 아래 목록에서 엑셀을 내려받으세요' : '임시 저장했습니다', 'good');
        st.editing = null;
        $('#tbOrderMemo').value = '';
        show();
      });
    }).catch(function (e) { if (e && e.quiet) return; toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  }

  /* ============================================================
     주문 목록
     ============================================================ */

  function loadOrders() {
    var host = $('#tbOrderList');
    sb().from('tb_orders').select('*, tb_order_lines(*, tb_books(name,supplier,cost))')
      .order('created_at', { ascending: false }).limit(40)
      .then(check).then(function (r) {
        st.orders = r.data || [];
        renderOrders();
      }).catch(function (e) { TB.errBox(host, e); });
  }

  function orderBooks(o) {
    var by = {};
    (o.tb_order_lines || []).forEach(function (l) {
      var name = l.tb_books ? l.tb_books.name : '';
      var t = by[l.book_id] = by[l.book_id] || { book_id: l.book_id, name: name, qty: 0 };
      t.qty += l.qty;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function renderOrders() {
    var host = $('#tbOrderList');
    if (!st.orders.length) { host.innerHTML = '<div class="empty-state">아직 주문이 없습니다.</div>'; return; }
    host.innerHTML = st.orders.map(function (o) {
      var books = orderBooks(o);
      var total = books.reduce(function (a, b) { return a + b.qty; }, 0);
      var acts = '';
      if (o.status === 'draft') {
        acts = '<button class="btn btn--sm" data-oact="edit">이어서 고치기</button>' +
               '<button class="btn btn--sm btn--primary" data-oact="confirm">확정</button>' +
               '<button class="btn btn--sm btn--danger" data-oact="del">지우기</button>';
      } else if (o.status === 'confirmed') {
        acts = '<button class="btn btn--sm" data-oact="xlsx">주문표 엑셀</button>' +
               '<button class="btn btn--sm btn--primary" data-oact="receive">입고 처리</button>' +
               '<button class="btn btn--sm btn--danger" data-oact="cancel">주문 취소</button>';
      } else if (o.status === 'received') {
        acts = '<button class="btn btn--sm" data-oact="xlsx">주문표 엑셀</button>';
      }
      return '<div class="tb-order" data-id="' + o.id + '">' +
        '<div class="tb-order__top"><span class="tb-badge tb-badge--' + o.status + '">' + STATUS[o.status] + '</span>' +
        '<span class="tb-order__date num">' + esc(new Date(o.created_at).toLocaleDateString('ko-KR')) + '</span>' +
        '<span class="muted-note">' + esc((o.created_by || '').split('@')[0]) + '</span>' +
        (o.memo ? '<span class="tb-order__memo">' + esc(o.memo) + '</span>' : '') +
        '<span class="spacer"></span><b class="num">' + total + '부</b></div>' +
        '<div class="tb-order__books">' + books.map(function (b) { return esc(b.name) + ' ' + b.qty; }).join(' · ') + '</div>' +
        '<div class="tb-order__acts">' + acts + '</div></div>';
    }).join('');
  }

  function onOrderListClick(e) {
    var b = e.target.closest('[data-oact]');
    if (!b) return;
    var o = st.orders.find(function (x) { return x.id === b.closest('.tb-order').dataset.id; });
    var act = b.dataset.oact;
    var c = sb();

    if (act === 'edit' || act === 'confirm') {
      st.editing = o.id;
      st.editingAt = o.updated_at || '';
      $('#tbOrderMemo').value = o.memo || '';
      $('#tbOrderTitle').textContent = '임시 저장한 주문 고치기';
      st.lines = (o.tb_order_lines || []).map(function (l) {
        return { class_name: l.class_name, academy: TB.academyName(l.class_name), next_date: l.next_date,
                 book_id: l.book_id, book_name: l.tb_books ? l.tb_books.name : '', supplier: l.tb_books ? l.tb_books.supplier : '',
                 kind: (TB.book(l.book_id) || {}).kind || 'session', students: null, needed: l.needed, suggested: l.suggested, qty: l.qty };
      });
      renderOrderEdit();
      if (act === 'confirm') saveOrder('confirmed');
      else $('#tbOrderEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'del') {
      UI.confirmAsk('임시 주문 지우기', '이 임시 저장 주문을 지웁니다.', '지우기').then(function (ok) {
        if (!ok) return;
        return c.from('tb_orders').delete().eq('id', o.id).then(check).then(function () {
          if (st.editing === o.id) { st.editing = null; loadSuggest(); }
          loadOrders();
        });
      }).catch(function (x) { toast('지우지 못했습니다 — ' + x.message, 'bad'); });
      return;
    }
    if (act === 'cancel') {
      UI.confirmAsk('주문 취소', '확정한 주문을 취소합니다. 입고 예정에서 빠집니다.', '주문 취소').then(function (ok) {
        if (!ok) return;
        return UI.guardedSave('확정한 주문', function (chk) {
          return DB.updateIf('tb_orders', { id: o.id }, { status: 'canceled' }, chk ? o.updated_at : '');
        }, show).then(function (res) { if (res.ok) show(); });
      }).catch(function (x) { toast('취소하지 못했습니다 — ' + x.message, 'bad'); });
      return;
    }
    if (act === 'xlsx') { exportOrder(o); return; }
    if (act === 'receive') openReceive(o);
  }

  /* ---------- 입고 처리 ---------- */

  function openReceive(o) {
    var books = orderBooks(o);
    $('#tbReceiveForm').dataset.id = o.id;
    $('#tbReceiveList').innerHTML = books.map(function (b) {
      return '<label class="tb-recv-row"><span class="tb-recv-name">' + esc(b.name) +
             ' <span class="muted-note">주문 ' + b.qty + '부</span></span>' +
             '<input class="input input--num" inputmode="numeric" data-book="' + b.book_id + '" value="' + b.qty + '" aria-label="들어온 부수"></label>';
    }).join('');
    $('#tbReceiveError').classList.remove('is-on');
    $('#tbReceiveModal').showModal();
  }

  function submitReceive(e) {
    e.preventDefault();
    var id = $('#tbReceiveForm').dataset.id;
    var lines = $$('#tbReceiveList [data-book]').map(function (i) {
      return { book_id: i.dataset.book, qty: Math.max(0, TB.toInt(i.value)) };
    });
    sb().rpc('tb_order_receive', { p_order: id, p_lines: lines }).then(check).then(function () {
      $('#tbReceiveModal').close();
      toast('입고 처리했습니다. 재고에 더했습니다', 'good');
      show();
    }).catch(function (x) {
      var err = $('#tbReceiveError');
      err.textContent = '처리하지 못했습니다 — ' + x.message;
      err.classList.add('is-on');
    });
  }

  /* ---------- 공급처별 주문표 엑셀 ---------- */

  var xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { xlsxPromise = null; reject(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function sheetName(n, used) {
    var base = String(n || '공급처 없음').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 28) || '공급처';
    var name = base, i = 2;
    while (used[name]) name = base.slice(0, 25) + ' ' + (i++);
    used[name] = true;
    return name;
  }

  function exportOrder(o) {
    loadXlsx().then(function (XLSX) {
      var lines = o.tb_order_lines || [];
      var bySup = {};
      lines.forEach(function (l) {
        var sup = (l.tb_books && l.tb_books.supplier) || '공급처 없음';
        (bySup[sup] = bySup[sup] || []).push(l);
      });
      var wb = XLSX.utils.book_new();
      var used = {};
      var date = new Date(o.confirmed_at || o.created_at).toLocaleDateString('ko-KR');

      /* 요약 — 공급처 · 교재 · 부수 · 공급가 · 금액 */
      var sum = [['교재 주문 요약', '', '', '', ''], ['주문일', date, '', '', ''], [],
                 ['공급처', '교재', '주문 부수', '공급가', '금액']];
      Object.keys(bySup).sort().forEach(function (sup) {
        var by = {};
        bySup[sup].forEach(function (l) {
          var t = by[l.book_id] = by[l.book_id] || { name: l.tb_books ? l.tb_books.name : '', cost: l.tb_books ? l.tb_books.cost : 0, qty: 0 };
          t.qty += l.qty;
        });
        Object.keys(by).forEach(function (k) { var t = by[k]; sum.push([sup, t.name, t.qty, t.cost, t.qty * t.cost]); });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), sheetName('요약', used));

      /* 공급처마다 한 장 — 교재별 합계와 반별 내역 */
      Object.keys(bySup).sort().forEach(function (sup) {
        var rows = [[sup + ' 주문표'], ['주문일', date], [], ['교재', '주문 부수']];
        var by = {};
        bySup[sup].forEach(function (l) {
          var n = l.tb_books ? l.tb_books.name : '';
          by[n] = (by[n] || 0) + l.qty;
        });
        Object.keys(by).forEach(function (n) { rows.push([n, by[n]]); });
        rows.push([], ['반별 내역'], ['교재', '반', '학원', '다음 수업', '부수']);
        bySup[sup].forEach(function (l) {
          rows.push([l.tb_books ? l.tb_books.name : '', l.class_name, TB.academyName(l.class_name), l.next_date || '', l.qty]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName(sup, used));
      });

      XLSX.writeFile(wb, '교재주문_' + TB.today() + '.xlsx');
    }).catch(function (e) { toast(e.message, 'bad'); });
  }

  /* 다른 기기에서 바뀌었을 때 — 고치던 주문 칸은 그대로 두고 재고·목록만 */
  TB.register('stock', {
    show: show,
    refresh: function () {
      if (!st.ready) return;
      loadStock().then(function () { if (st.lines.length) renderOrderSummary(); });
      loadOrders();
      loadMoves();
    }
  });

})();
