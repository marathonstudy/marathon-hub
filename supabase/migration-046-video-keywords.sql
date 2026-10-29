-- ============================================================
--  마라톤 코치룸 — 수업 영상 카드에 「어떤 수업이었는지」 · 키워드 (migration-046-video-keywords.sql)
--
--  실행 방법
--    045 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 요약 · 영상은 바꾸지 않는다. 함수 배포는 없다 (키워드는 AI 없이 글에서 뽑는다).
--
--  1. lesson_summaries.keywords — 키워드 칩 3~5개. 수업 요약을 확정할 때 같이 만든다(트리거):
--       복습 노트 「다룬 지문」 우선 → 요약의 「작품명」 → 요약 줄의 말마디 (2~20자 · 겹치면 한 번)
--     이미 확정된 지난 요약은 이 SQL 이 한 번 채운다 · 코치룸 「키워드 다시 만들기」(summary_keywords_rebuild) · 칩 지우기 · 추가(summary_keywords_set)
--  2. 학생 · 학부모 화면 자료(_weekly_of)의 주마다 'keywords' — 수업 영상 탭 · 레포트 「이 수업 영상」 카드
--     (차시별 한 줄은 지금처럼 'lessons' = 확정된 수업 내용 요약)
-- ============================================================

alter table public.lesson_summaries add column if not exists keywords jsonb not null default '[]'::jsonb;

create or replace function public._kw_clean(t text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
           '[「」『』"“”‘’'']', '', 'g'),
           '^\s*(\d+\s*차시\s*[:：.]?|\d{2,4}\s*[.년]\s*\d{1,2}\s*월?|\d{2,4}\.\d{1,2})\s*', ''),
           '\s+', ' ', 'g'));
$$;

create or replace function public._summary_keywords(p_class text, p_week date, p_lines jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with cand as (
    select public._kw_clean(e #>> '{}') as k, 1 as pri, l.o * 100 + e2.o as o
      from public.review_notes r,
           jsonb_array_elements(coalesce(r.confirmed, r.draft, '{}'::jsonb) -> 'lessons') with ordinality l(x, o),
           jsonb_array_elements(case when jsonb_typeof(l.x -> 'passages') = 'array' then l.x -> 'passages' else '[]'::jsonb end) with ordinality e2(e, o)
     where r.class_name = btrim(coalesce(p_class, '')) and r.week_start = p_week
    union all
    select public._kw_clean(m[1]), 2, ln.o * 100 + row_number() over ()
      from jsonb_array_elements_text(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) with ordinality ln(t, o),
           regexp_matches(ln.t, '「([^」]{1,30})」', 'g') m
    union all
    select public._kw_clean(seg), 3, ln.o * 100 + sg.o
      from jsonb_array_elements_text(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) with ordinality ln(t, o),
           regexp_split_to_table(regexp_replace(ln.t, '^\s*\d+\s*차시\s*[:：.]?\s*', ''), '\s*(—|–|:|：|·|,|/|\(|\)|\s-\s)\s*') with ordinality sg(seg, o)
  ),
  ok as (
    select k, min(pri * 100000 + o) as rk from cand
     where char_length(k) between 2 and 20 and k !~ '^[0-9\s.~-]+$'
     group by k
  )
  select coalesce(jsonb_agg(k order by rk), '[]'::jsonb) from (select k, rk from ok order by rk limit 5) x;
$$;
revoke all on function public._kw_clean(text) from public, anon, authenticated;
revoke all on function public._summary_keywords(text, date, jsonb) from public, anon, authenticated;

/* 확정할 때 같이 — 확정본이 바뀌면 다시 만든다 (직원이 칩을 고친 뒤에는 확정본이 그대로면 그대로) */
create or replace function public._summary_kw_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmed is not null and (tg_op = 'INSERT' or new.confirmed is distinct from old.confirmed) then
    new.keywords := public._summary_keywords(new.class_name, new.week_start, new.confirmed);
  end if;
  return new;
end;
$$;
revoke all on function public._summary_kw_stamp() from public, anon, authenticated;
drop trigger if exists lesson_summaries_kw on public.lesson_summaries;
create trigger lesson_summaries_kw before insert or update on public.lesson_summaries for each row execute function public._summary_kw_stamp();

/* 지난 요약 — 한 번 채운다 */
update public.lesson_summaries set keywords = public._summary_keywords(class_name, week_start, confirmed)
 where confirmed is not null and keywords = '[]'::jsonb;

/* 코치룸 — [키워드 다시 만들기] · 칩 지우기 · 추가 */
create or replace function public.summary_keywords_rebuild(p_class text, p_week date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare kw jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.lesson_summaries set keywords = public._summary_keywords(class_name, week_start, confirmed), updated_at = now()
   where class_name = btrim(p_class) and week_start = p_week and confirmed is not null
  returning keywords into kw;
  if kw is null then raise exception '확정된 수업 내용 요약이 없습니다 — 먼저 요약을 확정해 주세요.'; end if;
  return jsonb_build_object('ok', true, 'keywords', kw);
end;
$$;

create or replace function public.summary_keywords_set(p_class text, p_week date, p_keywords jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare kw jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if jsonb_typeof(p_keywords) <> 'array' or jsonb_array_length(p_keywords) > 8
     or exists (select 1 from jsonb_array_elements(p_keywords) e where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 20) then
    raise exception '키워드는 8개까지, 하나에 20자 안으로 적어 주세요.';
  end if;
  update public.lesson_summaries set keywords = p_keywords, updated_at = now()
   where class_name = btrim(p_class) and week_start = p_week and confirmed is not null
  returning keywords into kw;
  if kw is null then raise exception '확정된 수업 내용 요약이 없습니다 — 먼저 요약을 확정해 주세요.'; end if;
  return jsonb_build_object('ok', true, 'keywords', kw);
end;
$$;
do $$
declare f text;
begin
  foreach f in array array['public.summary_keywords_rebuild(text, date)', 'public.summary_keywords_set(text, date, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

/* 학생 · 학부모 화면 자료 — 012 와 같고 주마다 'keywords' 만 더했다 */
create or replace function public._weekly_of(p_class text, p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select * from public.classes where name = btrim(coalesce(p_class, '')) limit 1
  ),
  wk as (
    select week_start from (
      select week_start from public.lesson_videos v
      where v.class_name = btrim(coalesce(p_class, ''))
        and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
      union
      select week_start from public.class_files f where f.class_name = btrim(coalesce(p_class, ''))
      union
      select week_start from public.lesson_summaries s where s.class_name = btrim(coalesce(p_class, '')) and s.confirmed is not null
    ) u order by week_start desc limit 26
  )
  select jsonb_build_object(
    'schedule', (
      select jsonb_build_object(
        'dow', c.lesson_dow, 'extra', to_jsonb(c.extra_dows), 'first', c.first_lesson,
        'weeks', coalesce((
          select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'lesson_date', w.lesson_date,
                                              'canceled', w.canceled, 'note', w.note) order by w.week_start desc)
          from (select * from public.class_weeks x where x.class_name = c.name order by x.week_start desc limit 60) w
        ), '[]'::jsonb))
      from c where c.lesson_dow is not null
    ),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', wk.week_start,
        'lessons', (select s.confirmed from public.lesson_summaries s
                    where s.class_name = btrim(coalesce(p_class, '')) and s.week_start = wk.week_start),
        'keywords', coalesce((select s.keywords from public.lesson_summaries s
                    where s.class_name = btrim(coalesce(p_class, '')) and s.week_start = wk.week_start and s.confirmed is not null), '[]'::jsonb),
        'videos', coalesce((
          select jsonb_agg(jsonb_build_object('part', v.part, 'title', v.title, 'url', v.url,
                                              'personal', cardinality(v.student_ids) > 0)
                           order by case v.part when 'full' then 0 when '1' then 1 when '2' then 2 else 3 end, v.sort, v.created_at)
          from public.lesson_videos v
          where v.class_name = btrim(coalesce(p_class, '')) and v.week_start = wk.week_start
            and (cardinality(v.student_ids) = 0 or (p_student is not null and p_student = any(v.student_ids)))
        ), '[]'::jsonb),
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'ext', f.ext, 'bytes', f.bytes)
                           order by f.kind, f.name)
          from public.class_files f
          where f.class_name = btrim(coalesce(p_class, '')) and f.week_start = wk.week_start
        ), '[]'::jsonb)
      ) order by wk.week_start desc)
      from wk
    ), '[]'::jsonb)
  );
$$;
revoke all on function public._weekly_of(text, uuid) from public, anon, authenticated;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'keywords' as what, exists (select 1 from information_schema.columns where table_name = 'lesson_summaries' and column_name = 'keywords')::text as ok
union all select '확정할 때 키워드', exists (select 1 from pg_trigger where tgname = 'lesson_summaries_kw')::text
union all select '학생 화면에 키워드', (position('keywords' in pg_get_functiondef('public._weekly_of(text, uuid)'::regprocedure)) > 0)::text;
