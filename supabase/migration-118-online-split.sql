-- ============================================================
--  migration-118-online-split.sql — 20261117c · 117 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음(king-pick 코드는 그대로)
--  온라인 반 · 현강 나누기
--  1. classes.kings_on — 온라인 반 「이번 주 왕 뽑기」 스위치(기본 끔) · online_kings_set(반, 켬) 직원만
--     class_kinds 에 kings_on 을 같이 돌려준다
--  2. king_due — 예전 길(수업 전 예고가 계산된 현강 반 · 수업일 기준)은 그대로 · 온라인 반은 빼고
--     온라인 반(kings_on)은 월 ~ 일을 한 주로 — 월요일 0시(일요일 밤이 지나면)에 지난주(월 ~ 일) 후보 계산
--     (lesson_day = 이번 주 월요일 · 기간 = lesson_day - 7 ~ lesson_day - 1 = 지난 월 ~ 일 · 직원 확정은 현강과 같음)
--  3. king_inputs — 그 반에 「반만 더한 학생」(class_members · 온라인 반 가져오기)도 넣는다
--  4. online_run_class — 117 + 앱 기록 받은 시각(fetched_at) · 과제 정답 수 · 풀이 시간(앱이 보내면) · 반 정보
--  문자 · 알림톡 없음 · 학생 정보(전화번호) 안 돌려줌
-- ============================================================

/* ---------- 1. 왕 뽑기 스위치 ---------- */
alter table public.classes add column if not exists kings_on boolean not null default false;

create or replace function public.online_kings_set(p_class text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.classes set kings_on = coalesce(p_on, false) where name = p_class;
  if not found then return jsonb_build_object('ok', false, 'reason', 'class'); end if;
  return jsonb_build_object('ok', true, 'class', p_class, 'on', coalesce(p_on, false));
end;
$$;
revoke all on function public.online_kings_set(text, boolean) from public, anon;
grant execute on function public.online_kings_set(text, boolean) to authenticated;

create or replace function public.class_kinds()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'use_time', c.use_time, 'use_consult', c.use_consult, 'use_mogo', c.use_mogo,
                                                       'send_on', c.send_on, 'app_class_id', c.app_class_id, 'kings_on', coalesce(c.kings_on, false),
                                                       'members', (select count(*) from public.class_members m join public.students s on s.id = m.student_id and not s.archived where m.class_name = c.name))
                                    order by c.name)
                     from public.classes c), '[]'::jsonb);
end;
$$;
revoke all on function public.class_kinds() from public, anon;
grant execute on function public.class_kinds() to authenticated;

/* ---------- 2. 계산할 반 · 기간 ---------- */
create or replace function public.king_due(p_now timestamptz default now(), p_limit integer default 3)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Seoul')::date as t),
  mon as (select t - (extract(isodow from t)::int - 1) as m from d),
  hyun as (
    select distinct w.class_name, w.lesson_day from public.hw_weeks w, d
     where btrim(coalesce(w.class_name, '')) <> ''
       and w.lesson_day between d.t - 6 and d.t
       and not exists (select 1 from public.classes c where c.name = w.class_name and coalesce(c.kind, '') = 'online')
       and not exists (select 1 from public.king_weeks k where k.class_name = w.class_name and k.lesson_day = w.lesson_day)),
  onl as (
    select c.name as class_name, mon.m as lesson_day from public.classes c, mon
     where coalesce(c.kind, '') = 'online' and coalesce(c.kings_on, false) and not coalesce(c.archived, false)
       and not exists (select 1 from public.king_weeks k where k.class_name = c.name and k.lesson_day = mon.m)),
  x as (select * from hyun union all select * from onl order by 2, 1 limit 10)
  select case when not (public._king_cfg() ->> 'on')::boolean then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('class', y.class_name, 'lesson', y.lesson_day) order by y.lesson_day, y.class_name)
      from (select * from x order by lesson_day, class_name limit greatest(1, least(p_limit, 10))) y), '[]'::jsonb) end;
$$;
revoke all on function public.king_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.king_due(timestamptz, integer) to service_role;

/* ---------- 3. 그 반 학생(반만 더한 학생 포함) · 기간 안 제출 사진 ---------- */
create or replace function public.king_inputs(p_class text, p_lesson date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('from', p_lesson - 7, 'to', p_lesson - 1, 'students', coalesce((
    select jsonb_agg(jsonb_build_object('sid', s.id, 'subs', coalesce((
             select jsonb_agg(x) from jsonb_array_elements(coalesce(r.subs, '[]'::jsonb)) x
              where left(x ->> 'submittedAt', 10) ~ '^\d{4}-\d{2}-\d{2}$'
                and ((x ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date between p_lesson - 7 and p_lesson - 1), '[]'::jsonb)))
      from public.students s left join public.app_records r on r.student_id = s.id
     where not s.archived
       and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class))), '[]'::jsonb));
$$;
revoke all on function public.king_inputs(text, date) from public, anon, authenticated;
grant execute on function public.king_inputs(text, date) to service_role;

/* ---------- 4. 반 표 · 오늘 현황 (직원만) ---------- */
create or replace function public.online_run_class(p_class text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'start_on', s.start_on, 'grade', coalesce(s.grade, ''),
           'linked', l.app_user_id is not null or coalesce(l.app_share_code, '') <> '',
           'fetched', r.fetched_at,
           'data', jsonb_build_object(
             'calendar', coalesce(r.data -> 'calendar', '[]'::jsonb),
             'lectures', coalesce(r.data -> 'lectures', '[]'::jsonb),
             'classes', coalesce(r.data -> 'classes', '[]'::jsonb),
             'history', coalesce((select jsonb_agg(jsonb_build_object('title', h ->> 'title', 'order', h -> 'order', 'submittedAt', h ->> 'submittedAt', 'late', h -> 'late',
                                                                       'correct', h -> 'correct', 'total', h -> 'total', 'sec', h -> 'sec', 'day', h -> 'day'))
                                    from jsonb_array_elements(case when jsonb_typeof(r.data -> 'history') = 'array' then r.data -> 'history' else '[]'::jsonb end) h), '[]'::jsonb),
             'old', case when jsonb_typeof(r.old) = 'object' then jsonb_build_object('calendar', coalesce(r.old -> 'calendar', '[]'::jsonb),
               'history', coalesce((select jsonb_agg(jsonb_build_object('title', h ->> 'title', 'order', h -> 'order', 'submittedAt', h ->> 'submittedAt', 'late', h -> 'late'))
                                      from jsonb_array_elements(case when jsonb_typeof(r.old -> 'history') = 'array' then r.old -> 'history' else '[]'::jsonb end) h), '[]'::jsonb)) else null end),
           'excuse', coalesce((select jsonb_agg(to_char(x.day, 'YYYY-MM-DD') order by x.day) from public.online_excuse x where x.student_id = s.id), '[]'::jsonb)
         ) order by s.name), '[]'::jsonb)
    into out
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.app_records r on r.student_id = s.id
   where not s.archived
     and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class));
  return out;
end;
$$;
revoke all on function public.online_run_class(text) from public, anon;
grant execute on function public.online_run_class(text) to authenticated;

-- 확인 (모두 true)
select '온라인 반 왕 뽑기 스위치(classes.kings_on · 기본 끔)' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'kings_on' and column_default = 'false')::text as ok
union all select '왕 뽑기 스위치 — 직원만(online_kings_set)', (to_regprocedure('public.online_kings_set(text,boolean)') is not null
  and not has_function_privilege('anon', 'public.online_kings_set(text, boolean)', 'execute'))::text
union all select '반 종류에 스위치 같이(class_kinds)', (position('kings_on' in pg_get_functiondef('public.class_kinds()'::regprocedure)) > 0)::text
union all select '왕 뽑기 — 온라인 반은 월 ~ 일(king_due)', (position('isodow' in pg_get_functiondef('public.king_due(timestamptz,integer)'::regprocedure)) > 0)::text
union all select '왕 뽑기 — 반만 더한 학생도(king_inputs)', (position('class_members' in pg_get_functiondef('public.king_inputs(text,date)'::regprocedure)) > 0)::text
union all select '반 표 — 받은 시각 · 반 정보 · 직원만(online_run_class)', (position('fetched' in pg_get_functiondef('public.online_run_class(text)'::regprocedure)) > 0
  and not has_function_privilege('anon', 'public.online_run_class(text)', 'execute'))::text
union all select '사정 인정 표(117)가 먼저 있음', (to_regclass('public.online_excuse') is not null)::text;
