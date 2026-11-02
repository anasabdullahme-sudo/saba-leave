// أرشيف صور الإجازات على قرص البوت الدائم (Railway Volume على /data)
// - كل صورة ترفع للموقع تنحفظ نسخة منها هنا خلال دقايق (حتى لو انمسحت بعدين من الموقع أو من التنظيف التلقائي)
// - تنحفظ ARCHIVE_DAYS يوم (افتراضي 30)، أو لين المسؤول يقول «احذف صور الأرشيف»
// - لو القرص قرّب يمتلي نمسح الأقدم فالأقدم
// - المسؤول يطلب الصورة على الخاص: «صورة 1091407278» أو «صورة SB-XXXXX» أو «صورة 05xxxxxxxx»
import fs from "node:fs";
import path from "node:path";

const ROOT = fs.existsSync("/data") ? "/data/img-archive" : "";
const DAYS = +process.env.ARCHIVE_DAYS || 30;
const MIN_FREE_MB = +process.env.ARCHIVE_MIN_FREE_MB || 300;   // نخلي مساحة لجلسة الواتساب والنسخ الاحتياطية
const DAY = 864e5;
let db, log, running = false;

export const archiveOn = () => !!ROOT;
export function initArchive(o) { ({ db, log } = o); if (ROOT) fs.mkdirSync(ROOT, { recursive: true }); }

const cursorFile = () => path.join(ROOT, ".cursor");
const readCursor = () => { try { return +fs.readFileSync(cursorFile(), "utf8") || 0; } catch { return 0; } };
const fileFor = id => { for (const ext of ["jpg", "png", "webp", "pdf"]) { const f = path.join(ROOT, `${id}.${ext}`); if (fs.existsSync(f)) return f; } return ""; };
export const isArchived = id => !!(ROOT && fileFor(id));

function saveDataUrl(id, dataUrl, createdMs) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || "")); if (!m) return false;
  const ext = m[1] === "application/pdf" ? "pdf" : m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  const f = path.join(ROOT, `${id}.${ext}`);
  fs.writeFileSync(f, Buffer.from(m[2], "base64"));
  if (createdMs) { const t = new Date(createdMs); try { fs.utimesSync(f, t, t); } catch {} }   // عمر الملف = وقت الرفع (للحذف بعد شهر)
  return true;
}

// نسخ الصور الجديدة (بالترتيب من آخر وحدة انحفظت) — دفعات صغيرة عشان حدود القراءة في الخطة المجانية
export async function archiveNew(max = 150) {
  if (!ROOT || running) return 0; running = true; let n = 0;
  try {
    let cur = readCursor();
    while (n < max) {
      const { Timestamp } = await import("firebase-admin/firestore");
      const s = await db.collection("images").where("createdAt", ">", Timestamp.fromMillis(cur)).orderBy("createdAt").limit(25).select("createdAt").get();
      if (s.empty) break;
      for (const d of s.docs) {
        const t = d.get("createdAt")?.toMillis?.() || 0;
        if (!isArchived(d.id) && t > Date.now() - DAYS * DAY) {
          const x = await db.doc(`imageData/${d.id}`).get();
          if (x.exists && saveDataUrl(d.id, x.get("data"), t)) n++;
        }
        cur = Math.max(cur, t);
      }
      fs.writeFileSync(cursorFile(), String(cur));
      if (s.size < 25) break;
    }
    if (n) log.info({ n }, "أرشيف الصور: انحفظت صور جديدة");
  } catch (e) { log.warn({ err: String(e?.message || e) }, "أرشيف الصور"); }
  finally { running = false; }
  return n;
}

// نتأكد إن الصور اللي بنمسحها من Firestore محفوظة في الأرشيف قبل المسح
export async function ensureArchived(ids) {
  if (!ROOT) return;
  for (const id of ids) {
    if (isArchived(id)) continue;
    try { const x = await db.doc(`imageData/${id}`).get(); if (x.exists) saveDataUrl(id, x.get("data"), x.get("createdAt")?.toMillis?.() || 0); } catch {}
  }
}

function files() {
  return fs.readdirSync(ROOT).filter(f => !f.startsWith(".")).map(f => { const p = path.join(ROOT, f), st = fs.statSync(p); return { f, p, t: st.mtimeMs, size: st.size }; }).sort((a, b) => a.t - b.t);
}
function freeMb() { try { const s = fs.statfsSync(ROOT); return (s.bavail * s.bsize) / 1e6; } catch { return Infinity; } }

// يومياً: نمسح الأقدم من شهر، ولو القرص قرّب يمتلي نمسح الأقدم لين يرجع فيه مساحة
export function pruneArchive() {
  if (!ROOT) return { n: 0 };
  let n = 0;
  const list = files();
  for (const x of list) if (x.t < Date.now() - DAYS * DAY) { fs.rmSync(x.p, { force: true }); n++; }
  for (const x of files()) { if (freeMb() >= MIN_FREE_MB) break; fs.rmSync(x.p, { force: true }); n++; }
  if (n) log.info({ n }, "أرشيف الصور: انمسحت صور قديمة");
  return { n };
}

export function archiveStats() {
  if (!ROOT) return null;
  const list = files();
  return { count: list.length, mb: Math.round(list.reduce((s, x) => s + x.size, 0) / 1e6), oldest: list[0]?.t || 0, freeMb: Math.round(freeMb()) };
}
export function wipeArchive() { if (!ROOT) return 0; const list = files(); list.forEach(x => fs.rmSync(x.p, { force: true })); return list.length; }
export function removeArchived(id) { const f = ROOT && fileFor(id); if (f) fs.rmSync(f, { force: true }); return !!f; }

// الصورة: من الموقع لو موجودة، وإلا من الأرشيف
export async function getImage(imagePath) {
  const id = String(imagePath || "").startsWith("fs:") ? imagePath.slice(3) : ""; if (!id) return null;
  try {
    const x = await db.doc(`imageData/${id}`).get();
    const m = x.exists && /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(x.get("data") || ""));
    if (m) return { buf: Buffer.from(m[2], "base64"), pdf: m[1] === "application/pdf", from: "site" };
  } catch {}
  const f = ROOT && fileFor(id);
  if (f) return { buf: fs.readFileSync(f), pdf: f.endsWith(".pdf"), from: "archive" };
  return null;
}
