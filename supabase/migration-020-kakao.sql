-- ============================================================
--  마라톤 코치룸 — 카카오 알림톡 발송 (솔라피) (migration-020-kakao.sql)
--
--  실행 방법
--    019 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 기록 · 레포트는 바꾸지 않는다 (칸 하나 · 표 두 개 · 함수만 더한다).
--
--  1. students.parent_phone2 — 학부모 번호 2 (번호 1 · 호칭은 원래 있던 parent_phone · parent_title)
--     students 표는 원래부터 직원만 읽는다(RLS). 학생 · 학부모 링크 함수(hub_*)는 연락처를 하나도 돌려주지 않는다.
--  2. kakao_log — 알림톡을 보낸 기록. 누가 · 언제 · 어느 학생 · 어느 주 · 성공/실패와 이유.
--     번호는 뒤 4자리만 남긴다. 직원만 읽고, 고치거나 지우는 길은 없다 (아래 함수로만 쓴다).
--  3. kakao_test_phones — 직원 본인의 「나에게 시험 발송」 번호. 그 직원만 읽고 쓴다.
--  4. app_settings 'kakao' — 문자로 대신 보내기(기본 끔) · 하루 최대 건수(기본 300) · 1건 예상 비용(기본 13원)
--  5. 함수 (모두 직원만 — 조교 · 선생님 같다)
--     kakao_status(주)            ④ 발송 탭 상태: 번호 없음 / 공개 전 / 보낼 수 있음 / 보냄 / 실패 (번호는 가려서)
--     kakao_settings_get · kakao_settings_set · kakao_test_phone_set
--     kakao_prepare · kakao_record — Edge Function kakao-send 가 부른다 (발송 전 기록 줄 만들기 · 결과 적기)
--       · 공개된 레포트가 있는 학생만 · 같은 학생 · 같은 주에 이미 보냈으면 건너뜀(다시 보내기를 고른 때만 다시)
--       · 한 번에 100명 · 하루 최대 건수
-- ============================================================


-- ------------------------------------------------------------
--  1. 학부모 번호 2
-- ------------------------------------------------------------
alter table public.students add column if not exists parent_phone2 text not null default '';


-- ------------------------------------------------------------
--  2 · 3. 표
-- ------------------------------------------------------------
create table if not exists public.kakao_log (
  id            uuid primary key default gen_random_uuid(),
  week_start    date,
  student_id    uuid references public.students(id) on delete set null,
  test          boolean not null default false,          -- 나에게 시험 발송
  phone_last4   text not null default '',
  title         text not null default '',                -- 받는 사람 호칭
  status        text not null default 'pending',         -- pending 보내는 중 · ok 솔라피가 받음 · fail 실패
  error         text not null default '',
  message_id    text not null default '',
  sms_fallback  boolean not null default false,
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  constraint kakao_log_status_check check (status in ('pending', 'ok', 'fail')),
  constraint kakao_log_last4_check check (phone_last4 ~ '^[0-9]{0,4}$')
);
create index if not exists kakao_log_week_idx on public.kakao_log (week_start, student_id);
create index if not exists kakao_log_day_idx on public.kakao_log (created_at);
alter table public.kakao_log enable row level security;
drop policy if exists kakao_log_staff_read on public.kakao_log;
create policy kakao_log_staff_read on public.kakao_log for select to authenticated using (public.is_staff());

create table if not exists public.kakao_test_phones (
  email       text primary key,
  phone       text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.kakao_test_phones enable row level security;
drop policy if exists kakao_test_phones_own on public.kakao_test_phones;
create policy kakao_test_phones_own on public.kakao_test_phones for select to authenticated
  using (public.is_staff() and email = lower(coalesce(auth.jwt() ->> 'email', '')));

insert into public.app_settings (key, value) values ('kakao', '{"smsFallback": false, "dailyMax": 300, "unitWon": 13}'::jsonb)
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  도우미 (안에서만)
-- ------------------------------------------------------------
create or replace function public._phone_ok(p text)
returns boolean
language sql
immutable
as $$ select coalesce(regexp_replace(p, '\D', '', 'g') ~ '^01[016789][0-9]{7,8}$', false); $$;

create or replace function public._phone_mask(p text)
returns text
language sql
immutable
as $$
  select case when public._phone_ok(p)
    then left(regexp_replace(p, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(p, '\D', '', 'g'), 4)
    else '' end;
$$;

create or replace function public._kakao_cfg()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'smsFallback', coalesce((v ->> 'smsFallback')::boolean, false),
    'dailyMax', greatest(1, least(5000, coalesce((v ->> 'dailyMax')::int, 300))),
    'unitWon', greatest(0, least(1000, coalesce((v ->> 'unitWon')::int, 13))))
  from (select coalesce((select value from public.app_settings where key = 'kakao'), '{}'::jsonb) v) x;
$$;

/* 「10월 15일(목)」 */
create or replace function public._kdate(d date)
returns text
language sql
immutable
as $$
  select extract(month from d)::int || '월 ' || extract(day from d)::int || '일(' ||
         (array['일','월','화','수','목','금','토'])[extract(dow from d)::int + 1] || ')';
$$;

create or replace function public._kakao_today_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.kakao_log
  where (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date and status <> 'fail';
$$;


-- ------------------------------------------------------------
--  5. 화면용
-- ------------------------------------------------------------
create or replace function public.kakao_status(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'ok', true,
    'week', p_week,
    'cfg', public._kakao_cfg(),
    'today', public._kakao_today_count(),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'phones', (select coalesce(jsonb_agg(public._phone_mask(x)), '[]'::jsonb)
                     from unnest(array[s.parent_phone, s.parent_phone2]) x where public._phone_ok(x)),
        'title', coalesce(nullif(btrim(s.parent_title), ''), '학부모님'),
        'link', coalesce(l.hub_code, '') <> '',
        'published', exists (select 1 from public.published p where p.student_id = s.id and p.week_start = p_week and p.visible),
        'last', (select jsonb_build_object('status', k.status, 'at', coalesce(k.finished_at, k.created_at), 'error', k.error, 'last4', k.phone_last4)
                   from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test
                   order by (k.status = 'ok') desc, k.created_at desc limit 1)
      ) order by s.class_name, s.name)
      from public.students s left join public.student_links l on l.student_id = s.id
      where not s.archived
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.kakao_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._kakao_cfg() || jsonb_build_object(
    'testPhone', coalesce((select public._phone_mask(phone) from public.kakao_test_phones where email = me), ''),
    'today', public._kakao_today_count());
end;
$$;

create or replace function public.kakao_settings_set(p_sms boolean, p_daily integer, p_unit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_daily is null or p_daily < 1 or p_daily > 5000 then raise exception '하루 최대 건수는 1 ~ 5000 으로 정해 주세요.'; end if;
  if p_unit is null or p_unit < 0 or p_unit > 1000 then raise exception '1건 예상 비용은 0 ~ 1000원으로 적어 주세요.'; end if;
  insert into public.app_settings (key, value)
  values ('kakao', jsonb_build_object('smsFallback', coalesce(p_sms, false), 'dailyMax', p_daily, 'unitWon', p_unit))
  on conflict (key) do update set value = excluded.value;
  return public._kakao_cfg();
end;
$$;

/* 내 시험 번호 — 빈 칸이면 지운다 */
create or replace function public.kakao_test_phone_set(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if d = '' then
    delete from public.kakao_test_phones where email = me;
    return jsonb_build_object('ok', true, 'testPhone', '');
  end if;
  if not public._phone_ok(d) then raise exception '휴대폰 번호(010 …)를 확인해 주세요.'; end if;
  insert into public.kakao_test_phones (email, phone, updated_at) values (me, d, now())
  on conflict (email) do update set phone = excluded.phone, updated_at = now();
  return jsonb_build_object('ok', true, 'testPhone', public._phone_mask(d));
end;
$$;


-- ------------------------------------------------------------
--  5. Edge Function kakao-send 가 부른다 (부른 직원의 로그인 그대로)
-- ------------------------------------------------------------
/* 보낼 줄 만들기 — 기록 줄(pending)을 먼저 만들고, 보낼 번호 · 학부모 링크 코드 · 이름 · 수업일을 돌려준다 */
create or replace function public.kakao_prepare(p_week date, p_students uuid[], p_resend boolean default false, p_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._kakao_cfg();
  ids uuid[] := coalesce(p_students, '{}');
  rows jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  s record;
  ph text;
  n int := 0;
  tphone text;
  lid uuid;
  lesson text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_week is null then raise exception '주차를 골라 주세요.'; end if;
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '보낼 학생을 골라 주세요.'); end if;
  if cardinality(ids) > 100 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '한 번에 100명까지 보낼 수 있습니다.'); end if;

  if p_test then
    select phone into tphone from public.kakao_test_phones where email = me;
    if tphone is null or not public._phone_ok(tphone) then
      return jsonb_build_object('ok', false, 'reason', 'notest', 'message', '먼저 [설정]에서 내 시험 번호를 넣어 주세요.');
    end if;
  end if;

  for s in
    select st.id, st.name, st.parent_title, st.parent_phone, st.parent_phone2, coalesce(l.hub_code, '') as code,
           p.week_start as pw, p.report_data ->> 'lessonDate' as ld
    from unnest(ids) with ordinality u(id, ord)
    join public.students st on st.id = u.id and not st.archived
    left join public.student_links l on l.student_id = st.id
    left join public.published p on p.student_id = st.id and p.week_start = p_week and p.visible
    order by u.ord
  loop
    if s.pw is null then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'unpublished'); continue; end if;
    if s.code = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nolink'); continue; end if;
    lesson := public._kdate(case when coalesce(s.ld, '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.ld, 10)::date else s.pw end);

    if p_test then
      /* 시험 발송 — 첫 학생 내용으로 내 번호에 한 건만 */
      if public._kakao_today_count() + 1 > (cfg ->> 'dailyMax')::int then
        return jsonb_build_object('ok', false, 'reason', 'daily', 'message', '오늘 보낼 수 있는 건수(' || (cfg ->> 'dailyMax') || '건)를 다 썼습니다.');
      end if;
      insert into public.kakao_log (week_start, student_id, test, phone_last4, title, sms_fallback, created_by)
      values (p_week, s.id, true, right(regexp_replace(tphone, '\D', '', 'g'), 4), '시험', (cfg ->> 'smsFallback')::boolean, me)
      returning id into lid;
      rows := jsonb_build_array(jsonb_build_object('log_id', lid, 'student_id', s.id, 'to', regexp_replace(tphone, '\D', '', 'g'),
                'name', s.name, 'lesson', lesson, 'code', s.code));
      exit;
    end if;

    if not p_resend and exists (select 1 from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test and k.status = 'ok') then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'already'); continue;
    end if;
    if not (public._phone_ok(s.parent_phone) or public._phone_ok(s.parent_phone2)) then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nophone'); continue;
    end if;
    foreach ph in array array(select distinct regexp_replace(x, '\D', '', 'g') from unnest(array[s.parent_phone, s.parent_phone2]) x where public._phone_ok(x)) loop
      n := n + 1;
      rows := rows || jsonb_build_object('student_id', s.id, 'to', ph, 'name', s.name, 'lesson', lesson, 'code', s.code,
                'title', coalesce(nullif(btrim(s.parent_title), ''), '학부모님'));
    end loop;
  end loop;

  if p_test and jsonb_array_length(rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'unpublished', 'message', '이 주에 공개된 레포트가 있는 학생을 하나 골라 주세요.', 'skipped', skipped);
  end if;
  if not p_test and n > 0 and public._kakao_today_count() + n > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._kakao_today_count() || '건 · 이번 ' || n || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;

  /* 기록 줄 먼저 (보내는 중) */
  if not p_test then
    rows := coalesce((
      select jsonb_agg(r || jsonb_build_object('log_id', public._kakao_log_new(p_week, (r ->> 'student_id')::uuid, r ->> 'to', r ->> 'title', (cfg ->> 'smsFallback')::boolean, me)))
      from jsonb_array_elements(rows) r), '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'rows', rows, 'skipped', skipped, 'smsFallback', (cfg ->> 'smsFallback')::boolean, 'test', p_test);
end;
$$;

create or replace function public._kakao_log_new(p_week date, p_student uuid, p_to text, p_title text, p_sms boolean, p_by text)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.kakao_log (week_start, student_id, phone_last4, title, sms_fallback, created_by)
  values (p_week, p_student, right(regexp_replace(p_to, '\D', '', 'g'), 4), coalesce(p_title, ''), coalesce(p_sms, false), p_by)
  returning id;
$$;

/* 결과 적기 — [{log_id, ok, error, message_id}]. 보내는 중(pending)인 줄만 바꾼다. 성공하면 ④ 발송의 「보냄」도 (이미 있으면 그대로) */
create or replace function public.kakao_record(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r jsonb;
  k public.kakao_log;
  done int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception '결과 모양이 올바르지 않습니다.'; end if;
  for r in select * from jsonb_array_elements(p_results) loop
    update public.kakao_log
       set status = case when coalesce((r ->> 'ok')::boolean, false) then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 200),
           message_id = left(coalesce(r ->> 'message_id', ''), 80),
           finished_at = now()
     where id = (r ->> 'log_id')::uuid and status = 'pending'
     returning * into k;
    if found then
      done := done + 1;
      if k.status = 'ok' and not k.test and k.student_id is not null then
        insert into public.sent (week_start, student_id, via, sent_by) values (k.week_start, k.student_id, 'kakao', me)
        on conflict (week_start, student_id) do nothing;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'done', done);
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._phone_ok(text)', 'public._phone_mask(text)', 'public._kakao_cfg()', 'public._kdate(date)',
                           'public._kakao_today_count()', 'public._kakao_log_new(date, uuid, text, text, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.kakao_status(date)', 'public.kakao_settings_get()', 'public.kakao_settings_set(boolean, integer, integer)',
                           'public.kakao_test_phone_set(text)', 'public.kakao_prepare(date, uuid[], boolean, boolean)', 'public.kakao_record(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'parent_phone2' as what, exists (select 1 from information_schema.columns where table_name = 'students' and column_name = 'parent_phone2')::text as ok
union all select 'kakao_log', exists (select 1 from pg_tables where tablename = 'kakao_log' and rowsecurity)::text
union all select 'kakao_prepare', (not has_function_privilege('anon', 'public.kakao_prepare(date, uuid[], boolean, boolean)', 'execute'))::text;
