-- ============================================================
--  migration-120-online-best.sql — 20261118b · 119 다음 · 여러 번 실행해도 됨 · 그다음 함수 app-sync 다시 배포(우수 수행 피드백 · DAY)
--  온라인 학생 화면 판정 · 반 현황표 보강 · 「우수 수행」 탭
--
--  1. 학생 화면 판정 — 코치룸 미리보기가 반 종류를 못 받아 늘 현강으로 보이던 문제
--     _class_mode(학생) 하나로 hub_class_mode(링크) · staff_hub_class_mode(학생 · 미리보기)가 같은 답
--     현강 · 온라인 둘 다면 hyun_last(마지막 공개 레포트 주) · online_last(마지막 앱 제출일)도 → 화면이 [현강] [온라인] 고르기(기본 최근 활동 쪽)
--     staff_hub_online_stats(학생) — 미리보기도 러닝노트와 같은 요약
--  2. 반 현황표 — online_student_stats.month_cal(이번 달 앱 기록 날 수) · today_cal(오늘 날짜 기록이 왔나) → 「기록 없음」 · 「오늘 기록 받는 중」
--  3. 우수 수행 — online_marks(직원이 숨김 · 고름 · 직원만) · online_mark_set
--     hub_best(링크) · staff_hub_best(미리보기) · staff_best(코치룸 관리 · 숨긴 것도)
--       우수 오답정리 · 우수 지문 장악 = 앱이 준 제출마다 점수(app_records.subs wa · tc) 높은 것 3개 · 날짜 · 제목 · 점수 · 사진(sub_files · 숨긴 사진 빼고) · 선생님 피드백(사람이 쓴 것만)
--       우수 질문 = 앱이 학생 메시지 · 댓글을 아직 안 보냄 → ready false(「앱 연결 준비 중」) · 고른 질문(kind q · pick)만 보이게 자리만
--     hub_sub_list(러닝노트 풀이 흔적) — 직원이 숨긴 사진은 빼고(100 그대로 + 숨김)
--  다른 학생 점수 · 순위 · 비교 없음 · 전화번호 없음 · 문자 · 알림톡 없음
-- ============================================================

/* ---------- 2. 요약표 칸 ---------- */
alter table public.online_student_stats add column if not exists month_cal integer not null default 0;
alter table public.online_student_stats add column if not exists today_cal boolean not null default false;

/* 계산(119) 뒤 — 이번 달 앱 기록 날 수 · 오늘 날짜 기록 */
create or replace function public._online_cal_mark(p_sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.online_student_stats x
     set month_cal = coalesce((select count(distinct v ->> 'date') from jsonb_array_elements(case when jsonb_typeof(r.data -> 'calendar') = 'array' then r.data -> 'calendar' else '[]'::jsonb end) v
                                where jsonb_typeof(v) = 'object' and left(coalesce(v ->> 'date', ''), 7) = x.ym), 0),
         today_cal = exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.data -> 'calendar') = 'array' then r.data -> 'calendar' else '[]'::jsonb end) v
                              where jsonb_typeof(v) = 'object' and v ->> 'date' = to_char(x.calc_day, 'YYYY-MM-DD'))
    from public.app_records r
   where x.student_id = p_sid and r.student_id = p_sid;
  update public.online_student_stats set month_cal = 0, today_cal = false where student_id = p_sid and not has_rec;
end;
$$;
revoke all on function public._online_cal_mark(uuid) from public, anon, authenticated;

create or replace function public._online_calc_safe(p_sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._online_calc(p_sid);
  perform public._online_cal_mark(p_sid);
exception when others then
  begin
    insert into public.online_student_stats (student_id, err, updated_at) values (p_sid, left(sqlerrm, 200), now())
    on conflict (student_id) do update set err = left(sqlerrm, 200), calc_day = null, updated_at = now();
  exception when others then null;
  end;
end;
$$;
revoke all on function public._online_calc_safe(uuid) from public, anon, authenticated;

create or replace function public._online_stats_rows(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'grade', coalesce(s.grade, ''),
           'linked', l.app_user_id is not null or coalesce(l.app_share_code, '') <> '',
           'stat', case when x.student_id is null then null else jsonb_build_object(
              'ym', x.ym, 'calc_day', x.calc_day, 'has_rec', x.has_rec, 'today', x.today_kind, 'done', x.month_done, 'open', x.month_open,
              'streak', x.streak, 'miss_run', x.miss_run, 'risk', x.risk, 'risk_sec', x.risk_sec, 'risk_left', x.risk_left,
              'app_status', x.app_status, 'app_missing', x.app_missing, 'app', x.app_secs, 'hub', x.hub_secs, 'golden', x.golden, 'ex_n', x.ex_n,
              'last', x.last_submit, 'fetched', x.fetched_at, 'err', x.err, 'month_cal', x.month_cal, 'today_cal', x.today_cal) end
         ) order by s.name), '[]'::jsonb)
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.online_student_stats x on x.student_id = s.id
   where s.id = any(p_ids);
$$;
revoke all on function public._online_stats_rows(uuid[]) from public, anon, authenticated;

/* ---------- 1. 학생 화면 판정 ---------- */
create or replace function public._class_mode(p_sid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.students; list jsonb; hl date; ol date;
begin
  select * into s from public.students where id = p_sid;
  if not found or s.archived then return jsonb_build_object('ok', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'kind', case when coalesce(c.kind, '') = 'online' then 'online' else 'class' end, 'line', public._class_line(c))
                            order by (coalesce(c.kind, '') = 'online'), c.name), '[]'::jsonb)
    into list
    from public.classes c
   where not coalesce(c.archived, false)
     and (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name));
  select max(p.week_start) into hl from public.published p where p.student_id = p_sid and p.visible;
  select (x.last_submit at time zone 'Asia/Seoul')::date into ol from public.online_student_stats x where x.student_id = p_sid;
  return jsonb_build_object('ok', true, 'classes', list,
    'online', jsonb_array_length(list) > 0 and not exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' <> 'online'),
    'both', exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'online') and exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' <> 'online'),
    'hyun_last', hl, 'online_last', ol);
end;
$$;
revoke all on function public._class_mode(uuid) from public, anon, authenticated;

create or replace function public.hub_class_mode(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false); end if;
  return public._class_mode(s.id);
end;
$$;
revoke all on function public.hub_class_mode(text) from public;
grant execute on function public.hub_class_mode(text) to anon, authenticated;

create or replace function public.staff_hub_class_mode(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return public._class_mode(p_student);
end;
$$;
revoke all on function public.staff_hub_class_mode(uuid) from public, anon;
grant execute on function public.staff_hub_class_mode(uuid) to authenticated;

/* 러닝노트 요약(119 hub_online_stats 와 같은 모양) — 학생 id 로 */
create or replace function public._online_me(p_sid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.online_student_stats; t date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public._is_online_student(p_sid) then return null; end if;
  select * into x from public.online_student_stats where student_id = p_sid;
  if not found or x.calc_day is distinct from t then perform public._online_calc_safe(p_sid); select * into x from public.online_student_stats where student_id = p_sid; end if;
  if not found or x.calc_day is distinct from t or not x.has_rec then return null; end if;
  return jsonb_build_object('ym', x.ym, 'day', x.calc_day, 'today', x.today_me, 'done', x.month_done, 'open', x.month_open, 'ok', x.month_ok, 'streak', x.streak_me,
    'app_status', x.app_status,
    'app', coalesce((select jsonb_agg(jsonb_build_object('no', e -> 'no', 'state', e -> 'state', 'on', e -> 'on', 'n', e -> 'n', 'from', e -> 'from', 'to', e -> 'to'))
                       from jsonb_array_elements(x.app_secs) e), '[]'::jsonb));
end;
$$;
revoke all on function public._online_me(uuid) from public, anon, authenticated;

create or replace function public.hub_online_stats(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  return public._online_me(s.id);
end;
$$;
revoke all on function public.hub_online_stats(text) from public;
grant execute on function public.hub_online_stats(text) to anon, authenticated;

create or replace function public.staff_hub_online_stats(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return public._online_me(p_student);
end;
$$;
revoke all on function public.staff_hub_online_stats(uuid) from public, anon;
grant execute on function public.staff_hub_online_stats(uuid) to authenticated;

/* ---------- 3. 우수 수행 ---------- */
create table if not exists public.online_marks (
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null,                 -- item(제출 하나) · photo(사진 하나 · sub_files.id) · q(질문)
  ref        text not null,
  state      text not null,                 -- hide(학생 · 학부모 화면에서 뺌) · pick(우수 질문으로 고름)
  by_email   text not null default '',
  at         timestamptz not null default now(),
  primary key (student_id, kind, ref),
  constraint online_marks_kind check (kind in ('item', 'photo', 'q')),
  constraint online_marks_state check (state in ('hide', 'pick'))
);
alter table public.online_marks enable row level security;
drop policy if exists online_marks_staff on public.online_marks;
create policy online_marks_staff on public.online_marks for select to authenticated using (public.is_staff());
revoke all on public.online_marks from anon;
revoke insert, update, delete on public.online_marks from authenticated;
grant select on public.online_marks to authenticated;

create or replace function public.online_mark_set(p_student uuid, p_kind text, p_ref text, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_kind not in ('item', 'photo', 'q') or coalesce(p_ref, '') = '' or length(p_ref) > 120 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  if coalesce(p_state, '') = '' then
    delete from public.online_marks where student_id = p_student and kind = p_kind and ref = p_ref;
  elsif p_state in ('hide', 'pick') then
    insert into public.online_marks (student_id, kind, ref, state, by_email, at)
    values (p_student, p_kind, p_ref, p_state, lower(coalesce(auth.jwt() ->> 'email', '')), now())
    on conflict (student_id, kind, ref) do update set state = excluded.state, by_email = excluded.by_email, at = now();
  else return jsonb_build_object('ok', false, 'reason', 'input');
  end if;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'ref', p_ref, 'state', coalesce(p_state, ''));
end;
$$;
revoke all on function public.online_mark_set(uuid, text, text, text) from public, anon;
grant execute on function public.online_mark_set(uuid, text, text, text) to authenticated;

/* 제출 하나의 열쇠 — 제출 시각(초까지) # 강 번호 */
create or replace function public._sub_key(s jsonb)
returns text language sql immutable as $$
  select left(coalesce(s ->> 'submittedAt', ''), 19) || '#' || coalesce(s ->> 'order', '');
$$;

/* 우수 수행 — p_staff 면 숨긴 것도(hidden 표시) · 아니면 숨긴 것 · 숨긴 사진 빼고 */
create or replace function public._best_of(p_sid uuid, p_staff boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare subs jsonb; fbs jsonb; out jsonb := '{}'::jsonb; k text; col text;
begin
  select case when jsonb_typeof(r.subs) = 'array' then r.subs else '[]'::jsonb end,
         case when jsonb_typeof(r.data -> 'fb') = 'array' then r.data -> 'fb' else '[]'::jsonb end
    into subs, fbs from public.app_records r where r.student_id = p_sid;
  subs := coalesce(subs, '[]'::jsonb); fbs := coalesce(fbs, '[]'::jsonb);
  foreach k in array array['wrong', 'text'] loop
    col := case k when 'wrong' then 'wa' else 'tc' end;
    out := out || jsonb_build_object(k, coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', z.key, 'day', z.day, 'title', z.title, 's', z.score,
               'fb', coalesce(nullif(left(btrim(coalesce(z.s ->> 'fb', '')), 200), ''),
                              (select left(f ->> 't', 200) from jsonb_array_elements(fbs) f where f ->> 'title' = left(z.title, 60) and f ->> 'at' = z.day::text limit 1)),
               'hidden', z.hidden,
               'photos', coalesce((select jsonb_agg(jsonb_build_object('id', sf.id, 'kind', sf.kind, 'status', sf.status,
                                                                      'hidden', exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'photo' and m.ref = sf.id::text and m.state = 'hide'))
                                                   order by sf.id)
                                     from public.sub_files sf
                                    where sf.student_id = p_sid
                                      and sf.src in (select f ->> 'url' from jsonb_array_elements(case when jsonb_typeof(z.s -> 'files') = 'array' then z.s -> 'files' else '[]'::jsonb end) f)
                                      and (p_staff or not exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'photo' and m.ref = sf.id::text and m.state = 'hide'))),
                                  '[]'::jsonb))
             order by z.score desc, z.at desc)
        from (select s, public._sub_key(s) as key, left(coalesce(s ->> 'title', ''), 200) as title, (s ->> col)::int as score,
                     public._ots(s ->> 'submittedAt') as at, (public._ots(s ->> 'submittedAt') at time zone 'Asia/Seoul')::date as day,
                     exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'item' and m.ref = public._sub_key(s) and m.state = 'hide') as hidden
                from jsonb_array_elements(subs) s
               where jsonb_typeof(s) = 'object' and jsonb_typeof(s -> col) = 'number' and (s ->> col)::numeric > 0 and public._ots(s ->> 'submittedAt') is not null
               order by (s ->> col)::numeric desc, s ->> 'submittedAt' desc) z
       where p_staff or not z.hidden
       limit case when p_staff then 6 else 3 end), '[]'::jsonb));
  end loop;
  /* 고친 순서(jsonb_agg 안 limit 은 안 먹음) — 점수 높은 것부터 학생 3개 · 직원 6개 */
  out := jsonb_build_object(
    'wrong', coalesce((select jsonb_agg(e order by (e ->> 's')::int desc, e ->> 'day' desc) from (select e from jsonb_array_elements(out -> 'wrong') e order by (e ->> 's')::int desc, e ->> 'day' desc limit case when p_staff then 6 else 3 end) q), '[]'::jsonb),
    'text', coalesce((select jsonb_agg(e order by (e ->> 's')::int desc, e ->> 'day' desc) from (select e from jsonb_array_elements(out -> 'text') e order by (e ->> 's')::int desc, e ->> 'day' desc limit case when p_staff then 6 else 3 end) q), '[]'::jsonb),
    /* 우수 질문 — 앱이 학생 메시지 · 댓글을 아직 안 보냄(Replit 요청) · 고른 질문이 생기면 여기에 */
    'q', jsonb_build_object('ready', false, 'picked', '[]'::jsonb),
    'scores', jsonb_array_length(subs) > 0 and exists (select 1 from jsonb_array_elements(subs) s where jsonb_typeof(s -> 'wa') = 'number' or jsonb_typeof(s -> 'tc') = 'number'));
  return out;
end;
$$;
revoke all on function public._best_of(uuid, boolean) from public, anon, authenticated;

create or replace function public.hub_best(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  return public._best_of(s.id, false);
end;
$$;
revoke all on function public.hub_best(text) from public;
grant execute on function public.hub_best(text) to anon, authenticated;

create or replace function public.staff_hub_best(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return public._best_of(p_student, false);
end;
$$;
revoke all on function public.staff_hub_best(uuid) from public, anon;
grant execute on function public.staff_hub_best(uuid) to authenticated;

create or replace function public.staff_best(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return public._best_of(p_student, true);
end;
$$;
revoke all on function public.staff_best(uuid) from public, anon;
grant execute on function public.staff_best(uuid) to authenticated;

/* 러닝노트 풀이 흔적(100) — 직원이 숨긴 사진은 빼고 */
create or replace function public.hub_sub_list(p_code text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; rows jsonb;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  rows := coalesce((select jsonb_agg(public._sub_row(f, false) order by f.sub_at, f.id) from public.sub_files f
                     where f.student_id = s.id and f.sub_day between p_from and least(p_to, p_from + 31)
                       and not exists (select 1 from public.online_marks m where m.student_id = s.id and m.kind = 'photo' and m.ref = f.id::text and m.state = 'hide')), '[]'::jsonb);
  return jsonb_build_object('files', rows, 'rep', coalesce((
    select jsonb_agg(x.id) from (select f.id from public.sub_files f
      where f.student_id = s.id and f.sub_day between p_from and least(p_to, p_from + 31) and (f.status = 'ok' or f.kind = 'pdf')
        and not exists (select 1 from public.online_marks m where m.student_id = s.id and m.kind = 'photo' and m.ref = f.id::text and m.state = 'hide')
      order by f.care desc nulls last, f.sub_at desc limit 2) x), '[]'::jsonb));
end;
$$;
revoke all on function public.hub_sub_list(text, date, date) from public;
grant execute on function public.hub_sub_list(text, date, date) to anon, authenticated, service_role;

/* 칸 채우기 — 이미 계산된 온라인 학생(이번 달 앱 기록 날 수 · 오늘 기록) */
do $$
declare sid uuid;
begin
  for sid in select student_id from public.online_student_stats loop perform public._online_cal_mark(sid); end loop;
end;
$$;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '119가 먼저 있음(online_student_stats)' as what, (to_regclass('public.online_student_stats') is not null)::text as ok
union all select '반 현황표 칸(month_cal · today_cal)', (exists (select 1 from information_schema.columns where table_name = 'online_student_stats' and column_name = 'month_cal')
  and exists (select 1 from information_schema.columns where table_name = 'online_student_stats' and column_name = 'today_cal'))::text
union all select '학생 화면 판정 — 링크 · 미리보기가 같은 답(_class_mode)', (position('_class_mode' in pg_get_functiondef('public.hub_class_mode(text)'::regprocedure)) > 0
  and to_regprocedure('public.staff_hub_class_mode(uuid)') is not null)::text
union all select '미리보기 — 반 종류 · 요약 · 우수 수행 직원만', (not has_function_privilege('anon', 'public.staff_hub_class_mode(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.staff_hub_online_stats(uuid)', 'execute') and not has_function_privilege('anon', 'public.staff_hub_best(uuid)', 'execute'))::text
union all select '숨김 · 고름 표(online_marks) — RLS · 직원만', (to_regclass('public.online_marks') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_marks'::regclass) and not has_table_privilege('anon', 'public.online_marks', 'select')
  and not has_table_privilege('authenticated', 'public.online_marks', 'insert') and not has_function_privilege('anon', 'public.online_mark_set(uuid, text, text, text)', 'execute'))::text
union all select '우수 수행 — 러닝노트(hub_best) · 코치룸(staff_best)', (to_regprocedure('public.hub_best(text)') is not null and to_regprocedure('public.staff_best(uuid)') is not null)::text
union all select '풀이 흔적 — 숨긴 사진 빼기(hub_sub_list)', (position('online_marks' in pg_get_functiondef('public.hub_sub_list(text,date,date)'::regprocedure)) > 0)::text;
