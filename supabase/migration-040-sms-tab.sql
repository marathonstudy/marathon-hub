-- ============================================================
--  마라톤 코치룸 — 「문자 발송」 탭 · 새 학생 앱 안내 문자 (migration-040-sms-tab.sql)
--
--  실행 방법
--    039 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 보낸 문자 기록 · 학생 · 레포트는 바꾸지 않는다.
--  이 SQL 을 실행한 뒤 Edge Function sms-send · kakao-send 를 새 코드로 다시 배포한다 (순서가 바뀌어도 예전처럼 보내진다).
--
--  1. sms_batches — 한 번 보낸 묶음 (보낸 기록 「10/29 15:30 · 고2 선수능반 레포트 안내 · 22건 · 성공 22」)
--     이름(문구 이름) · 쓴 글(#{이름} 같은 칸 그대로) · 수업일 · 입장코드 · 광고 여부 — 「실패만 다시 보내기」가 같은 글로 다시 보낸다.
--     sms_log.batch_id 와 같은 id. 예전 기록(이 표가 생기기 전)은 묶음 이름 없이 날짜 · 건수만 보인다.
--  2. classes.app_code — 반 설정 「앱 입장코드」. 그 반 학생을 등록할 때 앱 안내 문자의 입장코드 칸에 자동으로 (바꿀 수 있음)
--  3. 문자 설정('sms')에 한 달 최대(monthMax · 기본 3000) · 앱 설치 링크(androidUrl · iosUrl)
--     sms_settings_get 이 이번 달 보낸 건수(month)도 준다 — 「문자 발송 → 연결 상태」 「이번 달 남은 n건」
--  4. sms_prepare — #{입장코드}(학생마다 · 화면이 반 입장코드나 직접 친 값을 넘긴다) · #{앱 설치 링크}(설정의 링크) · 한 달 최대
--     · 묶음 이름(p_label) · 목적(p_purpose: app 앱 안내 …) · 묶음 줄을 남긴다.
--  5. sms_batch_list · sms_batch_get — 보낸 기록 (문자 묶음 + 알림톡은 직원 · 주 · 분 · 시험 여부마다 한 묶음)
--  6. 자주 쓰는 문구 — 순서 바꾸기(sms_templates_reorder) · 「앱 안내(기본)」 문구 (처음 한 번만 · 지우면 다시 생기지 않는다)
--  모두 직원만 (조교 · 선생님 같다).
-- ============================================================


-- ------------------------------------------------------------
--  1. 묶음
-- ------------------------------------------------------------
create table if not exists public.sms_batches (
  id          uuid primary key,
  label       text not null default '',               -- 문구 이름 (「레포트 안내」 「앱 안내(기본)」 …)
  purpose     text not null default '',               -- '' · app(앱 안내) · report · notify
  body        text not null default '',               -- 쓴 글 (#{이름} … 그대로)
  ad          boolean not null default false,
  lessons     jsonb not null default '{}'::jsonb,     -- 반 → #{수업일}
  vars        jsonb not null default '{}'::jsonb,     -- 학생 id → { code: 입장코드 }
  test        boolean not null default false,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  constraint sms_batches_len check (char_length(label) <= 60 and char_length(body) <= 2000 and char_length(purpose) <= 20)
);
create index if not exists sms_batches_day_idx on public.sms_batches (created_at);
alter table public.sms_batches enable row level security;
drop policy if exists sms_batches_staff_read on public.sms_batches;
create policy sms_batches_staff_read on public.sms_batches for select to authenticated using (public.is_staff());
create index if not exists sms_log_batch_idx on public.sms_log (batch_id);


-- ------------------------------------------------------------
--  2. 반 앱 입장코드
-- ------------------------------------------------------------
alter table public.classes add column if not exists app_code text not null default '';

create or replace function public.class_app_code_set(p_name text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := btrim(coalesce(p_code, ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if c <> '' and c !~ '^[A-Za-z0-9가-힣_-]{2,30}$' then raise exception '입장코드는 영문 · 숫자 · 한글 2 ~ 30자로 적어 주세요 (띄어쓰기 없이).'; end if;
  update public.classes set app_code = c where name = p_name;
  if not found then raise exception '반을 찾지 못했습니다: %', p_name; end if;
  return jsonb_build_object('ok', true, 'name', p_name, 'app_code', c);
end;
$$;


-- ------------------------------------------------------------
--  3. 문자 설정 — 한 달 최대 · 앱 설치 링크
-- ------------------------------------------------------------
create or replace function public._sms_cfg()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'smsWon', greatest(0, least(1000, coalesce((v ->> 'smsWon')::int, 20))),
    'lmsWon', greatest(0, least(1000, coalesce((v ->> 'lmsWon')::int, 50))),
    'perSend', greatest(1, least(1000, coalesce((v ->> 'perSend')::int, 200))),
    'dailyMax', greatest(1, least(10000, coalesce((v ->> 'dailyMax')::int, 500))),
    'monthMax', greatest(1, least(100000, coalesce((v ->> 'monthMax')::int, 3000))),
    'adName', left(coalesce(v ->> 'adName', '마라톤국어'), 30),
    'optout', coalesce(v ->> 'optout', ''),
    'androidUrl', left(coalesce(v ->> 'androidUrl', ''), 300),
    'iosUrl', left(coalesce(v ->> 'iosUrl', ''), 300))
  from (select coalesce((select value from public.app_settings where key = 'sms'), '{}'::jsonb) v) x;
$$;

create or replace function public._sms_month_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.sms_log
  where date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul') and status <> 'fail';
$$;

/* #{앱 설치 링크} — 둘 다 있으면 두 줄 (안드로이드 · 아이폰) */
create or replace function public._sms_app_links()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a <> '' and i <> '' then E'\n안드로이드 ' || a || E'\n아이폰 ' || i
    when a <> '' then a
    when i <> '' then i
    else '' end
  from (select btrim(public._sms_cfg() ->> 'androidUrl') a, btrim(public._sms_cfg() ->> 'iosUrl') i) x;
$$;

create or replace function public.sms_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._sms_cfg() || jsonb_build_object(
    'testPhone', coalesce((select public._phone_mask(phone) from public.kakao_test_phones where email = me), ''),
    'today', public._sms_today_count(),
    'month', public._sms_month_count());
end;
$$;

/* 단가 · 상한 · 광고 칸 — 앱 설치 링크는 그대로 둔다 (sms_app_links_set 으로만) · 한 달 최대가 없으면 지금 값 */
create or replace function public.sms_settings_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur jsonb := public._sms_cfg();
  sw int := (p ->> 'smsWon')::int;
  lw int := (p ->> 'lmsWon')::int;
  ps int := (p ->> 'perSend')::int;
  dm int := (p ->> 'dailyMax')::int;
  mm int := coalesce((p ->> 'monthMax')::int, (cur ->> 'monthMax')::int);
  an text := btrim(coalesce(p ->> 'adName', ''));
  oo text := regexp_replace(coalesce(p ->> 'optout', ''), '[^0-9-]', '', 'g');
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if sw is null or sw < 0 or sw > 1000 or lw is null or lw < 0 or lw > 1000 then raise exception '단가는 0 ~ 1000원으로 적어 주세요.'; end if;
  if ps is null or ps < 1 or ps > 1000 then raise exception '한 번 최대 건수는 1 ~ 1000 으로 정해 주세요.'; end if;
  if dm is null or dm < 1 or dm > 10000 then raise exception '하루 최대 건수는 1 ~ 10000 으로 정해 주세요.'; end if;
  if mm is null or mm < 1 or mm > 100000 then raise exception '한 달 최대 건수는 1 ~ 100000 으로 정해 주세요.'; end if;
  if char_length(an) > 30 then raise exception '광고 발신처 이름은 30자까지 적어 주세요.'; end if;
  if oo <> '' and length(regexp_replace(oo, '\D', '', 'g')) not between 8 and 12 then raise exception '무료수신거부 번호(080 …)를 확인해 주세요.'; end if;
  insert into public.app_settings (key, value)
  values ('sms', jsonb_build_object('smsWon', sw, 'lmsWon', lw, 'perSend', ps, 'dailyMax', dm, 'monthMax', mm, 'adName', an, 'optout', oo,
                                    'androidUrl', cur ->> 'androidUrl', 'iosUrl', cur ->> 'iosUrl'))
  on conflict (key) do update set value = excluded.value;
  return public._sms_cfg();
end;
$$;

/* 앱 설치 링크 (안드로이드 · 아이폰) — https:// 주소만 · 빈 칸이면 지운다 */
create or replace function public.sms_app_links_set(p_android text, p_ios text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a text := btrim(coalesce(p_android, ''));
  i text := btrim(coalesce(p_ios, ''));
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if (a <> '' and (a !~ '^https://\S{4,}$' or char_length(a) > 300)) or (i <> '' and (i !~ '^https://\S{4,}$' or char_length(i) > 300)) then
    raise exception '앱 설치 링크는 https:// 로 시작하는 주소를 그대로 붙여 넣어 주세요.';
  end if;
  insert into public.app_settings (key, value)
  values ('sms', public._sms_cfg() || jsonb_build_object('androidUrl', a, 'iosUrl', i))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('androidUrl', a, 'iosUrl', i);
  return public._sms_cfg();
end;
$$;


-- ------------------------------------------------------------
--  4. 보낼 줄 만들기 — 023 과 같고 #{입장코드} · #{앱 설치 링크} · 한 달 최대 · 묶음 줄만 더했다
-- ------------------------------------------------------------
drop function if exists public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text);
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
  s_name text; s_class text; p1 text; p2 text; sp text; hub text; stu text;
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
      select s.name, s.class_name, s.parent_phone, s.parent_phone2, s.student_phone, coalesce(l.hub_code, ''), coalesce(l.student_code, '')
        into s_name, s_class, p1, p2, sp, hub, stu
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
      txt := replace(replace(replace(replace(replace(replace(body,
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


-- ------------------------------------------------------------
--  5. 보낸 기록 — 묶음 목록 · 묶음 하나
--     문자: sms_batches(없으면 sms_log 만으로) · 알림톡: kakao_log 를 직원 · 주 · 분마다 한 묶음으로
--     키 's:<묶음 id>' · 'k:<주>|<직원>|<분 YYYYMMDDHH24MI>|<시험 t/f>'
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

create or replace function public.sms_batch_get(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text := coalesce(p_key, '');
  bid uuid; b public.sms_batches;
  wk date; byem text; mn text; parts text[];
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  if k ~* '^s:[0-9a-f-]{36}$' then
    bid := substr(k, 3)::uuid;
    select * into b from public.sms_batches where id = bid;
    return jsonb_build_object('ok', true, 'key', k, 'via', 'sms',
      'label', coalesce(b.label, ''), 'purpose', coalesce(b.purpose, ''), 'body', coalesce(b.body, ''), 'ad', coalesce(b.ad, false),
      'lessons', coalesce(b.lessons, '{}'::jsonb), 'vars', coalesce(b.vars, '{}'::jsonb), 'hasBody', b.id is not null,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('student_id', l.student_id, 'target', l.target, 'name', l.name, 'class_name', l.class_name,
                          'last4', l.phone_last4, 'kind', l.kind, 'status', l.status, 'error', l.error, 'test', l.test,
                          'at', l.created_at, 'done_at', l.finished_at) order by l.created_at, l.name)
        from public.sms_log l where l.batch_id = bid), '[]'::jsonb));
  end if;
  if k like 'k:%' then
    parts := string_to_array(substr(k, 3), '|');
    if array_length(parts, 1) <> 4 then raise exception '기록을 찾지 못했습니다.'; end if;
    wk := nullif(parts[1], '')::date; byem := parts[2]; mn := parts[3];
    return jsonb_build_object('ok', true, 'key', k, 'via', 'kakao', 'label', '알림톡 · 레포트 안내', 'purpose', 'report', 'week', wk,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('student_id', x.student_id, 'target', 'parent', 'name', coalesce(s.name, ''), 'class_name', coalesce(s.class_name, ''),
                          'last4', x.phone_last4, 'kind', '알림톡', 'status', x.status, 'error', x.error, 'test', x.test,
                          'at', x.created_at, 'done_at', x.finished_at) order by x.created_at, s.name)
        from public.kakao_log x left join public.students s on s.id = x.student_id
        where x.week_start is not distinct from wk and x.created_by = byem
          and to_char(date_trunc('minute', x.created_at), 'YYYYMMDDHH24MI') = mn and x.test = (parts[4] = 't')), '[]'::jsonb));
  end if;
  raise exception '기록을 찾지 못했습니다.';
end;
$$;


-- ------------------------------------------------------------
--  6. 자주 쓰는 문구 — 순서 · 「앱 안내(기본)」
-- ------------------------------------------------------------
create or replace function public.sms_templates_reorder(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.sms_templates t set sort_order = x.o
    from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality x(id, o)
   where t.id = x.id;
  return jsonb_build_object('ok', true);
end;
$$;

do $$
begin
  if not exists (select 1 from public.app_settings where key = 'sms_seed_app') then
    if not exists (select 1 from public.sms_templates where title = '앱 안내(기본)') then
      insert into public.sms_templates (title, body, sort_order) values
        ('앱 안내(기본)', E'안녕하세요, 마라톤국어입니다. #{이름} 학생, 마라톤 스터디 앱을 설치하고 입장코드로 들어와 주세요.\n1) 앱 설치: #{앱 설치 링크}\n2) 앱에서 입장코드 입력: #{입장코드}\n궁금한 점은 이 번호로 답장 주세요.',
         coalesce((select max(sort_order) from public.sms_templates), 0) + 1);
    end if;
    insert into public.app_settings (key, value) values ('sms_seed_app', '{"done": true}'::jsonb) on conflict (key) do nothing;
  end if;
end;
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._sms_cfg()', 'public._sms_month_count()', 'public._sms_app_links()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.sms_settings_get()', 'public.sms_settings_set(jsonb)', 'public.sms_app_links_set(text, text)',
                           'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)',
                           'public.sms_batch_list(date, date, text, uuid, integer)', 'public.sms_batch_get(text)',
                           'public.sms_templates_reorder(uuid[])', 'public.class_app_code_set(text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ============================================================
--  확인 — 네 줄 모두 true
-- ============================================================
select 'sms_batches' as what, exists (select 1 from pg_tables where tablename = 'sms_batches' and rowsecurity)::text as ok
union all select 'classes.app_code', exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'app_code')::text
union all select 'sms_prepare', (not has_function_privilege('anon', 'public.sms_prepare(jsonb, text, boolean, jsonb, boolean, boolean, date, text, text, text, jsonb)', 'execute'))::text
union all select 'app_template', exists (select 1 from public.app_settings where key = 'sms_seed_app')::text;
