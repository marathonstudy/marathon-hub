// ============================================================
//  text-polish — 코치룸 글 칸 「AI로 다듬기」 · 코멘트 「AI로 초안 쓰기」 (Claude Haiku 5.5)
//
//  코치룸의 학생 · 학부모가 읽는 글 칸(문자 · 공지 · 코멘트 · 수업 내용 · 교재 안내 …)이 부른다. 로그인한 직원만.
//    action 'polish' (기본) — 쓴 글을 다듬는다. kind: sms(짧게, 메신저용) · notice(학생이 바로 알아보게)
//                             · comment(학부모와 학생이 함께 읽는 주간 코멘트) · lessons(차시마다 한 줄, 줄 수 그대로) · general
//    action 'draft'          — 코멘트 초안. target: class(반 공통 4~6문장) · student(개별 2~3문장)
//                             화면이 모은 자료(facts: 수업 내용 · 앱 과제 수행 · 복습테스트 제출 여부 · 자료 이름 …)만 보고 쓴다
//    1) 부른 사람의 로그인 토큰으로 DB 함수 polish_begin → 직원인지 · 이번 달 상한(기본 500회)이 남았는지 서버가 확인
//    2) Claude(Haiku 5.5)에 글(또는 자료)만 보낸다. 학생 이름 · 전화번호는 보내지 않는다 (#{이름} 같은 자리표시 그대로)
//    3) 받은 글을 검사한다 — 자리표시(#{이름} · {금액} …) · 링크가 그대로인지, 원래 글(자료)에 없던 숫자 · 날짜 · 요일이
//       생기지 않았는지, (광고) · 수신거부 문구를 붙이지 않았는지, 수업 내용이면 줄 수가 같은지. 어긋나면 돌려주지 않는다
//    4) polish_finish 로 성공 · 실패와 토큰 · 대략 비용만 남긴다
//  원래 글 · 다듬은 글 · 초안은 어디에도 저장하지 않는다. 화면에 돌려주기만 한다.
//
//  키
//    ANTHROPIC_API_KEY — Supabase 대시보드 → Edge Functions → Secrets 에만 넣는다 (AI 요약과 같은 키).
//    이 파일 · 저장소 · 화면에는 어떤 키도 없다. service_role 키도 쓰지 않는다.
//
//  배포: 대시보드 → Edge Functions → text-polish → Code 탭 → 이 파일 전체 붙여넣기 → Deploy updates
//        (처음이면 Deploy a new function → Via Editor, 이름 text-polish, Verify JWT 끄기)
// ============================================================

import Anthropic from "npm:@anthropic-ai/sdk";

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];

const MODEL = "claude-haiku-5-5";
const PRICE_IN = 0.1 / 1_000_000;   // 달러 / 입력 토큰 (Haiku 5.5)
const PRICE_OUT = 0.5 / 1_000_000;  // 달러 / 출력 토큰
const MAX_CHARS = 1000;             // 다듬을 글 (장문 문자 2000바이트 ≈ 한글 1000자)
const MAX_LONG = 3000;              // 공지 · 교재 안내처럼 긴 칸
const MAX_FACTS = 4000;             // 초안 자료 (JSON 글자 수)
const SORRY = "지금은 다듬을 수 없어요. 직접 보내도 됩니다";
const LENGTHS: Record<string, string> = {
  short: "짧게 — 꼭 필요한 내용만 남겨 단문(90바이트, 한글 약 45자) 안에 들어가게 한다. 다 담을 수 없으면 중요한 사실을 지우지 말고 그대로 두며 check 에 「90바이트 안에 다 담지 못했어요」라고 적는다.",
  normal: "보통 — 원래 글과 비슷한 길이로, 문장만 깔끔하게 다듬는다.",
  long: "자세히 — 원래 사실 안에서 안내를 조금 더 친절하게 풀어 쓴다. 새 사실은 더하지 않는다.",
};
const KINDS: Record<string, string> = {
  sms: "문자 · 카톡 — 짧게, 메신저용. 인사는 짧게 한 줄, 용건을 먼저.",
  notice: "반 공지 — 학생이 바로 알아보게. 무엇을 · 언제까지 · 어떻게가 먼저 보이게, 짧은 문장으로.",
  comment: "학부모와 학생이 함께 읽는 주간 코멘트 — 따뜻하지만 담백하게, 과한 칭찬 없이.",
  lessons: "수업 내용 — 차시마다 한 줄 요약. 줄 수와 순서를 그대로 두고 각 줄만 다듬는다. 명사형으로 끝내도 된다. 작품명은 「 」.",
  general: "학생 · 학부모에게 보이는 안내 글.",
};

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

const RULES = [
  "- ~니다체(합니다 · 드립니다)로 짧고 예의 있게 쓴다. 쓴 사람이 말한 내용만 정리하고 없는 사실은 지어내지 않는다.",
  "- 날짜 · 요일 · 시간 · 숫자 · 금액 · 장소 · 사람 이름 · 전화번호 · 링크 · 계좌번호는 절대 바꾸지 않는다.",
  "- #{이름} #{반} #{링크} #{수업일} 이나 {이름} {금액} {계좌} 같은 중괄호 칸은 보낼 때 채워지는 자리표시다. 글자 하나 바꾸지 말고 원래 글에 있던 개수 그대로 둔다. 없던 자리표시를 새로 넣지 않는다.",
  "- 마크다운(** 굵게, # 제목, - 목록 기호), 이모지, 특수 장식 문자를 쓰지 않는다. 줄바꿈은 써도 된다.",
  "- 과한 칭찬, 광고 문구(최고, 특가, 지금 바로, 놓치지 마세요 같은 말)를 넣지 않는다. (광고) 표시나 수신거부 안내는 시스템이 붙이므로 넣지 않는다.",
  "- 학원 이름은 원래 글에 있을 때만 쓴다.",
].join("\n");

const SYSTEM = [
  "너는 고등학교 국어 학원 「마라톤국어」의 선생님이 학부모 · 학생에게 보이는 글을 다듬는 도우미다.",
  "직원이 쓴 글을 받아, 믿음이 가고 정중하며 군더더기 없는 문장으로 고친다.",
  "",
  "규칙",
  RULES,
  "- 안내에 꼭 필요한 정보(날짜, 시간, 장소, 준비물, 회신 방법 등)가 빠져 보이면 지어내지 말고 check 에 「확인할 것」으로 짧게 적는다. 없으면 빈 배열.",
  "- 원래 글의 뜻을 바꾸지 않는다. 다듬은 글만 text 에 담는다 (설명 · 따옴표 없이).",
].join("\n");

const DRAFT_SYSTEM = [
  "너는 고등학교 국어 학원 「마라톤국어」 선생님의 주간 코멘트 초안을 쓰는 도우미다.",
  "학부모와 학생이 함께 읽는 주간 레포트의 「선생님 한마디」 초안을, 받은 자료에 있는 내용만으로 쓴다.",
  "",
  "규칙",
  RULES,
  "- 자료에 없는 내용(사건 · 칭찬 거리 · 성적 · 일정)은 쓰지 않는다. 시험 점수 숫자, 금액, 상담 내용은 넣지 않는다.",
  "- 학생 이름은 쓰지 않는다 (「이번 주」 「한 주 동안」처럼 쓴다).",
  "- 자료가 부족해 쓰기 어려운 부분은 지어내지 말고 check 에 「확인할 것」으로 짧게 적는다.",
  "- 초안만 text 에 담는다 (설명 · 따옴표 없이).",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    check: { type: "array", items: { type: "string" } },
  },
  required: ["text", "check"],
  additionalProperties: false,
};

/* 문자 바이트 — 한글 등은 2, 영문 · 숫자는 1 (화면의 셈과 같다) */
export function bytes(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); n += (c > 0 && c < 128) ? 1 : 2; }
  return n;
}

const tally = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});
/* 자리표시 — #{이름} (문자) · {이름} (교재 납부 안내) */
const varsOf = (t: string) => t.match(/#?\{[^}\n]{1,20}\}/g) ?? [];
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const urlsOf = (t: string) => t.match(URL_RE) ?? [];
const numsOf = (t: string) => (t.replace(URL_RE, " ").match(/\d[\d,.:]*/g) ?? []).map((x) => x.replace(/[,.:]+$/, "").replace(/,/g, ""));
const DOW = /([월화수목금토일])요일|\(([월화수목금토일])\)/g;
const dowsOf = (t: string) => Array.from(t.matchAll(DOW)).map((m) => m[1] || m[2]);
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
const lineCount = (t: string) => t.split("\n").filter((x) => x.trim()).length;

/* 받은 글 검사 — 고칠 수 있는 것(**, 이모지)은 지우고, 사실 · 자리표시 · 링크가 바뀐 글은 돌려주지 않는다.
   orig 는 원래 글(다듬기) 또는 자료 글(초안). 초안은 자리표시 · 링크 · 숫자가 자료 안의 것이면 된다 */
export function checkPolished(orig: string, out: string, opt: { draft?: boolean; lines?: boolean } = {}): { ok: boolean; text: string; why: string; missing: string[] } {
  let text = out.replace(/\*\*/g, "").replace(/__/g, "").replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(EMOJI, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { ok: false, text, why: "empty", missing: [] };
  const vo = tally(varsOf(orig)), vt = tally(varsOf(text));
  if (opt.draft) {
    if (Object.keys(vt).length) return { ok: false, text, why: "vars", missing: [] };
  } else {
    for (const k of new Set([...Object.keys(vo), ...Object.keys(vt)])) if ((vo[k] || 0) !== (vt[k] || 0)) return { ok: false, text, why: "vars", missing: [] };
  }
  const uo = new Set(urlsOf(orig)), ut = urlsOf(text);
  if (ut.some((u) => !uo.has(u))) return { ok: false, text, why: "links", missing: [] };
  if (!opt.draft && Array.from(uo).some((u) => !ut.includes(u))) return { ok: false, text, why: "links", missing: [] };
  const no = new Set(numsOf(orig));
  if (numsOf(text).some((n) => !no.has(n))) return { ok: false, text, why: "numbers", missing: [] };
  const dowo = new Set(dowsOf(orig));
  if (dowsOf(text).some((d) => !dowo.has(d))) return { ok: false, text, why: "dow", missing: [] };
  for (const w of ["(광고)", "수신거부"]) if (text.includes(w) && !orig.includes(w)) return { ok: false, text, why: "ad", missing: [] };
  if (opt.lines && lineCount(text) !== lineCount(orig)) return { ok: false, text, why: "lines", missing: [] };
  const nt = new Set(numsOf(text));
  const missing = opt.draft ? [] : Array.from(no).filter((n) => !nt.has(n));
  return { ok: true, text: text.slice(0, MAX_LONG * 2), why: "", missing };
}

/* 초안 자료 → 글 (학생 이름 · 번호는 화면이 넣지 않는다. 혹시 들어와도 전화번호 꼴은 지운다) */
function factsText(f: Any): string {
  const s = JSON.stringify(f ?? {}, null, 1).replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "(번호)");
  return s.slice(0, MAX_FACTS);
}

async function polish(req: Request, cors: Record<string, string>) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);

  const body: Any = await req.json().catch(() => ({}));
  const draft = body.action === "draft";
  const kind = KINDS[body.kind] ? String(body.kind) : (draft ? "comment" : "sms");
  const length = LENGTHS[body.length] ? String(body.length) : "normal";
  const target = body.target === "student" ? "student" : "class";
  const text = String(body.text ?? "").replace(/\r\n?/g, "\n").trim();
  const max = kind === "notice" || kind === "general" ? MAX_LONG : MAX_CHARS;
  let source = text;
  if (draft) {
    source = factsText(body.facts);
    if (source.length < 3) return json({ ok: false, reason: "input", message: "초안을 쓸 자료가 없습니다." }, cors, 400);
  } else {
    if (!text) return json({ ok: false, reason: "input", message: "다듬을 내용을 먼저 써 주세요." }, cors, 400);
    if (text.length > max) return json({ ok: false, reason: "input", message: `내용이 너무 깁니다 (${text.length}자). ${max}자까지 다듬을 수 있습니다.` }, cors, 400);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) return json({ ok: false, reason: "nokey", message: SORRY, detail: "Claude 키가 아직 설정되지 않았습니다." }, cors, 200);

  /* 1) 직원 확인 · 월 상한 */
  let begin: Any;
  try {
    begin = await rpcAs(auth, apikey, "polish_begin", { p_chars: source.length, p_length: draft ? "draft" : length });
  } catch (e) {
    return json({ ok: false, reason: "auth", message: String((e as Error).message || e) }, cors, 403);
  }
  if (!begin?.ok) {
    return json({ ok: false, reason: "cap", message: SORRY, detail: `이번 달 다듬기 상한(${begin?.cap}회)을 모두 썼습니다.`, used: begin?.used, cap: begin?.cap }, cors, 200);
  }

  const finish = (args: Record<string, unknown>) =>
    rpcAs(auth, apikey, "polish_finish", { p_usage: begin.usage_id, p_ok: false, p_model: MODEL, p_in: 0, p_out: 0, p_cost: 0, p_error: "", ...args })
      .catch(() => null);
  const fail = async (why: string, usage: Record<string, unknown> = {}) => {
    const f = await finish({ ...usage, p_error: why });
    return json({ ok: false, reason: "claude", message: SORRY, used: f?.used ?? begin.used - 1, cap: begin.cap }, cors, 200);
  };

  /* 2) Claude — 글(또는 자료)만 */
  let user: string;
  if (draft) {
    const guide = target === "class"
      ? "반 공통 코멘트 초안을 4~6문장으로 쓴다. 「이번 주에 배운 것 → 다음 주까지 할 것」 순서로. 수업 내용 · 앱 과제 수행 · 복습테스트 제출 현황 · 배부 자료 이름을 근거로."
      : "학생 개별 코멘트 초안을 2~3문장으로 쓴다. 출결 · 집중도 · 앱 과제 수행 · 복습테스트 제출 여부 · 지난 기간과 비교한 흐름을 근거로. 반 공통 코멘트(classComment)와 겹치는 말은 쓰지 않는다.";
    user = `${guide}\n\n<facts>\n${source}\n</facts>`;
  } else {
    user = `종류: ${KINDS[kind]}\n` + (kind === "sms" ? `길이: ${LENGTHS[length]}\n` : "") +
      `\n아래 글을 규칙대로 다듬어라.\n\n<message>\n${text}\n</message>`;
  }
  let res: Any;
  try {
    const client = new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 });
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: draft ? DRAFT_SYSTEM : SYSTEM,
      messages: [{ role: "user", content: user }],
    } as Any);
  } catch (e) {
    let why = "connect";
    if (e instanceof Anthropic.AuthenticationError) why = "auth-key";
    else if (e instanceof Anthropic.PermissionDeniedError) why = "permission";
    else if (e instanceof Anthropic.RateLimitError) why = "rate-limit";
    else if (e instanceof Anthropic.BadRequestError) why = "bad-request";
    else if (e instanceof Anthropic.APIError) why = `api ${(e as Any).status}`;
    return await fail(why);
  }

  const inTok = Number(res?.usage?.input_tokens) || 0;
  const outTok = Number(res?.usage?.output_tokens) || 0;
  const cost = Math.round((inTok * PRICE_IN + outTok * PRICE_OUT) * 100000) / 100000;
  const usage = { p_in: inTok, p_out: outTok, p_cost: cost };

  if (res?.stop_reason === "refusal") return await fail("refusal " + (res?.stop_details?.category ?? ""), usage);
  if (res?.stop_reason === "max_tokens") return await fail("max_tokens", usage);

  let parsed: Any = null;
  for (const b of res?.content ?? []) {
    if (b?.type === "text") { try { parsed = JSON.parse(b.text); } catch (_) { /* 아래에서 처리 */ } }
  }
  if (!parsed || typeof parsed.text !== "string") return await fail("empty", usage);

  /* 3) 검사 — 자리표시 · 링크 · 숫자 · 요일 · 광고 표시 · (수업 내용) 줄 수 */
  const c = checkPolished(source, parsed.text, { draft, lines: !draft && kind === "lessons" });
  if (!c.ok) return await fail("check " + c.why, usage);

  const check: string[] = (Array.isArray(parsed.check) ? parsed.check : [])
    .map((x: unknown) => String(x ?? "").replace(/\*\*/g, "").replace(EMOJI, "").trim())
    .filter(Boolean).slice(0, 5).map((x: string) => x.slice(0, 120));
  for (const n of c.missing) check.push(`원래 글의 「${n}」이(가) 빠졌어요. 꼭 필요하면 다시 넣어 주세요.`);
  const b = bytes(c.text);
  if (!draft && kind === "sms" && length === "short" && b > 90 && !check.some((x) => /90바이트/.test(x))) check.push(`90바이트(단문) 안에 다 담지 못했어요 — ${b}바이트`);

  /* 4) 기록 (글은 남기지 않는다) */
  const f = await finish({ ...usage, p_ok: true });
  return json({ ok: true, text: c.text, check, bytes: b, length, kind, action: draft ? "draft" : "polish", used: f?.used ?? begin.used, cap: begin.cap }, cors, 200);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  if (!URL_) return json({ ok: false, reason: "config", message: SORRY }, cors, 500);
  try {
    return await polish(req, cors);
  } catch (e) {
    console.error("text-polish", (e as Error)?.name || "error");
    return json({ ok: false, reason: "server", message: SORRY }, cors, 500);
  }
});
