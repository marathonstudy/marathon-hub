-- ============================================================
--  migration-101-king-scores.sql — 학생마다 주별 「오답정리 · 지문 장악」 점수 남기기 (20261110l · 학습 분석)
--  (101 은 100 다음 · 099 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 king-pick 다시 배포)
--
--  새로 모으는 것은 없다 — king-pick 이 반마다 이미 매기는 점수(학생마다 오답정리 · 지문 장악 0~100)를
--  지금은 1~3위만 king_weeks 에 남기므로, 그 계산 결과를 학생마다 숫자만 남긴다 (근거 문장 · 사진 주소 없음)
--  1. king_scores — 학생 · 수업일 · 종류(wrong · text) · 점수 · 반 (직원 · 서버만 읽음)
--     이미 있는 king_weeks 후보(1~3위) 점수는 한 번 옮긴다
--  2. 서버(king-pick)만 — king_scores_save(반 · 수업일 · [{ sid, wrong, text }])
--  3. 러닝노트 — hub_scores(그 학생 링크로만 · 그 학생 것만 · 숫자만) · 코치룸 — staff_scores(학생)
--  다른 학생 점수 · 순위 · AI 근거는 어디에도 주지 않는다 · 문자 · 알림톡 없음
-- ============================================================

create table if not exists public.king_scores (
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_day  date not null,
  kind        text not null,
  score       integer not null,
  class_name  text not null default '',
  calc_at     timestamptz not null default now(),
  primary key (student_id, lesson_day, kind),
  constraint king_scores_kind check (kind in ('wrong', 'text')),
  constraint king_scores_score check (score between 0 and 100)
);
alter table public.king_scores enable row level security;
drop policy if exists king_scores_staff_read on public.king_scores;
create policy king_scores_staff_read on public.king_scores for select to authenticated using (public.is_staff());
revoke all on public.king_scores from anon;

/* 이미 있는 후보 점수 한 번 옮기기 (있으면 그대로) */
insert into public.king_scores (student_id, lesson_day, kind, score, class_name, calc_at)
select (x ->> 'sid')::uuid, k.lesson_day, k.kind, least(100, greatest(0, (x ->> 'score')::int)), k.class_name, k.calc_at
  from public.king_weeks k, jsonb_array_elements(k.candidates) x
 where coalesce(x ->> 'sid', '') ~ '^[0-9a-f-]{36}$' and coalesce(x ->> 'score', '') ~ '^\d+$'
   and exists (select 1 from public.students s where s.id = (x ->> 'sid')::uuid)
on conflict (student_id, lesson_day, kind) do nothing;

/* 서버(king-pick) — 반 하나 · 수업일 하나의 모든 학생 점수 */
create or replace function public.king_scores_save(p_class text, p_lesson date, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; x jsonb; k text; v int;
begin
  if p_lesson is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    if coalesce(x ->> 'sid', '') !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.students s where s.id = (x ->> 'sid')::uuid) then continue; end if;
    foreach k in array array['wrong', 'text'] loop
      if coalesce(x ->> k, '') ~ '^\d+$' then
        v := least(100, greatest(0, (x ->> k)::int));
        insert into public.king_scores (student_id, lesson_day, kind, score, class_name, calc_at)
        values ((x ->> 'sid')::uuid, p_lesson, k, v, coalesce(p_class, ''), now())
        on conflict (student_id, lesson_day, kind) do update set score = excluded.score, class_name = excluded.class_name, calc_at = now();
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.king_scores_save(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.king_scores_save(text, date, jsonb) to service_role;

/* 러닝노트 — 그 학생 링크로만 · 그 학생 것만 · 숫자만 [{ d(수업일), k(wrong|text), s }] */
create or replace function public.hub_scores(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('d', x.lesson_day, 'k', x.kind, 's', x.score) order by x.lesson_day, x.kind)
                     from public.king_scores x where x.student_id = s.id and x.lesson_day > current_date - 400), '[]'::jsonb);
end;
$$;
revoke all on function public.hub_scores(text) from public;
grant execute on function public.hub_scores(text) to anon, authenticated, service_role;

/* 코치룸 — 학생 한 명 (직원만) */
create or replace function public.staff_scores(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('d', x.lesson_day, 'k', x.kind, 's', x.score) order by x.lesson_day, x.kind)
      from public.king_scores x where x.student_id = p_student and x.lesson_day > current_date - 400), '[]'::jsonb) end;
$$;
revoke all on function public.staff_scores(uuid) from public, anon;
grant execute on function public.staff_scores(uuid) to authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '학생별 점수 표(king_scores)' as what, (to_regclass('public.king_scores') is not null)::text as ok
union all select '러닝노트 — 그 학생 것만(hub_scores)', (to_regprocedure('public.hub_scores(text)') is not null)::text
union all select '서버만 저장(king_scores_save)', (not has_function_privilege('anon', 'public.king_scores_save(text, date, jsonb)', 'execute'))::text
union all select '지금 남은 점수 ' || (select count(*) from public.king_scores) || '개', 'true';
