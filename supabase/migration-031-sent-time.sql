-- ============================================================
--  마라톤 코치룸 — 「오늘」 반 카드에 레포트 보낸 시각 (migration-031-sent-time.sql)
--
--  실행 방법
--    030 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 · 기록은 바꾸지 않는다 (읽기 전용 함수 coach_cycle 하나를 바꿔 쓴다).
--
--  coach_cycle — 학생마다 sent_at(그 주 레포트를 마지막으로 보낸 시각)을 더한다 (나머지는 028 과 같다).
--  「오늘」 반 카드가 「10/22 레포트 발송 완료 11/11 · 18:09」처럼 보낸 시각을 보여 준다. 031 전에는 시각 없이 보인다.
-- ============================================================


create or replace function public.coach_cycle(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  res jsonb := '[]'::jsonb;
  c jsonb;
  cls text;
  wk date; f date; t date; pf date; pt date;
  tests jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception '반 목록 모양이 올바르지 않습니다.'; end if;
  if jsonb_array_length(p) > 200 then raise exception '반이 너무 많습니다.'; end if;

  for c in select * from jsonb_array_elements(p) loop
    cls := btrim(coalesce(c ->> 'class', ''));
    begin
      wk := public._monday((c ->> 'week')::date);
      f := (c ->> 'from')::date;  t := (c ->> 'to')::date;
      pf := (c ->> 'pfrom')::date; pt := (c ->> 'pto')::date;
    exception when others then
      continue;
    end;
    if cls = '' or wk is null then continue; end if;

    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'test_name', x.test_name, 'round_no', x.round_no, 'lesson_date', x.lesson_date,
                                                 'q_count', x.q_count, 'label', public._review_label(x.lesson_date, x.test_name)) order by x.sort_no, x.test_name), '[]'::jsonb)
      into tests from public._review_ensure_all(cls, wk) x where not x.off;   -- 아직 아무도 안 연 주도 시험을 만들어 센다

    res := res || jsonb_build_object(
      'class', cls,
      'week', wk,
      'tests', tests,
      'test', case when jsonb_array_length(tests) = 0 then null else tests -> 0 end,
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'published', exists (select 1 from public.published x where x.student_id = s.id and public._monday(x.week_start) = wk and x.visible),
          'sent', exists (select 1 from public.sent x where x.student_id = s.id and public._monday(x.week_start) = wk),
          'sent_at', (select max(x.sent_at) from public.sent x where x.student_id = s.id and public._monday(x.week_start) = wk),
          'missing', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)
                         and not exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)),
          'absent', (select coalesce(jsonb_agg(tt ->> 'test_name'), '[]'::jsonb) from jsonb_array_elements(tests) tt
                       where exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)),
          'submitted', case when jsonb_array_length(tests) = 0 then null
                            else not exists (select 1 from jsonb_array_elements(tests) tt
                                              where not exists (select 1 from public.review_submissions r where r.test_id = (tt ->> 'id')::uuid and r.student_id = s.id)
                                                and not exists (select 1 from public.review_absences a where a.test_id = (tt ->> 'id')::uuid and a.student_id = s.id)) end,
          'photos_cur', case when f is null or t is null then 0 else
                          (select count(*)::int from public.note_photos n where n.student_id = s.id and n.hidden_at is null and n.lesson_date between f and t) end,
          'photos_prev', case when pf is null or pt is null then 0 else
                          (select count(*)::int from public.note_photos n where n.student_id = s.id and n.hidden_at is null and n.lesson_date between pf and pt) end
        ))
        from public.students s where s.class_name = cls and not s.archived
      ), '[]'::jsonb)
    );
  end loop;
  return jsonb_build_object('ok', true, 'classes', res);
end;
$$;


revoke all on function public.coach_cycle(jsonb) from public, anon;
grant execute on function public.coach_cycle(jsonb) to authenticated;


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select 'coach_cycle sent_at' as what, (pg_get_functiondef('public.coach_cycle(jsonb)'::regprocedure) like '%sent_at%')::text as ok
union all select 'anon blocked', (not has_function_privilege('anon', 'public.coach_cycle(jsonb)', 'execute'))::text;
