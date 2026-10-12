-- ============================================================
--  마라톤국어 허브 — Supabase 스키마 (전체)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run.  이 파일 하나면 끝난다.
--
--  여러 번 실행해도 안전하다 (있으면 건너뛰고, 함수·정책은 새로 만든다).
--  자료는 지우지 않는다.
--
--  지키는 규칙
--    1. 모든 표에 RLS 를 켠다.
--    2. 표를 읽고 쓰는 것은 staff 표에 이메일이 등록된 선생님·조교뿐이다.
--       (로그인만 했다고 되지 않는다. 가입이 실수로 켜져 있어도 막힌다.)
--    3. 학생·학부모 화면(/me/, /notice/)은 표를 직접 읽지 않는다.
--       맨 아래 '공개 함수' 만 부를 수 있고, 함수는 그 학생 것만 돌려준다.
--       연락처·호칭·메모 칸은 함수가 절대 돌려주지 않는다.
--    4. 브라우저에는 publishable key 만 넣는다.
--       secret key · service_role key 는 어디에도 넣지 않는다.
-- ============================================================


-- ------------------------------------------------------------
--  0. 공통 — updated_at 자동 갱신
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ------------------------------------------------------------
--  1. staff — 생성기를 쓸 수 있는 사람 (선생님·조교)
--
--     Authentication 에서 계정을 만든 뒤, 그 이메일을 여기에 한 줄 넣어야
--     생성기가 열린다. 넣는 방법은 README 의 '조교 계정 등록' 에 있다.
--     이 표는 화면에서 고칠 수 없다. SQL Editor 에서만 고친다.
-- ------------------------------------------------------------
create table if not exists public.staff (
  email       text primary key,
  name        text not null default '',
  role        text not null default 'assistant',    -- teacher | assistant
  created_at  timestamptz not null default now(),

  constraint staff_email_lower check (email = lower(btrim(email))),
  constraint staff_role_check  check (role in ('teacher', 'assistant'))
);

/* 지금 로그인한 사람이 staff 에 있는가.
   RLS 정책이 모두 이 함수를 쓴다. */
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;


-- ------------------------------------------------------------
--  2. students — 학생 명단
--     연락처는 여기에만 있다. 공개 함수는 이 칸들을 돌려주지 않는다.
--     archived = 퇴원. 퇴원하면 개인 링크가 열리지 않는다.
-- ------------------------------------------------------------
create table if not exists public.students (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  school         text not null default '',
  grade          text not null default '',
  class_name     text not null default '',
  parent_title   text not null default '',         -- 어머님 / 아버님 …
  parent_phone   text not null default '',         -- 학부모 번호 (숫자만)
  student_phone  text not null default '',         -- 학생 본인 번호 (숫자만)
  extra          jsonb not null default '{}'::jsonb,
  archived       boolean not null default false,   -- 퇴원
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint students_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists students_class_idx    on public.students (class_name);
create index if not exists students_archived_idx on public.students (archived);

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  3. student_links — 개인 링크 코드 · 앱 공유 코드
--
--     students 와 따로 둔다. 명단 저장은 학생 줄을 통째로 덮어쓰는데,
--     다른 기기에 남아 있던 옛 명단이 저장되면서 코드를 빈 값으로
--     덮는 사고를 막기 위함이다. 이 표는 한 줄씩 직접 저장한다.
--
--     hub_code        개인 페이지 주소 /me/#코드  (24자 랜덤)
--     app_share_code  마라톤 앱 학습 리포트 공유 코드 (월마다 바뀔 수 있다)
-- ------------------------------------------------------------
create table if not exists public.student_links (
  student_id          uuid primary key references public.students(id) on delete cascade,
  hub_code            text,
  app_share_code      text not null default '',
  hub_issued_at       timestamptz,
  app_code_updated_at timestamptz,
  updated_at          timestamptz not null default now(),

  constraint student_links_hub_format check (hub_code is null or hub_code ~ '^[A-Za-z0-9]{20,64}$'),
  constraint student_links_app_format check (app_share_code = '' or app_share_code ~ '^[A-Za-z0-9_-]{8,128}$')
);

create unique index if not exists student_links_hub_key on public.student_links (hub_code);

drop trigger if exists student_links_touch on public.student_links;
create trigger student_links_touch before update on public.student_links
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  4. field_defs — 내가 이름 짓는 칸의 '정의'
--     scope  student → 값은 students.extra / class → 값은 class_info.extra
-- ------------------------------------------------------------
create table if not exists public.field_defs (
  id            uuid primary key default gen_random_uuid(),
  key           text not null,
  label         text not null,
  type          text not null default 'text',
  options       jsonb not null default '[]'::jsonb,
  scope         text not null default 'student',
  show_in_table boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint field_defs_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint field_defs_type_check
    check (type in ('text','textarea','number','select','date','checkbox')),
  constraint field_defs_scope_check check (scope in ('student','class'))
);

create unique index if not exists field_defs_key_key on public.field_defs (key);


-- ------------------------------------------------------------
--  5. class_info — 반마다 적어 둔 값 (반 현황). 반 이름이 열쇠다.
-- ------------------------------------------------------------
create table if not exists public.class_info (
  class_name  text primary key,
  extra       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),

  constraint class_info_name_not_blank check (length(btrim(class_name)) > 0)
);


-- ------------------------------------------------------------
--  6. week_meta — 주차 종료일 (주차마다 한 줄)
-- ------------------------------------------------------------
create table if not exists public.week_meta (
  week_start  date primary key,
  week_end    date not null,
  updated_at  timestamptz not null default now(),

  constraint week_meta_order check (week_end >= week_start)
);

drop trigger if exists week_meta_touch on public.week_meta;
create trigger week_meta_touch before update on public.week_meta
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  7. week_common — 반 공통 (그 주, 그 반의 수업 내용·테스트·과제·코멘트)
-- ------------------------------------------------------------
create table if not exists public.week_common (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  class_name  text not null,
  lessons     jsonb not null default '[]'::jsonb,  -- ["1차시 내용", …]
  tests       jsonb not null default '[]'::jsonb,  -- ["문법 리뷰테스트", …]
  homework    jsonb not null default '[]'::jsonb,  -- [{key,group,name}]
  comment     text  not null default '',           -- 반 공통 코멘트
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists week_common_key on public.week_common (week_start, class_name);

drop trigger if exists week_common_touch on public.week_common;
create trigger week_common_touch before update on public.week_common
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  8. entries — 학생별 주간 입력
-- ------------------------------------------------------------
create table if not exists public.entries (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null,
  student_id     uuid not null references public.students(id) on delete cascade,
  attend_status  text not null default '',           -- attend|late|absent|makeup
  attend_note    text not null default '',
  focus_score    smallint not null default 0,
  scores         jsonb not null default '{}'::jsonb, -- {"0":95,"1":88}
  homework       jsonb not null default '{}'::jsonb, -- {"h1":{"월":true}}
  on_time_rate   smallint not null default 100,
  comment        text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint entries_status_check check (attend_status in ('','attend','late','absent','makeup')),
  constraint entries_focus_check  check (focus_score between 0 and 5),
  constraint entries_ontime_check check (on_time_rate between 0 and 100)
);

create unique index if not exists entries_week_student_key on public.entries (week_start, student_id);
create index        if not exists entries_week_idx         on public.entries (week_start);

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  9. published — 학부모에게 공개한 레포트
--
--     깃허브에 파일을 올리지 않는다. 공개하는 순간의 레포트 내용을
--     report_data 에 고정해 둔다. 작성 내용을 나중에 고쳐도
--     다시 공개하기 전까지 학부모 화면은 바뀌지 않는다.
--     visible = false 면 개인 페이지에서 보이지 않는다 (공개 취소).
-- ------------------------------------------------------------
create table if not exists public.published (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  student_id    uuid not null references public.students(id) on delete cascade,
  report_data   jsonb not null default '{}'::jsonb,
  visible       boolean not null default true,
  published_by  text not null default '',
  published_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists published_week_student_key on public.published (week_start, student_id);
create index        if not exists published_student_idx      on public.published (student_id);

drop trigger if exists published_touch on public.published;
create trigger published_touch before update on public.published
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  10. sent — 보냄 표시 (주차별)
-- ------------------------------------------------------------
create table if not exists public.sent (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  via         text not null default 'copy',        -- sms | copy | share | kakao
  sent_by     text not null default '',
  sent_at     timestamptz not null default now(),

  constraint sent_via_check check (via in ('sms','copy','share','kakao'))
);

create unique index if not exists sent_week_student_key on public.sent (week_start, student_id);


-- ------------------------------------------------------------
--  11. snippets — 코멘트 상용구
-- ------------------------------------------------------------
create table if not exists public.snippets (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint snippets_not_blank check (length(btrim(text)) > 0)
);


-- ------------------------------------------------------------
--  12. app_settings — 함께 쓰는 설정 (인사말 등)
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value)
values (
  'greeting',
  jsonb_build_object(
    'sms',   E'안녕하세요 {호칭}, 마라톤국어입니다. 이번 주 {이름} 학생 레포트 보내드립니다^^\n{링크}',
    'kakao', E'안녕하세요 {호칭}, 마라톤국어입니다. 이번 주 {이름} 학생 레포트 보내드립니다^^\n{링크}'
  )
)
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  13. class_notices — 반 공지 (주차마다 한 줄, 지우지 않고 쌓인다)
--
--     여러 반에 한 번에 올리면 그 줄들이 같은 bundle_id 를 갖는다.
--     묶음을 고치면 묶인 반이 전부 같이 바뀐다.
--     '이 반만 따로' 를 누르면 그 줄에 새 bundle_id 를 준다.
--
--     materials  [{"name":"3주차 문학 자료","url":"https://…"}]
--     videos     [{"title":"문학 다시보기","url":"https://youtu.be/…"}]
-- ------------------------------------------------------------
create table if not exists public.class_notices (
  id          uuid primary key default gen_random_uuid(),
  bundle_id   uuid not null default gen_random_uuid(),
  class_name  text not null,
  week_start  date not null,
  title       text  not null default '',
  curriculum  text  not null default '',
  literature  text  not null default '',
  reading     text  not null default '',
  homework    text  not null default '',
  notes       text  not null default '',
  special     text  not null default '',
  materials   jsonb not null default '[]'::jsonb,
  videos      jsonb not null default '[]'::jsonb,
  visible     boolean not null default true,
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint class_notices_class_not_blank check (length(btrim(class_name)) > 0)
);

create unique index if not exists class_notices_class_week_key on public.class_notices (class_name, week_start);
create index        if not exists class_notices_bundle_idx     on public.class_notices (bundle_id);

drop trigger if exists class_notices_touch on public.class_notices;
create trigger class_notices_touch before update on public.class_notices
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  14. class_codes — 반 공용 공지 페이지 주소 /notice/#코드
--      반 이름이 한글이라 주소에 그대로 쓰지 않고 랜덤 코드를 준다.
-- ------------------------------------------------------------
create table if not exists public.class_codes (
  class_name  text primary key,
  code        text not null,
  created_at  timestamptz not null default now(),

  constraint class_codes_format check (code ~ '^[A-Za-z0-9]{16,64}$')
);

create unique index if not exists class_codes_code_key on public.class_codes (code);


-- ============================================================
--  RLS — staff 에 등록된 사람만 읽고 쓴다
--
--  anon(비로그인) 에게는 정책을 하나도 주지 않으므로 표가 전부 막힌다.
--  로그인했더라도 staff 에 없는 계정은 막힌다.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'students','student_links','field_defs','class_info','week_meta','week_common',
    'entries','published','sent','snippets','app_settings','class_notices','class_codes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_staff_all', t
    );
  end loop;
end;
$$;

/* staff 표 — 자기 줄이 있는지만 볼 수 있다. 쓰기 정책은 없다(SQL Editor 에서만). */
alter table public.staff enable row level security;
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff
  for select to authenticated using (public.is_staff());


-- ============================================================
--  공개 함수 — 학생·학부모 화면이 부르는 것은 이것뿐이다
--
--  security definer : 함수 안에서만 표를 읽는다. 부르는 사람은 표를 못 본다.
--  코드가 형식에 안 맞으면 표를 보기도 전에 돌려보낸다.
--  돌려주는 것: 이름 · 학교 · 학년 · 반 · 공지 · 공개한 레포트 · 앱 공유 코드
--  돌려주지 않는 것: 연락처 · 호칭 · 메모(extra) · 작성 중인 입력 · 다른 학생
-- ============================================================

/* 코드로 학생 한 명을 찾는다 (함수들끼리만 쓴다) */
create or replace function public._hub_student(p_code text)
returns table (id uuid, name text, school text, grade text, class_name text,
               archived boolean, app_share_code text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.school, s.grade, s.class_name, s.archived, l.app_share_code
  from public.student_links l
  join public.students s on s.id = l.student_id
  where p_code ~ '^[A-Za-z0-9]{20,64}$'
    and l.hub_code = p_code
  limit 1;
$$;

/* 한 반의 공지 목록 (최근 52주, 최신순) → 화면에 보낼 모양 */
create or replace function public._notices_of(p_class text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start', n.week_start,
           'week_end',   m.week_end,
           'title',      n.title,
           'curriculum', n.curriculum,
           'literature', n.literature,
           'reading',    n.reading,
           'homework',   n.homework,
           'notes',      n.notes,
           'special',    n.special,
           'materials',  n.materials,
           'videos',     n.videos,
           'updated_at', n.updated_at
         ) order by n.week_start desc), '[]'::jsonb)
  from (
    select * from public.class_notices
    where class_name = p_class and visible and btrim(p_class) <> ''
    order by week_start desc
    limit 52
  ) n
  left join public.week_meta m on m.week_start = n.week_start;
$$;

/* 개인 페이지 /me/#코드 — 한 번에 필요한 것 전부 */
create or replace function public.hub_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public._hub_student(p_code);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if s.archived then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'name', s.name, 'school', s.school, 'grade', s.grade, 'class_name', s.class_name
    ),
    'notices', public._notices_of(s.class_name),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week_start',   p.week_start,
               'week_end',     coalesce(p.report_data ->> 'endDate', ''),
               'published_at', p.published_at
             ) order by p.week_start desc)
      from public.published p
      where p.student_id = s.id and p.visible
    ), '[]'::jsonb),
    'app', jsonb_build_object(
      'linked', s.app_share_code <> '',
      'share_url', case when s.app_share_code <> ''
                        then 'https://marathonstudy.com/share/report/' || s.app_share_code
                        else '' end
    )
  );
end;
$$;

/* 레포트 한 편 (공개한 것만) */
create or replace function public.hub_report(p_code text, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  d jsonb;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then
    return null;
  end if;
  select p.report_data || jsonb_build_object('publishedAt', p.published_at)
    into d
  from public.published p
  where p.student_id = s.id and p.week_start = p_week and p.visible;
  return d;
end;
$$;

/* Edge Function(app-report) 이 쓴다. 퇴원 학생이면 빈 값 */
create or replace function public.hub_app_code(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived or s.app_share_code = '' then
    return null;
  end if;
  return s.app_share_code;
end;
$$;

/* 반 공용 페이지 /notice/#반코드 — 공지만. 학생 정보는 하나도 없다 */
create or replace function public.class_notice_get(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{16,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  select class_name into c from public.class_codes where code = p_code;
  if c is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_name', c,
    'notices', public._notices_of(c)
  );
end;
$$;

/* 실행 권한 정리
   - 공개 함수 4개: 누구나(anon) 부를 수 있다
   - 내부 함수(_로 시작): 아무도 직접 못 부른다 */
revoke all on function public._hub_student(text)              from public, anon, authenticated;
revoke all on function public._notices_of(text)               from public, anon, authenticated;

revoke all on function public.hub_get(text)            from public;
revoke all on function public.hub_report(text, date)   from public;
revoke all on function public.hub_app_code(text)       from public;
revoke all on function public.class_notice_get(text)   from public;
grant execute on function public.hub_get(text)          to anon, authenticated;
grant execute on function public.hub_report(text, date) to anon, authenticated;
grant execute on function public.hub_app_code(text)     to anon, authenticated;
grant execute on function public.class_notice_get(text) to anon, authenticated;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;


-- ============================================================
--  확인 — 아래 결과를 눈으로 본다
-- ============================================================

-- (1) 표 14개가 전부 rls_enabled = true 여야 한다
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;

-- (2) staff 에 등록된 사람 (처음에는 0줄. README 를 보고 넣는다)
select email, name, role from public.staff order by created_at;
