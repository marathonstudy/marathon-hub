-- ============================================================
--  migration-096-mascot.sql — 마라토니 · 마라부기 진짜 그림 · 동물 러너 토끼 · 거북 → 사슴 · 코알라 (20261110f)
--  (096 은 095 다음 · 093 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음)
--  1. 이미 토끼(rabbit) · 거북(turtle)을 고른 학생 → 마라토니(maratoni) · 마라부기(marabugi)로 옮긴다 (마스코트가 토끼 · 거북)
--  2. 캐릭터 저장(hub_profile_save) — 사슴(deer) · 코알라(koala)를 받고, 예전 화면이 rabbit · turtle 을 보내면 마스코트로 바꿔 저장
-- ============================================================
update public.student_game set char = case char when 'rabbit' then 'maratoni' when 'turtle' then 'marabugi' else char end, updated_at = now()
 where char in ('rabbit', 'turtle');

create or replace function public.hub_profile_save(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; ch text;
  chars text[] := array['maratoni','marabugi','deer','koala','cheetah','penguin','fox','bear','cat','dog','otter','owl','squirrel','hedgehog'];
  frames text[] := array['violet','mint','coral','navy','silver','gold'];
  props text[] := array['none','headband','cap','shoes','silver','gold','trophy'];
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if public._hub_role(p_code) is distinct from 'student' then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  ch := case p ->> 'char' when 'rabbit' then 'maratoni' when 'turtle' then 'marabugi' else p ->> 'char' end;
  if (p ? 'char' and not (ch = any(chars))) or (p ? 'frame' and not (p ->> 'frame' = any(frames)))
     or (p ? 'prop' and not (p ->> 'prop' = any(props))) then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  insert into public.student_game (student_id) values (s.id) on conflict (student_id) do nothing;
  update public.student_game set
    char = case when p ? 'char' then ch else char end, frame = coalesce(p ->> 'frame', frame), prop = coalesce(p ->> 'prop', prop),
    seen_level = case when (p ->> 'seen_level') ~ '^[0-9]$' then greatest(seen_level, (p ->> 'seen_level')::smallint) else seen_level end,
    seen_perfect = case when (p ->> 'seen_perfect') ~ '^\d{4}-\d{2}-\d{2}$' then greatest(seen_perfect, p ->> 'seen_perfect') else seen_perfect end,
    updated_at = now()
   where student_id = s.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.hub_profile_save(text, jsonb) from public;
grant execute on function public.hub_profile_save(text, jsonb) to anon, authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '토끼 · 거북 고른 학생 0명 (마라토니 · 마라부기로 옮김)' as what, (not exists (select 1 from public.student_game where char in ('rabbit', 'turtle')))::text as ok
union all select '사슴 · 코알라 저장 가능', (position('''koala''' in pg_get_functiondef('public.hub_profile_save(text, jsonb)'::regprocedure)) > 0)::text;
