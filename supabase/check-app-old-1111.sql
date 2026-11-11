-- ============================================================
--  check-app-old-1111.sql — 확인용 (읽기만 · 아무것도 바꾸지 않음) · 20261111a · migration-104 실행 뒤
--  앱 연결 n명 / 못 찾음 n명(이유별) / 10월 전 기록이 있는 학생 수 / 가장 이른 기록 날짜
--  재원 학생만 · 이름 · 번호는 나오지 않음 (숫자만)
-- ============================================================
with st as (
  select s.id from public.students s where not s.archived
), lk as (
  select st.id, l.app_user_id, coalesce(l.app_link_state, '') state, coalesce(l.app_link_why, '') why, coalesce(l.app_link_guess, false) guess
    from st left join public.student_links l on l.student_id = st.id
), recs as (                                   /* 낸 과제의 제출일(한국 날짜) — 지금 받는 기록(data) + 옛 기록(old) */
  select r.student_id id, ((h ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date d
    from public.app_records r join st on st.id = r.student_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'history') = 'array' then r.data -> 'history' else '[]'::jsonb end) h
   where coalesce(h ->> 'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
  union all
  select r.student_id, ((h ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date
    from public.app_records r join st on st.id = r.student_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.old -> 'history') = 'array' then r.old -> 'history' else '[]'::jsonb end) h
   where coalesce(h ->> 'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
), rows as (
  select 1.0 o, '앱 연결' as 항목, count(*) filter (where app_user_id is not null) || '명' as 값 from lk
  union all select 2, '못 찾음 (앱 연결 안 됨 · 전체)', count(*) filter (where app_user_id is null) || '명' from lk
  union all
  select 2 + w.n * 0.1, '  · ' || case w.k when 'no_phone' then '번호 없음' when 'phone_mismatch' then '번호 불일치' when 'name_mismatch' then '이름 불일치'
                              when 'no_account' then '앱 계정 없음' when 'many' then '후보 여러 명' when 'retry' then '다시 찾는 중(번호 고침)' else '아직 찾기 전' end,
         (select count(*) from lk where app_user_id is null and (case when state = 'retry' then 'retry' when why <> '' then why else '' end) = w.k) || '명'
         || coalesce(' (짐작 ' || nullif((select count(*) from lk where app_user_id is null and why = w.k and guess and state <> 'retry'), 0) || ')', '')
    from (values ('no_phone', 1), ('phone_mismatch', 2), ('name_mismatch', 3), ('no_account', 4), ('many', 5), ('retry', 6), ('', 7)) w(k, n)
  union all select 4, '옛 기록 받음 (앱 연결 학생 중)', (select count(*) from public.app_records r join st on st.id = r.student_id where r.old_at is not null) || '명 · 그중 옛 기록 있는 학생 '
         || (select count(*) from public.app_records r join st on st.id = r.student_id where r.old_n > 0) || '명 · 옛 과제 합계 '
         || (select coalesce(sum(r.old_n), 0) from public.app_records r join st on st.id = r.student_id) || '개'
  union all select 5, '옛 기록 아직 안 받음 (앱 연결 학생 중)', (select count(*) from lk join public.app_records r on r.student_id = lk.id where lk.app_user_id is not null and r.old_at is null) || '명'
  union all select 6, '10월 전 기록이 있는 학생', (select count(distinct id) from recs where d < date '2026-10-01') || '명'
  union all select 7, '가장 이른 기록 날짜', coalesce((select min(d)::text from recs), '기록 없음')
)
select 항목, 값 from rows order by o;
