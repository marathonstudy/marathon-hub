-- ============================================================
--  migration-079-send-names.sql — 반 카드 발송 표시: 묶음마다 누가 들어갔는지 (20261108k)
--  (079 는 078 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  「오늘」 반 카드 「수업 전 문자 06:30 보냄 · 25명 (독려 15 · 칭찬 10)」 — 숫자를 누르면 그 묶음 이름 (운영진만)
--    pre_remind_status — 067 과 같고 names { miss: [이름…], all: [이름…] } 를 더함 (보낸 학생 · 가나다순)
--    칭찬(all)은 퍼펙트 배지 한 줄이 붙은 문자도 칭찬으로 센다 (075 · 같은 band)
--  「과제 현황 문자 09:00 보냄 · 운영진 1명 (번호 없음 2명 · 넣기)」 — hw_status_status 에 번호 없는 운영진 이름(nophoneNames)
-- ============================================================

create or replace function public.pre_remind_status(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(k.class_name, jsonb_build_object('at', k.at, 'n', k.n, 'missed', k.missed, 'failed', k.failed,
                                                             'all', k.b_all, 'part', k.b_part, 'low', k.b_low, 'none', k.b_none, 'miss', k.b_miss,
                                                             'names', jsonb_build_object('miss', k.n_miss, 'all', k.n_all)))
      from (select g.class_name,
                   to_char(min(g.created_at) filter (where g.log_id is not null) at time zone 'Asia/Seoul', 'HH24:MI') as at,
                   count(*) filter (where coalesce(g.ok, false)) as n,
                   count(*) filter (where coalesce(g.ok, false) and g.missed) as missed,
                   count(*) filter (where g.ok = false) as failed,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'all') as b_all,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'part') as b_part,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'low') as b_low,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'none') as b_none,
                   count(*) filter (where coalesce(g.ok, false) and g.band in ('miss', 'part', 'low')) as b_miss,
                   coalesce(jsonb_agg(s.name order by s.name collate "C") filter (where coalesce(g.ok, false) and g.band in ('miss', 'part', 'low')), '[]'::jsonb) as n_miss,
                   coalesce(jsonb_agg(s.name order by s.name collate "C") filter (where coalesce(g.ok, false) and g.band = 'all'), '[]'::jsonb) as n_all
              from public.pre_remind_log g left join public.students s on s.id = g.student_id
             where g.day = d group by g.class_name) k), '{}'::jsonb);
end;
$$;
revoke all on function public.pre_remind_status(date) from public, anon;
grant execute on function public.pre_remind_status(date) to authenticated;

create or replace function public.hw_status_status(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(g.class_name, jsonb_build_object(
             'at', to_char(g.created_at at time zone 'Asia/Seoul', 'HH24:MI'), 'manual', g.manual, 'by', g.by_name, 'low', g.low, 'students', g.students,
             'people', (select count(distinct l.name || l.phone_last4) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'ok'),
             'pending', (select count(*) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'pending'),
             'failed', (select count(distinct l.name) from public.sms_log l where l.batch_id = g.batch_id and l.status = 'fail' and l.error <> '번호 없음'),
             'nophone', (select count(*) from public.sms_log l where l.batch_id = g.batch_id and l.error = '번호 없음'),
             'nophoneNames', coalesce((select jsonb_agg(l.name order by l.name) from public.sms_log l where l.batch_id = g.batch_id and l.error = '번호 없음'), '[]'::jsonb)))
      from (select distinct on (x.class_name) x.* from public.hw_status_log x where x.day = d order by x.class_name, x.created_at desc) g), '{}'::jsonb);
end;
$$;
revoke all on function public.hw_status_status(date) from public, anon;
grant execute on function public.hw_status_status(date) to authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '수업 전 문자 묶음 이름' as what, (position('n_miss' in pg_get_functiondef('public.pre_remind_status(date)'::regprocedure)) > 0)::text as ok
union all select '번호 없는 운영진 이름', (position('nophoneNames' in pg_get_functiondef('public.hw_status_status(date)'::regprocedure)) > 0)::text;
