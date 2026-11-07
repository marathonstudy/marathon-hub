-- ============================================================
--  migration-068-hw-praise.sql — 과제 문자: 독려 + 칭찬을 한 번에 (20261107c)
--  (068 은 067 다음 · 여러 번 실행해도 안전 · 함수 배포 없음 — sms-send · note-remind 는 그대로)
--
--  1. 문구 「과제 칭찬(학생)」 — 그 주 지금까지 나온 과제를 모두 낸 학생에게 (문자 발송 → 자주 쓰는 문구에서 고친다)
--  2. sms_praised_today() — 오늘 이미 칭찬 받은 학생 (직접 보낸 과제 칭찬 · 수업 전 예고의 모두 제출 칭찬) → 칭찬 묶음에서 뺀다
--  3. 사본 — 과제 독려 · 과제 칭찬을 한 통에 「[사본] 반포반 · 사람 발송(김종현) · 독려 19명 / 칭찬 3명」 + 묶음마다 첫 사람 본문
--  4. 수업 전 예고 「모두 제출」 기본 글 — 「한 주 동안 꾸준히 달리느라」 → 「한 주 동안 매일 루틴을 지켜 내느라」
--     원장이 고친 문구는 덮어쓰지 않는다 — 맨 아래 확인 줄에 「고친 문구라 그대로 둠」으로 알린다
-- ============================================================

-- ------------------------------------------------------------
--  1 · 4. 문구
-- ------------------------------------------------------------
do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates where btrim(title) like '과제 독려(%'),
                           coalesce((select max(sort_order) from public.sms_templates), 0) + 1);
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '과제 칭찬(학생)') then
    insert into public.sms_templates (title, body, sort_order, updated_by) values ('과제 칭찬(학생)', '[마라톤국어] {학생이름} 학생, 이번 주 지금까지 나온 과제 {전체수}개를 모두 제출했어요! 매일 루틴을 지켜 내느라 정말 수고했어요. 이 루틴 그대로 이어가 봐요!', nx, 'migration-068');
  end if;
  update public.sms_templates set body = '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개를 모두 제출했어요! 한 주 동안 매일 루틴을 지켜 내느라 정말 수고했어요. {기대문장} {수업시각} 수업에서 만나요!', updated_by = 'migration-068', updated_at = now()
   where btrim(title) = '수업 전 예고(다 냄)' and body = '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개를 모두 제출했어요! 한 주 동안 꾸준히 달리느라 정말 수고했어요. {기대문장} {수업시각} 수업에서 만나요!';
end;
$$;

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
      /* 미제출 · 모두 제출(반이 끄면 off) · 과제 0개(none) — off · none 은 기록만 남기고 안 보낸다 */
      bd := case when tt = 0 then case when miss <> '' then 'miss' else 'none' end
                 when dn >= tt then case when coalesce(c.pre_praise, true) then 'all' else 'off' end
                 else 'miss' end;
      insert into public.pre_remind_log (day, class_name, student_id, missed, done, total, band)
      values (d, c.name, x.id, bd = 'miss', dn, tt, bd)
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if bd not in ('miss', 'all') then nid := null; continue; end if;
      if b is null then
        b := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (b, '수업 전 예고', 'pre', b_miss, '자동');
      end if;
      /* {기대문장} — 공통 한 문장 (비면 빠진다 · 남은 겹친 띄어쓰기는 하나로) */
      txt := public._pre_text2(replace(case bd when 'all' then b_all else b_miss end, '{기대문장}', sent), x.name, c.name, tm, miss, title, dn, tt);
      txt := btrim(regexp_replace(txt, ' {2,}', ' ', 'g'));
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, b, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
      update public.pre_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name, 'band', bd, 'done', dn, 'total', tt,
                                         'missed', bd = 'miss');
      nid := null;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public.pre_remind_prepare(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.pre_remind_prepare(timestamptz, jsonb) to service_role;


-- ------------------------------------------------------------
--  2. 오늘 이미 칭찬 받은 학생 — [{ student_id, at, how: manual · pre }]
-- ------------------------------------------------------------
create or replace function public.sms_praised_today()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('student_id', x.student_id, 'at', x.at, 'how', x.how))
      from (select l.student_id, max(l.created_at) as at, 'manual' as how
              from public.sms_log l join public.sms_batches b on b.id = l.batch_id
             where b.purpose = 'praise' and not l.test and l.status <> 'fail' and l.student_id is not null
               and (l.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
             group by l.student_id
            union all
            select g.student_id, max(g.created_at), 'pre'
              from public.pre_remind_log g
             where g.band = 'all' and g.log_id is not null and g.ok is distinct from false
               and g.day = (now() at time zone 'Asia/Seoul')::date
             group by g.student_id) x), '[]'::jsonb) end;
$$;
revoke all on function public.sms_praised_today() from public, anon;
grant execute on function public.sms_praised_today() to authenticated;


-- ------------------------------------------------------------
--  3. 사본 — 과제 독려 + 과제 칭찬 한 통
-- ------------------------------------------------------------
/* 꼬리 「 · 독려 19명 / 칭찬 3명」 (학생 수) */
create or replace function public._copy_hw(rows jsonb)
returns text language sql stable as $$
  select concat_ws(' / ',
           case when count(distinct e ->> 'student_id') filter (where e ->> 'p' = 'nudge') > 0 then '독려 ' || count(distinct e ->> 'student_id') filter (where e ->> 'p' = 'nudge') || '명' end,
           case when count(distinct e ->> 'student_id') filter (where e ->> 'p' = 'praise') > 0 then '칭찬 ' || count(distinct e ->> 'student_id') filter (where e ->> 'p' = 'praise') || '명' end)
    from jsonb_array_elements(rows) e;
$$;
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
              case when coalesce(p_label, '') <> '' then ' · ' || p_label else '' end end end;
$$;

/* 매분 — 067 과 같고 과제 독려 · 칭찬을 한 묶음으로 (label 「과제 문자」) */
create or replace function public.copy_due(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph text := public._copy_phone();
  dg boolean := public._copy_digest();
  nw timestamptz := coalesce(p_now, now());
  kst timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  out jsonb := '[]'::jsonb;
  g record; cid uuid; ids uuid[]; txt text; line text; body text; firstn text; fails int; vary boolean; lesson text; r0 jsonb;
  pre text;
  dl text[] := '{}'; dn int := 0; dfail int := 0; dids uuid[] := '{}'; last_d text;
begin
  /* 시험 발송 줄은 사본 없음 · 오래 남은 글은 지운다 */
  update public.sms_log set copy_state = 'test' where copy_state = 'wait' and test;
  update public.kakao_log set copy_state = 'test' where copy_state = 'wait' and test;
  delete from public.msg_copy_text where at < nw - interval '3 days';
  /* 번호가 비어 있으면 사본을 보내지 않는다 (나중에 넣어도 밀린 것을 한꺼번에 보내지 않는다) */
  if ph is null then
    update public.sms_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    update public.kakao_log set copy_state = 'none' where copy_state = 'wait' and (status <> 'pending' or created_at < nw - interval '15 minutes');
    delete from public.msg_copy_text t where not exists (select 1 from public.sms_log l where l.id = t.log_id and l.copy_state = 'wait');
    return jsonb_build_object('to', '', 'messages', '[]'::jsonb);
  end if;
  for g in
    with r as (
      select 's' src, l.id, l.created_at at, l.status, l.name, l.class_name cls, l.target, l.body_head, l.created_by by_email,
             case when b.purpose in ('nudge', 'praise') then '과제 문자' else coalesce(b.label, '') end label,
             case when b.purpose in ('nudge', 'praise') then 'hw' else coalesce(b.purpose, '') end purpose, coalesce(b.purpose, '') p0, coalesce(b.created_by, '') = '자동' auto, null::date week, l.student_id
        from public.sms_log l left join public.sms_batches b on b.id = l.batch_id where l.copy_state = 'wait'
      union all
      select 'k', k.id, k.created_at, k.status, s.name, s.class_name, 'parent', '', k.created_by,
             '레포트 알림톡', 'report', 'report', false, k.week_start, k.student_id
        from public.kakao_log k left join public.students s on s.id = k.student_id where k.copy_state = 'wait'
    )
    select r.src, r.auto, r.label, r.by_email, min(r.at) first_at, max(r.at) last_at,
           count(*) filter (where r.status = 'pending' and r.at >= nw - interval '15 minutes') busy,
           jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'status', r.status, 'name', r.name, 'cls', r.cls, 'target', r.target,
                                        'body_head', r.body_head, 'week', r.week, 'student_id', r.student_id, 'p', r.p0) order by r.at, r.name) as rows
      from r
     group by r.src, r.auto, r.label, r.by_email, r.purpose, case when r.auto then r.cls else '' end,
              case when r.auto then case when r.target = 'staff' then 'staff' else 'x' end else '' end
     order by min(r.at)
  loop
    if g.busy > 0 then continue; end if;
    if not (g.auto and dg) and g.last_at > nw - interval '1 minute' and g.first_at > nw - interval '5 minutes' then continue; end if;
    select array_agg((e ->> 'id')::uuid), count(*) filter (where e ->> 'status' <> 'ok') into ids, fails from jsonb_array_elements(g.rows) e;
    line := public._copy_line(g.rows, g.auto, g.label, g.by_email);
    /* 저녁 9시에 모아 받기 */
    if g.auto and dg then
      dl := dl || ('· ' || to_char((g.first_at at time zone 'Asia/Seoul'), 'HH24:MI') || ' ' || line || case when fails > 0 then ' · ' || fails || '명 실패' else '' end);
      dn := dn + jsonb_array_length(g.rows); dfail := dfail + fails; dids := dids || ids;
      continue;
    end if;
    /* 첫 사람 글 */
    select t.body into body from public.msg_copy_text t where t.log_id = any(ids) and t.body <> '' order by t.at limit 1;
    select e into r0 from jsonb_array_elements(g.rows) e
      left join public.msg_copy_text t on t.log_id = (e ->> 'id')::uuid and t.body <> '' order by (t.log_id is null), e ->> 'at' limit 1;
    firstn := r0 ->> 'name';
    if g.src = 'k' then
      select public._kdate(case when coalesce(p.report_data ->> 'lessonDate', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p.report_data ->> 'lessonDate', 10)::date else p.week_start end)
        into lesson from public.published p where p.student_id = (r0 ->> 'student_id')::uuid and p.week_start = (r0 ->> 'week')::date;
      body := '[마라톤국어] ' || coalesce(firstn, '') || E' 학생 주간 레포트\n\n' || coalesce(firstn, '') || ' 학생의 ' || coalesce(lesson, '') || E' 수업 레포트가 올라왔습니다.\n아래 버튼을 눌러 확인해 주세요.\n(알림톡 · [레포트 보기] 버튼)';
    elsif body is null then
      body := public._copy_clean(r0 ->> 'body_head') || '…(앞부분)';
    end if;
    /* 수업 전 예고 — 미제출 · 모두 제출 첫 사람 글을 하나씩 (067) */
    pre := null;
    if g.auto then
      select string_agg(x.t, E'\n\n' order by x.o) into pre from (
        select distinct on (case when p.band = 'all' then 2 else 1 end) case when p.band = 'all' then 2 else 1 end o,
               '[' || case when p.band = 'all' then '모두 제출' else '미제출' end || '] ' || coalesce(l.name, '') || E'\n' || t.body t
          from public.msg_copy_text t join public.pre_remind_log p on p.log_id = t.log_id join public.sms_log l on l.id = t.log_id
         where t.log_id = any(ids) and t.body <> ''
         order by case when p.band = 'all' then 2 else 1 end, t.at, l.name) x;
      if pre is not null then body := pre; firstn := ''; end if;
    end if;
    /* 과제 문자 — 독려 · 칭찬 첫 사람 글을 하나씩 (068) */
    if not g.auto and g.label = '과제 문자' then
      select string_agg(x.t, E'\n\n' order by x.o) into pre from (
        select distinct on (case when b.purpose = 'praise' then 2 else 1 end) case when b.purpose = 'praise' then 2 else 1 end o,
               '[' || case when b.purpose = 'praise' then '칭찬' else '독려' end || '] ' || coalesce(l.name, '') || E'\n' || t.body t
          from public.msg_copy_text t join public.sms_log l on l.id = t.log_id join public.sms_batches b on b.id = l.batch_id
         where t.log_id = any(ids) and t.body <> ''
         order by case when b.purpose = 'praise' then 2 else 1 end, t.at, l.name) x;
      if pre is not null then body := pre; firstn := ''; end if;
    end if;
    select count(distinct t.norm) > 1 into vary from public.msg_copy_text t where t.log_id = any(ids);
    txt := '[사본] ' || line ||
           case when fails > 0 then E'\n' || fails || '명 실패' else '' end ||
           case when coalesce(vary, false) then E'\n사람마다 숫자 다름' else '' end ||
           case when jsonb_array_length(g.rows) > 1 and coalesce(firstn, '') <> '' then E'\n첫 사람: ' || firstn else '' end ||
           E'\n\n' || body;
    txt := public._copy_cut(public._copy_clean(txt));
    insert into public.msg_copy_log (head, n, failed) values (left(line, 200), jsonb_array_length(g.rows), fails) returning id into cid;
    update public.sms_log set copy_state = 'sending', copy_id = cid where id = any(ids);
    update public.kakao_log set copy_state = 'sending', copy_id = cid where id = any(ids);
    out := out || jsonb_build_object('id', cid, 'text', txt, 'kind', case when g.src = 'k' or public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end);
  end loop;
  /* 모아 받기 — 저녁 9시부터 그날 한 번 */
  if dg and dn > 0 and kst::time >= time '21:00' then
    select value ->> 'lastDigest' into last_d from public.app_settings where key = 'sms_copy';
    if coalesce(last_d, '') < to_char(kst, 'YYYY-MM-DD') then
      txt := public._copy_cut(public._copy_clean('[사본] 자동 발송 모음 · ' || to_char(kst, 'FMMM/FMDD') || ' · ' || dn || '건' ||
             case when dfail > 0 then E'\n' || dfail || '명 실패' else '' end || E'\n\n' || array_to_string(dl, E'\n')));
      insert into public.msg_copy_log (head, n, failed, digest) values ('자동 발송 모음', dn, dfail, true) returning id into cid;
      update public.sms_log set copy_state = 'sending', copy_id = cid where id = any(dids);
      update public.kakao_log set copy_state = 'sending', copy_id = cid where id = any(dids);
      update public.app_settings set value = value || jsonb_build_object('lastDigest', to_char(kst, 'YYYY-MM-DD')) where key = 'sms_copy';
      out := out || jsonb_build_object('id', cid, 'text', txt, 'kind', 'LMS');
    end if;
  end if;
  return jsonb_build_object('to', ph, 'messages', out);
end;
$$;


-- ============================================================
--  확인 — 위 두 줄 true · 「고친 문구라 그대로 둠」 줄이 있으면 그 문구는 원장이 고친 글 그대로
-- ============================================================
select '과제 칭찬(학생) 문구' as what, exists (select 1 from public.sms_templates where btrim(title) = '과제 칭찬(학생)')::text as ok
union all select '오늘 칭찬 받은 학생 함수', exists (select 1 from pg_proc where proname = 'sms_praised_today')::text
union all (select '고친 문구라 그대로 둠: ' || title || ' (「한 주 동안 매일 루틴을 지켜 내느라」로 바꾸지 않음)', 'true'
             from public.sms_templates where btrim(title) = '수업 전 예고(다 냄)' and body <> '[마라톤국어] {학생이름} 학생, 이번 주 과제 {전체수}개를 모두 제출했어요! 한 주 동안 매일 루틴을 지켜 내느라 정말 수고했어요. {기대문장} {수업시각} 수업에서 만나요!');
