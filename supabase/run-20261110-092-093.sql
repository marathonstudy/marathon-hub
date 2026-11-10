-- ============================================================
--  run-20261110-092-093.sql — 오늘(2026-11-10) 넣을 SQL 한 번에 (만든 곳: tools/make-run-sql.cjs)
--  SQL Editor 에 통째로 붙여 넣고 Run · 여러 번 실행해도 안전 · 함수(Edge Function) 배포 없음
--   0) 맨 앞: 086 ~ 091 이 실제로 들어가 있는지 읽기만 하는 확인 (true / false)
--   1) false 인 번호만 순서대로 같이 넣는다 (086 → 087 → 088 → 089 → 090 → 091)
--   2) 092 → 093
--   3) 맨 끝: 전체 확인 표 — 「실행 전」 줄은 그때 있었는지(없었으면 「이번에 넣음」), 나머지 ok 는 모두 true
-- ============================================================

-- ------------------------------------------------------------
--  0. 실행 전 확인 (읽기만 — 결과는 이 실행 동안만 쓰는 임시 표에)
-- ------------------------------------------------------------
create or replace function pg_temp._cron_has(p_name text) returns boolean language plpgsql as $f$
declare b boolean := false;
begin
  if to_regclass('cron.job') is null then return false; end if;
  execute 'select exists (select 1 from cron.job where jobname = $1)' into b using p_name;
  return b;
end;
$f$;
drop table if exists pg_temp._pre1110;
create temp table _pre1110 (part text, what text, ok boolean);
insert into _pre1110 (part, what, ok) values
  ('086', '문구 번호 칸(sms_log.tpl_no)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sms_log' and column_name = 'tpl_no')),
  ('086', '학생별 발송 이력 함수(hw_msg_history)', exists (select 1 from pg_proc where proname = 'hw_msg_history')),
  ('087', '상담 이유 · 약속 칸(student_notes.promise)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_notes' and column_name = 'promise')),
  ('087', '상담 기준 함수(_consult_cfg)', exists (select 1 from pg_proc where proname = '_consult_cfg')),
  ('088', '점수 칸 → 미응시(review_score_to_absent)', exists (select 1 from pg_proc where proname = 'review_score_to_absent')),
  ('089', '모고 저장본 표(mogo_records)', to_regclass('public.mogo_records') is not null),
  ('089', '러닝노트 모고 함수(hub_mogo)', exists (select 1 from pg_proc where proname = 'hub_mogo')),
  ('090', '과제 상담 칸(student_notes.hw_from)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_notes' and column_name = 'hw_from')),
  ('090', '과제 상담 저장 함수(consult_hw_save)', exists (select 1 from pg_proc where proname = 'consult_hw_save')),
  ('091', '다음 밤 함수(_mogo_next_night)', exists (select 1 from pg_proc where proname = '_mogo_next_night')),
  ('091', '밤 23시 예약(mogo-sync-night)', pg_temp._cron_has('mogo-sync-night'));

-- ------------------------------------------------------------
--  086 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-086-hw-msg-rotate.sql)
-- ------------------------------------------------------------
do $g086$
begin
  if exists (select 1 from _pre1110 where part = '086' and not ok) then
    execute $m086$
-- ============================================================
--  migration-086-hw-msg-rotate.sql — 과제 문자 창: 기준 기간 · 학생별 발송 이력 · 문구 5가지 돌려 쓰기 (20261108r)
--  (086 은 085 다음 · 여러 번 실행해도 안전 · 함수 배포 없음 — sms-send · note-remind 는 그대로)
--
--  1. 문구 — 「과제 독려(학생) 1」~「5」 · 「과제 칭찬(학생) 1」~「5」 (문자 발송 → 자주 쓰는 문구에서 고치기 · 더하기 · 빼기 · 최소 1개)
--     번호 없는 예전 「과제 독려(학생)」 · 「과제 칭찬(학생)」 — 기본 글 그대로면 지우고, 원장이 고친 글이면 「… 예전 글」로 이름만 바꿔 둔다
--     「과제 독려(학부모)」는 그대로 (돌리지 않는다)
--  2. sms_log.tpl_no — 학생에게 간 과제 독려 · 칭찬이 몇 번 문구였는지 (다음엔 다른 번호 · 직접 고친 글이면 비움)
--     hw_tpl_mark(rows) — 보낸 직원이 방금 보낸 줄에만 적는다
--  3. hw_msg_history(시작일, 끝일) — 그 기간에 학생이 받은 과제 독려 · 칭찬 (직접 보낸 과제 문자 + 수업 전 예고 자동 문자)
--     [{ student_id, at, kind: nudge · praise, how: manual · pre, by: 보낸 사람 이름 · 자동, no: 문구 번호, to: [student, parent1 …] }] · 직원만
--  4. 사본 — 과제 문자 첫 줄 끝에 「문구 1~5번 돌림」 (학생별 번호는 적지 않는다)
-- ============================================================

-- ------------------------------------------------------------
--  1. 문구
-- ------------------------------------------------------------
do $$
declare
  nx int := coalesce((select max(sort_order) from public.sms_templates where btrim(title) like '과제 독려(%' or btrim(title) like '과제 칭찬(%'),
                     coalesce((select max(sort_order) from public.sms_templates), 0));
  nd text[] := array[
    '[마라톤국어] {학생이름} 학생, 지난주 과제 중 {밀린날짜}이 아직 제출되지 않았어요. 마라톤 앱에서 한번 확인해 보고, 할 수 있는 만큼 제출해 봐요!',
    '[마라톤국어] {학생이름} 학생, {밀린날짜} 과제가 아직 비어 있어요. 조금씩이라도 채워 가면 루틴이 다시 잡혀요. 앱에서 확인해 봐요!',
    '[마라톤국어] {학생이름} 학생, 바쁜 한 주였죠? {밀린날짜} 과제가 아직 남아 있어요. 시간 날 때 마라톤 앱에서 하나씩 제출해 봐요.',
    '[마라톤국어] {학생이름} 학생, {밀린날짜} 과제를 기다리고 있어요. 한 지문씩만 해도 충분하니, 앱에서 이어서 달려 봐요!',
    '[마라톤국어] {학생이름} 학생, 아직 제출 안 된 과제가 있어요({밀린날짜}). 다시 루틴으로 돌아오는 첫걸음, 오늘 하나만 먼저 해 봐요!'];
  pd text[] := array[
    '[마라톤국어] {학생이름} 학생, 이번 주 지금까지 나온 과제 {전체}개를 모두 제출했어요! 매일 루틴을 지켜 내느라 정말 수고했어요. 이 루틴 그대로 이어가 봐요!',
    '[마라톤국어] {학생이름} 학생, 과제 {전체}개 모두 제출 완료! 하루도 빠짐없이 해낸 거, 정말 대단해요. 수고했어요!',
    '[마라톤국어] {학생이름} 학생, 이번 주 과제를 빠짐없이 다 냈어요. 꾸준함이 제일 큰 실력이에요. 정말 수고 많았어요!',
    '[마라톤국어] {학생이름} 학생, 과제 {전체}개 퍼펙트! 이렇게 쌓은 매일이 시험장에서 힘이 될 거예요. 수고했어요!',
    '[마라톤국어] {학생이름} 학생, 이번 주도 루틴 완주! 과제 {전체}개를 모두 해낸 노력, 선생님이 잘 보고 있어요. 수고했어요!'];
  i int;
begin
  /* 번호 붙은 문구가 하나도 없을 때만 다섯 개를 넣는다 (원장이 지운 번호를 다시 살리지 않는다) */
  if not exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$') then
    for i in 1..5 loop
      insert into public.sms_templates (title, body, sort_order, updated_by) values ('과제 독려(학생) ' || i, nd[i], nx + i, 'migration-086');
    end loop;
  end if;
  if not exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$') then
    for i in 1..5 loop
      insert into public.sms_templates (title, body, sort_order, updated_by) values ('과제 칭찬(학생) ' || i, pd[i], nx + 5 + i, 'migration-086');
    end loop;
  end if;
  /* 번호 없는 예전 문구 — 기본 글(054 · 055 · 068)이면 지우고, 고친 글이면 이름만 「… 예전 글」 */
  delete from public.sms_templates where btrim(title) = '과제 독려(학생)' and body in (
    '[마라톤국어] {학생이름} 학생, 이번 주 과제 {밀린날짜}이 아직 제출 안 됐어요. 오늘 안에 마라톤 앱에서 제출해 주세요!',
    '[마라톤국어] {학생이름} 학생, 지난 수업 이후 과제 {밀린날짜}이 아직 제출 안 됐어요. 오늘 안에 마라톤 앱에서 제출해 주세요!');
  delete from public.sms_templates where btrim(title) = '과제 칭찬(학생)' and body =
    '[마라톤국어] {학생이름} 학생, 이번 주 지금까지 나온 과제 {전체수}개를 모두 제출했어요! 매일 루틴을 지켜 내느라 정말 수고했어요. 이 루틴 그대로 이어가 봐요!';
  update public.sms_templates set title = btrim(title) || ' 예전 글', updated_at = now()
   where btrim(title) in ('과제 독려(학생)', '과제 칭찬(학생)')
     and not exists (select 1 from public.sms_templates t2 where btrim(t2.title) = btrim(public.sms_templates.title) || ' 예전 글');
end;
$$;


-- ------------------------------------------------------------
--  2. 문구 번호
-- ------------------------------------------------------------
alter table public.sms_log add column if not exists tpl_no smallint;

/* 방금 보낸 과제 독려 · 칭찬 줄에 문구 번호 — [{ student_id, kind: nudge · praise, no }]
   그 학생에게 간 그 종류의 가장 최근 줄 하나 · 자기가 보낸 줄 · 10분 안 · 학생에게 간 줄 · 시험 발송 아님 (sms-send 는 그대로) */
create or replace function public.hw_tpl_mark(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); n int := 0;
begin
  if not public.is_staff() or me = '' or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  update public.sms_log l set tpl_no = x.no
    from (select distinct on (l2.student_id, b2.purpose) l2.id, (r ->> 'no')::smallint as no
            from jsonb_array_elements(p_rows) r
            join public.sms_log l2 on (r ->> 'student_id') ~ '^[0-9a-f-]{36}$' and l2.student_id = (r ->> 'student_id')::uuid
            join public.sms_batches b2 on b2.id = l2.batch_id and b2.purpose = r ->> 'kind'
           where (r ->> 'no') ~ '^[0-9]{1,2}$' and r ->> 'kind' in ('nudge', 'praise')
             and lower(l2.created_by) = me and l2.target = 'student' and not l2.test and l2.created_at > now() - interval '10 minutes'
           order by l2.student_id, b2.purpose, l2.created_at desc) x
   where l.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.hw_tpl_mark(jsonb) from public, anon;
grant execute on function public.hw_tpl_mark(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 학생별 발송 이력 — 그 기간(한국 날짜 · 시작 · 끝 포함)
--     직접 보낸 것: 묶음마다 학생 한 줄(학생 · 학부모로 갔어도 한 번) · 시험 발송 · 실패는 뺀다
--     수업 전 예고: 미제출 → 독려 · 모두 제출 → 칭찬 (보내지 않은 off · none 은 뺀다)
-- ------------------------------------------------------------
create or replace function public.hw_msg_history(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('student_id', x.student_id, 'at', x.at, 'kind', x.kind, 'how', x.how, 'by', x.by, 'no', x.no, 'to', x.tos) order by x.at)
      from (
        select l.student_id, min(l.created_at) as at, b.purpose as kind, 'manual' as how,
               coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(b.created_by) limit 1), nullif(split_part(b.created_by, '@', 1), ''), '') as by,
               max(l.tpl_no) filter (where l.target = 'student') as no,
               jsonb_agg(distinct l.target) as tos
          from public.sms_log l join public.sms_batches b on b.id = l.batch_id
         where b.purpose in ('nudge', 'praise') and not l.test and l.status <> 'fail' and l.student_id is not null
           and (l.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
         group by l.batch_id, l.student_id, b.purpose, b.created_by
        union all
        select g.student_id, coalesce(l.created_at, g.created_at), case when g.band = 'all' then 'praise' else 'nudge' end, 'pre', '자동', null::smallint, '["student"]'::jsonb
          from public.pre_remind_log g left join public.sms_log l on l.id = g.log_id
         where g.band in ('miss', 'all') and g.log_id is not null and g.ok is distinct from false
           and g.day between p_from and p_to
      ) x), '[]'::jsonb) end;
$$;
revoke all on function public.hw_msg_history(date, date) from public, anon;
grant execute on function public.hw_msg_history(date, date) to authenticated;


-- ------------------------------------------------------------
--  4. 사본 — 「독려 19명 / 칭찬 3명 · 문구 1~5번 돌림」 (068 의 _copy_hw · 번호가 적힌 줄이 있을 때만)
--     독려 · 칭찬 문구 수가 다르면 「독려 문구 1~5번 · 칭찬 문구 1~3번 돌림」
-- ------------------------------------------------------------
create or replace function public._copy_hw(rows jsonb)
returns text language sql stable set search_path = public as $$
  with r as (
    select e ->> 'student_id' sid, e ->> 'p' p, l.tpl_no
      from jsonb_array_elements(rows) e left join public.sms_log l on l.id = (e ->> 'id')::uuid
  ), n as (
    select (select count(*) from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$') nd,
           (select count(*) from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$') np,
           exists (select 1 from r where r.p = 'nudge' and r.tpl_no is not null) rd,
           exists (select 1 from r where r.p = 'praise' and r.tpl_no is not null) rp
  )
  select concat_ws(' / ',
           case when count(distinct sid) filter (where p = 'nudge') > 0 then '독려 ' || count(distinct sid) filter (where p = 'nudge') || '명' end,
           case when count(distinct sid) filter (where p = 'praise') > 0 then '칭찬 ' || count(distinct sid) filter (where p = 'praise') || '명' end) ||
         coalesce((select case when rd and rp and nd <> np then ' · 독려 문구 1~' || nd || '번 · 칭찬 문구 1~' || np || '번 돌림'
                               when rd or rp then ' · 문구 1~' || case when rd then nd else np end || '번 돌림' end
                     from n where (rd and nd > 1) or (rp and np > 1)), '')
    from r;
$$;

$m086$;
  end if;
end
$g086$;

-- ------------------------------------------------------------
--  087 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-087-quick-consult.sql)
-- ------------------------------------------------------------
do $g087$
begin
  if exists (select 1 from _pre1110 where part = '087' and not ok) then
    execute $m087$
-- ============================================================
--  migration-087-quick-consult.sql — 현장 빠른 상담 기록 (20261108s)
--  (087 은 086 다음 · 여러 번 실행해도 안전 · 함수 배포 없음 — note-remind 는 그대로)
--
--  1. student_notes 에 칸 — 과제 못 한 이유(reason) · 다음 주 약속(promise) · 누른 버튼(picks · 통계용)
--       숫자 약속: goal_n(최소 n개) · goal_all(전부) · goal_lesson(판정할 수업일 = 그 수업 전 주 D-7 ~ D-1)
--       안 낸 날짜(miss_days) · 판정(verdict: kept · partial · missed · verdict_done / verdict_total · verdict_by auto · 이름)
--       분류 「생활」 더함 (과제 · 학습 · 생활 · 기타)
--  2. 설정 「상담」 — 상담 기준(기본 60%) · 이유 버튼 · 약속 버튼 (원장만 바꿈 · 직원 모두 읽음)
--  3. 약속 나중에 덧붙이기 · 직접 약속 「지켰나요?」 · 숫자 약속 판정 저장 — 함수로만 (덮어쓰지 않게)
--  4. 숫자 약속 자동 판정 — 수업 전 예고가 그 학생을 셀 때(pre_remind_log 한 줄 · done / total) 그 수업이 판정일인 약속을
--       「전부」는 그 주 전체 개수 · 「최소 n개」는 n 과 전체 중 작은 값 · 늦게 낸 것은 냄 · 면제는 뺌 (수업 전 예고의 셈 그대로)
--     수업 전 예고를 끈 반은 코치룸이 학생 창 · 학생 줄을 그릴 때 같은 셈으로 저장한다 (consult_judge)
--  5. 운영진 과제 현황 문자 「상담 필요」 줄 끝 「(약속 3개 → 2개 ✕)」 · 직접 약속은 「(약속: 앞 20자…)」
--  이유 · 약속 · 판정 · 상담 내용은 직원만 읽는다 (학생 · 학부모 화면 · 문자 함수는 student_notes 를 읽지 않는다 — 그대로)
-- ============================================================

-- ------------------------------------------------------------
--  1. 칸
-- ------------------------------------------------------------
alter table public.student_notes add column if not exists reason        text not null default '';
alter table public.student_notes add column if not exists promise       text not null default '';
alter table public.student_notes add column if not exists picks         jsonb not null default '{}'::jsonb;
alter table public.student_notes add column if not exists goal_n        smallint;
alter table public.student_notes add column if not exists goal_all      boolean not null default false;
alter table public.student_notes add column if not exists goal_lesson   date;
alter table public.student_notes add column if not exists miss_days     date[] not null default '{}';
alter table public.student_notes add column if not exists verdict       text;
alter table public.student_notes add column if not exists verdict_done  smallint;
alter table public.student_notes add column if not exists verdict_total smallint;
alter table public.student_notes add column if not exists verdict_by    text;
alter table public.student_notes add column if not exists verdict_at    timestamptz;
alter table public.student_notes drop constraint if exists student_notes_reason_len;
alter table public.student_notes add constraint student_notes_reason_len check (char_length(reason) <= 500 and char_length(promise) <= 500);
alter table public.student_notes drop constraint if exists student_notes_verdict_check;
alter table public.student_notes add constraint student_notes_verdict_check check (verdict is null or verdict in ('kept', 'partial', 'missed'));
alter table public.student_notes drop constraint if exists student_notes_cat_check;
alter table public.student_notes add constraint student_notes_cat_check
  check (categories <@ array['상담', '과제 독려', '학습 상담', '학부모 연락', '집중', '정서·컨디션', '출결', '학습', '기타', '과제', '걱정 문자', '퇴원', '재등록', '생활']::text[]);
create index if not exists student_notes_goal_idx on public.student_notes (student_id, goal_lesson) where goal_lesson is not null and deleted_at is null;


-- ------------------------------------------------------------
--  2. 설정 「상담」 — { pct: 60, reasons: [...], promises: [...] }
-- ------------------------------------------------------------
create or replace function public._consult_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pct', coalesce(case when (v ->> 'pct') ~ '^\d{1,3}$' then least(100, greatest(1, (v ->> 'pct')::int)) end, 60),
    'reasons', coalesce(case when jsonb_typeof(v -> 'reasons') = 'array' and jsonb_array_length(v -> 'reasons') > 0 then v -> 'reasons' end, '["바빠서", "깜빡해서", "어려워서"]'::jsonb),
    'promises', coalesce(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' end, '[]'::jsonb))
  from (select coalesce((select value from public.app_settings where key = 'consult'), '{}'::jsonb) v) x;
$$;
revoke all on function public._consult_cfg() from public, anon, authenticated;

create or replace function public.consult_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then public._consult_cfg() || jsonb_build_object('owner', public._real_teacher()) else '{}'::jsonb end;
$$;
revoke all on function public.consult_cfg() from public, anon;
grant execute on function public.consult_cfg() to authenticated;

/* 원장만 — 버튼은 글자 1~20자 · 12개까지 · 같은 글 한 번 */
create or replace function public.consult_cfg_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := coalesce(p, '{}'::jsonb); rs jsonb; ps jsonb; pc int;
begin
  if not public._real_teacher() then raise exception '상담 설정은 원장 계정만 바꿀 수 있습니다.'; end if;
  select coalesce(jsonb_agg(distinct btrim(e)), '[]'::jsonb) into rs from jsonb_array_elements_text(case when jsonb_typeof(v -> 'reasons') = 'array' then v -> 'reasons' else '[]'::jsonb end) e where char_length(btrim(e)) between 1 and 20;
  select coalesce(jsonb_agg(distinct btrim(e)), '[]'::jsonb) into ps from jsonb_array_elements_text(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' else '[]'::jsonb end) e where char_length(btrim(e)) between 1 and 20;
  if jsonb_array_length(rs) = 0 then raise exception '이유 버튼은 하나 이상 있어야 합니다.'; end if;
  if jsonb_array_length(rs) > 12 or jsonb_array_length(ps) > 12 then raise exception '버튼은 12개까지 둘 수 있습니다.'; end if;
  pc := case when (v ->> 'pct') ~ '^\d{1,3}$' then (v ->> 'pct')::int end;
  if pc is null or pc < 1 or pc > 100 then raise exception '상담 기준은 1~100%% 사이로 적어 주세요.'; end if;
  /* 넣은 순서 그대로 (distinct 는 순서를 바꾸므로 원래 순서로 다시) */
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into rs from (select distinct on (btrim(e)) btrim(e) x, o from jsonb_array_elements_text(v -> 'reasons') with ordinality t(e, o) where char_length(btrim(e)) between 1 and 20 order by btrim(e), o) q;
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into ps from (select distinct on (btrim(e)) btrim(e) x, o from jsonb_array_elements_text(case when jsonb_typeof(v -> 'promises') = 'array' then v -> 'promises' else '[]'::jsonb end) with ordinality t(e, o) where char_length(btrim(e)) between 1 and 20 order by btrim(e), o) q;
  insert into public.app_settings (key, value, updated_by) values ('consult', jsonb_build_object('pct', pc, 'reasons', rs, 'promises', ps), coalesce(auth.jwt() ->> 'email', ''))
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'cfg', public._consult_cfg());
end;
$$;
revoke all on function public.consult_cfg_save(jsonb) from public, anon;
grant execute on function public.consult_cfg_save(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 약속 덧붙이기 · 직접 약속 판정 · 숫자 약속 판정 저장
-- ------------------------------------------------------------
/* 오늘 남긴 과제 상담에 약속을 나중에 — 약속이 아직 비어 있을 때만 (다른 사람이 먼저 적었으면 false) */
create or replace function public.consult_promise_add(p_note uuid, p_promise text, p_picks jsonb, p_goal_n int, p_goal_all boolean, p_goal_lesson date)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; pr text := btrim(left(coalesce(p_promise, ''), 500));
begin
  if not public.is_staff() or pr = '' then return false; end if;
  update public.student_notes
     set promise = pr, next_check = left(pr, 200),
         picks = coalesce(picks, '{}'::jsonb) || jsonb_build_object('promise', coalesce(p_picks ->> 'promise', 'custom')),
         goal_n = case when p_goal_n between 0 and 30 then p_goal_n end, goal_all = coalesce(p_goal_all, false),
         goal_lesson = case when p_goal_n between 0 and 30 or coalesce(p_goal_all, false) then p_goal_lesson end,
         body = body || E'\n약속: ' || pr
   where id = p_note and deleted_at is null and promise = '';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.consult_promise_add(uuid, text, jsonb, int, boolean, date) from public, anon;
grant execute on function public.consult_promise_add(uuid, text, jsonb, int, boolean, date) to authenticated;

/* 직접 입력한 약속 「지켰나요?」 — 지킴 · 일부 · 못 지킴 (누가 눌렀는지 남김 · 다시 누르면 바뀜) */
create or replace function public.consult_verdict_set(p_note uuid, p_verdict text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() or p_verdict not in ('kept', 'partial', 'missed') then return false; end if;
  update public.student_notes set verdict = p_verdict, verdict_by = public._staff_name(), verdict_at = now()
   where id = p_note and deleted_at is null and promise <> '' and goal_n is null and not goal_all;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.consult_verdict_set(uuid, text) from public, anon;
grant execute on function public.consult_verdict_set(uuid, text) to authenticated;

/* 숫자 약속 판정 — 전부 = 그 주 전체 · 최소 n = least(n, 전체) · 낸 개수가 그 이상이면 지킴 */
create or replace function public._consult_verdict(p_n int, p_all boolean, p_done int, p_total int)
returns text language sql immutable as $$
  select case when coalesce(p_total, 0) <= 0 then null
              when coalesce(p_done, 0) >= case when p_all then p_total else least(coalesce(p_n, 0), p_total) end then 'kept'
              else 'missed' end;
$$;

/* 아직 판정 안 한 숫자 약속 — 판정 수업일이 지났거나 오늘(수업 전 예고 셈과 같은 기간) */
create or replace function public._consult_judge_one(p_student uuid, p_day date, p_done int, p_total int, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(p_total, 0) <= 0 then return 0; end if;
  update public.student_notes
     set verdict = public._consult_verdict(goal_n, goal_all, p_done, p_total),
         verdict_done = least(greatest(p_done, 0), 99), verdict_total = least(p_total, 99), verdict_by = p_by, verdict_at = now()
   where student_id = p_student and goal_lesson = p_day and verdict is null and deleted_at is null and (goal_n is not null or goal_all);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public._consult_judge_one(uuid, date, int, int, text) from public, anon, authenticated;

/* 코치룸 — 수업 전 예고를 끈 반 · 아직 판정 안 된 숫자 약속 (판정 수업일이 오늘이거나 지남) */
create or replace function public.consult_judge(p_note uuid, p_done int, p_total int)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then return false; end if;
  select * into r from public.student_notes where id = p_note and deleted_at is null and verdict is null and (goal_n is not null or goal_all)
     and goal_lesson <= (now() at time zone 'Asia/Seoul')::date;
  if not found then return false; end if;
  return public._consult_judge_one(r.student_id, r.goal_lesson, p_done, p_total, 'auto') > 0;
end;
$$;
revoke all on function public.consult_judge(uuid, int, int) from public, anon;
grant execute on function public.consult_judge(uuid, int, int) to authenticated;


-- ------------------------------------------------------------
--  4. 자동 판정 — 수업 전 예고가 학생을 셀 때 (pre_remind_log 한 줄 · 보내지 않은 off · none 도 센다)
-- ------------------------------------------------------------
create or replace function public._consult_pre_judge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._consult_judge_one(new.student_id, new.day, coalesce(new.done, 0), coalesce(new.total, 0), 'auto');
  return new;
exception when others then return new;     -- 판정이 실패해도 수업 전 예고는 그대로
end;
$$;
drop trigger if exists consult_pre_judge on public.pre_remind_log;
create trigger consult_pre_judge after insert on public.pre_remind_log for each row execute function public._consult_pre_judge();


-- ------------------------------------------------------------
--  5. 운영진 과제 현황 문자 — 「상담 필요」 줄 끝에 지난 약속 (081 의 _hws_texts 에 한 조각)
--     그 수업일 전에 남긴 가장 최근 약속 · 숫자 약속은 저장된 판정(없으면 오늘 셈) · 직접 약속은 앞 20자
-- ------------------------------------------------------------
create or replace function public._consult_tag(p_student uuid, p_day date, p_done int, p_total int)
returns text language plpgsql stable security definer set search_path = public as $$
declare n record; tot int; dn int; tg int; vd text;
begin
  select * into n from public.student_notes x
   where x.student_id = p_student and x.deleted_at is null and x.promise <> '' and x.note_date < p_day
   order by x.note_date desc, x.created_at desc limit 1;
  if not found then return ''; end if;
  if n.goal_n is null and not n.goal_all then
    return ' (약속: ' || left(n.promise, 20) || case when char_length(n.promise) > 20 then '…' else '' end || ')';
  end if;
  /* 저장된 판정 · 없으면 오늘이 판정일일 때 이 문자의 셈 */
  tot := coalesce(n.verdict_total, case when n.goal_lesson = p_day and p_total > 0 then p_total end);
  dn  := coalesce(n.verdict_done, case when n.goal_lesson = p_day and p_total > 0 then p_done end);
  vd  := coalesce(n.verdict, case when n.goal_lesson = p_day then public._consult_verdict(n.goal_n, n.goal_all, p_done, p_total) end);
  tg  := case when n.goal_all then tot else least(n.goal_n, coalesce(tot, n.goal_n)) end;
  return ' (약속 ' || coalesce(tg::text || '개', '전부') ||
         case when dn is not null and vd is not null then ' → ' || dn || '개 ' || case vd when 'kept' then '✓' else '✕' end else '' end || ')';
end;
$$;
revoke all on function public._consult_tag(uuid, date, int, int) from public, anon, authenticated;

create or replace function public._hws_texts(p_class text, p_day date, p_start text, p_items jsonb, p_cut integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  cut int := greatest(1, least(100, coalesce(p_cut, 60)));
  head text := '[과제 현황] ' || p_class || ' · 오늘 ' || coalesce(p_start, '') || ' 수업';
  per text := '이번 주 ' || to_char(p_day - 7, 'FMMM/FMDD') || '~' || to_char(p_day - 1, 'FMMM/FMDD') ||
              ' · 지난주 ' || to_char(p_day - 14, 'FMMM/FMDD') || '~' || to_char(p_day - 8, 'FMMM/FMDD');
  two text;
  pf jsonb := public._hws_perfect(p_day, p_items);
  lines text[] := '{}'; body text[] := '{}'; top text[];
  nrank int := 0; nlow int := 0; none_ text; unk text; tail text;
  r record;
  limitb int := 2000;
  parts text[] := '{}'; cur text; ln text; k int; n int;
begin
  for r in
    with x as (
      select s.id, s.name, coalesce((i ->> 'done')::int, 0) dn, coalesce((i ->> 'total')::int, 0) tt, coalesce((i ->> 'known')::boolean, true) known,
             coalesce((i ->> 'pdone')::int, 0) pdn, coalesce((i ->> 'ptotal')::int, 0) ptt
        from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
    )
    select x.id, x.name, x.dn, x.tt, (x.dn * 100 / x.tt) pct, case when x.ptt > 0 then x.pdn * 100 / x.ptt end ppct from x where x.known and x.tt > 0
     order by (x.dn * 100 / x.tt) desc, x.name collate "C"
  loop
    nrank := nrank + 1;
    if r.pct < cut then nlow := nlow + 1; end if;
    body := body || (r.pct || '% ' || r.name ||
                     case when r.ppct is null then ' (지난주 없음)'
                          else ' (지난주 ' || r.ppct || '%' ||
                               case when r.pct > r.ppct then ' ↑' when r.ppct - r.pct >= 20 then ' ↓↓' when r.pct < r.ppct then ' ↓' else '' end || ')' end ||
                     case when r.pct < cut then ' → 상담 필요' || public._consult_tag(r.id, p_day, r.dn, r.tt) else '' end);
    if r.pct < cut and r.ppct is not null and r.ppct < cut then two := concat_ws(', ', two, r.name); end if;
  end loop;
  select string_agg(s.name, ', ' order by s.name collate "C") into none_
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where coalesce((i ->> 'known')::boolean, true) and coalesce((i ->> 'total')::int, 0) <= 0;
  select string_agg(s.name, ', ' order by s.name collate "C") into unk
    from jsonb_array_elements(items) i join public.students s on s.id::text = i ->> 'id'
   where not coalesce((i ->> 'known')::boolean, true);
  if none_ is not null then body := body || ('과제 없음 · ' || none_); end if;
  if unk is not null then body := body || ('앱 기록 없음 · ' || unk); end if;
  tail := case when nrank = 0 then '완료율을 낼 학생이 없어요.'
               when nlow > 0 then cut || '% 미만 ' || nlow || '명은 반드시 상담해 주세요.'
               else '모두 ' || cut || '% 이상이에요.' end;
  top := array['⭐ 이번 주 퍼펙트 ' || coalesce((pf ->> 'n')::int, 0) || '명'];
  if coalesce(pf ->> 'line', '') <> '' then top := top || (pf ->> 'line'); end if;
  lines := array[head, per] || top || array['완료율 높은 순 · ' || nrank || '명'] || body || array[tail];
  if two is not null then lines := lines || ('2주 연속 ' || cut || '% 미만: ' || two); end if;

  if public._sms_bytes(array_to_string(lines, E'\n')) <= limitb then
    return jsonb_build_object('texts', jsonb_build_array(array_to_string(lines, E'\n')), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
  end if;
  cur := head || ' (#/#)';
  for k in 2 .. coalesce(array_length(lines, 1), 0) loop
    ln := lines[k];
    if public._sms_bytes(cur || E'\n' || ln) > limitb - 4 then
      parts := parts || cur;
      cur := '[과제 현황] ' || p_class || ' (#/#)' || E'\n' || ln;
    else
      cur := cur || E'\n' || ln;
    end if;
  end loop;
  parts := parts || cur;
  n := array_length(parts, 1);
  for k in 1 .. n loop
    parts[k] := replace(parts[k], '(#/#)', '(' || k || '/' || n || ')');
  end loop;
  return jsonb_build_object('texts', to_jsonb(parts), 'students', nrank, 'low', nlow, 'perfect', coalesce((pf ->> 'n')::int, 0));
end;
$$;
revoke all on function public._hws_texts(text, date, text, jsonb, integer) from public, anon, authenticated;

$m087$;
  end if;
end
$g087$;

-- ------------------------------------------------------------
--  088 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-088-review-to-absent.sql)
-- ------------------------------------------------------------
do $g088$
begin
  if exists (select 1 from _pre1110 where part = '088' and not ok) then
    execute $m088$
-- ============================================================
--  migration-088-review-to-absent.sql — 복습테스트 점수 칸: 점수가 있는 칸을 [미응시로 바꾸기] (20261108t)
--  (088 은 087 다음 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  review_score_to_absent(시험, 학생, 사유, 메모) — 점수(제출 기록)를 지우고 미응시(사유)로
--    지운 점수는 기록(review_log 「score_to_absent」 · 문항 수 · 맞힌 개수 · 점수 · 누가 넣었는지)에 남는다 · 직원만
--    점수가 없으면 예전 review_absent_set 과 같다
--  (review_absent_set 은 점수가 있는 칸을 건너뛴다 — 그대로)
-- ============================================================

create or replace function public.review_score_to_absent(p_test uuid, p_student uuid, p_reason text, p_memo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rs text := btrim(coalesce(p_reason, ''));
  s public.review_submissions;
  t public.review_tests;
begin
  if not public.is_staff() then raise exception 'staff 로 등록된 계정만 할 수 있습니다.'; end if;
  if rs not in ('absent', 'late', 'counsel', 'replaced', 'other') then raise exception '미응시 사유를 골라 주세요.'; end if;
  select * into t from public.review_tests where id = p_test;
  if not found then raise exception '시험을 찾을 수 없습니다.'; end if;
  select * into s from public.review_submissions where test_id = p_test and student_id = p_student;
  if found then
    perform public._review_log('score_to_absent', s.id, p_student, t.class_name,
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'q_count', s.q_count, 'correct', s.correct, 'score', s.score, 'source', s.source),
      jsonb_build_object('test', public._review_label(t.lesson_date, t.test_name), 'reason', rs));
    delete from public.review_submissions where id = s.id;
  end if;
  return public.review_absent_set(array[p_test], p_student, rs, p_memo) || jsonb_build_object('removed', s.id is not null);
end;
$$;
revoke all on function public.review_score_to_absent(uuid, uuid, text, text) from public, anon;
grant execute on function public.review_score_to_absent(uuid, uuid, text, text) to authenticated;

$m088$;
  end if;
end
$g088$;

-- ------------------------------------------------------------
--  089 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-089-mogo-link.sql)
-- ------------------------------------------------------------
do $g089$
begin
  if exists (select 1 from _pre1110 where part = '089' and not ok) then
    execute $m089$
-- ============================================================
--  migration-089-mogo-link.sql — 모의고사 분석 레포트(marathon-report) 연동 (20261109b · 연동약속.md 버전 2)
--  (089 는 088 다음 · 여러 번 실행해도 안전)
--
--  순서 — 1. Supabase → Edge Functions → Secrets 에 MOGO_HUB_KEY (값은 원장님이 직접 · 저장소 · 화면에는 없음)
--         2. Edge Function mogo-sync 배포 (Verify JWT 끄기)  3. 이 파일 실행
--
--  1. mogo_records — 학생마다 받아 둔 모의고사 목록 저장본 (과제 기록 저장본처럼 · 화면은 이것만 읽는다)
--       state: ok 찾음 · none 일치하는 학생 없음 · nophone 번호 없음 · error 한 번도 못 받음 · check 연결 확인 필요(애매해서 연결 안 함)
--         학생 찾기 — 학생 번호가 있으면 「이름 + 학생 번호」 · 없거나 못 찾으면 「이름 + 학부모 번호」(둘 다 맞아야)
--         check 이유(reason) — sibling 코치룸에 같은 이름 · 같은 번호 학생이 둘 이상 · multi 학부모 번호 1 · 2 가 서로 다른 모고 학생 · mixed 같은 시험 같은 차례가 두 번
--         못 받으면(error) 예전 결과 · 목록은 그대로 두고 fails · reason 만 바꾼다
--       reports: [{ id, examName, date, score, grade, done, closed, firstAttempt, attempt }] (약속한 항목만 · 모르는 항목은 버림)
--       extra: { notebookUrl, analysisUrl, typeCode, summary }
--     코치룸 · 러닝노트 브라우저는 모고 주소를 직접 부르지 않는다 — 함수 mogo-sync 만 부르고 여기 저장한다
--  2. 받을 차례 — 8시간마다(학생마다 몇 분씩 어긋나게) · 못 받으면 30분 · 1시간 · 2시간 … 6시간 · 번호가 없으면 하루 · 밤 1 ~ 6시 쉼
--  3. 연결 상태(app_settings 'mogo_status') — ok · down(연결 끊김) · badkey(키 틀림) · nokey(설정 필요) · 받은 연동 버전
--  4. 러닝노트 hub_mogo(코드) — 그 학생 링크로만 · 완성된 레포트(done)만 · 마감 여부 · 미완성은 안 보냄 · 다른 학생 정보 없음
--  5. 예약 — 20분마다 mogo-sync (한 번에 15명 · 천천히 · 모고 무료 한도 안)
-- ============================================================

-- ------------------------------------------------------------
--  1. 저장본
-- ------------------------------------------------------------
create table if not exists public.mogo_records (
  student_id  uuid primary key references public.students(id) on delete cascade,
  state       text not null default 'none',
  reports     jsonb not null default '[]'::jsonb,
  extra       jsonb not null default '{}'::jsonb,
  version     integer,
  reason      text not null default '',
  fails       integer not null default 0,
  fetched_at  timestamptz,
  next_at     timestamptz,
  constraint mogo_records_state check (state in ('ok', 'none', 'nophone', 'error', 'check'))
);
/* 예전 초안으로 만든 표도 check 를 받게 (여러 번 실행해도 안전) */
alter table public.mogo_records drop constraint if exists mogo_records_state;
alter table public.mogo_records add constraint mogo_records_state check (state in ('ok', 'none', 'nophone', 'error', 'check'));
create index if not exists mogo_records_next on public.mogo_records (next_at);
alter table public.mogo_records enable row level security;
drop policy if exists mogo_records_staff_read on public.mogo_records;
create policy mogo_records_staff_read on public.mogo_records for select to authenticated using (public.is_staff());
revoke all on public.mogo_records from anon;


-- ------------------------------------------------------------
--  2. 받을 차례 (mogo-sync · service_role)
-- ------------------------------------------------------------
/* 학생 한 명 — 함수에 넘길 것 (이름 · 학생 번호 · 학부모 번호 1 · 2 · 숫자만)
   dupPhone · dupParent1 · dupParent2 — 코치룸의 다른 (보관 안 된) 학생이 같은 이름(띄어쓰기 무시) + 같은 번호(뒤 8자리)
   → 모고에서 누구 기록인지 가를 수 없어 함수가 묻지 않고 「확인 필요」로 둔다 (이름이 다른 형제 · 자매는 상관없음) */
create or replace function public._mogo_d8(v text)
returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(v, ''), '\D', '', 'g')) >= 8 then right(regexp_replace(coalesce(v, ''), '\D', '', 'g'), 8) else '' end;
$$;
create or replace function public._mogo_row(s public.students)
returns jsonb language sql stable as $$
  with me as (select regexp_replace(coalesce(s.name, ''), '\s', '', 'g') nm, public._mogo_d8(s.student_phone) ph,
                     public._mogo_d8(s.parent_phone) p1, public._mogo_d8(s.parent_phone2) p2),
       o as (select public._mogo_d8(t.student_phone) ph, public._mogo_d8(t.parent_phone) p1, public._mogo_d8(t.parent_phone2) p2
               from public.students t, me
              where t.id <> s.id and not t.archived and regexp_replace(coalesce(t.name, ''), '\s', '', 'g') = me.nm)
  select jsonb_build_object('id', s.id, 'name', btrim(s.name),
    'phone', regexp_replace(coalesce(s.student_phone, ''), '\D', '', 'g'),
    'parent1', regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g'),
    'parent2', regexp_replace(coalesce(s.parent_phone2, ''), '\D', '', 'g'),
    'dupPhone', me.ph <> '' and exists (select 1 from o where o.ph = me.ph),
    'dupParent1', me.p1 <> '' and exists (select 1 from o where me.p1 in (o.p1, o.p2)),
    'dupParent2', me.p2 <> '' and exists (select 1 from o where me.p2 in (o.p1, o.p2)))
  from me;
$$;
/* 안쪽 함수 — 바깥에서 부르지 못하게 (같은 이름 · 번호 학생이 있는지 엿보지 못하게) */
revoke all on function public._mogo_row(public.students) from public, anon, authenticated;
revoke all on function public._mogo_d8(text) from public, anon, authenticated;

create or replace function public.mogo_due(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k timestamp := coalesce(p_now, now()) at time zone 'Asia/Seoul';
begin
  if k::time >= time '01:00' and k::time < time '06:00' then return jsonb_build_object('night', true, 'students', '[]'::jsonb); end if;
  return jsonb_build_object('night', false, 'students', coalesce((
    select jsonb_agg(public._mogo_row(s) order by r.next_at nulls first, s.name)
      from public.students s left join public.mogo_records r on r.student_id = s.id
     where s.id in (select s2.id from public.students s2 left join public.mogo_records r2 on r2.student_id = s2.id
                     where not s2.archived and btrim(coalesce(s2.name, '')) <> '' and (r2.student_id is null or r2.next_at is null or r2.next_at <= coalesce(p_now, now()))
                     order by r2.next_at nulls first, s2.name limit greatest(1, least(coalesce(p_limit, 15), 40)))), '[]'::jsonb));
end;
$$;
revoke all on function public.mogo_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mogo_due(timestamptz, integer) to service_role;

/* 코치룸 [↻] — 학생 id 목록 (["…", …]) */
create or replace function public.mogo_targets(p_students jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public._mogo_row(s)), '[]'::jsonb) from public.students s
   where not s.archived and s.id::text in (select jsonb_array_elements_text(case when jsonb_typeof(p_students) = 'array' then p_students else '[]'::jsonb end));
$$;
revoke all on function public.mogo_targets(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_targets(jsonb) to service_role;

/* 받은 것 저장 — [{ id, state, reports, extra, version, reason }] */
create or replace function public.mogo_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; st text; f int; jit int;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    if not exists (select 1 from public.students where id = (r ->> 'id')::uuid) then continue; end if;
    st := case when r ->> 'state' in ('ok', 'none', 'nophone', 'error', 'check') then r ->> 'state' else 'error' end;
    jit := abs(hashtext(r ->> 'id')) % 40;
    select fails into f from public.mogo_records where student_id = (r ->> 'id')::uuid;
    f := case when st = 'error' then coalesce(f, 0) + 1 else 0 end;
    insert into public.mogo_records as m (student_id, state, reports, extra, version, reason, fails, fetched_at, next_at)
    values ((r ->> 'id')::uuid, st,
            case when st = 'ok' and jsonb_typeof(r -> 'reports') = 'array' then r -> 'reports' else '[]'::jsonb end,
            case when st = 'ok' and jsonb_typeof(r -> 'extra') = 'object' then r -> 'extra' else '{}'::jsonb end,
            case when (r ->> 'version') ~ '^\d{1,4}$' then (r ->> 'version')::int end,
            left(coalesce(r ->> 'reason', ''), 40), f, now(),
            now() + case st when 'error' then make_interval(mins => least(360, 30 * (1 << least(f - 1, 4))))
                            when 'nophone' then interval '24 hours'
                            when 'check' then interval '24 hours'
                            else interval '8 hours' + make_interval(mins => jit) end)
    on conflict (student_id) do update set
      /* 못 받았으면 예전 결과(찾음 · 없음 · 확인 필요)와 받은 목록은 그대로 둔다 — 러닝노트는 예전 저장본을 계속 보여 준다 */
      state = case when excluded.state = 'error' then m.state else excluded.state end,
      reports = case when excluded.state = 'error' then m.reports else excluded.reports end,
      extra = case when excluded.state = 'error' then m.extra else excluded.extra end,
      version = coalesce(excluded.version, m.version), reason = excluded.reason, fails = excluded.fails,
      fetched_at = case when excluded.state = 'error' then m.fetched_at else excluded.fetched_at end, next_at = excluded.next_at;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mogo_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_save(jsonb) to service_role;


-- ------------------------------------------------------------
--  3. 연결 상태
-- ------------------------------------------------------------
create or replace function public.mogo_status_save(p jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.app_settings (key, value, updated_by) values ('mogo_status',
    jsonb_build_object('state', case when p ->> 'state' in ('ok', 'down', 'badkey', 'nokey') then p ->> 'state' else 'down' end,
                       'version', case when (p ->> 'version') ~ '^\d{1,4}$' then (p ->> 'version')::int end,
                       'at', now()), 'mogo-sync')
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'mogo-sync';
$$;
revoke all on function public.mogo_status_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_status_save(jsonb) to service_role;

/* 코치룸 — 연결 상태 · 저장본 숫자 */
create or replace function public.mogo_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_staff() then '{}'::jsonb else jsonb_build_object(
    'status', coalesce((select value from public.app_settings where key = 'mogo_status'), '{}'::jsonb),
    'counts', (select jsonb_build_object('ok', count(*) filter (where state = 'ok'), 'none', count(*) filter (where state = 'none'),
                                         'nophone', count(*) filter (where state = 'nophone'), 'error', count(*) filter (where state = 'error'),
                                         'check', count(*) filter (where state = 'check'),
                                         'last', max(fetched_at))
                 from public.mogo_records)) end;
$$;
revoke all on function public.mogo_status() from public, anon;
grant execute on function public.mogo_status() to authenticated;


-- ------------------------------------------------------------
--  4. 러닝노트 — 그 학생 링크로만 · 완성된 레포트만 (마감 여부 · 미완성은 안 보냄)
-- ------------------------------------------------------------
create or replace function public.hub_mogo(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; m public.mogo_records;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  select * into m from public.mogo_records where student_id = s.id and state = 'ok';
  if not found then return jsonb_build_object('reports', '[]'::jsonb); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'examName', x ->> 'examName', 'date', x ->> 'date',
                                                             'score', x -> 'score', 'grade', x -> 'grade', 'attempt', x -> 'attempt', 'firstAttempt', x -> 'firstAttempt')
                                          order by x ->> 'date' desc)
                           from jsonb_array_elements(m.reports) x where (x ->> 'done')::boolean is true), '[]'::jsonb),
    'notebookUrl', nullif(m.extra ->> 'notebookUrl', ''), 'analysisUrl', nullif(m.extra ->> 'analysisUrl', ''));
end;
$$;
revoke all on function public.hub_mogo(text) from public;
grant execute on function public.hub_mogo(text) to anon, authenticated;


-- ------------------------------------------------------------
--  5. 예약 — 20분마다 (함수 mogo-sync 를 먼저 배포 · 열쇠는 필기 알림과 같은 DB 값 · migration-050)
--     끄려면: select cron.unschedule('mogo-sync');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mogo-sync') then perform cron.unschedule('mogo-sync'); end if;
end;
$$;
select cron.schedule('mogo-sync', '7,27,47 * * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/mogo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);

$m089$;
  end if;
end
$g089$;

-- ------------------------------------------------------------
--  090 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-090-consult-split.sql)
-- ------------------------------------------------------------
do $g090$
begin
  if exists (select 1 from _pre1110 where part = '090' and not ok) then
    execute $m090$
-- ============================================================
--  migration-090-consult-split.sql — 빠른 상담 「과제 상담 / 일반 상담」 (20261109c)
--  (090 은 089 다음 · 087 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음)
--
--  1. student_notes 에 칸만 더한다 (예전 칸 · 기록은 지우지 않는다)
--       kind      — 'hw' 과제 상담 · 'general' 일반 상담 · 비어 있으면 예전 기록 (화면이 분류에서 짐작)
--       hw_from · hw_to — 과제 상담이 붙는 기간 (그 반의 가장 최근 수업 전 주 D-7 ~ D-1 · 과제 문자 · 수업 전 예고와 같은 기간)
--       hw_done · hw_total — 저장할 때 그 기간 과제 수 (「11/2~11/6 · 3/5」)
--  2. 과제 상담은 학생 · 기간마다 하나 — 같은 기간에 다시 저장하면 그 기록을 고친다 (consult_hw_save)
--       약속이 바뀌면 판정을 비우고 다시 판정 · 쓴 사람은 그대로 · 고친 사람 · 시각은 「수정됨」으로 남는다
--  3. 운영진 과제 현황 문자 「(약속 …)」 — 과제 상담의 약속만 본다 (일반 상담은 안 봄)
--  학생 · 학부모 화면 · 문자 함수는 student_notes 를 읽지 않는다 (그대로)
-- ============================================================

-- ------------------------------------------------------------
--  1. 칸
-- ------------------------------------------------------------
alter table public.student_notes add column if not exists kind     text;
alter table public.student_notes add column if not exists hw_from  date;
alter table public.student_notes add column if not exists hw_to    date;
alter table public.student_notes add column if not exists hw_done  smallint;
alter table public.student_notes add column if not exists hw_total smallint;
alter table public.student_notes drop constraint if exists student_notes_kind_check;
alter table public.student_notes add constraint student_notes_kind_check check (kind is null or kind in ('hw', 'general'));
alter table public.student_notes drop constraint if exists student_notes_hw_period_check;
alter table public.student_notes add constraint student_notes_hw_period_check check (kind is distinct from 'hw' or (hw_from is not null and hw_to is not null and hw_from <= hw_to));
/* 학생 · 기간마다 과제 상담 하나 (지운 기록은 빼고) */
create unique index if not exists student_notes_hw_period on public.student_notes (student_id, hw_from) where kind = 'hw' and deleted_at is null;


-- ------------------------------------------------------------
--  2. 과제 상담 저장 — 같은 기간이면 고치기
--     p = { student, from, to, reason, promise, picks, goal_n, goal_all, goal_lesson, miss: [날짜], done, total, follow, hw_day }
-- ------------------------------------------------------------
create or replace function public.consult_hw_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sid uuid; f date; t date; ex public.student_notes;
  rs text := btrim(left(coalesce(p ->> 'reason', ''), 500));
  pr text := btrim(left(coalesce(p ->> 'promise', ''), 500));
  gn int := case when (p ->> 'goal_n') ~ '^\d{1,2}$' then (p ->> 'goal_n')::int end;
  ga boolean := coalesce((p ->> 'goal_all')::boolean, false);
  gl date := case when (p ->> 'goal_lesson') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'goal_lesson')::date end;
  ms date[] := '{}'; bd text; kd date := (now() at time zone 'Asia/Seoul')::date; nid uuid;
begin
  if not public.is_staff() then raise exception '운영진만 저장할 수 있습니다.'; end if;
  if coalesce(p ->> 'student', '') !~ '^[0-9a-f-]{36}$' or coalesce(p ->> 'from', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p ->> 'to', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '학생 · 기간이 맞지 않습니다.';
  end if;
  sid := (p ->> 'student')::uuid; f := (p ->> 'from')::date; t := (p ->> 'to')::date;
  if f > t or t - f > 13 then raise exception '기간이 맞지 않습니다.'; end if;
  if rs = '' and pr = '' then raise exception '이유나 약속 중 하나는 적어 주세요.'; end if;
  if pr = '' or not (gn is not null or ga) then gn := null; ga := false; gl := null; end if;
  select coalesce(array_agg(x::date order by x), '{}') into ms
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'miss') = 'array' then p -> 'miss' else '[]'::jsonb end) x where x ~ '^\d{4}-\d{2}-\d{2}$';
  bd := concat_ws(E'\n', nullif(case when rs <> '' then '이유: ' || rs end, ''), nullif(case when pr <> '' then '약속: ' || pr end, ''),
                  case when array_length(ms, 1) > 0 then '안 낸 날: ' || (select string_agg(to_char(d, 'FMMM/FMDD') || '(' || (array['일','월','화','수','목','금','토'])[extract(dow from d)::int + 1] || ')', ' · ' order by d) from unnest(ms) d) end);
  select * into ex from public.student_notes where student_id = sid and kind = 'hw' and hw_from = f and deleted_at is null for update;
  if found then
    update public.student_notes set
      reason = rs, promise = pr, next_check = left(pr, 200), body = bd,
      picks = case when jsonb_typeof(p -> 'picks') = 'object' then p -> 'picks' else picks end,
      miss_days = ms, hw_to = t,
      hw_done = case when (p ->> 'done') ~ '^\d{1,2}$' then (p ->> 'done')::int else hw_done end,
      hw_total = case when (p ->> 'total') ~ '^\d{1,2}$' then (p ->> 'total')::int else hw_total end,
      follow_up = coalesce((p ->> 'follow')::boolean, follow_up),
      hw_day = coalesce(case when (p ->> 'hw_day') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'hw_day')::date end, hw_day),
      goal_n = gn, goal_all = ga, goal_lesson = gl,
      /* 약속이 바뀌면 판정을 비운다 (다시 판정) */
      verdict = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict end,
      verdict_done = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_done end,
      verdict_total = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_total end,
      verdict_by = case when pr is distinct from ex.promise or gn is distinct from ex.goal_n or ga is distinct from ex.goal_all then null else verdict_by end
     where id = ex.id;
    return jsonb_build_object('ok', true, 'id', ex.id, 'updated', true);
  end if;
  insert into public.student_notes (student_id, note_date, categories, kind, hw_from, hw_to, hw_done, hw_total, body, reason, promise, next_check,
                                    picks, miss_days, goal_n, goal_all, goal_lesson, follow_up, hw_day)
  values (sid, kd, array['과제'], 'hw', f, t,
          case when (p ->> 'done') ~ '^\d{1,2}$' then (p ->> 'done')::int end, case when (p ->> 'total') ~ '^\d{1,2}$' then (p ->> 'total')::int end,
          bd, rs, pr, left(pr, 200), case when jsonb_typeof(p -> 'picks') = 'object' then p -> 'picks' else '{}'::jsonb end,
          ms, gn, ga, gl, coalesce((p ->> 'follow')::boolean, false),
          case when (p ->> 'hw_day') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'hw_day')::date end)
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'updated', false);
end;
$$;
revoke all on function public.consult_hw_save(jsonb) from public, anon;
grant execute on function public.consult_hw_save(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 운영진 과제 현황 문자 — 과제 상담의 약속만 (예전 기록은 분류 「과제」 · 이유나 약속이 있는 것)
-- ------------------------------------------------------------
create or replace function public._consult_tag(p_student uuid, p_day date, p_done int, p_total int)
returns text language plpgsql stable security definer set search_path = public as $$
declare n record; tot int; dn int; tg int; vd text;
begin
  select * into n from public.student_notes x
   where x.student_id = p_student and x.deleted_at is null and x.promise <> '' and x.note_date < p_day
     and (x.kind = 'hw' or (x.kind is null and '과제' = any(x.categories)))
   order by coalesce(x.hw_from, x.note_date) desc, x.note_date desc, x.created_at desc limit 1;
  if not found then return ''; end if;
  if n.goal_n is null and not n.goal_all then
    return ' (약속: ' || left(n.promise, 20) || case when char_length(n.promise) > 20 then '…' else '' end || ')';
  end if;
  tot := coalesce(n.verdict_total, case when n.goal_lesson = p_day and p_total > 0 then p_total end);
  dn  := coalesce(n.verdict_done, case when n.goal_lesson = p_day and p_total > 0 then p_done end);
  vd  := coalesce(n.verdict, case when n.goal_lesson = p_day then public._consult_verdict(n.goal_n, n.goal_all, p_done, p_total) end);
  tg  := case when n.goal_all then tot else least(n.goal_n, coalesce(tot, n.goal_n)) end;
  return ' (약속 ' || coalesce(tg::text || '개', '전부') ||
         case when dn is not null and vd is not null then ' → ' || dn || '개 ' || case vd when 'kept' then '✓' else '✕' end else '' end || ')';
end;
$$;
revoke all on function public._consult_tag(uuid, date, int, int) from public, anon, authenticated;

$m090$;
  end if;
end
$g090$;

-- ------------------------------------------------------------
--  091 — 실행 전 확인이 하나라도 false 면 지금 넣는다 (migration-091-mogo-nightly.sql)
-- ------------------------------------------------------------
do $g091$
begin
  if exists (select 1 from _pre1110 where part = '091' and not ok) then
    execute $m091$
-- ============================================================
--  migration-091-mogo-nightly.sql — 모의고사 기록 받기를 하루 한 번(밤 23시)으로 (20261109c)
--  (091 은 090 다음 · 089 가 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음 — mogo-sync 그대로)
--
--  왜 — 089 는 20분마다 15명씩 · 학생마다 8시간마다라서, 학생이 많으면 한 바퀴 도는 데 오래 걸리고
--       처음 몇 시간 동안은 일부 학생(예: 46명 중 16명)만 받아져 있었다
--  1. 매일 밤 23:00 ~ 23:55 (한국 시간) 5분마다 한 번씩 · 한 번에 15명 · 천천히 (12번 = 180명까지 · 모고 무료 한도 안)
--       재원 중인 모든 학생이 대상 (보관 · 퇴원 학생 빼고) · 일치 없음 · 번호 없음 · 확인 필요 학생도 하루 한 번 다시
--       밤 쉬기(1 ~ 6시) 규칙은 쓰지 않는다
--  2. 다음 차례 — 받으면(찾음 · 없음 · 번호 없음 · 확인 필요) 다음 밤 22:55 · 못 받으면 10분 뒤(그 밤 안에 다시) · 세 번 넘게 못 받으면 다음 밤
--     코치룸 ↻ · 반 카드 [모고 기록 지금 받기]로 받은 학생도 같은 규칙 (그날 밤에는 다시 받지 않음 — 1시간 안에 받았으면 다음 밤)
--  3. 20분마다 예약(mogo-sync)은 없애고 밤 예약(mogo-sync-night)으로 바꾼다
-- ============================================================

-- ------------------------------------------------------------
--  1. 다음 밤 22:55 (한국 시간) — 지금부터 1시간 안이면 그다음 밤
-- ------------------------------------------------------------
create or replace function public._mogo_next_night(p_now timestamptz)
returns timestamptz language sql stable as $$
  select case when x.t <= coalesce(p_now, now()) + interval '1 hour' then x.t + interval '1 day' else x.t end
    from (select (((coalesce(p_now, now()) at time zone 'Asia/Seoul')::date + time '22:55') at time zone 'Asia/Seoul') t) x;
$$;
revoke all on function public._mogo_next_night(timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------
--  2. 받을 차례 — 밤 쉬기 없음 · 다음 차례가 된 학생 (재원 중 모두)
-- ------------------------------------------------------------
create or replace function public.mogo_due(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('night', false, 'students', coalesce((
    select jsonb_agg(public._mogo_row(s) order by r.next_at nulls first, s.name)
      from public.students s left join public.mogo_records r on r.student_id = s.id
     where s.id in (select s2.id from public.students s2 left join public.mogo_records r2 on r2.student_id = s2.id
                     where not s2.archived and btrim(coalesce(s2.name, '')) <> '' and (r2.student_id is null or r2.next_at is null or r2.next_at <= coalesce(p_now, now()))
                     order by r2.next_at nulls first, s2.name limit greatest(1, least(coalesce(p_limit, 15), 40)))), '[]'::jsonb));
end;
$$;
revoke all on function public.mogo_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mogo_due(timestamptz, integer) to service_role;

/* 받은 것 저장 — 다음 차례만 바뀐다 (089 와 같음 · next_at 규칙만 하루 한 번으로) */
create or replace function public.mogo_save(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; st text; f int;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) loop
    if coalesce(r ->> 'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    if not exists (select 1 from public.students where id = (r ->> 'id')::uuid) then continue; end if;
    st := case when r ->> 'state' in ('ok', 'none', 'nophone', 'error', 'check') then r ->> 'state' else 'error' end;
    select fails into f from public.mogo_records where student_id = (r ->> 'id')::uuid;
    f := case when st = 'error' then coalesce(f, 0) + 1 else 0 end;
    insert into public.mogo_records as m (student_id, state, reports, extra, version, reason, fails, fetched_at, next_at)
    values ((r ->> 'id')::uuid, st,
            case when st = 'ok' and jsonb_typeof(r -> 'reports') = 'array' then r -> 'reports' else '[]'::jsonb end,
            case when st = 'ok' and jsonb_typeof(r -> 'extra') = 'object' then r -> 'extra' else '{}'::jsonb end,
            case when (r ->> 'version') ~ '^\d{1,4}$' then (r ->> 'version')::int end,
            left(coalesce(r ->> 'reason', ''), 40), f, now(),
            case when st = 'error' and f <= 3 then now() + interval '10 minutes' else public._mogo_next_night(now()) end)
    on conflict (student_id) do update set
      state = case when excluded.state = 'error' then m.state else excluded.state end,
      reports = case when excluded.state = 'error' then m.reports else excluded.reports end,
      extra = case when excluded.state = 'error' then m.extra else excluded.extra end,
      version = coalesce(excluded.version, m.version), reason = excluded.reason, fails = excluded.fails,
      fetched_at = case when excluded.state = 'error' then m.fetched_at else excluded.fetched_at end, next_at = excluded.next_at;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mogo_save(jsonb) from public, anon, authenticated;
grant execute on function public.mogo_save(jsonb) to service_role;

/* 이미 저장된 학생도 오늘 밤부터 새 규칙으로 (다음 차례가 내일 이후로 밀려 있으면 오늘 밤으로) */
update public.mogo_records set next_at = least(coalesce(next_at, now()), public._mogo_next_night(now() - interval '2 hours'));


-- ------------------------------------------------------------
--  3. 예약 — 20분마다(mogo-sync) 없애고 밤 23:00 ~ 23:55 5분마다(mogo-sync-night)
--     pg_cron 은 UTC — 한국 23시 = UTC 14시
--     끄려면: select cron.unschedule('mogo-sync-night');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mogo-sync') then perform cron.unschedule('mogo-sync'); end if;
  if exists (select 1 from cron.job where jobname = 'mogo-sync-night') then perform cron.unschedule('mogo-sync-night'); end if;
end;
$$;
select cron.schedule('mogo-sync-night', '*/5 14 * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/mogo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);

$m091$;
  end if;
end
$g091$;

-- ------------------------------------------------------------
--  092 (migration-092-hw-parent-rotate.sql)
-- ------------------------------------------------------------
-- ============================================================
--  migration-092-hw-parent-rotate.sql — 과제 문자: 학부모 독려 새 문구 · 학부모 독려 / 칭찬 1~5 돌려 쓰기 (20261110a)
--  (092 는 091 다음 · 086 이 먼저 · 여러 번 실행해도 안전 · 함수 배포 없음 — sms-send 그대로)
--
--  1. 문구 「과제 독려(학부모) 1」~「5」 · 「과제 칭찬(학부모) 1」~「5」 (문자 발송 → 자주 쓰는 문구에서 고치기 · 더하기 · 빼기 · 최소 1개)
--     번호 붙은 문구가 하나도 없을 때만 다섯 개를 넣는다 (원장이 지운 번호를 다시 살리지 않는다)
--     예전 「과제 독려(학부모)」 — 054 · 055 기본 글 그대로면 지우고 새 1번 글로 · 사람이 고친 글이면 그 행은 그대로 두고 1번에 그 글을 쓴다
--  2. 학부모에게 간 과제 문자 줄에도 문구 번호 — hw_tpl_mark_pa(rows) (학생 쪽 hw_tpl_mark 는 그대로)
--  3. hw_msg_history — 학부모에게 간 문구 번호 pno 를 더한다 (다음엔 다른 번호)
--  사본 규칙 · 보낸 기록 이름(과제 독려 · 과제 칭찬)은 그대로
-- ============================================================

-- ------------------------------------------------------------
--  1. 문구
-- ------------------------------------------------------------
do $$
declare
  nx int := coalesce((select max(sort_order) from public.sms_templates where btrim(title) like '과제 독려(%' or btrim(title) like '과제 칭찬(%'),
                     coalesce((select max(sort_order) from public.sms_templates), 0));
  old_def text[] := array[
    '[마라톤국어] {학생이름} 학생의 이번 주 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생의 지난 수업 이후 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.'];
  nd text[] := array[
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. 이번 주 과제 중 {밀린날짜} 과제가 아직 제출되지 않아 안내드립니다. 바쁜 주에는 밀릴 수 있어 수업에서도 함께 챙기고 있습니다. 할 수 있는 만큼 이어 갈 수 있도록 따뜻한 응원 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 제출되지 않았습니다. 수업에서 함께 살피며 다시 루틴을 잡아 가겠습니다. 가정에서도 격려 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 남아 있어 알려 드립니다. 조금씩 이어 갈 수 있도록 저희가 함께 챙기겠습니다. 따뜻한 응원 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. {밀린날짜} 과제가 아직 제출 전입니다. 한 번에 다 하지 않아도 되도록 수업에서 함께 돕고 있습니다. 응원의 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생 학부모님, 안녕하세요. 바쁜 한 주라 {밀린날짜} 과제가 조금 밀렸습니다. 다시 리듬을 찾도록 학원에서 함께 챙기고 있습니다. 가정에서도 힘이 되는 한마디 부탁드립니다.'];
  pd text[] := array[
    '[마라톤국어] {학생이름} 학생이 이번 주 지금까지 나온 과제 {전체}개를 모두 제출했습니다. 매일 루틴을 꾸준히 지켜 내고 있습니다. 가정에서도 칭찬 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 이번 주 과제 {전체}개를 빠짐없이 제출했습니다. 하루하루 꾸준히 해내는 모습이 대견합니다. 가정에서도 칭찬 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 과제 {전체}개를 모두 제출했습니다. 바쁜 중에도 루틴을 지켜 낸 노력이 돋보입니다. 따뜻한 칭찬 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 이번 주 과제를 하나도 빠뜨리지 않고 제출했습니다({전체}개). 이 꾸준함이 큰 힘이 될 것입니다. 가정에서도 격려 한마디 부탁드립니다.',
    '[마라톤국어] {학생이름} 학생이 과제 {전체}개를 모두 해냈습니다. 매일 조금씩 쌓은 노력이 잘 보이고 있습니다. 가정에서도 응원의 말 부탁드립니다.'];
  ob text; i int;
begin
  /* 예전 학부모 독려 — 기본 글 그대로면 지운다 · 사람이 고친 글이면 그 행은 그대로 두고 1번에 그 글 */
  select body into ob from public.sms_templates where btrim(title) = '과제 독려(학부모)' order by updated_at desc nulls last limit 1;
  if ob is not null and (btrim(ob) = any(old_def) or btrim(ob) = '') then ob := null; end if;
  if not exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학부모\) [0-9]{1,2}$') then
    for i in 1..5 loop
      insert into public.sms_templates (title, body, sort_order, updated_by)
      values ('과제 독려(학부모) ' || i, case when i = 1 and ob is not null then ob else nd[i] end, nx + 10 + i, 'migration-092');
    end loop;
  end if;
  delete from public.sms_templates where btrim(title) = '과제 독려(학부모)' and (btrim(body) = any(old_def) or btrim(body) = '');
  if not exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학부모\) [0-9]{1,2}$') then
    for i in 1..5 loop
      insert into public.sms_templates (title, body, sort_order, updated_by) values ('과제 칭찬(학부모) ' || i, pd[i], nx + 15 + i, 'migration-092');
    end loop;
  end if;
end;
$$;


-- ------------------------------------------------------------
--  2. 학부모에게 간 줄에 문구 번호 — [{ student_id, kind: nudge · praise, no }]
--     그 학생 · 그 종류의 가장 최근 묶음에서 학부모 1 · 2 로 간 줄 · 자기가 보낸 줄 · 10분 안 · 시험 발송 아님
-- ------------------------------------------------------------
create or replace function public.hw_tpl_mark_pa(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', '')); n int := 0;
begin
  if not public.is_staff() or me = '' or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  update public.sms_log l set tpl_no = x.no
    from (select l2.id, x2.no
            from (select distinct on (l3.student_id, b3.purpose) l3.batch_id, l3.student_id, (r ->> 'no')::smallint as no
                    from jsonb_array_elements(p_rows) r
                    join public.sms_log l3 on (r ->> 'student_id') ~ '^[0-9a-f-]{36}$' and l3.student_id = (r ->> 'student_id')::uuid
                    join public.sms_batches b3 on b3.id = l3.batch_id and b3.purpose = r ->> 'kind'
                   where (r ->> 'no') ~ '^[0-9]{1,2}$' and r ->> 'kind' in ('nudge', 'praise')
                     and lower(l3.created_by) = me and l3.target in ('parent1', 'parent2') and not l3.test and l3.created_at > now() - interval '10 minutes'
                   order by l3.student_id, b3.purpose, l3.created_at desc) x2
            join public.sms_log l2 on l2.batch_id = x2.batch_id and l2.student_id = x2.student_id and l2.target in ('parent1', 'parent2')) x
   where l.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.hw_tpl_mark_pa(jsonb) from public, anon;
grant execute on function public.hw_tpl_mark_pa(jsonb) to authenticated;


-- ------------------------------------------------------------
--  3. 학생별 발송 이력 — 086 과 같고 pno(학부모에게 간 문구 번호)만 더한다
-- ------------------------------------------------------------
create or replace function public.hw_msg_history(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_staff() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('student_id', x.student_id, 'at', x.at, 'kind', x.kind, 'how', x.how, 'by', x.by, 'no', x.no, 'pno', x.pno, 'to', x.tos) order by x.at)
      from (
        select l.student_id, min(l.created_at) as at, b.purpose as kind, 'manual' as how,
               coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = lower(b.created_by) limit 1), nullif(split_part(b.created_by, '@', 1), ''), '') as by,
               max(l.tpl_no) filter (where l.target = 'student') as no,
               max(l.tpl_no) filter (where l.target in ('parent1', 'parent2')) as pno,
               jsonb_agg(distinct l.target) as tos
          from public.sms_log l join public.sms_batches b on b.id = l.batch_id
         where b.purpose in ('nudge', 'praise') and not l.test and l.status <> 'fail' and l.student_id is not null
           and (l.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
         group by l.batch_id, l.student_id, b.purpose, b.created_by
        union all
        select g.student_id, coalesce(l.created_at, g.created_at), case when g.band = 'all' then 'praise' else 'nudge' end, 'pre', '자동', null::smallint, null::smallint, '["student"]'::jsonb
          from public.pre_remind_log g left join public.sms_log l on l.id = g.log_id
         where g.band in ('miss', 'all') and g.log_id is not null and g.ok is distinct from false
           and g.day between p_from and p_to
      ) x), '[]'::jsonb) end;
$$;
revoke all on function public.hw_msg_history(date, date) from public, anon;
grant execute on function public.hw_msg_history(date, date) to authenticated;

-- ------------------------------------------------------------
--  093 (migration-093-game-face.sql)
-- ------------------------------------------------------------
-- ============================================================
--  migration-093-game-face.sql — 러닝노트 게임 프로필(캐릭터 · 꾸미기 · 본 레벨) · 학생 얼굴 사진은 코치룸에만 (20261110b)
--  (093 은 092 다음 · 035 가 먼저 · 여러 번 실행해도 안전 · 함수(Edge Function) 배포 없음)
--
--  1. student_game — 고른 캐릭터 · 테두리 · 소품 · 이미 본 레벨(레벨 업 연출 한 번만) · 이미 본 퍼펙트 기간
--       hub_profile(code) 읽기 (학생 · 학부모 링크) · hub_profile_save(code, p) 저장 (학생 링크만 — 학부모 링크는 보기만)
--       잠긴 꾸미기(레벨)는 화면이 거른다 (레벨은 앱 과제 기록으로 화면이 센다) · 서버는 이름이 목록에 있는지만 본다
--       코치룸(직원)은 읽기만 — 학생 목록 · 학생 카드에 사진이 없으면 고른 캐릭터
--  2. 학생 얼굴 사진 (035 의 student_profile.photo · thumb 그대로 — 정사각 400px JPEG · 작은 사진 96px · 직원만 읽음 · 공개 주소 없음)
--       face_staff_save(학생, 사진, 작은 사진, 동의) — 코치룸(직원)이 올리기(「학생 동의 받음」 체크가 있어야) · 바꾸기 · 지우기(빈 값 = 지움)
--       me_photo_save(코드, 사진, 작은 사진, 확인) — 학생이 올리기(안내 문구 확인 체크가 있어야) · 예전 세 칸짜리는 지우기만
--       동의한 때(consent_at) · 올린 사람(photo_by — 직원 이름 · 「학생」)을 남긴다 · 사진을 지우면 함께 지운다
--       me_info_get — 이제 사진은 돌려주지 않는다 (「사진 있음」 참 · 거짓만 · 학생 화면엔 올린 직후 이 기기 미리보기만)
--       hub_face(code) — 러닝노트 홈 「내 사진 올리기」 칸: 학생 링크만 · 사진 있음 참 · 거짓만
--       학생이 올리고 지우기는 035 의 me_photo_save 그대로 (학생 링크만 · 비우면 지움)
-- ============================================================

-- ------------------------------------------------------------
--  1. 게임 프로필
-- ------------------------------------------------------------
create table if not exists public.student_game (
  student_id uuid primary key references public.students(id) on delete cascade,
  char text not null default '',
  frame text not null default 'violet',
  prop text not null default 'headband',
  seen_level smallint not null default 0,
  seen_perfect text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.student_game enable row level security;
drop policy if exists student_game_staff_read on public.student_game;
create policy student_game_staff_read on public.student_game for select to authenticated using (public.is_staff());

create or replace function public.hub_profile(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; p public.student_game;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return null; end if;
  select * into p from public.student_game where student_id = s.id;
  return jsonb_build_object('char', coalesce(p.char, ''), 'frame', coalesce(p.frame, 'violet'), 'prop', coalesce(p.prop, 'headband'),
                            'seen_level', coalesce(p.seen_level, 0), 'seen_perfect', coalesce(p.seen_perfect, ''),
                            'can_edit', public._hub_role(p_code) = 'student');
end;
$$;
revoke all on function public.hub_profile(text) from public;
grant execute on function public.hub_profile(text) to anon, authenticated;

/* p = { char, frame, prop, seen_level, seen_perfect } — 있는 것만 바꾼다 */
create or replace function public.hub_profile_save(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
  chars text[] := array['maratoni','marabugi','rabbit','turtle','cheetah','penguin','fox','bear','cat','dog','otter','owl','squirrel','hedgehog'];
  frames text[] := array['violet','mint','coral','navy','silver','gold'];
  props text[] := array['none','headband','cap','shoes','silver','gold','trophy'];
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if public._hub_role(p_code) is distinct from 'student' then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if (p ? 'char' and not (p ->> 'char' = any(chars))) or (p ? 'frame' and not (p ->> 'frame' = any(frames)))
     or (p ? 'prop' and not (p ->> 'prop' = any(props))) then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  insert into public.student_game (student_id) values (s.id) on conflict (student_id) do nothing;
  update public.student_game set
    char = coalesce(p ->> 'char', char), frame = coalesce(p ->> 'frame', frame), prop = coalesce(p ->> 'prop', prop),
    seen_level = case when (p ->> 'seen_level') ~ '^[0-9]$' then greatest(seen_level, (p ->> 'seen_level')::smallint) else seen_level end,
    seen_perfect = case when (p ->> 'seen_perfect') ~ '^\d{4}-\d{2}-\d{2}$' then greatest(seen_perfect, p ->> 'seen_perfect') else seen_perfect end,
    updated_at = now()
   where student_id = s.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.hub_profile_save(text, jsonb) from public;
grant execute on function public.hub_profile_save(text, jsonb) to anon, authenticated;


-- ------------------------------------------------------------
--  2. 얼굴 사진 — 코치룸에만
-- ------------------------------------------------------------
/* 동의 · 올린 사람 — 동의한 때(consent_at) · 누가 올렸는지(photo_by: 직원 이름 · 「학생」) · 사진을 지우면 함께 지운다 */
alter table public.student_profile add column if not exists consent_at timestamptz;
alter table public.student_profile add column if not exists photo_by text;

/* 코치룸(직원) 올리기 · 바꾸기 · 지우기 — 올릴 때는 「학생 동의 받음」(p_agree) 이 있어야 한다
   사진이 비면 사진 · 작은 사진 · 동의 기록을 모두 지운다 (표에서 완전히) */
drop function if exists public.face_staff_save(uuid, text, text);
create or replace function public.face_staff_save(p_student uuid, p_photo text, p_thumb text, p_agree boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := nullif(btrim(coalesce(p_photo, '')), ''); th text := nullif(btrim(coalesce(p_thumb, '')), '');
  me text := lower(coalesce(auth.jwt() ->> 'email', '')); who text;
begin
  if not public.is_staff() then raise exception '직원만 할 수 있습니다.'; end if;
  if not exists (select 1 from public.students where id = p_student) then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if ph is not null and p_agree is not true then return jsonb_build_object('ok', false, 'reason', 'agree'); end if;
  if ph is not null and (ph not like 'data:image/jpeg;base64,%' or length(ph) > 200000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if th is not null and (th not like 'data:image/jpeg;base64,%' or length(th) > 30000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if ph is null then th := null; end if;
  who := coalesce((select nullif(btrim(s.name), '') from public.staff s where lower(s.email) = me limit 1), nullif(split_part(me, '@', 1), ''), '직원');
  insert into public.student_profile (student_id, photo, thumb, consent_at, photo_by, updated_at)
  values (p_student, ph, th, case when ph is not null then now() end, case when ph is not null then who end, now())
  on conflict (student_id) do update set photo = excluded.photo, thumb = excluded.thumb, consent_at = excluded.consent_at, photo_by = excluded.photo_by, updated_at = now();
  return jsonb_build_object('ok', true, 'photo', ph is not null);
end;
$$;
revoke all on function public.face_staff_save(uuid, text, text, boolean) from public, anon;
grant execute on function public.face_staff_save(uuid, text, text, boolean) to authenticated;

/* 학생이 올리기 — 안내 문구 확인 체크(p_agree) 가 있어야 올라간다 · 지우기는 언제든 (사진 · 동의 기록 모두) */
create or replace function public.me_photo_save(p_code text, p_photo text, p_thumb text, p_agree boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare sid uuid := public._me_student(p_code);
  ph text := nullif(btrim(coalesce(p_photo, '')), ''); th text := nullif(btrim(coalesce(p_thumb, '')), '');
begin
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'notstudent'); end if;
  if ph is not null and p_agree is not true then return jsonb_build_object('ok', false, 'reason', 'agree'); end if;
  if ph is not null and (ph not like 'data:image/jpeg;base64,%' or length(ph) > 200000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if th is not null and (th not like 'data:image/jpeg;base64,%' or length(th) > 30000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if ph is null then th := null; end if;
  insert into public.student_profile (student_id, photo, thumb, consent_at, photo_by, student_at, updated_at)
  values (sid, ph, th, case when ph is not null then now() end, case when ph is not null then '학생' end, now(), now())
  on conflict (student_id) do update set photo = excluded.photo, thumb = excluded.thumb, consent_at = excluded.consent_at, photo_by = excluded.photo_by, student_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'photo', ph is not null);
end;
$$;
revoke all on function public.me_photo_save(text, text, text, boolean) from public;
grant execute on function public.me_photo_save(text, text, text, boolean) to anon, authenticated;
/* 예전(035) 세 칸짜리 — 확인 체크 없이는 올리지 않는다 (지우기만) */
create or replace function public.me_photo_save(p_code text, p_photo text, p_thumb text)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.me_photo_save(p_code, p_photo, p_thumb, false);
$$;
revoke all on function public.me_photo_save(text, text, text) from public;
grant execute on function public.me_photo_save(text, text, text) to anon, authenticated;

/* 「내 정보」 — 사진은 더 이상 돌려주지 않는다 (있음 · 없음만) */
create or replace function public.me_info_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid := public._me_student(p_code); s public.students; p public.student_profile;
begin
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'notstudent'); end if;
  select * into s from public.students where id = sid;
  select * into p from public.student_profile where student_id = sid;
  return jsonb_build_object('ok', true,
    'name', s.name, 'class_name', s.class_name, 'school', s.school, 'grade', s.grade, 'phone', s.student_phone,
    'info', coalesce(p.info, '{}'::jsonb), 'photo', null, 'has_photo', p.photo is not null, 'student_at', p.student_at);
end;
$$;
revoke all on function public.me_info_get(text) from public;
grant execute on function public.me_info_get(text) to anon, authenticated;

/* 러닝노트 홈 — 학생 링크만 · 사진 있음 참 · 거짓만 */
create or replace function public.hub_face(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid := public._me_student(p_code);
begin
  if sid is null then return jsonb_build_object('has', false, 'can', false); end if;
  return jsonb_build_object('has', exists (select 1 from public.student_profile where student_id = sid and photo is not null), 'can', true);
end;
$$;
revoke all on function public.hub_face(text) from public;
grant execute on function public.hub_face(text) to anon, authenticated;


-- ============================================================
--  확인 — 전체 (실행 전 · 086 ~ 093)
-- ============================================================
select '실행 전' as part, p.part || ' · ' || p.what as what, case when p.ok then 'true' else '없었음 → 이번에 넣음' end as ok from _pre1110 p
union all
select '086' as part, x.what::text, x.ok::text from (
select '과제 독려(학생) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$') || '개' as what,
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$')::text as ok
union all select '과제 칭찬(학생) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$') || '개',
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$')::text
union all select '문구 번호 칸(sms_log.tpl_no)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sms_log' and column_name = 'tpl_no')::text
union all select '학생별 발송 이력 함수', exists (select 1 from pg_proc where proname = 'hw_msg_history')::text
union all (select '예전 글로 남김: ' || title, 'true' from public.sms_templates where btrim(title) in ('과제 독려(학생) 예전 글', '과제 칭찬(학생) 예전 글'))
) x
union all
select '087' as part, x.what::text, x.ok::text from (
select '이유 · 약속 칸' as what, exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'promise')::text as ok
union all select '분류 생활', (position('생활' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notes_cat_check')) > 0)::text
union all select '상담 기준 ' || (public._consult_cfg() ->> 'pct') || '% · 이유 버튼 ' || jsonb_array_length(public._consult_cfg() -> 'reasons') || '개', 'true'
union all select '수업 전 예고 때 약속 판정', exists (select 1 from pg_trigger where tgname = 'consult_pre_judge')::text
union all select '운영진 문자 약속 표시', (position('_consult_tag' in pg_get_functiondef('public._hws_texts(text, date, text, jsonb, integer)'::regprocedure)) > 0)::text
union all select '직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text
) x
union all
select '088' as part, x.what::text, x.ok::text from (
select '점수 칸 → 미응시로 바꾸기' as what, exists (select 1 from pg_proc where proname = 'review_score_to_absent')::text as ok
) x
union all
select '089' as part, x.what::text, x.ok::text from (
select '저장본 표(mogo_records)' as what, (to_regclass('public.mogo_records') is not null)::text as ok
union all select '직원만 읽음', (not has_table_privilege('anon', 'public.mogo_records', 'select'))::text
union all select '「확인 필요」 상태', exists (select 1 from pg_constraint where conname = 'mogo_records_state' and pg_get_constraintdef(oid) like '%''check''%')::text
union all select '러닝노트 함수(완성된 것만)', exists (select 1 from pg_proc where proname = 'hub_mogo')::text
) x
union all
select '090' as part, x.what::text, x.ok::text from (
select '과제 상담 · 일반 상담 칸(kind · hw_from)' as what, exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'hw_from')::text as ok
union all select '학생 · 기간마다 과제 상담 하나', exists (select 1 from pg_indexes where indexname = 'student_notes_hw_period')::text
union all select '과제 상담 저장(같은 기간이면 고치기)', exists (select 1 from pg_proc where proname = 'consult_hw_save')::text
union all select '운영진 문자 약속 — 과제 상담만', (position('kind = ''hw''' in pg_get_functiondef('public._consult_tag(uuid, date, int, int)'::regprocedure)) > 0)::text
union all select '예전 기록 그대로(지운 칸 없음)', exists (select 1 from information_schema.columns where table_name = 'student_notes' and column_name = 'categories')::text
union all select '직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_notes' and 'anon' = any(roles)))::text
) x
union all
select '091' as part, x.what::text, x.ok::text from (
select '20분마다 예약 없앰' as what, (not exists (select 1 from cron.job where jobname = 'mogo-sync'))::text as ok
union all select '밤 23시 예약(한국 시간 · 5분마다 12번)', exists (select 1 from cron.job where jobname = 'mogo-sync-night' and schedule = '*/5 14 * * *')::text
union all select '밤 쉬기 없음 · 재원 학생 모두', (position('01:00' in pg_get_functiondef('public.mogo_due(timestamptz, integer)'::regprocedure)) = 0)::text
union all select '오늘 밤 받을 학생 ' || (select count(*) from public.students s where not s.archived and btrim(coalesce(s.name, '')) <> '') || '명', 'true'
) x
union all
select '092' as part, x.what::text, x.ok::text from (
select '과제 독려(학부모) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 독려\(학부모\) [0-9]{1,2}$') || '개' as what,
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학부모\) [0-9]{1,2}$')::text as ok
union all select '과제 칭찬(학부모) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학부모\) [0-9]{1,2}$') || '개',
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학부모\) [0-9]{1,2}$')::text
union all select '예전 학부모 독려 기본 글 없음', (not exists (select 1 from public.sms_templates where btrim(title) = '과제 독려(학부모)' and btrim(body) in (
            '[마라톤국어] {학생이름} 학생의 이번 주 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.',
            '[마라톤국어] {학생이름} 학생의 지난 수업 이후 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.')))::text
union all select '학부모 문구 번호 함수', exists (select 1 from pg_proc where proname = 'hw_tpl_mark_pa')::text
union all select '발송 이력에 학부모 번호(pno)', (position('pno' in pg_get_functiondef('public.hw_msg_history(date, date)'::regprocedure)) > 0)::text
union all (select '사람이 고친 예전 글 그대로: ' || title, 'true' from public.sms_templates where btrim(title) = '과제 독려(학부모)')
) x
union all
select '093' as part, x.what::text, x.ok::text from (
select '게임 프로필 칸(student_game)' as what, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'student_game')::text as ok
union all select '캐릭터 읽기 · 저장 함수', (exists (select 1 from pg_proc where proname = 'hub_profile') and exists (select 1 from pg_proc where proname = 'hub_profile_save'))::text
union all select '게임 프로필 — 직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_game' and not ('authenticated' = any(roles))))::text
union all select '얼굴 사진 — 직원만 읽음(공개 주소 없음)', (not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_profile' and not ('authenticated' = any(roles))))::text
union all select '코치룸 사진 올리기 · 지우기(face_staff_save)', exists (select 1 from pg_proc where proname = 'face_staff_save')::text
union all select '학생 화면에 사진 안 감(me_info_get)', (position('''photo'', null' in pg_get_functiondef('public.me_info_get(text)'::regprocedure)) > 0)::text
union all select '학부모 링크는 사진 칸 없음(hub_face)', ((public.hub_face('xxxxxxxxxxxxxxxxxxxxxxxx') ->> 'can') = 'false')::text
union all select '사진 동의 날짜 · 올린 사람 칸', ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'student_profile' and column_name in ('consent_at', 'photo_by')) = 2)::text
union all select '동의 체크 없이는 안 올라감(직원 · 학생)', (exists (select 1 from pg_proc where proname = 'face_staff_save' and pronargs = 4) and exists (select 1 from pg_proc where proname = 'me_photo_save' and pronargs = 4)
                                                     and not exists (select 1 from pg_proc where proname = 'face_staff_save' and pronargs = 3))::text
) x;
