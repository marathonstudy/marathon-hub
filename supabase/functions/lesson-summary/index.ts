// ============================================================
//  lesson-summary — 자막(또는 붙여 넣은 스크립트) → Claude → "1차시: … / 2차시: …" 초안
//
//  코치룸 ② 작성 → 반 공통 → [자막으로 AI 요약] 이 부른다. 로그인한 직원만.
//    1) 부른 사람의 로그인 토큰으로 DB 함수 summary_begin 을 부른다
//       → 직원인지 · 이번 달 상한(기본 80회)이 남았는지 서버가 확인하고 기록 한 줄
//    2) Claude(Sonnet 5.5)에 자막을 보내 요약을 받는다 (정해 둔 JSON 모양으로)
//    3) summary_finish 로 초안 저장 (학부모에게는 안 보인다 — 직원이 [확정]해야 보인다)
//  자막 원문은 저장하지 않는다. Claude 에 보낼 때만 쓴다.
//  복습 노트 (20261031l) — body.kind = "review" 면 한 장 요약 + OX 퀴즈 (아래 reviewNote · migration-039)
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

const MODEL = "claude-sonnet-5-5";
const PRICE_IN = 2 / 1_000_000;     // 달러 / 입력 토큰 (Sonnet 5.5)
const PRICE_OUT = 10 / 1_000_000;   // 달러 / 출력 토큰
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
  "학부모에게 보내는 주간 레포트의 「수업」 카드에 들어갈 차시별 요약을 만든다 (20261031x — 차시별 짧은 머리말 + 점 목록).",
  "",
  "모양 (차시마다)",
  "- head 머리말: 그 차시 영역을 아주 짧게 (10자 안팎) — 「독서 · 인문」 「문학 · 소설」 「화법과 작문」처럼. 「1교시」 같은 번호는 쓰지 않는다(화면이 붙인다).",
  "- points 핵심: 2~4줄. 한 줄은 25자 안팎, 한 줄에 내용 하나만. 「—」나 쉼표로 여러 내용을 이어 붙이지 않는다. 명사형으로 끝낸다.",
  "  예) head 「독서 · 인문」 points [「롤스와 매킨타이어의 정의관」, 「지시 표현 확인, 지문 근거로 정답 확정」은 X → 「지시 표현을 지문 근거로 확인」, 「모의고사 구성과 시간 배분」]",
  "  예) head 「문학 · 소설」 points [「고전소설 「운영전」 인물 관계」, 「현대소설 주인공 심리와 회상의 기능」, 「〈보기〉 활용해서 풀기」]",
  "",
  "규칙",
  "- 요청한 차시 수만큼, 수업 순서대로 나눈다. 한 영상에 여러 차시가 들어 있으면 쉬는 시간, '2교시' 같은 말, 다루는 작품·단원이 바뀌는 곳을 경계로 삼는다.",
  "- 무엇을 배웠는지가 드러나게: 작품/지문 · 핵심 개념 · 푸는 방법 · 과제 안내.",
  "- 작품명은 「 」로 감싼다.",
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
        properties: { no: { type: "integer" }, head: { type: "string" }, points: { type: "array", items: { type: "string" } } },
        required: ["no", "head", "points"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["lessons", "note"],
  additionalProperties: false,
};

function userPrompt(mode: string, n: number, texts: string[]): string {
  /* 「요약 다시 만들기」 — 이미 있는 요약을 새 모양(머리말 + 점 목록)으로만 바꾼다. 자막이 없으니 내용을 더하지 않는다 */
  if (mode === "reformat") {
    return `아래는 이미 만든 차시별 수업 요약이다. 내용을 더하거나 지어내지 말고, 차시마다 head(짧은 머리말)와 points(2~4줄 · 한 줄 25자 안팎 · 한 줄에 하나)로만 바꿔 lessons 에 ${n}개를 담아라 (no 는 1부터). note 는 빈 문자열.\n\n` +
      `<summary>\n${texts[0]}\n</summary>`;
  }
  if (mode === "split") {
    return `차시마다 자막이 따로 있다. 각 자막을 그 차시 머리말 + 점 목록으로 요약해 lessons 에 ${n}개를 담아라 (no 는 1부터).\n\n` +
      texts.map((t, i) => `<transcript lesson="${i + 1}">\n${t}\n</transcript>`).join("\n\n");
  }
  return `아래는 한 영상(한 수업)의 자막이다. 수업 순서대로 ${n}개 차시로 나눠 각 차시를 머리말 + 점 목록으로 요약하고 lessons 에 ${n}개를 담아라 (no 는 1부터).\n\n` +
    `<transcript>\n${texts[0]}\n</transcript>`;
}

/* 저장 모양 — 「독서 · 인문\n· 롤스와 매킨타이어의 정의관\n· …」 (번호는 화면이 「1교시」로 붙인다 · 한 차시 300자 안) */
function lessonText(l: Any): string {
  const head = String(l?.head ?? "").replace(/\s+/g, " ").replace(/^\s*\d+\s*(교시|차시)\s*[:：.]?\s*/, "").trim().slice(0, 30);
  const points = (Array.isArray(l?.points) ? l.points : []).map((p: unknown) => String(p ?? "").replace(/\s+/g, " ").replace(/^[·•\-*]\s*/, "").trim()).filter(Boolean).slice(0, 4);
  let out = head;
  for (const p of points) { const next = out + "\n· " + p; if (next.length > 300) break; out = next; }
  return out.trim();
}

async function summarize(req: Request, cors: Record<string, string>) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);

  const body: Any = await req.json().catch(() => ({}));
  if (body.kind === "review") return reviewNote(body, auth, apikey, cors);
  const cls = String(body.class_name ?? "").trim();
  const week = String(body.week_start ?? "");
  const mode = body.mode === "split" ? "split" : body.mode === "reformat" ? "reformat" : "one";
  const n = Math.round(Number(body.lessons) || 2);
  const source = body.source === "paste" || mode === "reformat" ? "paste" : "file";
  const texts: string[] = (Array.isArray(body.texts) ? body.texts : []).map((t: unknown) => String(t ?? "").trim());
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ ok: false, reason: "input", message: "반과 주차를 골라 주세요." }, cors, 400);
  if (n < 1 || n > 4) return json({ ok: false, reason: "input", message: "차시 수는 1 ~ 4 로 골라 주세요." }, cors, 400);
  if (mode !== "split" ? (texts.length !== 1 || !texts[0]) : (texts.length !== n || texts.some((t) => !t))) {
    return json({ ok: false, reason: "input", message: mode === "reformat" ? "다시 만들 요약이 없습니다." : "자막을 넣어 주세요." }, cors, 400);
  }
  const chars = texts.reduce((a, t) => a + t.length, 0);
  if (mode !== "reformat" && chars < 200) return json({ ok: false, reason: "input", message: "자막이 너무 짧습니다. 파일이나 붙여 넣은 내용을 확인해 주세요." }, cors, 400);
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
    .map((l: Any) => (l && l.text != null && l.head == null ? String(l.text).replace(/\s+/g, " ").trim().slice(0, 300) : lessonText(l)))
    .filter(Boolean);
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

/* ============================================================
   복습 노트 (20261031l · migration-039) — body.kind = "review"
     op "make"   자막 → 차시마다 오늘의 한 줄 · 다룬 지문 · 현장 행동 강령 · 이렇게 적용했다 · 자주 하는 실수 · 꼭 기억할 말 + OX 4~6문항
                 → 두 번째 호출로 OX 문항마다 기준을 다시 검사해 어긋나는 문항은 버린다 (남은 것이 4개 미만이면 OX 없음)
                 → review_note_draft 로 초안 저장 (확정해야 학생 화면에 나온다)
     op "field"  자막 → 그 차시 그 칸만 다시 (저장은 코치룸이 고친 초안과 함께)
     op "quiz"   자막 → OX 만 다시 (검사 포함)
     op "polish" 지금 노트(자막 없이) → 말만 다듬는다 (내용을 더하지 않는다)
                 request(2~300자)가 있으면 「AI에게 고쳐 달라고 하기」 — 지금 노트(손으로 고친 것 포함)를 그 요청대로만 고친다 (20261031p)
     requests    그 반 기본 요청(migration-043) — make · polish 가 처음부터 따른다
   수업 요약과 같은 모델 · 같은 월 상한(summary_begin) · 자막 원문은 저장하지 않는다
   ============================================================ */

const FIELDS = ["oneLine", "passages", "actions", "applied", "mistakes", "remember"];

const REVIEW_SYSTEM = [
  "너는 고등학교 국어 학원 「마라톤국어」의 복습 노트 도우미다.",
  "선생님 수업 영상 자막을 읽고, 학생이 10분 안에 수업 전체를 다시 떠올릴 수 있는 한 장짜리 복습 노트를 만든다. 학생이 스스로 보는 자료다.",
  "",
  "차시마다 칸",
  "- oneLine 오늘의 한 줄: 그 차시 핵심을 한 문장으로.",
  "- passages 다룬 지문: 「시행 연월 · 작품/지문 이름」 한 줄씩 (예: 2024년 6월 모의평가 · 「진달래꽃」). 연월이 자막에 없으면 이름만.",
  "- actions 현장 행동 강령: 시험장에서 쓸 행동 3~5개. 선생님이 수업에서 쓴 표현을 그대로 살린다. 명령형 짧은 문장.",
  "- applied 이렇게 적용했다: 지문마다 강령을 어떻게 적용했는지 2~3줄. 한 항목 = 「지문 이름 — 적용 내용」.",
  "- mistakes 자주 하는 실수: 선생님이 「이러면 틀린다」고 한 부분.",
  "- remember 꼭 기억할 말: 선생님이 강조한 문장 1~2개 (자막 표현을 살려서).",
  "",
  "지키는 것",
  "- 자막에 없는 내용, 작품 해석, 출처, 시행 연월을 지어내지 않는다. 확실하지 않은 칸은 비워 두고 그 칸 이름을 unsure 에 넣는다.",
  "- 자동 자막은 받아쓰기 오류가 많다. 작품명 · 용어는 확실할 때만 바로잡는다.",
  "- 학생 이름 · 출석 · 잡담 · 성적 · 개인 이야기는 넣지 않는다. 자막의 「학생」은 이름을 가린 자리다.",
  "- 차시 수는 요청한 만큼, 수업 순서대로. 한 영상에 여러 차시가 들어 있으면 쉬는 시간 · '2교시' · 다루는 지문이 바뀌는 곳을 경계로 삼는다.",
  "",
  "OX 퀴즈 (quiz · 4~6문항) — 수업의 큰 원칙(행동 강령)을 다시 떠올리게 하는 것이 목적",
  "- 문항 재료는 oneLine · actions · mistakes 에서만. passages · applied 는 문제 재료로 쓰지 않는다. from 에 재료 칸을 적는다.",
  "- 작품 · 지문 이름, 인물, 시행 연월, 숫자, 특정 구절 · 문장, 특정 지문의 내용이 들어간 문항은 만들지 않는다. 기준: 그 지문을 안 봐도 수업을 들었다면 풀 수 있는가.",
  "- 좋은 예: 「현대시에서 화자의 반응은 주로 심리어에서 찾는다」(O) · 「기술 지문은 세부 수치부터 외우며 읽는다」(X — 규칙부터 찾는다).",
  "- X 문항은 학생들이 실제로 하는 잘못된 읽기 습관으로 만들고, why 에 바른 행동 강령을 한 줄로 쓴다. O 문항의 why 도 한 줄.",
].join("\n");

const LESSON_ITEM = {
  type: "object",
  properties: {
    no: { type: "integer" },
    oneLine: { type: "string" },
    passages: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    applied: { type: "array", items: { type: "string" } },
    mistakes: { type: "array", items: { type: "string" } },
    remember: { type: "array", items: { type: "string" } },
    unsure: { type: "array", items: { type: "string", enum: FIELDS } },
  },
  required: ["no", "oneLine", "passages", "actions", "applied", "mistakes", "remember", "unsure"],
  additionalProperties: false,
};
const QUIZ_ITEM = {
  type: "object",
  properties: {
    q: { type: "string" },
    a: { type: "string", enum: ["O", "X"] },
    why: { type: "string" },
    from: { type: "string", enum: ["oneLine", "actions", "mistakes"] },
  },
  required: ["q", "a", "why", "from"],
  additionalProperties: false,
};
const NOTE_SCHEMA = {
  type: "object",
  properties: { lessons: { type: "array", items: LESSON_ITEM }, quiz: { type: "array", items: QUIZ_ITEM }, note: { type: "string" } },
  required: ["lessons", "quiz", "note"],
  additionalProperties: false,
};
const QUIZ_SCHEMA = {
  type: "object",
  properties: { quiz: { type: "array", items: QUIZ_ITEM } },
  required: ["quiz"],
  additionalProperties: false,
};
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, keep: { type: "boolean" }, reason: { type: "string" } },
        required: ["i", "keep", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function transcriptBlock(mode: string, n: number, texts: string[]): string {
  return mode === "split"
    ? `차시마다 자막이 따로 있다 (${n}차시).\n\n` + texts.map((t, i) => `<transcript lesson="${i + 1}">\n${t}\n</transcript>`).join("\n\n")
    : `아래는 한 영상(한 수업)의 자막이다. 수업 순서대로 ${n}개 차시로 나눈다.\n\n<transcript>\n${texts[0]}\n</transcript>`;
}

function strs(v: unknown, max: number, len = 300): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, len));
}
function cleanLesson(l: Any, i: number) {
  return {
    no: i + 1,
    oneLine: String(l?.oneLine ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    passages: strs(l?.passages, 12, 160),
    actions: strs(l?.actions, 6),
    applied: strs(l?.applied, 12),
    mistakes: strs(l?.mistakes, 6),
    remember: strs(l?.remember, 3),
    unsure: strs(l?.unsure, 6, 20).filter((f) => FIELDS.includes(f)),
  };
}
/* 지문 이름 — 「 」 · 『 』 안, 또는 「연월 · 이름」의 뒤쪽 */
function passageNames(lessons: Any[]): string[] {
  const out: string[] = [];
  for (const l of lessons) {
    for (const p of l.passages ?? []) {
      const m = String(p).match(/[「『]([^」』]+)[」』]/g);
      if (m) m.forEach((x) => out.push(x.slice(1, -1).trim()));
      else { const t = String(p).split("·").pop()!.trim(); if (t.length >= 2) out.push(t); }
    }
  }
  return out.filter((x) => x.length >= 2);
}
/* 기계로 먼저 거른다 — 작품 · 지문 이름, 숫자, 시행 연월, 인용 구절 */
function quizLocalOk(q: Any, names: string[]): boolean {
  const t = String(q?.q ?? "");
  if (!t || t.length > 140 || !["O", "X"].includes(q?.a) || !String(q?.why ?? "").trim()) return false;
  if (!["oneLine", "actions", "mistakes"].includes(q?.from)) return false;
  if (/[0-9０-９]|[「」『』“”"]|학년도|모의평가|모의고사|수능|평가원/.test(t)) return false;
  if (names.some((n) => t.includes(n))) return false;
  return true;
}
function cleanQuiz(list: Any[]): Any[] {
  return list.map((q) => ({ q: String(q.q).replace(/\s+/g, " ").trim(), a: q.a, why: String(q.why).replace(/\s+/g, " ").trim().slice(0, 200), from: q.from }));
}

async function callJson(client: Any, system: string, user: string, schema: unknown, max = 16000) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: max,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  } as Any);
  let parsed: Any = null;
  for (const b of res?.content ?? []) if (b?.type === "text") { try { parsed = JSON.parse(b.text); } catch (_) { /* 아래 */ } }
  return { res, parsed };
}

const CHECK_SYSTEM = [
  "너는 OX 퀴즈 검사관이다. 문항마다 아래 기준을 모두 지키는지 본다. 하나라도 어기면 keep=false.",
  "1. 수업의 큰 원칙(현장 행동 강령 · 읽기 습관)을 묻는다.",
  "2. 작품 · 지문 이름, 인물, 시행 연월, 숫자, 특정 구절 · 문장, 특정 지문의 내용이 들어 있지 않다.",
  "3. 그 지문을 안 봐도, 수업을 들었다면 풀 수 있다.",
  "4. 정답(O/X)이 수업에서 말한 원칙과 맞고, X 문항은 학생이 실제로 하는 잘못된 읽기 습관이며 해설에 바른 강령이 한 줄로 있다.",
  "5. 아래 「수업의 원칙」에 근거가 있다 (없는 내용을 지어낸 문항은 버린다).",
].join("\n");

/* 문항마다 다시 검사 → 남은 것 (4개 미만이면 []) */
async function checkQuiz(client: Any, quiz: Any[], lessons: Any[], tok: { in: number; out: number }) {
  const names = passageNames(lessons);
  let list = cleanQuiz(quiz.filter((q) => quizLocalOk(q, names))).slice(0, 8);
  if (list.length < 4) return [];
  const basis = lessons.map((l) => `${l.no}차시 — 오늘의 한 줄: ${l.oneLine}\n행동 강령: ${l.actions.join(" / ")}\n자주 하는 실수: ${l.mistakes.join(" / ")}`).join("\n\n");
  const user = `<수업의 원칙>\n${basis}\n</수업의 원칙>\n\n<문항>\n` +
    list.map((q, i) => `${i}. ${q.q} (정답 ${q.a}) — 해설: ${q.why}`).join("\n") + "\n</문항>\n\n문항마다 i(번호) · keep · reason(짧게) 을 items 에 담아라.";
  const { res, parsed } = await callJson(client, CHECK_SYSTEM, user, CHECK_SCHEMA, 4000);
  tok.in += Number(res?.usage?.input_tokens) || 0;
  tok.out += Number(res?.usage?.output_tokens) || 0;
  const keep = new Set((parsed?.items ?? []).filter((x: Any) => x?.keep === true).map((x: Any) => Number(x?.i)));
  list = list.filter((_, i) => keep.has(i)).slice(0, 6);
  return list.length >= 4 ? list.map(({ q, a, why }) => ({ q, a, why })) : [];
}

const FIELD_LABEL: Record<string, string> = { oneLine: "오늘의 한 줄", passages: "다룬 지문", actions: "현장 행동 강령", applied: "이렇게 적용했다", mistakes: "자주 하는 실수", remember: "꼭 기억할 말" };

async function reviewNote(body: Any, auth: string, apikey: string, cors: Record<string, string>) {
  const cls = String(body.class_name ?? "").trim();
  const week = String(body.week_start ?? "");
  const op = ["make", "field", "quiz", "polish"].includes(body.op) ? body.op : "make";
  const mode = body.mode === "split" ? "split" : "one";
  const n = Math.round(Number(body.lessons) || 2);
  const texts: string[] = (Array.isArray(body.texts) ? body.texts : []).map((t: unknown) => String(t ?? "").trim());
  const cur: Any = body.note && typeof body.note === "object" ? body.note : null;
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ ok: false, reason: "input", message: "반과 주차를 골라 주세요." }, cors, 400);
  if (n < 1 || n > 4) return json({ ok: false, reason: "input", message: "차시 수는 1 ~ 4 로 골라 주세요." }, cors, 400);
  let chars = 0;
  if (op !== "polish") {
    if (mode === "one" ? (texts.length !== 1 || !texts[0]) : (texts.length !== n || texts.some((t) => !t))) {
      return json({ ok: false, reason: "notext", message: "영상 자막을 먼저 넣어 주세요." }, cors, 400);
    }
    chars = texts.reduce((a, t) => a + t.length, 0);
    if (chars < 200) return json({ ok: false, reason: "notext", message: "영상 자막을 먼저 넣어 주세요. (자막이 너무 짧습니다)" }, cors, 400);
    if (chars > MAX_CHARS) return json({ ok: false, reason: "input", message: `자막이 너무 깁니다 (${chars.toLocaleString()}자).` }, cors, 400);
  } else if (!cur || !Array.isArray(cur.lessons) || !cur.lessons.length) {
    return json({ ok: false, reason: "input", message: "다듬을 복습 노트가 없습니다." }, cors, 400);
  }
  /* 「AI에게 고쳐 달라고 하기」(polish + request · 2~300자) · 그 반 기본 요청(requests · migration-043) — 20261031p */
  const request = String(body.request ?? "").replace(/\s+/g, " ").trim();
  if (request && (request.length < 2 || request.length > 300)) return json({ ok: false, reason: "input", message: "요청은 2 ~ 300자로 적어 주세요." }, cors, 400);
  const always: string[] = (Array.isArray(body.requests) ? body.requests : []).map((x: unknown) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 300)).filter((x: string) => x.length >= 2).slice(0, 8);
  const alwaysText = always.length ? "\n\n선생님이 이 반에 늘 바라는 점 (처음부터 따른다):\n" + always.map((x) => "- " + x).join("\n") : "";
  const lessonNo = Math.round(Number(body.lesson) || 1);
  const field = String(body.field ?? "");
  if (op === "field" && !FIELDS.includes(field)) return json({ ok: false, reason: "input", message: "다시 만들 칸을 골라 주세요." }, cors, 400);

  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) return json({ ok: false, reason: "nokey", message: "Claude 키가 아직 설정되지 않았습니다. README 의 「Claude 키 넣기」를 따라 Supabase Secrets 에 넣어 주세요." }, cors, 200);

  let begin: Any;
  try {
    begin = await rpcAs(auth, apikey, "summary_begin", { p_class: cls, p_week: week, p_chars: chars || JSON.stringify(cur).length });
  } catch (e) {
    return json({ ok: false, reason: "auth", message: String((e as Error).message || e) }, cors, 403);
  }
  if (!begin?.ok) return json({ ok: false, reason: "cap", message: `이번 달 AI 상한(${begin?.cap}회)을 모두 썼습니다.`, used: begin?.used, cap: begin?.cap }, cors, 200);

  const tok = { in: 0, out: 0 };
  const finish = (ok: boolean, err = "") => {
    const cost = Math.round((tok.in * PRICE_IN + tok.out * PRICE_OUT) * 10000) / 10000;
    return rpcAs(auth, apikey, "review_note_usage", { p_usage: begin.usage_id, p_ok: ok, p_model: MODEL, p_in: tok.in, p_out: tok.out, p_cost: cost, p_error: err }).catch(() => null);
  };
  const add = (res: Any) => { tok.in += Number(res?.usage?.input_tokens) || 0; tok.out += Number(res?.usage?.output_tokens) || 0; };
  const stopped = (res: Any) => res?.stop_reason === "refusal" ? "Claude 가 이 자막의 복습 노트를 거절했습니다. 직접 적어 주세요." : res?.stop_reason === "max_tokens" ? "복습 노트가 중간에 끊겼습니다. 다시 한 번 눌러 주세요." : "";

  try {
    const client = new Anthropic({ apiKey: key, timeout: 140_000, maxRetries: 1 });
    const tb = op === "polish" ? "" : transcriptBlock(mode, n, texts);

    if (op === "make") {
      const { res, parsed } = await callJson(client, REVIEW_SYSTEM + alwaysText, tb + `\n\n위 수업으로 복습 노트를 만들어라. lessons 에 ${n}개(no 는 1부터), quiz 에 4~6문항, 확인이 필요한 점은 note 에 짧게 (없으면 빈 문자열).`, NOTE_SCHEMA);
      add(res);
      const stop = stopped(res);
      if (stop) { await finish(false, String(res?.stop_reason)); return json({ ok: false, reason: "claude", message: stop }, cors, 200); }
      const lessons = (parsed?.lessons ?? []).slice().sort((a: Any, b: Any) => (Number(a?.no) || 0) - (Number(b?.no) || 0)).slice(0, 6).map(cleanLesson);
      if (!lessons.length) { await finish(false, "empty"); return json({ ok: false, reason: "claude", message: "복습 노트를 받지 못했습니다. 다시 한 번 눌러 주세요." }, cors, 200); }
      const quiz = await checkQuiz(client, parsed?.quiz ?? [], lessons, tok);
      const draft = { v: 1, lessons, quiz, quizNone: quiz.length < 4, quizOff: false };
      const saved = await rpcAs(auth, apikey, "review_note_draft", { p_class: cls, p_week: week, p_draft: draft, p_note: String(parsed?.note ?? "").slice(0, 500), p_model: MODEL });
      await finish(true);
      return json({ ok: true, note: saved?.note, used: begin.used, cap: begin.cap }, cors, 200);
    }
    if (op === "field") {
      const { res, parsed } = await callJson(client, REVIEW_SYSTEM, tb + `\n\n${lessonNo}차시의 「${FIELD_LABEL[field]}」(${field}) 칸만 새로 써라. lessons 에 ${lessonNo}차시 하나만 담고, 다른 칸은 빈 문자열 · 빈 배열로 둔다. quiz 는 빈 배열, note 는 빈 문자열.`, NOTE_SCHEMA);
      add(res);
      const stop = stopped(res);
      if (stop) { await finish(false, String(res?.stop_reason)); return json({ ok: false, reason: "claude", message: stop }, cors, 200); }
      const l: Any = cleanLesson((parsed?.lessons ?? [])[0] ?? {}, lessonNo - 1);
      await finish(true);
      return json({ ok: true, lesson: lessonNo, field, value: l[field], unsure: l.unsure.includes(field) }, cors, 200);
    }
    if (op === "quiz") {
      const base = Array.isArray(cur?.lessons) ? cur.lessons.map(cleanLesson) : [];
      const { res, parsed } = await callJson(client, REVIEW_SYSTEM, tb + `\n\nOX 퀴즈만 새로 4~6문항 만들어 quiz 에 담아라.`, QUIZ_SCHEMA, 6000);
      add(res);
      const quiz = await checkQuiz(client, parsed?.quiz ?? [], base, tok);
      await finish(true);
      return json({ ok: true, quiz, quizNone: quiz.length < 4 }, cors, 200);
    }
    /* polish — 자막 없이 지금 노트의 말만 다듬는다 */
    const base = cur.lessons.slice(0, 6).map(cleanLesson);
    const howTo = request
      ? "\n\n지금은 선생님 요청대로 고친다 (처음부터 새로 쓰지 않는다): 요청에 없는 칸 · 문장은 그대로 둔다. 손으로 고친 표현은 살린다. 자막에 없는 새 사실을 더하지 않는다. 빈 칸은 빈 채로 둔다. OX 정답은 바꾸지 않는다." + alwaysText + "\n\n<request>\n" + request + "\n</request>"
      : "\n\n지금은 다듬기만 한다: 맞춤법 · 띄어쓰기 · 어색한 말만 고친다. 내용 · 항목을 더하거나 빼지 않는다. 빈 칸은 빈 채로 둔다. 선생님 표현은 살린다. OX 문항 수와 정답은 바꾸지 않는다." + alwaysText;
    const { res, parsed } = await callJson(client, REVIEW_SYSTEM + howTo,
      `<note>\n${JSON.stringify({ lessons: base, quiz: Array.isArray(cur.quiz) ? cur.quiz.map((q: Any) => ({ q: q.q, a: q.a, why: q.why, from: "actions" })) : [] })}\n</note>\n\n이 노트를 ${request ? "요청대로 고쳐" : "다듬어"} 같은 모양으로 돌려줘라. note 는 빈 문자열.`, NOTE_SCHEMA);
    add(res);
    const stop = stopped(res);
    if (stop) { await finish(false, String(res?.stop_reason)); return json({ ok: false, reason: "claude", message: stop }, cors, 200); }
    const lessons = (parsed?.lessons ?? []).slice(0, 6).map(cleanLesson);
    const names = passageNames(lessons);
    const quiz = cleanQuiz((parsed?.quiz ?? []).filter((q: Any) => quizLocalOk({ ...q, from: "actions" }, names))).map(({ q, a, why }) => ({ q, a, why }));
    await finish(true);
    return json({ ok: true, lessons, quiz }, cors, 200);
  } catch (e) {
    let msg = "AI 서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.";
    if (e instanceof Anthropic.AuthenticationError) msg = "Claude 키가 맞지 않습니다. Supabase Secrets 의 ANTHROPIC_API_KEY 를 확인해 주세요.";
    else if (e instanceof Anthropic.RateLimitError) msg = "요청이 많거나 크레딧/월 한도에 걸렸습니다. Anthropic Console 을 확인해 주세요.";
    else if (e instanceof Anthropic.APIError) msg = `AI 서버 오류 (${(e as Any).status}). 잠시 뒤 다시 해 주세요.`;
    await finish(false, msg);
    return json({ ok: false, reason: "claude", message: msg }, cors, 200);
  }
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
