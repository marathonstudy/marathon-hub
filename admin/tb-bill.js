/* ============================================================
   tb-bill.js — 교재 > 청구·수납 · 환불

   월 1회. 반·월마다 청구 방식을 고른다.
     선불  그 달 예정 수업 날짜 × 회차형 교재 + 예정 단권 (지금 판매가)
     후불  그 달 실제 지급 기록 (지급 당시 가격)
   금액 계산은 SQL 함수(tb_bill_preview · tb_bill_create)가 한다. 화면은 받은 값을 보여 줄 뿐이다.

   선불 달은 월말에 실제 지급과 비교해 차액을 보여 주고
   [다음 달 청구에 반영] 또는 [환불] 을 고른다 (tb_diff_resolve).

   납부 안내는 문구·링크 복사와 문자 앱 열기만 한다(자동 발송 없음).
   누를 때마다 tb_bill_notices 에 N차 기록이 남는다.

   결제선생: 지금은 수납 방법 값(payssam)으로만 쓴다.
   나중에 콜백 함수가 tb_bills.provider_ref 로 청구서를 찾아 완료 처리하게 된다.
   ============================================================ */

(function () {
  'use strict';

  var $ = TB.$, $$ = TB.$$, esc = TB.esc, sb = TB.sb, check = TB.check, toast = TB.toast, won = TB.won;

  var STATUS = { unpaid: '미납', paid: '완료', waived: '면제' };
  var RF_STATUS = { requested: '요청', done: '완료', canceled: '취소' };
  var VIA = { sms: '문자', copy: '문구 복사', link: '링크 복사' };

  var st = {
    ready: false, month: '', cls: '', status: '', q: '',
    bills: [], plan: null, preview: [], noticeBill: null
  };

  function init() {
    if (st.ready) return;
    st.ready = true;
    TB.fillMonthSelect($('#tbBlMonth'), TB.thisMonth(), 12, 3);
    $('#tbBlMonth').addEventListener('change', reload);
    $('#tbBlClass').addEventListener('change', reload);
    $('#tbBlStatus').addEventListener('change', function (e) { st.status = e.target.value; renderList(); });
    var timer;
    $('#tbBlSearch').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { st.q = e.target.value.trim(); renderList(); }, 150);
    });
    $('#tbBlRefresh').addEventListener('click', reload);
    $('#tbBlModes').addEventListener('change', renderMakeInfo);
    $('#tbBlSingles').addEventListener('click', function (e) {
      var c = e.target.closest('[data-book]');
      if (c) { c.classList.toggle('is-on'); renderMakeInfo(); }
    });
    $('#tbBlPreviewBtn').addEventListener('click', loadPreview);
    $('#tbBlPreview').addEventListener('change', syncCreateBtn);
    $('#tbBlCreate').addEventListener('click', createBills);
    $('#tbBlList').addEventListener('click', onListClick);
    $('#tbBlDiff').addEventListener('click', onDiffClick);

    $('#tbPayForm').addEventListener('submit', submitPay);
    $('#btnTbPayCancel').addEventListener('click', function () { $('#tbPayModal').close(); });
    $('#tbPayReceipt').addEventListener('click', function (e) {
      var a = e.target.closest('[data-receipt]');
      if (a) { e.preventDefault(); openReceipt(a.dataset.receipt); }
    });
    $('#tbBillAdjForm').addEventListener('submit', submitAdj);
    $('#btnTbBillAdjCancel').addEventListener('click', function () { $('#tbBillAdjModal').close(); });
    $('#btnTbNoticeClose').addEventListener('click', function () { $('#tbNoticeModal').close(); });
    $('#tbNoticeActs').addEventListener('click', onNoticeAct);
    $('#tbNoticeHistory').addEventListener('click', onNoticeHistoryClick);
    $('#tbRefundForm').addEventListener('submit', submitRefund);
    $('#btnTbRefundCancel').addEventListener('click', function () { $('#tbRefundModal').close(); });
  }

  function show() {
    init();
    TB.fillClassSelect($('#tbBlClass'), st.cls != null ? st.cls : '', '전체 반');
    reload();
  }

  function reload() {
    st.month = $('#tbBlMonth').value;
    st.cls = $('#tbBlClass').value;
    st.preview = [];
    $('#tbBlPreview').innerHTML = '';
    syncCreateBtn();
    loadSummary();
    loadPlan();
    loadBills();
    loadDiff();
  }

  /* ============================================================
     위 요약 — tb_dashboard 함수 값을 그대로 쓴다
     ============================================================ */

  function cardsHtml(s) {
    return [
      ['청구', s.billed, (s.bills || 0) + '건'],
      ['결제 완료', s.paid, ''],
      ['미결제', s.unpaid, (s.unpaid_n || 0) + '건'],
      ['환불', s.refunded, s.refund_wait ? '대기 ' + won(s.refund_wait) : ''],
      ['실수납', (s.paid || 0) - (s.refunded || 0), '완료 − 환불']
    ].map(function (c) {
      return '<div class="tb-card"><div class="tb-card__label">' + c[0] + '</div>' +
             '<div class="tb-card__val num">' + won(c[1]) + '</div>' +
             (c[2] ? '<div class="tb-card__sub">' + esc(c[2]) + '</div>' : '') + '</div>';
    }).join('');
  }

  function loadSummary() {
    var host = $('#tbBlSummary');
    sb().rpc('tb_dashboard', { p_month: st.month }).then(check).then(function (r) {
      var d = r.data || {};
      var s = d.summary || {};
      if (st.cls) {
        var row = (d.by_class || []).find(function (x) { return x.class_name === st.cls; }) || {};
        s = { billed: row.billed, paid: row.paid, unpaid: row.unpaid, refunded: row.refunded,
              refund_wait: row.refund_wait, bills: row.bills, unpaid_n: row.unpaid_n };
      }
      host.innerHTML = cardsHtml(s);
    }).catch(function (e) { TB.errBox(host, e); });
  }

  /* ============================================================
     청구 만들기
     ============================================================ */

  function loadPlan() {
    var body = $('#tbBlMakeBody');
    if (!st.cls) {
      body.hidden = true;
      $('#tbBlMakeHint').textContent = '위에서 반을 고르면 그 반의 청구서를 만들 수 있습니다';
      return;
    }
    body.hidden = false;
    $('#tbBlMakeHint').textContent = st.cls + ' · ' + TB.monthLabel(st.month);
    var c = sb();
    Promise.all([
      c.from('tb_bill_plans').select('*').eq('class_name', st.cls).eq('month', st.month).maybeSingle(),
      c.from('tb_class_dates').select('lesson_date').eq('class_name', st.cls)
        .gte('lesson_date', st.month).lt('lesson_date', TB.nextMonthStart(st.month)).order('lesson_date')
    ]).then(function (res) {
      res.forEach(check);
      st.plan = res[0].data;
      st.dates = res[1].data.map(function (r) { return r.lesson_date; });
      var mode = st.plan ? st.plan.mode : 'post';
      $$('#tbBlModes input').forEach(function (i) { i.checked = i.value === mode; });
      var picked = st.plan ? st.plan.single_book_ids : [];
      var singles = TB.booksOf(st.cls, 'single');
      $('#tbBlSingles').innerHTML = singles.length ? singles.map(function (b) {
        return '<button type="button" class="chip' + (picked.indexOf(b.id) !== -1 ? ' is-on' : '') + '" data-book="' + b.id + '">' +
               esc(b.name) + '<span class="chip__count">' + won(b.price) + '</span></button>';
      }).join('') : '<span class="muted-note">이 반에 연결된 단권이 없습니다</span>';
      renderMakeInfo();
    }).catch(function (e) { TB.errBox(body, e); });
  }

  function mode() {
    var on = $$('#tbBlModes input').find(function (i) { return i.checked; });
    return on ? on.value : 'post';
  }
  function pickedSingles() {
    return $$('#tbBlSingles [data-book].is-on').map(function (c) { return c.dataset.book; });
  }

  function renderMakeInfo() {
    var pre = mode() === 'pre';
    $('#tbBlSinglesWrap').hidden = !pre;
    var sess = TB.booksOf(st.cls, 'session');
    var dates = st.dates || [];
    $('#tbBlMakeInfo').innerHTML = pre
      ? '<b>선불</b> — ' + TB.monthLabel(st.month) + ' 수업 날짜 <b>' + dates.length + '회</b>' +
        (dates.length ? ' (' + dates.map(function (d) { return Store.shortDate(d); }).join(', ') + ')' : '') +
        ' × ' + (sess.length ? sess.map(function (b) { return esc(b.name) + ' ' + won(b.price); }).join(' · ') : '회차형 교재 없음') +
        ' + 고른 단권. 지금 판매가로 계산합니다. 월말에 실제 지급과 차액을 정리합니다.'
      : '<b>후불</b> — ' + TB.monthLabel(st.month) + '에 실제로 지급한 기록을 지급 당시 가격으로 청구합니다.';
    $('#tbBlPreview').innerHTML = '';
    st.preview = [];
    syncCreateBtn();
  }

  function itemsText(items) {
    if (!items || !items.length) return '<span class="muted-note">품목 없음</span>';
    return items.map(function (it) {
      return esc(it.name) + ' ' + it.qty + (it.kind === 'single' ? '권' : '회') +
             ' <span class="muted-note">× ' + won(it.unit_price) + '</span>';
    }).join('<br>');
  }

  function loadPreview() {
    var host = $('#tbBlPreview');
    host.innerHTML = '<p class="panel__hint">계산하는 중…</p>';
    sb().rpc('tb_bill_preview', {
      p_class: st.cls, p_month: st.month, p_mode: mode(), p_singles: pickedSingles()
    }).then(check).then(function (r) {
      st.preview = r.data || [];
      if (!st.preview.length) { host.innerHTML = '<div class="empty-state">청구할 학생이 없습니다.</div>'; syncCreateBtn(); return; }
      host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table"><thead><tr>' +
        '<th><input type="checkbox" id="tbBlPvAll" checked aria-label="모두"></th><th>학생</th><th>품목</th>' +
        '<th class="tb-r">품목 합계</th><th class="tb-r">지난 차액</th><th>지금 청구서</th></tr></thead><tbody>' +
        st.preview.map(function (p, i) {
          var locked = p.bill_id && p.bill_status !== 'unpaid';
          var empty = !p.bill_id && !p.items_total && !p.carry_pending;
          return '<tr' + (locked || empty ? ' class="is-archived"' : '') + '>' +
            '<td><input type="checkbox" data-pv="' + i + '"' + (locked || empty ? ' disabled' : ' checked') + '></td>' +
            '<td><span class="roster__name">' + esc(p.name) + '</span>' + (p.archived ? ' <span class="link-tag link-tag--off">퇴원</span>' : '') + '</td>' +
            '<td class="tb-items">' + itemsText(p.items) + '</td>' +
            '<td class="tb-r num"><b>' + won(p.items_total) + '</b></td>' +
            '<td class="tb-r num">' + (p.carry_pending ? TB.signedWon(p.carry_pending) : '') + '</td>' +
            '<td>' + (p.bill_id
              ? '<span class="tb-badge tb-badge--' + p.bill_status + '">' + STATUS[p.bill_status] + ' ' + won(p.bill_total) + '</span>' +
                (locked ? ' <span class="muted-note">건드리지 않음</span>' : ' <span class="muted-note">새로 계산해 덮음</span>')
              : (empty ? '<span class="muted-note">청구할 것 없음</span>' : '<span class="muted-note">새로 만듦</span>')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      $('#tbBlPvAll').addEventListener('change', function (e) {
        $$('#tbBlPreview [data-pv]').forEach(function (c) { if (!c.disabled) c.checked = e.target.checked; });
        syncCreateBtn();
      });
      syncCreateBtn();
    }).catch(function (e) { TB.errBox(host, e); syncCreateBtn(); });
  }

  function pickedPreview() {
    return $$('#tbBlPreview [data-pv]').filter(function (c) { return c.checked && !c.disabled; })
      .map(function (c) { return st.preview[+c.dataset.pv]; });
  }

  function syncCreateBtn() {
    var n = pickedPreview().length;
    var btn = $('#tbBlCreate');
    btn.disabled = !n;
    btn.textContent = n ? '청구서 만들기 (' + n + '명)' : '청구서 만들기';
  }

  function createBills() {
    var list = pickedPreview();
    if (!list.length) return;
    var btn = $('#tbBlCreate');
    btn.disabled = true;
    sb().rpc('tb_bill_create', {
      p_class: st.cls, p_month: st.month, p_mode: mode(), p_singles: pickedSingles(),
      p_students: list.map(function (p) { return p.student_id; })
    }).then(check).then(function (r) {
      var d = r.data || {};
      toast('청구서 새로 ' + (d.created || 0) + '장 · 다시 계산 ' + (d.updated || 0) + '장' +
            (d.skipped ? ' · 완료·면제라 건너뜀 ' + d.skipped + '장' : ''), 'good');
      if (d.carry_left) {
        toast('돌려줄 차액이 청구 금액보다 커서 붙이지 못한 학생이 ' + d.carry_left + '명 있습니다. 그 달 차액 정리에서 [되돌리기] 후 [환불]을 고르세요', 'warn');
      }
      reload();
    }).catch(function (e) { btn.disabled = false; toast('만들지 못했습니다 — ' + e.message, 'bad'); });
  }

  /* ============================================================
     학생별 청구서
     ============================================================ */

  function loadBills() {
    var host = $('#tbBlList');
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    var q = sb().from('tb_bills')
      .select('*, tb_bill_notices(id,seq,via,sent_at,sent_by), tb_refunds(id,amount,status,method,reason,source,requested_at,done_at)')
      .eq('month', st.month).order('class_name');
    if (st.cls) q = q.eq('class_name', st.cls);
    q.then(check).then(function (r) {
      st.bills = (r.data || []).map(function (b) {
        var s = TB.student(b.student_id);
        b._name = s ? s.name : '(학생)';
        b._student = s;
        b.tb_bill_notices = (b.tb_bill_notices || []).sort(function (a, c) { return a.seq - c.seq; });
        return b;
      }).sort(function (a, b) {
        return (a.class_name || '').localeCompare(b.class_name || '', 'ko') || a._name.localeCompare(b._name, 'ko');
      });
      renderList();
    }).catch(function (e) { TB.errBox(host, e); });
  }

  function refundActive(b) {
    return (b.tb_refunds || []).filter(function (r) { return r.status !== 'canceled'; });
  }
  function refundRoom(b) {
    return Math.max(0, b.total - refundActive(b).reduce(function (a, r) { return a + r.amount; }, 0));
  }

  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function renderList() {
    var host = $('#tbBlList');
    var list = st.bills.filter(function (b) {
      if (st.status && b.status !== st.status) return false;
      if (st.q && b._name.indexOf(st.q) === -1) return false;
      return true;
    });
    if (!st.bills.length) {
      host.innerHTML = '<div class="empty-state">' + TB.monthLabel(st.month) + ' 청구서가 아직 없습니다.' +
        (st.cls ? '<br>위 <b>청구 만들기</b>에서 만드세요.' : '<br>반을 고르고 <b>청구 만들기</b>에서 만드세요.') + '</div>';
      return;
    }
    if (!list.length) { host.innerHTML = '<div class="empty-state">조건에 맞는 청구서가 없습니다.</div>'; return; }

    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table tb-bills"><thead><tr>' +
      '<th>학생</th><th>품목</th><th class="tb-r">청구 금액</th><th>상태</th><th>안내</th><th></th></tr></thead><tbody>' +
      list.map(function (b) {
        var extra = [];
        if (b.carry_in) extra.push('지난 차액 ' + TB.signedWon(b.carry_in));
        if (b.adjust) extra.push('조정 ' + TB.signedWon(b.adjust) + (b.adjust_reason ? ' (' + esc(b.adjust_reason) + ')' : ''));
        var refunds = refundActive(b);
        var last = b.tb_bill_notices[b.tb_bill_notices.length - 1];
        var acts;
        if (b.status === 'unpaid') {
          acts = '<button class="btn btn--sm btn--primary" data-bact="pay">납부 완료</button>' +
                 '<button class="btn btn--sm" data-bact="notice">안내</button>' +
                 '<button class="btn btn--sm" data-bact="adj">조정</button>' +
                 '<button class="btn btn--sm btn--ghost" data-bact="waive">면제</button>' +
                 '<button class="btn btn--sm btn--ghost" data-bact="del" title="청구서 지우기">×</button>';
        } else if (b.status === 'paid') {
          acts = '<button class="btn btn--sm" data-bact="pay">납부 정보</button>' +
                 '<button class="btn btn--sm" data-bact="refund"' + (refundRoom(b) ? '' : ' disabled') + '>환불</button>' +
                 '<button class="btn btn--sm btn--ghost" data-bact="unpay">미납으로</button>';
        } else {
          acts = '<button class="btn btn--sm btn--ghost" data-bact="unpay">미납으로</button>';
        }
        return '<tr data-id="' + b.id + '">' +
          '<td><span class="roster__name">' + esc(b._name) + '</span><br><span class="muted-note">' + esc(b.class_name) +
            ' · ' + (b.mode === 'pre' ? '선불' : '후불') + '</span></td>' +
          '<td class="tb-items">' + itemsText(b.items) + '</td>' +
          '<td class="tb-r num"><b>' + won(b.total) + '</b>' +
            (extra.length ? '<br><span class="muted-note">품목 ' + won(b.items_total) + '<br>' + extra.join('<br>') + '</span>' : '') + '</td>' +
          '<td><span class="tb-badge tb-badge--' + b.status + '">' + STATUS[b.status] + '</span>' +
            (b.status === 'paid'
              ? '<br><span class="muted-note">' + esc(fmtDT(b.paid_at)) + ' · ' + esc(TB.METHOD[b.pay_method] || '') + '</span>' +
                (b.receipt_path ? ' <a href="#" class="tb-link" data-receipt="' + esc(b.receipt_path) + '">📎 캡처</a>' : '') +
                (b.pay_memo ? '<br><span class="muted-note">' + esc(b.pay_memo) + '</span>' : '')
              : '') +
            refunds.map(function (r) {
              return '<br><span class="tb-badge tb-badge--refund">환불 ' + won(r.amount) + ' ' + RF_STATUS[r.status] + '</span>';
            }).join('') + '</td>' +
          '<td>' + (last ? '<b>' + last.seq + '차</b> <span class="muted-note">' + esc(fmtDT(last.sent_at)) + '</span>' : '<span class="muted-note">안 보냄</span>') + '</td>' +
          '<td class="roster__actions tb-acts">' + acts + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function billOf(el) {
    var tr = el.closest('tr');
    return tr && st.bills.find(function (b) { return b.id === tr.dataset.id; });
  }

  function onListClick(e) {
    var rc = e.target.closest('[data-receipt]');
    if (rc) { e.preventDefault(); openReceipt(rc.dataset.receipt); return; }
    var btn = e.target.closest('[data-bact]');
    if (!btn) return;
    var b = billOf(btn);
    if (!b) return;
    var act = btn.dataset.bact;
    var c = sb();

    if (act === 'pay') openPay(b);
    else if (act === 'notice') openNotice(b);
    else if (act === 'adj') openAdj(b);
    else if (act === 'refund') openRefund(b, null);
    else if (act === 'waive') {
      UI.confirmAsk('교재비 면제', b._name + ' 학생 ' + TB.monthLabel(b.month) + ' 교재비 ' + won(b.total) + '을 면제합니다. 합계에서 빠집니다.', '면제')
        .then(function (ok) { if (ok) return c.from('tb_bills').update({ status: 'waived' }).eq('id', b.id).then(check).then(reload); })
        .catch(function (x) { toast('바꾸지 못했습니다 — ' + x.message, 'bad'); });
    } else if (act === 'unpay') {
      if (refundActive(b).length) { toast('환불 기록이 있어 되돌릴 수 없습니다. 환불을 먼저 취소하세요', 'bad'); return; }
      if (b.diff_action) { toast('선불 차액을 이미 처리했습니다. 아래 차액 정리에서 먼저 [되돌리기]를 하세요', 'bad'); return; }
      UI.confirmAsk('미납으로 되돌리기', b._name + ' 학생 청구서를 미납으로 바꿉니다. 납부 일시·방법·캡처 연결이 지워집니다.', '되돌리기')
        .then(function (ok) {
          if (ok) return c.from('tb_bills').update({ status: 'unpaid', receipt_path: '' }).eq('id', b.id).then(check).then(reload);
        }).catch(function (x) { toast('바꾸지 못했습니다 — ' + x.message, 'bad'); });
    } else if (act === 'del') {
      UI.confirmAsk('청구서 지우기', b._name + ' 학생 ' + TB.monthLabel(b.month) + ' 청구서를 지웁니다. 발송 기록도 같이 지워집니다.', '지우기')
        .then(function (ok) { if (ok) return c.rpc('tb_bill_remove', { p_bill: b.id }).then(check).then(reload); })
        .catch(function (x) { toast('지우지 못했습니다 — ' + x.message, 'bad'); });
    }
  }

  /* ---------- 납부 완료 ---------- */

  function localDT(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openPay(b) {
    $('#tbPayForm').dataset.id = b.id;
    $('#tbPayTitle').textContent = b._name + ' · ' + TB.monthLabel(b.month) + ' 납부';
    $('#tbPayDesc').textContent = '청구 금액 ' + won(b.total);
    $('#tbPayAt').value = localDT(b.paid_at ? new Date(b.paid_at) : new Date());
    $('#tbPayMethod').value = b.pay_method || 'transfer';
    $('#tbPayMemo').value = b.pay_memo || '';
    $('#tbPayFile').value = '';
    $('#tbPayReceipt').innerHTML = b.receipt_path
      ? '지금 첨부: <a href="#" class="tb-link" data-receipt="' + esc(b.receipt_path) + '">📎 캡처 보기</a> (새 파일을 고르면 바뀝니다)'
      : '';
    $('#tbPayError').classList.remove('is-on');
    $('#tbPayModal').showModal();
  }

  function submitPay(e) {
    e.preventDefault();
    var id = $('#tbPayForm').dataset.id;
    var b = st.bills.find(function (x) { return x.id === id; });
    var at = $('#tbPayAt').value;
    var err = $('#tbPayError');
    if (!at) { err.textContent = '납부 일시를 넣어 주세요.'; err.classList.add('is-on'); return; }
    var file = $('#tbPayFile').files[0];
    if (file && file.size > 5 * 1024 * 1024) { err.textContent = '캡처 파일은 5MB 까지 올릴 수 있습니다.'; err.classList.add('is-on'); return; }
    var btn = $('#btnTbPaySave');
    btn.disabled = true;

    var up = Promise.resolve(b.receipt_path || '');
    if (file) {
      var ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [, 'jpg'])[1].toLowerCase();
      var path = id + '/' + Date.now() + '.' + ext;
      up = sb().storage.from('tb-receipts').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
        .then(function (r) { if (r.error) throw new Error('캡처를 올리지 못했습니다 — ' + r.error.message); return path; });
    }
    up.then(function (path) {
      return sb().from('tb_bills').update({
        status: 'paid',
        paid_at: new Date(at).toISOString(),
        pay_method: $('#tbPayMethod').value,
        pay_memo: $('#tbPayMemo').value.trim(),
        receipt_path: path
      }).eq('id', id).then(check);
    }).then(function () {
      btn.disabled = false;
      $('#tbPayModal').close();
      toast(b._name + ' 납부 완료로 저장했습니다', 'good');
      reload();
    }).catch(function (x) {
      btn.disabled = false;
      err.textContent = x.message;
      err.classList.add('is-on');
    });
  }

  function openReceipt(path) {
    sb().storage.from('tb-receipts').createSignedUrl(path, 300).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      window.open(r.data.signedUrl, '_blank', 'noopener');
    }).catch(function (e) { toast('캡처를 열지 못했습니다 — ' + e.message, 'bad'); });
  }

  /* ---------- 조정 ---------- */

  function openAdj(b) {
    $('#tbBillAdjForm').dataset.id = b.id;
    $('#tbBillAdjDesc').textContent = b._name + ' · 품목 ' + won(b.items_total) +
      (b.carry_in ? ' · 지난 차액 ' + TB.signedWon(b.carry_in) : '') + ' · 지금 조정 ' + TB.signedWon(b.adjust);
    $('#tbBillAdjAmount').value = b.adjust || '';
    $('#tbBillAdjReason').value = b.adjust_reason || '';
    $('#tbBillAdjError').classList.remove('is-on');
    $('#tbBillAdjModal').showModal();
  }

  function submitAdj(e) {
    e.preventDefault();
    var id = $('#tbBillAdjForm').dataset.id;
    var amt = TB.toInt($('#tbBillAdjAmount').value);
    var reason = $('#tbBillAdjReason').value.trim();
    var err = $('#tbBillAdjError');
    if (amt && !reason) { err.textContent = '사유를 적어 주세요. (예: 10/14 입반 — 2회분 제외)'; err.classList.add('is-on'); return; }
    sb().from('tb_bills').update({ adjust: amt, adjust_reason: amt ? reason : '' }).eq('id', id).eq('status', 'unpaid')
      .then(check).then(function () { $('#tbBillAdjModal').close(); toast('조정했습니다', 'good'); reload(); })
      .catch(function (x) { err.textContent = '저장하지 못했습니다 — ' + x.message; err.classList.add('is-on'); });
  }

  /* ============================================================
     납부 안내 — 복사 · 문자 앱 열기. 누를 때마다 N차 기록.
     ============================================================ */

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }
  function smsHref(number, body) {
    return 'sms:' + Store.phoneDigits(number) + (isIOS() ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }

  function linkOfBill(b) { return Store.hubUrl(Store.linkOf(b.student_id).hubCode, 'book'); }

  function messageOf(b) {
    var bank = TB.state.bank;
    var acct = [bank.bank, bank.account, bank.holder ? '(예금주 ' + bank.holder + ')' : ''].filter(Boolean).join(' ');
    return (TB.state.template || TB.DEFAULT_TEMPLATE)
      .split('{호칭}').join(Store.parentTitleOf(b._student))
      .split('{이름}').join(b._name)
      .split('{월}').join(TB.monthLabel(b.month))
      .split('{금액}').join(won(b.total))
      .split('{계좌}').join(acct)
      .split('{링크}').join(linkOfBill(b));
  }

  function openNotice(b) {
    st.noticeBill = b;
    var link = linkOfBill(b);
    $('#tbNoticeTitle').textContent = b._name + ' · ' + TB.monthLabel(b.month) + ' 납부 안내';
    $('#tbNoticeWarn').hidden = !!link;
    $('#tbNoticeText').value = messageOf(b);
    var phones = Store.phonesOf(b._student || {});
    $('#tbNoticeActs').innerHTML =
      phones.map(function (p, i) {
        return '<button class="btn btn--primary" type="button" data-nact="sms" data-i="' + i + '">문자 보내기 · ' +
               esc(p.label) + ' ' + esc(Store.phoneFormat(p.number)) + '</button>';
      }).join('') +
      '<button class="btn" type="button" data-nact="copy">문구 복사</button>' +
      '<button class="btn" type="button" data-nact="link"' + (link ? '' : ' disabled') + '>링크만 복사</button>';
    renderNoticeHistory();
    $('#tbNoticeModal').showModal();
  }

  function renderNoticeHistory() {
    var b = st.noticeBill;
    var list = b.tb_bill_notices || [];
    $('#tbNoticeHistory').innerHTML = list.length
      ? '<ul class="tb-hist">' + list.slice().reverse().map(function (n) {
          return '<li><b>' + n.seq + '차</b> <span class="num">' + esc(fmtDT(n.sent_at)) + '</span> · ' + VIA[n.via] +
                 ' <span class="muted-note">' + esc((n.sent_by || '').split('@')[0]) + '</span>' +
                 ' <button class="tb-x" type="button" data-ndel="' + n.id + '" title="잘못 누른 기록 지우기">×</button></li>';
        }).join('') + '</ul>'
      : '<p class="panel__hint">아직 보낸 기록이 없습니다.</p>';
  }

  function logNotice(via) {
    var b = st.noticeBill;
    return sb().from('tb_bill_notices').insert({ bill_id: b.id, via: via, sent_by: UI.whoami() })
      .select('id,seq,via,sent_at,sent_by').single().then(check).then(function (r) {
        b.tb_bill_notices.push(r.data);
        renderNoticeHistory();
        renderList();
        return r.data;
      });
  }

  function onNoticeAct(e) {
    var btn = e.target.closest('[data-nact]');
    if (!btn) return;
    var b = st.noticeBill;
    var text = $('#tbNoticeText').value;
    var act = btn.dataset.nact;
    if (act === 'sms') {
      var p = Store.phonesOf(b._student || {})[+btn.dataset.i];
      logNotice('sms').then(function (n) { toast(n.seq + '차 안내로 기록했습니다', 'good'); })
        .catch(function (x) { toast('기록하지 못했습니다 — ' + x.message, 'bad'); });
      location.href = smsHref(p.number, text);
      return;
    }
    var payload = act === 'link' ? linkOfBill(b) : text;
    UI.copyText(payload).then(function () { return logNotice(act); })
      .then(function (n) { toast((act === 'link' ? '링크' : '문구') + '를 복사했습니다 · ' + n.seq + '차 안내로 기록', 'good'); })
      .catch(function (x) { toast(x.message, 'bad'); });
  }

  function onNoticeHistoryClick(e) {
    var btn = e.target.closest('[data-ndel]');
    if (!btn) return;
    var b = st.noticeBill;
    sb().from('tb_bill_notices').delete().eq('id', btn.dataset.ndel).then(check).then(function () {
      b.tb_bill_notices = b.tb_bill_notices.filter(function (n) { return n.id !== btn.dataset.ndel; });
      renderNoticeHistory();
      renderList();
    }).catch(function (x) { toast('지우지 못했습니다 — ' + x.message, 'bad'); });
  }

  /* ============================================================
     선불 차액 정리
     ============================================================ */

  function loadDiff() {
    var host = $('#tbBlDiff');
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    sb().rpc('tb_diff_list', { p_month: st.month }).then(check).then(function (r) {
      var list = (r.data || []).filter(function (d) { return !st.cls || d.class_name === st.cls; });
      if (!list.length) {
        host.innerHTML = '<p class="panel__hint">' + TB.monthLabel(st.month) + '에 납부 완료된 선불 청구서가 없습니다.</p>';
        return;
      }
      var over = list[0].month_over;
      host.innerHTML = (over ? '' :
        '<div class="notice notice--warn" style="margin-top:0"><span class="notice__icon" aria-hidden="true">⏳</span>' +
        '<div class="notice__body">이 달 수업이 아직 끝나지 않았습니다. 실제 지급이 다 끝난 <b>월말에</b> 처리하세요.</div></div>') +
        '<div class="roster-scroll"><table class="roster tb-table"><thead><tr><th>학생</th><th class="tb-r">선불 청구</th>' +
        '<th class="tb-r">실제 지급</th><th class="tb-r">차액</th><th>처리</th></tr></thead><tbody>' +
        list.map(function (d) {
          var label, acts;
          if (d.diff_action) {
            label = d.diff_action === 'carry'
              ? (d.diff_amount === 0 ? '차액 없음' : '다음 달 반영 ' + TB.signedWon(d.diff_amount) + ' → ' +
                 (d.target_month ? TB.monthLabel(d.target_month) + ' 청구서'
                   : '다음 청구서를 만들 때 붙습니다' + (d.diff_amount < 0 ? ' (그 청구 금액보다 크면 붙지 않으니 그때는 되돌리고 [환불])' : '')))
              : d.diff_action === 'refund' ? '환불 ' + won(-d.diff_amount) + ' (' + (RF_STATUS[d.refund_status] || '취소됨') + ')'
              : '그냥 둠';
            acts = '<button class="btn btn--sm btn--ghost" data-dact="reset" data-id="' + d.bill_id + '">되돌리기</button>';
          } else if (d.diff === 0) {
            label = '<span class="muted-note">차액 없음</span>';
            acts = '<button class="btn btn--sm btn--ghost" data-dact="none" data-id="' + d.bill_id + '">확인</button>';
          } else {
            label = d.diff < 0 ? '<span class="muted-note">더 받음 — 돌려줄 돈</span>' : '<span class="muted-note">덜 받음 — 더 받을 돈</span>';
            acts = '<button class="btn btn--sm btn--primary" data-dact="carry" data-id="' + d.bill_id + '">다음 달 청구에서 ' + (d.diff < 0 ? '차감' : '추가') + '</button>' +
                   (d.diff < 0 ? '<button class="btn btn--sm" data-dact="refund" data-id="' + d.bill_id + '">환불</button>' : '') +
                   '<button class="btn btn--sm btn--ghost" data-dact="none" data-id="' + d.bill_id + '">그냥 두기</button>';
          }
          return '<tr><td><span class="roster__name">' + esc(d.name) + '</span><br><span class="muted-note">' + esc(d.class_name) + '</span></td>' +
            '<td class="tb-r num">' + won(d.billed) + '</td><td class="tb-r num">' + won(d.actual) + '</td>' +
            '<td class="tb-r num"><b class="' + (d.diff < 0 ? 'tb-neg' : '') + '">' + TB.signedWon(d.diff_action ? d.diff_amount : d.diff) + '</b></td>' +
            '<td>' + label + '<div class="tb-acts">' + acts + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { TB.errBox(host, e); });
  }

  function onDiffClick(e) {
    var btn = e.target.closest('[data-dact]');
    if (!btn) return;
    var act = btn.dataset.dact, id = btn.dataset.id;
    var p;
    if (act === 'reset') p = sb().rpc('tb_diff_reset', { p_bill: id });
    else if (act === 'refund') {
      p = UI.confirmAsk('차액 환불', '더 받은 금액을 환불 목록에 [요청]으로 올립니다. 돈을 돌려준 뒤 환불 화면에서 [완료 처리]하세요.', '환불 요청')
        .then(function (ok) { return ok ? sb().rpc('tb_diff_resolve', { p_bill: id, p_action: 'refund', p_method: 'transfer' }) : null; });
    } else p = sb().rpc('tb_diff_resolve', { p_bill: id, p_action: act, p_method: null });
    p.then(function (r) {
      if (!r) return;
      check(r);
      toast(act === 'reset' ? '되돌렸습니다' : '처리했습니다', 'good');
      reload();
    }).catch(function (x) { toast(x.message, 'bad'); });
  }

  /* ============================================================
     환불 등록 · 수정 (모달은 환불 화면과 같이 쓴다)
     ============================================================ */

  function openRefund(b, r) {
    var f = $('#tbRefundForm');
    f.dataset.bill = b ? b.id : r.bill_id;
    f.dataset.id = r ? r.id : '';
    var room = b ? refundRoom(b) : null;
    $('#tbRefundTitle').textContent = r ? '환불 고치기' : '환불 등록';
    $('#tbRefundDesc').textContent = b
      ? b._name + ' · ' + TB.monthLabel(b.month) + ' · 청구 ' + won(b.total) + ' · 환불 가능 ' + won(room)
      : (r._label || '');
    $('#tbRefundAmount').value = r ? r.amount : room;
    $('#tbRefundReason').value = r ? r.reason : '';
    $('#tbRefundMethod').value = r ? r.method : 'transfer';
    $('#tbRefundStatus').value = r ? (r.status === 'canceled' ? 'requested' : r.status) : 'requested';
    $('#tbRefundMemo').value = r ? r.memo || '' : '';
    $('#tbRefundError').classList.remove('is-on');
    $('#tbRefundModal').showModal();
  }

  function submitRefund(e) {
    e.preventDefault();
    var f = $('#tbRefundForm');
    var err = $('#tbRefundError');
    var amt = TB.toInt($('#tbRefundAmount').value);
    var reason = $('#tbRefundReason').value.trim();
    if (amt <= 0) { err.textContent = '환불 금액을 적어 주세요.'; err.classList.add('is-on'); return; }
    if (!reason) { err.textContent = '사유를 적어 주세요.'; err.classList.add('is-on'); return; }
    var row = {
      bill_id: f.dataset.bill, amount: amt, reason: reason,
      method: $('#tbRefundMethod').value, status: $('#tbRefundStatus').value,
      memo: $('#tbRefundMemo').value.trim()
    };
    var q = f.dataset.id
      ? sb().from('tb_refunds').update(row).eq('id', f.dataset.id)
      : sb().from('tb_refunds').insert(Object.assign({ created_by: UI.whoami() }, row));
    q.then(check).then(function () {
      $('#tbRefundModal').close();
      toast('환불을 저장했습니다', 'good');
      if (TB.state.sub === 'refund') loadRefunds(); else reload();
    }).catch(function (x) { err.textContent = x.message; err.classList.add('is-on'); });
  }

  TB.register('bill', { show: show });

  /* ============================================================
     환불 화면
     ============================================================ */

  var rf = { ready: false, list: [] };

  function showRefunds() {
    if (!rf.ready) {
      rf.ready = true;
      init();
      $('#tbRfStatus').addEventListener('change', renderRefunds);
      $('#tbRfList').addEventListener('click', onRefundListClick);
    }
    loadRefunds();
  }

  function loadRefunds() {
    var host = $('#tbRfList');
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    sb().from('tb_refunds').select('*, tb_bills(month,class_name,student_id,total)')
      .order('requested_at', { ascending: false }).limit(300)
      .then(check).then(function (r) {
        rf.list = (r.data || []).map(function (x) {
          var bl = x.tb_bills || {};
          var s = TB.student(bl.student_id);
          x._name = s ? s.name : '(학생)';
          x._label = x._name + ' · ' + (bl.class_name || '') + ' · ' + TB.monthLabel(bl.month) + ' 청구 ' + won(bl.total);
          return x;
        });
        renderRefunds();
      }).catch(function (e) { TB.errBox(host, e); });
  }

  function renderRefunds() {
    var host = $('#tbRfList');
    var f = $('#tbRfStatus').value;
    var list = rf.list.filter(function (r) { return !f || r.status === f; });
    var sum = function (s) { return rf.list.filter(function (r) { return r.status === s; }).reduce(function (a, r) { return a + r.amount; }, 0); };
    $('#tbRfSummary').innerHTML =
      '<div class="tb-card"><div class="tb-card__label">환불 요청 (진행 중)</div><div class="tb-card__val num">' + won(sum('requested')) + '</div></div>' +
      '<div class="tb-card"><div class="tb-card__label">환불 완료</div><div class="tb-card__val num">' + won(sum('done')) + '</div></div>';
    if (!list.length) {
      host.innerHTML = '<div class="empty-state">환불 기록이 없습니다.<br>환불 등록은 <b>청구·수납</b>의 완료된 청구서에서 <b>[환불]</b>을 누릅니다.</div>';
      return;
    }
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table"><thead><tr>' +
      '<th>요청일</th><th>학생 · 청구서</th><th class="tb-r">환불 금액</th><th>사유</th><th>방법</th><th>상태</th><th></th></tr></thead><tbody>' +
      list.map(function (r) {
        var bl = r.tb_bills || {};
        var acts = r.status === 'requested'
          ? '<button class="btn btn--sm btn--primary" data-ract="done">완료 처리</button>' +
            '<button class="btn btn--sm" data-ract="edit">고치기</button>' +
            '<button class="btn btn--sm btn--ghost" data-ract="cancel">취소</button>'
          : r.status === 'done'
            ? '<button class="btn btn--sm btn--ghost" data-ract="undo">요청으로 되돌리기</button>'
            : '';
        return '<tr data-id="' + r.id + '"' + (r.status === 'canceled' ? ' class="is-archived"' : '') + '>' +
          '<td class="num">' + esc(new Date(r.requested_at).toLocaleDateString('ko-KR')) + '</td>' +
          '<td><span class="roster__name">' + esc(r._name) + '</span><br><span class="muted-note">' +
            esc((bl.class_name || '') + ' · ' + TB.monthLabel(bl.month) + ' · 청구 ' + won(bl.total)) + '</span></td>' +
          '<td class="tb-r num"><b>' + won(r.amount) + '</b></td>' +
          '<td>' + esc(r.reason) + (r.source === 'diff' ? ' <span class="tb-badge">선불 차액</span>' : '') +
            (r.memo ? '<br><span class="muted-note">' + esc(r.memo) + '</span>' : '') + '</td>' +
          '<td>' + esc(TB.REFUND_METHOD[r.method] || r.method) + '</td>' +
          '<td><span class="tb-badge tb-badge--rf-' + r.status + '">' + RF_STATUS[r.status] + '</span>' +
            (r.done_at ? '<br><span class="muted-note">' + esc(fmtDT(r.done_at)) + '</span>' : '') + '</td>' +
          '<td class="roster__actions tb-acts">' + acts + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function onRefundListClick(e) {
    var btn = e.target.closest('[data-ract]');
    if (!btn) return;
    var r = rf.list.find(function (x) { return x.id === btn.closest('tr').dataset.id; });
    var act = btn.dataset.ract;
    if (act === 'edit') { openRefund(null, r); return; }
    var p;
    if (act === 'cancel' && r.source === 'diff') {
      p = UI.confirmAsk('차액 환불 취소', '선불 차액 처리를 되돌립니다. 청구·수납 화면의 차액 정리에서 다시 고를 수 있습니다.', '취소')
        .then(function (ok) { return ok ? sb().rpc('tb_diff_reset', { p_bill: r.bill_id }) : null; });
    } else {
      var next = { done: 'done', cancel: 'canceled', undo: 'requested' }[act];
      p = sb().from('tb_refunds').update({ status: next }).eq('id', r.id);
    }
    p.then(function (res) {
      if (!res) return;
      check(res);
      toast('바꿨습니다', 'good');
      loadRefunds();
    }).catch(function (x) { toast(x.message, 'bad'); });
  }

  TB.register('refund', { show: showRefunds });

})();
