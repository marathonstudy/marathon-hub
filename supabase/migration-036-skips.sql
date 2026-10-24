-- ============================================================
--  마라톤 코치룸 — 레포트 「건너뛰기」 · 챙길 학생 「확인함」 · 마라톤 사이트 로그인 정보 (migration-036-skips.sql)
--
--  실행 방법
--    035 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 레포트 · 발송 · 복습테스트 기록은 바꾸지 않는다 (표 세 개만 더한다).
--
--  report_skips  반 + 수업일 레포트를 보내지 않고 넘김 — 「오늘 할 일」 · 탭 배지에서 빠지고, 반 카드 칩은 회색 「건너뜀」
--                되돌리면 지우지 않고 undone_* 만 채운다 (누가 언제 건너뛰고 되돌렸는지 남는다)
--  care_checks   「챙길 학생」 확인함 — 묶음(student_id 없음) 또는 학생 한 명(×)
--                ckey = 종류|반|기준일|학생 — 복습테스트는 그 수업일, 결석은 마지막 결석 주 (같은 수업 · 같은 알림 기준이면 다시 뜨지 않는다)
--  staff_vault   직원만 읽는 값 — 지금은 'marathon_site' { id, pw } (「+ 과제 링크 연결」의 아이디 · 비밀번호 복사)
--                깃허브 저장소 · 코드 · 학생 · 학부모 화면에는 없다. 실시간 알림(realtime)에도 넣지 않는다.
--  누가 · 언제 — 저장할 때 서버가 로그인한 직원 이메일 · 이름 · 시각을 채운다 (화면이 보낸 값은 쓰지 않는다)
-- ============================================================


/* 지금 로그인한 직원 이름 (없으면 이메일) */
create or replace function public._staff_who()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select nullif(name, '') from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
                  lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public._staff_who() from public, anon;
grant execute on function public._staff_who() to authenticated;


-- ---------- 레포트 건너뛰기 ----------
create table if not exists public.report_skips (
  class_name    text not null,
  lesson_date   date not null,
  skipped_by    text not null default '',
  skipped_name  text not null default '',
  skipped_at    timestamptz not null default now(),
  undone_by     text,
  undone_name   text,
  undone_at     timestamptz,
  primary key (class_name, lesson_date)
);

-- ---------- 챙길 학생 확인함 ----------
create table if not exists public.care_checks (
  ckey          text primary key,
  kind          text not null,
  class_name    text not null default '',
  basis_date    date,
  student_id    uuid references public.students(id) on delete cascade,
  checked_by    text not null default '',
  checked_name  text not null default '',
  checked_at    timestamptz not null default now(),
  undone_by     text,
  undone_name   text,
  undone_at     timestamptz,
  constraint care_checks_kind check (kind in ('review', 'absent')),
  constraint care_checks_key check (length(ckey) <= 300)
);

/* 누가 · 언제 — undone_at 을 채우면 되돌림, 비우면(다시) 건너뜀 · 확인함 */
create or replace function public._skip_who()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  nm text := public._staff_who();
begin
  if new.undone_at is null then
    if tg_table_name = 'report_skips' then
      new.skipped_by := em; new.skipped_name := nm; new.skipped_at := now();
    else
      new.checked_by := em; new.checked_name := nm; new.checked_at := now();
    end if;
    new.undone_by := null; new.undone_name := null;
  elsif tg_op = 'INSERT' or old.undone_at is null then
    new.undone_by := em; new.undone_name := nm; new.undone_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists report_skips_who on public.report_skips;
create trigger report_skips_who before insert or update on public.report_skips for each row execute function public._skip_who();
drop trigger if exists care_checks_who on public.care_checks;
create trigger care_checks_who before insert or update on public.care_checks for each row execute function public._skip_who();

-- ---------- 직원만 읽는 값 ----------
create table if not exists public.staff_vault (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  constraint staff_vault_key check (key in ('marathon_site'))
);
create or replace function public._vault_who()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := public._staff_who();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists staff_vault_who on public.staff_vault;
create trigger staff_vault_who before insert or update on public.staff_vault for each row execute function public._vault_who();


-- ---------- 권한 — 로그인한 직원만 (학생 · 학부모 링크는 못 읽는다) ----------
do $$
declare
  t text;
begin
  foreach t in array array['report_skips', 'care_checks', 'staff_vault'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_staff_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
  /* 다른 직원 화면도 바로 (staff_vault 는 넣지 않는다) */
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['report_skips', 'care_checks'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'skips · checks rls' as what, (select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('report_skips', 'care_checks', 'staff_vault'))::text as ok
union all select 'vault anon blocked', (not has_table_privilege('anon', 'public.staff_vault', 'select'))::text
union all select 'vault not realtime', (not exists (select 1 from pg_publication_tables where tablename = 'staff_vault'))::text;
