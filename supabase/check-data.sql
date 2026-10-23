-- ============================================================
--  마라톤 코치룸 — 데이터 점검 (읽기 전용 · 숫자만) (check-data.sql · 20261030b)
--
--  SQL Editor → New query → 이 파일 전체 → Run. 아무것도 바꾸지 않는다.
--  학생 이름 · 번호는 나오지 않고 반마다 숫자만 나온다.
--    학생 수 · 학부모 번호 없는 학생 · 학생 번호 없는 학생 · 학부모 · 학생 번호가 같은 학생
--    수업 요일 · 첫 수업일 설정 여부 · 이번 주(한국 날짜 월요일 기준) 레포트 공개 · 발송 수
-- ============================================================

with st as (
  select coalesce(nullif(btrim(s.class_name), ''), '(반 없음)') as cls,
         regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g')  as p1,
         regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g') as p2,
         regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g') as sp,
         s.id
  from public.students s
  where not s.archived
),
wk as (select public._monday((now() at time zone 'Asia/Seoul')::date) as mon)
select st.cls as "반",
       count(*) as "학생",
       count(*) filter (where st.p1 = '' and st.p2 = '') as "학부모 번호 없음",
       count(*) filter (where st.sp = '') as "학생 번호 없음",
       count(*) filter (where st.sp <> '' and (st.sp = st.p1 or st.sp = st.p2)) as "학부모·학생 번호 같음",
       case when c.name is null then '반 목록에 없음'
            when c.lesson_dow is null and c.first_lesson is null then '요일 · 첫 수업일 없음'
            when c.lesson_dow is null then '요일 없음'
            when c.first_lesson is null then '첫 수업일 없음'
            else '설정됨' end as "수업 요일 · 첫 수업일",
       count(*) filter (where exists (select 1 from public.published p, wk where p.student_id = st.id and public._monday(p.week_start) = wk.mon and p.visible)) as "이번 주 공개",
       count(*) filter (where exists (select 1 from public.sent x, wk where x.student_id = st.id and public._monday(x.week_start) = wk.mon)) as "이번 주 발송"
from st left join public.classes c on c.name = st.cls
group by st.cls, c.name, c.lesson_dow, c.first_lesson
order by st.cls;
