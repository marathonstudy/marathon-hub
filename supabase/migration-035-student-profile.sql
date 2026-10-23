-- ============================================================
--  마라톤 코치룸 — 학생이 직접 채우는 「내 정보」 · 얼굴 사진 (migration-035-student-profile.sql)
--
--  실행 방법
--    034 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다. 기존 학생 기록 · 상담 카드는 바꾸지 않는다 (표 하나 · 함수만 더한다).
--  Storage 설정 · 함수(Edge Function) 배포는 필요 없다.
--
--  student_profile — 학생 1명당 1줄
--    info   학생이 채우는 칸 { target 목표 대학·학과, electives 선택과목, mock 최근 모의고사 등급, academy 다니는 학원, message 하고 싶은 말 }
--           (학교 · 학년 · 학생 연락처는 students 표 그대로 — 학생이 고치면 그 칸이 바뀐다)
--    photo  얼굴 사진 (정사각 · 가로 400px JPEG 를 data: 글자로) · thumb 작은 사진 (96px · 명단 · 「오늘」용)
--           공개 주소가 없다 — 로그인한 본인(학생 링크 코드)과 코치룸(직원)만 이 표 · 함수로 읽는다. 깃허브에는 없다.
--    student_at 학생이 마지막으로 고친 때 (코치룸에 「학생이 10/24 수정」)
--  학생 화면(/s/ 로그인 → 학생 링크)만 부를 수 있는 함수 — 학부모 링크 · 반 공용 링크는 막는다
--    me_info_get(코드)            이름 · 반(바꿀 수 없음) · 학교 · 학년 · 연락처 · info · 사진
--    me_info_save(코드, 칸들)     학교 · 학년 · 연락처 · info 칸 저장 (비우면 지움) · 이름 · 반은 바꾸지 않는다
--    me_photo_save(코드, 사진, 작은 사진)   올리기 · 바꾸기 · 지우기(빈 값)
--  선생님 · 조교가 쓴 상담 기록 · 특이사항 · 성적 · 결석 기록은 이 함수들로 절대 나가지 않는다.
-- ============================================================


create table if not exists public.student_profile (
  student_id  uuid primary key references public.students(id) on delete cascade,
  info        jsonb not null default '{}'::jsonb,
  photo       text,
  thumb       text,
  student_at  timestamptz,
  updated_at  timestamptz not null default now(),

  constraint student_profile_photo_check check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) <= 200000)),
  constraint student_profile_thumb_check check (thumb is null or (thumb like 'data:image/jpeg;base64,%' and length(thumb) <= 30000))
);

alter table public.student_profile enable row level security;
drop policy if exists student_profile_staff_read on public.student_profile;
create policy student_profile_staff_read on public.student_profile for select to authenticated using (public.is_staff());
/* 쓰기는 아래 함수만 (학생 · 직원 모두) */

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_profile') then
    execute 'alter publication supabase_realtime add table public.student_profile';
  end if;
end;
$$;


/* 학생 링크 코드 → 학생 (학부모 링크 · 퇴원생은 null) */
create or replace function public._me_student(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id from public.student_links l join public.students s on s.id = l.student_id
  where p_code ~ '^[A-Za-z0-9]{20,64}$' and l.student_code = p_code and not s.archived
  limit 1;
$$;

create or replace function public.me_info_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sid uuid := public._me_student(p_code);
  s public.students;
  p public.student_profile;
begin
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'notstudent'); end if;
  select * into s from public.students where id = sid;
  select * into p from public.student_profile where student_id = sid;
  return jsonb_build_object('ok', true,
    'name', s.name, 'class_name', s.class_name, 'school', s.school, 'grade', s.grade, 'phone', s.student_phone,
    'info', coalesce(p.info, '{}'::jsonb), 'photo', p.photo, 'student_at', p.student_at);
end;
$$;

create or replace function public.me_info_save(p_code text, p_fields jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  sid uuid := public._me_student(p_code);
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  ph text;
  old_ph text;
  inf jsonb := '{}'::jsonb;
  k text;
begin
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'notstudent'); end if;
  ph := regexp_replace(coalesce(f ->> 'phone', ''), '\D', '', 'g');
  if ph <> '' and ph !~ '^01[016789]\d{7,8}$' then return jsonb_build_object('ok', false, 'reason', 'phone'); end if;
  if length(coalesce(f ->> 'school', '')) > 40 or length(coalesce(f ->> 'grade', '')) > 20 then return jsonb_build_object('ok', false, 'reason', 'long'); end if;
  foreach k in array array['target', 'electives', 'mock', 'academy', 'message'] loop
    if length(coalesce(f ->> k, '')) > (case when k = 'message' then 500 else 100 end) then return jsonb_build_object('ok', false, 'reason', 'long'); end if;
    if btrim(coalesce(f ->> k, '')) <> '' then inf := inf || jsonb_build_object(k, btrim(f ->> k)); end if;
  end loop;
  select student_phone into old_ph from public.students where id = sid;
  /* 이름 · 반은 바꾸지 않는다 (코치룸에서만) */
  update public.students set school = btrim(coalesce(f ->> 'school', '')), grade = btrim(coalesce(f ->> 'grade', '')), student_phone = ph
   where id = sid;
  insert into public.student_profile (student_id, info, student_at, updated_at) values (sid, inf, now(), now())
  on conflict (student_id) do update set info = excluded.info, student_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'phone_changed', coalesce(old_ph, '') <> ph);
end;
$$;

create or replace function public.me_photo_save(p_code text, p_photo text, p_thumb text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  sid uuid := public._me_student(p_code);
  ph text := nullif(btrim(coalesce(p_photo, '')), '');
  th text := nullif(btrim(coalesce(p_thumb, '')), '');
begin
  if sid is null then return jsonb_build_object('ok', false, 'reason', 'notstudent'); end if;
  if ph is not null and (ph not like 'data:image/jpeg;base64,%' or length(ph) > 200000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if th is not null and (th not like 'data:image/jpeg;base64,%' or length(th) > 30000) then return jsonb_build_object('ok', false, 'reason', 'photo'); end if;
  if ph is null then th := null; end if;
  insert into public.student_profile (student_id, photo, thumb, student_at, updated_at) values (sid, ph, th, now(), now())
  on conflict (student_id) do update set photo = excluded.photo, thumb = excluded.thumb, student_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'photo', ph is not null);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.me_info_get(text)', 'public.me_info_save(text, jsonb)', 'public.me_photo_save(text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  revoke all on function public._me_student(text) from public, anon, authenticated;
end;
$$;


-- ============================================================
--  확인 — 세 줄 모두 true
-- ============================================================
select 'student_profile rls' as what, (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'student_profile')::text as ok
union all select 'parent link blocked', ((public.me_info_get('xxxxxxxxxxxxxxxxxxxxxxxx') ->> 'ok') = 'false')::text
union all select 'only staff can read table', (not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_profile' and not ('authenticated' = any(roles))))::text;
