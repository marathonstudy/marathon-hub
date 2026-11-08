-- ============================================================
--  migration-081-hws-lastweek.sql — 운영진 과제 현황 문자에 지난주 기록 (20261108m)
--  (081 은 080 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  둘째 줄 「이번 주 11/1~11/7 · 지난주 10/25~10/31」 — 지난주는 이번 기간 바로 앞의 같은 길이(7일) 기간 (그 전 수업 기준 D-14 ~ D-8)
--  각 줄 「100% 강지호 (지난주 80% ↑)」 — 오르면 ↑ · 내리면 ↓ · 같으면 화살표 없음 · 20%p 이상 떨어지면 「↓↓」(이번 주가 60% 이상이어도)
--    지난주 과제가 없었거나 신입(수강 시작 전)이면 「(지난주 없음)」
--  정렬 · 60% 미만 「→ 상담 필요」 · 맨 끝 문장은 이번 주 기준 그대로
--  맨 끝 아래 「2주 연속 60% 미만: 이름, 이름」 (없으면 줄 없음)
--  퍼펙트 줄(076) · 나눠 보내기 · 미리보기 · [지금 운영진에게 보내기]는 같은 글 (셈은 note-remind 가 지난주도 같이 · pdone · ptotal)
-- ============================================================

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
      select s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known,
             coalesce((i ->> 'pdone')::int, 0) pdn, coalesce((i ->> 'ptotal')::int, 0) ptt
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.name, (x.dn * 100 / x.tt) pct, case when x.ptt > 0 then x.pdn * 100 / x.ptt end ppct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name ||
                     case when r.ppct is null then ' (지난주 없음)'
                          else ' (지난주 ' || r.ppct || '%' ||
                               case when r.pct > r.ppct then ' ↑' when r.ppct - r.pct >= 20 then ' ↓↓' when r.pct < r.ppct then ' ↓' else '' end || ')' end ||
                     case when r.pct < cut then ' → 상담 필요' else '' end);
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
  top := array['⭐ 이번 주 퍼펙트 ' || coalesce((pf ->> 'n')::int, 0) || '명'];
  if coalesce(pf ->> 'line', '') <> '' then top := top || (pf ->> 'line'); end if;
  lines := array[head, per] || top || array['완료율 높은 순 · ' || nrank || '명'] || body || array[tail];
  if two is not null then lines := lines || ('2주 연속 ' || cut || '% 미만: ' || two); end if;

  /* 한 통에 들어가면 그대로 */
  if public._sms_bytes(array_to_string(lines, E'\n')) <= limitb then
    return jsonb_build_object('texts', jsonb_build_array(array_to_string(lines, E'\n')), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
  end if;
  /* 나눈다 — 첫 통은 첫 줄 끝에, 다음 통은 「[과제 현황] 반 (2/3)」 머리 (꼬리 「(9/9)」 자리를 남겨 두고 채운 뒤 바꾼다) */
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
--  확인 — true
-- ============================================================
select '지난주 줄' as what, (position('지난주 없음' in pg_get_functiondef('public._hws_texts(text, date, text, jsonb, integer)'::regprocedure)) > 0)::text as ok;
