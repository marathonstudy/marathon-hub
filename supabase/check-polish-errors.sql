-- ============================================================
--  check-polish-errors.sql — 읽기 전용 (20261106d)
--  「지금은 다듬기가 안 됩니다」가 왜 떴는지 — 최근 AI 호출의 실패 이유별 횟수 · 마지막 때
--  (아무것도 바꾸지 않는다 — select 만 · 글은 저장돼 있지 않다)
--  error 값: check numbers / check dow = 글 검사에서 거절 · auth-key = 키 · bad-request = 크레딧 · 요청 문제
--            connect = 연결 · 시간 초과(20261106d 전) · timeout · credit · rate-limit · overload · api 5xx (20261106d 뒤)
--  status = started 인 채 남은 줄은 함수가 끝나지 못한 것
-- ============================================================
select status, coalesce(nullif(error, ''), '-') as "이유", count(*) as "횟수", max(at) as "마지막"
  from public.polish_usage
 where at > now() - interval '14 days'
 group by 1, 2
 order by max(at) desc;
