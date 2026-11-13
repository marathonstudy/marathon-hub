-- ============================================================
--  migration-110-finish-cert.sql — 20261114a · 완주증 (1년 완주증 · 이달의 완주증) · 106 ~ 109 다음 · 여러 번 실행해도 됨
--  1. 옛 기록 먼저 받기 — 종강이 가까운 반(종강일이 오늘 7일 전 ~ 21일 뒤) 학생을 다른 학생보다 먼저 (app_old_due2 다시 정의 · 밤에도 · 분당 28회는 함수가 지킴)
--  2. 목동반 · 반포반 개강일 · 종강일 (2026-01-03 ~ 2026-11-14 · 2026-01-04 ~ 2026-11-15) — 반 관리 → 수업 설정 「종강일」과 같은 칸(classes.end_on · first_lesson)
--  3. finish_certs — 직원이 고른 칭호 · 하이라이트 · 선생님 한마디 · 확정 · 러닝노트 공개(1년판) · 공개할 때의 완주증 내용(snap)
--     학생 정보는 이 표와 기존 표에만 있다(파일로 남기지 않음) · 전화번호 · 사진 · 상담 · 점수 · 등수는 넣지 않는다
--  4. finish_class(반, 종류, 기간 열쇠) — 직원만 · 그 반 학생마다 앱 기록(data · old) · 옛 기록 받은 달 · 캐릭터 · 저장된 고르기
--     finish_save(row) — 직원만 · 칭호 · 하이라이트 · 한마디 · 확정 · 공개
--     hub_finish(p_code) — 러닝노트 · 그 학생 것만 · 공개된 1년판 snap · 이달판 한마디(있으면)
--  문자 · 알림톡 자동 발송 없음
-- ============================================================

/* ---------- 1. 옛 기록 먼저 — 종강이 가까운 반 학생 먼저 (같으면 예전 순서: 오래 안 물어본 학생부터) ---------- */
create or replace function public.app_old_due2(p_limit integer default 40)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'uid', z.uid, 'start', z.start_on, 'month', z.old_month) order by z.pri desc, z.ord nulls first, z.id), '[]'::jsonb)
    from (
      select s.id, l.app_user_id uid, s.start_on, r.old_month, r.old_try ord,
             (exists (select 1 from public.classes c
                       where (c.name = s.class_name or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = c.name))
                         and c.end_on between (now() at time zone 'Asia/Seoul')::date - 7 and (now() at time zone 'Asia/Seoul')::date + 21))::int pri
        from public.students s
        join public.student_links l on l.student_id = s.id and l.app_user_id is not null
        left join public.app_records r on r.student_id = s.id
       where not s.archived
         and r.old_at is null
         and (coalesce(r.old_fails, 0) = 0 or r.old_try is null
              or r.old_try < now() - case when r.old_fails <= 1 then interval '10 minutes'
                                          else least(interval '6 hours', interval '30 minutes' * power(2, least(r.old_fails, 8) - 2)) end)
       order by 6 desc, r.old_try nulls first, s.id
       limit greatest(1, least(100, coalesce(p_limit, 40)))
    ) z;
$$;
revoke all on function public.app_old_due2(integer) from public, anon, authenticated;
grant execute on function public.app_old_due2(integer) to service_role;

/* ---------- 2. 목동반 · 반포반 개강일 · 종강일 (보관 · 온라인 반 빼고 · 이름에 목동 / 반포가 있는 반) ---------- */
update public.classes set first_lesson = '2026-01-03', end_on = '2026-11-14'
 where name like '%목동%' and not coalesce(archived, false);
update public.classes set first_lesson = '2026-01-04', end_on = '2026-11-15'
 where name like '%반포%' and not coalesce(archived, false);

/* ---------- 3. 완주증 표 ---------- */
create table if not exists public.finish_certs (
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null check (kind in ('year', 'month')),
  pkey       text not null,                          -- 1년: '2026-01-03~2026-11-14' · 이달: '2026-10'
  class_name text not null default '',
  title_key  text not null default '',               -- 고른 칭호(비면 자동)
  hl_keys    jsonb not null default '[]'::jsonb,     -- 고른 하이라이트 열쇠(비면 자동 3개 · ['-'] 은 모두 뺌)
  note       text not null default '',               -- 선생님 한마디
  note_ok    boolean not null default false,         -- [확정] — 확정해야 인쇄 · 링크에 들어감
  published  boolean not null default false,         -- 1년판 [러닝노트에 공개]
  snap       jsonb,                                  -- 공개할 때의 완주증 내용(칭호 · 하이라이트 글 · 흐름 · 캐릭터 · 레벨 · 한마디) — 러닝노트가 그대로 보임
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (student_id, kind, pkey)
);
alter table public.finish_certs enable row level security;
revoke all on public.finish_certs from public, anon, authenticated;
grant select, insert, update, delete on public.finish_certs to service_role;

/* ---------- 4. 반 학생 + 기록 (직원만) ---------- */
create or replace function public.finish_class(p_class text, p_kind text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'class', s.class_name, 'start', s.start_on,
           'data', r.data, 'old', r.old, 'old_at', r.old_at, 'old_status', coalesce(r.old_status, ''),
           'old_parts', (select coalesce(jsonb_agg(to_char(p.month, 'YYYY-MM') order by p.month), '[]'::jsonb) from public.app_old_parts p where p.student_id = s.id),
           'linked', l.app_user_id is not null,
           'game', (select jsonb_build_object('char', g.char, 'frame', g.frame, 'prop', g.prop) from public.student_game g where g.student_id = s.id),
           'cert', (select to_jsonb(f) - 'student_id' from public.finish_certs f where f.student_id = s.id and f.kind = p_kind and f.pkey = p_key)
         ) order by s.name), '[]'::jsonb)
    into out
    from public.students s
    left join public.app_records r on r.student_id = s.id
    left join public.student_links l on l.student_id = s.id
   where not s.archived
     and (s.class_name = p_class or exists (select 1 from public.class_members m where m.student_id = s.id and m.class_name = p_class));
  return out;
end;
$$;
revoke all on function public.finish_class(text, text, text) from public, anon;
grant execute on function public.finish_class(text, text, text) to authenticated;

create or replace function public.finish_save(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; k text; pk text; who text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_row ->> 'student', '') !~ '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  sid := (p_row ->> 'student')::uuid;
  k := p_row ->> 'kind';
  pk := left(coalesce(p_row ->> 'pkey', ''), 40);
  if k not in ('year', 'month') or pk = '' then return jsonb_build_object('ok', false, 'reason', 'input'); end if;
  who := coalesce(nullif(auth.jwt() ->> 'email', ''), '');
  insert into public.finish_certs (student_id, kind, pkey) values (sid, k, pk) on conflict do nothing;
  update public.finish_certs set
      class_name = case when p_row ? 'class' then left(coalesce(p_row ->> 'class', ''), 60) else class_name end,
      title_key  = case when p_row ? 'title' then left(coalesce(p_row ->> 'title', ''), 40) else title_key end,
      hl_keys    = case when p_row ? 'hls' and jsonb_typeof(p_row -> 'hls') = 'array' then p_row -> 'hls' else hl_keys end,
      note       = case when p_row ? 'note' then left(coalesce(p_row ->> 'note', ''), 400) else note end,
      note_ok    = case when p_row ? 'note_ok' then coalesce((p_row ->> 'note_ok')::boolean, false) when p_row ? 'note' then false else note_ok end,
      published  = case when p_row ? 'published' then coalesce((p_row ->> 'published')::boolean, false) else published end,
      snap       = case when p_row ? 'snap' and jsonb_typeof(p_row -> 'snap') = 'object' then p_row -> 'snap' when p_row ? 'snap' then null else snap end,
      updated_by = who, updated_at = now()
   where student_id = sid and kind = k and pkey = pk;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.finish_save(jsonb) from public, anon;
grant execute on function public.finish_save(jsonb) to authenticated;

/* ---------- 러닝노트 — 그 학생 것만 (공개된 1년판 snap · 이달판 한마디) ---------- */
create or replace function public.hub_finish(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; sid uuid;
begin
  select * into s from public._hub_student(p_code);
  if not found or s.archived then return jsonb_build_object('ok', false); end if;
  sid := s.id;
  return jsonb_build_object('ok', true,
    'year', coalesce((select jsonb_agg(jsonb_build_object('pkey', f.pkey, 'snap', f.snap, 'at', f.updated_at) order by f.pkey desc)
                        from public.finish_certs f where f.student_id = sid and f.kind = 'year' and f.published and f.note_ok and f.snap is not null), '[]'::jsonb),
    'month', coalesce((select jsonb_agg(jsonb_build_object('pkey', f.pkey, 'note', f.note, 'title', f.title_key, 'hls', f.hl_keys) order by f.pkey desc)
                         from public.finish_certs f where f.student_id = sid and f.kind = 'month' and f.note_ok), '[]'::jsonb));
end;
$$;
revoke all on function public.hub_finish(text) from public;
grant execute on function public.hub_finish(text) to anon, authenticated;

-- 확인 (모두 true 여야 함 · 반 이름은 학생 정보가 아님)
select '옛 기록 — 종강 가까운 반 먼저(app_old_due2)' as what, (position('pri' in pg_get_functiondef('public.app_old_due2(integer)'::regprocedure)) > 0)::text as ok
union all select '목동반 종강일 2026-11-14 · 개강일 2026-01-03', (exists (select 1 from public.classes where name like '%목동%' and end_on = '2026-11-14' and first_lesson = '2026-01-03'))::text
union all select '반포반 종강일 2026-11-15 · 개강일 2026-01-04', (exists (select 1 from public.classes where name like '%반포%' and end_on = '2026-11-15' and first_lesson = '2026-01-04'))::text
union all select '완주증 표 · 함수(finish_certs · finish_class · finish_save · hub_finish)',
  (to_regclass('public.finish_certs') is not null and to_regprocedure('public.finish_class(text,text,text)') is not null
   and to_regprocedure('public.finish_save(jsonb)') is not null and to_regprocedure('public.hub_finish(text)') is not null)::text;
