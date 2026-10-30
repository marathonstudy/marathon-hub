-- ============================================================
--  마라톤 코치룸 — 이미 등록된 학생 수강 시작일 분포 (읽기 전용 · 아무것도 바꾸지 않는다 · 20261101b)
--  SQL Editor 에 붙여 넣고 Run → 반마다 학생 수를 나눠 보여 준다. 숫자만 나온다 (이름 · 번호 없음)
--    첫수업과같음   수강 시작일 = 반 첫 수업일
--    첫수업보다앞   반 첫 수업일보다 앞 (예전 기본값 · 등록일 등)
--    수업일        첫 수업 뒤 · 그 반 수업 요일과 같은 날 (새 기본값과 같은 모양)
--    수업일아님     첫 수업 뒤인데 수업 요일이 아닌 날 (등록일이 그대로 들어간 경우 등)
--    비어있음      수강 시작일 없음
-- ============================================================
select c.name as 반,
       count(*) filter (where s.start_on = c.first_lesson)                                                         as 첫수업과같음,
       count(*) filter (where c.first_lesson is not null and s.start_on < c.first_lesson)                          as 첫수업보다앞,
       count(*) filter (where s.start_on > coalesce(c.first_lesson, '1900-01-01') and extract(dow from s.start_on) = c.lesson_dow) as 수업일,
       count(*) filter (where s.start_on > coalesce(c.first_lesson, '1900-01-01') and c.lesson_dow is not null and extract(dow from s.start_on) <> c.lesson_dow) as 수업일아님,
       count(*) filter (where s.start_on is null)                                                                  as 비어있음,
       count(*) as 전체
  from public.students s join public.classes c on c.name = btrim(s.class_name)
 where not s.archived
 group by c.name, c.first_lesson, c.lesson_dow
 order by c.name;
