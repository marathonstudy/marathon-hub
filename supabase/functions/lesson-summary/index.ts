// ============================================================
//  lesson-summary — 자막(또는 붙여 넣은 스크립트) → Claude → "1차시: … / 2차시: …" 초안
//
//  코치룸 ② 작성 → 반 공통 → [자막으로 AI 요약] 이 부른다. 로그인한 직원만.
//    1) 부른 사람의 로그인 토큰으로 DB 함수 summary_begin 을 부른다
//       → 직원인지 · 이번 달 상한(기본 80회)이 남았는지 서버가 확인하고 기록 한 줄
//    2) Claude(Opus 5.5)에 자막을 보내 요약을 받는다 (정해 둔 JSON 모양으로)
//    3) summary_finish 로 초안 저장 (학부모에게는 안 보인다 — 직원이 [확정]해야 보인다)
//  자막 원문은 저장하지 않는다. Claude 에 보낼 때만 쓴다.
//
//  키
//    ANTHROPIC_API_KEY — Supabase 대시보드 → Edge Functions → Secrets 에만 넣는다.
//    이 파일 · 저장소 · 화면에는 어떤 키도 없다. service_role 키도 쓰지 않는다.
//
//  배포: 대시보드 → Edge Functions → Deploy a new function → Via Editor
//        이름 lesson-summary, 이 파일 전체 붙여넣기 → Deploy, Verify JWT 끄기 (README 참고 —
//        로그인 확인은 이 함수가 DB 에 직접 한다)
// ============================================================

import Anthropic from "npm:@anthropic-ai/sdk";

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];

const MODEL = "claude-opus-5-5";
const PRICE_IN = 4 / 1_000_000;     // 달러 / 입력 토큰 (Opus 5.5)
const PRICE_OUT = 20 / 1_000_000;   // 달러 / 출력 토큰
const MAX_CHARS = 300_000;          // 한 번에 보내는 자막 글자 수 상한 (3시간 강의 ≈ 6만 자)

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

/* 부른 사람의 로그인 토큰으로 DB 함수를 부른다 — RLS · is_staff() 가 그대로 적용된다 */
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

const SYSTEM = [
  "너는 고등학교 국어 학원 「마라톤국어」의 수업 기록 도우미다.",
  "선생님의 수업 영상 자막(유튜브 자동 생성 자막이거나 직접 붙여 넣은 스크립트)을 읽고,",
  "학부모에게 보내는 주간 레포트의 「이번주 학습 내용」에 들어갈 차시별 한 줄 요약을 만든다.",
  "",
  "규칙",
  "- 요청한 차시 수만큼, 수업 순서대로 나눈다. 한 영상에 여러 차시가 들어 있으면 쉬는 시간, '2교시' 같은 말, 다루는 작품·단원이 바뀌는 곳을 경계로 삼는다.",
  "- 한 줄은 80자 안팎. 무엇을 배웠는지가 드러나게: 갈래 · 작품/지문 · 핵심 개념이나 활동. 예) 현대시 「진달래꽃」 — 화자의 정서와 반어 표현 분석",
  "- 작품명은 「 」로 감싼다. 문장을 길게 늘이지 말고 명사형으로 끝낸다.",
  "- 자동 자막은 받아쓰기 오류가 많다(예: '국어 강사'가 '구어왕사'로). 작품명·작가·용어는 확실할 때만 바로잡고, 확실하지 않으면 그 이름을 빼고 내용만 쓴다. 자막에 없는 내용을 지어내지 않는다.",
  "- 요약은 그 반 학부모 모두가 본다. 학생 개인 이야기가 나오면 안 된다.",
  "- 출석 부르기, 학생 이름, 잡담(학교 · 가족 · 개인 이야기), 성적, 개인 정보는 모두 뺀다. 자막의 「학생」은 이름을 가린 자리다 — 그 부분은 쓰지 않는다.",
  "- 수업에서 다룬 개념, 지문 · 작품, 풀이 방법, 과제 안내 위주로 쓴다.",
  "- 차시 경계나 작품명이 확실하지 않으면 note 에 짧게 적어 선생님이 확인하게 한다. 없으면 note 는 빈 문자열.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: { no: { type: "integer" }, text: { type: "string" } },
        required: ["no", "text"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["lessons", "note"],
  additionalProperties: false,
};

function userPrompt(mode: string, n: number, texts: string[]): string {
  if (mode === "split") {
    return `차시마다 자막이 따로 있다. 각 자막을 그 차시 한 줄로 요약해 lessons 에 ${n}개를 담아라 (no 는 1부터).\n\n` +
      texts.map((t, i) => `<transcript lesson="${i + 1}">\n${t}\n</transcript>`).join("\n\n");
  }
  return `아래는 한 영상(한 수업)의 자막이다. 수업 순서대로 ${n}개 차시로 나눠 각 차시를 한 줄로 요약하고 lessons 에 ${n}개를 담아라 (no 는 1부터).\n\n` +
    `<transcript>\n${texts[0]}\n</transcript>`;
}

async function summarize(req: Request, cors: Record<string, string>) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);

  const body: Any = await req.json().catch(() => ({}));
  const cls = String(body.class_name ?? "").trim();
  const week = String(body.week_start ?? "");
  const mode = body.mode === "split" ? "split" : "one";
  const n = Math.round(Number(body.lessons) || 2);
  const source = body.source === "paste" ? "paste" : "file";
  const texts: string[] = (Array.isArray(body.texts) ? body.texts : []).map((t: unknown) => String(t ?? "").trim());
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ ok: false, reason: "input", message: "반과 주차를 골라 주세요." }, cors, 400);
  if (n < 1 || n > 4) return json({ ok: false, reason: "input", message: "차시 수는 1 ~ 4 로 골라 주세요." }, cors, 400);
  if (mode === "one" ? (texts.length !== 1 || !texts[0]) : (texts.length !== n || texts.some((t) => !t))) {
    return json({ ok: false, reason: "input", message: "자막을 넣어 주세요." }, cors, 400);
  }
  const chars = texts.reduce((a, t) => a + t.length, 0);
  if (chars < 200) return json({ ok: false, reason: "input", message: "자막이 너무 짧습니다. 파일이나 붙여 넣은 내용을 확인해 주세요." }, cors, 400);
  if (chars > MAX_CHARS) return json({ ok: false, reason: "input", message: `자막이 너무 깁니다 (${chars.toLocaleString()}자). ${MAX_CHARS.toLocaleString()}자까지 보낼 수 있습니다.` }, cors, 400);

  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) return json({ ok: false, reason: "nokey", message: "Claude 키가 아직 설정되지 않았습니다. README 의 「Claude 키 넣기」를 따라 Supabase Secrets 에 넣어 주세요." }, cors, 200);

  /* 1) 직원 확인 · 월 상한 */
  let begin: Any;
  try {
    begin = await rpcAs(auth, apikey, "summary_begin", { p_class: cls, p_week: week, p_chars: chars });
  } catch (e) {
    return json({ ok: false, reason: "auth", message: String((e as Error).message || e) }, cors, 403);
  }
  if (!begin?.ok) {
    return json({ ok: false, reason: "cap", message: `이번 달 AI 요약 상한(${begin?.cap}회)을 모두 썼습니다. 선생님이 상한을 늘리거나 다음 달에 다시 해 주세요.`, used: begin?.used, cap: begin?.cap }, cors, 200);
  }

  const finish = (args: Record<string, unknown>) =>
    rpcAs(auth, apikey, "summary_finish", {
      p_usage: begin.usage_id, p_ok: false, p_lessons: [], p_note: "", p_source: source,
      p_model: MODEL, p_in: 0, p_out: 0, p_cost: 0, p_error: "", ...args,
    });

  /* 2) Claude */
  let res: Any;
  try {
    const client = new Anthropic({ apiKey: key, timeout: 140_000, maxRetries: 1 });
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(mode, n, texts) }],
    } as Any);
  } catch (e) {
    let msg = "요약 서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.";
    if (e instanceof Anthropic.AuthenticationError) msg = "Claude 키가 맞지 않습니다. Supabase Secrets 의 ANTHROPIC_API_KEY 를 확인해 주세요.";
    else if (e instanceof Anthropic.PermissionDeniedError) msg = "Claude 키에 권한이 없습니다. Anthropic Console 에서 키 · 결제 상태를 확인해 주세요.";
    else if (e instanceof Anthropic.RateLimitError) msg = "요청이 많거나 크레딧/월 한도에 걸렸습니다. Anthropic Console 의 Billing · Limits 를 확인해 주세요.";
    else if (e instanceof Anthropic.BadRequestError) msg = "요청이 거절됐습니다 — " + String((e as Error).message).slice(0, 160);
    else if (e instanceof Anthropic.APIError) msg = `요약 서버 오류 (${(e as Any).status}). 잠시 뒤 다시 해 주세요.`;
    await finish({ p_error: msg }).catch(() => {});
    return json({ ok: false, reason: "claude", message: msg }, cors, 200);
  }

  const inTok = Number(res?.usage?.input_tokens) || 0;
  const outTok = Number(res?.usage?.output_tokens) || 0;
  const cost = Math.round((inTok * PRICE_IN + outTok * PRICE_OUT) * 10000) / 10000;
  const usage = { p_in: inTok, p_out: outTok, p_cost: cost };

  if (res?.stop_reason === "refusal") {
    const msg = "Claude 가 이 자막의 요약을 거절했습니다. 내용을 확인하고 직접 적어 주세요.";
    await finish({ ...usage, p_error: "refusal " + (res?.stop_details?.category ?? "") }).catch(() => {});
    return json({ ok: false, reason: "refusal", message: msg }, cors, 200);
  }
  if (res?.stop_reason === "max_tokens") {
    await finish({ ...usage, p_error: "max_tokens" }).catch(() => {});
    return json({ ok: false, reason: "claude", message: "요약이 중간에 끊겼습니다. 다시 한 번 눌러 주세요." }, cors, 200);
  }

  let parsed: Any = null;
  for (const b of res?.content ?? []) {
    if (b?.type === "text") { try { parsed = JSON.parse(b.text); } catch (_) { /* 아래에서 처리 */ } }
  }
  const lessons: string[] = (parsed?.lessons ?? [])
    .slice()
    .sort((a: Any, b: Any) => (Number(a?.no) || 0) - (Number(b?.no) || 0))
    .map((l: Any, i: number) => String(l?.text ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t: string, i: number) => (/^\d+\s*차시\s*[:：]/.test(t) ? t : `${i + 1}차시: ${t}`).slice(0, 300));
  if (!lessons.length) {
    await finish({ ...usage, p_error: "empty" }).catch(() => {});
    return json({ ok: false, reason: "claude", message: "요약을 받지 못했습니다. 다시 한 번 눌러 주세요." }, cors, 200);
  }

  /* 3) 초안 저장 */
  const saved = await finish({ ...usage, p_ok: true, p_lessons: lessons.slice(0, 6), p_note: String(parsed?.note ?? "").slice(0, 500) });
  return json({
    ok: true, summary: saved?.summary, used: begin.used, cap: begin.cap,
    usage: { input_tokens: inTok, output_tokens: outTok, cost_usd: cost },
  }, cors, 200);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  if (!URL_) return json({ ok: false, reason: "config", message: "함수 설정이 비어 있습니다." }, cors, 500);
  try {
    return await summarize(req, cors);
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: "server", message: "잠시 뒤 다시 해 주세요." }, cors, 500);
  }
});
