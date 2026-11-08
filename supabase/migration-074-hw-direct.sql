-- ============================================================
--  migration-074-hw-direct.sql — 과제 칸 누르면 바로 상태 바꾸기 · 사유는 골라도 되고 안 골라도 된다 (20261108f)
--  (074 는 073 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  예전(038): 과제를 고칠 때 사유를 꼭 골라야 했다 (hw_fixes_reason — 1~200자)
--  이제: 과제 칸 메뉴의 [○ 제출] [△ 늦게 제출] [✕ 미제출] [면제]를 누르면 바로 저장 · 사유는 나중에 골라도 되고 비워도 된다 (0~200자)
--    사유를 고르면 같은 상태로 한 줄 더 남긴다 (그 학생 · 그 날짜의 마지막 줄이 지금 값 · 기록은 지우지 않는다)
--  수동 값은 앱 자동 갱신(app-sync · app_records)이 덮어쓰지 않는다 — 앱 기록과 따로 둔다 (038 · 065 그대로)
--  고친 사람 · 시각은 서버가 채운다 (038 의 트리거 그대로) · 운영진(조교 포함)이 바꿀 수 있다 (038 의 권한 그대로)
-- ============================================================

alter table public.hw_fixes drop constraint if exists hw_fixes_reason;
alter table public.hw_fixes add constraint hw_fixes_reason check (status = 'app' or char_length(btrim(reason)) <= 200);


-- ============================================================
--  확인 — true
-- ============================================================
select '사유 없이 저장' as what,
       (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'hw_fixes_reason') !~ 'between 1' as ok;
