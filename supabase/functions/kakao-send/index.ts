// ============================================================
//  kakao-send — 레포트 알림톡 발송 (솔라피)
//
//  코치룸 ④ 발송 → [알림톡 보내기] · [나에게 시험 발송] · [설정]의 알림톡 칸이 부른다. 로그인한 직원만 (조교 · 선생님 같다).
//    action "health" — 「문자 발송 → 연결 상태」 (20261031m) · 필요한 Secrets 가 들어갔는지 true/false 만 돌려준다. 값은 절대 돌려주지 않는다.
//    action "status" — health 와 같고 알림톡 설정(cfg)을 더한다. 템플릿 ID 도 값이 아니라 있음/없음(templateSet)만.
//    action "send"   — { week, students: [학생 id], resend } 화면은 학생 id 만 보낸다. 번호 · 링크 코드 · 이름 · 수업일은
//                      부른 직원의 로그인으로 DB 함수 kakao_prepare 가 찾는다 (공개 전 · 이미 보냄 · 번호 없음은 건너뛴다,
//                      한 번에 100명 · 하루 최대 건수). 보낸 결과는 kakao_record 로 기록(번호는 뒤 4자리만).
//                      fallback: true — 「카톡으로 보내기(안 받는 사람은 문자로)」 · 설정의 「문자로 대신 보내기」가 꺼져 있어도 이번만 문자로 대신
//    action "test"   — { week, students } 그 주 레포트가 공개된 첫 학생 내용으로, 설정에 넣은 내 번호에 한 건만.
//  솔라피는 「접수」 결과만 바로 알려 준다 (실제 도착 여부는 솔라피 콘솔의 발송 내역에서 본다).
//
//  키 — Supabase 대시보드 → Edge Functions → Secrets 에만 넣는다. 이 파일 · 저장소 · 화면에는 어떤 키도 없다.
//    SOLAPI_API_KEY · SOLAPI_API_SECRET · SOLAPI_PFID(카카오 채널 pfId) · SOLAPI_TEMPLATE_ID · SOLAPI_SENDER(등록된 발신번호)
//    service_role 키는 쓰지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor → 이름 kakao-send → 이 파일 전체 → Deploy
//        → Verify JWT 끄기 (로그인 확인은 이 함수가 DB 에 직접 한다 — README 참고)
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const SOLAPI = "https://api.solapi.com/messages/v4/send-many/detail";
const KEYS = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_PFID", "SOLAPI_TEMPLATE_ID", "SOLAPI_SENDER"];

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
  unpublished: "공개 전",
  nolink: "학부모 링크 없음",
  nophone: "번호 없음",
  already: "이미 보냄",
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
    cfg = await rpcAs(auth, apikey, "kakao_settings_get", {});
  } catch (e) {
    const m = String((e as Error).message || e);
    if (/Could not find the function|schema cache/i.test(m)) return json({ ok: false, reason: "nosql", message: "migration-020 SQL 을 먼저 실행해 주세요." }, cors, 200);
    return json({ ok: false, reason: "auth", message: m }, cors, 403);
  }

  const have: Record<string, boolean> = {};
  KEYS.forEach((k) => { have[k] = !!env(k); });
  if (action === "health") return json({ ok: true, keys: have, ready: KEYS.every((k) => have[k]) }, cors);
  if (action === "status") {
    return json({ ok: true, keys: have, templateSet: have.SOLAPI_TEMPLATE_ID, cfg }, cors);
  }
  if (action !== "send" && action !== "test") return json({ ok: false, reason: "input", message: "알 수 없는 요청입니다." }, cors, 400);

  const week = String(body.week ?? "");
  const students: string[] = (Array.isArray(body.students) ? body.students : []).map((x: unknown) => String(x ?? "")).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ ok: false, reason: "input", message: "주차를 골라 주세요." }, cors, 400);
  if (!students.length) return json({ ok: false, reason: "input", message: "보낼 학생을 골라 주세요." }, cors, 400);
  if (students.length > 100) return json({ ok: false, reason: "max", message: "한 번에 100명까지 보낼 수 있습니다." }, cors, 400);
  const missing = KEYS.filter((k) => !have[k]);
  if (missing.length) {
    return json({ ok: false, reason: "nokeys", missing, message: "알림톡 키가 아직 다 들어가지 않았습니다 (" + missing.join(", ") + "). Supabase Secrets 에 넣어 주세요." }, cors, 200);
  }

  /* 1) 보낼 줄 — 기록 줄을 먼저 만든다 */
  let prep: Any;
  try {
    prep = await rpcAs(auth, apikey, "kakao_prepare", { p_week: week, p_students: students, p_resend: !!body.resend, p_test: action === "test" });
  } catch (e) {
    return json({ ok: false, reason: "prepare", message: String((e as Error).message || e) }, cors, 200);
  }
  const skipped = (prep?.skipped || []).map((s: Any) => ({ id: s.id, name: s.name, reason: s.reason, label: REASON[s.reason] || s.reason }));
  if (!prep?.ok) return json({ ok: false, reason: prep?.reason || "prepare", message: prep?.message || "보낼 수 없습니다.", skipped }, cors, 200);
  const rows: Any[] = prep.rows || [];
  if (!rows.length) return json({ ok: true, sent: 0, failed: 0, skipped, results: [] }, cors);

  /* 2) 솔라피 */
  const messages = rows.map((r) => ({
    to: String(r.to),
    from: env("SOLAPI_SENDER").replace(/\D/g, ""),
    kakaoOptions: {
      pfId: env("SOLAPI_PFID"),
      templateId: env("SOLAPI_TEMPLATE_ID"),
      variables: { "#{이름}": String(r.name || ""), "#{수업일}": String(r.lesson || ""), "#{코드}": String(r.code || "") },
      disableSms: !(prep.smsFallback || body.fallback === true),
    },
    customFields: { log: String(r.log_id) },
  }));
  const results: Any[] = rows.map((r) => ({ log_id: r.log_id, student_id: r.student_id, ok: true, error: "", message_id: "" }));
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
  await rpcAs(auth, apikey, "kakao_record", { p_results: results.map(({ log_id, ok, error, message_id }) => ({ log_id, ok, error, message_id })) }).catch(() => {});
  const sent = results.filter((x) => x.ok).length;
  return json({
    ok: true, test: action === "test", sent, failed: results.length - sent, skipped,
    results: results.map((x) => ({ student_id: x.student_id, ok: x.ok, error: x.error })),
  }, cors);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  try {
    return await handle(req, cors);
  } catch (e) {
    return json({ ok: false, reason: "error", message: "알림톡 처리 중 오류가 났습니다 — " + String((e as Error).message || e).slice(0, 160) }, cors, 200);
  }
});
