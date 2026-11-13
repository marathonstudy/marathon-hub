-- ============================================================
--  migration-111-old-cut-fix.sql — 20261114c · 110 다음 · 여러 번 실행해도 됨
--  옛 기록을 「지금 기록이 시작하는 날」 전까지 받기 (예전: 수강 시작일 전까지만)
--    원인 — 1월 개강 학생(예: 목동반 1/3)은 받을 기간이 1/1 ~ 1/2 뿐이라 바로 「다 받음(empty)」으로 끝났다.
--           그런데 지금 기록(공유 코드 · 지금 앱 반)은 10월부터라 1 ~ 9월이 통째로 비었다(함께 달린 시간 11주 · 정답률 흐름 10 ~ 11월뿐).
--  1. app_old_due2 — 학생마다 지금 기록의 첫 날(dfirst · 한국 날짜)도 함께 → app-sync 가 그날 전까지 받는다(종강이 가까운 반 먼저 · 110 그대로)
--  2. 이미 「다 받음」인데 받은 끝(old.cut)이 지금 기록 첫 달보다 앞인 학생 → 다시 받게(old_at · 마지막 받은 달 비움 · 받은 달 기록은 달마다 통째로 바뀌어 겹치지 않음)
--  학생 이름 · 번호는 건드리지 않는다 · 앱 · 모고 쪽 고칠 것 없음
-- ============================================================

create or replace function public._data_first(p_data jsonb)
returns date language sql immutable as $$
  select min(((h ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date)
    from jsonb_array_elements(case when jsonb_typeof(p_data -> 'history') = 'array' then p_data -> 'history' else '[]'::jsonb end) h
   where coalesce(h ->> 'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}T';
$$;
revoke all on function public._data_first(jsonb) from public, anon, authenticated;

create or replace function public.app_old_due2(p_limit integer default 40)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'uid', z.uid, 'start', z.start_on, 'month', z.old_month, 'dfirst', z.dfirst) order by z.pri desc, z.ord nulls first, z.id), '[]'::jsonb)
    from (
      select s.id, l.app_user_id uid, s.start_on, r.old_month, r.old_try ord, public._data_first(r.data) dfirst,
             (exists (select 1 from public.classes c
                       where (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name))
                         and c.end_on between (now() at time zone 'Asia/Seoul')::date - 7 and (now() at time zone 'Asia/Seoul')::date + 21))::int pri
        from public.students s
        join public.student_links l on l.student_id = s.id and l.app_user_id is not null
        left join public.app_records r on r.student_id = s.id
       where not s.archived
         and r.old_at is null
         and (coalesce(r.old_fails, 0) = 0 or r.old_try is null
              or r.old_try < now() - case when r.old_fails <= 1 then interval '10 minutes'
                                          else least(interval '6 hours', interval '30 minutes' * power(2, least(r.old_fails, 8) - 2)) end)
       order by 7 desc, r.old_try nulls first, s.id
       limit greatest(1, least(100, coalesce(p_limit, 40)))
    ) z;
$$;
revoke all on function public.app_old_due2(integer) from public, anon, authenticated;
grant execute on function public.app_old_due2(integer) to service_role;

/* 다시 받을 학생 — 「다 받음」인데 받은 끝이 지금 기록 첫 달보다 한 달 이상 앞 (2026-01 부터 받을 달이 남음) */
create or replace function public._old_stale(r public.app_records, s public.students)
returns boolean language sql stable as $$
  select r.old_at is not null
     and public._data_first(r.data) is not null
     and date_trunc('month', public._data_first(r.data)) > date_trunc('month', greatest('2026-01-01'::date,
           coalesce(case when coalesce(r.old ->> 'cut', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r.old ->> 'cut')::date end, s.start_on, '2026-01-01'::date)));
$$;
revoke all on function public._old_stale(public.app_records, public.students) from public, anon, authenticated;

update public.app_records r
   set old_at = null, old_month = null, old_status = '', old_err = '', old_fails = 0, old_try = null
  from public.students s
 where s.id = r.student_id and not s.archived and public._old_stale(r, s);

-- 확인 (모두 true 여야 함) · 다시 받을 학생 수는 숫자만
select '옛 기록 — 지금 기록 첫 날(dfirst) 함께' as what, (position('dfirst' in pg_get_functiondef('public.app_old_due2(integer)'::regprocedure)) > 0)::text as ok
union all select '「다 받음」인데 앞 달이 빈 학생 없음(다시 받는 중으로 바꿈)', (not exists (select 1 from public.app_records r join public.students s on s.id = r.student_id where not s.archived and public._old_stale(r, s)))::text
union all select '다시 받을 학생 수(종강 반 먼저): ' || (select count(*) from public.app_records r join public.students s on s.id = r.student_id join public.student_links l on l.student_id = s.id and l.app_user_id is not null where not s.archived and r.old_at is null)::text, 'true';
