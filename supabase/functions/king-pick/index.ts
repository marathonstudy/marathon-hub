// ============================================================
//  king-pick — 이번 주 「오답정리왕」 · 「지문 장악왕」 후보 계산 (20261110i · migration-099)
//
//  무엇을 보나 — 코치룸이 이미 가진 앱 공유 코드로 app-sync 가 받아 둔 제출 사진 주소(app_records.subs)
//    그 반 학생마다 수업 전 예고와 같은 기간(수업일 7일 전 ~ 전날)에 낸 과제 사진을 최대 6장까지
//    사진은 복사해 쌓지 않는다 — 계산할 때만 잠깐 읽어 AI 에 보내고 버린다 (주소만 후보에 남김)
//    AI 에는 학생 이름 · 번호를 보내지 않는다 (사진만)
//  AI — 코치룸 AI 요약 · 다듬기와 같은 Claude(ANTHROPIC_API_KEY · Supabase Secrets) · claude-haiku-5-5
//    한 학생 한 번 부름 · 두 점수를 같이:
//      오답정리(wrong) — 「내가 틀린 이유 · 정답이 정답인 이유 · 깨달은 점」 세 가지가 모두 · 구체적으로 있는지 0~100
//      지문 장악(text) — 지문 위 표시 · 메모가 지문 전체에 빼곡한지(모양만) 0~100
//  결과 — 반 · 수업일 · 종류마다 1~3위 { sid, score, why(근거 한 줄), img(가장 잘 보이는 사진 주소) } → king_save
//    사진이 하나도 없는 종류는 「none」(사람이 고름) · 문자 · 알림톡은 보내지 않는다
//
//  부르는 길
//    1) 15분마다 자동 — 헤더 x-cron-key(DB 에만 있는 값 · 필기 알림과 같음) · king_auto(설정한 시간이 지나면 1위 자동 확정 · 기본 끔) → king_due 반 2개까지
//    2) 코치룸 [후보 다시 계산] { action: "calc", class, lesson } — 로그인한 운영진
//  배포: Edge Functions → Deploy a new function → 이름 king-pick → 이 파일 전체 → Verify JWT 끄기
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const APP_BASE = "https://marathonstudy.com";
const MODEL = "claude-haiku-5-5";
const PRICE_IN = 0.1 / 1_000_000;   // 달러 / 입력 토큰 (text-polish 와 같은 값)
const PRICE_OUT = 0.5 / 1_000_000;  // 달러 / 출력 토큰
const MAX_IMG = 6, MAX_DOC = 2, MAX_BYTES = 4_500_000, AT_ONCE = 3, BUDGET_MS = 120000, CRON_CLASSES = 2;

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

/* ---------- 사진 ---------- */
/* 앱 사진 주소만 — 「/objects/…」 「/uploads/…」 또는 marathonstudy.com 주소 (다른 곳은 열지 않는다) */
export function absUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  if (!s || /[\s"'<>]/.test(s) || s.length > 400) return "";
  if (/^\/(objects|uploads)\//.test(s)) return APP_BASE + s;
  try { const x = new URL(s); return x.protocol === "https:" && /(^|\.)marathonstudy\.com$/.test(x.hostname) ? x.toString() : ""; } catch { return ""; }
}
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export function isImage(f: Any): boolean {
  const t = String(f?.type ?? "").toLowerCase();
  if (t) return IMG_TYPES.includes(t === "image/jpg" ? "image/jpeg" : t);
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(f?.url ?? ""));
}
/* 그 학생 그 주 사진 — 최근 낸 것부터 최대 6장 */
export function photosOf(subs: Any[]): string[] {
  const out: string[] = [];
  (subs || []).slice().sort((a: Any, b: Any) => String(b?.submittedAt ?? "").localeCompare(String(a?.submittedAt ?? ""))).forEach((s: Any) => {
    (Array.isArray(s?.files) ? s.files : []).forEach((f: Any) => { const u = absUrl(f?.url); if (u && isImage(f) && out.length < MAX_IMG && !out.includes(u)) out.push(u); });
  });
  return out;
}
/* PDF — 같은 AI 호출에 문서로 넣어 「풀이 흔적이 가장 많은 쪽」을 고른다 (20261110j · 추가 호출 없음) · 최근 것 2개까지 */
export function docsOf(subs: Any[]): string[] {
  const out: string[] = [];
  (subs || []).slice().sort((a: Any, b: Any) => String(b?.submittedAt ?? "").localeCompare(String(a?.submittedAt ?? ""))).forEach((s: Any) => {
    (Array.isArray(s?.files) ? s.files : []).forEach((f: Any) => {
      const u = absUrl(f?.url), pdf = String(f?.type ?? "").toLowerCase() === "application/pdf" || /\.pdf(\?|$)/i.test(String(f?.url ?? ""));
      if (u && pdf && out.length < MAX_DOC && !out.includes(u)) out.push(u);
    });
  });
  return out;
}
/* 제출물 표(sub_files.src)는 앱이 준 그대로(「/objects/…」) — 보낼 때 앞 주소를 뗀다 */
export function rawOf(u: string): string { return u.startsWith(APP_BASE + "/objects/") || u.startsWith(APP_BASE + "/uploads/") ? u.slice(APP_BASE.length) : u; }
async function loadDoc(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok || !/application\/pdf/i.test(String(r.headers.get("content-type") || ""))) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength && buf.byteLength <= MAX_BYTES ? b64(buf) : null;
  } catch { return null; }
}
function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function loadImage(url: string): Promise<{ type: string; data: string } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    let type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type === "image/jpg") type = "image/jpeg";
    if (!IMG_TYPES.includes(type)) return null;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;
    return { type, data: b64(buf) };
  } catch { return null; }
}

/* ---------- AI ---------- */
export const PROMPT = `아래 사진들은 한 학생이 일주일 동안 낸 국어 과제 사진입니다. 학생 이름은 모릅니다. 두 가지를 0~100 점으로 매겨 주세요.

1) 오답정리(wrong): 틀린 문제에 대해 ① 내가 틀린 이유 ② 정답이 정답인 이유 ③ 깨달은 점 — 세 가지를 모두, 구체적으로 썼는지.
   세 가지가 다 있고 지문 · 선지 근거를 들어 구체적이면 높게(80~100). 하나라도 빠지거나 「실수」 「몰랐음」처럼 짧으면 낮게. 오답정리가 안 보이면 0.
2) 지문 장악(text): 지문 위 밑줄 · 동그라미 · 네모 · 화살표 · 여백 메모 같은 학생 표시가 지문 전체에 걸쳐 빼곡한지 — 모양만 보고 판단(글 내용은 읽지 않아도 됨).
   지문 처음부터 끝까지 고르게 빼곡하면 높게(80~100), 일부만 표시면 중간, 거의 없으면 낮게. 인쇄된 밑줄 · 기호는 학생 표시가 아닙니다. 지문 사진이 없으면 0.

근거(why)는 40자 이내 한 줄로, 학생이 쓴 글을 그대로 옮기지 말고 무엇이 좋았는지만 적어 주세요.
best 는 그 점수를 가장 잘 보여 주는 사진 번호(1부터)입니다.
문서(PDF)가 있으면 문서마다 학생의 풀이 흔적(밑줄 · 메모 · 답 표시)이 가장 많은 쪽 번호를 pages 에 적어 주세요(보통 지문 쪽 · 첫 장이 아니어도 됨).
JSON 하나만 답하세요:
{"wrong":{"score":0,"items":{"why_wrong":false,"why_right":false,"insight":false},"why":"","best":1},"text":{"score":0,"why":"","best":1},"pages":[{"doc":1,"page":1}]}`;

export function parseAi(text: string): Any {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const one = (x: Any) => ({ score: Math.max(0, Math.min(100, Math.round(Number(x?.score) || 0))), why: String(x?.why ?? "").replace(/\s+/g, " ").trim().slice(0, 60), best: Math.max(1, Math.round(Number(x?.best) || 1)) });
    const pages = (Array.isArray(j.pages) ? j.pages : []).map((p: Any) => ({ doc: Math.round(Number(p?.doc) || 0), page: Math.round(Number(p?.page) || 0) })).filter((p: Any) => p.doc >= 1 && p.page >= 1 && p.page <= 999);
    return { wrong: one(j.wrong), text: one(j.text), pages };
  } catch { return null; }
}

async function scoreOne(key: string, urls: string[], docUrls: string[] = []): Promise<{ r: Any; cost: number; used: string[]; docs: string[] }> {
  const imgs: { url: string; img: { type: string; data: string } }[] = [];
  for (const u of urls) { const img = await loadImage(u); if (img) imgs.push({ url: u, img }); }
  const docs: { url: string; data: string }[] = [];
  for (const u of docUrls) { const d = await loadDoc(u); if (d) docs.push({ url: u, data: d }); }
  if (!imgs.length && !docs.length) return { r: null, cost: 0, used: [], docs: [] };
  const content: Any[] = [];
  imgs.forEach((x, i) => { content.push({ type: "text", text: "사진 " + (i + 1) }); content.push({ type: "image", source: { type: "base64", media_type: x.img.type, data: x.img.data } }); });
  docs.forEach((x, i) => { content.push({ type: "text", text: "문서 " + (i + 1) }); content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: x.data } }); });
  content.push({ type: "text", text: PROMPT });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content }] }),
  });
  const body: Any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 401 ? "badkey" : "ai" + res.status);
  const text = (body?.content || []).filter((c: Any) => c?.type === "text").map((c: Any) => c.text).join("\n");
  const inTok = Number(body?.usage?.input_tokens) || 0, outTok = Number(body?.usage?.output_tokens) || 0;
  return { r: parseAi(text), cost: inTok * PRICE_IN + outTok * PRICE_OUT, used: imgs.map((x) => x.url), docs: docs.map((x) => x.url) };
}

/* 반 하나 — 학생마다 점수 → 종류마다 1~3위 · 시간이 모자라면 저장하지 않고 다음 차례로 */
export async function runClass(key: string, cls: string, lesson: string, started = Date.now()) {
  const inp: Any = await rpc("king_inputs", { p_class: cls, p_lesson: lesson });
  const studs: Any[] = (inp?.students || []).map((s: Any) => ({ sid: String(s.sid), urls: photosOf(s.subs || []), docs: docsOf(s.subs || []) }));
  const withPhoto = studs.filter((s) => s.urls.length || s.docs.length);
  const rows: Any[] = [];
  let cost = 0, failed = 0;
  for (let i = 0; i < withPhoto.length; i += AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) return { ok: false, reason: "time", class: cls };
    const part = withPhoto.slice(i, i + AT_ONCE);
    const got = await Promise.all(part.map(async (s) => {
      try { return { s, ...(await scoreOne(key, s.urls, s.docs)) }; } catch (e) {
        if (String((e as Error).message) === "badkey") throw e;
        failed++; return { s, r: null, cost: 0, used: [], docs: [] };
      }
    }));
    got.forEach((g) => { cost += g.cost; if (g.r) rows.push({ sid: g.s.sid, r: g.r, used: g.used, docs: g.docs || [] }); });
  }
  const pickKind = (k: "wrong" | "text") => rows.filter((x) => x.r[k].score > 0)
    .sort((a, b) => b.r[k].score - a.r[k].score).slice(0, 3)
    .map((x) => ({ sid: x.sid, score: x.r[k].score, why: x.r[k].why, img: x.used[Math.min(x.used.length, x.r[k].best) - 1] || x.used[0] || "" }));
  const c = Math.round(cost * 100000) / 100000;
  /* 제출물 보기(100) — PDF 대표 쪽 · 가장 잘 보이는 사진의 정성 점수(대표 고르기 · 코치룸에만) · 100 전이면 조용히 넘어감 */
  const pg: Any[] = [];
  rows.forEach((x) => {
    (x.r.pages || []).forEach((p: Any) => { const d = x.docs[p.doc - 1]; if (d) pg.push({ sid: x.sid, src: rawOf(d), page: p.page }); });
    const care = Math.max(x.r.wrong.score, x.r.text.score), bi = x.r.text.score >= x.r.wrong.score ? x.r.text.best : x.r.wrong.best, bu = x.used[Math.min(x.used.length, bi) - 1];
    if (bu) pg.push({ sid: x.sid, src: rawOf(bu), care });
  });
  if (pg.length) await rpc("sub_page_set", { p_rows: pg }).catch(() => 0);
  /* 학습 분석(101) — 학생마다 두 점수 숫자만 (근거 · 사진 없음) · 101 전이면 조용히 넘어감 */
  if (rows.length) await rpc("king_scores_save", { p_class: cls, p_lesson: lesson, p_rows: rows.map((x) => ({ sid: x.sid, wrong: x.r.wrong.score, text: x.r.text.score })) }).catch(() => 0);
  await rpc("king_save", { p_class: cls, p_lesson: lesson, p_kind: "wrong", p_cands: pickKind("wrong"), p_students: withPhoto.length, p_cost: c });
  await rpc("king_save", { p_class: cls, p_lesson: lesson, p_kind: "text", p_cands: pickKind("text"), p_students: withPhoto.length, p_cost: 0 });
  return { ok: true, class: cls, lesson, students: studs.length, photos: withPhoto.length, scored: rows.length, failed, cost: c };
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "config", message: "서버 설정을 읽지 못했습니다." }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const cronKey = req.headers.get("x-cron-key") ?? "";
  const key = env("ANTHROPIC_API_KEY");
  const started = Date.now();

  /* 1) 15분마다 자동 */
  if (cronKey) {
    let okKey = false;
    try { okKey = (await rpc("note_cron_ok", { p_key: cronKey })) === true; } catch (e) {
      return json({ ok: false, reason: "nosql", message: String((e as Error).message || e).slice(0, 160) }, cors);
    }
    if (!okKey) return json({ ok: false, reason: "auth" }, cors, 403);
    const now = typeof body.now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.now) ? body.now : new Date().toISOString();
    const auto = await rpc("king_auto", { p_now: now }).catch(() => 0);
    if (!key) return json({ ok: false, reason: "nokey", message: "설정 필요 — ANTHROPIC_API_KEY", auto }, cors);
    const due: Any[] = await rpc("king_due", { p_now: now, p_limit: CRON_CLASSES }) || [];
    const done: Any[] = [];
    for (const d of due) {
      if (Date.now() - started > BUDGET_MS) break;
      try { done.push(await runClass(key, String(d.class), String(d.lesson), started)); } catch (e) {
        if (String((e as Error).message) === "badkey") return json({ ok: false, reason: "badkey", auto }, cors);
        done.push({ ok: false, class: d.class, reason: "error" });
      }
    }
    return json({ ok: true, auto, due: due.length, done }, cors);
  }

  /* 2) 코치룸 [후보 다시 계산] — 로그인한 운영진 */
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  let staff = false;
  try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
  if (!staff) return json({ ok: false, reason: "auth", message: "운영진만 할 수 있습니다." }, cors, 403);
  if (body.action !== "calc") return json({ ok: false, reason: "input" }, cors, 400);
  const cls = String(body.class ?? "").trim().slice(0, 60), lesson = String(body.lesson ?? "");
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(lesson)) return json({ ok: false, reason: "input", message: "반과 수업일이 필요합니다." }, cors, 400);
  if (!key) return json({ ok: false, reason: "nokey", message: "AI 연결이 아직 설정되지 않았습니다 (ANTHROPIC_API_KEY)." }, cors);
  try { return json(await runClass(key, cls, lesson, started), cors); } catch (e) {
    if (String((e as Error).message) === "badkey") return json({ ok: false, reason: "badkey", message: "AI 키가 맞지 않습니다." }, cors);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    console.error("king-pick error", String((e as Error).message || e).slice(0, 200));
    return json({ ok: false, reason: "error", message: "후보를 계산하지 못했습니다." }, cors, 200);
  }
});
