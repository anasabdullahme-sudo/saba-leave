// قروب «For information saba 1»: البوت يقرأ رسايل الاستقبال عن الأطباء (وقف، فاضي، غائب، متأخر…)
// ويحدّث صفحة أطباء البوادي + يطلع تنبيه في كروم. ما يكتب أي رد في القروب — بس ✅ على الرسالة اللي فهمها.
import { FieldValue } from "firebase-admin/firestore";

const GROUP_NAME = process.env.GROUP_NAME || "For information saba 1";
const TZ = "Asia/Riyadh";
const DAY = 864e5;

let db, log, getSock, gemini, models, admins = [], majed = "";
let groupJid = "";                       // نعرفه من اسم القروب أول مرة
const subjects = new Map();             // jid → اسم القروب (كاش)
let board = null, today = null, lastBoardAt = 0;         // نسخ محلية (onSnapshot)

export function initGroup(opts) {
  ({ db, log, getSock, gemini, models } = opts);
  admins = String(opts.admin || "").split(/[,\s]+/).map(p => latin(p).replace(/\D/g, "").replace(/^(00)?966/, "").replace(/^0/, "")).filter(p => /^5\d{8}$/.test(p));
  majed = latin(String(opts.majed || "")).replace(/\D/g, "").replace(/^(00)?966/, "").replace(/^0/, "");   // ماجد: نسأله بس عن رسايله اللي ما فهمناها
  db.doc("board/bawadi").onSnapshot(d => {
    board = d.exists ? d.data() : null;
    // الأداة تقرا «حالات اليوم» كل 30 ثانية: نحط فيها وقت آخر تعديل للجدول عشان تعرف تحدّث الجدول على طول
    const at = board?.updatedAt || 0;
    if (at && at !== lastBoardAt) { lastBoardAt = at; db.doc("board/bawadi_today").set({ boardAt: at }, { merge: true }).catch(() => {}); }
  }, e => log.warn({ e: String(e) }, "board"));
  db.doc("bot/prefs").get().then(d => { if (d.exists && d.get("reports") === false) reportsOn = false; }).catch(() => {});
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
const allNames = d => [shortName(d.name), d.fullName, ...(d.aliases || [])].filter(Boolean);   // أسماء أثير/الواتس الثانية (aliases)
const deAl = t => t.length > 4 && t.startsWith("ال") ? t.slice(2) : t;
const STOP = new Set(["د", "دكتور", "دكتوره", "الدكتور", "الدكتوره", "دكتورة", "د.", "dr"]);

// مطابقة اسم مكتوب في الرسالة مع طبيب في الجدول
function matchDoctor(name, dept) {
  const toks = norm(name).split(" ").filter(t => t && !STOP.has(t)).map(deAl);
  const L = docs();
  if (toks.length) {
    const score1 = nm => { const dn = norm(nm).split(" ").map(deAl); let s = 0; toks.forEach((t, i) => { if (dn.includes(t)) s += i === 0 ? 3 : 2; else if (dn.some(x => x.startsWith(t) && t.length >= 3)) s += 1; }); return s; };
    const score = d => Math.max(score1(shortName(d.name)), ...(d.aliases || []).map(score1));
    const ranked = L.map(d => [d, score(d)]).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] > ranked[1][1])) return ranked[0][0];
    if (ranked.length > 1 && dept) { const nd = norm(dept); const f = ranked.filter(x => norm(x[0].dep).includes(nd) || nd.includes(norm(x[0].dep))); if (f.length === 1) return f[0][0]; }
  }
  if (dept && !toks.length) { const nd = norm(dept); const f = L.filter(d => norm(d.dep).includes(nd) || nd.includes(norm(d.dep))); if (f.length === 1) return f[0]; }
  return null;
}

/* ---------- الفهم بالذكاء (Gemini) ---------- */
const KINDS = ["stop", "resume", "free", "appointments_only", "busy", "absent_today", "late", "leaves_at", "starts_at", "present", "vacation", "returns", "info_change", "leaves_branch", "new_doctor", "moved", "schedule_change", "none"];
const PROMPT = `أنت تقرأ رسالة من قروب واتساب لموظفين استقبال عيادات سابا (فرع البوادي، جدة). الرسايل باللهجة السعودية/المصرية عن حالة الأطباء.
استخرج الأحداث عن الأطباء فقط. لكل حدث:
- doctor_id: من قائمة الأطباء تحت (لو متأكد)، وإلا "".
- name: اسم الطبيب كما كتب في الرسالة (بدون "د./دكتور").
- dept: التخصص إذا ذكر (مثل "أسنان أطفال"، "العيون").
- kind واحد من:
  stop = وقف استقبال تماماً/لا أحد يدخل له/خلاص (لا انتظار ولا مواعيد) (ولو فيه وقت مستقبلي "الساعة 9:45 وقف له" حط at_time)
  resume = رجع يستقبل/كمل
  free = فاضي/دخلوا له/حولوا له
  appointments_only = مواعيد فقط / انتظار فقط مواعيد. ولو فيه وقت: «يستقبل انتظار لين الساعة 5» أو «بعد 5 مواعيد فقط» = appointments_only مع at_time 17:00 (من ذاك الوقت مواعيد بس) — هذا مو stop
  busy = زحمة/عنده انتظار (waiting = العدد إذا ذكر)
  absent_today = غير متواجد اليوم / يعتذر عن الحضور اليوم (لا تكتب السبب الصحي أبداً)
  late = متأخر/بيتأخر (delay_minutes تقديرياً: ساعة=60، شوي=20) أو at_time وقت الوصول
  leaves_at = يمشي/يخلص دوامه الساعة X (at_time)
  starts_at = دوامه اليوم يبدأ/يجي من الساعة X (at_time)، ولو ذكر النهاية حط until_time
  present = موجود/متواجد (until_time لو "موجود إلى/لين X")
  vacation = إجازة بتواريخ (start_date, end_date بصيغة YYYY-MM-DD؛ "المباشرة السبت 31" يعني end_date = يوم 30)
  new_doctor = طبيب جديد بيباشر أو طبيب مو في القائمة ومعه دوامه (start_date، room لو ذكرت)
  moved = انتقل لفرع ثاني (branch)
  returns = يرجع من إجازته/يباشر (طبيب موجود بالجدول) — start_date = يوم المباشرة
  info_change = تغيير كشفية/غرفة/تحويلة لطبيب موجود (fee / room / ext)
  leaves_branch = آخر دوام له عندنا / ما راح يكون متواجد في الفرع بعد كذا / بيروح من عندنا (start_date = أول يوم ما يكون موجود لو انذكر)
- لا تخترع أوقات أبداً: from_time/to_time/at_time/until_time لازم تكون مكتوبة في الرسالة نفسها. لو قال «بنفس الدوام» بدون أوقات، خلّها فاضية.
  schedule_change = تغيير دوام ثابت لأكثر من يوم (أو «دوامه فقط الأربعاء والخميس من 5 إلى 9»)
  لـ new_doctor و schedule_change: days = أيام الدوام أرقام (الأحد=0، الإثنين=1، الثلاثاء=2، الأربعاء=3، الخميس=4، السبت=6) لو ذكرت، from_time/to_time = بداية ونهاية الدوام، room/ext/fee لو ذكرت. يوم المباشرة (يباشر السبت) مو من أيام الدوام — لا تحطه في days
- «كل خميس» / «كل يوم أحد» / «كل الثلاثاء والخميس» = دوام ثابت يتكرر كل أسبوع لهذيك الأيام: kind = schedule_change و days = هذيك الأيام بس، و date = "" (مو بكرة ولا حدث ليوم واحد).
- date: لو الحدث ليوم غير اليوم (بكرة/غداً، «الخميس» الجاي، تاريخ) حط تاريخ ذاك اليوم YYYY-MM-DD، وإلا "". مثال «غدا الخميس فقط عيادة د. رائد من ٢-٧» = starts_at مع date = تاريخ بكرة و at_time 14:00 و until_time 19:00 (دوام ذاك اليوم بس، مو تغيير دائم).
- الأوقات بصيغة 24 ساعة HH:MM. في العيادة الأرقام 1-11 بدون ص/م غالباً مساءً إلا لو واضح الصباح (مثل 8 صباحاً، 9 الصبح). "١٠" بالليل = 22:00.
- رسالة وحدة ممكن فيها أكثر من حدث لنفس الطبيب، مثل «متواجد اليوم من 2 إلى 7 ويستقبل انتظار لين 5» = starts_at (14:00→19:00) + appointments_only (at_time 17:00).
- لو الرسالة رد (فيه رسالة مقتبسة) استخدم المقتبسة لتعرف الطبيب المقصود.
- رسالة بدون طبيب معيّن، أو تحية، أو نقطة "." → events فاضية.
- unclear = true لو الرسالة عن طبيب بس مو متأكد من المقصود (مين الطبيب، الوقت، اليوم، هل هو ليوم واحد أو تغيير دائم، أو فيها شي ما يطابق الأنواع)، واكتب في question سؤال قصير يوضّح وش اللي مو واضح. لو الرسالة واضحة unclear = false.
اليوم: {TODAY} والساعة الآن {NOW} بتوقيت السعودية.
قائمة أطباء البوادي (id | الاسم | القسم):
{LIST}`;

async function aiParse(text, quoted) {
  if (!gemini) return null;
  const t = nowR();
  const list = docs().map(d => { const o = allNames(d).slice(1); return `${d.id} | ${shortName(d.name)}${o.length ? " (" + o.join(" / ") + ")" : ""} | ${d.dep}`; }).join("\n");
  const body = {
    systemInstruction: { parts: [{ text: PROMPT.replace("{TODAY}", `${t.iso} (${["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][t.wd]})`).replace("{NOW}", hm(t.m)).replace("{LIST}", list) }] },
    contents: [{ role: "user", parts: [{ text: (quoted ? `رسالة مقتبسة (اللي ردّ عليها): «${quoted}»\n` : "") + `الرسالة: «${text}»` }] }],
    generationConfig: {
      temperature: 0, maxOutputTokens: 800, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { events: { type: "ARRAY", items: { type: "OBJECT", properties: {
        doctor_id: { type: "STRING" }, name: { type: "STRING" }, dept: { type: "STRING" }, kind: { type: "STRING", enum: KINDS },
        at_time: { type: "STRING" }, until_time: { type: "STRING" }, delay_minutes: { type: "INTEGER" }, waiting: { type: "INTEGER" },
        start_date: { type: "STRING" }, end_date: { type: "STRING" }, room: { type: "STRING" }, ext: { type: "STRING" }, fee: { type: "STRING" },
        date: { type: "STRING" }, days: { type: "ARRAY", items: { type: "INTEGER" } }, from_time: { type: "STRING" }, to_time: { type: "STRING" }, branch: { type: "STRING" }, note: { type: "STRING" } },
        required: ["name", "kind"] } }, unclear: { type: "BOOLEAN" }, question: { type: "STRING" } }, required: ["events"] },
    },
  };
  for (const model of models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": gemini }, body: JSON.stringify(body), signal: ctl.signal });
      clearTimeout(tm);
      if (!res.ok) { log.warn({ model, status: res.status }, "Gemini قروب"); continue; }
      const j = await res.json();
      const out = JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      return Object.assign((out.events || []).filter(e => KINDS.includes(e.kind) && e.kind !== "none"), { unclear: !!out.unclear, question: String(out.question || "").slice(0, 200) });
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
  for (const t of w) { if (t.length < 5) continue; const f = L.filter(d => allNames(d).flatMap(nm => norm(nm).split(" ")).map(deAl).some(x => x.length >= 5 && lev1(x, deAl(t)))); if (f.length === 1) return f[0]; }   // «السجيدي» ≈ السنجيدي
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
const DAYW = [["احد", 0], ["اثنين", 1], ["ثلاثاء", 2], ["ثلاثا", 2], ["اربعاء", 3], ["اربعا", 3], ["خميس", 4], ["جمعه", 5], ["سبت", 6]];
// «كل خميس» / «كل يوم أحد» / «كل الثلاثاء» = دوام ثابت لهذاك اليوم كل أسبوع (مو بكرة بس)
const EVERY = /(^|\s)كل\s+(يوم\s+)?(ال)?(سبت|احد|اثنين|ثلاثاء|ثلاثا|اربعاء|اربعا|خميس)/;
const everyDays = text => {                                                    // «كل الثلاثاء والخميس» → [2, 4]
  const n = norm(text), out = [];
  for (const m of n.matchAll(/(^|\s)كل\s+/g)) {
    const seg = n.slice(m.index + m[0].length).split(/\s+(من|الساعه|دوام|دوامه|دوامها|يداوم|تداوم|\d)/)[0].slice(0, 40);
    for (const w of seg.split(/\s+|،|,/).map(x => x.replace(/^و/, "").replace(/^(يوم)$/, "").replace(/^ال/, ""))) { const d = DAYW.find(([k]) => k === w); if (d && d[1] !== 5 && !out.includes(d[1])) out.push(d[1]); }
  }
  return out;
};
const PERMANENT = /دائم|دايم|ثابت|بشكل دائم|من الحين وطالع|من اليوم وطالع|كل (يوم|اسبوع)|كل (يوم )?(ال)?(سبت|احد|اثنين|ثلاثاء|اربعاء|خميس)|(^|\s)(من|ابتداء من|اعتبارا من|بدايه من) (يوم )?(ال)?(سبت|احد|اثنين|ثلاثاء|اربعاء|خميس)|يباشر|سيباشر|مباشره|المعتاد/;
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
  const g = nameToks(given), dn = allNames(d).flatMap(nameToks); if (!g.length) return false;
  return g.every(t => dn.some(x => x === t || (t.length >= 4 && x.length >= 4 && lev1(t, x))));
}
function strictFind(given) { const L = docs().filter(d => sameName(given, d)); return L.length === 1 ? L[0] : null; }
function schedRule(text) {
  const n = norm(text);
  if (!/دوام|يداوم|بيداوم/.test(n)) return null;
  if (/(^|\s)(غدا|بكره|بكرا|اليوم|الليله|هالاسبوع|هذا الاسبوع)(\s|$)/.test(n)) return null;   // ليوم معيّن، مو تغيير دائم
  const sc = schedOf(text); if (!sc.days.length && sc.from == null) return null;
  if ((n.match(/(^|\s)(د|دكتور|دكتوره)(\s|$)/g) || []).length > 1) return null;       // جدول لأكثر من طبيب (مثل دوام الجمعة) → مو تعديل دائم
  if (sc.days.includes(5) && !PERMANENT.test(n)) return null;                         // الجمعة = دوام استثنائي ليوم واحد
  const raw = latin(text).replace(/[ً-ْـ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");   // الاسم مثل ما انكتب
  const nm = /(?:^|\s)(?:د|دكتور|دكتورة|دكتوره|الدكتور|الدكتورة|الدكتوره)\s+(\S+(?:\s+\S+)?)(.*?)\s(?:دوام|يداوم|بيداوم)/.exec(raw);
  if (nm) { const d = strictFind(nm[1]); return d ? { doctor_id: d.id, name: nm[1], kind: "schedule_change" } : { name: nm[1], dept: nm[2].trim(), kind: "new_doctor" }; }
  const d = fuzzyPick(text);
  return d && nameToks(d.name).every(t => n.includes(t)) ? { doctor_id: d.id, name: shortName(d.name), kind: "schedule_change" } : null;
}

// يوم معيّن غير اليوم: «غدا/بكرة» أو اسم يوم («الخميس») → تاريخه
const isoPlus = (iso, n) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function dayOf(text) {
  const n = norm(text), t = nowR();
  if (/(^|\s)(غدا|بكره|بكرا|باكر)(\s|$)/.test(n)) return isoPlus(t.iso, 1);
  if (/بعد بكره|بعد غد/.test(n)) return isoPlus(t.iso, 2);
  const w = DAYW.find(([k]) => new RegExp("(^|\\s)(يوم\\s+)?(ال)?" + k + "(\\s|$)").test(n));
  if (w) { const diff = (w[1] - t.wd + 7) % 7; return diff ? isoPlus(t.iso, diff) : null; }
  return null;
}
// يوم الحدث من الكلام: «مو اليوم / مب اليوم» تنشال، ولو فيه «اليوم» و«بكرة» مع بعض ما نخمّن
function textDay(text) {
  const n = norm(text).replace(/(^|\s)(مو|مب|موب|مش|ليس|لا|مهب)\s+(اليوم|الليله)(?=\s|$)/g, " ");
  const d = dayOf(n);
  if (!d) return null;
  if (/(^|\s)(اليوم|الليله)(\s|$)/.test(n)) return null;
  return d;
}
// جواب التصحيح: «الخميس» (لو هو اليوم) أو «اليوم» = اليوم، غير كذا نفس textDay
function fixDay(text) {
  const n = norm(text).replace(/(^|\s)(مو|مب|موب|مش|ليس|لا|مهب)\s+(اليوم|الليله)(?=\s|$)/g, " "), t = nowR();
  const w = DAYW.find(([k]) => new RegExp("(^|\\s)(يوم\\s+)?(ال)?" + k + "(\\s|$)").test(n));
  if (w && w[1] === t.wd) return "TODAY";
  if (!/(غدا|بكره|بكرا|باكر)/.test(n) && /(^|\s)(اليوم|الليله|الحين)(\s|$)/.test(n)) return "TODAY";
  return textDay(text);
}
// «غدا الخميس فقط عيادة د رائد من ٢-٧» → دوام ذاك اليوم بس
function dayRule(text) {
  const n = norm(text), today = /(^|\s)(اليوم|الليله)(\s|$)/.test(n);
  const date = dayOf(text) || (today ? nowR().iso : null); if (!date) return null;
  // جدول لأكثر من طبيب (سطر لكل طبيب: «د. إكرامي من ٩ص - ٩م») → دوام كل واحد ذاك اليوم
  const lines = String(text).split(/\n+/).map(l => ({ l, d: fuzzyPick(l), sc: schedOf(l) })).filter(x => x.d && x.sc.from != null);
  if (lines.length > 1 && PERMANENT.test(n)) return lines.map(x => ({ doctor_id: x.d.id, name: shortName(x.d.name), kind: "schedule_change", start_date: date, from_time: hhmm(x.sc.from), to_time: x.sc.to != null ? hhmm(x.sc.to) : "", days: x.sc.days || [] }));   // «من يوم الأحد كالآتي» = جدول ثابت من ذاك اليوم
  if (lines.length > 1) return lines.map(x => ({ doctor_id: x.d.id, name: shortName(x.d.name), kind: "starts_at", date, at_time: hhmm(x.sc.from), until_time: x.sc.to != null ? hhmm(x.sc.to) : "" }));
  const d = fuzzyPick(text); if (!d) return null;
  const sc = schedOf(text);
  if (sc.from != null) {
    const out = [{ doctor_id: d.id, name: shortName(d.name), kind: "starts_at", date, at_time: hhmm(sc.from), until_time: sc.to != null ? hhmm(sc.to) : "" }];
    const w = /انتظار\s*(?:الى|الي|إلى|لين|لحد|حتى|ل)\s*(?:الساعه\s*)?(\d{1,2})(?::(\d{2}))?/.exec(norm(latin(text)));
    if (w) { let h = +w[1] % 12; if (h < 8) h += 12; out.push({ doctor_id: d.id, name: shortName(d.name), kind: "appointments_only", date, at_time: hhmm(h * 60 + (+w[2] || 0)) }); }
    return out;
  }
  if (today) return null;                                                          // «اليوم» بدون وقت → القواعد العادية تحت
  if (/غير متواجد|ما بيجي|مابيجي|ما يجي|مايجي|معتذر|يعتذر|اجازه|غايب|غائب/.test(n)) return { doctor_id: d.id, name: shortName(d.name), kind: "absent_today", date };
  return null;
}
// الوقت لازم يكون مكتوب فعلاً في الكلام (يمنع الذكاء يخترع «من 9»)
function timeInText(hm24, text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm24 || ""); if (!m) return false;
  const h = +m[1], h12 = h % 12 || 12, digits = latin(text);
  return [h, h12].some(x => new RegExp("(^|[^\\d])0?" + x + "([^\\d]|$)").test(digits));
}
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function ruleParse(text, quoted) {
  const dr = dayRule(text); if (dr) return Array.isArray(dr) ? dr : [dr];
  const sr = schedRule(text); if (sr) return [sr];
  const vac = vacationRule(text);
  if (vac) { const d = fuzzyPick(text) || (quoted ? fuzzyPick(quoted) : null); return d ? [{ doctor_id: d.id, name: shortName(d.name), kind: "vacation", ...vac }] : Object.assign([], { unknown: true }); }
  const timeIn = n => { const m = /(\d{1,2})(?::(\d{2}))?/.exec(n); return m ? `${String(+m[1]).padStart(2, "0")}:${m[2] || "00"}` : ""; };
  const kindOf = n => /تاخر/.test(n) && /انتظار\s*(الى|الي|لين|لحد|حتى)/.test(n) ? "late_wait"
    : /مواعيد فقط|فقط مواعيد/.test(n) ? "appointments_only"
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
    if (kind === "late_wait") {                                                                   // «بيتأخر يجي 3:30 ويستقبل انتظار الى ٥ والباقي مواعيد»
      const ts = [...latin(n).matchAll(/(\d{1,2})(?::(\d{2}))?/g)].map(m => `${String(+m[1]).padStart(2, "0")}:${m[2] || "00"}`);
      evs.push({ ...e, kind: "late", ...(ts[0] ? { at_time: ts[0] } : { delay_minutes: 30 }) });
      if (ts[1]) evs.push({ ...e, kind: "appointments_only", at_time: ts[1] });
      continue;
    }
    if (kind === "present" && tm && /(^|\s)(الين|لين|الى|إلى|لحد|حتى)\s/.test(n)) { e.kind = "leaves_at"; e.at_time = tm; evs.push(e); continue; }   // «مداوم الين ٦:٣٠» = يطلع ٦:٣٠
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
  if (cur && cur.date === iso) return rebase(structuredClone(cur));
  const st = Object.fromEntries(Object.entries(cur?.st || {}).filter(([, v]) => v.exp && v.exp > Date.now()));
  return rebase({ date: iso, st, extra: [], events: [], scheduled: [], ...(cur?.boardAt ? { boardAt: cur.boardAt } : {}) });
}
// حالة انحطت أمس ووقتها «بكرة» (دقايق ≥ 1440) → نرجّعها لساعات اليوم، ونجدول «خلص دوامه اليوم» بعد نهايتها
const stale = (cur, v) => v && v.at && v.at < riyadhMid(cur.date) && (v.until >= 1440 || v.from >= 1440);
function rebase(cur) {
  for (const [k, v] of Object.entries(cur.st || {})) {
    if (!stale(cur, v)) continue;
    if (v.until >= 1440) v.until -= 1440;
    if (v.from >= 1440) v.from -= 1440;
    if (["starts", "present", "leaves"].includes(v.kind) && v.until != null && v.until < 1440 && !(cur.scheduled ||= []).some(x => x.key === k && x.kind === "off")) cur.scheduled.push({ id: uid(), min: v.until, key: k, kind: "off", name: "", dep: "", by: v.by || "" });
    delete v.exp;
  }
  stampExp(cur);
  return cur;
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
  for (const [k, v] of Object.entries(cur.st || {})) {
    if (!v || v.exp) continue;
    if (v.until != null && ["starts", "appt", "present", "leaves", "free"].includes(v.kind)) {   // لها وقت نهاية → بعده «خلص دوامه اليوم»، وترجع طبيعي نهاية اليوم بس
      const mid = riyadhMid(cur.date || nowR().iso), over = v.from != null && v.until <= v.from;
      v.exp = v.until >= 1440 ? mid + v.until * 60000 : over ? mid + (v.until + 1440) * 60000 : mid + DAY; continue;
    }
    if (v.kind === "absent") { v.exp = riyadhMid(cur.date || nowR().iso) + DAY; continue; }                       // غير متواجد اليوم = لين نهاية اليوم
    v.exp = expFor(docs().find(x => x.id === k), v.at || Date.now());
  }
}
// وقت بدون ص/م ليوم ثاني: نختار (الساعة / +12 / بعد نص الليل) الأقرب لدوام الطبيب ذاك اليوم — التعادل للأمتأخر
function fitMin(m, d, wd) {
  if (m == null) return m;
  const sh = d ? shiftsOn(d, wd).map(x => [x.s, x.e > x.s ? x.e : x.e + 1440]) : [];
  if (m >= 720 || !sh.length) return m < 480 ? m + 720 : m;                    // 13:00+ واضح، وبدون دوام معروف: 1–7 = مساءً
  const c = [m, m + 720, m + 1440].filter(x => x < 1440 + 360), dist = x => Math.min(...sh.map(([a, b]) => x < a ? a - x : x > b ? x - b : 0));
  return c.reduce((a, b) => dist(b) <= dist(a) ? b : a);
}
const PLAN_KINDS = ["starts_at", "absent_today", "late", "leaves_at", "appointments_only", "stop", "present"];
// الأحداث المجدولة ليومها (اليوم أو اللي فات) → تتطبّق على حالات اليوم وتنشال من الخطة
async function applyPlans() {
  const t = nowR(), ref = db.doc("board/bawadi_plan");
  try {
    const due = await db.runTransaction(async tx => {
      const items = (await tx.get(ref)).data()?.items || [];
      const now = items.filter(i => i.date <= t.iso), keep = items.filter(i => i.date > t.iso);
      if (!now.length) return [];
      tx.set(ref, { items: keep, at: Date.now() });
      return now.filter(i => i.date === t.iso);                                     // اللي فات يومه ينشال بس
    });
    for (const i of due.filter(i => i.kind === "remove_doctor")) { const nm = await removeDoctor(i.doctorId, "البوت (مجدول)"); if (nm) await dmAdmin(`✅ شلت د. ${nm} من الجدول (زي ما اتفقنا).`); }
    const sets = due.filter(i => i.kind === "set_schedule").map(i => ({ d: docs().find(x => x.id === i.doctorId), sch: i.sch })).filter(x => x.d && x.sch);
    if (sets.length) await updateSchedules(sets, { by: "القروب (مجدول)" });
    for (const i of due.filter(i => i.kind !== "remove_doctor" && i.kind !== "set_schedule")) await apply([{ kind: i.kind, doctor_id: i.doctorId, name: "", at_time: i.at_time, until_time: i.until_time, delay_minutes: i.delay_minutes }], { text: "", by: (i.by || "القروب") + " (مجدول)", planned: true });
    if (due.length) log.info({ n: due.length }, "طبّقنا أحداث اليوم المجدولة");
  } catch (e) { log.warn({ err: String(e?.message || e) }, "الأحداث المجدولة"); }
}
let plansDay = "";
async function resetExpired() {
  const tt = nowR(); if (plansDay !== tt.iso) { plansDay = tt.iso; await applyPlans(); }
  if (!today) return;
  const t = nowR(), now = Date.now();
  if (today.date === t.iso && !Object.values(today.st || {}).some(v => (v.exp && v.exp <= now) || stale(today, v))) return;
  try {
    await db.runTransaction(async tx => {
      const ref = db.doc("board/bawadi_today"), raw = (await tx.get(ref)).data(); if (!raw) return;
      const cur = fresh(raw, t.iso); let changed = raw.date !== t.iso || Object.values(raw.st || {}).some(v => stale(raw, v));
      for (const [k, v] of Object.entries(cur.st)) if (v.exp && v.exp <= now) { delete cur.st[k]; changed = true; }
      if (changed) tx.set(ref, cur);
    });
  } catch (e) { log.warn({ err: String(e?.message || e) }, "تصفير الحالات"); }
}

async function apply(evs, ctx) {
  const t = nowR(), applied = [];
  const inbox = [], vacs = [], upd = [], newDocs = [], plans = [], backs = [], leavers = [], heres = [], asks = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi_today");
    const cur = fresh((await tx.get(ref)).data(), t.iso);
    for (const e of evs) {
      let d = (e.doctor_id && docs().find(x => x.id === e.doctor_id)) || matchDoctor(e.name, e.dept);
      if ((e.kind === "new_doctor" || e.kind === "schedule_change") && d && e.name && !sameName(e.name, d)) d = strictFind(e.name);  // ما نعدّل دوام طبيب ثاني بالغلط
      // تغيير دوام (ثابت، أو ليوم ثاني) → ما نطبّق لحالنا: نرسل للمسؤول خيارات ويختار
      if (d && !ctx.confirmed && !ctx.fix && !ctx.planned && admins.length && needsConfirm(e, ctx.text, t)) {
        e.__asked = true; if (!asks.some(a => a.d.id === d.id)) asks.push({ d, e: { ...e } });
        applied.push("asked"); (ctx.rep ||= []).push(`🤔 د. ${shortName(d.name)} — تغيير دوام: أرسلت لك خيارات تختار منها قبل ما أطبّق`); continue;
      }
      if (d && ["starts_at", "present", "leaves_at"].includes(e.kind) && EVERY.test(norm(ctx.text)) && everyDays(ctx.text).length) {
        const sc0 = schedOf(ctx.text);
        e.kind = "schedule_change"; e.days = everyDays(ctx.text); e.date = "";
        e.from_time = e.at_time || (sc0.from != null ? hhmm(sc0.from) : ""); e.to_time = e.until_time || (sc0.to != null ? hhmm(sc0.to) : "");
      }
      if ((e.kind === "new_doctor" || e.kind === "schedule_change") && d) {
        // «دوام يوم الجمعة …» أو يوم محدد بدون «دائم» → دوام ذاك اليوم بس (مو تغيير الجدول الثابت)
        const onlyFri = Array.isArray(e.days) && e.days.length && e.days.every(x => x === 5);
        const oneDay = onlyFri || ((dayOf(ctx.text) || /الجمعه/.test(norm(ctx.text)) || TODAYW.test(norm(ctx.text))) && !PERMANENT.test(norm(ctx.text)) && !EVERY.test(norm(ctx.text)));
        if (d && oneDay) {
          for (const k of ["from_time", "to_time"]) if (e[k] && !timeInText(e[k], ctx.text)) e[k] = "";
          const sc1 = schedOf(ctx.text), a1 = toMin(e.from_time) ?? sc1.from, u1 = toMin(e.to_time) ?? sc1.to;
          const day = onlyFri || /الجمعه/.test(norm(ctx.text)) ? isoPlus(t.iso, ((5 - t.wd + 7) % 7) || 7) : dayOf(ctx.text) || t.iso;
          if (a1 != null && day) { e.kind = "starts_at"; e.date = day; e.at_time = hhmm(a1); e.until_time = u1 != null ? hhmm(u1) : ""; }
          else { applied.push("known"); continue; }
        }
      }
      // حدث ليوم ثاني (بكرة/الخميس): نحفظه ويتطبّق أول ما يجي يومه
      // الذكاء نسى التاريخ؟ «غداً فقط…» / «غلط دوامه غداً مو اليوم» → ناخذه من الكلام نفسه
      const evDate = /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : PLAN_KINDS.includes(e.kind) ? (() => { const fd = ctx.fixText != null ? fixDay(ctx.fixText) : null; return fd === "TODAY" ? "" : fd || textDay(ctx.text) || ""; })() : "";
      if (evDate && evDate > t.iso && PLAN_KINDS.includes(e.kind) && d && ctx.fix) { delete cur.st?.[d.id]; cur.events = (cur.events || []).filter(x => !(x.doctorId === d.id && x.kind === e.kind)); }   // تصحيح: كان مطبّق اليوم بالغلط → نشيله من اليوم
      if (evDate && evDate > t.iso && PLAN_KINDS.includes(e.kind) && d) {
        if (evDate <= isoPlus(t.iso, 14)) {
          plans.push({ id: uid(), date: evDate, doctorId: d.id, kind: e.kind, at_time: e.at_time || "", until_time: e.until_time || "", delay_minutes: e.delay_minutes || 0, by: ctx.by }); applied.push("planned");
          // تنبيه للموظفين الحين: «🗓 بكرة: دوامه من 2م إلى 7م»
          const dl = evDate === isoPlus(t.iso, 1) ? "بكرة" : DAYN[new Date(evDate + "T12:00:00Z").getUTCDay()] + " " + evDate.slice(8, 10) + "/" + evDate.slice(5, 7);
          const pwd = new Date(evDate + "T12:00:00Z").getUTCDay(), a = fitMin(toMin(e.at_time), d, pwd), u = fitMin(toMin(e.until_time), d, pwd);
          const what = e.kind === "starts_at" ? (a != null ? `دوامه من ${hm(a)}${u != null ? " إلى " + hm(u) : ""}` : "دوام مختلف") : e.kind === "absent_today" ? "غير متواجد" : e.kind === "late" ? "بيتأخر" : e.kind === "appointments_only" ? "مواعيد فقط" : e.kind === "stop" ? "ما يستقبل" : e.kind === "leaves_at" ? `يطلع ${a != null ? hm(a) : "بدري"}` : "";
          cur.events.push({ id: uid(), at: Date.now(), kind: "planned", doctorId: d.id, name: shortName(d.name), dep: d.dep, room: d.room || "", ext: d.ext || "", info: `${dl}: ${what}`, title: `🗓 ${dl}`, color: "blue", by: ctx.by });
          (ctx.rep ||= []).push(`🗓 د. ${shortName(d.name)} — ${dl}: ${what}\n   الموقع: ينطبق يوم ${evDate.split("-").reverse().slice(0, 2).join("/")} · الأداة: تنبيه «🗓 ${dl}»`);
        }
        continue;
      }
      // كشفية/غرفة/تحويلة
      if (e.kind === "info_change" && d) {
        const sch = { days: [], shifts: null, room: e.room || "", ext: e.ext || "", fee: String(e.fee || "").replace(/\D/g, "") };
        if (sch.room || sch.ext || sch.fee) { upd.push({ d, sch, quiet: true }); applied.push("info_change"); (ctx.rep ||= []).push(`✏️ د. ${shortName(d.name)} — ${[sch.fee ? "الكشفية " + sch.fee : "", sch.room ? "غرفة " + sch.room : "", sch.ext ? "تحويلة " + sch.ext : ""].filter(Boolean).join(" · ")}\n   الموقع: انعدّل في الجدول`); }
        continue;
      }
      // يرجع من الإجازة: نهاية إجازته = اليوم اللي قبل المباشرة
      if (e.kind === "returns" && d) {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || "") ? e.start_date : (dayOf(ctx.text) || "");
        if (day) { backs.push({ d, day }); applied.push("returns"); (ctx.rep ||= []).push(`🔙 د. ${shortName(d.name)} — يباشر ${day.split("-").reverse().slice(0, 2).join("/")}\n   الموقع: إجازته تخلص ${isoPlus(day, -1).split("-").reverse().slice(0, 2).join("/")}`); }
        continue;
      }
      // بيروح من الفرع: ما نحذف لحالنا — نسأل المسؤول
      if ((e.kind === "leaves_branch" || (e.kind === "moved" && d)) && d) { leavers.push({ d, e }); applied.push("leaves_branch"); (ctx.rep ||= []).push(`👋 د. ${shortName(d.name)} — بيروح من الفرع: أرسلت لك تأكد قبل ما أشيله`); continue; }
      if (e.kind === "new_doctor" || e.kind === "schedule_change") {      // دوام ثابت: موجود → نعدّله، مو موجود → نسأل المسؤول
        for (const k of ["from_time", "to_time"]) if (e[k] && !timeInText(e[k], ctx.text)) e[k] = "";   // وقت مو مكتوب → ما نستخدمه
        // «من يوم الأحد» = بداية التغيير، مو أيام الدوام → نشيلها قبل ما نقرا الأيام
        const tDays = norm(ctx.text).replace(/(^|\s)(من|ابتداء من|اعتبارا من|بدايه من|يباشر|سيباشر|مباشره)\s+(يوم\s+)?(ال)?(سبت|احد|اثنين|ثلاثاء|اربعاء|خميس)\S*/g, " ");
        const sc = /دوام|يداوم/.test(norm(ctx.text)) ? schedOf(tDays) : { days: [], from: null, to: null };   // «يباشر السبت» مو أيام دوام
        const days = (Array.isArray(e.days) && e.days.length ? e.days : sc.days).filter(x => x >= 0 && x <= 6 && x !== 5);
        const from = toMin(e.from_time) ?? sc.from, to = toMin(e.to_time) ?? sc.to;
        const sch = { days, shifts: from != null && to != null ? [{ s: from, e: to }] : null, room: e.room || "", ext: e.ext || "", fee: String(e.fee || "").replace(/\D/g, "") };
        if (d && !sch.shifts && (from != null || to != null)) (ctx.rep ||= []).push(`⚠️ د. ${shortName(d.name)} — ما عدّلت الدوام لأن وقت ${from == null ? "البداية" : "النهاية"} مو مكتوب`);
        // دوام ثابت يبدأ يوم قدّام («من يوم الأحد 1/11 كالآتي») → نحفظه ويتطبّق يومها (البطاقة تبقى على الدوام الحالي لين ذاك اليوم)
        const sFrom = /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || "") ? e.start_date : (/(^|\s)(من|ابتداء من|اعتبارا من|بدايه من|يباشر|سيباشر)\s+(يوم\s+)?(ال)?(سبت|احد|اثنين|ثلاثاء|اربعاء|خميس|بكره|غدا)/.test(norm(ctx.text)) ? dayOf(ctx.text) : null);
        if (d && sFrom && sFrom > t.iso && sFrom <= isoPlus(t.iso, 30) && (days.length || sch.shifts)) {
          plans.push({ id: uid(), date: sFrom, doctorId: d.id, kind: "set_schedule", sch, by: ctx.by }); applied.push("planned");
          (ctx.rep ||= []).push(`🗓 د. ${shortName(d.name)} — دوام ثابت من ${sFrom.split("-").reverse().slice(0, 2).join("/")}: ${schedTxt(sch)}\n   الموقع: يتعدّل يومها (لين ذاك اليوم يبقى الدوام الحالي)`); continue;
        }
        if (d && sch.shifts && days.length && EVERY.test(norm(ctx.text)) && days.every(x => (d.workdays || []).includes(x)) && days.length < (d.workdays || []).length) {
          sch.altOnly = true;                                                       // «كل خميس من 9 لـ 5» → الخميس بس، الباقي ما يتغير
          upd.push({ d, sch }); applied.push("schedule_change");
          (ctx.rep ||= []).push(`✏️ د. ${shortName(d.name)} — كل ${days.map(i => DAYN[i]).join(" و")}: ${sch.shifts.map(x => hm(x.s) + " – " + hm(x.e)).join(" و ")} (باقي الأيام زي ما هي)\n   الموقع: انعدّل في الجدول`); continue;
        }
        if (d && (days.length || sch.shifts || sch.room || sch.fee)) { upd.push({ d, sch }); applied.push("schedule_change"); (ctx.rep ||= []).push(`✏️ د. ${shortName(d.name)} — تغيير دوام ثابت: ${schedTxt(sch)}\n   الموقع: انعدّل في الجدول`); continue; }
        if (!d && admins.length) { newDocs.push({ e, sch }); applied.push("new_doctor"); (ctx.rep ||= []).push(`🆕 د. ${e.name} — طبيب مو موجود: أرسلت لك تسأل تضيفه أو لا`); continue; }
        if (d) { applied.push("known"); (ctx.rep ||= []).push(`ℹ️ د. ${shortName(d.name)} — موجود بالجدول، ما تغيّر شي`); continue; }                      // موجود وما فيه شي يتعدل (✅ بدون تغيير)
      }
      if (["new_doctor", "moved", "schedule_change"].includes(e.kind)) { (ctx.rep ||= []).push(`💡 د. ${e.name} — ${KIND_AR[e.kind] || e.kind}: انحط في «اقتراحات من القروب» بصفحة الأطباء`); inbox.push({ id: uid(), at: Date.now(), kind: e.kind, name: e.name, dept: e.dept || "", room: e.room || "", branch: e.branch || "", date: e.start_date || "", doctorId: d?.id || "", text: ctx.text.slice(0, 300), by: ctx.by }); applied.push(e.kind); continue; }
      if (e.kind === "vacation") {                                       // التواريخ من Gemini، ولو ناقصة نحسبها من نص الرسالة
        const r = vacationRule(ctx.text) || {}; e.start_date = /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || "") ? e.start_date : (r.start_date || t.iso);
        e.end_date = /^\d{4}-\d{2}-\d{2}$/.test(e.end_date || "") ? e.end_date : (r.end_date || "");
        if (d) { vacs.push({ d, e }); applied.push("vacation"); (ctx.rep ||= []).push(`🏖 د. ${shortName(d.name)} — إجازة من ${e.start_date}${e.end_date ? " إلى " + e.end_date : " (بدون نهاية)"}\n   الموقع: انضافت لقائمة الإجازات (لو كانت مسجّلة ما تتكرر)`); } continue;
      }
      const key = d ? d.id : "x:" + norm(e.name);
      if (!d && e.kind !== "present") continue;                         // طبيب مو في الجدول: نقبل بس «موجود» (مؤقت)
      // أي شي يدل إنه موجود اليوم وهو عليه إجازة → رجع من إجازته: نقفلها (الجدول والبطاقة يطلع فيها موجود)
      if (d && HERE_KINDS.has(e.kind) && !heres.some(x => x.d.id === d.id) && onVacation(d, t.iso)) {
        heres.push({ d }); applied.push("vacation_end");
        (ctx.rep ||= []).push(`🔙 د. ${shortName(d.name)} — كان عليه إجازة وهو موجود اليوم: قفلت الإجازة\n   الموقع: يطلع «موجود» بدل «في إجازة»`);
      }
      // أوقات بدون ص/م: «٩:٤٥» الساعة 8 بالليل = 21:45، و«موجود إلى ١» = 1 بعد نص الليل
      const pm = m => (m != null && m < 720 && m < t.m - 30 && m + 720 > t.m - 30) ? m + 720 : m;
      const nextDay = m => (m != null && m < t.m - 30) ? m + 1440 : m;
      // مجدول من أمس (يتطبّق أول اليوم): «لين 7» = 7م — نختار الوقت الأقرب لدوامه (مو حسب الساعة الحين)
      const fit = m => fitMin(m, d, t.wd);
      const at = Date.now(), atMin = ctx.planned ? fit(toMin(e.at_time)) : pm(toMin(e.at_time)), untilMin = ctx.planned ? fit(toMin(e.until_time)) : nextDay(pm(toMin(e.until_time)));
      const name = d ? shortName(d.name) : e.name, dep = d ? d.dep : (e.dept || "");
      let info = "";
      if (e.kind === "stop" && atMin != null && atMin > t.m + 1) {      // «الساعة 9:45 وقف له» → نجدوله
        cur.scheduled = cur.scheduled.filter(x => x.key !== key);         // رسالة مكررة → جدولة وحدة
        cur.scheduled.push({ id: uid(), min: atMin, key, kind: "stop", name, dep, by: ctx.by });
        cur.st[key] = { kind: "stop_at", from: atMin, at, by: ctx.by };
        cur.events.push({ id: uid(), at, kind: "stop_at", doctorId: d?.id || "", name, dep, info: `يوقف الساعة ${hm(atMin)}`, title: "🕐 بيوقف الاستقبال", color: "orange", by: ctx.by });
        applied.push("stop_at"); (ctx.rep ||= []).push(`🕐 د. ${name} — يوقف الساعة ${hm(atMin)}\n   الموقع: «يوقف ${hm(atMin)}» وبعدها «وقف» · الأداة: تنبيه الحين وتنبيه ${hm(atMin)}`); continue;
      }
      if (e.kind === "appointments_only" && atMin != null && atMin > t.m + 1) {   // «يستقبل انتظار لين 5» → من 5 مواعيد بس
        cur.scheduled = cur.scheduled.filter(x => !(x.key === key && x.kind === "appt"));
        cur.scheduled.push({ id: uid(), min: atMin, key, kind: "appt", name, dep, by: ctx.by });
        if (cur.st[key]) cur.st[key].apptFrom = atMin; else cur.st[key] = { kind: "appt_at", from: atMin, at, by: ctx.by };
        cur.events.push({ id: uid(), at, kind: "appt_at", doctorId: d?.id || "", name, dep, room: d?.room || "", ext: d?.ext || "", info: `يستقبل انتظار لين ${hm(atMin)}، وبعدها مواعيد فقط`, title: "⏳ انتظار لين " + hm(atMin), color: "orange", by: ctx.by });
        applied.push("appt_at"); (ctx.rep ||= []).push(`⏳ د. ${name} — يستقبل انتظار لين ${hm(atMin)} وبعدها مواعيد فقط\n   الموقع: تتغيّر حالته ${hm(atMin)} · الأداة: تنبيه الحين وتنبيه ${hm(atMin)}`); continue;
      }
      if (["resume", "absent_today", "stop", "starts_at", "free"].includes(e.kind)) cur.scheduled = cur.scheduled.filter(x => x.key !== key || (e.kind === "starts_at" && x.kind === "appt"));
      if (e.kind === "resume") delete cur.st[key];
      else if (e.kind === "late") { const from = atMin ?? (t.m + (e.delay_minutes || 30)); cur.st[key] = { kind: "late", from, at, by: ctx.by }; info = `يوصل تقريباً ${hm(from)}`; }
      else if (e.kind === "leaves_at") {
        const lu = nextDay(atMin) ?? untilMin;
        cur.st[key] = { kind: "leaves", until: lu, at, by: ctx.by }; info = atMin != null ? `يطلع الساعة ${hm(atMin)}` : "";
        if (lu != null && lu > t.m && lu < 1440) { cur.scheduled = cur.scheduled.filter(x => !(x.key === key && x.kind === "off")); cur.scheduled.push({ id: uid(), min: lu, key, kind: "off", name, dep, by: ctx.by }); }   // بعد ما يطلع: البطاقة «خلص دوامه اليوم» (مو يرجع لدوامه العادي)
      }
      else if (e.kind === "starts_at") { const ap = cur.scheduled.find(x => x.key === key && x.kind === "appt"); cur.st[key] = { kind: "starts", from: atMin, until: untilMin, at, by: ctx.by, ...(ap ? { apptFrom: ap.min } : {}) };
        if (untilMin != null && untilMin > t.m && untilMin < 1440) { cur.scheduled = cur.scheduled.filter(x => !(x.key === key && x.kind === "off")); cur.scheduled.push({ id: uid(), min: untilMin, key, kind: "off", name, dep, by: ctx.by }); }   // بعد نهايته: «غير متواجد»
        info = atMin != null ? `اليوم من ${hm(atMin)}${untilMin != null ? " إلى " + hm(untilMin) : ""}` : ""; }
      else if (e.kind === "present") {
        cur.st[key] = { kind: "present", until: untilMin, at, by: ctx.by }; info = untilMin != null ? `موجود لين ${hm(untilMin)}` : "";
        if (untilMin != null && untilMin > t.m && untilMin < 1440) { cur.scheduled = cur.scheduled.filter(x => !(x.key === key && x.kind === "off")); cur.scheduled.push({ id: uid(), min: untilMin, key, kind: "off", name, dep, by: ctx.by }); }   // بعد الوقت: «خلص دوامه اليوم»
        if (!d && !cur.extra.some(x => x.key === key)) cur.extra.push({ key, name, dep, until: untilMin });
      }
      else if (e.kind === "busy") { cur.st[key] = { kind: "busy", count: e.waiting || 0, at, by: ctx.by }; info = e.waiting ? `${e.waiting} بالانتظار — بلّغوا اللي ما عندهم موعد` : ""; }
      else if (e.kind === "appointments_only") { cur.st[key] = { kind: "appt", at, by: ctx.by }; info = "لا تدخّلون حالات بدون موعد"; }
      else if (e.kind === "free") cur.st[key] = { kind: "free", at, by: ctx.by };
      else if (e.kind === "absent_today") cur.st[key] = { kind: "absent", at, by: ctx.by };
      else if (e.kind === "stop") cur.st[key] = { kind: "stop", at, by: ctx.by };
      const [title, color] = TITLES[e.kind] || ["ℹ️ تحديث", "blue"];
      cur.events.push({ id: uid(), at, kind: e.kind, doctorId: d?.id || "", name, dep, room: d?.room || "", ext: d?.ext || "", info, title, color, by: ctx.by });
      (ctx.rep ||= []).push(`${title} — د. ${name}${info ? ": " + info : ""}\n   الموقع: حالته اليوم «${title.replace(/^\S+\s/, "")}» · الأداة: تنبيه للموظفين${["stop", "free", "resume"].includes(e.kind) ? " (3 دقايق)" : ""}`);
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
    const dd = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
    for (const { d, e } of vacs) {
      // نفس الإجازة مسجّلة (من الموارد البشرية أو رسالة قبل)؟ ما نكررها — بس نمدّد النهاية لو أطول
      const same = (next.vacations ||= []).find(v => v.doctorId === d.id && v.start && e.start_date && (dd(v.start, e.start_date) <= 3 || (v.start <= e.start_date && (!v.end || v.end >= e.start_date))));
      if (same) { if (e.end_date && same.end && e.end_date > same.end) same.end = e.end_date; continue; }
      next.vacations.push({ id: uid(), doctorId: d.id, code: d.code || "", name: d.name, start: e.start_date, end: e.end_date || "", type: "إجازة" });
    }
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: `إجازة ${vacs.map(v => "د. " + shortName(v.d.name)).join("، ")} من القروب` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "إجازة من القروب" }); tx.set(ref, next);
  });
  if (inbox.length) await db.doc("board/bawadi_inbox").set({ items: FieldValue.arrayUnion(...inbox), at: Date.now() }, { merge: true });
  if (plans.length) await db.doc("board/bawadi_plan").set({ items: FieldValue.arrayUnion(...plans), at: Date.now() }, { merge: true });
  if (upd.length) await updateSchedules(upd, ctx);
  if (backs.length) await endVacations(backs, ctx);
  if (heres.length) await endVacationsToday(heres, ctx);
  for (const x of leavers) await askRemove(x.d, x.e, ctx);
  for (const a of asks) await askOptions(a, ctx).catch(err => log.warn({ err: String(err?.message || err) }, "خيارات الدوام"));
  for (const x of newDocs) await askAdmin(x, ctx);
  return applied;
}

/* ---------- تغيير دوام → خيارات للمسؤول، يختار رقم، نطبّق الخيار الجاهز ونتأكد إنه انحفظ ---------- */
const TODAYW = /(^|\s)(اليوم|الليله)(\s|$)/;
const futureDay = (e, text, t) => (/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && e.date > t.iso ? e.date : null) || (() => { const d = textDay(text); return d && d > t.iso ? d : null; })();
function needsConfirm(e, text, t) {                                            // التغيير الدائم بس — «اليوم/بكرة فقط» حالة يومية تنطبق على طول
  if (e.kind === "schedule_change") { const n = norm(text); return EVERY.test(n) || PERMANENT.test(n) || !(dayOf(text) || TODAYW.test(n)); }   // «اليوم/بكرة/الخميس دوامه…» = يوم واحد → على طول
  if (["starts_at", "leaves_at", "present", "free"].includes(e.kind) && EVERY.test(norm(text))) return true;   // «كل خميس…»
  return false;
}
const daysIn = text => { const n = norm(text), out = []; for (const [k, i] of DAYW) if (new RegExp("(^|\\s)(يوم\\s+)?(ال|و|وال)?" + k + "(\\s|$)").test(n) && !out.includes(i)) out.push(i); return out; };
const nextOcc = (wd, t) => isoPlus(t.iso, ((wd - t.wd + 7) % 7) || 7);
const T = sh => (sh || []).map(x => hm(x.s) + " – " + hm(x.e)).join(" و ") || "—";
const dm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
function buildOptions(d, e, text, t) {
  const sc = schedOf(text), ok = k => e[k] && timeInText(e[k], text) ? toMin(e[k]) : null;
  const from = ok("from_time") ?? ok("at_time") ?? sc.from, to = ok("to_time") ?? ok("until_time") ?? sc.to;
  if (from == null || to == null) return null;
  const shifts = [{ s: from, e: to }], wd = (d.workdays || []).slice().sort((a, b) => a - b), n = norm(text);
  const named = everyDays(text).length ? everyDays(text) : (Array.isArray(e.days) && e.days.length ? e.days : daysIn(text)).filter(x => x !== 5);
  const fut = futureDay(e, text, t) || (named.length === 1 && !EVERY.test(n) ? nextOcc(named[0], t) : null);
  const opts = [];
  if (named.length && named.every(x => wd.includes(x)) && named.length < wd.length)
    opts.push({ label: `كل ${named.map(i => DAYN[i].replace(/^ال/, "")).join(" و")} ${T(shifts)}، وباقي الأيام زي ما هي (${T(d.shifts)})`, act: { type: "alt", days: named, shifts } });
  if (fut) opts.push({ label: `${DAYN[new Date(fut + "T12:00:00Z").getUTCDay()]} ${dm(fut)} بس ${T(shifts)}، والجدول الثابت ما يتغير`, act: { type: "plan", date: fut, at: hhmm(from), until: hhmm(to) } });
  if (/(^|\s)(اليوم|الليله)(\s|$)/.test(n)) opts.push({ label: `اليوم بس ${T(shifts)}`, act: { type: "today", at: hhmm(from), until: hhmm(to) } });
  opts.push({ label: `كل أيامه (${wd.map(i => DAYN[i]).join("، ")}) صارت ${T(shifts)}`, act: { type: "set", shifts } });
  if (named.length >= 2 && JSON.stringify(named.slice().sort()) !== JSON.stringify(wd)) opts.push({ label: `أيام دوامه صارت ${named.map(i => DAYN[i]).join("، ")} بس · ${T(shifts)}`, act: { type: "setdays", days: named, shifts } });
  if (PERMANENT.test(n) && !EVERY.test(n)) { const i = opts.findIndex(o => o.act.type === "set"); if (i > 0) opts.unshift(...opts.splice(i, 1)); }   // «دائم/من الحين» → الكل أول
  opts.push({ label: "ولا شي — تجاهلها", act: { type: "none" } });
  return opts;
}
async function askOptions({ d, e }, ctx) {
  const t = nowR(), opts = buildOptions(d, e, ctx.text, t);
  if (!opts) { if (ctx.m) await askClarify(ctx.m, ctx.text, ctx.by, Object.assign([e], { question: `ما فهمت وقت الدوام الجديد لد. ${shortName(d.name)} — اكتبه لي` })); return; }
  const code = "S" + code3().slice(0, 2);
  const item = { code, at: Date.now(), text: ctx.text.slice(0, 600), by: ctx.by, doctorId: d.id, name: shortName(d.name), opts, key: ctx.m?.key ? { remoteJid: ctx.m.key.remoteJid, id: ctx.m.key.id, participant: ctx.m.key.participant || "" } : null };
  const ref = db.doc("bot/pending_clarify");
  await db.runTransaction(async tx => { const c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: [...(c.items || []).filter(i => Date.now() - i.at < 24 * 3600e3), item].slice(-20) }); });
  const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
  await dmAdmin([`🤔 ${ctx.by} كتب في القروب:  #${code}`, `«${ctx.text.slice(0, 300)}»`, "", `د. ${shortName(d.name)} — وش المقصود؟`, ...opts.map((o, i) => `${nums[i] || i + 1 + "."} ${o.label}`), "", "رد برقم الخيار، أو اكتب الصح بكلامك."].join("\n"));
}
async function applyOption(it, o) {
  const d = docs().find(x => x.id === it.doctorId); if (!d) return { ok: false, why: "الدكتور ما عاد موجود في الجدول" };
  const a = o.act, by = it.by + " (اختيار المسؤول)";
  if (a.type === "none") return { ok: true, none: true };
  if (a.type === "alt" || a.type === "set" || a.type === "setdays") {
    const sch = a.type === "alt" ? { days: a.days, shifts: a.shifts, altOnly: true } : a.type === "set" ? { days: [], shifts: a.shifts } : { days: a.days, shifts: a.shifts };
    await updateSchedules([{ d, sch }], { by });
  } else {
    await apply([{ kind: "starts_at", doctor_id: d.id, name: shortName(d.name), at_time: a.at, until_time: a.until, ...(a.type === "plan" ? { date: a.date } : {}) }], { text: "", by, rep: [], confirmed: true });
  }
  // نتأكد من القاعدة نفسها إنه انحفظ (ما نصدّق نفسنا)
  await new Promise(r => setTimeout(r, 1200));
  const J = x => JSON.stringify((x || []).map(y => [y.s, y.e]));
  if (a.type === "plan") { const items = (await db.doc("board/bawadi_plan").get()).data()?.items || []; return { ok: items.some(i => i.doctorId === d.id && i.date === a.date && i.at_time === a.at) }; }
  if (a.type === "today") { const st = (await db.doc("board/bawadi_today").get()).data()?.st?.[d.id]; return { ok: !!st && st.from === toMin(a.at) }; }
  const b = (await db.doc("board/bawadi").get()).data(), x = (b?.departments || []).flatMap(p => p.doctors || []).find(y => y.id === d.id);
  if (!x) return { ok: false, why: "ما لقيت الدكتور" };
  if (a.type === "alt") return { ok: !!x.alt && a.days.every(i => x.alt.days.includes(i)) && J(x.alt.shifts) === J(a.shifts), why: x.alt && J(x.alt.shifts) !== J(a.shifts) ? `عنده ${x.alt.days.map(i => DAYN[i]).join(" و")} بدوام ثاني (${T(x.alt.shifts)})` : "" };
  if (a.type === "set") return { ok: J(x.shifts) === J(a.shifts) };
  return { ok: J(x.shifts) === J(a.shifts) && JSON.stringify((x.workdays || []).slice().sort()) === JSON.stringify(a.days.slice().sort()) };
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
      if (sch.altOnly) {                                                          // دوام مختلف ليوم/أيام معيّنة، باقي الأيام زي ما هي
        const J = x => JSON.stringify((x || []).map(y => [y.s, y.e]));
        if (J(t.shifts) === J(sch.shifts)) {                                      // نفس دوامه العادي → اليوم يرجع عادي
          if (t.alt) { t.alt.days = t.alt.days.filter(x => !sch.days.includes(x)); if (!t.alt.days.length) delete t.alt; }
        } else if (t.alt && J(t.alt.shifts) !== J(sch.shifts)) {
          if (t.alt.days.every(x => sch.days.includes(x))) t.alt = { days: [...sch.days].sort((x, y) => x - y), shifts: sch.shifts };
          else { done.push({ name: shortName(t.name), sch, fail: `عنده ${t.alt.days.map(i => DAYN[i]).join(" و")} بدوام ثاني — عدّله من صفحة الأطباء` }); continue; }
        } else t.alt = { days: [...new Set([...(t.alt?.days || []), ...sch.days])].sort((x, y) => x - y), shifts: sch.shifts };
        done.push({ name: shortName(t.name), sch }); continue;
      }
      if (sch.days?.length) t.workdays = sch.days;
      if (sch.shifts) { t.shifts = sch.shifts; delete t.alt; }
      for (const f of ["room", "ext", "fee"]) if (sch[f]) t[f] = sch[f];
      done.push({ name: shortName(t.name), sch });
    }
    if (!done.some(x => !x.fail)) return;
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: `دوام ${done.filter(x => !x.fail).map(x => "د. " + x.name).join("، ")} من القروب` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "تعديل دوام من القروب" }); tx.set(ref, next);
  });
  for (const x of done.filter(x => x.fail)) await dmAdmin(`⚠️ ما عدّلت دوام د. ${x.name}: ${x.fail}\n(رسالة ${ctx.by})`);
  if (!reportsOn) for (const x of done.filter(x => !x.fail)) await dmAdmin(`✏️ عدّلت د. ${x.name} في الجدول\n${schedTxt(x.sch)}${x.sch.fee ? " · كشفية " + x.sch.fee : ""}\n(من رسالة ${ctx.by})\n\nلو فيه غلط رد «تراجع».`);
}

// يرجع من إجازة: نقفل الإجازة المفتوحة/الحالية يوم قبل المباشرة
async function endVacations(list, ctx) {
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur); let n = 0;
    for (const { d, day } of list) {
      const end = isoPlus(day, -1);
      const vs = (next.vacations || []).filter(v => (v.doctorId === d.id || (d.code && String(v.code) === String(d.code))) && v.start <= end && (!v.end || v.end > end));   // كل إجازاته المفتوحة
      for (const v of vs) { v.end = end; n++; }
    }
    if (!n) return;
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: "نهاية إجازة من القروب" }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "نهاية إجازة" }); tx.set(ref, next);
  });
}
// «موجود» وهو في إجازة: الإجازة اللي بدأت قبل اليوم تخلص أمس، واللي تبدأ اليوم تتأخر لبكرة (أو تنشال لو هي يوم واحد)
const HERE_KINDS = new Set(["present", "starts_at", "late", "free", "resume", "busy", "appointments_only", "leaves_at", "stop"]);
function onVacation(d, iso) { return (board?.vacations || []).some(v => (v.doctorId === d.id || (d.code && String(v.code) === String(d.code))) && v.start <= iso && (!v.end || v.end >= iso)); }
async function endVacationsToday(list, ctx) {
  const iso = nowR().iso, y = isoPlus(iso, -1), tm = isoPlus(iso, 1), names = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur); let n = 0;
    for (const { d } of list) {
      const mine = v => (v.doctorId === d.id || (d.code && String(v.code) === String(d.code))) && v.start <= iso && (!v.end || v.end >= iso);
      const hit = (next.vacations || []).filter(mine); if (!hit.length) continue;
      for (const v of hit) { if (v.start < iso) v.end = y; else if (v.end && v.end <= iso) v.drop = true; else v.start = tm; n++; }
      names.push(shortName(d.name));
    }
    if (!n) return;
    next.vacations = (next.vacations || []).filter(v => !v.drop);
    next.log = [{ at: Date.now(), by: `البوت (${ctx.by})`, what: `رجع من الإجازة (موجود اليوم): ${names.map(x => "د. " + x).join("، ")}` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "نهاية إجازة (موجود)" }); tx.set(ref, next);
  });
  if (!reportsOn) for (const nm of names) await dmAdmin(`🔙 د. ${nm} كان عليه إجازة وجات رسالة إنه موجود اليوم — قفلت إجازته، وصار يطلع «موجود».\n(من رسالة ${ctx.by})\n\nلو غلط رد «تراجع».`);
}
// طبيب بيروح من الفرع → نسأل المسؤول «أشيله؟»
async function askRemove(d, e, ctx) {
  const code = "D" + code3().slice(0, 2), ref = db.doc("bot/pending_clarify");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || "") ? e.start_date : "";
  await db.runTransaction(async tx => { const c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: [...(c.items || []).filter(i => Date.now() - i.at < 3 * DAY), { code, at: Date.now(), text: ctx.text.slice(0, 600), by: ctx.by, key: null, evs: [], remove: { id: d.id, name: shortName(d.name), from } }].slice(-30) }); });
  await dmAdmin(`👋 د. ${shortName(d.name)} بيروح من الفرع؟  #${code}\nمن رسالة ${ctx.by}: «${ctx.text.slice(0, 200)}»\n\nأشيله من الجدول؟ اسحب هذي الرسالة ورد «نعم» أو «لا».`);
}
async function removeDoctor(id, by) {
  let name = "";
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), prev = db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    for (const p of next.departments) { const i = (p.doctors || []).findIndex(x => x.id === id); if (i >= 0) { name = shortName(p.doctors[i].name); p.doctors.splice(i, 1); } }
    if (!name) return;
    next.departments = next.departments.filter(p => (p.doctors || []).length || p.notes);
    next.log = [{ at: Date.now(), by, what: `شال د. ${name}` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "حذف طبيب" }); tx.set(ref, next);
  });
  return name;
}

/* ---------- يتعلّم الأسماء: اسم ما انعرف في القروب والمسؤول قال مين هو → يحفظه للمرة الجاية ---------- */
const cleanAlias = n => String(n || "").replace(/^(د|دكتور|دكتوره|الدكتور|الدكتوره|dr)\.?\s+/i, "").replace(/\s+/g, " ").trim().slice(0, 40);
async function learnAliases(origEvs, newEvs) {
  const ids = [...new Set((newEvs || []).map(e => e.doctor_id || matchDoctor(e.name, e.dept)?.id).filter(Boolean))];
  if (ids.length !== 1) return;                                                       // نتعلّم بس لما التصحيح عن طبيب واحد
  const id = ids[0], d = docs().find(x => x.id === id); if (!d) return;
  const names = [...new Set((origEvs || []).map(e => cleanAlias(e.name)).filter(n => norm(n).replace(/\s/g, "").length >= 3))]
    .filter(n => !sameName(n, d) && matchDoctor(n)?.id !== id);
  if (!names.length) return;
  let saved = [];
  await db.runTransaction(async tx => {
    const ref = db.doc("board/bawadi"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    for (const p of next.departments) for (const x of p.doctors || []) if (x.id === id) {
      const have = new Set((x.aliases || []).map(norm));
      saved = names.filter(n => !have.has(norm(n)));
      if (saved.length) x.aliases = [...(x.aliases || []), ...saved].slice(-8);
    }
    if (!saved.length) return;
    next.log = [{ at: Date.now(), by: "البوت (تعلّم من المسؤول)", what: `اسم ثاني لد. ${shortName(d.name)}: ${saved.join("، ")}` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(ref, next);
  });
  if (saved.length) await dmAdmin(`📝 حفظت «${saved.join("» و«")}» اسم ثاني لد. ${shortName(d.name)} — المرة الجاية بفهمه على طول.`);
}

/* ---------- طبيب مو موجود → رسالة للمسؤول على الخاص: يضيفه أو لا ---------- */
const adminJids = new Map();
const adminLog = [];                       // آخر رسائلنا للمسؤول (سياق لما يسأل «ليش؟»)
export async function dmAdmin(text) {
  adminLog.push({ at: Date.now(), text: String(text).slice(0, 700) }); while (adminLog.length > 8) adminLog.shift();
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
// رسالة خاصة لرقم واحد (ماجد)
async function dmTo(p, text) {
  const sock = getSock(); if (!sock || !p) return false;
  try {
    let jid = adminJids.get(p);
    if (!jid) { const [r] = await sock.onWhatsApp("966" + p); jid = r?.exists ? r.jid : ""; if (jid) adminJids.set(p, jid); }
    if (jid) { await sock.sendMessage(jid, { text }); return true; }
  } catch (e) { log.warn({ err: String(e?.message || e) }, "رسالة خاصة"); }
  return false;
}
// رقم كاتب رسالة القروب (9 أرقام)
async function groupSender(m) {
  let pj = m.key?.participantAlt || m.key?.participant || "";
  if (pj.endsWith("@lid")) { try { pj = (await getSock()?.signalRepository?.lidMapping?.getPNForLID?.(pj)) || ""; } catch { pj = ""; } }
  return String(pj).split(/[:@]/)[0].replace(/\D/g, "").replace(/^966/, "");
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

/* ---------- تقرير للمسؤول: كل رسالة قروب انطبقت (يقدر يوقفه بـ «وقف التقارير») ---------- */
let reportsOn = true;
async function reportToAdmin(by, text, rep) {
  if (!reportsOn || !admins.length) return;
  const code = "R" + code3().slice(0, 2), ref = db.doc("bot/pending_clarify");
  await db.runTransaction(async tx => { const c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: [...(c.items || []).filter(i => Date.now() - i.at < 12 * 3600e3), { code, at: Date.now(), text: text.slice(0, 600), by, key: null, evs: [], report: true }].slice(-30) }); });
  await dmAdmin(`✅ قريت رسالة ${by}:  #${code}\n«${text.slice(0, 250)}»\n\nاللي سويته:\n${rep.join("\n")}\n\nلو فيه غلط: اسحب هذي الرسالة واكتب الصح بكلامك.`);
}

/* ---------- رسالة قروب مو واضحة → نسأل المسؤول ---------- */
const KIND_AR = { returns: "يباشر بعد الإجازة", info_change: "تعديل كشفية/غرفة", leaves_branch: "بيروح من الفرع", stop: "وقف استقبال", resume: "رجع يستقبل", free: "فاضي (دخلوا له)", appointments_only: "مواعيد فقط", busy: "زحمة/انتظار", absent_today: "غير متواجد", late: "متأخر", leaves_at: "يطلع بدري", starts_at: "دوام اليوم", present: "متواجد", vacation: "إجازة", new_doctor: "طبيب جديد", moved: "انتقل", schedule_change: "تغيير دوام ثابت" };
function describeEvs(evs) {
  return (evs || []).map(e => {
    const d = (e.doctor_id && docs().find(x => x.id === e.doctor_id)) || matchDoctor(e.name, e.dept);
    const a = toMin(e.at_time), u = toMin(e.until_time);
    const when = [e.date ? "يوم " + e.date.split("-").reverse().slice(0, 2).join("/") : "", a != null ? (e.kind === "starts_at" ? "من " : "الساعة ") + hm(a) : "", u != null ? "إلى " + hm(u) : "", e.start_date ? "من " + e.start_date : "", e.end_date ? "إلى " + e.end_date : ""].filter(Boolean).join(" ");
    return `• د. ${d ? shortName(d.name) : (e.name || "؟")}: ${KIND_AR[e.kind] || e.kind}${when ? " — " + when : ""}`;
  }).join("\n");
}
async function askClarify(m, text, by, evs, owner = "") {
  const code = "Q" + code3().slice(0, 2);
  const item = { code, at: Date.now(), text: text.slice(0, 600), by, key: m.key ? { remoteJid: m.key.remoteJid, id: m.key.id, participant: m.key.participant || "" } : null, evs: JSON.parse(JSON.stringify(Array.from(evs || []))), ...(owner ? { owner } : {}) };
  const ref = db.doc("bot/pending_clarify");
  await db.runTransaction(async tx => { const c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: [...(c.items || []).filter(i => Date.now() - i.at < 12 * 3600e3), item].slice(-20) }); });
  const sum = describeEvs(evs);
  return (owner === "majed" ? t => dmTo(majed, t) : dmAdmin)([
    `🤔 ما فهمت رسالة القروب زين  #${code}`,
    `من ${by}: «${text.slice(0, 300)}»`,
    evs?.question ? `\nسؤالي: ${evs.question}` : "",
    sum ? `\nاللي فهمته:\n${sum}\n\nإذا صح رد «صح».` : "\nما قدرت أطلع منها شي.",
    `أو اسحب هذي الرسالة واكتب المقصود بكلامك (مثل: د رائد اليوم بس من 2 إلى 7، وانتظار لين 5).`,
  ].filter(Boolean).join("\n"));
}
async function handleClarify(m, text, who = "admin") {
  const say = who === "majed" ? t => dmTo(majed, t) : dmAdmin;
  const ref = db.doc("bot/pending_clarify");
  const items = ((await ref.get()).data()?.items || []).filter(i => Date.now() - i.at < 12 * 3600e3);
  const mine = who === "majed" ? items.filter(i => i.owner === "majed" && !i.report && !i.remove) : items;   // ماجد: بس أسئلة رسايله
  if (!mine.length) return false;
  const ctxi = m.message?.extendedTextMessage?.contextInfo;
  const qt = ctxi?.quotedMessage?.conversation || ctxi?.quotedMessage?.extendedTextMessage?.text || "";
  const code = (/#([QRDS][A-Z0-9]{2})\b/.exec(qt) || [])[1];
  let it = code ? mine.find(i => i.code === code) : null;
  const n = norm(text);
  if (/^تراجع/.test(n)) return false;
  const qs = mine.filter(i => !i.report && !i.remove);
  if (!it && !qt && qs.length === 1 && Date.now() - qs[0].at < 30 * 60000) it = qs[0];   // سؤال واحد قريب وما سحب رسالة ثانية → رده عليه
  if (!it) return false;
  let evs, how;
  if (it.opts && who !== "majed") {                                              // خيارات تغيير الدوام: رقم = نطبّق الخيار الجاهز
    const num = parseInt(latin(text).replace(/[^\d]/g, "").slice(0, 1) || "0", 10), o = it.opts[num - 1];
    if (o && /^\s*[0-9٠-٩]\s*[.)\-]?\s*$/.test(text.replace(/[️⃣]/g, ""))) {
      await db.doc("bot/pending_clarify").set({ items: items.filter(i => i.code !== it.code) });
      const r = await applyOption(it, o).catch(err => ({ ok: false, why: String(err?.message || err).slice(0, 120) }));
      if (r.none) { await say("تمام، تجاهلتها."); return true; }
      if (!r.ok) { const r2 = await applyOption(it, o).catch(() => r); if (r2.ok) Object.assign(r, r2); }   // محاولة ثانية
      await say(r.ok ? `✅ انحفظ في الجدول وتأكدت منه: د. ${it.name} — ${o.label}` : `❌ ما انحفظ: د. ${it.name} — ${o.label}${r.why ? "\n" + r.why : ""}\nعدّله من صفحة الأطباء.`);
      if (r.ok && it.key?.id) { try { await getSock()?.sendMessage(it.key.remoteJid, { react: { text: "✅", key: { ...it.key, participant: it.key.participant || undefined } } }); } catch {} }
      return true;
    }
  }
  if (it.remove) {
    if (/^(نعم|ايوه|ايوا|اي|ايه|اشيله|شيله|احذفه|تمام|اوكي|ok)(\s|$)/.test(n)) {
      await db.doc("bot/pending_clarify").set({ items: items.filter(i => i.code !== it.code) });
      if (it.remove.from && it.remove.from > nowR().iso) { await db.doc("board/bawadi_plan").set({ items: FieldValue.arrayUnion({ id: uid(), date: it.remove.from, doctorId: it.remove.id, kind: "remove_doctor", by: "المسؤول" }) }, { merge: true }); await say(`تمام، بشيل د. ${it.remove.name} من الجدول يوم ${it.remove.from.split("-").reverse().slice(0, 2).join("/")}.`); }
      else { const nm = await removeDoctor(it.remove.id, "البوت (موافقة المسؤول)"); await say(nm ? `✅ شلت د. ${nm} من الجدول. (لو غلط رد «تراجع»)` : "ما لقيته في الجدول."); }
      return true;
    }
    if (/^(لا|خله|خليه|اتركه)(\s|$)/.test(n)) { await db.doc("bot/pending_clarify").set({ items: items.filter(i => i.code !== it.code) }); await say(`تمام، د. ${it.remove.name} باقي في الجدول.`); return true; }
  }
  if (it.report && /^(صح|صحيح|تمام|اوكي|ok|👍)(\s|$)/.test(n)) { await say("👍"); return true; }
  if (/^(صح|صحيح|ايوه|ايوا|نعم|اي|ايه|تمام|اوكي|ok|طبق|طبقها)(\s|$)/.test(n) && it.evs?.length) { evs = it.evs; how = "زي ما فهمتها"; }
  else if (/^(لا|تجاهل|خلها|اتركها|ولا شي|ولاشي)(\s|$)/.test(n)) { await db.doc("bot/pending_clarify").set({ items: items.filter(i => i.code !== it.code) }); await say("تمام، تجاهلتها."); return true; }
  else {
    evs = await aiParse(`تصحيح من ${who === "majed" ? "كاتب الرسالة" : "المسؤول"} على رسالة القروب «${it.text}»:\n${text}`, it.text); if (evs == null) evs = ruleParse(text, it.text); how = "حسب كلامك";
    if (!evs.length) { await say("ما فهمت تصحيحك 🙏 اكتبها بشكل أوضح (اسم الطبيب + وش صار + الوقت)."); return true; }
  }
  await db.doc("bot/pending_clarify").set({ items: items.filter(i => i.code !== it.code) });
  const cctx = { text: (text || "") + "\n" + (it.text || ""), by: it.by + (who === "majed" ? " (تصحيح ماجد)" : " (تصحيح)"), rep: [], fix: true, fixText: text || "" };
  const applied = await apply(evs, cctx);
  if (applied.length && how === "حسب كلامك") learnAliases(it.evs, evs).catch(e => log.warn({ err: String(e?.message || e) }, "تعلّم الاسم"));
  const real = applied.filter(a => a !== "known");
  const bad = real.length ? await verifyApplied(evs, cctx).catch(err => [String(err?.message || err)]) : [];
  if (!real.length) { await say("ما انطبق شي — تأكد من اسم الطبيب ووش يتغيّر."); return true; }
  if (bad.length) { await say(`❌ طبّقتها بس ما لقيتها محفوظة في الموقع: ${bad.join("، ")}\nأرسلها مرة ثانية أو عدّلها من صفحة الأطباء.`); return true; }
  await say(`✅ طبّقتها ${how} وتأكدت إنها انحفظت:\n${cctx.rep.length ? cctx.rep.join("\n") : describeEvs(evs)}`);
  if (it.key?.id) { try { await getSock()?.sendMessage(it.key.remoteJid, { react: { text: "✅", key: { ...it.key, participant: it.key.participant || undefined } } }); } catch {} }
  return true;
}

// ماجد رد على سؤال البوت عن رسالته في القروب
export async function handleMajedMessage(m, text) { try { return await handleClarify(m, text, "majed"); } catch (e) { log.warn({ err: String(e?.message || e) }, "تصحيح ماجد"); return false; } }

/* ---------- المسؤول يكتب كلام عادي (سؤال «ليش؟» أو تصحيح بدون ما يسحب رسالة) ---------- */
const ASSIST = `أنت بوت قروب استقبال عيادات سابا (فرع البوادي). تكلّم المسؤول (أنس) على الخاص باللهجة السعودية وباختصار.
عندك: آخر رسائلك له (تقارير وش سويت بالجدول)، ورسائل القروب الأصلية، وبيانات الأطباء المذكورين.
- لو يسأل ليش سويت شي أو من وين جبت معلومة: جاوب بصراحة من السياق. لو أخطأت أو اخترعت (مثل وقت مو مكتوب) اعترف بجملة وحدة واقترح التصحيح.
- لو يطلب تصحيح أو يعطيك معلومة: حط الأحداث في events بنفس أنواع القروب (للطبيب المقصود)، و reply يقول وش بتسوي.
- لو يطلب ترجع آخر تعديل: undo = true.
- لا تخترع أوقات أو أرقام ما قالها هو أو ما كانت في الرسالة.`;
async function adminAssist(m, text) {
  const recent = adminLog.filter(x => Date.now() - x.at < 2 * 3600e3);
  const items = ((await db.doc("bot/pending_clarify").get()).data()?.items || []).filter(i => Date.now() - i.at < 3 * 3600e3).slice(-3);
  if (!gemini || (!recent.length && !items.length)) { await dmAdmin("أنا معك 👋 لو تبغى تصحّح شي سويته، اسحب رسالتي (رد) واكتب الصح. ولو تبغى ترجع آخر تعديل اكتب «تراجع»."); return true; }
  const names = [...new Set((items.map(i => i.text).join(" ") + " " + recent.map(r => r.text).join(" ") + " " + text).match(/د\.?\s*[^\s،,.:]+(\s[^\s،,.:]+)?/g) || [])].slice(0, 6);
  const ds = names.map(nm => matchDoctor(nm.replace(/^د\.?\s*/, ""))).filter(Boolean);
  const info = [...new Set(ds)].map(d => `${d.id} | ${shortName(d.name)} | ${d.dep} | الدوام: ${(d.shifts || []).map(x => hm(x.s) + "-" + hm(x.e)).join(" و ") || "—"} | الأيام: ${(d.workdays || []).map(i => DAYN[i]).join("،")} | كشفية ${d.fee || "—"} | غرفة ${d.room || "—"}`).join("\n");
  const t = nowR();
  const body = {
    systemInstruction: { parts: [{ text: ASSIST + `\nاليوم ${t.iso}. الأنواع: ${KINDS.join(", ")}.\n\nرسائل القروب الأخيرة:\n${items.map(i => "«" + i.text + "»").join("\n") || "—"}\n\nآخر رسائلك للمسؤول:\n${recent.map(r => r.text).join("\n---\n")}\n\nبيانات الأطباء:\n${info || "—"}` }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { reply: { type: "STRING" }, undo: { type: "BOOLEAN" }, events: { type: "ARRAY", items: { type: "OBJECT", properties: {
        doctor_id: { type: "STRING" }, name: { type: "STRING" }, kind: { type: "STRING", enum: KINDS }, at_time: { type: "STRING" }, until_time: { type: "STRING" }, date: { type: "STRING" },
        start_date: { type: "STRING" }, end_date: { type: "STRING" }, fee: { type: "STRING" }, room: { type: "STRING" }, ext: { type: "STRING" },
        days: { type: "ARRAY", items: { type: "INTEGER" } }, from_time: { type: "STRING" }, to_time: { type: "STRING" } }, required: ["name", "kind"] } } }, required: ["reply"] } },
  };
  let out = null;
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": gemini }, body: JSON.stringify(body) });
      if (!res.ok) continue;
      out = JSON.parse((await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "{}"); break;
    } catch {}
  }
  if (!out) { await dmAdmin("ما قدرت أفهم الحين 🙏 اسحب رسالتي اللي تبغى تصحّحها واكتب الصح."); return true; }
  if (out.undo) { await restorePrev(); }
  const evs = (out.events || []).filter(e => KINDS.includes(e.kind) && e.kind !== "none");
  let rep = [];
  if (evs.length) { const c = { text: text + "\n" + items.map(i => i.text).join("\n"), by: "أنس (الخاص)", rep: [] }; await apply(evs, c); rep = c.rep; }
  await dmAdmin([String(out.reply || "تمام").slice(0, 600), rep.length ? "\n" + rep.join("\n") : ""].join(""));
  return true;
}

// رد المسؤول على الخاص: «نعم» / «لا» (ولو فيه أكثر من طلب: يرد على الرسالة نفسها أو يكتب الرمز «نعم K7Q»)
export async function handleAdminMessage(m, phone, text) {
  const p = String(phone || "").replace(/^0/, "");
  if (!admins.includes(p)) return false;
  { const n0 = norm(text);
    if (/^(وقف|اوقف|طفي|سكر) (ال)?تقارير/.test(n0)) { reportsOn = false; db.doc("bot/prefs").set({ reports: false }, { merge: true }).catch(() => {}); await dmAdmin("تمام، وقفت تقارير القروب. لو تبغاها رجّعها بـ «شغل التقارير»."); return true; }
    if (/^(شغل|رجع|فعل) (ال)?تقارير/.test(n0)) { reportsOn = true; db.doc("bot/prefs").set({ reports: true }, { merge: true }).catch(() => {}); await dmAdmin("تمام، رجعت تقارير القروب ✅"); return true; } }
  try { if (await handleClarify(m, text)) return true; } catch (e) { log.warn({ err: String(e?.message || e) }, "تصحيح المسؤول"); }
  const n = norm(text);
  const yes = /^(نعم|ايوه|ايوا|اي|ايه|اضف|اضفه|ضيف|ضيفه|ضيفها|موافق|تمام|اوكي|ok|1)(?:\s|$)/.test(n) || /^(👍|✅)/.test(text);
  const no = /^(لا|تجاهل|الغ|الغيه|لاتضيف|لا تضيف|2)(?:\s|$)/.test(n) || /^❌/.test(text);
  const undo = /^تراجع/.test(n);
  if (!yes && !no && !undo) return adminAssist(m, text);
  if (undo) { await restorePrev(); return true; }
  const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const qt = q?.conversation || q?.extendedTextMessage?.text || "";
  const code = (/#([A-Z0-9]{3})\b/.exec(qt) || /\b([A-Z0-9]{3})\s*$/.exec(latin(text).toUpperCase()) || [])[1];
  const ref = db.doc("bot/pending_doctors");
  const c = (await ref.get()).data() || {}, items = (c.items || []).filter(i => Date.now() - i.at < 7 * DAY);
  if (!items.length) return adminAssist(m, text);
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
        const d = docs().find(x => x.id === s.key), prev = cur.st[s.key];
        if (s.kind === "off") {                                            // خلص دوامه اليوم (دوام يوم معيّن) — بدون تنبيه
          cur.st[s.key] = { kind: "absent", off: true, at: Date.now(), by: s.by };
          continue;
        }
        if (s.kind === "appt") {
          cur.st[s.key] = { kind: "appt", at: Date.now(), by: s.by, ...(prev?.until != null ? { until: prev.until, from: prev.from } : {}) };
          cur.events.push({ id: uid(), at: Date.now(), kind: "appointments_only", doctorId: d?.id || "", name: s.name, dep: s.dep, room: d?.room || "", ext: d?.ext || "", info: "من الحين مواعيد فقط — لا تدخّلون انتظار", title: "📅 مواعيد فقط", color: "orange", by: s.by });
          continue;
        }
        cur.st[s.key] = { kind: "stop", at: Date.now(), by: s.by };
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
  // البوت مو متأكد → يسأل المسؤول على الخاص قبل ما يطبّق شي (🤔 على الرسالة لين يرد)
  // بعد 12 بالليل «بكرة/غداً» ممكن يقصد اليوم اللي بدأ أو اللي بعده → نسأل بدل ما نخمّن
  { const tn = nowR(), nn = norm(text);
    if (tn.m < 300 && /(^|\s)(غدا|بكره|بكرا|باكر)(\s|$)/.test(nn) && !/بعد (بكره|غد)/.test(nn) && evs.length) {
      const d0 = DAYN[tn.wd], d1 = DAYN[(tn.wd + 1) % 7], f = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
      evs.unclear = true; evs.question = `الرسالة بعد 12 بالليل وفيها «بكرة»: تقصد ${d0} ${f(tn.iso)} (اليوم اللي بدأ) ولا ${d1} ${f(isoPlus(tn.iso, 1))}؟ رد باسم اليوم.`;
    } }
  const fromMajed = majed && (await groupSender(m).catch(() => "")) === majed;
  // القروب ما يطلع فيه إلا ✅ (بعد ما نتأكد). ما فهمنا؟ نسأل على الخاص بدون أي إيموجي في القروب
  if ((evs.unclear || (!evs.length && evs.unknown)) && (fromMajed || admins.length)) { await askClarify(m, text, by, evs, fromMajed ? "majed" : ""); return; }
  if (!evs.length) return;
  const ctx = { text, by, rep: [], m };
  let applied;
  try { applied = await apply(evs, ctx); }
  catch (err) {
    log.error({ err: String(err?.message || err), text: text.slice(0, 80) }, "رسالة القروب ما انطبقت");
    await dmAdmin(`❌ رسالة ${by} ما انطبقت على الجدول (صار خطأ):\n«${text.slice(0, 200)}»\n${String(err?.message || err).slice(0, 160)}\n\nطبّقها من صفحة الأطباء أو أرسلها مرة ثانية.`).catch(() => {});
    return;
  }
  log.info({ text: text.slice(0, 80), applied }, "قروب الاستقبال");
  if (!applied.length) { if (admins.length) await askClarify(m, text, by, Object.assign(evs, { question: "ما قدرت أطبّق منها شي — وش المقصود؟" })); return; }
  if (applied.every(a => a === "known") && admins.length) { await askClarify(m, text, by, Object.assign(evs, { question: "فهمت الطبيب بس ما لقيت وش يتغيّر — وش المقصود؟" })); return; }
  if (applied.every(a => a === "asked")) { if (ctx.rep.length) reportToAdmin(by, text, ctx.rep).catch(() => {}); return; }   // ننتظر اختيارك، ✅ بعدها
  // نتأكد من القاعدة إن اللي طبّقناه انحفظ فعلاً، وبعدها بس ✅
  const bad = await verifyApplied(evs, ctx).catch(err => [String(err?.message || err)]);
  if (bad.length) { await dmAdmin(`❌ رسالة ${by} ما انحفظت كاملة:\n«${text.slice(0, 200)}»\nاللي ما لقيته في الموقع: ${bad.join("، ")}\n\nأرسلها مرة ثانية أو عدّلها من صفحة الأطباء.`).catch(() => {}); return; }
  if (ctx.rep.length) reportToAdmin(by, text, ctx.rep).catch(() => {});
  try { await getSock()?.sendMessage(jid, { react: { text: "✅", key: m.key } }); } catch {}
}
// بعد التطبيق: نقرا حالات اليوم والخطة (والجدول للإجازات) من القاعدة ونشيك كل طبيب
async function verifyApplied(evs, ctx) {
  const t = nowR(), bad = [];
  const [td, pl] = await Promise.all([db.doc("board/bawadi_today").get(), db.doc("board/bawadi_plan").get()]);
  const st = td.data()?.st || {}, events = td.data()?.events || [], items = pl.data()?.items || [];
  let b = null;
  for (const e of evs) {
    if (e.__asked) continue;
    const d = (e.doctor_id && docs().find(x => x.id === e.doctor_id)) || matchDoctor(e.name, e.dept); if (!d) continue;
    const nm = "د. " + shortName(d.name), fut = futureDay(e, ctx.text, t);
    if (["vacation"].includes(e.kind)) { b ||= (await db.doc("board/bawadi").get()).data(); if (!(b?.vacations || []).some(v => v.doctorId === d.id)) bad.push(nm + " (الإجازة)"); continue; }
    if (["returns", "info_change", "leaves_branch", "new_doctor", "moved", "schedule_change", "none"].includes(e.kind)) continue;   // لها تأكيدها الخاص
    if (fut && PLAN_KINDS.includes(e.kind)) { if (!items.some(i => i.doctorId === d.id && i.date === fut)) bad.push(nm + " (حالة " + DAYN[new Date(fut + "T12:00:00Z").getUTCDay()] + ")"); continue; }
    if (e.kind === "resume") { if (st[d.id]?.kind === "stop") bad.push(nm + " (رجع يستقبل)"); continue; }
    if (!st[d.id] && !events.some(x => x.doctorId === d.id)) bad.push(nm + " (حالة اليوم)");
  }
  return bad;
}
