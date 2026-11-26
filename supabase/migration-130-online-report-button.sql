-- ============================================================
--  migration-130-online-report-button.sql — 20261126b · 129 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  온라인 반 레포트 알림톡 — 솔라피 등록 전에 마무리
--   ① 문구 2번(학생 1~2일) · 3번(학생 3일+) · 5번(학부모 1~2일)을 새 글로 (1 · 4 · 6번은 그대로) · 대체 문자도 같은 글(_online_report_body 하나뿐인 원본)
--   ② 버튼 링크를 현강 레포트 알림톡(심사 통과한 「주간레포트안내」)과 같은 형식으로
--      모바일 · PC 모두 https://marathonstudy.github.io/marathon-hub/me/?c=#{코드}  (고정 사이트 주소 + 변수)
--      → 알림톡 변수는 #{링크}(전체 주소) 대신 #{코드}(받는 사람 링크 코드 — 학생 → 학생 링크 · 학부모 → 학부모 링크)
--      /me/?c=코드 는 러닝노트가 #코드 주소로 바꿔 연다(assets/hub.js fromQuery)
--      대체 문자는 그대로 본문 끝에 전체 주소(…/me/#코드)
--   ③ 경우마다 템플릿에 실제로 있는 변수만 넘김
--      다 완주(1 · 4번): #{이름} #{제출} #{연속} #{반} #{코드}
--      1~2일(2 · 5번):   #{이름} #{제출} #{반} #{코드}
--      3일+(3 · 6번):    #{이름} #{반} #{코드}
--  kakao-send 는 DB 가 돌려준 변수(vars)를 그대로 넘기므로 함수는 고치지 않는다
-- ============================================================

/* ---------- 1. 문구 (하나뿐인 원본 · 미리보기 · 대체 문자) ---------- */
create or replace function public._online_report_body(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 's_full' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n그런데 이번 주 #{제출}, 하루도 빠짐없이 읽어 냈어요.\n어려운 걸 해냈어요. 정말 대단해요!\n(#{연속} 연속으로 이어 가는 중)\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_some' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n이번 주 #{제출}을 읽었어요.\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n다음 주에는 이번 주보다 한 걸음 더 가 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_many' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n이어 가기 어려운 주도 있어요. 괜찮아요.\n오늘 한 지문부터 다시 도전해 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 'p_full' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n하루 한 지문을 매일 읽는 것은 쉽지 않은 일인데,\n#{이름} 학생은 이번 주 #{제출}, 하루도 빠짐없이 읽어 냈습니다.\n(#{연속} 연속으로 이어 가는 중입니다)\n많이 칭찬해 주세요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_some' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n#{이름} 학생은 이번 주 #{제출}을 읽었습니다.\n하루 한 지문을 매일 읽는 것은 쉽지 않은 일입니다.\n다음 주에는 이번 주보다 한 걸음 더 나아갈 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_many' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n하루 한 지문을 매일 읽는 것은 쉽지 않은 과정이라, 이어 가기 어려운 주도 있습니다.\n#{이름} 학생이 다시 도전할 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    else '' end;
$$;

/* ---------- 2. 경우별로 알림톡에 넘길 변수 (본문 변수 + 버튼 #{코드} — 템플릿에 있는 것만) ---------- */
create or replace function public._online_report_vars(p_key text)
returns text[] language sql immutable as $$
  select case when p_key in ('s_full', 'p_full') then array['#{이름}', '#{반}', '#{제출}', '#{연속}', '#{코드}']
              when p_key in ('s_some', 'p_some') then array['#{이름}', '#{반}', '#{제출}', '#{코드}']
              when p_key in ('s_many', 'p_many') then array['#{이름}', '#{반}', '#{코드}']
              else '{}'::text[] end;
$$;

/* ---------- 3. 보낼 줄 (129 와 같고 변수 #{코드} 만 더함) ---------- */
create or replace function public.online_report_prepare(p_class text, p_week date, p_target text, p_items jsonb, p_test boolean default false, p_resend boolean default false, p_site text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c jsonb := public._online_report_cfg(); kc jsonb := public._kakao_cfg();
  wk date := date_trunc('week', p_week)::date;
  tg text := case when p_target = 'parent' then 'parent' else 'student' end;
  site text := coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub');
  it jsonb; s record; w jsonb; cs text; key text; tpl text; link text; code text; ph text; phs text[];
  rows jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; done_case text[] := '{}';
  tphone text; b uuid := gen_random_uuid(); lid uuid; vars jsonb; v text; submit text; streak text; n int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if p_week is null then raise exception '주를 골라 주세요.'; end if;
  if coalesce(btrim(p_class), '') = '' then raise exception '반을 골라 주세요.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '보낼 학생을 골라 주세요.'); end if;
  if jsonb_array_length(p_items) > 100 then return jsonb_build_object('ok', false, 'reason', 'max', 'message', '한 번에 100명까지 보낼 수 있습니다.'); end if;
  if site !~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]*)?$' then site := 'https://marathonstudy.github.io/marathon-hub'; end if;
  if p_test then
    select phone into tphone from public.kakao_test_phones where email = me;
    if tphone is null or not public._phone_ok(tphone) then
      return jsonb_build_object('ok', false, 'reason', 'notest', 'message', '먼저 「문자 발송 → 연결 상태」에서 내 시험 번호를 넣어 주세요.');
    end if;
    tphone := regexp_replace(tphone, '\D', '', 'g');
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    select st.id, btrim(coalesce(st.name, '')) as name, st.student_phone, st.parent_phone, st.parent_phone2,
           coalesce(l.student_code, '') as scode, coalesce(l.hub_code, '') as pcode
      into s from public.students st left join public.student_links l on l.student_id = st.id
     where st.id = (it ->> 'id')::uuid and not st.archived;
    if not found then continue; end if;
    if not exists (select 1 from public._online_roster(p_class) r(id) where r.id = s.id) then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'notroster'); continue;
    end if;
    cs := coalesce(it ->> 'case', '');
    if cs not in ('full', 'some', 'many') then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nocase'); continue; end if;
    if s.name = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', '', 'reason', 'noname'); continue; end if;
    key := left(tg, 1) || '_' || cs;
    tpl := c #>> array['tpl', key];
    if coalesce(tpl, '') = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'notpl', 'case', cs); continue; end if;
    code := case when tg = 'student' then s.scode else s.pcode end;
    if code = '' then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nolink'); continue; end if;
    if tg = 'student' then
      if not public._phone_ok(s.student_phone) then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nophone'); continue; end if;
      if regexp_replace(s.student_phone, '\D', '', 'g') in (regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'), regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g')) then
        skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'same'); continue;
      end if;
      phs := array[regexp_replace(s.student_phone, '\D', '', 'g')];
    else
      phs := array(select distinct regexp_replace(q, '\D', '', 'g') from unnest(array[s.parent_phone, s.parent_phone2]) q where public._phone_ok(q));
      if cardinality(phs) = 0 then skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'nophone'); continue; end if;
    end if;
    if not p_test and not coalesce(p_resend, false) and exists (select 1 from public.online_report_log g where g.student_id = s.id and g.week_start = wk and not g.test and g.target = tg and g.status <> 'fail') then
      skipped := skipped || jsonb_build_object('id', s.id, 'name', s.name, 'reason', 'already'); continue;
    end if;
    if p_test then
      if cs = any(done_case) then continue; end if;      /* 시험 — 경우마다 한 통 */
      done_case := done_case || cs; phs := array[tphone];
    end if;
    w := public._online_week(s.id, wk);
    submit := (w ->> 'open') || '일 중 ' || (w ->> 'done') || '일';
    streak := greatest(1, coalesce((w ->> 'run')::int, 0))::text || '일';
    link := site || '/me/#' || code;                     /* 대체 문자 본문 끝 · 알림톡 버튼은 /me/?c=#{코드} */
    vars := '{}'::jsonb;
    foreach v in array public._online_report_vars(key) loop
      vars := vars || jsonb_build_object(v, case v when '#{이름}' then s.name when '#{반}' then p_class when '#{제출}' then submit when '#{연속}' then streak
                                                   when '#{코드}' then code when '#{링크}' then link end);
    end loop;
    foreach ph in array phs loop
      n := n + 1;
      rows := rows || jsonb_build_object('student_id', s.id, 'name', s.name, 'to', ph, 'tpl', tpl, 'case', cs, 'key', key, 'vars', vars, 'link', link,
                'alt', public._online_report_fill(key, s.name, p_class, submit, streak, link, true));
    end loop;
  end loop;

  if n = 0 then return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'skipped', skipped, 'test', p_test); end if;
  if public._kakao_today_count() + public._online_report_today() + n > (kc ->> 'dailyMax')::int then
    return jsonb_build_object('ok', false, 'reason', 'daily', 'skipped', skipped,
      'message', '오늘 보낼 수 있는 건수를 넘습니다 (오늘 ' || (public._kakao_today_count() + public._online_report_today()) || '건 · 이번 ' || n || '건 · 하루 ' || (kc ->> 'dailyMax') || '건).');
  end if;
  select coalesce(jsonb_agg(r || jsonb_build_object('log_id', gen_random_uuid())), '[]'::jsonb) into rows from jsonb_array_elements(rows) r;
  insert into public.online_report_log (id, batch_id, week_start, class_name, student_id, target, rcase, test, phone_last4, created_by)
  select (r ->> 'log_id')::uuid, b, wk, p_class, (r ->> 'student_id')::uuid, tg, r ->> 'case', coalesce(p_test, false), right(r ->> 'to', 4), me
    from jsonb_array_elements(rows) r;
  return jsonb_build_object('ok', true, 'rows', rows, 'skipped', skipped, 'test', p_test, 'batch', b, 'smsFallback', coalesce((kc ->> 'smsFallback')::boolean, false));
end;
$$;
revoke all on function public.online_report_prepare(text, date, text, jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.online_report_prepare(text, date, text, jsonb, boolean, boolean, text) to authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '129가 먼저 있음(online_report_log)' as what, (to_regclass('public.online_report_log') is not null)::text as ok
union all select '새 문구 2번(학생 1~2일)', (position('한 걸음 더 가 봐요' in public._online_report_body('s_some')) > 0)::text
union all select '새 문구 3번(학생 3일+)', (position('이어 가기 어려운 주도 있어요. 괜찮아요.' in public._online_report_body('s_many')) > 0)::text
union all select '새 문구 5번(학부모 1~2일)', (position('한 걸음 더 나아갈 수 있도록' in public._online_report_body('p_some')) > 0)::text
union all select '본문 변수 = 넘기는 변수(버튼 #{코드} 더함 · 6개 모두)', ((select bool_and(
    (select coalesce(array_agg(distinct m[1] order by m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']
    @> public._online_report_vars(k)
    and public._online_report_vars(k) @> ((select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']))
  from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '#{링크}(전체 주소)는 알림톡 변수에서 빠짐', (not exists (select 1 from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k where '#{링크}' = any(public._online_report_vars(k))))::text
union all select '보낼 줄에 #{코드} 채움(online_report_prepare)', (position('#{코드}'' then code' in pg_get_functiondef('public.online_report_prepare(text,date,text,jsonb,boolean,boolean,text)'::regprocedure)) > 0)::text
union all select '문구에 꼭 · 반드시 · 무조건 · ** 없음', ((select bool_and(public._online_report_body(k) !~ '(꼭|반드시|무조건|\*\*)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '로그인 안 한 사람(anon)은 못 부름', (not has_function_privilege('anon', 'public.online_report_prepare(text,date,text,jsonb,boolean,boolean,text)', 'execute'))::text;
