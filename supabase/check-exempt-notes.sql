-- ============================================================
--  마라톤 코치룸 — 지난 3일 「면제」로 바꾸고 사유를 적은 과제 칸 (check-exempt-notes.sql · 20261101r · 읽기 전용)
--
--  조교가 미제출 상담을 기록하려다 과제 칸을 「면제」로 바꾸고 사유 칸에 상담 내용을 적은 일이 있었다.
--  지난 3일(한국 시각) 안에 운영진이 「면제」로 바꾼 칸 중 지금도 면제인 칸을 보여 준다 — 아무것도 바꾸지 않는다.
--  되돌리려면 이 결과의 id 를 보고 fix-exempt-to-notes.sql 맨 위 목록에 넣어 실행한다.
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣고 Run
-- ============================================================

select f.id,
       s.name                              as 학생,
       s.class_name                        as 반,
       to_char(f.day, 'MM/DD(dy)')         as 과제날짜,
       f.fixed_name                        as 바꾼사람,
       to_char(f.fixed_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as 바꾼시각,
       f.reason                            as 사유,
       coalesce(nullif(f.app_status, ''), '?') as 원래앱값,
       coalesce((select p.status from public.hw_fixes p
                  where p.student_id = f.student_id and p.day = f.day and p.id < f.id
                  order by p.id desc limit 1), '(없음 — 앱 값)') as 그전수정
  from public.hw_fixes f
  join public.students s on s.id = f.student_id
 where f.status = 'exempt'
   and f.fixed_at >= now() - interval '3 days'
   and btrim(f.reason) <> ''
   and f.fixed_by <> ''
   /* 지금도 면제 — 그 학생 · 그 날짜의 마지막 줄 */
   and f.id = (select max(l.id) from public.hw_fixes l where l.student_id = f.student_id and l.day = f.day)
 order by f.fixed_at desc;
