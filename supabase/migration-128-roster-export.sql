-- ============================================================
--  migration-128-roster-export.sql — 20261125a · 127 다음(102 가 먼저 있어야 함) · 여러 번 실행해도 됨
--  코치룸 「📋 명단 받기」 — 반 명단 엑셀(.xlsx) 내려받기
--
--  1. roster_downloads — 받을 때마다 한 줄: 누가(이메일 · 이름 — 서버가 채움) · 언제 · 어느 반 · 넣은 열 · 퇴원생 포함 · 학생 수 · 파일 이름
--     학생 이름 · 연락처는 이 표에 남기지 않는다(반 이름 · 열 이름 · 수만)
--     화면에서 직접 쓰거나 고치거나 지울 수 없다 — roster_log 함수로만 넣고, 직원만 roster_log_list 로 읽는다
--  2. roster_log(반들, 열들, 퇴원생 포함, 학생 수, 시트 방식, 파일 이름) — 직원만 · 기록이 남아야 화면이 파일을 만든다
--  3. roster_log_list(몇 줄) — 직원 화면 「받기 기록」(최근 것부터)
--  4. roster_app(학생 id 들) — 「앱 연결 여부」 열: ok(앱 학생 id 로 연결) · share(공유 코드만) · ''(안 됨) · 직원만
-- ============================================================

/* ---------- 1. 받기 기록 표 ---------- */
create table if not exists public.roster_downloads (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  by_email   text not null default '',
  by_name    text not null default '',
  classes    text[] not null default '{}',
  cols       text[] not null default '{}',
  with_left  boolean not null default false,
  mode       text not null default 'sheets',        -- sheets(반마다 시트) · one(한 시트 · 「반」 열)
  n_rows     integer not null default 0,
  file       text not null default ''
);
create index if not exists roster_downloads_at_idx on public.roster_downloads (at desc);

alter table public.roster_downloads enable row level security;
/* 정책은 일부러 없다 — 화면(anon · authenticated)은 표를 직접 읽거나 쓰지 못한다 · 아래 함수로만 */
revoke all on public.roster_downloads from public, anon, authenticated;
revoke all on sequence public.roster_downloads_id_seq from public, anon, authenticated;

/* ---------- 2. 기록 남기기 (직원만) ---------- */
create or replace function public.roster_log(p_classes text[], p_cols text[], p_left boolean, p_rows integer, p_mode text, p_file text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  nm text;
  cl text[];
  new_id bigint;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select coalesce(array_agg(x order by o), '{}') into cl
    from (select left(btrim(v), 60) x, min(o) o from unnest(coalesce(p_classes, '{}')) with ordinality u(v, o)
           where btrim(coalesce(v, '')) <> '' group by left(btrim(v), 60)) t;
  if coalesce(array_length(cl, 1), 0) = 0 or array_length(cl, 1) > 200 then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  select coalesce(nullif(btrim(name), ''), em) into nm from public.staff where email = em;
  insert into public.roster_downloads (by_email, by_name, classes, cols, with_left, mode, n_rows, file)
  values (em, coalesce(nm, em), cl,
          (select coalesce(array_agg(left(btrim(c), 20)), '{}') from unnest(coalesce(p_cols, '{}')) c where btrim(coalesce(c, '')) <> ''),
          coalesce(p_left, false), case when p_mode = 'one' then 'one' else 'sheets' end,
          greatest(0, least(coalesce(p_rows, 0), 100000)), left(coalesce(p_file, ''), 200))
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;
revoke all on function public.roster_log(text[], text[], boolean, integer, text, text) from public, anon;
grant execute on function public.roster_log(text[], text[], boolean, integer, text, text) to authenticated;

/* ---------- 3. 받기 기록 보기 (직원만 · 최근 것부터) ---------- */
create or replace function public.roster_log_list(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('at', d.at, 'by', d.by_name, 'email', d.by_email, 'classes', to_jsonb(d.classes), 'cols', to_jsonb(d.cols),
                                        'left', d.with_left, 'mode', d.mode, 'n', d.n_rows, 'file', d.file) order by d.at desc, d.id desc)
      from (select * from public.roster_downloads order by at desc, id desc limit greatest(1, least(coalesce(p_limit, 100), 500))) d), '[]'::jsonb) end;
$$;
revoke all on function public.roster_log_list(integer) from public, anon;
grant execute on function public.roster_log_list(integer) to authenticated;

/* ---------- 4. 앱 연결 여부 (직원만) ---------- */
create or replace function public.roster_app(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_object_agg(l.student_id::text, case when l.app_user_id is not null then 'ok' when coalesce(l.app_share_code, '') <> '' then 'share' else '' end)
      from public.student_links l where l.student_id = any(coalesce(p_ids, '{}'))), '{}'::jsonb) end;
$$;
revoke all on function public.roster_app(uuid[]) from public, anon;
grant execute on function public.roster_app(uuid[]) to authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '102가 먼저 있음(student_links.app_user_id)' as what,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_links' and column_name = 'app_user_id')::text as ok
union all select '받기 기록 표(roster_downloads) — RLS · 화면에서 직접 못 읽고 못 씀', (to_regclass('public.roster_downloads') is not null
  and (select relrowsecurity from pg_class where oid = 'public.roster_downloads'::regclass)
  and not has_table_privilege('anon', 'public.roster_downloads', 'select') and not has_table_privilege('authenticated', 'public.roster_downloads', 'select')
  and not has_table_privilege('authenticated', 'public.roster_downloads', 'insert') and not has_table_privilege('authenticated', 'public.roster_downloads', 'delete'))::text
union all select '기록 남기기 · 기록 보기 · 앱 연결 — 로그인 안 한 사람(anon)은 못 부름', (to_regprocedure('public.roster_log(text[],text[],boolean,integer,text,text)') is not null
  and not has_function_privilege('anon', 'public.roster_log(text[],text[],boolean,integer,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.roster_log_list(integer)', 'execute')
  and not has_function_privilege('anon', 'public.roster_app(uuid[])', 'execute'))::text
union all select '직원이 아니면 빈 값(roster_log_list · roster_app)', (public.roster_log_list(5) is null and public.roster_app('{}') is null)::text;
