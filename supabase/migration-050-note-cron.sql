-- ============================================================
--  마라톤 코치룸 — 필기 알림 매분 자동 실행 (migration-050-note-cron.sql)
--
--  실행 방법 (순서가 중요하다)
--    1. migration-049 실행 → 2. Edge Function note-remind 배포(Verify JWT 끔) → 3. 이 파일 실행
--    오류 「extension "pg_cron" is not available」이 나면 대시보드 → Integrations → Cron 에서 켠 뒤 다시 Run.
--  여러 번 실행해도 안전하다 (같은 이름의 예약을 지우고 다시 만든다).
--
--  매분 note-remind 함수를 부른다. 함수가 「보낼 때가 된 반」만 골라 보내므로 평소에는 아무것도 하지 않는다.
--  반마다 필기 알림을 켜기 전(처음 상태)에는 아무 문자도 나가지 않는다.
--  함수 주소는 assets/config.js 에 이미 공개된 프로젝트 주소다. 열쇠(x-cron-key)는 DB 안(note_cron_secret)에서만 읽는다.
--  끄려면: select cron.unschedule('note-remind');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'note-remind') then
    perform cron.unschedule('note-remind');
  end if;
end;
$$;

select cron.schedule('note-remind', '* * * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/note-remind',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);


-- ============================================================
--  확인 — true 한 줄 (1~2분 뒤 select * from net._http_response order by id desc limit 3; 으로 응답을 볼 수 있다)
-- ============================================================
select 'note-remind 매분' as what, exists (select 1 from cron.job where jobname = 'note-remind')::text as ok;
