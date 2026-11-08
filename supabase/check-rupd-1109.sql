-- ============================================================
--  check-rupd-1109.sql — 11/9 00:00 무렵 반포반 11/8 레포트에 수업 자료를 넣었는데 업데이트 문자 띠가 안 뜬 이유 (읽기만 · 20261109a)
--
--  실행 방법 — Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여 넣는다.
--    SQL Editor 는 맨 마지막 표 하나만 보여 준다 → ① ~ ⑦ 을 하나씩 마우스로 골라(드래그) [Run] (고른 부분만 돈다).
--    아무것도 바꾸지 않는다 (select 만). 학생 이름은 보이지만 번호는 없다.
--  날 · 반을 바꾸려면 각 표 맨 위 params 의 값만 고친다.
--
--  띠가 뜨려면 — (가) 자료가 「11/8 레포트의 주」에 들어가야 하고 (나) 그 주에 「보냄」 표시(sent)가 있는 학생이 있어야 하고
--                (다) 서버 기록(report_upd_ev)이 「wait」로 남아 있어야 하고 (라) 같은 내용을 직접 보낸 문자가 없어야 한다
--  밤 10시 ~ 아침 8시 · 하루 한 번 규칙은 띠를 숨기지 않는다 — 띠에 「08:00에 업데이트 문자가 나가요」처럼 늦춰진 시각만 보인다
--
--  ① 반포반 레포트 주 · 공개 · 보냄 — 11/8 레포트가 어느 주(week_start)인지 · 그 주 보냄 표시 학생 수
--  ② 반포반 수업 자료 — 최근 3주 · 어느 주에 들어갔나 · 올린 시각(한국) · 올린 사람
--  ③ 자료를 넣었을 때 서버가 남긴 기록 — 주 · 종류 · 상태(wait 대기 / sent 보냄 / skip 안 보내기 / none 항목 없음 / off 꺼짐) · 학생 수 · 시각
--  ④ 지금 대기 중인 업데이트 문자 — 반포반 학생마다 · 나갈 시각(한국) · 항목 (비어 있으면 띠가 안 뜬다)
--  ⑤ 같은 내용을 직접 보낸 문자 (자료 · 코멘트 · 영상) — 있으면 그 항목은 업데이트 문자에서 빠진다
--  ⑥ 11/8 · 11/9 에 이미 나간 업데이트 문자 — 하루 한 번 규칙
--  ⑦ 반 설정 · 설치 — 자동 발송 켜짐 · 기다리는 시간 · 자료 트리거 · 085 함수
-- ============================================================

-- ① 레포트 주 · 공개 · 보냄
with params as (select date '2026-11-08' as d, '반포' as cls)
select p.week_start as "레포트 주", left(coalesce(p.report_data ->> 'lessonDate', ''), 10) as "수업일",
       count(*) as "공개 학생", count(t.student_id) as "보냄 표시 학생",
       to_char(max(t.sent_at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "마지막 보냄"
  from public.published p join public.students s on s.id = p.student_id
  left join public.sent t on t.week_start = p.week_start and t.student_id = p.student_id, params x
 where s.class_name like '%' || x.cls || '%' and p.week_start between x.d - 14 and x.d + 7
 group by 1, 2 order by 1;

-- ② 수업 자료 (최근 3주)
with params as (select date '2026-11-08' as d, '반포' as cls)
select f.class_name as "반", f.week_start as "주", f.name as "자료", f.kind as "종류",
       to_char(f.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "올린 시각", f.created_name as "올린 사람"
  from public.class_files f, params x
 where f.class_name like '%' || x.cls || '%' and f.week_start between x.d - 14 and x.d + 7
 order by f.created_at desc;

-- ③ 서버 기록 (11/7 ~ 지금)
with params as (select date '2026-11-07' as d, '반포' as cls)
select e.week_start as "주", e.kind as "종류(file 자료 · video 영상 · report 다시 공개)", e.op as "넣음/지움", e.state as "상태",
       count(distinct e.student_id) as "학생 수",
       to_char(min(e.at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "처음", to_char(max(e.at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "마지막",
       to_char(max(e.done_at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "처리"
  from public.report_upd_ev e, params x
 where e.class_name like '%' || x.cls || '%' and e.at >= x.d
 group by 1, 2, 3, 4 order by min(e.at);

-- ④ 지금 대기 중 — 나갈 시각 · 항목 (항목이 비면 띠가 안 뜨고 보내지도 않는다)
with params as (select '반포' as cls)
select e.week_start as "주", s.name as "학생",
       to_char(public._upd_due(max(e.at), e.week_start, e.student_id, bool_or(e.force)) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "나갈 시각(한국)",
       array_to_string(public._upd_items(e.week_start, e.student_id), ', ') as "항목(비면 안 나감)"
  from public.report_upd_ev e join public.students s on s.id = e.student_id, params x
 where e.state = 'wait' and e.class_name like '%' || x.cls || '%'
 group by e.week_start, e.student_id, s.name order by s.name;

-- ⑤ 같은 내용을 직접 보낸 문자 (11/8 ~)
with params as (select date '2026-11-08' as d, '반포' as cls)
select to_char(l.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "시각", b.label as "문구 이름", b.purpose as "목적",
       coalesce((select st.name from public.staff st where lower(st.email) = lower(b.created_by) limit 1), b.created_by) as "보낸 사람",
       count(*) as "통", left(b.body, 40) as "글 앞부분"
  from public.sms_log l join public.sms_batches b on b.id = l.batch_id, params x
 where l.class_name like '%' || x.cls || '%' and l.created_at >= x.d and not l.test
   and coalesce(b.created_by, '') <> '자동' and coalesce(b.purpose, '') not in ('rupd', 'report', 'pre', 'note', 'award', 'nudge', 'praise', 'worry', 'entry', 'welcome', 'app')
   and (coalesce(b.label, '') like '%자료%' or coalesce(b.label, '') like '%영상%' or coalesce(b.label, '') like '%코멘트%' or b.purpose in ('notify', 'video') or coalesce(b.body, '') like '%자료%')
 group by 1, 2, 3, 4, 6 order by 1;

-- ⑥ 이미 나간 업데이트 문자 (11/8 · 11/9)
with params as (select date '2026-11-08' as d, '반포' as cls)
select g.day as "날", g.week_start as "주", count(*) as "학생 수", bool_or(g.manual) as "지금 보내기로",
       to_char(min(g.at) at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as "시각", array_to_string(max(g.items), ', ') as "항목"
  from public.report_upd_log g join public.students s on s.id = g.student_id, params x
 where s.class_name like '%' || x.cls || '%' and g.day between x.d and x.d + 1
 group by 1, 2 order by 1;

-- ⑦ 반 설정 · 설치
with params as (select '반포' as cls)
select c.name as "반", coalesce(c.upd_auto, true) as "업데이트 문자 자동 발송",
       (select public._upd_wait()) as "기다리는 시간(분)",
       exists (select 1 from pg_trigger where tgname = 'class_files_upd') as "자료 기록 트리거(073)",
       exists (select 1 from pg_proc where proname = '_upd_manual') as "085 설치"
  from public.classes c, params x where c.name like '%' || x.cls || '%';
