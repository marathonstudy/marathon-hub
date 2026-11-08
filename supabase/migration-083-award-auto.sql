-- ============================================================
--  migration-083-award-auto.sql — 월간 루틴 우수자 원장 확인 없이 자동 발송 (20261108o)
--  (083 은 082 다음 · 여러 번 실행해도 안전 · 그다음 함수 note-remind 다시 배포)
--
--  매달 1일 08:00 후보 계산(077 그대로) → 같은 날 10:00 note-remind 가 자동으로 학생 · 학부모에게 (배지도 그때 생긴다 — sent_at)
--    08:00 ~ 10:00 사이 원장이 고친 것(학생 빼기 · 선생님 한마디)은 그대로 반영 · [지금 보내기]로 먼저 보내면 그 학생은 다시 안 감
--    자동 발송은 그달 1일 10:00 ~ 그날 밤까지만 (1일이 지나서 계산된 달은 자동으로 보내지 않는다 — 원장이 [보내기])
--    달마다 한 번 (award_runs.auto_sent_at) · 같은 달 한 학생 한 번(077 sent_at)
--  설정 「월간 루틴 우수자 자동 발송」 (app_settings 'award'.auto · 기본 켜짐 · 원장만) — 끄면 원장이 [보내기]를 눌러야
--  award_list — autoWait(08:00~10:00 자동 발송 기다림) · autoSent · sentAt(마지막 보낸 시각)
-- ============================================================

alter table public.award_runs add column if not exists auto_sent_at timestamptz;

/* 자동 발송을 기다리는 때 — 켬 · 그달 다음 달 1일 · 10:00 전 · 아직 안 보냄 */
create or replace function public._award_auto_wait(p_now timestamptz, p_month date, p_sent timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_month is not null and p_sent is null and coalesce((public._award_cfg() ->> 'auto')::boolean, true)
     and p_month = public._award_prev(p_now)
     and (p_now at time zone 'Asia/Seoul')::date = (p_month + interval '1 month')::date
     and (p_now at time zone 'Asia/Seoul')::time < time '10:00';
$$;
revoke all on function public._award_auto_wait(timestamptz, date, timestamptz) from public, anon, authenticated;

create or replace function public._award_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pct', greatest(50, least(100, coalesce((v ->> 'pct')::int, 90))),
    'min', greatest(1, least(31, coalesce((v ->> 'min')::int, 8))),
    'top', greatest(1, least(100, coalesce((v ->> 'top')::int, 30))),
    'via', case when v ->> 'via' = 'kakao' then 'kakao' else 'sms' end,
    'tpl', coalesce(btrim(v ->> 'tpl'), ''),
    'auto', coalesce((v ->> 'auto')::boolean, true))
  from (select coalesce((select value from public.app_settings where key = 'award'), '{}'::jsonb) v) x;
$$;
revoke all on function public._award_cfg() from public, anon, authenticated;

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
  if v ? 'auto' and jsonb_typeof(v -> 'auto') <> 'boolean' then raise exception '자동 발송은 켜기 / 끄기로 정해 주세요.'; end if;
  c := c || jsonb_strip_nulls(jsonb_build_object(
         'pct', case when v ? 'pct' then (v ->> 'pct')::int end, 'min', case when v ? 'min' then (v ->> 'min')::int end,
         'top', case when v ? 'top' then (v ->> 'top')::int end, 'via', v ->> 'via', 'tpl', case when v ? 'tpl' then btrim(v ->> 'tpl') end,
         'auto', case when v ? 'auto' then (v ->> 'auto')::boolean end));
  insert into public.app_settings (key, value) values ('award', c) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'cfg', public._award_cfg());
end;
$$;
revoke all on function public.award_cfg_set(jsonb) from public, anon;
grant execute on function public.award_cfg_set(jsonb) to authenticated;

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
    /* 자동 발송 (083) — 1일 08:00~10:00 「10:00 자동 발송 예정」 · 보낸 시각 */
    'autoWait', public._award_auto_wait(now(), m, r.auto_sent_at),
    'autoSent', r.auto_sent_at,
    'sentAt', (select to_char(max(z.sent_at) at time zone 'Asia/Seoul', 'HH24:MI') from public.routine_awards z where z.month = m),
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

revoke all on function public.award_list(date) from public, anon;
grant execute on function public.award_list(date) to authenticated;

/* 10:00 자동 발송 — note-remind 매분 (service_role) · 보낼 때가 아니면 rows 없음 */
create or replace function public.award_auto_prepare(p_now timestamptz, p_site text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
  m date := public._award_prev(p_now);
  r public.award_runs;
begin
  if not coalesce((public._award_cfg() ->> 'auto')::boolean, true) then return jsonb_build_object('ok', true, 'month', null, 'reason', 'off'); end if;
  if k::date <> (m + interval '1 month')::date or k::time < time '10:00' then return jsonb_build_object('ok', true, 'month', null); end if;
  select * into r from public.award_runs where month = m for update;
  if not found or r.auto_sent_at is not null then return jsonb_build_object('ok', true, 'month', null); end if;
  update public.award_runs set auto_sent_at = now() where month = m;
  return public.award_send_prepare(m, '자동', p_site);
end;
$$;
revoke all on function public.award_auto_prepare(timestamptz, text) from public, anon, authenticated;
grant execute on function public.award_auto_prepare(timestamptz, text) to service_role;


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '자동 발송 ' || case when (public._award_cfg() ->> 'auto')::boolean then '켜짐' else '꺼짐' end as what, 'true' as ok
union all select '10:00 자동 발송 함수', (to_regprocedure('public.award_auto_prepare(timestamptz, text)') is not null)::text
union all select '082 먼저 (알림톡 버튼 변수)', (position('#{년월}' in pg_get_functiondef('public.award_send_prepare(date, text, text)'::regprocedure)) > 0)::text;
