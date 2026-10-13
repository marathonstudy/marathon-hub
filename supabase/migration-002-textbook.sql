-- ============================================================
--  마라톤국어 허브 — 2단계 교재 관리 (migration-002-textbook.sql)
--
--  실행 방법
--    schema.sql 을 이미 실행한 프로젝트에서
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--
--  여러 번 실행해도 안전하다 (있으면 건너뛰고, 함수·정책은 새로 만든다).
--  1단계 표(students, published …)는 고치지 않는다. 새 표만 더한다.
--
--  지키는 규칙 (schema.sql 과 같다)
--    1. 새 표 전부 RLS 를 켜고 staff 에 등록된 사람만 읽고 쓴다.
--    2. 학부모 화면은 표를 직접 읽지 않는다. hub_textbook(개인링크코드) 만 부른다.
--       그 학생의 청구 내역만 돌려주고, 공급가·재고·다른 학생은 절대 돌려주지 않는다.
--    3. 금액은 전부 원 단위 정수(integer). 합계는 이 파일의 함수가 계산하고
--       화면은 그 값을 그대로 보여 준다 → 화면과 함수가 다를 수 없다.
--    4. 계좌번호는 이 파일에 없다. 생성기 화면에서 입력하면
--       app_settings 표의 'textbook_bank' 줄에 저장된다.
--
--  표 이름은 모두 tb_ 로 시작한다.
-- ============================================================


-- ------------------------------------------------------------
--  0. 공통
-- ------------------------------------------------------------

/* 한국 날짜 기준 '오늘'. 서버 시계는 UTC 라서 새벽 0~9시에 하루가 어긋나는 것을 막는다. */
create or replace function public._tb_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

/* 그 달 1일로 맞춘다 */
create or replace function public._tb_month(d date)
returns date
language sql
immutable
as $$
  select date_trunc('month', d::timestamp)::date;
$$;


-- ------------------------------------------------------------
--  1. 학원 · 반-학원 연결
--     반 이름(students.class_name)은 그대로 두고, 반 이름에 학원을 붙인다.
-- ------------------------------------------------------------
create table if not exists public.tb_academies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint tb_academies_name_not_blank check (length(btrim(name)) > 0)
);
create unique index if not exists tb_academies_name_key on public.tb_academies (name);

create table if not exists public.tb_class_academy (
  class_name  text primary key,
  academy_id  uuid references public.tb_academies(id) on delete set null,
  updated_at  timestamptz not null default now(),

  constraint tb_class_academy_name_not_blank check (length(btrim(class_name)) > 0)
);


-- ------------------------------------------------------------
--  2. 교재
--     kind  session = 회차형 (수업 날짜마다 한 부: 모의고사·주간지)
--           single  = 단권   (학생마다 한 권)
--     price = 학생 판매가, cost = 공급가 (학부모 화면에 절대 나가지 않는다)
--     min_stock = 이 수 이하로 떨어지면 대시보드에 '재고 부족'
-- ------------------------------------------------------------
create table if not exists public.tb_books (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'session',
  price       integer not null default 0,
  supplier    text not null default '',
  cost        integer not null default 0,
  min_stock   integer not null default 0,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint tb_books_name_not_blank check (length(btrim(name)) > 0),
  constraint tb_books_kind_check  check (kind in ('session', 'single')),
  constraint tb_books_price_check check (price >= 0 and cost >= 0 and min_stock >= 0)
);

drop trigger if exists tb_books_touch on public.tb_books;
create trigger tb_books_touch before update on public.tb_books
  for each row execute function public.touch_updated_at();

/* 반마다 쓰는 교재 (목동·반포 = 한수 모의고사 + 오일장 주간지, 고2 선수능반 = 다른 교재 …) */
create table if not exists public.tb_class_books (
  class_name  text not null,
  book_id     uuid not null references public.tb_books(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (class_name, book_id)
);


-- ------------------------------------------------------------
--  3. 일정 — 반별 수업 날짜. 같은 반 같은 날짜는 한 줄만.
-- ------------------------------------------------------------
create table if not exists public.tb_class_dates (
  id           uuid primary key default gen_random_uuid(),
  class_name   text not null,
  lesson_date  date not null,
  created_at   timestamptz not null default now(),

  constraint tb_class_dates_name_not_blank check (length(btrim(class_name)) > 0)
);
create unique index if not exists tb_class_dates_key on public.tb_class_dates (class_name, lesson_date);
create index        if not exists tb_class_dates_date_idx on public.tb_class_dates (lesson_date);


-- ------------------------------------------------------------
--  4. 지급 기록
--     unit_price 는 지급하는 순간의 판매가로 고정된다 (트리거가 채운다).
--     나중에 교재 가격을 바꿔도 이미 지급한 기록은 바뀌지 않는다.
--     issued_on = 정산 기준일. 회차형은 수업 날짜, 단권은 체크한 날.
--     학생을 지우지 못하게 on delete restrict (퇴원 처리하면 기록은 남는다).
-- ------------------------------------------------------------
create table if not exists public.tb_issues (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete restrict,
  book_id      uuid not null references public.tb_books(id) on delete restrict,
  class_name   text not null default '',
  lesson_date  date,
  issued_on    date not null default public._tb_today(),
  qty          integer not null default 1,
  unit_price   integer,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),

  constraint tb_issues_qty_check   check (qty > 0),
  constraint tb_issues_price_check check (unit_price is null or unit_price >= 0)
);
/* 회차형: (학생, 교재, 수업 날짜) 한 줄 / 단권: (학생, 교재) 한 줄 */
create unique index if not exists tb_issues_session_key on public.tb_issues (student_id, book_id, lesson_date)
  where lesson_date is not null;
create unique index if not exists tb_issues_single_key  on public.tb_issues (student_id, book_id)
  where lesson_date is null;
create index if not exists tb_issues_issued_idx  on public.tb_issues (issued_on);
create index if not exists tb_issues_book_idx    on public.tb_issues (book_id);

create or replace function public._tb_issue_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_price is null then
    select price into new.unit_price from public.tb_books where id = new.book_id;
  end if;
  if new.lesson_date is not null then
    new.issued_on := new.lesson_date;
  end if;
  if coalesce(new.class_name, '') = '' then
    select class_name into new.class_name from public.students where id = new.student_id;
    new.class_name := coalesce(new.class_name, '');
  end if;
  new.created_by := coalesce(nullif(new.created_by, ''), lower(coalesce(auth.jwt() ->> 'email', '')));
  return new;
end;
$$;

drop trigger if exists tb_issues_fill on public.tb_issues;
create trigger tb_issues_fill before insert on public.tb_issues
  for each row execute function public._tb_issue_fill();


-- ------------------------------------------------------------
--  5. 주문 · 입고 · 재고 조정
--     현재 재고 = 입고 합계 − 지급 합계 + 반품·조정(±)
-- ------------------------------------------------------------
create table if not exists public.tb_orders (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'draft',      -- draft 임시 | confirmed 확정 | received 입고 | canceled 취소
  memo          text not null default '',
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  received_at   timestamptz,
  updated_at    timestamptz not null default now(),

  constraint tb_orders_status_check check (status in ('draft', 'confirmed', 'received', 'canceled'))
);

drop trigger if exists tb_orders_touch on public.tb_orders;
create trigger tb_orders_touch before update on public.tb_orders
  for each row execute function public.touch_updated_at();

create table if not exists public.tb_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.tb_orders(id) on delete cascade,
  book_id       uuid not null references public.tb_books(id) on delete restrict,
  class_name    text not null default '',
  next_date     date,
  needed        integer not null default 0,
  suggested     integer not null default 0,
  qty           integer not null default 0,

  constraint tb_order_lines_qty_check check (qty >= 0 and needed >= 0 and suggested >= 0)
);
create index if not exists tb_order_lines_order_idx on public.tb_order_lines (order_id);

create table if not exists public.tb_stock_moves (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.tb_books(id) on delete restrict,
  kind        text not null,                        -- receive 입고(+) | return 반품(−) | adjust 조정(±)
  qty         integer not null,
  reason      text not null default '',
  order_id    uuid references public.tb_orders(id) on delete set null,
  moved_on    date not null default public._tb_today(),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),

  constraint tb_stock_moves_kind_check check (kind in ('receive', 'return', 'adjust')),
  constraint tb_stock_moves_qty_check  check (qty <> 0),
  constraint tb_stock_moves_sign_check check (
    (kind = 'receive' and qty > 0) or (kind = 'return' and qty < 0) or kind = 'adjust')
);
create index if not exists tb_stock_moves_book_idx on public.tb_stock_moves (book_id);


-- ------------------------------------------------------------
--  6. 청구
--
--  tb_bill_plans  반·월마다 청구 방식
--     pre  선불 = 그 달 예정 수업 날짜 수 × 그 반 회차형 교재 + 그 달 예정 단권
--     post 후불 = 그 달 실제 지급 기록 (지급 당시 가격)
--
--  tb_bills  학생 × 월 청구서 (한 학생 한 달에 한 장)
--     items        청구 품목. 만드는 순간 고정된다 [{book_id,name,kind,qty,unit_price,amount}]
--     items_total  품목 합계 (트리거가 qty × unit_price 로 다시 계산한다)
--     carry_in     지난 선불 달의 차액 (+ 더 받을 돈 / − 돌려줄 돈)
--     adjust       직접 조정 (중도 입반 등) + adjust_reason
--     total        = items_total + carry_in + adjust  (자동 계산 칸)
--     status       unpaid 미납 | paid 완료 | waived 면제
--
--     선불 차액 (월말에 실제 지급과 비교)
--     diff_amount  = 실제 지급액 − (items_total + adjust)   + 덜 받음 / − 더 받음
--     diff_action  carry  다음 달 청구에 반영 → 그 청구서가 diff_target_bill
--                  refund 환불 (tb_refunds 에 '요청' 한 줄)
--                  none   그냥 두기
--
--     결제선생 연동 자리 (지금은 비워 둔다)
--     pay_link · provider_ref · provider_raw
--     나중에 파트너 API 계약 후 Edge Function(콜백)이 provider_ref 로 청구서를 찾아
--     status='paid', pay_method='payssam', paid_at, provider_raw 를 채우면 된다.
-- ------------------------------------------------------------
create table if not exists public.tb_bill_plans (
  class_name       text not null,
  month            date not null,
  mode             text not null default 'post',
  single_book_ids  uuid[] not null default '{}',
  updated_by       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (class_name, month),

  constraint tb_bill_plans_mode_check  check (mode in ('pre', 'post')),
  constraint tb_bill_plans_month_check check (extract(day from month) = 1)
);

drop trigger if exists tb_bill_plans_touch on public.tb_bill_plans;
create trigger tb_bill_plans_touch before update on public.tb_bill_plans
  for each row execute function public.touch_updated_at();

create table if not exists public.tb_bills (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete restrict,
  month             date not null,
  class_name        text not null default '',
  mode              text not null default 'post',
  items             jsonb not null default '[]'::jsonb,
  items_total       integer not null default 0,
  carry_in          integer not null default 0,
  adjust            integer not null default 0,
  adjust_reason     text not null default '',
  total             integer generated always as (items_total + carry_in + adjust) stored,
  status            text not null default 'unpaid',
  paid_at           timestamptz,
  pay_method        text,
  pay_memo          text not null default '',
  receipt_path      text not null default '',
  pay_link          text not null default '',
  provider_ref      text not null default '',
  provider_raw      jsonb,
  diff_amount       integer,
  diff_action       text,
  diff_done_at      timestamptz,
  diff_target_bill  uuid references public.tb_bills(id) on delete set null,
  created_by        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tb_bills_month_check  check (extract(day from month) = 1),
  constraint tb_bills_mode_check   check (mode in ('pre', 'post')),
  constraint tb_bills_status_check check (status in ('unpaid', 'paid', 'waived')),
  constraint tb_bills_method_check check (pay_method is null or pay_method in ('transfer', 'card', 'payssam')),
  constraint tb_bills_diff_check   check (diff_action is null or diff_action in ('carry', 'refund', 'none'))
);
create unique index if not exists tb_bills_student_month_key on public.tb_bills (student_id, month);
create index        if not exists tb_bills_month_idx         on public.tb_bills (month);
create index        if not exists tb_bills_target_idx        on public.tb_bills (diff_target_bill);

/* 품목 합계는 항상 qty × unit_price 의 합. 화면이 보낸 값을 믿지 않는다. */
create or replace function public._tb_bill_fill()
returns trigger
language plpgsql
as $$
begin
  new.items := coalesce((
    select jsonb_agg(e || jsonb_build_object(
             'qty',        (e ->> 'qty')::int,
             'unit_price', (e ->> 'unit_price')::int,
             'amount',     (e ->> 'qty')::int * (e ->> 'unit_price')::int))
    from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) e
  ), '[]'::jsonb);
  new.items_total := coalesce((
    select sum((e ->> 'amount')::int) from jsonb_array_elements(new.items) e
  ), 0);
  if new.items_total + new.carry_in + new.adjust < 0 then
    raise exception '청구 금액이 0원보다 작아질 수 없습니다 (품목 %원, 지난 차액 %원, 조정 %원). 돌려줄 돈은 [환불]로 처리하세요.',
      new.items_total, new.carry_in, new.adjust;
  end if;
  if new.status <> 'paid' then
    new.paid_at := null;
    new.pay_method := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tb_bills_fill on public.tb_bills;
create trigger tb_bills_fill before insert or update on public.tb_bills
  for each row execute function public._tb_bill_fill();


-- ------------------------------------------------------------
--  7. 납부 안내 발송 기록 — 보낼 때마다 한 줄 (N차는 트리거가 매긴다)
-- ------------------------------------------------------------
create table if not exists public.tb_bill_notices (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references public.tb_bills(id) on delete cascade,
  seq       integer not null default 0,
  via       text not null default 'copy',          -- sms 문자 | copy 문구 복사 | link 링크 복사
  sent_by   text not null default '',
  sent_at   timestamptz not null default now(),

  constraint tb_bill_notices_via_check check (via in ('sms', 'copy', 'link'))
);
create index if not exists tb_bill_notices_bill_idx on public.tb_bill_notices (bill_id);

create or replace function public._tb_notice_seq()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.bill_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.tb_bill_notices where bill_id = new.bill_id;
  new.sent_by := coalesce(nullif(new.sent_by, ''), lower(coalesce(auth.jwt() ->> 'email', '')));
  return new;
end;
$$;

drop trigger if exists tb_bill_notices_seq on public.tb_bill_notices;
create trigger tb_bill_notices_seq before insert on public.tb_bill_notices
  for each row execute function public._tb_notice_seq();


-- ------------------------------------------------------------
--  8. 환불 — 청구서 단위. 전액·부분, 금액은 직접 입력.
--     status requested 요청 → done 완료 (canceled 취소)
--     수납액 = 완료 청구 합계 − 완료 환불 합계
-- ------------------------------------------------------------
create table if not exists public.tb_refunds (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.tb_bills(id) on delete restrict,
  amount        integer not null,
  reason        text not null default '',
  method        text not null default 'transfer',  -- transfer 계좌이체 | card 카드 취소 | cash 현금 | payssam 결제선생 취소
  status        text not null default 'requested',
  source        text not null default 'manual',    -- manual 직접 | diff 선불 차액
  memo          text not null default '',
  requested_at  timestamptz not null default now(),
  done_at       timestamptz,
  created_by    text not null default '',
  updated_at    timestamptz not null default now(),

  constraint tb_refunds_amount_check check (amount > 0),
  constraint tb_refunds_method_check check (method in ('transfer', 'card', 'cash', 'payssam')),
  constraint tb_refunds_status_check check (status in ('requested', 'done', 'canceled')),
  constraint tb_refunds_source_check check (source in ('manual', 'diff'))
);
create index if not exists tb_refunds_bill_idx on public.tb_refunds (bill_id);

/* 환불은 완료된 청구서에만, 그 청구서 금액까지만 */
create or replace function public._tb_refund_check()
returns trigger
language plpgsql
as $$
declare
  b record;
  used integer;
begin
  select status, total into b from public.tb_bills where id = new.bill_id;
  if b.status is distinct from 'paid' then
    raise exception '납부 완료된 청구서만 환불할 수 있습니다.';
  end if;
  if new.status <> 'canceled' then
    select coalesce(sum(amount), 0) into used
    from public.tb_refunds
    where bill_id = new.bill_id and status <> 'canceled' and id <> new.id;
    if used + new.amount > greatest(b.total, 0) then
      raise exception '환불 합계(%원)가 청구 금액(%원)보다 큽니다.', used + new.amount, b.total;
    end if;
  end if;
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  new.created_by := coalesce(nullif(new.created_by, ''), lower(coalesce(auth.jwt() ->> 'email', '')));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tb_refunds_check on public.tb_refunds;
create trigger tb_refunds_check before insert or update on public.tb_refunds
  for each row execute function public._tb_refund_check();


-- ------------------------------------------------------------
--  9. 납부 캡처 보관함 (Storage, 비공개) — staff 만 올리고 본다
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tb-receipts', 'tb-receipts', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists tb_receipts_staff_select on storage.objects;
drop policy if exists tb_receipts_staff_insert on storage.objects;
drop policy if exists tb_receipts_staff_update on storage.objects;
drop policy if exists tb_receipts_staff_delete on storage.objects;
create policy tb_receipts_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'tb-receipts' and public.is_staff());
create policy tb_receipts_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tb-receipts' and public.is_staff());
create policy tb_receipts_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'tb-receipts' and public.is_staff());
create policy tb_receipts_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tb-receipts' and public.is_staff());


-- ============================================================
--  RLS — staff 에 등록된 사람만 읽고 쓴다 (schema.sql 과 같은 방식)
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'tb_academies','tb_class_academy','tb_books','tb_class_books','tb_class_dates',
    'tb_issues','tb_orders','tb_order_lines','tb_stock_moves',
    'tb_bill_plans','tb_bills','tb_bill_notices','tb_refunds'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_staff_all', t
    );
  end loop;
end;
$$;


-- ============================================================
--  계산 함수 — 생성기(staff)가 부른다
--
--  security invoker (기본값) : 부르는 사람의 권한으로 표를 읽는다.
--  staff 가 아니면 RLS 때문에 빈 결과만 나온다.
--  그래도 혹시 모르니 맨 앞에서 is_staff() 를 한 번 더 본다.
-- ============================================================

create or replace function public._tb_need_staff()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_staff() then
    raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.';
  end if;
end;
$$;

/* 교재 기록(지급·청구)이 있어 지울 수 없는 학생.
   명단 저장(1단계)이 이 학생들은 지우지 않고 남긴다. */
create or replace function public.tb_locked_students()
returns setof uuid
language sql
stable
as $$
  select student_id from public.tb_issues
  union
  select student_id from public.tb_bills;
$$;


/* ---------- 지급 ---------- */

/* 반 전체 일괄 지급 / 일괄 취소.
   p_date 가 있으면 회차형(그 수업 날짜), 없으면 단권. */
create or replace function public.tb_issue_bulk(
  p_class text, p_date date, p_books uuid[], p_students uuid[], p_on boolean)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform public._tb_need_staff();
  if p_on then
    insert into public.tb_issues (student_id, book_id, class_name, lesson_date, issued_on)
    select sid, bid, coalesce(p_class, ''), p_date, coalesce(p_date, public._tb_today())
    from unnest(p_students) as s(sid) cross join unnest(p_books) as b(bid)
    on conflict do nothing;
  else
    delete from public.tb_issues
    where student_id = any(p_students) and book_id = any(p_books)
      and lesson_date is not distinct from p_date;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;


/* ---------- 재고 ---------- */

create or replace function public.tb_stock()
returns table (
  book_id uuid, name text, kind text, supplier text, active boolean, min_stock integer,
  received integer, issued integer, adjusted integer, stock integer, incoming integer)
language sql
stable
as $$
  select b.id, b.name, b.kind, b.supplier, b.active, b.min_stock,
         coalesce(m.received, 0)::int,
         coalesce(i.issued, 0)::int,
         coalesce(m.adjusted, 0)::int,
         (coalesce(m.received, 0) + coalesce(m.adjusted, 0) - coalesce(i.issued, 0))::int,
         coalesce(o.incoming, 0)::int
  from public.tb_books b
  left join (
    select book_id,
           sum(qty) filter (where kind = 'receive') as received,
           sum(qty) filter (where kind <> 'receive') as adjusted
    from public.tb_stock_moves group by book_id
  ) m on m.book_id = b.id
  left join (select book_id, sum(qty) as issued from public.tb_issues group by book_id) i on i.book_id = b.id
  left join (
    select l.book_id, sum(l.qty) as incoming
    from public.tb_order_lines l join public.tb_orders o on o.id = l.order_id
    where o.status = 'confirmed'
    group by l.book_id
  ) o on o.book_id = b.id
  order by b.active desc, b.kind, b.sort_order, b.name;
$$;

/* 주문 권장 부수
   반마다 다음 수업 날짜(오늘 포함)를 찾고,
     회차형: 필요 = 재원 학생 수
     단권  : 필요 = 아직 그 단권을 받지 않은 재원 학생 수
   (현재 재고 + 확정했지만 아직 안 들어온 주문) 을 다음 수업이 빠른 반부터 나눠 주고,
   모자라는 만큼이 권장 부수다. 실제 주문 부수는 화면에서 반마다 고친다. */
create or replace function public.tb_order_suggest()
returns table (
  class_name text, academy text, next_date date, book_id uuid, book_name text, kind text,
  supplier text, students integer, needed integer, stock integer, incoming integer, suggested integer)
language sql
stable
as $$
  with act as (
    select s.id, s.class_name from public.students s
    where not s.archived and btrim(s.class_name) <> ''
  ),
  nx as (
    select d.class_name, min(d.lesson_date) as next_date
    from public.tb_class_dates d
    where d.lesson_date >= public._tb_today()
    group by d.class_name
  ),
  need as (
    select cb.class_name, nx.next_date, b.id as book_id, b.name as book_name, b.kind, b.supplier, b.sort_order,
           (select count(*) from act a where a.class_name = cb.class_name)::int as students,
           case when b.kind = 'session'
                then (select count(*) from act a where a.class_name = cb.class_name)
                else (select count(*) from act a where a.class_name = cb.class_name
                        and not exists (select 1 from public.tb_issues i
                                        where i.student_id = a.id and i.book_id = b.id))
           end::int as needed
    from public.tb_class_books cb
    join public.tb_books b on b.id = cb.book_id and b.active
    join nx on nx.class_name = cb.class_name
  ),
  st as (select * from public.tb_stock()),
  cum as (
    select n.*, coalesce(st.stock, 0) as stock, coalesce(st.incoming, 0) as incoming,
           greatest(coalesce(st.stock, 0) + coalesce(st.incoming, 0), 0) as avail,
           sum(n.needed) over (partition by n.book_id order by n.next_date, n.class_name
                               rows between unbounded preceding and current row) as need_cum
    from need n left join st on st.book_id = n.book_id
  )
  select c.class_name, coalesce(a.name, ''), c.next_date, c.book_id, c.book_name, c.kind, c.supplier,
         c.students, c.needed, c.stock, c.incoming,
         greatest(0, least(c.needed, c.need_cum - c.avail))::int
  from cum c
  left join public.tb_class_academy ca on ca.class_name = c.class_name
  left join public.tb_academies a on a.id = ca.academy_id
  order by c.next_date, c.class_name, c.kind, c.sort_order, c.book_name;
$$;

/* 입고 처리 — p_lines [{"book_id":"…","qty":12}]. 입고 기록을 남기고 주문을 '입고'로 바꾼다. */
create or replace function public.tb_order_receive(p_order uuid, p_lines jsonb)
returns integer
language plpgsql
as $$
declare
  o record;
  n integer := 0;
  e jsonb;
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public._tb_need_staff();
  select * into o from public.tb_orders where id = p_order for update;
  if not found then raise exception '주문을 찾지 못했습니다.'; end if;
  if o.status <> 'confirmed' then raise exception '확정된 주문만 입고 처리할 수 있습니다.'; end if;

  for e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((e ->> 'qty')::int, 0) > 0 then
      insert into public.tb_stock_moves (book_id, kind, qty, reason, order_id, created_by)
      values ((e ->> 'book_id')::uuid, 'receive', (e ->> 'qty')::int, '주문 입고', p_order, who);
      n := n + 1;
    end if;
  end loop;

  update public.tb_orders set status = 'received', received_at = now() where id = p_order;
  return n;
end;
$$;


/* ---------- 청구 ---------- */

/* 학생 한 명, 한 달의 청구 품목. 미리보기와 생성이 이 함수 하나를 같이 쓴다. */
create or replace function public._tb_bill_items(
  p_student uuid, p_class text, p_month date, p_mode text, p_singles uuid[])
returns jsonb
language sql
stable
as $$
  with m as (select public._tb_month(p_month) as m0,
                    (public._tb_month(p_month) + interval '1 month')::date as m1),
  dates as (
    select count(*)::int as n from public.tb_class_dates d, m
    where d.class_name = p_class and d.lesson_date >= m.m0 and d.lesson_date < m.m1
  ),
  pre as (
    select b.id, b.name, b.kind, b.sort_order, dates.n as qty, b.price as unit_price
    from public.tb_class_books cb
    join public.tb_books b on b.id = cb.book_id and b.active and b.kind = 'session'
    cross join dates
    where cb.class_name = p_class and dates.n > 0
    union all
    select b.id, b.name, b.kind, b.sort_order, 1, b.price
    from public.tb_books b, m
    where b.id = any(coalesce(p_singles, '{}')) and b.kind = 'single'
      and not exists (select 1 from public.tb_issues i
                      where i.student_id = p_student and i.book_id = b.id and i.issued_on < m.m0)
  ),
  post as (
    select b.id, b.name, b.kind, b.sort_order, sum(i.qty)::int as qty, i.unit_price
    from public.tb_issues i
    join public.tb_books b on b.id = i.book_id
    cross join m
    where i.student_id = p_student and i.issued_on >= m.m0 and i.issued_on < m.m1
    group by b.id, b.name, b.kind, b.sort_order, i.unit_price
  ),
  lines as (
    select * from pre  where p_mode = 'pre'
    union all
    select * from post where p_mode = 'post'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'book_id', id, 'name', name, 'kind', kind,
           'qty', qty, 'unit_price', unit_price, 'amount', qty * unit_price)
         order by case kind when 'session' then 0 else 1 end, sort_order, name, unit_price), '[]'::jsonb)
  from lines;
$$;

/* 실제 지급액 (그 달, 지급 당시 가격) */
create or replace function public._tb_actual(p_student uuid, p_month date)
returns integer
language sql
stable
as $$
  select coalesce(sum(qty * unit_price), 0)::int
  from public.tb_issues
  where student_id = p_student
    and issued_on >= public._tb_month(p_month)
    and issued_on <  (public._tb_month(p_month) + interval '1 month')::date;
$$;

/* 아직 반영되지 않은 지난 차액 (carry 로 정했지만 붙을 청구서가 없던 것) */
create or replace function public._tb_carry_pending(p_student uuid, p_month date)
returns integer
language sql
stable
as $$
  select coalesce(sum(diff_amount), 0)::int
  from public.tb_bills
  where student_id = p_student and diff_action = 'carry'
    and diff_target_bill is null and month < public._tb_month(p_month);
$$;

/* 붙을 곳이 없던 지난 차액을 이 청구서에 붙인다.
   돌려줄 돈(−)이 이 청구서 금액보다 크면 붙이지 않고 기다리게 둔다 (청구서가 0원 밑으로 가지 않게).
   붙이지 못한 건수를 돌려준다. */
create or replace function public._tb_claim_carry(p_bill uuid)
returns integer
language plpgsql
as $$
declare
  b record;
  c record;
  cur integer;
  left_n integer := 0;
begin
  select * into b from public.tb_bills where id = p_bill;
  if b.status <> 'unpaid' then return 0; end if;
  cur := b.items_total + b.adjust + b.carry_in;
  for c in
    select id, diff_amount from public.tb_bills
    where student_id = b.student_id and diff_action = 'carry'
      and diff_target_bill is null and month < b.month
    order by month
  loop
    if cur + c.diff_amount >= 0 then
      update public.tb_bills set diff_target_bill = p_bill where id = c.id;
      cur := cur + c.diff_amount;
    else
      left_n := left_n + 1;
    end if;
  end loop;
  perform public._tb_recalc_carry(p_bill);
  return left_n;
end;
$$;

/* 그 청구서에 붙은 차액을 다시 더한다 (미납 청구서만 바뀐다) */
create or replace function public._tb_recalc_carry(p_bill uuid)
returns void
language sql
as $$
  update public.tb_bills b
  set carry_in = coalesce((select sum(x.diff_amount) from public.tb_bills x
                           where x.diff_target_bill = b.id and x.diff_action = 'carry'), 0)
  where b.id = p_bill and b.status = 'unpaid';
$$;

/* 청구 미리보기 — 그 반 학생마다 품목과 합계.
   선불: 지금 그 반에 다니는 학생
   후불: 지금 그 반 학생 + 그 달에 이 반에서 교재를 받은 학생(퇴원·반 이동 포함) */
create or replace function public.tb_bill_preview(
  p_class text, p_month date, p_mode text, p_singles uuid[])
returns table (
  student_id uuid, name text, archived boolean, items jsonb, items_total integer,
  carry_pending integer, bill_id uuid, bill_status text, bill_total integer)
language sql
stable
as $$
  with m as (select public._tb_month(p_month) as m0,
                    (public._tb_month(p_month) + interval '1 month')::date as m1),
  who as (
    select s.id from public.students s where s.class_name = p_class and not s.archived
    union
    select i.student_id from public.tb_issues i, m
    where p_mode = 'post' and i.class_name = p_class and i.issued_on >= m.m0 and i.issued_on < m.m1
  ),
  calc as (
    select s.id, s.name, s.archived,
           public._tb_bill_items(s.id, p_class, p_month, p_mode, p_singles) as items
    from who join public.students s on s.id = who.id
  )
  select c.id, c.name, c.archived, c.items,
         coalesce((select sum((e ->> 'amount')::int) from jsonb_array_elements(c.items) e), 0)::int,
         public._tb_carry_pending(c.id, p_month),
         b.id, b.status, b.total
  from calc c
  left join public.tb_bills b on b.student_id = c.id and b.month = public._tb_month(p_month)
  order by c.archived, c.name;
$$;

/* 청구 생성. 이미 있는 미납 청구서는 새로 계산해 덮고, 완료·면제는 건드리지 않는다.
   p_students 가 null 이면 미리보기에 나온 학생 전부. */
create or replace function public.tb_bill_create(
  p_class text, p_month date, p_mode text, p_singles uuid[], p_students uuid[])
returns jsonb
language plpgsql
as $$
declare
  m0 date := public._tb_month(p_month);
  r record;
  v_id uuid;
  v_total integer;
  n_new integer := 0; n_upd integer := 0; n_skip integer := 0; n_empty integer := 0; n_left integer := 0;
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public._tb_need_staff();
  if p_mode not in ('pre', 'post') then raise exception '청구 방식이 올바르지 않습니다.'; end if;
  if coalesce(btrim(p_class), '') = '' then raise exception '반을 골라 주세요.'; end if;

  insert into public.tb_bill_plans (class_name, month, mode, single_book_ids, updated_by)
  values (p_class, m0, p_mode, coalesce(p_singles, '{}'), who)
  on conflict (class_name, month) do update
    set mode = excluded.mode, single_book_ids = excluded.single_book_ids, updated_by = excluded.updated_by;

  for r in select * from public.tb_bill_preview(p_class, m0, p_mode, p_singles) loop
    if p_students is not null and not (r.student_id = any(p_students)) then continue; end if;

    if r.bill_id is not null and r.bill_status <> 'unpaid' then
      n_skip := n_skip + 1;
      continue;
    end if;

    if r.bill_id is null and r.items_total = 0 and r.carry_pending = 0 then
      n_empty := n_empty + 1;
      continue;
    end if;

    if r.bill_id is null then
      insert into public.tb_bills (student_id, month, class_name, mode, items, created_by)
      values (r.student_id, m0, p_class, p_mode, r.items, who)
      returning id into v_id;
      n_new := n_new + 1;
    else
      v_id := r.bill_id;
      /* 붙어 있던 차액을 떼고 새로 계산한 뒤 다시 붙인다 (품목이 줄어 0원 밑으로 가는 일을 막는다) */
      update public.tb_bills set diff_target_bill = null where diff_target_bill = v_id;
      update public.tb_bills set class_name = p_class, mode = p_mode, items = r.items, carry_in = 0
      where id = v_id;
      n_upd := n_upd + 1;
    end if;

    n_left := n_left + public._tb_claim_carry(v_id);
  end loop;

  return jsonb_build_object('created', n_new, 'updated', n_upd, 'skipped', n_skip, 'empty', n_empty,
                            'carry_left', n_left);
end;
$$;

/* 선불 차액 목록 — 그 달 선불 청구서 중 납부 완료된 것 */
create or replace function public.tb_diff_list(p_month date)
returns table (
  bill_id uuid, student_id uuid, name text, class_name text, billed integer, actual integer,
  diff integer, diff_action text, diff_amount integer, target_month date, target_status text,
  refund_status text, month_over boolean)
language sql
stable
as $$
  select b.id, b.student_id, s.name, b.class_name,
         (b.items_total + b.adjust)::int,
         public._tb_actual(b.student_id, b.month),
         (public._tb_actual(b.student_id, b.month) - b.items_total - b.adjust)::int,
         b.diff_action, b.diff_amount,
         t.month, t.status,
         (select r.status from public.tb_refunds r
          where r.bill_id = b.id and r.source = 'diff' and r.status <> 'canceled'
          order by r.requested_at desc limit 1),
         public._tb_today() >= (b.month + interval '1 month')::date
  from public.tb_bills b
  join public.students s on s.id = b.student_id
  left join public.tb_bills t on t.id = b.diff_target_bill
  where b.month = public._tb_month(p_month) and b.mode = 'pre' and b.status = 'paid'
  order by b.class_name, s.name;
$$;

/* 선불 차액 처리 — carry 다음 달 청구에서 차감(또는 추가) / refund 환불 요청 / none 그냥 두기 */
create or replace function public.tb_diff_resolve(p_bill uuid, p_action text, p_method text)
returns jsonb
language plpgsql
as $$
declare
  b record;
  d integer;
  t uuid;
begin
  perform public._tb_need_staff();
  select * into b from public.tb_bills where id = p_bill for update;
  if not found then raise exception '청구서를 찾지 못했습니다.'; end if;
  if b.mode <> 'pre' or b.status <> 'paid' then raise exception '납부 완료된 선불 청구서만 차액을 처리합니다.'; end if;
  if b.diff_action is not null then raise exception '이미 처리했습니다. 먼저 [되돌리기]를 눌러 주세요.'; end if;
  if p_action not in ('carry', 'refund', 'none') then raise exception '처리 방법이 올바르지 않습니다.'; end if;

  d := public._tb_actual(b.student_id, b.month) - b.items_total - b.adjust;

  if p_action = 'refund' then
    if d >= 0 then raise exception '더 받은 돈이 없어 환불할 금액이 없습니다.'; end if;
    insert into public.tb_refunds (bill_id, amount, reason, method, status, source)
    values (p_bill, -d, to_char(b.month, 'YYYY"년 "FMMM"월"') || ' 선불 차액', coalesce(p_method, 'transfer'), 'requested', 'diff');
  end if;

  update public.tb_bills
  set diff_amount = d, diff_action = p_action, diff_done_at = now(), diff_target_bill = null
  where id = p_bill;

  /* 다음 달 미납 청구서가 이미 있으면 바로 붙인다. 없거나 돌려줄 돈이 더 크면
     '붙을 곳 없음'으로 두었다가 다음 청구서를 만들 때 붙인다. */
  if p_action = 'carry' and d <> 0 then
    select id into t from public.tb_bills
    where student_id = b.student_id and month > b.month and status = 'unpaid'
    order by month limit 1;
    if t is not null then
      perform public._tb_claim_carry(t);
      select diff_target_bill into t from public.tb_bills where id = p_bill;
    end if;
  end if;

  return jsonb_build_object('diff', d, 'action', p_action, 'target', t);
end;
$$;

/* 차액 처리 되돌리기 */
create or replace function public.tb_diff_reset(p_bill uuid)
returns void
language plpgsql
as $$
declare
  b record;
  ts text;
begin
  perform public._tb_need_staff();
  select * into b from public.tb_bills where id = p_bill for update;
  if not found then raise exception '청구서를 찾지 못했습니다.'; end if;

  if b.diff_action = 'carry' and b.diff_target_bill is not null then
    select status into ts from public.tb_bills where id = b.diff_target_bill;
    if ts <> 'unpaid' then raise exception '차액이 붙은 다음 달 청구서가 이미 납부(또는 면제)되어 되돌릴 수 없습니다.'; end if;
  end if;
  if b.diff_action = 'refund' then
    if exists (select 1 from public.tb_refunds where bill_id = p_bill and source = 'diff' and status = 'done') then
      raise exception '환불을 이미 완료해서 되돌릴 수 없습니다.';
    end if;
    delete from public.tb_refunds where bill_id = p_bill and source = 'diff' and status = 'requested';
  end if;

  update public.tb_bills
  set diff_amount = null, diff_action = null, diff_done_at = null, diff_target_bill = null
  where id = p_bill;

  if b.diff_target_bill is not null then perform public._tb_recalc_carry(b.diff_target_bill); end if;
end;
$$;

/* 청구서 지우기 (미납만). 붙어 있던 차액은 다시 '붙을 곳 없음'으로 돌아간다. */
create or replace function public.tb_bill_remove(p_bill uuid)
returns void
language plpgsql
as $$
declare
  st text;
begin
  perform public._tb_need_staff();
  select status into st from public.tb_bills where id = p_bill;
  if st is null then return; end if;
  if st <> 'unpaid' then raise exception '미납 청구서만 지울 수 있습니다. 먼저 [미납으로 되돌리기]를 해 주세요.'; end if;
  update public.tb_bills set diff_target_bill = null where diff_target_bill = p_bill;
  delete from public.tb_bills where id = p_bill;
end;
$$;


/* ---------- 대시보드 ---------- */

/* 청구서 한 장의 숫자 — 대시보드·정산·학부모 화면이 모두 이 기준을 쓴다
   청구 = 면제 아닌 청구서 total
   완료 = status paid 의 total,  미결제 = status unpaid 의 total
   환불 = 완료된 환불,  환불 대기 = 요청 상태 환불
   수납 = 완료 − 환불 */
create or replace function public.tb_dashboard(p_month date)
returns jsonb
language plpgsql
stable
as $$
declare
  m0 date := public._tb_month(p_month);
  res jsonb;
begin
  perform public._tb_need_staff();

  with b as (
    select bl.*, coalesce(a.name, '') as academy,
           coalesce((select sum(r.amount) from public.tb_refunds r where r.bill_id = bl.id and r.status = 'done'), 0)::int as refunded,
           coalesce((select sum(r.amount) from public.tb_refunds r where r.bill_id = bl.id and r.status = 'requested'), 0)::int as refund_wait
    from public.tb_bills bl
    left join public.tb_class_academy ca on ca.class_name = bl.class_name
    left join public.tb_academies a on a.id = ca.academy_id
    where bl.month = m0
  ),
  agg as (
    select academy, class_name,
           count(*) filter (where status <> 'waived')::int as bills,
           count(*) filter (where status = 'waived')::int  as waived,
           count(*) filter (where status = 'unpaid')::int  as unpaid_n,
           coalesce(sum(total) filter (where status <> 'waived'), 0)::int as billed,
           coalesce(sum(total) filter (where status = 'paid'), 0)::int    as paid,
           coalesce(sum(total) filter (where status = 'unpaid'), 0)::int  as unpaid,
           coalesce(sum(refunded), 0)::int    as refunded,
           coalesce(sum(refund_wait), 0)::int as refund_wait
    from b group by academy, class_name
  )
  select jsonb_build_object(
    'month', m0,
    'summary', jsonb_build_object(
      'bills',       coalesce(sum(bills), 0),
      'unpaid_n',    coalesce(sum(unpaid_n), 0),
      'billed',      coalesce(sum(billed), 0),
      'paid',        coalesce(sum(paid), 0),
      'unpaid',      coalesce(sum(unpaid), 0),
      'refunded',    coalesce(sum(refunded), 0),
      'refund_wait', coalesce(sum(refund_wait), 0),
      'net',         coalesce(sum(paid), 0) - coalesce(sum(refunded), 0)),
    'by_class', coalesce(jsonb_agg(to_jsonb(agg) order by academy, class_name), '[]'::jsonb)
  ) into res
  from agg;

  res := res || jsonb_build_object(
    'by_academy', coalesce((
      select jsonb_agg(x order by x ->> 'academy') from (
        select jsonb_build_object(
                 'academy', e ->> 'academy',
                 'classes', count(*),
                 'bills',   sum((e ->> 'bills')::int),
                 'billed',  sum((e ->> 'billed')::int),
                 'paid',    sum((e ->> 'paid')::int),
                 'unpaid',  sum((e ->> 'unpaid')::int),
                 'refunded', sum((e ->> 'refunded')::int)) as x
        from jsonb_array_elements(res -> 'by_class') e
        group by e ->> 'academy'
      ) q), '[]'::jsonb),

    /* 재고 부족 — 안전 재고 이하이거나, 다음 수업에 모자라는 교재 */
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'book_id', s.book_id, 'name', s.name, 'stock', s.stock, 'min_stock', s.min_stock,
               'incoming', s.incoming, 'short', coalesce(g.short, 0)) order by s.name)
      from public.tb_stock() s
      left join (select book_id, sum(suggested)::int as short from public.tb_order_suggest() group by book_id) g
        on g.book_id = s.book_id
      where s.active and (s.stock <= s.min_stock or coalesce(g.short, 0) > 0)
    ), '[]'::jsonb),

    'draft_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'created_at', o.created_at, 'created_by', o.created_by, 'memo', o.memo,
               'lines', (select count(*) from public.tb_order_lines l where l.order_id = o.id),
               'qty',   (select coalesce(sum(qty), 0) from public.tb_order_lines l where l.order_id = o.id))
             order by o.created_at)
      from public.tb_orders o where o.status = 'draft'
    ), '[]'::jsonb),

    'unbilled_classes', coalesce((
      select jsonb_agg(c order by c)
      from (select distinct s.class_name as c from public.students s
            where not s.archived and btrim(s.class_name) <> ''
              and exists (select 1 from public.tb_class_books cb where cb.class_name = s.class_name)
              and not exists (select 1 from public.tb_bill_plans p where p.class_name = s.class_name and p.month = m0)) q
    ), '[]'::jsonb)
  );

  return res;
end;
$$;


-- ============================================================
--  학부모 화면 — /me/#코드 의 「교재비」 탭
--
--  security definer : 함수 안에서만 표를 읽는다. 부르는 사람은 표를 못 본다.
--  돌려주는 것  : 그 학생의 월별 청구(교재명·수량·판매가·금액·합계) · 납부 상태 · 환불
--                 미납이 있을 때만 계좌(은행·계좌번호·예금주)
--  돌려주지 않는 것 : 공급가 · 공급처 · 재고 · 다른 학생 · 메모 · 캡처 · 연락처
-- ============================================================
create or replace function public.hub_textbook(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  bills jsonb;
  unpaid integer;
  bank jsonb;
begin
  select * into s from public._hub_student(p_code);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if s.archived then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'month',         b.month,
           'status',        b.status,
           'items',         (select coalesce(jsonb_agg(jsonb_build_object(
                                      'name', e ->> 'name', 'kind', e ->> 'kind',
                                      'qty', (e ->> 'qty')::int, 'unit_price', (e ->> 'unit_price')::int,
                                      'amount', (e ->> 'amount')::int)), '[]'::jsonb)
                             from jsonb_array_elements(b.items) e),
           'items_total',   b.items_total,
           'carry_in',      b.carry_in,
           'adjust',        b.adjust,
           'adjust_reason', b.adjust_reason,
           'total',         b.total,
           'paid_at',       b.paid_at,
           'pay_method',    b.pay_method,
           'refunds',       (select coalesce(jsonb_agg(jsonb_build_object(
                                      'amount', r.amount, 'status', r.status, 'done_at', r.done_at)
                                    order by r.requested_at), '[]'::jsonb)
                             from public.tb_refunds r where r.bill_id = b.id and r.status <> 'canceled')
         ) order by b.month desc), '[]'::jsonb),
         coalesce(sum(b.total) filter (where b.status = 'unpaid'), 0)::int
    into bills, unpaid
  from (select * from public.tb_bills where student_id = s.id order by month desc limit 24) b;

  if unpaid > 0 then
    select jsonb_build_object(
             'bank',    coalesce(value ->> 'bank', ''),
             'account', coalesce(value ->> 'account', ''),
             'holder',  coalesce(value ->> 'holder', ''))
      into bank
    from public.app_settings where key = 'textbook_bank';
  end if;

  return jsonb_build_object(
    'ok', true,
    'bills', bills,
    'unpaid_total', unpaid,
    'bank', bank
  );
end;
$$;


-- ============================================================
--  실행 권한
--   - 계산 함수: 로그인한 사람만 (안에서 staff 인지 다시 본다)
--   - hub_textbook: 누구나 (개인 링크 코드로만 그 학생 것)
--   - 내부 함수(_로 시작): 표 트리거와 다른 함수만 쓴다
-- ============================================================
revoke all on function public._tb_bill_items(uuid, text, date, text, uuid[]) from public, anon;
revoke all on function public._tb_actual(uuid, date)                      from public, anon;
revoke all on function public._tb_carry_pending(uuid, date)               from public, anon;
revoke all on function public._tb_recalc_carry(uuid)                      from public, anon;
revoke all on function public._tb_claim_carry(uuid)                       from public, anon;
grant execute on function public._tb_claim_carry(uuid)                    to authenticated;
revoke all on function public._tb_need_staff()                            from public, anon;
grant execute on function public._tb_bill_items(uuid, text, date, text, uuid[]) to authenticated;
grant execute on function public._tb_actual(uuid, date)                      to authenticated;
grant execute on function public._tb_carry_pending(uuid, date)               to authenticated;
grant execute on function public._tb_recalc_carry(uuid)                      to authenticated;
grant execute on function public._tb_need_staff()                            to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.tb_locked_students()',
    'public.tb_issue_bulk(text, date, uuid[], uuid[], boolean)',
    'public.tb_stock()',
    'public.tb_order_suggest()',
    'public.tb_order_receive(uuid, jsonb)',
    'public.tb_bill_preview(text, date, text, uuid[])',
    'public.tb_bill_create(text, date, text, uuid[], uuid[])',
    'public.tb_diff_list(date)',
    'public.tb_diff_resolve(uuid, text, text)',
    'public.tb_diff_reset(uuid)',
    'public.tb_bill_remove(uuid)',
    'public.tb_dashboard(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function public.hub_textbook(text) from public;
grant execute on function public.hub_textbook(text) to anon, authenticated;


-- ============================================================
--  확인 — 아래 결과를 눈으로 본다
--  tb_ 로 시작하는 표 13개가 전부 rls_enabled = true 여야 한다
-- ============================================================
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public' and tablename like 'tb\_%'
order by tablename;
