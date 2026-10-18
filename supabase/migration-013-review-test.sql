-- ============================================================
--  마라톤 코치룸 — 복습테스트 학생 직접 기록 (migration-013-review-test.sql)
--
--  실행 방법
--    001 ~ 012 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 저장된 레포트 · 학생 기록은 바꾸지 않는다 (칸 · 표 · 함수만 더한다).
--
--  흐름
--    · 반의 기준 수업일마다 「복습테스트 n회」가 저절로 생긴다 (문항 수 = 반 기본값, 처음엔 20).
--      그 주만 문항 수를 바꾸거나 [이번 주 없음]으로 끌 수 있다. 회차는 첫 수업일부터, 꺼진 주 · 휴강은 건너뛴다.
--    · 수업일 당일, 학생이 러닝노트(개인 링크)에서 틀린 번호 + 시험지 사진(필수)으로 제출한다.
--      마감 = 수업일 당일 밤 12시(한국 시간). 마감 전까지 고칠 수 있고, 조교가 확인하면 잠긴다.
--      Edge Function(review-test)이 링크 코드 · 오늘 날짜 · 마감을 확인한다 (아래 review_status · review_submit 은 그 함수만 부른다).
--    · 조교가 사진을 보고 [확인] 또는 틀린 번호를 고친다. 휴대폰이 없는 학생은 [대신 입력] (사진 선택, 「조교 입력」).
--      누가 · 언제 확인 · 수정했는지 review_log 에 남는다 (아무도 고치거나 지울 수 없다).
--    · 조교가 확인한 점수만 레포트 · 러닝노트 그래프에 나간다. 확인 전 입력은 그 학생 개인 링크에서만 「확인 전」으로 보인다.
--  개인 링크는 학부모도 함께 본다 — 누가 입력했는지는 알 수 없어 「학생 입력」으로만 표시한다. 반 공용 링크에는 아무것도 안 나간다.
-- ============================================================


-- ------------------------------------------------------------
--  1. 반 기본 문항 수 (반 관리에서 선생님이 바꾼다)
-- ------------------------------------------------------------
alter table public.classes add column if not exists review_q smallint not null default 20;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_review_q_check') then
    alter table public.classes add constraint classes_review_q_check check (review_q between 1 and 100);
  end if;
end;
$$;


-- ------------------------------------------------------------
--  2. 표
-- ------------------------------------------------------------
create table if not exists public.review_tests (
  id           uuid primary key default gen_random_uuid(),
  class_name   text not null,
  week_start   date not null,                 -- 월요일 기준 주차
  lesson_date  date not null,                 -- 그 주 기준 수업일 (= 학생 입력 날 · 마감 날)
  round_no     integer not null default 0,    -- 복습테스트 n회 (꺼진 주는 0)
  q_count      smallint not null default 20,
  off          boolean not null default false,  -- [이번 주 없음]
  updated_by   text not null default '',
  updated_at   timestamptz not null default now(),

  constraint review_tests_q_check check (q_count between 1 and 100)
);
create unique index if not exists review_tests_week_key on public.review_tests (class_name, week_start);

create table if not exists public.review_submissions (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references public.review_tests(id) on delete restrict,
  student_id    uuid not null references public.students(id) on delete restrict,
  class_name    text not null default '',
  wrong         smallint[] not null default '{}',   -- 틀린 번호
  q_count       smallint not null,
  correct       smallint not null,
  score         smallint not null,                  -- 100점 환산 (반올림)
  photo_path    text,
  photo_bytes   integer not null default 0,
  status        text not null default 'submitted',  -- submitted 학생 제출(확인 전) · confirmed 조교 확인
  source        text not null default 'student',    -- student 학생 입력 · staff 조교 입력
  submitted_at  timestamptz not null default now(),
  confirmed_by  text not null default '',
  confirmed_at  timestamptz,
  edited_by     text not null default '',
  edited_at     timestamptz,
  updated_at    timestamptz not null default now(),

  constraint review_submissions_status_check check (status in ('submitted', 'confirmed')),
  constraint review_submissions_source_check check (source in ('student', 'staff')),
  constraint review_submissions_score_check check (score between 0 and 100 and correct between 0 and q_count)
);
create unique index if not exists review_submissions_key on public.review_submissions (test_id, student_id);
create index if not exists review_submissions_student_idx on public.review_submissions (student_id, submitted_at desc);

create table if not exists public.review_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  by_email       text not null default '',
  by_name        text not null default '',
  action         text not null,                  -- confirm 확인 · edit 점수 고침 · staff_entry 대신 입력 · test_set 문항 수/끄기 · photo_clear 사진 정리
  submission_id  uuid,
  student_id     uuid,
  class_name     text not null default '',
  before         jsonb,
  after          jsonb
);
create index if not exists review_log_at_idx on public.review_log (at desc);

alter table public.review_tests       enable row level security;
alter table public.review_submissions enable row level security;
alter table public.review_log         enable row level security;
drop policy if exists review_tests_staff_read on public.review_tests;
drop policy if exists review_submissions_staff_read on public.review_submissions;
drop policy if exists review_log_staff_read on public.review_log;
create policy review_tests_staff_read       on public.review_tests       for select to authenticated using (public.is_staff());
create policy review_submissions_staff_read on public.review_submissions for select to authenticated using (public.is_staff());
create policy review_log_staff_read         on public.review_log         for select to authenticated using (public.is_staff());
/* 세 표 모두 insert · update · delete 정책이 없다 — 아래 함수만 쓴다 */


-- ------------------------------------------------------------
--  3. 시험지 사진 보관함 — 비공개 · JPEG · 장당 600KB (화면에서 긴 변 1280px · 0.15MB 안팎으로 줄여 보낸다)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 614400, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists review_photos_staff_select on storage.objects;
drop policy if exists review_photos_staff_insert on storage.objects;
drop policy if exists review_photos_teacher_delete on storage.objects;
/* 코치룸: 보기(서명 주소) · [대신 입력] 사진 올리기는 직원, 지우기(지난 사진 정리)는 선생님. 학생 올리기는 Edge Function(service_role) */
create policy review_photos_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'review-photos' and public.is_staff());
create policy review_photos_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos' and public.is_staff());
create policy review_photos_teacher_delete on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and public.is_teacher());


-- ------------------------------------------------------------
--  4. 수업일 계산 — assets/lesson.js 와 같은 규칙 (서버가 「오늘이 수업일인가 · 마감 전인가」를 판단)
--     요일 0=일 … 6=토. 그 주에 바꾼 날이 있으면 그날, 휴강이면 없음, 첫 수업일 앞이면 없음
-- ------------------------------------------------------------
create or replace function public._monday(d date)
returns date
language sql
immutable
as $$ select d - (extract(isodow from d)::int - 1); $$;

create or replace function public._lesson_base(p_class text, p_week date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.classes;
  o public.class_weeks;
  d date;
begin
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found or c.lesson_dow is null then return null; end if;
  select * into o from public.class_weeks where class_name = c.name and week_start = p_week;
  if found then
    if o.canceled then return null; end if;
    if o.lesson_date is not null then return o.lesson_date; end if;
  end if;
  d := p_week + ((c.lesson_dow - extract(dow from p_week)::int + 7) % 7);
  if c.first_lesson is not null and d < c.first_lesson then return null; end if;
  return d;
end;
$$;


-- ------------------------------------------------------------
--  5. 그 주 시험 만들기 · 회차 매기기
-- ------------------------------------------------------------
create or replace function public._review_renumber(p_class text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.review_tests t
     set round_no = case when t.off then 0 else x.rn end
    from (select id, row_number() over (partition by off order by lesson_date, week_start) as rn
            from public.review_tests where class_name = p_class) x
   where t.id = x.id and t.class_name = p_class
     and t.round_no is distinct from (case when t.off then 0 else x.rn end);
$$;

/* 그 주 시험 (없으면 만든다). 첫 수업일이 있으면 그 뒤 빠진 주도 함께 만들어 회차가 첫 수업일부터 세어지게.
   수업일이 없는 주(요일 미설정 · 휴강 · 첫 수업 전)는 null */
create or replace function public._review_ensure(p_class text, p_week date)
returns public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.classes;
  t public.review_tests;
  w date;
  b date;
  made boolean := false;
begin
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found or c.lesson_dow is null then return null; end if;
  b := public._lesson_base(c.name, p_week);
  select * into t from public.review_tests where class_name = c.name and week_start = p_week;

  if t.id is null then
    if b is null then return null; end if;
    perform pg_advisory_xact_lock(hashtext('marathon-review:' || c.name));
    w := case when c.first_lesson is not null then public._monday(c.first_lesson) else p_week end;
    while w <= p_week loop
      if not exists (select 1 from public.review_tests where class_name = c.name and week_start = w) then
        b := public._lesson_base(c.name, w);
        if b is not null then
          insert into public.review_tests (class_name, week_start, lesson_date, q_count)
          values (c.name, w, b, c.review_q) on conflict do nothing;
          made := true;
        end if;
      end if;
      w := w + 7;
    end loop;
    if made then perform public._review_renumber(c.name); end if;
    select * into t from public.review_tests where class_name = c.name and week_start = p_week;
    return t;
  end if;

  /* 이미 있음 — 휴강으로 바뀌었으면 없음, 수업일이 바뀌었고 아직 아무도 안 냈으면 날짜를 맞춘다 */
  if b is null then return null; end if;
  if t.lesson_date <> b and not exists (select 1 from public.review_submissions where test_id = t.id) then
    update public.review_tests set lesson_date = b, updated_at = now() where id = t.id returning * into t;
    perform public._review_renumber(c.name);
    select * into t from public.review_tests where id = t.id;
  end if;
  return t;
end;
$$;

/* 그 날짜가 기준 수업일인 시험 (바꾼 수업일이 다른 주로 넘어간 경우까지 앞뒤 주를 본다) */
create or replace function public._review_on(p_class text, p_date date)
returns public.review_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  w date;
  t public.review_tests;
begin
  foreach w in array array[public._monday(p_date), public._monday(p_date) - 7, public._monday(p_date) + 7] loop
    if public._lesson_base(p_class, w) = p_date then
      t := public._review_ensure(p_class, w);
      if t.id is not null and not t.off then return t; end if;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public._review_score(p_q integer, p_wrong smallint[])
returns smallint
language sql
immutable
as $$ select round(((p_q - coalesce(cardinality(p_wrong), 0))::numeric / greatest(p_q, 1)) * 100)::smallint; $$;

/* 틀린 번호 정리 — 1 ~ 문항 수, 겹친 번호 하나로, 작은 순 */
create or replace function public._review_wrong(p_q integer, p_wrong integer[])
returns smallint[]
language plpgsql
immutable
as $$
declare
  out smallint[];
begin
  if exists (select 1 from unnest(coalesce(p_wrong, '{}')) x where x is null or x < 1 or x > p_q) then
    raise exception '틀린 번호는 1 ~ %번 사이여야 합니다.', p_q;
  end if;
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into out from unnest(coalesce(p_wrong, '{}')) x;
  return out;
end;
$$;

create or replace function public._review_json(s public.review_submissions, t public.review_tests, p_path boolean)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id, 'test_id', s.test_id, 'student_id', s.student_id, 'round_no', t.round_no, 'lesson_date', t.lesson_date,
    'wrong', to_jsonb(s.wrong), 'q_count', s.q_count, 'correct', s.correct, 'score', s.score,
    'status', s.status, 'source', s.source, 'has_photo', s.photo_path is not null,
    'submitted_at', s.submitted_at, 'confirmed_by', s.confirmed_by, 'confirmed_at', s.confirmed_at,
    'edited_by', s.edited_by, 'edited_at', s.edited_at)
    || case when p_path then jsonb_build_object('photo_path', s.photo_path) else '{}'::jsonb end;
$$;

create or replace function public._review_log(p_action text, p_sub uuid, p_student uuid, p_class text, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.review_log (by_email, by_name, action, submission_id, student_id, class_name, before, after)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), p_action, p_sub, p_student, coalesce(p_class, ''), p_before, p_after);
$$;


-- ------------------------------------------------------------
--  6. 학생 — Edge Function(review-test) 전용 (service_role 만)
-- ------------------------------------------------------------

/* 개인 링크 → 오늘 시험 · 오늘 제출 · 최근 제출 (확인 전 포함 — 그 학생 링크에서만) */
create or replace function public.review_status(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  today date := (now() at time zone 'Asia/Seoul')::date;
  t public.review_tests;
  sub public.review_submissions;
begin
  select * into s from public._hub_student(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  t := public._review_on(s.class_name, today);
  if t.id is not null then
    select * into sub from public.review_submissions where test_id = t.id and student_id = s.id;
  end if;
  return jsonb_build_object(
    'ok', true, 'today', today, 'student_id', s.id,
    'test', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'round_no', t.round_no, 'q_count', t.q_count, 'lesson_date', t.lesson_date,
      'deadline', (t.lesson_date + 1)::timestamp at time zone 'Asia/Seoul') end,
    'submission', case when sub.id is null then null else public._review_json(sub, t, true) end,
    'recent', coalesce((
      select jsonb_agg(public._review_json(x, y, true) order by y.lesson_date desc)
      from (select * from public.review_submissions where student_id = s.id order by submitted_at desc limit 8) x
      join public.review_tests y on y.id = x.test_id), '[]'::jsonb)
  );
end;
$$;

/* 제출 · 고치기 — 오늘이 그 시험의 수업일이고(= 마감 전), 조교가 아직 확인하지 않았을 때만.
   사진은 처음 낼 때 필수. 고칠 때 새 사진이 없으면 전 사진을 그대로 쓴다. 바꾼 사진이면 옛 경로를 돌려준다(함수가 지운다) */
create or replace function public.review_submit(p_code text, p_test uuid, p_wrong integer[], p_path text, p_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  today date := (now() at time zone 'Asia/Seoul')::date;
  t public.review_tests;
  old public.review_submissions;
  w smallint[];
  r public.review_submissions;
begin
  select * into s from public._hub_student(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  t := public._review_on(s.class_name, today);
  if t.id is null or t.id <> p_test then return jsonb_build_object('ok', false, 'reason', 'closed_test'); end if;
  select * into old from public.review_submissions where test_id = t.id and student_id = s.id for update;
  if old.status = 'confirmed' then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if nullif(p_path, '') is null and old.photo_path is null then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  begin
    w := public._review_wrong(t.q_count, p_wrong);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end;

  insert into public.review_submissions (test_id, student_id, class_name, wrong, q_count, correct, score, photo_path, photo_bytes, source, submitted_at, updated_at)
  values (t.id, s.id, t.class_name, w, t.q_count, t.q_count - cardinality(w), public._review_score(t.q_count, w),
          nullif(p_path, ''), case when nullif(p_path, '') is null then 0 else greatest(0, coalesce(p_bytes, 0)) end, 'student', now(), now())
  on conflict (test_id, student_id) do update
     set wrong = excluded.wrong, correct = excluded.correct, score = excluded.score, q_count = excluded.q_count,
         photo_path = coalesce(excluded.photo_path, public.review_submissions.photo_path),
         photo_bytes = case when excluded.photo_path is null then public.review_submissions.photo_bytes else excluded.photo_bytes end,
         submitted_at = now(), updated_at = now()
  returning * into r;
  return jsonb_build_object('ok', true, 'submission', public._review_json(r, t, false),
    'old_path', case when nullif(p_path, '') is not null and old.photo_path is not null and old.photo_path <> p_path then old.photo_path end);
end;
$$;


-- ------------------------------------------------------------
--  7. 코치룸 — 직원
-- ------------------------------------------------------------

/* 그 주 시험 + 반 학생별 제출 (점수 · 틀린 번호 · 사진 경로 — 직원 화면용) */
create or replace function public.review_week(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  t := public._review_ensure(p_class, p_week);
  if t.id is null then
    return jsonb_build_object('test', null, 'off_row', (select to_jsonb(x) from public.review_tests x where class_name = btrim(p_class) and week_start = p_week));
  end if;
  return jsonb_build_object(
    'test', to_jsonb(t) || jsonb_build_object('deadline', (t.lesson_date + 1)::timestamp at time zone 'Asia/Seoul'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', st.id, 'name', st.name,
               'submission', (select public._review_json(x, t, true) from public.review_submissions x where x.test_id = t.id and x.student_id = st.id))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = t.class_name), '[]'::jsonb)
  );
end;
$$;

/* 교실 화면 — 이름과 제출 여부만 (점수는 아예 보내지 않는다) */
create or replace function public.review_live(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  t := public._review_ensure(p_class, p_week);
  if t.id is null or t.off then return jsonb_build_object('test', null); end if;
  return jsonb_build_object(
    'test', jsonb_build_object('round_no', t.round_no, 'lesson_date', t.lesson_date, 'class_name', t.class_name),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('name', st.name,
               'submitted', exists (select 1 from public.review_submissions x where x.test_id = t.id and x.student_id = st.id))
             order by st.name)
      from public.students st
      where not st.archived and btrim(st.class_name) = t.class_name), '[]'::jsonb)
  );
end;
$$;

/* 그 주만 문항 수 바꾸기 · [이번 주 없음] — 이미 낸 학생이 있으면 막는다 */
create or replace function public.review_set(p_class text, p_week date, p_q integer, p_off boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
  q integer;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  t := public._review_ensure(p_class, p_week);
  if t.id is null then
    select * into t from public.review_tests where class_name = btrim(p_class) and week_start = p_week;
    if t.id is null then raise exception '이 주에는 수업일이 없습니다 (수업 요일 · 휴강을 확인해 주세요).'; end if;
  end if;
  q := coalesce(p_q, t.q_count);
  if q < 1 or q > 100 then raise exception '문항 수는 1 ~ 100 으로 적어 주세요.'; end if;
  if (q <> t.q_count or coalesce(p_off, t.off) <> t.off)
     and exists (select 1 from public.review_submissions where test_id = t.id) then
    raise exception '이미 제출한 학생이 있어 문항 수 · 이번 주 없음을 바꿀 수 없습니다.';
  end if;
  update public.review_tests set q_count = q, off = coalesce(p_off, off), updated_by = coalesce(public._staff_name(), ''), updated_at = now()
   where id = t.id;
  perform public._review_renumber(t.class_name);
  perform public._review_log('test_set', null, null, t.class_name,
    jsonb_build_object('week', t.week_start, 'q', t.q_count, 'off', t.off), jsonb_build_object('week', t.week_start, 'q', q, 'off', coalesce(p_off, t.off)));
  select * into t from public.review_tests where id = t.id;
  return jsonb_build_object('ok', true, 'test', to_jsonb(t));
end;
$$;

/* [확인] — 그대로 맞다고 확인. 잠긴다 */
create or replace function public.review_confirm(p_sub uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.review_submissions;
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into s from public.review_submissions where id = p_sub for update;
  if not found then raise exception '제출 기록을 찾을 수 없습니다.'; end if;
  select * into t from public.review_tests where id = s.test_id;
  update public.review_submissions set status = 'confirmed', confirmed_by = coalesce(public._staff_name(), ''), confirmed_at = now(), updated_at = now()
   where id = s.id returning * into s;
  perform public._review_log('confirm', s.id, s.student_id, s.class_name, null, jsonb_build_object('wrong', s.wrong, 'score', s.score));
  return jsonb_build_object('ok', true, 'submission', public._review_json(s, t, true));
end;
$$;

/* 점수 고치기 — 틀린 번호를 고치고 확인까지 (고치기 전 값을 남긴다) */
create or replace function public.review_edit(p_sub uuid, p_wrong integer[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.review_submissions;
  t public.review_tests;
  w smallint[];
  b jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into s from public.review_submissions where id = p_sub for update;
  if not found then raise exception '제출 기록을 찾을 수 없습니다.'; end if;
  select * into t from public.review_tests where id = s.test_id;
  w := public._review_wrong(s.q_count, p_wrong);
  b := jsonb_build_object('wrong', s.wrong, 'score', s.score, 'status', s.status);
  update public.review_submissions
     set wrong = w, correct = s.q_count - cardinality(w), score = public._review_score(s.q_count, w),
         status = 'confirmed', confirmed_by = coalesce(public._staff_name(), ''), confirmed_at = now(),
         edited_by = coalesce(public._staff_name(), ''), edited_at = now(), updated_at = now()
   where id = s.id returning * into s;
  perform public._review_log('edit', s.id, s.student_id, s.class_name, b, jsonb_build_object('wrong', s.wrong, 'score', s.score));
  return jsonb_build_object('ok', true, 'submission', public._review_json(s, t, true));
end;
$$;

/* [대신 입력] — 휴대폰이 없는 학생. 사진은 선택. 「조교 입력」 · 바로 확인됨 */
create or replace function public.review_staff_entry(p_test uuid, p_student uuid, p_wrong integer[], p_path text, p_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.review_tests;
  st public.students;
  w smallint[];
  r public.review_submissions;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into t from public.review_tests where id = p_test;
  if not found or t.off then raise exception '시험을 찾을 수 없습니다.'; end if;
  select * into st from public.students where id = p_student;
  if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
  if exists (select 1 from public.review_submissions where test_id = t.id and student_id = st.id) then
    raise exception '이미 제출한 기록이 있습니다. 표에서 [고치기]를 써 주세요.';
  end if;
  w := public._review_wrong(t.q_count, p_wrong);
  insert into public.review_submissions (test_id, student_id, class_name, wrong, q_count, correct, score, photo_path, photo_bytes,
                                         status, source, confirmed_by, confirmed_at)
  values (t.id, st.id, t.class_name, w, t.q_count, t.q_count - cardinality(w), public._review_score(t.q_count, w),
          nullif(p_path, ''), case when nullif(p_path, '') is null then 0 else greatest(0, coalesce(p_bytes, 0)) end,
          'confirmed', 'staff', coalesce(public._staff_name(), ''), now())
  returning * into r;
  perform public._review_log('staff_entry', r.id, st.id, t.class_name, null, jsonb_build_object('wrong', r.wrong, 'score', r.score));
  return jsonb_build_object('ok', true, 'submission', public._review_json(r, t, true));
end;
$$;

/* 레포트에 넣을 점수 — 그 주 확인된 것만 (모든 반) */
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
    select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'round_no', t.round_no, 'correct', s.correct,
                                        'q_count', s.q_count, 'score', s.score))
    from public.review_submissions s join public.review_tests t on t.id = s.test_id
    where t.week_start = p_week and s.status = 'confirmed' and not t.off), '[]'::jsonb);
end;
$$;

/* 반에서 자주 틀린 번호 — 최근 4회, 확인된 것만 (코치룸에서만) */
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
    select jsonb_agg(jsonb_build_object('round_no', t.round_no, 'lesson_date', t.lesson_date, 'q_count', t.q_count,
      'n', (select count(*) from public.review_submissions s where s.test_id = t.id and s.status = 'confirmed'),
      'avg', (select round(avg(s.score)) from public.review_submissions s where s.test_id = t.id and s.status = 'confirmed'),
      'wrong', coalesce((select jsonb_object_agg(q, c) from (
                 select x as q, count(*) as c from public.review_submissions s, unnest(s.wrong) x
                 where s.test_id = t.id and s.status = 'confirmed' group by x) z), '{}'::jsonb))
      order by t.lesson_date desc)
    from (select * from public.review_tests where class_name = btrim(p_class) and not off
            and exists (select 1 from public.review_submissions s where s.test_id = review_tests.id and s.status = 'confirmed')
          order by lesson_date desc limit 4) t), '[]'::jsonb);
end;
$$;

/* 「오늘」 — 지난 7일 안에 마감이 지났는데 안 낸 학생 */
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
  t public.review_tests;
  out jsonb := '[]'::jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  for c in select name from public.classes where lesson_dow is not null and not archived loop
    foreach w in array array[public._monday(today) - 7, public._monday(today)] loop
      b := public._lesson_base(c.name, w);
      if b is null or b >= today or b < today - 7 then continue; end if;
      t := public._review_ensure(c.name, w);
      if t.id is null or t.off then continue; end if;
      out := out || coalesce((
        select jsonb_agg(jsonb_build_object('student_id', st.id, 'class_name', t.class_name, 'round_no', t.round_no, 'lesson_date', t.lesson_date))
        from public.students st
        where not st.archived and btrim(st.class_name) = t.class_name
          and not exists (select 1 from public.review_submissions s where s.test_id = t.id and s.student_id = st.id)), '[]'::jsonb);
    end loop;
  end loop;
  return out;
end;
$$;

/* 지난 시험지 사진 정리 — 선생님. 점수 기록은 남기고 사진 경로만 비운다 (파일은 화면이 먼저 지운다) */
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
    select jsonb_agg(jsonb_build_object('id', s.id, 'path', s.photo_path, 'bytes', s.photo_bytes))
    from public.review_submissions s join public.review_tests t on t.id = s.test_id
    where t.lesson_date < p_before and s.photo_path is not null), '[]'::jsonb);
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
  select count(*), coalesce(sum(photo_bytes), 0) into n, b from public.review_submissions where id = any(p_ids) and photo_path is not null;
  update public.review_submissions set photo_path = null, photo_bytes = 0, updated_at = now() where id = any(p_ids) and photo_path is not null;
  perform public._review_log('photo_clear', null, null, '', null, jsonb_build_object('count', n, 'bytes', b));
  return jsonb_build_object('ok', true, 'count', n);
end;
$$;

/* [반 관리] 목록 — migration-010 의 class_admin_get 에 반 기본 문항 수(review_q)만 더했다 */
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
               'created_by', c.created_by, 'created_at', c.created_at, 'review_q', c.review_q) || public._class_usage(c.name)
             order by c.name)
      from public.classes c), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(to_jsonb(l) - 'by_email' order by l.at desc)
      from (select * from public.class_log order by at desc limit 30) l), '[]'::jsonb)
  );
end;
$$;

/* 반 기본 문항 수 — 선생님 ([반 관리]) */
create or replace function public.class_review_q_set(p_name text, p_q integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  if p_q is null or p_q < 1 or p_q > 100 then raise exception '문항 수는 1 ~ 100 으로 적어 주세요.'; end if;
  update public.classes set review_q = p_q where name = btrim(coalesce(p_name, ''));
  if not found then raise exception '‘%’ 반이 없습니다.', p_name; end if;
  return jsonb_build_object('ok', true, 'name', btrim(p_name), 'review_q', p_q);
end;
$$;


-- ------------------------------------------------------------
--  8. 반 관리(010 · 011 · 012)와 연결 — 이름을 바꾸면 따라가고, 복습테스트 기록이 있는 반은 삭제 막힘
-- ------------------------------------------------------------
create or replace function public._class_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'students', 'class_info', 'class_codes', 'class_notices', 'week_common',
    'tb_class_academy', 'tb_class_books', 'tb_class_dates', 'tb_issues', 'tb_order_lines',
    'tb_bill_plans', 'tb_bills', 'note_photos',
    'class_weeks', 'lesson_videos', 'class_files',
    'lesson_summaries',
    'review_tests', 'review_submissions'
  ];
$$;

do $$
declare
  t text;
begin
  foreach t in array array['review_tests', 'review_submissions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_class_follow', t);
    execute format('create trigger %I before insert or update of class_name on public.%I for each row execute function public._class_follow()',
                   t || '_class_follow', t);
  end loop;
end;
$$;

/* migration-012 의 기록 세기에 복습테스트 제출을 더했다 */
create or replace function public._class_usage(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
  t text;
  tb bigint := 0;
begin
  select count(*) filter (where not archived), count(*) filter (where archived) into n, tb
  from public.students where btrim(class_name) = p_name;
  r := r || jsonb_build_object('active', n, 'left', tb);

  select count(*) into n from public.week_common where class_name = p_name
    and (lessons <> '[]'::jsonb or tests <> '[]'::jsonb or homework <> '[]'::jsonb or btrim(comment) <> '');
  r := r || jsonb_build_object('reports', n);
  select count(*) into n from public.class_notices where class_name = p_name;
  r := r || jsonb_build_object('notices', n);
  select count(*) into n from public.class_info where class_name = p_name and extra <> '{}'::jsonb;
  r := r || jsonb_build_object('info', n);

  tb := 0;
  foreach t in array array['tb_class_academy', 'tb_class_books', 'tb_class_dates', 'tb_issues', 'tb_order_lines', 'tb_bill_plans', 'tb_bills'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where class_name = $1', t) into n using p_name;
      tb := tb + n;
    end if;
  end loop;
  r := r || jsonb_build_object('textbook', tb);

  n := 0;
  if to_regclass('public.note_photos') is not null then
    select count(*) into n from public.note_photos where class_name = p_name;
  end if;
  r := r || jsonb_build_object('photos', n);

  select count(*) into n from public.app_settings
  where key = 'exams' and coalesce(value -> 'byClass' ->> p_name, '') <> '';
  r := r || jsonb_build_object('exam', n);

  select count(*) into n from public.lesson_videos where class_name = p_name;
  r := r || jsonb_build_object('videos', n);
  select count(*) into n from public.class_files where class_name = p_name;
  r := r || jsonb_build_object('files', n);
  select count(*) into n from public.lesson_summaries where class_name = p_name;
  r := r || jsonb_build_object('summaries', n);
  select count(*) into n from public.review_submissions where class_name = p_name;
  r := r || jsonb_build_object('reviews', n);

  r := r || jsonb_build_object('records',
    (r ->> 'left')::bigint + (r ->> 'reports')::bigint + (r ->> 'notices')::bigint + (r ->> 'info')::bigint +
    (r ->> 'textbook')::bigint + (r ->> 'photos')::bigint + (r ->> 'exam')::bigint +
    (r ->> 'videos')::bigint + (r ->> 'files')::bigint + (r ->> 'summaries')::bigint + (r ->> 'reviews')::bigint);
  return r;
end;
$$;

/* 완전 삭제할 때 — 제출 없는 시험 줄(자동으로 생긴 것)도 함께 지운다. 나머지는 migration-011 과 같다 */
create or replace function public.class_delete(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  u jsonb;
begin
  perform public._need_teacher();
  perform pg_advisory_xact_lock(hashtext('marathon-class-admin'));
  if not exists (select 1 from public.classes where name = nm) then
    raise exception '‘%’ 반이 없습니다. 다른 분이 먼저 지웠을 수 있습니다 — 새로 불러옵니다.', nm;
  end if;
  u := public._class_usage(nm);
  if (u ->> 'active')::bigint > 0 or (u ->> 'records')::bigint > 0 then
    raise exception '‘%’ 반에는 학생이나 기록이 있어 지울 수 없습니다. 보관만 할 수 있습니다.', nm;
  end if;
  delete from public.class_info  where class_name = nm;
  delete from public.week_common where class_name = nm;
  delete from public.class_codes where class_name = nm;
  delete from public.class_weeks where class_name = nm;
  delete from public.review_tests where class_name = nm;
  update public.app_settings set value = jsonb_set(value, '{byClass}', (value -> 'byClass') - nm), updated_at = now()
   where key = 'exams' and jsonb_typeof(value -> 'byClass') = 'object' and (value -> 'byClass') ? nm;
  delete from public.classes where name = nm;
  perform public._class_log('delete', nm, '', u);
  return jsonb_build_object('ok', true);
end;
$$;


-- ------------------------------------------------------------
--  9. 학부모 화면 — migration-011 의 hub_get 에 확인된 복습테스트 점수(그래프용)만 더했다
--     확인 전 입력 · 사진은 여기 없다 (Edge Function 이 그 학생 링크에만 준다)
-- ------------------------------------------------------------
create or replace function public.hub_get(p_code text)
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
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if s.archived then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  return jsonb_build_object(
    'ok', true,
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
      select jsonb_agg(jsonb_build_object('round_no', x.round_no, 'lesson_date', x.lesson_date,
                                          'correct', x.correct, 'q_count', x.q_count, 'score', x.score) order by x.lesson_date)
      from (select t.round_no, t.lesson_date, r.correct, r.q_count, r.score
              from public.review_submissions r join public.review_tests t on t.id = r.test_id
             where r.student_id = s.id and r.status = 'confirmed' and not t.off
             order by t.lesson_date desc limit 20) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.hub_get(text) from public;
grant execute on function public.hub_get(text) to anon, authenticated;


-- ------------------------------------------------------------
--  10. 저장 공간 — 시험지 사진 칸을 더했다 (무료 1GB 기준)
-- ------------------------------------------------------------
create or replace function public.storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'bytes',        coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects), 0),
    'photo_bytes',  coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'note-photos'), 0),
    'photos',       (select count(*) from public.note_photos),
    'file_bytes',   coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'class-files'), 0),
    'files',        (select count(*) from public.class_files),
    'review_bytes', coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'review-photos'), 0),
    'reviews',      (select count(*) from public.review_submissions where photo_path is not null),
    'limit',        1073741824
  );
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;


-- ------------------------------------------------------------
--  11. 권한 · 실시간 반영
-- ------------------------------------------------------------
do $$
declare
  f text;
begin
  /* Edge Function(review-test) 전용 */
  foreach f in array array['public.review_status(text)', 'public.review_submit(text, uuid, integer[], text, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  /* 코치룸 (안에서 직원 · 선생님인지 다시 확인한다) */
  foreach f in array array[
    'public.review_week(text, date)', 'public.review_live(text, date)', 'public.review_set(text, date, integer, boolean)',
    'public.review_confirm(uuid)', 'public.review_edit(uuid, integer[])',
    'public.review_staff_entry(uuid, uuid, integer[], text, integer)', 'public.review_week_scores(date)',
    'public.review_stats(text)', 'public.review_missing()', 'public.review_photo_list(date)',
    'public.review_photo_clear(uuid[])', 'public.class_review_q_set(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  /* 내부 */
  foreach f in array array[
    'public._lesson_base(text, date)', 'public._review_renumber(text)', 'public._review_ensure(text, date)',
    'public._review_on(text, date)', 'public._review_log(text, uuid, uuid, text, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach f in array array['review_tests', 'review_submissions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = f) then
        execute format('alter publication supabase_realtime add table public.%I', f);
      end if;
    end loop;
  end if;
end;
$$;


-- ============================================================
--  확인 — 새 표 3개가 rls_enabled = true, 보관함 review-photos 가 public = false
-- ============================================================
select tablename as what, rowsecurity::text as ok from pg_tables
where schemaname = 'public' and tablename in ('review_tests', 'review_submissions', 'review_log')
union all
select 'bucket review-photos public', public::text from storage.buckets where id = 'review-photos'
order by 1;
