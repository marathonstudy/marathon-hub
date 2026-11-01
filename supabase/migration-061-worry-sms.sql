-- ============================================================
--  마라톤 코치룸 — 걱정 문자 · 과제 칸 상담 기록 (migration-061-worry-sms.sql · 20261101r)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 과제 · 문자 기록은 바꾸지 않는다. 새 키는 없다. 함수 배포도 없다.
--
--  1. 상담 기록 분류에 「과제」(과제 칸 → 상담 기록 남기기) · 「걱정 문자」(걱정 문자 보낸 기록) 추가
--  2. student_notes.hw_day — 과제 칸에서 남긴 상담 기록의 그 과제 날짜 (그 칸에 작은 점)
--     상담 기록은 직원만 읽는다 (학생 · 학부모 화면 · 문자는 student_notes 를 읽지 않는다 — 그대로)
--  걱정 문자는 기존 sms-send 로 보낸다 (목적 worry · 같은 날 보낸 표시는 sms_sent_today('worry'))
-- ============================================================

alter table public.student_notes drop constraint if exists student_notes_cat_check;
alter table public.student_notes add constraint student_notes_cat_check
  check (categories <@ array['상담', '과제 독려', '학습 상담', '학부모 연락', '집중', '정서·컨디션', '출결', '학습', '기타', '과제', '걱정 문자']::text[]);

alter table public.student_notes add column if not exists hw_day date;
create index if not exists student_notes_hw_day_idx on public.student_notes (student_id, hw_day) where hw_day is not null and deleted_at is null;


-- ============================================================
--  확인 — 두 줄 true
-- ============================================================
select '분류 과제 · 걱정 문자' as what, (position('걱정 문자' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notes_cat_check')) > 0)::text as ok
union all select '과제 칸 날짜', exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'hw_day')::text;
