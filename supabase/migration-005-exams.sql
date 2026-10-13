-- ============================================================
--  마라톤국어 허브 — 주요 시험 D-day (migration-005-exams.sql)
--
--  실행 방법
--    004 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 새 표는 만들지 않는다.
--
--  시험 목록은 app_settings 표의 'exams' 한 줄에 있다 (생성기 [시험 관리] 에서 고친다).
--    { "exams":   [{ "id", "name", "date":"YYYY-MM-DD", "memo" }],
--      "mode":    "auto" | "fixed",      전체 기본 — 가장 가까운 시험 자동 / 특정 시험 고정
--      "fixedId": "…",
--      "byClass": { "반이름": "시험 id" } }   반별로 띄울 시험 (없으면 전체 기본)
--
--  공개 함수 hub_get(개인 페이지) · class_notice_get(반 공지 페이지) 에
--  그 반 기준 시험 하나의 { name, date } 만 더한다. 메모 · 다른 반 설정 · 다른 시험은 돌려주지 않는다.
--  나머지 응답은 schema.sql 과 똑같다.
-- ============================================================


/* 그 반에 띄울 시험 하나 (한국 날짜 기준 오늘 이후).
   고른 시험(반별 → 전체 고정)이 지났거나 없으면 가장 가까운 다음 시험.
   다가오는 시험이 하나도 없으면 null. */
create or replace function public._exam_for_class(p_class text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
  pick text;
  hit jsonb;
begin
  select value into cfg from public.app_settings where key = 'exams';
  if cfg is null then return null; end if;

  pick := nullif(cfg -> 'byClass' ->> coalesce(p_class, ''), '');
  if pick is null and cfg ->> 'mode' = 'fixed' then pick := nullif(cfg ->> 'fixedId', ''); end if;

  if pick is not null then
    select e into hit
    from jsonb_array_elements(coalesce(cfg -> 'exams', '[]'::jsonb)) e
    where e ->> 'id' = pick
      and (e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and (e ->> 'date')::date >= today
    limit 1;
  end if;

  if hit is null then
    select e into hit
    from jsonb_array_elements(coalesce(cfg -> 'exams', '[]'::jsonb)) e
    where (e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and (e ->> 'date')::date >= today
      and btrim(coalesce(e ->> 'name', '')) <> ''
    order by (e ->> 'date')::date, e ->> 'name'
    limit 1;
  end if;

  if hit is null then return null; end if;
  return jsonb_build_object('name', hit ->> 'name', 'date', hit ->> 'date');
end;
$$;

revoke all on function public._exam_for_class(text) from public, anon, authenticated;


/* 개인 페이지 /me/#코드 — schema.sql 의 hub_get 에 'exam' 하나만 더했다 */
create or replace function public.hub_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public._hub_student(p_code);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if s.archived then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'name', s.name, 'school', s.school, 'grade', s.grade, 'class_name', s.class_name
    ),
    'notices', public._notices_of(s.class_name),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week_start',   p.week_start,
               'week_end',     coalesce(p.report_data ->> 'endDate', ''),
               'published_at', p.published_at
             ) order by p.week_start desc)
      from public.published p
      where p.student_id = s.id and p.visible
    ), '[]'::jsonb),
    'app', jsonb_build_object(
      'linked', s.app_share_code <> '',
      'share_url', case when s.app_share_code <> ''
                        then 'https://marathonstudy.com/share/report/' || s.app_share_code
                        else '' end
    ),
    'exam', public._exam_for_class(s.class_name)
  );
end;
$$;

/* 반 공용 페이지 /notice/#반코드 — 공지 + 그 반 시험 하나. 학생 정보는 하나도 없다 */
create or replace function public.class_notice_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{16,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  select class_name into c from public.class_codes where code = p_code;
  if c is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_name', c,
    'notices', public._notices_of(c),
    'exam', public._exam_for_class(c)
  );
end;
$$;

revoke all on function public.hub_get(text)          from public;
revoke all on function public.class_notice_get(text) from public;
grant execute on function public.hub_get(text)          to anon, authenticated;
grant execute on function public.class_notice_get(text) to anon, authenticated;


-- ============================================================
--  확인 — 시험을 아직 안 넣었으면 null 이 나온다 (정상)
-- ============================================================
select public._exam_for_class('') as exam_for_all;
