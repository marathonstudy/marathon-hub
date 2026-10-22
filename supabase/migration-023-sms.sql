-- ============================================================
--  마라톤 코치룸 — 사이트에서 문자 보내기 (SMS · LMS · 솔라피) (migration-023-sms.sql)
--
--  실행 방법
--    022 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 기록 · 레포트는 바꾸지 않는다 (표 두 개 · 설정 한 줄 · 함수만 더한다).
--  번호 칸은 새로 만들지 않는다 — 학부모 번호 1 · 2(parent_phone · parent_phone2), 학생 본인(student_phone) 을 그대로 쓴다.
--  students 표는 원래부터 직원만 읽는다(RLS). 학생 · 학부모 링크 함수(hub_*)는 연락처를 하나도 돌려주지 않는다.
--
--  1. sms_log — 사이트에서 보낸 문자 기록. 누가 · 언제 · 받는 사람 이름 · 번호 뒤 4자리 · 내용 앞부분 · 성공/실패와 이유.
--     직원만 읽고, 고치거나 지우는 길은 없다 (아래 함수로만 쓴다).
--  2. sms_templates — 「자주 쓰는 문구」 (직원 공용). 처음 실행할 때만 예시 3개(휴강 · 보강 · 레포트 안내)를 넣는다.
--  3. app_settings 'sms' — SMS · LMS 단가(20 · 50원) · 한 번 최대 200건 · 하루 최대 500건 · 광고 발신처 · 무료수신거부 번호
--  4. 함수 (모두 직원만 — 조교 · 선생님 같다)
--     sms_settings_get · sms_settings_set · sms_log_search(반 · 학생 · 날짜)
--     sms_prepare · sms_record — Edge Function sms-send 가 부른다. 화면은 학생 id 와 보낼 곳만 넘기고,
--       번호 · 링크 코드는 여기서 DB 로 찾는다. 같은 번호는 한 번만(형제는 확인받은 때만 따로) · 한 번 · 하루 상한 ·
--       광고 문자는 (광고) · 발신처 · 무료수신거부를 붙이고, 수신거부 번호가 없거나 밤(21시 ~ 8시)이면 막는다.
--  5. sent.via 에 'sitesms' (사이트 문자로 레포트를 보낸 학생의 「보냄」 표시)
-- ============================================================


-- ------------------------------------------------------------
--  1 · 2. 표
-- ------------------------------------------------------------
create table if not exists public.sms_log (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null,
  student_id    uuid references public.students(id) on delete set null,
  target        text not null default '',                -- parent1 · parent2 · student · test
  name          text not null default '',                -- 받는 사람(학생) 이름 — 보낸 때 이름
  class_name    text not null default '',
  test          boolean not null default false,          -- 나에게 시험 발송
  phone_last4   text not null default '',
  kind          text not null default 'SMS',             -- SMS · LMS
  ad            boolean not null default false,
  body_head     text not null default '',                -- 내용 앞부분 (60자)
  mark_week     date,                                    -- 성공하면 이 주 레포트를 「보냄」으로
  status        text not null default 'pending',         -- pending 보내는 중 · ok 솔라피가 받음 · fail 실패
  error         text not null default '',
  message_id    text not null default '',
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  constraint sms_log_status_check check (status in ('pending', 'ok', 'fail')),
  constraint sms_log_kind_check check (kind in ('SMS', 'LMS')),
  constraint sms_log_last4_check check (phone_last4 ~ '^[0-9]{0,4}$')
);
create index if not exists sms_log_day_idx on public.sms_log (created_at);
create index if not exists sms_log_student_idx on public.sms_log (student_id, created_at);
alter table public.sms_log enable row level security;
drop policy if exists sms_log_staff_read on public.sms_log;
create policy sms_log_staff_read on public.sms_log for select to authenticated using (public.is_staff());

create table if not exists public.sms_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  body        text not null default '',
  sort_order  integer not null default 0,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  constraint sms_templates_len check (char_length(title) <= 40 and char_length(body) <= 2000)
);
alter table public.sms_templates enable row level security;
drop policy if exists sms_templates_staff on public.sms_templates;
create policy sms_templates_staff on public.sms_templates for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

/* 예시 문구 — 설정 줄('sms')이 아직 없을 때(처음 실행)만. 지운 예시는 다시 생기지 않는다 */
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'sms') then
    insert into public.sms_templates (title, body, sort_order) values
      ('휴강 안내', E'[마라톤국어] #{반} 휴강 안내\n안녕하세요, 마라톤국어입니다. 이번 주 수업은 휴강입니다.\n다음 수업은 #{수업일}입니다. 감사합니다.', 1),
      ('보강 안내', E'[마라톤국어] #{반} 보강 안내\n#{이름} 학생 보강 일정을 알려 드립니다.\n일시: \n장소: \n감사합니다.', 2),
      ('레포트 안내', E'안녕하세요, 마라톤국어입니다.\n#{수업일} 수업 #{이름} 학생 레포트를 보내드립니다.\n#{링크}', 3);
  end if;
end;
$$;

insert into public.app_settings (key, value)
values ('sms', '{"smsWon": 20, "lmsWon": 50, "perSend": 200, "dailyMax": 500, "adName": "마라톤국어", "optout": ""}'::jsonb)
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  5. 「보냄」 표시 — 사이트 문자
-- ------------------------------------------------------------
alter table public.sent drop constraint if exists sent_via_check;
alter table public.sent add constraint sent_via_check check (via in ('sms', 'copy', 'share', 'kakao', 'sitesms'));


-- ------------------------------------------------------------
--  도우미 (안에서만)
-- ------------------------------------------------------------
/* 문자 길이 (바이트) — 한글 등은 2, 영문 · 숫자 · 기호 · 줄바꿈은 1. 90 바이트까지 단문(SMS), 넘으면 장문(LMS · 2000 바이트까지) */
create or replace function public._sms_bytes(t text)
returns integer
language sql
immutable
as $$ select octet_length(regexp_replace(coalesce(t, ''), '[^\x01-\x7F]', 'xx', 'g')); $$;

create or replace function public._sms_cfg()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'smsWon', greatest(0, least(1000, coalesce((v ->> 'smsWon')::int, 20))),
    'lmsWon', greatest(0, least(1000, coalesce((v ->> 'lmsWon')::int, 50))),
    'perSend', greatest(1, least(1000, coalesce((v ->> 'perSend')::int, 200))),
    'dailyMax', greatest(1, least(10000, coalesce((v ->> 'dailyMax')::int, 500))),
    'adName', left(coalesce(v ->> 'adName', '마라톤국어'), 30),
    'optout', coalesce(v ->> 'optout', ''))
  from (select coalesce((select value from public.app_settings where key = 'sms'), '{}'::jsonb) v) x;
$$;

create or replace function public._sms_today_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.sms_log
  where (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date and status <> 'fail';
$$;


-- ------------------------------------------------------------
--  4. 화면용
-- ------------------------------------------------------------
create or replace function public.sms_settings_get()
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
  return public._sms_cfg() || jsonb_build_object(
    'testPhone', coalesce((select public._phone_mask(phone) from public.kakao_test_phones where email = me), ''),
    'today', public._sms_today_count());
end;
$$;

create or replace function public.sms_settings_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sw int := (p ->> 'smsWon')::int;
  lw int := (p ->> 'lmsWon')::int;
  ps int := (p ->> 'perSend')::int;
  dm int := (p ->> 'dailyMax')::int;
  an text := btrim(coalesce(p ->> 'adName', ''));
  oo text := regexp_replace(coalesce(p ->> 'optout', ''), '[^0-9-]', '', 'g');
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if sw is null or sw < 0 or sw > 1000 or lw is null or lw < 0 or lw > 1000 then raise exception '단가는 0 ~ 1000원으로 적어 주세요.'; end if;
  if ps is null or ps < 1 or ps > 1000 then raise exception '한 번 최대 건수는 1 ~ 1000 으로 정해 주세요.'; end if;
  if dm is null or dm < 1 or dm > 10000 then raise exception '하루 최대 건수는 1 ~ 10000 으로 정해 주세요.'; end if;
  if char_length(an) > 30 then raise exception '광고 발신처 이름은 30자까지 적어 주세요.'; end if;
  if oo <> '' and length(regexp_replace(oo, '\D', '', 'g')) not between 8 and 12 then raise exception '무료수신거부 번호(080 …)를 확인해 주세요.'; end if;
  insert into public.app_settings (key, value)
  values ('sms', jsonb_build_object('smsWon', sw, 'lmsWon', lw, 'perSend', ps, 'dailyMax', dm, 'adName', an, 'optout', oo))
  on conflict (key) do update set value = excluded.value;
  return public._sms_cfg();
end;
$$;

/* 「문자 보낸 기록」 — 반 · 학생 · 날짜(한국 시간)로 찾는다. 번호는 뒤 4자리만 */
create or replace function public.sms_log_search(p_class text default null, p_student uuid default null,
                                                 p_from date default null, p_to date default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(x order by x.at desc)
    from (
      select l.created_at as at, l.id, l.batch_id, l.student_id, l.target, l.name, l.class_name, l.test, l.phone_last4,
             l.kind, l.ad, l.body_head, l.status, l.error, l.created_by,
             coalesce(nullif(btrim(sf.name), ''), l.created_by) as by_name
      from public.sms_log l left join public.staff sf on lower(sf.email) = lower(l.created_by)
      where (p_class is null or p_class = '' or l.class_name = p_class)
        and (p_student is null or l.student_id = p_student)
        and (p_from is null or (l.created_at at time zone 'Asia/Seoul')::date >= p_from)
        and (p_to is null or (l.created_at at time zone 'Asia/Seoul')::date <= p_to)
      order by l.created_at desc
      limit greatest(1, least(1000, coalesce(p_limit, 200)))
    ) x
  ), '[]'::jsonb);
end;
$$;


-- ------------------------------------------------------------
--  4. Edge Function sms-send 가 부른다 (부른 직원의 로그인 그대로)
-- ------------------------------------------------------------
/* 보낼 줄 만들기
   p_items    [{ "student_id": uuid, "to": "parent1" | "parent2" | "student" }]  (화면은 이것만 넘긴다)
   p_body     내용 — #{이름} #{반} #{링크}(학부모에겐 학부모 링크, 학생에겐 학생 링크) #{수업일}
   p_lessons  { "반 이름": "10월 15일(목)" } — #{수업일} 에 들어갈 글 (화면이 수업 요일로 계산)
   p_siblings 같은 번호를 쓰는 다른 학생(형제)에게도 따로 보낸다 (화면이 확인받은 때만 true)
   p_mark_week 성공하면 그 주 레포트를 「보냄」으로 (학부모 번호 · 공개된 레포트만)
   기록 줄(pending)을 먼저 만들고, 보낼 번호 · 글 · 단문/장문을 돌려준다 */
create or replace function public.sms_prepare(p_items jsonb, p_body text, p_ad boolean default false, p_lessons jsonb default '{}'::jsonb,
                                              p_siblings boolean default false, p_test boolean default false,
                                              p_mark_week date default null, p_site text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._sms_cfg();
  body text := coalesce(p_body, '');
  rows jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  seen jsonb := '{}'::jsonb;                 -- 번호 → 처음 받은 학생 id
  it record;
  s_name text; s_class text; p1 text; p2 text; sp text; hub text; stu text;
  ph text; d text; code text; txt text; bytes int; kind text;
  n int := 0;
  hr int := extract(hour from (now() at time zone 'Asia/Seoul'))::int;
  tphone text;
  batch uuid := gen_random_uuid();
  lid uuid;
  r jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if btrim(body) = '' then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '내용을 적어 주세요.'); end if;
  if char_length(body) > 2000 then return jsonb_build_object('ok', false, 'reason', 'toolong', 'message', '내용이 너무 깁니다 (2000자까지).'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '받는 사람을 골라 주세요.');
  end if;
  if jsonb_array_length(p_items) > 3000 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '받는 사람이 너무 많습니다.'); end if;
  if coalesce(p_ad, false) then
    if btrim(cfg ->> 'optout') = '' then
      return jsonb_build_object('ok', false, 'reason', 'optout', 'message', '광고 문자는 [설정]에서 무료수신거부 번호를 먼저 넣어야 보낼 수 있습니다.');
    end if;
    if btrim(cfg ->> 'adName') = '' then
      return jsonb_build_object('ok', false, 'reason', 'adname', 'message', '광고 문자는 [설정]에서 광고 발신처 이름을 먼저 넣어야 보낼 수 있습니다.');
    end if;
    if hr >= 21 or hr < 8 then
      return jsonb_build_object('ok', false, 'reason', 'night', 'message', '광고 문자는 밤 9시 ~ 아침 8시에 보낼 수 없습니다.');
    end if;
  end if;
  if p_test then
    select phone into tphone from public.kakao_test_phones where email = me;
    if tphone is null or not public._phone_ok(tphone) then
      return jsonb_build_object('ok', false, 'reason', 'notest', 'message', '먼저 [설정]에서 내 시험 번호를 넣어 주세요.');
    end if;
  end if;

  for it in
    select (e ->> 'student_id') as sid, coalesce(e ->> 'to', '') as tgt, ord
    from jsonb_array_elements(p_items) with ordinality a(e, ord)
    order by ord
  loop
    if it.tgt not in ('parent1', 'parent2', 'student') or coalesce(it.sid, '') !~* '^[0-9a-f-]{36}$' then continue; end if;
    begin
      select s.name, s.class_name, s.parent_phone, s.parent_phone2, s.student_phone, coalesce(l.hub_code, ''), coalesce(l.student_code, '')
        into s_name, s_class, p1, p2, sp, hub, stu
        from public.students s left join public.student_links l on l.student_id = s.id
       where s.id = it.sid::uuid and not s.archived;
      if not found then continue; end if;                                        -- 없거나 퇴원한 학생
      ph := case it.tgt when 'parent1' then p1 when 'parent2' then p2 else sp end;
      if not public._phone_ok(ph) then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nophone'); continue;
      end if;
      d := regexp_replace(ph, '\D', '', 'g');
      if seen ? d then
        if (seen ->> d) = it.sid then continue; end if;                          -- 같은 학생 · 같은 번호(학부모 1 = 2) — 한 번만
        if not coalesce(p_siblings, false) then
          skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'sibling'); continue;
        end if;
      end if;
      code := case when it.tgt = 'student' then stu else hub end;
      if position('#{링크}' in body) > 0 and code = '' then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nolink'); continue;
      end if;
      txt := replace(replace(replace(replace(body,
               '#{이름}', coalesce(s_name, '')),
               '#{반}', coalesce(s_class, '')),
               '#{수업일}', left(coalesce(p_lessons ->> coalesce(s_class, ''), ''), 30)),
               '#{링크}', case when code = '' then '' else coalesce(p_site, '') || '/me/#' || code end);
      if coalesce(p_ad, false) then
        txt := '(광고)' || (cfg ->> 'adName') || E'\n' || txt || E'\n무료수신거부 ' || (cfg ->> 'optout');
      end if;
      bytes := public._sms_bytes(txt);
      if bytes > 2000 then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'toolong'); continue;
      end if;
      kind := case when bytes <= 90 then 'SMS' else 'LMS' end;
      if not (seen ? d) then seen := seen || jsonb_build_object(d, it.sid); end if;
      n := n + 1;
      rows := rows || jsonb_build_object('student_id', it.sid, 'target', it.tgt, 'to', d, 'name', s_name, 'class_name', coalesce(s_class, ''),
                                         'text', txt, 'kind', kind, 'bytes', bytes);
      if p_test then exit; end if;                                                -- 시험 발송은 첫 사람 내용 하나만
    end;
  end loop;

  if n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'none', 'message', '보낼 수 있는 번호가 없습니다.', 'skipped', skipped);
  end if;
  if not p_test and n > (cfg ->> 'perSend')::int then
    return jsonb_build_object('ok', false, 'reason', 'max',
      'message', '한 번에 ' || (cfg ->> 'perSend') || '건까지 보낼 수 있습니다 (이번 ' || n || '건). 반을 나눠 보내 주세요.');
  end if;
  if public._sms_today_count() + n > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._sms_today_count() || '건 · 이번 ' || n || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;

  /* 기록 줄 먼저 (보내는 중) — 번호는 뒤 4자리만 남긴다 */
  if p_test then
    r := rows -> 0;
    insert into public.sms_log (batch_id, student_id, target, name, class_name, test, phone_last4, kind, ad, body_head, created_by)
    values (batch, (r ->> 'student_id')::uuid, 'test', r ->> 'name', r ->> 'class_name', true,
            right(regexp_replace(tphone, '\D', '', 'g'), 4), r ->> 'kind', coalesce(p_ad, false), left(r ->> 'text', 60), me)
    returning id into lid;
    rows := jsonb_build_array(r || jsonb_build_object('log_id', lid, 'to', regexp_replace(tphone, '\D', '', 'g'), 'target', 'test'));
  else
    rows := coalesce((
      select jsonb_agg(x || jsonb_build_object('log_id', public._sms_log_new(batch, x, coalesce(p_ad, false), p_mark_week, me)) order by o)
      from jsonb_array_elements(rows) with ordinality a(x, o)), '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'batch', batch, 'rows', rows, 'skipped', skipped, 'test', p_test);
end;
$$;

create or replace function public._sms_log_new(p_batch uuid, r jsonb, p_ad boolean, p_mark date, p_by text)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.sms_log (batch_id, student_id, target, name, class_name, phone_last4, kind, ad, body_head, mark_week, created_by)
  values (p_batch, (r ->> 'student_id')::uuid, r ->> 'target', coalesce(r ->> 'name', ''), coalesce(r ->> 'class_name', ''),
          right(r ->> 'to', 4), r ->> 'kind', p_ad, left(r ->> 'text', 60), p_mark, p_by)
  returning id;
$$;

/* 결과 적기 — [{log_id, ok, error, message_id}]. 보내는 중(pending)인 줄만 바꾼다.
   성공 + 「보냄 표시」를 고른 문자 + 학부모 번호 + 그 주 레포트가 공개돼 있으면 ④ 발송의 「보냄」도 (이미 있으면 그대로) */
create or replace function public.sms_record(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r jsonb;
  k public.sms_log;
  done int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception '결과 모양이 올바르지 않습니다.'; end if;
  for r in select * from jsonb_array_elements(p_results) loop
    if coalesce(r ->> 'log_id', '') !~* '^[0-9a-f-]{36}$' then continue; end if;
    update public.sms_log
       set status = case when coalesce((r ->> 'ok')::boolean, false) then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 200),
           message_id = left(coalesce(r ->> 'message_id', ''), 80),
           finished_at = now()
     where id = (r ->> 'log_id')::uuid and status = 'pending'
     returning * into k;
    if found then
      done := done + 1;
      if k.status = 'ok' and not k.test and k.mark_week is not null and k.student_id is not null and k.target in ('parent1', 'parent2')
         and exists (select 1 from public.published p where p.student_id = k.student_id and p.week_start = k.mark_week and p.visible) then
        insert into public.sent (week_start, student_id, via, sent_by) values (k.mark_week, k.student_id, 'sitesms', me)
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
  foreach f in array array['public._sms_bytes(text)', 'public._sms_cfg()', 'public._sms_today_count()',
                           'public._sms_log_new(uuid, jsonb, boolean, date, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.sms_settings_get()', 'public.sms_settings_set(jsonb)',
                           'public.sms_log_search(text, uuid, date, date, integer)',
                           'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text)', 'public.sms_record(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'sms_log' as what, exists (select 1 from pg_tables where tablename = 'sms_log' and rowsecurity)::text as ok
union all select 'sms_templates', exists (select 1 from pg_tables where tablename = 'sms_templates' and rowsecurity)::text
union all select 'sms_prepare', (not has_function_privilege('anon', 'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text)', 'execute'))::text;
