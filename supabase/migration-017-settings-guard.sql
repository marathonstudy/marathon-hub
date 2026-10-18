-- ============================================================
--  마라톤 코치룸 — 설정 보호 보강 (migration-017-settings-guard.sql)
--
--  실행 방법
--    016 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 기록 · 레포트 · 설정 값은 바꾸지 않는다.
--
--  고치는 것 (보안 점검에서 찾은 것)
--  1. app_settings 의 key 이름 바꾸기 막기
--     지금은 조교가 'links' · 'dashboard' 줄의 key 를 다른 이름으로 바꾸면(UPDATE … set key = 'x')
--     선생님 전용 검사를 피해 전환 기간 스위치 · 조교 금액 숨김이 기본값(켜짐)으로 돌아갈 수 있었다.
--     코치룸 화면은 key 를 바꾸지 않는다 (값만 저장) — 화면 동작은 그대로다.
--  2. 'textbook_bank'(학부모에게 보이는 교재비 계좌) · 'ai_summary'(AI 요약 월 상한) 는 선생님만 바꾼다
--     지금은 조교 계정으로도 계좌번호를 바꿀 수 있어, 학부모 화면의 입금 계좌가 바뀔 수 있었다.
--     (AI 상한은 화면에서는 이미 선생님만 — 표를 직접 고치는 길도 막는다)
--     ※ 실행하면 조교 계정의 「교재 → 계좌 안내 [저장]」은 "선생님 계정만" 안내와 함께 저장되지 않는다.
--  3. 'links' 줄이 없을 때 학부모 링크 입력은 '막힘'으로 (지금은 '허용'으로 본다)
--     015 가 'links' 줄을 넣어 두므로 평소에는 달라지는 것이 없다.
--
--  SQL Editor(선생님이 직접 실행)에서는 예전처럼 무엇이든 바꿀 수 있다.
-- ============================================================


create or replace function public._settings_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  by_user boolean := auth.jwt() is not null and coalesce(auth.jwt() ->> 'email', '') <> '';
begin
  if not by_user then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  /* 1. key 이름은 바꾸지 않는다 (값만 바꾼다) */
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception '설정 이름(key)은 바꿀 수 없습니다.';
  end if;
  /* 2. 계좌 안내 · AI 상한은 선생님만 */
  if ((tg_op = 'DELETE' and old.key in ('textbook_bank', 'ai_summary'))
      or (tg_op <> 'DELETE' and new.key in ('textbook_bank', 'ai_summary')))
     and not public.is_teacher() then
    raise exception '계좌 안내 · AI 요약 상한은 선생님(teacher) 계정만 바꿀 수 있습니다.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists app_settings_key_guard on public.app_settings;
create trigger app_settings_key_guard before insert or update or delete on public.app_settings
  for each row execute function public._settings_key_guard();

revoke all on function public._settings_key_guard() from public, anon, authenticated;


/* 3. 'links' 줄이 없으면 학부모 링크는 보기만 */
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
--  확인
-- ============================================================
select 'key guard' as what, exists (select 1 from pg_trigger where tgname = 'app_settings_key_guard')::text as ok
union all select 'links row', exists (select 1 from public.app_settings where key = 'links')::text;
