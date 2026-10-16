-- ============================================================
--  마라톤 코치룸 — 반 관리 (migration-010-class-admin.sql)
--
--  실행 방법
--    001 ~ 009 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 있던 반 이름 · 학생 기록은 바꾸지 않는다 (칸 · 표 · 함수만 더한다).
--
--  ① 명단 → [반 관리] (선생님만) 에서 쓰는 서버 함수
--    class_admin_get()                 반 목록 · 반마다 학생/기록 수 · 최근 변경 기록
--    class_rename(옛 이름, 새 이름)      그 반의 모든 기록이 새 이름을 따라간다 (한 번에 · 실패하면 전부 취소)
--    class_archive(이름, 보관?, 확인?)   보관 = 모든 반 목록에서 숨김 (기록은 그대로) / 되살리기
--    class_delete(이름)                 학생 · 기록이 하나도 없는 반만 완전 삭제
--  지키는 것
--    · 네 함수 모두 선생님(teacher)인지 서버에서 다시 확인한다. 조교는 함수를 직접 불러도 거절된다.
--    · classes 표에는 여전히 수정 · 삭제 정책이 없다 (이 함수들만 바꾼다).
--    · class_log — 누가 · 언제 · 무엇을 바꿨는지. 선생님만 읽고, 아무도 고치거나 지울 수 없다.
--    · 이름을 바꾼 직후(하루 안) 다른 기기가 옛 이름으로 저장해도 서버가 새 이름으로 고쳐 저장한다
--      → 기록이 두 반으로 나뉘지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  1. classes — 보관 칸
-- ------------------------------------------------------------
alter table public.classes add column if not exists archived     boolean not null default false;
alter table public.classes add column if not exists archived_by  text;
alter table public.classes add column if not exists archived_at  timestamptz;


-- ------------------------------------------------------------
--  2. class_log — 반 변경 기록 (함수만 쓴다)
-- ------------------------------------------------------------
create table if not exists public.class_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  by_email  text not null default '',
  by_name   text not null default '',
  action    text not null,
  old_name  text not null default '',
  new_name  text not null default '',
  detail    jsonb not null default '{}'::jsonb,

  constraint class_log_action_check check (action in ('rename', 'archive', 'restore', 'delete'))
);
create index if not exists class_log_old_idx on public.class_log (old_name, at desc);
create index if not exists class_log_at_idx  on public.class_log (at desc);

alter table public.class_log enable row level security;
drop policy if exists class_log_teacher_read on public.class_log;
create policy class_log_teacher_read on public.class_log for select to authenticated using (public.is_teacher());
/* insert · update · delete 정책 없음 — 아래 함수(security definer)만 기록한다 */


-- ------------------------------------------------------------
--  3. 반 이름이 들어 있는 표 (이름 바꾸기 · 기록 세기에 쓴다)
-- ------------------------------------------------------------
create or replace function public._class_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'students', 'class_info', 'class_codes', 'class_notices', 'week_common',
    'tb_class_academy', 'tb_class_books', 'tb_class_dates', 'tb_issues', 'tb_order_lines',
    'tb_bill_plans', 'tb_bills', 'note_photos'
  ];
$$;


-- ------------------------------------------------------------
--  4. 옛 이름 따라가기 — 이름을 바꾼 직후 다른 기기가 옛 이름으로 저장해도 새 이름으로
--     (옛 이름이 다시 반 목록에 있으면 = 누가 그 이름으로 새 반을 만들었으면 건드리지 않는다)
-- ------------------------------------------------------------
create or replace function public._class_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n  text;
  nx text;
  i  int := 0;
begin
  n := btrim(coalesce(new.class_name, ''));
  if n = '' or exists (select 1 from public.classes where name = n) then return new; end if;
  loop
    select l.new_name into nx from public.class_log l
    where l.action = 'rename' and l.old_name = n and l.at > now() - interval '1 day'
    order by l.at desc limit 1;
    exit when nx is null;
    n := nx; i := i + 1;
    exit when i > 5 or exists (select 1 from public.classes where name = n);
  end loop;
  if n <> btrim(new.class_name) then new.class_name := n; end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array public._class_tables() loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I', t || '_class_follow', t);
    if t = 'note_photos' then
      execute format('create trigger %I before insert on public.%I for each row execute function public._class_follow()',
                     t || '_class_follow', t);
    else
      execute format('create trigger %I before insert or update of class_name on public.%I for each row execute function public._class_follow()',
                     t || '_class_follow', t);
    end if;
  end loop;
end;
$$;

/* 필기 사진은 원래 숨김 칸만 바뀐다 — 반 이름 바꾸기(class_rename) 때만 반 이름도 바뀌게 */
create or replace function public._photo_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id; new.student_id := old.student_id;
  if coalesce(current_setting('app.class_rename', true), '') <> '1' then new.class_name := old.class_name; end if;
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


-- ------------------------------------------------------------
--  5. 반마다 학생 · 기록 수
--     records = 지우면 안 되는 기록 수 (이게 0 이고 학생도 0 이어야 삭제 가능)
--     비어 있는 반 현황 · 비어 있는 반 공통 입력 · 공용 링크 주소는 기록으로 세지 않는다
-- ------------------------------------------------------------
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

  r := r || jsonb_build_object('records',
    (r ->> 'left')::bigint + (r ->> 'reports')::bigint + (r ->> 'notices')::bigint + (r ->> 'info')::bigint +
    (r ->> 'textbook')::bigint + (r ->> 'photos')::bigint + (r ->> 'exam')::bigint);
  return r;
end;
$$;

create or replace function public._class_log(p_action text, p_old text, p_new text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.class_log (by_email, by_name, action, old_name, new_name, detail)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), public._staff_name(), p_action, coalesce(p_old, ''), coalesce(p_new, ''), coalesce(p_detail, '{}'::jsonb));
$$;


-- ------------------------------------------------------------
--  6. [반 관리] 화면 — 반 목록 · 수 · 최근 기록 (선생님만)
-- ------------------------------------------------------------
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
               'created_by', c.created_by, 'created_at', c.created_at) || public._class_usage(c.name)
             order by c.name)
      from public.classes c), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(to_jsonb(l) - 'by_email' order by l.at desc)
      from (select * from public.class_log order by at desc limit 30) l), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------
--  7. 이름 바꾸기 — 모든 기록이 함께 (한 번에. 하나라도 실패하면 전부 취소)
-- ------------------------------------------------------------
create or replace function public.class_rename(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o text := btrim(coalesce(p_old, ''));
  w text := regexp_replace(btrim(coalesce(p_new, '')), '\s+', ' ', 'g');
  t text;
  n bigint;
  used bigint := 0;
  detail jsonb := '{}'::jsonb;
begin
  perform public._need_teacher();
  perform pg_advisory_xact_lock(hashtext('marathon-class-admin'));
  if w = '' then raise exception '새 반 이름을 적어 주세요.'; end if;
  if length(w) > 30 then raise exception '반 이름은 30자까지 적을 수 있습니다.'; end if;
  if w = o then raise exception '지금 이름과 같습니다.'; end if;
  if not exists (select 1 from public.classes where name = o) then
    raise exception '‘%’ 반이 없습니다. 다른 분이 먼저 바꿨을 수 있습니다 — 새로 불러옵니다.', o;
  end if;
  if exists (select 1 from public.classes where name = w) then
    raise exception '‘%’ 반이 이미 있습니다 (보관된 반 포함). 다른 이름을 적어 주세요.', w;
  end if;
  foreach t in array public._class_tables() loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where btrim(class_name) = $1', t) into n using w;
      used := used + n;
    end if;
  end loop;
  if used > 0 or exists (select 1 from public.app_settings where key = 'exams' and (value -> 'byClass') ? w) then
    raise exception '‘%’ 이름으로 남아 있는 기록이 있어 그 이름으로는 바꿀 수 없습니다 (기록이 섞이지 않게). 다른 이름을 적어 주세요.', w;
  end if;

  perform set_config('app.class_rename', '1', true);
  update public.classes set name = w where name = o;
  foreach t in array public._class_tables() loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set class_name = $1 where btrim(class_name) = $2', t) using w, o;
      get diagnostics n = row_count;
      if n > 0 then detail := detail || jsonb_build_object(t, n); end if;
    end if;
  end loop;
  update public.app_settings
     set value = jsonb_set(value, '{byClass}', ((value -> 'byClass') - o) || jsonb_build_object(w, value -> 'byClass' -> o)),
         updated_at = now()
   where key = 'exams' and jsonb_typeof(value -> 'byClass') = 'object' and (value -> 'byClass') ? o;
  get diagnostics n = row_count;
  if n > 0 then detail := detail || jsonb_build_object('exams', n); end if;
  perform set_config('app.class_rename', '', true);

  perform public._class_log('rename', o, w, detail);
  return jsonb_build_object('ok', true, 'name', w, 'detail', detail);
end;
$$;


-- ------------------------------------------------------------
--  8. 보관 / 되살리기
--     재원생이 있는 반은 p_confirm = true 일 때만 보관한다 (화면이 "재원생 n명" 을 보여 주고 한 번 더 묻는다)
-- ------------------------------------------------------------
create or replace function public.class_archive(p_name text, p_archive boolean, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.classes;
  act bigint;
begin
  perform public._need_teacher();
  perform pg_advisory_xact_lock(hashtext('marathon-class-admin'));
  select * into c from public.classes where name = btrim(coalesce(p_name, ''));
  if not found then raise exception '‘%’ 반이 없습니다. 다른 분이 먼저 바꿨을 수 있습니다 — 새로 불러옵니다.', p_name; end if;
  if c.archived = p_archive then
    return jsonb_build_object('ok', true, 'same', true);
  end if;
  select count(*) into act from public.students where btrim(class_name) = c.name and not archived;
  if p_archive and act > 0 and not coalesce(p_confirm, false) then
    return jsonb_build_object('ok', false, 'need_confirm', true, 'active', act);
  end if;
  update public.classes
     set archived = p_archive,
         archived_by = case when p_archive then public._staff_name() end,
         archived_at = case when p_archive then now() end
   where name = c.name;
  perform public._class_log(case when p_archive then 'archive' else 'restore' end, c.name, '', jsonb_build_object('active', act));
  return jsonb_build_object('ok', true);
end;
$$;


-- ------------------------------------------------------------
--  9. 완전 삭제 — 학생(퇴원생 포함) 0명 · 기록 0건인 반만
-- ------------------------------------------------------------
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
  /* 비어 있는 반 현황 · 반 공통 입력 · 공지가 없는 공용 링크는 함께 지운다 */
  delete from public.class_info  where class_name = nm;
  delete from public.week_common where class_name = nm;
  delete from public.class_codes where class_name = nm;
  update public.app_settings set value = jsonb_set(value, '{byClass}', (value -> 'byClass') - nm), updated_at = now()
   where key = 'exams' and jsonb_typeof(value -> 'byClass') = 'object' and (value -> 'byClass') ? nm;
  delete from public.classes where name = nm;
  perform public._class_log('delete', nm, '', u);
  return jsonb_build_object('ok', true);
end;
$$;


-- ------------------------------------------------------------
--  10. 권한 — 로그인한 사람만 부를 수 있고, 안에서 선생님인지 다시 확인한다
-- ------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.class_admin_get()', 'public.class_rename(text, text)',
    'public.class_archive(text, boolean, boolean)', 'public.class_delete(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public._class_usage(text)', 'public._class_log(text, text, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  확인 — 반 목록과 보관 여부
-- ------------------------------------------------------------
select name as 반_이름, archived as 보관, archived_by as 보관한_사람,
       (select count(*) from public.students s where btrim(s.class_name) = c.name and not s.archived) as 재원생
from public.classes c
order by archived, name;
