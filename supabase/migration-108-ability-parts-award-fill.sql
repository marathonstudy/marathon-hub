-- ============================================================
--  migration-108-ability-parts-award-fill.sql — 능력치 영역 정보 · 옛 기록 달의 월간 배지 (20261113d)
--  (108 은 107 다음 · 여러 번 실행해도 안전 · 그다음 함수 app-sync · app-report 다시 배포)
--
--  왜 — 러닝노트 옛 기록 학생: 주간 배지는 1월부터 채워졌는데(채움) 월간 배지는 1~10월 모두 0 · 능력치는 최근 4주도 모든 영역 0
--  1. 영역 정보 유지 — 받을 때마다 저장본을 통째로 바꾸므로, 이번에 받은 경로(학생 기준 주소 / 공유 코드)에 과제 안 영역별 결과(parts)가 없으면
--     예전에 받아 둔 같은 과제(제출 시각 + 제목)의 영역 정보를 그대로 둔다 (app_sync_save · 맞힌 수가 모두 0 인 영역 정보는 옮기지 않음)
--  2. 잘못 저장된 옛 기록 다시 받기 — 예전 받기 함수는 앱이 맞힌 수를 비워(null) 보내면 「0개 맞힘」으로 저장했다
--     옛 기록에 영역 정보가 있는 과제가 3개 이상인데 맞힌 수가 모두 0 인 학생만 옛 기록을 비우고 1월부터 다시 받게 한다 (주간 배지 채움은 그대로)
--  3. 옛 기록 달의 월간 배지 — 기존 규칙 그대로(설정: 그달 제출률 90% 이상 · 그달 과제 8개 이상 · 늦게 낸 것은 냄 · 면제 뺌 · 과제 수정값 · 토 · 일 안 셈)
--     셈하는 달 — 끝난 달 중 ① 수강 시작 전 달(옛 기록) ② 코치룸이 그달 월간 배지를 아직 셈하지 않던 달(award_runs 없음)
--     코치룸이 셈한 달(award_runs 있음 · 수강 중)은 예전처럼 원장이 보낸 달만
--     「🏅 내 배지」 월간 칸에 받은 달과 똑같이 금색 · 누르면 「채움 — 지난 기록으로 다시 셈 · 제출 n/n」
--     문자 · 알림톡에 쓰는 배지 수(award_list badges · _badge_count) · 반 카드 배지 수에는 넣지 않는다 (지난번과 같음 · 문자 · 알림톡 없음)
--  확인: check-ability-parts-1113.sql
-- ============================================================


-- ------------------------------------------------------------
--  1. 영역 정보 유지
-- ------------------------------------------------------------
/* 과제 목록 p_new 중 영역 정보가 없는 과제에 p_old 의 같은 과제(제출 시각 + 제목) 영역 정보를 붙인다 */
create or replace function public._parts_keep_list(p_new jsonb, p_old jsonb)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(p_new) <> 'array' or jsonb_typeof(p_old) <> 'array' then p_new
    when not exists (select 1 from jsonb_array_elements(p_old) o where jsonb_typeof(o -> 'parts') = 'array') then p_new
    else coalesce((
      select jsonb_agg(case
               when jsonb_typeof(h -> 'parts') = 'array' and h -> 'parts' <> '[]'::jsonb then h
               else h || coalesce((
                 select jsonb_build_object('parts', o -> 'parts')
                   from jsonb_array_elements(p_old) o
                  where o ->> 'submittedAt' = h ->> 'submittedAt' and coalesce(o ->> 'title', '') = coalesce(h ->> 'title', '')
                    and jsonb_typeof(o -> 'parts') = 'array'
                    and exists (select 1 from jsonb_array_elements(o -> 'parts') p where coalesce(p ->> 'k', '') ~ '^\d+$' and (p ->> 'k')::int > 0)
                  limit 1), '{}'::jsonb) end
             order by i)
        from jsonb_array_elements(p_new) with ordinality x(h, i)), '[]'::jsonb)
  end;
$$;
revoke all on function public._parts_keep_list(jsonb, jsonb) from public, anon, authenticated;

create or replace function public._parts_keep(p_new jsonb, p_old jsonb)
returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p_new) <> 'object' or jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_old -> 'history') <> 'array' then p_new
    else p_new
         || case when jsonb_typeof(p_new -> 'history') = 'array' then jsonb_build_object('history', public._parts_keep_list(p_new -> 'history', p_old -> 'history')) else '{}'::jsonb end
         || case when jsonb_typeof(p_new -> 'recent') = 'array' then jsonb_build_object('recent', public._parts_keep_list(p_new -> 'recent', p_old -> 'history')) else '{}'::jsonb end
  end;
$$;
revoke all on function public._parts_keep(jsonb, jsonb) from public, anon, authenticated;

/* 받은 결과 저장 (102 와 같고) — data 만 영역 정보 유지 */
create or replace function public.app_sync_save(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; okn int := 0; bad int := 0; why text; uf text; u bigint;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    sid := (r ->> 'id')::uuid;
    if not exists (select 1 from public.students where id = sid) then continue; end if;
    uf := left(coalesce(r ->> 'user_fail', ''), 40);
    if coalesce((r ->> 'ok')::boolean, false) then
      insert into public.app_records (student_id, data, lite, fetched_at, fail_reason, fail_at, fail_count, next_try, updated_at, src, user_fail, user_fail_at)
      values (sid, r -> 'data', r -> 'lite', now(), '', null, 0, null, now(), left(coalesce(r ->> 'src', ''), 10), uf, case when uf <> '' then now() end)
      on conflict (student_id) do update set data = public._parts_keep(excluded.data, public.app_records.data), lite = excluded.lite, fetched_at = now(),
        fail_reason = '', fail_at = null, fail_count = 0, next_try = null, updated_at = now(),
        src = excluded.src, user_fail = excluded.user_fail, user_fail_at = coalesce(excluded.user_fail_at, case when excluded.user_fail = '' then null else public.app_records.user_fail_at end);
      okn := okn + 1;
    else
      why := left(coalesce(r ->> 'reason', 'upstream'), 40);
      insert into public.app_records (student_id, fail_reason, fail_at, fail_count, next_try, updated_at, user_fail, user_fail_at)
      values (sid, why, now(), 1, now() + case when why = 'expired' then interval '24 hours' else interval '5 minutes' end, now(), uf, case when uf <> '' then now() end)
      on conflict (student_id) do update set fail_reason = why, fail_at = now(), fail_count = public.app_records.fail_count + 1,
        next_try = now() + case when why = 'expired' then interval '24 hours'
                                else least(interval '30 minutes', interval '5 minutes' * power(2, least(public.app_records.fail_count, 4))) end,
        updated_at = now(), user_fail = case when uf <> '' then uf else public.app_records.user_fail end,
        user_fail_at = case when uf <> '' then now() else public.app_records.user_fail_at end;
      bad := bad + 1;
    end if;
    /* 공유 응답의 앱 학생 id — 아직 연결 안 된 학생이고 다른 학생이 쓰지 않을 때만 */
    if coalesce(r ->> 'uid', '') ~ '^\d{1,18}$' then
      u := (r ->> 'uid')::bigint;
      update public.student_links l set app_user_id = u, app_user_by = 'share', app_user_at = now(), app_link_state = 'ok', app_link_cands = '[]'::jsonb
       where l.student_id = sid and l.app_user_id is null
         and not exists (select 1 from public.student_links o where o.app_user_id = u and o.student_id <> sid);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', okn, 'failed', bad);
end;
$$;
revoke all on function public.app_sync_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_sync_save(jsonb) to service_role;


-- ------------------------------------------------------------
--  2. 잘못 저장된 옛 기록 다시 받기 (영역 정보가 있는 과제 3개 이상 · 맞힌 수 모두 0)
-- ------------------------------------------------------------
create or replace function public._parts_blank(p_hist jsonb)
returns boolean language sql immutable as $$
  select coalesce((
    select count(*) >= 3 and count(*) filter (where z.pos) = 0
      from (select exists (select 1 from jsonb_array_elements(h -> 'parts') p where coalesce(p ->> 'k', '') ~ '^\d+$' and (p ->> 'k')::int > 0) pos
              from jsonb_array_elements(case when jsonb_typeof(p_hist) = 'array' then p_hist else '[]'::jsonb end) h
             where jsonb_typeof(h -> 'parts') = 'array' and h -> 'parts' <> '[]'::jsonb) z), false);
$$;
revoke all on function public._parts_blank(jsonb) from public, anon, authenticated;

do $$
declare ids uuid[];
begin
  select coalesce(array_agg(r.student_id), '{}') into ids from public.app_records r where r.old is not null and public._parts_blank(r.old -> 'history');
  if array_length(ids, 1) > 0 then
    delete from public.app_old_parts where student_id = any(ids);
    update public.app_records set old = null, old_n = 0, old_first = null, old_at = null, old_month = null, old_months = 0, old_got_n = 0,
           old_fails = 0, old_try = null, old_status = '', old_err = ''
     where student_id = any(ids);
  end if;
end;
$$;


-- ------------------------------------------------------------
--  3. 옛 기록 달의 월간 배지 (기존 규칙 · 셈만 · 저장 · 발송 없음)
-- ------------------------------------------------------------
/* [{ m: 'YYYY-MM', done, total }] — 받은 달만 */
create or replace function public._award_fill(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  st date; r public.app_records; cut date; cfg jsonb := public._award_cfg();
  cur date := date_trunc('month', (now() at time zone 'Asia/Seoul'))::date; out jsonb;
begin
  select s.start_on into st from public.students s where s.id = p_student;
  select * into r from public.app_records a where a.student_id = p_student;
  if not found or (r.data is null and r.old is null) then return '[]'::jsonb; end if;
  cut := case when coalesce(r.old ->> 'cut', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r.old ->> 'cut')::date else st end;
  with cal as (
    select (c ->> 'date')::date d, c ->> 'status' s, case when coalesce(c ->> 'order', '') ~ '^\d+$' then (c ->> 'order')::bigint else 0 end o, 2 w
      from jsonb_array_elements(case when jsonb_typeof(r.old -> 'calendar') = 'array' then r.old -> 'calendar' else '[]'::jsonb end) c
     where coalesce(c ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' and (cut is null or (c ->> 'date')::date < cut)
    union all
    select (c ->> 'date')::date, c ->> 'status', case when coalesce(c ->> 'order', '') ~ '^\d+$' then (c ->> 'order')::bigint else 0 end, 1
      from jsonb_array_elements(case when jsonb_typeof(r.data -> 'calendar') = 'array' then r.data -> 'calendar' else '[]'::jsonb end) c
     where coalesce(c ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' and (cut is null or (c ->> 'date')::date >= cut)
  ), fx as (
    select distinct on (f.day) f.day d, f.status s from public.hw_fixes f where f.student_id = p_student order by f.day, f.id desc
  ), days as (
    select c.d, c.s, c.o, c.w from cal c
    union all
    select fx.d, fx.s, 0, 3 from fx where fx.s <> 'app' and not exists (select 1 from cal c where c.d = fx.d)
  ), ord as (
    select distinct (h ->> 'order')::bigint o
      from jsonb_array_elements(case when jsonb_typeof(r.old -> 'history') = 'array' then r.old -> 'history' else '[]'::jsonb end
                                || case when jsonb_typeof(r.data -> 'history') = 'array' then r.data -> 'history' else '[]'::jsonb end) h
     where coalesce(h ->> 'submittedAt', '') <> '' and coalesce(h ->> 'order', '') ~ '^\d+$' and (h ->> 'order')::bigint > 0
  ), d1 as (
    select distinct on (x.d) x.d,
           coalesce((select fx.s from fx where fx.d = x.d and fx.s <> 'app'),
                    case when x.s = 'none' and x.o > 0 and exists (select 1 from ord where ord.o = x.o) then 'late' else x.s end) s
      from days x
     where extract(isodow from x.d) <= 5 and x.d < cur
     order by x.d, x.w
  ), mm as (
    select date_trunc('month', d1.d)::date m,
           count(*) filter (where d1.s in ('onTime', 'late')) dn,
           count(*) filter (where d1.s in ('onTime', 'late', 'none')) tt
      from d1 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('m', to_char(mm.m, 'YYYY-MM'), 'done', mm.dn, 'total', mm.tt) order by mm.m), '[]'::jsonb) into out
    from mm
   where mm.tt >= (cfg ->> 'min')::int and mm.dn * 100 >= (cfg ->> 'pct')::int * mm.tt
     and not exists (select 1 from public.routine_awards a where a.student_id = p_student and a.month = mm.m and a.sent_at is not null)
     and (not exists (select 1 from public.award_runs x where x.month = mm.m)
          or (st is not null and (mm.m + interval '1 month')::date - 1 < st));
  return out;
end;
$$;
revoke all on function public._award_fill(uuid) from public, anon, authenticated;

/* 배지 모음 (102 와 같고) — months 에 옛 기록 달의 월간 배지(채움)를 더함 · mfill [{ m, done, total }] */
create or replace function public._badge_box(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare mf jsonb := public._award_fill(p_student);
begin
  return jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'perfect', (select count(*)::int from public.hw_weeks w where w.student_id = p_student and w.perfect),
    'filled', (select count(*)::int from public.hw_weeks w where w.student_id = p_student and w.perfect and w.filled),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', x.week_start, 'from', x.lesson_day - 7, 'to', x.lesson_day - 1, 'lesson', x.lesson_day,
                                                           'total', x.total, 'done', x.done, 'perfect', x.perfect, 'filled', x.filled) order by x.week_start)
                         from public.hw_weeks x where x.student_id = p_student), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(m order by m) from (
                          select to_char(a.month, 'YYYY-MM') m from public.routine_awards a where a.student_id = p_student and a.sent_at is not null
                          union select f ->> 'm' from jsonb_array_elements(mf) f) z), '[]'::jsonb),
    'mfill', mf,
    'start', coalesce((select s.start_on from public.students s where s.id = p_student)::text,
                      (select min(w.week_start) from public.hw_weeks w where w.student_id = p_student)::text, ''),
    'first', coalesce(least((select min(w.week_start) from public.hw_weeks w where w.student_id = p_student),
                            (select min(a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null),
                            (select min(((f ->> 'm') || '-01')::date) from jsonb_array_elements(mf) f))::text, ''),
    'cur', (select to_char(a.month, 'YYYY-MM') from public.routine_awards a
             where a.student_id = p_student and a.sent_at is not null and a.month = public._award_prev(now())),
    'kings', jsonb_build_object(
      'wrong', (select count(*) from public.king_weeks k where k.picked = p_student and k.status = 'picked' and k.kind = 'wrong'),
      'text', (select count(*) from public.king_weeks k where k.picked = p_student and k.status = 'picked' and k.kind = 'text'),
      'weeks', coalesce((select jsonb_agg(jsonb_build_object('lesson', k.lesson_day, 'kind', k.kind) order by k.lesson_day, k.kind)
                           from public.king_weeks k where k.picked = p_student and k.status = 'picked'), '[]'::jsonb)));
end;
$$;
revoke all on function public._badge_box(uuid) from public, anon, authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '영역 정보 유지(app_sync_save · _parts_keep)' as what,
       (to_regprocedure('public._parts_keep(jsonb, jsonb)') is not null
        and position('_parts_keep' in pg_get_functiondef('public.app_sync_save(jsonb)'::regprocedure)) > 0)::text as ok
union all select '옛 기록 달 월간 배지(_award_fill)', (to_regprocedure('public._award_fill(uuid)') is not null)::text
union all select '배지 모음에 채움 달(mfill)', (position('mfill' in pg_get_functiondef('public._badge_box(uuid)'::regprocedure)) > 0)::text
union all select '맞힌 수가 모두 0 인 옛 기록이 남지 않음', (not exists (select 1 from public.app_records r where r.old is not null and public._parts_blank(r.old -> 'history')))::text;
