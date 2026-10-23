-- ============================================================
--  마라톤 코치룸 — D-day 시험 여러 개 · 시험마다 전체 반 / 특정 반 · 과정 (migration-034-exams.sql)
--
--  실행 방법
--    033 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표는 그대로다 (app_settings 의 'exams' 한 줄 · 함수 하나만 바꿔 쓴다).
--
--  'exams' = { exams: [{ id, name, date, scope: { all: true } | { all: false, classes: [반], courses: [과정 id] } }] }
--    · scope 가 없는 예전 시험은 전체 반
--    · 그 반에 드는 시험 중 오늘 이후 가장 가까운 시험 하나를 띠에 (당일은 D-day · 지나면 다음 시험으로)
--    · 띠를 누르면 그 반에 드는 시험 전체를 날짜순으로 (list · 지난 시험도)
--    · 그 반에 드는 다가오는 시험이 없으면 null → 띠를 숨긴다
--  _exam_for_class(반) 를 쓰는 함수(러닝노트 hub_get · 반 공지)는 그대로 — 'exam' 에 list 가 더해진다
--  예전 「반마다 고른 시험 · 고정」(byClass · mode)은 새 화면에서 쓰지 않는다 (지우지는 않는다)
-- ============================================================

create or replace function public._exam_for_class(p_class text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
  cls text := btrim(coalesce(p_class, ''));
  courses text[];
  lst jsonb;
  hit jsonb;
begin
  select value into cfg from public.app_settings where key = 'exams';
  if cfg is null then return null; end if;
  /* 이 반이 지금 든 과정 (033 · 없으면 빈 목록) */
  begin
    execute 'select coalesce(array_agg(course_id::text), ''{}'') from public.course_members where class_name = $1 and to_no is null'
      into courses using cls;
  exception when others then courses := '{}';
  end;

  select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'date', e ->> 'date') order by (e ->> 'date')::date, e ->> 'name'), '[]'::jsonb)
    into lst
  from jsonb_array_elements(coalesce(cfg -> 'exams', '[]'::jsonb)) e
  where (e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and btrim(coalesce(e ->> 'name', '')) <> ''
    and (
      e -> 'scope' is null or coalesce((e -> 'scope' ->> 'all')::boolean, true)
      or (cls <> '' and coalesce(e -> 'scope' -> 'classes', '[]'::jsonb) ? cls)
      or exists (select 1 from jsonb_array_elements_text(coalesce(e -> 'scope' -> 'courses', '[]'::jsonb)) c where c = any(courses))
    );

  select x into hit from jsonb_array_elements(lst) x where (x ->> 'date')::date >= today limit 1;
  if hit is null then return null; end if;
  return jsonb_build_object('name', hit ->> 'name', 'date', hit ->> 'date', 'list', lst);
end;
$$;

revoke all on function public._exam_for_class(text) from public, anon, authenticated;


-- ============================================================
--  확인 — 한 줄 true
-- ============================================================
select 'exam list' as what, (pg_get_functiondef('public._exam_for_class(text)'::regprocedure) like '%''list''%')::text as ok;
