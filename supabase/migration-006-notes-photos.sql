-- ============================================================
--  마라톤국어 러닝노트 — 필기 노트 사진 (migration-006-notes-photos.sql)
--
--  실행 방법
--    004 · 005 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 표는 고치지 않는다.
--
--  지키는 규칙
--    · 사진은 비공개 보관함(note-photos)에만. 공개 주소는 만들지 않는다.
--    · 학생·학부모는 표와 보관함을 직접 못 만진다. Edge Function(note-photo)이
--      개인 링크 코드를 확인하고 그 학생 폴더에만 올리고, 그 학생 사진만
--      10분짜리 서명 주소로 보여 준다. 그 함수만 아래 photo_* 함수를 부를 수 있다(service_role).
--    · 퇴원 학생은 올리기 · 보기 · 지우기 모두 막힌다.
--    · 학생 본인은 자기 사진을 언제든 지울 수 있다(파일까지 완전히).
--      staff 는 숨기기(지우지 않음), teacher 만 완전 삭제.
--    · 하루 장수 제한(10장)은 '올린 날'(한국 날짜) 기준. 수업 날짜는 지난 날짜로 골라도 된다.
-- ============================================================


-- ------------------------------------------------------------
--  1. 보관함 (Storage 버킷) — 비공개 · JPEG 만 · 장당 600KB 까지
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-photos', 'note-photos', false, 614400, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

/* staff 는 코치룸에서 볼 수 있고(서명 주소 만들기), teacher 만 파일을 지울 수 있다.
   올리기 정책은 없다 — 올리기는 Edge Function 만(service_role). */
drop policy if exists note_photos_staff_select on storage.objects;
drop policy if exists note_photos_teacher_delete on storage.objects;
create policy note_photos_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'note-photos' and public.is_staff());
create policy note_photos_teacher_delete on storage.objects for delete to authenticated
  using (bucket_id = 'note-photos' and public.is_teacher());


-- ------------------------------------------------------------
--  2. 사진 기록
-- ------------------------------------------------------------
create table if not exists public.note_photos (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete restrict,
  class_name   text not null default '',           -- 올린 때의 반
  lesson_date  date not null,                      -- 고른 수업 날짜 (지난 날짜 가능)
  uploaded_on  date not null default (now() at time zone 'Asia/Seoul')::date,   -- 올린 날 (하루 장수 제한 기준)
  path         text not null,
  bytes        integer not null default 0,
  width        integer,
  height       integer,
  hidden_at    timestamptz,                        -- 숨김 (staff)
  hidden_by    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint note_photos_bytes_check check (bytes between 1 and 614400)
);
create unique index if not exists note_photos_path_key on public.note_photos (path);
create index if not exists note_photos_student_idx on public.note_photos (student_id, lesson_date desc);
create index if not exists note_photos_date_idx    on public.note_photos (lesson_date);
create index if not exists note_photos_upload_idx  on public.note_photos (student_id, uploaded_on);

/* staff 가 고칠 수 있는 것은 숨김뿐. 숨긴 사람 · 시각은 서버가 채운다. */
create or replace function public._photo_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id; new.student_id := old.student_id; new.class_name := old.class_name;
  new.lesson_date := old.lesson_date; new.uploaded_on := old.uploaded_on; new.path := old.path;
  new.bytes := old.bytes; new.width := old.width; new.height := old.height; new.created_at := old.created_at;
  if new.hidden_at is not null and old.hidden_at is null then
    new.hidden_at := now(); new.hidden_by := public._staff_name();
  elsif new.hidden_at is null then
    new.hidden_by := null;
  else
    new.hidden_at := old.hidden_at; new.hidden_by := old.hidden_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists note_photos_stamp on public.note_photos;
create trigger note_photos_stamp before update on public.note_photos
  for each row execute function public._photo_stamp();

alter table public.note_photos enable row level security;
drop policy if exists note_photos_read on public.note_photos;
drop policy if exists note_photos_update on public.note_photos;
drop policy if exists note_photos_delete on public.note_photos;
create policy note_photos_read   on public.note_photos for select to authenticated using (public.is_staff());
create policy note_photos_update on public.note_photos for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy note_photos_delete on public.note_photos for delete to authenticated using (public.is_teacher());
/* insert 정책은 없다 — 사진 기록은 Edge Function 만 남긴다 */


-- ------------------------------------------------------------
--  3. Edge Function(note-photo) 전용 함수 — service_role 만 부를 수 있다
-- ------------------------------------------------------------

/* 개인 링크 코드 → 그 학생 (퇴원이면 closed) */
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
  where l.hub_code = p_code limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  return jsonb_build_object(
    'ok', true, 'student_id', s.id, 'class_name', s.class_name, 'limit', 10,
    'today_count', (select count(*) from public.note_photos where student_id = s.id and uploaded_on = today)
  );
end;
$$;

/* 올린 사진 기록 남기기 — 하루 10장(올린 날 기준)을 여기서 한 번 더 막는다 */
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

/* 그 학생의 숨기지 않은 사진 (기간은 비우면 전체) */
create or replace function public.photo_list(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g jsonb := public.photo_gate(p_code);
  sid uuid;
begin
  if not (g ->> 'ok')::boolean then return g; end if;
  sid := (g ->> 'student_id')::uuid;
  return jsonb_build_object(
    'ok', true,
    'total', (select count(*) from public.note_photos where student_id = sid and hidden_at is null),
    'days',  (select count(distinct lesson_date) from public.note_photos where student_id = sid and hidden_at is null),
    'today_count', g -> 'today_count',
    'limit', g -> 'limit',
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.path, 'lesson_date', p.lesson_date,
                                          'width', p.width, 'height', p.height)
                       order by p.lesson_date desc, p.created_at)
      from public.note_photos p
      where p.student_id = sid and p.hidden_at is null
        and (p_from is null or p.lesson_date >= p_from)
        and (p_to is null or p.lesson_date <= p_to)
    ), '[]'::jsonb)
  );
end;
$$;

/* 학생 본인 사진이면 경로를 돌려준다 (지우기 전에 확인) */
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
  if not (g ->> 'ok')::boolean then return null; end if;
  return (select path from public.note_photos where id = p_id and student_id = (g ->> 'student_id')::uuid);
end;
$$;

/* 학생 본인 사진 기록 지우기 (파일은 함수가 먼저 지운다) */
create or replace function public.photo_remove(p_code text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb := public.photo_gate(p_code);
begin
  if not (g ->> 'ok')::boolean then return false; end if;
  delete from public.note_photos where id = p_id and student_id = (g ->> 'student_id')::uuid;
  return found;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.photo_gate(text)',
    'public.photo_add(text, date, text, integer, integer, integer)',
    'public.photo_list(text, date, date)',
    'public.photo_owned(text, uuid)',
    'public.photo_remove(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  4. 코치룸 — 저장 공간 사용량 (프로젝트 전체 · 무료 1GB 기준)
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
    'bytes',       coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects), 0),
    'photo_bytes', coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'note-photos'), 0),
    'photos',      (select count(*) from public.note_photos),
    'limit',       1073741824
  );
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;


-- ------------------------------------------------------------
--  5. 사진이 있는 학생은 명단에서 지우지 않는다 (퇴원 처리)
-- ------------------------------------------------------------
create or replace function public.tb_locked_students()
returns setof uuid
language plpgsql
stable
as $$
begin
  return query select student_id from public.student_notes
               union select student_id from public.student_grades
               union select student_id from public.note_photos;
  if to_regclass('public.tb_issues') is not null then
    return query execute 'select student_id from public.tb_issues union select student_id from public.tb_bills';
  end if;
end;
$$;
revoke all on function public.tb_locked_students() from public, anon;
grant execute on function public.tb_locked_students() to authenticated;


-- ------------------------------------------------------------
--  6. 실시간 반영 — 학생이 올리면 코치룸 표가 바로 바뀐다
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_photos') then
    alter publication supabase_realtime add table public.note_photos;
  end if;
end;
$$;


-- ============================================================
--  확인 — note_photos 가 rls_enabled = true, 버킷이 public = false 여야 한다
-- ============================================================
select 'note_photos' as what, rowsecurity::text as ok from pg_tables where schemaname = 'public' and tablename = 'note_photos'
union all
select 'bucket public', public::text from storage.buckets where id = 'note-photos';
