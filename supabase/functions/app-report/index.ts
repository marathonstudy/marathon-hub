// ============================================================
//  app-report — 마라톤 앱 학습 리포트를 대신 받아 오는 함수
//
//  왜 필요한가
//    marathonstudy.com 의 API 는 다른 주소(깃허브 페이지)에서 브라우저로
//    직접 부르면 막힌다(CORS 허용 헤더가 없다). 그래서 이 함수가 서버에서
//    대신 받아 와 개인 페이지에 넘겨 준다.
//
//  무엇을 받나
//    ?code=개인링크코드   ← 앱 공유 코드가 아니다
//    ?codes=코드,코드,…   반 단위로 한 번에 (30명까지 · 20261031g) — 함수 안에서 8명씩 동시에 받아 한 번에 돌려준다.
//                        「오늘」 첫 화면용 가벼운 기록만 (날짜별 제출 · 강의 · 과제 제목 · 제출 시각 — 최근 120일)
//                        { ok: true, items: { 코드: { ok, data } | { ok: false, reason } } }
//    함수가 그 학생의 앱 공유 코드를 DB 함수(hub_app_code)로 찾는다.
//    그래서 아무 공유 코드나 넣어 남의 자료를 받아 가는 통로가 되지 않는다.
//    퇴원 학생이면 빈 결과를 돌려준다.
//
//  무엇을 돌려주나
//    제출률·정시율·강의 시청률, 날짜별 제출, 영역별 정답률, 차시 요약,
//    과제 기록 전부(제목·날짜·지각 여부·정답률·강 번호) — 러닝노트가 레포트 주차의 과제 기간만 잘라 보여 준다.
//    (예전 화면을 위해 최근 10건 recent 도 함께)
//    제출 사진 주소, 선생님 피드백, 학생이 쓴 글, 프로필 사진은 빼고 보낸다.
//    who — 앱에 등록된 학생 이름 (있을 때만 · 20261031k) — 코치룸이 우리 학생 이름과 달라 보이면 「링크 확인 필요」
//          (다른 학생의 공유 링크를 잘못 넣었을 때). 앱이 이름을 어느 항목에 담는지 모르므로 흔한 자리를 차례로 본다.
//    shape — 앱이 실제로 보내는 항목 「이름」만 (값은 없다 · 20261030a). 코치룸 미리보기 「과제 상세」 맨 아래에서
//    문항별 정오 · 풀이 시간 같은 항목이 앱에 생겼는지 확인하는 용도.
//
//  키
//    이 파일에는 어떤 키도 적지 않는다. Supabase 가 함수에 자동으로 넣어 주는
//    SUPABASE_URL · SUPABASE_ANON_KEY 를 쓰고, 없으면 페이지가 보낸
//    publishable key(apikey 헤더)를 쓴다. 둘 다 공개돼도 되는 키다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor
//        이름 app-report, 이 파일 전체 붙여넣기, Verify JWT 끄기 (README 참고)
// ============================================================

const ALLOWED_ORIGINS = [
  "https://marathonstudy.github.io",
];

const APP_API = "https://marathonstudy.com/api/share/report/";

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}

// deno-lint-ignore no-explicit-any
type Any = any;

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

/* 앱에 등록된 학생 이름 — 흔한 자리를 차례로 (없으면 '') */
function whoOf(src: Any): string {
  const c = [src?.studentName, src?.userName, src?.student?.name, src?.studentInfo?.name, src?.user?.name,
             src?.profile?.name, src?.member?.name, src?.classInfo?.studentName, src?.name];
  const v = c.find((x) => typeof x === "string" && x.trim());
  return v ? String(v).trim().slice(0, 40) : "";
}

function pick(src: Any) {
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
    calendar: cal,
    lectures: (full.lectures || []).filter((l: Any) => orders.has(l.order)).map((l: Any) => ({ order: l.order, title: l.title, videosDone: l.videosDone, videosTotal: l.videosTotal })),
    history: (full.history || []).filter((h: Any) => orders.has(h.order) || String(h.submittedAt).slice(0, 10) >= cut)
      .map((h: Any) => ({ title: h.title, order: h.order, submittedAt: h.submittedAt, late: h.late })),
  };
}

/* 개인 링크 코드 하나 → { ok, data } | { ok: false, reason } (한 명 · 반 단위 모두 이것을 쓴다) */
async function fetchOne(code: string, base: string, headers: Record<string, string>): Promise<Any> {
  let share: string | null = null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/hub_app_code`, { method: "POST", headers, body: JSON.stringify({ p_code: code }) });
    if (!r.ok) return { ok: false, reason: "lookup" };
    share = await r.json();
  } catch {
    return { ok: false, reason: "lookup" };
  }
  if (!share || !/^[A-Za-z0-9_-]{8,128}$/.test(share)) return { ok: false, reason: "nolink" };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(APP_API + encodeURIComponent(share), { headers: { "Accept": "application/json" }, signal: ctl.signal });
    clearTimeout(t);
    if (r.status === 404) return { ok: false, reason: "expired" };
    if (!r.ok) return { ok: false, reason: "upstream" };
    return { ok: true, data: pick(await r.json()) };
  } catch {
    return { ok: false, reason: "upstream" };
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ ok: false, reason: "method" }, 405, cors);

  const params = new URL(req.url).searchParams;
  const code = params.get("code") ?? "";
  const many = (params.get("codes") ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
  if (!base || !key) return json({ ok: false, reason: "config" }, 500, cors);
  const headers: Record<string, string> = { "apikey": key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers["Authorization"] = `Bearer ${key}`;

  // 반 단위 — 코드마다 따로 찾고 받는다 (8명씩 동시에 · 한 명이 늦어도 12초에서 끊는다)
  if (many.length) {
    const codes = [...new Set(many)];
    if (codes.length > 30 || codes.some((c) => !/^[A-Za-z0-9]{20,64}$/.test(c))) return json({ ok: false, reason: "invalid" }, 400, cors);
    const items: Record<string, Any> = {};
    let i = 0;
    const worker = async () => {
      while (i < codes.length) {
        const c = codes[i++];
        const r = await fetchOne(c, base, headers);
        items[c] = r.ok ? { ok: true, data: lite(r.data) } : r;
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, codes.length) }, worker));
    return json({ ok: true, items }, 200, cors, "private, max-age=60");
  }

  if (!/^[A-Za-z0-9]{20,64}$/.test(code)) {
    return json({ ok: false, reason: "invalid" }, 400, cors);
  }

  // 1. 개인 링크 코드 → 앱 공유 코드 (퇴원·미등록이면 null)

  let share: string | null = null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/hub_app_code`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_code: code }),
    });
    if (!r.ok) return json({ ok: false, reason: "lookup" }, 502, cors);
    share = await r.json();
  } catch {
    return json({ ok: false, reason: "lookup" }, 502, cors);
  }

  if (!share || !/^[A-Za-z0-9_-]{8,128}$/.test(share)) {
    return json({ ok: false, reason: "nolink" }, 200, cors);
  }

  // 2. 앱 서버에서 받아 오기
  try {
    const r = await fetch(APP_API + encodeURIComponent(share), {
      headers: { "Accept": "application/json" },
    });
    if (r.status === 404) return json({ ok: false, reason: "expired" }, 200, cors);
    if (!r.ok) return json({ ok: false, reason: "upstream" }, 502, cors);
    const data = await r.json();
    return json({ ok: true, data: pick(data) }, 200, cors, "private, max-age=300");
  } catch {
    return json({ ok: false, reason: "upstream" }, 502, cors);
  }
});
