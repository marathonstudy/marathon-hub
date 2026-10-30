-- ============================================================
--  마라톤 코치룸 — 과제 독려 문자 (migration-054-hw-nudge.sql · 20261101g)
--
--  실행 방법
--    053 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 학생 · 기록은 바꾸지 않는다. 함수 배포는 필요 없다 (sms-send 그대로).
--
--  1. 「자주 쓰는 문구」에 「과제 독려(학생)」 · 「과제 독려(학부모)」 (이미 있으면 그대로)
--     칸: {학생이름} {밀린날짜}(코치룸이 학생마다 채워 보낸다) · 그 밖의 칸은 052 와 같다
--  2. sms_purpose_last(학생) — 상담 카드에 「과제 독려 문자 10/31」도 (목적 nudge · 052 는 입구 · 웰컴만)
--  보낸 기록에는 「과제 독려」(목적 nudge) · 「오늘 보냄」은 052 의 sms_sent_today('nudge')
-- ============================================================

create or replace function public.sms_purpose_last(p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '{}'::jsonb else coalesce((
    select jsonb_object_agg(x.purpose, x.at)
      from (select b.purpose, max(l.created_at) as at
              from public.sms_log l join public.sms_batches b on b.id = l.batch_id
             where l.student_id = p_student and not l.test and l.status = 'ok' and b.purpose in ('entry', 'welcome', 'nudge')
             group by b.purpose) x), '{}'::jsonb) end;
$$;

do $$
declare nx int := coalesce((select max(sort_order) from public.sms_templates), 0);
begin
  execute 'revoke all on function public.sms_purpose_last(uuid) from public, anon';
  execute 'grant execute on function public.sms_purpose_last(uuid) to authenticated';
  if not exists (select 1 from public.sms_templates where btrim(title) = '과제 독려(학생)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('과제 독려(학생)', '[마라톤국어] {학생이름} 학생, 이번 주 과제 {밀린날짜}이 아직 제출 안 됐어요. 오늘 안에 마라톤 앱에서 제출해 주세요!', nx + 1, 'migration-054');
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) = '과제 독려(학부모)') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('과제 독려(학부모)', '[마라톤국어] {학생이름} 학생의 이번 주 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.', nx + 2, 'migration-054');
  end if;
end;
$$;


-- ============================================================
--  확인 — 두 줄 모두 true
-- ============================================================
select '상담 카드 과제 독려' as what, (position('nudge' in pg_get_functiondef('public.sms_purpose_last(uuid)'::regprocedure)) > 0)::text as ok
union all select '과제 독려 문구', ((select count(*) from public.sms_templates where btrim(title) in ('과제 독려(학생)', '과제 독려(학부모)')) = 2)::text;
