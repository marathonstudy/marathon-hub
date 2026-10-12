# 마라톤국어 허브

학생·학부모에게 **개인 링크 하나**로 반 공지 · 주간 레포트 · 앱 과제 기록을 보여 주는 정적 사이트.
서버 없이 GitHub Pages + Supabase 로 돌아간다.

| 주소 | 누가 | 로그인 |
|---|---|---|
| `/admin/` | 선생님·조교 — 명단 · 작성 · 공개 · 발송 · 반 공지 | 이메일 (staff 에 등록된 계정만) |
| `/me/#개인링크코드` | 학생·학부모 — 반 공지 / 내 레포트 / 앱 과제 | 없음 |
| `/notice/#반코드` | 반 단톡방 — 반 공지만 (학생 정보 없음) | 없음 |

## 저장소에 올리지 않는 것 (공개 저장소다)

- **학생 이름·연락처·점수·코멘트는 저장소에 절대 올리지 않는다.** 전부 Supabase 에만 있다.
  레포트도 파일로 만들지 않고, 개인 페이지가 Supabase 함수로 불러와 그린다.
- 엑셀·CSV 명단, 백업 파일(`.mhbak`)은 `.gitignore` 로 막아 두었다. 그래도 폴더에 두지 않는다.
- Supabase **secret key · service_role key**, 데이터베이스 비밀번호는 어디에도 적지 않는다.
  `assets/config.js` 에는 publishable key 만 있다. 모든 표에 RLS 가 켜져 있어 공개돼도 된다.

## 폴더

```
admin/        생성기 (명단 · 작성 · 공개 · 발송 · 반 공지)
me/           학생·학부모 개인 페이지
notice/       반 공용 공지 페이지
assets/
  config.js     ← 배포 주소 · Supabase 주소와 publishable key · 버전
  brand.js      ← 선생님 표기 · 학원명 · 문의처 (김종현 T / 마라톤국어)
  report.css    레포트 디자인
  report-view.js 레포트 그리기 (개인 페이지와 생성기 미리보기가 같이 쓴다)
  hub.css · hub.js 개인 페이지 · 반 공지 페이지
supabase/
  schema.sql                  표 · RLS · 공개 함수 전부 (SQL Editor 에서 한 번 실행)
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

### 4. staff 등록 (이걸 해야 생성기가 열린다)
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

### 6. GitHub Pages
저장소 → **Settings → Pages** → Source **Deploy from a branch** → Branch `main` / `(root)` → Save.
1~2분 뒤 `https://marathonstudy.github.io/marathon-hub/admin/` 이 열린다.

---

## 매주 순서

1. **② 작성** — 주차 · 반 공통(수업 내용 · 테스트 · 과제 · 코멘트) · 학생별 입력
2. **③ 공개** — 다 쓴 학생이 체크돼 있다 → [N명 공개]. 고친 뒤에는 다시 공개
3. **④ 발송** — [문자 보내기] 또는 [문구]·[카톡용] 복사. 링크는 학생마다 매주 같다
4. **⑤ 반 공지** — 반(여러 개 가능) · 주차 고르고 내용 · 자료 · 영상 → [공지 올리기]

## 자주 하는 일

- **앱 공유 코드 갱신(월마다)**: ① 명단 → 학생 [수정] → 마라톤 앱 공유 링크 칸에 새 링크 붙여 넣기 → 저장
- **퇴원**: 학생 [수정] → [퇴원] 체크. 개인 링크가 바로 막힌다. 다시 다니면 체크를 풀면 된다
- **링크가 새어 나갔을 때**: 학생 [수정] → [재발급]. 예전 링크는 바로 막힌다
- **엑셀로 명단 넣기**: ① 명단 → [엑셀·CSV로 넣기]. 이름+학부모 연락처가 같으면 기존 학생을 고친다
