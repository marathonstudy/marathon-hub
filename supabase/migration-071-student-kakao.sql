-- ============================================================
--  migration-071-student-kakao.sql — 레포트 안내를 학생에게도 학생용 알림톡으로 (20261108c)
--  (071 은 070 다음 · 여러 번 실행해도 안전 · 그다음 함수 kakao-send 다시 배포)
--
--  템플릿 코드 — 코드 파일에 쓰지 않는다. 설정 app_settings 'kakao_tpl' { student } · 원장만 고친다 (kakao_tpl_set)
--    비어 있으면 학생은 지금처럼 문자 · 코드가 있으면 학생은 학생용 알림톡 「주간레포트안내_학생」
--    학생용 템플릿 변수 #{날짜} #{이름} #{링크} · 버튼 [레포트 보기](웹링크 #{링크}) — #{링크} = 학생 링크 전체 주소
--    학부모는 그대로 기존 「주간레포트안내」(Secrets 의 SOLAPI_TEMPLATE_ID · 변수 #{이름} #{수업일} #{코드}) — 기존 템플릿은 건드리지 않는다
--  1. kakao_log.target — parent(지금까지 모두) · student. 「이미 보냄」은 받는 쪽마다 따로 본다
--  2. kakao_prepare_student — 학생 번호 · 학생 링크로 보낼 줄 (공개 전 · 학생 링크 없음 · 번호 없음 · 학부모와 같은 번호 · 이미 보냄은 건너뜀)
--  3. kakao_status — 학생마다 학생 번호 · 학생 링크 · 학생 알림톡 마지막 결과 · 학생용 템플릿이 있는지
--  4. 사본 — 레포트 안내 한 번 = 한 통 (알림톡 학부모 · 학생 · 그때 같이 나간 레포트 안내 문자 · 대체 문자를 묶는다)
--       「[사본] 목동반 · 레포트 안내 · 알림톡 학부모 10명 / 학생 10명 · 대체 문자 1명」
--       「[사본] 목동반 · 레포트 안내 · 알림톡 학부모 10명 · 문자 학생 10명」 (학생용 코드가 없을 때)
--  대체 문자 — 카톡이 없어 나중에 실패하면 솔라피가 문자로 대신 보낸다(지금과 같음).
--       솔라피가 바로 받지 않은 사람은 코치룸이 문자로 대신 보낸다 (보낸 기록 이름 「대체 문자」 · 학생 = 학생 문자 문구 · 학부모 = 그 문자 문구)
-- ============================================================

alter table public.kakao_log add column if not exists target text not null default 'parent';
alter table public.kakao_log drop constraint if exists kakao_log_target_check;
alter table public.kakao_log add constraint kakao_log_target_check check (target in ('parent', 'student'));

insert into public.app_settings (key, value) values ('kakao_tpl', jsonb_build_object('student', ''))
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  1. 템플릿 코드 설정 — 원장만 고친다
-- ------------------------------------------------------------
create or replace function public._kakao_tpl()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('student', coalesce(btrim(v ->> 'student'), ''))
    from (select coalesce((select value from public.app_settings where key = 'kakao_tpl'), '{}'::jsonb) v) x;
$$;
revoke all on function public._kakao_tpl() from public, anon, authenticated;

create or replace function public.kakao_tpl_set(p_kind text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := btrim(coalesce(p_kind, '')); c text := btrim(coalesce(p_code, ''));
begin
  if not public._real_teacher() then raise exception '알림톡 템플릿 코드는 원장 계정만 바꿀 수 있습니다.'; end if;
  if k not in ('student') then raise exception '알 수 없는 템플릿 종류입니다.'; end if;
  if c <> '' and c !~ '^[A-Za-z0-9_-]{4,80}$' then raise exception '템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드(예: KA01TP…)를 그대로 넣어 주세요.'; end if;
  insert into public.app_settings (key, value) values ('kakao_tpl', jsonb_build_object(k, c))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object(k, c);
  return jsonb_build_object('ok', true, 'kind', k, 'set', c <> '');
end;
$$;
revoke all on function public.kakao_tpl_set(text, text) from public, anon;
grant execute on function public.kakao_tpl_set(text, text) to authenticated;

/* 설정 읽기 (020 과 같고 템플릿 코드를 더함 — 코드 값은 원장에게만 · 조교에게는 있음/없음) */
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
    'tpl', case when own then t else '{}'::jsonb end);
end;
$$;


-- ------------------------------------------------------------
--  2. 학부모 보낼 줄 (020 과 같고 「이미 보냄」을 학부모 줄로만)
-- ------------------------------------------------------------
create or replace function public.kakao_prepare(p_week date, p_students uuid[], p_resend boolean default false, p_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._kakao_cfg();
  ids uuid[] := coalesce(p_students, '{}');
  rows jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  s record;
  ph text;
  n int := 0;
  tphone text;
  lid uuid;
  lesson text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_week is null then raise exception '주차를 골라 주세요.'; end if;
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '보낼 학생을 골라 주세요.'); end if;
  if cardinality(ids) > 100 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '한 번에 100명까지 보낼 수 있습니다.'); end if;

  if p_test then
    select phone into tphone from public.kakao_test_phones where email = me;
    if tphone is null or not public._phone_ok(tphone) then
      return jsonb_build_object('ok', false, 'reason', 'notest', 'message', '먼저 [설정]에서 내 시험 번호를 넣어 주세요.');
    end if;
  end if;

  for s in
    select st.id, st.name, st.parent_title, st.parent_phone, st.parent_phone2, coalesce(l.hub_code, '') as code,
           p.week_start as pw, p.report_data ->> 'lessonDate' as ld
    from unnest(ids) with ordinality u(id, ord)
    join public.students st on st.id = u.id and not st.archived
    left join public.student_links l on l.student_id = st.id
    left join public.published p on p.student_id = st.id and p.week_start = p_week and p.visible
    order by u.ord
  loop
    if s.pw is null then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'unpublished'); continue; end if;
    if s.code = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nolink'); continue; end if;
    lesson := public._kdate(case when coalesce(s.ld, '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.ld, 10)::date else s.pw end);

    if p_test then
      if public._kakao_today_count() + 1 > (cfg ->> 'dailyMax')::int then
        return jsonb_build_object('ok', false, 'reason', 'daily', 'message', '오늘 보낼 수 있는 건수(' || (cfg ->> 'dailyMax') || '건)를 다 썼습니다.');
      end if;
      insert into public.kakao_log (week_start, student_id, test, phone_last4, title, sms_fallback, created_by)
      values (p_week, s.id, true, right(regexp_replace(tphone, '\D', '', 'g'), 4), '시험', (cfg ->> 'smsFallback')::boolean, me)
      returning id into lid;
      rows := jsonb_build_array(jsonb_build_object('log_id', lid, 'student_id', s.id, 'to', regexp_replace(tphone, '\D', '', 'g'),
                'name', s.name, 'lesson', lesson, 'code', s.code));
      exit;
    end if;

    if not p_resend and exists (select 1 from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test and k.status = 'ok' and k.target = 'parent') then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'already'); continue;
    end if;
    if not (public._phone_ok(s.parent_phone) or public._phone_ok(s.parent_phone2)) then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nophone'); continue;
    end if;
    foreach ph in array array(select distinct regexp_replace(x, '\D', '', 'g') from unnest(array[s.parent_phone, s.parent_phone2]) x where public._phone_ok(x)) loop
      n := n + 1;
      rows := rows || jsonb_build_object('student_id', s.id, 'to', ph, 'name', s.name, 'lesson', lesson, 'code', s.code,
                'title', coalesce(nullif(btrim(s.parent_title), ''), '학부모님'));
    end loop;
  end loop;

  if p_test and jsonb_array_length(rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'unpublished', 'message', '이 주에 공개된 레포트가 있는 학생을 하나 골라 주세요.', 'skipped', skipped);
  end if;
  if not p_test and n > 0 and public._kakao_today_count() + n > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._kakao_today_count() || '건 · 이번 ' || n || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;

  if not p_test then
    rows := coalesce((
      select jsonb_agg(r || jsonb_build_object('log_id', public._kakao_log_new(p_week, (r ->> 'student_id')::uuid, r ->> 'to', r ->> 'title', (cfg ->> 'smsFallback')::boolean, me)))
      from jsonb_array_elements(rows) r), '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'rows', rows, 'skipped', skipped, 'smsFallback', (cfg ->> 'smsFallback')::boolean, 'test', p_test);
end;
$$;


-- ------------------------------------------------------------
--  3. 학생 보낼 줄 — 학생용 템플릿 코드 · 학생 번호 · 학생 링크
-- ------------------------------------------------------------
create or replace function public.kakao_prepare_student(p_week date, p_students uuid[], p_resend boolean default false, p_site text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._kakao_cfg();
  tpl text := public._kakao_tpl() ->> 'student';
  ids uuid[] := coalesce(p_students, '{}');
  site text := coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub');
  rows jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  s record;
  d text;
  lid uuid;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if coalesce(tpl, '') = '' then return jsonb_build_object('ok', false, 'reason', 'notpl', 'message', '학생용 레포트 알림톡 템플릿 코드가 설정에 없습니다.'); end if;
  if p_week is null then raise exception '주차를 골라 주세요.'; end if;
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '보낼 학생을 골라 주세요.'); end if;
  if cardinality(ids) > 100 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '한 번에 100명까지 보낼 수 있습니다.'); end if;
  if site !~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]*)?$' then site := 'https://marathonstudy.github.io/marathon-hub'; end if;

  for s in
    select st.id, st.name, st.student_phone, st.parent_phone, st.parent_phone2, coalesce(l.student_code, '') as code,
           p.week_start as pw, p.report_data ->> 'lessonDate' as ld
    from (select distinct on (u.id) u.id, u.ord from unnest(ids) with ordinality u(id, ord) order by u.id, u.ord) u
    join public.students st on st.id = u.id and not st.archived
    left join public.student_links l on l.student_id = st.id
    left join public.published p on p.student_id = st.id and p.week_start = p_week and p.visible
    order by u.ord
  loop
    if s.pw is null then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'unpublished'); continue; end if;
    if s.code = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nolink'); continue; end if;
    if not public._phone_ok(s.student_phone) then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nophone'); continue; end if;
    d := regexp_replace(s.student_phone, '\D', '', 'g');
    if d in (regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'), regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g')) then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'same'); continue;       /* 학부모 번호와 같으면 학부모 알림톡 한 통만 */
    end if;
    if not coalesce(p_resend, false) and exists (select 1 from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test and k.status = 'ok' and k.target = 'student') then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'already'); continue;
    end if;
    rows := rows || jsonb_build_object('student_id', s.id, 'to', d, 'name', s.name,
              'date', public._kdate(case when coalesce(s.ld, '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.ld, 10)::date else s.pw end),
              'link', site || '/me/#' || s.code);
  end loop;

  if jsonb_array_length(rows) > 0 and public._kakao_today_count() + jsonb_array_length(rows) > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._kakao_today_count() || '건 · 이번 ' || jsonb_array_length(rows) || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;
  rows := coalesce((
    select jsonb_agg(r || jsonb_build_object('log_id', lid2)) from (
      select r, public._kakao_log_new(p_week, (r ->> 'student_id')::uuid, r ->> 'to', '학생', (cfg ->> 'smsFallback')::boolean, me) lid2
        from jsonb_array_elements(rows) r) x), '[]'::jsonb);
  update public.kakao_log set target = 'student' where id in (select (r ->> 'log_id')::uuid from jsonb_array_elements(rows) r);
  return jsonb_build_object('ok', true, 'rows', rows, 'skipped', skipped, 'smsFallback', (cfg ->> 'smsFallback')::boolean, 'tpl', tpl);
end;
$$;
revoke all on function public.kakao_prepare_student(date, uuid[], boolean, text) from public, anon;
grant execute on function public.kakao_prepare_student(date, uuid[], boolean, text) to authenticated;


-- ------------------------------------------------------------
--  4. 3 발송 상태 (020 과 같고 학생 번호 · 학생 링크 · 학생 알림톡 결과를 더함)
-- ------------------------------------------------------------
create or replace function public.kakao_status(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object(
    'ok', true,
    'week', p_week,
    'cfg', public._kakao_cfg() || jsonb_build_object('studentTpl', (public._kakao_tpl() ->> 'student') <> ''),
    'today', public._kakao_today_count(),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'phones', (select coalesce(jsonb_agg(public._phone_mask(x)), '[]'::jsonb)
                     from unnest(array[s.parent_phone, s.parent_phone2]) x where public._phone_ok(x)),
        'title', coalesce(nullif(btrim(s.parent_title), ''), '학부모님'),
        'link', coalesce(l.hub_code, '') <> '',
        'published', exists (select 1 from public.published p where p.student_id = s.id and p.week_start = p_week and p.visible),
        'last', (select jsonb_build_object('status', k.status, 'at', coalesce(k.finished_at, k.created_at), 'error', k.error, 'last4', k.phone_last4)
                   from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test and k.target = 'parent'
                   order by (k.status = 'ok') desc, k.created_at desc limit 1),
        'sphone', public._phone_ok(s.student_phone)
                  and regexp_replace(s.student_phone, '\D', '', 'g') not in (regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'), regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g')),
        'slink', coalesce(l.student_code, '') <> '',
        'slast', (select jsonb_build_object('status', k.status, 'at', coalesce(k.finished_at, k.created_at), 'error', k.error)
                    from public.kakao_log k where k.student_id = s.id and k.week_start = p_week and not k.test and k.target = 'student'
                    order by (k.status = 'ok') desc, k.created_at desc limit 1)
      ) order by s.class_name, s.name)
      from public.students s left join public.student_links l on l.student_id = s.id
      where not s.archived
    ), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------
--  5. 사본 — 레포트 안내 한 번 = 한 통
-- ------------------------------------------------------------
/* 「목동반 · 레포트 안내 · 알림톡 학부모 10명 / 학생 10명 · 문자 학생 2명 · 대체 문자 1명」 */
create or replace function public._copy_report_line(rows jsonb)
returns text language sql stable set search_path = public as $$
  with x as (
    select e ->> 'via' via, case when e ->> 'target' = 'student' then 's' else 'p' end t, e ->> 'student_id' sid, coalesce(e ->> 'lab', '') lab
      from jsonb_array_elements(rows) e),
  n as (
    select count(distinct sid) filter (where via = 'k' and t = 'p') kp, count(distinct sid) filter (where via = 'k' and t = 's') ks,
           count(distinct sid) filter (where via = 's' and t = 'p' and lab <> '대체 문자') sp, count(distinct sid) filter (where via = 's' and t = 's' and lab <> '대체 문자') ss,
           count(distinct sid || t) filter (where via = 's' and lab = '대체 문자') alt
      from x)
  select btrim(public._copy_classes(rows) || ' · 레포트 안내', ' ·') ||
         case when kp + ks > 0 then ' · 알림톡 ' || concat_ws(' / ', case when kp > 0 then '학부모 ' || kp || '명' end, case when ks > 0 then '학생 ' || ks || '명' end) else '' end ||
         case when sp + ss > 0 then ' · 문자 ' || concat_ws(' / ', case when sp > 0 then '학부모 ' || sp || '명' end, case when ss > 0 then '학생 ' || ss || '명' end) else '' end ||
         case when alt > 0 then ' · 대체 문자 ' || alt || '명' else '' end
    from n;
$$;

/* 매분 — 068 과 같고 레포트 안내(알림톡 학부모 · 학생 · 같이 나간 문자 · 대체 문자)를 한 묶음으로 */
create or replace function public.copy_due(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph text := public._copy_phone();
  dg boolean := public._copy_digest();
  nw timestamptz := coalesce(p_now, now());
  kst timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  out jsonb := '[]'::jsonb;
  g record; cid uuid; ids uuid[]; txt text; line text; body text; firstn text; fails int; vary boolean; lesson text; r0 jsonb;
  pre text; kn int; sbody text;
  dl text[] := '{}'; dn int := 0; dfail int := 0; dids uuid[] := '{}'; last_d text;
begin
  update public.sms_log set copy_state = 'test' where copy_state = 'wait' and test;
  update public.kakao_log set copy_state = 'test' where copy_state = 'wait' and test;
  delete from public.msg_copy_text where at < nw - interval '3 days';
  if ph is null then
    update public.sms_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    update public.kakao_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    delete from public.msg_copy_text t where not exists (select 1 from public.sms_log l where l.id = t.log_id and l.copy_state = 'wait');
    return jsonb_build_object('to', '', 'messages', '[]'::jsonb);
  end if;
  for g in
    with r0_ as (
      select l.id, l.created_at at, l.status, l.name, l.class_name cls, l.target, l.body_head, l.created_by by_email,
             coalesce(b.label, '') blabel, coalesce(b.purpose, '') p0, coalesce(b.created_by, '') = '자동' auto, l.student_id,
             /* 같은 사람이 10분 안에 보낸 레포트 알림톡이 있으면 — 그 레포트 안내의 문자(학생 문자 · 대체 문자) */
             (coalesce(b.purpose, '') = 'report' and coalesce(b.created_by, '') <> '자동'
              and exists (select 1 from public.kakao_log k2 where k2.copy_state = 'wait' and not k2.test and k2.created_by = l.created_by
                            and k2.created_at between l.created_at - interval '10 minutes' and l.created_at + interval '10 minutes')) rep
        from public.sms_log l left join public.sms_batches b on b.id = l.batch_id where l.copy_state = 'wait'
    ), r as (
      select case when x.rep then 'k' else 's' end src, x.id, x.at, x.status, x.name, x.cls, x.target, x.body_head, x.by_email,
             case when x.rep then '레포트 알림톡' when x.p0 in ('nudge', 'praise') then '과제 문자' else x.blabel end label,
             case when x.rep then 'report' when x.p0 in ('nudge', 'praise') then 'hw' else x.p0 end purpose, x.p0, x.auto, null::date week, x.student_id,
             's' via, x.blabel lab
        from r0_ x
      union all
      select 'k', k.id, k.created_at, k.status, s.name, s.class_name, k.target, '', k.created_by,
             '레포트 알림톡', 'report', 'report', false, k.week_start, k.student_id, 'k', ''
        from public.kakao_log k left join public.students s on s.id = k.student_id where k.copy_state = 'wait'
    )
    select r.src, r.auto, r.label, r.by_email, min(r.at) first_at, max(r.at) last_at,
           count(*) filter (where r.status = 'pending' and r.at >= nw - interval '15 minutes') busy,
           jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'status', r.status, 'name', r.name, 'cls', r.cls, 'target', r.target,
                                        'body_head', r.body_head, 'week', r.week, 'student_id', r.student_id, 'p', r.p0, 'via', r.via, 'lab', r.lab) order by r.at, r.name) as rows
      from r
     group by r.src, r.auto, r.label, r.by_email, r.purpose, case when r.auto then r.cls else '' end,
              case when r.auto then case when r.target = 'staff' then 'staff' else 'x' end else '' end
     order by min(r.at)
  loop
    if g.busy > 0 then continue; end if;
    if not (g.auto and dg) and g.last_at > nw - interval '1 minute' and g.first_at > nw - interval '5 minutes' then continue; end if;
    select array_agg((e ->> 'id')::uuid), count(*) filter (where e ->> 'status' <> 'ok') into ids, fails from jsonb_array_elements(g.rows) e;
    line := case when g.src = 'k' then public._copy_report_line(g.rows) else public._copy_line(g.rows, g.auto, g.label, g.by_email) end;
    if g.auto and dg then
      dl := dl || ('· ' || to_char((g.first_at at time zone 'Asia/Seoul'), 'HH24:MI') || ' ' || line || case when fails > 0 then ' · ' || fails || '명 실패' else '' end);
      dn := dn + jsonb_array_length(g.rows); dfail := dfail + fails; dids := dids || ids;
      continue;
    end if;
    select t.body into body from public.msg_copy_text t where t.log_id = any(ids) and t.body <> '' order by t.at limit 1;
    select e into r0 from jsonb_array_elements(g.rows) e
      left join public.msg_copy_text t on t.log_id = (e ->> 'id')::uuid and t.body <> '' order by (t.log_id is null), e ->> 'at' limit 1;
    firstn := r0 ->> 'name';
    if g.src = 'k' then
      /* 알림톡 학부모 첫 사람 — 템플릿 글 · 학생 알림톡 · 같이 나간 문자는 한 줄씩 */
      select e into r0 from jsonb_array_elements(g.rows) e where e ->> 'via' = 'k' order by (e ->> 'target' = 'student'), e ->> 'at' limit 1;
      sbody := body;
      body := null;
      if r0 is not null then
        firstn := r0 ->> 'name';
        select public._kdate(case when coalesce(p.report_data ->> 'lessonDate', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p.report_data ->> 'lessonDate', 10)::date else p.week_start end)
          into lesson from public.published p where p.student_id = (r0 ->> 'student_id')::uuid and p.week_start = (r0 ->> 'week')::date;
        if r0 ->> 'target' = 'student' then
          body := '[학생 알림톡] ' || coalesce(firstn, '') || ' · ' || coalesce(lesson, '') || E' 수업 레포트\n(학생용 템플릿 · [레포트 보기] 버튼)';
        else
          body := '[마라톤국어] ' || coalesce(firstn, '') || E' 학생 주간 레포트\n\n' || coalesce(firstn, '') || ' 학생의 ' || coalesce(lesson, '') || E' 수업 레포트가 올라왔습니다.\n아래 버튼을 눌러 확인해 주세요.\n(알림톡 · [레포트 보기] 버튼)';
          select count(*) into kn from jsonb_array_elements(g.rows) e where e ->> 'via' = 'k' and e ->> 'target' = 'student';
          if kn > 0 then body := body || E'\n\n[학생 알림톡] 학생용 템플릿 · [레포트 보기] 버튼'; end if;
        end if;
      end if;
      if sbody is not null then body := concat_ws(E'\n\n', body, '[문자] ' || sbody); end if;
      if body is null then body := '(레포트 안내)'; end if;
    elsif body is null then
      body := public._copy_clean(r0 ->> 'body_head') || '…(앞부분)';
    end if;
    pre := null;
    if g.auto then
      select string_agg(x.t, E'\n\n' order by x.o) into pre from (
        select distinct on (case when p.band = 'all' then 2 else 1 end) case when p.band = 'all' then 2 else 1 end o,
               '[' || case when p.band = 'all' then '모두 제출' else '미제출' end || '] ' || coalesce(l.name, '') || E'\n' || t.body t
          from public.msg_copy_text t join public.pre_remind_log p on p.log_id = t.log_id join public.sms_log l on l.id = t.log_id
         where t.log_id = any(ids) and t.body <> ''
         order by case when p.band = 'all' then 2 else 1 end, t.at, l.name) x;
      if pre is not null then body := pre; firstn := ''; end if;
    end if;
    if not g.auto and g.label = '과제 문자' then
      select string_agg(x.t, E'\n\n' order by x.o) into pre from (
        select distinct on (case when b.purpose = 'praise' then 2 else 1 end) case when b.purpose = 'praise' then 2 else 1 end o,
               '[' || case when b.purpose = 'praise' then '칭찬' else '독려' end || '] ' || coalesce(l.name, '') || E'\n' || t.body t
          from public.msg_copy_text t join public.sms_log l on l.id = t.log_id join public.sms_batches b on b.id = l.batch_id
         where t.log_id = any(ids) and t.body <> ''
         order by case when b.purpose = 'praise' then 2 else 1 end, t.at, l.name) x;
      if pre is not null then body := pre; firstn := ''; end if;
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


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '학생 줄 칸(kakao_log.target)' as what, exists (select 1 from information_schema.columns where table_name = 'kakao_log' and column_name = 'target')::text as ok
union all select '학생용 템플릿 코드 설정 (원장만)', (position('_real_teacher' in pg_get_functiondef('public.kakao_tpl_set(text, text)'::regprocedure)) > 0)::text
union all select '학생 보낼 줄 함수', (to_regprocedure('public.kakao_prepare_student(date, uuid[], boolean, text)') is not null)::text
union all select case when (public._kakao_tpl() ->> 'student') = '' then '학생용 코드 비어 있음 — 학생은 지금처럼 문자' else '학생용 코드 있음 — 학생은 학생용 알림톡' end, 'true';
