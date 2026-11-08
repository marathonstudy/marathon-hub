-- ============================================================
--  migration-077-routine-award.sql — 월간 과제 루틴 우수자 🏅 (20261108i)
--  (077 은 076 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  1. 매달 1일 08:00 (note-remind 매분) — 지난달 우수자 후보를 계산한다. 자동 발송은 하지 않는다
--       기준(설정 · 원장만): 그달 제출률 90% 이상 · 늦게 낸 것은 냄 · 면제는 뺌 · 과제 수정값(직접 바꾼 값) · 수강 시작일 반영
--                         그달 과제가 8개 미만이면 뺌
--       상위 % — 반이 아니라 그달 과제가 8개 이상인 전체 수강생(모든 반)의 제출률로
--                 (나보다 제출률이 높은 사람 수 + 1) / 전체 × 100 · 같은 제출률은 같은 % · 정수로 반올림 · 최소 1%
--                 상위 30% 이내일 때만 보여 준다 (30% 는 설정)
--       셈은 note-remind 가 한다 (과제 기록 저장본 app_records · 없으면 앱에서 직접 · 수업 전 예고와 같은 셈)
--  2. 코치룸 「오늘」 맨 위 「10월 루틴 우수자 후보 7명 · 확인하고 보내기」 → 확인 화면
--       반별 후보(이름 · 제출률 · 상위 % · 연속 제출 최장 일수) · 학생별 체크 빼기 · 「선생님 한마디」 한 줄 · 학생이 볼 화면 미리보기
--       [보내기]는 원장만 (서버도 원장인지 본다) · 같은 달은 한 학생에게 한 번만 · [우수자 다시 계산] (보낸 학생은 그대로)
--  3. 문자 — 학생 · 학부모 · LMS · 문구 관리 「루틴 우수자」 {이름} {월} {링크} · % 는 넣지 않는다
--       발송 방식 — 문자 / 알림톡(템플릿 코드 설정 칸 · 비어 있으면 문자) · 알림톡 변수 #{이름} #{월} #{링크} (카톡이 없으면 솔라피가 문자로)
--       사본 한 통 「[사본] 10월 루틴 우수자 · 학생 7명 / 학부모 7명」
--  4. 링크 화면 — 러닝노트 #코드/award/2026-10 (그 학생 링크로만 · 학부모도 같은 화면 · 보낸 달만 열림)
--  다른 학생의 이름 · 순위 · 인원은 학생 · 학부모 화면과 문자에 넣지 않는다 (상위 % 만 · 본인 것) · 상담 · 성적 · 금액 없음 · 상품 관리 없음
-- ============================================================


-- ------------------------------------------------------------
--  1. 설정 · 표
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values ('award', jsonb_build_object('pct', 90, 'min', 8, 'top', 30, 'via', 'sms', 'tpl', ''))
on conflict (key) do nothing;

create or replace function public._award_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pct', greatest(50, least(100, coalesce((v ->> 'pct')::int, 90))),
    'min', greatest(1, least(31, coalesce((v ->> 'min')::int, 8))),
    'top', greatest(1, least(100, coalesce((v ->> 'top')::int, 30))),
    'via', case when v ->> 'via' = 'kakao' then 'kakao' else 'sms' end,
    'tpl', coalesce(btrim(v ->> 'tpl'), ''))
  from (select coalesce((select value from public.app_settings where key = 'award'), '{}'::jsonb) v) x;
$$;
revoke all on function public._award_cfg() from public, anon, authenticated;

/* 기준 · 발송 방식 — 원장만 */
create or replace function public.award_cfg_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := public._award_cfg(); v jsonb := coalesce(p, '{}'::jsonb);
begin
  if not public._real_teacher() then raise exception '루틴 우수자 설정은 원장 계정만 바꿀 수 있습니다.'; end if;
  if v ? 'pct' and coalesce((v ->> 'pct')::int, 0) not between 50 and 100 then raise exception '제출률 기준은 50~100%% 로 정해 주세요.'; end if;
  if v ? 'min' and coalesce((v ->> 'min')::int, 0) not between 1 and 31 then raise exception '그달 과제 수 기준은 1~31개로 정해 주세요.'; end if;
  if v ? 'top' and coalesce((v ->> 'top')::int, 0) not between 1 and 100 then raise exception '상위 %% 기준은 1~100%% 로 정해 주세요.'; end if;
  if v ? 'via' and v ->> 'via' not in ('sms', 'kakao') then raise exception '발송 방식은 문자 또는 알림톡입니다.'; end if;
  if v ? 'tpl' and btrim(coalesce(v ->> 'tpl', '')) <> '' and btrim(v ->> 'tpl') !~ '^[A-Za-z0-9_-]{4,80}$' then
    raise exception '템플릿 코드는 솔라피에 보이는 영문 · 숫자 코드(예: KA01TP…)를 그대로 넣어 주세요.';
  end if;
  c := c || jsonb_strip_nulls(jsonb_build_object(
         'pct', case when v ? 'pct' then (v ->> 'pct')::int end, 'min', case when v ? 'min' then (v ->> 'min')::int end,
         'top', case when v ? 'top' then (v ->> 'top')::int end, 'via', v ->> 'via', 'tpl', case when v ? 'tpl' then btrim(v ->> 'tpl') end));
  insert into public.app_settings (key, value) values ('award', c) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'cfg', public._award_cfg());
end;
$$;
revoke all on function public.award_cfg_set(jsonb) from public, anon;
grant execute on function public.award_cfg_set(jsonb) to authenticated;

/* 달마다 한 번 셈한 기록 */
create table if not exists public.award_runs (
  month       date primary key,                  -- 그달 1일
  eligible    integer not null default 0,        -- 그달 과제가 기준 개수 이상인 전체 수강생 (상위 % 분모)
  candidates  integer not null default 0,
  by_name     text not null default '',
  computed_at timestamptz not null default now()
);
alter table public.award_runs enable row level security;
drop policy if exists award_runs_read on public.award_runs;
create policy award_runs_read on public.award_runs for select to authenticated using (public.is_staff());
revoke all on public.award_runs from anon;
revoke insert, update, delete on public.award_runs from authenticated;

/* 후보 · 보낸 학생 — 한 달 한 학생 한 줄 */
create table if not exists public.routine_awards (
  id          bigserial primary key,
  month       date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  class_name  text not null default '',
  done        integer not null default 0,
  total       integer not null default 0,
  pct         integer not null default 0,
  top_pct     integer,
  streak      integer not null default 0,
  cal         jsonb not null default '{}'::jsonb,      -- { 'YYYY-MM-DD': 'onTime' | 'late' | 'none' | 'exempt' }
  areas       jsonb not null default '[]'::jsonb,      -- [{ name, rate, prev }]
  note        text not null default '',               -- 선생님 한마디
  excluded    boolean not null default false,
  sent_at     timestamptz,
  sent_by     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint routine_awards_note check (char_length(note) <= 120)
);
create unique index if not exists routine_awards_once on public.routine_awards (month, student_id);
alter table public.routine_awards enable row level security;
drop policy if exists routine_awards_read on public.routine_awards;
create policy routine_awards_read on public.routine_awards for select to authenticated using (public.is_staff());
revoke all on public.routine_awards from anon;
revoke insert, update, delete on public.routine_awards from authenticated;
grant select on public.routine_awards, public.award_runs to authenticated;

/* 문구 「루틴 우수자」 — 원장이 고친 문구는 덮어쓰지 않는다 */
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0) + 1;
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '루틴 우수자') then
    insert into public.sms_templates (title, body, sort_order, updated_by) values ('루틴 우수자',
      E'[마라톤국어] {이름} 학생, {월}월 과제 루틴 우수자로 선정되었어요! 한 달 동안 매일의 루틴을 지켜 낸 기록을 정리해 두었어요. 아래 링크에서 확인해 보세요.\n{링크}', nx, 'migration-077');
  end if;
end;
$$;


-- ------------------------------------------------------------
--  2. 셈할 때 · 셈할 학생 (note-remind · service_role)
--     자동 — 지금이 그달 1일 08:00(KST) 이후이고 지난달을 아직 안 셈 · p_month 를 주면 그달(다시 계산)
-- ------------------------------------------------------------
create or replace function public._award_prev(p_now timestamptz)
returns date language sql immutable as $$
  select (date_trunc('month', (coalesce(p_now, now()) at time zone 'Asia/Seoul')) - interval '1 month')::date;
$$;

create or replace function public.award_due(p_now timestamptz, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  m date := coalesce(date_trunc('month', p_month)::date, public._award_prev(p_now));
  e date := (m + interval '1 month')::date - 1;
begin
  if p_month is null and (k < date_trunc('month', k) + interval '8 hours' or exists (select 1 from public.award_runs r where r.month = m)) then
    return jsonb_build_object('ok', true, 'month', null, 'students', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'month', m, 'from', m, 'to', e, 'prev', (m - interval '1 month')::date, 'students', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'class', s.class_name,
             'share', coalesce(nullif(l.app_share_code, ''), ''),
             'startOn', coalesce(s.start_on::text, ''),
             'fix', coalesce((select jsonb_object_agg(f.day::text, f.status)
                                from (select distinct on (h.day) h.day, h.status from public.hw_fixes h
                                       where h.student_id = s.id and h.day >= (m - interval '1 month')::date and h.day <= e
                                       order by h.day, h.id desc) f
                               where f.status <> 'app'), '{}'::jsonb),
             'rec', case when r.data is not null then jsonb_build_object('calendar', coalesce(r.data -> 'calendar', '[]'::jsonb), 'history', coalesce(r.data -> 'history', '[]'::jsonb)) end
           ) order by s.class_name, s.name)
      from public.students s
      left join public.student_links l on l.student_id = s.id
      left join public.app_records r on r.student_id = s.id
     where not s.archived and btrim(coalesce(s.class_name, '')) <> ''
       and (s.start_on is null or s.start_on <= e)
       and (s.left_on is null or s.left_on >= m)), '[]'::jsonb));
end;
$$;
revoke all on function public.award_due(timestamptz, date) from public, anon, authenticated;
grant execute on function public.award_due(timestamptz, date) to service_role;

/* 셈 결과 — p_items [{ id, known, done, total, streak, cal, areas }] · 후보만 남긴다 (보낸 학생은 그대로) */
create or replace function public.award_save(p_month date, p_items jsonb, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  cfg jsonb := public._award_cfg();
  cut int := (cfg ->> 'pct')::int; mn int := (cfg ->> 'min')::int;
  n int; cands int;
  byname text := coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(coalesce(p_by, '')) limit 1), case when coalesce(p_by, '') = '' then '자동' else '' end);
begin
  if m is null then raise exception '달을 골라 주세요.'; end if;
  create temp table if not exists _aw (id uuid, cls text, done int, total int, streak int, cal jsonb, areas jsonb) on commit drop;
  delete from _aw;
  insert into _aw
  select s.id, s.class_name, least(greatest(coalesce((i ->> 'done')::int, 0), 0), greatest(coalesce((i ->> 'total')::int, 0), 0)), greatest(coalesce((i ->> 'total')::int, 0), 0),
         greatest(coalesce((i ->> 'streak')::int, 0), 0),
         case when jsonb_typeof(i -> 'cal') = 'object' then i -> 'cal' else '{}'::jsonb end,
         case when jsonb_typeof(i -> 'areas') = 'array' then i -> 'areas' else '[]'::jsonb end
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) i
    join public.students s on s.id::text = i ->> 'id'
   where coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) >= mn;
  select count(*) into n from _aw;
  /* 후보 — 기준 이상 · 상위 % 는 전체(과제 기준 개수 이상) 중에서 */
  insert into public.routine_awards (month, student_id, class_name, done, total, pct, top_pct, streak, cal, areas)
  select m, a.id, a.cls, a.done, a.total, (a.done * 100 / a.total),
         greatest(1, round(((select count(*) from _aw b where b.done::numeric / b.total > a.done::numeric / a.total) + 1) * 100.0 / n)::int),
         a.streak, a.cal, a.areas
    from _aw a
   where a.done * 100 >= cut * a.total
  on conflict (month, student_id) do update
     set class_name = excluded.class_name, done = excluded.done, total = excluded.total, pct = excluded.pct, top_pct = excluded.top_pct,
         streak = excluded.streak, cal = excluded.cal, areas = excluded.areas, updated_at = now()
   where public.routine_awards.sent_at is null;
  /* 이제 기준 밖이 된 후보는 뺀다 (보낸 학생은 그대로) */
  delete from public.routine_awards w
   where w.month = m and w.sent_at is null
     and not exists (select 1 from _aw a where a.id = w.student_id and a.done * 100 >= cut * a.total);
  select count(*) into cands from public.routine_awards where month = m;
  insert into public.award_runs (month, eligible, candidates, by_name, computed_at) values (m, n, cands, byname, now())
  on conflict (month) do update set eligible = excluded.eligible, candidates = excluded.candidates, by_name = excluded.by_name, computed_at = now();
  return jsonb_build_object('ok', true, 'month', m, 'eligible', n, 'candidates', cands);
end;
$$;
revoke all on function public.award_save(date, jsonb, text) from public, anon, authenticated;
grant execute on function public.award_save(date, jsonb, text) to service_role;


-- ------------------------------------------------------------
--  3. 코치룸 — 확인 화면 · 빼기 · 한마디 (빼기 · 한마디 · 보내기는 원장만)
-- ------------------------------------------------------------
create or replace function public.award_list(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m date; r public.award_runs; cfg jsonb := public._award_cfg();
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  m := coalesce(date_trunc('month', p_month)::date, (select max(x.month) from public.award_runs x));
  select * into r from public.award_runs where month = m;
  return jsonb_build_object(
    'owner', public._real_teacher(),
    'cfg', case when public._real_teacher() then cfg else cfg - 'tpl' || jsonb_build_object('tplSet', cfg ->> 'tpl' <> '') end,
    'month', m, 'computed', r.computed_at, 'eligible', coalesce(r.eligible, 0), 'by', coalesce(r.by_name, ''),
    'cur', public._award_prev(now()),
    'list', coalesce((select jsonb_agg(jsonb_build_object(
               'id', w.student_id, 'name', s.name, 'class', w.class_name, 'pct', w.pct, 'top', w.top_pct, 'showTop', w.top_pct <= (cfg ->> 'top')::int,
               'done', w.done, 'total', w.total, 'streak', w.streak, 'cal', w.cal, 'areas', w.areas, 'note', w.note,
               'excluded', w.excluded, 'sent', w.sent_at, 'badges', public._badge_count(w.student_id) + (select count(*) from public.routine_awards z where z.student_id = w.student_id and z.sent_at is not null),
               'phone', regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g') ~ '^01[0-9]{8,9}$',
               'parent', regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g') ~ '^01[0-9]{8,9}$' or regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g') ~ '^01[0-9]{8,9}$')
             order by w.class_name, w.pct desc, s.name) from public.routine_awards w join public.students s on s.id = w.student_id where w.month = m), '[]'::jsonb));
end;
$$;
revoke all on function public.award_list(date) from public, anon;
grant execute on function public.award_list(date) to authenticated;

create or replace function public.award_pick_set(p_month date, p_student uuid, p_excluded boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.routine_awards;
begin
  if not public._real_teacher() then raise exception '루틴 우수자 확인 · 보내기는 원장 계정만 할 수 있습니다.'; end if;
  select * into w from public.routine_awards where month = date_trunc('month', p_month)::date and student_id = p_student;
  if not found then raise exception '그 후보를 찾지 못했습니다.'; end if;
  if w.sent_at is not null then raise exception '이미 보낸 학생입니다 — 같은 달은 한 번만 보냅니다.'; end if;
  update public.routine_awards set excluded = coalesce(p_excluded, excluded), note = left(btrim(regexp_replace(coalesce(p_note, note), '[\r\n]+', ' ', 'g')), 120), updated_at = now()
   where id = w.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.award_pick_set(date, uuid, boolean, text) from public, anon;
grant execute on function public.award_pick_set(date, uuid, boolean, text) to authenticated;


-- ------------------------------------------------------------
--  4. 보내기 — note-remind 가 원장인지 본 뒤 부른다 (service_role)
--     학생 번호 → 학생 링크 · 학부모 번호(1 · 2) → 학부모 링크 · 같은 번호는 한 통 · 보낸 학생은 sent_at (같은 달 한 번)
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
      link := site || '/me/' || case when kakao then '?c=' || t.code || '&a=' || to_char(m, 'YYYY-MM') else '#' || t.code || '/award/' || to_char(m, 'YYYY-MM') end;   -- 알림톡은 # 대신 ?c= (변수 #{…} 와 겹치지 않게)
      txt := replace(replace(replace(body0, '{이름}', w.name), '{월}', mo), '{링크}', link);
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, mo || '월 루틴 우수자', 'award', body0, coalesce(p_by, ''));
      end if;
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, w.student_id, t.tg, w.name, w.class_name, right(ph, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), coalesce(p_by, ''));
      rows := rows || jsonb_build_object('log_id', lid, 'to', ph, 'text', txt, 'kind', 'LMS', 'class', w.class_name, 'who', t.tg, 'name', w.name,
                                         'kakao', case when kakao then jsonb_build_object('templateId', cfg ->> 'tpl', 'variables',
                                                    jsonb_build_object('#{이름}', w.name, '#{월}', mo, '#{링크}', link)) end);
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


-- ------------------------------------------------------------
--  5. 러닝노트 — 그 학생 링크로만 · 보낸 달만 (상위 % 는 기준 안일 때만 · 다른 학생 정보 없음)
-- ------------------------------------------------------------
create or replace function public._award_view(p_student uuid, p_month date, p_any boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when w.id is null then null else jsonb_build_object(
           'month', to_char(w.month, 'YYYY-MM'), 'mon', extract(month from w.month)::int, 'name', s.name,
           'pct', w.pct, 'top', case when w.top_pct <= (public._award_cfg() ->> 'top')::int then w.top_pct end,
           'done', w.done, 'total', w.total, 'streak', w.streak, 'cal', w.cal, 'areas', w.areas,
           'note', nullif(w.note, ''),
           'badges', public._badge_count(p_student) + (select count(*) from public.routine_awards z where z.student_id = p_student and z.sent_at is not null)) end
    from public.students s
    left join public.routine_awards w on w.student_id = s.id and w.month = date_trunc('month', p_month)::date and (p_any or w.sent_at is not null)
   where s.id = p_student;
$$;
revoke all on function public._award_view(uuid, date, boolean) from public, anon, authenticated;

create or replace function public.hub_award(p_code text, p_month text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  if coalesce(p_month, '') !~ '^\d{4}-\d{2}$' then return null; end if;
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  return public._award_view(s.id, (p_month || '-01')::date, false);
end;
$$;
revoke all on function public.hub_award(text, text) from public;
grant execute on function public.hub_award(text, text) to anon, authenticated;

/* 코치룸 미리보기 — 보내기 전에도 */
create or replace function public.staff_award_view(p_student uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return public._award_view(p_student, p_month, true);
end;
$$;
revoke all on function public.staff_award_view(uuid, date) from public, anon;
grant execute on function public.staff_award_view(uuid, date) to authenticated;


-- ------------------------------------------------------------
--  6. 사본 — 「[사본] 10월 루틴 우수자 · 학생 7명 / 학부모 7명」 (073 의 _copy_line 에 한 갈래)
-- ------------------------------------------------------------
create or replace function public._copy_award(rows jsonb)
returns text language sql stable as $$
  select concat_ws(' / ',
           '학생 ' || count(distinct e ->> 'student_id') filter (where e ->> 'target' = 'student') || '명',
           '학부모 ' || count(distinct e ->> 'student_id') filter (where e ->> 'target' in ('parent1', 'parent2')) || '명')
    from jsonb_array_elements(rows) e;
$$;
create or replace function public._copy_line(rows jsonb, p_auto boolean, p_label text, p_by text)
returns text language sql stable set search_path = public as $$
  select case when coalesce(p_label, '') ~ '^[0-9]{1,2}월 루틴 우수자$' then p_label || ' · ' || public._copy_award(rows)
    when not p_auto and p_label = '과제 문자' then
           coalesce(nullif(public._copy_classes(rows), ''), '과제 문자') || ' · 사람 발송' ||
           coalesce('(' || (select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(p_by) limit 1) || ')', '') ||
           ' · ' || coalesce(nullif(public._copy_hw(rows), ''), '과제 문자')
    else btrim(public._copy_classes(rows) || ' ' || public._copy_who(rows)) || ' · ' ||
    case when p_auto then '자동(' || coalesce(nullif(regexp_replace(p_label, '\((학생|운영진)\)$', ''), ''), '발송') || ')' ||
                          case when p_label = '수업 전 예고' then public._copy_pre(rows) else '' end
         else '사람 발송' || coalesce('(' || (select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(p_by) limit 1) || ')', '') ||
              case when coalesce(p_label, '') <> '' then ' · ' || p_label else '' end end ||
    case when p_label = '레포트 업데이트' then coalesce(' · ' || public._copy_upd_items(rows), '') else '' end end;
$$;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '후보 표(routine_awards)' as what, (to_regclass('public.routine_awards') is not null)::text as ok
union all select '기준 ' || (public._award_cfg() ->> 'pct') || '% · 과제 ' || (public._award_cfg() ->> 'min') || '개 이상 · 상위 ' || (public._award_cfg() ->> 'top') || '%', 'true'
union all select '문구 「루틴 우수자」', exists (select 1 from public.sms_templates where btrim(title) = '루틴 우수자')::text
union all select '보내기는 원장만', (position('_real_teacher' in pg_get_functiondef('public.award_pick_set(date, uuid, boolean, text)'::regprocedure)) > 0)::text;
