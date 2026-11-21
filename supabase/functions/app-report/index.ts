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
//    ?codes=코드,코드,…   반 단위로 한 번에 (30명까지 · 20261031g) — 함수 안에서 3명씩 동시에 받아 한 번에 돌려준다 (20261101d · 예전 8명)
//                         앱 서버가 바쁘다(429 · 5xx) · 응답이 없다(시간 초과)면 잠깐 쉬었다가 2번까지 다시 묻는다
//                         실패 이유: nolink(링크 없음) · expired(링크 만료) · timeout(앱 응답 없음) · busy(앱 서버 바쁨) · upstream(앱 서버 오류) · lookup
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
//    제출 사진 주소, 학생이 쓴 글, 프로필 사진, AI 피드백은 빼고 보낸다.
//    선생님 피드백은 사람이 쓴 것(작성자 이름이 있는 것) 최근 2개 · 200자까지만 fb 로 (20261117c · 온라인 학부모 화면)
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
/* 20261113d — 맞힌 수가 null · "" 이면 Number(null) = 0 으로 「0개 맞힘」이 되던 것 → 숫자(또는 숫자 글자)일 때만 · 칸 이름이 조금 달라도 (app-sync 와 같다) */
const PART_K = ["correctCount", "correct", "correctAnswers", "correctAnswerCount", "correctNum"];
const PART_N = ["totalCount", "totalQuestions", "total", "questionCount", "count"];
function partsOf(h: Any): { parts?: { c: string; k: number; n: number }[] } {
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

/* 20261117b — 앱 반 정보(구간 계산용) — 있는 칸만: 반 id · 이름 · 시작 · 종료일 · 구간 반 여부 · 환급 기준(%) · 강 번호 띄움(off)
   앱 「구간」은 shared/sections.ts calculateSections(총 일수 27일 이상 · has_sections 반만) · 판정은 getSectionOnTimeStats(구간 안 열린 숙제 중 정시 제출 비율 ≥ 기준)
   지금 앱 응답(공유 리포트 · 학생 기준 주소)의 classInfo 에는 id · title · openType 만 있어 나머지는 비어 있다 → 앱이 보내 주면 그대로 저장(.local/replit_구간요청.md) */
const dayStr = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; };
export function classMeta(ci: Any, off: number, rec?: Any): Any {
  if (!ci || typeof ci !== "object") return null;
  if (rec && rec.sectionStats !== undefined && ci.sectionStats === undefined) ci = { ...ci, sectionStats: rec.sectionStats };
  const o: Any = { off, id: ci.id ?? ci.classId ?? null, title: String(ci.title ?? ci.classTitle ?? "").slice(0, 80) };
  const od = dayStr(ci.openDate ?? ci.open_date), cd = dayStr(ci.closeDate ?? ci.close_date);
  if (od) o.openDate = od;
  if (cd) o.closeDate = cd;
  const hs = ci.hasSections ?? ci.has_sections;
  if (typeof hs === "boolean") o.hasSections = hs;
  const th = ci.refundThreshold ?? ci.refund_threshold;
  if (th != null && th !== "" && Number.isFinite(Number(th))) o.refundThreshold = Number(th);
  if (ci.openType) o.openType = String(ci.openType).slice(0, 20);
  /* 앱이 직접 계산한 구간 정시 제출(getSectionOnTimeStats) — 주면 그대로(숫자만) */
  const ss = ci.sectionStats ?? ci.section_stats;
  if (Array.isArray(ss)) o.sectionStats = ss.slice(0, 3).map((s: Any) => ({ section: num(s?.section), on: num(s?.onTimeCount), n: num(s?.totalCount), rate: num(s?.onTimeRate) })).filter((s: Any) => s.section >= 1 && s.section <= 3);
  return o;
}
/* 20261121a — 「숙제 한 건」 카드 · 하루 활동 타임라인(러닝노트 · 그 학생 링크로만) — app-sync 와 같은 사본(시험 e2e150 · e2e157)
   wa · tc = 오답정리 · 지문 장악 점수(wrongAnswerScore · textComprehensionScore · 0~100 · 숫자일 때만) · g = 채점 끝(status graded · 점수가 비면 「채점 전」 판단용)
   rj = 지금 반려 상태(status rejected · 반려 사유 글은 받지 않음) · re = 반려됐다 다시 냄(앱이 resubmitted · resubmittedAt · resubmitCount 를 보내 줄 때 · Replit 1회차)
   fb · fbAt = 사람이 쓴 선생님 피드백(작성자 이름이 있는 teacherFeedback · 500자) · 작성 시각(teacherFeedbackUpdatedAt → gradedAt) — AI 피드백(learningComment · aiFeedback)은 받지 않는다
   fc = 첨부 수 · sp · im · qa = 스스로 칭찬해 주고 싶은 점 · 발전하고 싶은 점 · 영상 강의 퀴즈 답변(학생 글 그대로 · 500자 · 앱이 보내 줄 때만 · 지금 공유 리포트는 빼고 보냄)
   글(sp · im · qa · fb)은 최근 200일 낸 것만(저장 크기) · 점수 · 표시는 전부 */
const TXT_DAYS = 200;
const txtOf = (v: unknown, n = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : "");
const scOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
export function hwMore(h: Any): Any {
  const o: Any = {};
  const wa = scOf(h?.wrongAnswerScore), tc = scOf(h?.textComprehensionScore);
  if (wa != null) o.wa = wa;
  if (tc != null) o.tc = tc;
  const st = String(h?.status ?? "");
  if (st === "graded") o.g = 1;
  if (st === "rejected") o.rj = 1;
  const rc = num(h?.resubmitCount ?? h?.resubmissionCount);
  if (h?.resubmitted === true || h?.isResubmitted === true || rc > 0 || (typeof h?.resubmittedAt === "string" && h.resubmittedAt)) o.re = 1;
  if (Array.isArray(h?.files) && h.files.length) o.fc = Math.min(99, h.files.length);
  const recent = typeof h?.submittedAt === "string" && h.submittedAt >= new Date(Date.now() - TXT_DAYS * 86400000).toISOString();
  if (recent) {
    const human = typeof h?.feedbackAuthorName === "string" && h.feedbackAuthorName.trim();
    const fb = human ? txtOf(h?.teacherFeedback) : "";
    if (fb) {
      o.fb = fb;
      const at = String(h?.teacherFeedbackUpdatedAt ?? h?.feedbackAt ?? h?.gradedAt ?? "");
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) o.fbAt = at.slice(0, 25);
    }
    const sp = txtOf(h?.selfPraise ?? h?.self_praise), im = txtOf(h?.improvement), qa = txtOf(h?.quizAnswer ?? h?.quiz_answer);
    if (sp) o.sp = sp;
    if (im) o.im = im;
    if (qa) o.qa = qa;
  }
  return o;
}
/* 강의 한 줄 — 영상 · 필기노트를 처음 연 시각(앱이 보내 줄 때만 · Replit 1회차 · 지금은 없음) */
function lecMore(l: Any): Any {
  const o: Any = {};
  const va = String(l?.videoOpenedAt ?? l?.videoCompletedAt ?? ""), na = String(l?.noteOpenedAt ?? l?.materialOpenedAt ?? "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(va)) o.va = va.slice(0, 25);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(na)) o.na = na.slice(0, 25);
  if (typeof l?.noteOpenedAt === "string" || l?.noteOpenedAt === null) o.nk = 1;     /* 앱이 필기노트 칸을 보냄(안 열었으면 0회로 셈) */
  return o;
}
function pick(src: Any) {
  const st = src?.stats ?? {};
  const lectures = Array.isArray(src?.lectures) ? src.lectures : [];
  const cal = Array.isArray(src?.calendarData) ? src.calendarData : [];
  const cats = Array.isArray(src?.categoryStats) ? src.categoryStats : [];
  const hist = Array.isArray(src?.homeworkHistory) ? src.homeworkHistory : [];
  /* 과제 기록 — 제목 · 날짜 · 지각 여부 · 정답률 · 강 번호 · 점수 · 사람이 쓴 피드백 · 학생 글(hwMore · 20261121a · 사진 주소는 넘기지 않는다). 오래된 것부터 */
  const hw = hist
    .slice()
    .sort((a: Any, b: Any) => String(a?.submittedAt ?? "").localeCompare(String(b?.submittedAt ?? "")))
    .slice(-2000)
    .map((h: Any) => ({
      title: String(h?.title ?? "").slice(0, 200),
      order: num(h?.lectureOrder),
      /* 숙제 id · 강 안 순서 — 강 하나에 숙제가 여럿이면 지문 목록에 모두 · 같은 숙제는 한 번 (20261120d) */
      ...(num(h?.id) > 0 ? { id: num(h.id) } : {}),
      ...(h?.itemOrder != null && Number.isFinite(Number(h.itemOrder)) ? { io: num(h.itemOrder) } : {}),
      submittedAt: String(h?.submittedAt ?? ""),
      late: !!h?.isLate,
      correctRate: h?.correctRate == null ? null : Math.round(num(h.correctRate)),
      ...countsOf(h),
      ...partsOf(h),
      /* DAY 번호 · 풀이 시간(초) — 앱 공유 리포트의 lectureDay · solvingTimeSeconds(없으면 분 × 60) · 있을 때만 (20261117c) */
      ...(num(h?.lectureDay) > 0 ? { day: num(h.lectureDay) } : {}),
      ...(num(h?.solvingTimeSeconds) > 0 ? { sec: num(h.solvingTimeSeconds) } : num(h?.solvingTimeMinutes) > 0 ? { sec: num(h.solvingTimeMinutes) * 60 } : {}),
      /* 퀴즈 — 답을 냈는지(참 · 거짓)만 · 글은 넘기지 않는다 · 앱이 보낼 때만 (20261117b) */
      ...(typeof h?.quizAnswered === "boolean" ? { quiz: h.quizAnswered } : (h?.quizAnswer ?? h?.quiz_answer) != null ? { quiz: String(h?.quizAnswer ?? h?.quiz_answer).trim() !== "" } : {}),
      ...hwMore(h),
    }));

  /* 선생님 피드백 — 사람(작성자 이름이 있는 것)이 쓴 teacherFeedback 최근 2개만 · 200자까지 · AI 피드백(learningComment · aiFeedback)은 받지 않는다 (20261117c · 온라인 학부모 화면) */
  const fb = hist
    .filter((h: Any) => typeof h?.teacherFeedback === "string" && h.teacherFeedback.trim() && typeof h?.feedbackAuthorName === "string" && h.feedbackAuthorName.trim())
    .sort((a: Any, b: Any) => String(b?.gradedAt ?? b?.submittedAt ?? "").localeCompare(String(a?.gradedAt ?? a?.submittedAt ?? "")))
    .slice(0, 2)
    .map((h: Any) => ({ at: String(h?.gradedAt ?? h?.submittedAt ?? "").slice(0, 10), title: String(h?.title ?? "").slice(0, 60), t: String(h.teacherFeedback).trim().slice(0, 200) }));
  return {
    classTitle: String(src?.classInfo?.title ?? ""),
    fb,
    classes: (Array.isArray(src?.__classes) ? src.__classes : [classMeta(src?.classInfo, 0, src)]).filter(Boolean),
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
      ...lecMore(l),
    })),
    /* 앱이 점수 칸을 보냄(비어 있으면 「채점 전」) · 20261121a */
    ...(hist.some((h: Any) => h && typeof h === "object" && ("wrongAnswerScore" in h || "textComprehensionScore" in h)) ? { sk: 1 } : {}),
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
/* 개인 링크 코드 하나 → { ok, data } | { ok: false, reason } (한 명 · 반 단위 모두 이것을 쓴다)
   앱 서버가 바쁘거나 응답이 없으면 0.7초 · 1.8초 쉬었다가 2번까지 다시 (20261101d) */
async function fetchOne(code: string, base: string, headers: Record<string, string>): Promise<Any> {
  let last: Any = null;
  for (let k = 0; k < 3; k++) {
    if (k) await sleep(k === 1 ? 700 : 1800);
    last = await fetchOnce(code, base, headers);
    if (last.ok || !["timeout", "busy", "upstream", "lookup"].includes(last.reason)) return last;
  }
  return last;
}
async function fetchOnce(code: string, base: string, headers: Record<string, string>): Promise<Any> {
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
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(APP_API + encodeURIComponent(share), { headers: { "Accept": "application/json" }, signal: ctl.signal });
    clearTimeout(t);
    if (r.status === 404) return { ok: false, reason: "expired" };
    if (r.status === 429 || r.status === 503) return { ok: false, reason: "busy", status: r.status };
    if (!r.ok) return { ok: false, reason: "upstream", status: r.status };
    return { ok: true, data: pick(await r.json()) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream" };
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

  // 반 단위 — 코드마다 따로 찾고 받는다 (3명씩 동시에 · 한 명이 늦어도 10초에서 끊고 2번까지 다시)
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
    await Promise.all(Array.from({ length: Math.min(3, codes.length) }, worker));
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
