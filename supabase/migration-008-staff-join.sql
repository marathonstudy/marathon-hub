-- ============================================================
--  마라톤 코치룸 — 조교 직접 가입 · 직원 관리 (migration-008-staff-join.sql)
--
--  실행 방법
--    001 ~ 007 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. staff 표는 칸만 더하고, 있던 사람은 모두 '사용 중' 으로 남는다.
--
--  흐름
--    1. 로그인 화면 [가입하기] → staff_join_check(이메일, 코드) 로 코드만 먼저 확인 (틀리면 계정을 만들지 않는다)
--    2. Supabase 가입(auth.signUp) → 바로 로그인된 상태에서 staff_join(이름, 코드)
--       → 코드를 한 번 더 확인하고 staff 에 '조교(assistant)' 로 등록. teacher 로는 절대 등록되지 않는다.
--  지키는 것
--    · 팀 가입 코드는 이 DB(staff_join 표)에만 있다. 화면 코드 · 저장소에는 없다.
--      teacher 가 처음 정하기 전에는 가입이 닫혀 있다.
--    · 틀린 코드: 같은 이메일 15분 안에 5번 → 잠깐 막음 / 전체 10분 안에 30번 → 모든 가입 10분 막음
--    · 사용 중지(active = false) 된 사람은 is_staff() · is_teacher() 가 거짓 → 모든 표 · 함수 · 실시간이 막힌다.
--      그 사람이 남긴 기록은 그대로다.
--    · secret key · service_role key 는 쓰지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  1. staff — 칸 더하기 (있던 사람은 모두 사용 중)
-- ------------------------------------------------------------
alter table public.staff add column if not exists active       boolean not null default true;
alter table public.staff add column if not exists disabled_by  text;
alter table public.staff add column if not exists disabled_at  timestamptz;
alter table public.staff add column if not exists last_seen_at timestamptz;

/* 사용 중인 staff 만 인정한다 — 모든 RLS 정책과 함수가 이 두 함수를 쓴다 */
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'teacher' and active
  );
$$;


-- ------------------------------------------------------------
--  2. 팀 가입 코드 · 틀린 시도 기록 — 화면에서는 직접 못 본다 (함수로만)
-- ------------------------------------------------------------
create table if not exists public.staff_join (
  id          integer primary key default 1,
  code        text not null,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  constraint staff_join_one check (id = 1)
);

create table if not exists public.staff_join_attempts (
  id    bigserial primary key,
  key   text not null,               -- 이메일 (소문자)
  ok    boolean not null,
  at    timestamptz not null default now()
);
create index if not exists staff_join_attempts_at_idx on public.staff_join_attempts (at);

alter table public.staff_join enable row level security;
alter table public.staff_join_attempts enable row level security;
/* 정책을 하나도 주지 않는다 → 아래 security definer 함수로만 읽고 쓴다 */


-- ------------------------------------------------------------
--  3. 가입
-- ------------------------------------------------------------

/* 막혔는가 — 'global' · 'email' · null */
create or replace function public._join_blocked(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select count(*) from public.staff_join_attempts where not ok and at > now() - interval '10 minutes') >= 30 then 'global'
    when (select count(*) from public.staff_join_attempts where not ok and key = p_key and at > now() - interval '15 minutes') >= 5 then 'email'
    else null end;
$$;

/* 코드 확인 (내부용) — 결과를 기록하고 'ok' · 'locked' · 'closed' · 'code' 를 돌려준다 */
create or replace function public._join_try(p_key text, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  real text;
begin
  delete from public.staff_join_attempts where at < now() - interval '1 day';
  if public._join_blocked(p_key) is not null then return 'locked'; end if;
  select code into real from public.staff_join where id = 1;
  if real is null or btrim(real) = '' then return 'closed'; end if;
  if coalesce(btrim(p_code), '') <> real then
    insert into public.staff_join_attempts (key, ok) values (p_key, false);
    return 'code';
  end if;
  insert into public.staff_join_attempts (key, ok) values (p_key, true);
  return 'ok';
end;
$$;

/* 가입 전에 코드만 확인 — 로그인 전(anon)에 부른다. 틀리면 계정을 만들지 않게 */
create or replace function public.staff_join_check(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_email, '')));
  r text;
  s record;
begin
  if k !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'email'); end if;
  r := public._join_try(k, p_code);
  if r <> 'ok' then return jsonb_build_object('ok', false, 'reason', r); end if;
  select active into s from public.staff where email = k;
  if found then
    return jsonb_build_object('ok', false, 'reason', case when s.active then 'exists' else 'disabled' end);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

/* 방금 가입(로그인)한 본인을 조교로 등록 — 역할은 항상 assistant */
create or replace function public.staff_join(p_name text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(coalesce(auth.jwt() ->> 'email', ''));
  nm text := left(btrim(coalesce(p_name, '')), 30);
  r text;
  s record;
begin
  if k = '' then return jsonb_build_object('ok', false, 'reason', 'login'); end if;
  if nm = '' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  select active into s from public.staff where email = k;
  if found then
    return jsonb_build_object('ok', s.active, 'reason', case when s.active then 'exists' else 'disabled' end);
  end if;
  r := public._join_try(k, p_code);
  if r <> 'ok' then return jsonb_build_object('ok', false, 'reason', r); end if;
  insert into public.staff (email, name, role, active, last_seen_at) values (k, nm, 'assistant', true, now());
  return jsonb_build_object('ok', true, 'role', 'assistant');
end;
$$;

/* 로그인한 사람의 상태 — 'active' · 'disabled' · 'none' (로그인 화면 · 열려 있는 화면 확인용) */
create or replace function public.staff_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when active then 'active' else 'disabled' end from public.staff
     where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    'none');
$$;

/* 마지막 접속 — 코치룸을 열 때 (한 시간에 한 번만 기록) */
create or replace function public.staff_touch()
returns void
language sql
security definer
set search_path = public
as $$
  update public.staff set last_seen_at = now()
  where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
    and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
$$;


-- ------------------------------------------------------------
--  4. 직원 관리 — teacher 만
-- ------------------------------------------------------------
create or replace function public._need_teacher()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then raise exception '선생님(teacher) 계정만 할 수 있습니다.'; end if;
end;
$$;

create or replace function public.staff_admin_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  return jsonb_build_object(
    'me', lower(coalesce(auth.jwt() ->> 'email', '')),
    'join', (select jsonb_build_object('code', code, 'updated_by', updated_by, 'updated_at', updated_at)
             from public.staff_join where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'email', email, 'name', name, 'role', role, 'active', active, 'created_at', created_at,
               'last_seen_at', last_seen_at, 'disabled_by', disabled_by, 'disabled_at', disabled_at)
             order by active desc, role desc, name) from public.staff), '[]'::jsonb)
  );
end;
$$;

/* 팀 가입 코드 바꾸기. p_base = 내가 본 코드의 바꾼 시각 — 그새 다른 분이 바꿨으면 conflict */
create or replace function public.staff_set_code(p_code text, p_base timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := btrim(coalesce(p_code, ''));
  cur record;
  row public.staff_join;
begin
  perform public._need_teacher();
  if length(c) < 6 or length(c) > 40 or c ~ '\s' then
    raise exception '가입 코드는 띄어쓰기 없이 6~40자로 정해 주세요.';
  end if;
  select * into cur from public.staff_join where id = 1 for update;
  if found and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true);
  end if;
  insert into public.staff_join (id, code, updated_by, updated_at) values (1, c, public._staff_name(), now())
  on conflict (id) do update set code = excluded.code, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into row;
  return jsonb_build_object('ok', true, 'updated_at', row.updated_at);
end;
$$;

create or replace function public.staff_set_active(p_email text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_email, '')));
begin
  perform public._need_teacher();
  if k = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception '자기 자신은 사용 중지할 수 없습니다.'; end if;
  if not p_active and exists (select 1 from public.staff where email = k and role = 'teacher')
     and (select count(*) from public.staff where role = 'teacher' and active and email <> k) = 0 then
    raise exception '마지막 선생님 계정은 사용 중지할 수 없습니다.';
  end if;
  update public.staff
  set active = p_active,
      disabled_by = case when p_active then null else public._staff_name() end,
      disabled_at = case when p_active then null else now() end
  where email = k;
  if not found then raise exception '그 직원을 찾지 못했습니다.'; end if;
end;
$$;

create or replace function public.staff_set_role(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_email, '')));
begin
  perform public._need_teacher();
  if p_role not in ('teacher', 'assistant') then raise exception '역할이 올바르지 않습니다.'; end if;
  if k = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception '자기 자신의 역할은 바꿀 수 없습니다.'; end if;
  if p_role = 'assistant' and (select count(*) from public.staff where role = 'teacher' and active and email <> k) = 0 then
    raise exception '마지막 선생님 계정은 조교로 바꿀 수 없습니다.';
  end if;
  update public.staff set role = p_role where email = k;
  if not found then raise exception '그 직원을 찾지 못했습니다.'; end if;
end;
$$;


-- ------------------------------------------------------------
--  5. 실행 권한
-- ------------------------------------------------------------
revoke all on function public._join_blocked(text)       from public, anon, authenticated;
revoke all on function public._join_try(text, text)     from public, anon, authenticated;
revoke all on function public._need_teacher()           from public, anon;
grant execute on function public._need_teacher()        to authenticated;

revoke all on function public.staff_join_check(text, text) from public;
grant execute on function public.staff_join_check(text, text) to anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.staff_join(text, text)', 'public.staff_status()', 'public.staff_touch()',
    'public.staff_admin_get()', 'public.staff_set_code(text, timestamptz)',
    'public.staff_set_active(text, boolean)', 'public.staff_set_role(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 지금 등록된 사람 (모두 active = true 여야 한다). 가입 코드는 코치룸 [설정] 에서 정한다.
-- ============================================================
select email, name, role, active from public.staff order by role desc, name;
