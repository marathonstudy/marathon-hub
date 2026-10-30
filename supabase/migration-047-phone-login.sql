-- ============================================================
--  마라톤 코치룸 — 조교는 이름 + 휴대폰 번호 8자리로 들어온다 (migration-047-phone-login.sql)
--
--  실행 방법
--    046 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    그다음 Edge Function staff-login 을 배포한다 (supabase/functions/staff-login/index.ts · Verify JWT 끔).
--  여러 번 실행해도 안전하다. 있던 직원 · 기록은 바꾸지 않는다.
--
--  1. staff 에 phone_hash · phone_last4 — 번호 8자리는 그대로 두지 않는다.
--     해시 = sha256(이 DB 에만 있는 비밀 값 + 번호) · 화면에는 뒤 4자리만
--  2. staff_phone_login(이름, 번호) — staff-login 함수(service_role)만 부른다. 화면 · 링크(anon) · 로그인한 사람은 못 부른다
--       처음 보는 번호 → 그 이름으로 조교(assistant) 등록 · 이미 있는 번호 → 이름이 맞으면 들어감
--       이름이 다르면 'mismatch' · 사용 중지면 'disabled'
--       틀린 이름: 같은 번호 15분 안에 5번 → 잠깐 막음 · 전체 10분 안에 50번 → 모두 잠깐 막음
--       새 가입: 전체 한 시간에 20명까지 (넘으면 잠깐 뒤에)
--  3. 팀 가입 코드는 쓰지 않는다 — 남아 있던 코드를 지워 이메일 가입(staff_join)을 닫는다
--  4. staff_list() — 더보기 → 「운영진」 목록 (이름 · 번호 뒤 4자리 · 처음 들어온 날 · 마지막 접속 · 사용 중/중지)
--     사용 중지 · 다시 사용(staff_set_active)은 원장(teacher) 계정만 — 조교 화면에는 버튼이 없고 서버도 막는다
-- ============================================================

alter table public.staff add column if not exists phone_hash  text;
alter table public.staff add column if not exists phone_last4 text not null default '';
create unique index if not exists staff_phone_hash_uq on public.staff (phone_hash) where phone_hash is not null;

/* 비밀 값 — 이 표는 정책이 없어 화면 · 링크에서 못 읽는다 (아래 security definer 함수만) */
create table if not exists public.staff_phone_secret (
  id     integer primary key default 1,
  pepper text not null,
  constraint staff_phone_secret_one check (id = 1)
);
alter table public.staff_phone_secret enable row level security;
revoke all on public.staff_phone_secret from public, anon, authenticated;
insert into public.staff_phone_secret (id, pepper)
values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create table if not exists public.staff_phone_attempts (
  id    bigserial primary key,
  key   text not null,               -- 번호 해시 · 'new'
  ok    boolean not null,
  at    timestamptz not null default now()
);
create index if not exists staff_phone_attempts_at_idx on public.staff_phone_attempts (at);
alter table public.staff_phone_attempts enable row level security;
revoke all on public.staff_phone_attempts from public, anon, authenticated;

create or replace function public._phone_hash(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to((select pepper from public.staff_phone_secret where id = 1) || ':' || p_phone, 'UTF8')), 'hex');
$$;
revoke all on function public._phone_hash(text) from public, anon, authenticated;

create or replace function public.staff_phone_login(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 20);
  ph text := coalesce(p_phone, '');
  h  text;
  s  record;
  em text;
begin
  if nm = '' or nm ~ '^[0-9\s-]+$' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if ph !~ '^[0-9]{8}$' then return jsonb_build_object('ok', false, 'reason', 'phone'); end if;
  delete from public.staff_phone_attempts where at < now() - interval '1 day';
  h := public._phone_hash(ph);
  if (select count(*) from public.staff_phone_attempts where not ok and at > now() - interval '10 minutes') >= 50
     or (select count(*) from public.staff_phone_attempts where not ok and key = h and at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select * into s from public.staff where phone_hash = h;
  if found then
    if replace(lower(s.name), ' ', '') <> replace(lower(nm), ' ', '') then
      insert into public.staff_phone_attempts (key, ok) values (h, false);
      return jsonb_build_object('ok', false, 'reason', 'mismatch');
    end if;
    if not s.active then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
    insert into public.staff_phone_attempts (key, ok) values (h, true);
    return jsonb_build_object('ok', true, 'email', s.email, 'created', false);
  end if;

  if (select count(*) from public.staff_phone_attempts where key = 'new' and at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  em := 'ph-' || left(h, 24) || '@coach.marathonstudy.github.io';
  insert into public.staff (email, name, role, active, phone_hash, phone_last4, last_seen_at)
  values (em, nm, 'assistant', true, h, right(ph, 4), now());
  insert into public.staff_phone_attempts (key, ok) values ('new', true);
  return jsonb_build_object('ok', true, 'email', em, 'created', true);
end;
$$;
revoke all on function public.staff_phone_login(text, text) from public, anon, authenticated;
grant execute on function public.staff_phone_login(text, text) to service_role;

/* 팀 가입 코드 — 이제 쓰지 않는다 (코드가 없으면 staff_join 은 'closed') */
do $$
begin
  if to_regclass('public.staff_join') is not null then delete from public.staff_join where id = 1; end if;
end;
$$;

/* 더보기 → 「운영진」 — 직원 누구나 목록을 본다 · 버튼은 원장만 */
create or replace function public.staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'me', lower(coalesce(auth.jwt() ->> 'email', '')),
    'owner', public._real_teacher(),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'email', email, 'name', name, 'role', role, 'active', active,
               'last4', phone_last4, 'phone', phone_hash is not null,
               'created_at', created_at, 'last_seen_at', last_seen_at,
               'disabled_by', disabled_by, 'disabled_at', disabled_at)
             order by active desc, role desc, created_at) from public.staff), '[]'::jsonb));
end;
$$;
revoke all on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated;

/* 사용 중지 · 다시 사용 — 원장(teacher) 계정만 */
create or replace function public.staff_set_active(p_email text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_email, '')));
begin
  if not public._real_teacher() then raise exception '원장(선생님) 계정만 사용 중지 · 다시 사용을 할 수 있습니다.'; end if;
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
revoke all on function public.staff_set_active(text, boolean) from public, anon;
grant execute on function public.staff_set_active(text, boolean) to authenticated;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'phone_hash' as what, exists (select 1 from information_schema.columns where table_name = 'staff' and column_name = 'phone_hash')::text as ok
union all select '비밀 값', exists (select 1 from public.staff_phone_secret where id = 1 and length(pepper) >= 32)::text
union all select '운영진 목록', exists (select 1 from pg_proc where proname = 'staff_list')::text;
