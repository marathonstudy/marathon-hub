-- ============================================================
--  migration-078-badge-box.sql — 배지 모음 「🏅 내 루틴 배지」 (20261108j)
--  (078 은 077 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  러닝노트(학생 · 학부모) 레포트 탭 위쪽 「🏅 내 루틴 배지」 — hub_badges(코드) · 그 학생 것만
--    월간 배지 — 원장이 [보내기]를 눌러 실제로 선정된 달만 (routine_awards.sent_at) · 누르면 그달 우수자 화면
--    주간 퍼펙트 — hw_weeks (075) · 최근 주들(과제가 있던 주만) · 받은 주 금별 · 못 받은 주 빈 별 · 그 주 날짜와 과제 수
--    지금 달 우수자 — 지난달 우수자로 보냈으면 이번 달 내내 레포트 탭 맨 위 「🏅 10월 루틴 우수자」
--  코치룸 — 학생 상세 배지 줄(staff_badges) · 반 카드 이름 옆 ⭐n (staff_badge_counts · 운영진만)
--  다른 학생의 배지 · 이름 · 인원은 넣지 않는다
-- ============================================================

create or replace function public._badge_box(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'perfect', public._badge_count(p_student),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', x.week_start, 'from', x.lesson_day - 7, 'to', x.lesson_day - 1, 'lesson', x.lesson_day,
                                                           'total', x.total, 'done', x.done, 'perfect', x.perfect) order by x.week_start)
                         from (select * from public.hw_weeks w where w.student_id = p_student and w.total > 0 order by w.week_start desc limit 12) x), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(to_char(a.month, 'YYYY-MM') order by a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null), '[]'::jsonb),
    'first', coalesce(least((select min(w.week_start) from public.hw_weeks w where w.student_id = p_student),
                            (select min(a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null))::text, ''),
    'cur', (select to_char(a.month, 'YYYY-MM') from public.routine_awards a
             where a.student_id = p_student and a.sent_at is not null and a.month = public._award_prev(now())));
$$;
revoke all on function public._badge_box(uuid) from public, anon, authenticated;

/* 러닝노트 — 그 학생 링크로만 */
create or replace function public.hub_badges(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  return public._badge_box(s.id);
end;
$$;
revoke all on function public.hub_badges(text) from public;
grant execute on function public.hub_badges(text) to anon, authenticated;

/* 코치룸 학생 상세 */
create or replace function public.staff_badges(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._badge_box(p_student);
end;
$$;
revoke all on function public.staff_badges(uuid) from public, anon;
grant execute on function public.staff_badges(uuid) to authenticated;

/* 코치룸 반 카드 — 학생마다 퍼펙트 수 · 루틴 배지 수 { 학생: { p, m } } (있는 학생만) */
create or replace function public.staff_badge_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(x.sid, jsonb_build_object('p', x.p, 'm', x.m))
      from (select s.id::text sid,
                   (select count(*) from public.hw_weeks w where w.student_id = s.id and w.perfect) p,
                   (select count(*) from public.routine_awards a where a.student_id = s.id and a.sent_at is not null) m
              from public.students s where not s.archived) x
     where x.p > 0 or x.m > 0), '{}'::jsonb);
end;
$$;
revoke all on function public.staff_badge_counts() from public, anon;
grant execute on function public.staff_badge_counts() to authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '러닝노트 배지 모음' as what, (to_regprocedure('public.hub_badges(text)') is not null)::text as ok
union all select '코치룸 배지 줄 · 반 카드', (to_regprocedure('public.staff_badges(uuid)') is not null and to_regprocedure('public.staff_badge_counts()') is not null)::text
union all select '077 먼저 (routine_awards)', (to_regclass('public.routine_awards') is not null)::text;
