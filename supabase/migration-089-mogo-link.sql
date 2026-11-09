-- ============================================================
--  migration-089-mogo-link.sql — 모의고사 분석 레포트(marathon-report) 연동 (20261109b · 연동약속.md 버전 2)
--  (089 는 088 다음 · 여러 번 실행해도 안전)
--
--  순서 — 1. Supabase → Edge Functions → Secrets 에 MOGO_HUB_KEY (값은 원장님이 직접 · 저장소 · 화면에는 없음)
--         2. Edge Function mogo-sync 배포 (Verify JWT 끄기)  3. 이 파일 실행
--
--  1. mogo_records — 학생마다 받아 둔 모의고사 목록 저장본 (과제 기록 저장본처럼 · 화면은 이것만 읽는다)
--       state: ok 찾음 · none 일치하는 학생 없음 · nophone 번호 없음 · error 한 번도 못 받음 · check 연결 확인 필요(애매해서 연결 안 함)
--         학생 찾기 — 학생 번호가 있으면 「이름 + 학생 번호」 · 없거나 못 찾으면 「이름 + 학부모 번호」(둘 다 맞아야)
--         check 이유(reason) — sibling 코치룸에 같은 이름 · 같은 번호 학생이 둘 이상 · multi 학부모 번호 1 · 2 가 서로 다른 모고 학생 · mixed 같은 시험 같은 차례가 두 번
--         못 받으면(error) 예전 결과 · 목록은 그대로 두고 fails · reason 만 바꾼다
--       reports: [{ id, examName, date, score, grade, done, closed, firstAttempt, attempt }] (약속한 항목만 · 모르는 항목은 버림)
--       extra: { notebookUrl, analysisUrl, typeCode, summary }
--     코치룸 · 러닝노트 브라우저는 모고 주소를 직접 부르지 않는다 — 함수 mogo-sync 만 부르고 여기 저장한다
--  2. 받을 차례 — 8시간마다(학생마다 몇 분씩 어긋나게) · 못 받으면 30분 · 1시간 · 2시간 … 6시간 · 번호가 없으면 하루 · 밤 1 ~ 6시 쉼
--  3. 연결 상태(app_settings 'mogo_status') — ok · down(연결 끊김) · badkey(키 틀림) · nokey(설정 필요) · 받은 연동 버전
--  4. 러닝노트 hub_mogo(코드) — 그 학생 링크로만 · 완성된 레포트(done)만 · 마감 여부 · 미완성은 안 보냄 · 다른 학생 정보 없음
--  5. 예약 — 20분마다 mogo-sync (한 번에 15명 · 천천히 · 모고 무료 한도 안)
-- ============================================================

-- ------------------------------------------------------------
--  1. 저장본
-- ------------------------------------------------------------
create table if not exists public.mogo_records (
  student_id  uuid primary key references public.students(id) on delete cascade,
  state       text not null default 'none',
  reports     jsonb not null default '[]'::jsonb,
  extra       jsonb not null default '{}'::jsonb,
  version     integer,
  reason      text not null default '',
  fails       integer not null default 0,
  fetched_at  timestamptz,
  next_at     timestamptz,
  constraint mogo_records_state check (state in ('ok', 'none', 'nophone', 'error', 'check'))
);
/* 예전 초안으로 만든 표도 check 를 받게 (여러 번 실행해도 안전) */
alter table public.mogo_records drop constraint if exists mogo_records_state;
alter table public.mogo_records add constraint mogo_records_state check (state in ('ok', 'none', 'nophone', 'error', 'check'));
create index if not exists mogo_records_next on public.mogo_records (next_at);
alter table public.mogo_records enable row level security;
drop policy if exists mogo_records_staff_read on public.mogo_records;
create policy mogo_records_staff_read on public.mogo_records for select to authenticated using (public.is_staff());
revoke all on public.mogo_records from anon;


-- ------------------------------------------------------------
--  2. 받을 차례 (mogo-sync · service_role)
-- ------------------------------------------------------------
/* 학생 한 명 — 함수에 넘길 것 (이름 · 학생 번호 · 학부모 번호 1 · 2 · 숫자만)
   dupPhone · dupParent1 · dupParent2 — 코치룸의 다른 (보관 안 된) 학생이 같은 이름(띄어쓰기 무시) + 같은 번호(뒤 8자리)
   → 모고에서 누구 기록인지 가를 수 없어 함수가 묻지 않고 「확인 필요」로 둔다 (이름이 다른 형제 · 자매는 상관없음) */
create or replace function public._mogo_d8(v text)
returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(v, ''), '\D', '', 'g')) >= 8 then right(regexp_replace(coalesce(v, ''), '\D', '', 'g'), 8) else '' end;
$$;
create or replace function public._mogo_row(s public.students)
returns jsonb language sql stable as $$
  with me as (select regexp_replace(coalesce(s.name, ''), '\s', '', 'g') nm, public._mogo_d8(s.student_phone) ph,
                     public._mogo_d8(s.parent_phone) p1, public._mogo_d8(s.parent_phone2) p2),
       o as (select public._mogo_d8(t.student_phone) ph, public._mogo_d8(t.parent_phone) p1, public._mogo_d8(t.parent_phone2) p2
               from public.students t, me
              where t.id <> s.id and not t.archived and regexp_replace(coalesce(t.name, ''), '\s', '', 'g') = me.nm)
  select jsonb_build_object('id', s.id, 'name', btrim(s.name),
    'phone', regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g'),
    'parent1', regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'),
    'parent2', regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g'),
    'dupPhone', me.ph <> '' and exists (select 1 from o where o.ph = me.ph),
    'dupParent1', me.p1 <> '' and exists (select 1 from o where me.p1 in (o.p1, o.p2)),
    'dupParent2', me.p2 <> '' and exists (select 1 from o where me.p2 in (o.p1, o.p2)))
  from me;
$$;
/* 안쪽 함수 — 바깥에서 부르지 못하게 (같은 이름 · 번호 학생이 있는지 엿보지 못하게) */
revoke all on function public._mogo_row(public.students) from public, anon, authenticated;
revoke all on function public._mogo_d8(text) from public, anon, authenticated;

create or replace function public.mogo_due(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
begin
  if k::time >= time '01:00' and k::time < time '06:00' then return jsonb_build_object('night', true, 'students', '[]'::jsonb); end if;
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

/* 코치룸 [↻] — 학생 id 목록 (["…", …]) */
create or replace function public.mogo_targets(p_students jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public._mogo_row(s)), '[]'::jsonb) from public.students s
   where not s.archived and s.id::text in (select jsonb_array_elements_text(case when jsonb_typeof(p_students) = 'array' then p_students else '[]'::jsonb end));
$$;
revoke all on function public.mogo_targets(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_targets(jsonb) to service_role;

/* 받은 것 저장 — [{ id, state, reports, extra, version, reason }] */
create or replace function public.mogo_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; st text; f int; jit int;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    if not exists (select 1 from public.students where id = (r ->> 'id')::uuid) then continue; end if;
    st := case when r ->> 'state' in ('ok', 'none', 'nophone', 'error', 'check') then r ->> 'state' else 'error' end;
    jit := abs(hashtext(r ->> 'id')) % 40;
    select fails into f from public.mogo_records where student_id = (r ->> 'id')::uuid;
    f := case when st = 'error' then coalesce(f, 0) + 1 else 0 end;
    insert into public.mogo_records as m (student_id, state, reports, extra, version, reason, fails, fetched_at, next_at)
    values ((r ->> 'id')::uuid, st,
            case when st = 'ok' and jsonb_typeof(r -> 'reports') = 'array' then r -> 'reports' else '[]'::jsonb end,
            case when st = 'ok' and jsonb_typeof(r -> 'extra') = 'object' then r -> 'extra' else '{}'::jsonb end,
            case when (r ->> 'version') ~ '^\d{1,4}$' then (r ->> 'version')::int end,
            left(coalesce(r ->> 'reason', ''), 40), f, now(),
            now() + case st when 'error' then make_interval(mins => least(360, 30 * (1 << least(f - 1, 4))))
                            when 'nophone' then interval '24 hours'
                            when 'check' then interval '24 hours'
                            else interval '8 hours' + make_interval(mins => jit) end)
    on conflict (student_id) do update set
      /* 못 받았으면 예전 결과(찾음 · 없음 · 확인 필요)와 받은 목록은 그대로 둔다 — 러닝노트는 예전 저장본을 계속 보여 준다 */
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


-- ------------------------------------------------------------
--  3. 연결 상태
-- ------------------------------------------------------------
create or replace function public.mogo_status_save(p jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.app_settings (key, value, updated_by) values ('mogo_status',
    jsonb_build_object('state', case when p ->> 'state' in ('ok', 'down', 'badkey', 'nokey') then p ->> 'state' else 'down' end,
                       'version', case when (p ->> 'version') ~ '^\d{1,4}$' then (p ->> 'version')::int end,
                       'at', now()), 'mogo-sync')
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'mogo-sync';
$$;
revoke all on function public.mogo_status_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_status_save(jsonb) to service_role;

/* 코치룸 — 연결 상태 · 저장본 숫자 */
create or replace function public.mogo_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then '{}'::jsonb else jsonb_build_object(
    'status', coalesce((select value from public.app_settings where key = 'mogo_status'), '{}'::jsonb),
    'counts', (select jsonb_build_object('ok', count(*) filter (where state = 'ok'), 'none', count(*) filter (where state = 'none'),
                                         'nophone', count(*) filter (where state = 'nophone'), 'error', count(*) filter (where state = 'error'),
                                         'check', count(*) filter (where state = 'check'),
                                         'last', max(fetched_at))
                 from public.mogo_records)) end;
$$;
revoke all on function public.mogo_status() from public, anon;
grant execute on function public.mogo_status() to authenticated;


-- ------------------------------------------------------------
--  4. 러닝노트 — 그 학생 링크로만 · 완성된 레포트만 (마감 여부 · 미완성은 안 보냄)
-- ------------------------------------------------------------
create or replace function public.hub_mogo(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; m public.mogo_records;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  select * into m from public.mogo_records where student_id = s.id and state = 'ok';
  if not found then return jsonb_build_object('reports', '[]'::jsonb); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'examName', x ->> 'examName', 'date', x ->> 'date',
                                                             'score', x -> 'score', 'grade', x -> 'grade', 'attempt', x -> 'attempt', 'firstAttempt', x -> 'firstAttempt')
                                          order by x ->> 'date' desc)
                           from jsonb_array_elements(m.reports) x where (x ->> 'done')::boolean is true), '[]'::jsonb),
    'notebookUrl', nullif(m.extra ->> 'notebookUrl', ''), 'analysisUrl', nullif(m.extra ->> 'analysisUrl', ''));
end;
$$;
revoke all on function public.hub_mogo(text) from public;
grant execute on function public.hub_mogo(text) to anon, authenticated;


-- ------------------------------------------------------------
--  5. 예약 — 20분마다 (함수 mogo-sync 를 먼저 배포 · 열쇠는 필기 알림과 같은 DB 값 · migration-050)
--     끄려면: select cron.unschedule('mogo-sync');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mogo-sync') then perform cron.unschedule('mogo-sync'); end if;
end;
$$;
select cron.schedule('mogo-sync', '7,27,47 * * * *', $job$
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
select '저장본 표(mogo_records)' as what, (to_regclass('public.mogo_records') is not null)::text as ok
union all select '직원만 읽음', (not has_table_privilege('anon', 'public.mogo_records', 'select'))::text
union all select '「확인 필요」 상태', exists (select 1 from pg_constraint where conname = 'mogo_records_state' and pg_get_constraintdef(oid) like '%''check''%')::text
union all select '러닝노트 함수(완성된 것만)', exists (select 1 from pg_proc where proname = 'hub_mogo')::text
union all select '20분마다 예약', exists (select 1 from cron.job where jobname = 'mogo-sync')::text;
