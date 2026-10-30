-- ============================================================
--  마라톤 코치룸 — 반 수업 시각 · 종강일 · 담당 운영진 · 필기 QR · 필기 알림 · 문의 안내 (migration-049-class-time-notes.sql)
--
--  실행 방법
--    048 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    그다음 Edge Function note-remind 배포 → migration-050-note-cron.sql (매분 자동 실행) 순서.
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 사진 · 보낸 기록은 바꾸지 않는다.
--
--  1. 운영진 휴대폰 번호(010 + 8자리) — staff_phones (운영진만 읽는다 · 필기 알림 운영진 문자용)
--     로그인 확인값은 지금처럼 해시만(staff.phone_hash). 로그인할 때마다 번호를 이 표에 맞춰 둔다
--  2. classes — start_time · end_time(수업 시작 · 끝 시각) · end_on(종강일) · staff_emails(담당 운영진 여러 명)
--               note_remind(필기 알림 · 처음엔 끔) · remind_min(끝나기 몇 분 전 · 기본 5)
--     지금 반 세 개는 비어 있을 때만 한 번 채운다 (고2 선수능반 · 고3 목동 · 고3 반포)
--     12월 새 반은 만들지 않고 app_settings 'class_presets' 에 값만 (반 만들 때 고른다 · 개강일 = 첫 수업일)
--     class_meta_set — 반 관리 「수업 설정」 (운영진 누구나)
--  3. 필기 알림 — note_remind_log(같은 날 같은 사람 한 번) · note_remind_prepare / record(note-remind 함수 · service_role 만)
--     · note_status(오늘 화면 · QR 「지금 제출 n/전체」) · note_manual_prepare(「지금 다시 보내기」 · 운영진)
--     문구 두 개는 문자 문구 관리에 「필기 알림(학생)」 「필기 알림(운영진)」으로 (바꿀 수 있다)
--  4. 문의 안내 — app_settings 'contact'(카카오채널 링크) · contact_set(운영진) · hub_contact()(러닝노트 · 링크만)
--     「레포트 안내」 문구 끝에 카카오톡 채널 안내 한 줄 (없을 때만)
-- ============================================================


-- ------------------------------------------------------------
--  1. 운영진 휴대폰 번호
-- ------------------------------------------------------------
create table if not exists public.staff_phones (
  email       text primary key,
  phone       text not null,
  updated_at  timestamptz not null default now(),
  constraint staff_phones_phone check (phone ~ '^010[0-9]{8}$')
);
alter table public.staff_phones enable row level security;
drop policy if exists staff_phones_read on public.staff_phones;
create policy staff_phones_read on public.staff_phones for select to authenticated using (public.is_staff());
revoke all on public.staff_phones from anon;

/* 047 과 같고, 들어올 때마다 문자용 번호(010 + 8자리)를 맞춰 둔다 */
create or replace function public.staff_phone_login(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 20);
  ph text := coalesce(p_phone, '');
  h  text;
  s  record;
  em text;
begin
  if nm = '' or nm ~ '^[0-9\s-]+$' then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if ph !~ '^[0-9]{8}$' then return jsonb_build_object('ok', false, 'reason', 'phone'); end if;
  delete from public.staff_phone_attempts where at < now() - interval '1 day';
  h := public._phone_hash(ph);
  if (select count(*) from public.staff_phone_attempts where not ok and at > now() - interval '10 minutes') >= 50
     or (select count(*) from public.staff_phone_attempts where not ok and key = h and at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select * into s from public.staff where phone_hash = h;
  if found then
    if replace(lower(s.name), ' ', '') <> replace(lower(nm), ' ', '') then
      insert into public.staff_phone_attempts (key, ok) values (h, false);
      return jsonb_build_object('ok', false, 'reason', 'mismatch');
    end if;
    if not s.active then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
    insert into public.staff_phone_attempts (key, ok) values (h, true);
    insert into public.staff_phones (email, phone) values (s.email, '010' || ph)
      on conflict (email) do update set phone = excluded.phone, updated_at = now();
    return jsonb_build_object('ok', true, 'email', s.email, 'created', false);
  end if;

  if (select count(*) from public.staff_phone_attempts where key = 'new' and at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  em := 'ph-' || left(h, 24) || '@coach.marathonstudy.github.io';
  insert into public.staff (email, name, role, active, phone_hash, phone_last4, last_seen_at)
  values (em, nm, 'assistant', true, h, right(ph, 4), now());
  insert into public.staff_phones (email, phone) values (em, '010' || ph)
    on conflict (email) do update set phone = excluded.phone, updated_at = now();
  insert into public.staff_phone_attempts (key, ok) values ('new', true);
  return jsonb_build_object('ok', true, 'email', em, 'created', true);
end;
$$;
revoke all on function public.staff_phone_login(text, text) from public, anon, authenticated;
grant execute on function public.staff_phone_login(text, text) to service_role;


-- ------------------------------------------------------------
--  2. 반 — 수업 시각 · 종강일 · 담당 운영진 · 필기 알림
-- ------------------------------------------------------------
alter table public.classes add column if not exists start_time   time;
alter table public.classes add column if not exists end_time     time;
alter table public.classes add column if not exists end_on       date;
alter table public.classes add column if not exists staff_emails text[] not null default '{}';
alter table public.classes add column if not exists note_remind  boolean not null default false;
alter table public.classes add column if not exists remind_min   smallint not null default 5;
alter table public.classes drop constraint if exists classes_remind_min;
alter table public.classes add constraint classes_remind_min check (remind_min between 1 and 60);

/* 지금 운영 중인 반 — 비어 있을 때만 (다시 실행해도 고친 값을 덮지 않는다) */
update public.classes set start_time = '18:30', end_time = '22:00', end_on = coalesce(end_on, '2026-11-05')
 where name like '%선수능%' and start_time is null and end_time is null;
update public.classes set start_time = '18:30', end_time = '22:00', end_on = coalesce(end_on, '2026-11-14')
 where name like '%고3%' and name like '%목동%' and start_time is null and end_time is null;
update public.classes set start_time = '09:30', end_time = '13:00', end_on = coalesce(end_on, '2026-11-15')
 where name like '%고3%' and name like '%반포%' and start_time is null and end_time is null;

/* 12월 새 반 — 지금은 만들지 않는다. 반 만들 때 고르는 값 (개강일 = 첫 수업일 · dow 0 = 일요일) */
insert into public.app_settings (key, value) values ('class_presets', jsonb_build_object('list', jsonb_build_array(
  jsonb_build_object('name', '김포 PGA 김포관', 'dow', 6, 'start', '09:30', 'end', '13:00', 'first', '2026-12-19'),
  jsonb_build_object('name', '목동 PGA 네오관', 'dow', 6, 'start', '14:00', 'end', '17:30', 'first', '2026-12-26'),
  jsonb_build_object('name', '여의도 공부하기 좋은 날', 'dow', 6, 'start', '18:30', 'end', '22:00', 'first', '2026-12-26'),
  jsonb_build_object('name', '반포 송림학원', 'dow', 0, 'start', '09:30', 'end', '13:00', 'first', '2026-12-27'),
  jsonb_build_object('name', '대치 예섬학원 모의고사 특강', 'dow', 0, 'start', '14:00', 'end', '17:00', 'first', '2026-12-27'),
  jsonb_build_object('name', '대치 예섬학원 수능 정규', 'dow', 0, 'start', '18:30', 'end', '22:00', 'first', '2026-12-27'),
  jsonb_build_object('name', '대전 온율학원', 'dow', 1, 'start', '18:30', 'end', '22:00', 'first', '2026-12-28'))))
on conflict (key) do nothing;

create or replace function public.class_meta_set(p_class text, p_start text, p_end text, p_end_on date, p_staff text[], p_remind boolean, p_min integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.classes;
  st time; en time;
  ss text[];
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found then raise exception '그 반을 찾지 못했습니다.'; end if;
  if coalesce(btrim(p_start), '') <> '' and btrim(p_start) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '시작 시각은 18:30 처럼 적어 주세요.'; end if;
  if coalesce(btrim(p_end), '') <> '' and btrim(p_end) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '끝 시각은 22:00 처럼 적어 주세요.'; end if;
  st := nullif(btrim(coalesce(p_start, '')), '')::time;
  en := nullif(btrim(coalesce(p_end, '')), '')::time;
  if st is not null and en is not null and en <= st then raise exception '끝 시각은 시작 시각보다 뒤여야 합니다.'; end if;
  if coalesce(p_min, 5) not between 1 and 60 then raise exception '「끝나기 몇 분 전」은 1~60분으로 정해 주세요.'; end if;
  select coalesce(array_agg(distinct s.email), '{}') into ss from public.staff s where s.email = any(coalesce(p_staff, '{}'));
  update public.classes
     set start_time = st, end_time = en, end_on = p_end_on, staff_emails = ss,
         note_remind = coalesce(p_remind, false), remind_min = coalesce(p_min, 5)
   where name = c.name;
  return jsonb_build_object('ok', true, 'staff', to_jsonb(ss));
end;
$$;


-- ------------------------------------------------------------
--  3. 필기 알림
-- ------------------------------------------------------------
create table if not exists public.note_remind_log (
  id          bigserial primary key,
  day         date not null,
  class_name  text not null,
  kind        text not null,                    -- student · staff
  target      text not null,                    -- 학생 id · 운영진 이메일
  manual      boolean not null default false,   -- 「지금 다시 보내기」
  log_id      uuid,                              -- sms_log 줄
  ok          boolean,
  created_at  timestamptz not null default now(),
  constraint note_remind_kind check (kind in ('student', 'staff'))
);
create unique index if not exists note_remind_once on public.note_remind_log (day, class_name, kind, target) where not manual;
alter table public.note_remind_log enable row level security;
drop policy if exists note_remind_log_read on public.note_remind_log;
create policy note_remind_log_read on public.note_remind_log for select to authenticated using (public.is_staff());

/* 자동 실행 열쇠 — 매분 실행(050)이 이 값을 함수에 보낸다 · 화면 · 저장소에는 없다 (정책 없음) */
create table if not exists public.note_cron_secret (
  id    integer primary key default 1,
  token text not null,
  constraint note_cron_secret_one check (id = 1)
);
alter table public.note_cron_secret enable row level security;
revoke all on public.note_cron_secret from public, anon, authenticated;
insert into public.note_cron_secret (id, token) values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create or replace function public.note_cron_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.note_cron_secret where id = 1 and token = coalesce(p_key, '')); $$;
revoke all on function public.note_cron_ok(text) from public, anon, authenticated;
grant execute on function public.note_cron_ok(text) to service_role;

/* 문구 — 문자 문구 관리에서 바꿀 수 있다 (제목으로 찾는다) */
do $$
begin
  if not exists (select 1 from public.sms_templates where title = '필기 알림(학생)') then
    insert into public.sms_templates (title, body, sort_order) values ('필기 알림(학생)', '[마라톤국어] 수업 끝나기 전에 오늘 필기 사진 올려 주세요: #{링크}',
      coalesce((select max(sort_order) from public.sms_templates), 0) + 1);
  end if;
  if not exists (select 1 from public.sms_templates where title = '필기 알림(운영진)') then
    insert into public.sms_templates (title, body, sort_order) values ('필기 알림(운영진)', '[필기 알림] #{반} 수업 #{분}분 전입니다. 필기 사진 제출 안내해 주세요. QR 띄우기: #{QR 링크}',
      coalesce((select max(sort_order) from public.sms_templates), 0) + 1);
  end if;
end;
$$;

/* 그 반이 그날 수업인가 (휴강 · 바꾼 수업일 · 첫 수업일 · 종강일) */
create or replace function public._note_lesson_today(p_class text, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.classes c where c.name = btrim(coalesce(p_class, '')) and not c.archived
                   and (c.end_on is null or c.end_on >= p_day))
     and public._lesson_base(btrim(coalesce(p_class, '')), p_day - (extract(isodow from p_day)::int - 1)) = p_day;
$$;

/* 그날 그 반 학생 — 낸 학생 · 결석 · 번호 (내 학생 링크 코드는 문자 링크용) */
create or replace function public._note_students(p_class text, p_day date)
returns table (id uuid, name text, phone text, code text, done boolean, absent boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g'), l.student_code,
         exists (select 1 from public.note_photos p where p.student_id = s.id and p.lesson_date = p_day and p.hidden_at is null),
         exists (select 1 from public.entries e where e.student_id = s.id and e.week_start = p_day - (extract(isodow from p_day)::int - 1) and e.attend_status = 'absent')
    from public.students s left join public.student_links l on l.student_id = s.id
   where not s.archived and btrim(s.class_name) = btrim(coalesce(p_class, ''))
     and (s.start_on is null or s.start_on <= p_day)
     and (s.left_on is null or s.left_on >= p_day)
   order by s.name;
$$;
revoke all on function public._note_lesson_today(text, date) from public, anon, authenticated;
revoke all on function public._note_students(text, date) from public, anon, authenticated;

/* 오늘 화면 · QR — 지금 제출 n/전체 · 안 낸 학생 (운영진만) */
create or replace function public.note_status(p_class text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'day', d, 'lesson', public._note_lesson_today(p_class, d),
    'total', (select count(*) from public._note_students(p_class, d)),
    'done', (select count(*) from public._note_students(p_class, d) x where x.done),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'absent', x.absent, 'phone', x.phone <> '') order by x.name)
                           from public._note_students(p_class, d) x where not x.done), '[]'::jsonb));
end;
$$;

/* 보낼 줄 만들기 — 대상 고르기 · 같은 날 한 번(자동) · sms 기록 줄 (note-remind 함수가 부른다)
   p_class = '' 이면 지금 보낼 때가 된 모든 반 (자동) · 반 이름이면 그 반 학생만 지금 (manual · 「지금 다시 보내기」) */
create or replace function public._note_prepare(p_now timestamptz, p_class text, p_manual boolean, p_site text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (p_now at time zone 'Asia/Seoul')::date;
  t time := (p_now at time zone 'Asia/Seoul')::time;
  c record;
  x record;
  sbody text := coalesce((select body from public.sms_templates where title = '필기 알림(학생)' order by updated_at desc limit 1), '[마라톤국어] 수업 끝나기 전에 오늘 필기 사진 올려 주세요: #{링크}');
  tbody text := coalesce((select body from public.sms_templates where title = '필기 알림(운영진)' order by updated_at desc limit 1), '[필기 알림] #{반} 수업 #{분}분 전입니다. 필기 사진 제출 안내해 주세요. QR 띄우기: #{QR 링크}');
  rows jsonb := '[]'::jsonb;
  bs uuid; bt uuid;
  txt text; lid uuid; nid bigint;
  site text := rtrim(coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub'), '/');
  qr text;
begin
  for c in
    select * from public.classes k
     where not k.archived and k.end_time is not null and (k.end_on is null or k.end_on >= d)
       and (case when p_manual then k.name = btrim(coalesce(p_class, ''))
                 else k.note_remind and t >= k.end_time - make_interval(mins => k.remind_min) and t < k.end_time + interval '10 minutes' end)
       and public._note_lesson_today(k.name, d)
  loop
    bs := null; bt := null;
    qr := site || '/admin/#qr=' || replace(c.name, ' ', '%20');
    /* 학생 — 안 낸 · 결석 아님 · 번호 있음 · 학부모에게는 안 보냄 */
    for x in select * from public._note_students(c.name, d) s where not s.done and not s.absent and s.phone ~ '^01[0-9]{8,9}$' loop
      insert into public.note_remind_log (day, class_name, kind, target, manual) values (d, c.name, 'student', x.id::text, coalesce(p_manual, false))
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if bs is null then
        bs := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (bs, '필기 알림(학생)', 'note', sbody, coalesce(p_by, '자동'));
      end if;
      txt := replace(replace(replace(sbody, '#{이름}', x.name), '#{반}', c.name),
               '#{링크}', case when x.code is not null then site || '/me/#' || x.code || '/photo/' || d else site || '/s/?note=' || replace(c.name, ' ', '%20') end);
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, bs, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), coalesce(p_by, '자동'));
      update public.note_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name);
      nid := null;
    end loop;
    /* 운영진 — 담당 운영진(비어 있으면 사용 중인 운영진 전체) · 사용 중지 제외 · 「지금 다시 보내기」에는 안 보냄 */
    if not coalesce(p_manual, false) then
      for x in
        select s.email, s.name, p.phone from public.staff s join public.staff_phones p on p.email = s.email
         where s.active and (cardinality(c.staff_emails) = 0 or s.email = any(c.staff_emails)
                             or not exists (select 1 from public.staff s2 join public.staff_phones p2 on p2.email = s2.email where s2.active and s2.email = any(c.staff_emails)))
      loop
        insert into public.note_remind_log (day, class_name, kind, target) values (d, c.name, 'staff', x.email)
          on conflict do nothing returning id into nid;
        if nid is null then continue; end if;
        if bt is null then
          bt := gen_random_uuid();
          insert into public.sms_batches (id, label, purpose, body, created_by) values (bt, '필기 알림(운영진)', 'note', tbody, '자동');
        end if;
        txt := replace(replace(replace(replace(tbody, '#{반}', c.name), '#{분}', c.remind_min::text), '#{QR 링크}', qr), '#{이름}', x.name);
        lid := gen_random_uuid();
        insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
        values (lid, bt, null, 'staff', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
        update public.note_remind_log set log_id = lid where id = nid;
        rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                           'class', c.name, 'who', 'staff', 'name', x.name);
        nid := null;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public._note_prepare(timestamptz, text, boolean, text, text) from public, anon, authenticated;

/* 자동 (note-remind 함수 · service_role) */
create or replace function public.note_remind_prepare(p_now timestamptz, p_site text)
returns jsonb
language sql
security definer
set search_path = public
as $$ select public._note_prepare(coalesce(p_now, now()), '', false, p_site, '자동'); $$;
revoke all on function public.note_remind_prepare(timestamptz, text) from public, anon, authenticated;
grant execute on function public.note_remind_prepare(timestamptz, text) to service_role;

/* 「지금 다시 보내기」 — 운영진이 부른다 (그 반 안 낸 학생 · 오늘 이미 보냈어도 한 번 더) */
create or replace function public.note_manual_prepare(p_class text, p_site text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if not exists (select 1 from public.classes where name = btrim(coalesce(p_class, '')) and end_time is not null) then
    raise exception '반 관리 → 수업 설정에서 수업 끝 시각을 먼저 넣어 주세요.';
  end if;
  if not public._note_lesson_today(p_class, (now() at time zone 'Asia/Seoul')::date) then
    raise exception '오늘은 이 반 수업일이 아닙니다.';
  end if;
  return public._note_prepare(now(), p_class, true, p_site, coalesce(public._staff_name(), ''));
end;
$$;
revoke all on function public.note_manual_prepare(text, text) from public, anon;
grant execute on function public.note_manual_prepare(text, text) to authenticated;

/* 보낸 결과 — sms_log · note_remind_log (service_role) */
create or replace function public.note_remind_record(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.sms_log set status = case when (r ->> 'ok')::boolean then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 200), message_id = coalesce(r ->> 'message_id', ''), finished_at = now()
     where id = (r ->> 'log_id')::uuid;
    update public.note_remind_log set ok = (r ->> 'ok')::boolean where log_id = (r ->> 'log_id')::uuid;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
revoke all on function public.note_remind_record(jsonb) from public, anon, authenticated;
grant execute on function public.note_remind_record(jsonb) to service_role;

do $$
declare f text;
begin
  foreach f in array array['public.class_meta_set(text, text, text, date, text[], boolean, integer)', 'public.note_status(text, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  4. 문의 안내 — 카카오톡 채널
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values ('contact', '{"kakao": ""}'::jsonb) on conflict (key) do nothing;

create or replace function public.contact_set(p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare u text := btrim(coalesce(p_url, ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if u <> '' and (u !~ '^https://[^\s<>"]{4,}$' or char_length(u) > 300) then raise exception '카카오채널 링크는 https:// 로 시작하는 주소로 넣어 주세요.'; end if;
  insert into public.app_settings (key, value) values ('contact', jsonb_build_object('kakao', u))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'kakao', u);
end;
$$;
revoke all on function public.contact_set(text) from public, anon;
grant execute on function public.contact_set(text) to authenticated;

/* 러닝노트(학생 · 학부모 · 미리보기) — 링크 하나만 */
create or replace function public.hub_contact()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select value ->> 'kakao' from public.app_settings where key = 'contact'), ''); $$;
revoke all on function public.hub_contact() from public;
grant execute on function public.hub_contact() to anon, authenticated;

/* 「레포트 안내」 문구 끝에 문의 안내 (없을 때만) */
update public.sms_templates
   set body = rtrim(body) || E'\n' || '수정하실 내용이나 궁금한 점은 카카오톡 채널 ''jh국어연구소''로 언제든 편하게 문의해 주세요.'
 where title like '%레포트%' and body like '%#{링크}%' and body not like '%jh국어연구소%';


-- ============================================================
--  확인 — 다섯 줄 모두 true · 마지막 줄은 수업 시각이 들어간 반 (지금 반 세 개가 나와야 한다)
-- ============================================================
select 'staff_phones' as what, exists (select 1 from information_schema.tables where table_name = 'staff_phones')::text as ok
union all select '반 수업 시각', exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'end_time')::text
union all select '필기 알림 문구', ((select count(*) from public.sms_templates where title like '필기 알림%') >= 2)::text
union all select '문의 안내', exists (select 1 from public.app_settings where key = 'contact')::text
union all select '12월 반 값', exists (select 1 from public.app_settings where key = 'class_presets')::text
union all select '시각 넣은 반: ' || coalesce((select string_agg(name || ' ' || to_char(start_time, 'HH24:MI') || '~' || to_char(end_time, 'HH24:MI') || ' 종강 ' || coalesce(end_on::text, '-'), ' / ' order by name)
                                            from public.classes where end_time is not null), '없음'), 'true';
