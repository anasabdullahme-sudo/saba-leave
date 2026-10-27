// قروب «For information saba 1»: البوت يقرأ رسايل الاستقبال عن الأطباء (وقف، فاضي، غائب، متأخر…)
// ويحدّث صفحة أطباء البوادي + يطلع تنبيه في كروم. ما يكتب أي رد في القروب — بس ✅ على الرسالة اللي فهمها.
import { FieldValue } from "firebase-admin/firestore";

const GROUP_NAME = process.env.GROUP_NAME || "For information saba 1";
const TZ = "Asia/Riyadh";
const DAY = 864e5;

let db, log, getSock, gemini, models, admins = [];
let groupJid = "";                       // نعرفه من اسم القروب أول مرة
const subjects = new Map();             // jid → اسم القروب (كاش)
let board = null, today = null;         // نسخ محلية (onSnapshot)

export function initGroup(opts) {
  ({ db, log, getSock, gemini, models } = opts);
  admins = String(opts.admin || "").split(/[,\s]+/).map(p => latin(p).replace(/\D/g, "").replace(/^(00)?966/, "").replace(/^0/, "")).filter(p => /^5\d{8}$/.test(p));
  db.doc("board/bawadi").onSnapshot(d => { board = d.exists ? d.data() : null; }, e => log.warn({ e: String(e) }, "board"));
  db.doc("board/bawadi_today").onSnapshot(d => { today = d.exists ? d.data() : null; }, e => log.warn({ e: String(e) }, "today"));
  db.doc("bot/status").get().then(d => { groupJid = d.get("group")?.jid || ""; }).catch(() => {});
  setInterval(runScheduled, 30000);
  setInterval(resetExpired, 60000);
  listenSignals();
}

/* ---------- زر الطبيب في أثير → signals/{id} → نفس مسار رسائل القروب ---------- */
const SIG = { stop: ["stop", "⛔ أوقف استقبال الحالات"], free: ["free", "✅ رجع يستقبل حالات"], busy: ["busy", "⏳ عنده انتظار — بلّغوا اللي ما عندهم موعد"], appt: ["appointments_only", "📅 مواعيد فقط — لا تدخّلون حالات بدون موعد"] };
const lastSig = new Map();
function listenSignals() {
  db.collection("signals").onSnapshot(snap => {
    for (const ch of snap.docChanges()) if (ch.type === "added") handleSignal(ch.doc.ref).catch(e => log.warn({ e: String(e) }, "signal"));
  }, e => log.warn({ e: String(e) }, "signals"));
}
async function handleSignal(ref) {
  const s = await db.runTransaction(async tx => { const d = await tx.get(ref); if (!d.exists) return null; tx.delete(ref); return d.data(); });   // نسخة وحدة بس تطبّقه
  if (!s || !SIG[s.kind] || !board) return;
  if (Math.abs(Date.now() - (s.at || 0)) > 15 * 60000) return;                     // قديم (البوت كان طافي)
  const d = docs().find(x => x.id === s.doctorId); if (!d) return;
  const k = d.id + s.kind; if (Date.now() - (lastSig.get(k) || 0) < 20000) return; lastSig.set(k, Date.now());
  const [kind, txt] = SIG[s.kind];
  await apply([{ kind, doctor_id: d.id, name: shortName(d.name) }], { text: "", by: "د. " + shortName(d.name) + " (زر)" });
  log.info({ doctor: d.name, kind }, "زر الطبيب");
  // نكتب في القروب بعد كذا عشان اللي ما عندهم الأداة يدرون
  try { const jid = groupJid || await findGroup(); if (jid) await getSock()?.sendMessage(jid, { text: `د. ${shortName(d.name)} — ${txt}` }); } catch {}
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
  new_doctor = طبيب جديد بيباشر أو طبيب مو في القائمة ومعه دوامه (start_date، room لو ذكرت)
  moved = انتقل لفرع ثاني (branch)
  schedule_change = تغيير دوام ثابت لأكثر من يوم (أو «دوامه فقط الأربعاء والخميس من 5 إلى 9»)
  لـ new_doctor و schedule_change: days = أيام الدوام أرقام (الأحد=0، الإثنين=1، الثلاثاء=2، الأربعاء=3، الخميس=4، السبت=6) لو ذكرت، from_time/to_time = بداية ونهاية الدوام، room/ext/fee لو ذكرت. يوم المباشرة (يباشر السبت) مو من أيام الدوام — لا تحطه في days
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
        start_date: { type: "STRING" }, end_date: { type: "STRING" }, room: { type: "STRING" }, ext: { type: "STRING" }, fee: { type: "STRING" },
        days: { type: "ARRAY", items: { type: "INTEGER" } }, from_time: { type: "STRING" }, to_time: { type: "STRING" }, branch: { type: "STRING" }, note: { type: "STRING" } },
        required: ["name", "kind"] } } }, required: ["events"] },
    },
  };
  for (const model of models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": gemini }, body: JSON.stringify(body), signal: ctl.signal });
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
// «دوامه الاربعاء والخميس من 5 م - 9 م» → { days:[3,4], from:1020, to:1260 }
const DAYW = [["احد", 0], ["اثنين", 1], ["ثلاثاء", 2], ["ثلاثا", 2], ["اربعاء", 3], ["اربعا", 3], ["خميس", 4], ["سبت", 6]];
function schedOf(text) {
  const tx = latin(text), n = norm(tx);
  const days = [...new Set(DAYW.filter(([w]) => n.includes(w)).map(([, i]) => i))].sort();
  const m = /(\d{1,2})(?::(\d{2}))?\s*(ص|م|صباحا?|مساء|مساءا|العصر|الظهر|الصبح|بالليل)?\s*(?:-|–|الى|إلى|لين|حتى|ل)\s*(\d{1,2})(?::(\d{2}))?\s*(ص|م|صباحا?|مساء|مساءا|العصر|الظهر|الصبح|بالليل)?/.exec(tx);
  let from = null, to = null;
  if (m) {
    const h24 = (h, a, other) => { const ap = a || other || ""; h = +h % 12; return /م|مساء|العصر|الظهر|بالليل/.test(ap) ? h + 12 : /ص|صباح|الصبح/.test(ap) ? h : (h < 8 ? h + 12 : h); };
    from = h24(m[1], m[3], m[6]) * 60 + (+m[2] || 0); to = h24(m[4], m[6], m[3]) * 60 + (+m[5] || 0);
    if (!m[6] && to <= from) to += 720; to %= 1440;
  }
  return { days, from, to };
}
const DAYN = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
// تعديل دائم (دوام/طبيب جديد) يحتاج تطابق كامل: كل كلمة من الاسم المكتوب لازم تكون في اسم الطبيب (سارة النمر ≠ سارة الجارحي)
const nameToks = x => norm(shortName(x)).split(" ").filter(t => t && !STOP.has(t)).map(deAl);
function sameName(given, d) {
  const g = nameToks(given), dn = nameToks(d.name); if (!g.length) return false;
  return g.every(t => dn.some(x => x === t || (t.length >= 4 && x.length >= 4 && lev1(t, x))));
}
function strictFind(given) { const L = docs().filter(d => sameName(given, d)); return L.length === 1 ? L[0] : null; }
function schedRule(text) {
  const n = norm(text);
  if (!/دوام|يداوم|بيداوم/.test(n)) return null;
  const sc = schedOf(text); if (!sc.days.length && sc.from == null) return null;
  const raw = latin(text).replace(/[ً-ْـ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");   // الاسم مثل ما انكتب
  const nm = /(?:^|\s)(?:د|دكتور|دكتورة|دكتوره|الدكتور|الدكتورة|الدكتوره)\s+(\S+(?:\s+\S+)?)(.*?)\s(?:دوام|يداوم|بيداوم)/.exec(raw);
  if (nm) { const d = strictFind(nm[1]); return d ? { doctor_id: d.id, name: nm[1], kind: "schedule_change" } : { name: nm[1], dept: nm[2].trim(), kind: "new_doctor" }; }
  const d = fuzzyPick(text);
  return d && nameToks(d.name).every(t => n.includes(t)) ? { doctor_id: d.id, name: shortName(d.name), kind: "schedule_change" } : null;
}

function ruleParse(text, quoted) {
  const sr = schedRule(text); if (sr) return [sr];
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
// يوم جديد: نبدأ من الصفر، إلا حالة طبيب دوامه لسا ما خلص (مثل دوام 1 بالليل لين 9 الصبح)
function fresh(cur, iso) {
  if (cur && cur.date === iso) return structuredClone(cur);
  const st = Object.fromEntries(Object.entries(cur?.st || {}).filter(([, v]) => v.exp && v.exp > Date.now()));
  return { date: iso, st, extra: [], events: [], scheduled: [] };
}

/* ---------- كل حالة تنتهي مع نهاية دوام الطبيب (أو نهاية اليوم) وترجع طبيعي ---------- */
const riyadhMid = iso => Date.parse(iso + "T00:00:00+03:00");
function rAt(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, m: +p.hour * 60 + +p.minute, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday] };
}
const shiftsOn = (d, wd) => !(d.workdays || []).includes(wd) ? [] : (d.alt?.days?.includes(wd) ? (d.alt.shifts || []) : (d.shifts || []));
function expFor(d, atMs) {
  const t = rAt(atMs), mid = riyadhMid(t.iso), endDay = mid + DAY;
  if (!d) return endDay;
  const ends = [];
  for (const s of shiftsOn(d, (t.wd + 6) % 7)) if (s.e <= s.s && t.m < s.e) ends.push(s.e);              // دوام أمس اللي يعدّي نص الليل
  for (const s of shiftsOn(d, t.wd)) {
    const e = s.e > s.s ? s.e : s.e + 1440;
    if (t.m < e) ends.push(e);                                                                            // الدوام الحالي، أو اللي بعده اليوم
  }
  if (!ends.length) return endDay;
  return mid + Math.min(...ends) * 60000;
}
function stampExp(cur) {
  for (const [k, v] of Object.entries(cur.st || {})) if (v && !v.exp) v.exp = expFor(docs().find(x => x.id === k), v.at || Date.now());
}
async function resetExpired() {
  if (!today) return;
  const t = nowR(), now = Date.now();
  if (today.date === t.iso && !Object.values(today.st || {}).some(v => v.exp && v.exp <= now)) return;
  try {
    await db.runTransaction(async tx => {
      const ref = db.doc("board/bawadi_today"), raw = (await tx.get(ref)).data(); if (!raw) return;
      const cur = fresh(raw, t.iso); let changed = raw.date !== t.iso;
      for (const [k, v] of Object.entries(cur.st)) if (v.exp && v.exp <= now) { delete cur.st[k]; changed = true; }
      if (changed) tx.set(ref, cur);
    });
  } catch (e) { log.warn({ err: String(e?.message || e) }, "تصفير الحالات"); }
}

async function apply(evs, ctx) {
  const t = nowR(), applied = [];
  const inbox = [], vacs = [], upd = [], newDocs = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi_today");
    const cur = fresh((await tx.get(ref)).data(), t.iso);
    for (const e of evs) {
      let d = (e.doctor_id && docs().find(x => x.id === e.doctor_id)) || matchDoctor(e.name, e.dept);
      if (e.kind === "new_doctor" || e.kind === "schedule_change") {      // دوام ثابت: موجود → نعدّله، مو موجود → نسأل المسؤول
        if (d && e.name && !sameName(e.name, d)) d = strictFind(e.name);  // ما نعدّل دوام طبيب ثاني بالغلط
        const sc = /دوام|يداوم/.test(norm(ctx.text)) ? schedOf(ctx.text) : { days: [], from: null, to: null };   // «يباشر السبت» مو أيام دوام
        const days = (Array.isArray(e.days) && e.days.length ? e.days : sc.days).filter(x => x >= 0 && x <= 6 && x !== 5);
        const from = toMin(e.from_time) ?? sc.from, to = toMin(e.to_time) ?? sc.to;
        const sch = { days, shifts: from != null && to != null ? [{ s: from, e: to }] : null, room: e.room || "", ext: e.ext || "", fee: e.fee || "" };
        if (d && (days.length || sch.shifts || sch.room)) { upd.push({ d, sch }); applied.push("schedule_change"); continue; }
        if (!d && admins.length) { newDocs.push({ e, sch }); applied.push("new_doctor"); continue; }
        if (d) { applied.push("known"); continue; }                      // موجود وما فيه شي يتعدل (✅ بدون تغيير)
      }
      if (["new_doctor", "moved", "schedule_change"].includes(e.kind)) { inbox.push({ id: uid(), at: Date.now(), kind: e.kind, name: e.name, dept: e.dept || "", room: e.room || "", branch: e.branch || "", date: e.start_date || "", doctorId: d?.id || "", text: ctx.text.slice(0, 300), by: ctx.by }); applied.push(e.kind); continue; }
      if (e.kind === "vacation") {                                       // التواريخ من Gemini، ولو ناقصة نحسبها من نص الرسالة
        const r = vacationRule(ctx.text) || {}; e.start_date = /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || "") ? e.start_date : (r.start_date || t.iso);
        e.end_date = /^\d{4}-\d{2}-\d{2}$/.test(e.end_date || "") ? e.end_date : (r.end_date || "");
        if (d) { vacs.push({ d, e }); applied.push("vacation"); } continue;
      }
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
    stampExp(cur);
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
  if (upd.length) await updateSchedules(upd, ctx);
  for (const x of newDocs) await askAdmin(x, ctx);
  return applied;
}

/* ---------- تعديل دوام طبيب موجود (من القروب) ---------- */
const schedTxt = sch => [sch.days?.length ? sch.days.map(i => DAYN[i]).join("، ") : "", sch.shifts ? sch.shifts.map(x => hm(x.s) + " – " + hm(x.e)).join(" و ") : ""].filter(Boolean).join(" · ");
async function updateSchedules(list, ctx) {
  const done = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    for (const { d, sch } of list) {
      const t = next.departments.flatMap(p => p.doctors || []).find(x => x.id === d.id); if (!t) continue;
      if (sch.days?.length) t.workdays = sch.days;
      if (sch.shifts) { t.shifts = sch.shifts; delete t.alt; }
      for (const f of ["room", "ext", "fee"]) if (sch[f]) t[f] = sch[f];
      done.push({ name: shortName(t.name), sch });
    }
    if (!done.length) return;
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: `دوام ${done.map(x => "د. " + x.name).join("، ")} من القروب` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "تعديل دوام من القروب" }); tx.set(ref, next);
  });
  for (const x of done) await dmAdmin(`✏️ عدّلت دوام د. ${x.name} في الجدول\n${schedTxt(x.sch)}\n(من رسالة ${ctx.by} في قروب الاستقبال)\n\nلو فيه غلط عدّله من صفحة الأطباء أو رد «تراجع».`);
}

/* ---------- طبيب مو موجود → رسالة للمسؤول على الخاص: يضيفه أو لا ---------- */
const adminJids = new Map();
async function dmAdmin(text) {
  const sock = getSock(); if (!sock || !admins.length) return false;
  let ok = false;
  for (const p of admins) {
    try {
      let jid = adminJids.get(p);
      if (!jid) { const [r] = await sock.onWhatsApp("966" + p); jid = r?.exists ? r.jid : ""; if (jid) adminJids.set(p, jid); }
      if (jid) { await sock.sendMessage(jid, { text }); ok = true; }
    } catch (e) { log.warn({ err: String(e?.message || e) }, "رسالة المسؤول"); }
  }
  return ok;
}
const findDep = name => { const n = norm(name || "").replace(/^ال/, ""); if (!n) return null; return (board?.departments || []).find(p => { const pn = norm(p.name).replace(/^ال/, ""); return pn.includes(n) || n.includes(pn); }) || null; };
const code3 = () => Array.from({ length: 3 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
async function askAdmin({ e, sch }, ctx) {
  const name = String(e.name || "").replace(/^(د|دكتور|دكتوره)\.?\s+/, "").trim(); if (!name) return;
  const dep = findDep(e.dept);
  const like = dep ? (dep.doctors || []).find(x => x.room || x.fee) : null;            // نفس غرفة/كشفية القسم لو ما انذكرت
  const item = { code: code3(), at: Date.now(), name, dept: e.dept || "", depId: dep?.id || "", days: sch.days || [], shifts: sch.shifts || [],
    room: sch.room || like?.room || "", ext: sch.ext || like?.ext || "", fee: sch.fee || like?.fee || "", by: ctx.by, text: ctx.text.slice(0, 300) };
  const ref = db.doc("bot/pending_doctors");
  await db.runTransaction(async tx => { const c = (await tx.get(ref)).data() || {}; const items = (c.items || []).filter(i => Date.now() - i.at < 7 * DAY && norm(i.name) !== norm(name)); items.push(item); tx.set(ref, { items }); });
  const fl = dep ? (board.floorNames?.[dep.floor] || { B: "عيادة التجميل (بيوتي)", G: "الدور الأرضي", 1: "الدور الأول", 2: "الدور الثاني", 3: "الدور الثالث", 4: "الدور الرابع", 5: "الدور الخامس" }[dep.floor] || "") : "";
  const sent = await dmAdmin([
    `🆕 طبيب مو موجود في الجدول  #${item.code}`,
    `د. ${name}`,
    `القسم: ${dep ? dep.name + (fl ? " — " + fl : "") : (e.dept ? e.dept + " (قسم جديد)" : "— ما انذكر")}`,
    `الأيام: ${item.days.length ? item.days.map(i => DAYN[i]).join("، ") : "— ما انذكرت (بحطه كل الأيام)"}`,
    `الدوام: ${item.shifts.length ? item.shifts.map(x => hm(x.s) + " – " + hm(x.e)).join(" و ") : "— ما انذكر"}`,
    item.room || item.fee ? `الغرفة: ${item.room || "—"}${item.ext ? " · ☎ " + item.ext : ""} · الكشفية: ${item.fee || "—"}${like && !sch.room ? " (نفس القسم)" : ""}` : "",
    `من رسالة ${ctx.by}: «${ctx.text.slice(0, 120)}»`,
    "",
    `أضيفه للجدول؟ رد «نعم» أو «لا»`,
  ].filter(x => x !== "").join("\n"));
  if (!sent) await db.doc("board/bawadi_inbox").set({ items: FieldValue.arrayUnion({ id: uid(), at: Date.now(), kind: "new_doctor", name, dept: e.dept || "", room: e.room || "", branch: "", date: "", doctorId: "", text: ctx.text.slice(0, 300), by: ctx.by }), at: Date.now() }, { merge: true });
}

// رد المسؤول على الخاص: «نعم» / «لا» (ولو فيه أكثر من طلب: يرد على الرسالة نفسها أو يكتب الرمز «نعم K7Q»)
export async function handleAdminMessage(m, phone, text) {
  const p = String(phone || "").replace(/^0/, "");
  if (!admins.includes(p)) return false;
  const n = norm(text);
  const yes = /^(نعم|ايوه|ايوا|اي|ايه|اضف|اضفه|ضيف|ضيفه|ضيفها|موافق|تمام|اوكي|ok|1)(?:\s|$)/.test(n) || /^(👍|✅)/.test(text);
  const no = /^(لا|تجاهل|الغ|الغيه|لاتضيف|لا تضيف|2)(?:\s|$)/.test(n) || /^❌/.test(text);
  const undo = /^تراجع/.test(n);
  if (!yes && !no && !undo) return false;
  if (undo) { await restorePrev(); return true; }
  const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const qt = q?.conversation || q?.extendedTextMessage?.text || "";
  const code = (/#([A-Z0-9]{3})\b/.exec(qt) || /\b([A-Z0-9]{3})\s*$/.exec(latin(text).toUpperCase()) || [])[1];
  const ref = db.doc("bot/pending_doctors");
  const c = (await ref.get()).data() || {}, items = (c.items || []).filter(i => Date.now() - i.at < 7 * DAY);
  if (!items.length) return false;
  const it = code ? items.find(i => i.code === code) : items.length === 1 ? items[0] : null;
  if (!it) { await dmAdmin(`عندي ${items.length} أطباء ينتظرون: ${items.map(i => "د. " + i.name + " #" + i.code).join("، ")}\nرد على رسالة الطبيب نفسها بـ «نعم» أو «لا».`); return true; }
  await ref.set({ items: items.filter(i => i.code !== it.code) });
  if (no) { await dmAdmin(`تمام، تجاهلت د. ${it.name}.`); return true; }
  let added = "";
  await db.runTransaction(async tx => {
    const bref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(bref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    if (next.departments.flatMap(x => x.doctors || []).some(x => norm(shortName(x.name)) === norm(it.name))) { added = "exists"; return; }
    let dep = next.departments.find(x => x.id === it.depId);
    if (!dep) { dep = { id: uid().slice(0, 7), name: it.dept || "أخرى", floor: "G", notes: "", doctors: [] }; next.departments.push(dep); }
    (dep.doctors ||= []).push({ id: uid().slice(0, 7), name: it.name, code: "", ext: it.ext || "", room: it.room || "", fee: it.fee || "",
      workdays: it.days.length ? it.days : [0, 1, 2, 3, 4, 6], shifts: it.shifts || [] });
    next.log = [{ at: Date.now(), by: "البوت (موافقة المسؤول)", what: `طبيب جديد: د. ${it.name}` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "طبيب جديد من القروب" }); tx.set(bref, next);
    added = dep.name;
  });
  await dmAdmin(added === "exists" ? `د. ${it.name} موجود أصلاً في الجدول.` : added ? `✅ انضاف د. ${it.name} في ${added}.\nتقدر تعدّل بياناته من صفحة الأطباء.` : "ما قدرت أضيفه — جرّب من صفحة الأطباء.");
  return true;
}
async function restorePrev() {
  const prev = (await db.doc("board/bawadi_prev").get()).data();
  if (!prev?.departments?.length) { await dmAdmin("ما فيه نسخة سابقة أرجع لها."); return; }
  const { savedAt, replacedBy, ...data } = prev;
  const cur = (await db.doc("board/bawadi").get()).data();
  await db.doc("board/bawadi").set({ ...data, log: [{ at: Date.now(), by: "البوت (المسؤول)", what: "تراجع عن آخر تعديل: " + (replacedBy || "") }, ...(cur?.log || [])].slice(0, 60), updatedAt: Date.now(), updatedBy: "البوت" });
  if (cur) await db.doc("board/bawadi_prev").set({ ...cur, savedAt: Date.now(), replacedBy: "تراجع" });
  await dmAdmin(`↩️ رجّعت الجدول للنسخة اللي قبل: ${replacedBy || "آخر تعديل"}.`);
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
      stampExp(cur);
      tx.set(ref, cur);
    });
  } catch (e) { log.warn({ err: String(e?.message || e) }, "مجدول القروب"); }
}

async function findGroup() {
  try {
    const all = await getSock()?.groupFetchAllParticipating(); if (!all) return "";
    for (const [jid, g] of Object.entries(all)) { subjects.set(jid, g.subject || ""); if (await isOurGroup(jid)) return jid; }
  } catch {}
  return "";
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
