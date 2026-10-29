// ============================================================
//  sms-send — 사이트에서 문자 보내기 (SMS · LMS · 솔라피)
//
//  코치룸 「문자 보내기」 창 · [설정]의 문자 칸이 부른다. 로그인한 직원만 (조교 · 선생님 같다).
//    action "status" — 키 세 개가 들어갔는지(있음/없음)와 발신번호(숫자만 · 문자 창 「보내는 번호: 02-…」 · 20261031e)를 돌려준다.
//                      API 키 · 시크릿 값은 절대 돌려주지 않는다.
//    action "send"   — { items: [{ student_id, to: "parent1" | "parent2" | "student" }], body, ad, lessons, siblings, markWeek,
//                        label(묶음 이름 · 보낸 기록), purpose(app 앱 안내 …), vars({ 학생 id: { code: 입장코드 } }) }   (label · purpose · vars 는 migration-040)
//                      화면은 학생 id 와 보낼 곳만 보낸다. 번호 · 링크 코드는 부른 직원의 로그인으로 DB 함수 sms_prepare 가 찾는다
//                      (같은 번호는 한 번만 · 한 번 · 하루 상한 · 광고 문구). 보낸 결과는 sms_record 로 기록(번호는 뒤 4자리만).
//    action "test"   — 같은 내용을 첫 사람 것으로 바꿔, 설정에 넣은 내 시험 번호에 한 건만.
//  솔라피는 「접수」 결과만 바로 알려 준다 (실제 도착 여부는 솔라피 콘솔의 발송 내역에서 본다).
//
//  키 — Supabase 대시보드 → Edge Functions → Secrets 에만 넣는다 (알림톡과 같은 값). 이 파일 · 저장소 · 화면에는 어떤 키도 없다.
//    SOLAPI_API_KEY · SOLAPI_API_SECRET · SOLAPI_SENDER(등록된 발신번호)
//    service_role 키는 쓰지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 sms-send → 이 파일 전체 → Deploy
//        → Verify JWT 끄기 (로그인 확인은 이 함수가 DB 에 직접 한다 — README 참고)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const SITE = "https://marathonstudy.github.io/marathon-hub";          // #{링크} 앞부분 (assets/config.js 의 siteUrl 과 같다)
const SOLAPI = "https://api.solapi.com/messages/v4/send-many/detail";
const KEYS = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_SENDER"];

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

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

/* 부른 사람의 로그인 토큰으로 DB 함수를 부른다 — is_staff() 가 그대로 적용된다 */
async function rpcAs(auth: string, apikey: string, name: string, args: Record<string, unknown>): Promise<Any> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body && body.message) || `rpc ${name} ${r.status}`);
  return body;
}

/* 솔라피 인증 — HMAC-SHA256(시크릿, 날짜 + salt) */
async function solapiAuth(key: string, secret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(date + salt)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${hex}`;
}

const REASON: Record<string, string> = {
  nophone: "번호 없음",
  nolink: "링크 없음",
  nocode: "입장코드 없음",
  sibling: "같은 번호(형제) — 한 번만",
  toolong: "너무 김",
};

async function handle(req: Request, cors: Record<string, string>) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  const body: Any = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  /* 직원 확인 (설정 읽기로) */
  let cfg: Any;
  try {
    cfg = await rpcAs(auth, apikey, "sms_settings_get", {});
  } catch (e) {
    const m = String((e as Error).message || e);
    if (/Could not find the function|schema cache/i.test(m)) return json({ ok: false, reason: "nosql", message: "migration-023 SQL 을 먼저 실행해 주세요." }, cors, 200);
    return json({ ok: false, reason: "auth", message: m }, cors, 403);
  }

  const have: Record<string, boolean> = {};
  KEYS.forEach((k) => { have[k] = !!env(k); });
  /* 발신번호는 숫자만 (받는 사람이 보는 번호라 비밀이 아니다 · 로그인한 직원에게만) */
  if (action === "status") return json({ ok: true, keys: have, cfg, sender: env("SOLAPI_SENDER").replace(/\D/g, "") }, cors);
  if (action !== "send" && action !== "test") return json({ ok: false, reason: "input", message: "알 수 없는 요청입니다." }, cors, 400);

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x: Any) => ({ student_id: String(x?.student_id ?? ""), to: String(x?.to ?? "") }))
    .filter((x: Any) => /^[0-9a-f-]{36}$/i.test(x.student_id) && ["parent1", "parent2", "student"].includes(x.to));
  const text = String(body.body ?? "");
  if (!items.length) return json({ ok: false, reason: "input", message: "받는 사람을 골라 주세요." }, cors, 400);
  if (items.length > 3000) return json({ ok: false, reason: "max", message: "받는 사람이 너무 많습니다." }, cors, 400);
  if (!text.trim()) return json({ ok: false, reason: "input", message: "내용을 적어 주세요." }, cors, 400);
  const lessons: Record<string, string> = {};
  if (body.lessons && typeof body.lessons === "object") {
    Object.keys(body.lessons).slice(0, 200).forEach((k) => { lessons[String(k).slice(0, 60)] = String(body.lessons[k] ?? "").slice(0, 30); });
  }
  const markWeek = /^\d{4}-\d{2}-\d{2}$/.test(String(body.markWeek ?? "")) ? String(body.markWeek) : null;
  /* 묶음 이름 · 목적 · 학생마다 입장코드 (migration-040) */
  const label = String(body.label ?? "").slice(0, 60);
  const purpose = String(body.purpose ?? "").replace(/[^a-z]/g, "").slice(0, 20);
  const vars: Record<string, { code: string }> = {};
  if (body.vars && typeof body.vars === "object") {
    Object.keys(body.vars).slice(0, 3000).forEach((k) => {
      const c = String(body.vars[k]?.code ?? "").trim();
      if (/^[0-9a-f-]{36}$/i.test(k) && /^[A-Za-z0-9가-힣_-]{2,30}$/.test(c)) vars[k] = { code: c };
    });
  }
  const missing = KEYS.filter((k) => !have[k]);
  if (missing.length) {
    return json({ ok: false, reason: "nokeys", missing, message: "문자 키가 아직 다 들어가지 않았습니다 (" + missing.join(", ") + "). Supabase Secrets 에 넣어 주세요." }, cors, 200);
  }

  /* 1) 보낼 줄 — 기록 줄을 먼저 만든다 */
  let prep: Any;
  const args: Record<string, unknown> = {
    p_items: items, p_body: text, p_ad: !!body.ad, p_lessons: lessons, p_siblings: !!body.siblings,
    p_test: action === "test", p_mark_week: action === "test" ? null : markWeek, p_site: SITE,
  };
  try {
    prep = await rpcAs(auth, apikey, "sms_prepare", { ...args, p_label: label, p_purpose: purpose, p_vars: vars });
  } catch (e) {
    const m = String((e as Error).message || e);
    const old = /Could not find the function|schema cache|function (public\.)?sms_prepare\(.*\) does not exist/i.test(m);
    /* migration-040 전 — 새 칸 없이 예전처럼 (입장코드 · 앱 설치 링크를 쓴 글은 보낼 수 없다) */
    if (old && /#\{입장코드\}|#\{앱 설치 링크\}/.test(text)) {
      return json({ ok: false, reason: "nosql", message: "입장코드 · 앱 설치 링크를 쓰려면 migration-040 SQL 을 먼저 실행해 주세요." }, cors, 200);
    }
    if (!old) return json({ ok: false, reason: "prepare", message: m }, cors, 200);
    try {
      prep = await rpcAs(auth, apikey, "sms_prepare", args);
    } catch (e2) {
      return json({ ok: false, reason: "prepare", message: String((e2 as Error).message || e2) }, cors, 200);
    }
  }
  const skipped = (prep?.skipped || []).map((s: Any) => ({ student_id: s.student_id, name: s.name, to: s.to, reason: s.reason, label: REASON[s.reason] || s.reason }));
  if (!prep?.ok) return json({ ok: false, reason: prep?.reason || "prepare", message: prep?.message || "보낼 수 없습니다.", skipped }, cors, 200);
  const rows: Any[] = prep.rows || [];

  /* 2) 솔라피 — 단문은 SMS, 90바이트를 넘으면 LMS */
  const from = env("SOLAPI_SENDER").replace(/\D/g, "");
  const messages = rows.map((r) => ({
    to: String(r.to),
    from,
    text: String(r.text || ""),
    type: r.kind === "LMS" ? "LMS" : "SMS",
    customFields: { log: String(r.log_id) },
  }));
  const results: Any[] = rows.map((r) => ({ log_id: r.log_id, student_id: r.student_id, to: r.target, name: r.name, ok: true, error: "", message_id: "" }));
  try {
    const res = await fetch(SOLAPI, {
      method: "POST",
      headers: { Authorization: await solapiAuth(env("SOLAPI_API_KEY"), env("SOLAPI_API_SECRET")), "Content-Type": "application/json" },
      body: JSON.stringify({ messages, allowDuplicates: true, showMessageList: true }),
    });
    const out: Any = await res.json().catch(() => null);
    if (!res.ok) {
      const why = (out && (out.errorMessage || out.message || out.errorCode)) || `솔라피 오류 (${res.status})`;
      results.forEach((x) => { x.ok = false; x.error = String(why).slice(0, 200); });
    } else {
      const failed = new Map<string, string>();
      (out?.failedMessageList || []).forEach((f: Any) => {
        const id = f?.customFields?.log;
        if (id) failed.set(String(id), `${f.statusCode || ""} ${f.statusMessage || ""}`.trim() || "접수 실패");
      });
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

  /* 3) 기록 (번호는 기록에 뒤 4자리만 — DB 가 처음부터 뒤 4자리만 받았다) */
  await rpcAs(auth, apikey, "sms_record", { p_results: results.map(({ log_id, ok, error, message_id }) => ({ log_id, ok, error, message_id })) }).catch(() => {});
  const sent = results.filter((x) => x.ok).length;
  return json({
    ok: true, test: action === "test", sent, failed: results.length - sent, skipped,
    lms: rows.filter((r) => r.kind === "LMS").length,
    results: results.map((x) => ({ student_id: x.student_id, to: x.to, name: x.name, ok: x.ok, error: x.error })),
  }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    return json({ ok: false, reason: "error", message: "문자 처리 중 오류가 났습니다 — " + String((e as Error).message || e).slice(0, 160) }, cors, 200);
  }
});
