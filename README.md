# 마라톤 코치룸 · 마라톤국어 러닝노트

**마라톤 코치룸**(선생님·조교 관리 페이지)과 **마라톤국어 러닝노트**(학생·학부모 개인 페이지).
학생·학부모에게 **개인 링크 하나**로 반 공지 · 주간 레포트 · 앱 과제 기록을 보여 주는 정적 사이트.
서버 없이 GitHub Pages + Supabase 로 돌아간다.

| 주소 | 누가 | 로그인 |
|---|---|---|
| `/admin/` | 선생님·조교 — 명단 · 작성 · 공개 · 발송 · 반 공지 · 교재 | 이메일 (staff 에 등록된 계정만) |
| `/me/#개인링크코드` | 학생·학부모 — 반 공지 / 내 레포트 / 앱 과제 / 교재비 | 없음 |
| `/notice/#반코드` | 반 단톡방 — 반 공지만 (학생 정보 없음) | 없음 |

## 저장소에 올리지 않는 것 (공개 저장소다)

- **학생 이름·연락처·점수·코멘트는 저장소에 절대 올리지 않는다.** 전부 Supabase 에만 있다.
  레포트도 파일로 만들지 않고, 개인 페이지가 Supabase 함수로 불러와 그린다.
- 엑셀·CSV 명단, 백업 파일(`.mhbak`)은 `.gitignore` 로 막아 두었다. 그래도 폴더에 두지 않는다.
- Supabase **secret key · service_role key**, 데이터베이스 비밀번호는 어디에도 적지 않는다.
  `assets/config.js` 에는 publishable key 만 있다. 모든 표에 RLS 가 켜져 있어 공개돼도 된다.
- **교재비 계좌번호·금액·납부 캡처도 저장소에 없다.** 계좌는 코치룸 ⑥ 교재 → 설정에서 입력하면
  Supabase(`app_settings`)에만 저장되고, 캡처는 비공개 보관함(`tb-receipts`)에만 올라간다.
  공급처 주문표 엑셀은 내 컴퓨터로만 내려받는다(`*.xlsx` 는 `.gitignore` 로 막혀 있다).

## 폴더

```
admin/        코치룸 (명단 · 작성 · 공개 · 발송 · 반 공지 · 교재)
  tb.js         ⑥ 교재 — 뼈대 · 설정 · 일정
  tb-dash.js    ⑥ 교재 — 대시보드
  tb-issue.js   ⑥ 교재 — 지급
  tb-stock.js   ⑥ 교재 — 재고·주문·입고
  tb-bill.js    ⑥ 교재 — 청구·수납 · 납부 안내 · 선불 차액 · 환불
  card.js       학생 상담 카드 (기본 정보 · 내신 · 모의고사 · 상담·관찰 기록)
  exams.js      첫 화면 D-day 띠 · [시험 관리]
  sync.js       여러 기기 — 다시 불러오기 · 실시간 반영
  photo.js      ⑦ 필기 노트 — 반·날짜별 올림 현황 · 숨기기 · 완전 삭제 · 저장 공간
  today.js      「오늘」 총괄 (로그인 첫 화면) — 요약 · 챙겨야 할 학생 · 반별 카드
me/           학생·학부모 개인 페이지
notice/       반 공용 공지 페이지
assets/
  config.js     ← 배포 주소 · Supabase 주소와 publishable key · 버전
  brand.js      ← 선생님 표기 · 학원명 · 문의처 (김종현 T / 마라톤국어)
  report.css    레포트 디자인
  report-view.js 레포트 그리기 (개인 페이지와 코치룸 미리보기가 같이 쓴다)
  hub.css · hub.js 개인 페이지 · 반 공지 페이지
  dday.js       주요 시험 D-day 계산 (한국 시간 · 코치룸과 학생 화면이 같이 쓴다)
  photos.js     러닝노트 「필기 노트」 — 사진 줄이기 · 올리기 · 날짜별 앨범
supabase/
  schema.sql                  표 · RLS · 공개 함수 전부 (SQL Editor 에서 한 번 실행)
  migration-002-textbook.sql  2단계 교재 관리 표 · 계산 함수 · 학부모용 hub_textbook (schema.sql 다음에 한 번)
  migration-003-sync.sql      여러 기기 동시 사용 — 수정 시각 · 항목별 저장 함수 · 실시간 반영 (002 다음에 한 번)
  migration-004-notes.sql     상담 카드 · 성적 · 상담·관찰 기록 (staff 만, 공개 함수에 안 나감)
  migration-005-exams.sql     주요 시험 D-day — 개인·반 공지 페이지 함수에 시험 이름·날짜만 더함
  migration-006-notes-photos.sql  필기 노트 사진 — 비공개 보관함 · 사진 기록 · Edge Function 전용 함수
  functions/note-photo/index.ts   필기 사진 올리기·보기·지우기 Edge Function (개인 링크 코드 확인)
  migration-007-dashboard.sql     「오늘」 총괄 — 계산 함수 coach_today() 하나 + 설정 보호 (새 표 없음)
  functions/app-report/index.ts  앱 과제 기록을 대신 받아 오는 Edge Function
```

## 고칠 때 규칙

파일을 고치면 **버전을 함께 올린다.** `assets/config.js` 의 `version` 과
`admin/index.html` · `me/index.html` · `notice/index.html` · `index.html` 의 `?v=…` 를 같은 값으로.
안 올리면 GitHub Pages 캐시 때문에 최대 10분간 옛 파일이 나간다.

---

## 처음 한 번 — 설치 순서

### 1. 표 만들기 (Supabase)
1. Supabase 대시보드 → 프로젝트 `marathon-hub` → 왼쪽 **SQL Editor** → **New query**
2. `supabase/schema.sql` 파일 내용을 전부 복사해 붙여 넣고 **Run**
3. 맨 아래 결과에 표들이 `rls_enabled = true` 로 나오면 끝. 여러 번 실행해도 안전하다.

### 2. 아무나 가입하지 못하게
**Authentication → Sign In / Providers** → *User Signups* 의 **Allow new users to sign up** 끄기 → Save

### 3. 선생님·조교 계정 만들기
1. **Authentication → Users → Add user → Create new user**
2. 이메일 · 비밀번호 입력, **Auto Confirm User** 체크 → Create user

### 4. staff 등록 (이걸 해야 코치룸이 열린다)
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
3. 이 SQL 을 안 돌려도 1단계 기능은 그대로 동작한다(⑥ 교재 탭에 안내만 뜬다).

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

### 6. GitHub Pages
저장소 → **Settings → Pages** → Source **Deploy from a branch** → Branch `main` / `(root)` → Save.
1~2분 뒤 `https://marathonstudy.github.io/marathon-hub/admin/` 이 열린다.

---

## 매주 순서

1. **② 작성** — 주차 · 반 공통(수업 내용 · 테스트 · 과제 · 코멘트) · 학생별 입력
2. **③ 공개** — 다 쓴 학생이 체크돼 있다 → [N명 공개]. 고친 뒤에는 다시 공개
3. **④ 발송** — [문자 보내기] 또는 [문구]·[카톡용] 복사. 링크는 학생마다 매주 같다
4. **⑤ 반 공지** — 반(여러 개 가능) · 주차 고르고 내용 · 자료 · 영상 → [공지 올리기]

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
- 백업 되살리기·엑셀 넣기는 더하거나 고치기만 하고, 파일에 없는 학생을 지우지 않는다.

## 상담 카드 · 상담·관찰 기록

- 명단에서 **학생 이름**을 누르면 열린다. 확인 필요 기록(맨 위) → 기본 정보 → 내신 → 모의고사 → 기록 타임라인.
- 이름·학교·학년은 명단과 같은 값이다(여기서 고치면 명단도 바뀐다). 수강 시작일·특이사항은 카드에만.
- 성적 칸은 비워 둬도 된다. 원점수는 숫자, 등급은 1~9. 칸에서 나오면 그 칸만 저장된다. 최신 학년이 위.
- 기록은 쌓기만 한다. 고치면 "수정됨(누가·언제)", **삭제는 선생님(teacher) 계정만 — 지우지 않고 숨김**(삭제됨·누가·언제).
  선생님 계정은 [숨긴 기록·성적 보기]에서 되살릴 수 있다.
- "다음 상담 때 확인"으로 남긴 기록은 카드 맨 위에 고정되고, 명단에 **확인 N** 배지가 붙는다. [확인 완료]를 누르면 내려간다.
- ② 작성 탭에서 학생을 고르면 오른쪽에 그 학생의 확인 필요 기록과 최근 기록 5개.
- **민감 정보** — staff 만 읽고 쓴다. 학부모 개인 페이지 · 반 공지 · 레포트 · 백업 파일 어디에도 들어가지 않는다.
- 엑셀 넣기에 **수강시작일** 열(선택)을 쓸 수 있다.

## 주요 시험 D-day

- 코치룸 맨 위 띠 → **[시험 관리]**: 시험 이름·날짜·메모, 전체 기본(가장 가까운 시험 자동 / 특정 시험 고정), 반별 시험.
- 개인 페이지에는 "OO 학생 · ○○까지 D-00", 반 공지 페이지에는 "○○까지 D-00" (그 반 기준).
- 한국 시간 자정마다 하루씩 줄어든다. 당일은 "○○ 당일입니다. 모두 화이팅!". 고정한 시험이 지나면 다음 시험으로 넘어가고,
  다가오는 시험이 하나도 없으면 D-day 줄을 숨긴다.

## 오늘의 총괄 (코치룸 첫 화면 「오늘」)

- 맨 위 요약: 재원생 · 이번 주 레포트 미발송 · 교재비 미납 · 확인 필요 상담 · 필기 미제출.
- 챙겨야 할 학생: 최근 4주 결석(보강 포함) 2회 이상 · 앱 과제 50% 미만 · 필기 2주 연속 없음 · 확인 필요 상담. 탭 이름 옆 숫자가 이 인원.
- 반별 카드(학원 → 반): 출결 · 작성/공개/발송 · 앱 과제 평균(실패 수) · 필기 · 미납 · 재고 부족 · 확인 필요. 누르면 학생 목록, 이름을 누르면 상담 카드.
- [설정](teacher 만 바꿈): 조교에게 교재비 금액 보이기(기본 보임 · 이 화면에만 적용), 결석 기준(몇 주 · 몇 회).
- 계산은 서버 함수 coach_today() 한 번. '작성 완료'는 ② 작성 탭과 같은 규칙. 앱 과제는 화면이 뜬 뒤 차례로 불러온다.
- `migration-007-dashboard.sql` 은 002 ~ 006 다음에 실행한다.

## 필기 노트 (러닝노트 「필기 노트」 · 코치룸 ⑦)

- 학생이 러닝노트 「필기 노트」 탭에서 카메라로 찍거나 앨범에서 여러 장 올린다. 수업 날짜는 기본 오늘, 지난 날짜도 고를 수 있다.
- 올리기 전에 휴대폰에서 긴 변 1600px · JPEG · 장당 0.3MB 안팎으로 줄인다. 서버는 JPEG · 600KB · 하루 10장(올린 날 기준)만 받는다.
- 학부모: 러닝노트 첫 화면 맨 위와 「내 레포트」 아래에 그 주 필기가 "○월 ○일 수업 필기입니다" 로 보인다.
- 학생은 자기 사진을 언제든 지울 수 있다(파일까지). 코치룸 ⑦ 에서 staff 는 숨기기, teacher 만 완전 삭제.
- 사진 보관함은 비공개다. 사진 주소는 10분만 유효한 서명 주소이고, 퇴원 학생은 올리기·보기 모두 막힌다.
- 코치룸 ⑦ 위쪽에 저장 공간 사용량(무료 1GB 기준)이 보인다. 80% 를 넘으면 막대가 주황색이 된다.

## 교재 (⑥ 교재 탭)

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

- **앱 공유 코드 갱신(월마다)**: ① 명단 → 학생 [수정] → 마라톤 앱 공유 링크 칸에 새 링크 붙여 넣기 → 저장
- **퇴원**: 학생 [수정] → [퇴원] 체크. 개인 링크가 바로 막힌다. 다시 다니면 체크를 풀면 된다
- **링크가 새어 나갔을 때**: 학생 [수정] → [재발급]. 예전 링크는 바로 막힌다
- **엑셀로 명단 넣기**: ① 명단 → [엑셀·CSV로 넣기]. 이름+학부모 연락처가 같으면 기존 학생을 고친다
