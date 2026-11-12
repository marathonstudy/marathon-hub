-- ============================================================
--  migration-106-app-old-month.sql — 앱 옛 기록을 1명 × 한 달씩 나눠 받기 · 요청마다 걸린 시간 (20261113a)
--  (106 은 105 다음 · 105 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포)
--
--  왜 — check-app-old-run-1111.sql 결과 옛 기록 받기 50명 전원 「앱 timeout」(11-13 00:26 · 요청 2026-01-01 ~ 11-13 · 받은 과제 0)
--       25명 × 10달을 한 번에 물으니 앱(/api/hub/student-records)이 25초 안에 답을 못 했다. 평소 동기화도 학생 기준 주소 39명이 timeout.
--       「앱이 지금 반 기간만 줌」은 0명 → 개강일 문제는 아님.
--  고친 것
--    1. 한 번 요청 = 학생 1명 × 한 달. 학생마다 마지막으로 받은 달(app_records.old_month)을 남기고 다음 차례에 그다음 달부터
--       달마다 받은 것은 app_old_parts(학생 · 달)에 통째로 바꿔 넣고 → app_records.old 를 그 학생의 모든 달로 다시 만든다(겹쳐 쌓이지 않음)
--       마지막 달(수강 시작일 앞 달)까지 받으면 old_at(끝) · old_status ok / empty
--    2. 실패는 그 달에서 멈추고 다음 학생으로 · 연속 실패(old_fails) 1번 10분 → 30분 → 1시간 … 6시간 뒤 다시 · 성공하면 0으로
--    3. 옛 기록은 밤 1~6시에도 돈다(함수가 정함 · 평소 동기화의 밤 쉼은 그대로)
--    4. 요청마다 걸린 시간 app_hub_calls(종류 old · sync · 학생 수 · 날짜 수 · ms · 성공 · 이유 코드 · 7일) — 이름 · 번호 · 열쇠 값 없음
--  확인: check-app-old-month-1113.sql
-- ============================================================

alter table public.app_records add column if not exists old_month date;            -- 마지막으로 받은 달(그 달 1일) · 비어 있으면 아직 한 달도 못 받음
alter table public.app_records add column if not exists old_fails integer not null default 0;   -- 연속 실패 수 (성공하면 0)
alter table public.app_records add column if not exists old_months integer not null default 0;  -- 받은 달 수

/* 달마다 받은 옛 기록 — 서버만 */
create table if not exists public.app_old_parts (
  student_id uuid not null references public.students(id) on delete cascade,
  month date not null,
  history jsonb not null default '[]'::jsonb,
  calendar jsonb not null default '[]'::jsonb,
  n integer not null default 0,
  got_n integer not null default 0,
  at timestamptz not null default now(),
  primary key (student_id, month)
);
alter table public.app_old_parts enable row level security;
revoke all on public.app_old_parts from public, anon, authenticated;
grant select, insert, update, delete on public.app_old_parts to service_role;

/* 요청마다 걸린 시간 — 숫자 · 이유 코드만 */
create table if not exists public.app_hub_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null default '',
  students integer not null default 0,
  days integer not null default 0,
  ms integer not null default 0,
  ok boolean not null default false,
  reason text not null default ''
);
create index if not exists app_hub_calls_at on public.app_hub_calls (at desc);
alter table public.app_hub_calls enable row level security;
revoke all on public.app_hub_calls from public, anon, authenticated;
grant select, insert, delete on public.app_hub_calls to service_role;
grant usage, select on sequence public.app_hub_calls_id_seq to service_role;

/* 요청 시간 저장 — [{ kind, students, days, ms, ok, reason }] 한 번에 여러 줄 · 7일 지난 줄은 지운다 */
create or replace function public.app_hub_log(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.app_hub_calls (kind, students, days, ms, ok, reason)
  select left(regexp_replace(coalesce(x ->> 'kind', ''), '[^a-z_]', '', 'g'), 12),
         greatest(0, least(1000, coalesce((x ->> 'students')::int, 0))),
         greatest(0, least(1000, coalesce((x ->> 'days')::int, 0))),
         greatest(0, least(600000, coalesce((x ->> 'ms')::int, 0))),
         coalesce((x ->> 'ok')::boolean, false),
         left(regexp_replace(coalesce(x ->> 'reason', ''), '[^a-z0-9_]', '', 'g'), 20)
    from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) x
   where jsonb_typeof(x) = 'object';
  get diagnostics n = row_count;
  delete from public.app_hub_calls where at < now() - interval '7 days';
  return n;
end;
$$;
revoke all on function public.app_hub_log(jsonb) from public, anon, authenticated;
grant execute on function public.app_hub_log(jsonb) to service_role;

/* 받을 차례 (105 를 고침) — 앱 id 가 있는 재원 학생 중 아직 끝나지 않은(old_at 없음) 학생
   연속 실패가 있으면 10분 · 30분 · 1시간 · 2시간 … 6시간 뒤 · 오래 안 해 본 학생부터 · 고르기만 하고 표시는 안 한다(저장할 때 남김)
   돌려주는 값 — id · uid · start(수강 시작일) · month(마지막으로 받은 달) */
create or replace function public.app_old_due2(p_limit integer default 40)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'uid', z.uid, 'start', z.start_on, 'month', z.old_month) order by z.ord nulls first, z.id), '[]'::jsonb)
    from (
      select s.id, l.app_user_id uid, s.start_on, r.old_month, r.old_try ord
        from public.students s
        join public.student_links l on l.student_id = s.id and l.app_user_id is not null
        left join public.app_records r on r.student_id = s.id
       where not s.archived
         and r.old_at is null
         and (coalesce(r.old_fails, 0) = 0 or r.old_try is null
              or r.old_try < now() - case when r.old_fails <= 1 then interval '10 minutes'
                                          else least(interval '6 hours', interval '30 minutes' * power(2, least(r.old_fails, 8) - 2)) end)
       order by r.old_try nulls first, s.id
       limit greatest(1, least(100, coalesce(p_limit, 40)))
    ) z;
$$;
revoke all on function public.app_old_due2(integer) from public, anon, authenticated;
grant execute on function public.app_old_due2(integer) to service_role;

/* 한 달 저장 — { id, status: 'month' | 'done' | 'fail', month, history, calendar, n, got_n, ms, err, from, to, got_first, classes, cut }
   month — 그 달을 통째로 바꿔 넣고 old_month = 그 달 · old 를 다시 만듦 · 연속 실패 0
   done  — (마지막 달까지 받음 · 또는 받을 달이 없음) old_at · old_status ok / empty
   fail  — 그 달은 그대로 · 이유 · 연속 실패 + 1 · old_status fail (old_at 비움 → 나중에 다시) */
create or replace function public.app_old_month_save(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; st text; mo date; d_got date; d_from date; d_to date; tot int; firstd date; cutv text;
begin
  if jsonb_typeof(p_row) <> 'object' or coalesce(p_row ->> 'id', '') !~ '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false); end if;
  sid := (p_row ->> 'id')::uuid;
  st := coalesce(p_row ->> 'status', '');
  mo := case when coalesce(p_row ->> 'month', '') ~ '^\d{4}-\d{2}-\d{2}$' then date_trunc('month', (p_row ->> 'month')::date)::date end;
  d_from := case when coalesce(p_row ->> 'from', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_row ->> 'from')::date end;
  d_to := case when coalesce(p_row ->> 'to', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_row ->> 'to')::date end;
  d_got := case when coalesce(p_row ->> 'got_first', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_row ->> 'got_first')::date end;
  cutv := case when coalesce(p_row ->> 'cut', '') ~ '^\d{4}-\d{2}-\d{2}$' then p_row ->> 'cut' else '' end;
  insert into public.app_records (student_id) values (sid) on conflict (student_id) do nothing;

  if st = 'fail' then
    update public.app_records set old_status = 'fail',
        old_err = left(regexp_replace(coalesce(p_row ->> 'err', ''), '[\r\n]+', ' ', 'g'), 160),
        old_try = now(), old_tries = old_tries + 1, old_fails = old_fails + 1
      where student_id = sid and old_at is null;
    return jsonb_build_object('ok', true, 'status', 'fail');
  end if;

  if st in ('month', 'done') and mo is not null then
    insert into public.app_old_parts (student_id, month, history, calendar, n, got_n, at)
    values (sid, mo,
            case when jsonb_typeof(p_row -> 'history') = 'array' then p_row -> 'history' else '[]'::jsonb end,
            case when jsonb_typeof(p_row -> 'calendar') = 'array' then p_row -> 'calendar' else '[]'::jsonb end,
            greatest(0, least(5000, coalesce((p_row ->> 'n')::int, 0))),
            greatest(0, least(100000, coalesce((p_row ->> 'got_n')::int, 0))), now())
    on conflict (student_id, month) do update set history = excluded.history, calendar = excluded.calendar, n = excluded.n, got_n = excluded.got_n, at = excluded.at;
  end if;

  /* 모든 달을 합쳐 old 다시 만들기 */
  select coalesce(sum(n), 0) into tot from public.app_old_parts where student_id = sid;
  select min(z.d) into firstd from (
    select left(h ->> 'submittedAt', 10)::date d from public.app_old_parts p, jsonb_array_elements(p.history) h
     where p.student_id = sid and coalesce(h ->> 'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select (c ->> 'date')::date from public.app_old_parts p, jsonb_array_elements(p.calendar) c
     where p.student_id = sid and c ->> 'status' in ('onTime', 'late') and coalesce(c ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
  ) z;
  update public.app_records r set
      old = case when tot > 0 then jsonb_build_object(
                 'history', coalesce((select jsonb_agg(h order by p.month) from public.app_old_parts p, jsonb_array_elements(p.history) h where p.student_id = sid), '[]'::jsonb),
                 'calendar', coalesce((select jsonb_agg(c order by p.month) from public.app_old_parts p, jsonb_array_elements(p.calendar) c where p.student_id = sid), '[]'::jsonb),
                 'cut', nullif(cutv, '')) end,
      old_n = tot, old_first = case when tot > 0 then firstd end,
      old_month = coalesce(mo, r.old_month),
      old_months = (select count(*) from public.app_old_parts p where p.student_id = sid),
      old_got_n = coalesce((select sum(got_n) from public.app_old_parts p where p.student_id = sid), 0)::int,
      old_got_first = case when d_got is not null and (r.old_got_first is null or d_got < r.old_got_first) then d_got else r.old_got_first end,
      old_from = coalesce(r.old_from, d_from), old_to = coalesce(d_to, r.old_to),
      old_classes = greatest(r.old_classes, greatest(0, least(100, coalesce((p_row ->> 'classes')::int, 0)))),
      old_err = '', old_fails = 0, old_try = now(), old_tries = r.old_tries + 1,
      old_status = case when st = 'done' then case when tot > 0 then 'ok' else 'empty' end else 'month' end,
      old_at = case when st = 'done' then now() else null end
    where r.student_id = sid;
  return jsonb_build_object('ok', true, 'status', st, 'n', tot);
end;
$$;
revoke all on function public.app_old_month_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_old_month_save(jsonb) to service_role;

/* 105 의 「실패」 학생(한 번에 10달을 묻다 timeout) — 한 달씩 다시 하도록 연속 실패 · 기다림을 비운다 (받은 기록은 건드리지 않음) */
update public.app_records set old_fails = 0, old_try = null, old_err = '', old_status = ''
 where old_at is null and old_status = 'fail' and old_month is null and old_fails = 0;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '마지막으로 받은 달 칸(app_records.old_month · old_fails)' as what, (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'old_month')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'old_fails'))::text as ok
union all select '달마다 옛 기록 표(app_old_parts)', (to_regclass('public.app_old_parts') is not null)::text
union all select '요청 시간 표(app_hub_calls)', (to_regclass('public.app_hub_calls') is not null)::text
union all select '함수(app_old_due2 · app_old_month_save · app_hub_log)', (to_regprocedure('public.app_old_due2(integer)') is not null and to_regprocedure('public.app_old_month_save(jsonb)') is not null and to_regprocedure('public.app_hub_log(jsonb)') is not null)::text;
