-- ============================================================
--  마라톤 코치룸 — 잘못 「면제」로 바꾼 과제 칸 되돌리기 · 사유를 상담 기록으로 옮기기 (fix-exempt-to-notes.sql · 20261101r)
--
--  ⚠ 바로 실행하지 말고 먼저 이 순서대로:
--    1. check-exempt-notes.sql 을 실행해 목록(학생 · 날짜 · 바꾼 사람 · 사유)을 본다.
--    2. 되돌릴 칸의 id 를 아래 「되돌릴 목록」 주석에 적고, 바로 아래 ids 배열에도 같은 id 를 넣는다.
--       (지금은 배열이 비어 있어 실행해도 아무것도 바뀌지 않는다)
--    3. migration-061 을 먼저 실행해 둔다 (상담 기록 분류 「과제」 · 과제 칸 날짜).
--    4. 이 파일 전체를 붙여넣고 Run — 맨 아래 결과에 되돌린 칸 · 옮긴 상담 기록이 나온다.
--
--  되돌릴 목록 (check-exempt-notes.sql 결과를 보고 적는다 — 예시 형식)
--    -- id 123 · 학생 ○○○ · 10/29(목) · 바꾼 사람 ○○ · 사유 「전화함, 다음 주부터 내기로」
--    --
--
--  하는 일 (한 칸마다)
--    · 과제 칸 — 「면제」 바로 앞 상태로 (앞에 다른 수정이 있으면 그 상태 · 없으면 앱 값 「원래대로」) — 수정 기록에 한 줄 더 (지우지 않는다)
--    · 사유 — 그 학생 상담 기록에 분류 「과제」 · 그 과제 날짜로 「10/29(목) 과제 · 면제 칸에 적었던 내용 — …」 (적은 사람 · 시각을 글에 남김)
--  같은 id 를 두 번 넣어도 한 번만 되돌린다 (이미 마지막 줄이 면제가 아니면 건너뛴다).
-- ============================================================

do $$
declare
  ids bigint[] := array[]::bigint[];     -- ← 여기에 되돌릴 id 를 넣는다. 예) array[123, 124]::bigint[]
  f record;
  prev record;
  dw text[] := array['일', '월', '화', '수', '목', '금', '토'];
  head text;
begin
  for f in select * from public.hw_fixes where id = any(ids) order by id loop
    /* 지금도 그 칸의 마지막 줄이 이 면제일 때만 */
    if f.status <> 'exempt' or f.id <> (select max(l.id) from public.hw_fixes l where l.student_id = f.student_id and l.day = f.day) then
      raise notice '건너뜀 id % — 이미 다른 상태로 바뀌었거나 면제가 아님', f.id;
      continue;
    end if;
    select p.status, p.reason into prev from public.hw_fixes p
     where p.student_id = f.student_id and p.day = f.day and p.id < f.id order by p.id desc limit 1;
    if prev.status is null or prev.status = 'app' then
      insert into public.hw_fixes (student_id, day, status, reason, app_status) values (f.student_id, f.day, 'app', '', f.app_status);
    else
      insert into public.hw_fixes (student_id, day, status, reason, app_status) values (f.student_id, f.day, prev.status, coalesce(nullif(btrim(prev.reason), ''), '면제 오입력 되돌림'), f.app_status);
    end if;
    head := extract(month from f.day)::int || '/' || extract(day from f.day)::int || '(' || dw[extract(dow from f.day)::int + 1] || ') 과제';
    insert into public.student_notes (student_id, note_date, categories, body, follow_up, hw_day)
    values (f.student_id, (f.fixed_at at time zone 'Asia/Seoul')::date, array['과제'],
            head || ' · 면제 칸에 적었던 내용 — ' || btrim(f.reason) || ' (적은 사람: ' || coalesce(nullif(f.fixed_name, ''), '?') || ' · ' ||
            to_char(f.fixed_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' · 과제 칸 면제는 되돌림)',
            false, f.day);
    raise notice '되돌림 id % · % ', f.id, head;
  end loop;
end;
$$;

-- 결과 — 넣은 id 의 칸 지금 상태 · 옮긴 상담 기록
select s.name as 학생, to_char(f.day, 'MM/DD') as 과제날짜,
       (select l.status from public.hw_fixes l where l.student_id = f.student_id and l.day = f.day order by l.id desc limit 1) as 지금상태,
       exists (select 1 from public.student_notes n where n.student_id = f.student_id and n.hw_day = f.day and n.body like '%면제 칸에 적었던 내용%' and n.deleted_at is null) as 상담기록옮김
  from public.hw_fixes f join public.students s on s.id = f.student_id
 where f.id = any(array[]::bigint[])     -- ← 위와 같은 id 를 여기에도
 order by f.day;
