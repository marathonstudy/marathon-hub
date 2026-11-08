-- ============================================================
--  migration-085-send-check.sql — 레포트 업데이트 문자 줄이기 · 다시 보낼 때 확인 · 보낸 기록 시험 줄 (20261108q)
--  (085 는 084 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  1. 레포트 업데이트 문자 (073 을 고친다)
--     · 항목은 수업 영상 · 수업 자료 · 선생님 코멘트만 — 반 공지 · 수업 내용 · 복습 테스트 결과 · 출석 · 과제 상태 · 필기 · 사본 · 설정으로는 안 나간다
--     · 같은 레포트는 하루 한 번까지 (넘으면 다음 날 아침 8시)
--     · 마지막 변경 뒤 기다리는 시간 — 기본 10분 · 설정 5 ~ 60분 (app_settings 'report_upd' wait)
--     · 원장 · 조교가 같은 내용을 직접 보냈으면(수업 영상 알림 · 바뀐 내용 알리기 · 자료 · 코멘트 문자) 그 항목은 뺀다
--       (그 항목의 첫 변경보다 기다리는 시간만큼 앞 · 그 뒤에 보낸 문자) · 남는 항목이 없으면 보내지 않는다
--  2. 다시 보낼 때 확인 — send_dup_check: 같은 레포트(주) · 같은 글(오늘)을 이미 받은 학생 · 언제 · 누가 · 알림톡/문자 몇 명
--  2-1. 먼저 나에게 보내 보기 — test_phone_hold(번호) · test_phone_release() (원래 시험 번호는 서버가 맡았다 돌려준다)
--  3. 보낸 기록 — 시험 발송 줄에 번호 뒤 4자리(last4) · 시험 발송은 반 발송 숫자(sent)에 세지 않는다 (그대로)
-- ============================================================


-- ------------------------------------------------------------
--  1. 레포트 업데이트 문자
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values ('report_upd', jsonb_build_object('parents', false, 'wait', 10))
on conflict (key) do nothing;
update public.app_settings set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('wait', 10)
 where key = 'report_upd' and not (coalesce(value, '{}'::jsonb) ? 'wait');

/* 기다리는 시간(분) — 5 ~ 60 · 기본 10 */
create or replace function public._upd_wait()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(5, least(60, coalesce((select (value ->> 'wait')::int from public.app_settings where key = 'report_upd'), 10)));
$$;

create or replace function public.report_upd_wait_set(p_min integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m int := greatest(5, least(60, coalesce(p_min, 10)));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  insert into public.app_settings (key, value) values ('report_upd', jsonb_build_object('parents', false, 'wait', m))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('wait', m);
  return jsonb_build_object('ok', true, 'wait', m);
end;
$$;
revoke all on function public.report_upd_wait_set(integer) from public, anon;
grant execute on function public.report_upd_wait_set(integer) to authenticated;

/* 원장 · 조교가 그 학생에게 같은 내용을 직접 보냈나 (p_since 뒤 · 시험 · 자동 · 실패는 빼고) */
create or replace function public._upd_manual(p_student uuid, p_item text, p_since timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sms_log l join public.sms_batches b on b.id = l.batch_id
     where l.student_id = p_student and not l.test and l.status <> 'fail' and l.created_at >= p_since
       and coalesce(l.created_by, '') not in ('', '자동') and coalesce(b.created_by, '') <> '자동'
       and coalesce(b.purpose, '') not in ('rupd', 'report', 'pre', 'note', 'award', 'nudge', 'praise', 'worry', 'entry', 'welcome', 'app')
       and case p_item
             when 'video'   then b.purpose = 'video' or coalesce(b.label, '') like '%영상%'
             when 'file'    then coalesce(b.label, '') like '%자료%' or (b.purpose = 'notify' and coalesce(b.body, '') like '%자료%')
             when 'comment' then b.purpose = 'notify' or coalesce(b.label, '') like '%코멘트%'
             else false end);
$$;
revoke all on function public._upd_manual(uuid, text, timestamptz) from public, anon, authenticated;

/* 항목 — 수업 영상 · 수업 자료 · 선생님 코멘트만 (직접 보낸 항목은 뺀다) */
create or replace function public._upd_items(p_week date, p_student uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  out text[] := '{}';
  nv int; nf int;
  b jsonb; c jsonb;
  w interval := make_interval(mins => public._upd_wait());
  t0 timestamptz;
begin
  /* 영상 — 넣은 것 중 지우지 않은 것만 (기다리는 기록 안에서) */
  select count(*) into nv from (
    select ref from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'video'
     group by ref having bool_or(op = 'add') and not bool_or(op = 'del' and id > (select max(e2.id) from public.report_upd_ev e2
                                                                                  where e2.week_start = p_week and e2.student_id = p_student and e2.state = 'wait' and e2.kind = 'video' and e2.ref = report_upd_ev.ref and e2.op = 'add'))) x;
  if nv > 0 then
    select min(at) into t0 from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'video';
    if not public._upd_manual(p_student, 'video', t0 - w) then out := array_append(out, '수업 영상'); end if;
  end if;
  /* 자료 */
  select count(*) into nf from (
    select ref from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'file'
     group by ref having bool_or(op = 'add') and not bool_or(op = 'del')) x;
  if nf > 0 then
    select min(at) into t0 from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'file';
    if not public._upd_manual(p_student, 'file', t0 - w) then out := array_append(out, ('수업 자료 ' || nf || '개')); end if;
  end if;
  /* 선생님 코멘트 — 다시 공개 때 처음 상태와 견주어 10글자 이상 (출석 · 과제 · 수업 내용 · 복습 테스트는 세지 않는다) */
  if exists (select 1 from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'report') then
    select data into b from public.report_upd_base where week_start = p_week and student_id = p_student;
    select report_data into c from public.published where week_start = p_week and student_id = p_student and visible;
    if b is not null and c is not null and public._upd_size(b ->> 'comment', c ->> 'comment') >= 10 then
      select min(at) into t0 from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'report';
      if not public._upd_manual(p_student, 'comment', t0 - w) then out := array_append(out, '선생님 코멘트'); end if;
    end if;
  end if;
  return out;
end;
$$;
revoke all on function public._upd_items(date, uuid) from public, anon, authenticated;

/* 보낼 때 — 마지막 변경 뒤 기다리는 시간(기본 10분) · 밤 10시 ~ 아침 8시는 8시 · 같은 레포트는 하루 한 번 (넘으면 다음 날 8시) */
create or replace function public._upd_due(p_last timestamptz, p_week date, p_student uuid, p_force boolean)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  d timestamptz := case when p_force then now() - interval '1 second' else p_last + make_interval(mins => public._upd_wait()) end;
  k timestamp;
  i int := 0;
begin
  loop
    i := i + 1; exit when i > 5;
    k := d at time zone 'Asia/Seoul';
    if k::time >= time '22:00' then d := ((k::date + 1) + time '08:00') at time zone 'Asia/Seoul'; continue; end if;
    if k::time < time '08:00' then d := (k::date + time '08:00') at time zone 'Asia/Seoul'; continue; end if;
    if exists (select 1 from public.report_upd_log l where l.day = k::date and l.week_start = p_week and l.student_id = p_student) then
      d := ((k::date + 1) + time '08:00') at time zone 'Asia/Seoul'; continue;
    end if;
    exit;
  end loop;
  return d;
end;
$$;
revoke all on function public._upd_due(timestamptz, date, uuid, boolean) from public, anon, authenticated;

/* 화면 — 073 과 같고 기다리는 시간(wait)을 더한다 */
create or replace function public.report_upd_pending()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('ok', true,
    'parents', coalesce((select (value ->> 'parents')::boolean from public.app_settings where key = 'report_upd'), false),
    'wait', public._upd_wait(),
    'list', coalesce((
      with r as (
        select e.week_start, min(e.class_name) cls, e.student_id,
               public._upd_due(max(e.at), e.week_start, e.student_id, bool_or(e.force)) due,
               public._upd_items(e.week_start, e.student_id) its
          from public.report_upd_ev e where e.state = 'wait'
         group by e.week_start, e.student_id
      ), g as (
        select r.week_start, r.cls, count(*) n, max(r.due) due,
               coalesce((select c.upd_auto from public.classes c where c.name = r.cls), true) auto,
               (select array_agg(distinct i) from r r2, unnest(r2.its) i where r2.week_start = r.week_start and r2.cls = r.cls) items,
               (select max(p.report_data ->> 'lessonDate') from public.published p join r r3 on r3.student_id = p.student_id
                 where p.week_start = r.week_start and r3.week_start = r.week_start and r3.cls = r.cls) lesson
          from r where cardinality(r.its) > 0
         group by r.week_start, r.cls
      )
      select jsonb_agg(jsonb_build_object('week', g.week_start, 'class', g.cls, 'students', g.n, 'due', g.due, 'auto', g.auto,
                                          'items', to_jsonb(g.items), 'lesson', g.lesson) order by g.due)
        from g), '[]'::jsonb));
end;
$$;


-- ------------------------------------------------------------
--  2. 다시 보낼 때 확인
--     레포트(p_week · 목적 report) — sent(보냄 표시) · 알림톡 · 문자 · 그 밖(복사 · 공유)
--     그 밖 — 오늘 같은 글(문구 원문)을 받은 학생 (시험 · 실패 · 자동은 빼고)
-- ------------------------------------------------------------
create or replace function public.send_dup_check(p_students uuid[], p_body text default '', p_week date default null, p_purpose text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ids uuid[] := coalesce(p_students, '{}');
  r jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  if cardinality(ids) = 0 then return jsonb_build_object('ok', true, 'n', 0, 'ids', '[]'::jsonb); end if;
  if coalesce(p_purpose, '') = 'report' and p_week is not null then
    select jsonb_build_object('ok', true, 'n', count(*), 'ids', coalesce(jsonb_agg(t.student_id), '[]'::jsonb), 'at', max(t.sent_at),
             'kakao', count(*) filter (where t.via = 'kakao'), 'sms', count(*) filter (where t.via = 'sitesms'),
             'other', count(*) filter (where t.via not in ('kakao', 'sitesms')),
             'by', (select coalesce(nullif(btrim(sf.name), ''), t2.sent_by) from public.sent t2 left join public.staff sf on lower(sf.email) = lower(t2.sent_by)
                     where t2.week_start = p_week and t2.student_id = any(ids) order by t2.sent_at desc nulls last limit 1))
      into r from public.sent t where t.week_start = p_week and t.student_id = any(ids);
    return r;
  end if;
  if btrim(coalesce(p_body, '')) = '' then return jsonb_build_object('ok', true, 'n', 0, 'ids', '[]'::jsonb); end if;
  with x as (
    select l.student_id, max(l.created_at) at, max(l.created_by) by_email from public.sms_log l join public.sms_batches b on b.id = l.batch_id
     where l.student_id = any(ids) and not l.test and l.status <> 'fail' and b.body = p_body
       and (l.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
     group by l.student_id
  )
  select jsonb_build_object('ok', true, 'n', count(*), 'ids', coalesce(jsonb_agg(x.student_id), '[]'::jsonb), 'at', max(x.at), 'kakao', 0, 'sms', count(*), 'other', 0,
           'by', (select coalesce(nullif(btrim(sf.name), ''), x2.by_email) from x x2 left join public.staff sf on lower(sf.email) = lower(x2.by_email) order by x2.at desc limit 1))
    into r from x;
  return r;
end;
$$;
revoke all on function public.send_dup_check(uuid[], text, date, text) from public, anon;
grant execute on function public.send_dup_check(uuid[], text, date, text) to authenticated;


-- ------------------------------------------------------------
--  2-1. 먼저 나에게 보내 보기 — 그 자리에서 넣은 번호로 한 통
--     화면에는 내 시험 번호가 가려져(010-****-1234) 오므로, 원래 번호는 서버가 잠깐 맡아 두었다가 돌려준다
--     test_phone_hold(번호) → 시험 발송(sms-send · kakao-send test) → test_phone_release()
-- ------------------------------------------------------------
alter table public.kakao_test_phones add column if not exists held_phone text;      -- null = 맡은 것 없음 · '' = 원래 없었음

create or replace function public.test_phone_hold(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if not public._phone_ok(d) then raise exception '휴대폰 번호(010 …)를 확인해 주세요.'; end if;
  insert into public.kakao_test_phones (email, phone, held_phone, updated_at) values (me, d, '', now())
  on conflict (email) do update
    set held_phone = coalesce(public.kakao_test_phones.held_phone, public.kakao_test_phones.phone),   /* 앞서 못 돌린 것이 있으면 그 원래 번호 그대로 */
        phone = excluded.phone, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.test_phone_release()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  h text;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select held_phone into h from public.kakao_test_phones where email = me;
  if h is null then return jsonb_build_object('ok', true, 'back', false); end if;
  if h = '' then delete from public.kakao_test_phones where email = me;
  else update public.kakao_test_phones set phone = h, held_phone = null, updated_at = now() where email = me; end if;
  return jsonb_build_object('ok', true, 'back', true);
end;
$$;
revoke all on function public.test_phone_hold(text) from public, anon;
revoke all on function public.test_phone_release() from public, anon;
grant execute on function public.test_phone_hold(text) to authenticated;
grant execute on function public.test_phone_release() to authenticated;


-- ------------------------------------------------------------
--  3. 보낸 기록 — 064 와 같고 번호 뒤 4자리(last4 · 시험 줄 「테스트 · 김민서 · 010-****-1234」)를 더한다
-- ------------------------------------------------------------
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
               null::date as week,
               max(l.phone_last4) as last4
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
               max(k.created_by), max(k.week_start),
               max(k.phone_last4)
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


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '업데이트 문자 기다리는 시간 ' || public._upd_wait() || '분 (기본 10 · 5~60)' as what, (public._upd_wait() between 5 and 60)::text as ok
union all select '업데이트 항목은 영상 · 자료 · 코멘트만', (position('반 공지' in pg_get_functiondef('public._upd_items(date, uuid)'::regprocedure)) = 0
                                                and position('_upd_manual' in pg_get_functiondef('public._upd_items(date, uuid)'::regprocedure)) > 0)::text
union all select '같은 레포트 하루 한 번', (position('>= 2' in pg_get_functiondef('public._upd_due(timestamptz, date, uuid, boolean)'::regprocedure)) = 0)::text
union all select '다시 보낼 때 확인 함수', (to_regprocedure('public.send_dup_check(uuid[], text, date, text)') is not null)::text
union all select '먼저 나에게 보내 보기 (번호 맡기 · 돌리기)', (to_regprocedure('public.test_phone_hold(text)') is not null and to_regprocedure('public.test_phone_release()') is not null)::text
union all select '보낸 기록 번호 뒤 4자리', (position('last4' in pg_get_functiondef('public.sms_batch_list(date, date, text, uuid, integer)'::regprocedure)) > 0)::text;
