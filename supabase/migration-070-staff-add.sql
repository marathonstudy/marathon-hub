-- ============================================================
--  migration-070-staff-add.sql — 원장이 조교를 이름 + 휴대폰 번호로 직접 등록 (20261108b)
--  (070 은 069 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  지금까지 — 조교가 직접 로그인해야 문자용 번호(staff_phones)가 저장됐다.
--            로그인 안 한 조교는 과제 현황 문자 · 필기 알림(운영진)을 못 받았다.
--  1. staff_add(이름, 번호) — 원장(teacher)만. 번호는 010-1234-5678 · 01012345678 · 1234-5678 · +82 10 … 어떤 형식이든
--       승인 대기 없이 바로 「사용 중」(active · approved) · 로그인용 해시(staff.phone_hash · 047 과 같은 방식) + 문자용 번호(staff_phones) 둘 다
--       로그인은 지금처럼 이름 + 번호 8자리 (staff-login 함수 그대로 · 처음 들어올 때 로그인 계정을 만든다)
--       같은 번호가 다른 운영진에 있으면 막고 「김조교(사용 중)」처럼 누구인지 알려 준다
--       그 번호로 승인 대기 · 거절된 사람이 있으면 새로 만들지 않고 그 사람을 이 이름으로 승인한다
--  2. staff_phone_set(이메일, 번호) — 원장만. 운영진 줄의 번호 넣기 · 바꾸기
--       조교 — 로그인 번호도 같이 바뀐다 (해시 · 뒤 4자리 · 문자용 번호)
--       원장 — 문자용 번호만 (원장 로그인은 이메일 + 비밀번호 그대로 · 번호 로그인을 만들지 않는다)
--  3. staff_list — 069 와 같고 문자 번호 뒤 4자리(smsLast4) · 로그인 번호 있음 · 누가 등록했는지(addedBy)를 더함
--       화면에는 010-****-5678 처럼 뒤 4자리만 (전체 번호는 돌려주지 않는다)
--  과제 현황 문자(_hws_people) · 필기 알림(운영진)은 staff_phones 를 읽으므로 등록하자마자 받는다 (고칠 것 없음)
--  조교가 직접 처음 로그인해 승인 대기로 들어오는 기존 방식(staff_phone_login · 051)은 그대로다.
-- ============================================================

alter table public.staff add column if not exists added_by text;
alter table public.staff add column if not exists added_at timestamptz;


-- ------------------------------------------------------------
--  도우미 (안에서만)
-- ------------------------------------------------------------
/* 번호 → 010 뺀 8자리 (010 번호가 아니면 null) */
create or replace function public._staff_ph8(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^8210[0-9]{8}$' then d := '0' || substr(d, 3); end if;
  if d ~ '^[0-9]{8}$' then d := '010' || d; end if;
  if d ~ '^010[0-9]{8}$' then return right(d, 8); end if;
  return null;
end;
$$;
revoke all on function public._staff_ph8(text) from public, anon, authenticated;

/* 이 번호를 이미 쓰는 다른 운영진 — 「이름(상태)」 · 없으면 null */
create or replace function public._staff_phone_who(p_ph8 text, p_except text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(s.name), ''), '이름 없음') || '(' ||
         case when s.approval = 'pending' then '승인 대기' when s.approval = 'rejected' then '거절됨'
              when not s.active then '사용 중지' when s.role = 'teacher' then '원장' else '사용 중' end || ')'
    from public.staff s
   where lower(s.email) <> lower(coalesce(p_except, ''))
     and (s.phone_hash = public._phone_hash(p_ph8)
          or exists (select 1 from public.staff_phones p where lower(p.email) = lower(s.email) and regexp_replace(p.phone, '\D', '', 'g') = '010' || p_ph8))
   order by (s.approval = 'approved') desc, s.created_at
   limit 1;
$$;
revoke all on function public._staff_phone_who(text, text) from public, anon, authenticated;


-- ------------------------------------------------------------
--  1. 조교 추가 — 원장만
-- ------------------------------------------------------------
create or replace function public.staff_add(p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nm  text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 20);
  ph  text := public._staff_ph8(p_phone);
  h   text;
  em  text;
  s   record;
  who text;
begin
  if not public._real_teacher() then raise exception '조교 추가는 원장 계정만 할 수 있습니다.'; end if;
  if nm = '' or nm ~ '^[0-9\s-]+$' then raise exception '조교 이름을 넣어 주세요.'; end if;
  if ph is null then raise exception '휴대폰 번호를 010-1234-5678 처럼 넣어 주세요.'; end if;
  h := public._phone_hash(ph);

  /* 그 번호로 승인 대기 · 거절된 사람 → 새로 만들지 않고 이 이름으로 승인 */
  select * into s from public.staff where phone_hash = h and approval in ('pending', 'rejected') and role <> 'teacher' limit 1;
  if found then
    who := public._staff_phone_who(ph, s.email);
    if who is not null then raise exception '이미 등록된 번호입니다 — %', who; end if;
    update public.staff set name = nm, approval = 'approved', active = true, approved_by = public._staff_name(), approved_at = now(),
           added_by = public._staff_name(), added_at = now(), phone_last4 = right(ph, 4),
           disabled_by = null, disabled_at = null
     where email = s.email;
    insert into public.staff_phones (email, phone) values (s.email, '010' || ph)
      on conflict (email) do update set phone = excluded.phone, updated_at = now();
    return jsonb_build_object('ok', true, 'email', s.email, 'name', nm, 'last4', right(ph, 4), 'was', s.approval);
  end if;

  who := public._staff_phone_who(ph, '');
  if who is not null then raise exception '이미 등록된 번호입니다 — %', who; end if;

  em := 'ph-' || left(h, 24) || '@coach.marathonstudy.github.io';
  if exists (select 1 from public.staff where email = em) then          /* 예전에 이 번호를 쓰다 바꾼 사람의 계정 — 겹치지 않게 */
    em := 'ph-' || left(encode(sha256(convert_to(h || ':' || clock_timestamp()::text, 'UTF8')), 'hex'), 24) || '@coach.marathonstudy.github.io';
  end if;
  insert into public.staff (email, name, role, active, phone_hash, phone_last4, approval, approved_by, approved_at, added_by, added_at)
  values (em, nm, 'assistant', true, h, right(ph, 4), 'approved', public._staff_name(), now(), public._staff_name(), now());
  insert into public.staff_phones (email, phone) values (em, '010' || ph)
    on conflict (email) do update set phone = excluded.phone, updated_at = now();
  return jsonb_build_object('ok', true, 'email', em, 'name', nm, 'last4', right(ph, 4), 'was', 'new');
end;
$$;
revoke all on function public.staff_add(text, text) from public, anon;
grant execute on function public.staff_add(text, text) to authenticated;


-- ------------------------------------------------------------
--  2. 번호 넣기 · 바꾸기 — 원장만
-- ------------------------------------------------------------
create or replace function public.staff_phone_set(p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k   text := lower(btrim(coalesce(p_email, '')));
  ph  text := public._staff_ph8(p_phone);
  s   record;
  who text;
begin
  if not public._real_teacher() then raise exception '운영진 번호는 원장 계정만 넣거나 바꿀 수 있습니다.'; end if;
  if ph is null then raise exception '휴대폰 번호를 010-1234-5678 처럼 넣어 주세요.'; end if;
  select * into s from public.staff where email = k and approval = 'approved';
  if not found then raise exception '그 운영진을 찾지 못했습니다.'; end if;
  who := public._staff_phone_who(ph, k);
  if who is not null then raise exception '이미 등록된 번호입니다 — %', who; end if;

  if s.role <> 'teacher' then
    update public.staff set phone_hash = public._phone_hash(ph), phone_last4 = right(ph, 4) where email = k;   /* 로그인 번호도 같이 */
  end if;
  insert into public.staff_phones (email, phone) values (k, '010' || ph)
    on conflict (email) do update set phone = excluded.phone, updated_at = now();
  return jsonb_build_object('ok', true, 'last4', right(ph, 4), 'login', s.role <> 'teacher');
end;
$$;
revoke all on function public.staff_phone_set(text, text) from public, anon;
grant execute on function public.staff_phone_set(text, text) to authenticated;


-- ------------------------------------------------------------
--  3. 운영진 목록 (069 와 같고 문자 번호 뒤 4자리 · 로그인 번호 · 등록한 사람을 더함)
-- ------------------------------------------------------------
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
    'hwCut', public._hws_cut(),
    'canAdd', true,
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'email', s.email, 'name', s.name, 'role', s.role, 'active', s.active,
               'last4', s.phone_last4, 'phone', s.phone_hash is not null,
               'created_at', s.created_at, 'last_seen_at', s.last_seen_at,
               'disabled_by', s.disabled_by, 'disabled_at', s.disabled_at, 'approved_by', s.approved_by, 'approved_at', s.approved_at,
               'addedBy', s.added_by,
               'hwStatus', coalesce(s.hw_status, true),
               'smsPhone', coalesce((select p.phone <> '' from public._hws_people() p where p.email = s.email), false),
               'smsLast4', coalesce((select right(p.phone, 4) from public._hws_people() p where p.email = s.email and p.phone <> ''),
                                    (select right(regexp_replace(sp.phone, '\D', '', 'g'), 4) from public.staff_phones sp where lower(sp.email) = lower(s.email) limit 1),
                                    ''))
             order by s.active desc, s.role desc, s.created_at) from public.staff s where s.approval = 'approved'), '[]'::jsonb));
end;
$$;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '조교 추가 함수' as what, (to_regprocedure('public.staff_add(text, text)') is not null)::text as ok
union all select '번호 넣기 · 바꾸기 함수', (to_regprocedure('public.staff_phone_set(text, text)') is not null)::text
union all select '번호 형식 010-1234-5678', (public._staff_ph8('010-1234-5678') = '12345678')::text
union all select '원장만 (조교 추가 · 번호)', (position('_real_teacher' in pg_get_functiondef('public.staff_add(text, text)'::regprocedure)) > 0
                                          and position('_real_teacher' in pg_get_functiondef('public.staff_phone_set(text, text)'::regprocedure)) > 0)::text
union all select '번호 없는 운영진 ' || (select count(*) from public.staff s where s.active and s.approval = 'approved'
                                          and not exists (select 1 from public.staff_phones p where lower(p.email) = lower(s.email))) || '명', 'true';
