-- ============================================================
--  마라톤 코치룸 — 웰컴 · 입구 문자 끝에 홈 화면 안내 한 줄 (migration-057-a2hs-text.sql · 20261101k)
--
--  실행 방법
--    056 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다 (한 줄은 한 번만). 학생 · 기록은 바꾸지 않는다. 함수 배포는 필요 없다.
--
--  「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」 · 「입구 안내」 글이 052 기본 글 그대로(코치룸에서 고쳐 저장한 적 없음)일 때만
--  끝에 「홈 화면에 추가해 두면 앱처럼 바로 열려요.」를 붙인다. 고쳐 저장한 글은 건드리지 않는다
--  (웰컴 · 입구 문자 창은 문구가 없을 때 같은 기본 글을 쓴다 — admin/welcome.js)
-- ============================================================

update public.sms_templates
   set body = body || case when btrim(title) = '입구 안내' then ' ' else E'\n' end || '홈 화면에 추가해 두면 앱처럼 바로 열려요.',
       updated_by = 'migration-057'
 where btrim(title) in ('신입생 웰컴(학생)', '신입생 웰컴(학부모)', '입구 안내')
   and updated_by = 'migration-052'
   and position('홈 화면에 추가해 두면' in body) = 0;


-- ============================================================
--  확인 — 한 줄 true (052 기본 글 그대로 남은 웰컴 · 입구 문구가 없음)
-- ============================================================
select '웰컴 · 입구 문구 홈 화면 한 줄' as what,
       (not exists (select 1 from public.sms_templates
                     where btrim(title) in ('신입생 웰컴(학생)', '신입생 웰컴(학부모)', '입구 안내')
                       and updated_by = 'migration-052' and position('홈 화면에 추가해 두면' in body) = 0))::text as ok;
