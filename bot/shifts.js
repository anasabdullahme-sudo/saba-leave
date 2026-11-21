// (2.19.0) الدوام المؤقت + الرجوع من الإجازة + جدول الجمعة
//  • دوام مؤقت (لين تاريخ / لين يرجع د. فلان): أول ما تخلص المدة يرجع الطبيب لدوامه الثابت لحاله، ونبلّغ أنس.
//  • قبل الإجازة بيوم: نحفظ دوام أطباء نفس القسم (عشان «رجّع الكل مثل قبل الإجازة»).
//  • الساعة 8 مساءً قبل رجوع الطبيب بيوم: نسأل أنس — شفته الطبيعي ولا شفت ثاني، وزملاؤه بنفس القسم نفس شفتهم ولا فيه تغييرات.
//    ما رد لين 11:30 الليل → يرجع بشفته الطبيعي ونبلّغه.
//  • كل خميس 4 العصر: جدول الجمعة (الطبيب العام + الأطفال من الجدول، والمختبر والأشعة دوامهم ثابت) جاهز للنسخ.
// التخزين على قرص Railway (مو Firebase).
import fs from "node:fs";
import nodePath from "node:path";

const STORE = process.env.STORE_DIR || (fs.existsSync("/data") ? "/data/store" : "./store");
const FILE = nodePath.join(STORE, "shifts.json");
const LAB0 = "من ١ ظهرا - ٤ صباحا", RAD0 = "من ١ ظهرا - ٩ مساء";
const FRI_AT = 16 * 60, RET_AT = 20 * 60, DEF_AT = 23 * 60 + 30;
let C = null, S = { snap: {}, ret: {}, fri: {}, lab: "", rad: "", labOnce: {}, radOnce: {}, seq: 0 }, saveT = null;
const tried = new Set();

function load() { try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* أول مرة */ } }
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(S)); fs.renameSync(FILE + ".tmp", FILE); } catch (e) { C?.log.warn({ err: String(e?.message || e) }, "المؤقت: الحفظ"); } }, 500);
}
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const wdOf = iso => new Date(iso + "T12:00:00Z").getUTCDay();
const dm = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "";
const dayTxt = iso => `${WD[wdOf(iso)]} ${dm(iso)}`;
const AR = s => String(s).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const J = x => JSON.stringify((x || []).map(y => [y.s, y.e]));
const shT = sh => (sh || []).map(x => `${C.hm(x.s)} – ${C.hm(x.e)}`).join(" و ") || "—";
const sn = d => C.shortName(d?.name || "");
const nn = s => String(s || "").replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).toLowerCase().trim();
const vacsOf = d => (C.getBoard()?.vacations || []).filter(v => v.doctorId === d.id || (d.code && String(v.code) === String(d.code)));
const onVac = (d, iso) => vacsOf(d).some(v => v.start <= iso && (!v.end || v.end >= iso));
const baseOf = d => d.tmp?.base || { shifts: d.shifts || [], workdays: d.workdays || [], ...(d.alt ? { alt: d.alt } : {}) };

export function initShifts(ctx) {
  C = ctx; load();
  setInterval(() => tick().catch(e => C.log.warn({ err: String(e?.message || e) }, "المؤقت")), 60e3);
  return api;
}

/* ---------- المؤقت خلص؟ ---------- */
function tmpDue(d, today) {
  const tp = d.tmp; if (!tp) return false;
  if (tp.from && today < tp.from) return false;
  if (tp.until) return today > tp.until;
  if (tp.back) {
    const x = C.docs().find(y => y.id === tp.back); if (!x) return true;          // الطبيب انشال
    const vs = vacsOf(x).filter(v => !v.end || v.end >= (tp.from || today));
    if (!vs.length) return true;                                                  // إجازته خلصت/انشالت
    if (vs.some(v => !v.end)) return false;                                       // مفتوحة → ننتظر
    return today > vs.map(v => v.end).sort().pop();
  }
  return false;
}
async function revert(d) {
  let done = null;
  await C.db.runTransaction(async tx => {
    const ref = C.db.doc("board/bawadi"), prev = C.db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    const t = next.departments.flatMap(p => p.doctors || []).find(x => x.id === d.id); if (!t?.tmp) return;
    const b = t.tmp.base || {}; done = { name: sn(t), from: t.shifts, to: b.shifts || [], why: t.tmp.until ? `خلص المؤقت (${dm(t.tmp.until)})` : `رجع د. ${sn(C.docs().find(y => y.id === t.tmp.back)) || "—"} من إجازته` };
    t.shifts = b.shifts || []; if ((b.workdays || []).length) t.workdays = b.workdays;
    if (b.alt) t.alt = b.alt; else delete t.alt;
    delete t.tmp;
    next.log = [{ at: Date.now(), by: "البوت", what: `د. ${done.name} رجع لدوامه الثابت (${done.why})` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "نهاية دوام مؤقت" }); tx.set(ref, next);
  });
  if (done) await C.dmAdmin(`↩️ د. ${done.name} رجع لدوامه الثابت: ${shT(done.to)}\n(كان مؤقت ${shT(done.from)} — ${done.why})\nلو تبغاه يكمل قل لي.`);
}

/* ---------- كل دقيقة ---------- */
async function tick() {
  if (!C.ready()) return;
  const t = C.nowR(), today = t.iso, tm = C.isoPlus(today, 1), docs = C.docs(), b = C.getBoard() || {};
  // 1) المؤقت اللي خلص
  for (const d of docs) if (d.tmp && tmpDue(d, today) && !tried.has(d.id + today)) { tried.add(d.id + today); await revert(d).catch(e => C.log.warn({ err: String(e?.message || e) }, "المؤقت: الرجوع")); }
  // 2) دوام القسم قبل الإجازة
  let ch = false;
  for (const v of b.vacations || []) {
    if (!v.doctorId || S.snap[v.id] || v.start > C.isoPlus(today, 1) || (v.end && v.end < today)) continue;
    const d = docs.find(x => x.id === v.doctorId); if (!d) continue;
    const mates = docs.filter(x => x.dep === d.dep);
    S.snap[v.id] = { at: Date.now(), start: v.start, doc: d.id, dep: d.dep, late: v.start < today, docs: Object.fromEntries(mates.map(x => [x.id, baseOf(x)])) }; ch = true;
  }
  for (const [k, x] of Object.entries(S.snap)) if (Date.now() - x.at > 120 * 864e5 || !(b.vacations || []).some(v => v.id === k) && Date.now() - x.at > 3 * 864e5) { delete S.snap[k]; ch = true; }
  for (const [k, x] of Object.entries(S.ret)) if (Date.now() - x.at > 30 * 864e5) { delete S.ret[k]; ch = true; }
  if (ch) save();
  // 3) سؤال الرجوع (8 مساءً قبلها بيوم)
  if (t.m >= RET_AT) for (const v of b.vacations || []) {
    if (!v.doctorId || v.end !== today || S.ret[v.id]) continue;
    const d = docs.find(x => x.id === v.doctorId); if (!d || onVac(d, tm)) continue;   // إجازة ثانية تبدأ بكرة
    await askReturn(v, d, tm).catch(e => C.log.warn({ err: String(e?.message || e) }, "سؤال الرجوع"));
  }
  // 4) ما رد → يرجع بشفته الطبيعي
  if (t.m >= DEF_AT) for (const [vid, r] of Object.entries(S.ret)) {
    if (r.day !== today || r.answered || r.def) continue;
    r.def = true; save();
    const d = docs.find(x => x.id === r.doc); if (!d) continue;
    const res = await restorePlans([r.doc], r, tm);
    await C.dmAdmin(`🔙 ما رديت على #${r.code} — د. ${sn(d)} يرجع بكرة بشفته الطبيعي: ${shT(r.normal)}${res.lines.length ? "\n" + res.lines.join("\n") : ""}`);
  }
  // 5) جدول الجمعة (كل خميس 4 العصر)
  if (t.wd === 4 && t.m >= FRI_AT && !S.fri[tm]) { S.fri[tm] = { at: Date.now() }; save(); await sendFriday(tm).catch(e => C.log.warn({ err: String(e?.message || e) }, "جدول الجمعة")); }
}

/* ---------- سؤال الرجوع ---------- */
function mateRows(r, d, tm) {
  return C.docs().filter(x => x.dep === d.dep && x.id !== d.id && !onVac(x, tm)).map(x => {
    const ends = x.tmp && (x.tmp.back === d.id || (x.tmp.until && x.tmp.until < tm));
    const now = ends ? (x.tmp.base?.shifts || []) : (x.shifts || []);
    const before = r?.snap?.[x.id]?.shifts;
    return { x, now, ends, before, diff: before && J(before) !== J(now) };
  });
}
async function askReturn(v, d, tm) {
  const snap = S.snap[v.id]?.docs || null;
  const normal = (snap?.[d.id] || baseOf(d)).shifts || [];
  const code = "B" + (++S.seq);
  const r = { code, at: Date.now(), day: v.end, ret: tm, doc: d.id, vac: v.id, normal, snap };
  const rows = mateRows(r, d, tm), diffs = rows.filter(m => m.diff);
  const L = [`🔙 د. ${sn(d)} يرجع بكرة ${dayTxt(tm)} من الإجازة  #${code}`,
    `1️⃣ شفته الطبيعي: ${shT(normal)}${J(normal) !== J(d.shifts) ? ` (المسجّل الحين ${shT(d.shifts)})` : ""}`,
    "2️⃣ شفت ثاني — اكتبه لي (مثلاً «من 2 لين 10»)"];
  if (rows.length) {
    L.push("", `ومعه في ${d.dep}:`);
    for (const m of rows) L.push(`• ${sn(m.x)}: ${shT(m.now)}${m.ends ? ` (كان مؤقت ${shT(m.x.shifts)} ← يرجع لدوامه بكرة)` : ""}${m.diff ? ` — قبل الإجازة كان ${shT(m.before)}` : ""}`);
    if (diffs.length) L.push(`3️⃣ رجّع الكل مثل قبل الإجازة (${diffs.map(m => `${sn(m.x)} ${shT(m.before)}`).join("، ")})`);
    L.push("يكونون نفس شفتهم؟ رد «نفس» أو اكتب التغييرات.");
  }
  L.push("", "لو ما رديت لين 11:30 الليل: يرجع بشفته الطبيعي.");
  r.diffs = diffs.map(m => m.x.id);
  S.ret[v.id] = r; save();
  await C.dmAdmin(L.join("\n"));
}
// خطط «دوام ثابت» لبكرة: يرجع الطبيب (أو الكل) لدوامه قبل الإجازة
async function restorePlans(ids, r, day) {
  const lines = [], items = [];
  for (const id of ids) {
    const d = C.docs().find(x => x.id === id); if (!d) continue;
    const want = id === r.doc ? { ...(r.snap?.[id] || baseOf(d)), shifts: r.normal } : r.snap?.[id]; if (!want) continue;
    const cur = d.tmp && (d.tmp.back === r.doc || (d.tmp.until && d.tmp.until < day)) ? d.tmp.base : d;
    if (J(cur.shifts) === J(want.shifts) && JSON.stringify(cur.alt || null) === JSON.stringify(want.alt || null)) continue;
    items.push({ id: C.uid(), date: day, doctorId: id, kind: "set_schedule", sch: { days: want.workdays || [], shifts: want.shifts || [], alt: want.alt || null }, by: "البوت (رجوع من إجازة)" });
    lines.push(`• د. ${sn(d)}: ${shT(want.shifts)} من بكرة`);
  }
  if (items.length) {
    await C.db.doc("board/bawadi_plan").set({ items: C.FieldValue.arrayUnion(...items), at: Date.now() }, { merge: true });
    await new Promise(res => setTimeout(res, 900));
    const saved = (await C.db.doc("board/bawadi_plan").get()).data()?.items || [];
    const ok = items.every(i => saved.some(s => s.id === i.id));
    lines.unshift(ok ? "✅ انحفظ (ينطبق بكرة أول اليوم):" : "❌ ما انحفظ في الخطط — عدّله من صفحة الأطباء:");
  }
  return { lines, n: items.length };
}
function pendingRet(quoted, lastOut) {
  const list = Object.values(S.ret).filter(r => !r.answered && Date.now() - r.at < 20 * 3600e3);
  const qc = /#(B\d+)/.exec(quoted || "")?.[1];
  if (qc) return list.find(r => r.code === qc) || null;
  if (quoted) return null;
  const lc = /#(B\d+)/.exec(lastOut || "")?.[1];
  return lc ? list.find(r => r.code === lc) || null : null;
}
async function pre({ text, quoted, lastOut }) {
  const r = pendingRet(quoted, lastOut); if (!r) return null;
  const d = C.docs().find(x => x.id === r.doc); if (!d) return null;
  const n = nn(text).replace(/[️⃣.!،,]/g, "").trim();
  if (/^(1|نفس|نفسه|نفسهم|تمام|ايوه|ايوا|اي|نعم|اوكي|ok|طبيعي|شفته الطبيعي|زي ما هو|زي ما هم|مثل ما هو|مثل ما هم|صح|نفس الشي|خله|خلهم)( .{0,25})?$/.test(n) && !/(لا|بس|غير|ماعدا|الا)/.test(n.split(" ").slice(1).join(" "))) {
    r.answered = "1"; save();
    const res = await restorePlans([r.doc], r, r.ret);
    return { msg: `تمام — د. ${sn(d)} يرجع بكرة بشفته الطبيعي ${shT(r.normal)}، والباقي زي ما هم.${res.lines.length ? "\n" + res.lines.join("\n") : ""}` };
  }
  if (/^(3|رجع الكل|رجعهم|رجعهم كلهم|رجع الكل مثل قبل|مثل قبل الاجازه|زي قبل الاجازه|رجعهم مثل قبل)/.test(n) && (r.diffs || []).length) {
    r.answered = "3"; save();
    const res = await restorePlans([r.doc, ...r.diffs], r, r.ret);
    return { msg: res.n ? `تمام — بكرة الكل يرجع مثل قبل الإجازة:\n${res.lines.join("\n")}` : "الكل أصلاً على دوامه قبل الإجازة — ما تغيّر شي." };
  }
  if (/^(2|شفت ثاني|ثاني)$/.test(n)) { r.wait = true; save(); return { msg: `تمام، اكتب شفت د. ${sn(d)} من بكرة (من كم لكم، ولو مؤقت قل لين متى).` }; }
  return null;
}
// بعد أفعال الخاص: سؤال رجوع انجاوب بالكلام (أفعال على الطبيب أو زملاؤه) → نقفله. وجدول الجمعة يرجع معدّل
async function after(actions, results) {
  for (const r of Object.values(S.ret)) {
    if (r.answered || Date.now() - r.at > 20 * 3600e3) continue;
    const d = C.docs().find(x => x.id === r.doc); if (!d) continue;
    const ids = new Set([r.doc, ...C.docs().filter(x => x.dep === d.dep).map(x => x.id)]);
    if (actions.some(a => ids.has(a.doctor_id) && ["status", "schedule", "cancel_plan"].includes(a.type))) { r.answered = "text"; save(); }
  }
  const t = C.nowR(), fri = C.isoPlus(t.iso, (5 - t.wd + 7) % 7);
  if (S.fri[fri] && (t.wd === 4 || t.wd === 5) && actions.some(a => a.type === "friday_unit" || (a.type === "status" && a.date === fri) || (a.type === "cancel_plan" && a.date === fri))) await sendFriday(fri, true);
}

/* ---------- جدول الجمعة ---------- */
const DEP_ORDER = [[/طبيب العام|الطب العام/, "الطبيب العام"], [/اطفال/, "عيادة الأطفال"]];
async function fridayText(fri) {
  const plans = ((await C.db.doc("board/bawadi_plan").get()).data()?.items || []).filter(i => i.date === fri && i.kind === "starts_at");
  const docs = C.docs(), groups = new Map();
  const add = (d, s, e) => { const k = d.dep; if (!groups.has(k)) groups.set(k, []); if (!groups.get(k).some(y => y.d.id === d.id)) groups.get(k).push({ d, s, e }); };
  const mn = v => { const x = /^(\d{1,2}):(\d{2})/.exec(v || ""); return x ? +x[1] * 60 + +x[2] : null; };
  for (const p of plans) { const d = docs.find(x => x.id === p.doctorId); if (!d || onVac(d, fri)) continue; const s = p.at_min ?? mn(p.at_time), e = p.until_min != null ? p.until_min % 1440 : mn(p.until_time); if (s != null) add(d, s, e); }
  for (const d of docs) if ((d.workdays || []).includes(5) && !onVac(d, fri)) for (const x of (d.alt?.days?.includes(5) ? d.alt.shifts : d.shifts) || []) add(d, x.s, x.e);
  const line = x => `د. ${sn(x.d)} من ${AR(C.hm(x.s))}${x.e != null ? " - " + AR(C.hm(x.e)) : ""}`;
  const out = ["سابا 1", "دوام يوم الجمعة", ""], missing = [];
  const keys = [...groups.keys()];
  for (const [re, title] of DEP_ORDER) {
    const k = keys.find(k => re.test(nn(k)));
    out.push(`${title} :`);
    if (k) { out.push(...groups.get(k).sort((a, b) => a.s - b.s).map(line)); groups.delete(k); } else { out.push("د. ؟"); missing.push(title); }
    out.push("");
  }
  for (const [k, L] of groups) out.push(`${k} :`, ...L.sort((a, b) => a.s - b.s).map(line), "");
  out.push("المختبر :", S.labOnce[fri] || S.lab || LAB0, "", "الاشعة :", S.radOnce[fri] || S.rad || RAD0);
  return { text: out.join("\n"), missing };
}
async function sendFriday(fri, again = false) {
  const { text, missing } = await fridayText(fri);
  S.fri[fri] = { ...(S.fri[fri] || {}), at: Date.now(), sent: (S.fri[fri]?.sent || 0) + 1 }; save();
  await C.dmAdmin(`📋 جدول الجمعة ${dm(fri)}${again ? " بعد التعديل" : ""} — الرسالة اللي تحت جاهزة تحوّلها  #F${fri.slice(8, 10)}${missing.length ? `\n⚠️ ناقص: ${missing.join(" و")} — اكتب لي مين الطبيب وشفته (مثلاً «الأطفال د. عبدالصمد من ٦م - ١٠م»)` : ""}\nلو فيه تعديل اكتبه لي (طبيب، أو «المختبر من ٢ ظهرا - ١٢ص») وأرجّعها لك معدّلة.`);
  await C.dmAdmin(text);
}
// وقت المختبر/الأشعة بكلام: «١ ظهرا» «٤ صباحا» «٩ مساء»
const tWord = m => { const h = Math.floor(m / 60) % 24, mi = m % 60, h12 = h % 12 || 12; return `${AR(h12)}${mi ? ":" + AR(String(mi).padStart(2, "0")) : ""} ${h < 12 ? "صباحا" : h < 15 ? "ظهرا" : h < 18 ? "عصرا" : "مساء"}`; };
const toM = v => { const x = /^(\d{1,2})(?::(\d{2}))?/.exec(nn(v)); return x ? (+x[1] % 24) * 60 + +(x[2] || 0) : null; };
const unitOf = a => /مختبر|معمل|lab/.test(nn(a.kind || a.name || "")) ? "lab" : /اشع|rad|x/.test(nn(a.kind || a.name || "")) ? "rad" : "";

/* ---------- للخاص (brain.js) ---------- */
const ACT = ["friday_unit", "friday_draft"];
function block() {
  const t = C.nowR(), fri = C.isoPlus(t.iso, (5 - t.wd + 7) % 7);
  const rs = Object.values(S.ret).filter(r => !r.answered && Date.now() - r.at < 20 * 3600e3).map(r => { const d = C.docs().find(x => x.id === r.doc); return `#${r.code} د. ${sn(d)} (${r.doc}) يرجع ${r.ret} — شفته الطبيعي ${shT(r.normal)}${r.wait ? " — أنس اختار «شفت ثاني» وينتظر يكتبه" : ""}`; });
  const tmps = C.docs().filter(d => d.tmp).map(d => `${sn(d)} (${d.id}): ${shT(d.shifts)} مؤقت ${d.tmp.until ? "لين " + d.tmp.until : "لين يرجع " + sn(C.docs().find(x => x.id === d.tmp.back))} ← بعدها ${shT(d.tmp.base?.shifts)}`);
  return `\n\n## دوامات مؤقتة (ترجع لحالها)\n${tmps.join("\n") || "—"}
\n## أسئلة رجوع من الإجازة تنتظر أنس (#B)
${rs.join("\n") || "—"}
- رد على سؤال رجوع: «نفس/1» = شفته الطبيعي (النظام يطبّقه)، شفت ثاني → status (يوم واحد) أو schedule من يوم رجوعه (start_date = يوم الرجوع) مع المدة لو قالها. تغييرات زملائه نفس الشي.
\n## جدول الجمعة ${fri} (ينرسل لأنس كل خميس 4 العصر)
المختبر: ${S.labOnce[fri] || S.lab || LAB0} | الأشعة: ${S.radOnce[fri] || S.rad || RAD0} (ثابت)
- أنس كتب أطباء الجمعة («الطبيب العام: د. اكرامي من ٩ص - ٩م …»، «الأطفال د. عبدالصمد ٦م - ١٠م») → status kind starts_at date = ${fri} لكل طبيب (الدوام اللي يعدّي نص الليل until_next_day = true). طبيب كان محفوظ للجمعة وأنس شاله/بدّله → cancel_plan date = ${fri}.
- «المختبر/الأشعة الجمعة من … لين …» → friday_unit: kind = lab أو radiology، start_time و end_time، و mode = permanent لو قال ثابت/دائم (غير كذا للجمعة الجاية بس).
- «جهز/أرسل لي جدول الجمعة» → friday_draft (النظام يرسله بالشكل المعتمد). الجدول يرجع لأنس معدّل لحاله بعد أي تعديل على الجمعة.`;
}
function checkAct(a) {
  if (!ACT.includes(a.type)) return null;
  if (a.type === "friday_draft") return "";
  if (!unitOf(a)) return "المختبر ولا الأشعة؟";
  return toM(a.start_time ?? a.from) == null || toM(a.end_time ?? a.until) == null ? "من كم لكم؟" : "";
}
function describeAct(a) {
  if (a.type === "friday_draft") return "• جدول الجمعة";
  if (a.type !== "friday_unit") return null;
  const f = toM(a.start_time ?? a.from), u = toM(a.end_time ?? a.until);
  return `• ${unitOf(a) === "lab" ? "المختبر" : "الأشعة"} ${a.mode === "permanent" ? "كل جمعة" : "الجمعة الجاية"}: من ${f != null ? tWord(f) : "؟"} - ${u != null ? tWord(u) : "؟"}`;
}
async function act(a) {
  if (!ACT.includes(a.type)) return null;
  const t = C.nowR(), fri = C.isoPlus(t.iso, (5 - t.wd + 7) % 7);
  if (a.type === "friday_draft") { await sendFriday(fri); return { ok: true, skip: true }; }
  const u = unitOf(a), txt = `من ${tWord(toM(a.start_time ?? a.from))} - ${tWord(toM(a.end_time ?? a.until))}`;
  if (a.mode === "permanent") { S[u] = txt; delete S[u + "Once"][fri]; } else S[u + "Once"][fri] = txt;
  for (const k of ["labOnce", "radOnce"]) for (const d of Object.keys(S[k])) if (d < t.iso) delete S[k][d];
  save(); return { ok: true, note: txt };
}

const api = { ext: { block, checkAct, describeAct, act, pre, after }, _t: { S: () => S, tmpDue, fridayText, mateRows, pre, restorePlans, tWord, askReturn, tick } };
