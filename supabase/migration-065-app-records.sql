-- ============================================================
--  migration-065-app-records.sql — 과제 기록 저장본 (20261106h)
--  (065 는 064 다음 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 배포 → migration-066 예약)
--
--  왜 — 코치룸 「오늘」을 열 때마다 브라우저가 앱 서버에 학생 수만큼 물어봐 학생이 많으면 느리다.
--       서버(app-sync)가 미리 받아 여기 저장하고, 화면은 저장본만 읽는다.
--  표 app_records — 학생마다 한 줄
--    data        전체 기록 (날짜별 제출 · 과제 제목 · 정답률 · 제출 시각 · 강의 · 영역별 — app-report 와 같은 모양, 사진 · 피드백 · 학생 글 없음)
--    lite        「오늘」용 가벼운 기록 (최근 120일 · 빠르게 읽으려고)
--    fetched_at  마지막으로 받은 때 · fail_*  마지막 실패 · next_try  다음에 다시 받을 때
--  읽기 — 운영진만 (RLS) · 쓰기 — 서버 함수만 (정책 없음 · service_role 함수)
--  학부모 · 학생 — hub_app_record(개인 링크 코드) · 그 학생 것만 · app-report 가 주던 것과 같은 범위
--  과제 칸 수동 수정(hw_fixes)은 따로 있다 — 자동 갱신은 이 표만 바꾼다. 화면이 읽을 때 위에 덮는다
-- ============================================================

create table if not exists public.app_records (
  student_id  uuid primary key references public.students(id) on delete cascade,
  data        jsonb,
  lite        jsonb,
  fetched_at  timestamptz,
  fail_reason text not null default '',
  fail_at     timestamptz,
  fail_count  integer not null default 0,
  next_try    timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists app_records_updated_idx on public.app_records (updated_at);
alter table public.app_records enable row level security;
drop policy if exists app_records_staff_read on public.app_records;
create policy app_records_staff_read on public.app_records for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.app_records from anon, authenticated;
revoke all on public.app_records from anon;

/* 앱 공유 링크를 바꾸거나 지우면 — 예전 링크의 기록을 지운다 (다른 학생 기록이 남지 않게) */
create or replace function public._app_record_link_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.app_share_code, '') is distinct from coalesce(old.app_share_code, '') then
    delete from public.app_records where student_id = new.student_id;
  end if;
  return new;
end;
$$;
drop trigger if exists app_record_link_changed on public.student_links;
create trigger app_record_link_changed after update of app_share_code on public.student_links
  for each row execute function public._app_record_link_changed();

/* 이번 주(월~일)에 수업이 있는 진행 중인 반 — 종강 · 휴강은 _note_lesson_today 가 뺀다 */
create or replace function public._app_class_active(p_class text, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from generate_series(0, 6) k
     where public._note_lesson_today(p_class, (date_trunc('week', p_day::timestamp)::date + k))
  );
$$;

/* 받을 차례 — 진행 중인 반 30분 · 그 밖 하루 · 실패한 학생은 next_try 부터 다시 · 밤 1시 ~ 6시는 쉰다
   p_limit 명을 고르고 바로 표시해서 다음 실행과 겹치지 않게 (10분 안에 끝나지 않으면 다시 차례가 온다) */
create or replace function public.app_sync_due(p_now timestamptz default now(), p_limit integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nw timestamptz := coalesce(p_now, now());
  kst timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  out jsonb;
begin
  if extract(hour from kst) >= 1 and extract(hour from kst) < 6 then
    return jsonb_build_object('night', true, 'students', '[]'::jsonb);
  end if;
  with act as (
    select distinct c.class_name, public._app_class_active(c.class_name, kst::date) as on_
      from (select distinct coalesce(class_name, '') class_name from public.students where not archived) c
  ), pick as (
    select s.id, l.app_share_code share, r.fetched_at
      from public.students s
      join public.student_links l on l.student_id = s.id and l.app_share_code <> ''
      left join public.app_records r on r.student_id = s.id
      left join act a on a.class_name = coalesce(s.class_name, '')
     where not s.archived
       and case when r.next_try is not null then r.next_try <= nw
                when r.fetched_at is null then true
                else r.fetched_at <= nw - (case when coalesce(a.on_, false) then interval '30 minutes' else interval '24 hours' end) end
     order by (r.fetched_at is null) desc, r.fetched_at nulls first, s.id
     limit greatest(1, least(300, coalesce(p_limit, 60)))
  ), mark as (
    insert into public.app_records (student_id, next_try)
    select id, nw + interval '10 minutes' from pick
    on conflict (student_id) do update set next_try = excluded.next_try
    returning student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'share', p.share)), '[]'::jsonb) into out
    from pick p join mark m on m.student_id = p.id;
  return jsonb_build_object('night', false, 'students', out);
end;
$$;

/* 새로고침 — 한 반 또는 몇 명 (함수가 직원인지 먼저 본다) */
create or replace function public.app_sync_targets(p_students jsonb default null, p_class text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'share', x.share)), '[]'::jsonb) from (
    select s.id, l.app_share_code share
      from public.students s join public.student_links l on l.student_id = s.id and l.app_share_code <> ''
     where not s.archived
       and ((jsonb_typeof(p_students) = 'array' and s.id::text in (select jsonb_array_elements_text(p_students)))
         or (coalesce(p_class, '') <> '' and s.class_name = p_class))
     order by s.id limit 60
  ) x;
$$;

/* 받은 결과 저장 — 실패하면 있던 기록은 두고 다음 차례를 정한다 (5 · 10 · 20 · 30분 · 링크 만료는 하루) */
create or replace function public.app_sync_save(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; okn int := 0; bad int := 0; why text;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    sid := (r ->> 'id')::uuid;
    if not exists (select 1 from public.students where id = sid) then continue; end if;
    if coalesce((r ->> 'ok')::boolean, false) then
      insert into public.app_records (student_id, data, lite, fetched_at, fail_reason, fail_at, fail_count, next_try, updated_at)
      values (sid, r -> 'data', r -> 'lite', now(), '', null, 0, null, now())
      on conflict (student_id) do update set data = excluded.data, lite = excluded.lite, fetched_at = now(),
        fail_reason = '', fail_at = null, fail_count = 0, next_try = null, updated_at = now();
      okn := okn + 1;
    else
      why := left(coalesce(r ->> 'reason', 'upstream'), 40);
      insert into public.app_records (student_id, fail_reason, fail_at, fail_count, next_try, updated_at)
      values (sid, why, now(), 1, now() + case when why = 'expired' then interval '24 hours' else interval '5 minutes' end, now())
      on conflict (student_id) do update set fail_reason = why, fail_at = now(), fail_count = public.app_records.fail_count + 1,
        next_try = now() + case when why = 'expired' then interval '24 hours'
                                else least(interval '30 minutes', interval '5 minutes' * power(2, least(public.app_records.fail_count, 4))) end,
        updated_at = now();
      bad := bad + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', okn, 'failed', bad);
end;
$$;

/* 러닝노트 · 레포트 · 학부모 화면 미리보기 — 그 학생 저장본 (없거나 이틀이 넘으면 null → 화면이 앱에서 직접) */
create or replace function public.hub_app_record(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; r public.app_records;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived or coalesce(s.app_share_code, '') = '' then return null; end if;
  select * into r from public.app_records where student_id = s.id;
  if not found then return null; end if;
  if r.fail_reason = 'expired' then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if r.data is null or r.fetched_at is null or r.fetched_at < now() - interval '48 hours' then return null; end if;
  return jsonb_build_object('ok', true, 'data', r.data, 'at', r.fetched_at);
end;
$$;

revoke all on function public.app_sync_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.app_sync_due(timestamptz, integer) to service_role;
revoke all on function public.app_sync_targets(jsonb, text) from public, anon, authenticated;
grant execute on function public.app_sync_targets(jsonb, text) to service_role;
revoke all on function public.app_sync_save(jsonb) from public, anon, authenticated;
grant execute on function public.app_sync_save(jsonb) to service_role;
revoke all on function public._app_class_active(text, date) from public, anon, authenticated;
revoke all on function public.hub_app_record(text) from public;
grant execute on function public.hub_app_record(text) to anon, authenticated;

select '과제 기록 저장 표 RLS 켜짐' as what, (select relrowsecurity from pg_class where oid = 'public.app_records'::regclass)::text as ok
union all select '받을 차례 함수', (to_regprocedure('public.app_sync_due(timestamptz,integer)') is not null)::text
union all select '러닝노트 저장본 함수', (to_regprocedure('public.hub_app_record(text)') is not null)::text;
