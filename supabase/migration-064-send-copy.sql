-- ============================================================
--  migration-064-send-copy.sql — 모든 발송 사본을 원장 휴대폰으로 (20261106g)
--  (064 는 063 다음 · 여러 번 실행해도 안전)
--
--  받는 번호 — 새 칸 없음. 원장 역할(staff.role = 'teacher') 계정이 넣어 둔 내 시험 번호 (kakao_test_phones). 비어 있으면 안 보낸다.
--  어떻게 — 발송 함수가 어디든 sms_log · kakao_log 에 줄이 남는다 → 새 줄은 copy_state = 'wait'.
--           note-remind 가 매분 copy_due 를 불러 묶음마다 사본 1통을 받아 솔라피로 보내고 copy_record 로 적는다.
--           그래서 새 발송 경로가 생겨도 기록만 남기면 사본이 빠지지 않고, 사본이 실패해도 원래 발송에는 영향이 없다.
--  묶음 — 사람 발송: 같은 사람 · 같은 이름 · 같은 종류 (화면이 나눠 보낸 것도 1통) · 자동: 반 · 받는 쪽마다 1통.
--         마지막 줄이 생기고 1분 조용하면 보낸다 (늦어도 5분).
--  본문 — 함수가 msg_copy_note 로 첫 사람 실제 글을 잠깐 맡긴다 (msg_copy_text · 보내면 지운다 · 직원도 못 읽는다).
--         안 맡긴 경로는 기록의 앞부분(60자) · 알림톡은 템플릿 글로 만든다. 휴대폰 번호 꼴은 지운다.
--  설정 — 「자동 발송 사본은 하루 한 번 저녁 9시에 모아서 받기」 (app_settings.sms_copy · 기본 바로 받기)
--  표는 그대로 · 예전 줄은 보내지 않는다 (copy_state 비어 있음).
-- ============================================================

alter table public.sms_log add column if not exists copy_state text;
alter table public.sms_log alter column copy_state set default 'wait';
alter table public.sms_log add column if not exists copy_id uuid;
alter table public.kakao_log add column if not exists copy_state text;
alter table public.kakao_log alter column copy_state set default 'wait';
alter table public.kakao_log add column if not exists copy_id uuid;
create index if not exists sms_log_copy_idx on public.sms_log (copy_state) where copy_state = 'wait';
create index if not exists kakao_log_copy_idx on public.kakao_log (copy_state) where copy_state = 'wait';

/* 첫 사람 글 — 사본을 보내면 지운다 · 정책 없음(직원도 못 읽음) */
create table if not exists public.msg_copy_text (
  log_id  uuid primary key,
  body    text not null default '',
  norm    text not null default '',
  at      timestamptz not null default now()
);
alter table public.msg_copy_text enable row level security;
revoke all on public.msg_copy_text from public, anon, authenticated;

/* 사본을 보낸 기록 — 첫 줄(반 · 인원)만 · 번호 · 본문 없음 */
create table if not exists public.msg_copy_log (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  head       text not null default '',
  n          integer not null default 0,
  failed     integer not null default 0,
  digest     boolean not null default false,
  status     text not null default 'sending',
  error      text not null default '',
  message_id text not null default '',
  sent_at    timestamptz,
  constraint msg_copy_log_status_check check (status in ('sending', 'ok', 'fail'))
);
alter table public.msg_copy_log enable row level security;
drop policy if exists msg_copy_log_staff_read on public.msg_copy_log;
create policy msg_copy_log_staff_read on public.msg_copy_log for select to authenticated using (public.is_staff());

create or replace function public._copy_phone()
returns text language sql stable security definer set search_path = public as $$
  select regexp_replace(t.phone, '\D', '', 'g')
    from public.kakao_test_phones t join public.staff s on lower(s.email) = lower(t.email)
   where s.role = 'teacher' and s.active and public._phone_ok(t.phone)
   order by s.created_at, s.email limit 1;
$$;
create or replace function public._copy_digest()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> 'digest')::boolean from public.app_settings where key = 'sms_copy'), false);
$$;
/* 묶음의 사본 상태 — 보낸 기록 화면 */
create or replace function public._copy_state(s text[])
returns text language sql immutable as $$
  select case when 'fail' = any(s) then 'fail' when 'wait' = any(s) or 'sending' = any(s) then 'wait'
              when 'sent' = any(s) then 'sent' when 'none' = any(s) then 'none' else '' end;
$$;
/* 전화번호 꼴은 사본에 넣지 않는다 */
create or replace function public._copy_clean(t text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}', '(번호)', 'g');
$$;
/* 2000바이트 안으로 */
create or replace function public._copy_cut(t text)
returns text language plpgsql stable set search_path = public as $$
declare x text := t;
begin
  while public._sms_bytes(x) > 1990 loop x := left(x, char_length(x) - 60); end loop;
  return case when x = t then x else x || E'\n…(뒤 생략)' end;
end;
$$;

/* 함수가 보내고 나서 — 첫 사람 실제 글 · 사람마다 다른지 볼 글 (번호 없음) */
create or replace function public.msg_copy_note(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; k int := 0; t text; nm text; lid uuid;
begin
  if not (public.is_staff() or coalesce(auth.jwt() ->> 'role', '') = 'service_role' or current_setting('role', true) = 'service_role') then
    raise exception 'staff 로 등록된 계정만 할 수 있습니다.';
  end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    begin lid := (r ->> 'log_id')::uuid; exception when others then continue; end;
    if not exists (select 1 from public.sms_log l where l.id = lid and l.copy_state = 'wait' and not l.test) then continue; end if;
    t := public._copy_clean(left(coalesce(r ->> 'text', ''), 2000)); nm := coalesce(r ->> 'name', '');
    insert into public.msg_copy_text (log_id, body, norm)
    values (lid, case when k = 0 then t else '' end,
            md5(regexp_replace(case when nm <> '' then replace(t, nm, '') else t end, 'https?://[^[:space:]]+', '', 'g')))
    on conflict (log_id) do nothing;
    k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', k);
end;
$$;

/* 받는 쪽 — 「학부모 11명」 「학부모 3명 · 학생 2명」 */
create or replace function public._copy_who(rows jsonb)
returns text language sql stable as $$
  select string_agg(w || ' ' || c || '명', ' · ' order by o) from (
    select case when t in ('parent1', 'parent2', 'parent') then '학부모' when t = 'student' then '학생' when t = 'staff' then '운영진' else '받는 사람' end w,
           min(case when t in ('parent1', 'parent2', 'parent') then 1 when t = 'student' then 2 when t = 'staff' then 3 else 4 end) o, count(*) c
      from (select e ->> 'target' t from jsonb_array_elements(rows) e) x group by 1) y;
$$;
create or replace function public._copy_classes(rows jsonb)
returns text language sql stable as $$
  select case when count(*) = 0 then '' when count(*) <= 3 then string_agg(c, ' · ' order by c)
              else (array_agg(c order by c))[1] || ' 외 ' || (count(*) - 1) || '개 반' end
    from (select distinct nullif(e ->> 'cls', '') c from jsonb_array_elements(rows) e) x where c is not null;
$$;
/* 묶음 한 줄 — 「목동반 학부모 11명 · 자동(수업 전 예고)」 */
create or replace function public._copy_line(rows jsonb, p_auto boolean, p_label text, p_by text)
returns text language sql stable set search_path = public as $$
  select btrim(public._copy_classes(rows) || ' ' || public._copy_who(rows)) || ' · ' ||
    case when p_auto then '자동(' || coalesce(nullif(regexp_replace(p_label, '\((학생|운영진)\)$', ''), ''), '발송') || ')'
         else '사람 발송' || coalesce('(' || (select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(p_by) limit 1) || ')', '') ||
              case when coalesce(p_label, '') <> '' then ' · ' || p_label else '' end end;
$$;

/* 매분 — 보낼 때가 된 사본 (note-remind · service_role 만) */
create or replace function public.copy_due(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph text := public._copy_phone();
  dg boolean := public._copy_digest();
  nw timestamptz := coalesce(p_now, now());
  kst timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  out jsonb := '[]'::jsonb;
  g record; cid uuid; ids uuid[]; txt text; line text; body text; firstn text; fails int; vary boolean; lesson text; r0 jsonb;
  dl text[] := '{}'; dn int := 0; dfail int := 0; dids uuid[] := '{}'; last_d text;
begin
  /* 시험 발송 줄은 사본 없음 · 오래 남은 글은 지운다 */
  update public.sms_log set copy_state = 'test' where copy_state = 'wait' and test;
  update public.kakao_log set copy_state = 'test' where copy_state = 'wait' and test;
  delete from public.msg_copy_text where at < nw - interval '3 days';
  /* 번호가 비어 있으면 사본을 보내지 않는다 (나중에 넣어도 밀린 것을 한꺼번에 보내지 않는다) */
  if ph is null then
    update public.sms_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    update public.kakao_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    delete from public.msg_copy_text t where not exists (select 1 from public.sms_log l where l.id = t.log_id and l.copy_state = 'wait');
    return jsonb_build_object('to', '', 'messages', '[]'::jsonb);
  end if;
  for g in
    with r as (
      select 's' src, l.id, l.created_at at, l.status, l.name, l.class_name cls, l.target, l.body_head, l.created_by by_email,
             coalesce(b.label, '') label, coalesce(b.purpose, '') purpose, coalesce(b.created_by, '') = '자동' auto, null::date week, l.student_id
        from public.sms_log l left join public.sms_batches b on b.id = l.batch_id where l.copy_state = 'wait'
      union all
      select 'k', k.id, k.created_at, k.status, s.name, s.class_name, 'parent', '', k.created_by,
             '레포트 알림톡', 'report', false, k.week_start, k.student_id
        from public.kakao_log k left join public.students s on s.id = k.student_id where k.copy_state = 'wait'
    )
    select r.src, r.auto, r.label, r.by_email, min(r.at) first_at, max(r.at) last_at,
           count(*) filter (where r.status = 'pending' and r.at >= nw - interval '15 minutes') busy,
           jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'status', r.status, 'name', r.name, 'cls', r.cls, 'target', r.target,
                                        'body_head', r.body_head, 'week', r.week, 'student_id', r.student_id) order by r.at, r.name) as rows
      from r
     group by r.src, r.auto, r.label, r.by_email, r.purpose, case when r.auto then r.cls else '' end,
              case when r.auto then case when r.target = 'staff' then 'staff' else 'x' end else '' end
     order by min(r.at)
  loop
    if g.busy > 0 then continue; end if;
    if not (g.auto and dg) and g.last_at > nw - interval '1 minute' and g.first_at > nw - interval '5 minutes' then continue; end if;
    select array_agg((e ->> 'id')::uuid), count(*) filter (where e ->> 'status' <> 'ok') into ids, fails from jsonb_array_elements(g.rows) e;
    line := public._copy_line(g.rows, g.auto, g.label, g.by_email);
    /* 저녁 9시에 모아 받기 */
    if g.auto and dg then
      dl := dl || ('· ' || to_char((g.first_at at time zone 'Asia/Seoul'), 'HH24:MI') || ' ' || line || case when fails > 0 then ' · ' || fails || '명 실패' else '' end);
      dn := dn + jsonb_array_length(g.rows); dfail := dfail + fails; dids := dids || ids;
      continue;
    end if;
    /* 첫 사람 글 */
    select t.body into body from public.msg_copy_text t where t.log_id = any(ids) and t.body <> '' order by t.at limit 1;
    select e into r0 from jsonb_array_elements(g.rows) e
      left join public.msg_copy_text t on t.log_id = (e ->> 'id')::uuid and t.body <> '' order by (t.log_id is null), e ->> 'at' limit 1;
    firstn := r0 ->> 'name';
    if g.src = 'k' then
      select public._kdate(case when coalesce(p.report_data ->> 'lessonDate', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p.report_data ->> 'lessonDate', 10)::date else p.week_start end)
        into lesson from public.published p where p.student_id = (r0 ->> 'student_id')::uuid and p.week_start = (r0 ->> 'week')::date;
      body := '[마라톤국어] ' || coalesce(firstn, '') || E' 학생 주간 레포트\n\n' || coalesce(firstn, '') || ' 학생의 ' || coalesce(lesson, '') || E' 수업 레포트가 올라왔습니다.\n아래 버튼을 눌러 확인해 주세요.\n(알림톡 · [레포트 보기] 버튼)';
    elsif body is null then
      body := public._copy_clean(r0 ->> 'body_head') || '…(앞부분)';
    end if;
    select count(distinct t.norm) > 1 into vary from public.msg_copy_text t where t.log_id = any(ids);
    txt := '[사본] ' || line ||
           case when fails > 0 then E'\n' || fails || '명 실패' else '' end ||
           case when coalesce(vary, false) then E'\n사람마다 숫자 다름' else '' end ||
           case when jsonb_array_length(g.rows) > 1 and coalesce(firstn, '') <> '' then E'\n첫 사람: ' || firstn else '' end ||
           E'\n\n' || body;
    txt := public._copy_cut(public._copy_clean(txt));
    insert into public.msg_copy_log (head, n, failed) values (left(line, 200), jsonb_array_length(g.rows), fails) returning id into cid;
    update public.sms_log set copy_state = 'sending', copy_id = cid where id = any(ids);
    update public.kakao_log set copy_state = 'sending', copy_id = cid where id = any(ids);
    out := out || jsonb_build_object('id', cid, 'text', txt, 'kind', case when g.src = 'k' or public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end);
  end loop;
  /* 모아 받기 — 저녁 9시부터 그날 한 번 */
  if dg and dn > 0 and kst::time >= time '21:00' then
    select value ->> 'lastDigest' into last_d from public.app_settings where key = 'sms_copy';
    if coalesce(last_d, '') < to_char(kst, 'YYYY-MM-DD') then
      txt := public._copy_cut(public._copy_clean('[사본] 자동 발송 모음 · ' || to_char(kst, 'FMMM/FMDD') || ' · ' || dn || '건' ||
             case when dfail > 0 then E'\n' || dfail || '명 실패' else '' end || E'\n\n' || array_to_string(dl, E'\n')));
      insert into public.msg_copy_log (head, n, failed, digest) values ('자동 발송 모음', dn, dfail, true) returning id into cid;
      update public.sms_log set copy_state = 'sending', copy_id = cid where id = any(dids);
      update public.kakao_log set copy_state = 'sending', copy_id = cid where id = any(dids);
      update public.app_settings set value = value || jsonb_build_object('lastDigest', to_char(kst, 'YYYY-MM-DD')) where key = 'sms_copy';
      out := out || jsonb_build_object('id', cid, 'text', txt, 'kind', 'LMS');
    end if;
  end if;
  return jsonb_build_object('to', ph, 'messages', out);
end;
$$;

/* 보낸 결과 — 글을 지운다 */
create or replace function public.copy_record(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; ok boolean; cid uuid; n int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    cid := (r ->> 'id')::uuid; ok := coalesce((r ->> 'ok')::boolean, false);
    update public.msg_copy_log set status = case when ok then 'ok' else 'fail' end, error = left(coalesce(r ->> 'error', ''), 200),
           message_id = left(coalesce(r ->> 'message_id', ''), 80), sent_at = now() where id = cid;
    update public.sms_log set copy_state = case when ok then 'sent' else 'fail' end where copy_id = cid;
    update public.kakao_log set copy_state = case when ok then 'sent' else 'fail' end where copy_id = cid;
    delete from public.msg_copy_text t where t.log_id in (select l.id from public.sms_log l where l.copy_id = cid);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'done', n);
end;
$$;

/* 설정 — 연결 상태 화면 */
create or replace function public.sms_copy_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('on', public._copy_phone() is not null, 'digest', public._copy_digest());
end;
$$;
create or replace function public.sms_copy_digest_set(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  insert into public.app_settings (key, value) values ('sms_copy', jsonb_build_object('digest', coalesce(p_on, false)))
  on conflict (key) do update set value = public.app_settings.value || jsonb_build_object('digest', coalesce(p_on, false));
  return public.sms_copy_status();
end;
$$;

/* 보낸 기록 — 묶음마다 사본 상태(copy) */
create or replace function public.sms_batch_list(p_from date default null, p_to date default null, p_class text default null,
                                                 p_student uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_agg(g order by g.at desc)
    from (
      select * from (
        select 's:' || l.batch_id::text as key, 'sms' as via, min(l.created_at) as at,
               coalesce(max(b.label), '') as label, coalesce(max(b.purpose), '') as purpose, bool_or(l.test) as test,
               coalesce(max(b.body), max(l.body_head)) as body,
               (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(array_agg(nullif(l.class_name, ''))) c where c is not null) as classes,
               count(*)::int as n,
               count(*) filter (where l.status = 'ok')::int as ok,
               count(*) filter (where l.status = 'fail')::int as fail,
               case when public._copy_state(array_agg(l.copy_state)) = 'wait' and public._copy_digest() and coalesce(max(b.created_by), '') = '자동' then 'digest'
                    else public._copy_state(array_agg(l.copy_state)) end as copy,
               max(l.created_by) as by_email,
               null::date as week
        from public.sms_log l left join public.sms_batches b on b.id = l.batch_id
        where (p_from is null or (l.created_at at time zone 'Asia/Seoul')::date >= p_from)
          and (p_to is null or (l.created_at at time zone 'Asia/Seoul')::date <= p_to)
        group by l.batch_id
        having (p_class is null or p_class = '' or bool_or(l.class_name = p_class))
           and (p_student is null or bool_or(l.student_id = p_student))
        union all
        select 'k:' || coalesce(k.week_start::text, '') || '|' || k.created_by || '|' || to_char(date_trunc('minute', k.created_at), 'YYYYMMDDHH24MI') || '|' || case when k.test then 't' else 'f' end as key,
               'kakao' as via, min(k.created_at) as at, '알림톡 · 레포트 안내' as label, 'report' as purpose, bool_or(k.test) as test, '' as body,
               (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(array_agg(nullif(s.class_name, ''))) c where c is not null) as classes,
               count(*)::int, count(*) filter (where k.status = 'ok')::int, count(*) filter (where k.status = 'fail')::int,
               public._copy_state(array_agg(k.copy_state)),
               max(k.created_by), max(k.week_start)
        from public.kakao_log k left join public.students s on s.id = k.student_id
        where (p_from is null or (k.created_at at time zone 'Asia/Seoul')::date >= p_from)
          and (p_to is null or (k.created_at at time zone 'Asia/Seoul')::date <= p_to)
        group by k.week_start, k.created_by, date_trunc('minute', k.created_at), k.test
        having (p_class is null or p_class = '' or bool_or(s.class_name = p_class))
           and (p_student is null or bool_or(k.student_id = p_student))
      ) u
      order by u.at desc
      limit greatest(1, least(500, coalesce(p_limit, 100)))
    ) g0
    cross join lateral (
      select g0.*, coalesce((select nullif(btrim(sf.name), '') from public.staff sf where lower(sf.email) = lower(g0.by_email)), g0.by_email) as by_name
    ) g
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.copy_due(timestamptz) from public, anon, authenticated;
grant execute on function public.copy_due(timestamptz) to service_role;
revoke all on function public.copy_record(jsonb) from public, anon, authenticated;
grant execute on function public.copy_record(jsonb) to service_role;
revoke all on function public.msg_copy_note(jsonb) from public, anon;
grant execute on function public.msg_copy_note(jsonb) to authenticated, service_role;
revoke all on function public.sms_copy_status() from public, anon;
grant execute on function public.sms_copy_status() to authenticated;
revoke all on function public.sms_copy_digest_set(boolean) from public, anon;
grant execute on function public.sms_copy_digest_set(boolean) to authenticated;

select '사본 받을 번호(원장 시험 번호) 있음' as what, (public._copy_phone() is not null)::text as ok
union all select '모아 받기', public._copy_digest()::text
union all select '예전 기록은 보내지 않음', (not exists (select 1 from public.sms_log where copy_state = 'wait' and created_at < now() - interval '1 hour'))::text;
