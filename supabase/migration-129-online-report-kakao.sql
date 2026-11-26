-- ============================================================
--  migration-129-online-report-kakao.sql — 20261126a · 128 다음 · 여러 번 실행해도 됨 · 그다음 함수 kakao-send 다시 배포
--  온라인 반 「📨 레포트 알림톡 보내기」 — 현강 레포트 알림톡(kakao-send · 솔라피 · kakao_alt 대체 문자)을 그대로 씀
--
--  자동 발송 없음 — 코치룸 온라인 반 화면 버튼 → 미리보기(학생 / 학부모 · 체크 · 경우 바꾸기) → 내 시험 번호로 시험 발송 → 확인 → 발송
--  경우 3가지 × 받는 사람 2 = 템플릿 6개 — 이번 주(월 ~ 일) 숙제가 열린 날 중
--    full 다 완주(빠진 날 0) · some 1 ~ n일 빠짐(n = 설정 · 기본 2) · many n+1일 이상 빠짐 · none 이번 주 숙제 없음(보내지 않음 · 직원이 경우를 고르면 보냄)
--    오늘은 마감 전이라 빠진 날로 세지 않는다(낸 날로는 셈)
--  날짜별 표시는 online_student_stats.day_marks(이번 달 · 125) — 달이 바뀌면 지난달 표시를 prev_marks 에 남긴다(아래 트리거)
--    → 월요일에 지난주(달이 걸친 주)를 보내도 셀 수 있다. 129 전에 지나간 달은 없음(그날은 「모름」으로 빼고 셈)
--  템플릿 코드 — 코드 파일에 쓰지 않는다. 기존 설정 표 app_settings 'online_report' { tpl: { s_full … p_many }, some_max } · 원장만 고친다
--    코드가 빈 경우는 「템플릿 등록 전」 — 그 경우만 막고 나머지는 보낸다
--  문구 — 이 파일의 _online_report_body 가 하나뿐인 원본(미리보기 · 대체 문자) · 알림톡 본문은 카카오에 등록한 템플릿
--    (.local/알림톡_온라인레포트_템플릿.md 와 같은 글 · 시험이 둘을 맞춰 본다)
--  보낸 기록 online_report_log — 누가 · 언제 · 반 · 주 · 받는 사람 · 경우 · 결과(접수 · 실패 · 대체 문자는 kakao_alt) · 번호 뒤 4자리만
--    같은 주 · 같은 학생 · 같은 받는 사람에게 이미 보냈으면 「이미 보냄」(다시 보내기를 골라야 보냄)
--  내용 — 이름 · 반 · 이번 주 낸 날 · 연속 · 링크만. 순위 · 비교 · 금액 · 환급 기준 · 전화번호 · 사진 · 모의고사 · AI 는 넣지 않는다
--  온라인 반 「발송 꺼짐」(107)은 현강 레포트 · 문자용 — 이 기능은 직원이 직접 고른 온라인 레포트라 막지 않는다
-- ============================================================

/* ---------- 1. 설정 ---------- */
insert into public.app_settings (key, value)
values ('online_report', jsonb_build_object('tpl', jsonb_build_object('s_full', '', 's_some', '', 's_many', '', 'p_full', '', 'p_some', '', 'p_many', ''), 'some_max', 2))
on conflict (key) do nothing;

create or replace function public._online_report_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tpl', jsonb_build_object(
      's_full', coalesce(btrim(v #>> '{tpl,s_full}'), ''), 's_some', coalesce(btrim(v #>> '{tpl,s_some}'), ''), 's_many', coalesce(btrim(v #>> '{tpl,s_many}'), ''),
      'p_full', coalesce(btrim(v #>> '{tpl,p_full}'), ''), 'p_some', coalesce(btrim(v #>> '{tpl,p_some}'), ''), 'p_many', coalesce(btrim(v #>> '{tpl,p_many}'), '')),
    'some_max', greatest(1, least(6, coalesce(case when (v ->> 'some_max') ~ '^\d{1,2}$' then (v ->> 'some_max')::int end, 2))))
  from (select coalesce((select value from public.app_settings where key = 'online_report'), '{}'::jsonb) v) x;
$$;
revoke all on function public._online_report_cfg() from public, anon, authenticated;

/* 템플릿 코드 — 원장만 · 빈 칸 = 등록 전 */
create or replace function public.online_report_tpl_set(p_case text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := btrim(coalesce(p_case, '')); c text := btrim(coalesce(p_code, ''));
begin
  if not public._real_teacher() then raise exception '알림톡 템플릿 코드는 원장 계정만 바꿀 수 있습니다.'; end if;
  if k not in ('s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many') then raise exception '알 수 없는 템플릿 종류입니다.'; end if;
  if c <> '' and c !~ '^[A-Za-z0-9_-]{4,80}$' then raise exception '템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드(예: KA01TP…)를 그대로 넣어 주세요.'; end if;
  insert into public.app_settings (key, value) values ('online_report', jsonb_build_object('tpl', jsonb_build_object(k, c)))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb)
    || jsonb_build_object('tpl', coalesce(public.app_settings.value -> 'tpl', '{}'::jsonb) || jsonb_build_object(k, c));
  return jsonb_build_object('ok', true, 'case', k, 'set', c <> '');
end;
$$;
revoke all on function public.online_report_tpl_set(text, text) from public, anon;
grant execute on function public.online_report_tpl_set(text, text) to authenticated;

/* 「1 ~ n일 빠짐」의 n — 원장만 (1 ~ 6) */
create or replace function public.online_report_some_set(p_n integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._real_teacher() then raise exception '이 기준은 원장 계정만 바꿀 수 있습니다.'; end if;
  if p_n is null or p_n < 1 or p_n > 6 then raise exception '1 ~ 6 사이로 넣어 주세요.'; end if;
  insert into public.app_settings (key, value) values ('online_report', jsonb_build_object('some_max', p_n))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('some_max', p_n);
  return jsonb_build_object('ok', true, 'some_max', p_n);
end;
$$;
revoke all on function public.online_report_some_set(integer) from public, anon;
grant execute on function public.online_report_some_set(integer) to authenticated;

/* ---------- 2. 문구 (하나뿐인 원본 · 미리보기 · 대체 문자) ----------
   p_key: s_full · s_some · s_many · p_full · p_some · p_many · 변수 #{이름} #{반} #{제출} #{연속} (#{링크}는 버튼 · 대체 문자에서는 본문 끝) */
create or replace function public._online_report_body(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 's_full' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n그런데 이번 주 #{제출}, 하루도 빠짐없이 읽어 냈어요.\n어려운 걸 해냈어요. 정말 대단해요!\n(#{연속} 연속으로 이어 가는 중)\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_some' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n이번 주 #{제출}을 읽었어요. 쉽지 않은 걸 여기까지 해 온 것, 충분히 잘하고 있어요.\n다음 주도 한 지문씩 다시 이어 가 봐요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_many' then E'[마라톤국어] #{이름} 학생, 이번 주 레포트예요\n\n하루 한 지문을 매일 읽는 건 쉽지 않은 일이에요.\n이번 주는 바쁘거나 힘든 일이 있었을 수도 있어요.\n괜찮아요. 오늘 한 지문부터 다시 도전해 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 'p_full' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n하루 한 지문을 매일 읽는 것은 쉽지 않은 일인데,\n#{이름} 학생은 이번 주 #{제출}, 하루도 빠짐없이 읽어 냈습니다.\n(#{연속} 연속으로 이어 가는 중입니다)\n많이 칭찬해 주세요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_some' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n하루 한 지문을 매일 읽는 것은 쉽지 않은 일입니다.\n#{이름} 학생은 이번 주 #{제출}을 읽었고, 꾸준히 이어 가고 있습니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_many' then E'[마라톤국어] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n하루 한 지문을 매일 읽는 것은 쉽지 않은 과정이라, 이어 가기 어려운 주도 있습니다.\n#{이름} 학생이 다시 도전할 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    else '' end;
$$;

/* 경우별로 알림톡에 넘길 변수 (템플릿에 있는 것만 — 솔라피는 템플릿과 변수가 맞아야 받는다) */
create or replace function public._online_report_vars(p_key text)
returns text[] language sql immutable as $$
  select case when p_key in ('s_full', 'p_full') then array['#{이름}', '#{반}', '#{제출}', '#{연속}', '#{링크}']
              when p_key in ('s_some', 'p_some') then array['#{이름}', '#{반}', '#{제출}', '#{링크}']
              when p_key in ('s_many', 'p_many') then array['#{이름}', '#{반}', '#{링크}']
              else '{}'::text[] end;
$$;

/* 채운 글 (대체 문자는 링크를 본문 끝에) */
create or replace function public._online_report_fill(p_key text, p_name text, p_class text, p_submit text, p_streak text, p_link text, p_sms boolean)
returns text language sql immutable as $$
  select left(replace(replace(replace(replace(
           case when p_sms then replace(public._online_report_body(p_key), '아래 [레포트 보기]에서', '아래 링크에서') || E'\n' || coalesce(p_link, '')
                else public._online_report_body(p_key) end,
           '#{이름}', coalesce(p_name, '')), '#{반}', coalesce(p_class, '')), '#{제출}', coalesce(p_submit, '')), '#{연속}', coalesce(p_streak, '')), 2000);
$$;

/* ---------- 3. 지난달 표시 남기기 (달이 바뀌어 day_marks 가 새 달로 바뀔 때) ---------- */
alter table public.online_student_stats add column if not exists prev_ym text not null default '';
alter table public.online_student_stats add column if not exists prev_marks text not null default '';
create or replace function public._online_stats_keep_prev()
returns trigger language plpgsql as $$
begin
  if coalesce(old.ym, '') <> '' and coalesce(new.ym, '') <> coalesce(old.ym, '') and coalesce(old.day_marks, '') <> '' and old.ym < coalesce(new.ym, '') then
    new.prev_ym := old.ym; new.prev_marks := old.day_marks;
  elsif coalesce(new.ym, '') = coalesce(old.ym, '') then
    new.prev_ym := old.prev_ym; new.prev_marks := old.prev_marks;
  end if;
  return new;
end;
$$;
drop trigger if exists online_stats_keep_prev on public.online_student_stats;
create trigger online_stats_keep_prev before update on public.online_student_stats for each row execute function public._online_stats_keep_prev();

/* 학생 한 명 · 그 주(월요일 p_week ~ 일요일) — open 열린 날 · done 낸 날 · miss 빠진 날(오늘 빼고) · unk 모르는 날 · run 연속(낸 날 · 숙제 없는 날 건너뜀) */
create or replace function public._online_week(p_sid uuid, p_week date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  x record; t date := (now() at time zone 'Asia/Seoul')::date; d date; ch text; mk text;
  o int := 0; dn int := 0; ms int := 0; uk int := 0; run int := 0; i int;
begin
  select ym, day_marks, prev_ym, prev_marks into x from public.online_student_stats where student_id = p_sid;
  if not found then return jsonb_build_object('open', 0, 'done', 0, 'miss', 0, 'unk', 7, 'run', 0, 'none', true); end if;
  for i in 0..6 loop
    d := p_week + i;
    if d > t then exit; end if;
    mk := case to_char(d, 'YYYY-MM') when x.ym then x.day_marks when x.prev_ym then x.prev_marks end;
    ch := case when mk is null then null else nullif(substr(mk, extract(day from d)::int, 1), '') end;
    if ch is null then uk := uk + 1;
    elsif ch = 'o' then o := o + 1; dn := dn + 1;
    elsif ch = 'x' and d < t then o := o + 1; ms := ms + 1;
    end if;
  end loop;
  /* 연속 — 오늘부터 거꾸로(오늘 안 낸 것은 건너뜀) · 숙제 없는 날 '.' 건너뜀 · 안 낸 날이나 모르는 날에서 멈춤 · 최대 62일 */
  for i in 0..61 loop
    d := t - i;
    mk := case to_char(d, 'YYYY-MM') when x.ym then x.day_marks when x.prev_ym then x.prev_marks end;
    ch := case when mk is null then null else nullif(substr(mk, extract(day from d)::int, 1), '') end;
    if ch is null then exit; end if;
    if ch = 'o' then run := run + 1;
    elsif ch = 'x' then if d = t then continue; end if; exit;
    end if;
  end loop;
  return jsonb_build_object('open', o, 'done', dn, 'miss', ms, 'unk', uk, 'run', run, 'none', o = 0);
end;
$$;
revoke all on function public._online_week(uuid, date) from public, anon, authenticated;

create or replace function public._online_report_case(w jsonb, p_some int)
returns text language sql immutable as $$
  select case when coalesce((w ->> 'open')::int, 0) = 0 then 'none'
              when coalesce((w ->> 'miss')::int, 0) = 0 then 'full'
              when (w ->> 'miss')::int <= p_some then 'some'
              else 'many' end;
$$;

/* ---------- 4. 보낸 기록 ---------- */
create table if not exists public.online_report_log (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null,
  week_start   date not null,
  class_name   text not null default '',
  student_id   uuid references public.students(id) on delete cascade,
  target       text not null,                      -- student · parent
  rcase        text not null,                      -- full · some · many
  test         boolean not null default false,
  phone_last4  text not null default '',
  status       text not null default 'wait',       -- wait 보내는 중 · ok 접수 · fail 실패
  error        text not null default '',
  message_id   text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  constraint online_report_log_target check (target in ('student', 'parent')),
  constraint online_report_log_case check (rcase in ('full', 'some', 'many')),
  constraint online_report_log_status check (status in ('wait', 'ok', 'fail'))
);
create index if not exists online_report_log_week on public.online_report_log (student_id, week_start, target) where not test;
create index if not exists online_report_log_batch on public.online_report_log (batch_id);
alter table public.online_report_log enable row level security;
revoke all on public.online_report_log from anon, authenticated;

create or replace function public._online_report_today()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.online_report_log
   where (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date and status <> 'fail';
$$;
revoke all on function public._online_report_today() from public, anon, authenticated;

/* ---------- 5. 미리보기 (직원) ---------- */
create or replace function public.online_report_preview(p_class text, p_week date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c jsonb := public._online_report_cfg(); own boolean := public._real_teacher();
  wk date := date_trunc('week', coalesce(p_week, (now() at time zone 'Asia/Seoul')::date))::date;
  sm int; rows jsonb; bodies jsonb;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  if coalesce(btrim(p_class), '') = '' then raise exception '반을 골라 주세요.'; end if;
  sm := (c ->> 'some_max')::int;
  perform public._online_stats_fresh(p_class);
  select coalesce(jsonb_agg(z order by z ->> 'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', s.id, 'name', btrim(coalesce(s.name, '')),
      'sp', case when public._phone_ok(s.student_phone) then public._phone_mask(s.student_phone) else '' end,
      'pp', (select coalesce(jsonb_agg(public._phone_mask(p)), '[]'::jsonb) from
               (select distinct on (regexp_replace(q, '\D', '', 'g')) q as p from unnest(array[s.parent_phone, s.parent_phone2]) q where public._phone_ok(q)) pq),
      'same', public._phone_ok(s.student_phone) and regexp_replace(s.student_phone, '\D', '', 'g') in (regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'), regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g')),
      'slink', coalesce(l.student_code, '') <> '', 'plink', coalesce(l.hub_code, '') <> '',
      'w', w, 'auto', public._online_report_case(w, sm),
      'sent', jsonb_build_object(
        'student', (select jsonb_build_object('at', g.created_at, 'status', g.status, 'case', g.rcase) from public.online_report_log g
                     where g.student_id = s.id and g.week_start = wk and not g.test and g.target = 'student' and g.status <> 'fail' order by g.created_at desc limit 1),
        'parent', (select jsonb_build_object('at', g.created_at, 'status', g.status, 'case', g.rcase) from public.online_report_log g
                     where g.student_id = s.id and g.week_start = wk and not g.test and g.target = 'parent' and g.status <> 'fail' order by g.created_at desc limit 1))) z
      from public._online_roster(p_class) r(id)
      join public.students s on s.id = r.id
      left join public.student_links l on l.student_id = s.id
      cross join lateral (select public._online_week(s.id, wk) w) ww) q;
  select jsonb_object_agg(k, public._online_report_body(k)) into bodies from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k;
  return jsonb_build_object('ok', true, 'class', p_class, 'week', wk, 'today', (now() at time zone 'Asia/Seoul')::date,
    'cfg', jsonb_build_object(
      'some_max', sm, 'owner', own,
      'tplSet', (select jsonb_object_agg(k, (c #>> array['tpl', k]) <> '') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k),
      'tpl', case when own then c -> 'tpl' else '{}'::jsonb end,
      'bodies', bodies,
      'vars', (select jsonb_object_agg(k, to_jsonb(public._online_report_vars(k))) from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k),
      'testPhone', coalesce((select public._phone_mask(phone) from public.kakao_test_phones where email = me), ''),
      'smsFallback', coalesce((public._kakao_cfg() ->> 'smsFallback')::boolean, false),
      'dailyMax', (public._kakao_cfg() ->> 'dailyMax')::int,
      'todayCount', public._kakao_today_count() + public._online_report_today()),
    'rows', rows);
end;
$$;
revoke all on function public.online_report_preview(text, date) from public, anon;
grant execute on function public.online_report_preview(text, date) to authenticated;

/* ---------- 6. 보낼 줄 (kakao-send 가 부른다 · 직원) ----------
   p_items [{ id, case }] · p_target student | parent · p_test → 내 시험 번호로 경우마다 한 통(그 경우 첫 학생 내용)
   건너뜀: noname 이름 없음 · nocase 경우 없음 · notpl 템플릿 등록 전 · nophone 번호 없음 · same 학부모와 같은 번호(학생) · nolink 링크 없음 · already 이번 주 보냄 · notroster 이 반 학생 아님 */
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
    link := site || '/me/#' || code;
    vars := '{}'::jsonb;
    foreach v in array public._online_report_vars(key) loop
      vars := vars || jsonb_build_object(v, case v when '#{이름}' then s.name when '#{반}' then p_class when '#{제출}' then submit when '#{연속}' then streak when '#{링크}' then link end);
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

/* 결과 — [{ log_id, ok, error, message_id }] */
create or replace function public.online_report_record(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) loop
    if coalesce(r ->> 'log_id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    update public.online_report_log set status = case when coalesce((r ->> 'ok')::boolean, false) then 'ok' else 'fail' end,
           error = left(coalesce(r ->> 'error', ''), 300), message_id = left(coalesce(r ->> 'message_id', ''), 80), finished_at = now()
     where id = (r ->> 'log_id')::uuid and status = 'wait';
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
revoke all on function public.online_report_record(jsonb) from public, anon;
grant execute on function public.online_report_record(jsonb) to authenticated;

/* 보낸 기록 — 한 번 보낸 묶음마다 · 누가 · 언제 · 반 · 주 · 받는 사람 · 몇 명 · 경우별 수 · 접수 · 대체 문자 · 실패 (번호 · 이름 없음) */
create or replace function public.online_report_log_list(p_class text default null, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then null else coalesce((
    select jsonb_agg(z order by z ->> 'at' desc) from (
      select jsonb_build_object('batch', g.batch_id, 'at', min(g.created_at), 'by', min(g.created_by), 'class', min(g.class_name), 'week', min(g.week_start),
               'target', min(g.target), 'test', bool_or(g.test), 'people', count(distinct g.student_id), 'msgs', count(*),
               'full', count(*) filter (where g.rcase = 'full'), 'some', count(*) filter (where g.rcase = 'some'), 'many', count(*) filter (where g.rcase = 'many'),
               'ok', count(*) filter (where g.status = 'ok' and not exists (select 1 from public.kakao_alt a where a.log_id = g.id and a.state = 'resent')),
               'alt', count(*) filter (where exists (select 1 from public.kakao_alt a where a.log_id = g.id and a.state = 'resent')),
               'fail', count(*) filter (where g.status = 'fail'), 'wait', count(*) filter (where g.status = 'wait')) z
        from public.online_report_log g
       where p_class is null or g.class_name = p_class
       group by g.batch_id
       order by min(g.created_at) desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))) q), '[]'::jsonb) end;
$$;
revoke all on function public.online_report_log_list(text, integer) from public, anon;
grant execute on function public.online_report_log_list(text, integer) to authenticated;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '125가 먼저 있음(online_student_stats.day_marks)' as what,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'online_student_stats' and column_name = 'day_marks')::text as ok
union all select '084가 먼저 있음(kakao_alt · 대체 문자)', (to_regclass('public.kakao_alt') is not null)::text
union all select '지난달 표시 칸 · 트리거(prev_marks · online_stats_keep_prev)', (exists (select 1 from information_schema.columns where table_name = 'online_student_stats' and column_name = 'prev_marks')
  and exists (select 1 from pg_trigger where tgname = 'online_stats_keep_prev'))::text
union all select '설정(app_settings online_report · 템플릿 6칸)', ((select count(*) from jsonb_object_keys(public._online_report_cfg() -> 'tpl')) = 6)::text
union all select '문구 6가지 · 첫 줄에 이름(학생 · 학부모님)', ((select bool_and(split_part(public._online_report_body(k), E'\n', 1) like case when k like 's_%' then '%#{이름} 학생,%' else '%#{이름} 학생 학부모님,%' end)
  from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '문구에 꼭 · 반드시 · 무조건 · ** 없음', ((select bool_and(public._online_report_body(k) !~ '(꼭|반드시|무조건|\*\*)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '보낸 기록 표(online_report_log) — RLS · 화면에서 직접 못 읽고 못 씀', (to_regclass('public.online_report_log') is not null
  and (select relrowsecurity from pg_class where oid = 'public.online_report_log'::regclass)
  and not has_table_privilege('anon', 'public.online_report_log', 'select') and not has_table_privilege('authenticated', 'public.online_report_log', 'select')
  and not has_table_privilege('authenticated', 'public.online_report_log', 'insert'))::text
union all select '로그인 안 한 사람(anon)은 못 부름', (not has_function_privilege('anon', 'public.online_report_preview(text,date)', 'execute')
  and not has_function_privilege('anon', 'public.online_report_prepare(text,date,text,jsonb,boolean,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'public.online_report_record(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.online_report_tpl_set(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.online_report_log_list(text,integer)', 'execute'))::text
union all select '직원이 아니면 빈 값(online_report_log_list)', (public.online_report_log_list(null, 5) is null)::text;
