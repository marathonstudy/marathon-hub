-- ============================================================
--  migration-109-parts-zero-strip.sql — 20261113e · 106 · 107 · 108 다음에 실행 · 여러 번 실행해도 됨
--  예전 받기 함수 버그로 남은 「맞힌 수 0」 영역 정보 지우기
--    108 은 옛 기록에서 그런 과제가 3개 이상이고 모두 0 인 학생만 비우고 다시 받게 했다
--    → 3개 미만이거나 바른 과제와 섞인 학생 · 지금 기록(data) · 달별 옛 기록(app_old_parts)에 남은 것은 그대로였다
--  「맞힌 수 0」 과제 = 영역 정보(parts)가 있는데 어느 영역도 맞힌 수가 0 보다 크지 않고,
--                       과제 맞힌 수 0 · 문제 수 > 0 이 따로 오지 않았고(진짜로 다 틀린 것이 아님), 정답률 칸도 0 보다 크지 않은 것
--  → 그 과제의 parts 칸만 뺀다(과제 · 제출 날짜 · 지각 · 정답률 칸은 그대로 → 제출 · 배지 셈은 그대로 · 능력치 · 정답률에서만 빠짐)
--  학생 이름 · 번호는 건드리지 않는다
-- ============================================================

create or replace function public._parts_bug(h jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(h -> 'parts') = 'array' and h -> 'parts' <> '[]'::jsonb
    and not exists (select 1 from jsonb_array_elements(h -> 'parts') p where coalesce(p ->> 'k', '') ~ '^\d+(\.\d+)?$' and (p ->> 'k')::numeric > 0)
    and not (coalesce(h ->> 'correct', '') = '0' and coalesce(h ->> 'total', '') ~ '^\d+$' and (h ->> 'total')::int > 0)
    and not (coalesce(h ->> 'correctRate', '') ~ '^\d+(\.\d+)?$' and (h ->> 'correctRate')::numeric > 0), false);
$$;
revoke all on function public._parts_bug(jsonb) from public, anon, authenticated;

create or replace function public._parts_strip(p_hist jsonb)
returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p_hist) <> 'array' then p_hist
              else coalesce((select jsonb_agg(case when public._parts_bug(h) then h - 'parts' else h end order by i)
                               from jsonb_array_elements(p_hist) with ordinality t(h, i)), '[]'::jsonb) end;
$$;
revoke all on function public._parts_strip(jsonb) from public, anon, authenticated;

create or replace function public._parts_has_bug(p_hist jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_hist) = 'array' and exists (select 1 from jsonb_array_elements(p_hist) h where public._parts_bug(h));
$$;
revoke all on function public._parts_has_bug(jsonb) from public, anon, authenticated;

update public.app_records set data = jsonb_set(data, '{history}', public._parts_strip(data -> 'history'))
 where data is not null and public._parts_has_bug(data -> 'history');
update public.app_records set old = jsonb_set(old, '{history}', public._parts_strip(old -> 'history'))
 where old is not null and public._parts_has_bug(old -> 'history');
update public.app_old_parts set history = public._parts_strip(history)
 where public._parts_has_bug(history);

-- 확인 (모두 true 여야 함)
select '지금 기록에 맞힌 수 0 남지 않음' as what, (not exists (select 1 from public.app_records where data is not null and public._parts_has_bug(data -> 'history')))::text as ok
union all select '옛 기록에 맞힌 수 0 남지 않음', (not exists (select 1 from public.app_records where old is not null and public._parts_has_bug(old -> 'history')))::text
union all select '달별 옛 기록에 맞힌 수 0 남지 않음', (not exists (select 1 from public.app_old_parts where public._parts_has_bug(history)))::text;
