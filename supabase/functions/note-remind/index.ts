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
//  과제 현황 (migration-069 · 20261108a) — 같은 매분 실행에서 수업 20분 전 반마다 운영진에게 명단 한 통(넘치면 나눔)
//    hw_status_due → 과제 기록 저장본(app_records · 없으면 앱에서 직접)으로 학생마다 제출 수 · 전체 수 → hw_status_prepare → 솔라피 → hw_status_record
//    운영진만 받는다(학생 · 학부모 없음) · 사본 없음 · 「오늘」 [미리보기] { action: "hwstat", class, dry: true } · [지금 운영진에게 보내기] { action: "hwstat", class }
//
//  주간 퍼펙트 배지 (migration-075 · 20261108g) — 같은 매분 실행에서 수업 전 예고가 계산되는 시각에 반마다 한 번 hw_badge_due → 셈 → hw_badge_save
//    수업 전 예고 칭찬 문자 끝에 「⭐ 이번 주 퍼펙트 배지를 받았어요! (지금까지 n개)」 (pre_remind_prepare 가 붙인다)
//  사본 — 매분 copy_due → 묶음마다 1통 → 원장 시험 번호로 → copy_record (migration-064 · 20261106g).
//  레포트 업데이트 문자 (migration-073 · 20261108e) — 매분 report_upd_prepare: 이미 보낸 레포트가 마지막으로 바뀐 뒤 30분 조용하면
//    모아 한 통 (밤 10시 ~ 아침 8시는 8시 · 하루 두 번까지 · 반마다 끄기) → 받은 학생(학부모는 설정을 켰을 때만 · 일반 문자)
//    「업데이트 문자 지금 보내기」 { action: "rupd", week, class } — 로그인한 운영진 · 그 반 그 주 기다리는 것을 바로
//         모든 발송의 사본을 여기 한 곳에서 보낸다. 사본이 실패해도 원래 발송에는 영향이 없다. 064 전이면 조용히 넘어간다.
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

/* 바뀌지 않은 칸 — 보내기 직전 글에 {밀린날짜} · #{링크} 같은 칸이 남아 있으면 그 사람에게는 보내지 않는다 (20261101m)
   「바뀌지 않은 칸이 있어 보내지 않음: {밀린날짜}」로 실패 기록 */
const LEFT_RE = /#?\{[^{}\r\n]{1,20}\}/g;
export function leftOf(text: string): string[] {
  const out: string[] = [];
  (String(text || "").match(LEFT_RE) || []).forEach((m) => { if (!out.includes(m)) out.push(m); });
  return out;
}
export const leftMsg = (left: string[]) => "바뀌지 않은 칸이 있어 보내지 않음: " + left.join(" ");

/* rows → 솔라피 → 결과 기록 (바뀌지 않은 칸이 남은 줄은 보내지 않고 실패로 · 20261101m) */
async function sendRows(all: Any[], record = "note_remind_record", copy = true) {
  if (!all.length) return { sent: 0, failed: 0 };
  const blocked = all.filter((r) => leftOf(r.text).length);
  const rows = all.filter((r) => !leftOf(r.text).length);
  const from = env("SOLAPI_SENDER").replace(/\D/g, "");
  const results: Any[] = rows.map((r) => ({ log_id: r.log_id, ok: true, error: "", message_id: "" }));
  if (rows.length) try {
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
  blocked.forEach((r) => results.push({ log_id: r.log_id, ok: false, error: leftMsg(leftOf(r.text)), message_id: "" }));
  await rpc(record, { p_results: results }).catch(() => {});
  if (copy) await rpc("msg_copy_note", { p_rows: all.map((r) => ({ log_id: r.log_id, text: r.text, name: r.name })) }).catch(() => {});
  const sent = results.filter((x) => x.ok).length;
  return { sent, failed: results.length - sent, blocked: blocked.length };
}

/* 사본 — 보낼 때가 된 것을 한 번에 (모든 발송 · sms-send · kakao-send 포함) */
async function copyFlush(now: string) {
  const due: Any = await rpc("copy_due", { p_now: now });
  const list: Any[] = due?.messages || [];
  if (!list.length || !due?.to) return { copies: 0 };
  const from = env("SOLAPI_SENDER").replace(/\D/g, "");
  const results: Any[] = list.map((m) => ({ id: m.id, ok: true, error: "", message_id: "" }));
  try {
    const res = await fetch(SOLAPI, {
      method: "POST",
      headers: { Authorization: await solapiAuth(env("SOLAPI_API_KEY"), env("SOLAPI_API_SECRET")), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: list.map((m) => ({ to: String(due.to), from, text: String(m.text || ""), type: m.kind === "LMS" ? "LMS" : "SMS", customFields: { copy: String(m.id) } })),
        allowDuplicates: true, showMessageList: true,
      }),
    });
    const out: Any = await res.json().catch(() => null);
    if (!res.ok) {
      const why = (out && (out.errorMessage || out.message || out.errorCode)) || `솔라피 오류 (${res.status})`;
      results.forEach((x) => { x.ok = false; x.error = String(why).slice(0, 200); });
    } else {
      const failed = new Map<string, string>();
      (out?.failedMessageList || []).forEach((f: Any) => { const id = f?.customFields?.copy; if (id) failed.set(String(id), `${f.statusCode || ""} ${f.statusMessage || ""}`.trim() || "접수 실패"); });
      const ids = new Map<string, string>();
      (out?.messageList || []).forEach((m: Any) => { if (m?.customFields?.copy) ids.set(String(m.customFields.copy), String(m.messageId || "")); });
      results.forEach((x) => {
        if (failed.has(String(x.id))) { x.ok = false; x.error = failed.get(String(x.id)); }
        x.message_id = ids.get(String(x.id)) || "";
      });
    }
  } catch {
    results.forEach((x) => { x.ok = false; x.error = "솔라피에 연결하지 못했습니다."; });
  }
  await rpc("copy_record", { p_results: results }).catch((e) => console.error("copy_record", String((e as Error).message || e).slice(0, 160)));
  return { copies: list.length, copyFailed: results.filter((x) => !x.ok).length };
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
/* 같은 매분 실행 안에서는 한 학생을 한 번만 부른다 (퍼펙트 배지 · 수업 전 예고가 같은 분에 같은 학생을 셈 · 20261108g) */
let TICK: Map<string, Promise<Any>> | null = null;
function fetchApp(share: string): Promise<Any> {
  if (!TICK) return fetchApp0(share);
  if (!TICK.has(share)) TICK.set(share, fetchApp0(share));
  return TICK.get(share) as Promise<Any>;
}
async function fetchApp0(share: string): Promise<Any> {
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

/* ============================================================
   과제 현황 (migration-069 · 20261108a) — 수업 20분 전 운영진에게 그 반 학생 완료율 명단
     기간 · 셈은 수업 전 예고와 같다 (D-7 ~ D-1 · hwCount · 늦게 낸 것은 냄 · 면제 · 과제 수정값 · 수강 시작일)
     저장본(rec · app-sync 가 받아 둔 lite)이 있으면 그것으로 · 없으면 앱에서 직접 · 그래도 없으면 「앱 기록 없음」
   ============================================================ */
export async function hwItems(due: Any, fetcher: (share: string) => Promise<Any> = fetchApp, fresh = false): Promise<Record<string, Any[]>> {
  const day = String(due?.day || "");
  const out: Record<string, Any[]> = {};
  for (const c of due?.classes || []) {
    const list: Any[] = c.students || [];
    if (!list.length) continue;
    const items: Any[] = [];
    for (let i = 0; i < list.length; i += 3) {
      await Promise.all(list.slice(i, i + 3).map(async (s: Any) => {
        /* fresh — 앱에서 먼저(수업 전 예고와 같은 값) · 못 받으면 저장본 (퍼펙트 배지 · 075) */
        const saved: Any = s.rec && Array.isArray(s.rec.calendar) ? { calendar: s.rec.calendar, history: Array.isArray(s.rec.history) ? s.rec.history : [] } : null;
        const okShare = !!s.share && /^[A-Za-z0-9_-]{8,128}$/.test(s.share);
        let data: Any = fresh ? (okShare ? await fetcher(s.share) : null) || saved : saved;
        if (!data && !fresh && okShare) data = await fetcher(s.share);
        if (!data) { items.push({ id: s.id, known: false, done: 0, total: 0 }); return; }
        const n = hwCount(data, s.fix || {}, s.startOn || "", addDays(day, -7), addDays(day, -1));
        items.push({ id: s.id, known: true, done: n.done, total: n.total });
      }));
    }
    out[c.name] = items;
  }
  return out;
}
/* 주간 퍼펙트 배지 (075 · 20261108g) — 수업 전 예고가 계산되는 시각(시작 n시간 전 · 예고를 끈 반도)에 반마다 한 번
     셈은 과제 현황과 같다 (hwItems · 저장본 · 없으면 앱에서 직접) → hw_badge_save (모두 냈으면 그 주 배지 · 과제 0개는 없음) */
async function badgeRun(now: string) {
  const due: Any = await rpc("hw_badge_due", { p_now: now });
  const cls: Any[] = due?.classes || [];
  if (!cls.length) return { classes: 0 };
  const items = await hwItems(due, fetchApp, true);
  for (const c of cls) if (!items[c.name]) items[c.name] = [];     /* 학생이 없는 반도 그날 셈한 것으로 */
  const r: Any = await rpc("hw_badge_save", { p_now: now, p_items: items });
  return { classes: cls.length, perfect: r?.perfect || 0 };
}
/* 레포트 업데이트 문자 (073) — 보낼 때가 된 것을 한 번에 */
async function reportUpd(now: string, week?: string, cls?: string, by?: string) {
  const prep: Any = await rpc("report_upd_prepare", week ? { p_now: now, p_site: SITE, p_week: week, p_class: cls || "", p_by: by || "" } : { p_now: now, p_site: SITE });
  const rows: Any[] = prep?.rows || [];
  const r = await sendRows(rows);
  return { reports: prep?.reports || 0, rows: rows.length, ...r };
}
async function hwStatus(now: string) {
  const due: Any = await rpc("hw_status_due", { p_now: now });
  if (!(due?.classes || []).length) return { rows: 0 };
  const items = await hwItems(due);
  if (!Object.keys(items).length) return { rows: 0 };
  const prep: Any = await rpc("hw_status_prepare", { p_now: now, p_items: items });
  const rows: Any[] = prep?.rows || [];
  const r = await sendRows(rows, "hw_status_record", false);
  return { rows: rows.length, ...r };
}
/* 로그인 토큰의 이메일 — 운영진 확인(is_staff)을 DB 가 토큰으로 한 뒤에만 쓴다 */
function jwtEmail(auth: string): string {
  try {
    const p = auth.replace(/^Bearer\s+/i, "").split(".")[1] || "";
    const j = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)));
    return String(j?.email || "").toLowerCase().slice(0, 200);
  } catch { return ""; }
}

async function handle(req: Request, cors: Record<string, string>) {
  TICK = null;
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
    TICK = new Map();
    const prep: Any = await rpc("note_remind_prepare", { p_now: now, p_site: SITE });
    const rows: Any[] = prep?.rows || [];
    const r = await sendRows(rows);
    /* 과제 현황 — 069 를 아직 안 돌렸거나 오류가 나도 다른 일은 그대로 */
    let hws: Any = null;
    try { hws = await hwStatus(now); } catch (e) { hws = { error: String((e as Error).message || e).slice(0, 160) }; }
    /* 주간 퍼펙트 배지 — 수업 전 예고보다 먼저 (같은 분에 칭찬 문자 끝 한 줄) · 075 전이면 조용히 넘어간다 */
    let badge: Any = null;
    try { badge = await badgeRun(now); } catch (e) { badge = { error: String((e as Error).message || e).slice(0, 160) }; }
    /* 수업 전 예고 — 056 을 아직 안 돌렸거나 오류가 나도 필기 문자는 그대로 */
    let pre: Any = null;
    try { pre = await preRemind(now); } catch (e) { pre = { error: String((e as Error).message || e).slice(0, 160) }; }
    /* 레포트 업데이트 — 073 을 아직 안 돌렸거나 오류가 나도 다른 일은 그대로 (사본보다 먼저 · 같은 분에 사본 묶음으로) */
    let rupd: Any = null;
    try { rupd = await reportUpd(now); } catch (e) { rupd = { error: String((e as Error).message || e).slice(0, 160) }; }
    /* 사본 — 064 를 아직 안 돌렸거나 오류가 나도 다른 일은 그대로 */
    let copy: Any = null;
    try { copy = await copyFlush(now); } catch (e) { copy = { error: String((e as Error).message || e).slice(0, 160) }; }
    return json({ ok: true, day: prep?.day, rows: rows.length, ...r, hws, badge, pre, rupd, copy }, cors);
  }

  /* 2) 「지금 다시 보내기」 — 로그인한 운영진 */
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (body.action !== "now" && body.action !== "hwstat" && body.action !== "rupd") return json({ ok: false, reason: "input" }, cors, 400);
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return json({ ok: false, reason: "login", message: "코치룸에 다시 로그인해 주세요." }, cors, 401);
  /* 레포트 업데이트 문자 [지금 보내기] — 운영진만 · 그 반 그 주 기다리는 것 (반 자동 발송을 꺼 둬도) */
  if (body.action === "rupd") {
    let staff = false;
    try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
    if (!staff) return json({ ok: false, reason: "auth", message: "운영진 계정으로 다시 로그인해 주세요." }, cors, 403);
    if (missing.length) return json({ ok: false, reason: "nokeys", missing, message: "문자 키가 아직 다 들어가지 않았습니다 (" + missing.join(", ") + ")." }, cors);
    const week = String(body.week ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ ok: false, reason: "input", message: "주를 골라 주세요." }, cors, 400);
    try {
      const r = await reportUpd(new Date().toISOString(), week, String(body.class ?? "").slice(0, 60), jwtEmail(auth));
      return json({ ok: true, ...r }, cors);
    } catch (e) {
      return json({ ok: false, reason: "nosql", message: "migration-073 SQL 을 먼저 실행해 주세요 — " + String((e as Error).message || e).slice(0, 120) }, cors);
    }
  }
  /* 과제 현황 [미리보기] · [지금 운영진에게 보내기] — 운영진만 · 그 반 · 오늘 수업이 있는 반 */
  if (body.action === "hwstat") {
    let staff = false;
    try { staff = (await rpc("is_staff", {}, auth, apikey)) === true; } catch { staff = false; }
    if (!staff) return json({ ok: false, reason: "auth", message: "운영진 계정으로 다시 로그인해 주세요." }, cors, 403);
    const dry = body.dry === true;
    if (!dry && missing.length) return json({ ok: false, reason: "nokeys", missing, message: "문자 키가 아직 다 들어가지 않았습니다 (" + missing.join(", ") + ")." }, cors);
    const now = new Date().toISOString();
    const cls = String(body.class ?? "").slice(0, 60);
    let one: Any;
    try { one = await rpc("hw_status_class", { p_now: now, p_class: cls }); } catch (e) {
      return json({ ok: false, reason: "nosql", message: "migration-069 SQL 을 먼저 실행해 주세요 — " + String((e as Error).message || e).slice(0, 120) }, cors);
    }
    if (!one?.ok) return json({ ok: false, reason: one?.reason || "class", message: one?.message || "보낼 수 없는 반입니다." }, cors);
    const items = await hwItems(one);
    if (!items[cls]) return json({ ok: false, reason: "empty", message: "이 반에 학생이 없습니다." }, cors);
    const prep: Any = await rpc("hw_status_prepare", { p_now: now, p_items: items, p_class: cls, p_by: jwtEmail(auth), p_dry: dry });
    if (dry) return json({ ok: true, preview: (prep?.previews || [])[0] || null }, cors);
    const rows: Any[] = prep?.rows || [];
    const r = await sendRows(rows, "hw_status_record", false);
    return json({ ok: true, rows: rows.length, ...r }, cors);
  }
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
