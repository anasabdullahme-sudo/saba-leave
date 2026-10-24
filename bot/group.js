// قروب «For information saba 1»: البوت يقرأ رسايل الاستقبال عن الأطباء (وقف، فاضي، غائب، متأخر…)
// ويحدّث صفحة أطباء البوادي + يطلع تنبيه في كروم. ما يكتب أي رد في القروب — بس ✅ على الرسالة اللي فهمها.
import { FieldValue } from "firebase-admin/firestore";

const GROUP_NAME = process.env.GROUP_NAME || "For information saba 1";
const TZ = "Asia/Riyadh";
const DAY = 864e5;

let db, log, getSock, gemini, models;
let groupJid = "";                       // نعرفه من اسم القروب أول مرة
const subjects = new Map();             // jid → اسم القروب (كاش)
let board = null, today = null;         // نسخ محلية (onSnapshot)

export function initGroup(opts) {
  ({ db, log, getSock, gemini, models } = opts);
  db.doc("board/bawadi").onSnapshot(d => { board = d.exists ? d.data() : null; }, e => log.warn({ e: String(e) }, "board"));
  db.doc("board/bawadi_today").onSnapshot(d => { today = d.exists ? d.data() : null; }, e => log.warn({ e: String(e) }, "today"));
  db.doc("bot/status").get().then(d => { groupJid = d.get("group")?.jid || ""; }).catch(() => {});
  setInterval(runScheduled, 30000);
}

/* ---------- أدوات ---------- */
const latin = s => String(s || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const norm = s => latin(s).toLowerCase()
  .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
  .replace(/[^\p{L}\p{N}\s:]/gu, " ").replace(/\s+/g, " ").trim();
const subjKey = s => norm(s).replace(/[^a-z0-9؀-ۿ]/g, "");
function nowR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, m: +p.hour * 60 + +p.minute, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday] };
}
const hm = m => { const h = Math.floor(m / 60) % 24, mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 ? "ص" : "م"}`; };
const toMin = s => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return x ? (+x[1] % 24) * 60 + +x[2] : null; };
const uid = () => Math.random().toString(36).slice(2, 10);
const docs = () => (board?.departments || []).flatMap(p => p.doctors.map(d => ({ ...d, dep: p.name, fl: d.floor || p.floor })));
const shortName = n => String(n || "").split(/\s*[–-]\s*/)[0].trim();
const deAl = t => t.length > 4 && t.startsWith("ال") ? t.slice(2) : t;
const STOP = new Set(["د", "دكتور", "دكتوره", "الدكتور", "الدكتوره", "دكتورة", "د.", "dr"]);

// مطابقة اسم مكتوب في الرسالة مع طبيب في الجدول
function matchDoctor(name, dept) {
  const toks = norm(name).split(" ").filter(t => t && !STOP.has(t)).map(deAl);
  const L = docs();
  if (toks.length) {
    const score = d => { const dn = norm(shortName(d.name)).split(" ").map(deAl); let s = 0; toks.forEach((t, i) => { if (dn.includes(t)) s += i === 0 ? 3 : 2; else if (dn.some(x => x.startsWith(t) && t.length >= 3)) s += 1; }); return s; };
    const ranked = L.map(d => [d, score(d)]).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] > ranked[1][1])) return ranked[0][0];
    if (ranked.length > 1 && dept) { const nd = norm(dept); const f = ranked.filter(x => norm(x[0].dep).includes(nd) || nd.includes(norm(x[0].dep))); if (f.length === 1) return f[0][0]; }
  }
  if (dept && !toks.length) { const nd = norm(dept); const f = L.filter(d => norm(d.dep).includes(nd) || nd.includes(norm(d.dep))); if (f.length === 1) return f[0]; }
  return null;
}

/* ---------- الفهم بالذكاء (Gemini) ---------- */
const KINDS = ["stop", "resume", "free", "appointments_only", "busy", "absent_today", "late", "leaves_at", "starts_at", "present", "vacation", "new_doctor", "moved", "schedule_change", "none"];
const PROMPT = `أنت تقرأ رسالة من قروب واتساب لموظفين استقبال عيادات سابا (فرع البوادي، جدة). الرسايل باللهجة السعودية/المصرية عن حالة الأطباء.
استخرج الأحداث عن الأطباء فقط. لكل حدث:
- doctor_id: من قائمة الأطباء تحت (لو متأكد)، وإلا "".
- name: اسم الطبيب كما كتب في الرسالة (بدون "د./دكتور").
- dept: التخصص إذا ذكر (مثل "أسنان أطفال"، "العيون").
- kind واحد من:
  stop = وقف استقبال/لا أحد يدخل له/خلاص (ولو فيه وقت مستقبلي "الساعة 9:45 وقف له" حط at_time)
  resume = رجع يستقبل/كمل
  free = فاضي/دخلوا له/حولوا له
  appointments_only = مواعيد فقط / انتظار فقط مواعيد
  busy = زحمة/عنده انتظار (waiting = العدد إذا ذكر)
  absent_today = غير متواجد اليوم / يعتذر عن الحضور اليوم (لا تكتب السبب الصحي أبداً)
  late = متأخر/بيتأخر (delay_minutes تقديرياً: ساعة=60، شوي=20) أو at_time وقت الوصول
  leaves_at = يمشي/يخلص دوامه الساعة X (at_time)
  starts_at = دوامه اليوم يبدأ/يجي من الساعة X (at_time)، ولو ذكر النهاية حط until_time
  present = موجود/متواجد (until_time لو "موجود إلى/لين X")
  vacation = إجازة بتواريخ (start_date, end_date بصيغة YYYY-MM-DD؛ "المباشرة السبت 31" يعني end_date = يوم 30)
  new_doctor = طبيب جديد بيباشر (start_date، room لو ذكرت)
  moved = انتقل لفرع ثاني (branch)
  schedule_change = تغيير دوام ثابت لأكثر من يوم
- الأوقات بصيغة 24 ساعة HH:MM. في العيادة الأرقام 1-11 بدون ص/م غالباً مساءً إلا لو واضح الصباح (مثل 8 صباحاً، 9 الصبح). "١٠" بالليل = 22:00.
- لو الرسالة رد (فيه رسالة مقتبسة) استخدم المقتبسة لتعرف الطبيب المقصود.
- رسالة بدون طبيب معيّن، أو تحية، أو نقطة "." → events فاضية.
اليوم: {TODAY} والساعة الآن {NOW} بتوقيت السعودية.
قائمة أطباء البوادي (id | الاسم | القسم):
{LIST}`;

async function aiParse(text, quoted) {
  if (!gemini) return null;
  const t = nowR();
  const list = docs().map(d => `${d.id} | ${shortName(d.name)} | ${d.dep}`).join("\n");
  const body = {
    systemInstruction: { parts: [{ text: PROMPT.replace("{TODAY}", `${t.iso} (${["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][t.wd]})`).replace("{NOW}", hm(t.m)).replace("{LIST}", list) }] },
    contents: [{ role: "user", parts: [{ text: (quoted ? `رسالة مقتبسة (اللي ردّ عليها): «${quoted}»\n` : "") + `الرسالة: «${text}»` }] }],
    generationConfig: {
      temperature: 0, maxOutputTokens: 800, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { events: { type: "ARRAY", items: { type: "OBJECT", properties: {
        doctor_id: { type: "STRING" }, name: { type: "STRING" }, dept: { type: "STRING" }, kind: { type: "STRING", enum: KINDS },
        at_time: { type: "STRING" }, until_time: { type: "STRING" }, delay_minutes: { type: "INTEGER" }, waiting: { type: "INTEGER" },
        start_date: { type: "STRING" }, end_date: { type: "STRING" }, room: { type: "STRING" }, branch: { type: "STRING" }, note: { type: "STRING" } },
        required: ["name", "kind"] } } }, required: ["events"] },
    },
  };
  for (const model of models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      clearTimeout(tm);
      if (!res.ok) { log.warn({ model, status: res.status }, "Gemini قروب"); continue; }
      const j = await res.json();
      return (JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}").events || []).filter(e => KINDS.includes(e.kind) && e.kind !== "none");
    } catch (e) { log.warn({ model, err: String(e?.message || e) }, "Gemini قروب"); }
  }
  return null;
}

// احتياط بدون Gemini: الأنواع الواضحة، سطر سطر (الاسم من السطر اللي قبله أو من الرسالة المقتبسة)
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
function fuzzyPick(s) {
  const L = docs();
  const w = norm(s).split(" ").filter(t => t.length >= 2 && !STOP.has(t)).flatMap(t => t.length > 3 && t.startsWith("ل") ? [t, t.slice(1)] : [t]);   // «لسحر» → سحر
  for (let i = 0; i < w.length - 1; i++) { const d = matchDoctor(w[i] + " " + w[i + 1]); if (d) return d; }
  for (const t of w) { if (t.length < 3) continue; const d = matchDoctor(t); if (d) return d; }
  for (const t of w) { if (t.length < 4) continue; const f = L.filter(d => deAl(norm(d.dep)) === deAl(t)); if (f.length === 1) return f[0]; }   // «دكتور العيون»
  for (const t of w) { if (t.length < 5) continue; const f = L.filter(d => norm(shortName(d.name)).split(" ").map(deAl).some(x => x.length >= 5 && lev1(x, deAl(t)))); if (f.length === 1) return f[0]; }   // «السجيدي» ≈ السنجيدي
  return null;
}
// إجازة بتواريخ (بدون Gemini): «اجازة من الان الى يوم 30»، «المباشرة السبت 31»، «من يوم السبت … اجازة لمدة اسبوع»
const WDN = { "الاحد": 0, "الاثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الخميس": 4, "الجمعه": 5, "السبت": 6 };
const isoAdd = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function dayToIso(day, fromIso) {                       // «يوم 30» → أقرب 30 جاي (هالشهر أو اللي بعده)
  const [y, m, d] = fromIso.split("-").map(Number);
  const dt = day >= d ? new Date(Date.UTC(y, m - 1, day)) : new Date(Date.UTC(y, m, day));
  return dt.toISOString().slice(0, 10);
}
function vacationRule(text) {
  const n = norm(text), t = nowR();
  if (!/اجاز/.test(n) || /كل يوم|كل اسبوع/.test(n)) return null;
  let start = t.iso;
  const sw = /من (?:يوم )?(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعه|السبت)/.exec(n);
  if (sw) { const w = WDN[sw[1]]; start = isoAdd(t.iso, (w - t.wd + 7) % 7); }
  else if (/بكره|بكرا|من الغد/.test(n)) start = isoAdd(t.iso, 1);
  let end = "";
  const to = /(?:الى|الي|لين|حتى) (?:يوم )?(\d{1,2})(?!\d|:)/.exec(n), back = /المباشره[^\d]{0,20}(\d{1,2})(?!\d)/.exec(n);
  if (to) end = dayToIso(+to[1], start);
  else if (back) end = isoAdd(dayToIso(+back[1], start), -1);
  else if (/اسبوعين/.test(n)) end = isoAdd(start, 13);
  else if (/اسبوع/.test(n)) end = isoAdd(start, 6);
  else { const dn = /لمده (\d+) (?:يوم|ايام)/.exec(n); if (dn) end = isoAdd(start, +dn[1] - 1); else if (/شهر/.test(n)) end = isoAdd(start, 29); }
  return end && end >= start ? { start_date: start, end_date: end } : null;
}
function ruleParse(text, quoted) {
  const vac = vacationRule(text);
  if (vac) { const d = fuzzyPick(text) || (quoted ? fuzzyPick(quoted) : null); return d ? [{ doctor_id: d.id, name: shortName(d.name), kind: "vacation", ...vac }] : Object.assign([], { unknown: true }); }
  const timeIn = n => { const m = /(\d{1,2})(?::(\d{2}))?/.exec(n); return m ? `${String(+m[1]).padStart(2, "0")}:${m[2] || "00"}` : ""; };
  const kindOf = n => /مواعيد فقط|فقط مواعيد/.test(n) ? "appointments_only"
    : /وقف|لحد يطلع|لا احد يدخل|محد يدخل|خلاص/.test(n) ? "stop"
    : /غير متواجد|ما بيجي|يعتذر عن الحضور|مو موجود اليوم/.test(n) ? "absent_today"
    : /انتظار/.test(n) ? "busy"
    : /رجع|كمل استقبال/.test(n) ? "resume"
    : /تاخر/.test(n) ? "late"
    : /يمشي|يخلص دوامه|يطلع الساعه/.test(n) ? "leaves_at"
    : /يجي من|يبدا من|دوامه من|دوام اليوم من/.test(n) ? "starts_at"
    : /فاضي|دخلوا|حولوا ل/.test(n) ? "free"
    : /موجود|متواجد|الين|لين/.test(n) ? "present" : "";
  const evs = []; let last = quoted ? fuzzyPick(quoted) : null, unknown = false;
  for (const line of String(text).split(/\n+/)) {
    const n = norm(line); if (!n || /^سابا ?1$/.test(n)) continue;
    const d = fuzzyPick(line) || null, kind = kindOf(n);
    if (d) last = d;
    if (!kind) continue;
    const who = d || last;
    if (!who) { unknown = true; continue; }
    const tm = timeIn(n), e = { doctor_id: who.id, name: shortName(who.name), kind };
    const rg = /(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/.exec(latin(line));          // «من ٤-١٠» = دوام اليوم من 4 إلى 10
    if (rg && (kind === "present" || kind === "starts_at")) { e.kind = "starts_at"; e.at_time = `${String(+rg[1]).padStart(2, "0")}:${rg[2] || "00"}`; e.until_time = `${String(+rg[3]).padStart(2, "0")}:${rg[4] || "00"}`; evs.push(e); continue; }
    if (kind === "late") e.delay_minutes = /ساعه/.test(n) ? 60 : 20;
    if (kind === "busy") e.waiting = +((/(\d+)\s*انتظار/.exec(n) || [])[1] || 0);
    if (["stop", "leaves_at", "starts_at"].includes(kind) && tm) e.at_time = tm;
    if (kind === "present" && tm) e.until_time = tm;
    evs.push(e);
  }
  return Object.assign(evs, { unknown });
}

/* ---------- تطبيق الأحداث ---------- */
const TITLES = {
  stop: ["⛔ وقف استقبال الحالات", "red"], resume: ["✅ رجع يستقبل الحالات", "green"], free: ["🟢 فاضي — دخّلوا له", "green"],
  appointments_only: ["📅 مواعيد فقط", "orange"], busy: ["⏳ زحمة", "orange"], absent_today: ["⛔ غير متواجد اليوم", "red"],
  late: ["🕐 متأخر", "orange"], leaves_at: ["🕐 يطلع بدري", "orange"], starts_at: ["🕐 دوام اليوم", "blue"], present: ["🟢 موجود", "green"],
  vacation: ["🏖 إجازة", "orange"],
};
function fresh(cur, iso) { return cur && cur.date === iso ? structuredClone(cur) : { date: iso, st: {}, extra: [], events: [], scheduled: [] }; }

async function apply(evs, ctx) {
  const t = nowR(), applied = [];
  const inbox = [], vacs = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi_today");
    const cur = fresh((await tx.get(ref)).data(), t.iso);
    for (const e of evs) {
      const d = (e.doctor_id && docs().find(x => x.id === e.doctor_id)) || matchDoctor(e.name, e.dept);
      if (e.kind === "new_doctor" && d) continue;                       // موجود أصلاً في الجدول
      if (["new_doctor", "moved", "schedule_change"].includes(e.kind)) { inbox.push({ id: uid(), at: Date.now(), kind: e.kind, name: e.name, dept: e.dept || "", room: e.room || "", branch: e.branch || "", date: e.start_date || "", doctorId: d?.id || "", text: ctx.text.slice(0, 300), by: ctx.by }); applied.push(e.kind); continue; }
      if (e.kind === "vacation") { if (d && e.start_date) { vacs.push({ d, e }); applied.push("vacation"); } continue; }
      const key = d ? d.id : "x:" + norm(e.name);
      if (!d && e.kind !== "present") continue;                         // طبيب مو في الجدول: نقبل بس «موجود» (مؤقت)
      // أوقات بدون ص/م: «٩:٤٥» الساعة 8 بالليل = 21:45، و«موجود إلى ١» = 1 بعد نص الليل
      const pm = m => (m != null && m < 720 && m < t.m - 30 && m + 720 > t.m - 30) ? m + 720 : m;
      const nextDay = m => (m != null && m < t.m - 30) ? m + 1440 : m;
      const at = Date.now(), atMin = pm(toMin(e.at_time)), untilMin = nextDay(pm(toMin(e.until_time)));
      const name = d ? shortName(d.name) : e.name, dep = d ? d.dep : (e.dept || "");
      let info = "";
      if (e.kind === "stop" && atMin != null && atMin > t.m + 1) {      // «الساعة 9:45 وقف له» → نجدوله
        cur.scheduled = cur.scheduled.filter(x => x.key !== key);         // رسالة مكررة → جدولة وحدة
        cur.scheduled.push({ id: uid(), min: atMin, key, kind: "stop", name, dep, by: ctx.by });
        cur.st[key] = { kind: "stop_at", from: atMin, at, by: ctx.by };
        cur.events.push({ id: uid(), at, kind: "stop_at", doctorId: d?.id || "", name, dep, info: `يوقف الساعة ${hm(atMin)}`, title: "🕐 بيوقف الاستقبال", color: "orange", by: ctx.by });
        applied.push("stop_at"); continue;
      }
      if (["resume", "absent_today", "stop"].includes(e.kind)) cur.scheduled = cur.scheduled.filter(x => x.key !== key);
      if (e.kind === "resume") delete cur.st[key];
      else if (e.kind === "late") { const from = atMin ?? (t.m + (e.delay_minutes || 30)); cur.st[key] = { kind: "late", from, at, by: ctx.by }; info = `يوصل تقريباً ${hm(from)}`; }
      else if (e.kind === "leaves_at") { cur.st[key] = { kind: "leaves", until: nextDay(atMin) ?? untilMin, at, by: ctx.by }; info = atMin != null ? `يطلع الساعة ${hm(atMin)}` : ""; }
      else if (e.kind === "starts_at") { cur.st[key] = { kind: "starts", from: atMin, until: untilMin, at, by: ctx.by }; info = atMin != null ? `اليوم من ${hm(atMin)}${untilMin != null ? " إلى " + hm(untilMin) : ""}` : ""; }
      else if (e.kind === "present") {
        cur.st[key] = { kind: "present", until: untilMin, at, by: ctx.by }; info = untilMin != null ? `موجود لين ${hm(untilMin)}` : "";
        if (!d && !cur.extra.some(x => x.key === key)) cur.extra.push({ key, name, dep, until: untilMin });
      }
      else if (e.kind === "busy") { cur.st[key] = { kind: "busy", count: e.waiting || 0, at, by: ctx.by }; info = e.waiting ? `${e.waiting} بالانتظار — بلّغوا اللي ما عندهم موعد` : ""; }
      else if (e.kind === "appointments_only") { cur.st[key] = { kind: "appt", at, by: ctx.by }; info = "لا تدخّلون حالات بدون موعد"; }
      else if (e.kind === "free") cur.st[key] = { kind: "free", at, by: ctx.by };
      else if (e.kind === "absent_today") cur.st[key] = { kind: "absent", at, by: ctx.by };
      else if (e.kind === "stop") cur.st[key] = { kind: "stop", at, by: ctx.by };
      const [title, color] = TITLES[e.kind] || ["ℹ️ تحديث", "blue"];
      cur.events.push({ id: uid(), at, kind: e.kind, doctorId: d?.id || "", name, dep, room: d?.room || "", ext: d?.ext || "", info, title, color, by: ctx.by });
      applied.push(e.kind);
    }
    cur.events = cur.events.slice(-40);
    if (applied.length) tx.set(ref, cur);
  });
  // إجازات بتواريخ → الجدول نفسه (مع حفظ النسخة السابقة)
  if (vacs.length) await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    for (const { d, e } of vacs) (next.vacations ||= []).push({ id: uid(), doctorId: d.id, code: d.code || "", name: d.name, start: e.start_date, end: e.end_date || "", type: "إجازة" });
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: `إجازة ${vacs.map(v => "د. " + shortName(v.d.name)).join("، ")} من القروب` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "إجازة من القروب" }); tx.set(ref, next);
  });
  if (inbox.length) await db.doc("board/bawadi_inbox").set({ items: FieldValue.arrayUnion(...inbox), at: Date.now() }, { merge: true });
  return applied;
}

// المجدول («9:45 وقف له») يتنفذ في وقته
async function runScheduled() {
  const t = nowR();
  if (!today || today.date !== t.iso || !(today.scheduled || []).some(s => s.min <= t.m)) return;
  try {
    await db.runTransaction(async tx => {
      const ref = db.doc("board/bawadi_today"), cur = (await tx.get(ref)).data();
      if (!cur || cur.date !== t.iso) return;
      const due = cur.scheduled.filter(s => s.min <= t.m); if (!due.length) return;
      cur.scheduled = cur.scheduled.filter(s => s.min > t.m);
      for (const s of due) {
        cur.st[s.key] = { kind: "stop", at: Date.now(), by: s.by };
        const d = docs().find(x => x.id === s.key);
        cur.events.push({ id: uid(), at: Date.now(), kind: "stop", doctorId: d?.id || "", name: s.name, dep: s.dep, room: d?.room || "", ext: d?.ext || "", info: "", title: "⛔ وقف استقبال الحالات", color: "red", by: s.by });
      }
      cur.events = cur.events.slice(-40);
      tx.set(ref, cur);
    });
  } catch (e) { log.warn({ err: String(e?.message || e) }, "مجدول القروب"); }
}

/* ---------- الرسالة الواردة من القروب ---------- */
async function isOurGroup(jid) {
  if (groupJid) return jid === groupJid;
  if (!subjects.has(jid)) { try { subjects.set(jid, (await getSock()?.groupMetadata(jid))?.subject || ""); } catch { subjects.set(jid, ""); } }
  if (subjKey(subjects.get(jid)) === subjKey(GROUP_NAME) || subjKey(subjects.get(jid)).includes(subjKey(GROUP_NAME))) {
    groupJid = jid;
    db.doc("bot/status").set({ group: { jid, name: subjects.get(jid), at: Date.now() } }, { merge: true }).catch(() => {});
    log.info({ jid, name: subjects.get(jid) }, "لقيت قروب الاستقبال");
    return true;
  }
  return false;
}

const done = new Set();
export async function handleGroupMessage(m) {
  const jid = m.key?.remoteJid || "";
  if (m.key?.id) { if (done.has(m.key.id)) return; done.add(m.key.id); if (done.size > 2000) done.clear(); }
  if (!(await isOurGroup(jid))) return;
  const msg = m.message || {};
  if (msg.protocolMessage || msg.editedMessage || msg.reactionMessage) return;
  const text = (msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || "").trim();
  if (!text || norm(text).replace(/\s/g, "").length < 2) return;           // «.» وأشباهها
  const q = msg.extendedTextMessage?.contextInfo?.quotedMessage;
  const quoted = (q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || "").trim();
  if (!board) { log.warn("جدول الأطباء مو جاهز — تجاهلت رسالة القروب"); return; }
  const by = m.pushName || "القروب";
  let evs = await aiParse(text, quoted);
  if (evs == null) evs = ruleParse(text, quoted);
  if (!evs.length) { if (evs.unknown) { try { await getSock()?.sendMessage(jid, { react: { text: "❓", key: m.key } }); } catch {} } return; }
  const applied = await apply(evs, { text, by });
  log.info({ text: text.slice(0, 80), applied }, "قروب الاستقبال");
  // ✅ فهمها وطبّقها — ❓ فهم إنها عن طبيب بس ما عرف مين (يكتبون الاسم الثاني أو يردّون على رسالة فيها الاسم)
  const react = applied.length ? "✅" : "❓";
  try { await getSock()?.sendMessage(jid, { react: { text: react, key: m.key } }); } catch {}
}
