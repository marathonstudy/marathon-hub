-- ============================================================
--  migration-119-online-stats.sql — 20261118a · 118 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  온라인 반 화면 빠르게 — 학생별 온라인 요약표(미리 계산해 두기)
--
--  왜: 「오늘」 💻 온라인 탭이 반마다 online_run_class(학생 전원의 앱 기록 통째 · 옛 기록 1년치까지)를
--      한꺼번에 불러 브라우저에서 계산했다 → 49명 반에서 statement timeout · 반 여러 개면 더 느림
--  이제: 학생마다 한 줄(online_student_stats)을 미리 계산해 두고, 반 카드 · 반 현황표 · 러닝노트 요약은 이 줄만 읽는다
--
--  1. online_student_stats — 학생 · 이번 달 · 오늘 · 이번 달 제출 n/n · 연속 · 연속 미제출 · 구간(앱 기준 · 허브 기준) ·
--     구간 위험 · 마지막 제출 · 앱 기록 받은 시각 · 계산한 날 · 갱신 시각 (직원만 읽기 · RLS · 쓰기는 서버 함수만)
--  2. _online_calc(학생) — assets/online-run.js compute · admin/online-today.js 와 같은 규칙(시험 e2e151 이 두 쪽 결과를 맞춰 본다)
--  3. 다시 계산 — 앱 기록이 저장되면(app_records 트리거 · app-sync 그대로) · 사정 인정을 바꾸면(online_excuse 트리거) 그 학생 줄만 ·
--     자정(KST) 1회 전체(pg_cron online-stats-night) · 읽을 때 날짜가 지난 줄은 60명까지 바로
--  4. 읽기 — online_stats_sum(반) 반 카드 한 줄 · online_stats_class(반) 반 현황표 · online_stats_calc(학생들) [지금 계산] (직원만)
--     hub_online_stats(링크) 러닝노트 — 본인 것만 · 골든패스 · 사정 인정 · 허브 기준 · 기준 % 없음
--  5. 색인 — class_members(student_id) (나머지는 이미 있음: app_records · student_links · online_excuse 기본 키 · students(class_name))
--  6. 처음 한 번 전체 채우기 · 맨 끝 확인 표
--  문자 · 알림톡 없음 · 이름 · 전화번호는 표에 넣지 않는다(읽을 때 students 에서 이름만)
-- ============================================================

/* ---------- 1. 요약표 ---------- */
create table if not exists public.online_student_stats (
  student_id   uuid primary key references public.students(id) on delete cascade,
  ym           text not null default '',
  calc_day     date,
  has_rec      boolean not null default false,
  today_kind   text not null default 'none',     -- 직원(사정 인정 · 골든패스 포함) · ok · late · golden · excused · today · none
  today_me     text not null default 'none',     -- 학생 · 학부모(앱 기록만)
  month_done   integer not null default 0,       -- 이번 달 1일 ~ 오늘 숙제가 열린 날 중 제출(정시 · 늦게)
  month_open   integer not null default 0,
  month_ok     integer not null default 0,       -- 이번 달 정시 인증 일(러닝노트 「이번 달 인증 n일」)
  streak       integer not null default 0,       -- 직원(정시 · 사정 인정 · 골든패스)
  streak_me    integer not null default 0,       -- 학생 · 학부모(정시만)
  miss_run     integer not null default 0,       -- 어제까지 연속 미제출(골든패스로 인정한 날도 안 낸 날로 셈)
  risk         text not null default '',         -- '' · 'app'(남은 회차 다 내야 기준) · 'hub'(골든패스를 쓰고 진행 중)
  risk_sec     integer,
  risk_left    integer,
  app_status   text not null default 'none',     -- none(그 달 앱 반 없음) · unknown(앱 반 정보 없음) · nosec · ok
  app_missing  jsonb not null default '[]'::jsonb,
  app_secs     jsonb not null default '[]'::jsonb,
  hub_secs     jsonb not null default '[]'::jsonb,
  golden       text,
  ex_n         integer not null default 0,
  last_submit  timestamptz,
  fetched_at   timestamptz,
  err          text not null default '',
  updated_at   timestamptz not null default now()
);
alter table public.online_student_stats enable row level security;
drop policy if exists online_student_stats_staff on public.online_student_stats;
create policy online_student_stats_staff on public.online_student_stats for select to authenticated using (public.is_staff());
revoke all on public.online_student_stats from anon;
revoke insert, update, delete on public.online_student_stats from authenticated;
grant select on public.online_student_stats to authenticated;

/* ---------- 5. 색인 ---------- */
create index if not exists class_members_student_idx on public.class_members (student_id);

/* ---------- 2. 계산 ---------- */
/* JS 의 +x || 0 — 숫자 · 숫자 글자 · true(1) · 나머지 0 */
create or replace function public._onum(v jsonb)
returns numeric language sql immutable as $$
  select case jsonb_typeof(v)
           when 'number' then (v #>> '{}')::numeric
           when 'string' then case when btrim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' then btrim(v #>> '{}')::numeric else 0 end
           when 'boolean' then case when (v #>> '{}')::boolean then 1 else 0 end
           else 0 end;
$$;
/* JS 의 isFinite(+x) (null 은 없음 · 빈 글자는 0) */
create or replace function public._ofin(v jsonb)
returns numeric language sql immutable as $$
  select case jsonb_typeof(v)
           when 'number' then (v #>> '{}')::numeric
           when 'string' then case when btrim(v #>> '{}') = '' then 0 when btrim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' then btrim(v #>> '{}')::numeric end
           when 'boolean' then case when (v #>> '{}')::boolean then 1 else 0 end
           else null end;
$$;
create or replace function public._odate(v text)
returns date language plpgsql immutable as $$
begin
  if coalesce(v, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return v::date;
exception when others then return null;
end;
$$;
create or replace function public._ots(v text)
returns timestamptz language plpgsql stable as $$
begin
  if coalesce(v, '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then return null; end if;
  return v::timestamptz;
exception when others then return null;
end;
$$;

/* 온라인 반 학생인가 (반 종류 online · 원래 반이거나 반만 더한 반) */
create or replace function public._is_online_student(p_sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s join public.classes c on coalesce(c.kind, '') = 'online'
                  where s.id = p_sid and not s.archived
                    and (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name)));
$$;

/* 학생 한 명 — 이번 달(오늘 KST) 요약을 계산해 저장 */
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
  ok_n int; miss_n int; open_b boolean; hstate text;
  streak int := 0; streak_me int := 0; miss_run int := 0; m_open int := 0; m_done int := 0; m_ok int := 0;
  today_k text := 'none'; today_m text := 'none';
  -- 앱 기준
  lec jsonb; metas jsonb; offs numeric[]; goff numeric; info jsonb; g_ym text; gds text[];
  hit_off numeric; hit_info jsonb; app_status text := 'none'; app_missing jsonb := '[]'::jsonb; app_secs jsonb := '[]'::jsonb;
  open_d date; close_d date; total int; th numeric; bs int; sec_s int[]; sec_e int[]; sn int;
  given jsonb; from_app boolean; gv jsonb; s_on numeric; s_n numeric; s_rate numeric; f_t text; t_t text; s_state text;
  run_no int; run_on numeric; run_n numeric; left_n int; best float8; miss1 float8;
  risk text := ''; risk_sec int; risk_left int; last_sub timestamptz; mis text[];
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
      app_missing = '[]'::jsonb, app_secs = '[]'::jsonb, hub_secs = '[]'::jsonb, golden = null, ex_n = 0, last_submit = null,
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

  /* 1차 — 이번 달 날짜 · 그 날 기록 */
  for i in 1..nd loop
    dd := ym || '-' || lpad(i::text, 2, '0');
    c := cal -> dd;
    ds := ds || dd; hasc := hasc || (c is not null);
    ords := ords || coalesce((c ->> 'o')::numeric, 0); sts := sts || coalesce(c ->> 's', 'none');
    if c is not null then last_cal := dd; end if;
  end loop;
  empty := last_cal = '';

  /* 2차 — 회차 · 종류(직원 ks · 학생 km) */
  for i in 1..nd loop
    dd := ds[i]; ord := ords[i]; st := sts[i];
    wk := extract(isodow from dd::date) in (6, 7);
    cntd := case when hasc[i] then ord > 0 else (not wk and (empty or dd > last_cal) and dd >= tt) end;
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

  /* 연속 · 연속 미제출 · 오늘 · 이번 달 n/n */
  for i in reverse n..1 loop
    exit when n = 0;
    if ds[cd[i]] > tt or ks[cd[i]] = 'today' then continue; end if;
    if ks[cd[i]] in ('ok', 'excused', 'golden') then streak := streak + 1; else exit; end if;
  end loop;
  for i in reverse n..1 loop
    exit when n = 0;
    if ds[cd[i]] > tt or km[cd[i]] = 'today' then continue; end if;
    if km[cd[i]] = 'ok' then streak_me := streak_me + 1; else exit; end if;
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

  /* 앱 기준 구간 (online-run.js groups · appSections · appOf) */
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
          /* 이번 달 날짜의 구간(회차 → 날짜) */
          for i in 1..nd loop
            if ords[i] <> 0 and ords[i] < 100000 and floor(ords[i] / 1000) * 1000 = hit_off and ords[i] - hit_off between sec_s[k] and sec_e[k] then seg[i] := k; end if;
          end loop;
          if s_state = 'run' and run_no is null then run_no := k; run_on := s_on; run_n := s_n; end if;
        end loop;
      end if;
    end if;
  end if;

  /* 구간 위험 — 앱 기준(남은 회차를 다 내야 기준) · 앱 반 정보가 없으면 허브 기준(골든패스를 쓰고 진행 중) */
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

  /* 마지막 제출 — 지금 기록 · 옛 기록의 과제 제출 시각 중 가장 늦은 것 */
  select max(public._ots(h ->> 'submittedAt')) into last_sub from (
    select h from jsonb_array_elements(case when jsonb_typeof(d -> 'history') = 'array' then d -> 'history' when jsonb_typeof(d -> 'recent') = 'array' then d -> 'recent' else '[]'::jsonb end) h
    union all select h from jsonb_array_elements(case when jsonb_typeof(o -> 'history') = 'array' then o -> 'history' else '[]'::jsonb end) h) q
   where jsonb_typeof(h) = 'object';

  insert into public.online_student_stats as x (student_id, ym, calc_day, has_rec, today_kind, today_me, month_done, month_open, month_ok, streak, streak_me, miss_run,
                                                risk, risk_sec, risk_left, app_status, app_missing, app_secs, hub_secs, golden, ex_n, last_submit, fetched_at, err, updated_at)
  values (p_sid, ym, t, true, today_k, today_m, m_done, m_open, m_ok, streak, streak_me, miss_run, risk, risk_sec, risk_left, app_status, app_missing, app_secs, hub,
          golden, (select count(*) from unnest(ks) z where z = 'excused'), last_sub, fat, '', now())
  on conflict (student_id) do update set ym = excluded.ym, calc_day = excluded.calc_day, has_rec = true, today_kind = excluded.today_kind, today_me = excluded.today_me,
    month_done = excluded.month_done, month_open = excluded.month_open, month_ok = excluded.month_ok, streak = excluded.streak, streak_me = excluded.streak_me, miss_run = excluded.miss_run,
    risk = excluded.risk, risk_sec = excluded.risk_sec, risk_left = excluded.risk_left, app_status = excluded.app_status, app_missing = excluded.app_missing,
    app_secs = excluded.app_secs, hub_secs = excluded.hub_secs, golden = excluded.golden, ex_n = excluded.ex_n, last_submit = excluded.last_submit,
    fetched_at = excluded.fetched_at, err = '', updated_at = now();
end;
$$;
revoke all on function public._online_calc(uuid, date) from public, anon, authenticated;

/* 계산이 실패해도 저장(앱 기록 받기 · 사정 인정)은 막지 않는다 — 이유만 남긴다 */
create or replace function public._online_calc_safe(p_sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._online_calc(p_sid);
exception when others then
  begin
    insert into public.online_student_stats (student_id, err, updated_at) values (p_sid, left(sqlerrm, 200), now())
    on conflict (student_id) do update set err = left(sqlerrm, 200), calc_day = null, updated_at = now();
  exception when others then null;
  end;
end;
$$;
revoke all on function public._online_calc_safe(uuid) from public, anon, authenticated;

/* ---------- 3. 다시 계산 ---------- */
create or replace function public._online_stats_rec_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public._is_online_student(new.student_id) then perform public._online_calc_safe(new.student_id); end if;
  return null;
end;
$$;
drop trigger if exists online_stats_rec on public.app_records;
create trigger online_stats_rec after insert or update on public.app_records
  for each row execute function public._online_stats_rec_trg();

create or replace function public._online_stats_ex_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid := case when tg_op = 'DELETE' then old.student_id else new.student_id end;
begin
  if public._is_online_student(sid) then perform public._online_calc_safe(sid); end if;
  return null;
end;
$$;
drop trigger if exists online_stats_ex on public.online_excuse;
create trigger online_stats_ex after insert or update or delete on public.online_excuse
  for each row execute function public._online_stats_ex_trg();

/* 온라인 반 학생 전부 (자정 · 처음 채우기) */
create or replace function public.online_stats_all()
returns integer language plpgsql security definer set search_path = public as $$
declare sid uuid; n int := 0;
begin
  for sid in select s.id from public.students s where not s.archived and public._is_online_student(s.id) loop
    perform public._online_calc_safe(sid); n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.online_stats_all() from public, anon, authenticated;
grant execute on function public.online_stats_all() to service_role;

/* 반 학생(반만 더한 학생 포함) 중 오늘 계산 안 된 학생 — 60명까지 바로 계산 */
create or replace function public._online_stats_fresh(p_class text)
returns integer language plpgsql security definer set search_path = public as $$
declare sid uuid; n int := 0; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  for sid in select s.id from public.students s left join public.online_student_stats x on x.student_id = s.id
              where not s.archived and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class))
                and (x.student_id is null or x.calc_day is distinct from t)
              order by s.id limit 60 loop
    perform public._online_calc_safe(sid); n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._online_stats_fresh(text) from public, anon, authenticated;

/* ---------- 4. 읽기 (직원만) ---------- */
/* 반 카드 한 줄 — 오늘 제출 n/n · 이틀 이상 미제출 · 구간 위험 · 이번 달 구간 완주 · 계산 중 · 기록 늦음 */
create or replace function public.online_stats_sum(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  perform public._online_stats_fresh(p_class);
  select jsonb_build_object('class', p_class, 'n', count(*),
           'today_done', count(*) filter (where x.calc_day = t and x.today_kind in ('ok', 'late', 'golden')),
           'today_open', count(*) filter (where x.calc_day = t and x.today_kind in ('ok', 'late', 'golden', 'today')),
           'miss2', count(*) filter (where x.calc_day = t and x.miss_run >= 2),
           'risk', count(*) filter (where x.calc_day = t and x.risk <> ''),
           'done_sec', count(*) filter (where x.calc_day = t and exists (select 1 from jsonb_array_elements(x.app_secs) e where e ->> 'state' = 'done')),
           'app_ok', count(*) filter (where x.calc_day = t and x.app_status = 'ok'),
           'pending', count(*) filter (where x.student_id is null or x.calc_day is distinct from t),
           'late', count(*) filter (where x.fetched_at is null or x.fetched_at < now() - interval '2 hours'),
           'fetched', min(x.fetched_at), 'at', now())
    into out
    from public.students s left join public.online_student_stats x on x.student_id = s.id
   where not s.archived and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class));
  return out;
end;
$$;
revoke all on function public.online_stats_sum(text) from public, anon;
grant execute on function public.online_stats_sum(text) to authenticated;

create or replace function public._online_stats_rows(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'grade', coalesce(s.grade, ''),
           'linked', l.app_user_id is not null or coalesce(l.app_share_code, '') <> '',
           'stat', case when x.student_id is null then null else jsonb_build_object(
              'ym', x.ym, 'calc_day', x.calc_day, 'has_rec', x.has_rec, 'today', x.today_kind, 'done', x.month_done, 'open', x.month_open,
              'streak', x.streak, 'miss_run', x.miss_run, 'risk', x.risk, 'risk_sec', x.risk_sec, 'risk_left', x.risk_left,
              'app_status', x.app_status, 'app_missing', x.app_missing, 'app', x.app_secs, 'hub', x.hub_secs, 'golden', x.golden, 'ex_n', x.ex_n,
              'last', x.last_submit, 'fetched', x.fetched_at, 'err', x.err) end
         ) order by s.name), '[]'::jsonb)
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.online_student_stats x on x.student_id = s.id
   where s.id = any(p_ids);
$$;
revoke all on function public._online_stats_rows(uuid[]) from public, anon, authenticated;

/* 반 현황표 — 학생마다 한 줄(이름 · 학년 · 요약) · 앱 기록 통째는 안 보냄 */
create or replace function public.online_stats_class(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  perform public._online_stats_fresh(p_class);
  select coalesce(array_agg(s.id), '{}') into ids from public.students s
   where not s.archived and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class));
  return public._online_stats_rows(ids);
end;
$$;
revoke all on function public.online_stats_class(text) from public, anon;
grant execute on function public.online_stats_class(text) to authenticated;

/* [지금 계산] — 그 학생들 줄만 바로 (60명까지) */
create or replace function public.online_stats_calc(p_students uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; ids uuid[];
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  ids := (select coalesce(array_agg(x), '{}') from (select distinct x from unnest(coalesce(p_students, '{}')) x limit 60) q);
  foreach sid in array ids loop
    if public._is_online_student(sid) then perform public._online_calc_safe(sid); end if;
  end loop;
  return public._online_stats_rows(ids);
end;
$$;
revoke all on function public.online_stats_calc(uuid[]) from public, anon;
grant execute on function public.online_stats_calc(uuid[]) to authenticated;

/* 러닝노트 — 본인 링크로 본인 것만 · 앱 기준만(골든패스 · 사정 인정 · 허브 기준 · 기준 % 없음) */
create or replace function public.hub_online_stats(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; x public.online_student_stats; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived or not public._is_online_student(s.id) then return null; end if;
  select * into x from public.online_student_stats where student_id = s.id;
  if not found or x.calc_day is distinct from t then perform public._online_calc_safe(s.id); select * into x from public.online_student_stats where student_id = s.id; end if;
  if not found or x.calc_day is distinct from t or not x.has_rec then return null; end if;
  return jsonb_build_object('ym', x.ym, 'day', x.calc_day, 'today', x.today_me, 'done', x.month_done, 'open', x.month_open, 'ok', x.month_ok, 'streak', x.streak_me,
    'app_status', x.app_status,
    'app', coalesce((select jsonb_agg(jsonb_build_object('no', e -> 'no', 'state', e -> 'state', 'on', e -> 'on', 'n', e -> 'n', 'from', e -> 'from', 'to', e -> 'to'))
                       from jsonb_array_elements(x.app_secs) e), '[]'::jsonb));
end;
$$;
revoke all on function public.hub_online_stats(text) from public;
grant execute on function public.hub_online_stats(text) to anon, authenticated;

/* ---------- 자정(KST) 1회 전체 — pg_cron (00:01 KST = 15:01 UTC) ---------- */
do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'online-stats-night') then perform cron.unschedule('online-stats-night'); end if;
    perform cron.schedule('online-stats-night', '1 15 * * *', 'select public.online_stats_all()');
  end if;
end;
$$;

/* ---------- 6. 처음 한 번 전체 채우기 ---------- */
select public.online_stats_all() as "온라인 학생 요약 채움(명)";

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '학생별 온라인 요약표(online_student_stats) · RLS 켬' as what, (to_regclass('public.online_student_stats') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_student_stats'::regclass))::text as ok
union all select '요약표 — 직원만 읽기 · 로그인 안 한 사람은 못 봄', (exists (select 1 from pg_policies where tablename = 'online_student_stats' and qual like '%is_staff%')
  and not has_table_privilege('anon', 'public.online_student_stats', 'select') and not has_table_privilege('authenticated', 'public.online_student_stats', 'insert'))::text
union all select '앱 기록이 저장되면 그 학생 줄만 다시(트리거)', exists (select 1 from pg_trigger where tgname = 'online_stats_rec' and not tgisinternal)::text
union all select '사정 인정을 바꾸면 그 학생 줄만 다시(트리거)', exists (select 1 from pg_trigger where tgname = 'online_stats_ex' and not tgisinternal)::text
union all select '자정 1회 전체(online-stats-night)', exists (select 1 from cron.job where jobname = 'online-stats-night')::text
union all select '반 카드 · 반 현황표 · 지금 계산 — 직원만', (not has_function_privilege('anon', 'public.online_stats_sum(text)', 'execute')
  and not has_function_privilege('anon', 'public.online_stats_class(text)', 'execute') and not has_function_privilege('anon', 'public.online_stats_calc(uuid[])', 'execute'))::text
union all select '러닝노트 요약(hub_online_stats) — 링크로 본인 것만', (to_regprocedure('public.hub_online_stats(text)') is not null)::text
union all select '색인 class_members(student_id)', (to_regclass('public.class_members_student_idx') is not null)::text
union all select '온라인 학생 전원 요약 있음', (not exists (select 1 from public.students s where not s.archived and public._is_online_student(s.id)
  and not exists (select 1 from public.online_student_stats x where x.student_id = s.id and x.calc_day is not null)))::text
union all select '118이 먼저 있음(classes.kings_on)', exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'kings_on')::text;
