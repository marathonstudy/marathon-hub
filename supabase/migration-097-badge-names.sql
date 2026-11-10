-- ============================================================
--  migration-097-badge-names.sql — 배지 이름 「퍼펙트 배지」 → 「주간 배지」 · 「루틴 배지」 → 「월간 배지」 · 배지 칸 모든 주 (20261110g)
--  (097 은 096 다음 · 078 · 087 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음)
--  1. 배지 모음(_badge_box · hub_badges · staff_badges 가 같이 씀) — 주간 배지 칸을 최근 12주가 아니라 모든 주 · 과제 0개인 주(쉼)도
--     start = 그 학생이 시작한 날(수강 시작일 · 없으면 첫 주) — 화면은 시작한 주 · 달부터만 칸을 만든다
--  2. 수업 전 예고 칭찬 끝 한 줄 — 기본 글 그대로면 「⭐ 이번 주 주간 배지를 받았어요! (지금까지 {개수}개)」 (고친 글은 그대로 · 문구 이름은 그대로)
--  3. 운영진 과제 현황 문자 첫 줄 「⭐ 이번 주 퍼펙트 n명」 → 「⭐ 이번 주 주간 배지 n명」 (087 의 _hws_texts 그대로 · 그 말만)
--  알림톡 템플릿 글 · 루틴 우수자 문자 문구(알림톡과 같은 글)는 고치지 않는다
-- ============================================================

-- ------------------------------------------------------------
--  1. 배지 모음 — 모든 주 · 시작한 날
-- ------------------------------------------------------------
create or replace function public._badge_box(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'),
    'perfect', public._badge_count(p_student),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', x.week_start, 'from', x.lesson_day - 7, 'to', x.lesson_day - 1, 'lesson', x.lesson_day,
                                                           'total', x.total, 'done', x.done, 'perfect', x.perfect) order by x.week_start)
                         from public.hw_weeks x where x.student_id = p_student), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(to_char(a.month, 'YYYY-MM') order by a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null), '[]'::jsonb),
    'start', coalesce((select s.start_on from public.students s where s.id = p_student)::text,
                      (select min(w.week_start) from public.hw_weeks w where w.student_id = p_student)::text, ''),
    'first', coalesce(least((select min(w.week_start) from public.hw_weeks w where w.student_id = p_student),
                            (select min(a.month) from public.routine_awards a where a.student_id = p_student and a.sent_at is not null))::text, ''),
    'cur', (select to_char(a.month, 'YYYY-MM') from public.routine_awards a
             where a.student_id = p_student and a.sent_at is not null and a.month = public._award_prev(now())));
$$;
revoke all on function public._badge_box(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
--  2. 수업 전 예고 칭찬 끝 한 줄 — 기본 글 그대로일 때만
-- ------------------------------------------------------------
update public.sms_templates set body = '⭐ 이번 주 주간 배지를 받았어요! (지금까지 {개수}개)', updated_at = now(), updated_by = 'migration-097'
 where btrim(title) = '퍼펙트 배지 한 줄' and btrim(body) = '⭐ 이번 주 퍼펙트 배지를 받았어요! (지금까지 {개수}개)';

-- ------------------------------------------------------------
--  3. 운영진 과제 현황 문자 — 첫 줄 이름만
-- ------------------------------------------------------------
create or replace function public._hws_texts(p_class text, p_day date, p_start text, p_items jsonb, p_cut integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  cut int := greatest(1, least(100, coalesce(p_cut, 60)));
  head text := '[과제 현황] ' || p_class || ' · 오늘 ' || coalesce(p_start, '') || ' 수업';
  per text := '이번 주 ' || to_char(p_day - 7, 'FMMM/FMDD') || '~' || to_char(p_day - 1, 'FMMM/FMDD') ||
              ' · 지난주 ' || to_char(p_day - 14, 'FMMM/FMDD') || '~' || to_char(p_day - 8, 'FMMM/FMDD');
  two text;
  pf jsonb := public._hws_perfect(p_day, p_items);
  lines text[] := '{}'; body text[] := '{}'; top text[];
  nrank int := 0; nlow int := 0; none_ text; unk text; tail text;
  r record;
  limitb int := 2000;
  parts text[] := '{}'; cur text; ln text; k int; n int;
begin
  for r in
    with x as (
      select s.id, s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known,
             coalesce((i ->> 'pdone')::int, 0) pdn, coalesce((i ->> 'ptotal')::int, 0) ptt
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.id, x.name, x.dn, x.tt, (x.dn * 100 / x.tt) pct, case when x.ptt > 0 then x.pdn * 100 / x.ptt end ppct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name ||
                     case when r.ppct is null then ' (지난주 없음)'
                          else ' (지난주 ' || r.ppct || '%' ||
                               case when r.pct > r.ppct then ' ↑' when r.ppct - r.pct >= 20 then ' ↓↓' when r.pct < r.ppct then ' ↓' else '' end || ')' end ||
                     case when r.pct < cut then ' → 상담 필요' || public._consult_tag(r.id, p_day, r.dn, r.tt) else '' end);
    if r.pct < cut and r.ppct is not null and r.ppct < cut then two := concat_ws(', ', two, r.name); end if;
  end loop;
  select string_agg(s.name, ', ' order by s.name collate "C") into none_
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) <= 0;
  select string_agg(s.name, ', ' order by s.name collate "C") into unk
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where not coalesce((i ->> 'known')::boolean, true);
  if none_ is not null then body := body || ('과제 없음 · ' || none_); end if;
  if unk is not null then body := body || ('앱 기록 없음 · ' || unk); end if;
  tail := case when nrank = 0 then '완료율을 낼 학생이 없어요.'
               when nlow > 0 then cut || '% 미만 ' || nlow || '명은 반드시 상담해 주세요.'
               else '모두 ' || cut || '% 이상이에요.' end;
  top := array['⭐ 이번 주 주간 배지 ' || coalesce((pf ->> 'n')::int, 0) || '명'];
  if coalesce(pf ->> 'line', '') <> '' then top := top || (pf ->> 'line'); end if;
  lines := array[head, per] || top || array['완료율 높은 순 · ' || nrank || '명'] || body || array[tail];
  if two is not null then lines := lines || ('2주 연속 ' || cut || '% 미만: ' || two); end if;

  if public._sms_bytes(array_to_string(lines, E'\n')) <= limitb then
    return jsonb_build_object('texts', jsonb_build_array(array_to_string(lines, E'\n')), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
  end if;
  cur := head || ' (#/#)';
  for k in 2 .. coalesce(array_length(lines, 1), 0) loop
    ln := lines[k];
    if public._sms_bytes(cur || E'\n' || ln) > limitb - 4 then
      parts := parts || cur;
      cur := '[과제 현황] ' || p_class || ' (#/#)' || E'\n' || ln;
    else
      cur := cur || E'\n' || ln;
    end if;
  end loop;
  parts := parts || cur;
  n := array_length(parts, 1);
  for k in 1 .. n loop
    parts[k] := replace(parts[k], '(#/#)', '(' || k || '/' || n || ')');
  end loop;
  return jsonb_build_object('texts', to_jsonb(parts), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
end;
$$;
revoke all on function public._hws_texts(text, date, text, jsonb, integer) from public, anon, authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '배지 모음 — 모든 주 · 시작한 날(start)' as what, (position('''start''' in pg_get_functiondef('public._badge_box(uuid)'::regprocedure)) > 0
                                                     and position('limit 12' in pg_get_functiondef('public._badge_box(uuid)'::regprocedure)) = 0)::text as ok
union all select '운영진 문자 「이번 주 주간 배지 n명」', (position('이번 주 주간 배지' in pg_get_functiondef('public._hws_texts(text, date, text, jsonb, integer)'::regprocedure)) > 0)::text
union all select '수업 전 예고 한 줄 — ' || coalesce((select body from public.sms_templates where btrim(title) = '퍼펙트 배지 한 줄' limit 1), '(문구 없음)'), 'true';
