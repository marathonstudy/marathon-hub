-- ============================================================
--  마라톤 코치룸 — 출결 기본값 · 결석 기준 · 러닝노트 누적 추이 (migration-016-attend-trend.sql)
--
--  실행 방법
--    001 ~ 015 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 저장된 레포트 · 학생 기록은 바꾸지 않는다.
--
--  1. entry_defaults — ② 작성에서 이번 주와 그 뒤 주차를 열면 아직 줄이 없는 학생만 「출석 · 집중도 5」로 만든다.
--     줄이 이미 있으면 아무것도 하지 않는다 (다른 기기에서 바꾼 값을 덮지 않는다). 지난 주차는 채우지 않는다.
--  2. coach_today — 「오늘」 결석 기준에서 예전 보강(makeup)을 뺀다 (보강 단추를 없애고 「출석」으로 보이게 했으므로).
--     나머지는 migration-007 과 같다.
--  3. hub_trend — 러닝노트 「누적 추이」. 학생 링크 · 학부모 링크 모두. 그 학생의 공개된 레포트에서
--     출결 · 집중도 · 필수과제율만, 복습테스트는 선생님이 확인한 점수만. 상담 · 성적 · 금액은 없다.
--     staff_hub_trend 는 코치룸 미리보기용 (로그인한 직원만).
-- ============================================================


-- ------------------------------------------------------------
--  1. 출결 기본값 — 비어 있는 학생만 (이번 주 · 그 뒤 주차)
-- ------------------------------------------------------------
create or replace function public.entry_defaults(p_week date, p_students uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  this_mon date := public._monday((now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_week is null or public._monday(p_week) < this_mon then
    return '[]'::jsonb;                       -- 지난 주차는 채우지 않는다
  end if;
  insert into public.entries (week_start, student_id, attend_status, focus_score)
  select p_week, s.id, 'attend', 5
  from public.students s
  where s.id = any(coalesce(p_students, '{}')) and not s.archived
  on conflict (week_start, student_id) do nothing;
  return coalesce((
    select jsonb_agg(to_jsonb(e)) from public.entries e
    where e.week_start = p_week and e.student_id = any(coalesce(p_students, '{}'))), '[]'::jsonb);
end;
$$;


-- ------------------------------------------------------------
--  2. 「오늘」 — 결석 횟수는 결석(absent)만. migration-007 의 coach_today 와 그 한 줄만 다르다
-- ------------------------------------------------------------
create or replace function public.coach_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  ws date;
  we date;
  cfg jsonb;
  money boolean;
  aw integer;
  amin integer;
  res jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;

  select value into cfg from public.app_settings where key = 'dashboard';
  cfg := coalesce(cfg, '{}'::jsonb);
  aw   := greatest(1, least(12, coalesce((cfg ->> 'absentWeeks')::int, 4)));
  amin := greatest(1, least(12, coalesce((cfg ->> 'absentMin')::int, 2)));
  money := public.is_teacher() or coalesce((cfg ->> 'assistantSeeMoney')::boolean, true);

  select week_start, week_end into ws, we from public.week_meta
  where week_start <= today and week_end >= today order by week_start desc limit 1;
  if ws is null then
    ws := today - (extract(isodow from today)::int - 1);
    we := ws + 6;
  end if;

  with st as (
    select s.id, s.name, s.class_name, coalesce(a.name, '') as academy,
           coalesce(l.hub_code, '') as code, coalesce(l.app_share_code, '') <> '' as app
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.tb_class_academy ca on ca.class_name = s.class_name
    left join public.tb_academies a on a.id = ca.academy_id
    where not s.archived
  ),
  per as (
    select st.*,
      (select e.attend_status from public.entries e where e.student_id = st.id and e.week_start = ws) as attend,
      (select count(*) from public.entries e
        where e.student_id = st.id and e.attend_status = 'absent'
          and e.week_start > ws - aw * 7 and e.week_start <= ws)::int as absent_n,
      exists (select 1 from public.published p where p.student_id = st.id and p.week_start = ws and p.visible) as published,
      exists (select 1 from public.sent x where x.student_id = st.id and x.week_start = ws) as sent,
      (select count(*) from public.note_photos ph where ph.student_id = st.id and ph.hidden_at is null
        and ph.lesson_date between ws and we)::int as photos_week,
      (select count(*) from public.note_photos ph where ph.student_id = st.id and ph.hidden_at is null
        and ph.lesson_date between ws - 7 and ws - 1)::int as photos_prev,
      (select count(*) from public.tb_bills b where b.student_id = st.id and b.status = 'unpaid' and b.total > 0)::int as unpaid_n,
      (select coalesce(sum(b.total), 0) from public.tb_bills b where b.student_id = st.id and b.status = 'unpaid' and b.total > 0)::int as unpaid_amt,
      (select count(*) from public.student_notes n where n.student_id = st.id
        and n.follow_up and n.followed_at is null and n.deleted_at is null)::int as follow_n
    from st
  ),
  stk as (select book_id, stock, min_stock from public.tb_stock()),
  sug as (select book_id, class_name from public.tb_order_suggest() where suggested > 0),
  low as (
    select cb.class_name, jsonb_agg(distinct b.name) as books
    from public.tb_class_books cb
    join public.tb_books b on b.id = cb.book_id and b.active
    join stk on stk.book_id = b.id
    where stk.stock <= stk.min_stock
       or exists (select 1 from sug where sug.book_id = b.id and sug.class_name = cb.class_name)
    group by cb.class_name
  )
  select jsonb_build_object(
    'week', jsonb_build_object('start', ws, 'end', we),
    'today', today,
    'settings', jsonb_build_object(
      'absentWeeks', aw, 'absentMin', amin,
      'assistantSeeMoney', coalesce((cfg ->> 'assistantSeeMoney')::boolean, true),
      'money', money),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'class_name', class_name, 'academy', academy,
        'code', code, 'app', app, 'attend', coalesce(attend, ''), 'absent_n', absent_n,
        'published', published, 'sent', sent, 'photos_week', photos_week, 'photos_prev', photos_prev,
        'unpaid_n', unpaid_n, 'unpaid_amt', case when money then unpaid_amt else null end,
        'follow_n', follow_n) order by academy, class_name, name) from per), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_object_agg(class_name, books) from low), '{}'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(e)) from public.entries e
                         where e.week_start = ws and e.student_id in (select id from st)), '[]'::jsonb),
    'commons', coalesce((select jsonb_agg(to_jsonb(c)) from public.week_common c where c.week_start = ws), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;


-- ------------------------------------------------------------
--  3. 러닝노트 「누적 추이」 — 그 학생의 공개된 레포트에서만 (최근 26주)
-- ------------------------------------------------------------
create or replace function public._hub_trend_of(p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x ->> 'week_start'), '[]'::jsonb) from (
    select jsonb_build_object(
      'week_start',  p.week_start,
      'lesson_date', coalesce(p.report_data ->> 'lessonDate', ''),
      'status',      coalesce(p.report_data -> 'attendance' ->> 'status', ''),
      'focus',       case when (p.report_data ->> 'focusScore') ~ '^\d+(\.\d+)?$' then (p.report_data ->> 'focusScore')::numeric end,
      'hw',          case when (p.report_data ->> 'requiredRate') ~ '^-?\d+(\.\d+)?$' and (p.report_data ->> 'requiredRate')::numeric >= 0
                          then (p.report_data ->> 'requiredRate')::numeric end,
      'review',      (select r.score from public.review_submissions r join public.review_tests t on t.id = r.test_id
                      where r.student_id = p.student_id and r.status = 'confirmed' and not t.off
                        and t.week_start = public._monday(p.week_start)
                      order by t.lesson_date desc limit 1)
    ) as x
    from (select * from public.published where student_id = p_student and visible order by week_start desc limit 26) p
  ) w;
$$;

create or replace function public.hub_trend(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public._hub_student(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  return jsonb_build_object('ok', true, 'weeks', public._hub_trend_of(s.id));
end;
$$;

create or replace function public.staff_hub_trend(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('ok', true, 'weeks', public._hub_trend_of(p_student));
end;
$$;


-- ------------------------------------------------------------
--  4. 권한
-- ------------------------------------------------------------
do $$
begin
  execute 'revoke all on function public._hub_trend_of(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.hub_trend(text) from public';
  execute 'grant execute on function public.hub_trend(text) to anon, authenticated';
  execute 'revoke all on function public.staff_hub_trend(uuid) from public, anon';
  execute 'grant execute on function public.staff_hub_trend(uuid) to authenticated';
  execute 'revoke all on function public.entry_defaults(date, uuid[]) from public, anon';
  execute 'grant execute on function public.entry_defaults(date, uuid[]) to authenticated';
  execute 'revoke all on function public.coach_today() from public, anon';
  execute 'grant execute on function public.coach_today() to authenticated';
end;
$$;


-- ============================================================
--  확인
-- ============================================================
select 'entry_defaults' as what, exists (select 1 from pg_proc where proname = 'entry_defaults')::text as ok
union all select 'hub_trend', exists (select 1 from pg_proc where proname = 'hub_trend')::text
union all select 'coach_today', exists (select 1 from pg_proc where proname = 'coach_today')::text;
