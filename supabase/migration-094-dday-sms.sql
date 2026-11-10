-- ============================================================
--  migration-094-dday-sms.sql — 「D-day 문자」 매일 자동 발송 (20261110c)
--  (094 는 093 다음 · 064(사본) · 071 · 085 가 먼저 · 여러 번 실행해도 안전 · 함수 note-remind 다시 배포)
--
--  1. D-day 목록 dday_list — 이름 · 문자용 짧은 이름(비우면 이름) · 날짜 · 대상 학년(비우면 「전체」)
--       학생마다 그 학생 학년에 드는 D-day 중 오늘 이후 가장 먼저 오는 것 → n (당일 D-DAY · 지나면 다음 · 없으면 안 보냄)
--       러닝노트 홈 프로필 카드 D-day 도 이것 (hub_dday)
--  2. 오늘의 명언 dday_quotes (분야 · 인물(관리용) · 켜기/끄기) · 내 문장 dday_mine (특정 날짜 · 특정 D-n 이면 명언 대신)
--       하루 한 명언(모든 학생 같음) · 랜덤 · 켜진 명언을 한 바퀴 다 쓰기 전에는 다시 안 나옴 (dday_plan · cycle)
--       기본 명언 500개는 migration-095 가 넣는다
--  3. 설정 dday_cfg (한 줄) — 보내는 시각(기본 06:00 · 밤 쉬기 규칙 예외) · 문자 모양(기본 「{짧은이름} D-{n} {명언}」)
--       일시정지 · 받지 않는 반 · 받지 않는 학생 · D-day 문자 발신번호(코치룸 설정에서 넣는다 · 저장소에는 없다) · 발신번호 등록 상태
--  4. 발송 — note-remind 매분: dday_due → (발신번호 솔라피 등록 확인) → dday_prepare(같은 날 한 번 · 학생마다 한 번) → 솔라피 → dday_record
--       재원 학생 본인만(학부모 없음) · 번호 없는 학생은 빠짐 · 보낸 기록 「D-day 문자」(목적 dday) · 사본 규칙 그대로(시험 번호로)
--  5. 코치룸 — dday_status · dday_preview(앞으로 7일) · dday_cfg_save · [시험 발송] dday_test_prepare(내 시험 번호로만 · 기록은 시험 줄)
-- ============================================================

-- ------------------------------------------------------------
--  1. 표
-- ------------------------------------------------------------
create table if not exists public.dday_list (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short text not null default '',
  day date not null,
  grades text[] not null default '{}',              -- 비면 전체(모든 학년)
  created_at timestamptz not null default now(),
  constraint dday_list_len check (char_length(name) between 1 and 40 and char_length(short) <= 20)
);
create table if not exists public.dday_quotes (
  id bigserial primary key,
  body text not null,
  field text not null default '',
  author text not null default '',
  on_ boolean not null default true,
  used_cycle int not null default 0,
  created_at timestamptz not null default now(),
  constraint dday_quotes_body_uq unique (body),
  constraint dday_quotes_len check (char_length(body) between 1 and 600 and char_length(field) <= 20 and char_length(author) <= 60)
);
create table if not exists public.dday_mine (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  on_date date,                                      -- 이 날짜면
  on_n int,                                          -- 이 D-n 이면 (0 = D-DAY)
  on_ boolean not null default true,
  created_at timestamptz not null default now(),
  constraint dday_mine_len check (char_length(body) between 1 and 600),
  constraint dday_mine_when check (on_date is not null or on_n is not null),
  constraint dday_mine_n check (on_n is null or on_n between 0 and 999)
);
create table if not exists public.dday_plan (
  day date primary key,
  quote_id bigint references public.dday_quotes(id) on delete set null,
  cycle int not null default 1,
  at timestamptz not null default now()
);
create table if not exists public.dday_cfg (
  id int primary key default 1,
  send_time time not null default '06:00',
  tpl text not null default '{짧은이름} D-{n} {명언}',
  paused boolean not null default false,
  sender text not null default '',
  sender_state text not null default 'unknown',      -- unknown · ok · unregistered
  sender_checked timestamptz,
  cycle int not null default 1,
  classes_off text[] not null default '{}',
  students_off uuid[] not null default '{}',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint dday_cfg_one check (id = 1),
  constraint dday_cfg_tpl check (char_length(tpl) between 1 and 300),
  constraint dday_cfg_state check (sender_state in ('unknown', 'ok', 'unregistered'))
);
insert into public.dday_cfg (id) values (1) on conflict (id) do nothing;
create table if not exists public.dday_runs (
  day date primary key,
  at timestamptz not null default now(),
  sent int not null default 0,
  failed int not null default 0,
  nophone int not null default 0,
  nodday int not null default 0
);
create table if not exists public.dday_log (
  day date not null,
  student_id uuid not null references public.students(id) on delete cascade,
  log_id uuid,
  ok boolean,
  error text not null default '',
  at timestamptz not null default now(),
  primary key (day, student_id)                      -- 같은 날 같은 학생에게 한 번
);

do $$
declare t text;
begin
  foreach t in array array['dday_list', 'dday_quotes', 'dday_mine', 'dday_plan', 'dday_cfg', 'dday_runs', 'dday_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
  end loop;
  /* 목록 · 명언 · 내 문장은 코치룸에서 바로 고친다 (학생 정보 아님) */
  foreach t in array array['dday_list', 'dday_quotes', 'dday_mine'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_staff_write', t);
  end loop;
end;
$$;
grant select, insert, update, delete on public.dday_list, public.dday_quotes, public.dday_mine to authenticated;
grant usage, select on sequence public.dday_quotes_id_seq to authenticated;
grant select on public.dday_plan, public.dday_cfg, public.dday_runs, public.dday_log to authenticated;


-- ------------------------------------------------------------
--  2. 계산
-- ------------------------------------------------------------
create or replace function public._dday_kst(p_now timestamptz) returns date language sql stable as $$
  select (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
$$;
/* 그 학년에 드는 D-day 중 그날 이후 가장 먼저 오는 것 */
create or replace function public._dday_for(p_grade text, p_day date)
returns public.dday_list language sql stable security definer set search_path = public as $$
  select d.* from public.dday_list d
   where d.day >= p_day and (cardinality(d.grades) = 0 or btrim(coalesce(p_grade, '')) = any(d.grades))
   order by d.day, d.created_at limit 1;
$$;
/* 문자 한 줄 — {학생이름} {짧은이름} {n} {명언} · D-0 은 「D-DAY」 · 남은 칸 · 겹친 띄어쓰기 정리 */
create or replace function public._dday_text(p_tpl text, p_name text, p_short text, p_n int, p_quote text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           replace(replace(replace(replace(coalesce(p_tpl, ''), '{학생이름}', coalesce(p_name, '')), '{짧은이름}', coalesce(p_short, '')),
                   '{n}', case when p_n = 0 then 'DAY' else p_n::text end), '{명언}', coalesce(p_quote, '')),
           ' {2,}', ' ', 'g'));
$$;
/* 그날 명언 — 정해 둔 것이 있고 아직 켜져 있으면 그대로 · 아니면 이번 바퀴에서 안 쓴 것 중 랜덤 (다 썼으면 다음 바퀴) */
create or replace function public._dday_plan(p_day date)
returns public.dday_quotes language plpgsql security definer set search_path = public as $$
declare q public.dday_quotes; cy int;
begin
  select x.* into q from public.dday_plan p join public.dday_quotes x on x.id = p.quote_id where p.day = p_day and x.on_;
  if found then return q; end if;
  select cycle into cy from public.dday_cfg where id = 1 for update;
  select * into q from public.dday_quotes where on_ and used_cycle < cy order by random() limit 1;
  if not found then
    cy := cy + 1;
    update public.dday_cfg set cycle = cy where id = 1;
    select * into q from public.dday_quotes where on_ and used_cycle < cy order by random() limit 1;
    if not found then return null; end if;
  end if;
  update public.dday_quotes set used_cycle = cy where id = q.id;
  insert into public.dday_plan (day, quote_id, cycle, at) values (p_day, q.id, cy, now())
  on conflict (day) do update set quote_id = excluded.quote_id, cycle = excluded.cycle, at = now();
  return q;
end;
$$;
/* 내 문장 — 그 날짜가 먼저 · 그다음 그 D-n */
create or replace function public._dday_mine(p_day date, p_n int)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.body from public.dday_mine m where m.on_ and m.on_date = p_day order by m.created_at desc limit 1),
    (select m.body from public.dday_mine m where m.on_ and m.on_date is null and m.on_n = p_n order by m.created_at desc limit 1));
$$;
/* 받는 학생 — 재원 · 이름 있음 · 받지 않는 반 · 학생 빼고 */
create or replace function public._dday_targets()
returns table (id uuid, name text, class_name text, grade text, phone text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, coalesce(s.class_name, ''), coalesce(s.grade, ''), regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g')
    from public.students s, public.dday_cfg c
   where c.id = 1 and not s.archived and btrim(coalesce(s.name, '')) <> ''
     and not (coalesce(s.class_name, '') = any(c.classes_off)) and not (s.id = any(c.students_off))
   order by s.class_name, s.name;
$$;
/* 그날 학생 하나의 글 — { dday, short, n, text, mine } (D-day 가 없으면 null) */
create or replace function public._dday_one(p_day date, p_name text, p_grade text, p_tpl text, p_quote text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.dday_list; n int; mine text; sh text;
begin
  select * into d from public._dday_for(p_grade, p_day);
  if d.id is null then return null; end if;
  n := d.day - p_day;
  sh := coalesce(nullif(btrim(d.short), ''), d.name);
  mine := public._dday_mine(p_day, n);
  return jsonb_build_object('dday', d.name, 'dday_id', d.id, 'day', d.day, 'short', sh, 'n', n, 'mine', mine is not null,
                            'text', public._dday_text(p_tpl, p_name, sh, n, coalesce(mine, p_quote)));
end;
$$;


-- ------------------------------------------------------------
--  3. 코치룸 — 설정 · 미리보기 · 상태
-- ------------------------------------------------------------
create or replace function public.dday_cfg_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); snd text;
begin
  if not public.is_staff() then raise exception '직원만 할 수 있습니다.'; end if;
  if p ? 'send_time' and coalesce(p ->> 'send_time', '') !~ '^([01]\d|2[0-1]):[0-5]\d$' then return jsonb_build_object('ok', false, 'reason', 'time', 'message', '보내는 시각은 00:00 ~ 21:59 사이로 적어 주세요.'); end if;
  if p ? 'tpl' and (btrim(coalesce(p ->> 'tpl', '')) = '' or char_length(p ->> 'tpl') > 300) then return jsonb_build_object('ok', false, 'reason', 'tpl', 'message', '문자 모양을 적어 주세요.'); end if;
  if p ? 'sender' then
    snd := regexp_replace(coalesce(p ->> 'sender', ''), '\D', '', 'g');
    if snd <> '' and snd !~ '^0\d{8,10}$' then return jsonb_build_object('ok', false, 'reason', 'sender', 'message', '발신번호를 확인해 주세요.'); end if;
  end if;
  update public.dday_cfg set
    send_time = case when p ? 'send_time' then (p ->> 'send_time')::time else send_time end,
    tpl = case when p ? 'tpl' then btrim(p ->> 'tpl') else tpl end,
    paused = case when p ? 'paused' then coalesce((p ->> 'paused')::boolean, paused) else paused end,
    sender = case when p ? 'sender' then snd else sender end,
    sender_state = case when p ? 'sender' and snd is distinct from sender then 'unknown' else sender_state end,
    sender_checked = case when p ? 'sender' and snd is distinct from sender then null else sender_checked end,
    classes_off = case when jsonb_typeof(p -> 'classes_off') = 'array' then array(select jsonb_array_elements_text(p -> 'classes_off')) else classes_off end,
    students_off = case when jsonb_typeof(p -> 'students_off') = 'array' then array(select (x)::uuid from jsonb_array_elements_text(p -> 'students_off') x where x ~ '^[0-9a-f-]{36}$') else students_off end,
    updated_by = me, updated_at = now()
   where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dday_cfg_save(jsonb) from public, anon;
grant execute on function public.dday_cfg_save(jsonb) to authenticated;

/* 앞으로 n일 — 날짜 · 기준 D-day · D-n · 실제로 나갈 글 · 대상 수 · 단문/장문 (그날 명언을 미리 정해 둔다) */
create or replace function public.dday_preview(p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.dday_cfg; d0 date := public._dday_kst(now()); d date; q public.dday_quotes; t record; one jsonb;
  out jsonb := '[]'::jsonb; groups jsonb; k text; nph int; nod int;
begin
  if not public.is_staff() then raise exception '직원만 볼 수 있습니다.'; end if;
  select * into c from public.dday_cfg where id = 1;
  for i in 0 .. greatest(0, least(coalesce(p_days, 7), 14)) - 1 loop
    d := d0 + i;
    q := public._dday_plan(d);
    groups := '{}'::jsonb; nph := 0; nod := 0;
    for t in select * from public._dday_targets() loop
      one := public._dday_one(d, t.name, t.grade, c.tpl, q.body);
      if one is null then nod := nod + 1; continue; end if;
      if not public._phone_ok(t.phone) then nph := nph + 1; continue; end if;
      k := (one ->> 'dday_id') || '|' || (one ->> 'n') || '|' || case when position('{학생이름}' in c.tpl) > 0 then '' else 'x' end;
      if groups ? k then
        groups := jsonb_set(groups, array[k, 'count'], to_jsonb((groups -> k ->> 'count')::int + 1));
      else
        groups := groups || jsonb_build_object(k, jsonb_build_object('dday', one ->> 'dday', 'short', one ->> 'short', 'n', (one ->> 'n')::int, 'mine', (one ->> 'mine')::boolean,
          'text', one ->> 'text', 'bytes', public._sms_bytes(one ->> 'text'), 'kind', case when public._sms_bytes(one ->> 'text') > 90 then 'LMS' else 'SMS' end, 'count', 1));
      end if;
    end loop;
    out := out || jsonb_build_object('day', d, 'quote', q.body, 'quote_id', q.id, 'field', q.field, 'author', q.author,
      'groups', coalesce((select jsonb_agg(v order by (v ->> 'n')::int) from jsonb_each(groups) e(kk, v)), '[]'::jsonb), 'nophone', nph, 'nodday', nod);
  end loop;
  return jsonb_build_object('ok', true, 'days', out, 'paused', c.paused, 'send_time', to_char(c.send_time, 'HH24:MI'));
end;
$$;
revoke all on function public.dday_preview(int) from public, anon;
grant execute on function public.dday_preview(int) to authenticated;

/* 상태 — 설정 · 오늘 보냄 · 날짜별 기록(실패 이유) · 번호 없는 학생 */
create or replace function public.dday_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.dday_cfg; d0 date := public._dday_kst(now());
begin
  if not public.is_staff() then raise exception '직원만 볼 수 있습니다.'; end if;
  select * into c from public.dday_cfg where id = 1;
  return jsonb_build_object('ok', true,
    'cfg', jsonb_build_object('send_time', to_char(c.send_time, 'HH24:MI'), 'tpl', c.tpl, 'paused', c.paused, 'sender', c.sender,
                              'sender_state', c.sender_state, 'sender_checked', c.sender_checked, 'classes_off', to_jsonb(c.classes_off), 'students_off', to_jsonb(c.students_off), 'cycle', c.cycle),
    'today', d0,
    'today_run', (select to_jsonb(r) from public.dday_runs r where r.day = d0),
    'today_sent', (select count(*) from public.dday_log g where g.day = d0 and g.ok),
    'today_failed', (select count(*) from public.dday_log g where g.day = d0 and g.ok is false),
    'days', coalesce((select jsonb_agg(x order by x.day desc) from (
        select g.day, count(*) filter (where g.ok) sent, count(*) filter (where g.ok is false) failed,
               coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'error', g.error)) filter (where g.ok is false), '[]'::jsonb) fails
          from public.dday_log g left join public.students s on s.id = g.student_id
         where g.day >= d0 - 30 group by g.day) x), '[]'::jsonb),
    'nophone', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'class', t.class_name)) from public._dday_targets() t where not public._phone_ok(t.phone)), '[]'::jsonb),
    'quotes', jsonb_build_object('all', (select count(*) from public.dday_quotes), 'on', (select count(*) from public.dday_quotes where on_),
                                 'left', (select count(*) from public.dday_quotes where on_ and used_cycle < c.cycle)));
end;
$$;
revoke all on function public.dday_status() from public, anon;
grant execute on function public.dday_status() to authenticated;

/* 명언 여러 줄 붙여 넣기 — 한 줄에 하나 · 빈 줄 · 같은 문장은 건너뜀 */
create or replace function public.dday_quote_add(p_lines text, p_field text, p_author text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare l text; n int := 0; k int := 0;
begin
  if not public.is_staff() then raise exception '직원만 할 수 있습니다.'; end if;
  foreach l in array regexp_split_to_array(coalesce(p_lines, ''), E'\r?\n') loop
    l := btrim(l);
    if l = '' or char_length(l) > 600 then continue; end if;
    k := k + 1;
    insert into public.dday_quotes (body, field, author) values (l, left(btrim(coalesce(p_field, '')), 20), left(btrim(coalesce(p_author, '')), 60))
    on conflict (body) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', n, 'lines', k);
end;
$$;
revoke all on function public.dday_quote_add(text, text, text) from public, anon;
grant execute on function public.dday_quote_add(text, text, text) to authenticated;

/* [시험 발송] — 오늘 글(첫 대상 학생 기준)을 내 시험 번호로 한 통 · 기록은 시험 줄 (반 숫자 · 오늘 보냄에 안 셈) */
create or replace function public.dday_test_prepare()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); c public.dday_cfg; d0 date := public._dday_kst(now());
  ph text; q public.dday_quotes; t record; one jsonb; b uuid := gen_random_uuid(); lid uuid := gen_random_uuid();
begin
  if not public.is_staff() then raise exception '직원만 할 수 있습니다.'; end if;
  select * into c from public.dday_cfg where id = 1;
  select regexp_replace(phone, '\D', '', 'g') into ph from public.kakao_test_phones where lower(email) = me;
  if not public._phone_ok(ph) then return jsonb_build_object('ok', false, 'reason', 'nophone', 'message', '내 번호를 먼저 넣어 주세요.'); end if;
  if c.sender = '' then return jsonb_build_object('ok', false, 'reason', 'nosender', 'message', 'D-day 문자 발신번호를 먼저 넣어 주세요.'); end if;
  if c.sender_state = 'unregistered' then return jsonb_build_object('ok', false, 'reason', 'unregistered', 'message', '솔라피에 등록되지 않은 발신번호예요 · 등록 후 보낼 수 있어요'); end if;
  q := public._dday_plan(d0);
  for t in select * from public._dday_targets() loop
    one := public._dday_one(d0, t.name, t.grade, c.tpl, q.body);
    exit when one is not null;
  end loop;
  if one is null then return jsonb_build_object('ok', false, 'reason', 'nodday', 'message', '오늘 보낼 D-day 가 없어요.'); end if;
  insert into public.sms_batches (id, label, purpose, body, test, created_by) values (b, 'D-day 문자', 'dday', c.tpl, true, me);
  insert into public.sms_log (id, batch_id, student_id, target, name, class_name, test, phone_last4, kind, body_head, created_by)
  values (lid, b, null, 'test', '시험', '', true, right(ph, 4), case when public._sms_bytes(one ->> 'text') > 90 then 'LMS' else 'SMS' end, left(one ->> 'text', 60), me);
  return jsonb_build_object('ok', true, 'from', c.sender, 'rows', jsonb_build_array(jsonb_build_object('log_id', lid, 'to', ph, 'text', one ->> 'text',
    'kind', case when public._sms_bytes(one ->> 'text') > 90 then 'LMS' else 'SMS' end, 'name', '시험')));
end;
$$;
revoke all on function public.dday_test_prepare() from public, anon;
grant execute on function public.dday_test_prepare() to authenticated;


-- ------------------------------------------------------------
--  4. 발송 (note-remind 매분 · service_role)
-- ------------------------------------------------------------
/* 지금 보낼 때인가 — 일시정지 아님 · 발신번호 있음 · 보내는 시각 지남(그날 22시 전까지 · 밤 쉬기 규칙 예외로 이른 아침에도) · 오늘 아직 안 보냄 */
create or replace function public.dday_due(p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.dday_cfg; k timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
begin
  select * into c from public.dday_cfg where id = 1;
  if not found then return jsonb_build_object('due', false, 'reason', 'nocfg'); end if;
  if c.paused then return jsonb_build_object('due', false, 'reason', 'paused'); end if;
  if c.sender = '' then return jsonb_build_object('due', false, 'reason', 'nosender'); end if;
  if k::time < c.send_time or k::time >= time '22:00' then return jsonb_build_object('due', false, 'reason', 'time'); end if;
  if exists (select 1 from public.dday_runs where day = k::date) then return jsonb_build_object('due', false, 'reason', 'done'); end if;
  return jsonb_build_object('due', true, 'day', k::date, 'sender', c.sender, 'sender_state', c.sender_state, 'sender_checked', c.sender_checked,
    /* 등록 안 된 번호는 10분에 한 번만 다시 묻는다 */
    'recheck', c.sender_state <> 'unregistered' or c.sender_checked is null or c.sender_checked < coalesce(p_now, now()) - interval '10 minutes');
end;
$$;
/* 발신번호 등록 상태 (함수가 솔라피에 물어본 결과) */
create or replace function public.dday_sender_set(p_state text, p_now timestamptz default null)
returns void language sql security definer set search_path = public as $$
  update public.dday_cfg set sender_state = case when p_state in ('ok', 'unregistered', 'unknown') then p_state else sender_state end, sender_checked = coalesce(p_now, now()) where id = 1;
$$;
drop function if exists public.dday_sender_set(text);
/* 보낼 줄 만들기 — 오늘 한 번(dday_runs) · 학생마다 한 번(dday_log) · 번호 없는 학생 · D-day 없는 학생은 빠짐 */
create or replace function public.dday_prepare(p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.dday_cfg; due jsonb := public.dday_due(p_now); d date; q public.dday_quotes; t record; one jsonb;
  b uuid; lid uuid; rows jsonb := '[]'::jsonb; nph int := 0; nod int := 0; txt text;
begin
  if not coalesce((due ->> 'due')::boolean, false) then return jsonb_build_object('ok', true, 'rows', rows, 'reason', due ->> 'reason'); end if;
  d := (due ->> 'day')::date;
  insert into public.dday_runs (day) values (d) on conflict (day) do nothing;
  if not found then return jsonb_build_object('ok', true, 'rows', rows, 'reason', 'done'); end if;
  select * into c from public.dday_cfg where id = 1;
  q := public._dday_plan(d);
  for t in select * from public._dday_targets() loop
    one := public._dday_one(d, t.name, t.grade, c.tpl, q.body);
    if one is null then nod := nod + 1; continue; end if;
    if not public._phone_ok(t.phone) then nph := nph + 1; continue; end if;
    txt := one ->> 'text';
    if position('{' in txt) > 0 and txt ~ '\{[^{}]{1,20}\}' then nod := nod + 1; continue; end if;      /* 바뀌지 않은 칸 — 보내지 않음 */
    insert into public.dday_log (day, student_id) values (d, t.id) on conflict do nothing;
    if not found then continue; end if;
    if b is null then
      b := gen_random_uuid();
      insert into public.sms_batches (id, label, purpose, body, created_by) values (b, 'D-day 문자', 'dday', c.tpl, '자동');
    end if;
    lid := gen_random_uuid();
    insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
    values (lid, b, t.id, 'student', t.name, t.class_name, right(t.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
    update public.dday_log set log_id = lid where day = d and student_id = t.id;
    rows := rows || jsonb_build_object('log_id', lid, 'to', t.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, 'name', t.name, 'class', t.class_name);
  end loop;
  update public.dday_runs set nophone = nph, nodday = nod where day = d;
  return jsonb_build_object('ok', true, 'day', d, 'from', c.sender, 'rows', rows, 'nophone', nph, 'nodday', nod);
end;
$$;
create or replace function public.dday_record(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; d date;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.sms_log set status = case when (r ->> 'ok')::boolean then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 200), message_id = coalesce(r ->> 'message_id', ''), finished_at = now()
     where id = (r ->> 'log_id')::uuid;
    update public.dday_log set ok = (r ->> 'ok')::boolean, error = left(coalesce(r ->> 'error', ''), 200) where log_id = (r ->> 'log_id')::uuid returning day into d;
    n := n + 1;
  end loop;
  if d is not null then
    update public.dday_runs set sent = (select count(*) from public.dday_log where day = d and ok), failed = (select count(*) from public.dday_log where day = d and ok is false) where day = d;
  end if;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
/* 발신번호가 막혀 모두 실패한 날 — 그날 기록을 지워 승인되면 다시 보내지게 */
create or replace function public.dday_reset_day(p_day date)
returns void language sql security definer set search_path = public as $$
  delete from public.dday_log where day = p_day and ok is not true;
  delete from public.dday_runs r where r.day = p_day and not exists (select 1 from public.dday_log g where g.day = p_day and g.ok);
$$;
do $$
declare f text;
begin
  foreach f in array array['public.dday_due(timestamptz)', 'public.dday_sender_set(text, timestamptz)', 'public.dday_prepare(timestamptz)', 'public.dday_record(jsonb)', 'public.dday_reset_day(date)',
                           'public._dday_plan(date)', 'public._dday_targets()', 'public._dday_one(date, text, text, text, text)', 'public._dday_for(text, date)', 'public._dday_mine(date, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  5. 러닝노트 홈 — 그 학생 학년의 가장 가까운 D-day
-- ------------------------------------------------------------
create or replace function public.hub_dday(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; d public.dday_list; d0 date := public._dday_kst(now());
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  if not exists (select 1 from public.dday_list) then return null; end if;     /* 목록이 비어 있으면 예전 반 시험 D-day 그대로 */
  select * into d from public._dday_for(s.grade, d0);
  if d.id is null then return jsonb_build_object('none', true); end if;
  return jsonb_build_object('name', d.name, 'short', coalesce(nullif(btrim(d.short), ''), d.name), 'day', d.day, 'n', d.day - d0);
end;
$$;
revoke all on function public.hub_dday(text) from public;
grant execute on function public.hub_dday(text) to anon, authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select 'D-day 목록 · 명언 · 내 문장 · 설정 표' as what, (to_regclass('public.dday_list') is not null and to_regclass('public.dday_quotes') is not null and to_regclass('public.dday_mine') is not null and to_regclass('public.dday_cfg') is not null)::text as ok
union all select '하루 한 번 · 학생마다 한 번(dday_runs · dday_log)', (to_regclass('public.dday_runs') is not null and to_regclass('public.dday_log') is not null)::text
union all select '기본 문자 모양 「' || (select tpl from public.dday_cfg where id = 1) || '」 · ' || (select to_char(send_time, 'HH24:MI') from public.dday_cfg where id = 1), 'true'
union all select '발신번호는 설정에서(저장소에 없음) — ' || case when (select sender from public.dday_cfg where id = 1) = '' then '아직 비어 있음 · 코치룸에서 넣기' else '들어 있음' end, 'true'
union all select '발송 함수(note-remind 전용)', ((select count(*) from pg_proc where proname in ('dday_due', 'dday_prepare', 'dday_record', 'dday_sender_set')) = 4)::text
union all select '직원만 읽음(익명 정책 없음)', (not exists (select 1 from pg_policies where tablename like 'dday\_%' and 'anon' = any(roles)))::text
union all select '러닝노트 홈 D-day(hub_dday)', exists (select 1 from pg_proc where proname = 'hub_dday')::text;
