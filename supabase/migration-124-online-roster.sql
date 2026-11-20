-- ============================================================
--  migration-124-online-roster.sql — 20261120b · 123 다음 · 여러 번 실행해도 됨 · 함수 배포 없음
--  온라인 반 학생 수 불일치 — 반 학생 수 · 오늘 제출 분모 · 오늘 미제출 · 제출률이 모두 같은 「지금 이 반 학생」 명단으로
--
--  원인: 반 카드 「n명」은 코치룸 화면이 「원래 반이 이 반 · 퇴원일 안 지남」 학생만 셌고,
--        요약(online_stats_sum · online_stats_class)은 서버가 「퇴원 표시(archived)만 빼고 · 반만 더한 학생(class_members) 포함」으로 셌다
--        → 퇴원일(left_on)이 지난 학생이 분모에 남고 · 두 숫자가 서로 다른 명단(58명 vs 오늘 제출 3/63)
--  이제: _online_roster(반) 하나 — 퇴원 표시 없음 · 퇴원일이 오늘 전이 아님 · 원래 반이거나 반만 더한 학생 · 한 사람은 한 번
--        같은 반에 이름이 같은 학생이 둘 이상이면(예전 가져오기로 생긴 겹침) 앱에 연결된 학생만 셈(연결된 학생이 없으면 모두)
--        반 카드 한 줄 · 반 화면 표 · 계산 모두 이 명단 · 반 카드에 이번 달 제출률(m_done / m_open) · 오늘 기록 받는 중(wait) 추가
--  1. _online_roster 2. _online_stats_fresh · online_stats_sum · online_stats_class 다시 3. 온라인 학생 전원 다시 계산 4. 맨 끝 확인 표
-- ============================================================

create or replace function public._online_roster(p_class text)
returns setof uuid language sql stable security definer set search_path = public as $$
  with r as (
    select s.id, regexp_replace(s.name, '\s+', '', 'g') as nm,
           (l.app_user_id is not null or coalesce(l.app_share_code, '') <> '') as linked
      from public.students s
      left join public.student_links l on l.student_id = s.id
     where not s.archived
       and (s.left_on is null or s.left_on >= (now() at time zone 'Asia/Seoul')::date)
       and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class)))
  select r.id from r
   where r.linked or not exists (select 1 from r r2 where r2.nm = r.nm and r2.id <> r.id and r2.linked);
$$;
revoke all on function public._online_roster(text) from public, anon, authenticated;

/* 반 학생 중 오늘 계산 안 된 학생 — 60명까지 바로 계산 (같은 명단) */
create or replace function public._online_stats_fresh(p_class text)
returns integer language plpgsql security definer set search_path = public as $$
declare sid uuid; n int := 0; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  for sid in select r.id from public._online_roster(p_class) r(id) left join public.online_student_stats x on x.student_id = r.id
              where x.student_id is null or x.calc_day is distinct from t
              order by r.id limit 60 loop
    perform public._online_calc_safe(sid); n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._online_stats_fresh(text) from public, anon, authenticated;

/* 반 카드 한 줄 — n명 · 오늘 제출 n/n · 제출률 · 이틀 이상 미제출 · 구간 위험 · 계산 중 · 기록 늦음 · 오늘 기록 받는 중 (같은 명단) */
create or replace function public.online_stats_sum(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  perform public._online_stats_fresh(p_class);
  select jsonb_build_object('class', p_class, 'n', count(*),
           'today_done', count(*) filter (where x.calc_day = t and x.today_kind in ('ok', 'late', 'golden')),
           'today_open', count(*) filter (where x.calc_day = t and x.today_kind in ('ok', 'late', 'golden', 'today')),
           'wait', count(*) filter (where x.calc_day = t and x.today_kind = 'today'
                                      and (not coalesce(x.today_cal, false) or x.fetched_at is null or (x.fetched_at at time zone 'Asia/Seoul')::date < t)),
           'm_done', coalesce(sum(x.month_done) filter (where x.calc_day = t), 0),
           'm_open', coalesce(sum(x.month_open) filter (where x.calc_day = t), 0),
           'miss2', count(*) filter (where x.calc_day = t and x.miss_run >= 2),
           'risk', count(*) filter (where x.calc_day = t and x.risk <> ''),
           'done_sec', count(*) filter (where x.calc_day = t and exists (select 1 from jsonb_array_elements(x.app_secs) e where e ->> 'state' = 'done')),
           'app_ok', count(*) filter (where x.calc_day = t and x.app_status = 'ok'),
           'pending', count(*) filter (where x.student_id is null or x.calc_day is distinct from t),
           'late', count(*) filter (where x.fetched_at is null or x.fetched_at < now() - interval '2 hours'),
           'fetched', min(x.fetched_at), 'at', now())
    into out
    from public._online_roster(p_class) r(id) left join public.online_student_stats x on x.student_id = r.id;
  return out;
end;
$$;
revoke all on function public.online_stats_sum(text) from public, anon;
grant execute on function public.online_stats_sum(text) to authenticated;

/* 반 화면 표 — 학생마다 한 줄 (같은 명단) */
create or replace function public.online_stats_class(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  perform public._online_stats_fresh(p_class);
  select coalesce(array_agg(r.id), '{}') into ids from public._online_roster(p_class) r(id);
  return public._online_stats_rows(ids);
end;
$$;
revoke all on function public.online_stats_class(text) from public, anon;
grant execute on function public.online_stats_class(text) to authenticated;

select public.online_stats_all() as "온라인 학생 다시 계산(명 · 같은 명단)";

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '123이 먼저 있음(구간 허브 비교)' as what, (position('hpass' in pg_get_functiondef('public._online_calc(uuid,date)'::regprocedure)) > 0)::text as ok
union all select '「지금 이 반 학생」 명단 하나(_online_roster) · 직원 · 학생이 직접 못 부름', (to_regprocedure('public._online_roster(text)') is not null
  and not has_function_privilege('authenticated', 'public._online_roster(text)', 'execute'))::text
union all select '반 카드 한 줄 · 반 화면 표 · 계산이 같은 명단', (position('_online_roster' in pg_get_functiondef('public.online_stats_sum(text)'::regprocedure)) > 0
  and position('_online_roster' in pg_get_functiondef('public.online_stats_class(text)'::regprocedure)) > 0
  and position('_online_roster' in pg_get_functiondef('public._online_stats_fresh(text)'::regprocedure)) > 0)::text
union all select '퇴원 표시 · 퇴원일 지난 학생은 명단에 없음', (not exists (select 1 from public.classes c cross join lateral public._online_roster(c.name) r(id)
  join public.students s on s.id = r.id where coalesce(c.kind, '') = 'online' and (s.archived or s.left_on < (now() at time zone 'Asia/Seoul')::date)))::text
union all select '반마다 오늘 제출 분모 ≤ 반 학생 수', (not exists (select 1 from public.classes c where coalesce(c.kind, '') = 'online'
  and (select count(*) from public._online_roster(c.name) r(id) join public.online_student_stats x on x.student_id = r.id
        where x.calc_day = (now() at time zone 'Asia/Seoul')::date and x.today_kind in ('ok', 'late', 'golden', 'today'))
      > (select count(*) from public._online_roster(c.name))))::text
union all select '온라인 학생 전원 다시 계산됨', (not exists (select 1 from public.students s where not s.archived and public._is_online_student(s.id)
  and not exists (select 1 from public.online_student_stats x where x.student_id = s.id and x.calc_day = (now() at time zone 'Asia/Seoul')::date)))::text;
