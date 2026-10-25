-- ============================================================
--  마라톤 코치룸 — 복습 노트 (한 장 요약 + OX 퀴즈 · migration-039-review-note.sql)
--
--  실행 방법
--    038 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 지금 있는 표 · 요약은 바꾸지 않는다.
--
--  review_notes  반 + 수업 주마다 복습 노트 한 장 (수업 요약 lesson_summaries 와 같은 모양)
--    draft      AI 초안 · 고치는 중인 것 (학생 · 학부모에게 안 보인다)
--    confirmed  [확정]한 것 — 러닝노트(레포트 · 복습 노트 모음)는 이것만 본다
--    노트 모양 { lessons: [{ no, oneLine, passages[], actions[], applied[], mistakes[], remember[], unsure[] }],
--               quiz: [{ q, a: 'O'|'X', why }], quizOff, quizNone }
--    과정(고3) 회차는 「§과정 이름」 칸에 한 번 만들고, 확정하면 그 회차의 반마다 같은 노트를 넣는다 (from_course · 반에서 따로 확정한 것은 그대로)
--  review_note_opens  학생 링크로 노트를 연 학생 (학생 · 수업마다 한 줄) — 코치룸은 반 전체 숫자만 받는다 (누가 열었는지는 화면에 없다)
--    OX 점수 · 풀었는지는 서버에 남기지 않는다 (학생 기기에만 「지난번 4/5」)
--  AI 호출은 Edge Function lesson-summary 의 「복습 노트」 모드 — 수업 요약과 같은 월 상한(ai_usage)을 쓴다
-- ============================================================


-- ---------- 복습 노트 ----------
create table if not exists public.review_notes (
  class_name    text not null,
  week_start    date not null,
  lesson_date   date,
  status        text not null default 'draft',
  draft         jsonb not null default '{}'::jsonb,
  draft_note    text not null default '',
  draft_by      text not null default '',
  draft_at      timestamptz,
  model         text not null default '',
  confirmed     jsonb,
  confirmed_by  text not null default '',
  confirmed_at  timestamptz,
  from_course   boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (class_name, week_start),
  constraint review_notes_status check (status in ('draft', 'confirmed'))
);

alter table public.review_notes enable row level security;
drop policy if exists review_notes_staff_read on public.review_notes;
create policy review_notes_staff_read on public.review_notes for select to authenticated using (public.is_staff());
revoke all on public.review_notes from anon;
revoke insert, update, delete on public.review_notes from authenticated;      -- 아래 함수만 쓴다
grant select on public.review_notes to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'review_notes') then
    alter publication supabase_realtime add table public.review_notes;
  end if;
end;
$$;

/* 노트 모양 확인 — 차시 1 ~ 6개 · OX 0 ~ 8개 · 글자 수 상한 (전체 60KB) */
create or replace function public._review_note_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'lessons') = 'array'
     and jsonb_array_length(p -> 'lessons') between 1 and 6
     and (p -> 'quiz' is null or (jsonb_typeof(p -> 'quiz') = 'array' and jsonb_array_length(p -> 'quiz') <= 8))
     and octet_length(p::text) <= 60000;
$$;


-- ---------- 초안 저장 — Edge Function(AI 초안) · 코치룸(고친 초안) ----------
create or replace function public.review_note_draft(p_class text, p_week date, p_draft jsonb, p_note text default '', p_model text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.review_notes;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if btrim(coalesce(p_class, '')) = '' or p_week is null then raise exception '반과 주차를 골라 주세요.'; end if;
  if not public._review_note_ok(p_draft) then raise exception '복습 노트 모양이 올바르지 않습니다.'; end if;
  insert into public.review_notes (class_name, week_start, status, draft, draft_note, draft_by, draft_at, model, updated_at)
  values (btrim(p_class), p_week, 'draft', p_draft, left(coalesce(p_note, ''), 500), coalesce(public._staff_name(), ''), now(), coalesce(p_model, ''), now())
  on conflict (class_name, week_start) do update
     set status = 'draft', draft = excluded.draft, draft_note = case when coalesce(p_model, '') <> '' then excluded.draft_note else public.review_notes.draft_note end,
         draft_by = excluded.draft_by, draft_at = excluded.draft_at,
         model = case when coalesce(p_model, '') <> '' then excluded.model else public.review_notes.model end,
         from_course = false, updated_at = now()
  returning * into r;
  return jsonb_build_object('ok', true, 'note', to_jsonb(r));
end;
$$;

/* AI 호출 끝 — 월 상한 기록만 (summary_begin 으로 시작한 ai_usage 한 줄) · 초안은 review_note_draft 로 */
create or replace function public.review_note_usage(p_usage bigint, p_ok boolean, p_model text, p_in integer, p_out integer, p_cost numeric, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.ai_usage;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into u from public.ai_usage where id = p_usage for update;
  if not found or u.status <> 'started' or u.by_email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception '요약 기록을 찾을 수 없습니다.';
  end if;
  update public.ai_usage set status = case when coalesce(p_ok, false) then 'ok' else 'failed' end,
         error = left(coalesce(p_error, ''), 300), model = coalesce(p_model, ''),
         input_tokens = greatest(0, coalesce(p_in, 0)), output_tokens = greatest(0, coalesce(p_out, 0)),
         cost_usd = greatest(0, coalesce(p_cost, 0)), finished_at = now()
   where id = p_usage;
  return jsonb_build_object('ok', true);
end;
$$;


-- ---------- [확정] — 직원 누구나 · 과정이면 그 회차의 반마다 ----------
create or replace function public.review_note_confirm(p_class text, p_week date, p_note jsonb, p_lesson date default null, p_course uuid default null, p_no integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.review_notes;
  who text := coalesce(public._staff_name(), '');
  m record;
  n integer := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if btrim(coalesce(p_class, '')) = '' or p_week is null then raise exception '반과 주차를 골라 주세요.'; end if;
  if not public._review_note_ok(p_note) then raise exception '복습 노트 모양이 올바르지 않습니다.'; end if;
  insert into public.review_notes (class_name, week_start, lesson_date, status, draft, confirmed, confirmed_by, confirmed_at, updated_at)
  values (btrim(p_class), p_week, p_lesson, 'confirmed', p_note, p_note, who, now(), now())
  on conflict (class_name, week_start) do update
     set status = 'confirmed', draft = excluded.draft, confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by,
         confirmed_at = excluded.confirmed_at, lesson_date = coalesce(excluded.lesson_date, public.review_notes.lesson_date),
         from_course = false, updated_at = now()
  returning * into r;

  /* 과정 회차 — 그 회차에 든 반마다 같은 노트 (반에서 따로 고쳐 확정한 것은 그대로) */
  if p_course is not null and p_no is not null and left(btrim(p_class), 1) = '§' then
    for m in select * from public._course_member_dates(p_course, p_no) loop
      n := n + 1;
      insert into public.review_notes (class_name, week_start, lesson_date, status, draft, confirmed, confirmed_by, confirmed_at, from_course, updated_at)
      values (m.class_name, m.week_start, m.lesson_date, 'confirmed', p_note, p_note, who, now(), true, now())
      on conflict (class_name, week_start) do update
         set status = 'confirmed', draft = excluded.draft, confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by,
             confirmed_at = excluded.confirmed_at, lesson_date = excluded.lesson_date, updated_at = now()
       where public.review_notes.from_course;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'note', to_jsonb(r), 'classes', n);
end;
$$;

/* 확정 취소 — 학생 · 학부모 화면에서 내린다 (과정이면 그 과정에서 복사된 반 노트도) · 초안 지우기 */
create or replace function public.review_note_unconfirm(p_class text, p_week date, p_course uuid default null, p_no integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.review_notes;
  m record;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.review_notes set status = 'draft', draft = coalesce(confirmed, draft), confirmed = null, confirmed_by = '', confirmed_at = null, updated_at = now()
   where class_name = btrim(p_class) and week_start = p_week
  returning * into r;
  if p_course is not null and p_no is not null and left(btrim(p_class), 1) = '§' then
    for m in select * from public._course_member_dates(p_course, p_no) loop
      delete from public.review_notes where class_name = m.class_name and week_start = m.week_start and from_course;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'note', to_jsonb(r));
end;
$$;

create or replace function public.review_note_discard(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.review_notes;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into r from public.review_notes where class_name = btrim(p_class) and week_start = p_week for update;
  if not found then return jsonb_build_object('ok', true, 'note', null); end if;
  if r.confirmed is null then
    delete from public.review_notes where class_name = r.class_name and week_start = r.week_start;
    return jsonb_build_object('ok', true, 'note', null);
  end if;
  update public.review_notes set status = 'confirmed', draft = confirmed, draft_note = '', updated_at = now()
   where class_name = r.class_name and week_start = r.week_start returning * into r;
  return jsonb_build_object('ok', true, 'note', to_jsonb(r));
end;
$$;


-- ---------- 러닝노트 — 확정된 복습 노트 (그 학생 반 · 수업일 순) ----------
create or replace function public._review_notes_of(p_class text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('week_start', week_start, 'lesson_date', lesson_date, 'note', confirmed, 'confirmed_at', confirmed_at)
                            order by coalesce(lesson_date, week_start), week_start), '[]'::jsonb)
  from public.review_notes
  where class_name = p_class and status = 'confirmed' and confirmed is not null;
$$;

create or replace function public.hub_review_notes(p_code text)
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
  if not found or s.archived or coalesce(s.class_name, '') = '' then return '[]'::jsonb; end if;
  return public._review_notes_of(s.class_name);
end;
$$;

create or replace function public.staff_hub_review_notes(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select class_name into c from public.students where id = p_student;
  return public._review_notes_of(coalesce(c, ''));
end;
$$;


-- ---------- 연 학생 — 학생 링크로 열었을 때만 (학부모 링크 · 미리보기는 세지 않는다) ----------
create table if not exists public.review_note_opens (
  student_id  uuid not null references public.students(id) on delete cascade,
  class_name  text not null,
  week_start  date not null,
  first_at    timestamptz not null default now(),
  primary key (student_id, class_name, week_start)
);
alter table public.review_note_opens enable row level security;
revoke all on public.review_note_opens from anon, authenticated;              -- 아무도 직접 읽지 못한다 (숫자만 함수로)

create or replace function public.hub_review_note_open(p_code text, p_week date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s record;
begin
  if public._hub_role(p_code) is distinct from 'student' then return jsonb_build_object('ok', false); end if;
  select * into s from public._hub_student(p_code);
  if not found or s.archived or p_week is null then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from public.review_notes where class_name = s.class_name and week_start = p_week and status = 'confirmed') then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.review_note_opens (student_id, class_name, week_start) values (s.id, s.class_name, p_week)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

/* 코치룸 「오늘」 반 카드 — 최근 확정 노트마다 연 학생 수 (반 전체 숫자만) */
create or replace function public.staff_review_note_opens(p_since date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('class_name', n.class_name, 'week_start', n.week_start, 'lesson_date', n.lesson_date,
           'opened', (select count(*) from public.review_note_opens o where o.class_name = n.class_name and o.week_start = n.week_start)))
    from public.review_notes n
    where n.status = 'confirmed' and left(n.class_name, 1) <> '§' and n.week_start >= coalesce(p_since, current_date - 35)
  ), '[]'::jsonb);
end;
$$;


-- ---------- 권한 ----------
revoke all on function public._review_note_ok(jsonb) from public;
revoke all on function public._review_notes_of(text) from public, anon, authenticated;
revoke all on function public.review_note_draft(text, date, jsonb, text, text) from public, anon;
revoke all on function public.review_note_usage(bigint, boolean, text, integer, integer, numeric, text) from public, anon;
revoke all on function public.review_note_confirm(text, date, jsonb, date, uuid, integer) from public, anon;
revoke all on function public.review_note_unconfirm(text, date, uuid, integer) from public, anon;
revoke all on function public.review_note_discard(text, date) from public, anon;
revoke all on function public.hub_review_notes(text) from public;
revoke all on function public.hub_review_note_open(text, date) from public;
revoke all on function public.staff_hub_review_notes(uuid) from public, anon;
revoke all on function public.staff_review_note_opens(date) from public, anon;
grant execute on function public._review_note_ok(jsonb) to authenticated;
grant execute on function public.review_note_draft(text, date, jsonb, text, text) to authenticated;
grant execute on function public.review_note_usage(bigint, boolean, text, integer, integer, numeric, text) to authenticated;
grant execute on function public.review_note_confirm(text, date, jsonb, date, uuid, integer) to authenticated;
grant execute on function public.review_note_unconfirm(text, date, uuid, integer) to authenticated;
grant execute on function public.review_note_discard(text, date) to authenticated;
grant execute on function public.hub_review_notes(text) to anon, authenticated;
grant execute on function public.hub_review_note_open(text, date) to anon, authenticated;
grant execute on function public.staff_hub_review_notes(uuid) to authenticated;
grant execute on function public.staff_review_note_opens(date) to authenticated;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'review_notes' as what, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'review_notes')::text as ok
union all select 'rls', (select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('review_notes', 'review_note_opens'))::text
union all select 'anon blocked', (not has_table_privilege('anon', 'public.review_notes', 'select') and not has_table_privilege('anon', 'public.review_note_opens', 'select'))::text
union all select 'opens hidden', (not has_table_privilege('authenticated', 'public.review_note_opens', 'select'))::text;
