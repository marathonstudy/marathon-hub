-- ============================================================
--  마라톤국어 허브 — 여러 기기 동시 사용 (migration-003-sync.sql)
--
--  실행 방법
--    schema.sql · migration-002-textbook.sql 다음에
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표를 지우거나 자료를 바꾸지 않고 '더하기'만 한다.
--
--  하는 일
--    1. 수정 시각(updated_at)이 없던 표에 칸과 자동 갱신을 붙인다.
--       → 저장 직전에 "내가 불러온 뒤 누가 고쳤는가" 를 알 수 있다.
--    2. 주간 입력 · 반 공통을 '바뀐 항목만' 저장하는 함수 (entry_patch · common_patch)
--       → 한 조교가 출결을 누르고 다른 조교가 코멘트를 써도 서로 덮어쓰지 않는다.
--       → 같은 항목(같은 학생의 코멘트 등)을 다른 사람이 먼저 바꿨으면 저장하지 않고 알려 준다.
--    3. 실시간 반영(Realtime) — 다른 기기에서 누른 칸이 새로고침 없이 보이게
--       표를 supabase_realtime 에 등록한다. (RLS 그대로: staff 만 받는다)
-- ============================================================


-- ------------------------------------------------------------
--  1. 수정 시각
-- ------------------------------------------------------------
alter table public.field_defs   add column if not exists updated_at timestamptz not null default now();
alter table public.snippets     add column if not exists updated_at timestamptz not null default now();
alter table public.tb_academies add column if not exists updated_at timestamptz not null default now();

do $$
declare
  t text;
begin
  foreach t in array array['field_defs', 'snippets', 'class_info', 'tb_academies', 'tb_class_academy'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
                   t || '_touch', t);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  2. 바뀐 항목만 저장
--
--  p_set   바꿀 항목   {"attend_status":"late", "comment":"…", "homework.h1":{"월":true}, "scores.0":95}
--          homework.키 · scores.번호 는 그 칸 하나만 바꾼다 (null 이면 그 칸을 지운다)
--  p_base  내가 화면에 불러왔던 값 — 서버 값이 이것과 다르면 '다른 분이 먼저 수정' 으로 보고
--          그 항목은 저장하지 않는다. 나머지 항목은 저장한다.
--  p_force true 면 확인 없이 덮어쓴다 (사용자가 [내 내용으로 덮어쓰기] 를 고른 경우)
--
--  돌려주는 값 {"ok":true|false, "conflicts":[항목…], "row":{서버의 지금 줄}}
-- ------------------------------------------------------------

create or replace function public._flat_get(j jsonb, k text)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    case when k like 'scores.%'   then j -> 'scores'   -> substr(k, 8)
         when k like 'homework.%' then j -> 'homework' -> substr(k, 10)
         else j -> k end,
    'null'::jsonb);
$$;

create or replace function public._flat_set(j jsonb, k text, v jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  col text;
  sub text;
begin
  if k like 'scores.%' or k like 'homework.%' then
    col := split_part(k, '.', 1);
    sub := substr(k, length(col) + 2);
    if coalesce(jsonb_typeof(j -> col), '') <> 'object' then
      j := jsonb_set(j, array[col], '{}'::jsonb, true);
    end if;
    if v is null or v = 'null'::jsonb then
      return j #- array[col, sub];
    end if;
    return jsonb_set(j, array[col, sub], v, true);
  end if;
  return j || jsonb_build_object(k, v);
end;
$$;

create or replace function public.entry_patch(
  p_week date, p_student uuid, p_set jsonb, p_base jsonb, p_force boolean default false)
returns jsonb
language plpgsql
as $$
declare
  r public.entries;
  cur jsonb;
  k text;
  v jsonb;
  conflicts text[] := '{}';
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;

  insert into public.entries (week_start, student_id) values (p_week, p_student)
  on conflict (week_start, student_id) do nothing;
  select * into r from public.entries where week_start = p_week and student_id = p_student for update;
  cur := to_jsonb(r);

  if not coalesce(p_force, false) then
    for k, v in select * from jsonb_each(coalesce(p_base, '{}'::jsonb)) loop
      if p_set ? k and public._flat_get(cur, k) is distinct from v then
        conflicts := conflicts || k;
      end if;
    end loop;
  end if;

  for k, v in select * from jsonb_each(coalesce(p_set, '{}'::jsonb)) loop
    if not (k = any(conflicts)) then cur := public._flat_set(cur, k, v); end if;
  end loop;

  update public.entries set
    attend_status = coalesce(cur ->> 'attend_status', ''),
    attend_note   = coalesce(cur ->> 'attend_note', ''),
    focus_score   = coalesce((cur ->> 'focus_score')::smallint, 0),
    scores        = coalesce(cur -> 'scores', '{}'::jsonb),
    homework      = coalesce(cur -> 'homework', '{}'::jsonb),
    on_time_rate  = coalesce((cur ->> 'on_time_rate')::smallint, 100),
    comment       = coalesce(cur ->> 'comment', '')
  where id = r.id
  returning to_jsonb(entries.*) into cur;

  return jsonb_build_object('ok', array_length(conflicts, 1) is null,
                            'conflicts', to_jsonb(conflicts), 'row', cur);
end;
$$;

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
    if k in ('lessons', 'tests', 'homework', 'comment') and not (k = any(conflicts)) then
      cur := cur || jsonb_build_object(k, v);
    end if;
  end loop;

  update public.week_common set
    lessons  = coalesce(cur -> 'lessons', '[]'::jsonb),
    tests    = coalesce(cur -> 'tests', '[]'::jsonb),
    homework = coalesce(cur -> 'homework', '[]'::jsonb),
    comment  = coalesce(cur ->> 'comment', '')
  where id = r.id
  returning to_jsonb(week_common.*) into cur;

  return jsonb_build_object('ok', array_length(conflicts, 1) is null,
                            'conflicts', to_jsonb(conflicts), 'row', cur);
end;
$$;

revoke all on function public.entry_patch(date, uuid, jsonb, jsonb, boolean)  from public, anon;
revoke all on function public.common_patch(date, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.entry_patch(date, uuid, jsonb, jsonb, boolean)  to authenticated;
grant execute on function public.common_patch(date, text, jsonb, jsonb, boolean) to authenticated;


-- ------------------------------------------------------------
--  3. 실시간 반영 (Realtime)
--     등록한 표의 바뀐 줄이 로그인한 staff 화면으로 바로 전달된다.
--     RLS 가 그대로 적용되므로 staff 가 아니면 아무것도 받지 못한다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime 이 없어 실시간 반영을 건너뜁니다 (생성기가 30초마다 새로 불러옵니다).';
    return;
  end if;
  foreach t in array array[
    'students', 'student_links', 'entries', 'week_common', 'class_notices', 'published', 'sent',
    'tb_issues', 'tb_bills', 'tb_bill_notices', 'tb_refunds', 'tb_class_dates', 'tb_stock_moves', 'tb_orders'
  ] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ============================================================
--  확인 — 실시간 반영에 등록된 표 (14개 안팎이 나오면 된다)
-- ============================================================
select tablename as realtime_tables
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
