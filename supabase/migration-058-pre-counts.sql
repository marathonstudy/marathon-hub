-- ============================================================
--  마라톤 코치룸 — 수업 전 예고 문자: 3시간 전 · 학생마다 제출 수 (migration-058-pre-counts.sql · 20261101l)
--
--  실행 방법 (순서)
--    1. 057 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--    2. Edge Function note-remind 를 다시 배포 (함수가 학생마다 제출 수 · 전체 수를 센다).
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 보낸 기록은 바꾸지 않는다. 새 키는 없다.
--
--  1. 보내는 시각 — 기본 「수업 시작 3시간 전」 (반 카드 [바꾸기]에서 바꾸는 것은 그대로)
--     지금 반(보관 안 함)이 예전 기본 2시간 그대로면 3시간으로 (직접 바꾼 1 · 4 ~ 12시간은 그대로) · 맨 아래 결과에 반마다 시각
--  2. 문구 네 개 — 문자 문구 관리에서 고칠 수 있다
--       「수업 전 예고(다 냄)」 · 「수업 전 예고(일부 냄)」(절반 이상) · 「수업 전 예고(많이 밀림)」(절반 미만) · 「수업 전 예고(과제 없음)」(전체 0)
--     칸: {학생이름} {수업시각} {제출수} {전체수} {밀린날짜} {오늘수업} ({반이름}도 된다)
--     056 의 「수업 전 예고(밀린 과제)」 · 「수업 전 예고(다 함)」은 고친 적이 없으면 지운다 (고쳤으면 그대로 두고 쓰지 않는다)
--  3. 숫자 — 함수(note-remind)가 앱 기록으로 센다: 직전 수업 이후(D-7 ~ D-1) 마감이 지난 평일 과제
--       전체수 = 과제가 있던 평일(면제 · 수강 시작 전 제외) · 제출수 = 낸 날(늦게 낸 것 포함) · 밀린날짜 = 안 낸 날
--       오늘 과제는 마감 전이라 빼고 · 토 · 일 주중 복습은 세지 않는다
--  4. 반 카드 「15:30 보냄 11명(다 냄 5 · 일부 4 · 밀림 2)」 — pre_remind_status 가 구간마다 센다
--  대상(학생 본인만 · 퇴원 · 결석 · 번호 없음 · 종강 반 제외 · 같은 날 한 번)은 056 그대로
-- ============================================================


-- ------------------------------------------------------------
--  1. 3시간 전
-- ------------------------------------------------------------
alter table public.classes alter column pre_hours set default 3;
drop table if exists pg_temp._m58;
create temp table _m58 as select name, pre_hours as before from public.classes where not archived;
update public.classes set pre_hours = 3 where not archived and pre_hours = 2;

create or replace function public.class_pre_set(p_class text, p_on boolean, p_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.classes;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  select * into c from public.classes where name = btrim(coalesce(p_class, ''));
  if not found then raise exception '그 반을 찾지 못했습니다.'; end if;
  if coalesce(p_hours, 3) not between 1 and 12 then raise exception '「수업 몇 시간 전」은 1~12시간으로 정해 주세요.'; end if;
  if coalesce(p_on, false) and c.start_time is null then raise exception '수업 전 문자를 켜려면 수업 시작 시각을 넣어 주세요.'; end if;
  update public.classes set pre_remind = coalesce(p_on, false), pre_hours = coalesce(p_hours, 3) where name = c.name;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.class_pre_set(text, boolean, integer) from public, anon;
grant execute on function public.class_pre_set(text, boolean, integer) to authenticated;


-- ------------------------------------------------------------
--  2. 문구
-- ------------------------------------------------------------
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0);
begin
  delete from public.sms_templates where btrim(title) in ('수업 전 예고(밀린 과제)', '수업 전 예고(다 함)') and updated_by = 'migration-056';
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(다 냄)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(다 냄)', '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 모두 제출했네요! 꾸준히 달려온 만큼 오늘 {수업시각} 수업이 더 잘 들어올 거예요. 이따 교실에서 만나요!', nx + 1, 'migration-058');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(일부 냄)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(일부 냄)', '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 중 {제출수}개 제출했어요. 남은 {밀린날짜} 과제까지 수업 전에 마무리하고 오면 오늘 {수업시각} 수업이 훨씬 잘 들어올 거예요. 이따 만나요!', nx + 2, 'migration-058');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(많이 밀림)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(많이 밀림)', '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 중 {제출수}개 제출했어요. 오늘 {수업시각} 수업 전까지 {밀린날짜} 과제를 하나씩만이라도 채워 오세요. 수업 시간에 같이 정리해 봐요!', nx + 3, 'migration-058');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 전 예고(과제 없음)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 전 예고(과제 없음)', '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날이에요. 이따 교실에서 만나요!', nx + 4, 'migration-058');
  end if;
end;
$$;


-- ------------------------------------------------------------
--  3. 숫자 · 구간
-- ------------------------------------------------------------
alter table public.pre_remind_log add column if not exists done  smallint;
alter table public.pre_remind_log add column if not exists total smallint;
alter table public.pre_remind_log add column if not exists band  text;     -- all 다 냄 · part 일부 냄(절반 이상) · low 많이 밀림(절반 미만) · none 과제 없음

/* 구간 — 전체 0 → none · 다 냄 → all · 절반 이상 → part · 절반 미만 → low */
create or replace function public._pre_band(p_done integer, p_total integer)
returns text
language sql
immutable
as $$
  select case when coalesce(p_total, 0) <= 0 then 'none'
              when coalesce(p_done, 0) >= p_total then 'all'
              when coalesce(p_done, 0) * 2 >= p_total then 'part'
              else 'low' end;
$$;

create or replace function public._pre_text2(p_body text, p_name text, p_class text, p_time text, p_miss text, p_title text, p_done integer, p_total integer)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(public._pre_text(p_body, p_name, p_class, p_time, p_miss, p_title),
           '{제출수}', coalesce(p_done, 0)::text), '{전체수}', coalesce(p_total, 0)::text);
$$;
revoke all on function public._pre_band(integer, integer) from public, anon, authenticated;
revoke all on function public._pre_text2(text, text, text, text, text, text, integer, integer) from public, anon, authenticated;

/* 보낼 줄 — p_items [{ id, done, total, miss: '10/27(화) 10/29(목)' }] (함수가 앱 기록으로 센 것 · 판단 못 한 학생은 넣지 않는다)
   056 과 같고 문구를 구간으로 고른다 · done · total 이 없으면 예전 모양(miss 만)으로 — miss 가 있으면 일부 냄 */
create or replace function public.pre_remind_prepare(p_now timestamptz, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now0 timestamptz := coalesce(p_now, now());
  d date := (now0 at time zone 'Asia/Seoul')::date;
  b_all  text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(다 냄)' order by updated_at desc limit 1),
                          '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 모두 제출했네요! 꾸준히 달려온 만큼 오늘 {수업시각} 수업이 더 잘 들어올 거예요. 이따 교실에서 만나요!');
  b_part text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(일부 냄)' order by updated_at desc limit 1),
                          '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 중 {제출수}개 제출했어요. 남은 {밀린날짜} 과제까지 수업 전에 마무리하고 오면 오늘 {수업시각} 수업이 훨씬 잘 들어올 거예요. 이따 만나요!');
  b_low  text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(많이 밀림)' order by updated_at desc limit 1),
                          '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개 중 {제출수}개 제출했어요. 오늘 {수업시각} 수업 전까지 {밀린날짜} 과제를 하나씩만이라도 채워 오세요. 수업 시간에 같이 정리해 봐요!');
  b_none text := coalesce((select body from public.sms_templates where btrim(title) = '수업 전 예고(과제 없음)' order by updated_at desc limit 1),
                          '[마라톤국어] {학생이름} 학생, 오늘 {수업시각} 수업 있는 날이에요. 이따 교실에서 만나요!');
  c record; x record; it jsonb;
  miss text; title text; tm text; dn int; tt int; bd text;
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
      bd := case when tt = 0 and miss <> '' then 'part' else public._pre_band(dn, tt) end;
      insert into public.pre_remind_log (day, class_name, student_id, missed, done, total, band)
      values (d, c.name, x.id, bd in ('part', 'low'), dn, tt, bd)
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '수업 전 예고', 'pre', b_all, '자동');
      end if;
      txt := public._pre_text2(case bd when 'all' then b_all when 'part' then b_part when 'low' then b_low else b_none end,
                               x.name, c.name, tm, miss, title, dn, tt);
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
      update public.pre_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name, 'band', bd, 'done', dn, 'total', tt,
                                         'missed', bd in ('part', 'low'));
      nid := null;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.pre_remind_prepare(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.pre_remind_prepare(timestamptz, jsonb) to service_role;


-- ------------------------------------------------------------
--  4. 「오늘」 반 카드 — 구간마다
-- ------------------------------------------------------------
create or replace function public.pre_remind_status(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return coalesce((
    select jsonb_object_agg(k.class_name, jsonb_build_object('at', k.at, 'n', k.n, 'missed', k.missed, 'failed', k.failed,
                                                             'all', k.b_all, 'part', k.b_part, 'low', k.b_low, 'none', k.b_none))
      from (select g.class_name,
                   to_char(min(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI') as at,
                   count(*) filter (where coalesce(g.ok, false)) as n,
                   count(*) filter (where coalesce(g.ok, false) and g.missed) as missed,
                   count(*) filter (where g.ok = false) as failed,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'all') as b_all,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'part') as b_part,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'low') as b_low,
                   count(*) filter (where coalesce(g.ok, false) and g.band = 'none') as b_none
              from public.pre_remind_log g where g.day = d group by g.class_name) k), '{}'::jsonb);
end;
$$;
revoke all on function public.pre_remind_status(date) from public, anon;
grant execute on function public.pre_remind_status(date) to authenticated;


-- ============================================================
--  확인 — 세 줄 true · 아래는 반마다 수업 전 문자 시각 (바꾼 반은 「2시간 → 3시간」)
-- ============================================================
select '수업 전 예고 문구 네 개' as what,
       ((select count(*) from public.sms_templates where btrim(title) in ('수업 전 예고(다 냄)', '수업 전 예고(일부 냄)', '수업 전 예고(많이 밀림)', '수업 전 예고(과제 없음)')) = 4)::text as ok
union all select '기본 3시간 전', ((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'classes' and column_name = 'pre_hours') = '3')::text
union all select '구간 칸', exists (select 1 from information_schema.columns where table_name = 'pre_remind_log' and column_name = 'band')::text
union all (select c.name || ' — ' || case when c.pre_remind then '켜짐 ' || to_char(c.start_time - make_interval(hours => c.pre_hours), 'HH24:MI') || ' (' || c.pre_hours || '시간 전'
                                         || case when m.before is distinct from c.pre_hours then ' · ' || m.before || '시간 → ' || c.pre_hours || '시간' else '' end || ')'
                                         else '꺼짐' end, 'true'
             from public.classes c join _m58 m on m.name = c.name
            where not c.archived and c.start_time is not null order by c.name);
