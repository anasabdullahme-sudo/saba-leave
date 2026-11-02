// «أداة صحة الجانبية»: أداة على كمبيوتر المسؤول (مو أداة الموظفين) فاتحة منصة صحة بحسابه.
// البوت يحط طلب بحث في Firestore (الهوية + حساب الفرع + رقم PSL/تاريخ الرفع + تاريخ الإجازة عندنا)
// → الأداة تبدّل لحساب الفرع، تبحث بالهوية، تحدد الصف المطابق، وتفتح «عرض» تقرأ تاريخ الإجازة → ترجع النتيجة.
// لو صحة طلّعته: الأداة تبدأ دخول نفاذ وتحط الرقم هنا → البوت يرسله للمسؤول واتساب يوافق من جواله.
// المسار فيه مفتاح سري طويل (agent/{KEY}/…) ما يعرفه إلا البوت والأداة.
import crypto from "node:crypto";

let db, log, dm = async () => false, key = "", state = null, lastNumAt = 0, lastFailNote = 0;
const MIN = 60e3;

// حسابات صحة لكل فرع (نفس أداة الموظفين)
export const SEHA_ACC = {
  bawadi:       { group: "سابا الطبية",                  role: "مدخل الإجازات المرضية", key: "البوادي" },
  tala:         { group: "مجمع عيادات تالة الجبل الطبية", role: "مدخل الإجازات المرضية", key: "تالة" },
  watanak:      { group: "مجمع عيادات وطنك",             role: "مدخل الإجازات المرضية", key: "وطنك" },
  haramain:     { group: "شركة سابا المتطورة المحدودة",  role: "مدخل الإجازات المرضية", key: "الحرمين" },
  sulaimaniyah: { group: "سابا الطبية",                  role: "مدخل الإجازات المرضية", key: "السليمانية" },
};

export async function initAgent(o) {
  ({ db, log } = o); dm = o.dm || dm;
  const ref = db.doc("bot/agent");
  const cur = (await ref.get()).data();
  key = cur?.key || ""; lastNumAt = cur?.numAt || 0; lastFailNote = cur?.failNoteAt || 0;   // محفوظة عشان إعادة تشغيل البوت ما تعيد نفس الرسالة
  if (!key) { key = crypto.randomBytes(24).toString("hex"); await ref.set({ key, at: Date.now() }); }
  db.doc(`agent/${key}/s/state`).onSnapshot(s => { state = s.exists ? s.data() : null; onState().catch(() => {}); }, e => log.warn({ err: String(e?.message || e) }, "حالة أداة صحة"));
  setInterval(async () => {                                                         // طلبات بحث قديمة ما انقرت
    try { const old = await db.collection(`agent/${key}/q`).where("at", "<", Date.now() - 30 * MIN).limit(50).get(); const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); if (!old.empty) await b.commit(); } catch {}
  }, 30 * MIN);
}
export const agentKey = () => key;
export const agentOnline = () => !!(state && Date.now() - (state.at || 0) < 3 * MIN);
export const agentState = () => state;
export const agentReady = () => agentOnline() && !!state.ok;                     // داخل صحة الحين (مو ينتظر نفاذ)

async function onState() {
  if (!state) return;
  const n = state.nafath;
  if (n?.num && n.at > lastNumAt && Date.now() - n.at < 2 * MIN) {
    lastNumAt = n.at; db.doc("bot/agent").set({ numAt: n.at }, { merge: true }).catch(() => {});
    await dm(`🔐 أداة صحة تحتاج دخول\nافتح تطبيق *نفاذ* واختر الرقم: *${n.num}*`);
  }
  if (state.fails >= 3 && Date.now() - lastFailNote > 12 * 3600e3) {               // مرة وحدة كل 12 ساعة بالكثير
    lastFailNote = Date.now(); db.doc("bot/agent").set({ failNoteAt: lastFailNote }, { merge: true }).catch(() => {});
    await dm("⚠ أداة صحة حاولت تدخل 3 مرات وما انوافق في نفاذ — وقفت المحاولات التلقائية.\nترجع تحاول أول ما يجي استفسار.");
  }
}

// تاريخ هجري (أم القرى) لتاريخ رفع الطلب — نفس اللي يطلع في عمود «تاريخ الطلب» في صحة
export function hijri(ms) {
  if (!ms) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${String(p.year).replace(/\D/g, "")}-${p.month}-${p.day}`;
}

// items: [{ id, branch, psl, reqDate (هجري), leaveStart, leaveEnd (dd/mm/yyyy), type }]
// يرجع [{ id, branch, rows, match, view, err }] أو null لو الأداة مو شغالة / ما ردت
export async function askSeha(items, timeoutMs = 4 * MIN) {
  items = (items || []).filter(x => /^[12]\d{9}$/.test(String(x.id))).slice(0, 3)
    .map(x => ({ id: String(x.id), branch: x.branch || "bawadi", acc: SEHA_ACC[x.branch] || SEHA_ACC.bawadi, psl: x.psl || "", reqDate: x.reqDate || "", leaveStart: x.leaveStart || "", leaveEnd: x.leaveEnd || "", type: x.type || "" }));
  if (!items.length || !agentOnline()) return null;
  const ref = db.collection(`agent/${key}/q`).doc();
  await ref.set({ items, at: Date.now(), status: "new" });
  try {
    return await new Promise(resolve => {
      const t = setTimeout(() => { un(); resolve(null); }, timeoutMs);
      const un = ref.onSnapshot(s => {
        const d = s.data(); if (!d) return;
        if (d.status === "done" || d.status === "error") { clearTimeout(t); un(); resolve(d.status === "error" ? [{ err: d.err || "خطأ" }] : (d.res || [])); }
      }, () => { clearTimeout(t); resolve(null); });
    });
  } finally { ref.delete().catch(() => {}); }
}

const ST_ICON = [[/مكتمل/, "✅"], [/بانتظار|انتظار/, "⏳"], [/معلق/, "⏸"], [/معاد/, "↩️"], [/مرفوض|رفض/, "⛔"], [/ملغ/, "✖️"]];
export const sehaIcon = s => (ST_ICON.find(([re]) => re.test(s || "")) || [, "•"])[1];
const icon = s => (ST_ICON.find(([re]) => re.test(s || "")) || [, "•"])[1];
const BR = { bawadi: "البوادي", tala: "تالا", watanak: "وطنك", haramain: "الحرمين", sulaimaniyah: "السليمانية" };
// معنى الحالة للكول سنتر (ليش ما وصلت للمراجع)
export function sehaMeaning(row, w, branch) { return meaning(row, w || {}, branch); }
function meaning(row, w, branch) {
  const st = row.status || "", pay = row.pay || "", br = BR[branch] || branch || "الفرع";
  if (/لم يتم الدفع/.test(pay) || (/معلق/.test(st) && !/تم الدفع/.test(pay))) return `الإجازة مرفوعة ومدققة — بانتظار فرع ${br} يشحن المنصة`;
  if (/مكتمل/.test(st)) return "الإجازة مدققة — يدخل يشيك من صحتي";
  if (/بانتظار (التحقق|التدقيق)|تدقيق|تحقق/.test(st)) return "مرفوعة — بانتظار تدقيق الطبيب";
  if (/معاد/.test(st)) return "رجعت لموظف الإدخال يعدّلها";
  return st;
}
const dmyNum = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || ""); return m ? +m[3] * 1e4 + +m[2] * 100 + +m[1] : 0; };
// سطر/أسطر «منصة صحة» لرسالة القروب
export function sehaText(res, want) {
  if (!res) return "";
  return res.map((r, i) => {
    const w = want?.[i] || {};
    if (r.err) return `🏥 منصة صحة: ما قدرت أشيك${r.err ? " (" + r.err + ")" : ""}`;
    const acc = `حساب ${BR[r.branch] || r.branch || "البوادي"}`;
    if (!r.rows?.length) return `🏥 منصة صحة (${acc}): ما فيه إجازة بالهوية ${r.id}`;
    const m = r.match != null ? r.rows[r.match] : null;
    if (!m) {                                                                         // ما عرفنا أي وحدة: نعرض آخرها
      const last = r.rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      const why = meaning(last, w, r.branch);
      return `🏥 منصة صحة (${acc}): ما لقيت إجازة تطابق الطلب بالضبط — آخر وحدة بالهوية:\n${icon(last.status)} ${last.status || "—"}${last.pay ? " · " + last.pay : ""}${why ? "\n👈 " + why : ""}\n   ${last.psl || ""} · ${last.type || ""} · ${last.date || ""}`;
    }
    let dates = "";
    const vs = r.view?.from, ve = r.view?.to;
    if (vs || ve) {
      const ok = dmyNum(vs) === dmyNum(w.leaveStart) && dmyNum(ve) === dmyNum(w.leaveEnd);
      dates = ok ? `\n📅 تاريخ الإجازة مطابق (${vs} ← ${ve})` : `\n⚠ تاريخ الإجازة في صحة: ${vs || "؟"} ← ${ve || "؟"}${w.leaveStart ? `\n   وعندنا: ${w.leaveStart} ← ${w.leaveEnd}` : ""}`;
    }
    const why = meaning(m, w, r.branch);
    return `🏥 منصة صحة (${acc}):\n${icon(m.status)} *${m.status || "—"}*${m.pay ? " · " + m.pay : ""}${why ? "\n👈 " + why : ""}\n   ${m.psl || ""} · ${m.type || ""} · طلب ${m.date || ""}${dates}`;
  }).join("\n\n");
}

// نفس الإجازة ونفس التاريخ؟ (مطابقة PSL/تاريخ الرفع + تاريخ الإجازة من «عرض» لو انقرا)
export function sehaVerdict(res, w) {
  const r = res?.[0];
  if (!r) return { ok: false, why: "أداة صحة ما ردت" };
  if (r.err) return { ok: false, why: "صحة: " + r.err };
  if (!r.rows?.length) return { ok: false, why: "ما فيه إجازة بهالهوية في صحة" };
  if (r.match == null) return { ok: false, why: "ما لقيت في صحة إجازة بنفس تاريخ الرفع (يمكن ما انرفعت أو انرفعت بحساب ثاني)" };
  const row = r.rows[r.match], vs = r.view?.from, ve = r.view?.to;
  if ((vs || ve) && w?.leaveStart && !(dmyNum(vs) === dmyNum(w.leaveStart) && dmyNum(ve) === dmyNum(w.leaveEnd))) return { ok: false, row, why: `تاريخ الإجازة في صحة (${vs || "؟"} ← ${ve || "؟"}) غير اللي عندنا (${w.leaveStart} ← ${w.leaveEnd})` };
  return { ok: true, row };
}
// للمراجع نفسه (بدون تفاصيل داخلية مثل الدفع)
export function patientSeha(row) {
  const st = row?.status || "", pay = row?.pay || "";
  if (/مكتمل/.test(st)) return "إجازتك مكتملة في منصة صحة ✅ وتقدر تشوفها في تطبيق صحتي.";
  if (/لم يتم الدفع/.test(pay) || /معلق/.test(st)) return "إجازتك مرفوعة في منصة صحة وباقي عليها إجراء بسيط من العيادة، وبتظهر لك في صحتي قريب إن شاء الله.";
  if (/بانتظار (التحقق|التدقيق)|تدقيق|تحقق/.test(st)) return "تأكدت الحين من منصة صحة: إجازتك مرفوعة وتنتظر تدقيق الطبيب، وأول ما يعتمدها تظهر لك في صحتي.";
  if (/معاد/.test(st)) return "إجازتك يراجعها الموظف الحين، وبنبلغك أول ما تكتمل.";
  return "";
}
