// (2.11.0) قروب ECG REPORT SABA1 — البوت يقرا بس (ما يرد في القروب):
//  • كل صورة تخطيط تنحفظ في تخزين Firebase (ecg/<شهر>/<id>.jpg) مع رقم الملف، وقائمتها في مستند واحد للشهر (ecg/<شهر>)
//  • رقم الملف: مع الصورة ← رسالة رقم خلال 5 دقايق بعدها ← فاتورة من نفس الشخص خلال 5 دقايق ← مكتوب على ورقة التخطيط ← تنبيه أنس وماجد
//  • أنس أو ماجد يرسل شيت الإدارة (xlsx) → zip فيه صور E.C.G. (رقم الملف مكتوب عليها واسمها برقمه) + نفس الشيت وعمود Statue معبّى → للاثنين
//  • الحذف: بعد شيت شهر خلص بيوم، تنحذف صور ذاك الشهر. شيت نص الشهر ما يحذف شي
//  • ملف «تصدير الدردشة» (zip) من أنس/ماجد → يستورد صور الشهر الحالي
import { getStorage } from "firebase-admin/storage";
import { downloadMediaMessage } from "baileys";
import { Jimp, loadFont, measureText } from "jimp";
import { SANS_32_BLACK, SANS_64_BLACK, SANS_128_BLACK } from "jimp/fonts";
import JSZip from "jszip";
import ExcelJS from "exceljs";

const BUCKET = "saba-leave.firebasestorage.app";
const WIN = 5 * 60e3;                                   // 5 دقايق
let C = null, conf = { jid: "", purge: [] }, ecgJid = "";
const months = new Map();                               // "2026-11" → { items: [] }
const subjects = new Map(), seen = new Set();
let saveChain = Promise.resolve();

const latin = s => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const ridh = ms => new Date(ms + 3 * 3600e3);           // وقت الرياض (UTC+3 ثابت)
const monthOf = ms => ridh(ms).toISOString().slice(0, 7);
const hm = ms => { const d = ridh(ms); return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const bucket = () => C.bucket || getStorage().bucket(BUCKET);                 // C.bucket: للتجربة بس
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

async function addImage({ id, at, by, who, buf, num, how, imp = false }) {
  const mk = monthOf(at), o = await loadMonth(mk);
  if (o.items.some(x => x.id === id)) return null;
  const path = `ecg/${mk}/${id}.jpg`;
  await bucket().file(path).save(buf, { contentType: "image/jpeg", resumable: false });
  const it = { id, at, by: String(by).slice(0, 40), who: String(who).slice(0, 60), num, how, kind: "", path, ...(imp ? { imp: true } : {}) };
  o.items.push(it); await saveMonth(mk);
  classify(it, buf).then(() => saveMonth(mk)).catch(() => {});   // فاتورة؟ رقم على الورقة؟ (بالخلفية)
  return it;
}

/* ---------- الذكاء: تخطيط ولا فاتورة؟ ورقم الملف ---------- */
async function classify(it, buf) {
  if (!C.gemini) return;
  const prompt = `صورة من قروب واتساب في عيادة يرسلون فيه صور تخطيط القلب (ECG) لمرضى.
حدد نوعها: "ecg" لو فيها ورقة تخطيط قلب (حتى لو فيه فاتورة جنبها)، "invoice" لو فاتورة/إيصال بس بدون تخطيط، "other" غير كذا.
file_no: رقم الملف الطبي للمريض (7 أرقام، مكتوب "Patient ID" أو "رقم الملف الطبي" أو File No) لو مكتوب في الصورة، وإلا "".
date: تاريخ الإصدار/الفحص المكتوب "YYYY-MM-DD HH:MM" لو موجود، وإلا "".`;
  for (const model of C.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": C.gemini },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { kind: { type: "STRING", enum: ["ecg", "invoice", "other"] }, file_no: { type: "STRING" }, date: { type: "STRING" } }, required: ["kind"] } } }) });
      clearTimeout(tm); if (!r.ok) continue;
      const j = await r.json(), o = JSON.parse((j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("") || "{}");
      it.kind = o.kind || "";
      const n = fileNums(o.file_no || "")[0] || "";
      if (n) it.read = n;                                          // الرقم المقروء من الصورة (فاتورة أو ورقة)
      if (o.date) it.rdate = String(o.date).slice(0, 16);
      return;
    } catch {}
  }
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
  const [f] = await bucket().file(it.path).download();
  it.code = short(); it.alertIds = [];
  for (const who of ["anas", "majed"]) {
    const jid = await teamJid(who); if (!jid) continue;
    const s = await C.getSock().sendMessage(jid, { image: f, caption: `🫀 صورة ECG بدون رقم ملف #E${it.code}\nمن ${it.by} — ${hm(it.at)}\nرد (اسحب) على هذي الرسالة برقم الملف، أو «تجاهل» لو مو تخطيط.` }).catch(() => null);
    if (s?.key?.id) it.alertIds.push(s.key.id);
  }
}
async function teamJid(who) {
  const ph = C.team[who]?.phone; if (!ph) return "";
  try { const [w] = await C.getSock().onWhatsApp("966" + ph); return w?.exists ? w.jid : ""; } catch { return ""; }
}
async function sendBoth(content, exclude = "") {
  for (const who of ["anas", "majed"]) { if (who === exclude) continue; const jid = await teamJid(who); if (jid) await C.getSock().sendMessage(jid, content).catch(e => C.log.warn({ err: String(e?.message || e) }, "ECG: إرسال")); }
}

/* ---------- الخاص: أنس / ماجد ---------- */
// يرجع true لو الرسالة لـ ECG (رد على تنبيه، شيت xlsx، تصدير دردشة zip)
export async function onTeamDM(m, who, text = "") {
  const g = unwrap(m), jid = m.key.remoteJid;
  const doc = g.documentMessage;
  const name = String(doc?.fileName || ""), mime = String(doc?.mimetype || "");
  const say = t => C.getSock().sendMessage(jid, { text: t }, { quoted: m }).catch(() => {});
  if (doc && (/\.xlsx?$/i.test(name) || /spreadsheet|excel/i.test(mime))) {
    let buf; try { buf = await (C.download || downloadMediaMessage)({ ...m, message: g }, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch { return false; }
    const sheet = await readSheet(buf).catch(() => null);
    if (!sheet || !sheet.rows.length) return false;                  // مو شيت ECG → يكمل مثل أي ملف
    await say(`⏳ وصل الشيت — ${sheet.rows.length} سطر E.C.G. أجهّز الصور…`);
    try { await processSheet(sheet, name || "sheet.xlsx", who); }
    catch (e) { C.log.error({ err: String(e?.stack || e) }, "ECG: الشيت"); await say("❌ ما قدرت أجهّز الصور: " + String(e?.message || e).slice(0, 120)); }
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
async function readSheet(buf) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
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
  const rows = [];
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), desc = String(row.getCell(dc).text || "");
    if (!ECG_RE.test(desc)) continue;
    const num = fileNums(String(row.getCell(fc).text || row.getCell(fc).value || ""))[0];
    if (!num) continue;
    rows.push({ r, num, at: cellTime(row.getCell(tc)) });
  }
  return { wb, ws, rows, sc };
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
async function stamp(buf, text) {
  const img = await Jimp.read(buf), w = img.bitmap.width;
  const font = await loadFont(w < 700 ? SANS_32_BLACK : w < 1800 ? SANS_64_BLACK : SANS_128_BLACK);
  const sz = w < 700 ? 32 : w < 1800 ? 64 : 128, pad = Math.round(sz / 4), tw = measureText(font, text);
  img.composite(new Jimp({ width: tw + pad * 2, height: Math.round(sz * 1.15) + pad, color: 0xffffffff }), 0, 0);
  img.print({ font, x: pad, y: Math.round(pad / 2), text });
  return img.getBuffer("image/jpeg", { quality: 90 });
}
async function processSheet({ wb, ws, rows, sc }, fileName, who) {
  const now = Date.now(), first = Math.min(...rows.map(r => r.at || now));
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
  const seq = {}, zip = new JSZip(), miss = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri], x = got.get(ri), cell = ws.getRow(r.r).getCell(sc);
    if (!x) { cell.value = "لا توجد صورة"; miss.push(r.num); continue; }
    try {
      const [buf] = await bucket().file(x.path).download();
      seq[r.num] = (seq[r.num] || 0) + 1;
      zip.file(`${r.num}${per[r.num] > 1 ? "_" + seq[r.num] : ""}.jpg`, await stamp(buf, r.num));
      cell.value = "تم";
    } catch (e) { cell.value = "لا توجد صورة"; miss.push(r.num); C.log.warn({ err: String(e?.message || e), path: x.path }, "ECG: صورة"); }
    ws.getRow(r.r).commit?.();
  }
  zip.file(fileName.replace(/[\\/:*?"<>|]/g, "_"), Buffer.from(await wb.xlsx.writeBuffer()));
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 3 } });
  const found = rows.length - miss.length;
  const cap = `🫀 ECG — ${fileName}\n✅ ${found} من ${rows.length} لقيت صورهم${miss.length ? `\n❌ بدون صورة (${miss.length}): ${miss.join("، ")}` : ""}\nطلبه: ${C.team[who]?.name || who}`;
  await sendBoth({ document: out, mimetype: "application/zip", fileName: fileName.replace(/\.xlsx?$/i, "") + " - ECG.zip", caption: cap });
  // الحذف: شيت شهر خلص → بعد يوم تنحذف صور ذاك الشهر
  const last = Math.max(...rows.map(r => r.at || 0)), sm = last ? monthOf(last) : "";
  if (sm && sm < monthOf(now) && !conf.purge.some(p => p.month === sm)) { conf.purge.push({ month: sm, at: now + 864e5, by: who }); await saveConf(); }
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
