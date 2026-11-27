-- ============================================================
--  migration-133-app-note.sql — 20261127a · 132 다음 · 여러 번 실행해도 안전 · 그다음 함수 hub-embed 새로 배포
--  마라톤 앱 안 「내 러닝노트」 (앱 모드) — 끄는 스위치 · 보여 줄 대상 · 오류 기록 · 서명 확인 뒤 학생 찾기
--
--  흐름: 앱 서버가 HUB_EMBED_SECRET 으로 「앱 학생번호 + 만료 시각(10분)」에 서명 → 함수 hub-embed 가 서명을 확인하고
--        아래 함수(서버 전용 · service_role)로 학생을 찾는다. 비밀값은 DB 에 없다(Supabase Secrets 에만).
--  1. 설정 app_settings 'app_note' = { on(기본 false), target: staff | classes | all, classes: [반 이름], uids: [시험용 앱 학생번호] }
--     staff  = 원장 · 직원이 「시험용 앱 학생번호」에 넣은 계정만 · classes = 고른 반 학생만 · all = 앱 학생번호가 연결된 모든 학생
--     꺼져 있거나 대상이 아니면 — 요약 카드는 「숨김」 · 앱 모드 링크는 「잠시 쉬는 중」
--  2. 오류 기록 app_note_log — 날짜 · 종류 · 횟수 · 마지막 시각만 (학생 이름 · 번호 · 앱 학생번호는 저장하지 않는다)
--     종류: bad(서명 위조 · 모양 틀림) · expired(만료) · fail(값 실패) · slow(느린 응답 2.5초 넘음) · nolink(연결된 학생 없음)
--  3. 학생 찾기 — 지금 쓰는 앱 학생번호 연결(student_links.app_user_id · migration-102) 그대로
--     러닝노트는 그 학생의 「학생 링크」 코드로 연다 — 학생 링크가 아직 없으면 하나 만든다(기존 학부모 링크 · 다른 링크는 그대로)
--  4. 요약 카드 원재료 — 저장해 둔 앱 기록(hub_app_record) · 조교 수정값(hub_hw_fix) · 수강 시작일 · 본 레벨 · 새 레포트 · 새 월간 배지
--     전화번호 · 금액 · 환급 기준 % · 순위 · 비교 · AI 근거 · AI 피드백 · 얼굴 사진은 넘기지 않는다
--  5. 코치룸 — app_note_get / app_note_set / app_note_log7 (직원만)
-- ============================================================

/* ---------- 1. 설정 (기본 꺼짐) ---------- */
insert into public.app_settings (key, value) values ('app_note', '{"on": false, "target": "staff", "classes": [], "uids": []}'::jsonb)
on conflict (key) do nothing;

/* 설정 값 정리 — 모르는 값은 가장 좁게(꺼짐 · staff) */
create or replace function public._app_note_conf()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on', coalesce((v ->> 'on')::boolean, false),
    'target', case when v ->> 'target' in ('staff', 'classes', 'all') then v ->> 'target' else 'staff' end,
    'classes', case when jsonb_typeof(v -> 'classes') = 'array' then v -> 'classes' else '[]'::jsonb end,
    'uids', case when jsonb_typeof(v -> 'uids') = 'array' then v -> 'uids' else '[]'::jsonb end)
  from (select coalesce((select value from public.app_settings where key = 'app_note'), '{}'::jsonb) v) x;
$$;
revoke all on function public._app_note_conf() from public, anon, authenticated;

/* ---------- 2. 오류 기록 ---------- */
create table if not exists public.app_note_log (
  day     date not null,
  kind    text not null,
  n       integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (day, kind)
);
alter table public.app_note_log enable row level security;
revoke all on public.app_note_log from anon, authenticated;

create or replace function public.app_embed_log(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('bad', 'expired', 'fail', 'slow', 'nolink') then return; end if;
  insert into public.app_note_log (day, kind, n, last_at) values ((now() at time zone 'Asia/Seoul')::date, p_kind, 1, now())
  on conflict (day, kind) do update set n = public.app_note_log.n + 1, last_at = now();
  delete from public.app_note_log where day < (now() at time zone 'Asia/Seoul')::date - 60;   /* 60일 지난 것은 지운다 */
end;
$$;
revoke all on function public.app_embed_log(text) from public, anon, authenticated;
grant execute on function public.app_embed_log(text) to service_role;

/* ---------- 3. 학생 찾기 + 스위치 · 대상 ----------
   돌려주는 것 { state: ok | off | notarget | nolink, sid, code }  (sid · code 는 ok 일 때만 · 함수 안에서만 씀) */
create or replace function public._app_embed_find(p_uid bigint, p_issue boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := public._app_note_conf(); l record; s record; code text; has_link boolean;
begin
  if p_uid is null or p_uid <= 0 then return jsonb_build_object('state', 'nolink'); end if;
  if not (c ->> 'on')::boolean then return jsonb_build_object('state', 'off'); end if;
  select * into l from public.student_links where app_user_id = p_uid limit 1;
  has_link := found;
  if c ->> 'target' = 'staff' and not exists (select 1 from jsonb_array_elements_text(c -> 'uids') u where u = p_uid::text) then
    return jsonb_build_object('state', 'notarget');
  end if;
  if not has_link then return jsonb_build_object('state', 'nolink'); end if;
  select * into s from public.students where id = l.student_id;
  if not found or s.archived then return jsonb_build_object('state', 'nolink'); end if;
  if c ->> 'target' = 'classes' and not (
       coalesce(s.class_name, '') in (select jsonb_array_elements_text(c -> 'classes'))
       or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name in (select jsonb_array_elements_text(c -> 'classes')))) then
    return jsonb_build_object('state', 'notarget');
  end if;
  code := l.student_code;
  if coalesce(code, '') = '' and p_issue then
    /* 학생 링크가 없으면 하나 만든다 (32자 · 다른 링크는 그대로) */
    code := replace(gen_random_uuid()::text, '-', '');
    update public.student_links set student_code = code, student_issued_at = now() where student_id = s.id and student_code is null;
    select student_code into code from public.student_links where student_id = s.id;
  end if;
  if coalesce(code, '') = '' then code := l.hub_code; end if;
  if coalesce(code, '') = '' then return jsonb_build_object('state', 'nolink'); end if;
  return jsonb_build_object('state', 'ok', 'sid', s.id, 'code', code);
end;
$$;
revoke all on function public._app_embed_find(bigint, boolean) from public, anon, authenticated;

/* 앱 모드 러닝노트 열기 — { state, code } */
create or replace function public.app_embed_open(p_uid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb := public._app_embed_find(p_uid, true);
begin
  if f ->> 'state' <> 'ok' then return jsonb_build_object('state', f ->> 'state'); end if;
  return jsonb_build_object('state', 'ok', 'code', f ->> 'code');
end;
$$;
revoke all on function public.app_embed_open(bigint) from public, anon, authenticated;
grant execute on function public.app_embed_open(bigint) to service_role;

/* ---------- 4. 요약 카드 원재료 (학생 1명) ---------- */
create or replace function public.app_embed_card(p_uid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb := public._app_embed_find(p_uid, false); sid uuid; code text; rec jsonb; g public.student_game; st date;
begin
  if f ->> 'state' <> 'ok' then return jsonb_build_object('state', f ->> 'state'); end if;
  sid := (f ->> 'sid')::uuid; code := f ->> 'code';
  rec := public.hub_app_record(code);
  select * into g from public.student_game where student_id = sid;
  select start_on into st from public.students where id = sid;
  return jsonb_build_object(
    'state', 'ok',
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'start', coalesce(st::text, ''),
    'data', case when rec is not null and (rec ->> 'ok')::boolean then rec -> 'data' end,
    'fix', coalesce(public.hub_hw_fix(code), '{}'::jsonb),
    'seen_level', coalesce(g.seen_level, 0),
    'seen_perfect', coalesce(g.seen_perfect, ''),
    'new_report', exists (select 1 from public.published p where p.student_id = sid and p.visible and p.published_at > now() - interval '3 days'),
    'new_award', exists (select 1 from public.routine_awards a where a.student_id = sid and a.sent_at > now() - interval '7 days'));
end;
$$;
revoke all on function public.app_embed_card(bigint) from public, anon, authenticated;
grant execute on function public.app_embed_card(bigint) to service_role;

/* ---------- 5. 코치룸 (직원만) ---------- */
create or replace function public.app_note_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception '직원만 볼 수 있습니다.'; end if;
  return public._app_note_conf() || jsonb_build_object(
    'all_classes', coalesce((select jsonb_agg(x.c order by x.c) from (
        select distinct class_name c from public.students where not archived and coalesce(class_name, '') <> ''
        union select distinct class_name from public.class_members) x), '[]'::jsonb),
    'linked', (select count(*) from public.student_links l join public.students s on s.id = l.student_id where l.app_user_id is not null and not s.archived));
end;
$$;
revoke all on function public.app_note_get() from public, anon;
grant execute on function public.app_note_get() to authenticated;

create or replace function public.app_note_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_staff() then raise exception '직원만 바꿀 수 있습니다.'; end if;
  v := jsonb_build_object(
    'on', coalesce((p ->> 'on')::boolean, false),
    'target', case when p ->> 'target' in ('staff', 'classes', 'all') then p ->> 'target' else 'staff' end,
    'classes', coalesce((select jsonb_agg(distinct btrim(c)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'classes') = 'array' then p -> 'classes' else '[]'::jsonb end) c where btrim(c) <> ''), '[]'::jsonb),
    'uids', coalesce((select jsonb_agg(distinct u) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'uids') = 'array' then p -> 'uids' else '[]'::jsonb end) u where u ~ '^[0-9]{1,18}$'), '[]'::jsonb));
  insert into public.app_settings (key, value, updated_at, updated_by) values ('app_note', v, now(), who)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = who;
  return jsonb_build_object('ok', true) || v;
end;
$$;
revoke all on function public.app_note_set(jsonb) from public, anon;
grant execute on function public.app_note_set(jsonb) to authenticated;

/* 최근 7일 오류 요약 — 날짜 · 종류 · 횟수만 */
create or replace function public.app_note_log7()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception '직원만 볼 수 있습니다.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', day, 'kind', kind, 'n', n, 'last', last_at) order by day desc, kind)
                     from public.app_note_log where day >= (now() at time zone 'Asia/Seoul')::date - 6), '[]'::jsonb);
end;
$$;
revoke all on function public.app_note_log7() from public, anon;
grant execute on function public.app_note_log7() to authenticated;

/* ---------- 확인 표 ---------- */
select '1 설정 app_note (기본 꺼짐)' as what, coalesce((select (value ->> 'on') from public.app_settings where key = 'app_note'), '없음') as ok
union all select '2 오류 기록 표 app_note_log', (to_regclass('public.app_note_log') is not null)::text
union all select '3 열기 app_embed_open', (to_regprocedure('public.app_embed_open(bigint)') is not null)::text
union all select '4 카드 app_embed_card', (to_regprocedure('public.app_embed_card(bigint)') is not null)::text
union all select '5 코치룸 app_note_get · set · log7', (to_regprocedure('public.app_note_get()') is not null and to_regprocedure('public.app_note_set(jsonb)') is not null and to_regprocedure('public.app_note_log7()') is not null)::text
union all select '6 앱 학생번호 연결된 학생 수', (select count(*)::text from public.student_links where app_user_id is not null);
