-- ============================================================
--  마라톤 코치룸 — AI 수업 요약 [초안 지우기] · [확정 취소] (migration-019-summary-discard.sql)
--
--  실행 방법
--    018 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 구조는 바꾸지 않는다 (함수 두 개만 만든다).
--
--  summary_discard(반, 주)   — 확정 전 초안을 지운다. 되돌릴 수 없다. 이번 달 사용 횟수는 돌려주지 않는다.
--      · 확정본이 없는 주: 그 주 요약 줄을 지운다
--      · 확정본이 있는 주(그 위에 새 초안을 만든 경우): 새 초안만 비우고 확정본은 그대로 둔다
--  summary_unconfirm(반, 주) — 확정을 취소한다. 학부모 화면(러닝노트 · 반 공지)에서 내려가고 초안으로 돌아간다.
--      · 「수업 내용」 칸(week_common)과 이미 공개한 레포트는 바꾸지 않는다
--  둘 다 직원(조교 · 선생님)만. 학생 · 학부모 링크(anon)는 부를 수 없다. 표를 직접 지우는 권한은 여전히 없다.
-- ============================================================


create or replace function public.summary_discard(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.lesson_summaries;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into s from public.lesson_summaries where class_name = btrim(p_class) and week_start = p_week for update;
  if not found then return jsonb_build_object('ok', true, 'summary', null); end if;
  if s.confirmed is null then
    delete from public.lesson_summaries where class_name = s.class_name and week_start = s.week_start;
    return jsonb_build_object('ok', true, 'summary', null);
  end if;
  update public.lesson_summaries
     set status = 'confirmed', draft = s.confirmed, draft_note = '', updated_at = now()
   where class_name = s.class_name and week_start = s.week_start
  returning * into s;
  return jsonb_build_object('ok', true, 'summary', to_jsonb(s));
end;
$$;

create or replace function public.summary_unconfirm(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.lesson_summaries;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into s from public.lesson_summaries where class_name = btrim(p_class) and week_start = p_week for update;
  if not found or s.confirmed is null then return jsonb_build_object('ok', true, 'summary', case when found then to_jsonb(s) end); end if;
  update public.lesson_summaries
     set status = 'draft',
         draft = case when s.status = 'draft' and jsonb_typeof(s.draft) = 'array' and jsonb_array_length(s.draft) > 0
                      then s.draft else s.confirmed end,
         confirmed = null, confirmed_by = '', confirmed_at = null, updated_at = now()
   where class_name = s.class_name and week_start = s.week_start
  returning * into s;
  return jsonb_build_object('ok', true, 'summary', to_jsonb(s));
end;
$$;

revoke all on function public.summary_discard(text, date)   from public, anon;
revoke all on function public.summary_unconfirm(text, date) from public, anon;
grant execute on function public.summary_discard(text, date)   to authenticated;
grant execute on function public.summary_unconfirm(text, date) to authenticated;


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select 'summary_discard' as what, exists (select 1 from pg_proc where proname = 'summary_discard')::text as ok
union all select 'summary_unconfirm', exists (select 1 from pg_proc where proname = 'summary_unconfirm')::text;
