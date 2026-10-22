-- ============================================================
--  마라톤 코치룸 — 문자 「AI로 다듬기」 (migration-026-text-polish.sql)
--
--  실행 방법
--    001 ~ 025 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 이미 있는 표 · 기록은 바꾸지 않는다 (표 · 함수만 더한다).
--
--  흐름
--    문자 보내기 창 → [AI로 다듬기] → Edge Function(text-polish) 이 Claude(Haiku 5.5)로 문장을 다듬는다
--    → 「다듬은 문장」을 보여 주고 직원이 [이걸로 바꾸기] 해야 내용 칸이 바뀐다
--  지키는 것
--    · 원래 문장 · 다듬은 문장은 어디에도 저장하지 않는다 (몇 번 · 몇 글자 · 토큰 · 대략 비용만)
--    · 학생 이름 · 번호는 Claude 에 보내지 않는다 (내용 칸 글만 — #{이름} 같은 자리표시는 그대로)
--    · 한 달(한국 날짜) 횟수 상한 — 기본 500회. AI 요약(80회)과 따로 센다. 상한은 「오늘」 → [설정]에서 바꾼다 (AI 요약 상한과 같은 권한)
--    · 새 표는 RLS. 직원만 읽는다. 쓰기는 아래 함수로만
--    · Claude 키는 Edge Function 비밀 설정(Secrets)의 ANTHROPIC_API_KEY 에만 있다
-- ============================================================


-- ------------------------------------------------------------
--  1. polish_usage — 다듬기 호출 기록 (글은 저장하지 않는다)
-- ------------------------------------------------------------
create table if not exists public.polish_usage (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  by_email       text not null default '',
  by_name        text not null default '',
  status         text not null default 'started',   -- started 다듬는 중 · ok 성공 · failed 실패 (실패는 상한에 안 셈)
  chars          integer not null default 0,         -- 보낸 글자 수 (글은 저장하지 않는다)
  length         text not null default '',           -- short 짧게 · normal 보통 · long 자세히
  model          text not null default '',
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(10, 5) not null default 0,
  error          text not null default '',
  finished_at    timestamptz,

  constraint polish_usage_status_check check (status in ('started', 'ok', 'failed'))
);
create index if not exists polish_usage_at_idx on public.polish_usage (at desc);

alter table public.polish_usage enable row level security;
drop policy if exists polish_usage_staff_read on public.polish_usage;
create policy polish_usage_staff_read on public.polish_usage for select to authenticated using (public.is_staff());
/* insert · update · delete 정책 없음 — 아래 함수만 쓴다 */


-- ------------------------------------------------------------
--  2. 월 상한 · 이번 달 사용량
-- ------------------------------------------------------------
create or replace function public._polish_cap()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value ->> 'monthly_cap')::int from public.app_settings where key = 'text_polish'), 500);
$$;

/* 이번 달 센 횟수 — 성공 + 5분 안에 시작해서 아직 끝나지 않은 것 (실패는 세지 않는다) */
create or replace function public._polish_used()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.polish_usage
  where at >= (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul'
    and (status = 'ok' or (status = 'started' and at > now() - interval '5 minutes'));
$$;

/* 코치룸 — 이번 달 n / 500회 (직원) */
create or replace function public.polish_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('cap', public._polish_cap(), 'used', public._polish_used());
end;
$$;

/* 월 상한 바꾸기 — AI 요약 상한(ai_cap_set)과 같은 권한 (_need_teacher) */
create or replace function public.polish_cap_set(p_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._need_teacher();
  if p_cap is null or p_cap < 0 or p_cap > 5000 then raise exception '월 상한은 0 ~ 5000 회로 정해 주세요.'; end if;
  insert into public.app_settings (key, value) values ('text_polish', jsonb_build_object('monthly_cap', p_cap))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('monthly_cap', p_cap), updated_at = now();
  return jsonb_build_object('ok', true, 'cap', p_cap);
end;
$$;


-- ------------------------------------------------------------
--  3. Edge Function(text-polish) 이 부르는 함수 — 로그인한 직원의 토큰으로 부른다
--     (service_role 은 쓰지 않는다. 서버가 그 사람이 직원인지 · 상한이 남았는지 직접 확인)
-- ------------------------------------------------------------

/* 다듬기 시작 — 상한이 남았으면 기록 한 줄을 만들고 번호를 돌려준다 */
create or replace function public.polish_begin(p_chars integer, p_length text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  used int;
  nid bigint;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtext('marathon-text-polish'));
  cap := public._polish_cap();
  used := public._polish_used();
  if used >= cap then
    return jsonb_build_object('ok', false, 'reason', 'cap', 'used', used, 'cap', cap);
  end if;
  insert into public.polish_usage (by_email, by_name, chars, length)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(public._staff_name(), ''), greatest(0, coalesce(p_chars, 0)),
          case when p_length in ('short', 'normal', 'long') then p_length else '' end)
  returning id into nid;
  return jsonb_build_object('ok', true, 'usage_id', nid, 'used', used + 1, 'cap', cap);
end;
$$;

/* 다듬기 끝 — 성공 · 실패와 토큰 · 대략 비용만 남긴다 (글은 받지 않는다) */
create or replace function public.polish_finish(
  p_usage bigint, p_ok boolean, p_model text, p_in integer, p_out integer, p_cost numeric, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.polish_usage;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into u from public.polish_usage where id = p_usage for update;
  if not found or u.status <> 'started' or u.by_email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception '다듬기 기록을 찾을 수 없습니다.';
  end if;
  update public.polish_usage
     set status = case when coalesce(p_ok, false) then 'ok' else 'failed' end,
         error = left(coalesce(p_error, ''), 300), model = left(coalesce(p_model, ''), 60),
         input_tokens = greatest(0, coalesce(p_in, 0)), output_tokens = greatest(0, coalesce(p_out, 0)),
         cost_usd = greatest(0, coalesce(p_cost, 0)), finished_at = now()
   where id = p_usage;
  return jsonb_build_object('ok', true, 'used', public._polish_used(), 'cap', public._polish_cap());
end;
$$;


-- ------------------------------------------------------------
--  4. 권한
-- ------------------------------------------------------------
revoke all on function public._polish_cap() from public, anon, authenticated;
revoke all on function public._polish_used() from public, anon, authenticated;
revoke all on function public.polish_status() from public, anon;
revoke all on function public.polish_cap_set(integer) from public, anon;
revoke all on function public.polish_begin(integer, text) from public, anon;
revoke all on function public.polish_finish(bigint, boolean, text, integer, integer, numeric, text) from public, anon;
grant execute on function public.polish_status() to authenticated;
grant execute on function public.polish_cap_set(integer) to authenticated;
grant execute on function public.polish_begin(integer, text) to authenticated;
grant execute on function public.polish_finish(bigint, boolean, text, integer, integer, numeric, text) to authenticated;
