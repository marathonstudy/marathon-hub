-- ============================================================
--  마라톤 코치룸 — 앱 클래스 · 핀번호 (migration-060-app-class.sql · 20261101p)
--
--  실행 방법 (순서)
--    1. 059 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    2. Edge Function app-report 를 다시 배포 (「오늘」 반 단위 기록에도 앱 클래스 이름 classTitle 을 넣는다).
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 핀번호(app_code)는 바꾸지 않는다. 새 키는 없다.
--
--  마라톤 앱 「핀번호」(앱 관리자 → 클래스 → 클래스 정보 → 핀번호) = 코치룸 「앱 핀번호(입장코드)」 = classes.app_code (040 그대로)
--  1. classes.app_class — 그 반 학생들 앱 링크의 클래스 이름(classTitle) 중 가장 많이 나온 값을 「지난번」으로 기억
--     반 학생 절반 이상이 이 값과 다른 클래스 이름이면 「오늘」 반 카드에 「앱 클래스가 바뀌었어요」 노란 띠
--     핀번호를 넣거나 [그대로]를 누르면 새 이름을 기억해 띠가 사라진다
--  2. class_app_class_set(반, 클래스 이름) — 운영진 누구나
-- ============================================================

alter table public.classes add column if not exists app_class    text not null default '';
alter table public.classes add column if not exists app_class_at timestamptz;
alter table public.classes drop constraint if exists classes_app_class_len;
alter table public.classes add constraint classes_app_class_len check (char_length(app_class) <= 120);

create or replace function public.class_app_class_set(p_class text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare t text := left(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g')), 120);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.classes set app_class = t, app_class_at = now() where name = btrim(coalesce(p_class, ''));
  if not found then raise exception '반을 찾지 못했습니다: %', p_class; end if;
  return jsonb_build_object('ok', true, 'name', btrim(p_class), 'app_class', t);
end;
$$;
revoke all on function public.class_app_class_set(text, text) from public, anon;
grant execute on function public.class_app_class_set(text, text) to authenticated;


-- ============================================================
--  확인 — 두 줄 true
-- ============================================================
select '앱 클래스 칸' as what, exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'app_class')::text as ok
union all select '기억하는 함수', exists (select 1 from pg_proc where proname = 'class_app_class_set')::text;
