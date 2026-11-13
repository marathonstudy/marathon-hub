-- ============================================================
--  check-ability-zero-1113.sql — 확인용 (읽기만 · 아무것도 바꾸지 않음) · 20261113e
--  예전 받기 함수 버그로 남은 「맞힌 수 0」 기록이 몇 건인지 (migration-109 앞 · 뒤 모두 돌려 보면 됨 · 109 뒤에는 모두 0 이어야 함)
--  「맞힌 수 0」 기록 = 과제 안 영역 정보(parts)가 있는데 어느 영역도 맞힌 수가 0 보다 크지 않고,
--                      과제 맞힌 수 0 · 문제 수 > 0 이 따로 오지 않았고(진짜로 다 틀린 것이 아님), 정답률 칸도 0 보다 크지 않은 것
--  한 표로 나온다 · 학생 이름 없음(숫자만)
-- ============================================================
with recs as (
  select r.student_id, 'data' w, h from public.app_records r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'history') = 'array' then r.data -> 'history' else '[]'::jsonb end) h
  union all
  select r.student_id, 'old', h from public.app_records r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.old -> 'history') = 'array' then r.old -> 'history' else '[]'::jsonb end) h
  union all
  select p.student_id, 'parts', h from public.app_old_parts p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.history) = 'array' then p.history else '[]'::jsonb end) h
), z as (
  select student_id, w, h,
         jsonb_typeof(h -> 'parts') = 'array' and h -> 'parts' <> '[]'::jsonb
         and not exists (select 1 from jsonb_array_elements(h -> 'parts') p where coalesce(p ->> 'k', '') ~ '^\d+(\.\d+)?$' and (p ->> 'k')::numeric > 0)
         and not (coalesce(h ->> 'correct', '') = '0' and coalesce(h ->> 'total', '') ~ '^\d+$' and (h ->> 'total')::int > 0)
         and not (coalesce(h ->> 'correctRate', '') ~ '^\d+(\.\d+)?$' and (h ->> 'correctRate')::numeric > 0) bug
    from recs
), area as (
  select w, coalesce(nullif(split_part(p ->> 'c', '-', 1), ''), '기타') a, count(*) n
    from z cross join lateral jsonb_array_elements(z.h -> 'parts') p where z.bug group by 1, 2
)
select 0 o, '합계' 어디, count(*) filter (where bug) "맞힌 수 0 기록", count(distinct student_id) filter (where bug) 학생수,
       coalesce((select string_agg(a || ' ' || n, ' · ' order by n desc) from (select a, sum(n) n from area group by a) x), '-') 영역
  from z
union all
select case w when 'data' then 1 when 'old' then 2 else 3 end,
       case w when 'data' then '지금 기록(app_records.data)' when 'old' then '옛 기록(app_records.old)' else '달별 옛 기록(app_old_parts)' end,
       count(*) filter (where bug), count(distinct student_id) filter (where bug),
       coalesce((select string_agg(a || ' ' || n, ' · ' order by n desc) from area where area.w = z.w), '-')
  from z group by w
union all
select 4, 'migration-109 실행됨', null, null, case when to_regprocedure('public._parts_bug(jsonb)') is not null then '예' else '아니오' end
order by o;
