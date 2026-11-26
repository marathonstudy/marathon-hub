-- ============================================================
--  migration-132-online-report-words.sql — 20261126e · 131 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  온라인 반 레포트 알림톡 문구 다듬기 (원장님 글 그대로)
--   1번 학생 완주: 「하루도 빠짐없이 해냈어요.」 → 「하루도 빠짐없이 해 왔어요.」 (다음 줄 「어려운 걸 해냈어요」와 겹치지 않게)
--   3번 학생 3일+ · 6번 학부모 3일+: 새 글 (도전하고 있다는 것 자체 · 다시 이어 가기)
--   2번 · 4번 · 5번 그대로 · 변수(130) · 버튼(/me/?c=#{코드}) 그대로
--  _online_report_body 가 하나뿐인 원본 — 미리보기 · 대체 문자가 같이 바뀐다 (.local/알림톡_온라인레포트_템플릿.md 와 글자가 같아야 함)
-- ============================================================

create or replace function public._online_report_body(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 's_full' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n그런데 이번 주 #{제출}, 하루도 빠짐없이 해 왔어요.\n어려운 걸 해냈어요. 정말 대단해요!\n(#{연속} 연속으로 이어 가는 중)\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_some' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n이번 주 #{제출}을 했어요.\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n다음 주에는 이번 주보다 한 걸음 더 가 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_many' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n그 길에 도전하고 있다는 것 자체가 이미 대단한 거예요.\n오늘 하루부터 다시 이어 가 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 'p_full' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n매일 꾸준히 해 나가는 것은 쉽지 않은 일인데,\n#{이름} 학생은 이번 주 #{제출}, 하루도 빠짐없이 해냈습니다.\n(#{연속} 연속으로 이어 가는 중입니다)\n많이 칭찬해 주세요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_some' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n#{이름} 학생은 이번 주 #{제출}을 했습니다.\n매일 꾸준히 해 나가는 것은 쉽지 않은 일입니다.\n다음 주에는 이번 주보다 한 걸음 더 나아갈 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_many' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n매일 꾸준히 해 나가는 것은 쉽지 않은 과정입니다.\n그 과정에 도전하고 있다는 것 자체로 충분히 의미 있는 일입니다.\n다시 이어 갈 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    else '' end;
$$;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '130이 먼저 있음(버튼 변수 #{코드})' as what, ('#{코드}' = any(public._online_report_vars('s_full')))::text as ok
union all select '1번 「하루도 빠짐없이 해 왔어요.」', (position('하루도 빠짐없이 해 왔어요.' in public._online_report_body('s_full')) > 0)::text
union all select '3번 「그 길에 도전하고 있다는 것 자체가」', (position('그 길에 도전하고 있다는 것 자체가 이미 대단한 거예요.' in public._online_report_body('s_many')) > 0)::text
union all select '6번 「그 과정에 도전하고 있다는 것 자체로」', (position('그 과정에 도전하고 있다는 것 자체로 충분히 의미 있는 일입니다.' in public._online_report_body('p_many')) > 0)::text
union all select '6개 모두 [마라톤스터디] · 국어 · 지문 없음', ((select bool_and(public._online_report_body(k) like '[마라톤스터디] %' and public._online_report_body(k) !~ '(국어|지문|읽)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '본문 변수 그대로(130 과 맞음)', ((select bool_and(
    ((select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']) @> public._online_report_vars(k)
    and public._online_report_vars(k) @> ((select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']))
  from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '문구에 꼭 · 반드시 · 무조건 · ** 없음', ((select bool_and(public._online_report_body(k) !~ '(꼭|반드시|무조건|\*\*)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text;
