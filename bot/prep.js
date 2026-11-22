// (2.20.0) «دفتر التحضير»: تغييرات الأطباء الجاية اللي تنقال في قروب الشكاوي — تنحفظ هنا وما تنطبق.
//  • لما نفس التغيير ينكتب في قروب الإنفورميشن وينطبق → يتعلّم «انطبق» لحاله (ويكمّل الناقص من هنا)
//  • «وش المتغيرات؟» في الخاص → القائمة، و«طبّق #N3» / «طبّقها» → مساعد الخاص يطبّقها
//  • يوم التغيير 8 الصبح: لو ما انطبق → سؤال لأنس «أطبّقه؟»
// التخزين على قرص Railway.
import fs from "node:fs";
import nodePath from "node:path";

const STORE = process.env.STORE_DIR || (fs.existsSync("/data") ? "/data/store" : "./store");
const FILE = nodePath.join(STORE, "prep.json");
let S = { items: [], seq: 0 }, saveT = null, C = null;
try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* أول مرة */ }
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(S)); fs.renameSync(FILE + ".tmp", FILE); } catch { /* */ } }, 400);
}
const nrm = s => String(s || "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ً-ْـ]/g, "").replace(/^(د|دكتور|دكتوره|dr)\.?\s*/i, "").trim().toLowerCase();
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const dayTxt = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${WD[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
const riyadh = () => { const d = new Date(Date.now() + 3 * 3600e3); return { iso: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes() }; };

export function initPrep(ctx) {
  C = ctx;                                                     // { docs, dm, log }
  setInterval(() => tick().catch(e => C.log?.warn({ err: String(e?.message || e) }, "التحضير")), 60e3);
  return { ext: { block, checkAct, describeAct, act } };
}
// الطبيب من الاسم (أول اسم + أي كلمة ثانية)
function docFor(name) {
  const n = nrm(name).split(/\s+/).filter(w => w.length > 1); if (!n.length) return null;
  const docs = C?.docs?.() || [];
  const sc = d => { const t = nrm(d.name).split(/[\s–-]+/).filter(Boolean); const al = (d.aliases || []).map(nrm); return (t[0] === n[0] || al.some(a => a.startsWith(n[0])) ? 2 : 0) + n.slice(1).filter(w => t.includes(w)).length; };
  const best = docs.map(d => [d, sc(d)]).filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1]);
  return best.length && (best.length === 1 || best[0][1] > best[1][1]) ? best[0][0] : null;
}
// من قروب الشكاوي: [{ doctor, date, text, by, quote }]
export function addPrep(list) {
  const out = [];
  for (const x of list) {
    const text = String(x.text || "").trim(); if (!text) continue;
    const d = docFor(x.doctor || text), date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : "";
    const dup = S.items.find(i => i.status === "prep" && i.did && d && i.did === d.id && i.date === date);
    if (dup) { dup.text = text.slice(0, 300); dup.at = Date.now(); dup.quote = String(x.quote || dup.quote || "").slice(0, 400); dup.reminded = false; out.push(dup); continue; }
    const it = { code: "N" + (++S.seq), at: Date.now(), did: d?.id || "", doctor: d ? d.name : String(x.doctor || "").slice(0, 60), date, text: text.slice(0, 300), by: String(x.by || "").slice(0, 60), quote: String(x.quote || "").slice(0, 400), status: "prep" };
    S.items.push(it); out.push(it);
  }
  S.items = S.items.filter(i => i.status === "prep" ? Date.now() - i.at < 45 * 864e5 : Date.now() - i.at < 7 * 864e5);
  save(); return out;
}
// قروب الإنفورميشن طبّق شي لهالأطباء → المحضّر لهم (اليوم أو قبل أو بدون تاريخ، أو تاريخه نفس اللي انطبق) يتعلّم «انطبق»
export function prepApplied(ids, date) {
  const t = riyadh().iso; let n = 0;
  for (const i of S.items) if (i.status === "prep" && i.did && ids.includes(i.did) && (!i.date || i.date <= t || i.date === date)) { i.status = "applied"; i.appliedAt = Date.now(); i.how = "انكتب في قروب الإنفورميشن"; n++; }
  if (n) save(); return n;
}
const open = () => S.items.filter(i => i.status === "prep");
const line = i => `#${i.code} ${i.doctor ? "د. " + String(i.doctor).split(" –")[0] : "—"}: ${i.text}${i.date ? ` (${dayTxt(i.date)} ${i.date})` : ""}${i.by ? ` — قاله ${i.by}` : ""}`;
// لقروب الإنفورميشن (group.js): يكمّل الناقص («د فلان باشر» بدون وقت)
export function prepFor(ids) { return open().filter(i => ids.includes(i.did)).map(line).join("\n"); }
export function prepList() { return open().map(line).join("\n"); }

async function tick() {
  const t = riyadh(); if (t.m < 8 * 60 || t.m > 22 * 60) return;
  const due = open().filter(i => i.date && i.date <= t.iso && !i.reminded);
  if (!due.length || !C?.dm) return;
  for (const i of due) i.reminded = Date.now(); save();
  await C.dm(`📋 تغييرات محضّرة من قروب الشكاوي ليوم ${dayTxt(t.iso)} — ما انكتبت في قروب الإنفورميشن:\n${due.map(line).join("\n")}\n\nأطبّقها؟ رد «طبّق #${due[0].code}»${due.length > 1 ? " أو «طبّقها كلها»" : ""}، أو «لا» وتظل محفوظة.`);
}

/* ---------- لمساعد الخاص (brain.js) ---------- */
function block() {
  return `\n\n## تغييرات محضّرة (انقالت في قروب الشكاوي — ما انطبقت)
${prepList() || "—"}
- «وش المتغيرات؟» / «وش عندك من تغييرات» → اذكر المحضّرة هذي (بالرمز والتاريخ) ومعها التغييرات المسجّلة في الجدول. لا تطبّق شي.
- «طبّق #N3» / «طبّقها» / «طبّق اللي لفلان» → الأفعال المناسبة (status/schedule/vacation/end_vacation/add_doctor…) من نص التغيير وتاريخه، ومعها prep_done: code لكل وحدة طبّقتها.
- «شيل #N3» / «انلغت» → prep_drop: code.`;
}
const ACT = ["prep_done", "prep_drop"];
const find = c => S.items.find(i => i.code === String(c || "").replace(/^#/, "").toUpperCase().trim());
function checkAct(a) { if (!ACT.includes(a.type)) return null; return find(a.code) ? "" : `ما لقيت ${a.code} في المحضّرة`; }
function describeAct(a) { if (!ACT.includes(a.type)) return null; const i = find(a.code); return `• ${a.type === "prep_done" ? "انطبق" : "انشال"} من المحضّرة: ${i ? line(i) : a.code}`; }
async function act(a) {
  if (!ACT.includes(a.type)) return null;
  const i = find(a.code); if (!i) return { ok: false, why: "ما لقيته" };
  i.status = a.type === "prep_done" ? "applied" : "dropped"; i.appliedAt = Date.now(); i.how = a.type === "prep_done" ? "أنس طبّقه" : "أنس شاله"; save();
  return { ok: true };
}
export const _t = { S: () => S, addPrep, prepApplied, tick, docFor };
