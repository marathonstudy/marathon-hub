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


-- ============================================================
--  확인 — 모두 true · 「예전 글로 남김」 줄이 있으면 원장이 고친 예전 문구 (쓰지 않음 · 필요 없으면 문구 관리에서 지운다)
-- ============================================================
select '과제 독려(학생) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$') || '개' as what,
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학생\) [0-9]{1,2}$')::text as ok
union all select '과제 칭찬(학생) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$') || '개',
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학생\) [0-9]{1,2}$')::text
union all select '문구 번호 칸(sms_log.tpl_no)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sms_log' and column_name = 'tpl_no')::text
union all select '학생별 발송 이력 함수', exists (select 1 from pg_proc where proname = 'hw_msg_history')::text
union all (select '예전 글로 남김: ' || title, 'true' from public.sms_templates where btrim(title) in ('과제 독려(학생) 예전 글', '과제 칭찬(학생) 예전 글'));
