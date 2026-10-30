-- ============================================================
--  마라톤 코치룸 — 지금 반 세 개 수업 시각 · 종강일 · 필기 문자 / 필기 QR 정리 (migration-053-class-times.sql · 20261101f)
--
--  실행 방법
--    052 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 레포트 · 사진 · 보낸 기록은 바꾸지 않는다. 함수 배포는 필요 없다.
--
--  1. 지금 반 세 개 — 049 는 이름(「고3 목동」 · 「고3 반포」)이 맞지 않아 못 넣었다.
--     DB 의 실제 반 이름으로 찾는다 (띄어쓰기 · 끝의 「반」 무시 · 보관 안 한 반 · 딱 한 반일 때만)
--       고2 선수능반(목) 18:30~22:00 · 종강 11/5 · 목동반(토) 18:30~22:00 · 종강 11/14 · 반포반(일) 09:30~13:00 · 종강 11/15
--     세 반 모두 필기 문자 켜기 · 끝나기 5분 전. 수업 요일이 비어 있으면 위 요일로 (이미 있으면 그대로)
--     못 찾으면 맨 아래 결과에 「못 찾음」 · 여러 반이면 「여러 반 — 이름」
--  2. 필기 QR 화면을 없앴다 — 운영진 필기 알림 문자에서 「QR 띄우기: #{QR 링크}」를 뺀다 (문구를 고쳤어도 그 부분만)
--     _note_prepare 는 049 와 같고 기본 문구에서 QR 링크만 뺐다
-- ============================================================

create or replace function public._note_prepare(p_now timestamptz, p_class text, p_manual boolean, p_site text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (p_now at time zone 'Asia/Seoul')::date;
  t time := (p_now at time zone 'Asia/Seoul')::time;
  c record;
  x record;
  sbody text := coalesce((select body from public.sms_templates where title = '필기 알림(학생)' order by updated_at desc limit 1), '[마라톤국어] 수업 끝나기 전에 오늘 필기 사진 올려 주세요: #{링크}');
  tbody text := coalesce((select body from public.sms_templates where title = '필기 알림(운영진)' order by updated_at desc limit 1), '[필기 알림] #{반} 수업 #{분}분 전입니다. 필기 사진 제출 안내해 주세요.');
  rows jsonb := '[]'::jsonb;
  bs uuid; bt uuid;
  txt text; lid uuid; nid bigint;
  site text := rtrim(coalesce(nullif(btrim(p_site), ''), 'https://marathonstudy.github.io/marathon-hub'), '/');
  qr text;
begin
  for c in
    select * from public.classes k
     where not k.archived and k.end_time is not null and (k.end_on is null or k.end_on >= d)
       and (case when p_manual then k.name = btrim(coalesce(p_class, ''))
                 else k.note_remind and t >= k.end_time - make_interval(mins => k.remind_min) and t < k.end_time + interval '10 minutes' end)
       and public._note_lesson_today(k.name, d)
  loop
    bs := null; bt := null;
    qr := '';                                                                  -- QR 화면은 없앴다 (053)
    /* 학생 — 안 낸 · 결석 아님 · 번호 있음 · 학부모에게는 안 보냄 */
    for x in select * from public._note_students(c.name, d) s where not s.done and not s.absent and s.phone ~ '^01[0-9]{8,9}$' loop
      insert into public.note_remind_log (day, class_name, kind, target, manual) values (d, c.name, 'student', x.id::text, coalesce(p_manual, false))
        on conflict do nothing returning id into nid;
      if nid is null then continue; end if;
      if bs is null then
        bs := gen_random_uuid();
        insert into public.sms_batches (id, label, purpose, body, created_by) values (bs, '필기 알림(학생)', 'note', sbody, coalesce(p_by, '자동'));
      end if;
      txt := replace(replace(replace(sbody, '#{이름}', x.name), '#{반}', c.name),
               '#{링크}', case when x.code is not null then site || '/me/#' || x.code || '/photo/' || d else site || '/s/?note=' || replace(c.name, ' ', '%20') end);
      lid := gen_random_uuid();
      insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
      values (lid, bs, x.id, 'student', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), coalesce(p_by, '자동'));
      update public.note_remind_log set log_id = lid where id = nid;
      rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                         'class', c.name, 'who', 'student', 'name', x.name);
      nid := null;
    end loop;
    /* 운영진 — 담당 운영진(비어 있으면 사용 중인 운영진 전체) · 사용 중지 제외 · 「지금 다시 보내기」에는 안 보냄 */
    if not coalesce(p_manual, false) then
      for x in
        select s.email, s.name, p.phone from public.staff s join public.staff_phones p on p.email = s.email
         where s.active and (cardinality(c.staff_emails) = 0 or s.email = any(c.staff_emails)
                             or not exists (select 1 from public.staff s2 join public.staff_phones p2 on p2.email = s2.email where s2.active and s2.email = any(c.staff_emails)))
      loop
        insert into public.note_remind_log (day, class_name, kind, target) values (d, c.name, 'staff', x.email)
          on conflict do nothing returning id into nid;
        if nid is null then continue; end if;
        if bt is null then
          bt := gen_random_uuid();
          insert into public.sms_batches (id, label, purpose, body, created_by) values (bt, '필기 알림(운영진)', 'note', tbody, '자동');
        end if;
        txt := replace(replace(replace(replace(tbody, '#{반}', c.name), '#{분}', c.remind_min::text), '#{QR 링크}', qr), '#{이름}', x.name);
        lid := gen_random_uuid();
        insert into public.sms_log (id, batch_id, student_id, target, name, class_name, phone_last4, kind, body_head, created_by)
        values (lid, bt, null, 'staff', x.name, c.name, right(x.phone, 4), case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end, left(txt, 60), '자동');
        update public.note_remind_log set log_id = lid where id = nid;
        rows := rows || jsonb_build_object('log_id', lid, 'to', x.phone, 'text', txt, 'kind', case when public._sms_bytes(txt) > 90 then 'LMS' else 'SMS' end,
                                           'class', c.name, 'who', 'staff', 'name', x.name);
        nid := null;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'day', d, 'rows', rows);
end;
$$;
revoke all on function public._note_prepare(timestamptz, text, boolean, text, text) from public, anon, authenticated;

update public.sms_templates
   set body = btrim(replace(replace(body, ' QR 띄우기: #{QR 링크}', ''), 'QR 띄우기: #{QR 링크}', '')), updated_at = now()
 where title = '필기 알림(운영진)' and position('#{QR 링크}' in body) > 0;

drop table if exists pg_temp._m53;
create temp table _m53 (want text, key text, dow int, st time, en time, end_on date, found text, note text);
insert into _m53 (want, key, dow, st, en, end_on) values
  ('고2 선수능반', '고2선수능', 4, '18:30', '22:00', '2026-11-05'),
  ('목동반',       '목동',      6, '18:30', '22:00', '2026-11-14'),
  ('반포반',       '반포',      0, '09:30', '13:00', '2026-11-15');

do $$
declare
  w record;
  hits text[];
begin
  for w in select * from _m53 loop
    /* 띄어쓰기 · 끝의 「반」을 빼고 같은 반 → 없으면 그 말이 들어간 반 */
    select array_agg(name order by name) into hits from public.classes
     where not archived and regexp_replace(regexp_replace(name, '\s+', '', 'g'), '반$', '') = w.key;
    if hits is null then
      select array_agg(name order by name) into hits from public.classes
       where not archived and position(w.key in regexp_replace(name, '\s+', '', 'g')) > 0;
    end if;
    if hits is null then
      update _m53 set note = '못 찾음' where want = w.want;
    elsif cardinality(hits) > 1 then
      update _m53 set note = '여러 반 — ' || array_to_string(hits, ', ') || ' (반 카드 [바꾸기]로 넣어 주세요)' where want = w.want;
    else
      update public.classes
         set start_time = w.st, end_time = w.en, end_on = w.end_on, note_remind = true, remind_min = 5,
             lesson_dow = coalesce(lesson_dow, w.dow)
       where name = hits[1];
      update _m53 set found = hits[1], note = '넣음' where want = w.want;
    end if;
  end loop;
end;
$$;


-- ============================================================
--  확인 — 세 반의 실제 이름 · 요일 · 시각 · 종강일 · 필기 문자
-- ============================================================
select m.want as "찾은 반", coalesce(m.found, '—') as "DB 이름", m.note as "결과",
       case when c.lesson_dow is null then '—' else (array['일','월','화','수','목','금','토'])[c.lesson_dow + 1] end as "요일",
       coalesce(to_char(c.start_time, 'HH24:MI') || '~' || to_char(c.end_time, 'HH24:MI'), '—') as "수업 시각",
       coalesce(to_char(c.end_on, 'MM/DD'), '—') as "종강",
       case when c.name is null then '—' when c.note_remind then '켜짐 · 끝나기 ' || c.remind_min || '분 전 (' || to_char(c.end_time - make_interval(mins => c.remind_min), 'HH24:MI') || ')' else '꺼짐' end as "필기 문자"
  from _m53 m left join public.classes c on c.name = m.found
 order by m.end_on;
