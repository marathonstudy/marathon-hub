-- ============================================================
--  migration-069-hw-status.sql — 수업 20분 전 운영진에게 과제 현황 명단 (20261108a)
--  (069 는 068 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  받는 사람 — 운영진만. 학생 · 학부모에게는 보내지 않는다 (학생 번호 · 학부모 번호를 읽지 않는다).
--    원장(staff.role = 'teacher') — 내 시험 번호(kakao_test_phones) · 없으면 로그인 번호(staff_phones)
--    조교 — 로그인할 때 넣는 번호 8자리(staff_phones · 010 + 8자리 · 049 부터 로그인마다 맞춰 둔다)
--    사용 중(active) · 승인됨(approved)만 · 승인 대기 · 사용 중지는 뺀다 · 같은 번호는 한 번
--    번호가 없으면 보내지 않고 보낸 기록에 「번호 없음」 실패 줄로 남긴다
--    사람마다 「수업 전 과제 현황 받기」 (staff.hw_status · 기본 켜짐 · 운영진 화면)
--  보내는 때 — 반 수업 시작 20분 전 ~ 시작 전 (오늘 수업 · 휴강 · 종강 · 보관 반영 · _note_lesson_today)
--    같은 날 같은 반은 한 번 (hw_status_log · 시각을 바꿔도 · 그날 [지금 보내기]로 이미 보냈어도 자동은 다시 안 나감)
--  기간 — 수업 전 예고 · 과제 독려와 같다 (D-7 ~ D-1 평일 · 늦게 낸 것은 냄 · 면제는 전체에서 뺌 · 과제 수정값 · 수강 시작일)
--    셈은 note-remind 가 한다 (과제 기록 저장본 app_records · 없으면 앱에서 직접)
--  글 — 이름과 퍼센트만 (번호 · 상담 내용 · 성적 없음)
--    [과제 현황] 반포반 · 오늘 09:30 수업 (11/1~11/7)
--    완료율 높은 순 · 23명
--    100% 김승윤                    (같은 퍼센트면 이름 가나다순 · 퍼센트는 내림)
--    40% 홍길동 → 상담 필요          (기준 미만 · 기준은 app_settings 'hw_status' · 기본 60)
--    과제 없음 · 이름, 이름          (그 기간 과제 0개)
--    앱 기록 없음 · 이름             (앱 링크가 없거나 기록을 못 받은 학생)
--    60% 미만 2명은 반드시 상담해 주세요. / 모두 60% 이상이에요.
--    LMS 한 통(2,000바이트)을 넘으면 나눠 「(1/2)」
--  사본 — 원장도 받는 문자라 만들지 않는다 (copy_state = 'none')
--  화면 — 「오늘」 반 카드 「과제 현황 문자 09:10 보냄」 · [미리보기] · [지금 운영진에게 보내기]
-- ============================================================


-- ------------------------------------------------------------
--  1. 사람마다 받기 · 기준 퍼센트
-- ------------------------------------------------------------
alter table public.staff add column if not exists hw_status boolean not null default true;

insert into public.app_settings (key, value) values ('hw_status', jsonb_build_object('cut', 60))
on conflict (key) do nothing;

create or replace function public._hws_cut()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(1, least(100, coalesce((select (value ->> 'cut')::int from public.app_settings where key = 'hw_status'), 60)));
$$;
revoke all on function public._hws_cut() from public, anon, authenticated;

/* 기준 퍼센트 — 운영진 누구나 (1~100) */
create or replace function public.hw_status_cut_set(p_cut integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if coalesce(p_cut, 0) not between 1 and 100 then raise exception '상담 기준은 1~100%% 로 정해 주세요.'; end if;
  insert into public.app_settings (key, value) values ('hw_status', jsonb_build_object('cut', p_cut))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('cut', p_cut);
  return jsonb_build_object('ok', true, 'cut', p_cut);
end;
$$;
revoke all on function public.hw_status_cut_set(integer) from public, anon;
grant execute on function public.hw_status_cut_set(integer) to authenticated;

/* 받기 켜기/끄기 — 나 자신 · 원장은 누구나 */
create or replace function public.staff_hwstat_set(p_email text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if lower(coalesce(p_email, '')) <> me and not public._real_teacher() then raise exception '다른 사람의 받기 설정은 원장만 바꿀 수 있습니다.'; end if;
  update public.staff set hw_status = coalesce(p_on, true) where lower(email) = lower(coalesce(p_email, ''));
  if not found then raise exception '그 운영진을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true));
end;
$$;
revoke all on function public.staff_hwstat_set(text, boolean) from public, anon;
grant execute on function public.staff_hwstat_set(text, boolean) to authenticated;

/* 받는 사람 — 사용 중 · 승인됨 · 원장 먼저 · 번호(없으면 '') */
create or replace function public._hws_people()
returns table (email text, name text, role text, phone text, on_ boolean)
language sql stable security definer set search_path = public as $$
  select s.email, coalesce(nullif(btrim(s.name), ''), '운영진'), s.role,
         coalesce(
           case when s.role = 'teacher' then (select regexp_replace(t.phone, '\D', '', 'g') from public.kakao_test_phones t
                                                where lower(t.email) = lower(s.email) and public._phone_ok(t.phone) limit 1) end,
           (select regexp_replace(p.phone, '\D', '', 'g') from public.staff_phones p where lower(p.email) = lower(s.email) and public._phone_ok(p.phone) limit 1),
           ''),
         coalesce(s.hw_status, true)
    from public.staff s
   where s.active and s.approval = 'approved'
   order by (s.role = 'teacher') desc, s.created_at, s.email;
$$;
revoke all on function public._hws_people() from public, anon, authenticated;

/* 운영진 목록 (051 과 같고 받기 · 번호 있음 · 기준 퍼센트를 더함) */
create or replace function public.staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'me', lower(coalesce(auth.jwt() ->> 'email', '')),
    'owner', public._real_teacher(),
    'hwCut', public._hws_cut(),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
               'email', s.email, 'name', s.name, 'role', s.role, 'active', s.active,
               'last4', s.phone_last4, 'phone', s.phone_hash is not null,
               'created_at', s.created_at, 'last_seen_at', s.last_seen_at,
               'disabled_by', s.disabled_by, 'disabled_at', s.disabled_at, 'approved_by', s.approved_by, 'approved_at', s.approved_at,
               'hwStatus', coalesce(s.hw_status, true),
               'smsPhone', coalesce((select p.phone <> '' from public._hws_people() p where p.email = s.email), false))
             order by s.active desc, s.role desc, s.created_at) from public.staff s where s.approval = 'approved'), '[]'::jsonb));
end;
$$;


-- ------------------------------------------------------------
--  2. 보낸 기록 — 같은 날 같은 반 한 번
-- ------------------------------------------------------------
create table if not exists public.hw_status_log (
  id          bigserial primary key,
  day         date not null,
  class_name  text not null,
  manual      boolean not null default false,
  batch_id    uuid,
  by_name     text not null default '',
  students    integer not null default 0,
  low         integer not null default 0,
  parts       integer not null default 1,
  created_at  timestamptz not null default now()
);
create unique index if not exists hw_status_once on public.hw_status_log (day, class_name) where not manual;
alter table public.hw_status_log enable row level security;
drop policy if exists hw_status_log_read on public.hw_status_log;
create policy hw_status_log_read on public.hw_status_log for select to authenticated using (public.is_staff());


-- ------------------------------------------------------------
--  3. 보낼 반 · 학생
-- ------------------------------------------------------------
/* 지금 보낼 반 — 오늘 수업 · 시작 20분 전 ~ 시작 전 · 오늘 아직 안 보냄 */
create or replace function public._hws_due_classes(p_now timestamptz)
returns setof public.classes
language sql stable security definer set search_path = public as $$
  select k.* from public.classes k
   where not k.archived and k.start_time is not null
     and k.start_time >= time '00:20'
     and (p_now at time zone 'Asia/Seoul')::time >= k.start_time - interval '20 minutes'
     and (p_now at time zone 'Asia/Seoul')::time < k.start_time
     and public._note_lesson_today(k.name, (p_now at time zone 'Asia/Seoul')::date)
     and not exists (select 1 from public.hw_status_log g where g.day = (p_now at time zone 'Asia/Seoul')::date and g.class_name = k.name)
   order by k.name;
$$;
revoke all on function public._hws_due_classes(timestamptz) from public, anon, authenticated;

/* 반 하나의 학생 — 이름 · 앱 공유 코드 · 수강 시작일 · 과제 수정값 · 저장본(lite) — 번호는 넣지 않는다 */
create or replace function public._hws_students(p_class text, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'share', coalesce(nullif(l.app_share_code, ''), ''),
           'startOn', coalesce(st.start_on::text, ''),
           'fix', coalesce((select jsonb_object_agg(f.day::text, f.status)
                              from (select distinct on (h.day) h.day, h.status from public.hw_fixes h
                                     where h.student_id = s.id and h.day >= p_day - 21 and h.day < p_day
                                     order by h.day, h.id desc) f
                             where f.status <> 'app'), '{}'::jsonb),
           'rec', r.lite) order by s.name), '[]'::jsonb)
    from public._note_students(p_class, p_day) s
    join public.students st on st.id = s.id
    left join public.student_links l on l.student_id = s.id
    left join public.app_records r on r.student_id = s.id and r.lite is not null;
$$;
revoke all on function public._hws_students(text, date) from public, anon, authenticated;

/* note-remind 매분 — 보낼 반과 학생 (service_role) */
create or replace function public.hw_status_due(p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
begin
  return jsonb_build_object('ok', true, 'day', d, 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.name, 'start', to_char(c.start_time, 'HH24:MI'), 'students', public._hws_students(c.name, d)) order by c.name)
      from public._hws_due_classes(coalesce(p_now, now())) c), '[]'::jsonb));
end;
$$;
revoke all on function public.hw_status_due(timestamptz) from public, anon, authenticated;
grant execute on function public.hw_status_due(timestamptz) to service_role;

/* [미리보기] · [지금 보내기] — 반 하나 (오늘 수업이 있는 반만 · service_role · 함수가 운영진인지 먼저 본다) */
create or replace function public.hw_status_class(p_now timestamptz, p_class text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date; c public.classes;
begin
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'class', 'message', '그 반을 찾지 못했습니다.'); end if;
  if c.start_time is null then return jsonb_build_object('ok', false, 'reason', 'time', 'message', '반에 수업 시작 시각을 먼저 넣어 주세요.'); end if;
  if c.archived or not public._note_lesson_today(c.name, d) then return jsonb_build_object('ok', false, 'reason', 'nolesson', 'message', '오늘 수업이 없는 반입니다.'); end if;
  return jsonb_build_object('ok', true, 'day', d, 'classes', jsonb_build_array(
    jsonb_build_object('name', c.name, 'start', to_char(c.start_time, 'HH24:MI'), 'students', public._hws_students(c.name, d))));
end;
$$;
revoke all on function public.hw_status_class(timestamptz, text) from public, anon, authenticated;
grant execute on function public.hw_status_class(timestamptz, text) to service_role;


-- ------------------------------------------------------------
--  4. 글 — p_items [{ id, done, total, known }] (known false = 앱 기록 없음)
--     통이 넘치면 나눈다 · 반환 { texts: [...], students, low }
-- ------------------------------------------------------------
create or replace function public._hws_texts(p_class text, p_day date, p_start text, p_items jsonb, p_cut integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  cut int := greatest(1, least(100, coalesce(p_cut, 60)));
  head text := '[과제 현황] ' || p_class || ' · 오늘 ' || coalesce(p_start, '') || ' 수업 (' ||
               to_char(p_day - 7, 'FMMM/FMDD') || '~' || to_char(p_day - 1, 'FMMM/FMDD') || ')';
  lines text[] := '{}'; body text[] := '{}';
  nrank int := 0; nlow int := 0; none_ text; unk text; tail text;
  r record;
  limitb int := 2000;
  parts text[] := '{}'; cur text; ln text; k int; n int;
begin
  for r in
    with x as (
      select s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.name, (x.dn * 100 / x.tt) pct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name || case when r.pct < cut then ' → 상담 필요' else '' end);
  end loop;
  select string_agg(s.name, ', ' order by s.name collate "C") into none_
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) <= 0;
  select string_agg(s.name, ', ' order by s.name collate "C") into unk
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where not coalesce((i ->> 'known')::boolean, true);
  if none_ is not null then body := body || ('과제 없음 · ' || none_); end if;
  if unk is not null then body := body || ('앱 기록 없음 · ' || unk); end if;
  tail := case when nrank = 0 then '완료율을 낼 학생이 없어요.'
               when nlow > 0 then cut || '% 미만 ' || nlow || '명은 반드시 상담해 주세요.'
               else '모두 ' || cut || '% 이상이에요.' end;
  lines := array[head, '완료율 높은 순 · ' || nrank || '명'] || body || array[tail];

  /* 한 통에 들어가면 그대로 */
  if public._sms_bytes(array_to_string(lines, E'\n')) <= limitb then
    return jsonb_build_object('texts', jsonb_build_array(array_to_string(lines, E'\n')), 'students', nrank, 'low', nlow);
  end if;
  /* 나눈다 — 첫 통은 첫 줄 끝에, 다음 통은 「[과제 현황] 반 (2/3)」 머리 (꼬리 「(9/9)」 자리를 남겨 두고 채운 뒤 바꾼다) */
  cur := head || ' (#/#)' || E'\n' || lines[2];
  for k in 3 .. coalesce(array_length(lines, 1), 0) loop
    ln := lines[k];
    if public._sms_bytes(cur || E'\n' || ln) > limitb - 4 then
      parts := parts || cur;
      cur := '[과제 현황] ' || p_class || ' (#/#)' || E'\n' || ln;
    else
      cur := cur || E'\n' || ln;
    end if;
  end loop;
  parts := parts || cur;
  n := array_length(parts, 1);
  for k in 1 .. n loop
    parts[k] := replace(parts[k], '(#/#)', '(' || k || '/' || n || ')');
  end loop;
  return jsonb_build_object('texts', to_jsonb(parts), 'students', nrank, 'low', nlow);
end;
$$;
revoke all on function public._hws_texts(text, date, text, jsonb, integer) from public, anon, authenticated;


-- ------------------------------------------------------------
--  5. 보낼 줄 — 자동(p_class 없음) · 지금 보내기(p_class · p_by) · 미리보기(p_dry)
--     p_items { 반이름: [{ id, done, total, known }] }
-- ------------------------------------------------------------
create or replace function public.hw_status_prepare(p_now timestamptz, p_items jsonb, p_class text default null, p_by text default null, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  now0 timestamptz := coalesce(p_now, now());
  d date := (now0 at time zone 'Asia/Seoul')::date;
  manual boolean := coalesce(btrim(p_class), '') <> '';
  byname text := coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(coalesce(p_by, '')) limit 1), '');
  cut int := public._hws_cut();
  c record; p record;
  t jsonb; texts text[]; txt text;
  rows jsonb := '[]'::jsonb; previews jsonb := '[]'::jsonb; people jsonb;
  b uuid; lid uuid; nid bigint; seen text[]; k int;
begin
  for c in
    select k0.* from public.classes k0
     where case when manual then k0.name = btrim(p_class) and not k0.archived and k0.start_time is not null and public._note_lesson_today(k0.name, d)
                else k0.name in (select x.name from public._hws_due_classes(now0) x) end
       and p_items ? k0.name
     order by k0.name
  loop
    t := public._hws_texts(c.name, d, to_char(c.start_time, 'HH24:MI'), p_items -> c.name, cut);
    select array_agg(v order by o) into texts from jsonb_array_elements_text(t -> 'texts') with ordinality as e(v, o);
    people := coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'teacher', x.role = 'teacher', 'on', x.on_, 'phone', x.phone <> '', 'last4', right(x.phone, 4)))
                          from public._hws_people() x), '[]'::jsonb);
    if coalesce(p_dry, false) then
      previews := previews || jsonb_build_object('class', c.name, 'texts', to_jsonb(texts), 'people', people, 'cut', cut,
                                                 'sent', (select to_char(max(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI') from public.hw_status_log g where g.day = d and g.class_name = c.name));
      continue;
    end if;
    /* 같은 날 같은 반 한 번 (자동) — 지금 보내기는 따로 남긴다 */
    b := gen_random_uuid();
    insert into public.hw_status_log (day, class_name, manual, batch_id, by_name, students, low, parts)
    values (d, c.name, manual, b, case when manual then byname else '자동' end, (t ->> 'students')::int, (t ->> 'low')::int, coalesce(array_length(texts, 1), 1))
      on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '과제 현황(운영진)', 'hwstat', texts[1], case when manual then coalesce(p_by, '') else '자동' end);
    seen := '{}';
    for p in select * from public._hws_people() loop
      if not p.on_ then continue; end if;
      if p.phone = '' then
        insert into public.sms_log (batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, status, error, created_by, finished_at, copy_state)
        values (b, null, 'staff', p.name, c.name, '', 'LMS', left(texts[1], 60), 'fail', '번호 없음', case when manual then coalesce(p_by, '') else '자동' end, now(), 'none');
        continue;
      end if;
      if p.phone = any(seen) then continue; end if;
      seen := seen || p.phone;
      for k in 1 .. coalesce(array_length(texts, 1), 0) loop
        txt := texts[k];
        lid := gen_random_uuid();
        insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by, copy_state)
        values (lid, b, null, 'staff', p.name, c.name, right(p.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60),
                case when manual then coalesce(p_by, '') else '자동' end, 'none');
        rows := rows || jsonb_build_object('log_id', lid, 'to', p.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                           'class', c.name, 'who', 'staff', 'name', p.name);
      end loop;
    end loop;
    nid := null;
  end loop;
  if coalesce(p_dry, false) then return jsonb_build_object('ok', true, 'day', d, 'previews', previews); end if;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.hw_status_prepare(timestamptz, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.hw_status_prepare(timestamptz, jsonb, text, text, boolean) to service_role;

create or replace function public.hw_status_record(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.sms_log set status = case when (r ->> 'ok')::boolean then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 200), message_id = coalesce(r ->> 'message_id', ''), finished_at = now()
     where id = (r ->> 'log_id')::uuid and target = 'staff';
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
revoke all on function public.hw_status_record(jsonb) from public, anon, authenticated;
grant execute on function public.hw_status_record(jsonb) to service_role;


-- ------------------------------------------------------------
--  6. 「오늘」 반 카드 — 그날 마지막으로 보낸 것 (운영진)
--     { 반: { at: '09:10', manual, by, people: 받은 사람 수, failed, nophone, low } }
-- ------------------------------------------------------------
create or replace function public.hw_status_status(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(g.class_name, jsonb_build_object(
             'at', to_char(g.created_at at time zone 'Asia/Seoul', 'HH24:MI'), 'manual', g.manual, 'by', g.by_name, 'low', g.low, 'students', g.students,
             'people', (select count(distinct l.name || l.phone_last4) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'ok'),
             'pending', (select count(*) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'pending'),
             'failed', (select count(distinct l.name) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'fail' and l.error <> '번호 없음'),
             'nophone', (select count(*) from public.sms_log l where l.batch_id = g.batch_id and l.error = '번호 없음')))
      from (select distinct on (x.class_name) x.* from public.hw_status_log x where x.day = d order by x.class_name, x.created_at desc) g), '{}'::jsonb);
end;
$$;
revoke all on function public.hw_status_status(date) from public, anon;
grant execute on function public.hw_status_status(date) to authenticated;


-- ============================================================
--  확인 — 모두 true · 마지막 줄은 받는 운영진 (번호 뒤 4자리 · 번호 없음)
-- ============================================================
select '받기 칸' as what, exists (select 1 from information_schema.columns where table_name = 'staff' and column_name = 'hw_status')::text as ok
union all select '기준 ' || public._hws_cut() || '%', 'true'
union all select '보낼 함수', (exists (select 1 from pg_proc where proname = 'hw_status_prepare') and exists (select 1 from pg_proc where proname = 'hw_status_due'))::text
union all select '받는 사람: ' || coalesce((select string_agg(name || case when not on_ then '(끔)' when phone = '' then '(번호 없음)' else '(' || right(phone, 4) || ')' end, ' / ')
                                           from public._hws_people()), '없음'), 'true';
