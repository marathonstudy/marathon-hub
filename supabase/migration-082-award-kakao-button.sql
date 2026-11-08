-- ============================================================
--  migration-082-award-kakao-button.sql — 루틴 우수자 알림톡은 버튼으로 연결 (20261108n)
--  (082 는 081 다음 · 여러 번 실행해도 안전 · 함수 배포 없음 — note-remind 는 받은 변수를 그대로 넘긴다)
--
--  알림톡 템플릿 「과제루틴우수자」 — 변수 #{이름} #{월} #{코드} #{년월} (본문에 #{링크} 없음)
--    #{이름} 학생 이름 · #{월} 달 숫자(10) · #{코드} 받는 사람 링크 코드(학생 → 학생 링크 · 학부모 → 학부모 링크) · #{년월} 2026-10
--    버튼 [리포트 보기] 웹링크(모바일 · PC) https://marathonstudy.github.io/marathon-hub/me/?c=#{코드}&a=#{년월}
--  문자로 보낼 때는 지금처럼 본문 끝에 링크 (…/me/#코드/award/2026-10) · 템플릿 코드 칸이 비어 있으면 문자
-- ============================================================

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
      link := site || '/me/' || case when kakao then '?c=' || t.code || '&a=' || to_char(m, 'YYYY-MM') else '#' || t.code || '/award/' || to_char(m, 'YYYY-MM') end;   -- 문자는 본문에 링크 · 알림톡은 버튼(?c=#{코드}&a=#{년월})
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
                                                    jsonb_build_object('#{이름}', w.name, '#{월}', mo, '#{코드}', t.code, '#{년월}', to_char(m, 'YYYY-MM'))) end);
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



-- ============================================================
--  확인 — true
-- ============================================================
select '알림톡 변수 #{코드} #{년월}' as what, (position('#{년월}' in pg_get_functiondef('public.award_send_prepare(date, text, text)'::regprocedure)) > 0
                                       and position('#{링크}' in pg_get_functiondef('public.award_send_prepare(date, text, text)'::regprocedure)) = 0)::text as ok;
