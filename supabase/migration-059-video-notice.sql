-- ============================================================
--  마라톤 코치룸 — 수업 영상 알림 문구 (migration-059-video-notice.sql · 20261101o)
--
--  실행 방법
--    058 다음에 Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
--  여러 번 실행해도 안전하다 (이미 있으면 그대로). 학생 · 레포트 · 영상은 바꾸지 않는다. 함수 배포는 없다.
--
--  「자주 쓰는 문구」에 「수업 영상 알림」 — 코치룸 반 공통에서 반 전체 영상을 새로 넣고 저장하면
--  「수업 영상이 올라왔다고 알릴까요? [학생에게] [학생+학부모] [안 보냄]」을 묻고, 고르면 이 글로 문자 발송 화면을 연다
--    칸: {날짜}(그 주 수업일 · 화면이 채운다) · {러닝노트주소}(학생 입구) · {학생이름} {반이름}도 된다
--  이 SQL 을 안 돌려도 같은 기본 글로 연다 (문구 관리에서 고치려면 이 SQL 이 필요하다)
-- ============================================================

do $$
begin
  if not exists (select 1 from public.sms_templates where btrim(title) = '수업 영상 알림') then
    insert into public.sms_templates (title, body, sort_order, updated_by)
    values ('수업 영상 알림', '[마라톤국어] {날짜} 수업 영상이 올라왔어요. 러닝노트에서 바로 볼 수 있어요: {러닝노트주소}',
            coalesce((select max(sort_order) from public.sms_templates), 0) + 1, 'migration-059');
  end if;
end;
$$;


-- ============================================================
--  확인 — 한 줄 true
-- ============================================================
select '수업 영상 알림 문구' as what, exists (select 1 from public.sms_templates where btrim(title) = '수업 영상 알림')::text as ok;
