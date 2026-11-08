-- ============================================================
--  migration-075-perfect-badge.sql — 주간 퍼펙트 배지 ⭐ (20261108g)
--  (075 는 074 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  기준 — 수업 전 예고와 같은 기간(그날 수업 D-7 ~ D-1 평일)에 나온 과제를 모두 냄
--    늦게 낸 것도 냄 · 면제는 전체에서 뺌 · 과제 수정값(직접 바꾼 값) · 수강 시작일 반영 · 그 주 과제 0개면 배지 없음
--    셈은 note-remind 가 한다 (hwCount — 수업 전 예고 · 과제 현황과 같은 셈)
--  생기는 때 — 수업 전 예고가 계산되는 시각(반 수업 시작 n시간 전 · pre_hours · 예고를 끈 반도 같은 시각)에 저절로 · 원장 확인 없음
--    note-remind 매분 hw_badge_due → 학생마다 셈 → hw_badge_save (반 · 그날 한 번 · hw_badge_runs)
--    수업 전 예고(pre_remind_prepare) · 운영진 과제 현황(hw_status_prepare · 076)도 같은 셈으로 모두 냈으면 배지를 남긴다 (먼저 남긴 쪽 그대로)
--    한 학생 한 주(월~일) 한 번 (hw_weeks · 주 안에 수업이 두 번이어도 하나) · 한 번 퍼펙트가 되면 그대로 둔다
--  학생 알림은 따로 없다 — 수업 전 예고 「모두 제출 칭찬 문자」 끝에 한 줄
--    「⭐ 이번 주 퍼펙트 배지를 받았어요! (지금까지 n개)」 (문구 관리 「퍼펙트 배지 한 줄」 · {개수} · 비우면 안 붙임)
--    칭찬 문자를 끈 반(pre_praise 끔)은 배지만 생긴다
--  다른 학생의 이름 · 순위 · 인원은 학생 · 학부모 화면과 문자에 넣지 않는다
-- ============================================================


-- ------------------------------------------------------------
--  1. 주마다 한 줄 — 그 주 과제 수 · 낸 수 · 퍼펙트
-- ------------------------------------------------------------
create table if not exists public.hw_weeks (
  id          bigserial primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  week_start  date not null,                     -- 그 수업일이 든 주 월요일
  lesson_day  date not null,                     -- 셈한 수업일 (기간 lesson_day - 7 ~ lesson_day - 1)
  class_name  text not null default '',
  done        integer not null default 0,
  total       integer not null default 0,
  perfect     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists hw_weeks_once on public.hw_weeks (student_id, week_start);
create index if not exists hw_weeks_perfect on public.hw_weeks (student_id) where perfect;
alter table public.hw_weeks enable row level security;
drop policy if exists hw_weeks_staff_read on public.hw_weeks;
create policy hw_weeks_staff_read on public.hw_weeks for select to authenticated using (public.is_staff());
revoke all on public.hw_weeks from anon;
revoke insert, update, delete on public.hw_weeks from authenticated;
grant select on public.hw_weeks to authenticated;

/* 반 · 그날 한 번 셈했는지 (매분 다시 세지 않게) */
create table if not exists public.hw_badge_runs (
  day         date not null,
  class_name  text not null,
  students    integer not null default 0,
  perfect     integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (day, class_name)
);
alter table public.hw_badge_runs enable row level security;
drop policy if exists hw_badge_runs_read on public.hw_badge_runs;
create policy hw_badge_runs_read on public.hw_badge_runs for select to authenticated using (public.is_staff());

/* 그 주 한 줄 남기기 — 과제 0개는 남기지 않는다 · 이미 퍼펙트면 그대로 · 아니면 새 셈으로 · 반환: 지금 그 주 퍼펙트인지 */
create or replace function public._hw_week_put(p_student uuid, p_class text, p_day date, p_done integer, p_total integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  tt int := greatest(coalesce(p_total, 0), 0);
  dn int := least(greatest(coalesce(p_done, 0), 0), greatest(coalesce(p_total, 0), 0));
  wk date := p_day - (extract(isodow from p_day)::int - 1);
  pf boolean;
begin
  if p_student is null or p_day is null then return false; end if;
  if tt > 0 then
    insert into public.hw_weeks (student_id, week_start, lesson_day, class_name, done, total, perfect)
    values (p_student, wk, p_day, coalesce(p_class, ''), dn, tt, dn >= tt)
    on conflict (student_id, week_start) do update
       set lesson_day = excluded.lesson_day, class_name = excluded.class_name, done = excluded.done, total = excluded.total,
           perfect = excluded.perfect, updated_at = now()
     where not public.hw_weeks.perfect;
  end if;
  select w.perfect into pf from public.hw_weeks w where w.student_id = p_student and w.week_start = wk;
  return coalesce(pf, false);
end;
$$;
revoke all on function public._hw_week_put(uuid, text, date, integer, integer) from public, anon, authenticated;

/* 지금까지 모은 퍼펙트 배지 수 */
create or replace function public._badge_count(p_student uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.hw_weeks where student_id = p_student and perfect;
$$;
revoke all on function public._badge_count(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
--  2. 문구 「퍼펙트 배지 한 줄」 — 원장이 고친 문구는 덮어쓰지 않는다
-- ------------------------------------------------------------
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates where btrim(title) like '수업 전 예고(%'),
                           coalesce((select max(sort_order) from public.sms_templates), 0) + 1);
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '퍼펙트 배지 한 줄') then
    insert into public.sms_templates (title, body, sort_order, updated_by) values ('퍼펙트 배지 한 줄', '⭐ 이번 주 퍼펙트 배지를 받았어요! (지금까지 {개수}개)', nx, 'migration-075');
  end if;
end;
$$;


-- ------------------------------------------------------------
--  3. 셈할 반 — 오늘 수업 · 시작 n시간 전(pre_hours · 예고를 꺼도) ~ 시작 전 · 오늘 아직 안 셈
-- ------------------------------------------------------------
create or replace function public._badge_due_classes(p_now timestamptz)
returns setof public.classes
language sql stable security definer set search_path = public as $$
  select k.* from public.classes k
   where not k.archived and k.start_time is not null
     and k.start_time >= make_time(coalesce(k.pre_hours, 2), 0, 0)
     and (p_now at time zone 'Asia/Seoul')::time >= k.start_time - make_interval(hours => coalesce(k.pre_hours, 2))
     and (p_now at time zone 'Asia/Seoul')::time < k.start_time
     and public._note_lesson_today(k.name, (p_now at time zone 'Asia/Seoul')::date)
     and not exists (select 1 from public.hw_badge_runs g where g.day = (p_now at time zone 'Asia/Seoul')::date and g.class_name = k.name)
   order by k.name;
$$;
revoke all on function public._badge_due_classes(timestamptz) from public, anon, authenticated;

/* note-remind 매분 — 셈할 반과 학생 (069 의 _hws_students: 이름 · 앱 공유 코드 · 수강 시작일 · 과제 수정값 · 저장본) */
create or replace function public.hw_badge_due(p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
begin
  return jsonb_build_object('ok', true, 'day', d, 'classes', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.name, 'students', public._hws_students(c.name, d)) order by c.name)
      from public._badge_due_classes(coalesce(p_now, now())) c), '[]'::jsonb));
end;
$$;
revoke all on function public.hw_badge_due(timestamptz) from public, anon, authenticated;
grant execute on function public.hw_badge_due(timestamptz) to service_role;

/* 셈 결과 남기기 — p_items { 반: [{ id, known, done, total }] } · 반 · 그날 한 번 */
create or replace function public.hw_badge_save(p_now timestamptz, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
  c record; i jsonb; n int; pf int; total int := 0; got boolean;
begin
  for c in select x.* from public._badge_due_classes(coalesce(p_now, now())) x where p_items ? x.name loop
    n := 0; pf := 0;
    for i in select * from jsonb_array_elements(case when jsonb_typeof(p_items -> c.name) = 'array' then p_items -> c.name else '[]'::jsonb end) loop
      if not coalesce((i ->> 'known')::boolean, true) then continue; end if;
      if not exists (select 1 from public._note_students(c.name, d) s where s.id::text = i ->> 'id') then continue; end if;
      n := n + 1;
      got := public._hw_week_put((i ->> 'id')::uuid, c.name, d, coalesce((i ->> 'done')::int, 0), coalesce((i ->> 'total')::int, 0));
      if got then pf := pf + 1; end if;
    end loop;
    insert into public.hw_badge_runs (day, class_name, students, perfect) values (d, c.name, n, pf) on conflict do nothing;
    total := total + pf;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'perfect', total);
end;
$$;
revoke all on function public.hw_badge_save(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.hw_badge_save(timestamptz, jsonb) to service_role;


-- ------------------------------------------------------------
--  4. 수업 전 예고 — 068 과 같고, 모두 냈으면 배지를 남기고 칭찬 문자 끝에 「⭐ … (지금까지 n개)」 한 줄
-- ------------------------------------------------------------
create or replace function public.pre_remind_prepare(p_now timestamptz, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now0 timestamptz := coalesce(p_now, now());
  d date := (now0 at time zone 'Asia/Seoul')::date;
  b_miss text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(미제출)' order by updated_at desc limit 1), '[마라톤국어] {학생이름} 학생, 이번 주 과제는 {전체수}개 중 {제출수}개가 제출되어 있고, 아직 안 낸 과제는 {밀린날짜}이에요. 다 못 했어도 괜찮아요. 오늘 {수업시각} 수업 전까지 할 수 있는 만큼 제출해 보고, 막힌 부분은 수업에서 같이 풀어 봐요. {기대문장} 수업에서 만나요!');
  b_all  text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(다 냄)' order by updated_at desc limit 1), '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개를 모두 제출했어요! 한 주 동안 매일 루틴을 지켜 내느라 정말 수고했어요. {기대문장} {수업시각} 수업에서 만나요!');
  sent   text := coalesce((select btrim(body) from public.sms_templates where btrim(title) = '수업 전 예고(공통 한 문장)' order by updated_at desc limit 1), '오늘 수업 열심히 준비해 뒀으니 기대해 주세요!');
  b_badge text := coalesce((select btrim(body) from public.sms_templates where btrim(title) = '퍼펙트 배지 한 줄' order by updated_at desc limit 1), '⭐ 이번 주 퍼펙트 배지를 받았어요! (지금까지 {개수}개)');
  c record; x record; it jsonb;
  miss text; title text; tm text; dn int; tt int; bd text; pf boolean;
  rows jsonb := '[]'::jsonb;
  b uuid; txt text; lid uuid; nid bigint;
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
begin
  for c in select * from public._pre_due_classes(now0) loop
    b := null;
    tm := to_char(c.start_time, 'HH24:MI');
    title := public._pre_lesson_title(c.name, d);
    for x in select s.* from public._pre_students(c.name, d) s
              where exists (select 1 from jsonb_array_elements(items) i where i ->> 'id' = s.id::text) loop
      select i into it from jsonb_array_elements(items) i where i ->> 'id' = x.id::text limit 1;
      miss := btrim(left(regexp_replace(coalesce(it ->> 'miss', ''), '[\r\n]+', ' ', 'g'), 120));
      if (it ->> 'total') ~ '^\d{1,3}$' then
        tt := (it ->> 'total')::int;
        dn := least(greatest(coalesce(nullif(it ->> 'done', '')::int, 0), 0), tt);
      else                                                                   -- 예전 함수 (miss 만)
        tt := 0; dn := 0;
      end if;
      /* 미제출 · 모두 제출(반이 끄면 off) · 과제 0개(none) — off · none 은 기록만 남기고 안 보낸다 */
      bd := case when tt = 0 then case when miss <> '' then 'miss' else 'none' end
                 when dn >= tt then case when coalesce(c.pre_praise, true) then 'all' else 'off' end
                 else 'miss' end;
      insert into public.pre_remind_log (day, class_name, student_id, missed, done, total, band)
      values (d, c.name, x.id, bd = 'miss', dn, tt, bd)
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      /* 퍼펙트 배지 — 칭찬 문자를 끈 반도 배지는 생긴다 (075) */
      pf := case when tt > 0 then public._hw_week_put(x.id, c.name, d, dn, tt) else false end;
      if bd not in ('miss', 'all') then nid := null; continue; end if;
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '수업 전 예고', 'pre', b_miss, '자동');
      end if;
      /* {기대문장} — 공통 한 문장 (비면 빠진다 · 남은 겹친 띄어쓰기는 하나로) */
      txt := public._pre_text2(replace(case bd when 'all' then b_all else b_miss end, '{기대문장}', sent), x.name, c.name, tm, miss, title, dn, tt);
      txt := btrim(regexp_replace(txt, ' {2,}', ' ', 'g'));
      if bd = 'all' and pf and b_badge <> '' then
        txt := txt || E'\n' || replace(b_badge, '{개수}', public._badge_count(x.id)::text);
      end if;
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
      update public.pre_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name, 'band', bd, 'done', dn, 'total', tt,
                                         'missed', bd = 'miss', 'perfect', pf);
      nid := null;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.pre_remind_prepare(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.pre_remind_prepare(timestamptz, jsonb) to service_role;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '주마다 한 줄(hw_weeks)' as what, (to_regclass('public.hw_weeks') is not null)::text as ok
union all select '셈 함수', (to_regprocedure('public.hw_badge_due(timestamptz)') is not null and to_regprocedure('public.hw_badge_save(timestamptz, jsonb)') is not null)::text
union all select '문구 「퍼펙트 배지 한 줄」', exists (select 1 from public.sms_templates where btrim(title) = '퍼펙트 배지 한 줄')::text
union all select '수업 전 예고에 배지 한 줄', (position('_hw_week_put' in pg_get_functiondef('public.pre_remind_prepare(timestamptz, jsonb)'::regprocedure)) > 0)::text;
