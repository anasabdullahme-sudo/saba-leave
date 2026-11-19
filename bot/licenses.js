// (2.17.0) تراخيص الممارسين — أنس يرسل ملفات PDF للبوت بالخاص، البوت يقراها ويحفظها،
// وكل ترخيص يدخل آخر شهرين قبل ما ينتهي: رسالة وحدة بس في «قروب الشكاوي».
// تجدد؟ أنس يقول بالخاص «ترخيص فلان تجدد لين …» أو يرسل ملف الترخيص الجديد.
// التخزين على قرص Railway (مو Firebase) — بيانات الترخيص بس، بدون الملفات.
import fs from "node:fs";
import nodePath from "node:path";

const STORE = process.env.STORE_DIR || (fs.existsSync("/data") ? "/data/store" : "./store");
const FILE = nodePath.join(STORE, "licenses.json");
const DAY = 864e5, WARN_DAYS = 60;
let C = null, S = { items: [], seq: 0, docBranch: {} }, saveT = null, pushT = null;
// (2.18.1) فرع الترخيص: من «اسم المنشأة» في الملف أو أنس يقوله — ويتحدّث في موقع الإجازات (public/docBranches)
const BR = [["haramain", "الحرمين", /حرمين|haramain/i], ["tala", "تالا", /تالا|tala\b/i], ["watanak", "وطنك", /وطنك|watanak/i], ["sulaimaniyah", "السليمانية", /سليماني|sulaim/i], ["bawadi", "البوادي", /بوادي|bawadi/i]];
export const branchOf = txt => (BR.find(([, , re]) => re.test(String(txt || ""))) || [""])[0];
const brAr = id => (BR.find(b => b[0] === id) || [, ""])[1];
const SITE = "https://anasabdullahme-sudo.github.io/saba-leave/shared.js";
let site = { at: 0, docs: [] };
async function siteDocs() {
  if (Date.now() - site.at < 3600e3 && site.docs.length) return site.docs;
  try {
    const r = await fetch(SITE + "?t=" + Date.now()); const js = await r.text();
    const i = js.indexOf("export const DOCTORS = ["), j = js.indexOf("\n];", i);
    if (i >= 0 && j > i) { const arr = new Function("return " + js.slice(i + "export const DOCTORS = ".length, j + 2))(); if (Array.isArray(arr)) site = { at: Date.now(), docs: arr }; }
  } catch (e) { C?.log.warn({ err: String(e?.message || e) }, "التراخيص: قراءة أطباء الموقع"); site.at = Date.now() - 3000e3; }
  return site.docs;
}

function load() { try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* أول مرة */ } }
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(S)); fs.renameSync(FILE + ".tmp", FILE); } catch (e) { C?.log.warn({ err: String(e?.message || e) }, "التراخيص: الحفظ"); } }, 800);
}
const todayR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const isoPlus = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = iso => Math.round((Date.parse(iso + "T12:00:00Z") - Date.parse(todayR() + "T12:00:00Z")) / DAY);
const dmyy = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const ISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const lat = s => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const norm = s => String(s || "").toLowerCase().replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ً-ْـ]/g, "").replace(/^(د|دكتور|دكتوره|dr)\.?\s+/, "").replace(/[^؀-ۿa-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// هجري (أم القرى) → ميلادي: نقرّب ونبحث ±60 يوم بتقويم أم القرى اللي في Node
const HF = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
function hijriParts(ms) { const p = Object.fromEntries(HF.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return [+String(p.year).replace(/\D/g, ""), +p.month, +p.day]; }
export function hijriToISO(y, m, d) {
  if (!(y > 1300 && m >= 1 && m <= 12 && d >= 1 && d <= 30)) return "";
  const est = Date.UTC(622, 6, 16) + ((y - 1) * 354.36707 + (m - 1) * 29.530588 + (d - 1)) * DAY;
  for (let k = -60; k <= 60; k++) { const ms = est + k * DAY, [Y, M, D] = hijriParts(ms); if (Y === y && M === m && D === d) return new Date(ms).toISOString().slice(0, 10); }
  return "";
}
// أي شكل تاريخ: 2027-01-15 / 15-01-2027 / 15/1/2027 / 1448-07-20 (هجري)
export function anyDate(v) {
  const t = lat(v).trim(); let m;
  if ((m = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(t))) { const y = +m[1]; return y < 1700 ? hijriToISO(y, +m[2], +m[3]) : mk(y, +m[2], +m[3]); }
  if ((m = /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(t))) { const y = +m[3]; return y < 1700 ? hijriToISO(y, +m[2], +m[1]) : mk(y, +m[2], +m[1]); }
  return "";
}
function mk(y, mo, d) { const x = new Date(Date.UTC(y, mo - 1, d)); return x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : ""; }

export function initLicenses(ctx) {
  C = ctx; load();
  setInterval(() => tick().catch(e => C.log.warn({ err: String(e?.message || e) }, "التراخيص: المؤقت")), 30 * 60e3);
  setTimeout(() => tick().catch(() => {}), 3 * 60e3);
  setTimeout(() => siteDocs().catch(() => {}), 20e3);
  return api;
}

/* ---------- قراءة ملف PDF بالذكاء ---------- */
const SCHEMA = { type: "OBJECT", properties: {
  is_license: { type: "BOOLEAN" }, name_ar: { type: "STRING" }, name_en: { type: "STRING" }, license_number: { type: "STRING" },
  profession: { type: "STRING" }, specialty: { type: "STRING" }, facility: { type: "STRING" }, expiry_gregorian: { type: "STRING" }, expiry_hijri: { type: "STRING" }, issuer: { type: "STRING" } },
  required: ["is_license"] };
const PROMPT = `هذا ملف من موظف في عيادة. هل هو رخصة/تصنيف ممارس صحي (مثل بطاقة أو شهادة «الهيئة السعودية للتخصصات الصحية» SCFHS، أو ترخيص مزاولة مهنة من وزارة الصحة)؟
لو نعم: is_license = true وطلّع: name_ar و name_en (اسم الممارس كما هو)، license_number (رقم التسجيل/الترخيص/التصنيف)، profession (طبيب، أخصائي، استشاري، ممرض، فني…)، specialty (التخصص)،
facility = اسم المنشأة / جهة العمل كما هو مكتوب (مثلاً «مجمع عيادات سابا … فرع الحرمين»)، 
expiry_gregorian = تاريخ انتهاء الترخيص بالميلادي YYYY-MM-DD لو مكتوب، و expiry_hijri = تاريخ الانتهاء بالهجري YYYY-MM-DD لو مكتوب. انتبه: تاريخ الانتهاء مو تاريخ الإصدار.
لو مو ترخيص (فاتورة، إجازة، تقرير…): is_license = false بس. لا تخترع شي مو مكتوب.`;
async function readOne(buf, mime) {
  if (!C.gemini || buf.length > 18e6) return null;
  for (const model of C.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 90e3);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": C.gemini }, signal: ctl.signal,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: buf.toString("base64") } }, { text: PROMPT }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA } }) });
      clearTimeout(tm);
      if (!res.ok) { C.log.warn({ model, status: res.status }, "التراخيص: Gemini"); continue; }
      const j = await res.json(), txt = (j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
      return JSON.parse(txt || "{}");
    } catch (e) { C.log.warn({ model, err: String(e?.message || e) }, "التراخيص: Gemini"); }
  }
  return null;
}
const unwrapDoc = m => { const g = m.message || {}; return g.documentMessage || g.documentWithCaptionMessage?.message?.documentMessage || null; };
export const isPdf = m => /pdf/i.test(unwrapDoc(m)?.mimetype || "") || /\.pdf$/i.test(unwrapDoc(m)?.fileName || "");
// (2.18.2) صور التراخيص بعد (أنس أرسل 14 صورة وما انقرت — كان يقرأ PDF بس)
const imgOf = m => { const g = m.message || {}; const d = unwrapDoc(m); return g.imageMessage || (d && /^image\//i.test(d.mimetype || "") ? d : null); };
export const isCand = m => isPdf(m) || !!imgOf(m);
const mimeOf = m => isPdf(m) ? "application/pdf" : String(imgOf(m)?.mimetype || "image/jpeg").split(";")[0];

function upsert(r, file) {
  const num = lat(r.license_number || "").replace(/[^\dA-Za-z\u0621-\u064A-]/g, ""), nm = norm(r.name_ar || r.name_en);
  const expiry = anyDate(r.expiry_gregorian) || anyDate(r.expiry_hijri);
  if (!nm || !expiry) return { bad: true };
  let it = S.items.find(x => (num && x.number === num) || (nm && (norm(x.name) === nm || (x.nameEn && norm(x.nameEn) === norm(r.name_en)))));
  const isNew = !it;
  if (!it) { it = { code: "L" + (++S.seq), at: Date.now() }; S.items.push(it); }
  const renewed = !isNew && it.expiry && expiry > it.expiry;
  const br = branchOf(r.facility);
  if (br && br !== it.branch) { it.branchWas = it.branch || ""; it.branch = br; it.branchChanged = Date.now(); }
  if (r.facility) it.facility = String(r.facility).slice(0, 120);
  Object.assign(it, { name: String(r.name_ar || r.name_en).slice(0, 80), nameEn: String(r.name_en || "").slice(0, 80), number: num || it.number || "", profession: String(r.profession || "").slice(0, 40), specialty: String(r.specialty || "").slice(0, 60), file: String(file || "").slice(0, 120), updated: Date.now() });
  if (!it.expiry || expiry !== it.expiry) { it.expiry = expiry; if (renewed || isNew) delete it.notified; }
  return { isNew, renewed, it };
}

// ملفات PDF وصلت من أنس (ورا بعض) → نقراها كلها ونرجّع ملخص واحد
async function ingest(msgs, download) {
  const out = { lic: 0, added: 0, renewed: 0, same: 0, soon: 0, unread: [], other: 0, moved: [] };
  await siteDocs().catch(() => {});
  for (const m of msgs) {
    const d = unwrapDoc(m), name = d?.fileName || (imgOf(m) ? "صورة" : "ملف.pdf");
    let buf = null; try { buf = await download(m); } catch { out.unread.push(name); continue; }
    const r = await readOne(buf, mimeOf(m));
    if (!r) { out.unread.push(name); continue; }
    if (!r.is_license) { out.other++; out.otherNames = [...(out.otherNames || []), name]; continue; }
    out.lic++;
    const u = upsert(r, name);
    if (u.bad) { out.unread.push(name + " (ما لقيت الاسم أو تاريخ الانتهاء)"); continue; }
    if (u.isNew) out.added++; else if (u.renewed) out.renewed++; else out.same++;
    if (u.it.branchChanged && Date.now() - u.it.branchChanged < 60e3) out.moved.push(`د. ${shortName(u.it)}: ${u.it.branchWas ? brAr(u.it.branchWas) + " ← " : ""}${brAr(u.it.branch)}`);
    if (daysTo(u.it.expiry) <= WARN_DAYS) out.soon++;
  }
  save(); if (out.moved.length) pushBranches();
  if (out.lic) setTimeout(() => tick().catch(() => {}), 20e3);               // اللي داخلة آخر شهرين تنرسل للقروب على طول
  return out;
}
function summary(o) {
  if (!o.lic && !o.unread.length) return "";
  const parts = [`📋 قريت ${o.lic} ترخيص: ${[o.added ? `${o.added} جديد` : "", o.renewed ? `${o.renewed} تجدد` : "", o.same ? `${o.same} نفس المحفوظ` : ""].filter(Boolean).join("، ") || "—"}.`];
  if (o.moved.length) parts.push(`🏥 فرع الترخيص (انحدّث في موقع الإجازات):\n${o.moved.slice(0, 40).map(x => "• " + x).join("\n")}`);
  if (o.soon) parts.push(`⚠️ ${o.soon} منها تنتهي خلال شهرين — بنبّه عنها في قروب الشكاوي (مرة وحدة لكل ترخيص).`);
  { const mt = missingText(); if (mt) parts.push(mt); }
  if (o.unread.length) parts.push(`❓ ما قدرت أقرأ:\n${o.unread.slice(0, 10).map(x => "• " + x).join("\n")}${o.unread.length > 10 ? `\n… و${o.unread.length - 10} غيرها` : ""}`);
  return parts.join("\n");
}

/* ---------- (2.17.2) السطر المختصر: اسم الطبيب (الأول + العائلة) — تاريخ الانتهاء (العد التنازلي) ---------- */
export function shortName(x) {
  let ws = String(x.name || x.nameEn || "").replace(/[-–_]/g, " ").split(/\s+/).filter(w => w && !/^(بن|بنت|ابن|bin|binti)$/i.test(w));
  if (!ws.length) return "—";
  const first = /^(عبد|ابو|أبو)$/.test(ws[0]) && ws[1] ? ws[0] + " " + ws[1] : ws[0];
  const usedFirst = first.split(" ").length;
  let last = ws.length > usedFirst ? ws[ws.length - 1] : "";
  if (last && ws.length - 1 > usedFirst && /^(عبد|ابو|أبو|ال)$/.test(ws[ws.length - 2])) last = ws[ws.length - 2] + " " + last;
  const nm = [first, last].filter(Boolean).join(" ");
  return /[a-z]/i.test(nm) && !/[\u0600-\u06FF]/.test(nm) ? nm.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : nm;
}
const nt = s => norm(s).split(" ").filter(w => w.length > 1);
function sameName(a, b) { const A = nt(a), B = nt(b); return A.length >= 2 && B.length >= 2 && A[0] === B[0] && (A.includes(B[B.length - 1]) || B.includes(A[A.length - 1])); }
function siteBranchOf(names) { const d = site.docs.find(x => [x.ar, x.en, x.seha, ...(x.alt || [])].some(n => names.some(m => n && m && sameName(n, m)))); return d?.branch || ""; }
function taughtBranch(names) { const e = Object.values(S.docBranch || {}).find(v => v.names.some(n => names.some(m => sameName(n, m) || norm(n) === norm(m)))); return e?.branch || ""; }
const branchFor = x => x.branch || taughtBranch([x.name, x.nameEn].filter(Boolean)) || siteBranchOf([x.name, x.nameEn].filter(Boolean));
const brTxt = x => brAr(branchFor(x)) || "الفرع؟";
function pushBranches() {
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    const items = [...S.items.filter(x => x.branch).map(x => ({ names: [x.name, x.nameEn].filter(Boolean), ar: shortName(x), en: x.nameEn || "", branch: x.branch })),
      ...Object.values(S.docBranch || {}).map(v => ({ names: v.names, ar: v.ar, en: "", branch: v.branch }))];
    try { await C.db?.doc("public/docBranches").set({ items, at: Date.now() }); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "التراخيص: تحديث الموقع"); }
  }, 3000);
}
function shortLine(x) {
  const n = daysTo(x.expiry);
  return `${n < 0 ? "❌" : "⚠️"} د. ${shortName(x)} — ${dmyy(x.expiry)} — ${brTxt(x)} (${n < 0 ? `انتهى من ${-n} يوم` : n === 0 ? "ينتهي اليوم" : `باقي ${n} يوم`})`;
}

/* ---------- التنبيه في قروب الشكاوي: مرة وحدة لكل ترخيص ---------- */
async function tick() {
  const h = new Date(Date.now() + 3 * 3600e3).getUTCHours();
  if (h < 9 || h >= 22) return;                                             // ما نرسل بالليل
  const jid = C.groupJid?.(), sock = C.getSock?.();
  if (!jid || !sock?.user) return;
  const due = S.items.filter(x => x.expiry && x.notified !== x.expiry && daysTo(x.expiry) <= WARN_DAYS).sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!due.length) return;
  const text = `📋 تراخيص تنتهي خلال شهرين:\n${due.map(shortLine).join("\n")}`;
  try { await sock.sendMessage(jid, { text }); } catch (e) { C.log.warn({ err: String(e?.message || e) }, "التراخيص: الإرسال للقروب"); return; }
  for (const x of due) x.notified = x.expiry;
  save(); C.log.info({ n: due.length }, "التراخيص: تنبيه في قروب الشكاوي");
}

/* ---------- مع مساعد الخاص (brain.js) ---------- */
function find(code, name) {
  const c = String(code || "").replace(/^#/, "").toUpperCase();
  if (c) { const x = S.items.find(i => i.code === c); if (x) return x; }
  const n = norm(name); if (!n) return null;
  const hits = S.items.filter(i => norm(i.name).includes(n) || n.includes(norm(i.name)) || (i.nameEn && norm(i.nameEn).includes(n)) || norm(i.name).split(" ").some(w => w.length > 2 && n.split(" ").includes(w)));
  return hits.length === 1 ? hits[0] : null;
}
function block() {
  const near = S.items.filter(x => x.expiry && daysTo(x.expiry) <= 120).sort((a, b) => a.expiry.localeCompare(b.expiry));
  return `\n\n## تراخيص الممارسين (${S.items.length} محفوظ) — اللي تنتهي خلال 4 شهور (#الرمز | الاسم | الرقم | ينتهي)\n${near.map(x => `#${x.code} | ${x.name} | ${x.number || "—"} | ${x.expiry}`).join("\n") || "—"}`;
}
const ACT = ["license_renew", "license_list", "license_missing", "license_branch"];
function checkAct(a) {
  if (!ACT.includes(a.type)) return null;
  if (a.type === "license_list" || a.type === "license_missing") return "";
  if (a.type === "license_branch") return !branchOf(a.branch) ? "أي فرع؟ (الحرمين، تالا، وطنك، السليمانية، البوادي)" : String(a.name || a.code || "").trim() ? "" : "مين الطبيب؟";
  const x = find(a.code, a.name); if (!x) return `ما لقيت ترخيص ${a.code ? "#" + String(a.code).replace(/^#/, "") : "«" + (a.name || "—") + "»"} — قل لي الاسم كامل`;
  return ISO(a.end_date) ? "" : "لين متى الترخيص الجديد؟ (تاريخ الانتهاء)";
}
function describeAct(a) {
  if (a.type === "license_list") return "• التراخيص اللي بتنتهي";
  if (a.type === "license_missing") return "• الأطباء اللي ما وصلني ترخيصهم";
  if (a.type === "license_branch") return `• فرع ترخيص ${a.name || a.code}: ${brAr(branchOf(a.branch))} (ويتحدّث في موقع الإجازات)`;
  if (a.type !== "license_renew") return null;
  const x = find(a.code, a.name); return `• ترخيص ${x ? x.name : a.name || "—"} تجدد لين ${dmyy(a.end_date)}`;
}
async function act(a) {
  if (!ACT.includes(a.type)) return null;
  if (a.type === "license_list") {
    const list = S.items.filter(x => x.expiry).sort((p, q) => p.expiry.localeCompare(q.expiry)).filter(x => daysTo(x.expiry) <= 120);
    await C.dm(list.length ? `📋 تراخيص منتهية أو تنتهي خلال 4 شهور:\n${list.map(x => daysTo(x.expiry) <= WARN_DAYS ? shortLine(x) : `✅ د. ${shortName(x)} — ${dmyy(x.expiry)} — ${brTxt(x)} (باقي ${daysTo(x.expiry)} يوم)`).join("\n")}` : `ما فيه ترخيص ينتهي خلال 4 شهور (محفوظ ${S.items.length}).`);
    return { ok: true, skip: true };
  }
  if (a.type === "license_missing") { await siteDocs().catch(() => {}); await C.dm(missingText() || "ما قدرت أقرأ جدول الأطباء."); return { ok: true, skip: true }; }
  if (a.type === "license_branch") {
    const br = branchOf(a.branch), x = find(a.code, a.name);
    if (x) { x.branchWas = x.branch || ""; x.branch = br; x.branchChanged = Date.now(); }
    else {
      const d = (C.doctors?.() || []).find(dd => [dd.name, ...(dd.aliases || [])].some(n => sameName(n, a.name) || norm(n).includes(norm(a.name)) || norm(a.name).includes(norm(n))));
      const names = d ? [d.name, ...(d.aliases || [])] : [String(a.name)];
      S.docBranch ||= {}; S.docBranch[norm(names[0])] = { names, ar: d?.name || String(a.name), branch: br };
    }
    save(); pushBranches(); return { ok: true };
  }
  const x = find(a.code, a.name);
  x.expiry = a.end_date; delete x.notified; x.updated = Date.now(); save();
  return { ok: true };
}
/* ---------- (2.17.2) أطباء الجدول اللي ما وصلني ترخيصهم ---------- */
const tok = s => norm(s).split(" ").map(w => w.replace(/^ال(?=\S{3})/, "").replace(/ي$/, "ى").replace(/ى$/, "ي")).filter(w => w.length > 1 && !/^(اخصائي|اخصائيه|استشاري|استشاريه|طبيب|طبيبه|عام|اسنان|د|dr|بن|بنت|ابن)$/.test(w));
function lev1(a, b) { if (a === b) return true; if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; }
// الطبيب في الجدول (اسمه المختصر: «نشوى السقا») ↔ الترخيص (الاسم الكامل): الاسم الأول + العائلة لازم يطابقون
function sameDoc(d, lic) {
  const names = [d.name, ...(d.aliases || [])];
  const L = [...tok(lic.name), ...tok(lic.nameEn || "")];
  return names.some(n => { const T = tok(n); if (T.length < 2) return T.length === 1 && L[0] && lev1(T[0], L[0]); return lev1(T[0], L[0] || "") && T.slice(1).every(w => L.some(x => lev1(w, x))); })
    || names.some(n => { const T = tok(n); return T.length >= 2 && T.every(w => L.some(x => lev1(w, x))); });
}
function missingDocs() {
  const docs = (C.doctors?.() || []).filter(d => d?.name);
  return docs.filter(d => !S.items.some(x => sameDoc(d, x)));
}
function missingText() {
  const all = C.doctors?.() || [], miss = missingDocs();
  if (!all.length) return "";
  if (!miss.length) return `✅ كل أطباء البوادي (${all.length}) وصلني ترخيصهم.`;
  const groups = new Map([...BR.map(b => [b[0], []]), ["", []]]);
  for (const d of miss) { const names = [d.name, ...(d.aliases || [])]; groups.get(taughtBranch(names) || siteBranchOf(names) || "").push(d.name); }
  const parts = [...groups].filter(([, v]) => v.length).map(([k, v]) => `*${k ? brAr(k) : "الفرع مو معروف"}* (${v.length}):\n${v.map(n => "• د. " + n).join("\n")}`);
  return `🩺 أطباء البوادي اللي ما وصلني ترخيصهم (${miss.length} من ${all.length}):\n\n${parts.join("\n\n")}${groups.get("").length ? "\n\nاللي فرعه مو معروف: قل لي «فلان ترخيصه بالحرمين» وأحدّثه في الموقع." : ""}`;
}

// (2.17.1) «تراخيص» في قروب الشكاوي → القائمة كاملة، من الأقرب انتهاءً
function groupText() {
  const list = S.items.filter(x => x.expiry).sort((p, q) => p.expiry.localeCompare(q.expiry));
  if (!list.length) return "📋 ما فيه تراخيص محفوظة عندي للحين.";
  const row = x => { const n = daysTo(x.expiry); return n <= WARN_DAYS ? shortLine(x) : `✅ د. ${shortName(x)} — ${dmyy(x.expiry)} — ${brTxt(x)} (باقي ${n} يوم)`; };
  return `📋 تراخيص الممارسين (${list.length}):\n${list.map(row).join("\n")}`;
}
export function licGroupNote() { return S.items.length; }
const api = { ingest, summary, isPdf, isCand, groupText, missingText, branchOf, ext: { block, checkAct, describeAct, act }, count: () => S.items.length, _t: { upsert, tick, S: () => S, sameDoc, missingDocs } };
