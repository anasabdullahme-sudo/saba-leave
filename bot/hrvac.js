// (2.12.0) صورة طلب إجازة من نظام الموارد البشرية (معتمدة) من أنس أو ماجد → الإجازة في صفحة الأطباء
//  • الذكاء يقرا: الكود، الاسم، من/إلى، النوع — ويطابق الطبيب بالاسم مع جدول البوادي (كود الموارد غير كود الجدول أحياناً)
//  • إجازة متداخلة لنفس الطبيب → تتحدّث بالتواريخ الجديدة · موظف مو طبيب → «مو في جدول الأطباء»
//  • «✅ انحفظ» بس بعد ما نقرا الجدول من القاعدة
import { downloadMediaMessage } from "baileys";

let C = null;
export function initHrVac(ctx) { C = ctx; }
const uid = () => Math.random().toString(36).slice(2, 9);
const shortName = n => String(n || "").split(/\s+[–-]\s+/)[0].trim();
const dm = iso => iso ? `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}` : "";
const ISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const TYPE = t => { const s = String(t || "").toLowerCase();
  if (/annual|سنوي/.test(s)) return "إجازة سنوية";
  if (/unpaid|without pay|بدون راتب/.test(s)) return /permission|بإذن|absence/.test(s) ? "إجازة بإذن (بدون راتب)" : "إجازة بدون راتب";
  if (/sick|مرض/.test(s)) return "إجازة مرضية";
  if (/emergenc|اضطرار/.test(s)) return "إجازة اضطرارية";
  if (/matern|أمومة|وضع/.test(s)) return "إجازة أمومة";
  if (/hajj|حج/.test(s)) return "إجازة حج";
  return "إجازة"; };

async function readCards(buf, docs) {
  const list = docs.map(d => `${d.id} | ${shortName(d.name)} | ${d.sehaName || ""} | ${(d.aliases || []).join("/")}`).join("\n");
  const prompt = `هذي صورة شاشة. هل هي طلب/طلبات إجازة من نظام موارد بشرية (بطاقة فيها COD واسم موظف وتاريخ من - إلى ونوع إجازة مثل Annual Vacation)؟
لو لا: is_leave = false و items فاضية.
لو نعم: لكل بطاقة في الصورة: code (رقم COD)، name (الاسم مثل ما هو)، start و end بصيغة YYYY-MM-DD (التاريخ في الصورة يوم.شهر.سنة)، type (نوع الإجازة مثل ما هو مكتوب)، days (العدد لو مكتوب).
doctor_id: لو الموظف طبيب من جدول أطباء البوادي تحت (طابق بالاسم: الاسم الإنجليزي مع الاسم العربي أو اسم صحة) حط الـ id، وإذا مو منهم أو مو متأكد حط "".
الجدول (id | الاسم | اسم صحة | أسماء ثانية):
${list}`;
  for (const model of C.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": C.gemini },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { is_leave: { type: "BOOLEAN" }, items: { type: "ARRAY", items: { type: "OBJECT", properties: {
            code: { type: "STRING" }, name: { type: "STRING" }, start: { type: "STRING" }, end: { type: "STRING" }, type: { type: "STRING" }, days: { type: "STRING" }, doctor_id: { type: "STRING" } }, required: ["name", "start"] } } }, required: ["is_leave"] } } }) });
      clearTimeout(tm); if (!r.ok) continue;
      const j = await r.json(), o = JSON.parse((j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("") || "{}");
      return o;
    } catch {}
  }
  return null;
}

// يرجع true لو الصورة كانت طلب إجازة (انطبق أو لا)
export async function onTeamImage(m, who) {
  if (!C?.gemini) return false;
  const g = m.message || {}, img = g.imageMessage; if (!img) return false;
  let buf; try { buf = await (C.download || downloadMediaMessage)(m, "buffer", {}, { logger: C.log, reuploadRequest: C.getSock().updateMediaMessage }); } catch { return false; }
  const board = (await C.db.doc("board/bawadi").get()).data(); if (!board) return false;
  const docs = (board.departments || []).flatMap(p => (p.doctors || []).map(d => ({ ...d, dep: p.name })));
  const o = await readCards(buf, docs);
  if (!o?.is_leave || !o.items?.length) return false;
  const jid = m.key.remoteJid, say = t => C.getSock().sendMessage(jid, { text: t }, { quoted: m }).catch(() => {});
  const ok = [], notDoc = [], bad = [];
  for (const it of o.items) {
    const d = docs.find(x => x.id === it.doctor_id);
    if (!ISO(it.start)) { bad.push(`${it.name}: ما قريت التاريخ`); continue; }
    if (!d) { notDoc.push(`${it.name}${it.code ? ` (COD ${it.code})` : ""}`); continue; }
    ok.push({ d, start: it.start, end: ISO(it.end) && it.end >= it.start ? it.end : it.start, type: TYPE(it.type), code: String(it.code || "") });
  }
  const by = C.team[who]?.name || who;
  if (ok.length) await C.db.runTransaction(async tx => {
    const ref = C.db.doc("board/bawadi"), prev = C.db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
    const next = structuredClone(cur);
    for (const v of ok) {
      // نفس الطبيب وإجازة متداخلة → نحدّثها (الموارد البشرية هي المرجع)
      const same = (next.vacations ||= []).find(x => x.doctorId === v.d.id && x.start && (x.end || "9999") >= v.start && x.start <= v.end);
      if (same) { v.was = `${dm(same.start)} → ${dm(same.end)}`; same.start = v.start; same.end = v.end; same.type = v.type; same.src = "hr"; }
      else next.vacations.push({ id: uid(), doctorId: v.d.id, code: v.d.code || v.code, name: v.d.name, start: v.start, end: v.end, type: v.type, src: "hr" });
    }
    next.log = [{ at: Date.now(), by: `البوت (${by} — صورة الموارد البشرية)`, what: `إجازة ${ok.map(v => "د. " + shortName(v.d.name)).join("، ")}` }, ...(cur.log || [])].slice(0, 60);
    next.updatedAt = Date.now(); next.updatedBy = "البوت";
    tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "إجازة من الموارد البشرية" }); tx.set(ref, next);
  });
  const lines = [];
  if (ok.length) {
    await new Promise(r => setTimeout(r, 800));
    const vs = (await C.db.doc("board/bawadi").get()).data()?.vacations || [];
    for (const v of ok) {
      const hit = vs.some(x => x.doctorId === v.d.id && x.start === v.start && x.end === v.end);
      lines.push(`${hit ? "✅ انحفظ وتأكدت منه في الموقع" : "❌ ما انحفظ"}: د. ${shortName(v.d.name)} — ${v.type} من ${dm(v.start)} لين ${dm(v.end)}${v.was ? ` (كانت ${v.was})` : ""}`);
    }
  }
  if (notDoc.length) lines.push(`ℹ️ مو في جدول الأطباء (ما حطيته): ${notDoc.join("، ")}`);
  if (bad.length) lines.push(`⚠️ ${bad.join("، ")}`);
  await say(lines.join("\n"));
  if (who !== "anas" && ok.length) { try { const [w] = await C.getSock().onWhatsApp("966" + C.team.anas?.phone); if (w?.exists) await C.getSock().sendMessage(w.jid, { text: `ℹ️ ${by} أرسل صورة إجازة من الموارد البشرية:\n${lines.join("\n")}` }); } catch {} }
  return true;
}
