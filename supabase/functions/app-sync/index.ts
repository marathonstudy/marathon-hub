// ============================================================
//  app-sync — 과제 기록을 서버가 미리 받아 저장 (migration-065 · 20261106h)
//
//  왜 — 코치룸 「오늘」이 열릴 때마다 브라우저가 앱 서버에 학생 수만큼 묻지 않게.
//       이 함수가 받아 app_records 에 저장하고, 화면은 저장본만 읽는다.
//  두 가지로 부른다
//    1) 5분마다 자동 (migration-066 의 pg_cron) — 헤더 x-cron-key (DB 에만 있는 값)
//       app_sync_due — 받을 차례 (진행 중인 반 30분 · 그 밖 하루 · 실패한 학생 · 밤 1~6시 쉼) 한 번에 60명까지
//    2) 코치룸 [새로고침] — { action: "refresh", students: [id] } 또는 { action: "refresh", class } · 로그인한 운영진만 · 60명까지
//  앱 서버에 무리가 가지 않게 3명씩 나눠 0.3초 쉬며 받는다. 실패한 학생은 다음 차례에 다시 (5 · 10 · 20 · 30분).
//  저장하는 것은 app-report 와 같은 모양 (제목 · 날짜 · 지각 · 정답률 · 강의 · 영역별). 사진 · 피드백 · 학생 글은 없다.
//  과제 칸 수동 수정(hw_fixes)은 건드리지 않는다.
//  20261110m — 앱 학생 기준 읽기 주소: 앱 학생 id(student_links.app_user_id · migration-102)가 있으면 GET /api/hub/student-records 로 50명씩
//    (반이 바뀌어도 그대로 · 반 여러 개는 날짜 기준으로 합침) · 실패하면 그 학생은 공유 코드로(이유는 app_records.user_fail)
//    앱 id 연결 — 공유 응답의 student.id · 없으면 GET /api/hub/find-student(이름 + 학생 번호 → 학부모 번호) · 코치룸 [다시 찾기] { action: "link", students }
//    연결된 학생은 처음 한 번 지난 주간 배지 채움(app_fill_save · 문자 · 알림톡 없음)
//    열쇠 — Supabase Secrets HUB_READ_KEY (원장님이 넣음 · 이 함수 안에서만 · 로그 · 응답 · 저장에 남기지 않음 · 없으면 예전 방식만)
//  20261111a — 옛 기록 한 번 채우기(runOld · 앱 id 학생 · 2026-01-01부터 · 수강 시작일 앞만 app_records.old · migration-104)
//    앱 연결 못 찾은 이유(번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음 · 후보 여러 명 · 짐작 표시) — runLink · whyNone
//
//  키 — 새로 넣을 키 없음. Supabase 가 함수에 기본으로 주는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (이 함수 안에서만)
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 app-sync → 이 파일 전체 → Deploy
//        → Verify JWT 끄기 (자동 실행은 x-cron-key · 새로고침은 이 함수가 직원인지 DB 에 확인)
//  pick · lite 는 app-report 와 같아야 한다 — 그쪽을 고치면 여기도.
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const APP_API = "https://marathonstudy.com/api/share/report/";
const AT_ONCE = 3, PAUSE_MS = 300, BUDGET_MS = 110000;

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
    "Vary": "Origin",
  };
}
function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
// deno-lint-ignore no-explicit-any
type Any = any;
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

async function rpc(name: string, args: Record<string, unknown>, auth?: string, apikey?: string): Promise<Any> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: apikey || key, Authorization: auth || "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body && body.message) || `rpc ${name} ${r.status}`);
  return body;
}

/* ---------- app-report 와 같은 모양 ---------- */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* 항목 이름만 — 영문 · 숫자 · _ 로 된 이름 40개까지 (값 · 내용은 넣지 않는다) */
function keysOf(o: Any): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.keys(o).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)).slice(0, 40);
}
function itemKeys(list: Any): string[] {
  const set = new Set<string>();
  (Array.isArray(list) ? list.slice(0, 30) : []).forEach((x: Any) => keysOf(x).forEach((k) => set.add(k)));
  return [...set].slice(0, 40);
}
function shapeOf(src: Any) {
  return {
    top: keysOf(src),
    stats: keysOf(src?.stats),
    classInfo: keysOf(src?.classInfo),
    student: keysOf(src?.student ?? src?.studentInfo ?? src?.user ?? src?.profile),
    lectures: itemKeys(src?.lectures),
    calendarData: itemKeys(src?.calendarData),
    categoryStats: itemKeys(src?.categoryStats),
    homeworkHistory: itemKeys(src?.homeworkHistory),
  };
}

/* 맞힌 수 · 문제 수 — 앱이 줄 때만 (이름은 코치룸 미리보기 「앱이 보내는 항목 이름」에서 확인 · 20261106e) */
function countOf(h: Any, names: string[]): number | null {
  for (const k of names) {
    const v = h?.[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
    if (typeof v === "string" && /^\d{1,4}$/.test(v)) return Number(v);
  }
  return null;
}
const CORRECT_KEYS = ["correctCount", "correctAnswerCount", "correctAnswers", "correctNum", "correct"];
const TOTAL_KEYS = ["correctTotal", "totalQuestions", "questionCount", "totalQuestionCount", "problemCount", "quizCount", "totalCount"];
/* 과제 한 개 안의 영역별 결과 (앱 categoryResults — 「독서-과학기술 3/4 · 문학-현대시 2/3」) — 영역 이름 · 맞힌 수 · 문제 수만 (20261110l)
   앱 「영역별 정답률」(categoryStats)과 같은 재료 — 능력치 · 학습 분석이 날짜별로 다시 센다 · 맞힌 수가 비어 있는 칸은 뺀다(앱과 같음) */
function partsOf(h: Any): { parts?: { c: string; k: number; n: number }[] } {
  const cr = Array.isArray(h?.categoryResults) ? h.categoryResults : [];
  const out = cr.map((r: Any) => ({ c: (String(r?.category ?? "").trim() || "기타").slice(0, 30), k: Number(r?.correctCount), n: Number(r?.totalCount ?? r?.totalQuestions) }))
    .filter((x: Any) => r0(x.k) && r0(x.n) && x.n > 0 && x.k <= x.n).slice(0, 12);
  return out.length ? { parts: out } : {};
}
function r0(v: unknown): boolean { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function countsOf(h: Any): { correct?: number; total?: number } {
  const c = countOf(h, CORRECT_KEYS), n = countOf(h, TOTAL_KEYS);
  return c != null && n != null && n > 0 && c <= n ? { correct: c, total: n } : {};
}

/* 앱에 등록된 학생 이름 — 흔한 자리를 차례로 (없으면 '') */
function whoOf(src: Any): string {
  const c = [src?.studentName, src?.userName, src?.student?.name, src?.studentInfo?.name, src?.user?.name,
             src?.profile?.name, src?.member?.name, src?.classInfo?.studentName, src?.name];
  const v = c.find((x) => typeof x === "string" && x.trim());
  return v ? String(v).trim().slice(0, 40) : "";
}

export function pick(src: Any) {
  const st = src?.stats ?? {};
  const lectures = Array.isArray(src?.lectures) ? src.lectures : [];
  const cal = Array.isArray(src?.calendarData) ? src.calendarData : [];
  const cats = Array.isArray(src?.categoryStats) ? src.categoryStats : [];
  const hist = Array.isArray(src?.homeworkHistory) ? src.homeworkHistory : [];
  /* 과제 기록 — 제목 · 날짜 · 지각 여부 · 정답률 · 강 번호만 (사진 · 피드백 · 학생 글은 넘기지 않는다). 오래된 것부터 */
  const hw = hist
    .slice()
    .sort((a: Any, b: Any) => String(a?.submittedAt ?? "").localeCompare(String(b?.submittedAt ?? "")))
    .slice(-2000)
    .map((h: Any) => ({
      title: String(h?.title ?? "").slice(0, 200),
      order: num(h?.lectureOrder),
      submittedAt: String(h?.submittedAt ?? ""),
      late: !!h?.isLate,
      correctRate: h?.correctRate == null ? null : Math.round(num(h.correctRate)),
      ...countsOf(h),
      ...partsOf(h),
    }));

  return {
    classTitle: String(src?.classInfo?.title ?? ""),
    who: whoOf(src),
    stats: {
      submissionRate: Math.round(num(st.homeworkSubmissionRate)),
      onTimeRate: Math.round(num(st.onTimeSubmissionRate)),
      lectureRate: Math.round(num(st.lectureCompletionRate)),
      totalSubmitted: num(st.totalSubmitted),
      totalHomework: num(st.totalHomework),
      totalOnTime: num(st.totalOnTime),
      totalCompleted: num(st.totalCompleted),
      totalVideos: num(st.totalVideos),
    },
    calendar: cal
      .filter((c: Any) => /^\d{4}-\d{2}-\d{2}$/.test(String(c?.date ?? "")))
      .map((c: Any) => ({
        date: String(c.date),
        order: num(c.lectureOrder),
        status: ["onTime", "late", "none"].includes(c.status) ? c.status : "none",
      })),
    categories: cats.map((c: Any) => ({
      name: String(c?.category ?? ""),
      rate: Math.round(num(c?.correctRate)),
      count: num(c?.count),
    })).filter((c: Any) => c.name),
    lectures: lectures.map((l: Any) => ({
      order: num(l?.order),
      title: String(l?.title ?? ""),
      videosDone: num(l?.completedVideos),
      videosTotal: num(l?.totalVideos),
      hwSubmitted: num(l?.submittedHomework),
      hwOnTime: num(l?.onTimeHomework),
      hwTotal: num(l?.totalHomework),
    })),
    history: hw,
    recent: hw.slice().reverse().slice(0, 10),
    shape: shapeOf(src),
  };
}

/* 「오늘」 첫 화면용 — 날짜별 제출 · 강의 · 과제 기록 중 최근 120일만 (통계 · 영역별 · shape 는 뺀다) */
function lite(full: Any) {
  const cut = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const cal = (full.calendar || []).filter((c: Any) => c.date >= cut);
  const orders = new Set(cal.map((c: Any) => c.order));
  return {
    who: full.who || "",
    classTitle: full.classTitle || "",          /* 앱 클래스 이름 — 반 카드 「앱 클래스」 · 클래스 바뀜 알림 (20261101p · migration-060) */
    calendar: cal,
    lectures: (full.lectures || []).filter((l: Any) => orders.has(l.order)).map((l: Any) => ({ order: l.order, title: l.title, videosDone: l.videosDone, videosTotal: l.videosTotal })),
    history: (full.history || []).filter((h: Any) => orders.has(h.order) || String(h.submittedAt).slice(0, 10) >= cut)
      .map((h: Any) => ({ title: h.title, order: h.order, submittedAt: h.submittedAt, late: h.late })),
  };
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/* 왕 후보 · 제출물 보기용 (20261110i · 099 · 20261110j · 100) — 최근 120일 낸 과제의 제출물 주소(이미지 · PDF · 8개) · 앱 점수(wrongAnswerScore · textComprehensionScore)만
   학생 글 · 피드백 · 파일 이름은 넣지 않는다 · 사진은 주소만(복사하지 않음) · app_records.subs(직원 · 서버만 · 러닝노트에는 안 나감) */
const SUB_IMG = /^image\/(jpe?g|png|webp|gif)$/i;
export function subsOf(src: Any) {
  const cut = new Date(Date.now() - 120 * 86400000).toISOString();
  const hist = Array.isArray(src?.homeworkHistory) ? src.homeworkHistory : [];
  const sc = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
  return hist
    .filter((h: Any) => typeof h?.submittedAt === "string" && h.submittedAt >= cut)
    .map((h: Any) => ({
      title: String(h?.title ?? "").slice(0, 200),
      order: num(h?.lectureOrder),
      submittedAt: String(h.submittedAt),
      wa: sc(h?.wrongAnswerScore),
      tc: sc(h?.textComprehensionScore),
      files: (Array.isArray(h?.files) ? h.files : [])
        .filter((x: Any) => typeof x?.url === "string" && x.url.length <= 400 && /^(\/(objects|uploads)\/|https:\/\/(www\.)?marathonstudy\.com\/)/.test(x.url)
          && (SUB_IMG.test(String(x?.type ?? "")) || String(x?.type ?? "").toLowerCase() === "application/pdf"     /* PDF 도 (20261110j · 대표 쪽 미리보기) */
              || (!x?.type && /\.(jpe?g|png|webp|gif|pdf)(\?|$)/i.test(x.url))))
        .slice(0, 8).map((x: Any) => ({ url: String(x.url), type: String(x?.type ?? "") })),
    }))
    .slice(-200);
}

/* 한 명 — 앱 서버가 바쁘거나 응답이 없으면 0.7초 · 1.8초 쉬었다가 2번까지 다시 */
async function fetchShare(share: string): Promise<Any> {
  let last: Any = { ok: false, reason: "upstream" };
  for (let k = 0; k < 3; k++) {
    if (k) await sleep(k === 1 ? 700 : 1800);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(APP_API + encodeURIComponent(share), { headers: { "Accept": "application/json" }, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 404) return { ok: false, reason: "expired" };
      if (r.ok) { const raw = await r.json(); const data = pick(raw); const uid = num(raw?.student?.id); return { ok: true, src: "share", data, lite: lite(data), subs: subsOf(raw), ...(uid > 0 ? { uid } : {}) }; }
      last = { ok: false, reason: r.status === 429 || r.status === 503 ? "busy" : "upstream" };
    } catch (e) {
      last = { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream" };
    }
  }
  return last;
}
/* 받기 (20261110m) — 앱 id 가 있는 학생은 새 주소로 50명씩(묶음 사이 1.5초) · 없으면 공유 코드로 3명씩
   새 주소가 실패하면(403 · 429 · 오류 · 그 학생 없음) 그 학생은 공유 코드로 받고 이유를 남긴다(user_fail) · 공유 코드도 없으면 실패
   시간이 모자라면 남은 학생은 다음 차례로 (next_try 10분) · 묶음마다 저장 (중간에 끊겨도 받은 것은 남는다) */
export async function runList(list: Any[], started = Date.now()) {
  const out = { saved: 0, failed: 0, left: 0, reasons: {} as Record<string, number>, user: 0, fallback: 0, filled: 0 };
  const userList = list.filter((x: Any) => num(x.uid) > 0 && hubKey());
  const shareList = list.filter((x: Any) => !(num(x.uid) > 0 && hubKey()));
  const save = async (results: Any[]) => {
    results.forEach((r: Any) => {
      if (r.ok) out.saved++;
      else { out.failed++; out.reasons[r.reason] = (out.reasons[r.reason] || 0) + 1; console.error("app-sync fail", r.reason); }
    });
    await rpc("app_sync_save", { p_results: results.map(({ subs: _s, days: _d, fill: _f, ...x }: Any) => x) });
    /* 왕 후보용 사진 주소 · 앱 점수 (099 전이면 함수가 없어 조용히 넘어간다) · 새 주소가 제출물 주소를 주지 않으면 있던 것을 그대로 둔다 */
    const subRows = results.filter((x: Any) => x.ok && Array.isArray(x.subs) && (x.src !== "user" || x.subs.some((h: Any) => h.files && h.files.length))).map((x: Any) => ({ id: x.id, subs: x.subs }));
    if (subRows.length) await rpc("king_subs_save", { p_rows: subRows }).catch(() => 0);
    /* 지난 주간 배지 채움 — 연결된 학생 한 번 (102 · 문자 · 알림톡 없음) */
    for (const x of results.filter((y: Any) => y.ok && y.fill && Array.isArray(y.days))) {
      const n = await rpc("app_fill_save", { p_student: x.id, p_days: x.days }).catch(() => 0);
      out.filled += Number(n) || 0;
    }
  };
  for (let i = 0; i < userList.length; i += USER_AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) { out.left += userList.length - i; break; }
    const part = userList.slice(i, i + USER_AT_ONCE);
    const got = await fetchUsers(part.map((x: Any) => num(x.uid)), fromOf(part), kstToday());
    const results: Any[] = [];
    for (const x of part) {
      const recs = got.ok ? got.by.get(num(x.uid)) : null;
      if (recs && recs.length) {
        const raw = mergeClasses(recs), data = pick(raw);
        results.push({ id: x.id, ok: true, src: "user", data, lite: lite(data), subs: subsOf(raw), fill: !!x.fill, days: daysOf(data) });
        out.user++;
        continue;
      }
      const why = got.ok ? "notfound" : got.reason;
      if (/^[A-Za-z0-9_-]{8,128}$/.test(String(x.share || ""))) {
        const r = await fetchShare(String(x.share));
        results.push({ id: x.id, ...r, user_fail: why, fill: false });
        out.fallback++;
      } else results.push({ id: x.id, ok: false, reason: "user_" + why, user_fail: why });
    }
    await save(results);
    if (i + USER_AT_ONCE < userList.length) await sleep(USER_PAUSE_MS);
  }
  for (let i = 0; i < shareList.length; i += AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) { out.left += shareList.length - i; break; }
    const part = shareList.slice(i, i + AT_ONCE).filter((x: Any) => /^[A-Za-z0-9_-]{8,128}$/.test(String(x.share || "")));
    const results = await Promise.all(part.map(async (x: Any) => ({ id: x.id, ...(await fetchShare(String(x.share))) })));
    await save(results);
    if (i + AT_ONCE < shareList.length) await sleep(PAUSE_MS);
  }
  return out;
}

/* ============================================================
   앱 학생 기준 읽기 주소 (20261110m) — 서버 열쇠는 Supabase Secrets HUB_READ_KEY (이 함수 안에서만 · 로그 · 응답에 남기지 않음)
   ============================================================ */
const APP_BASE = APP_API.replace(/\/api\/share\/report\/?$/, "");
const USER_AT_ONCE = 50, USER_PAUSE_MS = 1500, MAX_DAYS = 400;
function hubKey(): string { return env("HUB_READ_KEY"); }
function kstToday(): string { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function addDaysIso(d: string, n: number): string { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
/* 기간 — 묶음 학생 중 가장 이른 수강 시작일부터(없으면 1년) · 앱 한도 400일 */
function fromOf(part: Any[]): string {
  const t = kstToday(), lim = addDaysIso(t, -(MAX_DAYS - 1));
  const st = part.map((x: Any) => String(x.start || "")).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] || addDaysIso(t, -364);
  return st < lim ? lim : st;
}
async function hubGet(path: string): Promise<{ ok: boolean; status: number; body: Any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(APP_BASE + path, { headers: { "Accept": "application/json", "x-hub-key": hubKey() }, signal: ctl.signal });
    const body = await r.json().catch(() => null);
    return { ok: r.ok && !(body && body.ok === false), status: r.status, body };
  } finally { clearTimeout(t); }
}
function failWhy(status: number, body: Any): string {
  if (status === 401 || status === 403) return "http" + status;
  if (status === 429) return "busy";
  const rs = String(body?.reason ?? "").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 20);
  return rs || (status ? "http" + status : "upstream");
}
/* 학생마다 반 기록 목록 — 응답 모양이 조금 달라도 읽는다 ({ students | records | data | results: [{ userId, classes | enrollments | records }] } · 학생 id 를 열쇠로 한 모양 · 반 한 개짜리) */
export function recordsByUser(j: Any): Map<number, Any[]> {
  const by = new Map<number, Any[]>();
  const put = (uid: number, recs: Any) => {
    if (!(uid > 0)) return;
    const list = (Array.isArray(recs) ? recs : recs ? [recs] : []).filter((c: Any) => c && typeof c === "object" && (c.classInfo || c.calendarData || c.homeworkHistory));
    if (list.length) by.set(uid, (by.get(uid) || []).concat(list));
  };
  const one = (s: Any, key?: string) => {
    if (!s || typeof s !== "object") return;
    const uid = num(s.userId ?? s.user_id ?? s.studentId ?? s.student?.id ?? s.id ?? key);
    const recs = s.classes ?? s.enrollments ?? s.records ?? s.reports ?? (s.classInfo || s.calendarData ? s : null);
    put(uid, recs);
  };
  const arr = Array.isArray(j) ? j : (j?.students ?? j?.records ?? j?.data ?? j?.results ?? j?.users);
  if (Array.isArray(arr)) arr.forEach((s: Any) => one(s));
  else if (arr && typeof arr === "object") Object.keys(arr).forEach((k) => one(arr[k], k));
  return by;
}
export async function fetchUsers(ids: number[], from: string, to: string): Promise<{ ok: boolean; reason: string; by: Map<number, Any[]> }> {
  let last = { ok: false, reason: "upstream", by: new Map<number, Any[]>() };
  for (let k = 0; k < 2; k++) {
    if (k) await sleep(2000);
    try {
      const q = "/api/hub/student-records?userIds=" + ids.join(",") + "&from=" + from + "&to=" + to;
      const r = await hubGet(q);
      if (r.ok) return { ok: true, reason: "", by: recordsByUser(r.body) };
      last = { ok: false, reason: failWhy(r.status, r.body), by: new Map() };
      if (r.status === 401 || r.status === 403 || r.status === 400) break;        /* 열쇠 · 입력 문제는 다시 해도 같다 */
    } catch (e) {
      last = { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream", by: new Map() };
    }
  }
  return last;
}
/* 반 여러 개 → 공유 리포트 한 개 모양으로 (날짜 기준) — 강 번호는 반마다 1000씩 띄워 겹치지 않게 · 같은 날 여러 반이면 낸 쪽 */
export function mergeClasses(recs: Any[]): Any {
  const sorted = recs.slice().sort((a: Any, b: Any) => String(a?.classInfo?.openDate ?? a?.enrolledAt ?? "").localeCompare(String(b?.classInfo?.openDate ?? b?.enrolledAt ?? "")));
  if (sorted.length === 1) return sorted[0];
  const rank: Record<string, number> = { onTime: 3, late: 2, none: 1 };
  const cal = new Map<string, Any>(), hist: Any[] = [], lec: Any[] = [], cats = new Map<string, Any>();
  const st = { totalSubmitted: 0, totalHomework: 0, totalOnTime: 0, totalCompleted: 0, totalVideos: 0 };
  const today = kstToday();
  let cur: Any = null;
  sorted.forEach((c: Any, i: number) => {
    const off = i * 1000;
    const ci = c?.classInfo ?? {};
    if (!cur || (String(ci.openDate ?? "") <= today && (!ci.closeDate || String(ci.closeDate) >= today))) cur = c;
    (Array.isArray(c?.calendarData) ? c.calendarData : []).forEach((d: Any) => {
      const k = String(d?.date ?? ""), x = { ...d, lectureOrder: num(d?.lectureOrder) ? num(d.lectureOrder) + off : 0 };
      const old = cal.get(k);
      if (!old || (rank[x.status] || 0) > (rank[old.status] || 0)) cal.set(k, x);
    });
    (Array.isArray(c?.homeworkHistory) ? c.homeworkHistory : []).forEach((h: Any) => hist.push({ ...h, lectureOrder: num(h?.lectureOrder) ? num(h.lectureOrder) + off : 0 }));
    (Array.isArray(c?.lectures) ? c.lectures : []).forEach((l: Any) => lec.push({ ...l, order: num(l?.order) + off }));
    (Array.isArray(c?.categoryStats) ? c.categoryStats : []).forEach((g: Any) => {
      const k = String(g?.category ?? ""), n = num(g?.count), o = cats.get(k) || { category: k, w: 0, count: 0 };
      o.w += num(g?.correctRate) * n; o.count += n; cats.set(k, o);
    });
    const s0 = c?.stats ?? {};
    (Object.keys(st) as (keyof typeof st)[]).forEach((k) => { st[k] += num(s0[k]); });
  });
  const pct = (a: number, b: number) => (b > 0 ? Math.round(a * 100 / b) : 0);
  return {
    ...(cur || sorted[sorted.length - 1]),
    stats: { ...st, homeworkSubmissionRate: pct(st.totalSubmitted, st.totalHomework), onTimeSubmissionRate: pct(st.totalOnTime, st.totalHomework), lectureCompletionRate: pct(st.totalCompleted, st.totalVideos) },
    calendarData: Array.from(cal.values()).sort((a: Any, b: Any) => String(a.date).localeCompare(String(b.date))),
    homeworkHistory: hist,
    lectures: lec,
    categoryStats: Array.from(cats.values()).map((g: Any) => ({ category: g.category, correctRate: g.count ? Math.round(g.w / g.count) : 0, count: g.count })),
  };
}
/* 지난 주간 배지 채움용 — 날짜별 제출 [{ d, s }] (셈은 DB app_fill_save 가 과제 수정값 · 시작일과 같이) */
function daysOf(data: Any): Any[] { return (data?.calendar || []).map((c: Any) => ({ d: c.date, s: c.status })); }
/* 학생 찾기 — 앱 학생 id 만 돌려받는다 (모양이 조금 달라도) */
export function idsOf(j: Any): number[] {
  const out: number[] = [];
  const add = (v: unknown) => { const n = num(v); if (n > 0 && !out.includes(n)) out.push(n); };
  if (Array.isArray(j)) j.forEach((x: Any) => (x && typeof x === "object" ? add(x.id ?? x.userId) : add(x)));
  else if (j && typeof j === "object") {
    [j.userIds, j.ids].forEach((a: Any) => Array.isArray(a) && a.forEach(add));
    [j.students, j.users, j.matches, j.results, j.data].forEach((a: Any) => Array.isArray(a) && a.forEach((x: Any) => (x && typeof x === "object" ? add(x.id ?? x.userId) : add(x))));
    if (!out.length) add(j.userId ?? j.id);
  }
  return out;
}
/* 못 찾은 이유 — 앱이 응답에 이유를 적어 주면 그것으로 (모양을 모르니 흔한 칸 이름 · 낱말로만 · 20261111a) */
export function hintOf(body: Any): string {
  if (!body || typeof body !== "object") return "";
  const t = [body.reason, body.code, body.error, body.why, body.status, body.message].filter((v) => typeof v === "string").join(" ").toLowerCase();
  if (!t) return "";
  if (/name/.test(t) && /(mismatch|wrong|differ|not.?match|invalid)/.test(t)) return "name_mismatch";
  if (/(phone|tel|mobile|number)/.test(t)) return "phone_mismatch";
  if (/(no.?(user|account|student|member)|not.?found|unknown|none|not.?exist)/.test(t)) return "no_account";
  return "";
}
async function findOne(name: string, phone: string): Promise<{ ok: boolean; ids: number[]; reason: string; hint: string; bad?: boolean }> {
  try {
    const r = await hubGet("/api/hub/find-student?name=" + encodeURIComponent(name) + "&phone=" + encodeURIComponent(phone));
    if (r.ok) return { ok: true, ids: idsOf(r.body), reason: "", hint: hintOf(r.body) };
    if (r.status === 404) return { ok: true, ids: [], reason: "", hint: hintOf(r.body) };
    if (r.status === 400 || r.status === 422) return { ok: true, ids: [], reason: "", hint: "", bad: true };   /* 이 모양으로는 못 물음(빈 이름 · 빈 번호) */
    return { ok: false, ids: [], reason: failWhy(r.status, r.body), hint: "" };
  } catch (e) { return { ok: false, ids: [], reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream", hint: "" }; }
}
/* 이름 + 번호로 하나도 안 나왔을 때 — 무엇이 틀렸는지 가르기 (앱 응답만으로 확실하지 않으면 가장 가까운 것 + 짐작)
   1) 앱이 이유를 주면 그대로(확실)
   2) 번호만으로 물어 나오면 → 번호는 맞고 이름이 다름 「이름 불일치」(확실 · 나온 학생을 후보로)
   3) 이름만으로 물어 나오면 → 「번호 불일치」(짐작 — 같은 이름의 다른 학생일 수 있음 · 후보로)
   4) 둘 다 없으면(또는 앱이 그렇게 묻는 것을 받지 않으면) → 「앱 계정 없음」(짐작 — 번호가 다른 계정일 수도) */
async function whyNone(nm: string, phones: string[], hint: string): Promise<Any> {
  if (hint) return { why: hint, guess: false };
  for (const p of phones) {
    await sleep(LINK_PAUSE_MS);
    const r = await findOne("", p);
    if (!r.ok || r.bad) break;
    if (r.ids.length) return { why: "name_mismatch", guess: false, cands: r.ids.slice(0, 5) };
  }
  await sleep(LINK_PAUSE_MS);
  const n = await findOne(nm, "");
  if (n.ok && !n.bad && n.ids.length) return { why: "phone_mismatch", guess: true, cands: n.ids.length <= 5 ? n.ids : [] };
  return { why: "no_account", guess: true };
}
/* 앱 id 가 없는 학생 찾기 — 이름 + 학생 번호 → 없으면 이름 + 학부모 번호(→ 학부모 번호 2) · 한 명씩 0.4초 쉼 · 앱이 거절하면 멈춤
   못 찾으면 이유(번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음 · 후보 여러 명)를 같이 저장 (20261111a) · 번호 없는 학생은 앱에 묻지 않는다 */
export async function runLink(list: Any[], started = Date.now()) {
  const out = { tried: 0, linked: 0, need: 0, many: 0, stopped: "", why: {} as Record<string, number> };
  const rows: Any[] = [];
  for (const x of list) {
    if (Date.now() - started > BUDGET_MS || !hubKey()) break;
    const nm = String(x.name || "").trim();
    const phones = [x.phone, x.parent, x.parent2].map((v) => String(v || "").replace(/\D/g, "")).filter((v, i, a) => v.length >= 9 && a.indexOf(v) === i);
    if (!phones.length) { rows.push({ id: x.id, ids: [], why: "no_phone", guess: false }); out.why.no_phone = (out.why.no_phone || 0) + 1; out.tried++; continue; }
    let r = { ok: true, ids: [] as number[], reason: "", hint: "" };
    for (let i = 0; i < phones.length; i++) {
      if (i) await sleep(LINK_PAUSE_MS);
      r = await findOne(nm, phones[i]);
      if (!r.ok || r.ids.length) break;
    }
    if (!r.ok) { out.stopped = r.reason; break; }
    let row: Any = { id: x.id, ids: r.ids };
    if (r.ids.length > 1) row.why = "many";
    else if (!r.ids.length) {
      const w = await whyNone(nm, phones, r.hint);
      row = { ...row, ...w };
    }
    if (row.why) out.why[row.why] = (out.why[row.why] || 0) + 1;
    rows.push(row);
    out.tried++;
    await sleep(LINK_PAUSE_MS);
  }
  if (rows.length) {
    const s2: Any = await rpc("app_link_save", { p_rows: rows }).catch(() => null);
    if (s2) { out.linked = num(s2.linked); out.need = num(s2.need); out.many = num(s2.many); }
  }
  return out;
}
const LINK_PAUSE_MS = 400;

/* ============================================================
   옛 기록 한 번 채우기 (20261111a · migration-104) — 앱 id 로 받는 학생만 · 2026-01-01 ~ 오늘(400일 한도 안)
   수강 시작일(없으면 1년 전) 앞 기록만 app_records.old 에 · 덮어쓰기(겹쳐 쌓이지 않음) · 강 번호는 100000 을 더해 지금 기록과 섞이지 않게
   옛 주 주간 배지 칸은 app_fill_old(채움 · 문자 · 알림톡 없음) · 한 번에 25명 · 묶음 사이 1.5초 (분당 30회 한도 — 5분에 한두 번)
   ============================================================ */
const OLD_FROM = "2026-01-01", OLD_AT_ONCE = 25, OLD_OFF = 100000;
function kstDayOf(v: unknown): string {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : "";
}
export function oldOf(data: Any, cut: string): { old: Any; n: number; first: string } {
  const hist = (data?.history || []).filter((h: Any) => { const d = kstDayOf(h?.submittedAt); return d && d < cut; })
    .map((h: Any) => ({ ...h, order: num(h.order) ? num(h.order) + OLD_OFF : 0 }));
  const cal = (data?.calendar || []).filter((c: Any) => /^\d{4}-\d{2}-\d{2}$/.test(String(c?.date ?? "")) && c.date < cut)
    .map((c: Any) => ({ ...c, order: num(c.order) ? num(c.order) + OLD_OFF : 0 }));
  const firsts = [hist.map((h: Any) => kstDayOf(h.submittedAt)).sort()[0], cal.filter((c: Any) => c.status === "onTime" || c.status === "late").map((c: Any) => c.date).sort()[0]].filter(Boolean).sort();
  return { old: { history: hist, calendar: cal, cut }, n: hist.length, first: firsts[0] || "" };
}
export async function runOld(started = Date.now(), limit = 50) {
  const out = { tried: 0, saved: 0, records: 0, weeks: 0, failed: 0 };
  if (!hubKey()) return out;
  const list: Any[] = await rpc("app_old_due", { p_limit: limit }).catch(() => []) || [];
  const t = kstToday(), lim = addDaysIso(t, -(MAX_DAYS - 1)), from = OLD_FROM < lim ? lim : OLD_FROM;
  for (let i = 0; i < list.length; i += OLD_AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) break;
    const part = list.slice(i, i + OLD_AT_ONCE);
    const got = await fetchUsers(part.map((x: Any) => num(x.uid)), from, t);
    out.tried += part.length;
    if (!got.ok) { out.failed += part.length; console.error("app-sync old fail", got.reason); break; }     /* 30분 뒤 다시 (old_try) */
    const rows: Any[] = [];
    for (const x of part) {
      const recs = got.by.get(num(x.uid));
      const cut = /^\d{4}-\d{2}-\d{2}$/.test(String(x.start || "")) ? String(x.start) : addDaysIso(t, -364);
      const o = recs && recs.length ? oldOf(pick(mergeClasses(recs)), cut) : { old: null, n: 0, first: "" };
      rows.push({ id: x.id, old: o.n ? o.old : null, n: o.n, first: o.first });
      out.records += o.n;
      if (o.old && o.old.calendar.length) {
        const n = await rpc("app_fill_old", { p_student: x.id, p_days: o.old.calendar.map((c: Any) => ({ d: c.date, s: c.status })) }).catch(() => 0);
        out.weeks += Number(n) || 0;
      }
    }
    const s: Any = await rpc("app_old_save", { p_rows: rows }).catch(() => null);
    out.saved += s ? num(s.saved) : 0;
    if (i + OLD_AT_ONCE < list.length) await sleep(USER_PAUSE_MS);
  }
  return out;
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "config", message: "서버 설정을 읽지 못했습니다." }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const cronKey = req.headers.get("x-cron-key") ?? "";

  /* 1) 5분마다 자동 */
  if (cronKey) {
    let okKey = false;
    try { okKey = (await rpc("note_cron_ok", { p_key: cronKey })) === true; } catch (e) {
      return json({ ok: false, reason: "nosql", message: String((e as Error).message || e).slice(0, 160) }, cors);
    }
    if (!okKey) return json({ ok: false, reason: "auth" }, cors, 403);
    const now = typeof body.now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.now) ? body.now : new Date().toISOString();
    const due: Any = await rpc("app_sync_due", { p_now: now, p_limit: 60 });
    const list: Any[] = due?.students || [];
    const started = Date.now();
    const r = await runList(list, started);
    let link: Any = null, old: Any = null;
    /* 옛 기록 한 번 채우기 (104 · 시간이 넉넉할 때만 · 104 전이면 함수가 없어 조용히 넘어감) */
    if (!due?.night && hubKey() && Date.now() - started < BUDGET_MS / 3) old = await runOld(started).catch(() => null);
    if (!due?.night && hubKey() && Date.now() - started < BUDGET_MS / 2) {
      const ll: Any[] = await rpc("app_link_due", { p_limit: 20 }).catch(() => []) || [];
      if (ll.length) link = await runLink(ll, started);
    }
    return json({ ok: true, night: !!due?.night, due: list.length, ...r, ...(link ? { link } : {}), ...(old && old.tried ? { old } : {}) }, cors);
  }

  /* 2) 코치룸 [새로고침] — 로그인한 운영진 */
  if (body.action !== "refresh" && body.action !== "link") return json({ ok: false, reason: "input" }, cors, 400);
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  let staff = false;
  try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
  if (!staff) return json({ ok: false, reason: "auth", message: "운영진만 할 수 있습니다." }, cors, 403);
  const ids: string[] = (Array.isArray(body.students) ? body.students : []).map((x: unknown) => String(x ?? "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
  const cls = String(body.class ?? "").slice(0, 60);
  /* 학생 카드 [다시 찾기] — 그 학생만 앱에서 찾기 (20261110m) */
  if (body.action === "link") {
    if (!ids.length) return json({ ok: false, reason: "input" }, cors, 400);
    if (!hubKey()) return json({ ok: false, reason: "nokey", message: "앱 읽기 열쇠(HUB_READ_KEY)가 아직 없습니다." }, cors);
    const ll: Any[] = await rpc("app_link_due", { p_limit: ids.length, p_students: ids }) || [];
    const lr = await runLink(ll);
    return json({ ok: true, ...lr }, cors);
  }
  if (!ids.length && !cls) return json({ ok: false, reason: "input", message: "반이나 학생을 골라 주세요." }, cors, 400);
  const list: Any[] = await rpc("app_sync_targets", { p_students: ids.length ? ids : null, p_class: cls || null }) || [];
  const r = await runList(list);
  return json({ ok: true, due: list.length, ...r }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    console.error("app-sync error", String((e as Error).message || e).slice(0, 300));
    return json({ ok: false, reason: "error", message: "과제 기록을 받지 못했습니다." }, cors, 200);
  }
});
