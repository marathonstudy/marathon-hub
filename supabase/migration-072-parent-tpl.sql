-- ============================================================
--  migration-072-parent-tpl.sql — 레포트 안내 알림톡(학부모) 템플릿 코드를 설정에서 (20261108d)
--  (072 는 071 다음 · 여러 번 실행해도 안전 · 그다음 함수 kakao-send 다시 배포)
--
--  지금까지 — 「주간레포트안내」 템플릿 코드는 코드 파일이 아니라 Supabase Secrets 의 SOLAPI_TEMPLATE_ID 에만 있었다.
--  이제 — 설정 app_settings 'kakao_tpl' { parent } 에 코드를 넣으면 그 코드로 보낸다 (원장만 · kakao_tpl_set 'parent')
--         비어 있으면 지금 그대로 Secrets 의 SOLAPI_TEMPLATE_ID (기본값 = 지금 코드)
--         「주간레포트안내_v2」가 승인되면 설정에 새 코드만 넣으면 바로 바뀐다 (변수 #{이름} #{수업일} #{코드} · 버튼은 지금과 같다)
--  시험 발송 — 설정 칸 옆 [시험 발송] → 원장 내 시험 번호로 한 통 (칸에 넣은 코드 그대로 · 저장 전에도 · 최근 공개 레포트 내용으로)
--  템플릿 내용은 건드리지 않는다.
-- ============================================================

insert into public.app_settings (key, value) values ('kakao_tpl', jsonb_build_object('student', '', 'parent', ''))
on conflict (key) do update set value = jsonb_build_object('parent', '') || coalesce(public.app_settings.value, '{}'::jsonb);

create or replace function public._kakao_tpl()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('student', coalesce(btrim(v ->> 'student'), ''), 'parent', coalesce(btrim(v ->> 'parent'), ''))
    from (select coalesce((select value from public.app_settings where key = 'kakao_tpl'), '{}'::jsonb) v) x;
$$;
revoke all on function public._kakao_tpl() from public, anon, authenticated;

/* 071 과 같고 학부모 코드도 */
create or replace function public.kakao_tpl_set(p_kind text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := btrim(coalesce(p_kind, '')); c text := btrim(coalesce(p_code, ''));
begin
  if not public._real_teacher() then raise exception '알림톡 템플릿 코드는 원장 계정만 바꿀 수 있습니다.'; end if;
  if k not in ('student', 'parent') then raise exception '알 수 없는 템플릿 종류입니다.'; end if;
  if c <> '' and c !~ '^[A-Za-z0-9_-]{4,80}$' then raise exception '템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드(예: KA01TP…)를 그대로 넣어 주세요.'; end if;
  insert into public.app_settings (key, value) values ('kakao_tpl', jsonb_build_object(k, c))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object(k, c);
  return jsonb_build_object('ok', true, 'kind', k, 'set', c <> '');
end;
$$;

/* 설정 읽기 (071 과 같고 학부모 코드가 있는지 — parentTpl) */
create or replace function public.kakao_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  t jsonb := public._kakao_tpl();
  own boolean := public._real_teacher();
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._kakao_cfg() || jsonb_build_object(
    'testPhone', coalesce((select public._phone_mask(phone) from public.kakao_test_phones where email = me), ''),
    'today', public._kakao_today_count(),
    'owner', own,
    'studentTpl', (t ->> 'student') <> '',
    'parentTpl', (t ->> 'parent') <> '',
    'tpl', case when own then t else '{}'::jsonb end);
end;
$$;

/* 함수(kakao-send)가 쓸 학부모 코드 — 운영진 누구나 보낼 때 쓰지만 값은 함수 안에서만 (비어 있으면 Secrets) */
create or replace function public.kakao_parent_tpl()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  return public._kakao_tpl() ->> 'parent';
end;
$$;
revoke all on function public.kakao_parent_tpl() from public, anon;
grant execute on function public.kakao_parent_tpl() to authenticated;

/* 시험 발송 — 가장 최근 공개된 레포트 한 명 (학부모 링크 있음) */
create or replace function public.kakao_test_pick()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select p.week_start, p.student_id into r
    from public.published p join public.students s on s.id = p.student_id and not s.archived
    join public.student_links l on l.student_id = p.student_id and coalesce(l.hub_code, '') <> ''
   where p.visible order by p.week_start desc, p.published_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'message', '공개된 레포트가 있어야 시험 발송을 할 수 있습니다.'); end if;
  return jsonb_build_object('ok', true, 'week', r.week_start, 'student', r.student_id);
end;
$$;
revoke all on function public.kakao_test_pick() from public, anon;
grant execute on function public.kakao_test_pick() to authenticated;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '학부모 코드 설정 (원장만)' as what, (position('''parent''' in pg_get_functiondef('public.kakao_tpl_set(text, text)'::regprocedure)) > 0)::text as ok
union all select '시험 발송용 레포트 고르기', (to_regprocedure('public.kakao_test_pick()') is not null)::text
union all select case when (public._kakao_tpl() ->> 'parent') = '' then '학부모 코드 비어 있음 — 지금처럼 Secrets 의 SOLAPI_TEMPLATE_ID' else '학부모 코드 있음 — 설정 코드로 보냄' end, 'true';
