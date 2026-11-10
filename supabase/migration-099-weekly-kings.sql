-- ============================================================
--  migration-099-weekly-kings.sql — 이번 주 「오답정리왕」 · 「지문 장악왕」 후보 자동 계산 · 확정 · 배지 (20261110i)
--  (099 는 098 다음 · 065 · 078 · 097 이 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포 · 함수 king-pick 새로 배포)
--
--  어디서 오나 — 코치룸이 이미 가진 앱 공유 코드로 여는 공유 리포트(GET /api/share/report/:token) 응답의 과제 기록(homeworkHistory)
--    files[].url(제출 사진 주소) · wrongAnswerScore · textComprehensionScore(앱 AI 「있음 100 / 없음」 점수)
--    → app-sync 가 그 주소와 점수만 app_records.subs 에 남긴다(최근 120일 · 사진은 복사하지 않음 · 주소만)
--  app_records.subs 는 코치룸(직원)과 서버만 — 러닝노트(hub_app_record)는 data 만 주므로 학생 · 학부모에게 안 보인다
--
--  1. app_records.subs · king_subs_save(서버만)
--  2. king_weeks — 반 · 수업일(수업 전 예고와 같은 기간: 수업일 7일 전 ~ 전날) · 종류(wrong 오답정리 · text 지문 장악) 한 줄
--       candidates [{ sid, score(0~100), why(근거 한 줄), img(사진 주소) }] 1~3위 · status open(후보) · picked(확정) · none(사진 없음)
--  3. 설정 app_settings 'kings' { on(기본 켜짐), auto_hours(기본 0 = 끔 · n시간 안에 안 누르면 1위 자동 확정) }
--  4. 서버(king-pick) — king_due · king_inputs · king_save · king_auto
--  5. 코치룸 — king_list · king_pick · king_cfg_set(원장만)
--  6. 배지 모음(_badge_box) 에 kings { wrong: n, text: n, weeks: [{ lesson, kind }] } — 학생 화면엔 배지만(점수 · 근거 · 사진 · 순위 없음)
--  7. 예약 — 15분마다 king-pick (pg_cron · 열쇠는 필기 알림과 같은 DB 값 · migration-050)
--  문자 · 알림톡은 보내지 않는다 · 학생 기록은 바꾸지 않는다
-- ============================================================

-- ------------------------------------------------------------
--  1. 제출 사진 주소 · 앱 점수 (최근 120일)
-- ------------------------------------------------------------
alter table public.app_records add column if not exists subs jsonb;
alter table public.app_records add column if not exists subs_at timestamptz;

/* [{ id: 학생, subs: [{ title, submittedAt, wa, tc, files: [{ url, type }] }] }] — app-sync 가 app_sync_save 다음에 부른다 */
create or replace function public.king_subs_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' or jsonb_typeof(r -> 'subs') <> 'array' then continue; end if;
    update public.app_records set subs = r -> 'subs', subs_at = now() where student_id = (r ->> 'id')::uuid;
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.king_subs_save(jsonb) from public, anon, authenticated;
grant execute on function public.king_subs_save(jsonb) to service_role;

-- ------------------------------------------------------------
--  2. 후보 · 확정
-- ------------------------------------------------------------
create table if not exists public.king_weeks (
  id          bigserial primary key,
  class_name  text not null,
  lesson_day  date not null,
  period_from date not null,
  period_to   date not null,
  kind        text not null,
  candidates  jsonb not null default '[]'::jsonb,
  status      text not null default 'open',
  picked      uuid references public.students(id) on delete set null,
  picked_by   text not null default '',
  picked_at   timestamptz,
  auto        boolean not null default false,
  students    integer not null default 0,
  cost        numeric not null default 0,
  calc_at     timestamptz not null default now(),
  constraint king_weeks_kind check (kind in ('wrong', 'text')),
  constraint king_weeks_status check (status in ('open', 'picked', 'none')),
  constraint king_weeks_one unique (class_name, lesson_day, kind)
);
create index if not exists king_weeks_picked_idx on public.king_weeks (picked) where status = 'picked';
alter table public.king_weeks enable row level security;
drop policy if exists king_weeks_staff_read on public.king_weeks;
create policy king_weeks_staff_read on public.king_weeks for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.king_weeks from anon, authenticated;
revoke all on public.king_weeks from anon;

-- ------------------------------------------------------------
--  3. 설정
-- ------------------------------------------------------------
create or replace function public._king_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', coalesce((value ->> 'on')::boolean, true), 'auto_hours', coalesce((value ->> 'auto_hours')::int, 0))
    from (select (select value from public.app_settings where key = 'kings') as value) x;
$$;
revoke all on function public._king_cfg() from public, anon, authenticated;

-- ------------------------------------------------------------
--  4. 서버(king-pick)만
-- ------------------------------------------------------------
/* 계산할 반 · 수업일 — 그 주 배지(hw_weeks)가 생긴 반(수업 전 예고가 계산된 반) · 수업일이 오늘부터 6일 전까지 · 아직 계산 안 함 */
create or replace function public.king_due(p_now timestamptz default now(), p_limit integer default 3)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (public._king_cfg() ->> 'on')::boolean then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('class', x.class_name, 'lesson', x.lesson_day) order by x.lesson_day, x.class_name)
      from (select distinct w.class_name, w.lesson_day from public.hw_weeks w
             where btrim(coalesce(w.class_name, '')) <> ''
               and w.lesson_day between (p_now at time zone 'Asia/Seoul')::date - 6 and (p_now at time zone 'Asia/Seoul')::date
               and not exists (select 1 from public.king_weeks k where k.class_name = w.class_name and k.lesson_day = w.lesson_day)
             order by w.lesson_day, w.class_name limit greatest(1, least(p_limit, 10))) x), '[]'::jsonb) end;
$$;
revoke all on function public.king_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.king_due(timestamptz, integer) to service_role;

/* 그 반 재원 학생 · 그 기간(수업일 7일 전 ~ 전날)에 낸 과제의 사진 주소 · 앱 점수 — 이름은 넘기지 않는다(AI 에도 안 감) */
create or replace function public.king_inputs(p_class text, p_lesson date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('from', p_lesson - 7, 'to', p_lesson - 1, 'students', coalesce((
    select jsonb_agg(jsonb_build_object('sid', s.id, 'subs', coalesce((
             select jsonb_agg(x) from jsonb_array_elements(coalesce(r.subs, '[]'::jsonb)) x
              where left(x ->> 'submittedAt', 10) ~ '^\d{4}-\d{2}-\d{2}$'
                and ((x ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date between p_lesson - 7 and p_lesson - 1), '[]'::jsonb)))
      from public.students s left join public.app_records r on r.student_id = s.id
     where not s.archived and s.class_name = p_class), '[]'::jsonb));
$$;
revoke all on function public.king_inputs(text, date) from public, anon, authenticated;
grant execute on function public.king_inputs(text, date) to service_role;

/* 계산 결과 저장 — 이미 확정된 줄은 후보만 새로 (확정은 그대로) */
create or replace function public.king_save(p_class text, p_lesson date, p_kind text, p_cands jsonb, p_students integer, p_cost numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare c jsonb := case when jsonb_typeof(p_cands) = 'array' then p_cands else '[]'::jsonb end;
begin
  if p_kind not in ('wrong', 'text') or btrim(coalesce(p_class, '')) = '' or p_lesson is null then return false; end if;
  c := coalesce((select jsonb_agg(jsonb_build_object('sid', x ->> 'sid', 'score', least(100, greatest(0, coalesce((x ->> 'score')::int, 0))),
                                                     'why', left(coalesce(x ->> 'why', ''), 120), 'img', left(coalesce(x ->> 'img', ''), 400)))
                  from (select x from jsonb_array_elements(c) x
                         where coalesce(x ->> 'sid', '') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.students s where s.id = (x ->> 'sid')::uuid)
                         order by coalesce((x ->> 'score')::int, 0) desc limit 3) y(x)), '[]'::jsonb);
  insert into public.king_weeks as k (class_name, lesson_day, period_from, period_to, kind, candidates, status, students, cost, calc_at)
  values (p_class, p_lesson, p_lesson - 7, p_lesson - 1, p_kind, c, case when jsonb_array_length(c) = 0 then 'none' else 'open' end,
          greatest(0, coalesce(p_students, 0)), greatest(0, coalesce(p_cost, 0)), now())
  on conflict (class_name, lesson_day, kind) do update set candidates = excluded.candidates, students = excluded.students, cost = k.cost + excluded.cost, calc_at = now(),
    status = case when k.status = 'picked' then 'picked' else excluded.status end;
  return true;
end;
$$;
revoke all on function public.king_save(text, date, text, jsonb, integer, numeric) from public, anon, authenticated;
grant execute on function public.king_save(text, date, text, jsonb, integer, numeric) to service_role;

/* n시간 안에 안 누르면 1위 자동 확정 (설정 auto_hours > 0 일 때만 · 기본 끔) */
create or replace function public.king_auto(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare h int := coalesce((public._king_cfg() ->> 'auto_hours')::int, 0); n int;
begin
  if h <= 0 then return 0; end if;
  update public.king_weeks k set status = 'picked', picked = (k.candidates -> 0 ->> 'sid')::uuid, picked_by = '자동(' || h || '시간)', picked_at = p_now, auto = true
   where k.status = 'open' and jsonb_array_length(k.candidates) > 0 and k.calc_at + make_interval(hours => h) <= p_now
     and exists (select 1 from public.students s where s.id = (k.candidates -> 0 ->> 'sid')::uuid);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.king_auto(timestamptz) from public, anon, authenticated;
grant execute on function public.king_auto(timestamptz) to service_role;

-- ------------------------------------------------------------
--  5. 코치룸
-- ------------------------------------------------------------
/* 최근 n일 — 반 · 수업일 · 종류 · 후보(이름 · 점수 · 근거 · 사진) · 확정 · 설정 */
create or replace function public.king_list(p_days integer default 21)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else jsonb_build_object(
    'cfg', public._king_cfg(), 'owner', public._real_teacher(),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'class', k.class_name, 'lesson', k.lesson_day, 'from', k.period_from, 'to', k.period_to,
                                                          'kind', k.kind, 'status', k.status, 'auto', k.auto, 'students', k.students, 'cost', k.cost, 'at', k.calc_at,
                                                          'picked', k.picked, 'picked_name', (select s.name from public.students s where s.id = k.picked), 'picked_by', k.picked_by,
                                                          'cands', coalesce((select jsonb_agg(c || jsonb_build_object('name', (select s.name from public.students s where s.id = (c ->> 'sid')::uuid)))
                                                                               from jsonb_array_elements(k.candidates) c), '[]'::jsonb))
                                         order by k.lesson_day desc, k.class_name, k.kind)
                        from public.king_weeks k where k.lesson_day >= (now() at time zone 'Asia/Seoul')::date - greatest(1, least(p_days, 120))), '[]'::jsonb)) end;
$$;
revoke all on function public.king_list(integer) from public, anon;
grant execute on function public.king_list(integer) to authenticated;

/* [확정] · [다른 학생으로] — 그 반 학생만 · 누가 눌렀는지 남김 · p_student null 이면 확정 풀기 */
create or replace function public.king_pick(p_id bigint, p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.king_weeks; who text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into k from public.king_weeks where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if p_student is not null and not exists (select 1 from public.students s where s.id = p_student and s.class_name = k.class_name and not s.archived) then
    return jsonb_build_object('ok', false, 'reason', 'class');
  end if;
  who := coalesce(nullif(btrim(public._staff_name()), ''), '직원');
  update public.king_weeks set status = case when p_student is null then (case when jsonb_array_length(candidates) > 0 then 'open' else 'none' end) else 'picked' end,
         picked = p_student, picked_by = case when p_student is null then '' else who end, picked_at = case when p_student is null then null else now() end, auto = false
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.king_pick(bigint, uuid) from public, anon;
grant execute on function public.king_pick(bigint, uuid) to authenticated;

/* 설정 — 원장만 · { on, auto_hours(0 ~ 72) } */
create or replace function public.king_cfg_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._real_teacher() then raise exception 'owner only'; end if;
  insert into public.app_settings (key, value, updated_by) values ('kings',
    jsonb_build_object('on', coalesce((p ->> 'on')::boolean, true), 'auto_hours', least(72, greatest(0, coalesce((p ->> 'auto_hours')::int, 0)))), 'coachroom')
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'coachroom';
  return public._king_cfg();
end;
$$;
revoke all on function public.king_cfg_set(jsonb) from public, anon;
grant execute on function public.king_cfg_set(jsonb) to authenticated;

-- ------------------------------------------------------------
--  6. 배지 모음 — kings (확정된 것만 · 개수 · 주)
-- ------------------------------------------------------------
create or replace function public._badge_box(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'perfect', public._badge_count(p_student),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', x.week_start, 'from', x.lesson_day - 7, 'to', x.lesson_day - 1, 'lesson', x.lesson_day,
                                                           'total', x.total, 'done', x.done, 'perfect', x.perfect) order by x.week_start)
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
--  7. 예약 — 15분마다 (함수 king-pick 을 먼저 배포 · 열쇠는 필기 알림과 같은 DB 값)
--     끄려면: select cron.unschedule('king-pick');  (설정에서 끄면 계산만 멈춤)
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'king-pick') then perform cron.unschedule('king-pick'); end if;
end;
$$;
select cron.schedule('king-pick', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/king-pick',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '제출 사진 주소 칸(app_records.subs)' as what, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_records' and column_name = 'subs')::text as ok
union all select '후보 · 확정 표(king_weeks)', (to_regclass('public.king_weeks') is not null)::text
union all select '배지 모음에 오답정리 · 지문장악 배지(kings)', (position('''kings''' in pg_get_functiondef('public._badge_box(uuid)'::regprocedure)) > 0)::text
union all select '15분마다 예약(king-pick)', exists (select 1 from cron.job where jobname = 'king-pick')::text
union all select '자동 확정 — ' || case when (public._king_cfg() ->> 'auto_hours')::int > 0 then (public._king_cfg() ->> 'auto_hours') || '시간' else '꺼짐(사람이 확정)' end, 'true';
