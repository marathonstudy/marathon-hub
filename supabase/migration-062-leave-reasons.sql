-- ============================================================
--  마라톤 코치룸 — 퇴원 사유 (migration-062-leave-reasons.sql · 20261101s)
--
--  실행 방법
--    061 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 퇴원일(students.left_on)은 바꾸지 않는다. 새 키는 없다. 함수 배포도 없다.
--
--  1. 상담 기록 분류에 「퇴원」 · 「재등록」 추가
--  2. student_notes.leave_on (그 퇴원의 마지막 수업일) · leave_reasons (일정 · 다른 학원 · 성적 · 거리·이사 · 비용 · 개인 사정 · 기타 중 하나 이상)
--     상담 카드 [퇴원 처리] 저장 → 「퇴원 · 마지막 수업 11/14 · 사유: 일정, 다른 학원 · 메모」 (처리한 사람 · 날짜는 기존 기록처럼 서버가 채움)
--     [다시 다니는 중으로] → 「재등록 · 11/20」
--  사유 · 메모는 상담 기록(student_notes)이라 운영진만 읽는다 — 학생 · 학부모 화면 · 문자는 student_notes 를 읽지 않는다 (그대로)
-- ============================================================

alter table public.student_notes drop constraint if exists student_notes_cat_check;
alter table public.student_notes add constraint student_notes_cat_check
  check (categories <@ array['상담', '과제 독려', '학습 상담', '학부모 연락', '집중', '정서·컨디션', '출결', '학습', '기타', '과제', '걱정 문자', '퇴원', '재등록']::text[]);

alter table public.student_notes add column if not exists leave_on date;
alter table public.student_notes add column if not exists leave_reasons text[] not null default '{}';
alter table public.student_notes drop constraint if exists student_notes_leave_reasons_check;
alter table public.student_notes add constraint student_notes_leave_reasons_check
  check (leave_reasons <@ array['일정', '다른 학원', '성적', '거리·이사', '비용', '개인 사정', '기타']::text[]);
/* 「퇴원」 기록은 사유를 하나 이상 */
alter table public.student_notes drop constraint if exists student_notes_leave_need_reason;
alter table public.student_notes add constraint student_notes_leave_need_reason
  check (not ('퇴원' = any(categories)) or (leave_on is not null and cardinality(leave_reasons) > 0));
create index if not exists student_notes_leave_idx on public.student_notes (leave_on) where leave_on is not null and deleted_at is null;


-- ============================================================
--  확인 — 세 줄 true
-- ============================================================
select '분류 퇴원 · 재등록' as what, (position('재등록' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notes_cat_check')) > 0)::text as ok
union all select '퇴원 사유 칸', exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'leave_reasons')::text
union all select '직원만 읽음', (not has_table_privilege('anon', 'public.student_notes', 'select') or not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text;
