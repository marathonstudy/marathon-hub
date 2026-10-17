// ============================================================
//  class-file — 러닝노트 · 반 공지의 「배부 자료 / 필수 과제 / 선택 과제」 내려받기
//
//  학생·학부모 화면은 로그인이 없다. 그래서 이 함수가 대신
//    1) 링크 코드(개인 링크 또는 반 공용 링크)가 맞는지 확인하고 (퇴원생 링크는 막는다)
//    2) 고른 파일이 그 반의 파일인지 확인한 뒤 (DB 함수 class_file_gate)
//    3) 2분짜리 서명 주소를 만들어 돌려준다. 화면은 그 주소로 바로 내려받는다.
//  보관함(class-files)은 비공개다. 공개 주소는 만들지 않고, 보관 위치(path)도 화면에 보내지 않는다.
//
//  키
//    이 파일에는 어떤 키도 적지 않는다. Supabase 가 함수에 자동으로 넣어 주는
//    SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 쓴다. 이 키는 함수 안에서만 쓰이고
//    화면으로 나가지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor
//        이름 class-file, 이 파일 전체 붙여넣기 → Deploy, Verify JWT 끄기 (README 참고)
// ============================================================

const ALLOWED_ORIGINS = [
  "https://marathonstudy.github.io",
];

const BUCKET = "class-files";
const SIGN_SECONDS = 120;

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

const REASON: Record<string, string> = {
  notfound: "링크를 찾을 수 없습니다.",
  closed: "더 이상 열 수 없는 링크입니다.",
  nofile: "이 파일은 지금 내려받을 수 없습니다. 선생님께 문의해 주세요.",
};

function validCode(c: unknown): c is string {
  return typeof c === "string" && /^[A-Za-z0-9]{16,64}$/.test(c);
}
function validId(c: unknown): c is string {
  return typeof c === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c);
}

/* 내려받을 때 보일 파일 이름 — 보이는 이름 + 확장자. 경로에 쓰면 안 되는 글자는 뺀다 */
function downloadName(name: string, ext: string): string {
  const base = String(name || "자료").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 100) || "자료";
  return `${base}.${ext}`;
}

async function url(body: Any, cors: Record<string, string>) {
  if (!validCode(body.code) || !validId(body.id)) return json({ ok: false, reason: "notfound", message: REASON.notfound }, 400, cors);
  const gate = await rpc("class_file_gate", { p_code: body.code, p_id: body.id });
  if (!gate?.ok) {
    return json({ ok: false, reason: gate?.reason, message: REASON[gate?.reason] ?? REASON.nofile }, 403, cors);
  }
  const path = String(gate.path).split("/").map(encodeURIComponent).join("/");
  const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: SIGN_SECONDS }),
  });
  const signed: Any = r.ok ? await r.json() : null;
  if (!signed?.signedURL) return json({ ok: false, reason: "storage", message: REASON.nofile }, 502, cors);
  const sep = signed.signedURL.includes("?") ? "&" : "?";
  return json({
    ok: true,
    url: `${URL_}/storage/v1${signed.signedURL}${sep}download=${encodeURIComponent(downloadName(gate.name, gate.ext))}`,
    expires_in: SIGN_SECONDS,
  }, 200, cors);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405, cors);
  if (!URL_ || !KEY) return json({ ok: false, reason: "config", message: "함수 설정이 비어 있습니다." }, 500, cors);

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "url") return await url(body, cors);
    return json({ ok: false, reason: "action" }, 400, cors);
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "server", message: "잠시 뒤 다시 해 주세요." }, 500, cors);
  }
});
