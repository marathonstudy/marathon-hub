-- ============================================================
--  migration-103-hub-mogo-all.sql — 러닝노트 모의고사 탭이 비던 문제 (20261110m)
--  (103 은 102 다음 · 089 가 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  원인 — hub_mogo(089)가 「완성된 레포트(done = true)」만 줬다.
--    모고 사이트는 학생이 레포트를 열어야 AI 레포트 작성이 이어지는 구조라(연동약속.md: done=false 면 열면 작성이 이어짐)
--    아직 아무도 안 연 레포트는 done=false 로 남는다 → 러닝노트에는 0개 · 코치룸 학생 카드는 완성 여부와 상관없이 점수로 셈
--  고침 — 연결된(state ok) 학생의 레포트를 모두 준다 (코치룸과 같은 수) · 완성 여부는 done 으로 넘겨 화면이 「작성 중 · 열면 이어서 만들어져요」
--  (연결이 「확인 필요」(check) · 「학생 없음」인 학생은 예전처럼 안 줌 — 다른 학생 기록일 수 있어서)
-- ============================================================

create or replace function public.hub_mogo(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; m public.mogo_records;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  select * into m from public.mogo_records where student_id = s.id and state = 'ok';
  if not found then return jsonb_build_object('reports', '[]'::jsonb); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'examName', x ->> 'examName', 'date', x ->> 'date',
                                                             'score', x -> 'score', 'grade', x -> 'grade', 'attempt', x -> 'attempt', 'firstAttempt', x -> 'firstAttempt',
                                                             'done', coalesce((x ->> 'done')::boolean, false))
                                          order by x ->> 'date' desc)
                           from jsonb_array_elements(case when jsonb_typeof(m.reports) = 'array' then m.reports else '[]'::jsonb end) x
                          where coalesce(x ->> 'id', '') <> ''), '[]'::jsonb),
    'notebookUrl', nullif(m.extra ->> 'notebookUrl', ''), 'analysisUrl', nullif(m.extra ->> 'analysisUrl', ''));
end;
$$;
revoke all on function public.hub_mogo(text) from public;
grant execute on function public.hub_mogo(text) to anon, authenticated;


-- ============================================================
--  확인 — 코치룸(학생 카드)에 보이는 모고 수 = 러닝노트(학부모 링크 · 학생 링크)에 보이는 모고 수 (연결된 재원 학생 · 이름은 이 화면에만)
-- ============================================================
select s.name as "학생(화면만)", s.class_name as "반", m.state as "연결",
       (select count(*) from jsonb_array_elements(case when jsonb_typeof(m.reports) = 'array' then m.reports else '[]'::jsonb end) x
         where jsonb_typeof(x -> 'score') = 'number' and coalesce(x ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$') as "코치룸 점수 있는 회",
       (select count(*) from jsonb_array_elements(case when jsonb_typeof(m.reports) = 'array' then m.reports else '[]'::jsonb end) x
         where jsonb_typeof(x -> 'score') = 'number' and coalesce(x ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(x ->> 'id', '') <> '') as "러닝노트에 보일 회(같은 기준)",
       jsonb_array_length(coalesce(public.hub_mogo(l.hub_code) -> 'reports', '[]'::jsonb)) as "학부모 링크 실제",
       jsonb_array_length(coalesce(public.hub_mogo(l.student_code) -> 'reports', '[]'::jsonb)) as "학생 링크 실제",
       (select count(*) from jsonb_array_elements(case when jsonb_typeof(m.reports) = 'array' then m.reports else '[]'::jsonb end) x where (x ->> 'done')::boolean is true) as "그중 완성"
  from public.mogo_records m join public.students s on s.id = m.student_id and not s.archived
  left join public.student_links l on l.student_id = s.id
 where m.state = 'ok'
 order by s.class_name, s.name;
