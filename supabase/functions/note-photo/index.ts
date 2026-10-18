// ============================================================
//  note-photo — 러닝노트 「필기 노트」 사진 올리기 · 보기 · 지우기
//
//  학생·학부모 화면(/me/)은 로그인이 없다. 그래서 이 함수가 대신
//    1) 개인 링크 코드로 그 학생인지 확인하고 (퇴원이면 막는다)
//    2) 그 학생 폴더(학생id/수업날짜/…jpg)에만 올리고
//    3) 그 학생 사진만 10분짜리 서명 주소로 보여 주고
//    4) 그 학생이 자기 사진을 지우면 파일까지 지운다.
//  사진 보관함(note-photos)은 비공개다. 공개 주소는 만들지 않는다.
//  올리기 · 지우기는 학생 링크만 (전환 기간에는 학부모 링크도 — migration-015). 보기는 두 링크 모두.
//
//  막는 것
//    · JPEG 가 아닌 파일, 장당 600KB 넘는 파일 (화면에서 0.3MB 안팎으로 줄여 보낸다)
//    · 하루 10장 넘게 (올린 날 · 한국 날짜 기준 — DB 함수 photo_add 가 한 번 더 확인)
//    · 미래 날짜 · 400일보다 오래된 수업 날짜
//
//  키
//    이 파일에는 어떤 키도 적지 않는다. Supabase 가 함수에 자동으로 넣어 주는
//    SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 쓴다. 이 키는 함수 안에서만 쓰이고
//    화면으로 나가지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor
//        이름 note-photo, 이 파일 전체 붙여넣기 → Deploy, Verify JWT 끄기 (README 참고)
// ============================================================

const ALLOWED_ORIGINS = [
  "https://marathonstudy.github.io",
];

const BUCKET = "note-photos";
const MAX_BYTES = 600 * 1024;
const SIGN_SECONDS = 600;

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// deno-lint-ignore no-explicit-any
type Any = any;

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function adminHeaders(extra: Record<string, string> = {}) {
  return { apikey: KEY, Authorization: "Bearer " + KEY, ...extra };
}

async function rpc(name: string, args: Record<string, unknown>): Promise<Any> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${await r.text()}`);
  return r.json();
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function validCode(c: unknown): c is string {
  return typeof c === "string" && /^[A-Za-z0-9]{20,64}$/.test(c);
}

function validDate(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));
}

const REASON: Record<string, string> = {
  notfound: "링크를 찾을 수 없습니다.",
  closed: "더 이상 열 수 없는 링크입니다.",
  limit: "오늘은 더 올릴 수 없습니다. 하루 10장까지 올릴 수 있어요.",
  date: "수업 날짜를 확인해 주세요. 오늘이나 지난 날짜만 고를 수 있어요.",
  path: "올리지 못했습니다.",
  type: "사진(JPEG)만 올릴 수 있습니다.",
  size: "사진이 너무 큽니다. 다시 골라 주세요.",
  parent: "학부모 링크에서는 보기만 할 수 있습니다. 사진은 학생 링크에서 올리거나 지울 수 있어요.",
};

/* ---------- 올리기 (multipart: code, lesson_date, width, height, file) ---------- */
async function upload(req: Request, cors: Record<string, string>) {
  const form = await req.formData();
  const code = form.get("code");
  const lessonDate = form.get("lesson_date");
  const file = form.get("file");
  if (!validCode(code)) return json({ ok: false, reason: "notfound", message: REASON.notfound }, 400, cors);
  if (!validDate(lessonDate) || lessonDate > todayKST()) return json({ ok: false, reason: "date", message: REASON.date }, 400, cors);
  if (!(file instanceof File)) return json({ ok: false, reason: "type", message: REASON.type }, 400, cors);
  if (file.size < 1 || file.size > MAX_BYTES) return json({ ok: false, reason: "size", message: REASON.size }, 400, cors);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)) {
    return json({ ok: false, reason: "type", message: REASON.type }, 400, cors);
  }

  const gate = await rpc("photo_gate", { p_code: code });
  if (!gate?.ok) return json({ ok: false, reason: gate?.reason, message: REASON[gate?.reason] ?? REASON.notfound }, 403, cors);
  if (gate.can_write === false) return json({ ok: false, reason: "parent", message: REASON.parent }, 403, cors);
  if (gate.today_count >= gate.limit) return json({ ok: false, reason: "limit", message: REASON.limit }, 429, cors);

  const path = `${gate.student_id}/${lessonDate}/${crypto.randomUUID()}.jpg`;
  const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "image/jpeg", "x-upsert": "false" }),
    body: bytes,
  });
  if (!up.ok) return json({ ok: false, reason: "storage", message: "올리지 못했습니다. 잠시 뒤 다시 해 주세요." }, 502, cors);

  const w = Math.max(0, Math.min(10000, Number(form.get("width")) || 0)) || null;
  const h = Math.max(0, Math.min(10000, Number(form.get("height")) || 0)) || null;
  const added = await rpc("photo_add", {
    p_code: code, p_lesson_date: lessonDate, p_path: path, p_bytes: bytes.length, p_width: w, p_height: h,
  });
  if (!added?.ok) {
    /* 기록을 못 남겼으면 올린 파일도 지운다 */
    await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
      method: "DELETE", headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [path] }),
    });
    return json({ ok: false, reason: added?.reason, message: REASON[added?.reason] ?? REASON.path }, 400, cors);
  }
  return json({ ok: true, id: added.id, today_count: added.today_count }, 200, cors);
}

/* ---------- 보기 — 그 학생 사진 + 10분짜리 서명 주소 ---------- */
async function list(body: Any, cors: Record<string, string>) {
  if (!validCode(body.code)) return json({ ok: false, reason: "notfound" }, 400, cors);
  const from = validDate(body.from) ? body.from : null;
  const to = validDate(body.to) ? body.to : null;
  const res = await rpc("photo_list", { p_code: body.code, p_from: from, p_to: to });
  if (!res?.ok) return json({ ok: false, reason: res?.reason }, 403, cors);

  const photos: Any[] = res.photos ?? [];
  if (photos.length) {
    const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths: photos.map((p) => p.path) }),
    });
    const signed: Any[] = r.ok ? await r.json() : [];
    const byPath: Record<string, string> = {};
    for (const s of signed) {
      if (s?.signedURL) byPath[s.path] = `${URL_}/storage/v1${s.signedURL}`;
    }
    for (const p of photos) {
      p.url = byPath[p.path] ?? "";
      delete p.path;                                  /* 보관함 경로는 화면에 보내지 않는다 */
    }
  }
  return json({
    ok: true, total: res.total, days: res.days, today_count: res.today_count, limit: res.limit,
    photos: photos.filter((p) => p.url),
  }, 200, cors);
}

/* ---------- 지우기 — 학생 본인 사진만, 파일까지 ---------- */
async function remove(body: Any, cors: Record<string, string>) {
  if (!validCode(body.code) || typeof body.id !== "string") return json({ ok: false }, 400, cors);
  const gate = await rpc("photo_gate", { p_code: body.code });
  if (gate?.ok && gate.can_write === false) return json({ ok: false, reason: "parent", message: REASON.parent }, 403, cors);
  const path = await rpc("photo_owned", { p_code: body.code, p_id: body.id });
  if (!path) return json({ ok: false, reason: "notfound" }, 404, cors);
  const del = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: "DELETE", headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!del.ok) return json({ ok: false, reason: "storage" }, 502, cors);
  await rpc("photo_remove", { p_code: body.code, p_id: body.id });
  return json({ ok: true }, 200, cors);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405, cors);
  if (!URL_ || !KEY) return json({ ok: false, reason: "config", message: "함수 설정이 비어 있습니다." }, 500, cors);

  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) return await upload(req, cors);
    const body = await req.json().catch(() => ({}));
    if (body.action === "list") return await list(body, cors);
    if (body.action === "delete") return await remove(body, cors);
    return json({ ok: false, reason: "action" }, 400, cors);
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "server", message: "잠시 뒤 다시 해 주세요." }, 500, cors);
  }
});
