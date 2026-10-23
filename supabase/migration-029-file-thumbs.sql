-- ============================================================
--  마라톤 코치룸 — 배부 자료 · 과제 파일 「첫 페이지 그림」 (migration-029-file-thumbs.sql)
--
--  실행 방법
--    028 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 올린 파일 · 기록은 바꾸지 않는다 (칸 두 개를 더하고 함수를 고친다).
--
--  1. class_files.thumb_path · thumb_bytes — 코치룸이 파일을 올릴 때 브라우저에서 만든 작은 그림(가로 400px 안팎 JPG)
--       PDF 는 첫 페이지, JPG · PNG 는 그 그림을 줄인 것. 같은 보관함(class-files) · 같은 폴더에
--       「원래이름.thumb.jpg」로 둔다 (다른 이름은 막는다). 이미 올린 파일은 코치룸 [미리보기 그림 만들기]로 한 번에.
--  2. class_file_thumbs(링크 코드, 파일 id 들) — Edge Function(class-file)의 action thumbs 만 부른다.
--       개인 링크 · 반 공용 링크가 그 반 파일일 때만 그림 위치를 돌려주고, 함수가 10분짜리 서명 주소로 바꾼다.
--  3. 보관함 지우기 권한 — 조교가 하루 안에 자기가 올린 파일을 지울 때 그 그림도 함께 지울 수 있게.
--  4. storage_usage — 미리보기 그림 개수 · 용량을 따로 (자료 파일 용량에서는 뺀다).
-- ============================================================


-- ------------------------------------------------------------
--  1. 칸
-- ------------------------------------------------------------
alter table public.class_files add column if not exists thumb_path text;
alter table public.class_files add column if not exists thumb_bytes integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'class_files_thumb_path_check') then
    alter table public.class_files add constraint class_files_thumb_path_check
      check (thumb_path is null or thumb_path = regexp_replace(path, '\.[A-Za-z0-9]+$', '') || '.thumb.jpg');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'class_files_thumb_bytes_check') then
    alter table public.class_files add constraint class_files_thumb_bytes_check check (thumb_bytes between 0 and 614400);
  end if;
end;
$$;


-- ------------------------------------------------------------
--  2. Edge Function(class-file) 전용 — 그 링크로 볼 수 있는 파일의 그림 위치 (service_role 만)
-- ------------------------------------------------------------
create or replace function public.class_file_thumbs(p_code text, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  i uuid;
  g jsonb;
  tp text;
  out jsonb := '[]'::jsonb;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{16,64}$' or p_ids is null then return '[]'::jsonb; end if;
  foreach i in array p_ids[1:60] loop
    g := public.class_file_gate(p_code, i);
    if coalesce((g ->> 'ok')::boolean, false) is not true then continue; end if;
    select thumb_path into tp from public.class_files where id = i;
    if tp is not null then out := out || jsonb_build_object('id', i, 'path', tp); end if;
  end loop;
  return out;
end;
$$;


-- ------------------------------------------------------------
--  3. 보관함 지우기 — 그림도 그 파일과 같은 권한으로
-- ------------------------------------------------------------
drop policy if exists class_files_obj_delete on storage.objects;
create policy class_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'class-files' and (public.is_teacher() or (public.is_staff() and exists (
    select 1 from public.class_files f
    where (f.path = storage.objects.name or f.thumb_path = storage.objects.name)
      and f.created_by = lower(coalesce(auth.jwt() ->> 'email', ''))
      and f.created_at > now() - interval '1 day'))));


-- ------------------------------------------------------------
--  4. 저장 공간 — 013 과 같고 미리보기 그림을 따로 센다
-- ------------------------------------------------------------
create or replace function public.storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  tb bigint := coalesce((select sum(thumb_bytes) from public.class_files where thumb_path is not null), 0);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'bytes',        coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects), 0),
    'photo_bytes',  coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'note-photos'), 0),
    'photos',       (select count(*) from public.note_photos),
    'file_bytes',   greatest(0, coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'class-files'), 0) - tb),
    'files',        (select count(*) from public.class_files),
    'thumb_bytes',  tb,
    'thumbs',       (select count(*) from public.class_files where thumb_path is not null),
    'review_bytes', coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'review-photos'), 0),
    'reviews',      (select count(*) from public.review_submissions where photo_path is not null),
    'limit',        1073741824
  );
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
begin
  execute 'revoke all on function public.class_file_thumbs(text, uuid[]) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.class_file_thumbs(text, uuid[]) to service_role';
  end if;
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'thumb_path' as what, exists (select 1 from information_schema.columns where table_name = 'class_files' and column_name = 'thumb_path')::text as ok
union all select 'class_file_thumbs (anon blocked)', (not has_function_privilege('anon', 'public.class_file_thumbs(text, uuid[])', 'execute'))::text
union all select 'storage_usage thumbs', (pg_get_functiondef('public.storage_usage()'::regprocedure) like '%thumb_bytes%')::text;
