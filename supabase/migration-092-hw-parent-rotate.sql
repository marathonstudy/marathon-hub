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


-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '과제 독려(학부모) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 독려\(학부모\) [0-9]{1,2}$') || '개' as what,
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 독려\(학부모\) [0-9]{1,2}$')::text as ok
union all select '과제 칭찬(학부모) 번호 문구 ' || (select count(*) from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학부모\) [0-9]{1,2}$') || '개',
       exists (select 1 from public.sms_templates where btrim(title) ~ '^과제 칭찬\(학부모\) [0-9]{1,2}$')::text
union all select '예전 학부모 독려 기본 글 없음', (not exists (select 1 from public.sms_templates where btrim(title) = '과제 독려(학부모)' and btrim(body) in (
            '[마라톤국어] {학생이름} 학생의 이번 주 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.',
            '[마라톤국어] {학생이름} 학생의 지난 수업 이후 과제 중 {밀린날짜}이 아직 제출되지 않았습니다. 확인 부탁드립니다.')))::text
union all select '학부모 문구 번호 함수', exists (select 1 from pg_proc where proname = 'hw_tpl_mark_pa')::text
union all select '발송 이력에 학부모 번호(pno)', (position('pno' in pg_get_functiondef('public.hw_msg_history(date, date)'::regprocedure)) > 0)::text
union all (select '사람이 고친 예전 글 그대로: ' || title, 'true' from public.sms_templates where btrim(title) = '과제 독려(학부모)');
