-- ============================================================
--  migration-087-quick-consult.sql — 현장 빠른 상담 기록 (20261108s)
--  (087 은 086 다음 · 여러 번 실행해도 안전 · 함수 배포 없음 — note-remind 는 그대로)
--
--  1. student_notes 에 칸 — 과제 못 한 이유(reason) · 다음 주 약속(promise) · 누른 버튼(picks · 통계용)
--       숫자 약속: goal_n(최소 n개) · goal_all(전부) · goal_lesson(판정할 수업일 = 그 수업 전 주 D-7 ~ D-1)
--       안 낸 날짜(miss_days) · 판정(verdict: kept · partial · missed · verdict_done / verdict_total · verdict_by auto · 이름)
--       분류 「생활」 더함 (과제 · 학습 · 생활 · 기타)
--  2. 설정 「상담」 — 상담 기준(기본 60%) · 이유 버튼 · 약속 버튼 (원장만 바꿈 · 직원 모두 읽음)
--  3. 약속 나중에 덧붙이기 · 직접 약속 「지켰나요?」 · 숫자 약속 판정 저장 — 함수로만 (덮어쓰지 않게)
--  4. 숫자 약속 자동 판정 — 수업 전 예고가 그 학생을 셀 때(pre_remind_log 한 줄 · done / total) 그 수업이 판정일인 약속을
--       「전부」는 그 주 전체 개수 · 「최소 n개」는 n 과 전체 중 작은 값 · 늦게 낸 것은 냄 · 면제는 뺌 (수업 전 예고의 셈 그대로)
--     수업 전 예고를 끈 반은 코치룸이 학생 창 · 학생 줄을 그릴 때 같은 셈으로 저장한다 (consult_judge)
--  5. 운영진 과제 현황 문자 「상담 필요」 줄 끝 「(약속 3개 → 2개 ✕)」 · 직접 약속은 「(약속: 앞 20자…)」
--  이유 · 약속 · 판정 · 상담 내용은 직원만 읽는다 (학생 · 학부모 화면 · 문자 함수는 student_notes 를 읽지 않는다 — 그대로)
-- ============================================================

-- ------------------------------------------------------------
--  1. 칸
-- ------------------------------------------------------------
alter table public.student_notes add column if not exists reason        text not null default '';
alter table public.student_notes add column if not exists promise       text not null default '';
alter table public.student_notes add column if not exists picks         jsonb not null default '{}'::jsonb;
alter table public.student_notes add column if not exists goal_n        smallint;
alter table public.student_notes add column if not exists goal_all      boolean not null default false;
alter table public.student_notes add column if not exists goal_lesson   date;
alter table public.student_notes add column if not exists miss_days     date[] not null default '{}';
alter table public.student_notes add column if not exists verdict       text;
alter table public.student_notes add column if not exists verdict_done  smallint;
alter table public.student_notes add column if not exists verdict_total smallint;
alter table public.student_notes add column if not exists verdict_by    text;
alter table public.student_notes add column if not exists verdict_at    timestamptz;
alter table public.student_notes drop constraint if exists student_notes_reason_len;
alter table public.student_notes add constraint student_notes_reason_len check (char_length(reason) <= 500 and char_length(promise) <= 500);
alter table public.student_notes drop constraint if exists student_notes_verdict_check;
alter table public.student_notes add constraint student_notes_verdict_check check (verdict is null or verdict in ('kept', 'partial', 'missed'));
alter table public.student_notes drop constraint if exists student_notes_cat_check;
alter table public.student_notes add constraint student_notes_cat_check
  check (categories <@ array['상담', '과제 독려', '학습 상담', '학부모 연락', '집중', '정서·컨디션', '출결', '학습', '기타', '과제', '걱정 문자', '퇴원', '재등록', '생활']::text[]);
create index if not exists student_notes_goal_idx on public.student_notes (student_id, goal_lesson) where goal_lesson is not null and deleted_at is null;


-- ------------------------------------------------------------
--  2. 설정 「상담」 — { pct: 60, reasons: [...], promises: [...] }
-- ------------------------------------------------------------
create or replace function public._consult_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pct', coalesce(case when (v ->> 'pct') ~ '^\d{1,3}$' then least(100, greatest(1, (v ->> 'pct')::int)) end, 60),
    'reasons', coalesce(case when jsonb_typeof(v -> 'reasons') = 'array' and jsonb_array_length(v -> 'reasons') > 0 then v -> 'reasons' end, '["바빠서", "깜빡해서", "어려워서"]'::jsonb),
    'promises', coalesce(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' end, '[]'::jsonb))
  from (select coalesce((select value from public.app_settings where key = 'consult'), '{}'::jsonb) v) x;
$$;
revoke all on function public._consult_cfg() from public, anon, authenticated;

create or replace function public.consult_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then public._consult_cfg() || jsonb_build_object('owner', public._real_teacher()) else '{}'::jsonb end;
$$;
revoke all on function public.consult_cfg() from public, anon;
grant execute on function public.consult_cfg() to authenticated;

/* 원장만 — 버튼은 글자 1~20자 · 12개까지 · 같은 글 한 번 */
create or replace function public.consult_cfg_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := coalesce(p, '{}'::jsonb); rs jsonb; ps jsonb; pc int;
begin
  if not public._real_teacher() then raise exception '상담 설정은 원장 계정만 바꿀 수 있습니다.'; end if;
  select coalesce(jsonb_agg(distinct btrim(e)), '[]'::jsonb) into rs from jsonb_array_elements_text(case when jsonb_typeof(v -> 'reasons') = 'array' then v -> 'reasons' else '[]'::jsonb end) e where char_length(btrim(e)) between 1 and 20;
  select coalesce(jsonb_agg(distinct btrim(e)), '[]'::jsonb) into ps from jsonb_array_elements_text(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' else '[]'::jsonb end) e where char_length(btrim(e)) between 1 and 20;
  if jsonb_array_length(rs) = 0 then raise exception '이유 버튼은 하나 이상 있어야 합니다.'; end if;
  if jsonb_array_length(rs) > 12 or jsonb_array_length(ps) > 12 then raise exception '버튼은 12개까지 둘 수 있습니다.'; end if;
  pc := case when (v ->> 'pct') ~ '^\d{1,3}$' then (v ->> 'pct')::int end;
  if pc is null or pc < 1 or pc > 100 then raise exception '상담 기준은 1~100%% 사이로 적어 주세요.'; end if;
  /* 넣은 순서 그대로 (distinct 는 순서를 바꾸므로 원래 순서로 다시) */
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into rs from (select distinct on (btrim(e)) btrim(e) x, o from jsonb_array_elements_text(v -> 'reasons') with ordinality t(e, o) where char_length(btrim(e)) between 1 and 20 order by btrim(e), o) q;
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into ps from (select distinct on (btrim(e)) btrim(e) x, o from jsonb_array_elements_text(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' else '[]'::jsonb end) with ordinality t(e, o) where char_length(btrim(e)) between 1 and 20 order by btrim(e), o) q;
  insert into public.app_settings (key, value, updated_by) values ('consult', jsonb_build_object('pct', pc, 'reasons', rs, 'promises', ps), coalesce(auth.jwt() ->> 'email', ''))
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'cfg', public._consult_cfg());
end;
$$;
revoke all on function public.consult_cfg_save(jsonb) from public, anon;
grant execute on function public.consult_cfg_save(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 약속 덧붙이기 · 직접 약속 판정 · 숫자 약속 판정 저장
-- ------------------------------------------------------------
/* 오늘 남긴 과제 상담에 약속을 나중에 — 약속이 아직 비어 있을 때만 (다른 사람이 먼저 적었으면 false) */
create or replace function public.consult_promise_add(p_note uuid, p_promise text, p_picks jsonb, p_goal_n int, p_goal_all boolean, p_goal_lesson date)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; pr text := btrim(left(coalesce(p_promise, ''), 500));
begin
  if not public.is_staff() or pr = '' then return false; end if;
  update public.student_notes
     set promise = pr, next_check = left(pr, 200),
         picks = coalesce(picks, '{}'::jsonb) || jsonb_build_object('promise', coalesce(p_picks ->> 'promise', 'custom')),
         goal_n = case when p_goal_n between 0 and 30 then p_goal_n end, goal_all = coalesce(p_goal_all, false),
         goal_lesson = case when p_goal_n between 0 and 30 or coalesce(p_goal_all, false) then p_goal_lesson end,
         body = body || E'\n약속: ' || pr
   where id = p_note and deleted_at is null and promise = '';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.consult_promise_add(uuid, text, jsonb, int, boolean, date) from public, anon;
grant execute on function public.consult_promise_add(uuid, text, jsonb, int, boolean, date) to authenticated;

/* 직접 입력한 약속 「지켰나요?」 — 지킴 · 일부 · 못 지킴 (누가 눌렀는지 남김 · 다시 누르면 바뀜) */
create or replace function public.consult_verdict_set(p_note uuid, p_verdict text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() or p_verdict not in ('kept', 'partial', 'missed') then return false; end if;
  update public.student_notes set verdict = p_verdict, verdict_by = public._staff_name(), verdict_at = now()
   where id = p_note and deleted_at is null and promise <> '' and goal_n is null and not goal_all;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.consult_verdict_set(uuid, text) from public, anon;
grant execute on function public.consult_verdict_set(uuid, text) to authenticated;

/* 숫자 약속 판정 — 전부 = 그 주 전체 · 최소 n = least(n, 전체) · 낸 개수가 그 이상이면 지킴 */
create or replace function public._consult_verdict(p_n int, p_all boolean, p_done int, p_total int)
returns text language sql immutable as $$
  select case when coalesce(p_total, 0) <= 0 then null
              when coalesce(p_done, 0) >= case when p_all then p_total else least(coalesce(p_n, 0), p_total) end then 'kept'
              else 'missed' end;
$$;

/* 아직 판정 안 한 숫자 약속 — 판정 수업일이 지났거나 오늘(수업 전 예고 셈과 같은 기간) */
create or replace function public._consult_judge_one(p_student uuid, p_day date, p_done int, p_total int, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(p_total, 0) <= 0 then return 0; end if;
  update public.student_notes
     set verdict = public._consult_verdict(goal_n, goal_all, p_done, p_total),
         verdict_done = least(greatest(p_done, 0), 99), verdict_total = least(p_total, 99), verdict_by = p_by, verdict_at = now()
   where student_id = p_student and goal_lesson = p_day and verdict is null and deleted_at is null and (goal_n is not null or goal_all);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public._consult_judge_one(uuid, date, int, int, text) from public, anon, authenticated;

/* 코치룸 — 수업 전 예고를 끈 반 · 아직 판정 안 된 숫자 약속 (판정 수업일이 오늘이거나 지남) */
create or replace function public.consult_judge(p_note uuid, p_done int, p_total int)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then return false; end if;
  select * into r from public.student_notes where id = p_note and deleted_at is null and verdict is null and (goal_n is not null or goal_all)
     and goal_lesson <= (now() at time zone 'Asia/Seoul')::date;
  if not found then return false; end if;
  return public._consult_judge_one(r.student_id, r.goal_lesson, p_done, p_total, 'auto') > 0;
end;
$$;
revoke all on function public.consult_judge(uuid, int, int) from public, anon;
grant execute on function public.consult_judge(uuid, int, int) to authenticated;


-- ------------------------------------------------------------
--  4. 자동 판정 — 수업 전 예고가 학생을 셀 때 (pre_remind_log 한 줄 · 보내지 않은 off · none 도 센다)
-- ------------------------------------------------------------
create or replace function public._consult_pre_judge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._consult_judge_one(new.student_id, new.day, coalesce(new.done, 0), coalesce(new.total, 0), 'auto');
  return new;
exception when others then return new;     -- 판정이 실패해도 수업 전 예고는 그대로
end;
$$;
drop trigger if exists consult_pre_judge on public.pre_remind_log;
create trigger consult_pre_judge after insert on public.pre_remind_log for each row execute function public._consult_pre_judge();


-- ------------------------------------------------------------
--  5. 운영진 과제 현황 문자 — 「상담 필요」 줄 끝에 지난 약속 (081 의 _hws_texts 에 한 조각)
--     그 수업일 전에 남긴 가장 최근 약속 · 숫자 약속은 저장된 판정(없으면 오늘 셈) · 직접 약속은 앞 20자
-- ------------------------------------------------------------
create or replace function public._consult_tag(p_student uuid, p_day date, p_done int, p_total int)
returns text language plpgsql stable security definer set search_path = public as $$
declare n record; tot int; dn int; tg int; vd text;
begin
  select * into n from public.student_notes x
   where x.student_id = p_student and x.deleted_at is null and x.promise <> '' and x.note_date < p_day
   order by x.note_date desc, x.created_at desc limit 1;
  if not found then return ''; end if;
  if n.goal_n is null and not n.goal_all then
    return ' (약속: ' || left(n.promise, 20) || case when char_length(n.promise) > 20 then '…' else '' end || ')';
  end if;
  /* 저장된 판정 · 없으면 오늘이 판정일일 때 이 문자의 셈 */
  tot := coalesce(n.verdict_total, case when n.goal_lesson = p_day and p_total > 0 then p_total end);
  dn  := coalesce(n.verdict_done, case when n.goal_lesson = p_day and p_total > 0 then p_done end);
  vd  := coalesce(n.verdict, case when n.goal_lesson = p_day then public._consult_verdict(n.goal_n, n.goal_all, p_done, p_total) end);
  tg  := case when n.goal_all then tot else least(n.goal_n, coalesce(tot, n.goal_n)) end;
  return ' (약속 ' || coalesce(tg::text || '개', '전부') ||
         case when dn is not null and vd is not null then ' → ' || dn || '개 ' || case vd when 'kept' then '✓' else '✕' end else '' end || ')';
end;
$$;
revoke all on function public._consult_tag(uuid, date, int, int) from public, anon, authenticated;

create or replace function public._hws_texts(p_class text, p_day date, p_start text, p_items jsonb, p_cut integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  cut int := greatest(1, least(100, coalesce(p_cut, 60)));
  head text := '[과제 현황] ' || p_class || ' · 오늘 ' || coalesce(p_start, '') || ' 수업';
  per text := '이번 주 ' || to_char(p_day - 7, 'FMMM/FMDD') || '~' || to_char(p_day - 1, 'FMMM/FMDD') ||
              ' · 지난주 ' || to_char(p_day - 14, 'FMMM/FMDD') || '~' || to_char(p_day - 8, 'FMMM/FMDD');
  two text;
  pf jsonb := public._hws_perfect(p_day, p_items);
  lines text[] := '{}'; body text[] := '{}'; top text[];
  nrank int := 0; nlow int := 0; none_ text; unk text; tail text;
  r record;
  limitb int := 2000;
  parts text[] := '{}'; cur text; ln text; k int; n int;
begin
  for r in
    with x as (
      select s.id, s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known,
             coalesce((i ->> 'pdone')::int, 0) pdn, coalesce((i ->> 'ptotal')::int, 0) ptt
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.id, x.name, x.dn, x.tt, (x.dn * 100 / x.tt) pct, case when x.ptt > 0 then x.pdn * 100 / x.ptt end ppct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name ||
                     case when r.ppct is null then ' (지난주 없음)'
                          else ' (지난주 ' || r.ppct || '%' ||
                               case when r.pct > r.ppct then ' ↑' when r.ppct - r.pct >= 20 then ' ↓↓' when r.pct < r.ppct then ' ↓' else '' end || ')' end ||
                     case when r.pct < cut then ' → 상담 필요' || public._consult_tag(r.id, p_day, r.dn, r.tt) else '' end);
    if r.pct < cut and r.ppct is not null and r.ppct < cut then two := concat_ws(', ', two, r.name); end if;
  end loop;
  select string_agg(s.name, ', ' order by s.name collate "C") into none_
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) <= 0;
  select string_agg(s.name, ', ' order by s.name collate "C") into unk
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where not coalesce((i ->> 'known')::boolean, true);
  if none_ is not null then body := body || ('과제 없음 · ' || none_); end if;
  if unk is not null then body := body || ('앱 기록 없음 · ' || unk); end if;
  tail := case when nrank = 0 then '완료율을 낼 학생이 없어요.'
               when nlow > 0 then cut || '% 미만 ' || nlow || '명은 반드시 상담해 주세요.'
               else '모두 ' || cut || '% 이상이에요.' end;
  top := array['⭐ 이번 주 퍼펙트 ' || coalesce((pf ->> 'n')::int, 0) || '명'];
  if coalesce(pf ->> 'line', '') <> '' then top := top || (pf ->> 'line'); end if;
  lines := array[head, per] || top || array['완료율 높은 순 · ' || nrank || '명'] || body || array[tail];
  if two is not null then lines := lines || ('2주 연속 ' || cut || '% 미만: ' || two); end if;

  if public._sms_bytes(array_to_string(lines, E'\n')) <= limitb then
    return jsonb_build_object('texts', jsonb_build_array(array_to_string(lines, E'\n')), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
  end if;
  cur := head || ' (#/#)';
  for k in 2 .. coalesce(array_length(lines, 1), 0) loop
    ln := lines[k];
    if public._sms_bytes(cur || E'\n' || ln) > limitb - 4 then
      parts := parts || cur;
      cur := '[과제 현황] ' || p_class || ' (#/#)' || E'\n' || ln;
    else
      cur := cur || E'\n' || ln;
    end if;
  end loop;
  parts := parts || cur;
  n := array_length(parts, 1);
  for k in 1 .. n loop
    parts[k] := replace(parts[k], '(#/#)', '(' || k || '/' || n || ')');
  end loop;
  return jsonb_build_object('texts', to_jsonb(parts), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
end;
$$;
revoke all on function public._hws_texts(text, date, text, jsonb, integer) from public, anon, authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '이유 · 약속 칸' as what, exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'promise')::text as ok
union all select '분류 생활', (position('생활' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notes_cat_check')) > 0)::text
union all select '상담 기준 ' || (public._consult_cfg() ->> 'pct') || '% · 이유 버튼 ' || jsonb_array_length(public._consult_cfg() -> 'reasons') || '개', 'true'
union all select '수업 전 예고 때 약속 판정', exists (select 1 from pg_trigger where tgname = 'consult_pre_judge')::text
union all select '운영진 문자 약속 표시', (position('_consult_tag' in pg_get_functiondef('public._hws_texts(text, date, text, jsonb, integer)'::regprocedure)) > 0)::text
union all select '직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text;
