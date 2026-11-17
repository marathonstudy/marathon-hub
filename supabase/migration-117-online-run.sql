-- ============================================================
--  migration-117-online-run.sql — 20261117a · 116 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  온라인 마라톤 「구간 완주」 — 사정 인정(직원이 날짜마다 체크) · 반 단위 구간 완주 표
--  1. online_excuse — 학생 · 날짜마다 「사정 인정」(시험 등으로 미리 알린 날) · 직원만 읽고 쓴다(RLS)
--     사유 글(note)은 직원만 · 러닝노트(학생 · 학부모)는 날짜만 받는다
--  2. hub_online_excuse(링크 코드) — 그 학생의 사정 인정 날짜만(사유 없음)
--  3. online_run_class(반) — 직원만 · 그 반 학생마다 이미 받아 둔 앱 기록(app_records)의 날짜별 제출 · 과제 제목 · 강별 영상 + 사정 인정 날짜
--     앱 · 앱 DB 는 건드리지 않는다 · 전화번호 없음 · 문자 · 알림톡 없음
-- ============================================================

/* ---------- 1. 사정 인정 ---------- */
create table if not exists public.online_excuse (
  student_id uuid not null references public.students(id) on delete cascade,
  day date not null,
  note text not null default '',
  by_user uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (student_id, day)
);
alter table public.online_excuse enable row level security;
drop policy if exists online_excuse_staff on public.online_excuse;
create policy online_excuse_staff on public.online_excuse for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke all on public.online_excuse from anon;
grant select, insert, update, delete on public.online_excuse to authenticated;

/* ---------- 2. 러닝노트 — 날짜만 ---------- */
create or replace function public.hub_online_excuse(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_char(x.day, 'YYYY-MM-DD') order by x.day)
                     from public.online_excuse x where x.student_id = s.id and x.day > current_date - 400), '[]'::jsonb);
end;
$$;
revoke all on function public.hub_online_excuse(text) from public;
grant execute on function public.hub_online_excuse(text) to anon, authenticated;

/* ---------- 3. 반 표 (직원만) ---------- */
create or replace function public.online_run_class(p_class text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'start_on', s.start_on,
           'linked', l.app_user_id is not null or coalesce(l.app_share_code, '') <> '',
           'data', jsonb_build_object(
             'calendar', coalesce(r.data -> 'calendar', '[]'::jsonb),
             'lectures', coalesce(r.data -> 'lectures', '[]'::jsonb),
             'history', coalesce((select jsonb_agg(jsonb_build_object('title', h ->> 'title', 'order', h -> 'order', 'submittedAt', h ->> 'submittedAt', 'late', h -> 'late'))
                                    from jsonb_array_elements(case when jsonb_typeof(r.data -> 'history') = 'array' then r.data -> 'history' else '[]'::jsonb end) h), '[]'::jsonb),
             'old', case when jsonb_typeof(r.old) = 'object' then jsonb_build_object('calendar', coalesce(r.old -> 'calendar', '[]'::jsonb),
               'history', coalesce((select jsonb_agg(jsonb_build_object('title', h ->> 'title', 'order', h -> 'order', 'submittedAt', h ->> 'submittedAt', 'late', h -> 'late'))
                                      from jsonb_array_elements(case when jsonb_typeof(r.old -> 'history') = 'array' then r.old -> 'history' else '[]'::jsonb end) h), '[]'::jsonb)) else null end),
           'excuse', coalesce((select jsonb_agg(to_char(x.day, 'YYYY-MM-DD') order by x.day) from public.online_excuse x where x.student_id = s.id), '[]'::jsonb)
         ) order by s.name), '[]'::jsonb)
    into out
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.app_records r on r.student_id = s.id
   where not s.archived
     and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class));
  return out;
end;
$$;
revoke all on function public.online_run_class(text) from public, anon;
grant execute on function public.online_run_class(text) to authenticated;

-- 확인 (모두 true)
select '사정 인정 표(online_excuse) · RLS 켬' as what, (to_regclass('public.online_excuse') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_excuse'::regclass))::text as ok
union all select '사정 인정 — 직원만 쓰기(정책 is_staff)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'online_excuse'
  and policyname = 'online_excuse_staff' and qual like '%is_staff%' and with_check like '%is_staff%')::text
union all select '사정 인정 — 로그인 안 한 사람은 표를 못 봄', (not has_table_privilege('anon', 'public.online_excuse', 'select'))::text
union all select '러닝노트 — 날짜만(hub_online_excuse)', (to_regprocedure('public.hub_online_excuse(text)') is not null)::text
union all select '반 구간 완주 표 — 직원만(online_run_class)', (to_regprocedure('public.online_run_class(text)') is not null
  and not has_function_privilege('anon', 'public.online_run_class(text)', 'execute'))::text;
