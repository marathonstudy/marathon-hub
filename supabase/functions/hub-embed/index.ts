// ============================================================
//  hub-embed — 마라톤 앱 안 「내 러닝노트」 (앱 모드 · 20261127a · migration-133)
//
//  앱 서버가 만든 서명 링크만 받는다. 로그인 없음 · 학생 1명 값만.
//    서명 t = "v1.<앱 학생번호>.<만료 유닉스초>.<서명>"
//      서명 = base64url( HMAC-SHA256( HUB_EMBED_SECRET, "v1.<앱 학생번호>.<만료 유닉스초>" ) )
//      만료는 만든 때부터 10분 안 (지금보다 뒤 · 지금 + 11분보다 앞). 서명에 들어가는 것은 앱 학생번호 + 만료 시각뿐
//    비밀값 HUB_EMBED_SECRET 은 Supabase Secrets 에만 (앱은 Replit Secrets 에 같은 값). 이 파일 · 응답 · 로그에 값을 남기지 않는다
//
//  POST { do: "open", t }  ← 러닝노트 페이지(/me/?e=서명)가 부른다
//    → { ok: true, code }                      (그 학생의 학생 링크 코드 — 러닝노트가 지금처럼 이 코드로 연다)
//    → { ok: false, reason: "paused" }         스위치 꺼짐 · 보여 줄 대상 아님 → 「잠시 쉬는 중」
//    → { ok: false, reason: "expired" | "bad" } 만료 · 위조 → 「앱에서 다시 열어 주세요」
//    → { ok: false, reason: "nolink" | "fail" }
//  POST { do: "card", t }  ← 앱 서버가 홈 요약 카드용으로 부른다 (3초 안에 안 오면 앱은 카드를 그리지 않는다)
//    → { ok: true, show: true, streak, level: { n, name }, week: { done, total } | null, isNew, newWhy, kinds: [...] }
//    → { ok: true, show: false }               스위치 꺼짐 · 대상 아님 · 연결 없음 = 「숨김」
//    → { ok: false, show: false, reason }      만료 · 위조 · 값 실패
//    넘기지 않는 것: 이름 · 전화번호 · 금액 · 환급 기준 % · 순위 · 비교 · AI 근거 · AI 피드백 · 얼굴 사진
//  오류 기록(app_note_log): 위조(bad) · 만료(expired) · 값 실패(fail) · 느린 응답(slow · 2.5초 넘음) · 연결 없음(nolink) — 시각 · 횟수만
//
//  배포: Edge Functions → Deploy a new function → Via Editor → 이름 hub-embed → 이 파일 전체 → Verify JWT 끄기
//        (앱 · 러닝노트 링크는 Supabase 로그인이 없다 · 대신 이 함수가 서명을 확인한다)
//        Secrets 에 HUB_EMBED_SECRET (32자 이상 무작위) — 없으면 모든 요청을 「bad」로 막는다
// ============================================================

const ALLOWED_ORIGINS = ["https://marathonstudy.github.io"];
const MAX_AHEAD_SEC = 660;          // 10분 + 시계 차이 1분
const SLOW_MS = 2500;

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
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
// deno-lint-ignore no-explicit-any
type Any = any;
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

async function rpc(name: string, args: Record<string, unknown>): Promise<Any> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("rpc " + name + " " + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function logKind(kind: string) {
  try { await rpc("app_embed_log", { p_kind: kind }); } catch (_) { /* 기록 실패는 응답에 영향 없음 */ }
}

/* ---------- 서명 확인 ---------- */
function b64url(buf: ArrayBuffer): string {
  let s = "";
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/* → { uid } | { err: "bad" | "expired" } */
async function verify(t: unknown, nowSec: number): Promise<{ uid?: number; err?: string }> {
  const secret = env("HUB_EMBED_SECRET");
  const m = /^v1\.([0-9]{1,18})\.([0-9]{9,11})\.([A-Za-z0-9_-]{40,90})$/.exec(String(t ?? ""));
  if (!secret || secret.length < 16 || !m) return { err: "bad" };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1.${m[1]}.${m[2]}`)));
  if (!sameText(want, m[3])) return { err: "bad" };
  const exp = Number(m[2]);
  if (exp < nowSec) return { err: "expired" };
  if (exp > nowSec + MAX_AHEAD_SEC) return { err: "bad" };     // 10분보다 긴 서명은 받지 않는다
  return { uid: Number(m[1]) };
}

// ---- CARD-CALC START (assets/game.js compute · quest · assets/app-week.js normalize · withFix 와 같은 규칙 — 시험이 두 쪽을 맞춰 본다)
const RULES = { hw: 10, late: 10, perfect: 30, streakEvery: 5, streakBonus: 20 };
const LEVELS = [["warmup", "워밍업", 0], ["jog", "조깅", 100], ["pace", "페이스러너", 250], ["10k", "10K", 450], ["half", "하프", 700], ["full", "풀코스", 1100], ["marathoner", "마라토너", 1600]];
function valid(iso: Any) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || "")); }
function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(iso: string) { return new Date(String(iso).slice(0, 10) + "T00:00:00Z").getUTCDay(); }
function weekend(iso: string) { const w = dow(iso); return w === 0 || w === 6; }
function monday(iso: string) { return addDays(iso, -((dow(iso) + 6) % 7)); }
function kstDay(v: Any) {
  const x = String(v || "");
  if (/T/.test(x) && /(Z|[+-]\d\d:?\d\d)$/i.test(x)) { const t = Date.parse(x); if (!isNaN(t)) return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
  return x.slice(0, 10);
}
const TITLE_DATE = /(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:\(\s*[월화수목금토일]\s*\))?/;
function titleDate(title: Any, ref: Any) {
  const m = TITLE_DATE.exec(String(title || ""));
  if (!m) return "";
  const mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  let y = +(String(ref || "").slice(0, 4)) || new Date().getUTCFullYear();
  const rm = +(String(ref || "").slice(5, 7)) || mo;
  if (mo - rm > 6) y--; else if (rm - mo > 6) y++;
  const iso = y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  return valid(iso) ? iso : "";
}
function hwDateOf(h: Any, byOrder: Any) {
  if (h && h.order && byOrder && byOrder[h.order]) return { date: byOrder[h.order], how: "order" };
  const sub = kstDay(h && h.submittedAt), td = titleDate(h && h.title, sub);
  if (td) return { date: td, how: "title" };
  return { date: valid(sub) ? sub : "", how: "sub" };
}
function lateOf(h: Any, date: string) {
  if (h && h.late) return true;
  const sub = kstDay(h && h.submittedAt);
  return !!(valid(sub) && valid(date) && sub > addDays(date, 1));
}
function normalize(data: Any) {
  if (!data || data._norm || !(data.history || data.recent)) return data;
  const byOrder: Any = {}, groups: Any = {};
  (data.calendar || []).forEach((c: Any) => { if (c && c.order && valid(c.date)) byOrder[c.order] = c.date; });
  (data.history || data.recent || []).forEach((h: Any) => {
    if (!h || !h.submittedAt) return;
    const d = hwDateOf(h, byOrder);
    if (!valid(d.date) || d.how === "sub") return;
    (groups[d.date] = groups[d.date] || []).push(h);
  });
  const cal = (data.calendar || []).map((c: Any) => {
    const g = c && groups[c.date];
    if (!g || c.fixed || weekend(c.date)) return c;
    const st = g.every((h: Any) => lateOf(h, c.date)) ? "late" : "onTime";
    if (c.status === st) return c;
    if (c.status === "onTime" && st === "onTime") return c;
    return { ...c, status: c.status === "none" || c.status === "onTime" ? st : c.status };
  });
  const have: Any = {};
  cal.forEach((c: Any) => { if (c) have[c.date] = 1; });
  Object.keys(groups).forEach((d) => {
    if (have[d] || weekend(d)) return;
    const g = groups[d];
    cal.push({ date: d, order: g[0].order || 0, status: g.every((h: Any) => lateOf(h, d)) ? "late" : "onTime", fromHistory: true });
  });
  return { ...data, calendar: cal, _norm: true };
}
const FIX_OK: Any = { onTime: 1, late: 1, none: 1, exempt: 1 };
function withFix(data: Any, fix: Any) {
  if (!data || !fix || typeof fix !== "object") return data;
  const keys = Object.keys(fix).filter((k) => valid(k) && FIX_OK[fix[k]]);
  if (!keys.length) return data;
  const seen: Any = {};
  const calendar = (data.calendar || []).map((c: Any) => {
    if (!c || !fix[c.date] || !FIX_OK[fix[c.date]]) return c;
    seen[c.date] = 1;
    return { ...c, status: fix[c.date], fixed: 1 };
  });
  keys.forEach((k) => { if (!seen[k]) calendar.push({ date: k, order: 0, status: fix[k], fixed: 1 }); });
  return { ...data, calendar };
}
function hwDays(data: Any, today: string) {
  if (!data) return [];
  data = normalize(data);
  const start = valid(data.startOn) ? data.startOn : "", seen: Any = {}, out: Any[] = [];
  (data.calendar || []).forEach((c: Any) => {
    if (!c || !valid(c.date) || seen[c.date]) return;
    seen[c.date] = 1;
    if (weekend(c.date) || c.status === "exempt" || (start && c.date < start) || (today && c.date > today)) return;
    const done = c.status === "onTime" || c.status === "late";
    if (today && c.date === today && !done) return;
    out.push({ date: c.date, done, late: c.status === "late" });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
function levelOf(xp: number) {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= (LEVELS[k][2] as number)) i = k;
  return { i, name: LEVELS[i][1] as string };
}
function quest(data: Any, period: Any, today: string) {
  if (!period || !valid(period.from) || !valid(period.to) || period.to < period.from) return null;
  if (data) data = normalize(data);
  const cal: Any = {}, start = data && valid(data.startOn) ? data.startOn : "";
  ((data && data.calendar) || []).forEach((c: Any) => { if (c && valid(c.date)) cal[c.date] = c; });
  let done = 0, m = 0;
  for (let d = period.from, k = 0; d <= period.to && k < 15; d = addDays(d, 1), k++) {
    if (weekend(d)) continue;
    const c = cal[d];
    let st;
    if (start && d < start) st = "off";
    else if (today && d > today) st = c && c.status === "exempt" ? "exempt" : "future";
    else if (!c) st = d === today ? "future" : "off";
    else if (c.status === "exempt") st = "exempt";
    else if (c.status === "onTime" || c.status === "late") st = "done";
    else st = d === today ? "today" : "todo";
    if (st === "done") { done++; m++; } else if (st === "todo" || st === "today" || st === "future") m++;
  }
  return { from: period.from, to: period.to, done, m, perfect: m > 0 && done === m };
}
/* 러닝노트 홈과 같은 셈 (수업일 기준 기간 bounds 는 비움 = 월~일 주 · 온라인 반은 러닝노트도 같다) */
function compute(data: Any, today: string, period: Any) {
  const days = hwDays(data, today);
  let total = 0, run = 0, bonus = 0;
  days.forEach((d: Any) => {
    if (d.done) { total++; run++; if (run % RULES.streakEvery === 0) bonus += RULES.streakBonus; } else run = 0;
  });
  const per: Any = {};
  days.forEach((d: Any) => { const s = monday(d.date); (per[s] = per[s] || { n: 0, done: 0 }); per[s].n++; if (d.done) per[s].done++; });
  let perfect = 0; const list: string[] = [];
  Object.keys(per).forEach((s) => { const p = per[s]; if (p.n > 0 && p.done === p.n && (!today || addDays(s, 6) < today)) { perfect++; list.push(s); } });
  const q = period ? quest(data, period, today) : null;
  if (q && q.perfect && list.indexOf(period.from) === -1) perfect++;
  const lateN = days.filter((d: Any) => d.done && d.late).length;
  const xp = (total - lateN) * RULES.hw + lateN * RULES.late + perfect * RULES.perfect + bonus;
  return { xp, total, streak: run, perfect, level: levelOf(xp), quest: q };
}
/* src = app_embed_card 결과 → 앱 카드 값 */
function cardCalc(src: Any) {
  const today = valid(src.today) ? src.today : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const mon = monday(today), period = { from: mon, to: addDays(mon, 6) };
  let data = src.data && typeof src.data === "object" ? withFix(src.data, src.fix) : null;
  if (data && valid(src.start) && !data.startOn) data = { ...data, startOn: src.start };
  const g = compute(data || { calendar: [] }, today, period);
  const q = data ? g.quest : null;
  const kinds: string[] = [], why: string[] = [];
  if (src.new_report) { kinds.push("report"); why.push("새 레포트가 올라왔어요"); }
  if (q && q.perfect && String(src.seen_perfect || "") < q.from) { kinds.push("badge"); why.push("새 주간 배지"); }
  else if (src.new_award) { kinds.push("badge"); why.push("새 월간 배지"); }
  if (data && g.level.i > (Number(src.seen_level) || 0)) { kinds.push("levelup"); why.push("레벨 업! " + g.level.name); }
  return {
    streak: g.streak,
    level: { n: g.level.i + 1, name: g.level.name },
    week: q && q.m ? { done: q.done, total: q.m } : null,
    isNew: kinds.length > 0, newWhy: why.join(" · "), kinds,
  };
}
// ---- CARD-CALC END

Deno.serve(async (req) => {
  const t0 = Date.now();
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, cors, 405);
  let body: Any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const what = body && body.do === "card" ? "card" : body && body.do === "open" ? "open" : "";
  if (!what) return json({ ok: false, reason: "bad" }, cors, 400);

  const done = async (res: Response) => { if (Date.now() - t0 > SLOW_MS) await logKind("slow"); return res; };
  const v = await verify(body.t, Math.floor(Date.now() / 1000));
  if (v.err) {
    await logKind(v.err);
    return done(json(what === "card" ? { ok: false, show: false, reason: v.err } : { ok: false, reason: v.err }, cors, 401));
  }
  try {
    if (what === "open") {
      const r = await rpc("app_embed_open", { p_uid: v.uid });
      const st = r && r.state;
      if (st === "ok" && r.code) return done(json({ ok: true, code: r.code }, cors));
      if (st === "off" || st === "notarget") return done(json({ ok: false, reason: "paused" }, cors));
      await logKind("nolink");
      return done(json({ ok: false, reason: "nolink" }, cors));
    }
    const src = await rpc("app_embed_card", { p_uid: v.uid });
    const st = src && src.state;
    if (st !== "ok") { if (st === "nolink") await logKind("nolink"); return done(json({ ok: true, show: false }, cors)); }
    return done(json({ ok: true, show: true, ...cardCalc(src) }, cors));
  } catch (_) {
    await logKind("fail");
    return done(json(what === "card" ? { ok: false, show: false, reason: "fail" } : { ok: false, reason: "fail" }, cors, 500));
  }
});
