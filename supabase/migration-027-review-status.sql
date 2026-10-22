-- ============================================================
--  마라톤 코치룸 — 레포트 · 러닝노트의 복습테스트 칸이 「확인 전 제출」도 알아보게 (migration-027-review-status.sql)
--
--  실행 방법
--    026 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 · 기록은 바꾸지 않는다 (함수 두 개만 고치거나 더한다).
--
--  바꾸는 것
--  1. review_week_scores(주차) — 코치룸(직원)이 레포트를 만들 때 부른다.
--     예전에는 선생님이 「확인」한 점수만 돌려줘서, 학생이 냈는데 아직 확인 전이면 레포트 복습테스트 칸이 비었다.
--     이제 확인 전 제출도 status = 'submitted' 로 함께 돌려준다. 레포트에는 확인한 것만 점수,
--     확인 전은 「제출 완료」만 나간다 (화면 코드 admin/report.js 가 가른다).
--  2. hub_review_week(링크 코드, 주차) — 새 함수. 러닝노트 「이번 주」 카드의 복습테스트 칸이 부른다.
--     그 학생 그 주 시험마다 낸 것 / 확인한 것 여부만 돌려준다. 점수 · 틀린 번호 · 사진은 돌려주지 않는다
--     (확인한 점수는 예전처럼 hub_get 에서만). 퇴원한 학생 · 모르는 코드는 빈 목록.
--  학부모에게 확인 전 점수가 나가지 않는 규칙은 그대로다.
-- ============================================================

create or replace function public.review_week_scores(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('student_id', s.student_id, 'round_no', t.round_no, 'test_name', t.test_name,
                                        'label', public._review_label(t.lesson_date, t.test_name), 'lesson_date', t.lesson_date, 'sort_no', t.sort_no,
                                        'status', case when s.status = 'confirmed' then 'confirmed' else 'submitted' end,
                                        'correct', s.correct, 'q_count', s.q_count, 'score', s.score) order by t.sort_no, t.test_name)
    from public.review_submissions s join public.review_tests t on t.id = s.test_id
    where t.week_start = p_week and not t.off), '[]'::jsonb);
end;
$$;

create or replace function public.hub_review_week(p_code text, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  mon date;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived or p_week is null then
    return '[]'::jsonb;
  end if;
  mon := public._monday(p_week);
  return coalesce((
    select jsonb_agg(jsonb_build_object('test_name', t.test_name, 'lesson_date', t.lesson_date,
                                        'label', public._review_label(t.lesson_date, t.test_name),
                                        'status', case when r.status = 'confirmed' then 'confirmed' else 'submitted' end)
                     order by t.sort_no, t.test_name)
    from public.review_submissions r join public.review_tests t on t.id = r.test_id
    where r.student_id = s.id and t.class_name = s.class_name and t.week_start = mon and not t.off), '[]'::jsonb);
end;
$$;

revoke all on function public.review_week_scores(date) from public, anon;
grant execute on function public.review_week_scores(date) to authenticated;
revoke all on function public.hub_review_week(text, date) from public;
grant execute on function public.hub_review_week(text, date) to anon, authenticated;

-- 확인 (두 줄 모두 true)
select 'hub_review_week' as what, exists (select 1 from pg_proc where proname = 'hub_review_week')::text as ok
union all select 'review_week_scores status', (pg_get_functiondef('public.review_week_scores(date)'::regprocedure) like '%submitted%')::text;
