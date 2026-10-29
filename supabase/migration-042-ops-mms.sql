-- ============================================================
--  마라톤 코치룸 — 운영진 번호 · 과제 현황 이미지 사진 문자(MMS) (migration-042-ops-mms.sql)
--
--  실행 방법
--    041 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 보낸 기록은 바꾸지 않는다.
--  이 SQL 을 실행한 뒤 Edge Function sms-send 를 새 코드로 다시 배포한다 (사진 문자 보내기 action "mms").
--
--  1. ops_contacts — 운영진(강사 · 조교 · 행정) 이름 · 번호 · 역할. 표를 직접 읽지 못한다 (함수로만).
--     화면에는 번호 뒤 4자리만 돌려준다 · 전체 번호는 sms-send 함수가 보낼 때만 받는다.
--  2. 처음 열면 가져오기 — 설정(app_settings)에 이미 있는 운영진 번호(opsPhones · staffPhones · managerPhones)와
--     연 직원 본인의 「내 시험 번호」(kakao_test_phones). 한 번 가져온 뒤 지운 번호는 다시 생기지 않는다.
--  3. sms_log.kind 에 MMS(사진 문자) · sms_ops_prepare — 운영진 · 직접 넣은 번호로 보낼 줄 (보낸 기록 「과제 현황 이미지」 묶음)
--     「운영진으로 저장」을 고르면 직접 넣은 번호를 목록에 넣는다. 하루 · 한 달 상한은 문자와 같다.
--  모두 직원만 (조교 · 선생님 같다). 이미지는 DB · 저장소에 남기지 않는다 (솔라피에만 올린다).
-- ============================================================


-- ------------------------------------------------------------
--  1. 운영진
-- ------------------------------------------------------------
create table if not exists public.ops_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  phone       text not null,                           -- 숫자만
  role        text not null default '조교',            -- 강사 · 조교 · 행정
  sort_order  integer not null default 0,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ops_contacts_role_check check (role in ('강사', '조교', '행정')),
  constraint ops_contacts_phone_check check (phone ~ '^01[016789][0-9]{7,8}$'),
  constraint ops_contacts_name_len check (char_length(name) <= 30)
);
create unique index if not exists ops_contacts_phone_uq on public.ops_contacts (phone);
alter table public.ops_contacts enable row level security;
revoke all on public.ops_contacts from anon, authenticated;

create or replace function public._ops_row(c public.ops_contacts)
returns jsonb
language sql
immutable
as $$ select jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'last4', right(c.phone, 4)); $$;

/* 가져오기 — 설정에 있는 운영진 번호(한 번만) · 연 직원의 내 시험 번호(직원마다 한 번만) · 이미 있는 번호는 건너뛴다 */
create or replace function public._ops_import(me text, p_force boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  flag jsonb := coalesce((select value from public.app_settings where key = 'ops_contacts'), '{}'::jsonb);
  done_emails jsonb := coalesce(flag -> 'imported', '[]'::jsonb);
  added int := 0;
  x jsonb; d text; nm text; rl text; tp text; sf public.staff;
begin
  if p_force or not coalesce((flag ->> 'settings')::boolean, false) then
    for x in
      select e from public.app_settings s,
        lateral (select k from unnest(array['opsPhones', 'staffPhones', 'managerPhones', 'ops_phones', 'staff_phones']) k) kk,
        lateral jsonb_array_elements(case when jsonb_typeof(s.value -> kk.k) = 'array' then s.value -> kk.k else '[]'::jsonb end) e
      where s.key <> 'ops_contacts'
    loop
      d := regexp_replace(case when jsonb_typeof(x) = 'string' then x #>> '{}' else coalesce(x ->> 'phone', x ->> 'number', '') end, '\D', '', 'g');
      if not public._phone_ok(d) then continue; end if;
      nm := left(btrim(case when jsonb_typeof(x) = 'object' then coalesce(x ->> 'name', '') else '' end), 30);
      rl := case when jsonb_typeof(x) = 'object' and x ->> 'role' in ('강사', '조교', '행정') then x ->> 'role' else '조교' end;
      insert into public.ops_contacts (name, phone, role, created_by) values (coalesce(nullif(nm, ''), '운영진 ' || right(d, 4)), d, rl, me)
      on conflict (phone) do nothing;
      if found then added := added + 1; end if;
    end loop;
    flag := flag || jsonb_build_object('settings', true);
  end if;
  if me <> '' and (p_force or not (done_emails ? me)) then
    select phone into tp from public.kakao_test_phones where email = me;
    d := regexp_replace(coalesce(tp, ''), '\D', '', 'g');
    if public._phone_ok(d) then
      select * into sf from public.staff where lower(email) = me;
      insert into public.ops_contacts (name, phone, role, created_by)
      values (left(coalesce(nullif(btrim(sf.name), ''), split_part(me, '@', 1)), 30), d, case when sf.role = 'teacher' then '강사' else '조교' end, me)
      on conflict (phone) do nothing;
      if found then added := added + 1; end if;
    end if;
    if not (done_emails ? me) then done_emails := done_emails || to_jsonb(me); end if;
    flag := flag || jsonb_build_object('imported', done_emails);
  end if;
  insert into public.app_settings (key, value) values ('ops_contacts', flag)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return added;
end;
$$;

create or replace function public._ops_all()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public._ops_row(c) order by
    case c.role when '강사' then 0 when '조교' then 1 else 2 end, c.sort_order, c.name, c.created_at), '[]'::jsonb)
  from public.ops_contacts c;
$$;

/* 목록 — 처음 열면 가져오기 · 번호는 뒤 4자리만 */
create or replace function public.ops_contacts_list()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  added int;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  added := public._ops_import(me, false);
  return jsonb_build_object('ok', true, 'rows', public._ops_all(), 'imported', added);
end;
$$;

/* [설정에서 다시 가져오기] — 지운 번호도 다시 (이미 있는 번호는 그대로) */
create or replace function public.ops_contacts_import()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  added int;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  added := public._ops_import(me, true);
  return jsonb_build_object('ok', true, 'rows', public._ops_all(), 'imported', added);
end;
$$;

/* 넣기 · 고치기 — p_id 가 없으면 새로. 고칠 때 번호 칸이 비어 있으면 번호는 그대로 */
create or replace function public.ops_contacts_save(p_id uuid, p_name text, p_phone text, p_role text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  nm text := left(btrim(coalesce(p_name, '')), 30);
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  rl text := coalesce(p_role, '');
  c public.ops_contacts;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if nm = '' then raise exception '이름을 적어 주세요.'; end if;
  if rl not in ('강사', '조교', '행정') then raise exception '역할은 강사 · 조교 · 행정 중에서 골라 주세요.'; end if;
  if (p_id is null or d <> '') and not public._phone_ok(d) then raise exception '휴대폰 번호(010…)를 적어 주세요.'; end if;
  if d <> '' and exists (select 1 from public.ops_contacts where phone = d and (p_id is null or id <> p_id)) then
    raise exception '이미 목록에 있는 번호입니다 (뒤 4자리 %).', right(d, 4);
  end if;
  if p_id is null then
    insert into public.ops_contacts (name, phone, role, sort_order, created_by)
    values (nm, d, rl, coalesce((select max(sort_order) + 1 from public.ops_contacts), 0), me)
    returning * into c;
  else
    update public.ops_contacts set name = nm, role = rl, phone = case when d = '' then phone else d end, updated_at = now()
     where id = p_id returning * into c;
    if not found then raise exception '운영진을 찾지 못했습니다.'; end if;
  end if;
  return jsonb_build_object('ok', true, 'row', public._ops_row(c), 'rows', public._ops_all());
end;
$$;

create or replace function public.ops_contacts_delete(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  delete from public.ops_contacts where id = p_id;
  if not found then raise exception '운영진을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok', true, 'rows', public._ops_all());
end;
$$;


-- ------------------------------------------------------------
--  3. 사진 문자(MMS) — 보낼 줄
--     p_ops   운영진 id 배열 (jsonb) · p_phones 직접 넣은 번호 배열 (jsonb) · p_save 직접 넣은 번호를 운영진으로 저장
--     돌려줌 rows [{ log_id, to(전체 번호 · 함수만 씀), target 'staff', name, kind 'MMS' }] — 기록에는 뒤 4자리만
-- ------------------------------------------------------------
alter table public.sms_log drop constraint if exists sms_log_kind_check;
alter table public.sms_log add constraint sms_log_kind_check check (kind in ('SMS', 'LMS', 'MMS'));

create or replace function public.sms_ops_prepare(p_ops jsonb, p_phones jsonb, p_save boolean, p_body text, p_class text, p_label text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._sms_cfg();
  body text := btrim(coalesce(p_body, ''));
  cls text := left(btrim(coalesce(p_class, '')), 60);
  batch uuid := gen_random_uuid();
  rows jsonb := '[]'::jsonb;
  seen jsonb := '{}'::jsonb;
  skipped jsonb := '[]'::jsonb;
  saved int := 0;
  n int := 0;
  x jsonb; d text; c public.ops_contacts;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if body = '' then return jsonb_build_object('ok', false, 'reason', 'input', 'message', '내용을 적어 주세요.'); end if;
  if char_length(body) > 1000 then return jsonb_build_object('ok', false, 'reason', 'toolong', 'message', '내용이 너무 깁니다.'); end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_ops) = 'array' then p_ops else '[]'::jsonb end) loop
    if coalesce(x #>> '{}', '') !~* '^[0-9a-f-]{36}$' then continue; end if;
    select * into c from public.ops_contacts where id = (x #>> '{}')::uuid;
    if not found or seen ? c.phone then continue; end if;
    seen := seen || jsonb_build_object(c.phone, true);
    rows := rows || jsonb_build_object('target', 'staff', 'to', c.phone, 'name', c.name || ' (' || c.role || ')', 'class_name', cls, 'text', body, 'kind', 'MMS');
  end loop;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_phones) = 'array' then p_phones else '[]'::jsonb end) loop
    d := regexp_replace(coalesce(x #>> '{}', ''), '\D', '', 'g');
    if d = '' then continue; end if;
    if not public._phone_ok(d) then
      skipped := skipped || jsonb_build_object('last4', right(d, 4), 'reason', 'nophone', 'label', '휴대폰 번호가 아님');
      continue;
    end if;
    if seen ? d then continue; end if;
    seen := seen || jsonb_build_object(d, true);
    select * into c from public.ops_contacts where phone = d;
    if not found and coalesce(p_save, false) then
      insert into public.ops_contacts (name, phone, role, sort_order, created_by)
      values ('운영진 ' || right(d, 4), d, '조교', coalesce((select max(sort_order) + 1 from public.ops_contacts), 0), me)
      returning * into c;
      saved := saved + 1;
    end if;
    rows := rows || jsonb_build_object('target', 'staff', 'to', d, 'name', case when c.id is not null then c.name || ' (' || c.role || ')' else '직접 넣은 번호' end,
                                       'class_name', cls, 'text', body, 'kind', 'MMS');
    c := null;
  end loop;
  n := jsonb_array_length(rows);
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'none', 'message', '받을 사람을 골라 주세요.', 'skipped', skipped); end if;
  if n > 50 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '사진 문자는 한 번에 50명까지 보낼 수 있습니다.'); end if;
  if public._sms_today_count() + n > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._sms_today_count() || '건 · 이번 ' || n || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;
  if public._sms_month_count() + n > (cfg ->> 'monthMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'monthly',
      'message', '이번 달 보낼 수 있는 건수를 넘습니다 (이번 달 ' || public._sms_month_count() || '건 · 이번 ' || n || '건 · 한 달 ' || (cfg ->> 'monthMax') || '건).');
  end if;

  insert into public.sms_batches (id, label, purpose, body, created_by)
  values (batch, left(coalesce(nullif(btrim(coalesce(p_label, '')), ''), '과제 현황 이미지'), 60), 'ops', body, me);
  rows := coalesce((
    select jsonb_agg(e.y || jsonb_build_object('log_id', public._sms_log_new(batch, e.y, false, null, me)) order by e.o)
    from jsonb_array_elements(rows) with ordinality e(y, o)), '[]'::jsonb);
  return jsonb_build_object('ok', true, 'batch', batch, 'rows', rows, 'skipped', skipped, 'saved', saved, 'contacts', public._ops_all());
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._ops_row(public.ops_contacts)', 'public._ops_import(text, boolean)', 'public._ops_all()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.ops_contacts_list()', 'public.ops_contacts_import()', 'public.ops_contacts_save(uuid, text, text, text)',
                           'public.ops_contacts_delete(uuid)', 'public.sms_ops_prepare(jsonb, jsonb, boolean, text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'ops_contacts' as what, exists (select 1 from pg_tables where tablename = 'ops_contacts' and rowsecurity)::text as ok
union all select 'sms_log MMS', (position('MMS' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'sms_log_kind_check')) > 0)::text
union all select 'sms_ops_prepare', (not has_function_privilege('anon', 'public.sms_ops_prepare(jsonb, jsonb, boolean, text, text, text)', 'execute'))::text;
