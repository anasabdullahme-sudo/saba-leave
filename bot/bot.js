/* ==========================================================================
   بوت واتساب عيادات سابا
   - يربط رقم واتساب مخصص (الباركود يطلع في لوحة الموظفين عند المسؤول)
   - يراقب طلبات التعديل اللي ينشئها الموظفين (fixes: sendStatus = queued)
   - يرسلها للمريض واتساب، ويكتب النتيجة (sent / failed) عشان تظهر للموظف
   ========================================================================== */
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from "baileys";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import pino from "pino";
import fs from "node:fs";

const VERSION = "1.0.0";
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
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      connected = false;
      await setStatus({ state: "qr", qr, me: "" });
      log.info("باركود الربط جاهز — افتح لوحة الموظفين واضغط «واتساب»");
    }
    if (connection === "open") {
      connected = true; me = sock.user?.id || "";
      await setStatus({ state: "connected", qr: null, me });
      log.info({ me }, "واتساب متصل");
      drain();
    }
    if (connection === "close") {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.warn("انفك الربط — بنطلع باركود جديد");
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
    if (!d.exists || d.get("cmd") !== "logout") return;
    const at = d.get("at")?.toMillis?.() || 0;
    if (at < started - 5000) { await controlRef.delete().catch(() => {}); return; }
    log.warn("المسؤول طلب فك الربط");
    await controlRef.delete().catch(() => {});
    try { await sock?.logout(); } catch { /* connection.update يتكفل بالباقي */ }
  }, e => log.error({ e }, "control listener"));

  // نبض كل ٣٠ ثانية عشان اللوحة تعرف إن البوت شغال
  setInterval(() => statusRef.set({ lastSeen: TS() }, { merge: true }).catch(() => {}), 30000);

  await connect();
}

const shutdown = async () => { try { await statusRef.set({ state: "offline", lastSeen: TS() }, { merge: true }); } catch {} process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
process.on("unhandledRejection", e => log.error({ e }, "unhandledRejection"));
process.on("uncaughtException", e => { log.fatal({ err: String(e?.stack || e) }, "خطأ غير متوقع — Railway بيعيد التشغيل"); process.exit(1); });

main().catch(e => { log.fatal({ e }, "فشل التشغيل"); process.exit(1); });
