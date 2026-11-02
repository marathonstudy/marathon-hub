-- ============================================================
--  check-report-missing.sql — 읽기 전용 (20261102e)
--  레포트 발송 목록 「공개 26/27 · 발송 26/27」에서 빠진 학생이 누구이고 왜 빠졌는지
--  (아무것도 바꾸지 않는다 — select 만)
--
--  맨 아래 두 값만 바꿔서 쓴다: 반 이름 · 수업일
--    지금: 반포반 · 2026-11-01(일)
--
--  세는 기준 (staff_class_weeks 와 같다)
--    전체 = 그 반 학생 중 퇴원 처리(archived) 안 한 학생 — 수강 시작 전 신입생도 들어 있다
--    공개 = 그 주(월~일)에 공개(visible)된 레포트가 있는 학생
--    발송 = 그 주에 「보냄」(sent) 기록이 있는 학생 — 레포트 안내 문자가 성공했거나 카톡으로 보냈을 때
--  결과: 빠진 학생마다 이름 · 수강 시작 · 레포트 상태 · 발송 결과 · 실패 사유 · 이유
-- ============================================================
with p as (
  select '반포반'::text as cls, date '2026-11-01' as lesson_day
),
wk as (
  select cls, lesson_day, public._monday(lesson_day) as mon, public._monday(lesson_day) + 6 as sun from p
),
st as (
  select s.id, s.name, s.start_on, s.left_on, s.student_phone, s.parent_phone, s.parent_phone2
  from public.students s, wk where s.class_name = wk.cls and not s.archived
),
pub as (
  select distinct x.student_id from public.published x, wk
  where x.week_start between wk.mon and wk.sun and x.visible and x.student_id in (select id from st)
),
snt as (
  select x.student_id, max(x.via) as via from public.sent x, wk
  where x.week_start between wk.mon and wk.sun and x.student_id in (select id from st) group by 1
),
ent as (
  select distinct x.student_id from public.entries x, wk
  where x.week_start between wk.mon and wk.sun and x.student_id in (select id from st)
    and (btrim(coalesce(x.comment, '')) <> '' or coalesce(x.attend_status, '') <> '')
),
lg as (
  select distinct on (l.student_id) l.student_id, l.target, l.status, l.error, l.phone_last4, l.created_at
  from public.sms_log l, wk
  where l.mark_week between wk.mon and wk.sun and not l.test and l.student_id in (select id from st)
  order by l.student_id, l.created_at desc
)
select
  st.name                                                         as "이름",
  coalesce(to_char(st.start_on, 'MM/DD'), '')                     as "수강 시작",
  case when pub.student_id is not null then '공개함'
       when ent.student_id is not null then '작성 중(공개 안 함)'
       else '레포트 작성 전' end                                   as "레포트 상태",
  case when snt.student_id is not null then '보냄(' || coalesce(snt.via, '') || ')'
       when lg.student_id is null then '보낸 기록 없음'
       else coalesce(lg.status, '') || ' · ' || coalesce(lg.target, '') || ' ****' || coalesce(lg.phone_last4, '') || ' · ' || to_char(lg.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') end
                                                                  as "발송 결과",
  coalesce(nullif(lg.error, ''), '')                              as "실패 사유",
  case
    when st.start_on is not null and st.start_on > (select lesson_day from p) then '수강 시작 전 · 대상 제외'
    when st.left_on is not null and st.left_on < (select lesson_day from p) then '퇴원 · 대상 제외'
    when pub.student_id is null then case when ent.student_id is not null then '작성 중(공개 안 함)' else '레포트 작성 전' end
    when not (public._phone_ok(st.student_phone) or public._phone_ok(st.parent_phone) or public._phone_ok(st.parent_phone2)) then '번호 없음(학생 · 학부모)'
    when lg.status = 'fail' and lg.error like '%바뀌지 않은 칸%' then '바뀌지 않은 칸이 있어 보내지 않음'
    when lg.status = 'fail' then '문자 발송 실패'
    when lg.status = 'pending' then '보내는 중'
    else '공개함 · 아직 안 보냄' end                               as "이유"
from st
left join pub on pub.student_id = st.id
left join snt on snt.student_id = st.id
left join ent on ent.student_id = st.id
left join lg  on lg.student_id  = st.id
where pub.student_id is null or snt.student_id is null
order by st.name;
