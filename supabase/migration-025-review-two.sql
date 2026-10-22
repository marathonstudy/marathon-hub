-- ============================================================
--  마라톤 코치룸 — 복습테스트를 「시험 2개 · 전체 문항 수 + 틀린 개수 · 날짜 이름」으로 (migration-025-review-two.sql)
--
--  실행 방법
--    024 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 예전 기록(틀린 번호 방식)은 지우지도 바꾸지도 않는다 — 「복습 TEST」 기록으로 보이고 점수도 그대로다.
--  round_no(회차) 칸도 지우지 않는다 (화면에서만 쓰지 않는다).
--
--  1. 반 수업일마다 기본 시험 목록(classes.review_names, 처음엔 「복습 TEST」 · 「화작문 TEST」)이 저절로 생긴다.
--     이름은 「10/22(목) 복습 TEST」처럼 수업일 + 시험 이름으로 부른다 (label).
--     두 번째 시험부터는 바꾼 날(review2 설정의 from, 처음 실행한 날 · 늦어도 2026-10-22) 이후 수업일에만 만든다
--     — 지난 수업일에 「화작문 TEST」가 새로 생겨 모두 「미제출」로 잡히는 일이 없게.
--     그 주만 시험 끄기(review_test_set) · 하나 더 넣기(review_test_add) · 반 기본 목록 바꾸기(class_review_names_set).
--  2. 학생은 시험마다 「전체 문항 수」와 「틀린 개수」만 적는다 (wrong_n). 틀린 번호는 받지 않는다.
--     틀린 개수 > 전체 · 전체 0 은 막는다. 점수 = 맞은 수 / 전체 × 100 (반올림).
--     시험지 사진은 필수 · 여러 장(photos) — 두 시험이 같은 사진들을 같이 쓸 수 있다.
--     두 시험을 한 번에 내거나 하나씩 낸다. 마감(수업일 밤 12시) · 확인 전 고치기 · 확인 후 잠김은 그대로.
--  3. 코치룸 — 시험별 확인 표(review_week) · 제출 현황(review_live) · 고치기(review_edit2) · 대신 입력(review_staff_entry2) ·
--     시험별 평균(review_stats) · 「오늘」 미제출(review_missing · coach_cycle — 시험 이름과 날짜까지)
--  4. 레포트 · 러닝노트 — 시험별 점수(review_week_scores · 러닝노트 review 목록에 test_name · label)
-- ============================================================


-- ------------------------------------------------------------
--  1. 칸 · 색인
-- ------------------------------------------------------------
alter table public.classes add column if not exists review_names text[] not null default array['복습 TEST', '화작문 TEST'];

alter table public.review_tests add column if not exists test_name text not null default '복습 TEST';
alter table public.review_tests add column if not exists sort_no smallint not null default 1;
alter table public.review_tests add column if not exists extra boolean not null default false;   -- 그 주만 더 넣은 시험
drop index if exists public.review_tests_week_key;
create unique index if not exists review_tests_week_name_key on public.review_tests (class_name, week_start, test_name);

alter table public.review_submissions add column if not exists wrong_n smallint;                 -- 새 방식: 틀린 개수 (예전 기록은 null)
alter table public.review_submissions add column if not exists photos jsonb not null default '[]'::jsonb;   -- [{path, bytes}]

/* 바꾼 날 — 처음 실행한 날(한국 날짜), 늦어도 2026-10-22. 그 날 이후 수업일에만 두 번째 시험부터 만든다 */
insert into public.app_settings (key, value)
values ('review2', jsonb_build_object('from', least((now() at time zone 'Asia/Seoul')::date, date '2026-10-22')))
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  2. 도우미
-- ------------------------------------------------------------
create or replace function public._review2_from()
returns date
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select (value ->> 'from')::date from public.app_settings where key = 'review2'), date '2026-10-22'); $$;

/* 「10/22(목) 복습 TEST」 */
create or replace function public._review_label(p_date date, p_name text)
returns text
language sql
immutable
as $$
  select extract(month from p_date)::int || '/' || extract(day from p_date)::int || '(' ||
         (array['일','월','화','수','목','금','토'])[extract(dow from p_date)::int + 1] || ') ' || coalesce(p_name, '');
$$;

/* 회차는 예전 「복습 TEST」 줄에만 (화면에서는 쓰지 않는다 — 칸만 지키기) */
create or replace function public._review_renumber(p_class text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.review_tests t
     set round_no = case when t.off then 0 else x.rn end
    from (select id, row_number() over (partition by off order by lesson_date, week_start) as rn
            from public.review_tests where class_name = p_class and test_name = '복습 TEST') x
   where t.id = x.id and t.class_name = p_class
     and t.round_no is distinct from (case when t.off then 0 else x.rn end);
$$;

/* 그 주 시험들 (없으면 만든다) — 기본 목록 순서대로. 수업일이 없는 주(요일 미설정 · 휴강 · 첫 수업 전)는 없음 */
create or replace function public._review_ensure_all(p_class text, p_week date)
returns setof public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.classes;
  b date;
  names text[];
  i int;
  made boolean := false;
begin
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found or c.lesson_dow is null then return; end if;
  b := public._lesson_base(c.name, p_week);
  if b is null then return; end if;
  names := case when b >= public._review2_from() then coalesce(c.review_names, '{}') else array['복습 TEST'] end;
  for i in 1 .. coalesce(array_length(names, 1), 0) loop
    if not exists (select 1 from public.review_tests where class_name = c.name and week_start = p_week and test_name = names[i]) then
      insert into public.review_tests (class_name, week_start, lesson_date, q_count, test_name, sort_no)
      values (c.name, p_week, b, c.review_q, names[i], i) on conflict do nothing;
      made := true;
    end if;
  end loop;
  /* 수업일이 바뀌었고 아직 아무도 안 냈으면 날짜를 맞춘다 */
  update public.review_tests t set lesson_date = b, updated_at = now()
   where t.class_name = c.name and t.week_start = p_week and t.lesson_date <> b
     and not exists (select 1 from public.review_submissions s where s.test_id = t.id);
  if made then perform public._review_renumber(c.name); end if;
  return query select * from public.review_tests where class_name = c.name and week_start = p_week order by sort_no, test_name;
end;
$$;

/* 예전 함수 이름 — 그 주 첫 시험 하나 (예전 화면 · 다른 함수가 부른다) */
create or replace function public._review_ensure(p_class text, p_week date)
returns public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
begin
  select * into t from public._review_ensure_all(p_class, p_week) x order by x.off, x.sort_no limit 1;
  return t;
end;
$$;

/* 그 날짜가 수업일인 켜진 시험들 (바꾼 수업일이 다른 주로 넘어간 경우까지 앞뒤 주를 본다) */
create or replace function public._review_tests_on(p_class text, p_date date)
returns setof public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  w date;
begin
  foreach w in array array[public._monday(p_date), public._monday(p_date) - 7, public._monday(p_date) + 7] loop
    if public._lesson_base(p_class, w) = p_date then
      return query select * from public._review_ensure_all(p_class, w) x where not x.off order by x.sort_no, x.test_name;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public._review_on(p_class text, p_date date)
returns public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
begin
  select * into t from public._review_tests_on(p_class, p_date) limit 1;
  return t;
end;
$$;

/* 사진 목록 — 새 방식(photos) · 예전 한 장(photo_path) */
create or replace function public._review_photos(s public.review_submissions)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(s.photos) = 'array' and jsonb_array_length(s.photos) > 0 then s.photos
              when s.photo_path is not null then jsonb_build_array(jsonb_build_object('path', s.photo_path, 'bytes', s.photo_bytes))
              else '[]'::jsonb end;
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
    'edited_by', s.edited_by, 'edited_at', s.edited_at)
    || case when p_path then jsonb_build_object('photo_path', s.photo_path,
             'photos', (select coalesce(jsonb_agg(x ->> 'path'), '[]'::jsonb) from jsonb_array_elements(public._review_photos(s)) x)) else '{}'::jsonb end;
$$;

create or replace function public._review_test_json(t public.review_tests)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', t.id, 'test_name', t.test_name, 'label', public._review_label(t.lesson_date, t.test_name),
    'lesson_date', t.lesson_date, 'week_start', t.week_start, 'sort_no', t.sort_no, 'off', t.off, 'extra', t.extra,
    'round_no', t.round_no, 'q_count', t.q_count,
    'deadline', (t.lesson_date + 1)::timestamp at time zone 'Asia/Seoul');
$$;


-- ------------------------------------------------------------
--  3. 학생 — Edge Function(review-test) 전용 (service_role 만)
-- ------------------------------------------------------------
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
  select coalesce(jsonb_agg(public._review_test_json(t) || jsonb_build_object('submission',
           (select public._review_json(x, t, true) from public.review_submissions x where x.test_id = t.id and x.student_id = p_student))
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

create or replace function public.review_status(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public._hub_student(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not public._hub_can_write(p_code) then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
  return public._review_status_of(s.id, s.class_name);
end;
$$;

/* 제출 · 고치기 (새 방식)
   p_items  [{ "test": uuid, "q": 전체 문항 수, "wrong": 틀린 개수 }] — 오늘 수업일의 켜진 시험만, 확인 전인 것만
   p_photos [{ "path", "bytes" }] — 이번에 새로 올린 사진들 (없으면 그 시험에 이미 낸 사진을 그대로 쓴다. 처음 낼 때는 필수)
   새 사진으로 바뀌어 아무 기록도 쓰지 않게 된 옛 사진 경로는 old_paths 로 돌려준다 (함수가 지운다) */
create or replace function public.review_submit2(p_code text, p_items jsonb, p_photos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  today date := (now() at time zone 'Asia/Seoul')::date;
  it jsonb;
  t public.review_tests;
  old public.review_submissions;
  r public.review_submissions;
  q int; w int;
  newp jsonb := '[]'::jsonb;
  ph jsonb;
  oldpaths text[] := '{}';
  saved jsonb := '[]'::jsonb;
  ids uuid[] := '{}';
  dayp jsonb := '[]'::jsonb;              -- 그 수업일에 이미 낸 사진 (하나 먼저 내고 다른 하나는 나중에 — 같은 사진을 같이 쓴다)
begin
  select * into s from public._hub_student(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not public._hub_can_write(p_code) then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 6 then
    return jsonb_build_object('ok', false, 'reason', 'count');
  end if;
  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('path', x ->> 'path', 'bytes', greatest(0, coalesce((x ->> 'bytes')::int, 0)))), '[]'::jsonb)
      into newp from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) x where coalesce(x ->> 'path', '') <> '';
  end if;
  if jsonb_array_length(newp) > 10 then return jsonb_build_object('ok', false, 'reason', 'photo_max'); end if;
  select coalesce((select public._review_photos(x) from public.review_submissions x
                    where x.student_id = s.id and x.test_id in (select y.id from public._review_tests_on(s.class_name, today) y)
                      and jsonb_array_length(public._review_photos(x)) > 0
                    order by x.updated_at desc limit 1), '[]'::jsonb) into dayp;

  /* 먼저 모두 확인 — 하나라도 안 맞으면 아무것도 저장하지 않는다 */
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it ->> 'test', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'reason', 'closed_test'); end if;
    select * into t from public._review_tests_on(s.class_name, today) x where x.id = (it ->> 'test')::uuid;
    if t.id is null then return jsonb_build_object('ok', false, 'reason', 'closed_test'); end if;
    if (it ->> 'test')::uuid = any(ids) then return jsonb_build_object('ok', false, 'reason', 'count'); end if;
    ids := ids || t.id;
    begin
      q := (it ->> 'q')::int; w := (it ->> 'wrong')::int;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'count');
    end;
    if q is null or w is null or q < 1 or q > 200 or w < 0 or w > q then return jsonb_build_object('ok', false, 'reason', 'count'); end if;
    select * into old from public.review_submissions where test_id = t.id and student_id = s.id;
    if old.status = 'confirmed' then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    if jsonb_array_length(newp) = 0 and (old.id is null or jsonb_array_length(public._review_photos(old)) = 0) and jsonb_array_length(dayp) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'photo');
    end if;
  end loop;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into t from public.review_tests where id = (it ->> 'test')::uuid;
    q := (it ->> 'q')::int; w := (it ->> 'wrong')::int;
    select * into old from public.review_submissions where test_id = t.id and student_id = s.id for update;
    ph := case when jsonb_array_length(newp) > 0 then newp
               when old.id is not null and jsonb_array_length(public._review_photos(old)) > 0 then public._review_photos(old)
               else dayp end;
    if old.id is not null and jsonb_array_length(newp) > 0 then
      oldpaths := oldpaths || array(select x ->> 'path' from jsonb_array_elements(public._review_photos(old)) x);
    end if;
    insert into public.review_submissions (test_id, student_id, class_name, wrong, wrong_n, q_count, correct, score,
                                           photo_path, photo_bytes, photos, source, submitted_at, updated_at)
    values (t.id, s.id, t.class_name, '{}', w, q, q - w, round(((q - w)::numeric / q) * 100)::smallint,
            ph -> 0 ->> 'path', coalesce((select sum((x ->> 'bytes')::int) from jsonb_array_elements(ph) x), 0), ph, 'student', now(), now())
    on conflict (test_id, student_id) do update
       set wrong = '{}', wrong_n = excluded.wrong_n, q_count = excluded.q_count, correct = excluded.correct, score = excluded.score,
           photo_path = excluded.photo_path, photo_bytes = excluded.photo_bytes, photos = excluded.photos,
           submitted_at = now(), updated_at = now()
    returning * into r;
    saved := saved || public._review_json(r, t, false);
  end loop;

  /* 이제 아무 기록도 쓰지 않는 옛 사진만 */
  oldpaths := array(select distinct p from unnest(oldpaths) p
                     where p is not null
                       and not exists (select 1 from public.review_submissions x where x.photo_path = p
                                         or x.photos @> jsonb_build_array(jsonb_build_object('path', p))));
  return jsonb_build_object('ok', true, 'submissions', saved, 'old_paths', to_jsonb(oldpaths));
end;
$$;


-- ------------------------------------------------------------
--  4. 코치룸 — 직원
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
               'submission', (select public._review_json(x, ft, true) from public.review_submissions x where x.test_id = ft.id and x.student_id = st.id))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = btrim(p_class)), '[]'::jsonb)
  );
end;
$$;

/* 교실 화면 — 이름과 시험별 제출 여부만 (점수는 아예 보내지 않는다) */
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
               'submitted', not exists (select 1 from jsonb_array_elements(tests) tt
                                         where not exists (select 1 from public.review_submissions x where x.test_id = (tt ->> 'id')::uuid and x.student_id = st.id)))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = btrim(p_class)), '[]'::jsonb)
  );
end;
$$;

/* 그 주 시험 하나 끄기 · 다시 켜기 — 이미 낸 학생이 있으면 끄지 못한다 */
create or replace function public.review_test_set(p_test uuid, p_off boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into t from public.review_tests where id = p_test for update;
  if not found then raise exception '시험을 찾을 수 없습니다.'; end if;
  if coalesce(p_off, false) and exists (select 1 from public.review_submissions where test_id = t.id) then
    raise exception '이미 제출한 학생이 있어 끌 수 없습니다.';
  end if;
  update public.review_tests set off = coalesce(p_off, false), updated_by = coalesce(public._staff_name(), ''), updated_at = now() where id = t.id;
  perform public._review_renumber(t.class_name);
  perform public._review_log('test_set', null, null, t.class_name,
    jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'off', t.off),
    jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'off', coalesce(p_off, false)));
  select * into t from public.review_tests where id = t.id;
  return jsonb_build_object('ok', true, 'test', public._review_test_json(t));
end;
$$;

/* 그 주만 시험 하나 더 */
create or replace function public.review_test_add(p_class text, p_week date, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  b date;
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if nm = '' or char_length(nm) > 20 then raise exception '시험 이름은 1 ~ 20자로 적어 주세요.'; end if;
  perform 1 from public._review_ensure_all(p_class, p_week);
  b := public._lesson_base(btrim(p_class), p_week);
  if b is null then raise exception '이 주에는 수업일이 없습니다 (수업 요일 · 휴강을 확인해 주세요).'; end if;
  if exists (select 1 from public.review_tests where class_name = btrim(p_class) and week_start = p_week and test_name = nm) then
    raise exception '같은 이름의 시험이 이미 있습니다.';
  end if;
  insert into public.review_tests (class_name, week_start, lesson_date, q_count, test_name, sort_no, extra, updated_by)
  values (btrim(p_class), p_week, b, 20, nm,
          coalesce((select max(sort_no) from public.review_tests where class_name = btrim(p_class) and week_start = p_week), 0) + 1,
          true, coalesce(public._staff_name(), ''))
  returning * into t;
  perform public._review_log('test_add', null, null, t.class_name, null, jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name)));
  return jsonb_build_object('ok', true, 'test', public._review_test_json(t));
end;
$$;

/* 점수 고치기 (새 방식) — 전체 · 틀린 개수, 확인까지 (고치기 전 값을 남긴다) */
create or replace function public.review_edit2(p_sub uuid, p_q integer, p_wrong integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.review_submissions;
  t public.review_tests;
  b jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_q is null or p_wrong is null or p_q < 1 or p_q > 200 or p_wrong < 0 or p_wrong > p_q then
    raise exception '전체 문항 수(1 이상)와 틀린 개수(0 ~ 전체)를 확인해 주세요.';
  end if;
  select * into s from public.review_submissions where id = p_sub for update;
  if not found then raise exception '제출 기록을 찾을 수 없습니다.'; end if;
  select * into t from public.review_tests where id = s.test_id;
  b := jsonb_build_object('q', s.q_count, 'wrong_n', coalesce(s.wrong_n, cardinality(s.wrong)), 'wrong', s.wrong, 'score', s.score, 'status', s.status);
  update public.review_submissions
     set wrong = '{}', wrong_n = p_wrong, q_count = p_q, correct = p_q - p_wrong, score = round(((p_q - p_wrong)::numeric / p_q) * 100)::smallint,
         status = 'confirmed', confirmed_by = coalesce(public._staff_name(), ''), confirmed_at = now(),
         edited_by = coalesce(public._staff_name(), ''), edited_at = now(), updated_at = now()
   where id = s.id returning * into s;
  perform public._review_log('edit', s.id, s.student_id, s.class_name, b, jsonb_build_object('q', s.q_count, 'wrong_n', s.wrong_n, 'score', s.score));
  return jsonb_build_object('ok', true, 'submission', public._review_json(s, t, true));
end;
$$;

/* [대신 입력] (새 방식) — 전체 · 틀린 개수 · 사진(선택, 여러 장). 「조교 입력」 · 바로 확인됨 */
create or replace function public.review_staff_entry2(p_test uuid, p_student uuid, p_q integer, p_wrong integer, p_photos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
  st public.students;
  ph jsonb := '[]'::jsonb;
  r public.review_submissions;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_q is null or p_wrong is null or p_q < 1 or p_q > 200 or p_wrong < 0 or p_wrong > p_q then
    raise exception '전체 문항 수(1 이상)와 틀린 개수(0 ~ 전체)를 확인해 주세요.';
  end if;
  select * into t from public.review_tests where id = p_test;
  if not found or t.off then raise exception '시험을 찾을 수 없습니다.'; end if;
  select * into st from public.students where id = p_student;
  if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
  if exists (select 1 from public.review_submissions where test_id = t.id and student_id = st.id) then
    raise exception '이미 제출한 기록이 있습니다. 표에서 [고치기]를 써 주세요.';
  end if;
  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('path', x ->> 'path', 'bytes', greatest(0, coalesce((x ->> 'bytes')::int, 0)))), '[]'::jsonb)
      into ph from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) x where coalesce(x ->> 'path', '') <> '';
  end if;
  insert into public.review_submissions (test_id, student_id, class_name, wrong, wrong_n, q_count, correct, score, photo_path, photo_bytes, photos,
                                         status, source, confirmed_by, confirmed_at)
  values (t.id, st.id, t.class_name, '{}', p_wrong, p_q, p_q - p_wrong, round(((p_q - p_wrong)::numeric / p_q) * 100)::smallint,
          ph -> 0 ->> 'path', coalesce((select sum((x ->> 'bytes')::int) from jsonb_array_elements(ph) x), 0), ph,
          'confirmed', 'staff', coalesce(public._staff_name(), ''), now())
  returning * into r;
  perform public._review_log('staff_entry', r.id, st.id, t.class_name, null, jsonb_build_object('q', r.q_count, 'wrong_n', r.wrong_n, 'score', r.score));
  return jsonb_build_object('ok', true, 'submission', public._review_json(r, t, true));
end;
$$;

/* 레포트에 넣을 점수 — 그 주 확인된 것만 (모든 반) · 시험마다 한 줄 */
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
    select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'round_no', t.round_no, 'test_name', t.test_name,
                                        'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                        'correct', s.correct, 'q_count', s.q_count, 'score', s.score) order by t.sort_no, t.test_name)
    from public.review_submissions s join public.review_tests t on t.id = s.test_id
    where t.week_start = p_week and s.status = 'confirmed' and not t.off), '[]'::jsonb);
end;
$$;

/* 반의 시험별 평균 — 최근 8개 시험, 확인된 것만 (코치룸에서만) */
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
      'n', (select count(*) from public.review_submissions s where s.test_id = t.id and s.status = 'confirmed'),
      'avg', (select round(avg(s.score)) from public.review_submissions s where s.test_id = t.id and s.status = 'confirmed'))
      order by t.lesson_date desc, t.sort_no)
    from (select * from public.review_tests where class_name = btrim(p_class) and not off
            and exists (select 1 from public.review_submissions s where s.test_id = review_tests.id and s.status = 'confirmed')
          order by lesson_date desc, sort_no limit 8) t), '[]'::jsonb);
end;
$$;

/* 「오늘」 — 지난 7일 안에 마감이 지났는데 안 낸 시험 (학생 · 시험마다 한 줄) */
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
          and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)), '[]'::jsonb);
    end loop;
  end loop;
  return out;
end;
$$;

/* 「오늘」 반 수업 주기 — migration-022 와 같고, 복습테스트를 시험마다 (missing = 안 낸 시험 이름) */
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
                       where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)),
          'submitted', case when jsonb_array_length(tests) = 0 then null
                            else not exists (select 1 from jsonb_array_elements(tests) tt
                                              where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)) end,
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

/* 지난 시험지 사진 정리 — 사진마다 한 줄 (여러 장 · 두 시험이 같이 쓴 사진 포함) */
create or replace function public.review_photo_list(p_before date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'path', x ->> 'path', 'bytes', coalesce((x ->> 'bytes')::int, 0)))
    from public.review_submissions s join public.review_tests t on t.id = s.test_id,
         jsonb_array_elements(public._review_photos(s)) x
    where t.lesson_date < p_before), '[]'::jsonb);
end;
$$;

create or replace function public.review_photo_clear(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  b bigint;
begin
  perform public._need_teacher();
  select coalesce(sum(jsonb_array_length(public._review_photos(s))), 0), coalesce(sum(s.photo_bytes), 0) into n, b
    from public.review_submissions s where id = any(p_ids);
  update public.review_submissions set photo_path = null, photo_bytes = 0, photos = '[]'::jsonb, updated_at = now()
   where id = any(p_ids) and (photo_path is not null or jsonb_array_length(photos) > 0);
  perform public._review_log('photo_clear', null, null, '', null, jsonb_build_object('count', n, 'bytes', b));
  return jsonb_build_object('ok', true, 'count', n);
end;
$$;

/* 반 기본 시험 목록 — [반 관리] (이름 1 ~ 20자 · 1 ~ 5개 · 순서대로). 이미 만든 주의 시험은 그대로 */
create or replace function public.class_review_names_set(p_name text, p_names text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  names text[];
begin
  perform public._need_teacher();
  select coalesce(array_agg(n order by o), '{}') into names
    from (select distinct on (btrim(x)) btrim(x) n, o from unnest(coalesce(p_names, '{}')) with ordinality u(x, o)
           where btrim(coalesce(x, '')) <> '' order by btrim(x), o) z;
  if cardinality(names) < 1 or cardinality(names) > 5 then raise exception '시험은 1 ~ 5개로 정해 주세요.'; end if;
  if exists (select 1 from unnest(names) n where char_length(n) > 20) then raise exception '시험 이름은 20자까지 적어 주세요.'; end if;
  update public.classes set review_names = names where name = btrim(coalesce(p_name, ''));
  if not found then raise exception '‘%’ 반이 없습니다.', p_name; end if;
  return jsonb_build_object('ok', true, 'name', btrim(p_name), 'review_names', to_jsonb(names));
end;
$$;

/* [반 관리] 목록 — 기본 시험 목록(review_names)까지 */
create or replace function public.class_admin_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  return jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'archived', c.archived, 'archived_by', c.archived_by, 'archived_at', c.archived_at,
               'created_by', c.created_by, 'created_at', c.created_at, 'review_q', c.review_q, 'review_names', to_jsonb(c.review_names)) || public._class_usage(c.name)
             order by c.name)
      from public.classes c), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(to_jsonb(l) - 'by_email' order by l.at desc)
      from (select * from public.class_log order by at desc limit 30) l), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------
--  5. 러닝노트 — 확인된 점수에 시험 이름 · 날짜 이름 (그래프 · 「이번 주」 카드 · 누적 추이)
-- ------------------------------------------------------------
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
             where r.student_id = s.id and r.status = 'confirmed' and not t.off
             order by t.lesson_date desc, t.sort_no limit 40) x
    ), '[]'::jsonb)
  );
end;
$$;

/* 누적 추이 — review = 「복습 TEST」 점수(예전과 같은 줄), reviews = 시험 이름 → 점수 */
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
                      order by (t.test_name = '복습 TEST') desc, t.sort_no, t.lesson_date desc limit 1),
      'reviews',     (select coalesce(jsonb_object_agg(z.test_name, z.score), '{}'::jsonb) from (
                        select distinct on (t.test_name) t.test_name, r.score
                          from public.review_submissions r join public.review_tests t on t.id = r.test_id
                         where r.student_id = p.student_id and r.status = 'confirmed' and not t.off
                           and t.week_start = public._monday(p.week_start)
                         order by t.test_name, t.lesson_date desc) z)
    ) as x
    from (select * from public.published where student_id = p_student and visible order by week_start desc limit 26) p
  ) w;
$$;

/* 학생 화면 미리보기 (코치룸) — review_status 와 같은 모양 */
create or replace function public.staff_review_status(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.students;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  select * into s from public.students where id = p_student;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  return public._review_status_of(s.id, s.class_name);
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._review2_from()', 'public._review_ensure_all(text, date)', 'public._review_tests_on(text, date)',
                           'public._review_status_of(uuid, text)', 'public._review_photos(public.review_submissions)',
                           'public._review_test_json(public.review_tests)', 'public._review_label(date, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  /* 학생 쪽 — Edge Function(service_role)만 */
  foreach f in array array['public.review_status(text)', 'public.review_submit2(text, jsonb, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.review_week(text, date)', 'public.review_live(text, date)', 'public.review_test_set(uuid, boolean)',
                           'public.review_test_add(text, date, text)', 'public.review_edit2(uuid, integer, integer)',
                           'public.review_staff_entry2(uuid, uuid, integer, integer, jsonb)', 'public.review_week_scores(date)',
                           'public.review_stats(text)', 'public.review_missing()', 'public.coach_cycle(jsonb)',
                           'public.review_photo_list(date)', 'public.review_photo_clear(uuid[])', 'public.class_review_names_set(text, text[])',
                           'public.class_admin_get()', 'public.staff_review_status(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'review_names' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'review_names')::text as ok
union all select 'test_name key', exists (select 1 from pg_indexes where indexname = 'review_tests_week_name_key')::text
union all select 'submit2 (anon blocked)', (not has_function_privilege('anon', 'public.review_submit2(text, jsonb, jsonb)', 'execute'))::text;
