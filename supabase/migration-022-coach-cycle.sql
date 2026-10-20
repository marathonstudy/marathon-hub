-- ============================================================
--  마라톤 코치룸 — 「오늘」을 반마다 수업 주기로 (migration-022-coach-cycle.sql)
--
--  실행 방법
--    021 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 표 · 기록은 바꾸지 않는다 (읽기 전용 함수 하나만 만든다).
--
--  coach_cycle(반 목록) — 「오늘」 반 카드가 부른다. 직원(조교 · 선생님)만. 학생 · 학부모 링크(anon)는 부를 수 없다.
--    화면이 반 일정(휴강 반영)으로 계산한 값을 반마다 넘긴다:
--      [{ "class": 반, "week": 지난 수업일이 든 주의 월요일, "from"/"to": 지금 주기, "pfrom"/"pto": 직전 주기 }]
--    돌려주는 것 (반마다, 그 반의 보관하지 않은 학생만):
--      · 그 주 레포트 공개 · 발송 여부
--      · 그 주 복습테스트 — 실제로 만들어진 시험만 (꺼 둔 주 · 없는 주는 null), 시험 수업일(= 마감일), 학생별 제출 여부
--      · 지금 주기 · 직전 주기의 필기 사진 수 (숨긴 사진 제외)
--    상담 · 성적 · 금액은 넣지 않는다.
-- ============================================================


create or replace function public.coach_cycle(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  res jsonb := '[]'::jsonb;
  c jsonb;
  cls text;
  wk date; f date; t date; pf date; pt date;
  test record;
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
      continue;                                     /* 날짜가 이상한 줄은 건너뛴다 */
    end;
    if cls = '' or wk is null then continue; end if;

    select id, round_no, lesson_date, q_count into test
    from public.review_tests where class_name = cls and week_start = wk and not off limit 1;

    res := res || jsonb_build_object(
      'class', cls,
      'week', wk,
      'test', case when test.id is null then null
                   else jsonb_build_object('round_no', test.round_no, 'lesson_date', test.lesson_date, 'q_count', test.q_count) end,
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'published', exists (select 1 from public.published x where x.student_id = s.id and public._monday(x.week_start) = wk and x.visible),
          'sent', exists (select 1 from public.sent x where x.student_id = s.id and public._monday(x.week_start) = wk),
          'submitted', case when test.id is null then null
                            else exists (select 1 from public.review_submissions r where r.test_id = test.id and r.student_id = s.id) end,
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
select 'coach_cycle' as what, exists (select 1 from pg_proc where proname = 'coach_cycle')::text as ok
union all select 'anon blocked', (not has_function_privilege('anon', 'public.coach_cycle(jsonb)', 'execute'))::text;
