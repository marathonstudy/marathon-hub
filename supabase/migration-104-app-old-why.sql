-- ============================================================
--  migration-104-app-old-why.sql — 앱 옛 기록(2026-01-01부터) 한 번 채우기 · 앱 연결 못 찾은 이유 (20261111a)
--  (104 는 103 다음 · 102 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포)
--
--  1. 옛 기록 — 앱 학생 id 로 연결된 학생만(학생 기준 읽기 주소가 되는 학생 · app_records.src = 'user')
--     app-sync 가 한 번 2026-01-01 ~ 오늘을 받아(50명 · 400일 한도 안 · 분당 30회 한도 — 5분에 한두 번) 수강 시작일 앞 기록만 app_records.old 에 둔다
--     그 뒤로는 지금처럼 최근 것만(수강 시작일부터) · 옛 기록은 다시 받지 않는다(old_at) · 덮어쓰기라 겹쳐 쌓이지 않는다
--     화면이 저장본과 합칠 때도 같은 과제(제출 시각 + 제목) · 같은 날은 한 번만 센다
--     반영 — 📊 학습 분석 · ⚔️ 능력치(1년 보기) · 🏅 주간 · 월간 배지 칸(첫 기록 주부터 · 옛 주는 「채움」 · 문자 · 알림톡 배지 수에는 안 셈)
--     반영 안 함 — 경험치 · 레벨 · 퀘스트(수강 시작일부터 그대로) · 코치룸 수강 기간 · 과제 8주 · 상담
--  2. 앱 연결 못 찾은 이유 — 번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음 · 후보 여러 명 (app_link_why)
--     앱 응답만으로 가를 수 없으면 가장 가까운 것 + 짐작 표시(app_link_guess)
--     코치룸 「앱 연결 필요」 목록(app_link_need_list · 직원만 · 번호는 코치룸에만) · 번호를 고치면 다음 동기화(5분 안)에 다시 찾음(트리거)
--  학생 · 학부모 화면(러닝노트)으로 나가는 것 — 옛 과제 기록(제목 · 날짜 · 지각 · 정답률 · 영역별 맞힌 수)만. 번호 · 후보 · 이유는 안 나감
-- ============================================================

alter table public.student_links add column if not exists app_link_why text not null default '';
alter table public.student_links add column if not exists app_link_guess boolean not null default false;
alter table public.student_links add column if not exists app_link_note text not null default '';

alter table public.app_records add column if not exists old jsonb;
alter table public.app_records add column if not exists old_at timestamptz;
alter table public.app_records add column if not exists old_try timestamptz;
alter table public.app_records add column if not exists old_n integer not null default 0;
alter table public.app_records add column if not exists old_first date;

-- ------------------------------------------------------------
--  1. 옛 기록
-- ------------------------------------------------------------
/* 받을 차례 — 앱 id 로 받는 학생 중 옛 기록을 아직 안 받은 학생 · 실패하면 30분 뒤 다시 */
create or replace function public.app_old_due(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with pick as (
    select s.id, l.app_user_id uid, s.start_on
      from public.students s
      join public.student_links l on l.student_id = s.id and l.app_user_id is not null
      join public.app_records r on r.student_id = s.id and r.data is not null and r.src = 'user'
     where not s.archived and r.old_at is null and (r.old_try is null or r.old_try < now() - interval '30 minutes')
     order by r.old_try nulls first, s.id
     limit greatest(1, least(50, coalesce(p_limit, 50)))
  ), mark as (
    update public.app_records r set old_try = now() from pick p where r.student_id = p.id returning r.student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'uid', p.uid, 'start', p.start_on)), '[]'::jsonb) into out
    from pick p join mark m on m.student_id = p.id;
  return out;
end;
$$;
revoke all on function public.app_old_due(integer) from public, anon, authenticated;
grant execute on function public.app_old_due(integer) to service_role;

/* 받은 옛 기록 저장 — [{ id, old: { history, calendar }, n, first }] · 통째로 바꿔 넣는다(겹쳐 쌓이지 않음) · 옛 기록이 0개여도 「받음」으로 */
create or replace function public.app_old_save(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; n int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    sid := (r ->> 'id')::uuid;
    update public.app_records set
        old = case when jsonb_typeof(r -> 'old') = 'object' and coalesce((r ->> 'n')::int, 0) > 0 then r -> 'old' end,
        old_n = greatest(0, least(5000, coalesce((r ->> 'n')::int, 0))),
        old_first = case when coalesce(r ->> 'first', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'first')::date end,
        old_at = now(), old_try = null
      where student_id = sid;
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', n);
end;
$$;
revoke all on function public.app_old_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_old_save(jsonb) to service_role;

/* 옛 주 주간 배지 칸 — 수강 시작 주 앞의 주만(월~금 · 과제 수정값 · 면제 반영) · 빈 주에만 · filled(「채움」 · 문자 · 알림톡 배지 수에는 안 셈) */
create or replace function public.app_fill_old(p_student uuid, p_days jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; st date; cls text;
begin
  if p_student is null or jsonb_typeof(p_days) <> 'array' then return 0; end if;
  select s.start_on, coalesce(s.class_name, '') into st, cls from public.students s where s.id = p_student;
  if not found or st is null then return 0; end if;
  with d0 as (
    select (x ->> 'd')::date d, x ->> 's' s from jsonb_array_elements(p_days) x
     where coalesce(x ->> 'd', '') ~ '^\d{4}-\d{2}-\d{2}$' and x ->> 's' in ('onTime', 'late', 'none')
  ), d1 as (
    select d0.d, coalesce((select f.status from public.hw_fixes f where f.student_id = p_student and f.day = d0.d and f.status in ('onTime', 'late', 'none', 'exempt') order by f.fixed_at desc limit 1), d0.s) s
      from d0 where extract(isodow from d0.d) <= 5 and d0.d < st - (extract(isodow from st)::int - 1)
  ), wk as (
    select d - (extract(isodow from d)::int - 1) w, count(*) filter (where s in ('onTime', 'late')) dn, count(*) filter (where s in ('onTime', 'late', 'none')) tt
      from d1 group by 1
  ), ins as (
    insert into public.hw_weeks (student_id, week_start, lesson_day, class_name, done, total, perfect, filled)
    select p_student, w, w + 7, cls, dn, tt, dn >= tt, true from wk where tt > 0
    on conflict (student_id, week_start) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;
revoke all on function public.app_fill_old(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_fill_old(uuid, jsonb) to service_role;

/* 러닝노트 저장본 (102 와 같고) — 옛 기록(old)도 같이 · 화면이 분석 · 능력치 · 배지 칸에만 합친다(경험치 · 퀘스트는 안 씀) */
create or replace function public.hub_app_record(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; r public.app_records; uid bigint;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  select l.app_user_id into uid from public.student_links l where l.student_id = s.id;
  if coalesce(s.app_share_code, '') = '' and uid is null then return null; end if;
  select * into r from public.app_records where student_id = s.id;
  if not found then return null; end if;
  if r.fail_reason = 'expired' and uid is null then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if r.data is null or r.fetched_at is null then return null; end if;
  if r.fetched_at < now() - interval '48 hours' and (uid is null or coalesce(s.app_share_code, '') <> '') then return null; end if;
  return jsonb_build_object('ok', true, 'data', r.data, 'at', r.fetched_at,
                            'old', case when uid is not null and jsonb_typeof(r.old) = 'object' then r.old end);
end;
$$;
revoke all on function public.hub_app_record(text) from public;
grant execute on function public.hub_app_record(text) to anon, authenticated;

-- ------------------------------------------------------------
--  2. 앱 연결 못 찾은 이유
-- ------------------------------------------------------------
/* 찾을 차례 (102 를 고침) — 번호가 없는 학생도(앱에 묻지 않고 「번호 없음」으로) · 학부모 번호 2 도 · 하루 한 번 · 번호를 고치면 바로(트리거가 tried 를 비움) */
create or replace function public.app_link_due(p_limit integer default 20, p_students jsonb default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'phone', x.student_phone, 'parent', x.parent_phone, 'parent2', x.parent_phone2)), '[]'::jsonb) from (
    select s.id, s.name, coalesce(s.student_phone, '') student_phone, coalesce(s.parent_phone, '') parent_phone, coalesce(s.parent_phone2, '') parent_phone2
      from public.students s left join public.student_links l on l.student_id = s.id
     where not s.archived and l.app_user_id is null and btrim(coalesce(s.name, '')) <> ''
       and (case when jsonb_typeof(p_students) = 'array' then s.id::text in (select jsonb_array_elements_text(p_students))
                 else (l.app_link_tried is null or l.app_link_tried < now() - interval '1 day') end)
     order by l.app_link_tried nulls first, s.id
     limit greatest(1, least(50, coalesce(p_limit, 20)))
  ) x;
$$;
revoke all on function public.app_link_due(integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_link_due(integer, jsonb) to service_role;

/* 찾은 결과 (102 를 고침) — [{ id, ids:[앱 학생 id], why, guess, note, cands }]
   하나면 연결 · 여럿이면 「후보 여러 명」(후보) · 없으면 why(번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음) · 짐작이면 guess
   나온 id 가 모두 다른 학생에 이미 연결돼 있으면 「후보 여러 명」(짐작 · note 'taken') */
create or replace function public.app_link_save(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; raw bigint[]; ids bigint[]; cands bigint[]; w text; g boolean; nt text;
        n_ok int := 0; n_need int := 0; n_many int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    sid := (r ->> 'id')::uuid;
    if not exists (select 1 from public.students where id = sid) then continue; end if;
    insert into public.student_links (student_id) values (sid) on conflict (student_id) do nothing;
    raw := array(select distinct (x)::bigint u from jsonb_array_elements_text(case when jsonb_typeof(r -> 'ids') = 'array' then r -> 'ids' else '[]'::jsonb end) x where x ~ '^\d{1,18}$' order by u);
    ids := array(select u from unnest(raw) u where not exists (select 1 from public.student_links o where o.app_user_id = u and o.student_id <> sid) order by u);
    cands := array(select distinct (x)::bigint u from jsonb_array_elements_text(case when jsonb_typeof(r -> 'cands') = 'array' then r -> 'cands' else '[]'::jsonb end) x where x ~ '^\d{1,18}$'
                    and not exists (select 1 from public.student_links o where o.app_user_id = x::bigint and o.student_id <> sid) order by u);
    w := coalesce(r ->> 'why', '');
    if w not in ('no_phone', 'phone_mismatch', 'name_mismatch', 'no_account', 'many') then w := ''; end if;
    g := coalesce((r ->> 'guess')::boolean, false);
    nt := left(regexp_replace(coalesce(r ->> 'note', ''), '[^a-z_]', '', 'g'), 20);
    if array_length(ids, 1) = 1 then
      update public.student_links set app_user_id = ids[1], app_user_by = 'find', app_user_at = now(), app_link_state = 'ok', app_link_cands = '[]'::jsonb, app_link_tried = now(),
             app_link_why = '', app_link_guess = false, app_link_note = ''
       where student_id = sid and app_user_id is null;
      n_ok := n_ok + 1;
    elsif coalesce(array_length(ids, 1), 0) > 1 then
      update public.student_links set app_link_state = 'many', app_link_cands = to_jsonb(ids[1:10]), app_link_tried = now(),
             app_link_why = 'many', app_link_guess = false, app_link_note = ''
       where student_id = sid and app_user_id is null;
      n_many := n_many + 1;
    elsif coalesce(array_length(raw, 1), 0) > 0 then
      update public.student_links set app_link_state = 'need', app_link_cands = '[]'::jsonb, app_link_tried = now(),
             app_link_why = 'many', app_link_guess = true, app_link_note = 'taken'
       where student_id = sid and app_user_id is null;
      n_need := n_need + 1;
    else
      update public.student_links set app_link_state = 'need', app_link_cands = coalesce(to_jsonb(cands[1:5]), '[]'::jsonb), app_link_tried = now(),
             app_link_why = case when w = '' then 'no_account' else w end, app_link_guess = case when w = '' then true else g end, app_link_note = nt
       where student_id = sid and app_user_id is null;
      n_need := n_need + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'linked', n_ok, 'need', n_need, 'many', n_many);
end;
$$;
revoke all on function public.app_link_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_link_save(jsonb) to service_role;

/* 코치룸 — 학생 한 명 연결 상태 (102 와 같고 · 이유 · 짐작 · 옛 기록 수) */
create or replace function public.app_link_info(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else (
    select jsonb_build_object('uid', l.app_user_id, 'by', coalesce(l.app_user_by, ''), 'at', l.app_user_at, 'state', coalesce(l.app_link_state, ''),
                              'cands', coalesce(l.app_link_cands, '[]'::jsonb), 'tried', l.app_link_tried, 'fill', l.app_fill_at,
                              'why', coalesce(l.app_link_why, ''), 'guess', coalesce(l.app_link_guess, false), 'note', coalesce(l.app_link_note, ''),
                              'share', coalesce(l.app_share_code, '') <> '',
                              'src', (select r.src from public.app_records r where r.student_id = p_student),
                              'user_fail', (select nullif(r.user_fail, '') from public.app_records r where r.student_id = p_student),
                              'old_n', (select r.old_n from public.app_records r where r.student_id = p_student and r.old_at is not null),
                              'old_first', (select r.old_first from public.app_records r where r.student_id = p_student))
      from public.students s left join public.student_links l on l.student_id = s.id where s.id = p_student) end;
$$;
revoke all on function public.app_link_info(uuid) from public, anon;
grant execute on function public.app_link_info(uuid) to authenticated;

/* 코치룸 「앱 연결 필요」 목록 — 앱 id 가 없는 재원 학생 · 이유 · 후보 · 번호(직원 화면에만 · 러닝노트에는 이 함수가 없음) */
create or replace function public.app_link_need_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'class', coalesce(s.class_name, ''),
                                        'phone', coalesce(s.student_phone, ''), 'parent', coalesce(s.parent_phone, ''), 'parent2', coalesce(s.parent_phone2, ''),
                                        'state', coalesce(l.app_link_state, ''), 'why', coalesce(l.app_link_why, ''), 'guess', coalesce(l.app_link_guess, false),
                                        'note', coalesce(l.app_link_note, ''), 'cands', coalesce(l.app_link_cands, '[]'::jsonb), 'tried', l.app_link_tried)
                     order by coalesce(s.class_name, ''), s.name)
      from public.students s left join public.student_links l on l.student_id = s.id
     where not s.archived and l.app_user_id is null), '[]'::jsonb) end;
$$;
revoke all on function public.app_link_need_list() from public, anon;
grant execute on function public.app_link_need_list() to authenticated;

/* 코치룸 — 연결 결과 숫자 (102 와 같고 · 이유별 · 옛 기록) */
create or replace function public.app_link_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else (
    select jsonb_build_object(
      'students', count(*),
      'linked', count(*) filter (where l.app_user_id is not null),
      'by_share', count(*) filter (where l.app_user_by = 'share'),
      'by_find', count(*) filter (where l.app_user_by = 'find'),
      'by_staff', count(*) filter (where l.app_user_by = 'staff'),
      'need', count(*) filter (where l.app_user_id is null and l.app_link_state = 'need'),
      'many', count(*) filter (where l.app_user_id is null and l.app_link_state = 'many'),
      'notyet', count(*) filter (where l.app_user_id is null and coalesce(l.app_link_state, '') not in ('need', 'many')),
      'why', jsonb_build_object(
        'no_phone', count(*) filter (where l.app_user_id is null and l.app_link_why = 'no_phone'),
        'phone_mismatch', count(*) filter (where l.app_user_id is null and l.app_link_why = 'phone_mismatch'),
        'name_mismatch', count(*) filter (where l.app_user_id is null and l.app_link_why = 'name_mismatch'),
        'no_account', count(*) filter (where l.app_user_id is null and l.app_link_why = 'no_account'),
        'many', count(*) filter (where l.app_user_id is null and l.app_link_why = 'many'),
        'guess', count(*) filter (where l.app_user_id is null and l.app_link_why <> '' and l.app_link_guess)),
      'filled', count(*) filter (where l.app_fill_at is not null),
      'old', (select count(*) from public.app_records r join public.students s2 on s2.id = r.student_id and not s2.archived where r.old_n > 0),
      'user_fail', (select count(*) from public.app_records r join public.students s2 on s2.id = r.student_id and not s2.archived where r.user_fail <> ''))
      from public.students s left join public.student_links l on l.student_id = s.id where not s.archived) end;
$$;
revoke all on function public.app_link_status() from public, anon;
grant execute on function public.app_link_status() to authenticated;

/* 직원이 이름 · 번호를 고치면 — 아직 연결 안 된 학생은 다음 동기화(5분마다) 때 다시 찾기 */
create or replace function public._app_link_retry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.name, '') is distinct from coalesce(old.name, '')
     or coalesce(new.student_phone, '') is distinct from coalesce(old.student_phone, '')
     or coalesce(new.parent_phone, '') is distinct from coalesce(old.parent_phone, '')
     or coalesce(new.parent_phone2, '') is distinct from coalesce(old.parent_phone2, '') then
    update public.student_links set app_link_tried = null,
           app_link_state = case when app_link_state in ('need', 'many') then 'retry' else app_link_state end
     where student_id = new.id and app_user_id is null;
  end if;
  return new;
end;
$$;
revoke all on function public._app_link_retry() from public, anon, authenticated;
drop trigger if exists students_app_link_retry on public.students;
create trigger students_app_link_retry after update of name, student_phone, parent_phone, parent_phone2 on public.students
  for each row execute function public._app_link_retry();


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '옛 기록 칸(app_records.old)' as what, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'old')::text as ok
union all select '못 찾은 이유 칸(student_links.app_link_why)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_links' and column_name = 'app_link_why')::text
union all select '옛 기록 함수(app_old_due · app_old_save · app_fill_old)', (to_regprocedure('public.app_old_due(integer)') is not null and to_regprocedure('public.app_old_save(jsonb)') is not null and to_regprocedure('public.app_fill_old(uuid, jsonb)') is not null)::text
union all select '러닝노트 저장본에 옛 기록', (position('''old''' in pg_get_functiondef('public.hub_app_record(text)'::regprocedure)) > 0)::text
union all select '「앱 연결 필요」 목록(app_link_need_list)', (to_regprocedure('public.app_link_need_list()') is not null)::text
union all select '번호 고치면 다시 찾기(트리거)', exists (select 1 from pg_trigger where tgname = 'students_app_link_retry')::text;
