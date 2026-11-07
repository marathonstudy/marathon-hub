-- ============================================================
--  check-report-send-1107.sql — 11/7 목동반 레포트 안내가 알림톡 · 일반 문자 두 가지로 나간 이유 (읽기만 · 20261108a)
--
--  실행 방법 — Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여 넣는다.
--    SQL Editor 는 맨 마지막 표 하나만 보여 준다 → ① ~ ⑤ 를 하나씩 마우스로 골라(드래그) [Run] (고른 부분만 돈다).
--    아무것도 바꾸지 않는다 (select 만).
--    번호는 뒤 4자리만 · 본문은 앞 40자만 보인다.
--  날 · 반을 바꾸려면 맨 위 params 의 두 값만 고친다.
--
--  ① 일반 문자 (sms_log) — 레포트 안내 · 레포트 문자로 남은 줄 하나하나 (누가 · 언제 · 어느 화면 · 누구에게)
--  ② 알림톡 (kakao_log) — 같은 날 그 반 학생 알림톡 줄 하나하나 (받은 번호가 학부모 1 · 2 · 학생 중 무엇인지 뒤 4자리로 맞춰 본다)
--  ③ 한 사람이 둘 다 받았나 — 학생마다 알림톡 · 문자 · 같은 번호인지
--  ④ 묶음 — 누른 횟수 (사람 · 화면 · 시각별 한 줄)
--  ⑤ 그날 받은 사본 첫 줄
-- ============================================================

-- ① 일반 문자
with params as (select date '2026-11-07' as d, '목동' as cls)
select to_char(l.created_at at time zone 'Asia/Seoul', 'HH24:MI:SS')                       as "시각",
       coalesce(nullif(btrim(s.name), ''), l.created_by)                                     as "보낸 사람",
       coalesce(b.label, '')                                                                 as "문구 이름",
       coalesce(b.purpose, '')                                                               as "목적",
       case when l.mark_week is not null then '레포트 발송(주 표시)' else '문자 발송' end       as "화면",
       l.batch_id::text                                                                      as "묶음",
       l.name                                                                                as "학생",
       case l.target when 'student' then '학생' when 'parent1' then '학부모1' when 'parent2' then '학부모2' else l.target end as "받는 쪽",
       '…' || l.phone_last4                                                                  as "번호",
       l.kind                                                                                as "종류",
       l.status || case when l.error <> '' then ' · ' || left(l.error, 40) else '' end      as "결과",
       coalesce(l.copy_state, '')                                                            as "사본",
       left(l.body_head, 40)                                                                 as "본문 앞"
  from public.sms_log l
  left join public.sms_batches b on b.id = l.batch_id
  left join public.staff s on lower(s.email) = lower(l.created_by)
  cross join params p
 where (l.created_at at time zone 'Asia/Seoul')::date = p.d
   and l.class_name like '%' || p.cls || '%'
   and not l.test
   and (b.purpose = 'report' or coalesce(b.label, '') like '%레포트%' or l.mark_week is not null or l.body_head like '%레포트%')
 order by l.created_at, l.name, l.target;

-- ② 알림톡
with params as (select date '2026-11-07' as d, '목동' as cls)
select to_char(k.created_at at time zone 'Asia/Seoul', 'HH24:MI:SS')                       as "시각",
       coalesce(nullif(btrim(s.name), ''), k.created_by)                                     as "보낸 사람",
       st.name                                                                               as "학생",
       k.title                                                                               as "호칭",
       case when k.phone_last4 = '' then '?'
            when right(regexp_replace(coalesce(st.parent_phone, ''), '\D', '', 'g'), 4) = k.phone_last4 then '학부모1'
            when right(regexp_replace(coalesce(st.parent_phone2, ''), '\D', '', 'g'), 4) = k.phone_last4 then '학부모2'
            when right(regexp_replace(coalesce(st.student_phone, ''), '\D', '', 'g'), 4) = k.phone_last4 then '학생'
            else '(지금 번호와 다름)' end                                                     as "받는 쪽(뒤 4자리로)",
       '…' || k.phone_last4                                                                  as "번호",
       k.week_start                                                                          as "레포트 주",
       k.status || case when k.error <> '' then ' · ' || left(k.error, 40) else '' end      as "결과",
       case when k.sms_fallback then '실패하면 문자로' else '대체 없음' end                    as "대체 발송",
       coalesce(k.copy_state, '')                                                            as "사본"
  from public.kakao_log k
  left join public.students st on st.id = k.student_id
  left join public.staff s on lower(s.email) = lower(k.created_by)
  cross join params p
 where (k.created_at at time zone 'Asia/Seoul')::date = p.d
   and coalesce(st.class_name, '') like '%' || p.cls || '%'
   and not k.test
 order by k.created_at, st.name;

-- ③ 한 사람이 둘 다 받았나
with params as (select date '2026-11-07' as d, '목동' as cls),
kk as (
  select k.student_id, count(*) n, string_agg(distinct k.phone_last4, ',') l4, string_agg(distinct k.status, ',') st
    from public.kakao_log k join public.students s on s.id = k.student_id, params p
   where (k.created_at at time zone 'Asia/Seoul')::date = p.d and s.class_name like '%' || p.cls || '%' and not k.test
   group by k.student_id
),
ss as (
  select l.student_id, count(*) n, string_agg(distinct l.phone_last4, ',') l4, string_agg(distinct l.target, ',') tg, string_agg(distinct l.status, ',') st
    from public.sms_log l left join public.sms_batches b on b.id = l.batch_id, params p
   where (l.created_at at time zone 'Asia/Seoul')::date = p.d and l.class_name like '%' || p.cls || '%' and not l.test
     and (b.purpose = 'report' or coalesce(b.label, '') like '%레포트%' or l.mark_week is not null or l.body_head like '%레포트%')
   group by l.student_id
)
select st.name                                                     as "학생",
       coalesce(kk.n, 0)                                           as "알림톡 수",
       coalesce('…' || kk.l4, '')                                  as "알림톡 번호",
       coalesce(ss.n, 0)                                           as "문자 수",
       coalesce(ss.tg, '')                                         as "문자 받는 쪽",
       coalesce('…' || ss.l4, '')                                  as "문자 번호",
       case when kk.n > 0 and ss.n > 0 and exists (select 1 from unnest(string_to_array(kk.l4, ',')) a join unnest(string_to_array(ss.l4, ',')) b on a = b)
            then '같은 번호로 둘 다'
            when kk.n > 0 and ss.n > 0 then '다른 번호 (학부모 · 학생 따로)'
            when kk.n > 0 then '알림톡만' else '문자만' end         as "판단"
  from (select student_id from kk union select student_id from ss) x
  left join public.students st on st.id = x.student_id
  left join kk on kk.student_id = x.student_id
  left join ss on ss.student_id = x.student_id
 order by 7, st.name;

-- ④ 묶음 — 누른 횟수
with params as (select date '2026-11-07' as d, '목동' as cls)
select '문자' as "채널", to_char(min(l.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS') as "처음", to_char(max(l.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS') as "끝",
       coalesce(nullif(btrim(s.name), ''), l.created_by) as "보낸 사람", coalesce(b.label, '') as "문구 이름", coalesce(b.purpose, '') as "목적",
       count(*) as "줄", count(distinct l.student_id) as "학생 수", string_agg(distinct l.target, ',') as "받는 쪽", l.batch_id::text as "묶음"
  from public.sms_log l left join public.sms_batches b on b.id = l.batch_id left join public.staff s on lower(s.email) = lower(l.created_by), params p
 where (l.created_at at time zone 'Asia/Seoul')::date = p.d and l.class_name like '%' || p.cls || '%' and not l.test
   and (b.purpose = 'report' or coalesce(b.label, '') like '%레포트%' or l.mark_week is not null or l.body_head like '%레포트%')
 group by l.batch_id, s.name, l.created_by, b.label, b.purpose
union all
select '알림톡', to_char(min(k.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS'), to_char(max(k.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS'),
       coalesce(nullif(btrim(s.name), ''), k.created_by), '레포트 알림톡', 'report', count(*), count(distinct k.student_id), '학부모', ''
  from public.kakao_log k join public.students st on st.id = k.student_id left join public.staff s on lower(s.email) = lower(k.created_by), params p
 where (k.created_at at time zone 'Asia/Seoul')::date = p.d and st.class_name like '%' || p.cls || '%' and not k.test
 group by s.name, k.created_by, date_trunc('minute', k.created_at)
 order by 2;

-- ⑤ 그날 받은 사본 첫 줄
with params as (select date '2026-11-07' as d, '목동' as cls)
select to_char(c.at at time zone 'Asia/Seoul', 'HH24:MI:SS') as "시각", c.head as "사본 첫 줄", c.n as "인원", c.failed as "실패", c.status as "결과"
  from public.msg_copy_log c, params p
 where (c.at at time zone 'Asia/Seoul')::date = p.d and c.head like '%' || p.cls || '%'
 order by c.at;
