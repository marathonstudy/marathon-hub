-- ============================================================
--  마라톤 코치룸 — 새 조교 승인 (migration-051-staff-approval.sql)
--
--  실행 방법
--    049 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    그다음 Edge Function staff-login 을 배포한다 (승인 대기 안내).
--  여러 번 실행해도 안전하다. 이미 들어와 있는 운영진은 모두 「승인됨」으로 남는다.
--
--  1. staff.approval — approved(승인됨) · pending(승인 대기) · rejected(거절). 지금 있는 사람은 모두 approved
--     is_staff() · is_teacher() · 원장 확인 · staff_status 가 승인된 사람만 인정한다 → 승인 전에는 학생 정보를 하나도 못 본다
--  2. staff_phone_login — 이름 + 번호 8자리는 그대로. 처음 보는 번호면 「승인 대기」(사용 중 아님)로 만들고 들어가지 못한다(reason pending)
--     거절된 번호는 reason rejected · 시간당 가입 제한은 없앴다
--  3. 승인 · 거절 — 사용 중인 운영진이면 누구나 (staff_pending · staff_approve) · 누가 승인했는지 approved_by 에 남고 운영진 목록에 보인다
--     「사용 중지」 · 「다시 사용」은 지금처럼 원장 계정만 (staff_set_active · 047)
--     승인 요청 문자는 보내지 않는다 — 「오늘」 화면 맨 위 「새 조교 승인 대기」로 운영진 모두에게 보인다
-- ============================================================

alter table public.staff add column if not exists approval    text not null default 'approved';
alter table public.staff add column if not exists approved_by text;
alter table public.staff add column if not exists approved_at timestamptz;
alter table public.staff add column if not exists notified_at timestamptz;
alter table public.staff drop constraint if exists staff_approval_check;
alter table public.staff add constraint staff_approval_check check (approval in ('approved', 'pending', 'rejected'));

/* 승인된 · 사용 중인 사람만 — 모든 RLS 정책과 함수가 이 함수를 쓴다 */
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active and approval = 'approved'
  );
$$;

create or replace function public._real_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'teacher' and active and approval = 'approved'
  );
$$;

create or replace function public.staff_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when approval = 'pending' then 'pending' when approval = 'rejected' then 'rejected' when not active then 'disabled' else 'active' end
       from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    'none');
$$;

/* 이름 + 번호 8자리 — 처음 보는 번호는 「승인 대기」 */
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
    if s.approval = 'rejected' then return jsonb_build_object('ok', false, 'reason', 'rejected'); end if;
    if s.approval = 'pending' then return jsonb_build_object('ok', false, 'reason', 'pending', 'email', s.email, 'notify', s.notified_at is null); end if;
    if not s.active then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
    insert into public.staff_phone_attempts (key, ok) values (h, true);
    insert into public.staff_phones (email, phone) values (s.email, '010' || ph)
      on conflict (email) do update set phone = excluded.phone, updated_at = now();
    return jsonb_build_object('ok', true, 'email', s.email, 'created', false);
  end if;

  em := 'ph-' || left(h, 24) || '@coach.marathonstudy.github.io';
  insert into public.staff (email, name, role, active, phone_hash, phone_last4, approval)
  values (em, nm, 'assistant', false, h, right(ph, 4), 'pending');          /* 승인 전에는 사용 중이 아님 (필기 알림 등 운영진 대상에서도 빠진다) */
  insert into public.staff_phones (email, phone) values (em, '010' || ph)
    on conflict (email) do update set phone = excluded.phone, updated_at = now();
  return jsonb_build_object('ok', false, 'reason', 'pending', 'email', em, 'created', true, 'notify', true);
end;
$$;
revoke all on function public.staff_phone_login(text, text) from public, anon, authenticated;
grant execute on function public.staff_phone_login(text, text) to service_role;

/* 승인 대기 — 사용 중인 운영진 누구나 */
create or replace function public.staff_pending()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('can', true, 'list', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'name', name, 'last4', phone_last4, 'created_at', created_at) order by created_at)
                                                            from public.staff where approval = 'pending'), '[]'::jsonb));
end;
$$;

create or replace function public.staff_approve(p_email text, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare k text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_staff() then raise exception '사용 중인 운영진만 승인 · 거절할 수 있습니다.'; end if;
  update public.staff set approval = case when coalesce(p_ok, false) then 'approved' else 'rejected' end,
         active = coalesce(p_ok, false), approved_by = public._staff_name(), approved_at = now()
   where email = k and approval in ('pending', 'rejected') and role <> 'teacher';
  if not found then raise exception '승인 대기 중인 사람을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.staff_pending()', 'public.staff_approve(text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

/* 운영진 목록 — 승인된 사람만 (승인 대기 · 거절은 staff_pending 에서) */
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
               'disabled_by', disabled_by, 'disabled_at', disabled_at, 'approved_by', approved_by, 'approved_at', approved_at)
             order by active desc, role desc, created_at) from public.staff where approval = 'approved'), '[]'::jsonb));
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true · 마지막 줄은 승인됨 인원 (지금 있는 운영진 모두)
-- ============================================================
select 'approval' as what, exists (select 1 from information_schema.columns where table_name = 'staff' and column_name = 'approval')::text as ok
union all select '승인 대기 막기', (position('approval' in pg_get_functiondef('public.is_staff()'::regprocedure)) > 0)::text
union all select '승인됨 ' || (select count(*) from public.staff where approval = 'approved') || '명', 'true';
