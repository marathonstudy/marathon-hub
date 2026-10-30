// ============================================================
//  staff-login — 조교가 이름 + 휴대폰 번호 8자리(010 뺀)로 코치룸에 들어온다 (migration-047)
//
//  코치룸 로그인 화면 [들어가기] 가 부른다. 로그인 전이라 토큰 없이 { name, phone } 만 보낸다.
//    1) DB 함수 staff_phone_login(이름, 번호) — 처음 보는 번호면 그 이름으로 조교 등록 · 있으면 이름이 맞는지
//       (번호는 DB 안에서 비밀 값과 섞은 해시로만 남는다 · 이 함수도 번호를 저장하거나 기록하지 않는다)
//    2) 그 사람의 로그인 계정(이메일 칸은 ph-…@coach.… 로 저절로 정해진다 · 메일은 가지 않는다)을 만들고
//       한 번 쓰는 로그인 토큰으로 바로 세션을 만들어 돌려준다 → 화면이 그 세션으로 로그인해 이 기기에 계속 유지
//    돌려주는 것: { ok, session: { access_token, refresh_token }, created } 또는 { ok: false, reason }
//      reason — name · phone · mismatch(이름이나 번호가 맞지 않음) · disabled · locked · busy · nosql
//
//  키 — 새로 넣을 것 없음. Supabase 가 모든 함수에 기본으로 주는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를
//       이 함수 안에서만 쓴다. 화면 · 저장소에는 어떤 키도 없다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 staff-login → 이 파일 전체 → Deploy
//        → Verify JWT 끄기 (로그인 전에 부르는 함수다)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// deno-lint-ignore no-explicit-any
type Any = any;

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

async function call(path: string, body: unknown): Promise<{ status: number; j: Any }> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(env("SUPABASE_URL") + path, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, j: await r.json().catch(() => null) };
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "error", message: "서버 설정을 읽지 못했습니다." }, cors, 200);
  const body: Any = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 40);
  const phone = String(body.phone ?? "").replace(/\D/g, "");
  if (!name) return json({ ok: false, reason: "name" }, cors);
  if (!/^\d{8}$/.test(phone)) return json({ ok: false, reason: "phone" }, cors);

  /* 1) 이름 · 번호 확인 (DB 함수 — service_role 만 부를 수 있다) */
  const chk = await call("/rest/v1/rpc/staff_phone_login", { p_name: name, p_phone: phone });
  if (chk.status >= 300) {
    const m = String(chk.j?.message ?? "");
    if (/Could not find the function|schema cache/i.test(m)) return json({ ok: false, reason: "nosql", message: "migration-047 SQL 을 먼저 실행해 주세요." }, cors);
    return json({ ok: false, reason: "error", message: m.slice(0, 160) }, cors);
  }
  const r = chk.j || {};
  if (!r.ok) return json({ ok: false, reason: String(r.reason || "error") }, cors);
  const email = String(r.email);

  /* 2) 로그인 계정 — 없으면 만든다 (이미 있으면 그대로) */
  const cu = await call("/auth/v1/admin/users", { email, email_confirm: true, user_metadata: { name } });
  if (cu.status >= 300 && !/already|exists|registered/i.test(JSON.stringify(cu.j ?? ""))) {
    return json({ ok: false, reason: "error", message: "로그인 계정을 만들지 못했습니다." }, cors);
  }

  /* 3) 한 번 쓰는 로그인 토큰 → 세션 (메일은 보내지 않는다) */
  const gl = await call("/auth/v1/admin/generate_link", { type: "magiclink", email });
  const hashed = gl.j?.hashed_token ?? gl.j?.properties?.hashed_token;
  if (gl.status >= 300 || !hashed) return json({ ok: false, reason: "error", message: "로그인 토큰을 만들지 못했습니다." }, cors);
  const vf = await call("/auth/v1/verify", { type: "magiclink", token_hash: hashed });
  if (vf.status >= 300 || !vf.j?.access_token || !vf.j?.refresh_token) return json({ ok: false, reason: "error", message: "로그인하지 못했습니다." }, cors);

  return json({ ok: true, created: !!r.created, session: { access_token: vf.j.access_token, refresh_token: vf.j.refresh_token } }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    return json({ ok: false, reason: "error", message: "로그인 처리 중 오류가 났습니다 — " + String((e as Error).message || e).slice(0, 160) }, cors, 200);
  }
});
