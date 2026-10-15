-- ============================================================
--  마라톤 코치룸 — 반 목록 한 곳에서 (migration-009-classes.sql)
--
--  실행 방법
--    001 ~ 008 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 새 표 하나를 더할 뿐, 있던 반 이름 · 학생 기록은 바꾸거나 지우지 않는다.
--
--  왜
--    지금까지 반 목록은 '다니는 학생의 반 이름' 에서만 만들었다.
--    그래서 학생이 아직 0명인 반 · 교재/공지/시험에만 있는 반은 명단의 반 고르기에 나오지 않았다.
--  이제
--    classes 표 하나가 반 목록의 기준이다. 명단 · 레포트 · 반 공지 · 시험 · 교재 · 필기 노트 · 「오늘」이
--    모두 이 목록(+ 다니는 학생의 반)을 쓴다.
--    · 처음 실행할 때 지금 쓰이는 반 이름을 모두 옮겨 담는다 (다니는 학생 · 반 현황 · 공용 링크 · 반 공지 ·
--      교재 학원 · 교재 · 일정 · 시험). 퇴원생만 남은 반은 옮기지 않는다 (예전처럼 목록에 안 나온다).
--    · 학생을 저장할 때 그 학생의 반이 목록에 없으면 자동으로 더한다 (엑셀 가져오기 포함).
--    · 이름이 비슷한 반(예: '목동반' 과 '목동 반')은 합치지 않는다. 맨 아래 결과의 '비슷한_이름' 칸에서 확인만 한다.
--  지키는 것
--    · RLS 켜짐. 사용 중인 staff(선생님 · 조교) 만 읽고 더할 수 있다. 지우거나 이름을 바꾸는 정책은 없다.
--    · 학부모 · 학생 화면(공개 함수)은 이 표를 쓰지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  1. classes — 반 기준 표. 반 이름이 열쇠다 (students.class_name 과 같은 글자).
-- ------------------------------------------------------------
create table if not exists public.classes (
  name        text primary key,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),

  constraint classes_name_trimmed check (name = btrim(name) and length(name) > 0)
);

/* 누가 만들었는지는 서버가 채운다 (화면이 보낸 값은 무시) */
create or replace function public._class_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.created_by := coalesce(nullif(lower(auth.jwt() ->> 'email'), ''), nullif(new.created_by, ''), 'system');
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists classes_stamp on public.classes;
create trigger classes_stamp before insert on public.classes
  for each row execute function public._class_stamp();

alter table public.classes enable row level security;
drop policy if exists classes_staff_select on public.classes;
drop policy if exists classes_staff_insert on public.classes;
create policy classes_staff_select on public.classes for select to authenticated using (public.is_staff());
create policy classes_staff_insert on public.classes for insert to authenticated with check (public.is_staff());
/* update · delete 정책은 일부러 없다 — 화면에서 반을 지우거나 이름을 바꿀 수 없다 */


-- ------------------------------------------------------------
--  2. 지금 쓰이는 반 이름 옮겨 담기 (있는 이름은 건드리지 않는다)
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  insert into public.classes (name, created_by)
  select distinct btrim(class_name), 'migration-009' from public.students
  where not archived and btrim(class_name) <> ''
  on conflict (name) do nothing;

  foreach t in array array['class_info', 'class_codes', 'class_notices', 'tb_class_academy', 'tb_class_books', 'tb_class_dates'] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'insert into public.classes (name, created_by)
         select distinct btrim(class_name), %L from public.%I where btrim(class_name) <> %L
         on conflict (name) do nothing', 'migration-009', t, '');
    end if;
  end loop;

  insert into public.classes (name, created_by)
  select distinct btrim(k), 'migration-009'
  from public.app_settings s,
       jsonb_object_keys(case when jsonb_typeof(s.value -> 'byClass') = 'object' then s.value -> 'byClass' else '{}'::jsonb end) k
  where s.key = 'exams' and btrim(k) <> ''
  on conflict (name) do nothing;
end;
$$;


-- ------------------------------------------------------------
--  3. 학생을 저장하면 그 반이 목록에 있게 한다 (퇴원생은 제외)
--     학생 저장이 이 때문에 실패하는 일은 없다.
-- ------------------------------------------------------------
create or replace function public._student_class_ensure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.archived and btrim(coalesce(new.class_name, '')) <> '' then
    begin
      insert into public.classes (name) values (btrim(new.class_name)) on conflict (name) do nothing;
    exception when others then
      null;   -- 반 목록에 못 넣어도 학생 저장은 그대로 진행
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists students_class_ensure on public.students;
create trigger students_class_ensure after insert or update of class_name, archived on public.students
  for each row execute function public._student_class_ensure();


-- ------------------------------------------------------------
--  4. 실시간 — 다른 기기에서 만든 반이 바로 보이게
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'classes') then
    alter publication supabase_realtime add table public.classes;
  end if;
end;
$$;


-- ------------------------------------------------------------
--  확인 — 반 목록 · 다니는 학생 수 · 이름이 비슷한 반 (합치지 않는다, 보기만)
-- ------------------------------------------------------------
with c as (
  select c.name, c.created_by,
         (select count(*) from public.students s where btrim(s.class_name) = c.name and not s.archived) as 학생수,
         lower(regexp_replace(regexp_replace(c.name, '\s+', '', 'g'), '반$', '')) as nk
  from public.classes c
)
select c.name as 반_이름, c.학생수, c.created_by as 만든_곳,
       (select string_agg(c2.name, ', ' order by c2.name) from c c2 where c2.nk = c.nk and c2.name <> c.name) as 비슷한_이름
from c
order by c.name;
