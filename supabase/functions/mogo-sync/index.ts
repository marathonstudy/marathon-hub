// ============================================================
//  mogo-sync — 모의고사 분석 레포트(marathon-report) 목록을 받아 학생마다 저장 (migration-089 · 20261109b · 연동약속.md 버전 2)
//
//  왜 — 연동 키는 서버끼리만 쓴다. 코치룸 · 러닝노트 브라우저는 모고 주소를 직접 부르지 않고, 이 함수가 받아 mogo_records 에 저장 → 화면은 저장본만 읽는다.
//  세 가지로 부른다
//    1) 20분마다 자동 (migration-089 의 pg_cron) — 헤더 x-cron-key (DB 에만 있는 값) · 연결 상태 확인 + 받을 차례인 학생 15명까지
//    2) 코치룸 학생 상세 [↻] — { action: "refresh", students: [id] } · 로그인한 운영진만 · 20명까지
//    3) 코치룸 연결 상태 — { action: "status" } · 로그인한 운영진만
//  학생 찾기 — 학생 번호가 있으면 「이름 + 학생 번호」 · 없거나 못 찾으면 「이름 + 학부모 번호」(1 · 2 따로 · 모고는 둘 다 맞아야 준다)
//    애매하면 연결하지 않고 check(확인 필요) — 코치룸에 같은 이름 · 같은 번호 학생이 둘 이상(sibling) ·
//      학부모 번호 1 · 2 가 서로 다른 모고 학생(multi) · 같은 시험 같은 응시 차례가 두 번(mixed)
//    모두 「일치하는 학생 없음」이면 none · 번호가 하나도 없으면 nophone
//  천천히 — 한 번에 2명 · 묶음마다 0.6초 쉼 · 429(너무 많이)면 그 차례는 멈춤 (모고 무료 한도 · 1분 120회 안)
//  받은 항목은 약속한 것만 남기고 모르는 항목은 버린다 · 받은 버전(version)은 그대로 저장 (코치룸이 약속보다 높으면 「새 항목이 생겼어요」)
//
//  키 — Supabase → Edge Functions → Secrets 의 MOGO_HUB_KEY (값은 원장님이 직접 넣는다 · 코드 · 저장소 · 화면 · 로그에 없음)
//       없으면 연동만 「설정 필요」로 조용히 꺼진다 (nokey) · 코치룸 다른 기능은 그대로
//       Supabase 가 함수에 기본으로 주는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (이 함수 안에서만)
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 mogo-sync → 이 파일 전체 → Deploy → Verify JWT 끄기
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const MOGO = "https://marathon-report.netlify.app";
const AT_ONCE = 2, PAUSE_MS = 600, BUDGET_MS = 110000, CRON_LIMIT = 15;

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/* ---------- 받은 것 — 약속한 항목만 (모르는 항목은 버림) ---------- */
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
function cleanReport(x: Any) {
  if (!x || typeof x !== "object") return null;
  const id = str(x.id, 120);
  if (!/^[A-Za-z0-9._-]{6,120}$/.test(id)) return null;
  const date = str(x.date, 10);
  const score = typeof x.score === "number" && Number.isFinite(x.score) ? Math.round(x.score) : null;
  const attempt = typeof x.attempt === "number" && Number.isInteger(x.attempt) && x.attempt >= 1 ? Math.min(x.attempt, 99) : 1;
  return {
    id, examName: str(x.examName, 80) || "모의고사", date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    score, grade: str(x.grade, 12) || null, done: x.done === true, closed: x.closed === true,
    firstAttempt: x.firstAttempt === false ? false : true, attempt,
  };
}
const okUrl = (v: unknown) => { const s = str(v, 300); return s.startsWith(MOGO + "/") && !/[\s"'<>]/.test(s) ? s : ""; };
function cleanExtra(b: Any) {
  return { notebookUrl: okUrl(b?.notebookUrl), analysisUrl: okUrl(b?.analysisUrl), typeCode: str(b?.typeCode, 8), summary: str(b?.summary, 200) };
}
const ver = (b: Any) => (typeof b?.version === "number" && Number.isInteger(b.version) && b.version > 0 ? b.version : null);

/* ---------- 모고 부르기 ---------- */
async function call(path: string, key: string, body?: unknown): Promise<{ status: number; body: Any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(MOGO + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-hub-key": key, "Accept": "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  } finally { clearTimeout(t); }
}

/* 연결 상태 — ok · down(끊김) · badkey(키 틀림) */
async function checkStatus(key: string) {
  const r = await call("/api/hub/status", key);
  const state = r.status !== 200 || !r.body || r.body.ok !== true ? "down" : r.body.keyOk === false ? "badkey" : "ok";
  const out = { state, version: ver(r.body) };
  await rpc("mogo_status_save", { p: out }).catch(() => {});
  return out;
}

/* 한 번 묻기 — found(찾음) · none(일치 없음) · stop(429 · 키 문제 → 그 차례 멈춤) · err(못 받음) */
async function ask(key: string, body: Any): Promise<Any> {
  const r = await call("/api/hub/reports", key, body);
  if (r.status === 429) return { kind: "stop", reason: "busy" };
  if (r.status === 401) return { kind: "stop", reason: "badkey" };
  if (r.status === 503) return { kind: "stop", reason: "nokey" };
  const b = r.body;
  if (r.status === 200 && b && b.ok === true) return { kind: "found", b };
  if (r.status === 200 && b && b.reason === "STUDENT_NOT_FOUND") return { kind: "none" };
  if (r.status === 400) return { kind: "none" };          /* BAD_INPUT — 번호 모양이 맞지 않음 */
  return { kind: "err", reason: r.status === 0 ? "down" : "http" + r.status };
}
/* 기록장 주소의 학생별 열쇠(s=) — 모고 학생 한 명을 가리킨다 */
const nbKey = (u: string) => { const m = /[?&]s=([^&#]+)/.exec(u || ""); return m ? m[1] : ""; };
/* 같은 시험 · 같은 응시 차례가 두 번 → 다른 학생 기록이 섞였을 수 있음 (attempt 를 보낸 기록만 · 버전 2부터) */
function mixed(raw: Any[]) {
  const seen = new Set<string>(), ids = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x.attempt !== "number" || typeof x.examName !== "string" || ids.has(String(x.id))) continue;
    ids.add(String(x.id));
    const k = x.examName.trim() + "|" + x.attempt;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
/* 받은 응답(하나 이상)을 합치기 — 서로 다른 학생이면 연결 안 함(check) */
function finish(s: Any, bodies: Any[], via: string) {
  const keys = new Set(bodies.map((b) => nbKey(okUrl(b?.notebookUrl))).filter(Boolean));
  if (keys.size > 1) return { id: s.id, state: "check", reason: "multi" };
  if (mixed(bodies.flatMap((b) => (Array.isArray(b?.reports) ? b.reports : [])))) return { id: s.id, state: "check", reason: "mixed" };
  const seen = new Map<string, Any>();
  let extra: Any = null, version: number | null = null;
  for (const b of bodies) {
    version = Math.max(version || 0, ver(b) || 0) || version;
    (Array.isArray(b.reports) ? b.reports : []).forEach((x: Any) => { const c = cleanReport(x); if (c && !seen.has(c.id)) seen.set(c.id, c); });
    const e = cleanExtra(b);
    if (!extra) extra = e; else Object.keys(e).forEach((k) => { if (!extra[k] && (e as Any)[k]) extra[k] = (e as Any)[k]; });
  }
  const reports = [...seen.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { id: s.id, state: "ok", reports, extra: extra || {}, version, reason: via };
}

/* 학생 한 명
   1) 학생 번호가 있으면 「이름 + 학생 번호」 — 찾으면 끝
   2) 없거나 못 찾으면 「이름 + 학부모 번호」(1 · 2 따로) — 모고는 이름 + 번호가 둘 다 맞는 학생만 준다
   코치룸에 같은 이름 · 같은 번호인 학생이 둘 이상이면(_mogo_row 의 dup*) 묻지 않고 「확인 필요(check · sibling)」
   학부모 번호 1 · 2 가 서로 다른 모고 학생을 가리키면 「확인 필요(multi)」 · 같은 시험 같은 차례가 두 번이면 「확인 필요(mixed)」 */
async function fetchOne(key: string, s: Any): Promise<Any> {
  const d = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const ok8 = (p: string) => /^(010)?\d{8}$/.test(p) || /^01[16789]\d{7,8}$/.test(p);
  const phone = d(s.phone), p1 = d(s.parent1), p2 = d(s.parent2);
  const parents: [string, boolean][] = [];
  if (ok8(p1)) parents.push([p1, s.dupParent1 === true]);
  if (ok8(p2) && p2.slice(-8) !== p1.slice(-8)) parents.push([p2, s.dupParent2 === true]);
  if (!ok8(phone) && !parents.length) return { id: s.id, state: "nophone", reason: "nophone" };
  const fail = (r: Any) => ({ id: s.id, state: "error", reason: r.reason, ...(r.kind === "stop" ? { stop: true } : {}) });
  if (ok8(phone)) {
    if (s.dupPhone === true) return { id: s.id, state: "check", reason: "sibling" };
    const r = await ask(key, { name: s.name, phone });
    if (r.kind === "found") return finish(s, [r.b], "phone");
    if (r.kind !== "none") return fail(r);
  }
  if (!parents.length) return { id: s.id, state: "none", reason: "notfound" };
  if (parents.some((x) => x[1])) return { id: s.id, state: "check", reason: "sibling" };
  const got: Any[] = [];
  for (const [p] of parents) {
    const r = await ask(key, { name: s.name, parentPhone: p });
    if (r.kind === "found") got.push(r.b);
    else if (r.kind !== "none") return fail(r);
  }
  if (!got.length) return { id: s.id, state: "none", reason: "notfound" };
  return finish(s, got, "parent");
}

/* 여러 명 — 2명씩 · 묶음마다 저장 (중간에 끊겨도 받은 것은 남는다) */
export async function runList(key: string, list: Any[], started = Date.now()) {
  const out = { saved: 0, found: 0, none: 0, nophone: 0, check: 0, failed: 0, left: 0, stopped: "" };
  for (let i = 0; i < list.length; i += AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) { out.left = list.length - i; break; }
    const part = list.slice(i, i + AT_ONCE);
    const results: Any[] = [];
    for (const s of part) { const r = await fetchOne(key, s); results.push(r); if (r.stop) break; }   /* 429 · 키 문제면 바로 멈춤 */
    const stop = results.find((r) => r.stop);
    const save = results.filter((r) => !r.stop).map(({ stop: _s, ...r }) => r);
    if (save.length) out.saved += Number(await rpc("mogo_save", { p_rows: save })) || 0;
    save.forEach((r) => { if (r.state === "ok") out.found++; else if (r.state === "none") out.none++; else if (r.state === "nophone") out.nophone++; else if (r.state === "check") out.check++; else out.failed++; });
    if (stop) { out.stopped = stop.reason; out.left = list.length - i - save.length; if (stop.reason === "badkey" || stop.reason === "nokey") await rpc("mogo_status_save", { p: { state: stop.reason } }).catch(() => {}); break; }
    if (i + AT_ONCE < list.length) await sleep(PAUSE_MS);
  }
  return out;
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "config", message: "서버 설정을 읽지 못했습니다." }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const cronKey = req.headers.get("x-cron-key") ?? "";
  const key = env("MOGO_HUB_KEY");

  /* 1) 20분마다 자동 */
  if (cronKey) {
    let okKey = false;
    try { okKey = (await rpc("note_cron_ok", { p_key: cronKey })) === true; } catch (e) {
      return json({ ok: false, reason: "nosql", message: String((e as Error).message || e).slice(0, 160) }, cors);
    }
    if (!okKey) return json({ ok: false, reason: "auth" }, cors, 403);
    if (!key) { await rpc("mogo_status_save", { p: { state: "nokey" } }).catch(() => {}); return json({ ok: false, reason: "nokey", message: "설정 필요 — MOGO_HUB_KEY" }, cors); }
    const st = await checkStatus(key);
    if (st.state !== "ok") return json({ ok: false, reason: st.state }, cors);
    const now = typeof body.now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.now) ? body.now : new Date().toISOString();
    const due: Any = await rpc("mogo_due", { p_now: now, p_limit: CRON_LIMIT });
    const list: Any[] = due?.students || [];
    const r = await runList(key, list);
    return json({ ok: true, night: !!due?.night, due: list.length, version: st.version, ...r }, cors);
  }

  /* 2) · 3) 코치룸 — 로그인한 운영진 */
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  let staff = false;
  try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
  if (!staff) return json({ ok: false, reason: "auth", message: "운영진만 할 수 있습니다." }, cors, 403);
  if (!key) { await rpc("mogo_status_save", { p: { state: "nokey" } }).catch(() => {}); return json({ ok: false, reason: "nokey", message: "모의고사 연동 설정 필요" }, cors); }
  if (body.action === "status") return json({ ok: true, ...(await checkStatus(key)) }, cors);
  if (body.action !== "refresh") return json({ ok: false, reason: "input" }, cors, 400);
  const ids: string[] = (Array.isArray(body.students) ? body.students : []).map((x: unknown) => String(x ?? "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
  if (!ids.length) return json({ ok: false, reason: "input", message: "학생을 골라 주세요." }, cors, 400);
  const list: Any[] = await rpc("mogo_targets", { p_students: ids }) || [];
  const r = await runList(key, list);
  return json({ ok: true, due: list.length, ...r }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    console.error("mogo-sync error", String((e as Error).message || e).slice(0, 200));
    return json({ ok: false, reason: "error", message: "모의고사 목록을 받지 못했습니다." }, cors, 200);
  }
});
