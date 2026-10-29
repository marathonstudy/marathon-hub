-- ============================================================
--  마라톤 코치룸 — 「AI에게 고쳐 달라고 하기」 반 기본 요청 (migration-043-ai-requests.sql)
--
--  실행 방법
--    042 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이 SQL 을 실행한 뒤 Edge Function text-polish · lesson-summary 를 새 코드로 다시 배포한다.
--
--  ai_requests — 「이 요청을 이 반 기본으로 기억하기」로 남긴 요청 (예: 「과제율은 늘 빼 줘」)
--    scope   반 이름 · 과정은 「§과정 이름」 (과정은 과정 단위로 기억한다)
--    request 요청 글 (2 ~ 300자) · 같은 반에 같은 글은 한 번만
--  다음 「AI로 초안 쓰기」 · 복습 노트 만들기에서 처음부터 따른다. 「빼 줘」 항목은 그 자료를 AI 에 보내지 않는다 (화면이 거른다).
--  반 관리 · 과정 관리 · AI 결과 창에서 보고 지운다. 직원만 (조교 · 선생님 같다) · 학생 · 학부모 화면은 읽지 않는다.
-- ============================================================

create table if not exists public.ai_requests (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,
  request     text not null,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  constraint ai_requests_scope_len check (char_length(btrim(scope)) between 1 and 60),
  constraint ai_requests_len check (char_length(btrim(request)) between 2 and 300)
);
create unique index if not exists ai_requests_uq on public.ai_requests (scope, request);
create index if not exists ai_requests_scope_idx on public.ai_requests (scope, created_at);

create or replace function public._ai_req_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.created_at := now();
  new.request := btrim(new.request);
  new.scope := btrim(new.scope);
  return new;
end;
$$;
drop trigger if exists ai_requests_stamp on public.ai_requests;
create trigger ai_requests_stamp before insert on public.ai_requests for each row execute function public._ai_req_stamp();

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon;
grant select, insert, delete on public.ai_requests to authenticated;
drop policy if exists ai_requests_staff_read on public.ai_requests;
drop policy if exists ai_requests_staff_insert on public.ai_requests;
drop policy if exists ai_requests_staff_delete on public.ai_requests;
create policy ai_requests_staff_read on public.ai_requests for select to authenticated using (public.is_staff());
create policy ai_requests_staff_insert on public.ai_requests for insert to authenticated with check (public.is_staff());
create policy ai_requests_staff_delete on public.ai_requests for delete to authenticated using (public.is_staff());


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select 'ai_requests' as what, exists (select 1 from pg_tables where tablename = 'ai_requests' and rowsecurity)::text as ok
union all select 'anon 못 읽음', (not has_table_privilege('anon', 'public.ai_requests', 'select'))::text;
