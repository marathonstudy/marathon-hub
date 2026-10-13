-- ============================================================
--  마라톤국어 허브 — 학생 상담 카드 · 상담·관찰 기록 (migration-004-notes.sql)
--
--  실행 방법
--    schema.sql · 002 · 003 다음에
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 표는 고치지 않고 새 표만 더한다.
--
--  민감 정보다
--    · 세 표 모두 RLS — staff 에 등록된 사람만 읽고 쓴다.
--    · 학부모 개인 페이지 · 반 공용 페이지 · 레포트 · hub_get 같은 공개 함수는
--      이 표들을 절대 읽지 않는다. (이 파일에는 공개 함수가 없다)
--    · 기록과 성적 줄은 지우지 않는다. '삭제' 는 숨김(삭제됨 · 누가 · 언제)이고,
--      teacher 역할만 숨기고 되살릴 수 있다. 숨긴 줄은 teacher 만 볼 수 있다.
--      표에서 줄을 완전히 지우는 권한(DELETE)은 아무에게도 주지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  0. 누가 하고 있나
-- ------------------------------------------------------------
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'teacher'
  );
$$;

/* 화면에 남길 이름 — staff 에 적힌 이름, 없으면 이메일 앞부분 */
create or replace function public._staff_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(name), '') from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1)
  );
$$;

/* 생성기가 처음에 한 번 부른다 — 내 이름과 역할 (teacher 만 숨긴 기록 보기 · 되살리기) */
create or replace function public.my_staff()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('email', email, 'name', coalesce(nullif(btrim(name), ''), split_part(email, '@', 1)), 'role', role)
  from public.staff
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function public.is_teacher()  from public, anon;
revoke all on function public._staff_name() from public, anon;
revoke all on function public.my_staff()    from public, anon;
grant execute on function public.is_teacher()  to authenticated;
grant execute on function public._staff_name() to authenticated;
grant execute on function public.my_staff()    to authenticated;


-- ------------------------------------------------------------
--  1. 상담 카드 — 학생 1명당 1줄 (수강 시작일 · 특이사항)
--     이름 · 학교 · 학년은 students 표 그대로 쓴다.
-- ------------------------------------------------------------
create table if not exists public.student_cards (
  student_id  uuid primary key references public.students(id) on delete cascade,
  start_date  date,
  notes       text not null default '',
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public._card_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := public._staff_name();
  return new;
end;
$$;

drop trigger if exists student_cards_touch on public.student_cards;
create trigger student_cards_touch before insert or update on public.student_cards
  for each row execute function public._card_touch();


-- ------------------------------------------------------------
--  2. 성적 — 한 줄 = (학생, 내신/모의고사, 학년, 학기 또는 월)
--     과목마다 원점수 · 등급. 전부 비워 둘 수 있다.
--     원점수는 0 이상 숫자, 등급은 1~9.
-- ------------------------------------------------------------
create table if not exists public.student_grades (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete restrict,
  kind        text not null,                 -- school 내신 | mock 모의고사
  grade_level text not null,                 -- 고1 · 고2 · 고3 · 중3 · N수 …
  term        text not null,                 -- 내신: 1학기 · 2학기 … / 모의고사: 3 · 6 · 9 · 11 (월)
  kor_raw     numeric(5,1),
  kor_grade   smallint,
  eng_raw     numeric(5,1),
  eng_grade   smallint,
  math_raw    numeric(5,1),
  math_grade  smallint,
  inq_raw     numeric(5,1),
  inq_grade   smallint,
  updated_by  text not null default '',
  deleted_by  text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint student_grades_kind_check  check (kind in ('school', 'mock')),
  constraint student_grades_level_check check (length(btrim(grade_level)) > 0),
  constraint student_grades_term_check  check (length(btrim(term)) > 0),
  constraint student_grades_raw_check   check (
    coalesce(kor_raw, 0) between 0 and 200 and coalesce(eng_raw, 0) between 0 and 200 and
    coalesce(math_raw, 0) between 0 and 200 and coalesce(inq_raw, 0) between 0 and 200),
  constraint student_grades_grade_check check (
    coalesce(kor_grade, 1) between 1 and 9 and coalesce(eng_grade, 1) between 1 and 9 and
    coalesce(math_grade, 1) between 1 and 9 and coalesce(inq_grade, 1) between 1 and 9)
);
/* 숨기지 않은 줄 중에서 (학생, 종류, 학년, 학기/월) 은 하나 */
create unique index if not exists student_grades_key on public.student_grades (student_id, kind, grade_level, term)
  where deleted_at is null;
create index if not exists student_grades_student_idx on public.student_grades (student_id);


-- ------------------------------------------------------------
--  3. 상담·관찰 기록 — 날짜별로 쌓인다
-- ------------------------------------------------------------
create table if not exists public.student_notes (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete restrict,
  note_date     date not null default (now() at time zone 'Asia/Seoul')::date,
  author_email  text not null default '',
  author_name   text not null default '',
  categories    text[] not null default '{}',
  body          text not null default '',
  follow_up     boolean not null default false,   -- 다음 상담 때 확인
  followed_by   text,                             -- 확인 완료한 사람
  followed_at   timestamptz,
  edited_by     text,                             -- 수정됨 (마지막으로 고친 사람 · 시각)
  edited_at     timestamptz,
  deleted_by    text,                             -- 삭제됨 (숨김)
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint student_notes_body_check check (length(btrim(body)) > 0),
  constraint student_notes_cat_check  check (categories <@ array['상담', '집중', '정서·컨디션', '출결', '학습', '기타']::text[])
);
create index if not exists student_notes_student_idx on public.student_notes (student_id, note_date desc);
create index if not exists student_notes_follow_idx  on public.student_notes (student_id)
  where follow_up and followed_at is null and deleted_at is null;


-- ------------------------------------------------------------
--  4. 자동으로 남기는 것 (쓴 사람 · 수정됨 · 확인 완료 · 삭제됨)
--     화면이 보낸 값을 믿지 않고 서버가 채운다.
-- ------------------------------------------------------------
create or replace function public._note_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.author_name  := public._staff_name();
    new.edited_by := null; new.edited_at := null;
    new.deleted_by := null; new.deleted_at := null;
    if new.followed_at is not null then new.followed_by := public._staff_name(); new.followed_at := now(); end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  /* 쓴 사람 · 처음 쓴 시각은 바꿀 수 없다 */
  new.author_email := old.author_email;
  new.author_name  := old.author_name;
  new.created_at   := old.created_at;
  new.student_id   := old.student_id;

  /* 숨기기 · 되살리기 — teacher 만 */
  if new.deleted_at is distinct from old.deleted_at then
    if not public.is_teacher() then
      raise exception '기록 삭제와 되살리기는 선생님(teacher) 계정만 할 수 있습니다.';
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now(); new.deleted_by := public._staff_name();
    else
      new.deleted_by := null;
    end if;
  else
    new.deleted_by := old.deleted_by;
  end if;

  /* 확인 완료 */
  if new.followed_at is not null and old.followed_at is null then
    new.followed_at := now(); new.followed_by := public._staff_name();
  elsif new.followed_at is null then
    new.followed_by := null;
  else
    new.followed_at := old.followed_at; new.followed_by := old.followed_by;
  end if;

  /* 내용을 고쳤으면 '수정됨' */
  if new.body is distinct from old.body or new.categories is distinct from old.categories
     or new.note_date is distinct from old.note_date or new.follow_up is distinct from old.follow_up then
    new.edited_at := now(); new.edited_by := public._staff_name();
  else
    new.edited_at := old.edited_at; new.edited_by := old.edited_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists student_notes_stamp on public.student_notes;
create trigger student_notes_stamp before insert or update on public.student_notes
  for each row execute function public._note_stamp();

create or replace function public._grade_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.student_id := old.student_id;
    new.created_at := old.created_at;
    if new.deleted_at is distinct from old.deleted_at then
      if not public.is_teacher() then
        raise exception '성적 줄 삭제와 되살리기는 선생님(teacher) 계정만 할 수 있습니다.';
      end if;
      if new.deleted_at is not null then
        new.deleted_at := now(); new.deleted_by := public._staff_name();
      else
        new.deleted_by := null;
      end if;
    else
      new.deleted_by := old.deleted_by;
    end if;
  else
    new.deleted_at := null; new.deleted_by := null;
  end if;
  new.updated_at := now();
  new.updated_by := public._staff_name();
  return new;
end;
$$;

drop trigger if exists student_grades_stamp on public.student_grades;
create trigger student_grades_stamp before insert or update on public.student_grades
  for each row execute function public._grade_stamp();


-- ------------------------------------------------------------
--  5. 성적 칸 하나만 저장 (주간 입력 entry_patch 와 같은 방식)
--     p_set  {"kor_raw":92, "kor_grade":2}   (null = 칸 비우기)
--     p_base 내가 화면에 불러왔던 값 — 서버 값이 다르면 그 칸은 저장하지 않고 conflicts 로 돌려준다
-- ------------------------------------------------------------
create or replace function public.grade_patch(
  p_student uuid, p_kind text, p_level text, p_term text,
  p_set jsonb, p_base jsonb, p_force boolean default false)
returns jsonb
language plpgsql
as $$
declare
  r public.student_grades;
  cur jsonb;
  k text;
  v jsonb;
  conflicts text[] := '{}';
  cols text[] := array['kor_raw','kor_grade','eng_raw','eng_grade','math_raw','math_grade','inq_raw','inq_grade'];
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;

  insert into public.student_grades (student_id, kind, grade_level, term)
  values (p_student, p_kind, btrim(p_level), btrim(p_term))
  on conflict (student_id, kind, grade_level, term) where deleted_at is null do nothing;

  select * into r from public.student_grades
  where student_id = p_student and kind = p_kind and grade_level = btrim(p_level)
    and term = btrim(p_term) and deleted_at is null
  for update;
  cur := to_jsonb(r);

  if not coalesce(p_force, false) then
    for k, v in select * from jsonb_each(coalesce(p_base, '{}'::jsonb)) loop
      if p_set ? k and coalesce(cur -> k, 'null'::jsonb) is distinct from coalesce(v, 'null'::jsonb) then
        conflicts := conflicts || k;
      end if;
    end loop;
  end if;

  for k, v in select * from jsonb_each(coalesce(p_set, '{}'::jsonb)) loop
    if k = any(cols) and not (k = any(conflicts)) then
      cur := cur || jsonb_build_object(k, v);
    end if;
  end loop;

  update public.student_grades set
    kor_raw    = (cur ->> 'kor_raw')::numeric,
    kor_grade  = (cur ->> 'kor_grade')::smallint,
    eng_raw    = (cur ->> 'eng_raw')::numeric,
    eng_grade  = (cur ->> 'eng_grade')::smallint,
    math_raw   = (cur ->> 'math_raw')::numeric,
    math_grade = (cur ->> 'math_grade')::smallint,
    inq_raw    = (cur ->> 'inq_raw')::numeric,
    inq_grade  = (cur ->> 'inq_grade')::smallint
  where id = r.id
  returning to_jsonb(student_grades.*) into cur;

  return jsonb_build_object('ok', array_length(conflicts, 1) is null,
                            'conflicts', to_jsonb(conflicts), 'row', cur);
end;
$$;

revoke all on function public.grade_patch(uuid, text, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.grade_patch(uuid, text, text, text, jsonb, jsonb, boolean) to authenticated;


-- ------------------------------------------------------------
--  6. 기록이 있는 학생은 지우지 않는다 (퇴원 처리)
--     명단의 [삭제] 가 이 함수로 먼저 확인한다 (002 의 함수에 상담·성적 기록을 더한다).
-- ------------------------------------------------------------
create or replace function public.tb_locked_students()
returns setof uuid
language plpgsql
stable
as $$
begin
  return query select student_id from public.student_notes
               union select student_id from public.student_grades;
  if to_regclass('public.tb_issues') is not null then
    return query execute 'select student_id from public.tb_issues union select student_id from public.tb_bills';
  end if;
end;
$$;
revoke all on function public.tb_locked_students() from public, anon;
grant execute on function public.tb_locked_students() to authenticated;


-- ============================================================
--  RLS
--   읽기  : staff. 숨긴 줄(deleted_at)은 teacher 만.
--   쓰기  : staff (숨기기 · 되살리기는 트리거가 teacher 인지 본다)
--   지우기(DELETE): 정책을 주지 않는다 → 아무도 완전히 지울 수 없다
--   상담 카드(student_cards)는 학생을 지울 때 함께 지워진다(특이사항 · 수강 시작일만 들어 있다).
-- ============================================================
alter table public.student_cards  enable row level security;
alter table public.student_grades enable row level security;
alter table public.student_notes  enable row level security;

drop policy if exists student_cards_staff_all on public.student_cards;
create policy student_cards_staff_all on public.student_cards
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

do $$
declare
  t text;
begin
  foreach t in array array['student_grades', 'student_notes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff() and (deleted_at is null or public.is_teacher()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff() and (deleted_at is null or public.is_teacher())) with check (public.is_staff())', t || '_update', t);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  7. 실시간 반영
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['student_cards', 'student_grades', 'student_notes'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 표가 rls_enabled = true 여야 한다
-- ============================================================
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public' and tablename in ('student_cards', 'student_grades', 'student_notes')
order by tablename;
