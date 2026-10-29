-- ============================================================
--  마라톤 코치룸 — 「앱에서 자세히 보기」 안내 한 줄 (migration-041-app-more.sql · 20261031n)
--
--  실행 방법
--    040 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 기록은 바꾸지 않는다. 함수 배포는 필요 없다.
--
--  1. 문자 칸 #{앱 안내} — 마라톤 앱 공유 링크가 있는 학생에게만
--     「과제를 더 자세히 보시려면 레포트의 '앱에서 자세히 보기'를 눌러 주세요」 한 줄 (없는 학생은 그 줄을 뺀다)
--     sms_prepare 는 040 과 같고 이 칸 하나만 더했다
--  2. 「자주 쓰는 문구」의 「레포트 안내」 끝에 #{앱 안내} 한 줄 (이미 있으면 그대로 · 지운 문구는 다시 만들지 않는다)
--  알림톡 템플릿(주간레포트안내)은 건드리지 않는다.
-- ============================================================

create or replace function public._sms_app_note()
returns text
language sql
immutable
as $$ select '과제를 더 자세히 보시려면 레포트의 ''앱에서 자세히 보기''를 눌러 주세요'::text; $$;

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
  ph text; d text; code text; ecode text; txt text; bytes int; kind text;
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
      if position('#{입장코드}' in body) > 0 and ecode = '' then
        skipped := skipped || jsonb_build_object('student_id', it.sid, 'name', s_name, 'to', it.tgt, 'reason', 'nocode'); continue;
      end if;
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

update public.sms_templates
   set body = body || E'\n#{앱 안내}', updated_at = now()
 where title = '레포트 안내' and position('#{앱 안내}' in body) = 0;

do $$
declare f text;
begin
  execute 'revoke all on function public._sms_app_note() from public, anon, authenticated';
  f := 'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)';
  execute format('revoke all on function %s from public, anon', f);
  execute format('grant execute on function %s to authenticated', f);
end;
$$;


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select 'sms_prepare 앱 안내' as what, (position('#{앱 안내}' in pg_get_functiondef('public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)'::regprocedure)) > 0)::text as ok
union all select '레포트 안내 문구', (not exists (select 1 from public.sms_templates where title = '레포트 안내' and position('#{앱 안내}' in body) = 0))::text;
