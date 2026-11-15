-- ============================================================
--  migration-115-finish-race.sql — 20261115c · 114 다음 · 여러 번 실행해도 됨
--  완주증 「레이스 기록 넣기」를 반마다 서버에 저장 (예전: 이 PC 에만 기억 → 다른 PC 에서 다르게 보였음)
--    classes.finish_race — 기본 켬(true) · 1년 완주증의 「나의 1년 레이스 기록」 쪽을 인쇄 · PDF 에 넣을지
--    finish_race_set(반, 켬) — 직원만
--  학생 정보는 건드리지 않는다 · 문자 · 알림톡 없음
-- ============================================================

alter table public.classes add column if not exists finish_race boolean not null default true;

create or replace function public.finish_race_set(p_class text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.classes set finish_race = coalesce(p_on, true) where name = p_class;
  if not found then return jsonb_build_object('ok', false, 'reason', 'class'); end if;
  return jsonb_build_object('ok', true, 'class', p_class, 'on', coalesce(p_on, true));
end;
$$;
revoke all on function public.finish_race_set(text, boolean) from public, anon;
grant execute on function public.finish_race_set(text, boolean) to authenticated;

-- 확인 (모두 true)
select 'classes.finish_race (기본 켬)' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'finish_race' and column_default = 'true')::text as ok
union all select 'finish_race_set — 직원만', (to_regprocedure('public.finish_race_set(text,boolean)') is not null
  and not has_function_privilege('anon', 'public.finish_race_set(text, boolean)', 'execute'))::text;
