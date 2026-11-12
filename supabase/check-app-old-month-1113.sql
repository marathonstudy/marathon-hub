-- ============================================================
--  check-app-old-month-1113.sql — 확인용 (읽기만 · 아무것도 바꾸지 않음) · 20261113a · migration-106 · app-sync 다시 배포 뒤 30분쯤
--  한 표로 나온다 (SQL 편집기는 마지막 결과 하나만 보여 줘서)
--    · 앱 요청 시간 — 1명 · 1달(옛 기록) 요청의 수 · 성공 · 실패 · 평균 · 최대 ms · 실패 이유 / 평소 동기화 요청(학생 수별)
--    · 옛 기록 진행 — 끝남(받음 · 옛 기록 없음) · 받는 중 · 실패 · 아직 · 받은 달 합계
--    · 학생별 — 이름은 성 + ○ · 마지막으로 받은 달 · 받은 달 수 · 옛 과제 수 · 연속 실패 · 마지막 시도
--  어느 학생을 처음부터 다시 받게 하려면(쓰기라 여기서는 주석):
--    delete from public.app_old_parts where student_id = '…'; update public.app_records set old_at = null, old_month = null, old_fails = 0, old_try = null, old_status = '' where student_id = '…';
-- ============================================================
with st as (
  select s.id, s.name, s.start_on, l.app_user_id
    from public.students s left join public.student_links l on l.student_id = s.id
   where not s.archived and l.app_user_id is not null
), ap as (
  select st.*, coalesce(r.old_status, '') old_status, coalesce(r.old_err, '') old_err, r.old_at, r.old_try, r.old_month,
         coalesce(r.old_months, 0) old_months, coalesce(r.old_n, 0) old_n, coalesce(r.old_fails, 0) old_fails, r.old_got_first, r.src, coalesce(r.user_fail, '') user_fail
    from st left join public.app_records r on r.student_id = st.id
), c24 as (select * from public.app_hub_calls where at > now() - interval '24 hours'
), om as (select * from c24 where kind = 'old' and students = 1 and days <= 33
), sy as (select * from c24 where kind = 'sync'
), rows as (
  select 1.0 o, '앱 요청 — 1명 · 1달 (옛 기록 · 24시간)' 항목,
         (select count(*) from om) || '번 · 성공 ' || (select count(*) from om where ok) || ' · 실패 ' || (select count(*) from om where not ok) 값,
         '성공한 요청 평균 ' || coalesce((select round(avg(ms))::text from om where ok), '-') || 'ms · 최대 ' || coalesce((select max(ms)::text from om where ok), '-') || 'ms · 전체 최대 ' || coalesce((select max(ms)::text from om), '-') || 'ms' 메모
  union all select 1.1, '  · 1명 · 1달 실패 이유',
         coalesce((select string_agg(reason || ' ' || n, ' · ') from (select reason, count(*) n from om where not ok group by 1 order by 2 desc) z), '없음'),
         'timeout 이 많으면 .local/replit_합친요청.md 를 Replit 에 (앱 속도 개선)'
  union all select 1.2, '앱 요청 — 평소 동기화 (24시간)',
         (select count(*) from sy) || '번 · 성공 ' || (select count(*) from sy where ok) || ' · 실패 ' || (select count(*) from sy where not ok),
         '평균 ' || coalesce((select round(avg(ms))::text from sy where ok), '-') || 'ms · 최대 ' || coalesce((select max(ms)::text from sy), '-') || 'ms · 실패 이유 ' || coalesce((select string_agg(reason || ' ' || n, ' · ') from (select reason, count(*) n from sy where not ok group by 1 order by 2 desc) z), '없음')
  union all
  select 1.3 + row_number() over (order by students) * 0.001, '  · 평소 동기화 학생 ' || students || '명 묶음',
         count(*) || '번 · 실패 ' || count(*) filter (where not ok),
         '평균 ' || round(avg(ms)) || 'ms · 최대 ' || max(ms) || 'ms · 평균 기간 ' || round(avg(days)) || '일'
    from sy group by students
  union all select 1.9, '앱 요청 — 마지막 요청 시각',
         coalesce((select to_char(max(at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI') from public.app_hub_calls), '기록 없음 — 106 실행 · app-sync 다시 배포를 확인'), ''
  union all select 2.0, '앱 id 학생', (select count(*) from ap) || '명', ''
  union all select 2.1, '  · 평소 동기화 — 학생 기준 주소로 받음(src user)', (select count(*) from ap where src = 'user') || '명',
         '공유 코드로 ' || (select count(*) from ap where src = 'share') || '명 · 학생 기준 주소로 못 받은 이유: ' || coalesce((select string_agg(user_fail || ' ' || n, ' · ') from (select user_fail, count(*) n from ap where user_fail <> '' group by 1 order by 2 desc) z), '없음')
  union all select 3.0, '옛 기록 — 끝남 · 받음(옛 과제 있음)', (select count(*) from ap where old_at is not null and old_status = 'ok') || '명', '옛 과제 합계 ' || (select coalesce(sum(old_n), 0) from ap) || '개 · 받은 달 합계 ' || (select coalesce(sum(old_months), 0) from ap) || '달'
  union all select 3.1, '옛 기록 — 끝남 · 수강 시작일 앞 기록 없음', (select count(*) from ap where old_at is not null and old_status <> 'ok') || '명', ''
  union all select 3.2, '옛 기록 — 받는 중(한 달 이상 받음)', (select count(*) from ap where old_at is null and old_month is not null and old_fails = 0) || '명', ''
  union all select 3.3, '옛 기록 — 실패 뒤 기다리는 중', (select count(*) from ap where old_at is null and old_fails > 0) || '명', '연속 실패 1번 10분 · 2번 30분 · 3번 1시간 … 6시간 뒤 다시'
  union all select 3.4, '옛 기록 — 아직 한 달도 못 받음', (select count(*) from ap where old_at is null and old_month is null and old_fails = 0) || '명', ''
  union all
  select 4 + row_number() over (order by count(*) desc) * 0.01, '실패 이유 · ' || old_err, count(*) || '명', '' from ap where old_at is null and old_fails > 0 group by old_err
  union all
  select 9 + row_number() over (order by old_at nulls first, old_month nulls first, name) * 0.001,
         case when char_length(name) >= 3 then left(name, 2) || repeat('○', char_length(name) - 2) when char_length(name) = 2 then left(name, 1) || '○' else '○' end,
         case when old_at is not null then '끝남' when old_fails > 0 then '실패 ' || old_fails || '번' when old_month is not null then '받는 중' else '아직' end
           || ' · 마지막으로 받은 달 ' || coalesce(to_char(old_month, 'YYYY-MM'), '-'),
         '수강 시작 ' || coalesce(to_char(start_on, 'YYYY-MM-DD'), '-') || ' · 받은 달 ' || old_months || ' · 옛 과제 ' || old_n
           || case when old_err <> '' then ' · ' || old_err else '' end || ' · 마지막 시도 ' || coalesce(to_char(old_try at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '-')
    from ap
)
select 항목, 값, 메모 from rows order by o;
