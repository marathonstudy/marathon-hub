-- ============================================================
--  마라톤 코치룸 — 「과정 + 회차」 · 담당 조교 (migration-033-course.sql)
--
--  실행 방법
--    032 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 레포트 · 학생 기록은 지우거나 옮기지 않는다 (표 · 칸 · 함수만 더한다).
--
--  과정 (courses)        여러 반이 같은 회차 수업을 요일만 다르게 듣는 묶음 — 예) 고3 수능국어 (토 목동반 · 일 반포반)
--    · 회차 = 첫 회차 시작일(start_date)부터 7일씩. start_no 회차부터 센다 (예: 7회차부터 쓰기 시작)
--    · 각 반의 그 회차 수업일 = 그 7일 안의 반 수업 요일 (그 반만 바꾼 날 · 휴강은 class_weeks 그대로)
--  과정에 든 반 (course_members) — 반은 과정 하나에만. 넣은 회차(from_no)부터 · 뺀 회차(to_no) 앞까지
--    · 뺀 반의 지난 레포트는 그 반에 그대로 남는다 (레포트 · 공개 · 보냄은 늘 반마다 따로 저장)
--  과정 공통 내용 — 과정 이름 앞에 「§」를 붙인 칸(예: §고3 수능국어)의 회차 시작 주에 한 번만 쓴다
--    (반 공통 week_common · 수업 영상 lesson_videos · 자료 class_files · 확정 요약 lesson_summaries)
--    course_sync(과정, 회차) 가 각 반의 그 주 칸으로 복사한다 → 학부모 화면 · 파일 내려받기 · 반 공지는 그대로 자기 반 칸만 읽는다
--    · 그 반에서 직접 고친 칸(week_common.local)은 덮지 않는다 · 「이 반만 한 줄 추가」는 week_common.extra
--    · 복습테스트는 반마다 그 반 수업일로 따로 (마감 = 그 반 수업일 밤 12시) — 과정의 첫 반 시험 목록을 다른 반에 맞춘다
--  담당 조교 (classes.assistant · 직원 이메일) — 「오늘」 · 레포트 발송에서 자기 반이 맨 위 (권한은 그대로)
-- ============================================================


-- ------------------------------------------------------------
--  1. 표 · 칸
-- ------------------------------------------------------------
create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  date not null,                       -- start_no 회차의 첫날 (예: 10/24 토)
  start_no    integer not null default 1,
  week_label  boolean not null default false,      -- 「10월 4주」 표기 (설정에서 켤 때만)
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint courses_name_check check (name = btrim(name) and length(name) between 1 and 40 and name !~ '^§'),
  constraint courses_no_check check (start_no between 1 and 999)
);
create unique index if not exists courses_name_key on public.courses (name);

create table if not exists public.course_members (
  course_id   uuid not null references public.courses(id) on delete cascade,
  class_name  text not null,
  from_no     integer not null,
  to_no       integer,                             -- 비어 있으면 지금도 든 반
  created_by  text not null default '',
  created_at  timestamptz not null default now(),

  primary key (course_id, class_name, from_no),
  constraint course_members_range check (to_no is null or to_no >= from_no - 1)
);
/* 한 반은 과정 하나에만 (지금 든 것 기준) */
create unique index if not exists course_members_one_active on public.course_members (class_name) where to_no is null;

alter table public.classes      add column if not exists assistant text not null default '';
alter table public.week_common  add column if not exists extra text not null default '';           -- 「이 반만 한 줄 추가」
alter table public.week_common  add column if not exists local jsonb not null default '[]'::jsonb; -- 과정 내용을 이 반에서 직접 고친 칸 ["lessons", "comment"]
alter table public.lesson_videos add column if not exists course_src uuid references public.lesson_videos(id) on delete cascade;
alter table public.class_files   add column if not exists course_src uuid references public.class_files(id) on delete cascade;
alter table public.lesson_summaries add column if not exists from_course boolean not null default false;

/* 과정 자료는 반마다 같은 보관 파일을 가리킨다 — 보관 위치(path)가 같아도 되게 (원본만 하나) */
drop index if exists public.class_files_path_key;
create unique index if not exists class_files_path_src_key on public.class_files (path) where course_src is null;

alter table public.courses enable row level security;
alter table public.course_members enable row level security;
drop policy if exists courses_staff_read on public.courses;
drop policy if exists course_members_staff_read on public.course_members;
create policy courses_staff_read on public.courses for select to authenticated using (public.is_staff());
create policy course_members_staff_read on public.course_members for select to authenticated using (public.is_staff());
/* 쓰기는 아래 함수만 */


-- ------------------------------------------------------------
--  2. 회차 계산
-- ------------------------------------------------------------
create or replace function public._course_key(p_name text) returns text language sql immutable as $$ select '§' || btrim(coalesce(p_name, '')); $$;

/* 회차 n 의 첫날 */
create or replace function public._course_round_start(c public.courses, n integer) returns date language sql immutable as $$
  select c.start_date + 7 * (n - c.start_no);
$$;

/* 그 회차에 든 반마다 수업일 · 주 (휴강이면 빠진다) */
create or replace function public._course_member_dates(p_course uuid, n integer)
returns table (class_name text, lesson_date date, week_start date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.courses;
  rs date;
  m record;
  w date;
  d date;
begin
  select * into c from public.courses where id = p_course;
  if not found then return; end if;
  rs := public._course_round_start(c, n);
  for m in select cm.class_name, k.lesson_dow from public.course_members cm join public.classes k on k.name = cm.class_name
            where cm.course_id = p_course and cm.from_no <= n and (cm.to_no is null or n <= cm.to_no) and k.lesson_dow is not null loop
    w := public._monday(rs + ((m.lesson_dow - extract(dow from rs)::int + 7) % 7));
    d := public._lesson_base(m.class_name, w);
    if d is not null then
      class_name := m.class_name; lesson_date := d; week_start := w;
      return next;
    end if;
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  3. 과정 만들기 · 고치기 · 반 넣기 / 빼기 · 담당 조교 (직원 누구나)
-- ------------------------------------------------------------
create or replace function public.course_save(p_id uuid, p_name text, p_start date, p_start_no integer, p_week_label boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  r public.courses;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if nm = '' then raise exception '과정 이름을 적어 주세요.'; end if;
  if p_start is null then raise exception '첫 회차 시작일을 골라 주세요.'; end if;
  if exists (select 1 from public.classes where name = nm) then raise exception '반 이름과 같은 과정 이름은 쓸 수 없습니다.'; end if;
  if p_id is null then
    insert into public.courses (name, start_date, start_no, week_label, created_by)
    values (nm, p_start, greatest(1, coalesce(p_start_no, 1)), coalesce(p_week_label, false), public._staff_name())
    returning * into r;
  else
    update public.courses set name = nm, start_date = p_start, start_no = greatest(1, coalesce(p_start_no, 1)),
           week_label = coalesce(p_week_label, false), updated_at = now()
     where id = p_id returning * into r;
    if not found then raise exception '과정을 찾지 못했습니다.'; end if;
  end if;
  return to_jsonb(r);
end;
$$;

/* 오늘이 든 회차 (아직 시작 전이면 start_no) */
create or replace function public._course_round_now(c public.courses)
returns integer
language sql
stable
as $$
  select greatest(c.start_no, c.start_no + floor(((now() at time zone 'Asia/Seoul')::date - c.start_date) / 7.0)::int);
$$;

/* 반 넣기 — 지금 회차부터 · 빼기 — 지금 회차 앞까지 (지난 레포트는 그 반에 그대로) */
create or replace function public.course_member_set(p_course uuid, p_class text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.courses;
  nm text := btrim(coalesce(p_class, ''));
  n integer;
  other text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into c from public.courses where id = p_course;
  if not found then raise exception '과정을 찾지 못했습니다.'; end if;
  if not exists (select 1 from public.classes where name = nm) then raise exception '반을 찾지 못했습니다.'; end if;
  n := public._course_round_now(c);
  if coalesce(p_on, false) then
    select k.name into other from public.course_members m join public.courses k on k.id = m.course_id
     where m.class_name = nm and m.to_no is null and m.course_id <> p_course limit 1;
    if other is not null then raise exception '「%」 반은 이미 「%」 과정에 들어 있습니다. 한 반은 과정 하나에만 넣을 수 있습니다.', nm, other; end if;
    if exists (select 1 from public.course_members where course_id = p_course and class_name = nm and to_no is null) then
      return jsonb_build_object('ok', true, 'from_no', n);
    end if;
    /* 같은 회차에 뺐다가 다시 넣으면 그 줄을 되살린다 */
    update public.course_members set to_no = null where course_id = p_course and class_name = nm and to_no >= n - 1 and from_no <= n;
    if not found then
      insert into public.course_members (course_id, class_name, from_no, created_by) values (p_course, nm, n, public._staff_name());
    end if;
  else
    update public.course_members set to_no = n - 1 where course_id = p_course and class_name = nm and to_no is null;
    delete from public.course_members where course_id = p_course and class_name = nm and to_no is not null and to_no < from_no;
  end if;
  return jsonb_build_object('ok', true, 'round', n);
end;
$$;

create or replace function public.class_assistant_set(p_name text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if em <> '' and not exists (select 1 from public.staff where lower(email) = em) then raise exception '직원 목록에 없는 이메일입니다.'; end if;
  update public.classes set assistant = em where name = btrim(coalesce(p_name, ''));
  if not found then raise exception '반을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok', true, 'name', btrim(p_name), 'assistant', em);
end;
$$;


-- ------------------------------------------------------------
--  4. common_patch — 「이 반만 한 줄 추가」(extra) · 이 반에서 직접 고친 칸(local)도 받는다 (나머지는 003 과 같다)
-- ------------------------------------------------------------
create or replace function public.common_patch(
  p_week date, p_class text, p_set jsonb, p_base jsonb, p_force boolean default false)
returns jsonb
language plpgsql
as $$
declare
  r public.week_common;
  cur jsonb;
  k text;
  v jsonb;
  conflicts text[] := '{}';
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;
  if coalesce(btrim(p_class), '') = '' then raise exception '반 이름이 비었습니다.'; end if;

  insert into public.week_common (week_start, class_name) values (p_week, p_class)
  on conflict (week_start, class_name) do nothing;
  select * into r from public.week_common where week_start = p_week and class_name = p_class for update;
  cur := to_jsonb(r);

  if not coalesce(p_force, false) then
    for k, v in select * from jsonb_each(coalesce(p_base, '{}'::jsonb)) loop
      if p_set ? k and public._flat_get(cur, k) is distinct from v then
        conflicts := conflicts || k;
      end if;
    end loop;
  end if;

  for k, v in select * from jsonb_each(coalesce(p_set, '{}'::jsonb)) loop
    if k in ('lessons', 'tests', 'homework', 'comment', 'extra', 'local') and not (k = any(conflicts)) then
      cur := cur || jsonb_build_object(k, v);
    end if;
  end loop;

  update public.week_common set
    lessons  = coalesce(cur -> 'lessons', '[]'::jsonb),
    tests    = coalesce(cur -> 'tests', '[]'::jsonb),
    homework = coalesce(cur -> 'homework', '[]'::jsonb),
    comment  = coalesce(cur ->> 'comment', ''),
    extra    = coalesce(cur ->> 'extra', ''),
    local    = case when jsonb_typeof(cur -> 'local') = 'array' then cur -> 'local' else '[]'::jsonb end
  where id = r.id
  returning to_jsonb(week_common.*) into cur;

  return jsonb_build_object('ok', array_length(conflicts, 1) is null,
                            'conflicts', to_jsonb(conflicts), 'row', cur);
end;
$$;


-- ------------------------------------------------------------
--  5. course_sync — 과정 공통 내용을 그 회차 각 반의 그 주 칸으로 (직원 누구나 · 여러 번 불러도 같다)
-- ------------------------------------------------------------
create or replace function public.course_sync(p_course uuid, p_no integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.courses;
  k text;
  kw date;
  src public.week_common;
  sm public.lesson_summaries;
  m record;
  lead text;
  lead_week date;
  t record;
  n integer := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into c from public.courses where id = p_course;
  if not found then raise exception '과정을 찾지 못했습니다.'; end if;
  k := public._course_key(c.name);
  kw := public._monday(public._course_round_start(c, p_no));
  select * into src from public.week_common where class_name = k and week_start = kw;
  select * into sm from public.lesson_summaries where class_name = k and week_start = kw;

  for m in select * from public._course_member_dates(p_course, p_no) order by lesson_date, class_name loop
    n := n + 1;
    if lead is null then lead := m.class_name; lead_week := m.week_start; end if;

    /* 반 공통 — 수업 내용 · 코멘트 (이 반에서 직접 고친 칸은 그대로) */
    if src.id is not null then
      insert into public.week_common (week_start, class_name) values (m.week_start, m.class_name)
      on conflict (week_start, class_name) do nothing;
      update public.week_common w set
        lessons = case when w.local ? 'lessons' then w.lessons else src.lessons end,
        comment = case when w.local ? 'comment' then w.comment else src.comment end
       where w.class_name = m.class_name and w.week_start = m.week_start
         and ((not w.local ? 'lessons' and w.lessons is distinct from src.lessons)
           or (not w.local ? 'comment' and w.comment is distinct from src.comment));
    end if;

    /* 확정된 수업 요약 — 이 반이 따로 확정한 것은 그대로 */
    if sm.class_name is not null and sm.confirmed is not null then
      insert into public.lesson_summaries (class_name, week_start, status, confirmed, confirmed_by, confirmed_at, from_course)
      values (m.class_name, m.week_start, 'confirmed', sm.confirmed, sm.confirmed_by, sm.confirmed_at, true)
      on conflict (class_name, week_start) do update set confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at, status = 'confirmed', updated_at = now()
      where public.lesson_summaries.from_course and public.lesson_summaries.confirmed is distinct from excluded.confirmed;
    end if;

    /* 수업 영상 — 과정 영상 (반 전체용만) 복사 · 고친 제목 · 순서 맞추기 · 과정에서 지운 것은 함께 빠진다(외래키) */
    update public.lesson_videos v set part = s.part, title = s.title, url = s.url, sort = s.sort, updated_at = now()
      from public.lesson_videos s
     where v.course_src = s.id and v.class_name = m.class_name and v.week_start = m.week_start
       and (v.part, v.title, v.url, v.sort) is distinct from (s.part, s.title, s.url, s.sort);
    insert into public.lesson_videos (class_name, week_start, part, title, url, sort, created_by, updated_by, course_src)
    select m.class_name, m.week_start, s.part, s.title, s.url, s.sort, s.created_by, s.updated_by, s.id
      from public.lesson_videos s
     where s.class_name = k and s.week_start = kw and cardinality(s.student_ids) = 0
       and not exists (select 1 from public.lesson_videos v where v.course_src = s.id and v.class_name = m.class_name and v.week_start = m.week_start);

    /* 자료 · 과제 파일 — 같은 보관 파일을 가리키는 줄만 더한다 (파일은 하나) */
    update public.class_files f set name = s.name, kind = s.kind, thumb_path = s.thumb_path, thumb_bytes = s.thumb_bytes, updated_at = now()
      from public.class_files s
     where f.course_src = s.id and f.class_name = m.class_name and f.week_start = m.week_start
       and (f.name, f.kind, f.thumb_path) is distinct from (s.name, s.kind, s.thumb_path);
    insert into public.class_files (class_name, week_start, kind, name, orig_name, ext, mime, bytes, path, created_by, created_name, thumb_path, thumb_bytes, course_src)
    select m.class_name, m.week_start, s.kind, s.name, s.orig_name, s.ext, s.mime, s.bytes, s.path, s.created_by, s.created_name, s.thumb_path, s.thumb_bytes, s.id
      from public.class_files s
     where s.class_name = k and s.week_start = kw
       and not exists (select 1 from public.class_files f where f.course_src = s.id and f.class_name = m.class_name and f.week_start = m.week_start);
  end loop;

  /* 복습테스트 — 첫 반(가장 이른 수업일)의 시험 목록을 다른 반에 맞춘다. 마감은 반마다 그 반 수업일 */
  if lead is not null then
    perform public._review_ensure_all(lead, lead_week);
    for m in select * from public._course_member_dates(p_course, p_no) where class_name <> lead loop
      perform public._review_ensure_all(m.class_name, m.week_start);
      for t in select * from public.review_tests where class_name = lead and week_start = lead_week loop
        insert into public.review_tests (class_name, week_start, lesson_date, q_count, test_name, sort_no, extra, off)
        values (m.class_name, m.week_start, m.lesson_date, t.q_count, t.test_name, t.sort_no, true, t.off)
        on conflict (class_name, week_start, test_name) do nothing;
        update public.review_tests x set off = t.off, updated_at = now()
         where x.class_name = m.class_name and x.week_start = m.week_start and x.test_name = t.test_name and x.off <> t.off
           and not exists (select 1 from public.review_submissions s where s.test_id = x.id);
      end loop;
      /* 첫 반에 없는 시험은 끈다 (아무도 안 냈을 때만) */
      update public.review_tests x set off = true, updated_at = now()
       where x.class_name = m.class_name and x.week_start = m.week_start and not x.off
         and not exists (select 1 from public.review_tests y where y.class_name = lead and y.week_start = lead_week and y.test_name = x.test_name)
         and not exists (select 1 from public.review_submissions s where s.test_id = x.id);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'classes', n, 'key', k, 'week', kw);
end;
$$;


-- ------------------------------------------------------------
--  6. 권한
-- ------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.course_save(uuid, text, date, integer, boolean)', 'public.course_member_set(uuid, text, boolean)',
    'public.class_assistant_set(text, text)', 'public.course_sync(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._course_member_dates(uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.common_patch(date, text, jsonb, jsonb, boolean) from public, anon;
  grant execute on function public.common_patch(date, text, jsonb, jsonb, boolean) to authenticated;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach f in array array['courses', 'course_members'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = f) then
        execute format('alter publication supabase_realtime add table public.%I', f);
      end if;
    end loop;
  end if;
end;
$$;


-- ============================================================
--  확인 — 다섯 줄 모두 true
-- ============================================================
select 'courses' as what, (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'courses')::text as ok
union all select 'course_members', (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'course_members')::text
union all select 'week_common extra/local', (exists (select 1 from information_schema.columns where table_name = 'week_common' and column_name = 'local'))::text
union all select 'class_files course_src', (exists (select 1 from information_schema.columns where table_name = 'class_files' and column_name = 'course_src'))::text
union all select 'anon blocked', (not has_function_privilege('anon', 'public.course_sync(uuid, integer)', 'execute'))::text;
