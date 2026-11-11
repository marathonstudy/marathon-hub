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
      if (r.ok) { const raw = await r.json(); const data = pick(raw); return { ok: true, data, lite: lite(data), subs: subsOf(raw) }; }
      last = { ok: false, reason: r.status === 429 || r.status === 503 ? "busy" : "upstream" };
    } catch (e) {
      last = { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream" };
    }
  }
  return last;
}
/* 3명씩 · 묶음마다 쉼 · 시간이 모자라면 남은 학생은 다음 차례로 (next_try 10분) · 묶음마다 저장 (중간에 끊겨도 받은 것은 남는다) */
export async function runList(list: Any[], started = Date.now()) {
  const out = { saved: 0, failed: 0, left: 0, reasons: {} as Record<string, number> };
  for (let i = 0; i < list.length; i += AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) { out.left = list.length - i; break; }
    const part = list.slice(i, i + AT_ONCE).filter((x: Any) => /^[A-Za-z0-9_-]{8,128}$/.test(String(x.share || "")));
    const results = await Promise.all(part.map(async (x: Any) => ({ id: x.id, ...(await fetchShare(String(x.share))) })));
    results.forEach((r: Any) => {
      if (r.ok) out.saved++;
      else { out.failed++; out.reasons[r.reason] = (out.reasons[r.reason] || 0) + 1; console.error("app-sync fail", r.reason); }
    });
    await rpc("app_sync_save", { p_results: results.map(({ subs: _s, ...x }: Any) => x) });
    /* 왕 후보용 사진 주소 · 앱 점수 (099 전이면 함수가 없어 조용히 넘어간다) */
    const subRows = results.filter((x: Any) => x.ok && Array.isArray(x.subs)).map((x: Any) => ({ id: x.id, subs: x.subs }));
    if (subRows.length) await rpc("king_subs_save", { p_rows: subRows }).catch(() => 0);
    if (i + AT_ONCE < list.length) await sleep(PAUSE_MS);
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
    const r = await runList(list);
    return json({ ok: true, night: !!due?.night, due: list.length, ...r }, cors);
  }

  /* 2) 코치룸 [새로고침] — 로그인한 운영진 */
  if (body.action !== "refresh") return json({ ok: false, reason: "input" }, cors, 400);
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  let staff = false;
  try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
  if (!staff) return json({ ok: false, reason: "auth", message: "운영진만 할 수 있습니다." }, cors, 403);
  const ids: string[] = (Array.isArray(body.students) ? body.students : []).map((x: unknown) => String(x ?? "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
  const cls = String(body.class ?? "").slice(0, 60);
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
