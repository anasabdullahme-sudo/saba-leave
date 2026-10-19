/* ==========================================================================
   بوت واتساب عيادات سابا
   - يربط رقم واتساب مخصص (الباركود يطلع في لوحة الموظفين عند المسؤول)
   - يراقب طلبات التعديل اللي ينشئها الموظفين (fixes: sendStatus = queued)
   - يرسلها للمريض واتساب، ويكتب النتيجة (sent / failed) عشان تظهر للموظف
   ========================================================================== */
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from "baileys";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import pino from "pino";
import fs from "node:fs";
import crypto from "node:crypto";

const VERSION = "1.5.1";
const log = pino({ level: process.env.LOG_LEVEL || "info" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Firebase (مفتاح حساب الخدمة من متغير البيئة) ---------- */
function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw) { log.fatal("ناقص المتغير FIREBASE_SERVICE_ACCOUNT — الصق فيه محتوى ملف مفتاح Firebase"); process.exit(1); }
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch {}
  log.fatal("FIREBASE_SERVICE_ACCOUNT مو JSON صحيح — انسخ محتوى الملف كامل"); process.exit(1);
}
try { initializeApp({ credential: cert(serviceAccount()) }); }
catch (e) { log.fatal({ err: e.message }, "مفتاح Firebase غير صالح — نزّل مفتاح جديد من Firebase والصقه كامل"); process.exit(1); }
const db = getFirestore();
const TS = () => FieldValue.serverTimestamp();
const statusRef = db.doc("bot/status");
const controlRef = db.doc("bot/control");

// جلسة واتساب تنحفظ في القرص الدائم (Volume على /data) عشان ما نعيد الربط بعد كل تشغيل
const AUTH_DIR = process.env.AUTH_DIR || (fs.existsSync("/data") ? "/data/wa-auth" : "./wa-auth");

let sock = null, connected = false, me = "";
const setStatus = d => statusRef.set({ ...d, lastSeen: TS(), version: VERSION }, { merge: true }).catch(e => log.warn({ e }, "status write failed"));

/* ---------- الاتصال بواتساب ---------- */
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* نكمل بالنسخة الافتراضية */ }
  sock = makeWASocket({
    auth: state, version,
    logger: log.child({ m: "wa" }, { level: "warn" }),
    browser: Browsers.macOS("Saba Bot"),
    markOnlineOnConnect: false, syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages || []) onIncoming(m).catch(e => log.warn({ err: String(e?.message || e) }, "رسالة واردة"));
  });
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      connected = false;
      await setStatus({ state: "qr", qr, me: "" });
      log.info("باركود الربط جاهز — افتح لوحة الموظفين واضغط «واتساب»");
    }
    if (connection === "open") {
      connected = true; me = sock.user?.id || "";
      await setStatus({ state: "connected", qr: null, me });
      // رقم البوت للعامة (زر «استفسر واتساب» في صفحة المراجع)
      db.doc("public/bot").set({ wa: String(me).split(/[:@]/)[0], at: TS() }).catch(() => {});
      log.info({ me }, "واتساب متصل");
      drain();
    }
    if (connection === "close") {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.warn("انفك الربط — بنطلع باركود جديد");
        db.doc("public/bot").set({ wa: "", at: TS() }).catch(() => {});
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        await setStatus({ state: "qr", qr: null, me: "" });
        setTimeout(connect, 1500);
      } else {
        await setStatus({ state: "connecting", qr: null });
        log.info({ code }, "انقطع الاتصال — نعيد المحاولة");
        setTimeout(connect, 3000);
      }
    }
  });
}

/* ---------- إرسال طلبات التعديل ---------- */
const toJidNumber = p => {
  const d = String(p || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
  return /^5\d{8}$/.test(d) ? "966" + d : "";
};
const queue = new Set();
let busy = false;

async function sendOne(id) {
  const ref = db.doc(`fixes/${id}`);
  // نحجز الطلب (لو فيه أكثر من نسخة شغالة من البوت ما ينرسل مرتين)
  const fx = await db.runTransaction(async tx => {
    const d = await tx.get(ref);
    if (!d.exists || d.get("sendStatus") !== "queued") return null;
    tx.update(ref, { sendStatus: "sending" });
    return d.data();
  });
  if (!fx) return;
  if (fx.status !== "open") { await ref.update({ sendStatus: "cancelled" }); return; }
  try {
    const num = toJidNumber(fx.phone);
    if (!num) throw new Error("رقم جوال المريض غير صحيح");
    if (!fx.message) throw new Error("نص الرسالة فاضي");
    const [r] = await sock.onWhatsApp(num);
    if (!r?.exists) throw new Error("رقم المريض ما عليه واتساب");
    await sock.sendMessage(r.jid, { text: fx.message });
    markOut(r.jid, num);
    await ref.update({ sendStatus: "sent", sentAt: TS(), sentFrom: me });
    log.info({ id, to: num }, "انرسلت");
  } catch (e) {
    log.warn({ id, err: String(e?.message || e) }, "فشل الإرسال");
    await ref.update({ sendStatus: "failed", sendError: String(e?.message || e).slice(0, 200) });
  }
}

async function drain() {
  if (busy || !connected || !queue.size) return;
  busy = true;
  try {
    for (const id of [...queue]) {
      if (!connected) break;
      queue.delete(id);
      await sendOne(id);
      await sleep(2500 + Math.random() * 3000);          // فاصل بسيط بين الرسائل (يقلل خطر الحظر)
    }
  } catch (e) { log.error({ e }, "drain"); }
  finally { busy = false; if (queue.size && connected) setTimeout(drain, 1000); }
}

/* ==========================================================================
   متابعة الطلبات + استفسارات المراجعين
   - track/{بصمة الهوية+الجوال}: حالة طلبات المراجع (صفحة «تابع طلبك» تقراها بالبصمة فقط)
   - المراجع يرسل رقم طلبه (أو هويته) للبوت ← يرد عليه بالحالة، ويطلع تنبيه «يستفسر» للموظفين
   - لو الإجازة «تم الرفع» ← تذكير للطبيب يعتمدها (مرة كل 12 ساعة بالكثير)
   ========================================================================== */
const SITE_URL = (process.env.SITE_URL || "https://anasabdullahme-sudo.github.io/saba-leave/").replace(/\/*$/, "/");
const TRACK_DAYS = +process.env.TRACK_DAYS || 45;
const latin = s => String(s || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const normPhone = p => { let d = latin(p).replace(/\D/g, ""); if (d.startsWith("00966")) d = d.slice(5); if (d.startsWith("966")) d = d.slice(3); if (d.length === 9 && d.startsWith("5")) d = "0" + d; return d; };
const trackKey = (id, phone) => crypto.createHash("sha256").update(`saba-track|${latin(id).replace(/\D/g, "")}|${normPhone(phone)}`).digest("hex").slice(0, 20);
const ms = t => t?.toMillis?.() || 0;
const isDupe = r => r.status === "done" && /^مكرر تلقائياً/.test(r.doneBy || "");
const TYPE_AR = { sick: "إجازتك المرضية", companion: "إجازة المرافق", attendance: "مشهد المراجعة" };
const FIELD_AR = { patientName: "الاسم", idNumber: "رقم الهوية", dob: "تاريخ الميلاد", phone: "رقم الجوال", leaveStart: "بداية الإجازة", leaveEnd: "نهاية الإجازة", visitDate: "تاريخ الحضور", companionName: "اسم المرافق", companionId: "هوية المرافق", companionDob: "ميلاد المرافق", relationship: "صلة القرابة", photo: "صورة التقرير" };
const TYPE_SHORT = { sick: "إجازة مرضية", companion: "إجازة مرافق", attendance: "مشهد مراجعة" };

/* ---------- مزامنة صفحة «تابع طلبك» ---------- */
const trackCache = new Map();          // reqId → { key, json }
function trackItem(r) {
  return {
    ref: r.ref || "", type: r.type || "", state: isDupe(r) ? "dup" : (r.status || "pending"),
    hold: r.status === "held" ? (r.holdReason || "") : "", fix: r.status === "held" && r.fixToken ? r.fixToken : "",
    leaveStart: r.leaveStart || "", leaveEnd: r.leaveEnd || "", visitDate: r.visitDate || "",
    createdAt: ms(r.createdAt), doneAt: ms(r.doneAt),
  };
}
function startTrackSync() {
  const since = Timestamp.fromMillis(Date.now() - TRACK_DAYS * DAY);
  let chain = Promise.resolve();
  db.collection("requests").where("createdAt", ">=", since).onSnapshot(s => {
    const changes = s.docChanges().filter(c => c.type !== "removed");
    chain = chain.then(async () => {
      for (const ch of changes) {
        const r = ch.doc.data(), id = ch.doc.id;
        if (!r.idNumber || !r.phone) continue;
        const key = trackKey(r.idNumber, r.phone), item = trackItem(r), json = JSON.stringify(item), prev = trackCache.get(id);
        if (prev && prev.key === key && prev.json === json) continue;
        trackCache.set(id, { key, json });
        try {
          const b = db.batch();
          b.set(db.doc(`track/${key}`), { items: { [id]: item }, at: TS() }, { merge: true });
          if (prev && prev.key !== key) b.set(db.doc(`track/${prev.key}`), { items: { [id]: FieldValue.delete() } }, { merge: true });
          await b.commit();
        } catch (e) { log.warn({ id, err: String(e?.message || e) }, "track"); }
      }
    });
  }, e => log.error({ err: String(e?.message || e) }, "track listener"));
}

/* ---------- أرقام الأطباء (يضيفها المسؤول من لوحة الموظفين) ---------- */
let doctorPhones = {}, doctorNames = {};
// تعبئة أولية من متغير بيئة في Railway (DOCTOR_PHONES = {"ahmed-kashaf":"05…"}) — ما يكتب فوق رقم موجود
async function seedDoctors() {
  const raw = process.env.DOCTOR_PHONES || ""; if (!raw.trim()) return;
  try {
    const seed = JSON.parse(raw), ref = db.doc("bot/doctors"), cur = (await ref.get()).get("phones") || {};
    const add = {};
    for (const [id, ph] of Object.entries(seed)) { const p = normPhone(ph); if (/^05\d{8}$/.test(p) && cur[id] !== p) add[id] = p; }
    if (Object.keys(add).length) { await ref.set({ phones: add, at: TS() }, { merge: true }); log.info({ n: Object.keys(add).length }, "أرقام الأطباء من DOCTOR_PHONES"); }
  } catch (e) { log.warn({ err: String(e?.message || e) }, "DOCTOR_PHONES مو JSON صحيح"); }
}
// رقم طبيب الطلب: بالمعرّف (الأطباء المسجّلين)، وإلا بالاسم الأول لأطباء البوادي غير المسجّلين
// (مفاتيح الاسم بالشكل "حسام|hussam|hossam")
const normAr = s => String(s || "").toLowerCase().replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
function doctorPhoneFor(r) {
  const byId = normPhone(doctorPhones[r.doctorId] || "");
  if (byId) return byId;
  if (r.branch !== "bawadi") return "";
  const hay = " " + normAr(`${r.doctorName || ""} ${r.stampDoctor || ""}`).replace(/[^a-z\u0600-\u06FF ]/g, " ") + " ";
  for (const [k, ph] of Object.entries(doctorPhones)) {
    if (!k.includes("|") && !/[\u0600-\u06FF]/.test(k)) continue;           // مفتاح معرّف عادي
    const hit = k.split("|").map(normAr).filter(Boolean).some(n => hay.includes(" " + n + " ") || hay.includes(" " + n.replace(/ /g, "") + " "));
    if (hit) return normPhone(ph);
  }
  return "";
}
function watchDoctors() {
  seedDoctors();
  db.doc("bot/doctors").onSnapshot(d => { doctorPhones = d.get("phones") || {}; doctorNames = d.get("names") || {}; },
    e => log.warn({ err: String(e?.message || e) }, "doctors listener"));
}

/* ---------- الرسائل الواردة ---------- */
const lastReply = new Map();           // jid → وقت آخر رد (يمنع الإزعاج والحلقات)
// آخر رسالة طلعت من البوت لكل شخص (بالمعرّف والرقم) — عشان نعرف إن «تمام/شكراً» رد على رسالتنا
const lastOut = new Map();
function markOut(jid, phone) { const n = Date.now(); if (jid) lastOut.set(jid, n); if (phone) lastOut.set(normPhone(phone), n); }
const lastText = new Map();
async function reply(jid, text, phone) {
  if (!connected || !sock) return;
  const prev = lastText.get(jid);
  if (prev && prev.text === text && Date.now() - prev.at < 2 * 3600e3) return;     // نفس الرد ما يتكرر خلال ساعتين
  await sock.sendMessage(jid, { text });
  lastReply.set(jid, Date.now()); lastText.set(jid, { text, at: Date.now() }); markOut(jid, phone);
}
// ردود قصيرة (سلام، شكر، تمام…) — لو جت بعد رسالة منا ما نرد عليها
const PLEASANT = /^(و?\s*عليكم\s*السلام.*|السلام\s*عليكم.*|تمام.*|تم|اوكي?|ok(ay)?|شكرا.*|مشكور.*|يعطيك.*|الله\s*يعافيك.*|جزاك.*|طيب|حاضر|ابشر.*|ان\s*شاء\s*الله|خلاص|[\u{1F300}-\u{1FAFF}\u2600-\u27BF\s]+)[\s!.؟?]*$/iu;
const normMsg = s => latin(s).replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();
async function findByRef(ref) {
  const s = await db.collection("requests").where("ref", "==", ref).limit(1).get();
  return s.docs[0] || null;
}
async function onIncoming(m) {
  const jid = m.key?.remoteJid || "";
  if (m.key?.fromMe || !jid || jid.endsWith("@g.us") || jid.includes("broadcast") || jid.endsWith("@newsletter")) return;
  const msg = m.message || {};
  // تعديل رسالة، حذف، تفاعل (إيموجي على رسالة)… مو رسالة جديدة → نتجاهلها
  if (msg.protocolMessage || msg.editedMessage || msg.reactionMessage || msg.pollUpdateMessage || msg.keepInChatMessage) return;
  const media = !!(msg.imageMessage || msg.documentMessage || msg.audioMessage || msg.videoMessage || msg.stickerMessage);
  const text = (msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.caption || "").trim();
  if (!text && !media) return;
  const now = Date.now();
  if (now - (lastReply.get(jid) || 0) < 20000) return;                 // رد واحد كل 20 ثانية لنفس الشخص
  let pnJid = jid.endsWith("@s.whatsapp.net") ? jid : (m.key.remoteJidAlt || "");
  if (!pnJid && jid.endsWith("@lid")) { try { pnJid = (await sock.signalRepository?.lidMapping?.getPNForLID?.(jid)) || ""; } catch {} }
  const senderPhone = normPhone(String(pnJid).split(/[:@]/)[0]);
  const t = latin(text).toUpperCase();
  const recentOut = Math.max(lastOut.get(jid) || 0, senderPhone ? lastOut.get(senderPhone) || 0 : 0);
  const pleasant = normMsg(text).length <= 30 && PLEASANT.test(normMsg(text));     // «وعليكم السلام / تمام / شكراً»
  const afterUs = now - recentOut < 48 * 3600e3;

  let doc = null;
  const refM = t.match(/SB-?\s?([A-Z0-9]{5})\b/);
  if (refM) doc = await findByRef("SB-" + refM[1]);
  else {
    const idM = t.match(/\b[12]\d{9}\b/);
    if (idM && senderPhone) {                                           // بالهوية: لازم يكون نفس جوال الطلب (خصوصية)
      const s = await db.collection("requests").where("idNumber", "==", idM[0]).get();
      doc = s.docs.filter(d => normPhone(d.get("phone")) === senderPhone).sort((a, b) => ms(b.get("createdAt")) - ms(a.get("createdAt")))[0] || null;
    }
  }
  // ما كتب رقم طلب؟ نعرفه من رقم جواله (آخر طلب له)
  if (!doc && senderPhone && /^05\d{8}$/.test(senderPhone)) {
    const s = await db.collection("requests").where("phone", "==", senderPhone).get();
    doc = s.docs.sort((a, b) => ms(b.get("createdAt")) - ms(a.get("createdAt")))[0] || null;
  }
  if (!doc) {
    if (pleasant && afterUs) return;
    if (now - (lastReply.get(jid + "#help") || 0) < 6 * 3600e3) return;   // رسالة المساعدة مرة كل 6 ساعات
    lastReply.set(jid + "#help", now);
    return reply(jid, `أهلاً 👋 هذا الرقم الآلي لمتابعة طلبات الإجازات في عيادات سابا.\n\nأرسل *رقم طلبك* (يبدأ بـ SB-) وأعطيك حالته فوراً.\n\nأو تابع طلبك من هنا:\n${SITE_URL}?track`);
  }

  let r = doc.data();
  if (isDupe(r)) {                                                      // طلب مكرر → نرد بحالة الأصلي
    const o = (r.doneBy || "").match(/SB-[A-Z0-9]{5}/);
    const od = o && await findByRef(o[0]);
    if (od) { doc = od; r = od.data(); }
  }
  const name = String(r.patientName || "").trim().split(/\s+/)[0] || "";
  const hi = name ? `أهلاً ${name}` : "أهلاً";
  const kind = TYPE_AR[r.type] || "طلبك";
  const tail = `\n\nتابع طلبك: ${SITE_URL}?track`;

  // عنده تعديل مفتوح؟ نذكّره بالرابط مرة وحدة بس — وبعدها أي رسالة منه تروح للموظفين بدون إزعاج
  if (r.status === "held" && r.fixToken) {
    const fref = db.doc(`fixes/${r.fixToken}`), f = await fref.get();
    if (f.exists && f.get("status") === "open") {
      if (!pleasant) await doc.ref.update({ inquiryAt: TS(), inquiryCount: FieldValue.increment(1), inquiryText: (text || "📎 أرسل ملف/صورة").slice(0, 160) }).catch(() => {});
      if (f.get("nudgedAt")) {                                          // ذكّرناه قبل
        if (pleasant) return;
        const ak = jid + "#ack" + r.fixToken;
        if (now - (lastReply.get(ak) || ms(f.get("ackAt"))) < 12 * 3600e3) return;   // ردّ «وصلت رسالتك» مرة كل 12 ساعة بالكثير
        lastReply.set(ak, now); fref.update({ ackAt: TS() }).catch(() => {});
        return reply(jid, `وصلت رسالتك 🌷 بلّغنا فريق سابا، ولو احتاجوا شي بيتواصلون معك.`, senderPhone);
      }
      await fref.update({ nudgedAt: TS() }).catch(() => {});
      const flds = (f.get("fields") || []).map(k => FIELD_AR[k] || k).join("، ");
      return reply(jid, `${/سلام/.test(text) ? "وعليكم السلام ورحمة الله 🌷\n" : ""}${hi}، باقي خطوة بسيطة عشان نرفع ${kind}:\nنحتاج تعدّل${flds ? ` (${flds})` : " بياناتك"} من هالرابط 👇\n${SITE_URL}?fix=${r.fixToken}\n\nأول ما ترسل التعديل نكمل الرفع على طول.`, senderPhone);
    }
  }
  if (pleasant && afterUs) return;                                      // سلام/شكر بعد رسالتنا وما عنده شي مطلوب → بدون رد

  if (r.status === "done") {
    let reminded = false;
    const dp = doctorPhoneFor(r);
    if (/^05\d{8}$/.test(dp) && now - ms(r.doctorRemindedAt) > 12 * 3600e3) {
      try {
        const [w] = await sock.onWhatsApp("966" + dp.slice(1));
        if (w?.exists) {
          const dates = r.type === "attendance" ? (r.visitDate || r.leaveStart) : [r.leaveStart, r.leaveEnd].filter(Boolean).join(" ← ");
          await sock.sendMessage(w.jid, { text: `🔔 تذكير من عيادات سابا\n\nالمراجع/ة: *${r.patientName || ""}*\nالنوع: ${TYPE_SHORT[r.type] || ""}\nالتاريخ: ${dates || "—"}${r.sehaRef ? `\nرقم صحة: ${r.sehaRef}` : ""}\n\nالإجازة مرفوعة على منصة صحة، والمراجع يستفسر عنها. نأمل اعتمادها 🙏` });
          await doc.ref.update({ doctorRemindedAt: TS(), doctorRemindCount: FieldValue.increment(1) });
          reminded = true;
          log.info({ ref: r.ref, doctor: r.doctorId }, "تذكير للطبيب");
        }
      } catch (e) { log.warn({ err: String(e?.message || e) }, "تذكير الطبيب"); }
    } else if (now - ms(r.doctorRemindedAt) <= 12 * 3600e3) reminded = true;
    await doc.ref.update({ inquiryAt: TS(), inquiryCount: FieldValue.increment(1), inquiryText: text.slice(0, 160) }).catch(() => {});
    return reply(jid, `✅ ${hi}، تم رفع ${kind} على منصة صحة${r.sehaRef ? ` (رقم ${r.sehaRef})` : ""}.\n\nتقدر تشوفها من تطبيق *صحتي* ← الإجازات المرضية.${reminded ? "\nإذا ما ظهرت لك للحين، تكون بانتظار اعتماد الطبيب — وأرسلنا له تذكير 👍" : "\nإذا ما ظهرت لك للحين، تكون بانتظار اعتماد الطبيب، وعادةً ما تتأخر."}${tail}`);
  }

  // بالانتظار أو معلّق → تنبيه للموظفين في اللوحة
  await doc.ref.update({ inquiryAt: TS(), inquiryCount: FieldValue.increment(1), inquiryText: text.slice(0, 160) });
  log.info({ ref: r.ref }, "استفسار مراجع");
  if (r.status === "held" && r.fixToken) {
    const f = await db.doc(`fixes/${r.fixToken}`).get();
    if (f.exists && f.get("status") === "open")
      return reply(jid, `✏️ ${hi}، ${kind} تحتاج تعديل بسيط قبل ما نرفعها.\n\nافتح الرابط وعدّل البيانات المطلوبة:\n${SITE_URL}?fix=${r.fixToken}`);
    return reply(jid, `⏳ ${hi}، وصلنا تعديلك وفريق سابا يكمل رفع ${kind} الحين. نبّهناهم باستفسارك 🙏${tail}`);
  }
  if (r.status === "held")
    return reply(jid, `⏳ ${hi}، ${kind} قيد المراجعة عند فريق سابا، ونبّهناهم باستفسارك 🙏${tail}`);
  return reply(jid, `⏳ ${hi}، طلبك ${r.ref || ""} وصلنا وهو بالانتظار عند فريق سابا لرفعه على منصة صحة.\nنبّهنا الفريق باستفسارك 🙏${tail}`);
}

/* ---------- تطبيق تعديل المريض فوراً (بدون ما ننتظر لوحة موظف مفتوحة) ----------
   المريض يرسل التعديل ← الطلب يطلع من «معلّق» ويرجع «في الانتظار» بالبيانات الجديدة
   ولو الموظف غيّر النوع (مثلاً مرضية ← مرافق) يروح لعمود النوع الصحيح */
const TYPES_OK = ["sick", "companion", "attendance"];
function startFixApplier() {
  db.collection("fixes").where("status", "==", "answered").onSnapshot(s => {
    for (const d of s.docs) applyFix(d.ref).catch(e => log.warn({ id: d.id, err: String(e?.message || e) }, "تطبيق التعديل"));
  }, e => log.error({ err: String(e?.message || e) }, "fixes answered listener"));
}
async function applyFix(fref) {
  const res = await db.runTransaction(async tx => {
    const f = await tx.get(fref);
    if (!f.exists || f.get("status") !== "answered") return null;
    const rref = db.doc(`requests/${f.get("reqId")}`), r = await tx.get(rref);
    const a = f.get("answer") || {}, patch = {};
    for (const [k, v] of Object.entries(a)) { if (k === "note") { if (v) patch.patientNote = String(v).slice(0, 300); } else if (v) patch[k] = v; }
    const nt = f.get("newType");
    if (TYPES_OK.includes(nt)) { patch.type = nt; patch.typeManual = true; }
    if (r.exists && r.get("status") !== "done")
      tx.update(rref, { ...patch, status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null });
    tx.update(fref, { status: "applied", appliedAt: TS(), appliedBy: "تلقائي" });
    return { name: f.get("name"), type: patch.type || "" };
  });
  if (res) log.info(res, "تطبّق تعديل المريض");
}

/* ---------- تنظيف الصور التلقائي (يومياً) ----------
   الخطة المجانية فيها 1GB بس، والصور داخل Firestore. لو امتلت يوقف الرفع عند المرضى.
   - نمسح صور الطلبات المنتهية الأقدم من KEEP_DAYS
   - ولو المساحة تعدّت MAX_MB نمسح الأقدم فالأقدم لين ننزل تحت TARGET_MB
   - ما نلمس أبداً: صور الطلبات اللي بالانتظار/معلّقة، صور التعديلات المفتوحة، وأي صورة عمرها أقل من يومين */
const KEEP_DAYS = +process.env.IMAGE_KEEP_DAYS || 60;
const MAX_MB = +process.env.IMAGE_MAX_MB || 700, TARGET_MB = MAX_MB - 120;
const DAY = 864e5;
async function cleanupImages() {
  try {
    const keep = new Set();
    const addPath = p => { if (typeof p === "string" && p.startsWith("fs:")) keep.add(p.slice(3)); };
    const active = await db.collection("requests").where("status", "in", ["pending", "held"]).select("imagePath").get();
    active.docs.forEach(d => addPath(d.get("imagePath")));
    const fx = await db.collection("fixes").where("status", "in", ["open", "answered"]).select("answer").get();
    fx.docs.forEach(d => addPath(d.get("answer")?.imagePath));

    const imgs = await db.collection("images").orderBy("createdAt").select("size", "createdAt").get();
    let total = imgs.docs.reduce((s, d) => s + (d.get("size") || 0), 0);
    const before = total, now = Date.now(), cutoff = now - KEEP_DAYS * DAY, trim = total > MAX_MB * 1e6;
    const del = [];
    for (const d of imgs.docs) {                                   // الأقدم أولاً
      if (del.length >= 3000) break;                               // حد يومي (حدود الكتابة في الخطة المجانية)
      if (keep.has(d.id)) continue;
      const t = d.get("createdAt")?.toMillis?.() || 0;
      if (t > now - 2 * DAY) break;
      if (t < cutoff || (trim && total > TARGET_MB * 1e6)) { del.push(d.id); total -= d.get("size") || 0; }
    }
    for (let i = 0; i < del.length; i += 200) {
      const b = db.batch();
      for (const id of del.slice(i, i + 200)) { b.delete(db.doc(`imageData/${id}`)); b.delete(db.doc(`images/${id}`)); }
      await b.commit();
    }
    const mb = Math.round(total / 1e6);
    await setStatus({ storage: { mb, maxMb: 1024, images: imgs.size - del.length, deleted: del.length, at: TS() } });
    log.info({ beforeMb: Math.round(before / 1e6), afterMb: mb, deleted: del.length }, "تنظيف الصور");
  } catch (e) { log.error({ err: String(e?.message || e) }, "فشل تنظيف الصور"); }
}

/* ---------- التشغيل ---------- */
async function main() {
  log.info({ VERSION, AUTH_DIR }, "بوت سابا يشتغل");
  await setStatus({ state: "connecting", qr: null, startedAt: TS() });

  // أي رسالة كانت «تنرسل» لما طاح البوت: ما نعيد إرسالها تلقائياً (عشان ما توصل مرتين) — تطلع للموظف يرسلها يدوي
  const stuck = await db.collection("fixes").where("sendStatus", "==", "sending").get();
  for (const d of stuck.docs) await d.ref.update({ sendStatus: "failed", sendError: "انقطع البوت أثناء الإرسال — تأكد مع المريض أو أرسلها يدوي" });

  db.collection("fixes").where("sendStatus", "==", "queued").onSnapshot(
    s => { s.docs.forEach(d => queue.add(d.id)); drain(); },
    e => log.error({ e }, "fixes listener"));

  // أوامر المسؤول من اللوحة (فك الربط)
  const started = Date.now();
  controlRef.onSnapshot(async d => {
    if (!d.exists) return;
    const cmd = d.get("cmd"), at = d.get("at")?.toMillis?.() || 0;
    if (at < started - 5000) { await controlRef.delete().catch(() => {}); return; }
    if (cmd === "test") {                                  // رسالة تجربة لطبيب (من لوحة الموظفين)
      await controlRef.delete().catch(() => {});
      const p = normPhone(d.get("phone"));
      try {
        if (!connected || !sock) throw new Error("البوت مو متصل بواتساب");
        if (!/^05\d{8}$/.test(p)) throw new Error("رقم غير صحيح");
        const [w] = await sock.onWhatsApp("966" + p.slice(1));
        if (!w?.exists) throw new Error("الرقم ما عليه واتساب");
        await sock.sendMessage(w.jid, { text: `🔔 تذكير من عيادات سابا\n\nالمراجع/ة: *مراجع تجريبي*\nالنوع: إجازة مرضية\nالتاريخ: ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}\n\nالإجازة مرفوعة على منصة صحة، والمراجع يستفسر عنها. نأمل اعتمادها 🙏\n\n(هذي رسالة تجربة — تجاهلها)` });
        await setStatus({ lastTest: { phone: p, ok: true, err: "", at: TS() } });
        log.info({ to: p }, "رسالة تجربة انرسلت");
      } catch (e) {
        await setStatus({ lastTest: { phone: p, ok: false, err: String(e?.message || e).slice(0, 120), at: TS() } });
        log.warn({ to: p, err: String(e?.message || e) }, "رسالة تجربة فشلت");
      }
      return;
    }
    if (cmd !== "logout") return;
    log.warn("المسؤول طلب فك الربط");
    await controlRef.delete().catch(() => {});
    try { await sock?.logout(); } catch { /* connection.update يتكفل بالباقي */ }
  }, e => log.error({ e }, "control listener"));

  // نبض كل ٣٠ ثانية عشان اللوحة تعرف إن البوت شغال
  setInterval(() => statusRef.set({ lastSeen: TS() }, { merge: true }).catch(() => {}), 30000);

  startTrackSync();
  watchDoctors();
  startFixApplier();

  // تنظيف الصور: بعد التشغيل بدقيقتين، وبعدها كل ١٢ ساعة
  setTimeout(cleanupImages, 2 * 60000);
  setInterval(cleanupImages, 12 * 3600000);

  await connect();
}

const shutdown = async () => { try { await statusRef.set({ state: "offline", lastSeen: TS() }, { merge: true }); } catch {} process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
process.on("unhandledRejection", e => log.error({ e }, "unhandledRejection"));
process.on("uncaughtException", e => { log.fatal({ err: String(e?.stack || e) }, "خطأ غير متوقع — Railway بيعيد التشغيل"); process.exit(1); });

main().catch(e => { log.fatal({ e }, "فشل التشغيل"); process.exit(1); });
