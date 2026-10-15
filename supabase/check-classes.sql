-- ============================================================
--  반 이름 점검 (check-classes.sql) — 읽기 전용. 아무것도 바꾸지 않는다.
--
--  SQL Editor → New query → 붙여넣고 Run.
--  migration-009 를 실행하기 전 · 후 모두 쓸 수 있다.
--  반 이름마다 어느 표에 몇 줄 있는지, 이름이 비슷한 반이 있는지 보여 준다.
--  (반 이름과 숫자만 나온다. 학생 이름 · 연락처는 나오지 않는다.)
--
--  칸 뜻
--    다니는_학생 / 퇴원생  students (명단)
--    반현황                class_info (반 칸 관리에서 적은 값)
--    공용링크              class_codes (반 공지 공용 주소)
--    공지                  class_notices (올린 반 공지 수)
--    교재학원 / 교재 / 일정  tb_class_academy / tb_class_books / tb_class_dates
--    시험                  app_settings 'exams' 의 반별 시험
--    반목록                classes (migration-009 의 반 기준 표 — 실행 전에는 0)
--    비슷한_이름           띄어쓰기 · 끝의 '반' · 대소문자만 다른 반
-- ============================================================

with src as (
  select btrim(class_name) as n, case when archived then 'archived' else 'student' end as k from public.students
  union all select btrim(class_name), 'info'    from public.class_info
  union all select btrim(class_name), 'code'    from public.class_codes
  union all select btrim(class_name), 'notice'  from public.class_notices
  union all select btrim(class_name), 'academy' from public.tb_class_academy
  union all select btrim(class_name), 'book'    from public.tb_class_books
  union all select btrim(class_name), 'date'    from public.tb_class_dates
  union all
  select btrim(k), 'exam'
  from public.app_settings s,
       jsonb_object_keys(case when jsonb_typeof(s.value -> 'byClass') = 'object' then s.value -> 'byClass' else '{}'::jsonb end) k
  where s.key = 'exams'
  union all
  /* classes 표가 아직 없어도 오류가 나지 않게 — 있을 때만 읽는다 */
  select btrim(x::text), 'classes'
  from unnest(case when to_regclass('public.classes') is not null
                   then xpath('/table/row/name/text()', query_to_xml('select name from public.classes', true, false, ''))
                   else array[]::xml[] end) x
), g as (
  select n,
         count(*) filter (where k = 'student')  as 다니는_학생,
         count(*) filter (where k = 'archived') as 퇴원생,
         count(*) filter (where k = 'info')     as 반현황,
         count(*) filter (where k = 'code')     as 공용링크,
         count(*) filter (where k = 'notice')   as 공지,
         count(*) filter (where k = 'academy')  as 교재학원,
         count(*) filter (where k = 'book')     as 교재,
         count(*) filter (where k = 'date')     as 일정,
         count(*) filter (where k = 'exam')     as 시험,
         count(*) filter (where k = 'classes')  as 반목록,
         lower(regexp_replace(regexp_replace(n, '\s+', '', 'g'), '반$', '')) as nk
  from src
  where coalesce(n, '') <> ''
  group by n
)
select g.n as 반_이름, 다니는_학생, 퇴원생, 반현황, 공용링크, 공지, 교재학원, 교재, 일정, 시험, 반목록,
       (select string_agg(g2.n, ', ' order by g2.n) from g g2 where g2.nk = g.nk and g2.n <> g.n) as 비슷한_이름
from g
order by g.n;
