// (2.11.0) قروب ECG REPORT SABA1 — البوت يقرا بس (ما يرد في القروب):
//  • كل صورة تخطيط تنحفظ في تخزين Firebase (ecg/<شهر>/<id>.jpg) مع رقم الملف، وقائمتها في مستند واحد للشهر (ecg/<شهر>)
//  • رقم الملف: مع الصورة ← رسالة رقم خلال 5 دقايق بعدها ← فاتورة من نفس الشخص خلال 5 دقايق ← مكتوب على ورقة التخطيط ← تنبيه أنس وماجد
//  • أنس أو ماجد يرسل شيت الإدارة (xlsx) → zip فيه صور E.C.G. (رقم الملف مكتوب عليها واسمها برقمه) + نفس الشيت وعمود Statue معبّى → للاثنين
//  • الحذف: بعد شيت شهر خلص بيوم، تنحذف صور ذاك الشهر. شيت نص الشهر ما يحذف شي
//  • ملف «تصدير الدردشة» (zip) من أنس/ماجد → يستورد صور الشهر الحالي
// (2.15.0) أسطر البانوراما في نفس الشيت → جهاز الأشعة (برنامج SabaPano) يسأل البوت كل 10 دقايق (/pano/poll)، ياخذ صور
//  البانوراما من بيانات rainbow ويرجّعها (/pano/result) → نكتب رقم الملف عليها ونسمّيها برقمه، وملف واحد فيه ECG + بانوراما + الشيت.
//  جهاز الأشعة ما رد خلال 12 دقيقة؟ الـ ECG يروح على طول، والبانوراما تلحق لحالها (الطلب محفوظ: bot/pano_job + الشيت في التخزين)
import fs from "node:fs";
import { can } from "./perms.js";
import nodePath from "node:path";
import { downloadMediaMessage } from "baileys";
import { Jimp, loadFont, measureText } from "jimp";
import { SANS_32_BLACK, SANS_64_BLACK, SANS_128_BLACK } from "jimp/fonts";
import JSZip from "jszip";
import ExcelJS from "exceljs";
let sharp = null; try { sharp = (await import("sharp")).default; sharp.concurrency(1); } catch { /* بدونها: jimp (أبطأ) */ }

const WIN = 5 * 60e3;                                   // 5 دقايق
let C = null, conf = { jid: "", purge: [] }, ecgJid = "";
const months = new Map();                               // "2026-11" → { items: [] }
const subjects = new Map(), seen = new Set();
let saveChain = Promise.resolve();

const latin = s => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const ridh = ms => new Date(ms + 3 * 3600e3);           // وقت الرياض (UTC+3 ثابت)
const monthOf = ms => ridh(ms).toISOString().slice(0, 7);
const hm = ms => { const d = ridh(ms); return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
// (2.15.2) الصور على قرص البوت في Railway (Volume /data) — مشروع Firebase مجاني وما فيه Storage («The specified bucket does not exist»)
const STORE = process.env.STORE_DIR || (fs.existsSync("/data") ? "/data/store" : "./store");
const safeP = p => nodePath.join(STORE, String(p).replace(/\.\.+/g, "_"));
const disk = {
  file: p => ({
    save: async buf => { const f = safeP(p); await fs.promises.mkdir(nodePath.dirname(f), { recursive: true }); await fs.promises.writeFile(f, buf); },
    download: async () => [await fs.promises.readFile(safeP(p))],
    delete: async () => fs.promises.rm(safeP(p), { force: true }),
  }),
  getFiles: async ({ prefix }) => { try { return [(await fs.promises.readdir(safeP(prefix))).map(n => ({ name: prefix + n }))]; } catch { return [[]]; } },
  deleteFiles: async ({ prefix }) => fs.promises.rm(safeP(prefix), { recursive: true, force: true }),
};
const bucket = () => C.bucket || disk;                                           // C.bucket: للتجربة بس
const short = () => Math.random().toString(36).slice(2, 6).toUpperCase();
// رقم ملف: 7 أرقام (عادة يبدأ بـ7) — إنجليزي أو عربي
export function fileNums(text) {
  const t = latin(text);
  const a = [...t.matchAll(/(?<!\d)(7\d{6})(?!\d)/g)].map(x => x[1]);
  return a.length ? [...new Set(a)] : [...new Set([...t.matchAll(/(?<!\d)(\d{7})(?!\d)/g)].map(x => x[1]))];
}

export function initEcg(ctx) {
  C = ctx;
  C.db.doc("bot/ecg_conf").get().then(d => { conf = { jid: "", purge: [], ...(d.data() || {}) }; ecgJid = conf.jid || ""; }).catch(() => {});
  loadMonth(monthOf(Date.now())).catch(() => {});
  C.db.doc("bot/pano_job").get().then(d => { if (d.exists && d.data()?.id) pjob = d.data(); }).catch(() => {});
  loadReq().catch(() => {});
  setInterval(() => flushOutbox().catch(() => {}), 60e3);                       // الصادر: نعيد المحاولة كل دقيقة
  setTimeout(() => flushOutbox().catch(() => {}), 20e3);
  C.db.doc("bot/pano_agent").get().then(d => { const a = d.data()?.at || 0; if (a > agent.at) agent = { ...agent, at: a }; agentSaved = a; }).catch(() => {});
  setInterval(() => resolvePending().catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: أرقام الصور")), 30e3);
  setInterval(() => purgeDue().catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: الحذف")), 30 * 60e3);
}
const saveConf = () => C.db.doc("bot/ecg_conf").set(conf).catch(() => {});
async function loadMonth(mk) {
  if (months.has(mk)) return months.get(mk);
  const d = await C.db.doc(`ecg/${mk}`).get();
  const o = { items: d.data()?.items || [] }; months.set(mk, o); return o;
}
function saveMonth(mk) {
  saveChain = saveChain.then(() => C.db.doc(`ecg/${mk}`).set({ items: months.get(mk)?.items || [], at: Date.now() })).catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: حفظ القائمة"));
  return saveChain;
}
const allLoaded = () => [...months.entries()].flatMap(([mk, o]) => o.items.map(it => ({ it, mk })));

/* ---------- القروب ---------- */
export async function isEcgGroup(jid) {
  if (!jid?.endsWith("@g.us")) return false;
  if (ecgJid) return jid === ecgJid;
  if (!subjects.has(jid)) { try { subjects.set(jid, (await C.getSock()?.groupMetadata(jid))?.subject || ""); } catch { subjects.set(jid, ""); } }
  if (/\bE\.?C\.?G\b/i.test(subjects.get(jid))) {
    ecgJid = jid; conf.jid = jid; saveConf();
    C.log.info({ jid, name: subjects.get(jid) }, "لقيت قروب ECG");
    return true;
  }
  return false;
}
const unwrap = m => { let g = m.message || {}; for (let i = 0; i < 3; i++) g = g.ephemeralMessage?.message || g.viewOnceMessage?.message || g.viewOnceMessageV2?.message || g.documentWithCaptionMessage?.message || g; return g; };

export async function onGroup(m) {
  const id = m.key?.id; if (!id || seen.has(id) || m.key.fromMe) return; seen.add(id); if (seen.size > 3000) seen.clear();
  if (!can("GROUP_ECG", "collect")) return;
  const g = unwrap(m), at = Number(m.messageTimestamp || 0) * 1000 || Date.now();
  const by = m.pushName || String(m.key.participant || "").split("@")[0], who = m.key.participant || m.key.participantAlt || by;
  const img = g.imageMessage || (g.documentMessage && /^image\//.test(g.documentMessage.mimetype || "") ? g.documentMessage : null);
  const text = String(g.conversation || g.extendedTextMessage?.text || img?.caption || "").trim();
  if (img) {
    let buf;
    try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); }
    catch (e) { C.log.warn({ err: String(e?.message || e) }, "ECG: تحميل الصورة"); return; }
    const nums = fileNums(text);
    await addImage({ id, at, by, who, buf, num: nums[0] || "", how: nums[0] ? "caption" : "" });
    return;
  }
  if (text) {                                                     // رقم بدون صورة → لآخر صورة بدون رقم خلال 5 دقايق (نفس الشخص أولاً)
    const nums = fileNums(text); if (!nums.length) return;
    const o = await loadMonth(monthOf(at));
    const pend = o.items.filter(x => !x.num && x.kind !== "invoice" && x.kind !== "other" && at - x.at >= 0 && at - x.at <= WIN);
    if (!pend.length) return;
    const mine = pend.filter(x => x.who === who), list = (mine.length ? mine : pend).sort((a, b) => a.at - b.at);
    if (nums.length === 1) { const x = list[list.length - 1]; x.num = nums[0]; x.how = "after"; x.alerted = false; }   // رقم واحد → آخر صورة بدون رقم
    else nums.slice(0, list.length).forEach((n, i) => { list[i].num = n; list[i].how = "after"; });                      // كذا رقم → بالترتيب
    await saveMonth(monthOf(at));
  }
}

async function addImage({ id, at, by, who, buf, num, how, imp = false, pre = null }) {
  const mk = monthOf(at), o = await loadMonth(mk);
  if (o.items.some(x => x.id === id)) return null;
  const path = `ecg/${mk}/${id}.jpg`;
  await bucket().file(path).save(buf, { contentType: "image/jpeg", resumable: false });
  const it = { id, at, by: String(by).slice(0, 40), who: String(who).slice(0, 60), num, how, kind: "", path, ...(imp ? { imp: true } : {}) };
  if (pre) { it.kind = pre.kind || "ecg"; const n = fileNums(pre.file_no || "")[0]; if (n) it.read = n; if (pre.date) it.rdate = String(pre.date).slice(0, 16); }   // انقرت قبل (خاص) — ما نعيد
  o.items.push(it); await saveMonth(mk);
  if (!pre) classify(it, buf).then(() => saveMonth(mk)).catch(() => {});   // فاتورة؟ رقم على الورقة؟ (بالخلفية)
  return it;
}

/* ---------- الذكاء: تخطيط ولا فاتورة؟ ورقم الملف ---------- */
async function classify(it, buf) {
  const o = await readEcg(buf); if (!o) return;
  it.kind = o.kind || "";
  const n = fileNums(o.file_no || "")[0] || "";
  if (n) it.read = n;                                          // الرقم المقروء من الصورة (فاتورة أو ورقة)
  if (o.date) it.rdate = String(o.date).slice(0, 16);
}
async function readEcg(buf) {
  if (!C.gemini) return null;
  const prompt = `صورة من عيادة فيها تخطيط قلب (ECG) لمريض — ورقة مصوّرة أو تقرير مصدَّر من جهاز التخطيط («12Channel Rhythm Report»)، أو فاتورة.
حدد نوعها: "ecg" لو فيها ورقة/تقرير تخطيط قلب (حتى لو فيه فاتورة جنبها)، "invoice" لو فاتورة/إيصال بس بدون تخطيط، "other" غير كذا.
file_no: رقم الملف الطبي للمريض (7 أرقام، مكتوب "ID :" فوق يسار التقرير، أو "Patient ID" أو "رقم الملف الطبي" أو File No) لو مكتوب في الصورة، وإلا "".
date: تاريخ الإصدار/الفحص المكتوب "YYYY-MM-DD HH:MM" لو موجود، وإلا "".`;
  for (const model of C.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": C.gemini },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { kind: { type: "STRING", enum: ["ecg", "invoice", "other"] }, file_no: { type: "STRING" }, date: { type: "STRING" } }, required: ["kind"] } } }) });
      clearTimeout(tm); if (!r.ok) continue;
      const j = await r.json();
      return JSON.parse((j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("") || "{}");
    } catch {}
  }
  return null;
}

/* ---------- بعد 5 دقايق: صورة بدون رقم ---------- */
async function resolvePending() {
  const now = Date.now(), changed = new Set();
  await loadMonth(monthOf(now));
  for (const { it, mk } of allLoaded()) {
    if (it.num || it.alerted || it.kind === "invoice" || it.kind === "other" || now - it.at < WIN + 15e3 || now - it.at > 3 * 864e5) continue;
    if (!it.kind && now - it.at < WIN + 120e3) continue;          // ننتظر الذكاء شوي
    const n = numFor(it, months.get(mk).items);
    if (n) { it.num = n.num; it.how = n.how; changed.add(mk); continue; }
    it.alerted = true; changed.add(mk);
    await alertTeam(it).catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: تنبيه"));
  }
  for (const mk of changed) await saveMonth(mk);
}
function numFor(it, items) {
  const inv = items.filter(x => x.kind === "invoice" && x.read && x.who === it.who && Math.abs(x.at - it.at) <= WIN).sort((a, b) => Math.abs(a.at - it.at) - Math.abs(b.at - it.at))[0];
  if (inv) return { num: inv.read, how: "invoice" };
  if (it.read) return { num: it.read, how: "paper" };
  return null;
}
async function alertTeam(it) {
  if (!can("GROUP_ECG", "alerts")) return;                                         // (2.20.0) خانة قروب ECG
  const [f] = await bucket().file(it.path).download();
  it.code = short(); it.alertIds = [];
  for (const who of ["anas"]) {                                                    // (2.19.1) ماجد انشال — لأنس بس
    const jid = jidOf(who); if (!jid) continue;
    const s = await C.getSock().sendMessage(jid, { image: f, caption: `🫀 صورة ECG بدون رقم ملف #E${it.code}\nمن ${it.by} — ${hm(it.at)}\nرد (اسحب) على هذي الرسالة برقم الملف، أو «تجاهل» لو مو تخطيط.` }).catch(() => null);
    if (s?.key?.id) it.alertIds.push(s.key.id);
  }
}
// (2.15.3) الإرسال لأنس وماجد: برقمهم مباشرة (onWhatsApp كان يعلّق وقت رجوع الاتصال). الملفات تنحفظ في «الصادر» على القرص
//  قبل الإرسال، ونعيد المحاولة كل دقيقة لين توصل الاثنين (حتى بعد إعادة تشغيل البوت)
const jidOf = who => { const ph = String(C.team[who]?.phone || "").replace(/\D/g, "").replace(/^(966|0)/, ""); return ph ? `966${ph}@s.whatsapp.net` : ""; };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("مهلة الإرسال")), ms))]);
async function sendTo(who, content) { const j = jidOf(who); if (!j) return true; await withTimeout(C.getSock().sendMessage(j, content), content.document ? 10 * 60e3 : 60e3); return true; }
const OUT = "outbox/";
let flushing = false, outFailAt = 0;
async function sendBoth(content, exclude = "") {
  const to = ["anas"].filter(w => w !== exclude && jidOf(w));                     // (2.19.1) ماجد انشال — لأنس بس
  if (!content.document) {                                                         // نص: 5 محاولات بالخلفية
    (async () => { for (const w of to) for (let i = 0; i < 5; i++) { try { await sendTo(w, content); break; } catch (e) { C.log.warn({ err: String(e?.message || e), w, i }, "ECG: إرسال نص"); await new Promise(r => setTimeout(r, 30e3)); } } })();
    return;
  }
  const id = Date.now().toString(36) + short();
  await bucket().file(OUT + id + ".bin").save(content.document);
  await bucket().file(OUT + id + ".json").save(Buffer.from(JSON.stringify({ id, at: Date.now(), to, fileName: content.fileName, mimetype: content.mimetype, caption: content.caption || "" })));
  flushOutbox().catch(() => {});
}
async function flushOutbox() {
  if (flushing) return; flushing = true;
  try {
    const [files] = await bucket().getFiles({ prefix: OUT });
    for (const f of files.filter(f => f.name.endsWith(".json"))) {
      const meta = JSON.parse((await bucket().file(f.name).download())[0].toString());
      if (Date.now() - meta.at > 3 * 864e5) { await bucket().file(f.name).delete(); await bucket().file(OUT + meta.id + ".bin").delete(); continue; }   // 3 أيام وما انرسل → نشيله
      const [doc] = await bucket().file(OUT + meta.id + ".bin").download();
      for (const w of [...meta.to]) {
        try { await sendTo(w, { document: doc, mimetype: meta.mimetype, fileName: meta.fileName, caption: meta.caption }); meta.to = meta.to.filter(x => x !== w); C.log.info({ id: meta.id, w }, "ECG: انرسل الملف"); }
        catch (e) { outFailAt = Date.now(); C.log.warn({ err: String(e?.message || e), id: meta.id, w }, "ECG: إرسال الملف — بنعيد المحاولة"); }
      }
      if (meta.to.length) await bucket().file(f.name).save(Buffer.from(JSON.stringify(meta)));
      else { await bucket().file(f.name).delete(); await bucket().file(OUT + meta.id + ".bin").delete(); }
    }
  } finally { flushing = false; }
}
async function outboxCount() { try { const [f] = await bucket().getFiles({ prefix: OUT }); return f.filter(x => x.name.endsWith(".json")).length; } catch { return 0; } }

/* ---------- (2.19.1) صور ECG الناقصة: أنس يرسلها خاص بعد الشيت → تنضاف لآخر ملف والشيت يتعلّم عليه ---------- */
const LAST = "ecg_last/";
async function saveLast(meta, zipBuf) {
  await bucket().file(LAST + "last.zip").save(zipBuf);
  await bucket().file(LAST + "last.json").save(Buffer.from(JSON.stringify(meta)));
}
async function readLast() { try { return JSON.parse((await bucket().file(LAST + "last.json").download())[0].toString()); } catch { return null; } }
const lastOpen = m => m && Date.now() - m.at < 14 * 864e5 && (m.missRows || []).some(r => !r.done);
const noNum = new Map();                                  // id رسالة الصورة → { buf, at } (ما انقرا رقمها أو مو من الناقصين)
let addQ = [], addT = null, savedQ = [], savedT = null;
function queueAdd(x, say, ack = true) {
  if (ack && !addQ.length) say("⏳ وصلت — أجمّع صور الناقصين وأرسل لك الملف بعد دقيقة من آخر صورة.");
  addQ.push(x); clearTimeout(addT);
  addT = setTimeout(() => { const L = addQ; addQ = []; addMissing(L).then(say).catch(async e => { C.log.error({ err: String(e?.stack || e) }, "ECG: الناقصة"); await say("❌ ما قدرت أضيف الصور: " + String(e?.message || e).slice(0, 120)); }); }, 60e3);
}
async function addMissing(list) {
  const meta = await readLast(); if (!meta) return "❌ ما لقيت آخر ملف — أرسل الشيت من جديد.";
  const [zb] = await bucket().file(LAST + "last.zip").download();
  const zip = await JSZip.loadAsync(zb), sf = zip.file(meta.sheetName); if (!sf) return "❌ الشيت مو موجود داخل آخر ملف — أرسل الشيت من جديد.";
  const wb = await loadWb(await sf.async("nodebuffer")), ws = wb.worksheets[0];
  const added = [], dup = [];
  for (const x of list) {
    const row = meta.missRows.find(r => r.num === x.num && !r.done);
    if (!row) { dup.push(x.num); continue; }
    let name = `${x.num}.jpg`; for (let i = 2; zip.file("ECG/" + name); i++) name = `${x.num}_${i}.jpg`;
    const img = await stamp(x.buf, x.num);
    zip.file("ECG/" + name, img); mark(ws, row.r, meta.sc, "ok", "تم"); row.done = true; added.push(x.num);
    // نحفظها مع صور الشهر بعد (لو انطلب شيت ثاني فيه نفس الرقم)
    addImage({ id: "dm" + x.id, at: x.at, by: "أنس (خاص)", who: "anas", buf: x.buf, num: x.num, how: "dm" }).catch(() => {});
    // البانوراما لسا ما وصلت → نحدّث طلبها بعد عشان الملف الكامل اللي يجي بعدين فيه الصور الجديدة
    if (pjob && pjob.fileName === meta.fileName) await patchJob(name, img, row, meta.sc).catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: تحديث طلب البانوراما"));
  }
  const rem = meta.missRows.filter(r => !r.done).map(r => r.num);
  if (!added.length) return `ℹ️ ما انضاف شي — ${dup.length ? `الأرقام (${dup.join("، ")}) مو من الناقصين في «${meta.fileName}» أو انضافت قبل` : "ما فيه صور"}.${rem.length ? `\nالناقصين: ${rem.join("، ")}` : ""}`;
  zip.file(meta.sheetName, Buffer.from(await wb.xlsx.writeBuffer()));
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await saveLast(meta, out);
  await sendBoth({ document: out, mimetype: "application/zip", fileName: meta.zipName, caption: [`📎 ${meta.fileName} (بعد الصور الناقصة)`, `✅ انضافت ${added.length}: ${added.join("، ")}`, rem.length ? `❌ باقي بدون صورة (${rem.length}): ${rem.join("، ")}` : "🎉 ما بقى ولا سطر بدون صورة", dup.length ? `ℹ️ مو من الناقصين: ${dup.join("، ")}` : "", meta.panoPending ? "🦷 البانوراما لسا ما وصلت — الملف الكامل يجيك لما ترجع" : ""].filter(Boolean).join("\n") });
  return "";
}
async function patchJob(name, img, row, sc) {
  const [sb] = await bucket().file(pjob.sheetPath).download();
  const wb = await loadWb(sb); mark(wb.worksheets[0], row.r, sc, "ok", "تم");
  await bucket().file(pjob.sheetPath).save(Buffer.from(await wb.xlsx.writeBuffer()));
  let ez = new JSZip(); if (pjob.ecgPath) { try { ez = await JSZip.loadAsync((await bucket().file(pjob.ecgPath).download())[0]); } catch { /* جديد */ } }
  ez.file(name, img);
  const ecgPath = pjob.ecgPath || `pano/${pjob.id}-ecg.zip`;
  await bucket().file(ecgPath).save(await ez.generateAsync({ type: "nodebuffer", compression: "STORE" }));
  if (!pjob.ecgPath) { pjob.ecgPath = ecgPath; await C.db.doc("bot/pano_job").set(pjob).catch(() => {}); }
}
// صورة من أنس خاص: تخطيط؟ ورقمه من الناقصين في آخر شيت؟
async function dmImage(m, g, say) {
  const img = g.imageMessage, doc = g.documentMessage;
  if (!img && !(doc && /^image\//i.test(String(doc.mimetype || "")))) return false;
  const meta = await readLast(), open = lastOpen(meta);
  let buf; try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch { return false; }
  const cap = fileNums(String((img || doc)?.caption || ""))[0];
  const o = cap && open ? { kind: "ecg", file_no: cap } : await readEcg(buf);
  if (!o || o.kind !== "ecg") return false;                                       // مو تخطيط → يكمل (ترخيص، إجازة، وارد)
  const num = cap || fileNums(o.file_no || "")[0] || "", id = m.key.id, at = Date.now();
  // (2.19.2) ما فيه شيت فيه ناقصين → نحفظها مع صور الشهر (تدخل في الشيت الجاي) — ما تروح للتراخيص ولا الوارد
  if (!open) {
    await addImage({ id: "dm" + id, at, by: "أنس (خاص)", who: "anas", buf, num, how: num ? "dm" : "", pre: o });
    savedQ.push(num || "؟"); clearTimeout(savedT);
    savedT = setTimeout(() => { const L = savedQ; savedQ = []; const unk = L.filter(x => x === "؟").length;
      say(`🫀 حفظت ${L.length === 1 ? "صورة ECG" : L.length + " صور ECG"} مع صور الشهر${L.length - unk ? ` (${L.filter(x => x !== "؟").join("، ")})` : ""} — تدخل في الشيت الجاي.\nما عندي شيت فيه ناقصين${meta ? ` (آخر شيت «${meta.fileName}» ما بقى فيه ناقص أو قديم)` : ""}. لو تبغاها تنضاف لشيت أرسلته قبل، أرسل الشيت مرة ثانية.${unk ? `\n⚠️ ${unk} ما قدرت أقرأ رقمها — بيجيك تنبيه ترد عليه بالرقم.` : ""}`); }, 15e3);
    return true;
  }
  const miss = meta.missRows.filter(r => !r.done).map(r => r.num);
  if (num && miss.includes(num)) { queueAdd({ id, num, buf, at }, say); return true; }
  noNum.set(id, { buf, at }); for (const [k, v] of noNum) if (at - v.at > 6 * 3600e3) noNum.delete(k);
  await say(num ? `🫀 رقم ${num} مو من الأسطر الناقصة في «${meta.fileName}».\nلو الرقم غلط رد (اسحب) على الصورة بالرقم الصح.\nالناقصين: ${miss.join("، ")}` : "🫀 ما قدرت أقرأ رقم الملف من الصورة — رد (اسحب) عليها بالرقم.");
  return true;
}

/* ---------- (2.19.3) بانوراما بالرقم: «بانوراما 7632751» → التواريخ → أنس يختار → الصورة ---------- */
let preq = null, choices = {};
const REQF = "pano/req.json";
async function loadReq() { try { const o = JSON.parse((await bucket().file(REQF).download())[0].toString()); preq = o.preq || null; choices = o.choices || {}; } catch { /* أول مرة */ } }
function saveReq() { bucket().file(REQF).save(Buffer.from(JSON.stringify({ preq, choices }))).catch(() => {}); }
const fmtAt = a => { const x = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(a || ""); return x ? `${x[3]}/${x[2]}/${x[1]}${x[4] ? " " + x[4] + ":" + x[5] : ""}` : (a || "بدون تاريخ"); };
const agoTxt = ms => { const mn = Math.round((Date.now() - ms) / 60e3); return !ms ? "ولا مرة" : mn < 90 ? `${mn} دقيقة` : mn < 2880 ? `${Math.round(mn / 60)} ساعة` : `${Math.round(mn / 1440)} يوم`; };
async function requestPano(nums, say) {
  if (preq?.sentAt) preq.wait = [...new Set([...(preq.wait || []), ...nums])];      // الجهاز شغّال على طلب → بعده
  else if (preq) preq.nums = [...new Set([...preq.nums, ...nums])];
  else preq = { id: "q" + Date.now().toString(36) + short(), at: Date.now(), sentAt: 0, nums };
  saveReq();
  await say([`⏳ طلبت بانوراما ${nums.join("، ")} من جهاز الأشعة — توصلك خلال 10 دقايق تقريباً.`,
    agentOn() ? "" : `⚠️ جهاز الأشعة ${agent.at ? `ما سأل البوت من ${agoTxt(agent.at)}` : "ما سأل البوت من آخر تشغيل"} — يمكن مطفي. الطلب محفوظ ويوصلك أول ما يشتغل.`,
    pjob ? "ℹ️ فيه شيت ينتظر بانوراما — طلبك يتسوّى بعده." : ""].filter(Boolean).join("\n"));
}
async function reqDone(result) {
  const nums = preq?.nums || [], wait = preq?.wait || [];
  preq = wait.length ? { id: "q" + Date.now().toString(36) + short(), at: Date.now(), sentAt: 0, nums: wait } : null;
  for (const [k, v] of Object.entries(choices)) if (Date.now() - v.at > 3 * 864e5) { for (const f of v.files) await bucket().file(f.path).delete().catch(() => {}); delete choices[k]; }
  saveReq();
  for (const num of nums) {
    const all = (result.get(num + "|") || []).slice().sort((a, b) => b.at.localeCompare(a.at));
    if (!all.length) { await sendTo("anas", { text: `🦷 ما لقيت بانوراما لرقم ${num} في جهاز الأشعة.` }).catch(() => {}); continue; }
    if (all.length === 1) { await sendPano(num, all[0].buf, all[0].at); continue; }
    const code = "K" + short().slice(0, 3), files = [];
    for (let i = 0; i < all.length; i++) { const path = `pano/req/${code}-${i}.jpg`; await bucket().file(path).save(all[i].buf); files.push({ at: all[i].at, path }); }
    choices[code] = { num, at: Date.now(), files }; saveReq();
    const N = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    await sendTo("anas", { text: [`🦷 بانوراما ${num}: فيه ${all.length} صور — أي تاريخ؟  #${code}`, ...files.map((f, i) => `${N[i] || i + 1 + "."} ${fmtAt(f.at)}`), "رد برقم الخيار (أو «الكل»)."].join("\n") }).catch(() => {});
  }
}
async function sendPano(num, buf, at) {
  await sendTo("anas", { image: await stamp(buf, num), mimetype: "image/jpeg", caption: `🦷 بانوراما ${num} — ${fmtAt(at)}` });
}
// رد أنس على «أي تاريخ؟»: رقم الخيار (أو كذا رقم) أو «الكل»
async function panoChoice(text, quotedTxt) {
  const qc = /#(K[A-Z0-9]{3})/.exec(quotedTxt || "")?.[1];
  let code = qc && choices[qc] ? qc : "";
  if (!code && !quotedTxt) { const last = Object.entries(choices).sort((a, b) => b[1].at - a[1].at)[0]; if (last && Date.now() - last[1].at < 20 * 60e3) code = last[0]; }
  if (!code) return false;
  const ch = choices[code], t = latin(text).trim();
  let pick = [];
  if (/^(الكل|كلها|كلهم|all)$/i.test(t)) pick = ch.files.map((_, i) => i);
  else if (/^\d{1,2}([\s،,و]+\d{1,2})*$/.test(t)) pick = t.split(/[\s،,و]+/).map(x => +x - 1).filter(i => i >= 0 && i < ch.files.length);
  else return false;
  if (!pick.length) { await sendTo("anas", { text: `اختار رقم من 1 لين ${ch.files.length}.` }).catch(() => {}); return true; }
  for (const i of pick) { const f = ch.files[i]; const [buf] = await bucket().file(f.path).download(); await sendPano(ch.num, buf, f.at); }
  return true;
}

/* ---------- الخاص: أنس ---------- */
// يرجع true لو الرسالة لـ ECG (رد على تنبيه، شيت xlsx، تصدير دردشة zip)
export async function onTeamDM(m, who, text = "") {
  const g = unwrap(m), jid = m.key.remoteJid;
  const doc = g.documentMessage;
  const name = String(doc?.fileName || ""), mime = String(doc?.mimetype || "");
  const say = t => t ? C.getSock().sendMessage(jid, { text: t }, { quoted: m }).catch(() => {}) : null;
  if (await dmImage(m, g, say).catch(e => { C.log.warn({ err: String(e?.message || e) }, "ECG: صورة خاص"); return false; })) return true;
  // (2.19.3) «بانوراما 7632751» / «ارسل لي صورة البانوراما 7632751»
  if (!doc && text && /بانورا|panoram|\bopg\b/i.test(text) && !/حال[هة]/.test(text)) { const nums = fileNums(text); if (nums.length) { await requestPano(nums, say); return true; } }
  if (!doc && text && Object.keys(choices).length) {
    const qtxt = String(g.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || g.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || "");
    if (await panoChoice(text, qtxt).catch(e => { C.log.warn({ err: String(e?.message || e) }, "بانوراما: اختيار"); return false; })) return true;
  }
  if (!doc && /حال[هة]\s*(ال)?بانورا|pano\s*status/i.test(text)) {                 // (2.15.3) «حالة البانوراما»
    const ago = ms => { const mn = Math.round((Date.now() - ms) / 60e3); return !ms ? "ولا مرة" : mn < 1 ? "قبل أقل من دقيقة" : mn < 90 ? `قبل ${mn} دقيقة` : `قبل ${Math.round(mn / 60)} ساعة`; };
    const ob = await outboxCount();
    await say([`🦷 حالة البانوراما`,
      `• جهاز الأشعة: آخر سؤال ${ago(agent.at)}${agent.at ? (agentOn() ? " ✅" : " ⚠️ (مطفي أو نايم؟)") : ""}${agent.ver ? ` · نسخة ${agent.ver}` : ""}`,
      pjob ? `• طلب ينتظر: ${pjob.fileName} (${pjob.rows.length} سطر) — ${pjob.sentAt ? `جهاز الأشعة أخذه ${ago(pjob.sentAt)}` : "جهاز الأشعة ما أخذه للحين"}` : "• ما فيه طلب ينتظر",
      lastRes.at ? `• آخر صور وصلت: ${ago(lastRes.at)} (${lastRes.n} صورة)` : "",
      ob ? `• ملفات تنتظر الإرسال: ${ob} — أعيد المحاولة كل دقيقة` : "• ما فيه ملفات تنتظر الإرسال",
    ].filter(Boolean).join("\n"));
    return true;
  }
  if (doc && (/\.xlsx?$/i.test(name) || /spreadsheet|excel/i.test(mime))) {
    let buf; try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch { return false; }
    const sheet = await readSheet(buf).catch(() => null);
    if (!sheet || (!sheet.rows.length && !sheet.prows.length)) return false;   // مو شيت ECG/بانوراما → يكمل مثل أي ملف
    const pOn = agentOn();
    await say(`⏳ وصل الشيت — ${[sheet.rows.length && `${sheet.rows.length} سطر E.C.G.`, sheet.prows.length && `${sheet.prows.length} سطر بانوراما`].filter(Boolean).join(" و ")}. أجهّز الصور…` +
      (sheet.prows.length ? (pOn ? "\n🦷 البانوراما من جهاز الأشعة — توصل خلال 10 دقايق تقريباً." : "\n🦷 جهاز الأشعة ما سأل من شوي (مطفي؟) — البانوراما ترسل لحالها أول ما يشتغل.") : ""));
    // ما ننتظرها هنا (ممكن 12 دقيقة لجهاز الأشعة) — باقي رسايل البوت تكمل عادي
    processSheet(sheet, name || "sheet.xlsx", who).catch(async e => { C.log.error({ err: String(e?.stack || e) }, "ECG: الشيت"); await say("❌ ما قدرت أجهّز الصور: " + String(e?.message || e).slice(0, 120)); });
    return true;
  }
  if (doc && (/\.zip$/i.test(name) || /zip/i.test(mime)) && /whatsapp|chat|دردشة|ecg/i.test(name)) {
    let buf; try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch { return false; }
    await say("⏳ وصل ملف التصدير — أستورد صور الشهر الحالي…");
    try { await say(await importExport(buf)); } catch (e) { C.log.error({ err: String(e?.stack || e) }, "ECG: التصدير"); await say("❌ ما قدرت أستورد: " + String(e?.message || e).slice(0, 120)); }
    return true;
  }
  // رد على تنبيه «صورة بدون رقم»
  const q = g.extendedTextMessage?.contextInfo?.stanzaId || "", qt = String(g.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption || "");
  if (q && noNum.has(q)) {                                                         // (2.19.1) رقم لصورة ناقصة أرسلها خاص
    const n = fileNums(text)[0]; if (!n) { await say("اكتب رقم الملف (7 أرقام) ردّاً على الصورة."); return true; }
    const meta = await readLast(), miss = (meta?.missRows || []).filter(r => !r.done).map(r => r.num);
    if (!miss.includes(n)) { await say(`رقم ${n} مو من الناقصين.${miss.length ? " الناقصين: " + miss.join("، ") : ""}`); return true; }
    const x = noNum.get(q); noNum.delete(q);
    queueAdd({ id: q, num: n, buf: x.buf, at: x.at }, say, false); await say(`تمام — ${n}. أجمّع الصور وأرسل الملف بعد دقيقة.`); return true;
  }
  const code = (/#E([A-Z0-9]{4})/.exec(qt) || /#E([A-Z0-9]{4})/i.exec(text) || [])[1];
  if (!q && !code) return false;
  await loadMonth(monthOf(Date.now()));
  const hit = allLoaded().find(({ it }) => (q && (it.alertIds || []).includes(q)) || (code && it.code === code.toUpperCase()));
  if (!hit) return false;
  const { it, mk } = hit, n = fileNums(text)[0];
  if (/تجاهل|مو تخطيط|ignore/i.test(text) && !n) { it.kind = "other"; it.num = ""; await saveMonth(mk); await say("تمام، تجاهلتها — ما تدخل في ملفات ECG."); return true; }
  if (!n) { await say("اكتب رقم الملف (7 أرقام) ردّاً على الصورة، أو «تجاهل»."); return true; }
  const prev = it.num; it.num = n; it.how = "team"; it.kind = it.kind === "other" ? "ecg" : it.kind; it.fixedBy = C.team[who]?.name || who;
  await saveMonth(mk);
  const back = (await C.db.doc(`ecg/${mk}`).get()).data()?.items?.find(x => x.id === it.id);   // نتأكد من القاعدة قبل «انحفظ»
  await say(back?.num === n ? `✅ انحفظ: الصورة صارت لملف ${n}${prev && prev !== n ? ` (كانت ${prev})` : ""}.` : "❌ ما انحفظ — جرّب مرة ثانية.");
  if (back?.num === n) await sendBoth({ text: `ℹ️ صورة ECG #E${it.code} (${it.by} — ${hm(it.at)}) حددها ${it.fixedBy}: ملف ${n}.` }, who);
  return true;
}

/* ---------- الشيت ---------- */
const ECG_RE = /e\s*\.?\s*c\s*\.?\s*g|electro\s*cardio|تخطيط/i;
const PANO_RE = /pano|o\s*\.?\s*p\s*\.?\s*g\b|orthopan|بانورا/i;
// (2.15.1) شيت الإدارة فيه «جدول» Excel (Table1) — مكتبة exceljs تطيح عليه (tables[table.name]) → نشيل تعريف الجدول ونقرأ الخلايا عادي
async function loadWb(buf) {
  try { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }
  catch (e) {
    const z = await JSZip.loadAsync(buf);
    for (const f of Object.keys(z.files)) {
      if (/^xl\/tables\//.test(f)) z.remove(f);
      else if (/^xl\/worksheets\/sheet[^/]*\.xml$/.test(f)) z.file(f, (await z.file(f).async("string")).replace(/<tableParts[\s\S]*?<\/tableParts>|<tableParts[^>]*\/>/g, ""));
      else if (/^xl\/worksheets\/_rels\/.*\.rels$/.test(f)) z.file(f, (await z.file(f).async("string")).replace(/<Relationship [^>]*relationships\/table"[^>]*\/>/g, ""));
      else if (f === "[Content_Types].xml") z.file(f, (await z.file(f).async("string")).replace(/<Override [^>]*\/xl\/tables\/[^>]*\/>/g, ""));
    }
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await z.generateAsync({ type: "nodebuffer" })); return wb;
  }
}
async function readSheet(buf) {
  const wb = await loadWb(buf);
  const ws = wb.worksheets[0]; if (!ws) return null;
  let hr = 0, fc = 0, dc = 0, tc = 0, sc = 0;
  for (let r = 1; r <= Math.min(8, ws.rowCount) && !hr; r++) {
    ws.getRow(r).eachCell((c, i) => {
      const v = String(c.text || c.value || "").toLowerCase();
      if (/file\s*no|رقم الملف|patient\s*id/.test(v)) fc = i;
      if (/desc|service|الخدمة|الوصف/.test(v)) dc = i;
      if (/date|تاريخ/.test(v)) tc = i;
      if (/statu|الحالة/.test(v)) sc = i;
    });
    if (fc) hr = r;
  }
  if (!hr || !dc) return null;
  if (!sc) { sc = ws.getRow(hr).cellCount + 1; ws.getRow(hr).getCell(sc).value = "Statue"; }
  const rows = [], prows = [];
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), desc = String(row.getCell(dc).text || "");
    const kind = ECG_RE.test(desc) ? "ecg" : PANO_RE.test(desc) ? "pano" : ""; if (!kind) continue;
    const num = fileNums(String(row.getCell(fc).text || row.getCell(fc).value || ""))[0];
    if (!num) continue;
    (kind === "ecg" ? rows : prows).push({ r, num, at: cellTime(row.getCell(tc)) });
  }
  return { wb, ws, rows, prows, sc };
}
function cellTime(c) {
  const v = c?.value;
  if (v instanceof Date) return v.getTime() - 3 * 3600e3;           // إكسل بدون منطقة زمنية = وقت الرياض
  const s = latin(String(c?.text || v || "")).trim();
  const x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s) || null;
  if (x) return Date.UTC(+x[1], +x[2] - 1, +x[3], +(x[4] || 12), +(x[5] || 0), +(x[6] || 0)) - 3 * 3600e3;
  const y = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (y) return Date.UTC(+y[3], +y[2] - 1, +y[1], 12) - 3 * 3600e3;
  return 0;
}
const fonts = new Map();
// (2.15.3) رقم الملف على الصورة: الملصق الصغير (أبيض + الرقم) بـ jimp، والصورة الكبيرة بـ sharp (سريعة وبالخلفية).
// قبل: jimp يفك ويحفظ كل صورة بنفسه → 76 بانوراما حبست البوت دقايق → الواتساب انقطع (408) وضاع الملف
async function label(text, w) {
  const fk = w < 700 ? SANS_32_BLACK : w < 1800 ? SANS_64_BLACK : SANS_128_BLACK;
  const font = fonts.get(fk) || fonts.set(fk, await loadFont(fk)).get(fk);
  const sz = w < 700 ? 32 : w < 1800 ? 64 : 128, pad = Math.round(sz / 4), tw = measureText(font, text);
  const img = new Jimp({ width: tw + pad * 2, height: Math.round(sz * 1.15) + pad, color: 0xffffffff });
  img.print({ font, x: pad, y: Math.round(pad / 2), text });
  return img;
}
async function stamp(buf, text) {
  if (sharp) try {
    const meta = await sharp(buf).metadata(), w = (meta.orientation || 1) >= 5 ? meta.height : meta.width;
    const lb = await (await label(text, w)).getBuffer("image/png");
    return await sharp(buf).rotate().composite([{ input: lb, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
  } catch (e) { C.log.warn({ err: String(e?.message || e) }, "sharp — نرجع لـ jimp"); }
  const img = await Jimp.read(buf);
  img.composite(await label(text, img.bitmap.width), 0, 0);
  return img.getBuffer("image/jpeg", { quality: 90 });
}
// (2.15.2) ألوان الشيت: أخضر = لقينا الصورة، أصفر = صورة من يوم ثاني غير تاريخ الفاتورة، أحمر = ما فيه صورة
const FILL = { ok: "FFC6EFCE", near: "FFFFEB9C", none: "FFFFC7CE" };
function mark(ws, r, sc, kind, text) {
  const row = ws.getRow(r), n = Math.max(ws.columnCount || 0, sc);
  row.getCell(sc).value = text;
  for (let c = 1; c <= n; c++) {                                                  // نسخة من التنسيق لكل خلية (exceljs يشارك التنسيق بين الخلايا)
    const cell = row.getCell(c);
    cell.style = { ...JSON.parse(JSON.stringify(cell.style || {})), fill: { type: "pattern", pattern: "solid", fgColor: { argb: FILL[kind] } } };
  }
  row.commit?.();
}
async function processSheet({ wb, ws, rows, prows = [], sc }, fileName, who) {
  const now = Date.now(), base = fileName.replace(/\.xlsx?$/i, ""), byName = C.team[who]?.name || who;
  const ecgFiles = [], miss = [], missRows = [];
  if (rows.length) {
    const first = Math.min(...rows.map(r => r.at || now));
    // الشهور: من أول فاتورة لين الحين (الصور اللي تتأخر تنحسب على شهر إرسالها)
    for (let d = ridh(first), y = d.getUTCFullYear(), mo = d.getUTCMonth(); ; mo++) { const mk = monthOf(Date.UTC(y, mo, 15)); if (mk > monthOf(now)) break; await loadMonth(mk); }
    const imgs = allLoaded().map(x => x.it).filter(x => x.num && x.kind !== "invoice" && x.kind !== "other");
    // كل سطر ← الصورة الأقرب لتاريخ فاتورته (الأقرب أول، وصورة وحدة لكل سطر)
    const pairs = [];
    rows.forEach((r, ri) => imgs.filter(x => x.num === r.num).forEach(x => pairs.push({ ri, x, d: r.at ? Math.abs(x.at - r.at) : 0 })));
    pairs.sort((a, b) => a.d - b.d);
    const used = new Set(), got = new Map();
    for (const p of pairs) if (!got.has(p.ri) && !used.has(p.x.id)) { got.set(p.ri, p.x); used.add(p.x.id); }
    const per = {}; rows.forEach(r => per[r.num] = (per[r.num] || 0) + 1);
    const seq = {};
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri], x = got.get(ri);
      if (!x) { mark(ws, r.r, sc, "none", "لا توجد صورة"); miss.push(r.num); missRows.push({ r: r.r, num: r.num }); continue; }
      try {
        const [buf] = await bucket().file(x.path).download();
        seq[r.num] = (seq[r.num] || 0) + 1;
        ecgFiles.push({ name: `${r.num}${per[r.num] > 1 ? "_" + seq[r.num] : ""}.jpg`, buf: await stamp(buf, r.num) });
        const d = dayOf(x.at);
        if (r.at && d !== dayOf(r.at)) mark(ws, r.r, sc, "near", `تم — صورة ${+d.slice(8)}/${+d.slice(5, 7)}`); else mark(ws, r.r, sc, "ok", "تم");
      } catch (e) { mark(ws, r.r, sc, "none", "لا توجد صورة"); miss.push(r.num); missRows.push({ r: r.r, num: r.num }); C.log.warn({ err: String(e?.message || e), path: x.path }, "ECG: صورة"); }
    }
  }
  const ecgCap = rows.length ? `🫀 ECG: ✅ ${rows.length - miss.length} من ${rows.length} لقيت صورهم${miss.length ? `\n❌ بدون صورة (${miss.length}): ${miss.join("، ")}` : ""}` : "";
  // البانوراما: من جهاز الأشعة (ننتظره 15 دقيقة لو كان شغّال)
  let pano = null;
  if (prows.length) {
    const job = await newPanoJob(prows, sc, fileName, who, Buffer.from(await wb.xlsx.writeBuffer()));
    if (agentOn()) pano = await waitPano(job.id, 15 * 60e3);
    if (pano) { await dropPanoJob(job.id); pano = await applyPano(pano, job.rows, ws, sc); }
  }
  const zip = new JSZip();
  for (const f of ecgFiles) zip.file("ECG/" + f.name, f.buf);
  if (pano) for (const f of pano.files) zip.file("PANORAMIC/" + f.name, f.buf);          // أسماء المجلدات إنجليزي (العربي يطلع رموز في ويندوز)
  // البانوراما بتتأخر → نحفظ صور الـ ECG مع الطلب عشان الملف اللي يجي بعدين يكون كامل (ECG + بانوراما + الشيت)
  if (prows.length && !pano && ecgFiles.length && pjob) {
    try {
      const ez = new JSZip(); for (const f of ecgFiles) ez.file(f.name, f.buf);
      const ecgPath = `pano/${pjob.id}-ecg.zip`;
      await bucket().file(ecgPath).save(await ez.generateAsync({ type: "nodebuffer", compression: "STORE" }), { contentType: "application/zip" });
      pjob.ecgPath = ecgPath; pjob.ecgCap = ecgCap; await C.db.doc("bot/pano_job").set(pjob).catch(() => {});
    } catch (e) { C.log.warn({ err: String(e?.message || e) }, "ECG: حفظ الصور مع طلب البانوراما"); }
  }
  if (rows.length || pano) {
    zip.file(fileName.replace(/[\\/:*?"<>|]/g, "_"), Buffer.from(await wb.xlsx.writeBuffer()));
    const out = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const cap = [`📎 ${fileName}`, ecgCap, pano && pano.cap, prows.length && !pano && "🦷 البانوراما: جهاز الأشعة ما رد للحين — ترسل لحالها أول ما يرد.", `طلبه: ${byName}`].filter(Boolean).join("\n");
    const zipName = `${base} - ${[rows.length && "ECG", pano && "بانوراما"].filter(Boolean).join(" + ")}.zip`;
    await sendBoth({ document: out, mimetype: "application/zip", fileName: zipName, caption: cap });
    if (rows.length) await saveLast({ at: now, fileName, zipName, sheetName: fileName.replace(/[\\/:*?"<>|]/g, "_"), sc, missRows, panoPending: !!(prows.length && !pano) }, out).catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: حفظ آخر ملف"));
  } else await sendBoth({ text: `🦷 ${fileName}: ${prows.length} سطر بانوراما — جهاز الأشعة ما رد للحين، ترسل لحالها أول ما يرد.\nطلبه: ${byName}` });
  // الحذف: شيت شهر خلص → بعد يوم تنحذف صور ذاك الشهر
  if (rows.length) {
    const last = Math.max(...rows.map(r => r.at || 0)), sm = last ? monthOf(last) : "";
    if (sm && sm < monthOf(now) && !conf.purge.some(p => p.month === sm)) { conf.purge.push({ month: sm, at: now + 864e5, by: who }); await saveConf(); }
  }
}

/* ---------- البانوراما: جهاز الأشعة (SabaPano) ---------- */
let pjob = null, agent = { at: 0, ver: "" }, waiter = null, agentSaved = 0, lastRes = { at: 0, n: 0 };
// جهاز الأشعة يسأل كل 10 دقايق؛ نكتب آخر سؤال مرة كل ساعة بالكثير (عشان بعد إعادة تشغيل البوت نعرف إنه شغّال)
const AGENT_ON = 75 * 60e3;
const agentOn = () => Date.now() - agent.at < AGENT_ON;
const dayOf = ms => ms ? ridh(ms).toISOString().slice(0, 10) : "";
async function newPanoJob(prows, sc, fileName, who, sheetBuf) {
  const id = Date.now().toString(36) + short();
  if (pjob?.sheetPath) await bucket().file(pjob.sheetPath).delete().catch(() => {});   // طلب قديم ما خلص → الجديد يحل محله
  if (pjob?.ecgPath) await bucket().file(pjob.ecgPath).delete().catch(() => {});
  const sheetPath = `pano/${id}.xlsx`;
  await bucket().file(sheetPath).save(sheetBuf, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  pjob = { id, at: Date.now(), fileName, who, sc, sheetPath, sentAt: 0, rows: prows.map((r, i) => ({ i, r: r.r, num: r.num, date: dayOf(r.at) })) };
  await C.db.doc("bot/pano_job").set(pjob).catch(() => {});
  return pjob;
}
async function dropPanoJob(id) {
  if (!pjob || pjob.id !== id) return;
  await bucket().file(pjob.sheetPath).delete().catch(() => {});
  pjob = null; await C.db.doc("bot/pano_job").delete().catch(() => {});
}
function waitPano(id, ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => { if (waiter?.id === id) waiter = null; resolve(null); }, ms);
    waiter = { id, resolve: r => { clearTimeout(t); waiter = null; resolve(r); } };
  });
}
// صور كل مراجع (رقم الملف|التاريخ) ← أسطر الشيت: سطر واحد = آخر صورة بنفس اليوم، أكثر من سطر = بالترتيب. ما فيه بنفس اليوم = الأقرب (±3 أيام)
async function applyPano(result, jrows, ws, sc) {
  const per = {}; jrows.forEach(r => per[r.num] = (per[r.num] || 0) + 1);
  const groups = new Map(); for (const r of jrows) { const k = r.num + "|" + r.date; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const pick = new Map(), notes = [], miss = [], nearOf = new Map();
  for (const [k, rs] of groups) {
    const all = (result.get(k) || []).slice().sort((a, b) => a.at.localeCompare(b.at)), date = rs[0].date;
    let same = date ? all.filter(x => x.at.startsWith(date)) : all;
    if (!same.length && all.length) {
      const ms = s => Date.parse(s.slice(0, 10) + "T12:00:00Z"), d0 = date ? ms(date) : Date.now();
      const near = all.reduce((b, x) => Math.abs(ms(x.at) - d0) < Math.abs(ms(b.at) - d0) ? x : b);
      same = all.filter(x => x.at.slice(0, 10) === near.at.slice(0, 10));
      rs.forEach(r => nearOf.set(r.i, near.at.slice(0, 10)));
      notes.push(`${rs[0].num}: ${date ? `ما فيه صورة يوم ${date}، أخذت صورة ${near.at.slice(0, 10)}` : "السطر بدون تاريخ، أخذت آخر صورة"}`);
    }
    if (rs.length === 1) { if (same.length) { pick.set(rs[0].i, same[same.length - 1]); if (same.length > 1) notes.push(`${rs[0].num}: فيه ${same.length === 2 ? "صورتين" : same.length + " صور"} بنفس اليوم، أرسلت الأخيرة (${same[same.length - 1].at.slice(11, 16)})`); } }
    else rs.forEach((r, j) => { if (same[j]) pick.set(r.i, same[j]); });
  }
  const files = [], seq = {};
  for (const r of jrows) {
    const x = pick.get(r.i);
    if (!x) { mark(ws, r.r, sc, "none", "لا توجد صورة"); miss.push(r.num); continue; }
    try {
      seq[r.num] = (seq[r.num] || 0) + 1;
      files.push({ name: `${r.num}${per[r.num] > 1 ? "_" + seq[r.num] : ""}.jpg`, buf: await stamp(x.buf, r.num) });
      const nd = nearOf.get(r.i);
      if (nd && r.date) mark(ws, r.r, sc, "near", `تم — صورة ${+nd.slice(8)}/${+nd.slice(5, 7)}`); else mark(ws, r.r, sc, "ok", "تم");
    } catch (e) { mark(ws, r.r, sc, "none", "لا توجد صورة"); miss.push(r.num); C.log.warn({ err: String(e?.message || e) }, "بانوراما: صورة"); }
  }
  const cap = `🦷 بانوراما: ✅ ${files.length} من ${jrows.length} لقيت صورهم${miss.length ? `\n❌ بدون صورة (${miss.length}): ${miss.join("، ")}` : ""}${notes.length ? "\nℹ️ " + notes.join("\nℹ️ ") : ""}`;
  return { files, cap };
}
// النتيجة وصلت بعد ما أرسلنا الـ ECG (جهاز الأشعة كان مطفي) → الملف كامل: صور الـ ECG (انحفظت مع الطلب) + البانوراما + الشيت
async function finishLate(result) {
  const job = pjob; if (!job) return;
  const [sheetBuf] = await bucket().file(job.sheetPath).download();
  const wb = await loadWb(sheetBuf); const ws = wb.worksheets[0];
  const pano = await applyPano(result, job.rows, ws, job.sc);
  const zip = new JSZip();
  let nEcg = 0;
  if (job.ecgPath) {
    try { const [eb] = await bucket().file(job.ecgPath).download(); const ez = await JSZip.loadAsync(eb);
      for (const [n, f] of Object.entries(ez.files)) if (!f.dir) { zip.file("ECG/" + n, await f.async("nodebuffer")); nEcg++; } }
    catch (e) { C.log.warn({ err: String(e?.message || e) }, "ECG: صور الطلب المتأخر"); }
  }
  for (const f of pano.files) zip.file("PANORAMIC/" + f.name, f.buf);
  zip.file(job.fileName.replace(/[\\/:*?"<>|]/g, "_"), Buffer.from(await wb.xlsx.writeBuffer()));
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  const lastM = await readLast();
  if (lastM && lastM.fileName === job.fileName) await saveLast({ ...lastM, zipName: `${job.fileName.replace(/\.xlsx?$/i, "")} - ${nEcg ? "ECG + " : ""}بانوراما.zip`, panoPending: false }, out).catch(() => {});
  await sendBoth({ document: out, mimetype: "application/zip", fileName: `${job.fileName.replace(/\.xlsx?$/i, "")} - ${nEcg ? "ECG + " : ""}بانوراما.zip`, caption: [`📎 ${job.fileName} (الملف كامل)`, nEcg ? job.ecgCap : "", pano.cap, `طلبه: ${C.team[job.who]?.name || job.who}`].filter(Boolean).join("\n") });
  if (job.ecgPath) await bucket().file(job.ecgPath).delete().catch(() => {});
  await dropPanoJob(job.id);
}
const readBody = (req, max) => new Promise((ok, no) => { const a = []; let n = 0; req.on("data", c => { n += c.length; if (n > max) { no(new Error("كبير")); req.destroy(); } else a.push(c); }); req.on("end", () => ok(Buffer.concat(a))); req.on("error", no); });
// السيرفر (bot.js): / ← حي، /pano/ping /pano/poll /pano/result ← جهاز الأشعة بالمفتاح PANO_KEY (من متغيرات Railway)
export async function panoHttp(req, res) {
  const u = new URL(req.url, "http://x"), send = (code, body = "", type = "text/plain; charset=utf-8") => { if (!res.headersSent) { res.writeHead(code, { "content-type": type }); res.end(body); } };
  if (u.pathname === "/" || u.pathname === "/health") return send(200, "saba bot ok");
  if (!u.pathname.startsWith("/pano/")) return send(404, "not found");
  const key = process.env.PANO_KEY || "";
  if (!key) return send(503, "PANO_KEY missing");
  if (req.headers["x-pano-key"] !== key) return send(401, "no");
  agent = { at: Date.now(), ver: u.searchParams.get("v") || agent.ver };
  if (Date.now() - agentSaved > 3600e3) { agentSaved = Date.now(); C.db.doc("bot/pano_agent").set({ at: agent.at, ver: agent.ver }).catch(() => {}); }
  if (u.pathname === "/pano/ping") return send(200, JSON.stringify({ ok: true, job: !!pjob }), "application/json");
  if (u.pathname === "/pano/poll" && req.method === "GET") {
    if (pjob && !(pjob.sentAt && Date.now() - pjob.sentAt < 8 * 60e3)) {             // طلب شيت (أولوية)
      pjob.sentAt = Date.now();
      const items = [...new Map(pjob.rows.map(r => [r.num + "|" + r.date, { key: r.num + "|" + r.date, num: r.num, date: r.date }])).values()];
      return send(200, JSON.stringify({ id: pjob.id, items }), "application/json");
    }
    // (2.19.3) طلب بالرقم من أنس: بدون تاريخ → الجهاز يرجّع آخر 10 بانوراما للرقم
    if (preq?.nums?.length && !(preq.sentAt && Date.now() - preq.sentAt < 8 * 60e3)) {
      preq.sentAt = Date.now(); saveReq();
      return send(200, JSON.stringify({ id: preq.id, items: preq.nums.map(n => ({ key: n + "|", num: n, date: "" })) }), "application/json");
    }
    return send(204);                                                                // ما فيه طلب / الجهاز شغّال عليه
  }
  if (u.pathname === "/pano/result" && req.method === "POST") {
    const id = u.searchParams.get("id") || "";
    const isReq = !!preq && preq.id === id;
    if (!isReq && (!pjob || pjob.id !== id)) return send(410, "gone");
    const zip = await JSZip.loadAsync(await readBody(req, 500 * 1024 * 1024));
    const meta = JSON.parse(await zip.file("result.json").async("string"));
    const result = new Map();
    for (const it of Array.isArray(meta) ? meta : [meta]) {
      const arr = [];
      for (const f of [].concat(it.files || [])) { const z = zip.file(f.f); if (z) arr.push({ buf: await z.async("nodebuffer"), at: String(f.at || "") }); }
      result.set(String(it.key), arr);
    }
    send(200, "ok");
    lastRes = { at: Date.now(), n: [...result.values()].reduce((a, v) => a + v.length, 0) };
    C.log.info({ id, keys: result.size, imgs: lastRes.n }, "بانوراما: وصلت الصور من جهاز الأشعة");
    if (isReq) { reqDone(result).catch(async e => { C.log.error({ err: String(e?.stack || e) }, "بانوراما: طلب بالرقم"); await sendBoth({ text: "❌ وصلت صور البانوراما بس ما قدرت أرسلها: " + String(e?.message || e).slice(0, 120) }); }); return; }
    if (waiter?.id === id) waiter.resolve(result);
    else finishLate(result).catch(async e => { C.log.error({ err: String(e?.stack || e) }, "بانوراما: متأخر"); await sendBoth({ text: "❌ وصلت صور البانوراما بس ما قدرت أجهّز الملف: " + String(e?.message || e).slice(0, 120) }); });
    return;
  }
  return send(404, "not found");
}
async function purgeDue() {
  const due = (conf.purge || []).filter(p => p.at <= Date.now()); if (!due.length) return;
  for (const p of due) {
    let n = 0;
    try { const [files] = await bucket().getFiles({ prefix: `ecg/${p.month}/` }); n = files.length; await bucket().deleteFiles({ prefix: `ecg/${p.month}/` }); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "ECG: حذف الصور"); continue; }
    await C.db.doc(`ecg/${p.month}`).delete().catch(() => {}); months.delete(p.month);
    conf.purge = conf.purge.filter(x => x !== p); await saveConf();
    if (n) await sendBoth({ text: `🧹 انحذفت صور ECG لشهر ${p.month} (${n} صورة) — بعد يوم من شيت الشهر.` });
  }
}

/* ---------- استيراد «تصدير الدردشة» ---------- */
async function importExport(buf) {
  const zip = await JSZip.loadAsync(buf);
  const chatF = Object.values(zip.files).find(f => /(^|\/)(_chat|WhatsApp Chat[^/]*)\.txt$/i.test(f.name)) || Object.values(zip.files).find(f => /\.txt$/i.test(f.name));
  if (!chatF) return "❌ ما لقيت ملف المحادثة (_chat.txt) داخل الملف.";
  const raw = (await chatF.async("string")).replace(/[‎‏]/g, "").replace(/[  ]/g, " ");
  const msgs = []; let cur = null;
  for (const l of raw.split(/\r?\n/)) {
    let mm = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AP]M)?\] ([^:]+): (.*)$/i.exec(l), t = 0, who = "", txt = "";
    if (mm) { const [, mo, d, y, h, mi, s, ap] = mm; let H = +h; if (ap) H = H % 12 + (/p/i.test(ap) ? 12 : 0); t = Date.UTC(+y < 100 ? 2000 + +y : +y, +mo - 1, +d, H, +mi, +(s || 0)) - 3 * 3600e3; who = mm[8].trim(); txt = mm[9]; }
    else if ((mm = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2}) ?([AP]M)? - ([^:]+): (.*)$/i.exec(l))) {   // صيغة أندرويد (يوم/شهر)
      const [, d, mo, y, h, mi, ap] = mm; let H = +h; if (ap) H = H % 12 + (/p/i.test(ap) ? 12 : 0); t = Date.UTC(+y < 100 ? 2000 + +y : +y, +mo - 1, +d, H, +mi) - 3 * 3600e3; who = mm[7].trim(); txt = mm[8];
    }
    if (t) { cur = { t, who: who.replace(/^~\s*/, ""), txt }; msgs.push(cur); } else if (cur) cur.txt += "\n" + l;
  }
  const from = Date.UTC(ridh(Date.now()).getUTCFullYear(), ridh(Date.now()).getUTCMonth(), 1) - 3 * 3600e3;   // أول الشهر الحالي
  let added = 0, dup = 0; const noNum = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]; if (m.t < from) continue;
    const a = /<attached: ([^>]+\.(?:jpe?g|png))>|([^\s]+\.(?:jpe?g|png)) \((?:file attached|الملف مرفق)\)/i.exec(m.txt); if (!a) continue;
    const fname = a[1] || a[2], f = Object.values(zip.files).find(z => z.name.endsWith(fname)); if (!f) continue;
    const cap = m.txt.slice(0, a.index);
    let nums = fileNums(cap), how = nums.length ? "caption" : "";
    if (!nums.length) for (let j = i + 1; j < msgs.length && msgs[j].t - m.t <= WIN; j++) { if (/<attached|file attached|الملف مرفق/i.test(msgs[j].txt)) break; const n = fileNums(msgs[j].txt); if (n.length) { nums = n; how = "after"; break; } }
    const it = await addImage({ id: "imp-" + fname.replace(/\W+/g, "_"), at: m.t, by: m.who, who: m.who, buf: await f.async("nodebuffer"), num: nums[0] || "", how, imp: true });
    if (!it) { dup++; continue; }
    added++;
  }
  // ننتظر الذكاء (فواتير/أرقام على الورقة) ثم نكمّل الأرقام الناقصة
  await new Promise(r => setTimeout(r, 25000));
  const mk = monthOf(Date.now()), items = (await loadMonth(mk)).items;
  for (const it of items.filter(x => x.imp && !x.num && x.kind !== "invoice" && x.kind !== "other")) { const n = numFor(it, items); if (n) { it.num = n.num; it.how = n.how; } else noNum.push(it); }
  for (const it of noNum) { it.alerted = true; await alertTeam(it).catch(() => {}); }   // الباقي بدون رقم → تنبيه لكم تردون عليه بالرقم
  await saveMonth(mk);
  const imp = items.filter(x => x.imp), inv = imp.filter(x => x.kind === "invoice").length;
  return `✅ استوردت ${added} صورة من ${hm(from).split(" ")[0]} لين آخر التصدير${dup ? ` (${dup} كانت موجودة)` : ""}.\n• برقم ملف: ${imp.filter(x => x.num && x.kind !== "invoice").length}${inv ? `\n• فواتير (ما تدخل في الملف، أخذت منها الرقم): ${inv}` : ""}` +
    (noNum.length ? `\n• بدون رقم (${noNum.length}) — أرسلتها لكم، ردّوا على كل صورة برقمها: ${noNum.map(x => `${x.by} ${hm(x.at)}`).join(" | ")}` : "");
}
export { resolvePending as _resolve, purgeDue as _purge, conf as _conf };
