-- ============================================================
--  마라톤 코치룸 — 출석 체크 · 결석생 자료 배부 / 보강 영상 신청 · 출결 바꾼 기록 · 퇴원일 (migration-037-attendance.sql)
--
--  실행 방법
--    036 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 출결 · 레포트 기록은 지우지도 바꾸지도 않는다 (칸 · 표를 더하기만 한다).
--
--  출결은 지금처럼 entries(반 + 수업이 든 주 · 학생 한 줄)의 attend_status · attend_note 한 곳에 둔다.
--    「출석 체크」 화면과 레포트 작성 화면의 학생 카드 출결은 같은 칸이다 (어느 쪽에서 고쳐도 같은 값).
--  entries 에 더하는 칸
--    att_material  결석생 자료 배부 (기본 true = 배부함 · 끄면 「미배부」)
--    att_makeup    결석생 보강 영상 신청 (기본 true = 신청함 · 끄면 「미신청」)
--    attend_by · attend_at  출결을 마지막으로 바꾼 직원 · 시각 (서버가 채운다)
--    → 코치룸에서만 쓴다. 학부모 · 학생 레포트에는 넣지 않는다 (레포트 출결은 지금처럼 「결석」만).
--  attend_checks  반 + 수업(주)마다 「출석 체크 완료」 — 누가 언제 (「오늘」 반 카드 버튼)
--  attend_log     출결을 바꿀 때마다 한 줄 — 무엇을 · 누가 · 언제 (직원만 읽는다)
--  students.left_on  퇴원일 — 그 날 뒤 수업부터 출석 체크 · 레포트 작성 · 발송 · 「오늘」 · 문자 대상에서 빠진다 (지우면 다시 돌아온다)
-- ============================================================


-- ---------- 칸 더하기 ----------
alter table public.students add column if not exists left_on date;
alter table public.entries  add column if not exists att_material boolean not null default true;
alter table public.entries  add column if not exists att_makeup   boolean not null default true;
alter table public.entries  add column if not exists attend_by    text not null default '';
alter table public.entries  add column if not exists attend_at    timestamptz;


-- ---------- 출석 체크 완료 ----------
create table if not exists public.attend_checks (
  class_name   text not null,
  week_start   date not null,
  lesson_date  date,
  checked_by   text not null default '',
  checked_name text not null default '',
  checked_at   timestamptz not null default now(),
  primary key (class_name, week_start)
);

create or replace function public._attend_check_who()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.checked_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.checked_name := public._staff_who();
  new.checked_at := now();
  return new;
end;
$$;
drop trigger if exists attend_checks_who on public.attend_checks;
create trigger attend_checks_who before insert or update on public.attend_checks for each row execute function public._attend_check_who();


-- ---------- 출결 바꾼 기록 ----------
create table if not exists public.attend_log (
  id            bigint generated always as identity primary key,
  week_start    date not null,
  student_id    uuid not null references public.students(id) on delete cascade,
  old_status    text not null default '',
  attend_status text not null default '',
  attend_note   text not null default '',
  att_material  boolean,
  att_makeup    boolean,
  changed_by    text not null default '',
  changed_name  text not null default '',
  changed_at    timestamptz not null default now()
);
create index if not exists attend_log_student_idx on public.attend_log (student_id, week_start);

/* 출결 칸이 바뀌면 — 누가 · 언제를 채우고 기록을 한 줄 남긴다 (출석 기본값을 처음 만드는 insert 는 남기지 않는다) */
create or replace function public._attend_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.attend_status is not distinct from old.attend_status and new.attend_note is not distinct from old.attend_note
     and new.att_material is not distinct from old.att_material and new.att_makeup is not distinct from old.att_makeup then
    return new;
  end if;
  new.attend_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.attend_at := now();
  if tg_op = 'UPDATE' then
    insert into public.attend_log (week_start, student_id, old_status, attend_status, attend_note, att_material, att_makeup, changed_by, changed_name)
    values (new.week_start, new.student_id, coalesce(old.attend_status, ''), new.attend_status, new.attend_note, new.att_material, new.att_makeup, new.attend_by, public._staff_who());
  end if;
  return new;
end;
$$;
drop trigger if exists entries_attend_stamp on public.entries;
create trigger entries_attend_stamp before insert or update on public.entries for each row execute function public._attend_stamp();


-- ---------- entry_patch — 결석생 두 칸도 저장 (나머지는 003 그대로) ----------
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
    comment       = coalesce(cur ->> 'comment', ''),
    att_material  = coalesce((cur ->> 'att_material')::boolean, true),
    att_makeup    = coalesce((cur ->> 'att_makeup')::boolean, true)
  where id = r.id
  returning to_jsonb(entries.*) into cur;

  return jsonb_build_object('ok', array_length(conflicts, 1) is null,
                            'conflicts', to_jsonb(conflicts), 'row', cur);
end;
$$;
revoke all on function public.entry_patch(date, uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.entry_patch(date, uuid, jsonb, jsonb, boolean) to authenticated;


-- ---------- 「챙길 학생」 확인함 — 자료 미배부 · 보강 영상 미신청도 (036 의 care_checks) ----------
alter table public.care_checks drop constraint if exists care_checks_kind;
alter table public.care_checks add constraint care_checks_kind check (kind in ('review', 'absent', 'material', 'makeup'));


-- ---------- 권한 — 로그인한 직원만 (학생 · 학부모 링크는 못 읽는다) ----------
alter table public.attend_checks enable row level security;
drop policy if exists attend_checks_staff_all on public.attend_checks;
create policy attend_checks_staff_all on public.attend_checks for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.attend_checks from anon;
grant select, insert, update, delete on public.attend_checks to authenticated;

alter table public.attend_log enable row level security;
drop policy if exists attend_log_staff_read on public.attend_log;
create policy attend_log_staff_read on public.attend_log for select to authenticated using (public.is_staff());
revoke all on public.attend_log from anon;
revoke insert, update, delete on public.attend_log from authenticated;          -- 기록은 서버(트리거)만 쓴다
grant select on public.attend_log to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attend_checks') then
    alter publication supabase_realtime add table public.attend_checks;
  end if;
end;
$$;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'entries 결석생 칸' as what, (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'entries' and column_name in ('att_material', 'att_makeup', 'attend_by', 'attend_at'))::text as ok
union all select 'students 퇴원일', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'left_on')::text
union all select 'rls', (select bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('attend_checks', 'attend_log'))::text
union all select 'log anon blocked', (not has_table_privilege('anon', 'public.attend_log', 'select'))::text;
