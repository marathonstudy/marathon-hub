-- ============================================================
--  migration-090-consult-split.sql — 빠른 상담 「과제 상담 / 일반 상담」 (20261109c)
--  (090 은 089 다음 · 087 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  1. student_notes 에 칸만 더한다 (예전 칸 · 기록은 지우지 않는다)
--       kind      — 'hw' 과제 상담 · 'general' 일반 상담 · 비어 있으면 예전 기록 (화면이 분류에서 짐작)
--       hw_from · hw_to — 과제 상담이 붙는 기간 (그 반의 가장 최근 수업 전 주 D-7 ~ D-1 · 과제 문자 · 수업 전 예고와 같은 기간)
--       hw_done · hw_total — 저장할 때 그 기간 과제 수 (「11/2~11/6 · 3/5」)
--  2. 과제 상담은 학생 · 기간마다 하나 — 같은 기간에 다시 저장하면 그 기록을 고친다 (consult_hw_save)
--       약속이 바뀌면 판정을 비우고 다시 판정 · 쓴 사람은 그대로 · 고친 사람 · 시각은 「수정됨」으로 남는다
--  3. 운영진 과제 현황 문자 「(약속 …)」 — 과제 상담의 약속만 본다 (일반 상담은 안 봄)
--  학생 · 학부모 화면 · 문자 함수는 student_notes 를 읽지 않는다 (그대로)
-- ============================================================

-- ------------------------------------------------------------
--  1. 칸
-- ------------------------------------------------------------
alter table public.student_notes add column if not exists kind     text;
alter table public.student_notes add column if not exists hw_from  date;
alter table public.student_notes add column if not exists hw_to    date;
alter table public.student_notes add column if not exists hw_done  smallint;
alter table public.student_notes add column if not exists hw_total smallint;
alter table public.student_notes drop constraint if exists student_notes_kind_check;
alter table public.student_notes add constraint student_notes_kind_check check (kind is null or kind in ('hw', 'general'));
alter table public.student_notes drop constraint if exists student_notes_hw_period_check;
alter table public.student_notes add constraint student_notes_hw_period_check check (kind is distinct from 'hw' or (hw_from is not null and hw_to is not null and hw_from <= hw_to));
/* 학생 · 기간마다 과제 상담 하나 (지운 기록은 빼고) */
create unique index if not exists student_notes_hw_period on public.student_notes (student_id, hw_from) where kind = 'hw' and deleted_at is null;


-- ------------------------------------------------------------
--  2. 과제 상담 저장 — 같은 기간이면 고치기
--     p = { student, from, to, reason, promise, picks, goal_n, goal_all, goal_lesson, miss: [날짜], done, total, follow, hw_day }
-- ------------------------------------------------------------
create or replace function public.consult_hw_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sid uuid; f date; t date; ex public.student_notes;
  rs text := btrim(left(coalesce(p ->> 'reason', ''), 500));
  pr text := btrim(left(coalesce(p ->> 'promise', ''), 500));
  gn int := case when (p ->> 'goal_n') ~ '^\d{1,2}$' then (p ->> 'goal_n')::int end;
  ga boolean := coalesce((p ->> 'goal_all')::boolean, false);
  gl date := case when (p ->> 'goal_lesson') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'goal_lesson')::date end;
  ms date[] := '{}'; bd text; kd date := (now() at time zone 'Asia/Seoul')::date; nid uuid;
begin
  if not public.is_staff() then raise exception '운영진만 저장할 수 있습니다.'; end if;
  if coalesce(p ->> 'student', '') !~ '^[0-9a-f-]{36}$' or coalesce(p ->> 'from', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p ->> 'to', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '학생 · 기간이 맞지 않습니다.';
  end if;
  sid := (p ->> 'student')::uuid; f := (p ->> 'from')::date; t := (p ->> 'to')::date;
  if f > t or t - f > 13 then raise exception '기간이 맞지 않습니다.'; end if;
  if rs = '' and pr = '' then raise exception '이유나 약속 중 하나는 적어 주세요.'; end if;
  if pr = '' or not (gn is not null or ga) then gn := null; ga := false; gl := null; end if;
  select coalesce(array_agg(x::date order by x), '{}') into ms
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'miss') = 'array' then p -> 'miss' else '[]'::jsonb end) x where x ~ '^\d{4}-\d{2}-\d{2}$';
  bd := concat_ws(E'\n', nullif(case when rs <> '' then '이유: ' || rs end, ''), nullif(case when pr <> '' then '약속: ' || pr end, ''),
                  case when array_length(ms, 1) > 0 then '안 낸 날: ' || (select string_agg(to_char(d, 'FMMM/FMDD') || '(' || (array['일','월','화','수','목','금','토'])[extract(dow from d)::int + 1] || ')', ' · ' order by d) from unnest(ms) d) end);
  select * into ex from public.student_notes where student_id = sid and kind = 'hw' and hw_from = f and deleted_at is null for update;
  if found then
    update public.student_notes set
      reason = rs, promise = pr, next_check = left(pr, 200), body = bd,
      picks = case when jsonb_typeof(p -> 'picks') = 'object' then p -> 'picks' else picks end,
      miss_days = ms, hw_to = t,
      hw_done = case when (p ->> 'done') ~ '^\d{1,2}$' then (p ->> 'done')::int else hw_done end,
      hw_total = case when (p ->> 'total') ~ '^\d{1,2}$' then (p ->> 'total')::int else hw_total end,
      follow_up = coalesce((p ->> 'follow')::boolean, follow_up),
      hw_day = coalesce(case when (p ->> 'hw_day') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'hw_day')::date end, hw_day),
      goal_n = gn, goal_all = ga, goal_lesson = gl,
      /* 약속이 바뀌면 판정을 비운다 (다시 판정) */
      verdict = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict end,
      verdict_done = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_done end,
      verdict_total = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_total end,
      verdict_by = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_by end
     where id = ex.id;
    return jsonb_build_object('ok', true, 'id', ex.id, 'updated', true);
  end if;
  insert into public.student_notes (student_id, note_date, categories, kind, hw_from, hw_to, hw_done, hw_total, body, reason, promise, next_check,
                                    picks, miss_days, goal_n, goal_all, goal_lesson, follow_up, hw_day)
  values (sid, kd, array['과제'], 'hw', f, t,
          case when (p ->> 'done') ~ '^\d{1,2}$' then (p ->> 'done')::int end, case when (p ->> 'total') ~ '^\d{1,2}$' then (p ->> 'total')::int end,
          bd, rs, pr, left(pr, 200), case when jsonb_typeof(p -> 'picks') = 'object' then p -> 'picks' else '{}'::jsonb end,
          ms, gn, ga, gl, coalesce((p ->> 'follow')::boolean, false),
          case when (p ->> 'hw_day') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'hw_day')::date end)
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'updated', false);
end;
$$;
revoke all on function public.consult_hw_save(jsonb) from public, anon;
grant execute on function public.consult_hw_save(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 운영진 과제 현황 문자 — 과제 상담의 약속만 (예전 기록은 분류 「과제」 · 이유나 약속이 있는 것)
-- ------------------------------------------------------------
create or replace function public._consult_tag(p_student uuid, p_day date, p_done int, p_total int)
returns text language plpgsql stable security definer set search_path = public as $$
declare n record; tot int; dn int; tg int; vd text;
begin
  select * into n from public.student_notes x
   where x.student_id = p_student and x.deleted_at is null and x.promise <> '' and x.note_date < p_day
     and (x.kind = 'hw' or (x.kind is null and '과제' = any(x.categories)))
   order by coalesce(x.hw_from, x.note_date) desc, x.note_date desc, x.created_at desc limit 1;
  if not found then return ''; end if;
  if n.goal_n is null and not n.goal_all then
    return ' (약속: ' || left(n.promise, 20) || case when char_length(n.promise) > 20 then '…' else '' end || ')';
  end if;
  tot := coalesce(n.verdict_total, case when n.goal_lesson = p_day and p_total > 0 then p_total end);
  dn  := coalesce(n.verdict_done, case when n.goal_lesson = p_day and p_total > 0 then p_done end);
  vd  := coalesce(n.verdict, case when n.goal_lesson = p_day then public._consult_verdict(n.goal_n, n.goal_all, p_done, p_total) end);
  tg  := case when n.goal_all then tot else least(n.goal_n, coalesce(tot, n.goal_n)) end;
  return ' (약속 ' || coalesce(tg::text || '개', '전부') ||
         case when dn is not null and vd is not null then ' → ' || dn || '개 ' || case vd when 'kept' then '✓' else '✕' end else '' end || ')';
end;
$$;
revoke all on function public._consult_tag(uuid, date, int, int) from public, anon, authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '과제 상담 · 일반 상담 칸(kind · hw_from)' as what, exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'hw_from')::text as ok
union all select '학생 · 기간마다 과제 상담 하나', exists (select 1 from pg_indexes where indexname = 'student_notes_hw_period')::text
union all select '과제 상담 저장(같은 기간이면 고치기)', exists (select 1 from pg_proc where proname = 'consult_hw_save')::text
union all select '운영진 문자 약속 — 과제 상담만', (position('kind = ''hw''' in pg_get_functiondef('public._consult_tag(uuid, date, int, int)'::regprocedure)) > 0)::text
union all select '예전 기록 그대로(지운 칸 없음)', exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'categories')::text
union all select '직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text;
