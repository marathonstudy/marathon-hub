-- ============================================================
--  migration-073-report-update.sql — 보낸 레포트가 바뀌면 업데이트 문자 (20261108e)
--  (073 은 072 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  대상 — 이미 보낸 레포트만 (sent 에 그 주 · 그 학생 줄이 있을 때). 아직 안 보낸 레포트를 고치는 것은 알리지 않는다.
--  무엇이 바뀌면 — 저장되는 곳마다 표가 바뀔 때 기록(report_upd_ev)을 남긴다 (트리거)
--    수업 영상   lesson_videos (반 · 주 · 보강이면 그 학생들만) — 다시 공개 없이 바로 보임
--    수업 자료   class_files (반 · 주) — 다시 공개 없이 바로 보임
--    반 공지     class_notices (반 · 주 · 보이는 공지)
--    선생님 코멘트 · 수업 내용 · 복습 테스트 결과 — 다시 공개(published.report_data)할 때. 반 공통 코멘트 · 학생별 코멘트 모두
--      레포트 코멘트 칸이라 학생마다 그 학생 레포트만 본다 (학생별 코멘트는 그 학생에게만)
--  모아 보내기 — 그 레포트가 마지막으로 바뀐 뒤 30분 동안 더 바뀌지 않으면 그동안 바뀐 것을 모아 한 통 (note-remind 매분)
--    밤 10시 ~ 아침 8시에 걸리면 아침 8시 · 같은 레포트는 하루 두 번까지 (넘으면 다음 날 아침 8시)
--  항목 — 「· 수업 영상」 「· 수업 자료 2개」 「· 선생님 코멘트」 「· 수업 내용」 「· 복습 테스트 결과」 「· 반 공지」
--    10글자 미만 문구 변경은 뺀다 (오타 수정) · 넣었다가 지운 것도 뺀다 (처음 상태와 견준다) · 항목이 없으면 보내지 않는다
--    상담 내용 · 성적 · 금액은 넣지 않는다 (항목 이름만)
--  받는 사람 — 그 레포트를 받은 사람과 같게 (보낸 기록 sms_log.mark_week · kakao_log). 학생은 문자.
--    학부모는 알림톡 템플릿에 이 글이 없어 기본으로 보내지 않는다 · 설정 「학부모에게도 업데이트 문자 보내기」를 켜면 일반 문자
--  문구 — 문구 관리 「레포트 업데이트」 {이름} {날짜} {바뀐 항목 목록} {링크}
--  끄기 — 반마다 「업데이트 문자 자동 발송」 (classes.upd_auto · 기본 켜짐) · 화면의 [이번엔 안 보내기] · [지금 보내기]
--  사본 — 「[사본] 목동반 학생 10명 · 자동(레포트 업데이트) · 수업 영상, 수업 자료 1개」 한 통 (copy_due · 반마다)
-- ============================================================

alter table public.classes add column if not exists upd_auto boolean not null default true;

insert into public.app_settings (key, value) values ('report_upd', jsonb_build_object('parents', false))
on conflict (key) do nothing;

do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0) + 1;
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '레포트 업데이트') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('레포트 업데이트', E'[마라톤국어] {이름} 학생, {날짜} 수업 레포트에 새 내용이 올라왔어요.\n{바뀐 항목 목록}\n아래 링크에서 확인해 보세요.\n{링크}', nx, 'migration-073');
  end if;
end;
$$;


-- ------------------------------------------------------------
--  1. 기록
-- ------------------------------------------------------------
create table if not exists public.report_upd_ev (
  id          bigserial primary key,
  week_start  date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  class_name  text not null default '',
  kind        text not null,                      -- video · file · notice · report
  ref         text not null default '',           -- 영상 · 파일 · 공지 id
  op          text not null default 'add',        -- add · del · chg
  size        integer not null default 0,         -- 바뀐 글자 수 (공지)
  at          timestamptz not null default now(),
  state       text not null default 'wait',       -- wait · sent · skip · none · off
  force       boolean not null default false,
  done_at     timestamptz,
  constraint report_upd_ev_kind check (kind in ('video', 'file', 'notice', 'report')),
  constraint report_upd_ev_state check (state in ('wait', 'sent', 'skip', 'none', 'off'))
);
create index if not exists report_upd_ev_wait on public.report_upd_ev (week_start, student_id) where state = 'wait';
alter table public.report_upd_ev enable row level security;
drop policy if exists report_upd_ev_read on public.report_upd_ev;
create policy report_upd_ev_read on public.report_upd_ev for select to authenticated using (public.is_staff());

/* 다시 공개 전 레포트 — 처음 바뀌기 전 상태 (넣었다 지운 것 · 작은 수정을 빼려고 처음과 견준다) */
create table if not exists public.report_upd_base (
  week_start  date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now(),
  primary key (week_start, student_id)
);
alter table public.report_upd_base enable row level security;
revoke all on public.report_upd_base from anon, authenticated;

/* 보낸 업데이트 문자 — 하루 두 번 · 사본 항목 */
create table if not exists public.report_upd_log (
  id          bigserial primary key,
  day         date not null,
  week_start  date not null,
  student_id  uuid references public.students(id) on delete set null,
  log_id      uuid,
  items       text[] not null default '{}',
  manual      boolean not null default false,
  at          timestamptz not null default now()
);
create index if not exists report_upd_log_day on public.report_upd_log (day, week_start, student_id);
alter table public.report_upd_log enable row level security;
drop policy if exists report_upd_log_read on public.report_upd_log;
create policy report_upd_log_read on public.report_upd_log for select to authenticated using (public.is_staff());


-- ------------------------------------------------------------
--  2. 도우미
-- ------------------------------------------------------------
/* 바뀐 글자 수 — 앞 · 뒤 같은 부분을 뺀 가운데 길이 (오타 한 글자는 1) */
create or replace function public._upd_size(a text, b text)
returns integer language plpgsql immutable as $$
declare x text := coalesce(a, ''); y text := coalesce(b, ''); p int := 0; s int := 0; lx int; ly int;
begin
  if x = y then return 0; end if;
  lx := char_length(x); ly := char_length(y);
  while p < lx and p < ly and substr(x, p + 1, 1) = substr(y, p + 1, 1) loop p := p + 1; end loop;
  while s < lx - p and s < ly - p and substr(x, lx - s, 1) = substr(y, ly - s, 1) loop s := s + 1; end loop;
  return greatest(lx, ly) - p - s;
end;
$$;

/* 이 레포트를 보냈나 */
create or replace function public._upd_sent(p_week date, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sent where week_start = p_week and student_id = p_student);
$$;

/* 반 · 주의 보낸 학생에게 기록 (보강 영상이면 그 학생들만) */
create or replace function public._upd_fan(p_class text, p_week date, p_kind text, p_ref text, p_op text, p_size integer, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.report_upd_ev (week_start, student_id, class_name, kind, ref, op, size)
  select p_week, s.id, s.class_name, p_kind, coalesce(p_ref, ''), p_op, coalesce(p_size, 0)
    from public.students s join public.sent t on t.student_id = s.id and t.week_start = p_week
   where s.class_name = p_class and not s.archived
     and (cardinality(coalesce(p_ids, '{}')) = 0 or s.id = any(p_ids));
end;
$$;
revoke all on function public._upd_fan(text, date, text, text, text, integer, uuid[]) from public, anon, authenticated;


-- ------------------------------------------------------------
--  3. 트리거 — 저장되는 곳마다
-- ------------------------------------------------------------
create or replace function public._upd_trg_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform public._upd_fan(old.class_name, old.week_start, 'video', old.id::text, 'del', 0, old.student_ids);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public._upd_fan(new.class_name, new.week_start, 'video', new.id::text || case when tg_op = 'UPDATE' then ':' || md5(new.url) else '' end, 'add', 0, new.student_ids);
  end if;
  return null;
exception when others then return null;          /* 알림 기록이 실패해도 영상 저장은 그대로 */
end;
$$;
drop trigger if exists lesson_videos_upd on public.lesson_videos;
create trigger lesson_videos_upd after insert or delete or update of url, class_name, week_start, student_ids on public.lesson_videos
  for each row execute function public._upd_trg_video();

create or replace function public._upd_trg_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public._upd_fan(old.class_name, old.week_start, 'file', old.id::text, 'del', 0, '{}'); end if;
  if tg_op = 'INSERT' then perform public._upd_fan(new.class_name, new.week_start, 'file', new.id::text, 'add', 0, '{}'); end if;
  return null;
exception when others then return null;
end;
$$;
drop trigger if exists class_files_upd on public.class_files;
create trigger class_files_upd after insert or delete on public.class_files
  for each row execute function public._upd_trg_file();

create or replace function public._upd_notice_text(n public.class_notices)
returns text language sql immutable as $$
  select concat_ws(E'\n', n.title, n.curriculum, n.literature, n.reading, n.homework, n.notes, n.special);
$$;
create or replace function public._upd_trg_notice()
returns trigger language plpgsql security definer set search_path = public as $$
declare sz int;
begin
  if tg_op = 'INSERT' then
    if new.visible then perform public._upd_fan(new.class_name, new.week_start, 'notice', new.id::text, 'add', char_length(public._upd_notice_text(new)), '{}'); end if;
  elsif tg_op = 'UPDATE' then
    sz := public._upd_size(case when old.visible then public._upd_notice_text(old) else '' end, case when new.visible then public._upd_notice_text(new) else '' end);
    if sz > 0 then perform public._upd_fan(new.class_name, new.week_start, 'notice', new.id::text, 'chg', sz, '{}'); end if;
  end if;
  return null;
exception when others then return null;
end;
$$;
drop trigger if exists class_notices_upd on public.class_notices;
create trigger class_notices_upd after insert or update on public.class_notices
  for each row execute function public._upd_trg_notice();

/* 다시 공개 — 처음 상태를 한 번 남기고 「바뀜」 기록 */
create or replace function public._upd_trg_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.report_data - '_upd') is not distinct from (new.report_data - '_upd') then return null; end if;
  if not public._upd_sent(new.week_start, new.student_id) then return null; end if;
  insert into public.report_upd_base (week_start, student_id, data) values (new.week_start, new.student_id, old.report_data)
    on conflict (week_start, student_id) do nothing;
  insert into public.report_upd_ev (week_start, student_id, class_name, kind, op)
  select new.week_start, new.student_id, coalesce(s.class_name, ''), 'report', 'chg' from public.students s where s.id = new.student_id;
  return null;
exception when others then return null;
end;
$$;
drop trigger if exists published_upd on public.published;
create trigger published_upd after update of report_data on public.published
  for each row execute function public._upd_trg_report();


-- ------------------------------------------------------------
--  4. 항목 — 레포트 하나 (기다리는 기록 · 처음 상태 · 지금 레포트)
-- ------------------------------------------------------------
create or replace function public._upd_items(p_week date, p_student uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  out text[] := '{}';
  nv int; nf int; nn int;
  b jsonb; c jsonb;
  ot jsonb; nt jsonb;
begin
  /* 영상 · 자료 — 넣은 것 중 지우지 않은 것만 (기다리는 기록 안에서) */
  select count(*) into nv from (
    select ref from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'video'
     group by ref having bool_or(op = 'add') and not bool_or(op = 'del' and id > (select max(e2.id) from public.report_upd_ev e2
                                                                                  where e2.week_start = p_week and e2.student_id = p_student and e2.state = 'wait' and e2.kind = 'video' and e2.ref = report_upd_ev.ref and e2.op = 'add'))) x;
  if nv > 0 then out := array_append(out, '수업 영상'); end if;
  select count(*) into nf from (
    select ref from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'file'
     group by ref having bool_or(op = 'add') and not bool_or(op = 'del')) x;
  if nf > 0 then out := array_append(out, ('수업 자료 ' || nf || '개')); end if;
  /* 다시 공개 — 처음 상태와 지금 견주기 */
  if exists (select 1 from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'report') then
    select data into b from public.report_upd_base where week_start = p_week and student_id = p_student;
    select report_data into c from public.published where week_start = p_week and student_id = p_student and visible;
    if b is not null and c is not null then
      if public._upd_size(b ->> 'comment', c ->> 'comment') >= 10 then out := array_append(out, '선생님 코멘트'); end if;
      if public._upd_size(coalesce((select string_agg(x, E'\n') from jsonb_array_elements_text(coalesce(b -> 'lessons', '[]')) x), ''),
                          coalesce((select string_agg(x, E'\n') from jsonb_array_elements_text(coalesce(c -> 'lessons', '[]')) x), '')) >= 10 then
        out := array_append(out, '수업 내용');
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('n', t ->> 'name', 's', t -> 'score', 'a', t -> 'absent') order by t ->> 'name'), '[]') into ot
        from jsonb_array_elements(coalesce(b -> 'tests', '[]')) t where t ->> 'score' is not null;
      select coalesce(jsonb_agg(jsonb_build_object('n', t ->> 'name', 's', t -> 'score', 'a', t -> 'absent') order by t ->> 'name'), '[]') into nt
        from jsonb_array_elements(coalesce(c -> 'tests', '[]')) t where t ->> 'score' is not null;
      if ot is distinct from nt and jsonb_array_length(nt) > 0 then out := array_append(out, '복습 테스트 결과'); end if;
    end if;
  end if;
  /* 반 공지 — 바뀐 글자 합 10 이상 */
  select coalesce(sum(size), 0) into nn from public.report_upd_ev where week_start = p_week and student_id = p_student and state = 'wait' and kind = 'notice';
  if nn >= 10 then out := array_append(out, '반 공지'); end if;
  return out;
end;
$$;
revoke all on function public._upd_items(date, uuid) from public, anon, authenticated;

/* 보낼 때 — 마지막으로 바뀐 뒤 30분 · 밤 10시 ~ 아침 8시는 8시 · 하루 두 번 넘으면 다음 날 8시 (KST) */
create or replace function public._upd_due(p_last timestamptz, p_week date, p_student uuid, p_force boolean)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  d timestamptz := case when p_force then now() - interval '1 second' else p_last + interval '30 minutes' end;
  k timestamp;
  i int := 0;
begin
  loop
    i := i + 1; exit when i > 5;
    k := d at time zone 'Asia/Seoul';
    if k::time >= time '22:00' then d := ((k::date + 1) + time '08:00') at time zone 'Asia/Seoul'; continue; end if;
    if k::time < time '08:00' then d := (k::date + time '08:00') at time zone 'Asia/Seoul'; continue; end if;
    if (select count(distinct l.at) from public.report_upd_log l where l.day = k::date and l.week_start = p_week and l.student_id = p_student) >= 2 then
      d := ((k::date + 1) + time '08:00') at time zone 'Asia/Seoul'; continue;
    end if;
    exit;
  end loop;
  return d;
end;
$$;
revoke all on function public._upd_due(timestamptz, date, uuid, boolean) from public, anon, authenticated;

/* 받는 사람 — 그 레포트를 받은 쪽 (학생 · 학부모 1 · 2) */
create or replace function public._upd_targets(p_week date, p_student uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select l.target t from public.sms_log l where l.student_id = p_student and l.mark_week = p_week and l.status = 'ok' and not l.test and l.target in ('student', 'parent1', 'parent2')
    union all
    select case when k.target = 'student' then 'student' else 'parent' end from public.kakao_log k
     where k.student_id = p_student and k.week_start = p_week and not k.test and k.status = 'ok'
    union all
    /* 학생 대체 문자 (알림톡 실패 → 문자로 대신 · 071) */
    select 'student' from public.sms_log l join public.sms_batches b on b.id = l.batch_id
     where l.student_id = p_student and l.status = 'ok' and not l.test and l.target = 'student' and b.label = '대체 문자'
       and exists (select 1 from public.kakao_log k where k.student_id = p_student and k.week_start = p_week and k.target = 'student')
  ) x;
$$;
revoke all on function public._upd_targets(date, uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
--  5. 보내기 (note-remind 매분 · 「지금 보내기」) — service_role
-- ------------------------------------------------------------
create or replace function public.report_upd_prepare(p_now timestamptz, p_site text default '', p_week date default null, p_class text default null, p_by text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nw timestamptz := coalesce(p_now, now());
  kday date := (coalesce(p_now, now()) at time zone 'Asia/Seoul')::date;
  manual boolean := p_week is not null;
  site text := coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub');
  par boolean := coalesce((select (value ->> 'parents')::boolean from public.app_settings where key = 'report_upd'), false);
  tbody text := coalesce((select body from public.sms_templates where btrim(title) = '레포트 업데이트' order by updated_at desc limit 1),
                         E'[마라톤국어] {이름} 학생, {날짜} 수업 레포트에 새 내용이 올라왔어요.\n{바뀐 항목 목록}\n아래 링크에서 확인해 보세요.\n{링크}');
  g record; st record; items text[]; tg text[]; ph text; code text; txt text; lid uuid; bt uuid; bts jsonb := '{}'::jsonb;
  rows jsonb := '[]'::jsonb; done int := 0; who text; lesson text; t text;
begin
  for g in
    select e.week_start, e.student_id, max(e.at) last_at, bool_or(e.force) force, min(e.class_name) cls
      from public.report_upd_ev e
     where e.state = 'wait' and (not manual or (e.week_start = p_week and e.class_name = btrim(coalesce(p_class, ''))))
     group by e.week_start, e.student_id
  loop
    select s.id, s.name, s.class_name, s.student_phone, s.parent_phone, s.parent_phone2, coalesce(l.student_code, '') sc, coalesce(l.hub_code, '') hc,
           coalesce(c.upd_auto, true) auto, s.archived
      into st from public.students s left join public.student_links l on l.student_id = s.id left join public.classes c on c.name = s.class_name
     where s.id = g.student_id;
    if not found or st.archived then
      update public.report_upd_ev set state = 'none', done_at = nw where week_start = g.week_start and student_id = g.student_id and state = 'wait';
      continue;
    end if;
    if not manual then
      if not st.auto then
        update public.report_upd_ev set state = 'off', done_at = nw where week_start = g.week_start and student_id = g.student_id and state = 'wait';
        delete from public.report_upd_base where week_start = g.week_start and student_id = g.student_id;
        continue;
      end if;
      if public._upd_due(g.last_at, g.week_start, g.student_id, g.force) > nw then continue; end if;
    end if;
    items := public._upd_items(g.week_start, g.student_id);
    if cardinality(items) = 0 then
      update public.report_upd_ev set state = 'none', done_at = nw where week_start = g.week_start and student_id = g.student_id and state = 'wait';
      delete from public.report_upd_base where week_start = g.week_start and student_id = g.student_id;
      continue;
    end if;
    select public._kdate(case when coalesce(p.report_data ->> 'lessonDate', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p.report_data ->> 'lessonDate', 10)::date else p.week_start end)
      into lesson from public.published p where p.week_start = g.week_start and p.student_id = g.student_id;
    tg := public._upd_targets(g.week_start, g.student_id);
    if cardinality(tg) = 0 then tg := array['student']; end if;           /* 직접 복사 · 공유로 보낸 레포트 — 학생 본인 */
    for t in select x from unnest(array['student', 'parent1', 'parent2']) x loop
      if t = 'student' and not ('student' = any(tg)) then continue; end if;
      if t <> 'student' and (not par or not (t = any(tg) or 'parent' = any(tg))) then continue; end if;
      ph := case t when 'student' then st.student_phone when 'parent1' then st.parent_phone else st.parent_phone2 end;
      code := case when t = 'student' then st.sc else st.hc end;
      if not public._phone_ok(ph) or code = '' then continue; end if;
      if t = 'parent2' and regexp_replace(coalesce(st.parent_phone2, ''), '\D', '', 'g') = regexp_replace(coalesce(st.parent_phone, ''), '\D', '', 'g') then continue; end if;
      if t <> 'student' and regexp_replace(ph, '\D', '', 'g') = regexp_replace(coalesce(st.student_phone, ''), '\D', '', 'g') and 'student' = any(tg) then continue; end if;
      txt := replace(replace(replace(replace(tbody, '{이름}', st.name), '{날짜}', coalesce(lesson, '')),
                     '{바뀐 항목 목록}', (select string_agg('· ' || x, E'\n') from unnest(items) x)), '{링크}', site || '/me/#' || code);
      bt := nullif(bts ->> st.class_name, '')::uuid;
      if bt is null then
        bt := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (bt, '레포트 업데이트', 'rupd', tbody, case when manual then coalesce(nullif(p_by, ''), '사람') else '자동' end);
        bts := bts || jsonb_build_object(st.class_name, bt::text);
      end if;
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, bt, st.id, t, st.name, st.class_name, right(regexp_replace(ph, '\D', '', 'g'), 4),
              case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), case when manual then coalesce(nullif(p_by, ''), '사람') else '자동' end);
      insert into public.report_upd_log (day, week_start, student_id, log_id, items, manual) values (kday, g.week_start, st.id, lid, items, manual);
      rows := rows || jsonb_build_object('log_id', lid, 'to', regexp_replace(ph, '\D', '', 'g'), 'text', txt,
                                         'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, 'name', st.name, 'class', st.class_name, 'who', t);
    end loop;
    update public.report_upd_ev set state = 'sent', done_at = nw where week_start = g.week_start and student_id = g.student_id and state = 'wait';
    delete from public.report_upd_base where week_start = g.week_start and student_id = g.student_id;
    done := done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'reports', done, 'rows', rows);
end;
$$;
revoke all on function public.report_upd_prepare(timestamptz, text, date, text, text) from public, anon, authenticated;
grant execute on function public.report_upd_prepare(timestamptz, text, date, text, text) to service_role;


-- ------------------------------------------------------------
--  6. 화면 — 기다리는 업데이트 · 이번엔 안 보내기 · 설정
-- ------------------------------------------------------------
/* 「목동반 11/7 레포트 · 학생 10명 · 수업 영상 — 14:35 에 업데이트 문자가 나가요」 */
create or replace function public.report_upd_pending()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 볼 수 있습니다.'; end if;
  return jsonb_build_object('ok', true,
    'parents', coalesce((select (value ->> 'parents')::boolean from public.app_settings where key = 'report_upd'), false),
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

/* 이번엔 안 보내기 — 그 반 그 주 기다리는 것 모두 */
create or replace function public.report_upd_skip(p_week date, p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.report_upd_ev set state = 'skip', done_at = now() where state = 'wait' and week_start = p_week and class_name = btrim(coalesce(p_class, ''));
  get diagnostics n = row_count;
  delete from public.report_upd_base b where b.week_start = p_week
     and b.student_id in (select id from public.students where class_name = btrim(coalesce(p_class, '')));
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;

/* 반마다 「업데이트 문자 자동 발송」 */
create or replace function public.class_upd_set(p_class text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  update public.classes set upd_auto = coalesce(p_on, true) where name = btrim(coalesce(p_class, ''));
  if not found then raise exception '그 반을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true));
end;
$$;

/* 「학부모에게도 업데이트 문자 보내기」 (기본 끔) */
create or replace function public.report_upd_parents_set(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  insert into public.app_settings (key, value) values ('report_upd', jsonb_build_object('parents', coalesce(p_on, false)))
  on conflict (key) do update set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('parents', coalesce(p_on, false));
  return jsonb_build_object('ok', true, 'parents', coalesce(p_on, false));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.report_upd_pending()', 'public.report_upd_skip(date, text)', 'public.class_upd_set(text, boolean)', 'public.report_upd_parents_set(boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ------------------------------------------------------------
--  7. 사본 — 「[사본] 목동반 학생 10명 · 자동(레포트 업데이트) · 수업 영상, 수업 자료 1개」
--     copy_due 는 071 그대로 두고, 한 줄에 항목을 붙이는 _copy_line 만 바꾼다
-- ------------------------------------------------------------
create or replace function public._copy_upd_items(rows jsonb)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(i, ', ' order by o) from (
    select i, min(case when i = '수업 영상' then 1 when i like '수업 자료%' then 2 when i = '선생님 코멘트' then 3 when i = '수업 내용' then 4 when i = '복습 테스트 결과' then 5 else 6 end * 1000 + ord) o
      from public.report_upd_log l, unnest(l.items) with ordinality u(i, ord)
     where l.log_id in (select (e ->> 'id')::uuid from jsonb_array_elements(rows) e)
     group by i) x;
$$;
/* 068 과 같고 「레포트 업데이트」면 끝에 항목 */
create or replace function public._copy_line(rows jsonb, p_auto boolean, p_label text, p_by text)
returns text language sql stable set search_path = public as $$
  select case when not p_auto and p_label = '과제 문자' then
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
select '트리거 넷 (영상 · 자료 · 공지 · 다시 공개)' as what,
       ((select count(*) from pg_trigger where tgname in ('lesson_videos_upd', 'class_files_upd', 'class_notices_upd', 'published_upd')) = 4)::text as ok
union all select '반마다 자동 발송 칸', exists (select 1 from information_schema.columns where table_name = 'classes' and column_name = 'upd_auto')::text
union all select '문구 「레포트 업데이트」', exists (select 1 from public.sms_templates where btrim(title) = '레포트 업데이트')::text
union all select '학부모에게도 보내기 — ' || case when coalesce((select (value ->> 'parents')::boolean from public.app_settings where key = 'report_upd'), false) then '켜짐' else '꺼짐(기본)' end, 'true';
