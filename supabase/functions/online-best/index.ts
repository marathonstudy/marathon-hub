// ============================================================
//  online-best — 러닝노트 온라인 「🏅 우수 수행」 사진 · 선정 이유 (20261120d · migration-126)
//
//  1) 사진 { action: "files", code | student, items: [{ key, i }] (12개까지) }
//     앱 제출 사진은 앱 비공개 저장소에 있다 → 앱 GET /api/hub/submission-file?submissionId=…&index=… (x-hub-key · 5분짜리 서명 주소 JSON)을
//     이 함수가 서버에서만 부른다. 열쇠(HUB_READ_KEY)는 Supabase Secrets — 화면 · 응답 · 로그에 남기지 않는다.
//     누가 볼 수 있나 — 러닝노트 본인 학생 · 학부모 링크(code · hub_best_file · 숨긴 제출 · 사진 빼고) · 코치룸 직원(로그인 토큰 · staff_best_file)
//     앱에 주소가 아직 없으면(404 · 열쇠 없음) reason "wait" → 화면은 자리표시 · 직원 화면에만 「앱 사진 연결 준비 중」 (주소가 생기면 코드 수정 없이 바로 보임)
//  2) 선정 이유 초안 { action: "draft", student, kind: "wrong" | "text", key, force?, photo? } — 직원만
//     사람 피드백(선생님 한마디)이 없거나 한 줄 이하일 때만 · 카드 하나에 한 번만(저장된 초안 · 오류가 있으면 다시 부르지 않음 · [다시 쓰기] = force)
//     Claude(ANTHROPIC_API_KEY · claude-haiku-5-5)에 사진(앱 주소가 있을 때) · 문항 수 · 정답 수 · 점수 · 지문 제목 · 사람 메모만 보낸다(학생 이름 · 전화번호 없음)
//     크레딧 부족은 다시 시도하지 않고 err "credit"(직원 화면 「AI 크레딧 부족」) · 학생 · 학부모에게는 직원이 [확인]한 글만(best_note_set)
//  배포: Edge Functions → Deploy a new function → 이름 online-best → 이 파일 전체 → Verify JWT 끄기(러닝노트 링크는 로그인 없음)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const APP_BASE = "https://marathonstudy.com";
const MODEL = "claude-haiku-5-5";
const MAX_ITEMS = 12, APP_TIMEOUT_MS = 12000, MAX_IMG_BYTES = 4_000_000, MAX_PHOTOS = 3;

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
const validCode = (c: unknown) => typeof c === "string" && /^[A-Za-z0-9]{20,64}$/.test(c);
const validUuid = (c: unknown) => typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c);
/* 제출 열쇠 = 제출 시각(초까지) # 강 번호 (migration-120 _sub_key) */
export const validKey = (k: unknown) => typeof k === "string" && /^[0-9T:\-.+Z#]{1,120}$/.test(k);

/* ---------- 앱 사진 주소 (서버에서만) ---------- */
/* 앱이 돌려주는 모양이 조금 달라도 — { url } · { signedUrl } · { data: { url } } · https 만 */
export function urlOf(b: Any): string {
  const u = String(b?.url ?? b?.signedUrl ?? b?.signed_url ?? b?.data?.url ?? b?.data?.signedUrl ?? "").trim();
  if (!u || u.length > 2000 || /[\s"'<>]/.test(u)) return "";
  try { const x = new URL(u); return x.protocol === "https:" ? x.toString() : ""; } catch { return ""; }
}
export async function appFile(sub: number, i: number, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const key = env("HUB_READ_KEY");
  if (!key) return { ok: false, reason: "wait" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), APP_TIMEOUT_MS);
  try {
    const r = await fetcher(APP_BASE + "/api/hub/submission-file?submissionId=" + encodeURIComponent(String(sub)) + "&index=" + encodeURIComponent(String(i)),
      { headers: { "Accept": "application/json", "x-hub-key": key }, signal: ctl.signal });
    const ctype = String(r.headers.get("content-type") || "");
    const body: Any = /json/i.test(ctype) ? await r.json().catch(() => null) : null;
    if (r.ok) { const u = urlOf(body); return u ? { ok: true, url: u } : { ok: false, reason: "wait" }; }
    if (r.status === 429) return { ok: false, reason: "busy" };
    /* 주소가 아직 없음(앱 404 화면 · JSON 아님) · 열쇠 권한 없음 → 「앱 사진 연결 준비 중」 */
    if (!body || r.status === 401 || r.status === 403 || r.status === 501) return { ok: false, reason: "wait" };
    return { ok: false, reason: r.status === 404 ? "notfound" : "upstream" };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === "AbortError" ? "timeout" : "upstream" };
  } finally { clearTimeout(t); }
}

/* ---------- 선정 이유 ---------- */
const BAN = /꼭|반드시|무조건/g;
export function promptOf(kind: "wrong" | "text", inp: Any, photoN: number): string {
  const what = kind === "wrong" ? "오답정리" : "지문 장악(필기)";
  const facts = [
    "과제: " + what,
    inp.title ? "지문 제목: " + String(inp.title).slice(0, 200) : "",
    Number(inp.n) > 0 ? "문항 수: " + Number(inp.n) + " · 맞힌 수: " + Number(inp.k) : "",
    Number.isFinite(Number(inp.wa)) && inp.wa != null ? "오답정리 점수: " + Number(inp.wa) + "점" : "",
    Number.isFinite(Number(inp.tc)) && inp.tc != null ? "필기 점수: " + Number(inp.tc) + "점" : "",
    inp.fb ? "선생님 짧은 메모: " + String(inp.fb).slice(0, 200) : "",
  ].filter(Boolean).join("\n");
  const how = kind === "wrong"
    ? "오답정리는 ① 내가 틀린 이유 ② 정답이 정답인 이유 ③ 둘을 비교해 깨달은 점, 이 세 가지 기준으로 봅니다. 사진에 실제로 보이는 것(어느 문항인지, 무엇을 어떻게 적었는지)을 구체적으로 짚어 주세요."
    : "지문 장악은 지문 구조 표시, 핵심어 정리, 요약처럼 사진에 실제로 보이는 것만 짚어 주세요.";
  const photo = photoN > 0
    ? "위 사진 " + photoN + "장이 학생이 낸 " + what + "입니다. 사진에서 확인할 수 없는 내용은 쓰지 마세요. 글씨가 흐리거나 읽기 어려우면 그 부분은 「사진이 흐려 확인이 어려움」이라고 쓰세요."
    : "사진은 아직 볼 수 없습니다. 사진 내용을 짐작해 쓰지 말고, 위 정보(점수 · 문항 · 지문 제목 · 메모)로만 쓰세요.";
  return [
    "국어 학원 선생님이 학생의 " + what + " 과제를 이번 달 우수 수행으로 골랐습니다. 학생과 학부모가 읽을 「선정 이유」를 3~5문장으로 써 주세요.",
    facts, how, photo,
    "규칙: 과장하지 않기 · 다른 학생과 비교하지 않기 · 순위 말하지 않기 · 「꼭 · 반드시 · 무조건」 쓰지 않기 · 선생님이 칭찬하는 따뜻한 존댓말(~했어요).",
    "출력: 선정 이유 글만 쓰세요(제목 · 목록 · 따옴표 · 머리말 없이).",
  ].join("\n\n");
}
export function tidy(t: string): string {
  let s = String(t || "").replace(/^["'「『\s]+|["'」』\s]+$/g, "").replace(/\r/g, "").trim();
  s = s.replace(BAN, "").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.slice(0, 900);
}
function b64(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function loadMedia(url: string): Promise<{ type: string; data: string } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type) && type !== "application/pdf") return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_IMG_BYTES) return null;
    return { type, data: b64(buf) };
  } catch { return null; }
}
export async function askClaude(key: string, kind: "wrong" | "text", inp: Any, media: { type: string; data: string }[], fetcher: typeof fetch = fetch): Promise<{ ok: boolean; text?: string; err?: string }> {
  const content: Any[] = [];
  media.forEach((m, i) => {
    content.push({ type: "text", text: "사진 " + (i + 1) });
    content.push(m.type === "application/pdf" ? { type: "document", source: { type: "base64", media_type: m.type, data: m.data } } : { type: "image", source: { type: "base64", media_type: m.type, data: m.data } });
  });
  content.push({ type: "text", text: promptOf(kind, inp, media.length) });
  const r = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: "user", content }] }),
  });
  const body: Any = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = String(body?.error?.message ?? "");
    if (/credit|balance|billing/i.test(msg) || r.status === 402) return { ok: false, err: "credit" };       /* 크레딧 부족 — 다시 시도하지 않음 */
    if (r.status === 401 || r.status === 403) return { ok: false, err: "nokey" };
    return { ok: false, err: "ai" };
  }
  const text = tidy((body?.content || []).filter((c: Any) => c?.type === "text").map((c: Any) => c.text).join("\n"));
  return text ? { ok: true, text } : { ok: false, err: "ai" };
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "config" }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const auth = req.headers.get("authorization") ?? "", apikey = req.headers.get("apikey") ?? "";
  const staffCall = validUuid(body.student);

  if (body.action === "files") {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS)
      .filter((x: Any) => x && validKey(x.key) && Number.isInteger(Number(x.i)) && Number(x.i) >= 0 && Number(x.i) <= 50);
    if (!items.length || (!staffCall && !validCode(body.code))) return json({ ok: false, reason: "input" }, cors, 400);
    if (staffCall && (!/^Bearer\s+\S+/.test(auth) || !apikey)) return json({ ok: false, reason: "login" }, cors, 401);
    const out: Any[] = [];
    let wait = false;
    for (const x of items) {
      const k = String(x.key), i = Number(x.i);
      let f: Any;
      try {
        f = staffCall ? await rpc("staff_best_file", { p_student: body.student, p_key: k, p_i: i }, auth, apikey)
                      : await rpc("hub_best_file", { p_code: body.code, p_key: k, p_i: i });
      } catch { return json({ ok: false, reason: "auth" }, cors, 403); }
      if (!f || !f.ok) { out.push({ key: k, i, ok: false, reason: f?.reason || "notfound" }); continue; }
      const g = wait ? { ok: false, reason: "wait" } : await appFile(Number(f.sub), i);
      if (!g.ok && g.reason === "wait") wait = true;                     /* 앱에 주소가 없으면 나머지는 묻지 않음 */
      out.push(g.ok ? { key: k, i, ok: true, url: g.url, kind: f.kind } : { key: k, i, ok: false, reason: g.reason, kind: f.kind });
    }
    return json({ ok: true, files: out, wait }, cors);
  }

  if (body.action === "draft") {
    if (!staffCall || !(body.kind === "wrong" || body.kind === "text") || !validKey(body.key)) return json({ ok: false, reason: "input" }, cors, 400);
    if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login" }, cors, 401);
    let inp: Any;
    try { inp = await rpc("staff_best_input", { p_student: body.student, p_kind: body.kind, p_key: body.key }, auth, apikey); }
    catch { return json({ ok: false, reason: "auth" }, cors, 403); }
    if (!inp || !inp.ok) return json({ ok: false, reason: inp?.reason || "notfound" }, cors);
    const n = inp.note || null;
    /* 카드 하나에 한 번 — 저장된 초안 · 오류(크레딧 부족 포함)가 있으면 다시 부르지 않음 · [다시 쓰기](force)만 */
    if (!body.force && n && (String(n.draft || "").trim() || n.err)) return json({ ok: true, saved: true, note: n }, cors);
    if (!body.force && !inp.need) return json({ ok: true, skip: "fb" }, cors);
    const key = env("ANTHROPIC_API_KEY");
    if (!key) { await rpc("best_note_ai_save", { p_student: body.student, p_kind: body.kind, p_key: body.key, p_draft: "", p_photo: false, p_err: "nokey" }).catch(() => 0); return json({ ok: false, reason: "nokey" }, cors); }
    /* 사진 — 앱 주소가 있을 때만(제출 id) · 이미지 3장 · PDF 1개까지 */
    const media: { type: string; data: string }[] = [];
    let photoWait = false;
    if (inp.app && body.photo !== false) {
      let pdf = 0;
      for (const f of (inp.files || [])) {
        if (media.length >= MAX_PHOTOS) break;
        if (f.kind === "pdf" && pdf >= 1) continue;
        let file: Any;
        try { file = await rpc("staff_best_file", { p_student: body.student, p_key: body.key, p_i: Number(f.i) }, auth, apikey); } catch { file = null; }
        if (!file?.ok) continue;
        const g = await appFile(Number(file.sub), Number(f.i));
        if (!g.ok) { if (g.reason === "wait") { photoWait = true; break; } continue; }
        const m = await loadMedia(g.url!);
        if (m) { media.push(m); if (m.type === "application/pdf") pdf++; }
      }
    }
    const res = await askClaude(key, body.kind, inp, media);
    await rpc("best_note_ai_save", { p_student: body.student, p_kind: body.kind, p_key: body.key, p_draft: res.ok ? res.text : "", p_photo: media.length > 0, p_err: res.ok ? "" : res.err })
      .catch(() => 0);
    return res.ok ? json({ ok: true, draft: res.text, photo: media.length > 0, photoWait }, cors) : json({ ok: false, reason: res.err }, cors);
  }
  return json({ ok: false, reason: "input" }, cors, 400);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    console.error("online-best error", String((e as Error).message || e).slice(0, 200));
    return json({ ok: false, reason: "error", message: "잠시 후 다시 시도해 주세요." }, cors, 200);
  }
});
