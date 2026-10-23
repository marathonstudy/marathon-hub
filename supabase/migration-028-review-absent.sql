-- ============================================================
--  마라톤 코치룸 — 복습테스트 「미응시」 사유 (migration-028-review-absent.sql)
--
--  실행 방법
--    027 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 있는 시험 · 제출 기록은 바꾸지 않는다 (표 하나를 더하고 함수를 고친다).
--
--  1. review_absences — 시험 하나 · 학생 한 명마다 미응시 사유 한 줄
--       사유: absent 결석 · late 지각 · counsel 상담 중 · replaced 다른 시험으로 대체 · other 기타
--       메모(60자까지)는 「다른 시험으로 대체」 · 「기타」에만 남고, 코치룸(직원)에서만 보인다.
--       학부모 · 학생 화면 · 레포트에는 사유 이름(「미응시 · 결석」)까지만 나간다.
--  2. review_absent_set(시험들, 학생, 사유, 메모) — 미응시 넣기 · 사유 바꾸기 (「이번 주 전부 미응시」는 시험 여러 개를 한 번에)
--       이미 낸(제출 · 대신 입력) 시험은 건너뛴다. review_absent_clear(시험, 학생) — 미응시 취소
--       누가 · 언제 했는지 review_log 에 남는다.
--  3. 학생이 직접 내거나 조교가 [대신 입력]하면 그 시험의 미응시 표시는 저절로 풀린다 (트리거).
--  4. 미응시는 「미제출」로 세지 않는다 — 「오늘」 미제출 알림(review_missing · coach_cycle)에서 빠지고,
--     시험별 평균(review_stats)은 원래 확인된 점수만 세므로 그대로 빠진다.
--  5. 학생 화면(review_status)은 미응시 시험에 입력 칸을 띄우지 않는다 (시험마다 absent = 사유 이름만).
-- ============================================================


-- ------------------------------------------------------------
--  1. 표
-- ------------------------------------------------------------
create table if not exists public.review_absences (
  test_id     uuid not null references public.review_tests(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  class_name  text not null default '',
  reason      text not null,
  memo        text not null default '',
  set_by      text not null default '',
  set_at      timestamptz not null default now(),
  primary key (test_id, student_id),
  constraint review_absences_reason_check check (reason in ('absent', 'late', 'counsel', 'replaced', 'other')),
  constraint review_absences_memo_check check (char_length(memo) <= 60)
);
create index if not exists review_absences_student_idx on public.review_absences (student_id);

alter table public.review_absences enable row level security;
drop policy if exists review_absences_staff_read on public.review_absences;
create policy review_absences_staff_read on public.review_absences for select to authenticated using (public.is_staff());
/* insert · update · delete 정책이 없다 — 아래 함수만 쓴다 */

/* 실시간 — 다른 조교 화면에도 바로 (sync.js) */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'review_absences') then
    execute 'alter publication supabase_realtime add table public.review_absences';
  end if;
end;
$$;


-- ------------------------------------------------------------
--  2. 도우미
-- ------------------------------------------------------------
/* 사유 이름 — 학부모 · 학생 화면에도 이것만 나간다 */
create or replace function public._review_absent_label(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason when 'absent' then '결석' when 'late' then '지각' when 'counsel' then '상담 중'
                       when 'replaced' then '다른 시험으로 대체' when 'other' then '기타' else '' end;
$$;

/* 코치룸용 — 메모 · 누가 · 언제까지 */
create or replace function public._review_absent_json(a public.review_absences)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('reason', a.reason, 'label', public._review_absent_label(a.reason), 'memo', a.memo,
                            'set_by', a.set_by, 'set_at', a.set_at);
$$;

/* 낸 기록이 생기면 미응시 표시를 푼다 */
create or replace function public._review_absent_auto_clear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.review_absences;
begin
  delete from public.review_absences where test_id = new.test_id and student_id = new.student_id returning * into a;
  if a.test_id is not null then
    insert into public.review_log (by_email, by_name, action, submission_id, student_id, class_name, before, after)
    values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), 'absent_auto_clear', new.id, new.student_id,
            coalesce(new.class_name, ''), jsonb_build_object('reason', a.reason, 'memo', a.memo), null);
  end if;
  return new;
end;
$$;

drop trigger if exists review_absent_auto_clear on public.review_submissions;
create trigger review_absent_auto_clear after insert on public.review_submissions
  for each row execute function public._review_absent_auto_clear();


-- ------------------------------------------------------------
--  3. 코치룸 — 미응시 넣기 · 바꾸기 · 취소
-- ------------------------------------------------------------
create or replace function public.review_absent_set(p_tests uuid[], p_student uuid, p_reason text, p_memo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rs text := btrim(coalesce(p_reason, ''));
  mm text := btrim(coalesce(p_memo, ''));
  st public.students;
  t public.review_tests;
  old public.review_absences;
  n int := 0;
  skipped int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if rs not in ('absent', 'late', 'counsel', 'replaced', 'other') then raise exception '미응시 사유를 골라 주세요.'; end if;
  if rs not in ('replaced', 'other') then mm := ''; end if;
  if char_length(mm) > 60 then raise exception '메모는 60자까지 적어 주세요.'; end if;
  if coalesce(cardinality(p_tests), 0) = 0 or cardinality(p_tests) > 10 then raise exception '시험을 골라 주세요.'; end if;
  select * into st from public.students where id = p_student;
  if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
  for t in select * from public.review_tests where id = any(p_tests) loop
    if t.off then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.review_submissions where test_id = t.id and student_id = st.id) then skipped := skipped + 1; continue; end if;
    select * into old from public.review_absences where test_id = t.id and student_id = st.id;
    insert into public.review_absences (test_id, student_id, class_name, reason, memo, set_by, set_at)
    values (t.id, st.id, t.class_name, rs, mm, coalesce(public._staff_name(), ''), now())
    on conflict (test_id, student_id) do update set reason = excluded.reason, memo = excluded.memo, set_by = excluded.set_by, set_at = now();
    perform public._review_log('absent_set', null, st.id, t.class_name,
      case when old.test_id is null then null else jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', old.reason, 'memo', old.memo) end,
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', rs, 'memo', mm));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'set', n, 'skipped', skipped);
end;
$$;

create or replace function public.review_absent_clear(p_test uuid, p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.review_absences;
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  delete from public.review_absences where test_id = p_test and student_id = p_student returning * into a;
  if a.test_id is null then return jsonb_build_object('ok', true, 'cleared', false); end if;
  select * into t from public.review_tests where id = a.test_id;
  perform public._review_log('absent_clear', null, a.student_id, a.class_name,
    jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', a.reason, 'memo', a.memo), null);
  return jsonb_build_object('ok', true, 'cleared', true);
end;
$$;


-- ------------------------------------------------------------
--  4. 코치룸 — 확인 표 · 제출 현황에 미응시까지 (025 와 같고 absent 만 더한다)
-- ------------------------------------------------------------
create or replace function public.review_week(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ft public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  perform 1 from public._review_ensure_all(p_class, p_week);
  select * into ft from public.review_tests where class_name = btrim(p_class) and week_start = p_week and not off order by sort_no, test_name limit 1;
  return jsonb_build_object(
    'tests', coalesce((select jsonb_agg(public._review_test_json(t) order by t.sort_no, t.test_name)
                         from public.review_tests t where t.class_name = btrim(p_class) and t.week_start = p_week
                          and public._lesson_base(t.class_name, p_week) is not null), '[]'::jsonb),
    'lesson_date', public._lesson_base(btrim(p_class), p_week),
    /* 예전 화면용 — 첫 시험 하나 */
    'test', case when ft.id is null then null else to_jsonb(ft) || jsonb_build_object('deadline', (ft.lesson_date + 1)::timestamp at time zone 'Asia/Seoul') end,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', st.id, 'name', st.name,
               'subs', coalesce((select jsonb_object_agg(x.test_id, public._review_json(x, t, true))
                                   from public.review_submissions x join public.review_tests t on t.id = x.test_id
                                  where x.student_id = st.id and t.class_name = btrim(p_class) and t.week_start = p_week), '{}'::jsonb),
               'absent', coalesce((select jsonb_object_agg(a.test_id, public._review_absent_json(a))
                                     from public.review_absences a join public.review_tests t on t.id = a.test_id
                                    where a.student_id = st.id and t.class_name = btrim(p_class) and t.week_start = p_week), '{}'::jsonb),
               'submission', (select public._review_json(x, ft, true) from public.review_submissions x where x.test_id = ft.id and x.student_id = st.id))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = btrim(p_class)), '[]'::jsonb)
  );
end;
$$;

/* 교실 화면 — 이름과 시험별 제출 · 미응시(사유 이름) 여부만 (점수 · 메모는 보내지 않는다) */
create or replace function public.review_live(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tests jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name),
                                               'lesson_date', t.lesson_date) order by t.sort_no, t.test_name), '[]'::jsonb)
    into tests from public._review_ensure_all(p_class, p_week) t where not t.off;
  if jsonb_array_length(tests) = 0 then return jsonb_build_object('test', null, 'tests', '[]'::jsonb); end if;
  return jsonb_build_object(
    'class_name', btrim(p_class),
    'lesson_date', tests -> 0 ->> 'lesson_date',
    'tests', tests,
    'test', jsonb_build_object('class_name', btrim(p_class), 'lesson_date', tests -> 0 ->> 'lesson_date', 'round_no', 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('name', st.name,
               'done', (select coalesce(jsonb_object_agg(tt ->> 'id', exists (select 1 from public.review_submissions x
                                                                               where x.test_id = (tt ->> 'id')::uuid and x.student_id = st.id)), '{}'::jsonb)
                          from jsonb_array_elements(tests) tt),
               'absent', (select coalesce(jsonb_object_agg(a.test_id, public._review_absent_label(a.reason)), '{}'::jsonb)
                            from public.review_absences a where a.student_id = st.id and a.test_id in (select (tt ->> 'id')::uuid from jsonb_array_elements(tests) tt)),
               'submitted', not exists (select 1 from jsonb_array_elements(tests) tt
                                         where not exists (select 1 from public.review_submissions x where x.test_id = (tt ->> 'id')::uuid and x.student_id = st.id)))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = btrim(p_class)), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------
--  5. 「오늘」 미제출 — 미응시는 빼고 센다 (025 와 같고 미응시 조건만 더한다)
-- ------------------------------------------------------------
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
        where not t.off
          and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)
          and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = st.id)), '[]'::jsonb);
    end loop;
  end loop;
  return out;
end;
$$;

/* 「오늘」 반 수업 주기 — missing 은 낸 것도 미응시도 아닌 시험만, submitted 는 남은 시험이 없으면 true, absent = 미응시 시험 이름 */
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
      into tests from public._review_ensure_all(cls, wk) x where not x.off;   -- 아직 아무도 안 연 주도 시험을 만들어 센다

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
          'missing', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)
                         and not exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)),
          'absent', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)),
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


-- ------------------------------------------------------------
--  6. 레포트 · 러닝노트 — 미응시는 사유 이름만 (메모는 나가지 않는다)
-- ------------------------------------------------------------
/* 레포트에 넣을 그 주 시험 — 027 과 같고, 미응시 줄(status absent · reason_label)을 더한다 (직원만) */
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
                                'status', case when s.status = 'confirmed' then 'confirmed' else 'submitted' end,
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
    ) x), '[]'::jsonb);
end;
$$;

/* 러닝노트 「이번 주」 카드 — 낸 것 / 확인한 것 / 미응시(사유 이름) 여부만 (점수 · 메모 없음) */
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
                                'status', case when r.status = 'confirmed' then 'confirmed' else 'submitted' end) as j
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

/* 학생 화면 (review-test 함수 · 코치룸 학생 화면 미리보기) — 025 와 같고, 시험마다 absent(사유 이름만)를 더한다.
   미응시 시험은 화면이 입력 칸을 띄우지 않는다 */
create or replace function public._review_status_of(p_student uuid, p_class text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  tests jsonb;
  ft public.review_tests;
  fsub public.review_submissions;
begin
  select coalesce(jsonb_agg(public._review_test_json(t) || jsonb_build_object(
           'submission', (select public._review_json(x, t, true) from public.review_submissions x where x.test_id = t.id and x.student_id = p_student),
           'absent', (select jsonb_build_object('label', public._review_absent_label(a.reason)) from public.review_absences a
                       where a.test_id = t.id and a.student_id = p_student))
         order by t.sort_no, t.test_name), '[]'::jsonb)
    into tests
    from public._review_tests_on(p_class, today) t;
  select * into ft from public._review_tests_on(p_class, today) limit 1;
  if ft.id is not null then
    select * into fsub from public.review_submissions where test_id = ft.id and student_id = p_student;
  end if;
  return jsonb_build_object(
    'ok', true, 'today', today, 'student_id', p_student,
    'tests', tests,
    /* 예전 화면용 — 첫 시험 하나 */
    'test', case when ft.id is null then null else public._review_test_json(ft) end,
    'submission', case when fsub.id is null then null else public._review_json(fsub, ft, true) end,
    'recent', coalesce((
      select jsonb_agg(public._review_json(x, y, true) order by y.lesson_date desc, y.sort_no)
      from (select * from public.review_submissions where student_id = p_student order by submitted_at desc limit 10) x
      join public.review_tests y on y.id = x.test_id), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._review_absent_label(text)', 'public._review_absent_json(public.review_absences)',
                           'public._review_absent_auto_clear()', 'public._review_status_of(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.review_absent_set(uuid[], uuid, text, text)', 'public.review_absent_clear(uuid, uuid)',
                           'public.review_week(text, date)', 'public.review_live(text, date)', 'public.review_missing()',
                           'public.coach_cycle(jsonb)', 'public.review_week_scores(date)'] loop
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
select 'review_absences' as what, exists (select 1 from information_schema.tables where table_name = 'review_absences')::text as ok
union all select 'auto clear trigger', exists (select 1 from pg_trigger where tgname = 'review_absent_auto_clear')::text
union all select 'absent_set (anon blocked)', (not has_function_privilege('anon', 'public.review_absent_set(uuid[], uuid, text, text)', 'execute'))::text;
