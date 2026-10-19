-- ============================================================
--  마라톤 코치룸 — 조교 · 선생님 같은 권한 + 설정 보호 (migration-017-settings-guard.sql)
--
--  실행 방법
--    016 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 기록 · 레포트 · 설정 값은 바꾸지 않는다.
--
--  바꾸는 것
--  1. 조교(assistant)도 선생님(teacher)과 같은 기능을 쓴다
--     is_teacher() 가 '사용 중인 직원이면 참' 이 된다. 그래서 지금까지 선생님만 되던 것이 조교도 된다:
--     직원 관리 · 팀 가입 코드, 반 이름 바꾸기 · 보관 · 삭제 · 기본 문항 수, 상담 기록 · 성적 숨기기 · 되살리기 ·
--     숨긴 줄 보기, 필기 사진 완전 삭제, 반 파일 지우기 · 지난 파일 정리 · 지운 기록 보기, 지난 시험지 사진 정리,
--     「오늘」 설정 · 금액 보기, 전환 기간 스위치, AI 요약 월 상한, 반 변경 기록 보기, 교재 계좌 안내.
--  2. 예외 — 선생님 계정은 조교가 건드리지 못한다
--     조교는 선생님 계정을 사용 중지하거나 조교로 내릴 수 없고, 누구도 선생님으로 올릴 수 없다
--     (스스로 선생님이 된 뒤 다른 선생님을 중지하는 길을 막는다). 직원을 지우는 기능은 원래 없다.
--  3. app_settings 의 key 이름 바꾸기 막기 — 설정 줄이 다른 이름으로 바뀌어 사라지지 않게
--  4. 'links' 줄이 없을 때 학부모 링크 입력은 '막힘'으로 (015 가 줄을 넣어 두므로 평소에는 그대로)
--
--  학생 · 학부모 링크로 다른 학생 · 다른 반 정보, 상담, 성적, 금액이 나가지 않게 하는 검사는
--  015 · 016 의 링크 함수(_hub_student · hub_* )에 있고, 이 파일은 그것을 바꾸지 않는다.
--  SQL Editor(선생님이 직접 실행)에서는 예전처럼 무엇이든 바꿀 수 있다.
-- ============================================================


-- ------------------------------------------------------------
--  1. 진짜 선생님인지 (예외 검사에만 쓴다) · is_teacher() = 사용 중인 직원
-- ------------------------------------------------------------
create or replace function public._real_teacher()
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

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff();
$$;

revoke all on function public._real_teacher() from public, anon;
grant execute on function public._real_teacher() to authenticated;


-- ------------------------------------------------------------
--  2. 직원 관리 — 선생님 계정은 조교가 중지 · 역할 변경 못 함
-- ------------------------------------------------------------
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
  if not p_active and not public._real_teacher()
     and exists (select 1 from public.staff where email = k and role = 'teacher') then
    raise exception '선생님 계정은 조교 계정으로 사용 중지할 수 없습니다.';
  end if;
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
  if not public._real_teacher()
     and (p_role = 'teacher' or exists (select 1 from public.staff where email = k and role = 'teacher')) then
    raise exception '선생님 역할은 선생님 계정에서만 바꿀 수 있습니다.';
  end if;
  if p_role = 'assistant' and (select count(*) from public.staff where role = 'teacher' and active and email <> k) = 0 then
    raise exception '마지막 선생님 계정은 조교로 바꿀 수 없습니다.';
  end if;
  update public.staff set role = p_role where email = k;
  if not found then raise exception '그 직원을 찾지 못했습니다.'; end if;
end;
$$;

revoke all on function public.staff_set_active(text, boolean) from public, anon;
revoke all on function public.staff_set_role(text, text)      from public, anon;
grant execute on function public.staff_set_active(text, boolean) to authenticated;
grant execute on function public.staff_set_role(text, text)      to authenticated;


-- ------------------------------------------------------------
--  3. 설정 key 이름은 바꾸지 않는다 (값만 바꾼다)
-- ------------------------------------------------------------
create or replace function public._settings_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  by_user boolean := auth.jwt() is not null and coalesce(auth.jwt() ->> 'email', '') <> '';
begin
  if by_user and tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception '설정 이름(key)은 바꿀 수 없습니다.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists app_settings_key_guard on public.app_settings;
create trigger app_settings_key_guard before update on public.app_settings
  for each row execute function public._settings_key_guard();

revoke all on function public._settings_key_guard() from public, anon, authenticated;


-- ------------------------------------------------------------
--  4. 'links' 줄이 없으면 학부모 링크는 보기만
-- ------------------------------------------------------------
create or replace function public._parent_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value ->> 'parentWrite')::boolean from public.app_settings where key = 'links'), false);
$$;

insert into public.app_settings (key, value) values ('links', '{"parentWrite": true}'::jsonb)
on conflict (key) do nothing;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'same role' as what, (pg_get_functiondef('public.is_teacher()'::regprocedure) like '%is_staff()%')::text as ok
union all select 'key guard', exists (select 1 from pg_trigger where tgname = 'app_settings_key_guard')::text
union all select 'links row', exists (select 1 from public.app_settings where key = 'links')::text;
