-- ============================================================
--  check-report-send-1108.sql — 11/8 반포반 레포트 안내가 1건만 나간 이유 · 업데이트 문자가 하루 두 번 나간 이유 (읽기만 · 20261108q)
--
--  실행 방법 — Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여 넣는다.
--    SQL Editor 는 맨 마지막 표 하나만 보여 준다 → ① ~ ⑥ 을 하나씩 마우스로 골라(드래그) [Run] (고른 부분만 돈다).
--    아무것도 바꾸지 않는다 (select 만). 번호는 뒤 4자리만 보인다.
--  날 · 반을 바꾸려면 각 표 맨 위 params 의 값만 고친다.
--
--  ① 반포반 학생마다 — 공개 · 보냄 표시(어떻게 · 언제 · 누가) · 알림톡 · 문자 · 번호 · 링크 · 받았나 (25줄)
--  ② ①을 모아서 — 알림톡 몇 명 · 문자 몇 명 · 안 받은 학생 몇 명 · 학부모 번호 없는 학생
--  ③ 그날 누른 것 — 시각 · 누가 · 알림톡/문자 · 몇 건 (한 번 누를 때마다 한 줄)
--  ④ 그날 업데이트 문자 — 반 · 시각 · 자동/사람 · 학생 수 · 항목
--  ⑤ 업데이트 문자를 부른 변경 — 반 · 시각 · 종류(영상 · 자료 · 공지 · 다시 공개) · 학생 수 · 어느 발송으로 갔나
--  ⑥ 그날 다시 공개한 레포트 — 어느 칸이 바뀌었나 (코멘트 · 출석 · 과제 · 수업 내용 …)
-- ============================================================

-- ① 학생마다
with params as (select date '2026-11-08' as d, '반포' as cls),
wk as (
  select coalesce(
    (select max(p.week_start) from public.published p join public.students s on s.id = p.student_id, params x
      where s.class_name like '%' || x.cls || '%' and left(coalesce(p.report_data ->> 'lessonDate', ''), 10) = x.d::text),
    (select max(p.week_start) from public.published p join public.students s on s.id = p.student_id, params x
      where s.class_name like '%' || x.cls || '%' and p.week_start <= x.d and p.week_start > x.d - 7)) as w
),
st as (
  select s.* from public.students s, params x
   where s.class_name like '%' || x.cls || '%' and not s.archived
)
select st.name                                                                            as "학생",
       st.class_name                                                                      as "반",
       (select w from wk)                                                                 as "레포트 주",
       case when p.visible then '공개' when p.student_id is not null then '숨김' else '없음' end as "공개",
       coalesce(t.via, '')                                                                as "보냄 표시(어떻게)",
       coalesce(to_char(t.sent_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), '')       as "보냄 표시 시각",
       coalesce((select nullif(btrim(sf.name), '') from public.staff sf where lower(sf.email) = lower(t.sent_by)), t.sent_by, '') as "누가",
       coalesce((select string_agg(to_char(k.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' ' || k.target || ' …' || k.phone_last4 || ' ' || k.status, ' / ' order by k.created_at)
                   from public.kakao_log k, wk where k.student_id = st.id and k.week_start = wk.w and not k.test), '')        as "알림톡",
       coalesce((select string_agg(to_char(l.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' ' || l.target || ' …' || l.phone_last4 || ' ' || l.status || ' ' || coalesce(b.label, ''), ' / ' order by l.created_at)
                   from public.sms_log l left join public.sms_batches b on b.id = l.batch_id, wk, params x
                  where l.student_id = st.id and not l.test
                    and (l.mark_week = wk.w or ((l.created_at at time zone 'Asia/Seoul')::date = x.d and (b.purpose = 'report' or coalesce(b.label, '') like '%레포트 안내%' or b.label = '대체 문자')))), '') as "문자",
       case when public._phone_ok(st.parent_phone) or public._phone_ok(st.parent_phone2) then '있음' else '없음' end as "학부모 번호",
       case when public._phone_ok(st.student_phone) then '있음' else '없음' end          as "학생 번호",
       case when coalesce(lk.hub_code, '') <> '' then '있음' else '없음' end             as "학부모 링크",
       case when t.student_id is not null then '받음' else '안 받음' end                  as "받았나"
  from st
  left join public.published p on p.student_id = st.id and p.week_start = (select w from wk)
  left join public.sent t on t.student_id = st.id and t.week_start = (select w from wk)
  left join public.student_links lk on lk.student_id = st.id
 order by "받았나" desc, st.name;

-- ② 모아서
with params as (select date '2026-11-08' as d, '반포' as cls),
wk as (
  select coalesce(
    (select max(p.week_start) from public.published p join public.students s on s.id = p.student_id, params x
      where s.class_name like '%' || x.cls || '%' and left(coalesce(p.report_data ->> 'lessonDate', ''), 10) = x.d::text),
    (select max(p.week_start) from public.published p join public.students s on s.id = p.student_id, params x
      where s.class_name like '%' || x.cls || '%' and p.week_start <= x.d and p.week_start > x.d - 7)) as w
),
st as (select s.* from public.students s, params x where s.class_name like '%' || x.cls || '%' and not s.archived)
select (select w from wk)                                                                               as "레포트 주",
       count(*)                                                                                         as "반 인원",
       count(*) filter (where p.visible)                                                                as "공개",
       count(t.student_id)                                                                              as "받음(보냄 표시)",
       count(*) filter (where t.via = 'kakao')                                                          as "알림톡",
       count(*) filter (where t.via = 'sitesms')                                                        as "사이트 문자",
       count(*) filter (where t.via in ('copy', 'share', 'sms'))                                        as "복사 · 공유 · 내 폰 문자",
       count(*) filter (where t.student_id is null)                                                     as "안 받음",
       count(*) filter (where t.student_id is null and coalesce(p.visible, false) = false)                      as "안 받음 중 공개 전",
       count(*) filter (where not (public._phone_ok(st.parent_phone) or public._phone_ok(st.parent_phone2))) as "학부모 번호 없음",
       count(*) filter (where exists (select 1 from public.kakao_log k where k.student_id = st.id and k.week_start = (select w from wk) and not k.test and k.status = 'fail')
                          and t.student_id is null)                                                     as "알림톡 실패 · 안 받음"
  from st
  left join public.published p on p.student_id = st.id and p.week_start = (select w from wk)
  left join public.sent t on t.student_id = st.id and t.week_start = (select w from wk);

-- ③ 그날 누른 것 (한 번 누를 때마다 한 줄)
with params as (select date '2026-11-08' as d, '반포' as cls)
select to_char(min(k.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS')                       as "시각",
       coalesce((select nullif(btrim(sf.name), '') from public.staff sf where lower(sf.email) = lower(k.created_by)), k.created_by) as "누가",
       '알림톡 ' || max(k.target)                                                              as "무엇",
       count(*)                                                                                 as "건수",
       count(*) filter (where k.status = 'ok')                                                  as "성공",
       count(*) filter (where k.status = 'fail')                                                as "실패",
       string_agg(distinct s.name, ', ')                                                        as "학생"
  from public.kakao_log k join public.students s on s.id = k.student_id, params x
 where (k.created_at at time zone 'Asia/Seoul')::date = x.d and s.class_name like '%' || x.cls || '%' and not k.test
 group by k.created_by, date_trunc('minute', k.created_at), k.target
union all
select to_char(min(l.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS'),
       coalesce((select nullif(btrim(sf.name), '') from public.staff sf where lower(sf.email) = lower(max(l.created_by))), max(l.created_by)),
       '문자 · ' || coalesce(max(b.label), '') || case when bool_or(l.mark_week is not null) then ' (레포트 발송에서)' else '' end,
       count(*), count(*) filter (where l.status = 'ok'), count(*) filter (where l.status = 'fail'),
       string_agg(distinct l.name, ', ')
  from public.sms_log l left join public.sms_batches b on b.id = l.batch_id, params x
 where (l.created_at at time zone 'Asia/Seoul')::date = x.d and l.class_name like '%' || x.cls || '%' and not l.test
 group by l.batch_id
 order by 1;

-- ④ 그날 업데이트 문자
with params as (select date '2026-11-08' as d)
select to_char(min(u.at) at time zone 'Asia/Seoul', 'HH24:MI:SS')                    as "시각",
       min(s.class_name)                                                              as "반",
       case when bool_or(u.manual) then '사람([지금 보내기])' else '자동' end            as "어떻게",
       count(distinct u.student_id)                                                   as "학생 수",
       (select string_agg(distinct i, ', ') from public.report_upd_log u2, unnest(u2.items) i where u2.id = any(array_agg(u.id))) as "항목"
  from public.report_upd_log u join public.students s on s.id = u.student_id, params x
 where u.day = x.d
 group by s.class_name, date_trunc('minute', u.at)
 order by 1;

-- ⑤ 업데이트 문자를 부른 변경 (state sent = 그 업데이트 문자로 나감)
with params as (select date '2026-11-08' as d)
select to_char(e.at at time zone 'Asia/Seoul', 'HH24:MI')                             as "변경 시각",
       e.class_name                                                                   as "반",
       case e.kind when 'video' then '수업 영상' when 'file' then '수업 자료' when 'notice' then '반 공지' when 'report' then '다시 공개(레포트)' else e.kind end as "종류",
       e.op                                                                           as "넣음/지움/바꿈",
       count(distinct e.student_id)                                                   as "학생 수",
       e.state                                                                        as "결과",
       coalesce(to_char(e.done_at at time zone 'Asia/Seoul', 'HH24:MI'), '')         as "처리 시각"
  from public.report_upd_ev e, params x
 where (e.at at time zone 'Asia/Seoul')::date = x.d
 group by 1, e.class_name, e.kind, e.op, e.state, 7
 order by e.class_name, 1;

-- ⑥ 그날 다시 공개한 레포트 — 처음 상태와 지금 (어느 칸이 바뀌었나 · 업데이트 문자를 보낸 뒤엔 처음 상태가 지워져 비어 있을 수 있다)
with params as (select date '2026-11-08' as d)
select s.class_name as "반", s.name as "학생",
       (select string_agg(k, ', ') from (
          select k from jsonb_object_keys(coalesce(b.data, '{}'::jsonb) || coalesce(p.report_data, '{}'::jsonb)) k
           where (b.data -> k) is distinct from (p.report_data -> k)) z)              as "바뀐 칸"
  from public.report_upd_base b join public.published p on p.week_start = b.week_start and p.student_id = b.student_id
  join public.students s on s.id = b.student_id, params x
 where (b.at at time zone 'Asia/Seoul')::date = x.d
 order by 1, 2;
