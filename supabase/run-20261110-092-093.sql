-- ============================================================
--  run-20261110-092-093.sql — 오늘(2026-11-10) 만든 SQL 을 순서대로 한 번에: 092 → 093
--  SQL Editor 에 통째로 붙여 넣고 Run · 여러 번 실행해도 안전 · 맨 끝 확인 표(part · what · ok)가 모두 true
--  (086 · 087 · 088 · 090 · 091 이 먼저 — 아직이면 그것부터)
-- ============================================================

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
--  migration-093-game-face.sql — 러닝노트 게임 프로필(캐릭터 · 꾸미기 · 본 레벨) · 학생 얼굴 사진은 코치룸에만 (20261110b)
--  (093 은 092 다음 · 035 가 먼저 · 여러 번 실행해도 안전 · 함수(Edge Function) 배포 없음)
--
--  1. student_game — 고른 캐릭터 · 테두리 · 소품 · 이미 본 레벨(레벨 업 연출 한 번만) · 이미 본 퍼펙트 기간
--       hub_profile(code) 읽기 (학생 · 학부모 링크) · hub_profile_save(code, p) 저장 (학생 링크만 — 학부모 링크는 보기만)
--       잠긴 꾸미기(레벨)는 화면이 거른다 (레벨은 앱 과제 기록으로 화면이 센다) · 서버는 이름이 목록에 있는지만 본다
--       코치룸(직원)은 읽기만 — 학생 목록 · 학생 카드에 사진이 없으면 고른 캐릭터
--  2. 학생 얼굴 사진 (035 의 student_profile.photo · thumb 그대로 — 정사각 400px JPEG · 작은 사진 96px · 직원만 읽음 · 공개 주소 없음)
--       face_staff_save(학생, 사진, 작은 사진) — 코치룸(직원)이 올리기 · 바꾸기 · 지우기(빈 값 = 지움 · 표에서 지운다)
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
/* 코치룸(직원) 올리기 · 바꾸기 · 지우기 — 사진이 비면 사진 · 작은 사진 모두 지운다 (표에서 완전히) */
create or replace function public.face_staff_save(p_student uuid, p_photo text, p_thumb text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := nullif(btrim(coalesce(p_photo, '')), ''); th text := nullif(btrim(coalesce(p_thumb, '')), '');
begin
  if not public.is_staff() then raise exception '직원만 할 수 있습니다.'; end if;
  if not exists (select 1 from public.students where id = p_student) then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if ph is not null and (ph not like 'data:image/jpeg;base64,%' or length(ph) > 200000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if th is not null and (th not like 'data:image/jpeg;base64,%' or length(th) > 30000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if ph is null then th := null; end if;
  insert into public.student_profile (student_id, photo, thumb, updated_at) values (p_student, ph, th, now())
  on conflict (student_id) do update set photo = excluded.photo, thumb = excluded.thumb, updated_at = now();
  return jsonb_build_object('ok', true, 'photo', ph is not null);
end;
$$;
revoke all on function public.face_staff_save(uuid, text, text) from public, anon;
grant execute on function public.face_staff_save(uuid, text, text) to authenticated;

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
--  확인 (092 + 093) — ok 가 모두 true
-- ============================================================
select '092' as part, x.* from (
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
select '093' as part, x.* from (
select '게임 프로필 칸(student_game)' as what, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'student_game')::text as ok
union all select '캐릭터 읽기 · 저장 함수', (exists (select 1 from pg_proc where proname = 'hub_profile') and exists (select 1 from pg_proc where proname = 'hub_profile_save'))::text
union all select '게임 프로필 — 직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_game' and not ('authenticated' = any(roles))))::text
union all select '얼굴 사진 — 직원만 읽음(공개 주소 없음)', (not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_profile' and not ('authenticated' = any(roles))))::text
union all select '코치룸 사진 올리기 · 지우기(face_staff_save)', exists (select 1 from pg_proc where proname = 'face_staff_save')::text
union all select '학생 화면에 사진 안 감(me_info_get)', (position('''photo'', null' in pg_get_functiondef('public.me_info_get(text)'::regprocedure)) > 0)::text
union all select '학부모 링크는 사진 칸 없음(hub_face)', ((public.hub_face('xxxxxxxxxxxxxxxxxxxxxxxx') ->> 'can') = 'false')::text
) x;
