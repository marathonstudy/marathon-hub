-- ============================================================
--  마라톤 코치룸 — 바뀌지 않은 칸({밀린날짜} 등)이 그대로 나간 문자 찾기 (check-unfilled-sms.sql · 20261101m)
--
--  읽기만 한다 — 아무것도 바꾸지 않는다 (select 두 개).
--  Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--
--  찾는 것: 오늘(한국 날짜) 문자 기록 중 내용 앞부분(60자)에 {…} · #{…} 칸이 남은 줄
--    · 이름 · 반 · 받는 곳(학생 · 학부모) · 번호 뒤 4자리 · 보낸 시각 · 결과(ok 접수됨 / fail 실패) · 묶음 이름(과제 독려 · 직접 보내기 …)
--    · 「나에게 시험 발송」은 빼고 센다
--  다른 날을 보려면 아래 두 곳의 (now() at time zone 'Asia/Seoul')::date 를 date '2026-11-01' 처럼 바꾼다.
--  주의: 기록에는 내용 앞 60자만 남는다 — 칸이 61번째 글자 뒤에 있었으면 여기 안 잡힌다.
-- ============================================================

-- 1) 한 사람씩 (보낸 시각 순)
select to_char(l.created_at at time zone 'Asia/Seoul', 'HH24:MI:SS')        as "보낸 시각",
       l.name                                                               as "학생",
       l.class_name                                                         as "반",
       case l.target when 'student' then '학생' when 'parent1' then '학부모' when 'parent2' then '학부모2' else l.target end as "받는 곳",
       '…' || l.phone_last4                                                 as "번호",
       case l.status when 'ok' then '접수됨(나감)' when 'fail' then '실패' else '보내는 중' end as "결과",
       coalesce(b.label, '')                                                as "묶음",
       l.created_by                                                         as "보낸 사람",
       (select string_agg(distinct m[1], ' ') from regexp_matches(l.body_head, '(#?\{[^{}]{1,20}\})', 'g') as m) as "남은 칸",
       l.body_head                                                          as "내용 앞부분"
  from public.sms_log l
  left join public.sms_batches b on b.id = l.batch_id
 where (l.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
   and not l.test
   and l.body_head ~ '#?\{[^{}]{1,20}\}'
 order by l.created_at, l.name;

-- 2) 몇 명에게 갔나 — 묶음마다 (실제로 나간 것 = 접수됨)
select coalesce(b.label, '(이름 없음)')                                       as "묶음",
       count(*) filter (where l.status = 'ok')                              as "접수됨(나감)",
       count(*) filter (where l.status = 'fail')                            as "실패",
       count(distinct l.student_id) filter (where l.status = 'ok')          as "학생 수",
       to_char(min(l.created_at) at time zone 'Asia/Seoul', 'HH24:MI') || ' ~ ' ||
       to_char(max(l.created_at) at time zone 'Asia/Seoul', 'HH24:MI')      as "시각"
  from public.sms_log l
  left join public.sms_batches b on b.id = l.batch_id
 where (l.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
   and not l.test
   and l.body_head ~ '#?\{[^{}]{1,20}\}'
 group by b.label
 order by 2 desc;
