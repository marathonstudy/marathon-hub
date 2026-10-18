-- ============================================================
--  마라톤 코치룸 — 개인 링크를 학생용 · 학부모용으로 나누기 (migration-015-student-link.sql)
--
--  실행 방법
--    001 ~ 014 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 있는 기록은 바꾸지 않는다 (칸 · 함수만 더한다).
--
--  · 지금까지 보낸 개인 링크(hub_code)는 그대로 「학부모 링크」 — 이미 보낸 링크가 계속 열린다.
--  · 학생마다 「학생 링크」(student_code)를 새로 만든다 — 코치룸이 처음 복사할 때 만든다 (보안 난수 24자).
--  · 보기(레포트 · 교재비 · 반 공지 · 영상 · 자료 · 확인된 복습테스트 점수 · 필기 사진 보기)는 두 링크 모두.
--  · 입력(복습테스트 제출 · 「확인 전」 내 기록 · 필기 사진 올리기 · 지우기)은 학생 링크만.
--    전환 기간: app_settings 'links' 의 parentWrite 가 true 인 동안은 학부모 링크로도 입력이 된다 (처음엔 켜져 있다).
--    선생님(teacher)만 바꿀 수 있다. 학생 링크를 다 보낸 뒤 「오늘」 → 설정에서 끈다.
--  · 코치룸 미리보기(학부모 화면 · 학생 화면)는 로그인한 직원만 — 학생 id 로 보고, 아무것도 바꾸지 않고, 기록도 남기지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  1. 학생 링크 코드
-- ------------------------------------------------------------
alter table public.student_links add column if not exists student_code       text;
alter table public.student_links add column if not exists student_issued_at  timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_links_student_format') then
    alter table public.student_links add constraint student_links_student_format
      check (student_code is null or student_code ~ '^[A-Za-z0-9]{20,64}$');
  end if;
end;
$$;
create unique index if not exists student_links_student_key on public.student_links (student_code);

/* 학생 링크 코드와 학부모 링크 코드가 어디서도 겹치지 않게 */
create or replace function public._link_codes_distinct()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.student_code is not null and (new.student_code = new.hub_code
     or exists (select 1 from public.student_links where hub_code = new.student_code and student_id <> new.student_id)) then
    raise exception '학생 링크 코드가 다른 링크와 겹칩니다. 다시 발급해 주세요.';
  end if;
  if new.hub_code is not null and exists (select 1 from public.student_links where student_code = new.hub_code and student_id <> new.student_id) then
    raise exception '학부모 링크 코드가 다른 링크와 겹칩니다. 다시 발급해 주세요.';
  end if;
  return new;
end;
$$;
drop trigger if exists student_links_codes_distinct on public.student_links;
create trigger student_links_codes_distinct before insert or update of hub_code, student_code on public.student_links
  for each row execute function public._link_codes_distinct();


-- ------------------------------------------------------------
--  2. 전환 기간 스위치 — 선생님만 바꾼다 (처음엔 켜짐)
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values ('links', '{"parentWrite": true}'::jsonb)
on conflict (key) do nothing;

create or replace function public._links_setting_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.key = 'links') or (tg_op <> 'DELETE' and new.key = 'links') then
    if auth.jwt() is not null and coalesce(auth.jwt() ->> 'email', '') <> '' and not public.is_teacher() then
      raise exception '링크 전환 설정은 선생님(teacher) 계정만 바꿀 수 있습니다.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists app_settings_links_guard on public.app_settings;
create trigger app_settings_links_guard before insert or update or delete on public.app_settings
  for each row execute function public._links_setting_guard();

create or replace function public._parent_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value ->> 'parentWrite')::boolean from public.app_settings where key = 'links'), true);
$$;


-- ------------------------------------------------------------
--  3. 링크 코드 → 학생 · 어느 링크인지
--     _hub_student 는 두 코드 모두 받는다 (보기 함수들이 그대로 학생 링크도 연다). 돌려주는 모양은 schema.sql 과 같다.
-- ------------------------------------------------------------
create or replace function public._hub_student(p_code text)
returns table (id uuid, name text, school text, grade text, class_name text,
               archived boolean, app_share_code text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.school, s.grade, s.class_name, s.archived, l.app_share_code
  from public.student_links l
  join public.students s on s.id = l.student_id
  where p_code ~ '^[A-Za-z0-9]{20,64}$'
    and (l.hub_code = p_code or l.student_code = p_code)
  limit 1;
$$;

/* 'student' · 'parent' · null */
create or replace function public._hub_role(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_code !~ '^[A-Za-z0-9]{20,64}$' then null
              when exists (select 1 from public.student_links where student_code = p_code) then 'student'
              when exists (select 1 from public.student_links where hub_code = p_code) then 'parent'
              else null end;
$$;

/* 입력해도 되는 링크인가 — 학생 링크, 또는 전환 기간의 학부모 링크 */
create or replace function public._hub_can_write(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._hub_role(p_code) = 'student' or (public._hub_role(p_code) = 'parent' and public._parent_write()), false);
$$;


-- ------------------------------------------------------------
--  4. 러닝노트 내용 — 링크(hub_get)와 코치룸 미리보기(staff_hub_get)가 같은 것을 쓴다
--     migration-013 의 hub_get 내용과 같고, role · can_write 만 더했다
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
  return public._hub_payload(s.id, public._hub_role(p_code), public._hub_can_write(p_code));
end;
$$;

revoke all on function public.hub_get(text) from public;
grant execute on function public.hub_get(text) to anon, authenticated;


-- ------------------------------------------------------------
--  5. 필기 사진 — 보기는 두 링크, 올리기 · 지우기는 학생 링크(또는 전환 기간)만
--     migration-006 의 photo_gate · photo_add · photo_owned · photo_remove 에 그 확인만 더했다
-- ------------------------------------------------------------
create or replace function public.photo_gate(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{20,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  select st.id, st.class_name, st.archived into s
  from public.student_links l join public.students st on st.id = l.student_id
  where l.hub_code = p_code or l.student_code = p_code limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  return jsonb_build_object(
    'ok', true, 'student_id', s.id, 'class_name', s.class_name, 'limit', 10,
    'role', public._hub_role(p_code), 'can_write', public._hub_can_write(p_code),
    'today_count', (select count(*) from public.note_photos where student_id = s.id and uploaded_on = today)
  );
end;
$$;

create or replace function public.photo_add(
  p_code text, p_lesson_date date, p_path text, p_bytes integer, p_width integer, p_height integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb := public.photo_gate(p_code);
  sid uuid;
  today date := (now() at time zone 'Asia/Seoul')::date;
  n integer;
  row public.note_photos;
begin
  if not (g ->> 'ok')::boolean then return g; end if;
  if not (g ->> 'can_write')::boolean then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
  sid := (g ->> 'student_id')::uuid;
  if p_lesson_date is null or p_lesson_date > today or p_lesson_date < today - 400 then
    return jsonb_build_object('ok', false, 'reason', 'date');
  end if;
  if p_path is null or position(sid::text || '/' in p_path) <> 1 or p_path !~ '\.jpg$' then
    return jsonb_build_object('ok', false, 'reason', 'path');
  end if;
  perform pg_advisory_xact_lock(hashtext('note_photos:' || sid::text));
  select count(*) into n from public.note_photos where student_id = sid and uploaded_on = today;
  if n >= 10 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  insert into public.note_photos (student_id, class_name, lesson_date, uploaded_on, path, bytes, width, height)
  values (sid, coalesce(g ->> 'class_name', ''), p_lesson_date, today, p_path, p_bytes, p_width, p_height)
  returning * into row;
  return jsonb_build_object('ok', true, 'id', row.id, 'today_count', n + 1);
end;
$$;

create or replace function public.photo_owned(p_code text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g jsonb := public.photo_gate(p_code);
begin
  if not (g ->> 'ok')::boolean or not (g ->> 'can_write')::boolean then return null; end if;
  return (select path from public.note_photos where id = p_id and student_id = (g ->> 'student_id')::uuid);
end;
$$;

create or replace function public.photo_remove(p_code text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb := public.photo_gate(p_code);
begin
  if not (g ->> 'ok')::boolean or not (g ->> 'can_write')::boolean then return false; end if;
  delete from public.note_photos where id = p_id and student_id = (g ->> 'student_id')::uuid;
  return found;
end;
$$;


-- ------------------------------------------------------------
--  6. 복습테스트 — 제출 · 「확인 전」 기록은 학생 링크(또는 전환 기간)만
--     migration-013 의 review_status · review_submit 에 그 확인만 더했다
-- ------------------------------------------------------------
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
  if not public._hub_can_write(p_code) then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
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
  if not public._hub_can_write(p_code) then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
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
--  7. 코치룸 미리보기 — 로그인한 직원만 · 학생 id 로 · 아무것도 바꾸지 않는다
--     p_role = 'parent' | 'student'. 학생 화면은 입력 칸까지 보이게(can_write = true), 학부모 화면은 지금 링크 규칙대로.
-- ------------------------------------------------------------
create or replace function public.staff_hub_get(p_student uuid, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._hub_payload(p_student, case when p_role = 'student' then 'student' else 'parent' end,
                             case when p_role = 'student' then true else public._parent_write() end);
end;
$$;

create or replace function public.staff_hub_report(p_student uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return (select p.report_data || jsonb_build_object('publishedAt', p.published_at)
          from public.published p where p.student_id = p_student and p.week_start = p_week and p.visible);
end;
$$;

/* 교재비 — 공개 함수(hub_textbook)와 같은 내용. 그 학생 학부모 링크 코드로 서버 안에서만 부른다 (화면에 코드가 안 나간다) */
create or replace function public.staff_hub_textbook(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  select hub_code into c from public.student_links where student_id = p_student;
  if c is null then return jsonb_build_object('ok', false, 'reason', 'nolink'); end if;
  return public.hub_textbook(c);
end;
$$;

/* 학생 화면 복습테스트 — review_status 와 같은 모양 (사진 경로는 직원이 서명 주소로 바꿔 본다) */
create or replace function public.staff_review_status(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.students;
  today date := (now() at time zone 'Asia/Seoul')::date;
  t public.review_tests;
  sub public.review_submissions;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  select * into s from public.students where id = p_student;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  t := public._review_on(s.class_name, today);
  if t.id is not null then
    select * into sub from public.review_submissions where test_id = t.id and student_id = s.id;
  end if;
  return jsonb_build_object(
    'ok', true, 'today', today,
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


-- ------------------------------------------------------------
--  8. 권한
-- ------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public._hub_role(text)', 'public._hub_can_write(text)', 'public._parent_write()', 'public._hub_payload(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.staff_hub_get(uuid, text)', 'public.staff_hub_report(uuid, date)',
                           'public.staff_hub_textbook(uuid)', 'public.staff_review_status(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 학생 링크 칸 · 전환 기간 스위치 (처음엔 true)
-- ============================================================
select 'student_code column' as what, exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'student_links' and column_name = 'student_code')::text as ok
union all
select 'parentWrite (전환 기간)', public._parent_write()::text;
