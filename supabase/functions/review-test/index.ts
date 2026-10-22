// ============================================================
//  review-test — 러닝노트 「오늘 복습테스트 기록하기」 (학생 · 학부모 개인 링크)
//
//  학생 화면은 로그인이 없다. 그래서 이 함수가 대신
//    1) 개인 링크 코드로 그 학생인지 확인하고 (퇴원이면 막는다)
//    2) 오늘이 그 반 복습테스트 수업일인지 · 마감(수업일 밤 12시) 전인지 · 조교가 아직 확인 안 했는지
//       DB 함수(review_status · review_submit)로 확인한 뒤
//    3) 시험지 사진을 그 학생 폴더(학생id/수업일/…jpg)에만 올리고 점수를 저장한다.
//       새 방식(migration-025): 오늘 시험들(「복습 TEST」 · 「화작문 TEST」 …)마다 전체 문항 수 + 틀린 개수, 사진 여러 장(필수 · 두 시험이 같이 씀)
//       예전 방식(틀린 번호 · 사진 한 장)도 그대로 받는다 (예전 화면이 남아 있을 때)
//    4) 그 학생의 제출 · 사진만 10분짜리 서명 주소로 보여 준다 (확인 전 입력도 — 그 학생 링크에서만).
//  사진 보관함(review-photos)은 비공개다. 공개 주소는 만들지 않는다.
//  제출 · 「확인 전」 기록은 학생 링크만 (전환 기간에는 학부모 링크도 — migration-015).
//
//  키
//    이 파일에는 어떤 키도 적지 않는다. Supabase 가 함수에 자동으로 넣어 주는
//    SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 쓴다. 이 키는 함수 안에서만 쓰이고 화면으로 나가지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor
//        이름 review-test, 이 파일 전체 붙여넣기 → Deploy, Verify JWT 끄기 (README 참고)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const BUCKET = "review-photos";
const MAX_BYTES = 600 * 1024;
const MAX_FILES = 10;
const SIGN_SECONDS = 600;

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
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

function validCode(c: unknown): c is string {
  return typeof c === "string" && /^[A-Za-z0-9]{20,64}$/.test(c);
}
function validId(c: unknown): c is string {
  return typeof c === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c);
}

const REASON: Record<string, string> = {
  notfound: "링크를 찾을 수 없습니다.",
  closed: "더 이상 열 수 없는 링크입니다.",
  closed_test: "오늘은 기록할 복습테스트가 없거나 마감되었습니다 (수업일 밤 12시까지).",
  locked: "선생님이 이미 확인한 기록이라 고칠 수 없습니다.",
  photo: "시험지 사진을 찍어 주세요. 사진이 있어야 제출됩니다.",
  wrong: "틀린 번호를 다시 확인해 주세요.",
  count: "전체 문항 수와 틀린 개수를 확인해 주세요 (틀린 개수는 전체보다 클 수 없어요).",
  photo_max: "사진은 한 번에 10장까지 올릴 수 있어요.",
  type: "사진(JPEG)만 올릴 수 있습니다.",
  size: "사진이 너무 큽니다. 다시 찍어 주세요.",
  parent: "학부모 링크에서는 보기만 할 수 있습니다. 복습테스트는 학생 링크에서 기록해 주세요.",
};

async function removePaths(paths: string[]) {
  if (!paths.length) return;
  await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: paths }),
  });
}

/* 제출 기록들의 사진 경로 → 10분짜리 서명 주소 (경로는 화면에 보내지 않는다) — photo_url(첫 장) · photo_urls(여러 장) */
async function signAll(items: Any[]) {
  const paths = Array.from(new Set(items.flatMap((x) => [x?.photo_path, ...((x?.photos as string[]) ?? [])]).filter(Boolean)));
  const byPath: Record<string, string> = {};
  if (paths.length) {
    const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths }),
    });
    const signed: Any[] = r.ok ? await r.json() : [];
    for (const s of signed) if (s?.signedURL) byPath[s.path] = `${URL_}/storage/v1${s.signedURL}`;
  }
  for (const x of items) {
    if (!x) continue;
    x.photo_url = x.photo_path ? (byPath[x.photo_path] ?? "") : "";
    x.photo_urls = ((x.photos as string[]) ?? (x.photo_path ? [x.photo_path] : [])).map((p) => byPath[p] ?? "").filter(Boolean);
    delete x.photo_path;
    delete x.photos;
  }
}

/* ---------- 오늘 시험 · 내 제출 ---------- */
async function status(body: Any, cors: Record<string, string>) {
  if (!validCode(body.code)) return json({ ok: false, reason: "notfound", message: REASON.notfound }, 400, cors);
  const res = await rpc("review_status", { p_code: body.code });
  if (!res?.ok) return json({ ok: false, reason: res?.reason, message: REASON[res?.reason] ?? REASON.notfound }, 403, cors);
  await signAll([res.submission, ...(res.recent ?? []), ...((res.tests ?? []).map((t: Any) => t.submission))]);
  delete res.student_id;
  return json(res, 200, cors);
}

/* ---------- 제출 (새 방식 · multipart: code, items(JSON [{test, q, wrong}]), file 여러 개) ---------- */
async function submit2(form: FormData, cors: Record<string, string>) {
  const code = form.get("code");
  if (!validCode(code)) return json({ ok: false, reason: "notfound", message: REASON.notfound }, 400, cors);
  let items: Any[] = [];
  try {
    items = JSON.parse(String(form.get("items") ?? "[]"));
    if (!Array.isArray(items) || !items.length || items.length > 6) throw new Error("items");
    items = items.map((x) => ({ test: String(x?.test ?? ""), q: Number(x?.q), wrong: Number(x?.wrong) }));
    if (items.some((x) => !validId(x.test) || !Number.isInteger(x.q) || !Number.isInteger(x.wrong) || x.q < 1 || x.q > 200 || x.wrong < 0 || x.wrong > x.q)) throw new Error("count");
  } catch (_) {
    return json({ ok: false, reason: "count", message: REASON.count }, 400, cors);
  }
  const files = form.getAll("file").filter((f) => f instanceof File && f.size > 0) as File[];
  if (files.length > MAX_FILES) return json({ ok: false, reason: "photo_max", message: REASON.photo_max }, 400, cors);
  const blobs: Uint8Array[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return json({ ok: false, reason: "size", message: REASON.size }, 400, cors);
    const b = new Uint8Array(await f.arrayBuffer());
    if (!(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) return json({ ok: false, reason: "type", message: REASON.type }, 400, cors);
    blobs.push(b);
  }

  /* 먼저 오늘 시험 · 잠김 · 링크 · 사진을 확인한다 (사진을 올리기 전에) */
  const st = await rpc("review_status", { p_code: code });
  if (!st?.ok) return json({ ok: false, reason: st?.reason, message: REASON[st?.reason] ?? REASON.notfound }, 403, cors);
  const today: Record<string, Any> = {};
  for (const t of st.tests ?? []) today[t.id] = t;
  const dayPhotos = (st.tests ?? []).some((x: Any) => x.submission?.photos?.length);   /* 그 수업일에 이미 낸 사진을 같이 쓸 수 있다 */
  for (const it of items) {
    const t = today[it.test];
    if (!t) return json({ ok: false, reason: "closed_test", message: REASON.closed_test }, 403, cors);
    if (t.submission?.status === "confirmed") return json({ ok: false, reason: "locked", message: REASON.locked }, 403, cors);
    if (!blobs.length && !(t.submission?.photos?.length) && !dayPhotos) return json({ ok: false, reason: "photo", message: REASON.photo }, 400, cors);
  }

  const uploaded: { path: string; bytes: number }[] = [];
  const day = (st.tests?.[0]?.lesson_date) ?? st.today;
  for (const b of blobs) {
    const path = `${st.student_id}/${day}/${crypto.randomUUID()}.jpg`;
    const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "image/jpeg", "x-upsert": "false" }),
      body: b,
    });
    if (!up.ok) {
      await removePaths(uploaded.map((x) => x.path));
      return json({ ok: false, reason: "storage", message: "사진을 올리지 못했습니다. 잠시 뒤 다시 해 주세요." }, 502, cors);
    }
    uploaded.push({ path, bytes: b.length });
  }

  const saved = await rpc("review_submit2", { p_code: code, p_items: items, p_photos: uploaded });
  if (!saved?.ok) {
    await removePaths(uploaded.map((x) => x.path));       /* 저장을 못 했으면 올린 사진도 지운다 */
    return json({ ok: false, reason: saved?.reason, message: REASON[saved?.reason] ?? REASON.closed_test }, 400, cors);
  }
  if (saved.old_paths?.length) await removePaths(saved.old_paths);   /* 이제 아무 기록도 쓰지 않는 옛 사진만 지운다 */
  return json({ ok: true, submissions: saved.submissions }, 200, cors);
}

/* ---------- 제출 (예전 방식 · multipart: code, test_id, wrong(JSON 배열), file?) ---------- */
async function submit(req: Request, cors: Record<string, string>) {
  const form = await req.formData();
  if (form.get("items") != null) return await submit2(form, cors);
  const code = form.get("code");
  const testId = form.get("test_id");
  const file = form.get("file");
  if (!validCode(code)) return json({ ok: false, reason: "notfound", message: REASON.notfound }, 400, cors);
  if (!validId(testId)) return json({ ok: false, reason: "closed_test", message: REASON.closed_test }, 400, cors);
  let wrong: number[] = [];
  try {
    wrong = JSON.parse(String(form.get("wrong") ?? "[]"));
    if (!Array.isArray(wrong) || wrong.length > 100 || wrong.some((n) => !Number.isInteger(n))) throw new Error("wrong");
  } catch (_) {
    return json({ ok: false, reason: "wrong", message: REASON.wrong }, 400, cors);
  }

  let path: string | null = null;
  let bytes: Uint8Array | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return json({ ok: false, reason: "size", message: REASON.size }, 400, cors);
    bytes = new Uint8Array(await file.arrayBuffer());
    if (!(bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)) return json({ ok: false, reason: "type", message: REASON.type }, 400, cors);
  }

  /* 먼저 오늘 시험 · 잠김 · 링크를 확인한다 (사진을 올리기 전에) */
  const st = await rpc("review_status", { p_code: code });
  if (!st?.ok) return json({ ok: false, reason: st?.reason, message: REASON[st?.reason] ?? REASON.notfound }, 403, cors);
  if (!st.test || st.test.id !== testId) return json({ ok: false, reason: "closed_test", message: REASON.closed_test }, 403, cors);
  if (st.submission?.status === "confirmed") return json({ ok: false, reason: "locked", message: REASON.locked }, 403, cors);
  if (!bytes && !st.submission?.photo_path) return json({ ok: false, reason: "photo", message: REASON.photo }, 400, cors);

  if (bytes) {
    const studentId = st.student_id;
    path = `${studentId}/${st.test.lesson_date}/${crypto.randomUUID()}.jpg`;
    const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "image/jpeg", "x-upsert": "false" }),
      body: bytes,
    });
    if (!up.ok) return json({ ok: false, reason: "storage", message: "사진을 올리지 못했습니다. 잠시 뒤 다시 해 주세요." }, 502, cors);
  }

  const saved = await rpc("review_submit", {
    p_code: code, p_test: testId, p_wrong: wrong, p_path: path, p_bytes: bytes ? bytes.length : 0,
  });
  if (!saved?.ok) {
    if (path) await removePaths([path]);              /* 저장을 못 했으면 올린 사진도 지운다 */
    return json({ ok: false, reason: saved?.reason, message: REASON[saved?.reason] ?? REASON.closed_test }, 400, cors);
  }
  if (saved.old_path) await removePaths([saved.old_path]);   /* 다시 찍은 사진이면 옛 사진은 지운다 */
  return json({ ok: true, submission: saved.submission }, 200, cors);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405, cors);
  if (!URL_ || !KEY) return json({ ok: false, reason: "config", message: "함수 설정이 비어 있습니다." }, 500, cors);
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) return await submit(req, cors);
    const body = await req.json().catch(() => ({}));
    if (body.action === "status") return await status(body, cors);
    return json({ ok: false, reason: "action" }, 400, cors);
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "server", message: "잠시 뒤 다시 해 주세요." }, 500, cors);
  }
});
