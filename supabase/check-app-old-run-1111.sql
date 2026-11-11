-- ============================================================
--  check-app-old-run-1111.sql — 확인용 (읽기만 · 아무것도 바꾸지 않음) · 20261111b · migration-105 · app-sync 다시 배포 뒤 10분쯤
--  한 표로 나온다 (SQL 편집기는 마지막 결과 하나만 보여 줘서)
--    · 마지막 동기화 시각 · 5분 예약이 도는지 · 앱 읽기 열쇠가 있는지(있다 / 없다만 · 값은 안 나옴)
--    · 앱 id 학생이 어느 주소로 받히는지(학생 기준 주소 / 공유 코드) · 학생 기준 주소로 못 받은 이유
--    · 옛 기록 결과(받음 · 받았지만 옛 기록 없음 · 앱이 기록 안 줌 · 실패 · 아직) · 실패 이유별 개수
--    · 「앱이 지금 반 기간만 주는지」 — 요청은 2026-01-01부터인데 앱이 준 가장 이른 날짜가 수강 시작일 뒤면 그쪽
--    · 학생별 — 이름은 성 + 이름 첫 글자만(두 글자 이름은 성만) · 번호는 안 나옴
--  다시 받게 하려면(원장님이 고른 학생만 · 쓰기라 여기서는 주석): update public.app_records set old_at = null, old_try = null, old_tries = 0 where student_id = '…';
-- ============================================================
with st as (
  select s.id, s.name, s.start_on, l.app_user_id
    from public.students s left join public.student_links l on l.student_id = s.id
   where not s.archived
), ap as (                                   /* 앱 id 학생 + 저장본 */
  select st.*, r.src, coalesce(r.user_fail, '') user_fail, r.fetched_at, r.old_at, r.old_try, coalesce(r.old_status, '') old_status, coalesce(r.old_err, '') old_err,
         r.old_from, r.old_to, r.old_got_first, coalesce(r.old_got_n, 0) old_got_n, coalesce(r.old_classes, 0) old_classes, coalesce(r.old_n, 0) old_n, r.old_first, coalesce(r.old_tries, 0) old_tries
    from st left join public.app_records r on r.student_id = st.id
   where st.app_user_id is not null
), runs as (
  select * from public.app_sync_runs order by at desc limit 50
), lastc as (
  select * from runs where kind = 'cron' order by at desc limit 1
), lasto as (                               /* 옛 기록을 실제로 해 본 마지막 차례 */
  select * from runs where kind = 'cron' and (summary -> 'old' ->> 'tried') is not null and (summary -> 'old' ->> 'tried')::int > 0 order by at desc limit 1
), cr as (
  select d.start_time, d.status, d.return_message from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'app-sync' order by d.start_time desc limit 1
), rows as (
  select 1.0 o, '마지막 동기화 (5분마다 · 함수 기록)' 항목,
         coalesce((select to_char(at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' · ' || round(extract(epoch from now() - at) / 60) || '분 전' from lastc), '기록 없음 — 105 실행 · app-sync 다시 배포를 확인') 값,
         coalesce((select '받을 차례 ' || coalesce(summary ->> 'due', '0') || '명 · 받음 ' || coalesce(summary ->> 'saved', '0') || ' · 실패 ' || coalesce(summary ->> 'failed', '0')
                          || ' · 학생 기준 주소 ' || coalesce(summary ->> 'user', '0') || ' · 공유 코드로 ' || coalesce(summary ->> 'fallback', '0') || ' · ' || coalesce(summary ->> 'ms', '?') || 'ms' from lastc), '') 메모
  union all select 1.1, '5분 예약(pg_cron) 마지막 실행',
         coalesce((select to_char(start_time at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' · ' || status from cr), '실행 기록 없음'),
         coalesce((select left(coalesce(return_message, ''), 120) from cr), '')
  union all select 1.2, '앱 읽기 열쇠(HUB_READ_KEY)',
         coalesce((select case when hub then '있음' else '없음 — Supabase Secrets 에 HUB_READ_KEY 를 넣어야 학생 기준 주소 · 옛 기록 · 앱 찾기가 돈다' end from lastc), '모름(동기화 기록 없음)'), ''
  union all select 1.3, '마지막 차례의 옛 기록',
         coalesce((select coalesce(summary -> 'old' ->> 'skip', '') || coalesce(summary -> 'old' ->> 'err', '')
                        || case when (summary -> 'old' ->> 'tried') is not null then '해 봄 ' || (summary -> 'old' ->> 'tried') || '명 · 받음 ' || coalesce(summary -> 'old' ->> 'ok', '0')
                                || ' · 옛 기록 없음 ' || coalesce(summary -> 'old' ->> 'empty', '0') || ' · 앱이 안 줌 ' || coalesce(summary -> 'old' ->> 'none', '0') || ' · 실패 ' || coalesce(summary -> 'old' ->> 'failed', '0') else '' end
                    from lastc), ''),
         coalesce((select 'skip: night 밤 1~6시 쉼 · nokey 열쇠 없음 · time 시간 모자람' from lastc where summary -> 'old' ? 'skip'), '')
  union all select 1.4, '옛 기록을 실제로 해 본 마지막 시각',
         coalesce((select to_char(at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' · 요청 ' || coalesce(summary -> 'old' ->> 'from', '') || ' ~ ' || coalesce(summary -> 'old' ->> 'to', '') from lasto), '아직 없음'),
         coalesce((select coalesce((summary -> 'old' -> 'reasons')::text, '') from lasto), '')
  union all select 2.0, '앱 id 학생', (select count(*) from ap) || '명', ''
  union all select 2.1, '  · 학생 기준 주소로 받음(src user)', (select count(*) from ap where src = 'user') || '명', ''
  union all select 2.2, '  · 공유 코드로 받음(src share)', (select count(*) from ap where src = 'share') || '명',
         coalesce('학생 기준 주소로 못 받은 이유: ' || (select string_agg(user_fail || ' ' || n, ' · ') from (select user_fail, count(*) n from ap where user_fail <> '' group by 1 order by 2 desc) z), '')
  union all select 2.3, '  · 아직 저장본 없음', (select count(*) from ap where fetched_at is null) || '명', ''
  union all select 3.0, '옛 기록 — 받음(수강 시작일 앞 기록 있음)', (select count(*) from ap where old_status = 'ok') || '명', '옛 과제 합계 ' || (select coalesce(sum(old_n), 0) from ap) || '개'
  union all select 3.1, '옛 기록 — 받았지만 수강 시작일 앞 기록 없음', (select count(*) from ap where old_status = 'empty') || '명', ''
  union all select 3.2, '옛 기록 — 앱이 이 학생 기록을 안 줌', (select count(*) from ap where old_status = 'none') || '명', ''
  union all select 3.3, '옛 기록 — 실패(다음 차례에 다시)', (select count(*) from ap where old_status = 'fail') || '명', ''
  union all select 3.4, '옛 기록 — 아직 안 해 봄', (select count(*) from ap where old_status = '' and old_try is null) || '명', ''
  union all select 3.5, '옛 기록 — 해 보는 중(결과 저장 전)', (select count(*) from ap where old_status = '' and old_try is not null) || '명', '105 전 함수가 고르고 멈춘 학생도 여기 · 30분 뒤 다시'
  union all
  select 4 + row_number() over (order by count(*) desc) * 0.01, '실패 이유 · ' || old_err, count(*) || '명', '' from ap where old_status = 'fail' group by old_err
  union all select 5.0, '「앱이 지금 반 기간만 주나」 — 앱이 준 가장 이른 날짜가 수강 시작일 뒤',
         (select count(*) from ap where old_status in ('ok', 'empty') and old_got_first is not null and start_on is not null and old_got_first >= start_on) || '명',
         '수강 시작일 앞 날짜까지 준 학생 ' || (select count(*) from ap where old_status in ('ok', 'empty') and old_got_first is not null and start_on is not null and old_got_first < start_on) || '명 · 요청은 ' || coalesce((select min(old_from)::text from ap), '2026-01-01') || '부터'
  union all
  select 9 + row_number() over (order by coalesce(old_got_first, date '9999-12-31'), name) * 0.001,
         case when char_length(name) >= 3 then left(name, 2) || repeat('○', char_length(name) - 2) when char_length(name) = 2 then left(name, 1) || '○' else '○' end,
         case old_status when 'ok' then '받음' when 'empty' then '옛 기록 없음' when 'none' then '앱이 안 줌' when 'fail' then '실패' else case when old_try is null then '아직' else '해 보는 중' end end
           || ' · 받은 가장 이른 날 ' || coalesce(to_char(old_got_first, 'YYYY-MM-DD'), '-'),
         '수강 시작 ' || coalesce(to_char(start_on, 'MM-DD'), '-') || ' · 요청 ' || coalesce(to_char(old_from, 'MM-DD'), '-') || '~' || coalesce(to_char(old_to, 'MM-DD'), '-')
           || ' · 받은 과제 ' || old_got_n || ' · 반 ' || old_classes || ' · 옛 과제 ' || old_n || ' · ' || coalesce(src, '-') || case when user_fail <> '' then '(' || user_fail || ')' else '' end
           || case when old_err <> '' then ' · ' || old_err else '' end || ' · ' || old_tries || '번 · ' || coalesce(to_char(old_try at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '-')
    from ap
)
select 항목, 값, 메모 from rows order by o;
