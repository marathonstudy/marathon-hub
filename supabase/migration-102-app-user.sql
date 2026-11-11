-- ============================================================
--  migration-102-app-user.sql — 앱 학생 기준으로 과제 기록 받기 · 지난 주간 배지 채움 (20261110m)
--  (102 는 101 다음 · 065 · 075 · 099 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포)
--
--  앱에 학생 기준 읽기 주소가 생겼다 (GET /api/hub/student-records · /api/hub/find-student · 서버 열쇠는 Supabase Secrets HUB_READ_KEY — DB 에는 없음)
--  1. 학생마다 앱 학생 id (student_links.app_user_id)
--     이미 공유 코드가 있는 학생 — app-sync 가 공유 응답의 student.id 로 저절로 (by share)
--     없으면 — find-student(이름 + 학생 번호 · 없으면 학부모 번호)로 (by find) · 하나만 나오면 연결 · 없음 「need」 · 여럿 「many」
--     못 찾은 학생 — 코치룸 학생 카드 「앱 연결 필요」 · 직접 넣기(by staff · app_link_set)
--  2. 받기 — 앱 id 가 있는 학생은 새 주소(반이 바뀌어도 그대로 · 반 여러 개는 날짜 기준으로 합침) · 없으면 예전 공유 코드
--     새 주소가 403 · 429 · 오류면 공유 코드로 받고 이유를 남김(app_records.user_fail) · 공유 코드도 없으면 실패로
--  3. 지난 주간 배지 채움 — 연결된 학생은 한 번(app_fill_at) 시작일부터 받은 기록으로 주(월~금)마다 셈 → 빈 주에만 hw_weeks(filled)
--     채운 주는 「채움」 표시 · 문자 · 알림톡에 쓰는 배지 수(_badge_count)에는 넣지 않는다 · 월간 배지는 그대로(원장이 보낸 달만)
--  공유 코드를 바꿔도 앱 id 로 연결된 학생의 기록은 지우지 않는다 (065 트리거)
-- ============================================================

alter table public.student_links add column if not exists app_user_id bigint;
alter table public.student_links add column if not exists app_user_by text not null default '';
alter table public.student_links add column if not exists app_user_at timestamptz;
alter table public.student_links add column if not exists app_link_state text not null default '';
alter table public.student_links add column if not exists app_link_cands jsonb not null default '[]'::jsonb;
alter table public.student_links add column if not exists app_link_tried timestamptz;
alter table public.student_links add column if not exists app_fill_at timestamptz;
create unique index if not exists student_links_app_user on public.student_links (app_user_id) where app_user_id is not null;

alter table public.app_records add column if not exists src text not null default '';
alter table public.app_records add column if not exists user_fail text not null default '';
alter table public.app_records add column if not exists user_fail_at timestamptz;

alter table public.hw_weeks add column if not exists filled boolean not null default false;

/* 공유 코드를 바꾸면 예전 기록을 지운다 — 앱 id 로 받는 학생은 그대로 (065 를 고침) */
create or replace function public._app_record_link_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.app_share_code, '') is distinct from coalesce(old.app_share_code, '') and new.app_user_id is null then
    delete from public.app_records where student_id = new.student_id;
  end if;
  return new;
end;
$$;

/* 문자 · 알림톡에 쓰는 배지 수 — 채운 주는 빼고 (예고 칭찬 끝 한 줄 · 운영진 과제 현황 · 루틴 목록) */
create or replace function public._badge_count(p_student uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.hw_weeks where student_id = p_student and perfect and not filled;
$$;
revoke all on function public._badge_count(uuid) from public, anon, authenticated;

/* 배지 모음 (099 와 같고) — perfect 는 채운 주까지 · filled 개수 · 주마다 filled 표시 */
create or replace function public._badge_box(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'perfect', (select count(*)::int from public.hw_weeks w where w.student_id = p_student and w.perfect),
    'filled', (select count(*)::int from public.hw_weeks w where w.student_id = p_student and w.perfect and w.filled),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', x.week_start, 'from', x.lesson_day - 7, 'to', x.lesson_day - 1, 'lesson', x.lesson_day,
                                                           'total', x.total, 'done', x.done, 'perfect', x.perfect, 'filled', x.filled) order by x.week_start)
                         from public.hw_weeks x where x.student_id = p_student), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(to_char(a.month, 'YYYY-MM') order by a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null), '[]'::jsonb),
    'start', coalesce((select s.start_on from public.students s where s.id = p_student)::text,
                      (select min(w.week_start) from public.hw_weeks w where w.student_id = p_student)::text, ''),
    'first', coalesce(least((select min(w.week_start) from public.hw_weeks w where w.student_id = p_student),
                            (select min(a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null))::text, ''),
    'cur', (select to_char(a.month, 'YYYY-MM') from public.routine_awards a
             where a.student_id = p_student and a.sent_at is not null and a.month = public._award_prev(now())),
    'kings', jsonb_build_object(
      'wrong', (select count(*) from public.king_weeks k where k.picked = p_student and k.status = 'picked' and k.kind = 'wrong'),
      'text', (select count(*) from public.king_weeks k where k.picked = p_student and k.status = 'picked' and k.kind = 'text'),
      'weeks', coalesce((select jsonb_agg(jsonb_build_object('lesson', k.lesson_day, 'kind', k.kind) order by k.lesson_day, k.kind)
                           from public.king_weeks k where k.picked = p_student and k.status = 'picked'), '[]'::jsonb)));
$$;
revoke all on function public._badge_box(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
--  받을 차례 · 새로고침 — 앱 id(uid)가 있으면 그것도 같이 (065 를 고침)
-- ------------------------------------------------------------
create or replace function public.app_sync_due(p_now timestamptz default now(), p_limit integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nw timestamptz := coalesce(p_now, now());
  kst timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  out jsonb;
begin
  if extract(hour from kst) >= 1 and extract(hour from kst) < 6 then
    return jsonb_build_object('night', true, 'students', '[]'::jsonb);
  end if;
  with act as (
    select distinct c.class_name, public._app_class_active(c.class_name, kst::date) as on_
      from (select distinct coalesce(class_name, '') class_name from public.students where not archived) c
  ), pick as (
    select s.id, l.app_share_code share, l.app_user_id uid, s.start_on, (l.app_user_id is not null and l.app_fill_at is null) fill, r.fetched_at
      from public.students s
      join public.student_links l on l.student_id = s.id and (l.app_share_code <> '' or l.app_user_id is not null)
      left join public.app_records r on r.student_id = s.id
      left join act a on a.class_name = coalesce(s.class_name, '')
     where not s.archived
       and case when r.next_try is not null then r.next_try <= nw
                when r.fetched_at is null then true
                else r.fetched_at <= nw - (case when coalesce(a.on_, false) then interval '30 minutes' else interval '24 hours' end) end
     order by (r.fetched_at is null) desc, r.fetched_at nulls first, s.id
     limit greatest(1, least(300, coalesce(p_limit, 60)))
  ), mark as (
    insert into public.app_records (student_id, next_try)
    select id, nw + interval '10 minutes' from pick
    on conflict (student_id) do update set next_try = excluded.next_try
    returning student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'share', p.share, 'uid', p.uid, 'start', p.start_on, 'fill', p.fill)), '[]'::jsonb) into out
    from pick p join mark m on m.student_id = p.id;
  return jsonb_build_object('night', false, 'students', out);
end;
$$;
revoke all on function public.app_sync_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.app_sync_due(timestamptz, integer) to service_role;

create or replace function public.app_sync_targets(p_students jsonb default null, p_class text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'share', x.share, 'uid', x.uid, 'start', x.start_on, 'fill', x.fill)), '[]'::jsonb) from (
    select s.id, l.app_share_code share, l.app_user_id uid, s.start_on, (l.app_user_id is not null and l.app_fill_at is null) fill
      from public.students s join public.student_links l on l.student_id = s.id and (l.app_share_code <> '' or l.app_user_id is not null)
     where not s.archived
       and ((jsonb_typeof(p_students) = 'array' and s.id::text in (select jsonb_array_elements_text(p_students)))
         or (coalesce(p_class, '') <> '' and s.class_name = p_class))
     order by s.id limit 60
  ) x;
$$;
revoke all on function public.app_sync_targets(jsonb, text) from public, anon, authenticated;
grant execute on function public.app_sync_targets(jsonb, text) to service_role;

/* 받은 결과 저장 (065 와 같고) — src(user · share) · user_fail(새 주소 실패 이유) · uid(공유 응답의 앱 학생 id → 아직 없으면 연결) */
create or replace function public.app_sync_save(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; okn int := 0; bad int := 0; why text; uf text; u bigint;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    sid := (r ->> 'id')::uuid;
    if not exists (select 1 from public.students where id = sid) then continue; end if;
    uf := left(coalesce(r ->> 'user_fail', ''), 40);
    if coalesce((r ->> 'ok')::boolean, false) then
      insert into public.app_records (student_id, data, lite, fetched_at, fail_reason, fail_at, fail_count, next_try, updated_at, src, user_fail, user_fail_at)
      values (sid, r -> 'data', r -> 'lite', now(), '', null, 0, null, now(), left(coalesce(r ->> 'src', ''), 10), uf, case when uf <> '' then now() end)
      on conflict (student_id) do update set data = excluded.data, lite = excluded.lite, fetched_at = now(),
        fail_reason = '', fail_at = null, fail_count = 0, next_try = null, updated_at = now(),
        src = excluded.src, user_fail = excluded.user_fail, user_fail_at = coalesce(excluded.user_fail_at, case when excluded.user_fail = '' then null else public.app_records.user_fail_at end);
      okn := okn + 1;
    else
      why := left(coalesce(r ->> 'reason', 'upstream'), 40);
      insert into public.app_records (student_id, fail_reason, fail_at, fail_count, next_try, updated_at, user_fail, user_fail_at)
      values (sid, why, now(), 1, now() + case when why = 'expired' then interval '24 hours' else interval '5 minutes' end, now(), uf, case when uf <> '' then now() end)
      on conflict (student_id) do update set fail_reason = why, fail_at = now(), fail_count = public.app_records.fail_count + 1,
        next_try = now() + case when why = 'expired' then interval '24 hours'
                                else least(interval '30 minutes', interval '5 minutes' * power(2, least(public.app_records.fail_count, 4))) end,
        updated_at = now(), user_fail = case when uf <> '' then uf else public.app_records.user_fail end,
        user_fail_at = case when uf <> '' then now() else public.app_records.user_fail_at end;
      bad := bad + 1;
    end if;
    /* 공유 응답의 앱 학생 id — 아직 연결 안 된 학생이고 다른 학생이 쓰지 않을 때만 */
    if coalesce(r ->> 'uid', '') ~ '^\d{1,18}$' then
      u := (r ->> 'uid')::bigint;
      update public.student_links l set app_user_id = u, app_user_by = 'share', app_user_at = now(), app_link_state = 'ok', app_link_cands = '[]'::jsonb
       where l.student_id = sid and l.app_user_id is null
         and not exists (select 1 from public.student_links o where o.app_user_id = u and o.student_id <> sid);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', okn, 'failed', bad);
end;
$$;
revoke all on function public.app_sync_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_sync_save(jsonb) to service_role;

-- ------------------------------------------------------------
--  학생 연결 — find-student (서버만) · 코치룸 직접 넣기 · 상태
-- ------------------------------------------------------------
/* 찾을 차례 — 아직 앱 id 가 없는 재원 학생 · 하루에 한 번 · 이름 · 번호는 서버(app-sync)에만 */
create or replace function public.app_link_due(p_limit integer default 20, p_students jsonb default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'phone', x.student_phone, 'parent', x.parent_phone)), '[]'::jsonb) from (
    select s.id, s.name, coalesce(s.student_phone, '') student_phone, coalesce(s.parent_phone, '') parent_phone
      from public.students s left join public.student_links l on l.student_id = s.id
     where not s.archived and l.app_user_id is null and btrim(coalesce(s.name, '')) <> ''
       and (coalesce(s.student_phone, '') <> '' or coalesce(s.parent_phone, '') <> '')
       and (case when jsonb_typeof(p_students) = 'array' then s.id::text in (select jsonb_array_elements_text(p_students))
                 else (l.app_link_tried is null or l.app_link_tried < now() - interval '1 day') end)
     order by l.app_link_tried nulls first, s.id
     limit greatest(1, least(50, coalesce(p_limit, 20)))
  ) x;
$$;
revoke all on function public.app_link_due(integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_link_due(integer, jsonb) to service_role;

/* 찾은 결과 — [{ id, ids:[앱 학생 id …], by: 'student' | 'parent' }] · 하나면 연결 · 없으면 need · 여럿이면 many(후보) */
create or replace function public.app_link_save(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; ids bigint[]; n_ok int := 0; n_need int := 0; n_many int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    sid := (r ->> 'id')::uuid;
    if not exists (select 1 from public.students where id = sid) then continue; end if;
    insert into public.student_links (student_id) values (sid) on conflict (student_id) do nothing;
    ids := array(select distinct (x)::bigint from jsonb_array_elements_text(case when jsonb_typeof(r -> 'ids') = 'array' then r -> 'ids' else '[]'::jsonb end) x where x ~ '^\d{1,18}$'
                  and not exists (select 1 from public.student_links o where o.app_user_id = x::bigint and o.student_id <> sid));
    if array_length(ids, 1) = 1 then
      update public.student_links set app_user_id = ids[1], app_user_by = 'find', app_user_at = now(), app_link_state = 'ok', app_link_cands = '[]'::jsonb, app_link_tried = now()
       where student_id = sid and app_user_id is null;
      n_ok := n_ok + 1;
    elsif coalesce(array_length(ids, 1), 0) = 0 then
      update public.student_links set app_link_state = 'need', app_link_cands = '[]'::jsonb, app_link_tried = now() where student_id = sid and app_user_id is null;
      n_need := n_need + 1;
    else
      update public.student_links set app_link_state = 'many', app_link_cands = to_jsonb(ids[1:10]), app_link_tried = now() where student_id = sid and app_user_id is null;
      n_many := n_many + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'linked', n_ok, 'need', n_need, 'many', n_many);
end;
$$;
revoke all on function public.app_link_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_link_save(jsonb) to service_role;

/* 코치룸 — 학생 한 명 연결 상태 (학생 카드 「앱 연결 필요」) */
create or replace function public.app_link_info(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else (
    select jsonb_build_object('uid', l.app_user_id, 'by', coalesce(l.app_user_by, ''), 'at', l.app_user_at, 'state', coalesce(l.app_link_state, ''),
                              'cands', coalesce(l.app_link_cands, '[]'::jsonb), 'tried', l.app_link_tried, 'fill', l.app_fill_at,
                              'share', coalesce(l.app_share_code, '') <> '',
                              'src', (select r.src from public.app_records r where r.student_id = p_student),
                              'user_fail', (select nullif(r.user_fail, '') from public.app_records r where r.student_id = p_student))
      from public.students s left join public.student_links l on l.student_id = s.id where s.id = p_student) end;
$$;
revoke all on function public.app_link_info(uuid) from public, anon;
grant execute on function public.app_link_info(uuid) to authenticated;

/* 코치룸 — 직접 넣기(앱 학생 번호) · 비우면 연결 풀기 · 다른 학생이 쓰는 번호는 안 됨 · 바뀌면 그 학생 저장본을 지우고 다시 받음 */
create or replace function public.app_link_set(p_student uuid, p_user bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old bigint;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.students where id = p_student) then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  if p_user is not null and (p_user <= 0 or exists (select 1 from public.student_links o where o.app_user_id = p_user and o.student_id <> p_student)) then
    return jsonb_build_object('ok', false, 'reason', case when p_user <= 0 then 'input' else 'taken' end);
  end if;
  insert into public.student_links (student_id) values (p_student) on conflict (student_id) do nothing;
  select app_user_id into old from public.student_links where student_id = p_student;
  update public.student_links set app_user_id = p_user, app_user_by = case when p_user is null then '' else 'staff' end, app_user_at = now(),
         app_link_state = case when p_user is null then 'need' else 'ok' end, app_link_cands = '[]'::jsonb, app_fill_at = null
   where student_id = p_student;
  if old is distinct from p_user then
    delete from public.app_records where student_id = p_student;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_link_set(uuid, bigint) from public, anon;
grant execute on function public.app_link_set(uuid, bigint) to authenticated;

/* 코치룸 — 연결 결과 숫자 (재원 학생) */
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
      'filled', count(*) filter (where l.app_fill_at is not null),
      'user_fail', (select count(*) from public.app_records r join public.students s2 on s2.id = r.student_id and not s2.archived where r.user_fail <> ''))
      from public.students s left join public.student_links l on l.student_id = s.id where not s.archived) end;
$$;
revoke all on function public.app_link_status() from public, anon;
grant execute on function public.app_link_status() to authenticated;

-- ------------------------------------------------------------
--  지난 주간 배지 채움 — 받은 날짜별 기록 [{ d, s }] → 주(월~금)마다 · 과제 수정값 · 수강 시작일 · 면제 반영
--  이번 주는 셈하지 않는다(수업 전 예고가 셈) · 이미 있는 주는 그대로 · 채운 주는 filled · 문자 · 알림톡 없음
-- ------------------------------------------------------------
create or replace function public.app_fill_save(p_student uuid, p_days jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; st date; cls text; mon date := (now() at time zone 'Asia/Seoul')::date - (extract(isodow from (now() at time zone 'Asia/Seoul')::date)::int - 1);
begin
  if p_student is null or jsonb_typeof(p_days) <> 'array' then return 0; end if;
  select s.start_on, coalesce(s.class_name, '') into st, cls from public.students s where s.id = p_student;
  if not found then return 0; end if;
  with d0 as (
    select (x ->> 'd')::date d, x ->> 's' s from jsonb_array_elements(p_days) x
     where coalesce(x ->> 'd', '') ~ '^\d{4}-\d{2}-\d{2}$' and x ->> 's' in ('onTime', 'late', 'none')
  ), d1 as (
    select d0.d, coalesce((select f.status from public.hw_fixes f where f.student_id = p_student and f.day = d0.d and f.status in ('onTime', 'late', 'none', 'exempt') order by f.fixed_at desc limit 1), d0.s) s
      from d0 where extract(isodow from d0.d) <= 5 and d0.d < mon and (st is null or d0.d >= st)
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
  update public.student_links set app_fill_at = now() where student_id = p_student;
  return n;
end;
$$;
revoke all on function public.app_fill_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_fill_save(uuid, jsonb) to service_role;

/* 러닝노트 저장본 — 앱 id 로만 받는 학생(공유 코드 없음)도 · 이틀이 넘어도 앱 id 학생은 저장본 그대로 (공유 코드로 다시 물을 수 없음) */
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
  return jsonb_build_object('ok', true, 'data', r.data, 'at', r.fetched_at);
end;
$$;
revoke all on function public.hub_app_record(text) from public;
grant execute on function public.hub_app_record(text) to anon, authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '앱 학생 id 칸(student_links.app_user_id)' as what, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_links' and column_name = 'app_user_id')::text as ok
union all select '채운 주 표시(hw_weeks.filled)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hw_weeks' and column_name = 'filled')::text
union all select '문자 배지 수에 채운 주 안 셈', (position('not filled' in pg_get_functiondef('public._badge_count(uuid)'::regprocedure)) > 0)::text
union all select '받을 차례에 앱 id', (position('app_user_id' in pg_get_functiondef('public.app_sync_due(timestamptz, integer)'::regprocedure)) > 0)::text
union all select '연결 함수(app_link_save · app_link_set · app_link_status)', (to_regprocedure('public.app_link_save(jsonb)') is not null and to_regprocedure('public.app_link_set(uuid, bigint)') is not null and to_regprocedure('public.app_link_status()') is not null)::text
union all select '지금 연결 ' || (select count(*) from public.student_links l join public.students s on s.id = l.student_id and not s.archived where l.app_user_id is not null) || '명', 'true';
