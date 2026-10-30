-- ============================================================
--  읽기 전용 — 반마다 수업 요일 · 시각 · 종강일 · 필기 문자 설정이 DB 에 어떻게 들어 있는지 (20261101f)
--  Supabase SQL Editor 에 붙여 넣고 Run. 아무것도 바꾸지 않는다.
-- ============================================================
select name as "반", archived as "보관",
       case when lesson_dow is null then '—' else (array['일','월','화','수','목','금','토'])[lesson_dow + 1] end as "요일",
       coalesce(to_char(start_time, 'HH24:MI'), '—') as "시작", coalesce(to_char(end_time, 'HH24:MI'), '—') as "끝",
       coalesce(to_char(end_on, 'YYYY-MM-DD'), '—') as "종강",
       note_remind as "필기 문자", remind_min as "끝나기 n분 전", cardinality(staff_emails) as "담당 운영진 수"
  from public.classes
 order by archived, name;
