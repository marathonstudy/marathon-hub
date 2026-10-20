-- ============================================================
--  마라톤 코치룸 — 반별 「주차 현황」 (migration-018-class-weeks.sql)
--
--  실행 방법
--    017 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 · 기록은 하나도 바꾸지 않는다 (읽기 전용 함수 하나만 만든다).
--
--  staff_class_weeks(반이름) — ② 작성 → 반을 고르면 나오는 「주차 현황」을 한 번에 가져온다
--    · 직원(조교 · 선생님) 만. 학생 · 학부모 링크(anon)는 부를 수 없다.
--    · 주차 = 월요일 기준. 첫 수업일이 있는 주(그보다 앞선 기록이 있으면 그 주)부터 다음 주까지, 최신 주가 먼저.
--      첫 수업일도 기록도 없으면 이번 주 · 다음 주만.
--    · 주차마다: 레포트 공개 · 보냄 수, 수업 내용 첫 줄 · 초안 여부, 배부 · 필수 · 선택 파일 수,
--      영상 차시, 출석, 복습테스트(확인된 점수 평균 · 제출 수).
--    · '전체' = 지금 그 반의 보관되지 않은 학생. 세는 것도 그 학생들만.
-- ============================================================


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
      count(*) filter (where comment <> '' or attend_note <> '' or scores <> '{}'::jsonb or homework <> '{}'::jsonb
                         or attend_status in ('late', 'absent', 'makeup'))::int written
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
      round(avg(s.score) filter (where s.status = 'confirmed' and s.student_id = any(ids)))::int avg,
      count(*) filter (where s.status = 'confirmed' and s.student_id = any(ids))::int conf
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

revoke all on function public.staff_class_weeks(text) from public, anon;
grant execute on function public.staff_class_weeks(text) to authenticated;


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select 'staff_class_weeks' as what, exists (select 1 from pg_proc where proname = 'staff_class_weeks')::text as ok
union all select 'anon blocked', (not has_function_privilege('anon', 'public.staff_class_weeks(text)', 'execute'))::text;
