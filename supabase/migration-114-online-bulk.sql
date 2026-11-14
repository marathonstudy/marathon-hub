-- ============================================================
--  migration-114-online-bulk.sql — 20261114j · 107 · 111 다음 · 여러 번 실행해도 됨 · 그다음 함수 app-sync · sms-send 다시 배포
--  1. 온라인 반 여러 개 한 번에 가져오기
--     app_roster_preview_many(items) — 반마다 새로 추가 · 이미 있음 · 겹침 의심 · 현강 학생 수 · 「현강 반에 연결」(현강 학생이 60% 이상) / 온라인 반
--     app_roster_import_many(items)  — 한 번에 · 온라인 반은 107 과 같이(발송 꺼짐 · 학생은 하나 · 반만 여러 개) ·
--                                       「현강 반에 연결」은 새 반 · 새 학생을 만들지 않고 앱 반 id 만 그 현강 반에 남김(현강 반 · 발송 설정 그대로)
--                                       겹침 의심은 넣지 않고 그 학생의 「앱 연결 필요」 후보(app_link_cands)에 앱 학생 번호를 더함
--  2. 데이터 — 앱 부담
--     app_sync_due: 온라인 반만 듣는 학생은 1시간마다(현강 학생은 그대로 · 진행 중인 반 30분 · 그 밖 하루) · 밤 1~6시 쉼 그대로 · online 표시
--     app_old_due2: 옛 기록 받는 순서 — 종강 반 → 현강 → 온라인
--     app_online_weeks(학생, 날짜별 제출): 온라인 반만 듣는 학생의 주간 배지 칸(수업 요일 대신 월~금 · 끝난 주만 · 과제 수정값 · 면제 반영)
--     online_progress(): 반마다 「기록 받는 중 n명 / 다 받음 n명 · n%」 · 남은 요청 수 · 예상 완료 시각(직원만)
--  3. 완주증 보내기 — finish_sends(같은 완주증을 같은 사람에게 두 번 보내지 않게) · finish_send_info(번호 · 링크가 있는지만 · 번호는 돌려주지 않음) · finish_send_mark
--  문자 · 알림톡은 이 SQL 이 보내지 않는다. 번호는 화면에 돌려주지 않는다(있음 / 없음만).
-- ============================================================

/* ---------- 학생이 온라인 반만 듣는지 (112 hub_class_mode 와 같은 규칙 — 반이 하나라도 현강이면 현강) ---------- */
create or replace function public._online_only(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s join public.classes c on c.name = s.class_name where s.id = p_student and c.kind = 'online')
     and not exists (select 1 from public.students s join public.classes c on c.name = s.class_name where s.id = p_student and coalesce(c.kind, '') <> 'online')
     and not exists (select 1 from public.students s where s.id = p_student and coalesce(s.class_name, '') <> '' and not exists (select 1 from public.classes c where c.name = s.class_name))
     and not exists (select 1 from public.class_members m join public.classes c on c.name = m.class_name where m.student_id = p_student and coalesce(c.kind, '') <> 'online');
$$;
revoke all on function public._online_only(uuid) from public, anon, authenticated;

/* ---------- 1. 여러 반 미리보기 ---------- */
/* p_items [{ key, title, target, app_class, rows: [{ uid, name, grade, phone, parent }] }] */
create or replace function public.app_roster_preview_many(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare it jsonb; pv jsonb; out jsonb := '[]'::jsonb; tgt text; live int; lcls text; tot int; md text; uids jsonb := '[]'::jsonb; ex public.classes;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  for it in select * from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) limit 40 loop
    tgt := left(btrim(regexp_replace(coalesce(it ->> 'target', it ->> 'title', ''), '\s+', ' ', 'g')), 30);
    if tgt = '' then continue; end if;
    pv := public.app_roster_preview(tgt, coalesce(it -> 'rows', '[]'::jsonb));
    /* 현강 학생 — 코치룸 학생과 이어진(이미 있음 · 겹침 의심) 줄 중 그 학생이 현강 반 학생 */
    select count(*), count(*) filter (where jsonb_typeof(x -> 'student') = 'object' and not public._online_only((x -> 'student' ->> 'id')::uuid))
      into tot, live from jsonb_array_elements(pv -> 'rows') x;
    select s.class_name into lcls
      from jsonb_array_elements(pv -> 'rows') x join public.students s on s.id = (x -> 'student' ->> 'id')::uuid
      join public.classes c on c.name = s.class_name and coalesce(c.kind, '') <> 'online'
     group by s.class_name order by count(*) desc, s.class_name limit 1;
    md := case when tot > 0 and live * 10 >= tot * 6 and lcls is not null then 'link' else 'online' end;
    select * into ex from public.classes where name = tgt;
    uids := uids || coalesce((select jsonb_agg(x -> 'uid') from jsonb_array_elements(pv -> 'rows') x where x ->> 'status' = 'new'), '[]'::jsonb);
    out := out || jsonb_build_object('key', it ->> 'key', 'title', left(coalesce(it ->> 'title', ''), 80), 'target', tgt, 'mode', md,
      'live', live, 'live_class', coalesce(lcls, ''), 'total', tot, 'new', (pv ->> 'new')::int, 'have', (pv ->> 'have')::int, 'suspect', (pv ->> 'suspect')::int,
      'same', (select count(*) from jsonb_array_elements(pv -> 'rows') x where x ->> 'status' = 'same'),
      'exists', ex.name is not null, 'exists_kind', coalesce(ex.kind, ''), 'rows', pv -> 'rows');
  end loop;
  return jsonb_build_object('ok', true, 'items', out,
    'new_uniq', (select count(distinct u) from jsonb_array_elements_text(uids) u),
    'new_dup', jsonb_array_length(uids) - (select count(distinct u) from jsonb_array_elements_text(uids) u));
end;
$$;
revoke all on function public.app_roster_preview_many(jsonb) from public, anon;
grant execute on function public.app_roster_preview_many(jsonb) to authenticated;

/* 겹침 의심 — 넣지 않고 그 학생의 「앱 연결 필요」 후보에 앱 학생 번호를 더함 */
create or replace function public._roster_cand(p_student uuid, p_uid bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_student is null or p_uid is null then return; end if;
  insert into public.student_links (student_id) values (p_student) on conflict (student_id) do nothing;
  update public.student_links
     set app_link_cands = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (select jsonb_array_elements(coalesce(app_link_cands, '[]'::jsonb)) v union select to_jsonb(p_uid)) z)
   where student_id = p_student and app_user_id is null;
end;
$$;
revoke all on function public._roster_cand(uuid, bigint) from public, anon, authenticated;

/* 여러 반 가져오기 — 미리보기와 같은 규칙으로 다시 가름(화면이 보낸 mode 는 쓰지 않음) */
create or replace function public.app_roster_import_many(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pv jsonb; it jsonb; r jsonb; res jsonb; out jsonb := '[]'::jsonb; appc bigint; tgt text;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  pv := public.app_roster_preview_many(p_items);
  for it in select * from jsonb_array_elements(pv -> 'items') loop
    tgt := it ->> 'target';
    select case when coalesce(x ->> 'app_class', '') ~ '^\d{1,15}$' then (x ->> 'app_class')::bigint end into appc
      from jsonb_array_elements(p_items) x where coalesce(x ->> 'key', '') = coalesce(it ->> 'key', '') limit 1;
    for r in select * from jsonb_array_elements(it -> 'rows') loop
      if r ->> 'status' = 'suspect' then perform public._roster_cand((r -> 'student' ->> 'id')::uuid, (r ->> 'uid')::bigint); end if;
    end loop;
    if it ->> 'mode' = 'link' then
      update public.classes set app_class_id = coalesce(app_class_id, appc) where name = it ->> 'live_class';
      res := jsonb_build_object('ok', true, 'mode', 'link', 'class', it ->> 'live_class', 'created', 0, 'added', 0,
                                'skipped', (it ->> 'suspect')::int, 'left_new', (it ->> 'new')::int);
    else
      res := public.app_roster_import(tgt, appc, (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(p_items) i, jsonb_array_elements(i -> 'rows') x
                                                   where coalesce(i ->> 'key', '') = coalesce(it ->> 'key', ''))) || jsonb_build_object('mode', 'online', 'class', tgt);
    end if;
    out := out || (res || jsonb_build_object('key', it ->> 'key', 'title', it ->> 'title'));
  end loop;
  return jsonb_build_object('ok', true, 'items', out);
end;
$$;
revoke all on function public.app_roster_import_many(jsonb) from public, anon;
grant execute on function public.app_roster_import_many(jsonb) to authenticated;

/* ---------- 2. 평소 동기화 — 온라인 반만 듣는 학생은 1시간마다 (102 와 같고 그 줄만 · online 표시) ---------- */
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
  ), base as (
    select s.id, l.app_share_code share, l.app_user_id uid, s.start_on, (l.app_user_id is not null and l.app_fill_at is null) fill, r.fetched_at, r.next_try,
           public._online_only(s.id) onl, coalesce(a.on_, false) on_
      from public.students s
      join public.student_links l on l.student_id = s.id and (l.app_share_code <> '' or l.app_user_id is not null)
      left join public.app_records r on r.student_id = s.id
      left join act a on a.class_name = coalesce(s.class_name, '')
     where not s.archived
  ), pick as (
    select * from base b
     where case when b.next_try is not null then b.next_try <= nw
                when b.fetched_at is null then true
                else b.fetched_at <= nw - (case when b.onl then interval '1 hour' when b.on_ then interval '30 minutes' else interval '24 hours' end) end
     order by (b.fetched_at is null) desc, b.onl, b.fetched_at nulls first, b.id
     limit greatest(1, least(300, coalesce(p_limit, 60)))
  ), mark as (
    insert into public.app_records (student_id, next_try)
    select id, nw + interval '10 minutes' from pick
    on conflict (student_id) do update set next_try = excluded.next_try
    returning student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'share', p.share, 'uid', p.uid, 'start', p.start_on, 'fill', p.fill, 'online', p.onl)), '[]'::jsonb) into out
    from pick p join mark m on m.student_id = p.id;
  return jsonb_build_object('night', false, 'students', out);
end;
$$;
revoke all on function public.app_sync_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.app_sync_due(timestamptz, integer) to service_role;

/* 옛 기록 받는 순서 — 종강 반(2) → 현강(1) → 온라인(0) (111 과 같고 순서만) */
create or replace function public.app_old_due2(p_limit integer default 40)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'uid', z.uid, 'start', z.start_on, 'month', z.old_month, 'dfirst', z.dfirst) order by z.pri desc, z.ord nulls first, z.id), '[]'::jsonb)
    from (
      select s.id, l.app_user_id uid, s.start_on, r.old_month, r.old_try ord, public._data_first(r.data) dfirst,
             case when exists (select 1 from public.classes c
                                where (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name))
                                  and c.end_on between (now() at time zone 'Asia/Seoul')::date - 7 and (now() at time zone 'Asia/Seoul')::date + 21) then 2
                  when public._online_only(s.id) then 0 else 1 end pri
        from public.students s
        join public.student_links l on l.student_id = s.id and l.app_user_id is not null
        left join public.app_records r on r.student_id = s.id
       where not s.archived
         and r.old_at is null
         and (coalesce(r.old_fails, 0) = 0 or r.old_try is null
              or r.old_try < now() - case when r.old_fails <= 1 then interval '10 minutes'
                                          else least(interval '6 hours', interval '30 minutes' * power(2, least(r.old_fails, 8) - 2)) end)
       order by 7 desc, r.old_try nulls first, s.id
       limit greatest(1, least(100, coalesce(p_limit, 40)))
    ) z;
$$;
revoke all on function public.app_old_due2(integer) from public, anon, authenticated;
grant execute on function public.app_old_due2(integer) to service_role;

/* 온라인 반만 듣는 학생의 주간 배지 칸 — 수업 요일이 없으니 월~금 한 주 · 수강 시작 주부터 끝난 주(어제까지)만
   한 주에 낸 날 / 과제 날(과제 수정값 · 면제 반영) · 한 번 퍼펙트면 그대로(075) · filled = false(진짜 배지) · 문자 · 알림톡은 온라인 반 발송 꺼짐 그대로 */
create or replace function public.app_online_weeks(p_student uuid, p_days jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; st date; cls text; tdy date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_student is null or jsonb_typeof(p_days) <> 'array' or not public._online_only(p_student) then return 0; end if;
  select s.start_on, coalesce(s.class_name, '') into st, cls from public.students s where s.id = p_student and not s.archived;
  if not found or st is null then return 0; end if;
  with d0 as (
    select (x ->> 'd')::date d, x ->> 's' s from jsonb_array_elements(p_days) x
     where coalesce(x ->> 'd', '') ~ '^\d{4}-\d{2}-\d{2}$' and x ->> 's' in ('onTime', 'late', 'none')
  ), d1 as (
    select d0.d, coalesce((select f.status from public.hw_fixes f where f.student_id = p_student and f.day = d0.d and f.status in ('onTime', 'late', 'none', 'exempt') order by f.fixed_at desc limit 1), d0.s) s
      from d0 where extract(isodow from d0.d) <= 5 and d0.d >= st - (extract(isodow from st)::int - 1)
  ), wk as (
    select d - (extract(isodow from d)::int - 1) w, count(*) filter (where s in ('onTime', 'late')) dn, count(*) filter (where s in ('onTime', 'late', 'none')) tt
      from d1 group by 1
  ), up as (
    insert into public.hw_weeks (student_id, week_start, lesson_day, class_name, done, total, perfect, filled)
    select p_student, w, w + 7, cls, dn, tt, dn >= tt, false from wk where tt > 0 and w + 6 < tdy
    on conflict (student_id, week_start) do update set done = excluded.done, total = excluded.total, perfect = excluded.perfect
      where not public.hw_weeks.perfect and not public.hw_weeks.filled
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;
revoke all on function public.app_online_weeks(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_online_weeks(uuid, jsonb) to service_role;

/* 반마다 기록 받기 진행 — 온라인 반 · 앱 반이 연결된 반 · 학생은 class_name 또는 class_members
   남은 요청 = 학생마다 아직 안 받은 달 수(2026-01 ~ 지금 기록 첫 달 앞) · 예상 완료 = 지금 + 남은 요청 ÷ 분당 10회(5분마다 한 번 · 110초 · 분당 28회 한도 · 평소 동기화와 나눔) */
create or replace function public.online_progress()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('class', q.name, 'kind', q.kind, 'students', q.n, 'linked', q.linked, 'done', q.done, 'wait', q.wait, 'fail', q.fail,
                                        'pct', case when q.linked > 0 then round(q.done * 100.0 / q.linked) else 0 end, 'left', q.lft,
                                        'eta', case when q.lft > 0 then to_char((now() + make_interval(mins => ceil(q.tot_left / 10.0)::int)) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') end)
                     order by q.kind desc, q.name)
      from (
        select c.name, coalesce(c.kind, '') kind, count(s.id) n,
               count(s.id) filter (where l.app_user_id is not null) linked,
               count(s.id) filter (where l.app_user_id is not null and r.old_at is not null) done,
               count(s.id) filter (where l.app_user_id is not null and r.old_at is null) wait,
               count(s.id) filter (where l.app_user_id is not null and r.old_at is null and coalesce(r.old_fails, 0) > 0) fail,
               coalesce(sum(case when l.app_user_id is not null and r.old_at is null then greatest(1,
                  (extract(year from age(date_trunc('month', coalesce(public._data_first(r.data), (now() at time zone 'Asia/Seoul')::date)),
                                         date_trunc('month', greatest('2026-01-01'::date, coalesce(r.old_month::date + interval '1 month', '2026-01-01'::date))))) * 12
                 + extract(month from age(date_trunc('month', coalesce(public._data_first(r.data), (now() at time zone 'Asia/Seoul')::date)),
                                          date_trunc('month', greatest('2026-01-01'::date, coalesce(r.old_month::date + interval '1 month', '2026-01-01'::date))))))::int)
                   else 0 end), 0) lft,
               (select coalesce(sum(1), 0) from public.student_links l2 join public.app_records r2 on r2.student_id = l2.student_id
                 join public.students s2 on s2.id = l2.student_id and not s2.archived where l2.app_user_id is not null and r2.old_at is null) * 6 tot_left
          from public.classes c
          left join public.students s on not s.archived and (s.class_name = c.name or exists (select 1 from public.class_members m where m.class_name = c.name and m.student_id = s.id))
          left join public.student_links l on l.student_id = s.id
          left join public.app_records r on r.student_id = s.id
         where not coalesce(c.archived, false) and (c.kind = 'online' or c.app_class_id is not null)
         group by c.name, c.kind
      ) q), '[]'::jsonb) end;
$$;
revoke all on function public.online_progress() from public, anon;
grant execute on function public.online_progress() to authenticated;

/* ---------- 3. 완주증 보내기 기록 — 같은 완주증(종류 · 기간)을 같은 사람(학생 · 학부모)에게 두 번 보내지 않게 ---------- */
create table if not exists public.finish_sends (
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('year', 'month')),
  pkey text not null,
  target text not null check (target in ('student', 'parent1', 'parent2')),
  sent_by text not null default '',
  sent_at timestamptz not null default now(),
  primary key (student_id, kind, pkey, target)
);
alter table public.finish_sends enable row level security;
drop policy if exists finish_sends_staff_read on public.finish_sends;
create policy finish_sends_staff_read on public.finish_sends for select to authenticated using (public.is_staff());
revoke all on public.finish_sends from anon;
revoke insert, update, delete on public.finish_sends from authenticated;
grant select on public.finish_sends to authenticated;

/* 반 학생마다 — 학생 번호 · 학부모 번호 · 링크가 있는지(있음 / 없음만 · 번호는 돌려주지 않음) · 이미 보낸 곳 */
create or replace function public.finish_send_info(p_class text, p_kind text, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'sp', public._phone_ok(s.student_phone), 'pp', public._phone_ok(s.parent_phone), 'pp2', public._phone_ok(s.parent_phone2),
                                        'scode', coalesce(l.student_code, '') <> '', 'hcode', coalesce(l.hub_code, '') <> '',
                                        'sent', coalesce((select jsonb_agg(f.target) from public.finish_sends f where f.student_id = s.id and f.kind = p_kind and f.pkey = p_key), '[]'::jsonb)))
      from public.students s left join public.student_links l on l.student_id = s.id
     where not s.archived and (s.class_name = p_class or exists (select 1 from public.class_members m where m.class_name = p_class and m.student_id = s.id))), '[]'::jsonb) end;
$$;
revoke all on function public.finish_send_info(text, text, text) from public, anon;
grant execute on function public.finish_send_info(text, text, text) to authenticated;

/* 보낸 뒤 — 접수된 줄만 [{ student, target }] */
create or replace function public.finish_send_mark(p_kind text, p_key text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_staff() then raise exception '운영진만 할 수 있습니다'; end if;
  if p_kind not in ('year', 'month') or coalesce(p_key, '') = '' or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  insert into public.finish_sends (student_id, kind, pkey, target, sent_by)
  select (x ->> 'student')::uuid, p_kind, left(p_key, 40), x ->> 'target', coalesce(auth.jwt() ->> 'email', '')
    from jsonb_array_elements(p_rows) x
   where coalesce(x ->> 'student', '') ~* '^[0-9a-f-]{36}$' and x ->> 'target' in ('student', 'parent1', 'parent2')
     and exists (select 1 from public.students s where s.id = (x ->> 'student')::uuid)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.finish_send_mark(text, text, jsonb) from public, anon;
grant execute on function public.finish_send_mark(text, text, jsonb) to authenticated;

-- 확인 (모두 true 여야 함)
select '여러 반 가져오기(app_roster_preview_many · app_roster_import_many)' as what,
       (to_regprocedure('public.app_roster_preview_many(jsonb)') is not null and to_regprocedure('public.app_roster_import_many(jsonb)') is not null)::text as ok
union all select '온라인 학생 1시간 동기화(app_sync_due)', (position('_online_only' in pg_get_functiondef('public.app_sync_due(timestamptz, integer)'::regprocedure)) > 0)::text
union all select '옛 기록 순서 종강 → 현강 → 온라인(app_old_due2)', (position('_online_only' in pg_get_functiondef('public.app_old_due2(integer)'::regprocedure)) > 0)::text
union all select '온라인 학생 주간 배지(app_online_weeks)', (to_regprocedure('public.app_online_weeks(uuid, jsonb)') is not null)::text
union all select '반마다 기록 받기 진행(online_progress)', (to_regprocedure('public.online_progress()') is not null)::text
union all select '완주증 보내기 기록(finish_sends · finish_send_info · finish_send_mark)',
       (to_regclass('public.finish_sends') is not null and to_regprocedure('public.finish_send_info(text, text, text)') is not null and to_regprocedure('public.finish_send_mark(text, text, jsonb)') is not null)::text;
