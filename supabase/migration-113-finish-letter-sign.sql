-- ============================================================
--  migration-113-finish-letter-sign.sql — 20261114h · 110 다음 · 여러 번 실행해도 됨
--  1. 원장님 서명 — Storage 비공개 버킷 staff-private (signature.png 는 원장님이 직접 올림 · 저장소(GitHub)에는 없음)
--     읽기는 운영진(public.is_staff())만 · 코치룸이 짧은 시간 유효한 signed URL 로 불러온다
--     올리기 · 바꾸기 · 지우기 정책은 만들지 않는다 → Supabase 대시보드(Storage)에서만
--  2. 1년 완주증 「선생님의 편지」 — 한마디가 길어져도 되게 finish_save 의 한마디 길이 400자 → 3000자
--  문자 · 알림톡 · 링크 발송은 건드리지 않는다
-- ============================================================

-- 1) 버킷 — 없으면 만들고, 있으면 비공개로 둔다
insert into storage.buckets (id, name, public)
values ('staff-private', 'staff-private', false)
on conflict (id) do update set public = false;

drop policy if exists staff_private_read on storage.objects;
create policy staff_private_read on storage.objects for select to authenticated
  using (bucket_id = 'staff-private' and public.is_staff());

-- 2) 한마디 3000자까지
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
      note       = case when p_row ? 'note' then left(coalesce(p_row ->> 'note', ''), 3000) else note end,           /* 20261114h — 편지 쪽 · 400 → 3000 */
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

-- 확인 (모두 true 여야 함)
select '서명 버킷 staff-private 비공개' as what, exists (select 1 from storage.buckets where id = 'staff-private' and not public)::text as ok
union all select '서명 읽기 — 운영진만(staff_private_read)', exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff_private_read' and cmd = 'SELECT')::text
union all select '서명 올리기 · 지우기 정책 없음(대시보드에서만)', (not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT' and coalesce(qual, '') || coalesce(with_check, '') like '%staff-private%'))::text
union all select '편지 — 한마디 3000자(finish_save)', (select prosrc like '%3000%' from pg_proc where oid = to_regprocedure('public.finish_save(jsonb)'))::text;
