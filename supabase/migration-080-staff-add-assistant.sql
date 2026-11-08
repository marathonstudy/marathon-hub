-- ============================================================
--  migration-080-staff-add-assistant.sql — 조교도 [조교 추가] (20261108l)
--  (080 은 079 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  1. staff_add — 원장뿐 아니라 사용 중인 조교도 (서버가 「사용 중인 운영진」인지 본다 · 승인 대기 · 사용 중지 계정은 안 됨)
--       나머지(번호 형식 · 같은 번호 막기 · 승인 대기 · 거절된 번호면 그 사람을 승인 · 바로 사용 중)는 070 그대로 · 알림 문자 없음
--  2. staff_phone_set — 원장은 누구 번호든 · 조교는 자기 번호만 (조교는 로그인 번호도 같이 바뀐다)
--       사용 중지(staff_set_active 등)는 지금처럼 원장만 (바꾸지 않음)
--  3. staff_list — 070 과 같고 추가한 때(addedAt) · canAdd = 사용 중인 운영진
--       화면 각 줄 「추가한 사람: 김민서 · 11/8」
-- ============================================================

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
  /* 사용 중인 운영진(원장 · 조교) 누구나 — 승인 대기 · 사용 중지 계정은 is_staff 가 아니다 (080) */
  if not public.is_staff() then raise exception '조교 추가는 사용 중인 운영진만 할 수 있습니다.'; end if;
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


create or replace function public.staff_phone_set(p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k   text := lower(btrim(coalesce(p_email, '')));
  ph  text := public._staff_ph8(p_phone);
  s   record;
  who text;
begin
  /* 원장은 누구 번호든 · 조교는 자기 번호만 (080) */
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if not public._real_teacher() and k <> lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception '다른 운영진 번호는 원장 계정만 넣거나 바꿀 수 있습니다 — 조교는 자기 번호만 바꿀 수 있습니다.'; end if;
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
    'canAdd', public.is_staff(), 'assistAdd', true,
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'email', s.email, 'name', s.name, 'role', s.role, 'active', s.active,
               'last4', s.phone_last4, 'phone', s.phone_hash is not null,
               'created_at', s.created_at, 'last_seen_at', s.last_seen_at,
               'disabled_by', s.disabled_by, 'disabled_at', s.disabled_at, 'approved_by', s.approved_by, 'approved_at', s.approved_at,
               'addedBy', s.added_by, 'addedAt', s.added_at,
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
select '조교도 조교 추가 (사용 중인 운영진)' as what, (position('is_staff()' in pg_get_functiondef('public.staff_add(text, text)'::regprocedure)) > 0
                                          and position('_real_teacher' in pg_get_functiondef('public.staff_add(text, text)'::regprocedure)) = 0)::text as ok
union all select '번호 바꾸기 — 원장은 누구든 · 조교는 자기 것만', (position('조교는 자기 번호만' in pg_get_functiondef('public.staff_phone_set(text, text)'::regprocedure)) > 0)::text
union all select '목록에 추가한 때', (position('addedAt' in pg_get_functiondef('public.staff_list()'::regprocedure)) > 0)::text;
