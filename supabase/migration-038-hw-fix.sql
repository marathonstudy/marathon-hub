-- ============================================================
--  마라톤 코치룸 — 과제 수정 (앱에서 받아 온 과제 기록을 조교가 날짜별로 고친다 · migration-038-hw-fix.sql)
--
--  실행 방법
--    037 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 앱 기록은 바꾸지 않는다 (앱 서버 · app-report 함수는 그대로).
--
--  hw_fixes  「과제 수정」 기록 — 한 번 고칠 때마다 한 줄 (학생 · 날짜 · 바꾼 상태 · 사유 · 고친 사람 · 시각)
--    status   onTime 정시 제출 · late 늦게 제출 · none 미제출 · exempt 면제(셈에서 뺌) · app 원래대로(앱 값)
--    그 학생 · 그 날짜의 가장 마지막 줄이 지금 값이다. 「원래대로」도 한 줄(app)로 남긴다 — 기록은 지우지 않는다
--    (화면에서는 고칠 수도 지울 수도 없다 · 넣기만)
--  코치룸은 지금 값을 앱 기록 위에 덮어서 센다 (「과제 n/5일」 · 과제 평균 · 정렬 · AI 초안 · 미리보기).
--  학부모 · 학생 화면(러닝노트)은 hub_hw_fix 로 받는다 — 바꾼 상태만 (사유 · 고친 사람 · 「수정」 표시는 넘기지 않는다)
--    이미 공개한 레포트 기간(그 학생의 가장 최근 공개 레포트 수업 전날까지)은 공개할 때 레포트에 담은 값(report_data.hwFix)
--    → 그 기간을 고치면 다시 공개해야 학부모에게 반영된다. 그 뒤(아직 공개 전 기간)는 고치면 바로.
-- ============================================================


-- ---------- 과제 수정 기록 ----------
create table if not exists public.hw_fixes (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  day         date not null,
  status      text not null,
  app_status  text not null default '',          -- 고칠 때 앱 값 (onTime · late · none · off) — 「원래 앱: 미제출」
  reason      text not null default '',
  fixed_by    text not null default '',
  fixed_name  text not null default '',
  fixed_at    timestamptz not null default now(),
  constraint hw_fixes_status check (status in ('onTime', 'late', 'none', 'exempt', 'app')),
  constraint hw_fixes_reason check (status = 'app' or char_length(btrim(reason)) between 1 and 200)
);
create index if not exists hw_fixes_student_idx on public.hw_fixes (student_id, day, id);

/* 고친 사람 · 시각은 서버가 채운다 */
create or replace function public._hw_fix_who()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.fixed_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.fixed_name := public._staff_who();
  new.fixed_at := now();
  new.reason := btrim(coalesce(new.reason, ''));
  return new;
end;
$$;
drop trigger if exists hw_fixes_who on public.hw_fixes;
create trigger hw_fixes_who before insert on public.hw_fixes for each row execute function public._hw_fix_who();


-- ---------- 권한 — 직원만 읽고 넣는다 (고치기 · 지우기 없음) ----------
alter table public.hw_fixes enable row level security;
drop policy if exists hw_fixes_staff_read on public.hw_fixes;
drop policy if exists hw_fixes_staff_add on public.hw_fixes;
create policy hw_fixes_staff_read on public.hw_fixes for select to authenticated using (public.is_staff());
create policy hw_fixes_staff_add  on public.hw_fixes for insert to authenticated with check (public.is_staff());
revoke all on public.hw_fixes from anon;
revoke update, delete on public.hw_fixes from authenticated;
grant select, insert on public.hw_fixes to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hw_fixes') then
    alter publication supabase_realtime add table public.hw_fixes;
  end if;
end;
$$;


-- ---------- 학부모 · 학생 화면에 보낼 값 { 'YYYY-MM-DD': 'onTime' | 'late' | 'none' | 'exempt' } ----------
/* 공개한 레포트 기간의 끝 — 레포트에 담은 hwFixTo(수업 전날), 예전 레포트는 그 주 일요일 */
create or replace function public._hw_fix_cut(p_student uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select max(case when coalesce(report_data ->> 'hwFixTo', '') ~ '^\d{4}-\d{2}-\d{2}$' then (report_data ->> 'hwFixTo')::date else week_start + 6 end)
  from public.published where student_id = p_student and visible;
$$;

create or replace function public._hw_fix_view(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cut date := public._hw_fix_cut(p_student);
  snap jsonb := '{}'::jsonb;
  live jsonb;
begin
  if cut is not null then
    /* 공개한 기간 — 가장 최근 공개 레포트에 담은 값 (공개할 때 그 수업 전날까지의 수정을 모두 담는다) */
    select case when jsonb_typeof(report_data -> 'hwFix') = 'object' then report_data -> 'hwFix' else '{}'::jsonb end into snap
    from public.published where student_id = p_student and visible
    order by case when coalesce(report_data ->> 'hwFixTo', '') ~ '^\d{4}-\d{2}-\d{2}$' then (report_data ->> 'hwFixTo')::date else week_start + 6 end desc, published_at desc
    limit 1;
  end if;
  select coalesce(jsonb_object_agg(x.day::text, x.status), '{}'::jsonb) into live
  from (select distinct on (day) day, status from public.hw_fixes where student_id = p_student order by day, id desc) x
  where x.status <> 'app' and (cut is null or x.day > cut);
  return coalesce(snap, '{}'::jsonb) || live;
end;
$$;

/* 러닝노트 (학부모 · 학생 링크) */
create or replace function public.hub_hw_fix(p_code text)
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
  if not found or s.archived then return '{}'::jsonb; end if;
  return public._hw_fix_view(s.id);
end;
$$;

/* 코치룸 미리보기 — 학부모가 지금 보는 값 */
create or replace function public.staff_hub_hw_fix(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;
  return public._hw_fix_view(p_student);
end;
$$;

/* 코치룸 「다시 공개해야 학부모에게 반영됩니다」 — 그 학생의 공개한 레포트 기간 끝 (없으면 null) */
create or replace function public.staff_hw_fix_cut(p_student uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 쓸 수 있습니다.'; end if;
  return public._hw_fix_cut(p_student);
end;
$$;

revoke all on function public._hw_fix_cut(uuid) from public, anon, authenticated;
revoke all on function public._hw_fix_view(uuid) from public, anon, authenticated;
revoke all on function public.hub_hw_fix(text) from public;
revoke all on function public.staff_hub_hw_fix(uuid) from public, anon;
revoke all on function public.staff_hw_fix_cut(uuid) from public, anon;
grant execute on function public.hub_hw_fix(text) to anon, authenticated;
grant execute on function public.staff_hub_hw_fix(uuid) to authenticated;
grant execute on function public.staff_hw_fix_cut(uuid) to authenticated;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'hw_fixes' as what, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'hw_fixes')::text as ok
union all select 'rls', (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'hw_fixes')::text
union all select 'anon blocked', (not has_table_privilege('anon', 'public.hw_fixes', 'select'))::text
union all select 'no update', (not has_table_privilege('authenticated', 'public.hw_fixes', 'update') and not has_table_privilege('authenticated', 'public.hw_fixes', 'delete'))::text;
