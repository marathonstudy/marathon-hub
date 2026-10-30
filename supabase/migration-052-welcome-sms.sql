-- ============================================================
--  마라톤 코치룸 — 입구 문자 · 신입생 웰컴 문자 (migration-052-welcome-sms.sql · 20261101e)
--
--  실행 방법
--    051 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 기록은 바꾸지 않는다.
--  함수 sms-send 도 다시 배포한다 ({첫수업일} 칸을 넘기려고 · Verify JWT 는 지금처럼 끈 채로).
--
--  1. 문자 칸 — {학생이름} {반이름} {첫수업일} {앱입장코드} {러닝노트주소}
--     sms_prepare 는 041 과 같고 이 칸들만 더했다 (#{이름} #{입장코드} 같은 예전 칸도 그대로 쓴다)
--     {앱입장코드}가 있는데 그 반 「앱 입장코드」가 없으면 「입장코드 없음」으로 뺀다 (#{입장코드}와 같다)
--  2. sms_sent_today(목적) — 오늘(한국 날짜) 같은 목적(entry 입구 안내 · welcome 웰컴 안내)으로 보낸 학생 · 보낼 곳
--     (솔라피가 받은 것 · 보내는 중만 — 실패는 다시 보낼 수 있게 뺀다) · 「오늘 이미 보냄」
--  3. sms_purpose_last(학생) — 그 학생에게 마지막으로 보낸 입구 안내 · 웰컴 안내 시각 (상담 카드 「웰컴 안내 보냄 10/30」)
--  4. student_logged_ids() — 학생 입구(/s/)로 한 번이라도 로그인한 학생 id (입구 문자 「아직 한 번도 로그인 안 한 학생만」)
--  5. 「자주 쓰는 문구」에 「신입생 웰컴(학생)」 「신입생 웰컴(학부모)」 「입구 안내」 (이미 있으면 그대로)
--     학생용 기본값은 지금 있는 「앱 안내(기본)」 문구 (없으면 코치룸 기본 앱 안내 글) · 학부모용은 첫 줄만 바꾼다
--  알림톡 템플릿(주간레포트안내)은 건드리지 않는다. 키는 쓰지 않는다.
-- ============================================================

create or replace function public.sms_prepare(p_items jsonb, p_body text, p_ad boolean default false, p_lessons jsonb default '{}'::jsonb,
                                              p_siblings boolean default false, p_test boolean default false,
                                              p_mark_week date default null, p_site text default '',
                                              p_label text default '', p_purpose text default '', p_vars jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  cfg jsonb := public._sms_cfg();
  body text := coalesce(p_body, '');
  vars jsonb := case when jsonb_typeof(p_vars) = 'object' then p_vars else '{}'::jsonb end;
  links text := public._sms_app_links();
  rows jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  seen jsonb := '{}'::jsonb;                 -- 번호 → 처음 받은 학생 id
  it record;
  s_name text; s_class text; p1 text; p2 text; sp text; hub text; stu text; appc text;
  ph text; d text; code text; ecode text; first text; txt text; bytes int; kind text;
  needcode boolean := position('#{입장코드}' in body) > 0 or position('{앱입장코드}' in body) > 0;
  n int := 0;
  hr int := extract(hour from (now() at time zone 'Asia/Seoul'))::int;
  tphone text;
  batch uuid := gen_random_uuid();
  lid uuid;
  r jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if btrim(body) = '' then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '내용을 적어 주세요.'); end if;
  if char_length(body) > 2000 then return jsonb_build_object('ok', false, 'reason', 'toolong', 'message', '내용이 너무 깁니다 (2000자까지).'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '받는 사람을 골라 주세요.');
  end if;
  if jsonb_array_length(p_items) > 3000 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '받는 사람이 너무 많습니다.'); end if;
  if position('#{앱 설치 링크}' in body) > 0 and links = '' then
    return jsonb_build_object('ok', false, 'reason', 'noapplink', 'message', '문자 발송 → 연결 상태에서 앱 설치 링크를 먼저 넣어 주세요.');
  end if;
  if coalesce(p_ad, false) then
    if btrim(cfg ->> 'optout') = '' then
      return jsonb_build_object('ok', false, 'reason', 'optout', 'message', '광고 문자는 [설정]에서 무료수신거부 번호를 먼저 넣어야 보낼 수 있습니다.');
    end if;
    if btrim(cfg ->> 'adName') = '' then
      return jsonb_build_object('ok', false, 'reason', 'adname', 'message', '광고 문자는 [설정]에서 광고 발신처 이름을 먼저 넣어야 보낼 수 있습니다.');
    end if;
    if hr >= 21 or hr < 8 then
      return jsonb_build_object('ok', false, 'reason', 'night', 'message', '광고 문자는 밤 9시 ~ 아침 8시에 보낼 수 없습니다.');
    end if;
  end if;
  if p_test then
    select phone into tphone from public.kakao_test_phones where email = me;
    if tphone is null or not public._phone_ok(tphone) then
      return jsonb_build_object('ok', false, 'reason', 'notest', 'message', '먼저 [설정]에서 내 시험 번호를 넣어 주세요.');
    end if;
  end if;

  for it in
    select (e ->> 'student_id') as sid, coalesce(e ->> 'to', '') as tgt, ord
    from jsonb_array_elements(p_items) with ordinality a(e, ord)
    order by ord
  loop
    if it.tgt not in ('parent1', 'parent2', 'student') or coalesce(it.sid, '') !~* '^[0-9a-f-]{36}$' then continue; end if;
    begin
      select s.name, s.class_name, s.parent_phone, s.parent_phone2, s.student_phone, coalesce(l.hub_code, ''), coalesce(l.student_code, ''), coalesce(l.app_share_code, '')
        into s_name, s_class, p1, p2, sp, hub, stu, appc
        from public.students s left join public.student_links l on l.student_id = s.id
       where s.id = it.sid::uuid and not s.archived;
      if not found then continue; end if;                                        -- 없거나 퇴원한 학생
      ph := case it.tgt when 'parent1' then p1 when 'parent2' then p2 else sp end;
      if not public._phone_ok(ph) then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nophone'); continue;
      end if;
      d := regexp_replace(ph, '\D', '', 'g');
      if seen ? d then
        if (seen ->> d) = it.sid then continue; end if;                          -- 같은 학생 · 같은 번호(학부모 1 = 2) — 한 번만
        if not coalesce(p_siblings, false) then
          skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'sibling'); continue;
        end if;
      end if;
      code := case when it.tgt = 'student' then stu else hub end;
      if position('#{링크}' in body) > 0 and code = '' then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nolink'); continue;
      end if;
      ecode := btrim(coalesce(vars -> it.sid ->> 'code', ''));
      if ecode !~ '^[A-Za-z0-9가-힣_-]{0,30}$' then ecode := ''; end if;
      if needcode and ecode = '' then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nocode'); continue;
      end if;
      /* {첫수업일} — 화면이 학생마다 넘긴 글 (수강 시작일 · 30자 · 줄바꿈 없이 · 052) */
      first := left(regexp_replace(coalesce(vars -> it.sid ->> 'first', ''), '[[:cntrl:]]', '', 'g'), 30);
      /* #{앱 안내} — 앱 공유 링크가 있는 학생만 한 줄 · 없으면 그 줄을 통째로 뺀다 (041) */
      txt := case when appc <> '' then replace(body, '#{앱 안내}', public._sms_app_note())
                  else replace(replace(body, E'\n#{앱 안내}', ''), '#{앱 안내}', '') end;
      txt := replace(replace(replace(replace(replace(replace(txt,
               '#{이름}', coalesce(s_name, '')),
               '#{반}', coalesce(s_class, '')),
               '#{수업일}', left(coalesce(p_lessons ->> coalesce(s_class, ''), ''), 30)),
               '#{입장코드}', ecode),
               '#{앱 설치 링크}', links),
               '#{링크}', case when code = '' then '' else coalesce(p_site, '') || '/me/#' || code end);
      /* 새 칸 (052) — {학생이름} {반이름} {첫수업일} {앱입장코드} {러닝노트주소}(학생 입구 /s/) */
      txt := replace(replace(replace(replace(replace(txt,
               '{학생이름}', coalesce(s_name, '')),
               '{반이름}', coalesce(s_class, '')),
               '{첫수업일}', first),
               '{앱입장코드}', ecode),
               '{러닝노트주소}', coalesce(p_site, '') || '/s/');
      if coalesce(p_ad, false) then
        txt := '(광고)' || (cfg ->> 'adName') || E'\n' || txt || E'\n무료수신거부 ' || (cfg ->> 'optout');
      end if;
      bytes := public._sms_bytes(txt);
      if bytes > 2000 then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'toolong'); continue;
      end if;
      kind := case when bytes <= 90 then 'SMS' else 'LMS' end;
      if not (seen ? d) then seen := seen || jsonb_build_object(d, it.sid); end if;
      n := n + 1;
      rows := rows || jsonb_build_object('student_id', it.sid, 'target', it.tgt, 'to', d, 'name', s_name, 'class_name', coalesce(s_class, ''),
                                         'text', txt, 'kind', kind, 'bytes', bytes);
      if p_test then exit; end if;                                                -- 시험 발송은 첫 사람 내용 하나만
    end;
  end loop;

  if n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'none', 'message', '보낼 수 있는 번호가 없습니다.', 'skipped', skipped);
  end if;
  if not p_test and n > (cfg ->> 'perSend')::int then
    return jsonb_build_object('ok', false, 'reason', 'max',
      'message', '한 번에 ' || (cfg ->> 'perSend') || '건까지 보낼 수 있습니다 (이번 ' || n || '건). 반을 나눠 보내 주세요.');
  end if;
  if public._sms_today_count() + n > (cfg ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily',
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || public._sms_today_count() || '건 · 이번 ' || n || '건 · 하루 ' || (cfg ->> 'dailyMax') || '건).');
  end if;
  if public._sms_month_count() + n > (cfg ->> 'monthMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'monthly',
      'message', '이번 달 보낼 수 있는 건수를 넘습니다 (이번 달 ' || public._sms_month_count() || '건 · 이번 ' || n || '건 · 한 달 ' || (cfg ->> 'monthMax') || '건).');
  end if;

  /* 묶음 줄 — 보낸 기록 · 실패만 다시 보내기 */
  insert into public.sms_batches (id, label, purpose, body, ad, lessons, vars, test, created_by)
  values (batch, left(btrim(coalesce(p_label, '')), 60), left(coalesce(p_purpose, ''), 20), body, coalesce(p_ad, false),
          case when jsonb_typeof(p_lessons) = 'object' then p_lessons else '{}'::jsonb end, vars, coalesce(p_test, false), me);

  /* 기록 줄 먼저 (보내는 중) — 번호는 뒤 4자리만 남긴다 */
  if p_test then
    r := rows -> 0;
    insert into public.sms_log (batch_id, student_id, target, name, class_name, test, phone_last4, kind, ad, body_head, created_by)
    values (batch, (r ->> 'student_id')::uuid, 'test', r ->> 'name', r ->> 'class_name', true,
            right(regexp_replace(tphone, '\D', '', 'g'), 4), r ->> 'kind', coalesce(p_ad, false), left(r ->> 'text', 60), me)
    returning id into lid;
    rows := jsonb_build_array(r || jsonb_build_object('log_id', lid, 'to', regexp_replace(tphone, '\D', '', 'g'), 'target', 'test'));
  else
    rows := coalesce((
      select jsonb_agg(x || jsonb_build_object('log_id', public._sms_log_new(batch, x, coalesce(p_ad, false), p_mark_week, me)) order by o)
      from jsonb_array_elements(rows) with ordinality a(x, o)), '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'batch', batch, 'rows', rows, 'skipped', skipped, 'test', p_test);
end;
$$;

create or replace function public.sms_sent_today(p_purpose text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('student_id', x.student_id, 'target', x.target, 'at', x.at))
      from (select l.student_id, l.target, max(l.created_at) as at
              from public.sms_log l join public.sms_batches b on b.id = l.batch_id
             where b.purpose = left(coalesce(p_purpose, ''), 20) and not l.test and l.status <> 'fail'
               and l.student_id is not null
               and (l.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
             group by l.student_id, l.target) x), '[]'::jsonb) end;
$$;

create or replace function public.sms_purpose_last(p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '{}'::jsonb else coalesce((
    select jsonb_object_agg(x.purpose, x.at)
      from (select b.purpose, max(l.created_at) as at
              from public.sms_log l join public.sms_batches b on b.id = l.batch_id
             where l.student_id = p_student and not l.test and l.status = 'ok' and b.purpose in ('entry', 'welcome')
             group by b.purpose) x), '{}'::jsonb) end;
$$;

create or replace function public.student_logged_ids()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '[]'::jsonb
         else coalesce((select jsonb_agg(distinct student_id) from public.student_logins where ok), '[]'::jsonb) end;
$$;

do $$
declare
  f text;
  stu text;
  rest text;
  base text := E'안녕하세요, 마라톤국어입니다. {학생이름} 학생, 마라톤 스터디 앱을 설치하고 입장코드로 들어와 주세요.\n1) 앱 설치: #{앱 설치 링크}\n2) 앱에서 입장코드 입력: {앱입장코드}\n궁금한 점은 이 번호로 답장 주세요.';
  nx int := coalesce((select max(sort_order) from public.sms_templates), 0);
begin
  f := 'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)';
  execute format('revoke all on function %s from public, anon', f);
  execute format('grant execute on function %s to authenticated', f);
  execute 'revoke all on function public.sms_sent_today(text) from public, anon';
  execute 'grant execute on function public.sms_sent_today(text) to authenticated';
  execute 'revoke all on function public.sms_purpose_last(uuid) from public, anon';
  execute 'grant execute on function public.sms_purpose_last(uuid) to authenticated';
  execute 'revoke all on function public.student_logged_ids() from public, anon';
  execute 'grant execute on function public.student_logged_ids() to authenticated';

  /* 학생용 — 지금 있는 「앱 안내(기본)」 문구를 새 칸으로 · 없으면 기본 앱 안내 글 */
  select replace(replace(replace(body, '#{이름}', '{학생이름}'), '#{입장코드}', '{앱입장코드}'), '#{반}', '{반이름}') into stu
    from public.sms_templates where btrim(title) = '앱 안내(기본)' order by updated_at desc limit 1;
  if stu is null or btrim(stu) = '' then stu := base; end if;
  /* 학부모용 — 첫 줄만 바꾸고 학생이 할 일은 「함께 확인 부탁드립니다」 */
  rest := case when position(E'\n' in stu) > 0 then substr(stu, position(E'\n' in stu) + 1) else '' end;
  if not exists (select 1 from public.sms_templates where btrim(title) = '신입생 웰컴(학생)') then
    insert into public.sms_templates (title, body, sort_order, updated_by) values ('신입생 웰컴(학생)', stu, nx + 1, 'migration-052');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '신입생 웰컴(학부모)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('신입생 웰컴(학부모)', E'안녕하세요, 마라톤국어입니다. {학생이름} 학생의 등록을 환영합니다.\n학생이 아래 순서대로 설치하도록 함께 확인 부탁드립니다.' || case when rest <> '' then E'\n' || rest else '' end, nx + 2, 'migration-052');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '입구 안내') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('입구 안내', '[마라톤국어] {학생이름} 학생, 러닝노트 입구입니다. {러닝노트주소} 반과 이름을 고르고 휴대폰 번호 010 뺀 8자리로 들어오세요.', nx + 3, 'migration-052');
  end if;
end;
$$;


-- ============================================================
--  확인 — 다섯 줄 모두 true
-- ============================================================
select 'sms_prepare 새 칸' as what, (position('{러닝노트주소}' in pg_get_functiondef('public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)'::regprocedure)) > 0)::text as ok
union all select '오늘 이미 보냄', (to_regprocedure('public.sms_sent_today(text)') is not null)::text
union all select '상담 카드 웰컴 안내', (to_regprocedure('public.sms_purpose_last(uuid)') is not null)::text
union all select '로그인한 학생', (to_regprocedure('public.student_logged_ids()') is not null)::text
union all select '웰컴 · 입구 문구', ((select count(*) from public.sms_templates where btrim(title) in ('신입생 웰컴(학생)', '신입생 웰컴(학부모)', '입구 안내')) = 3)::text;
