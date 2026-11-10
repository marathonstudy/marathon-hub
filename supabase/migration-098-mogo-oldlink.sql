-- ============================================================
--  migration-098-mogo-oldlink.sql — 모고 「옛 연결」 (20261110g)
--  (098 은 097 다음 · 089 · 091 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음 — mogo-sync 는 그대로, 저장하는 DB 함수만 바뀜)
--
--  왜 — 모고 사이트가 같은 학생 기록 2묶음을 하나로 합쳤다(2026-11-10 · 연동약속.md 버전 2 그대로 · 주소 · 응답 모양 그대로).
--       옛(잘못 입력한) 번호로 찾으면 이제 STUDENT_NOT_FOUND → 지금까지는 저장본이 「일치 없음」으로 덮여 받은 목록이 사라졌다.
--  1. mogo_save — 「연결됨」이던 학생이 「일치 없음」이 되면 받은 목록을 지우지 않고 extra.old 에 남긴다
--       extra.old = { reports, notebookUrl, at(끊긴 때) } · reason = 'oldlink' → 코치룸 「학생 없음(옛 번호)」
--     다음 받기(밤 23시 · ↻)도 그대로 「이름 + 학생 번호」 → 「이름 + 학부모 번호」로 찾는다 — 찾으면 새 기록으로 「연결됨」, extra.old 는 지우지 않고 남김
--     러닝노트(hub_mogo)는 「연결됨」의 목록 · 기록장 주소만 주므로 옛 연결은 학생 · 학부모에게 보이지 않는다
--  2. mogo_status — 숫자에 oldlink(학생 없음 · 옛 번호) 더함
--  학생 정보 · 모고 기록은 바꾸지 않는다 (함수만 바꿈) · 문자 · 알림톡 없음
-- ============================================================

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
            case when st = 'ok' and jsonb_typeof(r -> 'extra') = 'object' then (r -> 'extra') - 'old' else '{}'::jsonb end,
            case when (r ->> 'version') ~ '^\d{1,4}$' then (r ->> 'version')::int end,
            left(coalesce(r ->> 'reason', ''), 40), f, now(),
            case when st = 'error' and f <= 3 then now() + interval '10 minutes' else public._mogo_next_night(now()) end)
    on conflict (student_id) do update set
      state = case when excluded.state = 'error' then m.state else excluded.state end,
      reports = case when excluded.state = 'error' then m.reports else excluded.reports end,
      /* 옛 연결 — 연결됨(목록 있음) → 일치 없음이면 남김 · 이미 남긴 것은 계속 둠 */
      extra = case when excluded.state = 'error' then m.extra
                   when excluded.state = 'none' and m.state = 'ok' and jsonb_typeof(m.reports) = 'array' and jsonb_array_length(m.reports) > 0
                     then jsonb_build_object('old', jsonb_build_object('reports', m.reports, 'notebookUrl', coalesce(m.extra ->> 'notebookUrl', ''),
                                                                       'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD')))
                   when m.extra ? 'old' then excluded.extra || jsonb_build_object('old', m.extra -> 'old')
                   else excluded.extra end,
      version = coalesce(excluded.version, m.version),
      reason = case when excluded.state = 'none'
                     and ((m.state = 'ok' and jsonb_typeof(m.reports) = 'array' and jsonb_array_length(m.reports) > 0) or m.extra ? 'old')
                    then 'oldlink' else excluded.reason end,
      fails = excluded.fails,
      fetched_at = case when excluded.state = 'error' then m.fetched_at else excluded.fetched_at end, next_at = excluded.next_at;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mogo_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_save(jsonb) to service_role;

/* 코치룸 — 연결 상태 · 저장본 숫자 (oldlink 더함) */
create or replace function public.mogo_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then '{}'::jsonb else jsonb_build_object(
    'status', coalesce((select value from public.app_settings where key = 'mogo_status'), '{}'::jsonb),
    'counts', (select jsonb_build_object('ok', count(*) filter (where state = 'ok'), 'none', count(*) filter (where state = 'none' and not (extra ? 'old')),
                                         'oldlink', count(*) filter (where state = 'none' and extra ? 'old'),
                                         'nophone', count(*) filter (where state = 'nophone'), 'error', count(*) filter (where state = 'error'),
                                         'check', count(*) filter (where state = 'check'),
                                         'last', max(fetched_at))
                 from public.mogo_records)) end;
$$;
revoke all on function public.mogo_status() from public, anon;
grant execute on function public.mogo_status() to authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '모고 저장 — 옛 연결 남김(oldlink)' as what, (position('oldlink' in pg_get_functiondef('public.mogo_save(jsonb)'::regprocedure)) > 0)::text as ok
union all select '모고 숫자 — 학생 없음(옛 번호)', (position('oldlink' in pg_get_functiondef('public.mogo_status()'::regprocedure)) > 0)::text;
