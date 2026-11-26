-- ============================================================
--  migration-131-online-report-neutral.sql — 20261126d · 130 다음 · 여러 번 실행해도 됨 · 함수 다시 배포 없음
--  온라인 반 레포트 알림톡 문구를 과목 중립으로 (국어 외 영어 · 수학 반에도 같은 템플릿)
--   「[마라톤국어]」 → 「[마라톤스터디]」 · 「하루 한 지문을 매일 읽는 건(것은)」 → 「매일 꾸준히 해 나가는 건(것은)」
--   「읽어 냈어요 / 읽었어요 / 읽었습니다」 → 「해냈어요 / 했어요 / 했습니다」 · 「오늘 한 지문부터」 → 「오늘 하루부터」
--   나머지 문장 · 변수(_online_report_vars 130 그대로) · 버튼(/me/?c=#{코드}) 그대로
--  _online_report_body 가 하나뿐인 원본 — 미리보기 · 대체 문자가 같이 바뀐다 (.local/알림톡_온라인레포트_템플릿.md 와 글자가 같아야 함)
-- ============================================================

create or replace function public._online_report_body(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 's_full' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n그런데 이번 주 #{제출}, 하루도 빠짐없이 해냈어요.\n어려운 걸 해냈어요. 정말 대단해요!\n(#{연속} 연속으로 이어 가는 중)\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_some' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n이번 주 #{제출}을 했어요.\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n다음 주에는 이번 주보다 한 걸음 더 가 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 's_many' then E'[마라톤스터디] #{이름} 학생, 이번 주 레포트예요\n\n매일 꾸준히 해 나가는 건 쉽지 않은 일이에요.\n이어 가기 어려운 주도 있어요. 괜찮아요.\n오늘 하루부터 다시 도전해 봐요. 선생님이 응원할게요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 볼 수 있어요.'
    when 'p_full' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n매일 꾸준히 해 나가는 것은 쉽지 않은 일인데,\n#{이름} 학생은 이번 주 #{제출}, 하루도 빠짐없이 해냈습니다.\n(#{연속} 연속으로 이어 가는 중입니다)\n많이 칭찬해 주세요.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_some' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n#{이름} 학생은 이번 주 #{제출}을 했습니다.\n매일 꾸준히 해 나가는 것은 쉽지 않은 일입니다.\n다음 주에는 이번 주보다 한 걸음 더 나아갈 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    when 'p_many' then E'[마라톤스터디] #{이름} 학생 학부모님, 이번 주 레포트 안내드립니다\n\n매일 꾸준히 해 나가는 것은 쉽지 않은 과정이라, 이어 가기 어려운 주도 있습니다.\n#{이름} 학생이 다시 도전할 수 있도록 한마디 응원해 주시면 큰 힘이 됩니다.\n\n#{반} 이번 주 기록은 아래 [레포트 보기]에서 보실 수 있습니다.'
    else '' end;
$$;

-- ============================================================
--  확인 — 모두 true
-- ============================================================
select '130이 먼저 있음(버튼 변수 #{코드})' as what, ('#{코드}' = any(public._online_report_vars('s_full')))::text as ok
union all select '6개 모두 [마라톤스터디]로 시작', ((select bool_and(public._online_report_body(k) like '[마라톤스터디] %') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '국어 · 지문 · 읽 없음(과목 중립)', ((select bool_and(public._online_report_body(k) !~ '(국어|지문|읽)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '6개 모두 「매일 꾸준히 해 나가는」', ((select bool_and(position('매일 꾸준히 해 나가는' in public._online_report_body(k)) > 0) from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '본문 변수 그대로(130 과 맞음)', ((select bool_and(
    ((select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']) @> public._online_report_vars(k)
    and public._online_report_vars(k) @> ((select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(public._online_report_body(k), '(#\{[^}]+\})', 'g') m) || array['#{코드}']))
  from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text
union all select '문구에 꼭 · 반드시 · 무조건 · ** 없음', ((select bool_and(public._online_report_body(k) !~ '(꼭|반드시|무조건|\*\*)') from unnest(array['s_full', 's_some', 's_many', 'p_full', 'p_some', 'p_many']) k))::text;
