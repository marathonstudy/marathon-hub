// ============================================================
//  note-remind — 수업 끝나기 몇 분 전 필기 알림 문자 (migration-049 · 050) · 수업 시작 몇 시간 전 예고 문자 (migration-056 · 20261101j)
//
//  두 가지로 부른다
//    1) 매분 자동 (migration-050 의 pg_cron) — 헤더 x-cron-key (DB 에만 있는 값 · note_cron_ok 로 확인)
//       → note_remind_prepare: 지금 보낼 때가 된 반(필기 알림 켬 · 오늘 수업 · 끝 시각 - n분 ~ 끝 시각 뒤 10분)
//         학생 = 그날 필기를 안 낸 · 결석 아닌 · 번호 있는 학생 본인(학부모에게는 안 보냄)
//         운영진 = 그 반 담당 운영진(비어 있으면 사용 중인 운영진 전체 · 사용 중지 제외)
//         같은 날 같은 사람에게는 한 번만 (DB 가 막는다)
//    2) 코치룸 「지금 다시 보내기」 — { action: "now", class } · 로그인한 운영진 토큰으로 note_manual_prepare (그 반 안 낸 학생만)
//  수업 전 예고 — 같은 매분 실행에서 pre_remind_due → 앱 기록으로 밀린 과제 → pre_remind_prepare (학생 본인 · 같은 날 한 번 · 아래 preRemind)
//  보낸 기록 — 문자 발송 → 보낸 기록에 「필기 알림(학생)」 「필기 알림(운영진)」 「수업 전 예고」 (번호는 뒤 4자리만)
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
async function sendRows(rows: Any[], record = "note_remind_record") {
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
  await rpc(record, { p_results: results }).catch(() => {});
  const sent = results.filter((x) => x.ok).length;
  return { sent, failed: results.length - sent };
}

/* ============================================================
   수업 전 예고 (migration-056 · 20261101j) — 같은 매분 실행에서 함께 본다
     pre_remind_due → 학생마다 앱 기록(marathonstudy.com 공유 리포트)을 받아 제출 수 · 전체 수 · 밀린 날을 센다 → pre_remind_prepare(구간 문구 · 058) → 솔라피 → pre_remind_record
     밀린 과제 = 직전 수업 이후(오늘 수업이면 지난 7일 · D-7 ~ D-1) 마감이 지난 평일 과제 중 「안 냄」
       코치룸 「오늘」 칩과 같은 규칙 (assets/app-week.js — 과제 날짜 맞추기 · 과제 수정값 · 수강 시작일 · 토 · 일 안 셈 · 면제 안 셈)
     앱 링크가 없거나 앱 기록을 못 받은 학생은 판단할 수 없어 이번 분에는 보내지 않는다 (시작 전까지 매분 다시 본다)
   ============================================================ */
const APP_API = "https://marathonstudy.com/api/share/report/";
const DOWK = ["일", "월", "화", "수", "목", "금", "토"];
const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dowOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const isWeekend = (iso: string) => { const w = dowOf(iso); return w === 0 || w === 6; };
function kstDay(v: unknown): string {
  const x = String(v || "");
  if (/T/.test(x) && /(Z|[+-]\d\d:?\d\d)$/i.test(x)) { const t = Date.parse(x); if (!isNaN(t)) return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
  return x.slice(0, 10);
}
const TITLE_DATE = /(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:\(\s*[월화수목금토일]\s*\))?/;
function titleDate(title: unknown, ref: string): string {
  const m = TITLE_DATE.exec(String(title || ""));
  if (!m) return "";
  const mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  let y = +(String(ref || "").slice(0, 4)) || new Date().getUTCFullYear();
  const rm = +(String(ref || "").slice(5, 7)) || mo;
  if (mo - rm > 6) y--; else if (rm - mo > 6) y++;
  const iso = y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  return isoOk(iso) ? iso : "";
}
function lateOf(h: Any, date: string): boolean {
  if (h && h.late) return true;
  const sub = kstDay(h && h.submittedAt);
  return isoOk(sub) && isoOk(date) && sub > addDays(date, 1);
}
/* 앱 응답 → 달력 · 과제 기록 (app-report 의 pick 과 같은 모양) */
function appData(src: Any) {
  const cal = Array.isArray(src?.calendarData) ? src.calendarData : [];
  const hist = Array.isArray(src?.homeworkHistory) ? src.homeworkHistory : [];
  return {
    calendar: cal.filter((c: Any) => isoOk(String(c?.date ?? ""))).map((c: Any) => ({
      date: String(c.date), order: Number(c.lectureOrder) || 0, status: ["onTime", "late", "none"].includes(c.status) ? c.status : "none",
    })),
    history: hist.map((h: Any) => ({ title: String(h?.title ?? ""), order: Number(h?.lectureOrder) || 0, submittedAt: String(h?.submittedAt ?? ""), late: !!h?.isLate })),
  };
}
/* 과제 수 — 과제 수정값을 덮고(withFix) · 과제 날짜를 맞춘(normalize) 달력에서 from ~ to 의 평일 (20261101l · migration-058)
   total = 과제가 있던 평일(면제 · 수강 시작 전 제외) · done = 낸 날(늦게 낸 것 포함) · miss = 안 낸 날(오래된 날 먼저)
   to 는 어제까지 — 오늘 과제는 마감 전이라 넣지 않는다 · 토 · 일(주중 복습)은 세지 않는다 */
export function hwCount(data: Any, fix: Record<string, string>, startOn: string, from: string, to: string): { done: number; total: number; miss: string[] } {
  const OK: Record<string, number> = { onTime: 1, late: 1, none: 1, exempt: 1 };
  const cal: Any[] = (data?.calendar || []).map((c: Any) => fix && OK[fix[c.date]] ? { ...c, status: fix[c.date], fixed: 1 } : c);
  Object.keys(fix || {}).forEach((k) => { if (isoOk(k) && OK[fix[k]] && !cal.some((c) => c.date === k)) cal.push({ date: k, order: 0, status: fix[k], fixed: 1 }); });
  const byOrder: Record<number, string> = {};
  cal.forEach((c) => { if (c.order && isoOk(c.date)) byOrder[c.order] = c.date; });
  const groups: Record<string, Any[]> = {};
  (data?.history || []).forEach((h: Any) => {
    if (!h || !h.submittedAt) return;
    let date = "";
    if (h.order && byOrder[h.order]) date = byOrder[h.order];
    else date = titleDate(h.title, kstDay(h.submittedAt));
    if (isoOk(date)) (groups[date] = groups[date] || []).push(h);
  });
  const by: Record<string, string> = {};
  cal.forEach((c) => {
    const g = groups[c.date];
    let st = c.status;
    if (g && !c.fixed && !isWeekend(c.date) && (c.status === "none" || c.status === "onTime")) {
      const s2 = g.every((h) => lateOf(h, c.date)) ? "late" : "onTime";
      st = c.status === "onTime" && s2 === "onTime" ? "onTime" : s2;
    }
    by[c.date] = st;
  });
  Object.keys(groups).forEach((d) => { if (!(d in by) && !isWeekend(d)) by[d] = "onTime"; });
  const out = { done: 0, total: 0, miss: [] as string[] };
  for (let d = from, k = 0; d <= to && k < 31; d = addDays(d, 1), k++) {
    if (isWeekend(d) || (startOn && d < startOn)) continue;
    const st = by[d];
    if (st === "none") { out.total++; out.miss.push(d); }
    else if (st === "onTime" || st === "late") { out.total++; out.done++; }
  }
  return out;
}
export function missDays(data: Any, fix: Record<string, string>, startOn: string, from: string, to: string): string[] {
  return hwCount(data, fix, startOn, from, to).miss;
}
const mdw = (iso: string) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}(${DOWK[dowOf(iso)]})`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/* 앱 서버가 바쁘거나 응답이 없으면 0.7초 · 1.8초 쉬었다가 2번까지 다시 (app-report 와 같다) */
async function fetchApp(share: string): Promise<Any> {
  for (let k = 0; k < 3; k++) {
    if (k) await sleep(k === 1 ? 700 : 1800);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(APP_API + encodeURIComponent(share), { headers: { "Accept": "application/json" }, signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return appData(await r.json());
      if (r.status !== 429 && r.status < 500) return null;
    } catch { /* 다시 */ }
  }
  return null;
}
async function preRemind(now: string) {
  const due: Any = await rpc("pre_remind_due", { p_now: now });
  const day = String(due?.day || "");
  const items: Any[] = [];
  let unknown = 0;
  for (const c of due?.classes || []) {
    const list: Any[] = c.students || [];
    for (let i = 0; i < list.length; i += 3) {             /* 앱 서버에는 3명씩만 동시에 */
      await Promise.all(list.slice(i, i + 3).map(async (s: Any) => {
        const data = s.share && /^[A-Za-z0-9_-]{8,128}$/.test(s.share) ? await fetchApp(s.share) : null;
        if (!data) { unknown++; return; }
        const n = hwCount(data, s.fix || {}, s.startOn || "", addDays(day, -7), addDays(day, -1));
        items.push({ id: s.id, done: n.done, total: n.total, miss: n.miss.map(mdw).join(" ") });
      }));
    }
  }
  if (!items.length) return { rows: 0, sent: 0, failed: 0, unknown };
  const prep: Any = await rpc("pre_remind_prepare", { p_now: now, p_items: items });
  const rows: Any[] = prep?.rows || [];
  const r = await sendRows(rows, "pre_remind_record");
  return { rows: rows.length, ...r, unknown };
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
    /* 수업 전 예고 — 056 을 아직 안 돌렸거나 오류가 나도 필기 문자는 그대로 */
    let pre: Any = null;
    try { pre = await preRemind(now); } catch (e) { pre = { error: String((e as Error).message || e).slice(0, 160) }; }
    return json({ ok: true, day: prep?.day, rows: rows.length, ...r, pre }, cors);
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
