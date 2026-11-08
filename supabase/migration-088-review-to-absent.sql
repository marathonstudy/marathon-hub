-- ============================================================
--  migration-088-review-to-absent.sql — 복습테스트 점수 칸: 점수가 있는 칸을 [미응시로 바꾸기] (20261108t)
--  (088 은 087 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  review_score_to_absent(시험, 학생, 사유, 메모) — 점수(제출 기록)를 지우고 미응시(사유)로
--    지운 점수는 기록(review_log 「score_to_absent」 · 문항 수 · 맞힌 개수 · 점수 · 누가 넣었는지)에 남는다 · 직원만
--    점수가 없으면 예전 review_absent_set 과 같다
--  (review_absent_set 은 점수가 있는 칸을 건너뛴다 — 그대로)
-- ============================================================

create or replace function public.review_score_to_absent(p_test uuid, p_student uuid, p_reason text, p_memo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rs text := btrim(coalesce(p_reason, ''));
  s public.review_submissions;
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if rs not in ('absent', 'late', 'counsel', 'replaced', 'other') then raise exception '미응시 사유를 골라 주세요.'; end if;
  select * into t from public.review_tests where id = p_test;
  if not found then raise exception '시험을 찾을 수 없습니다.'; end if;
  select * into s from public.review_submissions where test_id = p_test and student_id = p_student;
  if found then
    perform public._review_log('score_to_absent', s.id, p_student, t.class_name,
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'q_count', s.q_count, 'correct', s.correct, 'score', s.score, 'source', s.source),
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', rs));
    delete from public.review_submissions where id = s.id;
  end if;
  return public.review_absent_set(array[p_test], p_student, rs, p_memo) || jsonb_build_object('removed', s.id is not null);
end;
$$;
revoke all on function public.review_score_to_absent(uuid, uuid, text, text) from public, anon;
grant execute on function public.review_score_to_absent(uuid, uuid, text, text) to authenticated;

-- ============================================================
--  확인 — true
-- ============================================================
select '점수 칸 → 미응시로 바꾸기' as what, exists (select 1 from pg_proc where proname = 'review_score_to_absent')::text as ok;
