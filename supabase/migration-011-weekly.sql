-- ============================================================
--  마라톤 코치룸 — 수업일 · 수업 영상 · 배부 자료/과제 파일 (migration-011-weekly.sql)
--
--  실행 방법
--    001 ~ 010 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 저장된 레포트 · 학생 기록은 바꾸지 않는다 (칸 · 표 · 함수만 더한다).
--
--  무엇이 생기나
--    · classes 에 수업 요일(기준 + 추가) · 첫 수업일          → 반마다 한 번 정한다 (class_schedule_set)
--    · class_weeks   그 주 그 반만 수업일 바꾸기 / 휴강        (다음 주부터는 원래 요일)
--    · lesson_videos 1차시 · 2차시 · 보강 영상 (유튜브 링크만. 보강은 반 전체 또는 고른 학생만)
--    · class_files   배부 자료 · 필수 과제 · 선택 과제 파일 (비공개 보관함 class-files)
--    · class_file_log 파일을 지운 기록 — 선생님만 읽고, 아무도 고치거나 지울 수 없다
--  지키는 것
--    · 새 표는 모두 RLS. 직원(staff)만 읽고 쓴다. 학부모 화면은 표를 직접 못 읽는다.
--    · 학부모 화면에는 hub_get(개인 링크) · class_notice_get(반 공용 링크)이 영상 · 파일 '목록'만 준다.
--      파일 보관 위치(path)와 보강 대상 학생 목록은 내보내지 않는다.
--      학생별 보강 영상은 그 학생 개인 링크에만 나간다 (반 공용 링크에는 반 전체 영상만).
--    · 파일 내려받기는 Edge Function(class-file)이 링크 코드와 파일의 반을 확인한 뒤
--      2분짜리 서명 주소를 만들어 준다. 퇴원생 링크는 막힌다. 공개 주소는 만들지 않는다.
--    · 파일 지우기: 올린 사람은 하루 안에 자기 파일만, 선생님은 언제든. 지울 때마다 기록이 남는다.
--    · 반 이름을 바꾸면(반 관리) 수업일 · 영상 · 파일도 새 이름을 따라간다.
--      영상 · 파일이 있는 반은 완전 삭제가 막힌다 (보관만).
-- ============================================================


-- ------------------------------------------------------------
--  1. classes — 수업 요일 · 첫 수업일
--     요일 숫자: 0=일 1=월 2=화 3=수 4=목 5=금 6=토
--     lesson_dow = 기준 요일 (레포트에 적히는 수업일) · extra_dows = 추가 요일 (주 2회 반)
-- ------------------------------------------------------------
alter table public.classes add column if not exists lesson_dow   smallint;
alter table public.classes add column if not exists extra_dows   smallint[] not null default '{}';
alter table public.classes add column if not exists first_lesson date;
alter table public.classes add column if not exists sched_by     text;
alter table public.classes add column if not exists sched_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_lesson_dow_check') then
    alter table public.classes add constraint classes_lesson_dow_check check (lesson_dow between 0 and 6);
  end if;
end;
$$;

/* 수업 요일 정하기 — 직원 누구나 (② 작성 화면). classes 표에는 여전히 수정 정책이 없다 */
create or replace function public.class_schedule_set(p_name text, p_dow smallint, p_extra smallint[], p_first date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  ex smallint[];
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if nm = '' then raise exception '반을 골라 주세요.'; end if;
  if p_dow is not null and (p_dow < 0 or p_dow > 6) then raise exception '수업 요일을 다시 골라 주세요.'; end if;
  select coalesce(array_agg(distinct d order by d), '{}') into ex
  from unnest(coalesce(p_extra, '{}')) d
  where d between 0 and 6 and d is distinct from p_dow;
  if p_dow is null then ex := '{}'; end if;

  insert into public.classes (name) values (nm) on conflict (name) do nothing;
  update public.classes
     set lesson_dow = p_dow, extra_dows = ex, first_lesson = p_first,
         sched_by = public._staff_name(), sched_at = now()
   where name = nm;
  return jsonb_build_object('ok', true, 'name', nm, 'lesson_dow', p_dow, 'extra_dows', to_jsonb(ex), 'first_lesson', p_first);
end;
$$;


-- ------------------------------------------------------------
--  2. class_weeks — 그 주 그 반만 수업일 바꾸기 · 휴강
--     week_start = ② 작성의 주차 시작일 (레포트 · 반 공통과 같은 열쇠)
-- ------------------------------------------------------------
create table if not exists public.class_weeks (
  class_name   text not null,
  week_start   date not null,
  lesson_date  date,                               -- 바꾼 수업일 (휴강이면 비움)
  canceled     boolean not null default false,     -- 휴강
  note         text not null default '',           -- 예) 학교 시험으로 휴강 · 토요일 보강
  updated_by   text not null default '',
  updated_at   timestamptz not null default now(),

  primary key (class_name, week_start),
  constraint class_weeks_what check (canceled or lesson_date is not null),
  constraint class_weeks_note_len check (length(note) <= 100)
);


-- ------------------------------------------------------------
--  3. lesson_videos — 수업 영상 (유튜브 링크만)
-- ------------------------------------------------------------
create table if not exists public.lesson_videos (
  id           uuid primary key default gen_random_uuid(),
  class_name   text not null,
  week_start   date not null,
  part         text not null default '1',          -- '1' 1차시 · '2' 2차시 · 'makeup' 보강
  title        text not null default '',
  url          text not null,
  student_ids  uuid[] not null default '{}',       -- 비어 있으면 반 전체 · 있으면 그 학생들만 (보강)
  sort         integer not null default 0,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_by   text not null default '',
  updated_at   timestamptz not null default now(),

  constraint lesson_videos_part_check check (part in ('1', '2', 'makeup')),
  constraint lesson_videos_url_check check (url ~* '^https://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/[^\s<>"'']+$' and length(url) <= 300),
  constraint lesson_videos_title_len check (length(title) <= 100),
  constraint lesson_videos_who_check check (part = 'makeup' or cardinality(student_ids) = 0)
);
create index if not exists lesson_videos_week_idx on public.lesson_videos (class_name, week_start);


-- ------------------------------------------------------------
--  4. class_files — 배부 자료 · 필수 과제 · 선택 과제 파일
--     파일 자체는 비공개 보관함 class-files 의 path 에 있다 (주차/무작위이름.확장자)
-- ------------------------------------------------------------
create table if not exists public.class_files (
  id            uuid primary key default gen_random_uuid(),
  class_name    text not null,
  week_start    date not null,
  kind          text not null default 'material',  -- material 배부 자료 · required 필수 과제 · optional 선택 과제
  name          text not null,                      -- 보이는 이름 (파일명에서 확장자만 뺀 것. 고칠 수 있다)
  orig_name     text not null default '',
  ext           text not null,
  mime          text not null default '',
  bytes         integer not null,
  path          text not null,
  created_by    text not null default '',           -- 올린 사람 이메일 (하루 안 지우기 확인용)
  created_name  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint class_files_kind_check check (kind in ('material', 'required', 'optional')),
  constraint class_files_ext_check  check (ext in ('pdf', 'hwp', 'hwpx', 'doc', 'docx', 'ppt', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png')),
  constraint class_files_bytes_check check (bytes between 1 and 20971520),
  constraint class_files_name_check check (length(btrim(name)) between 1 and 120)
);
create unique index if not exists class_files_path_key on public.class_files (path);
create index if not exists class_files_week_idx on public.class_files (class_name, week_start);


-- ------------------------------------------------------------
--  5. class_file_log — 파일을 지운 기록 (트리거만 쓴다)
-- ------------------------------------------------------------
create table if not exists public.class_file_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  by_email    text not null default '',
  by_name     text not null default '',
  action      text not null default 'delete',
  class_name  text not null default '',
  week_start  date,
  kind        text not null default '',
  name        text not null default '',
  bytes       integer not null default 0,
  uploaded_by text not null default '',
  uploaded_at timestamptz
);
create index if not exists class_file_log_at_idx on public.class_file_log (at desc);


-- ------------------------------------------------------------
--  6. 누가 · 언제 — 서버가 채운다 (화면이 보낸 값은 무시)
-- ------------------------------------------------------------
create or replace function public._weekly_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'class_weeks' then
    new.class_name := btrim(new.class_name);
    new.note := btrim(coalesce(new.note, ''));
    if new.canceled then new.lesson_date := null; end if;
    new.updated_by := coalesce(public._staff_name(), '');
    new.updated_at := now();
    return new;
  end if;

  if tg_table_name = 'lesson_videos' then
    new.class_name := btrim(new.class_name);
    new.title := btrim(coalesce(new.title, ''));
    new.url := btrim(new.url);
    if new.part <> 'makeup' then new.student_ids := '{}'; end if;
    if tg_op = 'INSERT' then
      new.created_by := coalesce(public._staff_name(), '');
      new.created_at := now();
    else
      new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at;
      if coalesce(current_setting('app.class_rename', true), '') <> '1' then
        new.class_name := old.class_name; new.week_start := old.week_start;
      end if;
    end if;
    new.updated_by := coalesce(public._staff_name(), '');
    new.updated_at := now();
    return new;
  end if;

  /* class_files — 보이는 이름 · 분류만 고칠 수 있다 */
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.class_name := btrim(new.class_name);
    new.ext := lower(new.ext);
    new.created_by := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.created_name := coalesce(public._staff_name(), '');
    new.created_at := now();
  else
    new.id := old.id; new.week_start := old.week_start; new.orig_name := old.orig_name; new.ext := old.ext;
    new.mime := old.mime; new.bytes := old.bytes; new.path := old.path;
    new.created_by := old.created_by; new.created_name := old.created_name; new.created_at := old.created_at;
    if coalesce(current_setting('app.class_rename', true), '') <> '1' then new.class_name := old.class_name; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists class_weeks_stamp on public.class_weeks;
create trigger class_weeks_stamp before insert or update on public.class_weeks
  for each row execute function public._weekly_stamp();
drop trigger if exists lesson_videos_stamp on public.lesson_videos;
create trigger lesson_videos_stamp before insert or update on public.lesson_videos
  for each row execute function public._weekly_stamp();
drop trigger if exists class_files_stamp on public.class_files;
create trigger class_files_stamp before insert or update on public.class_files
  for each row execute function public._weekly_stamp();

/* 파일을 지우면 기록을 남긴다 */
create or replace function public._class_file_logdel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.class_file_log (by_email, by_name, action, class_name, week_start, kind, name, bytes, uploaded_by, uploaded_at)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), 'delete',
          old.class_name, old.week_start, old.kind, old.name, old.bytes, old.created_name, old.created_at);
  return old;
end;
$$;

drop trigger if exists class_files_logdel on public.class_files;
create trigger class_files_logdel after delete on public.class_files
  for each row execute function public._class_file_logdel();


-- ------------------------------------------------------------
--  7. RLS — 직원만
-- ------------------------------------------------------------
alter table public.class_weeks    enable row level security;
alter table public.lesson_videos  enable row level security;
alter table public.class_files    enable row level security;
alter table public.class_file_log enable row level security;

drop policy if exists class_weeks_staff_all on public.class_weeks;
create policy class_weeks_staff_all on public.class_weeks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists lesson_videos_staff_all on public.lesson_videos;
create policy lesson_videos_staff_all on public.lesson_videos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists class_files_staff_select on public.class_files;
drop policy if exists class_files_staff_insert on public.class_files;
drop policy if exists class_files_staff_update on public.class_files;
drop policy if exists class_files_delete on public.class_files;
create policy class_files_staff_select on public.class_files for select to authenticated using (public.is_staff());
create policy class_files_staff_insert on public.class_files for insert to authenticated with check (public.is_staff());
create policy class_files_staff_update on public.class_files for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
/* 지우기 — 선생님은 언제든, 직원은 하루 안에 자기가 올린 파일만 */
create policy class_files_delete on public.class_files for delete to authenticated using (
  public.is_teacher() or (public.is_staff()
    and created_by = lower(coalesce(auth.jwt() ->> 'email', ''))
    and created_at > now() - interval '1 day'));

drop policy if exists class_file_log_teacher_read on public.class_file_log;
create policy class_file_log_teacher_read on public.class_file_log for select to authenticated using (public.is_teacher());
/* class_file_log 에는 insert · update · delete 정책이 없다 — 트리거만 쓴다 */


-- ------------------------------------------------------------
--  8. 보관함 class-files — 비공개 · 파일 하나 20MB · 정한 형식만
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('class-files', 'class-files', false, 20971520, array[
  'application/pdf', 'application/x-hwp', 'application/vnd.hancom.hwpx',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists class_files_obj_select on storage.objects;
drop policy if exists class_files_obj_insert on storage.objects;
drop policy if exists class_files_obj_delete on storage.objects;
/* 코치룸에서 보기(서명 주소) · 올리기는 직원. 고치기(update) 정책은 없다 */
create policy class_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'class-files' and public.is_staff());
create policy class_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'class-files' and public.is_staff());
/* 지우기 — 선생님은 언제든, 직원은 하루 안에 자기가 올린 파일만 (기록 줄이 지워지기 전에 파일부터 지운다) */
create policy class_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'class-files' and (public.is_teacher() or (public.is_staff() and exists (
    select 1 from public.class_files f
    where f.path = storage.objects.name
      and f.created_by = lower(coalesce(auth.jwt() ->> 'email', ''))
      and f.created_at > now() - interval '1 day'))));


-- ------------------------------------------------------------
--  9. 반 관리(migration-010)와 연결 — 이름 바꾸기 · 옛 이름 따라가기 · 기록 세기
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
    'class_weeks', 'lesson_videos', 'class_files'
  ];
$$;

do $$
declare
  t text;
begin
  foreach t in array array['class_weeks', 'lesson_videos', 'class_files'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_class_follow', t);
    execute format('create trigger %I before insert or update of class_name on public.%I for each row execute function public._class_follow()',
                   t || '_class_follow', t);
  end loop;
end;
$$;

/* migration-010 의 기록 세기에 영상 · 파일을 더했다 (수업일 바꾸기는 설정이라 기록으로 세지 않는다) */
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

  r := r || jsonb_build_object('records',
    (r ->> 'left')::bigint + (r ->> 'reports')::bigint + (r ->> 'notices')::bigint + (r ->> 'info')::bigint +
    (r ->> 'textbook')::bigint + (r ->> 'photos')::bigint + (r ->> 'exam')::bigint +
    (r ->> 'videos')::bigint + (r ->> 'files')::bigint);
  return r;
end;
$$;

/* migration-010 의 완전 삭제에 '수업일 바꾸기' 정리만 더했다 */
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
  /* 비어 있는 반 현황 · 반 공통 입력 · 공지가 없는 공용 링크 · 수업일 바꾸기는 함께 지운다 */
  delete from public.class_info  where class_name = nm;
  delete from public.week_common where class_name = nm;
  delete from public.class_codes where class_name = nm;
  delete from public.class_weeks where class_name = nm;
  update public.app_settings set value = jsonb_set(value, '{byClass}', (value -> 'byClass') - nm), updated_at = now()
   where key = 'exams' and jsonb_typeof(value -> 'byClass') = 'object' and (value -> 'byClass') ? nm;
  delete from public.classes where name = nm;
  perform public._class_log('delete', nm, '', u);
  return jsonb_build_object('ok', true);
end;
$$;


-- ------------------------------------------------------------
--  10. 학부모 화면에 줄 것 — 수업 일정 · 주차별 영상 · 파일 목록
--      p_student 가 있으면(개인 링크) 그 학생 보강 영상도. 없으면(반 공용 링크) 반 전체 영상만.
--      파일 보관 위치 · 보강 대상 학생 목록 · 올린 사람은 내보내지 않는다.
-- ------------------------------------------------------------
create or replace function public._weekly_of(p_class text, p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select * from public.classes where name = btrim(coalesce(p_class, '')) limit 1
  ),
  wk as (
    select week_start from (
      select week_start from public.lesson_videos v
      where v.class_name = btrim(coalesce(p_class, ''))
        and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
      union
      select week_start from public.class_files f where f.class_name = btrim(coalesce(p_class, ''))
    ) u order by week_start desc limit 26
  )
  select jsonb_build_object(
    'schedule', (
      select jsonb_build_object(
        'dow', c.lesson_dow, 'extra', to_jsonb(c.extra_dows), 'first', c.first_lesson,
        'weeks', coalesce((
          select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'lesson_date', w.lesson_date,
                                              'canceled', w.canceled, 'note', w.note) order by w.week_start desc)
          from (select * from public.class_weeks x where x.class_name = c.name order by x.week_start desc limit 60) w
        ), '[]'::jsonb))
      from c where c.lesson_dow is not null
    ),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', wk.week_start,
        'videos', coalesce((
          select jsonb_agg(jsonb_build_object('part', v.part, 'title', v.title, 'url', v.url,
                                              'personal', cardinality(v.student_ids) > 0)
                           order by case v.part when '1' then 1 when '2' then 2 else 3 end, v.sort, v.created_at)
          from public.lesson_videos v
          where v.class_name = btrim(coalesce(p_class, '')) and v.week_start = wk.week_start
            and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
        ), '[]'::jsonb),
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'ext', f.ext, 'bytes', f.bytes)
                           order by f.kind, f.name)
          from public.class_files f
          where f.class_name = btrim(coalesce(p_class, '')) and f.week_start = wk.week_start
        ), '[]'::jsonb)
      ) order by wk.week_start desc)
      from wk
    ), '[]'::jsonb)
  );
$$;

revoke all on function public._weekly_of(text, uuid) from public, anon, authenticated;


/* 개인 페이지 /me/#코드 — migration-005 의 hub_get 에 'weekly' 와 레포트 목록의 'lesson_date' 만 더했다 */
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
    'weekly', public._weekly_of(s.class_name, s.id)
  );
end;
$$;

/* 반 공용 페이지 /notice/#반코드 — migration-005 에 'weekly'(반 전체 영상 · 파일 목록)만 더했다. 학생 정보는 하나도 없다 */
create or replace function public.class_notice_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{16,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  select class_name into c from public.class_codes where code = p_code;
  if c is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_name', c,
    'notices', public._notices_of(c),
    'exam', public._exam_for_class(c),
    'weekly', public._weekly_of(c, null)
  );
end;
$$;

revoke all on function public.hub_get(text)          from public;
revoke all on function public.class_notice_get(text) from public;
grant execute on function public.hub_get(text)          to anon, authenticated;
grant execute on function public.class_notice_get(text) to anon, authenticated;


-- ------------------------------------------------------------
--  11. Edge Function(class-file) 전용 — 링크 코드로 파일 하나 확인 (service_role 만)
--      개인 링크: 다니는 학생이고 그 학생 반의 파일일 때만
--      반 공용 링크: 그 반의 파일일 때만
-- ------------------------------------------------------------
create or replace function public.class_file_gate(p_code text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.class_files;
  s record;
  c text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{16,64}$' or p_id is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  select * into f from public.class_files where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nofile'); end if;

  select * into s from public._hub_student(p_code);
  if found then
    if s.archived then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
    if btrim(coalesce(s.class_name, '')) <> f.class_name then return jsonb_build_object('ok', false, 'reason', 'nofile'); end if;
  else
    select class_name into c from public.class_codes where code = p_code;
    if c is null then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
    if c <> f.class_name then return jsonb_build_object('ok', false, 'reason', 'nofile'); end if;
  end if;
  return jsonb_build_object('ok', true, 'path', f.path, 'name', f.name, 'ext', f.ext);
end;
$$;

do $$
begin
  execute 'revoke all on function public.class_file_gate(text, uuid) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.class_file_gate(text, uuid) to service_role';
  end if;
end;
$$;


-- ------------------------------------------------------------
--  12. 저장 공간 사용량 — migration-006 에 자료 파일 칸만 더했다 (무료 1GB 기준)
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
    'file_bytes',  coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id = 'class-files'), 0),
    'files',       (select count(*) from public.class_files),
    'limit',       1073741824
  );
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;


-- ------------------------------------------------------------
--  13. 권한 · 실시간 반영
-- ------------------------------------------------------------
revoke all on function public.class_schedule_set(text, smallint, smallint[], date) from public, anon;
grant execute on function public.class_schedule_set(text, smallint, smallint[], date) to authenticated;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['class_weeks', 'lesson_videos', 'class_files'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ============================================================
--  확인 — 새 표 4개가 rls_enabled = true, 보관함이 public = false 여야 한다
-- ============================================================
select tablename as what, rowsecurity::text as ok from pg_tables
where schemaname = 'public' and tablename in ('class_weeks', 'lesson_videos', 'class_files', 'class_file_log')
union all
select 'bucket class-files public', public::text from storage.buckets where id = 'class-files'
order by 1;
