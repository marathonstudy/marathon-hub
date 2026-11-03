-- ============================================================
--  마라톤 코치룸 — 복습테스트 「이번 주 다른 시험으로 바꾸기」 (반 전체 · 이번 수업만) (migration-063-review-alt.sql)
--
--  실행 방법
--    062 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 지금 기록은 지우지 않는다 (칸 세 개를 더하고 함수를 바꿔 쓴다).
--
--  1. 표의 시험 이름 머리 → [이번 주 다른 시험으로 바꾸기] — review_alt_set(시험, 대체 이름, 전체 문항 수(선택), 원래 점수 그대로 둘지)
--       대체 시험을 그 주에만 새 시험 한 줄로 만들고(alt_of = 원래 시험) 원래 시험은 그 주만 끈다(off · alt_to).
--       원래 시험에 낸 점수는 지우지 않는다 — 「그대로 두기」면 keep_orig 로 그 학생은 원래 시험 점수가 레포트에 그대로,
--       아니면 점수는 남겨 두고 레포트 · 평균에는 쓰지 않는다 (되돌리면 다시 보인다).
--       원래 시험에 「결석」인 학생은 대체 시험에도 결석 그대로.
--     review_alt_clear(대체 시험) — 되돌리기 (대체 시험 점수를 넣은 학생이 있으면 되돌리지 않는다)
--  2. 레포트 — 점수를 넣은 학생 「파이널 모의고사 17/20 · 85점」 · 안 넣은 학생 「대체 시험 응시 · 파이널 모의고사」(미응시라고 쓰지 않음)
--       review_week_scores · hub_review_week
--  3. 평균 · 그래프에서 원래 시험과 섞지 않는다 — _hub_trend_of(복습 점수 줄) · staff_class_weeks(주차 평균) ·
--       review_stats 는 시험마다 따로라 그대로 · 원래 점수를 그대로 둔 학생은 _hub_payload · _hub_trend_of 에 원래 시험으로
--  4. 결석 기본값(review_default_absent) · 챙길 학생(review_missing) · 「오늘」 반 카드(coach_cycle) — 대체 시험은 미응시로 세지 않는다
--  5. 학생 한 명 대체(사유 replaced) 이름 「다른 시험으로 대체」 → 「대체 시험」 · 「오늘」 미응시 목록에서 뺀다
-- ============================================================

alter table public.review_tests add column if not exists alt_of uuid references public.review_tests(id) on delete set null;
alter table public.review_tests add column if not exists alt_to uuid references public.review_tests(id) on delete set null;
alter table public.review_submissions add column if not exists keep_orig boolean not null default false;

create or replace function public._review_test_json(t public.review_tests)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', t.id, 'test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name),
    'lesson_date', t.lesson_date, 'week_start', t.week_start, 'sort_no', t.sort_no, 'off', t.off, 'extra', t.extra,
    'round_no', t.round_no, 'q_count', t.q_count,
    'deadline', (t.lesson_date + 1)::timestamp at time zone 'Asia/Seoul',
    /* 반 전체 대체 (063) — alt_of: 이 시험이 대체한 원래 시험 · alt_to: 이 시험을 대체한 시험 */
    'alt_of', t.alt_of, 'alt_to', t.alt_to,
    'orig_name', (select o.test_name from public.review_tests o where o.id = t.alt_of));
$$;

create or replace function public._review_json(s public.review_submissions, t public.review_tests, p_path boolean)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id, 'test_id', s.test_id, 'student_id', s.student_id, 'round_no', t.round_no, 'lesson_date', t.lesson_date,
    'test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name), 'sort_no', t.sort_no,
    'mode', case when s.wrong_n is null then 'numbers' else 'count' end,
    'wrong', to_jsonb(s.wrong), 'wrong_n', coalesce(s.wrong_n, cardinality(s.wrong)),
    'q_count', s.q_count, 'correct', s.correct, 'score', s.score,
    'status', s.status, 'source', s.source,
    'has_photo', jsonb_array_length(public._review_photos(s)) > 0, 'photo_n', jsonb_array_length(public._review_photos(s)),
    'submitted_at', s.submitted_at, 'confirmed_by', s.confirmed_by, 'confirmed_at', s.confirmed_at,
    'edited_by', s.edited_by, 'edited_at', s.edited_at, 'keep_orig', s.keep_orig)
    || case when p_path then jsonb_build_object('photo_path', s.photo_path,
             'photos', (select coalesce(jsonb_agg(x ->> 'path'), '[]'::jsonb) from jsonb_array_elements(public._review_photos(s)) x)) else '{}'::jsonb end;
$$;

create or replace function public._review_absent_label(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason when 'absent' then '결석' when 'late' then '지각' when 'counsel' then '상담 중'
                       when 'replaced' then '대체 시험' when 'other' then '기타'
                       when 'none' then '미응시' when 'taken' then '응시' else '' end;
$$;

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
                                'correct', s.correct, 'q_count', s.q_count, 'score', s.score, 'alt', t.alt_of is not null) as j
        from public.review_submissions s join public.review_tests t on t.id = s.test_id
       where t.week_start = p_week and (not t.off or s.keep_orig)
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
         and t.alt_of is null
         and t.lesson_date <= (now() at time zone 'Asia/Seoul')::date
         and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)
         and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = st.id)
      union all
      /* 반 전체 대체 시험 — 점수를 안 넣은 학생은 「대체 시험 응시 · 파이널 모의고사」 (미응시라고 쓰지 않는다 · 원래 시험 이름 칸 · 063) */
      select t.sort_no, o.test_name,
             jsonb_build_object('student_id', st.id, 'round_no', t.round_no, 'test_name', o.test_name,
                                'label', public._review_label(t.lesson_date, o.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                'status', 'absent', 'reason', 'alt', 'reason_label', '대체 시험 응시 · ' || t.test_name, 'alt', true)
        from public.review_tests t join public.review_tests o on o.id = t.alt_of
        join public.students st on st.class_name = t.class_name and not st.archived
       where t.week_start = p_week and not t.off
         and t.lesson_date <= (now() at time zone 'Asia/Seoul')::date
         and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)
         and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = st.id)
         and not exists (select 1 from public.review_submissions s where s.test_id = o.id and s.student_id = st.id and s.keep_orig)
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
                                'status', 'submitted', 'correct', r.correct, 'q_count', r.q_count,
                                'alt', t.alt_of is not null, 'score', case when t.alt_of is not null then r.score end) as j
        from public.review_submissions r join public.review_tests t on t.id = r.test_id
       where r.student_id = s.id and t.class_name = s.class_name and t.week_start = mon and (not t.off or r.keep_orig)
      union all
      select t.sort_no, t.test_name,
             jsonb_build_object('test_name', t.test_name, 'lesson_date', t.lesson_date,
                                'label', public._review_label(t.lesson_date, t.test_name),
                                'status', 'absent', 'reason_label', public._review_absent_label(a.reason))
        from public.review_absences a join public.review_tests t on t.id = a.test_id
       where a.student_id = s.id and t.class_name = s.class_name and t.week_start = mon and not t.off
         and not exists (select 1 from public.review_submissions r where r.test_id = a.test_id and r.student_id = a.student_id)
      union all
      /* 반 전체 대체 — 점수 입력 전은 「대체 시험 응시 · 파이널 모의고사」 (063) */
      select t.sort_no, o.test_name,
             jsonb_build_object('test_name', o.test_name, 'lesson_date', t.lesson_date,
                                'label', public._review_label(t.lesson_date, o.test_name),
                                'status', 'absent', 'reason_label', '대체 시험 응시 · ' || t.test_name, 'alt', true)
        from public.review_tests t join public.review_tests o on o.id = t.alt_of
       where t.class_name = s.class_name and t.week_start = mon and not t.off
         and t.lesson_date <= (now() at time zone 'Asia/Seoul')::date
         and not exists (select 1 from public.review_submissions r where r.test_id = t.id and r.student_id = s.id)
         and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = s.id)
         and not exists (select 1 from public.review_submissions r where r.test_id = o.id and r.student_id = s.id and r.keep_orig)
    ) x), '[]'::jsonb);
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
             where r.student_id = s.id and (not t.off or r.keep_orig)
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
                      where r.student_id = p.student_id and (not t.off or r.keep_orig) and t.alt_of is null   -- 대체 시험은 원래 시험 줄과 섞지 않는다 (063)
                        and t.week_start = public._monday(p.week_start)
                      order by (t.test_name = '복습 TEST') desc, t.sort_no, t.lesson_date desc limit 1),
      'reviews',     (select coalesce(jsonb_object_agg(z.test_name, z.score), '{}'::jsonb) from (
                        select distinct on (t.test_name) t.test_name, r.score
                          from public.review_submissions r join public.review_tests t on t.id = r.test_id
                         where r.student_id = p.student_id and (not t.off or r.keep_orig)
                           and t.week_start = public._monday(p.week_start)
                         order by t.test_name, t.lesson_date desc) z)
    ) as x
    from (select * from public.published where student_id = p_student and visible order by week_start desc limit 26) p
  ) w;
$$;

create or replace function public.review_missing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  c record;
  w date;
  b date;
  out jsonb := '[]'::jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  for c in select name from public.classes where lesson_dow is not null and not archived loop
    foreach w in array array[public._monday(today) - 7, public._monday(today)] loop
      b := public._lesson_base(c.name, w);
      if b is null or b >= today or b < today - 7 then continue; end if;
      out := out || coalesce((
        select jsonb_agg(jsonb_build_object('student_id', st.id, 'class_name', t.class_name, 'round_no', t.round_no, 'lesson_date', t.lesson_date,
                                            'test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name)) order by t.sort_no)
        from public._review_ensure_all(c.name, w) t
        join public.students st on not st.archived and btrim(st.class_name) = t.class_name
        where not t.off and t.alt_of is null      -- 반 전체 대체 시험은 안 낸 것으로 세지 않는다 (063)
          and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)
          and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = st.id)), '[]'::jsonb);
    end loop;
  end loop;
  return out;
end;
$$;

create or replace function public.coach_cycle(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  res jsonb := '[]'::jsonb;
  c jsonb;
  cls text;
  wk date; f date; t date; pf date; pt date;
  tests jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception '반 목록 모양이 올바르지 않습니다.'; end if;
  if jsonb_array_length(p) > 200 then raise exception '반이 너무 많습니다.'; end if;

  for c in select * from jsonb_array_elements(p) loop
    cls := btrim(coalesce(c ->> 'class', ''));
    begin
      wk := public._monday((c ->> 'week')::date);
      f := (c ->> 'from')::date;  t := (c ->> 'to')::date;
      pf := (c ->> 'pfrom')::date; pt := (c ->> 'pto')::date;
    exception when others then
      continue;
    end;
    if cls = '' or wk is null then continue; end if;

    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'test_name', x.test_name, 'round_no', x.round_no, 'lesson_date', x.lesson_date,
                                                 'q_count', x.q_count, 'label', public._review_label(x.lesson_date, x.test_name)) order by x.sort_no, x.test_name), '[]'::jsonb)
      into tests from public._review_ensure_all(cls, wk) x where not x.off and x.alt_of is null;   -- 반 전체 대체 시험은 세지 않는다 (063)   -- 아직 아무도 안 연 주도 시험을 만들어 센다

    res := res || jsonb_build_object(
      'class', cls,
      'week', wk,
      'tests', tests,
      'test', case when jsonb_array_length(tests) = 0 then null else tests -> 0 end,
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'published', exists (select 1 from public.published x where x.student_id = s.id and public._monday(x.week_start) = wk and x.visible),
          'sent', exists (select 1 from public.sent x where x.student_id = s.id and public._monday(x.week_start) = wk),
          'sent_at', (select max(x.sent_at) from public.sent x where x.student_id = s.id and public._monday(x.week_start) = wk),
          'missing', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)
                         and not exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)),
          'absent', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id and a.reason <> 'replaced')),
          'submitted', case when jsonb_array_length(tests) = 0 then null
                            else not exists (select 1 from jsonb_array_elements(tests) tt
                                              where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)
                                                and not exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)) end,
          'photos_cur', case when f is null or t is null then 0 else
                          (select count(*)::int from public.note_photos n where n.student_id = s.id and n.hidden_at is null and n.lesson_date between f and t) end,
          'photos_prev', case when pf is null or pt is null then 0 else
                          (select count(*)::int from public.note_photos n where n.student_id = s.id and n.hidden_at is null and n.lesson_date between pf and pt) end
        ))
        from public.students s where s.class_name = cls and not s.archived
      ), '[]'::jsonb)
    );
  end loop;
  return jsonb_build_object('ok', true, 'classes', res);
end;
$$;

create or replace function public.review_default_absent(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  with tests as (
    select * from public.review_tests
     where class_name = btrim(coalesce(p_class, '')) and week_start = p_week and not off and lesson_date < today
  ),
  who as (
    select st.id from public.students st
     where not st.archived and btrim(st.class_name) = btrim(coalesce(p_class, ''))
       and exists (select 1 from tests)
       and (st.start_on is null or st.start_on <= (select min(lesson_date) from tests))
       and not exists (select 1 from public.review_submissions x join tests t on t.id = x.test_id where x.student_id = st.id)
       and not exists (select 1 from public.review_absences a join tests t on t.id = a.test_id where a.student_id = st.id)
       and not exists (select 1 from tests t where t.alt_of is not null)      -- 반 전체 대체 시험을 본 주는 결석 기본값을 넣지 않는다 (063)
  ),
  ins as (
    insert into public.review_absences (test_id, student_id, class_name, reason, memo, set_by, set_at, auto)
    select t.id, w.id, t.class_name, 'absent', '', '기본값', now(), true from tests t cross join who w
    on conflict (test_id, student_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return jsonb_build_object('ok', true, 'set', n);
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
      round(avg(s.score) filter (where s.student_id = any(ids) and t.alt_of is null))::int avg,   -- 대체 시험은 평균에 섞지 않는다 (063)
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

/* 반 전체 · 이번 수업만 — 다른 시험으로 바꾸기 */
create or replace function public.review_alt_set(p_test uuid, p_name text, p_q integer, p_keep boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  t public.review_tests;
  a public.review_tests;
  kept int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into t from public.review_tests where id = p_test for update;
  if not found then raise exception '시험을 찾을 수 없습니다.'; end if;
  if t.off then raise exception '이번 주에 빼거나 이미 바꾼 시험입니다.'; end if;
  if t.alt_of is not null then raise exception '이미 대체한 시험입니다. 되돌린 뒤 다시 바꿔 주세요.'; end if;
  if nm = '' or char_length(nm) > 20 then raise exception '대체 시험 이름은 1 ~ 20자로 적어 주세요.'; end if;
  if p_q is not null and (p_q < 1 or p_q > 100) then raise exception '전체 문항 수는 1 ~ 100 으로 적어 주세요.'; end if;
  if exists (select 1 from public.review_tests where class_name = t.class_name and week_start = t.week_start and test_name = nm) then
    raise exception '같은 이름의 시험이 이번 주에 이미 있습니다.';
  end if;
  insert into public.review_tests (class_name, week_start, lesson_date, q_count, test_name, sort_no, extra, alt_of, updated_by)
  values (t.class_name, t.week_start, t.lesson_date, coalesce(p_q, t.q_count), nm, t.sort_no, true, t.id, coalesce(public._staff_name(), ''))
  returning * into a;
  update public.review_tests set off = true, alt_to = a.id, updated_by = coalesce(public._staff_name(), ''), updated_at = now() where id = t.id;
  if coalesce(p_keep, false) then
    update public.review_submissions set keep_orig = true where test_id = t.id;
    get diagnostics kept = row_count;
  end if;
  /* 결석은 결석 그대로 */
  insert into public.review_absences (test_id, student_id, class_name, reason, memo, set_by, set_at, auto)
  select a.id, x.student_id, x.class_name, 'absent', x.memo, x.set_by, x.set_at, x.auto
    from public.review_absences x
   where x.test_id = t.id and x.reason = 'absent'
     and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = x.student_id and s.keep_orig)
  on conflict (test_id, student_id) do nothing;
  perform public._review_renumber(t.class_name);
  perform public._review_log('alt_set', null, null, t.class_name,
    jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name)),
    jsonb_build_object('test', public._review_label(a.lesson_date, a.test_name), 'q', a.q_count, 'keep', kept));
  select * into a from public.review_tests where id = a.id;
  return jsonb_build_object('ok', true, 'test', public._review_test_json(a), 'kept', kept);
end;
$$;

/* 되돌리기 — 대체 시험 점수가 없을 때만 (원래 시험 · 원래 점수가 다시 보인다) */
create or replace function public.review_alt_clear(p_alt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.review_tests;
  n int;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into a from public.review_tests where id = p_alt for update;
  if not found or a.alt_of is null then raise exception '대체 시험을 찾을 수 없습니다.'; end if;
  select count(*) into n from public.review_submissions where test_id = a.id;
  if n > 0 then raise exception '대체 시험 점수를 넣은 학생이 % 명 있어 되돌릴 수 없습니다.', n; end if;
  delete from public.review_absences where test_id = a.id;
  update public.review_tests set off = false, alt_to = null, updated_by = coalesce(public._staff_name(), ''), updated_at = now() where id = a.alt_of;
  update public.review_submissions set keep_orig = false where test_id = a.alt_of;
  delete from public.review_tests where id = a.id;
  perform public._review_renumber(a.class_name);
  perform public._review_log('alt_clear', null, null, a.class_name, jsonb_build_object('test', public._review_label(a.lesson_date, a.test_name)), null);
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.review_alt_set(uuid, text, integer, boolean)', 'public.review_alt_clear(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'alt_of' as what, exists (select 1 from information_schema.columns where table_name = 'review_tests' and column_name = 'alt_of')::text as ok
union all select 'keep_orig', exists (select 1 from information_schema.columns where table_name = 'review_submissions' and column_name = 'keep_orig')::text
union all select '바꾸기 · 되돌리기', (exists (select 1 from pg_proc where proname = 'review_alt_set') and exists (select 1 from pg_proc where proname = 'review_alt_clear'))::text
union all select '대체 시험 이름', (public._review_absent_label('replaced') = '대체 시험')::text;
