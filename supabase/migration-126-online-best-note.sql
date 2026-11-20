-- ============================================================
--  migration-126-online-best-note.sql — 20261120d · 125 다음(120 이 먼저 있어야 함) · 여러 번 실행해도 됨
--  러닝노트 온라인 「🏅 우수 수행」 — 카드 날짜 · 사진(앱 비공개 저장소 · 서명 주소) · 선정 이유
--
--  1. 카드 날짜 = 지문 날짜(앱 반 달력에서 그 강 번호가 걸린 날) · 제출일이 다르면 sday(작게 「11/20 제출」)
--     (예전: 제출 시각으로 날짜를 정해 밤 12시 넘어 낸 11/19 지문이 11/20 카드로 나왔다)
--  2. 사진 — 제출마다 파일 순서(i)로 · 앱 GET /api/hub/submission-file?submissionId=…&index=… 를 함수 online-best 가 서버에서만 부른다
--     _best_file(학생, 제출 열쇠, 순서, 직원?) → 그 학생 제출 · 숨기지 않은 사진인지 확인하고 앱 제출 id 만 돌려줌(service_role · 직원 함수만 · 화면에는 안 나감)
--     예전 미리보기(sub_files) 열쇠 · 숨김(online_marks photo)은 그대로 쓰고, 미리보기가 없는 사진은 「제출 열쇠@순서」로 숨김
--  3. 선정 이유 — online_best_notes(학생 · 종류 · 제출 열쇠 · AI 초안 · 확인한 글 · 상태 · 오류)
--     1순위 사람 피드백(작성자 이름이 있는 teacherFeedback · 「선생님 한마디」) · 없거나 한 줄 이하(40자 · 줄바꿈 없음)면 need = true → AI 초안
--     AI 초안은 함수 online-best 가 카드 하나에 한 번만 저장(best_note_ai_save · service_role) · 직원이 고치고 [확인](best_note_set)해야 학생 · 학부모에게
--     확인 전에는 학생 · 학부모 화면 「선정 이유 준비 중」 · 다시 쓴 초안은 다시 [확인] 전까지 예전 확인한 글 그대로
--  학생 · 학부모 응답에는 앱 제출 id · 초안 · 오류 · 다른 학생 정보 없음 · 순위 · 비교 · 상담 · 금액 · 전화번호 없음
-- ============================================================

/* ---------- 3. 선정 이유 표 ---------- */
create table if not exists public.online_best_notes (
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null,                       -- wrong(오답정리) · text(지문 장악)
  key        text not null,                       -- 제출 열쇠(_sub_key · 제출 시각 # 강 번호)
  draft      text not null default '',            -- AI 초안(또는 직원이 고치는 중인 글)
  final      text not null default '',            -- 직원이 [확인]한 글 — 학생 · 학부모에게는 이것만
  state      text not null default 'none',        -- none · draft(확인 전) · ok(확인함)
  photo      boolean not null default false,      -- 초안이 사진을 보고 썼나(사진 연결 뒤 [다시 쓰기])
  err        text not null default '',            -- credit(AI 크레딧 부족) · ai · nokey · input — 직원만
  tries      integer not null default 0,
  by_email   text not null default '',
  ai_at      timestamptz,
  ok_at      timestamptz,
  at         timestamptz not null default now(),
  primary key (student_id, kind, key),
  constraint online_best_notes_kind check (kind in ('wrong', 'text')),
  constraint online_best_notes_state check (state in ('none', 'draft', 'ok'))
);
alter table public.online_best_notes enable row level security;
drop policy if exists online_best_notes_staff on public.online_best_notes;
create policy online_best_notes_staff on public.online_best_notes for select to authenticated using (public.is_staff());
revoke all on public.online_best_notes from anon;
revoke insert, update, delete on public.online_best_notes from authenticated;
grant select on public.online_best_notes to authenticated;

/* 사람 피드백이 「한 줄 이하」인가 — 없거나 40자 이하 · 줄바꿈 없음 → AI 선정 이유 필요 */
create or replace function public._best_need(p_fb text)
returns boolean language sql immutable as $$
  select coalesce(btrim(p_fb), '') = '' or (char_length(btrim(p_fb)) <= 40 and position(E'\n' in btrim(p_fb)) = 0);
$$;

/* 제출 하나 → 카드 한 장 */
create or replace function public._best_item(p_sid uuid, p_staff boolean, p_kind text, s jsonb, p_key text, p_score int, p_sday date, p_day date, p_hidden boolean, fbs jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare fb text; files jsonb; photos jsonb; n public.online_best_notes; out jsonb;
begin
  fb := coalesce(nullif(left(btrim(coalesce(s ->> 'fb', '')), 200), ''),
                 (select left(f ->> 't', 200) from jsonb_array_elements(coalesce(fbs, '[]'::jsonb)) f where f ->> 'title' = left(coalesce(s ->> 'title', ''), 60) and f ->> 'at' = p_sday::text limit 1));
  files := case when jsonb_typeof(s -> 'files') = 'array' then s -> 'files' else '[]'::jsonb end;
  select coalesce(jsonb_agg(q.p order by (q.p ->> 'i')::int), '[]'::jsonb) into photos from (
    select jsonb_build_object('i', w.i, 'kind', w.kind, 'id', w.sfid, 'status', w.st, 'ref', w.ref,
             'hidden', exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'photo' and m.ref = w.ref and m.state = 'hide')) as p
      from (select case when coalesce(f ->> 'i', '') ~ '^\d{1,3}$' then (f ->> 'i')::int else (o - 1)::int end as i,
                   case when lower(coalesce(f ->> 'type', '')) = 'application/pdf' or coalesce(f ->> 'url', '') ~* '\.pdf(\?|$)' then 'pdf' else 'image' end as kind,
                   sf.id as sfid, sf.status as st,
                   coalesce(sf.id::text, p_key || '@' || case when coalesce(f ->> 'i', '') ~ '^\d{1,3}$' then f ->> 'i' else (o - 1)::text end) as ref
              from jsonb_array_elements(files) with ordinality as t(f, o)
              left join public.sub_files sf on sf.student_id = p_sid and coalesce(f ->> 'url', '') <> '' and sf.src = left(f ->> 'url', 400)
             where jsonb_typeof(f) = 'object') w) q
   where p_staff or not (q.p ->> 'hidden')::boolean;
  select * into n from public.online_best_notes x where x.student_id = p_sid and x.kind = p_kind and x.key = p_key;
  out := jsonb_build_object('key', p_key, 'day', p_day, 'sday', p_sday, 'title', left(coalesce(s ->> 'title', ''), 200), 's', p_score,
           'fb', fb, 'need', public._best_need(fb), 'hidden', p_hidden,
           'app', coalesce(s ->> 'sub', '') ~ '^\d+$',                    /* 앱 사진 열람 가능(제출 id 있음) — id 자체는 보내지 않음 */
           'photos', photos,
           'reason', case when n.state = 'ok' and btrim(n.final) <> '' then n.final end);
  if p_staff then
    out := out || jsonb_build_object('k', s -> 'k', 'n', s -> 'n', 'note', case when n.student_id is null then null else
             jsonb_build_object('draft', n.draft, 'final', n.final, 'state', n.state, 'photo', n.photo, 'err', n.err, 'tries', n.tries, 'ai_at', n.ai_at, 'ok_at', n.ok_at) end);
  end if;
  return out;
end;
$$;
revoke all on function public._best_item(uuid, boolean, text, jsonb, text, int, date, date, boolean, jsonb) from public, anon, authenticated;

/* 우수 수행 (120 _best_of 를 다시) — 카드 날짜 = 지문 날짜(반 달력) · 사진 순서 · 선정 이유 · p_staff 면 숨긴 것도 · 초안 · 오류 */
create or replace function public._best_of(p_sid uuid, p_staff boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare subs jsonb; fbs jsonb; cal jsonb; out jsonb := '{}'::jsonb; k text; col text; lim int := case when p_staff then 6 else 3 end;
begin
  select case when jsonb_typeof(r.subs) = 'array' then r.subs else '[]'::jsonb end,
         case when jsonb_typeof(r.data -> 'fb') = 'array' then r.data -> 'fb' else '[]'::jsonb end,
         (case when jsonb_typeof(r.data -> 'calendar') = 'array' then r.data -> 'calendar' else '[]'::jsonb end)
           || (case when jsonb_typeof(r.old) = 'object' and jsonb_typeof(r.old -> 'calendar') = 'array' then r.old -> 'calendar' else '[]'::jsonb end)
    into subs, fbs, cal from public.app_records r where r.student_id = p_sid;
  subs := coalesce(subs, '[]'::jsonb); fbs := coalesce(fbs, '[]'::jsonb); cal := coalesce(cal, '[]'::jsonb);
  foreach k in array array['wrong', 'text'] loop
    col := case k when 'wrong' then 'wa' else 'tc' end;
    out := out || jsonb_build_object(k, coalesce((
      select jsonb_agg(public._best_item(p_sid, p_staff, k, z.s, z.key, z.score, z.sday, coalesce(z.cday, z.sday), z.hidden, fbs) order by z.score desc, z.at desc)
        from (select y.* from (
                select s, public._sub_key(s) as key, round((s ->> col)::numeric)::int as score, public._ots(s ->> 'submittedAt') as at,
                       (public._ots(s ->> 'submittedAt') at time zone 'Asia/Seoul')::date as sday,
                       (select min(left(v ->> 'date', 10))::date from jsonb_array_elements(cal) v
                         where jsonb_typeof(v) = 'object' and left(coalesce(v ->> 'date', ''), 10) ~ '^\d{4}-\d{2}-\d{2}$'
                           and coalesce(v ->> 'order', '') ~ '^\d+$' and (v ->> 'order')::bigint > 0 and coalesce(s ->> 'order', '') ~ '^\d+$' and (v ->> 'order')::bigint = (s ->> 'order')::bigint) as cday,
                       exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'item' and m.ref = public._sub_key(s) and m.state = 'hide') as hidden
                  from jsonb_array_elements(subs) s
                 where jsonb_typeof(s) = 'object' and jsonb_typeof(s -> col) = 'number' and (s ->> col)::numeric > 0 and public._ots(s ->> 'submittedAt') is not null) y
               where p_staff or not y.hidden
               order by y.score desc, y.at desc
               limit lim) z), '[]'::jsonb));
  end loop;
  return out || jsonb_build_object(
    /* 우수 질문 — 앱이 학생 메시지 · 댓글을 아직 안 보냄(Replit 요청서 2회차) · 고른 질문이 생기면 여기에 */
    'q', jsonb_build_object('ready', false, 'picked', '[]'::jsonb),
    'scores', jsonb_array_length(subs) > 0 and exists (select 1 from jsonb_array_elements(subs) s where jsonb_typeof(s -> 'wa') = 'number' or jsonb_typeof(s -> 'tc') = 'number'));
end;
$$;
revoke all on function public._best_of(uuid, boolean) from public, anon, authenticated;

/* ---------- 2. 사진 — 앱 제출 id · 순서 (함수 online-best 만) ---------- */
create or replace function public._best_file(p_sid uuid, p_key text, p_i int, p_staff boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; f jsonb; v_ref text; sfid bigint;
begin
  if p_sid is null or coalesce(p_key, '') = '' or length(p_key) > 120 or p_i is null or p_i < 0 or p_i > 50 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  select x into s from public.app_records r, jsonb_array_elements(case when jsonb_typeof(r.subs) = 'array' then r.subs else '[]'::jsonb end) x
   where r.student_id = p_sid and jsonb_typeof(x) = 'object' and public._sub_key(x) = p_key limit 1;
  if s is null then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if not p_staff and exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'item' and m.ref = p_key and m.state = 'hide') then
    return jsonb_build_object('ok', false, 'reason', 'hidden');
  end if;
  select ff into f from jsonb_array_elements(case when jsonb_typeof(s -> 'files') = 'array' then s -> 'files' else '[]'::jsonb end) with ordinality as t(ff, o)
   where jsonb_typeof(ff) = 'object' and (case when coalesce(ff ->> 'i', '') ~ '^\d{1,3}$' then (ff ->> 'i')::int else (o - 1)::int end) = p_i limit 1;
  if f is null then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  select sf.id into sfid from public.sub_files sf where sf.student_id = p_sid and coalesce(f ->> 'url', '') <> '' and sf.src = left(f ->> 'url', 400);
  v_ref := coalesce(sfid::text, p_key || '@' || p_i::text);
  if not p_staff and exists (select 1 from public.online_marks m where m.student_id = p_sid and m.kind = 'photo' and m.ref = v_ref and m.state = 'hide') then
    return jsonb_build_object('ok', false, 'reason', 'hidden');
  end if;
  if coalesce(s ->> 'sub', '') !~ '^\d+$' then return jsonb_build_object('ok', false, 'reason', 'nosub'); end if;      /* 예전 기록 — 다시 받으면 생김 */
  return jsonb_build_object('ok', true, 'sub', (s ->> 'sub')::bigint, 'i', p_i,
    'kind', case when lower(coalesce(f ->> 'type', '')) = 'application/pdf' or coalesce(f ->> 'url', '') ~* '\.pdf(\?|$)' then 'pdf' else 'image' end);
end;
$$;
revoke all on function public._best_file(uuid, text, int, boolean) from public, anon, authenticated;

/* 러닝노트 링크(학생 · 학부모 본인) — 함수가 service_role 로만 부른다(화면이 직접 부르지 못함 · 앱 제출 id 가 화면에 안 나감) */
create or replace function public.hub_best_file(p_code text, p_key text, p_i int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public._is_online_student(s.id) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return public._best_file(s.id, p_key, p_i, false);
end;
$$;
revoke all on function public.hub_best_file(text, text, int) from public, anon, authenticated;
grant execute on function public.hub_best_file(text, text, int) to service_role;

/* 코치룸 직원(학생 카드 · 미리보기) — 함수가 직원 권한(사용자 토큰)으로 부른다 */
create or replace function public.staff_best_file(p_student uuid, p_key text, p_i int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return public._best_file(p_student, p_key, p_i, true);
end;
$$;
revoke all on function public.staff_best_file(uuid, text, int) from public, anon;
grant execute on function public.staff_best_file(uuid, text, int) to authenticated;

/* ---------- 3. 선정 이유 — AI 재료 · 저장 · 확인 ---------- */
/* AI 재료(직원만) — 지문 제목 · 문항 수 · 정답 수 · 오답정리 · 필기 점수 · 사람 피드백 · 사진 순서 · 저장된 초안 */
create or replace function public.staff_best_input(p_student uuid, p_kind text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; n public.online_best_notes; fb text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_kind not in ('wrong', 'text') or coalesce(p_key, '') = '' or length(p_key) > 120 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  select x into s from public.app_records r, jsonb_array_elements(case when jsonb_typeof(r.subs) = 'array' then r.subs else '[]'::jsonb end) x
   where r.student_id = p_student and jsonb_typeof(x) = 'object' and public._sub_key(x) = p_key limit 1;
  if s is null then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  fb := nullif(left(btrim(coalesce(s ->> 'fb', '')), 200), '');
  select * into n from public.online_best_notes x where x.student_id = p_student and x.kind = p_kind and x.key = p_key;
  return jsonb_build_object('ok', true, 'title', left(coalesce(s ->> 'title', ''), 200), 'k', s -> 'k', 'n', s -> 'n', 'wa', s -> 'wa', 'tc', s -> 'tc',
    'fb', fb, 'need', public._best_need(fb), 'app', coalesce(s ->> 'sub', '') ~ '^\d+$',
    'files', coalesce((select jsonb_agg(jsonb_build_object('i', case when coalesce(f ->> 'i', '') ~ '^\d{1,3}$' then (f ->> 'i')::int else (o - 1)::int end,
                                                           'kind', case when lower(coalesce(f ->> 'type', '')) = 'application/pdf' or coalesce(f ->> 'url', '') ~* '\.pdf(\?|$)' then 'pdf' else 'image' end) order by o)
                         from jsonb_array_elements(case when jsonb_typeof(s -> 'files') = 'array' then s -> 'files' else '[]'::jsonb end) with ordinality as t(f, o) where jsonb_typeof(f) = 'object'), '[]'::jsonb),
    'note', case when n.student_id is null then null else jsonb_build_object('draft', n.draft, 'final', n.final, 'state', n.state, 'photo', n.photo, 'err', n.err, 'tries', n.tries) end);
end;
$$;
revoke all on function public.staff_best_input(uuid, text, text) from public, anon;
grant execute on function public.staff_best_input(uuid, text, text) to authenticated;

/* AI 초안 저장(함수 online-best · service_role 만) — 초안이 오면 draft · 확인 전이면 state draft(확인한 글 · 상태는 그대로) · 오류면 err 만 */
create or replace function public.best_note_ai_save(p_student uuid, p_kind text, p_key text, p_draft text, p_photo boolean, p_err text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d text := left(btrim(coalesce(p_draft, '')), 1000); e text := left(coalesce(p_err, ''), 20);
begin
  if p_student is null or p_kind not in ('wrong', 'text') or coalesce(p_key, '') = '' or length(p_key) > 120 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  insert into public.online_best_notes as x (student_id, kind, key, draft, state, photo, err, tries, ai_at, at)
  values (p_student, p_kind, p_key, d, case when d <> '' then 'draft' else 'none' end, coalesce(p_photo, false) and d <> '', case when d <> '' then '' else e end, 1, now(), now())
  on conflict (student_id, kind, key) do update
     set draft = case when d <> '' then d else x.draft end,
         state = case when d <> '' and x.state = 'none' then 'draft' else x.state end,
         photo = case when d <> '' then coalesce(p_photo, false) else x.photo end,
         err = case when d <> '' then '' else e end,
         tries = x.tries + 1, ai_at = now(), at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.best_note_ai_save(uuid, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.best_note_ai_save(uuid, text, text, text, boolean, text) to service_role;

/* 직원 — 고친 글 저장 · [확인](p_ok true → 학생 · 학부모에게) · 확인 풀기(p_ok false → 「선정 이유 준비 중」) */
create or replace function public.best_note_set(p_student uuid, p_kind text, p_key text, p_text text, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := left(btrim(coalesce(p_text, '')), 1000);
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_student is null or p_kind not in ('wrong', 'text') or coalesce(p_key, '') = '' or length(p_key) > 120 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  if coalesce(p_ok, false) and t = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  insert into public.online_best_notes as x (student_id, kind, key, draft, final, state, by_email, ok_at, at)
  values (p_student, p_kind, p_key, t, case when coalesce(p_ok, false) then t else '' end, case when coalesce(p_ok, false) then 'ok' when t <> '' then 'draft' else 'none' end,
          lower(coalesce(auth.jwt() ->> 'email', '')), case when coalesce(p_ok, false) then now() end, now())
  on conflict (student_id, kind, key) do update
     set draft = t,
         final = case when coalesce(p_ok, false) then t else '' end,
         state = case when coalesce(p_ok, false) then 'ok' when t <> '' then 'draft' else 'none' end,
         by_email = excluded.by_email, ok_at = case when coalesce(p_ok, false) then now() else null end, at = now();
  return jsonb_build_object('ok', true, 'state', case when coalesce(p_ok, false) then 'ok' when t <> '' then 'draft' else 'none' end);
end;
$$;
revoke all on function public.best_note_set(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.best_note_set(uuid, text, text, text, boolean) to authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '120이 먼저 있음(online_marks · hub_best)' as what, (to_regclass('public.online_marks') is not null and to_regprocedure('public.hub_best(text)') is not null)::text as ok
union all select '선정 이유 표(online_best_notes) — RLS · 직원만 읽기 · 화면에서 직접 못 씀', (to_regclass('public.online_best_notes') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_best_notes'::regclass)
  and not has_table_privilege('anon', 'public.online_best_notes', 'select') and not has_table_privilege('authenticated', 'public.online_best_notes', 'insert'))::text
union all select '카드 날짜 = 지문 날짜(반 달력) · 제출일 sday', (position('cday' in pg_get_functiondef('public._best_of(uuid,boolean)'::regprocedure)) > 0
  and position('sday' in pg_get_functiondef('public._best_item(uuid,boolean,text,jsonb,text,integer,date,date,boolean,jsonb)'::regprocedure)) > 0)::text
union all select '사진 열람 — 링크용은 함수(service_role)만 · 직원용은 직원만', (not has_function_privilege('anon', 'public.hub_best_file(text,text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.hub_best_file(text,text,integer)', 'execute')
  and not has_function_privilege('anon', 'public.staff_best_file(uuid,text,integer)', 'execute'))::text
union all select 'AI 초안 저장은 함수만 · [확인]은 직원만', (not has_function_privilege('authenticated', 'public.best_note_ai_save(uuid,text,text,text,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'public.best_note_set(uuid,text,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.staff_best_input(uuid,text,text)', 'execute'))::text
union all select '한 줄 이하 피드백이면 선정 이유 필요(_best_need)', (public._best_need(null) and public._best_need('좋아요') and not public._best_need(repeat('가', 41)))::text;
