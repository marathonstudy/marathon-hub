-- ============================================================
--  마라톤 코치룸 — 새 학생 링크 바로 만들기 · 학생 입구 로그인 (migration-045-links.sql)
--
--  실행 방법
--    044 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다 (이미 있는 링크는 바꾸지 않는다). 함수 배포는 없다.
--
--  1. 링크가 없는 학생(퇴원 제외) 모두 — 학부모 링크(hub_code) · 학생 링크(student_code)를 만든다
--     만든 학생 수는 맨 아래 확인 줄 「링크 만든 학생」에 나온다 (app_settings 'link_backfill' 에도 남긴다)
--  2. 새로 등록하는 학생(한 명 · 엑셀 · CSV) — 서버에서도 바로 두 링크를 만든다 (코치룸도 등록하자마자 만든다)
--  3. student_login — 학생 링크가 없으면 그 자리에서 만들어 들어가게 한다 (예전에는 「학생 링크 발급을 부탁하세요」에서 멈췄다)
--  링크 코드는 24자 (영문 소문자 · 숫자 · gen_random_uuid 두 개) — 다른 학생 화면을 열 수 없게 추측하기 어렵게.
-- ============================================================

create or replace function public._new_link_code()
returns text
language sql
volatile
as $$ select substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 24); $$;
revoke all on function public._new_link_code() from public, anon, authenticated;

do $$
declare n_new int := 0; n_hub int := 0; n_stu int := 0; ids uuid[];
begin
  with made as (
    insert into public.student_links (student_id, hub_code, hub_issued_at, student_code, student_issued_at)
    select s.id, public._new_link_code(), now(), public._new_link_code(), now()
      from public.students s
     where not s.archived and not exists (select 1 from public.student_links l where l.student_id = s.id)
    returning student_id)
  select coalesce(array_agg(student_id), '{}') into ids from made;
  n_new := coalesce(array_length(ids, 1), 0);
  with h as (
    update public.student_links l set hub_code = public._new_link_code(), hub_issued_at = now()
      from public.students s where s.id = l.student_id and not s.archived and l.hub_code is null
    returning l.student_id)
  select coalesce(array_agg(student_id), '{}') || ids into ids from h;
  with st as (
    update public.student_links l set student_code = public._new_link_code(), student_issued_at = now()
      from public.students s where s.id = l.student_id and not s.archived and l.student_code is null
    returning l.student_id)
  select coalesce(array_agg(student_id), '{}') || ids into ids from st;
  insert into public.app_settings (key, value)
  values ('link_backfill', jsonb_build_object('at', now(), 'students', (select count(distinct x) from unnest(ids) x)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

/* 새 학생 — 두 링크를 바로 (이미 있으면 그대로) */
create or replace function public._student_links_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.student_links (student_id, hub_code, hub_issued_at, student_code, student_issued_at)
  values (new.id, public._new_link_code(), now(), public._new_link_code(), now())
  on conflict (student_id) do nothing;
  return new;
end;
$$;
revoke all on function public._student_links_new() from public, anon, authenticated;
drop trigger if exists students_links_new on public.students;
create trigger students_links_new after insert on public.students for each row execute function public._student_links_new();

/* 학생 입구 로그인 — 024 와 같고, 학생 링크가 없으면 만들어서 들어간다 */
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
    scode := public._new_link_code();
    insert into public.student_links (student_id, student_code, student_issued_at) values (sid, scode, now())
    on conflict (student_id) do update set student_code = excluded.student_code, student_issued_at = now()
      where public.student_links.student_code is null;
    select student_code into scode from public.student_links where student_id = sid;
  end if;
  insert into public.student_logins (student_id, ok, reason) values (sid, true, '');
  return jsonb_build_object('ok', true, 'code', scode);
end;
$$;
revoke all on function public.student_login(text, text, text) from public;
grant execute on function public.student_login(text, text, text) to anon, authenticated;


-- ============================================================
--  확인 — 세 줄 (앞 두 줄 true · 셋째 줄은 이번에 링크를 만든 학생 수)
-- ============================================================
select '링크 없는 학생 없음' as what, (not exists (select 1 from public.students s left join public.student_links l on l.student_id = s.id
                                               where not s.archived and (l.hub_code is null or l.student_code is null)))::text as ok
union all select '새 학생 링크 트리거', exists (select 1 from pg_trigger where tgname = 'students_links_new')::text
union all select '링크 만든 학생', coalesce((select value ->> 'students' from public.app_settings where key = 'link_backfill'), '0') || '명';
