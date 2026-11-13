-- ============================================================
--  migration-112-hub-class-mode.sql — 20261114g · 107 · 110 다음 · 여러 번 실행해도 됨
--  러닝노트 · 완주증이 「온라인 반만 듣는 학생」인지 알 수 있게
--  1. _class_line(반) — 완주증 · 러닝노트 반 이름 줄: 현강 「목동반 · 토 18:30」 · 온라인 「온라인 · 고2 11월 마라톤」(앱 반 이름 · 없으면 반 이름)
--  2. hub_class_mode(p_code) — 러닝노트 · 그 학생 것만: { ok, online(모든 반이 온라인), classes: [{ name, kind, line }] }
--     현강과 온라인을 둘 다 들으면 online = false (현강 기준 · 모든 탭)
--  3. class_lines() — 코치룸(직원만) · 반마다 반 이름 줄 (완주증)
--  문자 · 알림톡 · 링크 발송은 건드리지 않는다(온라인 반 발송 꺼짐 그대로) · 전화번호 없음
-- ============================================================

create or replace function public._class_line(c public.classes)
returns text language sql stable as $$
  select case when coalesce(c.kind, '') = 'online'
              then '온라인 · ' || coalesce(nullif(btrim(coalesce(c.app_class, '')), ''), c.name)
              else c.name || coalesce(' · ' || (array['일', '월', '화', '수', '목', '금', '토'])[c.lesson_dow + 1] ||
                     coalesce(' ' || to_char(c.start_time, 'HH24:MI'), ''), '') end;
$$;
revoke all on function public._class_line(public.classes) from public, anon, authenticated;

create or replace function public.hub_class_mode(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; list jsonb;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'kind', case when coalesce(c.kind, '') = 'online' then 'online' else 'class' end, 'line', public._class_line(c))
                            order by (coalesce(c.kind, '') = 'online'), c.name), '[]'::jsonb)
    into list
    from public.classes c
   where not coalesce(c.archived, false)
     and (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name));
  return jsonb_build_object('ok', true, 'classes', list,
    'online', jsonb_array_length(list) > 0 and not exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' <> 'online'));
end;
$$;
revoke all on function public.hub_class_mode(text) from public;
grant execute on function public.hub_class_mode(text) to anon, authenticated;

create or replace function public.class_lines()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_object_agg(c.name, jsonb_build_object('kind', case when coalesce(c.kind, '') = 'online' then 'online' else 'class' end, 'line', public._class_line(c)))
                     from public.classes c where not coalesce(c.archived, false)), '{}'::jsonb);
end;
$$;
revoke all on function public.class_lines() from public, anon;
grant execute on function public.class_lines() to authenticated;

-- 확인 (모두 true 여야 함)
select '러닝노트 반 종류(hub_class_mode)' as what, (to_regprocedure('public.hub_class_mode(text)') is not null)::text as ok
union all select '완주증 반 이름 줄(class_lines)', (to_regprocedure('public.class_lines()') is not null)::text
union all select '반 이름 줄 모양(현강 · 요일 시각 / 온라인 · 앱 반)', (not exists (select 1 from public.classes c where not coalesce(c.archived, false) and coalesce(public._class_line(c), '') = ''))::text;
