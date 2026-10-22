-- ============================================================
--  마라톤 코치룸 — 학생 공용 입구 · 휴대폰 번호 로그인 (migration-024-student-login.sql)
--
--  실행 방법
--    023 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 기록 · 레포트 · 링크는 바꾸지 않는다 (표 하나 · 함수만 더한다).
--
--  학생은 모두 같은 주소(/s/)로 들어와 반 → 이름 → 비밀번호(학생 휴대폰 번호에서 010 을 뺀 8자리)를 넣는다.
--  맞으면 그 학생의 「학생 링크」 코드를 돌려주고, 화면은 그 학생 링크(/me/#코드)를 연다 — 학생 링크와 똑같은 화면 · 같은 권한.
--  지금 쓰는 학생 링크 · 학부모 링크는 그대로다.
--
--  1. student_logins — 로그인 기록 (학생 · 시각 · 성공/실패 · 이유). 직원만 읽는다 (코치룸 상담 카드).
--     비밀번호도, 넣은 값도 저장하지 않는다.
--  2. 함수 (링크 없이 누구나 부를 수 있는 것은 아래 셋뿐)
--     student_entry_classes()            보관하지 않은 반 중 재원 학생이 있는 반 이름만
--     student_entry_names(반)            그 반 재원 학생의 이름과 고르기용 표시값(key)만 — 학생 id · 번호 · 학교는 나가지 않는다
--     student_login(반, key, 비밀번호)    맞으면 { ok, code(학생 링크) } · 틀리면 { ok:false, reason } 만
--       · 비밀번호 = students.student_phone 뒤 8자리. 따로 저장하지 않고 이 함수가 비교한다
--       · 하이픈 · 띄어쓰기 · 010 을 붙여 넣어도 숫자만 골라 뒤 8자리로 맞춘다
--       · 학생 연락처가 없으면 reason 'nophone', 학생 링크가 아직 없으면 'nolink'
--       · 잠금 · 비밀번호 바꾸기는 없다 (요청대로). 학부모 번호 · 상담 · 성적 · 금액 · 다른 학생 정보는 이 입구로 나가지 않는다
--     student_login_log(학생 id)         코치룸(직원만) — 그 학생 최근 로그인 기록 50건
-- ============================================================


-- ------------------------------------------------------------
--  1. 표
-- ------------------------------------------------------------
create table if not exists public.student_logins (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  ok          boolean not null default false,
  reason      text not null default '',              -- '' 성공 · wrong 틀림 · nophone 연락처 없음 · nolink 학생 링크 없음
  created_at  timestamptz not null default now()
);
create index if not exists student_logins_student_idx on public.student_logins (student_id, created_at desc);
alter table public.student_logins enable row level security;
drop policy if exists student_logins_staff_read on public.student_logins;
create policy student_logins_staff_read on public.student_logins for select to authenticated using (public.is_staff());


-- ------------------------------------------------------------
--  도우미 — 보관한 반인가 · 고르기용 표시값
-- ------------------------------------------------------------
create or replace function public._class_open(p_class text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(btrim(p_class), '') <> ''
     and not exists (select 1 from public.classes c where c.name = btrim(p_class) and coalesce(c.archived, false));
$$;

/* 학생 id 를 그대로 내보내지 않으려고 쓰는 표시값 (16자) */
create or replace function public._entry_key(p_id uuid)
returns text
language sql
immutable
as $$ select left(md5('mhub-entry:' || p_id::text), 16); $$;


-- ------------------------------------------------------------
--  2. 학생 입구 (누구나)
-- ------------------------------------------------------------
create or replace function public.student_entry_classes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb)
  from (select distinct btrim(s.class_name) c from public.students s
        where not s.archived and public._class_open(s.class_name)) x;
$$;

create or replace function public.student_entry_names(p_class text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', public._entry_key(s.id), 'name', s.name) order by s.name, s.id), '[]'::jsonb)
  from public.students s
  where public._class_open(p_class) and not s.archived and btrim(s.class_name) = btrim(p_class);
$$;

create or replace function public.student_login(p_class text, p_key text, p_pw text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  sid uuid;
  sp text;
  scode text;
  d text := regexp_replace(coalesce(p_pw, ''), '\D', '', 'g');
  matched boolean;
begin
  if coalesce(p_key, '') !~ '^[0-9a-f]{16}$' or not public._class_open(p_class) then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  select s.id, regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g'), coalesce(l.student_code, '')
    into sid, sp, scode
    from public.students s left join public.student_links l on l.student_id = s.id
   where not s.archived and btrim(s.class_name) = btrim(p_class) and public._entry_key(s.id) = p_key
   limit 1;
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;

  if length(sp) < 8 then
    insert into public.student_logins (student_id, ok, reason) values (sid, false, 'nophone');
    return jsonb_build_object('ok', false, 'reason', 'nophone');
  end if;
  matched := length(d) between 8 and 11 and right(d, 8) = right(sp, 8);
  if not matched then
    insert into public.student_logins (student_id, ok, reason) values (sid, false, 'wrong');
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  if scode = '' then
    insert into public.student_logins (student_id, ok, reason) values (sid, false, 'nolink');
    return jsonb_build_object('ok', false, 'reason', 'nolink');
  end if;
  insert into public.student_logins (student_id, ok, reason) values (sid, true, '');
  return jsonb_build_object('ok', true, 'code', scode);
end;
$$;


-- ------------------------------------------------------------
--  코치룸 (직원만) — 상담 카드의 「학생 입구 로그인 기록」
-- ------------------------------------------------------------
create or replace function public.student_login_log(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.created_at, 'ok', x.ok, 'reason', x.reason) order by x.created_at desc)
    from (select * from public.student_logins where student_id = p_student order by created_at desc limit 50) x
  ), '[]'::jsonb);
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._class_open(text)', 'public._entry_key(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.student_entry_classes()', 'public.student_entry_names(text)', 'public.student_login(text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  execute 'revoke all on function public.student_login_log(uuid) from public, anon';
  execute 'grant execute on function public.student_login_log(uuid) to authenticated';
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'student_logins' as what, exists (select 1 from pg_tables where tablename = 'student_logins' and rowsecurity)::text as ok
union all select 'student_login (anon)', has_function_privilege('anon', 'public.student_login(text, text, text)', 'execute')::text
union all select 'login_log (staff only)', (not has_function_privilege('anon', 'public.student_login_log(uuid)', 'execute'))::text;
