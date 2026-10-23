-- ============================================================
--  마라톤 코치룸 — 레포트를 「반 + 수업일」 단위로 · 고친 레포트 알림 횟수 (migration-032-report-unit.sql)
--
--  실행 방법
--    031 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 공개 · 보냄 기록은 지우지 않는다 (칸을 더하고 채우기만 한다).
--
--  1. published · sent 에 class_name(반) · lesson_date(수업일) 칸을 더하고 지금까지의 기록을 채운다.
--     앞으로 공개 · 보냄 표시가 들어오면 트리거가 알아서 채운다 (화면 · 함수는 그대로).
--     → 레포트가 「반 + 수업일」로도 찾아진다. 나중에 「여러 반이 같은 회차 수업을 요일만 다르게 듣는 과정」을 붙일 때 쓴다.
--       (지금 화면은 반 + 그 수업이 든 주로 다룬다 — 반마다 한 주에 레포트 한 편)
--  2. sent 에 notify_n(고친 레포트를 다시 알린 횟수) · notify_at(마지막 알림 시각)을 더한다.
--     report_notified(주, 학생들) — 「바뀐 내용 알리기」로 보낸 학생의 횟수를 1 올린다 (직원만).
-- ============================================================


-- ------------------------------------------------------------
--  1. 칸 더하기
-- ------------------------------------------------------------
alter table public.published add column if not exists class_name  text;
alter table public.published add column if not exists lesson_date date;
alter table public.sent      add column if not exists class_name  text;
alter table public.sent      add column if not exists lesson_date date;
alter table public.sent      add column if not exists notify_n    integer not null default 0;
alter table public.sent      add column if not exists notify_at   timestamptz;

create index if not exists published_unit_idx on public.published (class_name, lesson_date);
create index if not exists sent_unit_idx      on public.sent (class_name, lesson_date);


-- ------------------------------------------------------------
--  2. 수업일 찾기 — 레포트에 적힌 수업일, 없으면 그 반 그 주에 바꾼 수업일(class_weeks)
-- ------------------------------------------------------------
create or replace function public._report_lesson_date(p_data jsonb, p_class text, p_week date)
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    case when coalesce(p_data ->> 'lessonDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_data ->> 'lessonDate')::date end,
    (select w.lesson_date from public.class_weeks w where w.class_name = p_class and w.week_start = p_week and not w.canceled limit 1)
  );
$$;


-- ------------------------------------------------------------
--  3. 지금까지의 기록 채우기 (비어 있는 칸만)
-- ------------------------------------------------------------
update public.published p
   set class_name = coalesce(nullif(btrim(p.report_data ->> 'className'), ''), s.class_name)
  from public.students s
 where s.id = p.student_id and p.class_name is null;

update public.published p
   set lesson_date = public._report_lesson_date(p.report_data, p.class_name, p.week_start)
 where p.lesson_date is null;

update public.sent x
   set class_name = p.class_name, lesson_date = coalesce(x.lesson_date, p.lesson_date)
  from public.published p
 where p.student_id = x.student_id and p.week_start = x.week_start and x.class_name is null;

-- 공개 기록이 없는 보냄 표시 — 학생의 지금 반으로
update public.sent x
   set class_name = s.class_name
  from public.students s
 where s.id = x.student_id and x.class_name is null;

update public.sent x
   set lesson_date = p.lesson_date
  from public.published p
 where p.student_id = x.student_id and p.week_start = x.week_start and x.lesson_date is null;


-- ------------------------------------------------------------
--  4. 앞으로 들어오는 기록 — 트리거가 반 · 수업일을 채운다
-- ------------------------------------------------------------
create or replace function public._published_fill_unit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(btrim(new.class_name), '') = '' then
    new.class_name := coalesce(nullif(btrim(new.report_data ->> 'className'), ''),
                               (select s.class_name from public.students s where s.id = new.student_id));
  end if;
  new.lesson_date := coalesce(public._report_lesson_date(new.report_data, new.class_name, new.week_start), new.lesson_date);
  return new;
end;
$$;

drop trigger if exists published_fill_unit on public.published;
create trigger published_fill_unit before insert or update on public.published
  for each row execute function public._published_fill_unit();

create or replace function public._sent_fill_unit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
begin
  select class_name, lesson_date into p from public.published
   where student_id = new.student_id and week_start = new.week_start limit 1;
  if coalesce(btrim(new.class_name), '') = '' then
    new.class_name := coalesce(p.class_name, (select s.class_name from public.students s where s.id = new.student_id));
  end if;
  if new.lesson_date is null then new.lesson_date := p.lesson_date; end if;
  return new;
end;
$$;

drop trigger if exists sent_fill_unit on public.sent;
create trigger sent_fill_unit before insert or update on public.sent
  for each row execute function public._sent_fill_unit();


-- ------------------------------------------------------------
--  5. 고친 레포트 알림 횟수 — 「알림 2회 · 마지막 10/24 10:12」
-- ------------------------------------------------------------
create or replace function public.report_notified(p_week date, p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;
  if p_week is null or p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if array_length(p_ids, 1) > 300 then raise exception '학생이 너무 많습니다.'; end if;
  update public.sent
     set notify_n = notify_n + 1, notify_at = now()
   where week_start = p_week and student_id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.report_notified(date, uuid[]) from public, anon;
grant execute on function public.report_notified(date, uuid[]) to authenticated;
-- 공개 · 보냄 표시 트리거가 직원 권한으로 부른다 — 직원(authenticated)만 실행 (로그인 안 한 사람은 막는다)
revoke all on function public._report_lesson_date(jsonb, text, date) from public, anon;
grant execute on function public._report_lesson_date(jsonb, text, date) to authenticated;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'published unit' as what,
       (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'published' and column_name = 'lesson_date'))::text as ok
union all select 'sent unit + notify',
       (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sent' and column_name = 'notify_n'))::text
union all select 'old records kept (no class_name missing)',
       (not exists (select 1 from public.published where class_name is null))::text
union all select 'anon blocked', (not has_function_privilege('anon', 'public.report_notified(date, uuid[])', 'execute'))::text;
