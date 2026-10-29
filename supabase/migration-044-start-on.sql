-- ============================================================
--  마라톤 코치룸 — 신입생은 수강 시작일부터 · 학생마다 레포트 건너뛰기 (migration-044-start-on.sql)
--
--  실행 방법
--    043 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 레포트 · 보낸 기록은 바꾸지 않는다. 함수 배포는 없다.
--
--  1. students.start_on — 「수강 시작일」. 이날 수업부터 레포트 · 수업 영상 · 자료 · 과제 셈에 들어간다
--     (그 앞 수업의 작성 · 공개 · 발송 목록 · 「공개 n/전체」 「보냄 n/전체」 · 「오늘 할 일」 · 발송 칩 · 탭 배지에서 빠진다)
--     비어 있는 학생은 한 번 채운다: 상담 카드의 수강 시작일(student_cards.start_date) → 없으면 등록일.
--     단 등록일보다 앞선 수업 레포트를 이미 공개 · 발송했으면 그 수업 주의 첫날로 (이미 보낸 레포트가 목록에서 사라지지 않게)
--     새로 등록할 때 비어 있으면 등록한 날 (코치룸은 그 반 다음 수업일을 기본값으로 넣는다)
--  2. 상담 카드의 수강 시작일과 같은 값 — 어느 쪽에서 고쳐도 둘 다 바뀐다
--  3. care_checks.kind 에 report — 「오늘 할 일」 펼친 목록의 학생 이름 옆 × (그 학생만 그 수업 레포트 건너뛰기)
-- ============================================================

alter table public.students add column if not exists start_on date;

update public.students s
   set start_on = coalesce(
     (select c.start_date from public.student_cards c where c.student_id = s.id and c.start_date is not null),
     least((s.created_at at time zone 'Asia/Seoul')::date,
           coalesce((select min(p.week_start) from public.published p where p.student_id = s.id), 'infinity'::date),
           coalesce((select min(x.week_start) from public.sent x where x.student_id = s.id), 'infinity'::date)))
 where s.start_on is null;

create or replace function public._student_start_default()
returns trigger
language plpgsql
as $$
begin
  if new.start_on is null then new.start_on := (now() at time zone 'Asia/Seoul')::date; end if;
  return new;
end;
$$;
drop trigger if exists students_start_default on public.students;
create trigger students_start_default before insert on public.students for each row execute function public._student_start_default();

/* 상담 카드 ↔ 학생 — 같은 값으로 (서로 다를 때만 고쳐서 되풀이하지 않는다) */
create or replace function public._card_start_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.start_date is not null then
    update public.students set start_on = new.start_date where id = new.student_id and start_on is distinct from new.start_date;
  end if;
  return new;
end;
$$;
drop trigger if exists student_cards_start_sync on public.student_cards;
create trigger student_cards_start_sync after insert or update of start_date on public.student_cards for each row execute function public._card_start_sync();

create or replace function public._student_start_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.start_on is not null and (tg_op = 'INSERT' or new.start_on is distinct from old.start_on) then
    update public.student_cards set start_date = new.start_on where student_id = new.id and start_date is distinct from new.start_on;
  end if;
  return new;
end;
$$;
drop trigger if exists students_start_sync on public.students;
create trigger students_start_sync after insert or update of start_on on public.students for each row execute function public._student_start_sync();
revoke all on function public._card_start_sync() from public, anon, authenticated;
revoke all on function public._student_start_sync() from public, anon, authenticated;

alter table public.care_checks drop constraint if exists care_checks_kind;
alter table public.care_checks add constraint care_checks_kind check (kind in ('review', 'absent', 'report'));


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'start_on' as what, exists (select 1 from information_schema.columns where table_name = 'students' and column_name = 'start_on')::text as ok
union all select '빈 수강 시작일 없음', (not exists (select 1 from public.students where start_on is null))::text
union all select '학생마다 건너뛰기', (position('report' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'care_checks_kind')) > 0)::text;
