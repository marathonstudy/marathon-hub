-- ============================================================
--  migration-084-kakao-alt.sql — 알림톡이 실패하면 코치룸이 링크가 든 문자로 다시 (20261108p)
--  (084 는 083 다음 · 여러 번 실행해도 안전 · 그다음 함수 kakao-send · note-remind 다시 배포)
--
--  예전 — 솔라피 자동 대체 문자(disableSms false): 카톡이 없어 실패하면 솔라피가 템플릿 글만(버튼 링크 없이) 문자로 보냈다
--  이제 — 솔라피 자동 대체는 끈다(disableSms true). 실패한 사람에게만 코치룸이 지금 문자 문구(본문에 링크)로 직접 다시 보낸다
--    레포트 안내 알림톡(학부모 · 학생) — kakao-send 가 보낸 줄마다 kakao_alt 에 「다시 보낼 문자」(번호 · 글)를 남긴다
--      글: 문자 발송 화면에서 보낼 때는 그 사람 문자 글 그대로 · 3 발송 [알림톡 보내기]는 문구 관리 「레포트 안내」로 채운 글
--      대체 문자를 쓰는 때는 지금과 같다 — 「카톡으로 보내기(안 받는 사람은 문자로)」 또는 설정 「알림톡이 실패하면 문자로 대신 보내기」
--      솔라피가 바로 받지 않은 사람(번호 오류 등) — 문자 발송 화면은 예전처럼 바로 다시 보낸다(그 줄은 남기지 않음) · 3 발송은 다음 분에
--    월간 루틴 우수자 알림톡 — note-remind 가 보낸 줄마다 남긴다 (글 = 문구 「루틴 우수자」 · 본문에 …/me/#코드/award/2026-10)
--  note-remind 매분 — 보낸 지 1분 지난 알림톡 결과를 솔라피에 묻는다 (4000 받음 · 2000 · 3000 아직 · 그 밖 실패)
--    실패한 사람만 그 글로 문자 한 통 (보낸 기록 이름 「대체 문자」 · 사본 없음) · 바로 받지 않은 줄은 다음 분에 바로
--    3시간이 지나도 결과가 없으면 그만 본다 · 한 줄에 한 번만
--  번호는 그 학생의 학생 · 학부모 번호일 때만 남긴다 (다른 번호는 막는다) · 표는 화면에서 못 읽는다 (함수만)
-- ============================================================

create table if not exists public.kakao_alt (
  id          bigserial primary key,
  src         text not null,                      -- report · award
  log_id      uuid,                               -- kakao_log.id (report) · sms_log.id (award)
  student_id  uuid references public.students(id) on delete cascade,
  target      text not null default '',           -- parent · student · parent1 · parent2
  to_phone    text not null,
  alt_text    text not null,
  message_id  text not null default '',
  state       text not null default 'wait',       -- wait 결과 기다림 · fail 바로 다시 · ok 받음 · resent 문자로 다시 보냄 · gone 결과 없음(3시간)
  by_email    text not null default '',
  created_at  timestamptz not null default now(),
  checked_at  timestamptz,
  resent_log  uuid,
  constraint kakao_alt_state check (state in ('wait', 'fail', 'ok', 'resent', 'gone')),
  constraint kakao_alt_text check (char_length(alt_text) between 1 and 2000)
);
create index if not exists kakao_alt_wait on public.kakao_alt (created_at) where state in ('wait', 'fail');
alter table public.kakao_alt enable row level security;
revoke all on public.kakao_alt from anon, authenticated;

/* 레포트 안내 문자 글 — 문구 관리 「레포트 안내」 (#{이름} #{수업일} #{링크} #{반} · {학생이름} {반이름}) · 칸이 남으면 기본 글 */
create or replace function public._report_alt_text(p_name text, p_lesson text, p_link text, p_class text)
returns text language plpgsql stable security definer set search_path = public as $$
declare b text := coalesce((select body from public.sms_templates where btrim(title) = '레포트 안내' order by updated_at desc limit 1), ''); t text;
begin
  t := replace(replace(replace(replace(replace(replace(b, '#{이름}', coalesce(p_name, '')), '{학생이름}', coalesce(p_name, '')),
         '#{수업일}', coalesce(p_lesson, '')), '#{링크}', coalesce(p_link, '')), '#{반}', coalesce(p_class, '')), '{반이름}', coalesce(p_class, ''));
  if btrim(t) = '' or t ~ '#?\{[^{}\r\n]{1,20}\}' then
    t := '[마라톤국어] ' || coalesce(p_name, '') || ' 학생 ' || coalesce(p_lesson, '') || E' 수업 레포트가 올라왔어요.\n' || coalesce(p_link, '');
  end if;
  return left(t, 2000);
end;
$$;
revoke all on function public._report_alt_text(text, text, text, text) from public, anon, authenticated;

/* 그 학생의 번호인지 */
create or replace function public._alt_phone_ok(p_student uuid, p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = p_student
                   and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') ~ '^01[0-9]{8,9}$'
                   and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') in (regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g'),
                                                                                regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'),
                                                                                regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g')));
$$;
revoke all on function public._alt_phone_ok(uuid, text) from public, anon, authenticated;

/* 남기기 — rows [{ src, log_id, student_id, target, to, text?, name, lesson, link, class, message_id, failed }] · 그 학생 번호만 */
create or replace function public._kakao_alt_put(p_rows jsonb, p_by text)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; txt text;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'student_id', '') !~ '^[0-9a-f-]{36}$' or not public._alt_phone_ok((r ->> 'student_id')::uuid, r ->> 'to') then continue; end if;
    txt := nullif(btrim(coalesce(r ->> 'text', '')), '');
    if txt is null then txt := public._report_alt_text(r ->> 'name', r ->> 'lesson', r ->> 'link', r ->> 'class'); end if;
    insert into public.kakao_alt (src, log_id, student_id, target, to_phone, alt_text, message_id, state, by_email)
    values (case when r ->> 'src' = 'award' then 'award' else 'report' end,
            case when coalesce(r ->> 'log_id', '') ~ '^[0-9a-f-]{36}$' then (r ->> 'log_id')::uuid end,
            (r ->> 'student_id')::uuid, left(coalesce(r ->> 'target', ''), 20), regexp_replace(r ->> 'to', '\D', '', 'g'), left(txt, 2000),
            left(coalesce(r ->> 'message_id', ''), 80), case when coalesce((r ->> 'failed')::boolean, false) then 'fail' else 'wait' end, left(coalesce(p_by, ''), 200));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._kakao_alt_put(jsonb, text) from public, anon, authenticated;

/* kakao-send (로그인한 운영진) */
create or replace function public.kakao_alt_put(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  return jsonb_build_object('ok', true, 'n', public._kakao_alt_put(p_rows, lower(coalesce(auth.jwt() ->> 'email', ''))));
end;
$$;
revoke all on function public.kakao_alt_put(jsonb) from public, anon;
grant execute on function public.kakao_alt_put(jsonb) to authenticated;

/* note-remind (루틴 우수자) */
create or replace function public.kakao_alt_put_svc(p_rows jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'n', public._kakao_alt_put(p_rows, p_by));
end;
$$;
revoke all on function public.kakao_alt_put_svc(jsonb, text) from public, anon, authenticated;
grant execute on function public.kakao_alt_put_svc(jsonb, text) to service_role;

/* 매분 — 결과를 물을 줄 · 바로 다시 보낼 줄 (3시간 지난 것은 그만) */
create or replace function public.kakao_alt_due(p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nw timestamptz := coalesce(p_now, now());
begin
  update public.kakao_alt set state = 'gone', checked_at = nw where state = 'wait' and created_at < nw - interval '3 hours';
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'message_id', a.message_id, 'state', a.state) order by a.id)
                     from (select * from public.kakao_alt
                            where state = 'fail' or (state = 'wait' and created_at <= nw - interval '1 minute' and message_id <> '')
                            order by id limit 200) a), '[]'::jsonb);
end;
$$;
revoke all on function public.kakao_alt_due(timestamptz) from public, anon, authenticated;
grant execute on function public.kakao_alt_due(timestamptz) to service_role;

/* 결과 — p_results [{ id, status: ok | wait | fail }] · 실패만 문자 줄을 만든다 (한 줄 한 번) */
create or replace function public.kakao_alt_prepare(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; a public.kakao_alt; b uuid; lid uuid; rows jsonb := '[]'::jsonb; bk text; batches jsonb := '{}'::jsonb; s record;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    select * into a from public.kakao_alt where id = (r ->> 'id')::bigint and state in ('wait', 'fail') for update;
    if not found then continue; end if;
    if r ->> 'status' = 'ok' then update public.kakao_alt set state = 'ok', checked_at = now() where id = a.id; continue; end if;
    if coalesce(r ->> 'status', '') <> 'fail' then update public.kakao_alt set checked_at = now() where id = a.id; continue; end if;
    bk := a.src || '|' || a.by_email;
    if batches ? bk then b := (batches ->> bk)::uuid;
    else
      b := gen_random_uuid();
      insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '대체 문자', a.src, '', case when a.by_email = '' then '자동' else a.by_email end);
      batches := batches || jsonb_build_object(bk, b);
    end if;
    select st.name, st.class_name into s from public.students st where st.id = a.student_id;
    lid := gen_random_uuid();
    insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by, copy_state)
    values (lid, b, a.student_id, case when a.target in ('student', 'parent1', 'parent2') then a.target when a.target = 'parent' then 'parent1' else 'student' end,
            coalesce(s.name, ''), coalesce(s.class_name, ''), right(a.to_phone, 4), case when public._sms_bytes(a.alt_text) > 90 then 'LMS' else 'SMS' end,
            left(a.alt_text, 60), case when a.by_email = '' then '자동' else a.by_email end, 'none');
    update public.kakao_alt set state = 'resent', checked_at = now(), resent_log = lid where id = a.id;
    rows := rows || jsonb_build_object('log_id', lid, 'to', a.to_phone, 'text', a.alt_text, 'kind', case when public._sms_bytes(a.alt_text) > 90 then 'LMS' else 'SMS' end,
                                       'name', coalesce(s.name, ''), 'class', coalesce(s.class_name, ''));
  end loop;
  return jsonb_build_object('ok', true, 'rows', rows);
end;
$$;
revoke all on function public.kakao_alt_prepare(jsonb) from public, anon, authenticated;
grant execute on function public.kakao_alt_prepare(jsonb) to service_role;

-- ------------------------------------------------------------
--  루틴 우수자 — 문자 글은 늘 본문 링크(…/me/#코드/award/2026-10) · 알림톡이 실패하면 이 글로 (082 와 같고 링크만)
-- ------------------------------------------------------------
create or replace function public.award_send_prepare(p_month date, p_by text, p_site text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  cfg jsonb := public._award_cfg();
  mo text := extract(month from m)::int::text;
  body0 text := coalesce((select body from public.sms_templates where btrim(title) = '루틴 우수자' order by updated_at desc limit 1),
                 E'[마라톤국어] {이름} 학생, {월}월 과제 루틴 우수자로 선정되었어요! 한 달 동안 매일의 루틴을 지켜 낸 기록을 정리해 두었어요. 아래 링크에서 확인해 보세요.\n{링크}');
  site text := coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub');
  kakao boolean := cfg ->> 'via' = 'kakao' and cfg ->> 'tpl' <> '';
  w record; b uuid := null; lid uuid; txt text; link text; ph text; seen text[];
  rows jsonb := '[]'::jsonb; nst int := 0; nsend int := 0;
  t record;
begin
  for w in
    select a.*, s.name, s.student_phone, s.parent_phone, s.parent_phone2, l.student_code, l.hub_code
      from public.routine_awards a join public.students s on s.id = a.student_id left join public.student_links l on l.student_id = a.student_id
     where a.month = m and not a.excluded and a.sent_at is null and not s.archived
     order by a.class_name, s.name
     for update of a
  loop
    seen := '{}'; nsend := 0;
    for t in select * from (values ('student', w.student_phone, w.student_code), ('parent1', w.parent_phone, w.hub_code), ('parent2', w.parent_phone2, w.hub_code)) v(tg, phone, code) loop
      ph := regexp_replace(coalesce(t.phone, ''), '\D', '', 'g');
      if ph !~ '^01[0-9]{8,9}$' or ph = any(seen) or coalesce(t.code, '') = '' then continue; end if;
      seen := seen || ph;
      link := site || '/me/#' || t.code || '/award/' || to_char(m, 'YYYY-MM');   -- 문자 글 (알림톡이 실패하면 이 글로 다시 · 084) · 알림톡은 버튼(#{코드} #{년월})
      txt := replace(replace(replace(body0, '{이름}', w.name), '{월}', mo), '{링크}', link);
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, mo || '월 루틴 우수자', 'award', body0, coalesce(p_by, ''));
      end if;
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, w.student_id, t.tg, w.name, w.class_name, right(ph, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), coalesce(p_by, ''));
      rows := rows || jsonb_build_object('log_id', lid, 'to', ph, 'text', txt, 'kind', 'LMS', 'class', w.class_name, 'who', t.tg, 'name', w.name, 'student_id', w.student_id,
                                         'kakao', case when kakao then jsonb_build_object('templateId', cfg ->> 'tpl', 'variables',
                                                    jsonb_build_object('#{이름}', w.name, '#{월}', mo, '#{코드}', t.code, '#{년월}', to_char(m, 'YYYY-MM'))) end);
      nsend := nsend + 1;
    end loop;
    if nsend > 0 then
      update public.routine_awards set sent_at = now(), sent_by = coalesce(p_by, '') where id = w.id;
      nst := nst + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'month', m, 'students', nst, 'rows', rows, 'kakao', kakao);
end;
$$;
revoke all on function public.award_send_prepare(date, text, text) from public, anon, authenticated;
grant execute on function public.award_send_prepare(date, text, text) to service_role;




-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '다시 보낼 문자 표(kakao_alt)' as what, (to_regclass('public.kakao_alt') is not null)::text as ok
union all select '매분 확인 · 다시 보내기 함수', (to_regprocedure('public.kakao_alt_due(timestamptz)') is not null and to_regprocedure('public.kakao_alt_prepare(jsonb)') is not null)::text
union all select '루틴 우수자 문자 글은 본문 링크', (position('?c=' in pg_get_functiondef('public.award_send_prepare(date, text, text)'::regprocedure)) = 0)::text;
