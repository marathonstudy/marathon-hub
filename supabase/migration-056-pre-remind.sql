-- ============================================================
--  마라톤 코치룸 — 수업 전 예고 문자 (migration-056-pre-remind.sql · 20261101j)
--
--  실행 방법 (순서)
--    1. 055 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    2. Edge Function note-remind 를 다시 배포 (같은 매분 실행이 필기 문자와 수업 전 예고를 같이 본다 · 050 의 예약은 그대로).
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 보낸 기록은 바꾸지 않는다. 새 키는 없다 (sms-send 와 같은 솔라피 Secrets).
--
--  1. classes — pre_remind(수업 전 문자 켜기) · pre_hours(수업 시작 몇 시간 전 · 기본 2 · 1~12)
--     지금 운영 중인 반(보관 안 함 · 시작 시각 있음 · 종강 전)은 켠다 (처음 한 번만 — 다시 실행해도 끈 반을 다시 켜지 않는다)
--     class_pre_set — 「오늘」 반 카드 [바꾸기] (운영진 누구나)
--  2. pre_remind_log — 같은 날 같은 학생에게 한 번 (DB 가 막는다)
--  3. note-remind 함수가 매분 부른다 (service_role 만)
--       pre_remind_due(지금)  — 지금 보낼 때가 된 반(켬 · 오늘 수업 · 시작 n시간 전 ~ 시작 전) 과 학생
--                               (퇴원 · 수강 시작 전 · 그날 결석 · 번호 없음 · 오늘 이미 보냄 제외 · 학부모에게는 안 보냄)
--                               학생마다 앱 공유 코드 · 수강 시작일 · 과제 수정값 — 함수가 앱 기록을 받아 밀린 과제를 센다
--       pre_remind_prepare(지금, [{ id, miss }]) — 문구 고르기(밀린 과제 있음 / 다 함) · 보낸 기록 줄 · 한 번 막기
--       pre_remind_record(결과)
--     문구 두 개는 문자 문구 관리에 「수업 전 예고(밀린 과제)」 「수업 전 예고(다 함)」으로 (바꿀 수 있다)
--       칸: {학생이름} {반이름} {수업시각}(18:30) {밀린날짜}(10/27(화) 10/29(목)) {오늘수업}(과정 · 회차 수업 내용 첫 줄 · 없으면 빠짐)
--  4. pre_remind_status(날) — 「오늘」 반 카드 「16:30 예고 문자 보냄 11명(밀린 4명)」 (운영진)
--  보낸 기록 — 문자 발송 → 보낸 기록에 「수업 전 예고」 (번호는 뒤 4자리만)
--  5. 수업 끝 n분 전 필기 문자 → 「필기 사진 + 복습테스트 기록」 — 남은 것만 안내 · 둘 다 냈으면 안 보냄 · 복습테스트 없는 날은 필기 문구만
--     링크는 러닝노트의 남은 것(필기 올리기 · 복습테스트 입력)으로 · 문구 「필기·복습 알림(둘 다)」 「필기·복습 알림(복습테스트만)」 · 필기만은 예전 「필기 알림(학생)」
-- ============================================================


-- ------------------------------------------------------------
--  1. 반 — 수업 전 문자
-- ------------------------------------------------------------
do $$
declare first_time boolean := not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'classes' and column_name = 'pre_remind');
begin
  alter table public.classes add column if not exists pre_remind boolean not null default false;
  alter table public.classes add column if not exists pre_hours  smallint not null default 2;
  alter table public.classes drop constraint if exists classes_pre_hours;
  alter table public.classes add constraint classes_pre_hours check (pre_hours between 1 and 12);
  /* 지금 운영 중인 반은 켠다 — 처음 실행할 때만 */
  if first_time then
    update public.classes set pre_remind = true
     where not archived and start_time is not null and (end_on is null or end_on >= (now() at time zone 'Asia/Seoul')::date);
  end if;
end;
$$;

create or replace function public.class_pre_set(p_class text, p_on boolean, p_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.classes;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found then raise exception '그 반을 찾지 못했습니다.'; end if;
  if coalesce(p_hours, 2) not between 1 and 12 then raise exception '「수업 몇 시간 전」은 1~12시간으로 정해 주세요.'; end if;
  if coalesce(p_on, false) and c.start_time is null then raise exception '수업 전 문자를 켜려면 수업 시작 시각을 넣어 주세요.'; end if;
  update public.classes set pre_remind = coalesce(p_on, false), pre_hours = coalesce(p_hours, 2) where name = c.name;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.class_pre_set(text, boolean, integer) from public, anon;
grant execute on function public.class_pre_set(text, boolean, integer) to authenticated;


-- ------------------------------------------------------------
--  2. 보낸 학생 — 같은 날 한 번
-- ------------------------------------------------------------
create table if not exists public.pre_remind_log (
  id          bigserial primary key,
  day         date not null,
  class_name  text not null,
  student_id  uuid not null,
  missed      boolean not null default false,     -- 밀린 과제 문구로 보냄
  log_id      uuid,                               -- sms_log 줄
  ok          boolean,
  created_at  timestamptz not null default now()
);
create unique index if not exists pre_remind_once on public.pre_remind_log (day, student_id);
alter table public.pre_remind_log enable row level security;
drop policy if exists pre_remind_log_read on public.pre_remind_log;
create policy pre_remind_log_read on public.pre_remind_log for select to authenticated using (public.is_staff());


-- ------------------------------------------------------------
--  3. 문구 · 대상 · 보낼 줄
-- ------------------------------------------------------------
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0);
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(밀린 과제)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(밀린 과제)', '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날! 수업 전까지 밀린 과제({밀린날짜})를 마무리하고 오면 오늘 수업이 훨씬 잘 들어올 거예요. 이따 교실에서 만나요!', nx + 1, 'migration-056');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(다 함)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(다 함)', '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날! 이번 주 과제까지 꼼꼼히 해 둔 만큼 오늘 수업이 더 재미있을 거예요. 이따 교실에서 만나요!', nx + 2, 'migration-056');
  end if;
end;
$$;

/* 지금 보낼 때가 된 반 — 켬 · 오늘 수업(휴강 · 바꾼 날 · 종강 · 보관 반영) · 시작 n시간 전 ~ 시작 전 */
create or replace function public._pre_due_classes(p_now timestamptz)
returns setof public.classes
language sql
stable
security definer
set search_path = public
as $$
  select k.* from public.classes k
   where k.pre_remind and not k.archived and k.start_time is not null
     and (p_now at time zone 'Asia/Seoul')::time >= k.start_time - make_interval(hours => k.pre_hours)
     and (p_now at time zone 'Asia/Seoul')::time < k.start_time
     and k.start_time >= make_time(k.pre_hours, 0, 0)                    -- 자정 앞으로 넘어가는 시각은 보내지 않는다
     and public._note_lesson_today(k.name, (p_now at time zone 'Asia/Seoul')::date)
   order by k.name;
$$;
revoke all on function public._pre_due_classes(timestamptz) from public, anon, authenticated;

/* 그날 그 반 · 보낼 수 있는 학생 (퇴원 · 수강 시작 전 · 결석 · 번호 없음 · 오늘 이미 보냄 제외) */
create or replace function public._pre_students(p_class text, p_day date)
returns table (id uuid, name text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.name, x.phone from public._note_students(p_class, p_day) x
   where not x.absent and x.phone ~ '^01[0-9]{8,9}$'
     and not exists (select 1 from public.pre_remind_log g where g.day = p_day and g.student_id = x.id);
$$;
revoke all on function public._pre_students(text, date) from public, anon, authenticated;

/* {오늘수업} — 그 반 그 주 수업 내용 첫 줄 (과정이면 회차 내용이 반 칸으로 복사돼 있다) · 40자 */
create or replace function public._pre_lesson_title(p_class text, p_day date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(left(btrim((select v from jsonb_array_elements_text(w.lessons) v where btrim(v) <> '' limit 1)), 40), '')
    from public.week_common w
   where w.class_name = btrim(coalesce(p_class, '')) and w.week_start = p_day - (extract(isodow from p_day)::int - 1)
  union all select ''
  limit 1;
$$;
revoke all on function public._pre_lesson_title(text, date) from public, anon, authenticated;

/* 함수가 앱 기록을 받으려고 — 반 · 학생 · 앱 공유 코드 · 수강 시작일 · 과제 수정값 { 날짜: 상태 } (service_role) */
create or replace function public.pre_remind_due(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
begin
  return jsonb_build_object('ok', true, 'day', d, 'classes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', c.name, 'start', to_char(c.start_time, 'HH24:MI'), 'hours', c.pre_hours,
             'students', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', s.id, 'name', s.name,
                        'share', coalesce(nullif(l.app_share_code, ''), ''),
                        'startOn', coalesce(st.start_on::text, ''),
                        'fix', coalesce((select jsonb_object_agg(f.day::text, f.status)
                                           from (select distinct on (h.day) h.day, h.status from public.hw_fixes h
                                                  where h.student_id = s.id and h.day >= d - 21 and h.day < d
                                                  order by h.day, h.id desc) f
                                          where f.status <> 'app'), '{}'::jsonb)) order by s.name)
                 from public._pre_students(c.name, d) s
                 join public.students st on st.id = s.id
                 left join public.student_links l on l.student_id = s.id), '[]'::jsonb)) order by c.name)
      from public._pre_due_classes(coalesce(p_now, now())) c), '[]'::jsonb));
end;
$$;
revoke all on function public.pre_remind_due(timestamptz) from public, anon, authenticated;
grant execute on function public.pre_remind_due(timestamptz) to service_role;

/* {오늘수업} 이 비면 그 칸과 둘러싼 괄호를 뺀다 */
create or replace function public._pre_fill(p_body text, p_name text, p_class text, p_time text, p_miss text, p_title text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
           case when coalesce(p_title, '') = ''
                then regexp_replace(p_body, '\s*[(\[「『<]?\{오늘수업\}[)\]」』>]?', '', 'g')
                else replace(p_body, '{오늘수업}', p_title) end,
         '  +', ' ', 'g'));
$$;

create or replace function public._pre_text(p_body text, p_name text, p_class text, p_time text, p_miss text, p_title text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(replace(replace(replace(replace(
           public._pre_fill(p_body, p_name, p_class, p_time, p_miss, p_title),
           '{학생이름}', coalesce(p_name, '')), '#{이름}', coalesce(p_name, '')),
           '{반이름}', coalesce(p_class, '')), '#{반}', coalesce(p_class, '')),
           '{수업시각}', coalesce(p_time, '')), '{밀린날짜}', coalesce(p_miss, ''));
$$;
revoke all on function public._pre_fill(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public._pre_text(text, text, text, text, text, text) from public, anon, authenticated;

/* 보낼 줄 — p_items [{ id: 학생 id, miss: '10/27(화) 10/29(목)' | '' }] (함수가 앱 기록으로 센 것 · 판단 못 한 학생은 넣지 않는다)
   지금도 보낼 때인 반 · 보낼 수 있는 학생만 · 같은 날 한 번 · 반마다 보낸 기록 묶음 하나 「수업 전 예고」 */
create or replace function public.pre_remind_prepare(p_now timestamptz, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now0 timestamptz := coalesce(p_now, now());
  d date := (now0 at time zone 'Asia/Seoul')::date;
  mbody text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(밀린 과제)' order by updated_at desc limit 1),
                         '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날! 수업 전까지 밀린 과제({밀린날짜})를 마무리하고 오면 오늘 수업이 훨씬 잘 들어올 거예요. 이따 교실에서 만나요!');
  obody text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(다 함)' order by updated_at desc limit 1),
                         '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날! 이번 주 과제까지 꼼꼼히 해 둔 만큼 오늘 수업이 더 재미있을 거예요. 이따 교실에서 만나요!');
  c record; x record;
  miss text; title text; tm text;
  rows jsonb := '[]'::jsonb;
  b uuid; txt text; lid uuid; nid bigint;
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
begin
  for c in select * from public._pre_due_classes(now0) loop
    b := null;
    tm := to_char(c.start_time, 'HH24:MI');
    title := public._pre_lesson_title(c.name, d);
    for x in select s.* from public._pre_students(c.name, d) s
              where exists (select 1 from jsonb_array_elements(items) i where i ->> 'id' = s.id::text) loop
      miss := left(regexp_replace(coalesce((select i ->> 'miss' from jsonb_array_elements(items) i where i ->> 'id' = x.id::text limit 1), ''), '[\r\n]+', ' ', 'g'), 120);
      insert into public.pre_remind_log (day, class_name, student_id, missed) values (d, c.name, x.id, btrim(miss) <> '')
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '수업 전 예고', 'pre', obody, '자동');
      end if;
      txt := public._pre_text(case when btrim(miss) <> '' then mbody else obody end, x.name, c.name, tm, btrim(miss), title);
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
      update public.pre_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name, 'missed', btrim(miss) <> '');
      nid := null;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.pre_remind_prepare(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.pre_remind_prepare(timestamptz, jsonb) to service_role;

create or replace function public.pre_remind_record(p_results jsonb)
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
    update public.pre_remind_log set ok = (r ->> 'ok')::boolean where log_id = (r ->> 'log_id')::uuid;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
revoke all on function public.pre_remind_record(jsonb) from public, anon, authenticated;
grant execute on function public.pre_remind_record(jsonb) to service_role;


-- ------------------------------------------------------------
--  4. 「오늘」 반 카드 — 그날 보낸 것 (운영진)
-- ------------------------------------------------------------
create or replace function public.pre_remind_status(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(k.class_name, jsonb_build_object('at', k.at, 'n', k.n, 'missed', k.missed, 'failed', k.failed))
      from (select g.class_name,
                   to_char(min(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI') as at,
                   count(*) filter (where coalesce(g.ok, false)) as n,
                   count(*) filter (where coalesce(g.ok, false) and g.missed) as missed,
                   count(*) filter (where g.ok = false) as failed
              from public.pre_remind_log g where g.day = d group by g.class_name) k), '{}'::jsonb);
end;
$$;
revoke all on function public.pre_remind_status(date) from public, anon;
grant execute on function public.pre_remind_status(date) to authenticated;


-- ------------------------------------------------------------
--  5. 수업 끝 n분 전 필기 문자 → 「필기 사진 + 복습테스트 기록」 안내
--     학생마다 남은 것만 — 둘 다 남음 / 필기만 남음 / 복습테스트만 남음 · 둘 다 냈으면 안 보냄
--     그날 복습테스트가 없는 반(꺼짐 · 시험 없음)은 필기 문구만 (예전과 같다)
--     복습테스트 「남음」 = 그날 시험 중 낸 기록도 · 선생님 표시(미응시 · 결석 · 응시)도 없는 시험이 하나라도 있다
--     링크 — 러닝노트에서 남은 것이 바로 열린다
--       필기만 /me/#코드/photo/날짜 · 복습테스트만 /me/#코드/review · 둘 다 /me/#코드/todo/날짜 (복습테스트 입력 + 필기 올리기 버튼)
--       학생 링크가 없으면 학생 입구 /s/?note=반 · ?review=반 · ?todo=반 (로그인하면 같은 곳으로)
--     문구 — 문자 문구 관리 「필기 알림(학생)」(필기만) · 「필기·복습 알림(둘 다)」 · 「필기·복습 알림(복습테스트만)」
--     운영진 문자 · 같은 날 한 번 · 「지금 다시 보내기」는 그대로
-- ------------------------------------------------------------
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0);
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '필기·복습 알림(둘 다)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('필기·복습 알림(둘 다)', '[마라톤국어] 수업 끝나기 전에 오늘 필기 사진과 복습테스트 기록 올려 주세요: #{링크}', nx + 1, 'migration-056');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '필기·복습 알림(복습테스트만)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('필기·복습 알림(복습테스트만)', '[마라톤국어] 수업 끝나기 전에 오늘 복습테스트 기록 올려 주세요: #{링크}', nx + 2, 'migration-056');
  end if;
end;
$$;

/* 그날 그 반 복습테스트 — null: 시험 없음 · true: 아직 남은 시험 있음 · false: 다 냄(또는 선생님 표시) */
create or replace function public._note_review_left(p_student uuid, p_class text, p_day date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; m int := 0; t public.review_tests;
begin
  for t in select * from public._review_tests_on(p_class, p_day) loop
    n := n + 1;
    if not exists (select 1 from public.review_submissions x where x.test_id = t.id and x.student_id = p_student)
       and not exists (select 1 from public.review_absences a where a.test_id = t.id and a.student_id = p_student) then
      m := m + 1;
    end if;
  end loop;
  return case when n = 0 then null else m > 0 end;
end;
$$;
revoke all on function public._note_review_left(uuid, text, date) from public, anon, authenticated;

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
  bbody text := coalesce((select body from public.sms_templates where btrim(title) = '필기·복습 알림(둘 다)' order by updated_at desc limit 1), '[마라톤국어] 수업 끝나기 전에 오늘 필기 사진과 복습테스트 기록 올려 주세요: #{링크}');
  rbody text := coalesce((select body from public.sms_templates where btrim(title) = '필기·복습 알림(복습테스트만)' order by updated_at desc limit 1), '[마라톤국어] 수업 끝나기 전에 오늘 복습테스트 기록 올려 주세요: #{링크}');
  tbody text := coalesce((select body from public.sms_templates where title = '필기 알림(운영진)' order by updated_at desc limit 1), '[필기 알림] #{반} 수업 #{분}분 전입니다. 필기 사진 제출 안내해 주세요.');
  rows jsonb := '[]'::jsonb;
  bs uuid; bt uuid;
  txt text; lid uuid; nid bigint;
  site text := rtrim(coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub'), '/');
  qr text;
  rl boolean; need text; body text; link text; cls text;
begin
  for c in
    select * from public.classes k
     where not k.archived and k.end_time is not null and (k.end_on is null or k.end_on >= d)
       and (case when p_manual then k.name = btrim(coalesce(p_class, ''))
                 else k.note_remind and t >= k.end_time - make_interval(mins => k.remind_min) and t < k.end_time + interval '10 minutes' end)
       and public._note_lesson_today(k.name, d)
  loop
    bs := null; bt := null;
    qr := '';                                                                  -- QR 화면은 없앴다 (053)
    cls := replace(c.name, ' ', '%20');
    /* 학생 — 남은 것(필기 · 복습테스트)이 있는 · 결석 아님 · 번호 있음 · 학부모에게는 안 보냄 */
    for x in select * from public._note_students(c.name, d) s where not s.absent and s.phone ~ '^01[0-9]{8,9}$' loop
      rl := coalesce(public._note_review_left(x.id, c.name, d), false);
      need := case when not x.done and rl then 'both' when not x.done then 'note' when rl then 'review' else '' end;
      if need = '' then continue; end if;
      insert into public.note_remind_log (day, class_name, kind, target, manual) values (d, c.name, 'student', x.id::text, coalesce(p_manual, false))
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if bs is null then
        bs := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (bs, '필기 알림(학생)', 'note', sbody, coalesce(p_by, '자동'));
      end if;
      body := case need when 'both' then bbody when 'review' then rbody else sbody end;
      link := case when x.code is not null
                   then site || '/me/#' || x.code || case need when 'both' then '/todo/' || d when 'review' then '/review' else '/photo/' || d end
                   else site || '/s/?' || case need when 'both' then 'todo' when 'review' then 'review' else 'note' end || '=' || cls end;
      txt := replace(replace(replace(body, '#{이름}', x.name), '#{반}', c.name), '#{링크}', link);
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, bs, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), coalesce(p_by, '자동'));
      update public.note_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name, 'need', need);
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


-- ============================================================
--  확인 — 다섯 줄 모두 true · 마지막 줄은 수업 전 문자를 켠 반
-- ============================================================
select '수업 전 문자 칸' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'pre_remind')::text as ok
union all select '수업 전 예고 문구', ((select count(*) from public.sms_templates where btrim(title) in ('수업 전 예고(밀린 과제)', '수업 전 예고(다 함)')) = 2)::text
union all select '보낼 함수', exists (select 1 from pg_proc where proname = 'pre_remind_prepare')::text
union all select '필기·복습 문구', ((select count(*) from public.sms_templates where btrim(title) in ('필기·복습 알림(둘 다)', '필기·복습 알림(복습테스트만)')) = 2 and exists (select 1 from pg_proc where proname = '_note_review_left'))::text
union all select '켠 반: ' || coalesce((select string_agg(name || ' ' || to_char(start_time - make_interval(hours => pre_hours), 'HH24:MI'), ' / ' order by name)
                                        from public.classes where pre_remind), '없음'), 'true';
