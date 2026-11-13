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
//  20261111b — 옛 기록 결과를 학생마다(ok · empty · none · fail · 이유 · 요청 기간 · 앱이 준 가장 이른 날짜) · 받기 방법과 상관없이 앱 id 학생 모두
//    · 실패해도 조용히 넘어가지 않음 · 동기화 기록 app_sync_runs(숫자 · 이유 코드만 · migration-105)
//    앱 연결 못 찾은 이유(번호 없음 · 번호 불일치 · 이름 불일치 · 앱 계정 없음 · 후보 여러 명 · 짐작 표시) — runLink · whyNone
//  20261113a — 옛 기록 timeout(50명 전원 · 11-13): 1명 × 한 달씩 나눠 받고 학생마다 마지막으로 받은 달을 남겨 이어서(runOldMonths · migration-106)
//    · 옛 기록은 밤 1~6시에도(평소 동기화의 밤 쉼은 그대로) · 분당 28회 한도(hubGate) · 요청마다 걸린 시간(app_hub_calls)
//    · 평소 동기화 50명 → 10명씩 · 수강 시작일이 비슷한 학생끼리 · timeout 이면 다시 묻지 않고 다음 묶음을 반으로 · 실패하면 지금처럼 공유 코드로
//  20261113b — 앱 반 목록 · 반 명단 { action: "app_classes" } · { action: "app_roster", classId } (직원만 · 앱에 주소가 없으면 noapi · 온라인 반 가져오기)
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
    /* 과제 안 영역별 결과의 칸 이름 (20261113d · 확인용 SQL 이 경로별로 영역 정보가 오는지 본다 · 값은 넣지 않음) */
    categoryResults: itemKeys((Array.isArray(src?.homeworkHistory) ? src.homeworkHistory : []).slice(-60).flatMap((h: Any) => (Array.isArray(h?.categoryResults) ? h.categoryResults.slice(0, 3) : []))),
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
/* 20261113d — 맞힌 수가 null · "" 이면 예전에는 Number(null) = 0 으로 「0개 맞힘」이 되어 능력치가 0 으로 나왔다 → 숫자(또는 숫자 글자)일 때만
   칸 이름이 조금 달라도(correct · correctAnswers · total · questionCount …) 읽는다 · 영역 이름은 category · name · categoryName */
const PART_K = ["correctCount", "correct", "correctAnswers", "correctAnswerCount", "correctNum"];
const PART_N = ["totalCount", "totalQuestions", "total", "questionCount", "count"];
export function partsOf(h: Any): { parts?: { c: string; k: number; n: number }[] } {
  const cr = Array.isArray(h?.categoryResults) ? h.categoryResults : Array.isArray(h?.categoryStats) ? h.categoryStats : [];
  const out = cr.map((r: Any) => ({ c: (String(r?.category ?? r?.name ?? r?.categoryName ?? "").trim() || "기타").slice(0, 30), k: countOf(r, PART_K), n: countOf(r, PART_N) }))
    .filter((x: Any) => x.k != null && x.n != null && x.n > 0 && x.k <= x.n).slice(0, 12);
  return out.length ? { parts: out } : {};
}
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
/* ============================================================
   영역 정보 채우기 (20261113d) — 받은 경로에 과제 안 영역별 결과(parts)가 없으면 다른 경로에서 같은 과제의 것만 가져와 붙인다
     학생 기준 주소로 받았는데 최근 4주 과제에 영역 정보가 없으면 → 공유 코드(그 반 리포트)로
     공유 코드로 받았는데(학생 기준 주소 실패) 없으면 → 학생 기준 주소로 그 학생 1명 × 최근 4주만 (짧게 물어 timeout 을 피함)
     같은 과제 = 제출 시각 + 제목 (없으면 제목 + 한국 날짜) · 영역 · 맞힌 수 · 문제 수만 · 한 번에 PARTS_MAX 명까지
   ============================================================ */
const PARTS_DAYS = 28, PARTS_MAX = 6;
function kstDay0(v: unknown): string { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : ""; }
/* 최근 n일 낸 과제 중 영역 정보가 없는 것 수 */
export function partsMissing(data: Any, days = PARTS_DAYS): number {
  const cut = addDaysIso(kstToday(), -(days - 1));
  return (data?.history || []).filter((h: Any) => h && h.submittedAt && kstDay0(h.submittedAt) >= cut && !(Array.isArray(h.parts) && h.parts.length)).length;
}
/* src 의 영역 정보를 dst 의 같은 과제에 붙인다 — 붙인 과제 수 */
export function fillParts(dst: Any, src: Any): number {
  const a = new Map<string, Any>(), b = new Map<string, Any>();
  (src?.history || []).forEach((h: Any) => {
    if (!h || !(Array.isArray(h.parts) && h.parts.length)) return;
    a.set(String(h.submittedAt) + "|" + String(h.title ?? ""), h);
    b.set(String(h.title ?? "") + "|" + kstDay0(h.submittedAt), h);
  });
  if (!a.size) return 0;
  let n = 0;
  (dst?.history || []).forEach((h: Any) => {
    if (!h || !h.submittedAt || (Array.isArray(h.parts) && h.parts.length)) return;
    const s = a.get(String(h.submittedAt) + "|" + String(h.title ?? "")) || b.get(String(h.title ?? "") + "|" + kstDay0(h.submittedAt));
    if (!s) return;
    h.parts = s.parts.map((p: Any) => ({ c: p.c, k: p.k, n: p.n }));
    if (h.correct == null && s.correct != null && s.total != null) { h.correct = s.correct; h.total = s.total; }
    n++;
  });
  return n;
}

/* 받기 (20261110m) — 앱 id 가 있는 학생은 새 주소로 50명씩(묶음 사이 1.5초) · 없으면 공유 코드로 3명씩
   새 주소가 실패하면(403 · 429 · 오류 · 그 학생 없음) 그 학생은 공유 코드로 받고 이유를 남긴다(user_fail) · 공유 코드도 없으면 실패
   시간이 모자라면 남은 학생은 다음 차례로 (next_try 10분) · 묶음마다 저장 (중간에 끊겨도 받은 것은 남는다) */
export async function runList(list: Any[], started = Date.now()) {
  const out = { saved: 0, failed: 0, left: 0, reasons: {} as Record<string, number>, user: 0, fallback: 0, filled: 0, userWhy: {} as Record<string, number>,
                parts: { tried: 0, got: 0, share: 0, user: 0 } };
  /* 영역 정보 채우기 (20261113d) — 한 번에 PARTS_MAX 명 · 시간이 모자라면 건너뜀 */
  let userStop = false;
  const partsFrom = async (r: Any, x: Any, way: "share" | "user", why = "") => {
    if (!r?.ok || !r.data || out.parts.tried >= PARTS_MAX || Date.now() - started > BUDGET_MS * 0.6 || !partsMissing(r.data)) return;
    let src: Any = null;
    if (way === "share") {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(x.share || ""))) return;
      out.parts.tried++;
      const s = await fetchShare(String(x.share));
      if (s.ok) src = s.data;
    } else {
      if (!(num(x.uid) > 0) || !hubKey() || userStop || /^http40[13]$/.test(why) || why === "busy") return;
      out.parts.tried++;
      const t = kstToday(), g = await fetchUsers([num(x.uid)], addDaysIso(t, -PARTS_DAYS), t, "parts");
      if (!g.ok) userStop = true;                                       /* 1명 × 4주도 안 되면 이번 차례에는 더 묻지 않음 (timeout 이 쌓이지 않게) */
      const recs = g.ok ? g.by.get(num(x.uid)) : null;
      if (recs && recs.length) src = pick(mergeClasses(recs));
    }
    const n = src ? fillParts(r.data, src) : 0;
    if (n) { out.parts.got += n; out.parts[way]++; }
  };
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
  /* 20261113a — 한 번에 USER_AT_ONCE 명(10) · 수강 시작일이 비슷한 학생끼리 묶어 기간을 짧게 · timeout 이 나면 다음 묶음은 반으로(1명까지) */
  userList.sort((a: Any, b: Any) => String(b.start || "").localeCompare(String(a.start || "")));
  let size = USER_AT_ONCE;
  for (let i = 0; i < userList.length;) {
    if (Date.now() - started > BUDGET_MS) { out.left += userList.length - i; break; }
    const part = userList.slice(i, i + size);
    i += part.length;
    const got = await fetchUsers(part.map((x: Any) => num(x.uid)), fromOf(part), kstToday());
    if (!got.ok && got.reason === "timeout") size = Math.max(1, Math.floor(size / 2));
    const results: Any[] = [];
    for (const x of part) {
      const recs = got.ok ? got.by.get(num(x.uid)) : null;
      if (recs && recs.length) {
        const raw = mergeClasses(recs), data = pick(raw);
        const r: Any = { id: x.id, ok: true, src: "user", data, subs: subsOf(raw), fill: !!x.fill, days: daysOf(data) };
        await partsFrom(r, x, "share");                                 /* 학생 기준 주소에 영역 정보가 없으면 공유 코드에서 (20261113d) */
        results.push({ ...r, lite: lite(data) });
        out.user++;
        continue;
      }
      const why = got.ok ? "notfound" : got.reason;
      out.userWhy[why] = (out.userWhy[why] || 0) + 1;                 /* 학생 기준 주소로 못 받은 이유 (동기화 기록 · 105) */
      if (/^[A-Za-z0-9_-]{8,128}$/.test(String(x.share || ""))) {
        const r = await fetchShare(String(x.share));
        await partsFrom(r, x, "user", why);                             /* 공유 코드에 영역 정보가 없으면 학생 기준 주소 1명 × 4주로 (20261113d) */
        results.push({ id: x.id, ...r, user_fail: why, fill: false });
        out.fallback++;
      } else results.push({ id: x.id, ok: false, reason: "user_" + why, user_fail: why });
    }
    await save(results);
    if (i < userList.length) await sleep(USER_PAUSE_MS);
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
const USER_AT_ONCE = 10, USER_PAUSE_MS = 1500, MAX_DAYS = 400;     /* 50 → 10 (20261113a · 50명 · 긴 기간을 한 번에 물어 timeout) */
function hubKey(): string { return env("HUB_READ_KEY"); }
function kstToday(): string { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function addDaysIso(d: string, n: number): string { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
/* 기간 — 묶음 학생 중 가장 이른 수강 시작일부터(없으면 1년) · 앱 한도 400일 */
function fromOf(part: Any[]): string {
  const t = kstToday(), lim = addDaysIso(t, -(MAX_DAYS - 1));
  const st = part.map((x: Any) => String(x.start || "")).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] || addDaysIso(t, -364);
  return st < lim ? lim : st;
}
/* 분당 30회 한도 (20261113a) — 지난 60초 안에 HUB_PER_MIN 번 물었으면 가장 오래된 요청이 60초를 넘길 때까지 기다린다 (찾기 · 받기 · 옛 기록 모두) */
const HUB_PER_MIN = 28, HUB_TIMEOUT_MS = 25000;
const hubTimes: number[] = [];
async function hubGate() {
  for (;;) {
    const now = Date.now();
    while (hubTimes.length && now - hubTimes[0] >= 60000) hubTimes.shift();
    if (hubTimes.length < HUB_PER_MIN) { hubTimes.push(now); return; }
    await sleep(60000 - (now - hubTimes[0]) + 50);
  }
}
/* 요청마다 걸린 시간 (106 · app_hub_calls) — 종류 · 학생 수 · 날짜 수 · ms · 성공 · 이유 코드만 (주소 · 이름 · 열쇠 값 없음) · 함수 끝에 한 번에 저장 */
const hubCalls: Any[] = [];
function dayCount(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 0;
}
async function flushCalls() {
  if (!hubCalls.length) return;
  const rows = hubCalls.splice(0, hubCalls.length);
  await rpc("app_hub_log", { p_rows: rows }).catch(() => 0);       /* 106 전이면 함수가 없어 그냥 넘어간다 */
}
/* 반 목록 · 반 명단은 앱이 따로 분당 10회 제한 (Replit 작업 #33) → 우리는 분당 9회 (20261113h) */
const ROSTER_PER_MIN = 9;
const rosterTimes: number[] = [];
async function rosterGate() {
  for (;;) {
    const now = Date.now();
    while (rosterTimes.length && now - rosterTimes[0] >= 60000) rosterTimes.shift();
    if (rosterTimes.length < ROSTER_PER_MIN) { rosterTimes.push(now); return; }
    await sleep(60000 - (now - rosterTimes[0]) + 50);
  }
}
async function hubGet(path: string, meta: { kind?: string; students?: number; days?: number } = {}): Promise<{ ok: boolean; status: number; body: Any; ms: number; retry?: number; ctype?: string }> {
  await hubGate();
  if (meta.kind === "classes" || meta.kind === "roster") await rosterGate();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HUB_TIMEOUT_MS);
  const t0 = Date.now();
  const log = (ok: boolean, reason: string) => hubCalls.push({ kind: meta.kind || "find", students: meta.students || 0, days: meta.days || 0, ms: Date.now() - t0, ok, reason });
  try {
    const r = await fetch(APP_BASE + path, { headers: { "Accept": "application/json", "x-hub-key": hubKey() }, signal: ctl.signal });
    const body = await r.json().catch(() => null);
    const ok = r.ok && !(body && body.ok === false);
    log(ok, ok ? "" : failWhy(r.status, body));
    const ra = Number(r.headers?.get?.("retry-after") ?? "");
    return { ok, status: r.status, body, ms: Date.now() - t0, retry: Number.isFinite(ra) && ra > 0 ? Math.min(600, Math.round(ra)) : undefined, ctype: String(r.headers?.get?.("content-type") ?? "").slice(0, 40) };
  } catch (e) {
    log(false, (e as Error)?.name === "AbortError" ? "timeout" : "upstream");
    throw e;
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
/* timeout 은 다시 묻지 않는다 (20261113a — 같은 요청은 또 25초를 넘겨 함수 시간만 쓴다 · 묶음을 줄이거나 다음 차례로) */
export async function fetchUsers(ids: number[], from: string, to: string, kind = "sync"): Promise<{ ok: boolean; reason: string; by: Map<number, Any[]> }> {
  let last = { ok: false, reason: "upstream", by: new Map<number, Any[]>() };
  for (let k = 0; k < 2; k++) {
    if (k) await sleep(2000);
    try {
      const q = "/api/hub/student-records?userIds=" + ids.join(",") + "&from=" + from + "&to=" + to;
      const r = await hubGet(q, { kind, students: ids.length, days: dayCount(from, to) });
      if (r.ok) return { ok: true, reason: "", by: recordsByUser(r.body) };
      last = { ok: false, reason: failWhy(r.status, r.body), by: new Map() };
      if (r.status === 401 || r.status === 403 || r.status === 400) break;        /* 열쇠 · 입력 문제는 다시 해도 같다 */
    } catch (e) {
      last = { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream", by: new Map() };
      if (last.reason === "timeout") break;
    }
  }
  return last;
}
/* 반 여러 개 → 공유 리포트 한 개 모양으로 (날짜 기준) — 강 번호는 반마다 1000씩 띄워 겹치지 않게 · 같은 날 여러 반이면 낸 쪽 */
/* stable — 옛 기록을 달마다 받을 때(20261113a): 달마다 오는 반 수가 달라도 같은 반은 같은 강 번호가 되게 반 id(없으면 이름)로 띄움 */
function classOff(ci: Any): number {
  const k = String(ci?.id ?? ci?.classId ?? ci?.title ?? "");
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return (h % 89 + 1) * 1000;
}
export function mergeClasses(recs: Any[], stable = false): Any {
  const sorted = recs.slice().sort((a: Any, b: Any) => String(a?.classInfo?.openDate ?? a?.enrolledAt ?? "").localeCompare(String(b?.classInfo?.openDate ?? b?.enrolledAt ?? "")));
  if (sorted.length === 1 && !stable) return sorted[0];
  const rank: Record<string, number> = { onTime: 3, late: 2, none: 1 };
  const cal = new Map<string, Any>(), hist: Any[] = [], lec: Any[] = [], cats = new Map<string, Any>();
  const st = { totalSubmitted: 0, totalHomework: 0, totalOnTime: 0, totalCompleted: 0, totalVideos: 0 };
  const today = kstToday();
  let cur: Any = null;
  sorted.forEach((c: Any, i: number) => {
    const ci = c?.classInfo ?? {};
    const off = stable ? classOff(ci) : i * 1000;
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
/* 앱이 실제로 준 가장 이른 날짜 — 낸 과제(한국 날짜) · 날짜별 칸 중 가장 이른 것 (「지금 반 기간만 준다」를 가르는 값 · 105) */
export function spanOf(data: Any): { first: string; n: number } {
  const ds = [...(data?.history || []).map((h: Any) => kstDayOf(h?.submittedAt)), ...(data?.calendar || []).map((c: Any) => String(c?.date ?? ""))]
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { first: ds[0] || "", n: (data?.history || []).length };
}
/* 오류 글 — 한 줄 · 짧게 (열쇠 · 번호는 들어가지 않는 값만: 앱 실패 이유 코드 · DB 오류 글) */
function short(e: unknown): string { return String((e as Error)?.message ?? e ?? "").replace(/[\r\n]+/g, " ").slice(0, 120); }
/* 학생마다 결과를 남긴다 (105) — ok 옛 기록 받음 · empty 받았지만 수강 시작일 앞 기록 없음 · none 앱이 이 학생 기록을 안 줌 · fail 받기 실패(이유)
   실패한 묶음도 학생마다 「fail · 이유」로 저장(예전에는 아무것도 안 남기고 멈췄다) · 고르기 · 저장이 실패하면 err 로 돌려준다(동기화 기록에 남음) */
export async function runOld(started = Date.now(), limit = 50) {
  const out: Any = { tried: 0, saved: 0, records: 0, weeks: 0, failed: 0, ok: 0, empty: 0, none: 0, reasons: {} as Record<string, number> };
  if (!hubKey()) { out.skip = "nokey"; return out; }
  let list: Any[] = [];
  try { list = (await rpc("app_old_due", { p_limit: limit })) || []; }
  catch (e) { out.err = "due: " + short(e); console.error("app-sync old due", out.err); return out; }
  if (!Array.isArray(list)) list = [];
  out.due = list.length;
  const t = kstToday(), lim = addDaysIso(t, -(MAX_DAYS - 1)), from = OLD_FROM < lim ? lim : OLD_FROM;
  out.from = from; out.to = t;
  for (let i = 0; i < list.length; i += OLD_AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) { out.left = list.length - i; break; }      /* 남은 학생은 다음 차례 (old_try) */
    const part = list.slice(i, i + OLD_AT_ONCE);
    const got = await fetchUsers(part.map((x: Any) => num(x.uid)), from, t);
    out.tried += part.length;
    const rows: Any[] = [];
    if (!got.ok) {
      out.failed += part.length;
      out.reasons[got.reason] = (out.reasons[got.reason] || 0) + part.length;
      console.error("app-sync old fail", got.reason);
      part.forEach((x: Any) => rows.push({ id: x.id, status: "fail", err: "앱 " + got.reason, from, to: t }));
    } else {
      for (const x of part) {
        const recs = got.by.get(num(x.uid));
        if (!recs || !recs.length) { rows.push({ id: x.id, status: "none", from, to: t, got_n: 0, classes: 0 }); out.none++; continue; }
        const cut = /^\d{4}-\d{2}-\d{2}$/.test(String(x.start || "")) ? String(x.start) : addDaysIso(t, -364);
        const data = pick(mergeClasses(recs)), sp = spanOf(data), o = oldOf(data, cut);
        const st = o.n ? "ok" : "empty";
        out[st]++;
        rows.push({ id: x.id, status: st, old: o.n ? o.old : null, n: o.n, first: o.first, from, to: t, got_first: sp.first, got_n: sp.n, classes: recs.length });
        out.records += o.n;
        if (o.old && o.old.calendar.length) {
          try { out.weeks += Number(await rpc("app_fill_old", { p_student: x.id, p_days: o.old.calendar.map((c: Any) => ({ d: c.date, s: c.status })) })) || 0; }
          catch (e) { out.fillErr = short(e); }
        }
      }
    }
    try { const s: Any = await rpc("app_old_save", { p_rows: rows }); out.saved += s ? num(s.saved) : 0; }
    catch (e) { out.err = "save: " + short(e); console.error("app-sync old save", out.err); break; }
    if (!got.ok && /^http40[13]$/.test(got.reason)) break;                               /* 열쇠 문제 — 다시 해도 같다 */
    if (i + OLD_AT_ONCE < list.length) await sleep(USER_PAUSE_MS);
  }
  return out;
}
/* ============================================================
   옛 기록 1명 × 한 달씩 (20261113a · migration-106) — 한 번에 10달을 물으면 앱이 25초 안에 답을 못 했다(50명 전원 timeout · 11-13)
   · 학생마다 마지막으로 받은 달(old_month) 다음 달부터 · 수강 시작일 앞 달까지 · 달마다 저장(app_old_month_save · 통째로 바꿈)
   · 요청 기간은 그 달 앞뒤로 하루씩 넓혀 묻고(앱이 UTC 날짜로 자를 때 빠지지 않게) 한국 날짜로 그 달 것만 남긴다
   · 실패하면 그 학생은 그 달에서 멈추고 다음 학생으로 (연속 실패만큼 10분 → 6시간 쉼 · DB 가 정함) · 열쇠 문제면 모두 멈춤
   · 요청 사이 OLD_GAP_MS 쉼 + 분당 28회 한도(hubGate) · until(함수 시작부터 ms)까지만 새 요청을 시작
   · 106 전이면(app_old_due2 없음) 예전 방식(runOld · 밤에는 쉼)
   ============================================================ */
const OLD_GAP_MS = 1000, OLD_DUE = 40;
const isDay = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ""));
function monthOf(d: string): string { return d.slice(0, 7) + "-01"; }
function nextMonth(m: string): string { const x = new Date(m + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); }
function monthLast(m: string): string { return addDaysIso(nextMonth(m), -1); }
/* 한 달 몫 — 한국 날짜로 [f, e] 안 · 수강 시작일(cut) 앞만 */
export function oldMonthOf(data: Any, cut: string, f: string, e: string) {
  const o = oldOf(data, cut);
  const hist = o.old.history.filter((h: Any) => { const d = kstDayOf(h?.submittedAt); return d >= f && d <= e; });
  const cal = o.old.calendar.filter((c: Any) => c.date >= f && c.date <= e);
  return { history: hist, calendar: cal, n: hist.length };
}
export async function runOldMonths(started = Date.now(), until = BUDGET_MS, night = false) {
  const out: Any = { mode: "month", students: 0, tried: 0, months: 0, done: 0, ok: 0, empty: 0, failed: 0, records: 0, weeks: 0, reasons: {} as Record<string, number> };
  if (!hubKey()) { out.skip = "nokey"; return out; }
  let list: Any[] = [];
  try { list = (await rpc("app_old_due2", { p_limit: OLD_DUE })) || []; }
  catch (e) {
    if (/app_old_due2/.test(short(e))) {                                          /* 106 전 — 예전 방식 */
      if (night) return { skip: "night" };
      return await runOld(started);
    }
    out.err = "due: " + short(e); console.error("app-sync old due", out.err); return out;
  }
  if (!Array.isArray(list)) list = [];
  out.due = list.length;
  const t = kstToday(), lim = addDaysIso(t, -(MAX_DAYS - 2)), from0 = OLD_FROM < lim ? lim : OLD_FROM;
  out.from = from0; out.to = t;
  let stop = false;
  for (const x of list) {
    if (stop || Date.now() - started > until) { out.left = (out.left || 0) + 1; continue; }
    const uid = num(x.uid);
    const cut = isDay(x.start) ? String(x.start) : addDaysIso(t, -364);
    const last = addDaysIso(cut, -1);
    let m = isDay(x.month) ? nextMonth(monthOf(String(x.month))) : monthOf(from0);
    out.students++;
    const save = async (row: Any) => {
      try { return await rpc("app_old_month_save", { p_row: { id: x.id, from: from0, to: t, cut, ...row } }); }
      catch (e) { out.err = "save: " + short(e); console.error("app-sync old save", out.err); stop = true; return null; }
    };
    if (from0 > last || m > last) {                                                /* 받을 달이 없음(수강 시작이 1월 1일 앞 · 이미 다 받음) */
      const s: Any = await save({ status: "done" });
      if (s) { out.done++; num(s.n) > 0 ? out.ok++ : out.empty++; }
      continue;
    }
    while (m <= last && !stop) {
      if (Date.now() - started > until) { out.left = (out.left || 0) + 1; break; }
      const f = m < from0 ? from0 : m, e = monthLast(m) < last ? monthLast(m) : last;
      const got = await fetchUsers([uid], addDaysIso(f, -1), addDaysIso(e, 1) > t ? t : addDaysIso(e, 1), "old");
      out.tried++;
      if (!got.ok) {
        out.failed++;
        out.reasons[got.reason] = (out.reasons[got.reason] || 0) + 1;
        console.error("app-sync old fail", got.reason);
        await save({ status: "fail", err: "앱 " + got.reason });
        if (/^http40[13]$/.test(got.reason)) stop = true;                           /* 열쇠 문제 — 다시 해도 같다 */
        break;
      }
      const recs = got.by.get(uid) || [];
      const data = recs.length ? pick(mergeClasses(recs, true)) : { history: [], calendar: [] };
      const part = oldMonthOf(data, cut, f, e), sp = spanOf(data);
      const end = nextMonth(m) > last;
      const s: Any = await save({ status: end ? "done" : "month", month: m, history: part.history, calendar: part.calendar, n: part.n, got_n: sp.n, got_first: sp.first, classes: recs.length });
      if (!s) break;
      out.months++; out.records += part.n;
      if (part.calendar.length) {
        try { out.weeks += Number(await rpc("app_fill_old", { p_student: x.id, p_days: part.calendar.map((c: Any) => ({ d: c.date, s: c.status })) })) || 0; }
        catch (e2) { out.fillErr = short(e2); }
      }
      if (end) { out.done++; num(s.n) > 0 ? out.ok++ : out.empty++; }
      m = nextMonth(m);
      await sleep(OLD_GAP_MS);
    }
  }
  return out;
}

/* ============================================================
   앱 반 목록 · 반 명단 (20261113b · 온라인 반 가져오기 · .local/replit_반명단_요청.md 의 주소)
     GET /api/hub/classes               → { classes: [{ id, title, openDate, closeDate }] }
     GET /api/hub/classes/{id}/students → { students: [{ userId, name, grade, phone, parentPhone }] }
   모양이 조금 달라도 읽는다 · 주소가 없거나(404 · 405 · 501) 앱 화면(html)이 오면 「noapi」
   ============================================================ */
/* 20261113h — 앱이 화면(html)이나 JSON 이 아닌 것을 돌려주면 noapi(주소 없음 · 앱 업데이트 필요) · 404 · 405 · 501 은 상태 번호 그대로(「앱 응답 404 (/api/hub/classes)」)
   실패하면 { ok:false, reason, status, path, retry?, sec? } — 키 값 · 학생 정보는 넣지 않는다 · 함수 Logs 에 한 줄(종류 · 상태 · 이유 · ms) */
const APP_VER = "20261113h";
const isNoApi = (_status: number, body: Any) => body == null || typeof body !== "object";
const strOf = (v: unknown, n: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "");
const pickArr = (j: Any, keys: string[]): Any[] | null => {
  if (Array.isArray(j)) return j;
  for (const k of keys) { if (Array.isArray(j?.[k])) return j[k]; }
  for (const w of ["data", "result", "payload", "body"]) {                 /* { data: { classes: [...] } } 처럼 한 겹 더 감싼 모양 */
    const x = j?.[w];
    if (Array.isArray(x)) return x;
    if (x && typeof x === "object") for (const k of keys) { if (Array.isArray(x[k])) return x[k]; }
  }
  return null;
};
const shapeKeys = (j: Any) => (j && typeof j === "object" && !Array.isArray(j) ? Object.keys(j).slice(0, 8).map((k) => k.replace(/[^\w]/g, "").slice(0, 20)).join(",") : Array.isArray(j) ? "[배열]" : "");
const yes = (v: unknown) => v === true || v === 1 || /^(true|y|yes|1|ended|closed|done|finished|archived)$/i.test(String(v ?? ""));
const dateOf = (v: unknown) => { const s = strOf(v, 40); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; };
export function classesOf(j: Any): Any[] {
  const arr = pickArr(j, ["classes", "items", "results", "list", "rows", "data"]);
  if (!arr) return [];
  return arr.map((c: Any) => {
    const idRaw = c?.id ?? c?.classId ?? c?.class_id ?? c?.uuid;
    const id = typeof idRaw === "number" ? idRaw : strOf(idRaw, 40);
    return {
      id: typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id,
      title: strOf(c?.title ?? c?.name ?? c?.className ?? c?.class_name ?? c?.classTitle, 80),
      open: dateOf(c?.openDate ?? c?.open_date ?? c?.startDate ?? c?.start_date ?? c?.start ?? c?.startsAt),
      close: dateOf(c?.closeDate ?? c?.close_date ?? c?.endDate ?? c?.end_date ?? c?.end ?? c?.endsAt),
      count: num(c?.studentCount ?? c?.student_count ?? c?.studentsCount ?? c?.memberCount ?? (Array.isArray(c?.students) ? c.students.length : c?.students) ?? c?.count),
      ended: yes(c?.ended ?? c?.isEnded ?? c?.is_ended ?? c?.closed ?? c?.status),
    };
  }).filter((c: Any) => (typeof c.id === "number" ? c.id > 0 : /^[\w-]{1,40}$/.test(c.id)) && c.title).slice(0, 300);
}
export function rosterOf(j: Any): Any[] {
  const arr = pickArr(j, ["students", "members", "users", "items", "results", "list", "rows", "data"]);
  if (!arr) return [];
  return arr.map((s: Any) => ({
    uid: num(s?.userId ?? s?.user_id ?? s?.studentId ?? s?.student_id ?? s?.id ?? s?.user?.id),
    name: strOf(s?.name ?? s?.studentName ?? s?.student_name ?? s?.userName ?? s?.displayName ?? s?.user?.name, 40),
    grade: strOf(s?.grade ?? s?.schoolGrade ?? s?.school_grade ?? s?.gradeLevel, 10),
    phone: strOf(s?.phone ?? s?.studentPhone ?? s?.student_phone ?? s?.phoneNumber ?? s?.phone_number ?? s?.mobile, 20).replace(/\D/g, ""),
    parent: strOf(s?.parentPhone ?? s?.parent_phone ?? s?.guardianPhone ?? s?.parentPhoneNumber ?? s?.parent_phone_number, 20).replace(/\D/g, ""),
  })).filter((s: Any) => s.uid > 0 && s.name).slice(0, 500);
}
function hubFail(kind: string, path: string, r: { status: number; body: Any; ms: number; retry?: number; ctype?: string }): Any {
  const reason = isNoApi(r.status, r.body) ? "noapi" : failWhy(r.status, r.body);
  console.log("app-sync hub", kind, r.status, reason, r.ms + "ms", r.ctype || "");
  return { ok: false, reason, status: r.status, path, ...(r.status === 429 || reason === "busy" ? { retry: r.retry || 60 } : {}), ver: APP_VER };
}
function hubThrow(kind: string, path: string, e: unknown): Any {
  const to = (e as Error)?.name === "AbortError";
  console.log("app-sync hub", kind, 0, to ? "timeout" : "network", short(e));
  return to ? { ok: false, reason: "timeout", sec: Math.round(HUB_TIMEOUT_MS / 1000), path, ver: APP_VER } : { ok: false, reason: "network", path, ver: APP_VER };
}
async function appClasses(): Promise<Any> {
  const path = "/api/hub/classes";
  try {
    const r = await hubGet(path, { kind: "classes" });
    if (isNoApi(r.status, r.body) || !r.ok) return hubFail("classes", path, r);
    const list = classesOf(r.body);
    if (!list.length && !pickArr(r.body, ["classes", "items", "results", "list", "rows", "data"])) {
      console.log("app-sync hub classes shape", shapeKeys(r.body));
      return { ok: false, reason: "shape", status: r.status, path, keys: shapeKeys(r.body), ver: APP_VER };
    }
    return { ok: true, classes: list, ver: APP_VER };
  } catch (e) { return hubThrow("classes", path, e); }
}
async function appRoster(idIn: unknown): Promise<Any> {
  const id = typeof idIn === "number" ? idIn : strOf(idIn, 40);
  if (!(typeof id === "number" ? id > 0 : /^[\w-]{1,40}$/.test(id))) return { ok: false, reason: "input", ver: APP_VER };
  const path = "/api/hub/classes/" + encodeURIComponent(String(id)) + "/students";
  try {
    const r = await hubGet(path, { kind: "roster" });
    if (isNoApi(r.status, r.body) || !r.ok) return hubFail("roster", "/api/hub/classes/{id}/students", r);
    if (!pickArr(r.body, ["students", "members", "users", "items", "results", "list", "rows", "data"])) {
      console.log("app-sync hub roster shape", shapeKeys(r.body));
      return { ok: false, reason: "shape", status: r.status, path: "/api/hub/classes/{id}/students", keys: shapeKeys(r.body), ver: APP_VER };
    }
    return { ok: true, classId: id, students: rosterOf(r.body), ver: APP_VER };
  } catch (e) { return hubThrow("roster", "/api/hub/classes/{id}/students", e); }
}

/* 동기화 기록 (105) — 숫자 · 이유 코드만 (이름 · 번호 · 열쇠 값 없음) · 105 전이면 함수가 없어 그냥 넘어간다 */
async function logRun(kind: string, sum: Any) {
  try { await rpc("app_sync_log", { p_kind: kind, p_sum: { ...sum, hub: !!hubKey() } }); }
  catch (e) { console.error("app-sync log", short(e)); }
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
    /* 옛 기록 (104 · 105 · 106) — 1명 × 한 달씩 · 밤 1~6시에도 돈다(평소 동기화는 쉼 · 그 시간을 옛 기록이 다 씀)
       낮에는 평소 동기화가 먼저 · 옛 기록은 함수 시간의 70% 까지 · 건너뛰거나 실패하면 이유를 남긴다 (105) */
    if (!hubKey()) old = { skip: "nokey" };
    else if (!due?.night && Date.now() - started >= BUDGET_MS * 0.6) old = { skip: "time" };
    else old = await runOldMonths(started, due?.night ? BUDGET_MS : BUDGET_MS * 0.7, !!due?.night).catch((e) => ({ err: "run: " + short(e) }));
    if (!due?.night && hubKey() && Date.now() - started < BUDGET_MS * 0.75) {
      let ll: Any[] = [];
      try { ll = (await rpc("app_link_due", { p_limit: 20 })) || []; } catch (e) { link = { err: "due: " + short(e) }; }
      if (ll.length) link = await runLink(ll, started);
    }
    await flushCalls();
    await logRun("cron", { night: !!due?.night, due: list.length, ...r, link, old, ms: Date.now() - started });
    return json({ ok: true, night: !!due?.night, due: list.length, ...r, ...(link ? { link } : {}), ...(old && (old.tried || old.err || old.skip) ? { old } : {}) }, cors);
  }

  /* 2) 코치룸 [새로고침] — 로그인한 운영진 */
  if (body.action !== "refresh" && body.action !== "link" && body.action !== "app_classes" && body.action !== "app_roster") return json({ ok: false, reason: "input" }, cors, 400);
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  let staff = false;
  try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
  if (!staff) return json({ ok: false, reason: "auth", message: "운영진만 할 수 있습니다." }, cors, 403);
  const ids: string[] = (Array.isArray(body.students) ? body.students : []).map((x: unknown) => String(x ?? "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
  const cls = String(body.class ?? "").slice(0, 60);
  /* 앱 반 목록 · 반 명단 (20261113b · 온라인 반 가져오기) — 앱에 주소가 아직 없으면 { ok: false, reason: "noapi" } (화면 「앱 업데이트 필요」 · 아무것도 넣지 않음) */
  if (body.action === "app_classes" || body.action === "app_roster") {
    if (!hubKey()) return json({ ok: false, reason: "nokey", message: "앱 읽기 열쇠(HUB_READ_KEY)가 아직 없습니다.", ver: APP_VER }, cors);
    const r = body.action === "app_classes" ? await appClasses() : await appRoster(body.classId);
    await flushCalls();
    return json(r, cors);
  }
  /* 학생 카드 [다시 찾기] — 그 학생만 앱에서 찾기 (20261110m) */
  if (body.action === "link") {
    if (!ids.length) return json({ ok: false, reason: "input" }, cors, 400);
    if (!hubKey()) return json({ ok: false, reason: "nokey", message: "앱 읽기 열쇠(HUB_READ_KEY)가 아직 없습니다." }, cors);
    const ll: Any[] = await rpc("app_link_due", { p_limit: ids.length, p_students: ids }) || [];
    const lr = await runLink(ll);
    await flushCalls();
    return json({ ok: true, ...lr }, cors);
  }
  if (!ids.length && !cls) return json({ ok: false, reason: "input", message: "반이나 학생을 골라 주세요." }, cors, 400);
  const list: Any[] = await rpc("app_sync_targets", { p_students: ids.length ? ids : null, p_class: cls || null }) || [];
  const r = await runList(list);
  await flushCalls();
  await logRun("refresh", { due: list.length, ...r });
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
