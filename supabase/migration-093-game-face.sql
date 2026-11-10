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
--  확인 — 모두 true
-- ============================================================
select '게임 프로필 칸(student_game)' as what, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'student_game')::text as ok
union all select '캐릭터 읽기 · 저장 함수', (exists (select 1 from pg_proc where proname = 'hub_profile') and exists (select 1 from pg_proc where proname = 'hub_profile_save'))::text
union all select '게임 프로필 — 직원만 읽음', (not exists (select 1 from pg_policies where tablename = 'student_game' and not ('authenticated' = any(roles))))::text
union all select '얼굴 사진 — 직원만 읽음(공개 주소 없음)', (not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_profile' and not ('authenticated' = any(roles))))::text
union all select '코치룸 사진 올리기 · 지우기(face_staff_save)', exists (select 1 from pg_proc where proname = 'face_staff_save')::text
union all select '학생 화면에 사진 안 감(me_info_get)', (position('''photo'', null' in pg_get_functiondef('public.me_info_get(text)'::regprocedure)) > 0)::text
union all select '학부모 링크는 사진 칸 없음(hub_face)', ((public.hub_face('xxxxxxxxxxxxxxxxxxxxxxxx') ->> 'can') = 'false')::text;
