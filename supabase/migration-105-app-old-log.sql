-- ============================================================
--  migration-105-app-old-log.sql — 앱 옛 기록 받기 결과 남기기 · 동기화 기록 (20261111b)
--  (105 는 104 다음 · 104 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포)
--
--  왜 — 104 뒤 옛 기록이 한 명도 안 받아졌는데(old_at 0명) 아무 기록이 없어 이유를 알 수 없었다.
--    ① 받을 학생 고르기(app_old_due)가 「앱 학생 기준 주소로 받은 학생(app_records.src = 'user')」만 골랐다
--       → 공유 코드로 받는 학생 · 학생 기준 주소가 실패한 학생은 앱 id 가 있어도 한 번도 안 골라짐
--    ② 고르기 · 저장 · 받기가 실패해도 함수가 조용히 넘어갔다(.catch → 빈 목록) · 실패한 묶음은 아무것도 안 남겼다
--  고친 것
--    1. app_old_due — 앱 id 가 있는 재원 학생 모두(받기 방법 · 저장본과 상관없이) · 실패하면 30분 · 1시간 · 2시간 … 6시간까지 늘려 다시
--    2. 학생별 결과 — app_records.old_status(ok 옛 기록 받음 · empty 받았지만 수강 시작일 앞 기록 없음 · none 앱이 이 학생 기록을 안 줌 · fail 실패)
--       · old_err(실패 이유) · old_from ~ old_to(요청한 기간) · old_got_first(앱이 실제로 준 가장 이른 날짜) · old_got_n(받은 과제 수)
--       · old_classes(받은 반 수) · old_tries(해 본 횟수) · old_try(마지막으로 해 본 시각)
--       → 「앱이 지금 반 기간만 준다」면 old_got_first 가 수강 시작일 뒤로 나온다 (요청은 2026-01-01부터)
--    3. 동기화 기록 app_sync_runs — 5분마다 · [새로고침] 한 번마다 숫자만(받은 수 · 실패 이유 · 옛 기록 · 찾기 · 앱 열쇠가 있는지 true/false)
--       학생 이름 · 번호 · 열쇠 값은 넣지 않는다 · 7일 지난 줄은 지운다 · 직원 · 학생 화면에서는 못 읽음(서버 · SQL 편집기만)
-- ============================================================

alter table public.app_records add column if not exists old_status text not null default '';
alter table public.app_records add column if not exists old_err text not null default '';
alter table public.app_records add column if not exists old_from date;
alter table public.app_records add column if not exists old_to date;
alter table public.app_records add column if not exists old_got_first date;
alter table public.app_records add column if not exists old_got_n integer not null default 0;
alter table public.app_records add column if not exists old_classes integer not null default 0;
alter table public.app_records add column if not exists old_tries integer not null default 0;

/* 동기화 기록 — 숫자만 */
create table if not exists public.app_sync_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null default '',
  hub boolean not null default false,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists app_sync_runs_at on public.app_sync_runs (at desc);
alter table public.app_sync_runs enable row level security;
revoke all on public.app_sync_runs from public, anon, authenticated;
grant select, insert, delete on public.app_sync_runs to service_role;
grant usage, select on sequence public.app_sync_runs_id_seq to service_role;

create or replace function public.app_sync_log(p_kind text, p_sum jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_sync_runs (kind, hub, summary)
  values (left(regexp_replace(coalesce(p_kind, ''), '[^a-z_]', '', 'g'), 20),
          coalesce((p_sum ->> 'hub')::boolean, false),
          case when jsonb_typeof(p_sum) = 'object' then p_sum else '{}'::jsonb end);
  delete from public.app_sync_runs where at < now() - interval '7 days';
end;
$$;
revoke all on function public.app_sync_log(text, jsonb) from public, anon, authenticated;
grant execute on function public.app_sync_log(text, jsonb) to service_role;

/* 받을 차례 (104 를 고침) — 앱 id 가 있는 재원 학생 모두 · 아직 안 받았거나 실패한 학생 · 실패하면 30분 → 1시간 → 2시간 … 6시간 */
create or replace function public.app_old_due(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with pick as (
    select s.id, l.app_user_id uid, s.start_on
      from public.students s
      join public.student_links l on l.student_id = s.id and l.app_user_id is not null
      left join public.app_records r on r.student_id = s.id
     where not s.archived
       and r.old_at is null
       and (r.old_try is null
            or r.old_try < now() - least(interval '6 hours', interval '30 minutes' * power(2, greatest(0, least(coalesce(r.old_tries, 0), 8) - 1))))
     order by r.old_try nulls first, s.id
     limit greatest(1, least(50, coalesce(p_limit, 50)))
  ), mark as (
    insert into public.app_records (student_id, old_try)
    select id, now() from pick
    on conflict (student_id) do update set old_try = excluded.old_try
    returning student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'uid', p.uid, 'start', p.start_on)), '[]'::jsonb) into out
    from pick p join mark m on m.student_id = p.id;
  return out;
end;
$$;
revoke all on function public.app_old_due(integer) from public, anon, authenticated;
grant execute on function public.app_old_due(integer) to service_role;

/* 받은 결과 저장 (104 를 고침) — [{ id, status, err, old, n, first, from, to, got_first, got_n, classes }]
   ok · empty · none — 「받음」(old_at · 다시 안 물음) · 옛 기록은 통째로 바꿔 넣는다(겹쳐 쌓이지 않음)
   fail — 받지 못함(old_at 그대로 비움 · 이유 · 시각 · 횟수만 · 다음 차례에 다시) */
create or replace function public.app_old_save(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; st text; n int := 0; bad int := 0;
  d_from date; d_to date; d_got date; d_first date;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    sid := (r ->> 'id')::uuid;
    st := coalesce(r ->> 'status', '');
    if st not in ('ok', 'empty', 'none', 'fail') then st := case when coalesce((r ->> 'n')::int, 0) > 0 then 'ok' else 'empty' end; end if;
    d_from := case when coalesce(r ->> 'from', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'from')::date end;
    d_to := case when coalesce(r ->> 'to', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'to')::date end;
    d_got := case when coalesce(r ->> 'got_first', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'got_first')::date end;
    d_first := case when coalesce(r ->> 'first', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'first')::date end;
    if st = 'fail' then
      update public.app_records set
          old_status = 'fail', old_err = left(regexp_replace(coalesce(r ->> 'err', ''), '[\r\n]+', ' ', 'g'), 160),
          old_from = coalesce(d_from, old_from), old_to = coalesce(d_to, old_to),
          old_try = now(), old_tries = old_tries + 1
        where student_id = sid and old_at is null;
      if found then bad := bad + 1; end if;
    else
      update public.app_records set
          old = case when st = 'ok' and jsonb_typeof(r -> 'old') = 'object' and coalesce((r ->> 'n')::int, 0) > 0 then r -> 'old' end,
          old_n = case when st = 'ok' then greatest(0, least(5000, coalesce((r ->> 'n')::int, 0))) else 0 end,
          old_first = case when st = 'ok' then d_first end,
          old_status = st, old_err = '',
          old_from = d_from, old_to = d_to, old_got_first = d_got,
          old_got_n = greatest(0, least(100000, coalesce((r ->> 'got_n')::int, 0))),
          old_classes = greatest(0, least(100, coalesce((r ->> 'classes')::int, 0))),
          old_at = now(), old_try = now(), old_tries = old_tries + 1
        where student_id = sid;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', n, 'failed', bad);
end;
$$;
revoke all on function public.app_old_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_old_save(jsonb) to service_role;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '옛 기록 결과 칸(app_records.old_status · old_got_first)' as what, (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'old_status')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'old_got_first'))::text as ok
union all select '동기화 기록 표(app_sync_runs)', (to_regclass('public.app_sync_runs') is not null)::text
union all select '동기화 기록 함수(app_sync_log)', (to_regprocedure('public.app_sync_log(text, jsonb)') is not null)::text
union all select '받을 학생 — 받기 방법과 상관없이 앱 id 학생 모두', (position('src' in pg_get_functiondef('public.app_old_due(integer)'::regprocedure)) = 0)::text
union all select '실패도 학생별로 남김(app_old_save fail)', (position('''fail''' in pg_get_functiondef('public.app_old_save(jsonb)'::regprocedure)) > 0)::text;
