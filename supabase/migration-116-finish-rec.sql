-- ============================================================
--  migration-116-finish-rec.sql — 20261115d · 115 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  완주증 「기록 상태」(직원만) · 지금 다시 받기 · 이 반 전부 다시 받기
--  1. finish_rec_state(반) — 그 반 학생마다 앱 연결 · 받는 경로 · 옛 기록 받기 상태(받은 달 · 마지막 시도 · 실패 이유 · 연속 실패)
--     전화번호는 돌려주지 않는다(번호가 있는지도 안 줌) · 학생 · 학부모 화면(러닝노트)에서는 못 부름(직원만)
--  2. finish_old_redo(학생들, 종류, 기간 열쇠) — 그 학생들의 옛 기록을 처음부터 다시(받은 달 · 끝 표시 · 연속 실패를 비움)
--     · 대기 줄 맨 앞(app_records.old_rush) · 실제 받기는 지금처럼 함수 app-sync 가 5분마다(분당 28회 한도 그대로)
--     · 받은 달 기록(app_old_parts)은 지우지 않는다 — 새로 받는 달마다 통째로 바뀜(다 받기 전에도 화면이 비지 않음)
--     · 그 완주증의 칭호 · 하이라이트 고르기만 「자동」으로 되돌림(새 기록으로 다시 계산) · 한마디 · 확정 · 공개는 그대로
--  3. app_old_due2 — 다시 받기를 누른 학생(아직 그 뒤로 한 번도 안 물어봄)을 맨 앞 · 실패 쉼(10분 ~ 6시간)도 건너뜀
--     그다음은 예전 순서(종강 반 → 현강 → 온라인)
--  문자 · 알림톡 없음
-- ============================================================

alter table public.app_records add column if not exists old_rush timestamptz;      -- 직원이 [지금 다시 받기]를 누른 때

/* ---------- 1. 기록 상태 (직원만) ---------- */
create or replace function public.finish_rec_state(p_class text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'uid', l.app_user_id, 'by', coalesce(l.app_user_by, ''),
           'state', coalesce(l.app_link_state, ''), 'why', coalesce(l.app_link_why, ''), 'guess', coalesce(l.app_link_guess, false), 'note', coalesce(l.app_link_note, ''),
           'cands', coalesce(l.app_link_cands, '[]'::jsonb), 'tried', l.app_link_tried,
           'share', coalesce(l.app_share_code, '') <> '',
           'src', coalesce(r.src, ''), 'user_fail', coalesce(r.user_fail, ''), 'fetched', r.fetched_at, 'fail', coalesce(r.fail_reason, ''),
           'old_at', r.old_at, 'old_status', coalesce(r.old_status, ''), 'old_err', coalesce(r.old_err, ''), 'old_try', r.old_try,
           'old_tries', coalesce(r.old_tries, 0), 'old_fails', coalesce(r.old_fails, 0), 'old_month', r.old_month, 'old_months', coalesce(r.old_months, 0),
           'old_rush', r.old_rush,
           'rush_wait', r.old_rush is not null and r.old_at is null and (r.old_try is null or r.old_try < r.old_rush)
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
revoke all on function public.finish_rec_state(text) from public, anon;
grant execute on function public.finish_rec_state(text) to authenticated;

/* ---------- 2. 다시 받기 (직원만 · 앱 연결된 학생만 · 한 번에 60명까지) ---------- */
create or replace function public.finish_old_redo(p_students uuid[], p_kind text default '', p_key text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int; skip int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(array_agg(x), '{}') into ids
    from (select distinct x from unnest(coalesce(p_students, '{}'::uuid[])) x
           where exists (select 1 from public.student_links l where l.student_id = x and l.app_user_id is not null)
             and exists (select 1 from public.students s where s.id = x and not s.archived)
           limit 60) z;
  n := coalesce(array_length(ids, 1), 0);
  skip := coalesce(array_length(p_students, 1), 0) - n;
  if n = 0 then return jsonb_build_object('ok', true, 'n', 0, 'skip', skip); end if;
  insert into public.app_records (student_id) select x from unnest(ids) x on conflict (student_id) do nothing;
  update public.app_records set old_at = null, old_month = null, old_fails = 0, old_status = '', old_err = '', old_rush = now()
   where student_id = any(ids);
  /* 칭호 · 하이라이트만 자동으로(새 기록으로 다시 계산) — 한마디 · 확정 · 공개는 그대로 */
  if coalesce(p_kind, '') in ('year', 'month') and coalesce(p_key, '') <> '' then
    update public.finish_certs set title_key = '', hl_keys = '[]'::jsonb, updated_at = now()
     where student_id = any(ids) and kind = p_kind and pkey = left(p_key, 40);
  end if;
  return jsonb_build_object('ok', true, 'n', n, 'skip', skip);
end;
$$;
revoke all on function public.finish_old_redo(uuid[], text, text) from public, anon;
grant execute on function public.finish_old_redo(uuid[], text, text) to authenticated;

/* ---------- 3. 옛 기록 받는 순서 — 다시 받기 누른 학생 맨 앞 (114 그대로 + pri 3) ---------- */
create or replace function public.app_old_due2(p_limit integer default 40)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'uid', z.uid, 'start', z.start_on, 'month', z.old_month, 'dfirst', z.dfirst) order by z.pri desc, z.ord nulls first, z.id), '[]'::jsonb)
    from (
      select s.id, l.app_user_id uid, s.start_on, r.old_month, r.old_try ord, public._data_first(r.data) dfirst,
             case when r.old_rush is not null and (r.old_try is null or r.old_try < r.old_rush) then 3
                  when exists (select 1 from public.classes c
                                where (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name))
                                  and c.end_on between (now() at time zone 'Asia/Seoul')::date - 7 and (now() at time zone 'Asia/Seoul')::date + 21) then 2
                  when public._online_only(s.id) then 0 else 1 end pri
        from public.students s
        join public.student_links l on l.student_id = s.id and l.app_user_id is not null
        left join public.app_records r on r.student_id = s.id
       where not s.archived
         and r.old_at is null
         and (coalesce(r.old_fails, 0) = 0 or r.old_try is null
              or (r.old_rush is not null and r.old_try < r.old_rush)
              or r.old_try < now() - case when r.old_fails <= 1 then interval '10 minutes'
                                          else least(interval '6 hours', interval '30 minutes' * power(2, least(r.old_fails, 8) - 2)) end)
       order by 7 desc, r.old_try nulls first, s.id
       limit greatest(1, least(100, coalesce(p_limit, 40)))
    ) z;
$$;
revoke all on function public.app_old_due2(integer) from public, anon, authenticated;
grant execute on function public.app_old_due2(integer) to service_role;

-- 확인 (모두 true)
select 'app_records.old_rush' as what, exists (select 1 from information_schema.columns where table_name = 'app_records' and column_name = 'old_rush')::text as ok
union all select '기록 상태 · 다시 받기 — 직원만', (to_regprocedure('public.finish_rec_state(text)') is not null and to_regprocedure('public.finish_old_redo(uuid[],text,text)') is not null
  and not has_function_privilege('anon', 'public.finish_rec_state(text)', 'execute') and not has_function_privilege('anon', 'public.finish_old_redo(uuid[], text, text)', 'execute'))::text
union all select '다시 받기 맨 앞(app_old_due2 pri 3)', (position('old_rush' in pg_get_functiondef('public.app_old_due2(integer)'::regprocedure)) > 0)::text;
