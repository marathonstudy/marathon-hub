-- ============================================================
--  migration-091-mogo-nightly.sql — 모의고사 기록 받기를 하루 한 번(밤 23시)으로 (20261109c)
--  (091 은 090 다음 · 089 가 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음 — mogo-sync 그대로)
--
--  왜 — 089 는 20분마다 15명씩 · 학생마다 8시간마다라서, 학생이 많으면 한 바퀴 도는 데 오래 걸리고
--       처음 몇 시간 동안은 일부 학생(예: 46명 중 16명)만 받아져 있었다
--  1. 매일 밤 23:00 ~ 23:55 (한국 시간) 5분마다 한 번씩 · 한 번에 15명 · 천천히 (12번 = 180명까지 · 모고 무료 한도 안)
--       재원 중인 모든 학생이 대상 (보관 · 퇴원 학생 빼고) · 일치 없음 · 번호 없음 · 확인 필요 학생도 하루 한 번 다시
--       밤 쉬기(1 ~ 6시) 규칙은 쓰지 않는다
--  2. 다음 차례 — 받으면(찾음 · 없음 · 번호 없음 · 확인 필요) 다음 밤 22:55 · 못 받으면 10분 뒤(그 밤 안에 다시) · 세 번 넘게 못 받으면 다음 밤
--     코치룸 ↻ · 반 카드 [모고 기록 지금 받기]로 받은 학생도 같은 규칙 (그날 밤에는 다시 받지 않음 — 1시간 안에 받았으면 다음 밤)
--  3. 20분마다 예약(mogo-sync)은 없애고 밤 예약(mogo-sync-night)으로 바꾼다
-- ============================================================

-- ------------------------------------------------------------
--  1. 다음 밤 22:55 (한국 시간) — 지금부터 1시간 안이면 그다음 밤
-- ------------------------------------------------------------
create or replace function public._mogo_next_night(p_now timestamptz)
returns timestamptz language sql stable as $$
  select case when x.t <= coalesce(p_now, now()) + interval '1 hour' then x.t + interval '1 day' else x.t end
    from (select (((coalesce(p_now, now()) at time zone 'Asia/Seoul')::date + time '22:55') at time zone 'Asia/Seoul') t) x;
$$;
revoke all on function public._mogo_next_night(timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------
--  2. 받을 차례 — 밤 쉬기 없음 · 다음 차례가 된 학생 (재원 중 모두)
-- ------------------------------------------------------------
create or replace function public.mogo_due(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('night', false, 'students', coalesce((
    select jsonb_agg(public._mogo_row(s) order by r.next_at nulls first, s.name)
      from public.students s left join public.mogo_records r on r.student_id = s.id
     where s.id in (select s2.id from public.students s2 left join public.mogo_records r2 on r2.student_id = s2.id
                     where not s2.archived and btrim(coalesce(s2.name, '')) <> '' and (r2.student_id is null or r2.next_at is null or r2.next_at <= coalesce(p_now, now()))
                     order by r2.next_at nulls first, s2.name limit greatest(1, least(coalesce(p_limit, 15), 40)))), '[]'::jsonb));
end;
$$;
revoke all on function public.mogo_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mogo_due(timestamptz, integer) to service_role;

/* 받은 것 저장 — 다음 차례만 바뀐다 (089 와 같음 · next_at 규칙만 하루 한 번으로) */
create or replace function public.mogo_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; st text; f int;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    if not exists (select 1 from public.students where id = (r ->> 'id')::uuid) then continue; end if;
    st := case when r ->> 'state' in ('ok', 'none', 'nophone', 'error', 'check') then r ->> 'state' else 'error' end;
    select fails into f from public.mogo_records where student_id = (r ->> 'id')::uuid;
    f := case when st = 'error' then coalesce(f, 0) + 1 else 0 end;
    insert into public.mogo_records as m (student_id, state, reports, extra, version, reason, fails, fetched_at, next_at)
    values ((r ->> 'id')::uuid, st,
            case when st = 'ok' and jsonb_typeof(r -> 'reports') = 'array' then r -> 'reports' else '[]'::jsonb end,
            case when st = 'ok' and jsonb_typeof(r -> 'extra') = 'object' then r -> 'extra' else '{}'::jsonb end,
            case when (r ->> 'version') ~ '^\d{1,4}$' then (r ->> 'version')::int end,
            left(coalesce(r ->> 'reason', ''), 40), f, now(),
            case when st = 'error' and f <= 3 then now() + interval '10 minutes' else public._mogo_next_night(now()) end)
    on conflict (student_id) do update set
      state = case when excluded.state = 'error' then m.state else excluded.state end,
      reports = case when excluded.state = 'error' then m.reports else excluded.reports end,
      extra = case when excluded.state = 'error' then m.extra else excluded.extra end,
      version = coalesce(excluded.version, m.version), reason = excluded.reason, fails = excluded.fails,
      fetched_at = case when excluded.state = 'error' then m.fetched_at else excluded.fetched_at end, next_at = excluded.next_at;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mogo_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_save(jsonb) to service_role;

/* 이미 저장된 학생도 오늘 밤부터 새 규칙으로 (다음 차례가 내일 이후로 밀려 있으면 오늘 밤으로) */
update public.mogo_records set next_at = least(coalesce(next_at, now()), public._mogo_next_night(now() - interval '2 hours'));


-- ------------------------------------------------------------
--  3. 예약 — 20분마다(mogo-sync) 없애고 밤 23:00 ~ 23:55 5분마다(mogo-sync-night)
--     pg_cron 은 UTC — 한국 23시 = UTC 14시
--     끄려면: select cron.unschedule('mogo-sync-night');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mogo-sync') then perform cron.unschedule('mogo-sync'); end if;
  if exists (select 1 from cron.job where jobname = 'mogo-sync-night') then perform cron.unschedule('mogo-sync-night'); end if;
end;
$$;
select cron.schedule('mogo-sync-night', '*/5 14 * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/mogo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '20분마다 예약 없앰' as what, (not exists (select 1 from cron.job where jobname = 'mogo-sync'))::text as ok
union all select '밤 23시 예약(한국 시간 · 5분마다 12번)', exists (select 1 from cron.job where jobname = 'mogo-sync-night' and schedule = '*/5 14 * * *')::text
union all select '밤 쉬기 없음 · 재원 학생 모두', (position('01:00' in pg_get_functiondef('public.mogo_due(timestamptz, integer)'::regprocedure)) = 0)::text
union all select '오늘 밤 받을 학생 ' || (select count(*) from public.students s where not s.archived and btrim(coalesce(s.name, '')) <> '') || '명', 'true';
