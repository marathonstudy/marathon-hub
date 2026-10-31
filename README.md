# 마라톤 코치룸 · 마라톤국어 러닝노트

**마라톤 코치룸**(선생님·조교 관리 페이지)과 **마라톤국어 러닝노트**(학생·학부모 개인 페이지).
학생·학부모에게 **개인 링크 하나**로 반 공지 · 레포트 발송 · 앱 과제 기록을 보여 주는 정적 사이트.
서버 없이 GitHub Pages + Supabase 로 돌아간다.

| 주소 | 누가 | 로그인 |
|---|---|---|
| `/admin/` | 선생님·조교 — 명단 · 작성 · 공개 · 발송 · 반 공지 · 교재 | 이메일 (staff 에 등록된 계정만) |
| `/me/#개인링크코드` | 학생·학부모 — 반 공지 / 내 레포트 / 앱 과제 / 교재비 | 없음 |
| `/notice/#반코드` | 반 단톡방 — 반 공지만 (학생 정보 없음) | 없음 |
| `/s/` | 학생 공용 입구 — 반 → 이름 → 휴대폰 번호 8자리 → 그 학생의 학생 링크 화면 | 학생 연락처 뒤 8자리 (migration-024) |

## 저장소에 올리지 않는 것 (공개 저장소다)

- **학생 이름·연락처·점수·코멘트는 저장소에 절대 올리지 않는다.** 전부 Supabase 에만 있다.
  레포트도 파일로 만들지 않고, 개인 페이지가 Supabase 함수로 불러와 그린다.
- 엑셀·CSV 명단, 백업 파일(`.mhbak`)은 `.gitignore` 로 막아 두었다. 그래도 폴더에 두지 않는다.
- Supabase **secret key · service_role key**, 데이터베이스 비밀번호는 어디에도 적지 않는다.
  `assets/config.js` 에는 publishable key 만 있다. 모든 표에 RLS 가 켜져 있어 공개돼도 된다.
- **교재비 계좌번호·금액·납부 캡처도 저장소에 없다.** 계좌는 코치룸 교재 → 설정에서 입력하면
  Supabase(`app_settings`)에만 저장되고, 캡처는 비공개 보관함(`tb-receipts`)에만 올라간다.
  공급처 주문표 엑셀은 내 컴퓨터로만 내려받는다(`*.xlsx` 는 `.gitignore` 로 막혀 있다).

## 폴더

```
admin/        코치룸 (명단 · 작성 · 공개 · 발송 · 반 공지 · 교재)
  tb.js         교재 — 뼈대 · 설정 · 일정
  tb-dash.js    교재 — 대시보드
  tb-issue.js   교재 — 지급
  tb-stock.js   교재 — 재고·주문·입고
  tb-bill.js    교재 — 청구·수납 · 납부 안내 · 선불 차액 · 환불
  card.js       학생 상담 카드 (기본 정보 · 내신 · 모의고사 · 상담·관찰 기록)
  exams.js      첫 화면 D-day 띠 · [시험 관리]
  sync.js       여러 기기 — 다시 불러오기 · 실시간 반영
  photo.js      학생 → 필기 노트 — 반·날짜별 올림 현황 · 숨기기 · 완전 삭제 · 저장 공간
  today.js      「오늘」 총괄 (로그인 첫 화면) — 요약 · 챙겨야 할 학생 · 반별 카드
  staff.js      더보기 → 운영진 — 들어온 사람 목록 · [사용 중지]/[다시 사용](원장 계정만)
  auth.js       로그인 (조교: 이름 · 번호 8자리 / 원장: 다른 방법으로 로그인 → 이메일) · 비밀번호 찾기
  weekly.js     레포트 발송 → 1 작성 반 공통 — 수업일 · 수업 영상 · 배부 자료/과제 파일 · 지난 파일 정리 · [미리보기 그림 만들기]
  filethumb.js  파일 「첫 페이지 그림」 만들기 — PDF 첫 페이지(pdf.js · cdnjs 3.11.174) · JPG/PNG 를 가로 400px JPG 로 (20261029i)
  summary.js    레포트 발송 → 1 작성 반 공통 — 자막으로 AI 수업 요약 (초안 → 확정)
  ../assets/app-week.js  러닝노트 앱 과제 · 강의 표 (레포트는 수업일 D 기준 지난 일주일 D-7 ~ D-1 · 코치룸 「오늘」 · AI 초안도 같은 계산)
  ytbm.js       즐겨찾기 버튼 「마라톤 자막 가져오기」 (PC 크롬 · 유튜브 화면에서 스크립트 복사 → AI 요약 [붙여 넣기])
  weeks.js      레포트 발송 → 1 작성 → 반별 「주차 현황」 (migration-018)
  review.js     레포트 발송 → 1 작성 반 공통 — 복습테스트 확인 표(시험별) · 고치기 · 대신 입력 · 지금 제출 현황 · 시험별 평균 (migration-025)
  draftguard.js 레포트 발송 → 1 작성 글 지키기 — 다른 사람이 고친 칸 알림 · 저장 안 된 내용 복구 · 이전 내용 보기
  preview.js    학부모 화면 · 학생 화면 미리보기 (조교 화면 · 링크 코드 없이 · 아무것도 안 바뀜)
  aipolish.js   글 칸 「AI로 다듬기」 · 「AI로 초안 쓰기」 공통 부품 — 학생 · 학부모가 읽는 모든 여러 줄 글 칸 (20261029g)
  rtabs.js      위쪽 탭 6개(오늘 · 레포트 발송 · 문자 발송 · 학생 · 교재 · 더보기) · 레포트 발송 세 단계(작성 ── 공개 ── 발송 n/전체) · 학생 두 화면 · 더보기 메뉴 (20261029a)
  nav.js        뒤로가기 · 새로고침 (탭 · 반 · 주차 · 창마다 기록) · 저장 안 된 글이 있으면 떠나기 전 확인
  send.js       레포트 발송 → 3 발송 — 주차 띠 · 반마다 카드 · 학생 줄 한 줄 · ⋯ 메뉴 (알림톡은 kakao.js)
  sms.js        「문자 발송」 탭 — 보내기(SMS · LMS · 카톡 알림톡 고르기) · 자주 쓰는 문구 · 보낸 기록 · 연결 상태 · 새 학생 앱 안내 문자 (20261031m)
me/           학생·학부모 개인 페이지
s/            학생 공용 입구 (반 · 이름 · 휴대폰 번호 8자리 → /me/#학생링크) — assets/entry.js
notice/       반 공용 공지 페이지
assets/
  config.js     ← 배포 주소 · Supabase 주소와 publishable key · 버전
  brand.js      ← 선생님 표기 · 학원명 · 문의처 (김종현 T / 마라톤국어) · 로고 고르기
  logo.png · logo-charcoal.png  로고 (보라 · 짙은 회색, 원본에서 줄인 웹용 사본)
  og.png · og-charcoal.png      카톡 미리보기 그림 (1200×630, 불투명)
  lesson.js     수업일 · 과제 기간 계산 (코치룸 · 러닝노트 · 반 공지가 같이 쓴다)
  review-card.js 러닝노트 「오늘 복습테스트 기록하기」 카드 · 복습테스트 점수 그래프
  icon-180.png · icon-192.png  홈 화면 아이콘 (로고)
  report.css    레포트 디자인
  report-view.js 레포트 그리기 (개인 페이지와 코치룸 미리보기가 같이 쓴다)
  hub.css · hub.js 개인 페이지(탭 레포트 · 수업 영상 · 과제 상세 · 내 필기) · 반 공지 페이지
  dday.js       주요 시험 D-day 계산 (한국 시간 · 코치룸과 학생 화면이 같이 쓴다)
  photos.js     러닝노트 「내 필기」 — 사진 줄이기 · 올리기(작은 그림 함께) · 날짜별 앨범 · 레포트 「오늘 수업 필기」 · 크게 보기(넘기기 · 확대)
supabase/
  schema.sql                  표 · RLS · 공개 함수 전부 (SQL Editor 에서 한 번 실행)
  migration-002-textbook.sql  2단계 교재 관리 표 · 계산 함수 · 학부모용 hub_textbook (schema.sql 다음에 한 번)
  migration-003-sync.sql      여러 기기 동시 사용 — 수정 시각 · 항목별 저장 함수 · 실시간 반영 (002 다음에 한 번)
  migration-004-notes.sql     상담 카드 · 성적 · 상담·관찰 기록 (staff 만, 공개 함수에 안 나감)
  migration-005-exams.sql     주요 시험 D-day — 개인·반 공지 페이지 함수에 시험 이름·날짜만 더함
  migration-006-notes-photos.sql  필기 노트 사진 — 비공개 보관함 · 사진 기록 · Edge Function 전용 함수
  functions/note-photo/index.ts   필기 사진 올리기·보기·지우기 Edge Function (개인 링크 코드 확인)
  migration-007-dashboard.sql     「오늘」 총괄 — 계산 함수 coach_today() 하나 + 설정 보호 (새 표 없음)
  migration-008-staff-join.sql    조교 직접 가입(팀 가입 코드) · 직원 관리(사용 중지 · 역할)
  migration-009-classes.sql       반 목록 한 곳(classes 표) — 학생 0명인 반도 모든 탭에 보이게
  migration-010-class-admin.sql   반 관리(선생님만) — 이름 바꾸기 · 보관/되살리기 · 빈 반 삭제 · 변경 기록
  migration-011-weekly.sql        수업일(요일 · 첫 수업일 · 이 주만 바꾸기) · 수업 영상 · 자료 파일(비공개 보관함 class-files)
  functions/class-file/index.ts   자료 파일 내려받기 Edge Function (링크 코드 · 파일의 반 확인 → 2분짜리 주소)
  migration-012-lesson-summary.sql  AI 수업 요약 — 초안 · 확정본 · 사용 기록 · 월 상한 · 「수업 영상(전체)」 칸
  functions/lesson-summary/index.ts 자막 → Claude(Sonnet 5.5) 요약 Edge Function (직원만 · 키는 Secrets 에만)
  migration-013-review-test.sql     복습테스트 — 회차 자동 생성 · 학생 제출 · 조교 확인 · 기록 · 시험지 사진 보관함
  functions/review-test/index.ts    복습테스트 학생 제출 Edge Function (개인 링크 · 수업일 당일 · 마감 확인)
  migration-014-draft-safety.sql    작성 글 안전장치 — 크게 줄면 · 10분마다 · 다른 글로 바뀔 때 이전 글을 서버에 보관
  migration-015-student-link.sql    학생 링크 · 학부모 링크 나누기 · 전환 기간 스위치 · 직원 미리보기 함수
  migration-016-attend-trend.sql    출결 기본값(출석 · 집중도 5, 빈 칸만) · 결석 기준에서 보강 빼기 · 러닝노트 누적 추이
  migration-017-settings-guard.sql  조교 · 선생님 같은 권한 (선생님 계정 보호만 예외) · 설정 이름 바꾸기 막기
  migration-018-class-weeks.sql     레포트 발송 → 1 작성 → 반별 「주차 현황」 한 번에 가져오기 (직원만 · 읽기 전용)
  migration-019-summary-discard.sql AI 수업 요약 [초안 지우기] · [확정 취소] (직원만)
  migration-020-kakao.sql           카카오 알림톡(솔라피) — 학부모 번호 2 · 발송 기록(뒤 4자리만) · 설정 · 발송 준비/기록 함수 (직원만)
  migration-021-written-rule.sql    주차 현황의 「작성 중」도 새 작성 완료 규칙(개별 코멘트 또는 지각 · 결석)으로
  migration-022-coach-cycle.sql     「오늘」을 반마다 수업 주기로 — 지난 수업일 레포트 · 그 주 복습테스트 · 주기별 필기 (직원만 · 읽기 전용)
  migration-023-sms.sql             사이트 문자(SMS · LMS) — 보낸 기록(뒤 4자리만) · 자주 쓰는 문구(직원 공용) · 설정 · 발송 준비/기록 함수 (직원만)
  functions/kakao-send/index.ts     알림톡 발송 Edge Function (키는 Secrets 에만 · 직원만)
  functions/sms-send/index.ts       문자 발송 Edge Function (알림톡과 같은 솔라피 키 · 직원만 · 번호는 DB 에서 찾음)
  migration-025-review-two.sql      복습테스트 시험 2개(복습 TEST · 화작문 TEST) · 전체 + 틀린 개수 · 사진 여러 장 · 날짜 이름(「10/22(목) 복습 TEST」) · 예전 기록 그대로
  migration-026-text-polish.sql     문자 「AI로 다듬기」 — 사용 기록(글은 저장 안 함) · 월 상한(기본 500회 · AI 요약과 따로) · 직원만
  functions/text-polish/index.ts    글 칸 다듬기 · 코멘트 초안 Edge Function — Claude(Haiku 5.5) · 칸 글(초안은 화면이 모은 자료)만 보냄 · 자리표시 · 링크 · 숫자 · 요일 검사 (직원만 · 키는 Secrets 에만)
  migration-027-review-status.sql   레포트 · 러닝노트 복습테스트 칸 — 확인 전 제출은 「제출 완료」만 (review_week_scores 에 status · 새 hub_review_week · 점수는 안 나감)
  migration-029-file-thumbs.sql     파일 카드 첫 페이지 그림 (class_files.thumb_path · thumb_bytes · class_file_thumbs · 지우기 권한 · 저장 공간에 그림 용량)
  migration-030-review-no-confirm.sql  복습테스트 「확인」 단계 없애기 — 평균 · 그래프 · 누적 추이 · 주차 현황이 낸 점수 그대로 · 사유 없는 미제출은 레포트에 「미응시」(status missing)
  migration-031-sent-time.sql       「오늘」 반 카드에 레포트 보낸 시각 (coach_cycle 학생마다 sent_at)
  migration-032-report-unit.sql     레포트를 반 + 수업일 단위로 (published · sent 에 class_name · lesson_date · 채우기 트리거) · 고친 레포트 알림 횟수(notify_n · report_notified)
  migration-033-course.sql          과정 + 회차 (courses · course_members · course_sync 가 과정 공통 내용을 반마다 복사) · 담당 조교 · 「이 반만 한 줄 추가」
  migration-034-exams.sql           D-day 시험 여러 개 · 시험마다 전체 반 / 반 · 과정 (_exam_for_class 가 가장 가까운 시험 + 목록)
  migration-035-student-profile.sql 학생이 채우는 「내 정보」 · 얼굴 사진 (student_profile · me_info_get · me_info_save · me_photo_save)
  migration-036-skips.sql           레포트 건너뛰기 · 챙길 학생 확인함 · 마라톤 사이트 로그인 정보 (report_skips · care_checks · staff_vault · 직원만)
  check-data.sql                    데이터 점검 (읽기 전용 · 숫자만) — 반마다 번호 없음 · 번호 같음 · 수업 요일 · 이번 주 공개 · 발송
  migration-028-review-absent.sql   복습테스트 미응시 사유 (review_absences 표 · review_absent_set / clear · 제출하면 저절로 풀림 · 「오늘」 미제출에서 빠짐 · 학부모에게는 사유 이름만)
  migration-024-student-login.sql   학생 공용 입구 — 반 · 이름 목록 · 휴대폰 번호 로그인(맞음/틀림 + 학생 링크 코드만) · 로그인 기록(직원만)
  kakao/template.txt · kakao/HOW-TO.md  알림톡 템플릿 초안 · 솔라피 등록 방법
  check-classes.sql               반 이름 점검 (읽기 전용 — 어느 표에 어떤 반이 있는지 · 비슷한 이름)
  functions/app-report/index.ts  앱 과제 기록을 대신 받아 오는 Edge Function
  migration-047-phone-login.sql   조교 이름 + 번호 8자리 로그인 (번호는 해시 · 뒤 4자리만) · 운영진 목록 · 사용 중지는 원장만 · 팀 가입 코드 닫기
  functions/staff-login/index.ts  조교 로그인 Edge Function (Supabase 기본 환경값만 함수 안에서 · 새 키 없음 · Verify JWT 끔)
```

## 고칠 때 규칙

파일을 고치면 **버전을 함께 올린다.** `assets/config.js` 의 `version` 과
`admin/index.html` · `me/index.html` · `notice/index.html` · `s/index.html` · `index.html` 의 `?v=…` 를 같은 값으로.
안 올리면 GitHub Pages 캐시 때문에 최대 10분간 옛 파일이 나간다.

---

## 처음 한 번 — 설치 순서

### 1. 표 만들기 (Supabase)
1. Supabase 대시보드 → 프로젝트 `marathon-hub` → 왼쪽 **SQL Editor** → **New query**
2. `supabase/schema.sql` 파일 내용을 전부 복사해 붙여 넣고 **Run**
3. 맨 아래 결과에 표들이 `rls_enabled = true` 로 나오면 끝. 여러 번 실행해도 안전하다.

### 2. 가입 설정 (조교 직접 가입 — migration-008 을 쓸 때)
- **Authentication → Sign In / Providers → Email**: **Allow new users to sign up** 켜기, **Confirm email** 끄기 → Save
  (누구나 계정은 만들 수 있지만 팀 가입 코드가 맞아야 staff 로 등록된다. 등록 안 된 계정은 아무것도 못 본다)
- **Authentication → URL Configuration**: Site URL 과 Redirect URLs 에 `https://marathonstudy.github.io/marathon-hub/admin/` (비밀번호 찾기 메일의 링크가 여기로 돌아온다)
- 직접 가입을 쓰지 않을 때만 Allow new users to sign up 을 끈다.

### 3. 선생님·조교 계정 만들기
1. **Authentication → Users → Add user → Create new user**
2. 이메일 · 비밀번호 입력, **Auto Confirm User** 체크 → Create user

### 4. staff 등록 — 처음 선생님 한 명만 (나머지는 코치룸에서 직접 가입)
SQL Editor 에서 아래를 고쳐서 Run. 이메일은 소문자로.

```sql
-- 선생님
insert into public.staff (email, name, role) values ('nopk890727@gmail.com', '김종현', 'teacher')
on conflict (email) do nothing;

-- 조교 (사람마다 한 줄)
insert into public.staff (email, name, role) values ('조교이메일@example.com', '조교 이름', 'assistant')
on conflict (email) do nothing;

-- 지금 등록된 사람 보기
select email, name, role from public.staff;

-- 조교가 그만두면 (계정은 Authentication → Users 에서 따로 지운다)
delete from public.staff where email = '조교이메일@example.com';
```

### 5. 앱 과제 Edge Function
1. **Edge Functions → Deploy a new function → Via Editor**
2. 함수 이름 `app-report`
3. 편집기 내용을 지우고 `supabase/functions/app-report/index.ts` 전체를 붙여 넣기 → **Deploy function**
4. 배포된 함수 → **Details**(또는 Settings) → **Verify JWT with legacy secret** 끄기 → Save
   (학부모는 로그인이 없으므로 끈다. 함수가 개인 링크 코드를 직접 검사한다.)

함수가 없거나 실패해도 개인 페이지의 **[앱 리포트 열기]** 버튼은 동작한다.

### 5-2. 교재 관리 표 (2단계)
1. SQL Editor → **New query** → `supabase/migration-002-textbook.sql` 전체 붙여 넣기 → **Run**
2. 맨 아래 결과에 `tb_` 로 시작하는 표 13개가 `rls_enabled = true` 로 나오면 끝. 여러 번 실행해도 안전하다.
3. 이 SQL 을 안 돌려도 1단계 기능은 그대로 동작한다(교재 탭에 안내만 뜬다).

### 5-3. 여러 기기 동시 사용 (migration-003)
1. SQL Editor → **New query** → `supabase/migration-003-sync.sql` 전체 붙여 넣기 → **Run**
2. 맨 아래 결과에 실시간 반영 표 이름이 14개 안팎 나오면 끝. 여러 번 실행해도 안전하다.
3. 실시간 반영이 안 되는 환경이면 코치룸이 30초마다 새로 불러온다(따로 할 일 없음).

### 5-4. 상담 카드 · 주요 시험 (migration-004 → 005)
1. SQL Editor → **New query** → `supabase/migration-004-notes.sql` 전체 → **Run** → 표 3개가 `rls_enabled = true`
2. 다시 **New query** → `supabase/migration-005-exams.sql` 전체 → **Run** → `exam_for_all` 이 null 이면 정상(아직 시험 없음)
3. 둘 다 여러 번 실행해도 안전하다. 반드시 004 다음에 005.

### 5-5. 필기 노트 사진 (migration-006 + Edge Function note-photo)
1. SQL Editor → **New query** → `supabase/migration-006-notes-photos.sql` 전체 → **Run**
   (보관함 `note-photos` 까지 만든다. 결과에 `note_photos = true`, `bucket public = false`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `note-photo`
   → `supabase/functions/note-photo/index.ts` 전체 붙여 넣기 → **Deploy function**
3. 배포된 함수 → **Details** → **Verify JWT with legacy secret** 끄기 → Save (학생은 로그인이 없다. 함수가 개인 링크 코드를 직접 검사한다)
4. **Storage** → `note-photos` 가 **Private** 인지만 확인 (Public 으로 바꾸지 않는다)

결제선생은 지금 수납 방법 값으로만 쓴다. 나중에 파트너 API 계약을 하면 콜백용 Edge Function 이
`tb_bills.provider_ref` 로 청구서를 찾아 `status='paid'`, `pay_method='payssam'`, `paid_at`, `provider_raw` 를
채우게 붙이면 된다(칸은 이미 만들어 두었다).

### 5-6. 반 목록 (migration-009)
1. SQL Editor → **New query** → `supabase/migration-009-classes.sql` 전체 → **Run**
2. 결과 표에 지금 쓰는 반이 모두 나오면 끝. **비슷한_이름** 칸에 값이 있으면 이름만 다른 같은 반일 수 있다
   (합치지 않는다. 필요하면 학생 [수정]에서 반을 하나로 골라 옮긴다)
3. 언제든 `supabase/check-classes.sql` 을 실행하면 반마다 어느 표에 몇 줄 있는지 볼 수 있다 (아무것도 바꾸지 않는다)

### 5-7. 반 관리 (migration-010)
1. SQL Editor → **New query** → `supabase/migration-010-class-admin.sql` 전체 → **Run**
2. 결과 표에 반 목록과 `보관 = false` 가 나오면 끝

### 5-8. 수업일 · 수업 영상 · 자료 파일 (migration-011 + Edge Function class-file)
1. SQL Editor → **New query** → `supabase/migration-011-weekly.sql` 전체 → **Run**
   (보관함 `class-files` 까지 만든다. 결과에 새 표 4개 `true`, `bucket class-files public = false`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `class-file`
   → `supabase/functions/class-file/index.ts` 전체 붙여 넣기 → **Deploy function**
3. 배포된 함수 → **Details** → **Verify JWT with legacy secret** 끄기 → Save (학부모는 로그인이 없다. 함수가 링크 코드를 직접 검사한다)
4. **Storage** → `class-files` 가 **Private** 인지만 확인 (Public 으로 바꾸지 않는다)

### 5-9. AI 수업 요약 (migration-012 + Edge Function lesson-summary + Claude 키)
1. SQL Editor → **New query** → `supabase/migration-012-lesson-summary.sql` 전체 → **Run**
   (결과에 `ai_usage` · `lesson_summaries` 가 `true`, `monthly_cap` 이 `80`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `lesson-summary`
   → `supabase/functions/lesson-summary/index.ts` 전체 붙여 넣기 → **Deploy function**
3. 배포된 함수 → **Details** → **Verify JWT with legacy secret** 끄기 → Save
   (끄더라도 아무나 못 쓴다 — 함수가 부른 사람의 로그인 토큰으로 DB 에 직원인지 · 월 상한이 남았는지 직접 묻는다)
4. **Claude 키 넣기** — 키는 이 저장소 · 코드 · 카톡 · 대화창에 절대 붙이지 않는다
   1. console.anthropic.com 로그인 → **Settings → Billing**: 결제 수단 · 크레딧 충전(5~10달러) · **Auto-reload 끄기**
   2. **Settings → Limits**: 월 사용 한도(Spend limit) — 예) 10달러
   3. (선택) **Workspaces** → `marathon-hub` 작업 공간 + 그 공간의 월 한도
   4. **API Keys → Create Key** → 이름 `marathon-lesson-summary` → 키가 한 번만 보인다. 복사만 하고 바로 다음 단계로
   5. Supabase → **Edge Functions → Secrets → Add new secret** → Name `ANTHROPIC_API_KEY`, Value 붙여 넣기 → Save
   6. 키가 새어 나간 것 같으면 Console → API Keys 에서 그 키를 **Delete** 하고 새로 만들어 5번만 다시 한다

### 5-10. 복습테스트 학생 직접 기록 (migration-013 + Edge Function review-test)
1. SQL Editor → **New query** → `supabase/migration-013-review-test.sql` 전체 → **Run**
   (결과에 새 표 3개 `true`, `bucket review-photos public = false`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `review-test`
   → `supabase/functions/review-test/index.ts` 전체 붙여 넣기 → **Deploy function**
3. 배포된 함수 → **Details** → **Verify JWT with legacy secret** 끄기 → Save (학생은 로그인이 없다. 함수가 개인 링크 코드를 직접 검사한다)

### 5-11. 작성 글 안전장치 (migration-014)
1. SQL Editor → **New query** → `supabase/migration-014-draft-safety.sql` 전체 → **Run**
   (결과에 `text_history rls = true`, `triggers = 2`)

### 5-12. 학생 링크 · 학부모 링크 (migration-015 + Edge Function 다시 배포)
1. SQL Editor → **New query** → `supabase/migration-015-student-link.sql` 전체 → **Run**
   (결과에 `student_code column = true`, `parentWrite (전환 기간) = true`)
2. Edge Function **note-photo** · **review-test** 를 각각 새 코드로 다시 배포 (Verify JWT 는 둘 다 끈 채로)

### 5-13. 출결 기본값 · 누적 추이 (migration-016)
1. SQL Editor → **New query** → `supabase/migration-016-attend-trend.sql` 전체 → **Run**
   (결과에 `entry_defaults · hub_trend · coach_today` 세 줄 모두 `true`)
2. 실행 전에도 사이트는 그대로 열린다 — 기본값 채우기와 「누적 추이」 카드만 나오지 않는다

### 5-14. 조교 · 선생님 같은 권한 (migration-017)
1. 016 다음에 SQL Editor → **New query** → `supabase/migration-017-settings-guard.sql` 전체 → **Run**
   (결과에 `same role` · `key guard` · `links row` 세 줄 모두 `true`)
2. 실행 뒤에는 조교도 반 관리 · 설정 · 직원 관리 · 삭제 · 되살리기를 모두 씁니다.
   조교는 선생님 계정을 사용 중지 · 조교로 바꾸기 못 하고, 누구도 선생님으로 올리지 못합니다

### 5-15. 반별 주차 현황 (migration-018)
1. 017 다음에 SQL Editor → **New query** → `supabase/migration-018-class-weeks.sql` 전체 → **Run**
   (결과에 `staff_class_weeks` · `anon blocked` 두 줄 모두 `true`)
2. 실행 전에는 주차 현황 자리에 안내만 나오고, [이번 주 작성하기]로 예전처럼 작성할 수 있습니다

### 5-16. AI 요약 초안 지우기 · 확정 취소 (migration-019)
1. 018 다음에 SQL Editor → **New query** → `supabase/migration-019-summary-discard.sql` 전체 → **Run**
   (결과에 `summary_discard` · `summary_unconfirm` 두 줄 모두 `true`)
2. Edge Function 다시 배포: **app-report**(과제 기록 전부 · 주차 표) · **lesson-summary**(학생 이름 · 잡담 빼는 지시문)

### 5-17. 카카오 알림톡 (migration-020 + Edge Function kakao-send + 솔라피)
1. 019 다음에 SQL Editor → **New query** → `supabase/migration-020-kakao.sql` 전체 → **Run** (세 줄 모두 `true`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `kakao-send` → `supabase/functions/kakao-send/index.ts` 전체 → Deploy
   → **Verify JWT with legacy secret 끄기** (함수가 부른 사람의 로그인으로 DB 에 직원인지 직접 묻는다)
3. 솔라피 채널 연동 · 템플릿 등록 · 키 만들기 · Secrets 다섯 개 — `kakao/HOW-TO.md`
4. 코치룸 「오늘」 → [설정] → 「내 시험 번호」 → 레포트 발송 → 3 발송 → [나에게 시험 발송]

### 5-18. 작성 완료 규칙 (migration-021)
1. 020 다음에 SQL Editor → **New query** → `supabase/migration-021-written-rule.sql` 전체 → **Run** (두 줄 모두 `true`)
2. 작성 완료 = 그 학생 개별 코멘트가 있거나 출결을 지각 · 결석으로 바꾼 때 (기본값 출석 · 5 와 반 공통 내용만 있으면 「작성 중」)

### 5-19. 「오늘」 반 수업 주기 (migration-022)
1. 021 다음에 SQL Editor → **New query** → `supabase/migration-022-coach-cycle.sql` 전체 → **Run** (두 줄 모두 `true`)
2. 실행 전에는 「오늘」이 예전처럼 달력 주로 세고, 카드 위에 안내 한 줄이 나온다

### 5-20. 사이트에서 문자 보내기 (migration-023 + Edge Function sms-send)
1. 022 다음에 SQL Editor → **New query** → `supabase/migration-023-sms.sql` 전체 → **Run** (세 줄 모두 `true`)
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `sms-send` → `supabase/functions/sms-send/index.ts` 전체 → Deploy
   → **Verify JWT with legacy secret 끄기** (함수가 부른 사람의 로그인으로 DB 에 직원인지 직접 묻는다)
3. Secrets 는 알림톡과 같은 `SOLAPI_API_KEY` · `SOLAPI_API_SECRET` · `SOLAPI_SENDER` 를 그대로 쓴다 (새로 넣을 것 없음)
4. 「오늘」 → [설정] → 「사이트 문자」 칸에서 키 세 개가 ✓ 인지 · 단가 · 상한 · 광고 발신처 · 무료수신거부 번호(광고 문자를 쓸 때만)
5. 레포트 발송 → 3 발송 → [반 전체 문자] → [나에게 시험 발송]으로 한 건 먼저 받아 본다
- 화면은 학생 id 와 보낼 곳(학부모 1 · 2 · 학생 본인)만 넘긴다. 번호는 함수가 DB 에서 찾고, 기록에는 뒤 4자리만 남는다.
- 같은 번호는 한 번만(형제는 「따로 보내기」를 직접 켰을 때만) · 한 번 200건 · 하루 500건(설정) · 광고 문자는 수신거부 번호가 없거나 밤 9시 ~ 아침 8시면 막는다.
- 실행 전에는 「문자 보내기」 창에 안내만 나오고, 알림톡 · 문구 복사 · 내 폰 문자는 그대로 쓴다.

### 5-21. 학생 공용 입구 /s/ (migration-024)
1. 023 다음에 SQL Editor → **New query** → `supabase/migration-024-student-login.sql` 전체 → **Run** (세 줄 모두 `true`)
2. Edge Function 은 없다. 코치룸 학생 → 명단 위쪽 [학생 입구 주소 복사] · [단톡방 안내 문구 복사]
- 학생: `/s/` → 반 → 이름 → 비밀번호(students.student_phone 뒤 8자리 · 따로 저장하지 않고 student_login 함수가 비교) → `/me/#학생링크`
- 누구나 부를 수 있는 함수는 student_entry_classes · student_entry_names · student_login 셋뿐. 이름 목록에는 이름과 고르기용 표시값만,
  로그인은 맞음/틀림(+ 맞으면 그 학생의 학생 링크 코드)만 돌려준다. 학부모 번호 · 상담 · 성적 · 금액 · 다른 학생 정보는 나가지 않는다.
- 로그인 유지(기본 켬)는 이 기기에 학생 링크 코드 하나만(`mhub.slogin`) 남긴다. 러닝노트 머리 [로그아웃]이 지운다.
- 로그인 기록(student_logins: 학생 · 시각 · 성공/실패 · 이유, 비밀번호 · 넣은 값은 저장 안 함)은 상담 카드에서 본다.
- 잠금 · 비밀번호 바꾸기는 없다(요청대로). 학생 연락처를 고치면 비밀번호도 바로 바뀐다.

### 5-22. 복습테스트 시험 2개 · 전체 + 틀린 개수 (migration-025 + Edge Function review-test 다시 배포)
1. 024 다음에 SQL Editor → **New query** → `supabase/migration-025-review-two.sql` 전체 → **Run** (세 줄 모두 `true`)
2. Edge Function **review-test** 를 새 코드로 다시 배포 (Verify JWT 는 끈 채로)
- 반 수업일마다 `classes.review_names`(처음엔 「복습 TEST」 · 「화작문 TEST」)가 저절로 생긴다. 두 번째 시험부터는 바꾼 날(처음 실행한 날, 늦어도 2026-10-22) 이후
  수업일에만 만든다 — 지난 수업일에 새 시험이 생겨 「미제출」로 잡히지 않게. 그 주만 끄기(review_test_set) · 더 넣기(review_test_add) · 반 목록(class_review_names_set).
- 학생은 시험마다 전체 문항 수 + 틀린 개수(wrong_n), 사진 여러 장(photos · 필수 · 두 시험이 같이 씀). 마감 · 확인 전 고치기 · 확인 후 잠김은 그대로.
- 예전 기록(틀린 번호)은 지우지 않는다 — 「복습 TEST」로 보이고 점수 그대로. round_no 칸도 그대로 둔다(화면에서만 안 쓴다).
- 아래 「복습테스트」 절의 회차 · 틀린 번호 · 자주 틀린 번호 설명은 예전 방식이다.

### 5-23. 문자 「AI로 다듬기」 (migration-026 + Edge Function text-polish)
1. 025 다음에 SQL Editor → **New query** → `supabase/migration-026-text-polish.sql` 전체 → **Run**
2. **Edge Functions → Deploy a new function → Via Editor** → 이름 `text-polish` → `supabase/functions/text-polish/index.ts` 전체 → Deploy,
   **Verify JWT 끄기** (로그인 확인은 함수가 DB 에 직접 한다). 키는 AI 요약과 같은 Secrets 의 `ANTHROPIC_API_KEY` — 새로 넣을 것 없음
- 문자 보내기 창 내용 칸 아래 [AI로 다듬기] · 길이(짧게 · 보통 · 자세히, 기본 보통) · 버튼 옆 「이번 달 n회 남음」.
  결과는 「다듬은 문장」으로만 보이고 [이걸로 바꾸기]를 눌러야 내용 칸이 바뀐다 ([다시] · [원래대로] · 바꾼 뒤 [되돌리기]).
- Claude 에는 내용 칸 글만 간다 — 학생 이름 · 번호 · 링크는 #{이름} #{링크} 같은 자리표시 그대로라 보내지 않는다.
  원래 글 · 다듬은 글은 저장하지 않는다(polish_usage 에는 시각 · 직원 · 글자 수 · 토큰 · 대략 비용만).
- 함수가 받은 글을 검사한다: 자리표시(#{이름} #{반} #{링크} #{수업일})가 원래와 같은지, 원래 글에 없던 숫자 · 날짜 · 요일이 생기지 않았는지,
  (광고) · 수신거부를 붙이지 않았는지. 어긋나면 돌려주지 않고 「지금은 다듬을 수 없어요. 직접 보내도 됩니다」. ** · 이모지는 지운다.
  원래 숫자가 빠지면 「확인할 것」에 적는다. 「짧게」인데 90바이트가 넘으면 그렇게 알려 준다.
- 월 상한 기본 500회(실패는 안 셈) — 「오늘」 → [설정] → 「문자 AI로 다듬기」 칸 (AI 요약 상한과 같은 권한). 상한 · 실패 · 키 없음이어도 문자 보내기는 그대로 된다.
- 모델 claude-haiku-5-5 · effort low · 정해 둔 JSON 모양. 1번 약 1원 안팎.

### 5-24. 20261029g — 수기 과제 · 점수 없애기 · 복습테스트 「제출 완료」 · 글 칸 AI 다듬기 · 코멘트 초안 (migration-027 + text-polish 다시 배포)
1. 026 다음에 SQL Editor → **New query** → `supabase/migration-027-review-status.sql` 전체 → **Run** (두 줄 모두 `true`)
2. Edge Functions → **text-polish** → **Code** 탭 → 새 `supabase/functions/text-polish/index.ts` 전체로 바꾸기 → **Deploy updates** (Verify JWT 는 끈 채로)
- 작성 화면의 수기 「리뷰테스트(테스트 이름)」 · 「필수과제」 · 「선택과제」 칸, 학생 카드의 점수 · 과제 칸을 뺐다. 예전 값(week_common.tests · homework,
  entries.scores · homework)은 지우지 않고 화면 · 레포트에서만 숨긴다. 작성 완료 · 진행률에도 안 센다. 시험은 복습테스트, 과제 수행은 앱 연동으로 보인다.
- 학생 카드 「복습테스트」 줄 — 그 주 기록(「복습 TEST 6/10 · 화작문 TEST 10/10 · 확인 전」 · 「아직 제출 안 함」) · [고치기] → 복습테스트 화면.
- 레포트 · 러닝노트 「이번 주」의 복습테스트 — 확인한 시험은 점수, 냈지만 확인 전이면 「제출 완료」만 (027). 027 전에는 확인한 점수만 (예전 그대로).
  러닝노트 이번 주 카드는 출결 · 집중도 · 복습테스트 세 칸(필수 과제 칸 없음). 레포트의 과제 수행 · 과제 제출률 카드도 그리지 않는다.
- 복습테스트 [이번 주 시험 빼기] — 제출이 있는 시험은 뺄 수 없다(서버 review_test_set 도 막는다). 뺀 시험은 요약 줄 「… 이번 주 안 봄 · 되돌리기」.
- 미리보기 — 「이 주차」(작성 화면에서 고른 주 · 공개 전 내용 그대로 · 띠 「아직 공개 전입니다 · 공개하면 학부모에게 이렇게 보입니다」) / 「지금 학부모가 보는 화면」.
  버튼 이름은 어디서나 「학부모 화면 미리보기」 · 「학생 화면 미리보기」.
- 이미 보낸 주를 고치면 작성 화면 위 「고친 내용은 다시 공개해야 학부모에게 반영됩니다 [다시 공개]」.
- 학부모 · 학생 화면의 선생님 한마디 · 수업 내용 · 공지에서 ** · __ · # 기호를 안 보이게 (저장된 글은 그대로 · ReportView.mdHtml).
- 글 칸 「AI로 다듬기」(aipolish.js) — 반 공통 코멘트 · 학생 코멘트 · 수업 내용 · 반 공지 6칸 · 교재 납부 안내 문구 · 납부 안내 글 · 인사말 · 상용구 · 문자 내용.
  안 붙인 칸: 이름 · 번호 · 비밀번호 · 숫자 · 날짜 · 링크 · 파일명 · 시험 이름 · 검색 · 한 줄 칸, 직원끼리만 보는 상담 기록 · 결제 메모 · 칸 보기.
- 코멘트 「AI로 초안 쓰기」 — text-polish 의 action draft. 자료는 화면에 이미 있는 것만(수업 내용 · 앱 과제 · 복습테스트 냄/안 냄 · 자료 이름 · 출결 · 집중도 · 최근 결석),
  점수 · 금액 · 상담 · 이름 · 번호는 안 보낸다. 받은 초안도 자료에 없던 숫자 · 자리표시 · 링크가 있으면 버린다.

### 5-25. 20261029h — 복습테스트 미응시 사유 · 레포트 앱 과제 「지난 일주일」 (migration-028)
1. 027 다음에 SQL Editor → **New query** → `supabase/migration-028-review-absent.sql` 전체 → **Run** (세 줄 모두 `true`)
- 복습테스트 확인 표 — 안 낸 칸 [대신 입력] 옆 [미응시] → 결석 · 지각 · 상담 중 · 다른 시험으로 대체 · 기타 (뒤의 둘은 메모 60자 · 코치룸에서만 보임).
  이름 옆 [이번 주 전부 미응시] — 그 주 안 낸 시험 모두에 같은 사유. 회색 「미응시 · 결석」을 누르면 사유 바꾸기 · [미응시 취소].
  학생이 내거나 [대신 입력]하면 서버 트리거가 미응시를 푼다. 누가 · 언제 했는지 review_log(absent_set · absent_clear · absent_auto_clear).
- 제출 현황은 미응시를 따로 센다 — 요약 줄 「복습 TEST 제출 9 · 미응시 1 / 11」 · 지금 제출 현황 · 「오늘」 「복습테스트 9/11 · 미응시 1」.
  「오늘」 미제출 알림(review_missing · coach_cycle)에서 빠지고, 시험별 평균(review_stats)은 원래 확인된 점수만 세므로 들어가지 않는다.
- 「결석」을 고르면 그 주 작성 화면 출결이 비어 있거나 미리 채운 「출석」 그대로일 때만 「출결도 결석으로 바꿀까요?」 한 번 (지각 · 결석이면 안 물음). 학생 카드 줄 「복습 TEST 미응시(결석)」.
- 학부모 · 학생 화면(레포트 · 이번 주 카드)은 「미응시 · 결석」 사유 이름까지만. 학생 화면은 미응시 시험에 입력 칸을 띄우지 않는다. AI 초안에도 「미응시(결석)」까지만.
- 레포트(수업일 D)의 앱 과제 요약 = 그 수업 전 일주일 D-7 ~ D-1 (AppWeek.forLesson). 「앱 과제 요약 · 지난 일주일 (10/15~10/21)」 · 「10/22 수업 전까지 한 것」.
  원형 3개 · n/n일 제출 · 날짜 7칸 · 전체 누적(시작일 ~ D-1)이 모두 같은 기간, 「날짜별 제출」 달력은 그 7일만 강조. 앱 기록이 그 뒤에 시작했으면 「첫 주라 지난 기록이 없습니다」.
  러닝노트 「이번 주」의 「다음 수업까지 진행 중」 카드는 뺐다 — 진행 중인 주는 「앱 과제」 탭(오늘 기준 · 그대로)에서만.
  같은 기간으로 맞춘 곳: 러닝노트 이번 주 · 각 주차 레포트 · 누적 추이 「과제」 · 코치룸 「오늘」 앱 과제 꼬리표 · 반 평균 · AI 초안 앱 과제 수치(그 앞 일주일 D-14 ~ D-8 과 비교).

### 5-26. 20261029i — 러닝노트 탭 정리 · 레포트 「오늘 수업 필기」 · 파일 카드 (migration-029 + class-file · note-photo 다시 배포)
1. 028 다음에 SQL Editor → **New query** → `supabase/migration-029-file-thumbs.sql` 전체 → **Run** (세 줄 모두 `true`)
2. Edge Functions → **class-file** → **Code** 탭 → 새 `supabase/functions/class-file/index.ts` 전체로 바꾸기 → **Deploy updates** (action thumbs)
3. Edge Functions → **note-photo** → **Code** 탭 → 새 `supabase/functions/note-photo/index.ts` 전체로 바꾸기 → **Deploy updates** (작은 그림)
4. 코치룸 → 레포트 발송 → 1 작성 → 반 공통 「배부 자료 · 과제 파일」 → 반마다 **[미리보기 그림 만들기]** 한 번 (이미 올린 PDF · 사진)
- 러닝노트 탭 네 개 — 레포트 · 수업 영상 · 과제 상세(예전 앱 과제) · 내 필기(예전 필기 노트). 「이번 주」 · 「내 레포트」를 「레포트」 하나로.
  열면 가장 최근 공개 레포트. 예전 주소(#코드/notice · /week · /this-week · /app · /photo)도 새 탭으로. 새 레포트 빨간 점은 레포트 탭.
- 레포트 한 편: 머리(수업일) → 출결 · 집중도 · 복습테스트 → 오늘 수업 필기 → 앱 과제 요약(지난 일주일) → 수업 내용(없으면 확정 요약)
  → 종합 코멘트 → 이 수업 과제 · 자료 카드 → 이 수업 영상 → 선생님 공지 → 학생 정보.
  가장 최근 레포트에는 예전 「이번 주」의 다른 주 과제 · 자료(접어서) · 지난 공지까지. 「이번 주」의 누적 추이 한 줄은 [누적 추이] 화면으로.
- 위 한 줄 「◀ 지난주 · 10/22(목) 수업 ▾ · 다음주 ▶ · 누적 추이」 — 날짜 칩 줄 · 「‹ 전체 주차 · 누적 추이」 줄은 없앴다.
  가운데를 누르면 공개된 수업일 목록. 학부모 · 학생 화면에 주 시작일을 쓰지 않는다(공지 · 자료 묶음 · 누적 추이 표 · 레포트 머리도 수업일).
- 오늘 수업 필기 — 그 수업일에 올라온 그 학생 필기. 첫 장 크게 · 나머지 2열 · 4장 넘으면 +n장 더 보기 · 크게 보기(넘기기 · 확대) ·
  「내 필기에서 전체 보기」 → 내 필기 탭 그 날짜(#코드/photo/날짜). 필기가 없으면 칸을 숨긴다.
  사진은 올릴 때 작은 그림(…_s.jpg · 긴 변 480px)을 같이 올려 목록에 먼저 쓰고, 크게 볼 때 원본(그 전 사진은 원본만).
- 파일 카드 — 한 줄 두 개 정사각형 · 필수 → 선택 → 배부 · 「필수」 · 「선택」 표시 · 첫 페이지 그림(PDF) · 그 그림(JPG · PNG) · 그 밖은 색 아이콘.
  그림은 코치룸이 올릴 때 브라우저에서 만들어 같은 폴더 「원래이름.thumb.jpg」로 둔다 (다른 이름은 SQL 이 막는다). 반 공지 /notice/ 도 같은 카드.

### 5-27. 20261030a — 「작성 중 / 작성 완료」 없애기 · 복습테스트 「확인」 없애기 · 과제 상세 (migration-030 + app-report 다시 배포)
1. 029 다음에 SQL Editor → **New query** → `supabase/migration-030-review-no-confirm.sql` 전체 → **Run** (세 줄 모두 `true`)
2. Edge Functions → **app-report** → **Code** 탭 → 새 `supabase/functions/app-report/index.ts` 전체로 바꾸기 → **Deploy updates** (shape — 앱이 보내는 항목 이름만)
- 「작성 중 / 작성 완료」 구분 없음 — 학생 카드 딱지 · 「작성 완료 n / 전체」 · 「작성 중 n명은 빠집니다」 · 「아직 덜 쓴 학생만」 · 공개의 「작성 중도 포함」을 없앴다.
  [공개 단계로] = 반 학생 전원. 개인 코멘트는 선택(비면 반 공통 코멘트). 비어 있는 칸(출결 · 집중도 · 코멘트 · 복습테스트)은 레포트에서 숨는다.
  공개 직전 확인 창에 정말 빠진 것만 한 줄(「출결 안 넣은 학생 2명: 김OO, 이OO」 · 출결 · 집중도 · 코멘트) — 막지 않는다. report.js gapsOf · gapLine.
  단계 숫자 · 「오늘」 반 카드 · 주차 현황은 공개 n/전체 · 발송 n/전체만. (staff_class_weeks 의 written 값은 남아 있지만 화면이 안 쓴다)
- 복습테스트 「확인」 없음 — [확인] 버튼 · 「확인 전 / 확인 완료 / 확인 0」 표시를 없앴다. 낸 값 그대로 쓰고 이상하면 [고치기] (고친 기록 · review_log 그대로).
  예전 확인 여부(status · confirmed_by · confirmed_at)는 지우지 않는다. 고치거나 대신 넣은 시험은 학생이 더 못 고친다(예전처럼 잠김).
  레포트 복습테스트 칸 「복습 TEST 8/10 · 화작문 TEST 10/10」 (▲▼ 는 문항 수가 같을 때 맞은 개수 차이).
- 사유 없는 미제출 — 수업일이 오늘이거나 지난 시험에 제출 · 대신 입력 · 미응시 사유가 모두 없으면 review_week_scores 가 status missing 줄을 주고,
  공개하면 학부모 · 학생 화면에 「미응시」. 「아직 입력 전」 · 「미제출」은 학부모 화면에 쓰지 않는다 (비면 칸을 숨긴다).
- 과제 상세 — 이번 주(진행 중) 요약 · 기간별 기록(지난 일주일 · 이번 달 · 전체: 제출 · 정시 · 늦게 · 미제출 · 평균 정답률 · 강의 시청 · 날짜별 과제 펼치기) ·
  영역별 정답률 막대 · 자주 틀리는 영역 TOP 3 · 차시별 진도. 코치룸 학생 카드(명단 · 작성) [과제 상세 보기] = 미리보기의 그 탭.
  app-report 가 넘기는 것만 쓴다. 문항별 정오 · 오답 문항 · 풀이 시간 · 시청 시간(분)은 앱이 주지 않아 없다.

### 5-28. 20261030b — 공개 반별 · 문자 표 · 보낸 결과 · 수업일 표기 · 영상 위치 · 휴대폰 화면 (migration-031)
1. 030 다음에 SQL Editor → **New query** → `supabase/migration-031-sent-time.sql` 전체 → **Run** (두 줄 모두 `true`)
2. (선택) 데이터 점검 — `supabase/check-data.sql` 전체 → **Run** (읽기 전용 · 반마다 숫자만)
- 공개 화면 = 지금 고른 반 학생만 · 다른 반은 맨 아래 접힌 「다른 반도 함께 공개」(미리 체크 안 함) · 학생 줄은 「공개 전 / 공개됨」만.
- 문자 — 보낼 곳 「학부모」 · 「학생」 둘(기본 둘 다). 학부모 = 등록된 학부모 번호 모두. 학생 번호가 학부모 번호와 같으면 학부모 링크로 한 통만(명단에도 「번호 같음」).
  미리보기 = 학생 한 줄 표(학생 · 학부모 · 학생 본인) · 줄 / 번호 체크 · 이름을 누르면 전문 · 요약 한 줄 「n명 · 학부모 n통 · 학생 n통 · 번호 없음 n · 총 n통 · 약 n원」.
  보낸 뒤 창 맨 위 큰 띠(초록 「✓ 보냄 완료 · 22건 · 시각」 / 빨간 「보냄 20건 · 실패 2건 · 실패만 다시 보내기」) · 칸마다 「보냄 시각」 / 「실패(사유)」 ·
  [보냄 완료](못 누름) · [다시 보내기](확인). 그 주 레포트를 이미 보낸 학생은 「이미 보냄 시각」 · 체크 꺼짐.
  [나에게 시험 발송] — 시험 번호가 없으면 「설정에 내 시험 번호를 먼저 넣어 주세요 · 설정 열기」.
  창이 열려 있을 때 알림(toast)이 창 뒤에 숨던 것 → 창 안에 (모든 코치룸 창 공통 · app.js).
- 단계 표시 「발송 11/11 ✓」 초록 · 발송 줄 「안 보냄」 회색 · 「오늘」 반 카드 「10/22 레포트 발송 완료 11/11 · 18:09」 / 「발송 8/11 · 안 보냄 3명」 (시각은 031 뒤).
- 날짜 = 수업일 「10/22(목) 수업」 (Store.lessonLabel) — 주차 현황 줄 · 공개 · 발송 · 문자 · 반 공지 · 복구 띠 · 수업일 바꾸기 · 지난 파일 정리.
- 레포트 「이 수업 영상」은 선생님 한마디 바로 아래 (학부모 · 학생 · 미리보기 같은 차례).
- 휴대폰 — 머리(.topbar)의 backdrop-filter 가 아래 고정 탭 줄을 머리 상자에 붙여 머리를 덮던 것 고침 · 작은 글자 키움 · 문자 표 360px 맞춤.

### 5-29. 20261030c — 공개 화면 반 체크 칸 (SQL 없음)
- 반 머리 체크 칸 = 아직 공개 안 한 학생이 모두 체크돼 있으면 켜짐 (이미 공개한 학생은 따지지 않음 · 반 전원이 공개됐으면 전원 기준).
  켜면 아직 공개 안 한 학생을 모두 체크(이미 고른 학생은 그대로) · 끄면 반 전원 해제.

### 5-30. 20261030d — 앱 과제 토 · 일 = 「주중 복습」 (SQL 없음)
- 날짜별로 앱 과제를 보여 주는 곳(레포트 앱 과제 요약 날짜 칸 · 「날짜별 제출」 달력 · 「과제 상세」 날짜 목록 · 코치룸 미리보기)에서
  토 · 일은 늘 「주중 복습」(옅은 색 · 앱 기록이 없어도) · 그날 앱에 제출한 기록이 있으면 「주중 복습 ✓」.
- 토 · 일은 미제출로 치지 않는다 — AppWeek.compute · cumulative 가 분자 · 분모에서 모두 뺀다 →
  「n/n일 제출」 · 과제 제출률 · 정시 제출률 · 강의 시청률 · 전체 누적 · 누적 추이 · 「오늘」 앱 과제 알림 · AI 초안 앱 수치가 모두 평일만.
  전체 누적은 날짜별 기록으로 직접 센다(앱이 주는 전체 % 는 날짜별 기록이 없을 때만).

### 5-31. 20261030e — 「오늘」 단순하게 · 레포트 발송(반 하나 + 수업 하나) · 단계 버튼 · 고친 레포트 알리기 (migration-032)
1. 031 다음에 SQL Editor → **New query** → `supabase/migration-032-report-unit.sql` 전체 → **Run** (네 줄 모두 `true`)
- 「오늘」 반 카드 = 반 이름 · 인원 / 최근 3번 수업 레포트 칩(보낸 학생 % · 초록 100 · 주황 일부 · 빨강 0 · 회색 수업 당일 「작성 중」 · 누르면 그 수업 발송) /
  「수업일 10/29(목)」 · 「수업까지 D-3!」(당일 D-day! · 수업일이 없으면 [수업일 미정 · 수업 요일 정하기]) / [문자] [이번 주 작성하기].
  급함 · 살펴보기 배지 · 공개 · 발송 줄 · 복습 · 필기 · 앱 평균 줄은 없앴다. 학생 목록은 접고 「학생 n명 보기 ▾」(반마다 기억) · 학생 줄 = 이름 · 「앱 n/5일」(평일만) · 상담 카드 · 문자 · 미리보기 둘.
- 「오늘 할 일」 = 발송 안 한 레포트가 있는 반만 「목동반 · 10/20 레포트 안 보냄 12명 [보내기]」 · 없으면 「오늘 할 일 없음」. 「오늘」 · 「레포트 발송」 탭 배지 = 같은 기준(학생 수).
- 위 탭 「주간 레포트」 → 「레포트 발송」. 반 고르기 → 수업일 고르기 → 1 작성 → 2 공개 → 3 발송 — 세 단계 모두 고른 반의 그 수업만(공개 · 발송에서 다른 반 안 보임 · 「다른 반도 함께 공개」 없앰).
  맨 위 띠 「고2 선수능반 · 10/22(목) 수업」 크게. 단계 버튼 「1 작성」→「2 공개 11/11」→「3 발송 11/11 ✓」(지금 단계 진한 보라 · 끝난 단계 초록 ✓) · 단계 맨 아래 [공개하러 가기 →] [발송하러 가기 →].
- 문자 창 — 내용에 「레포트」 · #{링크}가 있으면 레포트 안내: 그 수업 레포트가 공개 전인 학생은 「공개 전 · 발송 불가」(회색 · 체크 꺼짐).
- 보낸 뒤 고쳐 다시 공개 → 내용이 실제로 바뀐 학생만 「바뀐 내용 알리기」(학생마다 바뀐 것 한 줄 · 체크) → [바뀐 학생에게 알리기] = 문자 창 알림 모드
  (#{바뀐 내용} · 기본 문구 「#{수업일} 수업 #{이름} 학생 레포트에 #{바뀐 내용}이 반영되었습니다. #{링크}」 · 바뀐 내용이 같은 학생끼리 묶어 sms-send 를 부른다 · 함수 그대로) /
  [알리지 않고 공개만]. 러닝노트 레포트 위 「10/24 업데이트 · 복습테스트 결과 추가」(report_data._upd). 3 발송 표 「알림 2회 · 마지막 10/24 10:12」(032 뒤).
- 저장 — published · sent 에 반 · 수업일 칸(트리거가 채움 · 예전 기록도 채움 · 지우지 않음). 화면은 지금처럼 반 + 그 수업이 든 주로 다룬다(반마다 한 주에 레포트 한 편).
  주 2회 반을 수업마다 따로 쓰려면 작성(entries · week_common) · 영상 · 자료 · 복습테스트 열쇠도 수업일로 바꿔야 해서 이번에는 하지 않았다.

### 5-32. 20261031a — 과정 + 회차 · 「오늘」 챙길 학생 (migration-033)
1. 032 다음에 SQL Editor → **New query** → `supabase/migration-033-course.sql` 전체 → **Run** (다섯 줄 모두 `true`)
- 과정(courses) = 여러 반이 같은 회차를 요일만 다르게 듣는 묶음. 회차 = 첫 회차 시작일부터 7일씩. 반의 그 회차 수업일 = 그 7일 안의 반 수업 요일(그 반만 바꾼 날 · 휴강 그대로).
  course_members — 반은 과정 하나에만 · 넣은 회차부터(from_no) · 뺀 회차 앞까지(to_no). 기존 레포트는 옮기지 않는다.
- 과정 공통 내용 = 「§과정 이름」 칸의 회차 시작 주(week_common · lesson_videos · class_files · lesson_summaries) → course_sync 가 각 반 그 주 칸으로 복사
  (영상 · 자료는 course_src 로 원본을 가리킴 · 원본을 지우면 함께 빠짐 · 자료는 같은 보관 파일). 반에서 직접 고친 칸(week_common.local)은 덮지 않음 · 「이 반만 한 줄 추가」 = week_common.extra.
  복습테스트는 반마다 그 반 수업일(마감)로 — 회차 첫 반의 시험 목록에 다른 반을 맞춘다. 학부모 화면 · 파일 내려받기 · 반 공지 함수는 그대로.
- 코치룸 — 더보기 → 과정 관리(만들기 · 들어갈 반 · 「10월 4주」 표기 · 반마다 담당 조교). 레포트 발송 반 고르기에 📚 과정 → 회차 고르기 달력 → 1 작성(공통 칸 + 반마다 접힌 학생 카드 · 반별 현황 한 줄) →
  2 공개(마감 지난 반만 기본 체크 · 마감 전 반은 [마감 끝난 반만 공개]/[그래도 공개]/[취소] · 「미응시로 나갈 학생」 반별) → 3 발송(반별 「목동 100% · 반포 92%」 · 공개 전 반 회색).
- 「오늘」 — 과정은 한 묶음 카드(회차 · 날짜 범위 · 이번 회차 일주일 한 줄 달력 · 반별 줄) · 담당 조교 반이 맨 위.
  「챙길 학생」(오늘 할 일 아래 · 배지 제외) — 복습테스트 안 낸 학생(review_missing · 그 수업 레포트를 보내면 사라짐) · 결석 잦은 학생(마지막 결석 뒤 상담 기록이 있으면 사라짐).

### 5-33. 20261031b — 과제 기록 빨리 · 불러오는 중 표시 · 「앱 과제」 → 「과제」 (SQL · 함수 없음)
- 늦던 원인 — 「오늘」이 학생마다 app-report 를 4명씩 부르고 마지막 학생이 끝나야 학생 줄을 다시 그렸다(그때까지 모두 「앱 …」) · 시간 제한이 없어 느린 한 명이 전체를 붙잡았다 · 미리보기가 같은 기록을 또 불렀다.
  → admin/appfetch.js 한 곳에서 부른다(학부모 코드마다 한 번 · 부르는 중이면 같이 기다림 · 30분 메모리 · 15초 넘으면 실패) · 6명씩 동시에 · 한 명 받을 때마다 그 학생 칸만 바로.
  앱 서버가 여러 명을 한꺼번에 주는 주소가 없어 「한꺼번에 불러오기」는 함수로는 못 한다(앱 쪽에 그런 주소가 생기면 app-report 를 바꿀 수 있다).
- 불러오는 동안 빙글빙글 「과제 불러오는 중」 · 반 카드 위 「과제 기록 불러오는 중 3/11」(10초 넘으면 「조금 오래 걸리고 있습니다」 · 다 받으면 사라짐) · 실패 「과제 기록 못 불러옴 · 다시 시도」.
  러닝노트 · 미리보기 레포트 과제 요약 · 「과제 상세」도 같은 표시(실패하면 칸을 숨기지 않고 다시 시도).
- 코치룸 · 러닝노트의 「앱 과제」 「앱 n/5일」 → 「과제」 「과제 n/5일」 · 「과제 요약」 (「과제 상세」 탭 이름 · 앱 공유 링크 · 앱 리포트 열기는 그대로).
- 수업 요일 정하는 칸 안내 — 「이 반이 처음 수업한 날을 고르세요. 그 요일이 매주 수업 요일이 됩니다.」

### 5-34. 20261031c — 오늘 수업 D-day · 첫 수업일부터 칩 · 학생 「내 정보」 · 얼굴 사진 · 명단 정리 · D-day 시험 등록 (migration-034 · 035)
1. 033 다음에 SQL Editor → **New query** → `supabase/migration-034-exams.sql` 전체 → **Run** (한 줄 `true`)
2. 이어서 `supabase/migration-035-student-profile.sql` 전체 → **Run** (세 줄 모두 `true`) — Storage 설정 · 함수 배포는 필요 없다
- 「오늘」 · 과정 카드 — 수업 당일 「오늘 수업 D-day!」 · 발송 칩 · 오늘 할 일 · 탭 배지는 반의 첫 수업일(수업 요일 정하기)부터의 수업만.
- 학생 「내 정보」(학생 링크 · /s/ 로그인만) — 학교 · 학년 · 휴대폰 · 목표 대학·학과 · 선택과목 · 최근 모의고사 등급 · 다니는 학원 · 하고 싶은 말 · 얼굴 사진.
  이름 · 반은 못 바꿈 · 번호를 바꾸면 「로그인 비밀번호도 바뀝니다」. 사진은 정사각 400px · 96px JPEG 를 student_profile 에 data: 글자로 (공개 주소 없음 · 본인 · 직원만).
  코치룸 — 상담 카드 사진 · 「학생이 채운 내 정보」(「학생이 10/24 수정」) · 「오늘」 · 발송 · 명단의 동그란 사진(없으면 첫 글자) · 「얼굴 사진으로 보기」 바둑판 ·
  「내 정보 안 채운 학생 n명」 · 「사진 없는 학생 n명」 [문자로 알리기](학생 번호 · /s/ 주소). 상담 기록 · 특이사항 · 성적 · 결석은 학생 화면에 안 나감.
- 학생 명단 — 반마다 「학생 링크 모두 복사」 없앰 · 반 현황 칸 숨김(레포트 · 러닝노트 · 반 공지 어디에도 안 쓰임 · class_info 데이터 그대로) · 단톡방 안내 문구 새로.
- D-day 시험 등록(더보기) — 줄마다 시험 이름 · 날짜 · 대상(전체 반 / 반 · 과정 여러 개) · 지우기 · [+ 줄 추가]. 띠 「6월 모의평가 D-42」(당일 D-day · 지나면 다음) · 누르면 전체 날짜순(지난 시험 회색) · 없으면 숨김.
  예전 「반마다 고른 시험 · 고정」은 쓰지 않는다(저장된 값은 그대로 · 저장하면 비워짐).

### 5-35. 20261031d — 과제 링크 연결 필요 · 과제 많이/적게 한 순 (SQL · 함수 배포 없음)
- 원인 — 「오늘」 학생 줄 과제 칸은 앱 공유 링크가 없으면 아예 비었고, 학부모 링크 코드가 없으면 「불러오는 중」에 멈춰 있었다.
  이제 앱 링크 없음 · 학부모 링크 없음 · 앱에서 만료(expired) = 회색 「과제 링크 연결 필요」(누르면 applink.js 링크 넣는 칸),
  링크는 있는데 실패(시간 초과 · 앱 서버 오류) = 「과제 기록 못 불러옴 · 다시 시도」.
- 반 카드 · 과정 카드 위 「과제 링크 연결 필요 n명」 → 그 학생들만 차례로 링크 넣기 (학부모 링크 코드가 없으면 같이 발급).
- 학생 줄 정렬 [과제 많이 한 순](기본) · [과제 적게 한 순] — 같으면 이름순 · 연결 필요는 맨 아래 · localStorage mhub.appSort 에 기억.
  레포트 발송 학생 줄도 같은 정렬 · 같은 과제 칸(이름 아래 작은 줄 · 그 레포트 수업일 D-7 ~ D-1) · 같은 n명 버튼.

### 5-36. 20261031e — 반 상태 두 줄 · 건너뛰기 · 확인함 · 학생 한 명 문자 · 과제 칩 색 (migration-036 · sms-send 다시 배포)
1. 035 다음에 SQL Editor → **New query** → `supabase/migration-036-skips.sql` 전체 → **Run** (세 줄 모두 `true`)
2. Edge Functions → **sms-send** → `supabase/functions/sms-send/index.ts` 전체로 바꿔 **Deploy** (Verify JWT 끈 그대로) — 문자 창 「보내는 번호」.
   다시 배포하기 전에는 그 한 줄만 안 보이고 문자는 그대로 보내진다. Storage 설정은 필요 없다.
- 「오늘」 반 카드 · 과정 카드 — 「레포트 발송」 칩 줄 · 「과제 평균」 줄(같은 수업일 레포트 기간의 반 평균 과제율 · 80↑ 초록 · 50~79 파랑 · 50↓ 주황 ·
  링크 없는 학생 빼고 「(링크 없는 2명 제외)」 · 「이번 주 진행 중 40% · 2/5일 지남」 · 불러오는 동안 「불러오는 중」).
- 「+ 과제 링크 연결」 — 흰 테두리 버튼 · 누르면 그 줄 아래에 링크 칸(applink.js · 창 없음) · [마라톤 사이트 열기 ↗] · [아이디 복사] [비밀번호 복사]
  (설정 「마라톤 사이트 로그인 정보」 → staff_vault · 직원만 · 화면에 글자로 안 나옴) · 잘못된 링크 「앱 공유 링크가 아닙니다」.
- 학생 줄 [문자] = 그 학생 한 명 창(받는 사람 · 번호 뒤 4자리 · 기본 학부모만 · [+ 다른 학생 추가]) · 상담 카드에도 [문자]. 반 카드는 [전체 문자 발송].
- 상담 카드 — 「학생 입구 로그인 기록」 칸 대신 이름 옆 「마지막 로그인 10/24」 · 사진을 누르면 가운데 크게(바둑판도 같이).
- 버튼 이름 [레포트 작성](반 카드 · 과정 카드 · 수업일 고르기) · 정렬은 「학생 n명 접기 ▴」 띠 오른쪽 끝 [많이 한 순] [적게 한 순] (발송은 목록 머리줄).
- 「과제 —」 대신 「과제 · 수업일 정하면 보임」 · 「과제 없음(이 기간)」. 과제 칩 색 5일 초록 · 3~4 파랑 · 1~2 주황 · 0 빨강 (AppWeek.tone · 과제 상세도).
- 「오늘 할 일」 [건너뛰기] → report_skips (칩 회색 「건너뜀」 · 누르면 되돌리기 · 수업일 고르기 줄 옅게 · 작성 화면 「건너뛴 수업입니다 · 되돌리기」).
  「챙길 학생」 [확인함] · 이름 [×] → care_checks (같은 수업 · 같은 결석 건) · 「확인함 기록 보기」에서 되돌리기. 누가 · 언제는 서버 트리거가 채운다.

### 5-37. 20261031f — 과제 칩 자세히 보기 (SQL · 함수 배포 없음)
- 「과제 n/5일」 칩 — 마우스를 올리면 한 줄 말풍선(기간 · 평일 n일 중 n일 제출) · 누르면 그 줄 아래 7칸 표(today.js detailHtml · paintDetail · 한 번에 한 학생).
  과제 ● ◐ ○ · 강의 ✓ – · 토 · 일은 「주중 복습」 한 칸 · 칸을 누르면 그날 과제 이름 · 제출 시각(app-report history 의 title · submittedAt) · [과제 상세 보기 →].
- 「오늘」 · 레포트 발송 · 학생 명단 과제 칸이 같이 쓴다. 이미 불러온 기록만 쓴다 (새로 부르지 않음).

### 5-38. 20261031g — 세 기간 과제 · 반 단위로 한 번에 받기 · 10분 기억 · 5분마다 (app-report 다시 배포)
1. Edge Functions → **app-report** → `supabase/functions/app-report/index.ts` 전체로 바꿔 **Deploy** (Verify JWT 끈 그대로).
   새 `?codes=코드,코드,…`(30명까지) — 함수 안에서 8명씩 동시에 받아 한 번에 돌려준다(「오늘」용 가벼운 기록 · 최근 120일). `?code=` 한 명은 예전 그대로.
   다시 배포하기 전에는 코치룸이 알아서 예전처럼 학생마다 부른다(느리지만 빠지는 것 없음). SQL · Storage 는 필요 없다.
- 「오늘」 반 카드 — 펼친 학생 목록 머리칸 「10/8~14」 · 「10/15~21」 · 「진행 중 10/22~」(지지난 · 가장 최근 레포트 기간 · 최근 수업일 ~ 오늘) ·
  학생 줄은 숫자 칩만 「4/5」(비율 색 100 초록 · 60~80 파랑 · 20~40 주황 · 0 빨강 · AppWeek.tone) · 진행 중은 어제까지 지난 평일 · 점선 · 「시작 전」 ·
  링크 없는 학생은 세 칸을 합친 [+ 과제 링크 연결] · 머리칸을 누르면 그 기간 정렬(▼ 많이 한 순 ▲ 적게 한 순 · mhub.appSortP · mhub.appSort) ·
  과제 평균 줄도 같은 세 기간 · 과정 카드는 반별 목록마다 머리칸. 레포트 발송은 그 레포트 기간 칩 하나 그대로.
- 휴대폰(390px 이하) — 「이름 | 세 칸 | ⋯」 한 줄 · 머리칸 「10/8~」 「진행」 · 학생 줄 버튼은 「⋯」 메뉴.
- 불러오기 — 반마다 한 번(AppFetch.getMany) · 이 기기에 10분 기억(mhub.appCache · 최근 70일만) → 다시 열면 바로 보이고 뒤에서 새로 ·
  「오늘」이 보이는 동안 5분마다 · 「과제 10:35 기준 · 새로고침」 · 다시 받는 동안 칸만 바꾼다(깜빡임 · 줄 순서 바뀜 없음).
  흉내 낸 네트워크(4반 × 8명 · 학생 한 번 850ms)로 잰 첫 화면 — 예전 32명 모두 약 5.9초 → 지금 약 1.5초 · 10분 안에 다시 열면 약 0.8초(화면이 뜨는 시간).

### 5-39. 20261031h — 레포트 발송 첫 화면 · 반 고르기 「안 보냄 n」 · 작성 화면 학생 카드 「과제」 (SQL · 함수 배포 없음)
- 「레포트 발송」 탭 — 그날 처음이거나 마지막으로 보던 레포트를 다 보냈으면 가장 급한 레포트(지난 수업 · 안 보냄 · 가장 오래된 것 · 건너뜀 · 첫 수업일 앞은 빼고)의 반 · 수업일을 연다
  (반 전원 공개면 3 발송) · 「보낼 차례인 10/22(목) 고2 선수능반 레포트를 열었습니다 · 다른 반 고르기」 · 보낼 게 없으면 가장 최근 수업일.
  그 밖에는 마지막으로 보던 반 · 수업일(localStorage `mhub.reportLast` · 새로고침해도) · 「오늘」 [보내기] · 칩이 먼저. Today.sendState / nextToSend (「오늘」 반 카드 칩과 같은 기준).
- 반 고르기 — 순서 그대로 · 빨간 「안 보냄 12」 · 초록 ✓ (과정은 그 회차 반 합) · 수업일 고르기 「지금 보낼 차례」.
- 작성 화면 학생 카드 「과제」 — 그 레포트 기간 「과제 3/5일」 · 누르면 7칸 표 · 「과제 연동 전」 [+ 과제 링크 연결](그 자리 링크 칸) · 현황 줄 「과제 연동 전 n명」(차례로 이동) ·
  「오늘」이 반마다 받은 기록(10분 기억)을 그대로 — 새로 부르지 않는다. 과정 화면 반별 카드도 같다.

### 5-40. 20261031i — 출석 체크 · 결석생 챙기기 · 출석부 · 퇴원일 (migration-037-attendance.sql)
1. Supabase SQL Editor 에서 `supabase/migration-037-attendance.sql` 실행 (036 다음 · 여러 번 실행해도 안전 · 기존 출결은 지우지 않음). 함수 · Storage 배포는 없다.
   - entries 에 `att_material`(자료 배부) · `att_makeup`(보강 영상 신청 · 둘 다 기본 true) · `attend_by` · `attend_at` — 출결은 지금처럼 entries 한 곳 (출석 체크 = 레포트 학생 카드 출결)
   - `attend_checks`(반 + 주 「출석 체크 완료」 · 누가 언제) · `attend_log`(출결을 바꿀 때마다 한 줄 · 트리거가 씀 · 직원만 읽음)
   - `students.left_on` 퇴원일 · entry_patch 가 결석생 두 칸도 저장 · care_checks 종류에 material · makeup
- 「오늘」 반 카드(과정은 그날 수업하는 반) · 작성 화면 위 [출석 체크] — 수업 당일 · 다음 날 · 「출석 체크 완료 · 결석 2 · 지각 1 · 고치기」 (admin/attend.js)
  이름 타일 바둑판(전원 출석) · 한 번 결석 · 두 번 지각 · 세 번 출석 · 결석생 [✓ 자료 배부] [✓ 보강 영상 신청] · 지각 메모 · 「출석 10 · 결석 2 · 지각 0 / 12」
- 「챙길 학생」 — 결석생 자료 미배부 · 보강 영상 미신청 (반 + 수업마다 · 누르면 출석 체크 그 학생 · 확인함 · ×). 학부모 · 학생 레포트에는 넣지 않는다.
- 학생 → 출석부 (admin/attbook.js) — 반 · 월 · 학생 × 수업일 · 합계 · 반 전체 · CSV. 퇴원일 — 그 뒤 수업부터 출석 체크 · 레포트 · 「오늘」 · 문자에서 빠짐 (Store.isActiveOn).

### 5-41. 20261031j — 과제 수정 (migration-038-hw-fix.sql)
1. Supabase SQL Editor 에서 `supabase/migration-038-hw-fix.sql` 실행 (037 다음 · 여러 번 실행해도 안전). 함수 · Storage 배포는 없다 (app-report 는 그대로).
   - `hw_fixes` 「과제 수정」 기록 — 학생 · 날짜 · 바꾼 상태(onTime · late · none · exempt · app=원래대로) · 사유 · 원래 앱 값 · 고친 사람 · 시각(서버가 채움). 직원만 읽고 넣기만 (고치기 · 지우기 없음)
   - `hub_hw_fix(코드)` 러닝노트용 — 바꾼 상태만. 공개한 레포트 기간은 공개할 때 레포트에 담은 값(report_data.hwFix · hwFixTo)
   - `staff_hub_hw_fix` 미리보기 · `staff_hw_fix_cut` 「다시 공개해야 학부모에게 반영됩니다」
- 7칸 표 칸 → [고치기] → 정시 제출 · 늦게 제출 · 미제출 · 면제(셈에서 뺌) + 사유(앱 오류 · 종이로 제출 · 결석으로 면제 · 기타) → 작은 「수정」 · 「원래 앱: … → 수정: …」 · [원래대로] (admin/hwfix.js · today.js)
- 앱 기록 위에 덮어서 센다 (AppWeek.withFix · 면제는 분모에서 뺌) — 과제 칩 · 평균 · 정렬 · 레포트 · 러닝노트 · AI 초안. 앱에서 다시 받아 와도 유지.

### 5-42. 20261031k — 과제 링크 바꾸기 · 링크 확인 필요 (Edge Function app-report 다시 배포)
1. Supabase 대시보드 → Edge Functions → `app-report` → 코드 전체를 `supabase/functions/app-report/index.ts` 로 바꿔 Deploy (Verify JWT 끔 그대로). SQL 은 없다.
   - 앱에 등록된 학생 이름(`who` · 앱이 보낼 때만)을 함께 넘긴다 → 코치룸이 우리 학생 이름과 다르면 「링크 확인 필요」. shape 에 `student` 항목 이름도 더함
- 7칸 표 맨 아래 [링크 바꾸기] → 「+ 과제 링크 연결」과 같은 칸에 지금 링크 · [저장] [취소] [링크 지우기] (admin/applink.js · open(ids, { edit: true }))
- 저장하면 그 학생만 화면 메모리(AppFetch.forget) · 10분 기억(mhub.appCache)을 지우고 바로 다시 불러온다
- 만료(expired) · 이름이 다름 → 주황 「링크 확인 필요」 (「오늘」 · 레포트 발송 · 작성 화면 학생 카드 · 학생 명단)

### 5-43. 20261031l — 복습 노트 (한 장 요약 + OX 퀴즈 · migration-039-review-note.sql · Edge Function lesson-summary 다시 배포)
1. Supabase SQL Editor 에서 `supabase/migration-039-review-note.sql` 실행 (038 다음 · 여러 번 실행해도 안전).
   - `review_notes` 반 + 수업 주마다 노트 한 장 (draft 초안 · confirmed 확정본 — 러닝노트는 확정본만). 쓰기는 함수만 (`review_note_draft` · `review_note_confirm` · `review_note_unconfirm` · `review_note_discard`)
   - 과정(§) 칸에서 확정하면 `_course_member_dates` 로 그 회차의 반마다 같은 노트 (from_course · 반에서 따로 확정한 것은 그대로)
   - `hub_review_notes(코드)` 러닝노트 · `staff_hub_review_notes` 미리보기 · `hub_review_note_open` 학생 링크로 연 것만 · `staff_review_note_opens` 반 전체 숫자만
   - `review_note_opens` 는 아무도 직접 못 읽는다 (숫자만 함수로). OX 점수 · 풀었는지는 서버에 없다 (학생 기기 localStorage `mhub.rnox.주`)
2. Edge Functions → `lesson-summary` → 코드 전체를 `supabase/functions/lesson-summary/index.ts` 로 바꿔 Deploy. 키는 그대로 (ANTHROPIC_API_KEY · Secrets).
   - `kind: "review"` — op make(자막 → 노트 + OX → 두 번째 호출로 OX 문항마다 기준 검사 → 4개 미만이면 OX 없음) · field(칸 하나) · quiz · polish(자막 없이 말만)
   - 같은 Sonnet · 같은 월 상한(summary_begin · `review_note_usage`). 자막 원문은 저장하지 않는다
- 코치룸: 「수업 내용」 [📒 복습 노트 만들기] → 「복습 노트」 칸 (admin/reviewnote.js) · 자막은 「✨ 영상 자막으로 채우기」에 넣은 것 (Summary.source · 이 화면 메모리에만)
- 러닝노트: assets/review-note.js — 레포트 수업 영상 아래 「이번 수업 복습 노트」 · 「복습 노트 모음」 · 휴대폰 한 장 · OX 한 문제씩(학생) · 접어서(학부모) · 인쇄 / PDF
- 「오늘」 반 카드 「이번 복습 노트 연 학생 n/전체」

### 5-44. 20261031m — 「문자 발송」 탭 · 새 학생 앱 안내 문자 (migration-040-sms-tab.sql · Edge Function sms-send · kakao-send 다시 배포)
1. Supabase SQL Editor 에서 `supabase/migration-040-sms-tab.sql` 실행 (039 다음 · 여러 번 실행해도 안전).
   - `sms_batches` 한 번 보낸 묶음 (문구 이름 · 쓴 글 · 수업일 · 입장코드 — 보낸 기록 · 실패만 다시 보내기) · `sms_batch_list` · `sms_batch_get` (알림톡 kakao_log 도 직원 · 주 · 분마다 한 묶음)
   - `classes.app_code` 반 「앱 입장코드」 · `class_app_code_set`
   - 문자 설정에 한 달 최대(monthMax · 기본 3000) · 앱 설치 링크(androidUrl · iosUrl · `sms_app_links_set`) · `sms_settings_get` 에 이번 달 건수(month)
   - `sms_prepare` 새 칸 — #{입장코드}(p_vars · 학생마다) · #{앱 설치 링크} · p_label · p_purpose · 한 달 최대 · 묶음 줄. 예전 모양(8칸)은 지운다
   - 자주 쓰는 문구 순서(`sms_templates_reorder`) · 「앱 안내(기본)」 문구 (처음 한 번만 · 지우면 다시 안 생김)
2. Edge Functions → `sms-send` → `supabase/functions/sms-send/index.ts` 전체로 Deploy (label · purpose · vars 를 넘김 · 040 전이면 예전처럼)
3. Edge Functions → `kakao-send` → `supabase/functions/kakao-send/index.ts` 전체로 Deploy
   - action `health` — 필요한 Secrets 다섯 개가 들어갔는지 true/false 만 (값은 절대 안 돌려줌). `status` 도 템플릿 ID 값 대신 `templateSet`
   - `fallback: true` — 「카톡으로 보내기(안 받는 사람은 문자로)」 · 이번만 문자로 대신 (설정의 문자 대체는 그대로)
   - 둘 다 Verify JWT 는 끈 채로 (예전과 같음)
- 코치룸: 위쪽 탭 「문자 발송」(app.js TABS 9 · `#tab=sms`) — 보내기 · 자주 쓰는 문구 · 보낸 기록 · 연결 상태. 예전 문자 창(smsModal) · 기록 창 · 「오늘」 → [설정]의 알림톡 · 문자 칸은 이 탭으로 옮겼다
- 다른 화면의 [문자] · [전체 문자 발송] · [반 전체 문자] · [앱 안내 문자]는 모두 이 탭의 「보내기」를 골라진 채로 연다 (Sms.open · data-sms-cls · data-sms-sid · data-app-invite)
- 학생 등록(한 명 · 엑셀 · CSV) 「등록하면 마라톤 앱 안내 문자 보내기」 → 저장 뒤 확인(받는 사람 · 번호 뒤 4자리 · 실제 문구) → [보내기] → 상담 카드 「10/29 앱 안내 문자 보냄」

### 5-45. 20261031n — 「앱에서 보기 ↗」 · 「앱에서 자세히 보기 ↗」 (migration-041-app-more.sql · 함수 배포 없음)
1. Supabase SQL Editor 에서 `supabase/migration-041-app-more.sql` 실행 (040 다음 · 여러 번 실행해도 안전).
   - 문자 칸 `#{앱 안내}` — 앱 공유 링크(student_links.app_share_code)가 있는 학생만 「과제를 더 자세히 보시려면 레포트의 '앱에서 자세히 보기'를 눌러 주세요」 · 없으면 그 줄을 뺀다 (`sms_prepare` 는 040 과 같고 이 칸만 더함 · `_sms_app_note`)
   - 「자주 쓰는 문구」의 「레포트 안내」 끝에 `#{앱 안내}` 한 줄 (이미 있으면 그대로)
- 코치룸: `AppLink.openHtml(학생 id)` (applink.js) — 공유 링크를 새 탭으로 · 없으면 [+ 과제 링크 연결] · 「링크 확인 필요」(today.js linkWarn)면 주황 점 + 먼저 「링크가 만료됐을 수 있습니다 · 링크 바꾸기」
  7칸 표 아래 · 작성 화면 학생 카드 과제 줄 · 레포트 발송 학생 ⋯ · 「오늘」 학생 ⋯ · 상담 카드 머리
- 러닝노트(hub.js appMoreHtml): 「과제 상세」 탭 맨 위 안내 한 줄 + [앱에서 자세히 보기 ↗] · 레포트 과제 요약 아래 작은 한 줄 · 링크 없으면 숨김 · 버튼 높이 44px · 반짝임 없음 (예전 맨 아래 「앱 리포트 열기 ›」는 없앴다). 학생 링크 · 학부모 링크 · /s/ 모두 같은 화면
- 레포트 발송 → 3 발송 문구 복사 · 카톡용 · 내 폰 문자 — 링크가 있는 학생은 끝에 같은 한 줄 · 「단톡방 안내 문구」에도 한 줄. 알림톡 템플릿은 그대로

### 5-46. 20261031o — 「오늘」 학생 줄에서 바로 상담 · 다음에 확인할 것 (migration-042-quick-note.sql · 함수 배포 없음)
- 앞서 만든 과제 현황 이미지 · 운영진 사진 문자(3ea6700)는 되돌렸다 (push · SQL · 함수 배포 전 · 그 migration-042-ops-mms.sql 은 없다)
1. Supabase SQL Editor 에서 `supabase/migration-042-quick-note.sql` 실행 (041 다음 · 여러 번 실행해도 안전 · 확인 세 줄 모두 true).
   - `student_notes.next_check` 「다음에 확인할 것」(200자 · 비워도 됨) · 분류에 과제 독려 · 학습 상담 · 학부모 연락 (예전 분류 그대로)
- 코치룸 quicknote.js — 「오늘」 · 레포트 발송 학생 줄 이름 아래 「마지막 상담 10/15」 · 「상담 없음」 · 「오늘 상담 ✓」, [상담 +] → 그 줄 아래 칸(지난 상담 · 지난번 약속 + 그 뒤 과제 기록 · 이전 상담 더 보기 · 분류 · 내용 · 다음에 확인할 것 · 확인 필요)
  저장하면 student_notes 에 한 줄 (상담 카드와 같은 표) · 줄 정렬은 그대로. 상담 카드에 「다음에 확인할 것」 칸 · 맨 위 「지난번 약속: …」
- 상담 내용 · 약속은 학생 · 학부모 화면(/me/ · /s/)이 읽지 않는다 (student_notes 는 직원만)

### 5-47. 20261031p — AI 초안 직접 고치기 · AI에게 고쳐 달라고 하기 (migration-043-ai-requests.sql · text-polish · lesson-summary 다시 배포)
1. Supabase SQL Editor 에서 `supabase/migration-043-ai-requests.sql` 실행 (042 다음 · 여러 번 실행해도 안전 · 확인 두 줄 모두 true).
   - `ai_requests` — 「이 요청을 이 반 기본으로 기억하기」(scope = 반 이름 · 과정은 「§과정 이름」 · 요청 2~300자 · 같은 글은 한 번) · 직원만
2. Edge Functions → `text-polish` → `supabase/functions/text-polish/index.ts` 전체로 Deploy
   - action `revise` — 지금 글(손으로 고친 것 포함)을 요청대로 (처음부터 새로 쓰지 않음 · 자리표시 · 링크는 그대로 · 숫자 · 날짜는 지금 글 · 자료 · 원래 글 안의 것만)
   - draft 에 `requests`(반 기본 요청) · `keep`(칸에 있던 글 — 화면이 초안 끝에 그대로 붙임) · 「확인할 것」은 일반 당부를 거르고 2개까지 (`cleanChecks`)
3. Edge Functions → `lesson-summary` → `supabase/functions/lesson-summary/index.ts` 전체로 Deploy (복습 노트 polish + `request` · make · polish 에 `requests`)
- 코치룸 aipolish.js — 모든 AI 칸(반 공통 · 학생 코멘트 · 수업 내용 · 반 공지 · 문자 · 문구 · 교재 안내 · 인사말 · 상용구): 초안 칸이 입력 칸(「직접 고친 내용 있음」 · AI 초안으로 되돌리기) ·
  「AI에게 고쳐 달라고 하기」(빠른 버튼 · 300자 · 이대로 고치기 · 한 단계 전으로 · 반 기본으로 기억하기) · 「빼 줘」 항목은 자료에서 뺌(`AiPolish.exclude`) · 「다시 쓰기」 → 「처음부터 다시 쓰기」
  초안은 늘 결과 창에 먼저 (칸이 비었으면 [칸에 넣기]). 복습 노트(reviewnote.js)도 같은 요청 칸 · 반 관리 「AI 기본 요청」 열 · 과정 관리 카드에서 보고 지운다

### 5-48. 20261031q — 신입생은 수강 시작일부터 · 「오늘 할 일」 이름과 짐작한 이유 (migration-044-start-on.sql · 함수 배포 없음)
1. Supabase SQL Editor 에서 `supabase/migration-044-start-on.sql` 실행 (043 다음 · 여러 번 실행해도 안전 · 확인 세 줄 모두 true).
   - `students.start_on` 수강 시작일 — 비어 있던 학생은 상담 카드 수강 시작일 → 등록일로 한 번 채움 (이미 공개 · 발송한 레포트가 있으면 그 주 첫날까지 당겨서 사라지지 않게)
   - 새로 등록할 때 비면 등록한 날 (코치룸은 그 반 다음 수업일을 기본값으로) · 상담 카드 수강 시작일과 서로 같은 값 (트리거)
   - `care_checks.kind` 에 report — 「오늘 할 일」 학생 이름 옆 × (그 학생만 그 수업 레포트 건너뛰기)
- 코치룸: `Store.isActiveOn(학생, 주)` 가 수강 시작일 앞 수업을 뺀다 → 작성 · 공개 · 발송 목록 · 공개 n/전체 · 보냄 n/전체 · 탭 배지. 「오늘」 칩 · 오늘 할 일 · 과정 카드는 `Store.inLesson`
  앱 기록에 `startOn` 을 붙여 AppWeek 가 그 앞 날을 「신입생」(hw 'new' · 셈에서 뺌 · allNew) · 첫 레포트 forLesson `newStudent` → 「첫 수업입니다 · 다음 레포트부터 과제 기록이 보입니다」
  레포트 데이터에 `startOn` (러닝노트가 날짜별 달력 · 과제 상세에서 같은 회색). 복습테스트 챙길 학생도 시작일 앞 시험은 뺀다. 시작 2주 안 된 학생은 「신입」
  「오늘 할 일」 — 안 보낸 학생 이름(3명까지 · 넘으면 「홍민기 외 4명」 펼치기) · 짐작한 이유(신입 · 10/29 등록 · 번호 없음 · 보내기 실패 · 결석 · 퇴원 예정) · 이름 옆 ×
  학생 등록 창 · 엑셀 넣기 — 수강 시작일 칸 (기본값 그 반 다음 수업일)

### 5-49. 20261031r — 여러 명에게 보낼 때 「내 번호로도 한 통 받기(맨 위 학생 기준)」 (SQL · 함수 배포 없음)
- 코치룸 sms.js — 문자 발송 → 보내기 · 레포트 발송 반 카드 [알림톡 n명 보내기](kakao.js) 에 체크(기본 켜짐 · 이 기기에 기억 `mhub.copyMe`)
  보낸 뒤 맨 위 학생 내용 그대로 「나에게 시험 발송」과 같은 길로 내 시험 번호에 한 통 (sms-send `test` · 알림톡이면 kakao-send `test`)
  확인 창 「+ 내 번호 1통」 · 보냄 표시(sent)에 세지 않음 · 보낸 기록의 시험 묶음은 「내 번호 확인용」 · 내 시험 번호가 비면 체크를 끄고 안내
- 실패만 다시 보내기 · 학생 한 명에게 보내기에는 붙이지 않는다

### 5-50. 20261031s — 새 학생 링크 바로 만들기 · 로그인 불가 표시 (migration-045-links.sql · 함수 배포 없음)
1. Supabase SQL Editor 에서 `supabase/migration-045-links.sql` 실행 (044 다음 · 여러 번 실행해도 안전).
   - 링크 없는 학생(퇴원 제외) 모두 학부모 · 학생 링크 · 맨 아래 「링크 만든 학생 n명」 · 새 학생은 트리거로 바로 · student_login 은 학생 링크가 없으면 그 자리에서 만들어 들어감
- 코치룸: 등록(한 명 · 엑셀 · CSV · 번호 한꺼번에 넣기) 직후 `UI.issueMissing` 이 학부모 · 학생 링크 둘 다 · 못 만들면 명단 [링크 만들기]
  `Store.loginBlock` — 명단 · 복습테스트 화면 「로그인 불가 · 반 없음 / 학생 번호 없음」(누르면 그 칸이 열린 수정 창)
- 학생 입구(/s/ · entry.js) 실패 문구 — 「이 반에 그 이름이 없습니다」 · 「비밀번호는 학생 휴대폰 번호에서 010을 뺀 8자리입니다」

### 5-51. 20261031t — 수업 영상 카드에 어떤 수업이었는지 · 키워드 (migration-046-video-keywords.sql · 함수 배포 없음)
1. Supabase SQL Editor 에서 `supabase/migration-046-video-keywords.sql` 실행 (045 다음 · 여러 번 실행해도 안전 · 확인 세 줄 모두 true).
   - `lesson_summaries.keywords` — 확정할 때 트리거로 (복습 노트 「다룬 지문」 → 「작품명」 → 요약 줄 말마디 · 5개까지 · AI 없음) · 지난 확정본은 한 번 채움
   - `summary_keywords_rebuild` · `summary_keywords_set` (직원만) · `_weekly_of` 주마다 `keywords`
- 러닝노트 hub.js — 수업 영상 탭 · 레포트 「이 수업 영상」 카드: 차시별 한 줄 · 키워드 칩 · 기본 제목이면 첫 차시 한 줄 크게 · 탭 맨 위 「키워드로 찾기」
- 코치룸 summary.js — 수업 내용 칸 아래 키워드 칩(× · 넣기 · 키워드 다시 만들기)

### 5-52. 20261031u — 조교는 이름 + 휴대폰 번호 8자리로 (migration-047-phone-login.sql · 새 함수 staff-login)
1. Supabase SQL Editor 에서 `supabase/migration-047-phone-login.sql` 실행 (046 다음 · 여러 번 실행해도 안전 · 확인 세 줄 모두 true).
   - `staff.phone_hash` · `phone_last4` · 비밀 값 표 `staff_phone_secret`(정책 없음) · 시도 기록 `staff_phone_attempts`
   - `staff_phone_login`(service_role 만) · `staff_list`(직원) · `staff_set_active` 는 원장만 · 팀 가입 코드 지움
2. Edge Functions → Deploy a new function → 이름 `staff-login` → `supabase/functions/staff-login/index.ts` 전체 → Deploy → **Verify JWT 끄기**. 새로 넣을 키는 없다.
3. (권장) Authentication → Sign In / Providers → Email → **Allow new users to sign up 끄기** — 이메일 가입은 더 이상 쓰지 않는다. 번호 로그인은 함수가 계정을 만들므로 꺼도 된다.
- 코치룸 로그인 화면: 이름 · 휴대폰 번호(010 뺀 8자리) · [들어가기] / 아래 「다른 방법으로 로그인」(이메일) · 더보기 → 운영진

### 5-53. 20261031v — 못 불러온 n명 다시 불러오기 · 테스트 결석 기본값 · 「오늘」 기준 · 과제 상세 두 덩어리 (migration-048-test-status.sql · 함수 배포 없음)
1. Supabase SQL Editor 에서 `supabase/migration-048-test-status.sql` 실행 (047 다음 · 여러 번 실행해도 안전 · 확인 세 줄 모두 true).
   - `review_absences.auto` · 사유 `none`(미응시) · `taken`(응시 · 점수 없음) · `review_default_absent`(마감 지난 수업 · 하나도 안 낸 · 표시 없는 학생만 결석) · `review_status_set` · 하나 내면 다른 시험 기본값 결석도 풀림
- 작성 화면(write.js · today.js) — 목록 위 「못 불러온 n명 다시 불러오기」 · 「불러오는 중 3/8」 · 끝나면 「다 불러왔습니다」 또는 이름(이유) · 처음 열 때 한 번 저절로
- 학생 카드 [결석] [미응시] [응시] (review.js) — 같이 바뀜 · [따로 정하기] · 「따로」 · 직접 고른 값은 덮지 않음 · 기본값 결석은 출결을 안 바꿈
- app-week.js — 오늘(밤 12시 마감 전)은 아직이면 안 셈 · 냈으면 셈 · 칸 「오늘」 (today.js 진행 중 기간도 어제 대신 오늘 기준)
- 러닝노트 hub.js — 과제 상세 「이 수업 과제 (L-7~L-1)」 · 「진행 중 · 다음 수업까지 (L~다음 수업 전날)」 · 맨 아래 전체 누적 · 달력 (L = 연 레포트 수업일 · 바로 열면 가장 최근 수업일)

### 5-54. 20261031w — 반 수업 시각 · 종강일 · 담당 운영진 · 필기 QR · 필기 알림 · 문의 안내 (migration-049 · 050 · 새 함수 note-remind)
1. Supabase SQL Editor 에서 `supabase/migration-049-class-time-notes.sql` 실행 (047 · 048 다음 · 여러 번 실행해도 안전 · 확인 다섯 줄 true + 마지막 줄 「시각 넣은 반」에 지금 반 세 개).
   - `staff_phones`(운영진 문자용 번호 · 운영진만 읽음 · 로그인할 때마다 맞춤) · `staff_phone_login` 다시 정의(047 과 같고 번호 저장만 더함)
   - `classes` start_time · end_time · end_on · staff_emails · note_remind(처음 끔) · remind_min(5) · 지금 반 세 개 값 · 12월 반 값(`app_settings.class_presets` · 만들지는 않음)
   - 필기 알림: `note_remind_log`(같은 날 한 번) · `note_remind_prepare`/`note_remind_record`(service_role) · `note_manual_prepare`(운영진) · `note_status` · 문구 두 개(문자 문구 관리)
   - 문의 안내: `app_settings.contact` · `contact_set` · `hub_contact()` · 「레포트 안내」 문구 끝에 카카오톡 채널 한 줄
2. Edge Functions → Deploy a new function → 이름 `note-remind` → `supabase/functions/note-remind/index.ts` → Deploy → **Verify JWT 끄기**. 솔라피 Secrets 는 sms-send 와 같은 것(새로 넣을 키 없음).
3. SQL Editor 에서 `supabase/migration-050-note-cron.sql` 실행 (매분 note-remind 호출 · pg_cron · pg_net). 「pg_cron is not available」이면 대시보드 → Integrations → Cron 을 켠 뒤 다시.
4. 코치룸 반 관리 → 수업 설정에서 반마다 「필기 알림 켜기」 (처음엔 모두 꺼짐 · 켜기 전에는 아무 문자도 안 감) · 설정 → 문의 연락처에 카카오채널 링크.

### 5-55. 20261031x — 「수업」 카드 읽기 쉽게 (함수 lesson-summary 다시 배포 · SQL 없음)
1. Edge Functions → `lesson-summary` 에 `supabase/functions/lesson-summary/index.ts` 다시 붙여 넣고 Deploy (Verify JWT 끔 그대로).
   - 요약 모양: 차시마다 `{ head, points[2~4] }` → 저장은 「머리말\n· 점\n· 점」 (번호는 화면이 「1교시」) · `mode: "reformat"` = 「요약 다시 만들기」(자막 없이 지금 요약을 새 모양으로)
- report-view.js `lessonBlocksHtml` — 새 모양 · 예전 한 줄(「1차시: … — …」)을 같은 모양으로 (러닝노트 레포트 · 수업 영상 탭 · 코치룸 미리보기 같다)
- hub.js — 카드 제목 「10/29(목) 수업」만 · 큰 제목 · 오른쪽 위 「n개」 · # 태그 없앰 · 영상 「▶ 수업 영상 보기」(여러 개면 차시 이름) · 키워드는 수업 영상 탭 카드에서만
- 코치룸 — 「수업 내용」 차시 칸 · 요약 초안 칸 여러 줄 · [요약 다시 만들기]

### 5-56. 20261031y — 날짜별 제출을 「과제 날짜」로 (SQL · 함수 배포 없음)
- app-week.js `normalize` — 과제 기록을 과제 날짜(강 번호의 달력 날짜 → 과제 이름 안의 「10/23(금)」 → 낸 날)로 묶고, 다음 날 마감을 넘겨 낸 과제는 늦게
  (달력이 정시라도 그날 과제가 모두 늦었으면 늦게 · 달력에 없던 과제 날짜는 새 칸 · 조교가 고친 칸은 그대로) — compute · cumulative · 정답률이 같은 기준
- 러닝노트 「날짜별 과제」 — 머리줄 「10/29(목) · 정시 · 67%」 · 개수는 2개 이상일 때만 · [숙제인증] · 이름 안 날짜 뺌 · 「늦게 · 10/29 제출」 · 「▶ 강의 다 봄 / 안 봄」

### 5-57. 20261031z — 새 조교 승인 (migration-051-staff-approval.sql · staff-login 배포)
1. SQL Editor 에서 `supabase/migration-051-staff-approval.sql` 실행 (049 다음 · 확인 줄: approval · 승인 대기 막기 true · 승인됨 n명 = 지금 운영진 모두).
   - `staff.approval` approved · pending · rejected (지금 있는 사람은 approved) · `is_staff` · 원장 확인 · `staff_status` 는 승인된 사람만
   - `staff_phone_login` 처음 보는 번호 → 승인 대기(사용 중 아님) · 거절 → rejected · 시간당 가입 제한 없앰
   - `staff_pending` · `staff_approve` — 사용 중인 운영진 누구나 · `approved_by` 를 운영진 목록에 · 사용 중지 · 다시 사용은 원장만(047 그대로)
2. Edge Function `staff-login` 배포 (문자는 보내지 않는다 · 새로 넣을 키 없음)
- 화면: 「승인을 기다리는 중입니다…」 · 「승인되지 않은 번호입니다」 · 「오늘」 맨 위 「새 조교 승인 대기: 이름(뒤 4자리) [승인] [거절]」(운영진 모두) · 운영진 맨 위 승인 대기

### 5-58. 20261101a — 챙길 학생을 학생 한 명당 한 줄로 (SQL · 함수 배포 없음)
- today.js — 「김민규 · 고2 선수능반 · 10/29 결석 → 보강 영상 안 봄, 자료 안 받음 [확인함]」 · 같은 학생 이유는 한 줄 · 반별 「n명」 · [모두 확인함] · 이름 = 상담 카드 · 최근 수업일이 위 · 2주 지난 것은 「지난 항목 n개」 · 종강 반 제외 · 「확인함 기록 보기」는 맨 아래 작게
- skips.js `checkMany` (여러 건 한 번에 확인함)

### 5-59. 20261101b — 「작성 중」 건너뛰기 · 수강 시작일 기본값 · 코치룸 아이콘 (SQL · 함수 배포 없음)
- today.js · skips.js — 반 카드 「작성 중」 칩 옆 [건너뛰기](묻지 않음 · 아래 「건너뜀 · 되돌리기」 5초) · 「건너뜀」 → [다시 작성하기] · [지난 작성 중 n개 모두 건너뛰기] · 공개한 레포트에는 없음 (report_skips 그대로)
- store.js `defaultStartDate` — 그 반 수업일 중 오늘이거나 앞선 가장 가까운 날 · 첫 수업 전이면 첫 수업일 · 한 명 등록 「수강 시작일: 11/1(토) · 바꾸기」 · 엑셀 넣기 반마다 같은 줄 · 이미 등록된 학생은 그대로
- `supabase/check-start-dates.sql` — 이미 등록된 학생 수강 시작일 분포 (읽기 전용)
- admin/index.html — 탭 아이콘 · 홈 화면 아이콘 `assets/coach-icon.svg` · `coach-icon-180/192.png` (보라 동그라미 · 러닝노트 · 학생 입구는 그대로)

### 5-60. 20261101c — 퇴원 처리를 상담 카드 맨 아래로 (SQL · 함수 배포 없음)
- card.js — 「기본 정보」의 퇴원일 칸(students.left_on · migration-037)을 맨 아래 [퇴원 처리]로 옮김 (마지막 수업일 기본 = 가장 최근 지난 수업일) · 퇴원한 학생은 [다시 다니는 중으로]
- today.js — 반 카드 학생 목록 맨 아래 「퇴원 n명」(접힘 · 이름 = 상담 카드) · 빠지는 곳은 그대로(Store.isActiveOn · inLesson · 서버 필기 알림 left_on)

### 5-61. 20261101d — 과제 기록 「못 불러옴」이 한꺼번에 생기던 것 (함수 app-report 다시 배포)
1. Edge Functions → `app-report` 에 `supabase/functions/app-report/index.ts` 다시 붙여 넣고 Deploy (Verify JWT 설정은 지금 그대로).
- 원인: 「오늘」이 반 4개를 동시에 · 함수가 반마다 8명씩 동시에 → 앱 서버에 한꺼번에 30여 건 · 12초에 끊고 다시 묻지 않음 · 25초가 넘으면 화면이 6명씩 또 부름
- 지금: 화면은 4명씩 한 묶음을 하나씩 차례로 · 함수는 3명씩 · 앱 서버가 바쁘거나(429 · 503) 응답이 없으면 0.7초 · 1.8초 쉬었다가 2번까지 다시 · 화면도 못 불러온 학생만 1.5초 · 4초 뒤 2번까지
- 「오늘」 반 카드 학생 목록 위 「못 불러온 n명 다시 불러오기」(작성 화면과 같음) · 칩에 짧은 이유(링크 없음 · 앱 응답 없음 · 앱 서버 바쁨 …) · 불러온 기록은 지금처럼 10분 기억(다시 불러오기 · 새로고침은 새로)

### 5-62. 20261101e — 입구 문자 · 신입생 웰컴 문자 (SQL 052 · 함수 sms-send 다시 배포)
1. SQL Editor → `supabase/migration-052-welcome-sms.sql` 전체 → Run → 맨 아래 다섯 줄 모두 `true`.
2. Edge Functions → `sms-send` 에 `supabase/functions/sms-send/index.ts` 다시 붙여 넣고 Deploy (Verify JWT 는 지금처럼 끈 채로 · Solapi Secrets 그대로 · 키는 새로 넣지 않는다).
- 학생 명단 「학생 입구」 줄: 「단톡방 안내 문구 복사」 → **입구 문자 보내기** (반 고르기 · 「아직 한 번도 로그인 안 한 학생만」 · 학생 본인 번호로만 · 글은 그 자리에서 고친다)
- 신입생 웰컴: 「자주 쓰는 문구」에 「신입생 웰컴(학생)」 · 「신입생 웰컴(학부모)」 (052 가 예전 「앱 안내(기본)」 글로 만든다) · 한 명 등록은 「웰컴 문자 보내기」(기본 켜짐)면 저장하는 순간 학생 · 학부모 1 · 2 로 · 엑셀 · CSV 는 다 넣은 뒤 묻는다
- 다시 보내기: 상담 카드 [웰컴·앱 설치 안내 다시 보내기] · 명단 반 이름 옆 [반 전체에 웰컴 안내](「아직 앱 링크 연결 안 된 학생만」) · 오늘 같은 사람에게 같은 종류를 이미 보냈으면 「오늘 이미 보냄」으로 빼 둔다
- 칸: {학생이름} {반이름} {첫수업일} {앱입장코드} {러닝노트주소} · 보낸 기록에 「입구 안내」 · 「웰컴 안내」 · 알림톡 템플릿은 그대로

### 5-63. 20261101f — 반 카드 수업 시각 [바꾸기] · 필기 QR 없앰 · 지금 반 세 개 값 넣기 (SQL 053)
1. (먼저 보기만) SQL Editor → `supabase/check-class-times.sql` → Run — 반마다 요일 · 시각 · 종강일 · 필기 문자가 지금 어떻게 들어 있는지 (아무것도 바꾸지 않음).
2. SQL Editor → `supabase/migration-053-class-times.sql` → Run → 맨 아래 세 줄(고2 선수능반 · 목동반 · 반포반)의 DB 이름 · 시각 · 종강 · 「필기 문자 켜짐 · 끝나기 5분 전」 확인. 「못 찾음」 · 「여러 반」이면 그 반은 「오늘」 반 카드 [바꾸기]로 넣는다.
- 「오늘」 반 카드: 「수업 토 18:30~22:00 · 필기 문자 21:55 켜짐 [바꾸기]」 → 그 자리에서 시작 · 끝 · 필기 문자 켜기/끄기 · 끝나기 몇 분 전 · 종강일 · 시각이 없으면 보라 테두리 [수업 시각 넣기]
- 「필기 미제출 n명」은 수업 날 끝나기 n분 전부터 그날 밤까지만 · [필기 QR 띄우기] · QR 화면은 없앴다 (운영진 필기 알림 문자에서도 QR 링크를 뺀다)

### 5-64. 20261101g — 과제 독려 문자 · 학생 줄 버튼 정리 (SQL 054)
1. SQL Editor → `supabase/migration-054-hw-nudge.sql` → Run → 맨 아래 두 줄 `true` (함수 배포 없음 · sms-send · Solapi Secrets 그대로).
- 「오늘」 반 카드 「과제 평균」 줄 「진행 중」 옆 [안 낸 학생 n명에게 독려 문자] — 진행 중 기간(지난 수업 ~ 오늘)에서 마감이 지난 평일 과제를 하나라도 안 낸 학생 (오늘 과제는 마감 전이라 세지 않음 · 앱 과제 기록 기준 · 링크 없는 · 못 불러온 학생은 판단 못 해 뺌) · 0명이면 「이번 주 모두 냄 👍」 · 번호 없음 n명
- 창: 이름 · 밀린 날짜 목록(체크를 빼면 제외) · 「학생에게」 기본 켜짐 · 「학부모에게도」 기본 꺼짐 · 「과제 독려(학생)」 · 「과제 독려(학부모)」 문구(그 자리에서 고치고 [문구 관리에 저장]) · 미리보기 1건 · 확인 한 번 · 오늘 보낸 학생은 「오늘 보냄」으로 빼 둠 · 반 카드에 「오늘 10:20 보냄 4명」 · 보낸 기록 「과제 독려」 · 상담 카드 「과제 독려 문자 10/31」
- 학생 줄 버튼은 [상담 카드] [문자]만 — 학부모 · 학생 화면 미리보기는 상담 카드 맨 위로

### 5-65. 20261101h — 과제 독려 대상 「지난 수업 이후」 (SQL 055)
1. SQL Editor → `supabase/migration-055-nudge-text.sql` → Run → 확인 한 줄 `true` (함수 배포 없음).
- 대상 = 직전 주(가장 최근 수업의 레포트 기간 D-7 ~ D-1 · 「10/24~30」 칩)와 진행 중(지난 수업 ~ 오늘)에서 마감이 지난 평일 과제를 하나라도 안 낸 학생 — 진행 중인 주가 막 시작해도 직전 주에 안 낸 학생이 잡힌다 · 오늘 과제는 마감 전이면 세지 않음
- 학생 줄 칩과 같은 계산 (칩 「3/5」면 밀린 날 2개) · 창 목록과 {밀린날짜}에 밀린 날짜를 모두(날짜 순) 「10/27(월) 10/28(화) 10/30(목)」
- 정말 0명일 때만 연하게 「밀린 과제 없음 👍」 (「이번 주 모두 냄」은 없앰) · 기본 문구도 「이번 주」 → 「지난 수업 이후」 (054 기본 글 그대로일 때만 · 고쳐 저장한 글은 그대로)

### 5-66. 20261101i — 「문자 발송」 보내기 화면 다시 만들기 (SQL · 함수 배포 없음)
- 휴대폰 기준 · 위에서 아래로 ① 누구에게 · ② 무엇을 · ③ 보내기
- ① 반 버튼 큼직하게(여러 개 · 종강한 반은 「종강한 반 보기」 안) → 바로 아래 그 반 학생 체크 목록(기본 전체 · 반별로 묶음 · 「전체 선택/해제」 · 「n명 중 n명」) · 이름 검색(고른 반 안 · 다른 반 학생은 「다른 반」 [+ 추가]) · 받는 사람 [학생] [학부모] [둘 다](기본 학생 · 3 발송 · 바뀐 내용 알리기는 둘 다) · 번호 없음 · 퇴원생은 저절로 빠지고 「번호 없음 n명」
- ② 「자주 쓰는 문구」 버튼 · 「짧게/보통/자세히」 없앰 → 「AI에게 부탁하기」 칸 하나(비었으면 새로 쓰기 · 글이 있으면 부탁대로 고치기 · 기존 text-polish 'revise' · 새 키 없음 · 되돌리기) · 칸 버튼 {학생이름} {반이름} … · 글자 수 · 단문/장문
- ③ 맨 아래 고정 「n명에게 보내기」 · 위에 첫 번째 받는 사람 미리보기 1건 · 확인 한 번 「목동반 학생 11명에게 보냅니다」 · 「보냄 n · 실패 n(이름)」 · 학생 줄 「보냄 18:09」 / 「실패(사유)」
- 다른 화면에서 채워서 여는 곳(반 카드 · 학생 줄 「문자」 · 상담 카드 · 명단 · 3 발송 · 바뀐 내용 알리기 · 내 정보 알리기 · 앱 안내)은 그대로 · 웰컴 · 입구 · 독려 문자는 자기 창(그대로)
- 광고 문자 규칙 · 보낸 기록 · 이미 보냄 · 공개 전 · 형제 번호 · 입장코드 · 카톡 알림톡 · 나에게 시험 발송 · 내 번호로도 한 통은 그대로

### 5-67. 20261101j — 수업 전 예고 문자 · 수업 끝 필기·복습 문자 (SQL 056 · 함수 note-remind 다시 배포)
- 수업 시작 n시간 전(기본 2시간 · 반 카드 [바꾸기]에서 켜기/끄기 · 1~12시간) 학생 본인에게 한 통 — 결석 · 퇴원 · 수강 시작 전 · 번호 없음 · 종강 · 보관 반 제외 · 학부모 안 감 · 같은 날 한 번(pre_remind_log)
- 지난 수업 이후(D-7 ~ D-1) 마감 지난 평일 과제 중 안 낸 날이 있으면 「수업 전 예고(밀린 과제)」 · 없으면 「수업 전 예고(다 함)」 · 칸 {학생이름} {반이름} {수업시각} {밀린날짜} {오늘수업} · 앱 기록을 못 받은 학생은 보내지 않음
- 056 을 처음 돌릴 때 지금 운영 중인 반(시작 시각 있음 · 종강 전)은 켜짐 · 반 카드 「수업 전 문자 16:30 켜짐」 · 보낸 날 「16:30 예고 문자 보냄 11명(밀린 4명)」 · 보낸 기록 「수업 전 예고」
- 수업 끝 n분 전 필기 문자 → 필기·복습 문자 — 둘 다 남음 「…오늘 필기 사진과 복습테스트 기록 올려 주세요: (링크)」 · 필기만 · 복습테스트만 · 둘 다 냈으면 안 보냄 · 그날 복습테스트가 없는 반은 필기 문구만 · 선생님 표시(미응시 · 결석 · 응시)는 낸 것으로
- 링크 — 필기만 `/me/#코드/photo/날짜` · 복습테스트만 `/me/#코드/review`(입력 카드가 바로 열림) · 둘 다 `/me/#코드/todo/날짜`(입력 카드 + 「📷 오늘 필기 사진도 올려 주세요 [필기 올리기]」) · 학생 링크가 없으면 `/s/?note=` · `?review=` · `?todo=` 반
- 문구 「필기·복습 알림(둘 다)」 「필기·복습 알림(복습테스트만)」 추가 (필기만은 예전 「필기 알림(학생)」) · 반 카드 「필기·복습 문자 21:55 켜짐」
- 배포: `supabase/migration-056-pre-remind.sql` 실행 → Edge Function `note-remind` 다시 배포 (050 매분 예약 · 솔라피 Secrets 그대로 · 새 키 없음)

### 5-68. 20261101k — 홈 화면 앱 · 안내 띠 (SQL 057 · 함수 배포 없음)
- 러닝노트 `s/manifest.webmanifest` — 이름 「러닝노트」 · RUN 아이콘(192 · 512 · maskable) · 시작 `/s/?app=1`(로그인돼 있으면 바로 내 러닝노트 · 학생 로그인이 없으면 이 기기에서 마지막으로 연 러닝노트) · 범위 `/marathon-hub/` · standalone
- 코치룸 `admin/manifest.webmanifest` — 이름 「코치룸」 · 보라 동그라미(192 · 512 · maskable) · 시작 `/admin/` · 범위 `/marathon-hub/admin/` (러닝노트와 다른 앱 · 더 좁은 범위라 /admin/ 은 코치룸 앱으로)
- `/me/` 는 아이폰이 아닐 때만 manifest 를 스크립트로 붙임 — 아이폰은 개인 링크 주소 그대로 홈 화면에 담김 · 세 화면 모두 apple-mobile-web-app-capable
- 서비스워커 `sw.js`(러닝노트) · `admin/sw.js`(코치룸) — 화면을 저장하지 않고 인터넷이 끊겼을 때 안내 한 장만
- `assets/a2hs.js` — 휴대폰에서 로그인한 직후 첫 화면 맨 위 띠 「📱 홈 화면에 추가하면 앱처럼 바로 열려요 [추가하기] [다음에]」 · 안드로이드 바로 설치 창 · 안 되면 ⋮ 그림 · 삼성 인터넷 ≡ 그림 · 아이폰 사파리 3단계 그림 · 아이폰 다른 브라우저 「사파리로 열어 주세요」 + 주소 복사 · 카카오톡 안은 「다른 브라우저로 열기」 먼저 · PC · 설치됨이면 없음 · [다음에] 7일 · 세 번이면 그만 · 러닝노트 내 정보 · 레포트 맨 아래 · 코치룸 더보기 「📱 홈 화면에 추가하는 법」
- 웰컴 · 입구 문자 기본 문구 끝 「홈 화면에 추가해 두면 앱처럼 바로 열려요.」 (`supabase/migration-057-a2hs-text.sql` — 052 기본 글 그대로일 때만)

### 5-69. 20261101l — 수업 전 예고 문자 3시간 전 · 학생마다 제출 수 (SQL 058 · 함수 note-remind 다시 배포)
- 기본 「수업 시작 3시간 전」 (반 카드 [바꾸기]는 그대로) · 058 이 지금 반 중 예전 기본 2시간 그대로인 반을 3시간으로 (결과에 반마다 시각)
- 함수가 학생마다 직전 수업 이후(D-7 ~ D-1) 마감 지난 평일 과제를 셈 — 전체수(과제 있던 평일 · 면제 · 수강 시작 전 제외) · 제출수(늦게 낸 것 포함) · 밀린날짜 · 오늘 과제 · 토 · 일 주중 복습은 안 셈
- 문구 넷 「수업 전 예고(다 냄)」 · 「(일부 냄)」(절반 이상) · 「(많이 밀림)」(절반 미만) · 「(과제 없음)」(전체 0) · 칸 {학생이름} {수업시각} {제출수} {전체수} {밀린날짜} {오늘수업} · 이모지 없음 · 056 의 두 문구는 고친 적 없으면 지움
- 문자 발송 → 자주 쓰는 문구 맨 위 「수업 전 예고 문자」 — 네 문구 나란히 · 우리 반 학생 한 명 기준 미리보기(숫자는 예시) · [고치기]
- 반 카드 「수업 전 문자 15:30 켜짐」 · 보낸 뒤 「15:30 보냄 11명(다 냄 5 · 일부 4 · 밀림 2)」
- 배포: `supabase/migration-058-pre-counts.sql` 실행 → Edge Function `note-remind` 다시 배포

### 6. GitHub Pages
저장소 → **Settings → Pages** → Source **Deploy from a branch** → Branch `main` / `(root)` → Save.
1~2분 뒤 `https://marathonstudy.github.io/marathon-hub/admin/` 이 열린다.

---

## 매주 순서

코치룸 위쪽 탭은 **오늘 · 레포트 발송 · 문자 발송 · 학생 · 교재 · 더보기** 여섯 개다(번호 없음 · 휴대폰 폭 480px 이하는 화면 아래 아이콘 줄).
레포트 발송는 **작성 ── 공개 ── 발송** 세 단계가 맨 위 주차 띠를 함께 쓴다(작성에서 고른 주가 공개 · 발송에도 그대로).
학생 = 명단 · 필기 노트, 더보기 = 반 공지 · 시험 관리 · 설정 · 사용 설명서. 예전 주소(#tab=write · send · roster · photo · notice …)도 그대로 열린다.

1. **레포트 발송 → 1 작성** — 주차 · 반 공통(수업일 · 수업 내용 · 테스트 · 과제 · 수업 영상 · 자료 파일 · 코멘트) · 학생별 입력
2. **레포트 발송 → 2 공개** — 다 쓴 학생이 체크돼 있다 → [N명 공개]. 고친 뒤에는 다시 공개
3. **레포트 발송 → 3 발송** — 반 카드 [알림톡 n명 보내기] · [반 전체 문자], 학생 줄 ⋯ (내 폰으로 보내기 · 문구 · 카톡용 복사). 링크는 학생마다 매주 같다
4. **더보기 → 반 공지** — 반(여러 개 가능) · 주차 고르고 내용 → [공지 올리기] (영상 · 자료 파일은 레포트 발송 → 1 작성 반 공통에서)

## 여러 기기에서 같이 쓰기

노트북·패드·휴대폰에서 조교 여러 명이 동시에 들어와도 서로 덮어쓰거나 지우지 않는다.

- **고친 줄(항목)만 저장한다.** 화면 목록 전체를 서버에 덮어쓰지 않고, 화면에 없다는 이유로 서버 줄을 지우지 않는다.
  지우기는 그 줄의 [삭제] 버튼을 눌렀을 때 그 줄 하나만.
- **늘 서버가 기준이다.** 탭을 열 때, 브라우저 창으로 돌아올 때 서버에서 다시 받는다.
  출결·과제 체크·지급 체크·납부처럼 한 칸씩 누르는 기록은 누르는 순간 그 칸만 저장되고,
  다른 기기에서 누른 칸은 새로고침 없이 보인다(실시간 반영, 안 되면 30초마다).
- **같은 칸을 두 사람이 동시에 고치면** 늦게 저장한 쪽에 *"다른 분이 먼저 수정했습니다. 새로 불러올까요?"* 창이 뜬다.
  [새로 불러오기] = 다른 분 내용 보기 · [내 내용으로 덮어쓰기] · [나중에].
  한 학생이라도 출결과 코멘트처럼 서로 다른 칸이면 둘 다 그대로 저장된다.
- 브라우저에는 로그인과 화면 설정만 남는다. 학생·작성·교재 자료는 브라우저에 저장하지 않는다.
  예외 하나 — 레포트 발송 → 1 작성에서 **아직 서버에 저장되지 않은 칸**만 이 기기에 잠깐 보관했다가(인터넷이 끊겼을 때 · 화면이 멈췄을 때 복구용),
  저장되면 바로 지운다. **로그아웃하면 지운다.** 같이 쓰는 컴퓨터에서는 꼭 로그아웃한다.

### 레포트 발송 → 1 작성 글 지키기 (유실 방지)
- **자동 저장**: 입력을 멈추고 1.2초 뒤 · 칸을 벗어날 때 · 다른 화면으로 가거나 탭을 숨길 때. 코멘트 창도 [저장]을 안 눌러도 저장된다
  ([취소]는 연 때 글로 되돌린다 · Esc 로 닫으면 쓴 글을 지킨다). 칸 옆에 「저장 중 · 저장됨 · 저장 실패」가 작게 보인다.
  저장에 실패하면(인터넷 끊김) 10초마다 다시 보낸다.
- **덮어쓰지 않는다**: 지금 커서가 있거나 아직 저장 안 된 칸은 실시간 반영 · 다시 불러오기가 바꾸지 않는다.
  늦게 도착한 옛 알림(내 저장의 옛 알림 포함)은 줄의 수정 시각을 보고 버린다.
  다른 사람이 같은 칸을 바꾸면 「다른 사람이 이 칸을 수정했습니다 [그 내용 보기]」 → [그 내용으로 바꾸기] / [내 내용 유지].
  어느 쪽이든 바뀌는 쪽 글은 [이전 내용]에 남는다.
- **실행 취소(Ctrl+Z)**: 코드가 칸 값을 바꿀 때는 칸을 새로 만든다(코멘트 창은 열 때마다 새 칸). 그래서 Ctrl+Z 는 그 칸에서 직접 친 것만 되돌린다.
- **임시 보관 · 복구**: 저장 전 내용은 이 기기에 잠깐 보관한다. 화면이 멈췄다 다시 열면 「저장 안 된 내용이 있습니다 [복구]」.
- **이전 내용 보기**(반 공통 코멘트 · 수업 내용 · 코멘트 창): 글이 한 번에 절반 넘게 줄면 줄기 전 글, 같은 칸을 10분 넘게 고치면 10분마다 이전 글이
  서버에 남는다(칸마다 최근 30개 · 직원만 · 아무도 못 지움). 골라서 [되살리기].
- 백업 되살리기·엑셀 넣기는 더하거나 고치기만 하고, 파일에 없는 학생을 지우지 않는다.

## 상담 카드 · 상담·관찰 기록

- 명단에서 **학생 이름**을 누르면 열린다. 확인 필요 기록(맨 위) → 기본 정보 → 내신 → 모의고사 → 기록 타임라인.
- 이름·학교·학년은 명단과 같은 값이다(여기서 고치면 명단도 바뀐다). 수강 시작일·특이사항은 카드에만.
- 성적 칸은 비워 둬도 된다. 원점수는 숫자, 등급은 1~9. 칸에서 나오면 그 칸만 저장된다. 최신 학년이 위.
- 기록은 쌓기만 한다. 고치면 "수정됨(누가·언제)", **삭제는 선생님(teacher) 계정만 — 지우지 않고 숨김**(삭제됨·누가·언제).
  선생님 계정은 [숨긴 기록·성적 보기]에서 되살릴 수 있다.
- "다음 상담 때 확인"으로 남긴 기록은 카드 맨 위에 고정되고, 명단에 **확인 N** 배지가 붙는다. [확인 완료]를 누르면 내려간다.
- 레포트 발송 → 1 작성의 학생 줄 [상담 기록 ▾]을 펼치면 그 학생의 확인 필요 기록과 최근 기록 5개 · [기록 추가] · [상담 카드 열기].
- **민감 정보** — staff 만 읽고 쓴다. 학부모 개인 페이지 · 반 공지 · 레포트 · 백업 파일 어디에도 들어가지 않는다.
- 엑셀 넣기에 **수강시작일** 열(선택)을 쓸 수 있다.

## 주요 시험 D-day

- 코치룸 맨 위 띠 → **[시험 관리]**: 시험 이름·날짜·메모, 전체 기본(가장 가까운 시험 자동 / 특정 시험 고정), 반별 시험.
- 개인 페이지에는 "OO 학생 · ○○까지 D-00", 반 공지 페이지에는 "○○까지 D-00" (그 반 기준).
- 한국 시간 자정마다 하루씩 줄어든다. 당일은 "○○ 당일입니다. 모두 화이팅!". 고정한 시험이 지나면 다음 시험으로 넘어가고,
  다가오는 시험이 하나도 없으면 D-day 줄을 숨긴다.

## 조교 로그인 · 운영진 (20261031u · migration-047)

- 조교: 코치룸 주소 → **이름 · 번호 8자리(010 뺀)** → **[들어가기]**. 가입 버튼 · 승인 · 가입 코드 · 미리 등록은 없다.
  처음 보는 번호면 그 이름으로 바로 조교 등록 · 이미 있는 번호면 이름이 맞을 때만(띄어쓰기 · 대소문자 무시) · 다르면 「이름이나 번호가 맞지 않습니다」.
  같은 번호 15분에 5번 · 전체 10분에 50번 틀리면 잠깐 막힌다. 새 등록은 전체 한 시간에 20명까지.
- 번호는 DB 에 그대로 남지 않는다 — DB 에만 있는 비밀 값과 섞은 해시 + 뒤 4자리만. 로그인은 Edge Function staff-login 이 한다
  (Supabase 가 함수에 기본으로 주는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 그 함수 안에서만 · 화면 · 저장소에는 없음).
- 원장(내 계정): 로그인 화면 아래 **[다른 방법으로 로그인]** → 이메일 · 비밀번호. 비밀번호 찾기도 그 안.
- 더보기 → **운영진**: 이름 · 번호 뒤 4자리 · 처음 들어온 날 · 마지막 접속. **[사용 중지]/[다시 사용]** 은 원장(teacher) 계정 화면에만 · 서버도 원장만 받는다.
  사용 중지하면 바로 아무것도 못 보고(열려 있던 화면도 곧 로그아웃), 쓴 기록은 그대로다.
- 예전 이메일 가입(팀 가입 코드)은 닫았다 — 047 이 남아 있던 코드를 지운다. 이미 이메일로 등록된 사람은 그대로 「다른 방법으로 로그인」으로 들어온다.

## 오늘 (코치룸 첫 화면 「오늘」)

- 머리 「오늘 · 10/23(금)」 · 제목 옆 ⓘ 를 누르면 급함 · 살펴보기 기준 줄 (20261029e).
- 맨 위 「오늘 할 일」(예전 숫자 카드 5개 대신): 반마다 주기 순서로 — 지난 수업일 레포트 「작성·공개·발송 보낸/전체 [작성하기]」(수업일부터, +2일[설정]부터 급함) ·
  오늘 수업 「복습테스트 진행 중 n/전체 [제출 현황]」 · 마감 지난 「복습테스트 미제출 n명 [확인하기]」 · 「확인 필요 상담 n건 [보기]」 · 「교재비 미납 n명 [교재]」(금액 없음).
  없으면 「지금 처리할 일이 없습니다 ✓」.
- 반 카드 줄: 「지난 레포트 공개 n/전체 · 발송 n/전체」 · 「복습테스트 n/전체 · 필기 n/전체 · 앱 과제 평균 n/7일」 · 「급함 n · 살펴보기 n」.
- 챙겨야 할 학생: 최근 4주 결석(보강 포함) 2회 이상 · 앱 과제 제출 50% 미만(지난 수업 전 일주일) · 필기 2주 연속 없음 · 확인 필요 상담. 탭 이름 옆 숫자가 이 인원.
- 레포트 발송 탭 옆 빨간 숫자(20261029f): 수업일 +n일([설정] 레포트 미발송 급함 날짜 · 기본 2)이 지나도 안 보낸 학생 수 — 「오늘」 급함과 같은 기준, 0 이면 숨김.
  마우스를 올리면 반별 「반포반 10/20 레포트 미발송 3명」. 레포트 발송 안 「작성 · 공개 · 발송 n/전체」는 고른 반 기준 그대로.
- 앱 과제(20261028b): app-report 의 앱 전체 누적(stats.submissionRate)은 쓰지 않는다. 날짜별 기록(calendar)을 러닝노트 「이번 주 과제·강의」 표와 같은
  `AppWeek.compute` 로 그 반 지난 수업일 D 전 일주일(D-7 ~ D-1 · 오늘이 수업일이면 오늘 기준)만 센다 (20261029h — 레포트 앱 과제 요약과 같은 기간).
  꼬리표 「앱 과제 3/6일」(제출일 / 과제 있던 날) · 누르면 「10/15~10/21 · 정시 2일 · 늦게 1일 · 미제출 3일」. 과제 있던 날이 없거나 수업 요일을 안 정한 반은 꼬리표 없음.
- 반별 카드(학원 → 반): 출결 · 작성/공개/발송 · 앱 과제 평균(실패 수) · 필기 · 미납 · 재고 부족 · 확인 필요. 누르면 학생 목록, 이름을 누르면 상담 카드.
- [설정](teacher 만 바꿈): 조교에게 교재비 금액 보이기(기본 보임 · 이 화면에만 적용), 결석 기준(몇 주 · 몇 회).
- 계산은 서버 함수 coach_today() 한 번. 반 카드는 공개 · 발송 수만 센다 (20261030a — 작성 완료 판정 없음). 앱 과제는 화면이 뜬 뒤 차례로 불러온다.
- `migration-007-dashboard.sql` 은 002 ~ 006 다음에 실행한다.

## 필기 노트 (러닝노트 「필기 노트」 · 코치룸 학생 → 필기 노트)

- 학생이 러닝노트 「필기 노트」 탭에서 카메라로 찍거나 앨범에서 여러 장 올린다. 수업 날짜는 기본 오늘, 지난 날짜도 고를 수 있다.
- 올리기 전에 휴대폰에서 긴 변 1600px · JPEG · 장당 0.3MB 안팎으로 줄인다. 서버는 JPEG · 600KB · 하루 10장(올린 날 기준)만 받는다.
- 학부모: 러닝노트 첫 화면 맨 위와 「내 레포트」 아래에 그 주 필기가 "○월 ○일 수업 필기입니다" 로 보인다.
- 학생은 자기 사진을 언제든 지울 수 있다(파일까지). 코치룸 학생 → 필기 노트에서 staff 는 숨기기, teacher 만 완전 삭제.
- 사진 보관함은 비공개다. 사진 주소는 10분만 유효한 서명 주소이고, 퇴원 학생은 올리기·보기 모두 막힌다.
- 코치룸 학생 → 필기 노트 위쪽에 저장 공간 사용량(무료 1GB 기준)이 보인다. 80% 를 넘으면 막대가 주황색이 된다.

## 수업일 · 수업 영상 · 자료 파일 (레포트 발송 → 1 작성 → 반 공통)

**수업일**
- 반마다 한 번 **[수업 요일 정하기]** — 기준 요일(레포트에 적히는 수업일) · 추가 요일(주 2회 반만) · 첫 수업일.
- 작성 주차(시작일 ~ 시작일+6일) 안에서 기준 요일인 날이 그 반의 수업일이다.
  과제 기간은 지난 수업일 ~ 이번 수업일 하루 전. 예) 10/15(목) 수업 → 과제 기간 10/8 ~ 10/14.
- 시작일만 고르면 종료일은 시작일+6일로 채워진다 (손으로 바꿀 수 있고, 그 주차만 바뀐다).
- 휴강 · 보강은 **[이 주만 바꾸기]** — 그 주 그 반만 다른 날 / 휴강 + 메모. 다음 주부터는 원래 요일로 계산한다.
- 레포트 머리와 러닝노트 · 반 공지에 "수업일 10/15(목) · 과제 기간 10/8~10/14" 로 보인다.
  **이미 공개한 레포트는 바뀌지 않는다** — 수업 요일을 정한 뒤 공개(다시 공개)한 레포트에만 들어간다. 첫 수업일 앞 주차는 예전처럼 기간만.

**수업 영상** (유튜브 링크만)
- [+ 영상 추가] → 1차시 / 2차시 / 보강 · 제목(비우면 "1차시 영상") · 링크. 링크 칸에서 나오면 바로 저장된다.
- 보강은 [반 전체] 버튼을 눌러 학생을 고르면 그 학생 개인 링크에만 보인다(반 공용 링크에는 안 나간다).
- 러닝노트 · 반 공지 맨 위 「○/○ 수업 영상 · 자료」 카드에 썸네일 버튼으로 나가고, 누르면 유튜브가 열린다.

**배부 자료 · 과제 파일**
- 끌어다 놓기(또는 눌러서 고르기)로 여러 개를 한 번에. PDF · HWP · HWPX · DOC · DOCX · PPT · PPTX · XLSX · JPG · PNG, 하나당 20MB까지.
- 파일명에 "필수과제"(또는 "필수 과제")가 있으면 **필수 과제**, "선택과제"(또는 "선택 과제")가 있으면 **선택 과제**, 아니면 **배부 자료**.
  보이는 이름은 파일명에서 확장자만 뺀 것. 올린 직후 분류 결과가 나오고, 틀린 것은 바로 고르는 칸으로 바꾼다(이름도 고칠 수 있다).
- 러닝노트 · 반 공지에 「배부 자료 / 필수 과제 / 선택 과제」로 나뉘어 보이고, 누르면 내려받는다.
- 파일은 비공개 보관함(`class-files`)에만 있다. 학부모가 누르면 Edge Function `class-file` 이 링크 코드와 파일의 반을 확인하고
  **2분짜리** 주소를 만들어 준다. 다른 반 링크 · 퇴원생 링크로는 받을 수 없고, 공개 주소는 만들지 않는다.
- 지우기: 올린 사람은 **하루 안에 자기 파일만**, 선생님은 언제든. 선생님은 **[지난 파일 정리]**로 고른 날짜 앞 주차 파일을 반별로 한꺼번에 지운다.
  지울 때마다 누가 · 무엇을 지웠는지 기록이 남는다(선생님만 보고, 아무도 못 지운다). 레포트 · 학생 기록은 지우지 않는다.
- 반 이름을 바꾸면(반 관리) 수업일 · 영상 · 파일도 따라간다. 영상 · 파일이 있는 반은 완전 삭제가 막힌다(보관만).

**저장 공간 (Supabase 무료 기준 — 대시보드 → Usage 에서 실제 값을 꼭 확인)**
- 무료: 저장 1GB(필기 사진과 함께 씀) · 내려받기 전송량 월 5GB 정도. 이 사이트는 파일 하나를 20MB로 막아 두었다.
- 반 6개 · 20주 기준 — 글자 PDF 위주(반마다 주 3MB)면 약 360MB, 스캔 PDF(주 10MB)면 약 1.2GB(넘침).
  필기 사진도 학기에 0.7GB 안팎 쌓이므로 둘을 합치면 1GB가 빠듯하다.
- 반 공통 「배부 자료 · 과제 파일」 위에 사용량 막대가 있다. 80% 를 넘으면 주황색 + 경고 → 선생님이 [지난 파일 정리].
  그래도 모자라면 Pro 요금제(월 25달러 · 저장 100GB)로 올린다.

**AI 수업 요약 (자막 → "1차시: … / 2차시: …")**
- 수업 영상 칸 옆 **[자막으로 AI 요약]** → 자막 파일(.srt · .vtt · .txt)을 끌어다 놓거나 스크립트를 붙여 넣는다.
  기본은 **영상 하나(1 · 2차시 함께)** — 한 영상을 차시 수(기본 2)만큼 나눠 요약한다. 차시마다 영상이 따로면 「차시마다 영상 따로」.
- 자막 파일 받는 법(유튜브 스튜디오 → 자막 → 그 영상 → 한국어(자동) ⋮ → 다운로드 → .srt)은 그 창 안 안내에 있다.
  조교 계정으로 받으려면 선생님이 스튜디오 **설정 → 권한**에서 조교를 초대해 둔다.
- 서버(Edge Function `lesson-summary`)가 Claude(Sonnet 5.5)로 요약해 **초안**을 만든다. 초안은 학부모에게 안 보인다.
  직원(조교 포함)이 읽고 고친 뒤 **[확정]** → 러닝노트 · 반 공지 「이번 주 수업」에 보이고, 「수업 내용」 칸에 들어가 레포트를 공개할 때 함께 나간다.
  누가 · 언제 확정했는지 남는다. 「수업 내용」 칸에 다른 글이 있으면 바꾸기 전에 묻는다.
- 자막 원문은 저장하지 않는다(요약에 쓸 때만 Anthropic 으로 보낸다). 저장되는 것은 요약 · 글자 수 · 토큰 수 · 대략 비용뿐.
- **비용 · 상한**: 3시간 수업 자막(약 6만 자) 한 번에 대략 0.1~0.15달러(150~200원, Sonnet 5.5 · 입력 100만 토큰 2달러 · 출력 10달러). 한 달 상한 기본 80회(실패는 안 셈)를 다 써도 대략 8~12달러 —
  선생님이 [상한 바꾸기]로 바꾼다. 이번 달 횟수와 대략 비용이 「AI 수업 요약」 옆에 보인다.
  Anthropic 쪽에도 충전액 · 월 한도(Spend limit)를 걸어 두어 이중으로 막는다.
- 유튜브 자막 자동 가져오기는 시험해 보니 Supabase 서버에서 유튜브가 "로봇 확인"으로 막아서 지금은 쓰지 않는다
  (나중에 선생님 채널 공식 연결 — YouTube Data API — 로 따로 붙일 수 있다).
- 자동 자막은 작품명 · 용어를 틀리게 받아 적을 때가 많다(예: "국어 강사" → "구어왕사"). AI 가 확실하지 않은 것은 「AI 확인 메모」에 적는다. 확정 전에 꼭 읽는다.

**복습테스트 학생 직접 기록**
- 수업 시작 때 복습테스트 → 학생이 자기 채점 → 그 자리에서 휴대폰으로 러닝노트(개인 링크)에 기록 → 조교는 확인만.
- **시험 등록**: 반의 기준 수업일마다 「복습테스트 n회」가 저절로 생긴다. 회차는 첫 수업일부터, 휴강 · [이번 주 없음]은 건너뛴다.
  반 기본 문항 수는 **[반 관리] → 복습 문항**(처음 20, 선생님만), 그 주만 바꾸기 · 끄기는 레포트 발송 → 1 작성 → 반 공통 → 복습테스트.
- **학생 입력(러닝노트)**: 수업일 당일 0시부터 맨 위에 「오늘 복습테스트 기록하기」. 틀린 번호만 누르면 "17 / 20 · 85점"이 바로 나오고,
  **시험지 사진이 있어야** 제출된다(휴대폰에서 긴 변 1280px · 0.15MB 안팎으로 줄여 비공개 보관함에). 마감은 수업일 **밤 12시**(한국 시간).
  마감 전 · 조교 확인 전에는 고칠 수 있고, 확인되면 잠긴다.
- **개인 링크는 학부모도 같이 본다** — 누가 입력했는지는 알 수 없어 「학생 입력」으로만 표시한다. 확인 전 입력(틀린 번호 · 점수 · 사진)도
  그 학생 링크에서 「확인 전」으로 보이고, **그래프 · 레포트에는 확인된 점수만** 쓴다. 반 공용 링크에는 아무것도 안 나간다.
- **지금 제출 현황**(레포트 발송 → 1 작성 → 반 공통 → 복습테스트): 교실 화면용. 이름 칸이 제출하면 실시간으로 초록색, **점수는 아예 불러오지 않는다**. [전체 화면] · Esc 로 닫기.
- **조교 확인**: 표에서 사진을 보고 [확인], 틀린 번호를 고치려면 [고치기](저장하면 확인까지). 휴대폰이 없는 학생은 [대신 입력](사진 선택 · 「조교 입력」).
  누가 · 언제 확인 · 고쳤는지(고치기 전 값 포함) 서버에 남고 아무도 지울 수 없다.
- 마감까지 안 낸 학생은 「오늘」 챙겨야 할 학생에 「복습테스트 n회 미제출」(지난 7일).
- **레포트**: 확인된 점수가 그 주 레포트 리뷰테스트에 「복습테스트 n회 · 17 / 20 · 85점 · 선생님 확인」으로 들어간다(공개할 때 — 이미 공개한 레포트는 그대로).
  러닝노트 「내 레포트」 위에 회차별 점수 그래프(확인된 것만). 반 단위 **자주 틀린 번호**(최근 4회)는 코치룸에서만.
- **저장 공간**: 시험지 사진 학기 약 180MB(60명 × 20주 × 0.15MB). 선생님은 [지난 시험지 사진 정리]로 사진만 지울 수 있다(점수는 남는다).
- **홈 화면에 추가**: 러닝노트 첫 화면 아래 안내(갤럭시 삼성 인터넷 · 크롬, 아이폰 Safari). 카톡 안에서는 안 되므로 「다른 브라우저로 열기」 먼저.
  아이콘은 로고이고, 개인 링크 주소가 그대로 담긴다(주소를 바꾸는 manifest 는 일부러 넣지 않았다).

**뒤로가기 · 새로고침**
- 코치룸: 탭 · 레포트 발송 → 1 작성의 반 · 주차를 바꿀 때마다 기록이 남는다(주소 `#tab=write&cls=…&week=…`). 창(학생 정보 · 코멘트 · 확인 창 · 미리보기 · 지금 제출 현황)이 열려 있으면 뒤로가기 = 창 닫기
  (코멘트 창은 쓴 글을 지키고 닫는다). 더 돌아갈 곳이 없을 때만 사이트 밖으로 나간다. 새로고침해도 보던 탭 · 반 · 주차가 그대로.
- 러닝노트: 탭 · 레포트 한 편 · 크게 본 사진마다 기록 (`#코드/reports` · `#코드/report/주차` · `#코드/photo` …). # 바로 뒤 개인 링크 코드는 바뀌지 않는다.
- 저장 안 된 글이 있을 때 사이트를 떠나려 하면 브라우저가 확인을 띄운다 (자동 저장이 끝났으면 안 띄운다).

**학생 링크 · 학부모 링크**
- 지금까지 보낸 개인 링크(`/me/#코드`)는 그대로 **학부모 링크** — 다시 안내할 필요 없다. 보기만 된다
  (반 공지 · 수업 영상 · 자료 · 레포트 · 교재비 · 선생님이 확인한 복습테스트 점수 · 필기 사진 보기).
- **학생 링크**는 학생마다 따로(주소 모양은 같고 코드만 다르다). 학부모 링크 내용 전부 + 복습테스트 제출 · 「확인 전」 내 기록 · 필기 사진 올리기 · 지우기.
  화면 맨 위에 「학생용」 / 「학부모용」이 작게 보인다.
- 서버도 막는다 — 학부모 코드로 사진 올리기 · 지우기 · 복습테스트 제출을 부르면 거절한다.
- **코치룸**: 명단에 [학부모 링크](보라) · [학생 링크](초록). 학생 링크는 처음 복사할 때 만든다.
  반 머리 아래 [학생 링크 모두 복사] = 그 반 전원(퇴원생 빼고) 「이름 링크」 목록 — 학생 단톡방 첫 안내용 (없는 학생 링크는 그때 만든다).
  학생 정보 창에서 두 링크를 따로 복사 · 재발급(재발급하면 그 링크만 바뀐다). 레포트 발송 → 3 발송 · 교재비 안내는 학부모 링크.
- **전환 기간**: 처음에는 학부모 링크로도 입력이 된다(지금처럼). 「오늘」 맨 위에 "전환 기간 — 학생 링크 다 보내면 끄세요" 알림.
  반마다 학생 링크를 다 보낸 뒤 선생님이 **「오늘」 → [설정] → 학부모 링크로도 입력 허용** 을 끄면 그때부터 입력은 학생 링크만 된다.
- **미리보기**: 명단 · 레포트 발송 → 1 작성 학생 카드 · 레포트 발송 → 3 발송의 [학부모 화면 보기] · [학생 화면 보기] → 그 링크로 열었을 때와 똑같이 보인다
  (맨 위 「미리보기 — 조교 화면」 띠 · [휴대폰 크기로 보기] · 공개 전 이번 주 레포트는 「공개하면 이렇게 보입니다」).
  미리보기에서는 제출 · 사진 올리기 · 지우기를 눌러도 아무것도 바뀌지 않는다. 주소에 링크 코드가 안 나오고, 로그인한 직원만 열 수 있다.

**로고 · 카톡 미리보기**
- 레포트 머리 · 러닝노트 · 반 공지 위에 로고(`assets/logo.png`, 보라)가 보인다. 짙은 회색으로 바꾸려면 `assets/brand.js` 의
  `logo: 'logo.png'` 를 `'logo-charcoal.png'` 로, `me/index.html` · `notice/index.html` 의 `og.png` 를 `og-charcoal.png` 로 바꾼다.
- 카톡은 링크 미리보기를 기억해 둔다. 그림을 바꾼 뒤 바로 보려면 카카오 개발자 사이트의 **공유 디버거**
  (developers.kakao.com/tool/debugger/sharing)에 주소를 넣고 **캐시 초기화**.

## 교재 (교재 탭)

처음 한 번 — **설정**: 학원 추가 → 교재 등록(회차형/단권 · 판매가 · 공급처 · 공급가) → 반마다 학원과 쓰는 교재 켜기 → 계좌 입력

| 언제 | 어디서 | 무엇을 |
|---|---|---|
| 달이 바뀌기 전 | 일정 | 반 고르고 요일로 수업 날짜 생성 (같은 날짜는 중복 안 됨) |
| 수업마다 | 지급 | 칸 클릭 = 바로 저장. 머리칸 = 반 전체 일괄. 그 순간 판매가로 고정된다 |
| 주문할 때 | 재고·주문 | 권장 부수 보고 반마다 주문 부수 고치기 → 확정 → 엑셀 → 들어오면 [입고 처리] |
| 월 1회 | 청구·수납 | 반·월 고르고 선불/후불 → 미리보기 → 청구서 만들기 → [안내]로 문구·링크 보내기 |
| 돈이 들어오면 | 청구·수납 | [납부 완료] — 일시 · 방법(이체/현장 카드/결제선생) · 캡처 · 메모 |
| 선불 달 월말 | 청구·수납 → 선불 차액 정리 | 다음 달 청구에서 차감 / 환불 / 그냥 두기 |
| 돌려줄 때 | 청구서 [환불] → 환불 탭 | 요청 → 돌려준 뒤 [완료 처리]. 실수납에서 자동으로 빠진다 |

- 교재 지급·청구 기록이 있는 학생은 명단에서 지울 수 없다. **퇴원** 처리하면 기록은 그대로 남는다.
- 합계는 전부 Supabase 함수가 계산한다(대시보드 · 청구 요약 · 학부모 화면이 같은 값).

## 자주 하는 일

- **새 반 만들기**: 학생 → 명단 → [학생 추가] (또는 학생 [수정]) → **반** 고르기 맨 아래 **+ 새 반 만들기** → 이름 적고 [만들기].
  학생이 아직 0명이어도 명단 · 작성 · 반 공지 · 시험 · 교재 · 필기 노트 · 「오늘」 반 목록에 바로 나온다.
  이름이 비슷한 반(예: 목동반 · 목동 반)이 있으면 한 번 알려 준다 — 같은 반이면 목록에서 고르고, 다른 반이면 [만들기]를 한 번 더.
- **반 관리 (선생님만)**: 학생 → 명단 → 위쪽 **[반 관리]**
  - **이름 바꾸기**: 그 반의 학생 · 레포트 · 반 현황 · 공용 링크 · 반 공지 · 시험 · 교재 · 필기 기록이 모두 새 이름을 따라간다.
    학부모가 받은 반 공지 링크는 그대로 열린다. 이미 있는 반 이름(보관된 반 포함)으로는 바꿀 수 없다
  - **보관**: 학생 추가 · 작성 · 반 공지 · 시험 · 교재 · 「오늘」 반 카드 등 모든 반 목록에서 숨긴다. 기록은 그대로.
    재원생이 있으면 "재원생 n명이 있습니다" 를 보여 주고 한 번 더 묻는다. 그 학생은 명단(보관됨 표시)과 「오늘」 챙겨야 할 학생에 계속 나온다
  - **되살리기**: 아래 [보관된 반 보기] 를 켜고 [되살리기]
  - **삭제**: 학생(퇴원생 포함) 0명 · 기록 0건인 반에만 버튼이 보인다. 기록이 있으면 보관만 할 수 있다
  - 누가 · 언제 · 무엇을 바꿨는지 창 아래 **최근 변경 기록** 에 남는다. 조교는 버튼이 안 보이고, 서버도 거절한다
- **앱 공유 코드 갱신(월마다)**: 학생 → 명단 → 학생 [수정] → 마라톤 앱 공유 링크 칸에 새 링크 붙여 넣기 → 저장
- **퇴원**: 학생 [수정] → [퇴원] 체크. 개인 링크가 바로 막힌다. 다시 다니면 체크를 풀면 된다
- **링크가 새어 나갔을 때**: 학생 [수정] → [재발급]. 예전 링크는 바로 막힌다
- **엑셀로 명단 넣기**: 학생 → 명단 → [엑셀·CSV로 넣기]. 이름+학부모 연락처가 같으면 기존 학생을 고친다
