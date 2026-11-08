-- ============================================================
--  migration-076-hws-30.sql — 운영진 과제 현황 문자: 수업 30분 전 · 「⭐ 이번 주 퍼펙트 n명」 (20261108h)
--  (076 은 075 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  1. 보내는 때 — 반 수업 시작 20분 전 → 30분 전 (~ 시작 전 · 같은 날 같은 반 한 번은 그대로)
--  2. 명단 위 — 「⭐ 이번 주 퍼펙트 n명」 + 「김승윤(6), 강지호(3)」(지금까지 모은 퍼펙트 배지 수 · 많은 순 · 같으면 이름순 · 쉼표)
--       0명이면 「⭐ 이번 주 퍼펙트 0명」 한 줄만
--       퍼펙트 = 075 의 주간 퍼펙트 배지 (이번 주 · 이미 생긴 것 + 이 명단의 셈으로 모두 낸 학생 — 그 자리에서 배지도 남긴다)
--  3. 나머지(완료율 높은 순 명단 · 60% 미만 상담 필요 · 과제 없음 · 앱 기록 없음)는 그대로
--  운영진만 받는다 (학생 · 학부모 없음) · 사본 없음 (069 그대로)
-- ============================================================


-- ------------------------------------------------------------
--  1. 30분 전
-- ------------------------------------------------------------
create or replace function public._hws_due_classes(p_now timestamptz)
returns setof public.classes
language sql stable security definer set search_path = public as $$
  select k.* from public.classes k
   where not k.archived and k.start_time is not null
     and k.start_time >= time '00:30'
     and (p_now at time zone 'Asia/Seoul')::time >= k.start_time - interval '30 minutes'
     and (p_now at time zone 'Asia/Seoul')::time < k.start_time
     and public._note_lesson_today(k.name, (p_now at time zone 'Asia/Seoul')::date)
     and not exists (select 1 from public.hw_status_log g where g.day = (p_now at time zone 'Asia/Seoul')::date and g.class_name = k.name)
   order by k.name;
$$;
revoke all on function public._hws_due_classes(timestamptz) from public, anon, authenticated;


-- ------------------------------------------------------------
--  2. 이번 주 퍼펙트 — p_items [{ id, done, total, known }] · 반환 { n, line }
--     이미 남은 배지(hw_weeks) + 이 셈으로 모두 낸 학생 (아직 안 남았으면 개수에 +1)
-- ------------------------------------------------------------
create or replace function public._hws_perfect(p_day date, p_items jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with x as (
    select s.id, s.name,
           exists (select 1 from public.hw_weeks w where w.student_id = s.id and w.week_start = p_day - (extract(isodow from p_day)::int - 1) and w.perfect) as stored,
           coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) > 0 and coalesce((i ->> 'done')::int, 0) >= coalesce((i ->> 'total')::int, 0) as now_
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) i
      join public.students s on s.id::text = i ->> 'id'
  ), p as (
    select x.name, public._badge_count(x.id) + case when x.stored then 0 else 1 end as cnt
      from x where x.stored or x.now_
  )
  select jsonb_build_object('n', (select count(*) from p),
                            'line', coalesce((select string_agg(p.name || '(' || p.cnt || ')', ', ' order by p.cnt desc, p.name collate "C") from p), ''));
$$;
revoke all on function public._hws_perfect(date, jsonb) from public, anon, authenticated;


-- ------------------------------------------------------------
--  3. 글 — 069 와 같고 머리 다음에 퍼펙트 두 줄
-- ------------------------------------------------------------
create or replace function public._hws_texts(p_class text, p_day date, p_start text, p_items jsonb, p_cut integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  cut int := greatest(1, least(100, coalesce(p_cut, 60)));
  head text := '[과제 현황] ' || p_class || ' · 오늘 ' || coalesce(p_start, '') || ' 수업 (' ||
               to_char(p_day - 7, 'FMMM/FMDD') || '~' || to_char(p_day - 1, 'FMMM/FMDD') || ')';
  pf jsonb := public._hws_perfect(p_day, p_items);
  lines text[] := '{}'; body text[] := '{}'; top text[];
  nrank int := 0; nlow int := 0; none_ text; unk text; tail text;
  r record;
  limitb int := 2000;
  parts text[] := '{}'; cur text; ln text; k int; n int;
begin
  for r in
    with x as (
      select s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.name, (x.dn * 100 / x.tt) pct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name || case when r.pct < cut then ' → 상담 필요' else '' end);
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
  lines := array[head] || top || array['완료율 높은 순 · ' || nrank || '명'] || body || array[tail];

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


-- ------------------------------------------------------------
--  4. 보낼 줄 — 069 와 같고, 보내기 전에 이 셈으로 모두 낸 학생의 배지를 남긴다 (미리보기는 남기지 않는다)
-- ------------------------------------------------------------
create or replace function public.hw_status_prepare(p_now timestamptz, p_items jsonb, p_class text default null, p_by text default null, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  now0 timestamptz := coalesce(p_now, now());
  d date := (now0 at time zone 'Asia/Seoul')::date;
  manual boolean := coalesce(btrim(p_class), '') <> '';
  byname text := coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(coalesce(p_by, '')) limit 1), '');
  cut int := public._hws_cut();
  c record; p record; i jsonb;
  t jsonb; texts text[]; txt text;
  rows jsonb := '[]'::jsonb; previews jsonb := '[]'::jsonb; people jsonb;
  b uuid; lid uuid; nid bigint; seen text[]; k int;
begin
  for c in
    select k0.* from public.classes k0
     where case when manual then k0.name = btrim(p_class) and not k0.archived and k0.start_time is not null and public._note_lesson_today(k0.name, d)
                else k0.name in (select x.name from public._hws_due_classes(now0) x) end
       and p_items ? k0.name
     order by k0.name
  loop
    if not coalesce(p_dry, false) then
      for i in select * from jsonb_array_elements(case when jsonb_typeof(p_items -> c.name) = 'array' then p_items -> c.name else '[]'::jsonb end) loop
        if coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) > 0
           and exists (select 1 from public._note_students(c.name, d) s where s.id::text = i ->> 'id') then
          perform public._hw_week_put((i ->> 'id')::uuid, c.name, d, coalesce((i ->> 'done')::int, 0), (i ->> 'total')::int);
        end if;
      end loop;
    end if;
    t := public._hws_texts(c.name, d, to_char(c.start_time, 'HH24:MI'), p_items -> c.name, cut);
    select array_agg(v order by o) into texts from jsonb_array_elements_text(t -> 'texts') with ordinality as e(v, o);
    people := coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'teacher', x.role = 'teacher', 'on', x.on_, 'phone', x.phone <> '', 'last4', right(x.phone, 4)))
                          from public._hws_people() x), '[]'::jsonb);
    if coalesce(p_dry, false) then
      previews := previews || jsonb_build_object('class', c.name, 'texts', to_jsonb(texts), 'people', people, 'cut', cut,
                                                 'sent', (select to_char(max(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI') from public.hw_status_log g where g.day = d and g.class_name = c.name));
      continue;
    end if;
    /* 같은 날 같은 반 한 번 (자동) — 지금 보내기는 따로 남긴다 */
    b := gen_random_uuid();
    insert into public.hw_status_log (day, class_name, manual, batch_id, by_name, students, low, parts)
    values (d, c.name, manual, b, case when manual then byname else '자동' end, (t ->> 'students')::int, (t ->> 'low')::int, coalesce(array_length(texts, 1), 1))
      on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '과제 현황(운영진)', 'hwstat', texts[1], case when manual then coalesce(p_by, '') else '자동' end);
    seen := '{}';
    for p in select * from public._hws_people() loop
      if not p.on_ then continue; end if;
      if p.phone = '' then
        insert into public.sms_log (batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, status, error, created_by, finished_at, copy_state)
        values (b, null, 'staff', p.name, c.name, '', 'LMS', left(texts[1], 60), 'fail', '번호 없음', case when manual then coalesce(p_by, '') else '자동' end, now(), 'none');
        continue;
      end if;
      if p.phone = any(seen) then continue; end if;
      seen := seen || p.phone;
      for k in 1 .. coalesce(array_length(texts, 1), 0) loop
        txt := texts[k];
        lid := gen_random_uuid();
        insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by, copy_state)
        values (lid, b, null, 'staff', p.name, c.name, right(p.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60),
                case when manual then coalesce(p_by, '') else '자동' end, 'none');
        rows := rows || jsonb_build_object('log_id', lid, 'to', p.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                           'class', c.name, 'who', 'staff', 'name', p.name);
      end loop;
    end loop;
    nid := null;
  end loop;
  if coalesce(p_dry, false) then return jsonb_build_object('ok', true, 'day', d, 'previews', previews); end if;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.hw_status_prepare(timestamptz, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.hw_status_prepare(timestamptz, jsonb, text, text, boolean) to service_role;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '30분 전' as what, (position('30 minutes' in pg_get_functiondef('public._hws_due_classes(timestamptz)'::regprocedure)) > 0)::text as ok
union all select '퍼펙트 줄', (position('이번 주 퍼펙트' in pg_get_functiondef('public._hws_texts(text, date, text, jsonb, integer)'::regprocedure)) > 0)::text
union all select '075 먼저 (hw_weeks)', (to_regclass('public.hw_weeks') is not null)::text;
