// (2.16.0) مساعد أنس في «قروب الشكاوي»
// البوت يقرا كل رسالة في القروب (نص، فويس يحوّله لكلام، صورة يقراها) — وما يكتب في القروب إلا لو أنس وافق.
// كل دفعة رسايل تروح للذكاء مع اللي قبلها: يفرّق بين الشكوى، والطلب اللي يخص أنس، والكلام العادي.
//   • شكوى → تنحفظ (#C) ويتابع لين تنحل (من القروب أو لما أنس يقول له بالخاص)
//   • طلب لأنس → رسالة له بالخاص: وش المطلوب + رسالة جاهزة (#T) ترسل في القروب لو قال «أرسل»
//     وأي تغيير في جدول الأطباء (إجازة، غياب، تغطية) يروح لمساعد الخاص (brain.js) ويطبّقه
//   • كلام عادي → ولا شي
// كل خميس 10 بالليل: ملخص شكاوي الأسبوع (✅ انحلت وكيف / ❌ لم تُحل) — كل أسبوع شكاويه الجديدة بس.
// التخزين على قرص Railway (مو Firebase) — بدون صور ولا فويسات، النص بس.
import fs from "node:fs";
import nodePath from "node:path";
import { downloadMediaMessage } from "baileys";
import { handle as brainHandle, setAssist } from "./brain.js";
import { dmAdmin } from "./group.js";
import { can } from "./perms.js";
import { addPrep, prepScan } from "./prep.js";

const STORE = process.env.STORE_DIR || (fs.existsSync("/data") ? "/data/store" : "./store");
const FILE = nodePath.join(STORE, "assist.json");
const DAY = 864e5;
let C = null;
let S = { jid: "", log: [], complaints: [], tasks: [], seq: 0, tseq: 0, lastWeek: "", lastAt: 0 };
const subjects = new Map(), seen = new Set();
let saveT = null, triT = null, triFirst = 0, busy = false;

/* ---------- التخزين ---------- */
function load() {
  try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* أول مرة */ }
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      fs.mkdirSync(STORE, { recursive: true });
      const cut = Date.now() - 21 * DAY;
      S.log = S.log.filter(x => x.at > cut).slice(-1500);
      S.complaints = S.complaints.filter(x => x.at > Date.now() - 120 * DAY);
      S.tasks = S.tasks.filter(x => x.at > Date.now() - 60 * DAY);
      fs.writeFileSync(FILE + ".tmp", JSON.stringify(S)); fs.renameSync(FILE + ".tmp", FILE);
    } catch (e) { C?.log.warn({ err: String(e?.message || e) }, "المساعد: الحفظ"); }
  }, 1500);
}

/* ---------- الوقت (الرياض) ---------- */
function nowR(ms = Date.now()) {
  const d = new Date(ms + 3 * 3600e3);
  return { iso: d.toISOString().slice(0, 10), wd: d.getUTCDay(), m: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const isoAdd = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const tLabel = ms => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
// الأسبوع ينتهي الخميس الساعة 10 بالليل: نرجّع تاريخ ذاك الخميس
const END_MIN = 22 * 60;
function weekOf(ms) {
  const t = nowR(ms); let back = (t.wd - 4 + 7) % 7;               // كم يوم من آخر خميس
  if (back === 0 && t.m >= END_MIN) back = -7;                       // الخميس بعد 10 → الأسبوع الجاي
  return isoAdd(t.iso, back <= 0 ? -back : 7 - back);
}
const weekStartLabel = w => dm(isoAdd(w, -6));

/* ---------- القروب ---------- */
export function initAssist(ctx) {
  C = ctx; load();
  setAssist({ block, act, describeAct, checkAct });
  setInterval(() => tick().catch(e => C.log.warn({ err: String(e?.message || e) }, "المساعد: المؤقت")), 60e3);
  if (S.log.some(x => x.fresh)) schedule(30e3);                        // رسايل وصلت قبل إعادة التشغيل وما تحللت
  // (28/11) بعد التشغيل: نقرا مباشرة آخر يومين من القروب — يلحق اللي فات الذكاء (التكرار يندمج لنفس الطبيب واليوم)
  setTimeout(() => { try { if (!can("GROUP_COMPLAINTS", "prepare")) return; for (const x of S.log.filter(x => x.kind === "text" && x.team !== "anas" && Date.now() - x.at < 2 * DAY)) prepScan(x.text, x.by, x.at); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "التحضير: لحاق"); } }, 120e3);
}
const norm = s => String(s || "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ً-ْـ]/g, "");
export async function isAssistGroup(jid) {
  if (!jid?.endsWith("@g.us")) return false;
  if (S.jid) return jid === S.jid;
  if (!subjects.has(jid)) { try { subjects.set(jid, (await C.getSock()?.groupMetadata(jid))?.subject || ""); } catch { subjects.set(jid, ""); } }
  if (/شكاو|شكاي|شكوي/.test(norm(subjects.get(jid)))) {
    S.jid = jid; save(); C.log.info({ jid, name: subjects.get(jid) }, "لقيت قروب الشكاوي");
    return true;
  }
  return false;
}
const unwrap = m => { let g = m.message || {}; for (let i = 0; i < 3; i++) g = g.ephemeralMessage?.message || g.viewOnceMessage?.message || g.viewOnceMessageV2?.message || g.viewOnceMessageV2Extension?.message || g.documentWithCaptionMessage?.message || g; return g; };
async function senderPhone(m) {
  let pj = m.key?.participantAlt || m.key?.participant || "";
  if (pj.endsWith("@lid")) { try { pj = (await C.getSock()?.signalRepository?.lidMapping?.getPNForLID?.(pj)) || ""; } catch { pj = ""; } }
  return String(pj).split(/[:@]/)[0].replace(/\D/g, "").replace(/^966/, "");
}

export async function onAssistGroup(m) {
  const id = m.key?.id; if (!id || seen.has(id) || m.key.fromMe) return; seen.add(id); if (seen.size > 3000) seen.clear();
  if (S.log.some(x => x.id === id)) return;
  const g = unwrap(m);
  if (g.protocolMessage || g.reactionMessage || g.editedMessage || g.pollUpdateMessage || g.keepInChatMessage || g.senderKeyDistributionMessage && Object.keys(g).length === 1) return;
  const at = Number(m.messageTimestamp || 0) * 1000 || Date.now();
  const phone = await senderPhone(m).catch(() => "");
  const team = C.teamOf(phone);
  const by = team === "anas" ? "أنس" : team === "majed" ? "ماجد" : (m.pushName || phone || "عضو");
  const ci = g.extendedTextMessage?.contextInfo || g.imageMessage?.contextInfo || g.audioMessage?.contextInfo || g.videoMessage?.contextInfo || g.documentMessage?.contextInfo || {};
  const qid = ci.stanzaId || "";
  const q = ci.quotedMessage || null;
  const qOwn = qid ? S.log.find(x => x.id === qid) : null;
  const quoted = qOwn ? `${qOwn.by}: ${qOwn.text}` : q ? (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || (q.audioMessage ? "[فويس]" : q.imageMessage ? "[صورة]" : "")).slice(0, 300) : "";
  let text = String(g.conversation || g.extendedTextMessage?.text || g.imageMessage?.caption || g.videoMessage?.caption || g.documentMessage?.caption || "").trim();
  let kind = "text";
  const img = g.imageMessage || (g.documentMessage && /^image\//.test(g.documentMessage.mimetype || "") ? g.documentMessage : null);
  const aud = g.audioMessage;
  // (2.20.0) ترخيص انرسل في القروب (PDF أو صورة) → يقراه ويحدّثه ويحفظه، وسطر لأنس بالخاص
  const pdf = g.documentMessage && /pdf/i.test(g.documentMessage.mimetype || g.documentMessage.fileName || "") ? g.documentMessage : null;
  if ((pdf || img) && C.licIngest && can("GROUP_COMPLAINTS", "licenses")) {
    try {
      const o = await C.licIngest([{ ...m, message: g }]);
      if (o?.lic) { await (C.dm || dmAdmin)(`📄 ترخيص انرسل في قروب الشكاوي (من ${by}):\n${C.licSummary(o)}`); if (pdf) return; }
    } catch (e) { C.log.warn({ err: String(e?.message || e) }, "المساعد: ترخيص من القروب"); }
    if (pdf) return;
  }
  if (aud || img) {
    kind = aud ? "voice" : "image";
    let buf = null;
    try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "المساعد: تحميل الوسائط"); }
    const read = buf ? await readMedia(buf, aud ? (aud.mimetype || "audio/ogg").split(";")[0] : (img.mimetype || "image/jpeg"), kind).catch(() => "") : "";
    text = [text, read ? (aud ? "[فويس] " : "[صورة] ") + read : aud ? `[فويس ${aud.seconds || "?"} ث — ما قدرت أسمعه]` : "[صورة — ما قدرت أقراها]"].filter(Boolean).join("\n");
  } else if (g.videoMessage) { kind = "video"; text = [text, "[فيديو]"].filter(Boolean).join("\n"); }
  else if (g.stickerMessage) return;
  else if (g.locationMessage || g.contactMessage) text = text || (g.locationMessage ? "[موقع]" : "[جهة اتصال]");
  if (!text) return;
  // (2.17.1) الرسالة كلها «تراخيص» (بس — مو داخل جملة) → قائمة التراخيص في القروب، لأي أحد
  if (kind === "text" && /^\s*تراخيص\s*[.!؟?،]*\s*$/.test(text.replace(/ـ/g, "")) && C.licText) {
    try { await C.getSock().sendMessage(m.key.remoteJid, { text: C.licText() }, { quoted: m }); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "المساعد: قائمة التراخيص"); }
    return;
  }
  S.log.push({ id, at, by, phone, team: team || "", text: text.slice(0, 2000), kind, quoted, qid, key: { remoteJid: m.key.remoteJid, id, participant: m.key.participant || undefined }, fresh: true });
  if (kind === "text" && can("GROUP_COMPLAINTS", "prepare")) { try { prepScan(text, by, at); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "التحضير: قراءة مباشرة"); } }   // (28/11) ما نعتمد على الذكاء بس
  S.log.sort((a, b) => a.at - b.at);
  save();
  schedule(kind === "text" ? 90e3 : 45e3);
}
// ننتظر شوي بعد آخر رسالة (الرسايل تجي ورا بعض) — وبالكثير 5 دقايق من أول رسالة
function schedule(ms) {
  if (!triFirst) triFirst = Date.now();
  clearTimeout(triT);
  const wait = Math.max(5e3, Math.min(ms, triFirst + 5 * 60e3 - Date.now()));
  triT = setTimeout(() => { triFirst = 0; triage().catch(e => C.log.warn({ err: String(e?.message || e) }, "المساعد: التحليل")); }, wait);
}

/* ---------- الذكاء ---------- */
async function gemini(system, parts, schema, temp = 0.2) {
  for (const model of C.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 90e3);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": C.gemini }, signal: ctl.signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }],
          generationConfig: { temperature: temp, maxOutputTokens: 8192, ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}) } }) });
      clearTimeout(tm);
      if (!res.ok) { C.log.warn({ model, status: res.status }, "المساعد: Gemini"); continue; }
      const j = await res.json(), txt = (j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
      if (!txt) continue;
      return schema ? JSON.parse(txt) : txt;
    } catch (e) { C.log.warn({ model, err: String(e?.message || e) }, "المساعد: Gemini"); }
  }
  return null;
}
async function readMedia(buf, mime, kind) {
  if (!C.gemini || buf.length > 15e6) return "";
  const sys = kind === "voice"
    ? "حوّل الفويس لكلام مكتوب حرفياً بنفس اللهجة (سعودي/مصري) بدون شرح ولا إضافات. لو فيه أكثر من متكلم افصل بسطر. لو ما فيه كلام واضح اكتب: (غير واضح)."
    : "اقرأ كل الكلام المكتوب في الصورة كما هو (عربي أو إنجليزي)، وبعده سطر واحد يبدأ بـ «الصورة:» يوصف وش هي باختصار (لقطة محادثة، ورقة، فاتورة، شاشة نظام، مكان…). بدون مقدمات.";
  const out = await gemini(sys, [{ inlineData: { mimeType: mime, data: buf.toString("base64") } }], null, 0);
  return String(out || "").slice(0, 1800);
}

const TRIAGE = `أنت مساعد أنس (مشرف عيادات سابا — فرع البوادي، جدة). تقرأ رسايل «قروب الشكاوي» (فيه المدير عادل، وماجد، وأنس، وموظفين). الكلام سعودي/مصري، وفيه فويسات محوّلة لكلام وصور مقروءة.
شغلك: تفهم كل رسالة جديدة مع اللي قبلها، وتطلّع:
1) new_complaints — شكوى جديدة: أي تذمّر أو مشكلة صارت لمراجع أو عن الخدمة (انتظار، تعامل موظف/طبيب، موعد، فاتورة/تأمين، نظافة، نتيجة، نظام…). رسايل متتالية عن نفس الموضوع = شكوى وحدة. by = مين نقل الشكوى في القروب، patient = اسم المراجع لو انذكر، about = على مين/وش (الاستقبال، د. فلان، المختبر…)، summary = الشكوى بجملة أو جملتين واضحة.
2) complaint_updates — رسالة تخص شكوى مفتوحة (من «شكاوي الأسبوع»): resolved = true لو أحد قال إنها انحلت/تم التواصل/اعتذرنا/تعوّض/انحلّت المشكلة، و how = كيف انحلت. note = لو فيه معلومة جديدة عنها.
3) tasks — أي شي مطلوب من أنس يسويه أو يرد عليه (تذكير، إرسال رسالة، رد على سؤال، متابعة، تجهيز شي، تعديل في جدول الأطباء). from = مين طلب. what = المطلوب منه بجملة واضحة.
   board = لو فيه تغيير في جدول أطباء البوادي (إجازة، غياب، مرضية، تغطية طبيب مكان طبيب، تأخير، دوام): اكتبه جملة واضحة فيها اسم الطبيب واليوم بالتاريخ YYYY-MM-DD (مثلاً «د. وائل إجازة مرضية يوم 2026-11-19»). غير كذا فاضي.
   «فلان يرجع/ترجع يوم كذا» = نهاية إجازة: board = «د. فلان يرجع من الإجازة يوم YYYY-MM-DD» (مو تعديل دوام).
   draft = لو المطلوب رسالة تنرسل في القروب أو للموظفين (تذكير، تعميم، رد): اكتب نصها جاهز باللهجة السعودية المهنية المختصرة، كأن أنس كاتبها. غير كذا فاضي.
   compose = true لو المطلوب رسالة فيها دوامات أو تغييرات الأطباء (دوام الجمعة، تغييرات الأسبوع، مين يداوم…) — هذي يجهّزها مساعد الخاص من الجدول، فخل draft فاضي.
5) board_updates — أي معلومة انقالت في القروب عن تغيير في أطباء البوادي (غالباً جاية: «د فلان يباشر الأحد 5م»، طبيب جديد، إجازة، رجوع، تبديل شفت، دوام جديد، «آخر يوم») — من أي أحد، حتى لو جات كجواب أو وسط كلام:
   text = جملة واضحة كاملة: اسم الطبيب ← التغيير ← الوقت بصيغة ص/م. doctor = اسم الطبيب. date = يوم التغيير YYYY-MM-DD (فاضي لو ما انقال).
   هذي تنحفظ «محضّرة» لين تنكتب في قروب الإنفورميشن أو أنس يطلب يطبّقها — ما تنطبق من هنا.
   الوقت بدون ص/م: العيادة الصبح 8–12 والمسا 1–11 → «١-٩» = 1م–9م، «٩-٥» = 9ص–5م، «٥-١» = 5م–1ص. واللي يغطي عن طبيب ياخذ نفس دوامه لو ما انقال غير كذا.
   لا تحطها task.
4) task_updates — طلب مفتوح (من «طلبات أنس المفتوحة») صار خلاص (أنس رد أو سواه أو انلغى): done = true.
قواعد:
- حلل الرسايل المعلّمة «جديدة» بس. القديمة سياق.
- الكلام العادي (سلام، شكر، سوالف، تنسيق عادي ما فيه طلب) → ولا شي.
- رسايل أنس نفسه غالباً ردود: استخدمها في complaint_updates و task_updates و board_updates. ما تسوي منها task إلا لو كتب إنه لازم يسوي شي.
- طلب كل اللي فيه تغيير جدول → board_updates بس (مو task). task للشي اللي أنس لازم يسويه بنفسه (رسالة، رد، متابعة).
- سؤال موجّه لأنس ولا أحد جاوبه → task.
- لا تكرر شكوى أو طلب موجود في القوائم تحت — حدّثه بدل كذا.
- لا تخترع أسماء أو تواريخ ما انقالت. التواريخ موجودة تحت عند «الحين».
- ids = أرقام الرسايل (M…) اللي جات منها.`;
const SCHEMA = { type: "OBJECT", properties: {
  new_complaints: { type: "ARRAY", items: { type: "OBJECT", properties: { ids: { type: "ARRAY", items: { type: "STRING" } }, by: { type: "STRING" }, patient: { type: "STRING" }, about: { type: "STRING" }, summary: { type: "STRING" } }, required: ["summary"] } },
  complaint_updates: { type: "ARRAY", items: { type: "OBJECT", properties: { code: { type: "STRING" }, resolved: { type: "BOOLEAN" }, how: { type: "STRING" }, note: { type: "STRING" } }, required: ["code"] } },
  tasks: { type: "ARRAY", items: { type: "OBJECT", properties: { ids: { type: "ARRAY", items: { type: "STRING" } }, from: { type: "STRING" }, what: { type: "STRING" }, board: { type: "STRING" }, draft: { type: "STRING" }, compose: { type: "BOOLEAN" } }, required: ["what"] } },
  task_updates: { type: "ARRAY", items: { type: "OBJECT", properties: { code: { type: "STRING" }, done: { type: "BOOLEAN" }, note: { type: "STRING" } }, required: ["code"] } },
  board_updates: { type: "ARRAY", items: { type: "OBJECT", properties: { ids: { type: "ARRAY", items: { type: "STRING" } }, text: { type: "STRING" }, doctor: { type: "STRING" }, date: { type: "STRING" } }, required: ["text"] } } } };

const mref = x => "M" + x.id.slice(-6);
const openTasks = () => S.tasks.filter(t => t.status === "pending");
function lineOf(x, isNew) {
  return `${isNew ? "★جديدة " : ""}[${mref(x)}] ${tLabel(x.at)} — ${x.by}${x.quoted ? ` (يرد على: «${x.quoted.slice(0, 160)}»)` : ""}: ${x.text}`;
}
function complaintsTxt(list) {
  return list.map(c => `#${c.code} | ${c.status === "resolved" ? "انحلت: " + (c.how || "") : "مفتوحة"} | ${dm(nowR(c.at).iso)} | ${c.by || "—"} | ${c.patient || "—"} | ${c.about || "—"} | ${c.summary}${c.notes?.length ? " | ملاحظات: " + c.notes.join(" / ") : ""}`).join("\n") || "—";
}
function tasksTxt(list) { return list.map(t => `#${t.code} | ${dm(nowR(t.at).iso)} | ${t.from || "—"} | ${t.what}${t.draft ? ` | رسالة جاهزة: «${t.draft.slice(0, 200)}»` : ""}`).join("\n") || "—"; }

async function triage() {
  if (busy) return schedule(30e3);
  const fresh = S.log.filter(x => x.fresh); if (!fresh.length) return;
  if (!C.gemini) return;
  busy = true;
  try {
    const first = fresh[0].at;
    const ctx = S.log.filter(x => !x.fresh && x.at < first && x.at > first - 2 * DAY).slice(-30);
    const t = nowR(), w = weekOf(Date.now());
    const wk = S.complaints.filter(c => c.week === w || (c.status !== "resolved" && Date.now() - c.at < 10 * DAY));
    const prompt = `الحين: ${WD[t.wd]} ${t.iso} (بكرة ${WD[(t.wd + 1) % 7]} ${isoAdd(t.iso, 1)}، بعده ${WD[(t.wd + 2) % 7]} ${isoAdd(t.iso, 2)})
أطباء البوادي: ${(C.doctorNames?.() || []).join("، ") || "—"}

## شكاوي الأسبوع (#الرمز | الحالة | اليوم | مين نقلها | المراجع | عن | الشكوى)
${complaintsTxt(wk)}

## طلبات أنس المفتوحة
${tasksTxt(openTasks())}

## الرسايل (★ = جديدة، حللها هي)
${[...ctx.map(x => lineOf(x, false)), ...fresh.map(x => lineOf(x, true))].join("\n")}`;
    const out = await gemini(TRIAGE, [{ text: prompt }], SCHEMA);
    if (!out) { C.log.warn("المساعد: الذكاء ما رد — بعيد المحاولة"); busy = false; return schedule(10 * 60e3); }
    for (const x of fresh) delete x.fresh;
    save();
    await apply(out, fresh);
  } finally { busy = false; }
}

const byRef = r => S.log.find(x => mref(x) === String(r || "").replace(/^#/, ""));
const codeN = s => String(s || "").replace(/^#/, "").toUpperCase().trim();
async function apply(out, fresh) {
  const notes = [];
  for (const u of out.complaint_updates || []) {
    const c = S.complaints.find(x => x.code === codeN(u.code)); if (!c) continue;
    if (u.note) (c.notes ||= []).push(u.note.slice(0, 200));
    if (u.resolved && c.status !== "resolved") { c.status = "resolved"; c.how = String(u.how || "").slice(0, 300); c.resolvedAt = Date.now(); c.resolvedBy = "القروب"; }
  }
  for (const n of out.new_complaints || []) {
    if (!String(n.summary || "").trim()) continue;
    const src = (n.ids || []).map(byRef).filter(Boolean), at = src[0]?.at || fresh[0]?.at || Date.now();
    const c = { code: "C" + (++S.seq), at, week: weekOf(at), by: String(n.by || src[0]?.by || "").slice(0, 60), patient: String(n.patient || "").slice(0, 80), about: String(n.about || "").slice(0, 120), summary: String(n.summary).slice(0, 400), status: "open", msgIds: src.map(x => x.id) };
    S.complaints.push(c);
  }
  for (const u of out.task_updates || []) {
    const t = S.tasks.find(x => x.code === codeN(u.code)); if (!t || t.status !== "pending") continue;
    if (u.done) { t.status = "done"; t.doneAt = Date.now(); t.doneHow = String(u.note || "من القروب").slice(0, 200); }
  }
  for (const n of out.tasks || []) {
    if (!String(n.what || "").trim()) continue;
    if (!can("GROUP_COMPLAINTS", "tasks")) { if (String(n.board || "").trim() && can("GROUP_COMPLAINTS", "prepare")) addPrep([{ text: n.board, doctor: "", date: (/\d{4}-\d{2}-\d{2}/.exec(n.board) || [""])[0], by: n.from, quote: (n.ids || []).map(byRef).filter(Boolean).map(s => s.text).join("\n") }]); continue; }   // (2.20.0) المهام موقفة
    const src = (n.ids || []).map(byRef).filter(Boolean);
    if (src.length && src.every(s => s.team === "anas") && !n.draft) continue;          // أنس كتبها لنفسه
    const t = { code: "T" + (++S.tseq), at: Date.now(), from: String(n.from || src[0]?.by || "").slice(0, 60), what: String(n.what).slice(0, 300), draft: String(n.draft || "").trim().slice(0, 1500), board: String(n.board || "").trim().slice(0, 400), compose: !!n.compose, quote: src.map(s => s.text).join("\n").slice(0, 500), key: src[src.length - 1]?.key || null, status: "pending" };
    S.tasks.push(t);
    notes.push(t);
  }
  save();
  const bu = (out.board_updates || []).map(b => String(b.text || "").trim()).filter(Boolean);
  // (2.20.0) قروب الشكاوي: التغييرات تنحفظ «محضّرة» (ما تنطبق) — إلا لو خانته فيها apply
  if (bu.length && !can("GROUP_COMPLAINTS", "apply")) {
    if (can("GROUP_COMPLAINTS", "prepare")) addPrep((out.board_updates || []).filter(b => String(b.text || "").trim()).map(b => { const src = (b.ids || []).map(byRef).filter(Boolean); return { text: b.text, doctor: b.doctor || "", date: b.date || "", by: src[0]?.by || "", quote: src.map(x => `${x.by}: ${x.text}`).join("\n") }; }));
  } else if (bu.length) {
    const src = [...new Set((out.board_updates || []).flatMap(b => (b.ids || []).map(byRef).filter(Boolean)))];
    const quote = src.map(x => `${x.by}: ${x.text}`).join("\n").slice(0, 900);
    await brainHandle({ key: { remoteJid: "" }, message: {} }, `[من قروب الشكاوي — انقال في القروب:\n«${quote}»]\nطبّق في جدول أطباء البوادي:\n${bu.map(x => "- " + x).join("\n")}`).catch(e => C.log.warn({ err: String(e?.message || e) }, "المساعد: الجدول"));
  }
  for (const t of can("GROUP_COMPLAINTS", "tasks") ? notes : []) {
    const lines = [`📌 من قروب الشكاوي — ${t.from || "—"}:`, t.quote ? `«${t.quote.slice(0, 400)}»` : "", `المطلوب: ${t.what}`];
    if (t.draft) lines.push("", `✍️ رسالة جاهزة (#${t.code}):`, t.draft, "", "رد «أرسل» وأرسلها في القروب، أو قل لي وش أعدّل.");
    if (t.board) lines.push("", "📅 وبسجّلها في جدول الأطباء (رسالتي الجاية).");
    if (t.compose) lines.push("", "✍️ أجهّز لك الرسالة من الجدول (رسالتي الجاية) — قل لي لو تبي تعديل، و«أرسلها في القروب» لما تكون تمام.");
    else if (!t.draft && !t.board) lines.push("", `(#${t.code} — قل لي «خلصت» لما تسويه، وإلا بذكّرك)`);
    await (C.dm || dmAdmin)(lines.filter((l, i) => l || i).join("\n"));
    if (t.board) {
      await brainHandle({ key: { remoteJid: "" }, message: {} }, `[من قروب الشكاوي — ${t.from} كتب: «${t.quote.slice(0, 300)}»]\nالمطلوب في الجدول: ${t.board}`).catch(e => C.log.warn({ err: String(e?.message || e) }, "المساعد: الجدول"));
      if (!t.draft && !t.compose) { t.status = "done"; t.doneAt = Date.now(); t.doneHow = "انسجّل في الجدول"; save(); }
    }
    if (t.compose) await brainHandle({ key: { remoteJid: "" }, message: {} }, `[من قروب الشكاوي — ${t.from} كتب: «${t.quote.slice(0, 400)}»]\nجهّز لي الرسالة المطلوبة كاملة جاهزة للنسخ (${t.what}).`).catch(e => C.log.warn({ err: String(e?.message || e) }, "المساعد: تجهيز الرسالة"));
  }
}

/* ---------- مع مساعد الخاص (brain.js): السياق + الأفعال ---------- */
function block() {
  const w = weekOf(Date.now());
  const wk = S.complaints.filter(c => c.week === w);
  const recent = S.log.filter(x => Date.now() - x.at < 3 * DAY).slice(-25).map(x => `${tLabel(x.at)} — ${x.by}: ${x.text.replace(/\n+/g, " ").slice(0, 220)}`).join("\n") || "—";
  return `\n## قروب الشكاوي — آخر رسايله (3 أيام)\n${recent}\n\n## قروب الشكاوي — شكاوي هالأسبوع (الملخص يوصل أنس الخميس 10 بالليل)\n${complaintsTxt(wk)}\n\n## قروب الشكاوي — طلبات تنتظر أنس (#T)\n${tasksTxt(openTasks())}`;
}
const ACT = ["complaint_add", "complaint_resolve", "complaint_reopen", "task_send", "task_done", "task_drop", "complaints_summary", "group_send"];
function checkAct(a) {
  if (!ACT.includes(a.type)) return null;
  const code = codeN(a.code);
  if (a.type === "complaint_add") return String(a.text || "").trim() ? "" : "ناقص نص الشكوى";
  if (a.type === "complaints_summary") return "";
  if (a.type === "group_send") return !String(a.text || "").trim() ? "وش النص اللي أرسله؟" : S.jid ? "" : "ما أعرف قروب الشكاوي للحين";
  if (a.type.startsWith("complaint_")) return S.complaints.find(c => c.code === code) ? "" : `ما لقيت الشكوى #${code || "—"}`;
  const t = S.tasks.find(x => x.code === code);
  if (!t) return `ما لقيت الطلب #${code || "—"}`;
  if (a.type === "task_send" && !String(a.text || t.draft || "").trim()) return "ما فيه نص أرسله";
  if (a.type === "task_send" && !S.jid) return "ما أعرف قروب الشكاوي للحين";
  return "";
}
function describeAct(a) {
  const code = codeN(a.code), c = S.complaints.find(x => x.code === code), t = S.tasks.find(x => x.code === code);
  switch (a.type) {
    case "complaint_add": return `• شكوى جديدة: ${String(a.text || "").slice(0, 120)}`;
    case "complaint_resolve": return `• #${code} انحلت${a.how ? " — " + a.how : ""}${c ? ` («${c.summary.slice(0, 60)}»)` : ""}`;
    case "complaint_reopen": return `• #${code} رجعت مفتوحة`;
    case "task_send": return `• أرسل رسالة #${code} في قروب الشكاوي`;
    case "task_done": return `• #${code} خلص${t ? ` («${t.what.slice(0, 60)}»)` : ""}`;
    case "task_drop": return `• #${code} انلغى`;
    case "complaints_summary": return "• ملخص شكاوي الأسبوع";
    case "group_send": return `• أرسل الرسالة في قروب الشكاوي`;
  }
  return null;
}
async function act(a) {
  if (!ACT.includes(a.type)) return null;
  const code = codeN(a.code), c = S.complaints.find(x => x.code === code), t = S.tasks.find(x => x.code === code);
  if (a.type === "complaint_add") {
    const n = { code: "C" + (++S.seq), at: Date.now(), week: weekOf(Date.now()), by: String(a.name || "أنس (الخاص)").slice(0, 60), patient: String(a.patient || "").slice(0, 80), about: String(a.about || "").slice(0, 120), summary: String(a.text).slice(0, 400), status: "open", msgIds: [] };
    if (a.how) { n.status = "resolved"; n.how = String(a.how).slice(0, 300); n.resolvedAt = Date.now(); n.resolvedBy = "أنس"; }
    S.complaints.push(n); save();
    return { ok: true, note: `#${n.code}${n.status === "resolved" ? " (انحلت)" : ""}` };
  }
  if (a.type === "complaint_resolve") { c.status = "resolved"; c.how = String(a.how || a.text || "").slice(0, 300); c.resolvedAt = Date.now(); c.resolvedBy = "أنس"; save(); return { ok: true }; }
  if (a.type === "complaint_reopen") { c.status = "open"; delete c.how; delete c.resolvedAt; save(); return { ok: true }; }
  if (a.type === "task_done") { t.status = "done"; t.doneAt = Date.now(); t.doneHow = String(a.how || a.text || "أنس").slice(0, 200); save(); return { ok: true }; }
  if (a.type === "task_drop") { t.status = "dropped"; t.doneAt = Date.now(); save(); return { ok: true }; }
  if (a.type === "task_send") {
    const text = String(a.text || t.draft).trim();
    const sock = C.getSock(); if (!sock) return { ok: false, why: "واتساب مو متصل" };
    const opts = t.key?.id ? { quoted: { key: t.key, message: { conversation: t.quote || "" } } } : {};
    try { await sock.sendMessage(S.jid, { text }, opts); }
    catch (e) { try { await sock.sendMessage(S.jid, { text }); } catch (e2) { return { ok: false, why: String(e2?.message || e2).slice(0, 120) }; } }
    t.status = "done"; t.doneAt = Date.now(); t.doneHow = "انرسلت في القروب"; t.sent = text;
    S.log.push({ id: "bot" + Date.now(), at: Date.now(), by: "أنس (البوت)", team: "anas", text: text.slice(0, 2000), kind: "text", quoted: "", qid: "" });
    save(); return { ok: true, note: "انرسلت" };
  }
  if (a.type === "group_send") {
    const text = String(a.text).trim(), sock = C.getSock(); if (!sock) return { ok: false, why: "واتساب مو متصل" };
    try { await sock.sendMessage(S.jid, { text }); } catch (e) { return { ok: false, why: String(e?.message || e).slice(0, 120) }; }
    S.log.push({ id: "bot" + Date.now(), at: Date.now(), by: "أنس (البوت)", team: "anas", text: text.slice(0, 2000), kind: "text", quoted: "", qid: "" });
    for (const t of openTasks()) if (t.draft && t.status === "pending") { t.status = "done"; t.doneAt = Date.now(); t.doneHow = "انرسلت رسالة من الخاص"; }
    save(); return { ok: true, note: "انرسلت" };
  }
  if (a.type === "complaints_summary") { const s = summaryText(weekOf(Date.now()), true); await (C.dm || dmAdmin)(s); return { ok: true, skip: true }; }
  return null;
}

/* ---------- الملخص الأسبوعي + التذكير ---------- */
function summaryText(w, partial = false) {
  const list = S.complaints.filter(c => c.week === w).sort((a, b) => a.at - b.at);
  const ok = list.filter(c => c.status === "resolved"), no = list.filter(c => c.status !== "resolved");
  const head = `📋 ${partial ? "شكاوي الأسبوع للحين" : "ملخص شكاوي الأسبوع"} (${weekStartLabel(w)} – ${dm(w)})`;
  if (!list.length) return `${head}\n\nما فيه شكاوي هالأسبوع 👌`;
  const row = (c, i) => `${i + 1}) ${c.status === "resolved" ? "✅ انحلت" : "❌ لم تُحل"} — ${c.summary}\n   ${[c.patient ? "المراجع: " + c.patient : "", c.about ? "عن: " + c.about : "", "من: " + (c.by || "—"), dm(nowR(c.at).iso)].filter(Boolean).join(" · ")}${c.status === "resolved" && c.how ? `\n   الطريقة: ${c.how}` : ""}`;
  const tasksW = S.tasks.filter(t => weekOf(t.at) === w);
  const pend = tasksW.filter(t => t.status === "pending");
  return [head, `العدد: ${list.length} — ✅ ${ok.length} انحلت · ❌ ${no.length} لم تُحل`, "", ...list.map(row),
    tasksW.length ? `\n📌 طلبات القروب: ${tasksW.length - pend.length} خلصت${pend.length ? ` · ⏳ ${pend.length} باقية:\n` + pend.map(t => `• #${t.code} ${t.what}`).join("\n") : ""}` : ""].filter(x => x !== "").join("\n");
}
async function themes(w) {
  const list = S.complaints.filter(c => c.week === w); if (list.length < 3) return "";
  const out = await gemini("اقرأ شكاوي عيادة خلال أسبوع. لو فيه موضوع يتكرر (مرتين أو أكثر: نفس الموظف، نفس الطبيب، الانتظار، المواعيد…) اكتبه بسطر لكل موضوع بالشكل: «• الموضوع — كم مرة». لو ما فيه تكرار اكتب: لا. بدون مقدمات.", [{ text: list.map(c => `- ${c.about || ""}: ${c.summary}`).join("\n") }], null, 0).catch(() => "");
  return out && !/^لا\.?$/.test(out.trim()) ? "\n🔁 يتكرر:\n" + out.trim() : "";
}
async function tick() {
  const t = nowR();
  // الخميس 10 بالليل (أو بعدها لو البوت كان طافي): ملخص الأسبوع اللي خلص
  const w = isoAdd(weekOf(Date.now()), -7);                          // آخر أسبوع خلص (خميسه)
  if (!S.lastWeek) { S.lastWeek = w; save(); }                       // أول تشغيل: ما نرسل ملخص لأسبوع ما كنا نقرا فيه
  if (S.lastWeek < w && !can("GROUP_COMPLAINTS", "summary")) { S.lastWeek = w; save(); }      // (2.20.0) الملخص موقف
  if (S.lastWeek < w && Date.now() - S.lastAt > 3600e3 && C.getSock()?.user) {
    const txt = summaryText(w) + await themes(w);
    if (await (C.dm || dmAdmin)(txt)) { S.lastWeek = w; S.lastAt = Date.now(); save(); C.log.info({ week: w }, "المساعد: ملخص الأسبوع انرسل"); }
  }
  // تذكير مرة وحدة بعد 4 ساعات لأي طلب ما خلص (بين 9 الصبح و 11 بالليل)
  if (t.m >= 540 && t.m <= 1380 && can("GROUP_COMPLAINTS", "tasks")) {
    const due2 = S.tasks.filter(x => x.status === "pending" && !x.reminded && Date.now() - x.at > 4 * 3600e3);
    if (due2.length) {
      for (const x of due2) x.reminded = Date.now(); save();
      await (C.dm || dmAdmin)(`⏰ تذكير — طلبات قروب الشكاوي اللي لسى ما خلصت:\n${due2.map(x => `• #${x.code} ${x.what}${x.draft ? " (الرسالة جاهزة — قل «أرسل #" + x.code + "»)" : ""}`).join("\n")}\n\nقل لي «خلصت» لما تسويها.`);
    }
  }
}
export const assistJid = () => S.jid;
export function assistStatus() {
  const w = weekOf(Date.now());
  return { group: !!S.jid, week: w, complaints: S.complaints.filter(c => c.week === w).length, open: openTasks().length, log: S.log.length };
}
export const _t = { triage: () => triage(), tick: () => tick(), summaryText, weekOf, S: () => S, act, checkAct };
