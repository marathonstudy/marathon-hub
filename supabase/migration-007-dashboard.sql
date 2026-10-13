-- ============================================================
--  마라톤 코치룸 — 「오늘」 총괄 화면 (migration-007-dashboard.sql)
--
--  실행 방법
--    002 ~ 006 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 새 표는 만들지 않는다 — 있는 자료를 모아 보여 주는 함수 하나와 설정 보호뿐.
--
--  설정 — app_settings 의 'dashboard' 한 줄 (없으면 아래 기본값)
--    { "assistantSeeMoney": true,   조교 계정에도 교재비 금액 보이기 (「오늘」 화면에만 적용)
--      "absentWeeks": 4,            챙겨야 할 학생 — 최근 몇 주 안에
--      "absentMin": 2 }             결석(보강 포함) 몇 회 이상
--    이 줄은 teacher 만 바꿀 수 있다 (아래 트리거).
-- ============================================================


/* 「오늘」 화면이 한 번에 받아 가는 것.
   staff 만. 조교 금액 숨김이 켜져 있으면 조교에게는 미납 금액을 아예 보내지 않는다(인원만). */
create or replace function public.coach_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  ws date;
  we date;
  cfg jsonb;
  money boolean;
  aw integer;
  amin integer;
  res jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;

  select value into cfg from public.app_settings where key = 'dashboard';
  cfg := coalesce(cfg, '{}'::jsonb);
  aw   := greatest(1, least(12, coalesce((cfg ->> 'absentWeeks')::int, 4)));
  amin := greatest(1, least(12, coalesce((cfg ->> 'absentMin')::int, 2)));
  money := public.is_teacher() or coalesce((cfg ->> 'assistantSeeMoney')::boolean, true);

  /* 이번 주 — 오늘이 기간 안에 드는 주차, 없으면 이번 주 월~일 */
  select week_start, week_end into ws, we from public.week_meta
  where week_start <= today and week_end >= today order by week_start desc limit 1;
  if ws is null then
    ws := today - (extract(isodow from today)::int - 1);
    we := ws + 6;
  end if;

  with st as (
    select s.id, s.name, s.class_name, coalesce(a.name, '') as academy,
           coalesce(l.hub_code, '') as code, coalesce(l.app_share_code, '') <> '' as app
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.tb_class_academy ca on ca.class_name = s.class_name
    left join public.tb_academies a on a.id = ca.academy_id
    where not s.archived
  ),
  per as (
    select st.*,
      (select e.attend_status from public.entries e where e.student_id = st.id and e.week_start = ws) as attend,
      (select count(*) from public.entries e
        where e.student_id = st.id and e.attend_status in ('absent', 'makeup')
          and e.week_start > ws - aw * 7 and e.week_start <= ws)::int as absent_n,
      exists (select 1 from public.published p where p.student_id = st.id and p.week_start = ws and p.visible) as published,
      exists (select 1 from public.sent x where x.student_id = st.id and x.week_start = ws) as sent,
      (select count(*) from public.note_photos ph where ph.student_id = st.id and ph.hidden_at is null
        and ph.lesson_date between ws and we)::int as photos_week,
      (select count(*) from public.note_photos ph where ph.student_id = st.id and ph.hidden_at is null
        and ph.lesson_date between ws - 7 and ws - 1)::int as photos_prev,
      (select count(*) from public.tb_bills b where b.student_id = st.id and b.status = 'unpaid' and b.total > 0)::int as unpaid_n,
      (select coalesce(sum(b.total), 0) from public.tb_bills b where b.student_id = st.id and b.status = 'unpaid' and b.total > 0)::int as unpaid_amt,
      (select count(*) from public.student_notes n where n.student_id = st.id
        and n.follow_up and n.followed_at is null and n.deleted_at is null)::int as follow_n
    from st
  ),
  stk as (select book_id, stock, min_stock from public.tb_stock()),
  sug as (select book_id, class_name from public.tb_order_suggest() where suggested > 0),
  low as (
    /* 반마다 재고 부족 교재 — 안전 재고 이하이거나 다음 수업에 모자라는 교재 */
    select cb.class_name, jsonb_agg(distinct b.name) as books
    from public.tb_class_books cb
    join public.tb_books b on b.id = cb.book_id and b.active
    join stk on stk.book_id = b.id
    where stk.stock <= stk.min_stock
       or exists (select 1 from sug where sug.book_id = b.id and sug.class_name = cb.class_name)
    group by cb.class_name
  )
  select jsonb_build_object(
    'week', jsonb_build_object('start', ws, 'end', we),
    'today', today,
    'settings', jsonb_build_object(
      'absentWeeks', aw, 'absentMin', amin,
      'assistantSeeMoney', coalesce((cfg ->> 'assistantSeeMoney')::boolean, true),
      'money', money),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'class_name', class_name, 'academy', academy,
        'code', code, 'app', app, 'attend', coalesce(attend, ''), 'absent_n', absent_n,
        'published', published, 'sent', sent, 'photos_week', photos_week, 'photos_prev', photos_prev,
        'unpaid_n', unpaid_n, 'unpaid_amt', case when money then unpaid_amt else null end,
        'follow_n', follow_n) order by academy, class_name, name) from per), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_object_agg(class_name, books) from low), '{}'::jsonb),
    /* ② 작성 탭과 같은 규칙(report.js)으로 '작성 완료' 를 세도록 그 주 입력을 함께 보낸다 */
    'entries', coalesce((select jsonb_agg(to_jsonb(e)) from public.entries e
                         where e.week_start = ws and e.student_id in (select id from st)), '[]'::jsonb),
    'commons', coalesce((select jsonb_agg(to_jsonb(c)) from public.week_common c where c.week_start = ws), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

revoke all on function public.coach_today() from public, anon;
grant execute on function public.coach_today() to authenticated;


/* 'dashboard' 설정은 teacher 만 바꾼다 (조교가 금액 숨김을 스스로 풀지 못하게) */
create or replace function public._dashboard_setting_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.key = 'dashboard') or (tg_op <> 'DELETE' and new.key = 'dashboard') then
    if not public.is_teacher() then
      raise exception '「오늘」 화면 설정은 선생님(teacher) 계정만 바꿀 수 있습니다.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists app_settings_dashboard_guard on public.app_settings;
create trigger app_settings_dashboard_guard before insert or update or delete on public.app_settings
  for each row execute function public._dashboard_setting_guard();


-- ============================================================
--  확인 — 오류 없이 끝나면 된다 (SQL Editor 는 staff 계정이 아니라 함수 결과는 볼 수 없다)
-- ============================================================
select 'coach_today' as ready, exists (select 1 from pg_proc where proname = 'coach_today') as ok;
