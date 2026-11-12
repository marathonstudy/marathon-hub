-- ============================================================
--  migration-107-online-class.sql — 온라인 반 · 앱 반에서 학생 가져오기 · 온라인 반 발송 막기 (20261113b)
--  (107 은 106 다음 · 여러 번 실행해도 안전 · 그다음 함수 app-sync · sms-send · kakao-send · note-remind 다시 배포)
--
--  1. 반 종류 — classes.kind ('' 현강 · 'online' 온라인)
--     온라인 반은 수업 시간 · 상담 · 모의고사가 기본으로 꺼짐(use_time · use_consult · use_mogo) · 과제 · 학습 분석 · 능력치 · 배지 · 게임 홈은 현강과 같음
--     send_on — 문자 · 알림톡 · 링크 발송 (온라인 반은 원장님이 켜기 전까지 false)
--  2. 앱 반에서 학생 가져오기 — 미리보기(app_roster_preview) → [가져오기](app_roster_import)
--     앱 학생 id 로 바로 연결 · 이미 연결된 학생(현강 등)은 학생을 새로 만들지 않고 반만 더함(class_members)
--     겹침 의심(앱 id 는 없지만 이름 + 번호 또는 이름이 같은 재원 학생)은 넣지 않고 목록만 보여 줌 → 학생 카드에서 직접 연결
--  3. 발송 막기 — send_quiet(): 발송이 꺼진 온라인 반 학생 id · 그 학생들만 쓰는 번호 (서버만)
--     문자 · 알림톡 · 자동 알림 함수가 보내기 직전에 이 목록을 빼고 보낸다(「온라인 반 · 발송 꺼짐」)
--  4. 모의고사 받기(mogo_due) — 모의고사가 꺼진 반 학생은 뺀다
-- ============================================================

alter table public.classes add column if not exists kind text not null default '';
alter table public.classes add column if not exists use_time boolean not null default true;
alter table public.classes add column if not exists use_consult boolean not null default true;
alter table public.classes add column if not exists use_mogo boolean not null default true;
alter table public.classes add column if not exists send_on boolean not null default true;
alter table public.classes add column if not exists app_class_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_kind_check') then
    alter table public.classes add constraint classes_kind_check check (kind in ('', 'online'));
  end if;
end $$;

/* 이미 다른 반에 있는 학생을 온라인 반에도 (학생 class_name 은 그대로 · 반만 더함) */
create table if not exists public.class_members (
  class_name text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  app_class_id bigint,
  added_by text not null default '',
  added_at timestamptz not null default now(),
  primary key (class_name, student_id)
);
alter table public.class_members enable row level security;
revoke all on public.class_members from public, anon;
grant select on public.class_members to authenticated;
drop policy if exists class_members_staff_read on public.class_members;
create policy class_members_staff_read on public.class_members for select to authenticated using (public.is_staff());
grant select, insert, update, delete on public.class_members to service_role;

/* 반 종류 · 켜고 끄기 — 직원만 · 온라인으로 바꾸면 수업 시간 · 상담 · 모의고사 · 발송을 끈 채로 시작(그 뒤 바꿀 수 있음)
   수업 시간을 끄면 필기 알림 · 수업 전 예고도 끈다 */
create or replace function public.class_kind_set(p_class text, p_kind text, p_time boolean default null, p_consult boolean default null, p_mogo boolean default null, p_send boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.classes; k text := case when p_kind = 'online' then 'online' else '' end; was text;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  select * into c from public.classes where name = p_class;
  if not found then raise exception '‘%’ 반이 없습니다', p_class; end if;
  was := c.kind;
  update public.classes set kind = k,
      use_time = coalesce(p_time, case when k = 'online' and was <> 'online' then false when k = '' and was = 'online' then true else use_time end),
      use_consult = coalesce(p_consult, case when k = 'online' and was <> 'online' then false when k = '' and was = 'online' then true else use_consult end),
      use_mogo = coalesce(p_mogo, case when k = 'online' and was <> 'online' then false when k = '' and was = 'online' then true else use_mogo end),
      send_on = coalesce(p_send, case when k = 'online' and was <> 'online' then false when k = '' and was = 'online' then true else send_on end)
    where name = p_class
    returning * into c;
  if not c.use_time then
    update public.classes set note_remind = false where name = p_class;
    begin
      execute 'update public.classes set pre_remind = false where name = $1' using p_class;      -- 056 전이면 칸이 없음
    exception when undefined_column then null; end;
  end if;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'use_time', c.use_time, 'use_consult', c.use_consult, 'use_mogo', c.use_mogo, 'send_on', c.send_on);
end;
$$;
revoke all on function public.class_kind_set(text, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.class_kind_set(text, text, boolean, boolean, boolean, boolean) to authenticated;

/* 반마다 종류 · 켜고 끄기 · 더한 학생 수 (직원 화면) */
create or replace function public.class_kinds()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'use_time', c.use_time, 'use_consult', c.use_consult, 'use_mogo', c.use_mogo,
                                                       'send_on', c.send_on, 'app_class_id', c.app_class_id,
                                                       'members', (select count(*) from public.class_members m join public.students s on s.id = m.student_id and not s.archived where m.class_name = c.name))
                                    order by c.name)
                     from public.classes c), '[]'::jsonb);
end;
$$;
revoke all on function public.class_kinds() from public, anon;
grant execute on function public.class_kinds() to authenticated;

/* 학생마다 — 그 학생 반의 종류 · 켜고 끄기 (학생 카드가 상담 · 모의고사 칸을 숨길 때) · 직원만 */
create or replace function public.student_class_opts(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else (
    select jsonb_build_object('kind', coalesce(c.kind, ''), 'use_time', coalesce(c.use_time, true), 'use_consult', coalesce(c.use_consult, true),
                              'use_mogo', coalesce(c.use_mogo, true), 'send_on', coalesce(c.send_on, true),
                              'also', coalesce((select jsonb_agg(m.class_name order by m.class_name) from public.class_members m where m.student_id = s.id), '[]'::jsonb))
      from public.students s left join public.classes c on c.name = s.class_name where s.id = p_student) end;
$$;
revoke all on function public.student_class_opts(uuid) from public, anon;
grant execute on function public.student_class_opts(uuid) to authenticated;

/* 번호 숫자만 */
create or replace function public._digits(p text) returns text language sql immutable as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

/* 가져오기 미리보기 — p_rows [{ uid, name, grade, phone, parent }] (앱 반 명단 · 함수 app-sync 가 앱에서 받아 줌)
   linked  — 이미 그 앱 id 로 연결된 재원 학생 → 학생은 그대로 · 반만 더함 (이미 그 반이면 same)
   suspect — 앱 id 는 없지만 이름이 같고 번호(학생 · 학부모)가 하나라도 같거나, 이름만 같은 재원 학생 → 넣지 않음
   new     — 새로 만듦 */
create or replace function public.app_roster_preview(p_class text, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; out jsonb := '[]'::jsonb; uid bigint; nm text; ph text; pa text; sid uuid; sname text; scls text; st text; why text;
  n_new int := 0; n_have int := 0; n_sus int := 0;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) limit 500 loop
    uid := case when coalesce(r ->> 'uid', '') ~ '^\d{1,15}$' then (r ->> 'uid')::bigint end;
    nm := btrim(coalesce(r ->> 'name', ''));
    if uid is null or nm = '' then continue; end if;
    ph := public._digits(r ->> 'phone'); pa := public._digits(r ->> 'parent');
    sid := null; why := ''; st := 'new'; sname := ''; scls := '';
    select s.id, s.name, s.class_name into sid, sname, scls from public.student_links l join public.students s on s.id = l.student_id
     where l.app_user_id = uid limit 1;
    if sid is not null then
      st := case when scls = p_class or exists (select 1 from public.class_members m where m.class_name = p_class and m.student_id = sid) then 'same' else 'linked' end;
    else
      select s.id, s.name, s.class_name,
             case when (length(ph) >= 9 and ph in (public._digits(s.student_phone), public._digits(s.parent_phone), public._digits(s.parent_phone2)))
                    or (length(pa) >= 9 and pa in (public._digits(s.student_phone), public._digits(s.parent_phone), public._digits(s.parent_phone2))) then 'name_phone' else 'name' end
        into sid, sname, scls, why
        from public.students s
       where not s.archived and replace(s.name, ' ', '') = replace(nm, ' ', '')
       order by 4 desc limit 1;
      if sid is not null then st := 'suspect'; end if;
    end if;
    if st = 'new' then n_new := n_new + 1; elsif st = 'suspect' then n_sus := n_sus + 1; else n_have := n_have + 1; end if;
    out := out || jsonb_build_object('uid', uid, 'name', left(nm, 40), 'grade', left(coalesce(r ->> 'grade', ''), 10), 'status', st, 'why', why,
                                     'student', case when sid is not null then jsonb_build_object('id', sid, 'name', sname, 'class', scls) end);
  end loop;
  return jsonb_build_object('ok', true, 'new', n_new, 'have', n_have, 'suspect', n_sus, 'rows', out);
end;
$$;
revoke all on function public.app_roster_preview(text, jsonb) from public, anon;
grant execute on function public.app_roster_preview(text, jsonb) to authenticated;

/* 가져오기 — 미리보기와 같은 규칙으로 다시 가른 뒤 new 만 새로 만들고 linked 는 반만 더함 · suspect 는 건너뜀
   반이 없으면 온라인 반으로 만든다(수업 시간 · 상담 · 모의고사 · 발송 꺼짐) · 앱 반 id 를 반에 남김 */
create or replace function public.app_roster_import(p_class text, p_app_class bigint, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pv jsonb; r jsonb; me text := coalesce(auth.jwt() ->> 'email', ''); src jsonb; nid uuid; cname text := btrim(coalesce(p_class, ''));
  n_new int := 0; n_add int := 0; n_skip int := 0; c public.classes;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  if cname = '' or length(cname) > 30 then raise exception '반 이름을 30자 안으로 적어 주세요'; end if;
  select * into c from public.classes where name = cname;
  if not found then
    insert into public.classes (name, kind, use_time, use_consult, use_mogo, send_on, app_class_id) values (cname, 'online', false, false, false, false, p_app_class);
  else
    if c.archived then raise exception '‘%’ 반은 보관된 반입니다. 먼저 되살려 주세요', cname; end if;
    update public.classes set app_class_id = coalesce(app_class_id, p_app_class) where name = cname;
  end if;
  pv := public.app_roster_preview(cname, p_rows);
  for r in select * from jsonb_array_elements(pv -> 'rows') loop
    if r ->> 'status' = 'new' then
      select x into src from jsonb_array_elements(p_rows) x where x ->> 'uid' = r ->> 'uid' limit 1;
      insert into public.students (name, grade, class_name, student_phone, parent_phone, start_on)
      values (r ->> 'name', coalesce(r ->> 'grade', ''), cname, public._digits(src ->> 'phone'), public._digits(src ->> 'parent'), (now() at time zone 'Asia/Seoul')::date)
      returning id into nid;
      insert into public.student_links (student_id) values (nid) on conflict (student_id) do nothing;
      update public.student_links set app_user_id = (r ->> 'uid')::bigint, app_user_by = 'roster', app_user_at = now(), app_link_state = 'ok', app_link_cands = '[]'::jsonb
       where student_id = nid;
      n_new := n_new + 1;
    elsif r ->> 'status' = 'linked' then
      insert into public.class_members (class_name, student_id, app_class_id, added_by) values (cname, (r -> 'student' ->> 'id')::uuid, p_app_class, me)
      on conflict (class_name, student_id) do nothing;
      n_add := n_add + 1;
    elsif r ->> 'status' = 'suspect' then
      n_skip := n_skip + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', n_new, 'added', n_add, 'skipped', n_skip, 'same', (select count(*) from jsonb_array_elements(pv -> 'rows') x where x ->> 'status' = 'same'));
end;
$$;
revoke all on function public.app_roster_import(text, bigint, jsonb) from public, anon;
grant execute on function public.app_roster_import(text, bigint, jsonb) to authenticated;

/* 발송 막기 — 발송이 꺼진 온라인 반의 재원 학생 · 그 학생들만 쓰는 번호(다른 학생도 쓰는 번호는 안 막음) · 서버만 */
create or replace function public.send_quiet()
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (
    select s.id, public._digits(s.student_phone) a, public._digits(s.parent_phone) b, public._digits(s.parent_phone2) c
      from public.students s join public.classes k on k.name = s.class_name
     where not s.archived and k.kind = 'online' and not k.send_on
  ), others as (
    select public._digits(s.student_phone) a, public._digits(s.parent_phone) b, public._digits(s.parent_phone2) c
      from public.students s where not s.archived and s.id not in (select id from q)
  ), qp as (select a p from q union select b from q union select c from q
  ), op as (select a p from others union select b from others union select c from others)
  select case when public.is_staff() or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
                   or coalesce(current_setting('role', true), '') = 'service_role' then
    jsonb_build_object('students', coalesce((select jsonb_agg(id) from q), '[]'::jsonb),
                       'phones', coalesce((select jsonb_agg(p) from qp where length(p) >= 9 and p not in (select p from op where p is not null)), '[]'::jsonb))
    else jsonb_build_object('students', '[]'::jsonb, 'phones', '[]'::jsonb) end;
$$;
revoke all on function public.send_quiet() from public, anon;
grant execute on function public.send_quiet() to authenticated, service_role;      -- 직원(문자 · 알림톡 함수가 직원 열쇠로 부름) · 서버(자동 알림)만 값이 나옴

/* 모의고사 받기 — 모의고사가 꺼진 반 학생은 뺀다 (091 과 같고 조건만 더함) */
create or replace function public.mogo_due(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('night', false, 'students', coalesce((
    select jsonb_agg(public._mogo_row(s) order by r.next_at nulls first, s.name)
      from public.students s left join public.mogo_records r on r.student_id = s.id
     where s.id in (select s2.id from public.students s2 left join public.mogo_records r2 on r2.student_id = s2.id
                     left join public.classes k2 on k2.name = s2.class_name
                     where not s2.archived and btrim(coalesce(s2.name, '')) <> '' and coalesce(k2.use_mogo, true)
                       and (r2.student_id is null or r2.next_at is null or r2.next_at <= coalesce(p_now, now()))
                     order by r2.next_at nulls first, s2.name limit greatest(1, least(coalesce(p_limit, 15), 40)))), '[]'::jsonb));
end;
$$;
revoke all on function public.mogo_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mogo_due(timestamptz, integer) to service_role;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '반 종류 칸(classes.kind · use_time · use_consult · use_mogo · send_on)' as what,
       (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'classes' and column_name in ('kind', 'use_time', 'use_consult', 'use_mogo', 'send_on'))::text as ok
union all select '반만 더한 학생 표(class_members)', (to_regclass('public.class_members') is not null)::text
union all select '가져오기 함수(app_roster_preview · app_roster_import)', (to_regprocedure('public.app_roster_preview(text, jsonb)') is not null and to_regprocedure('public.app_roster_import(text, bigint, jsonb)') is not null)::text
union all select '발송 막기(send_quiet)', (to_regprocedure('public.send_quiet()') is not null)::text
union all select '모의고사 받기에서 꺼진 반 뺌', (position('use_mogo' in pg_get_functiondef('public.mogo_due(timestamptz, integer)'::regprocedure)) > 0)::text;
