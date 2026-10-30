// ============================================================
//  note-remind — 수업 끝나기 몇 분 전 필기 알림 문자 (migration-049 · 050)
//
//  두 가지로 부른다
//    1) 매분 자동 (migration-050 의 pg_cron) — 헤더 x-cron-key (DB 에만 있는 값 · note_cron_ok 로 확인)
//       → note_remind_prepare: 지금 보낼 때가 된 반(필기 알림 켬 · 오늘 수업 · 끝 시각 - n분 ~ 끝 시각 뒤 10분)
//         학생 = 그날 필기를 안 낸 · 결석 아닌 · 번호 있는 학생 본인(학부모에게는 안 보냄)
//         운영진 = 그 반 담당 운영진(비어 있으면 사용 중인 운영진 전체 · 사용 중지 제외)
//         같은 날 같은 사람에게는 한 번만 (DB 가 막는다)
//    2) 코치룸 「지금 다시 보내기」 — { action: "now", class } · 로그인한 운영진 토큰으로 note_manual_prepare (그 반 안 낸 학생만)
//  보낸 기록 — 문자 발송 → 보낸 기록에 「필기 알림(학생)」 「필기 알림(운영진)」 (번호는 뒤 4자리만)
//
//  키 — sms-send 와 같은 솔라피 Secrets(SOLAPI_API_KEY · SOLAPI_API_SECRET · SOLAPI_SENDER).
//       DB 는 Supabase 가 함수에 기본으로 주는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 로 (이 함수 안에서만). 새로 넣을 키는 없다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 note-remind → 이 파일 전체 → Deploy
//        → Verify JWT 끄기 (자동 실행은 토큰 없이 x-cron-key 로 · 「지금 다시 보내기」는 이 함수가 DB 에 직접 확인)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const SITE = "https://marathonstudy.github.io/marathon-hub";
const SOLAPI = "https://api.solapi.com/messages/v4/send-many/detail";
const KEYS = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER"];

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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

async function solapiAuth(key: string, secret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(date + salt)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${hex}`;
}

/* rows → 솔라피 → 결과 기록 */
async function sendRows(rows: Any[]) {
  if (!rows.length) return { sent: 0, failed: 0 };
  const from = env("SOLAPI_SENDER").replace(/\D/g, "");
  const results: Any[] = rows.map((r) => ({ log_id: r.log_id, ok: true, error: "", message_id: "" }));
  try {
    const res = await fetch(SOLAPI, {
      method: "POST",
      headers: { Authorization: await solapiAuth(env("SOLAPI_API_KEY"), env("SOLAPI_API_SECRET")), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: rows.map((r) => ({ to: String(r.to), from, text: String(r.text || ""), type: r.kind === "LMS" ? "LMS" : "SMS", customFields: { log: String(r.log_id) } })),
        allowDuplicates: true, showMessageList: true,
      }),
    });
    const out: Any = await res.json().catch(() => null);
    if (!res.ok) {
      const why = (out && (out.errorMessage || out.message || out.errorCode)) || `솔라피 오류 (${res.status})`;
      results.forEach((x) => { x.ok = false; x.error = String(why).slice(0, 200); });
    } else {
      const failed = new Map<string, string>();
      (out?.failedMessageList || []).forEach((f: Any) => { const id = f?.customFields?.log; if (id) failed.set(String(id), `${f.statusCode || ""} ${f.statusMessage || ""}`.trim() || "접수 실패"); });
      const ids = new Map<string, string>();
      (out?.messageList || []).forEach((m: Any) => { if (m?.customFields?.log) ids.set(String(m.customFields.log), String(m.messageId || "")); });
      results.forEach((x) => {
        if (failed.has(String(x.log_id))) { x.ok = false; x.error = failed.get(String(x.log_id)); }
        x.message_id = ids.get(String(x.log_id)) || "";
      });
    }
  } catch {
    results.forEach((x) => { x.ok = false; x.error = "솔라피에 연결하지 못했습니다."; });
  }
  await rpc("note_remind_record", { p_results: results }).catch(() => {});
  const sent = results.filter((x) => x.ok).length;
  return { sent, failed: results.length - sent };
}

async function handle(req: Request, cors: Record<string, string>) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ ok: false, reason: "error", message: "서버 설정을 읽지 못했습니다." }, cors);
  const body: Any = await req.json().catch(() => ({}));
  const missing = KEYS.filter((k) => !env(k));
  const cronKey = req.headers.get("x-cron-key") ?? "";

  /* 1) 매분 자동 */
  if (cronKey) {
    let okKey = false;
    try { okKey = (await rpc("note_cron_ok", { p_key: cronKey })) === true; } catch (e) {
      return json({ ok: false, reason: "nosql", message: String((e as Error).message || e).slice(0, 160) }, cors);
    }
    if (!okKey) return json({ ok: false, reason: "auth" }, cors, 403);
    if (missing.length) return json({ ok: false, reason: "nokeys", missing }, cors);       /* 키가 없으면 대상도 만들지 않는다 (같은 날 한 번 막힘이 생기지 않게) */
    const now = typeof body.now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.now) ? body.now : new Date().toISOString();
    const prep: Any = await rpc("note_remind_prepare", { p_now: now, p_site: SITE });
    const rows: Any[] = prep?.rows || [];
    const r = await sendRows(rows);
    return json({ ok: true, day: prep?.day, rows: rows.length, ...r }, cors);
  }

  /* 2) 「지금 다시 보내기」 — 로그인한 운영진 */
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (body.action !== "now") return json({ ok: false, reason: "input" }, cors, 400);
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  if (missing.length) return json({ ok: false, reason: "nokeys", missing, message: "문자 키가 아직 다 들어가지 않았습니다 (" + missing.join(", ") + ")." }, cors);
  let prep: Any;
  try {
    prep = await rpc("note_manual_prepare", { p_class: String(body.class ?? "").slice(0, 60), p_site: SITE }, auth, apikey);
  } catch (e) {
    return json({ ok: false, reason: "prepare", message: String((e as Error).message || e).slice(0, 200) }, cors);
  }
  const rows: Any[] = prep?.rows || [];
  const r = await sendRows(rows);
  return json({ ok: true, rows: rows.length, ...r }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    return json({ ok: false, reason: "error", message: "필기 알림 처리 중 오류가 났습니다 — " + String((e as Error).message || e).slice(0, 160) }, cors, 200);
  }
});
