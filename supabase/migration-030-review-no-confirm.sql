-- ============================================================
--  마라톤 코치룸 — 복습테스트 「확인」 단계 없애기 · 사유 없는 미제출은 「미응시」 (migration-030-review-no-confirm.sql)
--
--  실행 방법
--    029 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 · 기록은 바꾸지 않는다 (읽기 전용 함수 여섯 개를 바꿔 쓴다).
--  예전 「확인」 여부(review_submissions.status · confirmed_by · confirmed_at)는 지우지 않는다.
--  강사 · 조교가 「고치기」 · 「대신 입력」한 기록도 그대로 남는다 (review_edit2 · review_staff_entry2 · review_log).
--
--  1. 학생이 낸 점수를 그대로 쓴다 — 확인된 것만 세던 곳을 모두 「낸 것」으로
--       review_stats(시험별 평균) · staff_class_weeks(주차 현황 복습 평균)
--       _hub_payload(러닝노트 복습 점수 · 그래프) · _hub_trend_of(누적 추이)
--       hub_review_week(레포트 복습테스트 칸) — 맞은 수 / 전체도 준다 (그 학생 자기 것만)
--  2. review_week_scores(레포트에 넣을 그 주 시험) — 낸 것도 미응시 사유도 없는 시험은 status missing 줄을 더한다.
--       공개하면 학부모 · 학생 화면에 「미응시」로만 보인다 (사유가 있으면 지금처럼 「미응시 · 결석」).
--       수업일이 오늘이거나 지난 시험만 (마감 전 학생 입력 안내는 그대로).
-- ============================================================


-- ------------------------------------------------------------
--  1. 낸 점수 그대로
-- ------------------------------------------------------------
create or replace function public.review_stats(p_class text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date,
      'n', (select count(*) from public.review_submissions s where s.test_id = t.id),
      'avg', (select round(avg(s.score)) from public.review_submissions s where s.test_id = t.id))
      order by t.lesson_date desc, t.sort_no)
    from (select * from public.review_tests where class_name = btrim(p_class) and not off
            and exists (select 1 from public.review_submissions s where s.test_id = review_tests.id)
          order by lesson_date desc, sort_no limit 8) t), '[]'::jsonb);
end;
$$;


create or replace function public.staff_class_weeks(p_class text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cls text := btrim(coalesce(p_class, ''));
  this_mon date := public._monday((now() at time zone 'Asia/Seoul')::date);
  c record;
  first_mon date;
  data_mon date;
  ids uuid[];
  total int;
  res jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  select name, lesson_dow, extra_dows, first_lesson into c from public.classes where name = cls;
  if not found then return jsonb_build_object('ok', false, 'reason', 'noclass'); end if;

  select coalesce(array_agg(id), '{}'), count(*)::int into ids, total
  from public.students where class_name = cls and not archived;

  /* 이 반 기록이 처음 생긴 주 */
  select min(m) into data_mon from (
    select public._monday(min(week_start)) m from public.week_common     where class_name = cls
    union all select public._monday(min(week_start)) from public.class_weeks      where class_name = cls
    union all select public._monday(min(week_start)) from public.lesson_videos    where class_name = cls
    union all select public._monday(min(week_start)) from public.class_files      where class_name = cls
    union all select public._monday(min(week_start)) from public.lesson_summaries where class_name = cls
    union all select public._monday(min(week_start)) from public.review_tests     where class_name = cls
    union all select public._monday(min(week_start)) from public.published        where student_id = any(ids)
  ) x;
  first_mon := least(public._monday(c.first_lesson), data_mon);
  if first_mon is null or first_mon > this_mon then first_mon := this_mon; end if;
  first_mon := greatest(first_mon, this_mon - 7 * 260);            /* 5년이면 충분 */

  with wk as (
    select g::date m from generate_series(this_mon + 7, first_mon, interval '-7 days') g
  ),
  meta as (
    select public._monday(week_start) m, min(week_start) s from public.week_meta group by 1
  ),
  ent as (
    select public._monday(week_start) m, min(week_start) s,
      count(*) filter (where attend_status in ('attend', 'late', 'makeup'))::int att,
      /* 예전 화면용 (「작성 중」 구분은 없앴다 · 030 — 코치룸은 이 값을 더 쓰지 않는다) */
      count(*) filter (where btrim(comment) <> '' or attend_status in ('late', 'absent'))::int written
    from public.entries where student_id = any(ids) group by 1
  ),
  pub as (
    select public._monday(p.week_start) m, count(*)::int n, min(p.week_start) s,
      (array_agg(p.student_id order by st.name, p.student_id))[1] sid
    from public.published p join public.students st on st.id = p.student_id
    where p.student_id = any(ids) and p.visible group by 1
  ),
  snt as (
    select public._monday(week_start) m, count(distinct student_id)::int n from public.sent where student_id = any(ids) group by 1
  ),
  cw as (
    select distinct on (public._monday(week_start)) public._monday(week_start) m, week_start, lesson_date, canceled, note
    from public.class_weeks where class_name = cls order by public._monday(week_start), week_start
  ),
  wc as (
    select distinct on (public._monday(week_start)) public._monday(week_start) m, lessons, homework
    from public.week_common where class_name = cls order by public._monday(week_start), updated_at desc
  ),
  ls as (
    select distinct on (public._monday(week_start)) public._monday(week_start) m, status, draft, confirmed
    from public.lesson_summaries where class_name = cls order by public._monday(week_start), updated_at desc
  ),
  fl as (
    select public._monday(week_start) m,
      count(*) filter (where kind = 'material')::int mat,
      count(*) filter (where kind = 'required')::int req,
      count(*) filter (where kind = 'optional')::int opt
    from public.class_files where class_name = cls group by 1
  ),
  vd as (
    select public._monday(week_start) m, count(*)::int n,
      bool_or(part = '1') p1, bool_or(part = '2') p2, bool_or(part = 'makeup') mk
    from public.lesson_videos where class_name = cls group by 1
  ),
  rv as (
    select public._monday(t.week_start) m, bool_and(t.off) off,
      count(distinct s.student_id) filter (where s.student_id = any(ids))::int sub,
      /* 낸 점수 그대로 (확인 단계 없음 · 030) */
      round(avg(s.score) filter (where s.student_id = any(ids)))::int avg,
      count(*) filter (where s.student_id = any(ids))::int conf
    from public.review_tests t left join public.review_submissions s on s.test_id = t.id
    where t.class_name = cls group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', wk.m,
    'open_start', coalesce(meta.s, ent.s, wk.m),
    'cw', case when cw.m is null then null else jsonb_build_object('week_start', cw.week_start, 'lesson_date', cw.lesson_date, 'canceled', cw.canceled, 'note', cw.note) end,
    'published', coalesce(pub.n, 0), 'pub_week', pub.s, 'pub_sid', pub.sid,
    'sent', coalesce(snt.n, 0),
    'written', coalesce(ent.written, 0),
    'attend', coalesce(ent.att, 0),
    'lesson', coalesce(
      case when jsonb_typeof(ls.confirmed) = 'array' then nullif(btrim(ls.confirmed ->> 0), '') end,
      case when jsonb_typeof(wc.lessons) = 'array' then nullif(btrim(wc.lessons ->> 0), '') end, ''),
    'lesson_ai', jsonb_typeof(ls.confirmed) = 'array' and coalesce(nullif(btrim(ls.confirmed ->> 0), ''), '') <> '',
    'draft', coalesce(ls.status = 'draft' and jsonb_typeof(ls.draft) = 'array' and jsonb_array_length(ls.draft) > 0, false),
    'hw_names', case when jsonb_typeof(wc.homework) = 'array' then jsonb_array_length(wc.homework) else 0 end,
    'files', jsonb_build_object('material', coalesce(fl.mat, 0), 'required', coalesce(fl.req, 0), 'optional', coalesce(fl.opt, 0)),
    'videos', jsonb_build_object('n', coalesce(vd.n, 0), 'p1', coalesce(vd.p1, false), 'p2', coalesce(vd.p2, false), 'makeup', coalesce(vd.mk, false)),
    'review', case when rv.m is null then null else jsonb_build_object('off', rv.off, 'submitted', rv.sub, 'confirmed', rv.conf, 'avg', rv.avg) end
  ) order by wk.m desc), '[]'::jsonb) into res
  from wk
  left join meta on meta.m = wk.m
  left join ent  on ent.m  = wk.m
  left join pub  on pub.m  = wk.m
  left join snt  on snt.m  = wk.m
  left join cw   on cw.m   = wk.m
  left join wc   on wc.m   = wk.m
  left join ls   on ls.m   = wk.m
  left join fl   on fl.m   = wk.m
  left join vd   on vd.m   = wk.m
  left join rv   on rv.m   = wk.m;

  return jsonb_build_object(
    'ok', true,
    'class', cls,
    'schedule', jsonb_build_object('dow', c.lesson_dow, 'extra', coalesce(to_jsonb(c.extra_dows), '[]'::jsonb), 'first', c.first_lesson),
    'this_week', this_mon,
    'total', total,
    'weeks', res
  );
end;
$$;


create or replace function public._hub_payload(p_student uuid, p_role text, p_can_write boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  select st.id, st.name, st.school, st.grade, st.class_name, st.archived, coalesce(l.app_share_code, '') as app_share_code
    into s
  from public.students st left join public.student_links l on l.student_id = st.id
  where st.id = p_student;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;

  return jsonb_build_object(
    'ok', true,
    'role', p_role,
    'can_write', p_can_write,
    'student', jsonb_build_object(
      'name', s.name, 'school', s.school, 'grade', s.grade, 'class_name', s.class_name
    ),
    'notices', public._notices_of(s.class_name),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week_start',   p.week_start,
               'week_end',     coalesce(p.report_data ->> 'endDate', ''),
               'lesson_date',  coalesce(p.report_data ->> 'lessonDate', ''),
               'published_at', p.published_at
             ) order by p.week_start desc)
      from public.published p
      where p.student_id = s.id and p.visible
    ), '[]'::jsonb),
    'app', jsonb_build_object(
      'linked', s.app_share_code <> '',
      'share_url', case when s.app_share_code <> ''
                        then 'https://marathonstudy.com/share/report/' || s.app_share_code
                        else '' end
    ),
    'exam', public._exam_for_class(s.class_name),
    'weekly', public._weekly_of(s.class_name, s.id),
    'review', coalesce((
      select jsonb_agg(jsonb_build_object('round_no', x.round_no, 'lesson_date', x.lesson_date, 'test_name', x.test_name,
                                          'label', public._review_label(x.lesson_date, x.test_name), 'sort_no', x.sort_no,
                                          'correct', x.correct, 'q_count', x.q_count, 'score', x.score) order by x.lesson_date, x.sort_no)
      from (select t.round_no, t.lesson_date, t.test_name, t.sort_no, r.correct, r.q_count, r.score
              from public.review_submissions r join public.review_tests t on t.id = r.test_id
             where r.student_id = s.id and not t.off
             order by t.lesson_date desc, t.sort_no limit 40) x
    ), '[]'::jsonb)
  );
end;
$$;


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
                      where r.student_id = p.student_id and not t.off
                        and t.week_start = public._monday(p.week_start)
                      order by (t.test_name = '복습 TEST') desc, t.sort_no, t.lesson_date desc limit 1),
      'reviews',     (select coalesce(jsonb_object_agg(z.test_name, z.score), '{}'::jsonb) from (
                        select distinct on (t.test_name) t.test_name, r.score
                          from public.review_submissions r join public.review_tests t on t.id = r.test_id
                         where r.student_id = p.student_id and not t.off
                           and t.week_start = public._monday(p.week_start)
                         order by t.test_name, t.lesson_date desc) z)
    ) as x
    from (select * from public.published where student_id = p_student and visible order by week_start desc limit 26) p
  ) w;
$$;


-- ------------------------------------------------------------
--  2. 레포트 · 러닝노트
-- ------------------------------------------------------------
create or replace function public.review_week_scores(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.sort_no, x.test_name) from (
      select t.sort_no, t.test_name,
             jsonb_build_object('student_id', s.student_id, 'round_no', t.round_no, 'test_name', t.test_name,
                                'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                'status', 'submitted', 'edited', s.status = 'confirmed',
                                'correct', s.correct, 'q_count', s.q_count, 'score', s.score) as j
        from public.review_submissions s join public.review_tests t on t.id = s.test_id
       where t.week_start = p_week and not t.off
      union all
      select t.sort_no, t.test_name,
             jsonb_build_object('student_id', a.student_id, 'round_no', t.round_no, 'test_name', t.test_name,
                                'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                'status', 'absent', 'reason', a.reason, 'reason_label', public._review_absent_label(a.reason))
        from public.review_absences a join public.review_tests t on t.id = a.test_id
       where t.week_start = p_week and not t.off
         and not exists (select 1 from public.review_submissions s where s.test_id = a.test_id and s.student_id = a.student_id)
      union all
      /* 낸 것도 미응시 사유도 없는 시험 — 수업일이 지났거나 오늘인 것만 (레포트에는 「미응시」로 · 030) */
      select t.sort_no, t.test_name,
             jsonb_build_object('student_id', st.id, 'round_no', t.round_no, 'test_name', t.test_name,
                                'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                'status', 'missing')
        from public.review_tests t join public.students st on st.class_name = t.class_name and not st.archived
       where t.week_start = p_week and not t.off
         and t.lesson_date <= (now() at time zone 'Asia/Seoul')::date
         and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)
         and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = st.id)
    ) x), '[]'::jsonb);
end;
$$;


create or replace function public.hub_review_week(p_code text, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  mon date;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived or p_week is null then
    return '[]'::jsonb;
  end if;
  mon := public._monday(p_week);
  return coalesce((
    select jsonb_agg(x.j order by x.sort_no, x.test_name) from (
      select t.sort_no, t.test_name,
             jsonb_build_object('test_name', t.test_name, 'lesson_date', t.lesson_date,
                                'label', public._review_label(t.lesson_date, t.test_name),
                                'status', 'submitted', 'correct', r.correct, 'q_count', r.q_count) as j
        from public.review_submissions r join public.review_tests t on t.id = r.test_id
       where r.student_id = s.id and t.class_name = s.class_name and t.week_start = mon and not t.off
      union all
      select t.sort_no, t.test_name,
             jsonb_build_object('test_name', t.test_name, 'lesson_date', t.lesson_date,
                                'label', public._review_label(t.lesson_date, t.test_name),
                                'status', 'absent', 'reason_label', public._review_absent_label(a.reason))
        from public.review_absences a join public.review_tests t on t.id = a.test_id
       where a.student_id = s.id and t.class_name = s.class_name and t.week_start = mon and not t.off
         and not exists (select 1 from public.review_submissions r where r.test_id = a.test_id and r.student_id = a.student_id)
    ) x), '[]'::jsonb);
end;
$$;


-- ------------------------------------------------------------
--  권한 (바꿔 쓴 함수는 권한이 그대로지만 한 번 더)
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.review_stats(text)', 'public.review_week_scores(date)', 'public.staff_class_weeks(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function public.hub_review_week(text, date) from public;
grant execute on function public.hub_review_week(text, date) to anon, authenticated;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'stats uses all' as what, (pg_get_functiondef('public.review_stats(text)'::regprocedure) not like '%''confirmed''%')::text as ok
union all select 'missing rows', (pg_get_functiondef('public.review_week_scores(date)'::regprocedure) like '%''missing''%')::text
union all select 'hub payload uses all', (pg_get_functiondef('public._hub_payload(uuid, text, boolean)'::regprocedure) not like '%''confirmed''%')::text;
