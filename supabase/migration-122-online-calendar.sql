-- ============================================================
--  migration-122-online-calendar.sql — 20261118d · 121 다음 · 여러 번 실행해도 됨 · 함수 배포 없음
--  반 현황표 「오늘」 · 「이번 달 제출」 분모 — 반 기준 달력으로
--
--  원인: 「숙제가 열린 날」을 반 달력이 아니라 학생마다 받아 온 앱 기록(날짜별 칸)에서 셌다
--        → 기록에서 빠진 날은 분모에서도 빠지고(14/14) · 오늘 칸이 없으면 평일인데 「—」(숙제 없는 날)
--  이제(assets/online-run.js compute 와 같은 규칙):
--   · 반 달력 = 그 달 평일 전부(평일은 숙제 있는 날) + 주말은 같은 반 학생 누구든 앱 기록에 숙제(강 번호)가 있는 날만(online_class_extra)
--     앱 반 정보(시작 · 종료일 · 구간 반 · 기준)가 다 있으면 그 기간 안만
--   · 학생마다 분모 = 그 달 1일 또는 그 학생 앱 기록 첫날 중 늦은 날 ~ 오늘 · 기록이 빠진 날은 「안 냄」
--   · 기본 구간(121)도 같은 달력으로 · 연속 · 구간 · 요약표 · 러닝노트 모두
--   · 화면 「오늘」: 열렸는데 안 냄 ✗ · 냄 ✓ · 오늘 기록을 아직 못 받음 「확인 중」(회색) · 「—」는 반 달력에 오늘 숙제가 없을 때만
--  1. online_class_extra(반, 날) — 주말 숙제 날 · 직원만 읽기
--  2. _online_calc 다시(121 + 반 달력) · class_kinds 에 extra(최근 주말 숙제 날 · 코치룸 계산용) · 러닝노트 요약에 extra
--  3. 주말 숙제 날 먼저 모으고 → 온라인 학생 전원 다시 계산 · 맨 끝 확인 표
-- ============================================================

create table if not exists public.online_class_extra (
  class_name text not null,
  day        date not null,
  primary key (class_name, day)
);
alter table public.online_class_extra enable row level security;
drop policy if exists online_class_extra_staff on public.online_class_extra;
create policy online_class_extra_staff on public.online_class_extra for select to authenticated using (public.is_staff());
revoke all on public.online_class_extra from anon;
revoke insert, update, delete on public.online_class_extra from authenticated;
grant select on public.online_class_extra to authenticated;

/* 학생의 온라인 반들 */
create or replace function public._online_classes(p_sid uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c.name order by c.name), '{}') from public.students s join public.classes c on coalesce(c.kind, '') = 'online'
   where s.id = p_sid and (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name));
$$;
revoke all on function public._online_classes(uuid) from public, anon, authenticated;

/* 이 학생 앱 기록의 주말 숙제 날 → 그 학생의 온라인 반마다 */
create or replace function public._online_extra_fill(p_sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.online_class_extra (class_name, day)
  select distinct cn, public._odate(v ->> 'date')
    from public.app_records r
    cross join lateral unnest(public._online_classes(p_sid)) cn
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data -> 'calendar') = 'array' then r.data -> 'calendar' else '[]'::jsonb end) v
   where r.student_id = p_sid and jsonb_typeof(v) = 'object' and public._odate(v ->> 'date') is not null
     and public._onum(v -> 'order') > 0 and extract(isodow from public._odate(v ->> 'date')) in (6, 7)
  on conflict do nothing;
end;
$$;
revoke all on function public._online_extra_fill(uuid) from public, anon, authenticated;

/* 학생 한 명 — 이번 달(오늘 KST) 요약 (121 + 반 달력) */
create or replace function public._online_calc(p_sid uuid, p_today date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t date := coalesce(p_today, (now() at time zone 'Asia/Seoul')::date);
  tt text; ym text; nd int; i int; k int;
  d jsonb; o jsonb; fat timestamptz; found_rec boolean := false;
  cal jsonb; c jsonb; ex text[];
  ds text[] := '{}'; ords numeric[] := '{}'; sts text[] := '{}'; hasc boolean[] := '{}';
  cnt boolean[] := '{}'; ks text[] := '{}'; km text[] := '{}'; gp text[] := '{}'; seg int[] := '{}';
  empty boolean; last_cal text := ''; dd text; ord numeric; st text; wk boolean; cntd boolean;
  golden text; cd int[] := '{}'; n int; b int; hub jsonb := '[]'::jsonb; p_from int; p_to int;
  ok_n int; miss_n int; open_b boolean; hstate text; kk text;
  streak int := 0; streak_me int := 0; miss_run int := 0; m_open int := 0; m_done int := 0; m_ok int := 0;
  today_k text := 'none'; today_m text := 'none';
  lec jsonb; metas jsonb; offs numeric[]; goff numeric; info jsonb; g_ym text; gds text[];
  hit_off numeric; hit_info jsonb; app_status text := 'none'; app_missing jsonb := '[]'::jsonb; app_secs jsonb := '[]'::jsonb;
  open_d date; close_d date; total int; th numeric; bs int; sec_s int[]; sec_e int[]; sn int;
  given jsonb; from_app boolean; gv jsonb; s_on numeric; s_n numeric; s_rate numeric; f_t text; t_t text; s_state text;
  run_no int; run_on numeric; run_n numeric; left_n int; best float8; miss1 float8;
  risk text := ''; risk_sec int; risk_left int; last_sub timestamptz; mis text[];
  app_def boolean := false; first_d date;
  extra text[]; join_d text; a_open text := ''; a_close text := '';
begin
  tt := to_char(t, 'YYYY-MM-DD'); ym := to_char(t, 'YYYY-MM');
  nd := extract(day from (date_trunc('month', t) + interval '1 month - 1 day'))::int;
  select r.data, case when jsonb_typeof(r.old) = 'object' then r.old else null end, r.fetched_at, true into d, o, fat, found_rec
    from public.app_records r where r.student_id = p_sid;
  if not coalesce(found_rec, false) or d is null or jsonb_typeof(d) <> 'object' then
    insert into public.online_student_stats as x (student_id, ym, calc_day, has_rec, fetched_at, updated_at)
    values (p_sid, ym, t, false, fat, now())
    on conflict (student_id) do update set ym = excluded.ym, calc_day = excluded.calc_day, has_rec = false, today_kind = 'none', today_me = 'none',
      month_done = 0, month_open = 0, month_ok = 0, streak = 0, streak_me = 0, miss_run = 0, risk = '', risk_sec = null, risk_left = null, app_status = 'none',
      app_missing = '[]'::jsonb, app_secs = '[]'::jsonb, hub_secs = '[]'::jsonb, golden = null, ex_n = 0, last_submit = null, app_def = false,
      fetched_at = excluded.fetched_at, err = '', updated_at = now();
    return;
  end if;

  /* 날짜별 앱 기록 — 옛 기록 다음 지금 기록 · 같은 날은 뒤의 것 (online-run.js index) */
  select coalesce(jsonb_object_agg(x.dt, jsonb_build_object('o', x.ord, 's', x.st)), '{}'::jsonb) into cal from (
    select distinct on (v ->> 'date') v ->> 'date' as dt, public._onum(v -> 'order') as ord, coalesce(v ->> 'status', '') as st
      from (select 1 as src, e.pos, e.v from jsonb_array_elements(case when jsonb_typeof(o -> 'calendar') = 'array' then o -> 'calendar' else '[]'::jsonb end) with ordinality e(v, pos)
            union all
            select 2, e.pos, e.v from jsonb_array_elements(case when jsonb_typeof(d -> 'calendar') = 'array' then d -> 'calendar' else '[]'::jsonb end) with ordinality e(v, pos)) z
     where jsonb_typeof(v) = 'object' and coalesce(v ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
     order by v ->> 'date', src desc, pos desc) x;
  select coalesce(array_agg(to_char(e.day, 'YYYY-MM-DD')), '{}') into ex from public.online_excuse e where e.student_id = p_sid;

  /* 반 달력 (122) — 주말 숙제 날(같은 반 누구든) · 그 학생 앱 기록 첫날 */
  perform public._online_extra_fill(p_sid);
  select coalesce(array_agg(distinct to_char(x.day, 'YYYY-MM-DD')), '{}') into extra from public.online_class_extra x
   where x.class_name = any(public._online_classes(p_sid)) and to_char(x.day, 'YYYY-MM') = ym;
  select min(k2) into join_d from jsonb_object_keys(cal) k2 where (cal -> k2 ->> 'o')::numeric > 0;

  /* 앱 반 고르기 (online-run.js groups · appOf) — 반 정보가 다 있으면 그 기간이 반 달력 */
  lec := coalesce((select jsonb_agg(l) from jsonb_array_elements(case when jsonb_typeof(d -> 'lectures') = 'array' then d -> 'lectures' else '[]'::jsonb end) l
                    where jsonb_typeof(l) = 'object' and public._onum(l -> 'order') > 0 and public._onum(l -> 'order') < 100000), '[]'::jsonb);
  metas := coalesce((select jsonb_agg(m) from jsonb_array_elements(case when jsonb_typeof(d -> 'classes') = 'array' then d -> 'classes' else '[]'::jsonb end) m
                      where jsonb_typeof(m) = 'object'), '[]'::jsonb);
  select coalesce(array_agg(distinct x order by x), '{}') into offs from (
    select floor(public._onum(l -> 'order') / 1000) * 1000 as x from jsonb_array_elements(lec) l
    union select public._onum(m -> 'off') from jsonb_array_elements(metas) m) q;
  hit_off := null;
  foreach goff in array offs loop
    info := (select m from jsonb_array_elements(metas) with ordinality e(m, pos) where public._onum(m -> 'off') = goff order by pos limit 1);
    if coalesce(info ->> 'openDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then g_ym := left(info ->> 'openDate', 7);
    else
      select coalesce(array_agg(k2 order by k2), '{}') into gds from jsonb_object_keys(cal) k2
       where (cal -> k2 ->> 'o')::numeric > 0 and (cal -> k2 ->> 'o')::numeric < 100000 and floor((cal -> k2 ->> 'o')::numeric / 1000) * 1000 = goff;
      g_ym := case when coalesce(array_length(gds, 1), 0) > 0 then left(gds[(array_length(gds, 1) / 2) + 1], 7) else '' end;
    end if;
    if g_ym = ym then hit_off := goff; hit_info := coalesce(info, '{}'::jsonb); end if;
  end loop;
  if hit_off is not null then
    info := hit_info; mis := '{}';
    if coalesce(info ->> 'openDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then mis := mis || '반 시작일'::text; end if;
    if coalesce(info ->> 'closeDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then mis := mis || '반 종료일'::text; end if;
    if jsonb_typeof(info -> 'hasSections') is distinct from 'boolean' then mis := mis || '구간 반 여부'::text; end if;
    if public._ofin(info -> 'refundThreshold') is null then mis := mis || '환급 기준'::text; end if;
    if coalesce(array_length(mis, 1), 0) = 0 then a_open := info ->> 'openDate'; a_close := info ->> 'closeDate'; end if;
  end if;

  /* 1차 — 이번 달 날짜 · 그 날 기록 */
  for i in 1..nd loop
    dd := ym || '-' || lpad(i::text, 2, '0');
    c := cal -> dd;
    ds := ds || dd; hasc := hasc || (c is not null);
    ords := ords || coalesce((c ->> 'o')::numeric, 0); sts := sts || coalesce(c ->> 's', 'none');
    if c is not null then last_cal := dd; end if;
  end loop;
  empty := last_cal = '';

  /* 2차 — 회차(반 달력 · 그 학생 첫날부터) · 종류(직원 ks · 학생 km) */
  for i in 1..nd loop
    dd := ds[i]; ord := ords[i]; st := sts[i];
    wk := extract(isodow from dd::date) in (6, 7);
    cntd := (not wk or dd = any(extra) or (hasc[i] and ord > 0)) and (a_open = '' or dd >= a_open) and (a_close = '' or dd <= a_close)
            and (join_d is null or dd >= join_d);
    cnt := cnt || cntd; gp := gp || null::text; seg := seg || null::int;
    if not cntd then ks := ks || 'off'::text; km := km || 'off'::text; continue; end if;
    if st = 'onTime' then ks := ks || 'ok'::text; km := km || 'ok'::text; continue; end if;
    km := km || (case when dd > tt then 'future' when dd = tt then case when st = 'late' then 'late' else 'today' end else case when st = 'late' then 'late' else 'miss' end end);
    ks := ks || (case when dd = any(ex) then 'excused' when dd > tt then 'future' when dd = tt then case when st = 'late' then 'late' else 'today' end else case when st = 'late' then 'late' else 'miss' end end);
  end loop;

  /* 골든패스 — 그 달 첫 미제출 · 늦은 인증 (직원만) */
  if not empty then
    for i in 1..nd loop
      if cnt[i] and ks[i] in ('miss', 'late') then gp[i] := ks[i]; ks[i] := 'golden'; golden := ds[i]; exit; end if;
    end loop;
  end if;

  for i in 1..nd loop if cnt[i] then cd := cd || i; end if; end loop;
  n := coalesce(array_length(cd, 1), 0);

  /* 허브 기준 구간 — 회차를 3으로(나머지는 3구간) */
  b := n / 3;
  for k in 1..3 loop
    p_from := case k when 1 then 0 when 2 then b else b * 2 end;
    p_to := case k when 1 then b when 2 then b * 2 else n end;
    ok_n := 0; miss_n := 0; open_b := false;
    for i in (p_from + 1)..p_to loop
      if ks[cd[i]] in ('ok', 'excused', 'golden') then ok_n := ok_n + 1; end if;
      if ks[cd[i]] in ('miss', 'late') then miss_n := miss_n + 1; end if;
      if ks[cd[i]] in ('future', 'today') then open_b := true; end if;
    end loop;
    hstate := case when p_to <= p_from then 'none' when miss_n > 0 then 'missed' when not open_b then 'done' when ok_n > 0 then 'run' else 'wait' end;
    hub := hub || jsonb_build_object('no', k, 'n', greatest(p_to - p_from, 0), 'ok', ok_n, 'state', hstate,
                                     'from', case when p_to > p_from then ds[cd[p_from + 1]] else '' end, 'to', case when p_to > p_from then ds[cd[p_to]] else '' end);
  end loop;

  /* 연속 (121 · online-run.js streakOf) */
  for i in reverse n..1 loop
    exit when n = 0;
    if ds[cd[i]] > tt or ks[cd[i]] in ('today', 'future', 'excused') then continue; end if;
    kk := case when ks[cd[i]] = 'golden' then gp[cd[i]] else ks[cd[i]] end;
    if kk in ('ok', 'late') then streak := streak + 1; else exit; end if;
  end loop;
  for i in reverse n..1 loop
    exit when n = 0;
    if ds[cd[i]] > tt or km[cd[i]] in ('today', 'future') then continue; end if;
    if km[cd[i]] in ('ok', 'late') then streak_me := streak_me + 1; else exit; end if;
  end loop;
  for i in reverse n..1 loop
    exit when n = 0;
    if ds[cd[i]] >= tt then continue; end if;
    if coalesce(gp[cd[i]], ks[cd[i]]) = 'miss' then miss_run := miss_run + 1; else exit; end if;
  end loop;
  for i in 1..nd loop
    if ds[i] = tt then
      today_k := case when cnt[i] then ks[i] else 'none' end;
      today_m := case when cnt[i] then km[i] else 'none' end;
    end if;
    if cnt[i] and ds[i] <= tt then m_open := m_open + 1; if sts[i] in ('onTime', 'late') then m_done := m_done + 1; end if; end if;
    if cnt[i] and km[i] = 'ok' then m_ok := m_ok + 1; end if;
  end loop;

  /* 앱 기준 구간 */
  if hit_off is not null then
    info := hit_info; mis := '{}';
    if coalesce(info ->> 'openDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then mis := mis || '반 시작일'::text; end if;
    if coalesce(info ->> 'closeDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then mis := mis || '반 종료일'::text; end if;
    if jsonb_typeof(info -> 'hasSections') is distinct from 'boolean' then mis := mis || '구간 반 여부'::text; end if;
    if public._ofin(info -> 'refundThreshold') is null then mis := mis || '환급 기준'::text; end if;
    app_missing := to_jsonb(mis);
    if coalesce(array_length(mis, 1), 0) > 0 then app_status := 'unknown';
    else
      open_d := public._odate(info ->> 'openDate'); close_d := public._odate(info ->> 'closeDate'); th := public._ofin(info -> 'refundThreshold');
      total := case when open_d is not null and close_d is not null then (close_d - open_d) + 1 end;
      if not (info ->> 'hasSections')::boolean or total is null or not (total > 26) then app_status := 'nosec';
      else
        app_status := 'ok';
        given := case when jsonb_typeof(info -> 'sectionStats') = 'array' then info -> 'sectionStats' end;
        from_app := given is not null and jsonb_array_length(given) = 3;
        bs := total / 3; sec_s := array[1, bs + 1, bs * 2 + 1]; sec_e := array[bs, bs * 2, total];
        for k in 1..3 loop
          gv := case when from_app then (select x from jsonb_array_elements(given) x where public._onum(x -> 'section') = k limit 1) end;
          if gv is not null then s_on := public._onum(gv -> 'on'); s_n := public._onum(gv -> 'n'); s_rate := public._onum(gv -> 'rate');
          else
            select coalesce(sum(public._onum(l -> 'hwTotal')), 0), coalesce(sum(public._onum(l -> 'hwOnTime')), 0) into s_n, s_on
              from jsonb_array_elements(lec) l
             where floor(public._onum(l -> 'order') / 1000) * 1000 = hit_off
               and public._onum(l -> 'order') - hit_off between sec_s[k] and sec_e[k];
            s_rate := case when s_n > 0 then floor((s_on::float8 / s_n::float8) * 100 + 0.5) else 0 end;
          end if;
          f_t := to_char(open_d + (sec_s[k] - 1), 'YYYY-MM-DD'); t_t := to_char(open_d + (sec_e[k] - 1), 'YYYY-MM-DD');
          s_state := case when not (tt >= f_t) then 'wait' when not (tt > t_t) then 'run' when s_rate >= th then 'done' else 'missed' end;
          app_secs := app_secs || jsonb_build_object('no', k, 's', sec_s[k], 'e', sec_e[k], 'from', f_t, 'to', t_t, 'on', s_on, 'n', s_n, 'rate', s_rate, 'state', s_state);
          for i in 1..nd loop
            if ords[i] <> 0 and ords[i] < 100000 and floor(ords[i] / 1000) * 1000 = hit_off and ords[i] - hit_off between sec_s[k] and sec_e[k] then seg[i] := k; end if;
          end loop;
          if s_state = 'run' and run_no is null then run_no := k; run_on := s_on; run_n := s_n; end if;
        end loop;
      end if;
    end if;
  end if;

  /* 기본 구간 (121 · 122 반 달력) — 그 달 1일 ~ 말일 · 3등분 · 구간마다 오늘까지 반 달력에서 열린 날 중 정시 */
  if app_status in ('none', 'unknown') then
    app_def := true; app_status := 'ok'; app_secs := '[]'::jsonb; run_no := null;
    th := public._online_th(p_sid);
    first_d := date_trunc('month', t)::date;
    bs := nd / 3; sec_s := array[1, bs + 1, bs * 2 + 1]; sec_e := array[bs, bs * 2, nd];
    for k in 1..3 loop
      s_on := 0; s_n := 0;
      for i in sec_s[k]..sec_e[k] loop
        if cnt[i] and ds[i] <= tt then s_n := s_n + 1; if sts[i] = 'onTime' then s_on := s_on + 1; end if; end if;
        if cnt[i] then seg[i] := k; end if;
      end loop;
      s_rate := case when s_n > 0 then floor((s_on::float8 / s_n::float8) * 100 + 0.5) else 0 end;
      f_t := to_char(first_d + (sec_s[k] - 1), 'YYYY-MM-DD'); t_t := to_char(first_d + (sec_e[k] - 1), 'YYYY-MM-DD');
      s_state := case when not (tt >= f_t) then 'wait' when not (tt > t_t) then 'run' when s_rate >= th then 'done' else 'missed' end;
      app_secs := app_secs || jsonb_build_object('no', k, 's', sec_s[k], 'e', sec_e[k], 'from', f_t, 'to', t_t, 'on', s_on, 'n', s_n, 'rate', s_rate, 'state', s_state, 'def', true);
      if s_state = 'run' and run_no is null then run_no := k; run_on := s_on; run_n := s_n; end if;
    end loop;
  end if;

  /* 구간 위험 */
  if app_status = 'ok' then
    if run_no is not null then
      left_n := 0;
      for i in 1..nd loop if cnt[i] and ds[i] >= tt and seg[i] = run_no and ks[i] <> 'ok' then left_n := left_n + 1; end if; end loop;
      best := case when run_n + left_n > 0 then (run_on + left_n)::float8 / (run_n + left_n)::float8 * 100 else 0 end;
      miss1 := case when run_n + left_n > 0 then (run_on + left_n - 1)::float8 / (run_n + left_n)::float8 * 100 else 0 end;
      if left_n > 0 and best >= th and miss1 < th then risk := 'app'; risk_sec := run_no; risk_left := left_n; end if;
    end if;
  else
    select (h ->> 'no')::int into risk_sec from jsonb_array_elements(hub) h where h ->> 'state' = 'run' order by (h ->> 'no')::int limit 1;
    if risk_sec is not null and golden is not null then risk := 'hub'; else risk_sec := null; end if;
  end if;

  select max(public._ots(h ->> 'submittedAt')) into last_sub from (
    select h from jsonb_array_elements(case when jsonb_typeof(d -> 'history') = 'array' then d -> 'history' when jsonb_typeof(d -> 'recent') = 'array' then d -> 'recent' else '[]'::jsonb end) h
    union all select h from jsonb_array_elements(case when jsonb_typeof(o -> 'history') = 'array' then o -> 'history' else '[]'::jsonb end) h) q
   where jsonb_typeof(h) = 'object';

  insert into public.online_student_stats as x (student_id, ym, calc_day, has_rec, today_kind, today_me, month_done, month_open, month_ok, streak, streak_me, miss_run,
                                                risk, risk_sec, risk_left, app_status, app_missing, app_secs, hub_secs, golden, ex_n, last_submit, fetched_at, err, app_def, updated_at)
  values (p_sid, ym, t, true, today_k, today_m, m_done, m_open, m_ok, streak, streak_me, miss_run, risk, risk_sec, risk_left, app_status, app_missing, app_secs, hub,
          golden, (select count(*) from unnest(ks) z where z = 'excused'), last_sub, fat, '', app_def, now())
  on conflict (student_id) do update set ym = excluded.ym, calc_day = excluded.calc_day, has_rec = true, today_kind = excluded.today_kind, today_me = excluded.today_me,
    month_done = excluded.month_done, month_open = excluded.month_open, month_ok = excluded.month_ok, streak = excluded.streak, streak_me = excluded.streak_me, miss_run = excluded.miss_run,
    risk = excluded.risk, risk_sec = excluded.risk_sec, risk_left = excluded.risk_left, app_status = excluded.app_status, app_missing = excluded.app_missing,
    app_secs = excluded.app_secs, hub_secs = excluded.hub_secs, golden = excluded.golden, ex_n = excluded.ex_n, last_submit = excluded.last_submit,
    fetched_at = excluded.fetched_at, err = '', app_def = excluded.app_def, updated_at = now();
end;
$$;
revoke all on function public._online_calc(uuid, date) from public, anon, authenticated;

/* 러닝노트 요약(121) + 반 달력 주말 숙제 날(extra · 그 달) */
create or replace function public._online_me(p_sid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.online_student_stats; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public._is_online_student(p_sid) then return null; end if;
  select * into x from public.online_student_stats where student_id = p_sid;
  if not found or x.calc_day is distinct from t then perform public._online_calc_safe(p_sid); select * into x from public.online_student_stats where student_id = p_sid; end if;
  if not found or x.calc_day is distinct from t or not x.has_rec then return null; end if;
  return jsonb_build_object('ym', x.ym, 'day', x.calc_day, 'today', x.today_me, 'done', x.month_done, 'open', x.month_open, 'ok', x.month_ok, 'streak', x.streak_me,
    'app_status', x.app_status, 'th', public._online_th(p_sid),
    'extra', coalesce((select jsonb_agg(distinct to_char(e.day, 'YYYY-MM-DD')) from public.online_class_extra e
                        where e.class_name = any(public._online_classes(p_sid)) and e.day >= (t - 70)), '[]'::jsonb),
    'app', coalesce((select jsonb_agg(jsonb_build_object('no', e -> 'no', 'state', e -> 'state', 'on', e -> 'on', 'n', e -> 'n', 'from', e -> 'from', 'to', e -> 'to'))
                       from jsonb_array_elements(x.app_secs) e), '[]'::jsonb));
end;
$$;
revoke all on function public._online_me(uuid) from public, anon, authenticated;

/* 반 종류(121) + 반 달력 주말 숙제 날(extra · 최근 70일 · 코치룸 학생 카드 · 월말 정리 계산용) */
create or replace function public.class_kinds()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'use_time', c.use_time, 'use_consult', c.use_consult, 'use_mogo', c.use_mogo,
                                                       'send_on', c.send_on, 'app_class_id', c.app_class_id, 'kings_on', coalesce(c.kings_on, false), 'refund_th', c.refund_default,
                                                       'extra', coalesce((select jsonb_agg(to_char(e.day, 'YYYY-MM-DD') order by e.day) from public.online_class_extra e
                                                                           where e.class_name = c.name and e.day >= ((now() at time zone 'Asia/Seoul')::date - 70)), '[]'::jsonb),
                                                       'members', (select count(*) from public.class_members m join public.students s on s.id = m.student_id and not s.archived where m.class_name = c.name))
                                    order by c.name)
                     from public.classes c), '[]'::jsonb);
end;
$$;
revoke all on function public.class_kinds() from public, anon;
grant execute on function public.class_kinds() to authenticated;

/* 전체 다시 계산 — 주말 숙제 날을 먼저 모두 모은 뒤(같은 반 달력이 처음부터 같게) */
create or replace function public.online_stats_all()
returns integer language plpgsql security definer set search_path = public as $$
declare sid uuid; n int := 0;
begin
  for sid in select s.id from public.students s where not s.archived and public._is_online_student(s.id) loop
    perform public._online_extra_fill(sid);
  end loop;
  for sid in select s.id from public.students s where not s.archived and public._is_online_student(s.id) loop
    perform public._online_calc_safe(sid); n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.online_stats_all() from public, anon, authenticated;
grant execute on function public.online_stats_all() to service_role;

select public.online_stats_all() as "온라인 학생 다시 계산(명 · 반 달력)";

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '121이 먼저 있음(classes.refund_default)' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'refund_default')::text as ok
union all select '주말 숙제 날 표(online_class_extra) · 직원만', (to_regclass('public.online_class_extra') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_class_extra'::regclass) and not has_table_privilege('anon', 'public.online_class_extra', 'select'))::text
union all select '반 달력으로 계산(_online_calc)', (position('_online_extra_fill' in pg_get_functiondef('public._online_calc(uuid,date)'::regprocedure)) > 0)::text
union all select '러닝노트 · 코치룸도 같은 달력(extra)', (position('extra' in pg_get_functiondef('public._online_me(uuid)'::regprocedure)) > 0
  and position('online_class_extra' in pg_get_functiondef('public.class_kinds()'::regprocedure)) > 0)::text
union all select '온라인 학생 전원 다시 계산됨', (not exists (select 1 from public.students s where not s.archived and public._is_online_student(s.id)
  and not exists (select 1 from public.online_student_stats x where x.student_id = s.id and x.calc_day = (now() at time zone 'Asia/Seoul')::date)))::text;
