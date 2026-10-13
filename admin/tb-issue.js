/* ============================================================
   tb-issue.js — 교재 > 지급

   회차형: 수업 날짜 × 학생 표. 칸을 누르면 바로 저장된다.
   단권  : 학생 × 단권 표.
   머리칸의 [전체] = 반 전체 일괄 지급 (다 받았으면 일괄 취소).
   지급 단가는 DB 트리거가 그 순간의 판매가로 고정한다.
   ============================================================ */

(function () {
  'use strict';

  var $ = TB.$, esc = TB.esc, sb = TB.sb, check = TB.check, toast = TB.toast;

  var st = { ready: false, cls: '', month: '', q: '', dates: [], rows: [], sess: {}, single: {}, busy: false };

  function key3(sid, bid, d) { return sid + '|' + bid + '|' + d; }
  function key2(sid, bid) { return sid + '|' + bid; }

  function init() {
    if (st.ready) return;
    st.ready = true;
    TB.fillMonthSelect($('#tbIsMonth'), TB.thisMonth(), 6, 3);
    $('#tbIsClass').addEventListener('change', reload);
    $('#tbIsMonth').addEventListener('change', reload);
    var timer;
    $('#tbIsSearch').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { st.q = e.target.value.trim(); render(); }, 150);
    });
    $('#tbIsSession').addEventListener('click', onSessionClick);
    $('#tbIsSingle').addEventListener('click', onSingleClick);
  }

  function show() {
    init();
    TB.fillClassSelect($('#tbIsClass'), st.cls || $('#tbIsClass').value);
    reload();
  }

  function reload() {
    st.cls = $('#tbIsClass').value;
    st.month = $('#tbIsMonth').value;
    var hosts = ['#tbIsSession', '#tbIsSingle'];
    if (!st.cls) {
      hosts.forEach(function (h) { $(h).innerHTML = '<div class="empty-state">반이 없습니다.</div>'; });
      return;
    }
    hosts.forEach(function (h) { $(h).innerHTML = '<p class="panel__hint">불러오는 중…</p>'; });

    var m0 = st.month, m1 = TB.nextMonthStart(m0);
    var c = sb();
    var singles = TB.booksOf(st.cls, 'single').map(function (b) { return b.id; });

    Promise.all([
      c.from('tb_class_dates').select('lesson_date').eq('class_name', st.cls)
        .gte('lesson_date', m0).lt('lesson_date', m1).order('lesson_date'),
      c.from('tb_issues').select('id,student_id,book_id,lesson_date,unit_price').eq('class_name', st.cls)
        .gte('lesson_date', m0).lt('lesson_date', m1)
    ]).then(function (res) {
      res.forEach(check);
      st.dates = res[0].data.map(function (r) { return r.lesson_date; });
      st.sess = {};
      var extra = {};
      res[1].data.forEach(function (r) {
        st.sess[key3(r.student_id, r.book_id, r.lesson_date)] = r;
        extra[r.student_id] = true;
      });

      /* 지금 이 반 학생 + 이 달 이 반에서 받은 기록이 있는 학생(퇴원·반 이동) */
      var rows = TB.activeStudentsOf(st.cls).map(function (s) { return { s: s, gone: false }; });
      var have = {};
      rows.forEach(function (r) { have[r.s.id] = true; });
      Object.keys(extra).forEach(function (id) {
        if (have[id]) return;
        var s = TB.student(id) || { id: id, name: '(지운 학생)' };
        rows.push({ s: s, gone: true });
      });
      st.rows = rows;

      if (!singles.length || !rows.length) return { data: [] };
      return c.from('tb_issues').select('id,student_id,book_id,unit_price,issued_on').is('lesson_date', null)
        .in('book_id', singles).in('student_id', rows.map(function (r) { return r.s.id; })).then(check);
    }).then(function (r) {
      st.single = {};
      r.data.forEach(function (x) { st.single[key2(x.student_id, x.book_id)] = x; });
      render();
    }).catch(function (e) { hosts.forEach(function (h) { TB.errBox($(h), e); }); });
  }

  function visibleRows() {
    if (!st.q) return st.rows;
    return st.rows.filter(function (r) { return (r.s.name || '').indexOf(st.q) !== -1; });
  }

  function activeIds() {
    return st.rows.filter(function (r) { return !r.gone; }).map(function (r) { return r.s.id; });
  }

  function render() {
    var sess = TB.booksOf(st.cls, 'session');
    var singles = TB.booksOf(st.cls, 'single');
    var all = TB.booksOf(st.cls);
    $('#tbIsPrice').textContent = all.length
      ? '지금 판매가 — ' + all.map(function (b) { return b.name + ' ' + TB.won(b.price); }).join(' · ') +
        '  (칸을 누르는 순간의 가격으로 기록됩니다)'
      : '';
    keepScroll($('#tbIsSession'), function () { renderSession(sess); });
    keepScroll($('#tbIsSingle'), function () { renderSingle(singles); });
  }

  /* 다시 그려도 옆으로 넘겨 둔 위치는 그대로 */
  function keepScroll(host, fn) {
    var sc = host.querySelector('.roster-scroll');
    var x = sc ? sc.scrollLeft : 0;
    fn();
    sc = host.querySelector('.roster-scroll');
    if (sc) sc.scrollLeft = x;
  }

  function nameCell(r) {
    return '<td class="tb-stu"><span class="roster__name">' + esc(r.s.name) + '</span>' +
           (r.gone ? ' <span class="link-tag link-tag--off">' + (r.s.archived ? '퇴원' : '반 이동') + '</span>' : '') + '</td>';
  }

  function renderSession(books) {
    var host = $('#tbIsSession');
    if (!books.length) {
      host.innerHTML = '<div class="empty-state">이 반에 연결된 회차형 교재가 없습니다.<br><b>설정</b>에서 이 반이 쓰는 교재를 켜 주세요.</div>';
      return;
    }
    if (!st.dates.length) {
      host.innerHTML = '<div class="empty-state">이 반의 ' + TB.monthLabel(st.month) + ' 수업 날짜가 없습니다.<br><b>일정</b>에서 날짜를 추가해 주세요.</div>';
      return;
    }
    var rows = visibleRows();
    if (!st.rows.length) { host.innerHTML = '<div class="empty-state">이 반에 학생이 없습니다.</div>'; return; }

    var ids = activeIds();
    var head1 = '<tr><th rowspan="2" class="tb-stu">학생</th>' + st.dates.map(function (d) {
      return '<th colspan="' + books.length + '" class="tb-date">' + esc(Store.dateWithDow(d)) +
             ' <button class="btn btn--sm btn--ghost tb-bulk" type="button" data-date="' + d + '" title="이 날짜 교재 전체를 반 전체에">전체</button></th>';
    }).join('') + '<th rowspan="2" class="tb-r">합계</th></tr>';
    var head2 = '<tr>' + st.dates.map(function (d) {
      return books.map(function (b) {
        var n = ids.filter(function (sid) { return st.sess[key3(sid, b.id, d)]; }).length;
        return '<th class="tb-bk"><button class="tb-bk-btn" type="button" data-date="' + d + '" data-book="' + b.id + '" title="이 교재를 반 전체에">' +
               esc(b.name) + '<span class="tb-bk-n">' + n + '/' + ids.length + '</span></button></th>';
      }).join('');
    }).join('') + '</tr>';

    var body = rows.map(function (r) {
      var cnt = 0;
      var cells = st.dates.map(function (d) {
        return books.map(function (b) {
          var it = st.sess[key3(r.s.id, b.id, d)];
          if (it) cnt++;
          return '<td class="tb-c"><button type="button" class="tb-cell' + (it ? ' is-on' : '') + '"' +
                 ' data-sid="' + r.s.id + '" data-book="' + b.id + '" data-date="' + d + '"' +
                 (it ? ' title="' + TB.won(it.unit_price) + '"' : '') +
                 ' aria-pressed="' + (it ? 'true' : 'false') + '" aria-label="' + esc(r.s.name + ' ' + b.name + ' ' + d) + '">' +
                 (it ? '✓' : '') + '</button></td>';
        }).join('');
      }).join('');
      return '<tr' + (r.gone ? ' class="is-archived"' : '') + '>' + nameCell(r) + cells + '<td class="tb-r num">' + cnt + '</td></tr>';
    }).join('');

    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table tb-grid">' +
      '<thead>' + head1 + head2 + '</thead><tbody>' + (body || '<tr><td colspan="99" class="muted-note">검색 결과가 없습니다</td></tr>') +
      '</tbody></table></div>';
  }

  function renderSingle(books) {
    var host = $('#tbIsSingle');
    if (!books.length) {
      host.innerHTML = '<div class="empty-state">이 반에 연결된 단권 교재가 없습니다.</div>';
      return;
    }
    if (!st.rows.length) { host.innerHTML = '<div class="empty-state">이 반에 학생이 없습니다.</div>'; return; }
    var ids = activeIds();
    var head = '<tr><th class="tb-stu">학생</th>' + books.map(function (b) {
      var n = ids.filter(function (sid) { return st.single[key2(sid, b.id)]; }).length;
      return '<th class="tb-bk"><button class="tb-bk-btn" type="button" data-book="' + b.id + '" title="반 전체에">' +
             esc(b.name) + '<span class="tb-bk-n">' + n + '/' + ids.length + '</span></button></th>';
    }).join('') + '</tr>';
    var body = visibleRows().map(function (r) {
      return '<tr' + (r.gone ? ' class="is-archived"' : '') + '>' + nameCell(r) + books.map(function (b) {
        var it = st.single[key2(r.s.id, b.id)];
        return '<td class="tb-c"><button type="button" class="tb-cell' + (it ? ' is-on' : '') + '"' +
               ' data-sid="' + r.s.id + '" data-book="' + b.id + '"' +
               (it ? ' title="' + esc(TB.won(it.unit_price) + ' · ' + Store.shortDate(it.issued_on) + ' 지급') + '"' : '') +
               ' aria-pressed="' + (it ? 'true' : 'false') + '">' + (it ? '✓' : '') + '</button></td>';
      }).join('') + '</tr>';
    }).join('');
    host.innerHTML = '<div class="roster-scroll"><table class="roster tb-table tb-grid">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ---------- 한 칸 ---------- */

  function toggleOne(btn, map, k, row) {
    if (btn.disabled) return;
    var it = map[k];
    btn.disabled = true;
    var p = it
      ? sb().from('tb_issues').delete().eq('id', it.id).then(check).then(function () { delete map[k]; })
      : sb().from('tb_issues').insert(row).select('id,student_id,book_id,lesson_date,unit_price,issued_on').single()
          .then(check).then(function (r) { map[k] = r.data; });
    p.then(function () { btn.disabled = false; render(); })
     .catch(function (e) {
       btn.disabled = false;
       toast(/duplicate/.test(e.message) ? '이미 지급된 칸입니다. 새로고침합니다' : '저장하지 못했습니다 — ' + e.message, 'bad');
       reload();
     });
  }

  function onSessionClick(e) {
    var cell = e.target.closest('.tb-cell');
    if (cell) {
      var d = cell.dataset.date;
      toggleOne(cell, st.sess, key3(cell.dataset.sid, cell.dataset.book, d),
        { student_id: cell.dataset.sid, book_id: cell.dataset.book, class_name: st.cls, lesson_date: d });
      return;
    }
    var bk = e.target.closest('.tb-bk-btn');
    if (bk) { bulk(bk.dataset.date, [bk.dataset.book]); return; }
    var all = e.target.closest('.tb-bulk');
    if (all) bulk(all.dataset.date, TB.booksOf(st.cls, 'session').map(function (b) { return b.id; }));
  }

  function onSingleClick(e) {
    var cell = e.target.closest('.tb-cell');
    if (cell) {
      toggleOne(cell, st.single, key2(cell.dataset.sid, cell.dataset.book),
        { student_id: cell.dataset.sid, book_id: cell.dataset.book, class_name: st.cls });
      return;
    }
    var bk = e.target.closest('.tb-bk-btn');
    if (bk) bulk(null, [bk.dataset.book]);
  }

  /* ---------- 반 전체 일괄 ---------- */

  function bulk(date, bookIds) {
    if (st.busy) return;
    var ids = activeIds();
    if (!ids.length) return;
    var has = function (sid, bid) { return date ? st.sess[key3(sid, bid, date)] : st.single[key2(sid, bid)]; };
    var full = ids.every(function (sid) { return bookIds.every(function (bid) { return has(sid, bid); }); });
    var names = bookIds.map(function (id) { return (TB.book(id) || {}).name; }).join(' · ');
    var where = (date ? Store.dateWithDow(date) + ' ' : '') + names;

    var go = full
      ? UI.confirmAsk('일괄 취소', st.cls + ' 반 ' + ids.length + '명의 ' + where + ' 지급 표시를 모두 지웁니다.', '모두 취소')
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      st.busy = true;
      return sb().rpc('tb_issue_bulk', {
        p_class: st.cls, p_date: date, p_books: bookIds, p_students: ids, p_on: !full
      }).then(check).then(function (r) {
        st.busy = false;
        toast(full ? where + ' 일괄 취소 (' + r.data + '건)' : where + ' 반 전체 지급 (' + r.data + '건 새로 저장)', 'good');
        reload();
      });
    }).catch(function (e) { st.busy = false; toast('저장하지 못했습니다 — ' + e.message, 'bad'); });
  }

  /* 다른 기기에서 지급 칸을 누르면 (실시간) 이 표를 새로 받는다. 옆으로 넘긴 위치는 그대로. */
  TB.register('issue', { show: show, refresh: function () { if (st.ready && st.cls && !st.busy) reload(); } });

})();
