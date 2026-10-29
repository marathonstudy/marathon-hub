-- ============================================================
--  마라톤 코치룸 — 「오늘」 학생 줄에서 바로 상담 적기 · 다음에 확인할 것 (migration-042-quick-note.sql)
--
--  실행 방법
--    041 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 지금까지 쓴 상담 · 관찰 기록은 그대로 둔다. 함수 배포는 없다.
--
--  1. student_notes.next_check — 「다음에 확인할 것」(한 줄 · 200자 · 비워도 됨)
--     「오늘」 · 레포트 발송 학생 줄의 [상담 +] 와 상담 카드가 같이 쓴다. 다음 상담 때 「지난번 약속」으로 보인다.
--  2. 분류 — 과제 독려 · 학습 상담 · 학부모 연락 을 더한다 (예전 분류 상담 · 집중 · 정서·컨디션 · 출결 · 학습 · 기타 도 그대로)
--  상담 · 관찰 기록은 예전처럼 직원만 읽는다 (student_notes 는 학생 · 학부모 화면 함수가 읽지 않는다).
-- ============================================================

alter table public.student_notes add column if not exists next_check text not null default '';

alter table public.student_notes drop constraint if exists student_notes_next_check_len;
alter table public.student_notes add constraint student_notes_next_check_len check (char_length(next_check) <= 200);

alter table public.student_notes drop constraint if exists student_notes_cat_check;
alter table public.student_notes add constraint student_notes_cat_check
  check (categories <@ array['상담', '과제 독려', '학습 상담', '학부모 연락', '집중', '정서·컨디션', '출결', '학습', '기타']::text[]);


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'next_check' as what, exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'next_check')::text as ok
union all select '분류 과제 독려', (position('과제 독려' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notes_cat_check')) > 0)::text
union all select '직원만 읽음', (not has_table_privilege('anon', 'public.student_notes', 'select') or not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text;
