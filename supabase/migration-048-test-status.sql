-- ============================================================
--  마라톤 코치룸 — 레포트 작성 화면 테스트 상태 결석 · 미응시 · 응시 (migration-048-test-status.sql)
--
--  실행 방법
--    047 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 낸 점수 · 이미 넣은 미응시 사유는 바꾸지 않는다. 함수 배포는 없다.
--
--  1. review_absences — 사유 'none'(미응시 · 사유 없이 직접 고름) · 'taken'(응시 · 점수는 아직 없음) · auto(기본값으로 넣은 줄)
--  2. review_default_absent(반, 주) — 작성 화면을 열 때. 그 수업일 마감(다음 날 0시 · 한국 시간)이 지났고
--     그 수업 시험을 하나도 안 냈고 · 아무 표시도 없는 학생만 모든 시험 「결석」(auto). 직접 고른 값 · 낸 점수는 건드리지 않는다
--     하나라도 낸 학생은 넣지 않는다 (안 낸 시험은 지금처럼 「미응시」)
--  3. review_status_set(시험들, 학생, 'absent' | 'missing' | 'taken') — 작성 화면 학생 줄 [결석] [미응시] [응시] (직접 고른 값 · auto 아님)
--     낸 시험은 건너뛴다. 출결(출석 · 결석)은 바꾸지 않는다 — 화면이 「출결도 결석으로 바꿀까요?」를 묻는다 (예전 미응시 「결석」과 같다)
--  4. 낸 기록이 생기면 그 학생 그 수업의 다른 시험에 남은 auto 「결석」도 푼다 (하나만 냈으면 안 낸 시험은 「미응시」)
-- ============================================================

alter table public.review_absences add column if not exists auto boolean not null default false;
alter table public.review_absences drop constraint if exists review_absences_reason_check;
alter table public.review_absences add constraint review_absences_reason_check
  check (reason in ('absent', 'late', 'counsel', 'replaced', 'other', 'none', 'taken'));

create or replace function public._review_absent_label(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason when 'absent' then '결석' when 'late' then '지각' when 'counsel' then '상담 중'
                       when 'replaced' then '다른 시험으로 대체' when 'other' then '기타'
                       when 'none' then '미응시' when 'taken' then '응시' else '' end;
$$;

create or replace function public._review_absent_json(a public.review_absences)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('reason', a.reason, 'label', public._review_absent_label(a.reason), 'memo', a.memo,
                            'set_by', a.set_by, 'set_at', a.set_at, 'auto', a.auto);
$$;

/* 기본값 「결석」 — 마감이 지난 수업만 · 아무것도 안 낸 학생만 · 표시가 하나도 없는 학생만 */
create or replace function public.review_default_absent(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  with tests as (
    select * from public.review_tests
     where class_name = btrim(coalesce(p_class, '')) and week_start = p_week and not off and lesson_date < today
  ),
  who as (
    select st.id from public.students st
     where not st.archived and btrim(st.class_name) = btrim(coalesce(p_class, ''))
       and exists (select 1 from tests)
       and (st.start_on is null or st.start_on <= (select min(lesson_date) from tests))
       and not exists (select 1 from public.review_submissions x join tests t on t.id = x.test_id where x.student_id = st.id)
       and not exists (select 1 from public.review_absences a join tests t on t.id = a.test_id where a.student_id = st.id)
  ),
  ins as (
    insert into public.review_absences (test_id, student_id, class_name, reason, memo, set_by, set_at, auto)
    select t.id, w.id, t.class_name, 'absent', '', '기본값', now(), true from tests t cross join who w
    on conflict (test_id, student_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return jsonb_build_object('ok', true, 'set', n);
end;
$$;

/* 작성 화면 [결석] [미응시] [응시] — 낸 시험은 건너뛴다 · 직접 고른 값 (auto 아님) */
create or replace function public.review_status_set(p_tests uuid[], p_student uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rs text := case p_state when 'absent' then 'absent' when 'missing' then 'none' when 'taken' then 'taken' else '' end;
  st public.students;
  t public.review_tests;
  old public.review_absences;
  n int := 0;
  skipped int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if rs = '' then raise exception '결석 · 미응시 · 응시 중에서 골라 주세요.'; end if;
  if coalesce(cardinality(p_tests), 0) = 0 or cardinality(p_tests) > 10 then raise exception '시험을 골라 주세요.'; end if;
  select * into st from public.students where id = p_student;
  if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
  for t in select * from public.review_tests where id = any(p_tests) loop
    if t.off or exists (select 1 from public.review_submissions where test_id = t.id and student_id = st.id) then skipped := skipped + 1; continue; end if;
    select * into old from public.review_absences where test_id = t.id and student_id = st.id;
    insert into public.review_absences (test_id, student_id, class_name, reason, memo, set_by, set_at, auto)
    values (t.id, st.id, t.class_name, rs, '', coalesce(public._staff_name(), ''), now(), false)
    on conflict (test_id, student_id) do update set reason = excluded.reason, memo = '', set_by = excluded.set_by, set_at = now(), auto = false;
    perform public._review_log('absent_set', null, st.id, t.class_name,
      case when old.test_id is null then null else jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', old.reason) end,
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', rs));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'set', n, 'skipped', skipped);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.review_default_absent(text, date)', 'public.review_status_set(uuid[], uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

/* 하나라도 내면 — 같은 수업의 다른 시험에 남은 기본값 「결석」(auto)도 푼다 */
create or replace function public._review_auto_unset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare t public.review_tests;
begin
  select * into t from public.review_tests where id = new.test_id;
  if t.id is not null then
    delete from public.review_absences a using public.review_tests o
     where a.test_id = o.id and a.student_id = new.student_id and a.auto
       and o.class_name = t.class_name and o.week_start = t.week_start;
  end if;
  return new;
end;
$$;
revoke all on function public._review_auto_unset() from public, anon, authenticated;
drop trigger if exists review_auto_unset on public.review_submissions;
create trigger review_auto_unset after insert on public.review_submissions
  for each row execute function public._review_auto_unset();


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'auto' as what, exists (select 1 from information_schema.columns where table_name = 'review_absences' and column_name = 'auto')::text as ok
union all select '기본값 결석', exists (select 1 from pg_proc where proname = 'review_default_absent')::text
union all select '같이 바꾸기', exists (select 1 from pg_proc where proname = 'review_status_set')::text;
