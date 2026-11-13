-- ============================================================
--  check-ability-parts-1113.sql — 확인용 (읽기만 · 아무것도 바꾸지 않음) · 20261113d · migration-108 · app-sync 다시 배포 뒤 30분쯤
--  한 표로 나온다 (SQL 편집기는 마지막 결과 하나만 보여 줘서) · 이름은 성 + 첫 글자만(나머지 ○)
--  학생마다
--    경로          — 지금 저장본을 받은 길: user 학생 기준 주소 / share 공유 코드 (user 실패 이유가 있으면 「share ← user timeout」)
--    최근 4주      — 낸 과제 중 영역 정보(parts)가 있는 것 / 없는 것 · 그중 맞힌 수가 모두 0 인 것(0점) · 정답률 칸 0 / 비어 있음
--    옛 기록       — 수강 시작 전 과제 중 영역 정보가 있는 것 / 없는 것 · 0점
--    앱 칸         — 앱이 과제 안에 보낸 칸: categoryResults 있음/없음 · 영역 칸 이름(categoryResults 안)
--    월간 채움     — 옛 기록(또는 코치룸이 셈하지 않던 달)으로 다시 센 월간 배지 달
--  맨 위 요약 — 경로별 학생 수 · 영역 정보가 있는 과제 비율
-- ============================================================
with st as (
  select s.id, s.name, s.start_on, l.app_user_id uid, r.src, coalesce(r.user_fail, '') uf, r.data, r.old, r.fetched_at
    from public.students s
    left join public.student_links l on l.student_id = s.id
    left join public.app_records r on r.student_id = s.id
   where not s.archived and r.data is not null
), cut as (select ((now() at time zone 'Asia/Seoul')::date - 27) d
), h as (
  select st.id, 'cur' w, x
    from st, jsonb_array_elements(case when jsonb_typeof(st.data -> 'history') = 'array' then st.data -> 'history' else '[]'::jsonb end) x
   where coalesce(x ->> 'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}'
     and ((x ->> 'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date >= (select d from cut)
  union all
  select st.id, 'old', x
    from st, jsonb_array_elements(case when jsonb_typeof(st.old -> 'history') = 'array' then st.old -> 'history' else '[]'::jsonb end) x
   where coalesce(x ->> 'submittedAt', '') <> ''
), hh as (
  select id, w,
         coalesce(jsonb_typeof(x -> 'parts') = 'array' and x -> 'parts' <> '[]'::jsonb, false) hp,
         coalesce(jsonb_typeof(x -> 'parts') = 'array' and x -> 'parts' <> '[]'::jsonb
          and not exists (select 1 from jsonb_array_elements(x -> 'parts') p where coalesce(p ->> 'k', '') ~ '^\d+$' and (p ->> 'k')::int > 0), false) pz,
         x ->> 'correctRate' cr
    from h
), agg as (
  select st.id,
         count(*) filter (where hh.w = 'cur' and hp) c_p, count(*) filter (where hh.w = 'cur' and not hp) c_np, count(*) filter (where hh.w = 'cur' and pz) c_z,
         count(*) filter (where hh.w = 'cur' and not hp and hh.cr = '0') c_r0, count(*) filter (where hh.w = 'cur' and not hp and hh.cr is null) c_rn,
         count(*) filter (where hh.w = 'old' and hp) o_p, count(*) filter (where hh.w = 'old' and not hp) o_np, count(*) filter (where hh.w = 'old' and pz) o_z
    from st left join hh on hh.id = st.id group by st.id
), one as (
  select st.id, st.name, st.uid, st.src, st.uf, a.c_p, a.c_np, a.c_z, a.c_r0, a.c_rn, a.o_p, a.o_np, a.o_z,
         coalesce(st.data -> 'shape' -> 'homeworkHistory', '[]'::jsonb) ? 'categoryResults' has_cr,
         coalesce((select string_agg(k, ',') from jsonb_array_elements_text(st.data -> 'shape' -> 'categoryResults') k), '') cr_keys,
         (select string_agg(f ->> 'm', ' ') from jsonb_array_elements(public._award_fill(st.id)) f) mfill
    from st join agg a on a.id = st.id
), rows as (
  select 0.0 o, '요약 — 경로' 이름,
         'user ' || count(*) filter (where src = 'user') || '명 · share ' || count(*) filter (where src = 'share') || '명 (그중 user 실패 뒤 share ' || count(*) filter (where src = 'share' and uf <> '') || '명)' 경로,
         '최근 4주 영역 정보 있음 — user ' || coalesce(sum(c_p) filter (where src = 'user'), 0) || '/' || coalesce(sum(c_p + c_np) filter (where src = 'user'), 0)
           || ' · share ' || coalesce(sum(c_p) filter (where src = 'share'), 0) || '/' || coalesce(sum(c_p + c_np) filter (where src = 'share'), 0) 최근4주,
         '옛 기록 영역 정보 있음 ' || coalesce(sum(o_p), 0) || '/' || coalesce(sum(o_p + o_np), 0) || ' · 0점 ' || coalesce(sum(o_z), 0) 옛기록,
         'categoryResults 칸이 오는 학생 — user ' || count(*) filter (where src = 'user' and has_cr) || '/' || count(*) filter (where src = 'user')
           || ' · share ' || count(*) filter (where src = 'share' and has_cr) || '/' || count(*) filter (where src = 'share') 앱칸,
         '월간 채움 있는 학생 ' || count(*) filter (where mfill is not null) || '명' 월간채움
    from one
  union all
  select 1 + row_number() over (order by src, name) * 0.001,
         case when char_length(name) >= 3 then left(name, 2) || repeat('○', char_length(name) - 2) when char_length(name) = 2 then left(name, 1) || '○' else '○' end,
         coalesce(src, '-') || case when src = 'share' and uf <> '' then ' ← user ' || uf else '' end || case when uid is null then ' · 앱 id 없음' else '' end,
         '영역 있음 ' || c_p || ' · 없음 ' || c_np || case when c_z > 0 then ' · 0점 ' || c_z else '' end
           || case when c_np > 0 then ' (정답률 0 ' || c_r0 || ' · 비어 ' || c_rn || ')' else '' end,
         case when o_p + o_np = 0 then '-' else '영역 있음 ' || o_p || ' · 없음 ' || o_np || case when o_z > 0 then ' · 0점 ' || o_z else '' end end,
         case when has_cr then 'categoryResults 있음' || case when cr_keys <> '' then ' (' || cr_keys || ')' else '' end else 'categoryResults 없음' end,
         coalesce(mfill, '-')
    from one
)
select 이름, 경로, 최근4주, 옛기록, 앱칸, 월간채움 from rows order by o;
