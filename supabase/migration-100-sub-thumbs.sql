-- ============================================================
--  migration-100-sub-thumbs.sql — 학생 제출물 보기 · 작은 미리보기 (20261110j)
--  (100 은 099 다음 · 065 · 099 가 먼저 · 여러 번 실행해도 안전 · 그다음 함수 app-sync 다시 배포 · king-pick 다시 배포 · sub-view 새로 배포)
--
--  새 데이터는 모으지 않는다 — app-sync 가 이미 저장하는 제출물 주소(app_records.subs · 099)만 쓴다
--  1. 보관함 sub-thumbs (비공개 · JPEG · 장당 300KB) — 제출물마다 작은 미리보기(긴 변 600px 안팎) 하나만 · 원본은 앱 주소 그대로(복사 안 함)
--  2. sub_files — 학생 · 제출물 주소 한 줄 · 미리보기 상태(wait 만들 차례 · ok · fail · pdf 코치룸에서 그림) · PDF 대표 쪽(page · by ai / ink) · 정성 점수(care · 코치룸만)
--     king_subs_save(099) 가 subs 를 받을 때 같이 채운다(이미지 · PDF · 최근 120일)
--  3. 서버(sub-view · king-pick)만 — sub_thumb_due · sub_thumb_done · sub_page_set
--  4. 코치룸 — sub_list_staff(학생 · 기간) · sub_list_class(반 · 날짜) · 러닝노트 — hub_sub_list(그 학생 링크로만 · 그 학생 것만 · 점수 없음)
--  5. 예약 — 10분마다 sub-view 미리보기 만들기(한 번에 10장 · 조금씩)
--  문자 · 알림톡 없음 · 학생 기록은 바꾸지 않는다
-- ============================================================

-- ------------------------------------------------------------
--  1. 보관함
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sub-thumbs', 'sub-thumbs', false, 307200, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
/* 올리기 · 서명 주소는 함수(service_role)만 — 화면에 보관함 경로를 보내지 않는다 */

-- ------------------------------------------------------------
--  2. 제출물
-- ------------------------------------------------------------
create table if not exists public.sub_files (
  id          bigserial primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  src         text not null,
  kind        text not null default 'image',
  sub_at      timestamptz,
  sub_day     date,
  title       text not null default '',
  page        integer,
  page_by     text not null default '',
  care        integer,
  path        text not null default '',
  w           integer,
  h           integer,
  status      text not null default 'wait',
  tries       integer not null default 0,
  made_at     timestamptz,
  constraint sub_files_kind check (kind in ('image', 'pdf')),
  constraint sub_files_status check (status in ('wait', 'ok', 'fail', 'pdf')),
  constraint sub_files_one unique (student_id, src)
);
create index if not exists sub_files_day_idx on public.sub_files (student_id, sub_day);
create index if not exists sub_files_due_idx on public.sub_files (status, sub_at desc) where status = 'wait';
alter table public.sub_files enable row level security;
drop policy if exists sub_files_staff_read on public.sub_files;
create policy sub_files_staff_read on public.sub_files for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.sub_files from anon, authenticated;
revoke all on public.sub_files from anon;

/* 099 의 king_subs_save — subs 를 받을 때 sub_files 도 (이미지 · PDF · 같은 주소면 날짜 · 이름만 고침 · 만든 미리보기는 그대로) */
create or replace function public.king_subs_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; s jsonb; f jsonb; n int := 0; sid uuid; u text; t text;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' or jsonb_typeof(r -> 'subs') <> 'array' then continue; end if;
    sid := (r ->> 'id')::uuid;
    update public.app_records set subs = r -> 'subs', subs_at = now() where student_id = sid;
    if not found then continue; end if;
    n := n + 1;
    for s in select * from jsonb_array_elements(r -> 'subs') loop
      if left(coalesce(s ->> 'submittedAt', ''), 10) !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
      for f in select * from jsonb_array_elements(case when jsonb_typeof(s -> 'files') = 'array' then s -> 'files' else '[]'::jsonb end) loop
        u := left(coalesce(f ->> 'url', ''), 400);
        if u !~ '^(/(objects|uploads)/|https://(www\.)?marathonstudy\.com/)' then continue; end if;
        t := lower(coalesce(f ->> 'type', ''));
        insert into public.sub_files (student_id, src, kind, sub_at, sub_day, title, status)
        values (sid, u, case when t = 'application/pdf' or u ~* '\.pdf(\?|$)' then 'pdf' else 'image' end,
                (s ->> 'submittedAt')::timestamptz, ((s ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date,
                left(coalesce(s ->> 'title', ''), 200),
                case when t = 'application/pdf' or u ~* '\.pdf(\?|$)' then 'pdf' else 'wait' end)
        on conflict (student_id, src) do update set sub_at = excluded.sub_at, sub_day = excluded.sub_day, title = excluded.title;
      end loop;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.king_subs_save(jsonb) from public, anon, authenticated;
grant execute on function public.king_subs_save(jsonb) to service_role;

/* 이미 받아 둔 subs(099 뒤 app-sync) 도 한 번 — 같은 주소는 건너뜀 */
insert into public.sub_files (student_id, src, kind, sub_at, sub_day, title, status)
select r.student_id, left(f ->> 'url', 400),
       case when lower(coalesce(f ->> 'type', '')) = 'application/pdf' or (f ->> 'url') ~* '\.pdf(\?|$)' then 'pdf' else 'image' end,
       (s ->> 'submittedAt')::timestamptz, ((s ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date, left(coalesce(s ->> 'title', ''), 200),
       case when lower(coalesce(f ->> 'type', '')) = 'application/pdf' or (f ->> 'url') ~* '\.pdf(\?|$)' then 'pdf' else 'wait' end
  from public.app_records r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.subs) = 'array' then r.subs else '[]'::jsonb end) s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s -> 'files') = 'array' then s -> 'files' else '[]'::jsonb end) f
 where left(coalesce(s ->> 'submittedAt', ''), 10) ~ '^\d{4}-\d{2}-\d{2}$'
   and coalesce(f ->> 'url', '') ~ '^(/(objects|uploads)/|https://(www\.)?marathonstudy\.com/)'
on conflict (student_id, src) do nothing;

-- ------------------------------------------------------------
--  3. 서버만
-- ------------------------------------------------------------
/* 미리보기 만들 차례 — 이미지만 · 최근 낸 것부터 · 3번 실패하면 그만 */
create or replace function public.sub_thumb_due(p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'sid', x.student_id, 'src', x.src, 'kind', x.kind, 'page', x.page)), '[]'::jsonb)
    from (select * from public.sub_files where status = 'wait' and tries < 3 order by sub_at desc nulls last limit greatest(1, least(p_limit, 30))) x;
$$;
revoke all on function public.sub_thumb_due(integer) from public, anon, authenticated;
grant execute on function public.sub_thumb_due(integer) to service_role;

/* 다 만들었거나 못 만듦 — p_ok false 면 tries + 1 (3번이면 fail) */
create or replace function public.sub_thumb_done(p_id bigint, p_ok boolean, p_path text, p_w integer, p_h integer, p_page integer default null, p_by text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update public.sub_files set status = 'ok', path = left(coalesce(p_path, ''), 300), w = p_w, h = p_h, made_at = now(),
           page = coalesce(p_page, page), page_by = coalesce(nullif(p_by, ''), page_by) where id = p_id;
  else
    update public.sub_files set tries = tries + 1, status = case when tries + 1 >= 3 then 'fail' else status end where id = p_id;
  end if;
  return found;
end;
$$;
revoke all on function public.sub_thumb_done(bigint, boolean, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.sub_thumb_done(bigint, boolean, text, integer, integer, integer, text) to service_role;

/* king-pick — PDF 대표 쪽(AI 가 풀이 흔적이 가장 많다고 본 쪽) · 사진마다 정성 점수(코치룸 · 대표 고르기에만) */
create or replace function public.sub_page_set(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'sid', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    update public.sub_files set
      page = case when (r ->> 'page') ~ '^\d{1,4}$' and (r ->> 'page')::int >= 1 then (r ->> 'page')::int else page end,
      page_by = case when (r ->> 'page') ~ '^\d{1,4}$' then 'ai' else page_by end,
      care = case when (r ->> 'care') ~ '^\d{1,3}$' then least(100, (r ->> 'care')::int) else care end,
      /* 대표 쪽이 바뀐 PDF 는 코치룸에서 다시 그림 */
      status = case when kind = 'pdf' and (r ->> 'page') ~ '^\d{1,4}$' and page is distinct from (r ->> 'page')::int then 'pdf' else status end
     where student_id = (r ->> 'sid')::uuid and src = left(coalesce(r ->> 'src', ''), 400);
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.sub_page_set(jsonb) from public, anon, authenticated;
grant execute on function public.sub_page_set(jsonb) to service_role;

-- ------------------------------------------------------------
--  4. 보기
-- ------------------------------------------------------------
create or replace function public._sub_row(f public.sub_files, p_staff boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', f.id, 'day', f.sub_day, 'at', f.sub_at, 'title', f.title, 'kind', f.kind, 'page', f.page, 'src', f.src,
                            'status', f.status, 'path', f.path, 'w', f.w, 'h', f.h)
         || case when p_staff then jsonb_build_object('sid', f.student_id, 'care', f.care, 'page_by', f.page_by) else '{}'::jsonb end;
$$;
revoke all on function public._sub_row(public.sub_files, boolean) from public, anon, authenticated;

/* 코치룸 — 한 학생 · 기간 */
create or replace function public.sub_list_staff(p_student uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(public._sub_row(f, true) order by f.sub_at, f.id) from public.sub_files f
     where f.student_id = p_student and f.sub_day between p_from and least(p_to, p_from + 62)), '[]'::jsonb) end;
$$;
revoke all on function public.sub_list_staff(uuid, date, date) from public, anon;
grant execute on function public.sub_list_staff(uuid, date, date) to authenticated;

/* 코치룸 — 반 · 그날 낸 학생들 (학생별) */
create or replace function public.sub_list_class(p_class text, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(jsonb_build_object('sid', s.id, 'name', s.name, 'files',
             (select jsonb_agg(public._sub_row(f, true) order by f.sub_at, f.id) from public.sub_files f where f.student_id = s.id and f.sub_day = p_day)) order by s.name)
      from public.students s
     where not s.archived and s.class_name = p_class and exists (select 1 from public.sub_files f where f.student_id = s.id and f.sub_day = p_day)), '[]'::jsonb) end;
$$;
revoke all on function public.sub_list_class(text, date) from public, anon;
grant execute on function public.sub_list_class(text, date) to authenticated;

/* 코치룸 — 제출물 하나 (PDF 대표 쪽 그리기 · 미리보기 올리기 · sub-view 가 사용자 권한으로 부른다) */
create or replace function public.sub_file_get(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else (select public._sub_row(f, true) from public.sub_files f where f.id = p_id) end;
$$;
revoke all on function public.sub_file_get(bigint) from public, anon;
grant execute on function public.sub_file_get(bigint) to authenticated;

/* 러닝노트 — 그 학생 링크(학생 · 학부모)로만 · 그 학생 것만 · 점수 · 근거 없음 · 대표(rep) = 정성 점수 높은 것 1~2개(없으면 최근 것) */
create or replace function public.hub_sub_list(p_code text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; rows jsonb;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  rows := coalesce((select jsonb_agg(public._sub_row(f, false) order by f.sub_at, f.id) from public.sub_files f
                     where f.student_id = s.id and f.sub_day between p_from and least(p_to, p_from + 31)), '[]'::jsonb);
  return jsonb_build_object('files', rows, 'rep', coalesce((
    select jsonb_agg(x.id) from (select f.id from public.sub_files f
      where f.student_id = s.id and f.sub_day between p_from and least(p_to, p_from + 31) and (f.status = 'ok' or f.kind = 'pdf')
      order by f.care desc nulls last, f.sub_at desc limit 2) x), '[]'::jsonb));
end;
$$;
revoke all on function public.hub_sub_list(text, date, date) from public;
grant execute on function public.hub_sub_list(text, date, date) to anon, authenticated, service_role;

-- ------------------------------------------------------------
--  5. 예약 — 10분마다 미리보기 조금씩 (함수 sub-view 를 먼저 배포 · 열쇠는 필기 알림과 같은 DB 값)
--     끄려면: select cron.unschedule('sub-thumbs');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sub-thumbs') then perform cron.unschedule('sub-thumbs'); end if;
end;
$$;
select cron.schedule('sub-thumbs', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/sub-view',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '미리보기 보관함(sub-thumbs · 비공개)' as what, exists (select 1 from storage.buckets where id = 'sub-thumbs' and not public)::text as ok
union all select '제출물 표(sub_files)', (to_regclass('public.sub_files') is not null)::text
union all select 'subs 를 받을 때 제출물도(king_subs_save)', (position('sub_files' in pg_get_functiondef('public.king_subs_save(jsonb)'::regprocedure)) > 0)::text
union all select '러닝노트 — 그 학생 것만(hub_sub_list)', exists (select 1 from pg_proc where proname = 'hub_sub_list')::text
union all select '10분마다 미리보기(sub-thumbs)', exists (select 1 from cron.job where jobname = 'sub-thumbs')::text
union all select '지금 제출물 ' || (select count(*) from public.sub_files) || '개 · 미리보기 ' || (select count(*) from public.sub_files where status = 'ok') || '개', 'true';
