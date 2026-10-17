-- ============================================================
--  마라톤 코치룸 — 자막으로 AI 수업 요약 (migration-012-lesson-summary.sql)
--
--  실행 방법
--    001 ~ 011 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 저장된 레포트 · 학생 기록은 바꾸지 않는다 (칸 · 표 · 함수만 더한다).
--
--  흐름
--    ② 작성 → 반 공통 → [자막으로 AI 요약] → 자막 파일(.srt · .vtt · .txt) 또는 붙여 넣은 스크립트
--    → Edge Function(lesson-summary) 이 Claude 로 "1차시: … / 2차시: …" 초안을 만든다
--    → 초안은 lesson_summaries 에만 (학부모에게 안 보임)
--    → 직원이 읽고 고친 뒤 [확정] → 확정본만 러닝노트 · 반 공지에 보이고, 수업 내용 칸에 들어가 레포트와 함께 공개된다
--  지키는 것
--    · 자막 원문은 어디에도 저장하지 않는다 (요약 초안만)
--    · 한 달(한국 날짜) 요약 횟수 상한 — 기본 80회. 넘으면 서버가 Claude 를 부르지 않는다. 상한은 선생님만 바꾼다
--    · 새 표는 RLS. 직원만 읽는다. 쓰기는 아래 함수로만 (누가 · 언제가 남는다)
--    · Claude 키는 Edge Function 비밀 설정(Secrets)에만 있다. 이 파일 · 저장소 · 화면에는 없다
-- ============================================================


-- ------------------------------------------------------------
--  1. 수업 영상 — 「수업 영상(전체)」 칸 (1 · 2차시가 한 영상에 들어 있는 주)
-- ------------------------------------------------------------
alter table public.lesson_videos drop constraint if exists lesson_videos_part_check;
alter table public.lesson_videos add constraint lesson_videos_part_check check (part in ('full', '1', '2', 'makeup'));


-- ------------------------------------------------------------
--  2. lesson_summaries — 반 · 주차마다 AI 초안 + 확정본
-- ------------------------------------------------------------
create table if not exists public.lesson_summaries (
  class_name    text not null,
  week_start    date not null,
  status        text not null default 'draft',      -- draft 새 초안이 확인을 기다림 · confirmed 확정됨
  draft         jsonb not null default '[]'::jsonb,  -- ["1차시: …", "2차시: …"]
  draft_note    text not null default '',           -- AI 가 남긴 확인 메모 (자막 오류 의심 등)
  draft_source  text not null default '',           -- file 자막 파일 · paste 붙여 넣기
  draft_by      text not null default '',
  draft_at      timestamptz,
  model         text not null default '',
  confirmed     jsonb,                              -- 확정본 (학부모 화면은 이것만)
  confirmed_by  text not null default '',
  confirmed_at  timestamptz,
  updated_at    timestamptz not null default now(),

  primary key (class_name, week_start),
  constraint lesson_summaries_status_check check (status in ('draft', 'confirmed'))
);

alter table public.lesson_summaries enable row level security;
drop policy if exists lesson_summaries_staff_read on public.lesson_summaries;
create policy lesson_summaries_staff_read on public.lesson_summaries for select to authenticated using (public.is_staff());
/* insert · update · delete 정책 없음 — 아래 함수만 쓴다 */


-- ------------------------------------------------------------
--  3. ai_usage — 요약 호출 기록 (월 상한 · 대략 비용)
-- ------------------------------------------------------------
create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  by_email       text not null default '',
  by_name        text not null default '',
  class_name     text not null default '',
  week_start     date,
  status         text not null default 'started',   -- started 요약 중 · ok 성공 · failed 실패 (실패는 상한에 안 셈)
  chars          integer not null default 0,         -- 보낸 자막 글자 수 (원문은 저장하지 않는다)
  model          text not null default '',
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(10, 4) not null default 0,
  error          text not null default '',
  finished_at    timestamptz,

  constraint ai_usage_status_check check (status in ('started', 'ok', 'failed'))
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_staff_read on public.ai_usage;
create policy ai_usage_staff_read on public.ai_usage for select to authenticated using (public.is_staff());
/* insert · update · delete 정책 없음 — 아래 함수만 쓴다 */


-- ------------------------------------------------------------
--  4. 월 상한 · 이번 달 사용량
-- ------------------------------------------------------------
create or replace function public._ai_month_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
$$;

create or replace function public._ai_cap()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value ->> 'monthly_cap')::int from public.app_settings where key = 'ai_summary'), 80);
$$;

/* 이번 달 센 횟수 — 성공 + 10분 안에 시작해서 아직 끝나지 않은 것 (실패는 세지 않는다) */
create or replace function public._ai_used()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.ai_usage
  where at >= public._ai_month_start()
    and (status = 'ok' or (status = 'started' and at > now() - interval '10 minutes'));
$$;

/* 코치룸 — 이번 달 n / 80회 · 대략 비용 (직원) */
create or replace function public.ai_summary_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'cap', public._ai_cap(),
    'used', public._ai_used(),
    'cost_usd', coalesce((select sum(cost_usd) from public.ai_usage where at >= public._ai_month_start()), 0)
  );
end;
$$;

/* 월 상한 바꾸기 — 선생님만 */
create or replace function public.ai_cap_set(p_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  if p_cap is null or p_cap < 0 or p_cap > 1000 then raise exception '월 상한은 0 ~ 1000 회로 정해 주세요.'; end if;
  insert into public.app_settings (key, value) values ('ai_summary', jsonb_build_object('monthly_cap', p_cap))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('monthly_cap', p_cap), updated_at = now();
  return jsonb_build_object('ok', true, 'cap', p_cap);
end;
$$;


-- ------------------------------------------------------------
--  5. Edge Function(lesson-summary) 이 부르는 함수 — 로그인한 직원의 토큰으로 부른다
--     (service_role 은 쓰지 않는다. 서버가 그 사람이 직원인지 · 상한이 남았는지 직접 확인)
-- ------------------------------------------------------------

/* 요약 시작 — 상한이 남았으면 기록 한 줄을 만들고 번호를 돌려준다 */
create or replace function public.summary_begin(p_class text, p_week date, p_chars integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  used int;
  nid bigint;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if btrim(coalesce(p_class, '')) = '' or p_week is null then raise exception '반과 주차를 골라 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtext('marathon-ai-summary'));
  cap := public._ai_cap();
  used := public._ai_used();
  if used >= cap then
    return jsonb_build_object('ok', false, 'reason', 'cap', 'used', used, 'cap', cap);
  end if;
  insert into public.ai_usage (by_email, by_name, class_name, week_start, chars)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), btrim(p_class), p_week, greatest(0, coalesce(p_chars, 0)))
  returning id into nid;
  return jsonb_build_object('ok', true, 'usage_id', nid, 'used', used + 1, 'cap', cap);
end;
$$;

/* 요약 끝 — 성공이면 초안 저장 (확정본은 그대로 둔다), 실패면 기록만 */
create or replace function public.summary_finish(
  p_usage bigint, p_ok boolean, p_lessons jsonb, p_note text, p_source text,
  p_model text, p_in integer, p_out integer, p_cost numeric, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.ai_usage;
  s public.lesson_summaries;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into u from public.ai_usage where id = p_usage for update;
  if not found or u.status <> 'started' or u.by_email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception '요약 기록을 찾을 수 없습니다.';
  end if;

  if not coalesce(p_ok, false) then
    update public.ai_usage set status = 'failed', error = left(coalesce(p_error, ''), 300), model = coalesce(p_model, ''),
           input_tokens = greatest(0, coalesce(p_in, 0)), output_tokens = greatest(0, coalesce(p_out, 0)),
           cost_usd = greatest(0, coalesce(p_cost, 0)), finished_at = now()
     where id = p_usage;
    return jsonb_build_object('ok', false);
  end if;

  if jsonb_typeof(p_lessons) <> 'array' or jsonb_array_length(p_lessons) not between 1 and 6
     or exists (select 1 from jsonb_array_elements(p_lessons) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 300) then
    raise exception '요약 형식이 올바르지 않습니다.';
  end if;

  update public.ai_usage set status = 'ok', model = coalesce(p_model, ''),
         input_tokens = greatest(0, coalesce(p_in, 0)), output_tokens = greatest(0, coalesce(p_out, 0)),
         cost_usd = greatest(0, coalesce(p_cost, 0)), finished_at = now()
   where id = p_usage;

  insert into public.lesson_summaries (class_name, week_start, status, draft, draft_note, draft_source, draft_by, draft_at, model, updated_at)
  values (u.class_name, u.week_start, 'draft', p_lessons, left(coalesce(p_note, ''), 500),
          case when p_source in ('file', 'paste') then p_source else '' end, u.by_name, now(), coalesce(p_model, ''), now())
  on conflict (class_name, week_start) do update
     set status = 'draft', draft = excluded.draft, draft_note = excluded.draft_note, draft_source = excluded.draft_source,
         draft_by = excluded.draft_by, draft_at = excluded.draft_at, model = excluded.model, updated_at = now()
  returning * into s;
  return jsonb_build_object('ok', true, 'summary', to_jsonb(s));
end;
$$;


-- ------------------------------------------------------------
--  6. [확정] — 직원 누구나 (조교 포함). 누가 · 언제 확정했는지 남긴다
--     고친 글로 확정할 수 있다. 확정한 뒤 다시 고쳐 확정해도 된다
-- ------------------------------------------------------------
create or replace function public.summary_confirm(p_class text, p_week date, p_lessons jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.lesson_summaries;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if jsonb_typeof(p_lessons) <> 'array' or jsonb_array_length(p_lessons) not between 1 and 6
     or exists (select 1 from jsonb_array_elements(p_lessons) e where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 300) then
    raise exception '확정할 수업 내용을 1 ~ 6줄, 한 줄 300자 안으로 적어 주세요.';
  end if;
  insert into public.lesson_summaries (class_name, week_start, status, draft, confirmed, confirmed_by, confirmed_at, updated_at)
  values (btrim(p_class), p_week, 'confirmed', p_lessons, p_lessons, coalesce(public._staff_name(), ''), now(), now())
  on conflict (class_name, week_start) do update
     set status = 'confirmed', confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by,
         confirmed_at = excluded.confirmed_at, updated_at = now()
  returning * into s;
  return jsonb_build_object('ok', true, 'summary', to_jsonb(s));
end;
$$;


-- ------------------------------------------------------------
--  7. 반 관리(migration-010 · 011)와 연결 — 이름을 바꾸면 요약도 따라간다 · 요약이 있는 반은 삭제 막힘
-- ------------------------------------------------------------
create or replace function public._class_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'students', 'class_info', 'class_codes', 'class_notices', 'week_common',
    'tb_class_academy', 'tb_class_books', 'tb_class_dates', 'tb_issues', 'tb_order_lines',
    'tb_bill_plans', 'tb_bills', 'note_photos',
    'class_weeks', 'lesson_videos', 'class_files',
    'lesson_summaries'
  ];
$$;

drop trigger if exists lesson_summaries_class_follow on public.lesson_summaries;
create trigger lesson_summaries_class_follow before insert or update of class_name on public.lesson_summaries
  for each row execute function public._class_follow();

/* migration-011 의 기록 세기에 AI 요약을 더했다 */
create or replace function public._class_usage(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
  t text;
  tb bigint := 0;
begin
  select count(*) filter (where not archived), count(*) filter (where archived) into n, tb
  from public.students where btrim(class_name) = p_name;
  r := r || jsonb_build_object('active', n, 'left', tb);

  select count(*) into n from public.week_common where class_name = p_name
    and (lessons <> '[]'::jsonb or tests <> '[]'::jsonb or homework <> '[]'::jsonb or btrim(comment) <> '');
  r := r || jsonb_build_object('reports', n);
  select count(*) into n from public.class_notices where class_name = p_name;
  r := r || jsonb_build_object('notices', n);
  select count(*) into n from public.class_info where class_name = p_name and extra <> '{}'::jsonb;
  r := r || jsonb_build_object('info', n);

  tb := 0;
  foreach t in array array['tb_class_academy', 'tb_class_books', 'tb_class_dates', 'tb_issues', 'tb_order_lines', 'tb_bill_plans', 'tb_bills'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where class_name = $1', t) into n using p_name;
      tb := tb + n;
    end if;
  end loop;
  r := r || jsonb_build_object('textbook', tb);

  n := 0;
  if to_regclass('public.note_photos') is not null then
    select count(*) into n from public.note_photos where class_name = p_name;
  end if;
  r := r || jsonb_build_object('photos', n);

  select count(*) into n from public.app_settings
  where key = 'exams' and coalesce(value -> 'byClass' ->> p_name, '') <> '';
  r := r || jsonb_build_object('exam', n);

  select count(*) into n from public.lesson_videos where class_name = p_name;
  r := r || jsonb_build_object('videos', n);
  select count(*) into n from public.class_files where class_name = p_name;
  r := r || jsonb_build_object('files', n);
  select count(*) into n from public.lesson_summaries where class_name = p_name;
  r := r || jsonb_build_object('summaries', n);

  r := r || jsonb_build_object('records',
    (r ->> 'left')::bigint + (r ->> 'reports')::bigint + (r ->> 'notices')::bigint + (r ->> 'info')::bigint +
    (r ->> 'textbook')::bigint + (r ->> 'photos')::bigint + (r ->> 'exam')::bigint +
    (r ->> 'videos')::bigint + (r ->> 'files')::bigint + (r ->> 'summaries')::bigint);
  return r;
end;
$$;


-- ------------------------------------------------------------
--  8. 학부모 화면 — migration-011 의 _weekly_of 에 '확정된 수업 내용'과 「수업 영상(전체)」 순서만 더했다
--     초안은 절대 나가지 않는다 (confirmed 만)
-- ------------------------------------------------------------
create or replace function public._weekly_of(p_class text, p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select * from public.classes where name = btrim(coalesce(p_class, '')) limit 1
  ),
  wk as (
    select week_start from (
      select week_start from public.lesson_videos v
      where v.class_name = btrim(coalesce(p_class, ''))
        and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
      union
      select week_start from public.class_files f where f.class_name = btrim(coalesce(p_class, ''))
      union
      select week_start from public.lesson_summaries s where s.class_name = btrim(coalesce(p_class, '')) and s.confirmed is not null
    ) u order by week_start desc limit 26
  )
  select jsonb_build_object(
    'schedule', (
      select jsonb_build_object(
        'dow', c.lesson_dow, 'extra', to_jsonb(c.extra_dows), 'first', c.first_lesson,
        'weeks', coalesce((
          select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'lesson_date', w.lesson_date,
                                              'canceled', w.canceled, 'note', w.note) order by w.week_start desc)
          from (select * from public.class_weeks x where x.class_name = c.name order by x.week_start desc limit 60) w
        ), '[]'::jsonb))
      from c where c.lesson_dow is not null
    ),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', wk.week_start,
        'lessons', (select s.confirmed from public.lesson_summaries s
                    where s.class_name = btrim(coalesce(p_class, '')) and s.week_start = wk.week_start),
        'videos', coalesce((
          select jsonb_agg(jsonb_build_object('part', v.part, 'title', v.title, 'url', v.url,
                                              'personal', cardinality(v.student_ids) > 0)
                           order by case v.part when 'full' then 0 when '1' then 1 when '2' then 2 else 3 end, v.sort, v.created_at)
          from public.lesson_videos v
          where v.class_name = btrim(coalesce(p_class, '')) and v.week_start = wk.week_start
            and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
        ), '[]'::jsonb),
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'ext', f.ext, 'bytes', f.bytes)
                           order by f.kind, f.name)
          from public.class_files f
          where f.class_name = btrim(coalesce(p_class, '')) and f.week_start = wk.week_start
        ), '[]'::jsonb)
      ) order by wk.week_start desc)
      from wk
    ), '[]'::jsonb)
  );
$$;

revoke all on function public._weekly_of(text, uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
--  9. 권한 · 실시간 반영
-- ------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ai_summary_status()', 'public.ai_cap_set(integer)',
    'public.summary_begin(text, date, integer)',
    'public.summary_finish(bigint, boolean, jsonb, text, text, text, integer, integer, numeric, text)',
    'public.summary_confirm(text, date, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._ai_cap()', 'public._ai_used()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lesson_summaries') then
    alter publication supabase_realtime add table public.lesson_summaries;
  end if;
end;
$$;


-- ============================================================
--  확인 — 새 표 2개가 rls_enabled = true, 월 상한 80
-- ============================================================
select tablename as what, rowsecurity::text as ok from pg_tables
where schemaname = 'public' and tablename in ('lesson_summaries', 'ai_usage')
union all
select 'monthly_cap', public._ai_cap()::text
order by 1;
