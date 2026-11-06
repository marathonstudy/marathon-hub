-- ============================================================
--  migration-066-app-sync-cron.sql — 과제 기록 자동 받기 예약 (20261106h)
--
--  순서 — 1. migration-065 실행 → 2. Edge Function app-sync 배포(Verify JWT 끔) → 3. 이 파일 실행
--  5분마다 app-sync 를 부른다. 함수가 「받을 차례」(진행 중인 반 30분 · 그 밖 하루 · 실패한 학생 · 밤 1~6시 쉼)인 학생만
--  한 번에 60명까지, 3명씩 나눠 받는다. 열쇠는 필기 알림과 같은 DB 값(note_cron_secret · migration-050 필요).
--  여러 번 실행해도 안전하다. 끄려면: select cron.unschedule('app-sync');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'app-sync') then
    perform cron.unschedule('app-sync');
  end if;
end;
$$;

select cron.schedule('app-sync', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://hfimvleiljqwortkzkrl.supabase.co/functions/v1/app-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select token from public.note_cron_secret where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);

-- 확인 — true 한 줄
select exists (select 1 from cron.job where jobname = 'app-sync' and schedule = '*/5 * * * *') as "예약됨";
