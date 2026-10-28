// استفسارات المراجعين اللي مو عن الإجازات (موافقة تأمين، موعد، دوام طبيب، أسعار…):
// البوت يحوّلها للمسؤول على الخاص، والمسؤول يرد على رسالة البوت (سحب/رد) → البوت يرسل الرد للمراجع.
let db, log, getSock, admins = [];
const DAY = 864e5, OPEN_MS = 3 * 3600e3;
const ref = () => db.doc("bot/relay");                       // مستند خاص (القواعد ما تسمح لأحد يقراه غير البوت)
const latin = s => String(s || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const code4 = () => "P" + Array.from({ length: 3 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const adminJids = new Map();

export function initRelay(o) {
  ({ db, log, getSock } = o);
  admins = String(o.admin || "").split(/[,\s]+/).map(p => latin(p).replace(/\D/g, "").replace(/^(00)?966/, "").replace(/^0/, "")).filter(p => /^5\d{8}$/.test(p));
}
export const relayOn = () => admins.length > 0;
export const isAdminPhone = phone => admins.includes(String(phone || "").replace(/^0/, ""));

async function adminJidList() {
  const sock = getSock(), out = [];
  for (const p of admins) {
    let j = adminJids.get(p);
    if (!j) { try { const [r] = await sock.onWhatsApp("966" + p); j = r?.exists ? r.jid : ""; } catch { j = ""; } if (j) adminJids.set(p, j); }
    if (j) out.push(j);
  }
  return out;
}
async function load() { return ((await ref().get()).data()?.items || []).filter(i => Date.now() - i.at < 7 * DAY); }
async function save(items) { await ref().set({ items: items.slice(-150) }); }

// كلام مو عن الإجازات (بدون ذكاء اصطناعي) — الواضح بس
const LEAVE = /(اجاز|إجاز|أجاز|سكليف|سك ليف|sick|تقرير|مشهد|صحتي|صحه|صحة|منصة|منصه|SB-?\s?[A-Z0-9]{5}|اعتماد|اعتياديه|اعتيادية|مرضيه|مرضية|مرافق|حضور)/i;
const OTHER = /(موافق|موافقة|موافقه|تامين|تأمين|التامين|موعد|مواعيد|احجز|حجز|دوام\s*(الدكتور|الدكتوره|د\b)|متى\s*يداوم|يداوم|الدكتور\s+\S+\s+(موجود|متواجد)|سعر|اسعار|أسعار|بكم|كم\s*(سعر|الكشف|الكشفيه)|كشفيه|كشفية|عرض|عروض|باقه|باقة|تحاليل|تحليل|نتيجه|نتيجة|نتائج|اشعه|أشعة|اشعة|تحويل|خصم|فاتوره|فاتورة|استرجاع|مبلغ|دفعت)/i;
export const looksLeave = text => LEAVE.test(text || "");
export const looksOther = text => !!text && OTHER.test(text) && !LEAVE.test(text);

// المراجع عنده محادثة مفتوحة مع المسؤول؟ (آخر 3 ساعات)
export async function openFor(jid) { return (await load()).find(i => i.jid === jid && Date.now() - Math.max(i.at, i.lastAdminAt || 0, i.lastPatientAt || 0) < OPEN_MS) || null; }

// نحوّل رسالة المراجع للمسؤول. يرجع true لو انرسلت
export async function relayToAdmin({ m, jid, phone, name, text, media, note = "" }) {
  if (!relayOn()) return false;
  const sock = getSock(); if (!sock) return false;
  const jids = await adminJidList(); if (!jids.length) return false;
  let items = await load(), it = items.find(i => i.jid === jid && Date.now() - Math.max(i.at, i.lastAdminAt || 0, i.lastPatientAt || 0) < OPEN_MS);
  const isNew = !it;
  if (!it) { it = { code: code4(), jid, phone: phone || "", name: name || "", at: Date.now(), msgIds: [] }; items.push(it); }
  it.lastPatientAt = Date.now();
  const head = isNew
    ? `📨 استفسار مراجع  #${it.code}\n${it.name ? it.name + " — " : ""}${it.phone || "رقم مخفي"}${note ? "\n" + note : ""}\n\n«${(text || "📎 أرسل ملف/صورة").slice(0, 600)}»\n\n↩️ اسحب هذي الرسالة (رد) واكتب جوابك، وأنا أرسله له.`
    : `📨 #${it.code} ${it.name || it.phone || ""}:${note ? "\n" + note : ""}\n«${(text || "📎 ملف/صورة").slice(0, 600)}»`;
  for (const aj of jids) {
    try {
      const s1 = await sock.sendMessage(aj, { text: head }); if (s1?.key?.id) it.msgIds.push(s1.key.id);
      if (media) { const s2 = await sock.sendMessage(aj, { forward: m }); if (s2?.key?.id) it.msgIds.push(s2.key.id); }
    } catch (e) { log.warn({ err: String(e?.message || e) }, "تحويل للمسؤول"); }
  }
  it.msgIds = it.msgIds.slice(-40);
  await save(items);
  log.info({ code: it.code, isNew }, "استفسار للمسؤول");
  return { isNew, code: it.code };
}

// رد المسؤول: لازم يكون ردّ (سحب) على رسالة استفسار، أو كتب الرمز «P7KQ ...» أول الرسالة
export async function handleAdminRelay(m, phone, text) {
  if (!isAdminPhone(phone)) return false;
  const msg = m.message || {};
  const ctx = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo || msg.documentMessage?.contextInfo || msg.audioMessage?.contextInfo || null;
  const qid = ctx?.stanzaId || "";
  const q = ctx?.quotedMessage; const qt = q?.conversation || q?.extendedTextMessage?.text || "";
  const items = await load();
  let it = qid ? items.find(i => (i.msgIds || []).includes(qid)) : null;
  if (!it) { const c = (/#(P[A-Z0-9]{3})\b/.exec(qt) || [])[1]; if (c) it = items.find(i => i.code === c); }
  let body = text || "";
  if (!it) { const c = /^#?(P[A-Z0-9]{3})\s+([\s\S]+)/i.exec(latin(body).trim()); if (c) { it = items.find(i => i.code === c[1].toUpperCase()); if (it) body = c[2]; } }
  if (!it) return false;
  const sock = getSock(); if (!sock) return true;
  const hasMedia = !!(msg.imageMessage || msg.documentMessage || msg.audioMessage || msg.videoMessage);
  try {
    if (hasMedia) await sock.sendMessage(it.jid, { forward: m });
    else if (body.trim()) await sock.sendMessage(it.jid, { text: body.trim() });
    else return true;
    it.lastAdminAt = Date.now(); await save(items);
    await sock.sendMessage(m.key.remoteJid, { react: { text: "✅", key: m.key } }).catch(() => {});    // ✅ على رد المسؤول = انرسل
    log.info({ code: it.code }, "رد المسؤول انرسل للمراجع");
  } catch (e) {
    log.warn({ err: String(e?.message || e) }, "رد المسؤول للمراجع");
    for (const aj of await adminJidList()) await sock.sendMessage(aj, { text: `⚠ ما قدرت أرسل ردك لـ #${it.code} — جرّب مرة ثانية.` }).catch(() => {});
  }
  return true;
}
