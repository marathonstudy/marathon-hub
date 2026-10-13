/* ============================================================
   tb-dash.js — 교재 > 대시보드

   숫자는 전부 SQL 함수 tb_dashboard(월) 의 값이다.
   청구·수납 화면 위 요약, 학부모 화면과 같은 기준으로 계산된다.
   ============================================================ */

(function () {
  'use strict';

  var $ = TB.$, esc = TB.esc, sb = TB.sb, check = TB.check, won = TB.won;

  var ready = false;

  function show() {
    if (!ready) {
      ready = true;
      TB.fillMonthSelect($('#tbDbMonth'), TB.thisMonth(), 12, 3);
      $('#tbDbMonth').addEventListener('change', load);
      $('#tbDbRefresh').addEventListener('click', load);
      $('#tbDbBody').addEventListener('click', function (e) {
        var b = e.target.closest('[data-go]');
        if (b) TB.showSub(b.dataset.go);
      });
    }
    load();
  }

  function moneyTable(rows, first, firstLabel) {
    if (!rows.length) return '<p class="panel__hint">이 달 청구서가 없습니다.</p>';
    return '<div class="roster-scroll"><table class="roster tb-table"><thead><tr><th>' + firstLabel + '</th>' +
      (first === 'class' ? '<th>학원</th>' : '<th class="tb-r">반</th>') +
      '<th class="tb-r">청구서</th><th class="tb-r">청구</th><th class="tb-r">결제 완료</th><th class="tb-r">미결제</th><th class="tb-r">환불</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><span class="roster__name">' + esc((first === 'class' ? r.class_name : r.academy) || '(학원 없음)') + '</span></td>' +
          (first === 'class' ? '<td>' + esc(r.academy || '-') + '</td>' : '<td class="tb-r num">' + r.classes + '</td>') +
          '<td class="tb-r num">' + r.bills + '</td>' +
          '<td class="tb-r num">' + won(r.billed) + '</td>' +
          '<td class="tb-r num">' + won(r.paid) + '</td>' +
          '<td class="tb-r num"><b class="' + (r.unpaid ? 'tb-warn' : '') + '">' + won(r.unpaid) + '</b></td>' +
          '<td class="tb-r num">' + (r.refunded ? won(r.refunded) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function load() {
    var host = $('#tbDbBody');
    var m = $('#tbDbMonth').value;
    host.innerHTML = '<p class="panel__hint">불러오는 중…</p>';
    sb().rpc('tb_dashboard', { p_month: m }).then(check).then(function (r) {
      var d = r.data || {};
      var s = d.summary || {};
      var cards = [
        ['이번 달 청구 예정', s.billed, (s.bills || 0) + '건'],
        ['결제 완료', s.paid, ''],
        ['미결제', s.unpaid, (s.unpaid_n || 0) + '건'],
        ['환불', s.refunded, s.refund_wait ? '요청 중 ' + won(s.refund_wait) : '완료 기준'],
        ['실수납', s.net, '결제 완료 − 환불']
      ];
      host.innerHTML =
        '<div class="tb-cards">' + cards.map(function (c) {
          return '<div class="tb-card"><div class="tb-card__label">' + c[0] + '</div>' +
                 '<div class="tb-card__val num">' + won(c[1]) + '</div>' +
                 (c[2] ? '<div class="tb-card__sub">' + esc(c[2]) + '</div>' : '') + '</div>';
        }).join('') + '</div>' +

        ((d.unbilled_classes || []).length
          ? '<div class="notice notice--info"><span class="notice__icon" aria-hidden="true">🧾</span><div class="notice__body">' +
            '<b>' + TB.monthLabel(m) + ' 청구서를 아직 안 만든 반</b> — ' + d.unbilled_classes.map(esc).join(' · ') +
            '<div style="margin-top:8px"><button class="btn btn--sm btn--primary" type="button" data-go="bill">청구·수납으로</button></div></div></div>'
          : '') +

        '<div class="sub"><div class="sub__head"><span class="sub__title">학원별</span></div>' +
          moneyTable(d.by_academy || [], 'academy', '학원') + '</div>' +
        '<div class="sub"><div class="sub__head"><span class="sub__title">반별</span></div>' +
          moneyTable(d.by_class || [], 'class', '반') + '</div>' +

        '<div class="grid2 tb-dash-grid">' +
          '<div class="sub"><div class="sub__head"><span class="sub__title">재고 부족 교재</span>' +
            '<button class="btn btn--sm" type="button" data-go="stock">재고·주문</button></div>' +
            ((d.low_stock || []).length
              ? '<ul class="tb-mini">' + d.low_stock.map(function (b) {
                  return '<li><span class="roster__name">' + esc(b.name) + '</span>' +
                         '<span class="num">재고 <b class="' + (b.stock < 0 ? 'tb-neg' : 'tb-warn') + '">' + b.stock + '</b>' +
                         (b.min_stock ? ' / 안전 ' + b.min_stock : '') +
                         (b.short ? ' · 다음 수업에 ' + b.short + '부 모자람' : '') +
                         (b.incoming ? ' · 입고 예정 ' + b.incoming : '') + '</span></li>';
                }).join('') + '</ul>'
              : '<p class="panel__hint">부족한 교재가 없습니다.</p>') +
          '</div>' +
          '<div class="sub"><div class="sub__head"><span class="sub__title">주문 확정 대기</span>' +
            '<button class="btn btn--sm" type="button" data-go="stock">재고·주문</button></div>' +
            ((d.draft_orders || []).length
              ? '<ul class="tb-mini">' + d.draft_orders.map(function (o) {
                  return '<li><span>' + esc(new Date(o.created_at).toLocaleDateString('ko-KR')) +
                         ' <span class="muted-note">' + esc((o.created_by || '').split('@')[0]) + '</span>' +
                         (o.memo ? ' · ' + esc(o.memo) : '') + '</span>' +
                         '<span class="num">' + o.lines + '줄 · ' + o.qty + '부</span></li>';
                }).join('') + '</ul>'
              : '<p class="panel__hint">임시 저장한 주문이 없습니다.</p>') +
          '</div>' +
        '</div>';
    }).catch(function (e) { TB.errBox(host, e); });
  }

  TB.register('dash', { show: show });

})();
