-- ============================================================
--  마라톤 코치룸 — 레포트 작성 글 안전장치 (migration-014-draft-safety.sql)
--
--  실행 방법
--    001 ~ 013 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 저장된 레포트 · 학생 기록은 바꾸지 않는다 (표 하나 · 트리거 · 함수만 더한다).
--
--  하는 일
--    · ② 작성의 글 칸(학생 코멘트 · 출결 메모 · 반 공통 코멘트 · 수업 내용 · 테스트 · 과제 이름)이 저장될 때
--      - 한 번에 절반 넘게 줄어들면 → 줄기 전 글을 text_history 에 따로 남긴다 (reason = shrink)
--      - 그 밖에는 같은 칸에 10분에 한 번씩 이전 글을 남긴다 (reason = auto) → [이전 내용 보기] 에서 되살린다
--      - 다른 사람 글로 바꾸거나 내 글로 덮을 때 화면이 바뀌기 전 글을 남긴다 (reason = replaced · 화면이 부른다)
--    · 칸마다 최근 30개까지만 둔다. 직원만 읽고, 아무도 고치거나 지울 수 없다 (트리거 · 함수만 쓴다).
-- ============================================================


create table if not exists public.text_history (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  by_email    text not null default '',
  by_name     text not null default '',
  week_start  date not null,
  kind        text not null,              -- entry 학생 칸 · common 반 공통
  target      text not null,              -- 학생 id 또는 반 이름
  field       text not null,              -- comment · attend_note · lessons · tests · homework
  value       jsonb not null,             -- 그때의 글 (수업 내용 · 테스트 · 과제는 목록)
  chars       integer not null default 0,
  reason      text not null default 'auto',   -- shrink 크게 줄어듦 · auto 10분마다 · replaced 다른 글로 바뀜

  constraint text_history_kind_check check (kind in ('entry', 'common')),
  constraint text_history_reason_check check (reason in ('shrink', 'auto', 'replaced'))
);
create index if not exists text_history_find_idx on public.text_history (week_start, kind, target, field, at desc);

alter table public.text_history enable row level security;
drop policy if exists text_history_staff_read on public.text_history;
create policy text_history_staff_read on public.text_history for select to authenticated using (public.is_staff());
/* insert · update · delete 정책 없음 */


/* 글 길이 — 글은 글자 수, 목록은 항목 글자 수 합 */
create or replace function public._th_chars(v jsonb)
returns integer
language sql
immutable
as $$
  select case jsonb_typeof(v)
    when 'string' then length(v #>> '{}')
    when 'array' then coalesce((select sum(length(coalesce(case jsonb_typeof(e) when 'string' then e #>> '{}' when 'object' then e ->> 'name' else '' end, '')))
                                from jsonb_array_elements(v) e), 0)::int
    else 0 end;
$$;

create or replace function public._th_keep(p_week date, p_kind text, p_target text, p_field text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  co integer := public._th_chars(p_old);
  cn integer := public._th_chars(p_new);
  why text;
begin
  if p_old is not distinct from p_new or co < 10 then return; end if;
  if cn < co * 0.5 then
    why := 'shrink';
  elsif not exists (select 1 from public.text_history
                    where week_start = p_week and kind = p_kind and target = p_target and field = p_field
                      and at > now() - interval '10 minutes') then
    why := 'auto';
  else
    return;
  end if;
  insert into public.text_history (by_email, by_name, week_start, kind, target, field, value, chars, reason)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), p_week, p_kind, p_target, p_field, p_old, co, why);
  delete from public.text_history where id in (
    select id from public.text_history
    where week_start = p_week and kind = p_kind and target = p_target and field = p_field
    order by at desc offset 30);
end;
$$;

create or replace function public._th_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._th_keep(old.week_start, 'entry', old.student_id::text, 'comment', to_jsonb(coalesce(old.comment, '')), to_jsonb(coalesce(new.comment, '')));
  perform public._th_keep(old.week_start, 'entry', old.student_id::text, 'attend_note', to_jsonb(coalesce(old.attend_note, '')), to_jsonb(coalesce(new.attend_note, '')));
  return new;
end;
$$;

create or replace function public._th_common()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._th_keep(old.week_start, 'common', old.class_name, 'comment', to_jsonb(coalesce(old.comment, '')), to_jsonb(coalesce(new.comment, '')));
  perform public._th_keep(old.week_start, 'common', old.class_name, 'lessons', coalesce(old.lessons, '[]'), coalesce(new.lessons, '[]'));
  perform public._th_keep(old.week_start, 'common', old.class_name, 'tests', coalesce(old.tests, '[]'), coalesce(new.tests, '[]'));
  perform public._th_keep(old.week_start, 'common', old.class_name, 'homework', coalesce(old.homework, '[]'), coalesce(new.homework, '[]'));
  return new;
end;
$$;

drop trigger if exists entries_text_history on public.entries;
create trigger entries_text_history before update on public.entries
  for each row execute function public._th_entries();
drop trigger if exists week_common_text_history on public.week_common;
create trigger week_common_text_history before update on public.week_common
  for each row execute function public._th_common();


/* [이전 내용 보기] — 그 칸의 최근 저장본 (직원) */
create or replace function public.text_history_list(p_week date, p_kind text, p_target text, p_field text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'at', h.at, 'by_name', h.by_name, 'value', h.value, 'chars', h.chars, 'reason', h.reason) order by h.at desc)
    from (select * from public.text_history
          where week_start = p_week and kind = p_kind and target = p_target and field = p_field
          order by at desc limit 15) h), '[]'::jsonb);
end;
$$;

/* 화면이 다른 글로 바꾸기 직전 — 그때 화면 글을 남긴다 (직원) */
create or replace function public.text_history_add(p_week date, p_kind text, p_target text, p_field text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_kind not in ('entry', 'common') or p_field not in ('comment', 'attend_note', 'lessons', 'tests', 'homework') then
    raise exception '알 수 없는 칸입니다.';
  end if;
  if public._th_chars(p_value) = 0 then return; end if;
  insert into public.text_history (by_email, by_name, week_start, kind, target, field, value, chars, reason)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), p_week, p_kind, p_target, p_field, p_value, public._th_chars(p_value), 'replaced');
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.text_history_list(date, text, text, text)', 'public.text_history_add(date, text, text, text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public._th_keep(date, text, text, text, jsonb, jsonb) from public, anon, authenticated';
end;
$$;


-- ============================================================
--  확인 — text_history 가 rls_enabled = true, 트리거 2개
-- ============================================================
select 'text_history rls' as what, rowsecurity::text as ok from pg_tables where schemaname = 'public' and tablename = 'text_history'
union all
select 'triggers', count(*)::text from pg_trigger where tgname in ('entries_text_history', 'week_common_text_history');
