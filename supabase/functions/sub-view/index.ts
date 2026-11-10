// ============================================================
//  sub-view — 학생 제출물 보기 · 작은 미리보기 (20261110j · migration-100)
//
//  새 데이터는 모으지 않는다 — app-sync 가 저장한 제출물 주소(sub_files.src · 앱 공유 리포트 응답 그대로)만
//  미리보기 — 제출물마다 긴 변 600px 안팎 JPEG 하나를 처음 한 번만 만들어 보관함 sub-thumbs(비공개)에 둔다 · 원본은 누를 때 앱 주소로
//    이미지 — 10분마다 예약(x-cron-key)으로 한 번에 10장씩 조금씩 (레포트 여는 데는 쓰지 않는다)
//    PDF — 서버에서 그리지 않는다. 코치룸 화면이 PDF 를 열 때 대표 쪽(king-pick AI 가 고른 쪽 · 없으면 잉크가 가장 많은 쪽)을 그려 올린다(action put)
//
//  부르는 길
//    1) 예약 { action: "cron" } + x-cron-key — 미리보기 만들기
//    2) 러닝노트 { action: "hub", code, from, to } — 그 학생 링크로만 · 그 학생 것만(hub_sub_list) · 점수 · 근거 없음 · 10분짜리 서명 주소
//    3) 코치룸(로그인한 운영진 · 사용자 권한으로 부름)
//         { action: "staff", student, from, to } · { action: "class", class, day } — 서명 주소
//         { action: "pdf", id } — PDF 원본을 대신 받아 준다(앱 주소는 다른 사이트라 화면이 직접 못 읽음 · 15MB 까지)
//         { action: "put", id, jpeg(base64), w, h, page, by } — PDF 대표 쪽 미리보기 올리기
//  배포: Edge Functions → Deploy a new function → 이름 sub-view → 이 파일 전체 → Verify JWT 끄기
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const APP_BASE = "https://marathonstudy.com";
const BUCKET = "sub-thumbs", SIGN_SECONDS = 600, LONG = 600, MAX_SRC = 15_000_000, MAX_THUMB = 300_000, CRON_N = 10, BUDGET_MS = 100000;

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
const admin = (h: Record<string, string> = {}) => ({ apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"), ...h });

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

/* 앱 제출물 주소만 — 「/objects/…」 「/uploads/…」 또는 marathonstudy.com (다른 곳은 열지 않는다) */
export function absUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  if (!s || /[\s"'<>]/.test(s) || s.length > 400) return "";
  if (/^\/(objects|uploads)\//.test(s)) return APP_BASE + s;
  try { const x = new URL(s); return x.protocol === "https:" && /(^|\.)marathonstudy\.com$/.test(x.hostname) ? x.toString() : ""; } catch { return ""; }
}
const validDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validCode = (c: unknown) => typeof c === "string" && /^[A-Za-z0-9]{20,64}$/.test(c);

/* ---------- 미리보기 만들기 (이미지) ---------- */
// imagescript — 순수 JS (Deno). 시험에서는 globalThis.__imagescript 로 바꿔 끼운다
async function IS(): Promise<Any> { return (globalThis as Any).__imagescript ?? await import("https://deno.land/x/imagescript@1.3.0/mod.ts"); }
export function fitSize(w: number, h: number, long = LONG): [number, number] {
  const m = Math.max(w, h);
  if (m <= long) return [w, h];
  const k = long / m;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
async function fetchBytes(url: string, max: number, ms = 15000): Promise<{ type: string; buf: Uint8Array } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len && len > max) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > max) return null;
    return { type: String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), buf };
  } catch { return null; }
}
async function upload(path: string, jpeg: Uint8Array): Promise<boolean> {
  const r = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST", headers: admin({ "Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "max-age=31536000" }), body: jpeg,
  });
  return r.ok;
}
export async function makeThumb(buf: Uint8Array): Promise<{ jpeg: Uint8Array; w: number; h: number } | null> {
  const lib = await IS();
  const img: Any = await lib.decode(buf);
  if (!img || !img.width || !img.height) return null;
  const [w, h] = fitSize(img.width, img.height);
  const small = w === img.width && h === img.height ? img : img.resize(w, h);
  let jpeg: Uint8Array = await small.encodeJPEG(72);
  if (jpeg.byteLength > MAX_THUMB) jpeg = await small.encodeJPEG(50);
  return jpeg.byteLength <= MAX_THUMB ? { jpeg, w, h } : null;
}
export async function runThumbs(started = Date.now()) {
  const due: Any[] = await rpc("sub_thumb_due", { p_limit: CRON_N }) || [];
  const out = { due: due.length, made: 0, failed: 0 };
  for (const d of due) {
    if (Date.now() - started > BUDGET_MS) break;
    let ok = false;
    try {
      const u = absUrl(d.src), got = u ? await fetchBytes(u, MAX_SRC) : null;
      if (got && /^image\//.test(got.type)) {
        const t = await makeThumb(got.buf);
        const path = `${d.sid}/${d.id}.jpg`;
        if (t && await upload(path, t.jpeg)) { await rpc("sub_thumb_done", { p_id: d.id, p_ok: true, p_path: path, p_w: t.w, p_h: t.h, p_page: null, p_by: null }); ok = true; }
      }
    } catch { ok = false; }
    if (ok) out.made++; else { out.failed++; await rpc("sub_thumb_done", { p_id: d.id, p_ok: false, p_path: "", p_w: null, p_h: null, p_page: null, p_by: null }).catch(() => 0); }
  }
  return out;
}

/* ---------- 보기 — 서명 주소 (보관함 경로는 화면에 보내지 않는다) ---------- */
async function signAll(rows: Any[]): Promise<Any[]> {
  const paths = rows.filter((x) => x && x.status === "ok" && x.path).map((x) => x.path);
  const by: Record<string, string> = {};
  if (paths.length) {
    const r = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/sign/${BUCKET}`, {
      method: "POST", headers: admin({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths }),
    });
    const signed: Any[] = r.ok ? await r.json().catch(() => []) : [];
    for (const s of signed) if (s?.signedURL) by[s.path] = `${env("SUPABASE_URL")}/storage/v1${s.signedURL}`;
  }
  return rows.map((x) => {
    const { path: _p, sid: _s, care: _c, status, ...y } = x || {};
    return { ...y, thumb: x && x.path ? by[x.path] || "" : "", open: absUrl(x && x.src), wait: status === "wait" || status === "pdf" };
  });
}
/* 코치룸은 sid · care 를 화면에 쓴다 (러닝노트에는 원래 없음) */
async function signStaff(rows: Any[]): Promise<Any[]> {
  const s = await signAll(rows);
  return s.map((x, i) => ({ ...x, sid: rows[i].sid, care: rows[i].care, page_by: rows[i].page_by, status: rows[i].status }));
}
function fromB64(s: string): Uint8Array | null {
  try { const bin = atob(s.replace(/^data:image\/jpeg;base64,/, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch { return null; }
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "config" }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const cronKey = req.headers.get("x-cron-key") ?? "";

  /* 1) 예약 — 미리보기 조금씩 */
  if (cronKey) {
    let okKey = false;
    try { okKey = (await rpc("note_cron_ok", { p_key: cronKey })) === true; } catch { okKey = false; }
    if (!okKey) return json({ ok: false, reason: "auth" }, cors, 403);
    return json({ ok: true, ...(await runThumbs()) }, cors);
  }

  /* 2) 러닝노트 — 그 학생 링크로만 */
  if (body.action === "hub") {
    if (!validCode(body.code) || !validDate(body.from) || !validDate(body.to)) return json({ ok: false, reason: "input" }, cors, 400);
    const r: Any = await rpc("hub_sub_list", { p_code: body.code, p_from: body.from, p_to: body.to });
    if (!r) return json({ ok: false, reason: "notfound" }, cors, 403);
    return json({ ok: true, files: await signAll(r.files || []), rep: r.rep || [] }, cors);
  }

  /* 3) 코치룸 — 로그인한 운영진 (사용자 권한으로 부른다 · 함수 안에서도 운영진인지 본다) */
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login" }, cors, 401);
  if (body.action === "staff") {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.student ?? "")) || !validDate(body.from) || !validDate(body.to)) return json({ ok: false, reason: "input" }, cors, 400);
    const r: Any = await rpc("sub_list_staff", { p_student: body.student, p_from: body.from, p_to: body.to }, auth, apikey);
    if (!Array.isArray(r)) return json({ ok: false, reason: "auth" }, cors, 403);
    return json({ ok: true, files: await signStaff(r) }, cors);
  }
  if (body.action === "class") {
    if (!String(body.class ?? "").trim() || !validDate(body.day)) return json({ ok: false, reason: "input" }, cors, 400);
    const r: Any = await rpc("sub_list_class", { p_class: String(body.class).slice(0, 60), p_day: body.day }, auth, apikey);
    if (!Array.isArray(r)) return json({ ok: false, reason: "auth" }, cors, 403);
    const out = [];
    for (const s of r) out.push({ sid: s.sid, name: s.name, files: await signStaff(s.files || []) });
    return json({ ok: true, students: out }, cors);
  }
  if (body.action === "pdf" || body.action === "put") {
    const f: Any = await rpc("sub_file_get", { p_id: Number(body.id) || 0 }, auth, apikey);
    if (!f || !f.id) return json({ ok: false, reason: "auth" }, cors, 403);
    if (body.action === "pdf") {
      const u = absUrl(f.src), got = u && f.kind === "pdf" ? await fetchBytes(u, MAX_SRC, 20000) : null;
      if (!got || !/application\/pdf/.test(got.type)) return json({ ok: false, reason: "open", message: "앱에서 열어 주세요" }, cors);
      /* octet-stream — 코치룸(supabase-js invoke)이 Blob 으로 받는다 */
      return new Response(got.buf, { status: 200, headers: { ...cors, "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
    }
    const jpeg = fromB64(String(body.jpeg ?? ""));
    if (!jpeg || jpeg.byteLength > MAX_THUMB || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return json({ ok: false, reason: "input" }, cors, 400);
    const path = `${f.sid}/${f.id}.jpg`;
    if (!await upload(path, jpeg)) return json({ ok: false, reason: "upload" }, cors);
    const page = Number(body.page) >= 1 ? Math.round(Number(body.page)) : null, by = body.by === "ink" || body.by === "ai" ? body.by : null;
    await rpc("sub_thumb_done", { p_id: f.id, p_ok: true, p_path: path, p_w: Math.round(Number(body.w) || 0) || null, p_h: Math.round(Number(body.h) || 0) || null, p_page: page, p_by: by });
    return json({ ok: true }, cors);
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
    console.error("sub-view error", String((e as Error).message || e).slice(0, 200));
    return json({ ok: false, reason: "error", message: "제출물을 불러오지 못했습니다." }, cors, 200);
  }
});
