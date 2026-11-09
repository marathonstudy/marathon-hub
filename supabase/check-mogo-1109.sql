-- ============================================================
--  check-mogo-1109.sql — 모의고사 연동 상태 확인 (읽기만 · 아무것도 바꾸지 않음)
--  Supabase → SQL Editor → 새 쿼리 → 이 파일 전체 붙여 넣기 → Run
--  결과 칸이 여러 개면 맨 아래 것만 보이니, ① ~ ⑥ 을 하나씩 골라(드래그) Run 해도 된다
--  학생 이름 · 번호는 나오지 않는다 (숫자 · 시각 · 상태만)
-- ============================================================

-- ① 저장본 — 모두 몇 줄 · 상태별 몇 명 · 마지막으로 받은 시각
select count(*)                                        as 전체,
       count(*) filter (where state = 'ok')            as 찾음_ok,
       count(*) filter (where state = 'none')          as 일치없음_none,
       count(*) filter (where state = 'nophone')       as 번호없음_nophone,
       count(*) filter (where state = 'error')         as 못받음_error,
       count(*) filter (where state = 'check')         as 확인필요_check,
       count(*) filter (where fails > 0)               as 마지막받기실패,
       count(*) filter (where state = 'ok' and exists (select 1 from jsonb_array_elements(reports) x where (x ->> 'done')::boolean)) as 완성레포트있는학생,
       to_char(max(fetched_at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as 마지막으로_받은_시각,
       to_char(min(next_at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI')    as 다음_차례
  from public.mogo_records;

-- ② 이유별 (찾음 phone/parent · 확인 필요 sibling/multi/mixed · 실패 down/http500/busy/badkey …)
select state, reason, count(*) as 명 from public.mogo_records group by 1, 2 order by 1, 2;

-- ③ 연결 상태 (함수가 마지막으로 모고 사이트를 확인한 결과 · ok · down · badkey · nokey)
select value ->> 'state' as 상태, value ->> 'version' as 연동버전,
       to_char((value ->> 'at')::timestamptz at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as 확인한_시각
  from public.app_settings where key = 'mogo_status';

-- ④ 20분마다 예약이 실제로 돌았나 (최근 10번 · succeeded 면 「요청을 보냄」까지 · 함수 결과는 ⑤)
select r.status as 예약실행, r.return_message as 메시지,
       to_char(r.start_time at time zone 'Asia/Seoul', 'MM/DD HH24:MI:SS') as 시각
  from cron.job_run_details r join cron.job j on j.jobid = r.jobid
 where j.jobname = 'mogo-sync'
 order by r.start_time desc limit 10;

-- ⑤ 함수 mogo-sync 가 돌려준 답 (최근 · pg_net 이 받은 응답 · 200 = 함수까지 감 / 401 = Verify JWT 가 켜져 있음 / 404 = 함수 이름 · 배포 확인)
--    "reason":"login" / 403 "auth" = 예약 열쇠(note_cron_secret)를 함수가 못 받음
--    내용 예: {"ok":true,"due":15,"found":3,...} · {"ok":false,"reason":"nokey"} (키 없음) · {"reason":"badkey"} (키 틀림) · {"reason":"down"} (모고 사이트 연결 안 됨)
select status_code as 응답, left(coalesce(content, error_msg, ''), 220) as 내용,
       to_char(created at time zone 'Asia/Seoul', 'MM/DD HH24:MI:SS') as 시각
  from net._http_response
 where coalesce(content, '') like '%"due"%' or coalesce(content, '') like '%nokey%' or coalesce(content, '') like '%badkey%'
    or coalesce(content, '') like '%"reason":"down"%' or coalesce(content, '') like '%"night"%'
    or coalesce(content, '') like '%"reason":"login"%' or coalesce(content, '') like '%"reason":"auth"%' or status_code in (401, 403, 404)
 order by created desc limit 10;

-- ⑥ 찾을 수 있는 학생 수 (보관 안 된 학생 · 학생 번호 · 학부모 번호가 있는지)
select count(*) as 학생,
       count(*) filter (where length(regexp_replace(coalesce(student_phone, ''), '\D', '', 'g')) >= 10) as 학생번호있음,
       count(*) filter (where length(regexp_replace(coalesce(parent_phone, ''), '\D', '', 'g')) >= 10
                           or length(regexp_replace(coalesce(parent_phone2, ''), '\D', '', 'g')) >= 10) as 학부모번호있음,
       count(*) filter (where not exists (select 1 from public.mogo_records m where m.student_id = s.id)) as 아직_안받은_학생
  from public.students s where not s.archived;
